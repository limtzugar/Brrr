// ─── Binance Futures 24hr Ticker Prices ─────────────────────────────────────
// GET /api/binance/prices?symbols=BTCUSDT,ETHUSDT,...
// Fetches real-time prices + 24h change from Binance Futures API
// Public endpoint — no API key required

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BINANCE_FUTURES_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr'

// Server-side cache: 10 seconds
let cachedData: {
  timestamp: number
  data: Record<string, { price: number; change24h: number; volume: number; high: number; low: number }>
} | null = null

const CACHE_TTL = 10_000

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')

    // Return cache if fresh
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      const filtered = filterSymbols(cachedData.data, symbolsParam)
      return NextResponse.json(
        { prices: filtered, source: 'binance-futures', cached: true },
        { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20' } }
      )
    }

    // Fetch all 24hr tickers from Binance Futures
    const res = await fetch(BINANCE_FUTURES_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      // Return stale cache on failure
      if (cachedData) {
        const filtered = filterSymbols(cachedData.data, symbolsParam)
        return NextResponse.json(
          { prices: filtered, source: 'binance-futures', cached: true, stale: true },
          { status: 200 }
        )
      }
      return NextResponse.json(
        { error: `Binance API error: ${res.status}`, prices: {} },
        { status: 502 }
      )
    }

    const tickers = await res.json() as Array<{
      symbol: string
      lastPrice: string
      priceChangePercent: string
      quoteVolume: string
      highPrice: string
      lowPrice: string
    }>

    // Build price map for USDT pairs only
    const priceMap: Record<string, { price: number; change24h: number; volume: number; high: number; low: number }> = {}
    for (const t of tickers) {
      if (!t.symbol.endsWith('USDT')) continue
      const price = parseFloat(t.lastPrice)
      if (isNaN(price) || price <= 0) continue

      priceMap[t.symbol] = {
        price,
        change24h: parseFloat(t.priceChangePercent) || 0,
        volume: parseFloat(t.quoteVolume) || 0,
        high: parseFloat(t.highPrice) || 0,
        low: parseFloat(t.lowPrice) || 0,
      }
    }

    cachedData = { timestamp: Date.now(), data: priceMap }

    const filtered = filterSymbols(priceMap, symbolsParam)
    return NextResponse.json(
      { prices: filtered, source: 'binance-futures', cached: false },
      { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20' } }
    )
  } catch (error) {
    console.error('[/api/binance/prices] error:', error)

    // Return stale cache on any error
    if (cachedData) {
      const { searchParams } = new URL(request.url)
      const symbolsParam = searchParams.get('symbols')
      const filtered = filterSymbols(cachedData.data, symbolsParam)
      return NextResponse.json(
        { prices: filtered, source: 'binance-futures', cached: true, stale: true },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { error: 'Binance Futures API unavailable', prices: {} },
      { status: 502 }
    )
  }
}

function filterSymbols(
  data: Record<string, { price: number; change24h: number; volume: number; high: number; low: number }>,
  symbolsParam: string | null
): Record<string, { price: number; change24h: number; volume: number; high: number; low: number }> {
  if (!symbolsParam) return data

  const requested = symbolsParam.split(',').map(s => s.trim().toUpperCase())
  const filtered: Record<string, { price: number; change24h: number; volume: number; high: number; low: number }> = {}
  for (const sym of requested) {
    if (data[sym]) {
      filtered[sym] = data[sym]
    }
  }
  return filtered
}
