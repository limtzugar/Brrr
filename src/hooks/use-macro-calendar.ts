// ─── Finnhub Macro Economic Calendar Hook ──────────────────────────────────
// REST-based polling hook for upcoming macro events (CPI, FOMC, NFP, GDP, PMI).
// Detects HIGH impact events within 5 minutes or just occurred (actual posted)
// and fires MACRO_EVENT signals for all enabled pairs.
//
// Finnhub API: https://finnhub.io/api/v1/calendar/economic?token=FREE_API_KEY
// Free tier: limited requests, no KYC needed.
// Poll every 60s.

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

// ─── API config ──────────────────────────────────────────────────────────
const FINNHUB_BASE = 'https://finnhub.io/api/v1/calendar/economic'
const POLL_INTERVAL_MS = 60_000             // Poll every 60s
const UPCOMING_WINDOW_MS = 5 * 60 * 1000    // 5 minutes before event
const JUST_OCCURRED_WINDOW_MS = 2 * 60 * 1000 // 2 minutes after event time
const COOLDOWN_MS = 15 * 60 * 1000          // 15 min cooldown after each event

// ─── API key: env var or fallback to 'demo' ─────────────────────────────
function getApiKey(): string {
  if (typeof window !== 'undefined') {
    // Client-side: use NEXT_PUBLIC_ env var
    const envKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY
    if (envKey && envKey.trim() !== '') return envKey.trim()
  }
  return 'demo'
}

// ─── Exported Types ──────────────────────────────────────────────────────

export interface MacroEvent {
  country: string
  event: string
  time: string
  estimate: string
  actual: string
  impact: 'low' | 'medium' | 'high'
}

export interface MacroSignal {
  id: string
  pair: string
  category: AnomalyCategory  // 'MACRO_EVENT'
  tag: AnomalyTag            // 'MACRO'
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'  // BID for positive surprises, ASK for negative
  details: string
  timestamp: number
}

// ─── Hook Options & Return ───────────────────────────────────────────────

interface UseMacroCalendarOptions {
  enabled?: boolean
  /** Pairs to generate signals for (e.g. ['BTC-USDT', 'ETH-USDT']) */
  enabledPairs: string[]
  /** Callback when a MACRO_EVENT signal is detected */
  onSignal?: (signal: MacroSignal) => void
}

interface UseMacroCalendarReturn {
  /** true if API responds successfully */
  connected: boolean
  /** Upcoming events from Finnhub (sorted by time) */
  upcomingEvents: MacroEvent[]
  /** Next HIGH impact event that hasn't occurred yet */
  nextHighImpactEvent: MacroEvent | null
}

// ─── Signal ID generator ─────────────────────────────────────────────────
let _signalId = 0
function signalId() { return `macro-${Date.now()}-${++_signalId}` }

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Parse a Finnhub event time string to a timestamp (ms) */
function parseEventTime(timeStr: string): number {
  if (!timeStr) return 0
  // Finnhub format: "2024-01-10T13:30:00" (no timezone — treat as UTC)
  const d = new Date(timeStr + 'Z')
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/** Determine if actual value is a positive surprise relative to estimate */
function isPositiveSurprise(estimate: string, actual: string): boolean | null {
  const estNum = parseFloat(estimate)
  const actNum = parseFloat(actual)
  if (isNaN(estNum) || isNaN(actNum)) return null
  return actNum > estNum
}

/** Convert Finnhub raw event to MacroEvent */
function toMacroEvent(raw: Record<string, unknown>): MacroEvent {
  return {
    country: (raw.country as string) || '',
    event: (raw.event as string) || '',
    time: (raw.time as string) || '',
    estimate: (raw.estimate as string) || '',
    actual: (raw.actual as string) || '',
    impact: (['low', 'medium', 'high'].includes(raw.impact as string)
      ? raw.impact as 'low' | 'medium' | 'high'
      : 'low'),
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useMacroCalendar({
  enabled = true,
  enabledPairs,
  onSignal,
}: UseMacroCalendarOptions): UseMacroCalendarReturn {
  const [connected, setConnected] = useState(false)
  const [upcomingEvents, setUpcomingEvents] = useState<MacroEvent[]>([])
  const [nextHighImpactEvent, setNextHighImpactEvent] = useState<MacroEvent | null>(null)

  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({})  // event key → cooldown timestamp
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Stable callback ref (updated in effect to avoid render-time ref mutation)
  const onSignalRef = useRef(onSignal)
  useEffect(() => { onSignalRef.current = onSignal })

  // ─── Process events & detect signals ────────────────────────────────
  const processEvents = useCallback((events: MacroEvent[]) => {
    if (!mountedRef.current) return
    const now = Date.now()

    // Sort by time
    const sorted = [...events].sort((a, b) => parseEventTime(a.time) - parseEventTime(b.time))
    setUpcomingEvents(sorted)

    // Find next high-impact event (not yet occurred)
    const nextHigh = sorted.find(e => {
      if (e.impact !== 'high') return false
      const t = parseEventTime(e.time)
      return t > now
    }) || null
    setNextHighImpactEvent(nextHigh)

    // ── Detect MACRO_EVENT signals ──
    for (const ev of sorted) {
      // Only HIGH impact events generate signals
      if (ev.impact !== 'high') continue
      // Only US macro events (primary market movers for crypto)
      if (ev.country !== 'US') continue

      const eventTime = parseEventTime(ev.time)
      if (eventTime === 0) continue

      const eventKey = `${ev.event}-${ev.time}`
      const cooldown = cooldownsRef.current[eventKey]

      // Skip if in cooldown
      if (cooldown && now - cooldown < COOLDOWN_MS) continue

      // Condition 1: Event is within 5 minutes from now (upcoming)
      const timeUntilEvent = eventTime - now
      const isUpcoming = timeUntilEvent > 0 && timeUntilEvent <= UPCOMING_WINDOW_MS

      // Condition 2: Event just occurred and actual was just posted
      const timeSinceEvent = now - eventTime
      const justOccurred = timeSinceEvent >= 0 && timeSinceEvent <= JUST_OCCURRED_WINDOW_MS && ev.actual !== ''

      if (!isUpcoming && !justOccurred) continue

      // Determine side: positive surprise → BID, negative → ASK, neutral/unknown → BID (default)
      let side: 'BID' | 'ASK' = 'BID'
      if (justOccurred && ev.actual !== '' && ev.estimate !== '') {
        const surprise = isPositiveSurprise(ev.estimate, ev.actual)
        if (surprise === false) side = 'ASK'
      }

      // Fire signal for all enabled pairs
      cooldownsRef.current[eventKey] = now
      for (const pair of enabledPairs) {
        const signal: MacroSignal = {
          id: signalId(),
          pair,
          category: 'MACRO_EVENT',
          tag: 'MACRO',
          sizeUsd: 0,  // Macro events don't have a direct USD size
          imbalance: side === 'BID' ? 400 : -400,
          side,
          details: isUpcoming
            ? `Macro upcoming: ${ev.event} in ${Math.ceil(timeUntilEvent / 60000)}m (est: ${ev.estimate || 'N/A'}) → ${side === 'BID' ? 'RISK-ON' : 'RISK-OFF'}`
            : `Macro just released: ${ev.event} actual=${ev.actual || 'N/A'} vs est=${ev.estimate || 'N/A'} → ${side === 'BID' ? 'RISK-ON' : 'RISK-OFF'}`,
          timestamp: now,
        }
        onSignalRef.current?.(signal)
      }
    }
  }, [enabledPairs])

  // ─── Fetch economic calendar from Finnhub ───────────────────────────
  const fetchCalendar = useCallback(async () => {
    if (!enabled || !mountedRef.current) return

    try {
      const apiKey = getApiKey()
      const url = `${FINNHUB_BASE}?token=${apiKey}`
      const res = await fetch(url)

      if (!res.ok || !mountedRef.current) {
        setConnected(false)
        return
      }

      const data = await res.json()
      const rawEvents = data.economicCalendar as Array<Record<string, unknown>> | undefined

      if (!rawEvents || !Array.isArray(rawEvents)) {
        setConnected(true) // API responded, just no events
        setUpcomingEvents([])
        setNextHighImpactEvent(null)
        return
      }

      setConnected(true)
      const events = rawEvents.map(toMacroEvent)
      processEvents(events)
    } catch {
      // Network error or parse failure
      if (mountedRef.current) setConnected(false)
    }
  }, [enabled, processEvents])

  // ─── Polling lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    if (!enabled) {
      setConnected(false)
      setUpcomingEvents([])
      setNextHighImpactEvent(null)
      return
    }

    // Initial fetch
    fetchCalendar()

    // Poll every 60s
    pollTimerRef.current = setInterval(fetchCalendar, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [enabled, fetchCalendar])

  return { connected, upcomingEvents, nextHighImpactEvent }
}
