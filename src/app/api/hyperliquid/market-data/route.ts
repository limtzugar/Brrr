// ─── Hyperliquid Market Data API ────────────────────────────────────────────
// GET /api/hyperliquid/market-data
// Fetches real-time perpetuals data from Hyperliquid's public API (no key needed).
//
// Data sources:
//   1. metaAndAssetCtxs → mark price, funding rate, OI, volume (all perps)
//   2. l2Book per pair   → L2 orderbook depth for ICEBERG/ABSORPTION detection
//
// Signal detection:
//   - OI_SPIKE:          OI change > threshold between polls
//   - FUNDING_EXTREME:   |funding rate| > threshold
//   - ICEBERG_DETECTED:  L2 level with huge size but few orders (hidden liquidity)
//   - AGGRESSIVE_ABSORPTION: L2 wall disproportionally large vs neighbors
//   - LIQUIDATION_CASCADE: OI drop + volume spike + extreme funding (proxy)
//
// Hyperliquid is NOT MiCA restricted — works in EU, fully public, no auth.

import { NextRequest, NextResponse } from 'next/server'
import { SCORING } from '@/lib/cex-anomaly-constants'

export const dynamic = 'force-dynamic'

const HL_API = 'https://api.hyperliquid.xyz'

// ─── Thresholds (shared with constants where possible) ────────────────────
const OI_SPIKE_THRESHOLD_PCT = SCORING.OI_SPIKE_THRESHOLD_PCT    // 5%
const FUNDING_EXTREME_THRESHOLD = SCORING.FUNDING_EXTREME_THRESHOLD // 0.001 = 0.1%

// L2-specific thresholds for ICEBERG detection
const ICEBERG_MIN_SIZE_USD = 200_000      // Level must be >= $200K
const ICEBERG_MAX_ORDERS = 3              // ≤3 orders at that level = suspicious
const ICEBERG_RATIO = 15                  // Size/order ratio > 15x average = iceberg

// L2-specific thresholds for ABSORPTION detection
const ABSORPTION_MIN_SIZE_USD = 300_000   // Wall must be >= $300K
const ABSORPTION_DOMINANCE_RATIO = 5      // Wall must be ≥5x larger than neighbor avg

// Cascade proxy thresholds (no direct liquidation feed, use OI+funding combo)
// BUG FIX: Old CASCADE_VOLUME_SPIKE used 24h rolling volume ratio between 15s snapshots
// → ratio always ≈1.0x, never reaching 3x. Cascade proxy was permanently dead.
// New approach: OI drop + extreme funding = cascade. OI drop = force-closes,
// extreme funding = one side crowded. More reliable than volume metric.
const CASCADE_OI_DROP_PCT = 3             // OI drops ≥3% = positions closing en masse
const CASCADE_FUNDING_THRESHOLD = 0.0005  // |funding| ≥ 0.05% = one side crowded

// ─── Symbol mapping: our format → Hyperliquid format ─────────────────────
const PAIR_MAP: { our: string; hl: string }[] = [
  { our: 'BTC-USDT',  hl: 'BTC' },
  { our: 'ETH-USDT',  hl: 'ETH' },
  { our: 'SOL-USDT',  hl: 'SOL' },
  { our: 'BNB-USDT',  hl: 'BNB' },
  { our: 'XRP-USDT',  hl: 'XRP' },
  { our: 'DOGE-USDT', hl: 'DOGE' },
  { our: 'ADA-USDT',  hl: 'ADA' },
  { our: 'FIL-USDT',  hl: 'FIL' },
  { our: 'SUI-USDT',  hl: 'SUI' },
  { our: 'PEPE-USDT', hl: 'kPEPE' },
  { our: 'FET-USDT',  hl: 'FET' },
  { our: 'ICP-USDT',  hl: 'ICP' },
  { our: 'TAO-USDT',  hl: 'TAO' },
  { our: 'ZEC-USDT',  hl: 'ZEC' },
  { our: 'INJ-USDT', hl: 'INJ' },
  { our: 'TON-USDT', hl: 'TON' },
  { our: 'HYPE-USDT', hl: 'HYPE' },
  { our: 'DASH-USDT', hl: 'DASH' },
  { our: 'ASTER-USDT', hl: 'ASTER' },
]

const OUR_TO_HL = Object.fromEntries(PAIR_MAP.map(p => [p.our, p.hl]))
const HL_TO_OUR = Object.fromEntries(PAIR_MAP.map(p => [p.hl, p.our]))

// ─── Cache ──────────────────────────────────────────────────────────────
interface CachedSnapshot {
  timestamp: number
  oiByPair: Record<string, number>
  volumeByPair: Record<string, number>
}

let cachedSnapshot: CachedSnapshot = { timestamp: 0, oiByPair: {}, volumeByPair: {} }

let cachedResult: {
  timestamp: number
  oiSpikes: any[]
  fundingExtreme: any[]
  icebergDetected: any[]
  aggressiveAbsorption: any[]
  cascadeProxy: any[]
  marketData: Record<string, any>
  source: string
  activePairs: number
} | null = null

const CACHE_TTL = 15_000 // 15s

// ─── Fetch metaAndAssetCtxs ────────────────────────────────────────────
async function fetchMarketData(): Promise<{
  universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[]
  contexts: any[]
}> {
  const res = await fetch(HL_API + '/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HL API: ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data) || data.length < 2) throw new Error('Invalid HL response')
  return { universe: data[0].universe || [], contexts: data[1] || [] }
}

// ─── Fetch L2 Book ────────────────────────────────────────────────────
interface L2Level { px: string; sz: string; n: number }
interface L2Book { coin: string; levels: [L2Level[], L2Level[]] }

async function fetchL2Book(coin: string): Promise<L2Book | null> {
  try {
    const res = await fetch(HL_API + '/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'l2Book', coin }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function fetchAllL2Books(hlCoins: string[]): Promise<Map<string, L2Book>> {
  const results = new Map<string, L2Book>()
  const batchSize = 5
  for (let i = 0; i < hlCoins.length; i += batchSize) {
    const batch = hlCoins.slice(i, i + batchSize)
    const promises = batch.map(async (coin) => {
      const book = await fetchL2Book(coin)
      if (book) results.set(coin, book)
    })
    await Promise.allSettled(promises)
  }
  return results
}

// ─── Detect ICEBERG from L2 book ────────────────────────────────────────
function detectIcebergs(book: L2Book, pair: string) {
  const signals: any[] = []
  const markPrice = parseFloat(book.levels[0][0]?.px || '0') || parseFloat(book.levels[1][0]?.px || '0')
  if (markPrice === 0) return signals

  let totalSizeUsd = 0
  let totalOrders = 0
  for (const side of book.levels) {
    for (const level of side) {
      totalSizeUsd += parseFloat(level.px) * parseFloat(level.sz)
      totalOrders += level.n
    }
  }
  if (totalOrders === 0) return signals
  const avgOrderSizeUsd = totalSizeUsd / totalOrders

  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const side = sideIdx === 0 ? 'BID' : 'ASK'
    for (const level of book.levels[sideIdx]) {
      const px = parseFloat(level.px)
      const sz = parseFloat(level.sz)
      const sizeUsd = px * sz

      if (sizeUsd < ICEBERG_MIN_SIZE_USD) continue
      if (level.n > ICEBERG_MAX_ORDERS) continue

      const levelAvgSize = sizeUsd / level.n
      const ratioToAvg = avgOrderSizeUsd > 0 ? levelAvgSize / avgOrderSizeUsd : 0

      if (ratioToAvg >= ICEBERG_RATIO) {
        signals.push({ pair, side, price: px, sizeUsd, orderCount: level.n, avgOrderSizeUsd: levelAvgSize, ratioToAvg })
      }
    }
  }
  return signals
}

// ─── Detect ABSORPTION from L2 book ─────────────────────────────────────
function detectAbsorption(book: L2Book, pair: string) {
  const signals: any[] = []
  const bestBid = parseFloat(book.levels[0][0]?.px || '0')
  const bestAsk = parseFloat(book.levels[1][0]?.px || '0')
  if (bestBid === 0 || bestAsk === 0) return signals
  const midPrice = (bestBid + bestAsk) / 2
  const maxDistance = midPrice * 0.002 // within 0.2% of mid

  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const side = sideIdx === 0 ? 'BID' : 'ASK'
    for (const level of book.levels[sideIdx]) {
      const px = parseFloat(level.px)
      const sz = parseFloat(level.sz)
      const sizeUsd = px * sz

      if (sizeUsd < ABSORPTION_MIN_SIZE_USD) continue
      if (Math.abs(px - midPrice) > maxDistance) continue

      // Compare to neighboring levels
      const neighborSizes = book.levels[sideIdx]
        .filter(l => Math.abs(parseFloat(l.px) - px) <= midPrice * 0.001)
        .map(l => parseFloat(l.px) * parseFloat(l.sz))
      const avgNeighbor = neighborSizes.length > 1
        ? (neighborSizes.reduce((a: number, b: number) => a + b, 0) - sizeUsd) / (neighborSizes.length - 1)
        : 0

      if (avgNeighbor > 0 && sizeUsd / avgNeighbor >= ABSORPTION_DOMINANCE_RATIO) {
        signals.push({ pair, side, price: px, wallSizeUsd: sizeUsd, consumedPct: 0, priceMovePct: 0 })
      }
    }
  }
  return signals
}

// ─── Main handler ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return NextResponse.json({ ...cachedResult, cached: true })
    }

    // Fetch market data
    const { universe, contexts } = await fetchMarketData()
    const coinIndex = new Map<string, number>()
    for (let i = 0; i < universe.length; i++) {
      if (!universe[i].isDelisted) coinIndex.set(universe[i].name, i)
    }

    // Parse for tracked pairs
    const marketData: Record<string, any> = {}
    const activeHlCoins: string[] = []
    for (const [ourSymbol, hlCoin] of Object.entries(OUR_TO_HL)) {
      const idx = coinIndex.get(hlCoin)
      if (idx === undefined) continue
      const ctx = contexts[idx]
      if (!ctx) continue
      const markPx = parseFloat(ctx.markPx) || 0
      const oi = parseFloat(ctx.openInterest) || 0
      if (markPx === 0 && oi === 0) continue

      marketData[ourSymbol] = {
        pair: ourSymbol, hlName: hlCoin,
        markPrice: markPx, oraclePrice: parseFloat(ctx.oraclePx) || markPx,
        midPrice: parseFloat(ctx.midPx) || markPx,
        fundingRate: parseFloat(ctx.fundingRate) || 0,
        openInterest: oi, openInterestUsd: markPx * oi,
        prevDayPrice: parseFloat(ctx.prevDayPx) || markPx,
        dayVolume: parseFloat(ctx.dayNtlVlm) || 0,
        premium: parseFloat(ctx.premium) || 0,
      }
      activeHlCoins.push(hlCoin)
    }

    // Detect OI Spikes
    const oiSpikes: any[] = []
    for (const [pair, data] of Object.entries(marketData)) {
      const d = data as any
      const prevOI = cachedSnapshot.oiByPair[pair]
      if (prevOI && prevOI > 0 && d.openInterestUsd > 0) {
        const changePct = ((d.openInterestUsd - prevOI) / prevOI) * 100
        if (Math.abs(changePct) >= OI_SPIKE_THRESHOLD_PCT) {
          oiSpikes.push({ pair, oiChangePct: changePct, currentOI: d.openInterestUsd, previousOI: prevOI, side: changePct > 0 ? 'BID' : 'ASK' })
        }
      }
    }

    // Detect Funding Extremes
    const fundingExtreme: any[] = []
    for (const [pair, data] of Object.entries(marketData)) {
      const d = data as any
      if (Math.abs(d.fundingRate) >= FUNDING_EXTREME_THRESHOLD) {
        fundingExtreme.push({ pair, fundingRate: d.fundingRate, markPrice: d.markPrice, side: d.fundingRate > 0 ? 'ASK' : 'BID' })
      }
    }

    // Detect Cascade Proxy (BUG FIX: replaced dead volume metric with funding)
    // Old: OI drop ≥3% + volSpike ≥3x → volSpike never fired (24h rolling vol ≈1.0x between 15s)
    // New: OI drop ≥3% + |funding| ≥ 0.05% → OI closing + crowded side = cascade
    const cascadeProxy: any[] = []
    for (const [pair, data] of Object.entries(marketData)) {
      const d = data as any
      const prevOI = cachedSnapshot.oiByPair[pair]
      if (!prevOI) continue
      const oiChangePct = prevOI > 0 ? ((d.openInterestUsd - prevOI) / prevOI) * 100 : 0
      // Cascade: OI dropping = positions being force-closed (liquidations)
      // + funding extreme = one side overcrowded (the side being liquidated)
      if (oiChangePct <= -CASCADE_OI_DROP_PCT && Math.abs(d.fundingRate) >= CASCADE_FUNDING_THRESHOLD) {
        cascadeProxy.push({ pair, side: oiChangePct < 0 ? 'ASK' : 'BID', oiDropPct: Math.abs(oiChangePct), fundingRate: d.fundingRate })
      }
    }

    // Fetch L2 books + detect ICEBERG + ABSORPTION
    const icebergDetected: any[] = []
    const aggressiveAbsorption: any[] = []
    const l2Books = await fetchAllL2Books(activeHlCoins)
    for (const [hlCoin, book] of l2Books) {
      const ourPair = HL_TO_OUR[hlCoin]
      if (!ourPair) continue
      icebergDetected.push(...detectIcebergs(book, ourPair))
      aggressiveAbsorption.push(...detectAbsorption(book, ourPair))
    }

    // Update snapshot
    const newOiByPair: Record<string, number> = {}
    const newVolumeByPair: Record<string, number> = {}
    for (const [pair, data] of Object.entries(marketData)) {
      const d = data as any
      newOiByPair[pair] = d.openInterestUsd
      newVolumeByPair[pair] = d.dayVolume
    }
    cachedSnapshot = { timestamp: Date.now(), oiByPair: newOiByPair, volumeByPair: newVolumeByPair }

    const result = {
      timestamp: Date.now(), oiSpikes, fundingExtreme, icebergDetected, aggressiveAbsorption, cascadeProxy, marketData,
      source: 'hyperliquid-public', activePairs: Object.keys(marketData).length,
    }
    cachedResult = result as any

    return NextResponse.json({ ...result, cached: false })
  } catch (error: any) {
    console.error('[/api/hyperliquid/market-data] error:', error.message)
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult, cached: true, stale: true, error: error.message })
    }
    return NextResponse.json({
      error: `Hyperliquid API error: ${error.message}`,
      oiSpikes: [], fundingExtreme: [], icebergDetected: [], aggressiveAbsorption: [], cascadeProxy: [],
      marketData: {}, timestamp: Date.now(),
    }, { status: 502 })
  }
}
