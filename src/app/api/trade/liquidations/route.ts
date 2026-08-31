// ─── Liquidations API Route ──────────────────────────────────────────────────
// Fetches Binance Futures data: mark price, funding rate, open interest.
// Calculates estimated liquidation levels at common leverage tiers.
// Uses USDT-margined perpetual contracts (public endpoints, no auth needed).

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Futures base URLs (separate from spot)
const FUTURES_BASE_URLS = {
  demo: 'https://testnet.binancefuture.com',
  real: 'https://fapi.binance.com',
} as const

// Map coin IDs to Binance USDT perpetual symbols
const COIN_TO_FUTURES: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT',
  doge: 'DOGEUSDT', ada: 'ADAUSDT', dot: 'DOTUSDT',
  avax: 'AVAXUSDT', link: 'LINKUSDT', uni: 'UNIUSDT', atom: 'ATOMUSDT',
  ltc: 'LTCUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', apt: 'APTUSDT',
  arb: 'ARBUSDT', op: 'OPUSDT', sui: 'SUIUSDT',
  pepe: 'PEPEUSDT', shib: 'SHIBUSDT', trump: 'TRUMPUSDT', wld: 'WLDUSDT',
}

// Binance maintenance margin rates (approximate, tier-based)
// These are simplified — actual rates vary by notional bracket
const MAINT_MARGIN_RATE = 0.004 // 0.4% typical for mid-tier

interface LiquidationLevel {
  leverage: number
  longLiqPrice: number   // price at which longs get liquidated
  shortLiqPrice: number  // price at which shorts get liquidated
  estimatedLiqAmount: number // relative estimated amount (0-1 scale)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const coinId = searchParams.get('coinId') || 'btc'
    const mode = (searchParams.get('mode') || 'real') as 'demo' | 'real'

    const symbol = COIN_TO_FUTURES[coinId] || coinId.toUpperCase() + 'USDT'
    const baseUrl = FUTURES_BASE_URLS[mode] || FUTURES_BASE_URLS.real

    // Fetch mark price + funding rate (single request)
    const [premiumRes, oiRes] = await Promise.allSettled([
      fetch(`${baseUrl}/fapi/v1/premiumIndex?symbol=${symbol}`, {
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`${baseUrl}/fapi/v1/openInterest?symbol=${symbol}`, {
        signal: AbortSignal.timeout(10000),
      }),
    ])

    // Parse mark price + funding rate
    let markPrice = 0
    let indexPrice = 0
    let fundingRate = 0
    let nextFundingTime = 0

    if (premiumRes.status === 'fulfilled' && premiumRes.value.ok) {
      const data = await premiumRes.value.json()
      markPrice = Number(data.markPrice || 0)
      indexPrice = Number(data.indexPrice || 0)
      fundingRate = Number(data.lastFundingRate || 0)
      nextFundingTime = Number(data.nextFundingTime || 0)
    }

    // Parse open interest
    let openInterest = 0
    let openInterestUsd = 0

    if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
      const data = await oiRes.value.json()
      openInterest = Number(data.openInterest || 0)
      openInterestUsd = openInterest * markPrice
    }

    // Calculate estimated liquidation levels at common leverage tiers
    const leverageTiers = [2, 5, 10, 25, 50, 100, 125]
    const levels: LiquidationLevel[] = []

    for (const lev of leverageTiers) {
      // Long liquidation: price drops to entry * (1 - 1/leverage + maint_rate)
      const longLiqPrice = markPrice * (1 - 1 / lev + MAINT_MARGIN_RATE)
      // Short liquidation: price rises to entry * (1 + 1/leverage - maint_rate)
      const shortLiqPrice = markPrice * (1 + 1 / lev - MAINT_MARGIN_RATE)

      // Estimate relative liquidation intensity (higher leverage = more concentrated)
      // Most retail uses 5x-25x, so those get higher weight
      const weightMap: Record<number, number> = {
        2: 0.15, 5: 0.5, 10: 0.8, 25: 1.0, 50: 0.7, 100: 0.4, 125: 0.25,
      }
      const estimatedLiqAmount = weightMap[lev] || 0.3

      levels.push({
        leverage: lev,
        longLiqPrice: Math.max(0, longLiqPrice),
        shortLiqPrice,
        estimatedLiqAmount,
      })
    }

    // Determine overall sentiment from funding rate
    // Positive funding = longs paying shorts (overweight longs → potential long squeeze)
    // Negative funding = shorts paying longs (overweight shorts → potential short squeeze)
    let sentiment: 'long_heavy' | 'short_heavy' | 'neutral' = 'neutral'
    if (fundingRate > 0.0005) sentiment = 'long_heavy'
    else if (fundingRate < -0.0005) sentiment = 'short_heavy'

    return NextResponse.json({
      symbol,
      coinId,
      markPrice,
      indexPrice,
      fundingRate,
      fundingRatePct: (fundingRate * 100).toFixed(4),
      nextFundingTime,
      openInterest,
      openInterestUsd: openInterestUsd.toFixed(2),
      levels,
      sentiment,
      annualizedFunding: (fundingRate * 3 * 365 * 100).toFixed(2), // 3 fundings/day * 365
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Błąd pobierania danych liquidacji'
    console.error('[Trade Liquidations] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
