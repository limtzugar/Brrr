'use client'

// ─── Hurst Dashboard ────────────────────────────────────────────────────────
// Multi-timeframe Hurst Exponent + Bollinger Bands dashboard.
// Focus: MEXC Stock Futures — tokenized companies (NVDA, TSLA, AAPL…) 24/7.
// Price source: MEXC Futures WS (wss://contract.mexc.com/edge).
// SL/TP: client-side simulation (MEXC Futures API supports native SL/TP).
// TE design system — no return null, all hooks unconditional.

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { useTE } from '@/lib/te-theme'
import { TE } from '@/lib/te-tokens'
import { useMexcFuturesWS } from '@/hooks/use-mexc-futures-ws'
import {
  computeBB,
  computeEMA,
  computeHurst,
  computeHurstSlope,
  computeHurstSignal,
  computeHCCCO,
  computeHCCCOSignal,
  computeHurstStrategySignals,
  getHurstStrategyPhase,
  getLatestHurstStrategySignal,
  formatPrice,
} from '@/lib/cex-anomaly-helpers'
import type { HurstSignal, HurstSignalType, HCCCOResult, HCCCOSignal, HCCCOSignalType, HurstStrategySignal, BacktestResult, BacktestTrade } from '@/lib/cex-anomaly-helpers'
import { Loader2 } from 'lucide-react'
import { SignalStatsPanel } from '@/components/signal-stats-panel'
import HurstBBChartComponent from '@/components/cex-anomaly/hurst-bb-chart'
import {
  type SignalEvent,
  type CloseReason as SignalCloseReason,
  calculatePointsDelta,
  determineSignalType,
  getSessionId,
  loadSessionEvents,
  saveSessionEvents,
  clearSessionEvents,
} from '@/lib/signal-scoring'

// ─── Types ──────────────────────────────────────────────────────────────────

type AssetCategory = 'tech' | 'finance' | 'defense' | 'consumer' | 'etf' | 'crypto'

interface HurstAsset {
  symbol: string
  label: string
  category: AssetCategory
  decimals: number
  vol: number
  /** MEXC symbol — Stock Futures use TICKERUSDT (no suffix), Ondo uses TICKERON */
  mexcSymbol: string
  /** Company full name */
  fullName: string
}

type TimeframeKey = '1m' | '5m' | '15m' | '1h' | '4h' | '12h' | '1d'

interface TimeframeConfig {
  key: TimeframeKey
  label: string
  tickInterval: number
}

interface TimeframeData {
  hurst: (number | null)[]
  hurstSlope: number[]
  bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[]; upperInner: (number | null)[]; lowerInner: (number | null)[] }
  bb2: { ma: (number | null)[] }
  laggingSpan: (number | null)[]
  signal: HurstSignal
  hccco: HCCCOResult | null
  hcccoSignal: HCCCOSignal
}

interface OpenPosition {
  id: string
  pair: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  size: number
  timestamp: number
  hurstAtEntry: number
  bbPositionAtEntry: number
  leverage: number
  hcccoFastAtEntry: number
  hcccoSlowAtEntry: number
  slPct: number
  tpPct: number
  /** Which entry step: 1=BB lower, 2=Hurst cross 0.0 up, 3=2nd Hurst cross 0.0 up */
  entryStep: number
  /** Size multiplier: 1 for step 1, 2 for step 2, 4 for step 3 */
  sizeMultiplier: number
  /** Trade group ID — links entries 1/2/3 of the same trade */
  tradeGroupId: number
}

interface ClosedPosition extends OpenPosition {
  exitPrice: number
  pnl: number
  pnlPct: number
  fee: number
  closedAt: number
  closeReason: string
}

interface WalletState {
  startingBalance: number
  usdtBalance: number
}

// ─── Asset List ─────────────────────────────────────────────────────────────
// MEXC Stock Futures (TICKERUSDT) — 24/7 trading, USDT-margined perpetuals.
// Also includes key crypto for cross-reference.
// Stock Futures track real stock prices, tradeable 24/7 with no market hours.

const HURST_ASSETS: HurstAsset[] = [
  // ═══ TECH ════════════════════════════════════════════════════════════════
  // MEXC Spot uses XUSDT suffix for stock tokens, ONUSDT for "ON" tokens
  { symbol: 'NVDA-USDT',  label: 'NVDA',  category: 'tech', decimals: 2, vol: 0.0025, mexcSymbol: 'NVDAXUSDT',  fullName: 'NVIDIA' },
  { symbol: 'TSLA-USDT',  label: 'TSLA',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'TSLAXUSDT',  fullName: 'Tesla' },
  { symbol: 'AAPL-USDT',  label: 'AAPL',  category: 'tech', decimals: 2, vol: 0.0015, mexcSymbol: 'AAPLXUSDT',  fullName: 'Apple' },
  { symbol: 'MSFT-USDT',  label: 'MSFT',  category: 'tech', decimals: 2, vol: 0.0015, mexcSymbol: 'MSFTONUSDT', fullName: 'Microsoft' },
  { symbol: 'GOOGL-USDT', label: 'GOOGL', category: 'tech', decimals: 2, vol: 0.0018, mexcSymbol: 'GOOGLXUSDT', fullName: 'Alphabet/Google' },
  { symbol: 'META-USDT',  label: 'META',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'METAXUSDT',  fullName: 'Meta/Facebook' },
  { symbol: 'AMZN-USDT',  label: 'AMZN',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'AMZNXUSDT',  fullName: 'Amazon' },
  { symbol: 'AMD-USDT',   label: 'AMD',   category: 'tech', decimals: 2, vol: 0.0025, mexcSymbol: 'AMDONUSDT',  fullName: 'AMD' },
  { symbol: 'AVGO-USDT',  label: 'AVGO',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'AVGOONUSDT', fullName: 'Broadcom' },
  { symbol: 'ARM-USDT',   label: 'ARM',   category: 'tech', decimals: 2, vol: 0.0025, mexcSymbol: 'ARMONUSDT',  fullName: 'ARM Holdings' },
  { symbol: 'PLTR-USDT',  label: 'PLTR',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'PLTRONUSDT', fullName: 'Palantir' },
  { symbol: 'NFLX-USDT',  label: 'NFLX',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'NFLXONUSDT', fullName: 'Netflix' },
  { symbol: 'COIN-USDT',  label: 'COIN',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'COINXUSDT',  fullName: 'Coinbase' },
  { symbol: 'MSTR-USDT',  label: 'MSTR',  category: 'tech', decimals: 2, vol: 0.0035, mexcSymbol: 'MSTRONUSDT', fullName: 'MicroStrategy' },
  { symbol: 'HOOD-USDT',  label: 'HOOD',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'HOODONUSDT', fullName: 'Robinhood' },
  { symbol: 'CRWD-USDT',  label: 'CRWD',  category: 'tech', decimals: 2, vol: 0.0025, mexcSymbol: 'CRWDONUSDT', fullName: 'CrowdStrike' },
  { symbol: 'PANW-USDT',  label: 'PANW',  category: 'tech', decimals: 2, vol: 0.0025, mexcSymbol: 'PANWONUSDT', fullName: 'Palo Alto' },
  { symbol: 'SNOW-USDT',  label: 'SNOW',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'SNOWONUSDT', fullName: 'Snowflake' },
  { symbol: 'ADBE-USDT',  label: 'ADBE',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'ADBEONUSDT', fullName: 'Adobe' },
  { symbol: 'ORCL-USDT',  label: 'ORCL',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'ORCLONUSDT', fullName: 'Oracle' },
  { symbol: 'INTC-USDT',  label: 'INTC',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'INTCONUSDT', fullName: 'Intel' },
  { symbol: 'MRVL-USDT',  label: 'MRVL',  category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'MRVLONUSDT', fullName: 'Marvell' },
  { symbol: 'MU-USDT',    label: 'MU',    category: 'tech', decimals: 2, vol: 0.003,  mexcSymbol: 'MUONUSDT',   fullName: 'Micron' },
  { symbol: 'QCOM-USDT',  label: 'QCOM',  category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'QCOMONUSDT', fullName: 'Qualcomm' },
  { symbol: 'CRM-USDT',   label: 'CRM',   category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'CRMONUSDT',  fullName: 'Salesforce' },
  { symbol: 'NOW-USDT',   label: 'NOW',   category: 'tech', decimals: 2, vol: 0.002,  mexcSymbol: 'NOWONUSDT',  fullName: 'ServiceNow' },
  { symbol: 'RKLB-USDT',  label: 'RKLB',  category: 'tech', decimals: 2, vol: 0.004,  mexcSymbol: 'RKLBONUSDT', fullName: 'Rocket Lab' },
  { symbol: 'NBIS-USDT',  label: 'NBIS',  category: 'tech', decimals: 2, vol: 0.004,  mexcSymbol: 'NBISONUSDT', fullName: 'Nebius AI' },

  // ═══ FINANCE ════════════════════════════════════════════════════════════
  { symbol: 'JPM-USDT',   label: 'JPM',   category: 'finance', decimals: 2, vol: 0.0015, mexcSymbol: 'JPMONUSDT',  fullName: 'JPMorgan' },
  { symbol: 'PYPL-USDT',  label: 'PYPL',  category: 'finance', decimals: 2, vol: 0.002,  mexcSymbol: 'PYPLONUSDT', fullName: 'PayPal' },
  { symbol: 'SOFI-USDT',  label: 'SOFI',  category: 'finance', decimals: 2, vol: 0.003,  mexcSymbol: 'SOFIONUSDT', fullName: 'SoFi' },

  // ═══ DEFENSE & AERO ════════════════════════════════════════════════════
  { symbol: 'LMT-USDT',   label: 'LMT',   category: 'defense', decimals: 2, vol: 0.0012, mexcSymbol: 'LMTONUSDT',  fullName: 'Lockheed Martin' },
  { symbol: 'RTX-USDT',   label: 'RTX',   category: 'defense', decimals: 2, vol: 0.0015, mexcSymbol: 'RTXONUSDT',  fullName: 'RTX Corp' },
  { symbol: 'BA-USDT',    label: 'BA',    category: 'defense', decimals: 2, vol: 0.0025, mexcSymbol: 'BAONUSDT',   fullName: 'Boeing' },

  // ═══ CONSUMER ═══════════════════════════════════════════════════════════
  { symbol: 'MCD-USDT',   label: 'MCD',   category: 'consumer', decimals: 2, vol: 0.001,  mexcSymbol: 'MCDXUSDT',   fullName: 'McDonald\'s' },
  { symbol: 'NKE-USDT',   label: 'NKE',   category: 'consumer', decimals: 2, vol: 0.002,  mexcSymbol: 'NKEONUSDT',  fullName: 'Nike' },
  { symbol: 'UBER-USDT',  label: 'UBER',  category: 'consumer', decimals: 2, vol: 0.002,  mexcSymbol: 'UBERONUSDT', fullName: 'Uber' },
  { symbol: 'ABNB-USDT',  label: 'ABNB',  category: 'consumer', decimals: 2, vol: 0.003,  mexcSymbol: 'ABNBONUSDT', fullName: 'Airbnb' },
  { symbol: 'RIVN-USDT',  label: 'RIVN',  category: 'consumer', decimals: 2, vol: 0.004,  mexcSymbol: 'RIVNONUSDT', fullName: 'Rivian' },

  // ═══ ETF ═══════════════════════════════════════════════════════════════
  { symbol: 'SPY-USDT',   label: 'SPY',   category: 'etf', decimals: 2, vol: 0.001,  mexcSymbol: 'SPYXUSDT',   fullName: 'S&P 500 ETF' },
  { symbol: 'QQQ-USDT',   label: 'QQQ',   category: 'etf', decimals: 2, vol: 0.0012, mexcSymbol: 'QQQONUSDT',  fullName: 'Nasdaq-100 ETF' },
  { symbol: 'TQQQ-USDT',  label: 'TQQQ',  category: 'etf', decimals: 2, vol: 0.003,  mexcSymbol: 'TQQQONUSDT', fullName: 'UltraPro QQQ 3x' },

  // ═══ CRYPTO (benchmark) ════════════════════════════════════════════════
  { symbol: 'BTC-USDT',   label: 'BTC',   category: 'crypto', decimals: 0, vol: 0.0004, mexcSymbol: 'BTCUSDT',   fullName: 'Bitcoin' },
  { symbol: 'ETH-USDT',   label: 'ETH',   category: 'crypto', decimals: 0, vol: 0.0006, mexcSymbol: 'ETHUSDT',   fullName: 'Ethereum' },
  { symbol: 'SOL-USDT',   label: 'SOL',   category: 'crypto', decimals: 1, vol: 0.001,  mexcSymbol: 'SOLUSDT',   fullName: 'Solana' },
]

const CATEGORY_META: Record<AssetCategory, { label: string; icon: string; color: string }> = {
  tech:     { label: 'TECH',     icon: 'T',  color: TE.cyan },
  finance:  { label: 'FINANCE',  icon: '$',  color: TE.green },
  defense:  { label: 'DEFENSE',  icon: 'D',  color: TE.orange },
  consumer: { label: 'CONSUMER', icon: 'C',  color: TE.pink },
  etf:      { label: 'ETF',      icon: 'E',  color: TE.yellow },
  crypto:   { label: 'CRYPTO',   icon: 'B',  color: '#a855f7' },
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TIMEFRAMES: TimeframeConfig[] = [
  { key: '1m',  label: '1m',  tickInterval: 1 },
  { key: '5m',  label: '5m',  tickInterval: 5 },
  { key: '15m', label: '15m', tickInterval: 15 },
  { key: '1h',  label: '1h',  tickInterval: 60 },
  { key: '4h',  label: '4h',  tickInterval: 240 },
  { key: '12h', label: '12h', tickInterval: 720 },
  { key: '1d',  label: '1D',  tickInterval: 1440 },
]

const DEFAULT_BB_PERIOD = 34
const DEFAULT_BB_STD_DEV = 2.0
const DEFAULT_BB2_PERIOD = 89
const DEFAULT_BB2_STD_DEV = 1.0
const DEFAULT_HURST_PERIOD = 50
const POSITION_SIZE_PCT = 0.10
const STOP_LOSS_PCT = 0.02
const MEXC_TAKER_FEE = 0.0005 // 0.05% per side (taker) — round-trip = 0.10%
const MAX_PRICE_HISTORY = 500
const MAX_POSITIONS = 7
const MAX_CLOSED_POSITIONS = 200
// Auto-trade dedup: event-based (each crossover → one position), no time cooldown
const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50, 100, 125]
const HURST_TRADE_HISTORY_KEY = 'hurst_trade_history'

// LazyBear TradingView defaults: scl=10, mcl=30, scm=1.0, mcm=3.0
const HCCCO_SHORT_CYCLE = 10
const HCCCO_MED_CYCLE = 30
const HCCCO_SHORT_MULT = 1.0
const HCCCO_MED_MULT = 3.0

const TF_TO_MINUTES: Record<TimeframeKey, number> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '12h': 720, '1d': 1440,
}

const SIGNAL_COLORS: Record<HurstSignalType, { text: string; bg: string }> = {
  UNDERVALUED:  { text: TE.green,  bg: TE.greenBg },
  OVERVALUED:   { text: TE.red,    bg: TE.redBg },
  'TREND-UP':   { text: TE.cyan,   bg: TE.cyanBg },
  'TREND-DOWN': { text: TE.orange, bg: `${TE.orange}1a` },
  EXHAUSTION:   { text: TE.yellow, bg: TE.yellowBg },
  NEUTRAL:      { text: TE.textDim, bg: 'transparent' },
}

const HCCCO_SIGNAL_COLORS: Record<HCCCOSignalType, { text: string; bg: string }> = {
  OVERBOUGHT:   { text: TE.red,    bg: TE.redBg },
  OVERSOLD:     { text: TE.green,  bg: TE.greenBg },
  BULL_CROSS:   { text: TE.cyan,   bg: TE.cyanBg },
  BEAR_CROSS:   { text: TE.orange, bg: `${TE.orange}1a` },
  OS_CROSS_UP:  { text: TE.green,  bg: TE.greenBg },
  OB_CROSS_DOWN:{ text: TE.red,    bg: TE.redBg },
  NEUTRAL:      { text: TE.textDim, bg: 'transparent' },
}

let _idSeq = 0
function uid(): string { return `ht-${Date.now()}-${++_idSeq}` }

function getSignalIcon(type: HurstSignalType): string {
  switch (type) {
    case 'UNDERVALUED': return '▲'
    case 'OVERVALUED':  return '▼'
    case 'TREND-UP':    return '⬆'
    case 'TREND-DOWN':  return '⬇'
    case 'EXHAUSTION':  return '⚡'
    case 'NEUTRAL':     return '—'
    default:            return '—'
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatPnl(v: number): string { const sign = v >= 0 ? '+' : ''; return `${sign}$${v.toFixed(2)}` }
function formatPct(v: number): string { const sign = v >= 0 ? '+' : ''; return `${sign}${v.toFixed(2)}%` }

// ─── Mini Components ────────────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  const te = useTE()
  return (
    <div className="flex flex-col items-center px-2">
      <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em', fontFamily: te.mono }}>{label}</span>
      <span className="text-[11px] font-bold" style={{ color, fontFamily: te.mono }}>{value}</span>
    </div>
  )
}

function ParamControl({ label, value, min, max, step, onChange, te, suffix }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; te: ReturnType<typeof useTE>; suffix?: string
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono }}>{label}</span>
      <div className="flex items-center gap-1">
        <input type="range" min={min} max={max} step={step || 1} value={value} onChange={e => onChange(Number(e.target.value))} className="signaly-slider w-16 cursor-pointer" style={{ accentColor: te.cyan }} />
        <span className="text-[10px] font-bold w-10 text-right" style={{ color: te.text, fontFamily: te.mono }}>{step && step < 1 ? value.toFixed(1) : value}{suffix || ''}</span>
      </div>
    </div>
  )
}

// ─── Inline Hurst + BB SVG Chart ────────────────────────────────────────────

function HurstChartSVG({
  prices, bb, bb2, laggingSpan, hurstValues, hurstSmoothed, signal, decimals, pairSymbol, te, openPositions,
}: {
  prices: number[]; bb: { ma: (number | null)[]; upper: (number | null)[]; lower: (number | null)[]; upperInner: (number | null)[]; lowerInner: (number | null)[] }; bb2: { ma: (number | null)[] }
  laggingSpan: (number | null)[]
  hurstValues: (number | null)[]; hurstSmoothed: number[]; signal: HurstSignal; decimals: number; pairSymbol: string
  te: ReturnType<typeof useTE>
  openPositions: { side: 'LONG' | 'SHORT'; entryPrice: number; slPct: number; tpPct: number }[]
}) {
  const w = 700, h = 340, priceH = h * 0.44, hurstH = h * 0.40, pad = 12, botPad = 28
  // Show only last MAX_VISIBLE bars to keep chart readable — prevents BB compression
  const MAX_VISIBLE = 80
  const fullN = prices.length
  const startIdx = Math.max(0, fullN - MAX_VISIBLE)
  const visPrices = prices.slice(startIdx)
  const visBB: typeof bb = { ma: bb.ma.slice(startIdx), upper: bb.upper.slice(startIdx), lower: bb.lower.slice(startIdx), upperInner: bb.upperInner.slice(startIdx), lowerInner: bb.lowerInner.slice(startIdx) }
  const visBB2: typeof bb2 = { ma: bb2.ma.slice(startIdx) }
  const visLaggingSpan = laggingSpan.slice(startIdx)
  const visHurstValues = hurstValues.slice(startIdx)
  const visHurstSmoothed = hurstSmoothed.slice(startIdx)
  const displayN = visPrices.length
  const [hoverSvgX, setHoverSvgX] = useState<number | null>(null)
  if (displayN < 2) {
    // Show live price even while accumulating + progress indicator
    const livePrice = openPositions.length > 0 ? openPositions[0].entryPrice : 0
    const needsBars = 89 // need 89 bars for BB2(89) computation
    const progressPct = Math.min(100, (displayN / needsBars) * 100)
    return (
      <div className="rounded-sm p-3 flex flex-col items-center justify-center gap-2" style={{ background: te.bgCard, border: `1px solid ${te.border}`, height: h + 60, overflow: 'hidden' }}>
        <span className="text-[11px] flex items-center gap-2" style={{ color: te.cyan, fontFamily: te.mono }}>
          <Loader2 className="size-3 animate-spin" style={{ color: te.cyan }} />Init Hurst + BB
        </span>
        <span className="text-[9px]" style={{ color: te.text, fontFamily: te.mono }}>
          {pairSymbol} {livePrice > 0 ? formatPrice(livePrice, decimals) : '—'}
        </span>
        {/* Progress bar */}
        <div className="w-48 h-1.5 rounded-full" style={{ background: te.border }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: te.cyan }} />
        </div>
        <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>
          {displayN}/{needsBars} bars — need {needsBars} for Hurst computation
        </span>
        <span className="text-[7px]" style={{ color: te.textDim, fontFamily: te.mono }}>
          Waiting for live price data via WebSocket...
        </span>
      </div>
    )
  }

  const sma = (arr: number[], factor: number): number[] => {
    if (arr.length === 0) return []
    const result: number[] = [arr[0]]
    for (let i = 1; i < arr.length; i++) result.push(arr[i] * factor + result[i - 1] * (1 - factor))
    return result
  }

  const sPrices = sma(visPrices, 0.8)
  const bbUpperNum = visBB.upper.map((v, i) => v ?? visPrices[i])
  const bbLowerNum = visBB.lower.map((v, i) => v ?? visPrices[i])
  const bbMANum = visBB.ma.map((v, i) => v ?? visPrices[i])
  const sBBUpper = sma(bbUpperNum, 0.8), sBBLower = sma(bbLowerNum, 0.8), sBBMA = sma(bbMANum, 0.8)
  // BB inner band (1.0 StdDev)
  const bbUpperInnerNum = visBB.upperInner.map((v, i) => v ?? visPrices[i])
  const bbLowerInnerNum = visBB.lowerInner.map((v, i) => v ?? visPrices[i])
  const sBBUpperInner = sma(bbUpperInnerNum, 0.8), sBBLowerInner = sma(bbLowerInnerNum, 0.8)
  // BB2 — EMA(89) basis line only (no upper/lower bands)
  const bb2MANum = visBB2.ma.map((v, i) => v ?? visPrices[i])
  const sBB2MA = sma(bb2MANum, 0.8)
  // Lagging Span — close shifted by 25 bars
  const laggingSpanNum = visLaggingSpan.map((v, i) => v ?? visPrices[i])
  const sLaggingSpan = sma(laggingSpanNum, 0.8)
  const sHurst = visHurstSmoothed.length > 0 ? sma(visHurstSmoothed, 0.5) : []

  const validBBUpper = sBBUpper.filter((_, i) => visBB.upper[i] !== null)
  const validBBLower = sBBLower.filter((_, i) => visBB.lower[i] !== null)
  const validBB2MA = sBB2MA.filter((_, i) => visBB2.ma[i] !== null)
  const rawMinPrice = Math.min(...validBBLower, ...sPrices)
  const rawMaxPrice = Math.max(...validBBUpper, ...validBB2MA, ...sPrices)
  const rawPriceRange = rawMaxPrice - rawMinPrice || 1
  const pricePad = rawPriceRange * 0.05
  const minPrice = rawMinPrice - pricePad, maxPrice = rawMaxPrice + pricePad, priceRange = maxPrice - minPrice || 1
  const chartW = w - pad * 2
  const xAt = (di: number) => pad + (di / (displayN - 1)) * chartW
  const priceY = (price: number) => pad + (priceH - pad * 2) - ((price - minPrice) / priceRange) * (priceH - pad * 2)

  const hurstYMin = 0.20, hurstYMax = 0.85, hurstYRange = hurstYMax - hurstYMin
  const hurstY = (hv: number) => priceH + pad + (hurstH - pad) - ((Math.min(Math.max(hv, hurstYMin), hurstYMax) - hurstYMin) / hurstYRange) * (hurstH - pad * 2)

  const pricePath = sPrices.map((price, di) => `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(price).toFixed(1)}`).join(' ')
  const bbUpperPath = sBBUpper.map((v, di) => visBB.upper[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
  const bbLowerPath = sBBLower.map((v, di) => visBB.lower[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
  const maPath = sBBMA.map((v, di) => visBB.ma[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  const firstValidBB = visBB.upper.findIndex(v => v !== null)
  const bbFillPath = (() => {
    if (firstValidBB < 0) return ''
    const up = sBBUpper.slice(firstValidBB).map((v, di) => visBB.upper[firstValidBB + di] !== null ? `L${xAt(firstValidBB + di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
    const lo = sBBLower.slice(firstValidBB).map((v, di) => visBB.lower[firstValidBB + di] !== null ? `L${xAt(firstValidBB + di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).reverse().join(' ')
    return `M${xAt(firstValidBB).toFixed(1)},${priceY(sBBUpper[firstValidBB]).toFixed(1)} ${up} ${lo} Z`
  })()

  // BB inner band paths (1.0 StdDev — green)
  const bbUpperInnerPath = sBBUpperInner.map((v, di) => visBB.upperInner[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
  const bbLowerInnerPath = sBBLowerInner.map((v, di) => visBB.lowerInner[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
  const bbInnerFillPath = (() => {
    const firstV = visBB.upperInner.findIndex(v => v !== null)
    if (firstV < 0) return ''
    const up = sBBUpperInner.slice(firstV).map((v, di) => visBB.upperInner[firstV + di] !== null ? `L${xAt(firstV + di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')
    const lo = sBBLowerInner.slice(firstV).map((v, di) => visBB.lowerInner[firstV + di] !== null ? `L${xAt(firstV + di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).reverse().join(' ')
    return `M${xAt(firstV).toFixed(1)},${priceY(sBBUpperInner[firstV]).toFixed(1)} ${up} ${lo} Z`
  })()

  // BB2 — EMA(89) basis line path (yellow)
  const bb2MAPath = sBB2MA.map((v, di) => visBB2.ma[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  // Lagging Span path (yellow, shifted 25 bars into past)
  const laggingSpanPath = sLaggingSpan.map((v, di) => visLaggingSpan[di] !== null ? `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  const firstValidH = visHurstValues.findIndex(v => v !== null)
  const hurstPath = sHurst.length > 0 ? sHurst.map((v, di) => visHurstValues[di] !== null ? `${di === firstValidH ? 'M' : 'L'}${xAt(di).toFixed(1)},${hurstY(v).toFixed(1)}` : '').filter(Boolean).join(' ') : ''

  const currentPrice = sPrices[displayN - 1]
  const currentHurst = sHurst.length > 0 ? sHurst[displayN - 1] : null
  const currentSlope = visHurstSmoothed.length > 1 ? visHurstSmoothed[displayN - 1] - visHurstSmoothed[Math.max(0, displayN - 6)] : 0

  const hurstColor = currentHurst !== null
    ? currentHurst < 0.40 ? te.green : currentHurst < 0.45 ? '#22c55e99' : currentHurst > 0.60 ? te.red : currentHurst > 0.55 ? te.orange : te.textDim
    : te.textDim

  const sigStyle = SIGNAL_COLORS[signal.type]

  return (
    <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}`, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 mb-1" style={{ flexWrap: 'nowrap', minHeight: 18 }}>
        <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.cyan, letterSpacing: '0.1em' }}>HURST + BB</span>
        <span className="text-[10px] font-bold px-1 py-0.5 rounded-sm" style={{ background: `${te.cyan}1a`, color: te.cyan, border: `1px solid ${te.cyan}33`, fontFamily: te.mono }}>{pairSymbol}</span>
        {signal.type !== 'NEUTRAL' && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ background: sigStyle.bg, color: sigStyle.text, border: `1px solid ${sigStyle.text}33` }}>
            {getSignalIcon(signal.type)} {signal.type}
          </span>
        )}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>{displayN}pts</span>
          <span className="text-[9px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: hurstColor }}>H={currentHurst !== null ? currentHurst.toFixed(2) : '...'}</span>
            <span className="ml-1" style={{ color: currentSlope > 0.02 ? te.green : currentSlope < -0.02 ? te.red : te.textDim, fontWeight: 700 }}>
              {currentSlope > 0.02 ? '↑' : currentSlope < -0.02 ? '↓' : '→'}
            </span>
          </span>
        </div>
      </div>
      {signal.type !== 'NEUTRAL' && <div className="mb-1 text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>{signal.description}</div>}

      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ fontFamily: te.mono, cursor: 'crosshair' }}
        onMouseMove={(e) => {
          const svg = e.currentTarget
          const ctm = svg.getScreenCTM()
          if (ctm) {
            const pt = svg.createSVGPoint()
            pt.x = e.clientX
            pt.y = e.clientY
            const svgPt = pt.matrixTransform(ctm.inverse())
            setHoverSvgX(svgPt.x)
          }
        }}
        onMouseLeave={() => setHoverSvgX(null)}
      >
        <defs><linearGradient id="hbbFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={te.cyan} stopOpacity={0.08} /><stop offset="50%" stopColor={te.cyan} stopOpacity={0.04} /><stop offset="100%" stopColor={te.cyan} stopOpacity={0.08} /></linearGradient></defs>
        <line x1={pad} y1={priceH + pad * 0.5} x2={w - pad} y2={priceH + pad * 0.5} stroke={te.borderLight} strokeWidth={0.5} strokeDasharray="2,4" />
        <text x={pad} y={pad + 8} fontSize={7} fill={te.textDim} fontWeight={700}>PRICE + BB</text>
        <text x={pad} y={priceH + pad * 0.5 + 9} fontSize={7} fill={te.cyan} fontWeight={700} opacity={0.7}>HURST + dH/dt</text>
        {bbFillPath && <path d={bbFillPath} fill={te.cyan} fillOpacity={0.04} />}
        {/* BB1 outer — (34, 2.0) solid cyan lines */}
        {bbUpperPath && <path d={bbUpperPath} fill="none" stroke={te.cyan} strokeWidth={1.2} opacity={0.7} />}
        {bbLowerPath && <path d={bbLowerPath} fill="none" stroke={te.cyan} strokeWidth={1.2} opacity={0.7} />}
        {maPath && <path d={maPath} fill="none" stroke="#FFFFFF" strokeWidth={0.8} opacity={0.5} />}
        {/* BB1 inner — (34, 1.0) green lines + fill */}
        {bbInnerFillPath && <path d={bbInnerFillPath} fill="#2196F3" fillOpacity={0.06} />}
        {bbUpperInnerPath && <path d={bbUpperInnerPath} fill="none" stroke="#358A5E" strokeWidth={0.8} opacity={0.6} />}
        {bbLowerInnerPath && <path d={bbLowerInnerPath} fill="none" stroke="#358A5E" strokeWidth={0.8} opacity={0.6} />}
        {/* BB2 — EMA(89) basis line (yellow, linewidth 2) */}
        {bb2MAPath && <path d={bb2MAPath} fill="none" stroke="#FFFF00" strokeWidth={2.0} opacity={0.7} />}
        {/* Lagging Span — close shifted by 25 bars (yellow) */}
        {laggingSpanPath && <path d={laggingSpanPath} fill="none" stroke="#FFFF00" strokeWidth={1.0} opacity={0.4} strokeDasharray="4,3" />}
        <path d={pricePath} fill="none" stroke={te.text} strokeWidth={1.5} />
        {sPrices.map((price, di) => visBB.lower[di] !== null && price < sBBLower[di] ? <circle key={`bl-${di}`} cx={xAt(di)} cy={priceY(price)} r={2.5} fill={te.green} opacity={0.8} /> : null)}
        {sPrices.map((price, di) => visBB.upper[di] !== null && price > sBBUpper[di] ? <circle key={`bu-${di}`} cx={xAt(di)} cy={priceY(price)} r={2.5} fill={te.orange} opacity={0.8} /> : null)}
        <line x1={pad} y1={hurstY(0.45)} x2={w - pad} y2={hurstY(0.45)} stroke={te.green} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4} />
        <text x={pad + 3} y={hurstY(0.45) - 2} fontSize={7} fill={te.green} opacity={0.7} fontWeight={700}>H=0.45</text>
        <line x1={pad} y1={hurstY(0.65)} x2={w - pad} y2={hurstY(0.65)} stroke={te.orange} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4} />
        <text x={pad + 3} y={hurstY(0.65) + 9} fontSize={7} fill={te.orange} opacity={0.7} fontWeight={700}>H=0.65</text>
        {/* ── Hurst trigger thresholds: H=0.0 (LONG) and H=1.0 (SHORT) ── */}
        <line x1={pad} y1={hurstY(0.0)} x2={w - pad} y2={hurstY(0.0)} stroke={te.green} strokeWidth={1.0} strokeDasharray="4,2" opacity={0.7} />
        <text x={w - pad - 3} y={hurstY(0.0) - 2} fontSize={7} fill={te.green} textAnchor="end" fontWeight={700} opacity={0.9}>H=0.0 LONG</text>
        <line x1={pad} y1={hurstY(1.0)} x2={w - pad} y2={hurstY(1.0)} stroke={te.red} strokeWidth={1.0} strokeDasharray="4,2" opacity={0.7} />
        <text x={w - pad - 3} y={hurstY(1.0) + 9} fontSize={7} fill={te.red} textAnchor="end" fontWeight={700} opacity={0.9}>H=1.0 SHORT</text>
        {(() => { if (firstValidH < 0) return null; const p: string[] = []; for (let di = firstValidH; di < displayN; di++) { if (visHurstValues[di] !== null) p.push(`${di === firstValidH ? 'M' : 'L'}${xAt(di).toFixed(1)},${hurstY(Math.min(sHurst[di], 0.45)).toFixed(1)}`) } if (p.length > 0) { for (let di = displayN - 1; di >= firstValidH; di--) { if (visHurstValues[di] !== null) p.push(`L${xAt(di).toFixed(1)},${hurstY(0.45).toFixed(1)}`) } p.push('Z') } return p.length > 0 ? <path d={p.join(' ')} fill={te.green} opacity={0.12} /> : null })()}
        {(() => { if (firstValidH < 0) return null; const p: string[] = []; for (let di = firstValidH; di < displayN; di++) { if (visHurstValues[di] !== null) p.push(`${di === firstValidH ? 'M' : 'L'}${xAt(di).toFixed(1)},${hurstY(Math.max(sHurst[di], 0.65)).toFixed(1)}`) } if (p.length > 0) { for (let di = displayN - 1; di >= firstValidH; di--) { if (visHurstValues[di] !== null) p.push(`L${xAt(di).toFixed(1)},${hurstY(0.65).toFixed(1)}`) } p.push('Z') } return p.length > 0 ? <path d={p.join(' ')} fill={te.orange} opacity={0.12} /> : null })()}
        {hurstPath && <path d={hurstPath} fill="none" stroke={hurstColor} strokeWidth={1.5} opacity={0.9} />}
        {currentHurst !== null && <circle cx={xAt(displayN - 1)} cy={hurstY(currentHurst)} r={3} fill={hurstColor} stroke={te.bg} strokeWidth={0.5} />}
        {/* ── Entry / TP / SL thin lines for open positions ── */}
        {openPositions.map((pos, pi) => {
          const entryY = priceY(pos.entryPrice)
          const slPrice = pos.side === 'LONG' ? pos.entryPrice * (1 - pos.slPct / 100) : pos.entryPrice * (1 + pos.slPct / 100)
          const tpPrice = pos.side === 'LONG' ? pos.entryPrice * (1 + pos.tpPct / 100) : pos.entryPrice * (1 - pos.tpPct / 100)
          const slY = priceY(slPrice)
          const tpY = priceY(tpPrice)
          const labelX = w - pad - 2
          return (
            <g key={`pos-${pi}`}>
              {/* Entry line — thin cyan dashed */}
              <line x1={pad} y1={entryY} x2={w - pad} y2={entryY} stroke={te.cyan} strokeWidth={0.6} strokeDasharray="4,3" opacity={0.7} />
              <text x={labelX} y={entryY - 2} fontSize={6} fill={te.cyan} textAnchor="end" fontWeight={600} opacity={0.8}>ENTRY {formatPrice(pos.entryPrice, decimals)}</text>
              {/* SL line — thin red dashed */}
              <line x1={pad} y1={slY} x2={w - pad} y2={slY} stroke={te.red} strokeWidth={0.5} strokeDasharray="3,4" opacity={0.6} />
              <text x={labelX} y={slY - 2} fontSize={6} fill={te.red} textAnchor="end" fontWeight={600} opacity={0.7}>SL {formatPrice(slPrice, decimals)}</text>
              {/* TP line — thin green dashed */}
              <line x1={pad} y1={tpY} x2={w - pad} y2={tpY} stroke={te.green} strokeWidth={0.5} strokeDasharray="3,4" opacity={0.6} />
              <text x={labelX} y={tpY - 2} fontSize={6} fill={te.green} textAnchor="end" fontWeight={600} opacity={0.7}>TP {formatPrice(tpPrice, decimals)}</text>
            </g>
          )
        })}
        <text x={w - pad} y={pad + 10} fontSize={10} fill={te.text} textAnchor="end" fontWeight={700}>{formatPrice(currentPrice, decimals)}</text>
        <text x={w - pad} y={priceH + pad * 0.5 + 10} fontSize={8} fill={hurstColor} textAnchor="end" fontWeight={700}>H {currentHurst !== null ? currentHurst.toFixed(2) : '...'}</text>
        {/* ── Crosshair on hover ── */}
        {hoverSvgX !== null && (() => {
          const chartW = w - pad * 2
          const di = Math.round(((hoverSvgX - pad) / chartW) * (displayN - 1))
          if (di < 0 || di >= displayN) return null
          const cx = xAt(di)
          const hPrice = sPrices[di]
          const hHurst = sHurst.length > di ? sHurst[di] : null
          const hHurstVal = visHurstValues[di]
          return (
            <g opacity={0.9}>
              {/* Vertical crosshair line */}
              <line x1={cx} y1={pad} x2={cx} y2={h - pad} stroke={te.textDim} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5} />
              {/* Horizontal line at price level */}
              <line x1={pad} y1={priceY(hPrice)} x2={w - pad} y2={priceY(hPrice)} stroke={te.textDim} strokeWidth={0.4} strokeDasharray="2,4" opacity={0.3} />
              {/* Price dot on line */}
              <circle cx={cx} cy={priceY(hPrice)} r={3} fill={te.text} stroke={te.bg} strokeWidth={0.8} />
              {/* Price label box — right side */}
              <rect x={w - pad - 62} y={priceY(hPrice) - 8} width={60} height={16} rx={3} fill={te.bg} stroke={te.textDim} strokeWidth={0.5} opacity={0.9} />
              <text x={w - pad - 4} y={priceY(hPrice) + 4} fontSize={9} fill={te.text} textAnchor="end" fontWeight={700}>{formatPrice(hPrice, decimals)}</text>
              {/* Hurst dot on hurst line */}
              {hHurstVal !== null && hHurst !== null && (
                <>
                  <circle cx={cx} cy={hurstY(hHurst)} r={3} fill={hurstColor} stroke={te.bg} strokeWidth={0.8} />
                  {/* Hurst label box — right side */}
                  <rect x={w - pad - 52} y={hurstY(hHurst) - 8} width={50} height={16} rx={3} fill={te.bg} stroke={te.textDim} strokeWidth={0.5} opacity={0.9} />
                  <text x={w - pad - 4} y={hurstY(hHurst) + 4} fontSize={9} fill={hurstColor} textAnchor="end" fontWeight={700}>H {hHurst.toFixed(2)}</text>
                </>
              )}
              {/* Bar index label — top left area */}
              <text x={cx + 4} y={pad + 8} fontSize={7} fill={te.textDim} fontWeight={600}>#{di}</text>
            </g>
          )
        })()}
        {/* ── Time labels at bottom ── */}
        {(() => {
          const now = Date.now()
          const barMs = 15 * 60 * 1000 // 15m bars
          const labelCount = Math.min(8, displayN)
          const step = Math.max(1, Math.floor(displayN / labelCount))
          const labels: { di: number; time: string; date: string }[] = []
          for (let i = 0; i < displayN; i += step) {
            const barTime = now - (displayN - 1 - i) * barMs
            const d = new Date(barTime)
            const hh = String(d.getHours()).padStart(2, '0')
            const mm = String(d.getMinutes()).padStart(2, '0')
            const mo = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            labels.push({ di: i, time: `${hh}:${mm}`, date: `${mo}/${dd}` })
          }
          const lastD = new Date(now)
          labels.push({ di: displayN - 1, time: `${String(lastD.getHours()).padStart(2, '0')}:${String(lastD.getMinutes()).padStart(2, '0')}`, date: `${String(lastD.getMonth() + 1).padStart(2, '0')}/${String(lastD.getDate()).padStart(2, '0')}` })
          const bottomY = h - 4
          return labels.map((l, i) => (
            <g key={`t-${i}`}>
              <text x={xAt(l.di)} y={bottomY - 8} fontSize={7} fill={te.textDim} textAnchor="middle" opacity={0.6}>{l.date}</text>
              <text x={xAt(l.di)} y={bottomY} fontSize={7} fill={te.textDim} textAnchor="middle" opacity={0.8}>{l.time}</text>
            </g>
          ))
        })()}
      </svg>
    </div>
  )
}

// ─── HCCCO Oscillator SVG Panel ─────────────────────────────────────────────

function HCCCOOscSVG({
  fastOsc, slowOsc, te, pairSymbol, intervalMin, tfKey, onTfChange,
}: {
  fastOsc: number[]; slowOsc: number[]; te: ReturnType<typeof useTE>; pairSymbol: string; intervalMin: number
  tfKey: TimeframeKey; onTfChange: (tf: TimeframeKey) => void
}) {
  const w = 700, h = 420, pad = 24, topPad = 22, botPad = 34
  // Cap visible bars to keep chart readable — same as HurstChartSVG
  const MAX_VISIBLE = 80
  const fullN = fastOsc.length
  const startIdx = Math.max(0, fullN - MAX_VISIBLE)
  const visFast = fastOsc.slice(startIdx)
  const visSlow = slowOsc.slice(startIdx)
  const displayN = visFast.length
  const [hoverSvgX, setHoverSvgX] = useState<number | null>(null)
  if (displayN < 2) return <div />

  const chartW = w - pad * 2
  const chartH = h - topPad - botPad
  const xAt = (di: number) => pad + (di / (displayN - 1)) * chartW
  // Dynamic Y range: compute from actual data so nothing gets clipped
  const allVals = [...visFast, ...visSlow]
  const dataMin = Math.min(...allVals)
  const dataMax = Math.max(...allVals)
  // Ensure 0.0 and 1.0 reference lines are always visible
  const neededMin = Math.min(dataMin, -0.05)
  const neededMax = Math.max(dataMax, 1.05)
  // Add 20% headroom on each side so extreme OB/OS never clips
  const rawRange = neededMax - neededMin
  const headroom = rawRange * 0.20
  const oscMin = neededMin - headroom
  const oscMax = neededMax + headroom
  const oscRange = oscMax - oscMin
  const oscY = (v: number) => topPad + chartH - ((v - oscMin) / oscRange) * chartH

  const fastPath = visFast.map((v, di) => `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${oscY(v).toFixed(1)}`).join(' ')
  const slowPath = visSlow.map((v, di) => `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${oscY(v).toFixed(1)}`).join(' ')

  const currentFast = visFast[displayN - 1]
  const currentSlow = visSlow[displayN - 1]
  const fastColor = currentFast > 1.0 ? '#a855f7' : currentFast < 0.0 ? '#a855f7' : currentFast > 0.5 ? te.red : te.green

  return (
    <div className="rounded-sm p-2 mt-1" style={{ background: te.bgCard, border: `1px solid ${te.border}`, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 mb-1" style={{ minHeight: 14 }}>
        <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: '#a855f7', letterSpacing: '0.08em' }}>HCCCO_LB</span>
        <span className="text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>Hurst Cycle Channel Clone</span>
        {/* ── Timeframe selector buttons ── */}
        <div className="flex items-center gap-0.5 ml-2">
          {TIMEFRAMES.map(tf => {
            const isActive = tf.key === tfKey
            return (
              <button
                key={tf.key}
                onClick={() => onTfChange(tf.key)}
                className="px-1.5 py-0.5 text-[8px] font-bold rounded-sm cursor-pointer transition-all"
                style={{
                  fontFamily: te.mono,
                  background: isActive ? `${'#a855f7'}1a` : 'transparent',
                  color: isActive ? '#a855f7' : te.textDim,
                  border: `1px solid ${isActive ? '#a855f7' : te.border}`,
                  letterSpacing: '0.04em',
                }}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>{displayN}pts</span>
          <span className="text-[9px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: te.red }}>oshort</span>
            <span className="inline-block w-5 h-0.5 ml-0.5 align-middle" style={{ background: te.red }} />
            <span className="ml-1" style={{ color: te.red, fontWeight: 700 }}>{currentFast.toFixed(2)}</span>
          </span>
          <span className="text-[9px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: te.green }}>omed</span>
            <span className="inline-block w-5 h-0.5 ml-0.5 align-middle" style={{ background: te.green }} />
            <span className="ml-1" style={{ color: te.green, fontWeight: 700 }}>{currentSlow.toFixed(2)}</span>
          </span>
          <span className="text-[9px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: '#a855f7' }}>OB/OS</span>
            <span className="inline-block w-3 h-2 ml-0.5 align-middle rounded-sm" style={{ background: '#a855f7', opacity: 0.5 }} />
          </span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ fontFamily: te.mono, cursor: 'crosshair' }}
        onMouseMove={(e) => {
          const svg = e.currentTarget
          const ctm = svg.getScreenCTM()
          if (ctm) {
            const pt = svg.createSVGPoint()
            pt.x = e.clientX
            pt.y = e.clientY
            const svgPt = pt.matrixTransform(ctm.inverse())
            setHoverSvgX(svgPt.x)
          }
        }}
        onMouseLeave={() => setHoverSvgX(null)}
      >
        {/* Clip path to keep chart content inside the padded area */}
        <defs>
          <clipPath id="hccco-clip">
            <rect x={pad} y={topPad} width={chartW} height={chartH} />
          </clipPath>
        </defs>
        {/* Zone fills: green below 0.5, red above 0.5 */}
        <rect x={pad} y={oscY(1.0)} width={chartW} height={oscY(0.5) - oscY(1.0)} fill={te.red} opacity={0.04} />
        <rect x={pad} y={oscY(0.5)} width={chartW} height={oscY(0.0) - oscY(0.5)} fill={te.green} opacity={0.04} />

        {/* Reference lines: 0.0, 0.5, 1.0 */}
        <line x1={pad} y1={oscY(1.0)} x2={w - pad} y2={oscY(1.0)} stroke={te.red} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.4} />
        <line x1={pad} y1={oscY(0.5)} x2={w - pad} y2={oscY(0.5)} stroke={te.textDim} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.3} />
        <line x1={pad} y1={oscY(0.0)} x2={w - pad} y2={oscY(0.0)} stroke={te.green} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.4} />

        {/* Labels — positioned inside chart area to avoid clipping */}
        <text x={pad + 2} y={oscY(1.0) + 12} fontSize={9} fill={te.red} opacity={0.7} fontWeight={700}>OB 1.0</text>
        <text x={pad + 2} y={oscY(0.5) + 4} fontSize={9} fill={te.textDim} opacity={0.5}>0.5</text>
        <text x={pad + 2} y={oscY(0.0) - 3} fontSize={9} fill={te.green} opacity={0.7} fontWeight={700}>OS 0.0</text>

        {/* Clipped group: histogram, oscillator lines, and dots */}
        <g clipPath="url(#hccco-clip)">
          {/* ── Medium Cycle OB histogram (purple) — where slowOsc >= 1.0 ── */}
          {visSlow.map((v, di) => v >= 1.0 ? (
            <rect key={`mob-${di}`} x={xAt(di) - 2} y={oscY(Math.min(v, oscMax))} width={4} height={oscY(1.0) - oscY(Math.min(v, oscMax))} fill="#a855f7" opacity={0.6} />
          ) : null)}

          {/* ── Medium Cycle OS histogram (purple) — where slowOsc <= 0.0 ── */}
          {visSlow.map((v, di) => v <= 0.0 ? (
            <rect key={`mos-${di}`} x={xAt(di) - 2} y={oscY(0.0)} width={4} height={oscY(Math.max(v, oscMin)) - oscY(0.0)} fill="#a855f7" opacity={0.6} />
          ) : null)}

          {/* ── Short Cycle OB histogram (purple) — where fastOsc >= 1.0 ── */}
          {visFast.map((v, di) => v >= 1.0 ? (
            <rect key={`sob-${di}`} x={xAt(di) - 1.5} y={oscY(Math.min(v, oscMax))} width={3} height={oscY(1.0) - oscY(Math.min(v, oscMax))} fill="#a855f7" opacity={0.45} />
          ) : null)}

          {/* ── Short Cycle OS histogram (purple) — where fastOsc <= 0.0 ── */}
          {visFast.map((v, di) => v <= 0.0 ? (
            <rect key={`sos-${di}`} x={xAt(di) - 1.5} y={oscY(0.0)} width={3} height={oscY(Math.max(v, oscMin)) - oscY(0.0)} fill="#a855f7" opacity={0.45} />
          ) : null)}

          {/* Slow oscillator (green line) — omed */}
          <path d={slowPath} fill="none" stroke={te.green} strokeWidth={2} opacity={0.9} />
          {/* Fast oscillator (red line) — oshort */}
          <path d={fastPath} fill="none" stroke={te.red} strokeWidth={2} opacity={0.9} />

          {/* Current value dots */}
          <circle cx={xAt(displayN - 1)} cy={oscY(currentFast)} r={2.5} fill={fastColor} stroke={te.bg} strokeWidth={0.5} />
          <circle cx={xAt(displayN - 1)} cy={oscY(currentSlow)} r={2} fill={te.green} stroke={te.bg} strokeWidth={0.5} />
        </g>

        {/* Current value text */}
        <text x={w - pad} y={Math.max(topPad + 12, Math.min(oscY(currentFast) - 4, h - botPad - 4))} fontSize={10} fill={fastColor} textAnchor="end" fontWeight={700}>{currentFast.toFixed(2)}</text>

        {/* ── Time labels at bottom ── */}
        {(() => {
          const now = Date.now()
          const barMs = intervalMin * 60 * 1000
          // Show ~6-8 labels spread across the chart
          const labelCount = Math.min(8, displayN)
          const step = Math.max(1, Math.floor(displayN / labelCount))
          const labels: { di: number; time: string; date: string }[] = []
          for (let i = 0; i < displayN; i += step) {
            const barTime = now - (displayN - 1 - i) * barMs
            const d = new Date(barTime)
            const hh = String(d.getHours()).padStart(2, '0')
            const mm = String(d.getMinutes()).padStart(2, '0')
            const mo = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            labels.push({ di: i, time: `${hh}:${mm}`, date: `${mo}/${dd}` })
          }
          // Always include the last bar
          const lastD = new Date(now)
          labels.push({ di: displayN - 1, time: `${String(lastD.getHours()).padStart(2, '0')}:${String(lastD.getMinutes()).padStart(2, '0')}`, date: `${String(lastD.getMonth() + 1).padStart(2, '0')}/${String(lastD.getDate()).padStart(2, '0')}` })
          return labels.map((l, i) => (
            <g key={`t-${i}`}>
              <text x={xAt(l.di)} y={h - botPad + 10} fontSize={7} fill={te.textDim} textAnchor="middle" opacity={0.6}>{l.date}</text>
              <text x={xAt(l.di)} y={h - botPad + 20} fontSize={7} fill={te.textDim} textAnchor="middle" opacity={0.8}>{l.time}</text>
            </g>
          ))
        })()}

        {/* ── Crosshair on hover ── */}
        {hoverSvgX !== null && (() => {
          const di = Math.round(((hoverSvgX - pad) / chartW) * (displayN - 1))
          if (di < 0 || di >= displayN) return null
          const cx = xAt(di)
          const hFast = visFast[di]
          const hSlow = visSlow[di]
          const hFastColor = hFast > 1.0 ? '#a855f7' : hFast < 0.0 ? '#a855f7' : hFast > 0.5 ? te.red : te.green
          return (
            <g opacity={0.9}>
              {/* Vertical crosshair line */}
              <line x1={cx} y1={topPad} x2={cx} y2={h - botPad} stroke={te.textDim} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5} />
              {/* Fast oscillator dot */}
              <circle cx={cx} cy={oscY(hFast)} r={3.5} fill={hFastColor} stroke={te.bg} strokeWidth={0.8} />
              {/* Slow oscillator dot */}
              <circle cx={cx} cy={oscY(hSlow)} r={3} fill={te.green} stroke={te.bg} strokeWidth={0.8} />
              {/* Fast value label — right side */}
              <rect x={w - pad - 56} y={Math.max(topPad, oscY(hFast) - 9)} width={54} height={18} rx={3} fill={te.bg} stroke={te.red} strokeWidth={0.5} opacity={0.92} />
              <text x={w - pad - 4} y={Math.max(topPad + 12, Math.min(oscY(hFast) + 4, h - botPad - 4))} fontSize={10} fill={hFastColor} textAnchor="end" fontWeight={700}>{hFast.toFixed(2)}</text>
              {/* Slow value label — left of crosshair */}
              <rect x={cx + 6} y={Math.max(topPad, oscY(hSlow) - 9)} width={48} height={18} rx={3} fill={te.bg} stroke={te.green} strokeWidth={0.5} opacity={0.92} />
              <text x={cx + 10} y={Math.max(topPad + 12, Math.min(oscY(hSlow) + 4, h - botPad - 4))} fontSize={9} fill={te.green} fontWeight={700}>{hSlow.toFixed(2)}</text>
              {/* Horizontal line at fast level */}
              <line x1={pad} y1={oscY(hFast)} x2={w - pad} y2={oscY(hFast)} stroke={te.red} strokeWidth={0.4} strokeDasharray="2,4" opacity={0.25} />
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

// ─── PnL Curve SVG Component ────────────────────────────────────────────────

function PnLCurveSVG({
  closedPositions, startingBalance, te,
}: {
  closedPositions: ClosedPosition[]; startingBalance: number; te: ReturnType<typeof useTE>
}) {
  const [hoverSvgX, setHoverSvgX] = useState<number | null>(null)

  if (closedPositions.length < 2) return null

  // Build cumulative P&L data points from closed positions (chronological)
  const sorted = [...closedPositions].sort((a, b) => a.closedAt - b.closedAt)
  let cumPnl = 0
  const points: { t: number; pnl: number; label: string; pnlPct: number }[] = [
    { t: sorted[0].closedAt - 1, pnl: 0, label: 'Start', pnlPct: 0 }
  ]
  for (const pos of sorted) {
    cumPnl += pos.pnl
    const pair = pos.pair.replace('-USDT', '')
    points.push({ t: pos.closedAt, pnl: cumPnl, label: `${pair} ${pos.side}`, pnlPct: (cumPnl / startingBalance) * 100 })
  }

  // Large chart — half page
  const cw = 700, ch = 350, cPadL = 56, cPadR = 14, cPadT = 20, cPadB = 28
  const chartW = cw - cPadL - cPadR
  const chartH = ch - cPadT - cPadB
  const minPnl = Math.min(0, ...points.map(p => p.pnl))
  const maxPnl = Math.max(0, ...points.map(p => p.pnl))
  const rawRange = maxPnl - minPnl || 1
  const rangePad = rawRange * 0.08
  const adjMin = minPnl - rangePad, adjMax = maxPnl + rangePad
  const adjRange = adjMax - adjMin
  const pnlY = (v: number) => cPadT + ((adjMax - v) / adjRange) * chartH
  const xStep = points.length > 1 ? chartW / (points.length - 1) : 0
  const xAt = (i: number) => cPadL + i * xStep
  const zeroY = pnlY(0)

  // Build path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${pnlY(p.pnl).toFixed(1)}`).join(' ')
  // Area fill path (from line to zero line)
  const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${cPadL},${zeroY.toFixed(1)} Z`

  // Y-axis grid lines
  const yTickCount = 6
  const yTickStep = adjRange / yTickCount
  const yTicks: { value: number; y: number; label: string }[] = []
  for (let i = 0; i <= yTickCount; i++) {
    const val = adjMin + i * yTickStep
    yTicks.push({ value: val, y: pnlY(val), label: `$${val.toFixed(2)}` })
  }

  // X-axis time labels
  const xLabelCount = Math.min(8, points.length)
  const xLabelStep = Math.max(1, Math.floor(points.length / xLabelCount))
  const xLabels: { i: number; x: number; time: string }[] = []
  for (let i = 0; i < points.length; i += xLabelStep) {
    const d = new Date(points[i].t)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    xLabels.push({ i, x: xAt(i), time: points.length < 20 ? `${mo}/${dd} ${hh}:${mm}` : `${hh}:${mm}` })
  }
  // Always include last point
  if (xLabels.length === 0 || xLabels[xLabels.length - 1].i !== points.length - 1) {
    const d = new Date(points[points.length - 1].t)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    xLabels.push({ i: points.length - 1, x: xAt(points.length - 1), time: `${hh}:${mm}` })
  }

  const pnlColor = cumPnl >= 0 ? te.green : te.red

  return (
    <div className="flex-shrink-0" style={{ borderTop: `1px solid ${te.border}`, background: te.bgCard }}>
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[9px] font-bold" style={{ color: te.cyan, letterSpacing: '0.12em' }}>P&L CURVE</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold" style={{ color: pnlColor }}>{formatPnl(cumPnl)} ({formatPct((cumPnl / startingBalance) * 100)})</span>
          <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>{points.length} trades</span>
        </div>
      </div>
      <svg width="100%" height={ch} viewBox={`0 0 ${cw} ${ch}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', fontFamily: te.mono, cursor: 'crosshair' }}
        onMouseMove={(e) => {
          const svg = e.currentTarget
          const ctm = svg.getScreenCTM()
          if (ctm) {
            const pt = svg.createSVGPoint()
            pt.x = e.clientX
            pt.y = e.clientY
            const svgPt = pt.matrixTransform(ctm.inverse())
            setHoverSvgX(svgPt.x)
          }
        }}
        onMouseLeave={() => setHoverSvgX(null)}
      >
        <defs>
          <linearGradient id="pnlGradUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={te.green} stopOpacity={0.25} />
            <stop offset="100%" stopColor={te.green} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="pnlGradDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={te.red} stopOpacity={0.02} />
            <stop offset="100%" stopColor={te.red} stopOpacity={0.25} />
          </linearGradient>
          <clipPath id="pnl-clip">
            <rect x={cPadL} y={cPadT} width={chartW} height={chartH} />
          </clipPath>
        </defs>

        {/* Y-axis grid lines + labels */}
        {yTicks.map((tick, i) => (
          <g key={`yt-${i}`}>
            <line x1={cPadL} y1={tick.y} x2={cw - cPadR} y2={tick.y} stroke={te.border} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4} />
            <text x={cPadL - 4} y={tick.y + 3} fontSize={8} fill={te.textDim} textAnchor="end" fontWeight={600}>{tick.label}</text>
          </g>
        ))}

        {/* Zero line — emphasized */}
        <line x1={cPadL} y1={zeroY} x2={cw - cPadR} y2={zeroY} stroke={te.textDim} strokeWidth={1} strokeDasharray="4,3" opacity={0.6} />
        <text x={cPadL - 4} y={zeroY + 3} fontSize={9} fill={te.text} textAnchor="end" fontWeight={700}>$0</text>

        {/* X-axis time labels */}
        {xLabels.map((l, i) => (
          <text key={`xl-${i}`} x={l.x} y={ch - cPadB + 14} fontSize={8} fill={te.textDim} textAnchor="middle" opacity={0.7}>{l.time}</text>
        ))}

        {/* Area fill (gradient) — clipped */}
        <g clipPath="url(#pnl-clip)">
          <path d={areaPath} fill={cumPnl >= 0 ? 'url(#pnlGradUp)' : 'url(#pnlGradDown)'} />
        </g>

        {/* P&L line — bold */}
        <g clipPath="url(#pnl-clip)">
          <path d={linePath} fill="none" stroke={pnlColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Data point dots */}
        <g clipPath="url(#pnl-clip)">
          {points.map((p, i) => (
            <circle key={`dp-${i}`} cx={xAt(i)} cy={pnlY(p.pnl)} r={3} fill={p.pnl >= 0 ? te.green : te.red} stroke={te.bg} strokeWidth={1} />
          ))}
        </g>

        {/* Latest value label — right side */}
        {(() => {
          const lastP = points[points.length - 1]
          const ly = pnlY(lastP.pnl)
          return (
            <g>
              <rect x={cw - cPadR - 72} y={Math.max(cPadT, ly - 10)} width={70} height={20} rx={4} fill={te.bg} stroke={pnlColor} strokeWidth={0.8} opacity={0.95} />
              <text x={cw - cPadR - 4} y={Math.max(cPadT + 13, ly + 4)} fontSize={10} fill={pnlColor} textAnchor="end" fontWeight={700}>{formatPnl(lastP.pnl)}</text>
            </g>
          )
        })()}

        {/* ── Crosshair on hover ── */}
        {hoverSvgX !== null && (() => {
          // Find closest data point index
          const di = Math.round(((hoverSvgX - cPadL) / chartW) * (points.length - 1))
          if (di < 0 || di >= points.length) return null
          const cx = xAt(di)
          const p = points[di]
          const py = pnlY(p.pnl)
          const dotColor = p.pnl >= 0 ? te.green : te.red
          const d = new Date(p.t)
          const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          return (
            <g opacity={0.95}>
              {/* Vertical crosshair */}
              <line x1={cx} y1={cPadT} x2={cx} y2={ch - cPadB} stroke={te.textDim} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5} />
              {/* Horizontal line at PnL level */}
              <line x1={cPadL} y1={py} x2={cw - cPadR} y2={py} stroke={te.textDim} strokeWidth={0.4} strokeDasharray="2,4" opacity={0.3} />
              {/* Enlarged dot */}
              <circle cx={cx} cy={py} r={5} fill={dotColor} stroke={te.bg} strokeWidth={1.5} />
              {/* Tooltip box */}
              {(() => {
                const tooltipW = 130, tooltipH = 44
                const tx = cx + 12 > cw - cPadR - tooltipW ? cx - tooltipW - 12 : cx + 12
                const ty = Math.max(cPadT, Math.min(py - tooltipH / 2, ch - cPadB - tooltipH))
                return (
                  <>
                    <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={5} fill={te.bg} stroke={dotColor} strokeWidth={0.8} opacity={0.95} />
                    <text x={tx + 8} y={ty + 14} fontSize={9} fill={te.textDim} fontWeight={600}>{timeStr}</text>
                    <text x={tx + 8} y={ty + 28} fontSize={11} fill={dotColor} fontWeight={700}>{formatPnl(p.pnl)} ({formatPct(p.pnlPct)})</text>
                    {di > 0 && (
                      <text x={tx + 8} y={ty + 40} fontSize={8} fill={te.textDim}>{p.label}</text>
                    )}
                  </>
                )
              })()}
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

function HurstTab(): React.ReactElement {
  const te = useTE()

  // ─── State ──────────────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<AssetCategory>('crypto')
  const [selectedAssetIdx, setSelectedAssetIdx] = useState(0)
  const [availFilter, setAvailFilter] = useState<'all' | 'mexc'>('all')
  const [autoTrading, setAutoTrading] = useState(false)
  const [leverage, setLeverage] = useState(10)
  const [slPct, setSlPct] = useState(2.0)   // 2% pos PnL @10x = 0.20% price SL (CSV-optimal)
  const [tpPct, setTpPct] = useState(5.0)   // 5% pos PnL @10x = 0.50% price TP (CSV-optimal, R:R 2.5:1)
  const [bbPeriod, setBbPeriod] = useState(DEFAULT_BB_PERIOD)
  const [bbStdDev, setBbStdDev] = useState(DEFAULT_BB_STD_DEV)
  const [bb2Period] = useState(DEFAULT_BB2_PERIOD)
  const [hurstPeriod, setHurstPeriod] = useState(DEFAULT_HURST_PERIOD)
  // HCCCO params hardcoded from Pine Script (LazyBear defaults: scl=10, mcl=30, scm=1.0, mcm=3.0)
  const hcccoShortCycle = HCCCO_SHORT_CYCLE
  const hcccoMedCycle = HCCCO_MED_CYCLE
  const hcccoShortMult = HCCCO_SHORT_MULT
  const hcccoMedMult = HCCCO_MED_MULT
  const [hcccoTfKey, setHcccoTfKey] = useState<TimeframeKey>('15m')
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem(HURST_TRADE_HISTORY_KEY)
      if (!saved) return []
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed) || parsed.length === 0) return []
      // Single-pass: migrate missing fields + deduplicate IDs
      const seenIds = new Set<string>()
      const cleaned = parsed.map((p: ClosedPosition, idx: number) => {
        let id = p.id || `ht-gen-${idx}`
        if (seenIds.has(id)) id = `${id}-d${idx}-${Date.now()}`
        seenIds.add(id)
        return { ...p, id, slPct: p.slPct ?? 2.0, tpPct: p.tpPct ?? 5.0, fee: p.fee ?? 0, entryStep: (p as any).entryStep ?? 1, sizeMultiplier: (p as any).sizeMultiplier ?? 1, tradeGroupId: (p as any).tradeGroupId ?? 0 }
      })
      // Persist cleaned data back so we don't re-migrate every render
      try { localStorage.setItem(HURST_TRADE_HISTORY_KEY, JSON.stringify(cleaned)) } catch {}
      return cleaned
    } catch { return [] }
  })
  // Wallet balance must account for all closed positions from history
  const [wallet, setWallet] = useState<WalletState>(() => {
    const startingBalance = 1000
    if (typeof window === 'undefined') return { startingBalance, usdtBalance: startingBalance }
    try {
      const saved = localStorage.getItem(HURST_TRADE_HISTORY_KEY)
      if (!saved) return { startingBalance, usdtBalance: startingBalance }
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return { startingBalance, usdtBalance: startingBalance }
      // Reconstruct balance: start with initial, apply each closed trade's net effect
      let balance = startingBalance
      for (const pos of parsed) {
        // When a position closes, balance += size + pnl (pnl is net of fees)
        // But we also need to account for the margin that was locked (size was deducted on open)
        // Net effect on balance per closed trade = pos.pnl (the margin returns automatically)
        balance += (pos.pnl ?? 0)
      }
      return { startingBalance, usdtBalance: balance }
    } catch { return { startingBalance, usdtBalance: startingBalance } }
  })
  const [positions, setPositions] = useState<OpenPosition[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tickVersion, setTickVersion] = useState(0)
  const [showPineScript, setShowPineScript] = useState(false)

  // ─── Backtest State ────────────────────────────────────────────────────
  const [showBacktest, setShowBacktest] = useState(false)
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [backtestError, setBacktestError] = useState<string | null>(null)
  const [backtestDays, setBacktestDays] = useState(90)
  const [backtestSlPct, setBacktestSlPct] = useState(2.0)
  const [backtestTpPct, setBacktestTpPct] = useState(4.0)
  const [backtestLeverage, setBacktestLeverage] = useState(1)
  const [backtestLookback, setBacktestLookback] = useState(10)

  // ─── Refs ───────────────────────────────────────────────────────────────
  const tickCounterRef = useRef(0)
  const priceHistoryRef = useRef<Record<TimeframeKey, number[]>>({ '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '12h': [], '1d': [] })
  // Track which crossover events have been traded — prevents duplicate positions on the same crossover
  // Key: `${hcccoSignalType}-${fastPrev.toFixed(3)}-${fastCurr.toFixed(3)}` uniquely identifies a crossover event
  const tradedCrossoversRef = useRef<Set<string>>(new Set())
  const latestPriceRef = useRef(0)
  const preseedDoneRef = useRef(false)

  // ─── Filtered assets ────────────────────────────────────────────────────
  const categoryAssets = useMemo(() => {
    let filtered = HURST_ASSETS.filter(a => a.category === activeCategory)
    // MEXC has all assets, so filter is simple
    if (availFilter === 'mexc') filtered = filtered.filter(a => a.mexcSymbol !== '')
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(a => a.label.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q))
    }
    return filtered
  }, [activeCategory, availFilter, searchQuery])

  const selectedAsset = categoryAssets[selectedAssetIdx] || HURST_ASSETS[0]
  const prevAssetSymbolRef = useRef(selectedAsset.symbol)

  // ─── MEXC Spot REST API — Real prices for stocks + crypto ──
  // MEXC WebSocket is blocked from this server, so we poll REST API instead.
  // Stock tokens use XUSDT/ONUSDT suffix on MEXC Spot.
  const [mexcSpotPrices, setMexcSpotPrices] = useState<Record<string, { price: number; source: string }>>({})

  // Poll MEXC Spot ticker every 5 seconds
  useEffect(() => {
    let mounted = true
    const fetchPrices = async () => {
      try {
        const symbols = HURST_ASSETS.filter(a => a.mexcSymbol).map(a => a.mexcSymbol).join(',')
        const res = await fetch(`/api/mexc/ticker?symbols=${encodeURIComponent(symbols)}`)
        if (!res.ok) return
        const data: Record<string, { price: number; bid: number; ask: number; change24h: number; vol24h: number }> = await res.json()
        if (!mounted) return
        const result: Record<string, { price: number; source: string }> = {}
        for (const asset of HURST_ASSETS) {
          const spotData = data[asset.mexcSymbol]
          if (spotData && spotData.price > 0) {
            result[asset.symbol] = { price: spotData.price, source: 'MEXC' }
          }
        }
        setMexcSpotPrices(result)
      } catch {
        // ignore fetch errors
      }
    }
    fetchPrices()
    const interval = setInterval(fetchPrices, 5000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  // Also try WebSocket as fallback — may work in browser
  const mexcFuturesSymbols = useMemo(() =>
    HURST_ASSETS.filter(a => a.mexcSymbol).map(a => a.mexcSymbol.replace('USDT', '_USDT')),
    [])
  const mexcPrices = useMexcFuturesWS({ symbols: mexcFuturesSymbols, enabled: true })

  // ─── Price Resolution (MEXC Spot REST + Futures WS fallback) ──
  const allPrices = useMemo(() => {
    const result: Record<string, { price: number; source: string }> = {}
    // Prefer Spot REST API prices (real stock data)
    for (const [sym, data] of Object.entries(mexcSpotPrices)) {
      result[sym] = data
    }
    // Fill gaps with Futures WS data if available
    for (const asset of HURST_ASSETS) {
      if (result[asset.symbol]) continue
      const futuresSymbol = asset.mexcSymbol.replace('USDT', '_USDT')
      const data = mexcPrices[futuresSymbol]
      if (data) result[asset.symbol] = { price: data.lastPrice, source: 'MEXC-FUTURES' }
    }
    return result
  }, [mexcSpotPrices, mexcPrices])

  // ─── Current price ──────────────────────────────────────────────────────
  const currentPairPrice = useMemo(() => {
    const p = allPrices[selectedAsset.symbol]
    return p ? p.price : 0
  }, [allPrices, selectedAsset.symbol])

  const currentPriceSource = useMemo(() => {
    const p = allPrices[selectedAsset.symbol]
    return p ? p.source : ''
  }, [allPrices, selectedAsset.symbol])

  // Track connection (REST or WS)
  useEffect(() => {
    setWsConnected(Object.keys(mexcSpotPrices).length > 0 || Object.keys(mexcPrices).length > 0)
  }, [mexcSpotPrices, mexcPrices])

  // Sync latest price to ref (always up-to-date for timer)
  useEffect(() => {
    if (currentPairPrice > 0) {
      latestPriceRef.current = currentPairPrice
    }
  }, [currentPairPrice])

  // Reset on category/filter change
  useEffect(() => {
    setSelectedAssetIdx(0)
    priceHistoryRef.current = { '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '12h': [], '1d': [] }
    tickCounterRef.current = 0
    preseedDoneRef.current = false // allow re-preseed
    setTickVersion(0)
  }, [activeCategory, availFilter])

  // Reset when selected asset changes (prevent mixing data from different assets)
  useEffect(() => {
    if (prevAssetSymbolRef.current !== selectedAsset.symbol) {
      priceHistoryRef.current = { '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '12h': [], '1d': [] }
      tickCounterRef.current = 0
      preseedDoneRef.current = false // allow re-preseed for new asset
      setTickVersion(0)
      prevAssetSymbolRef.current = selectedAsset.symbol
    }
  }, [selectedAsset.symbol])

  // ─── Pre-seed price history when first price arrives ────────────────────
  // CRITICAL: Without pre-seed, the user must wait 5+ minutes for 20 bars
  // at 15m timeframe before Hurst even computes. This creates the illusion
  // that Hurst "doesn't work". Pre-seed generates synthetic price history
  // around the first live price so the chart populates immediately.
  useEffect(() => {
    if (preseedDoneRef.current) return
    if (currentPairPrice <= 0) return
    preseedDoneRef.current = true

    const asset = selectedAsset
    const vol = asset.vol
    const basePrice = currentPairPrice

    // Generate 120 synthetic bars for each TF — enough for BB1 (34), BB2 (89) + Hurst (50)
    // Use random walk with the asset's characteristic volatility
    for (const tf of TIMEFRAMES) {
      const hist: number[] = []
      let p = basePrice * (1 - vol * 3 * (0.5 + Math.random())) // start slightly off
      for (let i = 0; i < 120; i++) {
        // Random walk: small step each bar, mean-reverting tendency toward basePrice
        const reversion = (basePrice - p) * 0.02 // gentle pull toward live price
        const noise = p * vol * (Math.random() - 0.5) * 2
        p = p + reversion + noise
        if (p <= 0) p = basePrice * 0.5 // safety clamp
        hist.push(p)
      }
      // Make sure the last few bars are close to current live price
      hist[hist.length - 1] = basePrice
      hist[hist.length - 2] = basePrice * (1 + (Math.random() - 0.5) * vol * 0.5)
      hist[hist.length - 3] = basePrice * (1 + (Math.random() - 0.5) * vol)
      priceHistoryRef.current[tf.key] = hist
    }
    // Set tick counter to 120*15 = 1800 so next timer tick naturally appends new bars
    tickCounterRef.current = 120 * 15
    setTickVersion(tickCounterRef.current)
    console.log(`[HURST] Pre-seeded 120 bars for ${asset.symbol} @ $${basePrice.toFixed(2)} vol=${vol}`)
  }, [currentPairPrice, selectedAsset.symbol])

  // ─── Price History Accumulation (timer-based) ─────────────────────────
  // CRITICAL FIX: Previous approach used useEffect([currentPairPrice]) which
  // only fires when the price VALUE changes. If mid-price stays the same
  // between WS updates, ticks never accumulate and chart stays at 0 pts.
  // Timer approach: sample price every 1s regardless of price changes.
  useEffect(() => {
    const interval = setInterval(() => {
      const price = latestPriceRef.current
      if (price <= 0) return

      tickCounterRef.current += 1
      const tick = tickCounterRef.current

      for (const tf of TIMEFRAMES) {
        if (tick % tf.tickInterval === 0) {
          const hist = priceHistoryRef.current[tf.key]
          hist.push(price)
          if (hist.length > MAX_PRICE_HISTORY) priceHistoryRef.current[tf.key] = hist.slice(-MAX_PRICE_HISTORY)
        }
      }

      setTickVersion(tick) // Force re-render so chart picks up new data
    }, 1000) // 1 sample per second

    return () => clearInterval(interval)
  }, [])

  // ─── Compute Multi-TF Data ─────────────────────────────────────────────
  // FIX: Depend on tickVersion (not currentPairPrice) so recomputation
  // happens every time new data is sampled, not only on price changes.
  const tfData = useMemo((): Record<TimeframeKey, TimeframeData> => {
    // tickVersion used as dependency to trigger recalc — actual data read from ref
    void tickVersion
    const empty: TimeframeData = { hurst: [], hurstSlope: [], bb: { ma: [], upper: [], lower: [], upperInner: [], lowerInner: [] }, bb2: { ma: [] }, laggingSpan: [], signal: { type: 'NEUTRAL', strength: 0, hurst: 0.5, hurstSlope: 0, bbPosition: 0, description: 'No data' }, hccco: null, hcccoSignal: { type: 'NEUTRAL', fastVal: 0.5, slowVal: 0.5, strength: 0, description: 'No data' } }
    const result: Record<TimeframeKey, TimeframeData> = { '1m': { ...empty }, '5m': { ...empty }, '15m': { ...empty }, '1h': { ...empty }, '4h': { ...empty }, '12h': { ...empty }, '1d': { ...empty } }
    for (const tf of TIMEFRAMES) {
      const prices = priceHistoryRef.current[tf.key]
      if (prices.length < 10) continue
      const bb = computeBB(prices, bbPeriod, bbStdDev, 1.0)
      // BB2 = EMA(89) basis line only (no bands) — matching Pine Script
      const bb2Ma = computeEMA(prices, bb2Period)
      // Lagging Span: close shifted by 25 bars into the past (offset = -25)
      const laggingSpan: (number | null)[] = prices.map((_, i) => i + 25 < prices.length ? prices[i + 25] : null)
      const hurst = computeHurst(prices, hurstPeriod)
      const hurstSlope = computeHurstSlope(hurst, 5)
      const hccco = computeHCCCO(prices, HCCCO_SHORT_CYCLE, HCCCO_MED_CYCLE, HCCCO_SHORT_MULT, HCCCO_MED_MULT)
      const signal = computeHurstSignal(prices, hurst, bb, 5, hccco)
      const hcccoSignal = computeHCCCOSignal(hccco.fastOsc, hccco.slowOsc)
      result[tf.key] = { hurst, hurstSlope, bb, bb2: { ma: bb2Ma }, laggingSpan, signal, hccco, hcccoSignal }
    }
    return result
  }, [bbPeriod, bbStdDev, bb2Period, hurstPeriod, tickVersion])

  // ─── Smooth Hurst for chart ─────────────────────────────────────────────
  const hurstSmoothed15m = useMemo(() => {
    const raw = tfData['15m'].hurst
    if (raw.length === 0) return []
    const nums = raw.map(v => v ?? 0.5)
    const emaFactor = 0.15
    const ema: number[] = [nums[0]]
    for (let i = 1; i < nums.length; i++) ema.push(nums[i] * emaFactor + ema[i - 1] * (1 - emaFactor))
    const maxDelta = 0.03
    const clamped: number[] = [ema[0]]
    for (let i = 1; i < ema.length; i++) { const diff = ema[i] - clamped[i - 1]; clamped.push(clamped[i - 1] + Math.max(-maxDelta, Math.min(maxDelta, diff))) }
    const winSize = 5
    const result: number[] = []
    for (let i = 0; i < clamped.length; i++) { let sum = 0, count = 0; for (let j = Math.max(0, i - Math.floor(winSize / 2)); j <= Math.min(clamped.length - 1, i + Math.floor(winSize / 2)); j++) { sum += clamped[j]; count++ }; result.push(sum / count) }
    return result
  }, [tfData['15m'].hurst])

  // ─── Signal Confirmation ────────────────────────────────────────────────
  // NEW LOGIC: 3-entry averaging strategy (long only)
  // Entry 1 (1x): Price touches lower BB
  // Entry 2 (2x): Hurst crosses UP through 0.0 (averaging down)
  // Entry 3 (4x): Hurst crosses UP through 0.0 again
  // EXIT ALL: Hurst crosses DOWN through 1.0
  const signalConfirmation = useMemo(() => {
    let confirmed: 'BUY' | 'SELL' | 'NONE' = 'NONE', confirmations: TimeframeKey[] = [], strength = 0
    const prices15 = priceHistoryRef.current['15m']
    const bb15 = tfData['15m'].bb
    const hurst15 = tfData['15m'].hurst

    if (prices15.length < 2) return { confirmed, confirmations, strength, crossoverKey: '', strategyPhase: 'IDLE' as const, strategySignal: null as HurstStrategySignal | null }

    // Get the current phase of the strategy state machine
    const { phase, lastSignal } = getHurstStrategyPhase(prices15, hurst15, bb15)
    const strategySignal = getLatestHurstStrategySignal(prices15, hurst15, bb15, 10)

    // Build crossover event key for deduplication
    const crossoverKey = strategySignal ? `${strategySignal.entryStep}-${strategySignal.confirmedAtBar}` : ''

    if (strategySignal && strategySignal.type === 'LONG' && strategySignal.entryStep > 0) {
      confirmed = 'BUY'
      confirmations.push('15m')
      strength = strategySignal.strength
    } else if (strategySignal && strategySignal.entryStep === 0) {
      // Exit signal — mark as SELL to close positions
      confirmed = 'SELL'
      confirmations.push('15m')
      strength = 1.0
    }
    // Partial triggers for display
    else {
      const n = prices15.length
      const lastPrice = n > 0 ? prices15[n - 1] : 0
      const lastBBLower = bb15.lower.length > 0 ? bb15.lower[bb15.lower.length - 1] : null
      const lastH = hurst15.length > 0 ? hurst15[hurst15.length - 1] : null
      const prevH = hurst15.length > 1 ? hurst15[hurst15.length - 2] : null
      const belowLowerBB = lastBBLower !== null && lastPrice <= lastBBLower
      const hurstCrossUp = prevH !== null && lastH !== null && prevH < 0.0 && lastH >= 0.0
      const hurstCrossDown = prevH !== null && lastH !== null && prevH > 1.0 && lastH <= 1.0
      if (belowLowerBB || hurstCrossUp) {
        confirmed = 'BUY'
        strength = 0.3
        confirmations.push('15m')
      } else if (hurstCrossDown) {
        confirmed = 'SELL'
        strength = 0.3
        confirmations.push('15m')
      }
    }

    return { confirmed, confirmations, strength: Math.min(1, strength), crossoverKey, strategyPhase: phase, strategySignal }
  }, [tfData])

  // ─── Signal Alert: sound + flashing LED ─────────────────────────────────
  const [signalFlash, setSignalFlash] = useState<'BUY' | 'SELL' | null>(null)
  const prevSignalRef = useRef<string>('NONE')

  useEffect(() => {
    const cur = signalConfirmation.confirmed
    const prev = prevSignalRef.current
    prevSignalRef.current = cur
    // Only trigger on NEW signal (transition from NONE to BUY/SELL)
    if (cur !== 'NONE' && prev === 'NONE') {
      // Play beep sound via Web Audio API
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = cur === 'BUY' ? 'sine' : 'square'
        osc.frequency.value = cur === 'BUY' ? 880 : 440
        gain.gain.value = 0.15
        osc.start()
        // Double-beep: two short tones
        const t = ctx.currentTime
        gain.gain.setValueAtTime(0.15, t)
        gain.gain.setValueAtTime(0, t + 0.12)
        gain.gain.setValueAtTime(0.15, t + 0.18)
        gain.gain.setValueAtTime(0, t + 0.30)
        osc.stop(t + 0.35)
      } catch { /* AudioContext not available */ }
      // Start flashing
      setSignalFlash(cur)
    }
    if (cur === 'NONE') {
      setSignalFlash(null)
    }
  }, [signalConfirmation.confirmed])

  // Auto-stop flash after 8 seconds
  useEffect(() => {
    if (!signalFlash) return
    const timer = setTimeout(() => setSignalFlash(null), 8000)
    return () => clearTimeout(timer)
  }, [signalFlash])

  // ─── PnL ────────────────────────────────────────────────────────────────
  // CRITICAL: Use per-pair price for PnL, not currentPairPrice (which is only the selected asset)
  const getPriceForPair = useCallback((pairSymbol: string): number => {
    const p = allPrices[pairSymbol]
    return p ? p.price : 0
  }, [allPrices])

  const totalUnrealizedPnl = useMemo(() => positions.reduce((sum, pos) => {
    const pairPrice = getPriceForPair(pos.pair)
    if (pairPrice <= 0) return sum
    const dir = pos.side === 'LONG' ? 1 : -1
    const rawPct = dir * (pairPrice - pos.entryPrice) / pos.entryPrice * 100
    const grossPnl = (rawPct * pos.leverage) / 100 * pos.size
    // Estimate exit fee (entry fee already accounted on open, but for display include both)
    const estExitFee = (pos.size * pos.leverage * (pairPrice / pos.entryPrice)) * MEXC_TAKER_FEE
    const entryFee = pos.size * pos.leverage * MEXC_TAKER_FEE
    return sum + grossPnl - entryFee - estExitFee
  }, 0), [positions, getPriceForPair])
  // Gross realized P&L (before fees) — so REAL and FEES display independently
  const totalRealizedGrossPnl = useMemo(() => closedPositions.reduce((sum, pos) => sum + pos.pnl + pos.fee, 0), [closedPositions])
  const totalFees = useMemo(() => closedPositions.reduce((sum, pos) => sum + pos.fee, 0), [closedPositions])
  const netRealizedPnl = totalRealizedGrossPnl - totalFees
  // Available margin for new positions — computed from reliable equity formula
  const lockedMargin = useMemo(() => positions.reduce((sum, pos) => sum + pos.size, 0), [positions])
  const availableMargin = Math.max(0, wallet.startingBalance + netRealizedPnl + totalUnrealizedPnl - lockedMargin)
  const pairPositions = useMemo(() => positions.filter(p => p.pair === selectedAsset.symbol), [positions, selectedAsset.symbol])

  // ─── Signal Scoring State ─────────────────────────────────────────────────
  const [signalEvents, setSignalEvents] = useState<SignalEvent[]>(() => loadSessionEvents())
  const signalSessionId = useMemo(() => getSessionId(), [])

  // Persist signal events to localStorage on change
  useEffect(() => { saveSessionEvents(signalEvents) }, [signalEvents])

  const closePosition = useCallback((pos: OpenPosition, exitPrice: number, reason: string) => {
    const dir = pos.side === 'LONG' ? 1 : -1
    const rawPct = dir * (exitPrice - pos.entryPrice) / pos.entryPrice * 100
    const pnlPct = rawPct * pos.leverage
    const grossPnl = pnlPct / 100 * pos.size
    // MEXC taker fees: entry + exit (on notional value = size × leverage)
    const entryFee = pos.size * pos.leverage * MEXC_TAKER_FEE
    const exitFee = (pos.size * pos.leverage * (exitPrice / pos.entryPrice)) * MEXC_TAKER_FEE
    const fee = entryFee + exitFee
    const pnl = grossPnl - fee
    const closed: ClosedPosition = { ...pos, exitPrice, pnl, pnlPct, fee, closedAt: Date.now(), closeReason: reason }
    setClosedPositions(prev => {
      const updated = [closed, ...prev].slice(0, MAX_CLOSED_POSITIONS)
      try { localStorage.setItem(HURST_TRADE_HISTORY_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
    setWallet(prev => ({ ...prev, usdtBalance: prev.usdtBalance + pos.size + pnl }))

    // ─── Record signal scoring event ─────────────────────────────────────────
    const signalType = determineSignalType(
      pos.side,
      autoTrading,
      pos.hcccoFastAtEntry,
      pos.hcccoSlowAtEntry,
    )
    const pointsDelta = calculatePointsDelta(pnlPct, reason as SignalCloseReason)
    setSignalEvents(prev => {
      const runningTotal = (prev.length > 0 ? prev[prev.length - 1].runningTotal : 0) + pointsDelta
      const event: SignalEvent = {
        sessionId: signalSessionId,
        timestamp: new Date().toISOString(),
        signalType,
        pair: pos.pair,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice,
        pnl,
        pnlPct,
        closeReason: reason as SignalCloseReason,
        leverage: pos.leverage,
        hurstAtEntry: pos.hurstAtEntry,
        hcccoFastAtEntry: pos.hcccoFastAtEntry,
        hcccoSlowAtEntry: pos.hcccoSlowAtEntry,
        confidenceScore: 0,
        anomalyCategory: '',
        pointsDelta,
        runningTotal,
      }
      return [...prev, event]
    })
  }, [autoTrading, signalSessionId])

  // ─── Position monitoring (SL + TP + Hurst exit) ───────────────────────────
  // Uses per-pair price for PnL calculation, not just currentPairPrice
  useEffect(() => {
    if (Object.keys(allPrices).length === 0) return
    setPositions(prev => {
      let changed = false
      const remaining = prev.filter(pos => {
        const pairPrice = getPriceForPair(pos.pair)
        if (pairPrice <= 0) return true // no price data yet, can't evaluate
        const dir = pos.side === 'LONG' ? 1 : -1
        const priceChange = dir * (pairPrice - pos.entryPrice) / pos.entryPrice
        // Stop loss — uses raw price change; with leverage, SL triggers faster on margin
        const effectiveSL = (pos.slPct / 100) / pos.leverage
        if (priceChange <= -effectiveSL) { closePosition(pos, pairPrice, 'STOP LOSS'); changed = true; return false }
        // Take profit
        const effectiveTP = (pos.tpPct / 100) / pos.leverage
        if (priceChange >= effectiveTP) { closePosition(pos, pairPrice, 'TAKE PROFIT'); changed = true; return false }
        // Hurst exit: close when Hurst crosses DOWN through 1.0 for selected asset
        if (pos.pair === selectedAsset.symbol) {
          const hurst15 = tfData['15m'].hurst
          const n = hurst15.length
          if (n >= 2) {
            const lastH = hurst15[n - 1]
            const prevH = hurst15[n - 2]
            if (prevH !== null && lastH !== null && prevH > 1.0 && lastH <= 1.0) {
              closePosition(pos, pairPrice, 'HURST EXIT 1.0↓')
              changed = true
              return false
            }
          }
        }
        return true
      })
      return changed ? remaining : prev
    })
  }, [allPrices, selectedAsset.symbol, tfData, closePosition, getPriceForPair])

  useEffect(() => {
    if (!autoTrading || signalConfirmation.confirmed === 'NONE' || currentPairPrice <= 0) return
    const sig = signalConfirmation.strategySignal
    if (!sig) return

    // Event-based dedup: each signal event triggers exactly one action
    const ck = signalConfirmation.crossoverKey
    if (!ck || tradedCrossoversRef.current.has(ck)) return
    // Mark this crossover as traded before opening — prevents duplicates
    tradedCrossoversRef.current.add(ck)
    // Prune old keys to prevent memory leak (keep last 50)
    if (tradedCrossoversRef.current.size > 50) {
      const entries = [...tradedCrossoversRef.current]
      tradedCrossoversRef.current = new Set(entries.slice(-25))
    }

    const s15 = tfData['15m'].signal
    const hccco15 = tfData['15m'].hccco
    const fv = hccco15 && hccco15.fastOsc.length > 0 ? hccco15.fastOsc[hccco15.fastOsc.length - 1] : 0.5
    const sv = hccco15 && hccco15.slowOsc.length > 0 ? hccco15.slowOsc[hccco15.slowOsc.length - 1] : 0.5

    if (sig.entryStep === 0) {
      // EXIT signal: close all positions for this pair with matching tradeGroupId
      const pairPositions = positions.filter(p => p.pair === selectedAsset.symbol && p.tradeGroupId === sig.tradeGroupId)
      if (pairPositions.length > 0) {
        for (const pos of pairPositions) {
          closePosition(pos, currentPairPrice, 'HURST EXIT 1.0↓')
        }
        setPositions(prev => prev.filter(p => !(p.pair === selectedAsset.symbol && p.tradeGroupId === sig.tradeGroupId)))
      }
    } else if (sig.entryStep >= 1 && sig.entryStep <= 3) {
      // ENTRY signal: open position with size based on entryStep
      const baseSize = availableMargin * POSITION_SIZE_PCT
      const positionSize = baseSize * sig.sizeMultiplier
      if (positionSize < 1) return
      if (positions.length >= MAX_POSITIONS) return
      setPositions(prev => [...prev, {
        id: uid(),
        pair: selectedAsset.symbol,
        side: 'LONG' as const,
        entryPrice: currentPairPrice,
        size: positionSize,
        timestamp: Date.now(),
        hurstAtEntry: s15.hurst,
        bbPositionAtEntry: s15.bbPosition,
        leverage,
        hcccoFastAtEntry: fv,
        hcccoSlowAtEntry: sv,
        slPct,
        tpPct,
        entryStep: sig.entryStep,
        sizeMultiplier: sig.sizeMultiplier,
        tradeGroupId: sig.tradeGroupId,
      }])
      setWallet(prev => ({ ...prev, usdtBalance: prev.usdtBalance - positionSize }))
    }
  }, [autoTrading, signalConfirmation, currentPairPrice, positions.length, availableMargin, selectedAsset.symbol, tfData, leverage, slPct, tpPct, closePosition, positions])

  const handleOpenPosition = useCallback((side: 'LONG' | 'SHORT') => {
    if (currentPairPrice <= 0 || positions.length >= MAX_POSITIONS) return
    const positionSize = availableMargin * POSITION_SIZE_PCT
    if (positionSize < 1) return
    const s15 = tfData['15m'].signal
    const hccco15 = tfData['15m'].hccco
    const fv = hccco15 && hccco15.fastOsc.length > 0 ? hccco15.fastOsc[hccco15.fastOsc.length - 1] : 0.5
    const sv = hccco15 && hccco15.slowOsc.length > 0 ? hccco15.slowOsc[hccco15.slowOsc.length - 1] : 0.5
    // Manual open defaults to entryStep 1
    const groupId = Date.now()
    setPositions(prev => [...prev, { id: uid(), pair: selectedAsset.symbol, side, entryPrice: currentPairPrice, size: positionSize, timestamp: Date.now(), hurstAtEntry: s15.hurst, bbPositionAtEntry: s15.bbPosition, leverage, hcccoFastAtEntry: fv, hcccoSlowAtEntry: sv, slPct, tpPct, entryStep: 1, sizeMultiplier: 1, tradeGroupId: groupId }])
    setWallet(prev => ({ ...prev, usdtBalance: prev.usdtBalance - positionSize }))
  }, [currentPairPrice, positions.length, availableMargin, selectedAsset.symbol, tfData, leverage, slPct, tpPct])

  const handleClosePosition = useCallback((posId: string) => {
    const pos = positions.find(p => p.id === posId)
    if (!pos) return
    closePosition(pos, currentPairPrice > 0 ? currentPairPrice : pos.entryPrice, 'MANUAL')
    setPositions(prev => prev.filter(p => p.id !== posId))
  }, [positions, currentPairPrice, closePosition])

  const handleReset = useCallback(() => {
    setWallet({ startingBalance: 1000, usdtBalance: 1000 }); setPositions([]); setClosedPositions([])
    try { localStorage.removeItem(HURST_TRADE_HISTORY_KEY) } catch {}
    priceHistoryRef.current = { '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '12h': [], '1d': [] }; tickCounterRef.current = 0; setTickVersion(0)
    tradedCrossoversRef.current = new Set()
    setSignalEvents([]); clearSessionEvents()
  }, [])

  // ─── Backtest Runner ────────────────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setBacktestLoading(true)
    setBacktestError(null)
    setBacktestResult(null)
    try {
      const params = new URLSearchParams({
        symbol: 'BTCUSDT',
        interval: '15m',
        days: String(backtestDays),
        bbPeriod: String(bbPeriod),
        bbStdDev: String(bbStdDev),
        hurstPeriod: String(hurstPeriod),
        slPct: String(backtestSlPct),
        tpPct: String(backtestTpPct),
        leverage: String(backtestLeverage),
        triggerLookback: String(backtestLookback),
      })
      const res = await fetch(`/api/hurst-backtest?${params.toString()}`, {
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Reconstruct BacktestResult from API response
      const result: BacktestResult = {
        trades: data.trades,
        totalTrades: data.summary.totalTrades,
        winRate: data.summary.winRate,
        totalPnlPct: data.summary.totalPnlPct,
        avgPnlPct: data.summary.avgPnlPct,
        bestTradePct: data.summary.bestTradePct,
        worstTradePct: data.summary.worstTradePct,
        maxDrawdownPct: data.summary.maxDrawdownPct,
        sharpeRatio: data.summary.sharpeRatio,
        profitFactor: data.summary.profitFactor,
        avgBarsHeld: data.summary.avgBarsHeld,
        longTrades: data.summary.longTrades,
        shortTrades: data.summary.shortTrades,
        longWinRate: data.summary.longWinRate,
        shortWinRate: data.summary.shortWinRate,
        equityCurve: data.equityCurve,
        totalSignals: data.summary.totalSignals,
        bbTouchCount: data.summary.bbTouchCount,
        hurstCrossCount: data.summary.hurstCrossCount,
        singleEntryTrades: data.summary.singleEntryTrades ?? 0,
        doubleEntryTrades: data.summary.doubleEntryTrades ?? 0,
        tripleEntryTrades: data.summary.tripleEntryTrades ?? 0,
      }
      setBacktestResult(result)
    } catch (e: unknown) {
      setBacktestError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setBacktestLoading(false)
    }
  }, [backtestDays, bbPeriod, bbStdDev, hurstPeriod, backtestSlPct, backtestTpPct, backtestLeverage, backtestLookback])

  // ─── CSV Export ──────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const headers = ['ID', 'Pair', 'Side', 'Leverage', 'SL_Pct', 'TP_Pct', 'EntryPrice', 'ExitPrice', 'Size', 'PnL_USD', 'PnL_Pct', 'Fee_USD', 'EntryTime', 'ExitTime', 'Duration', 'CloseReason', 'HurstAtEntry', 'BB_AtEntry', 'HCCCO_Fast', 'HCCCO_Slow']
    const rows = closedPositions.map(pos => {
      const entryTime = new Date(pos.timestamp).toISOString()
      const exitTime = new Date(pos.closedAt).toISOString()
      const durationMs = pos.closedAt - pos.timestamp
      const durationMin = Math.floor(durationMs / 60000)
      const durationStr = durationMin < 60 ? `${durationMin}m` : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
      return [
        pos.id, pos.pair, pos.side, pos.leverage,
        pos.slPct.toFixed(1), pos.tpPct.toFixed(1),
        pos.entryPrice.toFixed(pos.pair.includes('BTC') || pos.pair.includes('ETH') ? 0 : 2),
        pos.exitPrice.toFixed(pos.pair.includes('BTC') || pos.pair.includes('ETH') ? 0 : 2),
        pos.size.toFixed(2), pos.pnl.toFixed(2), pos.pnlPct.toFixed(2),
        pos.fee.toFixed(4),
        entryTime, exitTime, durationStr, pos.closeReason,
        pos.hurstAtEntry.toFixed(3), pos.bbPositionAtEntry.toFixed(3),
        pos.hcccoFastAtEntry.toFixed(2), pos.hcccoSlowAtEntry.toFixed(2),
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hurst_trades_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [closedPositions])

  // ─── Render values ─────────────────────────────────────────────────────
  // Equity = starting balance + net realized P&L + unrealized P&L
  // This formula is reliable because it doesn't depend on usdtBalance tracking
  // (which can drift due to localStorage reconstruction / HMR issues).
  const equity = wallet.startingBalance + netRealizedPnl + totalUnrealizedPnl
  const totalPnl = equity - wallet.startingBalance
  const totalPnlPct = (totalPnl / wallet.startingBalance) * 100

  const prices15m = priceHistoryRef.current['15m']
  const bb15m = tfData['15m'].bb
  const hurst15m = tfData['15m'].hurst
  const signal15m = tfData['15m'].signal

  // ─── JSX ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: te.bg, fontFamily: te.mono, color: te.text }}>
      <style>{`@keyframes signalPulse { from { opacity: 0.5; } to { opacity: 1; } }`}</style>

      {/* ─── Top Row: Wallet Stats ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${te.border}`, background: te.bgCard }}>
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full" style={{ background: wsConnected ? te.green : te.textDim, boxShadow: wsConnected ? `0 0 6px ${te.green}44` : 'none' }} />
          <span className="text-[9px] font-bold" style={{ color: wsConnected ? te.green : te.textDim, letterSpacing: '0.08em' }}>{wsConnected ? 'LIVE' : 'OFFLINE'}</span>
          {wsConnected && <span className="text-[7px]" style={{ color: te.textDim }}>
            <span style={{ color: '#00d4aa' }}>M:{Object.keys(mexcPrices).length}</span>
          </span>}
          {!wsConnected && <span className="text-[7px]" style={{ color: te.red }}>WS: connecting...</span>}
          {currentPairPrice > 0 && <span className="text-[7px] font-bold px-1 py-0.5 rounded-sm" style={{ color: '#00d4aa', background: `${'#00d4aa'}1a`, border: `1px solid ${'#00d4aa'}33` }}>{currentPriceSource}</span>}
        </div>
        <StatBox label="EQUITY" value={`$${equity.toFixed(2)}`} color={totalPnl >= 0 ? te.green : te.red} />
        <StatBox label="P&L" value={`${formatPnl(totalPnl)} (${formatPct(totalPnlPct)})`} color={totalPnl >= 0 ? te.green : te.red} />
        <StatBox label="OPEN" value={String(positions.length)} color={positions.length > 0 ? te.cyan : te.textDim} />
        {positions.length > 0 && <StatBox label="UNRL" value={formatPnl(totalUnrealizedPnl)} color={totalUnrealizedPnl >= 0 ? te.green : te.red} />}
        <StatBox label="NET" value={formatPnl(netRealizedPnl)} color={netRealizedPnl >= 0 ? te.green : te.red} />
        {totalFees > 0 && <StatBox label="FEES" value={`-$${totalFees.toFixed(2)}`} color={te.textDim} />}
        <button onClick={() => setAutoTrading(prev => !prev)} className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-[9px] font-bold transition-all" style={{ color: autoTrading ? te.green : te.textDim, background: autoTrading ? te.greenBg : 'transparent', border: `1px solid ${autoTrading ? `${te.green}44` : te.border}`, letterSpacing: '0.06em' }}>
          <div className="size-1.5 rounded-full" style={{ background: autoTrading ? te.green : te.textDim }} />AUTO
        </button>
        {signalFlash && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm" style={{
            color: signalFlash === 'BUY' ? te.green : te.red,
            background: signalFlash === 'BUY' ? te.greenBg : te.redBg,
            border: `2px solid ${signalFlash === 'BUY' ? te.green : te.red}`,
            animation: 'signalPulse 0.5s ease-in-out infinite alternate',
            boxShadow: `0 0 12px ${signalFlash === 'BUY' ? te.green : te.red}66`,
          }}>
            <div className="size-2.5 rounded-full" style={{ background: signalFlash === 'BUY' ? te.green : te.red, boxShadow: `0 0 8px ${signalFlash === 'BUY' ? te.green : te.red}` }} />
            <span className="text-[13px] font-bold" style={{ letterSpacing: '0.12em' }}>
              {signalFlash === 'BUY' ? '▲ BUY' : '▼ SELL'}
            </span>
          </div>
        )}
        {!signalFlash && signalConfirmation.confirmed !== 'NONE' && (
          <div className="px-2 py-1 rounded-sm text-[9px] font-bold" style={{
            color: signalConfirmation.confirmed === 'BUY' ? te.green : te.red,
            background: signalConfirmation.confirmed === 'BUY' ? te.greenBg : te.redBg,
            border: `1px solid ${signalConfirmation.confirmed === 'BUY' ? `${te.green}44` : `${te.red}44`}`,
          }}>
            {signalConfirmation.confirmed === 'BUY' ? '▲ BUY' : '▼ SELL'}
          </div>
        )}
        <button onClick={handleReset} className="px-2 py-1 rounded-sm text-[8px] font-bold" style={{ color: te.textDim, background: 'transparent', border: `1px solid ${te.border}`, letterSpacing: '0.06em' }}>RESET</button>
        {closedPositions.length > 0 && (
          <button onClick={handleExportCSV} className="px-2 py-1 rounded-sm text-[8px] font-bold" style={{ color: te.cyan, background: te.cyanBg, border: `1px solid ${te.cyan}44`, letterSpacing: '0.06em' }}>CSV</button>
        )}
      </div>

      {/* ─── Category Tabs + Availability Filter + Search ─────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0" style={{ borderBottom: `1px solid ${te.border}`, background: te.bgCard }}>
        {(Object.keys(CATEGORY_META) as AssetCategory[]).map(cat => {
          const meta = CATEGORY_META[cat]
          const isActive = cat === activeCategory
          const count = HURST_ASSETS.filter(a => a.category === cat).length
          return (
            <button key={cat} onClick={() => setActiveCategory(cat)} className="px-2 py-0.5 text-[8px] font-bold rounded-sm transition-all whitespace-nowrap" style={{ color: isActive ? meta.color : te.textDim, background: isActive ? `${meta.color}1a` : 'transparent', border: `1px solid ${isActive ? `${meta.color}44` : 'transparent'}`, letterSpacing: '0.06em' }}>
              {meta.icon} {meta.label} ({count})
            </button>
          )
        })}
        <div className="mx-1" style={{ borderLeft: `1px solid ${te.border}`, height: 16 }} />
        {/* Exchange filter */}
        {(['all', 'mexc'] as const).map(f => {
          const isActive = f === availFilter
          const color = f === 'all' ? te.text : '#00d4aa'
          const label = f === 'all' ? 'ALL' : 'MEXC'
          return (
            <button key={f} onClick={() => setAvailFilter(f)} className="px-1.5 py-0.5 text-[7px] font-bold rounded-sm transition-all" style={{ color: isActive ? color : te.textDim, background: isActive ? `${color}1a` : 'transparent', border: `1px solid ${isActive ? `${color}44` : 'transparent'}` }}>
              {label}
            </button>
          )
        })}
        <div className="ml-auto flex items-center">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." className="px-2 py-0.5 text-[9px] rounded-sm w-28 outline-none" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }} />
        </div>
      </div>

      {/* ─── Asset Selector ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-3 py-1 flex-shrink-0 overflow-x-auto" style={{ borderBottom: `1px solid ${te.border}`, background: te.bgCard, scrollbarWidth: 'thin' }}>
        <span className="text-[7px] font-bold mr-1" style={{ color: te.textDim, letterSpacing: '0.1em' }}>ASSET</span>
        {categoryAssets.slice(0, 40).map((asset, i) => {
          const priceData = allPrices[asset.symbol]
          const mid = priceData ? priceData.price : 0
          const isActive = i === selectedAssetIdx


          return (
            <button key={asset.symbol} onClick={() => setSelectedAssetIdx(i)} className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold rounded-sm transition-all whitespace-nowrap" style={{ fontFamily: te.mono, color: isActive ? CATEGORY_META[asset.category].color : te.textDim, background: isActive ? `${CATEGORY_META[asset.category].color}1a` : 'transparent', border: `1px solid ${isActive ? `${CATEGORY_META[asset.category].color}44` : 'transparent'}`, letterSpacing: '0.04em' }}>
              {asset.label}
              {mid > 0 && <span className="ml-0.5" style={{ color: isActive ? te.text : te.textDim, fontWeight: 400 }}>{formatPrice(mid, asset.decimals)}</span>}
              {/* MEXC source dot */}
              {mid > 0 && <span className="size-1.5 rounded-full" style={{ background: '#00d4aa' }} title="MEXC" />}
            </button>
          )
        })}
      </div>

      {/* ─── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left: Hurst Chart + Multi-TF */}
        <div className="flex flex-col gap-2 p-2 flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          <HurstChartSVG prices={prices15m} bb={bb15m} bb2={tfData['15m'].bb2} laggingSpan={tfData['15m'].laggingSpan} hurstValues={hurst15m} hurstSmoothed={hurstSmoothed15m} signal={signal15m} decimals={selectedAsset.decimals} pairSymbol={selectedAsset.label} te={te} openPositions={pairPositions} />

          <HurstBBChartComponent
            activePairSymbol={selectedAsset.label}
            activePairDecimals={selectedAsset.decimals}
            wsConnected={wsConnected}
          />

          {/* ─── Pine Script Reference (collapsible) ──────────────────────────── */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}`, overflow: 'hidden' }}>
            <button
              onClick={() => setShowPineScript(!showPineScript)}
              className="w-full flex items-center gap-2 px-2 py-1 text-left"
              style={{ color: te.textMuted }}
            >
              <span className="text-[9px] font-bold" style={{ letterSpacing: '0.1em', color: te.orange }}>{showPineScript ? '▼' : '▶'}</span>
              <span className="text-[9px] font-bold" style={{ letterSpacing: '0.08em' }}>PINE SCRIPT</span>
              <span className="text-[8px]" style={{ color: te.textDim }}>HCCCO_LB + HTS-BB</span>
            </button>
            {showPineScript && (
              <div className="px-2 pb-2 flex flex-col gap-2">
                <div>
                  <div className="text-[8px] font-bold mb-0.5" style={{ color: '#a855f7', letterSpacing: '0.08em' }}>HCCCO_LB — Hurst Cycle Channel Clone Oscillator</div>
                  <pre className="text-[7px] leading-[1.3] p-1.5 rounded-sm overflow-x-auto" style={{ background: te.bg, border: `1px solid ${te.border}`, color: te.textDim, fontFamily: te.mono, whiteSpace: 'pre', margin: 0 }}>{`study("Hurst Cycle Channel Clone Oscillator [LazyBear]", shorttitle="HCCCO_LB", overlay=false)
scl_t =  input(10, title="Short Cycle Length?")
mcl_t =  input(30, title="Medium Cycle Length?")
scm =  input(1.0, title="Short Cycle Multiplier?")
mcm =  input(3.0, title="Medium Cycle Multiplier?")
src=input(close, title="Source")
scl = scl_t/2, mcl = mcl_t/2
ma_scl=rma(src,scl)
ma_mcl=rma(src,mcl)
scm_off = scm*atr(scl)
mcm_off = mcm*atr(mcl)
scl_2=scl/2, mcl_2=mcl/2
sct =  nz(ma_scl[scl_2], src)+ scm_off
scb =  nz(ma_scl[scl_2], src)- scm_off
mct =  nz(ma_mcl[mcl_2], src)+ mcm_off
mcb =  nz(ma_mcl[mcl_2], src)- mcm_off
scmm=avg(sct,scb)
ul=plot(1.0, title="UpperLine", color=gray), ml=plot(0.5, title="MidLine", color=gray), ll=plot(0.0, title="LowerLine", color=gray)
fill(ll,ml,color=red), fill(ul,ml,color=green)
omed=(scmm-mcb)/(mct-mcb)
oshort=(src-mcb)/(mct-mcb)
plot(omed>=1.0?omed:na, histbase=1.0, style=histogram, color=purple, linewidth=2, title="MediumCycleOB")
plot(omed<=0.0?omed:na, histbase=0.0, style=histogram, color=purple, linewidth=2, title="MediumCycleOS")
plot(oshort>=1.0?oshort:na, histbase=1.0, style=histogram, color=purple, linewidth=2, title="ShortCycleOB")
plot(oshort<=0.0?oshort:na, histbase=0.0, style=histogram, color=purple, linewidth=2, title="ShortCycleOS")
plot(oshort, color=red, linewidth=2, title="FastOsc")
plot(omed, color=green, linewidth=2, title="SlowOsc")
ebc=input(false, title="Enable bar colors")
bc=(oshort>0.5)?(oshort>1.0?purple:(oshort>omed?lime:green)):(oshort<0?purple:(oshort<omed?red:orange))
barcolor(ebc?bc:na)`}</pre>
                </div>
                <div>
                  <div className="text-[8px] font-bold mb-0.5" style={{ color: te.cyan, letterSpacing: '0.08em' }}>HTS-BB — Bollinger Bands (EMA)</div>
                  <pre className="text-[7px] leading-[1.3] p-1.5 rounded-sm overflow-x-auto" style={{ background: te.bg, border: `1px solid ${te.border}`, color: te.textDim, fontFamily: te.mono, whiteSpace: 'pre', margin: 0 }}>{`indicator(shorttitle="HTS-BB", title="Bollinger Bands", overlay=true, timeframe="", timeframe_gaps=true)
length = input.int(34, minval=1)
length2 = input.int(89, minval=1)
src = input(close, title="Source")
mult = input.float(2.0, minval=0.001, maxval=50, title="StdDev")
mult1 = input.float(1.0, minval=0.001, maxval=50, title="StdDev")
basis = ta.ema(src, length)
basis2 = ta.ema(src, length2)

dev = mult * ta.stdev(src, length)
dev1 = mult1 * ta.stdev(src, length)
upper = basis + dev
upper1 = basis + dev1
lower = basis - dev
lower1 = basis - dev1

offset = input.int(0, "Offset", minval = -500, maxval = 500)
plot(basis, "Basis", color=#FFFFFF, offset = offset)
plot(basis2, "Basis2", color=#FFFF00,linewidth = 2, offset = offset)
p1 = plot(upper, "Upper", color=#2962FF, offset = offset)
p2 = plot(lower, "Lower", color=#2962FF, offset = offset)
fill(p1, p2, title = "Background", color=color.rgb(33, 150, 243, 95))

p11 = plot(upper1, "Upper 1", color=#358A5E, offset = offset)
p21 = plot(lower1, "Lower 1", color=#358A5E, offset = offset)
fill(p11, p21, title = "Background 1", color=color.rgb(33, 150, 243, 95))

plot(close, offset = -25, color=#FFFF00, title="Lagging Span")`}</pre>
                </div>
              </div>
            )}
          </div>

          <div className="text-[11px] font-bold mb-1" style={{ color: te.orange, letterSpacing: '0.12em' }}>MULTI-TIMEFRAME HURST + BB</div>
          <div className="flex flex-col gap-1">
            {TIMEFRAMES.map(tf => {
              const data = tfData[tf.key]
              const sc = SIGNAL_COLORS[data.signal.type]
              const isPrimary = tf.key === '15m'
              const prices = priceHistoryRef.current[tf.key]
              return (
                <div key={tf.key} className="rounded-sm p-2" style={{ background: isPrimary ? `${te.orange}08` : te.bgCard, border: `1px solid ${isPrimary ? `${te.orange}33` : te.border}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 22px 36px minmax(62px, 82px) 36px 36px 36px 28px 28px minmax(48px, 64px) 1fr', alignItems: 'center', gap: '4px' }}>
                    <span className="text-[11px] font-bold" style={{ color: isPrimary ? te.orange : te.textMuted, letterSpacing: '0.06em' }}>{tf.label}</span>
                    {isPrimary && <span className="text-[6px] px-1 py-0.5 rounded-sm text-center" style={{ color: te.orange, background: `${te.orange}1a`, border: `1px solid ${te.orange}33` }}>PRI</span>}
                    {!isPrimary && <span />}
                    <span className="text-[7px]" style={{ color: te.textDim, whiteSpace: 'nowrap' }}>{prices.length} bars</span>
                    <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-sm min-w-0 overflow-hidden" style={{ background: sc.bg, border: `1px solid ${sc.text}33`, color: sc.text }}>
                      <span className="text-[8px] shrink-0">{getSignalIcon(data.signal.type)}</span><span className="text-[7px] font-bold truncate" style={{ minWidth: 0 }}>{data.signal.type}</span>
                    </div>
                    <div className="flex flex-col items-center"><span className="text-[7px]" style={{ color: te.textDim }}>H</span><span className="text-[11px] font-bold" style={{ color: data.signal.hurst < 0.45 ? te.green : data.signal.hurst > 0.55 ? te.orange : te.textMuted }}>{data.signal.hurst.toFixed(3)}</span></div>
                    <div className="flex flex-col items-center"><span className="text-[7px]" style={{ color: te.textDim }}>dH</span><span className="text-[11px] font-bold" style={{ color: data.signal.hurstSlope > 0 ? te.cyan : data.signal.hurstSlope < -0.02 ? te.red : te.textDim }}>{data.signal.hurstSlope >= 0 ? '+' : ''}{data.signal.hurstSlope.toFixed(3)}</span></div>
                    <div className="flex flex-col items-center"><span className="text-[7px]" style={{ color: te.textDim }}>BB%</span><span className="text-[11px] font-bold" style={{ color: data.signal.bbPosition > 0.8 ? te.red : data.signal.bbPosition < -0.8 ? te.green : te.textMuted }}>{(data.signal.bbPosition * 100).toFixed(0)}%</span></div>
                    {/* HCCCO values */}
                    {data.hccco && (() => {
                      const fc = data.hccco.fastOsc
                      const sc2 = data.hccco.slowOsc
                      const fv = fc.length > 0 ? fc[fc.length - 1] : null
                      const sv = sc2.length > 0 ? sc2[sc2.length - 1] : null
                      const hsc2 = data.hcccoSignal
                      const hColor = hsc2.type === 'OVERBOUGHT' || hsc2.type === 'BEAR_CROSS' ? te.red : hsc2.type === 'OVERSOLD' || hsc2.type === 'BULL_CROSS' ? te.green : te.textDim
                      return (
                        <>
                          <div className="flex flex-col items-center"><span className="text-[7px]" style={{ color: te.textDim }}>F</span><span className="text-[11px] font-bold" style={{ color: fv !== null ? (fv > 1.0 ? '#a855f7' : fv > 0.5 ? te.red : fv < 0.0 ? '#a855f7' : te.green) : te.textDim }}>{fv !== null ? fv.toFixed(2) : '—'}</span></div>
                          <div className="flex flex-col items-center"><span className="text-[7px]" style={{ color: te.textDim }}>S</span><span className="text-[11px] font-bold" style={{ color: sv !== null ? te.green : te.textDim }}>{sv !== null ? sv.toFixed(2) : '—'}</span></div>
                          {hsc2.type !== 'NEUTRAL' ? (
                            <span className="text-[6px] font-bold px-1 py-0.5 rounded-sm text-center truncate min-w-0 overflow-hidden" style={{ background: HCCCO_SIGNAL_COLORS[hsc2.type].bg, color: hColor, border: `1px solid ${hColor}33`, maxWidth: '64px' }}>{hsc2.type}</span>
                          ) : (
                            <span />
                          )}
                        </>
                      )
                    })()}
                    {!data.hccco && <><span /><span /><span /></>}
                    {/* Strength bar + BB prices */}
                    <div className="flex flex-col"><span className="text-[7px]" style={{ color: te.textDim }}>STR</span><div className="h-2 rounded-full mt-0.5" style={{ background: te.border }}><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, data.signal.strength * 100)}%`, background: sc.text }} /></div></div>
                  </div>
                </div>
              )
            })}
            {/* ── Aggregated Signal Bar ── */}
            {(() => {
              // Count UNDERVALUED and OVERVALUED across all timeframes
              let uvCount = 0, ovCount = 0, tuCount = 0, tdCount = 0, exCount = 0, neutralCount = 0
              let totalStrength = 0
              let uvStrength = 0, ovStrength = 0
              for (const tf of TIMEFRAMES) {
                const s = tfData[tf.key].signal
                totalStrength += s.strength
                if (s.type === 'UNDERVALUED') { uvCount++; uvStrength += s.strength }
                else if (s.type === 'OVERVALUED') { ovCount++; ovStrength += s.strength }
                else if (s.type === 'TREND-UP') tuCount++
                else if (s.type === 'TREND-DOWN') tdCount++
                else if (s.type === 'EXHAUSTION') exCount++
                else neutralCount++
              }
              const total = TIMEFRAMES.length
              const uvPct = (uvCount / total) * 100
              const ovPct = (ovCount / total) * 100
              const tuPct = (tuCount / total) * 100
              const tdPct = (tdCount / total) * 100
              const exPct = (exCount / total) * 100
              const neutralPct = (neutralCount / total) * 100
              // Overall direction: net = UV - OV (positive = bullish, negative = bearish)
              const netSignal = uvCount - ovCount
              const overallLabel = netSignal > 0 ? 'BULLISH' : netSignal < 0 ? 'BEARISH' : 'NEUTRAL'
              const overallColor = netSignal > 0 ? te.green : netSignal < 0 ? te.red : te.textDim
              return (
                <div className="rounded-sm p-2 mt-1" style={{ background: `${overallColor}08`, border: `1px solid ${overallColor}33` }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold" style={{ color: te.cyan, letterSpacing: '0.1em', fontFamily: te.mono }}>AGGREGATE</span>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-sm" style={{ color: overallColor, background: `${overallColor}1a`, border: `1px solid ${overallColor}33` }}>{overallLabel}</span>
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[9px] font-bold" style={{ color: te.green }}>{uvCount}▲</span>
                      <span className="text-[9px]" style={{ color: te.textDim }}>vs</span>
                      <span className="text-[9px] font-bold" style={{ color: te.red }}>{ovCount}▼</span>
                    </div>
                  </div>
                  {/* Stacked bar */}
                  <div className="flex h-3 rounded-sm overflow-hidden" style={{ background: te.border }}>
                    {uvPct > 0 && <div style={{ width: `${uvPct}%`, background: te.green, opacity: 0.8 }} title={`UNDERVALUED ${uvCount}/${total}`} />}
                    {tuPct > 0 && <div style={{ width: `${tuPct}%`, background: te.cyan, opacity: 0.6 }} title={`TREND-UP ${tuCount}/${total}`} />}
                    {neutralPct > 0 && <div style={{ width: `${neutralPct}%`, background: te.textDim, opacity: 0.3 }} title={`NEUTRAL ${neutralCount}/${total}`} />}
                    {exPct > 0 && <div style={{ width: `${exPct}%`, background: te.yellow, opacity: 0.5 }} title={`EXHAUSTION ${exCount}/${total}`} />}
                    {tdPct > 0 && <div style={{ width: `${tdPct}%`, background: te.orange, opacity: 0.6 }} title={`TREND-DOWN ${tdCount}/${total}`} />}
                    {ovPct > 0 && <div style={{ width: `${ovPct}%`, background: te.red, opacity: 0.8 }} title={`OVERVALUED ${ovCount}/${total}`} />}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.green }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.green }} />UV {uvCount}</span>
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.cyan }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.cyan }} />TU {tuCount}</span>
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.textDim }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.textDim }} />N {neutralCount}</span>
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.yellow }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.yellow }} />EX {exCount}</span>
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.orange }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.orange }} />TD {tdCount}</span>
                    <span className="text-[7px] font-bold flex items-center gap-0.5" style={{ color: te.red }}><span className="inline-block w-2 h-2 rounded-sm" style={{ background: te.red }} />OV {ovCount}</span>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Right: Signal Confirmation + Controls */}
        <div className="flex flex-col gap-2 p-2 w-60 flex-shrink-0 overflow-y-auto" style={{ borderLeft: `1px solid ${te.border}`, scrollbarWidth: 'thin' }}>
          <div className="text-[11px] font-bold mb-1" style={{ color: te.orange, letterSpacing: '0.12em' }}>SIGNAL CONFIRMATION</div>

          {/* Confirmation Matrix */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="text-[8px] font-bold" style={{ color: te.textDim }}>TF</div>
              <div className="text-[8px] font-bold" style={{ color: te.textDim }}>SIGNAL</div>
              <div className="text-[8px] font-bold" style={{ color: te.textDim }}>H</div>
              <div className="text-[8px] font-bold" style={{ color: te.textDim }}>CONF?</div>
              {TIMEFRAMES.map(tf => {
                const data = tfData[tf.key]
                const isConf = signalConfirmation.confirmations.includes(tf.key)
                return (
                  <React.Fragment key={tf.key}>
                    <div className="text-[9px] font-bold" style={{ color: tf.key === '15m' ? te.orange : te.textMuted }}>{tf.label}</div>
                    <div className="text-[9px]" style={{ color: SIGNAL_COLORS[data.signal.type].text }}>{data.signal.type.slice(0, 5)}</div>
                    <div className="text-[9px] font-bold" style={{ color: data.signal.hurst < 0.45 ? te.green : data.signal.hurst > 0.55 ? te.orange : te.textDim }}>{data.signal.hurst.toFixed(2)}</div>
                    <div className="text-[9px] font-bold" style={{ color: isConf ? te.green : te.textDim }}>{tf.key === '15m' ? '—' : isConf ? '✓' : '✗'}</div>
                  </React.Fragment>
                )
              })}
            </div>
            <div className="mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${te.border}` }}>
              <div className="flex items-center justify-between"><span className="text-[9px]" style={{ color: te.textDim }}>SIGNAL</span><span className="text-[11px] font-bold" style={{ color: signalConfirmation.confirmed === 'BUY' ? te.green : signalConfirmation.confirmed === 'SELL' ? te.red : te.textDim }}>{signalConfirmation.confirmed === 'NONE' ? 'NO SIGNAL' : signalConfirmation.confirmed}</span></div>
              <div className="flex items-center justify-between mt-1"><span className="text-[9px]" style={{ color: te.textDim }}>STRENGTH</span><span className="text-[11px] font-bold" style={{ color: te.text }}>{(signalConfirmation.strength * 100).toFixed(0)}%</span></div>
              <div className="flex items-center justify-between mt-1"><span className="text-[9px]" style={{ color: te.textDim }}>CONF TFs</span><span className="text-[11px] font-bold" style={{ color: te.text }}>{signalConfirmation.confirmations.length > 0 ? signalConfirmation.confirmations.join(', ') : '—'}</span></div>
            </div>
            {/* Hurst Dual-Trigger Status */}
            {(() => {
              const prices15 = priceHistoryRef.current['15m']
              const bb15Data = tfData['15m'].bb
              const hurst15 = tfData['15m'].hurst
              const n = prices15.length
              const lastPrice = n > 0 ? prices15[n - 1] : 0
              const lastBBUpper = bb15Data.upper.length > 0 ? bb15Data.upper[bb15Data.upper.length - 1] : null
              const lastBBLower = bb15Data.lower.length > 0 ? bb15Data.lower[bb15Data.lower.length - 1] : null
              const belowLowerBB = lastBBLower !== null && lastPrice <= lastBBLower
              const aboveUpperBB = lastBBUpper !== null && lastPrice >= lastBBUpper
              const lastH = hurst15.length > 0 ? hurst15[hurst15.length - 1] : null
              const prevH = hurst15.length > 1 ? hurst15[hurst15.length - 2] : null
              const hurstCrossUp = prevH !== null && lastH !== null && prevH < 0.0 && lastH >= 0.0
              const hurstCrossDown = prevH !== null && lastH !== null && prevH > 1.0 && lastH <= 1.0
              const longConfirmed = belowLowerBB && hurstCrossUp
              const shortConfirmed = aboveUpperBB && hurstCrossDown
              const longPartial = belowLowerBB || hurstCrossUp
              const shortPartial = aboveUpperBB || hurstCrossDown
              return (
                <div className="mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${te.border}` }}>
                  <div className="text-[8px] font-bold mb-0.5" style={{ color: te.textDim, letterSpacing: '0.06em' }}>HURST DUAL-TRIGGER 15m</div>
                  {/* LONG triggers */}
                  <div className="flex items-center gap-1 mb-0.5">
                    <div className="size-2 rounded-full" style={{ background: belowLowerBB ? te.green : te.border }} />
                    <span className="text-[8px]" style={{ color: belowLowerBB ? te.green : te.textDim }}>BB↓dotyk</span>
                    <span className="text-[7px]" style={{ color: te.textDim }}>+</span>
                    <div className="size-2 rounded-full" style={{ background: hurstCrossUp ? te.green : te.border }} />
                    <span className="text-[8px]" style={{ color: hurstCrossUp ? te.green : te.textDim }}>Hurst↑0.0</span>
                    <span className="text-[7px] font-bold" style={{ color: longConfirmed ? te.green : longPartial ? te.orange : te.textDim }}>→ LONG{longConfirmed ? ' ✓' : longPartial ? ' ~' : ''}</span>
                  </div>
                  {/* SHORT triggers */}
                  <div className="flex items-center gap-1">
                    <div className="size-2 rounded-full" style={{ background: aboveUpperBB ? te.red : te.border }} />
                    <span className="text-[8px]" style={{ color: aboveUpperBB ? te.red : te.textDim }}>BB↑dotyk</span>
                    <span className="text-[7px]" style={{ color: te.textDim }}>+</span>
                    <div className="size-2 rounded-full" style={{ background: hurstCrossDown ? te.red : te.border }} />
                    <span className="text-[8px]" style={{ color: hurstCrossDown ? te.red : te.textDim }}>Hurst↓1.0</span>
                    <span className="text-[7px] font-bold" style={{ color: shortConfirmed ? te.red : shortPartial ? te.orange : te.textDim }}>→ SHORT{shortConfirmed ? ' ✓' : shortPartial ? ' ~' : ''}</span>
                  </div>
                  {/* Current Hurst value */}
                  {lastH !== null && (
                    <div className="mt-1 text-[7px]" style={{ color: te.textDim }}>
                      H = <span style={{ color: lastH < 0.0 ? te.green : lastH > 1.0 ? te.red : te.textDim, fontWeight: 700 }}>{lastH.toFixed(3)}</span>
                      {lastH < 0.0 && <span style={{ color: te.green }}> ← poniżej 0.0!</span>}
                      {lastH > 1.0 && <span style={{ color: te.red }}> → powyżej 1.0!</span>}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Exchange source info */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="text-[7px] font-bold mb-1" style={{ color: te.textMuted, letterSpacing: '0.1em' }}>PRICE SOURCE</div>
            {currentPriceSource && (
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm" style={{ color: '#00d4aa', background: `${'#00d4aa'}1a`, border: `1px solid ${'#00d4aa'}33` }}>{currentPriceSource}</span>
                <span className="text-[7px]" style={{ color: te.textDim }}>FUTURES — 24/7 trading</span>
              </div>
            )}
            {/* SL/TP info */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[7px]" style={{ color: te.textDim }}>SL/TP:</span>
              <span className="text-[7px] font-bold px-1 py-0.5 rounded-sm" style={{ color: te.green, background: te.greenBg, border: `1px solid ${te.green}33` }}>NATIVE</span>
              <span className="text-[6px]" style={{ color: te.textDim }}>(MEXC Futures API)</span>
            </div>
          </div>

          {/* ─── INTELLIGENT TRADE PANEL ──────────────────────────────────── */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-bold" style={{ color: te.cyan, letterSpacing: '0.12em' }}>SMART TRADE</span>
              <button onClick={() => setAutoTrading(prev => !prev)} className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-bold transition-all" style={{ color: autoTrading ? te.green : te.textDim, background: autoTrading ? te.greenBg : 'transparent', border: `1px solid ${autoTrading ? `${te.green}44` : te.border}` }}>
                <div className="size-1.5 rounded-full" style={{ background: autoTrading ? te.green : te.textDim }} />{autoTrading ? 'ON' : 'OFF'}
              </button>
            </div>
            {/* 15m Hurst status */}
            {(() => {
              const h15 = tfData['15m'].signal.hurst
              const bb15 = tfData['15m'].signal.bbPosition
              const sig15 = tfData['15m'].signal.type
              const prices15 = priceHistoryRef.current['15m']
              const bb15Data = tfData['15m'].bb
              const hurst15Data = tfData['15m'].hurst
              const lastPrice = prices15.length > 0 ? prices15[prices15.length - 1] : 0
              const lastBBUpper = bb15Data.upper.length > 0 ? bb15Data.upper[bb15Data.upper.length - 1] : null
              const lastBBLower = bb15Data.lower.length > 0 ? bb15Data.lower[bb15Data.lower.length - 1] : null
              // LONG triggers: BB lower touch + Hurst crosses above 0.0
              const belowLowerBB = lastBBLower !== null && lastPrice <= lastBBLower
              const lastH = hurst15Data.length > 0 ? hurst15Data[hurst15Data.length - 1] : null
              const prevH = hurst15Data.length > 1 ? hurst15Data[hurst15Data.length - 2] : null
              const hurstCrossUp = prevH !== null && lastH !== null && prevH < 0.0 && lastH >= 0.0
              const longTrigger1 = belowLowerBB // BB lower touch (Trigger 1)
              const longTrigger2 = hurstCrossUp // Hurst crosses above 0.0 (Trigger 2)
              const longActive = longTrigger1 && longTrigger2
              // SHORT triggers: BB upper touch + Hurst crosses below 1.0
              const aboveUpperBB = lastBBUpper !== null && lastPrice >= lastBBUpper
              const hurstCrossDown = prevH !== null && lastH !== null && prevH > 1.0 && lastH <= 1.0
              const shortTrigger1 = aboveUpperBB // BB upper touch (Trigger 1)
              const shortTrigger2 = hurstCrossDown // Hurst crosses below 1.0 (Trigger 2)
              const shortActive = shortTrigger1 && shortTrigger2
              // Strength calculation
              const longStrength = longActive ? 1.0 : longTrigger1 ? 0.5 : longTrigger2 ? 0.5 : 0
              const shortStrength = shortActive ? 1.0 : shortTrigger1 ? 0.5 : shortTrigger2 ? 0.5 : 0
              return (
                <>
                  {/* Hurst 15m gauge */}
                  <div className="mb-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[7px]" style={{ color: te.textDim }}>HURST 15m</span>
                      <span className="text-[9px] font-bold" style={{ color: h15 < 0.0 ? te.green : h15 < 0.45 ? '#22c55e99' : h15 > 1.0 ? te.red : h15 > 0.55 ? te.orange : te.textDim }}>{h15.toFixed(3)}</span>
                    </div>
                    {/* Visual bar: -0.20 → 1.20 range (extended to show crosses) */}
                    <div className="relative h-3 rounded-sm overflow-hidden" style={{ background: te.border }}>
                      {/* Green zone: below 0.0 (LONG trigger zone) */}
                      <div className="absolute left-0 top-0 h-full" style={{ width: `${((0.0 - (-0.20)) / (1.20 - (-0.20))) * 100}%`, background: `${te.green}22` }} />
                      {/* 0.0 threshold line */}
                      <div className="absolute top-0 h-full w-px" style={{ left: `${((0.0 - (-0.20)) / (1.20 - (-0.20))) * 100}%`, background: te.green, opacity: 0.7 }} />
                      {/* 1.0 threshold line */}
                      <div className="absolute top-0 h-full w-px" style={{ left: `${((1.0 - (-0.20)) / (1.20 - (-0.20))) * 100}%`, background: te.red, opacity: 0.7 }} />
                      {/* Red zone: above 1.0 (SHORT trigger zone) */}
                      <div className="absolute top-0 h-full" style={{ left: `${((1.0 - (-0.20)) / (1.20 - (-0.20))) * 100}%`, width: `${((1.20 - 1.0) / (1.20 - (-0.20))) * 100}%`, background: `${te.red}22` }} />
                      {/* Current value marker */}
                      <div className="absolute top-0 h-full w-0.5" style={{ left: `${Math.max(0, Math.min(100, ((h15 - (-0.20)) / (1.20 - (-0.20))) * 100))}%`, background: h15 < 0.0 ? te.green : h15 > 1.0 ? te.red : te.text }} />
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[6px]" style={{ color: te.green }}>0.0 LONG</span>
                      <span className="text-[6px]" style={{ color: te.red }}>1.0 SHORT</span>
                    </div>
                  </div>
                  {/* Signal verdict */}
                  <div className="flex gap-1 mb-1.5">
                    {/* LONG signal */}
                    <div className="flex-1 rounded-sm p-1.5 text-center" style={{ background: longActive ? te.greenBg : 'transparent', border: `1px solid ${longActive ? `${te.green}44` : te.border}` }}>
                      <div className="text-[7px] font-bold" style={{ color: longActive ? te.green : te.textDim, letterSpacing: '0.06em' }}>▲ LONG</div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        <div className="flex items-center gap-0.5 justify-center">
                          <div className="size-1.5 rounded-full" style={{ background: longTrigger1 ? te.green : te.border }} />
                          <span className="text-[6px]" style={{ color: longTrigger1 ? te.green : te.textDim }}>BB↓dotyk</span>
                        </div>
                        <div className="flex items-center gap-0.5 justify-center">
                          <div className="size-1.5 rounded-full" style={{ background: longTrigger2 ? te.green : te.border }} />
                          <span className="text-[6px]" style={{ color: longTrigger2 ? te.green : te.textDim }}>Hurst↑0.0</span>
                        </div>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full" style={{ background: te.border }}><div className="h-full rounded-full" style={{ width: `${longStrength * 100}%`, background: longActive ? te.green : longTrigger1 || longTrigger2 ? te.cyan : te.textDim }} /></div>
                    </div>
                    {/* SHORT signal */}
                    <div className="flex-1 rounded-sm p-1.5 text-center" style={{ background: shortActive ? te.redBg : 'transparent', border: `1px solid ${shortActive ? `${te.red}44` : te.border}` }}>
                      <div className="text-[7px] font-bold" style={{ color: shortActive ? te.red : te.textDim, letterSpacing: '0.06em' }}>▼ SHORT</div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        <div className="flex items-center gap-0.5 justify-center">
                          <div className="size-1.5 rounded-full" style={{ background: shortTrigger1 ? te.red : te.border }} />
                          <span className="text-[6px]" style={{ color: shortTrigger1 ? te.red : te.textDim }}>BB↑dotyk</span>
                        </div>
                        <div className="flex items-center gap-0.5 justify-center">
                          <div className="size-1.5 rounded-full" style={{ background: shortTrigger2 ? te.red : te.border }} />
                          <span className="text-[6px]" style={{ color: shortTrigger2 ? te.red : te.textDim }}>Hurst↓1.0</span>
                        </div>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full" style={{ background: te.border }}><div className="h-full rounded-full" style={{ width: `${shortStrength * 100}%`, background: shortActive ? te.red : shortTrigger1 || shortTrigger2 ? te.orange : te.textDim }} /></div>
                    </div>
                  </div>
                  {/* Active position info */}
                  {pairPositions.length > 0 && (() => {
                    const pos = pairPositions[0]
                    const posPrice = currentPairPrice > 0 ? currentPairPrice : pos.entryPrice
                    const dir = pos.side === 'LONG' ? 1 : -1
                    const rawPnlPct = dir * (posPrice - pos.entryPrice) / pos.entryPrice * 100
                    const leveragedPct = rawPnlPct * pos.leverage
                    const grossPnl = (rawPnlPct * pos.leverage) / 100 * pos.size
                    const entryFee = pos.size * pos.leverage * MEXC_TAKER_FEE
                    const exitFee = (pos.size * pos.leverage * (posPrice / pos.entryPrice)) * MEXC_TAKER_FEE
                    const leveragedPnl = grossPnl - entryFee - exitFee
                    const slPrice = pos.side === 'LONG' ? pos.entryPrice * (1 - pos.slPct / 100) : pos.entryPrice * (1 + pos.slPct / 100)
                    const tpPrice = pos.side === 'LONG' ? pos.entryPrice * (1 + pos.tpPct / 100) : pos.entryPrice * (1 - pos.tpPct / 100)
                    return (
                      <div className="rounded-sm p-2" style={{ background: `${(pos.side === 'LONG' ? te.green : te.red)}08`, border: `1px solid ${(pos.side === 'LONG' ? te.green : te.red)}33` }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold" style={{ color: pos.side === 'LONG' ? te.green : te.red }}>{pos.side} @ {formatPrice(pos.entryPrice, selectedAsset.decimals)}</span>
                          <span className="text-[12px] font-bold" style={{ color: leveragedPnl >= 0 ? te.green : te.red }}>{formatPnl(leveragedPnl)} ({formatPct(leveragedPct)})</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] font-bold" style={{ color: te.red }}>SL: -{pos.slPct.toFixed(1)}% ({formatPrice(slPrice, selectedAsset.decimals)})</span>
                          <span className="text-[9px] font-bold" style={{ color: te.green }}>TP: +{pos.tpPct.toFixed(1)}% ({formatPrice(tpPrice, selectedAsset.decimals)})</span>
                          <button onClick={() => handleClosePosition(pos.id)} className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm" style={{ color: te.red, background: te.redBg, border: `1px solid ${te.red}44` }}>CLOSE</button>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )
            })()}
          </div>

          {/* Parameters */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="text-[10px] font-bold mb-1" style={{ color: te.textMuted, letterSpacing: '0.1em' }}>PARAMETERS</div>
            <ParamControl label="BB Period" value={bbPeriod} min={5} max={50} onChange={setBbPeriod} te={te} />
            <ParamControl label="BB StdDev" value={bbStdDev} min={0.5} max={4} step={0.1} onChange={setBbStdDev} te={te} />
            <div className="flex items-center gap-1 py-0.5">
              <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>BB Inner</span>
              <span className="text-[9px] font-bold" style={{ color: '#358A5E', fontFamily: te.mono }}>1.0 StdDev</span>
            </div>
            <div className="flex items-center gap-1 py-0.5">
              <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>EMA(89)</span>
              <span className="text-[9px] font-bold" style={{ color: '#FFFF00', fontFamily: te.mono }}>Basis2</span>
            </div>
            <div className="flex items-center gap-1 py-0.5">
              <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>Lag</span>
              <span className="text-[9px] font-bold" style={{ color: '#FFFF00', fontFamily: te.mono }}>Shift -25</span>
            </div>
            <ParamControl label="Hurst Per." value={hurstPeriod} min={20} max={100} onChange={setHurstPeriod} te={te} />
            <div className="my-1.5" style={{ borderTop: `1px solid ${te.border}` }} />
            <ParamControl label="Stop Loss" value={slPct} min={0.5} max={20} step={0.1} onChange={setSlPct} te={te} suffix="%" />
            <ParamControl label="Take Profit" value={tpPct} min={0.5} max={30} step={0.1} onChange={setTpPct} te={te} suffix="%" />
          </div>

          {/* ─── BACKTEST Panel ──────────────────────────────────────────────── */}
          <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}`, overflow: 'hidden' }}>
            <button
              onClick={() => setShowBacktest(!showBacktest)}
              className="w-full flex items-center gap-2 px-2 py-1 text-left"
              style={{ color: te.textMuted }}
            >
              <span className="text-[9px] font-bold" style={{ letterSpacing: '0.1em', color: te.cyan }}>{showBacktest ? '▼' : '▶'}</span>
              <span className="text-[9px] font-bold" style={{ letterSpacing: '0.08em', color: te.cyan }}>BACKTEST BTC</span>
              <span className="text-[8px]" style={{ color: te.textDim }}>Dual-Trigger Strategy</span>
            </button>
            {showBacktest && (
              <div className="px-2 pb-2 flex flex-col gap-1.5">
                <div className="text-[7px]" style={{ color: te.textDim }}>
                  LONG: BB dolna dotknięcie + Hurst ↑0.00 | SHORT: BB górna dotknięcie + Hurst ↓1.00
                </div>
                <ParamControl label="Days" value={backtestDays} min={7} max={365} step={7} onChange={setBacktestDays} te={te} />
                <ParamControl label="SL %" value={backtestSlPct} min={0.5} max={20} step={0.5} onChange={setBacktestSlPct} te={te} suffix="%" />
                <ParamControl label="TP %" value={backtestTpPct} min={0.5} max={30} step={0.5} onChange={setBacktestTpPct} te={te} suffix="%" />
                <ParamControl label="Lookback" value={backtestLookback} min={1} max={30} onChange={setBacktestLookback} te={te} />
                <ParamControl label="Leverage" value={backtestLeverage} min={1} max={125} onChange={setBacktestLeverage} te={te} suffix="x" />
                <button
                  onClick={runBacktest}
                  disabled={backtestLoading}
                  className="w-full py-1.5 rounded-sm text-[9px] font-bold transition-all disabled:opacity-40"
                  style={{ color: te.bg, background: te.cyan, letterSpacing: '0.08em' }}
                >
                  {backtestLoading ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" /> RUNNING...
                    </span>
                  ) : 'RUN BACKTEST BTC 15m'}
                </button>
                {backtestError && (
                  <div className="text-[8px] p-1.5 rounded-sm" style={{ color: te.red, background: te.redBg, border: `1px solid ${te.red}33` }}>
                    {backtestError}
                  </div>
                )}
                {backtestResult && (() => {
                  const r = backtestResult
                  const wrColor = r.winRate >= 0.5 ? te.green : r.winRate >= 0.3 ? te.orange : te.red
                  const pnlColor = r.totalPnlPct >= 0 ? te.green : te.red
                  const pfColor = r.profitFactor >= 1.5 ? te.green : r.profitFactor >= 1.0 ? te.orange : te.red
                  return (
                    <>
                      {/* Summary stats */}
                      <div className="rounded-sm p-1.5" style={{ background: te.bg, border: `1px solid ${te.border}` }}>
                        <div className="text-[8px] font-bold mb-1" style={{ color: te.cyan, letterSpacing: '0.08em' }}>BTC 15m BACKTEST RESULTS</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Trades</span><span className="text-[9px] font-bold" style={{ color: te.text }}>{r.totalTrades}</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Win Rate</span><span className="text-[9px] font-bold" style={{ color: wrColor }}>{(r.winRate * 100).toFixed(1)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Total P&L</span><span className="text-[9px] font-bold" style={{ color: pnlColor }}>{r.totalPnlPct >= 0 ? '+' : ''}{r.totalPnlPct.toFixed(2)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Avg P&L</span><span className="text-[9px] font-bold" style={{ color: pnlColor }}>{r.avgPnlPct >= 0 ? '+' : ''}{r.avgPnlPct.toFixed(2)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Best</span><span className="text-[9px] font-bold" style={{ color: te.green }}>+{r.bestTradePct.toFixed(2)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Worst</span><span className="text-[9px] font-bold" style={{ color: te.red }}>{r.worstTradePct.toFixed(2)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Max DD</span><span className="text-[9px] font-bold" style={{ color: te.red }}>-{r.maxDrawdownPct.toFixed(2)}%</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Sharpe</span><span className="text-[9px] font-bold" style={{ color: r.sharpeRatio > 0 ? te.green : te.red }}>{r.sharpeRatio.toFixed(2)}</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Profit Factor</span><span className="text-[9px] font-bold" style={{ color: pfColor }}>{isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Avg Bars</span><span className="text-[9px] font-bold" style={{ color: te.text }}>{r.avgBarsHeld.toFixed(1)}</span></div>
                        </div>
                        <div className="mt-1 pt-1" style={{ borderTop: `1px solid ${te.border}` }}>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Long/Short</span><span className="text-[8px] font-bold"><span style={{ color: te.green }}>{r.longTrades}L</span> / <span style={{ color: te.red }}>{r.shortTrades}S</span></span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>L Win / S Win</span><span className="text-[8px] font-bold"><span style={{ color: te.green }}>{(r.longWinRate * 100).toFixed(0)}%</span> / <span style={{ color: te.red }}>{(r.shortWinRate * 100).toFixed(0)}%</span></span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Signals</span><span className="text-[8px] font-bold" style={{ color: te.cyan }}>{r.totalSignals}</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>BB touches</span><span className="text-[8px] font-bold" style={{ color: te.text }}>{r.bbTouchCount}</span></div>
                          <div className="flex items-center justify-between"><span className="text-[7px]" style={{ color: te.textDim }}>Hurst crosses</span><span className="text-[8px] font-bold" style={{ color: te.text }}>{r.hurstCrossCount}</span></div>
                        </div>
                      </div>
                      {/* Mini equity curve SVG */}
                      {r.equityCurve.length > 2 && (
                        <div className="rounded-sm p-1.5" style={{ background: te.bg, border: `1px solid ${te.border}` }}>
                          <div className="text-[7px] font-bold mb-0.5" style={{ color: te.textDim, letterSpacing: '0.06em' }}>EQUITY CURVE</div>
                          {(() => {
                            const eq = r.equityCurve
                            const min = Math.min(...eq)
                            const max = Math.max(...eq)
                            const range = max - min || 1
                            const w = 200, h = 50
                            const xStep = w / (eq.length - 1)
                            const pathD = eq.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * xStep).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ')
                            // Zero line
                            const zeroY = min < 0 && max > 0 ? (h - ((0 - min) / range) * h) : -1
                            return (
                              <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ fontFamily: te.mono }}>
                                {zeroY >= 0 && <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke={te.borderLight} strokeWidth={0.5} strokeDasharray="2,2" />}
                                <path d={pathD} fill="none" stroke={r.totalPnlPct >= 0 ? te.green : te.red} strokeWidth={1.2} />
                              </svg>
                            )
                          })()}
                        </div>
                      )}
                      {/* Trades table (last 10) */}
                      {r.trades.length > 0 && (
                        <div className="rounded-sm p-1.5" style={{ background: te.bg, border: `1px solid ${te.border}`, maxHeight: 120, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                          <div className="text-[7px] font-bold mb-0.5" style={{ color: te.textDim, letterSpacing: '0.06em' }}>TRADES ({r.trades.length})</div>
                          <table className="w-full text-[6px]" style={{ fontFamily: te.mono }}>
                            <thead><tr style={{ color: te.textDim }}><th className="text-left">SIDE</th><th className="text-right">P&L%</th><th className="text-right">BARS</th><th className="text-right">REASON</th><th className="text-right">H@E</th></tr></thead>
                            <tbody>{r.trades.slice(-10).reverse().map((t, i) => (
                              <tr key={i} style={{ borderBottom: `1px solid ${te.border}` }}>
                                <td className="font-bold" style={{ color: t.side === 'LONG' ? te.green : te.red }}>{t.side[0]}</td>
                                <td className="text-right font-bold" style={{ color: t.netPnlPct >= 0 ? te.green : te.red }}>{t.netPnlPct >= 0 ? '+' : ''}{t.netPnlPct.toFixed(2)}%</td>
                                <td className="text-right" style={{ color: te.textDim }}>{t.barsHeld}</td>
                                <td className="text-right" style={{ color: t.exitReason === 'TP' ? te.green : t.exitReason === 'SL' ? te.red : te.textDim }}>{t.exitReason}</td>
                                <td className="text-right" style={{ color: te.textDim }}>{t.hurstAtEntry !== null ? t.hurstAtEntry.toFixed(2) : '—'}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Trade buttons + leverage */}
          <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>LEVERAGE</span>
              <span className="text-[11px] font-bold" style={{ color: leverage > 10 ? te.red : leverage > 1 ? te.orange : te.text }}>{leverage}x</span>
            </div>
            <div className="flex gap-0.5 mb-2">
              {LEVERAGE_OPTIONS.map(lev => (
                <button key={lev} onClick={() => setLeverage(lev)} className="flex-1 py-1 rounded-sm text-[8px] font-bold transition-all" style={{ color: leverage === lev ? te.bg : (lev > 20 ? te.red : lev > 5 ? te.orange : te.textDim), background: leverage === lev ? (lev > 20 ? te.red : lev > 5 ? te.orange : te.text) : 'transparent', border: `1px solid ${leverage === lev ? 'transparent' : te.border}` }}>
                  {lev}x
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => handleOpenPosition('LONG')} disabled={positions.length >= MAX_POSITIONS || currentPairPrice <= 0} className="flex-1 py-1.5 rounded-sm text-[10px] font-bold transition-all disabled:opacity-30" style={{ color: te.green, background: te.greenBg, border: `1px solid ${te.green}44`, letterSpacing: '0.06em' }}>▲ LONG</button>
              <button onClick={() => handleOpenPosition('SHORT')} disabled={positions.length >= MAX_POSITIONS || currentPairPrice <= 0} className="flex-1 py-1.5 rounded-sm text-[10px] font-bold transition-all disabled:opacity-30" style={{ color: te.red, background: te.redBg, border: `1px solid ${te.red}44`, letterSpacing: '0.06em' }}>▼ SHORT</button>
            </div>
          </div>

          {/* Current price + data status */}
          <div className="rounded-sm p-2 text-center" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.1em' }}>{selectedAsset.symbol}</div>
            <div className="text-[8px] mb-0.5" style={{ color: te.textDim }}>{selectedAsset.fullName}</div>
            <div className="text-lg font-bold" style={{ color: currentPairPrice > 0 ? te.text : te.textDim }}>{currentPairPrice > 0 ? formatPrice(currentPairPrice, selectedAsset.decimals) : '—'}</div>
            <div className="text-[7px]" style={{ color: preseedDoneRef.current ? te.green : te.orange }}>
              {currentPairPrice > 0 ? (preseedDoneRef.current ? '● DATA READY' : '○ seeding...') : '○ no WS data'}
            </div>
            <div className="text-[6px] mt-0.5" style={{ color: te.textDim }}>
              15m: {priceHistoryRef.current['15m'].length} bars · 1h: {priceHistoryRef.current['1h'].length} bars
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom: Open + Closed Positions ──────────────────────────────── */}
      <div className="flex flex-shrink-0" style={{ borderTop: `1px solid ${te.border}`, maxHeight: '220px' }}>
        <div className="flex-1 overflow-hidden" style={{ borderRight: `1px solid ${te.border}` }}>
          <div className="px-3 py-0.5 text-[8px] font-bold" style={{ color: te.cyan, letterSpacing: '0.12em', background: te.bgCard, borderBottom: `1px solid ${te.border}` }}>OPEN ({positions.length})</div>
          <div className="overflow-y-auto" style={{ maxHeight: '190px', scrollbarWidth: 'thin' }}>
            {positions.length === 0 ? <div className="px-3 py-2 text-[8px] text-center" style={{ color: te.textDim }}>No open positions</div> : (
              <table className="w-full text-[7px]" style={{ fontFamily: te.mono }}>
                <thead><tr style={{ color: te.textDim, borderBottom: `1px solid ${te.border}` }}><th className="px-1 py-0.5 text-left font-bold">PAIR</th><th className="px-1 py-0.5 text-left font-bold">SIDE</th><th className="px-1 py-0.5 text-right font-bold">LEV</th><th className="px-1 py-0.5 text-right font-bold">ENTRY</th><th className="px-1 py-0.5 text-right font-bold">P&L</th><th className="px-1 py-0.5 text-right font-bold">SL</th><th className="px-1 py-0.5 text-right font-bold">TP</th><th className="px-1 py-0.5 text-right font-bold">H@E</th><th className="px-1 py-0.5 text-right font-bold">ACT</th></tr></thead>
                <tbody>{positions.map(pos => {
                  const posPairPrice = getPriceForPair(pos.pair)
                  const dir = pos.side === 'LONG' ? 1 : -1
                  const rawPct = posPairPrice > 0 ? dir * (posPairPrice - pos.entryPrice) / pos.entryPrice * 100 : 0
                  const grossPnl = (rawPct * pos.leverage) / 100 * pos.size
                  const leveragedPct = rawPct * pos.leverage
                  const eFee = pos.size * pos.leverage * MEXC_TAKER_FEE
                  const xFee = posPairPrice > 0 ? (pos.size * pos.leverage * (posPairPrice / pos.entryPrice)) * MEXC_TAKER_FEE : 0
                  const leveragedPnl = grossPnl - eFee - xFee
                  const dec = HURST_ASSETS.find(a => a.symbol === pos.pair)?.decimals ?? 2
                  const slPrice = pos.side === 'LONG' ? pos.entryPrice * (1 - pos.slPct / 100) : pos.entryPrice * (1 + pos.slPct / 100)
                  const tpPrice = pos.side === 'LONG' ? pos.entryPrice * (1 + pos.tpPct / 100) : pos.entryPrice * (1 - pos.tpPct / 100)
                  return (<tr key={pos.id} style={{ borderBottom: `1px solid ${te.border}` }}>
                    <td className="px-1 py-0.5 font-bold" style={{ color: te.text }}>{pos.pair.replace('-USDT', '')}</td>
                    <td className="px-1 py-0.5 font-bold" style={{ color: pos.side === 'LONG' ? te.green : te.red }}>{pos.side}</td>
                    <td className="px-1 py-0.5 text-right font-bold" style={{ color: pos.leverage > 10 ? te.red : pos.leverage > 1 ? te.orange : te.textDim }}>{pos.leverage}x</td>
                    <td className="px-1 py-0.5 text-right" style={{ color: te.textMuted }}>{formatPrice(pos.entryPrice, dec)}</td>
                    <td className="px-1 py-0.5 text-right font-bold" style={{ color: leveragedPnl >= 0 ? te.green : te.red }}>{formatPnl(leveragedPnl)} ({formatPct(leveragedPct)})</td>
                    <td className="px-1 py-0.5 text-right" style={{ color: te.red }}>{formatPrice(slPrice, dec)}</td>
                    <td className="px-1 py-0.5 text-right" style={{ color: te.green }}>{formatPrice(tpPrice, dec)}</td>
                    <td className="px-1 py-0.5 text-right" style={{ color: pos.hurstAtEntry < 0.45 ? te.green : pos.hurstAtEntry > 0.55 ? te.orange : te.textDim }}>{pos.hurstAtEntry.toFixed(2)}</td>
                    <td className="px-1 py-0.5 text-right"><button onClick={() => handleClosePosition(pos.id)} className="px-1 py-0.5 rounded-sm text-[7px] font-bold" style={{ color: te.red, background: te.redBg, border: `1px solid ${te.red}44` }}>CLOSE</button></td>
                  </tr>)
                })}</tbody>
              </table>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="px-3 py-0.5 text-[8px] font-bold flex items-center gap-2" style={{ color: te.textDim, letterSpacing: '0.12em', background: te.bgCard, borderBottom: `1px solid ${te.border}` }}>
            <span>HISTORY ({closedPositions.length})</span>
            {closedPositions.length > 0 && <button onClick={handleExportCSV} className="px-1.5 py-0.5 rounded-sm text-[7px] font-bold" style={{ color: te.cyan, background: te.cyanBg, border: `1px solid ${te.cyan}44` }}>EXPORT CSV</button>}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '190px', scrollbarWidth: 'thin' }}>
            {closedPositions.length === 0 ? <div className="px-3 py-2 text-[8px] text-center" style={{ color: te.textDim }}>No trade history</div> : (
              <table className="w-full text-[7px]" style={{ fontFamily: te.mono }}>
                <thead><tr style={{ color: te.textDim, borderBottom: `1px solid ${te.border}` }}><th className="px-1 py-0.5 text-left font-bold">PAIR</th><th className="px-1 py-0.5 text-left font-bold">SIDE</th><th className="px-1 py-0.5 text-right font-bold">LEV</th><th className="px-1 py-0.5 text-right font-bold">P&L</th><th className="px-1 py-0.5 text-right font-bold">FEE</th><th className="px-1 py-0.5 text-right font-bold">ENTRY</th><th className="px-1 py-0.5 text-right font-bold">EXIT</th><th className="px-1 py-0.5 text-right font-bold">REASON</th></tr></thead>
                <tbody>{closedPositions.map(pos => (<tr key={pos.id} style={{ borderBottom: `1px solid ${te.border}` }}>
                  <td className="px-1 py-0.5 font-bold" style={{ color: te.text }}>{pos.pair.replace('-USDT', '')}</td>
                  <td className="px-1 py-0.5 font-bold" style={{ color: pos.side === 'LONG' ? te.green : te.red }}>{pos.side}</td>
                  <td className="px-1 py-0.5 text-right font-bold" style={{ color: pos.leverage > 10 ? te.red : pos.leverage > 1 ? te.orange : te.textDim }}>{pos.leverage}x</td>
                  <td className="px-1 py-0.5 text-right font-bold" style={{ color: pos.pnl >= 0 ? te.green : te.red }}>{formatPnl(pos.pnl)} ({formatPct(pos.pnlPct)})</td>
                  <td className="px-1 py-0.5 text-right" style={{ color: te.textDim }}>-${pos.fee.toFixed(2)}</td>
                  <td className="px-1 py-0.5 text-right" style={{ color: te.textMuted }}>{formatPrice(pos.entryPrice, HURST_ASSETS.find(a => a.symbol === pos.pair)?.decimals ?? 2)}</td>
                  <td className="px-1 py-0.5 text-right" style={{ color: te.textMuted }}>{formatPrice(pos.exitPrice, HURST_ASSETS.find(a => a.symbol === pos.pair)?.decimals ?? 2)}</td>
                  <td className="px-1 py-0.5 text-right" style={{ color: te.textDim }}>{pos.closeReason}</td>
                </tr>))}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>

            <PnLCurveSVG closedPositions={closedPositions} startingBalance={wallet.startingBalance} te={te} />

      {/* ─── Signal Stats Floating Panel ─────────────────────────────────── */}
      <SignalStatsPanel
        events={signalEvents}
        onClear={() => { setSignalEvents([]); clearSessionEvents() }}
      />
    </div>
  )
}

export default HurstTab
