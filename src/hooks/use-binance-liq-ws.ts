// ─── Binance Futures Liquidation WebSocket Hook ──────────────────────────────
// Connects to Binance Futures WS for real-time liquidation events:
//   Stream: !forceOrder@arr — ALL-symbol liquidation feed at sub-second latency
//   URL: wss://fstream.binance.com/ws/!forceOrder@arr
//   No subscription needed — single-stream connection, just connect and listen
//
// Signal detection:
//   - Accumulate per-symbol liquidations in a 10s sliding window
//   - When cumulative USD in one direction >= $200K, fire REALTIME_LIQUIDATION signal
//   - 8s cooldown per symbol per direction
//
// Binance forceOrder format:
//   { e: "forceOrder", E: epoch_ms, o: { s: "BTCUSDT", S: "SELL", o: "LIMIT",
//     f: "IOC", q: "0.014", p: "76250.10", ap: "76250.00", X: "FILLED",
//     l: "0.014", z: "0.014", T: 1234567890 } }
//
// Follows same pattern as use-bybit-ws.ts:
//   - Heartbeat ping every 20s (Binance doesn't require it, but keeps connection alive)
//   - Watchdog: force reconnect after 30s of silence
//   - Exponential backoff with jitter on reconnect
//   - Batched state updates (flush every 500ms)

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const BINANCE_LIQ_WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr'

// ─── Detection thresholds ────────────────────────────────────────────────
const CASCADE_MIN_USD = 200_000             // minimum cumulative USD in one direction to trigger signal
const CASCADE_WINDOW_MS = 10_000            // 10s sliding window for cascade detection
const CASCADE_COOLDOWN_MS = 8_000           // 8s cooldown per symbol per direction

// ─── Heartbeat & Watchdog ────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 20_000        // Ping every 20s to keep connection alive
const WATCHDOG_TIMEOUT_MS = 30_000          // 1.5× heartbeat — if no message for 30s → reconnect
const MAX_LIQ_PER_SYMBOL = 50               // Max liquidations stored per symbol (deque)
const STATE_FLUSH_MS = 500                  // Batch state updates every 500ms

// ─── Types ───────────────────────────────────────────────────────────────

export interface BinanceLiqEvent {
  symbol: string        // e.g. "BTCUSDT"
  side: 'BUY' | 'SELL' // BUY = long liquidated (bearish), SELL = short liquidated (bullish)
  price: number
  quantity: number
  usd: number
  timestamp: number
}

export interface BinanceLiqSignal {
  id: string
  pair: string                    // our format: "BTC-USDT"
  category: AnomalyCategory       // 'REALTIME_LIQUIDATION'
  tag: AnomalyTag                 // 'RT-LIQ'
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'            // BID = shorts getting rekt (bullish), ASK = longs getting rekt (bearish)
  details: string
  timestamp: number
}

interface UseBinanceLiqWSOptions {
  enabled?: boolean
  onCascade?: (signal: BinanceLiqSignal) => void
}

interface UseBinanceLiqWSReturn {
  connected: boolean
  recentLiquidations: Record<string, BinanceLiqEvent[]>
}

// ─── Signal ID generator ─────────────────────────────────────────────────
let _signalId = 0
function signalId() { return `binance-liq-${Date.now()}-${++_signalId}` }

// ─── Helper: convert Binance symbol to our pair format ───────────────────
// "BTCUSDT" → "BTC-USDT"
function symbolToPair(symbol: string): string {
  // Common quote currencies — try longest match first
  const quotes = ['BUSD', 'USDT', 'USDC', 'TUSD', 'BTC', 'ETH', 'BNB']
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      const base = symbol.slice(0, symbol.length - q.length)
      return `${base}-${q}`
    }
  }
  // Fallback: insert dash before last 4 chars if no match
  return symbol
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useBinanceLiqWS({
  enabled = true,
  onCascade,
}: UseBinanceLiqWSOptions): UseBinanceLiqWSReturn {
  const [connected, setConnected] = useState(false)
  const [recentLiquidations, setRecentLiquidations] = useState<Record<string, BinanceLiqEvent[]>>({})

  // Refs
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({}) // per symbol+direction cooldowns
  const liqAccumRef = useRef<Record<string, BinanceLiqEvent[]>>({}) // accumulate liquidations
  const lastMessageTsRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtySymbolsRef = useRef<Set<string>>(new Set())

  // Stable callback ref — update in effect to avoid render-time ref mutation
  const onCascadeRef = useRef(onCascade)
  useEffect(() => { onCascadeRef.current = onCascade })

  // ─── Parse forceOrder message ───────────────────────────────────────
  const parseForceOrder = useCallback((raw: Record<string, unknown>) => {
    // Validate event type
    if (raw.e !== 'forceOrder') return

    const orderData = raw.o as Record<string, unknown> | undefined
    if (!orderData || typeof orderData !== 'object') return

    const symbol = orderData.s as string
    const side = orderData.S as string // "BUY" or "SELL"
    const priceStr = orderData.p as string   // original order price
    const apStr = orderData.ap as string     // average price (filled)
    const qtyStr = orderData.q as string     // original order quantity
    const status = orderData.X as string     // order status

    // Only process filled liquidation orders
    if (!symbol || !side || status !== 'FILLED') return
    if (side !== 'BUY' && side !== 'SELL') return

    // Use average price if available, otherwise order price
    const price = parseFloat(apStr || priceStr || '0')
    const quantity = parseFloat(qtyStr || '0')
    const timestamp = (raw.E as number) || (orderData.T as number) || Date.now()

    if (price <= 0 || quantity <= 0) return

    const usd = price * quantity

    const liqEvent: BinanceLiqEvent = {
      symbol,
      side: side as 'BUY' | 'SELL',
      price,
      quantity,
      usd,
      timestamp,
    }

    // Accumulate — use splice for deque (no new array on every push)
    const events = liqAccumRef.current[symbol]
    if (!events) {
      liqAccumRef.current[symbol] = [liqEvent]
    } else {
      events.push(liqEvent)
      // Trim from front (deque behavior)
      if (events.length > MAX_LIQ_PER_SYMBOL) {
        events.splice(0, events.length - MAX_LIQ_PER_SYMBOL)
      }
    }
    // Mark symbol as dirty for batched flush
    dirtySymbolsRef.current.add(symbol)

    // ── Detect REALTIME_LIQUIDATION cascade ──
    // Accumulate per-symbol liquidations in a 10s sliding window
    // When cumulative USD in one direction >= $200K, fire signal
    const now = Date.now()
    const windowStart = now - CASCADE_WINDOW_MS
    const symbolEvents = liqAccumRef.current[symbol] || []

    // Separate BUY and SELL liquidations within the window
    let buyUsd = 0
    let sellUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const evt of symbolEvents) {
      if (evt.timestamp >= windowStart) {
        if (evt.side === 'BUY') {
          buyUsd += evt.usd
          buyCount++
        } else {
          sellUsd += evt.usd
          sellCount++
        }
      }
    }

    // Check BUY direction (longs getting rekt → ASK side → bearish)
    const buyCooldownKey = `LIQ-${symbol}-BUY`
    if (buyUsd >= CASCADE_MIN_USD) {
      if (!cooldownsRef.current[buyCooldownKey] || now - cooldownsRef.current[buyCooldownKey] > CASCADE_COOLDOWN_MS) {
        cooldownsRef.current[buyCooldownKey] = now
        const pair = symbolToPair(symbol)
        const ratio = sellUsd > 0 ? buyUsd / sellUsd : buyUsd / CASCADE_MIN_USD
        const signal: BinanceLiqSignal = {
          id: signalId(),
          pair,
          category: 'REALTIME_LIQUIDATION',
          tag: 'RT-LIQ',
          sizeUsd: buyUsd,
          imbalance: -ratio * 400, // negative = bearish (longs rekt → selling pressure)
          side: 'ASK',             // BUY liquidations = longs getting rekt = ASK side = bearish
          details: `Long liquidation cascade $${(buyUsd / 1000).toFixed(0)}K in ${buyCount} events on ${symbol} → bearish`,
          timestamp: now,
        }
        onCascadeRef.current?.(signal)
      }
    }

    // Check SELL direction (shorts getting rekt → BID side → bullish)
    const sellCooldownKey = `LIQ-${symbol}-SELL`
    if (sellUsd >= CASCADE_MIN_USD) {
      if (!cooldownsRef.current[sellCooldownKey] || now - cooldownsRef.current[sellCooldownKey] > CASCADE_COOLDOWN_MS) {
        cooldownsRef.current[sellCooldownKey] = now
        const pair = symbolToPair(symbol)
        const ratio = buyUsd > 0 ? sellUsd / buyUsd : sellUsd / CASCADE_MIN_USD
        const signal: BinanceLiqSignal = {
          id: signalId(),
          pair,
          category: 'REALTIME_LIQUIDATION',
          tag: 'RT-LIQ',
          sizeUsd: sellUsd,
          imbalance: ratio * 400, // positive = bullish (shorts rekt → buying pressure)
          side: 'BID',            // SELL liquidations = shorts getting rekt = BID side = bullish
          details: `Short liquidation cascade $${(sellUsd / 1000).toFixed(0)}K in ${sellCount} events on ${symbol} → bullish`,
          timestamp: now,
        }
        onCascadeRef.current?.(signal)
      }
    }
  }, [])

  // ─── WebSocket connect ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    if (!enabled) {
      setConnected(false)
      return
    }

    // Helper: clean up timers
    const clearTimers = () => {
      if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null }
      if (watchdogTimerRef.current) { clearInterval(watchdogTimerRef.current); watchdogTimerRef.current = null }
      if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null }
    }

    const connect = () => {
      if (!mountedRef.current) return

      // Clean up existing connection
      clearTimers()
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close()
        }
        wsRef.current = null
      }

      try {
        let ws = new WebSocket(BINANCE_LIQ_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // No subscription needed — !forceOrder@arr is a single-stream connection
          // Just connect and listen

          // Heartbeat: send ping frame every 20s to keep connection alive
          // Binance doesn't require JSON pings like Bybit, but regular traffic
          // ensures the TCP connection stays active through proxies/firewalls
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                // Binance WS supports plain text "ping" as heartbeat
                ws.send('ping')
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // Silent disconnect watchdog
          // Binance can drop connections without firing onclose (e.g. TCP RST,
          // cloudflare timeout, load balancer kill). If we haven't received
          // any message for 30s, force a reconnect.
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[BINANCE LIQ WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
              // Force close — onclose handler will trigger reconnect with backoff
              try {
                ws.onclose = null // prevent double reconnect
                ws.close()
              } catch { /* ignore */ }
              setConnected(false)
              const delay = Math.min(2000 * Math.pow(2, reconnectCountRef.current), 30_000)
              reconnectCountRef.current++
              setTimeout(() => { if (mountedRef.current) connect() }, delay)
            }
          }, 7000) // check every 7s

          // Batched state flush — only update recentLiquidations React state
          // every 500ms instead of on every single liquidation event.
          // This prevents excessive re-renders during high-volume liquidation cascades.
          flushTimerRef.current = setInterval(() => {
            if (dirtySymbolsRef.current.size === 0) return
            const dirty = new Set(dirtySymbolsRef.current)
            dirtySymbolsRef.current.clear()
            setRecentLiquidations(prev => {
              const next = { ...prev }
              for (const sym of dirty) {
                next[sym] = [...(liqAccumRef.current[sym] || [])]
              }
              return next
            })
          }, STATE_FLUSH_MS)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          // Update last message timestamp for watchdog
          lastMessageTsRef.current = Date.now()

          // Handle pong response (Binance responds with "pong" to "ping")
          const data = event.data
          if (typeof data === 'string' && data === 'pong') {
            // Heartbeat pong received — connection is alive
            return
          }

          // Safe JSON parse with error handling
          let raw: Record<string, unknown>
          try {
            raw = JSON.parse(data as string) as Record<string, unknown>
          } catch (parseErr) {
            // Non-JSON message — skip
            return
          }

          // Process forceOrder event
          if (raw.e === 'forceOrder') {
            parseForceOrder(raw)
          }
        }

        ws.onclose = (event) => {
          if (!mountedRef.current) return
          clearTimers()
          setConnected(false)

          // Exponential backoff with jitter for reconnect
          // Pure exponential backoff can cause thundering herd after server restart.
          // Adding random jitter (±30%) spreads reconnection attempts.
          const baseDelay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30_000)
          const jitter = baseDelay * (0.7 + Math.random() * 0.6) // 70%-130% of base
          const delay = Math.round(jitter)
          reconnectCountRef.current++

          console.warn(`[BINANCE LIQ WS] Disconnected (code=${event.code}). Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = () => {
          // ErrorEvent serializes as {} — log meaningful state instead
          console.warn(`[BINANCE LIQ WS] Connection error (readyState=${ws.readyState}). Reconnection will be handled by onclose.`)
        }
      } catch (connectErr) {
        console.error('[BINANCE LIQ WS] Connection failed:', connectErr)
        setConnected(false)
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      clearTimers()
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close()
        }
        wsRef.current = null
      }
    }
  }, [enabled, parseForceOrder])

  return { connected, recentLiquidations }
}
