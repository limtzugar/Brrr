// ─── Kraken Public Spot WebSocket Hook ────────────────────────────────────────
// Lightweight WS hook subscribing to ticker for multiple Kraken SPOT pairs.
// Kraken is fully regulated in Poland/EU — good for spot price data.
//
// Kraken WS: wss://ws.kraken.com
// Subscribe: {"event":"subscribe","pair":["XBT/USD","PAXG/USD"],"subscription":{"name":"ticker"}}
// Response: [{a:[ask,lot,vol],b:[bid,lot,vol],c:[close,vol],...}, "XBT/USD", "ticker"]
//
// NOTE: Kraken uses "XBT" instead of "BTC" for Bitcoin.

'use client'

import { useEffect, useRef, useState } from 'react'

const KRAKEN_WS = 'wss://ws.kraken.com'

export interface KrakenSpotPrice {
  bestBid: number
  bestAsk: number
  lastPrice: number
  timestamp: number
}

interface UseKrakenSpotWSOptions {
  /** Kraken pair names (e.g. ['XBT/USD', 'PAXG/USD', 'ETH/USD']) */
  pairs: string[]
  enabled?: boolean
}

/**
 * Kraken public spot WebSocket: subscribes to ticker for given pairs.
 * Returns a map of pair → { bestBid, bestAsk, lastPrice, timestamp }.
 */
export function useKrakenSpotWS({
  pairs,
  enabled = true,
}: UseKrakenSpotWSOptions): Record<string, KrakenSpotPrice> {
  const [prices, setPrices] = useState<Record<string, KrakenSpotPrice>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const mountedRef = useRef(true)
  const pricesRef = useRef<Record<string, KrakenSpotPrice>>({})
  const pairsRef = useRef(pairs)

  // Keep pairs ref in sync
  pairsRef.current = pairs

  useEffect(() => {
    mountedRef.current = true

    if (!enabled || pairs.length === 0) {
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

      try {
        const ws = new WebSocket(KRAKEN_WS)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          reconnectCountRef.current = 0

          // Subscribe to ticker for all pairs
          ws.send(JSON.stringify({
            event: 'subscribe',
            pair: pairsRef.current,
            subscription: { name: 'ticker' },
          }))
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const raw = JSON.parse(event.data)

            // Ignore non-array messages (system status, subscription confirmations, heartbeats)
            if (!Array.isArray(raw)) return
            if (raw.length < 4) return
            if (raw[raw.length - 1] !== 'ticker') return

            // Kraken ticker format:
            // [tickerData, channelID, pairName, "ticker"]
            // or [tickerData, pairName, "ticker"] (some versions)
            const tickerData = raw[0]
            const pairName = raw[raw.length - 2] as string

            if (!tickerData || typeof tickerData !== 'object' || !pairName) return

            // Extract bid/ask from Kraken format
            // a = asks: [price, wholeLotVol, lotVol]
            // b = bids: [price, wholeLotVol, lotVol]
            // c = close (last trade): [price, lotVol]
            const asks = tickerData.a as string[] | undefined
            const bids = tickerData.b as string[] | undefined
            const close = tickerData.c as string[] | undefined

            if (!asks || !bids) return

            const bestAsk = parseFloat(asks[0])
            const bestBid = parseFloat(bids[0])
            const lastPrice = close ? parseFloat(close[0]) : (bestBid + bestAsk) / 2

            if (bestBid > 0 && bestAsk > 0) {
              const update: KrakenSpotPrice = {
                bestBid,
                bestAsk,
                lastPrice,
                timestamp: Date.now(),
              }
              pricesRef.current = { ...pricesRef.current, [pairName]: update }
              setPrices(prev => ({ ...prev, [pairName]: update }))
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
  }, [enabled, pairs.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return prices
}
