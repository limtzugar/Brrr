// ─── Bybit V5 Public Spot WebSocket Hook ─────────────────────────────────────
// Lightweight WS hook subscribing to tickers for multiple Bybit SPOT pairs.
// Works globally including EU/Poland (Bybit EU is MiCA-licensed).
//
// Bybit V5 Spot WS: wss://stream.bybit.com/v5/public/spot
// Subscribe: {"op":"subscribe","args":["tickers.BTCUSDT","tickers.PAXGUSDT"]}

'use client'

import { useEffect, useRef, useState } from 'react'

const BYBIT_SPOT_WS = 'wss://stream.bybit.com/v5/public/spot'

export interface BybitSpotPrice {
  bestBid: number
  bestAsk: number
  lastPrice: number
  timestamp: number
}

interface UseBybitSpotWSOptions {
  /** Bybit spot symbols to subscribe to (e.g. ['BTCUSDT', 'PAXGUSDT']) */
  symbols: string[]
  enabled?: boolean
}

/**
 * Bybit V5 public spot WebSocket: subscribes to tickers for given symbols.
 * Returns a map of symbol → { bestBid, bestAsk, lastPrice, timestamp }.
 */
export function useBybitSpotWS({
  symbols,
  enabled = true,
}: UseBybitSpotWSOptions): Record<string, BybitSpotPrice> {
  const [prices, setPrices] = useState<Record<string, BybitSpotPrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const pricesRef = useRef<Record<string, BybitSpotPrice>>({})
  const symbolsRef = useRef(symbols)
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

      // Clear old ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }

      try {
        const ws = new WebSocket(BYBIT_SPOT_WS)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          reconnectCountRef.current = 0

          // Subscribe to tickers for all symbols
          const args = symbolsRef.current.map(s => `tickers.${s}`)
          ws.send(JSON.stringify({ op: 'subscribe', args }))

          // Bybit requires ping every 20s to keep connection alive
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 'ping' }))
            }
          }, 18_000)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const raw = JSON.parse(event.data)

            // Ignore pong and heartbeat messages
            if (raw.op === 'pong' || raw.topic?.startsWith('tickers.') === false) {
              if (raw.op === 'pong') return
              if (!raw.topic) return
            }

            // Ticker update
            if (raw.topic && raw.topic.startsWith('tickers.') && raw.data) {
              const symbol = raw.data.symbol as string
              const bid1Price = parseFloat(raw.data.bid1Price)
              const ask1Price = parseFloat(raw.data.ask1Price)
              const lastPrice = parseFloat(raw.data.lastPrice)

              if (bid1Price > 0 && ask1Price > 0) {
                const update: BybitSpotPrice = {
                  bestBid: bid1Price,
                  bestAsk: ask1Price,
                  lastPrice: lastPrice || (bid1Price + ask1Price) / 2,
                  timestamp: Date.now(),
                }
                pricesRef.current = { ...pricesRef.current, [symbol]: update }
                setPrices(prev => ({ ...prev, [symbol]: update }))
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          if (!mountedRef.current) return
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current)
            pingIntervalRef.current = null
          }
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
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
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
  }, [enabled, symbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return prices
}
