// ─── Liquidation Heatmap SVG Component ────────────────────────────────────
// RAF-smoothed SVG heatmap showing liquidation clusters for active pair.
// Extracted from cex-anomaly-tab.tsx for maintainability.

'use client'

import React, { type RefObject } from 'react'
import { useTE } from '@/lib/te-theme'
import { formatPrice } from '@/lib/cex-anomaly-helpers'
import { HEATMAP, UI } from '@/lib/cex-anomaly-constants'
import type { ActivePosition, LiquidationBar, PairSimulation } from '@/lib/cex-anomaly-types'
import { Flame, ChevronDown, ChevronRight } from 'lucide-react'

export interface LiquidationHeatmapProps {
  activeSim: PairSimulation
  activePairSymbol: string
  activePairDecimals: number
  positions: ActivePosition[]
  smoothHeatmapRef: RefObject<{
    price: number
    liqBars: LiquidationBar[]
    activeSymbol: string
  }>
  heatmapSvgRef: RefObject<SVGSVGElement | null>
  heatmapOpen: boolean
  onToggleHeatmap: () => void
}

const HM_H = 280
const HM_W = 360

export default React.memo(function LiquidationHeatmap({
  activeSim,
  activePairSymbol,
  activePairDecimals,
  positions,
  smoothHeatmapRef,
  heatmapSvgRef,
  heatmapOpen,
  onToggleHeatmap,
}: LiquidationHeatmapProps) {
  const te = useTE()
  // ── NEVER return null — always return consistent JSX structure to prevent
  // React internal "Expected static flag was missing" error with React.memo.
  if (!activeSim) {
    return (
      <div className="rounded-sm p-3 flex items-center justify-center" style={{ background: te.bgCard, border: `1px solid ${te.border}`, height: HM_H + 50, overflow: 'hidden' }}>
        <span className="text-[12px]" style={{ color: te.textDim, fontFamily: te.mono }}>No data</span>
      </div>
    )
  }
  const sim = activeSim
  const maxLiq = Math.max(...sim.liqBars.map(b => Math.max(b.longLiq, b.shortLiq)), 1)
  const halfCount = sim.liqBars.length / 2
  const priceRange = sim.liqBars.length > 0
    ? (sim.liqBars[sim.liqBars.length - 1].price - sim.liqBars[0].price)
    : 1

  // Initialize smooth state when symbol changes or on first render
  if (smoothHeatmapRef.current.activeSymbol !== activePairSymbol || smoothHeatmapRef.current.liqBars.length !== sim.liqBars.length) {
    smoothHeatmapRef.current = {
      price: sim.price,
      liqBars: sim.liqBars.map(b => ({ ...b })),
      activeSymbol: activePairSymbol,
    }
  }

  return (
    <div className="rounded-sm p-3" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
      <button
        onClick={onToggleHeatmap}
        className="w-full flex items-center gap-2 mb-2 cursor-pointer flex-wrap"
        style={{ background: 'transparent', border: 'none', outline: 'none' }}
      >
        {heatmapOpen
          ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
          : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
        }
        <Flame className="size-3.5" style={{ color: te.red }} />
        <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
          LIQUIDATION HEATMAP
        </span>
        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-sm ml-1" style={{
          background: `${te.orange}1a`, color: te.orange,
          border: `1px solid ${te.orange}33`, fontFamily: te.mono,
        }}>
          {activePairSymbol}
        </span>
        <span className="text-[12px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
          Longs ↓<span style={{ color: te.red }}>■</span> Shorts ↑<span style={{ color: te.green }}>■</span>
        </span>
      </button>
      {heatmapOpen && (
      <svg ref={heatmapSvgRef} width="100%" height={HM_H} viewBox={`0 0 ${HM_W + 70} ${HM_H}`} preserveAspectRatio="xMidYMid meet" style={{ fontFamily: te.mono }}>
        {/* Grid lines + price labels (static, only change on liq regen) */}
        {sim.liqBars.filter((_, i) => i % UI.HEATMAP_AXIS_LABEL_STEP === 0).map((bar, i) => {
          const y = HM_H - ((bar.price - sim.liqBars[0].price) / priceRange) * HM_H
          return (
            <g key={`ax-${i}`}>
              <line x1={0} y1={y} x2={HM_W + 10} y2={y}
                stroke={te.border} strokeWidth={0.5} strokeDasharray="2,4" />
              <text x={HM_W + 14} y={y + 3} fontSize={8} fill={te.textDim} textAnchor="start">
                {formatPrice(bar.price, activePairDecimals)}
              </text>
            </g>
          )
        })}

        {/* Long/Short bars — RAF will update x/width/opacity via data-hm-* */}
        {sim.liqBars.map((bar, i) => {
          const y = HM_H - ((bar.price - sim.liqBars[0].price) / priceRange) * HM_H
          const isBelow = i < halfCount
          const longBarW = (bar.longLiq / maxLiq) * (HM_W / 2 - 10)
          const shortBarW = (bar.shortLiq / maxLiq) * (HM_W / 2 - 10)
          const centerX = HM_W / 2

          return (
            <g key={`b-${i}`}>
              {bar.longLiq > HEATMAP.MIN_RENDER_LIQ && (
                <rect data-hm-long={i} x={centerX - longBarW} y={y - 3} width={longBarW} height={6}
                  fill={isBelow ? te.red : `${te.red}44`} rx={1}
                  opacity={0.7 + (bar.longLiq / maxLiq) * 0.3} />
              )}
              {bar.shortLiq > HEATMAP.MIN_RENDER_LIQ && (
                <rect data-hm-short={i} x={centerX} y={y - 3} width={shortBarW} height={6}
                  fill={!isBelow ? te.green : `${te.green}44`} rx={1}
                  opacity={0.7 + (bar.shortLiq / maxLiq) * 0.3} />
              )}
            </g>
          )
        })}

        {/* Current price line + label — RAF will update y via transform */}
        <g data-hm-price-group>
          <line x1={0} y1={0} x2={HM_W + 10} y2={0}
            stroke={te.orange} strokeWidth={1.5} />
          <text data-hm-price-label x={HM_W + 14} y={3} fontSize={9} fill={te.orange} fontWeight={700}>
            {formatPrice(sim.price, activePairDecimals)}
          </text>
        </g>

        {/* Shield lines for positions on this pair */}
        {positions.filter(p => p.status === 'OPEN' && p.pair === activePairSymbol).slice(0, 2).map(pos => {
          const shieldY = HM_H - ((pos.shieldStopLoss - sim.liqBars[0].price) / priceRange) * HM_H
          const clusterY = HM_H - ((pos.nearestLiqCluster - sim.liqBars[0].price) / priceRange) * HM_H
          if (shieldY < 0 || shieldY > HM_H) return null
          return (
            <g key={`sh-${pos.id}`}>
              <line x1={0} y1={clusterY} x2={HM_W + 10} y2={clusterY}
                stroke={te.red} strokeWidth={1} strokeDasharray="4,3" />
              <text x={2} y={clusterY - 3} fontSize={7} fill={te.red} fontWeight={700}>LIQ CLUSTER</text>
              <line x1={0} y1={shieldY} x2={HM_W + 10} y2={shieldY}
                stroke={te.orange} strokeWidth={1.5} strokeDasharray="2,2" />
              <rect x={2} y={shieldY - 7} width={60} height={10} rx={2}
                fill={`${te.orange}22`} stroke={te.orange} strokeWidth={0.5} />
              <text x={5} y={shieldY} fontSize={7} fill={te.orange} fontWeight={700}>
                SHIELD {formatPrice(pos.shieldStopLoss, activePairDecimals)}
              </text>
            </g>
          )
        })}

        <line x1={HM_W / 2} y1={0} x2={HM_W / 2} y2={HM_H}
          stroke={te.borderLight} strokeWidth={0.5} strokeDasharray="1,3" />
      </svg>
      )}
    </div>
  )
})
