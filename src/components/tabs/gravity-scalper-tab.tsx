'use client'

// Gravity Scalper - Manual Scalping Interface
// Teenage Engineering / Oscilloscope / Scientific Instrument style
// Data: Real Binance Futures WebSocket orderbook + aggTrade
//
// Performance: Dot + Trail use requestAnimationFrame + direct DOM manipulation.
// React state updates at ~10fps (WS rate) for orderbook/grid/positions.
// RAF runs at 60fps for smooth dot movement via JS lerping.
// Trail rendered as single <path> instead of 200+ individual lines.

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { TE, useTE } from '@/lib/te-theme'
import { useBinanceWS } from '@/hooks/use-binance-ws'
import type { BinanceDepthLevel } from '@/lib/cex-anomaly-types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScalpPosition {
  id: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  sizeUsd: number
  timestamp: number
}

// ─── Pairs ──────────────────────────────────────────────────────────────────

const PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC', decimals: 1 },
  { symbol: 'ETHUSDT', label: 'ETH', decimals: 2 },
  { symbol: 'SOLUSDT', label: 'SOL', decimals: 3 },
  { symbol: 'BNBUSDT', label: 'BNB', decimals: 2 },
  { symbol: 'XRPUSDT', label: 'XRP', decimals: 4 },
  { symbol: 'DOGEUSDT', label: 'DOGE', decimals: 5 },
  { symbol: 'SUIUSDT', label: 'SUI', decimals: 3 },
  { symbol: 'PEPEUSDT', label: 'PEPE', decimals: 8 },
  { symbol: 'HYPEUSDT', label: 'HYPE', decimals: 3 },
  { symbol: 'LINKUSDT', label: 'LINK', decimals: 3 },
  { symbol: 'ADAUSDT', label: 'ADA', decimals: 4 },
  { symbol: 'FILUSDT', label: 'FIL', decimals: 3 },
] as const

// ─── Constants ──────────────────────────────────────────────────────────────

const SIM = {
  LIMIT_OFFSET: 0.0005,
  DEPTH_LEVELS: 50,  // REST API depth (WS always uses 20@100ms internally)
} as const

// TE-aligned color system — vivid neon orderbook colors
const C = {
  bg: TE.bg,
  card: TE.bgCard,
  border: TE.border,
  borderLight: TE.borderLight,
  bid: '#00FF88',         // vivid neon green
  bidDim: '#0A2E1F',
  bidGlow: 'rgba(0,255,136,0.25)',
  ask: '#FF3355',         // vivid neon red
  askDim: '#2E0A0A',
  askGlow: 'rgba(255,51,85,0.25)',
  orange: TE.orange,
  text: TE.text,
  textMuted: TE.textMuted,
  textDim: TE.textDim,
  dot: '#FFFFFF',
  profitGreen: TE.green,
  lossRed: TE.red,
}

let _seq = 0
function uid() { return `gs-${++_seq}` }

// ─── Component ──────────────────────────────────────────────────────────────

export default function GravityScalperTab() {
  const te = useTE()
  // ─── State ────────────────────────────────────────────────────────────
  const [activePairIdx, setActivePairIdx] = useState(0)
  const [positions, setPositions] = useState<ScalpPosition[]>([])
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [flashSide, setFlashSide] = useState<'BID' | 'ASK' | null>(null)
  const [capital, setCapital] = useState(80)
  const [capitalInput, setCapitalInput] = useState('80')
  const [capitalEditing, setCapitalEditing] = useState(false)
  const [showOrders, setShowOrders] = useState(true)

  const positionsRef = useRef(positions)
  useEffect(() => { positionsRef.current = positions }, [positions])

  const activePair = PAIRS[activePairIdx]

  // ─── Binance WebSocket ────────────────────────────────────────────────
  const { orderBook, tradeData, connected } = useBinanceWS({
    symbol: activePair.symbol,
    enabled: true,
    depthLevels: SIM.DEPTH_LEVELS,
  })

  // ─── Derived: current price from best bid/ask mid ─────────────────────
  const currentPrice = useMemo(() => {
    if (!orderBook) return 0
    const bestBid = orderBook.bids[0]?.price ?? 0
    const bestAsk = orderBook.asks[0]?.price ?? 0
    if (bestBid && bestAsk) return (bestBid + bestAsk) / 2
    return bestBid || bestAsk || 0
  }, [orderBook])

  const priceRef = useRef(currentPrice)
  useEffect(() => { priceRef.current = currentPrice }, [currentPrice])

  // ─── Spread ───────────────────────────────────────────────────────────
  const spread = useMemo(() => {
    if (!orderBook) return { abs: 0, pct: 0 }
    const bestBid = orderBook.bids[0]?.price ?? 0
    const bestAsk = orderBook.asks[0]?.price ?? 0
    const abs = bestAsk - bestBid
    const pct = bestBid > 0 ? (abs / bestBid) * 100 : 0
    return { abs, pct }
  }, [orderBook])

  // ─── CVD direction ───────────────────────────────────────────────────
  const momentum = useMemo(() => {
    if (!tradeData) return 0
    return tradeData.cvdDelta
  }, [tradeData])

  // ─── Flash effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!flashSide) return
    const t = setTimeout(() => setFlashSide(null), 400)
    return () => clearTimeout(t)
  }, [flashSide])

  // ─── Action feedback ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lastAction) return
    const t = setTimeout(() => setLastAction(null), 2000)
    return () => clearTimeout(t)
  }, [lastAction])

  // ─── Avg entry for laser ──────────────────────────────────────────────
  const avgEntry = useMemo(() => {
    if (positions.length === 0) return null
    const longs = positions.filter(p => p.side === 'LONG')
    const shorts = positions.filter(p => p.side === 'SHORT')
    const netSize = longs.reduce((s, p) => s + p.sizeUsd, 0) - shorts.reduce((s, p) => s + p.sizeUsd, 0)
    if (netSize === 0) return null
    const totalCost = longs.reduce((s, p) => s + p.entryPrice * p.sizeUsd, 0) - shorts.reduce((s, p) => s + p.entryPrice * p.sizeUsd, 0)
    return { price: totalCost / netSize, netSide: netSize > 0 ? 'LONG' : 'SHORT' as const, netSize: Math.abs(netSize) }
  }, [positions])

  // ─── Total unrealized PnL ─────────────────────────────────────────────
  const unrealizedPnl = useMemo(() => {
    if (!avgEntry || !currentPrice) return 0
    const direction = avgEntry.netSide === 'LONG' ? 1 : -1
    return direction * (currentPrice - avgEntry.price) / avgEntry.price * avgEntry.netSize
  }, [avgEntry, currentPrice])

  // ─── Per-position PnL ────────────────────────────────────────────────
  const positionPnls = useMemo(() => {
    if (!currentPrice) return new Map<string, { pnlPct: number; pnlUsd: number }>()
    const m = new Map<string, { pnlPct: number; pnlUsd: number }>()
    for (const pos of positions) {
      const dir = pos.side === 'LONG' ? 1 : -1
      const pnlPct = dir * (currentPrice - pos.entryPrice) / pos.entryPrice * 100
      const pnlUsd = dir * (currentPrice - pos.entryPrice) / pos.entryPrice * pos.sizeUsd
      m.set(pos.id, { pnlPct, pnlUsd })
    }
    return m
  }, [positions, currentPrice])

  // ─── Capital handlers ─────────────────────────────────────────────────
  const handleCapitalSubmit = useCallback(() => {
    const val = parseFloat(capitalInput)
    if (!isNaN(val) && val > 0) setCapital(val)
    setCapitalEditing(false)
  }, [capitalInput])

  // ─── Hotkey Actions ───────────────────────────────────────────────────
  const handleF1 = useCallback(() => {
    if (!currentPrice) return
    const price = currentPrice * (1 - SIM.LIMIT_OFFSET)
    const pos: ScalpPosition = { id: uid(), side: 'LONG', entryPrice: price, sizeUsd: capital, timestamp: Date.now() }
    setPositions(prev => [...prev, pos])
    setLastAction(`BUY LIMIT $${capital} @ ${formatScalpPrice(price, activePair.decimals)}`)
    setFlashSide('BID')
  }, [currentPrice, activePair.decimals, capital])

  const handleF2 = useCallback(() => {
    if (!currentPrice) return
    const pos: ScalpPosition = { id: uid(), side: 'LONG', entryPrice: currentPrice, sizeUsd: capital, timestamp: Date.now() }
    setPositions(prev => [...prev, pos])
    setLastAction(`BUY MARKET $${capital} @ ${formatScalpPrice(currentPrice, activePair.decimals)}`)
    setFlashSide('BID')
  }, [currentPrice, activePair.decimals, capital])

  const handleF3 = useCallback(() => {
    if (!currentPrice) return
    const price = currentPrice * (1 + SIM.LIMIT_OFFSET)
    const pos: ScalpPosition = { id: uid(), side: 'SHORT', entryPrice: price, sizeUsd: capital, timestamp: Date.now() }
    setPositions(prev => [...prev, pos])
    setLastAction(`SELL LIMIT $${capital} @ ${formatScalpPrice(price, activePair.decimals)}`)
    setFlashSide('ASK')
  }, [currentPrice, activePair.decimals, capital])

  const handleESC = useCallback(() => {
    if (positionsRef.current.length === 0) return
    const avg = positionsRef.current.reduce((s, p) => s + p.entryPrice * p.sizeUsd, 0) /
                positionsRef.current.reduce((s, p) => s + p.sizeUsd, 0)
    setPositions([])
    setLastAction(`CLOSE ALL @ ${formatScalpPrice(avg, activePair.decimals)}`)
    setFlashSide('ASK')
  }, [activePair.decimals])

  // ─── Click on price axis to sell ──────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null)
  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!currentPrice || !svgRef.current) return
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    const scaleY = viewBox.height / rect.height
    const svgY = (e.clientY - rect.top) * scaleY
    const clickedPrice = displayLoRef.current + (CHART_H - (svgY - PAD_TOP)) / CHART_H * priceRangeRef.current
    const pos: ScalpPosition = { id: uid(), side: 'SHORT', entryPrice: clickedPrice, sizeUsd: capital, timestamp: Date.now() }
    setPositions(prev => [...prev, pos])
    setLastAction(`SELL CLICK $${capital} @ ${formatScalpPrice(clickedPrice, activePair.decimals)}`)
    setFlashSide('ASK')
  }, [currentPrice, activePair.decimals, capital])

  // ─── Keyboard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); handleF1() }
      else if (e.key === 'F2') { e.preventDefault(); handleF2() }
      else if (e.key === 'F3') { e.preventDefault(); handleF3() }
      else if (e.key === 'Escape') { handleESC() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleF1, handleF2, handleF3, handleESC])

  // ─── Chart dimensions ─────────────────────────────────────────────────
  const W = 600
  const H = 700
  const PAD_TOP = 30
  const PAD_BOT = 30
  const CHART_H = H - PAD_TOP - PAD_BOT
  // L2 Volume Profile zones
  const PROFILE_MAX_W = 220  // max width of volume bars on each side
  const CENTER_ZONE = 60     // clear zone around center axis for dot + trail
  const CENTER_LEFT = (W / 2) - (CENTER_ZONE / 2)   // left edge of center zone
  const CENTER_RIGHT = (W / 2) + (CENTER_ZONE / 2)   // right edge of center zone
  const BAR_H = 2            // thin bar height for performance

  // ─── Build book from WS data ──────────────────────────────────────────
  const { bids, asks, minPrice, maxPrice, maxBidVol, maxAskVol } = useMemo(() => {
    if (!orderBook || !orderBook.bids.length || !orderBook.asks.length) {
      return { bids: [] as BinanceDepthLevel[], asks: [] as BinanceDepthLevel[], minPrice: 0, maxPrice: 1, maxBidVol: 1, maxAskVol: 1 }
    }
    const b = orderBook.bids.sort((a, b) => b.price - a.price)
    const a = orderBook.asks.sort((a, b) => a.price - b.price)
    const allPrices = [...b.map(l => l.price), ...a.map(l => l.price)]
    const min = Math.min(...allPrices)
    const max = Math.max(...allPrices)
    const mbv = Math.max(...b.map(l => l.quantity), 1)
    const mav = Math.max(...a.map(l => l.quantity), 1)
    return { bids: b, asks: a, minPrice: min, maxPrice: max, maxBidVol: mbv, maxAskVol: mav }
  }, [orderBook])

  // ─── Smoothed & padded price range ────────────────────────────────────
  const RANGE_PADDING_PCT = 0.002
  const smoothRef = useRef({ lo: 0, hi: 1 })

  const { displayLo, displayHi } = useMemo(() => {
    if (!currentPrice || !minPrice || !maxPrice) return { displayLo: 0, displayHi: 1 }
    const priceSpan = maxPrice - minPrice
    const minSpan = currentPrice * 0.003
    const effectiveSpan = Math.max(priceSpan, minSpan)
    const halfSpan = effectiveSpan / 2
    const rawLo = Math.min(minPrice, currentPrice - halfSpan) - currentPrice * RANGE_PADDING_PCT
    const rawHi = Math.max(maxPrice, currentPrice + halfSpan) + currentPrice * RANGE_PADDING_PCT
    const prev = smoothRef.current
    const lo = prev.lo === 0 ? rawLo : prev.lo * 0.85 + rawLo * 0.15
    const hi = prev.hi === 1 ? rawHi : prev.hi * 0.85 + rawHi * 0.15
    const finalLo = Math.min(lo, rawLo)
    const finalHi = Math.max(hi, rawHi)
    smoothRef.current = { lo: finalLo, hi: finalHi }
    return { displayLo: finalLo, displayHi: finalHi }
  }, [currentPrice, minPrice, maxPrice])

  const displayLoRef = useRef(displayLo)
  const priceRangeRef = useRef(displayHi - displayLo || 1)
  useEffect(() => {
    displayLoRef.current = displayLo
    priceRangeRef.current = (displayHi - displayLo) || 1
  }, [displayLo, displayHi])

  const priceRange = (displayHi - displayLo) || 1
  const priceToY = (p: number) => PAD_TOP + CHART_H - ((p - displayLo) / priceRange) * CHART_H
  const orbY = currentPrice ? priceToY(currentPrice) : H / 2

  // ─── Price Grid ────────────────────────────────────────────────────────
  const gridLines = useMemo(() => {
    if (!currentPrice || priceRange <= 0) return []
    const targetLines = 10
    const rawStep = priceRange / targetLines
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const residual = rawStep / mag
    let niceStep: number
    if (residual <= 1.5) niceStep = mag
    else if (residual <= 3.5) niceStep = 2 * mag
    else if (residual <= 7.5) niceStep = 5 * mag
    else niceStep = 10 * mag

    const start = Math.ceil(displayLo / niceStep) * niceStep
    const lines: { price: number; y: number; label: string }[] = []
    for (let p = start; p <= displayHi; p += niceStep) {
      lines.push({ price: p, y: priceToY(p), label: formatScalpPrice(p, activePair.decimals) })
    }
    return lines
  }, [displayLo, displayHi, currentPrice, priceRange, activePair.decimals])

  // ─── Dot color & size based on PnL ──────────────────────────────────
  const pnlPct = avgEntry && currentPrice
    ? (avgEntry.netSide === 'LONG' ? 1 : -1) * (currentPrice - avgEntry.price) / avgEntry.price * 100
    : 0

  const dotBaseR = 3
  const dotR = pnlPct >= 0 ? Math.min(8, dotBaseR + pnlPct * 0.3) : dotBaseR
  const dotColor = pnlPct > 0.01 ? C.profitGreen : pnlPct < -0.01 ? C.lossRed : C.dot

  // ─── Trail color for gradient ────────────────────────────────────────
  const trailColor = pnlPct > 0.01 ? C.profitGreen : pnlPct < -0.01 ? C.lossRed : C.dot
  const trailGradId = pnlPct > 0.01 ? 'trailGradGreen' : pnlPct < -0.01 ? 'trailGradRed' : 'trailGradWhite'

  // ─── RAF Animation System ────────────────────────────────────────────
  // Dot + Trail are driven by requestAnimationFrame at 60fps.
  // Direct DOM manipulation via refs — no React re-renders for animation.
  const DOT_X = W * 0.7
  const LEFT_EDGE = 5
  const TRAIL_SPREAD = DOT_X - LEFT_EDGE - 10

  const dotGroupRef = useRef<SVGGElement>(null)
  const trailMainRef = useRef<SVGPathElement>(null)
  const trailGlow1Ref = useRef<SVGPathElement>(null)
  const trailGlow2Ref = useRef<SVGPathElement>(null)
  const smoothYRef = useRef(H / 2)
  const trailDataRef = useRef<{ price: number; ts: number }[]>([])
  const skipLerpRef = useRef(false)
  const waitingForNewPairRef = useRef(false)
  const orderBookAvailableRef = useRef(false)

  // Track orderBook availability for pair switch detection
  useEffect(() => {
    orderBookAvailableRef.current = !!orderBook
  }, [orderBook])

  // ─── RAF Animation Loop ──────────────────────────────────────────────
  useEffect(() => {
    const LERP = 0.18
    const TRAIL_MAX = 120
    const TRAIL_INTERVAL = 80  // ms between trail points
    let lastTrailTs = 0
    let animId: number

    const animate = () => {
      // During pair switch: hide dot, wait for new data
      if (waitingForNewPairRef.current) {
        if (dotGroupRef.current) {
          dotGroupRef.current.style.opacity = '0'
        }
        // Check if new pair data has arrived
        if (orderBookAvailableRef.current && priceRef.current > 0) {
          waitingForNewPairRef.current = false
          skipLerpRef.current = true
          trailDataRef.current = []
          if (dotGroupRef.current) {
            dotGroupRef.current.style.opacity = '1'
          }
        }
        animId = requestAnimationFrame(animate)
        return
      }

      // Calculate target Y from latest price (via ref, no re-render needed)
      const price = priceRef.current
      const lo = displayLoRef.current
      const range = priceRangeRef.current
      const target = price ? PAD_TOP + CHART_H - ((price - lo) / range) * CHART_H : H / 2

      // Smooth dot position via lerp (or instant jump if skipLerp)
      const current = smoothYRef.current
      let next: number
      if (skipLerpRef.current) {
        next = target
        skipLerpRef.current = false
      } else {
        next = current + (target - current) * LERP
      }
      smoothYRef.current = next

      // Update dot group position via direct DOM (no React re-render)
      if (dotGroupRef.current) {
        dotGroupRef.current.setAttribute('transform', `translate(${DOT_X},${next.toFixed(1)})`)
      }

      // Add trail point (throttled to TRAIL_INTERVAL ms)
      const now = Date.now()
      if (price && now - lastTrailTs > TRAIL_INTERVAL) {
        lastTrailTs = now
        const trail = trailDataRef.current
        trailDataRef.current = [...trail, { price, ts: now }].slice(-TRAIL_MAX)
      }

      // Update trail path via direct DOM
      const trail = trailDataRef.current
      if (trail.length > 2 && trailMainRef.current) {
        const trailLen = trail.length
        const d = trail.map((pt, i) => {
          const y = PAD_TOP + CHART_H - ((pt.price - lo) / range) * CHART_H
          const age = (trailLen - 1 - i) / (trailLen - 1)
          const x = DOT_X - 5 - age * TRAIL_SPREAD
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        }).join(' ')

        trailMainRef.current.setAttribute('d', d)
        if (trailGlow1Ref.current) trailGlow1Ref.current.setAttribute('d', d)
        if (trailGlow2Ref.current) trailGlow2Ref.current.setAttribute('d', d)
      }

      animId = requestAnimationFrame(animate)
    }

    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [])  // Empty deps — RAF loop runs once, reads from refs

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" style={{ background: C.bg, fontFamily: te.mono }}>

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <div className="size-2 rounded-full" style={{
          background: connected ? C.bid : C.textDim,
          boxShadow: connected ? `0 0 6px ${C.bidGlow}` : 'none',
        }} />
        <span className="text-[11px] font-bold" style={{ color: C.text, letterSpacing: '0.12em' }}>
          GRAVITY SCALPER
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{
          color: connected ? C.bid : C.textDim,
          background: connected ? C.bidGlow : C.card,
          border: `1px solid ${connected ? `${C.bid}44` : C.border}`,
        }}>
          {connected ? 'WS LIVE' : 'CONNECTING...'}
        </span>

        {/* Pair selector */}
        <div className="flex items-center gap-0.5 ml-1">
          {PAIRS.map((pair, i) => (
            <button key={pair.symbol}
              onClick={() => {
                setActivePairIdx(i)
                setPositions([])
                trailDataRef.current = []
                smoothRef.current = { lo: 0, hi: 1 }
                waitingForNewPairRef.current = true
                orderBookAvailableRef.current = false
                if (dotGroupRef.current) dotGroupRef.current.style.opacity = '0'
              }}
              className="px-1.5 py-0.5 text-[8px] font-bold rounded-sm transition-all"
              style={{
                fontFamily: te.mono,
                color: i === activePairIdx ? C.orange : C.textDim,
                background: i === activePairIdx ? `${C.orange}1a` : 'transparent',
                border: `1px solid ${i === activePairIdx ? `${C.orange}44` : 'transparent'}`,
                letterSpacing: '0.04em',
              }}>
              {pair.label}
            </button>
          ))}
        </div>

        {/* Capital input */}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[9px]" style={{ color: C.textDim, letterSpacing: '0.06em' }}>CAPITAL</span>
          {capitalEditing ? (
            <input type="number" value={capitalInput}
              onChange={e => setCapitalInput(e.target.value)}
              onBlur={handleCapitalSubmit}
              onKeyDown={e => { if (e.key === 'Enter') handleCapitalSubmit() }}
              className="w-14 px-1 py-0.5 text-[10px] font-bold rounded-sm outline-none"
              style={{ fontFamily: te.mono, color: C.text, background: C.bg, border: `1px solid ${C.orange}` }}
              autoFocus />
          ) : (
            <button onClick={() => { setCapitalInput(String(capital)); setCapitalEditing(true) }}
              className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm"
              style={{ fontFamily: te.mono, color: C.text, background: `${C.orange}15`, border: `1px solid ${C.borderLight}` }}>
              ${capital}
            </button>
          )}
        </div>

        {/* Orderbook toggle */}
        <button onClick={() => setShowOrders(!showOrders)}
          className="px-1.5 py-0.5 text-[8px] font-bold rounded-sm transition-all"
          style={{
            fontFamily: te.mono,
            color: showOrders ? C.orange : C.textDim,
            background: showOrders ? `${C.orange}15` : 'transparent',
            border: `1px solid ${showOrders ? `${C.orange}33` : C.border}`,
            letterSpacing: '0.04em',
          }}>
          {showOrders ? 'OB ON' : 'OB OFF'}
        </button>

        <div className="ml-auto flex items-center gap-4">
          <span className="text-[10px]" style={{ color: C.textDim }}>
            SPREAD: <span style={{ color: C.textMuted }}>{spread.pct.toFixed(3)}%</span>
          </span>
          <span className="text-[10px]" style={{ color: C.textDim }}>
            POS: <span style={{ color: C.text }}>{positions.length}</span>
          </span>
          {positions.length > 0 && (
            <span className="text-[10px] font-bold" style={{ color: unrealizedPnl >= 0 ? C.profitGreen : C.lossRed }}>
              {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
              <span className="text-[8px] ml-1" style={{ color: C.textMuted }}>
                ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
              </span>
            </span>
          )}
        </div>
      </div>

      {/* ─── Main Chart ──────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {!connected || !orderBook ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="size-3 rounded-full mx-auto mb-3" style={{
                background: C.orange, animation: 'pulse 1.5s ease-in-out infinite',
                boxShadow: `0 0 12px ${C.orange}44`,
              }} />
              <span className="text-[10px]" style={{ color: C.textDim, fontFamily: te.mono }}>
                {connected ? 'CZEKAM NA ORDERBOOK...' : 'LACZENIE Z BINANCE WS...'}
              </span>
            </div>
          </div>
        ) : null}

        {/* Single SVG with both React-managed and RAF-managed elements */}
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', background: C.bg, cursor: 'crosshair' }}
          onClick={handleSvgClick}>

          <defs>
            {/* Orb glow */}
            <radialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={pnlPct > 0.01 ? 'rgba(16,185,129,0.4)' : pnlPct < -0.01 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.35)'} />
              <stop offset="60%" stopColor={pnlPct > 0.01 ? 'rgba(16,185,129,0.08)' : pnlPct < -0.01 ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.08)'} />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            {/* Flash gradients */}
            <radialGradient id="flashBid" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.bid} stopOpacity={0.5} />
              <stop offset="100%" stopColor={C.bid} stopOpacity={0} />
            </radialGradient>
            <radialGradient id="flashAsk" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.ask} stopOpacity={0.5} />
              <stop offset="100%" stopColor={C.ask} stopOpacity={0} />
            </radialGradient>
            {/* Trail blur filter */}
            <filter id="trailBlur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
            {/* Trail gradients — left-to-right fade for comet effect */}
            <linearGradient id="trailGradGreen" gradientUnits="userSpaceOnUse" x1={LEFT_EDGE} y1={0} x2={DOT_X} y2={0}>
              <stop offset="0%" stopColor={C.profitGreen} stopOpacity="0" />
              <stop offset="50%" stopColor={C.profitGreen} stopOpacity="0.12" />
              <stop offset="100%" stopColor={C.profitGreen} stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="trailGradRed" gradientUnits="userSpaceOnUse" x1={LEFT_EDGE} y1={0} x2={DOT_X} y2={0}>
              <stop offset="0%" stopColor={C.lossRed} stopOpacity="0" />
              <stop offset="50%" stopColor={C.lossRed} stopOpacity="0.12" />
              <stop offset="100%" stopColor={C.lossRed} stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="trailGradWhite" gradientUnits="userSpaceOnUse" x1={LEFT_EDGE} y1={0} x2={DOT_X} y2={0}>
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.6" />
            </linearGradient>
            {/* Dot glow filter (lighter than before) */}
            <filter id="dotGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
          </defs>

          {/* ─── Price Grid ──────────────────────────────────────────────── */}
          {gridLines.map((gl, i) => (
            <g key={`grid-${i}`}>
              <line x1={0} y1={gl.y} x2={W} y2={gl.y}
                stroke={C.borderLight} strokeWidth={0.3} opacity={0.4} />
              <text x={4} y={gl.y + 3} fontSize={7} fill={C.textDim}
                fontFamily={te.mono} opacity={0.5}>
                ${gl.label}
              </text>
            </g>
          ))}
          {/* Current price reference line */}
          {currentPrice > 0 && (
            <line x1={0} y1={orbY} x2={W} y2={orbY}
              stroke={C.orange} strokeWidth={0.4} strokeDasharray="2,4" opacity={0.3} />
          )}

          {/* ─── L2 VOLUME PROFILE: Bids (left side) - thin bars only ──────── */}
          {showOrders && bids.map((lvl, i) => {
            const y = priceToY(lvl.price)
            const volPct = lvl.quantity / maxBidVol
            const isWall = volPct > 0.5
            const barW = volPct * PROFILE_MAX_W
            const barX = CENTER_LEFT - barW
            const barOpacity = isWall ? 0.85 : 0.25 + volPct * 0.4

            return (
              <rect key={`bid-${i}`}
                x={barX} y={y - BAR_H / 2} width={barW} height={BAR_H}
                fill={C.bid} opacity={barOpacity} />
            )
          })}

          {/* ─── L2 VOLUME PROFILE: Asks (right side) - thin bars only ─────── */}
          {showOrders && asks.map((lvl, i) => {
            const y = priceToY(lvl.price)
            const volPct = lvl.quantity / maxAskVol
            const isWall = volPct > 0.5
            const barW = volPct * PROFILE_MAX_W
            const barX = CENTER_RIGHT
            const barOpacity = isWall ? 0.85 : 0.25 + volPct * 0.4

            return (
              <rect key={`ask-${i}`}
                x={barX} y={y - BAR_H / 2} width={barW} height={BAR_H}
                fill={C.ask} opacity={barOpacity} />
            )
          })}

          {/* ─── Center zone separator lines ────────────────────────────── */}
          <line x1={CENTER_LEFT} y1={PAD_TOP} x2={CENTER_LEFT} y2={H - PAD_BOT}
            stroke={C.border} strokeWidth={0.3} opacity={0.15} />
          <line x1={CENTER_RIGHT} y1={PAD_TOP} x2={CENTER_RIGHT} y2={H - PAD_BOT}
            stroke={C.border} strokeWidth={0.3} opacity={0.15} />

          {/* ─── Comet Trail (RAF-driven, single <path> with gradient) ──── */}
          {/* Glow layer 1 — blurry, wide */}
          <path ref={trailGlow1Ref} fill="none"
            stroke={`url(#${trailGradId})`} strokeWidth={14} opacity={0.04}
            strokeLinecap="round" strokeLinejoin="round" filter="url(#trailBlur)" />
          {/* Glow layer 2 — medium width */}
          <path ref={trailGlow2Ref} fill="none"
            stroke={`url(#${trailGradId})`} strokeWidth={5} opacity={0.08}
            strokeLinecap="round" strokeLinejoin="round" />
          {/* Main trail line */}
          <path ref={trailMainRef} fill="none"
            stroke={`url(#${trailGradId})`} strokeWidth={1.8} opacity={0.7}
            strokeLinecap="round" strokeLinejoin="round" />

          {/* ─── The Dot (RAF-driven via group transform, no CSS transitions) */}
          {/* All children positioned relative to group origin (0,0) */}
          <g ref={dotGroupRef} style={{ opacity: currentPrice ? 1 : 0 }}>
            {/* Outer glow */}
            <circle cx={0} cy={0} r={dotR + 12} fill="url(#orbGlow)" />
            {/* Mid glow ring */}
            <circle cx={0} cy={0} r={dotR + 3}
              fill={dotColor === C.dot ? 'rgba(255,255,255,0.12)' : dotColor === C.profitGreen ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}
              filter="url(#dotGlow)" />
            {/* Main dot */}
            <circle cx={0} cy={0} r={dotR} fill={dotColor} />
            {/* Inner highlight */}
            <circle cx={0} cy={0} r={Math.max(1, dotR * 0.4)}
              fill={dotColor === C.lossRed ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.9)'} />

            {/* Price label next to dot */}
            <rect x={dotR + 5} y={-7} width={currentPrice ? 70 : 30} height={14} rx={2}
              fill={`${C.orange}15`} stroke={`${C.orange}33`} strokeWidth={0.5} />
            <text x={dotR + 8} y={3} fontSize={9} fill={C.orange}
              fontFamily={te.mono} fontWeight={700}>
              {currentPrice ? `$${currentPrice.toLocaleString('en-US', { minimumFractionDigits: activePair.decimals, maximumFractionDigits: activePair.decimals })}` : '--'}
            </text>

            {/* Momentum indicator — only when direction is clear */}
            {momentum !== 0 && (
              <text x={-dotR - 8} y={4} fontSize={9}
                fill={momentum > 0 ? C.bid : C.ask}
                textAnchor="end" fontFamily={te.mono} fontWeight={700}>
                {momentum > 0 ? '▲' : '▼'}
              </text>
            )}
          </g>

          {/* ─── Best bid/ask markers ──────────────────────────────────── */}
          {showOrders && <>
          {orderBook && orderBook.bids[0] && (
            <line x1={W * 0.7 - 20} y1={priceToY(orderBook.bids[0].price)} x2={W * 0.7 + 20}
              y2={priceToY(orderBook.asks[0]?.price ?? 0)} stroke={C.bid} strokeWidth={2} opacity={0.9} />
          )}
          {orderBook && orderBook.asks[0] && (
            <line x1={W * 0.7 - 20} y1={priceToY(orderBook.asks[0].price)} x2={W * 0.7 + 20}
              y2={priceToY(orderBook.asks[0].price)} stroke={C.ask} strokeWidth={2} opacity={0.9} />
          )}
          </>}

          {/* ─── Position entry lines ────────────────────────────────────── */}
          {positions.map((pos) => {
            const pnl = positionPnls.get(pos.id)
            const pnlPctVal = pnl?.pnlPct ?? 0
            const pnlUsdVal = pnl?.pnlUsd ?? 0
            const lineColor = pnlPctVal > 0.01 ? C.profitGreen : pnlPctVal < -0.01 ? C.lossRed : C.orange
            const y = priceToY(pos.entryPrice)
            return (
              <g key={`pos-${pos.id}`}>
                <line x1={0} y1={y} x2={W} y2={y}
                  stroke={lineColor} strokeWidth={0.8} strokeDasharray="4,2" opacity={0.7} />
                <rect x={W - 135} y={y - 10} width={130} height={13} rx={2}
                  fill={`${lineColor}18`} stroke={lineColor} strokeWidth={0.5} />
                <text x={W - 132} y={y} fontSize={7} fill={lineColor}
                  fontFamily={te.mono} fontWeight={700}>
                  {pos.side === 'LONG' ? 'BUY' : 'SELL'} {formatScalpPrice(pos.entryPrice, activePair.decimals)}
                  {' | '}{pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}%
                  {' | '}{pnlUsdVal >= 0 ? '+' : ''}${pnlUsdVal.toFixed(2)}
                </text>
              </g>
            )
          })}

          {/* ─── Flash effect ──────────────────────────────────────────── */}
          {flashSide && (
            <ellipse cx={W * 0.7} cy={orbY} rx={40} ry={20}
              fill={flashSide === 'BID' ? 'url(#flashBid)' : 'url(#flashAsk)'} />
          )}

        </svg>
      </div>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-2 flex items-center gap-4" style={{ borderTop: `1px solid ${C.border}`, background: C.card }}>
        <div className="flex items-center gap-3">
          <HotkeyBadge label="F1" desc="BUY LIMIT" color={C.bid} />
          <HotkeyBadge label="F2" desc="BUY MARKET" color={C.bid} />
          <HotkeyBadge label="F3" desc="SELL LIMIT" color={C.ask} />
          <HotkeyBadge label="ESC" desc="CLOSE ALL" color="#5C1A1A" />
          <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{
            fontFamily: te.mono, color: C.textDim, background: `${C.textDim}12`,
            border: `1px solid ${C.border}`,
          }}>
            CLICK = SELL AT PRICE
          </span>
        </div>
        {lastAction && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-sm" style={{
            fontFamily: te.mono,
            color: flashSide === 'BID' ? C.bid : C.ask,
            background: flashSide === 'BID' ? C.bidGlow : C.askGlow,
            border: `1px solid ${flashSide === 'BID' ? `${C.bid}33` : `${C.ask}33`}`,
          }}>
            {lastAction}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[9px] font-bold" style={{ color: C.orange, fontFamily: te.mono }}>
            {activePair.label}/USDT
          </span>
          <span className="text-[9px]" style={{ color: C.textDim, fontFamily: te.mono }}>
            DEPTH {bids.length + asks.length}
          </span>
          {tradeData && (
            <span className="text-[9px]" style={{ color: C.textDim, fontFamily: te.mono }}>
              CVD <span style={{ color: tradeData.cvdDelta >= 0 ? C.bid : C.ask, fontWeight: 700 }}>
                {tradeData.cvdDelta >= 0 ? '+' : ''}{tradeData.cvdDelta.toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatScalpPrice(price: number, decimals: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return price.toFixed(decimals || 4)
}

// ─── Sub-components ────────────────────────────────────────────────────────

function HotkeyBadge({ label, desc, color }: { label: string; desc: string; color: string }) {
  const te = useTE()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
        fontFamily: te.mono, color, background: `${color}22`, border: `1px solid ${color}44`,
      }}>
        {label}
      </span>
      <span className="text-[8px]" style={{ color: C.textDim, fontFamily: te.mono }}>
        {desc}
      </span>
    </div>
  )
}
