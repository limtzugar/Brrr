// ─── CEX Anomaly — Constants & Configuration ─────────────────────────────────
// All magic numbers extracted as named constants for maintainability

import { TE } from '@/lib/te-tokens'
import type { AnomalyCategory, AnomalyTag, PairConfig, SignalSemantics, PositionStatus } from './cex-anomaly-types'
import {
  Waves, Anchor, Shield, TrendingUp, DollarSign, RotateCcw,
  Users, Zap, Flame, Activity, Layers, Crosshair,
  Siren, BarChart3, ArrowRightLeft, Binary, Globe, CalendarClock,
} from 'lucide-react'

// ─── Pair Configuration ─────────────────────────────────────────────────────

export const ALL_PAIRS: PairConfig[] = [
  { symbol: 'BTC-USDT',  basePrice: 75500,   exchange: 'Binance', vol: 0.0004,  decimals: 0, liqMultiplier: 10, binanceSymbol: 'BTCUSDT',  shieldOffset: 0.007, dynamicSlBps: 40, scalperSlBps: 15 },
  { symbol: 'ETH-USDT',  basePrice: 2070,    exchange: 'Binance', vol: 0.0006,  decimals: 0, liqMultiplier: 5,  binanceSymbol: 'ETHUSDT',  shieldOffset: 0.012, dynamicSlBps: 50, scalperSlBps: 18 },
  { symbol: 'SOL-USDT',  basePrice: 84.5,    exchange: 'Binance', vol: 0.001,   decimals: 1, liqMultiplier: 3,  binanceSymbol: 'SOLUSDT',  shieldOffset: 0.015, dynamicSlBps: 60, scalperSlBps: 25 },
  { symbol: 'BNB-USDT',  basePrice: 656.8,   exchange: 'Binance', vol: 0.0005,  decimals: 1, liqMultiplier: 3,  binanceSymbol: 'BNBUSDT',  shieldOffset: 0.007, dynamicSlBps: 40, scalperSlBps: 15 },
  { symbol: 'XRP-USDT',  basePrice: 1.35,    exchange: 'Binance', vol: 0.0012,  decimals: 3, liqMultiplier: 2,  binanceSymbol: 'XRPUSDT',  shieldOffset: 0.015, dynamicSlBps: 55, scalperSlBps: 20 },
  { symbol: 'DOGE-USDT', basePrice: 0.1016,  exchange: 'Binance', vol: 0.0015,  decimals: 4, liqMultiplier: 2,  binanceSymbol: 'DOGEUSDT', shieldOffset: 0.018, dynamicSlBps: 65, scalperSlBps: 25 },
  { symbol: 'ADA-USDT',  basePrice: 0.2435,  exchange: 'Binance', vol: 0.0012,  decimals: 3, liqMultiplier: 2,  binanceSymbol: 'ADAUSDT',  shieldOffset: 0.015, dynamicSlBps: 55, scalperSlBps: 20 },
  { symbol: 'FIL-USDT',  basePrice: 0.968,   exchange: 'Binance', vol: 0.0012,  decimals: 2, liqMultiplier: 1,  binanceSymbol: 'FILUSDT',  shieldOffset: 0.018, dynamicSlBps: 65, scalperSlBps: 25 },
  { symbol: 'SUI-USDT',  basePrice: 1.04,    exchange: 'Binance', vol: 0.0013,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'SUIUSDT',  shieldOffset: 0.018, dynamicSlBps: 60, scalperSlBps: 22 },
  { symbol: 'PEPE-USDT', basePrice: 0.00000367,exchange:'Binance', vol: 0.002,  decimals: 8, liqMultiplier: 1,  binanceSymbol: 'PEPEUSDT', shieldOffset: 0.020, dynamicSlBps: 30, scalperSlBps: 12 },
  { symbol: 'FET-USDT',  basePrice: 0.197,   exchange: 'Binance', vol: 0.0018,  decimals: 3, liqMultiplier: 1,  binanceSymbol: 'FETUSDT',  shieldOffset: 0.020, dynamicSlBps: 70, scalperSlBps: 28 },
  { symbol: 'ICP-USDT',  basePrice: 2.50,    exchange: 'Binance', vol: 0.0014,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'ICPUSDT',  shieldOffset: 0.020, dynamicSlBps: 55, scalperSlBps: 20 },
  { symbol: 'TAO-USDT',  basePrice: 265,     exchange: 'Binance', vol: 0.0012,  decimals: 1, liqMultiplier: 2,  binanceSymbol: 'TAOUSDT',  shieldOffset: 0.012, dynamicSlBps: 50, scalperSlBps: 18 },
  { symbol: 'ZEC-USDT',  basePrice: 605,     exchange: 'Binance', vol: 0.001,   decimals: 1, liqMultiplier: 2,  binanceSymbol: 'ZECUSDT',  shieldOffset: 0.015, dynamicSlBps: 45, scalperSlBps: 18 },
  { symbol: 'INJ-USDT',  basePrice: 24.5,    exchange: 'Binance', vol: 0.0015,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'INJUSDT',  shieldOffset: 0.018, dynamicSlBps: 60, scalperSlBps: 22 },
  { symbol: 'TON-USDT',  basePrice: 3.50,    exchange: 'Binance', vol: 0.0013,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'TONUSDT',  shieldOffset: 0.018, dynamicSlBps: 55, scalperSlBps: 20 },
  { symbol: 'LINK-USDT', basePrice: 15.20,   exchange: 'Binance', vol: 0.001,   decimals: 2, liqMultiplier: 2,  binanceSymbol: 'LINKUSDT', shieldOffset: 0.012, dynamicSlBps: 45, scalperSlBps: 18 },
  { symbol: 'AVAX-USDT', basePrice: 22.80,   exchange: 'Binance', vol: 0.0012,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'AVAXUSDT', shieldOffset: 0.015, dynamicSlBps: 50, scalperSlBps: 20 },
  { symbol: 'HYPE-USDT',  basePrice: 15.50,   exchange: 'Binance', vol: 0.002,    decimals: 2, liqMultiplier: 2,  binanceSymbol: 'HYPEUSDT',  shieldOffset: 0.018, dynamicSlBps: 55, scalperSlBps: 20 },
  { symbol: 'TRUMP-USDT', basePrice: 12.80,   exchange: 'Binance', vol: 0.0022,  decimals: 2, liqMultiplier: 2,  binanceSymbol: 'TRUMPUSDT', shieldOffset: 0.018, dynamicSlBps: 60, scalperSlBps: 22 },
  { symbol: 'WLD-USDT',   basePrice: 1.15,    exchange: 'Binance', vol: 0.002,   decimals: 2, liqMultiplier: 2,  binanceSymbol: 'WLDUSDT',   shieldOffset: 0.018, dynamicSlBps: 55, scalperSlBps: 20 },
]

// ─── Anomaly Weights ────────────────────────────────────────────────────────

export const ANOMALY_WEIGHTS: { category: AnomalyCategory; tag: AnomalyTag; weight: number }[] = [
  // ── Weights for pickWeighted() random selection AND signal quality/importance ──
  // Higher weight = more likely to be picked AND more important signal.
  // Total: ~175. Used by pickWeighted() for random selection.
  { category: 'ICEBERG_DETECTED', tag: 'ICEBERG', weight: 15 },       // HL L2 book — hidden liquidity
  { category: 'ICEBERG_REVERSAL', tag: 'ICE-REV', weight: 5 },        // Low quality — reversed iceberg
  { category: 'WHALE_INFLOW', tag: 'INFLOW', weight: 20 },            // DexScreener — whale buying/selling on DEX
  { category: 'AGGRESSIVE_ABSORPTION', tag: 'ABSORB', weight: 25 },   // HL L2 book — wall absorbing market buys
  { category: 'OI_SPIKE', tag: 'OI', weight: 15 },                    // HL + Bybit — OI surge
  { category: 'FUNDING_EXTREME', tag: 'FUNDING', weight: 20 },        // HL + Bybit — extreme funding
  { category: 'CROWD_BIAS', tag: 'CROWD', weight: 15 },               // Binance — top trader ratio momentum
  { category: 'TAKER_IMBALANCE', tag: 'TAKER', weight: 20 },          // Binance — aggressive flow
  { category: 'LIQUIDATION_CASCADE', tag: 'LIQ-CASCADE', weight: 30 }, // Binance + HL proxy — cascade = strongest
  { category: 'OI_VELOCITY', tag: 'OI-VEL', weight: 10 },             // Binance — rapid OI change, ambiguous
  { category: 'ORDERBOOK_IMBALANCE', tag: 'OB-IMBAL', weight: 22 },   // Bybit public — bid/ask pressure CONTRARIAN (fade the imbalance)
  { category: 'WHALE_SWEEP', tag: 'SWEEP', weight: 28 },              // Bybit public — fade the whale, play against bots that follow
  // ── New: free real-time sources (Phase 1) ──
  { category: 'REALTIME_LIQUIDATION', tag: 'RT-LIQ', weight: 32 },     // Binance WS — sub-second liquidation feed, strongest cascade signal
  { category: 'OPTIONS_FLOW', tag: 'OPTIONS', weight: 20 },            // Deribit — large put/call, IV spikes
  { category: 'GATE_FLOW', tag: 'GATE-OB', weight: 18 },                  // Gate.io — perps OB imbalance
  { category: 'GATE_FLOW', tag: 'GATE-WHALE', weight: 20 },              // Gate.io — whale trade
  { category: 'GATE_FLOW', tag: 'GATE-CLUSTER', weight: 22 },            // Gate.io — whale cluster
  { category: 'BITGET_FLOW', tag: 'BITGET-OB', weight: 18 },              // Bitget — perps OB imbalance
  { category: 'BITGET_FLOW', tag: 'BITGET-WHALE', weight: 20 },           // Bitget — whale trade
  { category: 'BITGET_FLOW', tag: 'BITGET-CLUSTER', weight: 22 },         // Bitget — whale cluster
  { category: 'DYDX_PERP_FLOW', tag: 'DYDX-WHALE', weight: 15 },          // dYdX — on-chain whale perps flow
  { category: 'MACRO_EVENT', tag: 'MACRO', weight: 25 },               // Finnhub — CPI/FOMC/NFP events
]

export const TAG_COLORS: Record<AnomalyTag, { bg: string; text: string; border: string }> = {
  ICEBERG: { bg: TE.cyanBg, text: TE.cyan, border: `${TE.cyan}33` },
  'ICE-REV': { bg: `${TE.cyan}1a`, text: '#00e5ff', border: `${TE.cyan}66` },
  INFLOW: { bg: TE.purpleBg, text: TE.purple, border: `${TE.purple}33` },
  ABSORB: { bg: TE.greenBg, text: TE.green, border: `${TE.green}33` },
  OI: { bg: TE.yellow + '1a', text: TE.yellow, border: `${TE.yellow}33` },
  FUNDING: { bg: TE.red + '1a', text: TE.red, border: `${TE.red}33` },
  CROWD: { bg: '#ff6b001a', text: '#ff8c00', border: '#ff8c0033' },
  TAKER: { bg: '#e91e631a', text: '#ff4081', border: '#ff408133' },
  'LIQ-CASCADE': { bg: '#ff00001a', text: '#ff3333', border: '#ff333366' },
  'OI-VEL': { bg: `${TE.yellow}1a`, text: '#ffd700', border: '#ffd70033' },
  'OB-IMBAL': { bg: '#00ff881a', text: '#00ff88', border: '#00ff8833' },
  'SWEEP': { bg: '#ff00aa1a', text: '#ff00aa', border: '#ff00aa33' },
  // ── New tags ──
  'RT-LIQ': { bg: '#ff00001a', text: '#ff4444', border: '#ff444466' },
  'OPTIONS': { bg: '#9c27b01a', text: '#ce93d8', border: '#ce93d833' },
  'GATE-OB': { bg: '#2196f31a', text: '#64b5f6', border: '#64b5f633' },
  'GATE-WHALE': { bg: '#2196f31a', text: '#42a5f5', border: '#42a5f533' },
  'GATE-CLUSTER': { bg: '#2196f31a', text: '#1e88e5', border: '#1e88e533' },
  'BITGET-OB': { bg: '#4caf501a', text: '#81c784', border: '#81c78433' },
  'BITGET-WHALE': { bg: '#4caf501a', text: '#66bb6a', border: '#66bb6a33' },
  'BITGET-CLUSTER': { bg: '#4caf501a', text: '#43a047', border: '#43a04733' },
  'DYDX-WHALE': { bg: '#673ab71a', text: '#b39ddb', border: '#b39ddb33' },
  'MACRO': { bg: '#ff98001a', text: '#ffb74d', border: '#ffb74d33' },
}

export const CATEGORY_META: Record<AnomalyCategory, {
  label: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  color: string
  description: string
}> = {
  ICEBERG_DETECTED: {
    label: 'ICEBERG DETECTED',
    icon: Waves,
    color: TE.cyan,
    description: 'Execution volume exceeds visible OB — hidden liquidity',
  },
  ICEBERG_REVERSAL: {
    label: 'ICEBERG REVERSAL',
    icon: RotateCcw,
    color: '#00e5ff',
    description: 'Contrarian: BID iceberg → SHORT, ASK iceberg → LONG — gra przeciwko whale',
  },
  WHALE_INFLOW: {
    label: 'WHALE INFLOW',
    icon: Anchor,
    color: TE.purple,
    description: 'Large stablecoin/BTC transfer to Binance addresses',
  },
  AGGRESSIVE_ABSORPTION: {
    label: 'AGGRESSIVE ABSORPTION',
    icon: Shield,
    color: TE.green,
    description: 'Market-buy absorbed without price movement — COPY signal',
  },
  OI_SPIKE: {
    label: 'OI SPIKE',
    icon: TrendingUp,
    color: TE.yellow,
    description: 'Sudden Open Interest spike — large new position entering market',
  },
  FUNDING_EXTREME: {
    label: 'FUNDING EXTREME',
    icon: DollarSign,
    color: TE.red,
    description: 'Extreme funding rate — crowd on one side, contrarian signal',
  },
  CROWD_BIAS: {
    label: 'CROWD BIAS',
    icon: Users,
    color: '#ff8c00',
    description: 'Top traders 70%+ po jednej stronie — follow crowd direction',
  },
  TAKER_IMBALANCE: {
    label: 'TAKER IMBALANCE',
    icon: Zap,
    color: '#ff4081',
    description: 'Aggressive buyers vs sellers — direct pressure',
  },
  LIQUIDATION_CASCADE: {
    label: 'LIQ CASCADE',
    icon: Flame,
    color: '#ff3333',
    description: 'Kaskada likwidacji w jednym kierunku — momentum cascade',
  },
  OI_VELOCITY: {
    label: 'OI VELOCITY',
    icon: Activity,
    color: '#ffd700',
    description: 'Rapid OI change — someone building a large position',
  },
  ORDERBOOK_IMBALANCE: {
    label: 'OB FADE',
    icon: Layers,
    color: '#00ff88',
    description: 'Bid/ask imbalance → follow OB pressure; Contrarian → FADE (reverses)',
  },
  WHALE_SWEEP: {
    label: 'WHALE SWEEP',
    icon: Crosshair,
    color: '#ff00aa',
    description: 'Whale sweep → follow kierunek whala; Contrarian → FADE (odwraca)',
  },
  // ── New: free real-time sources ──
  REALTIME_LIQUIDATION: {
    label: 'RT LIQUIDATION',
    icon: Siren,
    color: '#ff4444',
    description: 'Sub-second liquidation cascade from Binance WS — fastest cascade signal',
  },
  OPTIONS_FLOW: {
    label: 'OPTIONS FLOW',
    icon: BarChart3,
    color: '#ce93d8',
    description: 'Large put/call option volume on Deribit — options predict futures',
  },
  GATE_FLOW: {
    label: 'GATE FLOW',
    icon: ArrowRightLeft,
    color: '#64b5f6',
    description: 'OB pressure + whale trade on Gate.io — different trader demographics',
  },
  BITGET_FLOW: {
    label: 'BITGET FLOW',
    icon: Binary,
    color: '#81c784',
    description: 'Presja OB + whalowy trade on Bitget — top-3 derivatives exchange',
  },
  DYDX_PERP_FLOW: {
    label: 'DYDX PERP FLOW',
    icon: Globe,
    color: '#b39ddb',
    description: 'On-chain perps order flow from dYdX v4 — different participant mix',
  },
  MACRO_EVENT: {
    label: 'MACRO EVENT',
    icon: CalendarClock,
    color: '#ffb74d',
    description: 'CPI/FOMC/NFP macro event — high volatility after events',
  },
}

// ─── Named Constants (replacing magic numbers) ──────────────────────────────

export const SIM = {
  /** Price tick interval in ms — how often simulation ticks */
  TICK_INTERVAL_MS: 200,
  /** DISABLED: Simulated anomaly generator is OFF — only real API signals used. */
  ANOMALY_GENERATOR_ENABLED: false,
  /** Anomaly generation interval range (ms) — only used if ANOMALY_GENERATOR_ENABLED=true */
  ANOMALY_INTERVAL_MIN_MS: 1500,
  ANOMALY_INTERVAL_MAX_MS: 3000,
  /** Binance REST price refresh interval */
  PRICE_REFRESH_MS: 10_000,
  /** Mean reversion strength toward real Binance price (0-1) */
  MEAN_REVERSION: 0.5,
  /** Price random walk bias — 0.50 = perfectly neutral (no drift) */
  PRICE_DRIFT_BIAS: 0.50,
  /** Cascade momentum strength */
  CASCADE_MOMENTUM: 0.0015,
  /** Cascade reversal strength */
  CASCADE_REVERSAL: 0.001,
  /** Cascade max ticks before reset */
  CASCADE_MAX_TICKS: 5,
  /** Probability of cascade trigger per tick */
  CASCADE_TRIGGER_PROB: 0.04, // 1 - 0.96
  /** Distance threshold for cascade trigger (as % of price) */
  CASCADE_DIST_THRESHOLD: 0.003,
  /** Min liq volume to trigger cascade */
  CASCADE_MIN_LIQ: 2000,
  /** Signal impulse duration in ticks (500ms each). 10 ticks = 5 seconds of momentum. */
  SIGNAL_IMPULSE_TICKS: 10,
  /** Signal impulse strength per tick as fraction of price. */
  SIGNAL_IMPULSE_STRENGTH: 0.0003,
  /** CVD bias change frequency (every N ticks) */
  CVD_BIAS_CHANGE_FREQ: 100,
  /** CVD bias max range */
  CVD_BIAS_RANGE: 0.8,
  /** CVD buy probability influence of bias */
  CVD_BIAS_INFLUENCE: 0.3,
  /** CVD volume range */
  CVD_VOLUME_MIN: 50,
  CVD_VOLUME_MAX: 500,
  /** Liquidation bar regeneration frequency (every N ticks) */
  LIQ_REGEN_FREQ: 50,
  /** Divergence detection frequency (every N ticks) */
  DIVERGENCE_DETECT_FREQ: 75,
  /** Divergence lookback window (number of CVD points) */
  DIVERGENCE_LOOKBACK: 60,
  /** Min CVD data points needed for divergence detection */
  DIVERGENCE_MIN_POINTS: 40,
} as const

export const LIMITS = {
  /** Max anomalies stored in state */
  MAX_ANOMALIES: 80,
  /** Max CVD data points per pair */
  MAX_CVD_POINTS: 300,
  /** Max price history points per position */
  MAX_POSITION_HISTORY: 60,
  /** Max closed positions stored */
  MAX_CLOSED_POSITIONS: 30,
  /** Max concurrent open positions */
  MAX_OPEN_POSITIONS: 7,
  /** Default starting capital for paper trading */
  DEFAULT_CAPITAL: 73 as number,
  /** Position size as fraction of wallet balance */
  POSITION_SIZE_PCT: 0.10,
  /** Minimum margin per position in USD — ensures meaningful PnL even at high leverage */
  MIN_MARGIN_USD: 8,
  /** Max position size in USD */
  MAX_POSITION_SIZE_USD: 15000,
  /** Shield stop loss offset from liq cluster (%) */
  SHIELD_STOP_OFFSET: 0.01, // 1.0% — more realistic distance
  /** Flash timeout for liquidation events (ms) */
  FLASH_TIMEOUT_MS: 1500,
  // NOTE: Legacy TAKER_FEE_RATE (0.0004) and ROUND_TRIP_FEE_RATE (0.0008) removed.
  // Fee rates are now resolved dynamically from EXCHANGE_FEES[tradingExchange].
  // NOTE: Legacy TAKE_PROFIT_PERCENT (1.5) removed. TP is now per-mode: TRADING_MODES[mode].takeProfitPercent.
  /** Anomaly categories that trigger position opening */
  TRADEABLE_CATEGORIES: ['ICEBERG_DETECTED', 'ICEBERG_REVERSAL', 'WHALE_INFLOW', 'AGGRESSIVE_ABSORPTION', 'OI_SPIKE', 'FUNDING_EXTREME', 'CROWD_BIAS', 'TAKER_IMBALANCE', 'LIQUIDATION_CASCADE', 'OI_VELOCITY', 'ORDERBOOK_IMBALANCE', 'WHALE_SWEEP', 'REALTIME_LIQUIDATION', 'OPTIONS_FLOW', 'GATE_FLOW', 'BITGET_FLOW', 'DYDX_PERP_FLOW', 'MACRO_EVENT'] as const,
} as const

// ─── Exchange Fee Schedule ──────────────────────────────────────────────────
// Taker / Maker rates for USDT-M Futures on each exchange
// Source: official fee schedules as of 2025

export type TradingExchange = 'bybit' | 'okx'

// Binance Futures disabled — MiCA restricted in EU
// Fees still referenced for informational display only
export const BINANCE_FEES_DISABLED = {
  label: 'Binance',
  taker: 0.0004,   // 0.040%
  maker: 0.0002,   // 0.020%
  roundTrip: 0.0008, // 0.080%
  disabled: true,
  reason: 'MiCA restricted in EU',
} as const

export const EXCHANGE_FEES: Record<TradingExchange, {
  label: string
  taker: number
  maker: number
  roundTrip: number        // taker round-trip
  makerRoundTrip: number   // maker entry + taker exit
  /** Brand color for UI elements */
  brandColor: string
}> = {
  bybit: {
    label: 'Bybit',
    taker: 0.00055,  // 0.0550%
    maker: 0.0002,   // 0.0200% (unused — all trades charged taker)
    roundTrip: 0.0011, // 0.1100% (taker × 2 — REAL confirmed by trade history)
    makerRoundTrip: 0.0011, // 0.1100% (same as taker round-trip — maker not used in practice)
    brandColor: '#f7a600',
  },
  okx: {
    label: 'OKX',
    taker: 0.0005,   // 0.0500%
    maker: 0.0002,   // 0.0200% (unused — all trades charged taker)
    roundTrip: 0.0010, // 0.1000% (taker × 2)
    makerRoundTrip: 0.0010, // 0.1000% (same as taker round-trip — maker not used in practice)
    brandColor: '#00C853',  // OKX brand green
  },

}

/** Default exchange for paper trading — Bybit (Taker 0.055% × 2 = 0.110% round-trip) */
export const DEFAULT_EXCHANGE: TradingExchange = 'bybit'

// ─── Leverage & Trading Mode ────────────────────────────────────────────────
// Two modes: CONSERVATIVE (low risk, patient) and AGGRESSIVE (high leverage, fast)
// TP thresholds are expressed as % of PRICE MOVE (not position PnL).
// Leverage amplifies PnL automatically: grossPnlPercent = priceChange% × leverage
// So at 10x, a 2% price move = 20% position PnL → hits TP

export type LeverageLevel = 1 | 3 | 5 | 10 | 20 | 40 | 100

export type TradingMode = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPER' | 'CROWD20' | 'CONTRARIAN'

export const TRADING_MODES: Record<TradingMode, {
  label: string
  leverage: LeverageLevel
  /** TP as % of PRICE MOVE (not position PnL!). Leverage amplifies PnL automatically.
   *  Example: TP 2.0% ceny → at 1x = 2% pos PnL, at 5x = 10% pos PnL, at 10x = 20% pos PnL */
  takeProfitPercent: number
  /** Shield stop offset as % of price distance to liq cluster (divided by leverage) */
  shieldStopOffset: number
  /** Max position age in ms — auto-close at market after this */
  positionTimeoutMs: number
  /** Position size as fraction of wallet (margin) */
  positionSizePct: number
  description: string
}> = {
  CONSERVATIVE: {
    label: 'CONSERVATIVE',
    leverage: 1,
    takeProfitPercent: 2.0,    // 2.0% ceny → 1x: 2% PnL, 5x: 10% PnL, 10x: 20% PnL
    shieldStopOffset: 0.01,
    positionTimeoutMs: 0, // no timeout — patient
    positionSizePct: 0.10,
    description: '1x lewar, cierpliwy exit — trailing po 1.5% ceny, TP2.0%, brak timeoutu. Bybit fees: taker 0.0550% × 2 = 0.110%.',
  },
  AGGRESSIVE: {
    label: 'AGGRESSIVE',
    leverage: 10,
    takeProfitPercent: 1.2,     // 1.2% price →10x: 12% PnL (balanced: realistic + gives runner chance)
    shieldStopOffset: 0.005,    // 0.5% shield offset — przetrwa noise ±0.3-0.4%
    positionTimeoutMs: 180 * 1000, // 3min auto-close (hard TMO) — oddech dla trade'u
    positionSizePct: 0.08,
    description: '10x lewar, SL 0.50%, TP 1.2% ceny (R:R = 2.4:1), BE po 0.40% ceny, trailing po 0.65%, TMO 3min, grace 15s. Bybit fees: taker 0.0550% × 2 = 0.110%.',
  },
  SCALPER: {
    label: 'SCALPER',
    leverage: 10,
    takeProfitPercent: 0.50,   // CSV-optimal: 0.50% price TP (48k trades sim → +$4499 vs +$1528 actual)
    shieldStopOffset: 0.002, // 0.20% price hard cap — CSV-optimal SL (was 0.30%, losses avg 0.56%)
    positionTimeoutMs: 5 * 60 * 1000, // 5 min auto-close (safety net)
    positionSizePct: 0.06,
    description: '10x lewar, TP 0.50% ceny, SL 0.20% ceny (R:R 2.5:1). CSV-backtested on 48k trades. TMO hard 30s. Bybit fees: taker 0.0550% × 2 = 0.110%.',
  },
  CROWD20: {
    label: 'CROWD20',
    leverage: 20,
    takeProfitPercent: 0.50,   // data: avgWin $0.754 on $8 margin ≈ 9.4% pos ≈ 0.47% price @20x
    shieldStopOffset: 0.004,   // 0.40% price SL ≈ 8% pos @20x — tighter than TP (data: avgLoss ran 1.5× avgWin)
    positionTimeoutMs: 60 * 1000, // 60s hard kill — data: median win 39.8s, CLOSED_TIMEOUT leak −$3,103
    positionSizePct: 0.05,     // small margin per trade — 20x demands humility
    description: 'CROWD-only 20x — data-proven (27,848 real paper trades, 68% WR, PF 1.37). TP 0.50% ceny, SL 0.40% ceny, TMO hard 60s. Bybit fees: taker 0.0550% × 2 = 0.110%.',
  },
  CONTRARIAN: {
    label: 'CONTRARIAN',
    leverage: 5,
    takeProfitPercent: 1.5,
    shieldStopOffset: 0.008,
    positionTimeoutMs: 8 * 60 * 1000, // 8 min auto-close
    positionSizePct: 0.08,
    description: '5x leverage, reverses direction of EVERY signal. BID→SHORT, ASK→LONG. Fade signals — play against crowd. TP1.5% price, trailing after 2%, TMO 8min. Bybit fees: taker 0.0550% ×2 =0.110%.',
  },
}

/** All selectable leverage levels for manual override */
export const LEVERAGE_OPTIONS: { value: LeverageLevel; label: string; color: string }[] = [
  { value: 1, label: '1x', color: TE.green },
  { value: 3, label: '3x', color: TE.cyan },
  { value: 5, label: '5x', color: TE.cyan },
  { value: 10, label: '10x', color: TE.orange },
  { value: 20, label: '20x', color: TE.red },
  { value: 40, label: '40x', color: '#ff0040' },
  { value: 100, label: '100x', color: '#ff0000' },
]

// ─── Signal Quality: Size Thresholds ─────────────────────────────────────────
// Minimum size (USD) for an anomaly to qualify for trading
// Below these thresholds the signal is considered noise
export const SIZE_THRESHOLDS: Record<AnomalyCategory, number> = {
  ICEBERG_DETECTED: 200_000,       // $200K hidden liquidity minimum
  ICEBERG_REVERSAL: 200_000,       // Same threshold — same signal, reversed direction
  WHALE_INFLOW: 1_000_000,         // $1M whale transfer minimum
  AGGRESSIVE_ABSORPTION: 300_000,  // $300K absorbed minimum
  OI_SPIKE: 50_000_000,            // $50M OI change minimum
  FUNDING_EXTREME: 10_000_000,     // $10M OI minimum — funding without OI is noise
  CROWD_BIAS: 65,                   // 65% ratio threshold
  TAKER_IMBALANCE: 1.5,            // 150% buy/sell ratio threshold
  LIQUIDATION_CASCADE: 500_000,    // $500K cumulative liquidations minimum
  OI_VELOCITY: 5_000_000,          // $5M OI change per 5min minimum
  ORDERBOOK_IMBALANCE: 30,          // signalStrength minimum (0-100 scale)
  WHALE_SWEEP: 40,                  // signalStrength minimum (0-100 scale)
  // ── New thresholds ──
  REALTIME_LIQUIDATION: 200_000,   // $200K cumulative real-time liqs minimum
  OPTIONS_FLOW: 500_000,           // $500K notional options trade minimum
  GATE_FLOW: 150_000,              // $150K OB imbalance or trade minimum
  BITGET_FLOW: 150_000,            // $150K OB imbalance or trade minimum
  DYDX_PERP_FLOW: 100_000,         // $100K trade minimum
  MACRO_EVENT: 0,                   // N/A — event-driven, no size threshold
} as const

// ─── Confidence Scoring ───────────────────────────────────────────────────────
// Two-layer scoring system:
//   Layer B: Soft Scoring — max 10 pts, min 5 required to enter
//   Layer C: Boosters — optional, raise CTP threshold (don't affect entry gate)
export const SCORING = {
  // ── Layer B: Trigger Quality (category-based, calibrated on TP rate) ──
  /** ABSORB = 0 (DISABLED — 64/118 trades, −2.83 USDT PnL, WR 67% but asymmetric SL/TP) */
  TRIGGER_ABSORB_PTS: 0,
  /** FUNDING_EXTREME = +3 (when |rate| > 0.05% — strong contrarian) */
  TRIGGER_FUNDING_PTS: 3,
  /** WHALE_INFLOW = +2 (significant but less direct) */
  TRIGGER_INFLOW_PTS: 2,
  /** ICEBERG_DETECTED = +1 (hidden liquidity — informative but ambiguous) */
  TRIGGER_ICEBERG_PTS: 1,
  /** ICEBERG_REVERSAL = +1 (contrarian play — same weight as iceberg) */
  TRIGGER_ICE_REV_PTS: 1,
  /** OI_SPIKE = +1 (TP rate 13.0% — lowest quality, needs confirmation) */
  TRIGGER_OI_PTS: 1,
  /** CROWD_BIAS = +3 (RE-ENABLED 2026-07-31, data-driven: 27,848 real paper trades
   *  May–Jun 2026 → 68% WR, +$2,062, PF 1.37 — the ONLY profitable trigger.
   *  MOMENTUM mode: follow top-trader direction (SHORT bias proven in data). */
  TRIGGER_CROWD_PTS: 3,
  /** TAKER_IMBALANCE = +2 (direct aggressive flow pressure — strong confirmation) */
  TRIGGER_TAKER_PTS: 2,
  /** LIQUIDATION_CASCADE = +3 (real cascade = highest conviction) */
  TRIGGER_LIQ_CASCADE_PTS: 3,
  /** OI_VELOCITY = +1 (rapid OI change — informative but direction ambiguous) */
  TRIGGER_OI_VEL_PTS: 1,
  /** ORDERBOOK_IMBALANCE = +2 (leading signal — bid/ask pressure before price moves) */
  TRIGGER_OB_IMBAL_PTS: 2,
  /** WHALE_SWEEP = +3 (fade the whale = play against bots that follow large orders) */
  TRIGGER_SWEEP_PTS: 3,
  // ── New trigger scores ──
  /** REALTIME_LIQUIDATION = +3 (sub-second cascade — fastest & strongest cascade signal) */
  TRIGGER_RT_LIQ_PTS: 3,
  /** OPTIONS_FLOW = +2 (options lead futures — directional but slower) */
  TRIGGER_OPTIONS_PTS: 2,
  /** GATE_FLOW = +2 (cross-exchange OB divergence) */
  TRIGGER_GATE_PTS: 2,
  /** BITGET_FLOW = +2 (cross-exchange OB divergence) */
  TRIGGER_BITGET_PTS: 2,
  /** DYDX_PERP_FLOW = +1 (on-chain perps — informative but different participant mix) */
  TRIGGER_DYDX_PTS: 1,
  /** MACRO_EVENT = +3 (event-driven vol spike — high conviction directional) */
  TRIGGER_MACRO_PTS: 3,

  // ── Layer B: Technical Confirmation ──
  /** VWAP alignment: price on correct side = +2, wrong side = 0 (no penalty)
   *  Penalties moved to Layer C — misaligned indicators shouldn't BLOCK entry,
   *  they just don't contribute points. CTP threshold adjusts via total score instead. */
  VWAP_ALIGNED_PTS: 2,
  VWAP_MISALIGNED_PTS: 0,   // was -1 — penalty moved to Layer C
  /** SMA 8/21 cross: trend-aligned = +2, opposite = 0 (no penalty) */
  SMA_ALIGNED_PTS: 2,
  SMA_MISALIGNED_PTS: 0,    // was -1 — penalty moved to Layer C
  /** Momentum: MOM > 0.001 + direction = +2, MOM ~0 = +1, opposite = 0 (no penalty) */
  MOM_ALIGNED_PTS: 2,
  MOM_NEUTRAL_PTS: 1,
  MOM_MISALIGNED_PTS: 0,    // was -2 — penalty moved to Layer C
  /** Momentum threshold for "aligned" (as fraction of price, e.g. 0.001 = 0.1%) */
  MOM_ALIGNED_THRESHOLD: 0.001,
  /** MACD alignment: histogram aligned with direction = +2, fresh cross = +1, opposing = 0 */
  MACD_ALIGNED_PTS: 2,
  /** MACD fresh cross bonus: histogram just crossed zero in favorable direction = +1 */
  MACD_CROSS_PTS: 1,
  /** MACD misaligned: histogram opposing direction = 0 (no penalty in Layer B) */
  MACD_MISALIGNED_PTS: 0,
  /** RSI alignment: RSI in favorable zone = +2, neutral = +1, opposing = 0 */
  RSI_ALIGNED_PTS: 2,
  /** RSI neutral: RSI between 40-60 = +1 (no strong signal either way) */
  RSI_NEUTRAL_PTS: 1,
  /** RSI misaligned: RSI overbought+LONG or oversold+SHORT = 0 (no penalty in Layer B) */
  RSI_MISALIGNED_PTS: 0,
  /** Volume confirming: last candle > 150% of 10-candle avg = +1 */
  VOLUME_CONFIRM_PTS: 1,
  /** Volume confirming threshold: ratio of current to average (1.5 = 150%) */
  VOLUME_CONFIRM_RATIO: 1.5,

  // ── Layer B: Entry Gate ──
  /** Minimum Layer B score required to open a position.
   *  Layer B max = 3(trigger) + 2(VWAP) + 2(SMA) + 2(MOM) + 2(MACD) + 2(RSI) + 1(vol) + 1(real) + 2(funnel) = 17
   *  Need ≥ 6/17 to enter — filters out weak signals.
   *  Typical good entry: trigger(3) + VWAP(2) + MACD(1) = 6 ✓
   *  Typical weak: trigger(1) + MOM(1) = 2 ✗ */
  MIN_SCORE: 6,

  // ── Disabled Categories — blocked from opening positions (trigger pts = 0) ──
  /** Explicit list for UI filtering and logging.
   *  AGGRESSIVE_ABSORPTION: 64/118 trades, −2.83 USDT — asymmetric SL/TP problem
   *  CROWD_BIAS: re-enabled 2026-07-31 — production data (48,766 real paper trades)
   *  contradicts the old "crowd is usually wrong" note: CROWD = +$2,062, 68% WR, PF 1.37.
   *  CROWD-ONLY PROFILE (data-driven): every other category was net-negative on the
   *  same 48,766-trade dataset (TAKER −$129, ABSORB −$112, INFLOW −$156, ICEBERG −$69,
   *  FUNDING −$27, OI −$4, OB-IMBAL −$10, SWEEP −$13, ICE-REV −$14) → all blocked
   *  from opening until forward paper evidence says otherwise. UI still shows signals. */
  DISABLED_CATEGORIES: ['AGGRESSIVE_ABSORPTION', 'ICEBERG_DETECTED', 'ICEBERG_REVERSAL', 'WHALE_INFLOW', 'OI_SPIKE', 'FUNDING_EXTREME', 'TAKER_IMBALANCE', 'LIQUIDATION_CASCADE', 'OI_VELOCITY', 'ORDERBOOK_IMBALANCE', 'WHALE_SWEEP', 'REALTIME_LIQUIDATION', 'OPTIONS_FLOW', 'GATE_FLOW', 'BITGET_FLOW', 'DYDX_PERP_FLOW', 'MACRO_EVENT'] as const,

  // ── Layer C: Boosters (don't affect entry gate, raise CTP threshold) ──
  /** Multi-signal: 2 different triggers on same pair within 5s = +2 */
  MULTI_SIGNAL_PTS: 2,
  /** Multi-signal detection window (ms) */
  MULTI_SIGNAL_WINDOW_MS: 5_000,
  /** MIN_SCORE override for LIQUIDATION_CASCADE: 4 instead of default 5 */
  CASCADE_MIN_SCORE: 4,
  /** Historical edge pairs: BTC, PEPE, FET, FIL = +1 */
  EDGE_PAIR_PTS: 1,
  /** Whitelist of pairs with historically proven positive PnL */
  EDGE_PAIR_WHITELIST: ['BTC-USDT', 'PEPE-USDT', 'FET-USDT', 'FIL-USDT'] as const,
  /** Spread tight: bid-ask < 0.02% = +1, spread > 0.05% = -1 */
  SPREAD_TIGHT_PTS: 1,
  SPREAD_WIDE_PTS: -1,
  /** Spread thresholds (as fraction, e.g. 0.0002 = 0.02%) */
  SPREAD_TIGHT_THRESHOLD: 0.0002,  // 0.02%
  SPREAD_WIDE_THRESHOLD: 0.0005,   // 0.05%

  // ── Layer C: Misalignment Penalties (reduce total score → lower CTP threshold) ──
  // These were in Layer B as -1/-1/-2 but blocked entry too aggressively.
  // Now in Layer C: they lower the total score, which lowers CTP threshold,
  // meaning the system takes profit faster on misaligned trades.
  /** VWAP misalignment penalty: fighting VWAP = -1 in Layer C */
  VWAP_MISALIGNED_PENALTY: -1,
  /** SMA misalignment penalty: trading against trend = -1 in Layer C */
  SMA_MISALIGNED_PENALTY: -1,
  /** MOM misalignment penalty: trading against momentum = -2 in Layer C */
  MOM_MISALIGNED_PENALTY: -2,
  /** MACD misalignment penalty: histogram opposing direction = -1 in Layer C */
  MACD_MISALIGNED_PENALTY: -1,
  /** RSI misalignment penalty: RSI overbought+LONG or oversold+SHORT = -1 in Layer C */
  RSI_MISALIGNED_PENALTY: -1,

  // ── Legacy fields (kept for backwards compat, values preserved) ──
  SIZE_THRESHOLD_PTS: 2,
  CVD_DIVERGENCE_PTS: 2,
  LIQ_CLUSTER_PTS: 1,
  RECONFIRM_PTS: 1,
  CROSS_EXCHANGE_PTS: 2,
  RECONFIRM_WINDOW_MS: 30_000,
  OI_SPIKE_THRESHOLD_PCT: 5,
  FUNDING_EXTREME_THRESHOLD: 0.001,
  CROSS_EXCHANGE_WALL_RATIO: 3,
  TA_VWAP_PTS: 0,
  TA_MOM_PTS: 0,
  TA_SMA_PTS: 0,
  TA_MIN_CONVERGENCE: 2,
} as const

// ─── TA Indicator Configuration ──────────────────────────────────────────────
// Technical analysis indicators for entry confirmation and exit signals

export const TA_CONFIG = {
  /** SMA short period */
  SMA_FAST: 8,
  /** SMA slow period */
  SMA_SLOW: 21,
  /** Momentum lookback period (number of prices) */
  MOM_PERIOD: 10,
  /** Max price history to keep for TA calculations.
   *  MUST be >= 34 (MACD slow=26 + signal warmup=8) for MACD to work.
   *  Increased from 50 to 55 to ensure MACD has sufficient history after slicing. */
  MAX_PRICE_HISTORY: 55,
  /** Rolling VWAP window size (ticks). Was cumulative = session avg, now rolling. */
  VWAP_ROLLING_WINDOW: 50,
  /** Momentum as % of price threshold — below this = no momentum signal */
  MOM_MIN_PCT: 0.001,          // 0.1% minimum move to count as momentum
  /** MOM divergence threshold: MOM is this % below its rolling peak */
  MOM_DIV_THRESHOLD: 0.3,     // 30% below MOM peak = divergence
  /** VWAP cross exit: DISABLED — VWAP with fake volume = session average */
  VWAP_CROSS_EXIT: false,
  /** MOM divergence exit: DISABLED — momPeak never resets, perpetual divergence */
  MOM_DIV_EXIT: false,

  // ── MACD Configuration (same timeframe as VWAP/SMA/MOM) ──
  /** MACD fast EMA period */
  MACD_FAST: 12,
  /** MACD slow EMA period */
  MACD_SLOW: 26,
  /** MACD signal line EMA period */
  MACD_SIGNAL: 9,

  // ── RSI Configuration (same timeframe as VWAP/SMA/MOM) ──
  /** RSI period (Wilder's smoothing) */
  RSI_PERIOD: 14,
  /** RSI overbought threshold — above this, LONG signals are weakened */
  RSI_OVERBOUGHT: 70,
  /** RSI oversold threshold — below this, SHORT signals are weakened */
  RSI_OVERSOLD: 30,
  /** 15m candle duration in milliseconds */
  CANDLE_15M_MS: 15 * 60 * 1000,
  /** Max 15m candle closes to keep for RSI calculation */
  MAX_CANDLE_15M_HISTORY: 100,

  // ── RSI 15m Signal Thresholds (user-defined) ──
  /** RSI 15m overbought threshold — RSI15m >= 76.50 → SHORT signal (overvaluation) */
  RSI_15M_OVERBOUGHT: 76.50,
  /** RSI 15m oversold threshold — RSI15m <= 26.50 → LONG signal (wyprzedane) */
  RSI_15M_OVERSOLD: 26.50,
  /** RSI 15m virtual signal TP threshold (% price move in predicted direction) */
  RSI_15M_TP_PCT: 2.0,
  /** RSI 15m virtual signal SL threshold (% price move against prediction) */
  RSI_15M_SL_PCT: 6.5,

  // ── MACD 15m Virtual Signal Configuration ──
  // MACD is computed on closed 15m candles (NOT tick-by-tick) to filter noise.
  // Trigger = MACD line ↔ Signal line cross (classic), NOT histogram↔zero.
  // Minimum candle history required: MACD_SLOW (26) + MACD_SIGNAL (9) = 35 closes.
  /** MACD 15m virtual signal TP threshold (% price move in predicted direction) */
  MACD_15M_TP_PCT: 2.0,
  /** MACD 15m virtual signal SL threshold (% price move against prediction) */
  MACD_15M_SL_PCT: 6.5,
  /** MACD 15m histogram magnitude filter — |histogram| must be >= this % of price.
   *  Filters out micro-crosses that are just noise.
   *  Default 0.02%: for BTC @ $50000, histogram must be >= $10. */
  MACD_15M_HIST_MIN_PCT: 0.02,
  /** MACD 15m TTL — auto-close signal after N 15m candles if no TP/SL hit.
   *  Default 4 = 60 minutes. Prevents stale signals from polluting stats. */
  MACD_15M_TTL_CANDLES: 4,
} as const

export const DANGER = {
  /** Distance to cluster threshold for CRITICAL level (%) */
  CRITICAL_THRESHOLD: 0.5,
  /** Distance to cluster threshold for WARNING level (%) */
  WARNING_THRESHOLD: 1.5,
} as const

export const HEATMAP = {
  /** Number of liquidation bars in heatmap */
  BAR_COUNT: 24,
  /** Price step as fraction of current price */
  PRICE_STEP_FRACTION: 0.002,
  /** Gaussian decay for liq distribution */
  GAUSSIAN_DECAY: 2.5,
  /** Probability of spike in liq bar */
  SPIKE_PROBABILITY: 0.15,
  /** Min liq volume to render a bar */
  MIN_RENDER_LIQ: 50,
} as const

export const UI = {
  /** Pair selector visible count */
  PAIR_SELECTOR_VISIBLE: 8,
  /** Grid filter indices for heatmap axis labels */
  HEATMAP_AXIS_LABEL_STEP: 4,
  /** Position price history slice */
  POSITION_PRICE_HISTORY: 60,
  /** Recent anomaly slice for pair count */
  RECENT_ANOMALY_SLICE: 40,
  /** Recent anomaly slice for active pair symbols */
  ACTIVE_PAIR_SLICE: 60,
} as const

// ─── Signal Convergence Funnel ────────────────────────────────────────────────
// Signals enter a per-pair "waiting room". Only when 2+ different-category
// signals hit the same pair within the funnel window does a CONVICTION form,
// which then triggers position opening.

export const FUNNEL = {
  /** Rolling window in ms — signals older than this are pruned from the funnel */
  WINDOW_MS: 15_000,  // 15 seconds (was 45s — fast signal rotation, no stale queues)
  /** Minimum number of DIFFERENT categories required to form a conviction.
   *  ICEBERG categories excluded from this count — they don't count as convergence.
   *  Non-ICEBERG categories (ABSORB, INFLOW, OI, FUNDING) must meet this threshold.
   *  Value 2: true convergence — need 2 different non-ICEBERG signals to open position. */
  MIN_CONVERGENCE: 2,
  /** How often to prune expired signals from funnel (ms) */
  PRUNE_INTERVAL_MS: 3_000,  // 3s (was 5s — faster cleanup)
  /** Max signals per pair in the funnel (prevents memory bloat) */
  MAX_SIGNALS_PER_PAIR: 5,   // 5 (was 10 — less congestion)
  /**
   * Category combo bonuses — when specific categories converge, extra confidence.
   * Key = sorted category names joined with '+'
   */
  COMBO_BONUSES: {
    'AGGRESSIVE_ABSORPTION+ICEBERG_DETECTED': 2,    // Microstructure double-confirm
    'ICEBERG_DETECTED+OI_SPIKE': 1,                  // Hidden liq + OI surge = strong entry
    'AGGRESSIVE_ABSORPTION+OI_SPIKE': 1,              // Absorption + OI = new positions entering
    'FUNDING_EXTREME+OI_SPIKE': 2,                    // Funding + OI = crowded trade, contrarian
    'ICEBERG_DETECTED+WHALE_INFLOW': 2,               // Whale deposit + hidden liq = imminent move
    'AGGRESSIVE_ABSORPTION+WHALE_INFLOW': 1,          // Whale in + absorbing = accumulation
    'AGGRESSIVE_ABSORPTION+TAKER_IMBALANCE': 2,       // Absorption + taker pressure = confirmed aggression
    'CROWD_BIAS+FUNDING_EXTREME': 3,                  // Crowd momentum + funding extreme = strong directional conviction
    'CROWD_BIAS+LIQUIDATION_CASCADE': 2,              // Crowd + cascade = momentum confirmed by liquidations
    'TAKER_IMBALANCE+LIQUIDATION_CASCADE': 2,         // Taker pressure + cascade = directional momentum
    'OI_VELOCITY+TAKER_IMBALANCE': 2,                 // Rapid OI + aggressive flow = institutional entry
    'AGGRESSIVE_ABSORPTION+CROWD_BIAS': 2,            // Absorption + crowd momentum = smart money + crowd aligned
    // ── New combos with cross-exchange + options + macro ──
    'REALTIME_LIQUIDATION+AGGRESSIVE_ABSORPTION': 3,   // RT liq + absorption = confirmed cascade
    'REALTIME_LIQUIDATION+WHALE_SWEEP': 3,              // RT liq + Bybit sweep = multi-exchange cascade
    'OPTIONS_FLOW+LIQUIDATION_CASCADE': 2,              // Options + liq = informed flow getting rekt
    'OPTIONS_FLOW+OI_SPIKE': 2,                          // Options + OI = institutional positioning
    'GATE_FLOW+ORDERBOOK_IMBALANCE': 2,                  // Cross-exchange OB divergence
    'BITGET_FLOW+ORDERBOOK_IMBALANCE': 2,                // Cross-exchange OB divergence
    'GATE_FLOW+BITGET_FLOW': 2,                           // Two alt-exchanges agree = strong signal
    'DYDX_PERP_FLOW+TAKER_IMBALANCE': 2,                 // dYdX + Binance taker = cross-venue aggression
    'MACRO_EVENT+LIQUIDATION_CASCADE': 3,                 // Macro event + cascade = major move
    'MACRO_EVENT+REALTIME_LIQUIDATION': 3,                // Macro event + RT liq = confirmed direction
    'REALTIME_LIQUIDATION+OPTIONS_FLOW': 2,               // RT liq + options = max conviction
  } as Record<string, number>,
} as const

// ─── Execution Mode: Maker vs Taker ──────────────────────────────────────────
// Maker (Limit Post-Only) saves 64% in fees but requires chase algorithm
// to handle price movement between signal detection and order fill.

export const EXECUTION = {
  /** Limit order chase: max re-quote attempts before falling back to taker */
  CHASE_MAX_ATTEMPTS: 3,
  /** Ticks between re-quote attempts (500ms tick = 1.5s total chase window) */
  CHASE_TICKS_BETWEEN: 3,
  /** Offset from current price for limit order (in bps) — inside spread */
  LIMIT_OFFSET_BPS: 1,  // 0.01% inside spread = almost guaranteed fill
  /** Post-Only flag: reject if would cross (ensures maker fee) */
  POST_ONLY: true,
  /** If chase fails after max attempts, fall back to taker */
  FALLBACK_TO_TAKER: true,
  /** Maker requote: how far to chase (max bps from original price) */
  CHASE_MAX_BPS: 5,  // max 0.05% from initial price
} as const

// ─── Dynamic Exit Engine ──────────────────────────────────────────────────────
// Three-layer exit system to escape the R:R 1:1 trap:
// Layer 1: Trailing Shield — SL follows price, locks in profit
// Layer 2: CVD/OI Reversal Exit — close when flow reverses
// Layer 3: Partial TP — close 50% at TP1, remainder trails

export const DYNAMIC_EXIT = {
  // ── Layer 0: Breakeven Stop ──
  /** When price moves this % in favorable direction, move SL to entry (breakeven).
   *  LEVERAGE-SCALED: higher leverage = need more price conviction before moving SL.
   *  Old values were too aggressive: 0.1% at 100x triggered on noise, causing constant BE exits.
   *
   *  At 1x-5x: 2.0% price move = meaningful, SL moves to entry
   *  At 10x: 0.5% price move (5% position PnL) → meaningful profit before protecting
   *  At 20x: 0.4% price move (8% position PnL)
   *  At 40x+: 0.3% price move (12%+ position PnL)
   *  At 100x: 0.3% price move (30% position PnL) → strong conviction before BE */
  BREAKEVEN_ACTIVATE_PNL_PCT: 2.0,   // base for 1x-5x
  /** Buffer above/below entry for breakeven stop (in bps of entry price).
   *  LEVERAGE-SCALED: wider buffer at high leverage to survive normal tick noise.
   *  Old 5 bps (0.05%) was too tight — one tick of noise hits BE.
   *
   *  At 1x-5x: 5 bps (0.05%) — low leverage, small moves, tight is fine
   *  At 10x: 20 bps (0.20%) — survives 2-3 ticks of noise
   *  At 20x: 20 bps (0.20%)
   *  At 40x+: 30 bps (0.30%) — survives 3-4 ticks of noise at high vol
   *  At 100x: 30 bps (0.30%) */
  BREAKEVEN_BUFFER_BPS: 5,              // base for 1x-5x (0.05%)

  // ── Layer 0.5: Collective Portfolio TP ──
  /** Close ALL open positions when total portfolio PnL (net of fees) exceeds this threshold.
   *  DYNAMIC: scales with both total notional AND average confidence score.
   *  Formula: max(scoreBasedMin, totalNotional × COLLECTIVE_TP_PCT)
   *  Score-based minimum: higher signal confidence → higher CTP threshold → let winners run.
   *  At $800 total (old 100x): max($2, $800×0.25%) = max($2, $2) = $2.00
   *  At $8000 total (new 100x): max($2, $8000×0.25%) = max($2, $20) = $20.00
   *  This prevents CTP from firing on tiny moves when position sizes are large. */
  COLLECTIVE_TP_PCT: 0.0025,            // 0.25% of total notional
  COLLECTIVE_TP_MIN_USD: 2.00,          // base minimum $2.00 threshold (for small positions)

  // ── Score-Based CTP Threshold ──
  /** Instead of a fixed minimum, the CTP threshold scales with average confidence score.
   *  Strong signals (score 9-10) deserve patience — wait for $3.00+ profit.
   *  Weak signals (score 3-4) should be closed quickly — take $1.00 and run.
   *  Formula: baseMin + (avgScore - MIN_SCORE) × SCORE_CTP_SCALE_PER_POINT
   *  Score range in practice: MIN_SCORE(3) to ~10 (size=2 + cvd=2 + crossEx=2 + liq=1 + reconfirm=1 + combo=2)
   *  At score 3 (weak):  $2.00 + (3-3) × $0.30 = $2.00 (base)
   *  At score 5 (medium): $2.00 + (5-3) × $0.30 = $2.60
   *  At score 7 (strong): $2.00 + (7-3) × $0.30 = $3.20
   *  At score 9-10 (very strong): $2.00 + (9-3) × $0.30 = $3.80 — wait for big profit
   *  At score 10+: $2.00 + (10-3) × $0.30 = $4.10 — rare, but deserved patience */
  SCORE_CTP_SCALE_PER_POINT: 0.30,      // $0.30 extra threshold per score point above MIN_SCORE
  /** Maximum score-based CTP threshold cap — prevents runaway thresholds at extreme scores */
  SCORE_CTP_MAX_USD: 5.00,

  // ── Layer 1: Trailing Shield (PRIMARY EXIT — fixed SL disabled) ──
  /** Trailing is the ONLY profitable exit strategy (+6.79 USDT vs STOP LOSS −17.98 USDT).
   *  Fixed SL deactivated — trailing activates from position open (price PnL 0%).
   *  Expressed as % of PRICE MOVE (not position PnL). Compared against priceChangePercent.
   *  At 1x: 0% price move (immediate trailing), at 10x: same */
  TRAILING_ACTIVATE_PRICE_PCT: 0,  // 0% = trailing active immediately from open
  /** Trailing distance as fraction of favorable price excursion */
  TRAILING_DISTANCE_PCT: 0.5,    // trail 50% behind peak
  /** Minimum trail distance in bps — prevents too-tight SL */
  TRAILING_MIN_DISTANCE_BPS: 20,  // 0.2% minimum gap

  // ── Layer 2: CVD Reversal Exit ──
  /** Enable CVD-based exit */
  CVD_REVERSAL_EXIT: true,
  /** CVD reversal threshold: retracement of favorable CVD move */
  CVD_REVERSAL_THRESHOLD: 0.5,   // 50% retracement = exit

  // ── Layer 3: Partial TP ──
  /** Close this fraction of position at TP1 */
  PARTIAL_TP_FRACTION: 0.5,       // close 50% at TP1
  /** TP1 threshold as % of PRICE MOVE (not position PnL).
   *  Compared against priceChangePercent, NOT grossPnlPercent.
   *  At 1x: 1% price = 1% PnL, at 5x: 1% price = 5% PnL, at 10x: 1% price = 10% PnL */
  TP1_PRICE_PERCENT: 1.5,         // 1.5% price move = first partial TP
  /** TP2 mode for remainder: TRAILING follows peak, FIXED = static target */
  TP2_MODE: 'TRAILING' as const,
  /** TP2 fixed target as % of PRICE MOVE (only if TP2_MODE = 'FIXED') */
  TP2_FIXED_PRICE_PERCENT: 2.5,

  // ── ICE-REV Signal Exit ──
  /** Close position if ICE-REV convergence fires on same pair against direction */
  ICE_REV_EXIT: true,

  // ── Layer 4: Time-Based Stop Loss (two-level TMO) ──
  TIME_STOP: {
    TMO_WARN_DEFAULT_MS: 120_000,      // 2min — gives time to develop
    TMO_HARD_DEFAULT_MS: 180_000,      // 3min — hard cap
    TMO_WARN_OVERRIDES: {
      WHALE_INFLOW: 90_000,
      LIQUIDATION_CASCADE: 30_000,
    } as Partial<Record<AnomalyCategory, number>>,
    TMO_HARD_OVERRIDES: {
      FUNDING_EXTREME: 180_000,
      LIQUIDATION_CASCADE: 60_000,
    } as Partial<Record<AnomalyCategory, number>>,
    ENABLED: true,
    WARN_CHECKPOINT: {
      CHECKPOINT_MS: 10_000,
      CHECKPOINT_PNL_PCT: 6,
      ENABLED: true,
      MODES: ['AGGRESSIVE'] as TradingMode[],
    },
    TMO_WARN_SCALPER_MS: 20_000,
    TMO_HARD_SCALPER_MS: 30_000,
    TMO_HARD_SCALPER_PROFIT_MS: 60_000,
  },

  // ── Layer 5: Stale Trade Filter ──
  STALE_TRADE: {
    TIME_STOP_MULTIPLIER: 2,
    ENABLED: true,
  },

  // ── Burst TP: if price spikes 3%+ within first 3s, take profit immediately ──
  BURST_TP: {
    ENABLED: true,
    PRICE_PERCENT: 3.0,
    WINDOW_MS: 3_000,
    MODES: ['AGGRESSIVE', 'SCALPER', 'CONTRARIAN'] as TradingMode[],
  },

  // ── Quick Profit Lock ── (disabled — BURST_TP replaces this)
  QUICK_PROFIT: {
    ENABLED: false,
    MODES: ['AGGRESSIVE'] as TradingMode[],
    TIER2: {
      PNL_PCT: 5.0,
      WITHIN_MS: 30_000,
    },
  },

  // ── SL Grace Period ──
  SL_GRACE: {
    DURATION_MS: 15_000,   // 15s — daje pozycji oddech, nie ucina on pierwszym noise
    ENABLED: true,
  },

  // ── Time-Based Breakeven ── (DISABLED — BE removed entirely)
  TIME_BE: {
    AFTER_MS: 45_000,
    ENABLED: false,
  },

  // ── BE Floor Threshold ──
  BE_FLOOR: {
    PNL_USD: -0.10,
  },

  // ── Aggressive Mode Trailing Settings ──
  AGGRESSIVE: {
    TRAILING_ACTIVATE_PRICE_PCT: 0,     // 0% = trailing active immediately (fixed SL disabled)
    TRAILING_DISTANCE_PCT: 0.50,          // trail 50% behind peak — balanced, survives noise
    TRAILING_MIN_DISTANCE_BPS: 30,        // 0.30% minimum gap — wider = less premature exits
  },

  // ── Scalper Mode Trailing Settings ──
  SCALPER: {
    TRAILING_ACTIVATE_PRICE_PCT: 0,       // 0% = trailing active immediately (fixed SL disabled)
    TRAILING_DISTANCE_PCT: 0.20,          // tighter trail — CSV shows avg TP move 0.46%, stop 0.56%
    TRAILING_MIN_DISTANCE_BPS: 20,        // 0.20% hard floor = CSV-optimal SL
    BREAKEVEN_ACTIVATE_PRICE_PCT: 0.12,   // move SL to BE after 0.12% price (1.2% pos PnL @10x)
    BREAKEVEN_BUFFER_BPS: 5,
  },

  // ── Contrarian Mode Trailing Settings ──
  CONTRARIAN: {
    TRAILING_ACTIVATE_PRICE_PCT: 0,      // 0% = trailing active immediately (fixed SL disabled)
    TRAILING_DISTANCE_PCT: 0.4,         // trail 40% behind peak
    TRAILING_MIN_DISTANCE_BPS: 15,      // 0.15% minimum gap
  },

  // ── ICE-REV Entry Delay ──
  ICE_REV_DELAY: {
    ENABLED: true,
    DELAY_MS: 12_000,
  },

  // ── WIF Confirmation Filter ──
  // REMOVED: WIF-USDT pair has been delisted. Filter no longer needed.
} as const

export const CASCADE_PROFILE = {
  ENABLED: true,
  MIN_SCORE: 4,
  POSITION_SIZE_MULTIPLIER: 1.6,
  TMO_WARN_MS: 15_000,
  TMO_HARD_MS: 30_000,
  TMO_HARD_PROFIT_MS: 45_000,
  BREAKEVEN_ACTIVATE_PRICE_PCT: 0.15,
  BREAKEVEN_BUFFER_BPS: 8,
  TRAILING_ACTIVATE_PRICE_PCT: 0.3,
  TRAILING_DISTANCE_PCT: 0.25,
  TRAILING_MIN_DISTANCE_BPS: 6,
  TAKE_PROFIT_PERCENT: 0.4,
  DEFAULT_CASCADE_SL_BPS: 15,
  PAIR_CASCADE_SL_BPS: {
    'PEPE-USDT': 12,
    'FET-USDT': 14,
    'DOGE-USDT': 13,
    'TON-USDT': 10,
    'SOL-USDT': 12,
    'INJ-USDT': 14,
    'LINK-USDT': 12,
    'AVAX-USDT': 13,
    'HYPE-USDT': 13,
    'TRUMP-USDT': 13,
    'WLD-USDT': 13,
  } as Record<string, number>,
  FUNDING_DIRECTION_EXEMPT: true,
  ICE_REV_DELAY_EXEMPT: true,
} as const

// ─── Pair Blacklist (48,766 trade CSV analysis) ─────────────────────────────
// Pairs with negative total PnL across all historical trades — block ALL signals.
export const PAIR_BLACKLIST = [
  'PEPE-USDT',  // -$103
  'ETH-USDT',   // -$96
  'BNB-USDT',   // -$43
  'ADA-USDT',   // -$38
  'ZEC-USDT',   // -$34 (high WR but asymmetric losses)
  'WIF-USDT',   // -$25
  'XRP-USDT',   // -$22
  'BTC-USDT',   // -$19
] as const

// ─── CROWD Bias Whitelist (48,766 trade CSV analysis) ───────────────────────
// CROWD was the dominant trigger. Only profitable pairs allowed.
export const CROWD_WHITELIST = [
  'TAO-USDT',   // +$538
  'FIL-USDT',   // +$386
  'ICP-USDT',   // +$344
  'DOGE-USDT',  // +$328
  'LINK-USDT',  // +$165
  'AVAX-USDT',  // +$151
  'FLUX-USDT',  // +$8
  'SOL-USDT',   // +$21
] as const

// ─── TAKER Whitelist ────────────────────────────────────────────────────────
// Updated from full 48k trade analysis — only pairs with positive total PnL.
export const TAKER_WHITELIST = ['FET-USDT', 'LINK-USDT', 'DOGE-USDT', 'TAO-USDT', 'FIL-USDT'] as const

// ─── Dynamic Trailing Stop ───────────────────────────────────────────────────
// Profit-dependent trailing distance: tightens near entry, loosens on big wins.
// Data from 1000 orders:
//   TRL median exit: +0.22% from entry (80% close between 0-0.31%)
//   STOP median: -0.82% from entry (max -1.47%)
//   Asymmetry: STOP is 3.7x deeper than typical TRL → old 0.5% trailing too wide
//   Longer TRL = more profitable: 0-30s +$0.021, 30-100s +$0.128, 420s+ +$0.198
export const DYNAMIC_TRAILING = {
  /** Trailing distance as fraction when profit < 0.15% — tight, protect entry */
  TIGHT_PCT: 0.0010,      // 0.10% — widened from 0.08% (too tight caused premature exits)
  /** Profit threshold for tight tier (as % of price move) */
  TIER1_THRESHOLD: 0.15,  // 0.15%
  /** Trailing distance as fraction when profit 0.15%-0.40% — normal, let it grow */
  NORMAL_PCT: 0.0015,     // 0.15%
  /** Profit threshold for normal tier (as % of price move) */
  TIER2_THRESHOLD: 0.40,  // 0.40%
  /** Trailing distance as fraction when profit >= 0.40% — loose, catch big moves */
  LOOSE_PCT: 0.0025,      // 0.25%
  /** Whether dynamic trailing is enabled (fallback to mode-specific static if false) */
  ENABLED: true,
  /** Modes where dynamic trailing applies */
  MODES: ['AGGRESSIVE', 'SCALPER'] as TradingMode[],
} as const

// ─── Bollinger Band Signal Configuration ────────────────────────────────────
export const BB_SIGNAL = {
  /** Bollinger Band period for signal detection */
  PERIOD: 20,
  /** Bollinger Band standard deviation multiplier */
  STD_DEV: 2.0,
  /** Hurst exponent period for mean-reversion detection */
  HURST_PERIOD: 50,
  /** Hurst threshold below which price is considered mean-reverting (H < 0.45) */
  HURST_MEAN_REV_THRESHOLD: 0.45,
  /** Minimum data points needed before BB signal can fire (needs BB period + some buffer) */
  MIN_DATA_POINTS: 50,
  /** Cooldown between BB signals on same pair (ms) — BB crosses can persist */
  COOLDOWN_MS: 15_000,
  /** Minimum % price must exceed upper BB to trigger (avoid false marginal crosses) */
  MIN_EXCEED_PCT: 0.1,
} as const

export const SIGNAL_SEMANTICS: Record<AnomalyCategory, SignalSemantics> = {
  AGGRESSIVE_ABSORPTION: 'MOMENTUM',
  WHALE_INFLOW:         'MOMENTUM',
  TAKER_IMBALANCE:      'MOMENTUM',
  LIQUIDATION_CASCADE:  'MOMENTUM',
  ORDERBOOK_IMBALANCE:  'MOMENTUM',   // Follow OB pressure by default; Contrarian mode inverts → fade (play against pressure)
  WHALE_SWEEP:          'MOMENTUM',   // Follow whale direction by default; Contrarian mode inverts → fade (play against whale)
  CROWD_BIAS:           'MOMENTUM',    // Follow top trader direction; Contrarian mode inverts → fade the crowd
  FUNDING_EXTREME:      'CONTRARIAN',
  ICEBERG_DETECTED:     'AMBIGUOUS',
  ICEBERG_REVERSAL:     'CONTRARIAN',
  OI_SPIKE:             'AMBIGUOUS',
  OI_VELOCITY:          'AMBIGUOUS',
  // ── New signal semantics ──
  REALTIME_LIQUIDATION:  'MOMENTUM',     // Follow cascade direction — fastest momentum signal
  OPTIONS_FLOW:          'MOMENTUM',     // Put buying = bearish, call buying = bullish — follow
  GATE_FLOW:             'MOMENTUM',     // OB pressure direction — follow
  BITGET_FLOW:           'MOMENTUM',     // OB pressure direction — follow
  DYDX_PERP_FLOW:        'MOMENTUM',     // Perps flow direction — follow
  MACRO_EVENT:           'AMBIGUOUS',    // Macro can go either way — need confirmation
}

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  OPEN: 'OPEN',
  CLOSING: '⏳ CLOSING',
  LIQUIDATED: 'STOP',
  CLOSED_BURST_TP: 'BURST',
  CLOSED_BREAKEVEN: 'BE',
  CLOSED_COLLECTIVE_TP: 'CTP',
  CLOSED_QUICK_PROFIT: 'QP',
  CLOSED_TP: 'TP',
  CLOSED_TRAILING: 'TRAIL',
  CLOSED_SIGNAL_EXIT: 'SIG',
  CLOSED_MOM_DIV: 'MOM-DIV',
  CLOSED_VWAP_CROSS: 'VWAP-X',
  CLOSED_TIMEOUT: 'TMO',
  CLOSED_STALE: 'STALE',
  CLOSED_MANUAL: 'MANUAL',
}
