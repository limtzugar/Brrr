'use client'

// ─── Signal Stats Panel ─────────────────────────────────────────────────────
// Small floating panel showing session-based signal scoring.
// Can be collapsed to a tiny badge showing total score.

import React, { useState, useMemo } from 'react'
import { useTE } from '@/lib/te-theme'
import { TE } from '@/lib/te-tokens'
import type { SignalEvent, SignalScore, SignalType } from '@/lib/signal-scoring'
import { aggregateScores, SIGNAL_TYPE_META, eventsToCsv, getSessionId } from '@/lib/signal-scoring'

interface SignalStatsPanelProps {
  events: SignalEvent[]
  onClear: () => void
}

export function SignalStatsPanel({ events, onClear }: SignalStatsPanelProps) {
  const te = useTE()
  const [collapsed, setCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const sessionId = useMemo(() => getSessionId(), [])
  const scores = useMemo(() => aggregateScores(events), [events])
  const totalPoints = useMemo(() => {
    let sum = 0
    for (const [, s] of scores) sum += s.points
    return sum
  }, [scores])

  const totalTrades = useMemo(() => {
    let sum = 0
    for (const [, s] of scores) sum += s.totalTrades
    return sum
  }, [scores])

  const totalWinRate = useMemo(() => {
    let wins = 0, total = 0
    for (const [, s] of scores) { wins += s.wins; total += s.totalTrades }
    return total > 0 ? ((wins / total) * 100).toFixed(0) : '0'
  }, [scores])

  const totalPnl = useMemo(() => {
    let sum = 0
    for (const [, s] of scores) sum += s.totalPnl
    return sum
  }, [scores])

  // Sort scores by points (best first)
  const sortedScores = useMemo(() => {
    return [...scores.entries()].sort((a, b) => b[1].points - a[1].points)
  }, [scores])

  const handleExportCsv = () => {
    if (events.length === 0) return
    const csv = eventsToCsv(events)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `signal_scores_${sessionId}_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const pointsColor = totalPoints > 0 ? te.green : totalPoints < 0 ? te.red : te.textDim
  const pnlColor = totalPnl > 0 ? te.green : totalPnl < 0 ? te.red : te.textDim

  // ─── Collapsed: tiny badge ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        className="fixed cursor-pointer select-none"
        style={{
          bottom: 12, right: 12, zIndex: 100,
          background: te.bgCard, border: `1px solid ${te.border}`,
          borderRadius: 6, padding: '4px 8px',
          boxShadow: `0 2px 12px ${te.bg}99`,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ fontSize: 8, fontFamily: te.mono, color: te.textDim, letterSpacing: '0.08em', fontWeight: 700 }}>
          SIG
        </span>
        <span style={{ fontSize: 11, fontFamily: te.mono, color: pointsColor, fontWeight: 700 }}>
          {totalPoints > 0 ? '+' : ''}{totalPoints}pts
        </span>
        <span style={{ fontSize: 7, fontFamily: te.mono, color: te.textDim }}>
          {totalTrades}t
        </span>
      </div>
    )
  }

  // ─── Expanded: stats panel ─────────────────────────────────────────────
  return (
    <div
      className="fixed select-none"
      style={{
        bottom: 12, right: 12, zIndex: 100,
        background: te.bgCard, border: `1px solid ${te.border}`,
        borderRadius: 8, width: 280,
        boxShadow: `0 4px 24px ${te.bg}cc, 0 0 1px ${te.border}`,
        fontFamily: te.mono,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ borderBottom: `1px solid ${te.border}`, background: `${te.cyan}08` }}>
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full" style={{ background: te.cyan, boxShadow: `0 0 4px ${te.cyan}66` }} />
          <span style={{ fontSize: 9, color: te.cyan, fontWeight: 700, letterSpacing: '0.1em' }}>SIGNAL STATS</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleExportCsv} style={{ fontSize: 7, color: events.length > 0 ? te.cyan : te.textDim, background: 'transparent', border: `1px solid ${events.length > 0 ? `${te.cyan}44` : te.border}`, borderRadius: 3, padding: '1px 4px', cursor: events.length > 0 ? 'pointer' : 'default', fontFamily: te.mono, fontWeight: 700, letterSpacing: '0.04em' }}>
            CSV
          </button>
          <button onClick={() => setShowHistory(prev => !prev)} style={{ fontSize: 7, color: te.textDim, background: 'transparent', border: `1px solid ${te.border}`, borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontFamily: te.mono, fontWeight: 700, letterSpacing: '0.04em' }}>
            {showHistory ? 'SCORES' : 'LOG'}
          </button>
          <button onClick={onClear} style={{ fontSize: 7, color: te.red, background: 'transparent', border: `1px solid ${`${te.red}44`}`, borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontFamily: te.mono, fontWeight: 700, letterSpacing: '0.04em' }}>
            CLR
          </button>
          <button onClick={() => setCollapsed(true)} style={{ fontSize: 9, color: te.textDim, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: te.mono, lineHeight: 1 }}>
            ✕
          </button>
        </div>
      </div>

      {/* Summary Row */}
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ borderBottom: `1px solid ${te.border}` }}>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center">
            <span style={{ fontSize: 7, color: te.textDim, fontWeight: 700, letterSpacing: '0.06em' }}>POINTS</span>
            <span style={{ fontSize: 14, color: pointsColor, fontWeight: 700 }}>
              {totalPoints > 0 ? '+' : ''}{totalPoints}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontSize: 7, color: te.textDim, fontWeight: 700, letterSpacing: '0.06em' }}>P&L</span>
            <span style={{ fontSize: 11, color: pnlColor, fontWeight: 700 }}>
              {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontSize: 7, color: te.textDim, fontWeight: 700, letterSpacing: '0.06em' }}>WIN%</span>
            <span style={{ fontSize: 11, color: Number(totalWinRate) >= 50 ? te.green : te.red, fontWeight: 700 }}>
              {totalWinRate}%
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontSize: 7, color: te.textDim, fontWeight: 700, letterSpacing: '0.06em' }}>TRADES</span>
            <span style={{ fontSize: 11, color: te.text, fontWeight: 700 }}>{totalTrades}</span>
          </div>
        </div>
      </div>

      {/* Session indicator */}
      <div className="px-2.5 py-0.5" style={{ borderBottom: `1px solid ${te.border}` }}>
        <span style={{ fontSize: 6, color: te.textDim, letterSpacing: '0.04em' }}>
          SESSION: {sessionId} | {new Date().toLocaleDateString()}
        </span>
      </div>

      {showHistory ? (
        /* ─── Event Log ──────────────────────────────────────────────── */
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {events.length === 0 && (
            <div className="px-2.5 py-3 text-center" style={{ fontSize: 8, color: te.textDim }}>
              No signal events yet. Open/close positions to see scoring.
            </div>
          )}
          {[...events].reverse().slice(0, 30).map((ev, i) => {
            const meta = SIGNAL_TYPE_META[ev.signalType]
            const deltaStr = ev.pointsDelta > 0 ? `+${ev.pointsDelta}` : String(ev.pointsDelta)
            const deltaColor = ev.pointsDelta > 0 ? te.green : ev.pointsDelta < 0 ? te.red : te.textDim
            const pnlColor = ev.pnl > 0 ? te.green : ev.pnl < 0 ? te.red : te.textDim
            return (
              <div key={i} className="flex items-center gap-1 px-2 py-0.5" style={{ borderBottom: `1px solid ${te.border}44`, fontSize: 7 }}>
                <span style={{ color: meta?.color || te.textDim, fontWeight: 700, minWidth: 28 }}>{meta?.label || ev.signalType}</span>
                <span style={{ color: te.textDim }}>{ev.pair.split('-')[0]}</span>
                <span style={{ color: ev.side === 'LONG' ? te.green : te.red, fontWeight: 700 }}>{ev.side === 'LONG' ? 'L' : 'S'}</span>
                <span style={{ color: pnlColor, fontWeight: 600, marginLeft: 'auto' }}>{ev.pnl >= 0 ? '+' : ''}{ev.pnl.toFixed(2)}</span>
                <span style={{ color: deltaColor, fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{deltaStr}pt</span>
                <span style={{ color: te.textDim, fontSize: 6 }}>{ev.closeReason}</span>
              </div>
            )
          })}
        </div>
      ) : (
        /* ─── Score Breakdown ────────────────────────────────────────── */
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {sortedScores.length === 0 && (
            <div className="px-2.5 py-3 text-center" style={{ fontSize: 8, color: te.textDim }}>
              No signal scores yet. Open/close positions to see scoring.
            </div>
          )}
          {sortedScores.map(([sigType, score]) => {
            const meta = SIGNAL_TYPE_META[sigType]
            const scoreColor = score.points > 0 ? te.green : score.points < 0 ? te.red : te.textDim
            const winRateColor = score.winRate >= 50 ? te.green : score.winRate > 0 ? te.orange : te.textDim
            const barWidth = Math.min(100, Math.abs(score.points) * 5) // scale: 1pt = 5% width
            const barColor = score.points > 0 ? te.green : score.points < 0 ? te.red : te.textDim
            return (
              <div key={sigType} className="px-2 py-1" style={{ borderBottom: `1px solid ${te.border}44` }}>
                <div className="flex items-center gap-1.5">
                  {/* Badge */}
                  <span style={{
                    fontSize: 8, fontWeight: 700, color: meta?.color || te.text,
                    background: `${meta?.color || te.text}1a`,
                    border: `1px solid ${meta?.color || te.text}44`,
                    borderRadius: 3, padding: '0px 3px',
                    minWidth: 30, textAlign: 'center',
                  }}>
                    {meta?.label || sigType}
                  </span>
                  {/* Score */}
                  <span style={{ fontSize: 12, color: scoreColor, fontWeight: 700, minWidth: 28 }}>
                    {score.points > 0 ? '+' : ''}{score.points}
                  </span>
                  {/* Stats */}
                  <div className="flex items-center gap-2 ml-auto" style={{ fontSize: 7, color: te.textDim }}>
                    <span style={{ color: winRateColor, fontWeight: 600 }}>{score.winRate.toFixed(0)}%W</span>
                    <span>{score.wins}W/{score.losses}L</span>
                    <span style={{ color: score.avgPnl >= 0 ? te.green : te.red }}>
                      {score.avgPnl >= 0 ? '+' : ''}{score.avgPnl.toFixed(2)} avg
                    </span>
                  </div>
                </div>
                {/* Points bar */}
                <div className="mt-0.5" style={{ height: 2, background: te.border, borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidth}%`,
                    background: barColor,
                    borderRadius: 1,
                    marginLeft: score.points < 0 ? 'auto' : 0,
                    opacity: 0.7,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-2.5 py-1 flex items-center justify-between" style={{ background: `${te.bg}88` }}>
        <span style={{ fontSize: 6, color: te.textDim, letterSpacing: '0.04em' }}>
          TP+3 SL-2 Trl+2 BigW+2 BigL-1
        </span>
        <span style={{ fontSize: 6, color: te.textDim, letterSpacing: '0.04em' }}>
          {events.length} events
        </span>
      </div>
    </div>
  )
}
