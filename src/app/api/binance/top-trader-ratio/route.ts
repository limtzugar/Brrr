// ─── Binance Top Trader Long/Short Ratio API ──────────────────────────────
// GET /api/binance/top-trader-ratio
// Fetches real Top Trader Long/Short Ratio from Binance Futures (public, no key).
// Used for CROWD_BIAS signal: when top traders are >65% on one side → contrarian.

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { binanceFetch, batchFetch } from '@/lib/binance-fetch'

export const dynamic = 'force-dynamic'

const FUTURES_BASE = 'https://fapi.binance.com'

// Pairs to query — must match ALL_PAIRS
const PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC-USDT' },
  { symbol: 'ETHUSDT', label: 'ETH-USDT' },
  { symbol: 'SOLUSDT', label: 'SOL-USDT' },
  { symbol: 'BNBUSDT', label: 'BNB-USDT' },
  { symbol: 'XRPUSDT', label: 'XRP-USDT' },
  { symbol: 'DOGEUSDT', label: 'DOGE-USDT' },
  { symbol: 'ADAUSDT', label: 'ADA-USDT' },
  { symbol: 'FILUSDT', label: 'FIL-USDT' },
  { symbol: 'SUIUSDT', label: 'SUI-USDT' },
  { symbol: 'PEPEUSDT', label: 'PEPE-USDT' },
  { symbol: 'FETUSDT', label: 'FET-USDT' },
  { symbol: 'ICPUSDT', label: 'ICP-USDT' },
  { symbol: 'TAOUSDT', label: 'TAO-USDT' },
  { symbol: 'ZECUSDT', label: 'ZEC-USDT' },
  { symbol: 'INJUSDT', label: 'INJ-USDT' },
  { symbol: 'TONUSDT', label: 'TON-USDT' },
  { symbol: 'LINKUSDT', label: 'LINK-USDT' },
  { symbol: 'AVAXUSDT', label: 'AVAX-USDT' },
  { symbol: 'HYPEUSDT', label: 'HYPE-USDT' },
  { symbol: 'TRUMPUSDT', label: 'TRUMP-USDT' },
  { symbol: 'WLDUSDT', label: 'WLD-USDT' },
]
let cachedResult: { timestamp: number; data: any } | null = null
const CACHE_TTL = 30_000 // 30s — match client poll interval (was 60s); Binance updates every 5min

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 10, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cachedResult.data, cached: true })
    }

    // Fetch top trader long/short ratio for each pair (batched to avoid 429/418)
    // API: GET /futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1
    const results = await batchFetch(
      PAIRS,
      async (pair) => {
        const url = `${FUTURES_BASE}/futures/data/topLongShortPositionRatio?symbol=${pair.symbol}&period=5m&limit=1`
        const data = await binanceFetch<any[]>(url)
        if (!Array.isArray(data) || data.length === 0) return null

        const latest = data[0]
        const longRatio = parseFloat(latest.longShortRatio) || 1
        const longAccount = parseFloat(latest.longAccount) || 0.5
        const shortAccount = parseFloat(latest.shortAccount) || 0.5

        return {
          symbol: pair.symbol,
          label: pair.label,
          longShortRatio: longRatio,
          longAccount,
          shortAccount,
          timestamp: latest.timestamp,
          // CROWD_BIAS: if longAccount > 0.64 → top traders are long → follow LONG
          // if shortAccount > 0.64 → top traders are short → follow SHORT
          bias: longAccount > 0.64 ? 'LONG_BIAS' : shortAccount > 0.64 ? 'SHORT_BIAS' : 'NEUTRAL',
          dominantPct: Math.max(longAccount, shortAccount),
        }
      },
      { batchSize: 3, batchDelay: 500, minFetched: 5 },
    )

    const ratios: Record<string, any> = {}
    for (const r of results) {
      ratios[r.label] = r
    }

    // Don't cache empty/near-empty results — let the next request try again
    if (results.length < 5) {
      console.warn(`[/api/binance/top-trader-ratio] only ${results.length}/${PAIRS.length} pairs fetched, skipping cache`)
      if (cachedResult) {
        return NextResponse.json({ ...cachedResult.data, cached: true, stale: true })
      }
    } else {
      const responseData = {
        ratios,
        timestamp: Date.now(),
        source: 'binance-futures-public',
      }
      cachedResult = { timestamp: Date.now(), data: responseData }
      return NextResponse.json(responseData)
    }

    // Fallback if too few results and no cache
    return NextResponse.json(
      { error: 'Binance TopTrader API: insufficient data', ratios, timestamp: Date.now() },
      { status: 502 },
    )
  } catch (error: any) {
    console.error('[/api/binance/top-trader-ratio] error:', error.message)
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult.data, cached: true, stale: true })
    }
    return NextResponse.json(
      { error: `Binance TopTrader API error: ${error.message}`, ratios: {} },
      { status: 502 },
    )
  }
}
