// ─── Gate.io V4 Futures WebSocket Hook ──────────────────────────────────────
// Connects to Gate.io Futures WS for:
//   1. Orderbook depth (futures.order_book) → GATE_FLOW / OB imbalance detection
//   2. Real-time trades (futures.trades) → GATE_FLOW / whale trade detection
//
// Gate.io V4 WS docs: https://www.gate.io/docs/developers/apiv4/en/#futures-websocket
// URL: wss://fx-ws.gateio.ws/v4/ws/usdt
//
// Protocol:
//   Subscribe: { "time": ts, "channel": "futures.order_book", "event": "subscribe", "payload": ["BTC_USDT"] }
//   Heartbeat: { "time": ts, "channel": "futures.ping" }
//
// Signal detection (GATE_FLOW):
//   - OB imbalance: bid/ask ratio ≥ 1.8x with ≥ $150K depth → signal
//   - Whale trade: single trade ≥ $100K → signal
//   - Cooldown: 10s per symbol

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { AnomalyCategory, AnomalyTag } from '@/lib/cex-anomaly-types'

const GATE_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt'

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
const DEFAULT_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'BNB_USDT', 'XRP_USDT', 'DOGE_USDT']

// ─── Symbol mapping: Gate.io format → standard format ────────────────────
function toStandardPair(gateSymbol: string): string {
  return gateSymbol.replace('_', '-') // "BTC_USDT" → "BTC-USDT"
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface GateOBLevel {
  price: number
  size: number
}

export interface GateOBSnapshot {
  bids: GateOBLevel[]
  asks: GateOBLevel[]
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

export interface GateTrade {
  price: number
  size: number
  side: 'BID' | 'ASK'  // BID = buyer aggressive (is_buy=true), ASK = seller aggressive (is_buy=false)
  usd: number
  timestamp: number
  /** Gate.io trade ID */
  tradeId: number
}

export interface GateSignal {
  id: string
  pair: string          // standard format e.g. "BTC-USDT"
  /** Gate.io raw symbol e.g. "BTC_USDT" */
  gateSymbol: string
  category: AnomalyCategory
  tag: AnomalyTag
  sizeUsd: number
  imbalance: number
  side: 'BID' | 'ASK'
  details: string
  timestamp: number
}

interface UseGateWSOptions {
  /** Gate.io symbols to subscribe to (e.g. ['BTC_USDT', 'ETH_USDT']) */
  symbols?: string[]
  enabled?: boolean
  /** Callback when a GATE_FLOW signal is detected */
  onSignal?: (signal: GateSignal) => void
}

interface UseGateWSReturn {
  /** Latest orderbook snapshot per symbol (keyed by Gate.io symbol e.g. "BTC_USDT") */
  orderBooks: Record<string, GateOBSnapshot>
  /** WS connection status */
  connected: boolean
  /** Recent trades per symbol (keyed by Gate.io symbol) */
  recentTrades: Record<string, GateTrade[]>
}

let _signalId = 0
function signalId() { return `gate-ws-${Date.now()}-${++_signalId}` }

export function useGateWS({
  symbols = DEFAULT_SYMBOLS,
  enabled = true,
  onSignal,
}: UseGateWSOptions = {}): UseGateWSReturn {
  const [orderBooks, setOrderBooks] = useState<Record<string, GateOBSnapshot>>({})
  const [connected, setConnected] = useState(false)
  const [recentTrades, setRecentTrades] = useState<Record<string, GateTrade[]>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const cooldownsRef = useRef<Record<string, number>>({}) // per-pair cooldowns
  const tradeAccumRef = useRef<Record<string, GateTrade[]>>({}) // accumulate trades
  const lastMessageTsRef = useRef(0)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dirtySymbolsRef = useRef<Set<string>>(new Set()) // dirty tracking for batched flush

  // Stable callback refs
  const onSignalRef = useRef(onSignal)
  useEffect(() => { onSignalRef.current = onSignal })

  // ─── Parse orderbook data ────────────────────────────────────────────
  const parseOrderbook = useCallback((gateSymbol: string, payload: Record<string, unknown>) => {
    const rawBids = (payload.bids || []) as string[][]
    const rawAsks = (payload.asks || []) as string[][]

    const bids: GateOBLevel[] = rawBids
      .map((b: string[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }))
      .filter((b: GateOBLevel) => b.price > 0 && b.size > 0)

    const asks: GateOBLevel[] = rawAsks
      .map((a: string[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }))
      .filter((a: GateOBLevel) => a.price > 0 && a.size > 0)

    if (bids.length === 0 && asks.length === 0) return

    // Calculate depth in USD (top 25 levels or available)
    const topN = Math.min(25, bids.length, asks.length)
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

    const snapshot: GateOBSnapshot = {
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

    setOrderBooks(prev => ({ ...prev, [gateSymbol]: snapshot }))

    // ── Detect OB IMBALANCE ──
    const ratio = Math.max(bidAskRatio, 1 / bidAskRatio)
    const obSide: 'BID' | 'ASK' = bidAskRatio >= 1 ? 'BID' : 'ASK'
    const depthUsd = obSide === 'BID' ? totalBidUsd : totalAskUsd
    const cooldownKey = `OB-${gateSymbol}`
    const now = Date.now()

    if (ratio >= OB_IMBALANCE_RATIO_THRESHOLD && depthUsd >= OB_IMBALANCE_MIN_USD) {
      if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > SIGNAL_COOLDOWN_MS) {
        cooldownsRef.current[cooldownKey] = now
        const signal: GateSignal = {
          id: signalId(),
          pair: toStandardPair(gateSymbol),
          gateSymbol,
          category: 'GATE_FLOW',
          tag: 'GATE-OB',
          sizeUsd: depthUsd,
          imbalance: obSide === 'BID' ? ratio * 400 : -ratio * 400,
          side: obSide,
          details: `Gate OB ${obSide === 'BID' ? 'bid' : 'ask'} pressure ${ratio.toFixed(2)}x ($${(depthUsd / 1000).toFixed(0)}K) → ${obSide === 'BID' ? 'LONG' : 'SHORT'}`,
          timestamp: now,
        }
        onSignalRef.current?.(signal)
      }
    }
  }, [])

  // ─── Parse trade data ────────────────────────────────────────────────
  const parseTrades = useCallback((gateSymbol: string, payload: Array<Record<string, unknown>>) => {
    const now = Date.now()

    for (const tradeData of payload) {
      const price = parseFloat(tradeData.price as string || '0')
      // Gate.io futures size is in contracts — we treat it as size
      const size = parseFloat(String(tradeData.size || '0'))
      const isBuy = tradeData.is_buy as boolean
      const side: 'BID' | 'ASK' = isBuy ? 'BID' : 'ASK'
      const ts = (tradeData.create_time as number) || now
      const tradeId = (tradeData.id as number) || 0

      if (price <= 0 || size <= 0) continue

      const usd = price * size

      // Accumulate trade — use splice for deque (no new array on every push)
      const trade: GateTrade = { price, size, side, usd, timestamp: ts, tradeId }
      const trades = tradeAccumRef.current[gateSymbol]
      if (!trades) {
        tradeAccumRef.current[gateSymbol] = [trade]
      } else {
        trades.push(trade)
        if (trades.length > MAX_TRADES_PER_SYMBOL) {
          trades.splice(0, trades.length - MAX_TRADES_PER_SYMBOL)
        }
      }
      // Mark symbol as dirty for batched flush
      dirtySymbolsRef.current.add(gateSymbol)

      // ── Detect WHALE TRADE ──
      const cooldownKey = `WHALE-${gateSymbol}`

      if (usd >= WHALE_TRADE_MIN_USD) {
        if (!cooldownsRef.current[cooldownKey] || now - cooldownsRef.current[cooldownKey] > SIGNAL_COOLDOWN_MS) {
          cooldownsRef.current[cooldownKey] = now
          const signal: GateSignal = {
            id: signalId(),
            pair: toStandardPair(gateSymbol),
            gateSymbol,
            category: 'GATE_FLOW',
            tag: 'GATE-WHALE',
            sizeUsd: usd,
            imbalance: side === 'BID' ? 600 : -600,
            side,
            details: `Gate whale ${side === 'BID' ? 'buy' : 'sell'} $${(usd / 1000).toFixed(0)}K @ ${price.toFixed(price > 100 ? 1 : 4)} → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
            timestamp: now,
          }
          onSignalRef.current?.(signal)
        }
      }

      // Also detect clusters: multiple medium trades in same direction within short window
      const recentWindow = 5000
      const recentSameSide = (tradeAccumRef.current[gateSymbol] || []).filter(
        t => t.side === side && t.timestamp > ts - recentWindow
      )
      const clusterUsd = recentSameSide.reduce((s, t) => s + t.usd, 0)
      const clusterCooldownKey = `WHALE-CLUSTER-${gateSymbol}`
      const clusterThreshold = WHALE_TRADE_MIN_USD * 2 // $200K cluster threshold

      if (clusterUsd >= clusterThreshold && recentSameSide.length >= 3) {
        if (!cooldownsRef.current[clusterCooldownKey] || now - cooldownsRef.current[clusterCooldownKey] > SIGNAL_COOLDOWN_MS) {
          cooldownsRef.current[clusterCooldownKey] = now
          const signal: GateSignal = {
            id: signalId(),
            pair: toStandardPair(gateSymbol),
            gateSymbol,
            category: 'GATE_FLOW',
            tag: 'GATE-CLUSTER',
            sizeUsd: clusterUsd,
            imbalance: side === 'BID' ? 600 : -600,
            side,
            details: `Gate whale ${side === 'BID' ? 'buy' : 'sell'} cluster $${(clusterUsd / 1000).toFixed(0)}K in ${recentSameSide.length} trades → ${side === 'BID' ? 'LONG' : 'SHORT'}`,
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
        let ws = new WebSocket(GATE_WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          setConnected(true)
          reconnectCountRef.current = 0
          lastMessageTsRef.current = Date.now()

          // Subscribe to orderbook + trades for all symbols
          const now = Math.floor(Date.now() / 1000)
          for (const sym of symbols) {
            ws.send(JSON.stringify({
              time: now,
              channel: 'futures.order_book',
              event: 'subscribe',
              payload: [sym],
            }))
            ws.send(JSON.stringify({
              time: now,
              channel: 'futures.trades',
              event: 'subscribe',
              payload: [sym],
            }))
          }

          // Heartbeat — send Gate.io ping every 20s
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  time: Math.floor(Date.now() / 1000),
                  channel: 'futures.ping',
                }))
              } catch {
                // Send failed — connection likely dead, watchdog will catch it
              }
            }
          }, HEARTBEAT_INTERVAL_MS)

          // Silent disconnect watchdog
          watchdogTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTsRef.current
            if (elapsed > WATCHDOG_TIMEOUT_MS) {
              console.warn(`[GATE WS] Watchdog: no message for ${(elapsed / 1000).toFixed(0)}s — force reconnecting`)
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

          // Batched state flush
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

          // Message handler — inside onopen to avoid Turbopack const scoping issue
          ws.onmessage = (event) => {
            if (!mountedRef.current) return
            lastMessageTsRef.current = Date.now()

            let raw: Record<string, unknown>
            try {
              raw = JSON.parse(event.data as string) as Record<string, unknown>
            } catch {
              return
            }

            if (raw.channel === 'futures.pong') return
            if (raw.event === 'subscribe' && raw.error === undefined) return
            if (raw.event === 'subscribe' && raw.error !== undefined) {
              console.warn(`[GATE WS] Subscription error:`, raw.error)
              return
            }

            const channel = raw.channel as string
            const ev = raw.event as string
            if (ev !== 'update' || !channel) return

            if (channel === 'futures.order_book') {
              const payload = raw.payload as Record<string, unknown> | undefined
              if (payload && typeof payload === 'object') {
                const gateSymbol = payload.s as string
                if (gateSymbol) parseOrderbook(gateSymbol, payload)
              }
            }

            if (channel === 'futures.trades') {
              const payload = raw.payload as Array<Record<string, unknown>> | undefined
              if (payload && Array.isArray(payload) && payload.length > 0) {
                const gateSymbol = (payload[0].contract as string) || ''
                if (gateSymbol) parseTrades(gateSymbol, payload)
              }
            }
          }

          ws.onclose = (closeEvent) => {
            if (!mountedRef.current) return
            clearTimers()
            setConnected(false)
            const baseDelay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30_000)
            const jitter = baseDelay * (0.7 + Math.random() * 0.6)
            const delay = Math.round(jitter)
            reconnectCountRef.current++
            console.warn(`[GATE WS] Disconnected (code=${closeEvent.code}). Reconnecting in ${delay}ms`)
            setTimeout(() => { if (mountedRef.current) connect() }, delay)
          }

          ws.onerror = (errEvent) => {
            console.error('[GATE WS] Error:', errEvent)
          }
        }
      } catch (connectErr) {
        console.error('[GATE WS] Connection failed:', connectErr)
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
  }, [enabled, symbols.join(',')])

  return { orderBooks, connected, recentTrades }
}
