// ─── CEX Anomaly Liquidations API ──────────────────────────────────────────
// GET: Estimates liquidation levels from Binance Futures data.
// Uses funding rate + mark price + open interest — all public, no API key.

import { NextResponse } from 'next/server'
import { fetchFundingRate, fetchOpenInterest } from '@/lib/binance-public'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// ─── Config ────────────────────────────────────────────────────────────────

const FUTURES_PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC-USDT' },
  { symbol: 'ETHUSDT', label: 'ETH-USDT' },
  { symbol: 'SOLUSDT', label: 'SOL-USDT' },
  { symbol: 'BNBUSDT', label: 'BNB-USDT' },
  { symbol: 'HYPEUSDT', label: 'HYPE-USDT' },
]

// ─── Cache ──────────────────────────────────────────────────────────────────

let cachedData: { timestamp: number; data: any } | null = null
const CACHE_TTL = 15_000 // 15 seconds

// ─── Liquidation Level Estimation ──────────────────────────────────────────

interface LiquidationLevel {
  symbol: string
  label: string
  markPrice: number
  fundingRate: number
  openInterest: number
  longLiqEstimate: number
  shortLiqEstimate: number
  longLiqDistance: number
  shortLiqDistance: number
  bias: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL'
}

function estimateLiquidationLevels(
  markPrice: number,
  fundingRate: number,
  openInterest: number,
): Omit<LiquidationLevel, 'symbol' | 'label'> {
  const typicalLeverage = 10
  const maintenanceMargin = 0.005

  const longLiqEstimate = markPrice * (1 - 1 / typicalLeverage + maintenanceMargin)
  const shortLiqEstimate = markPrice * (1 + 1 / typicalLeverage - maintenanceMargin)

  const longLiqDistance = ((markPrice - longLiqEstimate) / markPrice) * 100
  const shortLiqDistance = ((shortLiqEstimate - markPrice) / markPrice) * 100

  let bias: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL'
  if (fundingRate > 0.0005) bias = 'SHORT_BIAS'
  else if (fundingRate < -0.0005) bias = 'LONG_BIAS'
  else bias = 'NEUTRAL'

  return {
    markPrice,
    fundingRate,
    openInterest,
    longLiqEstimate,
    shortLiqEstimate,
    longLiqDistance,
    shortLiqDistance,
    bias,
  }
}

// ─── GET Handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 15, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cachedData.data, cached: true })
    }

    const results = await Promise.allSettled(
      FUTURES_PAIRS.map(async (pair) => {
        const [funding, oi] = await Promise.all([
          fetchFundingRate(pair.symbol),
          fetchOpenInterest(pair.symbol),
        ])
        return { pair, funding, oi }
      })
    )

    const levels: LiquidationLevel[] = []

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const { pair, funding, oi } = result.value

      const est = estimateLiquidationLevels(funding.markPrice, funding.fundingRate, oi.openInterest)
      levels.push({
        symbol: pair.symbol,
        label: pair.label,
        ...est,
      })
    }

    const responseData = { levels, timestamp: Date.now() }
    cachedData = { timestamp: Date.now(), data: responseData }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('[/api/cex-anomaly/liquidations] error:', error)
    if (cachedData) {
      return NextResponse.json({ ...cachedData.data, cached: true, stale: true })
    }
    return NextResponse.json({ error: 'Failed to fetch data likwidacji', levels: [] }, { status: 502 })
  }
}
