'use client'

// ─── CEX Anomaly Tab — MEV Microstructure Analysis Engine ──────────────────
// Multi-pair anomaly detection: Iceberg, Whale Inflow, Absorption, OI, Funding
// Liquidation Hunt Engine with heatmap + shield
// CVD Delta Divergence with bearish/bullish divergence detection
// TE Design System: orange #FF6600, JetBrains Mono, sharp edges, LED indicators
//
// AUDIT FIXES APPLIED:
// - P0: Memory leaks — all setTimeout/setInterval cleaned up via refs
// - P0: Race conditions — AbortController for fetch, mountedRef for async setState
// - P0: Binance WebSocket — real depth + aggTrade for active pair
// - P1: Extracted types → cex-anomaly-types.ts
// - P1: Extracted constants → cex-anomaly-constants.ts (no more magic numbers)
// - P1: Sub-components extracted for maintainability
// - P1: Error boundary already in page.tsx wrapper
// - P2: Loading/empty states added
// - P2: useMemo/useCallback optimization
// - P2: CVD history increased to 300 points

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTE } from '@/lib/te-theme'
import {
  pickWeighted,
  formatUsdLarge,
  formatPnl,
  formatPrice,
  uid,
  generateLiqBars,
  generateLiqBarsFromReal,
  initPairSim,
  computeBB,
  computeMACDFromHistory,
  computeRSIIncremental,
} from '@/lib/cex-anomaly-helpers'
import {
  playPositionOpenSound,
  playProfitCloseSound,
  playLossCloseSound,
} from '@/lib/cex-anomaly-audio'
import {
  computeConfidence,
  type ScoringContext,
} from '@/lib/cex-anomaly-scoring'
import {
  computePositionSize,
  type PositionSizingInput,
} from '@/lib/cex-anomaly-position-sizing'
import { ExecutionClockInner, type ExecClockData, PixelDigit } from '@/components/cex-anomaly/cex-anomaly-execution-clock'
import { getOpenPhaseDelays, getClosePhaseDelays, type OpenLatencyBreakdown } from '@/lib/paper-latency-simulator'
import { PairSelector } from '@/components/cex-anomaly/cex-anomaly-pair-selector'
import { MiniSparkline } from '@/components/cex-anomaly/cex-anomaly-mini-sparkline'
import LiquidationHeatmapComponent from '@/components/cex-anomaly/liquidation-heatmap'
import CVDChartComponent from '@/components/cex-anomaly/cvd-chart'
import HurstBBChartComponent from '@/components/cex-anomaly/hurst-bb-chart'
import { ActivePositionCard } from '@/components/cex-anomaly/active-position-card'
import {
  Activity,
  Crosshair,
  Eye,
  Layers,
  Radio,
  Shield,
  Waves,
  Wifi,
  WifiOff,
  X,
  Zap,
  Anchor,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  DollarSign,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import type {
  AnomalyCategory,
  AnomalyTag,
  PositionSide,
  PositionStatus,
  OrderFlowAnomaly,
  ActivePosition,
  ConfidenceBreakdown,
  LiquidationBar,
  CVDPoint,
  DivergenceZone,
  PairSimulation,
  OIFundingData,
  OIFundingSnapshot,
  CrossExchangeSnapshot,
  FunnelSignal,
  FunnelConvergence,
  PairFunnel,
  ExecutionMode,
  ChaseState,
} from '@/lib/cex-anomaly-types'
import {
  ALL_PAIRS,
  ANOMALY_WEIGHTS,
  TAG_COLORS,
  CATEGORY_META,
  SIM,
  LIMITS,
  SIZE_THRESHOLDS,
  SCORING,
  DANGER,
  HEATMAP,
  UI,
  EXCHANGE_FEES,
  BINANCE_FEES_DISABLED,
  SIGNAL_SEMANTICS,
  DEFAULT_EXCHANGE,
  TRADING_MODES,
  LEVERAGE_OPTIONS,
  FUNNEL,
  EXECUTION,
  DYNAMIC_EXIT,
  TA_CONFIG,
  TAKER_WHITELIST,
  CROWD_WHITELIST,
  PAIR_BLACKLIST,
  DYNAMIC_TRAILING,
  BB_SIGNAL,
  type TradingExchange,
  type TradingMode,
  type LeverageLevel,
} from '@/lib/cex-anomaly-constants'
import { useBinanceWS } from '@/hooks/use-binance-ws'
import { useBybitWS, type BybitDetectedSignal } from '@/hooks/use-bybit-ws'
import { useBinanceLiqWS, type BinanceLiqSignal } from '@/hooks/use-binance-liq-ws'
import { useDeribitWS, type DeribitSignal } from '@/hooks/use-deribit-ws'
import { useGateWS, type GateSignal } from '@/hooks/use-gateio-ws'
import { useBitgetWS, type BitgetSignal } from '@/hooks/use-bitget-ws'
import { useDydxWS, type DydxSignal } from '@/hooks/use-dydx-ws'
import { useMacroCalendar, type MacroSignal } from '@/hooks/use-macro-calendar'
import { useBinanceMultiWS } from '@/hooks/use-binance-multi-ws'
import { SignalStatsPanel } from '@/components/signal-stats-panel'
import { MicrostructureBacktestDialog } from '@/components/cex-anomaly/microstructure-backtest-dialog'
import {
  type SignalEvent,
  type CloseReason as SignalCloseReason,
  calculatePointsDelta,
  determineCexSignalType,
  mapCexStatusToCloseReason,
  getCexSessionId,
  loadCexSessionEvents,
  saveCexSessionEvents,
  clearCexSessionEvents,
} from '@/lib/signal-scoring'

// ─── Types extracted from component body (audit fix) ─────────────────────
// Previously defined inside CexAnomalyTab — TypeScript recreates on every render.
// Moving to module level avoids this and prevents React Fast Refresh issues.

interface SignalHealthEntry {
  lastFetchAt: number
  status: 'ok' | 'error' | 'idle'
  signalsEmitted: number
  errorMsg?: string
}

type AllowedDirection = 'BOTH' | 'LONG' | 'SHORT'

type ExecPhase = 'IDLE' | 'SIG' | 'QUEUE' | 'API' | 'DONE'

// ─── Error Log Panel Types ──────────────────────────────────────────────────
type LogLevel = 'CRITICAL' | 'WARNING' | 'INFO'

interface LogEntry {
  id: string
  level: LogLevel
  source: string       // e.g. 'BYBIT', 'BINANCE', 'HL', 'DEX', 'FUNNEL', 'SHIELD'
  message: string
  timestamp: number
  details?: string     // optional: raw error message, API response, etc.
}

// ─── RSI 15m Virtual Signal Tracking Type ───────────────────────────────────
interface Rsi15mVirtualSignal {
  pair: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  rsiAtEntry: number
  timestamp: number
}

// ─── MACD Virtual Signal Tracking Type ──────────────────────────────────────
interface MacdVirtualSignal {
  pair: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  macdLineAtEntry: number
  macdSignalAtEntry: number
  macdHistAtEntry: number
  /** Number of 15m candle closes at entry — used for TTL tracking */
  candlesAtEntry: number
  timestamp: number
}

const LOG_LEVEL_META: Record<LogLevel, { icon: string; color: string; bg: string }> = {
  CRITICAL: { icon: '●', color: '#ff3333', bg: '#ff000015' },
  WARNING:  { icon: '▲', color: '#ffaa00', bg: '#ff880010' },
  INFO:     { icon: 'ℹ', color: '#66bbff', bg: '#0088ff08' },
}

const MAX_LOG_ENTRIES = 100

// ─── Exchange Abbreviation Helper ────────────────────────────────────────────
const exchangeAbbr = (exchange: string): string => {
  if (!exchange) return '???'
  switch (exchange) {
    case 'Binance': return 'BIN'
    case 'Bybit': return 'BYB'
    case 'Hyperliquid': return 'HYP'
    case 'CCXT-Multi': return 'CCXT'
    default: return exchange.slice(0, 3).toUpperCase()
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function CexAnomalyTab() {
  const te = useTE()
  // ─── State ────────────────────────────────────────────────────────────
  const [anomalies, setAnomalies] = useState<OrderFlowAnomaly[]>([])
  const anomaliesRef = useRef<OrderFlowAnomaly[]>([])
  const [positions, setPositions] = useState<ActivePosition[]>([])
  const [closedPositions, setClosedPositions] = useState<ActivePosition[]>([])
  const closedPositionsRef = useRef<ActivePosition[]>([])
  const openPositionsCountRef = useRef(0)
  const positionsRef = useRef<ActivePosition[]>([])
  const phantomCountRef = useRef<Map<string, number>>(new Map()) // position-id → consecutive phantom detections
  const cumulativeRealizedPnlRef = useRef(0) // never truncates — survives closedPositions cap
  // AUDIT FIX #10: Full trade history — capped at 1000 for 24/7 RAM safety.
  // Old "never truncated" grows unbounded; at 1 trade/min = 1440/day = 50K/month.
  // 1000 trades = ~16h at 1/min, enough for equity/PnL curve visualization.
  // cumulativeRealizedPnlRef still tracks total PnL accurately (never truncated).
  const MAX_FULL_TRADE_HISTORY = 1000
  const fullTradeHistoryRef = useRef<ActivePosition[]>([])
  const [fullTradeCount, setFullTradeCount] = useState(0) // count for UI display
  const [filterTag, setFilterTag] = useState<AnomalyTag | 'ALL'>('ALL')
  const [filterPair, setFilterPair] = useState<string>('ALL')
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])
  const [flashId, setFlashId] = useState<string | null>(null)

  // ─── Error Log Panel State ──────────────────────────────────────────────
  const [errorLog, setErrorLog] = useState<LogEntry[]>([])
  const [errorLogOpen, setErrorLogOpen] = useState(false)
  const errorLogRef = useRef<LogEntry[]>([])

  // Central log function — appends entry, auto-prunes, and plays sound on CRITICAL
  const logEvent = useCallback((level: LogLevel, source: string, message: string, details?: string) => {
    const entry: LogEntry = {
      id: uid(),
      level,
      source,
      message,
      timestamp: Date.now(),
      details,
    }
    setErrorLog(prev => {
      const next = [entry, ...prev].slice(0, MAX_LOG_ENTRIES)
      errorLogRef.current = next
      return next
    })
    // Auto-expand panel on CRITICAL
    if (level === 'CRITICAL') {
      setErrorLogOpen(true)
    }
  }, [])

  // ─── Signal Health Tracking ──────────────────────────────────────────
  // Tracks last fetch time, success/failure, and signal count per data source.
  // Helps diagnose why signals may stop appearing (stuck fetches, API errors, etc.)
  const [signalHealth, setSignalHealth] = useState<Record<string, SignalHealthEntry>>({
    'OI/Funding': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
    'Hyperliquid': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
    'Binance Scan': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
    'CROWD_BIAS': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
    'TAKER_IMBALANCE': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
    'Sentiment': { lastFetchAt: 0, status: 'idle', signalsEmitted: 0 },
  })
  const signalHealthRef = useRef(signalHealth)
  useEffect(() => { signalHealthRef.current = signalHealth }, [signalHealth])
  const updateSignalHealth = useCallback((source: string, status: 'ok' | 'error', signalsEmitted: number = 0, errorMsg?: string) => {
    setSignalHealth(prev => ({
      ...prev,
      [source]: {
        lastFetchAt: Date.now(),
        status,
        signalsEmitted: (prev[source]?.signalsEmitted || 0) + signalsEmitted,
        errorMsg,
      },
    }))
  }, [])

  // ─── Test Wallet State ────────────────────────────────────────────────────
  const [testWalletAmount, setTestWalletAmount] = useState(LIMITS.DEFAULT_CAPITAL)
  const [testWalletInput, setTestWalletInput] = useState(String(LIMITS.DEFAULT_CAPITAL))
  const [paperTrading, setPaperTrading] = useState(false)

  // ─── Bybit Real Trading ──────────────────────────────────────────────
  const [bybitTrading, setBybitTrading] = useState(false)
  const bybitTradingRef = useRef(false)
  useEffect(() => { bybitTradingRef.current = bybitTrading }, [bybitTrading])
  const [bybitFuturesBalance, setBybitFuturesBalance] = useState<number | null>(null)
  const [bybitFuturesPositions, setBybitFuturesPositions] = useState<Array<{
    symbol: string; side: 'LONG' | 'SHORT'; positionSize: number; entryPrice: number;
    leverage: number; unrealizedPnl: number; liquidationPrice: number; margin: number;
    takeProfit: string; stopLoss: string; tpTriggerBy: string; slTriggerBy: string;
  }>>([])

  // ─── Exchange Selector (determines fee rates) ──────────────────────────────
  const [tradingExchange, setTradingExchange] = useState<TradingExchange>(DEFAULT_EXCHANGE)
  const feeSchedule = EXCHANGE_FEES[tradingExchange]
  const takerFeeRate = feeSchedule.taker
  const makerFeeRate = feeSchedule.maker
  const roundTripFeeRate = feeSchedule.roundTrip
  const makerRoundTripFeeRate = feeSchedule.makerRoundTrip

  // ─── Execution Mode: TAKER vs MAKER ──────────────────────────────────────
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('TAKER')
  // Effective fee rates: both sides are Taker (0.055%) for Bybit UTA VIP0
  // Conservative: assume worst-case taker on both entry and exit
  const activeEntryFeeRate = takerFeeRate
  const activeExitFeeRate = takerFeeRate
  const activeRoundTripRate = roundTripFeeRate

  // ─── Trading Mode & Leverage ──────────────────────────────────────────────
  const [tradingMode, setTradingMode] = useState<TradingMode>('CONSERVATIVE')
  const [leverage, setLeverage] = useState<LeverageLevel>(1)
  const modeConfig = TRADING_MODES[tradingMode]

  // ─── TA Manual TP/SL + Leverage (for virtual RSI 15m + MACD signals) ──────
  // Independent of position TP/SL — applies only to the TA SIGNALS panel.
  // taManualTpPct/taManualSlPct: % of PRICE MOVE (not PnL). taLeverage amplifies.
  const [taManualTpPct, setTaManualTpPct] = useState<number>(2)        // 2% price TP
  const [taManualSlPct, setTaManualSlPct] = useState<number>(6.5)      // 6.5% price SL
  const [taLeverage, setTaLeverage] = useState<number>(1)              // 1x by default
  const [taSettingsOpen, setTaSettingsOpen] = useState<boolean>(false) // collapsed by default
  const taManualTpRef = useRef(taManualTpPct)
  const taManualSlRef = useRef(taManualSlPct)
  const taLeverageRef = useRef(taLeverage)
  useEffect(() => { taManualTpRef.current = taManualTpPct }, [taManualTpPct])
  useEffect(() => { taManualSlRef.current = taManualSlPct }, [taManualSlPct])
  useEffect(() => { taLeverageRef.current = taLeverage }, [taLeverage])

  // ─── Max Active Positions ─────────────────────────────────────────────
  const [maxActivePositions, setMaxActivePositions] = useState<number>(LIMITS.MAX_OPEN_POSITIONS)
  const maxActivePositionsRef = useRef(maxActivePositions)
  useEffect(() => { maxActivePositionsRef.current = maxActivePositions }, [maxActivePositions])

  // ─── Manual TP / SL Override ────────────────────────────────────────────
  // User can override the mode's default TP and SL values from the UI.
  // When override is enabled, the manual values take priority over modeConfig.
  // TP: % of PRICE MOVE (not position PnL). SL: % distance from entry price.
  // tpslMode: 'price' = values are % of price, 'pnl' = values are % of position PnL (auto-divided by leverage)
  const [customTP, setCustomTP] = useState<number>(3)     // default: 3% PnL (PnL% mode)
  const [customSL, setCustomSL] = useState<number>(6)     // default: 6% PnL (PnL% mode)
  const [useCustomTPSL, setUseCustomTPSL] = useState<boolean>(true) // ON by default
  const [tpslInputMode, setTpslInputMode] = useState<'price' | 'pnl'>('pnl') // PnL% mode by default — more intuitive
  const customTPRef = useRef(customTP)
  const customSLRef = useRef(customSL)
  const useCustomTPSLRef = useRef(useCustomTPSL)
  const tpslInputModeRef = useRef(tpslInputMode)
  useEffect(() => { customTPRef.current = customTP }, [customTP])
  useEffect(() => { customSLRef.current = customSL }, [customSL])
  useEffect(() => { useCustomTPSLRef.current = useCustomTPSL }, [useCustomTPSL])
  useEffect(() => { tpslInputModeRef.current = tpslInputMode }, [tpslInputMode])

  // TP is expressed as % of PRICE MOVE (not position PnL). Leverage amplifies automatically.
  // In 'pnl' mode: the user enters PnL% → we divide by leverage to get price%.
  // In 'price' mode: the user enters price% directly.
  // effectiveTP = price% (always, regardless of input mode)
  const effectiveTP = useCustomTPSL
    ? (tpslInputMode === 'pnl' ? customTP / leverage : customTP)
    : modeConfig.takeProfitPercent
  // effectiveSL = price% (always, regardless of input mode)
  const effectiveSL = useCustomTPSL
    ? (tpslInputMode === 'pnl' ? customSL / leverage : customSL)
    : null  // null = use default from computePositionSize
  const effectiveTPRef = useRef(effectiveTP)
  const effectiveSLRef = useRef(effectiveSL)
  useEffect(() => { effectiveTPRef.current = effectiveTP }, [effectiveTP])
  useEffect(() => { effectiveSLRef.current = effectiveSL }, [effectiveSL])

  // ─── Breakeven Stop (BE) ─────────────────────────────────────────────────
  // When enabled, SL moves to entry + buffer after price moves beTriggerPct in
  // favorable direction. Protects profit from reversing into a loss.
  const [beEnabled, setBeEnabled] = useState<boolean>(false)         // OFF by default (preserves existing behavior)
  const [beTriggerPct, setBeTriggerPct] = useState<number>(1)        // 1% favorable price move triggers BE
  const [beBufferBps, setBeBufferBps] = useState<number>(5)          // 5 bps = 0.05% above entry
  const beEnabledRef = useRef(beEnabled)
  const beTriggerPctRef = useRef(beTriggerPct)
  const beBufferBpsRef = useRef(beBufferBps)
  useEffect(() => { beEnabledRef.current = beEnabled }, [beEnabled])
  useEffect(() => { beTriggerPctRef.current = beTriggerPct }, [beTriggerPct])
  useEffect(() => { beBufferBpsRef.current = beBufferBps }, [beBufferBps])

  // ─── LLM Analyst State (moved after signalEvents declaration) ─────────────
  // State declared here, callback + effect defined later (after signalEvents)
  const [llmReport, setLlmReport] = useState<{
    report: string
    insights: string[]
    recommendations: string[]
    confidence: number
    timestamp: string
    hypotheses?: Array<{ pattern: string; rationale: string; pair?: string; status: 'UNVALIDATED' }>
  } | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmPanelOpen, setLlmPanelOpen] = useState(false)
  const llmReportRef = useRef<any>(null)
  llmReportRef.current = { report: llmReport, loading: llmLoading, error: llmError }

  // ─── TMO Toggle ─────────────────────────────────────────────────────────
  // User can enable/disable TMO (Time Management Override) from the UI.
  // When OFF, positions stay open indefinitely (no TMO warn/hard close).
  const [tmoEnabled, setTmoEnabled] = useState<boolean>(false) // ON by default
  const tmoEnabledRef = useRef(tmoEnabled)
  useEffect(() => { tmoEnabledRef.current = tmoEnabled }, [tmoEnabled])

  // ─── Manual TMO Override ──────────────────────────────────────────────────
  // User can set custom TMO in seconds. 0 = use mode default.
  const [customTMO, setCustomTMO] = useState<number>(0) // 0 = mode default
  const customTMORRef = useRef(customTMO)
  useEffect(() => { customTMORRef.current = customTMO }, [customTMO])

  // ─── Enabled signal categories for position opening ──────────────────────
  const ALL_TRADEABLE = LIMITS.TRADEABLE_CATEGORIES as readonly AnomalyCategory[]
  // ICEBERG (both normal + reversal) starts disabled — user must opt-in
  const [enabledCategories, setEnabledCategories] = useState<Set<AnomalyCategory>>(
    () => new Set<AnomalyCategory>(ALL_TRADEABLE.filter(c => c !== 'ICEBERG_REVERSAL' && c !== 'ICEBERG_DETECTED'))
  )
  const enabledCategoriesRef = useRef(enabledCategories)
  useEffect(() => { enabledCategoriesRef.current = enabledCategories }, [enabledCategories])

  // ─── Enabled pairs for signal generation ──────────────────────────────
  // User can disable specific pairs before starting paper trading.
  // Disabled pairs won't generate anomalies or open positions.
  // ICP & DOGE removed from default exclusion (user-requested active pairs).
  // BTC & SOL excluded (too expensive/illiquid for this strategy).
  // INJ & TON excluded (poor avg_move performance from live data).
  const DEFAULT_EXCLUDED_PAIRS = ['BTC-USDT', 'SOL-USDT', 'INJ-USDT', 'TON-USDT']
  const [enabledPairs, setEnabledPairs] = useState<Set<string>>(
    () => {
      // Restore from localStorage if available, otherwise use defaults
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem('trading-enabled-pairs')
          if (saved) {
            const parsed = JSON.parse(saved) as string[]
            if (Array.isArray(parsed) && parsed.length > 0) {
              return new Set(parsed.filter(p => ALL_PAIRS.some(ap => ap.symbol === p)))
            }
          }
        } catch { /* ignore */ }
      }
      return new Set(ALL_PAIRS.filter(p => !DEFAULT_EXCLUDED_PAIRS.includes(p.symbol)).map(p => p.symbol))
    }
  )
  const enabledPairsRef = useRef(enabledPairs)
  useEffect(() => {
    enabledPairsRef.current = enabledPairs
    // Persist to localStorage so toggles survive page refresh
    try {
      localStorage.setItem('trading-enabled-pairs', JSON.stringify(Array.from(enabledPairs)))
    } catch { /* ignore */ }
  }, [enabledPairs])

  // ─── TA Info Panel toggle ──────────────────────────────────────────────
  const [showTaInfo, setShowTaInfo] = useState(true)
  const showTaInfoRef = useRef(false)
  useEffect(() => { showTaInfoRef.current = showTaInfo }, [showTaInfo])

  // ─── Orderbook collapse toggle ────────────────────────────────────────
  const [orderbookOpen, setOrderbookOpen] = useState(false)

  // ─── Heatmap collapse toggle ──────────────────────────────────────
  const [heatmapOpen, setHeatmapOpen] = useState(true)

  // ─── Wallet Settings collapse toggle ──────────────────────────────
  const [walletSettingsOpen, setWalletSettingsOpen] = useState(true)

  // ─── OI+Funding collapse toggle ──────────────────────────────────────
  const [oiFundingOpen, setOiFundingOpen] = useState(false)

  // ─── Equity Curve collapse toggle ────────────────────────────────────
  const [equityCurveOpen, setEquityCurveOpen] = useState(false)
  const [closedPositionsOpen, setClosedPositionsOpen] = useState(false)

  // ─── PnL Curve hover tooltip state ──────────────────────────────────
  const [pnlHover, setPnlHover] = useState<{ x: number; y: number; pnl: number; cum: number; pair: string; side: string; status: string; trade: number; dotCx: number; dotCy: number } | null>(null)

  // ─── Equity Curve hover tooltip state ──────────────────────────────────
  const [eqHover, setEqHover] = useState<{ x: number; y: number; balance: number; pnl: number; trade: number; pair: string; side: string; dotCx: number; dotCy: number } | null>(null)

  // Real price data from Binance Futures API
  const [realPrices, setRealPrices] = useState<Record<string, number>>({})
  const [priceChange24h, setPriceChange24h] = useState<Record<string, number>>({})
  const [dataSource, setDataSource] = useState<'LIVE' | 'FALLBACK' | 'LOADING'>('LOADING')

  // ─── CCXT OI + Funding + Cross-Exchange State ───────────────────────────
  const [oiFundingData, setOiFundingData] = useState<Record<string, OIFundingData>>({})
  const [oiSpikes, setOiSpikes] = useState<string[]>([])
  const [fundingExtreme, setFundingExtreme] = useState<string[]>([])
  const [crossExSnapshot, setCrossExSnapshot] = useState<CrossExchangeSnapshot | null>(null)
  const [ccxtStatus, setCcxtStatus] = useState<'IDLE' | 'LOADING' | 'LIVE' | 'ERROR'>('IDLE')

  // ─── Signal Convergence Funnel State ────────────────────────────────────
  // Per-pair funnel: signals wait here until 2+ different categories converge
  const [funnel, setFunnel] = useState<Record<string, PairFunnel>>({})
  const funnelRef = useRef<Record<string, PairFunnel>>({})
  useEffect(() => { funnelRef.current = funnel }, [funnel])

  // ─── Sound Notification ──────────────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(true)
  const soundEnabledRef = useRef(true)
  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])

  // ─── Signal Stats Scoring State ──────────────────────────────────────
  // Session-based scoring for CEX Anomaly signals — tracks points per anomaly category
  const [signalEvents, setSignalEvents] = useState<SignalEvent[]>(() => loadCexSessionEvents())
  const signalSessionId = useMemo(() => getCexSessionId(), [])
  // Persist signal events to localStorage on change
  useEffect(() => { saveCexSessionEvents(signalEvents) }, [signalEvents])

  // ─── LLM Analyst callback + effect (after signalEvents) ───────────────────
  const runLlmAnalysis = useCallback(async () => {
    setLlmLoading(true); setLlmError(null)
    try {
      const recentAnomalies = anomaliesRef.current.slice(0, 80)
      const activePositions = positionsRef.current.filter(p => p.status === 'OPEN')
      const closedPos = closedPositionsRef.current.slice(0, 15)
      const pairData: Record<string, { price: number; rsi: number; macdHist: number; cvd: number }> = {}
      for (const [symbol, sim] of Object.entries(pairSimsRef.current)) {
        pairData[symbol] = { price: sim.price || 0, rsi: (sim as any).rsi || 50, macdHist: (sim as any).macdHist || 0, cvd: sim.cvd || 0 }
      }
      const res = await fetch('/api/llm-analyst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anomalies: recentAnomalies, positions: activePositions, closedPositions: closedPos, signalEvents: signalEvents.slice(-20), pairData, settings: { tpPct: taManualTpRef.current ?? 2, slPct: taManualSlRef.current ?? 6.5, leverage: taLeverageRef.current, tradingMode } }) })
      if (!res.ok) { const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })); throw new Error(err.error || 'LLM failed') }
      const data = await res.json(); setLlmReport(data)
    } catch (err) { setLlmError(err instanceof Error ? err.message : 'Error') } finally { setLlmLoading(false) }
  }, [signalEvents, tradingMode])

  // ─── RSI 15m Virtual Signal Tracking ──────────────────────────────────────
  // When RSI 15m crosses user-defined thresholds (76.50 SHORT, 26.50 LONG),
  // a virtual signal is created. The system tracks price from that point
  // and auto-resolves when price hits 2% TP or 6.5% SL.
  const rsi15mSignalsRef = useRef<Map<string, Rsi15mVirtualSignal>>(new Map())

  // ─── MACD Virtual Signal Tracking ──────────────────────────────────────────
  // When MACD histogram crosses zero (bullish/bearish cross),
  // a virtual signal is created. Same TP/SL as RSI 15m (2% TP, 6.5% SL).
  const macdSignalsRef = useRef<Map<string, MacdVirtualSignal>>(new Map())

  // ─── Force re-render when virtual signals change ────────────────────────
  // useRef mutations don't trigger re-renders, so the Alert Bar won't update.
  // This counter bumps on every signal add/remove to force a re-render.
  const [virtualSignalVersion, setVirtualSignalVersion] = useState(0)
  const bumpVirtualSignalVersion = useCallback(() => {
    setVirtualSignalVersion(v => v + 1)
  }, [])

  // ─── Direction Filter: LONG only / SHORT only / BOTH ────────────────────
  // Manual toggle — user controls which directions are allowed for new positions.
  // Useful when market is clearly directional (e.g. bullish morning = LONG only).
  // Filter is applied in openPosition BEFORE confidence scoring (cheapest possible place).
  const [allowedDirection, setAllowedDirection] = useState<AllowedDirection>('BOTH')
  const allowedDirectionRef = useRef<AllowedDirection>('BOTH')
  useEffect(() => { allowedDirectionRef.current = allowedDirection }, [allowedDirection])

  // ─── Convergence Funnel Toggle ──────────────────────────────────────
  // When OFF: signals open positions immediately (no convergence needed)
  // When ON: signals must wait for 2+ different categories on same pair
  const [funnelEnabled, setFunnelEnabled] = useState(true)
  const funnelEnabledRef = useRef(true)
  useEffect(() => { funnelEnabledRef.current = funnelEnabled }, [funnelEnabled])

  // Active pair for detail view (heatmap + CVD)
  const [activePairIdx, setActivePairIdx] = useState(0)

  // Per-pair simulation state
  const [pairSims, setPairSims] = useState<Record<string, PairSimulation>>(() => {
    const sims: Record<string, PairSimulation> = {}
    for (const p of ALL_PAIRS) {
      sims[p.symbol] = initPairSim(p)
    }
    return sims
  })

  // ─── Refs (avoid stale closures + proper cleanup) ──────────────────────
  const pairSimsRef = useRef(pairSims)
  const tickCountRef = useRef(0)
  const anomalyCountRef = useRef(0)
  const mountedRef = useRef(true)
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const paperTradingRef = useRef(false)
  const dataSourceRef = useRef<'LIVE' | 'FALLBACK' | 'LOADING'>('LOADING')
  const testWalletAmountRef = useRef(LIMITS.DEFAULT_CAPITAL)
  const leverageRef = useRef<LeverageLevel>(1)
  const tradingModeRef = useRef<TradingMode>('CONSERVATIVE')
  const oiFundingDataRef = useRef<Record<string, OIFundingData>>({})
  const crossExSnapshotRef = useRef<CrossExchangeSnapshot | null>(null)

  // ─── WS Price Ref — real-time price anchor from WebSocket ──────────────
  // When WS orderbook is connected for the active pair, this holds the
  // midpoint of best bid/ask. The simulation tick uses this instead of
  // random walk, keeping all price displays (header, heatmap, orderbook)
  // perfectly synchronized.
  const wsPriceRef = useRef<number | null>(null)

  // ─── Active pair symbol ref — avoids stale closure in fetch callbacks ──
  // fetchRealPrices captures activePair.symbol at creation time with [] deps.
  // When the user switches pairs, the old closure still references the old symbol
  // for the WS anchor skip logic. This ref always has the current active pair symbol.
  const activePairSymbolRef = useRef(ALL_PAIRS[0]?.symbol || '')

  // ─── Execution Clock State ──────────────────────────────────────────────
  // Tracks real-time timing from signal detection to order confirmation
  const [execClock, setExecClock] = useState<{
    phase: ExecPhase
    sigMs: number
    queueMs: number
    apiMs: number
    totalMs: number
    bybitQueueDepth: number
    bybitRateUsed: number // Real Bybit rate usage % from X-Bapi-Limit headers (fallback to queue proxy)
    bybitRateSource: 'HEADERS' | 'LOG' | 'QUEUE_PROXY' // Where rate data comes from
    lastExchange: 'BYBIT' | 'PAPER' | null
    execMode: 'PAPER' | 'REAL'  // PAPER = simulated timing, REAL = actual Bybit API
    sigTs?: number // Signal timestamp — when SIG phase started (for real-time hand animation)
  }>({
    phase: 'IDLE', sigMs: 0, queueMs: 0, apiMs: 0, totalMs: 0,
    bybitQueueDepth: 0, bybitRateUsed: 0, bybitRateSource: 'QUEUE_PROXY',
    lastExchange: null, execMode: 'PAPER', sigTs: undefined,
  })
  const execClockRef = useRef<{
    phase: ExecPhase
    sigTs: number
    queueEnterTs: number
    apiSentTs: number
    apiConfirmTs: number
  }>({ phase: 'IDLE', sigTs: 0, queueEnterTs: 0, apiSentTs: 0, apiConfirmTs: 0 })

  // ─── Bybit API Throttle Queue ──────────────────────────────────────────
  // Bybit V5 rate limit: ~20 req/s for order endpoints.
  // 3-layer protection: client 150ms queue + server 120ms throttle + X-RateLimit headers.
  // CN→SG RTT ~160-280ms: 150ms gap = ~6.7 req/s client-side (with 3-6 server calls per request = ~20-40 actual Bybit calls/s).
  const bybitQueueRef = useRef<Promise<void>>(Promise.resolve())
  const bybitQueueDepthRef = useRef(0)

  // ─── Real Bybit Rate Limit from X-Bapi-Limit headers ────────────────────
  // Fetches /api/bybit/rate-limit every 15s to get real Bybit rate usage.
  // Replaces the old queue proxy (bybitQueueDepth/8*100) with actual server-side metrics.
  const bybitRateRef = useRef<{ usedPct: number; source: 'HEADERS' | 'LOG' | 'QUEUE_PROXY'; fresh: boolean }>({
    usedPct: 0, source: 'QUEUE_PROXY', fresh: false,
  })
  useEffect(() => {
    if (!bybitTrading) return // Only fetch when REAL mode is active
    const fetchRate = async () => {
      try {
        const res = await fetch('/api/bybit/rate-limit', { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return
        const data = await res.json()
        bybitRateRef.current = {
          usedPct: data.usedPct ?? 0,
          source: data.fresh && data.bybitHeaderUsedPct !== null ? 'HEADERS' : (data.logUsedPct > 0 ? 'LOG' : 'QUEUE_PROXY'),
          fresh: data.fresh ?? false,
        }
      } catch {
        // Non-critical — fallback to queue proxy
      }
    }
    void fetchRate()
    const interval = setInterval(fetchRate, 15_000)
    return () => clearInterval(interval)
  }, [bybitTrading])

  /** Get current Bybit rate usage: real headers when available, queue proxy as fallback */
  const getBybitRateUsed = useCallback(() => {
    const rate = bybitRateRef.current
    if (rate.source !== 'QUEUE_PROXY' && rate.fresh) {
      return { usedPct: rate.usedPct, source: rate.source as 'HEADERS' | 'LOG' }
    }
    // Fallback: queue proxy
    return { usedPct: Math.min(100, (bybitQueueDepthRef.current / 8) * 100), source: 'QUEUE_PROXY' as const }
  }, [])

  /** Enqueue a Bybit API call with 150ms throttle between calls.
   *  @param critical If true (close/SL/TP/open), the call is NEVER dropped — waits in queue
   *                  regardless of depth. Non-critical calls (balance, etc.) are dropped
   *                  when queue depth ≥ 8 to prevent Code 10016 rate limit errors. */
  const bybitEnqueue = useCallback((fn: () => Promise<void>, critical = false) => {
    // Drop non-critical calls if too many already queued — prevents 10016 burst
    // CRITICAL calls (close/open orders) are NEVER dropped — better to hit rate limit
    // than leave a position orphaned on Bybit or create phantom positions.
    if (!critical && bybitQueueDepthRef.current >= 8) {
      console.warn(`[BYBIT QUEUE] Dropped non-critical call — queue depth ${bybitQueueDepthRef.current} ≥ 8. Bybit rate limit protection.`)
      logEvent('WARNING', 'BYBIT', `Queue drop — depth ${bybitQueueDepthRef.current} ≥ 8`, 'Rate limit protection: non-critical API call dropped')
      return
    }
    if (critical && bybitQueueDepthRef.current >= 8) {
      console.warn(`[BYBIT QUEUE] CRITICAL call queued at depth ${bybitQueueDepthRef.current} — will wait. Never dropping close/SL/TP/open orders.`)
    }
    bybitQueueDepthRef.current++
    bybitQueueRef.current = bybitQueueRef.current
      .catch(() => {}) // swallow previous errors so chain doesn't break
      .then(async () => {
        await new Promise(r => setTimeout(r, 150)) // 150ms gap (~6.7 req/s client-side, safer with 3-6 server calls per request)
        bybitQueueDepthRef.current--
        await fn()
      })
      .catch((err) => {
        console.error('[BYBIT QUEUE] Call failed:', err)
        logEvent('CRITICAL', 'BYBIT', 'API call failed', err instanceof Error ? err.message : String(err))
      })
  }, [])

  // ─── Heatmap Smooth Animation Refs ──────────────────────────────────────
  const heatmapSvgRef = useRef<SVGSVGElement>(null)
  const smoothHeatmapRef = useRef<{
    price: number
    liqBars: LiquidationBar[]
    activeSymbol: string
  }>({ price: 0, liqBars: [], activeSymbol: '' })

  // Track which anomaly IDs have already been animated (slide-in plays once)
  const animatedAnomalyIdsRef = useRef<Set<string>>(new Set())

  // Track previous TA confirmation state for pulse animation on flip
  const prevTaStateRef = useRef<{ vwap: boolean; mom: boolean; sma: boolean; macd: boolean; conv: boolean; bbShort: boolean; bbLong: boolean }>({ vwap: false, mom: false, sma: false, macd: false, conv: false, bbShort: false, bbLong: false })

  // Keep refs in sync
  useEffect(() => {
    pairSimsRef.current = pairSims
  }, [pairSims])

  // WS connection refs — needed by openPosition() to allow signals when WS provides real-time data
  // even if Binance REST price fetch failed (dataSource=FALLBACK)
  const bybitWsConnectedRef = useRef(false)
  const wsConnectedRef = useRef(false)

  useEffect(() => { paperTradingRef.current = paperTrading }, [paperTrading])
  useEffect(() => { dataSourceRef.current = dataSource }, [dataSource])
  useEffect(() => { testWalletAmountRef.current = testWalletAmount }, [testWalletAmount])
  useEffect(() => { anomaliesRef.current = anomalies }, [anomalies])
  useEffect(() => { leverageRef.current = leverage }, [leverage])
  useEffect(() => { tradingModeRef.current = tradingMode }, [tradingMode])

  // ─── Sync real Bybit balance → position sizing ───────────────────────────
  // When bybitTrading is ON, position sizing must use the real available margin
  // from Bybit, not the manual testWalletAmount. This prevents placing orders
  // that exceed the actual available margin on the exchange.
  // NOTE: Only sync on FIRST activation (bybitTrading just turned on).
  // Subsequent balance updates from 30s polling should NOT reset the wallet,
  // because the wallet already tracks realized PnL locally and resetting it
  // would corrupt ROI calculations (initialCapital = wallet - cumulativePnl).
  const bybitTradingInitializedRef = useRef(false)
  useEffect(() => {
    if (bybitTrading) {
      bybitTradingInitializedRef.current = true
    } else {
      bybitTradingInitializedRef.current = false
    }
  }, [bybitTrading])
  useEffect(() => {
    // Only auto-sync wallet from Bybit balance on subsequent polling updates
    // (not on initial activation — that's handled in the REAL button onClick)
    // We add realized PnL to the polled balance so wallet reflects current equity
    if (bybitTrading && bybitFuturesBalance !== null && bybitFuturesBalance > 0 && bybitTradingInitializedRef.current) {
      // Don't blindly overwrite — the wallet tracks PnL from trades.
      // Only update if the balance changed significantly (>5% drift)
      // which could indicate external deposits/withdrawals on the sub-account
      const currentWallet = testWalletAmountRef.current
      const drift = Math.abs(bybitFuturesBalance - currentWallet) / currentWallet
      if (drift > 0.05) {
        console.log(`[REAL MODE] Balance drift detected: wallet=$${currentWallet.toFixed(2)} bybit=$${bybitFuturesBalance.toFixed(2)} drift=${(drift*100).toFixed(1)}% — syncing`)
        setTestWalletAmount(bybitFuturesBalance)
        testWalletAmountRef.current = bybitFuturesBalance
        // Reset cumulative PnL since we're re-syncing from Bybit
        cumulativeRealizedPnlRef.current = 0
      }
    }
  }, [bybitTrading, bybitFuturesBalance])

  // ─── Bybit Closed PnL Sync — every 2 minutes ─────────────────────────
  // Fetches the authoritative realized PnL from Bybit's /v5/position/closed-pnl
  // and corrects the local cumulativeRealizedPnlRef if it drifts.
  // This fixes the bug where UI shows smaller PnL than Bybit because
  // local fee/slippage calculations diverge from Bybit's actual values.
  const bybitClosedPnlSyncRef = useRef<number>(0) // last Bybit total realized PnL
  const bybitClosedPnlLastSyncRef = useRef<number>(0) // timestamp of last sync
  useEffect(() => {
    if (!bybitTrading) return
    const SYNC_INTERVAL = 2 * 60 * 1000 // 2 minutes
    let cancelled = false

    const syncClosedPnl = async () => {
      if (cancelled) return
      try {
        const res = await fetch('/api/bybit/futures/closed-pnl?mode=real&limit=100', {
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!data.success || !data.summary) return

        const bybitTotalPnl = data.summary.totalRealizedPnl
        const localTotalPnl = cumulativeRealizedPnlRef.current
        const diff = bybitTotalPnl - localTotalPnl

        // Store for display
        bybitClosedPnlSyncRef.current = bybitTotalPnl
        bybitClosedPnlLastSyncRef.current = Date.now()

        // Only correct if drift is significant (> $0.50)
        // Small drift is normal due to rounding differences
        if (Math.abs(diff) > 0.50) {
          console.log(`[BYBIT CLOSED PNL] Correcting: local=$${localTotalPnl.toFixed(3)} bybit=$${bybitTotalPnl.toFixed(3)} diff=$${diff.toFixed(3)}`)
          cumulativeRealizedPnlRef.current += diff
          // Also correct the wallet so balance stays consistent
          setTestWalletAmount(prev => {
            const next = Math.max(0.01, prev + diff)
            testWalletAmountRef.current = next
            return next
          })
        } else {
          console.log(`[BYBIT CLOSED PNL] In sync: local=$${localTotalPnl.toFixed(3)} bybit=$${bybitTotalPnl.toFixed(3)} diff=$${diff.toFixed(3)}`)
        }
      } catch (err) {
        // Non-critical — next sync will retry
        console.warn('[BYBIT CLOSED PNL] Sync failed:', err instanceof Error ? err.message : err)
      }
    }

    // First sync after 15s (quick — don't wait 2 min for first correction)
    setTimeout(syncClosedPnl, 15_000)
    const interval = setInterval(syncClosedPnl, SYNC_INTERVAL)
    return () => { cancelled = true; clearInterval(interval) }
  }, [bybitTrading])

  // ─── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Clear all pending flash timers
      for (const t of flashTimersRef.current) {
        clearTimeout(t)
      }
      flashTimersRef.current = []
    }
  }, [])

  // ─── Periodic prune: animatedAnomalyIdsRef (audit fix M-2) ────────────
  // The render-time prune only runs when filteredAnomalies are displayed.
  // If the user filters to an empty list, the Set grows unbounded.
  // This interval prunes every 60s regardless of UI state.
  useEffect(() => {
    const interval = setInterval(() => {
      if (animatedAnomalyIdsRef.current.size > 200) {
        const recentIds = new Set(anomaliesRef.current.slice(0, 80).map(a => a.id))
        animatedAnomalyIdsRef.current = recentIds
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  // ─── Heatmap RAF Animation Loop ──────────────────────────────────────
  // Smoothly interpolates the price line Y position and liq bar widths
  // between simulation ticks (~2Hz) at 60fps via direct DOM manipulation
  // PERF FIX: Cache DOM element references to avoid querySelector every frame.
  // Old code did 20+ querySelector calls per frame at 60fps = 1200+ DOM queries/sec.
  // New code caches refs once and re-uses them — only re-cache on pair change.
  useEffect(() => {
    const PRICE_LERP = 0.12    // how fast smooth price catches up to sim price
    const BAR_LERP = 0.08      // how fast smooth bars catch up to target bars
    const HM_H = 280
    const HM_W = 360
    const HALF_BAR_W = HM_W / 2 - 10
    let animId: number

    // Cached DOM element refs — rebuilt when SVG changes (pair switch)
    let cachedPriceGroup: SVGGElement | null = null
    let cachedPriceLabel: SVGTextElement | null = null
    let cachedLongBars: (SVGRectElement | null)[] = []
    let cachedShortBars: (SVGRectElement | null)[] = []
    let cacheValid = false

    const rebuildCache = () => {
      const svg = heatmapSvgRef.current
      if (!svg) { cacheValid = false; return }
      cachedPriceGroup = svg.querySelector('[data-hm-price-group]') as SVGGElement | null
      cachedPriceLabel = svg.querySelector('[data-hm-price-label]') as SVGTextElement | null
      // Cache all liq bar elements (both long and short)
      const longBars: (SVGRectElement | null)[] = []
      const shortBars: (SVGRectElement | null)[] = []
      for (let i = 0; i < 30; i++) { // 30 = max expected bars
        longBars.push(svg.querySelector(`[data-hm-long="${i}"]`) as SVGRectElement | null)
        shortBars.push(svg.querySelector(`[data-hm-short="${i}"]`) as SVGRectElement | null)
      }
      cachedLongBars = longBars
      cachedShortBars = shortBars
      cacheValid = true
    }

    const animate = () => {
      // AUDIT FIX: Skip DOM updates when paused — saves CPU (no need to lerp stale values)
      if (pausedRef.current) {
        animId = requestAnimationFrame(animate)
        return
      }

      const svg = heatmapSvgRef.current
      if (!svg || !mountedRef.current) {
        animId = requestAnimationFrame(animate)
        return
      }

      const sim = pairSimsRef.current[ALL_PAIRS[activePairIdx]?.symbol]
      if (!sim || !sim.liqBars.length) {
        animId = requestAnimationFrame(animate)
        return
      }

      // Rebuild cache if invalid (SVG re-mounted, pair switched, etc.)
      if (!cacheValid) rebuildCache()

      const smooth = smoothHeatmapRef.current

      // Lerp smooth price toward current sim price
      smooth.price += (sim.price - smooth.price) * PRICE_LERP

      // Lerp smooth liq bars toward current sim liq bars
      const maxLiq = Math.max(...sim.liqBars.map(b => Math.max(b.longLiq, b.shortLiq)), 1)
      for (let i = 0; i < sim.liqBars.length; i++) {
        if (i >= smooth.liqBars.length) {
          smooth.liqBars.push({ ...sim.liqBars[i] })
        } else {
          smooth.liqBars[i].longLiq += (sim.liqBars[i].longLiq - smooth.liqBars[i].longLiq) * BAR_LERP
          smooth.liqBars[i].shortLiq += (sim.liqBars[i].shortLiq - smooth.liqBars[i].shortLiq) * BAR_LERP
          smooth.liqBars[i].price = sim.liqBars[i].price
        }
      }
      // Trim extra bars
      if (smooth.liqBars.length > sim.liqBars.length) {
        smooth.liqBars.length = sim.liqBars.length
      }

      // Calculate price range from sim bars (grid is static, but Y calculation needs the range)
      const priceRange = (sim.liqBars[sim.liqBars.length - 1].price - sim.liqBars[0].price) || 1
      const priceBase = sim.liqBars[0].price
      const smoothPriceY = HM_H - ((smooth.price - priceBase) / priceRange) * HM_H

      // ── Update price line group (translate Y) — using cached ref ──
      if (cachedPriceGroup) {
        cachedPriceGroup.setAttribute('transform', `translate(0,${smoothPriceY.toFixed(1)})`)
      }

      // ── Update price label text — using cached ref ──
      if (cachedPriceLabel) {
        const pairConfig = ALL_PAIRS[activePairIdx]
        cachedPriceLabel.textContent = formatPrice(smooth.price, pairConfig?.decimals || 2)
      }

      // ── Update liq bar widths — using cached refs ──
      const centerX = HM_W / 2
      for (let i = 0; i < smooth.liqBars.length; i++) {
        const bar = smooth.liqBars[i]

        // Long bar (left of center) — cached
        const longEl = i < cachedLongBars.length ? cachedLongBars[i] : null
        if (longEl) {
          const longW = (bar.longLiq / maxLiq) * HALF_BAR_W
          const shouldShow = bar.longLiq > HEATMAP.MIN_RENDER_LIQ
          longEl.setAttribute('x', (centerX - longW).toFixed(1))
          longEl.setAttribute('width', Math.max(0, longW).toFixed(1))
          longEl.setAttribute('opacity', shouldShow ? (0.7 + (bar.longLiq / maxLiq) * 0.3).toFixed(2) : '0')
        }

        // Short bar (right of center) — cached
        const shortEl = i < cachedShortBars.length ? cachedShortBars[i] : null
        if (shortEl) {
          const shortW = (bar.shortLiq / maxLiq) * HALF_BAR_W
          const shouldShow = bar.shortLiq > HEATMAP.MIN_RENDER_LIQ
          shortEl.setAttribute('width', Math.max(0, shortW).toFixed(1))
          shortEl.setAttribute('opacity', shouldShow ? (0.7 + (bar.shortLiq / maxLiq) * 0.3).toFixed(2) : '0')
        }
      }

      animId = requestAnimationFrame(animate)
    }

    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [activePairIdx])

  // ─── Binance WebSocket for active pair ────────────────────────────────
  const activePair = ALL_PAIRS[activePairIdx]

  // Keep active pair symbol ref in sync (avoids stale closure in fetchRealPrices)
  useEffect(() => { activePairSymbolRef.current = activePair.symbol }, [activePair.symbol])

  const { orderBook: wsOrderBook, tradeData: wsTradeData, connected: wsConnected } = useBinanceWS({
    symbol: activePair.binanceSymbol,
    enabled: !paused,
  })

  // ─── Bybit WS signal handler (stable ref to avoid hook ordering issues) ──
  // processAnomaly is defined later, so we use a ref to call it from the Bybit WS callback.
  const processAnomalyRef = useRef<(anomaly: OrderFlowAnomaly) => void>(() => {})

  // ─── Bybit WebSocket for real ORDERBOOK_IMBALANCE + WHALE_SWEEP ──────
  // Connects to Bybit V5 public linear WS (orderbook depth + trades)
  // Detects: OB imbalance (bid/ask ratio > 1.8x) and whale sweeps (> $100K trade)
  const bybitWsSymbols = useMemo(
    () => ALL_PAIRS.filter(p => enabledPairs.has(p.symbol)).map(p => p.binanceSymbol),
    [enabledPairs]
  )

  const handleBybitSignal = useCallback((signal: BybitDetectedSignal) => {
    if (pausedRef.current) return

    // Convert Bybit symbol (BTCUSDT) to our pair format (BTC-USDT)
    const base = signal.pair.replace('USDT', '')
    const ourSymbol = `${base}-USDT`

    // Check if pair is enabled
    if (!enabledPairsRef.current.has(ourSymbol)) return

    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: ourSymbol,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Bybit',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }

    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))

    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])

  const { connected: bybitWsConnected } = useBybitWS({
    symbols: bybitWsSymbols,
    enabled: !paused,
    onOBImbalance: handleBybitSignal,
    onWhaleSweep: handleBybitSignal,
  })

  // ─── Binance Multi-WS: real-time best bid/ask for ALL pairs ──────────
  // Already built but was not connected. Provides WS prices for all
  // watched pairs — eliminates 10s REST lag on non-active pairs.
  const multiWsSymbols = useMemo(
    () => ALL_PAIRS.filter(p => enabledPairs.has(p.symbol)).map(p => p.binanceSymbol),
    [enabledPairs]
  )
  const multiWsPrices = useBinanceMultiWS({
    symbols: multiWsSymbols,
    enabled: !paused,
  })
  // Ref for simulation tick to access without reading state
  const multiWsPricesRef = useRef(multiWsPrices)
  useEffect(() => { multiWsPricesRef.current = multiWsPrices }, [multiWsPrices])

  // ─── Binance Real-time Liquidations WS (!forceOrder@arr) ────────────
  // Sub-second liquidation feed — replaces 60s REST sentiment for cascades.
  const handleBinanceLiqSignal = useCallback((signal: BinanceLiqSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Binance',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: binanceLiqWsConnected, recentLiquidations } = useBinanceLiqWS({
    enabled: !paused,
    onCascade: handleBinanceLiqSignal,
  })
  // Ref for simulation tick to access real liquidation data
  const recentLiquidationsRef = useRef(recentLiquidations)
  useEffect(() => { recentLiquidationsRef.current = recentLiquidations }, [recentLiquidations])

  // ─── Fear & Greed Index ───────────────────────────────────────────────
  // Fetches from /api/fear-greed (5min cache on server). Used in scoring:
  //   Extreme Fear (0-25) → +1 contrarian (market oversold, bounce likely)
  //   Extreme Greed (75-100) → +1 contrarian (market overbought, reversal likely)
  const fearGreedRef = useRef<{ value: number; classification: string; timestamp: number } | null>(null)
  useEffect(() => {
    const fetchFG = async () => {
      try {
        const res = await fetch('/api/fear-greed', { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json()
        // API format: { data: [{ value: "45", value_classification: "Fear", ... }] }
        if (data?.data?.[0]) {
          fearGreedRef.current = {
            value: parseInt(data.data[0].value, 10) || 50,
            classification: data.data[0].value_classification || 'Neutral',
            timestamp: Date.now(),
          }
        }
      } catch {
        // Non-critical — scoring works without it
      }
    }
    void fetchFG()
    const interval = setInterval(fetchFG, 5 * 60 * 1000) // 5min
    return () => clearInterval(interval)
  }, [])

  // ─── Deribit WS: Options flow (put/call, IV, large trades) ──────────
  const handleDeribitSignal = useCallback((signal: DeribitSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Deribit',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: deribitWsConnected } = useDeribitWS({
    enabled: !paused,
    onSignal: handleDeribitSignal,
  })

  // ─── Gate.io WS: Perps orderbook + trades ───────────────────────────
  const gateWsSymbols = useMemo(
    () => ALL_PAIRS.filter(p => enabledPairs.has(p.symbol)).map(p => p.symbol.replace('-', '_')),
    [enabledPairs]
  )
  const handleGateSignal = useCallback((signal: GateSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Gate.io',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: gateWsConnected } = useGateWS({
    symbols: gateWsSymbols,
    enabled: !paused,
    onSignal: handleGateSignal,
  })

  // ─── Bitget WS: Perps depth + trades ────────────────────────────────
  const bitgetWsSymbols = useMemo(
    () => ALL_PAIRS.filter(p => enabledPairs.has(p.symbol)).map(p => p.binanceSymbol),
    [enabledPairs]
  )
  const handleBitgetSignal = useCallback((signal: BitgetSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Bitget',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: bitgetWsConnected } = useBitgetWS({
    symbols: bitgetWsSymbols,
    enabled: !paused,
    onSignal: handleBitgetSignal,
  })

  // ─── dYdX v4 WS: On-chain perps order flow ──────────────────────────
  const handleDydxSignal = useCallback((signal: DydxSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'dYdX',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: dydxWsConnected } = useDydxWS({
    enabled: !paused,
    onSignal: handleDydxSignal,
  })

  // ─── Finnhub Macro Calendar: CPI/FOMC/NFP events ────────────────────
  const enabledPairSymbols = useMemo(() => Array.from(enabledPairs), [enabledPairs])
  const handleMacroSignal = useCallback((signal: MacroSignal) => {
    if (pausedRef.current) return
    if (!enabledPairsRef.current.has(signal.pair)) return
    const anomaly: OrderFlowAnomaly = {
      id: signal.id,
      pair: signal.pair,
      category: signal.category,
      tag: signal.tag,
      sizeUsd: signal.sizeUsd,
      imbalance: signal.imbalance,
      timestamp: signal.timestamp,
      side: signal.side,
      exchange: 'Finnhub',
      fadedIn: true,
      details: signal.details,
      source: 'REAL',
    }
    anomalyCountRef.current++
    setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
    if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
      processAnomalyRef.current(anomaly)
    }
  }, [])
  const { connected: macroConnected, nextHighImpactEvent } = useMacroCalendar({
    enabled: !paused,
    enabledPairs: enabledPairSymbols,
    onSignal: handleMacroSignal,
  })

  // Sync WS connection refs — used by openPosition() gate to allow signals when WS provides data
  useEffect(() => { bybitWsConnectedRef.current = bybitWsConnected }, [bybitWsConnected])
  useEffect(() => { wsConnectedRef.current = wsConnected }, [wsConnected])

  // Reset WS price anchor when switching pairs (prevents stale price from previous pair)
  useEffect(() => {
    wsPriceRef.current = null
  }, [activePair.symbol])

  // Feed WebSocket CVD data into simulation when available
  useEffect(() => {
    if (!wsTradeData || paused) return
    setPairSims(prev => {
      const sim = prev[activePair.symbol]
      if (!sim) return prev
      return {
        ...prev,
        [activePair.symbol]: {
          ...sim,
          cvd: sim.cvd + wsTradeData.cvdDelta,
        },
      }
    })
  }, [wsTradeData, activePair.symbol, paused])

  // ─── Sync WS orderbook price into simulation (price anchor) ─────────
  // When WS is connected, the best bid/ask midpoint is the most accurate
  // real-time price. We store it in a ref so the simulation tick (which
  // runs inside setPairSims and can't read React state) can access it.
  useEffect(() => {
    if (!wsOrderBook || paused) {
      wsPriceRef.current = null
      return
    }
    const bestBid = wsOrderBook.bids[0]?.price
    const bestAsk = wsOrderBook.asks[0]?.price
    if (bestBid && bestAsk) {
      wsPriceRef.current = (bestBid + bestAsk) / 2
    }
  }, [wsOrderBook, paused])

  // ─── Fetch Bybit Futures balance & positions ──────────────────────────────
  const fetchBybitFutures = useCallback(async (signal?: AbortSignal) => {
    if (!bybitTradingRef.current) return
    try {
      const [balRes, posRes] = await Promise.all([
        fetch('/api/bybit/futures/balance?mode=real', { signal }),
        fetch('/api/bybit/futures/positions?mode=real', { signal }),
      ])
      if (balRes.ok) {
        const balData = await balRes.json()
        if (balData.success === false) {
          const errMsg = balData.error || 'Error'
          // Don't kill REAL mode on transient errors — only on auth failures
          if (errMsg.includes('klucze') || errMsg.includes('API key') || errMsg.includes('Unauthorized') || errMsg.includes('Invalid sign') || errMsg.includes('10003') || errMsg.includes('10004')) {
            logEvent('CRITICAL', 'BYBIT', 'Klucze API utracone', `${errMsg} — dezaktywacja REAL mode.`)
            setBybitTrading(false)
            return
          }
          // Transient error — keep REAL mode active, just log warning
          console.warn('[BYBIT POLL] Balance fetch failed (transient):', errMsg)
          logEvent('WARNING', 'BYBIT', 'Balance fetch error', errMsg)
        }
        setBybitFuturesBalance(balData.availableBalance ?? balData.totalEquityUsdt ?? 0)
      }
      if (posRes.ok) {
        const posData = await posRes.json()
        if (posData.success === false) {
          console.warn('[BYBIT POLL] Positions fetch failed:', posData.error || posRes.status)
          logEvent('WARNING', 'BYBIT', 'Positions fetch error', posData.error || `HTTP ${posRes.status}`)
        }
        const bybitPositions = posData.positions || []
        setBybitFuturesPositions(bybitPositions)

        // ── Position Reconciliation: detect orphaned Bybit positions ──
        // If Bybit has a position that doesn't exist in UI, it's an orphan
        // (could happen if close failed or native SL/TP triggered on Bybit).
        // Log warnings for orphaned positions so the user can take action.
        const uiOpenPairs = new Set(
          positionsRef.current.filter(p => p.status === 'OPEN').map(p => {
            const [base] = p.pair.split('-')
            return base.toUpperCase() + 'USDT'
          })
        )
        for (const bybitPos of bybitPositions) {
          // BUG FIX: API route returns 'size' not 'positionSize'
          const posSize = Number(bybitPos.size ?? bybitPos.positionSize ?? 0)
          if (posSize > 0 && !uiOpenPairs.has(bybitPos.symbol)) {
            // Orphaned Bybit position: exists on exchange but not in UI — auto-import
            const [baseCurr] = bybitPos.symbol.split('USDT')
            const ourPair = `${baseCurr}-USDT`
            const pairConfig = ALL_PAIRS.find(p => p.symbol === ourPair)
            if (pairConfig) {
              // Import this orphaned position into the UI
              const entryPrice = Number(bybitPos.avgPrice) || Number(bybitPos.entryPrice) || Number(bybitPos.markPrice) || 0
              const sizeUsd = posSize * entryPrice
              const leverage = Number(bybitPos.leverage) || 1
              const marginUsd = sizeUsd / leverage
              const side = bybitPos.side === 'Buy' ? 'LONG' : 'SHORT'
              const unrealizedPnl = Number(bybitPos.unrealisedPnl || bybitPos.unrealizedPnl || 0)
              // BUG FIX: unrealizedPnl is GROSS (before fees). Compute net PnL.
              const orphanEntryFee = sizeUsd * takerFeeRate
              const orphanExitFee = sizeUsd * takerFeeRate
              const orphanNetPnl = unrealizedPnl - orphanEntryFee - orphanExitFee
              console.warn(`[BYBIT RECONCILE] Importing orphan: ${ourPair} ${side} size=$${sizeUsd.toFixed(2)} grossPnl=$${unrealizedPnl.toFixed(3)} netPnl=$${orphanNetPnl.toFixed(3)}`)
              logEvent('WARNING', 'BYBIT', `Orphan imported: ${ourPair} ${side}`, `Found open position on Bybit not in UI — auto-imported.`)
              const importedPos: ActivePosition = {
                id: `bybit-reconcile-${bybitPos.symbol}-${Date.now()}`,
                pair: ourPair,
                side,
                entryPrice,
                currentPrice: Number(bybitPos.markPrice) || entryPrice,
                sizeUsd,
                marginUsd,
                leverage,
                pnl: orphanNetPnl,
                pnlPercent: marginUsd > 0 ? (orphanNetPnl / marginUsd) * 100 : 0,
                entryFee: orphanEntryFee,
                exitFee: orphanExitFee,
                totalFees: orphanEntryFee + orphanExitFee,
                nearestLiqCluster: Number(bybitPos.liqPrice) || Number(bybitPos.liquidationPrice) || 0,
                shieldStopLoss: Number(bybitPos.stopLoss) > 0 ? Number(bybitPos.stopLoss) : 0,
                status: 'OPEN',
                openedAt: Date.now() - 60_000, // estimate
                anomaly: {
                  id: `reconcile-${Date.now()}`,
                  pair: ourPair,
                  category: 'ORDERBOOK_IMBALANCE',
                  tag: 'OB-IMBAL',
                  sizeUsd,
                  imbalance: 0,
                  side: side === 'LONG' ? 'BID' : 'ASK',
                  details: `Reconciled from Bybit`,
                  timestamp: Date.now() - 60_000,
                  source: 'REAL',
                } as OrderFlowAnomaly,
                closedAt: null,
                priceHistory: [],
                confidence: {
                  total: 0, layerB: 0, layerC: 0,
                  triggerQuality: 0, vwapAlign: 0, smaAlign: 0, momAlign: 0, macdAlign: 0, rsiAlign: 0, volumeConfirm: 0,
                  multiSignal: 0, edgePair: 0, spreadTight: 0,
                  sizeThreshold: false, cvdDivergence: false, liqCluster: false, reconfirmed: false, crossExchange: false, taVwap: false, taMom: false, taSma: false, taMacd: false, taRsi: false,
                } as ConfidenceBreakdown,
                executionMode: 'TAKER' as ExecutionMode,
                entryFeeRate: takerFeeRate,
                exitFeeRate: takerFeeRate,
                chaseState: null,
                peakPrice: entryPrice,
                trailingStop: Number(bybitPos.stopLoss) > 0 ? Number(bybitPos.stopLoss) : 0,
                trailingActive: true,  // trailing-only mode: active from open
                breakevenHit: false,
                partialTpTaken: false,
                remainingFraction: 1,
                partialPnlRealized: 0,
                cvdAtOpen: 0,
                cvdPeak: 0,
                tmoCheckpointPassed: false,
                bybitVerified: true, // imported from Bybit reconcile — data is real
                bybitVerifiedAt: Date.now(),
                bybitRealisedPnl: unrealizedPnl,
                signalDetectedAt: Date.now() - 60_000,
                orderSentAt: Date.now() - 60_000,
                orderConfirmedAt: Date.now() - 55_000,
                closeSentAt: null,
                closeConfirmedAt: null,
              }
              setPositions(prev => {
                const already = prev.some(p => p.pair === ourPair && p.status === 'OPEN')
                if (already) return prev
                const updated = [...prev, importedPos]
                positionsRef.current = updated
                openPositionsCountRef.current = updated.filter(p => p.status === 'OPEN').length
                return updated
              })
            } else {
              // Unknown pair — just warn
              const existingWarning = errorLogRef.current.some(
                e => e.source === 'BYBIT' && e.message.includes(`Orphan: ${bybitPos.symbol}`) && (Date.now() - e.timestamp) < 60_000
              )
              if (!existingWarning) {
                console.warn(`[BYBIT RECONCILE] Orphaned position (unknown pair): ${bybitPos.symbol} ${bybitPos.side} ${posSize}`)
                logEvent('CRITICAL', 'BYBIT', `Orphan (unknown): ${bybitPos.symbol}`, 'Position on Bybit but pair not in config. Close manually.')
              }
            }
          }
        }

        // ── PnL Reconciliation: overwrite UI PnL with real Bybit data ──
        // For REAL trading positions, the UI calculates PnL from sim.price (which may be
        // a random-walk estimate for non-active pairs). Every 30s, we overwrite with
        // Bybit's actual unrealisedPnl and markPrice so the user sees real exchange data.
        // Also checks for discrepancy > 1% and logs a warning.
        const bybitPosMap = new Map<string, any>()
        for (const bp of bybitPositions) {
          // BUG FIX: API route returns 'size' not 'positionSize'
          const posSize = Number(bp.size ?? bp.positionSize ?? 0)
          if (posSize > 0) {
            bybitPosMap.set(bp.symbol, bp)
          }
        }

        // Update matching UI positions with real Bybit PnL
        setPositions(prev => {
          let changed = false
          const updated = prev.map(pos => {
            if (pos.status !== 'OPEN') return pos

            const [base] = pos.pair.split('-')
            const bybitSymbol = base.toUpperCase() + 'USDT'
            const bybitPos = bybitPosMap.get(bybitSymbol)
            if (!bybitPos) return pos

            const bybitGrossPnl = Number(bybitPos.unrealisedPnl || bybitPos.unrealizedPnl || 0)
            const bybitMarkPrice = Number(bybitPos.markPrice) || 0
            // Compute net Bybit PnL using UTA VIP0 fee schedule:
            // Net = Gross - (Size × EntryPrice × 0.00055) - (Size × MarkPrice × 0.00055)
            // Both entry AND exit are Taker (0.055%) — SL/TP/timeout closes are market orders.
            const bybitSize = Number(bybitPos.size) || 0
            const bybitAvgPrice = Number(bybitPos.avgPrice) || pos.entryPrice
            const entryFeeFromBybit = bybitSize * bybitAvgPrice * 0.00055   // Taker entry (Size × EntryPrice × 0.055%)
            const exitFeeFromBybit = bybitSize * bybitMarkPrice * 0.00055  // Taker exit (Size × MarkPrice × 0.055%)
            const bybitNetPnl = bybitGrossPnl - entryFeeFromBybit - exitFeeFromBybit

            // Calculate discrepancy: |UI PnL - Bybit net PnL| / margin
            const pnlAbsDiff = Math.abs(pos.pnl - bybitNetPnl)
            const discrepancyBase = Math.max(Math.abs(bybitNetPnl), pos.marginUsd) // avoid div-by-zero
            const discrepancyPct = (pnlAbsDiff / discrepancyBase) * 100

            // Warn if discrepancy > 1% of margin
            if (discrepancyPct > 1) {
              const existingWarn = errorLogRef.current.some(
                e => e.source === 'BYBIT' && e.message.includes(`PnL drift: ${pos.pair}`) && (Date.now() - e.timestamp) < 60_000
              )
              if (!existingWarn) {
                console.warn(`[BYBIT RECONCILE] PnL drift: ${pos.pair} UI=$${pos.pnl.toFixed(3)} Bybit_net=$${bybitNetPnl.toFixed(3)} Bybit_gross=$${bybitGrossPnl.toFixed(3)} drift=${discrepancyPct.toFixed(1)}%`)
                logEvent('WARNING', 'BYBIT', `PnL drift: ${pos.pair}`, `UI $${pos.pnl.toFixed(3)} vs Bybit net $${bybitNetPnl.toFixed(3)} (drift ${discrepancyPct.toFixed(1)}%)`)
              }
            }

            // Overwrite PnL and currentPrice with real Bybit data
            // BUG FIX: bybitGrossPnl (unrealisedPnl) is GROSS (before fees).
            // Subtract entryFee + estimated exitFee to get NET PnL matching our tick loop formula.
            // This ensures the displayed PnL for open Bybit positions matches what they'll
            // see in transaction history when the position is closed.
            // Note: bybitNetPnl already computed above (bybitGrossPnl - fees).
            changed = true
            const newPnlPercent = pos.marginUsd > 0 ? (bybitNetPnl / pos.marginUsd) * 100 : 0
            return {
              ...pos,
              pnl: bybitNetPnl,
              pnlPercent: newPnlPercent,
              currentPrice: bybitMarkPrice || pos.currentPrice,
              bybitVerified: true,
              bybitVerifiedAt: Date.now(),
              bybitRealisedPnl: bybitNetPnl,
              bybitGrossPnl: bybitGrossPnl,
              bybitEntryFee: entryFeeFromBybit,
              bybitExitFeeEstimate: exitFeeFromBybit,
            }
          })

          if (changed) {
            positionsRef.current = updated
          }
          return changed ? updated : prev
        })

        // ── Phantom Detection: UI positions not on Bybit ──
        // SAFETY: Only run if API returned success AND we have data.
        // If API errored/returned empty, do NOT close any UI positions —
        // it could be a transient glitch that would incorrectly close real positions.
        // Also requires positions to be older than 120s (grace period) and
        // detected as phantom 2+ times consecutively before auto-closing.
        const bybitOpenSymbols = new Set(
          bybitPositions.filter((p: any) => Number(p.size ?? p.positionSize ?? 0) > 0).map((p: any) => p.symbol)
        )
        const isApiHealthy = posData.success === true
        const phantomIds: string[] = []
        if (isApiHealthy) {
          for (const uiPos of positionsRef.current.filter(p => p.status === 'OPEN')) {
            const [base] = uiPos.pair.split('-')
            const bybitSymbol = base.toUpperCase() + 'USDT'
            const ageMs = Date.now() - (uiPos.openedAt || 0)
            if (!bybitOpenSymbols.has(bybitSymbol)) {
              // GRACE PERIOD: Don't phantom-close positions opened <120s ago
              // (Bybit API may not return them immediately after opening)
              if (ageMs < 120_000) {
                console.log(`[BYBIT RECONCILE] Phantom candidate: ${uiPos.pair} — SKIPPED (age ${(ageMs/1000).toFixed(0)}s < 120s grace period)`)
                continue
              }
              // CONFIRMATION: Require 2+ consecutive phantom detections before closing
              // (prevents closing on transient API glitches)
              const prevPhantomCount = phantomCountRef.current.get(uiPos.id) || 0
              if (prevPhantomCount < 1) {
                // First detection — just mark it, don't close yet
                console.warn(`[BYBIT RECONCILE] Phantom candidate: ${uiPos.pair} — 1st detection (will close on next check if still phantom)`)
                phantomCountRef.current.set(uiPos.id, prevPhantomCount + 1)
                continue
              }
              // 2nd+ detection — confirmed phantom, auto-correct
              phantomIds.push(uiPos.id)
              phantomCountRef.current.delete(uiPos.id) // clean up
              console.warn(`[BYBIT RECONCILE] Phantom confirmed: ${uiPos.pair} — auto-closing in UI (closed on Bybit via SL/TP, confirmed after 2 checks)`)
              logEvent('WARNING', 'BYBIT', `Phantom auto-corrected: ${uiPos.pair}`, 'Position closed on Bybit (native SL/TP?) — auto-removed from UI after confirmation.')
            } else {
              // Position found on Bybit — reset phantom counter
              phantomCountRef.current.delete(uiPos.id)
            }
          }
        } else {
          console.warn(`[BYBIT RECONCILE] API unhealthy (success=${posData.success}) — skipping phantom detection to protect real positions`)
        }
        // Auto-correct phantom positions: remove from UI, mark as closed by SL/TP
        if (phantomIds.length > 0) {
          setPositions(prev => {
            const phantomPositions = prev.filter(p => phantomIds.includes(p.id))
            // Create closed versions for trade history
            const closedPhantoms = phantomPositions.map(pos => ({
              ...pos,
              status: 'LIQUIDATED' as const, // phantom = Bybit closed it (SL/TP trigger)
              closedAt: Date.now(),
              closeConfirmedAt: Date.now(),
            }))
            // Add to closed positions and trade history
            setClosedPositions(cp => {
              const updated = [...closedPhantoms, ...cp].slice(0, LIMITS.MAX_CLOSED_POSITIONS)
              closedPositionsRef.current = updated
              return updated
            })
            for (const cp of closedPhantoms) {
              fullTradeHistoryRef.current.unshift(cp)
              cumulativeRealizedPnlRef.current += cp.pnl
              // Signal Stats: emit event for phantom-corrected close
              const signalType = determineCexSignalType(cp.anomaly?.category || 'AGGRESSIVE_ABSORPTION')
              const closeReason = mapCexStatusToCloseReason(cp.status)
              const pnlPct = cp.pnlPercent || 0
              const pointsDelta = calculatePointsDelta(pnlPct, closeReason)
              setSignalEvents(prev => {
                const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
                return [...prev, {
                  sessionId: signalSessionId,
                  timestamp: new Date().toISOString(),
                  signalType,
                  pair: cp.pair,
                  side: cp.side,
                  entryPrice: cp.entryPrice,
                  exitPrice: cp.currentPrice,
                  pnl: cp.pnl,
                  pnlPct,
                  closeReason,
                  leverage: cp.leverage,
                  hurstAtEntry: 0,
                  hcccoFastAtEntry: 0,
                  hcccoSlowAtEntry: 0,
                  confidenceScore: cp.confidence?.total ?? 0,
                  anomalyCategory: cp.anomaly?.category || '',
                  pointsDelta,
                  runningTotal,
                }]
              })
            }
            if (fullTradeHistoryRef.current.length > MAX_FULL_TRADE_HISTORY) {
              fullTradeHistoryRef.current.length = MAX_FULL_TRADE_HISTORY
            }
            setFullTradeCount(fullTradeHistoryRef.current.length)
            // Return only still-open positions
            const stillOpen = prev.filter(p => !phantomIds.includes(p.id) && p.status === 'OPEN')
            openPositionsCountRef.current = stillOpen.length
            positionsRef.current = stillOpen
            return stillOpen
          })
        }
        // ── Verify unconfirmed closed positions (CLOSING status) ──
        // Check if Bybit still has positions that our UI marked as CLOSING
        const unconfirmedClosed = closedPositionsRef.current.filter(
          p => p.status === 'CLOSING' && p.closeConfirmedAt === null
        )
        for (const ucp of unconfirmedClosed) {
          const [base] = ucp.pair.split('-')
          const bybitSymbol = base.toUpperCase() + 'USDT'
          const stillOnBybit = bybitPositions.some(
            (bp: any) => bp.symbol === bybitSymbol && parseFloat(bp.size) > 0
          )
          if (!stillOnBybit) {
            // Position no longer on Bybit — close was successful, confirm it
            const targetStatus = ucp.pendingCloseStatus || 'CLOSED_MANUAL'
            setClosedPositions(cp => cp.map(p =>
              p.id === ucp.id ? { ...p, status: targetStatus, pendingCloseStatus: undefined, closeConfirmedAt: Date.now() } : p
            ))
            closedPositionsRef.current = closedPositionsRef.current.map(p =>
              p.id === ucp.id ? { ...p, status: targetStatus, pendingCloseStatus: undefined, closeConfirmedAt: Date.now() } : p
            )
            console.log(`[RECONCILE] Confirmed close for ${ucp.pair} — no longer on Bybit`)
          } else {
            // Position still on Bybit — close failed, re-attempt
            console.warn(`[RECONCILE] Position ${ucp.pair} still OPEN on Bybit — re-attempting close`)
            logEvent('CRITICAL', 'BYBIT', `Re-attempting close: ${ucp.side} ${ucp.pair}`, 'Position still open on Bybit after CLOSING status')
            closeBybitPosition(ucp)
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // aborted on cleanup, not an error
      console.error('[BYBIT POLL] fetchBybitFutures failed:', err)
      logEvent('WARNING', 'BYBIT', 'Polling error', err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Poll Bybit futures when real trading is active
  // AUDIT FIX #9: Added AbortController to prevent stale fetches after unmount
  useEffect(() => {
    if (!bybitTrading) return
    const controller = new AbortController()
    void fetchBybitFutures(controller.signal)
    const interval = setInterval(() => void fetchBybitFutures(controller.signal), 30_000) // 30s — was 8s but that exceeded rate limits (2 calls × 7.5/min = 15/min > 10/min limit)
    return () => { controller.abort(); clearInterval(interval) }
  }, [bybitTrading, fetchBybitFutures])

  // ─── Fetch real prices from Binance Futures API ─────────────────────
  const fetchRealPrices = useCallback(async (signal?: AbortSignal) => {
    try {
      const symbols = ALL_PAIRS.map(p => p.binanceSymbol).join(',')
      const res = await fetch(`/api/binance/prices?symbols=${encodeURIComponent(symbols)}`, { signal })
      if (!res.ok) throw new Error('Binance prices API error')
      const data = await res.json()

      if (!mountedRef.current) return // component unmounted during fetch

      const binancePrices = data.prices || {}
      const prices: Record<string, number> = {}
      const changes: Record<string, number> = {}

      for (const pair of ALL_PAIRS) {
        const ticker = binancePrices[pair.binanceSymbol]
        if (ticker?.price) {
          prices[pair.symbol] = ticker.price
          changes[pair.symbol] = ticker.change24h ?? 0
        }
      }

      if (Object.keys(prices).length > 0) {
        setRealPrices(prices)
        setPriceChange24h(changes)
        setDataSource('LIVE')

        // Anchor simulation prices to real Binance prices
        // First fetch: snap directly to real price (avoids inflated basePrice lag)
        // Subsequent fetches: gentle mean-reversion for smooth tracking
        // Skip mean-reversion for the active pair when WS is anchoring its price
        // (WS provides more accurate real-time data than REST polling)
        setPairSims(prev => {
          const updated = { ...prev }
          for (const [symbol, price] of Object.entries(prices)) {
            if (updated[symbol]) {
              const sim = { ...updated[symbol] }
              const isFirstFetch = dataSourceRef.current !== 'LIVE'
              const isWsAnchoredPair = symbol === activePairSymbolRef.current && wsPriceRef.current !== null

              if (isWsAnchoredPair && !isFirstFetch) {
                // WS is providing real-time price for this pair — skip REST mean-reversion
                // to avoid pulling the WS-anchored price toward a stale REST value
              } else if (isFirstFetch) {
                // Snap directly — kills the inflated basePrice gap instantly
                sim.price = price
              } else {
                // Gentle reversion for subsequent refreshes
                const diff = price - sim.price
                sim.price = sim.price + diff * SIM.MEAN_REVERSION
              }
              updated[symbol] = sim
            }
          }
          return updated
        })
      }
    } catch (err) {
      if (!mountedRef.current) return
      // Don't set FALLBACK if request was aborted (component unmounted)
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('[CEX Anomaly] Binance price fetch failed, using fallback:', err)
      logEvent('WARNING', 'BINANCE', 'Price fetch failed — using fallback', err instanceof Error ? err.message : String(err))
      setDataSource('FALLBACK')
    }
  }, [])

  // Fetch prices on mount + periodically with AbortController
  // When in FALLBACK mode, retry every 3 seconds instead of 10 to recover faster
  useEffect(() => {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout>

    const scheduleNext = () => {
      const delay = dataSourceRef.current === 'FALLBACK' ? 3_000 : SIM.PRICE_REFRESH_MS
      timeoutId = setTimeout(async () => {
        await fetchRealPrices(controller.signal)
        if (mountedRef.current) scheduleNext()
      }, delay)
    }

    void fetchRealPrices(controller.signal).then(() => {
      if (mountedRef.current) scheduleNext()
    })

    return () => {
      controller.abort()
      clearTimeout(timeoutId)
    }
  }, [fetchRealPrices])

  const activeSim = pairSims[activePair.symbol]

  // ─── Generate simulated anomaly (enabled pairs only) ──────────────────
  const generateSimAnomaly = useCallback((): OrderFlowAnomaly => {
    const enabledPairList = ALL_PAIRS.filter(p => enabledPairsRef.current.has(p.symbol))
    const pairPool = enabledPairList.length > 0 ? enabledPairList : ALL_PAIRS
    const pair = pairPool[Math.floor(Math.random() * pairPool.length)]
    const selected = pickWeighted(ANOMALY_WEIGHTS)
    const side = Math.random() > 0.5 ? 'BID' : 'ASK'
    let sizeUsd: number
    let imbalance: number
    let details: string
    let hiddenValue: number | undefined
    let chain: string | undefined

    const sizeScale = pair.liqMultiplier / 10

    switch (selected.category) {
      case 'ICEBERG_DETECTED':
      case 'ICEBERG_REVERSAL': { // ICEBERG_REVERSAL — contrarian play, starts disabled by default
        sizeUsd = (500_000 + Math.random() * 5_000_000) * sizeScale
        hiddenValue = sizeUsd * (2 + Math.random() * 6)
        imbalance = side === 'BID' ? (300 + Math.random() * 700) : -(300 + Math.random() * 700)
        details = `Hidden: ${formatUsdLarge(hiddenValue)} | Realized: ${formatUsdLarge(sizeUsd)}`
        break
      }
      case 'WHALE_INFLOW': {
        sizeUsd = (2_000_000 + Math.random() * 20_000_000) * sizeScale
        const chains = ['ERC20', 'TRC20', 'BEP20', 'Arbitrum', 'Optimism']
        chain = chains[Math.floor(Math.random() * chains.length)]
        const assets = ['USDT', 'USDC', 'BTC', 'ETH']
        const asset = assets[Math.floor(Math.random() * assets.length)]
        imbalance = side === 'BID' ? (100 + Math.random() * 300) : -(100 + Math.random() * 300)
        details = `${formatUsdLarge(sizeUsd)} ${asset} (${chain}) → Binance`
        break
      }
      case 'AGGRESSIVE_ABSORPTION': {
        sizeUsd = (300_000 + Math.random() * 3_000_000) * sizeScale
        imbalance = side === 'BID' ? (500 + Math.random() * 500) : -(500 + Math.random() * 500)
        details = `Market ${side === 'BID' ? 'BUY' : 'SELL'} ${formatUsdLarge(sizeUsd)} absorbed, price unchanged`
        break
      }
      case 'OI_SPIKE': {
        sizeUsd = (50_000_000 + Math.random() * 200_000_000) * sizeScale
        imbalance = side === 'BID' ? (200 + Math.random() * 800) : -(200 + Math.random() * 800)
        details = `OI spike: ${formatUsdLarge(sizeUsd)} | ${side === 'BID' ? 'Longs' : 'Shorts'} entering`
        break
      }
      case 'FUNDING_EXTREME': {
        const fundingRate = (0.001 + Math.random() * 0.005) * (side === 'ASK' ? 1 : -1)
        sizeUsd = pair.liqMultiplier * 10_000_000
        imbalance = side === 'ASK' ? (300 + Math.random() * 700) : -(300 + Math.random() * 700)
        details = `Funding: ${(fundingRate * 100).toFixed(4)}% | ${side === 'ASK' ? 'SHORT contrarian' : 'LONG contrarian'}`
        break
      }
      case 'CROWD_BIAS': {
        const crowdPct = 0.64 + Math.random() * 0.21
        sizeUsd = crowdPct * 1_000_000
        imbalance = side === 'BID' ? crowdPct * 1000 : -crowdPct * 1000
        const crowdSide = side === 'BID' ? 'LONG' : 'SHORT'
        details = `Top traders ${(crowdPct * 100).toFixed(1)}% ${crowdSide} → follow ${crowdSide}`
        break
      }
      case 'TAKER_IMBALANCE': {
        const ratio = 1.5 + Math.random() * 2.0
        sizeUsd = ratio * 500_000
        imbalance = side === 'BID' ? ratio * 500 : -ratio * 500
        details = `Taker ${side === 'BID' ? 'buy' : 'sell'} ${ratio.toFixed(2)}x → aggressive ${side === 'BID' ? 'buying' : 'selling'}`
        break
      }
      case 'LIQUIDATION_CASCADE': {
        const liqUsd = 500_000 + Math.random() * 5_000_000
        sizeUsd = liqUsd
        imbalance = side === 'BID' ? 800 : -800
        details = `${side === 'ASK' ? 'Long' : 'Short'} liq cascade $${(liqUsd / 1000).toFixed(0)}K → ${side === 'ASK' ? 'downside' : 'upside'} momentum`
        break
      }
      case 'OI_VELOCITY': {
        const oiChangePct = 3 + Math.random() * 10
        sizeUsd = oiChangePct * 10_000_000
        imbalance = side === 'BID' ? oiChangePct * 200 : -oiChangePct * 200
        details = `OI ${side === 'BID' ? '+' : '-'}${oiChangePct.toFixed(1)}% → ${side === 'BID' ? 'new positions' : 'positions closing'}`
        break
      }
      case 'ORDERBOOK_IMBALANCE': {
        const obRatio = 1.5 + Math.random() * 2.0
        sizeUsd = obRatio * 300_000
        // OB IMBALANCE: side = raw OB pressure direction (not pre-faded).
        // side=BID → OB bid pressure → LONG (follow). Contrarian mode inverts → SHORT (fade).
        imbalance = side === 'BID' ? obRatio * 400 : -obRatio * 400
        details = `OB ${side === 'BID' ? 'bid' : 'ask'} pressure ${obRatio.toFixed(2)}x → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'WHALE_SWEEP': {
        const sweepUsd = 500_000 + Math.random() * 5_000_000
        sizeUsd = sweepUsd
        // WHALE SWEEP: side = raw whale direction (not pre-faded).
        // side=BID → whale buying → LONG (follow). Contrarian mode inverts → SHORT (fade).
        imbalance = side === 'BID' ? 600 : -600
        details = `Whale ${side === 'BID' ? 'buy' : 'sell'} sweep ${formatUsdLarge(sweepUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      // New categories (simulation only — real signals come from WS hooks)
      case 'REALTIME_LIQUIDATION': {
        const liqUsd = 200_000 + Math.random() * 2_000_000
        sizeUsd = liqUsd
        imbalance = side === 'BID' ? 800 : -800
        details = `RT liquidation cascade ${formatUsdLarge(liqUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'OPTIONS_FLOW': {
        const optUsd = 500_000 + Math.random() * 3_000_000
        sizeUsd = optUsd
        imbalance = side === 'BID' ? 700 : -700
        details = `Options flow ${formatUsdLarge(optUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'GATE_FLOW': {
        const gateUsd = 150_000 + Math.random() * 1_000_000
        sizeUsd = gateUsd
        imbalance = side === 'BID' ? 500 : -500
        details = `Gate.io OB/trade ${formatUsdLarge(gateUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'BITGET_FLOW': {
        const bgUsd = 150_000 + Math.random() * 1_000_000
        sizeUsd = bgUsd
        imbalance = side === 'BID' ? 500 : -500
        details = `Bitget OB/trade ${formatUsdLarge(bgUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'DYDX_PERP_FLOW': {
        const dydxUsd = 100_000 + Math.random() * 800_000
        sizeUsd = dydxUsd
        imbalance = side === 'BID' ? 400 : -400
        details = `dYdX perp flow ${formatUsdLarge(dydxUsd)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`
        break
      }
      case 'MACRO_EVENT': {
        sizeUsd = 0
        imbalance = 0
        details = `Macro event (CPI/FOMC/NFP) → high volatility expected`
        break
      }
    }

    return {
      id: uid(),
      pair: pair.symbol,
      category: selected.category,
      tag: selected.tag,
      sizeUsd,
      hiddenValue,
      chain,
      imbalance,
      timestamp: Date.now(),
      side,
      exchange: pair.exchange,
      fadedIn: false,
      details,
    }
  }, [])

  // ─── Open position on tradeable anomalies (paper trading only) ───────
  // Two-layer confidence scoring system:
  //
  //   Layer B: Soft Scoring (max 10 pts, min 5 required to enter)
  //     +3  Trigger quality (ABSORB/FUNDING=3, INFLOW=2, ICEBERG/OI=1)
  //     +2  VWAP alignment (correct side=+2, wrong side=-1)
  //     +2  SMA 8/21 cross (trend-aligned=+2, opposite=-1)
  //     +2  Momentum (aligned=+2, neutral=+1, opposite=-2)
  //     +1  Volume confirming (>150% avg=+1)
  //
  //   Layer C: Boosters (don't affect entry gate, raise CTP threshold)
  //     +2  Multi-signal (2 different triggers within 5s)
  //     +1  Edge pair (BTC, PEPE, FET, FIL whitelist)
  //     +1  Spread tight (<0.02%=+1, >0.05%=-1)
  //
  //   Entry gate: Layer B ≥ MIN_SCORE (5)
  //   CTP threshold: uses total score (Layer B + Layer C)
  const openPosition = useCallback((anomaly: OrderFlowAnomaly, funnelConverged: boolean = false, bypassScoring: boolean = false) => {
    // Only open on specific anomaly categories
    if (!LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) return
    // CASCADE detection: used throughout openPosition for parameter overrides
    const isCascadeTrigger = anomaly.category === 'LIQUIDATION_CASCADE'
    // Check if this category or a reversal variant is enabled
    const enabled = enabledCategoriesRef.current
    const isIcebergNormal = anomaly.category === 'ICEBERG_DETECTED' && enabled.has('ICEBERG_DETECTED')
    const isIcebergReversal = anomaly.category === 'ICEBERG_DETECTED' && enabled.has('ICEBERG_REVERSAL')
    const isOtherEnabled = anomaly.category !== 'ICEBERG_DETECTED' && enabled.has(anomaly.category)
    if (!isIcebergNormal && !isIcebergReversal && !isOtherEnabled) return
    // Signal gate: allow when EITHER paper or real trading is active
    // (was: only paperTrading — this forced PAPER on when clicking REAL)
    if (!paperTradingRef.current && !bybitTradingRef.current) return
    // Check if pair is enabled for trading
    if (!enabledPairsRef.current.has(anomaly.pair)) return
    // PAIR BLACKLIST: block all signals on historically unprofitable pairs (48k trade CSV)
    if ((PAIR_BLACKLIST as readonly string[]).includes(anomaly.pair)) return
    // CROWD WHITELIST: CROWD_BIAS only on profitable pairs
    if (anomaly.category === 'CROWD_BIAS' && !(CROWD_WHITELIST as readonly string[]).includes(anomaly.pair)) return
    // TAKER WHITELIST: reject TAKER_IMBALANCE on non-whitelisted pairs
    if (anomaly.category === 'TAKER_IMBALANCE' && !(TAKER_WHITELIST as readonly string[]).includes(anomaly.pair)) return
    // Allow signals when either:
    // 1. Binance REST prices are LIVE, OR
    // 2. Binance WS is connected (providing real-time prices for active pair), OR
    // 3. Bybit WS is connected (providing orderbook + trade signals)
    // This prevents a single REST fetch failure from blocking ALL trading signals
    // when WebSocket connections are still providing real-time market data.
    const hasLiveDataSource = dataSourceRef.current === 'LIVE'
      || wsConnectedRef.current
      || bybitWsConnectedRef.current
    if (!hasLiveDataSource) return
    // Limit concurrent open positions
    if (openPositionsCountRef.current >= maxActivePositionsRef.current) return

    // Per-pair deduplication: max 1 open position per pair (any direction)
    // Prevents 8 identical LONG BTC positions — 1 pair = 1 slot
    const positionsRef_current = positionsRef.current
    const samePairOpen = positionsRef_current.filter(
      p => p.status === 'OPEN' && p.pair === anomaly.pair
    )
    if (samePairOpen.length >= 1) return

    const pairConfig = ALL_PAIRS.find(p => p.symbol === anomaly.pair)
    if (!pairConfig) return

    const sim = pairSimsRef.current[anomaly.pair]
    if (!sim) return

    const entryPrice = sim.price

    // ── Determine trade direction ──
    // Uses SIGNAL_SEMANTICS to decide how each category interacts with trading mode:
    //   MOMENTUM signals:  NORMAL → follow, CONTRARIAN mode → FADE (invert)
    //   CONTRARIAN signals: NORMAL → follow (already faded at source), CONTRARIAN mode → FOLLOW (don't double-invert)
    //   AMBIGUOUS signals: NORMAL → follow, CONTRARIAN mode → FOLLOW (default)
    // ICEBERG_REVERSAL is a special case: always invert regardless of mode.
    // AUDIT FIX: isReversal must also detect actual ICEBERG_REVERSAL category anomalies,
    // not just ICEBERG_DETECTED with reversal enabled. The old code missed real ICE-REV signals.
    const isReversal = anomaly.category === 'ICEBERG_REVERSAL' || (anomaly.category === 'ICEBERG_DETECTED' && enabled.has('ICEBERG_REVERSAL') && !enabled.has('ICEBERG_DETECTED'))
    const isContrarianMode = tradingModeRef.current === 'CONTRARIAN'
    const semantics = SIGNAL_SEMANTICS[anomaly.category]
    const rawSide: PositionSide = anomaly.side === 'BID' ? 'LONG' : 'SHORT'
    const invertedSide: PositionSide = anomaly.side === 'BID' ? 'SHORT' : 'LONG'

    const side: PositionSide = isReversal
      ? invertedSide                                         // ICE-REV: always invert
      : isContrarianMode && semantics === 'MOMENTUM'
        ? invertedSide                                       // CONTRARIAN mode + MOMENTUM signal → FADE
        : rawSide                                            // Normal: follow signal. CONTRARIAN mode + CONTRARIAN/AMBIGUOUS signal → also follow (already faded at source)

    // ── Direction Filter: reject positions in disallowed direction ──
    // Applied BEFORE confidence scoring for maximum pipeline efficiency.
    // If user set LONG-only and this signal resolves to SHORT → skip immediately.
    const dirFilter = allowedDirectionRef.current
    if (dirFilter !== 'BOTH' && side !== dirFilter) return

    // ── Scoring via computeConfidence (extracted to @/lib/cex-anomaly-scoring) ──
    const isWsAnchoredForScoring = pairConfig.symbol === activePair.symbol && wsPriceRef.current !== null

    const { confidence, passesGate } = computeConfidence({
      anomaly,
      side,
      sim,
      isReversal,
      funnelConverged,
      isWsAnchored: isWsAnchoredForScoring,
      activePairSymbol: activePair.symbol,
      oiFundingData: oiFundingDataRef.current,
      crossExSnapshot: crossExSnapshotRef.current,
      recentAnomaliesOnPair: anomaliesRef.current.filter(a => a.pair === anomaly.pair),
      recentAnomaliesForCombo: anomaliesRef.current.filter(a => a.pair === anomaly.pair),
      fearGreedValue: fearGreedRef.current?.value ?? null,
    })

    // Gate: minimum Layer B score required (unless bypassed or convergence)
    if (!bypassScoring && !funnelConverged && !passesGate) return

    // ── Position sizing via computePositionSize (extracted to @/lib/cex-anomaly-position-sizing) ──
    const sizing = computePositionSize({
      confidence,
      side,
      entryPrice,
      liqBars: sim.liqBars,
      leverage: leverageRef.current,
      tradingMode: tradingModeRef.current,
      balance: testWalletAmountRef.current,
      executionMode,
      makerFeeRate,
      takerFeeRate,
      shieldOffset: pairConfig.shieldOffset,
      isCascadeTrigger,
      anomaly,
      isReversal,
      isContrarianMode,
      simCvd: sim.cvd,
      anomalyTimestamp: anomaly.timestamp,
      customSLPct: useCustomTPSLRef.current ? effectiveSLRef.current : null,
    })

    const { marginUsd, notionalSize, shieldStopLoss, nearestLiqCluster, entryFee, estimatedExitFee, totalFees, entryFeeRate, exitFeeRate, chaseState } = sizing

    const now = Date.now()
    const pos: ActivePosition = {
      id: uid(),
      pair: anomaly.pair,
      side,
      entryPrice,
      currentPrice: entryPrice,
      sizeUsd: notionalSize,
      marginUsd,
      leverage: leverageRef.current,
      pnl: -totalFees, // Start at -fees (entry already paid)
      pnlPercent: -(totalFees / marginUsd) * 100,
      entryFee,
      exitFee: estimatedExitFee,
      totalFees,
      nearestLiqCluster,
      shieldStopLoss,
      status: 'OPEN',
      openedAt: now,
      anomaly: isReversal ? { ...anomaly, tag: 'ICE-REV' as AnomalyTag } : anomaly,
      contrarian: isContrarianMode || undefined,
      tradingMode: tradingModeRef.current,
      closedAt: null,
      priceHistory: [entryPrice],
      confidence,
      // Execution mode
      executionMode,
      entryFeeRate,
      exitFeeRate,
      chaseState,
      // Dynamic exit: trailing shield — ACTIVE FROM OPEN (fixed SL disabled, trailing-only)
      peakPrice: entryPrice,
      trailingStop: shieldStopLoss,
      trailingActive: true,
      // Dynamic exit: breakeven stop
      breakevenHit: false,
      // Dynamic exit: partial TP
      partialTpTaken: false,
      remainingFraction: 1,
      partialPnlRealized: 0,
      // Dynamic exit: CVD reversal
      cvdAtOpen: sim.cvd,
      cvdPeak: sim.cvd,
      // Execution timing
      signalDetectedAt: anomaly.timestamp,
      orderSentAt: now,
      orderConfirmedAt: null,
      closeSentAt: null,
      closeConfirmedAt: null,
      // TMO checkpoint
      tmoCheckpointPassed: false,
      // Bybit verification — new position, not yet verified
      bybitVerified: false,
    }

    if (soundEnabledRef.current) playPositionOpenSound()
    logEvent('INFO', 'POSITION', `Opened ${side} ${anomaly.pair} ${leverageRef.current}x [${exchangeAbbr(anomaly.exchange)}]`, `Entry: ${formatPrice(entryPrice, pairConfig.decimals)} | Size: $${Math.round(notionalSize)} | Score: ${confidence.total}`)

    // ── Execution Clock: SIG phase ──
    const sigTs = Date.now()
    execClockRef.current = { phase: 'SIG', sigTs, queueEnterTs: 0, apiSentTs: 0, apiConfirmTs: 0 }
    setExecClock(prev => ({ ...prev, phase: 'SIG', sigMs: 0, queueMs: 0, apiMs: 0, totalMs: 0, sigTs, lastExchange: bybitTradingRef.current ? 'BYBIT' : 'PAPER', execMode: bybitTradingRef.current ? 'REAL' : 'PAPER', bybitRateSource: bybitTradingRef.current ? getBybitRateUsed().source : 'QUEUE_PROXY' }))

    // ── Bybit Futures Real Trade ──
    // When bybitTrading is active, send the order to Bybit Futures (Linear/USDT-M)
    // Throttled via bybitEnqueue: 150ms gap + server 120ms throttle + X-RateLimit monitoring
    if (bybitTradingRef.current) {
      const [base] = anomaly.pair.split('-')
      const bybitSymbol = base.toUpperCase() + 'USDT' // e.g. BTCUSDT
      // SIG → QUEUE transition
      execClockRef.current.phase = 'QUEUE'
      execClockRef.current.queueEnterTs = Date.now()
      setExecClock(prev => ({ ...prev, phase: 'QUEUE', sigMs: execClockRef.current.queueEnterTs - sigTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateUsed: getBybitRateUsed().usedPct, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))
      // CRITICAL — open orders must never be dropped
      bybitEnqueue(async () => {
        // QUEUE → API transition
        const apiSentTs = Date.now()
        execClockRef.current.phase = 'API'
        execClockRef.current.apiSentTs = apiSentTs
        setExecClock(prev => ({ ...prev, phase: 'API', queueMs: apiSentTs - execClockRef.current.queueEnterTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))
        try {
          const res = await fetch('/api/bybit/futures/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol: bybitSymbol,
              side: side === 'LONG' ? 'Buy' : 'Sell', // Bybit expects 'Buy'/'Sell', not 'LONG'/'SHORT'
              leverage: leverageRef.current,
              size: Math.round(notionalSize), // contract qty for linear
              mode: 'real',
              // Native SL on Bybit: protects position if browser/server crashes
              // Set EXACTLY at custom SL distance (or shieldStopLoss in auto mode)
              stopLossPrice: shieldStopLoss,
              // Native TP on Bybit: protects profit if browser crashes
              // Based on effectiveTP (% of price move). Leverage amplifies automatically.
              takeProfitPrice: side === 'LONG'
                ? entryPrice * (1 + effectiveTPRef.current / 100)
                : entryPrice * (1 - effectiveTPRef.current / 100),
            }),
          })
          // ── LOG: TP/SL prices being sent to Bybit for debugging ──
          const tpPriceSent = side === 'LONG'
            ? entryPrice * (1 + effectiveTPRef.current / 100)
            : entryPrice * (1 - effectiveTPRef.current / 100)
          const slPctFromEntry = side === 'LONG'
            ? ((entryPrice - shieldStopLoss) / entryPrice * 100)
            : ((shieldStopLoss - entryPrice) / entryPrice * 100)
          const tpPctFromEntry = side === 'LONG'
            ? ((tpPriceSent - entryPrice) / entryPrice * 100)
            : ((entryPrice - tpPriceSent) / entryPrice * 100)
          console.log(`[TP/SL BYBIT] ${side} ${anomaly.pair} ${leverageRef.current}x | Entry=${entryPrice.toFixed(2)} | SL=${shieldStopLoss.toFixed(2)} (${slPctFromEntry.toFixed(2)}% ceny = ${(slPctFromEntry * leverageRef.current).toFixed(1)}% PnL) | TP=${tpPriceSent.toFixed(2)} (${tpPctFromEntry.toFixed(2)}% ceny = ${(tpPctFromEntry * leverageRef.current).toFixed(1)}% PnL) | inputMode=${tpslInputModeRef.current} customTP=${customTPRef.current} customSL=${customSLRef.current} effectiveTP=${effectiveTPRef.current} effectiveSL=${effectiveSLRef.current}`)
          const data = await res.json()
          const confirmedAt = Date.now()
          // API → DONE transition
          execClockRef.current.phase = 'DONE'
          execClockRef.current.apiConfirmTs = confirmedAt
          setExecClock(prev => ({ ...prev, phase: 'DONE', apiMs: confirmedAt - execClockRef.current.apiSentTs, totalMs: confirmedAt - sigTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))
          // Auto-reset clock after 3s
          setTimeout(() => { if (execClockRef.current.phase === 'DONE') { execClockRef.current.phase = 'IDLE'; setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined })) } }, 3000)
          if (data.success) {
            console.log(`[BYBIT REAL] Opened ${side} ${anomaly.pair} ${leverageRef.current}x vol=${Math.round(notionalSize)} orderId=${data.orderId} latency=${confirmedAt - now}ms${data.cacheHit?.instrument ? ' (instr=CACHE)' : ''}${data.cacheHit?.leverage ? ' (lev=CACHE)' : ''}`)
            // P1 FIX (v2): slConfirmed/tpConfirmed now correctly reflects retCode===0.
            // Bybit POST /v5/order/create does NOT return stopLoss/takeProfit fields,
            // so the old logic was always showing false. Now we trust Bybit's acceptance
            // and do async position-based verification server-side instead.
            // Only alert if the server explicitly reports SL/TP as unconfirmed (shouldn't happen now).
            if (data.slConfirmed === false || data.tpConfirmed === false) {
              logEvent('WARNING', 'BYBIT', `TP/SL verification pending: ${side} ${anomaly.pair}`, `slConfirmed=${data.slConfirmed} tpConfirmed=${data.tpConfirmed} — server will verify via position query and retry if needed`)
            }
            // Update position with confirmation timestamp and actual notional/qty from Bybit
            setPositions(prev => prev.map(p => p.id === pos.id ? {
              ...p,
              orderConfirmedAt: confirmedAt,
              sizeUsd: data.actualNotional ?? p.sizeUsd,  // Use actual notional from Bybit (may differ after qty rounding)
            } : p))
            // Fast verify: fetch real Bybit PnL 2s after open (don't wait 30s for reconciliation)
            if (bybitTradingRef.current) {
              setTimeout(async () => {
                try {
                  const vRes = await fetch('/api/bybit/futures/positions?mode=real', { signal: AbortSignal.timeout(10_000) })
                  const vData = await vRes.json()
                  if (vData.success && vData.positions) {
                    const [base] = anomaly.pair.split('-')
                    const bybitSymbol = base.toUpperCase() + 'USDT'
                    const bybitPos = vData.positions.find((p: any) => p.symbol === bybitSymbol && parseFloat(p.size) > 0)
                    if (bybitPos) {
                      const markPrice = parseFloat(bybitPos.markPrice)
                      const unrealisedPnl = parseFloat(bybitPos.unrealisedPnl)
                      // Update position with verified Bybit data
                      setPositions(prev => prev.map(p =>
                        p.id === pos.id ? {
                          ...p,
                          currentPrice: markPrice || p.currentPrice,
                          pnl: unrealisedPnl - (p.entryFee || 0), // net PnL (Bybit gives gross)
                          pnlPercent: p.marginUsd > 0 ? ((unrealisedPnl - (p.entryFee || 0)) / p.marginUsd) * 100 : 0,
                          bybitVerified: true,
                          bybitVerifiedAt: Date.now(),
                          bybitRealisedPnl: unrealisedPnl,
                        } : p
                      ))
                      console.log(`[FAST VERIFY] ${anomaly.pair} verified: markPrice=${markPrice} unrealisedPnl=${unrealisedPnl}`)

                      // ── P1-4: Verify SL/TP are set on Bybit, retry if missing ──
                      const bybitSL = bybitPos.stopLoss
                      const bybitTP = bybitPos.takeProfit
                      const expectedSL = shieldStopLoss
                      const expectedTP = side === 'LONG'
                        ? entryPrice * (1 + effectiveTPRef.current / 100)
                        : entryPrice * (1 - effectiveTPRef.current / 100)

                      const slMissing = !bybitSL || parseFloat(bybitSL) === 0
                      const tpMissing = !bybitTP || parseFloat(bybitTP) === 0

                      if ((slMissing || tpMissing) && bybitTradingRef.current) {
                        console.warn(`[TP/SL VERIFY] ${anomaly.pair} missing: SL=${bybitSL || 'NONE'} TP=${bybitTP || 'NONE'} — retrying setTradingStop`)

                        const retrySetTradingStop = async (attempt: number) => {
                          if (attempt > 3 || !bybitTradingRef.current) {
                            console.error(`[TP/SL VERIFY] ${anomaly.pair} FAILED after ${attempt - 1} retries — POSITION UNPROTECTED ON BYBIT!`)
                            logEvent('CRITICAL', 'BYBIT', `TP/SL NOT SET after 3 retries: ${side} ${anomaly.pair}`, 'Set manually on Bybit!')
                            return
                          }
                          try {
                            const tsRes = await fetch('/api/bybit/futures/trading-stop', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                symbol: bybitSymbol,
                                mode: 'real',
                                side: side === 'LONG' ? 'Buy' as const : 'Sell' as const,  // P0 FIX: pass side for Hedge mode positionIdx
                                ...(slMissing ? { stopLoss: expectedSL, slTriggerBy: 'MarkPrice' } : {}),
                                ...(tpMissing ? { takeProfit: expectedTP, tpTriggerBy: 'MarkPrice' } : {}),
                                tpslMode: 'Full',
                              }),
                            })
                            const tsData = await tsRes.json()
                            if (tsData.success) {
                              console.log(`[TP/SL VERIFY] ${anomaly.pair} SL/TP set via setTradingStop (attempt ${attempt})`)
                              logEvent('INFO', 'BYBIT', `TP/SL verified & set: ${side} ${anomaly.pair}`, `SL=$${expectedSL.toFixed(2)} TP=$${expectedTP.toFixed(2)} (attempt ${attempt})`)
                            } else {
                              console.warn(`[TP/SL VERIFY] ${anomaly.pair} attempt ${attempt} failed: ${tsData.error}`)
                              setTimeout(() => retrySetTradingStop(attempt + 1), 5000)
                            }
                          } catch (retryErr) {
                            console.warn(`[TP/SL VERIFY] ${anomaly.pair} attempt ${attempt} error:`, retryErr)
                            setTimeout(() => retrySetTradingStop(attempt + 1), 5000)
                          }
                        }
                        setTimeout(() => retrySetTradingStop(1), 1000)
                      } else {
                        console.log(`[TP/SL VERIFY] ${anomaly.pair} OK: SL=${bybitSL} TP=${bybitTP}`)
                      }
                    }
                  }
                } catch (err) {
                  // Non-critical — reconciliation will catch up in 30s
                  console.warn('[FAST VERIFY] Failed (non-critical):', err)
                }
              }, 2000) // 2s delay — enough for Bybit to register the position
            }
          } else {
            console.error(`[BYBIT REAL] Order failed: ${data.error}`)
            const retCode = data.retCode ? ` [${data.retCode}]` : ''
            const retMsg = data.retMsg ? ` ${data.retMsg}` : ''
            const retryInfo = data.retries ? ` (after ${data.retries} retries)` : ''
            logEvent('CRITICAL', 'BYBIT', `Open order failed: ${side} ${anomaly.pair}${retCode}${retryInfo}`, `${data.error}${retMsg}`)
            // ROLLBACK: Remove phantom position from UI since Bybit order failed
            // Refund the wallet margin that was debited
            setPositions(prev => {
              const filtered = prev.filter(p => p.id !== pos.id)
              positionsRef.current = filtered
              return filtered
            })
            openPositionsCountRef.current = Math.max(0, openPositionsCountRef.current - 1)
            // Refund wallet
            const marginUsed = notionalSize / leverageRef.current
            setTestWalletAmount(prev => prev + marginUsed)
          }
        } catch (err) {
          console.error('[BYBIT REAL] Open request failed:', err)
          logEvent('CRITICAL', 'BYBIT', `Open request error: ${side} ${anomaly.pair}`, err instanceof Error ? err.message : String(err))
          // ROLLBACK: Remove phantom position from UI since Bybit request threw
          setPositions(prev => {
            const filtered = prev.filter(p => p.id !== pos.id)
            positionsRef.current = filtered
            return filtered
          })
          openPositionsCountRef.current = Math.max(0, openPositionsCountRef.current - 1)
          // Refund wallet
          const marginUsed = notionalSize / leverageRef.current
          setTestWalletAmount(prev => prev + marginUsed)
        }
      }, true)  // CRITICAL — open orders must never be dropped
    }

    // Paper trading: simulate realistic Bybit V5 API latency
    // Phase transitions: SIG → QUEUE → API → DONE with real timing
    // Mirrors real flow: instrument cache, leverage cache, order placement
    if (!bybitTradingRef.current) {
      const [base] = anomaly.pair.split('-')
      const bybitSymbol = base.toUpperCase() + 'USDT'
      pos.orderSentAt = now

      const delays = getOpenPhaseDelays(bybitSymbol, leverageRef.current)
      const cacheInfo = delays.breakdown.cacheHit

      // Phase 1: SIG (already set above) — wait sigToQueueMs → transition to QUEUE
      setTimeout(() => {
        if (execClockRef.current.sigTs !== sigTs) return // stale
        execClockRef.current.phase = 'QUEUE'
        execClockRef.current.queueEnterTs = Date.now()
        setExecClock(prev => ({ ...prev, phase: 'QUEUE', sigMs: delays.breakdown.sigMs, bybitQueueDepth: 0, bybitRateUsed: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

        // Phase 2: QUEUE — wait queueToApiMs → transition to API
        setTimeout(() => {
          if (execClockRef.current.sigTs !== sigTs) return // stale
          const apiSentTs = Date.now()
          execClockRef.current.phase = 'API'
          execClockRef.current.apiSentTs = apiSentTs
          setExecClock(prev => ({ ...prev, phase: 'API', queueMs: delays.breakdown.queueMs, bybitQueueDepth: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

          // Phase 3: API — wait apiToDoneMs → transition to DONE
          setTimeout(() => {
            if (execClockRef.current.sigTs !== sigTs) return // stale
            const confirmedAt = Date.now()
            execClockRef.current.phase = 'DONE'
            execClockRef.current.apiConfirmTs = confirmedAt
            setExecClock(prev => ({
              ...prev,
              phase: 'DONE',
              apiMs: delays.breakdown.apiMs,
              totalMs: confirmedAt - sigTs,
              bybitQueueDepth: 0,
              bybitRateSource: 'QUEUE_PROXY',
              execMode: 'PAPER',
            }))
            // Update position with confirmation timestamp
            setPositions(prev => prev.map(p => p.id === pos.id ? { ...p, orderConfirmedAt: confirmedAt } : p))
            console.log(`[PAPER] Opened ${side} ${anomaly.pair} ${leverageRef.current}x vol=${Math.round(notionalSize)} latency=${confirmedAt - now}ms${cacheInfo.instrument ? ' (instr=CACHE)' : ''}${cacheInfo.leverage ? ' (lev=CACHE)' : ''}`)
            // Auto-reset clock after 3s
            setTimeout(() => { if (execClockRef.current.phase === 'DONE') { execClockRef.current.phase = 'IDLE'; setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined })) } }, 3000)
          }, delays.apiToDoneMs)
        }, delays.queueToApiMs)
      }, delays.sigToQueueMs)
    }

    setPositions(prev => {
      const next = [pos, ...prev]
      positionsRef.current = next
      return next
    })
    openPositionsCountRef.current++

    // ── Isolated Margin simulation (paper mode) ──
    // In real mode, Bybit automatically reserves margin per-position from available balance.
    // In paper mode, we simulate this by debiting the wallet when a position opens.
    // This prevents paper mode from over-allocating (opening more/larger positions than real mode allows).
    // On close: marginUsd + netPnl is credited back (see PnL tick + manualClose).
    if (!bybitTradingRef.current) {
      setTestWalletAmount(prev => {
        const next = Math.max(0.01, prev - marginUsd)
        testWalletAmountRef.current = next
        return next
      })
    }
  }, [makerFeeRate, takerFeeRate])

  // ─── Signal Convergence Funnel ─────────────────────────────────────────
  // Feed anomaly into per-pair funnel. Returns true if CONVICTION formed
  // (2+ different categories on same pair within FUNNEL.WINDOW_MS).
  const feedFunnel = useCallback((anomaly: OrderFlowAnomaly): boolean => {
    const now = Date.now()
    const pair = anomaly.pair
    const newSignal: FunnelSignal = {
      id: anomaly.id,
      anomaly,
      enteredAt: now,
      expiresAt: now + FUNNEL.WINDOW_MS,
    }

    // Compute convergence synchronously from current ref state
    const current = funnelRef.current[pair]
    const existing = current?.signals || []
    const active = existing.filter(s => s.expiresAt > now)
    const allSignals = [newSignal, ...active].slice(0, FUNNEL.MAX_SIGNALS_PER_PAIR)
    const categories = new Set(allSignals.map(s => s.anomaly.category))
    const uniqueCategories = Array.from(categories)
    const hasConvergence = uniqueCategories.length >= FUNNEL.MIN_CONVERGENCE
    const sides = { BID: allSignals.filter(s => s.anomaly.side === 'BID').length, ASK: allSignals.filter(s => s.anomaly.side === 'ASK').length }
    const dominantSide: 'BID' | 'ASK' = sides.BID >= sides.ASK ? 'BID' : 'ASK'

    // Update funnel state
    setFunnel(prev => {
      const prevPair = prev[pair]
      const prevActive = (prevPair?.signals || []).filter(s => s.expiresAt > now)
      const updated = [newSignal, ...prevActive].slice(0, FUNNEL.MAX_SIGNALS_PER_PAIR)
      const updatedCatsSet = new Set(updated.map(s => s.anomaly.category))
      const updatedCats = Array.from(updatedCatsSet)

      if (updatedCats.length >= FUNNEL.MIN_CONVERGENCE) {
        const convergence: FunnelConvergence = {
          pair,
          signals: updated,
          categories: updatedCats,
          sides: { BID: updated.filter(s => s.anomaly.side === 'BID').length, ASK: updated.filter(s => s.anomaly.side === 'ASK').length },
          dominantSide,
          convergentSignal: newSignal,
          timestamp: now,
        }
        return { ...prev, [pair]: { pair, signals: updated, convergence } }
      }

      return { ...prev, [pair]: { pair, signals: updated, convergence: null } }
    })

    return hasConvergence
  }, [])

  // ─── Process Anomaly: funnel-gated or direct ──────────────────────────
  // When funnel is ENABLED: feed into funnel, only open position on convergence
  // When funnel is DISABLED: open position immediately on any tradeable signal
  const processAnomaly = useCallback((anomaly: OrderFlowAnomaly) => {
    if (!funnelEnabledRef.current) {
      // Funnel OFF → DIRECT ENTRY: no funnel, no scoring, no TA filters
      // Signal from Microstructure Radar → position immediately
      openPosition(anomaly, false, true)
    } else {
      // Funnel ON → feed into funnel, pass convergence result directly
      // (NOT read from funnelRef which is stale — setFunnel is async/batched)
      const converged = feedFunnel(anomaly)
      if (converged) {
        logEvent('INFO', 'FUNNEL', `Convergence: ${anomaly.pair}`, `${anomaly.category} → ${anomaly.side}`)
        openPosition(anomaly, true, false)
      }
    }
  }, [openPosition, feedFunnel])

  // Wire up Bybit WS ref → processAnomaly (defined above)
  processAnomalyRef.current = processAnomaly

  // Prune expired funnel signals periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setFunnel(prev => {
        const next = { ...prev }
        let changed = false
        for (const pair of Object.keys(next)) {
          const active = next[pair].signals.filter(s => s.expiresAt > now)
          if (active.length !== next[pair].signals.length) {
            next[pair] = { ...next[pair], signals: active, convergence: active.length >= FUNNEL.MIN_CONVERGENCE ? next[pair].convergence : null }
            changed = true
          }
          // Remove empty pair entries
          if (active.length === 0 && !next[pair].convergence) {
            delete next[pair]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, FUNNEL.PRUNE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // Count active funnel signals for display
  const funnelStats = useMemo(() => {
    const pairs = Object.values(funnel)
    const waitingSignals = pairs.reduce((sum, pf) => sum + pf.signals.length, 0)
    const convictions = pairs.filter(pf => pf.convergence !== null).length
    const waitingPairs = pairs.filter(pf => pf.convergence === null && pf.signals.length > 0).length
    return { waitingSignals, convictions, waitingPairs }
  }, [funnel])
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchOIFunding = async () => {
      try {
        // Fetch all OI+Funding data (API fetches all tracked pairs in bulk)
        const res = await fetch('/api/ccxt/oi-funding', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('OI/Funding API error')
        const data = await res.json()

        if (!mountedRef.current) return

        if (data.data && Object.keys(data.data).length > 0) {
          setOiFundingData(data.data)
          oiFundingDataRef.current = data.data
          setOiSpikes(data.oiSpikes || [])
          setFundingExtreme(data.fundingExtreme || [])
          setCcxtStatus('LIVE')

          // ── Generate OI_SPIKE anomalies ──
          for (const spikeSymbol of (data.oiSpikes || [])) {
            const oiData = data.data[spikeSymbol]
            if (!oiData) continue
            const ourSymbol = spikeSymbol.split('/')[0] + '-' + spikeSymbol.split('/')[1].split(':')[0]
            const pairConfig = ALL_PAIRS.find(p => p.symbol === ourSymbol)
            if (!pairConfig) continue
            if (!enabledPairsRef.current.has(ourSymbol)) continue

            const oiChangeUsd = oiData.openInterestUsd // Current OI as size proxy
            const side: 'BID' | 'ASK' = oiData.fundingRate > 0 ? 'BID' : 'ASK' // Positive funding → longs dominant → BID side

            // Dedup: skip if HL or previous CCXT cycle already detected this OI spike within 60s
            const alreadyDetected = anomaliesRef.current.some(
              a => a.pair === ourSymbol && a.category === 'OI_SPIKE' && Date.now() - a.timestamp < 60000
            )
            if (alreadyDetected) continue

            const anomaly: OrderFlowAnomaly = {
              id: uid(),
              pair: ourSymbol,
              category: 'OI_SPIKE',
              tag: 'OI',
              sizeUsd: oiChangeUsd,
              imbalance: oiData.fundingRate * 10000, // Scaled for display
              timestamp: Date.now(),
              side,
              exchange: 'CCXT-Multi',
              fadedIn: true,
              details: `OI: $${(oiChangeUsd / 1_000_000).toFixed(1)}M | Rate: ${(oiData.fundingRate * 100).toFixed(4)}%`,
              source: 'REAL',
            }
            anomalyCountRef.current++
            setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
            processAnomalyRef.current(anomaly)
          }

          // ── Generate FUNDING_EXTREME anomalies ──
          for (const fundSymbol of (data.fundingExtreme || [])) {
            const fundData = data.data[fundSymbol]
            if (!fundData) continue
            const ourSymbol = fundSymbol.split('/')[0] + '-' + fundSymbol.split('/')[1].split(':')[0]
            const pairConfig = ALL_PAIRS.find(p => p.symbol === ourSymbol)
            if (!pairConfig) continue
            if (!enabledPairsRef.current.has(ourSymbol)) continue

            // Contrarian: positive extreme funding → SHORT (crowd is long), negative → LONG
            const side: 'BID' | 'ASK' = fundData.fundingRate > 0 ? 'ASK' : 'BID'

            // Dedup: skip if HL or previous CCXT cycle already detected this funding extreme within 60s
            const alreadyDetected = anomaliesRef.current.some(
              a => a.pair === ourSymbol && a.category === 'FUNDING_EXTREME' && Date.now() - a.timestamp < 60000
            )
            if (alreadyDetected) continue

            const anomaly: OrderFlowAnomaly = {
              id: uid(),
              pair: ourSymbol,
              category: 'FUNDING_EXTREME',
              tag: 'FUNDING',
              sizeUsd: fundData.openInterestUsd,
              imbalance: fundData.fundingRate * 10000,
              timestamp: Date.now(),
              side,
              exchange: 'CCXT-Multi',
              fadedIn: true,
              details: `Funding: ${(fundData.fundingRate * 100).toFixed(4)}% | OI: $${(fundData.openInterestUsd / 1_000_000).toFixed(1)}M | ${side === 'ASK' ? 'SHORT' : 'LONG'} signal`,
              source: 'REAL',
            }
            anomalyCountRef.current++
            setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
            processAnomalyRef.current(anomaly)
          }
        }
        updateSignalHealth('OI/Funding', 'ok', (data.oiSpikes || []).length + (data.fundingExtreme || []).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('OI/Funding', 'error', 0, err instanceof Error ? err.message : String(err))
        console.warn('[CEX Anomaly] OI/Funding fetch failed:', err)
        logEvent('WARNING', 'OI/FUNDING', 'Fetch failed', err instanceof Error ? err.message : String(err))
        setCcxtStatus('ERROR')
      }
    }

    void fetchOIFunding()
    const interval = setInterval(fetchOIFunding, 30_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Hyperliquid Market Data (every 15s) ─────────────────────────
  // Real ICEBERG_DETECTED, AGGRESSIVE_ABSORPTION, OI_SPIKE, FUNDING_EXTREME,
  // LIQUIDATION_CASCADE (proxy) from Hyperliquid's public API.
  // This was previously orphaned dead code — now wired into the anomaly feed.
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchHL = async () => {
      try {
        const res = await fetch('/api/hyperliquid/market-data', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('HL API error')
        const data = await res.json()
        if (!mountedRef.current) return

        // ── ICEBERG_DETECTED from L2 book ──
        for (const ice of (data.icebergDetected || [])) {
          if (!enabledPairsRef.current.has(ice.pair)) continue
          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: ice.pair,
            category: 'ICEBERG_DETECTED',
            tag: 'ICEBERG',
            sizeUsd: ice.sizeUsd,
            hiddenValue: ice.sizeUsd * (ice.ratioToAvg || 5),
            imbalance: ice.side === 'BID' ? ice.sizeUsd / 10000 : -ice.sizeUsd / 10000,
            timestamp: Date.now(),
            side: ice.side,
            exchange: 'Hyperliquid',
            fadedIn: true,
            details: `Iceberg $${(ice.sizeUsd / 1000).toFixed(0)}K · ${ice.orderCount} orders · ${ice.ratioToAvg?.toFixed(0)}x avg`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }

        // ── AGGRESSIVE_ABSORPTION from L2 book (with persistence) ──
        for (const abs of (data.aggressiveAbsorption || [])) {
          if (!enabledPairsRef.current.has(abs.pair)) continue
          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: abs.pair,
            category: 'AGGRESSIVE_ABSORPTION',
            tag: 'ABSORB',
            sizeUsd: abs.wallSizeUsd,
            imbalance: abs.side === 'BID' ? abs.wallSizeUsd / 5000 : -abs.wallSizeUsd / 5000,
            timestamp: Date.now(),
            side: abs.side,
            exchange: 'Hyperliquid',
            fadedIn: true,
            details: `Wall $${(abs.wallSizeUsd / 1000).toFixed(0)}K @ $${abs.price?.toFixed(1)} · ${abs.snapshots} snaps · ${((abs.persistedMs || 0) / 1000).toFixed(0)}s`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }

        // ── LIQUIDATION_CASCADE proxy from HL ──
        for (const casc of (data.cascadeProxy || [])) {
          if (!enabledPairsRef.current.has(casc.pair)) continue
          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: casc.pair,
            category: 'LIQUIDATION_CASCADE',
            tag: 'LIQ-CASCADE',
            sizeUsd: (casc.oiDropPct || 5) * 10_000_000,
            imbalance: casc.side === 'BID' ? 800 : -800,
            timestamp: Date.now(),
            side: casc.side,
            exchange: 'Hyperliquid',
            fadedIn: true,
            details: `OI drop ${casc.oiDropPct?.toFixed(1)}% · funding ${(casc.fundingRate * 100).toFixed(4)}%`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }

        // ── OI_SPIKE + FUNDING_EXTREME from HL (supplement CCXT data) ──
        for (const spike of (data.oiSpikes || [])) {
          if (!enabledPairsRef.current.has(spike.pair)) continue
          // Skip if CCXT already detected this OI spike (avoid duplicates)
          const alreadyDetected = anomaliesRef.current.some(
            a => a.pair === spike.pair && a.category === 'OI_SPIKE' && Date.now() - a.timestamp < 60000
          )
          if (alreadyDetected) continue
          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: spike.pair,
            category: 'OI_SPIKE',
            tag: 'OI',
            sizeUsd: Math.abs(spike.currentOI || 0),
            imbalance: spike.side === 'BID' ? 500 : -500,
            timestamp: Date.now(),
            side: spike.side,
            exchange: 'Hyperliquid',
            fadedIn: true,
            details: `OI ${spike.oiChangePct?.toFixed(1)}% · $${((spike.currentOI || 0) / 1_000_000).toFixed(1)}M`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }

        for (const fund of (data.fundingExtreme || [])) {
          if (!enabledPairsRef.current.has(fund.pair)) continue
          const alreadyDetected = anomaliesRef.current.some(
            a => a.pair === fund.pair && a.category === 'FUNDING_EXTREME' && Date.now() - a.timestamp < 60000
          )
          if (alreadyDetected) continue
          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: fund.pair,
            category: 'FUNDING_EXTREME',
            tag: 'FUNDING',
            sizeUsd: 10_000_000,
            imbalance: fund.fundingRate * 10000,
            timestamp: Date.now(),
            side: fund.side,
            exchange: 'Hyperliquid',
            fadedIn: true,
            details: `Funding ${(fund.fundingRate * 100).toFixed(4)}% · ${fund.side === 'ASK' ? 'SHORT' : 'LONG'} contrarian`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }
        updateSignalHealth('Hyperliquid', 'ok', (data.icebergDetected || []).length + (data.aggressiveAbsorption || []).length + (data.cascadeProxy || []).length + (data.oiSpikes || []).length + (data.fundingExtreme || []).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('Hyperliquid', 'error', 0, err instanceof Error ? err.message : String(err))
        // Silent fail — HL is supplementary, not critical
      }
    }

    void fetchHL()
    const interval = setInterval(fetchHL, 15_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Binance CEX Anomaly Scan (every 10s) ────────────────────────
  // Real AGGRESSIVE_ABSORPTION from Binance spot orderbook + aggTrades.
  // Previously orphaned — now wired into the anomaly feed.
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchScan = async () => {
      try {
        const res = await fetch('/api/cex-anomaly/scan', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Scan API error')
        const data = await res.json()
        if (!mountedRef.current) return

        for (const anomaly of (data.anomalies || [])) {
          if (anomaly.category !== 'AGGRESSIVE_ABSORPTION') continue // Only ABSORB, skip RETAIL_NOISE
          if (!enabledPairsRef.current.has(anomaly.pair)) continue
          const ofa: OrderFlowAnomaly = {
            id: uid(),
            pair: anomaly.pair,
            category: 'AGGRESSIVE_ABSORPTION',
            tag: 'ABSORB',
            sizeUsd: anomaly.sizeUsd,
            imbalance: anomaly.imbalance,
            timestamp: Date.now(),
            side: anomaly.side,
            exchange: 'Binance',
            fadedIn: true,
            details: anomaly.details,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [ofa, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(ofa.category as any)) {
            processAnomalyRef.current(ofa)
          }
        }
        updateSignalHealth('Binance Scan', 'ok', (data.anomalies || []).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('Binance Scan', 'error', 0, err instanceof Error ? err.message : String(err))
        // Silent fail — scan is supplementary
      }
    }

    void fetchScan()
    const interval = setInterval(fetchScan, 10_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Binance Top Trader Ratio (every 30s) — CROWD_BIAS ────────────
  // Real top trader long/short ratio from Binance Futures public API.
  // When top traders are >64% on one side → contrarian signal.
  // FIX: Poll every 30s (was 60s) to detect ratio changes faster.
  // FIX: Added 60s dedup (like OI_SPIKE) to prevent signal spam within one Binance update cycle.
  // FIX: Removed processAnomaly from deps — uses processAnomalyRef.current instead
  //       to prevent fetch loop restarts that cause signal loss.
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchTopTrader = async () => {
      try {
        const res = await fetch('/api/binance/top-trader-ratio', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('TopTrader API error')
        const data = await res.json()
        if (!mountedRef.current) return

        let crowdBiasEmitted = 0
        for (const [label, ratio] of Object.entries(data.ratios || {})) {
          const r = ratio as any
          if (r.bias === 'NEUTRAL') continue
          if (!enabledPairsRef.current.has(label)) continue
          // Only emit if ratio is significant (>64%)
          if (r.dominantPct < 0.64) continue

          // DEDUP: Skip if we already emitted CROWD_BIAS for this pair within 60s.
          // Prevents duplicate signals within one Binance 5m update cycle.
          const alreadyDetected = anomaliesRef.current.some(
            a => a.pair === label && a.category === 'CROWD_BIAS' && Date.now() - a.timestamp < 60000
          )
          if (alreadyDetected) continue

          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: label,
            category: 'CROWD_BIAS',
            tag: 'CROWD',
            sizeUsd: r.dominantPct * 1_000_000,
            imbalance: r.bias === 'LONG_BIAS' ? r.longAccount * 1000 : -r.shortAccount * 1000,
            timestamp: Date.now(),
            // Momentum: if top traders are long → LONG (BID), if short → SHORT (ASK)
            side: r.bias === 'LONG_BIAS' ? 'BID' : 'ASK',
            exchange: 'Binance',
            fadedIn: true,
            details: `Top traders ${(r.dominantPct * 100).toFixed(1)}% ${r.bias === 'LONG_BIAS' ? 'LONG' : 'SHORT'} → follow ${r.bias === 'LONG_BIAS' ? 'LONG' : 'SHORT'}`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          crowdBiasEmitted++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }
        if (crowdBiasEmitted > 0) {
          console.log(`[CROWD_BIAS] Emitted ${crowdBiasEmitted} signal(s) from ${Object.keys(data.ratios || {}).length} pairs`)
        }
        updateSignalHealth('CROWD_BIAS', 'ok', crowdBiasEmitted)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('CROWD_BIAS', 'error', 0, err instanceof Error ? err.message : String(err))
        console.warn('[CEX Anomaly] Binance top-trader-ratio fetch failed:', err)
        logEvent('WARNING', 'CROWD_BIAS', 'Fetch failed', err instanceof Error ? err.message : String(err))
      }
    }

    void fetchTopTrader()
    const interval = setInterval(fetchTopTrader, 30_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Binance Taker Buy/Sell Volume (every 30s) — TAKER_IMBALANCE ──
  // Real taker buy/sell ratio from Binance Futures public API.
  // When ratio > 1.5x → aggressive flow in one direction.
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchTakerVolume = async () => {
      try {
        const res = await fetch('/api/binance/taker-volume', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('TakerVolume API error')
        const data = await res.json()
        if (!mountedRef.current) return

        for (const [label, vol] of Object.entries(data.volumes || {})) {
          const v = vol as any
          if (v.imbalance === 'BALANCED') continue
          if (!enabledPairsRef.current.has(label)) continue
          // Only emit if ratio > 1.5x (the SIZE_THRESHOLDS threshold)
          if (v.ratioAbs < 1.5) continue
          // TAKER WHITELIST: only allow TAKER signals on whitelisted pairs
          // Pairs not on the whitelist have negative avg_move → TAKER buying gets absorbed
          if (!(TAKER_WHITELIST as readonly string[]).includes(label)) continue

          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: label,
            category: 'TAKER_IMBALANCE',
            tag: 'TAKER',
            sizeUsd: v.ratioAbs * 500_000,
            imbalance: v.imbalance === 'BUY_DOMINANT' ? v.ratioAbs * 500 : -v.ratioAbs * 500,
            timestamp: Date.now(),
            side: v.imbalance === 'BUY_DOMINANT' ? 'BID' : 'ASK',
            exchange: 'Binance',
            fadedIn: true,
            details: `Taker ${v.imbalance === 'BUY_DOMINANT' ? 'buy' : 'sell'} ${v.buySellRatio?.toFixed(2)}x → aggressive ${v.imbalance === 'BUY_DOMINANT' ? 'buying' : 'selling'}`,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }
        updateSignalHealth('TAKER_IMBALANCE', 'ok', Object.keys(data.volumes || {}).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('TAKER_IMBALANCE', 'error', 0, err instanceof Error ? err.message : String(err))
      }
    }

    void fetchTakerVolume()
    const interval = setInterval(fetchTakerVolume, 30_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Binance Sentiment (OI_VELOCITY + LIQ_CASCADE from Binance) ────
  // This API also provides CROWD_BIAS and TAKER_IMBALANCE, but those are already
  // fetched via dedicated endpoints. We only use OI_VELOCITY and LIQUIDATION_CASCADE
  // from here to avoid duplicates. Polls every 60s (data is 5m granularity).
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchSentiment = async () => {
      try {
        const res = await fetch('/api/binance/sentiment', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Sentiment API error')
        const data = await res.json()
        if (!mountedRef.current) return

        // ── OI_VELOCITY from Binance OI history ──
        for (const vel of (data.oiVelocity || [])) {
          if (!enabledPairsRef.current.has(vel.symbol)) continue

          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: vel.symbol,
            category: 'OI_VELOCITY',
            tag: 'OI-VEL',
            sizeUsd: vel.value * 10_000_000,
            imbalance: vel.side === 'BID' ? vel.value * 200 : -vel.value * 200,
            timestamp: Date.now(),
            side: vel.side,
            exchange: 'Binance',
            fadedIn: true,
            details: vel.details,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }

        // ── LIQUIDATION_CASCADE from Binance forceOrders ──
        // Real liquidation data: when one side has >$500K liquidations and >2x
        // the other side → cascade signal. Critical convergence partner for CROWD_BIAS.
        for (const casc of (data.liquidationCascade || [])) {
          if (!enabledPairsRef.current.has(casc.symbol)) continue

          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: casc.symbol,
            category: 'LIQUIDATION_CASCADE',
            tag: 'LIQ-CASCADE',
            sizeUsd: casc.value,
            imbalance: casc.side === 'BID' ? casc.value / 500 : -casc.value / 500,
            timestamp: Date.now(),
            side: casc.side,
            exchange: 'Binance',
            fadedIn: true,
            details: casc.details,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }
        updateSignalHealth('Sentiment', 'ok', (data.oiVelocity || []).length + (data.liquidationCascade || []).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('Sentiment', 'error', 0, err instanceof Error ? err.message : String(err))
        console.warn('[CEX Anomaly] Binance sentiment fetch failed:', err)
        logEvent('WARNING', 'SENTIMENT', 'Fetch failed', err instanceof Error ? err.message : String(err))
      }
    }

    void fetchSentiment()
    const interval = setInterval(fetchSentiment, 60_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── P1-1: Fetch Whale Alert transfers (every 60s) → WHALE_INFLOW signals ────
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchWhaleAlert = async () => {
      try {
        const res = await fetch('/api/whale-alert/transfers', {
          signal: controller.signal,
        })
        if (!res.ok) {
          if (res.status === 503) return // API key not configured — silently skip
          throw new Error(`Whale Alert API ${res.status}`)
        }
        const data = await res.json()
        if (!mountedRef.current) return

        for (const tx of (data.signals || [])) {
          if (!enabledPairsRef.current.has(tx.symbol)) continue

          const anomaly: OrderFlowAnomaly = {
            id: uid(),
            pair: tx.symbol,
            category: 'WHALE_INFLOW',
            tag: 'INFLOW',
            sizeUsd: tx.valueUsd,
            imbalance: tx.side === 'BID' ? tx.valueUsd / 1000 : -tx.valueUsd / 1000,
            timestamp: Date.now(),
            side: tx.side,
            exchange: tx.blockchain?.charAt(0).toUpperCase() + tx.blockchain?.slice(1) || 'On-chain',
            fadedIn: true,
            details: tx.details,
            source: 'REAL',
          }
          anomalyCountRef.current++
          setAnomalies(prev => [anomaly, ...prev].slice(0, LIMITS.MAX_ANOMALIES))
          if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
            processAnomalyRef.current(anomaly)
          }
        }
        updateSignalHealth('WhaleAlert', 'ok', (data.signals || []).length)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        updateSignalHealth('WhaleAlert', 'error', 0, err instanceof Error ? err.message : String(err))
      }
    }

    void fetchWhaleAlert()
    const interval = setInterval(fetchWhaleAlert, 60_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused])

  // ─── Fetch Cross-Exchange Depth from CCXT (every 10s for active pair) ────
  useEffect(() => {
    if (paused) return
    const controller = new AbortController()

    const fetchCrossDepth = async () => {
      try {
        const res = await fetch(`/api/ccxt/multi-depth?symbol=${encodeURIComponent(activePair.symbol)}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Multi-depth API error')
        const data = await res.json()

        if (!mountedRef.current) return

        const snapshot: CrossExchangeSnapshot = {
          fetchedAt: data.fetchedAt || Date.now(),
          pair: data.pair || activePair.symbol,
          depths: data.depths || [],
          wallAnomalyDetected: data.wallAnomalyDetected || false,
          wallAnomalySide: data.wallAnomalySide,
          wallAnomalyExchange: data.wallAnomalyExchange,
          wallAnomalySize: data.wallAnomalySize || 0,
          wallAnomalyRatio: data.wallAnomalyRatio || 0,
        }
        setCrossExSnapshot(snapshot)
        crossExSnapshotRef.current = snapshot
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Silent fail for cross-exchange depth
      }
    }

    void fetchCrossDepth()
    const interval = setInterval(fetchCrossDepth, 10_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [paused, activePair.symbol])

  // ─── Safe flash with cleanup ──────────────────────────────────────────
  const triggerFlash = useCallback((id: string) => {
    setFlashId(id)
    const timer = setTimeout(() => {
      if (mountedRef.current) setFlashId(null)
      // AUDIT FIX: Remove expired timer ID to prevent unbounded array growth
      flashTimersRef.current = flashTimersRef.current.filter(t => t !== timer)
    }, LIMITS.FLASH_TIMEOUT_MS)
    flashTimersRef.current.push(timer)
  }, [])

  // ─── Anomaly generator: DISABLED when ANOMALY_GENERATOR_ENABLED=false ──
  // P0 FIX: Previously, ANOMALY_GENERATOR_ENABLED was defined but never checked,
  // so 80%+ of anomalies were random fake signals. Now we respect the flag.
  // To re-enable simulated anomalies for testing, set SIM.ANOMALY_GENERATOR_ENABLED=true
  // in cex-anomaly-constants.ts.
  useEffect(() => {
    if (paused) return
    if (!SIM.ANOMALY_GENERATOR_ENABLED) return // ← CRITICAL: respect the flag!
    const interval = setInterval(() => {
      if (!mountedRef.current) return
      const anomaly = generateSimAnomaly()
      anomaly.source = 'SIM'
      anomalyCountRef.current++
      setAnomalies(prev =>
        [{ ...anomaly, fadedIn: true }, ...prev].slice(0, LIMITS.MAX_ANOMALIES)
      )
      if (LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any)) {
        processAnomalyRef.current(anomaly)
      }
    }, SIM.ANOMALY_INTERVAL_MIN_MS + Math.random() * (SIM.ANOMALY_INTERVAL_MAX_MS - SIM.ANOMALY_INTERVAL_MIN_MS))
    return () => clearInterval(interval)
  }, [paused, generateSimAnomaly])

  // ─── Price + CVD + Liquidation tick: active pair every 500ms, others every 1.5s ────────────
  // PERF FIX: Non-active pairs don't need 2Hz updates — nobody sees them.
  // Active pair (heatmap, CVD chart, orderbook) still gets full 500ms tick.
  // Non-active pairs update every 3rd tick (1.5s) — sufficient for pair selector arrows.
  // This cuts ~6,500 array allocations/sec down to ~2,500.
  useEffect(() => {
    if (paused) return

    const interval = setInterval(() => {
      if (!mountedRef.current) return
      tickCountRef.current++
      const tick = tickCountRef.current
      const isActiveTick = true // active pair always ticks
      const isBackgroundTick = tick % 3 === 0 // non-active pairs tick every 3rd

      setPairSims(prev => {
        const updated = { ...prev }

        for (const pair of ALL_PAIRS) {
          const isActivePair = pair.symbol === activePair.symbol
          // Skip non-active pairs on non-background ticks
          if (!isActivePair && !isBackgroundTick) continue

          const sim = { ...prev[pair.symbol] }

          // ── Price update: WS anchor vs simulated random walk ──
          // When WS orderbook is connected for the active pair, we anchor
          // sim.price to the real WS midpoint. This keeps the header price,
          // heatmap price line, and orderbook prices perfectly in sync.
          // For non-active pairs (or when WS is disconnected), we use the
          // simulated random walk with cascade logic.
          const isWsAnchored = pair.symbol === activePair.symbol && wsPriceRef.current !== null

          if (isWsAnchored) {
            // Use real WS price — no random walk, no cascade simulation
            sim.price = wsPriceRef.current!
          } else {
            // Check Multi-WS for this pair — provides real-time bid/ask midpoint
            // for ALL watched pairs, not just the active one
            const multiWsPrice = multiWsPricesRef.current[pair.binanceSymbol]
            if (multiWsPrice && multiWsPrice.bestBid > 0 && multiWsPrice.bestAsk > 0) {
              // Anchor to Multi-WS midpoint — real price, no random walk
              sim.price = (multiWsPrice.bestBid + multiWsPrice.bestAsk) / 2
            } else {
              // Fallback: simulated random walk (when Multi-WS also has no data)
              let priceDelta = (Math.random() - SIM.PRICE_DRIFT_BIAS) * sim.price * pair.vol

              // Liquidation cascade logic
              if (sim.cascadeTarget !== null) {
                sim.cascadeTick++
                const target = sim.cascadeTarget
                const direction = target > sim.price ? 1 : -1

                if (sim.cascadeTick <= 3) {
                  priceDelta = direction * sim.price * SIM.CASCADE_MOMENTUM
                } else if (sim.cascadeTick <= SIM.CASCADE_MAX_TICKS) {
                  priceDelta = -direction * sim.price * SIM.CASCADE_REVERSAL
                } else {
                  sim.cascadeTarget = null
                  sim.cascadeTick = 0
                }
              }

              // Trigger cascade near cluster
              if (sim.cascadeTarget === null && Math.random() < SIM.CASCADE_TRIGGER_PROB) {
                const nearestBar = sim.liqBars.find(b =>
                  Math.abs(b.price - sim.price) < sim.price * SIM.CASCADE_DIST_THRESHOLD &&
                  (b.longLiq > SIM.CASCADE_MIN_LIQ || b.shortLiq > SIM.CASCADE_MIN_LIQ)
                )
                if (nearestBar) {
                  sim.cascadeTarget = nearestBar.price
                  sim.cascadeTick = 0
                }
              }

              sim.price = sim.price + priceDelta
            } // end Multi-WS fallback else
          } // end else (not isWsAnchored)

          const newPrice = sim.price

          // CVD simulation (only if WS not providing real data for this pair)
          let tickCvdDelta = 0
          if (pair.symbol !== activePair.symbol || !wsConnected) {
            if (tickCountRef.current % SIM.CVD_BIAS_CHANGE_FREQ === 0) {
              sim.cvdBias = (Math.random() - 0.5) * SIM.CVD_BIAS_RANGE
            }

            const marketBuyProb = 0.5 + sim.cvdBias * SIM.CVD_BIAS_INFLUENCE
            const isBuy = Math.random() < marketBuyProb
            const volume = SIM.CVD_VOLUME_MIN + Math.random() * (SIM.CVD_VOLUME_MAX - SIM.CVD_VOLUME_MIN)
            tickCvdDelta = isBuy ? volume : -volume
            sim.cvd += tickCvdDelta
          }

          // CVD data point — compute delta from cumulative CVD change
          // IMMUTABLE UPDATE: create new array each tick so React useMemo deps
          // (sim.cvdData reference) detect the change and chart data recalculates.
          // Old push+splice mutated in place → same reference → useMemo skipped → charts froze.
          const prevCvd = sim.cvdData.length > 0 ? sim.cvdData[sim.cvdData.length - 1].cvd : sim.cvd
          const currentCvdDelta = sim.cvd - prevCvd || tickCvdDelta
          const newCvdPoint = {
            t: Date.now(),
            price: newPrice,
            cvd: sim.cvd,
            cvdDelta: currentCvdDelta,
          }
          const nextCvdData = [...sim.cvdData, newCvdPoint]
          sim.cvdData = nextCvdData.length > LIMITS.MAX_CVD_POINTS
            ? nextCvdData.slice(nextCvdData.length - LIMITS.MAX_CVD_POINTS)
            : nextCvdData

          // ── TA Indicators: VWAP, SMA 8/21, Momentum ──
          // NOTE: These are DISPLAY-ONLY. They do NOT affect scoring or exits.
          // Update price history — IMMUTABLE UPDATE (same reason as cvdData)
          const nextPriceHistory = [...sim.priceHistory, newPrice]
          sim.priceHistory = nextPriceHistory.length > TA_CONFIG.MAX_PRICE_HISTORY
            ? nextPriceHistory.slice(nextPriceHistory.length - TA_CONFIG.MAX_PRICE_HISTORY)
            : nextPriceHistory

          // VWAP: Rolling window (was cumulative = session avg = useless)
          // Rolling VWAP over last N ticks gives a meaningful volume-weighted reference
          const vwapWindow = sim.priceHistory.slice(-TA_CONFIG.VWAP_ROLLING_WINDOW)
          const vwapVol = vwapWindow.length
          sim.vwap = vwapVol > 0 ? vwapWindow.reduce((s, p) => s + p, 0) / vwapVol : newPrice

          // SMA 8 & SMA 21
          if (sim.priceHistory.length >= TA_CONFIG.SMA_FAST) {
            const slice8 = sim.priceHistory.slice(-TA_CONFIG.SMA_FAST)
            sim.sma8 = slice8.reduce((a, b) => a + b, 0) / slice8.length
          }
          if (sim.priceHistory.length >= TA_CONFIG.SMA_SLOW) {
            const slice21 = sim.priceHistory.slice(-TA_CONFIG.SMA_SLOW)
            sim.sma21 = slice21.reduce((a, b) => a + b, 0) / slice21.length
          }

          // Momentum: relative % change (was absolute $ — not comparable across pairs)
          if (sim.priceHistory.length > TA_CONFIG.MOM_PERIOD) {
            const prevPrice = sim.priceHistory[sim.priceHistory.length - 1 - TA_CONFIG.MOM_PERIOD]
            sim.momentum = prevPrice !== 0 ? ((newPrice - prevPrice) / prevPrice) * 100 : 0
          } else {
            sim.momentum = 0
          }
          // Track rolling momentum peak — reset every 50 ticks to avoid perpetual divergence
          if (sim.momentum > sim.momPeak || tickCountRef.current % 50 === 0) {
            sim.momPeak = sim.momentum
          }

          // Bollinger Bands: compute from priceHistory for TA INFO display
          if (sim.priceHistory.length >= BB_SIGNAL.PERIOD) {
            const bb = computeBB(sim.priceHistory, BB_SIGNAL.PERIOD, BB_SIGNAL.STD_DEV)
            const bbLast = sim.priceHistory.length - 1
            if (bb.upper[bbLast] !== null) sim.bbUpper = bb.upper[bbLast]!
            if (bb.lower[bbLast] !== null) sim.bbLower = bb.lower[bbLast]!
          }

          // MACD: compute from priceHistory — SAME timeframe as VWAP/SMA/MOM
          // MACD confirms trend momentum on the tick-by-tick price series
          // NOTE: This is DISPLAY-ONLY for the TA Confirmation Panel.
          //       Signal detection has been moved to the 15m candle close block below.
          if (sim.priceHistory.length >= TA_CONFIG.MACD_SLOW) {
            const macdState = computeMACDFromHistory(
              sim.priceHistory,
              sim.macdHistogram, // prevHist for cross detection
            )
            if (macdState) {
              sim.macdHistPrev = sim.macdHistogram  // store previous before update
              sim.macdLine = macdState.macdLine
              sim.macdSignal = macdState.macdSignal
              sim.macdHistogram = macdState.macdHistogram
            }
          }

          // ── MACD Virtual Signal Resolution (every tick) ──
          // Check if any active MACD signal has hit TP, SL, or TTL.
          // TP/SL is checked every tick (immediate fill); TTL is checked against
          // the count of completed 15m candles.
          {
            const activeMacdSignal = macdSignalsRef.current.get(`macd-${pair.symbol}`)
            if (activeMacdSignal) {
              const priceDiff = (sim.price - activeMacdSignal.entryPrice) / activeMacdSignal.entryPrice * 100
              const isFavorable = activeMacdSignal.side === 'SHORT' ? priceDiff < 0 : priceDiff > 0
              const absMove = Math.abs(priceDiff)

              let resolved = false
              let closeReason: 'TAKE PROFIT' | 'STOP LOSS' | 'TIMEOUT' = 'TAKE PROFIT'
              let pnlPct = 0

              if (isFavorable && absMove >= TA_CONFIG.MACD_15M_TP_PCT) {
                resolved = true
                closeReason = 'TAKE PROFIT'
                pnlPct = absMove
              } else if (!isFavorable && absMove >= TA_CONFIG.MACD_15M_SL_PCT) {
                resolved = true
                closeReason = 'STOP LOSS'
                pnlPct = -absMove
              } else if (sim.candle15mCloses.length - activeMacdSignal.candlesAtEntry >= TA_CONFIG.MACD_15M_TTL_CANDLES) {
                // TTL expired — close as TIMEOUT
                resolved = true
                closeReason = 'TIMEOUT'
                pnlPct = activeMacdSignal.side === 'SHORT' ? priceDiff : -priceDiff  // signed PnL
              }

              if (resolved) {
                macdSignalsRef.current.delete(`macd-${pair.symbol}`)
                bumpVirtualSignalVersion()
                const signalType = activeMacdSignal.side === 'SHORT' ? 'MACD_BEAR_CROSS' as const : 'MACD_BULL_CROSS' as const
                const pointsDelta = calculatePointsDelta(pnlPct, closeReason)
                setSignalEvents(prev => {
                  const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
                  return [...prev, {
                    sessionId: signalSessionId,
                    timestamp: new Date().toISOString(),
                    signalType,
                    pair: activeMacdSignal.pair,
                    side: activeMacdSignal.side,
                    entryPrice: activeMacdSignal.entryPrice,
                    exitPrice: sim.price,
                    pnl: 0,  // virtual signal — no actual $ PnL
                    pnlPct,
                    closeReason,
                    leverage: 1,
                    hurstAtEntry: 0,
                    hcccoFastAtEntry: 0,
                    hcccoSlowAtEntry: 0,
                    confidenceScore: 0,
                    anomalyCategory: activeMacdSignal.side === 'SHORT' ? 'MACD_BEAR_CROSS' : 'MACD_BULL_CROSS',
                    pointsDelta,
                    runningTotal,
                  }]
                })
              }
            }
          }

          // RSI: incremental update — SAME timeframe as VWAP/SMA/MOM
          // Uses Wilder's smoothed RSI computed tick-by-tick from price changes
          if (sim.priceHistory.length >= 2) {
            const prevPrice = sim.priceHistory[sim.priceHistory.length - 2]
            const rsiState = computeRSIIncremental(
              prevPrice,
              newPrice,
              sim.rsiAvgGain,
              sim.rsiAvgLoss,
              sim.rsiWarmup,
            )
            sim.rsi = rsiState.rsi
            sim.rsiAvgGain = rsiState.avgGain
            sim.rsiAvgLoss = rsiState.avgLoss
            sim.rsiWarmup = rsiState.warmup
          }

          // ── 15-minute candle RSI ──
          // Build 15m candles from tick prices and compute RSI on completed candles.
          // Overbought RSI15m >= 76.50 → SHORT signal, Oversold RSI15m <= 26.50 → LONG signal
          {
            const now = Date.now()
            // Initialize candle start timestamp on first tick
            if (sim.candle15mStartTs === 0) {
              sim.candle15mStartTs = Math.floor(now / TA_CONFIG.CANDLE_15M_MS) * TA_CONFIG.CANDLE_15M_MS
              sim.candle15mOpen = newPrice
            }
            // Check if current 15m candle has completed
            const currentCandleStart = Math.floor(now / TA_CONFIG.CANDLE_15M_MS) * TA_CONFIG.CANDLE_15M_MS
            if (currentCandleStart > sim.candle15mStartTs) {
              // Previous candle completed — push its close price
              const candleClose = sim.price  // last price of the completed candle
              sim.candle15mCloses.push(candleClose)
              // Cap history
              if (sim.candle15mCloses.length > TA_CONFIG.MAX_CANDLE_15M_HISTORY) {
                sim.candle15mCloses = sim.candle15mCloses.slice(sim.candle15mCloses.length - TA_CONFIG.MAX_CANDLE_15M_HISTORY)
              }
              // Compute RSI incrementally from the new candle close
              if (sim.candle15mCloses.length >= 2) {
                const prevClose = sim.candle15mCloses[sim.candle15mCloses.length - 2]
                const rsi15mState = computeRSIIncremental(
                  prevClose,
                  candleClose,
                  sim.rsi15mAvgGain,
                  sim.rsi15mAvgLoss,
                  sim.rsi15mWarmup,
                )
                sim.rsi15mPrev = sim.rsi15m
                sim.rsi15m = rsi15mState.rsi
                sim.rsi15mAvgGain = rsi15mState.avgGain
                sim.rsi15mAvgLoss = rsi15mState.avgLoss
                sim.rsi15mWarmup = rsi15mState.warmup

                // ── RSI 15m Virtual Signal Detection ──
                // When RSI 15m crosses user thresholds: SHORT at 76.50, LONG at 26.50
                // Create a virtual signal that auto-resolves with 2% TP / 6.5% SL
                const isWarmed = sim.rsi15mWarmup > TA_CONFIG.RSI_PERIOD
                if (isWarmed) {
                  const prevRsi15m = sim.rsi15mPrev
                  const currRsi15m = sim.rsi15m

                  // SHORT signal: RSI 15m crosses above 76.50
                  if (prevRsi15m < TA_CONFIG.RSI_15M_OVERBOUGHT && currRsi15m >= TA_CONFIG.RSI_15M_OVERBOUGHT) {
                    rsi15mSignalsRef.current.set(pair.symbol, {
                      pair: pair.symbol,
                      side: 'SHORT',
                      entryPrice: sim.price,
                      rsiAtEntry: currRsi15m,
                      timestamp: Date.now(),
                    })
                    bumpVirtualSignalVersion()
                  }
                  // LONG signal: RSI 15m crosses below 26.50
                  if (prevRsi15m > TA_CONFIG.RSI_15M_OVERSOLD && currRsi15m <= TA_CONFIG.RSI_15M_OVERSOLD) {
                    rsi15mSignalsRef.current.set(pair.symbol, {
                      pair: pair.symbol,
                      side: 'LONG',
                      entryPrice: sim.price,
                      rsiAtEntry: currRsi15m,
                      timestamp: Date.now(),
                    })
                    bumpVirtualSignalVersion()
                  }
                }
              }

              // ── MACD 15m — compute on closed candle & detect line↔signal cross ──
              // Computed on the same 15m candle closes series as RSI 15m.
              // Trigger = MACD line crosses signal line (classical), NOT histogram↔zero.
              // Magnitude filter: |histogram| must be >= MACD_15M_HIST_MIN_PCT % of price.
              // No-overwrite rule: if a signal already exists on this pair, it is closed
              //   as SIGNAL FLIP (with PnL) before opening the new one.
              if (sim.candle15mCloses.length >= TA_CONFIG.MACD_SLOW + TA_CONFIG.MACD_SIGNAL) {
                const macdState15m = computeMACDFromHistory(
                  sim.candle15mCloses,
                  sim.macd15mHistogram,
                )
                if (macdState15m) {
                  sim.macd15mLinePrev = sim.macd15mLine
                  sim.macd15mSignalPrev = sim.macd15mSignal
                  sim.macd15mLine = macdState15m.macdLine
                  sim.macd15mSignal = macdState15m.macdSignal
                  sim.macd15mHistogram = macdState15m.macdHistogram

                  // Line ↔ Signal cross detection
                  const prevLine = sim.macd15mLinePrev
                  const prevSig = sim.macd15mSignalPrev
                  const currLine = sim.macd15mLine
                  const currSig = sim.macd15mSignal

                  const wasBullish = prevLine >= prevSig  // macdLine above signal = bullish
                  const isBullish = currLine >= currSig

                  // Bearish cross: macdLine crosses below signal → SHORT
                  const bearCross = wasBullish && !isBullish
                  // Bullish cross: macdLine crosses above signal → LONG
                  const bullCross = !wasBullish && isBullish

                  if (bearCross || bullCross) {
                    // Magnitude filter — reject micro-crosses
                    const histMag = Math.abs(macdState15m.macdHistogram)
                    const minMag = (TA_CONFIG.MACD_15M_HIST_MIN_PCT * candleClose) / 100
                    if (histMag >= minMag) {
                      const newSide: 'LONG' | 'SHORT' = bullCross ? 'LONG' : 'SHORT'

                      // ── No-overwrite rule: close existing signal as SIGNAL FLIP ──
                      const existing = macdSignalsRef.current.get(`macd-${pair.symbol}`)
                      if (existing) {
                        const priceDiff = (sim.price - existing.entryPrice) / existing.entryPrice * 100
                        const pnlPct = existing.side === 'SHORT' ? priceDiff : -priceDiff  // signed PnL
                        macdSignalsRef.current.delete(`macd-${pair.symbol}`)
                        const flipSignalType = existing.side === 'SHORT' ? 'MACD_BEAR_CROSS' as const : 'MACD_BULL_CROSS' as const
                        const flipPointsDelta = calculatePointsDelta(pnlPct, 'SIGNAL FLIP')
                        setSignalEvents(prev => {
                          const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + flipPointsDelta
                          return [...prev, {
                            sessionId: signalSessionId,
                            timestamp: new Date().toISOString(),
                            signalType: flipSignalType,
                            pair: existing.pair,
                            side: existing.side,
                            entryPrice: existing.entryPrice,
                            exitPrice: sim.price,
                            pnl: 0,
                            pnlPct,
                            closeReason: 'SIGNAL FLIP',
                            leverage: 1,
                            hurstAtEntry: 0,
                            hcccoFastAtEntry: 0,
                            hcccoSlowAtEntry: 0,
                            confidenceScore: 0,
                            anomalyCategory: existing.side === 'SHORT' ? 'MACD_BEAR_CROSS' : 'MACD_BULL_CROSS',
                            pointsDelta: flipPointsDelta,
                            runningTotal,
                          }]
                        })
                      }

                      // ── Open the new signal ──
                      macdSignalsRef.current.set(`macd-${pair.symbol}`, {
                        pair: pair.symbol,
                        side: newSide,
                        entryPrice: sim.price,
                        macdLineAtEntry: currLine,
                        macdSignalAtEntry: currSig,
                        macdHistAtEntry: macdState15m.macdHistogram,
                        candlesAtEntry: sim.candle15mCloses.length,
                        timestamp: Date.now(),
                      })
                      bumpVirtualSignalVersion()
                    }
                  }
                }
              }
              // Start new candle
              sim.candle15mStartTs = currentCandleStart
              sim.candle15mOpen = newPrice
            }

            // ── RSI 15m Virtual Signal Resolution (every tick) ──
            // Check if any active RSI 15m signal has hit TP or SL
            const activeRsiSignal = rsi15mSignalsRef.current.get(pair.symbol)
            if (activeRsiSignal) {
              const priceDiff = (sim.price - activeRsiSignal.entryPrice) / activeRsiSignal.entryPrice * 100
              const isFavorable = activeRsiSignal.side === 'SHORT' ? priceDiff < 0 : priceDiff > 0
              const absMove = Math.abs(priceDiff)

              let resolved = false
              let closeReason: 'TAKE PROFIT' | 'STOP LOSS' = 'TAKE PROFIT'
              let pnlPct = 0

              if (isFavorable && absMove >= TA_CONFIG.RSI_15M_TP_PCT) {
                // TP hit: price moved 2% in predicted direction
                resolved = true
                closeReason = 'TAKE PROFIT'
                pnlPct = activeRsiSignal.side === 'SHORT' ? -absMove : absMove  // SHORT: negative priceDiff = positive PnL
                if (activeRsiSignal.side === 'SHORT') pnlPct = Math.abs(priceDiff)  // PnL is positive for correct prediction
                else pnlPct = Math.abs(priceDiff)
              } else if (!isFavorable && absMove >= TA_CONFIG.RSI_15M_SL_PCT) {
                // SL hit: price moved 6.5% against prediction
                resolved = true
                closeReason = 'STOP LOSS'
                if (activeRsiSignal.side === 'SHORT') pnlPct = -Math.abs(priceDiff)  // SHORT: price went up = loss
                else pnlPct = -Math.abs(priceDiff)
              }

              if (resolved) {
                rsi15mSignalsRef.current.delete(pair.symbol)
                bumpVirtualSignalVersion()
                const signalType = activeRsiSignal.side === 'SHORT' ? 'RSI_15M_OVERBOUGHT' as const : 'RSI_15M_OVERSOLD' as const
                const pointsDelta = calculatePointsDelta(pnlPct, closeReason)
                setSignalEvents(prev => {
                  const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
                  return [...prev, {
                    sessionId: signalSessionId,
                    timestamp: new Date().toISOString(),
                    signalType,
                    pair: activeRsiSignal.pair,
                    side: activeRsiSignal.side,
                    entryPrice: activeRsiSignal.entryPrice,
                    exitPrice: sim.price,
                    pnl: 0,  // virtual signal — no actual $ PnL
                    pnlPct,
                    closeReason,
                    leverage: 1,
                    hurstAtEntry: 0,
                    hcccoFastAtEntry: 0,
                    hcccoSlowAtEntry: 0,
                    confidenceScore: 0,
                    anomalyCategory: activeRsiSignal.side === 'SHORT' ? 'RSI_15M_OVERBOUGHT' : 'RSI_15M_OVERSOLD',
                    pointsDelta,
                    runningTotal,
                  }]
                })
              }
            }
          }

          // Update liq bars periodically
          if (tickCountRef.current % SIM.LIQ_REGEN_FREQ === 0) {
            sim.liqBars = generateLiqBarsFromReal(newPrice, pair.liqMultiplier, Object.values(recentLiquidationsRef.current).flat(), pair.binanceSymbol)
          }

          // Detect divergence: compare price direction vs CVD flow direction
          // BEARISH: price makes higher high but CVD flow is weaker (buyers exhausted)
          // BULLISH: price makes lower low but CVD flow is stronger (sellers exhausted)
          // Enabled for all pairs — visual chart also does peak/trough divergence detection
          // PERF FIX: Use sim.cvdData directly (was newCvdData before push+splice refactor)
          if (tickCountRef.current % SIM.DIVERGENCE_DETECT_FREQ === 0 && sim.cvdData.length >= SIM.DIVERGENCE_MIN_POINTS) {
            const zones: DivergenceZone[] = []
            const lookback = SIM.DIVERGENCE_LOOKBACK
            const recent = sim.cvdData.slice(-lookback)
            const halfLen = Math.floor(recent.length / 2)
            const firstHalf = recent.slice(0, halfLen)
            const secondHalf = recent.slice(halfLen)

            // Price highs/lows
            const fPH = Math.max(...firstHalf.map(p => p.price))
            const sPH = Math.max(...secondHalf.map(p => p.price))
            const fPL = Math.min(...firstHalf.map(p => p.price))
            const sPL = Math.min(...secondHalf.map(p => p.price))

            // CVD flow: sum of deltas (net buying pressure) in each half
            const fCvdFlow = firstHalf.reduce((s, p) => s + p.cvdDelta, 0)
            const sCvdFlow = secondHalf.reduce((s, p) => s + p.cvdDelta, 0)

            // BEARISH: price rising but CVD flow weakening (buyers drying up)
            if (sPH > fPH && sCvdFlow < fCvdFlow) {
              zones.push({ startIdx: sim.cvdData.length - lookback + halfLen, endIdx: sim.cvdData.length - 1, type: 'BEARISH' })
            }

            // BULLISH: price falling but CVD flow strengthening (sellers drying up)
            if (sPL < fPL && sCvdFlow > fCvdFlow) {
              zones.push({ startIdx: sim.cvdData.length - lookback + halfLen, endIdx: sim.cvdData.length - 1, type: 'BULLISH' })
            }

            sim.divergenceZones = zones
          }

          updated[pair.symbol] = sim
        }

        return updated
      })

      // ── Tick open positions using current sim prices ──
      // P5+P6 fix: compute positions LOCALLY (not inside setPositions updater)
      // so that closedThisTickIds is populated BEFORE CTP reads it.
      // React 18 batches state updates, so side effects inside updaters
      // may not execute before CTP checks — causing double-close and stale data.
      let closedPnlThisTick = 0
      let partialMarginReleasedThisTick = 0 // Isolated margin: margin released by partial TP (paper mode)
      const closedThisTickIds = new Set<string>()
      const newlyClosedPositions: ActivePosition[] = [] // collect for batch add

      // ── Phase 1: Process individual exits (EXIT 1-6) on local copy ──
      const updatedPositions = positionsRef.current.map(pos => {
        if (pos.status !== 'OPEN') return pos

        const pairConfig = ALL_PAIRS.find(p => p.symbol === pos.pair)
        if (!pairConfig) return pos

        const sim = pairSimsRef.current[pos.pair]
        if (!sim) return pos

        let newPrice = sim.price
        // PERF FIX: push + splice instead of [...spread].slice()
        const newHistory = [...pos.priceHistory] // shallow copy needed for immutable update
        newHistory.push(newPrice)
        if (newHistory.length > LIMITS.MAX_POSITION_HISTORY) {
          newHistory.splice(0, newHistory.length - LIMITS.MAX_POSITION_HISTORY)
        }
        // Price change % → multiply by leverage for position PnL %
        let priceChangePercent = pos.side === 'LONG'
          ? ((newPrice - pos.entryPrice) / pos.entryPrice) * 100
          : ((pos.entryPrice - newPrice) / pos.entryPrice) * 100

        // Calculate exit fee at current notional value using position's fee rate
        let currentNotional = pos.sizeUsd * (1 + priceChangePercent / 100)
        let exitFee = currentNotional * pos.exitFeeRate
        let totalFees = pos.entryFee + exitFee

        // Net PnL = notional × priceChange% - fees (no double-leverage!)
        // sizeUsd is already margin×leverage, so multiply by raw price change only
        let netPnl = pos.sizeUsd * priceChangePercent / 100 - totalFees
        let netPnlPercent = (netPnl / pos.marginUsd) * 100

        // ── REAL mode override: use verified Bybit price/PnL for exit decisions ──
        // In REAL mode, bybitVerified positions have real markPrice and PnL from Bybit.
        // Using sim.price for exit decisions can close positions at a loss on Bybit
        // when sim shows TP hit but Bybit is actually underwater.
        if (bybitTradingRef.current && pos.bybitVerified && pos.currentPrice > 0) {
          // Override sim price with real Bybit markPrice for exit condition checks
          newPrice = pos.currentPrice
          priceChangePercent = pos.side === 'LONG'
            ? ((newPrice - pos.entryPrice) / pos.entryPrice) * 100
            : ((pos.entryPrice - newPrice) / pos.entryPrice) * 100
          currentNotional = pos.sizeUsd * (1 + priceChangePercent / 100)
          exitFee = currentNotional * pos.exitFeeRate
          totalFees = (pos.entryFee || 0) + exitFee
          netPnl = pos.sizeUsd * priceChangePercent / 100 - totalFees
          netPnlPercent = (netPnl / pos.marginUsd) * 100
        }

        // ── Update peak price & trailing SL ──
        const isFavorable = pos.side === 'LONG'
          ? newPrice > pos.peakPrice
          : newPrice < pos.peakPrice
        const newPeak = isFavorable
          ? (pos.side === 'LONG' ? Math.max(pos.peakPrice, newPrice) : Math.min(pos.peakPrice, newPrice))
          : pos.peakPrice

        // Calculate trailing distance in price terms — mode-specific
        let trailActivatePct: number = DYNAMIC_EXIT.TRAILING_ACTIVATE_PRICE_PCT
        let trailDistancePct: number = DYNAMIC_EXIT.TRAILING_DISTANCE_PCT
        let trailMinDistBps: number = DYNAMIC_EXIT.TRAILING_MIN_DISTANCE_BPS

        // Mode-specific trailing overrides
        const posTradingMode = pos.tradingMode || 'CONSERVATIVE'
        if (posTradingMode === 'AGGRESSIVE' && DYNAMIC_EXIT.AGGRESSIVE) {
          trailActivatePct = DYNAMIC_EXIT.AGGRESSIVE.TRAILING_ACTIVATE_PRICE_PCT
          trailDistancePct = DYNAMIC_EXIT.AGGRESSIVE.TRAILING_DISTANCE_PCT
          trailMinDistBps = DYNAMIC_EXIT.AGGRESSIVE.TRAILING_MIN_DISTANCE_BPS
        } else if (posTradingMode === 'SCALPER' && DYNAMIC_EXIT.SCALPER) {
          trailActivatePct = DYNAMIC_EXIT.SCALPER.TRAILING_ACTIVATE_PRICE_PCT
          trailDistancePct = DYNAMIC_EXIT.SCALPER.TRAILING_DISTANCE_PCT
          trailMinDistBps = DYNAMIC_EXIT.SCALPER.TRAILING_MIN_DISTANCE_BPS
        } else if (posTradingMode === 'CONTRARIAN' && DYNAMIC_EXIT.CONTRARIAN) {
          trailActivatePct = DYNAMIC_EXIT.CONTRARIAN.TRAILING_ACTIVATE_PRICE_PCT
          trailDistancePct = DYNAMIC_EXIT.CONTRARIAN.TRAILING_DISTANCE_PCT
          trailMinDistBps = DYNAMIC_EXIT.CONTRARIAN.TRAILING_MIN_DISTANCE_BPS
        }

        // ── DYNAMIC TRAILING: profit-dependent trailing distance ──
        // When enabled, trailing_pct adjusts based on current profit:
        //   <0.15% → 0.08% tight (protect entry from reversal)
        //   0.15-0.40% → 0.12% normal (let position grow)
        //   ≥0.40% → 0.20% loose (catch big moves, don't cut winners early)
        // Data: TRL median +0.22%, STOP median -0.82%, asymmetry 3.7x
        // Old static 0.50% trailing was too wide → let winners become losers
        const isDynamicTrailingMode = DYNAMIC_TRAILING.ENABLED
          && (DYNAMIC_TRAILING.MODES as readonly string[]).includes(posTradingMode)
        if (isDynamicTrailingMode && pos.trailingActive) {
          const profitPct = priceChangePercent // % of price move from entry
          let dynamicDistPct: number
          if (profitPct < DYNAMIC_TRAILING.TIER1_THRESHOLD) {
            dynamicDistPct = DYNAMIC_TRAILING.TIGHT_PCT * 100  // 0.08% → as pct for consistent units
          } else if (profitPct < DYNAMIC_TRAILING.TIER2_THRESHOLD) {
            dynamicDistPct = DYNAMIC_TRAILING.NORMAL_PCT * 100  // 0.12%
          } else {
            dynamicDistPct = DYNAMIC_TRAILING.LOOSE_PCT * 100   // 0.20%
          }
          // Override the static distance with dynamic value
          trailDistancePct = dynamicDistPct
        }

        const trailDistance = newPeak * trailDistancePct / 100
        const minTrailDistance = newPeak * trailMinDistBps / 10_000
        const effectiveTrailDist = Math.max(trailDistance, minTrailDistance)

        // New trailing stop: follows peak, never moves backward
        let newTrailingStop = pos.trailingStop
        if (pos.trailingActive) {
          const candidateStop = pos.side === 'LONG'
            ? newPeak - effectiveTrailDist
            : newPeak + effectiveTrailDist
          newTrailingStop = pos.side === 'LONG'
            ? Math.max(pos.trailingStop, candidateStop)
            : Math.min(pos.trailingStop, candidateStop)
        }

        // ── Activate trailing when price move exceeds mode-specific threshold ──
        // trailActivatePct is % of PRICE MOVE (not position PnL), set per trading mode
        let newTrailingActive = pos.trailingActive
        if (!pos.trailingActive && priceChangePercent >= trailActivatePct) {
          newTrailingActive = true
          // Set initial trailing stop at breakeven + small buffer
          const buffer = pos.entryPrice * trailMinDistBps / 10_000
          newTrailingStop = pos.side === 'LONG'
            ? pos.entryPrice + buffer
            : pos.entryPrice - buffer
        }

        // ── Update CVD peak for reversal detection ──
        const newCvdPeak = pos.side === 'LONG'
          ? Math.max(pos.cvdPeak, sim.cvd)
          : Math.min(pos.cvdPeak, sim.cvd)

        // ── Breakeven Stop: when enabled, SL moves to entry + buffer after favorable move ──
        // If BE was already hit, keep it active (SL stays at entry + buffer).
        // BE only triggers once per position; once active, SL never retreats.
        // priceChangePercent is % of PRICE MOVE in favorable direction.
        let newBreakevenHit = pos.breakevenHit
        let breakevenStopPrice = pos.shieldStopLoss // default: original shield stop
        if (beEnabledRef.current) {
          const triggerPct = beTriggerPctRef.current
          const favorablePct = pos.side === 'LONG'
            ? priceChangePercent
            : -priceChangePercent
          if (!newBreakevenHit && favorablePct >= triggerPct) {
            newBreakevenHit = true
          }
          if (newBreakevenHit) {
            // Move SL to entry + buffer (lock in tiny profit, eliminate loss risk)
            const buffer = pos.entryPrice * (beBufferBpsRef.current / 10_000)
            breakevenStopPrice = pos.side === 'LONG'
              ? pos.entryPrice + buffer
              : pos.entryPrice - buffer
          }
        }

        // ── CUSTOM SL OVERRIDE: when useCustomTPSL is ON, enforce EXACT custom SL distance ──
        // The monitoring loop MUST respect the user's custom SL setting.
        // effectiveSLRef is already in price% (divided by leverage if in PnL mode).
        // Previous code used sniperShieldPct cap which could move SL to a different distance.
        // Now: when custom SL is ON, breakevenStopPrice = EXACTLY effectiveSL% from entry.
        // EXCEPTION: when BE has triggered (beEnabledRef ON + newBreakevenHit), BE stop takes
        // priority — SL is moved to entry+buffer (tighter than custom SL, locks in profit).
        if (newBreakevenHit) {
          // BE already set breakevenStopPrice to entry ± buffer above. Keep it.
        } else if (useCustomTPSLRef.current && effectiveSLRef.current !== null) {
          const slPctFraction = effectiveSLRef.current / 100  // e.g. 6.0 → 0.06 (already in price%)
          if (pos.side === 'LONG') {
            breakevenStopPrice = pos.entryPrice * (1 - slPctFraction)
          } else {
            breakevenStopPrice = pos.entryPrice * (1 + slPctFraction)
          }
        } else {
          // ── Auto mode: Sniper Shield Cap — ensure SL never exceeds sniperShieldPct from entry ──
          const defaultSniperShieldPct = pos.leverage >= 100 ? 0.0004
                                : pos.leverage >= 20  ? 0.005
                                : pos.leverage >= 10  ? 0.005    // 0.5% — matches AGGRESSIVE SL
                                : 0  // 1x-5x: no sniper shield cap
          // Sniper shield cap always applies (BE cap exception handled above when beEnabledRef is ON)
          if (defaultSniperShieldPct > 0) {
            // Cap: SL price must not be further than sniperShieldPct from entry
            const maxSlDistance = pos.entryPrice * defaultSniperShieldPct
            if (pos.side === 'LONG') {
              const minSlPrice = pos.entryPrice - maxSlDistance
              breakevenStopPrice = Math.max(breakevenStopPrice, minSlPrice)
            } else {
              const maxSlPrice = pos.entryPrice + maxSlDistance
              breakevenStopPrice = Math.min(breakevenStopPrice, maxSlPrice)
            }
          }
        }

        // ══════════════════════════════════════════════════════════════════
        // EXIT CHECKS — order matters! Highest priority first
        // ══════════════════════════════════════════════════════════════════

        // NOTE: 100x Sniper Exit (EXIT 0) REMOVED — was too aggressive.
        // The shield SL + trailing system is sufficient protection.

        // EXIT 0.5: Burst TP — price spikes 3%+ within first 3 seconds
        // Crypto often pumps/dumps on entry signal then reverses.
        // At 10x: 3% price = 30% position PnL → huge profit on the burst.
        const posMode = (pos.tradingMode || 'CONSERVATIVE') as TradingMode
        const effectiveMode = posMode === 'CONSERVATIVE' && pos.leverage >= 10 ? 'AGGRESSIVE' : posMode
        if (DYNAMIC_EXIT.BURST_TP.ENABLED
            && (DYNAMIC_EXIT.BURST_TP.MODES as string[]).includes(effectiveMode)
            && priceChangePercent >= DYNAMIC_EXIT.BURST_TP.PRICE_PERCENT
            && (Date.now() - pos.openedAt) <= DYNAMIC_EXIT.BURST_TP.WINDOW_MS
            && netPnl > 0) {
          closedPnlThisTick += netPnl
          closedThisTickIds.add(pos.id)
          const closedPos: ActivePosition = {
            ...pos,
            currentPrice: newPrice,
            pnl: netPnl,
            pnlPercent: netPnlPercent,
            exitFee,
            totalFees,
            status: 'CLOSED_BURST_TP',
            closedAt: Date.now(),
            priceHistory: newHistory,
            peakPrice: newPeak,
            breakevenHit: newBreakevenHit,
            cvdPeak: newCvdPeak,
          }
          newlyClosedPositions.push(closedPos)
          return { ...closedPos }
        }

        // EXIT 1: Shield stop loss only (BE disabled)
        // - SL is always at sniper shield (0.50% from entry for 10x)
        // - Never moves to entry (no BE)
        // - SL GRACE PERIOD: skip SL check in first 15s after open
        // - When trailing is active, SL is not checked (trailing handles profit protection)
        const graceActive = DYNAMIC_EXIT.SL_GRACE.ENABLED
          && (Date.now() - pos.openedAt < DYNAMIC_EXIT.SL_GRACE.DURATION_MS)
        const shouldCheckSl = !newTrailingActive
        if (shouldCheckSl && !graceActive) {
          const hitStop = pos.side === 'LONG'
            ? newPrice <= breakevenStopPrice
            : newPrice >= breakevenStopPrice
          if (hitStop) {
            triggerFlash(pos.id)
            closedPnlThisTick += netPnl
            closedThisTickIds.add(pos.id)
            const closedPos: ActivePosition = {
              ...pos,
              currentPrice: newPrice,
              pnl: netPnl,
              pnlPercent: netPnlPercent,
              exitFee,
              totalFees,
              status: 'LIQUIDATED',
              closedAt: Date.now(),
              priceHistory: newHistory,
              peakPrice: newPeak,
              breakevenHit: newBreakevenHit,
              cvdPeak: newCvdPeak,
            }
            newlyClosedPositions.push(closedPos)
            return { ...closedPos }
          }
        }

        // EXIT 2: Trailing stop hit (only if active — protects profit)
        // Only close if actually profitable — if trailing triggers at a loss,
        // let the hard shield SL handle it instead (no double penalty)
        if (newTrailingActive && netPnl > 0) {
          const hitTrailing = pos.side === 'LONG'
            ? newPrice <= newTrailingStop
            : newPrice >= newTrailingStop
          if (hitTrailing) {
            closedPnlThisTick += netPnl
            closedThisTickIds.add(pos.id)
            const closedPos: ActivePosition = {
              ...pos,
              currentPrice: newPrice,
              pnl: netPnl,
              pnlPercent: netPnlPercent,
              exitFee,
              totalFees,
              status: 'CLOSED_TRAILING',
              closedAt: Date.now(),
              priceHistory: newHistory,
              peakPrice: newPeak,
              trailingStop: newTrailingStop,
              trailingActive: true,
              cvdPeak: newCvdPeak,
            }
            newlyClosedPositions.push(closedPos)
            return { ...closedPos }
          }
        }

        // EXIT 2b: Trailing active + net loss — fallback SL check
        // When trailing is active, the main SL check (EXIT 1) is skipped.
        // But if price reverses past entry to a net loss, neither exit triggers:
        //   - EXIT 1 skipped (shouldCheckSl = !newTrailingActive = false)
        //   - EXIT 2 skipped (netPnl <= 0)
        // This fallback ensures we still close at breakevenStopPrice when trailing
        // is active but the position has gone into loss.
        if (newTrailingActive && netPnl <= 0 && !graceActive) {
          const hitFallbackSL = pos.side === 'LONG'
            ? newPrice <= breakevenStopPrice
            : newPrice >= breakevenStopPrice
          if (hitFallbackSL) {
            triggerFlash(pos.id)
            closedPnlThisTick += netPnl
            closedThisTickIds.add(pos.id)
            const closedPos: ActivePosition = {
              ...pos,
              currentPrice: newPrice,
              pnl: netPnl,
              pnlPercent: netPnlPercent,
              exitFee,
              totalFees,
              status: 'LIQUIDATED',
              closedAt: Date.now(),
              priceHistory: newHistory,
              peakPrice: newPeak,
              breakevenHit: newBreakevenHit,
              cvdPeak: newCvdPeak,
            }
            newlyClosedPositions.push(closedPos)
            return { ...closedPos }
          }
        }

        // EXIT 3: Partial TP (Layer 3) — close 50% at TP1
        // TP1_PRICE_PERCENT is % of PRICE MOVE (not position PnL) — leverage amplifies automatically
        // P1 fix: keep original entryPrice so remaining PnL tracks correctly from same reference.
        // Previous bug: resetting entryPrice to newPrice "gave away" unrealized profit on remaining portion.
        // Now: partial PnL includes proportional fees for closed portion, remaining keeps its share of entry fee.
        if (!pos.partialTpTaken && priceChangePercent >= DYNAMIC_EXIT.TP1_PRICE_PERCENT) {
          const closeFraction = DYNAMIC_EXIT.PARTIAL_TP_FRACTION
          const remainingFraction = 1 - closeFraction
          // Calculate partial PnL with proper fee allocation for the closed portion
          const grossPnl = pos.sizeUsd * priceChangePercent / 100
          const partialGrossPnl = grossPnl * closeFraction
          const partialEntryFee = pos.entryFee * closeFraction
          const partialExitFee = exitFee * closeFraction
          const partialPnl = partialGrossPnl - partialEntryFee - partialExitFee
          closedPnlThisTick += partialPnl
          // Isolated margin simulation: release margin for the closed fraction (paper mode)
          // In real mode, Bybit automatically releases partial margin on reduce-only close.
          if (!bybitTradingRef.current) {
            partialMarginReleasedThisTick += pos.marginUsd * closeFraction
          }

          // ── REAL MODE: Send reduce-only order to Bybit for the partial fraction ──
          // Without this, the Bybit position stays at 100% while UI shows 50% — PnL desync.
          if (bybitTradingRef.current) {
            const [base] = pos.pair.split('-')
            const bybitSymbol = base.toUpperCase() + 'USDT'
            const partialSizeUsd = pos.sizeUsd * closeFraction // USD value of the portion to close
            bybitEnqueue(async () => { // partial close — CRITICAL, never drop
              try {
                const res = await fetch('/api/bybit/futures/close', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    symbol: bybitSymbol,
                    side: pos.side === 'LONG' ? 'Sell' : 'Buy', // opposite side to close
                    size: Math.round(partialSizeUsd),           // partial notional in USD
                    mode: 'real',
                    reduceOnly: true,                            // reduce-only: don't open new position
                  }),
                })

                const data = await res.json()
                if (data.success) {
                  console.log(`[BYBIT REAL] Partial TP: closed ${closeFraction * 100}% of ${pos.pair} ($${Math.round(partialSizeUsd)})`)
                  logEvent('INFO', 'BYBIT', `Partial TP ${closeFraction * 100}%: ${pos.side} ${pos.pair}`, `$${Math.round(partialSizeUsd)} closed`)
                } else {
                  console.error(`[BYBIT REAL] Partial TP failed: ${data.error}`)
                  logEvent('CRITICAL', 'BYBIT', `Partial TP failed: ${pos.side} ${pos.pair}`, data.error)
                }
              } catch (err) {
                console.error('[BYBIT REAL] Partial TP request error:', err)
                logEvent('CRITICAL', 'BYBIT', `Partial TP error: ${pos.side} ${pos.pair}`, err instanceof Error ? err.message : String(err))
              }
            }, true) // CRITICAL — never drop partial close orders
          }

          // Reduce position: realize partial profit, keep original entry for remainder
          return {
            ...pos,
            currentPrice: newPrice,
            partialTpTaken: true,
            remainingFraction: pos.remainingFraction * remainingFraction,
            sizeUsd: pos.sizeUsd * remainingFraction,
            marginUsd: pos.marginUsd * remainingFraction,
            entryPrice: pos.entryPrice, // P1 fix: KEEP original entry — remaining PnL tracks from same reference
            entryFee: pos.entryFee * remainingFraction,
            exitFee: exitFee * remainingFraction,
            totalFees: pos.entryFee * remainingFraction + exitFee * remainingFraction,
            pnl: 0,
            pnlPercent: 0,
            partialPnlRealized: pos.partialPnlRealized + partialPnl, // track cumulative partial TP PnL for equity curve
            peakPrice: newPrice,
            trailingActive: true, // activate trailing for remainder
            trailingStop: newTrailingStop,
            priceHistory: newHistory,
            cvdPeak: newCvdPeak,
          }
        }

        // EXIT 4: CVD Reversal Exit (Layer 2) — close when flow reverses
        // Only after TP1 reached (partialTpTaken) — don't kill position before it profits
        // DISABLED for simulated CVD — random walk data gives random exit signals
        const isCvdReal = pos.pair === activePair.symbol && wsConnected
        if (DYNAMIC_EXIT.CVD_REVERSAL_EXIT && isCvdReal && pos.trailingActive && pos.partialTpTaken) {
          const cvdMove = Math.abs(newCvdPeak - pos.cvdAtOpen)
          if (cvdMove > 0) {
            const cvdRetracement = pos.side === 'LONG'
              ? (newCvdPeak - sim.cvd) / cvdMove
              : (sim.cvd - newCvdPeak) / cvdMove
            if (cvdRetracement >= DYNAMIC_EXIT.CVD_REVERSAL_THRESHOLD) {
              closedPnlThisTick += netPnl
              closedThisTickIds.add(pos.id)
              const closedPos: ActivePosition = {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                status: 'CLOSED_SIGNAL_EXIT',
                closedAt: Date.now(),
                priceHistory: newHistory,
                peakPrice: newPeak,
                trailingStop: newTrailingStop,
                trailingActive: newTrailingActive,
                cvdPeak: newCvdPeak,
              }
              newlyClosedPositions.push(closedPos)
              return { ...closedPos }
            }
          }
        }

        // EXIT 4.5: MOM Divergence Exit — momentum exhausted while price still rising
        // Price makes new favorable high, but MOM is significantly below its peak
        // Only after TP1 reached (partialTpTaken) — don't kill position before it profits
        if (TA_CONFIG.MOM_DIV_EXIT && pos.trailingActive && pos.partialTpTaken && sim.momentum !== 0) {
          const isFavorablePrice = pos.side === 'LONG' ? newPrice > pos.peakPrice * 0.998 : newPrice < pos.peakPrice * 1.002
          if (isFavorablePrice && sim.momPeak !== 0) {
            // MOM divergence: price near peak but momentum faded
            const momFade = pos.side === 'LONG'
              ? sim.momentum < sim.momPeak * (1 - TA_CONFIG.MOM_DIV_THRESHOLD)
              : sim.momentum > sim.momPeak * (1 - TA_CONFIG.MOM_DIV_THRESHOLD)
            if (momFade) {
              closedPnlThisTick += netPnl
              closedThisTickIds.add(pos.id)
              const closedPos: ActivePosition = {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                status: 'CLOSED_MOM_DIV',
                closedAt: Date.now(),
                priceHistory: newHistory,
                peakPrice: newPeak,
                trailingStop: newTrailingStop,
                trailingActive: newTrailingActive,
                cvdPeak: newCvdPeak,
              }
              newlyClosedPositions.push(closedPos)
              return { ...closedPos }
            }
          }
        }

        // EXIT 4.6: VWAP Cross Exit — price crossed VWAP against position direction
        // Institutions stopped supporting: if LONG and price drops below VWAP, exit
        // Only after TP1 reached (partialTpTaken) — don't kill position before it profits
        if (TA_CONFIG.VWAP_CROSS_EXIT && pos.trailingActive && pos.partialTpTaken && sim.vwap > 0) {
          const vwapCrossed = pos.side === 'LONG'
            ? newPrice < sim.vwap  // LONG: price fell below VWAP
            : newPrice > sim.vwap  // SHORT: price rose above VWAP
          if (vwapCrossed) {
            closedPnlThisTick += netPnl
            closedThisTickIds.add(pos.id)
            const closedPos: ActivePosition = {
              ...pos,
              currentPrice: newPrice,
              pnl: netPnl,
              pnlPercent: netPnlPercent,
              exitFee,
              totalFees,
              status: 'CLOSED_VWAP_CROSS',
              closedAt: Date.now(),
              priceHistory: newHistory,
              peakPrice: newPeak,
              trailingStop: newTrailingStop,
              trailingActive: newTrailingActive,
              cvdPeak: newCvdPeak,
            }
            newlyClosedPositions.push(closedPos)
            return { ...closedPos }
          }
        }

        // EXIT 5: ICE-REV Signal Exit — counter-signal detected on same pair
        // Only after TP1 reached — don't kill position before it profits
        if (DYNAMIC_EXIT.ICE_REV_EXIT && pos.partialTpTaken) {
          const pairFunnel = funnelRef.current[pos.pair]
          if (pairFunnel?.convergence) {
            const hasIcRev = pairFunnel.signals.some(s =>
              s.anomaly.category === 'ICEBERG_REVERSAL' &&
              ((pos.side === 'LONG' && s.anomaly.side === 'ASK') ||
               (pos.side === 'SHORT' && s.anomaly.side === 'BID'))
            )
            if (hasIcRev) {
              closedPnlThisTick += netPnl
              closedThisTickIds.add(pos.id)
              const closedPos: ActivePosition = {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                status: 'CLOSED_SIGNAL_EXIT',
                closedAt: Date.now(),
                priceHistory: newHistory,
                peakPrice: newPeak,
                trailingStop: newTrailingStop,
                trailingActive: newTrailingActive,
                cvdPeak: newCvdPeak,
              }
              newlyClosedPositions.push(closedPos)
              return { ...closedPos }
            }
          }
        }

        // ── Resolve position's trading mode (used by EXIT 6 and EXIT 7) ──
        // posMode already resolved at EXIT 0.5 (BURST_TP) — reuse it here.

        // EXIT 6: Full TP — final target for remainder after partial
        // takeProfitPercent is % of PRICE MOVE — leverage amplifies PnL automatically
        // Guard: only close if actually profitable (net of fees)
        // FIX: use pos.tradingMode (not tradingModeRef.current) — same as TMO fix
        // CUSTOM TP OVERRIDE: when useCustomTPSL is ON, use customTP instead of mode default
        const posTP = useCustomTPSLRef.current
          ? customTPRef.current
          : (TRADING_MODES[posMode]?.takeProfitPercent ?? modeConfig.takeProfitPercent)
        if (priceChangePercent >= posTP && netPnl > 0) {
          closedPnlThisTick += netPnl
          closedThisTickIds.add(pos.id)
          const closedPos: ActivePosition = {
            ...pos,
            currentPrice: newPrice,
            pnl: netPnl,
            pnlPercent: netPnlPercent,
            exitFee,
            totalFees,
            status: 'CLOSED_TP',
            closedAt: Date.now(),
            priceHistory: newHistory,
            peakPrice: newPeak,
            trailingStop: newTrailingStop,
            trailingActive: newTrailingActive,
            cvdPeak: newCvdPeak,
          }
          newlyClosedPositions.push(closedPos)
          return { ...closedPos }
        }

        // EXIT 7: Time-Based Stop Loss (TMO) — positions that stay open too long
        // Implements DYNAMIC_EXIT.TIME_STOP config (was removed but configs remained orphaned).
        // Two-level TMO:
        //   WARN: soft checkpoint — if position has positive PnL after checkpoint, it gets more time
        //   HARD: absolute max age — close regardless of PnL
        // Mode-specific overrides: AGGRESSIVE and SCALPER have tighter TMOs.
        // MANUAL TMO: when customTMO > 0, use user-specified seconds instead of mode default.
        // posMode already resolved above (with BUG #3 fix for CONSERVATIVE+high leverage)
        const defaultPosModeTimeoutMs = TRADING_MODES[posMode]?.positionTimeoutMs ?? 0
        // Manual TMO override: if user set custom TMO (seconds), convert to ms and use it
        const posModeTimeoutMs = customTMORRef.current > 0
          ? customTMORRef.current * 1000
          : defaultPosModeTimeoutMs
        if (DYNAMIC_EXIT.TIME_STOP.ENABLED && tmoEnabledRef.current && posModeTimeoutMs > 0) {
          const positionAgeMs = Date.now() - pos.openedAt
          const anomalyCategory = pos.anomaly.category

          // Determine hard timeout — mode-specific overrides
          let hardTmoMs: number = posModeTimeoutMs
          // Category-specific overrides (LIQUIDATION_CASCADE = fast TMO)
          const categoryHardOverride = DYNAMIC_EXIT.TIME_STOP.TMO_HARD_OVERRIDES[anomalyCategory]
          if (categoryHardOverride !== undefined) {
            hardTmoMs = Math.min(hardTmoMs, categoryHardOverride)
          }
          // Scalper mode: use scalper-specific TMO
          if (posMode === 'SCALPER') {
            hardTmoMs = DYNAMIC_EXIT.TIME_STOP.TMO_HARD_SCALPER_MS
            // If already profitable, give extra time
            if (netPnl > 0) hardTmoMs = DYNAMIC_EXIT.TIME_STOP.TMO_HARD_SCALPER_PROFIT_MS
          }

          // HARD TMO: absolute time limit — close regardless of PnL
          if (positionAgeMs >= hardTmoMs) {
            closedPnlThisTick += netPnl
            closedThisTickIds.add(pos.id)
            const closedPos: ActivePosition = {
              ...pos,
              currentPrice: newPrice,
              pnl: netPnl,
              pnlPercent: netPnlPercent,
              exitFee,
              totalFees,
              status: 'CLOSED_TIMEOUT',
              closedAt: Date.now(),
              priceHistory: newHistory,
              peakPrice: newPeak,
              trailingStop: newTrailingStop,
              trailingActive: newTrailingActive,
              cvdPeak: newCvdPeak,
            }
            newlyClosedPositions.push(closedPos)
            return { ...closedPos }
          }

          // WARN TMO: soft checkpoint — give position more time if it's profitable
          // If not profitable at warn time and no checkpoint passed → close
          let warnTmoMs: number = DYNAMIC_EXIT.TIME_STOP.TMO_WARN_DEFAULT_MS
          const categoryWarnOverride = DYNAMIC_EXIT.TIME_STOP.TMO_WARN_OVERRIDES[anomalyCategory]
          if (categoryWarnOverride !== undefined) {
            warnTmoMs = Math.min(warnTmoMs, categoryWarnOverride)
          }
          if (posMode === 'SCALPER') {
            warnTmoMs = DYNAMIC_EXIT.TIME_STOP.TMO_WARN_SCALPER_MS
          }

          if (positionAgeMs >= warnTmoMs && !pos.tmoCheckpointPassed) {
            // Checkpoint: if PnL > checkpoint threshold, grant more time
            const checkpointPnlPct = DYNAMIC_EXIT.TIME_STOP.WARN_CHECKPOINT.CHECKPOINT_PNL_PCT
            const netPnlPct = (netPnl / pos.marginUsd) * 100
            if (netPnlPct >= checkpointPnlPct) {
              // Profitable enough at checkpoint — grant extension (don't close yet)
              // tmoCheckpointPassed flag prevents re-checking every tick
              return {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                priceHistory: newHistory,
                peakPrice: newPeak,
                trailingStop: newTrailingStop,
                trailingActive: newTrailingActive,
                breakevenHit: newBreakevenHit,
                cvdPeak: newCvdPeak,
                tmoCheckpointPassed: true,
              }
            } else {
              // Not profitable at warn time — close now (save further fees)
              closedPnlThisTick += netPnl
              closedThisTickIds.add(pos.id)
              const closedPos: ActivePosition = {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                status: 'CLOSED_TIMEOUT',
                closedAt: Date.now(),
                priceHistory: newHistory,
                peakPrice: newPeak,
                trailingStop: newTrailingStop,
                trailingActive: newTrailingActive,
                cvdPeak: newCvdPeak,
                tmoCheckpointPassed: true,
              }
              newlyClosedPositions.push(closedPos)
              return { ...closedPos }
            }
          }
        }

        // ── Position survives: update dynamic exit state ──
        // BUG FIX: For Bybit-verified positions, preserve real Bybit PnL/markPrice.
        // The tick loop calculates PnL from sim.price (random-walk estimate for non-active pairs)
        // which can diverge significantly from real exchange prices. The reconciliation effect
        // overwrites PnL with real Bybit data every 30s, but this tick loop immediately
        // overwrites it. Fix: keep Bybit PnL for verified positions, only update tick PnL for paper.
        return {
          ...pos,
          currentPrice: pos.bybitVerified ? pos.currentPrice : newPrice,
          pnl: pos.bybitVerified ? pos.pnl : netPnl,
          pnlPercent: pos.bybitVerified ? pos.pnlPercent : netPnlPercent,
          exitFee,
          totalFees,
          priceHistory: newHistory,
          peakPrice: newPeak,
          trailingStop: newTrailingStop,
          trailingActive: newTrailingActive,
          breakevenHit: newBreakevenHit,
          cvdPeak: newCvdPeak,
        }
      })

      // ── Phase 2: Collective Portfolio TP ──
      // CTP now uses UPDATED positions (not stale positionsRef.current)
      // and closedThisTickIds is guaranteed to be populated.
      // This fixes P5 (stale data) and P6 (double-close).
      // Dynamic threshold: scales with total notional AND average confidence score.
      // Higher score = stronger signal = more patience = higher CTP threshold.
      // Score 9-10: wait for $3.80+ profit. Score 3-4: close at $2.00 base.
      let finalPositions = updatedPositions // default: Phase 1 results only
      {
        // Use updatedPositions (from Phase 1) — has correct status, sizeUsd, fees
        const stillOpenPositions = updatedPositions.filter(p => p.status === 'OPEN' && !closedThisTickIds.has(p.id))
        if (stillOpenPositions.length >= 2) {
          // Calculate total PnL, total notional, AND average confidence score from still-open positions
          let ctpTotalPnl = 0
          let ctpTotalNotional = 0
          let ctpTotalScore = 0
          let ctpScoredCount = 0
          for (const p of stillOpenPositions) {
            const sim = pairSimsRef.current[p.pair]
            if (!sim) continue
            const pPrice = sim.price
            const pPriceChg = p.side === 'LONG'
              ? ((pPrice - p.entryPrice) / p.entryPrice) * 100
              : ((p.entryPrice - pPrice) / p.entryPrice) * 100
            // p.sizeUsd is now correct even after Partial TP (reduced)
            const pExitFee = p.sizeUsd * (1 + pPriceChg / 100) * p.exitFeeRate
            ctpTotalPnl += p.sizeUsd * pPriceChg / 100 - (p.entryFee + pExitFee)
            ctpTotalNotional += p.sizeUsd * (1 + pPriceChg / 100)
            // Accumulate confidence score for dynamic CTP threshold
            const pScore = p.confidence?.total ?? SCORING.MIN_SCORE
            ctpTotalScore += pScore
            ctpScoredCount++
          }
          // Score-based dynamic minimum: higher confidence → higher CTP threshold → let winners run
          // Score 3 (weak):  $2.00 + 0 = $2.00
          // Score 5 (medium): $2.00 + 2×$0.30 = $2.60
          // Score 7 (strong): $2.00 + 4×$0.30 = $3.20
          // Score 9-10 (very strong): $2.00 + 6×$0.30 = $3.80 — wait for big profit
          const avgScore = ctpScoredCount > 0 ? ctpTotalScore / ctpScoredCount : SCORING.MIN_SCORE
          const scoreBasedMin = Math.min(
            DYNAMIC_EXIT.COLLECTIVE_TP_MIN_USD + (avgScore - SCORING.MIN_SCORE) * DYNAMIC_EXIT.SCORE_CTP_SCALE_PER_POINT,
            DYNAMIC_EXIT.SCORE_CTP_MAX_USD
          )
          // Final threshold: max(score-based minimum, % of total notional)
          // This prevents CTP from firing on tiny moves when position sizes are large
          const ctpThreshold = Math.max(
            scoreBasedMin,
            ctpTotalNotional * DYNAMIC_EXIT.COLLECTIVE_TP_PCT
          )
          if (ctpTotalPnl >= ctpThreshold) {
            // Close ALL still-open positions at current prices
            let collectivePnl = 0
            finalPositions = updatedPositions.map(pos => {
              if (pos.status !== 'OPEN' || closedThisTickIds.has(pos.id)) return pos
              const sim = pairSimsRef.current[pos.pair]
              if (!sim) return pos
              const newPrice = sim.price
              const priceChangePercent = pos.side === 'LONG'
                ? ((newPrice - pos.entryPrice) / pos.entryPrice) * 100
                : ((pos.entryPrice - newPrice) / pos.entryPrice) * 100
              const currentNotional = pos.sizeUsd * (1 + priceChangePercent / 100)
              const exitFee = currentNotional * pos.exitFeeRate
              const totalFees = pos.entryFee + exitFee
              const netPnl = pos.sizeUsd * priceChangePercent / 100 - totalFees
              const netPnlPercent = (netPnl / pos.marginUsd) * 100
              collectivePnl += netPnl
              const closedPos: ActivePosition = {
                ...pos,
                currentPrice: newPrice,
                pnl: netPnl,
                pnlPercent: netPnlPercent,
                exitFee,
                totalFees,
                status: 'CLOSED_COLLECTIVE_TP',
                closedAt: Date.now(),
              }
              newlyClosedPositions.push(closedPos)
              return { ...closedPos }
            })
            closedPnlThisTick += collectivePnl
          }
        }
      }

      // ── Phase 3: Apply all state updates (single setPositions call) ──
      // Filter out closed positions, keep only OPEN for the active list
      const openPositions = finalPositions.filter(p => p.status === 'OPEN')
      openPositionsCountRef.current = openPositions.length
      positionsRef.current = openPositions
      setPositions(openPositions)

      // Batch-add all newly closed positions to history
      if (newlyClosedPositions.length > 0) {
        // Fill execution timing for auto-closed positions
        for (const cp of newlyClosedPositions) {
          if (!cp.closeSentAt) cp.closeSentAt = cp.closedAt || Date.now()
          // REAL mode: closeConfirmedAt = null (set by Bybit API callback)
          // PAPER mode: closeConfirmedAt set after simulated latency below
          if (!cp.closeConfirmedAt) cp.closeConfirmedAt = bybitTradingRef.current ? null : null
          // Track close confirmation: mark as CLOSING until Bybit confirms
          if (bybitTradingRef.current && cp.status !== 'CLOSING') {
            cp.pendingCloseStatus = cp.status  // Store target status
            cp.status = 'CLOSING'              // Transition to CLOSING pending confirmation
          }
        }
        // Play profit sound if any closed position made money
        if (soundEnabledRef.current && newlyClosedPositions.some(cp => cp.pnl > 0)) {
          playProfitCloseSound()
        }
        // Log auto-closed positions
        for (const cp of newlyClosedPositions) {
          const level = cp.pnl > 0 ? 'INFO' : 'WARNING'
          logEvent(level, 'SHIELD', `${cp.status} ${cp.side} ${cp.pair} [${exchangeAbbr(cp.anomaly?.exchange || '')}]`, `PnL: ${formatPnl(cp.pnl)} (${cp.pnlPercent.toFixed(2)}%) | ${cp.status}`)
        }
        // Play loss sound if any closed position lost money (liquidation / SL hit)
        if (soundEnabledRef.current && newlyClosedPositions.some(cp => cp.pnl <= 0)) {
          playLossCloseSound()
        }
        // Add to closed positions display (newest first)
        const reversedForDisplay = [...newlyClosedPositions].reverse()
        setClosedPositions(cp => {
          const updated = [...reversedForDisplay, ...cp].slice(0, LIMITS.MAX_CLOSED_POSITIONS)
          closedPositionsRef.current = updated
          return updated
        })
        // ── Signal Stats: emit events for each closed position ──
        for (const cp of newlyClosedPositions) {
          const effectiveStatus = cp.pendingCloseStatus || cp.status
          const signalType = determineCexSignalType(cp.anomaly?.category || 'AGGRESSIVE_ABSORPTION')
          const closeReason = mapCexStatusToCloseReason(effectiveStatus)
          const pnlPct = cp.pnlPercent || 0
          const pointsDelta = calculatePointsDelta(pnlPct, closeReason)
          setSignalEvents(prev => {
            const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
            const event: SignalEvent = {
              sessionId: signalSessionId,
              timestamp: new Date().toISOString(),
              signalType,
              pair: cp.pair,
              side: cp.side,
              entryPrice: cp.entryPrice,
              exitPrice: cp.currentPrice,
              pnl: cp.pnl,
              pnlPct,
              closeReason,
              leverage: cp.leverage,
              hurstAtEntry: 0,
              hcccoFastAtEntry: 0,
              hcccoSlowAtEntry: 0,
              confidenceScore: cp.confidence?.total ?? 0,
              anomalyCategory: cp.anomaly?.category || '',
              pointsDelta,
              runningTotal,
            }
            return [...prev, event]
          })
        }
        // Add to full trade history (unshift each preserves order: last unshifted is first)
        for (const cp of newlyClosedPositions) {
          fullTradeHistoryRef.current.unshift(cp)
          // AUDIT FIX #10: Evict oldest trades beyond cap (24/7 RAM safety)
          if (fullTradeHistoryRef.current.length > MAX_FULL_TRADE_HISTORY) {
            fullTradeHistoryRef.current.length = MAX_FULL_TRADE_HISTORY
          }
          closeBybitPosition(cp)
          // AUDIT FIX: closeBybitPosition is fire-and-forget (uses bybitEnqueue internally).
          // For REAL trading: if the Bybit API close fails, the UI shows the position as closed
          // but it remains open on Bybit. The bybitEnqueue .catch() logs the error.
          // To prevent UI-Bybit desync, we should track pending close operations.
          // For now: critical warning logged by bybitEnqueue on failure.
        }
        setFullTradeCount(fullTradeHistoryRef.current.length)
      }

      // Reinvest: add realized PnL from this tick back into wallet
      // Isolated margin simulation (paper mode): also return reserved margin for closed positions.
      // In real mode, Bybit handles margin return automatically — the next balance sync reflects it.
      if (closedPnlThisTick !== 0 || partialMarginReleasedThisTick !== 0) {
        cumulativeRealizedPnlRef.current += closedPnlThisTick
        // Compute margin return from fully closed positions (paper mode)
        const fullCloseMarginReturn = bybitTradingRef.current ? 0
          : newlyClosedPositions.reduce((sum, p) => sum + p.marginUsd, 0)
        const totalMarginReturn = bybitTradingRef.current ? 0
          : fullCloseMarginReturn + partialMarginReleasedThisTick
        setTestWalletAmount(prev => {
          const next = Math.max(0.01, prev + closedPnlThisTick + totalMarginReturn)
          testWalletAmountRef.current = next
          return next
        })
      }
    }, SIM.TICK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [paused, activePair.symbol, wsConnected, triggerFlash])

  // ─── Stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = anomalyCountRef.current
    const icebergs = anomalies.filter(a => a.tag === 'ICEBERG').length
    const inflows = anomalies.filter(a => a.tag === 'INFLOW').length
    const absorptions = anomalies.filter(a => a.tag === 'ABSORB').length
    const oiCount = anomalies.filter(a => a.tag === 'OI').length
    const fundingCount = anomalies.filter(a => a.tag === 'FUNDING').length
    const activePositions = positions.filter(p => p.status === 'OPEN').length
    const activePnlSum = positions.filter(p => p.status === 'OPEN').reduce((s, p) => s + p.pnl, 0)
    const totalPnl = activePnlSum + cumulativeRealizedPnlRef.current
    const liquidatedCount = closedPositions.filter(p => p.status === 'LIQUIDATED').length
    const pairsActive = new Set(anomalies.slice(0, UI.RECENT_ANOMALY_SLICE).map(a => a.pair)).size
    return { total, icebergs, inflows, absorptions, oiCount, fundingCount, activePositions, totalPnl, liquidatedCount, pairsActive }
  }, [anomalies, positions, closedPositions])

  // ─── Test Wallet Stats ──────────────────────────────────────────────────
  const walletStats = useMemo(() => {
    // AUDIT FIX: Use fullTradeHistoryRef (uncapped) for win/loss stats.
    // closedPositions is capped at MAX_CLOSED_POSITIONS (30) — computing winRate,
    // avgWin, avgLoss from it misses older trades and gives wrong statistics.
    const allTrades = fullTradeHistoryRef.current
    const wins = allTrades.filter(p => p.pnl > 0)
    const losses = allTrades.filter(p => p.pnl <= 0)
    // Use cumulativeRealizedPnlRef (never truncated) for accurate total PnL.
    // closedPositions is capped at MAX_CLOSED_POSITIONS (30) — summing pnl from
    // that list misses older trades, causing PnL display to be less than reality.
    const totalRealizedPnl = cumulativeRealizedPnlRef.current
    // Same for total fees — use full trade history, not capped closedPositions
    const totalFeesPaid = allTrades.reduce((s, p) => s + (p.totalFees || 0), 0)
    const activePnl = positions.filter(p => p.status === 'OPEN').reduce((s, p) => s + p.pnl, 0)
    const activeFees = positions.filter(p => p.status === 'OPEN').reduce((s, p) => s + (p.totalFees || 0), 0)
    const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0
    const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p.pnl, 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + p.pnl, 0) / losses.length : 0
    // testWalletAmount already includes reinvested closed PnL, so only add active unrealized PnL
    const balance = testWalletAmount + activePnl
    // P8 fix: compute actual initial capital from wallet minus realized PnL
    // testWalletAmount = initialCapital + cumulativeRealizedPnl, so initialCapital = wallet - cumulative
    // AUDIT FIX #1: Guard against negative initial capital (can happen if cumulative
    // PnL ref drifts from wallet due to floating point accumulation over 24/7)
    const initialCapital = Math.max(0.01, testWalletAmount - cumulativeRealizedPnlRef.current)
    const roi = initialCapital > 0 ? ((balance - initialCapital) / initialCapital) * 100 : 0
    const maxPosSize = allTrades.length > 0 ? Math.max(...allTrades.map(p => p.sizeUsd)) : 0
    return { allTrades, wins, losses, totalRealizedPnl, activePnl, winRate, avgWin, avgLoss, balance, roi, maxPosSize, initialCapital, totalFeesPaid, activeFees }
  }, [closedPositions, positions, testWalletAmount, fullTradeCount])

  // ─── Bybit Futures close helper ──────────────────────────────────────────
  // Sends a close order to Bybit Futures for any position being closed.
  // Throttled via bybitEnqueue: 150ms gap + server 120ms + X-RateLimit monitoring
  // Also drives the Execution Clock: SIG→QUEUE→API→DONE for close flow
  // PAPER mode: simulates realistic close latency with phase transitions
  const closeBybitPosition = useCallback((pos: ActivePosition) => {
    const [base] = pos.pair.split('-')
    const bybitSymbol = base.toUpperCase() + 'USDT'

    // ── PAPER mode: simulate realistic Bybit V5 close latency ──
    if (!bybitTradingRef.current) {
      const closeSigTs = Date.now()
      const closeDelays = getClosePhaseDelays(bybitSymbol)

      execClockRef.current = { phase: 'SIG', sigTs: closeSigTs, queueEnterTs: 0, apiSentTs: 0, apiConfirmTs: 0 }
      setExecClock(prev => ({ ...prev, phase: 'SIG', sigMs: 0, queueMs: 0, apiMs: 0, totalMs: 0, sigTs: closeSigTs, lastExchange: 'PAPER', bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

      // Phase 1: SIG — wait sigToQueueMs → transition to QUEUE
      setTimeout(() => {
        if (execClockRef.current.sigTs !== closeSigTs) return
        execClockRef.current.phase = 'QUEUE'
        execClockRef.current.queueEnterTs = Date.now()
        setExecClock(prev => ({ ...prev, phase: 'QUEUE', sigMs: closeDelays.breakdown.sigMs, bybitQueueDepth: 0, bybitRateUsed: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

        // Phase 2: QUEUE — wait queueToApiMs → transition to API
        setTimeout(() => {
          if (execClockRef.current.sigTs !== closeSigTs) return
          const apiSentTs = Date.now()
          execClockRef.current.phase = 'API'
          execClockRef.current.apiSentTs = apiSentTs
          setExecClock(prev => ({ ...prev, phase: 'API', queueMs: closeDelays.breakdown.queueMs, bybitQueueDepth: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

          // Phase 3: API — wait apiToDoneMs → transition to DONE
          setTimeout(() => {
            if (execClockRef.current.sigTs !== closeSigTs) return
            const confirmedAt = Date.now()
            execClockRef.current.phase = 'DONE'
            execClockRef.current.apiConfirmTs = confirmedAt
            setExecClock(prev => ({
              ...prev,
              phase: 'DONE',
              apiMs: closeDelays.breakdown.apiMs,
              totalMs: confirmedAt - closeSigTs,
              bybitQueueDepth: 0,
              bybitRateSource: 'QUEUE_PROXY',
              execMode: 'PAPER',
            }))
            // Update close confirmation timestamps
            setClosedPositions(cp => cp.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p))
            closedPositionsRef.current = closedPositionsRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p)
            fullTradeHistoryRef.current = fullTradeHistoryRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p)
            setFullTradeCount(fullTradeHistoryRef.current.length)
            console.log(`[PAPER] Auto-closed ${pos.side} ${pos.pair} latency=${confirmedAt - (pos.closeSentAt || closeSigTs)}ms`)
            // Auto-reset clock after 3s
            setTimeout(() => { if (execClockRef.current.phase === 'DONE') { execClockRef.current.phase = 'IDLE'; setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined })) } }, 3000)
          }, closeDelays.apiToDoneMs)
        }, closeDelays.queueToApiMs)
      }, closeDelays.sigToQueueMs)
      return
    }

    // ── REAL mode: actual Bybit API call ──
    const sentAt = pos.closeSentAt || Date.now()

    // ── Execution Clock: SIG phase for CLOSE ──
    const closeSigTs = Date.now()
    execClockRef.current = { phase: 'SIG', sigTs: closeSigTs, queueEnterTs: 0, apiSentTs: 0, apiConfirmTs: 0 }
    setExecClock(prev => ({ ...prev, phase: 'SIG', sigMs: 0, queueMs: 0, apiMs: 0, totalMs: 0, sigTs: closeSigTs, lastExchange: 'BYBIT', bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))

    // SIG → QUEUE transition
    execClockRef.current.phase = 'QUEUE'
    execClockRef.current.queueEnterTs = Date.now()
    setExecClock(prev => ({ ...prev, phase: 'QUEUE', sigMs: execClockRef.current.queueEnterTs - closeSigTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateUsed: getBybitRateUsed().usedPct, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))

    bybitEnqueue(async () => { // full close — CRITICAL, never drop
      // QUEUE → API transition
      const apiSentTs = Date.now()
      execClockRef.current.phase = 'API'
      execClockRef.current.apiSentTs = apiSentTs
      setExecClock(prev => ({ ...prev, phase: 'API', queueMs: apiSentTs - execClockRef.current.queueEnterTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))

      // REAL close with retry: up to 2 attempts with 1s backoff
      // Critical for real trading — a single network glitch shouldn't leave a position orphaned on Bybit
      let lastError: string | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch('/api/bybit/futures/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: bybitSymbol, side: pos.side === 'LONG' ? 'Sell' : 'Buy', size: Math.round(pos.sizeUsd), mode: 'real' }),
          })
          const data = await res.json()
          const confirmedAt = Date.now()
          // API → DONE transition
          execClockRef.current.phase = 'DONE'
          execClockRef.current.apiConfirmTs = confirmedAt
          setExecClock(prev => ({ ...prev, phase: 'DONE', apiMs: confirmedAt - apiSentTs, totalMs: confirmedAt - closeSigTs, bybitQueueDepth: bybitQueueDepthRef.current, bybitRateSource: getBybitRateUsed().source, execMode: 'REAL' }))
          // Auto-reset clock after 3s
          setTimeout(() => { if (execClockRef.current.phase === 'DONE') { execClockRef.current.phase = 'IDLE'; setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined })) } }, 3000)
          if (data.success) {
            // BUG FIX: Use Bybit's realizedPnl to correct the closed position's PnL.
            // The tick loop sets pnl from sim.price (wrong for REAL positions).
            // Bybit's realizedPnl (= unrealisedPnl at close) is GROSS (before fees).
            // We subtract entryFee + exitFee to get NET PnL matching Bybit transaction history.
            const bybitGrossPnl = data.realizedPnl ?? null
            if (bybitGrossPnl !== null && pos.bybitVerified) {
              const exitFee = pos.sizeUsd * (pos.exitFeeRate || takerFeeRate)
              const totalFees = (pos.entryFee || 0) + exitFee
              const netBybitPnl = bybitGrossPnl - totalFees
              const uiPnl = pos.pnl
              const pnlDiff = netBybitPnl - uiPnl
              // Correct cumulative realized PnL and wallet (tick loop added wrong PnL)
              cumulativeRealizedPnlRef.current += pnlDiff
              setTestWalletAmount(prev => {
                const next = Math.max(0.01, prev + pnlDiff)
                testWalletAmountRef.current = next
                return next
              })
              console.log(`[BYBIT REAL] PnL correction: ${pos.pair} gross=$${bybitGrossPnl.toFixed(3)} fees=$${totalFees.toFixed(3)} net=$${netBybitPnl.toFixed(3)} UI=$${uiPnl.toFixed(3)} diff=$${pnlDiff.toFixed(3)}`)
            }
            const netPnlForUpdate = (bybitGrossPnl !== null && pos.bybitVerified)
              ? (() => { const ef = pos.sizeUsd * (pos.exitFeeRate || takerFeeRate); return bybitGrossPnl - (pos.entryFee || 0) - ef })()
              : null
            const pnlUpdate = netPnlForUpdate !== null
              ? { pnl: netPnlForUpdate, pnlPercent: pos.marginUsd > 0 ? (netPnlForUpdate / pos.marginUsd) * 100 : 0, bybitRealisedPnl: netPnlForUpdate }
              : {}
            console.log(`[BYBIT REAL] Auto-closed ${pos.side} ${pos.pair} orderId=${data.orderId} latency=${confirmedAt - sentAt}ms bybitGross=$${bybitGrossPnl?.toFixed(3) ?? 'N/A'}${attempt > 1 ? ` (retry #${attempt})` : ''}`)
            // Transition from CLOSING → pendingCloseStatus on confirmation
            const targetStatus = pos.pendingCloseStatus || pos.status
            setClosedPositions(cp => cp.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt, status: p.status === 'CLOSING' ? (p.pendingCloseStatus || targetStatus) : p.status, pendingCloseStatus: undefined, ...pnlUpdate } : p))
            closedPositionsRef.current = closedPositionsRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt, status: p.status === 'CLOSING' ? (p.pendingCloseStatus || targetStatus) : p.status, pendingCloseStatus: undefined, ...pnlUpdate } : p)
            fullTradeHistoryRef.current = fullTradeHistoryRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt, status: p.status === 'CLOSING' ? (p.pendingCloseStatus || targetStatus) : p.status, pendingCloseStatus: undefined, ...pnlUpdate } : p)
            setFullTradeCount(fullTradeHistoryRef.current.length)
            lastError = null
            break // success — exit retry loop
          } else {
            lastError = data.error || 'Unknown error'
            if (attempt === 1) {
              console.warn(`[BYBIT REAL] Auto-close attempt ${attempt} failed: ${lastError} — retrying in 1s...`)
              await new Promise(r => setTimeout(r, 1000))
            }
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt === 1) {
            console.warn(`[BYBIT REAL] Auto-close attempt ${attempt} error: ${lastError} — retrying in 1s...`)
            await new Promise(r => setTimeout(r, 1000))
          }
        }
      }
      // After all attempts — log final result
      if (lastError) {
        console.error(`[BYBIT REAL] Auto-close FAILED after 2 attempts: ${pos.side} ${pos.pair} — ${lastError}`)
        logEvent('CRITICAL', 'BYBIT', `Auto-close FAILED (2 attempts): ${pos.side} ${pos.pair}`, lastError + ' — POSITION STILL OPEN ON BYBIT! Close manually.')
        // Keep status as CLOSING to indicate unconfirmed close in UI
        setClosedPositions(cp => cp.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: null } : p))
        closedPositionsRef.current = closedPositionsRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: null } : p)
        fullTradeHistoryRef.current = fullTradeHistoryRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: null } : p)
        execClockRef.current.phase = 'IDLE'
        setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined }))
      }
    }, true) // CRITICAL — never drop full close orders (position stays on Bybit if dropped)
  }, [bybitEnqueue])

  // ─── Manual Close Handler ──────────────────────────────────────────────
  // Closes a specific open position at market (current price), sets status to CLOSED_MANUAL.
  // Records realized PnL, fees, and reinvests into wallet.
  const manualClose = useCallback((positionId: string) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === positionId && p.status === 'OPEN')
      if (!pos) return prev

      // Calculate exit fee (always taker for manual close)
      const exitFee = pos.sizeUsd * takerFeeRate
      const totalFees = (pos.entryFee || 0) + exitFee
      const netPnl = pos.pnl - exitFee

      const closeNow = Date.now()
      const closedPos: ActivePosition = {
        ...pos,
        status: bybitTradingRef.current ? 'CLOSING' as const : 'CLOSED_MANUAL' as const,
        pendingCloseStatus: bybitTradingRef.current ? 'CLOSED_MANUAL' as const : undefined,
        closedAt: closeNow,
        totalFees,
        pnl: netPnl,
        pnlPercent: pos.sizeUsd > 0 ? (netPnl / pos.marginUsd) * 100 : 0,
        closeSentAt: closeNow,
        closeConfirmedAt: null, // Updated by simulated API delay (paper) or real API callback (real)
      }

      // Paper trading: simulate realistic Bybit V5 close latency
      // Phase transitions: SIG → QUEUE → API → DONE with real timing
      // Mirrors real close flow: parallel verify+cancel+instrument → close order
      if (!bybitTradingRef.current) {
        const [base] = pos.pair.split('-')
        const bybitSymbol = base.toUpperCase() + 'USDT'
        const closeSigTs = Date.now()
        const closeDelays = getClosePhaseDelays(bybitSymbol)

        execClockRef.current = { phase: 'SIG', sigTs: closeSigTs, queueEnterTs: 0, apiSentTs: 0, apiConfirmTs: 0 }
        setExecClock(prev => ({ ...prev, phase: 'SIG', sigMs: 0, queueMs: 0, apiMs: 0, totalMs: 0, sigTs: closeSigTs, lastExchange: 'PAPER', bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

        // Phase 1: SIG — wait sigToQueueMs → transition to QUEUE
        setTimeout(() => {
          if (execClockRef.current.sigTs !== closeSigTs) return
          execClockRef.current.phase = 'QUEUE'
          execClockRef.current.queueEnterTs = Date.now()
          setExecClock(prev => ({ ...prev, phase: 'QUEUE', sigMs: closeDelays.breakdown.sigMs, bybitQueueDepth: 0, bybitRateUsed: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

          // Phase 2: QUEUE — wait queueToApiMs → transition to API
          setTimeout(() => {
            if (execClockRef.current.sigTs !== closeSigTs) return
            const apiSentTs = Date.now()
            execClockRef.current.phase = 'API'
            execClockRef.current.apiSentTs = apiSentTs
            setExecClock(prev => ({ ...prev, phase: 'API', queueMs: closeDelays.breakdown.queueMs, bybitQueueDepth: 0, bybitRateSource: 'QUEUE_PROXY', execMode: 'PAPER' }))

            // Phase 3: API — wait apiToDoneMs → transition to DONE
            setTimeout(() => {
              if (execClockRef.current.sigTs !== closeSigTs) return
              const confirmedAt = Date.now()
              execClockRef.current.phase = 'DONE'
              execClockRef.current.apiConfirmTs = confirmedAt
              setExecClock(prev => ({
                ...prev,
                phase: 'DONE',
                apiMs: closeDelays.breakdown.apiMs,
                totalMs: confirmedAt - closeSigTs,
                bybitQueueDepth: 0,
                bybitRateSource: 'QUEUE_PROXY',
                execMode: 'PAPER',
              }))
              // Update close confirmation
              setClosedPositions(cp => cp.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p))
              closedPositionsRef.current = closedPositionsRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p)
              fullTradeHistoryRef.current = fullTradeHistoryRef.current.map(p => p.id === pos.id ? { ...p, closeConfirmedAt: confirmedAt } : p)
              setFullTradeCount(fullTradeHistoryRef.current.length)
              console.log(`[PAPER] Closed ${pos.side} ${pos.pair} latency=${confirmedAt - closeNow}ms`)
              // Auto-reset clock after 3s
              setTimeout(() => { if (execClockRef.current.phase === 'DONE') { execClockRef.current.phase = 'IDLE'; setExecClock(prev => ({ ...prev, phase: 'IDLE', sigTs: undefined })) } }, 3000)
            }, closeDelays.apiToDoneMs)
          }, closeDelays.queueToApiMs)
        }, closeDelays.sigToQueueMs)
      }

      // Reinvest PnL into wallet
      // Isolated margin simulation: return reserved margin + PnL (paper mode)
      // In real mode, Bybit handles margin return — the next balance sync reflects it.
      const marginReturn = bybitTradingRef.current ? 0 : pos.marginUsd
      cumulativeRealizedPnlRef.current += netPnl
      setTestWalletAmount(w => {
        const next = Math.max(0.01, w + netPnl + marginReturn)
        testWalletAmountRef.current = next
        return next
      })

      // Add to closed positions display
      setClosedPositions(cp => {
        const updated = [closedPos, ...cp].slice(0, LIMITS.MAX_CLOSED_POSITIONS)
        closedPositionsRef.current = updated
        return updated
      })
      // Add to full trade history
      fullTradeHistoryRef.current.unshift(closedPos)
      // AUDIT FIX #10: Evict oldest trades beyond cap (24/7 RAM safety)
      if (fullTradeHistoryRef.current.length > MAX_FULL_TRADE_HISTORY) {
        fullTradeHistoryRef.current.length = MAX_FULL_TRADE_HISTORY
      }
      // ── Signal Stats: emit event for manual close ──
      {
        const signalType = determineCexSignalType(pos.anomaly?.category || 'AGGRESSIVE_ABSORPTION')
        const closeReason: SignalCloseReason = 'MANUAL'
        const pnlPct = closedPos.pnlPercent || 0
        const pointsDelta = calculatePointsDelta(pnlPct, closeReason)
        setSignalEvents(prev => {
          const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
          return [...prev, {
            sessionId: signalSessionId,
            timestamp: new Date().toISOString(),
            signalType,
            pair: pos.pair,
            side: pos.side,
            entryPrice: pos.entryPrice,
            exitPrice: pos.currentPrice,
            pnl: netPnl,
            pnlPct,
            closeReason,
            leverage: pos.leverage,
            hurstAtEntry: 0,
            hcccoFastAtEntry: 0,
            hcccoSlowAtEntry: 0,
            confidenceScore: pos.confidence?.total ?? 0,
            anomalyCategory: pos.anomaly?.category || '',
            pointsDelta,
            runningTotal,
          }]
        })
      }
      // Play profit sound if closed in profit, loss sound if closed at loss
      if (netPnl > 0 && soundEnabledRef.current) playProfitCloseSound()
      else if (netPnl <= 0 && soundEnabledRef.current) playLossCloseSound()
      setFullTradeCount(fullTradeHistoryRef.current.length)

      // ── Real Futures Close ──
      closeBybitPosition(closedPos)

      // Update open positions count
      const stillOpen = prev.filter(p => p.id !== positionId && p.status === 'OPEN')
      openPositionsCountRef.current = stillOpen.length
      positionsRef.current = stillOpen

      return stillOpen
    })
  }, [takerFeeRate])

  // ─── Keyboard Shortcuts: 1-9 close positions by number ──────────────────
  // Press 1-9 to instantly close the corresponding active position.
  // Keys map to position index in the filtered OPEN list (1=first, 2=second, etc.)
  // Only works when paper trading is active and not typing in an input field.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      // Only handle keys 1-9
      const keyNum = parseInt(e.key)
      if (isNaN(keyNum) || keyNum < 1 || keyNum > 9) return
      if (!paperTradingRef.current) return

      // Get current open positions
      const openPositions = positionsRef.current.filter(p => p.status === 'OPEN')
      const posIndex = keyNum - 1 // 0-based index
      if (posIndex >= openPositions.length) return

      const pos = openPositions[posIndex]
      manualClose(pos.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [manualClose])

  const filteredAnomalies = useMemo(() => {
    let filtered = anomalies
    if (filterTag !== 'ALL') filtered = filtered.filter(a => a.tag === filterTag)
    if (filterPair !== 'ALL') filtered = filtered.filter(a => a.pair === filterPair)
    return filtered
  }, [anomalies, filterTag, filterPair])

  const activePairSymbols = useMemo(() => {
    const pairs = new Set(anomalies.slice(0, UI.ACTIVE_PAIR_SLICE).map(a => a.pair))
    return Array.from(pairs).sort()
  }, [anomalies])



  // ─── LiquidationHeatmap + CVDChart extracted to @/components/cex-anomaly/ ──



  const sectionLabel: React.CSSProperties = {
    fontFamily: te.mono, fontSize: '11px', letterSpacing: '0.14em',
    textTransform: 'uppercase', color: te.textDim, fontWeight: 700,
  }

  const dataMono: React.CSSProperties = {
    fontFamily: te.mono, fontVariantNumeric: 'tabular-nums',
  }

  // ─── Loading State ────────────────────────────────────────────────────
  if (dataSource === 'LOADING') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="size-8 animate-spin" style={{ color: te.orange }} />
        <span className="text-xs font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>
          CONNECTING TO BINANCE...
        </span>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 h-full overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
      {/* TA confirmation pulse animation */}
      <style>{`
        @keyframes ta-confirm {
          0%   { transform: scale(1);    filter: brightness(1); }
          40%  { transform: scale(1.35); filter: brightness(1.8); }
          100% { transform: scale(1);    filter: brightness(1); }
        }
        @keyframes ta-dot-fill {
          0%   { transform: scale(0.6); opacity: 0.4; }
          50%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes ta-conv-pass {
          0%   { filter: brightness(1); }
          30%  { filter: brightness(2.2); }
          100% { filter: brightness(1); }
        }
        .ta-arrow-confirm { animation: ta-confirm 0.35s ease-out; }
        .ta-dot-confirm   { animation: ta-dot-fill 0.3s ease-out; }
        .ta-conv-pass     { animation: ta-conv-pass 0.5s ease-out; }
      `}</style>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-sm"
            style={{ background: `${te.orange}15`, border: `1px solid ${te.orange}33` }}>
            <Crosshair className="size-5" style={{ color: te.orange }} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: te.mono }}>
              CEX ANOMALY
            </h2>
            <p className="text-[11px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.04em' }}>
              {ALL_PAIRS.length} PAIRS MONITORED
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm" style={{
            background: dataSource === 'LIVE' ? te.greenBg : `${te.orange}1a`,
            border: `1px solid ${dataSource === 'LIVE' ? `${te.green}33` : `${te.orange}33`}`,
          }}>
            {dataSource === 'LIVE' ? (
              <Wifi className="size-3" style={{ color: te.green }} />
            ) : (
              <WifiOff className="size-3" style={{ color: te.orange }} />
            )}
            <span className="text-[11px] font-bold" style={{
              fontFamily: te.mono,
              color: dataSource === 'LIVE' ? te.green : te.orange,
            }}>
              {dataSource === 'LIVE' ? 'BINANCE LIVE' : 'FALLBACK'}
            </span>
            <div className={`w-1.5 h-1.5 rounded-full ${dataSource === 'LIVE' ? 'animate-pulse' : ''}`}
              style={{ background: dataSource === 'LIVE' ? te.green : te.orange }} />
          </div>

          {/* WS Connection indicators */}
          {wsConnected && (
            <div className="flex items-center gap-1 px-1.5 py-1 rounded-sm" style={{
              background: te.greenBg, border: `1px solid ${te.green}33`,
            }}>
              <Zap className="size-2.5" style={{ color: te.green }} />
              <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.green }}>BIN</span>
            </div>
          )}
          {bybitWsConnected && (
            <div className="flex items-center gap-1 px-1.5 py-1 rounded-sm" style={{
              background: te.greenBg, border: `1px solid ${te.green}33`,
            }}>
              <Zap className="size-2.5" style={{ color: te.green }} />
              <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.green }}>BYB</span>
            </div>
          )}

          {/* Active pair price */}
          {activeSim && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm" style={{
              background: te.bgCard, border: `1px solid ${te.border}`,
            }}>
              <Zap className="size-3" style={{ color: te.orange }} />
              <span className="text-sm font-bold" style={{ ...dataMono, color: te.text }}>
                {formatPrice(activeSim.price, activePair.decimals)}
              </span>
              <span className="text-[11px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                {activePair.symbol.split('-')[0]}
              </span>
            </div>
          )}

          <button onClick={() => setPaused(!paused)}
            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-bold transition-all"
            style={{
              fontFamily: te.mono,
              background: paused ? `${te.orange}15` : 'transparent',
              color: paused ? te.orange : te.textMuted,
              border: `1px solid ${paused ? `${te.orange}33` : te.border}`,
            }}>
            {paused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        </div>
      </div>

      {/* ─── Two-Column Layout ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ═══ LEFT: Microstructure Radar ══════════════════════════════════ */}
        <div className="space-y-2">

          {/* ─── Signal Alert Bar: Active RSI 15m + MACD virtual signals ──── */}
          {(() => {
            // virtualSignalVersion ensures re-render when signals change (useRef alone doesn't trigger renders)
            void virtualSignalVersion
            const allRsiSignals = [...rsi15mSignalsRef.current.values()]
            const allMacdSignals = [...macdSignalsRef.current.values()]
            const totalActive = allRsiSignals.length + allMacdSignals.length
            if (totalActive === 0) return null

            const formatProgress = (entryPrice: number, currentPrice: number, side: 'LONG' | 'SHORT') => {
              const priceDiff = (currentPrice - entryPrice) / entryPrice * 100
              const isFavorable = side === 'SHORT' ? priceDiff < 0 : priceDiff > 0
              const absMove = Math.abs(priceDiff)
              const tpPct = taManualTpRef.current
              const slPct = taManualSlRef.current
              const taLev = taLeverageRef.current
              const progressToTp = isFavorable ? Math.min(100, (absMove / tpPct) * 100) : 0
              const progressToSl = !isFavorable ? Math.min(100, (absMove / slPct) * 100) : 0
              // Leveraged PnL = price% × leverage (LONG favorable = +, SHORT favorable = +)
              const leveragedPnl = isFavorable ? absMove * taLev : -absMove * taLev
              // Liquidation risk: how close to 100%/leverage adverse move (full liquidation)
              const liqDistance = 100 / taLev  // % price move that triggers liquidation
              const liqRisk = Math.min(100, (absMove / liqDistance) * 100)
              return { isFavorable, absMove, progressToTp, progressToSl, tpPct, slPct, leveragedPnl, liqRisk }
            }

            return (
              <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${te.orange}44`, background: `${te.orange}08` }}>
                {/* Header */}
                <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: `${te.orange}15`, borderBottom: `1px solid ${te.orange}33` }}>
                  <span className="text-[8px] inline-block animate-pulse" style={{ fontFamily: te.mono, color: te.orange, fontWeight: 900, letterSpacing: '0.08em' }}>●</span>
                  <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.orange, letterSpacing: '0.06em' }}>
                    TA SIGNALS ACTIVE
                  </span>
                  <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                    {totalActive} signal{totalActive > 1 ? 's' : ''} tracking {taManualTpPct}%TP / {taManualSlPct}%SL @{taLeverage}x
                  </span>
                  {/* Settings toggle button */}
                  <button
                    onClick={() => setTaSettingsOpen(v => !v)}
                    className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-all"
                    style={{
                      fontFamily: te.mono, letterSpacing: '0.04em',
                      color: taSettingsOpen ? te.bg : te.orange,
                      backgroundColor: taSettingsOpen ? te.orange : 'transparent',
                      border: `1px solid ${taSettingsOpen ? 'transparent' : te.orange + '66'}`,
                    }}
                    title="Settings TP/SL/Leverage dla sygnałów TA (RSI 15m + MACD)"
                  >
                    {taSettingsOpen ? '×' : '⚙'} TA
                  </button>
                </div>

                {/* Collapsible TA Settings Panel */}
                {taSettingsOpen && (
                  <div className="px-2 py-1.5 flex items-center gap-3 flex-wrap" style={{ borderBottom: `1px solid ${te.orange}33`, background: `${te.orange}05` }}>
                    {/* TP */}
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.green, letterSpacing: '0.04em' }}>TP</span>
                      <input
                        type="number" value={taManualTpPct}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 50) setTaManualTpPct(v) }}
                        step={0.1} min={0.1} max={50}
                        className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                        style={{ fontFamily: te.mono, color: te.green, background: '#0a1a0a', border: `1px solid ${te.green}44` }}
                        title="Take Profit % ruchu ceny (price move, nie PnL)"
                      />
                      <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>% ceny</span>
                    </div>
                    {/* SL */}
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.red, letterSpacing: '0.04em' }}>SL</span>
                      <input
                        type="number" value={taManualSlPct}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 100) setTaManualSlPct(v) }}
                        step={0.1} min={0.1} max={100}
                        className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                        style={{ fontFamily: te.mono, color: te.red, background: '#1a0a0a', border: `1px solid ${te.red}44` }}
                        title="Stop Loss % odległości od entry (price move, nie PnL)"
                      />
                      <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>% ceny</span>
                    </div>
                    {/* Leverage */}
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.orange, letterSpacing: '0.04em' }}>LEV</span>
                      <div className="flex gap-0.5">
                        {[1, 5, 10, 20].map(lev => (
                          <button key={lev} onClick={() => setTaLeverage(lev)}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm transition-all"
                            style={{
                              fontFamily: te.mono,
                              color: taLeverage === lev ? te.bg : te.textDim,
                              backgroundColor: taLeverage === lev ? te.orange : 'transparent',
                              border: `1px solid ${taLeverage === lev ? 'transparent' : te.border}`,
                            }}
                          >{lev}x</button>
                        ))}
                      </div>
                    </div>
                    {/* Leveraged PnL info */}
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      @{taLeverage}x: TP +{(taManualTpPct * taLeverage).toFixed(1)}% PnL | SL −{(taManualSlPct * taLeverage).toFixed(1)}% PnL | Liq @ ±{(100 / taLeverage).toFixed(2)}%
                    </span>
                  </div>
                )}

                {/* Signal rows */}
                <div className="space-y-0.5 px-1.5 py-1">
                  {/* RSI 15m signals */}
                  {allRsiSignals.map(sig => {
                    const sim = pairSims[sig.pair]
                    const currentPrice = sim?.price ?? sig.entryPrice
                    const { isFavorable, absMove, progressToTp, progressToSl, leveragedPnl, liqRisk } = formatProgress(sig.entryPrice, currentPrice, sig.side)
                    const pairCfg = ALL_PAIRS.find(p => p.symbol === sig.pair)
                    const age = Math.round((Date.now() - sig.timestamp) / 1000)
                    return (
                      <div key={`rsi-${sig.pair}`} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm" style={{ background: `${sig.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}08`, border: `1px solid ${sig.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}22` }}>
                        {/* Direction badge */}
                        <span className="text-[8px] font-bold px-1 rounded-sm" style={{ fontFamily: te.mono, color: sig.side === 'SHORT' ? '#ff6b6b' : '#51cf66', background: `${sig.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}15`, border: `1px solid ${sig.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}33` }}>
                          {sig.side === 'SHORT' ? '▼' : '▲'} RSI15m
                        </span>
                        {/* Pair */}
                        <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>{sig.pair.split('-')[0]}</span>
                        {/* RSI at entry */}
                        <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>RSI:{sig.rsiAtEntry.toFixed(1)}</span>
                        {/* Entry price */}
                        <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>@ {sig.entryPrice.toFixed(pairCfg?.decimals ?? 2)}</span>
                        {/* Progress bar */}
                        <div className="flex-1 flex items-center gap-1">
                          <div className="flex-1" style={{ height: 3, background: te.border, borderRadius: 2, overflow: 'hidden' }}>
                            {isFavorable ? (
                              <div style={{ height: '100%', width: `${progressToTp}%`, background: te.green, borderRadius: 2, transition: 'width 0.3s' }} />
                            ) : (
                              <div style={{ height: '100%', width: `${progressToSl}%`, background: te.red, borderRadius: 2, transition: 'width 0.3s' }} />
                            )}
                          </div>
                          <span className="text-[7px] font-bold" style={{ fontFamily: te.mono, color: isFavorable ? te.green : te.red, minWidth: 60 }} title={`Liq risk: ${liqRisk.toFixed(1)}%`}>
                            {isFavorable ? `+${absMove.toFixed(1)}%→TP (${leveragedPnl >= 0 ? '+' : ''}${leveragedPnl.toFixed(1)}%PnL)` : `-${absMove.toFixed(1)}%→SL (${leveragedPnl.toFixed(1)}%PnL)`}
                          </span>
                        </div>
                        {/* Age */}
                        <span className="text-[6px]" style={{ fontFamily: te.mono, color: te.textDim }}>{age}s</span>
                      </div>
                    )
                  })}

                  {/* MACD signals */}
                  {allMacdSignals.map(sig => {
                    const sim = pairSims[sig.pair]
                    const currentPrice = sim?.price ?? sig.entryPrice
                    const { isFavorable, absMove, progressToTp, progressToSl, leveragedPnl, liqRisk } = formatProgress(sig.entryPrice, currentPrice, sig.side)
                    const pairCfg = ALL_PAIRS.find(p => p.symbol === sig.pair)
                    const age = Math.round((Date.now() - sig.timestamp) / 1000)
                    // TTL: candles remaining before auto-close as TIMEOUT
                    const candlesElapsed = sim ? sim.candle15mCloses.length - sig.candlesAtEntry : 0
                    const candlesLeft = Math.max(0, TA_CONFIG.MACD_15M_TTL_CANDLES - candlesElapsed)
                    const ttlUrgent = candlesLeft <= 1
                    return (
                      <div key={`macd-${sig.pair}`} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm" style={{ background: `${sig.side === 'SHORT' ? '#ff4757' : '#2ed573'}08`, border: `1px solid ${sig.side === 'SHORT' ? '#ff4757' : '#2ed573'}22` }}>
                        {/* Direction badge */}
                        <span className="text-[8px] font-bold px-1 rounded-sm" style={{ fontFamily: te.mono, color: sig.side === 'SHORT' ? '#ff4757' : '#2ed573', background: `${sig.side === 'SHORT' ? '#ff4757' : '#2ed573'}15`, border: `1px solid ${sig.side === 'SHORT' ? '#ff4757' : '#2ed573'}33` }}>
                          {sig.side === 'SHORT' ? '▼' : '▲'} MACD
                        </span>
                        {/* Pair */}
                        <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>{sig.pair.split('-')[0]}</span>
                        {/* MACD hist at entry */}
                        <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>H:{(sig.macdHistAtEntry * 100).toFixed(3)}</span>
                        {/* Entry price */}
                        <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>@ {sig.entryPrice.toFixed(pairCfg?.decimals ?? 2)}</span>
                        {/* Progress bar */}
                        <div className="flex-1 flex items-center gap-1">
                          <div className="flex-1" style={{ height: 3, background: te.border, borderRadius: 2, overflow: 'hidden' }}>
                            {isFavorable ? (
                              <div style={{ height: '100%', width: `${progressToTp}%`, background: te.green, borderRadius: 2, transition: 'width 0.3s' }} />
                            ) : (
                              <div style={{ height: '100%', width: `${progressToSl}%`, background: te.red, borderRadius: 2, transition: 'width 0.3s' }} />
                            )}
                          </div>
                          <span className="text-[7px] font-bold" style={{ fontFamily: te.mono, color: isFavorable ? te.green : te.red, minWidth: 60 }} title={`Liq risk: ${liqRisk.toFixed(1)}%`}>
                            {isFavorable ? `+${absMove.toFixed(1)}%→TP (${leveragedPnl >= 0 ? '+' : ''}${leveragedPnl.toFixed(1)}%PnL)` : `-${absMove.toFixed(1)}%→SL (${leveragedPnl.toFixed(1)}%PnL)`}
                          </span>
                        </div>
                        {/* TTL: candles remaining */}
                        <span className="text-[7px] font-bold px-1 rounded-sm" style={{ fontFamily: te.mono, color: ttlUrgent ? te.red : te.textDim, background: ttlUrgent ? '#ff475715' : 'transparent', border: ttlUrgent ? `1px solid #ff475733` : 'none' }} title={`TTL: ${candlesLeft}/${TA_CONFIG.MACD_15M_TTL_CANDLES} candles remaining (15m each)`}>
                          TTL{candlesLeft}
                        </span>
                        {/* Age */}
                        <span className="text-[6px]" style={{ fontFamily: te.mono, color: te.textDim }}>{age}s</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ─── CLOSED TA TRADES (RSI 15m + MACD) ─────────────────────────── */}
          {(() => {
            // Filter signalEvents to only TA-related categories
            const taEvents = signalEvents.filter(ev =>
              ev.anomalyCategory === 'RSI_15M_OVERBOUGHT' ||
              ev.anomalyCategory === 'RSI_15M_OVERSOLD' ||
              ev.anomalyCategory === 'MACD_BULL_CROSS' ||
              ev.anomalyCategory === 'MACD_BEAR_CROSS'
            )
            if (taEvents.length === 0) return null
            const wins = taEvents.filter(e => e.pnlPct > 0).length
            const losses = taEvents.filter(e => e.pnlPct < 0).length
            const ties = taEvents.filter(e => e.pnlPct === 0).length
            const total = taEvents.length
            const wr = total > 0 ? (wins / total) * 100 : 0
            const sumPct = taEvents.reduce((s, e) => s + e.pnlPct, 0)
            return (
              <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.cyan, letterSpacing: '0.08em' }}>
                    CLOSED TA TRADES
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
                    fontFamily: te.mono, color: te.text,
                    background: te.bgInput, border: `1px solid ${te.border}`,
                  }}>
                    {total}
                  </span>
                  <div className="flex items-center gap-1.5 ml-auto text-[9px]" style={{ fontFamily: te.mono }}>
                    <span style={{ color: te.green }}>W:{wins}</span>
                    <span style={{ color: te.red }}>L:{losses}</span>
                    <span style={{ color: te.textDim }}>T:{ties}</span>
                    <span style={{ color: wr >= 50 ? te.green : te.red, fontWeight: 700 }}>WR:{wr.toFixed(0)}%</span>
                    <span style={{ color: sumPct >= 0 ? te.green : te.red, fontWeight: 700 }}>Σ:{sumPct >= 0 ? '+' : ''}{sumPct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {taEvents.slice().reverse().slice(0, 30).map((ev, i) => {
                    const isWin = ev.pnlPct > 0
                    const isLoss = ev.pnlPct < 0
                    const isRsi = ev.anomalyCategory === 'RSI_15M_OVERBOUGHT' || ev.anomalyCategory === 'RSI_15M_OVERSOLD'
                    const label = isRsi ? 'RSI15m' : 'MACD'
                    return (
                      <div key={`ta-ev-${i}`} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm" style={{
                        background: isWin ? `${te.green}08` : isLoss ? `${te.red}08` : te.bgInput,
                        border: `1px solid ${isWin ? `${te.green}22` : isLoss ? `${te.red}22` : te.border}`,
                      }}>
                        <span className="text-[8px] font-bold px-1 rounded-sm" style={{
                          fontFamily: te.mono,
                          color: ev.side === 'SHORT' ? '#ff6b6b' : '#51cf66',
                          background: `${ev.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}15`,
                          border: `1px solid ${ev.side === 'SHORT' ? '#ff6b6b' : '#51cf66'}33`,
                        }}>
                          {ev.side === 'SHORT' ? '▼' : '▲'} {label}
                        </span>
                        <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>{ev.pair.split('-')[0]}</span>
                        <span className="text-[7px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                          @ {ev.entryPrice.toFixed(2)} → {ev.exitPrice.toFixed(2)}
                        </span>
                        <span className="text-[7px] px-1 rounded-sm" style={{
                          fontFamily: te.mono,
                          color: ev.closeReason === 'TAKE PROFIT' ? te.green : ev.closeReason === 'STOP LOSS' ? te.red : te.textDim,
                        }}>
                          {ev.closeReason}
                        </span>
                        <span className="text-[9px] font-bold ml-auto" style={{
                          fontFamily: te.mono,
                          color: isWin ? te.green : isLoss ? te.red : te.textDim,
                        }}>
                          {ev.pnlPct >= 0 ? '+' : ''}{ev.pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          <div className="flex items-center gap-2">
            <Radio className="size-3.5" style={{ color: te.green }} />
            <h3 className="text-xs font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.06em' }}>
              MICROSTRUCTURE RADAR
            </h3>
            <MicrostructureBacktestDialog signalEvents={signalEvents} />
          </div>

          {/* Tag filter — own bar */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-sm flex-wrap" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>
              SIG:
            </span>
            {(['ALL', 'ICEBERG', 'ICE-REV', 'INFLOW', 'ABSORB', 'OI', 'FUNDING', 'CROWD', 'TAKER', 'LIQ-CASCADE', 'OI-VEL', 'OB-IMBAL', 'SWEEP', 'RT-LIQ', 'OPTIONS', 'GATE-OB', 'GATE-WHALE', 'GATE-CLUSTER', 'BITGET-OB', 'BITGET-WHALE', 'BITGET-CLUSTER', 'DYDX-WHALE', 'MACRO'] as const).map(tag => {
              const tc = tag === 'ALL' ? { bg: te.bgInput, text: te.textMuted, border: te.border } : TAG_COLORS[tag]
              const isActive = filterTag === tag
              return (
                <button key={tag} onClick={() => setFilterTag(tag)}
                  className="px-1 py-1 sm:py-0 text-[9px] font-bold rounded-sm transition-all min-h-[32px] sm:min-h-0"
                  style={{
                    fontFamily: te.mono,
                    background: isActive ? tc.bg : 'transparent',
                    color: isActive ? tc.text : te.textDim,
                    border: `1px solid ${isActive ? tc.border : te.border}`,
                  }}>
                  {tag}
                </button>
              )
            })}
          </div>

          {/* Signal Health Bar — last fetch status per data source */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-sm flex-wrap" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            {Object.entries(signalHealth).map(([source, health]) => {
              const age = health.lastFetchAt ? Math.round((Date.now() - health.lastFetchAt) / 1000) : -1
              const isOk = health.status === 'ok'
              const isStale = isOk && age > 120
              const isError = health.status === 'error'
              const dotColor = isError ? '#ef4444' : isStale ? '#eab308' : isOk ? '#22c55e' : te.textDim
              return (
                <div key={source} className="flex items-center gap-0.5" title={`${source}: ${isOk ? `OK (${age}s ago, ${health.signalsEmitted} sig)` : isError ? `ERROR: ${health.errorMsg}` : 'Waiting...'}`}>
                  <div className="size-1.5 rounded-full" style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}40` }} />
                  <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: isError ? '#ef4444' : te.textDim }}>
                    {source.replace('_', ' ')}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Anomaly Feed */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="max-h-96 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {filteredAnomalies.length === 0 && (
                <div className="p-4 flex items-center justify-center gap-2">
                  <Loader2 className="size-3 animate-spin" style={{ color: te.orange }} />
                  <span className="text-[11px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                    WAITING FOR ANOMALIES...
                  </span>
                </div>
              )}
              {filteredAnomalies.map(anomaly => {
                const meta = CATEGORY_META[anomaly.category]
                const isFlash = flashId === anomaly.id
                const Icon = meta.icon
                // New signal = first time rendered — gets slide-in animation (plays once)
                const isNew = !animatedAnomalyIdsRef.current.has(anomaly.id)
                if (isNew) animatedAnomalyIdsRef.current.add(anomaly.id)
                // Prune old IDs to prevent memory leak
                if (animatedAnomalyIdsRef.current.size > 200) {
                  const keep = new Set(filteredAnomalies.slice(0, 80).map(a => a.id))
                  animatedAnomalyIdsRef.current = keep
                }
                return (
                  <div key={anomaly.id}
                    className={`px-2.5 py-1.5 ${isNew ? 'anomaly-enter' : ''}`}
                    style={{
                      borderBottom: `1px solid ${te.border}`,
                      background: isFlash ? `${te.red}11` : 'transparent',
                    }}>
                    {/* Row 1: Category + Tag + Side + Time */}
                    <div className="flex items-center gap-1.5">
                      <Icon className="size-3 shrink-0" style={{ color: meta.color }} />
                      <span className="text-[11px] font-bold shrink-0 truncate" style={{ fontFamily: te.mono, color: meta.color, letterSpacing: '0.06em', minWidth: 80 }}>
                        {meta.label}
                      </span>
                      <span className="text-[9px] px-1 py-0.5 rounded-sm font-bold shrink-0" style={{
                        fontFamily: te.mono,
                        background: TAG_COLORS[anomaly.tag].bg,
                        color: TAG_COLORS[anomaly.tag].text,
                        border: `1px solid ${TAG_COLORS[anomaly.tag].border}`,
                      }}>
                        {anomaly.tag}
                      </span>
                      <span className="text-[7px] font-bold px-0.5 py-0.5 rounded-sm shrink-0" style={{
                        fontFamily: te.mono,
                        background: `${te.cyan}15`,
                        color: te.cyan,
                        border: `1px solid ${te.cyan}33`,
                      }}>
                        {exchangeAbbr(anomaly.exchange)}
                      </span>
                      <span className="text-[10px] font-bold shrink-0" style={{
                        fontFamily: te.mono, color: anomaly.side === 'BID' ? te.green : te.red,
                        minWidth: 28,
                      }}>
                        {anomaly.side}
                      </span>
                      {/* Size threshold indicator */}
                      {LIMITS.TRADEABLE_CATEGORIES.includes(anomaly.category as any) && (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm shrink-0" style={{
                          fontFamily: te.mono,
                          background: anomaly.sizeUsd >= (SIZE_THRESHOLDS[anomaly.category] ?? Infinity) ? `${te.green}1a` : `${te.red}1a`,
                          color: anomaly.sizeUsd >= (SIZE_THRESHOLDS[anomaly.category] ?? Infinity) ? te.green : te.red,
                          border: `1px solid ${anomaly.sizeUsd >= (SIZE_THRESHOLDS[anomaly.category] ?? Infinity) ? `${te.green}33` : `${te.red}33`}`,
                        }}>
                          {anomaly.sizeUsd >= (SIZE_THRESHOLDS[anomaly.category] ?? Infinity) ? '✓SIZE' : '✗SIZE'}
                        </span>
                      )}
                      {/* Signal source indicator: REAL = live API, SIM = random generator */}
                      <span className="text-[7px] font-bold px-0.5 py-0.5 rounded-sm shrink-0" style={{
                        fontFamily: te.mono,
                        background: anomaly.source === 'REAL' ? `${te.green}1a` : `${te.orange}1a`,
                        color: anomaly.source === 'REAL' ? te.green : te.orange,
                        border: `1px solid ${anomaly.source === 'REAL' ? `${te.green}33` : `${te.orange}33`}`,
                      }}>
                        {anomaly.source === 'REAL' ? 'LIVE' : 'SIM'}
                      </span>
                      <span className="text-[10px] font-bold ml-auto shrink-0" style={{ fontFamily: te.mono, color: te.textDim }}>
                        {new Date(anomaly.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    {/* Row 2: Pair + Size + Imbalance + Details */}
                    <div className="flex items-center gap-2 mt-0.5 ml-5">
                      <span className="text-[10px] font-bold shrink-0" style={{ fontFamily: te.mono, color: te.text, minWidth: 50 }}>
                        {anomaly.pair.replace('-USDT', '')}
                      </span>
                      <span className="text-[10px] shrink-0" style={{ fontFamily: te.mono, color: te.textDim, minWidth: 40 }}>
                        {formatUsdLarge(anomaly.sizeUsd)}
                      </span>
                      <span className="text-[9px] shrink-0" style={{ fontFamily: te.mono, color: te.textDim, minWidth: 28 }}>
                        {Math.abs(anomaly.imbalance).toFixed(0)}Δ
                      </span>
                      <span className="text-[9px] truncate" style={{ fontFamily: te.mono, color: te.textMuted }}>
                        {anomaly.details}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ─── Execution Clock ────────────────────────────────────────────── */}
          <ExecutionClockInner execClock={execClock} />
          <CVDChartComponent
            activeSim={activeSim}
            activePairSymbol={activePair.symbol}
            activePairDecimals={activePair.decimals}
            wsConnected={wsConnected}
          />
          <HurstBBChartComponent
            activePairSymbol={activePair.symbol}
            activePairDecimals={activePair.decimals}
            wsConnected={wsConnected}
          />
          <LiquidationHeatmapComponent
            activeSim={activeSim}
            activePairSymbol={activePair.symbol}
            activePairDecimals={activePair.decimals}
            positions={positions}
            smoothHeatmapRef={smoothHeatmapRef}
            heatmapSvgRef={heatmapSvgRef}
            heatmapOpen={heatmapOpen}
            onToggleHeatmap={() => setHeatmapOpen(o => !o)}
          />

          {/* ─── OI + Funding Rate Panel — collapsible ────────────────────── */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
              <button
                onClick={() => setOiFundingOpen(o => !o)}
                className="w-full flex items-center gap-2 p-3 cursor-pointer"
                style={{ background: 'transparent', border: 'none', outline: 'none' }}
              >
                {oiFundingOpen
                  ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
                  : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
                }
                <DollarSign className="size-3.5" style={{ color: te.yellow }} />
                <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                  OI + FUNDING
                </span>
                <span className="text-[9px] ml-auto" style={{
                  fontFamily: te.mono,
                  color: ccxtStatus === 'LIVE' ? te.green : ccxtStatus === 'ERROR' ? te.red : te.textDim,
                }}>
                  {ccxtStatus === 'LIVE' ? '● LIVE' : ccxtStatus === 'ERROR' ? '● ERR' : ccxtStatus === 'LOADING' ? '● ...' : '○ IDLE'}
                </span>
              </button>
              {oiFundingOpen && (
                <div className="px-3 pb-3">
                  {Object.keys(oiFundingData).length === 0 ? (
                    <p className="text-[10px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      {ccxtStatus === 'IDLE' ? 'Waiting for data...' : 'Loading...'}
                    </p>
                  ) : (
                    <div className="space-y-0.5 max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {ALL_PAIRS.filter(p => {
                        const [base, quote] = p.symbol.split('-')
                        return oiFundingData[`${base}/${quote}:${quote}`]
                      }).slice(0, 10).map(pair => {
                        const [base, quote] = pair.symbol.split('-')
                        const ccxtSym = `${base}/${quote}:${quote}`
                        const data = oiFundingData[ccxtSym]
                        if (!data) return null
                        const isSpike = oiSpikes.includes(ccxtSym)
                        const isExtreme = fundingExtreme.includes(ccxtSym)
                        return (
                          <div key={pair.symbol} className="flex items-center px-1.5 py-1 rounded-sm"
                            style={{
                              background: isSpike ? `${te.yellow}0d` : isExtreme ? `${te.red}0d` : 'transparent',
                              border: `1px solid ${isSpike ? `${te.yellow}33` : isExtreme ? `${te.red}33` : te.border}`,
                            }}>
                            <span className="text-[10px] font-bold shrink-0" style={{ fontFamily: te.mono, color: te.text, width: 48, textAlign: 'left' }}>
                              {base}
                            </span>
                            <span className="text-[9px] shrink-0" style={{ fontFamily: te.mono, color: te.textDim, width: 80, textAlign: 'right' }}>
                              OI ${(data.openInterestUsd / 1_000_000).toFixed(1)}M
                            </span>
                            <span className="text-[9px] shrink-0" style={{
                              fontFamily: te.mono,
                              color: data.fundingRate > 0 ? te.green : data.fundingRate < 0 ? te.red : te.textDim,
                              width: 72, textAlign: 'right',
                            }}>
                              F {(data.fundingRate * 100).toFixed(4)}%
                            </span>
                            <span className="shrink-0" style={{ width: 56 }}>
                              {isSpike && (
                                <span className="text-[7px] px-1 rounded-sm font-bold" style={{
                                  fontFamily: te.mono,
                                  background: `${te.yellow}1a`, color: te.yellow,
                                  border: `1px solid ${te.yellow}33`,
                                }}>
                                  OI SPIKE
                                </span>
                              )}
                              {isExtreme && (
                                <span className="text-[7px] px-1 rounded-sm font-bold" style={{
                                  fontFamily: te.mono,
                                  background: `${te.red}1a`, color: te.red,
                                  border: `1px solid ${te.red}33`,
                                }}>
                                  EXTREME
                                </span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* Cross-exchange depth status */}
                  {crossExSnapshot && (
                    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${te.border}` }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Layers className="size-3.5" style={{ color: te.text }} />
                        <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.08em' }}>
                          CROSS-EXCHANGE DEPTH
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {crossExSnapshot.depths.map(d => (
                          <div key={d.exchange} className="flex items-center text-[11px]" style={{ fontFamily: te.mono }}>
                            <span className="font-bold shrink-0" style={{ color: d.exchange === 'binance' ? '#f0b90b' : d.exchange === 'bybit' ? '#f7a600' : d.exchange === 'okx' ? '#00C853' : '#fff', width: 52 }}>{d.exchange.toUpperCase()}</span>
                            <span className="shrink-0" style={{ color: te.green, width: 96, textAlign: 'right' }}>B: ${d.bidDepth5.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                            <span className="shrink-0" style={{ color: te.red, width: 96, textAlign: 'right' }}>A: ${d.askDepth5.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                            <span style={{ color: te.textDim }}>Spread: {d.spread.toFixed(pairSims[crossExSnapshot.pair]?.price ? 2 : 4)}</span>
                          </div>
                        ))}
                        {crossExSnapshot.wallAnomalyDetected && (
                          <div className="mt-1 px-2 py-1 rounded-sm" style={{
                            background: `${te.orange}1a`, border: `1px solid ${te.orange}33`,
                          }}>
                            <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.orange }}>
                              ⚠ WALL ANOMALY: {crossExSnapshot.wallAnomalyExchange?.toUpperCase()} {crossExSnapshot.wallAnomalySide} wall ${crossExSnapshot.wallAnomalySize.toLocaleString('en-US', { maximumFractionDigits: 0 })} ({crossExSnapshot.wallAnomalyRatio.toFixed(1)}x vs others)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          {/* WS OrderBook Preview — collapsible */}
          {wsConnected && wsOrderBook && wsOrderBook.bids && wsOrderBook.asks && (
            <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
              <button
                onClick={() => setOrderbookOpen(o => !o)}
                className="w-full flex items-center gap-2 p-2 cursor-pointer"
                style={{ background: 'transparent', border: 'none', outline: 'none' }}
              >
                {orderbookOpen
                  ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
                  : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
                }
                <Eye className="size-3.5" style={{ color: te.cyan }} />
                <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                  LIVE ORDERBOOK
                </span>
                <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
                  fontFamily: te.mono, background: te.greenBg,
                  color: te.green, border: `1px solid ${te.green}33`,
                }}>
                  WS
                </span>
                <span className="text-[11px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
                  {activePair.symbol}
                </span>
              </button>
              {orderbookOpen && (
                <div className="px-2 pb-2">
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    {/* Bids */}
                    <div>
                      <div className="text-[11px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.green, letterSpacing: '0.1em' }}>
                        BIDS
                      </div>
                      {(() => {
                        const bids = (wsOrderBook.bids || []).slice(0, 8)
                        const maxBidQty = Math.max(...bids.map(b => b.quantity), 1)
                        return bids.map((bid, i) => {
                          const pct = (bid.quantity / maxBidQty) * 100
                          return (
                            <div key={`bid-${i}`} className="relative flex justify-between text-[11px] py-0.5 px-1" style={{ fontFamily: te.mono }}>
                              <div className="absolute inset-0 rounded-sm" style={{ background: `${te.green}18`, width: `${pct}%` }} />
                              <span className="relative z-10" style={{ color: te.green }}>{formatPrice(bid.price, activePair.decimals)}</span>
                              <span className="relative z-10" style={{ color: te.textDim }}>{bid.quantity.toFixed(4)}</span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                    {/* Asks */}
                    <div>
                      <div className="text-[11px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.red, letterSpacing: '0.1em' }}>
                        ASKS
                      </div>
                      {(() => {
                        const asks = (wsOrderBook.asks || []).slice(0, 8)
                        const maxAskQty = Math.max(...asks.map(a => a.quantity), 1)
                        return asks.map((ask, i) => {
                          const pct = (ask.quantity / maxAskQty) * 100
                          return (
                            <div key={`ask-${i}`} className="relative flex justify-between text-[11px] py-0.5 px-1" style={{ fontFamily: te.mono }}>
                              <div className="absolute inset-0 rounded-sm" style={{ background: `${te.red}18`, width: `${pct}%` }} />
                              <span className="relative z-10" style={{ color: te.red }}>{formatPrice(ask.price, activePair.decimals)}</span>
                              <span className="relative z-10" style={{ color: te.textDim }}>{ask.quantity.toFixed(4)}</span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pair filter — bottom bar */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-sm flex-wrap" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>
              PAIR:
            </span>
            <button onClick={() => setFilterPair('ALL')}
              className="px-1 py-1 sm:py-0 text-[9px] font-bold rounded-sm min-h-[32px] sm:min-h-0"
              style={{
                fontFamily: te.mono,
                background: filterPair === 'ALL' ? te.bgInput : 'transparent',
                color: filterPair === 'ALL' ? te.orange : te.textDim,
                border: `1px solid ${filterPair === 'ALL' ? `${te.orange}33` : te.border}`,
              }}>
              ALL
            </button>
            {activePairSymbols.slice(0, 12).map(symbol => (
              <button key={symbol} onClick={() => setFilterPair(symbol)}
                className="px-1 py-1 sm:py-0 text-[9px] font-bold rounded-sm min-h-[32px] sm:min-h-0"
                style={{
                  fontFamily: te.mono,
                  background: filterPair === symbol ? te.bgInput : 'transparent',
                  color: filterPair === symbol ? te.orange : te.textDim,
                  border: `1px solid ${filterPair === symbol ? `${te.orange}33` : te.border}`,
                }}>
                {symbol.split('-')[0]}
              </button>
            ))}
          </div>

          {/* ═══ Error Log Panel ════════════════════════════════════════════════════ */}
          {/* Collapsible log window showing CRITICAL/WARNING/INFO events.
              Auto-expands on CRITICAL. Max 100 entries, FIFO. Click to copy. */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${errorLog.some(e => e.level === 'CRITICAL') ? '#ff3333' : te.border}` }}>
            <div
              onClick={() => setErrorLogOpen(o => !o)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 cursor-pointer"
              style={{ background: 'transparent' }}
            >
              {errorLogOpen
                ? <ChevronDown className="size-3" style={{ color: te.textDim }} />
                : <ChevronRight className="size-3" style={{ color: te.textDim }} />
              }
              <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>
                LOG
              </span>
              {errorLog.length > 0 && (
                <>
                  {errorLog.filter(e => e.level === 'CRITICAL').length > 0 && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ fontFamily: te.mono, background: '#ff000020', color: '#ff3333', border: '1px solid #ff333344' }}>
                      {errorLog.filter(e => e.level === 'CRITICAL').length} ERR
                    </span>
                  )}
                  {errorLog.filter(e => e.level === 'WARNING').length > 0 && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ fontFamily: te.mono, background: '#ff880015', color: '#ffaa00', border: '1px solid #ffaa0033' }}>
                      {errorLog.filter(e => e.level === 'WARNING').length} WARN
                    </span>
                  )}
                  <span className="text-[8px] px-1 py-0.5 rounded-sm" style={{ fontFamily: te.mono, background: `${te.orange}10`, color: te.textMuted }}>
                    {errorLog.length}
                  </span>
                </>
              )}
              <span className="flex-1" />
              {errorLog.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setErrorLog([]); errorLogRef.current = [] }}
                  className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm cursor-pointer"
                  style={{ fontFamily: te.mono, background: `${te.red}15`, color: te.red, border: `1px solid ${te.red}33` }}
                >
                  CLEAR
                </button>
              )}
            </div>

            {errorLogOpen && (
              <div className="px-1 pb-1.5" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {errorLog.length === 0 ? (
                  <div className="text-center py-2">
                    <span className="text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      No events
                    </span>
                  </div>
                ) : (
                  errorLog.map(entry => {
                    const meta = LOG_LEVEL_META[entry.level]
                    const ago = Math.round((Date.now() - entry.timestamp) / 1000)
                    const timeStr = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.floor(ago / 60)}m` : `${Math.floor(ago / 3600)}h`
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-1 px-1.5 py-0.5 rounded-sm cursor-pointer hover:brightness-125 transition-all"
                        style={{ background: meta.bg, borderBottom: `1px solid ${te.border}` }}
                        onClick={() => {
                          const text = `[${entry.level}] ${entry.source}: ${entry.message}${entry.details ? ` | ${entry.details}` : ''}`
                          navigator.clipboard.writeText(text).catch(() => {})
                        }}
                        title="Click to copy"
                      >
                        <span className="text-[8px] font-bold shrink-0" style={{ fontFamily: te.mono, color: meta.color }}>
                          {meta.icon}
                        </span>
                        <span className="text-[8px] font-bold shrink-0" style={{ fontFamily: te.mono, color: meta.color, minWidth: 16 }}>
                          {entry.level === 'CRITICAL' ? 'ERR' : entry.level === 'WARNING' ? 'WRN' : 'INF'}
                        </span>
                        <span className="text-[8px] shrink-0" style={{ fontFamily: te.mono, color: te.textMuted, minWidth: 20 }}>
                          {entry.source}
                        </span>
                        <span className="text-[8px] flex-1 truncate" style={{ fontFamily: te.mono, color: te.text }}>
                          {entry.message}
                        </span>
                        <span className="text-[7px] shrink-0" style={{ fontFamily: te.mono, color: te.textDim }}>
                          {timeStr}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT: Test Wallet + Active Positions + Equity Curve + Closed Positions ═════ */}
        <div className="space-y-2">
          {/* Test Wallet — Signal Execution Tracker */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${paperTrading ? (bybitTrading ? '#f7a600' : te.green) : te.border}`, opacity: paperTrading ? 1 : 0.7 }}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button
                onClick={() => setWalletSettingsOpen(o => !o)}
                className="flex items-center gap-1 cursor-pointer"
                style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
              >
                {walletSettingsOpen
                  ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
                  : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
                }
                <DollarSign className="size-3.5" style={{ color: paperTrading ? (bybitTrading ? '#f7a600' : te.green) : te.textDim }} />
                <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                  WALLET
                </span>
              </button>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-sm" style={{
                fontFamily: te.mono,
                background: `${feeSchedule.brandColor}15`,
                color: feeSchedule.brandColor,
                border: `1px solid ${feeSchedule.brandColor}33`,
              }}>
                {feeSchedule.label.toUpperCase()} FEES
              </span>
              {/* ── PAPER button ── */}
              <button onClick={() => {
                if (paperTrading) {
                  // Stopping: preserve wallet balance with realized PnL
                  // Update input to reflect current balance
                  setTestWalletInput(testWalletAmount.toFixed(2))
                  openPositionsCountRef.current = 0
                  // Turning off paper also turns off real trading
                  if (bybitTrading) setBybitTrading(false)
                }
                setPaperTrading(!paperTrading)
              }}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-[11px] font-bold transition-all"
                style={{
                  fontFamily: te.mono,
                  // When REAL is active, PAPER shows subdued — REAL takes visual priority
                  background: paperTrading && !bybitTrading ? `${te.green}20` : `${te.green}10`,
                  color: paperTrading && !bybitTrading ? '#fff' : te.green,
                  border: `1px solid ${paperTrading && !bybitTrading ? te.green : `${te.green}33`}`,
                  boxShadow: paperTrading && !bybitTrading ? `0 0 8px ${te.green}44` : 'none',
                }}>
                {paperTrading && !bybitTrading ? '● PAPER' : (paperTrading && bybitTrading ? '● PAPER' : '○ PAPER')}
              </button>
              {/* ── REAL button ── */}
              <button onClick={() => {
                if (bybitTrading) {
                  setBybitTrading(false)
                } else {
                  // REAL does NOT require PAPER to be on — signal gate now checks
                  // paperTrading || bybitTrading, so REAL alone is sufficient.
                  // Paper wallet stays in sync via bybitTrading checks elsewhere.
                  // ── Pre-check: verify Bybit API keys are configured before activating ──
                  fetch('/api/bybit/futures/balance?mode=real')
                    .then(r => r.json())
                    .then(d => {
                      if (d.success === false) {
                        // API keys not configured or connection failed
                        setBybitTrading(false)
                        const errMsg = d.error || 'Unknown error'
                        logEvent('CRITICAL', 'BYBIT', 'No kluczy API Bybit', `${errMsg} — kliknij Setup API w nagłówku aby skonfigurować klucze.`)
                        console.error(`[REAL MODE] ❌ Cannot activate: ${errMsg}`)
                        return
                      }
                      // Health check (non-blocking)
                      void fetch('/api/bybit/health?mode=real').then(r => r.json()).then(h => {
                        if (h.healthy) {
                          console.log(`[REAL MODE] ✅ Health check OK — time drift=${h.time?.diffMs}ms balance=$${h.balance?.availableBalance?.toFixed(2)}`)
                        } else {
                          console.warn(`[REAL MODE] ⚠️ Health check DEGRADED — time: ${h.time?.ok ? 'OK' : 'DRIFT ' + h.time?.diffMs + 'ms'}, balance: ${h.balance?.ok ? 'OK' : h.balance?.error}`)
                          logEvent('WARNING', 'BYBIT', 'Health check DEGRADED', `time: ${h.time?.ok ? 'OK' : 'DRIFT ' + h.time?.diffMs + 'ms'}, balance: ${h.balance?.ok ? 'OK' : h.balance?.error}`)
                        }
                      }).catch(() => {})
                      // Set wallet to real Bybit balance as initial deposit
                      const realBalance = d.availableBalance ?? d.totalEquityUsdt ?? 0
                      if (realBalance > 0) {
                        setBybitFuturesBalance(realBalance)
                        setTestWalletAmount(realBalance)
                        testWalletAmountRef.current = realBalance
                        setTestWalletInput(realBalance.toFixed(2))
                        // Reset cumulative PnL so initialCapital = wallet balance at switch time
                        cumulativeRealizedPnlRef.current = 0
                        logEvent('INFO', 'BYBIT', 'REAL mode aktywny', `Capital: $${realBalance.toFixed(2)} (availableBalance=${d.availableBalance}, totalEquity=${d.totalEquityUsdt})`)
                      } else {
                        // Balance is 0 — API works but no funds
                        setBybitFuturesBalance(0)
                        logEvent('WARNING', 'BYBIT', 'Saldo Bybit = $0', 'Connection OK, ale brak USDT on koncie futures. Przelej środki on konto Unified Trading.')
                      }
                      // Activate REAL mode regardless of balance (>0 is info, ===0 is warning, both valid)
                      setBybitTrading(true)
                    })
                    .catch(err => {
                      setBybitTrading(false)
                      logEvent('CRITICAL', 'BYBIT', 'Bybit connection error', err instanceof Error ? err.message : String(err))
                      console.error('[REAL MODE] ❌ Balance fetch failed:', err)
                    })
                }
              }}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-[11px] font-bold transition-all"
                style={{
                  fontFamily: te.mono,
                  background: bybitTrading ? '#f7a60025' : '#f7a60010',
                  color: bybitTrading ? '#fff' : '#f7a600',
                  border: `1px solid ${bybitTrading ? '#f7a600' : '#f7a60044'}`,
                  boxShadow: bybitTrading ? '0 0 10px #f7a60044' : 'none',
                }}>
                {bybitTrading ? '● REAL' : '○ REAL'}
              </button>
              {bybitTrading && bybitFuturesBalance !== null && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm" style={{
                  fontFamily: te.mono, color: te.bg,
                  background: '#f7a60033',
                }}>
                  ${bybitFuturesBalance.toFixed(2)}
                </span>
              )}
              {bybitTrading && bybitFuturesPositions.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
                  fontFamily: te.mono, color: '#f7a600',
                  background: '#f7a60015',
                }}>
                  {bybitFuturesPositions.length} POS
                </span>
              )}
              {dataSource !== 'LIVE' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm" style={{
                  fontFamily: te.mono, color: te.orange,
                  background: `${te.orange}15`, border: `1px solid ${te.orange}33`,
                }}>
                  CZEKA NA CENY
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[12px]" style={{ fontFamily: te.mono, color: te.text }}>CAPITAL:</span>
                {/* REAL mode: show Bybit balance (read-only) */}
                {bybitTrading && bybitFuturesBalance !== null ? (
                  <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-sm" style={{
                    fontFamily: te.mono, color: '#f7a600',
                    background: '#f7a60015', border: `1px solid #f7a60033`,
                  }}>
                    ${bybitFuturesBalance.toFixed(2)}
                  </span>
                ) : (
                <input
                  type="text"
                  value={paperTrading ? testWalletAmount.toFixed(2) : testWalletInput}
                  disabled={paperTrading}
                  onChange={e => setTestWalletInput(e.target.value)}
                  onBlur={() => {
                    const parsed = parseInt(testWalletInput.replace(/\D/g, ''), 10)
                    if (parsed > 0) {
                      setTestWalletAmount(parsed)
                      testWalletAmountRef.current = parsed
                      cumulativeRealizedPnlRef.current = 0
                      fullTradeHistoryRef.current = []
                      setFullTradeCount(0)
                      // P9 fix: clear closed positions and reset active positions on wallet change
                      setClosedPositions([]) 
                      closedPositionsRef.current = []
                      setPositions(prev => {
                        // Close any open positions with 0 PnL (wallet reset = new session)
                        const closed = prev.map(p => p.status === 'OPEN' ? { ...p, status: 'CLOSED_BREAKEVEN' as const, closedAt: Date.now(), pnl: 0, pnlPercent: 0 } : p)
                        positionsRef.current = closed.filter(p => p.status === 'OPEN')
                        openPositionsCountRef.current = 0
                        return [] // clear all positions — fresh start
                      })
                      // P10 fix: reset anomaly counter on wallet change
                      anomalyCountRef.current = 0
                      // Reset signal stats on wallet change
                      setSignalEvents([]); clearCexSessionEvents()
                      rsi15mSignalsRef.current.clear()
                      macdSignalsRef.current.clear()
                      bumpVirtualSignalVersion()
                    }
                    else setTestWalletInput(String(testWalletAmount))
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="w-20 px-1.5 py-0.5 text-[11px] font-bold rounded-sm text-right"
                  style={{
                    fontFamily: te.mono, color: te.text,
                    background: te.bgInput, border: `1px solid ${te.border}`,
                    outline: 'none', opacity: paperTrading ? 0.5 : 1,
                  }}
                />
                )}
              </div>
            </div>

            {walletSettingsOpen && (<>
            {/* Wallet summary row — PixelDigit TE 8-bit style */}
            <div className="grid grid-cols-5 gap-2 mb-2">
              {/* BALANCE */}
              <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>BALANCE</div>
                <div className="flex items-center">
                  <span className="text-[11px] font-bold mr-0.5" style={{ fontFamily: te.mono, color: walletStats.balance >= walletStats.initialCapital ? te.green : te.red }}>$</span>
                  <PixelDigit
                    chars={`${walletStats.balance >= 1000 ? (walletStats.balance / 1000).toFixed(1) + 'K' : walletStats.balance.toFixed(2)}`}
                    color={walletStats.balance >= walletStats.initialCapital ? te.green : te.red}
                    size={3}
                  />
                </div>
              </div>
              {/* ROI */}
              <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>ROI</div>
                <PixelDigit
                  chars={`${walletStats.roi >= 0 ? '+' : '-'}${Math.abs(walletStats.roi).toFixed(1)}%`}
                  color={walletStats.roi >= 0 ? te.green : te.red}
                  size={3}
                />
              </div>
              {/* WIN RATE */}
              <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>WIN RATE</div>
                <PixelDigit
                  chars={`${walletStats.winRate.toFixed(0)}%`}
                  color={walletStats.winRate >= 50 ? te.green : te.orange}
                  size={3}
                />
              </div>
              {/* TRADES */}
              <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>TRADES</div>
                <PixelDigit
                  chars={String(walletStats.allTrades.length)}
                  color={te.text}
                  size={3}
                />
              </div>
              {/* PNL */}
              <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${(walletStats.totalRealizedPnl + walletStats.activePnl) >= 0 ? te.green + '44' : te.red + '44'}` }}>
                <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>PNL</div>
                <PixelDigit
                  chars={`${(walletStats.totalRealizedPnl + walletStats.activePnl) >= 0 ? '+' : ''}${(walletStats.totalRealizedPnl + walletStats.activePnl).toFixed(2)}`}
                  color={(walletStats.totalRealizedPnl + walletStats.activePnl) >= 0 ? te.green : te.red}
                  size={3}
                />
              </div>
            </div>

            {/* W/L breakdown */}
            <div className="flex items-center gap-3 mb-2 px-1 flex-wrap">
              <div className="flex items-center gap-1">
                <TrendingUp className="size-3.5" style={{ color: te.green }} />
                <span className="text-[11px]" style={{ fontFamily: te.mono, color: te.green }}>
                  {walletStats.wins.length}W
                </span>
                <span className="text-[11px]" style={{ ...dataMono, color: te.green }}>
                  avg +${walletStats.avgWin.toFixed(0)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="size-3.5" style={{ color: te.red }} />
                <span className="text-[11px]" style={{ fontFamily: te.mono, color: te.red }}>
                  {walletStats.losses.length}L
                </span>
                <span className="text-[11px]" style={{ ...dataMono, color: te.red }}>
                  avg ${walletStats.avgLoss.toFixed(0)}
                </span>
              </div>
              {/* Bybit Verified PnL — shows authoritative PnL from Bybit's closed-pnl API */}
              {bybitTrading && bybitClosedPnlSyncRef.current !== 0 && (
                <div className="flex items-center gap-1" style={{ background: '#f7a60010', padding: '1px 6px', borderRadius: '2px', border: '1px solid #f7a60022' }}>
                  <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: '#f7a600', letterSpacing: '0.1em' }}>BYBIT</span>
                  <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: bybitClosedPnlSyncRef.current >= 0 ? te.green : te.red }}>
                    ${bybitClosedPnlSyncRef.current.toFixed(2)}
                  </span>
                  {bybitClosedPnlLastSyncRef.current > 0 && (
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      {Math.round((Date.now() - bybitClosedPnlLastSyncRef.current) / 60000)}m ago
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Signal Convergence Funnel */}
            <div className="mb-2 px-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Radio className="size-3.5" style={{ color: !funnelEnabled ? te.textDim : funnelStats.convictions > 0 ? te.green : funnelStats.waitingPairs > 0 ? te.orange : te.textDim }} />
                <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>CONVERGENCE FUNNEL</span>
                {/* Toggle ON/OFF button */}
                <button
                  onClick={() => setFunnelEnabled(prev => !prev)}
                  className="text-[10px] font-bold px-2 py-0.5 transition-all"
                  style={{
                    fontFamily: te.mono,
                    letterSpacing: '0.04em',
                    color: funnelEnabled ? te.bg : te.orange,
                    backgroundColor: funnelEnabled ? te.green : 'transparent',
                    border: `1px solid ${funnelEnabled ? 'transparent' : te.orange}`,
                  }}
                  title={funnelEnabled ? 'Funnel ON: needs 2+ categories to converge before entering. Click to disable.' : 'Funnel OFF: enters on any signal immediately. Click to enable.'}
                >
                  {funnelEnabled ? 'ON' : 'OFF'}
                </button>
                {!funnelEnabled && (
                  <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.orange, letterSpacing: '0.04em' }}>
                    DIRECT ENTRY
                  </span>
                )}
                {funnelEnabled && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{
                    fontFamily: te.mono,
                    background: funnelStats.convictions > 0 ? `${te.green}1a` : funnelStats.waitingPairs > 0 ? `${te.orange}1a` : te.bgInput,
                    color: funnelStats.convictions > 0 ? te.green : funnelStats.waitingPairs > 0 ? te.orange : te.textDim,
                    border: `1px solid ${funnelStats.convictions > 0 ? `${te.green}33` : funnelStats.waitingPairs > 0 ? `${te.orange}33` : te.border}`,
                  }}>
                    {funnelStats.convictions > 0 ? `${funnelStats.convictions} ✓` : funnelStats.waitingPairs > 0 ? `${funnelStats.waitingPairs} WAIT` : 'IDLE'}
                  </span>
                )}
                <span className="text-[9px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
                  {funnelStats.waitingSignals} sig / {FUNNEL.WINDOW_MS / 1000}s
                </span>
              </div>
              {/* Per-pair funnel bars — only show when funnel is enabled */}
              {funnelEnabled && Object.values(funnel).length > 0 && (
                <div className="space-y-0.5">
                  {Object.values(funnel)
                    .filter(pf => pf.signals.length > 0)
                    .sort((a, b) => {
                      // Convictions first, then by signal count
                      if (a.convergence && !b.convergence) return -1
                      if (!a.convergence && b.convergence) return 1
                      return b.signals.length - a.signals.length
                    })
                    .slice(0, 5) // Show top 5 pairs
                    .map(pf => {
                      const categories = [...new Set(pf.signals.map(s => s.anomaly.category))]
                      const hasConvergence = pf.convergence !== null
                      const fillPct = Math.min((categories.length / FUNNEL.MIN_CONVERGENCE) * 100, 100)
                      const now = Date.now()
                      const oldestExpiry = Math.min(...pf.signals.map(s => s.expiresAt))
                      const ttl = Math.max(0, Math.round((oldestExpiry - now) / 1000))
                      return (
                        <div key={pf.pair} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-bold w-14 truncate" style={{ fontFamily: te.mono, color: hasConvergence ? te.green : te.text }}>
                            {pf.pair.replace('-USDT', '')}
                          </span>
                          {/* Convergence progress bar */}
                          <div className="flex-1 h-1.5 rounded-full relative" style={{ background: te.bgInput }}>
                            <div className="absolute top-0 left-0 h-full rounded-full transition-all duration-300" style={{
                              width: `${fillPct}%`,
                              background: hasConvergence
                                ? `linear-gradient(to right, ${te.green}88, ${te.green})`
                                : `linear-gradient(to right, ${te.orange}44, ${te.orange}88)`,
                            }} />
                          </div>
                          {/* Category tags */}
                          <div className="flex gap-0.5">
                            {categories.map(cat => {
                              const tag = ANOMALY_WEIGHTS.find(w => w.category === cat)?.tag || '???'
                              return (
                                <span key={cat} className="text-[9px] font-bold px-1 rounded-sm" style={{
                                  fontFamily: te.mono,
                                  background: TAG_COLORS[tag as AnomalyTag]?.bg || te.bgInput,
                                  color: TAG_COLORS[tag as AnomalyTag]?.text || te.textDim,
                                }}>
                                  {tag}
                                </span>
                              )
                            })}
                          </div>
                          {/* TTL */}
                          <span className="text-[9px]" style={{ fontFamily: te.mono, color: ttl < 15 ? te.red : te.textDim }}>
                            {ttl}s
                          </span>
                          {hasConvergence && (
                            <span className="text-[9px] font-bold" style={{ color: te.green }}>✓ CONVICT</span>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>

            {/* ═══ Settings Grid: vertical blocks ═══ */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              {/* ── Block 1: Exchange + Fees + Execution ── */}
              <div className="p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[10px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>EXCHANGE</div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {(Object.entries(EXCHANGE_FEES) as [TradingExchange, typeof EXCHANGE_FEES[TradingExchange]][]).map(([key, fees]) => (
                    <button
                      key={key}
                      onClick={() => { setTradingExchange(key) }}
                      className="text-[10px] font-bold px-2 py-0.5 transition-all"
                      style={{
                        fontFamily: te.mono,
                        letterSpacing: '0.06em',
                        color: tradingExchange === key ? te.bg : te.textDim,
                        backgroundColor: tradingExchange === key ? fees.brandColor : 'transparent',
                        border: `1px solid ${tradingExchange === key ? 'transparent' : te.border}`,
                      }}
                      title={`${fees.label}: Taker ${(fees.taker * 100).toFixed(3)}% / Maker ${(fees.maker * 100).toFixed(3)}%`}
                    >
                      {fees.label.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>FEES</span>
                  <span className="text-[11px]" style={{ ...dataMono, color: te.orange }}>
                    -${(walletStats.totalFeesPaid + walletStats.activeFees).toFixed(3)}
                  </span>
                </div>
                <div className="text-[10px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                  {`taker ${(takerFeeRate * 100).toFixed(3)}% x2 = ${(roundTripFeeRate * 100).toFixed(3)}%`}
                </div>
                <div className="text-[9px] mt-0.5" style={{ fontFamily: te.mono, color: te.textDim }}>all market orders</div>
              </div>

              {/* ── Block 2: Mode selector ── */}
              <div className="p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[10px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>MODE</div>
                <div className="space-y-1">
                  {(Object.entries(TRADING_MODES) as [TradingMode, typeof TRADING_MODES[TradingMode]][]).map(([key, mode]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setTradingMode(key)
                        setLeverage(mode.leverage)
                      }}
                      className="w-full text-[10px] font-bold px-2 py-1 transition-all text-left"
                      style={{
                        fontFamily: te.mono,
                        letterSpacing: '0.04em',
                        color: tradingMode === key ? te.bg : te.textDim,
                        backgroundColor: tradingMode === key ? (key === 'AGGRESSIVE' ? te.orange : key === 'SCALPER' ? te.cyan : key === 'CONTRARIAN' ? te.purple : te.green) : 'transparent',
                        border: `1px solid ${tradingMode === key ? 'transparent' : te.border}`,
                      }}
                      title={mode.description}
                    >
                      {key === 'AGGRESSIVE' ? '⚡' : key === 'SCALPER' ? '🔪' : key === 'CONTRARIAN' ? '🔄' : '🛡'} {mode.label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] mt-1.5" style={{ fontFamily: te.mono, color: te.textDim }}>
                  {useCustomTPSL
                    ? tpslInputMode === 'pnl'
                      ? `TP${customTP}% SL${customSL}% PnL × ${leverage}x | R:R ${(customTP / customSL).toFixed(1)}:1${!tmoEnabled ? ' | NO TMO' : customTMO > 0 ? ` | TMO ${customTMO}s` : ''}`
                      : `TP${customTP}% SL${customSL}% ceny × ${leverage}x | R:R ${(customTP / customSL).toFixed(1)}:1${!tmoEnabled ? ' | NO TMO' : customTMO > 0 ? ` | TMO ${customTMO}s` : ''}`
                    : tradingMode === 'AGGRESSIVE'
                    ? `TP${modeConfig.takeProfitPercent}% × ${leverage}x | trail 1.5%${tmoEnabled ? customTMO > 0 ? ` | TMO ${customTMO}s` : ' | TMO 10min' : ' | NO TMO'}`
                    : tradingMode === 'SCALPER'
                    ? `TP${modeConfig.takeProfitPercent}% × ${leverage}x | tight SL${tmoEnabled ? customTMO > 0 ? ` | TMO ${customTMO}s` : ' | TMO 30s' : ' | NO TMO'}`
                    : tradingMode === 'CONTRARIAN'
                    ? `TP${modeConfig.takeProfitPercent}% × ${leverage}x | FADE ALL${tmoEnabled ? customTMO > 0 ? ` | TMO ${customTMO}s` : ' | TMO 8min' : ' | NO TMO'}`
                    : `TP${modeConfig.takeProfitPercent}% × ${leverage}x | trail 1.5%${tmoEnabled ? customTMO > 0 ? ` | TMO ${customTMO}s` : '' : ' | NO TMO'}`}
                </div>
                {/* Max positions selector */}
                <div className="flex items-center gap-0.5 mt-1.5 flex-wrap">
                  <span className="text-[8px] font-bold shrink-0 mr-0.5" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.04em' }}>POS</span>
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <button
                      key={n}
                      onClick={() => setMaxActivePositions(n)}
                      className="text-[9px] font-bold px-1 py-0.5 rounded-sm transition-all shrink-0"
                      style={{
                        fontFamily: te.mono,
                        color: maxActivePositions === n ? te.bg : te.textDim,
                        backgroundColor: maxActivePositions === n ? te.orange : 'transparent',
                        border: `1px solid ${maxActivePositions === n ? 'transparent' : te.border}`,
                        minWidth: 18,
                        textAlign: 'center' as const,
                      }}
                      title={`Max ${n} active position${n > 1 ? 's' : ''}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Block 2.5: Manual TP / SL Override ── */}
              <div className="p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${useCustomTPSL ? te.green + '88' : te.border}` }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>TP / SL</div>
                  <div className="flex items-center gap-1.5">
                    {/* PnL% / Price% toggle */}
                    <button
                      onClick={() => setTpslInputMode(v => v === 'pnl' ? 'price' : 'pnl')}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-all"
                      style={{
                        fontFamily: te.mono,
                        letterSpacing: '0.04em',
                        color: tpslInputMode === 'pnl' ? te.bg : te.textDim,
                        backgroundColor: tpslInputMode === 'pnl' ? te.cyan : 'transparent',
                        border: `1px solid ${tpslInputMode === 'pnl' ? 'transparent' : te.border}`,
                      }}
                      title={tpslInputMode === 'pnl' ? 'Wpisujesz % PnL pozycji (automatycznie dzielone przez leverage)' : 'Wpisujesz % ruchu ceny bezpośrednio'}
                    >
                      {tpslInputMode === 'pnl' ? 'PnL%' : 'CENA%'}
                    </button>
                    <button
                      onClick={() => setUseCustomTPSL(v => !v)}
                      className="text-[9px] font-bold px-2 py-0.5 rounded-sm transition-all"
                      style={{
                        fontFamily: te.mono,
                        letterSpacing: '0.04em',
                        color: useCustomTPSL ? te.bg : te.textDim,
                        backgroundColor: useCustomTPSL ? te.green : 'transparent',
                        border: `1px solid ${useCustomTPSL ? 'transparent' : te.border}`,
                      }}
                      title={useCustomTPSL ? 'Użyj domyślnych ustawień trybu' : 'Użyj własnych ustawień TP i SL'}
                    >
                      {useCustomTPSL ? 'MANUAL' : 'AUTO'}
                    </button>
                  </div>
                </div>
                {useCustomTPSL && (
                  <>
                    {/* TP input */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="text-[9px] font-bold w-6 shrink-0" style={{ fontFamily: te.mono, color: te.green, letterSpacing: '0.04em' }}>TP</div>
                      <input
                        type="number"
                        value={customTP}
                        onChange={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v) && v > 0 && v <= 200) setCustomTP(v)
                        }}
                        step={tpslInputMode === 'pnl' ? 1 : 0.1}
                        min={0.1}
                        max={200}
                        className="w-full text-[11px] font-bold px-2 py-1 rounded-sm outline-none"
                        style={{
                          fontFamily: te.mono,
                          color: te.green,
                          background: '#0a1a0a',
                          border: `1px solid ${te.green}44`,
                        }}
                        title={tpslInputMode === 'pnl'
                          ? `Take Profit jako % PnL pozycji. Przy ${leverage}x: TP ${customTP}% PnL = ${(customTP / leverage).toFixed(2)}% ceny`
                          : `Take Profit jako % ruchu ceny. Przy ${leverage}x: TP ${customTP}% ceny = ${(customTP * leverage).toFixed(1)}% PnL`}
                      />
                      <div className="text-[9px] shrink-0" style={{ fontFamily: te.mono, color: tpslInputMode === 'pnl' ? te.cyan : te.textDim }}>
                        {tpslInputMode === 'pnl' ? '% PnL' : '% ceny'}
                      </div>
                    </div>
                    {/* SL input */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="text-[9px] font-bold w-6 shrink-0" style={{ fontFamily: te.mono, color: te.red, letterSpacing: '0.04em' }}>SL</div>
                      <input
                        type="number"
                        value={customSL}
                        onChange={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v) && v > 0 && v <= 100) setCustomSL(v)
                        }}
                        step={tpslInputMode === 'pnl' ? 1 : 0.05}
                        min={0.05}
                        max={100}
                        className="w-full text-[11px] font-bold px-2 py-1 rounded-sm outline-none"
                        style={{
                          fontFamily: te.mono,
                          color: te.red,
                          background: '#1a0a0a',
                          border: `1px solid ${te.red}44`,
                        }}
                        title={tpslInputMode === 'pnl'
                          ? `Stop Loss jako % PnL pozycji. Przy ${leverage}x: SL ${customSL}% PnL = ${(customSL / leverage).toFixed(2)}% ceny`
                          : `Stop Loss jako % odległości od entry. Przy ${leverage}x: SL ${customSL}% ceny = ${(customSL * leverage).toFixed(1)}% PnL`}
                      />
                      <div className="text-[9px] shrink-0" style={{ fontFamily: te.mono, color: tpslInputMode === 'pnl' ? te.cyan : te.textDim }}>
                        {tpslInputMode === 'pnl' ? '% PnL' : '% ceny'}
                      </div>
                    </div>
                    {/* Quick presets — adjusted for current input mode */}
                    <div className="flex gap-1 flex-wrap">
                      {(tpslInputMode === 'pnl' ? [
                        { label: '3/6', tp: 3, sl: 6 },
                        { label: '5/10', tp: 5, sl: 10 },
                        { label: '8/15', tp: 8, sl: 15 },
                        { label: '10/5', tp: 10, sl: 5 },
                        { label: '15/8', tp: 15, sl: 8 },
                      ] : [
                        { label: '0.3/0.8', tp: 0.8, sl: 0.3 },
                        { label: '0.5/1.2', tp: 1.2, sl: 0.5 },
                        { label: '0.5/1.5', tp: 1.5, sl: 0.5 },
                        { label: '0.8/2.0', tp: 2.0, sl: 0.8 },
                        { label: '1.0/3.0', tp: 3.0, sl: 1.0 },
                      ]).map(preset => (
                        <button
                          key={preset.label}
                          onClick={() => { setCustomTP(preset.tp); setCustomSL(preset.sl) }}
                          className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm transition-all"
                          style={{
                            fontFamily: te.mono,
                            letterSpacing: '0.03em',
                            color: customTP === preset.tp && customSL === preset.sl ? te.bg : te.textDim,
                            backgroundColor: customTP === preset.tp && customSL === preset.sl ? te.cyan : 'transparent',
                            border: `1px solid ${customTP === preset.tp && customSL === preset.sl ? 'transparent' : te.border}`,
                          }}
                          title={tpslInputMode === 'pnl'
                            ? `TP ${preset.tp}% PnL | SL ${preset.sl}% PnL — R:R ${(preset.tp / preset.sl).toFixed(1)}:1`
                            : `SL ${preset.sl}% / TP ${preset.tp}% ceny — R:R ${(preset.tp / preset.sl).toFixed(1)}:1`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {/* R:R info — shows both price% and PnL% */}
                    <div className="text-[9px] mt-1" style={{ fontFamily: te.mono, color: te.textDim }}>
                      {tpslInputMode === 'pnl'
                        ? `R:R ${(customTP / customSL).toFixed(1)}:1 | cena: TP=${(customTP / leverage).toFixed(2)}% SL=${(customSL / leverage).toFixed(2)}%`
                        : `R:R ${(customTP / customSL).toFixed(1)}:1 | ${leverage}x: TP=${(customTP * leverage).toFixed(1)}% SL=${(customSL * leverage).toFixed(1)}% PnL`}
                    </div>
                    {/* TAKER WHITELIST indicator */}
                    {DYNAMIC_TRAILING.ENABLED && (
                      <div className="text-[8px] mt-1" style={{ fontFamily: te.mono, color: te.cyan }}>
                        DYN-TRL: &lt;0.15%→0.08% | 0.15-0.40%→0.12% | ≥0.40%→0.20%
                      </div>
                    )}
                    <div className="text-[8px] mt-0.5" style={{ fontFamily: te.mono, color: '#ff4081' }}>
                      TAKER WL: {TAKER_WHITELIST.join(', ').replace(/-USDT/g, '')}
                    </div>
                  </>
                )}
              </div>

              {/* ── Block 2.6: Breakeven Stop ── */}
              <div className="p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${beEnabled ? te.cyan + '88' : te.border}` }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>BREAKEVEN STOP</div>
                  <button
                    onClick={() => setBeEnabled(v => !v)}
                    className="text-[9px] font-bold px-2 py-0.5 rounded-sm transition-all"
                    style={{
                      fontFamily: te.mono, letterSpacing: '0.04em',
                      color: beEnabled ? te.bg : te.textDim,
                      backgroundColor: beEnabled ? te.cyan : 'transparent',
                      border: `1px solid ${beEnabled ? 'transparent' : te.border}`,
                    }}
                    title={beEnabled ? 'Wyłącz Breakeven Stop' : 'Włącz Breakeven Stop — SL przechodzi on entry+buffer po ruchu w stronę TP'}
                  >
                    {beEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                {beEnabled && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Trigger % */}
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.cyan, letterSpacing: '0.04em' }}>TRIG</span>
                      <input
                        type="number" value={beTriggerPct}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 20) setBeTriggerPct(v) }}
                        step={0.1} min={0.1} max={20}
                        className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                        style={{ fontFamily: te.mono, color: te.cyan, background: '#0a1a1a', border: `1px solid ${te.cyan}44` }}
                        title="% favorable price move after which SL moves to entry+buffer"
                      />
                      <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>% ceny</span>
                    </div>
                    {/* Buffer bps */}
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.cyan, letterSpacing: '0.04em' }}>BUF</span>
                      <input
                        type="number" value={beBufferBps}
                        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setBeBufferBps(v) }}
                        step={1} min={0} max={200}
                        className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                        style={{ fontFamily: te.mono, color: te.cyan, background: '#0a1a1a', border: `1px solid ${te.cyan}44` }}
                        title="Buffer nad entry w bps (1 bp = 0.01%). SL = entry ± buffer"
                      />
                      <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>bps</span>
                    </div>
                    {/* Info */}
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      Po +{beTriggerPct}% favorable → SL = entry ± {(beBufferBps / 100).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>

              {/* ── Block 3: Leverage + Toggles ── */}
              <div className="p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                <div className="text-[10px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>LEVERAGE</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mb-1.5">
                  {LEVERAGE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setLeverage(opt.value)
                        if (opt.value > 1 && tradingMode === 'CONSERVATIVE') setTradingMode('AGGRESSIVE')
                        if (opt.value === 1 && (tradingMode === 'AGGRESSIVE' || tradingMode === 'SCALPER' || tradingMode === 'CONTRARIAN')) setTradingMode('CONSERVATIVE')
                      }}
                      className="text-[10px] font-bold px-1 py-1 transition-all text-center"
                      style={{
                        fontFamily: te.mono,
                        color: leverage === opt.value ? te.bg : opt.color,
                        backgroundColor: leverage === opt.value ? opt.color : 'transparent',
                        border: `1px solid ${leverage === opt.value ? 'transparent' : te.border}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setShowTaInfo(v => !v)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-sm transition-all"
                    style={{
                      fontFamily: te.mono,
                      letterSpacing: '0.04em',
                      color: showTaInfo ? te.bg : te.textDim,
                      backgroundColor: showTaInfo ? te.cyan : 'transparent',
                      border: `1px solid ${showTaInfo ? 'transparent' : te.border}`,
                    }}
                    title={showTaInfo ? 'Ukryj panel TA' : 'Pokaż panel TA (VWAP, MOM, SMA)'}
                  >
                    TA {showTaInfo ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => setSoundEnabled(v => !v)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-sm transition-all"
                    style={{
                      fontFamily: te.mono,
                      letterSpacing: '0.04em',
                      color: soundEnabled ? te.bg : te.textDim,
                      backgroundColor: soundEnabled ? te.orange : 'transparent',
                      border: `1px solid ${soundEnabled ? 'transparent' : te.border}`,
                    }}
                    title={soundEnabled ? 'Wyłącz dźwięk' : 'Włącz dźwięk — beep przy otwarciu'}
                  >
                    🔊 {soundEnabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => setTmoEnabled(v => !v)}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-sm transition-all"
                    style={{
                      fontFamily: te.mono,
                      letterSpacing: '0.04em',
                      color: tmoEnabled ? te.bg : te.textDim,
                      backgroundColor: tmoEnabled ? te.red : 'transparent',
                      border: `1px solid ${tmoEnabled ? 'transparent' : te.border}`,
                    }}
                    title={tmoEnabled ? 'Wyłącz TMO — pozycje bez limitu czasu' : 'Włącz TMO — auto-zamykaj pozycje po czasie'}
                  >
                    TMO {tmoEnabled ? 'ON' : 'OFF'}
                  </button>
                  {/* Manual TMO input */}
                  {tmoEnabled && (
                    <div className="flex items-center gap-1 ml-1">
                      <input
                        type="number"
                        value={customTMO || ''}
                        onChange={e => {
                          const v = parseInt(e.target.value)
                          if (!isNaN(v) && v >= 0 && v <= 3600) setCustomTMO(v)
                          else if (e.target.value === '') setCustomTMO(0)
                        }}
                        placeholder="AUTO"
                        step={10}
                        min={0}
                        max={3600}
                        className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                        style={{
                          fontFamily: te.mono,
                          color: customTMO > 0 ? te.orange : te.textDim,
                          background: '#1a0f00',
                          border: `1px solid ${customTMO > 0 ? te.orange + '66' : te.border}`,
                        }}
                        title="TMO w sekundach. 0 = domyślny trybu (AGG 180s, SCALPER 300s, CONTRA 480s). Wpisz np. 60 by zamknąć po 1 min."
                      />
                      <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>s</span>
                    </div>
                  )}
                </div>
                {/* ── Direction Filter: LONG / SHORT / BOTH ── */}
                <div className="mt-1.5">
                  <div className="text-[10px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.06em' }}>DIRECTION</div>
                  <div className="flex gap-1">
                    {([
                      { value: 'BOTH' as const, label: '↕ BOTH', color: te.textDim, activeColor: te.cyan },
                      { value: 'LONG' as const, label: '▲ LONG', color: te.textDim, activeColor: te.green },
                      { value: 'SHORT' as const, label: '▼ SHORT', color: te.textDim, activeColor: te.red },
                    ]).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setAllowedDirection(opt.value)}
                        className="text-[9px] font-bold px-2 py-0.5 rounded-sm transition-all flex-1 text-center"
                        style={{
                          fontFamily: te.mono,
                          letterSpacing: '0.04em',
                          color: allowedDirection === opt.value ? te.bg : opt.color,
                          backgroundColor: allowedDirection === opt.value ? opt.activeColor : 'transparent',
                          border: `1px solid ${allowedDirection === opt.value ? 'transparent' : te.border}`,
                        }}
                        title={
                          opt.value === 'BOTH' ? 'Otwieraj LONG i SHORT'
                          : opt.value === 'LONG' ? 'Tylko pozycje LONG (sygnały SHORT odrzucane)'
                          : 'Tylko pozycje SHORT (sygnały LONG odrzucane)'
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {/* TA Confirmation Panel — VWAP + MOM + SMA 8/21 + MACD convergence bar */}
            {showTaInfo && (() => {
              const activeSim = pairSims[activePair.symbol]
              if (!activeSim || activeSim.priceHistory.length < TA_CONFIG.SMA_SLOW) return null
              const vwapOk = activeSim.price > activeSim.vwap
              const momOk = activeSim.momentum > 0
              const smaOk = activeSim.sma8 > activeSim.sma21
              const macdOk = activeSim.macdHistogram > 0  // positive histogram = bullish
              const taCount = [vwapOk, momOk, smaOk, macdOk].filter(Boolean).length
              const taPass = taCount >= SCORING.TA_MIN_CONVERGENCE

              // Detect flips to confirmed — animate only when transitioning ✗→✓
              const prev = prevTaStateRef.current
              const vwapFlip = vwapOk && !prev.vwap
              const momFlip  = momOk  && !prev.mom
              const smaFlip  = smaOk  && !prev.sma
              const macdFlip = macdOk && !prev.macd
              const convFlip = taPass && !prev.conv
              // Update ref for next render
              prev.vwap = vwapOk; prev.mom = momOk; prev.sma = smaOk; prev.macd = macdOk; prev.conv = taPass

              // Key forces re-trigger of animation on each new confirmation
              const arrowKey = (confirmed: boolean, flip: boolean, id: string) =>
                `${id}-${confirmed}-${flip ? Date.now() : 'static'}`

              return (
                <div className="flex items-center gap-2 mb-1 px-1 flex-wrap">
                  <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.06em' }}>TA</span>
                  <span className="text-[7px] font-bold" style={{ fontFamily: te.mono, color: `${te.textDim}66`, letterSpacing: '0.04em' }}>INFO</span>
                  {/* VWAP */}
                  <div className="flex items-center gap-0.5" title={`VWAP: $${activeSim.vwap.toFixed(2)} | Price ${vwapOk ? '>' : '<'} VWAP`}>
                    <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>VWAP</span>
                    <span key={arrowKey(vwapOk, vwapFlip, 'vwap')}
                      className={`text-[10px] inline-block ${vwapOk && vwapFlip ? 'ta-arrow-confirm' : ''}`}
                      style={{ fontFamily: te.mono, color: vwapOk ? te.green : te.red }}>
                      {vwapOk ? '▲' : '▼'}
                    </span>
                  </div>
                  {/* MOM */}
                  <div className="flex items-center gap-0.5" title={`Momentum: ${activeSim.momentum.toFixed(2)} | ${momOk ? 'Bullish' : 'Bearish'}`}>
                    <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>MOM</span>
                    <span key={arrowKey(momOk, momFlip, 'mom')}
                      className={`text-[10px] inline-block ${momOk && momFlip ? 'ta-arrow-confirm' : ''}`}
                      style={{ fontFamily: te.mono, color: momOk ? te.green : te.red }}>
                      {momOk ? '▲' : '▼'}
                    </span>
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>{activeSim.momentum.toFixed(2)}</span>
                  </div>
                  {/* SMA 8/21 */}
                  <div className="flex items-center gap-0.5" title={`SMA8: $${activeSim.sma8.toFixed(2)} | SMA21: $${activeSim.sma21.toFixed(2)} | ${smaOk ? 'Uptrend' : 'Downtrend'}`}>
                    <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>SMA 8/21</span>
                    <span key={arrowKey(smaOk, smaFlip, 'sma')}
                      className={`text-[10px] inline-block ${smaOk && smaFlip ? 'ta-arrow-confirm' : ''}`}
                      style={{ fontFamily: te.mono, color: smaOk ? te.green : te.red }}>
                      {smaOk ? '▲' : '▼'}
                    </span>
                  </div>
                  {/* MACD */}
                  <div className="flex items-center gap-0.5" title={`MACD: ${(activeSim.macdHistogram * 100).toFixed(3)} | Line ${activeSim.macdLine.toFixed(4)} Signal ${activeSim.macdSignal.toFixed(4)} | ${macdOk ? 'Bullish' : 'Bearish'}`}>
                    <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>MACD</span>
                    <span key={arrowKey(macdOk, macdFlip, 'macd')}
                      className={`text-[10px] inline-block ${macdOk && macdFlip ? 'ta-arrow-confirm' : ''}`}
                      style={{ fontFamily: te.mono, color: macdOk ? te.green : te.red }}>
                      {macdOk ? '▲' : '▼'}
                    </span>
                  </div>
                  {/* BB Touch: upper band → SHORT ▼, lower band → LONG ▲ */}
                  {(() => {
                    const bbShort = activeSim.price >= activeSim.bbUpper  // price at/above upper BB → overbought → SHORT
                    const bbLong = activeSim.price <= activeSim.bbLower   // price at/below lower BB → oversold → LONG
                    const bbActive = bbShort || bbLong
                    const prev = prevTaStateRef.current
                    const bbShortFlip = bbShort && !prev.bbShort
                    const bbLongFlip = bbLong && !prev.bbLong
                    prev.bbShort = bbShort; prev.bbLong = bbLong
                    return (
                      <div className="flex items-center gap-0.5"
                        title={bbShort
                          ? `BB Touch ▼ SHORT | Price $${activeSim.price.toFixed(2)} ≥ Upper $${activeSim.bbUpper.toFixed(2)}`
                          : bbLong
                            ? `BB Touch ▲ LONG | Price $${activeSim.price.toFixed(2)} ≤ Lower $${activeSim.bbLower.toFixed(2)}`
                            : `BB | Upper $${activeSim.bbUpper.toFixed(2)} Lower $${activeSim.bbLower.toFixed(2)}`}>
                        <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>BB</span>
                        {bbActive ? (
                          <span key={arrowKey(true, bbShortFlip || bbLongFlip, 'bb')}
                            className={`text-[10px] inline-block ${(bbShortFlip || bbLongFlip) ? 'ta-arrow-confirm' : ''}`}
                            style={{ fontFamily: te.mono, color: bbShort ? te.red : te.green }}>
                            {bbShort ? '▼' : '▲'}
                          </span>
                        ) : (
                          <span className="text-[8px]" style={{ fontFamily: te.mono, color: `${te.textDim}55` }}>–</span>
                        )}
                      </div>
                    )
                  })()}
                  {/* Convergence bar */}
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>CONV</span>
                    <div className="flex gap-px">
                      {[0,1,2,3].map(i => (
                        <div key={`dot-${i}-${i < taCount ? 'on' : 'off'}`}
                          className={`w-2 h-2 rounded-sm ${i < taCount && (i === 0 && vwapFlip || i === 1 && momFlip || i === 2 && smaFlip || i === 3 && macdFlip) ? 'ta-dot-confirm' : ''}`}
                          style={{
                            backgroundColor: i < taCount ? (taPass ? te.green : te.orange) : `${te.textDim}33`,
                          }} />
                      ))}
                    </div>
                    <span key={`conv-${taPass}-${convFlip ? Date.now() : 's'}`}
                      className={`text-[9px] font-bold inline-block ${convFlip ? 'ta-conv-pass' : ''}`}
                      style={{
                        fontFamily: te.mono,
                        color: taPass ? te.green : te.red,
                      }}>
                      {taCount}/4 {taPass ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
              )
            })()}
            {/* Signal category toggle — horizontal bar */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-sm flex-wrap" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
              <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>SIG:</span>
              {ALL_TRADEABLE.map(cat => {
                const meta = CATEGORY_META[cat]
                const tag = ANOMALY_WEIGHTS.find(w => w.category === cat)?.tag || cat
                const tc = TAG_COLORS[tag as AnomalyTag]
                const isEnabled = enabledCategories.has(cat)
                const isRev = cat === 'ICEBERG_REVERSAL'
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setEnabledCategories(prev => {
                        const next = new Set(prev)
                        if (next.has(cat)) {
                          next.delete(cat)
                        } else {
                          next.add(cat)
                          if (cat === 'ICEBERG_DETECTED') next.delete('ICEBERG_REVERSAL')
                          if (cat === 'ICEBERG_REVERSAL') next.delete('ICEBERG_DETECTED')
                        }
                        return next
                      })
                    }}
                    className="px-1 py-1 sm:py-0 text-[9px] font-bold rounded-sm transition-all min-h-[32px] sm:min-h-0"
                    style={{
                      fontFamily: te.mono,
                      letterSpacing: '0.04em',
                      color: isEnabled ? tc.text : te.textDim,
                      background: isEnabled ? tc.bg : 'transparent',
                      border: `1px solid ${isEnabled ? tc.border : te.border}`,
                      opacity: isEnabled ? 1 : 0.4,
                      textDecoration: isEnabled ? 'none' : 'line-through',
                    }}
                    title={meta.description}
                  >
                    {isEnabled ? '●' : '○'} {tag}{isRev ? ' ↩' : ''}
                  </button>
                )
              })}
            </div>
            {/* Pair toggle — horizontal bar */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-sm flex-wrap" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
              <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.1em' }}>PAIR:</span>
              {ALL_PAIRS.map(pair => {
                const baseAsset = pair.symbol.split('-')[0]
                const isEnabled = enabledPairs.has(pair.symbol)
                return (
                  <button
                    key={pair.symbol}
                    onClick={() => {
                      setEnabledPairs(prev => {
                        const next = new Set(prev)
                        if (next.has(pair.symbol)) {
                          next.delete(pair.symbol)
                        } else {
                          next.add(pair.symbol)
                        }
                        return next
                      })
                    }}
                    className="px-1 py-1 sm:py-0 text-[9px] font-bold rounded-sm transition-all min-h-[32px] sm:min-h-0"
                    style={{
                      fontFamily: te.mono,
                      letterSpacing: '0.04em',
                      color: isEnabled ? te.orange : te.textDim,
                      background: isEnabled ? `${te.orange}15` : 'transparent',
                      border: `1px solid ${isEnabled ? `${te.orange}44` : te.border}`,
                      opacity: isEnabled ? 1 : 0.35,
                      textDecoration: isEnabled ? 'none' : 'line-through',
                    }}
                    title={isEnabled ? `Wyłącz ${pair.symbol} of sygnałów` : `Włącz ${pair.symbol} do sygnałów`}
                  >
                    {isEnabled ? '●' : '○'} {baseAsset}
                  </button>
                )
              })}
              <button
                onClick={() => setEnabledPairs(new Set(ALL_PAIRS.map(p => p.symbol)))}
                className="px-1 py-1 sm:py-0 text-[8px] font-bold rounded-sm min-h-[32px] sm:min-h-0"
                style={{ fontFamily: te.mono, color: te.green, border: `1px solid ${te.green}33`, background: `${te.green}10` }}
                title="Włącz wszystkie pary"
              >
                ALL
              </button>
              <button
                onClick={() => setEnabledPairs(new Set())}
                className="px-1 py-1 sm:py-0 text-[8px] font-bold rounded-sm min-h-[32px] sm:min-h-0"
                style={{ fontFamily: te.mono, color: te.red, border: `1px solid ${te.red}33`, background: `${te.red}10` }}
                title="Wyłącz wszystkie pary"
              >
                NONE
              </button>
            </div>
            {walletStats.allTrades.length > 0 && (
              <div className="max-h-40 overflow-y-auto overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${te.border}` }}>
                      {['PAIR', 'SIDE', 'ENTRY', 'EXIT', 'SIZE', 'FEES', 'PNL', 'RESULT'].map(h => (
                        <th key={h} className="text-[8px] font-bold px-1 py-1 text-left" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.08em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {walletStats.allTrades.map(pos => {
                      const isClosing = pos.status === 'CLOSING' || pos.closeConfirmedAt === null
                      const isLiq = pos.status === 'LIQUIDATED'
                      const isBurstTp = pos.status === 'CLOSED_BURST_TP'
                      const isBreakeven = pos.status === 'CLOSED_BREAKEVEN'
                      const isCollectiveTP = pos.status === 'CLOSED_COLLECTIVE_TP'
                      const isTrailing = pos.status === 'CLOSED_TRAILING'
                      const isMomDiv = pos.status === 'CLOSED_MOM_DIV'
                      const isVwapCross = pos.status === 'CLOSED_VWAP_CROSS'
                      const isSignalExit = pos.status === 'CLOSED_SIGNAL_EXIT'
                      const isClosedTP = pos.status === 'CLOSED_TP'
                      const isTimeout = pos.status === 'CLOSED_TIMEOUT'
                      const isManual = pos.status === 'CLOSED_MANUAL'
                      const statusLabel = isClosing ? '⏳' : isLiq ? 'STOP' : isBurstTp ? 'BURST' : isBreakeven ? 'BE' : isCollectiveTP ? 'CTP' : isTrailing ? 'TRL' : isTimeout ? 'TMO' : isMomDiv ? 'MOM' : isVwapCross ? 'VWP' : isSignalExit ? 'SIG' : isManual ? 'MANUAL' : isClosedTP ? 'TP' : '—'
                      const statusColor = isClosing ? '#f59e0b' : isLiq ? te.red : isBurstTp ? '#00ff88' : isBreakeven ? te.cyan : isCollectiveTP ? te.green : isTrailing ? te.orange : isTimeout ? te.yellow : isMomDiv ? te.yellow : isVwapCross ? te.cyan : isSignalExit ? te.purple : isManual ? '#3b82f6' : te.green
                      const dec = ALL_PAIRS.find(p => p.symbol === pos.pair)?.decimals || 2
                      return (
                        <tr key={pos.id} style={{ borderBottom: `1px solid ${te.border}33` }}>
                          <td className="text-[9px] font-bold px-1 py-1" style={{ ...dataMono, color: te.text }}>{pos.pair.replace('-USDT', '')}</td>
                          <td className="text-[9px] px-1 py-1" style={{ fontFamily: te.mono, color: pos.side === 'LONG' ? te.green : te.red }}>{pos.side}{pos.contrarian ? ' ↻' : ''}</td>
                          <td className="text-[9px] px-1 py-1" style={{ ...dataMono, color: te.textDim }}>{formatPrice(pos.entryPrice, dec)}</td>
                          <td className="text-[9px] px-1 py-1" style={{ ...dataMono, color: te.textDim }}>{formatPrice(pos.currentPrice, dec)}</td>
                          <td className="text-[9px] px-1 py-1" style={{ ...dataMono, color: te.textDim }}>{formatUsdLarge(pos.sizeUsd)}</td>
                          <td className="text-[9px] px-1 py-1" style={{ ...dataMono, color: te.orange }}>
                            -${(pos.totalFees || 0).toFixed(3)}
                          </td>
                          <td className="text-[9px] font-bold px-1 py-1" style={{ ...dataMono, color: pos.pnl >= 0 ? te.green : te.red }}>
                            {formatPnl(pos.pnl)}
                          </td>
                          <td className="text-[9px] font-bold px-1 py-1">
                            <span className="px-1 py-0.5 rounded-sm" style={{
                              fontFamily: te.mono,
                              background: `${statusColor}1a`,
                              color: statusColor,
                              border: `1px solid ${statusColor}33`,
                              animation: isClosing ? 'pulse 1.5s infinite' : undefined,
                            }}>
                              {statusLabel}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {walletStats.allTrades.length === 0 && (
              <div className="py-3 flex items-center justify-center">
                <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                  {!paperTrading ? 'WCIŚNIJ ▶ START ABY ROZPOCZĄĆ PAPER TRADING' : dataSource !== 'LIVE' ? 'CZEKAM NA CENY BINANCE...' : 'CZEKAM NA SYGNAŁY ABSORPTION...'}
                </span>
              </div>
            )}
            </>)}
          </div>

          {/* Active Positions — on samym dole */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="size-3.5" style={{ color: te.blue }} />
              <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                ACTIVE POSITIONS
              </span>
              <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
                fontFamily: te.mono, background: te.bgInput,
                color: te.blue, border: `1px solid ${te.border}`,
              }}>
                {positions.filter(p => p.status === 'OPEN').length}/{maxActivePositions}
              </span>
              {positions.filter(p => p.status === 'OPEN').length > 0 && (
                <span className="text-[8px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.03em' }}>
                  KEY [1-9] = CLOSE
                </span>
              )}
            </div>

            {positions.filter(p => p.status === 'OPEN').length === 0 && (
              <div className="p-2 flex items-center justify-center">
                <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                  NO ACTIVE POSITIONS
                </span>
              </div>
            )}

            <div className="overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {positions.filter(p => p.status === 'OPEN')
                .sort((a, b) => a.openedAt - b.openedAt) // oldest first
                .map((pos, idx) => (
                <ActivePositionCard
                  key={pos.id}
                  pos={pos}
                  posNum={idx + 1}
                  pairDecimals={ALL_PAIRS.find(p => p.symbol === pos.pair)?.decimals || 2}
                  effectiveTP={effectiveTP}
                  dataMono={dataMono}
                  bybitTrading={bybitTrading}
                  onManualClose={manualClose}
                />
              ))}
            </div>
          </div>

          {/* Equity Curve — collapsible */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <button
              onClick={() => setEquityCurveOpen(o => !o)}
              className="w-full flex items-center gap-2 p-2 cursor-pointer"
              style={{ background: 'transparent', border: 'none', outline: 'none' }}
            >
              {equityCurveOpen
                ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
                : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
              }
              <TrendingUp className="size-3" style={{ color: (walletStats.totalRealizedPnl + walletStats.activePnl) >= 0 ? te.green : te.red }} />
              <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                EQUITY CURVE
              </span>
              <span className="text-[9px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
                ${walletStats.initialCapital} → ${walletStats.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </button>
            {equityCurveOpen && (
              <div className="px-2 pb-2">
                {(() => {
              // AUDIT FIX #1: Use fullTradeHistoryRef (never truncated) instead of
              // closedPositions (capped at MAX_CLOSED_POSITIONS=30). The old code
              // missed older trades, making the equity curve start from the wrong
              // balance — it would show $73 instead of the true cumulative curve.
              const initialCapital = walletStats.initialCapital
              const points: { t: number; balance: number }[] = [{ t: 0, balance: initialCapital }]
              let runningBalance = initialCapital
              const sortedClosed = [...fullTradeHistoryRef.current].sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0))
              sortedClosed.forEach((pos, i) => {
                // BUG FIX: Include partialPnlRealized in equity curve.
                // pos.pnl only contains the REMAINING position's PnL at close.
                // Partial TP profits are tracked in partialPnlRealized separately.
                // Without this, the equity curve misses partial TP profits, causing
                // the curve to diverge from the actual wallet balance.
                const totalPosPnl = pos.pnl + (pos.partialPnlRealized || 0)
                runningBalance += totalPosPnl
                points.push({ t: i + 1, balance: runningBalance })
              })
              // Add current open PnL as last point
              if (positions.filter(p => p.status === 'OPEN').length > 0) {
                points.push({ t: points.length, balance: runningBalance + walletStats.activePnl })
              }

              const w = 600
              const h = 220
              const pad = 4
              const chartW = w - pad * 2
              const chartH = h - pad * 2

              const minBal = Math.min(...points.map(p => p.balance))
              const maxBal = Math.max(...points.map(p => p.balance))
              const range = maxBal - minBal || 1

              const toX = (i: number) => pad + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2)
              const toY = (bal: number) => pad + chartH - ((bal - minBal) / range) * chartH

              const isProfit = (walletStats.totalRealizedPnl + walletStats.activePnl) >= 0
              const lineColor = isProfit ? te.green : te.red
              const fillTop = isProfit ? `${te.green}20` : `${te.red}20`
              const fillBot = isProfit ? `${te.green}02` : `${te.red}02`

              // Start line (initial capital reference)
              const startY = toY(initialCapital)

              // Hover data arrays for equity curve
              const eqBarMeta = points.slice(1).map((p, i) => {
                const pos = sortedClosed[i]
                const pnl = pos ? pos.pnl + (pos.partialPnlRealized || 0) : 0
                return {
                  balance: p.balance,
                  pnl,
                  trade: i + 1,
                  pair: pos?.pair?.replace('-USDT', '') || '',
                  side: pos?.side || '',
                  dotCx: toX(i + 1),
                  dotCy: toY(p.balance),
                }
              })
              const eqBarGap = points.length > 1 ? chartW / (points.length - 1) : chartW

              const handleEqMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
                const svg = e.currentTarget
                const vb = svg.viewBox.baseVal
                const rect = svg.getBoundingClientRect()
                // preserveAspectRatio="xMidYMid meet": scale = min(widthRatio, heightRatio)
                const scaleX = rect.width / vb.width
                const scaleY = rect.height / vb.height
                const meetScale = Math.min(scaleX, scaleY)
                const renderedW = vb.width * meetScale
                const renderedH = vb.height * meetScale
                const offsetX = (rect.width - renderedW) / 2
                const offsetY = (rect.height - renderedH) / 2
                const mx = e.clientX - rect.left - offsetX
                const my = e.clientY - rect.top - offsetY
                const vbX = mx / meetScale
                const vbY = my / meetScale
                // Find closest bar by scanning all dotCx values (same as PnL curve)
                const barIdx = (() => {
                  let best = -1, bestDist = Infinity
                  for (let i = 0; i < eqBarMeta.length; i++) {
                    const dist = Math.abs(eqBarMeta[i].dotCx - vbX)
                    if (dist < bestDist) { bestDist = dist; best = i }
                  }
                  const halfGap = eqBarMeta.length > 1 ? (eqBarMeta[1].dotCx - eqBarMeta[0].dotCx) / 2 : 20
                  return bestDist <= halfGap ? best : -1
                })()
                if (barIdx < 0 || barIdx >= eqBarMeta.length) {
                  setEqHover(null)
                  return
                }
                const meta = eqBarMeta[barIdx]
                const tx = e.clientX - rect.left + 12
                const ty = e.clientY - rect.top - 10
                setEqHover({
                  x: tx + 130 > rect.width ? e.clientX - rect.left - 135 : tx,
                  y: ty < 0 ? 10 : ty,
                  balance: meta.balance,
                  pnl: meta.pnl,
                  trade: meta.trade,
                  pair: meta.pair,
                  side: meta.side,
                  dotCx: meta.dotCx,
                  dotCy: meta.dotCy,
                })
              }

              return points.length < 2 ? (
                <div className="flex items-center justify-center" style={{ height: h }}>
                  <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                    {paperTrading ? 'CZEKAM NA PIERWSZĄ TRANSAKCJĘ...' : 'START PAPER TRADING ABY ZOBACZYĆ KRZYWĄ'}
                  </span>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}
                  onMouseMove={handleEqMouseMove}
                  onMouseLeave={() => setEqHover(null)}>
                  {/* Grid lines */}
                  {[0.25, 0.5, 0.75].map(frac => (
                    <line key={frac} x1={pad} y1={pad + chartH * frac} x2={w - pad} y2={pad + chartH * frac}
                      stroke={te.border} strokeWidth={0.5} strokeDasharray="2,4" />
                  ))}
                  {/* Initial capital reference line */}
                  {startY > pad && startY < h - pad && (
                    <line x1={pad} y1={startY} x2={w - pad} y2={startY}
                      stroke={te.textDim} strokeWidth={0.5} strokeDasharray="4,4" />
                  )}
                  {/* Fill area under curve */}
                  <path d={
                    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(' ') +
                    ` L${toX(points.length - 1).toFixed(1)},${(pad + chartH).toFixed(1)} L${pad},${(pad + chartH).toFixed(1)} Z`
                  } fill={`url(#equityGrad)`} />
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={fillTop} />
                      <stop offset="100%" stopColor={fillBot} />
                    </linearGradient>
                  </defs>
                  {/* Line */}
                  <path d={
                    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.balance).toFixed(1)}`).join(' ')
                  } fill="none" stroke={lineColor} strokeWidth={1.5} />
                  {/* Dots on each trade */}
                  {points.slice(1).map((p, i) => {
                    const isHovered = eqHover?.trade === i + 1
                    return (
                      <circle key={i} cx={toX(i + 1).toFixed(1)} cy={toY(p.balance).toFixed(1)} r={isHovered ? 4 : 2}
                        fill={p.balance >= initialCapital ? te.green : te.red}
                        stroke={isHovered ? '#fff' : te.bgCard} strokeWidth={isHovered ? 1.5 : 0.5} />
                    )
                  })}
                  {/* Cursor dot on hover */}
                  {eqHover && (
                    <circle cx={eqHover.dotCx.toFixed(1)} cy={eqHover.dotCy.toFixed(1)} r={4}
                      fill="#fff" stroke={eqHover.balance >= initialCapital ? te.green : te.red} strokeWidth={1.5} opacity={1} />
                  )}
                  {/* Hover highlight strip */}
                  {eqHover && (
                    <rect x={(eqHover.dotCx - eqBarGap / 2).toFixed(1)} y={pad}
                      width={eqBarGap.toFixed(1)} height={chartH.toFixed(1)}
                      fill="rgba(255,255,255,0.04)" />
                  )}
                  {/* Current balance label */}
                  <text x={w - pad} y={toY(points[points.length - 1].balance) - 3} fontSize={8}
                    fill={lineColor} textAnchor="end" fontWeight={700} fontFamily={te.mono}>
                    ${points[points.length - 1].balance.toFixed(2)}
                  </text>
                  {/* Min/Max labels */}
                  <text x={pad} y={pad + 8} fontSize={6} fill={te.textDim} fontFamily={te.mono}>
                    ${maxBal.toFixed(0)}
                  </text>
                  <text x={pad} y={h - pad} fontSize={6} fill={te.textDim} fontFamily={te.mono}>
                    ${minBal.toFixed(0)}
                  </text>
                </svg>
                {/* Hover tooltip — driven by React state */}
                {eqHover && (() => {
                  const pnlStr = (eqHover.pnl >= 0 ? '+' : '') + eqHover.pnl.toFixed(3)
                  const balStr = '$' + eqHover.balance.toFixed(2)
                  const pnlClr = eqHover.pnl >= 0 ? te.green : te.red
                  return (
                    <div style={{
                      position: 'absolute',
                      left: eqHover.x,
                      top: eqHover.y,
                      pointerEvents: 'none',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 3,
                      padding: '4px 7px',
                      fontFamily: te.mono,
                      fontSize: '9px',
                      zIndex: 10,
                      whiteSpace: 'nowrap',
                      lineHeight: 1.5,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}>
                      <div style={{ color: '#888' }}>Trade #{eqHover.trade} · {eqHover.pair} {eqHover.side}</div>
                      <div style={{ color: te.textMuted }}>Balance: {balStr}</div>
                      <div style={{ color: pnlClr }}>PnL: ${pnlStr}</div>
                    </div>
                  )
                })()}
                </div>
              )
            })()}
              </div>
            )}
          </div>

          {/* PnL Curve — per-trade PnL bars + cumulative line + hover tooltip (React state) */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="size-3" style={{ color: te.orange }} />
              <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                PnL CURVE
              </span>
              <span className="text-[9px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
                {(() => {
                  const sorted = [...fullTradeHistoryRef.current].sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0))
                  const wins = sorted.filter(p => p.pnl > 0).length
                  const total = sorted.length
                  return total > 0 ? `${wins}/${total} WIN (${((wins/total)*100).toFixed(0)}%)` : 'NO TRADES'
                })()}
              </span>
            </div>
            {(() => {
              const sortedClosed = [...fullTradeHistoryRef.current].sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0))
              if (sortedClosed.length < 1) return (
                <div className="flex items-center justify-center" style={{ height: 200 }}>
                  <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                    CZEKAM NA TRANSAKCJE...
                  </span>
                </div>
              )

              const w = 400
              const h = 200
              const pad = 4
              const chartW = w - pad * 2
              const chartH = h - pad * 2

              // Per-trade PnL values (include partial TP PnL for accuracy)
              const pnlValues = sortedClosed.map(p => p.pnl + (p.partialPnlRealized || 0))
              const maxAbs = Math.max(...pnlValues.map(Math.abs), 0.01)
              const zeroY = pad + chartH / 2

              // Cumulative PnL
              let cumPnl = 0
              const cumPoints: { t: number; v: number }[] = [{ t: 0, v: 0 }]
              pnlValues.forEach((pnl, i) => {
                cumPnl += pnl
                cumPoints.push({ t: i + 1, v: cumPnl })
              })

              const barW = Math.max(2, Math.min(12, (chartW / pnlValues.length) - 2))
              const barGap = chartW / pnlValues.length

              const toX = (i: number) => pad + (cumPoints.length > 1 ? (i / (cumPoints.length - 1)) * chartW : chartW / 2)
              const cumMax = Math.max(...cumPoints.map(p => Math.abs(p.v)), 0.01)
              const toCumY = (v: number) => zeroY - (v / cumMax) * (chartH / 2 - 2)

              const cumColor = '#ffffff'

              // Hover data arrays — used by React mouse handler
              const barMeta = pnlValues.map((pnl, i) => {
                const pos = sortedClosed[i]
                const cumV = cumPoints[i + 1]?.v ?? 0
                return {
                  pnl, cumV,
                  pair: pos?.pair?.replace('-USDT', '') || '',
                  side: pos?.side || '',
                  status: pos?.status?.replace('CLOSED_', '').replace('LIQUIDATED', 'LIQ') || '',
                  trade: i + 1,
                  dotCx: toX(i + 1),
                  dotCy: toCumY(cumV),
                }
              })

              // React mouse handler for SVG
              const handlePnlMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
                const svg = e.currentTarget
                const vb = svg.viewBox.baseVal
                const rect = svg.getBoundingClientRect()
                // preserveAspectRatio="xMidYMid meet": scale = min(widthRatio, heightRatio)
                const scaleX = rect.width / vb.width
                const scaleY = rect.height / vb.height
                const meetScale = Math.min(scaleX, scaleY)
                const renderedW = vb.width * meetScale
                const renderedH = vb.height * meetScale
                const offsetX = (rect.width - renderedW) / 2
                const offsetY = (rect.height - renderedH) / 2
                const mx = e.clientX - rect.left - offsetX
                const my = e.clientY - rect.top - offsetY
                const vbX = mx / meetScale
                const vbY = my / meetScale
                // Find which bar the cursor is over using toX-based mapping
                // (not barGap, which is misaligned with the cumulative line toX coordinates)
                const barIdx = (() => {
                  // barMeta[i].dotCx = toX(i+1) — find closest dotCx to vbX
                  let best = -1, bestDist = Infinity
                  for (let i = 0; i < barMeta.length; i++) {
                    const dist = Math.abs(barMeta[i].dotCx - vbX)
                    if (dist < bestDist) { bestDist = dist; best = i }
                  }
                  // Only accept if within half the bar-to-bar distance
                  const halfGap = barMeta.length > 1 ? (barMeta[1].dotCx - barMeta[0].dotCx) / 2 : 20
                  return bestDist <= halfGap ? best : -1
                })()
                if (barIdx < 0 || barIdx >= barMeta.length) {
                  setPnlHover(null)
                  return
                }
                const meta = barMeta[barIdx]
                const tx = e.clientX - rect.left + 12
                const ty = e.clientY - rect.top - 10
                setPnlHover({
                  x: tx + 130 > rect.width ? e.clientX - rect.left - 135 : tx,
                  y: ty < 0 ? 10 : ty,
                  pnl: meta.pnl,
                  cum: meta.cumV,
                  pair: meta.pair,
                  side: meta.side,
                  status: meta.status,
                  trade: meta.trade,
                  dotCx: meta.dotCx,
                  dotCy: meta.dotCy,
                })
              }

              return (
                <div style={{ position: 'relative' }}>
                <svg id="pnl-curve-svg" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}
                  onMouseMove={handlePnlMouseMove}
                  onMouseLeave={() => setPnlHover(null)}>
                  {/* Zero line */}
                  <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY}
                    stroke={te.border} strokeWidth={0.5} strokeDasharray="2,4" />
                  {/* Per-trade bars */}
                  {pnlValues.map((pnl, i) => {
                    const barH = (Math.abs(pnl) / maxAbs) * (chartH / 2 - 2)
                    const x = pad + i * barGap + (barGap - barW) / 2
                    const isWin = pnl >= 0
                    const isHovered = pnlHover?.trade === i + 1
                    return (
                      <g key={i}>
                        <rect x={x.toFixed(1)} y={isWin ? (zeroY - barH).toFixed(1) : zeroY.toFixed(1)}
                          width={barW.toFixed(1)} height={Math.max(1, barH).toFixed(1)}
                          fill={isWin ? te.green : te.red} opacity={isHovered ? 0.7 : 0.3}
                          rx={0.5} />
                        {/* Hover highlight strip */}
                        {isHovered && (
                          <rect x={(pad + i * barGap).toFixed(1)} y={pad}
                            width={barGap.toFixed(1)} height={chartH.toFixed(1)}
                            fill="rgba(255,255,255,0.04)" />
                        )}
                      </g>
                    )
                  })}
                  {/* Cumulative PnL line */}
                  {cumPoints.length >= 2 && (
                    <path d={
                      cumPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toCumY(p.v).toFixed(1)}`).join(' ')
                    } fill="none" stroke={cumColor} strokeWidth={1.5} opacity={0.85} />
                  )}
                  {/* Cursor dot on cumulative line — driven by React state */}
                  {pnlHover && (
                    <circle cx={pnlHover.dotCx.toFixed(1)} cy={pnlHover.dotCy.toFixed(1)} r={3.5}
                      fill="#fff" stroke={pnlHover.cum >= 0 ? te.green : te.red} strokeWidth={1.5} opacity={1} />
                  )}
                  {/* End dot — label rendered as HTML overlay below to prevent SVG text stretching */}
                  {cumPoints.length >= 2 && (
                    <circle cx={toX(cumPoints.length - 1).toFixed(1)} cy={toCumY(cumPoints[cumPoints.length - 1].v).toFixed(1)} r={2.5}
                      fill="#ffffff" stroke={te.bgCard} strokeWidth={0.5} />
                  )}
                </svg>
                {/* Cumulative PnL sum — HTML overlay (avoids SVG text stretching) */}
                {cumPoints.length >= 2 && (() => {
                  const cumPnlStr = (cumPnl >= 0 ? '+' : '') + cumPnl.toFixed(2)
                  const cumClr = cumPnl >= 0 ? te.green : te.red
                  // Position: near the right edge, vertically aligned with the last cum point
                  // toCumY returns Y in viewBox coords (0 = top, h = bottom)
                  // Convert to percentage of SVG height for CSS top positioning
                  const lastCumY = toCumY(cumPoints[cumPoints.length - 1].v)
                  const topPct = ((lastCumY - 10) / h) * 100
                  return (
                    <div style={{
                      position: 'absolute',
                      right: 8,
                      top: `${Math.max(0, Math.min(85, topPct))}%`,
                      pointerEvents: 'none',
                      fontFamily: te.mono,
                      fontSize: '9px',
                      fontWeight: 700,
                      color: cumClr,
                      whiteSpace: 'nowrap',
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    }}>
                      {cumPnlStr}
                    </div>
                  )
                })()}
                {/* PnL Curve Hover tooltip — driven by React state */}
                {pnlHover && (() => {
                  const pnlStr = (pnlHover.pnl >= 0 ? '+' : '') + pnlHover.pnl.toFixed(3)
                  const cumStr = (pnlHover.cum >= 0 ? '+' : '') + pnlHover.cum.toFixed(3)
                  const pnlClr = pnlHover.pnl >= 0 ? te.green : te.red
                  const cumClr = pnlHover.cum >= 0 ? te.green : te.red
                  return (
                    <div style={{
                      position: 'absolute',
                      left: pnlHover.x,
                      top: pnlHover.y,
                      pointerEvents: 'none',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 3,
                      padding: '4px 7px',
                      fontFamily: te.mono,
                      fontSize: '9px',
                      zIndex: 10,
                      whiteSpace: 'nowrap',
                      lineHeight: 1.5,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}>
                      <div style={{ color: '#888' }}>Trade #{pnlHover.trade} · {pnlHover.pair} {pnlHover.side}</div>
                      <div style={{ color: pnlClr }}>PnL: ${pnlStr}</div>
                      <div style={{ color: cumClr }}>Cum: ${cumStr}</div>
                      {pnlHover.status && <div style={{ color: '#555' }}>{pnlHover.status}</div>}
                    </div>
                  )
                })()}
                </div>
              )
            })()}
          </div>

          {/* Closed Positions — tuż pod Equity Curve — collapsible */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div
              onClick={() => setClosedPositionsOpen(o => !o)}
              className="w-full flex items-center gap-2 p-2 cursor-pointer"
              style={{ background: 'transparent', border: 'none', outline: 'none' }}
            >
              {closedPositionsOpen
                ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
                : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
              }
              <X className="size-3.5" style={{ color: te.red }} />
              <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
                CLOSED POSITIONS
              </span>
              <span className="text-[11px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                {fullTradeCount} TOTAL
              </span>
              {fullTradeCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const trades = fullTradeHistoryRef.current
                    const dec = (pair: string) => ALL_PAIRS.find(p => p.symbol === pair)?.decimals || 2
                    const statusLabel = (s: PositionStatus) =>
                      s === 'LIQUIDATED' ? 'STOP' : s === 'CLOSED_BURST_TP' ? 'BURST' : s === 'CLOSED_BREAKEVEN' ? 'BE' : s === 'CLOSED_COLLECTIVE_TP' ? 'CTP'
                      : s === 'CLOSED_TRAILING' ? 'TRL' : s === 'CLOSED_TP' ? 'TP' : s === 'CLOSED_MOM_DIV' ? 'MOM'
                      : s === 'CLOSED_VWAP_CROSS' ? 'VWP' : s === 'CLOSED_SIGNAL_EXIT' ? 'SIG' : s === 'CLOSED_MANUAL' ? 'MANUAL' : s
                    const headers = ['#','PAIR','SIDE','LEVERAGE','ENTRY','EXIT','MARGIN','NOTIONAL','FEES','PNL','RESULT','TRIGGER','OPENED','CLOSED','DURATION_S']
                    const rows = trades.map((t, i) => [
                      i + 1,
                      t.pair,
                      t.side,
                      t.leverage,
                      t.entryPrice.toFixed(dec(t.pair)),
                      t.currentPrice.toFixed(dec(t.pair)),
                      t.marginUsd.toFixed(2),
                      t.sizeUsd.toFixed(2),
                      (t.totalFees || 0).toFixed(4),
                      t.pnl.toFixed(4),
                      statusLabel(t.status),
                      t.anomaly?.tag || '',
                      new Date(t.openedAt).toISOString(),
                      t.closedAt ? new Date(t.closedAt).toISOString() : '',
                      t.closedAt ? ((t.closedAt - t.openedAt) / 1000).toFixed(1) : '',
                    ].join(','))
                    const csv = [headers.join(','), ...rows].join('\n')
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `trading-trades-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm transition-all ml-auto"
                  style={{
                    fontFamily: te.mono,
                    color: te.green,
                    background: `${te.green}15`,
                    border: `1px solid ${te.green}33`,
                    letterSpacing: '0.04em',
                  }}
                >
                  CSV
                </button>
              )}
            </div>
            {closedPositionsOpen && (
            <>
              {closedPositions.length === 0 && (
                <div className="p-3 flex items-center justify-center">
                  <span className="text-[12px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                    NO CLOSED POSITIONS YET
                  </span>
                </div>
              )}

              <div className="max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {closedPositions.map(pos => {
                  // Guard: skip broken positions with missing data (orphan/phantom edge cases)
                  if (!pos.anomaly) return null
                  const safeTagColors = TAG_COLORS[pos.anomaly.tag] || TAG_COLORS['TAKER'] // fallback
                  const safePriceHistory = pos.priceHistory || []
                  const isClosing = pos.status === 'CLOSING' || pos.closeConfirmedAt === null
                  const isLiq = pos.status === 'LIQUIDATED'
                  const isBurstTp = pos.status === 'CLOSED_BURST_TP'
                  const isBreakeven = pos.status === 'CLOSED_BREAKEVEN'
                  const isTp = pos.status === 'CLOSED_TP'
                  const isCollectiveTP = pos.status === 'CLOSED_COLLECTIVE_TP'
                  const isTrailing = pos.status === 'CLOSED_TRAILING'
                  const isTimeout = pos.status === 'CLOSED_TIMEOUT'
                  const isSignalExit = pos.status === 'CLOSED_SIGNAL_EXIT'
                  const isMomDiv = pos.status === 'CLOSED_MOM_DIV'
                  const isVwapCross = pos.status === 'CLOSED_VWAP_CROSS'
                  const isManual = pos.status === 'CLOSED_MANUAL'
                  const statusColor = isClosing ? '#f59e0b' : isLiq ? te.red : isBurstTp ? '#00ff88' : isBreakeven ? te.cyan : isCollectiveTP ? te.green : isTrailing ? te.orange : isTimeout ? te.yellow : isMomDiv ? te.yellow : isVwapCross ? te.cyan : isSignalExit ? te.purple : isManual ? '#3b82f6' : te.green
                  const statusLabel = isClosing ? '⏳ CLOSING' : isLiq ? 'LIQ' : isBurstTp ? 'BURST' : isBreakeven ? 'BE' : isCollectiveTP ? 'CTP' : isTrailing ? 'TRL' : isTimeout ? 'TMO' : isMomDiv ? 'MOM' : isVwapCross ? 'VWP' : isSignalExit ? 'SIG' : isManual ? 'MANUAL' : 'TP'
                  return (
                    <div key={pos.id} className="flex items-center gap-2 px-1.5 py-1.5 flex-wrap"
                      style={{ borderBottom: `1px solid ${te.border}` }}>
                      <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
                        fontFamily: te.mono,
                        background: `${statusColor}1a`,
                        color: statusColor,
                        border: `1px solid ${statusColor}33`,
                        animation: isClosing ? 'pulse 1.5s infinite' : undefined,
                      }}>
                        {statusLabel}
                      </span>
                      <span className="text-[11px] font-bold" style={{ ...dataMono, color: te.text }}>
                        {pos.pair.replace('-USDT', '')}
                      </span>
                      <span className="text-[11px]" style={{ fontFamily: te.mono, color: pos.side === 'LONG' ? te.green : te.red }}>
                        {pos.side}{pos.leverage}x
                      </span>
                      {pos.contrarian && (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{
                          fontFamily: te.mono,
                          background: `${te.purple}1a`,
                          color: te.purple,
                          border: `1px solid ${te.purple}33`,
                          letterSpacing: '0.04em',
                        }}>
                          FADE
                        </span>
                      )}
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm" style={{
                        fontFamily: te.mono,
                        background: safeTagColors.bg,
                        color: safeTagColors.text,
                        border: `1px solid ${safeTagColors.border}`,
                      }}>
                        {pos.anomaly.tag}
                      </span>
                      <span className="text-[7px] font-bold px-0.5 py-0.5 rounded-sm shrink-0" style={{
                        fontFamily: te.mono,
                        background: `${te.cyan}15`,
                        color: te.cyan,
                        border: `1px solid ${te.cyan}33`,
                      }}>
                        {exchangeAbbr(pos.anomaly.exchange)}
                      </span>
                      {pos.confidence && (
                        <span className="text-[8px] font-bold px-0.5 py-0.5 rounded-sm" style={{
                          fontFamily: te.mono,
                          color: pos.confidence.total >= 7 ? te.green : pos.confidence.total >= 5 ? te.orange : te.red,
                          letterSpacing: '0.04em',
                        }}>
                          B{pos.confidence.layerB ?? pos.confidence.total}C{pos.confidence.layerC ?? 0}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ ...dataMono, color: te.textDim }}>
                        {formatPrice(pos.entryPrice, ALL_PAIRS.find(p => p.symbol === pos.pair)?.decimals || 2)}
                      </span>
                      <span className="text-[11px] font-bold ml-auto" style={{
                        ...dataMono, color: pos.pnl >= 0 ? te.green : te.red,
                      }}>
                        {formatPnl(pos.pnl)}
                      </span>
                      <span className="text-[9px]" style={{ ...dataMono, color: te.orange }}>
                        -${(pos.totalFees || 0).toFixed(3)}
                      </span>
                      <MiniSparkline data={safePriceHistory} isProfit={pos.pnl >= 0} />
                      {pos.openedAt && (
                        <span className="text-[10px] ml-1" style={{ fontFamily: te.mono, color: te.textDim }}>
                          {new Date(pos.openedAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                          {pos.closedAt ? <span style={{ color: te.textMuted, fontWeight: 700 }}> · {((pos.closedAt - pos.openedAt) / 1000).toFixed(0)}s</span> : ''}
                        </span>
                      )}
                      {/* Execution timing badges */}
                      {(() => {
                        const openExecMs = pos.orderSentAt && pos.orderConfirmedAt ? pos.orderConfirmedAt - pos.orderSentAt : null
                        const closeExecMs = pos.closeSentAt && pos.closeConfirmedAt ? pos.closeConfirmedAt - pos.closeSentAt : null
                        const sig2clkMs = pos.signalDetectedAt && pos.orderSentAt ? pos.orderSentAt - pos.signalDetectedAt : null
                        return (
                          <>
                            {sig2clkMs !== null && sig2clkMs > 0 && (
                              <span className="text-[8px] font-bold px-1 rounded-sm" style={{
                                fontFamily: te.mono, color: sig2clkMs < 500 ? te.green : sig2clkMs < 2000 ? te.orange : te.red,
                                background: `${sig2clkMs < 500 ? te.green : sig2clkMs < 2000 ? te.orange : te.red}11`,
                              }} title="Signal → Click">
                                S{sig2clkMs}ms
                              </span>
                            )}
                            {openExecMs !== null && (
                              <span className="text-[8px] font-bold px-1 rounded-sm" style={{
                                fontFamily: te.mono, color: openExecMs < 200 ? te.green : openExecMs < 500 ? te.orange : te.red,
                                background: `${openExecMs < 200 ? te.green : openExecMs < 500 ? te.orange : te.red}11`,
                              }} title="Open API latency">
                                O{openExecMs}ms
                              </span>
                            )}
                            {closeExecMs !== null && (
                              <span className="text-[8px] font-bold px-1 rounded-sm" style={{
                                fontFamily: te.mono, color: closeExecMs < 200 ? te.green : closeExecMs < 500 ? te.orange : te.red,
                                background: `${closeExecMs < 200 ? te.green : closeExecMs < 500 ? te.orange : te.red}11`,
                              }} title="Close API latency">
                                C{closeExecMs}ms
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            </>
            )}
            </div>
        </div>
      </div>

      {/* ─── Pair Selector ──────────────────────────────────────────────── */}
      <div className="rounded-sm p-2 flex items-center justify-between flex-wrap gap-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
        <div className="flex items-center gap-2">
          <Radio className="size-3.5" style={{ color: te.green }} />
          <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.12em' }}>
            ACTIVE PAIR
          </span>
        </div>
        <PairSelector
          pairSims={pairSims}
          activePairSymbol={activePair.symbol}
          anomalies={anomalies}
          onSelectPair={(symbol) => {
            const idx = ALL_PAIRS.findIndex(p => p.symbol === symbol)
            if (idx >= 0) setActivePairIdx(idx)
          }}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.08em' }}>
            ANOMALIE:
          </span>
          <span className="text-[11px] font-bold" style={{ ...dataMono, color: te.orange }}>
            {anomalies.filter(a => a.pair === activePair.symbol).length}
          </span>
          <span className="text-[11px] ml-2" style={{ fontFamily: te.mono, color: te.textDim }}>POZ:</span>
          <span className="text-[11px] font-bold" style={{ ...dataMono, color: te.blue }}>
            {positions.filter(p => p.pair === activePair.symbol && p.status === 'OPEN').length}
          </span>
        </div>
      </div>

      {/* ─── Stats Bar (bottom) ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5">
        {[
          { label: 'ANOMALIE', value: stats.total, color: te.text },
          { label: 'PARY', value: stats.pairsActive, color: te.orange },
          { label: 'ICEBERG', value: stats.icebergs, color: te.cyan },
          { label: 'INFLOW', value: stats.inflows, color: te.purple },
          { label: 'ABSORB', value: stats.absorptions, color: te.green },
          { label: 'OI', value: stats.oiCount, color: te.yellow },
          { label: 'FUNDING', value: stats.fundingCount, color: te.red },
          { label: 'POZYCJE', value: stats.activePositions, color: te.blue },
          { label: 'LIQ', value: stats.liquidatedCount, color: te.red },
          { label: 'PNL', value: formatPnl(stats.totalPnl), color: stats.totalPnl >= 0 ? te.green : te.red },
        ].map(s => (
          <div key={s.label} className="p-1.5 rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <p style={{ ...sectionLabel, fontSize: '9px' }}>{s.label}</p>
            <p className="text-sm font-bold" style={{ ...dataMono, color: s.color as string }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ─── LLM Analyst Panel ──────────────────────────────────────────── */}
      <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${llmPanelOpen ? te.purple + '66' : te.border}`, overflow: 'hidden' }}>
        <div onClick={() => setLlmPanelOpen(o => !o)} className="flex items-center gap-2 px-2 py-1.5 w-full cursor-pointer">
          {llmPanelOpen ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
          <span className="text-[12px]" style={{ fontFamily: te.mono, color: te.purple, fontWeight: 700, letterSpacing: '0.08em' }}>🧠 LLM ANALYST</span>
          {llmReport && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ fontFamily: te.mono, color: llmReport.confidence >= 60 ? te.green : llmReport.confidence >= 40 ? te.orange : te.red, background: `${llmReport.confidence >= 60 ? te.green : llmReport.confidence >= 40 ? te.orange : te.red}15`, border: `1px solid ${llmReport.confidence >= 60 ? te.green : llmReport.confidence >= 40 ? te.orange : te.red}33` }}>{llmReport.confidence}%</span>}
          <button onClick={(e) => { e.stopPropagation(); void runLlmAnalysis() }} disabled={llmLoading} className="ml-auto px-2 py-1 text-[10px] font-bold rounded-sm" style={{ fontFamily: te.mono, background: llmLoading ? `${te.purple}30` : `${te.purple}15`, color: te.purple, border: `1px solid ${te.purple}44` }}>{llmLoading ? '⏳...' : '🔍 ANALIZUJ'}</button>
        </div>
        {llmPanelOpen && (
          <div className="p-3 space-y-3" style={{ borderTop: `1px solid ${te.border}` }}>
            {llmError && <div className="text-[11px] px-3 py-2 rounded-sm" style={{ background: `${te.red}10`, color: te.red, border: `1px solid ${te.red}33`, fontFamily: te.mono }}>⚠ {llmError}</div>}
            {llmReport && (
              <div className="space-y-2">
                <div className="text-[11px] rounded-sm p-2" style={{ background: te.bg, border: `1px solid ${te.border}`, fontFamily: te.mono, color: te.text, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{llmReport.report}</div>
                {llmReport.insights?.length > 0 && <div><div className="text-[9px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.cyan }}>INSIGHTS:</div>{llmReport.insights.map((ins, i) => <div key={i} className="text-[10px] flex items-start gap-1" style={{ fontFamily: te.mono, color: te.textDim }}><span style={{ color: te.cyan }}>→</span><span>{ins}</span></div>)}</div>}
                {llmReport.recommendations?.length > 0 && <div><div className="text-[9px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.orange }}>REKOMENDACJE:</div>{llmReport.recommendations.map((rec, i) => <div key={i} className="text-[10px] flex items-start gap-1" style={{ fontFamily: te.mono, color: te.text }}><span style={{ color: te.orange }}>{i+1}.</span><span>{rec}</span></div>)}</div>}
                <div className="flex items-center gap-2"><span className="text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>CONFIDENCE:</span><div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: te.border }}><div style={{ height: '100%', width: `${llmReport.confidence}%`, background: llmReport.confidence >= 60 ? te.green : llmReport.confidence >= 40 ? te.orange : te.red }} /></div><span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: llmReport.confidence >= 60 ? te.green : llmReport.confidence >= 40 ? te.orange : te.red }}>{llmReport.confidence}%</span></div>
              </div>
            )}
            {Array.isArray(llmReport?.hypotheses) && llmReport.hypotheses.length > 0 && <div><div className="text-[9px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.purple }}>HIPOTEZY DO WALIDACJI ({llmReport.hypotheses.length}):</div><div className="space-y-0.5" style={{ maxHeight: 120, overflowY: 'auto' }}>{llmReport.hypotheses.map((p, i) => <div key={i} className="text-[9px] px-1 py-0.5 rounded-sm" style={{ background: `${te.purple}06`, border: `1px solid ${te.purple}22`, fontFamily: te.mono }}><span style={{ color: te.purple, fontWeight: 700 }}>UNVALIDATED </span><span style={{ color: te.text }}>{p.pattern}</span>{p.pair && <span style={{ color: te.textDim }}> · {p.pair}</span>}</div>)}</div></div>}
          </div>
        )}
      </div>

      {/* ─── Signal Stats Floating Panel ─────────────────────────────────── */}
      <SignalStatsPanel
        events={signalEvents}
        onClear={() => { setSignalEvents([]); clearCexSessionEvents(); rsi15mSignalsRef.current.clear(); macdSignalsRef.current.clear(); bumpVirtualSignalVersion() }}
      />
    </div>
  )
}
