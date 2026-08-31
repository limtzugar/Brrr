// @ts-nocheck — legacy file from previous session, needs refactoring
'use client'

import React from 'react'
import { motion } from 'framer-motion'

// ─── Pixel Art Icon Grids (8x8) ─────────────────────────────────────────────
// Each grid is an 8x8 matrix where 1 = filled pixel, 0 = empty

export const PIXEL_ICONS: Record<string, number[][]> = {
  ai: [
    [0,0,1,1,1,1,0,0],
    [0,1,0,0,0,0,1,0],
    [1,0,1,0,0,1,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,1,0,0,1,0,1],
    [1,0,0,1,1,0,0,1],
    [0,1,0,0,0,0,1,0],
    [0,0,1,1,1,1,0,0],
  ],
  healthcare: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,0,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,0,1,1,1,1,0,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
  ],
  energy: [
    [0,0,0,1,0,0,0,0],
    [0,0,1,1,0,0,0,0],
    [0,1,1,1,0,0,0,0],
    [1,1,1,1,1,1,1,0],
    [0,1,1,1,0,0,0,0],
    [0,0,1,1,0,0,0,0],
    [0,1,1,1,0,0,0,0],
    [1,1,1,1,1,0,0,0],
  ],
  defense: [
    [0,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1],
    [1,1,0,0,0,0,1,1],
    [1,1,0,0,0,0,1,1],
    [0,1,1,0,0,1,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0],
  ],
  finance: [
    [0,1,1,1,1,1,1,0],
    [1,1,0,0,0,0,1,1],
    [1,1,0,1,0,0,1,1],
    [1,1,0,1,1,0,1,1],
    [1,1,0,1,1,1,1,1],
    [1,1,0,1,0,0,1,1],
    [1,1,0,0,0,0,1,1],
    [0,1,1,1,1,1,1,0],
  ],
  infrastructure: [
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
  ],
  esg: [
    [0,0,0,0,0,0,0,0],
    [0,0,0,1,0,0,0,0],
    [0,0,1,1,1,0,0,0],
    [0,1,0,1,0,1,0,0],
    [1,0,0,1,0,0,1,0],
    [0,0,0,1,0,0,0,0],
    [0,0,0,1,0,0,0,0],
    [0,0,1,1,1,0,0,0],
  ],
  biotech: [
    [0,0,1,0,0,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,1,0,1,1,0,1,0],
    [0,1,0,1,1,0,1,0],
    [1,0,0,1,1,0,0,1],
    [1,0,0,1,1,0,0,1],
    [0,1,0,1,1,0,1,0],
    [0,0,1,0,0,1,0,0],
  ],
  semiconductors: [
    [1,0,0,0,0,0,0,1],
    [0,1,0,0,0,0,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,0,0,0,0,1,0],
    [1,0,0,0,0,0,0,1],
  ],
  // ─── Icons used by transfer-tab & trade-panel ─────────────────────────
  transfer: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,0,0,0,0],
    [0,1,1,0,0,0,0,0],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,0,0,0,0,0],
    [0,0,1,1,0,0,0,0],
    [0,0,0,1,1,0,0,0],
  ],
  warning: [
    [0,0,0,1,1,0,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,1,0,0,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,1,0,0,0,0,1,0],
    [0,1,0,0,0,0,1,0],
    [1,1,1,1,1,1,1,1],
    [0,0,0,1,1,0,0,0],
  ],
  signal: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,0,0,0,0,1,0],
    [1,0,0,1,1,0,0,1],
    [0,1,0,0,0,0,1,0],
    [0,0,1,0,0,1,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0],
  ],
  eye: [
    [0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
  ],
  target: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,1,0,0,1,1,1],
    [1,1,1,0,0,1,1,1],
    [0,1,1,1,1,1,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
  ],
  lightning: [
    [0,0,1,1,1,1,0,0],
    [0,0,1,1,0,0,0,0],
    [0,1,1,1,1,0,0,0],
    [0,1,1,0,0,0,0,0],
    [1,1,1,1,0,0,0,0],
    [0,1,1,0,0,0,0,0],
    [0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
  ],
  // ─── Aliases for market-analysis-engine ────────────────────────────────
  health: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,0,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,0,1,1,1,1,0,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
  ],
  military: [
    [0,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1],
    [1,1,0,0,0,0,1,1],
    [1,1,0,0,0,0,1,1],
    [0,1,1,0,0,1,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0],
  ],
  infra: [
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0],
  ],
  semi: [
    [1,0,0,0,0,0,0,1],
    [0,1,0,0,0,0,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,0,1,0,0,1,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,0,0,0,0,1,0],
    [1,0,0,0,0,0,0,1],
  ],
}

// ─── PixelIcon Component ─────────────────────────────────────────────────────

interface PixelIconProps {
  themeId: string
  color: string
  size?: number // pixel size for each cell
  className?: string
}

export function PixelIcon({ themeId, color, size = 4, className = '' }: PixelIconProps) {
  const grid = PIXEL_ICONS[themeId]
  if (!grid) return null

  return (
    <svg
      width={8 * size}
      height={8 * size}
      viewBox={`0 0 ${8 * size} ${8 * size}`}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    >
      {grid.map((row, y) =>
        row.map((cell, x) =>
          cell ? (
            <rect
              key={`${x}-${y}`}
              x={x * size}
              y={y * size}
              width={size}
              height={size}
              fill={color}
            />
          ) : null
        )
      )}
    </svg>
  )
}

// ─── PixelGauge Component ────────────────────────────────────────────────────

interface PixelGaugeProps {
  value: number // 0-100
  label: string
  maxLabel?: string
  minLabel?: string
  color?: string
  width?: number
  height?: number
}

export function PixelGauge({
  value,
  label,
  maxLabel = 'BULL',
  minLabel = 'BEAR',
  color = '#FF6600',
  width = 280,
  height = 24,
}: PixelGaugeProps) {
  const clampedValue = Math.max(0, Math.min(100, value))
  const pixelSize = 4
  const cols = Math.floor(width / pixelSize)
  const rows = Math.floor(height / pixelSize)
  const filledCols = Math.round((clampedValue / 100) * cols)

  // Determine color gradient from bearish to bullish
  const getBarColor = (col: number) => {
    const ratio = col / cols
    if (ratio < 0.3) return '#EF4444' // red
    if (ratio < 0.45) return '#F97316' // orange
    if (ratio < 0.55) return '#EAB308' // yellow
    if (ratio < 0.7) return '#84CC16' // lime
    return '#22C55E' // green
  }

  return (
    <div className="font-mono">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xs font-bold" style={{ color: clampedValue > 50 ? '#22C55E' : clampedValue < 40 ? '#EF4444' : '#EAB308' }}>
          {clampedValue.toFixed(0)}%
        </span>
      </div>
      <div className="relative" style={{ imageRendering: 'pixelated' }}>
        <svg
          width={cols * pixelSize}
          height={rows * pixelSize}
          viewBox={`0 0 ${cols * pixelSize} ${rows * pixelSize}`}
          style={{ imageRendering: 'pixelated' }}
        >
          {/* Background pixels */}
          {Array.from({ length: rows }).map((_, y) =>
            Array.from({ length: cols }).map((_, x) => (
              <rect
                key={`bg-${x}-${y}`}
                x={x * pixelSize}
                y={y * pixelSize}
                width={pixelSize - 1}
                height={pixelSize - 1}
                fill={x < filledCols ? getBarColor(x) : '#1a1a1a'}
                opacity={x < filledCols ? 0.9 : 0.3}
              />
            ))
          )}
          {/* Indicator needle */}
          <rect
            x={filledCols * pixelSize - 1}
            y={0}
            width={3}
            height={rows * pixelSize}
            fill="#ffffff"
            opacity={0.9}
          />
        </svg>
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[8px] text-red-400 uppercase">{minLabel}</span>
        <span className="text-[8px] text-green-400 uppercase">{maxLabel}</span>
      </div>
    </div>
  )
}

// ─── PixelBorder Wrapper ─────────────────────────────────────────────────────

interface PixelBorderProps {
  children: React.ReactNode
  color?: string
  className?: string
}

export function PixelBorder({ children, color = '#FF6600', className = '' }: PixelBorderProps) {
  return (
    <div
      className={`relative ${className}`}
      style={{
        border: `2px solid ${color}40`,
        boxShadow: `
          2px 0 0 0 ${color}20,
          -2px 0 0 0 ${color}20,
          0 2px 0 0 ${color}20,
          0 -2px 0 0 ${color}20,
          4px 0 0 0 ${color}10,
          -4px 0 0 0 ${color}10,
          0 4px 0 0 ${color}10,
          0 -4px 0 0 ${color}10
        `,
      }}
    >
      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />
      {/* CRT vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.8) 100%)',
        }}
      />
      <div className="relative z-0">{children}</div>
    </div>
  )
}

// ─── Pixel Loading Spinner ────────────────────────────────────────────────────

interface PixelLoaderProps {
  size?: number
  color?: string
}

export function PixelLoader({ size = 16, color = '#FF6600' }: PixelLoaderProps) {
  // Rotating pixel square
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ imageRendering: 'pixelated' }}>
        <rect x={size * 0.25} y={size * 0.25} width={size * 0.5} height={size * 0.5} fill={color} />
        <rect x={size * 0.5} y={0} width={size * 0.25} height={size * 0.25} fill={color} opacity={0.5} />
      </svg>
    </motion.div>
  )
}
