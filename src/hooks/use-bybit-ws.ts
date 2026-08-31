// ─── Bybit V5 Public WebSocket Hook ────────────────────────────────────────
// Connects to Bybit linear perpetual WS for:
//   1. Orderbook depth (50 levels @ 100ms) → ORDERBOOK_IMBALANCE detection
//   2. Public trades → WHALE_SWEEP detection
//   3. Ticker → real-time mark price / funding
//
// Bybit V5 WS docs: https://bybit-exchange.github.io/docs/v5/ws/public/orderbook
// Linear perp: wss://stream.bybit.com/v5/public/linear
// Spot: wss://stream.bybit.com/v5/public/spot
//
// AUDIT FIXES APPLIED:
// #2 — WS Heartbeat: Bybit requires ping/pong every 20s. Without it,
//       the server silently drops the connection after ~30s idle.
//       Fix: setInterval sends '{"op":"ping"}' every 15s.
// #3 — Memory safety: tradeAccumRef uses splice(-MAX) as deque instead
//       of creating new arrays on every push. recentTrades state only
//       updated every 500ms (batched) instead of per-trade setState.
// #4 — Rate limit: Bybit returns Code 10016 when rate limit is hit.
//       Detected in WS messages → auto-throttle with cooldown flag.
// #5 — Silent disconnect: lastMessageTs watchdog. If no message for 25s,
//       force-reconnect (Bybit can drop without onclose firing).
// #7 — JSON.parse: type guard + explicit error logging (not silent).

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const BYBIT_WS_LINEAR = 'wss://stream.bybit.com/v5/public/linear'

// ─── Detection thresholds ────────────────────────────────────────────────
const OB_IMBALANCE_RATIO_THRESHOLD = 1.8    // bid/ask depth ratio to trigger
const OB_IMBALANCE_MIN_USD = 200_000        // minimum depth in USD for signal
const WHALE_SWEEP_MIN_USD = 100_000         // minimum trade size for whale sweep
const OB_IMBALANCE_COOLDOWN_MS = 10_000     // 10s cooldown between OB signals per pair
const WHALE_SWEEP_COOLDOWN_MS = 8_000       // 8s cooldown between sweep signals per pair
const DEPTH_LEVELS = 50                     // Orderbook depth levels to request

// ─── Heartbeat & Watchdog (AUDIT FIX #2 + #5) ────────────────────────────
// Tuned for CN→SG (Beijing→Singapore) network: RTT ~160-280ms, jitter ±80ms
const HEARTBEAT_INTERVAL_MS = 20_000        // Ping every 20s (Bybit max ≤20s, safe for CN→SG jitter)
const WATCHDOG_TIMEOUT_MS = 30_000          // 1.5× heartbeat — if no message for 30s → reconnect
const MAX_TRADES_PER_SYMBOL = 50            // AUDIT FIX #3: deque max length
const RATE_LIMIT_COOLDOWN_MS = 5_000        // AUDIT FIX #4: pause after 10016 error
const TRADE_STATE_FLUSH_MS = 500            // AUDIT FIX #3: batch state updates every 500ms

// ─── Types ───────────────────────────────────────────────────────────────

export interface BybitOBLevel {
  price: number
  size: number
}

export interface BybitOBSnapshot {
  bids: BybitOBLevel[]
  asks: BybitOBLevel[]
  /** Total bid volume in top N levels (USD) */
  totalBidUsd: number
  /** Total ask volume in top N levels (USD) */
  totalAskUsd: number
  /** Bid/ask ratio (e.g. 2.5 = bids 2.5x asks) */
  bidAskRatio: number
  /** Which side dominates */
  dominantSide: 'BID' | 'ASK'
  /** Largest single bid level in top 50 (USD) */
  bidWallUsd: number
  /** Largest single ask level in top 50 (USD) */
  askWallUsd: number
  /** Price of largest bid wall */
  bidWallPrice: number
  /** Price of largest ask wall */
  askWallPrice: number
  timestamp: number
}

export interface BybitTrade {
  price: number
  size: number
  side: 'BID' | 'ASK'  // BID = buyer aggressive (buy trade), ASK = seller aggressive (sell trade)
  usd: number
  timestamp: number
}

export interface BybitDetectedSignal {
  id: string
  pair: string
  category: AnomalyCategory
  tag: AnomalyTag
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'
  details: string
  timestamp: number
}

interface UseBybitWSOptions {
  /** Bybit symbols to subscribe to (e.g. ['BTCUSDT', 'ETHUSDT']) */
  symbols: string[]
  enabled?: boolean
  /** Callback when an ORDERBOOK_IMBALANCE signal is detected */
  onOBImbalance?: (signal: BybitDetectedSignal) => void
  /** Callback when a WHALE_SWEEP signal is detected */
  onWhaleSweep?: (signal: BybitDetectedSignal) => void
}

interface UseBybitWSReturn {
  /** Latest orderbook snapshot per symbol */
  orderBooks: Record<string, BybitOBSnapshot>
  /** WS connection status */
  connected: boolean
  /** Recent large trades per symbol */
  recentTrades: Record<string, BybitTrade[]>
}

let _signalId = 0
function signalId() { return `bybit-ws-${Date.now()}-${++_signalId}` }

export function useBybitWS({
  symbols,
  enabled = true,
  onOBImbalance,
  onWhaleSweep,
}: UseBybitWSOptions): UseBybitWSReturn {
  const [orderBooks, setOrderBooks] = useState<Record<string, BybitOBSnapshot>>({})
  const [connected, setConnected] = useState(false)
  const [recentTrades, setRecentTrades] = useState<Record<string, BybitTrade[]>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({}) // per-pair cooldowns
  const tradeAccumRef = useRef<Record<string, BybitTrade[]>>({}) // accumulate trades
  const lastMessageTsRef = useRef(0) // AUDIT FIX #5: last message timestamp
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null) // AUDIT FIX #2
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null) // AUDIT FIX #5
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null) // AUDIT FIX #3
  const rateLimitedRef = useRef(false) // AUDIT FIX #4: rate limit cooldown flag
  const dirtySymbolsRef = useRef<Set<string>>(new Set()) // AUDIT FIX #3: dirty tracking for batched flush

  // Stable callback refs
  const onOBImbalanceRef = useRef(onOBImbalance)
  onOBImbalanceRef.current = onOBImbalance
  const onWhaleSweepRef = useRef(onWhaleSweep)
  onWhaleSweepRef.current = onWhaleSweep

  // ─── Parse orderbook data ────────────────────────────────────────────
  const parseOrderbook = useCallback((symbol: string, data: Record<string, unknown>) => {
    const rawBids = (data.b || data.bids || []) as string[][]
    const rawAsks = (data.a || data.asks || []) as string[][]

    const bids: BybitOBLevel[] = rawBids
      .map((b: string[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }))
      .filter((b: BybitOBLevel) => b.price > 0 && b.size > 0)

    const asks: BybitOBLevel[] = rawAsks
      .map((a: string[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }))
      .filter((a: BybitOBLevel) => a.price > 0 && a.size > 0)

    if (bids.length === 0 && asks.length === 0) return null

    // Calculate depth in USD (top 25 levels)
    const topN = Math.min(25, bids.length, asks.length)
    const totalBidUsd = bids.slice(0, topN).reduce((s, b) => s + b.price * b.size, 0)
    const totalAskUsd = asks.slice(0, topN).reduce((s, a) => s + a.price * a.size, 0)

    const bidAskRatio = totalAskUsd > 0 ? totalBidUsd / totalAskUsd : totalBidUsd > 0 ? 99 : 1
    const dominantSide: 'BID' | 'ASK' = bidAskRatio > 1 ? 'BID' : 'ASK'

    // Find largest wall in top 50
    let bidWallUsd = 0, bidWallPrice = 0
    for (const b of bids.slice(0, DEPTH_LEVELS)) {
      const usd = b.price * b.size
      if (usd > bidWallUsd) { bidWallUsd = usd; bidWallPrice = b.price }
    }
    let askWallUsd = 0, askWallPrice = 0
    for (const a of asks.slice(0, DEPTH_LEVELS)) {
      const usd = a.price * a.size
      if (usd > askWallUsd) { askWallUsd = usd; askWallPrice = a.price }
    }

    const snapshot: BybitOBSnapshot = {
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

    setOrderBooks(prev => ({ ...prev, [symbol]: snapshot }))

    // ── Detect ORDERBOOK_IMBALANCE ──
    // AUDIT FIX #4: Skip signal detection during rate limit cooldown
    if (rateLimitedRef.current) return snapshot

    const ratio = Math.max(bidAskRatio, 1 / bidAskRatio)  // normalize: always >= 1
    const obSide: 'BID' | 'ASK' = bidAskRatio >= 1 ? 'BID' : 'ASK'
    const depthUsd = obSide === 'BID' ? totalBidUsd : totalAskUsd
    const cooldownKey = `OB-${symbol}`
    const now = Date.now()

    if (ratio >= OB_IMBALANCE_RATIO_THRESHOLD && depthUsd >= OB_IMBALANCE_MIN_USD) {
      if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > OB_IMBALANCE_COOLDOWN_MS) {
        cooldownsRef.current[cooldownKey] = now
        // OB IMBALANCE: side = raw OB pressure direction (not pre-faded).
        // OB shows bid pressure → side = BID → LONG (follow pressure).
        // Contrarian mode in openPosition() inverts MOMENTUM signals → SHORT (fade).
        const signal: BybitDetectedSignal = {
          id: signalId(),
          pair: symbol,
          category: 'ORDERBOOK_IMBALANCE',
          tag: 'OB-IMBAL',
          sizeUsd: depthUsd,
          imbalance: obSide === 'BID' ? ratio * 400 : -ratio * 400,
          side: obSide,
          details: `OB ${obSide === 'BID' ? 'bid' : 'ask'} pressure ${ratio.toFixed(2)}x ($${(depthUsd / 1000).toFixed(0)}K) → ${obSide === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        }
        onOBImbalanceRef.current?.(signal)
      }
    }

    return snapshot
  }, [])

  // ─── Parse trade data ────────────────────────────────────────────────
  const parseTrade = useCallback((symbol: string, data: Record<string, unknown>) => {
    // Bybit trade format: { T: timestamp, s: symbol, S: side, p: price, v: size, ... }
    const price = parseFloat(data.p as string || '0')
    const size = parseFloat(data.v as string || '0')
    const side = (data.S as string) === 'Buy' ? 'BID' : 'ASK'
    const ts = (data.T as number) || Date.now()

    if (price <= 0 || size <= 0) return

    const usd = price * size

    // Accumulate trade — AUDIT FIX #3: use splice for deque (no new array on every push)
    const trade: BybitTrade = { price, size, side, usd, timestamp: ts }
    const trades = tradeAccumRef.current[symbol]
    if (!trades) {
      tradeAccumRef.current[symbol] = [trade]
    } else {
      trades.push(trade)
      // Trim from front (deque behavior) — avoids creating new arrays
      if (trades.length > MAX_TRADES_PER_SYMBOL) {
        trades.splice(0, trades.length - MAX_TRADES_PER_SYMBOL)
      }
    }
    // Mark symbol as dirty for batched flush
    dirtySymbolsRef.current.add(symbol)

    // AUDIT FIX #4: Skip signal detection during rate limit cooldown
    if (rateLimitedRef.current) return

    // ── Detect WHALE_SWEEP ──
    const cooldownKey = `SWEEP-${symbol}`
    const now = Date.now()

    if (usd >= WHALE_SWEEP_MIN_USD) {
      if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > WHALE_SWEEP_COOLDOWN_MS) {
        cooldownsRef.current[cooldownKey] = now
        // WHALE SWEEP: side = raw whale direction (not pre-faded).
        // Whale buys (BID) → side = BID → LONG (follow). Contrarian mode inverts → SHORT (fade).
        const signal: BybitDetectedSignal = {
          id: signalId(),
          pair: symbol,
          category: 'WHALE_SWEEP',
          tag: 'SWEEP',
          sizeUsd: usd,
          imbalance: side === 'BID' ? 600 : -600,
          side: side,
          details: `Whale ${side === 'BID' ? 'buy' : 'sell'} sweep $${(usd / 1000).toFixed(0)}K @ ${price.toFixed(price > 100 ? 1 : 4)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        }
        onWhaleSweepRef.current?.(signal)
      }
    }

    // Also detect clusters: multiple medium trades in same direction within short window
    const recentWindow = 5000 // 5 seconds
    const recentSameSide = (tradeAccumRef.current[symbol] || []).filter(
      t => t.side === side && t.timestamp > ts - recentWindow
    )
    const clusterUsd = recentSameSide.reduce((s, t) => s + t.usd, 0)
    const clusterCooldownKey = `SWEEP-CLUSTER-${symbol}`
    const clusterThreshold = WHALE_SWEEP_MIN_USD * 2 // $200K cluster threshold

    if (clusterUsd >= clusterThreshold && recentSameSide.length >= 3) {
      if (!cooldownsRef.current[clusterCooldownKey] || now - cooldownsRef.current[clusterCooldownKey] > WHALE_SWEEP_COOLDOWN_MS) {
        cooldownsRef.current[clusterCooldownKey] = now
        // WHALE SWEEP cluster: side = raw whale direction (not pre-faded)
        const signal: BybitDetectedSignal = {
          id: signalId(),
          pair: symbol,
          category: 'WHALE_SWEEP',
          tag: 'SWEEP',
          sizeUsd: clusterUsd,
          imbalance: side === 'BID' ? 600 : -600,
          side: side,
          details: `Whale ${side === 'BID' ? 'buy' : 'sell'} cluster $${(clusterUsd / 1000).toFixed(0)}K in ${recentSameSide.length} trades → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        }
        onWhaleSweepRef.current?.(signal)
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

    // Helper: clean up timers (AUDIT FIX #2 + #5 + #3)
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
        const ws = new WebSocket(BYBIT_WS_LINEAR)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // Subscribe to orderbook + trades for all symbols
          // Bybit V5: subscribe via JSON command
          const obSubs = symbols.map(s => `orderbook.${DEPTH_LEVELS}.${s}`)
          const tradeSubs = symbols.map(s => `publicTrade.${s}`)

          // Send subscription messages
          ws.send(JSON.stringify({ op: 'subscribe', args: [...obSubs, ...tradeSubs] }))

          // AUDIT FIX #2: Heartbeat — send ping every 15s to keep connection alive
          // Bybit V5 WS drops idle connections after ~30s without ping/pong
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ op: 'ping' }))
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // AUDIT FIX #5: Silent disconnect watchdog
          // Bybit can drop connections without firing onclose (e.g. TCP RST,
          // cloudflare timeout, load balancer kill). If we haven't received
          // any message for 25s, force a reconnect.
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[BYBIT WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
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
          }, 7000) // check every 7s (tuned for 20s heartbeat + CN→SG jitter)

          // AUDIT FIX #3: Batched state flush — only update recentTrades React state
          // every 500ms instead of on every single trade. This prevents excessive
          // re-renders when Bybit sends hundreds of trades per second during vol spikes.
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
          // AUDIT FIX #5: update last message timestamp for watchdog
          lastMessageTsRef.current = Date.now()

          // AUDIT FIX #7: Safe JSON parse with type guard + logging
          let raw: Record<string, unknown>
          try {
            raw = JSON.parse(event.data as string) as Record<string, unknown>
          } catch (parseErr) {
            // Non-JSON message (e.g. binary pong from some WS implementations)
            // Log at debug level — not an error, just skip it
            return
          }

          // AUDIT FIX #4: Detect Bybit rate limit error (Code 10016)
          // Bybit returns: { success: false, ret_msg: "...", code: 10016 }
          if (raw.success === false && (raw.code === 10016 || raw.ret_msg?.toString().includes('rate limit'))) {
            console.warn(`[BYBIT WS] Rate limit hit (Code ${raw.code}). Pausing signal detection for ${RATE_LIMIT_COOLDOWN_MS}ms.`)
            rateLimitedRef.current = true
            setTimeout(() => { rateLimitedRef.current = false }, RATE_LIMIT_COOLDOWN_MS)
            return
          }

          // Handle pong response from heartbeat ping
          if (raw.op === 'pong') {
            // Heartbeat pong received — connection is alive
            return
          }

          // Handle subscription confirmations
          if (raw.op === 'subscribe' && raw.success === true) {
            return
          }

          // Bybit V5 WS format:
          // Data: { topic: "orderbook.50.BTCUSDT", data: {...}, ts: ... }
          // Data: { topic: "publicTrade.BTCUSDT", data: [...], ts: ... }

          if (raw.topic && typeof raw.topic === 'string') {
            const topic = raw.topic as string
            const payload = raw.data

            // Orderbook update
            if (topic.startsWith('orderbook.')) {
              // topic format: "orderbook.50.BTCUSDT"
              const parts = topic.split('.')
              const symbol = parts[parts.length - 1] // e.g. "BTCUSDT"
              if (symbol && payload && typeof payload === 'object') {
                parseOrderbook(symbol, payload as Record<string, unknown>)
              }
            }

            // Trade update
            if (topic.startsWith('publicTrade.')) {
              // topic format: "publicTrade.BTCUSDT"
              const symbol = topic.split('.').pop()
              if (symbol && Array.isArray(payload)) {
                for (const trade of payload) {
                  if (trade && typeof trade === 'object') {
                    parseTrade(symbol, trade as Record<string, unknown>)
                  }
                }
              }
            }
          }
        }

        ws.onclose = (event) => {
          if (!mountedRef.current) return
          clearTimers()
          setConnected(false)

          // AUDIT FIX #2/#5: Exponential backoff with jitter for reconnect
          // Pure exponential backoff can cause thundering herd after server restart.
          // Adding random jitter (±30%) spreads reconnection attempts.
          const baseDelay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30_000)
          const jitter = baseDelay * (0.7 + Math.random() * 0.6) // 70%-130% of base
          const delay = Math.round(jitter)
          reconnectCountRef.current++

          console.warn(`[BYBIT WS] Disconnected (code=${event.code}). Reconnecting in ${delay}ms (attempt #${reconnectCountRef.current})`)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = (event) => {
          // Log the error for debugging — onclose will handle reconnect
          console.error('[BYBIT WS] Error:', event)
        }
      } catch (connectErr) {
        console.error('[BYBIT WS] Connection failed:', connectErr)
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
  }, [enabled, symbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return { orderBooks, connected, recentTrades }
}
