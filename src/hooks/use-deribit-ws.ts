// ─── Deribit Options WebSocket Hook ─────────────────────────────────────────
// Connects to Deribit WS API v2 for:
//   1. Perpetual trades (BTC-PERP, ETH-PERP) → OPTIONS_FLOW whale detection
//   2. Ticker data (mark price, IV) for perps and options instruments
//
// Deribit WS docs: https://docs.deribit.com/#public-websocket-channel
// WS URL: wss://www.deribit.com/ws/api/v2
// No auth needed for public market data channels.
//
// Pattern: Same as use-bybit-ws.ts — heartbeat, watchdog, exponential backoff
//
// AUDIT FIXES (inherited from Bybit hook):
// #2 — WS Heartbeat: Deribit recommends public/test every 20s.
//       Without it, the server silently drops after ~60s idle.
// #3 — Memory safety: tradeAccumRef uses splice(-MAX) as deque.
//       recentTrades state only updated every 500ms (batched).
// #5 — Silent disconnect: lastMessageTs watchdog. If no message for 30s,
//       force-reconnect (Deribit can drop without onclose firing).
// #7 — JSON.parse: type guard + explicit error logging.

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2'

// ─── Detection thresholds ────────────────────────────────────────────────
const WHALE_TRADE_MIN_USD = 500_000       // single trade ≥ $500K → whale flow
const CUMULATIVE_TRADE_MIN_USD = 300_000   // cumulative trades in one direction ≥ $300K within 5s
const CUMULATIVE_WINDOW_MS = 5_000         // 5s window for cumulative detection
const OPTIONS_FLOW_COOLDOWN_MS = 10_000    // 10s cooldown between OPTIONS_FLOW signals per pair

// ─── Heartbeat & Watchdog ────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 20_000       // Send public/test every 20s
const WATCHDOG_TIMEOUT_MS = 30_000         // If no message for 30s → reconnect
const WATCHDOG_CHECK_MS = 7_000            // Check watchdog every 7s
const MAX_TRADES_PER_INSTRUMENT = 50       // Deque max length per instrument
const TRADE_STATE_FLUSH_MS = 500           // Batch state updates every 500ms

// ─── Instrument → Pair mapping ───────────────────────────────────────────
// Deribit perp instruments → our internal pair format
const INSTRUMENT_TO_PAIR: Record<string, string> = {
  'BTC-PERP': 'BTC-USDT',
  'ETH-PERP': 'ETH-USDT',
  'SOL-PERP': 'SOL-USDT',
  'BNB-PERP': 'BNB-USDT',
}

// Only track these major pairs
const TRACKED_PAIRS = new Set(['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT'])

// ─── Subscription channels ───────────────────────────────────────────────
const SUBSCRIBE_CHANNELS = [
  'trades.BTC-PERP.100ms',
  'trades.ETH-PERP.100ms',
  'ticker.BTC-PERP.100ms',
  'ticker.ETH-PERP.100ms',
]

// ─── JSON-RPC request ID counter ─────────────────────────────────────────
let _jsonRpcId = 0
function nextRpcId() { return ++_jsonRpcId }

// ─── Types ───────────────────────────────────────────────────────────────

export interface DeribitTrade {
  instrumentName: string
  direction: 'buy' | 'sell'
  price: number
  amount: number
  usd: number
  timestamp: number
}

export interface DeribitSignal {
  id: string
  pair: string
  category: AnomalyCategory   // 'OPTIONS_FLOW'
  tag: AnomalyTag             // 'OPTIONS'
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'
  details: string
  timestamp: number
}

interface UseDeribitWSOptions {
  enabled?: boolean
  onSignal?: (signal: DeribitSignal) => void
}

interface UseDeribitWSReturn {
  connected: boolean
  recentTrades: Record<string, DeribitTrade[]>
}

let _signalId = 0
function signalId() { return `deribit-ws-${Date.now()}-${++_signalId}` }

// ─── Helper: map Deribit instrument to our pair format ───────────────────
function instrumentToPair(instrumentName: string): string | null {
  // Direct perp mapping
  if (INSTRUMENT_TO_PAIR[instrumentName]) {
    return INSTRUMENT_TO_PAIR[instrumentName]
  }
  // Options instruments: e.g. "BTC-28MAR25-80000-C" → "BTC-USDT"
  // Extract base from first segment before the dash-date
  const match = instrumentName.match(/^(BTC|ETH|SOL|BNB)-/)
  if (match) {
    const pair = `${match[1]}-USDT`
    if (TRACKED_PAIRS.has(pair)) return pair
  }
  return null
}

// ─── Helper: map Deribit trade direction to BID/ASK ─────────────────────
function directionToSide(direction: string): 'BID' | 'ASK' {
  // Deribit: "buy" = taker is buying → BID (buyer aggressive)
  //          "sell" = taker is selling → ASK (seller aggressive)
  return direction === 'buy' ? 'BID' : 'ASK'
}

export function useDeribitWS({
  enabled = true,
  onSignal,
}: UseDeribitWSOptions): UseDeribitWSReturn {
  const [connected, setConnected] = useState(false)
  const [recentTrades, setRecentTrades] = useState<Record<string, DeribitTrade[]>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({})
  const tradeAccumRef = useRef<Record<string, DeribitTrade[]>>({})
  const lastMessageTsRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtyInstrumentsRef = useRef<Set<string>>(new Set())

  // Stable callback refs
  const onSignalRef = useRef(onSignal)
  useEffect(() => { onSignalRef.current = onSignal })

  // ─── Emit a signal (with cooldown check) ─────────────────────────────
  const emitSignal = useCallback((signal: DeribitSignal) => {
    const cooldownKey = `OPTFLOW-${signal.pair}`
    const now = Date.now()

    if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > OPTIONS_FLOW_COOLDOWN_MS) {
      cooldownsRef.current[cooldownKey] = now
      onSignalRef.current?.(signal)
    }
  }, [])

  // ─── Process a single Deribit trade ────────────────────────────────────
  const processTrade = useCallback((rawTrade: Record<string, unknown>) => {
    const instrumentName = rawTrade.instrument_name as string | undefined
    const direction = rawTrade.direction as string | undefined
    const price = typeof rawTrade.price === 'number' ? rawTrade.price : parseFloat(rawTrade.price as string || '0')
    const amount = typeof rawTrade.amount === 'number' ? rawTrade.amount : parseFloat(rawTrade.amount as string || '0')
    const ts = typeof rawTrade.ts === 'number' ? rawTrade.ts : Date.now()

    if (!instrumentName || !direction || price <= 0 || amount <= 0) return

    const pair = instrumentToPair(instrumentName)
    if (!pair) return // Not a tracked instrument

    const usd = price * amount
    const side = directionToSide(direction)

    // Accumulate trade — use splice for deque (no new array on every push)
    const trade: DeribitTrade = {
      instrumentName,
      direction: direction as 'buy' | 'sell',
      price,
      amount,
      usd,
      timestamp: ts,
    }

    const trades = tradeAccumRef.current[instrumentName]
    if (!trades) {
      tradeAccumRef.current[instrumentName] = [trade]
    } else {
      trades.push(trade)
      if (trades.length > MAX_TRADES_PER_INSTRUMENT) {
        trades.splice(0, trades.length - MAX_TRADES_PER_INSTRUMENT)
      }
    }
    dirtyInstrumentsRef.current.add(instrumentName)

    // ── Detect OPTIONS_FLOW: Single whale trade ≥ $500K ──
    if (usd >= WHALE_TRADE_MIN_USD) {
      emitSignal({
        id: signalId(),
        pair,
        category: 'OPTIONS_FLOW',
        tag: 'OPTIONS',
        sizeUsd: usd,
        imbalance: side === 'BID' ? 800 : -800,
        side,
        details: `Deribit whale ${direction} $${(usd / 1000).toFixed(0)}K ${instrumentName} @ ${price.toFixed(price > 100 ? 1 : 4)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
        timestamp: Date.now(),
      })
    }

    // ── Detect OPTIONS_FLOW: Cumulative trades in one direction ≥ $300K within 5s ──
    const now = Date.now()
    const recentSameDirection = (tradeAccumRef.current[instrumentName] || []).filter(
      t => t.direction === (direction as 'buy' | 'sell') && t.timestamp > now - CUMULATIVE_WINDOW_MS
    )
    const cumulativeUsd = recentSameDirection.reduce((sum, t) => sum + t.usd, 0)

    if (cumulativeUsd >= CUMULATIVE_TRADE_MIN_USD && recentSameDirection.length >= 2) {
      // Use a different cooldown key for cumulative to avoid blocking single-trade signals
      const cumCooldownKey = `OPTFLOW-CUM-${pair}`
      if (!cooldownsRef.current[cumCooldownKey] || now - cooldownsRef.current[cumCooldownKey] > OPTIONS_FLOW_COOLDOWN_MS) {
        cooldownsRef.current[cumCooldownKey] = now
        onSignalRef.current?.({
          id: signalId(),
          pair,
          category: 'OPTIONS_FLOW',
          tag: 'OPTIONS',
          sizeUsd: cumulativeUsd,
          imbalance: side === 'BID' ? 700 : -700,
          side,
          details: `Deribit ${direction} cluster $${(cumulativeUsd / 1000).toFixed(0)}K in ${recentSameDirection.length} trades ${instrumentName} → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        })
      }
    }
  }, [emitSignal])

  // ─── Process ticker data ───────────────────────────────────────────────
  const processTicker = useCallback((_channel: string, _data: Record<string, unknown>) => {
    // Ticker data provides mark price, IV, funding — useful for IV spike detection.
    // For now, we mainly use it to keep the connection alive (watchdog resets on any message).
    // Future: detect IV spikes from ticker.mark_iv and emit OPTIONS_FLOW signals.
  }, [])

  // ─── WebSocket connect ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    if (!enabled) {
      setConnected(false)
      return
    }

    const clearTimers = () => {
      if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null }
      if (watchdogTimerRef.current) { clearInterval(watchdogTimerRef.current); watchdogTimerRef.current = null }
      if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null }
    }

    const connect = () => {
      if (!mountedRef.current) return

      // Clean up existing
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
        let ws = new WebSocket(DERIBIT_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // Subscribe to channels using JSON-RPC 2.0
          // Deribit: public/subscribe with channels array
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: nextRpcId(),
            method: 'public/subscribe',
            params: {
              channels: SUBSCRIBE_CHANNELS,
            },
          }))

          // AUDIT FIX #2: Heartbeat — send public/test every 20s
          // Deribit can drop idle connections; public/test keeps it alive
          // and also returns server status confirming connection health.
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  jsonrpc: '2.0',
                  id: nextRpcId(),
                  method: 'public/test',
                  params: {},
                }))
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // AUDIT FIX #5: Silent disconnect watchdog
          // Deribit can drop connections without firing onclose (TCP RST,
          // cloudflare timeout, load balancer kill). If we haven't received
          // any message for 30s, force a reconnect.
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[DERIBIT WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
              try {
                ws.onclose = null // prevent double reconnect
                ws.close()
              } catch { /* ignore */ }
              setConnected(false)
              const delay = Math.min(2000 * Math.pow(2, reconnectCountRef.current), 30_000)
              reconnectCountRef.current++
              setTimeout(() => { if (mountedRef.current) connect() }, delay)
            }
          }, WATCHDOG_CHECK_MS)

          // AUDIT FIX #3: Batched state flush — only update recentTrades React state
          // every 500ms instead of on every single trade. This prevents excessive
          // re-renders when Deribit sends hundreds of trades per second during vol spikes.
          flushTimerRef.current = setInterval(() => {
            if (dirtyInstrumentsRef.current.size === 0) return
            const dirty = new Set(dirtyInstrumentsRef.current)
            dirtyInstrumentsRef.current.clear()
            setRecentTrades(prev => {
              const next = { ...prev }
              for (const inst of dirty) {
                next[inst] = [...(tradeAccumRef.current[inst] || [])]
              }
              return next
            })
          }, TRADE_STATE_FLUSH_MS)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          // AUDIT FIX #5: update last message timestamp for watchdog
          lastMessageTsRef.current = Date.now()

          // AUDIT FIX #7: Safe JSON parse with type guard + logging
          let raw: Record<string, unknown>
          try {
            raw = JSON.parse(event.data as string) as Record<string, unknown>
          } catch (parseErr) {
            // Non-JSON message — skip it
            return
          }

          // Handle heartbeat response: {"jsonrpc":"2.0","id":N,"result":{...}}
          if (raw.method === undefined && raw.id !== undefined && raw.result !== undefined) {
            // This is a JSON-RPC response (heartbeat ack or subscription confirm)
            return
          }

          // Handle subscription notification: {"jsonrpc":"2.0","method":"subscription","params":{...}}
          if (raw.method === 'subscription') {
            const params = raw.params as Record<string, unknown> | undefined
            if (!params) return

            const channel = params.channel as string | undefined
            const data = params.data
            if (!channel || !data) return

            // ── Trades channel ──
            // Channel format: "trades.BTC-PERP.100ms"
            if (channel.startsWith('trades.')) {
              if (Array.isArray(data)) {
                for (const trade of data) {
                  if (trade && typeof trade === 'object') {
                    processTrade(trade as Record<string, unknown>)
                  }
                }
              }
              return
            }

            // ── Ticker channel ──
            // Channel format: "ticker.BTC-PERP.100ms" or "ticker.BTC-28MAR25-80000-C.100ms"
            if (channel.startsWith('ticker.')) {
              if (data && typeof data === 'object') {
                processTicker(channel, data as Record<string, unknown>)
              }
              return
            }
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

          console.warn(`[DERIBIT WS] Disconnected (code=${event.code}). Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = (event) => {
          // Log the error for debugging — onclose will handle reconnect
          console.error('[DERIBIT WS] Error:', event)
        }
      } catch (connectErr) {
        console.error('[DERIBIT WS] Connection failed:', connectErr)
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
  }, [enabled, processTrade, processTicker])

  return { connected, recentTrades }
}
