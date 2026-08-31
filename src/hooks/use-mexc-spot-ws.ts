// ─── MEXC Spot WebSocket Hook ────────────────────────────────────────────────
// Lightweight WS hook subscribing to bookTicker for multiple MEXC SPOT pairs.
// MEXC has 3000+ spot pairs including many altcoins not on Bybit/Kraken.
//
// MEXC Spot WS v3: wss://wbs-api.mexc.com/ws  (old wbs.mexc.com deprecated Aug 2025)
// Subscribe: {"method":"SUBSCRIPTION","params":["spot@public.aggre.bookTicker.v3.api.pb@100ms@BTCUSDT"]}
// Response:  {"channel":"...","publicbookticker":{"bidprice":"...","askprice":"..."},"symbol":"BTCUSDT","sendtime":...}
// Ping: plain text "ping" → server responds "pong"

'use client'

import { useEffect, useRef, useState } from 'react'

const MEXC_SPOT_WS = 'wss://wbs-api.mexc.com/ws'

export interface MexcSpotPrice {
  bestBid: number
  bestAsk: number
  lastPrice: number // derived from mid-price (bookTicker has no lastPrice field)
  timestamp: number
}

interface UseMexcSpotWSOptions {
  /** MEXC spot symbols to subscribe to (e.g. ['BTCUSDT', 'ETHUSDT']) */
  symbols: string[]
  enabled?: boolean
}

/**
 * MEXC public spot WebSocket: subscribes to bookTicker for given symbols.
 * Returns a map of symbol → { bestBid, bestAsk, lastPrice, timestamp }.
 *
 * Notes:
 * - Max 30 subscriptions per WS connection (MEXC limit)
 * - Connection auto-disconnects after 30s without subscription, 60s without data
 * - Max 24h connection lifetime — hook handles reconnection
 * - Ping: plain text "ping" frame every 25s
 */
export function useMexcSpotWS({
  symbols,
  enabled = true,
}: UseMexcSpotWSOptions): Record<string, MexcSpotPrice> {
  const [prices, setPrices] = useState<Record<string, MexcSpotPrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const pricesRef = useRef<Record<string, MexcSpotPrice>>({})
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
        const ws = new WebSocket(MEXC_SPOT_WS)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          reconnectCountRef.current = 0

          // Subscribe to bookTicker for all symbols
          // MEXC allows max 30 subs per connection — batch if needed
          const currentSymbols = symbolsRef.current
          if (currentSymbols.length > 0) {
            const params = currentSymbols.map(s => `spot@public.aggre.bookTicker.v3.api.pb@100ms@${s}`)
            // Split into chunks of 30 if more than 30 symbols
            for (let i = 0; i < params.length; i += 30) {
              const chunk = params.slice(i, i + 30)
              ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: chunk }))
            }
          }

          // MEXC requires ping to keep connection alive (disconnects after 60s no data)
          // Send plain text "ping" every 25s
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('ping')
            }
          }, 25_000)
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return

          // MEXC responds to "ping" with "pong" as plain text
          if (event.data === 'pong') return

          try {
            const raw = JSON.parse(event.data)

            // Subscription confirmation messages
            if (raw.method === 'SUBSCRIPTION' || raw.method === 'UNSUBSCRIPTION') return

            // Book ticker update
            if (raw.channel && raw.channel.includes('bookTicker') && raw.publicbookticker) {
              const symbol = raw.symbol as string
              const bidPrice = parseFloat(raw.publicbookticker.bidprice)
              const askPrice = parseFloat(raw.publicbookticker.askprice)

              if (bidPrice > 0 && askPrice > 0) {
                const midPrice = (bidPrice + askPrice) / 2
                const update: MexcSpotPrice = {
                  bestBid: bidPrice,
                  bestAsk: askPrice,
                  lastPrice: midPrice, // bookTicker doesn't include lastPrice, use mid
                  timestamp: Date.now(),
                }
                pricesRef.current = { ...pricesRef.current, [symbol]: update }
                setPrices(prev => ({ ...prev, [symbol]: update }))
              }
            }
          } catch {
            // Ignore parse errors (non-JSON messages)
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
