// ─── CVD Delta Divergence Chart Component ──────────────────────────────────
// SVG chart showing price + cumulative CVD with divergence detection.
// Uses a sliding window of VISIBLE_WINDOW points — old data scrolls off left.
//
// Performance: useSmoothArray for price + CVD (2 RAF loops, React 18 batched).
// Divergence detection on memoized raw data (recalcs only on new ticks ~2Hz).
//
// RULES OF HOOKS FIX: All hooks MUST be called before any conditional return.
// Early returns after hooks are fine, but no hooks after early returns.

'use client'

import React, { useMemo, useState } from 'react'
import { useTE } from '@/lib/te-theme'
import { formatPrice } from '@/lib/cex-anomaly-helpers'
import type { PairSimulation, DivergenceZone } from '@/lib/cex-anomaly-types'
import { useSmoothArray } from '@/lib/use-smooth-chart'
import { Activity, Loader2 } from 'lucide-react'

export interface CVDChartProps {
  activeSim: PairSimulation
  activePairSymbol: string
  activePairDecimals: number
  wsConnected: boolean
}

// ── Sliding window: 3-minute cutoff + max 300 points ──
const VISIBLE_WINDOW_MS = 3 * 60 * 1000
const VISIBLE_MAX_POINTS = 300

// ── Peak/trough detection helpers ──
function findPeaks(data: number[], window: number = 2): number[] {
  const peaks: number[] = []
  for (let i = window; i < data.length - window; i++) {
    let isPeak = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && data[j] > data[i]) { isPeak = false; break }
    }
    if (isPeak) peaks.push(i)
  }
  return peaks
}

function findTroughs(data: number[], window: number = 2): number[] {
  const troughs: number[] = []
  for (let i = window; i < data.length - window; i++) {
    let isTrough = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && data[j] < data[i]) { isTrough = false; break }
    }
    if (isTrough) troughs.push(i)
  }
  return troughs
}

interface DivSignal { type: 'BEARISH' | 'BULLISH'; idx1: number; idx2: number; label: string }

export default React.memo(function CVDChart({
  activeSim,
  activePairSymbol,
  activePairDecimals,
  wsConnected,
}: CVDChartProps) {
  const TE = useTE()
  const [hoverSvgX, setHoverSvgX] = useState<number | null>(null)
  const sim = activeSim
  const totalN = sim?.cvdData?.length ?? 0
  const w = 600
  const h = 180
  const priceH = h * 0.48
  const cvdH = h * 0.44
  const pad = 12

  // ── ALL HOOKS MUST BE CALLED UNCONDITIONALLY (Rules of Hooks) ──
  // Provide safe defaults when activeSim is null — hooks still run,
  // but expensive computations short-circuit on empty arrays.

  // ── 3-min cutoff + max 300 points (filter by timestamp `t`) ──
  const windowStart = useMemo(() => {
    if (totalN === 0) return 0
    const now = Date.now()
    const cutoff = now - VISIBLE_WINDOW_MS
    // Find the first index whose timestamp `t` is within the 3-min window.
    const arr = sim?.cvdData ?? []
    let start = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      if ((arr[i]?.t ?? 0) < cutoff) { start = i + 1; break }
    }
    // Cap to VISIBLE_MAX_POINTS
    if (totalN - start > VISIBLE_MAX_POINTS) start = totalN - VISIBLE_MAX_POINTS
    return Math.max(0, start)
  }, [sim?.cvdData, totalN])

  // ── Memoize raw data: only recalculate when data length changes (~2Hz ticks) ──
  const rawPrices = useMemo(() => sim ? sim.cvdData.slice(windowStart).map(d => d.price) : [], [sim?.cvdData?.length, windowStart])
  const rawCvdCumulative = useMemo(() => sim ? sim.cvdData.slice(windowStart).map(d => d.cvd) : [], [sim?.cvdData?.length, windowStart])

  // ── Smoothed data (for rendering: paths flow at 60fps) ──
  const sPrices = useSmoothArray(rawPrices, 0.22)
  const sCvd = useSmoothArray(rawCvdCumulative, 0.22)

  // ── Detect local peaks/troughs for divergence (memoized on raw data) ──
  const pricePeaks = useMemo(() => rawPrices.length > 4 ? findPeaks(rawPrices, 2) : [], [rawPrices])
  const priceTroughs = useMemo(() => rawPrices.length > 4 ? findTroughs(rawPrices, 2) : [], [rawPrices])
  const cvdPeaks = useMemo(() => rawCvdCumulative.length > 4 ? findPeaks(rawCvdCumulative, 2) : [], [rawCvdCumulative])
  const cvdTroughs = useMemo(() => rawCvdCumulative.length > 4 ? findTroughs(rawCvdCumulative, 2) : [], [rawCvdCumulative])

  const divSignals: DivSignal[] = useMemo(() => {
    if (rawPrices.length < 4) return []
    const signals: DivSignal[] = []

    if (pricePeaks.length >= 2) {
      for (let p = 1; p < pricePeaks.length; p++) {
        const i1 = pricePeaks[p - 1], i2 = pricePeaks[p]
        const priceDiff = (rawPrices[i2] - rawPrices[i1]) / rawPrices[i1]
        if (priceDiff > 0.001) {
          const nearCvd1 = cvdPeaks.filter(ci => Math.abs(ci - i1) <= 15)
          const nearCvd2 = cvdPeaks.filter(ci => Math.abs(ci - i2) <= 15)
          if (nearCvd1.length > 0 && nearCvd2.length > 0) {
            const cvdAtP1 = Math.max(...nearCvd1.map(ci => rawCvdCumulative[ci]))
            const cvdAtP2 = Math.max(...nearCvd2.map(ci => rawCvdCumulative[ci]))
            const cvdDiff = Math.abs(cvdAtP2 - cvdAtP1)
            const cvdBase = Math.max(Math.abs(cvdAtP1), Math.abs(cvdAtP2), 1)
            if (cvdAtP2 < cvdAtP1 && (cvdDiff / cvdBase) > 0.05) {
              signals.push({ type: 'BEARISH', idx1: i1, idx2: i2, label: 'BEAR DIV' })
            }
          }
          else if (rawCvdCumulative[i2] < rawCvdCumulative[i1]) {
            const cvdDiff = Math.abs(rawCvdCumulative[i2] - rawCvdCumulative[i1])
            const cvdBase = Math.max(Math.abs(rawCvdCumulative[i1]), Math.abs(rawCvdCumulative[i2]), 1)
            if ((cvdDiff / cvdBase) > 0.05) {
              signals.push({ type: 'BEARISH', idx1: i1, idx2: i2, label: 'BEAR DIV' })
            }
          }
        }
      }
    }

    if (priceTroughs.length >= 2) {
      for (let p = 1; p < priceTroughs.length; p++) {
        const i1 = priceTroughs[p - 1], i2 = priceTroughs[p]
        const priceDiff = (rawPrices[i1] - rawPrices[i2]) / rawPrices[i1]
        if (priceDiff > 0.001) {
          const nearCvd1 = cvdTroughs.filter(ci => Math.abs(ci - i1) <= 15)
          const nearCvd2 = cvdTroughs.filter(ci => Math.abs(ci - i2) <= 15)
          if (nearCvd1.length > 0 && nearCvd2.length > 0) {
            const cvdAtP1 = Math.min(...nearCvd1.map(ci => rawCvdCumulative[ci]))
            const cvdAtP2 = Math.min(...nearCvd2.map(ci => rawCvdCumulative[ci]))
            const cvdDiff = Math.abs(cvdAtP2 - cvdAtP1)
            const cvdBase = Math.max(Math.abs(cvdAtP1), Math.abs(cvdAtP2), 1)
            if (cvdAtP2 > cvdAtP1 && (cvdDiff / cvdBase) > 0.05) {
              signals.push({ type: 'BULLISH', idx1: i1, idx2: i2, label: 'BULL DIV' })
            }
          }
          else if (rawCvdCumulative[i2] > rawCvdCumulative[i1]) {
            const cvdDiff = Math.abs(rawCvdCumulative[i2] - rawCvdCumulative[i1])
            const cvdBase = Math.max(Math.abs(rawCvdCumulative[i1]), Math.abs(rawCvdCumulative[i2]), 1)
            if ((cvdDiff / cvdBase) > 0.05) {
              signals.push({ type: 'BULLISH', idx1: i1, idx2: i2, label: 'BULL DIV' })
            }
          }
        }
      }
    }
    return signals
  }, [pricePeaks, priceTroughs, cvdPeaks, cvdTroughs, rawPrices, rawCvdCumulative])

  // ── NOW safe to do conditional returns (all hooks already called) ──

  const isLoading = !sim || totalN < 4
  const loadingMsg = !sim
    ? 'No data'
    : `Initializing CVD engine for ${activePairSymbol}...`

  if (isLoading) {
    return (
      <div className="rounded-sm p-3 flex items-center justify-center" style={{ background: TE.bgCard, border: `1px solid ${TE.border}`, height: h + 30, overflow: 'hidden' }}>
        <span className="text-[12px] flex items-center gap-2" style={{ color: TE.textDim, fontFamily: TE.mono }}>
          <Loader2 className="size-3 animate-spin" style={{ color: TE.orange }} />
          {loadingMsg}
        </span>
      </div>
    )
  }

  const n = rawPrices.length

  // Derive ranges from smoothed data
  const rawMinP = Math.min(...sPrices), rawMaxP = Math.max(...sPrices), rangeP = rawMaxP - rawMinP || 1
  const rawMinC = Math.min(...sCvd), rawMaxC = Math.max(...sCvd), rangeC = rawMaxC - rawMinC || 1
  const cvdPad = rangeC * 0.08
  const minP = rawMinP - rangeP * 0.05, maxP = rawMaxP + rangeP * 0.05
  const sRangeP = maxP - minP || 1
  const cvdMin = rawMinC - cvdPad, cvdMax = rawMaxC + cvdPad
  const cvdRange = cvdMax - cvdMin || 1

  const chartW = w - pad * 2
  const priceY = (price: number) => pad + priceH - ((price - minP) / sRangeP) * (priceH - pad * 2)
  const cvdY = (cvd: number) => priceH + pad * 1.5 + cvdH - pad - ((cvd - cvdMin) / cvdRange) * (cvdH - pad * 2)
  const xAt = (i: number) => pad + (i / (n - 1)) * chartW

  // ── Build SVG paths from SMOOTHED data (flows at 60fps) ──
  const pricePath = sPrices.map((price, i) => {
    return `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${priceY(price).toFixed(1)}`
  }).join(' ')

  const cvdPath = sCvd.map((cvd, i) => {
    return `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${cvdY(cvd).toFixed(1)}`
  }).join(' ')

  // CVD area fill path
  const cvdAreaPath = cvdPath
    + ` L${xAt(n - 1).toFixed(1)},${cvdY(cvdMin).toFixed(1)}`
    + ` L${xAt(0).toFixed(1)},${cvdY(cvdMin).toFixed(1)} Z`

  // Divergence zone highlights from sim
  const divergenceRects = sim.divergenceZones
    .filter(zone => zone.endIdx >= windowStart)
    .map((zone, zi) => {
      const adjStart = Math.max(0, zone.startIdx - windowStart)
      const adjEnd = Math.min(n - 1, zone.endIdx - windowStart)
      if (adjEnd < 0 || adjStart >= n) return null
      const startX = pad + (adjStart / (n - 1)) * chartW
      const endX = pad + (adjEnd / (n - 1)) * chartW
      const color = zone.type === 'BEARISH' ? TE.orange : TE.green
      return (
        <g key={`dz-${zi}`}>
          <rect x={startX} y={pad} width={endX - startX} height={h - pad * 2} fill={color} opacity={0.08} />
          <line x1={startX} y1={pad} x2={startX} y2={h - pad} stroke={color} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.5} />
          <line x1={endX} y1={pad} x2={endX} y2={h - pad} stroke={color} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.5} />
        </g>
      )
    })

  // Divergence trend lines (no dots — just dashed lines + label)
  const divLines = divSignals.map((sig, idx) => {
    const color = sig.type === 'BEARISH' ? TE.orange : TE.green
    const p1y = priceY(sPrices[sig.idx1]), p2y = priceY(sPrices[sig.idx2])
    const c1y = cvdY(sCvd[sig.idx1]), c2y = cvdY(sCvd[sig.idx2])
    return (
      <g key={`div-${idx}`}>
        {/* Price divergence line */}
        <line x1={xAt(sig.idx1)} y1={p1y} x2={xAt(sig.idx2)} y2={p2y}
          stroke={color} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />
        {/* CVD divergence line */}
        <line x1={xAt(sig.idx1)} y1={c1y} x2={xAt(sig.idx2)} y2={c2y}
          stroke={color} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />
        {/* Label box */}
        <rect x={xAt(sig.idx2) - 28} y={p2y - 16} width={56} height={14} rx={2} fill={color} opacity={0.9} />
        <text x={xAt(sig.idx2)} y={p2y - 6} fontSize={8} fill="#fff"
          fontWeight={800} textAnchor="middle" fontFamily={TE.mono}>{sig.label}</text>
      </g>
    )
  })

  const latestCvd = sim.cvdData[totalN - 1]?.cvd ?? 0
  const latestCvdDelta = sim.cvdData[totalN - 1]?.cvdDelta ?? 0

  return (
    <div className="rounded-sm p-3" style={{ background: TE.bgCard, border: `1px solid ${TE.border}` }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Activity className="size-3.5" style={{ color: TE.blue }} />
        <span className="text-[11px] font-bold" style={{ fontFamily: TE.mono, color: TE.text, letterSpacing: '0.1em' }}>
          CVD DELTA DIVERGENCE
        </span>
        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-sm ml-1" style={{
          background: `${TE.orange}1a`, color: TE.orange,
          border: `1px solid ${TE.orange}33`, fontFamily: TE.mono,
        }}>
          {activePairSymbol}
        </span>
        {wsConnected && (
          <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
            background: TE.greenBg, color: TE.green,
            border: `1px solid ${TE.green}33`, fontFamily: TE.mono,
          }}>
            WS LIVE
          </span>
        )}
        {divSignals.length > 0 && divSignals.map((sig, idx) => (
          <span key={`badge-${idx}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm" style={{
            background: sig.type === 'BEARISH' ? `${TE.orange}1a` : `${TE.green}1a`,
            color: sig.type === 'BEARISH' ? TE.orange : TE.green,
            border: `1px solid ${sig.type === 'BEARISH' ? `${TE.orange}44` : `${TE.green}44`}`,
            fontFamily: TE.mono, letterSpacing: '0.04em',
          }}>
            {sig.label}
          </span>
        ))}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-[10px] font-bold px-1 py-0.5 rounded-sm" style={{
            fontFamily: TE.mono, color: TE.cyan,
            background: `${TE.cyan}1a`, border: `1px solid ${TE.cyan}33`,
            letterSpacing: '0.04em',
          }}>
            3min
          </span>
          <span className="text-[10px]" style={{ fontFamily: TE.mono, color: TE.textDim }}>
            {n}pts
          </span>
          <span className="text-[11px]" style={{ fontFamily: TE.mono }}>
            <span style={{ color: TE.text }}>PRICE</span>
            <span className="inline-block w-5 h-0.5 ml-1 align-middle" style={{ background: TE.text }} />
          </span>
          <span className="text-[11px]" style={{ fontFamily: TE.mono }}>
            <span style={{ color: TE.blue }}>CVD</span>
            <span className="inline-block w-5 h-0.5 ml-1 align-middle" style={{ background: TE.blue }} />
          </span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ fontFamily: TE.mono }}
        onMouseMove={(e) => {
          const svg = e.currentTarget
          const pt = svg.createSVGPoint()
          pt.x = e.clientX
          pt.y = e.clientY
          const ctm = svg.getScreenCTM()
          if (!ctm) return
          const inv = ctm.inverse()
          const local = pt.matrixTransform(inv)
          setHoverSvgX(local.x)
        }}
        onMouseLeave={() => setHoverSvgX(null)}
      >
        <defs>
          <linearGradient id="cvdAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TE.blue} stopOpacity={0.2} />
            <stop offset="100%" stopColor={TE.blue} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <line x1={pad} y1={priceH + pad * 0.75} x2={w - pad} y2={priceH + pad * 0.75}
          stroke={TE.borderLight} strokeWidth={0.5} strokeDasharray="2,4" />
        <text x={pad} y={pad + 8} fontSize={8} fill={TE.textDim} fontWeight={700}>PRICE</text>
        <text x={pad} y={priceH + pad * 0.75 + 10} fontSize={8} fill={TE.blue} fontWeight={700} opacity={0.7}>CVD</text>

        {divergenceRects}

        {/* Price area fill */}
        <path d={pricePath + ` L${xAt(n - 1).toFixed(1)},${priceY(minP).toFixed(1)} L${xAt(0).toFixed(1)},${priceY(minP).toFixed(1)} Z`}
          fill={TE.text} opacity={0.03} />
        {/* Price line — SMOOTHED */}
        <path d={pricePath} fill="none" stroke={TE.text} strokeWidth={1.5} />

        {/* CVD area fill */}
        <path d={cvdAreaPath} fill="url(#cvdAreaGrad)" />
        {/* CVD line — SMOOTHED */}
        <path d={cvdPath} fill="none" stroke={TE.blue} strokeWidth={2} opacity={0.9} />

        {/* Divergence lines (no dots) */}
        {divLines}

        {/* Current price label */}
        <text x={w - pad} y={pad + 11} fontSize={11} fill={TE.text} textAnchor="end" fontWeight={700}>
          {formatPrice(sim.price, activePairDecimals)}
        </text>
        {/* Current CVD label */}
        <text x={w - pad} y={priceH + pad * 0.75 + 10} fontSize={8} fill={TE.blue} textAnchor="end" fontWeight={700}>
          CVD {latestCvd > 0 ? '+' : ''}{latestCvd.toFixed(0)}
          <tspan fill={latestCvdDelta >= 0 ? TE.green : TE.red} fontSize={7}> ({latestCvdDelta >= 0 ? '+' : ''}{latestCvdDelta.toFixed(0)})</tspan>
        </text>

        {/* ── Crosshair tooltip on hover ── */}
        {(() => {
          if (hoverSvgX == null || n < 2) return null
          // Convert svg-x → data index
          const relX = (hoverSvgX - pad) / chartW
          if (relX < 0 || relX > 1) return null
          const idx = Math.max(0, Math.min(n - 1, Math.round(relX * (n - 1))))
          const cx = xAt(idx)
          const pY = priceY(sPrices[idx])
          const cY = cvdY(sCvd[idx])
          const cvdVal = sCvd[idx]
          const priceVal = sPrices[idx]
          const rawPoint = sim.cvdData[windowStart + idx]
          const deltaVal = rawPoint?.cvdDelta ?? 0
          const tVal = rawPoint?.t ?? 0
          const tStr = tVal
            ? new Date(tVal).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--:--:--'
          const labelW = 64
          const labelX = cx + labelW + pad > w - pad ? cx - labelW - 2 : cx + 4
          return (
            <g pointerEvents="none">
              {/* Vertical line */}
              <line x1={cx} y1={pad} x2={cx} y2={h - pad}
                stroke={TE.text} strokeWidth={0.5} strokeDasharray="2,3" opacity={0.6} />
              {/* Horizontal price line */}
              <line x1={pad} y1={pY} x2={w - pad} y2={pY}
                stroke={TE.text} strokeWidth={0.4} strokeDasharray="2,3" opacity={0.3} />
              {/* Horizontal CVD line */}
              <line x1={pad} y1={cY} x2={w - pad} y2={cY}
                stroke={TE.blue} strokeWidth={0.4} strokeDasharray="2,3" opacity={0.3} />
              {/* Price dot */}
              <circle cx={cx} cy={pY} r={3} fill={TE.text} stroke={TE.bg} strokeWidth={0.5} />
              {/* CVD dot */}
              <circle cx={cx} cy={cY} r={3} fill={TE.blue} stroke={TE.bg} strokeWidth={0.5} />
              {/* Price label */}
              <g>
                <rect x={labelX} y={pY - 14} width={labelW} height={12} rx={1} fill={TE.bgCard} stroke={TE.text} strokeWidth={0.4} opacity={0.95} />
                <text x={labelX + 4} y={pY - 5} fontSize={8} fill={TE.text} fontWeight={700} fontFamily={TE.mono}>
                  P {formatPrice(priceVal, activePairDecimals)}
                </text>
              </g>
              {/* CVD label */}
              <g>
                <rect x={labelX} y={cY - 14} width={labelW} height={12} rx={1} fill={TE.bgCard} stroke={TE.blue} strokeWidth={0.4} opacity={0.95} />
                <text x={labelX + 4} y={cY - 5} fontSize={8} fill={TE.blue} fontWeight={700} fontFamily={TE.mono}>
                  CVD {cvdVal > 0 ? '+' : ''}{cvdVal.toFixed(0)}
                </text>
              </g>
              {/* Delta + time label (top) */}
              <g>
                <rect x={labelX} y={pad} width={labelW} height={22} rx={1} fill={TE.bgCard} stroke={TE.border} strokeWidth={0.4} opacity={0.95} />
                <text x={labelX + 4} y={pad + 8} fontSize={7} fill={deltaVal >= 0 ? TE.green : TE.red} fontWeight={700} fontFamily={TE.mono}>
                  Δ {deltaVal >= 0 ? '+' : ''}{deltaVal.toFixed(0)}
                </text>
                <text x={labelX + 4} y={pad + 18} fontSize={7} fill={TE.textDim} fontWeight={700} fontFamily={TE.mono}>
                  {tStr}
                </text>
              </g>
            </g>
          )
        })()}
      </svg>
    </div>
  )
})
