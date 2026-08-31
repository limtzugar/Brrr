'use client'

import { useState, useId, useMemo, useCallback, useRef } from 'react'
import { useTE } from '@/lib/te-theme'
import { formatPrice } from '@/lib/trading-shared'

// ─── Interactive Sparkline — TE Precision Style ─────────────────────────────
// Smooth sparkline with hover interaction: dot appears at nearest data point,
// price tooltip follows cursor. Clean, anti-aliased SVG rendering.

interface InteractiveSparklineProps {
  data: number[] | null
  isPositive: boolean
  width?: number
  height?: number
  /** If true, show the 7d label under the chart */
  showLabel?: boolean
}

export default function InteractiveSparkline({
  data,
  isPositive,
  width = 280,
  height = 80,
  showLabel = false,
}: InteractiveSparklineProps) {
  const te = useTE()
  const uid = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverInfo, setHoverInfo] = useState<{
    x: number
    y: number
    price: number
    idx: number
  } | null>(null)

  // ── Compute derived data always (before any early return) to satisfy rules-of-hooks
  const maxPoints = 120
  const step = Math.max(1, Math.floor((data?.length ?? 0) / maxPoints))
  const sampled = data ? data.filter((_, i) => i % step === 0) : []

  const min = sampled.length > 0 ? Math.min(...sampled) : 0
  const max = sampled.length > 0 ? Math.max(...sampled) : 1
  const range = max - min || 1

  const padX = 8
  const padY = 6
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  const pts = sampled.map((v, i) => ({
    x: padX + (i / Math.max(sampled.length - 1, 1)) * chartW,
    y: padY + chartH - ((v - min) / range) * chartH,
    price: v,
  }))

  // ── Build smooth cubic bezier path (Catmull-Rom → Bezier)
  const linePath = useMemo(() => {
    if (pts.length < 2) return ''
    if (pts.length <= 3) {
      let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
      for (let i = 1; i < pts.length; i++) {
        d += ` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`
      }
      return d
    }

    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[Math.min(pts.length - 1, i + 1)]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]

      const tension = 0.3
      const cp1x = p1.x + (p2.x - p0.x) * tension
      const cp1y = p1.y + (p2.y - p0.y) * tension
      const cp2x = p2.x - (p3.x - p1.x) * tension
      const cp2y = p2.y - (p3.y - p1.y) * tension

      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
    }
    return d
  }, [pts])

  // ── Build area path
  const areaPath = useMemo(() => {
    if (!linePath || pts.length < 2) return ''
    const lastPt = pts[pts.length - 1]
    const firstPt = pts[0]
    return `${linePath} L${lastPt.x.toFixed(1)},${height - padY / 2} L${firstPt.x.toFixed(1)},${height - padY / 2} Z`
  }, [linePath, pts, height, padY])

  // ── Mouse handling — find nearest point
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || pts.length === 0) return
      const rect = svgRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      // Scale to SVG coordinates if viewBox differs
      const svgX = (mouseX / rect.width) * width

      // Find nearest point by X
      let nearest = pts[0]
      let nearestIdx = 0
      let minDist = Infinity
      for (let i = 0; i < pts.length; i++) {
        const dist = Math.abs(pts[i].x - svgX)
        if (dist < minDist) {
          minDist = dist
          nearest = pts[i]
          nearestIdx = i
        }
      }
      setHoverInfo({ x: nearest.x, y: nearest.y, price: nearest.price, idx: nearestIdx })
    },
    [pts, width]
  )

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null)
  }, [])

  // ── Empty state (AFTER all hooks)
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-40">
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={te.textDim}
          strokeWidth="0.5"
          strokeDasharray="3 3"
        />
      </svg>
    )
  }



  const color = isPositive ? te.green : te.red
  const gradientId = `ispark-${uid}`
  const lastPt = pts[pts.length - 1]

  // ── Tooltip positioning
  const tooltipW = 90
  const tooltipH = 28
  const tooltipX = hoverInfo
    ? hoverInfo.x + tooltipW / 2 + 10 > width
      ? hoverInfo.x - tooltipW - 10
      : hoverInfo.x + 10
    : 0
  const tooltipY = hoverInfo
    ? hoverInfo.y - tooltipH / 2 < 0
      ? 4
      : hoverInfo.y + tooltipH / 2 > height
      ? height - tooltipH - 4
      : hoverInfo.y - tooltipH / 2
    : 0

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="shrink-0"
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Area fill under the curve */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Smooth line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* End-point dot */}
        {pts.length > 0 && (
          <>
            <circle cx={lastPt.x} cy={lastPt.y} r="3.5" fill={color} opacity="0.2" />
            <circle cx={lastPt.x} cy={lastPt.y} r="1.8" fill={color} />
          </>
        )}

        {/* Hover: vertical crosshair line */}
        {hoverInfo && (
          <>
            <line
              x1={hoverInfo.x}
              y1={padY}
              x2={hoverInfo.x}
              y2={height - padY / 2}
              stroke={color}
              strokeWidth="0.5"
              strokeDasharray="3 3"
              opacity="0.5"
            />
            {/* Horizontal crosshair */}
            <line
              x1={padX}
              y1={hoverInfo.y}
              x2={width - padX}
              y2={hoverInfo.y}
              stroke={color}
              strokeWidth="0.5"
              strokeDasharray="3 3"
              opacity="0.3"
            />
            {/* Dot at hover point — outer glow */}
            <circle
              cx={hoverInfo.x}
              cy={hoverInfo.y}
              r="6"
              fill={color}
              opacity="0.15"
            />
            {/* Dot — ring */}
            <circle
              cx={hoverInfo.x}
              cy={hoverInfo.y}
              r="4"
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              opacity="0.6"
            />
            {/* Dot — center */}
            <circle
              cx={hoverInfo.x}
              cy={hoverInfo.y}
              r="2"
              fill="#fff"
              stroke={color}
              strokeWidth="1"
            />
            {/* Price label — background pill */}
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipW}
              height={tooltipH}
              rx={2}
              fill={te.bgCard}
              stroke={color}
              strokeWidth="0.5"
              opacity="0.95"
            />
            {/* Price label — text */}
            <text
              x={tooltipX + tooltipW / 2}
              y={tooltipY + tooltipH / 2 + 4}
              textAnchor="middle"
              fill={color}
              fontSize="11"
              fontWeight="700"
              fontFamily={te.mono}
            >
              {formatPrice(hoverInfo.price)}
            </text>
          </>
        )}
      </svg>

      {/* 7d label */}
      {showLabel && (
        <div
          style={{
            fontFamily: te.mono,
            fontSize: '8px',
            color: te.textDim,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            marginTop: '2px',
            textAlign: 'center',
          }}
        >
          7 dni
        </div>
      )}
    </div>
  )
}
