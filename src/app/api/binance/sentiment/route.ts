// ─── Binance Futures Sentiment API ────────────────────────────────────────
// GET /api/binance/sentiment
// Fetches liquidation cascade and OI velocity from Binance Futures PUBLIC data.
//
// Endpoints used:
//   1. /fapi/v1/forceOrders — Recent liquidation orders (LIQUIDATION_CASCADE)
//   2. /fapi/futures/data/openInterestHist — OI history for velocity (OI_VELOCITY)
//
// OPTIMIZED: Removed fetchCrowdBias() and fetchTakerImbalance() which were
// redundant — dedicated endpoints /api/binance/top-trader-ratio and
// /api/binance/taker-volume already serve these signals. This eliminates
// ~88 wasted Binance API calls per minute.
//
// Uses batchFetch + binanceFetch to avoid Binance 429/418 IP bans.

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { binanceFetch, batchFetch } from '@/lib/binance-fetch'

export const dynamic = 'force-dynamic'

const BINANCE_FAPI = 'https://fapi.binance.com'

// Symbols to monitor — Binance Futures format (no dash, USDT suffix)
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'FILUSDT', 'SUIUSDT', 'PEPEUSDT',
  'FETUSDT', 'ICPUSDT', 'TAOUSDT', 'ZECUSDT', 'INJUSDT',
  'TONUSDT', 'LINKUSDT', 'AVAXUSDT', 'HYPEUSDT', 'TRUMPUSDT',
  'WLDUSDT',
]

// ─── Thresholds ────────────────────────────────────────────────────────
const LIQ_CASCADE_MIN_USD = 500_000   // $500K total liquidations in 5min
const OI_VELOCITY_THRESHOLD_PCT = 3   // 3% OI change in 5min

// ─── Cache ─────────────────────────────────────────────────────────────
let cachedResult: {
  timestamp: number
  liquidationCascade: SentimentSignal[]
  oiVelocity: SentimentSignal[]
  rawData: Record<string, any>
} | null = null
const CACHE_TTL = 60_000 // 60s — matches data granularity

interface SentimentSignal {
  symbol: string      // Our format: PEPE-USDT
  binanceSymbol: string // Binance format: PEPEUSDT
  side: 'BID' | 'ASK'  // Which side the signal is on
  value: number          // Signal strength
  details: string        // Human-readable description
}

// ─── Fetch Recent Liquidation Orders (LIQUIDATION_CASCADE) ────────────
async function fetchLiquidationCascade(): Promise<SentimentSignal[]> {
  const signals: SentimentSignal[] = []

  // Aggregate liquidations by pair and side using batchFetch
  const results = await batchFetch(
    SYMBOLS,
    async (sym) => {
      const url = `${BINANCE_FAPI}/fapi/v1/forceOrders?symbol=${sym}&limit=50`
      const data = await binanceFetch<any[]>(url)
      if (!Array.isArray(data) || data.length === 0) return null

      let longUsd = 0
      let shortUsd = 0

      for (const order of data) {
        const price = parseFloat(order.price) || 0
        const qty = parseFloat(order.origQty) || 0
        const usd = price * qty
        // "side" in forceOrder: the side of the liquidated position
        // SELL = long liquidation, BUY = short liquidation
        if (order.side === 'SELL') {
          longUsd += usd
        } else {
          shortUsd += usd
        }
      }

      if (longUsd > 0 || shortUsd > 0) {
        return { symbol: sym, longUsd, shortUsd }
      }
      return null
    },
    { batchSize: 3, batchDelay: 500 },
  )

  // Build liqByPair from batchFetch results
  const liqByPair: Record<string, { longUsd: number; shortUsd: number }> = {}
  for (const r of results) {
    liqByPair[r.symbol] = { longUsd: r.longUsd, shortUsd: r.shortUsd }
  }

  // Check for cascades: if one side has significantly more liquidations
  for (const [sym, liq] of Object.entries(liqByPair)) {
    const totalUsd = liq.longUsd + liq.shortUsd
    if (totalUsd < LIQ_CASCADE_MIN_USD) continue

    // Long liquidations dominant → price is dropping → more downside likely (ASK/SHORT)
    // Short liquidations dominant → price is rising → more upside likely (BID/LONG)
    // This is MOMENTUM, not contrarian — liquidations create cascade pressure
    if (liq.longUsd > liq.shortUsd * 2 && liq.longUsd >= LIQ_CASCADE_MIN_USD) {
      signals.push({
        symbol: sym.replace('USDT', '-USDT'),
        binanceSymbol: sym,
        side: 'ASK', // Long liquidations → downside cascade → SHORT
        value: liq.longUsd,
        details: `Long liq cascade $${(liq.longUsd / 1000).toFixed(0)}K → downside momentum`,
      })
    } else if (liq.shortUsd > liq.longUsd * 2 && liq.shortUsd >= LIQ_CASCADE_MIN_USD) {
      signals.push({
        symbol: sym.replace('USDT', '-USDT'),
        binanceSymbol: sym,
        side: 'BID', // Short liquidations → upside cascade → LONG
        value: liq.shortUsd,
        details: `Short liq cascade $${(liq.shortUsd / 1000).toFixed(0)}K → upside momentum`,
      })
    }
  }

  return signals
}

// ─── Fetch OI History for Velocity (OI_VELOCITY) ─────────────────────
async function fetchOIVelocity(): Promise<SentimentSignal[]> {
  const signals: SentimentSignal[] = []
  // We store previous OI to compute velocity
  const prevOI: Record<string, number> = (cachedResult?.rawData?.oiVelocity as Record<string, number>) || {}

  const results = await batchFetch(
    SYMBOLS,
    async (sym) => {
      const url = `${BINANCE_FAPI}/fapi/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=3`
      const data = await binanceFetch<any[]>(url)
      if (!Array.isArray(data) || data.length < 2) return null

      const latest = data[data.length - 1]
      const previous = data[data.length - 2]
      const currentOI = parseFloat(latest.sumOpenInterestUsd) || 0
      const prevOIV = parseFloat(previous.sumOpenInterestUsd) || 0

      if (currentOI <= 0) return null
      return { sym, oi: currentOI, prevOI: prevOIV }
    },
    { batchSize: 3, batchDelay: 500 },
  )

  for (const r of results) {
    const { sym, oi } = r
    const prev: number = r.prevOI ?? 0
    // Store for next cycle
    prevOI[sym] = oi

    if (prev > 0) {
      const changePct = ((oi - prev) / prev) * 100
      if (Math.abs(changePct) >= OI_VELOCITY_THRESHOLD_PCT) {
        // OI growing → new positions entering → BID (bullish)
        // OI shrinking → positions closing → ASK (bearish)
        signals.push({
          symbol: sym.replace('USDT', '-USDT'),
          binanceSymbol: sym,
          side: changePct > 0 ? 'BID' : 'ASK',
          value: Math.abs(changePct),
          details: `OI ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}% (${(oi / 1_000_000).toFixed(1)}M) → ${changePct > 0 ? 'new positions' : 'positions closing'}`,
        })
      }
    }
  }

  // Store prevOI for next cycle
  if (!cachedResult) cachedResult = { timestamp: 0, liquidationCascade: [], oiVelocity: [], rawData: {} }
  cachedResult.rawData.oiVelocity = prevOI

  return signals
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 10, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    // Return cached if fresh
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return NextResponse.json({
        ...cachedResult,
        cached: true,
      })
    }

    // Fetch only LIQUIDATION_CASCADE and OI_VELOCITY (CROWD_BIAS and TAKER_IMBALANCE
    // are served by dedicated endpoints — /api/binance/top-trader-ratio and /api/binance/taker-volume)
    const [liquidationCascade, oiVelocity] = await Promise.all([
      fetchLiquidationCascade(),
      fetchOIVelocity(),
    ])

    const totalFetched = liquidationCascade.length + oiVelocity.length

    const result = {
      timestamp: Date.now(),
      liquidationCascade,
      oiVelocity,
      rawData: cachedResult?.rawData || {},
      source: 'binance-public',
    }

    // Don't cache empty/near-empty results — let the next request try again
    if (totalFetched < 5) {
      console.warn(`[/api/binance/sentiment] only ${totalFetched} signals fetched, skipping cache`)
      if (cachedResult) {
        return NextResponse.json({
          ...cachedResult,
          cached: true,
          stale: true,
        })
      }
    } else {
      cachedResult = result
      return NextResponse.json({
        ...result,
        cached: false,
      })
    }

    // Fallback if too few results and no cache
    return NextResponse.json({
      ...result,
      cached: false,
      partial: true,
    })
  } catch (error: any) {
    console.error('[/api/binance/sentiment] error:', error.message)

    if (cachedResult) {
      return NextResponse.json({
        ...cachedResult,
        cached: true,
        stale: true,
        error: error.message,
      })
    }

    return NextResponse.json({
      error: `Sentiment API error: ${error.message}`,
      liquidationCascade: [],
      oiVelocity: [],
      timestamp: Date.now(),
    }, { status: 502 })
  }
}
