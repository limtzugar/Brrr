// ─── MEXC Futures (Contract) WebSocket Hook ─────────────────────────────────
// USDT-M perpetual futures — includes stock futures (TSLA, NVDA, AAPL, etc.)
// These trade 24/7, no market hours restrictions.
//
// MEXC Futures WS: wss://contract.mexc.com/edge
// Subscribe: {"method":"sub.ticker","param":{"symbol":"TSLA_USDT"}}
// Response: {"channel":"push.ticker","data":{"lastPrice":...,"bid1":...,"ask1":...},"symbol":"TSLA_USDT"}
// Ping: {"method":"ping"} → {"channel":"pong","data":timestamp}

'use client'

import { useEffect, useRef, useState } from 'react'

const MEXC_FUTURES_WS = 'wss://contract.mexc.com/edge'

export interface MexcFuturesPrice {
  bestBid: number
  bestAsk: number
  lastPrice: number
  fairPrice: number
  timestamp: number
}

interface UseMexcFuturesWSOptions {
  /** MEXC futures symbols with underscore format (e.g. ['TSLA_USDT', 'NVDA_USDT']) */
  symbols: string[]
  enabled?: boolean
}

/**
 * MEXC Futures (USDT-M perpetual) WebSocket: subscribes to ticker for given symbols.
 * Returns a map of symbol → { bestBid, bestAsk, lastPrice, fairPrice, timestamp }.
 *
 * Notes:
 * - Symbol format: TSLA_USDT (underscore, NOT TSLAUSDT)
 * - Stock futures trade 24/7
 * - Ping: JSON {"method":"ping"} every 15s (disconnect after 60s no ping)
 * - No auth needed for public channels
 */
export function useMexcFuturesWS({
  symbols,
  enabled = true,
}: UseMexcFuturesWSOptions): Record<string, MexcFuturesPrice> {
  const [prices, setPrices] = useState<Record<string, MexcFuturesPrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const pricesRef = useRef<Record<string, MexcFuturesPrice>>({})
  const symbolsRef = useRef(symbols)
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      try {
        const ws = new WebSocket(MEXC_FUTURES_WS)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          reconnectCountRef.current = 0

          // Subscribe to ticker for each symbol
          const currentSymbols = symbolsRef.current
          for (const symbol of currentSymbols) {
            ws.send(JSON.stringify({
              method: 'sub.ticker',
              param: { symbol },
            }))
          }

          // MEXC Futures requires ping every 10-20s (disconnects after 60s)
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ method: 'ping' }))
            }
          }, 15_000)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return

          try {
            const raw = JSON.parse(event.data)

            // Pong response
            if (raw.channel === 'pong') return

            // Ticker update
            if (raw.channel === 'push.ticker' && raw.data) {
              const symbol = raw.symbol as string
              const bid1 = parseFloat(raw.data.bid1)
              const ask1 = parseFloat(raw.data.ask1)
              const lastPrice = parseFloat(raw.data.lastPrice)
              const fairPrice = parseFloat(raw.data.fairPrice)

              if (lastPrice > 0) {
                const update: MexcFuturesPrice = {
                  bestBid: bid1 || lastPrice,
                  bestAsk: ask1 || lastPrice,
                  lastPrice,
                  fairPrice: fairPrice || lastPrice,
                  timestamp: raw.data.timestamp || Date.now(),
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
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }

        ws.onerror = () => {
          // onclose will fire after onerror
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
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
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
