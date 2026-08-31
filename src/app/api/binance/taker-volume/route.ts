// ─── Binance Taker Buy/Sell Volume API ────────────────────────────────────
// GET /api/binance/taker-volume
// Fetches real Taker Buy/Sell Volume Ratio from Binance Futures (public, no key).
// Used for TAKER_IMBALANCE signal: aggressive buying/selling ratio > 1.5x.

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { binanceFetch, batchFetch } from '@/lib/binance-fetch'

export const dynamic = 'force-dynamic'

const FUTURES_BASE = 'https://fapi.binance.com'

// Pairs to query
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
const CACHE_TTL = 30_000 // 30s — Binance updates every 5m, but shorter cache for taker signal freshness

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

    // Fetch taker buy/sell volume ratio for each pair (batched to avoid 429/418)
    // API: GET /futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1
    const results = await batchFetch(
      PAIRS,
      async (pair) => {
        const url = `${FUTURES_BASE}/futures/data/takerlongshortRatio?symbol=${pair.symbol}&period=5m&limit=1`
        const data = await binanceFetch<any[]>(url)
        if (!Array.isArray(data) || data.length === 0) return null

        const latest = data[0]
        const buySellRatio = parseFloat(latest.buySellRatio) || 1
        const buyVol = parseFloat(latest.buyVol) || 0
        const sellVol = parseFloat(latest.sellVol) || 0

        return {
          symbol: pair.symbol,
          label: pair.label,
          buySellRatio,
          buyVol,
          sellVol,
          timestamp: latest.timestamp,
          // TAKER_IMBALANCE: ratio > 1.5 = aggressive buying, ratio < 0.67 = aggressive selling
          imbalance: buySellRatio > 1.5 ? 'BUY_DOMINANT' : buySellRatio < 0.67 ? 'SELL_DOMINANT' : 'BALANCED',
          ratioAbs: Math.max(buySellRatio, 1 / Math.max(buySellRatio, 0.01)),
        }
      },
      { batchSize: 3, batchDelay: 500, minFetched: 5 },
    )

    const volumes: Record<string, any> = {}
    for (const r of results) {
      volumes[r.label] = r
    }

    // Don't cache empty/near-empty results — let the next request try again
    if (results.length < 5) {
      console.warn(`[/api/binance/taker-volume] only ${results.length}/${PAIRS.length} pairs fetched, skipping cache`)
      if (cachedResult) {
        return NextResponse.json({ ...cachedResult.data, cached: true, stale: true })
      }
    } else {
      const responseData = {
        volumes,
        timestamp: Date.now(),
        source: 'binance-futures-public',
      }
      cachedResult = { timestamp: Date.now(), data: responseData }
      return NextResponse.json(responseData)
    }

    // Fallback if too few results and no cache
    return NextResponse.json(
      { error: 'Binance TakerVolume API: insufficient data', volumes, timestamp: Date.now() },
      { status: 502 },
    )
  } catch (error: any) {
    console.error('[/api/binance/taker-volume] error:', error.message)
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult.data, cached: true, stale: true })
    }
    return NextResponse.json(
      { error: `Binance TakerVolume API error: ${error.message}`, volumes: {} },
      { status: 502 },
    )
  }
}
