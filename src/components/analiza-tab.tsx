'use client'

import { useState, useMemo, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { TE, seededRandom } from '@/lib/te-tokens'
import type { Theme, WhatIfScenario, MonteCarloResult } from '@/lib/market-analysis-engine'
import { THEMES, THEME_CONNECTIONS, WHAT_IF_SCENARIOS, computeSentiment, runMonteCarlo, estimateParams } from '@/lib/market-analysis-engine'

// ─── Pixel Icon Component (shared) ──────────────────────────────────────────

function PixelIcon({ grid, color, size = 24 }: { grid: readonly string[]; color: string; size?: number }) {
  const px = size / 8
  return (
    <svg width={size} height={size} style={{ imageRendering: 'pixelated' }} className="shrink-0">
      {grid.map((row, y) =>
        row.split('').map((cell, x) =>
          cell === '1' ? (
            <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} fill={color} />
          ) : null
        )
      )}
    </svg>
  )
}

// ─── Pixel Gauge Component ──────────────────────────────────────────────────

function PixelGauge({ value, max = 100, height = 10, width = 240 }: { value: number; max?: number; height?: number; width?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const segmentW = 3
  const gap = 1
  const totalSegments = Math.floor(width / (segmentW + gap))
  const filledSegments = Math.round((pct / 100) * totalSegments)

  const getColor = (i: number) => {
    const ratio = i / totalSegments
    if (ratio < 0.25) return TE.red
    if (ratio < 0.4) return TE.orange
    if (ratio < 0.5) return TE.yellow
    return TE.green
  }

  return (
    <svg width={width} height={height} style={{ imageRendering: 'pixelated' }}>
      {Array.from({ length: totalSegments }).map((_, i) => (
        <rect
          key={i}
          x={i * (segmentW + gap)}
          y={0}
          width={segmentW}
          height={height}
          fill={i < filledSegments ? getColor(i) : TE.border}
          opacity={i < filledSegments ? 1 : 0.3}
        />
      ))}
    </svg>
  )
}

// ─── Monte Carlo Fan Chart ──────────────────────────────────────────────────

function MonteCarloChart({ result }: { result: MonteCarloResult }) {
  const W = 500
  const H = 180
  const padX = 36
  const padY = 16
  const chartW = W - padX * 2
  const chartH = H - padY * 2

  const allPrices = [...result.p5, ...result.p95]
  const minP = Math.min(...allPrices) * 0.95
  const maxP = Math.max(...allPrices) * 1.05
  const range = maxP - minP || 1

  const n = result.median.length
  const xStep = chartW / (n - 1)

  const toX = (i: number) => padX + i * xStep
  const toY = (v: number) => padY + chartH - ((v - minP) / range) * chartH

  const makePath = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

  const makeArea = (lower: number[], upper: number[]) => {
    const top = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
    const bottom = lower.slice().reverse().map((v, i) => `L${toX(n - 1 - i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
    return `${top} ${bottom} Z`
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ imageRendering: 'auto' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1={padX} y1={padY + chartH * r} x2={W - padX} y2={padY + chartH * r} stroke={TE.border} strokeWidth="0.5" />
      ))}
      {/* P5-P95 band */}
      <path d={makeArea(result.p5, result.p95)} fill={`${TE.purple}15`} />
      {/* P25-P75 band */}
      <path d={makeArea(result.p25, result.p75)} fill={`${TE.purple}30`} />
      {/* Median line */}
      <path d={makePath(result.median)} fill="none" stroke={TE.purple} strokeWidth="1.5" />
      {/* Current price line */}
      <line x1={padX} y1={toY(result.currentPrice)} x2={W - padX} y2={toY(result.currentPrice)} stroke={TE.red} strokeWidth="0.8" strokeDasharray="3 2" />
      {/* Labels */}
      <text x={padX - 3} y={toY(result.currentPrice) + 3} textAnchor="end" fill={TE.red} fontSize="7" fontFamily={TE.mono}>now</text>
      <text x={padX - 3} y={toY(result.finalMedian) + 3} textAnchor="end" fill={TE.purple} fontSize="7" fontFamily={TE.mono}>med</text>
      {/* Day labels */}
      {[0, Math.floor(n / 2), n - 1].map((d, i) => (
        <text key={i} x={toX(d)} y={H - 3} textAnchor="middle" fill={TE.textDim} fontSize="6" fontFamily={TE.mono}>D{d}</text>
      ))}
    </svg>
  )
}

// ─── Section Label ──────────────────────────────────────────────────────────

function SectionLabel({ icon, color, children }: { icon: readonly string[]; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <PixelIcon grid={icon} color={color} size={12} />
      <span style={{ fontFamily: TE.mono, fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: TE.textMuted }}>
        {children}
      </span>
    </div>
  )
}

// ─── Pixel icons for section labels ─────────────────────────────────────────

const ICONS = {
  gauge: ['00111100', '01000010', '10100101', '10000001', '10100101', '01000010', '00111100', '00000000'] as const,
  flask: ['00011000', '00011000', '00011000', '00111100', '01111110', '11111111', '00111100', '00000000'] as const,
  grid:  ['11111111', '10000001', '10100101', '10000001', '10100101', '10000001', '11111111', '00000000'] as const,
  bolt:  ['00111100', '00110000', '01111000', '01100000', '11110000', '01100000', '01111000', '00111100'] as const,
  net:   ['01111110', '11011011', '11111111', '11111111', '11011011', '01111110', '00111100', '00011000'] as const,
} as const

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AnalizaTab() {
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<{ symbol: string; name: string; price: number; change24h: number; change7d: number } | null>(null)
  const [activeScenario, setActiveScenario] = useState<WhatIfScenario | null>(null)
  const [mcHorizon, setMcHorizon] = useState<30 | 60 | 90>(30)
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null)

  // Compute heatmap changes (with scenario impact)
  const heatmapData = useMemo(() => {
    const base: Record<string, number> = {}
    THEMES.forEach(t => {
      const sectorChanges: Record<string, number> = {
        ai: 2.1, health: -0.5, energy: -1.2, military: 0.8,
        finance: 0.3, infra: -0.7, esg: 1.5, biotech: 0.9, semi: 1.8,
      }
      base[t.id] = sectorChanges[t.id] || 0
    })
    if (activeScenario) {
      for (const [themeId, impact] of Object.entries(activeScenario.impacts)) {
        base[themeId] = (base[themeId] || 0) + impact * 0.3
      }
    }
    return base
  }, [activeScenario])

  // Compute sentiment
  const sentiment = useMemo(() => computeSentiment(heatmapData, activeScenario), [heatmapData, activeScenario])

  const sentimentLabel = sentiment < 20 ? 'EKSTREMALNY STRACH' : sentiment < 40 ? 'STRACH' : sentiment < 60 ? 'NEUTRALNIE' : sentiment < 80 ? 'CHCIWOŚĆ' : 'EKSTREMALNA CHCIWOŚĆ'
  const sentimentColor = sentiment < 40 ? TE.red : sentiment < 60 ? TE.yellow : TE.green

  // Run Monte Carlo when company or horizon changes (useEffect, not useMemo)
  useEffect(() => {
    if (selectedCompany) {
      const { dailyReturn, dailyVol } = estimateParams(selectedCompany.change24h, selectedCompany.change7d)
      const result = runMonteCarlo(selectedCompany.price, dailyReturn, dailyVol, mcHorizon, 300)
      setMcResult(result)
    } else {
      setMcResult(null)
    }
  }, [selectedCompany, mcHorizon])

  return (
    <div className="space-y-3">

      {/* ─── 1. Summary Bar: Sentiment + Active Scenario ──────────────────── */}
      <div className="flex items-center gap-3 flex-wrap px-1">
        <div className="flex items-center gap-2">
          <PixelIcon grid={ICONS.gauge} color={sentimentColor} size={14} />
          <span style={{ fontFamily: TE.mono, fontSize: '10px', color: TE.textMuted }}>Sentyment</span>
          <span style={{ fontFamily: TE.mono, fontSize: 13, fontWeight: 700, color: TE.text, fontVariantNumeric: 'tabular-nums' }}>{Math.round(sentiment)}</span>
          <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.red }}>BEAR</span>
          <PixelGauge value={sentiment} width={140} height={8} />
          <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.green }}>BULL</span>
          <Badge variant="outline" className="text-[9px] h-5" style={{ borderColor: sentimentColor + '66', color: sentimentColor, fontFamily: TE.mono }}>
            {sentimentLabel}
          </Badge>
        </div>
        {activeScenario && (
          <Badge className="text-[9px] h-5 gap-1" style={{ background: TE.purpleBg, color: TE.purple, border: `1px solid ${TE.purple}33` }}>
            {activeScenario.emoji} {activeScenario.name}
          </Badge>
        )}
      </div>

      {/* ─── 2. What-If Scenarios — compact toggle row ────────────────────── */}
      <div>
        <SectionLabel icon={ICONS.flask} color={TE.purple}>Scenariusze What-If</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {WHAT_IF_SCENARIOS.map(scenario => {
            const isActive = activeScenario?.id === scenario.id
            const avgImpact = Object.values(scenario.impacts).reduce((a, b) => a + b, 0) / Object.values(scenario.impacts).length
            const impactColor = avgImpact >= 0 ? TE.green : TE.red
            return (
              <button
                key={scenario.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded border transition-all text-xs"
                style={{
                  borderColor: isActive ? TE.purple : TE.border,
                  background: isActive ? TE.purpleBg : TE.bgCard,
                  color: isActive ? TE.purple : TE.text,
                }}
                onClick={() => setActiveScenario(isActive ? null : scenario)}
              >
                <span className="text-sm">{scenario.emoji}</span>
                <span className="font-medium" style={{ fontSize: '10px' }}>{scenario.name}</span>
                <span style={{ fontFamily: TE.mono, fontSize: '9px', color: impactColor, fontVariantNumeric: 'tabular-nums' }}>
                  {avgImpact >= 0 ? '+' : ''}{avgImpact.toFixed(0)}%
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── 3. Heatmap Sektora — compact flat grid ───────────────────────── */}
      <div>
        <SectionLabel icon={ICONS.grid} color={TE.orange}>Heatmap Sektora</SectionLabel>
        <div className="rounded border overflow-hidden" style={{ borderColor: TE.border }}>
          <div className="grid grid-cols-9" style={{ background: TE.bgCard }}>
            {THEMES.map(theme => {
              const change = heatmapData[theme.id] || 0
              const isSelected = selectedTheme?.id === theme.id
              return (
                <button
                  key={theme.id}
                  className="flex flex-col items-center justify-center py-2 px-1 transition-all relative"
                  style={{
                    backgroundColor: change >= 0
                      ? `rgba(16,185,94,${Math.min(0.5, Math.abs(change) / 30)})`
                      : `rgba(239,68,68,${Math.min(0.5, Math.abs(change) / 30)})`,
                    borderRight: `1px solid ${TE.border}`,
                    borderBottom: `1px solid ${TE.border}`,
                    outline: isSelected ? `2px solid ${theme.color}` : 'none',
                    outlineOffset: '-2px',
                  }}
                  onClick={() => setSelectedTheme(isSelected ? null : theme)}
                >
                  <PixelIcon grid={theme.pixelIcon} color={theme.color} size={16} />
                  <div className="text-[8px] font-medium mt-0.5 truncate w-full text-center" style={{ color: TE.text }}>{theme.name.split('/')[0].trim()}</div>
                  <div style={{ fontFamily: TE.mono, fontSize: '9px', fontWeight: 700, color: change >= 0 ? TE.green : TE.red, fontVariantNumeric: 'tabular-nums' }}>
                    {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── 4. Theme Detail + Companies — split layout ────────────────────── */}
      {selectedTheme && (
        <div className="rounded border" style={{ borderColor: `${selectedTheme.color}44`, background: TE.bgCard }}>
          {/* Theme header — flat bar */}
          <div
            className="flex items-center gap-2 px-3 py-2 border-b"
            style={{ borderColor: TE.border, background: `${selectedTheme.color}0a` }}
          >
            <PixelIcon grid={selectedTheme.pixelIcon} color={selectedTheme.color} size={18} />
            <span className="text-sm font-bold" style={{ color: TE.text }}>{selectedTheme.name}</span>
            <Badge variant="outline" className="text-[9px] h-4" style={{ borderColor: TE.borderLight, color: TE.textMuted }}>
              {selectedTheme.companies.length} spółek
            </Badge>
            {/* Sub-themes inline */}
            <div className="flex flex-wrap gap-1 ml-auto">
              {selectedTheme.subThemes.map(st => (
                <Badge key={st.id} variant="outline" className="text-[8px] h-4" style={{ borderColor: TE.borderLight, color: TE.textDim }}>
                  {st.name} {(st.weight * 100).toFixed(0)}%
                </Badge>
              ))}
            </div>
          </div>

          {/* Companies — flat rows like SignalCard */}
          <div className="divide-y" style={{ borderColor: TE.border }}>
            {selectedTheme.companies.map(company => {
              const rng = seededRandom(company.symbol.charCodeAt(0) * 137 + 42)
              const simPrice = 50 + rng() * 500
              const simChange = -8 + rng() * 16
              const simChange7d = -15 + rng() * 30
              const scenarioImpact = activeScenario ? (activeScenario.impacts[selectedTheme.id] || 0) * company.relevance * 0.5 : 0
              const totalChange = simChange + scenarioImpact
              const isSelectedCo = selectedCompany?.symbol === company.symbol
              return (
                <button
                  key={company.symbol}
                  className="flex items-center gap-2 px-3 py-1.5 w-full text-left transition-colors group"
                  style={{
                    background: isSelectedCo ? TE.purpleBg : 'transparent',
                    borderLeft: isSelectedCo ? `2px solid ${TE.purple}` : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isSelectedCo) e.currentTarget.style.background = TE.bgCardHover }}
                  onMouseLeave={e => { if (!isSelectedCo) e.currentTarget.style.background = 'transparent' }}
                  onClick={() => setSelectedCompany(isSelectedCo ? null : {
                    symbol: company.symbol,
                    name: company.name,
                    price: simPrice,
                    change24h: totalChange,
                    change7d: simChange7d + scenarioImpact * 2,
                  })}
                >
                  <div className="flex items-center gap-1.5 min-w-[60px]">
                    <span className="text-xs font-bold" style={{ color: TE.text }}>{company.symbol}</span>
                    <span style={{ background: 'rgba(217,119,6,0.12)', color: '#d97706', border: '1px solid rgba(217,119,6,0.25)', fontFamily: TE.mono, fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '2px', letterSpacing: '0.05em', textTransform: 'uppercase' as const, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>DEMO</span>
                  </div>
                  <span className="text-[10px] truncate flex-1" style={{ color: TE.textMuted }}>{company.name}</span>
                  <span className="text-[9px] shrink-0" style={{ color: TE.textDim, fontFamily: TE.mono }}>{company.sector}</span>
                  <span style={{ fontFamily: TE.mono, fontSize: '10px', color: TE.text, fontVariantNumeric: 'tabular-nums' }} className="shrink-0">
                    ${simPrice.toFixed(2)}
                  </span>
                  <span
                    style={{ fontFamily: TE.mono, fontSize: '10px', fontWeight: 600, color: totalChange >= 0 ? TE.green : TE.red, fontVariantNumeric: 'tabular-nums' }}
                    className="shrink-0 w-14 text-right"
                  >
                    {totalChange >= 0 ? '+' : ''}{totalChange.toFixed(1)}%
                  </span>
                  <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.textDim }} className="shrink-0">${company.marketCap}B</span>
                </button>
              )
            })}
          </div>

          {/* Inter-theme connections — inline badges */}
          {THEME_CONNECTIONS.filter(c => c.from === selectedTheme.id || c.to === selectedTheme.id).length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-t" style={{ borderColor: TE.border }}>
              <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.textDim }}>Powiązania:</span>
              {THEME_CONNECTIONS
                .filter(c => c.from === selectedTheme.id || c.to === selectedTheme.id)
                .map(c => {
                  const otherId = c.from === selectedTheme.id ? c.to : c.from
                  const otherTheme = THEMES.find(t => t.id === otherId)
                  if (!otherTheme) return null
                  return (
                    <Badge key={`${c.from}-${c.to}`} variant="outline" className="text-[8px] h-4 gap-0.5" style={{ borderColor: TE.borderLight, color: TE.text }}>
                      <PixelIcon grid={otherTheme.pixelIcon} color={otherTheme.color} size={8} />
                      {otherTheme.name.split('/')[0].trim()}
                      <span style={{ color: TE.textDim }}>({c.type === 'dependency' ? 'zależność' : c.type === 'competitor' ? 'konkurencja' : 'komplement'}, {(c.strength * 100).toFixed(0)}%)</span>
                    </Badge>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* ─── 5. Monte Carlo Simulation ────────────────────────────────────── */}
      {selectedCompany && mcResult && (
        <div className="rounded border" style={{ borderColor: `${TE.purple}44`, background: TE.bgCard }}>
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: TE.border, background: TE.purpleBg }}>
            <PixelIcon grid={ICONS.bolt} color={TE.purple} size={14} />
            <span className="text-xs font-bold" style={{ color: TE.text }}>Monte Carlo</span>
            <Badge variant="outline" className="text-[9px] h-4" style={{ borderColor: TE.borderLight, color: TE.purple, fontFamily: TE.mono }}>
              {selectedCompany.symbol}
            </Badge>
            {/* Horizon selector inline */}
            <div className="flex items-center gap-1 ml-auto">
              <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.textDim }}>Horyzont:</span>
              {([30, 60, 90] as const).map(h => (
                <button
                  key={h}
                  className="px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors"
                  style={{
                    background: mcHorizon === h ? TE.purple : 'transparent',
                    color: mcHorizon === h ? '#fff' : TE.textMuted,
                    border: `1px solid ${mcHorizon === h ? TE.purple : TE.border}`,
                    fontFamily: TE.mono,
                  }}
                  onClick={() => setMcHorizon(h)}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="px-3 py-2">
            <MonteCarloChart result={mcResult} />
          </div>

          {/* Stats row — flat compact boxes */}
          <div className="grid grid-cols-4 divide-x" style={{ borderColor: TE.border, borderTop: `1px solid ${TE.border}` }}>
            {[
              { label: 'Obecna', value: `$${mcResult.currentPrice.toFixed(2)}`, color: TE.text },
              { label: `Mediana ${mcHorizon}d`, value: `$${mcResult.finalMedian.toFixed(2)}`, color: TE.purple },
              { label: 'Szansa wzrostu', value: `${mcResult.chanceUp.toFixed(1)}%`, color: mcResult.chanceUp > 50 ? TE.green : TE.red },
              {
                label: 'P5 / P95',
                value: '',
                color: TE.text,
                custom: (
                  <span style={{ fontFamily: TE.mono, fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: TE.red }}>${mcResult.p5[mcResult.p5.length - 1].toFixed(2)}</span>
                    <span style={{ color: TE.textDim }}> / </span>
                    <span style={{ color: TE.green }}>${mcResult.p95[mcResult.p95.length - 1].toFixed(2)}</span>
                  </span>
                ),
              },
            ].map((stat, i) => (
              <div key={i} className="px-3 py-2 text-center" style={{ borderRight: i < 3 ? `1px solid ${TE.border}` : undefined }}>
                <div style={{ fontFamily: TE.mono, fontSize: '8px', color: TE.textDim }}>{stat.label}</div>
                {stat.custom || (
                  <div style={{ fontFamily: TE.mono, fontSize: 13, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
                    {stat.value}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Scenario impact note */}
          {activeScenario && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-t" style={{ background: TE.yellowBg, borderColor: TE.border }}>
              <span style={{ fontFamily: TE.mono, fontSize: '9px', color: TE.yellow }}>
                Scenariusz &quot;{activeScenario.name}&quot; modyfikuje prognozę o {(activeScenario.impacts[selectedTheme?.id || ''] || 0).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─── 6. Connections Graph — force-directed layout ──────────────────── */}
      <div>
        <SectionLabel icon={ICONS.net} color={TE.textDim}>Graf Powiązań</SectionLabel>
        <div className="rounded border overflow-hidden" style={{ borderColor: TE.border, background: TE.bgCard }}>
          <div className="relative" style={{ height: '240px' }}>
            <svg width="100%" height="100%" viewBox="0 0 600 240" style={{ imageRendering: 'auto' }}>
              {/* Connections */}
              {THEME_CONNECTIONS.map((conn, i) => {
                const fromTheme = THEMES.find(t => t.id === conn.from)
                const toTheme = THEMES.find(t => t.id === conn.to)
                if (!fromTheme || !toTheme) return null
                const fromIdx = THEMES.indexOf(fromTheme)
                const toIdx = THEMES.indexOf(toTheme)
                const fromX = 50 + (fromIdx % 3) * 200
                const fromY = 40 + Math.floor(fromIdx / 3) * 80
                const toX = 50 + (toIdx % 3) * 200
                const toY = 40 + Math.floor(toIdx / 3) * 80
                return (
                  <line
                    key={`conn-${i}`}
                    x1={fromX} y1={fromY} x2={toX} y2={toY}
                    stroke={conn.type === 'dependency' ? TE.purple : conn.type === 'competitor' ? TE.red : TE.green}
                    strokeWidth={conn.strength * 2.5}
                    strokeOpacity={0.35}
                    strokeDasharray={conn.type === 'competitor' ? '3 3' : 'none'}
                  />
                )
              })}
              {/* Nodes */}
              {THEMES.map((theme, idx) => {
                const x = 50 + (idx % 3) * 200
                const y = 40 + Math.floor(idx / 3) * 80
                const change = heatmapData[theme.id] || 0
                const isSelected = selectedTheme?.id === theme.id
                return (
                  <g key={theme.id} className="cursor-pointer" onClick={() => setSelectedTheme(isSelected ? null : theme)}>
                    <circle cx={x} cy={y} r={isSelected ? 24 : 18} fill={theme.color} fillOpacity={isSelected ? 0.25 : 0.12} stroke={theme.color} strokeWidth={isSelected ? 2 : 1} />
                    <text x={x} y={y - 3} textAnchor="middle" fill={TE.text} fontSize="8" fontWeight="bold" fontFamily={TE.mono}>{theme.name.split('/')[0].trim()}</text>
                    <text x={x} y={y + 8} textAnchor="middle" fill={change >= 0 ? TE.green : TE.red} fontSize="7" fontFamily={TE.mono}>
                      {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      </div>

    </div>
  )
}
