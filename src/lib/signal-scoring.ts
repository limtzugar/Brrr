// ─── Signal Scoring Engine ──────────────────────────────────────────────────
// Session-based scoring for Hurst HCCCO signals AND CEX Anomaly signals.
// Each signal type gets points:
//   +points when trade closes in profit (TAKE PROFIT, quick profit)
//   -penalty when trade closes in loss (STOP LOSS)
//   0 for MANUAL / SIGNAL_FLIP / TIMEOUT (neutral)
// Scoring resets when the session ends (page reload / tab close).
// All events persist to localStorage for later analysis.

import type { AnomalyCategory } from './cex-anomaly-types'

// ─── CEX Anomaly signal types (one per anomaly category) ──────────────────────
// These are the categories that can trigger positions in CEX Anomaly tab.

export const CEX_ANOMALY_SIGNAL_TYPES = [
  'ICEBERG_DETECTED',
  'ICEBERG_REVERSAL',
  'WHALE_INFLOW',
  'AGGRESSIVE_ABSORPTION',
  'OI_SPIKE',
  'FUNDING_EXTREME',
  'CROWD_BIAS',
  'TAKER_IMBALANCE',
  'LIQUIDATION_CASCADE',
  'OI_VELOCITY',
  'ORDERBOOK_IMBALANCE',
  'WHALE_SWEEP',
  'REALTIME_LIQUIDATION',
  'OPTIONS_FLOW',
  'GATE_FLOW',
  'BITGET_FLOW',
  'DYDX_PERP_FLOW',
  'MACRO_EVENT',
  // ── RSI 15m virtual signals ──
  'RSI_15M_OVERBOUGHT',   // RSI 15m >= 76.50 → SHORT overvaluation
  'RSI_15M_OVERSOLD',     // RSI 15m <= 26.50 → LONG wyprzedane
  // ── MACD virtual signals ──
  'MACD_BEAR_CROSS',     // MACD histogram crosses below 0 → SHORT
  'MACD_BULL_CROSS',     // MACD histogram crosses above 0 → LONG
] as const

export type CexAnomalySignalType = typeof CEX_ANOMALY_SIGNAL_TYPES[number]

// ─── Hurst HCCCO signal types ──────────────────────────────────────────────

export type HurstSignalType =
  | 'OS_CROSS_UP'    // HCCCO fast crosses above 0 → LONG
  | 'OB_CROSS_DOWN'  // HCCCO fast crosses below 1 → SHORT
  | 'MANUAL_LONG'
  | 'MANUAL_SHORT'
  | 'AUTO_LONG'
  | 'AUTO_SHORT'

// ─── Unified Signal Type ────────────────────────────────────────────────────

export type SignalType = HurstSignalType | CexAnomalySignalType

export type CloseReason = 'TAKE PROFIT' | 'STOP LOSS' | 'SIGNAL FLIP' | 'MANUAL' | 'TIMEOUT' | 'TRAILING' | 'BREAKEVEN'

export interface SignalScore {
  signalType: SignalType
  totalTrades: number
  wins: number
  losses: number
  neutrals: number
  totalPnl: number
  totalPnlPct: number
  points: number
  avgPnl: number
  winRate: number
}

export interface SignalEvent {
  sessionId: string
  timestamp: string
  signalType: SignalType
  pair: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPct: number
  closeReason: CloseReason
  leverage: number
  // Hurst-specific fields (0 for CEX Anomaly events)
  hurstAtEntry: number
  hcccoFastAtEntry: number
  hcccoSlowAtEntry: number
  // CEX Anomaly-specific fields (0 for Hurst events)
  confidenceScore: number
  anomalyCategory: string
  pointsDelta: number
  runningTotal: number
}

// ─── Scoring Rules ─────────────────────────────────────────────────────────

const POINTS_CONFIG: Record<CloseReason, { win: number; loss: number; neutral: number }> = {
  'TAKE PROFIT': { win: +3, loss: 0, neutral: 0 },
  'STOP LOSS':   { win: 0, loss: -2, neutral: 0 },  // rarely used now — trailing-only mode
  'SIGNAL FLIP': { win: +1, loss: -1, neutral: 0 },
  'MANUAL':      { win: +1, loss: -1, neutral: 0 },
  'TIMEOUT':     { win: +1, loss: -1, neutral: 0 },
  'TRAILING':    { win: +3, loss: 0, neutral: 0 },   // raised from +2 — trailing is primary exit
  'BREAKEVEN':   { win: 0, loss: 0, neutral: 0 },
}

// Bonus for big wins (>5% position PnL)
const BIG_WIN_THRESHOLD_PCT = 5.0
const BIG_WIN_BONUS = +2

// Penalty for big losses (>3% position PnL)
const BIG_LOSS_THRESHOLD_PCT = -3.0
const BIG_LOSS_PENALTY = -1

export function calculatePointsDelta(pnlPct: number, closeReason: CloseReason): number {
  const isWin = pnlPct > 0
  const isLoss = pnlPct < 0
  const config = POINTS_CONFIG[closeReason] || POINTS_CONFIG['MANUAL']

  let delta = 0
  if (isWin) delta = config.win
  else if (isLoss) delta = config.loss
  else delta = config.neutral

  // Bonus / penalty for magnitude
  if (pnlPct >= BIG_WIN_THRESHOLD_PCT) delta += BIG_WIN_BONUS
  if (pnlPct <= BIG_LOSS_THRESHOLD_PCT) delta += BIG_LOSS_PENALTY

  return delta
}

// ─── Determine Signal Type from Hurst Position ────────────────────────────

export function determineSignalType(
  side: 'LONG' | 'SHORT',
  isAuto: boolean,
  hcccoFastAtEntry: number,
  hcccoSlowAtEntry: number,
): HurstSignalType {
  if (isAuto) {
    if (side === 'LONG') return 'OS_CROSS_UP'
    if (side === 'SHORT') return 'OB_CROSS_DOWN'
  }
  // For manual trades, use HCCCO values to guess the trigger
  if (hcccoFastAtEntry < 0.2 && side === 'LONG') return 'OS_CROSS_UP'
  if (hcccoFastAtEntry > 0.8 && side === 'SHORT') return 'OB_CROSS_DOWN'
  if (side === 'LONG') return 'MANUAL_LONG'
  return 'MANUAL_SHORT'
}

// ─── Determine Signal Type from CEX Anomaly Position ──────────────────────

export function determineCexSignalType(anomalyCategory: AnomalyCategory): CexAnomalySignalType {
  // Validate that the category is a known CEX anomaly signal type
  if (CEX_ANOMALY_SIGNAL_TYPES.includes(anomalyCategory as any)) {
    return anomalyCategory as CexAnomalySignalType
  }
  // Fallback — should never happen
  return 'AGGRESSIVE_ABSORPTION'
}

// ─── Map CEX Anomaly position status to CloseReason ──────────────────────

export function mapCexStatusToCloseReason(status: string): CloseReason {
  switch (status) {
    case 'CLOSED_TP':
    case 'CLOSED_BURST_TP':
    case 'CLOSED_COLLECTIVE_TP':
    case 'CLOSED_QUICK_PROFIT':
      return 'TAKE PROFIT'
    case 'LIQUIDATED':
      return 'STOP LOSS'
    case 'CLOSED_TIMEOUT':
    case 'CLOSED_STALE':
      return 'TIMEOUT'
    case 'CLOSED_TRAILING':
      return 'TRAILING'
    case 'CLOSED_BREAKEVEN':
      return 'BREAKEVEN'
    case 'CLOSED_SIGNAL_EXIT':
    case 'CLOSED_MOM_DIV':
    case 'CLOSED_VWAP_CROSS':
      return 'SIGNAL FLIP'
    case 'CLOSED_MANUAL':
    default:
      return 'MANUAL'
  }
}

// ─── Score Aggregation ─────────────────────────────────────────────────────

export function aggregateScores(events: SignalEvent[]): Map<SignalType, SignalScore> {
  const map = new Map<SignalType, SignalScore>()

  for (const ev of events) {
    const existing = map.get(ev.signalType) || {
      signalType: ev.signalType,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      neutrals: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      points: 0,
      avgPnl: 0,
      winRate: 0,
    }

    existing.totalTrades++
    existing.totalPnl += ev.pnl
    existing.totalPnlPct += ev.pnlPct
    existing.points += ev.pointsDelta

    if (ev.pnl > 0) existing.wins++
    else if (ev.pnl < 0) existing.losses++
    else existing.neutrals++

    map.set(ev.signalType, existing)
  }

  // Compute averages
  for (const [, score] of map) {
    score.avgPnl = score.totalTrades > 0 ? score.totalPnl / score.totalTrades : 0
    score.winRate = score.totalTrades > 0 ? (score.wins / score.totalTrades) * 100 : 0
  }

  return map
}

// ─── CSV Persistence ────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'sessionId', 'timestamp', 'signalType', 'pair', 'side',
  'entryPrice', 'exitPrice', 'pnl', 'pnlPct', 'closeReason',
  'leverage', 'hurstAtEntry', 'hcccoFastAtEntry', 'hcccoSlowAtEntry',
  'confidenceScore', 'anomalyCategory',
  'pointsDelta', 'runningTotal',
]

export function eventToCsvRow(ev: SignalEvent): string {
  return [
    ev.sessionId,
    ev.timestamp,
    ev.signalType,
    ev.pair,
    ev.side,
    ev.entryPrice.toFixed(2),
    ev.exitPrice.toFixed(2),
    ev.pnl.toFixed(4),
    ev.pnlPct.toFixed(2),
    ev.closeReason,
    ev.leverage,
    ev.hurstAtEntry.toFixed(3),
    ev.hcccoFastAtEntry.toFixed(2),
    ev.hcccoSlowAtEntry.toFixed(2),
    ev.confidenceScore,
    ev.anomalyCategory,
    ev.pointsDelta,
    ev.runningTotal,
  ].join(',')
}

export function createCsvHeader(): string {
  return CSV_HEADERS.join(',')
}

export function eventsToCsv(events: SignalEvent[]): string {
  const rows = events.map(eventToCsvRow)
  return [createCsvHeader(), ...rows].join('\n')
}

// ─── Session ID Management ─────────────────────────────────────────────────

export function getSessionId(key: string = 'hurst_signal_session_id'): string {
  let id = ''
  try {
    id = sessionStorage.getItem(key) || ''
  } catch {}
  if (!id) {
    id = `S-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    try {
      sessionStorage.setItem(key, id)
    } catch {}
  }
  return id
}

/** Get CEX Anomaly session ID (separate from Hurst) */
export function getCexSessionId(): string {
  return getSessionId('cex_signal_session_id')
}

// ─── Signal Type Display ────────────────────────────────────────────────────

export const SIGNAL_TYPE_META: Record<SignalType, { label: string; color: string; description: string }> = {
  // Hurst HCCCO signals
  OS_CROSS_UP:   { label: 'OS↑',  color: '#22c55e', description: 'HCCCO oversold cross up → LONG' },
  OB_CROSS_DOWN: { label: 'OB↓',  color: '#ef4444', description: 'HCCCO overbought cross down → SHORT' },
  MANUAL_LONG:   { label: 'M↑',   color: '#06b6d4', description: 'Manual LONG entry' },
  MANUAL_SHORT:  { label: 'M↓',   color: '#f97316', description: 'Manual SHORT entry' },
  AUTO_LONG:     { label: 'A↑',   color: '#22c55e', description: 'Auto LONG entry' },
  AUTO_SHORT:    { label: 'A↓',   color: '#ef4444', description: 'Auto SHORT entry' },
  // CEX Anomaly signals
  ICEBERG_DETECTED:     { label: 'ICE',  color: '#06b6d4', description: 'Iceberg detected — hidden liquidity' },
  ICEBERG_REVERSAL:    { label: 'ICE-R', color: '#00e5ff', description: 'Iceberg reversal — fade the whale' },
  WHALE_INFLOW:        { label: 'WHL',  color: '#a855f7', description: 'Whale inflow — large deposit to exchange' },
  AGGRESSIVE_ABSORPTION: { label: 'ABS', color: '#22c55e', description: 'Aggressive absorption — copy the buyer' },
  OI_SPIKE:            { label: 'OI',   color: '#eab308', description: 'OI spike — mass position entry' },
  FUNDING_EXTREME:     { label: 'FND',  color: '#ef4444', description: 'Funding extreme — contrarian signal' },
  CROWD_BIAS:          { label: 'CRD',  color: '#ff8c00', description: 'Crowd bias — follow the majority' },
  TAKER_IMBALANCE:     { label: 'TKR',  color: '#ff4081', description: 'Taker imbalance — direct pressure' },
  LIQUIDATION_CASCADE: { label: 'LIQ',  color: '#ff3333', description: 'Liquidation cascade — momentum' },
  OI_VELOCITY:         { label: 'OIV',  color: '#ffd700', description: 'OI velocity — building position' },
  ORDERBOOK_IMBALANCE: { label: 'OB',   color: '#00ff88', description: 'Orderbook imbalance — follow pressure' },
  WHALE_SWEEP:         { label: 'SWP',  color: '#ff00aa', description: 'Whale sweep — follow whale direction' },
  REALTIME_LIQUIDATION: { label: 'RTL', color: '#ff5555', description: 'Real-time liquidation — sub-second feed' },
  OPTIONS_FLOW:        { label: 'OPT',  color: '#9333ea', description: 'Options flow — put/call/IV signal' },
  GATE_FLOW:           { label: 'GTE',  color: '#14b8a6', description: 'Gate.io flow — OB imbalance + whale' },
  BITGET_FLOW:         { label: 'BGT',  color: '#f59e0b', description: 'Bitget flow — depth + trades' },
  DYDX_PERP_FLOW:      { label: 'DYDX', color: '#6366f1', description: 'dYdX perp flow — on-chain order flow' },
  MACRO_EVENT:         { label: 'MAC',  color: '#8b5cf6', description: 'Macro event — CPI/FOMC/NFP' },
  // RSI 15m virtual signals
  RSI_15M_OVERBOUGHT:   { label: 'RSI▼', color: '#ff6b6b', description: 'RSI 15m >= 76.50 → SHORT overvaluation' },
  RSI_15M_OVERSOLD:     { label: 'RSI▲', color: '#51cf66', description: 'RSI 15m <= 26.50 → LONG wyprzedane' },
  // MACD virtual signals
  MACD_BEAR_CROSS:    { label: 'MACD▼', color: '#ff4757', description: 'MACD histogram crosses below 0 → SHORT' },
  MACD_BULL_CROSS:    { label: 'MACD▲', color: '#2ed573', description: 'MACD histogram crosses above 0 → LONG' },
}

// ─── LocalStorage persistence (survives HMR but not tab close) ──────────────

const HURST_STORAGE_KEY = 'hurst_signal_events_session'
const CEX_STORAGE_KEY = 'cex_signal_events_session'

export function loadSessionEvents(storageKey: string = HURST_STORAGE_KEY): SignalEvent[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveSessionEvents(events: SignalEvent[], storageKey: string = HURST_STORAGE_KEY, sessionKey: string = 'hurst_signal_session_id'): void {
  try {
    // Keep events from last 30 days (not just current session) for backtesting
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentEvents = events.filter(e => new Date(e.timestamp).getTime() >= cutoff)
    localStorage.setItem(storageKey, JSON.stringify(recentEvents.slice(-2000))) // max 2000 events
  } catch {}
}

export function clearSessionEvents(storageKey: string = HURST_STORAGE_KEY): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {}
}

// ─── CEX Anomaly specific persistence helpers ──────────────────────────────

export function loadCexSessionEvents(): SignalEvent[] {
  return loadSessionEvents(CEX_STORAGE_KEY)
}

export function saveCexSessionEvents(events: SignalEvent[]): void {
  saveSessionEvents(events, CEX_STORAGE_KEY, 'cex_signal_session_id')
}

export function clearCexSessionEvents(): void {
  clearSessionEvents(CEX_STORAGE_KEY)
}
