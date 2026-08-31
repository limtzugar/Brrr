// ─── dYdX v4 WebSocket Hook ────────────────────────────────────────────────
// Connects to dYdX v4 on-chain perpetuals indexer for:
//   1. v4_trades — real-time perp trades → DYDX_PERP_FLOW (whale trade detection)
//   2. v4_orderbook — L2 orderbook snapshots
//
// dYdX v4 WS docs: https://docs.dydx.exchange/#websocket
// Endpoint: wss://indexer.dydx.trade/v4/ws
//
// Subscription format: { "type": "subscribe", "channel": "v4_trades", "id": "BTC-USD" }
// Heartbeat: send {"type":"ping"} every 20s, expect {"type":"pong"} back

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const DYDX_WS_URL = 'wss://indexer.dydx.trade/v4/ws'

// ─── Detection thresholds ────────────────────────────────────────────────
const WHALE_TRADE_MIN_USD = 100_000          // ≥ $100K → whale signal
const WHALE_COOLDOWN_MS = 10_000             // 10s cooldown per pair

// ─── Heartbeat & Watchdog ────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 20_000         // Ping every 20s (dYdX spec)
const WATCHDOG_TIMEOUT_MS = 35_000           // If no message for 35s → reconnect
const MAX_TRADES_PER_PAIR = 50               // Deque max length for recent trades

// ─── Symbol mapping: dYdX pair → standardized pair ──────────────────────
const DYDX_PAIRS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const
type DydxPair = (typeof DYDX_PAIRS)[number]

const SYMBOL_MAP: Record<DydxPair, string> = {
  'BTC-USD': 'BTC-USDT',
  'ETH-USD': 'ETH-USDT',
  'SOL-USD': 'SOL-USDT',
}

// ─── Exported Types ──────────────────────────────────────────────────────

export interface DydxTrade {
  pair: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  usd: number
  timestamp: number
}

export interface DydxSignal {
  id: string
  pair: string
  category: AnomalyCategory  // 'DYDX_PERP_FLOW'
  tag: AnomalyTag            // 'DYDX'
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'
  details: string
  timestamp: number
}

export interface DydxOrderBookLevel {
  price: number
  size: number
}

export interface DydxOrderBookSnapshot {
  pair: string
  bids: DydxOrderBookLevel[]
  asks: DydxOrderBookLevel[]
  timestamp: number
}

// ─── Hook Options & Return ───────────────────────────────────────────────

interface UseDydxWSOptions {
  enabled?: boolean
  /** Callback when a DYDX_PERP_FLOW whale signal is detected */
  onSignal?: (signal: DydxSignal) => void
}

interface UseDydxWSReturn {
  /** WS connection status */
  connected: boolean
  /** Recent trades per pair (standardized pair key) */
  recentTrades: Record<string, DydxTrade[]>
  /** Latest orderbook snapshot per pair (standardized pair key) */
  orderBooks: Record<string, DydxOrderBookSnapshot>
}

// ─── Signal ID generator ─────────────────────────────────────────────────
let _signalId = 0
function signalId() { return `dydx-ws-${Date.now()}-${++_signalId}` }

// ─── dYdX WS message types (incoming) ────────────────────────────────────
interface DydxWSChannelData {
  type: 'channel_data'
  connection_id?: string
  message_id?: number
  channel: string
  id: string
  contents: {
    trades?: Array<{
      size: string
      side: 'BUY' | 'SELL'
      price: string
      createdAt: string
    }>
    bids?: Array<[string, string]>  // [price, size]
    asks?: Array<[string, string]>
    midPrice?: string
  }
}

interface DydxWSSubscribed {
  type: 'subscribed'
  channel: string
  id: string
  contents: Record<string, unknown>
}

interface DydxWSPong {
  type: 'pong'
}

interface DydxWSError {
  type: 'error'
  message?: string
  code?: number
}

type DydxWSMessage = DydxWSChannelData | DydxWSSubscribed | DydxWSPong | DydxWSError | Record<string, unknown>

// ─── Hook ────────────────────────────────────────────────────────────────

export function useDydxWS({
  enabled = true,
  onSignal,
}: UseDydxWSOptions): UseDydxWSReturn {
  const [connected, setConnected] = useState(false)
  const [recentTrades, setRecentTrades] = useState<Record<string, DydxTrade[]>>({})
  const [orderBooks, setOrderBooks] = useState<Record<string, DydxOrderBookSnapshot>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const reconnectCountRef = useRef(0)
  const cooldownsRef = useRef<Record<string, number>>({})
  const tradeAccumRef = useRef<Record<string, DydxTrade[]>>({})
  const lastMessageTsRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtyPairsRef = useRef<Set<string>>(new Set())

  // Stable callback ref (updated in effect to avoid render-time ref mutation)
  const onSignalRef = useRef(onSignal)
  useEffect(() => { onSignalRef.current = onSignal })

  // ─── Parse trade data from dYdX v4_trades channel ──────────────────
  const parseTrades = useCallback((dydxPair: string, contents: DydxWSChannelData['contents']) => {
    const pair = SYMBOL_MAP[dydxPair as DydxPair] || dydxPair
    const trades = contents.trades
    if (!trades || !Array.isArray(trades)) return

    const now = Date.now()

    for (const raw of trades) {
      const price = parseFloat(raw.price)
      const size = parseFloat(raw.size)
      const side = raw.side === 'BUY' ? 'BUY' as const : 'SELL' as const
      const ts = new Date(raw.createdAt).getTime() || now
      const usd = price * size

      if (price <= 0 || size <= 0) continue

      const trade: DydxTrade = { pair, side, price, size, usd, timestamp: ts }

      // Accumulate trade in deque
      const accum = tradeAccumRef.current[pair]
      if (!accum) {
        tradeAccumRef.current[pair] = [trade]
      } else {
        accum.push(trade)
        if (accum.length > MAX_TRADES_PER_PAIR) {
          accum.splice(0, accum.length - MAX_TRADES_PER_PAIR)
        }
      }
      dirtyPairsRef.current.add(pair)

      // ── Detect DYDX_PERP_FLOW (whale trade ≥ $100K) ──
      const cooldownKey = `DYDX-${pair}`
      if (usd >= WHALE_TRADE_MIN_USD) {
        if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > WHALE_COOLDOWN_MS) {
          cooldownsRef.current[cooldownKey] = now
          const signal: DydxSignal = {
            id: signalId(),
            pair,
            category: 'DYDX_PERP_FLOW',
            tag: 'DYDX-WHALE',
            sizeUsd: usd,
            imbalance: side === 'BUY' ? 600 : -600,
            side: side === 'BUY' ? 'BID' : 'ASK',
            details: `dYdX whale ${side === 'BUY' ? 'buy' : 'sell'} $${(usd / 1000).toFixed(0)}K @ ${price.toFixed(price > 100 ? 1 : 4)} → ${side === 'BUY' ? 'LONG' : 'SHORT'}`,
            timestamp: now,
          }
          onSignalRef.current?.(signal)
        }
      }
    }
  }, [])

  // ─── Parse orderbook data from dYdX v4_orderbook channel ──────────
  const parseOrderBook = useCallback((dydxPair: string, contents: DydxWSChannelData['contents']) => {
    const pair = SYMBOL_MAP[dydxPair as DydxPair] || dydxPair

    const rawBids = contents.bids || []
    const rawAsks = contents.asks || []

    const bids: DydxOrderBookLevel[] = (rawBids as Array<[string, string]>)
      .map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }))
      .filter(b => b.price > 0 && b.size > 0)

    const asks: DydxOrderBookLevel[] = (rawAsks as Array<[string, string]>)
      .map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }))
      .filter(a => a.price > 0 && a.size > 0)

    if (bids.length === 0 && asks.length === 0) return

    setOrderBooks(prev => ({
      ...prev,
      [pair]: { pair, bids, asks, timestamp: Date.now() },
    }))
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
        let ws = new WebSocket(DYDX_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // Subscribe to v4_trades and v4_orderbook for each tracked pair
          for (const pair of DYDX_PAIRS) {
            ws.send(JSON.stringify({ type: 'subscribe', channel: 'v4_trades', id: pair }))
            ws.send(JSON.stringify({ type: 'subscribe', channel: 'v4_orderbook', id: pair }))
          }

          // Heartbeat: send {"type":"ping"} every 20s
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'ping' }))
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // Watchdog: force reconnect if no message for 35s
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[DYDX WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
              try {
                ws.onclose = null
                ws.close()
              } catch { /* ignore */ }
              setConnected(false)
              const delay = Math.min(2000 * Math.pow(2, reconnectCountRef.current), 30_000)
              reconnectCountRef.current++
              setTimeout(() => { if (mountedRef.current) connect() }, delay)
            }
          }, 7000)

          // Batched state flush: update recentTrades React state every 500ms
          flushTimerRef.current = setInterval(() => {
            if (dirtyPairsRef.current.size === 0) return
            const dirty = new Set(dirtyPairsRef.current)
            dirtyPairsRef.current.clear()
            setRecentTrades(prev => {
              const next = { ...prev }
              for (const p of dirty) {
                next[p] = [...(tradeAccumRef.current[p] || [])]
              }
              return next
            })
          }, 500)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          lastMessageTsRef.current = Date.now()

          let raw: DydxWSMessage
          try {
            raw = JSON.parse(event.data as string) as DydxWSMessage
          } catch {
            // Non-JSON message — skip
            return
          }

          // Handle pong from heartbeat
          if (raw.type === 'pong') return

          // Handle subscription confirmation
          if (raw.type === 'subscribed') return

          // Handle error
          if (raw.type === 'error') {
            const err = raw as DydxWSError
            console.warn(`[DYDX WS] Error: code=${err.code} message=${err.message}`)
            return
          }

          // Handle channel data
          if (raw.type === 'channel_data' && raw.channel && raw.id) {
            const msg = raw as DydxWSChannelData
            const dydxPair = msg.id  // e.g. "BTC-USD"
            const contents = msg.contents

            if (!contents) return

            // v4_trades channel
            if (msg.channel === 'v4_trades') {
              parseTrades(dydxPair, contents)
            }

            // v4_orderbook channel
            if (msg.channel === 'v4_orderbook') {
              parseOrderBook(dydxPair, contents)
            }
          }
        }

        ws.onclose = (event) => {
          if (!mountedRef.current) return
          clearTimers()
          setConnected(false)

          // Exponential backoff with jitter
          const baseDelay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30_000)
          const jitter = baseDelay * (0.7 + Math.random() * 0.6)
          const delay = Math.round(jitter)
          reconnectCountRef.current++

          console.warn(`[DYDX WS] Disconnected (code=${event.code}). Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = (event) => {
          console.error('[DYDX WS] Error:', event)
        }
      } catch (connectErr) {
        console.error('[DYDX WS] Connection failed:', connectErr)
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
  }, [enabled, parseTrades, parseOrderBook])

  return { connected, recentTrades, orderBooks }
}
