// ─── Bitget V2 Futures WebSocket Hook ──────────────────────────────────────
// Connects to Bitget V2 Public WS for:
//   1. Orderbook depth (books15 — 15-level) → BITGET_FLOW / OB imbalance detection
//   2. Real-time trades → BITGET_FLOW / whale trade detection
//
// Bitget V2 WS docs: https://www.bitget.com/api-doc/common/intro
// URL: wss://ws.bitget.com/v2/ws/public
//
// Protocol:
//   Subscribe: { "op": "subscribe", "args": [{ "instType": "USDT-FUTURES", "channel": "books15", "instId": "BTCUSDT" }] }
//   Heartbeat: { "op": "ping" }
//
// Signal detection (BITGET_FLOW):
//   - OB imbalance: bid/ask ratio ≥ 1.8x with ≥ $150K depth → signal
//   - Whale trade: single trade ≥ $100K → signal
//   - Cooldown: 10s per symbol

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const BITGET_WS_URL = 'wss://ws.bitget.com/v2/ws/public'

// ─── Detection thresholds ────────────────────────────────────────────────
const OB_IMBALANCE_RATIO_THRESHOLD = 1.8    // bid/ask depth ratio to trigger
const OB_IMBALANCE_MIN_USD = 150_000        // minimum depth in USD for signal
const WHALE_TRADE_MIN_USD = 100_000         // minimum trade size for whale signal
const SIGNAL_COOLDOWN_MS = 10_000           // 10s cooldown between signals per symbol

// ─── Heartbeat & Watchdog ────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 20_000        // Ping every 20s
const WATCHDOG_TIMEOUT_MS = 30_000          // 30s silence → reconnect
const MAX_TRADES_PER_SYMBOL = 50            // deque max length
const TRADE_STATE_FLUSH_MS = 500            // batch state updates every 500ms

// ─── Default symbols ─────────────────────────────────────────────────────
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']

// ─── Symbol mapping: Bitget format → standard format ─────────────────────
function toStandardPair(bitgetSymbol: string): string {
  // "BTCUSDT" → "BTC-USDT"
  // Handles known patterns: BTCUSDT → BTC-USDT, ETHUSDT → ETH-USDT
  const match = bitgetSymbol.match(/^(.+?)(USDT)$/i)
  if (match) return `${match[1]}-USDT`
  return bitgetSymbol
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface BitgetOBLevel {
  price: number
  size: number
}

export interface BitgetOBSnapshot {
  bids: BitgetOBLevel[]
  asks: BitgetOBLevel[]
  /** Total bid volume in top N levels (USD) */
  totalBidUsd: number
  /** Total ask volume in top N levels (USD) */
  totalAskUsd: number
  /** Bid/ask ratio (e.g. 2.5 = bids 2.5x asks) */
  bidAskRatio: number
  /** Which side dominates */
  dominantSide: 'BID' | 'ASK'
  /** Largest single bid level (USD) */
  bidWallUsd: number
  /** Largest single ask level (USD) */
  askWallUsd: number
  /** Price of largest bid wall */
  bidWallPrice: number
  /** Price of largest ask wall */
  askWallPrice: number
  timestamp: number
}

export interface BitgetTrade {
  price: number
  size: number
  side: 'BID' | 'ASK'  // BID = buyer aggressive (side=buy), ASK = seller aggressive (side=sell)
  usd: number
  timestamp: number
}

export interface BitgetSignal {
  id: string
  pair: string          // standard format e.g. "BTC-USDT"
  /** Bitget raw symbol e.g. "BTCUSDT" */
  bitgetSymbol: string
  category: AnomalyCategory
  tag: AnomalyTag
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'
  details: string
  timestamp: number
}

interface UseBitgetWSOptions {
  /** Bitget symbols to subscribe to (e.g. ['BTCUSDT', 'ETHUSDT']) */
  symbols?: string[]
  enabled?: boolean
  /** Callback when a BITGET_FLOW signal is detected */
  onSignal?: (signal: BitgetSignal) => void
}

interface UseBitgetWSReturn {
  /** Latest orderbook snapshot per symbol (keyed by Bitget instId e.g. "BTCUSDT") */
  orderBooks: Record<string, BitgetOBSnapshot>
  /** WS connection status */
  connected: boolean
  /** Recent trades per symbol (keyed by Bitget instId) */
  recentTrades: Record<string, BitgetTrade[]>
}

let _signalId = 0
function signalId() { return `bitget-ws-${Date.now()}-${++_signalId}` }

export function useBitgetWS({
  symbols = DEFAULT_SYMBOLS,
  enabled = true,
  onSignal,
}: UseBitgetWSOptions = {}): UseBitgetWSReturn {
  const [orderBooks, setOrderBooks] = useState<Record<string, BitgetOBSnapshot>>({})
  const [connected, setConnected] = useState(false)
  const [recentTrades, setRecentTrades] = useState<Record<string, BitgetTrade[]>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({}) // per-pair cooldowns
  const tradeAccumRef = useRef<Record<string, BitgetTrade[]>>({}) // accumulate trades
  const lastMessageTsRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtySymbolsRef = useRef<Set<string>>(new Set()) // dirty tracking for batched flush

  // Stable callback refs
  const onSignalRef = useRef(onSignal)
  useEffect(() => { onSignalRef.current = onSignal })

  // ─── Parse orderbook data ────────────────────────────────────────────
  const parseOrderbook = useCallback((instId: string, data: Record<string, unknown>) => {
    const rawBids = (data.bids || []) as string[][]
    const rawAsks = (data.asks || []) as string[][]

    const bids: BitgetOBLevel[] = rawBids
      .map((b: string[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }))
      .filter((b: BitgetOBLevel) => b.price > 0 && b.size > 0)

    const asks: BitgetOBLevel[] = rawAsks
      .map((a: string[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }))
      .filter((a: BitgetOBLevel) => a.price > 0 && a.size > 0)

    if (bids.length === 0 && asks.length === 0) return

    // Calculate depth in USD (top 15 levels or available — books15 provides 15)
    const topN = Math.min(15, bids.length, asks.length)
    const totalBidUsd = bids.slice(0, topN).reduce((s, b) => s + b.price * b.size, 0)
    const totalAskUsd = asks.slice(0, topN).reduce((s, a) => s + a.price * a.size, 0)

    const bidAskRatio = totalAskUsd > 0 ? totalBidUsd / totalAskUsd : totalBidUsd > 0 ? 99 : 1
    const dominantSide: 'BID' | 'ASK' = bidAskRatio > 1 ? 'BID' : 'ASK'

    // Find largest wall
    let bidWallUsd = 0, bidWallPrice = 0
    for (const b of bids) {
      const usd = b.price * b.size
      if (usd > bidWallUsd) { bidWallUsd = usd; bidWallPrice = b.price }
    }
    let askWallUsd = 0, askWallPrice = 0
    for (const a of asks) {
      const usd = a.price * a.size
      if (usd > askWallUsd) { askWallUsd = usd; askWallPrice = a.price }
    }

    const snapshot: BitgetOBSnapshot = {
      bids,
      asks,
      totalBidUsd,
      totalAskUsd,
      bidAskRatio,
      dominantSide,
      bidWallUsd,
      askWallUsd,
      bidWallPrice,
      askWallPrice,
      timestamp: Date.now(),
    }

    setOrderBooks(prev => ({ ...prev, [instId]: snapshot }))

    // ── Detect OB IMBALANCE ──
    const ratio = Math.max(bidAskRatio, 1 / bidAskRatio)
    const obSide: 'BID' | 'ASK' = bidAskRatio >= 1 ? 'BID' : 'ASK'
    const depthUsd = obSide === 'BID' ? totalBidUsd : totalAskUsd
    const cooldownKey = `OB-${instId}`
    const now = Date.now()

    if (ratio >= OB_IMBALANCE_RATIO_THRESHOLD && depthUsd >= OB_IMBALANCE_MIN_USD) {
      if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > SIGNAL_COOLDOWN_MS) {
        cooldownsRef.current[cooldownKey] = now
        const signal: BitgetSignal = {
          id: signalId(),
          pair: toStandardPair(instId),
          bitgetSymbol: instId,
          category: 'BITGET_FLOW',
          tag: 'BITGET-OB',
          sizeUsd: depthUsd,
          imbalance: obSide === 'BID' ? ratio * 400 : -ratio * 400,
          side: obSide,
          details: `Bitget OB ${obSide === 'BID' ? 'bid' : 'ask'} pressure ${ratio.toFixed(2)}x ($${(depthUsd / 1000).toFixed(0)}K) → ${obSide === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        }
        onSignalRef.current?.(signal)
      }
    }
  }, [])

  // ─── Parse trade data ────────────────────────────────────────────────
  const parseTrades = useCallback((instId: string, data: Array<Record<string, unknown>>) => {
    const now = Date.now()

    for (const tradeData of data) {
      const price = parseFloat(tradeData.price as string || '0')
      const size = parseFloat(tradeData.size as string || '0')
      const sideStr = (tradeData.side as string || '').toLowerCase()
      const side: 'BID' | 'ASK' = sideStr === 'buy' ? 'BID' : 'ASK'
      // Bitget ts is in milliseconds as string
      const ts = parseInt(tradeData.ts as string || String(now), 10) || now

      if (price <= 0 || size <= 0) continue

      const usd = price * size

      // Accumulate trade — use splice for deque (no new array on every push)
      const trade: BitgetTrade = { price, size, side, usd, timestamp: ts }
      const trades = tradeAccumRef.current[instId]
      if (!trades) {
        tradeAccumRef.current[instId] = [trade]
      } else {
        trades.push(trade)
        if (trades.length > MAX_TRADES_PER_SYMBOL) {
          trades.splice(0, trades.length - MAX_TRADES_PER_SYMBOL)
        }
      }
      // Mark symbol as dirty for batched flush
      dirtySymbolsRef.current.add(instId)

      // ── Detect WHALE TRADE ──
      const cooldownKey = `WHALE-${instId}`

      if (usd >= WHALE_TRADE_MIN_USD) {
        if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > SIGNAL_COOLDOWN_MS) {
          cooldownsRef.current[cooldownKey] = now
          const signal: BitgetSignal = {
            id: signalId(),
            pair: toStandardPair(instId),
            bitgetSymbol: instId,
            category: 'BITGET_FLOW',
            tag: 'BITGET-WHALE',
            sizeUsd: usd,
            imbalance: side === 'BID' ? 600 : -600,
            side,
            details: `Bitget whale ${side === 'BID' ? 'buy' : 'sell'} $${(usd / 1000).toFixed(0)}K @ ${price.toFixed(price > 100 ? 1 : 4)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
            timestamp: now,
          }
          onSignalRef.current?.(signal)
        }
      }

      // Also detect clusters: multiple medium trades in same direction within short window
      const recentWindow = 5000
      const recentSameSide = (tradeAccumRef.current[instId] || []).filter(
        t => t.side === side && t.timestamp > ts - recentWindow
      )
      const clusterUsd = recentSameSide.reduce((s, t) => s + t.usd, 0)
      const clusterCooldownKey = `WHALE-CLUSTER-${instId}`
      const clusterThreshold = WHALE_TRADE_MIN_USD * 2 // $200K cluster threshold

      if (clusterUsd >= clusterThreshold && recentSameSide.length >= 3) {
        if (!cooldownsRef.current[clusterCooldownKey] || now - cooldownsRef.current[clusterCooldownKey] > SIGNAL_COOLDOWN_MS) {
          cooldownsRef.current[clusterCooldownKey] = now
          const signal: BitgetSignal = {
            id: signalId(),
            pair: toStandardPair(instId),
            bitgetSymbol: instId,
            category: 'BITGET_FLOW',
            tag: 'BITGET-CLUSTER',
            sizeUsd: clusterUsd,
            imbalance: side === 'BID' ? 600 : -600,
            side,
            details: `Bitget whale ${side === 'BID' ? 'buy' : 'sell'} cluster $${(clusterUsd / 1000).toFixed(0)}K in ${recentSameSide.length} trades → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
            timestamp: now,
          }
          onSignalRef.current?.(signal)
        }
      }
    }
  }, [])

  // ─── WebSocket connect ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    if (!enabled || symbols.length === 0) {
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
        let ws = new WebSocket(BITGET_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // Subscribe to orderbook + trades for all symbols
          // Bitget V2: single subscribe message with all args
          const args: Array<{ instType: string; channel: string; instId: string }> = []
          for (const sym of symbols) {
            args.push({ instType: 'USDT-FUTURES', channel: 'books15', instId: sym })
            args.push({ instType: 'USDT-FUTURES', channel: 'trades', instId: sym })
          }
          ws.send(JSON.stringify({ op: 'subscribe', args }))

          // Heartbeat — send Bitget ping every 20s
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ op: 'ping' }))
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // Silent disconnect watchdog
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[BITGET WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
              try {
                ws.onclose = null // prevent double reconnect
                ws.close()
              } catch { /* ignore */ }
              setConnected(false)
              const delay = Math.min(2000 * Math.pow(2, reconnectCountRef.current), 30_000)
              reconnectCountRef.current++
              setTimeout(() => { if (mountedRef.current) connect() }, delay)
            }
          }, 7000)

          // Batched state flush — update recentTrades React state every 500ms
          flushTimerRef.current = setInterval(() => {
            if (dirtySymbolsRef.current.size === 0) return
            const dirty = new Set(dirtySymbolsRef.current)
            dirtySymbolsRef.current.clear()
            setRecentTrades(prev => {
              const next = { ...prev }
              for (const sym of dirty) {
                next[sym] = [...(tradeAccumRef.current[sym] || [])]
              }
              return next
            })
          }, TRADE_STATE_FLUSH_MS)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          lastMessageTsRef.current = Date.now()

          let raw: Record<string, unknown>
          try {
            raw = JSON.parse(event.data as string) as Record<string, unknown>
          } catch {
            // Non-JSON message — skip
            return
          }

          // Handle pong response from heartbeat
          if (raw.op === 'pong' || raw.pong) {
            return
          }

          // Handle subscription confirmations
          if (raw.event === 'subscribe') {
            return
          }

          // Handle subscription errors
          if (raw.event === 'error') {
            console.warn(`[BITGET WS] Error:`, raw.msg || raw.message || raw)
            return
          }

          // Bitget V2 WS data format:
          // { "data": {...}, "arg": { "instType": "USDT-FUTURES", "channel": "books15", "instId": "BTCUSDT" } }

          const arg = raw.arg as Record<string, string> | undefined
          if (!arg || !arg.channel || !arg.instId) return

          const channel = arg.channel
          const instId = arg.instId

          // Orderbook update
          if (channel === 'books15') {
            const data = raw.data as Record<string, unknown> | undefined
            if (data && typeof data === 'object') {
              parseOrderbook(instId, data)
            }
          }

          // Trades update
          if (channel === 'trades') {
            const data = raw.data as Array<Record<string, unknown>> | undefined
            if (data && Array.isArray(data) && data.length > 0) {
              parseTrades(instId, data)
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

          console.warn(`[BITGET WS] Disconnected (code=${event.code}). Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = () => {
          // ErrorEvent serializes as {} — log meaningful info instead.
          // onclose will fire next and handle reconnection.
          console.warn(`[BITGET WS] Connection error (readyState=${wsRef.current?.readyState}). Reconnection will be handled by onclose.`)
        }
      } catch (connectErr) {
        console.error('[BITGET WS] Connection failed:', connectErr)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symbols])

  return { orderBooks, connected, recentTrades }
}
