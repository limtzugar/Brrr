// ─── SPOT "Tops and Bottoms" engine — headless paper (MACD + RSI) ───────────
// Plain-vanilla spot buy/sell for BTC / ETH / SOL on Binance spot (public data).
// BUY  bottom: RSI(14) ≤ 30 AND MACD histogram turning up / bullish cross
// SELL top: RSI(14) ≥ 70 AND MACD histogram turning down / bearish cross
// Enhancements (parity with organism lib/tactics-macd-n-rsi.mjs):
//   · Hurst regime guard (no falling knives; no early exit in runaway trend)
//   · RSI divergence boost · 1D SMA200 trend anchor
//   · hard time stop (maxHoldBars) + entry cooldown
// State: AppSettings['spot_macd_rsi_state'] · closes → TradeLog (mode 'demo').
// No exchange keys — public market data only. Live is a later, explicit step.

import { db } from './db'
import { binanceFetch } from './binance-fetch'

export const SPOT_PROFILE = {
  coins: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  interval: '4h',
  interval1d: '1d',
  rsiPeriod: 14,
  oversold: 30,
  overbought: 70,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  trendSma: 200,
  maxHoldBars: 12,       // 48h
  cooldownBars: 4,       // 16h between entries per coin
  positionPctOfEquity: 0.25,
  takerFeePctPerSide: 0.1,
  lookback: 120,
  stateKey: 'spot_macd_rsi_state',
  strategyId: 'spot-macd-rsi',
  startEquityUsd: 1000,
} as const

const BINANCE_SPOT = 'https://api.binance.com'

interface CoinPos { symbol: string; entry: number; openedAtBar: number; barsHeld: number }
interface SpotState {
  equity: number
  realizedPnl: number
  wins: number
  losses: number
  positions: Record<string, CoinPos>
  lastEntryBar: Record<string, number>
  lastBarTs: number
}

export function sma(values: number[], period: number): number {
  if (values.length < period) return Number.NaN
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  const slice = closes.slice(-(period + 1))
  let gains = 0, losses = 0
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1]
    if (d >= 0) gains += d; else losses -= d
  }
  if (losses === 0) return 100
  return 100 - 100 / (1 + gains / losses)
}

/** EMA-based MACD histogram. null if not enough data. */
export function macd(closes: number[], { fast = 12, slow = 26, signal = 9 } = {}): { histogram: number; prevHistogram: number; crossedUp: boolean; crossedDown: boolean } | null {
  const emaR = (arr: number[], n: number): number => {
    const k = 2 / (n + 1)
    let e = arr[0]
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k)
    return e
  }
  const hist: number[] = []
  for (let i = slow; i < closes.length; i++) {
    const f = emaR(closes.slice(0, i + 1), fast)
    const s = emaR(closes.slice(0, i + 1), slow)
    const trailing = closes.slice(Math.max(slow - 1, i - signal + 1), i + 1)
    hist.push(f - s - emaR(trailing, signal))
  }
  if (hist.length < 2) return null
  const h = hist[hist.length - 1]
  const prev = hist[hist.length - 2]
  return { histogram: h, prevHistogram: prev, crossedUp: prev <= 0 && h > 0, crossedDown: prev >= 0 && h < 0 }
}

/** R/S Hurst exponent (port of organism tactics-crowd-hurst). */
export function hurst(prices: number[], period = 100): number | null {
  if (prices.length < period) return null
  const window = prices.slice(-period)
  const rets: number[] = []
  for (let j = 1; j < window.length; j++) if (window[j - 1] > 0 && window[j] > 0) rets.push(Math.log(window[j] / window[j - 1]))
  if (rets.length < 10) return null
  const subSizes = [4, 8, 16, 32].filter((s) => s <= rets.length)
  if (subSizes.length < 2) return null
  const pts: { x: number; y: number }[] = []
  for (const size of subSizes) {
    const num = Math.floor(rets.length / size)
    let totalRS = 0
    for (let sIdx = 0; sIdx < num; sIdx++) {
      const subset = rets.slice(sIdx * size, (sIdx + 1) * size)
      const mean = subset.reduce((a, b) => a + b, 0) / subset.length
      const dev: number[] = []
      let cum = 0
      for (const v of subset) { cum += v - mean; dev.push(cum) }
      const R = Math.max(...dev) - Math.min(...dev)
      const S = Math.sqrt(subset.reduce((q, v) => q + (v - mean) ** 2, 0) / subset.length)
      if (S > 0 && R > 0) totalRS += R / S
    }
    if (num > 0) {
      const avg = totalRS / num
      if (avg > 0) pts.push({ x: Math.log(size), y: Math.log(avg) })
    }
  }
  if (pts.length < 2) return null
  const n = pts.length
  const sx = pts.reduce((a, p) => a + p.x, 0), sy = pts.reduce((a, p) => a + p.y, 0)
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0), sxx = pts.reduce((a, p) => a + p.x * p.x, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  return Math.max(0, Math.min(1, (n * sxy - sx * sy) / denom))
}

export function detectDivergence(closes: number[], rsiVals: (number | null)[], lookback = 2): string | null {
  const n = rsiVals.length
  const back = Math.min(lookback, n - 2)
  let lowP = Infinity, lowR = Infinity, highP = -Infinity, highR = -Infinity
  for (let i = n - 2 - back; i < n - 1; i++) {
    if (closes[i] < lowP && rsiVals[i] != null) { lowP = closes[i]; lowR = rsiVals[i]! }
    if (closes[i] > highP && rsiVals[i] != null) { highP = closes[i]; highR = rsiVals[i]! }
  }
  const curP = closes[n - 1], curR = rsiVals[n - 1]
  if (curR == null) return null
  if (curP < lowP && curR > lowR) return 'bullish'
  if (curP > highP && curR < highR) return 'bearish'
  return null
}

export function longTermUptrend(closes1d: number[]): boolean | null {
  const price = closes1d[closes1d.length - 1]
  const m = sma(closes1d, SPOT_PROFILE.trendSma)
  if (price == null || Number.isNaN(m)) return null
  return price > m
}

// ─── Signal eval (parity with organism lib/tactics-macd-n-rsi evaluatePnL4h) ─

export function evaluateSignal(closes4h: number[]): { signal: 'BUY' | 'SELL' | 'HOLD'; confidence: number; rsi: number | null; reasons: string[]; regime: string | null } {
  const reasons: string[] = []
  const r = rsi(closes4h, SPOT_PROFILE.rsiPeriod)
  const m = macd(closes4h)
  if (r === null || !m) return { signal: 'HOLD', confidence: 0, rsi: r, reasons: ['insufficient_data'], regime: null }

  const rsiVals = closes4h.map((_, i, arr) => (i < SPOT_PROFILE.rsiPeriod ? null : rsi(arr.slice(0, i + 1), SPOT_PROFILE.rsiPeriod)))
  const div = detectDivergence(closes4h, rsiVals, 2)
  const h = hurst(closes4h, 100)
  const regime = h == null ? null : (h >= 0.55 ? 'trending' : h <= 0.45 ? 'mean_reverting' : 'random')
  let conf = 0

  if (r <= SPOT_PROFILE.oversold && (m.histogram > m.prevHistogram || m.crossedUp)) {
    reasons.push(`RSI ${r.toFixed(0)} oversold`)
    reasons.push(m.crossedUp ? 'MACD bullish cross' : 'MACD hist up')
    conf += 0.35
    if (div === 'bullish') { conf += 0.2; reasons.push('bullish divergence') }
    if (regime === 'trending' && h! > 0.6) { reasons.push(`Hurst ${h!.toFixed(2)} downtrend — skip`); return { signal: 'HOLD', confidence: 0, rsi: r, reasons, regime } }
    conf += regime === 'mean_reverting' ? 0.16 : 0.1
    return { signal: conf >= 0.5 ? 'BUY' : 'HOLD', confidence: Math.min(1, conf), rsi: r, reasons, regime }
  }

  if (r >= SPOT_PROFILE.overbought && (m.histogram < m.prevHistogram || m.crossedDown)) {
    reasons.push(`RSI ${r.toFixed(0)} overbought`)
    reasons.push(m.crossedDown ? 'MACD bearish cross' : 'MACD hist down')
    conf += 0.35
    if (div === 'bearish') { conf += 0.2; reasons.push('bearish divergence') }
    if (regime === 'trending' && h! > 0.75) { reasons.push(`Hurst ${h!.toFixed(2)} runaway — hold`); return { signal: 'HOLD', confidence: 0, rsi: r, reasons, regime } }
    conf += regime === 'mean_reverting' ? 0.16 : 0.1
    return { signal: conf >= 0.5 ? 'SELL' : 'HOLD', confidence: Math.min(1, conf), rsi: r, reasons, regime }
  }

  return { signal: 'HOLD', confidence: 0, rsi: r, reasons: ['no_confirmed_extreme'], regime }
}

// ─── Market data + state ────────────────────────────────────────────────────

async function fetchCloses(symbol: string, interval: string, limit: number): Promise<number[]> {
  const rows = await binanceFetch<unknown[][]>(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  if (!Array.isArray(rows)) return []
  return rows.map((k) => Number(k[4])).filter((v) => Number.isFinite(v))
}

async function loadState(): Promise<SpotState> {
  try {
    const row = await db.appSettings.findUnique({ where: { key: SPOT_PROFILE.stateKey } })
    if (row) {
      const j = JSON.parse(row.value)
      return {
        equity: Number(j.equity ?? SPOT_PROFILE.startEquityUsd),
        realizedPnl: Number(j.realizedPnl ?? 0),
        wins: Number(j.wins ?? 0),
        losses: Number(j.losses ?? 0),
        positions: j.positions || {},
        lastEntryBar: j.lastEntryBar || {},
        lastBarTs: Number(j.lastBarTs ?? 0),
      }
    }
  } catch { /* fresh */ }
  return { equity: SPOT_PROFILE.startEquityUsd, realizedPnl: 0, wins: 0, losses: 0, positions: {}, lastEntryBar: {}, lastBarTs: 0 }
}

async function saveState(st: SpotState): Promise<void> {
  await db.appSettings.upsert({
    where: { key: SPOT_PROFILE.stateKey },
    update: { value: JSON.stringify(st) },
    create: { key: SPOT_PROFILE.stateKey, value: JSON.stringify(st) },
  })
}

async function ensureStrategy(): Promise<string> {
  const existing = await db.activeStrategy.findFirst({ where: { strategyId: SPOT_PROFILE.strategyId } })
  if (existing) return existing.id
  const created = await db.activeStrategy.create({
    data: {
      strategyId: SPOT_PROFILE.strategyId,
      name: 'SPOT Tops and Bottoms (paper, MACD+RSI)',
      coinId: 'multi',
      symbol: 'BTC/ETH/SOL',
      mode: 'demo',
      exchange: 'binance',
      strategyType: 'spot_macd_rsi',
      strategyParams: JSON.stringify({
        rule: 'BUY: RSI<=30 + MACD hist up; SELL: RSI>=70 + MACD hist down',
        enhancements: ['hurst_regime_guard', 'rsi_divergence', 'sma200_anchor', 'time_stop', 'cooldown'],
        source: 'headless cron engine (2026-08-01)',
      }),
    },
  })
  return created.id
}

async function recordClose(st: SpotState, pos: CoinPos, exit: number, reason: string, strategyId: string): Promise<void> {
  const positionUsd = st.equity * SPOT_PROFILE.positionPctOfEquity
  const dir = pos.entry > 0 ? (exit - pos.entry) / pos.entry : 0
  const grossUsd = positionUsd * dir
  const fees = positionUsd * ((SPOT_PROFILE.takerFeePctPerSide * 2) / 100)
  const netUsd = grossUsd - fees
  st.equity += netUsd
  st.realizedPnl += netUsd
  if (netUsd > 0) st.wins++; else st.losses++
  delete st.positions[pos.symbol]
  await db.tradeLog.create({
    data: {
      activeStrategyId: strategyId,
      mode: 'demo',
      coinId: 'multi',
      symbol: pos.symbol,
      side: 'sell',
      entryPrice: pos.entry,
      exitPrice: exit,
      exitDate: new Date().toISOString(),
      exitReason: reason,
      quantity: positionUsd / pos.entry,
      positionSize: positionUsd,
      profitPct: dir * 100,
      netProfitPct: positionUsd > 0 ? (netUsd / positionUsd) * 100 : 0,
      feesPaid: fees,
      capitalAfter: st.equity,
      orderStatus: 'Filled',
    },
  })
}

// ─── Engine tick ────────────────────────────────────────────────────────────

export async function runSpotTick(): Promise<{
  ok: boolean
  bar: number
  actions: string[]
  state: { equity: number; realizedPnl: number; wins: number; losses: number; open: number }
}> {
  const st = await loadState()
  const strategyId = await ensureStrategy()
  const actions: string[] = []
  const now = Date.now()
  const bar = Math.floor(now / (4 * 3600 * 1000)) // 4h bar index = clock
  st.lastBarTs = now

  for (const symbol of SPOT_PROFILE.coins) {
    const closes4h = await fetchCloses(symbol, SPOT_PROFILE.interval, SPOT_PROFILE.lookback)
    if (closes4h.length < 60) continue
    const closes1d = await fetchCloses(symbol, SPOT_PROFILE.interval1d, SPOT_PROFILE.trendSma + 5)
    const price = closes4h[closes4h.length - 1]
    const pos = st.positions[symbol]

    if (pos) {
      const ageBars = bar - pos.openedAtBar
      if (ageBars >= SPOT_PROFILE.maxHoldBars) {
        await recordClose(st, pos, price, 'timeout', strategyId)
        actions.push(`close ${symbol} timeout @ ${price}`)
      } else {
        const sig = evaluateSignal(closes4h)
        if (sig.signal === 'SELL') {
          await recordClose(st, pos, price, 'signal_sell', strategyId)
          actions.push(`close ${symbol} SELL @ ${price} (${sig.reasons.slice(0, 2).join('; ')})`)
        }
      }
      continue
    }

    const sig = evaluateSignal(closes4h)
    if (sig.signal === 'BUY') {
      const lastEntry = st.lastEntryBar[symbol] || 0
      if (bar - lastEntry >= SPOT_PROFILE.cooldownBars) {
        if (longTermUptrend(closes1d) !== false) {
          st.positions[symbol] = { symbol, entry: price, openedAtBar: bar, barsHeld: 0 }
          st.lastEntryBar[symbol] = bar
          actions.push(`open LONG ${symbol} @ ${price} (${sig.reasons.slice(0, 2).join('; ')})`)
        } else {
          actions.push(`skip BUY ${symbol} (below 1D SMA200)`)
        }
      }
    }
  }

  await saveState(st)
  return {
    ok: true,
    bar,
    actions,
    state: {
      equity: Math.round(st.equity * 100) / 100,
      realizedPnl: Math.round(st.realizedPnl * 100) / 100,
      wins: st.wins,
      losses: st.losses,
      open: Object.keys(st.positions).length,
    },
  }
}

export async function getSpotState() {
  const st = await loadState()
  return {
    profile: { ...SPOT_PROFILE },
    equity: Math.round(st.equity * 100) / 100,
    realizedPnl: Math.round(st.realizedPnl * 100) / 100,
    wins: st.wins,
    losses: st.losses,
    winRatePct: st.wins + st.losses > 0 ? Math.round((1000 * st.wins) / (st.wins + st.losses)) / 10 : null,
    openPositions: st.positions,
  }
}
