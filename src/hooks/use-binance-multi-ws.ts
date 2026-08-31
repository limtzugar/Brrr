// ─── Binance Futures Multi-Pair WebSocket Hook ────────────────────────────────
// Lightweight WS hook that subscribes to depth20@100ms for MULTIPLE pairs.
// Returns real-time best bid/ask per symbol — used to anchor simulation prices
// for ALL watched pairs, not just the active one.
//
// Binance Combined Stream format:
//   wss://fstream.binance.com/stream?streams=symbol1@depth20@100ms/symbol2@depth20@100ms/...

'use client'

import { useEffect, useRef, useState } from 'react'

const BINANCE_WS_COMBINED = 'wss://fstream.binance.com/stream'

export interface MultiPairPrice {
  bestBid: number
  bestAsk: number
  timestamp: number
}

interface UseBinanceMultiWSOptions {
  /** Binance symbols to subscribe to (e.g. ['BTCUSDT', 'PEPEUSDT']) */
  symbols: string[]
  enabled?: boolean
}

/**
 * Lightweight multi-pair WS: subscribes to depth20@100ms for all given symbols.
 * Returns a map of symbol → { bestBid, bestAsk, timestamp } updated in real-time.
 */
export function useBinanceMultiWS({
  symbols,
  enabled = true,
}: UseBinanceMultiWSOptions): Record<string, MultiPairPrice> {
  const [prices, setPrices] = useState<Record<string, MultiPairPrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const pricesRef = useRef<Record<string, MultiPairPrice>>({})
  const symbolsRef = useRef(symbols)

  // Keep symbols ref in sync
  symbolsRef.current = symbols

  useEffect(() => {
    mountedRef.current = true

    if (!enabled || symbols.length === 0) {
      return
    }

    const connect = () => {
      if (!mountedRef.current) return

      // Clean up existing
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

      // Build combined stream URL: symbol1@depth20@100ms/symbol2@depth20@100ms/...
      const streams = symbols.map(s => `${s.toLowerCase()}@depth20@100ms`).join('/')
      const url = `${BINANCE_WS_COMBINED}?streams=${streams}`

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (mountedRef.current) {
            reconnectCountRef.current = 0
          }
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const raw = JSON.parse(event.data)
            // Combined stream format: { stream: "symbol@depth20@100ms", data: { e: "depthUpdate", ... } }
            const payload = raw.data ?? raw
            const streamName = raw.stream as string | undefined

            if (!streamName) return

            // Extract symbol from stream name (e.g. "pepeusdt@depth20@100ms" → "PEPEUSDT")
            const wsSymbol = streamName.split('@')[0]?.toUpperCase()
            if (!wsSymbol) return

            // Extract best bid/ask
            const bids = (payload.b || []) as string[][]
            const asks = (payload.a || []) as string[][]
            if (bids.length > 0 && asks.length > 0) {
              const bestBid = parseFloat(bids[0][0])
              const bestAsk = parseFloat(asks[0][0])
              if (bestBid > 0 && bestAsk > 0) {
                const update = { bestBid, bestAsk, timestamp: Date.now() }
                pricesRef.current = { ...pricesRef.current, [wsSymbol]: update }
                setPrices(prev => ({ ...prev, [wsSymbol]: update }))
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          if (!mountedRef.current) return
          const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), 30_000)
          reconnectCountRef.current++
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = () => {
          // onclose will fire
        }
      } catch {
        // WebSocket constructor failed
      }
    }

    connect()

    return () => {
      mountedRef.current = false
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

  return prices
}
