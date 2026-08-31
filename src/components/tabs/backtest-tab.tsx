'use client'

// ─── Backtest Tab — TE Design System ────────────────────────────────────────
// Restyled with Teenage Engineering design system.
// No shadcn/ui components, no recharts — native HTML + inline SVG only.

import { useState, useEffect, useMemo } from 'react'
import { useTE } from '@/lib/te-theme'
import {
  AlertTriangle, Brain, Clock, Play, RefreshCw, Target,
  TrendingDown, TrendingUp, Trophy, Zap,
} from 'lucide-react'
import {
  type BacktestResponse, type CoinData,
  COIN_OPTIONS, STRATEGY_TYPE_OPTIONS,
  exitReasonLabel,
} from '@/lib/trading-shared'

// ─── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: React.ReactNode
}) {
  const te = useTE()
  return (
    <div className="flex flex-col items-center p-2 rounded-sm" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
      <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em', fontFamily: te.mono }}>{label}</span>
      <div className="flex items-center gap-1 mt-0.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-[14px] font-bold" style={{ color, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>{sub}</span>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  const te = useTE()
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono }}>{label}</span>
      <span className="text-[9px] font-bold" style={{ color, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function DrawdownHeatMap() {
  const te = useTE()
  const [coins, setCoins] = useState<CoinData[]>([])
  const [heatMapTooltip, setHeatMapTooltip] = useState<{ coin: string; day: number; drawdown: number } | null>(null)

  useEffect(() => {
    const fetchCoins = async () => {
      try { const res = await fetch('/api/coins'); if (res.ok) { const data = await res.json(); setCoins(data.coins || []) } } catch {}
    }
    fetchCoins()
  }, [])

  const heatMapCoins = coins.slice(0, 15)
  const heatMapDays = 7
  const heatMapData = useMemo(() => {
    const data: { coinId: string; symbol: string; drawdowns: number[] }[] = []
    for (const coin of heatMapCoins) {
      const spark = coin.sparkline_7d
      if (!spark || spark.length < 24) continue
      const drawdowns: number[] = []
      for (let day = 0; day < heatMapDays; day++) {
        const dayEnd = spark.length - 1 - day * 24
        const dayStart = Math.max(0, dayEnd - 23)
        if (dayStart < 0 || dayEnd <= 0) { drawdowns.push(0); continue }
        let maxPrice = -Infinity; let maxDrawdown = 0
        for (let i = dayStart; i <= dayEnd; i++) { if (spark[i] > maxPrice) maxPrice = spark[i]; const dd = ((spark[i] - maxPrice) / maxPrice) * 100; if (dd < maxDrawdown) maxDrawdown = dd }
        drawdowns.push(maxDrawdown)
      }
      data.push({ coinId: coin.id, symbol: coin.symbol, drawdowns })
    }
    return data
  }, [heatMapCoins, heatMapDays])

  function drawdownCellStyle(dd: number): React.CSSProperties {
    if (dd === 0) return { background: `${te.bgInput}22` }
    if (dd > -2) return { background: `${te.red}18` }
    if (dd > -5) return { background: `${te.red}40` }
    if (dd > -10) return { background: `${te.red}66` }
    return { background: `${te.red}88` }
  }

  if (heatMapData.length === 0) return <div className="text-[9px] text-center py-4" style={{ color: te.textMuted, fontFamily: te.mono }}>Loading heatmap data...</div>

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontFamily: te.mono }}>
          <thead>
            <tr>
              <th className="text-left pb-2 pr-3 text-[8px] font-bold" style={{ color: te.textDim, letterSpacing: '0.06em' }}>COIN</th>
              {Array.from({ length: heatMapDays }, (_, i) => (
                <th key={i} className="text-center pb-2 px-1 text-[8px] font-bold" style={{ color: te.textDim, letterSpacing: '0.06em' }}>{i === 0 ? 'TODAY' : `-${i}D`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatMapData.map(row => (
              <tr key={row.coinId}>
                <td className="py-0.5 pr-3 text-[9px] font-bold" style={{ color: te.text }}>{row.symbol.toUpperCase()}</td>
                {row.drawdowns.map((dd, dayIdx) => (
                  <td key={dayIdx} className="py-0.5 px-1">
                    <button className="w-full h-7 rounded-sm flex items-center justify-center text-[9px] font-bold hover:ring-1 transition-all cursor-pointer"
                      style={{ ...drawdownCellStyle(dd), fontFamily: te.mono, fontVariantNumeric: 'tabular-nums', color: dd < -5 ? te.text : te.textDim }}
                      onClick={() => setHeatMapTooltip({ coin: row.symbol.toUpperCase(), day: dayIdx, drawdown: dd })} title={`${row.symbol.toUpperCase()}: ${dd.toFixed(2)}%`}>
                      {dd < -0.5 ? `${dd.toFixed(1)}%` : ''}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {heatMapTooltip && (
        <div className="mt-2 rounded-sm px-3 py-1.5" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
          <span className="text-[9px] font-bold" style={{ color: te.text, fontFamily: te.mono }}>{heatMapTooltip.coin}</span>
          <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono }}> — day {heatMapTooltip.day === 0 ? 'today' : `-${heatMapTooltip.day}d`}: </span>
          <span className="text-[9px] font-bold" style={{ color: heatMapTooltip.drawdown < -5 ? te.red : te.yellow, fontFamily: te.mono }}>{heatMapTooltip.drawdown.toFixed(2)}%</span>
        </div>
      )}
      <div className="flex items-center gap-3 mt-3" style={{ color: te.textMuted, fontFamily: te.mono }}>
        <span className="text-[8px] font-bold" style={{ letterSpacing: '0.06em' }}>SCALE</span>
        {[{ style: { background: `${te.bgInput}22`, border: `1px solid ${te.border}` }, label: '0%' }, { style: { background: `${te.red}18` }, label: '-2%' }, { style: { background: `${te.red}40` }, label: '-5%' }, { style: { background: `${te.red}66` }, label: '-10%' }, { style: { background: `${te.red}88` }, label: '-10%+' }].map(s => (
          <div key={s.label} className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm" style={s.style} /><span className="text-[8px]">{s.label}</span></div>
        ))}
      </div>
    </>
  )
}

// ─── Simple Equity Curve SVG ────────────────────────────────────────────────

function EquityCurveSVG({ equityCurve, color, te }: {
  equityCurve: { date: string; capital: number }[]; color: string; te: ReturnType<typeof useTE>
}) {
  if (equityCurve.length < 2) return null

  const svgW = 600, svgH = 200, pad = 20
  const capitals = equityCurve.map(e => e.capital)
  const minC = Math.min(...capitals), maxC = Math.max(...capitals)
  const rangeC = maxC - minC || 1
  const xAt = (i: number) => pad + (i / (capitals.length - 1)) * (svgW - pad * 2)
  const yAt = (v: number) => pad + (svgH - pad * 2) - ((v - minC) / rangeC) * (svgH - pad * 2)

  const pathD = capitals.map((c, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(' ')

  // Gradient fill area
  const fillD = pathD + ` L${xAt(capitals.length - 1).toFixed(1)},${svgH - pad} L${xAt(0).toFixed(1)},${svgH - pad} Z`

  // Y-axis labels (5 ticks)
  const yTicks = 5
  const yLabels = Array.from({ length: yTicks }, (_, i) => {
    const val = minC + (rangeC * i) / (yTicks - 1)
    return val
  })

  // X-axis labels (up to 6)
  const xLabelCount = Math.min(6, equityCurve.length)
  const xLabelStep = Math.max(1, Math.floor(equityCurve.length / xLabelCount))

  return (
    <svg width="100%" height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none" style={{ fontFamily: te.mono }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.2} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {yLabels.map((val, i) => (
        <g key={`y-${i}`}>
          <line x1={pad} y1={yAt(val)} x2={svgW - pad} y2={yAt(val)} stroke={te.borderLight} strokeWidth={0.5} strokeDasharray="2,4" />
          <text x={pad - 3} y={yAt(val) + 3} fontSize={7} fill={te.textDim} textAnchor="end" fontWeight={600}>${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}</text>
        </g>
      ))}
      {/* X labels */}
      {Array.from({ length: xLabelCount }, (_, i) => {
        const idx = i * xLabelStep
        if (idx >= equityCurve.length) return null
        return (
          <text key={`x-${i}`} x={xAt(idx)} y={svgH - 4} fontSize={7} fill={te.textDim} textAnchor="middle" fontWeight={600}>
            {new Date(equityCurve[idx].date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}
          </text>
        )
      })}
      {/* Fill area */}
      <path d={fillD} fill="url(#eqGrad)" />
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
      {/* End point dot */}
      <circle cx={xAt(capitals.length - 1)} cy={yAt(capitals[capitals.length - 1])} r={3} fill={color} stroke={te.bg} strokeWidth={1} />
      <text x={svgW - pad} y={yAt(capitals[capitals.length - 1]) - 6} fontSize={8} fill={color} textAnchor="end" fontWeight={700}>
        ${capitals[capitals.length - 1].toFixed(0)}
      </text>
    </svg>
  )
}

// ─── Exit Reasons Horizontal Bar ────────────────────────────────────────────

function ExitReasonsBar({ trades, te }: { trades: BacktestResponse['trades']; te: ReturnType<typeof useTE> }) {
  const total = trades.length
  if (total === 0) return null

  const reasons = [
    { name: 'take_profit', label: 'TP', count: trades.filter(t => t.exit_reason === 'take_profit').length, color: te.green },
    { name: 'stop_loss', label: 'SL', count: trades.filter(t => t.exit_reason === 'stop_loss').length, color: te.red },
    { name: 'time_stop', label: 'TS', count: trades.filter(t => t.exit_reason === 'time_stop').length, color: te.yellow },
  ].filter(r => r.count > 0)

  return (
    <div>
      <div className="flex items-center gap-0.5 h-5 rounded-sm overflow-hidden" style={{ border: `1px solid ${te.border}` }}>
        {reasons.map(r => (
          <div key={r.name} className="h-full flex items-center justify-center text-[8px] font-bold transition-all" style={{ width: `${(r.count / total) * 100}%`, background: `${r.color}33`, color: r.color, minWidth: r.count > 0 ? 20 : 0, fontFamily: te.mono, letterSpacing: '0.04em' }} title={`${exitReasonLabel(r.name)}: ${r.count}`}>
            {r.label}:{r.count}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        {reasons.map(r => (
          <div key={r.name} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
            <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>{exitReasonLabel(r.name)} ({r.count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BacktestTab() {
  const te = useTE()

  // ─── State (ALL unchanged) ──────────────────────────────────────────────
  const [coinId, setCoinId] = useState('dogecoin')
  const [days, setDays] = useState(90)
  const [strategyType, setStrategyType] = useState('dip_buying')
  const [dipThreshold1h, setDipThreshold1h] = useState(-2)
  const [dipThreshold24h, setDipThreshold24h] = useState(-5)
  const [takeProfitPct, setTakeProfitPct] = useState(3)
  const [stopLossPct, setStopLossPct] = useState(5)
  const [initialCapital, setInitialCapital] = useState(1000)
  const [compound, setCompound] = useState(true)
  const [maxHoldingHours, setMaxHoldingHours] = useState(48)
  const [feePct, setFeePct] = useState(0.1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maPeriod, setMaPeriod] = useState(20)
  const [volumeThreshold, setVolumeThreshold] = useState(1.5)
  const [deviationThreshold, setDeviationThreshold] = useState(2)
  const [lookbackPeriods, setLookbackPeriods] = useState(20)
  const [breakoutConfirmBars, setBreakoutConfirmBars] = useState(2)
  const [gridSpacingPct, setGridSpacingPct] = useState(2)
  const [gridLevels, setGridLevels] = useState(5)
  const [hurstPeriod, setHurstPeriod] = useState(100)
  const [hurstThreshold, setHurstThreshold] = useState(0.5)
  const [bbPeriod, setBbPeriod] = useState(20)
  const [bbStd, setBbStd] = useState(2)

  // ─── Run Backtest (unchanged) ───────────────────────────────────────────
  const runBacktestFn = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin_id: coinId, days, strategy_type: strategyType,
          dip_threshold_1h: dipThreshold1h, dip_threshold_24h: dipThreshold24h,
          take_profit_pct: takeProfitPct, stop_loss_pct: stopLossPct,
          initial_capital: initialCapital, compound, max_holding_hours: maxHoldingHours,
          fee_pct: feePct, ma_period: maPeriod, volume_threshold: volumeThreshold,
          deviation_threshold: deviationThreshold, lookback_periods: lookbackPeriods,
          breakout_confirm_bars: breakoutConfirmBars, grid_spacing_pct: gridSpacingPct,
          grid_levels: gridLevels, hurst_period: hurstPeriod, hurst_threshold: hurstThreshold,
          bb_period: bbPeriod, bb_std: bbStd,
        }),
      })
      if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.error || 'Backtest failed') }
      setResult(await res.json())
    } catch (err) { setError(err instanceof Error ? err.message : 'Unknown error') }
    finally { setRunning(false) }
  }

  const presetStrategiessss = [
    { name: 'Konserwatywna', dip1h: -3, dip24h: -10, tp: 2, sl: 3, days: 90 },
    { name: 'Zbalansowana', dip1h: -2, dip24h: -7, tp: 3, sl: 5, days: 90 },
    { name: 'Agresywna', dip1h: -1, dip24h: -5, tp: 5, sl: 8, days: 90 },
  ]

  // ─── TE-styled input helper ─────────────────────────────────────────────
  const teInputStyle: React.CSSProperties = {
    background: te.bgInput,
    border: `1px solid ${te.border}`,
    color: te.text,
    fontFamily: te.mono,
    borderRadius: '2px',
  }

  const teLabelStyle: React.CSSProperties = {
    color: te.textDim,
    fontFamily: te.mono,
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: te.bg, fontFamily: te.mono, color: te.text }}>
      {/* ─── Main Layout ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="p-3 space-y-3">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* ─── Left: Config Panel ──────────────────────────────────── */}
            <div className="lg:col-span-1">
              <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                  <Brain className="size-3.5" style={{ color: te.orange }} />
                  <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>BACKTEST CONFIG</span>
                </div>

                {/* Body */}
                <div className="p-3 space-y-3">
                  {/* Strategy Type */}
                  <div>
                    <span className="text-[8px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em', fontFamily: te.mono }}>STRATEGY TYPE</span>
                    <select value={strategyType} onChange={e => setStrategyType(e.target.value)} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }}>
                      {STRATEGY_TYPE_OPTIONS.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Preset Strategiessss */}
                  {strategyType === 'dip_buying' && (
                    <div>
                      <span className="text-[8px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em', fontFamily: te.mono }}>PRESETS</span>
                      <div className="flex gap-1.5 mt-1">
                        {presetStrategiessss.map(p => (
                          <button key={p.name} onClick={() => { setDipThreshold1h(p.dip1h); setDipThreshold24h(p.dip24h); setTakeProfitPct(p.tp); setStopLossPct(p.sl); setDays(p.days) }}
                            className="px-2 py-1 text-[8px] font-bold rounded-sm"
                            style={{ color: te.textDim, background: 'transparent', border: `1px solid ${te.border}`, fontFamily: te.mono, letterSpacing: '0.04em' }}>
                            {p.name.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Coin */}
                  <div>
                    <span className="text-[8px] font-bold" style={teLabelStyle}>COIN</span>
                    <select value={coinId} onChange={e => setCoinId(e.target.value)} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }}>
                      {COIN_OPTIONS.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Days + Capital */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>PERIOD (DAYS)</span>
                      <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} min={30} max={730}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>INITIAL CAPITAL ($)</span>
                      <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} min={100}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                  </div>

                  {/* Strategy-specific params */}
                  {strategyType === 'dip_buying' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>DIP 1H (%)</span>
                        <input type="number" value={dipThreshold1h} onChange={e => setDipThreshold1h(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>DIP 24H (%)</span>
                        <input type="number" value={dipThreshold24h} onChange={e => setDipThreshold24h(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {strategyType === 'momentum' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>MA PERIOD</span>
                        <input type="number" value={maPeriod} onChange={e => setMaPeriod(Number(e.target.value))} min={2}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>VOLUME (x)</span>
                        <input type="number" value={volumeThreshold} onChange={e => setVolumeThreshold(Number(e.target.value))} step={0.1} min={0.1}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {strategyType === 'mean_reversion' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>MA PERIOD</span>
                        <input type="number" value={maPeriod} onChange={e => setMaPeriod(Number(e.target.value))} min={2}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>DEVIATION (σ)</span>
                        <input type="number" value={deviationThreshold} onChange={e => setDeviationThreshold(Number(e.target.value))} step={0.5} min={0.5}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {strategyType === 'breakout' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>LOOKBACK</span>
                        <input type="number" value={lookbackPeriods} onChange={e => setLookbackPeriods(Number(e.target.value))} min={2}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>CONFIRM BARS</span>
                        <input type="number" value={breakoutConfirmBars} onChange={e => setBreakoutConfirmBars(Number(e.target.value))} min={1}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {strategyType === 'grid' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>GRID SPACE (%)</span>
                        <input type="number" value={gridSpacingPct} onChange={e => setGridSpacingPct(Number(e.target.value))} step={0.5} min={0.5}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>GRID LEVELS</span>
                        <input type="number" value={gridLevels} onChange={e => setGridLevels(Number(e.target.value))} min={2}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {strategyType === 'hurst_hcoo_lb' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>HURST PERIOD</span>
                        <input type="number" value={hurstPeriod} onChange={e => setHurstPeriod(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>H THRESHOLD</span>
                        <input type="number" step={0.05} value={hurstThreshold} onChange={e => setHurstThreshold(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>BB PERIOD</span>
                        <input type="number" value={bbPeriod} onChange={e => setBbPeriod(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                      <div>
                        <span className="text-[8px] font-bold" style={teLabelStyle}>BB σ</span>
                        <input type="number" step={0.5} value={bbStd} onChange={e => setBbStd(Number(e.target.value))}
                          className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                      </div>
                    </div>
                  )}

                  {/* TP / SL */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>TAKE PROFIT (%)</span>
                      <input type="number" value={takeProfitPct} onChange={e => setTakeProfitPct(Number(e.target.value))} min={0.5} step={0.5}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>STOP LOSS (%)</span>
                      <input type="number" value={stopLossPct} onChange={e => setStopLossPct(Number(e.target.value))} min={0.5} step={0.5}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                  </div>

                  {/* Max hold + Fee */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>MAX HOLD (H)</span>
                      <input type="number" value={maxHoldingHours} onChange={e => setMaxHoldingHours(Number(e.target.value))} min={1}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                    <div>
                      <span className="text-[8px] font-bold" style={teLabelStyle}>FEE (%)</span>
                      <input type="number" value={feePct} onChange={e => setFeePct(Number(e.target.value))} min={0} max={1} step={0.01}
                        className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-1" style={teInputStyle} />
                    </div>
                  </div>

                  {/* Compound switch */}
                  <button onClick={() => setCompound(!compound)} className="flex items-center gap-1.5">
                    <div className="w-6 h-3 rounded-full relative" style={{ background: compound ? te.green : te.borderLight }}>
                      <div className="size-2.5 rounded-full absolute top-0.5 transition-all" style={{ left: compound ? 12 : 2, background: compound ? '#fff' : te.textDim }} />
                    </div>
                    <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono }}>COMPOUND</span>
                  </button>

                  {/* Granularity info */}
                  {days <= 90 && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: te.blueBg, border: `1px solid ${te.blue}22` }}>
                      <Zap className="size-3" style={{ color: te.blue }} />
                      <span className="text-[9px]" style={{ color: te.blue, fontFamily: te.mono }}>Hourly data — more precise</span>
                    </div>
                  )}
                  {days > 90 && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: te.yellowBg, border: `1px solid ${te.yellow}22` }}>
                      <AlertTriangle className="size-3" style={{ color: te.yellow }} />
                      <span className="text-[9px]" style={{ color: te.yellow, fontFamily: te.mono }}>Daily data — less precise (&gt;90d)</span>
                    </div>
                  )}

                  {/* Run button */}
                  <button onClick={runBacktestFn} disabled={running}
                    className="w-full px-3 py-1.5 text-[9px] font-bold rounded-sm transition-all flex items-center justify-center gap-2"
                    style={{ background: te.orange, color: '#000', border: 'none', fontFamily: te.mono, letterSpacing: '0.04em', opacity: running ? 0.7 : 1 }}>
                    {running ? (<><RefreshCw className="size-3 animate-spin" />COMPUTING...</>) : (<><Play className="size-3" />RUN BACKTEST</>)}
                  </button>
                </div>
              </div>
            </div>

            {/* ─── Right: Results ──────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-3">
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-sm" style={{ background: te.redBg, border: `1px solid ${te.red}44` }}>
                  <span className="text-[10px]" style={{ color: te.red, fontFamily: te.mono }}>{error}</span>
                </div>
              )}

              {/* Empty state */}
              {!result && !error && !running && (
                <div className="py-16 flex flex-col items-center justify-center" style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                  <Brain className="size-10 mb-3" style={{ color: te.textDim, opacity: 0.3 }} />
                  <span className="text-[11px] font-bold" style={{ color: te.text, fontFamily: te.mono, letterSpacing: '0.06em' }}>CONFIGURE & RUN BACKTEST</span>
                  <span className="text-[9px] mt-1" style={{ color: te.textDim, fontFamily: te.mono }}>Set parameters and click &quot;RUN BACKTEST&quot;</span>
                </div>
              )}

              {/* Results */}
              {result && (
                <>
                  {/* Top badges */}
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm flex items-center gap-1" style={{
                      background: result.results.data_granularity === 'hourly' ? te.greenBg : 'transparent',
                      color: result.results.data_granularity === 'hourly' ? te.green : te.textDim,
                      border: `1px solid ${result.results.data_granularity === 'hourly' ? `${te.green}33` : te.border}`,
                      fontFamily: te.mono, letterSpacing: '0.04em',
                    }}>
                      {result.results.data_granularity === 'hourly' ? <><Zap className="size-2.5" /> HOURLY</> : <><Clock className="size-2.5" /> DAILY</>}
                    </span>
                    {result.results.data_granularity === 'daily' && <span className="text-[8px]" style={{ color: te.yellow, fontFamily: te.mono }}>Results may be less precise</span>}
                  </div>

                  {/* Metric cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <MetricCard label="TOTAL RETURN" value={`${result.results.total_return_pct >= 0 ? '+' : ''}${result.results.total_return_pct.toFixed(2)}%`} sub={`Final: $${result.results.final_capital.toFixed(2)}`} color={result.results.total_return_pct >= 0 ? te.green : te.red} icon={<TrendingUp />} />
                    <MetricCard label="WIN RATE" value={`${result.results.win_rate.toFixed(1)}%`} sub={`${result.results.winning_trades}W / ${result.results.losing_trades}L / ${result.results.breakeven_trades}BE of ${result.results.total_trades}`} color={result.results.win_rate >= 50 ? te.green : te.red} icon={<Target />} />
                    <MetricCard label="MAX DRAWDOWN" value={`-${result.results.max_drawdown_pct.toFixed(2)}%`} sub="Max peak decline" color={result.results.max_drawdown_pct > 20 ? te.red : result.results.max_drawdown_pct > 10 ? te.yellow : te.green} icon={<TrendingDown />} />
                    <MetricCard label="PROFIT FACTOR" value={result.results.profit_factor >= 999 ? '999+' : result.results.profit_factor.toFixed(2)} sub={`Info Ratio: ${result.results.info_ratio.toFixed(2)}`} color={result.results.profit_factor >= 1.5 ? te.green : result.results.profit_factor >= 1 ? te.yellow : te.red} icon={<Trophy />} />
                  </div>

                  {/* Equity Curve */}
                  <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                    <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                      <div>
                        <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>EQUITY CURVE</span>
                      </div>
                      <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                        {compound ? 'Compound' : 'No compound'} — {COIN_OPTIONS.find(c => c.id === coinId)?.label || coinId}, {days}d ({result.results.data_granularity === 'hourly' ? '1H' : '1D'})
                      </span>
                    </div>
                    <div className="p-2">
                      <EquityCurveSVG
                        equityCurve={result.equity_curve}
                        color={result.results.total_return_pct >= 0 ? te.green : te.red}
                        te={te}
                      />
                    </div>
                  </div>

                  {/* Stats + Exit Reasons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Detailed stats */}
                    <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                      <div className="px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                        <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>DETAILED STATS</span>
                      </div>
                      <div className="p-3 space-y-0.5">
                        <StatRow label="Avg net profit (win)" value={result.results.avg_profit_pct > 0 ? `+${result.results.avg_profit_pct.toFixed(2)}%` : '0%'} color={te.green} />
                        <StatRow label="Avg net loss (loss)" value={`${result.results.avg_loss_pct.toFixed(2)}%`} color={te.red} />
                        <StatRow label="Avg net profit/trade" value={`${result.results.avg_net_profit_pct >= 0 ? '+' : ''}${result.results.avg_net_profit_pct.toFixed(2)}%`} color={result.results.avg_net_profit_pct >= 0 ? te.green : te.red} />
                        <div style={{ borderTop: `1px solid ${te.border}`, margin: '4px 0' }} />
                        <StatRow label="Best trade" value={`+${result.results.best_trade_pct.toFixed(2)}%`} color={te.green} />
                        <StatRow label="Worst trade" value={`${result.results.worst_trade_pct.toFixed(2)}%`} color={te.red} />
                        <StatRow label="Avg holding" value={`${result.results.avg_holding_hours.toFixed(1)}h`} color={te.text} />
                        <div style={{ borderTop: `1px solid ${te.border}`, margin: '4px 0' }} />
                        <StatRow label="Consecutive wins" value={`${result.results.consecutive_wins} in a row`} color={te.green} />
                        <StatRow label="Consecutive losses" value={`${result.results.consecutive_losses} in a row`} color={te.red} />
                        <StatRow label="Info Ratio" value={result.results.info_ratio.toFixed(2)} color={result.results.info_ratio >= 1 ? te.green : te.yellow} />
                        <StatRow label="Profit Factor" value={result.results.profit_factor >= 999 ? '999+' : result.results.profit_factor.toFixed(2)} color={result.results.profit_factor >= 1.5 ? te.green : result.results.profit_factor >= 1 ? te.yellow : te.red} />
                        <div style={{ borderTop: `1px solid ${te.border}`, margin: '4px 0' }} />
                        <StatRow label="Total fees" value={`$${result.results.total_fees.toFixed(2)}`} color={te.yellow} />
                        <StatRow label="Total slippage" value={`$${(result.results.total_slippage ?? 0).toFixed(2)}`} color={te.yellow} />
                        <StatRow label="Slippage / trade" value={`${(result.results.slippage_pct ?? 0.05).toFixed(2)}%`} color={te.yellow} />
                        <StatRow label="Wick simulation" value={result.results.wick_simulation ? 'ON' : 'OFF'} color={result.results.wick_simulation ? te.green : te.textDim} />
                      </div>
                    </div>

                    {/* Execution Model + Exit Reasons */}
                    <div className="space-y-3">
                      {/* Execution model warning */}
                      <div className="p-3 rounded-sm" style={{ background: te.yellowBg, border: `1px solid ${te.yellow}30` }}>
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="size-3.5" style={{ color: te.yellow }} />
                          <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em', fontFamily: te.mono }}>EXECUTION MODEL</span>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{
                              background: result.results.data_granularity === 'hourly' ? te.greenBg : 'transparent',
                              color: result.results.data_granularity === 'hourly' ? te.green : te.textDim,
                              border: `1px solid ${result.results.data_granularity === 'hourly' ? `${te.green}33` : te.border}`,
                              fontFamily: te.mono, letterSpacing: '0.04em',
                            }}>
                              {result.results.data_granularity === 'hourly' ? '1H' : '1D'}
                            </span>
                            <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono }}>
                              {result.results.data_granularity === 'hourly' ? 'Buy/sell on 1H candle close' : 'Buy/sell on 1D candle close'}
                            </span>
                          </div>
                          {result.results.wick_simulation ? (
                            <p className="text-[9px]" style={{ color: te.yellow, fontFamily: te.mono }}>
                              Wick sim ON — SL/TP checked inside candle (ATR-estimated). More realistic.
                            </p>
                          ) : (
                            <p className="text-[9px]" style={{ color: te.red, fontFamily: te.mono }}>
                              Wick sim OFF — SL/TP checked on candle close only. May skip intra-candle stops.
                            </p>
                          )}
                          <p className="text-[9px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                            Slippage: {(result.results.slippage_pct ?? 0.05).toFixed(2)}% — Total: ${(result.results.total_slippage ?? 0).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Exit Reasons */}
                      <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                        <div className="px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                          <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>EXIT REASONS</span>
                        </div>
                        <div className="p-3">
                          <ExitReasonsBar trades={result.trades} te={te} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Trade History */}
                  {result.trades.length > 0 && (
                    <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
                      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                        <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>TRADE HISTORY</span>
                        <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>{result.trades.length} trades | Fees: ${result.results.total_fees.toFixed(2)}</span>
                      </div>
                      <div className="overflow-y-auto" style={{ maxHeight: '200px', scrollbarWidth: 'thin' }}>
                        <div className="px-3 py-1.5">
                          {/* Header row */}
                          <div className="grid grid-cols-7 gap-2 text-[8px] font-bold pb-1" style={{ color: te.textDim, fontFamily: te.mono, letterSpacing: '0.06em', borderBottom: `1px solid ${te.border}` }}>
                            <span>ENTRY</span><span>PRICE IN</span><span>EXIT</span><span>PRICE OUT</span><span>GROSS</span><span>NET</span><span>REASON</span>
                          </div>
                          {/* Trade rows */}
                          {result.trades.map((trade, i) => (
                            <div key={i} className="grid grid-cols-7 gap-2 py-1.5 text-[9px] items-center" style={{ borderBottom: `1px solid ${te.borderLight}`, fontFamily: te.mono }}>
                              <span style={{ color: te.textDim }}>{new Date(trade.entry_date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}</span>
                              <span style={{ color: te.text, fontVariantNumeric: 'tabular-nums' }}>${trade.entry_price.toFixed(4)}</span>
                              <span style={{ color: te.textDim }}>{new Date(trade.exit_date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}</span>
                              <span style={{ color: te.text, fontVariantNumeric: 'tabular-nums' }}>${trade.exit_price.toFixed(4)}</span>
                              <span style={{ color: trade.profit_pct >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{trade.profit_pct >= 0 ? '+' : ''}{trade.profit_pct.toFixed(2)}%</span>
                              <span style={{ color: trade.net_profit_pct >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{trade.net_profit_pct >= 0 ? '+' : ''}{trade.net_profit_pct.toFixed(2)}%</span>
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm inline-block" style={{
                                color: trade.exit_reason === 'take_profit' ? te.green : trade.exit_reason === 'stop_loss' ? te.red : te.yellow,
                                background: trade.exit_reason === 'take_profit' ? te.greenBg : trade.exit_reason === 'stop_loss' ? te.redBg : te.yellowBg,
                                border: `1px solid ${trade.exit_reason === 'take_profit' ? `${te.green}33` : trade.exit_reason === 'stop_loss' ? `${te.red}33` : `${te.yellow}33`}`,
                                letterSpacing: '0.04em',
                              }}>
                                {exitReasonLabel(trade.exit_reason).toUpperCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ─── Drawdown Heat Map ─────────────────────────────────────── */}
          <div style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '2px' }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
              <span className="size-2.5 rounded-sm" style={{ background: te.red }} />
              <span className="text-[9px] font-bold" style={{ color: te.text, letterSpacing: '0.08em' }}>DRAWDOWN HEAT MAP</span>
              <span className="text-[8px]" style={{ color: te.textDim, fontFamily: te.mono }}>Top 15 coins, last 7 days</span>
            </div>
            <div className="p-3">
              <DrawdownHeatMap />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
