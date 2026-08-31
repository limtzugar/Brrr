// ─── CCXT Cross-Exchange Depth API ─────────────────────────────────────────
// GET /api/ccxt/multi-depth?symbol=BTC-USDT
// Fetches orderbook depth from Binance + Bybit + OKX simultaneously
// Detects cross-exchange wall anomalies: a wall on one exchange absent on others
//
// Key insight: OKX returns orderbook quantities in CONTRACTS, not coins.
// For BTC-USDT SWAP: 1 contract = 0.01 BTC, so we must multiply qty × contractSize
// to get the actual coin amount, then × price for USD value.
// Binance and Bybit return quantities in coins directly.

import { NextRequest, NextResponse } from 'next/server'
import { SCORING } from '@/lib/cex-anomaly-constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ─── Cross-Exchange Wall Ratio (imported from shared constants) ───
const CROSS_EXCHANGE_WALL_RATIO = SCORING.CROSS_EXCHANGE_WALL_RATIO

// ─── CCXT Instances (lazy-loaded) ──────────────────────────────────────
let ccxtModule: any = null
const exchangeInstances: Record<string, any> = {}

async function getCCXT() {
  if (!ccxtModule) {
    ccxtModule = await import('ccxt')
  }
  return ccxtModule
}

async function getExchange(id: string) {
  if (exchangeInstances[id]) return exchangeInstances[id]

  const ccxt = await getCCXT()
  const config: any = {
    enableRateLimit: true,
  }

  switch (id) {
    case 'bybit':
      config.options = { defaultType: 'swap' }
      break
    case 'okx':
      // OKX default is fine
      break
    case 'mexc':
      config.options = { defaultType: 'swap' }
      break
  }

  const exchange = new ccxt[id](config)
  await exchange.loadMarkets()
  exchangeInstances[id] = exchange
  return exchange
}

// ─── Symbol mapping ──────────────────────────────────────────────────────
function findCCXTSymbol(exchange: any, ourSymbol: string): { symbol: string; contractSize: number } | null {
  const [base, quote] = ourSymbol.split('-')

  // Try USDT-margined perpetual first
  const perpSymbol = `${base}/${quote}:${quote}`
  if (exchange.markets[perpSymbol]) {
    const market = exchange.markets[perpSymbol]
    return {
      symbol: perpSymbol,
      contractSize: market.contractSize ?? 1, // Default 1 for spot-like (Binance/Bybit)
    }
  }

  // Try linear swap
  const swapSymbol = `${base}/${quote}`
  if (exchange.markets[swapSymbol]?.linear) {
    const market = exchange.markets[swapSymbol]
    return {
      symbol: swapSymbol,
      contractSize: market.contractSize ?? 1,
    }
  }

  // Try any matching symbol
  const match = Object.keys(exchange.markets).find(s =>
    s.startsWith(`${base}/`) && exchange.markets[s].quote === quote && exchange.markets[s].linear
  )
  if (match) {
    const market = exchange.markets[match]
    return {
      symbol: match,
      contractSize: market.contractSize ?? 1,
    }
  }

  return null
}

// ─── Cross-Exchange Wall Anomaly Detection (imported from shared constants) ───

interface DepthAnalysis {
  exchange: string
  symbol: string
  bestBid: number
  bestAsk: number
  spread: number
  bidDepth5: number     // USD
  askDepth5: number     // USD
  bidWallSize: number   // USD
  askWallSize: number   // USD
  bidWallPrice: number
  askWallPrice: number
  contractSize: number
}

function analyzeDepth(
  exchangeId: string,
  symbol: string,
  orderbook: any,
  contractSize: number
): DepthAnalysis {
  const bids = orderbook.bids || []
  const asks = orderbook.asks || []
  const cs = contractSize || 1

  const bestBid = bids[0]?.[0] ?? 0
  const bestAsk = asks[0]?.[0] ?? 0
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0

  // Top-5 depth in USD (qty × contractSize × price)
  let bidDepth5 = 0
  let askDepth5 = 0
  for (let i = 0; i < Math.min(5, bids.length); i++) {
    bidDepth5 += bids[i][0] * bids[i][1] * cs  // price × qty × contractSize
  }
  for (let i = 0; i < Math.min(5, asks.length); i++) {
    askDepth5 += asks[i][0] * asks[i][1] * cs
  }

  // Largest wall in top 20 levels (USD)
  let bidWallSize = 0
  let askWallSize = 0
  let bidWallPrice = 0
  let askWallPrice = 0

  for (let i = 0; i < Math.min(20, bids.length); i++) {
    const wallUsd = bids[i][0] * bids[i][1] * cs
    if (wallUsd > bidWallSize) {
      bidWallSize = wallUsd
      bidWallPrice = bids[i][0]
    }
  }
  for (let i = 0; i < Math.min(20, asks.length); i++) {
    const wallUsd = asks[i][0] * asks[i][1] * cs
    if (wallUsd > askWallSize) {
      askWallSize = wallUsd
      askWallPrice = asks[i][0]
    }
  }

  return {
    exchange: exchangeId,
    symbol,
    bestBid,
    bestAsk,
    spread,
    bidDepth5,
    askDepth5,
    bidWallSize,
    askWallSize,
    bidWallPrice,
    askWallPrice,
    contractSize: cs,
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────
const depthCache: Record<string, { timestamp: number; data: any }> = {}
const DEPTH_CACHE_TTL = 10_000 // 10 seconds

// Prune stale depth cache entries every 30s
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const key of Object.keys(depthCache)) {
      if (now - depthCache[key].timestamp > DEPTH_CACHE_TTL * 3) {
        delete depthCache[key]
      }
    }
  }, 30_000)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const pair = searchParams.get('symbol') || 'BTC-USDT'

    // Check cache
    const cacheKey = pair
    const cached = depthCache[cacheKey]
    if (cached && Date.now() - cached.timestamp < DEPTH_CACHE_TTL) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
      })
    }

    // ── Fetch depth from Bybit + OKX + MEXC in parallel ──
    // Binance removed — MiCA restricted in EU
    const exchangeIds = ['bybit', 'okx', 'mexc']
    const depthPromises = exchangeIds.map(async (id) => {
      try {
        const exchange = await getExchange(id)
        const found = findCCXTSymbol(exchange, pair)
        if (!found) return null

        const orderbook = await exchange.fetchOrderBook(found.symbol, 20)
        return analyzeDepth(id, found.symbol, orderbook, found.contractSize)
      } catch (err: any) {
        console.warn(`[multi-depth] ${id} failed:`, err.message)
        return null
      }
    })

    const results = await Promise.allSettled(depthPromises)
    const depths = results
      .map(r => r.status === 'fulfilled' && r.value ? r.value : null)
      .filter(Boolean) as DepthAnalysis[]

    if (depths.length < 2) {
      return NextResponse.json({
        error: 'Need at least 2 exchanges for cross-comparison',
        pair,
        depths,
        wallAnomalyDetected: false,
        wallAnomalySide: null,
        wallAnomalyExchange: null,
        wallAnomalySize: 0,
        wallAnomalyRatio: 0,
        fetchedAt: Date.now(),
      }, { status: 200 })
    }

    // ── Cross-exchange wall anomaly detection ──
    let wallAnomalyDetected = false
    let wallAnomalySide: 'BID' | 'ASK' | null = null
    let wallAnomalyExchange: string | null = null
    let wallAnomalySize = 0
    let wallAnomalyRatio = 0

    // Check BID walls
    const bidWalls = depths.map(d => ({ exchange: d.exchange, size: d.bidWallSize }))
    for (const bw of bidWalls) {
      const othersAvg = bidWalls
        .filter(w => w.exchange !== bw.exchange)
        .reduce((sum, w) => sum + w.size, 0) / Math.max(1, bidWalls.length - 1)

      if (othersAvg > 0 && bw.size / othersAvg >= CROSS_EXCHANGE_WALL_RATIO && bw.size > 100_000) {
        wallAnomalyDetected = true
        wallAnomalySide = 'BID'
        wallAnomalyExchange = bw.exchange
        wallAnomalySize = bw.size
        wallAnomalyRatio = bw.size / othersAvg
        break
      }
    }

    // Check ASK walls
    if (!wallAnomalyDetected) {
      const askWalls = depths.map(d => ({ exchange: d.exchange, size: d.askWallSize }))
      for (const aw of askWalls) {
        const othersAvg = askWalls
          .filter(w => w.exchange !== aw.exchange)
          .reduce((sum, w) => sum + w.size, 0) / Math.max(1, askWalls.length - 1)

        if (othersAvg > 0 && aw.size / othersAvg >= CROSS_EXCHANGE_WALL_RATIO && aw.size > 100_000) {
          wallAnomalyDetected = true
          wallAnomalySide = 'ASK'
          wallAnomalyExchange = aw.exchange
          wallAnomalySize = aw.size
          wallAnomalyRatio = aw.size / othersAvg
          break
        }
      }
    }

    const response = {
      pair,
      depths,
      wallAnomalyDetected,
      wallAnomalySide,
      wallAnomalyExchange,
      wallAnomalySize,
      wallAnomalyRatio,
      fetchedAt: Date.now(),
    }

    // Update cache
    depthCache[cacheKey] = { timestamp: Date.now(), data: response }

    return NextResponse.json({
      ...response,
      cached: false,
      source: 'ccxt-multi-exchange',
    })
  } catch (error: any) {
    console.error('[/api/ccxt/multi-depth] error:', error.message)
    const { searchParams: sp } = new URL(request.url)
    return NextResponse.json({
      error: `CCXT error: ${error.message}`,
      pair: sp.get('symbol') || 'BTC-USDT',
      depths: [],
      wallAnomalyDetected: false,
      wallAnomalySide: null,
      wallAnomalyExchange: null,
      wallAnomalySize: 0,
      wallAnomalyRatio: 0,
      fetchedAt: Date.now(),
    }, { status: 502 })
  }
}
