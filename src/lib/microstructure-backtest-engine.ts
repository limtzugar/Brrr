// ─── Microstructure Radar Backtest Engine ──────────────────────────────────
// Backtests CEX Anomaly signals using real Binance 5m candle data.
// For each signal: simulate entry at signal price, exit on TP (2%) or SL (6.5%).
// Walks through 5m candles using high/low for intra-candle TP/SL detection.

import type { SignalEvent, CexAnomalySignalType } from './signal-scoring'
import { SIGNAL_TYPE_META } from './signal-scoring'

// ─── Configuration ────────────────────────────────────────────────────────

export const BACKTEST_CONFIG = {
  /** Take profit as % of entry price (2% = price move) */
  TP_PCT: 2.0,
  /** Stop loss as % of entry price (6.5% = price move) */
  SL_PCT: 6.5,
  /** Fee rate per side (Bybit taker 0.055%) */
  FEE_RATE: 0.00055,
  /** Maximum candles to check before timeout (60 × 5min = 5 hours) */
  MAX_CANDLES: 60,
  /** Candle interval for Binance API */
  CANDLE_INTERVAL: '5m',
  /** Number of candles to fetch per signal */
  CANDLES_FETCH_LIMIT: 60,
  /** Maximum concurrent kline fetches */
  MAX_CONCURRENT_FETCHES: 3,
  /** Request delay between batch fetches (ms) */
  FETCH_DELAY_MS: 250,
} as const

// ─── Types ────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  /** Original signal event */
  signal: SignalEvent
  /** Entry price (from signal) */
  entryPrice: number
  /** Exit price */
  exitPrice: number
  /** TP price level */
  tpPrice: number
  /** SL price level */
  slPrice: number
  /** Position side */
  side: 'LONG' | 'SHORT'
  /** Pair symbol (e.g., 'BTC-USDT') */
  pair: string
  /** Binance symbol (e.g., 'BTCUSDT') */
  binanceSymbol: string
  /** Exit reason */
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT'
  /** Gross price change % (before fees) */
  priceChangePct: number
  /** Net PnL % (after fees, including leverage) */
  netPnlPct: number
  /** Gross PnL % (before fees, including leverage) */
  grossPnlPct: number
  /** Net PnL in $ (based on capitalPerTrade) */
  netPnlUsd: number
  /** Number of 5m candles held */
  candlesHeld: number
  /** Holding time in minutes */
  holdMinutes: number
  /** Entry timestamp (from signal) */
  entryTs: number
  /** Exit timestamp (from candle data) */
  exitTs: number
  /** Whether kline data was available */
  dataAvailable: boolean
  /** Error message if fetch failed */
  error?: string
}

export interface BacktestCategoryStats {
  category: CexAnomalySignalType
  label: string
  color: string
  totalTrades: number
  wins: number
  losses: number
  timeouts: number
  winRate: number
  avgPnlPct: number
  totalPnlPct: number
  totalPnlUsd: number
  avgPnlUsd: number
  bestTradePct: number
  worstTradePct: number
  avgHoldMinutes: number
  /** Profit factor: gross wins / gross losses */
  profitFactor: number
}

export interface BacktestResults {
  trades: BacktestTrade[]
  categoryStats: BacktestCategoryStats[]
  overallStats: {
    totalTrades: number
    wins: number
    losses: number
    timeouts: number
    winRate: number
    avgPnlPct: number
    totalPnlPct: number
    totalPnlUsd: number
    avgPnlUsd: number
    bestTradePct: number
    worstTradePct: number
    avgHoldMinutes: number
    profitFactor: number
    dataAvailable: number
    dataMissing: number
  }
  /** Signals that were used for backtest (filtered for valid ones) */
  signalsUsed: number
  /** Signals that were skipped (no matching pair, etc.) */
  signalsSkipped: number
  /** Timestamp of the backtest run */
  runAt: number
}

// ─── Binance Kline Data ──────────────────────────────────────────────────

interface BinanceKline {
  openTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  closeTime: number
  quoteVolume: string
  trades: number
}

// ─── Pair to Binance Symbol Mapping ──────────────────────────────────────

export const PAIR_TO_BINANCE: Record<string, string> = {
  'BTC-USDT': 'BTCUSDT',
  'ETH-USDT': 'ETHUSDT',
  'SOL-USDT': 'SOLUSDT',
  'BNB-USDT': 'BNBUSDT',
  'XRP-USDT': 'XRPUSDT',
  'DOGE-USDT': 'DOGEUSDT',
  'ADA-USDT': 'ADAUSDT',
  'FIL-USDT': 'FILUSDT',
  'SUI-USDT': 'SUIUSDT',
  'PEPE-USDT': 'PEPEUSDT',
  'FET-USDT': 'FETUSDT',
  'ICP-USDT': 'ICPUSDT',
  'TAO-USDT': 'TAOUSDT',
  'ZEC-USDT': 'ZECUSDT',
  'INJ-USDT': 'INJUSDT',
  'TON-USDT': 'TONUSDT',
  'LINK-USDT': 'LINKUSDT',
  'AVAX-USDT': 'AVAXUSDT',
  'HYPE-USDT': 'HYPEUSDT',
  'TRUMP-USDT': 'TRUMPUSDT',
  'WLD-USDT': 'WLDUSDT',
}

function pairToBinanceSymbol(pair: string): string {
  return PAIR_TO_BINANCE[pair] || pair.replace('-', '')
}

// ─── Fetch Klines ────────────────────────────────────────────────────────

async function fetchKlines(
  binanceSymbol: string,
  startTime: number,
  limit: number = BACKTEST_CONFIG.CANDLES_FETCH_LIMIT,
): Promise<BinanceKline[]> {
  try {
    const params = new URLSearchParams({
      symbol: binanceSymbol,
      interval: BACKTEST_CONFIG.CANDLE_INTERVAL,
      limit: String(limit),
      startTime: String(startTime),
    })

    // Use AbortController + longer timeout for kline fetches
    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 60_000)
    let res: Response
    try {
      res = await fetch(`/api/binance/klines?${params.toString()}`, {
        signal: controller.signal,
      })
    } finally {
      clearTimeout(fetchTimeout)
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const text = await res.text()
    const data: unknown[][] = JSON.parse(text)

    return data.map((k): BinanceKline => ({
      openTime: Number(k[0]),
      open: String(k[1]),
      high: String(k[2]),
      low: String(k[3]),
      close: String(k[4]),
      volume: String(k[5]),
      closeTime: Number(k[6]),
      quoteVolume: String(k[7]),
      trades: Number(k[8]),
    }))
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Kline fetch failed')
  }
}

// ─── Simulate Single Trade ───────────────────────────────────────────────

function simulateTrade(
  signal: SignalEvent,
  klines: BinanceKline[],
  leverage: number = 1,
  maxCandles: number = BACKTEST_CONFIG.MAX_CANDLES,
  capitalPerTrade: number = 100,
): BacktestTrade {
  const entryPrice = signal.entryPrice
  const side = signal.side
  const tpPct = BACKTEST_CONFIG.TP_PCT
  const slPct = BACKTEST_CONFIG.SL_PCT

  // Calculate TP/SL levels based on side
  let tpPrice: number
  let slPrice: number

  if (side === 'LONG') {
    tpPrice = entryPrice * (1 + tpPct / 100)
    slPrice = entryPrice * (1 - slPct / 100)
  } else {
    // SHORT: TP when price goes down, SL when price goes up
    tpPrice = entryPrice * (1 - tpPct / 100)
    slPrice = entryPrice * (1 + slPct / 100)
  }

  const entryTs = new Date(signal.timestamp).getTime()
  const binanceSymbol = pairToBinanceSymbol(signal.pair)

  // Base result for no data
  const noDataResult: BacktestTrade = {
    signal,
    entryPrice,
    exitPrice: entryPrice,
    tpPrice,
    slPrice,
    side,
    pair: signal.pair,
    binanceSymbol,
    exitReason: 'TIMEOUT',
    priceChangePct: 0,
    netPnlPct: 0,
    grossPnlPct: 0,
    netPnlUsd: 0,
    candlesHeld: 0,
    holdMinutes: 0,
    entryTs,
    exitTs: entryTs,
    dataAvailable: false,
  }

  if (klines.length === 0) {
    return { ...noDataResult, error: 'No kline data' }
  }

  // Walk through candles starting from the first candle AFTER entry
  // (the signal candle is the one where entry happened)
  let exitPrice = entryPrice
  let exitReason: BacktestTrade['exitReason'] = 'TIMEOUT'
  let candlesHeld = 0
  let exitTs = entryTs

  for (let i = 0; i < klines.length && i < maxCandles; i++) {
    const kline = klines[i]
    const high = parseFloat(kline.high)
    const low = parseFloat(kline.low)
    const close = parseFloat(kline.close)

    candlesHeld++

    if (side === 'LONG') {
      // Check SL first (conservative: assume SL hits before TP in same candle)
      if (low <= slPrice) {
        exitPrice = slPrice
        exitReason = 'STOP_LOSS'
        exitTs = kline.openTime
        break
      }
      // Check TP
      if (high >= tpPrice) {
        exitPrice = tpPrice
        exitReason = 'TAKE_PROFIT'
        exitTs = kline.openTime
        break
      }
    } else {
      // SHORT
      // Check SL first (price went up = bad for short)
      if (high >= slPrice) {
        exitPrice = slPrice
        exitReason = 'STOP_LOSS'
        exitTs = kline.openTime
        break
      }
      // Check TP (price went down = good for short)
      if (low <= tpPrice) {
        exitPrice = tpPrice
        exitReason = 'TAKE_PROFIT'
        exitTs = kline.openTime
        break
      }
    }

    // If this is the last candle, use close price
    if (i === klines.length - 1 || i === maxCandles - 1) {
      exitPrice = close
      exitReason = 'TIMEOUT'
      exitTs = kline.closeTime
    }
  }

  // Calculate PnL
  let priceChangePct: number
  if (side === 'LONG') {
    priceChangePct = ((exitPrice - entryPrice) / entryPrice) * 100
  } else {
    priceChangePct = ((entryPrice - exitPrice) / entryPrice) * 100
  }

  const feePct = BACKTEST_CONFIG.FEE_RATE * 2 * 100 // round-trip fee as %
  const grossPnlPct = priceChangePct * leverage
  const netPnlPct = grossPnlPct - feePct * leverage
  const netPnlUsd = (netPnlPct / 100) * capitalPerTrade

  const holdMinutes = candlesHeld * 5 // 5m candles

  return {
    signal,
    entryPrice,
    exitPrice,
    tpPrice,
    slPrice,
    side,
    pair: signal.pair,
    binanceSymbol,
    exitReason,
    priceChangePct,
    netPnlPct,
    grossPnlPct,
    netPnlUsd,
    candlesHeld,
    holdMinutes,
    entryTs,
    exitTs,
    dataAvailable: true,
  }
}

// ─── Main Backtest Runner ────────────────────────────────────────────────

export async function runMicrostructureBacktest(
  signals: SignalEvent[],
  leverage: number = 1,
  onProgress?: (completed: number, total: number) => void,
  maxCandles: number = BACKTEST_CONFIG.MAX_CANDLES,
  capitalPerTrade: number = 100,
): Promise<BacktestResults> {
  const validSignals = signals.filter(s => {
    // Only CEX Anomaly signals with valid pair mapping
    if (!s.pair || !s.entryPrice || s.entryPrice <= 0) return false
    if (!PAIR_TO_BINANCE[s.pair]) return false
    return true
  })

  const signalsSkipped = signals.length - validSignals.length
  const trades: BacktestTrade[] = []

  // Group signals by pair+timestamp proximity to reduce API calls
  // Fetch klines per unique pair, then simulate all signals for that pair
  const pairGroups = new Map<string, SignalEvent[]>()
  for (const sig of validSignals) {
    const key = sig.pair
    if (!pairGroups.has(key)) pairGroups.set(key, [])
    pairGroups.get(key)!.push(sig)
  }

  let completed = 0
  const total = validSignals.length

  // Process each pair group
  for (const [pair, pairSignals] of pairGroups) {
    const binanceSymbol = pairToBinanceSymbol(pair)

    // Fetch klines for each signal's timestamp
    // Batch: find earliest timestamp and fetch from there
    const sortedSignals = [...pairSignals].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    for (const signal of sortedSignals) {
      const entryTs = new Date(signal.timestamp).getTime()

      // Fetch klines starting from signal time
      // Add a small buffer to ensure we get candles AFTER entry
      let klines: BinanceKline[] = []
      try {
        klines = await fetchKlines(binanceSymbol, entryTs, Math.max(BACKTEST_CONFIG.CANDLES_FETCH_LIMIT, maxCandles + 5))
      } catch (err) {
        // Fetch failed — record trade as no-data
        const trade = simulateTrade(signal, [], leverage, maxCandles, capitalPerTrade)
        trade.error = err instanceof Error ? err.message : 'Fetch failed'
        trades.push(trade)
        completed++
        onProgress?.(completed, total)
        continue
      }

      // Skip the first candle if it's the entry candle (signal happened during it)
      // We want candles AFTER entry for the simulation
      const entryKlineIdx = klines.findIndex(k =>
        entryTs >= k.openTime && entryTs <= k.closeTime
      )
      const simKlines = entryKlineIdx >= 0 ? klines.slice(entryKlineIdx + 1) : klines

      const trade = simulateTrade(signal, simKlines, leverage, maxCandles, capitalPerTrade)
      trades.push(trade)

      completed++
      onProgress?.(completed, total)

      // Rate limit: delay between fetches
      if (completed < total) {
        await new Promise(r => setTimeout(r, BACKTEST_CONFIG.FETCH_DELAY_MS))
      }
    }
  }

  // Sort trades by timestamp
  trades.sort((a, b) => a.entryTs - b.entryTs)

  // Compute category stats
  const categoryMap = new Map<CexAnomalySignalType, BacktestTrade[]>()
  for (const trade of trades) {
    const cat = trade.signal.signalType as CexAnomalySignalType
    if (!categoryMap.has(cat)) categoryMap.set(cat, [])
    categoryMap.get(cat)!.push(trade)
  }

  const categoryStats: BacktestCategoryStats[] = []
  for (const [category, catTrades] of categoryMap) {
    const dataTrades = catTrades.filter(t => t.dataAvailable)
    if (dataTrades.length === 0) continue

    const wins = dataTrades.filter(t => t.exitReason === 'TAKE_PROFIT')
    const losses = dataTrades.filter(t => t.exitReason === 'STOP_LOSS')
    const timeouts = dataTrades.filter(t => t.exitReason === 'TIMEOUT')

    const grossWinPnl = wins.reduce((s, t) => s + t.grossPnlPct, 0)
    const grossLossPnl = Math.abs(losses.reduce((s, t) => s + t.grossPnlPct, 0))

    const meta = SIGNAL_TYPE_META[category]

    const totalPnlUsd = dataTrades.reduce((s, t) => s + t.netPnlUsd, 0)
    categoryStats.push({
      category,
      label: meta?.label || category,
      color: meta?.color || '#888888',
      totalTrades: dataTrades.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      winRate: dataTrades.length > 0 ? (wins.length / dataTrades.length) * 100 : 0,
      avgPnlPct: dataTrades.length > 0
        ? dataTrades.reduce((s, t) => s + t.netPnlPct, 0) / dataTrades.length
        : 0,
      totalPnlPct: dataTrades.reduce((s, t) => s + t.netPnlPct, 0),
      totalPnlUsd,
      avgPnlUsd: dataTrades.length > 0 ? totalPnlUsd / dataTrades.length : 0,
      bestTradePct: Math.max(...dataTrades.map(t => t.netPnlPct)),
      worstTradePct: Math.min(...dataTrades.map(t => t.netPnlPct)),
      avgHoldMinutes: dataTrades.length > 0
        ? dataTrades.reduce((s, t) => s + t.holdMinutes, 0) / dataTrades.length
        : 0,
      profitFactor: grossLossPnl > 0 ? grossWinPnl / grossLossPnl : grossWinPnl > 0 ? 999 : 0,
    })
  }

  // Sort category stats by total trades descending
  categoryStats.sort((a, b) => b.totalTrades - a.totalTrades)

  // Compute overall stats
  const dataTrades = trades.filter(t => t.dataAvailable)
  const wins = dataTrades.filter(t => t.exitReason === 'TAKE_PROFIT')
  const losses = dataTrades.filter(t => t.exitReason === 'STOP_LOSS')
  const timeouts = dataTrades.filter(t => t.exitReason === 'TIMEOUT')
  const grossWinPnl = wins.reduce((s, t) => s + t.grossPnlPct, 0)
  const grossLossPnl = Math.abs(losses.reduce((s, t) => s + t.grossPnlPct, 0))

  const overallTotalPnlUsd = dataTrades.reduce((s, t) => s + t.netPnlUsd, 0)
  const overallStats = {
    totalTrades: dataTrades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: timeouts.length,
    winRate: dataTrades.length > 0 ? (wins.length / dataTrades.length) * 100 : 0,
    avgPnlPct: dataTrades.length > 0
      ? dataTrades.reduce((s, t) => s + t.netPnlPct, 0) / dataTrades.length
      : 0,
    totalPnlPct: dataTrades.reduce((s, t) => s + t.netPnlPct, 0),
    totalPnlUsd: overallTotalPnlUsd,
    avgPnlUsd: dataTrades.length > 0 ? overallTotalPnlUsd / dataTrades.length : 0,
    bestTradePct: dataTrades.length > 0 ? Math.max(...dataTrades.map(t => t.netPnlPct)) : 0,
    worstTradePct: dataTrades.length > 0 ? Math.min(...dataTrades.map(t => t.netPnlPct)) : 0,
    avgHoldMinutes: dataTrades.length > 0
      ? dataTrades.reduce((s, t) => s + t.holdMinutes, 0) / dataTrades.length
      : 0,
    profitFactor: grossLossPnl > 0 ? grossWinPnl / grossLossPnl : grossWinPnl > 0 ? 999 : 0,
    dataAvailable: dataTrades.length,
    dataMissing: trades.filter(t => !t.dataAvailable).length,
  }

  return {
    trades,
    categoryStats,
    overallStats,
    signalsUsed: validSignals.length,
    signalsSkipped,
    runAt: Date.now(),
  }
}

// ─── Historical Signal Scanner ───────────────────────────────────────────
// Fetches historical 5m klines from Binance and scans for signal patterns.
// Generates SignalEvent objects that can be fed into the backtest engine.

export interface HistoricalScanConfig {
  /** Number of days to scan back */
  days: number
  /** Pairs to scan (e.g. ['BTC-USDT', 'ETH-USDT']) */
  pairs: string[]
  /** Signal types to generate (if empty, generate all) */
  signalTypes?: CexAnomalySignalType[]
  /** Minimum volume spike multiplier (default 2.5) */
  volSpikeMult?: number
  /** Minimum candle body % to count as momentum (default 0.5) */
  momentumMinPct?: number
  /** Minimum cooldown between signals on same pair (in candles, default 12 = 1h) */
  cooldownCandles?: number
  /** Progress callback */
  onProgress?: (phase: string, completed: number, total: number) => void
}

/** Parsed kline with numeric fields for analysis */
interface ParsedKline {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number
  trades: number
  bodyPct: number    // (close-open)/open * 100
  upperWickPct: number
  lowerWickPct: number
  isGreen: boolean
}

/** Fetch all klines for a period, paginating through Binance's 1000 limit */
async function fetchHistoricalKlines(
  binanceSymbol: string,
  daysBack: number,
): Promise<ParsedKline[]> {
  const CANDLE_MS = 5 * 60 * 1000
  const CANDLES_PER_DAY = (24 * 60) / 5  // 288
  const endTime = Date.now()
  const startTime = endTime - daysBack * 24 * 60 * 60 * 1000
  const totalCandles = Math.ceil((endTime - startTime) / CANDLE_MS)

  const allKlines: ParsedKline[] = []
  let cursor = startTime

  while (cursor < endTime) {
    const remaining = Math.ceil((endTime - cursor) / CANDLE_MS)
    const batchSize = Math.min(1000, remaining + 10)

    let batch: BinanceKline[] = []
    try {
      const params = new URLSearchParams({
        symbol: binanceSymbol,
        interval: '5m',
        limit: String(batchSize),
        startTime: String(cursor),
      })
      // Use AbortController + longer timeout for large historical kline fetches
      const hController = new AbortController()
      const hTimeout = setTimeout(() => hController.abort(), 60_000)
      let hRes: Response
      try {
        hRes = await fetch(`/api/binance/klines?${params.toString()}`, {
          signal: hController.signal,
        })
      } finally {
        clearTimeout(hTimeout)
      }
      if (!hRes.ok) break
      const hText = await hRes.text()
      const data: unknown[][] = JSON.parse(hText)
      batch = data.map((k): BinanceKline => ({
        openTime: Number(k[0]),
        open: String(k[1]),
        high: String(k[2]),
        low: String(k[3]),
        close: String(k[4]),
        volume: String(k[5]),
        closeTime: Number(k[6]),
        quoteVolume: String(k[7]),
        trades: Number(k[8]),
      }))
    } catch {
      break
    }

    if (batch.length === 0) break

    for (const k of batch) {
      const o = parseFloat(k.open)
      const h = parseFloat(k.high)
      const l = parseFloat(k.low)
      const c = parseFloat(k.close)
      const v = parseFloat(k.volume)
      const qv = parseFloat(k.quoteVolume)
      const isGreen = c >= o
      const body = Math.abs(c - o)
      const bodyPct = (body / o) * 100
      const upperWick = h - Math.max(c, o)
      const lowerWick = Math.min(c, o) - l

      allKlines.push({
        openTime: k.openTime,
        closeTime: k.closeTime,
        open: o, high: h, low: l, close: c,
        volume: v, quoteVolume: qv,
        trades: k.trades,
        bodyPct,
        upperWickPct: (upperWick / o) * 100,
        lowerWickPct: (lowerWick / o) * 100,
        isGreen,
      })
    }

    // Move cursor past the last candle
    cursor = batch[batch.length - 1].closeTime + 1

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200))
  }

  return allKlines
}

/** Scan parsed klines for signal patterns and generate SignalEvent objects */
function scanKlinesForSignals(
  klines: ParsedKline[],
  pair: string,
  config: HistoricalScanConfig,
): SignalEvent[] {
  const volMult = config.volSpikeMult || 2.5
  const momPct = config.momentumMinPct || 0.5
  const cooldown = config.cooldownCandles || 12  // 1 hour default
  const sessionId = 'HISTORICAL_SCAN'

  const signals: SignalEvent[] = []
  let lastSignalCandle = -cooldown  // enforce cooldown

  if (klines.length < 50) return signals  // need at least 50 candles for indicators

  // Pre-compute rolling averages
  const VOL_LOOKBACK = 20
  const volAvgs: number[] = []
  for (let i = 0; i < klines.length; i++) {
    const start = Math.max(0, i - VOL_LOOKBACK)
    const slice = klines.slice(start, i + 1)
    const avg = slice.reduce((s, k) => s + k.volume, 0) / slice.length
    volAvgs.push(avg)
  }

  // Simple Bollinger Band (SMA 20, 2 std dev)
  const BB_PERIOD = 20
  const bbUpper: number[] = []
  const bbLower: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < BB_PERIOD - 1) { bbUpper.push(0); bbLower.push(0); continue }
    const slice = klines.slice(i - BB_PERIOD + 1, i + 1)
    const sma = slice.reduce((s, k) => s + k.close, 0) / BB_PERIOD
    const variance = slice.reduce((s, k) => s + (k.close - sma) ** 2, 0) / BB_PERIOD
    const std = Math.sqrt(variance)
    bbUpper.push(sma + 2 * std)
    bbLower.push(sma - 2 * std)
  }

  // RSI 14
  const RSI_PERIOD = 14
  const rsiValues: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < RSI_PERIOD) { rsiValues.push(50); continue }
    let gains = 0, losses = 0
    for (let j = i - RSI_PERIOD + 1; j <= i; j++) {
      const change = klines[j].close - klines[j - 1].close
      if (change > 0) gains += change; else losses += Math.abs(change)
    }
    const avgGain = gains / RSI_PERIOD
    const avgLoss = losses / RSI_PERIOD
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsiValues.push(100 - (100 / (1 + rs)))
  }

  // Scan each candle for patterns
  for (let i = BB_PERIOD; i < klines.length - 1; i++) {
    const k = klines[i]
    const volAvg = volAvgs[i]
    const volRatio = volAvg > 0 ? k.volume / volAvg : 1

    // Skip if in cooldown
    if (i - lastSignalCandle < cooldown) continue

    let signalType: CexAnomalySignalType | null = null
    let side: 'LONG' | 'SHORT' | null = null
    let confidence = 0

    // ── Pattern 1: Volume Spike + Directional ──
    // Large volume (>2.5x average) with directional candle → approximates TAKER_IMBALANCE / WHALE_INFLOW
    if (volRatio >= volMult && k.bodyPct >= 0.2) {
      side = k.isGreen ? 'LONG' : 'SHORT'
      confidence = Math.min(100, Math.round(volRatio * 25))

      if (volRatio >= volMult * 2) {
        // Extreme volume → LIQUIDATION_CASCADE
        signalType = 'LIQUIDATION_CASCADE'
      } else if (k.bodyPct >= 1.5) {
        // Big candle + high volume → TAKER_IMBALANCE
        signalType = 'TAKER_IMBALANCE'
      } else {
        // Just high volume → WHALE_INFLOW
        signalType = 'WHALE_INFLOW'
      }
    }

    // ── Pattern 2: Bollinger Band Breakout ──
    // Close above/below BB → approximates ORDERBOOK_IMBALANCE / BREAKOUT
    if (!signalType && bbUpper[i] > 0) {
      if (k.close > bbUpper[i] && k.bodyPct >= 0.3) {
        signalType = 'ORDERBOOK_IMBALANCE'
        side = 'LONG'
        confidence = Math.min(100, Math.round((k.close - bbUpper[i]) / bbUpper[i] * 10000))
      } else if (k.close < bbLower[i] && k.bodyPct >= 0.3) {
        signalType = 'ORDERBOOK_IMBALANCE'
        side = 'SHORT'
        confidence = Math.min(100, Math.round((bbLower[i] - k.close) / bbLower[i] * 10000))
      }
    }

    // ── Pattern 3: Momentum (3 consecutive directional candles) ──
    if (!signalType && i >= 2) {
      const k0 = klines[i - 2], k1 = klines[i - 1], k2 = k
      if (k0.isGreen && k1.isGreen && k2.isGreen &&
          k0.bodyPct >= momPct * 0.5 && k1.bodyPct >= momPct * 0.5 && k2.bodyPct >= momPct) {
        signalType = 'OI_VELOCITY'
        side = 'LONG'
        confidence = Math.min(100, Math.round((k0.bodyPct + k1.bodyPct + k2.bodyPct) * 15))
      } else if (!k0.isGreen && !k1.isGreen && !k2.isGreen &&
                 k0.bodyPct >= momPct * 0.5 && k1.bodyPct >= momPct * 0.5 && k2.bodyPct >= momPct) {
        signalType = 'OI_VELOCITY'
        side = 'SHORT'
        confidence = Math.min(100, Math.round((k0.bodyPct + k1.bodyPct + k2.bodyPct) * 15))
      }
    }

    // ── Pattern 4: RSI Overbought/Oversold ──
    if (!signalType && i >= RSI_PERIOD) {
      const rsi = rsiValues[i]
      if (rsi >= 75) {
        signalType = 'RSI_15M_OVERBOUGHT'
        side = 'SHORT'
        confidence = Math.min(100, Math.round((rsi - 50) * 2))
      } else if (rsi <= 25) {
        signalType = 'RSI_15M_OVERSOLD'
        side = 'LONG'
        confidence = Math.min(100, Math.round((50 - rsi) * 2))
      }
    }

    // ── Pattern 5: Reversal wick (long upper/lower wick) ──
    if (!signalType) {
      if (k.upperWickPct > k.bodyPct * 2 && k.upperWickPct > 0.5) {
        signalType = 'ICEBERG_REVERSAL'
        side = 'SHORT'
        confidence = Math.min(100, Math.round(k.upperWickPct * 30))
      } else if (k.lowerWickPct > k.bodyPct * 2 && k.lowerWickPct > 0.5) {
        signalType = 'ICEBERG_REVERSAL'
        side = 'LONG'
        confidence = Math.min(100, Math.round(k.lowerWickPct * 30))
      }
    }

    // ── Pattern 6: Volume + price dump (potential liquidation) ──
    if (!signalType && volRatio >= 2.0 && k.bodyPct >= 2.0) {
      signalType = 'LIQUIDATION_CASCADE'
      side = k.isGreen ? 'LONG' : 'SHORT'
      confidence = Math.min(100, Math.round(volRatio * 20 + k.bodyPct * 10))
    }

    if (signalType && side) {
      // Filter by requested signal types
      if (config.signalTypes && config.signalTypes.length > 0 && !config.signalTypes.includes(signalType)) {
        continue
      }

      lastSignalCandle = i

      signals.push({
        sessionId,
        timestamp: new Date(k.openTime).toISOString(),
        signalType,
        pair,
        side,
        entryPrice: k.close,
        exitPrice: 0,
        pnl: 0,
        pnlPct: 0,
        closeReason: 'TIMEOUT',
        leverage: 1,
        hurstAtEntry: 0,
        hcccoFastAtEntry: 0,
        hcccoSlowAtEntry: 0,
        confidenceScore: confidence,
        anomalyCategory: signalType,
        pointsDelta: 0,
        runningTotal: 0,
      })
    }
  }

  return signals
}

/** Main function: fetch historical klines and generate signals */
export async function scanHistoricalSignals(
  config: HistoricalScanConfig,
): Promise<SignalEvent[]> {
  const allSignals: SignalEvent[] = []
  const totalPairs = config.pairs.length

  for (let pIdx = 0; pIdx < config.pairs.length; pIdx++) {
    const pair = config.pairs[pIdx]
    const binanceSymbol = pairToBinanceSymbol(pair)

    config.onProgress?.(`Pobieranie świec: ${pair.split('-')[0]}`, pIdx, totalPairs)

    // Fetch historical klines
    const klines = await fetchHistoricalKlines(binanceSymbol, config.days)

    if (klines.length < 50) continue

    config.onProgress?.(`Skanowanie sygnałów: ${pair.split('-')[0]}`, pIdx, totalPairs)

    // Scan for signals
    const pairSignals = scanKlinesForSignals(klines, pair, config)
    allSignals.push(...pairSignals)

    // Delay between pairs
    if (pIdx < config.pairs.length - 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Sort by timestamp
  allSignals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return allSignals
}

/** Run full historical backtest: scan + simulate */
export async function runHistoricalBacktest(
  config: HistoricalScanConfig,
  leverage: number = 1,
  maxCandles: number = BACKTEST_CONFIG.MAX_CANDLES,
  capitalPerTrade: number = 100,
  onProgress?: (phase: string, completed: number, total: number) => void,
): Promise<BacktestResults> {
  // Phase 1: Generate signals
  const enhancedConfig = { ...config, onProgress }
  const signals = await scanHistoricalSignals(enhancedConfig)

  if (signals.length === 0) {
    return {
      trades: [],
      categoryStats: [],
      overallStats: {
        totalTrades: 0, wins: 0, losses: 0, timeouts: 0,
        winRate: 0, avgPnlPct: 0, totalPnlPct: 0, totalPnlUsd: 0, avgPnlUsd: 0,
        bestTradePct: 0, worstTradePct: 0, avgHoldMinutes: 0,
        profitFactor: 0, dataAvailable: 0, dataMissing: 0,
      },
      signalsUsed: 0,
      signalsSkipped: 0,
      runAt: Date.now(),
    }
  }

  // Phase 2: For historical signals, we already have klines loaded
  // But the standard backtest engine fetches them again — we can use it directly
  // since it already knows how to fetch klines per signal
  const result = await runMicrostructureBacktest(
    signals,
    leverage,
    (completed, total) => {
      onProgress?.('Backtest', completed, total)
    },
    maxCandles,
    capitalPerTrade,
  )

  return result
}
