// @ts-nocheck — legacy file from previous session, needs refactoring
// ─── Shared Types, Interfaces & Helpers for Crypto Dashboard ──────────────────
// Extracted from the monolithic page.tsx for use across components.

import { Badge } from '@/components/ui/badge'
import { Zap, AlertTriangle, Eye, TrendingDown, TrendingUp, ArrowLeftRight, LayoutGrid, Gauge, Flame } from 'lucide-react'

// ─── TradingView Symbol Map ──────────────────────────────────────────────────

export const TRADINGVIEW_SYMBOL_MAP: Record<string, string> = {
  bitcoin: 'BINANCE:BTCUSDT',
  ethereum: 'BINANCE:ETHUSDT',
  solana: 'BINANCE:SOLUSDT',
  binancecoin: 'BINANCE:BNBUSDT',
  ripple: 'BINANCE:XRPUSDT',
  cardano: 'BINANCE:ADAUSDT',
  dogecoin: 'BINANCE:DOGEUSDT',
  polkadot: 'BINANCE:DOTUSDT',
  'avalanche-2': 'BINANCE:AVAXUSDT',
  chainlink: 'BINANCE:LINKUSDT',
  'shiba-inu': 'BINANCE:SHIBUSDT',
  litecoin: 'BINANCE:LTCUSDT',
  uniswap: 'BINANCE:UNIUSDT',
  stellar: 'BINANCE:XLMUSDT',
  'polygon-pos': 'BINANCE:MATICUSDT',
  tron: 'BINANCE:TRXUSDT',
  toncoin: 'BINANCE:TONUSDT',
  'usd-coin': 'BINANCE:USDCUSDT',
  tether: 'BINANCE:USDTUSD',
  'wrapped-bitcoin': 'BINANCE:WBTCUSDT',
  leo: 'BITFINEX:LEOUSD',
  monero: 'BINANCE:XMRUSDT',
  okb: 'OKX:OKBUSDT',
  cronos: 'CRYPTO:CROUSDT',
  'the-open-network': 'BINANCE:TONUSDT',
  near: 'BINANCE:NEARUSDT',
  aptos: 'BINANCE:APTUSDT',
  arbitrum: 'BINANCE:ARBUSDT',
  optimism: 'BINANCE:OPUSDT',
  injective: 'BINANCE:INJUSDT',
  kaspa: 'BINANCE:KASUSDT',
  immutable: 'BINANCE:IMXUSDT',
  mantle: 'BINANCE:MNTUSDT',
  pepe: 'BINANCE:PEPEUSDT',
  'bonk': 'BINANCE:BONKUSDT',
  render: 'BINANCE:RNDRUSDT',
  fetch: 'BINANCE:FETUSDT',
  'the-graph': 'BINANCE:GRTUSDT',
  aave: 'BINANCE:AAVEUSDT',
  maker: 'BINANCE:MKRUSDT',
  algorand: 'BINANCE:ALGOUSDT',
  filecoin: 'BINANCE:FILUSDT',
  cosmos: 'BINANCE:ATOMUSDT',
  'vechain': 'BINANCE:VETUSDT',
  tezos: 'BINANCE:XTZUSDT',
  'basic-attention-token': 'BINANCE:BATUSDT',
  'internet-computer': 'BINANCE:ICPUSDT',
  hedera: 'BINANCE:HBARUSDT',
  quant: 'BINANCE:QNTUSDT',
  fantom: 'BINANCE:FTMUSDT',
  eos: 'BINANCE:EOSUSDT',
  'the-sandbox': 'BINANCE:SANDUSDT',
  'axie-infinity': 'BINANCE:AXSUSDT',
  'decentraland': 'BINANCE:MANAUSDT',
  gala: 'BINANCE:GALAUSDT',
  theta: 'BINANCE:THETAUSDT',
  elrond: 'BINANCE:EGLDUSDT',
  harmony: 'BINANCE:ONEUSDT',
  iotex: 'BINANCE:IOTXUSDT',
  zilliqa: 'BINANCE:ZILUSDT',
  chiliz: 'BINANCE:CHZUSDT',
  enjincoin: 'BINANCE:ENJUSDT',
  'enjin-coin': 'BINANCE:ENJUSDT',
  holotoken: 'BINANCE:HOTUSDT',
  'holo': 'BINANCE:HOTUSDT',
  ankr: 'BINANCE:ANKRUSDT',
}

export function getTradingViewSymbol(coinId: string, symbol: string, exchange?: string): string {
  if (exchange === 'mexc') {
    return `MEXC:${symbol.toUpperCase()}USDT`
  }
  if (TRADINGVIEW_SYMBOL_MAP[coinId]) return TRADINGVIEW_SYMBOL_MAP[coinId]
  const upperSymbol = symbol.toUpperCase()
  if (upperSymbol.length <= 6) return `BINANCE:${upperSymbol}USDT`
  return `BINANCE:${upperSymbol}USDT`
}

// ─── Coin Data Types ────────────────────────────────────────────────────────

export interface CoinData {
  id: string
  symbol: string
  name: string
  image: string
  current_price: number
  market_cap: number
  market_cap_rank: number
  price_change_percentage_1h: number | null
  price_change_percentage_24h: number | null
  price_change_percentage_7d: number | null
  total_volume: number
  high_24h: number
  low_24h: number
  sparkline_7d: number[] | null
}

export interface DipSignal {
  coin_id: string
  symbol: string
  name: string
  image: string
  current_price: number
  price_change_1h: number | null
  price_change_24h: number | null
  price_change_7d: number | null
  volume_24h: number
  market_cap_rank: number
  signal_type: 'buy_signal' | 'alert' | 'watch'
  estimated_rsi: number
  volume_vs_avg: number
  high_24h: number
  low_24h: number
  sparkline_7d: number[] | null
  confidence_score: number
}

export interface Trade {
  entry_date: string
  entry_price: number
  exit_date: string
  exit_price: number
  exit_reason: 'take_profit' | 'stop_loss' | 'time_stop'
  profit_pct: number
  net_profit_pct: number
  capital_after: number
  fees_paid: number
}

export interface BacktestResults {
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  avg_profit_pct: number
  avg_loss_pct: number
  total_return_pct: number
  max_drawdown_pct: number
  final_capital: number
  profit_factor: number
  sharpe_ratio: number
  best_trade_pct: number
  worst_trade_pct: number
  avg_holding_hours: number
  total_fees: number
  total_slippage: number
  avg_net_profit_pct: number
  breakeven_trades: number
  consecutive_wins: number
  consecutive_losses: number
  data_granularity: 'hourly' | 'daily'
  slippage_pct: number
  wick_simulation: boolean
}

export interface BacktestResponse {
  coin_id: string
  parameters: Record<string, unknown>
  results: BacktestResults
  trades: Trade[]
  equity_curve: { date: string; capital: number }[]
}

// ─── Active Strategy Info ────────────────────────────────────────────────────

export interface ActiveStrategyInfo {
  id: string
  strategyId: string
  name: string
  coinId: string
  symbol: string
  mode: string
  strategyType: string
  status: string
  inPosition: boolean
  entryPrice: number | null
  entryDate: string | null
  currentCapital: number
  totalPnl: number
  totalTrades: number
  winningTrades: number
  lastPrice: number | null
  errorMessage: string | null
}

// ─── Crypto Chart Info ───────────────────────────────────────────────────────

export interface CryptoChartInfo {
  coinId: string
  symbol: string
  name: string
  image: string
  currentPrice: number
  priceChange24h: number | null
}

// ─── Market Ticker ───────────────────────────────────────────────────────────

export interface MarketTicker {
  price: number
  change: number
  changePercent: number
  symbol: string
  name: string
}

// ─── Capital Data ────────────────────────────────────────────────────────────

export interface CapitalData {
  mode: 'demo' | 'real'
  totalEquityUsdt: number
  coins: Array<{
    coin: string
    equity: string
    walletBalance: string
    availableToWithdraw: string
    unrealisedPnl: string
    free: string
    locked: string
  }>
  lastUpdated: string | null
  error: string | null
  loading: boolean
}

// ─── Fear & Greed Types ──────────────────────────────────────────────────────

export interface FearGreedData {
  value: string
  value_classification: string
  timestamp: string
}

export interface FearGreedResponse {
  data: FearGreedData[]
}

// ─── Per-Coin Threshold Types ────────────────────────────────────────────────

export interface CoinThresholds {
  rsi_threshold: number
  drop_24h_threshold: number
  volume_multiplier_threshold: number
}

export const DEFAULT_COIN_THRESHOLDS: CoinThresholds = {
  rsi_threshold: 30,
  drop_24h_threshold: -5,
  volume_multiplier_threshold: 1.5,
}

export function loadThresholds(): Record<string, CoinThresholds> {
  if (typeof window === 'undefined') return {}
  try {
    const saved = localStorage.getItem('trading-thresholds')
    if (saved) return JSON.parse(saved)
  } catch {}
  return {}
}

export function saveThresholds(thresholds: Record<string, CoinThresholds>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('trading-thresholds', JSON.stringify(thresholds))
  } catch {}
}

export function getCoinThreshold(coinId: string, thresholds: Record<string, CoinThresholds>): CoinThresholds {
  return thresholds[coinId] || DEFAULT_COIN_THRESHOLDS
}

// ─── Strategy Config Types ───────────────────────────────────────────────────

export interface StrategyConfig {
  id: string
  name: string
  coin_id: string
  strategy_type: string
  take_profit_pct: number
  stop_loss_pct: number
  max_holding_hours: number
  fee_pct: number
  initial_capital: number
  days: number
  compound: boolean
  trailing_stop_pct: number
  dip_threshold_1h: number
  dip_threshold_24h: number
  ma_period: number
  volume_threshold: number
  deviation_threshold: number
  lookback_periods: number
  breakout_confirm_bars: number
  grid_spacing_pct: number
  grid_levels: number
  hurst_period: number
  hurst_threshold: number
  bb_period: number
  bb_std: number
  leverage?: number
  futures_alloc_pct?: number
  ema_fast?: number
  ema_slow?: number
  rsi_period?: number
  rsi_overbought?: number
  rsi_oversold?: number
  futures_sl_pct?: number
  futures_tp_pct?: number
  max_futures_hours?: number
  funding_rate_pct?: number
  slippage_pct: number
  simulate_wicks: boolean
}

export interface StrategyResult {
  strategyId: string
  loading: boolean
  error: string | null
  data: BacktestResponse | null
  retryCount?: number
}

export interface OptimizeResultItem {
  params: {
    coin_id: string
    days: number
    strategy_type: string
    dip_threshold_1h?: number
    dip_threshold_24h?: number
    take_profit_pct?: number
    stop_loss_pct?: number
    initial_capital: number
    compound: boolean
    max_holding_hours?: number
    fee_pct: number
    ma_period?: number
    volume_threshold?: number
    deviation_threshold?: number
    lookback_periods?: number
    breakout_confirm_bars?: number
    grid_spacing_pct?: number
    grid_levels?: number
    hurst_period?: number
    hurst_threshold?: number
    bb_period?: number
    bb_std?: number
    [key: string]: unknown
  }
  score: number
  total_return_pct: number
  win_rate: number
  total_trades: number
  profit_factor: number
  max_drawdown_pct: number
  sharpe_ratio: number
  final_capital: number
}

export interface OptimizeResponse {
  coin_id: string
  days: number
  strategy_type: string
  total_combinations: number
  valid_strategies: number
  best: OptimizeResultItem | null
  top_20: OptimizeResultItem[]
}

// ─── Coin Options ────────────────────────────────────────────────────────────

export const COIN_OPTIONS = [
  { id: 'bitcoin', label: 'BTC' },
  { id: 'ethereum', label: 'ETH' },
  { id: 'solana', label: 'SOL' },
  { id: 'binancecoin', label: 'BNB' },
  { id: 'ripple', label: 'XRP' },
  { id: 'cardano', label: 'ADA' },
  { id: 'dogecoin', label: 'DOGE' },
  { id: 'polkadot', label: 'DOT' },
  { id: 'avalanche-2', label: 'AVAX' },
  { id: 'chainlink', label: 'LINK' },
  { id: 'shiba-inu', label: 'SHIB' },
  { id: 'litecoin', label: 'LTC' },
  { id: 'uniswap', label: 'UNI' },
  { id: 'stellar', label: 'XLM' },
  { id: 'polygon-pos', label: 'MATIC' },
  { id: 'hyperliquid', label: 'HYPE' },
]

// ─── Strategy Type Helpers ───────────────────────────────────────────────────


export const STRATEGY_TYPE_OPTIONS = [
  { id: 'dip_buying', label: 'Dip Buying', badge: 'DIP', badgeColor: 'bg-red-600 text-white', icon: TrendingDown },
  { id: 'momentum', label: 'Momentum', badge: 'MOM', badgeColor: 'bg-sky-600 text-white', icon: TrendingUp },
  { id: 'mean_reversion', label: 'Mean Reversion', badge: 'MR', badgeColor: 'bg-purple-600 text-white', icon: ArrowLeftRight },
  { id: 'breakout', label: 'Breakout', badge: 'BRK', badgeColor: 'bg-amber-600 text-white', icon: Zap },
  { id: 'grid', label: 'Grid Trading', badge: 'GRID', badgeColor: 'bg-cyan-600 text-white', icon: LayoutGrid },
  { id: 'hurst_hcoo_lb', label: 'Hurst HCOO_LB', badge: 'HURST', badgeColor: 'bg-indigo-600 text-white', icon: Gauge },
  { id: 'futures_compound', label: 'Futures Compound', badge: 'FUT', badgeColor: 'bg-rose-600 text-white', icon: Flame },
] as const

export function getStrategyTypeInfo(type: string) {
  return STRATEGY_TYPE_OPTIONS.find(t => t.id === type) || STRATEGY_TYPE_OPTIONS[0]
}

export function strategyTypeBadge(type: string) {
  const info = getStrategyTypeInfo(type)
  return <Badge className={`text-[10px] gap-0.5 ${info.badgeColor}`}>{info.badge}</Badge>
}

export function strategyTypeIcon(type: string, size: 'sm' | 'md' = 'md') {
  const info = getStrategyTypeInfo(type)
  const Icon = info.icon
  return <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
}

export function strategyTypeLabel(type: string): string {
  const info = getStrategyTypeInfo(type)
  return info.label
}

export function getStrategyParamsFromConfig(config: StrategyConfig): Record<string, unknown> {
  const type = config.strategy_type || 'dip_buying'
  switch (type) {
    case 'momentum':
      return { ma_period: config.ma_period, volume_threshold: config.volume_threshold }
    case 'mean_reversion':
      return { ma_period: config.ma_period, deviation_threshold: config.deviation_threshold }
    case 'breakout':
      return { lookback_periods: config.lookback_periods, breakout_confirm_bars: config.breakout_confirm_bars }
    case 'grid':
      return { grid_spacing_pct: config.grid_spacing_pct, grid_levels: config.grid_levels }
    case 'hurst_hcoo_lb':
      return { hurst_period: config.hurst_period, hurst_threshold: config.hurst_threshold, bb_period: config.bb_period, bb_std: config.bb_std }
    case 'futures_compound':
      return {
        leverage: config.leverage, futures_alloc_pct: config.futures_alloc_pct,
        ema_fast: config.ema_fast, ema_slow: config.ema_slow,
        rsi_period: config.rsi_period, rsi_overbought: config.rsi_overbought, rsi_oversold: config.rsi_oversold,
        futures_sl_pct: config.futures_sl_pct, futures_tp_pct: config.futures_tp_pct,
        max_futures_hours: config.max_futures_hours, funding_rate_pct: config.funding_rate_pct,
        dip_threshold_24h: config.dip_threshold_24h,
      }
    case 'dip_buying':
    default:
      return { dip_threshold_1h: config.dip_threshold_1h, dip_threshold_24h: config.dip_threshold_24h }
  }
}

export function getDefaultParamsForType(type: string): Partial<StrategyConfig> {
  switch (type) {
    case 'momentum':
      return { ma_period: 20, volume_threshold: 1.5, take_profit_pct: 5, stop_loss_pct: 3, max_holding_hours: 72 }
    case 'mean_reversion':
      return { ma_period: 20, deviation_threshold: 2, stop_loss_pct: 5, take_profit_pct: 3, max_holding_hours: 168 }
    case 'breakout':
      return { lookback_periods: 20, breakout_confirm_bars: 2, take_profit_pct: 8, stop_loss_pct: 3, max_holding_hours: 72 }
    case 'grid':
      return { grid_spacing_pct: 2, grid_levels: 5, take_profit_pct: 5, stop_loss_pct: 5, max_holding_hours: 168 }
    case 'hurst_hcoo_lb':
      return { hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2, take_profit_pct: 5, stop_loss_pct: 3, max_holding_hours: 72 }
    case 'futures_compound':
      return {
        leverage: 3, futures_alloc_pct: 50,
        ema_fast: 9, ema_slow: 21, rsi_period: 14,
        rsi_overbought: 70, rsi_oversold: 30,
        futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24,
        funding_rate_pct: 0.01,
        dip_threshold_24h: -5, take_profit_pct: 3, stop_loss_pct: 5, max_holding_hours: 72,
      }
    case 'dip_buying':
    default:
      return { dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 5, stop_loss_pct: 2, max_holding_hours: 48 }
  }
}

// ─── Default Strategiessss ──────────────────────────────────────────────────────

export const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    id: 'doge-agg-1', name: 'DOGE Aggressive', strategy_type: 'dip_buying', coin_id: 'dogecoin',
    dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 9.5, stop_loss_pct: 1,
    max_holding_hours: 48, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'eth-agg-1', name: 'ETH Aggressive', strategy_type: 'dip_buying', coin_id: 'ethereum',
    dip_threshold_1h: 0, dip_threshold_24h: -2, take_profit_pct: 7.5, stop_loss_pct: 1,
    max_holding_hours: 48, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'sol-agg-1', name: 'SOL Aggressive', strategy_type: 'dip_buying', coin_id: 'solana',
    dip_threshold_1h: 0, dip_threshold_24h: -1, take_profit_pct: 8.3, stop_loss_pct: 0.5,
    max_holding_hours: 48, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2, slippage_pct: 0.05, simulate_wicks: true,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
  },
  {
    id: 'btc-mom-1', name: 'BTC Momentum', strategy_type: 'momentum', coin_id: 'bitcoin',
    dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 5, stop_loss_pct: 3,
    max_holding_hours: 72, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'eth-mr-1', name: 'ETH Mean Reversion', strategy_type: 'mean_reversion', coin_id: 'ethereum',
    dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 3, stop_loss_pct: 5,
    max_holding_hours: 168, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'sol-brk-1', name: 'SOL Breakout', strategy_type: 'breakout', coin_id: 'solana',
    dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 8, stop_loss_pct: 3,
    max_holding_hours: 72, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'eth-grid-1', name: 'ETH Grid', strategy_type: 'grid', coin_id: 'ethereum',
    dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 5, stop_loss_pct: 5,
    max_holding_hours: 168, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'btc-hurst-1', name: 'BTC Hurst HCOO_LB', strategy_type: 'hurst_hcoo_lb', coin_id: 'bitcoin',
    take_profit_pct: 5, stop_loss_pct: 3, max_holding_hours: 72,
    fee_pct: 0.1, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    dip_threshold_1h: 0, dip_threshold_24h: -3,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5,
    hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
  {
    id: 'sol-futures-1', name: 'SOL Futures Compound', strategy_type: 'futures_compound', coin_id: 'solana',
    take_profit_pct: 3, stop_loss_pct: 5, max_holding_hours: 72,
    fee_pct: 0.05, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
    dip_threshold_1h: 0, dip_threshold_24h: -5,
    ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
    lookback_periods: 20, breakout_confirm_bars: 2,
    grid_spacing_pct: 2, grid_levels: 5,
    hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2,
    leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
    futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    slippage_pct: 0.05, simulate_wicks: true,
  },
]

// ─── Price / Formatting Helpers ──────────────────────────────────────────────

export function formatPrice(price: number): string {
  if (price >= 1) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 0.01) return '$' + price.toFixed(4)
  return '$' + price.toFixed(6)
}

export function formatPct(val: number | null): string {
  if (val === null) return 'N/A'
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%'
}

export function pctColor(val: number | null): string {
  if (val === null) return 'text-muted-foreground'
  return val >= 0 ? 'text-emerald-500' : 'text-red-500'
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return '$' + (vol / 1e9).toFixed(1) + 'B'
  if (vol >= 1e6) return '$' + (vol / 1e6).toFixed(1) + 'M'
  return '$' + vol.toLocaleString()
}

// ─── Signal Helpers ──────────────────────────────────────────────────────────

export function signalBadge(type: 'buy_signal' | 'alert' | 'watch') {
  switch (type) {
    case 'buy_signal':
      return <Badge className="bg-red-600 text-white hover:bg-red-700 gap-1"><Zap className="size-3" />BUY SIGNAL</Badge>
    case 'alert':
      return <Badge className="bg-amber-500 text-white hover:bg-amber-600 gap-1"><AlertTriangle className="size-3" />ALERT</Badge>
    case 'watch':
      return <Badge className="bg-yellow-400 text-black hover:bg-yellow-500 gap-1"><Eye className="size-3" />WATCH</Badge>
  }
}

export function exitReasonLabel(reason: string): string {
  switch (reason) {
    case 'take_profit': return 'Take Profit'
    case 'stop_loss': return 'Stop Loss'
    case 'time_stop': return 'Time Stop'
    default: return reason
  }
}

export function exitReasonColor(reason: string): string {
  switch (reason) {
    case 'take_profit': return 'text-emerald-500'
    case 'stop_loss': return 'text-red-500'
    case 'time_stop': return 'text-amber-500'
    default: return 'text-muted-foreground'
  }
}

// ─── Confidence Score Calculator ─────────────────────────────────────────────

export function calculateConfidenceScore(signal: DipSignal): number {
  let score = 0
  const rsi = signal.estimated_rsi
  if (rsi < 30) score += 30
  else if (rsi < 40) score += 20
  else if (rsi < 50) score += 10
  const vol = signal.volume_vs_avg
  if (vol > 2) score += 25
  else if (vol > 1.5) score += 20
  else if (vol > 1) score += 10
  else score += 5
  const drop24 = Math.abs(signal.price_change_24h || 0)
  if (drop24 > 10) score += 25
  else if (drop24 > 5) score += 20
  else if (drop24 > 2) score += 10
  else score += 5
  const drop1h = Math.abs(signal.price_change_1h || 0)
  if (drop1h > 3) score += 20
  else if (drop1h > 1) score += 10
  return Math.min(100, score)
}

export function confidenceColor(score: number): string {
  if (score < 30) return 'bg-red-500'
  if (score < 60) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function confidenceTextColor(score: number): string {
  if (score < 30) return 'text-red-500'
  if (score < 60) return 'text-amber-500'
  return 'text-emerald-500'
}

// ─── Fear & Greed Helpers ────────────────────────────────────────────────────

export function fearGreedColor(value: number): string {
  if (value <= 25) return 'text-red-500'
  if (value <= 45) return 'text-orange-500'
  if (value <= 55) return 'text-yellow-500'
  if (value <= 75) return 'text-emerald-400'
  return 'text-emerald-600'
}

export function fearGreedBg(value: number): string {
  if (value <= 25) return 'bg-red-500'
  if (value <= 45) return 'bg-orange-500'
  if (value <= 55) return 'bg-yellow-500'
  if (value <= 75) return 'bg-emerald-400'
  return 'bg-emerald-600'
}

export function fearGreedLabel(value: number): string {
  if (value <= 25) return 'Ekstremalny Strach'
  if (value <= 45) return 'Strach'
  if (value <= 55) return 'Neutralnie'
  if (value <= 75) return 'Greed'
  return 'Ekstremalna Greed'
}

// ─── Mini Sparkline Chart ────────────────────────────────────────────────────

// Use React useId() in components for unique IDs. This counter is only for
// non-component usage and is accessed via a function to satisfy ESLint immutability.
let _sparklineIdCounter = 0
function nextSparklineId(): string {
  _sparklineIdCounter++
  return `sparkline-${_sparklineIdCounter}`
}

export function MiniChart({ data, isPositive, width = 80, height = 32 }: {
  data: number[] | null
  isPositive: boolean
  width?: number
  height?: number
}) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    )
  }
  const maxPoints = 50
  const step = Math.max(1, Math.floor(data.length / maxPoints))
  const sampled = data.filter((_, i) => i % step === 0)
  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const range = max - min || 1

  const points = sampled.map((v, i) => {
    const x = (i / (sampled.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  const color = isPositive ? '#10b981' : '#ef4444'
  const gradientId = nextSparklineId()
  const areaPath = `M0,${height} L${points.split(' ').map(p => p).join(' L')} L${width},${height} Z`
  const linePath = `M${points.split(' ').join(' L')}`

  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── Wykresy Tab Constants ───────────────────────────────────────────────────

export const TIME_PERIODS = [
  { label: '1D', days: 1 },
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
] as const

export const TIMEFRAMES = [
  { label: '1m', interval: '1' },
  { label: '5m', interval: '5' },
  { label: '15m', interval: '15' },
  { label: '30m', interval: '30' },
  { label: '1h', interval: '60' },
  { label: '4h', interval: '240' },
  { label: '1D', interval: 'D' },
] as const

export interface IndicatorData {
  hurst: Array<{ date: string; value: number }>
  rsi: Array<{ date: string; value: number }>
  macd: Array<{ date: string; macd: number; signal: number; histogram: number }>
  bb: Array<{ date: string; upper: number; middle: number; lower: number; price: number }>
}
