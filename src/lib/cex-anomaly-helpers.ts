// ─── CEX Anomaly — Pure Helper Functions ─────────────────────────────────
// No React, no side effects — fully testable

import type { LiquidationBar, PairSimulation } from './cex-anomaly-types'
import { HEATMAP, BB_SIGNAL, TA_CONFIG } from './cex-anomaly-constants'

// ─── Weighted random pick ────────────────────────────────────────────────────

export function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatUsdLarge(v: number): string {
  if (v >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${v.toFixed(2)}`
}

export function formatPnl(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPrice(price: number, decimals: number): string {
  if (price >= 1) return `$${price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  return `$${price.toFixed(decimals || 4)}`
}

// ─── Unique ID ───────────────────────────────────────────────────────────────

let _idSeq = 0
export function uid(): string { return `cex-${++_idSeq}` }

/** Reset ID counter (useful for tests) */
export function _resetIdSeq(): void { _idSeq = 0 }

// ─── Liquidation Heatmap Generator ──────────────────────────────────────────

export function generateLiqBars(currentPrice: number, liqMult: number, count: number = HEATMAP.BAR_COUNT): LiquidationBar[] {
  const bars: LiquidationBar[] = []
  const step = currentPrice * HEATMAP.PRICE_STEP_FRACTION
  const halfCount = count / 2

  for (let i = 0; i < count; i++) {
    const offset = (i - halfCount + 0.5) * step
    const price = currentPrice + offset
    const distFromCenter = Math.abs(i - halfCount + 0.5) / halfCount
    const baseGauss = Math.exp(-distFromCenter * distFromCenter * HEATMAP.GAUSSIAN_DECAY)
    const spike = Math.random() > (1 - HEATMAP.SPIKE_PROBABILITY) ? (2 + Math.random() * 4) : 1
    const isBelow = i < halfCount

    bars.push({
      price,
      longLiq: isBelow
        ? baseGauss * (800 + Math.random() * 4000) * spike * liqMult
        : baseGauss * (200 + Math.random() * 600) * spike * liqMult * 0.3,
      shortLiq: !isBelow
        ? baseGauss * (800 + Math.random() * 4000) * spike * liqMult
        : baseGauss * (200 + Math.random() * 600) * spike * liqMult * 0.3,
    })
  }

  return bars
}

// ─── Real Liquidation Heatmap Generator ──────────────────────────────────────
// Builds liqBars from REAL Binance !forceOrder@arr liquidation events.
// Maps each liquidation to the nearest price bar and accumulates USD volume.
// Long liquidations (BUY side = longs rekt) accumulate into longLiq below price.
// Short liquidations (SELL side = shorts rekt) accumulate into shortLiq above price.
// Falls back to simulated data when no real liquidations are available.

export interface RealLiqEvent {
  symbol: string        // e.g. "BTCUSDT"
  side: 'BUY' | 'SELL' // BUY = long liquidated, SELL = short liquidated
  price: number
  quantity: number
  usd: number
  timestamp: number
}

export function generateLiqBarsFromReal(
  currentPrice: number,
  liqMult: number,
  realLiqs: RealLiqEvent[],
  pairBinanceSymbol: string, // e.g. "BTCUSDT" — filter events for this pair
  count: number = HEATMAP.BAR_COUNT,
): LiquidationBar[] {
  // Filter liquidations for this pair and within a reasonable time window (5 minutes)
  const now = Date.now()
  const WINDOW_MS = 5 * 60 * 1000
  const pairLiqs = realLiqs.filter(
    l => l.symbol === pairBinanceSymbol && (now - l.timestamp) < WINDOW_MS
  )

  // If no real liquidations for this pair, fall back to simulated data
  if (pairLiqs.length === 0) {
    return generateLiqBars(currentPrice, liqMult, count)
  }

  const bars: LiquidationBar[] = []
  const step = currentPrice * HEATMAP.PRICE_STEP_FRACTION
  const halfCount = count / 2

  // Create price bars centered on current price
  for (let i = 0; i < count; i++) {
    const offset = (i - halfCount + 0.5) * step
    const price = currentPrice + offset
    bars.push({ price, longLiq: 0, shortLiq: 0 })
  }

  // Map each liquidation event to the nearest bar
  // Use time-weighted decay: more recent events have more weight
  for (const liq of pairLiqs) {
    // Find nearest bar by price
    let nearestIdx = 0
    let nearestDist = Infinity
    for (let i = 0; i < bars.length; i++) {
      const dist = Math.abs(bars[i].price - liq.price)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    // Time decay: linear from 1.0 (now) to 0.2 (5 min ago)
    const age = now - liq.timestamp
    const timeWeight = 1.0 - 0.8 * (age / WINDOW_MS)

    // Apply liquidation volume to the nearest bar
    // Also spread to adjacent bars (Gaussian-like) for visual smoothness
    const weightedUsd = liq.usd * timeWeight

    // Direct bar
    if (liq.side === 'BUY') {
      // Long liquidation → longLiq (longs getting rekt → selling pressure)
      bars[nearestIdx].longLiq += weightedUsd
    } else {
      // Short liquidation → shortLiq (shorts getting rekt → buying pressure)
      bars[nearestIdx].shortLiq += weightedUsd
    }

    // Spread to adjacent bars (Gaussian kernel, σ = 1 bar)
    const spread = (idx: number, weight: number) => {
      if (idx < 0 || idx >= bars.length) return
      if (liq.side === 'BUY') {
        bars[idx].longLiq += weightedUsd * weight
      } else {
        bars[idx].shortLiq += weightedUsd * weight
      }
    }
    spread(nearestIdx - 1, 0.4)
    spread(nearestIdx + 1, 0.4)
    spread(nearestIdx - 2, 0.1)
    spread(nearestIdx + 2, 0.1)
  }

  // Add a small base level so the heatmap isn't completely empty in bars
  // that have no real liquidations (makes the heatmap readable)
  const maxLiq = Math.max(...bars.map(b => Math.max(b.longLiq, b.shortLiq)), 1)
  const baseLevel = maxLiq * 0.02 // 2% of max — just barely visible
  for (let i = 0; i < bars.length; i++) {
    const isBelow = i < halfCount
    if (bars[i].longLiq === 0) bars[i].longLiq = isBelow ? baseLevel : baseLevel * 0.3
    if (bars[i].shortLiq === 0) bars[i].shortLiq = !isBelow ? baseLevel : baseLevel * 0.3
  }

  return bars
}

// ─── Init simulation for a pair ─────────────────────────────────────────────

export function initPairSim(pair: { basePrice: number; liqMultiplier: number }): PairSimulation {
  return {
    price: pair.basePrice,
    cvd: 0,
    cvdBias: 0,
    cascadeTarget: null,
    cascadeTick: 0,
    liqBars: generateLiqBars(pair.basePrice, pair.liqMultiplier),
    cvdData: [],
    divergenceZones: [],
    // TA indicators
    priceHistory: [pair.basePrice],
    vwap: pair.basePrice,
    sma8: pair.basePrice,
    sma21: pair.basePrice,
    momentum: 0,
    momPeak: 0,
    // MACD (same timeframe as VWAP/SMA/MOM)
    macdLine: 0,
    macdSignal: 0,
    macdHistogram: 0,
    macdHistPrev: 0,
    // MACD 15m (computed from candle15mCloses — drives the virtual signal)
    macd15mLine: 0,
    macd15mSignal: 0,
    macd15mHistogram: 0,
    macd15mLinePrev: 0,
    macd15mSignalPrev: 0,
    // RSI (same timeframe as VWAP/SMA/MOM)
    rsi: 50,       // neutral
    rsiAvgGain: 0,
    rsiAvgLoss: 0,
    rsiWarmup: 0,
    // Bollinger Bands
    bbUpper: pair.basePrice,
    bbLower: pair.basePrice,
    // 15-minute candle RSI
    candle15mCloses: [],
    candle15mOpen: pair.basePrice,
    candle15mStartTs: 0,  // will be set on first tick
    rsi15m: 50,          // neutral
    rsi15mAvgGain: 0,
    rsi15mAvgLoss: 0,
    rsi15mWarmup: 0,
    rsi15mPrev: 50,
  }
}

// ─── Bollinger Bands Computation ──────────────────────────────────────────────
// Shared between Hurst+BB chart and BB_UPPER_TRIGGER signal generator
// Updated to use EMA basis (matching Pine Script ta.ema) with inner band support.

/** Compute EMA (Exponential Moving Average) over a price series */
export function computeEMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  if (prices.length === 0) return result
  const k = 2 / (period + 1)
  // First valid EMA at index period-1 = SMA of first 'period' values
  let sum = 0
  for (let i = 0; i < period && i < prices.length; i++) {
    result.push(null)
    sum += prices[i]
  }
  if (prices.length < period) return result
  result[period - 1] = sum / period
  for (let i = period; i < prices.length; i++) {
    result.push(prices[i] * k + (result[i - 1] ?? 0) * (1 - k))
  }
  return result
}

export interface BBResult {
  /** EMA basis line */
  ma: (number | null)[]
  /** Outer upper band (basis + stdDev × stdev) */
  upper: (number | null)[]
  /** Outer lower band (basis - stdDev × stdev) */
  lower: (number | null)[]
  /** Inner upper band (basis + innerStdDev × stdev) — optional */
  upperInner: (number | null)[]
  /** Inner lower band (basis - innerStdDev × stdev) — optional */
  lowerInner: (number | null)[]
}

export function computeBB(
  prices: number[],
  period: number = BB_SIGNAL.PERIOD,
  stdDev: number = BB_SIGNAL.STD_DEV,
  innerStdDev: number = 1.0,
): BBResult {
  const ma: (number | null)[] = []
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  const upperInner: (number | null)[] = []
  const lowerInner: (number | null)[] = []

  // Compute EMA basis
  const emaBasis = computeEMA(prices, period)

  for (let i = 0; i < prices.length; i++) {
    if (emaBasis[i] === null) {
      ma.push(null); upper.push(null); lower.push(null)
      upperInner.push(null); lowerInner.push(null)
      continue
    }
    const basis = emaBasis[i]!
    // Compute stdev over the same window as EMA period
    if (i < period - 1) {
      ma.push(null); upper.push(null); lower.push(null)
      upperInner.push(null); lowerInner.push(null)
      continue
    }
    const slice = prices.slice(i - period + 1, i + 1)
    const variance = slice.reduce((a, b) => a + (b - basis) ** 2, 0) / slice.length
    const std = Math.sqrt(variance)
    ma.push(basis)
    upper.push(basis + stdDev * std)
    lower.push(basis - stdDev * std)
    upperInner.push(basis + innerStdDev * std)
    lowerInner.push(basis - innerStdDev * std)
  }
  return { ma, upper, lower, upperInner, lowerInner }
}

// ─── MACD Computation (tick-by-tick, same timeframe as SMA/MOM/VWAP) ──────────
// Computes MACD from priceHistory using EMA(12), EMA(26), Signal=EMA(9).
// Returns the current MACD state for incremental update in the tick loop.
// All values are computed from the same priceHistory array used by SMA/MOM/VWAP.

export interface MACDState {
  macdLine: number
  macdSignal: number
  macdHistogram: number
  macdHistPrev: number
}

export function computeMACDFromHistory(
  priceHistory: number[],
  prevHist: number = 0,
  fastPeriod: number = TA_CONFIG.MACD_FAST,
  slowPeriod: number = TA_CONFIG.MACD_SLOW,
  signalPeriod: number = TA_CONFIG.MACD_SIGNAL,
): MACDState | null {
  // Need at least slowPeriod prices to compute the first EMA
  if (priceHistory.length < slowPeriod) return null

  // Compute EMA for a given period over priceHistory
  function ema(data: number[], period: number): number[] {
    const result: number[] = []
    const k = 2 / (period + 1)
    // First value = SMA of first 'period' data points
    let sum = 0
    for (let i = 0; i < period && i < data.length; i++) {
      sum += data[i]
    }
    result.push(sum / Math.min(period, data.length))
    for (let i = period; i < data.length; i++) {
      result.push(data[i] * k + result[i - period] * (1 - k))
    }
    return result
  }

  // Compute fast and slow EMA over the full priceHistory
  const fastEma = ema(priceHistory, fastPeriod)
  const slowEma = ema(priceHistory, slowPeriod)

  // MACD line = fast EMA - slow EMA (aligned from slowEma start)
  // fastEma starts at index 0, slowEma starts at index 0
  // But slowEma has valid data from slowPeriod-1 onward
  const macdLineArr: number[] = []
  const offset = slowPeriod - 1
  for (let i = 0; i < slowEma.length; i++) {
    const fastIdx = offset + i
    if (fastIdx < fastEma.length) {
      macdLineArr.push(fastEma[fastIdx] - slowEma[i])
    }
  }

  if (macdLineArr.length < signalPeriod) {
    // Not enough MACD values for signal line
    const macdLine = macdLineArr.length > 0 ? macdLineArr[macdLineArr.length - 1] : 0
    return {
      macdLine,
      macdSignal: macdLine,
      macdHistogram: 0,
      macdHistPrev: prevHist,
    }
  }

  // Signal line = EMA of MACD line
  const signalEma = ema(macdLineArr, signalPeriod)
  const macdLine = macdLineArr[macdLineArr.length - 1]
  const macdSignal = signalEma[signalEma.length - 1]
  const macdHistogram = macdLine - macdSignal

  return {
    macdLine,
    macdSignal,
    macdHistogram,
    macdHistPrev: prevHist,
  }
}

// ─── RSI Computation (tick-by-tick, same timeframe as SMA/MOM/VWAP) ──────────
// Uses Wilder's smoothed RSI with incremental update for efficiency.
// The RSI is computed from the same priceHistory array used by all other indicators.

export interface RSIState {
  rsi: number
  avgGain: number
  avgLoss: number
  warmup: number
}

export function computeRSIIncremental(
  prevPrice: number,
  newPrice: number,
  prevAvgGain: number,
  prevAvgLoss: number,
  warmup: number,
  period: number = TA_CONFIG.RSI_PERIOD,
): RSIState {
  const change = newPrice - prevPrice
  const gain = change > 0 ? change : 0
  const loss = change < 0 ? -change : 0

  const newWarmup = warmup + 1

  if (newWarmup <= period) {
    // Warmup phase: accumulate gains/losses for SMA-based initial average
    const avgGain = (prevAvgGain * warmup + gain) / newWarmup
    const avgLoss = (prevAvgLoss * warmup + loss) / newWarmup
    // During warmup, return neutral RSI (50)
    return { rsi: 50, avgGain, avgLoss, warmup: newWarmup }
  }

  // Wilder's smoothing: avgGain = (prevAvgGain * (period-1) + gain) / period
  const avgGain = (prevAvgGain * (period - 1) + gain) / period
  const avgLoss = (prevAvgLoss * (period - 1) + loss) / period

  if (avgLoss === 0) {
    return { rsi: 100, avgGain, avgLoss, warmup: newWarmup }
  }

  const rs = avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))

  return { rsi, avgGain, avgLoss, warmup: newWarmup }
}

// ─── Hurst Exponent (R/S method, simplified for real-time) ────────────────────
// Returns array of Hurst values (null where insufficient data)

export function computeHurst(prices: number[], period: number = BB_SIGNAL.HURST_PERIOD): (number | null)[] {
  const result: (number | null)[] = []

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { result.push(null); continue }

    const window = prices.slice(i - period + 1, i + 1)
    const logReturns: number[] = []
    for (let j = 1; j < window.length; j++) {
      if (window[j - 1] > 0 && window[j] > 0) {
        logReturns.push(Math.log(window[j] / window[j - 1]))
      }
    }
    if (logReturns.length < 16) { result.push(null); continue }

    // More granular sub-sizes for smoother Hurst curve — reduces "waving" artifacts
    // Old: [4,8,16,32] — only 4 points, very noisy regression
    // New: [4,6,8,12,16,24,32,48] — 8 points, much smoother R/S slope
    const subSizes = [4, 6, 8, 12, 16, 24, 32, 48].filter(s => s <= logReturns.length / 2)
    if (subSizes.length < 3) { result.push(null); continue }

    const rsValues: { logN: number; logRS: number; weight: number }[] = []
    for (const size of subSizes) {
      const numSubsets = Math.floor(logReturns.length / size)
      let totalRS = 0
      let validSubsets = 0
      for (let s = 0; s < numSubsets; s++) {
        const subset = logReturns.slice(s * size, (s + 1) * size)
        const mean = subset.reduce((a, b) => a + b, 0) / subset.length
        const cumDev: number[] = []
        let cumSum = 0
        for (const val of subset) { cumSum += val - mean; cumDev.push(cumSum) }
        const R = Math.max(...cumDev) - Math.min(...cumDev)
        let sumSqDiff = 0
        for (const val of subset) { sumSqDiff += (val - mean) ** 2 }
        const S = Math.sqrt(sumSqDiff / subset.length)
        if (S > 0 && R > 0) { totalRS += R / S; validSubsets++ }
      }
      if (validSubsets > 0) {
        const avgRS = totalRS / validSubsets
        if (avgRS > 0) {
          // Weight by sqrt(numSubsets) — larger subsets are more statistically reliable
          rsValues.push({ logN: Math.log(size), logRS: Math.log(avgRS), weight: Math.sqrt(validSubsets) })
        }
      }
    }

    if (rsValues.length >= 3) {
      // Weighted least squares — gives more weight to sub-sizes with more subsets
      let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWX2 = 0
      for (const pt of rsValues) {
        const w = pt.weight
        sumW += w
        sumWX += w * pt.logN
        sumWY += w * pt.logRS
        sumWXY += w * pt.logN * pt.logRS
        sumWX2 += w * pt.logN ** 2
      }
      const denominator = sumW * sumWX2 - sumWX ** 2
      if (denominator > 0) {
        const H = (sumW * sumWXY - sumWX * sumWY) / denominator
        // Allow natural values (can go below 0 or above 1) — needed for Hurst strategy
        // cross triggers: H crosses 0.0 from below = LONG, H crosses 1.0 from above = SHORT
        result.push(H)
      } else { result.push(null) }
    } else { result.push(null) }
  }
  return result
}

/**
 * Compute Hurst slope (dH/dt) — rate of change of Hurst exponent.
 * Positive = regime strengthening (trend or MR intensifying).
 * Negative = regime weakening (trend exhaustion or MR fading).
 * This is the KEY timing signal: H declining from high = trend exhaustion → reversal.
 */
export function computeHurstSlope(hurstValues: (number | null)[], lookback: number = 5): number[] {
  const result: number[] = []
  for (let i = 0; i < hurstValues.length; i++) {
    if (i < lookback) { result.push(0); continue }
    const current = hurstValues[i]
    const past = hurstValues[i - lookback]
    if (current === null || past === null) { result.push(0); continue }
    result.push(current - past)
  }
  return result
}

/**
 * HCCCO_LB Directional Signal — overvaluation/undervaluation from oscillator + BB.
 * Uses the HCCCO_LB (Hurst Cycle Channel Clone Oscillator by LazyBear):
 *   - fastOsc (oshort): price position in medium channel
 *   - slowOsc (omed): short-cycle median position in medium channel
 * 
 * Signals:
 * - OVERVALUED: fastOsc > 1.0 (above channel) or bear cross in upper zone → likely reversal DOWN
 * - UNDERVALUED: fastOsc < 0.0 (below channel) or bull cross in lower zone → likely reversal UP  
 * - TREND-UP: fastOsc rising from lower zone + price above MA → uptrend confirmed
 * - TREND-DOWN: fastOsc falling from upper zone + price below MA → downtrend confirmed
 * - EXHAUSTION: fastOsc was > 1.0, now dropping back → overbought exhaustion
 */
export type HurstSignalType = 'OVERVALUED' | 'UNDERVALUED' | 'TREND-UP' | 'TREND-DOWN' | 'EXHAUSTION' | 'NEUTRAL'

export interface HurstSignal {
  type: HurstSignalType
  /** Confidence 0-1: how strong the signal is */
  strength: number
  /** Current fastOsc (oshort) value (replaces Hurst exponent) */
  hurst: number
  /** fastOsc change over lookback (delta) */
  hurstSlope: number
  /** Price position relative to BB: 0 = at MA, 1 = at upper, -1 = at lower */
  bbPosition: number
  /** Human-readable description */
  description: string
}

export function computeHurstSignal(
  prices: number[],
  hurstValues: (number | null)[],
  bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] },
  slopeLookback: number = 5,
  hcccoData?: { fastOsc: number[]; slowOsc: number[] },
): HurstSignal {
  const neutral: HurstSignal = {
    type: 'NEUTRAL', strength: 0, hurst: 0.5, hurstSlope: 0, bbPosition: 0,
    description: 'No clear signal',
  }

  const n = prices.length
  if (n < 20) return neutral

  const lastIdx = n - 1

  // If HCCCO data is available, use fastOsc (oshort) instead of Hurst exponent
  const fastOsc = hcccoData ? hcccoData.fastOsc : null
  const slowOsc = hcccoData ? hcccoData.slowOsc : null

  // Use fastOsc as the "hurst" value (replaces Hurst exponent in the signal)
  // fastOsc range: <0 = oversold, 0-1 = normal, >1 = overbought
  const h = fastOsc ? fastOsc[lastIdx] ?? 0.5 : (hurstValues[lastIdx] ?? 0.5)

  const bbUpper = bb.upper[lastIdx]
  const bbLower = bb.lower[lastIdx]
  const bbMA = bb.ma[lastIdx]
  if (bbUpper === null || bbLower === null || bbMA === null) return neutral

  const price = prices[lastIdx]

  // Compute oscillator slope (delta over lookback)
  const slopeLookbackIdx = Math.max(0, lastIdx - slopeLookback)
  const hPast = fastOsc
    ? fastOsc[slopeLookbackIdx] ?? 0.5
    : (hurstValues[slopeLookbackIdx] ?? 0.5)
  const hSlope = h - hPast

  // Price position relative to BB: -1 (lower) to +1 (upper)
  const bbRange = bbUpper - bbLower
  const bbPos = bbRange > 0 ? ((price - bbMA) / (bbRange / 2)) : 0

  // Get previous fastOsc for crossover detection
  const prevFast = fastOsc && lastIdx >= 1 ? fastOsc[lastIdx - 1] : null
  const prevSlow = slowOsc && lastIdx >= 1 ? slowOsc[lastIdx - 1] : null
  const curSlow = slowOsc ? slowOsc[lastIdx] : null

  // ─── HCCCO-based Signal Logic ───

  // OVERVALUED: fastOsc > 1.0 (price above medium channel top) → overbought
  if (h > 1.0) {
    const strength = Math.min(1, (h - 1.0) * 2 + 0.3)
    return { type: 'OVERVALUED', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Overvalued: oshort=${h.toFixed(2)} > 1.0 (above channel) → reversal down` }
  }

  // UNDERVALUED: fastOsc < 0.0 (price below medium channel bottom) → oversold
  if (h < 0.0) {
    const strength = Math.min(1, Math.abs(h) * 2 + 0.3)
    return { type: 'UNDERVALUED', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Undervalued: oshort=${h.toFixed(2)} < 0.0 (poniżej kanału) → odwrócenie w górę` }
  }

  // EXHAUSTION: fastOsc was above 1.0 recently, now falling back (overbought exhaustion)
  if (hSlope < -0.04 && h > 0.7 && h < 1.1) {
    const strength = Math.min(1, Math.abs(hSlope) / 0.08)
    const direction = price > bbMA ? 'UP' : 'DOWN'
    return { type: 'EXHAUSTION', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Wyczerpanie: oshort spada of ekstremum (${direction}) → trend ${direction === 'UP' ? 'wzrostowy' : 'spadkowy'} umiera` }
  }

  // Bear cross in upper zone: fast crosses below slow when fast > 0.5 → bearish
  if (prevFast !== null && prevSlow !== null && curSlow !== null) {
    if (prevFast >= prevSlow && h < curSlow && h > 0.5) {
      const strength = Math.min(1, (h - 0.5) * 1.5 + 0.2)
      return { type: 'OVERVALUED', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
        description: `Overvalued: bear cross in upper zone (fast=${h.toFixed(2)} < slow=${curSlow.toFixed(2)})` }
    }
  }

  // Bull cross in lower zone: fast crosses above slow when fast < 0.5 → bullish
  if (prevFast !== null && prevSlow !== null && curSlow !== null) {
    if (prevFast <= prevSlow && h > curSlow && h < 0.5) {
      const strength = Math.min(1, (0.5 - h) * 1.5 + 0.2)
      return { type: 'UNDERVALUED', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
        description: `Undervalued: bull cross in lower zone (fast=${h.toFixed(2)} > slow=${curSlow.toFixed(2)})` }
    }
  }

  // TREND-UP: fastOsc rising from lower zone + price above MA → uptrend
  if (hSlope > 0.02 && h > 0.3 && price > bbMA) {
    const strength = Math.min(1, hSlope / 0.05 + 0.1)
    return { type: 'TREND-UP', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Uptrend: oshort rising (${(hSlope >= 0 ? '+' : '')}${(hSlope * 100).toFixed(1)}%) → continuation` }
  }

  // TREND-DOWN: fastOsc falling from upper zone + price below MA → downtrend
  if (hSlope < -0.02 && h < 0.7 && price < bbMA) {
    const strength = Math.min(1, Math.abs(hSlope) / 0.05 + 0.1)
    return { type: 'TREND-DOWN', strength, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Trend spadkowy: oshort spada (${(hSlope * 100).toFixed(1)}%) → continuation` }
  }

  // Neutral with context
  if (h < 0.3) {
    return { type: 'NEUTRAL', strength: 0, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Lower HCCCO zone (oshort=${h.toFixed(2)}) — waiting for signal` }
  }
  if (h > 0.7) {
    return { type: 'NEUTRAL', strength: 0, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
      description: `Upper HCCCO zone (oshort=${h.toFixed(2)}) — waiting for signal` }
  }

  return { type: 'NEUTRAL', strength: 0, hurst: h, hurstSlope: hSlope, bbPosition: bbPos,
    description: `HCCCO neutralne (oshort≈${h.toFixed(2)}) — brak jasnego kierunku` }
}

/**
 * Check if price is above upper Bollinger Band with mean-reverting Hurst.
 * Returns null if insufficient data, or { exceeded: boolean, hurst: number | null, bbUpper: number | null }
 */
// ─── HCCCO_LB — Hurst Cycle Channel Clone Oscillator [LazyBear] ───────────────
// Ported from TradingView Pine Script by LazyBear.
// Two nested Keltner Channels using Wilder's smoothing (RMA):
//   Short Cycle:  RMA(src, scl/2) ± short_mult × ATR(scl/2)
//   Medium Cycle: RMA(src, mcl/2) ± med_mult × ATR(mcl/2)
// Oscillator normalizes price position within the medium channel (0–1 scale).
// Signals: oshort < 0 = oversold, oshort > 1 = overbought,
//          fast/slow crossovers = momentum shifts.

/**
 * Wilder's Running Moving Average (RMA) — same as Pine Script's rma().
 * RMA(src, period) = (src + (period-1) * RMA[1]) / period
 * Equivalent to EMA with alpha = 1/period.
 */
export function computeRMA(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const alpha = 1 / period
  const result: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1])
  }
  return result
}

/**
 * Average True Range (ATR) using Wilder's smoothing.
 * Since we only have close prices (no OHLC), we approximate True Range
 * as |close[i] - close[i-1]| (which equals TR when no gaps exist).
 * Uses RMA for smoothing (Wilder's standard ATR method).
 */
export function computeATR(prices: number[], period: number): number[] {
  if (prices.length === 0) return []
  const tr: number[] = [0] // first bar has no TR
  for (let i = 1; i < prices.length; i++) {
    tr.push(Math.abs(prices[i] - prices[i - 1]))
  }
  return computeRMA(tr, period)
}

export interface HCCCOResult {
  /** Fast oscillator (oshort): price normalized within medium channel (0–1) */
  fastOsc: number[]
  /** Slow oscillator (omed): short cycle median normalized within medium channel (0–1) */
  slowOsc: number[]
  /** Short cycle top band (price) */
  scTop: (number | null)[]
  /** Short cycle bottom band (price) */
  scBot: (number | null)[]
  /** Medium cycle top band (price) */
  mcTop: (number | null)[]
  /** Medium cycle bottom band (price) */
  mcBot: (number | null)[]
  /** Short cycle median (price) */
  scMedian: (number | null)[]
}

/**
 * Hurst Cycle Channel Clone Oscillator — LazyBear's TradingView indicator.
 *
 * @param prices  Close price series
 * @param shortCycleLen  Short cycle length (default 10)
 * @param medCycleLen    Medium cycle length (default 30)
 * @param shortMult      Short cycle ATR multiplier (default 1.0)
 * @param medMult        Medium cycle ATR multiplier (default 2.0)
 */
export function computeHCCCO(
  prices: number[],
  shortCycleLen: number = 10,
  medCycleLen: number = 30,
  shortMult: number = 1.0,
  medMult: number = 3.0,
): HCCCOResult {
  const n = prices.length
  const scl = Math.floor(shortCycleLen / 2)  // short cycle half
  const mcl = Math.floor(medCycleLen / 2)    // medium cycle half
  const scl2 = Math.floor(scl / 2)           // short cycle lookback offset
  const mcl2 = Math.floor(mcl / 2)           // medium cycle lookback offset

  // Compute RMAs and ATRs
  const maSCL = computeRMA(prices, scl)
  const maMCL = computeRMA(prices, mcl)
  const atrSCL = computeATR(prices, scl)
  const atrMCL = computeATR(prices, mcl)

  const scTop: (number | null)[] = []
  const scBot: (number | null)[] = []
  const mcTop: (number | null)[] = []
  const mcBot: (number | null)[] = []
  const scMedian: (number | null)[] = []
  const fastOsc: number[] = []
  const slowOsc: number[] = []

  for (let i = 0; i < n; i++) {
    // Short cycle channels — need lookback offset for centering
    if (i >= scl2) {
      const baseSCL = maSCL[i - scl2]
      const offset = shortMult * atrSCL[i]
      scTop.push(baseSCL + offset)
      scBot.push(baseSCL - offset)
    } else {
      scTop.push(null)
      scBot.push(null)
    }

    // Medium cycle channels — need lookback offset for centering
    if (i >= mcl2) {
      const baseMCL = maMCL[i - mcl2]
      const offset = medMult * atrMCL[i]
      mcTop.push(baseMCL + offset)
      mcBot.push(baseMCL - offset)
    } else {
      mcTop.push(null)
      mcBot.push(null)
    }

    // Compute oscillator values only when medium channel is available
    if (mcTop[i] !== null && mcBot[i] !== null) {
      const mct = mcTop[i]!
      const mcb = mcBot[i]!
      const range = mct - mcb

      // Short cycle median
      const scMed = scTop[i] !== null && scBot[i] !== null
        ? (scTop[i]! + scBot[i]!) / 2
        : null
      scMedian.push(scMed)

      if (range > 0) {
        // Slow oscillator: short cycle median position within medium channel
        slowOsc.push(scMed !== null ? (scMed - mcb) / range : 0.5)
        // Fast oscillator: current price position within medium channel
        fastOsc.push((prices[i] - mcb) / range)
      } else {
        slowOsc.push(0.5)
        fastOsc.push(0.5)
      }
    } else {
      scMedian.push(null)
      fastOsc.push(0.5)
      slowOsc.push(0.5)
    }
  }

  return { fastOsc, slowOsc, scTop, scBot, mcTop, mcBot, scMedian }
}

export type HCCCOSignalType = 'OVERBOUGHT' | 'OVERSOLD' | 'BULL_CROSS' | 'BEAR_CROSS' | 'OS_CROSS_UP' | 'OB_CROSS_DOWN' | 'NEUTRAL'

export interface HCCCOSignal {
  type: HCCCOSignalType
  /** Current fast oscillator (oshort) value */
  fastVal: number
  /** Current slow oscillator (omed) value */
  slowVal: number
  /** Confidence 0-1 */
  strength: number
  /** Human-readable description */
  description: string
}

/**
 * Generate signal from HCCCO oscillator values.
 * - OVERBOUGHT: fastOsc > 1.0 (price above medium channel top)
 * - OVERSOLD:   fastOsc < 0.0 (price below medium channel bottom)
 * - BULL_CROSS: fastOsc crosses above slowOsc from below (in lower zone <0.5)
 * - BEAR_CROSS: fastOsc crosses below slowOsc from above (in upper zone >0.5)
 * - OS_CROSS_UP: fastOsc crosses above 0.0 from below (was <0, now >0) — LONG trigger
 * - OB_CROSS_DOWN: fastOsc crosses below 1.0 from above (was >1, now <1) — SHORT trigger
 */
export function computeHCCCOSignal(
  fastOsc: number[],
  slowOsc: number[],
): HCCCOSignal {
  const neutral: HCCCOSignal = {
    type: 'NEUTRAL', fastVal: 0.5, slowVal: 0.5, strength: 0,
    description: 'No HCCCO signal',
  }

  const n = fastOsc.length
  if (n < 2) return neutral

  const fast = fastOsc[n - 1]
  const slow = slowOsc[n - 1]
  const fastPrev = fastOsc[n - 2]
  const slowPrev = slowOsc[n - 2]

  // OVERBOUGHT: price above medium channel top (fast > 1.0)
  if (fast >= 1.0) {
    const strength = Math.min(1, (fast - 1.0) * 2 + 0.3)
    // Check for OB_CROSS_DOWN: was >1.0 last bar, now <1.0 — but we're still >=1.0 here,
    // so this condition catches the "still overbought" state
    return {
      type: 'OVERBOUGHT', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO Overvalued: oshort=${fast.toFixed(2)} > 1.0 → possible drop`,
    }
  }

  // OVERSOLD: price below medium channel bottom (fast < 0.0)
  if (fast <= 0.0) {
    const strength = Math.min(1, Math.abs(fast) * 2 + 0.3)
    return {
      type: 'OVERSOLD', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO Undervalued: oshort=${fast.toFixed(2)} < 0.0 → possible rise`,
    }
  }

  // OS_CROSS_UP: fast crosses above 0.0 from below — LONG trigger
  // Previous bar was below 0.0 (oversold), current bar is above 0.0
  if (fastPrev < 0.0 && fast >= 0.0) {
    const strength = Math.min(1, Math.abs(fastPrev) * 2 + 0.4)
    return {
      type: 'OS_CROSS_UP', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO OS 0.0 breakout ↑: oshort of ${fastPrev.toFixed(2)} on ${fast.toFixed(2)} → LONG signal`,
    }
  }

  // OB_CROSS_DOWN: fast crosses below 1.0 from above — SHORT trigger
  // Previous bar was above 1.0 (overbought), current bar is below 1.0
  if (fastPrev > 1.0 && fast <= 1.0) {
    const strength = Math.min(1, (fastPrev - 1.0) * 2 + 0.4)
    return {
      type: 'OB_CROSS_DOWN', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO OB 1.0 breakout ↓: oshort of ${fastPrev.toFixed(2)} on ${fast.toFixed(2)} → SHORT signal`,
    }
  }

  // BULL_CROSS: fast crosses above slow in lower zone
  if (fastPrev <= slowPrev && fast > slow && fast < 0.5) {
    const strength = Math.min(1, (0.5 - fast) * 1.5 + 0.2)
    return {
      type: 'BULL_CROSS', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO Bullish crossover: fast (${fast.toFixed(2)}) crosses slow in lower zone`,
    }
  }

  // BEAR_CROSS: fast crosses below slow in upper zone
  if (fastPrev >= slowPrev && fast < slow && fast > 0.5) {
    const strength = Math.min(1, (fast - 0.5) * 1.5 + 0.2)
    return {
      type: 'BEAR_CROSS', fastVal: fast, slowVal: slow, strength,
      description: `HCCCO Bearish crossover: fast (${fast.toFixed(2)}) crosses slow in upper zone`,
    }
  }

  return {
    type: 'NEUTRAL', fastVal: fast, slowVal: slow, strength: 0,
    description: `HCCCO oshort=${fast.toFixed(2)} omed=${slow.toFixed(2)} — strefa neutralna`,
  }
}

export function checkBBUpperSignal(prices: number[]): { exceeded: boolean; hurst: number | null; bbUpper: number | null; exceedPct: number } | null {
  if (prices.length < BB_SIGNAL.MIN_DATA_POINTS) return null

  const bb = computeBB(prices)
  const hurst = computeHurst(prices)

  const lastIdx = prices.length - 1
  const bbUpper = bb.upper[lastIdx]
  const h = hurst[lastIdx]
  const price = prices[lastIdx]

  if (bbUpper === null || h === null) return null

  const exceedPct = ((price - bbUpper) / bbUpper) * 100
  const exceeded = price > bbUpper
    && h < BB_SIGNAL.HURST_MEAN_REV_THRESHOLD
    && exceedPct >= BB_SIGNAL.MIN_EXCEED_PCT

  return { exceeded, hurst: h, bbUpper, exceedPct }
}

// ─── Hurst Dual-Trigger Strategy Signals ─────────────────────────────────────
// Strategy requires BOTH triggers to fire (AND condition, order doesn't matter):
//
// LONG:
//   Trigger 1 (BB): Price touches or crosses below the lower BB band
//   Trigger 2 (Hurst): Hurst crosses above 0.00 from below (H[i-1] < 0.0 && H[i] >= 0.0)
//
// SHORT:
//   Trigger 1 (BB): Price touches or crosses above the upper BB band
//   Trigger 2 (Hurst): Hurst crosses below 1.00 from above (H[i-1] > 1.0 && H[i] <= 1.0)
//
// Both triggers must be active within a lookback window (default 10 bars).
// The trigger that fires second "confirms" the first one.

export type HurstStrategySignalType = 'LONG' | 'SHORT' | 'NONE'

export interface HurstStrategyTrigger {
  /** Which trigger fired */
  type: 'BB_LOWER' | 'BB_UPPER' | 'HURST_CROSS_UP' | 'HURST_CROSS_DOWN'
  /** Bar index where it fired */
  barIndex: number
  /** Price at that bar */
  price: number
  /** Hurst value at that bar */
  hurst: number | null
  /** Description */
  description: string
}

export interface HurstStrategySignal {
  type: HurstStrategySignalType
  /** The triggers that confirmed each other */
  triggers: HurstStrategyTrigger[]
  /** Signal strength 0-1 */
  strength: number
  /** Bar index where signal is confirmed */
  confirmedAtBar: number
  /** Price at confirmation */
  confirmedAtPrice: number
  /** Description */
  description: string
  /** Entry step: 1=first entry (BB lower), 2=averaging (Hurst crosses 0.0 up), 3=2nd averaging */
  entryStep: number
  /** Position size multiplier: 1 for step 1, 2 for step 2, 4 for step 3 */
  sizeMultiplier: number
  /** Trade group ID — links entries 1/2/3 of the same trade together */
  tradeGroupId: number
}

/**
 * New Hurst Strategy: 3-entry averaging LONG system
 *
 * Entry 1 (base size 1x): Price touches lower Bollinger Band
 * Entry 2 (size 2x): Hurst crosses UP through 0.0 (averaging down)
 * Entry 3 (size 4x): Hurst crosses UP through 0.0 again (2nd averaging)
 *
 * Exit ALL: Hurst crosses DOWN through 1.0 (from above)
 *
 * No SHORT side — this is a long-only averaging strategy.
 *
 * @param prices    Close price series
 * @param hurst     Hurst exponent series (same length as prices)
 * @param bb        Bollinger Bands result
 * @param lookback  Unused (kept for API compat), strategy is sequential
 */
export function computeHurstStrategySignals(
  prices: number[],
  hurst: (number | null)[],
  bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] },
  _lookback: number = 10,
): HurstStrategySignal[] {
  const signals: HurstStrategySignal[] = []
  const n = prices.length
  if (n < 2) return signals

  // ── State machine for sequential entry/exit logic ──
  // idle → entry1 (BB lower touch) → entry2 (Hurst cross up 0.0) → entry3 (Hurst cross up 0.0 again)
  // ANY state → closed (Hurst crosses down 1.0)
  type Phase = 'IDLE' | 'ENTRY1_DONE' | 'ENTRY2_DONE' | 'ENTRY3_DONE'
  let phase: Phase = 'IDLE'
  let tradeGroupId = 0

  for (let i = 1; i < n; i++) {
    const price = prices[i]
    const h = hurst[i]
    const prevH = hurst[i - 1]
    const bbLower = bb.lower[i]

    // ── EXIT condition: Hurst crosses DOWN through 1.0 ──
    // This closes ALL entries (1+2+3) at once
    if (prevH !== null && h !== null && prevH > 1.0 && h <= 1.0) {
      if (phase !== 'IDLE') {
        signals.push({
          type: 'LONG',
          triggers: [{
            type: 'HURST_CROSS_DOWN',
            barIndex: i,
            price,
            hurst: h,
            description: `EXIT: Hurst ↓1.00 — H of ${prevH.toFixed(3)} on ${h.toFixed(3)}`,
          }],
          strength: 1.0,
          confirmedAtBar: i,
          confirmedAtPrice: price,
          description: `CLOSE ALL: Hurst przebicie 1.00 ↓`,
          entryStep: 0, // 0 = exit signal
          sizeMultiplier: 0,
          tradeGroupId,
        })
        phase = 'IDLE'
      }
      continue
    }

    // ── ENTRY 1: Price touches lower BB ──
    if (phase === 'IDLE' && bbLower !== null && price <= bbLower) {
      tradeGroupId++
      signals.push({
        type: 'LONG',
        triggers: [{
          type: 'BB_LOWER',
          barIndex: i,
          price,
          hurst: h,
          description: `ENTRY 1 (1x): BB dolna — cena ${price.toFixed(2)} ≤ ${bbLower.toFixed(2)}`,
        }],
        strength: 0.6,
        confirmedAtBar: i,
        confirmedAtPrice: price,
        description: `ENTRY 1 (1x): BB lower touch`,
        entryStep: 1,
        sizeMultiplier: 1,
        tradeGroupId,
      })
      phase = 'ENTRY1_DONE'
      continue
    }

    // ── ENTRY 2: Hurst crosses UP through 0.0 (averaging down) ──
    if (phase === 'ENTRY1_DONE' && prevH !== null && h !== null && prevH < 0.0 && h >= 0.0) {
      signals.push({
        type: 'LONG',
        triggers: [{
          type: 'HURST_CROSS_UP',
          barIndex: i,
          price,
          hurst: h,
          description: `ENTRY 2 (2x): Hurst ↑0.00 — H of ${prevH.toFixed(3)} on ${h.toFixed(3)}`,
        }],
        strength: 0.8,
        confirmedAtBar: i,
        confirmedAtPrice: price,
        description: `ENTRY 2 (2x): Hurst breakout 0.00 ↑ — averaging`,
        entryStep: 2,
        sizeMultiplier: 2,
        tradeGroupId,
      })
      phase = 'ENTRY2_DONE'
      continue
    }

    // ── ENTRY 3: Hurst crosses UP through 0.0 again (2nd averaging) ──
    if (phase === 'ENTRY2_DONE' && prevH !== null && h !== null && prevH < 0.0 && h >= 0.0) {
      signals.push({
        type: 'LONG',
        triggers: [{
          type: 'HURST_CROSS_UP',
          barIndex: i,
          price,
          hurst: h,
          description: `ENTRY 3 (4x): Hurst ↑0.00 — H of ${prevH.toFixed(3)} on ${h.toFixed(3)}`,
        }],
        strength: 1.0,
        confirmedAtBar: i,
        confirmedAtPrice: price,
        description: `ENTRY 3 (4x): Hurst breakout 0.00 ↑ — 2nd averaging`,
        entryStep: 3,
        sizeMultiplier: 4,
        tradeGroupId,
      })
      phase = 'ENTRY3_DONE'
      continue
    }
  }

  return signals
}

/**
 * Get the latest strategy signal for live trading.
 * Returns the most recent signal if it's within the last `lookback` bars.
 */
export function getLatestHurstStrategySignal(
  prices: number[],
  hurst: (number | null)[],
  bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] },
  lookback: number = 10,
): HurstStrategySignal | null {
  const allSignals = computeHurstStrategySignals(prices, hurst, bb, lookback)
  if (allSignals.length === 0) return null
  // Return the latest signal only if it's within the last `lookback` bars
  const latest = allSignals[allSignals.length - 1]
  const lastBar = prices.length - 1
  if (lastBar - latest.confirmedAtBar > lookback) return null
  return latest
}

/**
 * Get the current strategy phase for live trading.
 * Replays all signals to determine where we are in the state machine.
 */
export function getHurstStrategyPhase(
  prices: number[],
  hurst: (number | null)[],
  bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] },
): { phase: 'IDLE' | 'ENTRY1_DONE' | 'ENTRY2_DONE' | 'ENTRY3_DONE'; tradeGroupId: number; lastSignal: HurstStrategySignal | null } {
  const signals = computeHurstStrategySignals(prices, hurst, bb)
  let phase: 'IDLE' | 'ENTRY1_DONE' | 'ENTRY2_DONE' | 'ENTRY3_DONE' = 'IDLE'
  let tradeGroupId = 0
  let lastSignal: HurstStrategySignal | null = null

  for (const sig of signals) {
    lastSignal = sig
    if (sig.entryStep === 0) {
      // Exit signal
      phase = 'IDLE'
    } else if (sig.entryStep === 1) {
      tradeGroupId = sig.tradeGroupId
      phase = 'ENTRY1_DONE'
    } else if (sig.entryStep === 2) {
      phase = 'ENTRY2_DONE'
    } else if (sig.entryStep === 3) {
      phase = 'ENTRY3_DONE'
    }
  }

  return { phase, tradeGroupId, lastSignal }
}

// ─── Hurst Strategy Backtest Engine (3-entry averaging) ────────────────────────

export interface BacktestTrade {
  /** Trade side */
  side: 'LONG' | 'SHORT'
  /** Entry bar index (first entry) */
  entryBar: number
  /** Exit bar index */
  exitBar: number
  /** Weighted average entry price across all entries (1x + 2x + 4x) */
  entryPrice: number
  /** Exit price */
  exitPrice: number
  /** Gross P&L % (before fees) — weighted by position sizes */
  pnlPct: number
  /** Net P&L % (after fees) */
  netPnlPct: number
  /** Trade fee as % of total position */
  feePct: number
  /** Exit reason */
  exitReason: 'HURST_EXIT_1.0' | 'SL' | 'TP' | 'END_OF_DATA'
  /** Hurst value at first entry */
  hurstAtEntry: number | null
  /** BB position at first entry (-1 to 1) */
  bbPositionAtEntry: number
  /** Number of bars held (from first entry to exit) */
  barsHeld: number
  /** Timestamp (if available) */
  timestamp?: number
  /** Which entries were filled: 1, 2, or 3 entries */
  entryCount: number
  /** Total size multiplier: 1x for 1 entry, 3x for 2 entries (1+2), 7x for 3 entries (1+2+4) */
  totalSizeMultiplier: number
  /** Trade group ID */
  tradeGroupId: number
}

export interface BacktestResult {
  /** All trades */
  trades: BacktestTrade[]
  /** Total number of trades */
  totalTrades: number
  /** Win rate */
  winRate: number
  /** Total net P&L % */
  totalPnlPct: number
  /** Average P&L per trade % */
  avgPnlPct: number
  /** Best trade % */
  bestTradePct: number
  /** Worst trade % */
  worstTradePct: number
  /** Max drawdown % */
  maxDrawdownPct: number
  /** Sharpe ratio (simplified) */
  sharpeRatio: number
  /** Profit factor */
  profitFactor: number
  /** Average bars held */
  avgBarsHeld: number
  /** Long trades count */
  longTrades: number
  /** Short trades count */
  shortTrades: number
  /** Long win rate */
  longWinRate: number
  /** Short win rate */
  shortWinRate: number
  /** Equity curve (cumulative P&L % at each bar) */
  equityCurve: number[]
  /** Number of signals that were generated */
  totalSignals: number
  /** BB lower touches */
  bbTouchCount: number
  /** Hurst crosses (0.0 up + 1.0 down) */
  hurstCrossCount: number
  /** How many trades had 1/2/3 entries */
  singleEntryTrades: number
  doubleEntryTrades: number
  tripleEntryTrades: number
}

/**
 * Run backtest of the 3-entry averaging Hurst strategy on historical data.
 *
 * Entry 1 (1x): Price touches lower BB
 * Entry 2 (2x): Hurst crosses UP through 0.0
 * Entry 3 (4x): Hurst crosses UP through 0.0 again
 * Exit ALL: Hurst crosses DOWN through 1.0
 *
 * P&L is weighted by position sizes: total exposure = 1+2+4 = 7x base
 * Weighted avg entry = (1*p1 + 2*p2 + 4*p3) / 7
 */
export function runHurstStrategyBacktest(
  closes: number[],
  timestamps?: number[],
  bbPeriod: number = 34,
  bbStdDev: number = 2.0,
  hurstPeriod: number = 50,
  _triggerLookback: number = 10,
  slPct: number = 5.0,
  tpPct: number = 10.0,
  feePct: number = 0.10,
  leverage: number = 1,
): BacktestResult {
  const n = closes.length
  const trades: BacktestTrade[] = []
  const equityCurve: number[] = new Array(n).fill(0)

  // Compute indicators for entire series
  const bb = computeBB(closes, bbPeriod, bbStdDev, 1.0)
  const hurst = computeHurst(closes, hurstPeriod)
  const signals = computeHurstStrategySignals(closes, hurst, bb, _triggerLookback)

  let cumulativePnl = 0

  // Track a composite position: multiple entries that exit together
  interface ActiveEntry { barIndex: number; price: number; sizeMultiplier: number; step: number }
  let activePosition: {
    groupId: number
    entries: ActiveEntry[]
    totalMultiplier: number
  } | null = null

  let signalIdx = 0

  // Count trigger events
  let bbTouchCount = 0
  let hurstCrossCount = 0
  for (let i = 1; i < n; i++) {
    const bbLower = bb.lower[i]
    const price = closes[i]
    const h = hurst[i]
    const prevH = hurst[i - 1]
    if (bbLower !== null && price <= bbLower) bbTouchCount++
    if (prevH !== null && h !== null && prevH < 0.0 && h >= 0.0) hurstCrossCount++
    if (prevH !== null && h !== null && prevH > 1.0 && h <= 1.0) hurstCrossCount++
  }

  for (let i = 0; i < n; i++) {
    const price = closes[i]

    // ── Process signals at this bar ──
    while (signalIdx < signals.length && signals[signalIdx].confirmedAtBar === i) {
      const sig = signals[signalIdx]

      if (sig.entryStep === 0) {
        // EXIT signal: close all entries
        if (activePosition) {
          const totalMult = activePosition.totalMultiplier
          const weightedEntry = activePosition.entries.reduce((s, e) => s + e.price * e.sizeMultiplier, 0) / totalMult
          const entryBar = activePosition.entries[0].barIndex
          const grossPnlPct = (price - weightedEntry) / weightedEntry * 100 * leverage * totalMult
          const totalFeePct = feePct * activePosition.entries.length
          const netPnlPct = grossPnlPct - totalFeePct
          cumulativePnl += netPnlPct

          trades.push({
            side: 'LONG',
            entryBar,
            exitBar: i,
            entryPrice: weightedEntry,
            exitPrice: price,
            pnlPct: grossPnlPct,
            netPnlPct,
            feePct: totalFeePct,
            exitReason: 'HURST_EXIT_1.0',
            hurstAtEntry: hurst[entryBar],
            bbPositionAtEntry: (() => {
              const bbMA = bb.ma[entryBar]; const bbU = bb.upper[entryBar]; const bbL = bb.lower[entryBar]
              return bbMA !== null && bbU !== null && bbL !== null
                ? (bbU - bbL) > 0 ? ((closes[entryBar] - bbMA) / ((bbU - bbL) / 2)) : 0 : 0
            })(),
            barsHeld: i - entryBar,
            timestamp: timestamps?.[i],
            entryCount: activePosition.entries.length,
            totalSizeMultiplier: totalMult,
            tradeGroupId: activePosition.groupId,
          })
          activePosition = null
        }
      } else if (sig.entryStep >= 1 && sig.entryStep <= 3) {
        // ENTRY signal: add to position (or start new one)
        if (!activePosition) {
          activePosition = { groupId: sig.tradeGroupId, entries: [], totalMultiplier: 0 }
        }
        activePosition.entries.push({ barIndex: i, price, sizeMultiplier: sig.sizeMultiplier, step: sig.entryStep })
        activePosition.totalMultiplier += sig.sizeMultiplier
      }

      signalIdx++
    }

    // ── Check SL/TP on composite position ──
    if (activePosition) {
      const totalMult = activePosition.totalMultiplier
      const weightedEntry = activePosition.entries.reduce((s, e) => s + e.price * e.sizeMultiplier, 0) / totalMult
      const priceMove = (price - weightedEntry) / weightedEntry * 100

      let exitReason: BacktestTrade['exitReason'] | null = null
      let exitPrice = price

      if (priceMove <= -slPct) {
        exitReason = 'SL'
        exitPrice = weightedEntry * (1 - slPct / 100)
      } else if (priceMove >= tpPct) {
        exitReason = 'TP'
        exitPrice = weightedEntry * (1 + tpPct / 100)
      } else if (i === n - 1) {
        exitReason = 'END_OF_DATA'
        exitPrice = price
      }

      if (exitReason) {
        const entryBar = activePosition.entries[0].barIndex
        const grossPnlPct = (exitPrice - weightedEntry) / weightedEntry * 100 * leverage * totalMult
        const totalFeePct = feePct * activePosition.entries.length
        const netPnlPct = grossPnlPct - totalFeePct
        cumulativePnl += netPnlPct

        trades.push({
          side: 'LONG',
          entryBar,
          exitBar: i,
          entryPrice: weightedEntry,
          exitPrice,
          pnlPct: grossPnlPct,
          netPnlPct,
          feePct: totalFeePct,
          exitReason,
          hurstAtEntry: hurst[entryBar],
          bbPositionAtEntry: (() => {
            const bbMA = bb.ma[entryBar]; const bbU = bb.upper[entryBar]; const bbL = bb.lower[entryBar]
            return bbMA !== null && bbU !== null && bbL !== null
              ? (bbU - bbL) > 0 ? ((closes[entryBar] - bbMA) / ((bbU - bbL) / 2)) : 0 : 0
          })(),
          barsHeld: i - entryBar,
          timestamp: timestamps?.[i],
          entryCount: activePosition.entries.length,
          totalSizeMultiplier: totalMult,
          tradeGroupId: activePosition.groupId,
        })
        activePosition = null
      }
    }

    equityCurve[i] = cumulativePnl
  }

  // ── Compute statistics ──
  const winningTrades = trades.filter(t => t.netPnlPct > 0)
  const losingTrades = trades.filter(t => t.netPnlPct <= 0)
  const longTrades = trades.filter(t => t.side === 'LONG')
  const shortTrades = trades.filter(t => t.side === 'SHORT')
  const longWinners = longTrades.filter(t => t.netPnlPct > 0)
  const shortWinners = shortTrades.filter(t => t.netPnlPct > 0)

  const totalPnlPct = trades.reduce((s, t) => s + t.netPnlPct, 0)
  const avgPnlPct = trades.length > 0 ? totalPnlPct / trades.length : 0
  const bestTradePct = trades.length > 0 ? Math.max(...trades.map(t => t.netPnlPct)) : 0
  const worstTradePct = trades.length > 0 ? Math.min(...trades.map(t => t.netPnlPct)) : 0

  let maxDD = 0, peak = 0
  for (const eq of equityCurve) { if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd }

  const returns = trades.map(t => t.netPnlPct)
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 1
  const sharpeRatio = stdReturn > 0 ? avgReturn / stdReturn : 0

  const grossProfit = winningTrades.reduce((s, t) => s + t.netPnlPct, 0)
  const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.netPnlPct, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  const singleEntryTrades = trades.filter(t => t.entryCount === 1).length
  const doubleEntryTrades = trades.filter(t => t.entryCount === 2).length
  const tripleEntryTrades = trades.filter(t => t.entryCount === 3).length

  return {
    trades, totalTrades: trades.length,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    totalPnlPct, avgPnlPct, bestTradePct, worstTradePct,
    maxDrawdownPct: maxDD, sharpeRatio, profitFactor,
    avgBarsHeld: trades.length > 0 ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0,
    longTrades: longTrades.length, shortTrades: shortTrades.length,
    longWinRate: longTrades.length > 0 ? longWinners.length / longTrades.length : 0,
    shortWinRate: shortTrades.length > 0 ? shortWinners.length / shortTrades.length : 0,
    equityCurve, totalSignals: signals.length, bbTouchCount, hurstCrossCount,
    singleEntryTrades, doubleEntryTrades, tripleEntryTrades,
  }
}
