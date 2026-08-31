// ─── CEX Anomaly — Types & Interfaces ────────────────────────────────────────
// Shared types for the MEV Microstructure Analysis Engine

import type { TradingMode } from './cex-anomaly-constants'

export type AnomalyCategory =
  | 'ICEBERG_DETECTED'
  | 'ICEBERG_REVERSAL'
  | 'WHALE_INFLOW'
  | 'AGGRESSIVE_ABSORPTION'
  | 'OI_SPIKE'
  | 'FUNDING_EXTREME'
  | 'CROWD_BIAS'
  | 'TAKER_IMBALANCE'
  | 'LIQUIDATION_CASCADE'
  | 'OI_VELOCITY'
  | 'ORDERBOOK_IMBALANCE'
  | 'WHALE_SWEEP'
  // ── New: free real-time sources (Phase 1) ──
  | 'REALTIME_LIQUIDATION'    // Binance !forceOrder@arr WS — sub-second liquidation feed
  | 'OPTIONS_FLOW'             // Deribit WS — large put/call, IV spikes, OI changes
  | 'GATE_FLOW'                // Gate.io WS — perps orderbook imbalance + whale trades
  | 'BITGET_FLOW'              // Bitget WS — perps depth + trades from top-3 exchange
  | 'DYDX_PERP_FLOW'           // dYdX v4 WS — on-chain perps order flow
  | 'MACRO_EVENT'              // Finnhub — CPI/FOMC/NFP macro calendar (event-driven)

export type AnomalyTag = 'ICEBERG' | 'ICE-REV' | 'INFLOW' | 'ABSORB' | 'OI' | 'FUNDING' | 'CROWD' | 'TAKER' | 'LIQ-CASCADE' | 'OI-VEL' | 'OB-IMBAL' | 'SWEEP' | 'RT-LIQ' | 'OPTIONS' | 'GATE-OB' | 'GATE-WHALE' | 'GATE-CLUSTER' | 'BITGET-OB' | 'BITGET-WHALE' | 'BITGET-CLUSTER' | 'DYDX-WHALE' | 'MACRO'

export type PositionSide = 'LONG' | 'SHORT'

export type PositionStatus = 'OPEN' | 'CLOSING' | 'LIQUIDATED' | 'CLOSED_BURST_TP' | 'CLOSED_BREAKEVEN' | 'CLOSED_COLLECTIVE_TP' | 'CLOSED_QUICK_PROFIT' | 'CLOSED_TP' | 'CLOSED_TRAILING' | 'CLOSED_SIGNAL_EXIT' | 'CLOSED_MOM_DIV' | 'CLOSED_VWAP_CROSS' | 'CLOSED_TIMEOUT' | 'CLOSED_STALE' | 'CLOSED_MANUAL'

export type SignalSemantics = 'MOMENTUM' | 'CONTRARIAN' | 'AMBIGUOUS'

export type ExecutionMode = 'TAKER' | 'MAKER'

export type ChaseStatus = 'PENDING' | 'CHASING' | 'FILLED' | 'FALLBACK_TAKER'

export interface ChaseState {
  attempts: number
  limitPrice: number       // current limit price
  originalPrice: number    // price at signal detection
  status: ChaseStatus
}

export interface PairConfig {
  symbol: string
  basePrice: number
  exchange: string
  vol: number // volatility multiplier
  decimals: number
  liqMultiplier: number // size scale for liquidation volumes
  binanceSymbol: string // Binance Futures symbol (e.g. BTCUSDT)
  /** Shield stop offset as % of price distance to liq cluster — per-pair based on daily vol */
  shieldOffset: number
  /** Dynamic SL in bps for AGGRESSIVE mode — per-pair based on daily vol */
  dynamicSlBps: number
  /** Ultra-tight SL in bps for SCALPER mode — per-pair based on daily vol */
  scalperSlBps: number
}

export interface OrderFlowAnomaly {
  id: string
  pair: string
  category: AnomalyCategory
  tag: AnomalyTag | string
  sizeUsd: number
  hiddenValue?: number
  chain?: string
  imbalance: number
  timestamp: number
  side: 'BID' | 'ASK'
  exchange: string
  fadedIn: boolean
  details: string
  /** Signal source: REAL = from live API, SIM = from random generator */
  source?: 'REAL' | 'SIM'
}

export interface ConfidenceBreakdown {
  // ── Layer B: Soft Scoring (max 10 pts, min 5 required to enter) ──

  /** Trigger quality points based on anomaly category:
   *  ABSORB=+3, FUNDING=+3 (|rate|>0.05%), INFLOW=+2, ICEBERG=+1, OI=+1
   *  Calibrated on TP rate: ABSORB 15.6% → highest, OI 13.0% → lowest */
  triggerQuality: number   // 1-3 pts (category-based)

  /** VWAP alignment: price on correct side of VWAP = +2, wrong side = -1 */
  vwapAlign: number        // +2, 0, or -1

  /** SMA 8/21 cross: SMA8>SMA21 + LONG = +2, opposite cross = -1 */
  smaAlign: number         // +2, 0, or -1

  /** Momentum: MOM > +0.001 + LONG = +2, MOM=0 = +1, opposite = -2 */
  momAlign: number         // +2, +1, 0, or -2

  /** MACD alignment: MACD histogram positive + LONG / negative + SHORT = +2, cross = +1, opposite = 0 */
  macdAlign: number        // +2, +1, 0

  /** RSI alignment: not overbought + LONG / not oversold + SHORT = +2, neutral = +1, opposing = 0 */
  rsiAlign: number         // +2, +1, 0

  /** Volume confirming: last candle volume > 150% of 10-candle avg = +1 */
  volumeConfirm: number    // +1 or 0

  /** Layer B subtotal (max 10, min 5 required to open position) */
  layerB: number

  // ── Layer C: Boosters (optional, raise CTP threshold) ──

  /** Multi-signal: 2 different triggers on same pair within 5s = +2 */
  multiSignal: number      // +2 or 0

  /** Historical edge pair: BTC, PEPE, FET, FIL = +1 */
  edgePair: number         // +1 or 0

  /** Spread tight: bid-ask < 0.02% = +1, spread > 0.05% = -1 */
  spreadTight: number      // +1, 0, or -1

  /** Layer C subtotal */
  layerC: number

  // ── Legacy fields (kept for backwards compat, derived from new fields) ──
  /** @deprecated Use triggerQuality > 0 instead */
  sizeThreshold: boolean
  /** @deprecated Use multiSignal > 0 instead */
  cvdDivergence: boolean
  /** @deprecated Always true for LIQ cluster check — see triggerQuality */
  liqCluster: boolean
  /** @deprecated Use multiSignal > 0 instead */
  reconfirmed: boolean
  /** @deprecated Use spreadTight > 0 instead */
  crossExchange: boolean
  /** @deprecated Use vwapAlign > 0 instead */
  taVwap: boolean
  /** @deprecated Use momAlign > 0 instead */
  taMom: boolean
  /** @deprecated Use smaAlign > 0 instead */
  taSma: boolean
  /** @deprecated Use macdAlign > 0 instead */
  taMacd: boolean
  /** @deprecated Use rsiAlign > 0 instead */
  taRsi: boolean

  /** Total confidence score = Layer B + Layer C (used for CTP threshold) */
  total: number
}

export interface ActivePosition {
  id: string
  pair: string
  side: PositionSide
  entryPrice: number
  currentPrice: number
  sizeUsd: number       // Notional position size (margin × leverage)
  marginUsd: number     // Actual margin committed
  leverage: number      // 1, 5, 10, or 20
  pnl: number
  pnlPercent: number
  entryFee: number      // Fee on open (based on notional × fee rate)
  exitFee: number       // Estimated fee on close
  totalFees: number     // entryFee + exitFee (for display)
  nearestLiqCluster: number
  shieldStopLoss: number
  status: PositionStatus
  openedAt: number
  anomaly: OrderFlowAnomaly
  closedAt: number | null
  priceHistory: number[]
  confidence: ConfidenceBreakdown

  // ─── Execution Mode ───
  executionMode: ExecutionMode
  /** Actual fee rate used for entry (maker or taker) */
  entryFeeRate: number
  /** Actual fee rate for exit (same as entry unless fallback) */
  exitFeeRate: number
  /** Chase state for maker orders */
  chaseState: ChaseState | null

  // ─── Dynamic Exit: Trailing Shield ───
  /** Highest favorable price reached (for trailing SL) */
  peakPrice: number
  /** Current trailing stop level (moves with peak, never retreats) */
  trailingStop: number
  /** Whether trailing is active (PnL exceeded activation threshold) */
  trailingActive: boolean

  // ─── Dynamic Exit: Breakeven Stop ───
  /** Whether breakeven stop has been activated (SL moved to entry + buffer) */
  breakevenHit: boolean

  // ─── Dynamic Exit: Partial TP ───
  /** Whether partial TP (TP1) has been taken */
  partialTpTaken: boolean
  /** Remaining fraction of original position (0.5 after partial TP) */
  remainingFraction: number
  /** Cumulative PnL realized from partial TP (for equity curve accuracy).
   *  When position is fully closed, total PnL = pos.pnl + partialPnlRealized */
  partialPnlRealized: number

  // ─── Dynamic Exit: CVD Reversal ───
  /** CVD value at position open — baseline for reversal detection */
  cvdAtOpen: number
  /** Peak CVD in favorable direction */
  cvdPeak: number

  // ─── Contrarian Mode ───
  /** Whether this position was opened in CONTRARIAN mode (signal direction inverted) */
  contrarian?: boolean
  /** Trading mode at time of position open — used for mode-specific exit logic */
  tradingMode?: TradingMode

  // ─── TMO WARN Checkpoint ───
  /** Whether position passed the 10s momentum checkpoint for TMO WARN eligibility */
  tmoCheckpointPassed: boolean

  // ─── Bybit PnL Verification ───
  /** Whether this position's PnL was last verified against Bybit's unrealisedPnl.
   *  true = PnL overwritten with real Bybit data (within last 30s reconcile)
   *  false = PnL is self-calculated from sim.price (may drift for non-active pairs) */
  bybitVerified?: boolean
  /** Timestamp of last Bybit PnL verification (ms) */
  bybitVerifiedAt?: number
  /** The real unrealisedPnl reported by Bybit at last reconcile (for discrepancy display) */
  bybitRealisedPnl?: number
  /** Gross unrealisedPnl from Bybit (before fees) — used for Net PnL breakdown display */
  bybitGrossPnl?: number
  /** Entry fee from Bybit reconciliation: Size × EntryPrice × 0.00055 (taker) */
  bybitEntryFee?: number
  /** Estimated exit fee from Bybit: Size × MarkPrice × 0.00055 (taker) — uses current markPrice */
  bybitExitFeeEstimate?: number

  // ─── Execution Timing (ms timestamps) ───
  /** When the anomaly signal was first detected (from anomaly.timestamp) */
  signalDetectedAt: number
  /** When the user clicked OPEN or bot sent the order */
  orderSentAt: number | null
  /** When the exchange API confirmed the order was filled */
  orderConfirmedAt: number | null
  /** When the user clicked CLOSE or bot sent the close order */
  closeSentAt: number | null
  /** When the exchange API confirmed the close was filled */
  closeConfirmedAt: number | null
  /** Target status after Bybit close confirmation (CLOSING → CLOSED_*) */
  pendingCloseStatus?: PositionStatus
}

export interface LiquidationBar {
  price: number
  longLiq: number
  shortLiq: number
}

export interface CVDPoint {
  t: number
  price: number
  cvd: number
  /** CVD delta this tick (buy volume - sell volume) — used for divergence detection */
  cvdDelta: number
}

export interface DivergenceZone {
  startIdx: number
  endIdx: number
  type: 'BEARISH' | 'BULLISH'
}

export interface PairSimulation {
  price: number
  cvd: number
  cvdBias: number
  cascadeTarget: number | null
  cascadeTick: number
  liqBars: LiquidationBar[]
  cvdData: CVDPoint[]
  divergenceZones: DivergenceZone[]
  // ── TA Indicators (VWAP + MOM + SMA) ──
  /** Price history for TA calculations — stores last N prices for SMA/MOM/VWAP */
  priceHistory: number[]
  /** Current VWAP value (rolling window, not cumulative) */
  vwap: number
  /** Current SMA 8 value */
  sma8: number
  /** Current SMA 21 value */
  sma21: number
  /** Current Momentum value (% change over MOM_PERIOD ticks) */
  momentum: number
  /** Peak momentum value for divergence detection */
  momPeak: number
  // ── MACD (same timeframe as VWAP/SMA/MOM — computed from priceHistory) ──
  /** MACD line value: EMA(12) - EMA(26) */
  macdLine: number
  /** MACD signal line: 9-period EMA of MACD line */
  macdSignal: number
  /** MACD histogram: macdLine - macdSignal */
  macdHistogram: number
  /** Previous MACD histogram value (for cross detection) */
  macdHistPrev: number

  // ── MACD 15m (computed from candle15mCloses — drives virtual signal) ──
  /** Current MACD line value from 15m candle closes */
  macd15mLine: number
  /** Current MACD signal line from 15m candle closes */
  macd15mSignal: number
  /** Current MACD histogram from 15m candle closes (line - signal) */
  macd15mHistogram: number
  /** Previous MACD line value (for line↔signal cross detection) */
  macd15mLinePrev: number
  /** Previous MACD signal value */
  macd15mSignalPrev: number

  // ── RSI (same timeframe as VWAP/SMA/MOM — computed from priceHistory) ──
  /** Current RSI value (Wilder's smoothed, 14-period default) */
  rsi: number
  /** Average gain for RSI computation (Wilder's smoothing) */
  rsiAvgGain: number
  /** Average loss for RSI computation (Wilder's smoothing) */
  rsiAvgLoss: number
  /** Number of prices processed for RSI (for warmup detection) */
  rsiWarmup: number

  // ── Bollinger Bands (TA INFO display) ──
  /** Current upper Bollinger Band value */
  bbUpper: number
  /** Current lower Bollinger Band value */
  bbLower: number

  // ── 15-minute candle RSI (separate from tick-level RSI) ──
  /** 15m candle close prices — last N completed 15m candles for RSI calculation */
  candle15mCloses: number[]
  /** Current 15m candle open price */
  candle15mOpen: number
  /** Timestamp when current 15m candle started */
  candle15mStartTs: number
  /** RSI computed from 15m candle closes (Wilder's smoothed, 14-period) */
  rsi15m: number
  /** Average gain for 15m RSI computation */
  rsi15mAvgGain: number
  /** Average loss for 15m RSI computation */
  rsi15mAvgLoss: number
  /** Number of 15m candles processed for RSI warmup */
  rsi15mWarmup: number
  /** Previous 15m RSI value (for cross/zone change detection) */
  rsi15mPrev: number
}

// ─── Binance WebSocket Types ────────────────────────────────────────────────

export interface BinanceDepthLevel {
  price: number
  quantity: number
}

export interface BinanceDepthUpdate {
  lastUpdateId: number
  bids: BinanceDepthLevel[]
  asks: BinanceDepthLevel[]
}

export interface BinanceAggTrade {
  a: number      // Aggregate tradeId
  p: string      // Price
  q: string      // Quantity
  f: number      // First tradeId
  l: number      // Last tradeId
  T: number      // Timestamp
  m: boolean     // Was the buyer the maker?
  M: boolean     // Was the trade the best price match?
}

export interface WSOrderBookSnapshot {
  bids: BinanceDepthLevel[]
  asks: BinanceDepthLevel[]
  lastUpdateId: number
  timestamp: number
}

export interface WSTradeData {
  trades: BinanceAggTrade[]
  cvdDelta: number // positive = buyer aggressive, negative = seller aggressive
  buyVolume: number
  sellVolume: number
  timestamp: number
}

// ─── CCXT Data Types (OI + Funding + Cross-Exchange Depth) ────────────────

export interface OIFundingData {
  symbol: string          // e.g. 'BTC/USDT'
  openInterest: number    // Current OI in contracts/coins
  openInterestUsd: number // Current OI in USD
  fundingRate: number     // Current funding rate (e.g. 0.0001 = 0.01%)
  fundingTimestamp: number
  nextFundingTime: number
  markPrice: number
  indexPrice: number
}

export interface OIFundingSnapshot {
  fetchedAt: number
  data: Record<string, OIFundingData>  // keyed by CCXT symbol 'BTC/USDT'
  /** Pairs where OI spiked > threshold compared to previous snapshot */
  oiSpikes: string[]
  /** Pairs where funding rate is extreme */
  fundingExtreme: string[]
}

export interface CrossExchangeDepth {
  exchange: string
  symbol: string
  bestBid: number
  bestAsk: number
  spread: number
  bidDepth5: number    // Total bid volume in top 5 levels (USD)
  askDepth5: number    // Total ask volume in top 5 levels (USD)
  bidWallSize: number  // Largest single bid level in top 20 (USD)
  askWallSize: number  // Largest single ask level in top 20 (USD)
  bidWallPrice: number // Price of the largest bid wall
  askWallPrice: number // Price of the largest ask wall
}

export interface CrossExchangeSnapshot {
  fetchedAt: number
  pair: string         // e.g. 'BTC-USDT'
  depths: CrossExchangeDepth[]
  /** True if a wall exists on one exchange but not others → potential wall anomaly */
  wallAnomalyDetected: boolean
  /** Which side the wall anomaly is on */
  wallAnomalySide: 'BID' | 'ASK' | null
  /** Which exchange has the wall */
  wallAnomalyExchange: string | null
  /** Size of the suspicious wall in USD */
  wallAnomalySize: number
  /** Ratio: wall size on one exchange vs average of others */
  wallAnomalyRatio: number
}

// ─── Signal Convergence Funnel Types ─────────────────────────────────────────

/** A single signal waiting in the convergence funnel for a pair */
export interface FunnelSignal {
  id: string
  anomaly: OrderFlowAnomaly
  enteredAt: number       // timestamp when signal entered the funnel
  expiresAt: number       // timestamp when signal expires (enteredAt + window)
}

/** Convergence result when 2+ different-category signals meet on a pair */
export interface FunnelConvergence {
  pair: string
  signals: FunnelSignal[]              // all converged signals
  categories: AnomalyCategory[]        // unique categories (2+ = conviction) — array for serializability
  sides: { BID: number; ASK: number }  // which sides the signals are on
  dominantSide: 'BID' | 'ASK'         // majority side → determines trade direction
  convergentSignal: FunnelSignal       // the signal that triggered convergence (latest)
  timestamp: number                     // when convergence was detected
}

/** Funnel state per pair */
export interface PairFunnel {
  pair: string
  signals: FunnelSignal[]
  convergence: FunnelConvergence | null
}
