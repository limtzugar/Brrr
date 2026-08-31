// ─── Pair Selector — Horizontal scrollable pair selector ──────────────────
// Extracted from cex-anomaly-tab.tsx

'use client'

import React, { useState, useEffect } from 'react'
import { useTE } from '@/lib/te-theme'
import { ALL_PAIRS, UI } from '@/lib/cex-anomaly-constants'
import type { PairSimulation, OrderFlowAnomaly } from '@/lib/cex-anomaly-types'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PairSelector = React.memo(function PairSelector({
  pairSims,
  activePairSymbol,
  anomalies,
  onSelectPair,
}: {
  pairSims: Record<string, PairSimulation>
  activePairSymbol: string
  anomalies: OrderFlowAnomaly[]
  onSelectPair: (symbol: string) => void
}) {
  const te = useTE()
  // Responsive: show fewer pairs on small screens
  const [visibleCount, setVisibleCount] = useState<number>(UI.PAIR_SELECTOR_VISIBLE)
  useEffect(() => {
    const update = () => setVisibleCount(window.innerWidth < 640 ? 4 : window.innerWidth < 1024 ? 6 : UI.PAIR_SELECTOR_VISIBLE)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const [scrollOffset, setScrollOffset] = useState(0)
  const maxOffset = Math.max(0, ALL_PAIRS.length - visibleCount)
  const visiblePairs = ALL_PAIRS.slice(scrollOffset, scrollOffset + visibleCount)

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}
        className="size-5 flex items-center justify-center rounded-sm transition-colors"
        style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.textMuted }}>
        <ChevronLeft className="size-3" />
      </button>
      <div className="flex items-center gap-1">
        {visiblePairs.map(pair => {
          const sim = pairSims[pair.symbol]
          const isActive = pair.symbol === activePairSymbol
          const hasAlert = anomalies.slice(0, 20).some(a => a.pair === pair.symbol)
          const baseAsset = pair.symbol.split('-')[0]
          return (
            <button key={pair.symbol}
              onClick={() => onSelectPair(pair.symbol)}
              className="px-1.5 py-1 text-[12px] font-bold rounded-sm transition-all relative"
              style={{
                fontFamily: te.mono,
                background: isActive ? `${te.orange}1a` : 'transparent',
                color: isActive ? te.orange : te.textDim,
                border: `1px solid ${isActive ? `${te.orange}44` : te.border}`,
                letterSpacing: '0.04em',
              }}>
              {baseAsset}
              {sim && (
                <span className="ml-1" style={{
                  color: sim.price >= pair.basePrice ? te.green : te.red,
                  fontSize: '11px',
                }}>
                  {sim.price >= pair.basePrice ? '▲' : '▼'}
                </span>
              )}
              {hasAlert && !isActive && (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full animate-pulse" style={{ background: te.orange }} />
              )}
            </button>
          )
        })}
      </div>
      <button onClick={() => setScrollOffset(Math.min(maxOffset, scrollOffset + 1))}
        className="size-5 flex items-center justify-center rounded-sm transition-colors"
        style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.textMuted }}>
        <ChevronRight className="size-3" />
      </button>
      <span className="text-[11px] ml-1" style={{ color: te.textDim, fontFamily: te.mono }}>
        {scrollOffset + 1}-{Math.min(scrollOffset + visibleCount, ALL_PAIRS.length)}/{ALL_PAIRS.length}
      </span>
    </div>
  )
})
