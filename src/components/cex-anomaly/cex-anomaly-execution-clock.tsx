'use client'

// ─── Pixel Digit + Execution Clock — TE 8-bit style ────────────────────────
// Extracted from cex-anomaly-tab.tsx for maintainability
//
// PERF FIX: Removed 50ms setInterval for liveElapsed state updates.
// The old code called setLiveElapsed(Date.now() - sigTs) every 50ms,
// causing the ENTIRE 5500-line parent component to re-render 20x/sec.
// Now: liveElapsed is tracked via ref + DOM-direct updates in RAF loop.
// Digital readouts (PixelDigit) are updated via refs, not React state.
// This eliminates ~20 unnecessary re-renders per second during active phases.

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { useTE } from '@/lib/te-theme'

// ─── Pixel Digit — Teenage Engineering 8-bit style ────────────────────────
// 3×5 dot-matrix grid. Each digit is a 3-col × 5-row bitmap.
// Minimalist, blocky, pixel-perfect — like PO-33 / OP-Z display.

const DIGIT_MAP: Record<string, number[][]> = {
  '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
  '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  '2': [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
  '3': [[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]],
  '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  '5': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
  '6': [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
  '7': [[1,1,1],[0,0,1],[0,1,0],[0,1,0],[0,1,0]],
  '8': [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
  '9': [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
  ':': [[0],[0],[1],[0],[1]],
  '.': [[0],[0],[0],[0],[1]],
  ' ': [[0],[0],[0],[0],[0]],
  // ── Wallet stats characters ──
  '$': [[0,1,0],[1,1,0],[0,1,0],[0,1,1],[0,1,0]],
  '%': [[1,0,1],[1,0,1],[0,1,0],[1,0,1],[1,0,1]],
  '+': [[0,0,0],[0,1,0],[1,1,1],[0,1,0],[0,0,0]],
  '-': [[0,0,0],[0,0,0],[1,1,1],[0,0,0],[0,0,0]],
  'K': [[1,0,1],[1,1,0],[1,0,0],[1,1,0],[1,0,1]],
  'M': [[1,0,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1]],
  'B': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,1,0]],
}

// ─── DOM-direct PixelDigit update ────────────────────────────────────────
// Instead of re-rendering 240 tiny divs every 50ms via React state,
// we update their background color directly via a container ref.
// The initial render creates the DOM structure; subsequent updates
// only change the `background` style property of each dot.

function updatePixelDigitDOM(
  container: HTMLElement | null,
  chars: string,
  color: string
) {
  if (!container) return
  // The ref wraps <PixelDigit>, which renders:
  //   <div ref> → <div class="flex items-end"> → <div grid> char grids
  // We need to skip the PixelDigit root wrapper to reach the character grids.
  const wrapper = container.children[0] as HTMLElement | undefined
  const charEls = wrapper?.children?.length ? wrapper.children : container.children
  for (let ci = 0; ci < chars.length && ci < charEls.length; ci++) {
    const grid = DIGIT_MAP[chars[ci]] || DIGIT_MAP[' ']
    const charEl = charEls[ci] as HTMLElement
    const dotEls = charEl.children
    let di = 0
    for (let ri = 0; ri < grid.length; ri++) {
      for (let co = 0; co < grid[ri].length; co++) {
        if (di < dotEls.length) {
          const dot = dotEls[di] as HTMLElement
          const on = grid[ri][co]
          dot.style.background = on ? color : `${color}10`
          di++
        }
      }
    }
  }
}

export function PixelDigit({ chars, color, size = 3 }: { chars: string; color: string; size?: number }) {
  const te = useTE()
  const gap = 1
  return (
    <div className="flex items-end" style={{ gap: `${size + 1}px` }}>
      {chars.split('').map((ch, ci) => {
        const grid = DIGIT_MAP[ch] || DIGIT_MAP[' ']
        const cols = grid[0].length
        return (
          <div key={ci} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${size}px)`, gridTemplateRows: `repeat(5, ${size}px)`, gap: `${gap}px` }}>
            {grid.flatMap((row, ri) => row.map((on, co) => (
              <div key={`${ri}-${co}`} style={{
                width: size, height: size,
                background: on ? color : `${color}10`,
                borderRadius: 0,
              }} />
            )))}
          </div>
        )
      })}
    </div>
  )
}

// ─── Execution Clock Component ────────────────────────────────────────────
// SVG analog clock face + TE-style 8-bit digital readout
// Shows real-time SIG → QUEUE → API → DONE pipeline timing
// PAPER mode now simulates the same realistic latencies as REAL mode (~300-500ms)
// Hand moves SMOOTHLY like a car gas gauge / tachometer via requestAnimationFrame
// Spring physics: velocity + damping = natural inertia feel
//
// Architecture: Hand elements are in JSX (React manages lifecycle).
// The <g> wrapper's "transform" attribute is updated via RAF using a ref.
// React does NOT set "transform" in JSX, so it never overwrites RAF updates.
// Phase color is also synced to hand elements via RAF ref — no React dependency.
//
// PERF FIX: liveElapsed now tracked via ref + RAF DOM-direct updates.
// No more 50ms setInterval → setLiveElapsed → parent re-render.
// Digital readouts update directly via refs at 60fps in the RAF loop.
// The only React state changes are the execClock prop from parent
// (phase transitions: SIG/QUEUE/API/DONE/IDLE), which happen ~4-5 times
// per trade execution — not 20 times per second continuously.

export interface ExecClockData {
  phase: string
  sigMs: number
  queueMs: number
  apiMs: number
  totalMs: number
  bybitQueueDepth: number
  bybitRateUsed: number  // Real Bybit rate usage % from X-Bapi-Limit headers (fallback to queue depth proxy)
  bybitRateSource: 'HEADERS' | 'LOG' | 'QUEUE_PROXY'  // Where the rate data comes from
  lastExchange: string | null
  execMode: 'PAPER' | 'REAL'  // PAPER = simulated timing, REAL = actual API calls
  sigTs?: number // Signal timestamp — when SIG phase started (for real-time hand tracking)
}

export function ExecutionClockInner({ execClock }: { execClock: ExecClockData }) {
  const te = useTE()
  const { phase, sigMs, queueMs, apiMs, totalMs, bybitQueueDepth, bybitRateUsed, bybitRateSource = 'QUEUE_PROXY', lastExchange, execMode = 'PAPER', sigTs } = execClock

  // Clock face params
  const CX = 90, CY = 90, R = 78
  const handLen = R - 12  // 66px
  const tailLen = 14
  const isActive = phase !== 'IDLE'

  // ─── Refs for DOM-direct digital readout updates ────────────────────
  // Instead of React state (which causes parent re-render), we update
  // the PixelDigit containers directly via refs in the RAF loop.
  const sigDigitRef = useRef<HTMLDivElement>(null)
  const queueDigitRef = useRef<HTMLDivElement>(null)
  const apiDigitRef = useRef<HTMLDivElement>(null)
  const totalDigitRef = useRef<HTMLDivElement>(null)

  // Track phase/sigTs via refs for the RAF loop
  const phaseRef = useRef(phase)
  const sigTsRef = useRef(sigTs)
  const sigMsRef = useRef(sigMs)
  const queueMsRef = useRef(queueMs)
  const apiMsRef = useRef(apiMs)
  const totalMsRef = useRef(totalMs)

  // Keep refs in sync with props (these change only on phase transitions, not every 50ms)
  phaseRef.current = phase
  sigTsRef.current = sigTs
  sigMsRef.current = sigMs
  queueMsRef.current = queueMs
  apiMsRef.current = apiMs
  totalMsRef.current = totalMs

  // ─── Spring physics for smooth hand (DOM-direct via transform, no React re-renders) ───
  const handPhysics = useRef({ angle: 270, velocity: 0 }) // 270° = 12 o'clock
  const targetAngleRef = useRef(270)
  const handGroupRef = useRef<SVGGElement>(null)

  // Format ms as 4-digit string for pixel display
  // When ms=0 and no active phase, return spaces (blank display)
  const fmtMs = (ms: number) => String(Math.min(9999, Math.round(ms))).padStart(4, ' ')
  const BLANK = '    '

  // Compute target angle from phase/timing — uses refs so it doesn't need React re-render
  const computeTargetAngle = useCallback(() => {
    if (phaseRef.current === 'IDLE') return 270
    const ms = totalMsRef.current > 0 ? totalMsRef.current : 0
    return 270 + (Math.min(ms, 2000) / 2000) * 360
  }, [])

  // Phase color
  const phaseColor = phase === 'SIG' ? te.green : phase === 'QUEUE' ? te.red : phase === 'API' ? te.yellow : phase === 'DONE' ? te.orange : te.textDim
  const phaseColorRef = useRef<string>(te.textDim)
  phaseColorRef.current = isActive ? phaseColor : te.textDim

  // Update target angle when phase changes
  targetAngleRef.current = computeTargetAngle()

  // ─── SINGLE RAF loop — spring physics + hand transform + digital readout ───
  // This replaces both the 50ms setInterval AND the old RAF loop.
  // All updates are DOM-direct via refs — no React state changes.
  // The loop runs at display refresh rate (60fps) but only does work
  // when there's actual change needed.
  useEffect(() => {
    let rafId: number
    const SPRING = 0.12
    const DAMP = 0.78
    const MIN_VEL = 0.05
    const DIGIT_UPDATE_INTERVAL = 50 // Update digital readouts every 50ms (same visual feel)
    let lastDigitUpdate = 0

    const tick = (now: number) => {
      const h = handPhysics.current
      const currentPhase = phaseRef.current
      const currentSigTs = sigTsRef.current
      const isLive = currentPhase !== 'IDLE' && currentPhase !== 'DONE' && currentSigTs

      // ── Update target angle in real-time during active phases ──
      if (isLive) {
        const liveElapsed = Date.now() - currentSigTs
        targetAngleRef.current = 270 + (Math.min(liveElapsed, 2000) / 2000) * 360
      } else if (currentPhase === 'DONE') {
        targetAngleRef.current = 270 + (Math.min(totalMsRef.current, 2000) / 2000) * 360
      } else {
        targetAngleRef.current = 270 // IDLE
      }

      const target = targetAngleRef.current
      const diff = target - h.angle
      h.velocity = (h.velocity + diff * SPRING) * DAMP
      h.angle += h.velocity

      if (Math.abs(diff) < 0.1 && Math.abs(h.velocity) < MIN_VEL) {
        h.angle = target
        h.velocity = 0
      }

      // Update the <g> transform — rotate around clock center
      const svgRotation = h.angle - 270
      const g = handGroupRef.current
      if (g) {
        g.setAttribute('transform', `rotate(${svgRotation}, ${CX}, ${CY})`)
        const color = phaseColorRef.current
        const line = g.querySelector('line')
        const tail = g.querySelectorAll('line')[1]
        const dot = g.querySelector('circle')
        if (line) line.setAttribute('stroke', color)
        if (tail) tail.setAttribute('stroke', color)
        if (dot) dot.setAttribute('fill', color)
      }

      // ── Update digital readouts every DIGIT_UPDATE_INTERVAL ms ──
      // DOM-direct — no React state changes
      if (now - lastDigitUpdate >= DIGIT_UPDATE_INTERVAL) {
        lastDigitUpdate = now

        let liveElapsed = 0
        if (isLive) {
          liveElapsed = Date.now() - currentSigTs
        }

        const effectiveTotalMs = currentPhase === 'DONE'
          ? totalMsRef.current
          : isLive ? liveElapsed : 0

        const liveSigMs = currentPhase === 'SIG' ? liveElapsed : sigMsRef.current
        const liveQueueMs = currentPhase === 'QUEUE'
          ? Math.max(0, liveElapsed - sigMsRef.current)
          : queueMsRef.current
        const liveApiMs = currentPhase === 'API'
          ? Math.max(0, liveElapsed - sigMsRef.current - queueMsRef.current)
          : apiMsRef.current

        // Update PixelDigit containers via DOM
        // When phase is IDLE, show blank (no digits) instead of "0" or "   0"
        const idleOrDone = currentPhase === 'IDLE'
        updatePixelDigitDOM(sigDigitRef.current, idleOrDone ? BLANK : fmtMs(liveSigMs), te.green)
        updatePixelDigitDOM(queueDigitRef.current, idleOrDone ? BLANK : fmtMs(liveQueueMs), te.red)
        updatePixelDigitDOM(apiDigitRef.current, idleOrDone ? BLANK : fmtMs(liveApiMs), te.yellow)
        updatePixelDigitDOM(totalDigitRef.current, idleOrDone ? BLANK : fmtMs(effectiveTotalMs), te.orange)
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [te]) // re-create on theme change so digital readouts use correct colors

  // Arc segments for each phase (colored arcs on the clock face)
  const msToDeg = (ms: number) => (ms / 2000) * 360
  const arcPath = (startMs: number, endMs: number, r: number) => {
    const s = 270 + msToDeg(startMs)
    const e = 270 + msToDeg(endMs)
    const sr = (s * Math.PI) / 180, er = (e * Math.PI) / 180
    const sx = CX + Math.cos(sr) * r, sy = CY + Math.sin(sr) * r
    const ex = CX + Math.cos(er) * r, ey = CY + Math.sin(er) * r
    const large = (e - s) > 180 ? 1 : 0
    return `M${sx},${sy} A${r},${r} 0 ${large} 1 ${ex},${ey}`
  }

  // Rate limit bar
  const RateBar = ({ pct, label, color }: { pct: number; label: string; color: string }) => (
    <div className="flex items-center gap-1.5">
      <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textMuted, width: 40 }}>{label}</span>
      <div style={{ width: 60, height: 6, background: te.bgInput, border: `1px solid ${te.border}` }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct > 80 ? te.red : pct > 50 ? te.yellow : color, transition: 'width 0.2s' }} />
      </div>
      <span style={{ fontFamily: te.mono, fontSize: '9px', color: pct > 80 ? te.red : te.textDim }}>{Math.round(pct)}%</span>
    </div>
  )

  // Hand color
  const handColor = isActive ? phaseColor : te.textDim

  // For the arc rendering, use the prop values (these update on phase transitions)
  const liveSigMs = sigMs
  const liveQueueMs = queueMs
  const liveApiMs = apiMs
  const effectiveTotalMs = totalMs

  return (
    <div className="rounded-sm p-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, color: te.text, letterSpacing: '0.1em' }}>
          EXECUTION CLOCK
        </span>
        {lastExchange && (
          <span style={{
            fontFamily: te.mono, fontSize: '9px', fontWeight: 700,
            color: lastExchange === 'BYBIT' ? '#f7a600' : te.textMuted,
            background: lastExchange === 'BYBIT' ? '#f7a60015' : `${te.textMuted}15`,
            border: `1px solid ${lastExchange === 'BYBIT' ? '#f7a60044' : `${te.textMuted}33`}`,
            padding: '1px 6px', borderRadius: '2px',
          }}>
            {lastExchange}
          </span>
        )}
        {/* PAPER / REAL mode badge */}
        <span style={{
          fontFamily: te.mono, fontSize: '9px', fontWeight: 700,
          color: execMode === 'REAL' ? te.green : te.textMuted,
          background: execMode === 'REAL' ? `${te.green}15` : `${te.textMuted}10`,
          border: `1px solid ${execMode === 'REAL' ? `${te.green}44` : `${te.textMuted}22`}`,
          padding: '1px 6px', borderRadius: '2px',
          boxShadow: execMode === 'REAL' ? `0 0 6px ${te.green}22` : 'none',
        }}>
          {execMode === 'REAL' ? '● REAL' : '○ PAPER'}
        </span>
        {/* Expected timing hint */}
        <span style={{
          fontFamily: te.mono, fontSize: '8px', color: te.textDim,
        }}>
          {execMode === 'REAL' ? '~300-600ms' : '~300-600ms'}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-start gap-4">
        {/* SVG Clock Face */}
        <div className="shrink-0">
          <svg width={180} height={180} viewBox="0 0 180 180" style={{ display: 'block' }}>
            <circle cx={CX} cy={CY} r={R} fill={`${te.bg}`} stroke={te.text} strokeWidth={1} />
            {Array.from({ length: 20 }, (_, i) => {
              const ang = 270 + (i / 20) * 360
              const rad = (ang * Math.PI) / 180
              const isMajor = i % 5 === 0
              const innerR = R - (isMajor ? 10 : 5)
              return (
                <line key={i}
                  x1={CX + Math.cos(rad) * innerR} y1={CY + Math.sin(rad) * innerR}
                  x2={CX + Math.cos(rad) * (R - 2)} y2={CY + Math.sin(rad) * (R - 2)}
                  stroke={isActive ? phaseColor : te.border}
                  strokeWidth={isMajor ? 2 : 1}
                  opacity={isMajor ? 0.8 : 0.3}
                />
              )
            })}
            {/* Arcs: show during all active phases (using prop timing from phase transitions) */}
            {isActive && effectiveTotalMs > 0 && (
              <>
                {liveSigMs > 0 && <path d={arcPath(0, Math.min(liveSigMs, 2000), R - 6)} fill="none" stroke={te.green} strokeWidth={4} opacity={0.7} />}
                {liveQueueMs > 0 && <path d={arcPath(liveSigMs, Math.min(liveSigMs + liveQueueMs, 2000), R - 6)} fill="none" stroke={te.red} strokeWidth={4} opacity={0.7} />}
                {liveApiMs > 0 && <path d={arcPath(liveSigMs + liveQueueMs, Math.min(liveSigMs + liveQueueMs + liveApiMs, 2000), R - 6)} fill="none" stroke={te.yellow} strokeWidth={4} opacity={0.7} />}
              </>
            )}
            {isActive && phase !== 'DONE' && (
              <circle cx={CX} cy={CY} r={R - 1} fill="none" stroke={phaseColor} strokeWidth={1} opacity={0.4}>
                <animate attributeName="opacity" values="0.2;0.6;0.2" dur="1s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={CX} cy={CY} r={5} fill={isActive ? phaseColor : te.textDim} opacity={0.3} />
            <circle cx={CX} cy={CY} r={3} fill={isActive ? phaseColor : te.textDim} />
            {/* ── Clock Hand — JSX elements, RAF-controlled transform ── */}
            {/* The <g> has no "transform" prop in JSX — RAF sets it via setAttribute. */}
            {/* Hand points straight up (12 o'clock = 0° SVG rotation). */}
            {/* Tail extends below center. Tip dot at the end. */}
            <g ref={handGroupRef}>
              <line
                x1={CX} y1={CY}
                x2={CX} y2={CY - handLen}
                stroke={handColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <line
                x1={CX} y1={CY}
                x2={CX} y2={CY + tailLen}
                stroke={handColor}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.5}
              />
              <circle
                cx={CX} cy={CY - handLen}
                r={2}
                fill={handColor}
              />
            </g>
            <text x={CX} y={CY - R + 18} textAnchor="middle" fill={te.textDim} fontSize={7} fontFamily={te.mono}>0ms</text>
            <text x={CX + R - 14} y={CY + 3} textAnchor="middle" fill={te.textDim} fontSize={7} fontFamily={te.mono}>500</text>
            <text x={CX} y={CY + R - 10} textAnchor="middle" fill={te.textDim} fontSize={7} fontFamily={te.mono}>1S</text>
            <text x={CX - R + 14} y={CY + 3} textAnchor="middle" fill={te.textDim} fontSize={7} fontFamily={te.mono}>1500</text>
          </svg>
        </div>

        {/* Digital readout — TE 8-bit pixel style */}
        {/* DOM-direct updated via refs in RAF loop — no React re-renders */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            {(['SIG', 'QUEUE', 'API', 'DONE'] as const).map(p => (
              <div key={p} className="flex items-center gap-1">
                <div style={{
                  width: 6, height: 6,
                  background: phase === p ? (p === 'SIG' ? te.green : p === 'QUEUE' ? te.red : p === 'API' ? te.yellow : te.orange) : `${te.textDim}30`,
                  boxShadow: phase === p ? `0 0 4px ${p === 'SIG' ? te.green : p === 'QUEUE' ? te.red : p === 'API' ? te.yellow : te.orange}` : 'none',
                }} />
                <span style={{ fontFamily: te.mono, fontSize: '9px', color: phase === p ? te.text : te.textDim, fontWeight: 700, letterSpacing: '0.06em' }}>{p}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5" style={{ background: `${te.bg}88`, padding: '8px', borderRadius: '2px', border: `1px solid ${te.border}` }}>
            <div className="space-y-0.5">
              <div style={{ fontFamily: te.mono, fontSize: '8px', color: te.green, letterSpacing: '0.08em' }}>SIG</div>
              <div ref={sigDigitRef}>
                <PixelDigit chars={isActive ? fmtMs(sigMs) : BLANK} color={te.green} size={3} />
              </div>
            </div>
            <div className="space-y-0.5">
              <div style={{ fontFamily: te.mono, fontSize: '8px', color: te.red, letterSpacing: '0.08em' }}>QUEUE</div>
              <div ref={queueDigitRef}>
                <PixelDigit chars={isActive ? fmtMs(queueMs) : BLANK} color={te.red} size={3} />
              </div>
            </div>
            <div className="space-y-0.5">
              <div style={{ fontFamily: te.mono, fontSize: '8px', color: te.yellow, letterSpacing: '0.08em' }}>API</div>
              <div ref={apiDigitRef}>
                <PixelDigit chars={isActive ? fmtMs(apiMs) : BLANK} color={te.yellow} size={3} />
              </div>
            </div>
            <div className="space-y-0.5">
              <div style={{ fontFamily: te.mono, fontSize: '8px', color: te.orange, letterSpacing: '0.08em' }}>TOTAL</div>
              <div ref={totalDigitRef}>
                <PixelDigit chars={isActive ? fmtMs(totalMs) : BLANK} color={te.orange} size={3} />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <RateBar pct={bybitRateUsed} label={`BYBIT${bybitRateSource === 'HEADERS' ? '' : bybitRateSource === 'LOG' ? '*' : '**'}`} color="#f7a600" />
            <span style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, marginTop: '-2px', display: 'block' }}>
              {bybitRateSource === 'HEADERS' ? 'X-Bapi-Limit' : bybitRateSource === 'LOG' ? 'req log *est' : 'queue proxy **est'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textMuted }}>QUEUE:</span>
            <span style={{ fontFamily: te.mono, fontSize: '11px', fontWeight: 700, color: bybitQueueDepth > 5 ? te.red : bybitQueueDepth > 3 ? te.yellow : te.green }}>
              {bybitQueueDepth}
            </span>
            <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textDim }}>/8</span>
          </div>
        </div>
      </div>
    </div>
  )
}
