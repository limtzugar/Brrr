// ─── CEX CROWD Engine — headless paper scalper (CROWD20 profile) ────────────
// Data-proven config (48,766 real paper trades, May–Jun 2026, analysis 2026-07-31):
//   CROWD-only trigger · SHORT bias · 20x leverage · TP 0.50% / SL 0.40% price move
//   hard timeout 60s (CLOSED_TIMEOUT leak was −$3,103) · margin 5% of equity per trade
//   pairs: TAO / FIL / ICP / DOGE / LINK (whitelist from data)
//
// Signal: Binance top-trader POSITION ratio ≥65% one side (public API, MOMENTUM follow).
// TA-lite gate: SMA8 vs SMA21 alignment + RSI(14) sanity (1m klines).
// State: AppSettings['cex_crowd_engine_state'] (JSON) · closes → TradeLog (mode 'demo').
// NO exchange keys needed — public market data only. Live mode is a LATER, explicit step.

import { db } from './db'
import { binanceFetch } from './binance-fetch'

export const CROWD_PROFILE = {
  leverage: 20,
  takeProfitPct: 0.50, // % PRICE move (20x amplifies to ~10% position PnL)
  stopLossPct: 0.40,   // % PRICE move — tighter than TP (data: losers ran 1.5× winners)
  timeoutMs: 60_000,
  marginPctOfEquity: 0.05,
  maxOpenPositions: 3,
  ratioThreshold: 0.65,
  takerFeePctPerSide: 0.055, // Bybit taker
  pairs: ['TAO-USDT', 'FIL-USDT', 'ICP-USDT', 'DOGE-USDT', 'LINK-USDT'],
  stateKey: 'cex_crowd_engine_state',
  strategyId: 'cex-crowd-engine',
  startEquityUsd: 500,
} as const

const SIDE_BIAS = (process.env.CROWD_SIDE_BIAS || 'SHORT').toUpperCase() // 'SHORT' | 'BOTH'
const FAPI = 'https://fapi.binance.com'

export interface PaperPosition {
  pair: string
  symbol: string       // Binance futures symbol, e.g. TAOUSDT
  side: 'SHORT' | 'LONG'
  entry: number
  margin: number       // USD margin (paper)
  notional: number     // margin × leverage
  openedAt: number
  tpPrice: number
  slPrice: number
}

interface EngineState {
  equity: number
  realizedPnl: number
  wins: number
  losses: number
  positions: PaperPosition[]
  lastTickAt: number
}

// ─── Small TA helpers (pure) ────────────────────────────────────────────────

export function sma(values: number[], period: number): number {
  if (values.length < period) return NaN
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d
    else losses -= d
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

// ─── Market data (Binance futures public) ───────────────────────────────────

interface RatioRow { longAccount: string; shortAccount: string; timestamp: number }

export async function fetchCrowdRatio(symbol: string): Promise<{ longRatio: number; at: number } | null> {
  const rows = await binanceFetch<RatioRow[]>(
    `${FAPI}/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`,
  )
  const row = Array.isArray(rows) && rows[0]
  if (!row) return null
  const lr = Number(row.longAccount)
  return Number.isFinite(lr) ? { longRatio: lr, at: Number(row.timestamp) || Date.now() } : null
}

async function fetchKlineCloses(symbol: string, interval = '1m', limit = 30): Promise<number[]> {
  const rows = await binanceFetch<unknown[][]>(
    `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  )
  if (!Array.isArray(rows)) return []
  return rows.map((k) => Number(k[4])).filter((v) => Number.isFinite(v))
}

async function fetchPrice(symbol: string): Promise<number | null> {
  const row = await binanceFetch<{ price: string }>(`${FAPI}/fapi/v1/ticker/price?symbol=${symbol}`)
  const p = row ? Number(row.price) : NaN
  return Number.isFinite(p) ? p : null
}

// ─── State persistence ──────────────────────────────────────────────────────

async function loadState(): Promise<EngineState> {
  try {
    const row = await db.appSettings.findUnique({ where: { key: CROWD_PROFILE.stateKey } })
    if (row) {
      const j = JSON.parse(row.value)
      return {
        equity: Number(j.equity ?? CROWD_PROFILE.startEquityUsd),
        realizedPnl: Number(j.realizedPnl ?? 0),
        wins: Number(j.wins ?? 0),
        losses: Number(j.losses ?? 0),
        positions: Array.isArray(j.positions) ? j.positions : [],
        lastTickAt: Number(j.lastTickAt ?? 0),
      }
    }
  } catch { /* fall through to fresh state */ }
  return { equity: CROWD_PROFILE.startEquityUsd, realizedPnl: 0, wins: 0, losses: 0, positions: [], lastTickAt: 0 }
}

async function saveState(st: EngineState): Promise<void> {
  await db.appSettings.upsert({
    where: { key: CROWD_PROFILE.stateKey },
    update: { value: JSON.stringify(st) },
    create: { key: CROWD_PROFILE.stateKey, value: JSON.stringify(st) },
  })
}

// ─── Strategy row (TradeLog parent) ─────────────────────────────────────────

async function ensureStrategy(): Promise<string> {
  const existing = await db.activeStrategy.findFirst({ where: { strategyId: CROWD_PROFILE.strategyId } })
  if (existing) return existing.id
  const created = await db.activeStrategy.create({
    data: {
      strategyId: CROWD_PROFILE.strategyId,
      name: 'CEX CROWD Engine (paper, CROWD20)',
      coinId: 'multi',
      symbol: 'MULTI',
      mode: 'demo',
      exchange: 'bybit',
      strategyType: 'crowd_momentum',
      strategyParams: JSON.stringify({
        leverage: CROWD_PROFILE.leverage,
        takeProfitPct: CROWD_PROFILE.takeProfitPct,
        stopLossPct: CROWD_PROFILE.stopLossPct,
        timeoutMs: CROWD_PROFILE.timeoutMs,
        sideBias: SIDE_BIAS,
        source: 'headless cron engine (audit 2026-07-31, data-proven profile)',
      }),
    },
  })
  return created.id
}

// ─── Position close math + persistence ──────────────────────────────────────

function closeMath(pos: PaperPosition, exit: number) {
  const dir = pos.side === 'SHORT' ? 1 : -1
  const pricePct = ((pos.entry - exit) / pos.entry) * 100 * dir
  const grossUsd = (pricePct / 100) * pos.notional
  const fees = pos.notional * ((CROWD_PROFILE.takerFeePctPerSide * 2) / 100)
  const netUsd = grossUsd - fees
  const netPctOnMargin = (netUsd / pos.margin) * 100
  return { pricePct, grossUsd, fees, netUsd, netPctOnMargin }
}

async function closePosition(
  st: EngineState,
  pos: PaperPosition,
  exit: number,
  reason: 'take_profit' | 'stop_loss' | 'timeout',
  strategyId: string,
): Promise<void> {
  const m = closeMath(pos, exit)
  st.equity += m.netUsd
  st.realizedPnl += m.netUsd
  if (m.netUsd > 0) st.wins++
  else st.losses++
  st.positions = st.positions.filter((p) => p !== pos)

  await db.tradeLog.create({
    data: {
      activeStrategyId: strategyId,
      mode: 'demo',
      coinId: 'multi',
      symbol: pos.symbol,
      side: 'sell',
      entryPrice: pos.entry,
      exitPrice: exit,
      entryDate: new Date(pos.openedAt).toISOString(),
      exitDate: new Date().toISOString(),
      exitReason: reason,
      quantity: pos.notional / pos.entry,
      positionSize: pos.margin,
      profitPct: m.pricePct,
      netProfitPct: m.netPctOnMargin,
      feesPaid: m.fees,
      capitalAfter: st.equity,
      orderStatus: 'Filled',
    },
  })
}

// ─── Engine tick ────────────────────────────────────────────────────────────

export async function runCrowdEngineTick(): Promise<{
  ok: boolean
  closed: { pair: string; reason: string; netUsd: number }[]
  opened: { pair: string; side: string; entry: number }[]
  state: { equity: number; realizedPnl: number; wins: number; losses: number; open: number }
  error?: string
}> {
  const st = await loadState()
  const strategyId = await ensureStrategy()
  const closed: { pair: string; reason: string; netUsd: number }[] = []
  const opened: { pair: string; side: string; entry: number }[] = []
  const now = Date.now()

  // ── 1. Manage open positions (timeout first, then TP/SL) ──
  for (const pos of [...st.positions]) {
    const price = await fetchPrice(pos.symbol)
    if (price == null) continue
    const age = now - pos.openedAt
    let reason: 'take_profit' | 'stop_loss' | 'timeout' | null = null
    if (age >= CROWD_PROFILE.timeoutMs) reason = 'timeout'
    else if (pos.side === 'SHORT' && price <= pos.tpPrice) reason = 'take_profit'
    else if (pos.side === 'SHORT' && price >= pos.slPrice) reason = 'stop_loss'
    else if (pos.side === 'LONG' && price >= pos.tpPrice) reason = 'take_profit'
    else if (pos.side === 'LONG' && price <= pos.slPrice) reason = 'stop_loss'
    if (reason) {
      const m = closeMath(pos, price)
      await closePosition(st, pos, price, reason, strategyId)
      closed.push({ pair: pos.pair, reason, netUsd: Math.round(m.netUsd * 100) / 100 })
    }
  }

  // ── 2. Entries (CROWD signal + TA-lite gate) ──
  if (st.positions.length < CROWD_PROFILE.maxOpenPositions) {
    for (const pair of CROWD_PROFILE.pairs) {
      if (st.positions.length >= CROWD_PROFILE.maxOpenPositions) break
      if (st.positions.some((p) => p.pair === pair)) continue
      const symbol = pair.replace('-', '')
      const ratio = await fetchCrowdRatio(symbol)
      if (!ratio) continue
      const lr = ratio.longRatio
      let side: 'SHORT' | 'LONG' | null = null
      if (lr <= 1 - CROWD_PROFILE.ratioThreshold) side = 'SHORT'
      else if (SIDE_BIAS === 'BOTH' && lr >= CROWD_PROFILE.ratioThreshold) side = 'LONG'
      if (!side) continue
      if (SIDE_BIAS === 'SHORT' && side !== 'SHORT') continue

      // TA-lite gate from 1m klines: SHORT needs SMA8 < SMA21 and RSI < 70; LONG mirrored
      const closes = await fetchKlineCloses(symbol, '1m', 30)
      if (closes.length < 25) continue
      const s8 = sma(closes, 8)
      const s21 = sma(closes, 21)
      const r = rsi(closes, 14)
      if (side === 'SHORT' && !(s8 < s21 && r < 70)) continue
      if (side === 'LONG' && !(s8 > s21 && r > 30)) continue

      const entry = closes[closes.length - 1]
      const margin = Math.max(5, Math.round(st.equity * CROWD_PROFILE.marginPctOfEquity * 100) / 100)
      const notional = margin * CROWD_PROFILE.leverage
      const tpPct = CROWD_PROFILE.takeProfitPct / 100
      const slPct = CROWD_PROFILE.stopLossPct / 100
      const pos: PaperPosition = {
        pair,
        symbol,
        side,
        entry,
        margin,
        notional,
        openedAt: now,
        tpPrice: side === 'SHORT' ? entry * (1 - tpPct) : entry * (1 + tpPct),
        slPrice: side === 'SHORT' ? entry * (1 + slPct) : entry * (1 - slPct),
      }
      st.positions.push(pos)
      opened.push({ pair, side, entry })
      console.log(`[cex-crowd] OPEN ${side} ${pair} @ ${entry} · margin $${margin} · crowd ${(lr * 100).toFixed(1)}% long · sma8 ${s8.toFixed(4)}/sma21 ${s21.toFixed(4)} · rsi ${r.toFixed(0)}`)
    }
  }

  st.lastTickAt = now
  await saveState(st)
  return {
    ok: true,
    closed,
    opened,
    state: {
      equity: Math.round(st.equity * 100) / 100,
      realizedPnl: Math.round(st.realizedPnl * 100) / 100,
      wins: st.wins,
      losses: st.losses,
      open: st.positions.length,
    },
  }
}

/** Read-only state for UI / diagnostics. */
export async function getCrowdEngineState() {
  const st = await loadState()
  return {
    profile: { ...CROWD_PROFILE, sideBias: SIDE_BIAS },
    equity: st.equity,
    realizedPnl: st.realizedPnl,
    wins: st.wins,
    losses: st.losses,
    winRatePct: st.wins + st.losses > 0 ? Math.round((1000 * st.wins) / (st.wins + st.losses)) / 10 : null,
    openPositions: st.positions,
    lastTickAt: st.lastTickAt,
  }
}
