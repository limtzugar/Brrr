// ─── Binance Futures WebSocket + REST Hook ──────────────────────────────────
// Dual data source strategy:
//   1. REST API fetches deep orderbook (50 levels) every 1s → wide view
//   2. WebSocket depth20@100ms → real-time price updates for dot movement
//   3. WebSocket aggTrade → CVD momentum indicator
// Combined stream: wss://fstream.binance.com/stream?streams=...

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type {
  BinanceDepthLevel,
  BinanceAggTrade,
  WSOrderBookSnapshot,
  WSTradeData,
} from '@/lib/cex-anomaly-types'

const BINANCE_WS_COMBINED = 'wss://fstream.binance.com/stream'
const BINANCE_REST_BASE = 'https://fapi.binance.com/fapi/v1'

// Only @100ms speed works reliably on Binance Futures WS
const WS_DEPTH_LEVELS = 20
const WS_DEPTH_SPEED = '100ms'

interface UseBinanceWSOptions {
  symbol: string
  enabled?: boolean
  depthLevels?: number       // REST API depth (5, 10, 20, 50) — WS always uses 20@100ms
  restIntervalMs?: number    // REST refresh interval (default 1000ms)
}

interface UseBinanceWSReturn {
  orderBook: WSOrderBookSnapshot | null
  tradeData: WSTradeData | null
  connected: boolean
  reconnectCount: number
}

export function useBinanceWS({
  symbol,
  enabled = true,
  depthLevels = 20,
  restIntervalMs = 2000, // PERF FIX: 1s → 2s — WS provides real-time data, REST is just backup
}: UseBinanceWSOptions): UseBinanceWSReturn {
  const [orderBook, setOrderBook] = useState<WSOrderBookSnapshot | null>(null)
  const [tradeData, setTradeData] = useState<WSTradeData | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cvdAccumRef = useRef({ buyVol: 0, sellVol: 0, trades: [] as BinanceAggTrade[] })
  const mountedRef = useRef(true)
  // Store WS best bid/ask separately so dot always moves in real-time
  const wsBestRef = useRef<{ bid: number; ask: number } | null>(null)

  // ─── Process an aggTrade message ────────────────────────────────────
  const processAggTrade = useCallback((payload: Record<string, unknown>) => {
    const trade: BinanceAggTrade = {
      a: payload.a as number,
      p: payload.p as string,
      q: payload.q as string,
      f: payload.f as number,
      l: payload.l as number,
      T: payload.T as number,
      m: payload.m as boolean,
      M: payload.M as boolean,
    }

    const qty = parseFloat(trade.q)
    if (trade.m) {
      cvdAccumRef.current.sellVol += qty
    } else {
      cvdAccumRef.current.buyVol += qty
    }
    cvdAccumRef.current.trades.push(trade)

    const acc = cvdAccumRef.current
    if (acc.trades.length >= 10) {
      const cvdDelta = acc.buyVol - acc.sellVol
      setTradeData({
        trades: [...acc.trades],
        cvdDelta,
        buyVolume: acc.buyVol,
        sellVolume: acc.sellVol,
        timestamp: Date.now(),
      })
      cvdAccumRef.current = { buyVol: 0, sellVol: 0, trades: [] }
    }
  }, [])

  // ─── Merge WS best prices into existing orderbook ───────────────────
  // This keeps the dot moving in real-time even between REST refreshes
  // PERF FIX: Throttle setState to max 5/sec (200ms) instead of every WS message.
  // WS sends depth updates at 100ms intervals — that's 10 setState/sec → too many re-renders.
  // 200ms throttle = 5/sec, still smooth enough for the orderbook dot movement.
  const lastBookUpdateRef = useRef(0)
  const mergeWsBestIntoBook = useCallback(() => {
    const best = wsBestRef.current
    if (!best || !best.bid || !best.ask) return

    // Throttle: skip if less than 200ms since last setState
    const now = Date.now()
    if (now - lastBookUpdateRef.current < 200) return
    lastBookUpdateRef.current = now

    setOrderBook(prev => {
      if (!prev) return prev
      // Update only if WS best prices differ significantly from current book
      const currentBestBid = prev.bids[0]?.price ?? 0
      const currentBestAsk = prev.asks[0]?.price ?? 0
      // Only update if prices moved (avoids infinite loops)
      if (Math.abs(best.bid - currentBestBid) < 0.0001 && Math.abs(best.ask - currentBestAsk) < 0.0001) {
        return prev
      }
      // Update best bid/ask in existing book
      const newBids = [...prev.bids]
      const newAsks = [...prev.asks]
      if (newBids.length > 0) newBids[0] = { ...newBids[0], price: best.bid }
      if (newAsks.length > 0) newAsks[0] = { ...newAsks[0], price: best.ask }
      return { ...prev, bids: newBids, asks: newAsks, timestamp: Date.now() }
    })
  }, [])

  // ─── Fetch deep orderbook via REST API ──────────────────────────────
  const fetchDeepBook = useCallback(async () => {
    if (!enabled || !symbol || !mountedRef.current) return
    try {
      const url = `${BINANCE_REST_BASE}/depth?symbol=${symbol}&limit=${depthLevels}`
      const res = await fetch(url)
      if (!res.ok || !mountedRef.current) return
      const data = await res.json()

      const bids: BinanceDepthLevel[] = (data.bids || []).map((b: string[]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
      }))
      const asks: BinanceDepthLevel[] = (data.asks || []).map((a: string[]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
      }))

      if (bids.length === 0 && asks.length === 0) return

      setOrderBook({
        bids,
        asks,
        lastUpdateId: data.lastUpdateId || 0,
        timestamp: Date.now(),
      })
    } catch {
      // REST fetch failed — WS data still flows if connected
    }
  }, [symbol, enabled, depthLevels])

  // ─── WebSocket connect ──────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!enabled || !symbol || !mountedRef.current) return

    // Clean up existing connection
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

    const streamName = symbol.toLowerCase()
    const depthStream = `${streamName}@depth${WS_DEPTH_LEVELS}@${WS_DEPTH_SPEED}`
    const tradeStream = `${streamName}@aggTrade`
    const url = `${BINANCE_WS_COMBINED}?streams=${depthStream}/${tradeStream}`

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (mountedRef.current) {
          setConnected(true)
          // Fetch deep book immediately on WS connect
          fetchDeepBook()
        }
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const raw = JSON.parse(event.data)

          // Combined stream format: { stream: "name", data: {...} }
          const payload = raw.data ?? raw
          const eventType = payload.e as string | undefined

          // Depth update — extract best bid/ask for real-time dot movement
          if (eventType === 'depthUpdate' || payload.lastUpdateId !== undefined) {
            const bids = (payload.b || []) as string[][]
            const asks = (payload.a || []) as string[][]
            if (bids.length > 0 && asks.length > 0) {
              const bestBid = parseFloat(bids[0][0])
              const bestAsk = parseFloat(asks[0][0])
              if (bestBid > 0 && bestAsk > 0) {
                wsBestRef.current = { bid: bestBid, ask: bestAsk }
                // Merge into existing book for real-time dot updates
                mergeWsBestIntoBook()
              }
            }

            // Also update full orderbook from WS if REST hasn't delivered yet
            // PERF FIX: This only fires before REST responds (prev.bids.length <= 20)
            // After REST delivers, it returns prev (no setState). Safe to keep as-is.
            setOrderBook(prev => {
              // If REST already delivered a wider book, keep it
              if (prev && prev.bids.length > WS_DEPTH_LEVELS) return prev
              // Otherwise use WS data (initial state before REST responds)
              const wsBids: BinanceDepthLevel[] = bids.map((b: string[]) => ({
                price: parseFloat(b[0]),
                quantity: parseFloat(b[1]),
              }))
              const wsAsks: BinanceDepthLevel[] = asks.map((a: string[]) => ({
                price: parseFloat(a[0]),
                quantity: parseFloat(a[1]),
              }))
              return {
                bids: wsBids,
                asks: wsAsks,
                lastUpdateId: (payload.lastUpdateId as number) || (payload.u as number) || 0,
                timestamp: Date.now(),
              }
            })
          }

          // AggTrade update
          if (eventType === 'aggTrade') {
            processAggTrade(payload)
          }
        } catch {
          // Ignore parse errors
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        wsBestRef.current = null
        const delay = Math.min(1000 * Math.pow(2, reconnectCount), 30_000)
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setReconnectCount(prev => prev + 1)
            connect()
          }
        }, delay)
      }

      ws.onerror = () => {
        // onclose will fire after onerror
      }
    } catch {
      setConnected(false)
    }
  }, [symbol, enabled, reconnectCount, processAggTrade, fetchDeepBook, mergeWsBestIntoBook])

  // ─── Connect on mount / when symbol changes ─────────────────────────
  useEffect(() => {
    mountedRef.current = true
    setReconnectCount(0)
    setOrderBook(null)
    setTradeData(null)
    wsBestRef.current = null
    cvdAccumRef.current = { buyVol: 0, sellVol: 0, trades: [] }

    if (enabled && symbol) {
      connect()
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current)
        restTimerRef.current = null
      }
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
  }, [symbol, enabled, connect])

  // ─── Periodic REST deep book refresh ────────────────────────────────
  useEffect(() => {
    if (!enabled || !symbol) return
    // Fetch immediately
    fetchDeepBook()
    // Then periodically (every restIntervalMs)
    restTimerRef.current = setInterval(fetchDeepBook, restIntervalMs)
    return () => {
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current)
        restTimerRef.current = null
      }
    }
  }, [enabled, symbol, fetchDeepBook, restIntervalMs])

  // ─── Flush CVD accumulator periodically ─────────────────────────────
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => {
      const acc = cvdAccumRef.current
      if (acc.trades.length > 0 && mountedRef.current) {
        const cvdDelta = acc.buyVol - acc.sellVol
        setTradeData({
          trades: [...acc.trades],
          cvdDelta,
          buyVolume: acc.buyVol,
          sellVolume: acc.sellVol,
          timestamp: Date.now(),
        })
        cvdAccumRef.current = { buyVol: 0, sellVol: 0, trades: [] }
      }
    }, 500)
    return () => clearInterval(interval)
  }, [enabled])

  return { orderBook, tradeData, connected, reconnectCount }
}
