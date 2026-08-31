'use client'

// ─── HCCCO_LB + Bollinger Bands Auxiliary Chart (15m Candles) ───────────────
// SVG chart showing price with Bollinger Bands overlay + HCCCO Oscillator subplot.
// Uses real 15-minute candle data from Binance API — stable, no flickering.
//
// HCCCO_LB = Hurst Cycle Channel Clone Oscillator [LazyBear]
//   - Fast Osc (oshort): price position in medium channel (red line)
//   - Slow Osc (omed): short-cycle median position in medium channel (green line)
//   - Histogram: purple bars when osc > 1.0 or < 0.0 (overbought/oversold)
//   - Bar coloring: based on oshort position (green=neutral, red=oversold, purple=extreme)
//
// Data source: Binance /api/v3/klines?interval=15m
// Refresh: every 60 seconds (not on every tick)

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTE } from '@/lib/te-theme'
import { formatPrice, computeBB, computeHCCCO, computeHCCCOSignal } from '@/lib/cex-anomaly-helpers'
import type { HCCCOSignalType } from '@/lib/cex-anomaly-helpers'
import { TrendingDown, TrendingUp, ArrowDown, ArrowUp, Loader2 } from 'lucide-react'

export interface HurstBBChartProps {
  activePairSymbol: string
  activePairDecimals: number
  wsConnected: boolean
}

// ── Sliding window: only show last N candles ──
const VISIBLE_WINDOW = 80

// ── HCCCO defaults (LazyBear) ──
const HCCCO_SHORT_CYCLE = 10
const HCCCO_MED_CYCLE = 30
const HCCCO_SHORT_MULT = 1.0
const HCCCO_MED_MULT = 3.0

// ── Kline refresh interval ──
const KLINES_REFRESH_MS = 60_000 // 60 seconds — no more 2x/sec flickering
const KLINES_LIMIT = 150 // fetch enough for HCCCO computation (needs ~30 warmup)

// ── Signal badge styling ──
const SIGNAL_STYLES: Record<HCCCOSignalType, { bg: string; color: string; border: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  OVERBOUGHT: { bg: '#ff44441a', color: '#ff4444', border: '#ff444466', icon: ArrowDown },
  OVERSOLD: { bg: '#00ff881a', color: '#00ff88', border: '#00ff8866', icon: ArrowUp },
  BULL_CROSS: { bg: '#00ff881a', color: '#00ff88', border: '#00ff8866', icon: TrendingUp },
  BEAR_CROSS: { bg: '#ff66001a', color: '#ff6600', border: '#ff660066', icon: TrendingDown },
  OS_CROSS_UP: { bg: '#00ff881a', color: '#00ff88', border: '#00ff8866', icon: ArrowUp },
  OB_CROSS_DOWN: { bg: '#ff44441a', color: '#ff4444', border: '#ff444466', icon: ArrowDown },
  NEUTRAL: { bg: 'transparent', color: '#888', border: '#444', icon: TrendingDown },
}

/** Convert "ETH-USDT" → "ETHUSDT" for Binance API */
function toBinanceSymbol(pairSymbol: string): string {
  return pairSymbol.replace('-', '')
}

export default React.memo(function HurstBBChart({
  activePairSymbol,
  activePairDecimals,
  wsConnected,
}: HurstBBChartProps) {
  const te = useTE()

  // ── 15m kline state ──
  const [closePrices, setClosePrices] = useState<number[]>([])
  const [klineTimes, setKlineTimes] = useState<number[]>([])
  const [fetchStatus, setFetchStatus] = useState<'LOADING' | 'OK' | 'ERROR'>('LOADING')
  const [hoverSvgX, setHoverSvgX] = useState<number | null>(null)
  const lastFetchRef = useRef(0)
  const mountedRef = useRef(true)

  const bbPeriod = 20
  const bbStdDev = 2.0

  // ── Fetch 15m klines from Binance ──
  const fetchKlines = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastFetchRef.current < KLINES_REFRESH_MS * 0.9) return

    const symbol = toBinanceSymbol(activePairSymbol)
    try {
      const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=15m&limit=${KLINES_LIMIT}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) throw new Error('No kline data')

      // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
      const closes: number[] = []
      const times: number[] = []
      for (const k of data) {
        const close = parseFloat(k[4])
        const openTime = Number(k[0])
        if (!isNaN(close) && close > 0) {
          closes.push(close)
          times.push(openTime)
        }
      }
      if (!mountedRef.current) return
      setClosePrices(closes)
      setKlineTimes(times)
      setFetchStatus('OK')
      lastFetchRef.current = Date.now()
    } catch (err) {
      if (!mountedRef.current) return
      setFetchStatus(prev => prev === 'LOADING' ? 'ERROR' : prev)
    }
  }, [activePairSymbol])

  // ── Auto-fetch on mount + every 60s ──
  useEffect(() => {
    mountedRef.current = true
    void fetchKlines(true)
    const interval = setInterval(() => void fetchKlines(), KLINES_REFRESH_MS)
    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [fetchKlines])

  // ── HCCCO + BB: computed on 15m close prices ──
  const hccco = useMemo(() => closePrices.length > HCCCO_MED_CYCLE
    ? computeHCCCO(closePrices, HCCCO_SHORT_CYCLE, HCCCO_MED_CYCLE, HCCCO_SHORT_MULT, HCCCO_MED_MULT)
    : null, [closePrices])

  const bb = useMemo(() => closePrices.length > bbPeriod
    ? computeBB(closePrices, bbPeriod, bbStdDev)
    : { upper: [] as (number | null)[], lower: [] as (number | null)[], ma: [] as (number | null)[], upperInner: [] as (number | null)[], lowerInner: [] as (number | null)[] }, [closePrices])

  // ── HCCCO signal ──
  const hcccoSignal = useMemo(() => hccco
    ? computeHCCCOSignal(hccco.fastOsc, hccco.slowOsc)
    : { type: 'NEUTRAL' as HCCCOSignalType, fastVal: 0.5, slowVal: 0.5, strength: 0, description: '' }, [hccco])

  // ── Apply sliding window ──
  const totalN = closePrices.length
  const windowStart = Math.max(0, totalN - VISIBLE_WINDOW)
  const displayN = totalN - windowStart

  // ── Slice display data ──
  const dispPrices = useMemo(() => closePrices.slice(windowStart), [closePrices, windowStart])
  const dispBBUpper = useMemo(() => bb.upper.slice(windowStart), [bb.upper, windowStart])
  const dispBBLower = useMemo(() => bb.lower.slice(windowStart), [bb.lower, windowStart])
  const dispBBMA = useMemo(() => bb.ma.slice(windowStart), [bb.ma, windowStart])
  const dispFastOsc = useMemo(() => hccco ? hccco.fastOsc.slice(windowStart) : [], [hccco, windowStart])
  // Slow oscillator removed — only Fast (red) line is displayed
  const dispTimes = useMemo(() => klineTimes.slice(windowStart), [klineTimes, windowStart])

  // ── Chart dimensions ──
  const w = 600
  const h = 420
  const priceH = h * 0.47
  const oscH = h * 0.47
  const pad = 12

  const isLoading = fetchStatus === 'LOADING' || totalN < bbPeriod || displayN < 2 || !hccco

  if (isLoading) {
    return (
      <div className="rounded-sm p-3 flex items-center justify-center" style={{ background: te.bgCard, border: `1px solid ${te.border}`, height: h + 70, overflow: 'hidden' }}>
        <span className="text-[12px] flex items-center gap-2" style={{ color: te.textDim, fontFamily: te.mono }}>
          <Loader2 className="size-3 animate-spin" style={{ color: te.cyan }} />
          {fetchStatus === 'LOADING'
            ? 'Loading 15m candles...'
            : totalN < bbPeriod
              ? `Accumulating 15m candles (${totalN}/${bbPeriod})...`
              : 'Computing HCCCO + BB...'}
        </span>
      </div>
    )
  }

  // ── Convert nulls to numeric (for BB warmup period) ──
  const bbUpperNum = dispBBUpper.map((v: number | null, i: number) => v ?? dispPrices[i])
  const bbLowerNum = dispBBLower.map((v: number | null, i: number) => v ?? dispPrices[i])
  const bbMANum = dispBBMA.map((v: number | null, i: number) => v ?? dispPrices[i])

  // ── Price range with BB ──
  const validBBUpper = bbUpperNum.filter((_, i) => dispBBUpper[i] !== null)
  const validBBLower = bbLowerNum.filter((_, i) => dispBBLower[i] !== null)
  const rawMinPrice = Math.min(...validBBLower, ...dispPrices)
  const rawMaxPrice = Math.max(...validBBUpper, ...dispPrices)
  const rawPriceRange = rawMaxPrice - rawMinPrice || 1
  const pricePad = rawPriceRange * 0.05

  const minPrice = rawMinPrice - pricePad
  const maxPrice = rawMaxPrice + pricePad
  const priceRange = maxPrice - minPrice || 1

  const chartW = w - pad * 2
  const xAt = (di: number) => pad + (di / (displayN - 1)) * chartW
  const priceY = (price: number) => pad + (priceH - pad * 2) - ((price - minPrice) / priceRange) * (priceH - pad * 2)

  // ── HCCCO Y-axis: dynamic range ──
  const allOscVals = [...dispFastOsc]
  const oscDataMin = allOscVals.length > 0 ? Math.min(...allOscVals) : -0.2
  const oscDataMax = allOscVals.length > 0 ? Math.max(...allOscVals) : 1.2
  const oscNeededMin = Math.min(oscDataMin, -0.05)
  const oscNeededMax = Math.max(oscDataMax, 1.05)
  const oscRawRange = oscNeededMax - oscNeededMin
  const oscHeadroom = oscRawRange * 0.20
  const oscYMin = oscNeededMin - oscHeadroom
  const oscYMax = oscNeededMax + oscHeadroom
  const oscYRange = oscYMax - oscYMin
  const oscY = (val: number) => priceH + pad + (oscH - pad) - ((val - oscYMin) / oscYRange) * (oscH - pad * 2)

  // ── Time axis labels (show every ~10 candles) ──
  const timeLabels = (() => {
    const step = Math.max(1, Math.floor(displayN / 6))
    const labels: { x: number; text: string }[] = []
    for (let i = 0; i < displayN; i += step) {
      const ts = dispTimes[i]
      if (!ts) continue
      const d = new Date(ts)
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      labels.push({ x: xAt(i), text: `${dd}/${mo} ${hh}:${mm}` })
    }
    return labels
  })()

  // ── Build SVG paths ──
  const pricePath = dispPrices.map((price, di) => `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(price).toFixed(1)}`).join(' ')

  const dispBBUpperFirst = dispBBUpper.findIndex((v: number | null) => v !== null)
  const bbUpperPath = bbUpperNum.map((v, di) => dispBBUpper[di] !== null ? `${di === dispBBUpperFirst ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  const dispBBLowerFirst = dispBBLower.findIndex((v: number | null) => v !== null)
  const bbLowerPath = bbLowerNum.map((v, di) => dispBBLower[di] !== null ? `${di === dispBBLowerFirst ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  const bbFillPath = (() => {
    const firstValid = dispBBUpper.findIndex((v: number | null) => v !== null)
    if (firstValid < 0) return ''
    const upperPart = bbUpperNum.slice(firstValid).map((v, di) =>
      dispBBUpper[firstValid + di] !== null ? `L${xAt(firstValid + di).toFixed(1)},${priceY(v).toFixed(1)}` : ''
    ).filter(Boolean).join(' ')
    const lowerPart = bbLowerNum.slice(firstValid).map((v, di) =>
      dispBBLower[firstValid + di] !== null ? `L${xAt(firstValid + di).toFixed(1)},${priceY(v).toFixed(1)}` : ''
    ).filter(Boolean).reverse().join(' ')
    return `M${xAt(firstValid).toFixed(1)},${priceY(bbUpperNum[firstValid]).toFixed(1)} ${upperPart} ${lowerPart} Z`
  })()

  const dispMAFirst = dispBBMA.findIndex((v: number | null) => v !== null)
  const maPath = bbMANum.map((v, di) => dispBBMA[di] !== null ? `${di === dispMAFirst ? 'M' : 'L'}${xAt(di).toFixed(1)},${priceY(v).toFixed(1)}` : '').filter(Boolean).join(' ')

  const fastOscPath = dispFastOsc.map((v, di) => `${di === 0 ? 'M' : 'L'}${xAt(di).toFixed(1)},${oscY(v).toFixed(1)}`).join(' ')
  // slowOscPath removed

  // ── Current values ──
  const currentPrice = dispPrices[displayN - 1]
  const currentBBLower = dispBBLower[displayN - 1] !== null ? bbLowerNum[displayN - 1] : null
  const currentBBUpperVal = dispBBUpper[displayN - 1] !== null ? bbUpperNum[displayN - 1] : null
  const currentBBLowerRaw = dispBBLower[displayN - 1]
  const currentFast = dispFastOsc[displayN - 1] ?? 0.5
  const currentSlow = hccco ? hccco.slowOsc[hccco.slowOsc.length - 1] ?? 0.5 : 0.5

  const sig = hcccoSignal
  const sigStyle = SIGNAL_STYLES[sig.type]
  const SigIcon = sigStyle.icon

  const barColor = currentFast > 0.5
    ? (currentFast > 1.0 ? '#ff4444' : currentFast > 0.8 ? '#00ff00' : '#22c55e')
    : (currentFast < 0 ? '#60a5fa' : currentFast < 0.2 ? '#ff4444' : '#ff6600')

  const oscLabelColor = currentFast > 1.0 ? '#ff4444'
    : currentFast < 0 ? '#60a5fa'
    : currentFast > 0.5 ? te.green
    : te.red

  const totalH = h + 70

  return (
    <div className="rounded-sm p-3" style={{ background: te.bgCard, border: `1px solid ${te.border}`, height: totalH, overflow: 'hidden' }}>
      {/* ── Header row ── */}
      <div className="flex items-center gap-2 mb-1" style={{ flexWrap: 'nowrap', minHeight: 20 }}>
        <TrendingDown className="size-3.5" style={{ color: te.cyan }} />
        <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
          HCCCO_LB + BOLLINGER
        </span>
        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-sm ml-1" style={{
          background: `${te.cyan}1a`, color: te.cyan,
          border: `1px solid ${te.cyan}33`, fontFamily: te.mono,
        }}>
          {activePairSymbol}
        </span>
        {/* 15m badge */}
        <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
          background: `${te.orange}1a`, color: te.orange,
          border: `1px solid ${te.orange}33`, fontFamily: te.mono,
        }}>
          15m
        </span>
        {/* WS LIVE */}
        <span className="text-[11px] font-bold px-1 py-0.5 rounded-sm" style={{
          background: wsConnected ? te.greenBg : 'transparent',
          color: wsConnected ? te.green : 'transparent',
          border: `1px solid ${wsConnected ? te.green + '33' : 'transparent'}`,
          fontFamily: te.mono,
          opacity: wsConnected ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}>
          WS LIVE
        </span>

        <div className="flex items-center gap-3 ml-auto" style={{ flexShrink: 0 }}>
          <span className="text-[10px]" style={{ fontFamily: te.mono, color: te.textDim }}>
            {displayN} candles
          </span>
          <span className="text-[10px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: te.cyan }}>BB</span>
            <span className="ml-1" style={{ color: te.textDim }}>{bbPeriod}/{bbStdDev}</span>
          </span>
          <span className="text-[10px]" style={{ fontFamily: te.mono }}>
            <span style={{ color: '#ff4444' }}>Fast</span>
            <span className="ml-1" style={{ color: oscLabelColor, fontWeight: 700 }}>{currentFast.toFixed(2)}</span>
          </span>
        </div>
      </div>

      {/* ── Signal info bar ── */}
      <div style={{ height: 22, marginBottom: 4, overflow: 'hidden' }}>
        <div className="flex items-center gap-2 px-2 py-0.5 rounded-sm" style={{
          background: sig.type !== 'NEUTRAL' ? sigStyle.bg : 'transparent',
          color: sig.type !== 'NEUTRAL' ? sigStyle.color : 'transparent',
          border: `1px solid ${sig.type !== 'NEUTRAL' ? sigStyle.border : 'transparent'}`,
          fontFamily: te.mono,
          opacity: sig.type !== 'NEUTRAL' ? 1 : 0,
          transition: 'opacity 0.3s ease',
          height: '100%',
        }}>
          <SigIcon className="size-2.5 shrink-0" />
          <span className="text-[10px] font-bold" style={{ letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
            {sig.type !== 'NEUTRAL' ? sig.type : 'NEUTRAL'}
          </span>
          <span className="text-[9px]" style={{ opacity: sig.strength > 0.5 && sig.type !== 'NEUTRAL' ? 0.7 : 0, transition: 'opacity 0.2s ease' }}>
            {(sig.strength * 100).toFixed(0)}%
          </span>
          <span className="text-[9px]" style={{ opacity: sig.type !== 'NEUTRAL' ? 0.4 : 0 }}>—</span>
          <span className="text-[9px]" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig.description}</span>
        </div>
      </div>

      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ fontFamily: te.mono }}
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
          <linearGradient id="bbFillGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={te.cyan} stopOpacity={0.06} />
            <stop offset="50%" stopColor={te.cyan} stopOpacity={0.02} />
            <stop offset="100%" stopColor={te.cyan} stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="oscGreenFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="oscRedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4444" stopOpacity={0.03} />
            <stop offset="100%" stopColor="#ff4444" stopOpacity={0.08} />
          </linearGradient>
        </defs>

        {/* Separator */}
        <line x1={pad} y1={priceH + pad * 0.5} x2={w - pad} y2={priceH + pad * 0.5}
          stroke={te.borderLight} strokeWidth={0.5} strokeDasharray="2,4" />

        {/* Section labels */}
        <text x={pad} y={pad + 8} fontSize={8} fill={te.textDim} fontWeight={700}>PRICE + BB({bbPeriod},{bbStdDev}) — 15m</text>
        <text x={pad} y={priceH + pad * 0.5 + 10} fontSize={8} fill="#a855f7" fontWeight={700} opacity={0.7}>HCCCO_LB ({HCCCO_SHORT_CYCLE}/{HCCCO_MED_CYCLE})</text>

        {/* Time axis labels at bottom of price section */}
        {timeLabels.map((lb, i) => (
          <text key={`t-${i}`} x={lb.x} y={priceH - 1} fontSize={6} fill={te.textDim} textAnchor="middle" opacity={0.5}>{lb.text}</text>
        ))}

        {/* BB fill area */}
        {bbFillPath && <path d={bbFillPath} fill="url(#bbFillGrad)" />}

        {/* BB upper band */}
        {bbUpperPath && <path d={bbUpperPath} fill="none" stroke={te.cyan} strokeWidth={0.8} opacity={0.5} strokeDasharray="3,3" />}

        {/* BB lower band */}
        {bbLowerPath && <path d={bbLowerPath} fill="none" stroke={te.cyan} strokeWidth={0.8} opacity={0.5} strokeDasharray="3,3" />}

        {/* BB middle (MA) */}
        {maPath && <path d={maPath} fill="none" stroke={te.cyan} strokeWidth={0.5} opacity={0.3} />}

        {/* Price line */}
        <path d={pricePath} fill="none" stroke={te.text} strokeWidth={1.5} />

        {/* Price below lower BB — green dots */}
        {dispPrices.map((price, di) => {
          if (dispBBLower[di] === null) return null
          const bl = bbLowerNum[di]
          if (price < bl) {
            return <circle key={`bl-${di}`} cx={xAt(di)} cy={priceY(price)} r={3} fill={te.green} opacity={0.9} />
          }
          return null
        })}

        {/* Price above upper BB — orange/red dots */}
        {dispPrices.map((price, di) => {
          if (dispBBUpper[di] === null) return null
          const bu = bbUpperNum[di]
          if (price > bu) {
            return <circle key={`bu-${di}`} cx={xAt(di)} cy={priceY(price)} r={3} fill={te.orange} opacity={0.9} />
          }
          return null
        })}

        {/* ══════ HCCCO Oscillator Subplot ══════ */}

        {/* Green fill zone: 0.0 to 0.5 */}
        <rect x={pad} y={oscY(0.5)} width={chartW} height={oscY(0.0) - oscY(0.5)} fill="url(#oscGreenFill)" />

        {/* Red fill zone: 0.5 to 1.0 */}
        <rect x={pad} y={oscY(1.0)} width={chartW} height={oscY(0.5) - oscY(1.0)} fill="url(#oscRedFill)" />

        {/* 0.0 line */}
        <line x1={pad} y1={oscY(0.0)} x2={w - pad} y2={oscY(0.0)}
          stroke={te.green} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.6} />
        <text x={pad + 4} y={oscY(0.0) - 2} fontSize={8} fill={te.green} textAnchor="start" opacity={0.8} fontWeight={700}>0.0</text>

        {/* 0.5 line */}
        <line x1={pad} y1={oscY(0.5)} x2={w - pad} y2={oscY(0.5)}
          stroke={te.textDim} strokeWidth={0.5} strokeDasharray="4,4" opacity={0.4} />
        <text x={pad + 4} y={oscY(0.5) - 2} fontSize={8} fill={te.textDim} textAnchor="start" opacity={0.6}>0.5</text>

        {/* 1.0 line */}
        <line x1={pad} y1={oscY(1.0)} x2={w - pad} y2={oscY(1.0)}
          stroke={te.red} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.6} />
        <text x={pad + 4} y={oscY(1.0) - 2} fontSize={8} fill={te.red} textAnchor="start" opacity={0.8} fontWeight={700}>1.0</text>

        {/* ── Histogram bars: purple when osc > 1.0 or < 0.0 ── */}
        {(() => {
          const barWidth = Math.max(1, chartW / displayN - 1)
          return dispFastOsc.map((fastVal, di) => {
            if (fastVal >= 1.0) {
              const y1 = oscY(fastVal)
              const y2 = oscY(1.0)
              return <rect key={`hob-${di}`} x={xAt(di) - barWidth / 2} y={y1} width={barWidth} height={y2 - y1} fill="#ff4444" opacity={0.7} />
            }
            if (fastVal <= 0.0) {
              const y1 = oscY(0.0)
              const y2 = oscY(fastVal)
              return <rect key={`hos-${di}`} x={xAt(di) - barWidth / 2} y={y1} width={barWidth} height={y2 - y1} fill="#60a5fa" opacity={0.7} />
            }
            // Slow histogram bars removed
            return null
          })
        })()}

        {/* Slow oscillator (omed) — removed */}

        {/* Fast oscillator (oshort) — adapts to theme (white on dark, black on light) */}
        {fastOscPath && <path d={fastOscPath} fill="none" stroke={te.text} strokeWidth={1.5} opacity={0.9} />}

        {/* Current fast osc dot */}
        <circle cx={xAt(displayN - 1)} cy={oscY(currentFast)} r={3} fill={barColor} stroke={te.bg} strokeWidth={0.5} />

        {/* Current price label */}
        <text x={w - pad} y={pad + 11} fontSize={11} fill={te.text} textAnchor="end" fontWeight={700}>
          {formatPrice(currentPrice, activePairDecimals)}
          <tspan fill={sig.type === 'OS_CROSS_UP' || sig.type === 'OVERSOLD' || sig.type === 'BULL_CROSS' ? te.green : 'transparent'} fontSize={8}> OS</tspan>
          <tspan fill={sig.type === 'OB_CROSS_DOWN' || sig.type === 'OVERBOUGHT' || sig.type === 'BEAR_CROSS' ? '#ff4444' : 'transparent'} fontSize={8}> OB</tspan>
        </text>

        {/* Current BB values */}
        {currentBBLowerRaw !== null && currentBBLower !== null && (
          <text x={w - pad} y={pad + 20} fontSize={7} fill={te.cyan} textAnchor="end" opacity={0.6}>
            BB {formatPrice(currentBBLower, activePairDecimals)} - {formatPrice(currentBBUpperVal!, activePairDecimals)}
          </text>
        )}

        {/* Current HCCCO values label */}
        <text x={w - pad} y={priceH + pad * 0.5 + 10} fontSize={8} fill={oscLabelColor} textAnchor="end" fontWeight={700}>
          Fast {currentFast.toFixed(2)}
        </text>

        {/* BB labels on right edge */}
        {currentBBUpperVal !== null && (
          <text x={w - pad} y={priceY(currentBBUpperVal) - 2} fontSize={6} fill={te.cyan} textAnchor="end" opacity={0.5}>UP</text>
        )}
        {currentBBLower !== null && (
          <text x={w - pad} y={priceY(currentBBLower) + 7} fontSize={6} fill={te.cyan} textAnchor="end" opacity={0.5}>LO</text>
        )}

        {/* Time axis labels at bottom of oscillator section */}
        {timeLabels.map((lb, i) => (
          <text key={`to-${i}`} x={lb.x} y={h - 2} fontSize={6} fill={te.textDim} textAnchor="middle" opacity={0.4}>{lb.text}</text>
        ))}

        {/* ── Crosshair tooltip on hover ── */}
        {(() => {
          if (hoverSvgX == null || displayN < 2) return null
          const relX = (hoverSvgX - pad) / chartW
          if (relX < 0 || relX > 1) return null
          const di = Math.max(0, Math.min(displayN - 1, Math.round(relX * (displayN - 1))))
          const cx = xAt(di)
          const priceVal = dispPrices[di]
          const pY = priceY(priceVal)
          const bbUpVal = dispBBUpper[di] !== null ? bbUpperNum[di] : null
          const bbLoVal = dispBBLower[di] !== null ? bbLowerNum[di] : null
          const fastVal = dispFastOsc[di] ?? 0.5
          const slowVal = hccco ? hccco.slowOsc[windowStart + di] ?? 0.5 : 0.5
          const tVal = dispTimes[di] ?? 0
          const tStr = tVal
            ? new Date(tVal).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
            : '--:--'
          const labelW = 70
          const labelX = cx + labelW + pad > w - pad ? cx - labelW - 2 : cx + 4
          return (
            <g pointerEvents="none">
              {/* Vertical line */}
              <line x1={cx} y1={pad} x2={cx} y2={h - pad}
                stroke={te.text} strokeWidth={0.5} strokeDasharray="2,3" opacity={0.6} />
              {/* Horizontal price line */}
              <line x1={pad} y1={pY} x2={w - pad} y2={pY}
                stroke={te.text} strokeWidth={0.4} strokeDasharray="2,3" opacity={0.3} />
              {/* Price dot */}
              <circle cx={cx} cy={pY} r={3} fill={te.text} stroke={te.bg} strokeWidth={0.5} />
              {/* BB dots */}
              {bbUpVal !== null && (
                <circle cx={cx} cy={priceY(bbUpVal)} r={2.5} fill={te.cyan} stroke={te.bg} strokeWidth={0.5} />
              )}
              {bbLoVal !== null && (
                <circle cx={cx} cy={priceY(bbLoVal)} r={2.5} fill={te.cyan} stroke={te.bg} strokeWidth={0.5} />
              )}
              {/* Fast osc dot */}
              <circle cx={cx} cy={oscY(fastVal)} r={2.5} fill={te.text} stroke={te.bg} strokeWidth={0.5} />
              {/* Slow osc dot */}
              <circle cx={cx} cy={oscY(slowVal)} r={2.5} fill={te.green} stroke={te.bg} strokeWidth={0.5} opacity={0.7} />
              {/* Price + BB label */}
              <g>
                <rect x={labelX} y={pad} width={labelW} height={22} rx={1} fill={te.bgCard} stroke={te.border} strokeWidth={0.4} opacity={0.95} />
                <text x={labelX + 4} y={pad + 8} fontSize={7} fill={te.text} fontWeight={700} fontFamily={te.mono}>
                  P {formatPrice(priceVal, activePairDecimals)}
                </text>
                <text x={labelX + 4} y={pad + 18} fontSize={7} fill={te.cyan} fontWeight={700} fontFamily={te.mono}>
                  {bbUpVal !== null && bbLoVal !== null
                    ? `BB ${formatPrice(bbLoVal, activePairDecimals)}–${formatPrice(bbUpVal, activePairDecimals)}`
                    : tStr}
                </text>
              </g>
              {/* Osc label */}
              <g>
                <rect x={labelX} y={priceH + pad * 0.5 + 2} width={labelW} height={14} rx={1} fill={te.bgCard} stroke={te.border} strokeWidth={0.4} opacity={0.95} />
                <text x={labelX + 4} y={priceH + pad * 0.5 + 12} fontSize={7} fill={te.text} fontWeight={700} fontFamily={te.mono}>
                  F {fastVal.toFixed(2)} | S {slowVal.toFixed(2)}
                </text>
              </g>
            </g>
          )
        })()}
      </svg>
    </div>
  )
})
