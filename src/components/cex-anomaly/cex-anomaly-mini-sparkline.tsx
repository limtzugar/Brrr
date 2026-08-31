// ─── Mini Sparkline — Tiny SVG price history chart ────────────────────────
// Extracted from cex-anomaly-tab.tsx

'use client'

import React from 'react'
import { useTE } from '@/lib/te-theme'

export const MiniSparkline = React.memo(function MiniSparkline({ data, isProfit }: { data: number[]; isProfit: boolean }) {
  const te = useTE()
  // ── NEVER return null — return invisible placeholder to prevent React memo static flag error
  // Guard: data may be undefined if a position object is incomplete (orphan/phantom edge case)
  const safeData = data || []
  if (safeData.length < 2) {
    return <svg width={80} height={24} className="shrink-0 hidden sm:block" />
  }
  const min = Math.min(...safeData)
  const max = Math.max(...safeData)
  const range = max - min || 1
  const w = 80
  const h = 24
  const color = isProfit ? te.green : te.red
  const pathD = safeData.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${(i / (safeData.length - 1)) * w},${h - ((p - min) / range) * (h - 4) - 2}`
  ).join(' ')
  return (
    <svg width={w} height={h} className="shrink-0 hidden sm:block">
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
})
