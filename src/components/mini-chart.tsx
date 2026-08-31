'use client'

import { useId } from 'react'

export default function MiniChart({ data, isPositive, width = 80, height = 32 }: {
  data: number[] | null
  isPositive: boolean
  width?: number
  height?: number
}) {
  const uid = useId()
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    )
  }

  // Sample data points to keep it lightweight (max ~50 points)
  const maxPoints = 50
  const step = Math.max(1, Math.floor(data.length / maxPoints))
  const sampled = data.filter((_, i) => i % step === 0)
  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const range = max - min || 1

  const points = sampled.map((v, i) => {
    const x = (i / (sampled.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  const color = isPositive ? '#10b981' : '#ef4444'
  const gradientId = `sparkline-${uid}`

  // Build area path (closed polygon for gradient fill)
  const areaPath = `M0,${height} L${points.split(' ').map(p => p).join(' L')} L${width},${height} Z`
  const linePath = `M${points.split(' ').join(' L')}`

  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
