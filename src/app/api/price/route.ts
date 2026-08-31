// ─── Simple Price API ────────────────────────────────────────────────────────
// GET: Fetch current price for a given coin from CoinGecko /simple/price
// Lightweight – no sparkline, no market data, just price + 24h change

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://api.coingecko.com/api/v3'

// Server-side cache: 30 seconds
let cachedData: {
  coinId: string
  timestamp: number
  data: { price: number; change24h: number }
} | null = null

const CACHE_TTL = 30_000

async function fetchWithRetry(url: string, retries = 3): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 429) {
        const wait = 2000 * Math.pow(2, attempt - 1) + Math.random() * 500
        console.warn(`[price] 429, retry in ${Math.round(wait)}ms`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error('exhausted retries')
}

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 30, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  try {
    const { searchParams } = new URL(request.url)
    const coinId = searchParams.get('coin_id') || 'bitcoin'

    // Return cache if fresh and same coin
    if (cachedData && cachedData.coinId === coinId && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cachedData.data, cached: true })
    }

    const url = `${BASE_URL}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_24hr_change=true`
    const data = (await fetchWithRetry(url)) as Record<string, { usd?: number; usd_24h_change?: number }>

    const coinData = data[coinId]
    if (!coinData?.usd) {
      return NextResponse.json({ error: 'Price not found' }, { status: 404 })
    }

    const result = {
      price: coinData.usd,
      change24h: coinData.usd_24h_change ?? 0,
    }

    cachedData = { coinId, timestamp: Date.now(), data: result }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    })
  } catch (error) {
    console.error('[/api/price] error:', error)
    // Return stale cache
    if (cachedData) {
      return NextResponse.json({ ...cachedData.data, cached: true, stale: true })
    }
    return NextResponse.json({ error: 'Błąd pobierania ceny' }, { status: 502 })
  }
}
