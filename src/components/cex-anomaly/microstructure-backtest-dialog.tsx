'use client'

// ─── Microstructure Radar Backtest Dialog ──────────────────────────────────
// Popup dialog that backtests CEX Anomaly signals using Binance 5m candles.
// TP = 2% price move, SL = 6.5% price move.
// Shows per-category stats, trade list, and overall summary.
// Supports filtering by signal type, pair, and backtest period.

import { useState, useCallback, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useTE } from '@/lib/te-theme'
import {
  runMicrostructureBacktest,
  runHistoricalBacktest,
  BACKTEST_CONFIG,
  PAIR_TO_BINANCE,
  type BacktestResults,
  type BacktestTrade,
  type BacktestCategoryStats,
} from '@/lib/microstructure-backtest-engine'
import type { SignalEvent, CexAnomalySignalType } from '@/lib/signal-scoring'
import { SIGNAL_TYPE_META, CEX_ANOMALY_SIGNAL_TYPES } from '@/lib/signal-scoring'
import {
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Trophy,
  Timer,
  Filter,
  DollarSign,
  Calendar,
} from 'lucide-react'

// ─── Props ───────────────────────────────────────────────────────────────

interface MicrostructureBacktestDialogProps {
  signalEvents: SignalEvent[]
}

// ─── Backtest Period Options ────────────────────────────────────────────

const BACKTEST_PERIODS = [
  { label: '3d', days: 3 },
  { label: '7d', days: 7 },
  { label: '10d', days: 10 },
  { label: '30d', days: 30 },
  { label: 'ALL', days: 0 },
] as const

type BacktestPeriod = typeof BACKTEST_PERIODS[number]['label']

// ─── Formatting ──────────────────────────────────────────────────────────

function fmtPct(v: number, sign = true): string {
  const s = sign && v >= 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}

function fmtUsd(v: number, sign = true): string {
  const s = sign && v >= 0 ? '+' : ''
  return `${s}$${Math.abs(v).toFixed(2)}`
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m.toFixed(0)}m`
  const h = Math.floor(m / 60)
  const mins = m % 60
  return `${h}h ${mins.toFixed(0)}m`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pl-PL', { month: '2-digit', day: '2-digit' })
}

// ─── Category Stats Table ────────────────────────────────────────────────

function CategoryStatsTable({ stats }: { stats: BacktestCategoryStats[] }) {
  const te = useTE()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (stats.length === 0) {
    return (
      <div style={{ color: te.textDim, padding: '16px', textAlign: 'center' }}>
        Brak danych do wyświetlenia
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${te.border}` }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', color: te.textDim }}>Kategoria</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', color: te.textDim }}>Trades</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', color: te.textDim }}>Win%</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', color: te.textDim }}>W/L/T</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>Avg PnL</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>Total PnL</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>Total $</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>PF</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>Avg Hold</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((cat) => {
            const isExpanded = expanded === cat.category
            return (
              <tr
                key={cat.category}
                style={{
                  borderBottom: `1px solid ${te.border}33`,
                  cursor: 'pointer',
                  background: isExpanded ? `${te.orange}10` : 'transparent',
                }}
                onClick={() => setExpanded(isExpanded ? null : cat.category)}
              >
                <td style={{ padding: '6px 8px', color: cat.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <span style={{ marginRight: '4px', display: 'inline-block', width: '12px' }}>
                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </span>
                  {cat.label}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: te.text }}>{cat.totalTrades}</td>
                <td style={{
                  padding: '6px 8px',
                  textAlign: 'center',
                  color: cat.winRate >= 50 ? te.green : cat.winRate >= 30 ? te.orange : te.red,
                  fontWeight: 600,
                }}>
                  {cat.winRate.toFixed(1)}%
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: te.textDim, fontSize: '10px' }}>
                  <span style={{ color: te.green }}>{cat.wins}</span>
                  <span style={{ color: te.textDim }}>/</span>
                  <span style={{ color: te.red }}>{cat.losses}</span>
                  <span style={{ color: te.textDim }}>/</span>
                  <span style={{ color: te.orange }}>{cat.timeouts}</span>
                </td>
                <td style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  color: cat.avgPnlPct >= 0 ? te.green : te.red,
                  fontWeight: 500,
                }}>
                  {fmtPct(cat.avgPnlPct)}
                </td>
                <td style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  color: cat.totalPnlPct >= 0 ? te.green : te.red,
                  fontWeight: 600,
                }}>
                  {fmtPct(cat.totalPnlPct)}
                </td>
                <td style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  color: cat.totalPnlUsd >= 0 ? te.green : te.red,
                  fontWeight: 600,
                }}>
                  {fmtUsd(cat.totalPnlUsd)}
                </td>
                <td style={{
                  padding: '6px 8px',
                  textAlign: 'right',
                  color: cat.profitFactor >= 1.5 ? te.green : cat.profitFactor >= 1 ? te.orange : te.red,
                  fontWeight: 500,
                }}>
                  {cat.profitFactor >= 999 ? '∞' : cat.profitFactor.toFixed(2)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: te.textDim }}>
                  {fmtMinutes(cat.avgHoldMinutes)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Trade List (fully scrollable) ──────────────────────────────────────

function TradeList({ trades }: { trades: BacktestTrade[] }) {
  const te = useTE()

  if (trades.length === 0) {
    return (
      <div style={{ color: te.textDim, padding: '16px', textAlign: 'center' }}>
        Brak trade&apos;ów
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1, border: `1px solid ${te.border}33`, borderRadius: '4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
        <thead style={{ position: 'sticky', top: 0, background: te.bg, zIndex: 1 }}>
          <tr style={{ borderBottom: `1px solid ${te.border}` }}>
            <th style={{ padding: '4px 6px', textAlign: 'left', color: te.textDim }}>Data</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', color: te.textDim }}>Czas</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', color: te.textDim }}>Para</th>
            <th style={{ padding: '4px 6px', textAlign: 'center', color: te.textDim }}>Strona</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', color: te.textDim }}>Sygnał</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', color: te.textDim }}>Entry</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', color: te.textDim }}>Exit</th>
            <th style={{ padding: '4px 6px', textAlign: 'center', color: te.textDim }}>Rsn</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', color: te.textDim }}>Net PnL</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', color: te.textDim }}>PnL $</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', color: te.textDim }}>Hold</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, idx) => {
            const meta = SIGNAL_TYPE_META[trade.signal.signalType as CexAnomalySignalType]
            return (
              <tr
                key={idx}
                style={{
                  borderBottom: `1px solid ${te.border}22`,
                  background: trade.netPnlPct > 0 ? `${te.green}08` : trade.netPnlPct < 0 ? `${te.red}08` : 'transparent',
                }}
              >
                <td style={{ padding: '3px 6px', color: te.textDim, whiteSpace: 'nowrap' }}>
                  {fmtDate(trade.entryTs)}
                </td>
                <td style={{ padding: '3px 6px', color: te.textDim, whiteSpace: 'nowrap' }}>
                  {fmtTime(trade.entryTs)}
                </td>
                <td style={{ padding: '3px 6px', color: te.text, whiteSpace: 'nowrap' }}>
                  {trade.pair.split('-')[0]}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                  {trade.side === 'LONG' ? (
                    <TrendingUp size={10} style={{ color: te.green, display: 'inline' }} />
                  ) : (
                    <TrendingDown size={10} style={{ color: te.red, display: 'inline' }} />
                  )}
                </td>
                <td style={{ padding: '3px 6px', color: meta?.color || te.textDim, whiteSpace: 'nowrap' }}>
                  {meta?.label || trade.signal.signalType}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: te.text }}>
                  {trade.entryPrice >= 1
                    ? trade.entryPrice.toFixed(2)
                    : trade.entryPrice.toFixed(6)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: te.text }}>
                  {trade.dataAvailable
                    ? trade.exitPrice >= 1
                      ? trade.exitPrice.toFixed(2)
                      : trade.exitPrice.toFixed(6)
                    : '—'}
                </td>
                <td style={{
                  padding: '3px 6px',
                  textAlign: 'center',
                  color: trade.exitReason === 'TAKE_PROFIT'
                    ? te.green
                    : trade.exitReason === 'STOP_LOSS'
                      ? te.red
                      : te.orange,
                  whiteSpace: 'nowrap',
                }}>
                  {trade.exitReason === 'TAKE_PROFIT' ? 'TP' : trade.exitReason === 'STOP_LOSS' ? 'SL' : 'TMO'}
                </td>
                <td style={{
                  padding: '3px 6px',
                  textAlign: 'right',
                  color: trade.netPnlPct >= 0 ? te.green : te.red,
                  fontWeight: 600,
                }}>
                  {trade.dataAvailable ? fmtPct(trade.netPnlPct) : '—'}
                </td>
                <td style={{
                  padding: '3px 6px',
                  textAlign: 'right',
                  color: trade.netPnlUsd >= 0 ? te.green : te.red,
                  fontWeight: 600,
                }}>
                  {trade.dataAvailable ? fmtUsd(trade.netPnlUsd) : '—'}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: te.textDim }}>
                  {trade.dataAvailable ? fmtMinutes(trade.holdMinutes) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Overall Stats Panel ─────────────────────────────────────────────────

function OverallStatsPanel({ stats }: { stats: BacktestResults['overallStats'] }) {
  const te = useTE()

  const statItems = [
    { label: 'Total Trades', value: String(stats.totalTrades), color: te.text },
    { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? te.green : stats.winRate >= 30 ? te.orange : te.red, icon: <Trophy size={12} /> },
    { label: 'W / L / TMO', value: `${stats.wins} / ${stats.losses} / ${stats.timeouts}`, color: te.textDim },
    { label: 'Avg PnL', value: fmtPct(stats.avgPnlPct), color: stats.avgPnlPct >= 0 ? te.green : te.red },
    { label: 'Total PnL', value: fmtPct(stats.totalPnlPct), color: stats.totalPnlPct >= 0 ? te.green : te.red, icon: stats.totalPnlPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} /> },
    { label: 'Total PnL $', value: fmtUsd(stats.totalPnlUsd), color: stats.totalPnlUsd >= 0 ? te.green : te.red, icon: <DollarSign size={12} /> },
    { label: 'Avg Trade $', value: fmtUsd(stats.avgPnlUsd), color: stats.avgPnlUsd >= 0 ? te.green : te.red },
    { label: 'Best Trade', value: fmtPct(stats.bestTradePct), color: te.green, icon: <CheckCircle2 size={12} /> },
    { label: 'Worst Trade', value: fmtPct(stats.worstTradePct), color: te.red, icon: <XCircle size={12} /> },
    { label: 'Profit Factor', value: stats.profitFactor >= 999 ? '∞' : stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1.5 ? te.green : stats.profitFactor >= 1 ? te.orange : te.red, icon: <BarChart3 size={12} /> },
    { label: 'Avg Hold', value: fmtMinutes(stats.avgHoldMinutes), color: te.textDim, icon: <Timer size={12} /> },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: '6px',
      padding: '8px',
    }}>
      {statItems.map((item) => (
        <div
          key={item.label}
          style={{
            background: `${te.border}15`,
            border: `1px solid ${te.border}33`,
            padding: '6px 8px',
            borderRadius: '4px',
          }}
        >
          <div style={{ fontSize: '8px', color: te.textDim, fontFamily: 'JetBrains Mono, monospace', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            {item.icon}
            {item.label}
          </div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: item.color, fontFamily: 'JetBrains Mono, monospace' }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Chip Toggle ────────────────────────────────────────────────────────

function ChipToggle({
  label, color, active, onClick, count,
}: {
  label: string; color: string; active: boolean; onClick: () => void; count?: number
}) {
  const te = useTE()
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        padding: '2px 6px',
        fontSize: '9px',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: active ? 600 : 400,
        background: active ? `${color}20` : 'transparent',
        border: `1px solid ${active ? color : te.border}66`,
        color: active ? color : te.textDim,
        borderRadius: '3px',
        cursor: 'pointer',
        transition: 'all 0.1s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {count !== undefined && <span style={{ fontSize: '8px', opacity: 0.7 }}>({count})</span>}
    </button>
  )
}

// ─── Period Button ────────────────────────────────────────────────────

function PeriodButton({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void
}) {
  const te = useTE()
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        fontSize: '9px',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: active ? 700 : 400,
        background: active ? `${te.orange}25` : 'transparent',
        border: `1px solid ${active ? te.orange : te.border}66`,
        color: active ? te.orange : te.textDim,
        borderRadius: '3px',
        cursor: 'pointer',
        transition: 'all 0.1s',
      }}
    >
      {label}
    </button>
  )
}

// ─── Main Dialog Component ───────────────────────────────────────────────

export function MicrostructureBacktestDialog({
  signalEvents,
}: MicrostructureBacktestDialogProps) {
  const te = useTE()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [results, setResults] = useState<BacktestResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'stats' | 'trades'>('stats')
  const abortRef = useRef(false)

  // ── Filter state ──
  const [selectedSignals, setSelectedSignals] = useState<Set<CexAnomalySignalType>>(() => new Set(CEX_ANOMALY_SIGNAL_TYPES as readonly string[] as CexAnomalySignalType[]))
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set())
  const [maxCandles, setMaxCandles] = useState(60)
  const [backtestPeriod, setBacktestPeriod] = useState<BacktestPeriod>('7d')
  const [capitalPerTrade, setCapitalPerTrade] = useState(100)
  const [btLeverage, setBtLeverage] = useState(3)
  const [scanPhase, setScanPhase] = useState<string>('')

  // All CEX anomaly signals (exclude Hurst/manual/auto)
  const cexSignals = useMemo(() =>
    signalEvents.filter(s =>
      s.signalType !== 'OS_CROSS_UP' && s.signalType !== 'OB_CROSS_DOWN' &&
      s.signalType !== 'MANUAL_LONG' && s.signalType !== 'MANUAL_SHORT' &&
      s.signalType !== 'AUTO_LONG' && s.signalType !== 'AUTO_SHORT'
    ), [signalEvents])

  // Filter signals by selected backtest period
  const periodFilteredSignals = useMemo(() => {
    const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
    if (!periodConfig || periodConfig.days === 0) return cexSignals // ALL = no time filter

    const cutoff = Date.now() - periodConfig.days * 24 * 60 * 60 * 1000
    return cexSignals.filter(s => {
      const ts = new Date(s.timestamp).getTime()
      return ts >= cutoff
    })
  }, [cexSignals, backtestPeriod])

  // Unique signal types present in data
  const availableSignalTypes = useMemo(() => {
    const types = new Set<CexAnomalySignalType>()
    for (const s of periodFilteredSignals) {
      if (CEX_ANOMALY_SIGNAL_TYPES.includes(s.signalType as any)) {
        types.add(s.signalType as CexAnomalySignalType)
      }
    }
    return [...types]
  }, [periodFilteredSignals])

  // Unique pairs present in data
  const availablePairs = useMemo(() => {
    const pairs = new Set<string>()
    for (const s of periodFilteredSignals) {
      if (s.pair) pairs.add(s.pair)
    }
    return [...pairs].sort()
  }, [periodFilteredSignals])

  // Initialize selected pairs to all when dialog opens
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setSelectedPairs(new Set(availablePairs))
      setSelectedSignals(new Set(availableSignalTypes))
    }
    setOpen(isOpen)
  }, [availablePairs, availableSignalTypes])

  // Count signals per type
  const signalTypeCounts = useMemo(() => {
    const counts = new Map<CexAnomalySignalType, number>()
    for (const s of periodFilteredSignals) {
      if (CEX_ANOMALY_SIGNAL_TYPES.includes(s.signalType as any)) {
        const t = s.signalType as CexAnomalySignalType
        counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return counts
  }, [periodFilteredSignals])

  // Count signals per pair
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of periodFilteredSignals) {
      if (s.pair) counts.set(s.pair, (counts.get(s.pair) || 0) + 1)
    }
    return counts
  }, [periodFilteredSignals])

  // Filtered signals for backtest
  const filteredSignals = useMemo(() =>
    periodFilteredSignals.filter(s =>
      selectedSignals.has(s.signalType as CexAnomalySignalType) &&
      selectedPairs.has(s.pair)
    ), [periodFilteredSignals, selectedSignals, selectedPairs])

  const handleRun = useCallback(async () => {
    abortRef.current = false
    setRunning(true)
    setError(null)
    setResults(null)
    setProgress({ completed: 0, total: 0 })
    setScanPhase('')

    try {
      const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
      const isHistorical = periodConfig && periodConfig.days > 0

      if (isHistorical) {
        // Historical scan mode: fetch Binance data + scan for signals + backtest
        const pairsToScan = [...selectedPairs].filter(p => PAIR_TO_BINANCE[p])
        if (pairsToScan.length === 0) {
          setError('Brak par do skanowania — wybierz przynajmniej jedną parę')
          setRunning(false)
          return
        }

        const signalTypesList = [...selectedSignals]

        const result = await runHistoricalBacktest(
          {
            days: periodConfig.days,
            pairs: pairsToScan,
            signalTypes: signalTypesList.length > 0 ? signalTypesList : undefined,
            volSpikeMult: 2.5,
            momentumMinPct: 0.5,
            cooldownCandles: 12,
            onProgress: (phase, completed, total) => {
              if (abortRef.current) throw new Error('Aborted')
              setScanPhase(phase)
              setProgress({ completed, total })
            },
          },
          btLeverage,
          maxCandles,
          capitalPerTrade,
        )
        setResults(result)
      } else {
        // Live signals mode: use signals from current session
        if (filteredSignals.length === 0) {
          setError('Brak sygnałów do backtestu — wybierz przynajmniej jeden typ sygnału i jedną parę')
          setRunning(false)
          return
        }

        const result = await runMicrostructureBacktest(
          filteredSignals,
          btLeverage,
          (completed, total) => {
            if (abortRef.current) throw new Error('Aborted')
            setProgress({ completed, total })
          },
          maxCandles,
          capitalPerTrade,
        )
        setResults(result)
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Aborted') {
        // User cancelled
      } else {
        setError(err instanceof Error ? err.message : 'Backtest failed')
      }
    } finally {
      setRunning(false)
      setScanPhase('')
    }
  }, [filteredSignals, btLeverage, maxCandles, capitalPerTrade, backtestPeriod, selectedPairs, selectedSignals])

  const handleClose = useCallback(() => {
    abortRef.current = true
    setOpen(false)
  }, [])

  // Toggle helpers
  const toggleSignal = (type: CexAnomalySignalType) => {
    setSelectedSignals(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  const togglePair = (pair: string) => {
    setSelectedPairs(prev => {
      const next = new Set(prev)
      if (next.has(pair)) next.delete(pair); else next.add(pair)
      return next
    })
  }

  const selectAllSignals = () => setSelectedSignals(new Set(availableSignalTypes))
  const deselectAllSignals = () => setSelectedSignals(new Set())
  const selectAllPairs = () => setSelectedPairs(new Set(availablePairs))
  const deselectAllPairs = () => setSelectedPairs(new Set())

  const maxHoldHours = (maxCandles * 5) / 60

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: `${te.orange}15`,
            border: `1px solid ${te.orange}44`,
            color: te.orange,
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${te.orange}25`
            e.currentTarget.style.borderColor = te.orange
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `${te.orange}15`
            e.currentTarget.style.borderColor = `${te.orange}44`
          }}
        >
          <FlaskConical size={14} />
          BACKTEST
        </button>
      </DialogTrigger>
      <DialogContent
        style={{
          background: te.bg,
          border: `1px solid ${te.border}`,
          borderRadius: '8px',
          maxWidth: '1020px',
          width: '95vw',
          maxHeight: '92vh',
          color: te.text,
          fontFamily: 'JetBrains Mono, monospace',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: te.text, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
            <FlaskConical size={16} style={{ color: te.orange }} />
            MICROSTRUCTURE RADAR BACKTEST
            <span style={{ color: te.textDim, fontSize: '10px', fontWeight: 400 }}>
              TP {BACKTEST_CONFIG.TP_PCT}% | SL {BACKTEST_CONFIG.SL_PCT}%
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* ── Filter Panel ── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '8px 10px',
          background: `${te.border}08`,
          border: `1px solid ${te.border}33`,
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          {/* Period selector + Capital */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Calendar size={10} style={{ color: te.orange }} />
            <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, letterSpacing: '0.06em' }}>OKRES</span>
            {BACKTEST_PERIODS.map(p => (
              <PeriodButton
                key={p.label}
                label={p.label}
                active={backtestPeriod === p.label}
                onClick={() => setBacktestPeriod(p.label)}
              />
            ))}
            <span style={{ fontSize: '8px', color: te.textDim, marginLeft: '8px' }}>
              {periodFilteredSignals.length} sygnałów w okresie
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <DollarSign size={10} style={{ color: te.green }} />
            <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, letterSpacing: '0.06em' }}>KAPITAŁ / TRADE</span>
            <input
              type="number"
              min={10}
              max={100000}
              step={10}
              value={capitalPerTrade}
              onChange={e => setCapitalPerTrade(Math.max(10, Number(e.target.value)))}
              style={{
                width: '70px',
                padding: '2px 6px',
                fontSize: '10px',
                fontFamily: 'JetBrains Mono, monospace',
                background: te.bgInput,
                border: `1px solid ${te.border}`,
                color: te.text,
                borderRadius: '3px',
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: '9px', color: te.textDim }}>USDT</span>
            <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, marginLeft: '8px', letterSpacing: '0.06em' }}>LEWAR</span>
            {[1, 2, 3, 5, 10, 20].map(lv => (
              <button
                key={lv}
                onClick={() => setBtLeverage(lv)}
                style={{
                  padding: '2px 6px',
                  fontSize: '9px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: btLeverage === lv ? 700 : 400,
                  background: btLeverage === lv ? `${te.orange}25` : 'transparent',
                  border: `1px solid ${btLeverage === lv ? te.orange : te.border}66`,
                  color: btLeverage === lv ? te.orange : te.textDim,
                  borderRadius: '3px',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {lv}x
              </button>
            ))}
            <span style={{ fontSize: '8px', color: te.textDim }}>
              Pozycja = ${capitalPerTrade * btLeverage}
            </span>
          </div>

          {/* Signal type filter */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Filter size={10} style={{ color: te.orange }} />
              <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, letterSpacing: '0.06em' }}>SYGNAŁY</span>
              <button onClick={selectAllSignals} style={{ fontSize: '8px', color: te.cyan, background: 'none', border: 'none', cursor: 'pointer', fontFamily: te.mono }}>ALL</button>
              <button onClick={deselectAllSignals} style={{ fontSize: '8px', color: te.red, background: 'none', border: 'none', cursor: 'pointer', fontFamily: te.mono }}>NONE</button>
              <span style={{ fontSize: '8px', color: te.textDim, marginLeft: 'auto' }}>
                {selectedSignals.size}/{availableSignalTypes.length} wybrane | {filteredSignals.length} sygnałów
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
              {availableSignalTypes.map(type => {
                const meta = SIGNAL_TYPE_META[type]
                const count = signalTypeCounts.get(type) || 0
                return (
                  <ChipToggle
                    key={type}
                    label={meta?.label || type}
                    color={meta?.color || te.textDim}
                    active={selectedSignals.has(type)}
                    onClick={() => toggleSignal(type)}
                    count={count}
                  />
                )
              })}
            </div>
          </div>

          {/* Pair filter */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Filter size={10} style={{ color: te.cyan }} />
              <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, letterSpacing: '0.06em' }}>PARY</span>
              <button onClick={selectAllPairs} style={{ fontSize: '8px', color: te.cyan, background: 'none', border: 'none', cursor: 'pointer', fontFamily: te.mono }}>ALL</button>
              <button onClick={deselectAllPairs} style={{ fontSize: '8px', color: te.red, background: 'none', border: 'none', cursor: 'pointer', fontFamily: te.mono }}>NONE</button>
              <span style={{ fontSize: '8px', color: te.textDim, marginLeft: 'auto' }}>
                {selectedPairs.size}/{availablePairs.length} wybrane
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxHeight: '60px', overflowY: 'auto' }}>
              {availablePairs.map(pair => {
                const count = pairCounts.get(pair) || 0
                const shortName = pair.split('-')[0]
                return (
                  <ChipToggle
                    key={pair}
                    label={shortName}
                    color={te.cyan}
                    active={selectedPairs.has(pair)}
                    onClick={() => togglePair(pair)}
                    count={count}
                  />
                )
              })}
            </div>
          </div>

          {/* Max hold time slider + leverage info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '9px', fontWeight: 600, color: te.textDim, letterSpacing: '0.06em' }}>MAX HOLD</span>
            <input
              type="range"
              min={30}
              max={288}
              step={6}
              value={maxCandles}
              onChange={e => setMaxCandles(Number(e.target.value))}
              style={{ width: '120px', accentColor: te.orange }}
            />
            <span style={{ fontSize: '10px', fontWeight: 600, color: te.text }}>
              {maxCandles} świec ({maxHoldHours.toFixed(1)}h)
            </span>
            <span style={{ fontSize: '8px', color: te.textDim }}>
              | Lewar: <b style={{ color: te.orange }}>{btLeverage}x</b>
            </span>
            <span style={{ fontSize: '8px', color: te.textDim }}>
              | Fee: {(BACKTEST_CONFIG.FEE_RATE * 200 * btLeverage).toFixed(3)}% r/t
            </span>
          </div>
        </div>

        {/* ── Run Button / Progress ── */}
        {!results && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px' }}>
            {running ? (
              <>
                <Loader2 size={24} style={{ color: te.orange, animation: 'spin 1s linear infinite' }} />
                <div style={{ fontSize: '12px', color: te.text }}>
                  {scanPhase || 'Backtestowanie...'} {progress.completed}/{progress.total}
                </div>
                <div style={{
                  width: '200px',
                  height: '4px',
                  background: `${te.border}`,
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                    height: '100%',
                    background: te.orange,
                    transition: 'width 0.3s',
                    borderRadius: '2px',
                  }} />
                </div>
                <button
                  onClick={() => { abortRef.current = true }}
                  style={{
                    padding: '4px 12px',
                    background: `${te.red}20`,
                    border: `1px solid ${te.red}44`,
                    color: te.red,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  ANULUJ
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '11px', color: te.textDim, textAlign: 'center', maxWidth: '500px' }}>
                  {(() => {
                    const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                    const isHistorical = periodConfig && periodConfig.days > 0
                    if (isHistorical) {
                      return <>Backtest historyczny: pobierze świece 5m z Binance za ostatnie {periodConfig!.days} dni dla {selectedPairs.size} par, przeskanuje wzorce i przeprowadzi symulację TP/SL.</>
                    }
                    return <>Backtest przeanalizuje {filteredSignals.length} wybranych sygnałów z sesji na świecach 5m z TP {BACKTEST_CONFIG.TP_PCT}% i SL {BACKTEST_CONFIG.SL_PCT}%.</>
                  })()}
                  {' '}Max hold: {maxCandles} świec ({maxHoldHours.toFixed(1)}h).
                  Kapitał/trade: ${capitalPerTrade} ({btLeverage}x = ${capitalPerTrade * btLeverage} pozycja).
                </div>
                <button
                  onClick={handleRun}
                  disabled={(() => {
                    const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                    const isHistorical = periodConfig && periodConfig.days > 0
                    return isHistorical ? selectedPairs.size === 0 : filteredSignals.length === 0
                  })()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 24px',
                    background: (() => {
                      const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                      const isHistorical = periodConfig && periodConfig.days > 0
                      const canRun = isHistorical ? selectedPairs.size > 0 : filteredSignals.length > 0
                      return canRun ? te.orange : `${te.border}30`
                    })(),
                    border: 'none',
                    color: (() => {
                      const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                      const isHistorical = periodConfig && periodConfig.days > 0
                      const canRun = isHistorical ? selectedPairs.size > 0 : filteredSignals.length > 0
                      return canRun ? '#000' : te.textDim
                    })(),
                    borderRadius: '6px',
                    cursor: (() => {
                      const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                      const isHistorical = periodConfig && periodConfig.days > 0
                      const canRun = isHistorical ? selectedPairs.size > 0 : filteredSignals.length > 0
                      return canRun ? 'pointer' : 'not-allowed'
                    })(),
                    fontSize: '13px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                  }}
                >
                  <FlaskConical size={16} />
                  URUCHOM BACKTEST{(() => {
                    const periodConfig = BACKTEST_PERIODS.find(p => p.label === backtestPeriod)
                    const isHistorical = periodConfig && periodConfig.days > 0
                    return isHistorical
                      ? ` (${periodConfig!.days}d, ${selectedPairs.size} par)`
                      : ` (${filteredSignals.length} sygnałów)`
                  })()}
                </button>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px',
            background: `${te.red}10`,
            border: `1px solid ${te.red}33`,
            borderRadius: '4px',
            color: te.red,
            fontSize: '11px',
          }}>
            <AlertTriangle size={14} />
            {error}
            <button
              onClick={() => { setError(null); setResults(null) }}
              style={{
                marginLeft: 'auto',
                padding: '4px 8px',
                background: 'transparent',
                border: `1px solid ${te.red}44`,
                color: te.red,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              PONÓW
            </button>
          </div>
        )}

        {/* Results */}
        {results && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflow: 'hidden' }}>
            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${te.border}` }}>
              {(['stats', 'trades'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '6px 16px',
                    background: activeTab === tab ? `${te.orange}15` : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab ? `2px solid ${te.orange}` : '2px solid transparent',
                    color: activeTab === tab ? te.orange : te.textDim,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: activeTab === tab ? 600 : 400,
                  }}
                >
                  {tab === 'stats' ? '📊 Stats' : `📋 Trades (${results.trades.length})`}
                </button>
              ))}
            </div>

            {/* Stats Tab */}
            {activeTab === 'stats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                {/* Overall Stats */}
                <div style={{
                  border: `1px solid ${te.border}44`,
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '6px 10px',
                    background: `${te.border}10`,
                    borderBottom: `1px solid ${te.border}33`,
                    fontSize: '10px',
                    color: te.textDim,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <BarChart3 size={12} style={{ color: te.orange }} />
                    OGÓLNE WYNIKI
                    <span style={{ marginLeft: 'auto', color: te.textDim, fontWeight: 400 }}>
                      {results.overallStats.dataAvailable} z {results.signalsUsed} sygnałów ({results.overallStats.dataMissing} brak danych)
                    </span>
                  </div>
                  <OverallStatsPanel stats={results.overallStats} />
                </div>

                {/* Per-Category Stats */}
                {results.categoryStats.length > 0 && (
                  <div style={{
                    border: `1px solid ${te.border}44`,
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '6px 10px',
                      background: `${te.border}10`,
                      borderBottom: `1px solid ${te.border}33`,
                      fontSize: '10px',
                      color: te.textDim,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}>
                      <Trophy size={12} style={{ color: te.orange }} />
                      STATYSTYKI WG KATEGORII ({results.categoryStats.length})
                    </div>
                    <CategoryStatsTable stats={results.categoryStats} />
                  </div>
                )}

                {/* R:R Analysis */}
                <div style={{
                  padding: '8px 12px',
                  background: `${te.border}10`,
                  border: `1px solid ${te.border}33`,
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: te.textDim,
                }}>
                  <span style={{ color: te.text, fontWeight: 600 }}>R:R = {BACKTEST_CONFIG.TP_PCT / BACKTEST_CONFIG.SL_PCT} : 1</span>
                  {' — '}
                  TP {BACKTEST_CONFIG.TP_PCT}% ceny / SL {BACKTEST_CONFIG.SL_PCT}% ceny.
                  Break-even win rate: {((BACKTEST_CONFIG.SL_PCT / (BACKTEST_CONFIG.TP_PCT + BACKTEST_CONFIG.SL_PCT)) * 100).toFixed(1)}%
                  {' — '}
                  Przy {btLeverage}x lewarze: TP = {fmtPct(BACKTEST_CONFIG.TP_PCT * btLeverage)} PnL, SL = {fmtPct(-BACKTEST_CONFIG.SL_PCT * btLeverage)} PnL
                  {' — '}
                  Kapitał/trade: ${capitalPerTrade} | Max hold: {maxCandles} świec ({maxHoldHours.toFixed(1)}h)
                  {' — '}
                  Okres: {backtestPeriod}
                </div>
              </div>
            )}

            {/* Trades Tab — fully scrollable */}
            {activeTab === 'trades' && (
              <TradeList trades={results.trades} />
            )}

            {/* Rerun Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button
                onClick={() => { setResults(null); setError(null) }}
                style={{
                  padding: '6px 14px',
                  background: `${te.orange}15`,
                  border: `1px solid ${te.orange}44`,
                  color: te.orange,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 600,
                }}
              >
                🔄 URUCHOM PONOWNIE
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
