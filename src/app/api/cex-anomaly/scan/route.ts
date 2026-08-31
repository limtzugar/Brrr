// ─── CEX Anomaly Scan API ──────────────────────────────────────────────────
// GET: Fetches real order book + trade data from Binance and detects anomalies.
// Public endpoints only — no API key required.

import { NextResponse } from 'next/server'
import {
  fetchSpotOrderBook,
  fetchSpotAggTrades,
  fetchSpotTicker,
  fetchFundingRate,
  fetchOpenInterest,
  calculateImbalance,
  detectWalls,
  classifyTrades,
  type OrderBookData,
} from '@/lib/binance-public'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// ─── Config ────────────────────────────────────────────────────────────────

// AUDIT FIX M-4: SCAN_PAIRS now matches ALL_PAIRS from cex-anomaly-constants.
// Previously only 8 pairs were scanned — pairs not in ALL_PAIRS never received Binance scan anomalies.
const SCAN_PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC-USDT', exchange: 'Binance' },
  { symbol: 'ETHUSDT', label: 'ETH-USDT', exchange: 'Binance' },
  { symbol: 'SOLUSDT', label: 'SOL-USDT', exchange: 'Binance' },
  { symbol: 'BNBUSDT', label: 'BNB-USDT', exchange: 'Binance' },
  { symbol: 'XRPUSDT', label: 'XRP-USDT', exchange: 'Binance' },
  { symbol: 'DOGEUSDT', label: 'DOGE-USDT', exchange: 'Binance' },
  { symbol: 'ADAUSDT', label: 'ADA-USDT', exchange: 'Binance' },
  { symbol: 'FILUSDT', label: 'FIL-USDT', exchange: 'Binance' },
  { symbol: 'SUIUSDT', label: 'SUI-USDT', exchange: 'Binance' },
  { symbol: 'PEPEUSDT', label: 'PEPE-USDT', exchange: 'Binance' },
  { symbol: 'FETUSDT', label: 'FET-USDT', exchange: 'Binance' },
  { symbol: 'ICPUSDT', label: 'ICP-USDT', exchange: 'Binance' },
  { symbol: 'TAOUSDT', label: 'TAO-USDT', exchange: 'Binance' },
  { symbol: 'ZECUSDT', label: 'ZEC-USDT', exchange: 'Binance' },
  { symbol: 'INJUSDT', label: 'INJ-USDT', exchange: 'Binance' },
  { symbol: 'TONUSDT', label: 'TON-USDT', exchange: 'Binance' },
  { symbol: 'LINKUSDT', label: 'LINK-USDT', exchange: 'Binance' },
  { symbol: 'AVAXUSDT', label: 'AVAX-USDT', exchange: 'Binance' },
  { symbol: 'HYPEUSDT', label: 'HYPE-USDT', exchange: 'Binance' },
  { symbol: 'TRUMPUSDT', label: 'TRUMP-USDT', exchange: 'Binance' },
  { symbol: 'WLDUSDT', label: 'WLD-USDT', exchange: 'Binance' },
]

// ─── Server-side cache ─────────────────────────────────────────────────────

interface CachedScan {
  timestamp: number
  anomalies: any[]
  bookSnapshots: Record<string, OrderBookData>
}

let cachedScan: CachedScan | null = null
const CACHE_TTL = 5_000 // 5 seconds — anomalies need fresh data

// ─── Previous snapshot for wall-vanished detection ─────────────────────────

let previousBooks: Record<string, OrderBookData> = {}

// ─── Anomaly Detection Logic ───────────────────────────────────────────────

interface DetectedAnomaly {
  id: string
  pair: string
  category: 'AGGRESSIVE_ABSORPTION' | 'RETAIL_NOISE'
  tag: 'ABSORB' | 'NOISE'
  sizeUsd: number
  imbalance: number
  timestamp: number
  side: 'BID' | 'ASK'
  exchange: string
  details: string
}

let anomalySeq = 0

function detectAnomalies(
  ob: OrderBookData,
  trades: ReturnType<typeof classifyTrades>,
  prevOb: OrderBookData | undefined,
  pairLabel: string,
  exchange: string,
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = []
  const imbalance = calculateImbalance(ob)
  const walls = detectWalls(ob, 4) // 4x average = wall
  const now = Date.now()

  // ─── 1. AGGRESSIVE ABSORPTION ──────────────────────────────────────────
  // Large aggressive buy/sell volume but price doesn't move much.
  // This means hidden limit orders are absorbing the market orders.
  const totalAggressive = trades.aggressiveBuyVolume + trades.aggressiveSellVolume
  const dominantSide = trades.aggressiveBuyVolume > trades.aggressiveSellVolume ? 'BID' : 'ASK'
  const dominantVolume = Math.max(trades.aggressiveBuyVolume, trades.aggressiveSellVolume)
  const volumeRatio = totalAggressive > 0 ? dominantVolume / totalAggressive : 0.5

  // Absorption: high volume asymmetry + order book walls on the absorbing side
  if (totalAggressive > 50_000 && volumeRatio > 0.7) {
    const absorbingWalls = walls.filter(w => w.side === dominantSide)
    if (absorbingWalls.length > 0 || Math.abs(imbalance) > 30) {
      const largestWall = absorbingWalls[0]
      anomalies.push({
        id: `real-${++anomalySeq}`,
        pair: pairLabel,
        category: 'AGGRESSIVE_ABSORPTION',
        tag: 'ABSORB',
        sizeUsd: dominantVolume,
        imbalance: Math.round(imbalance),
        timestamp: now,
        side: dominantSide,
        exchange,
        details: `${dominantSide === 'BID' ? 'Buy' : 'Sell'} pressure ${volumeRatio.toFixed(0)}% · ${largestWall ? `wall $${(largestWall.valueUsd / 1000).toFixed(0)}K at ${largestWall.price}` : `imbalance ${imbalance.toFixed(0)}%`}`,
      })
    }
  }

  // ─── 2. RETAIL NOISE ──────────────────────────────────────────────────
  // Small trades, balanced volume, no significant walls
  if (totalAggressive < 50_000 && walls.length === 0 && Math.abs(imbalance) < 20) {
    anomalies.push({
      id: `real-${++anomalySeq}`,
      pair: pairLabel,
      category: 'RETAIL_NOISE',
      tag: 'NOISE',
      sizeUsd: totalAggressive,
      imbalance: Math.round(imbalance),
      timestamp: now,
      side: imbalance >= 0 ? 'BID' : 'ASK',
      exchange,
      details: `Small flow · balanced · avg trade $${trades.avgTradeSize.toFixed(0)}`,
    })
  }

  return anomalies
}

// ─── GET Handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 20, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    // Return cached if fresh
    if (cachedScan && Date.now() - cachedScan.timestamp < CACHE_TTL) {
      return NextResponse.json({
        anomalies: cachedScan.anomalies,
        bookSnapshots: cachedScan.bookSnapshots,
        cached: true,
        timestamp: cachedScan.timestamp,
      })
    }

    // ─── Fetch data for all pairs in parallel ─────────────────────────────
    const results = await Promise.allSettled(
      SCAN_PAIRS.map(async (pair) => {
        const [ob, tradesRaw, ticker] = await Promise.all([
          fetchSpotOrderBook(pair.symbol, 20),
          fetchSpotAggTrades(pair.symbol, 50),
          fetchSpotTicker(pair.symbol).catch(() => null),
        ])
        const trades = classifyTrades(tradesRaw)
        return { pair, ob, trades, ticker }
      })
    )

    // ─── Detect anomalies for each pair ───────────────────────────────────
    const allAnomalies: DetectedAnomaly[] = []
    const newSnapshots: Record<string, OrderBookData> = {}

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const { pair, ob, trades } = result.value
      const prevOb = previousBooks[pair.symbol]

      const pairAnomalies = detectAnomalies(ob, trades, prevOb, pair.label, pair.exchange)
      allAnomalies.push(...pairAnomalies)

      // Store current book for next comparison
      newSnapshots[pair.symbol] = ob
    }

    // Update previous books for wall-vanished detection
    previousBooks = newSnapshots

    // Sort by size (most significant first)
    allAnomalies.sort((a, b) => b.sizeUsd - a.sizeUsd)

    // Cache
    cachedScan = {
      timestamp: Date.now(),
      anomalies: allAnomalies,
      bookSnapshots: newSnapshots,
    }

    return NextResponse.json({
      anomalies: allAnomalies,
      bookSnapshots: Object.fromEntries(
        Object.entries(newSnapshots).map(([k, v]) => [k, {
          symbol: v.symbol,
          imbalance: Math.round(calculateImbalance(v)),
          bidTotal: v.bids.reduce((s, b) => s + b.quantity * b.price, 0),
          askTotal: v.asks.reduce((s, a) => s + a.quantity * a.price, 0),
          topBid: v.bids[0]?.price || 0,
          topAsk: v.asks[0]?.price || 0,
        }])
      ),
      cached: false,
      timestamp: cachedScan.timestamp,
    })
  } catch (error) {
    console.error('[/api/cex-anomaly/scan] error:', error)
    // Return stale cache if available
    if (cachedScan) {
      return NextResponse.json({
        anomalies: cachedScan.anomalies,
        bookSnapshots: cachedScan.bookSnapshots,
        cached: true,
        stale: true,
        timestamp: cachedScan.timestamp,
      })
    }
    return NextResponse.json(
      { error: 'Błąd pobierania danych z Binance', anomalies: [] },
      { status: 502 }
    )
  }
}
