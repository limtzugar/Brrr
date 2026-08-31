// ─── Binance Public API Client (No Auth) ────────────────────────────────────
// Public endpoints: order book, trades, ticker, funding rate, open interest.
// No API key required — used for CEX Anomaly detection.

const SPOT_BASE = 'https://api.binance.com'
const FUTURES_BASE = 'https://fapi.binance.com'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number
  quantity: number
}

export interface OrderBookData {
  symbol: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: number
}

export interface AggTrade {
  id: number
  price: number
  quantity: number
  timestamp: number
  isBuyerMaker: boolean  // true = sell order filled (aggressive buy hit the ask)
}

export interface TickerData {
  symbol: string
  lastPrice: number
  volume24h: number
  quoteVolume24h: number
  priceChangePercent24h: number
  high24h: number
  low24h: number
  weightedAvgPrice: number
}

export interface FundingRateData {
  symbol: string
  fundingRate: number
  fundingTime: number
  markPrice: number
}

export interface OpenInterestData {
  symbol: string
  openInterest: number
  time: number
}

// ─── Rate-limit-aware fetch ─────────────────────────────────────────────────

const requestTimestamps: number[] = []
const MAX_REQUESTS_PER_MINUTE = 1000

async function publicFetch(url: string, retries = 3): Promise<unknown> {
  // Simple rate limiter
  const now = Date.now()
  const recent = requestTimestamps.filter(t => now - t < 60_000)
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    const waitMs = 60_000 - (now - recent[0]) + 100
    console.warn(`[BinancePublic] Rate limit approaching, waiting ${waitMs}ms`)
    await new Promise(r => setTimeout(r, waitMs))
  }
  requestTimestamps.push(now)

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10) * 1000
        console.warn(`[BinancePublic] 429 rate limited, waiting ${retryAfter}ms`)
        await new Promise(r => setTimeout(r, retryAfter))
        continue
      }

      if (res.status === 418) {
        console.error('[BinancePublic] IP banned (418)')
        throw new Error('Binance IP temporarily banned')
      }

      if (!res.ok) {
        throw new Error(`Binance API ${res.status}: ${res.statusText}`)
      }

      return await res.json()
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error('Binance public: exhausted retries')
}

// ─── Public Endpoints ──────────────────────────────────────────────────────

/** Spot order book depth (limit: 5, 10, 20, 50, 100) */
export async function fetchSpotOrderBook(symbol: string, limit = 20): Promise<OrderBookData> {
  const url = `${SPOT_BASE}/api/v3/depth?symbol=${symbol}&limit=${limit}`
  const data = (await publicFetch(url)) as any

  return {
    symbol,
    bids: (data.bids || []).map((b: string[]) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
    asks: (data.asks || []).map((a: string[]) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
    timestamp: Date.now(),
  }
}

/** Futures order book depth */
export async function fetchFuturesOrderBook(symbol: string, limit = 20): Promise<OrderBookData> {
  const url = `${FUTURES_BASE}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`
  const data = (await publicFetch(url)) as any

  return {
    symbol,
    bids: (data.bids || []).map((b: string[]) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
    asks: (data.asks || []).map((a: string[]) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
    timestamp: Date.now(),
  }
}

/** Recent aggTrades (spot) */
export async function fetchSpotAggTrades(symbol: string, limit = 50): Promise<AggTrade[]> {
  const url = `${SPOT_BASE}/api/v3/aggTrades?symbol=${symbol}&limit=${limit}`
  const data = (await publicFetch(url)) as any[]

  return (data || []).map(t => ({
    id: t.a,
    price: Number(t.p),
    quantity: Number(t.q),
    timestamp: t.T,
    isBuyerMaker: t.m,
  }))
}

/** 24h ticker (spot) */
export async function fetchSpotTicker(symbol: string): Promise<TickerData> {
  const url = `${SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`
  const data = (await publicFetch(url)) as any

  return {
    symbol: data.symbol,
    lastPrice: Number(data.lastPrice || 0),
    volume24h: Number(data.volume || 0),
    quoteVolume24h: Number(data.quoteVolume || 0),
    priceChangePercent24h: Number(data.priceChangePercent || 0),
    high24h: Number(data.highPrice || 0),
    low24h: Number(data.lowPrice || 0),
    weightedAvgPrice: Number(data.weightedAvgPrice || 0),
  }
}

/** Futures funding rate + mark price */
export async function fetchFundingRate(symbol: string): Promise<FundingRateData> {
  const url = `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`
  const data = (await publicFetch(url)) as any

  return {
    symbol: data.symbol,
    fundingRate: Number(data.lastFundingRate || 0),
    fundingTime: Number(data.nextFundingTime || 0),
    markPrice: Number(data.markPrice || 0),
  }
}

/** Futures open interest */
export async function fetchOpenInterest(symbol: string): Promise<OpenInterestData> {
  const url = `${FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`
  const data = (await publicFetch(url)) as any

  return {
    symbol: data.symbol,
    openInterest: Number(data.openInterest || 0),
    time: Date.now(),
  }
}

/** Best bid/ask (spot bookTicker) */
export async function fetchBookTicker(symbol: string): Promise<{ bidPrice: number; bidQty: number; askPrice: number; askQty: number }> {
  const url = `${SPOT_BASE}/api/v3/ticker/bookTicker?symbol=${symbol}`
  const data = (await publicFetch(url)) as any
  return {
    bidPrice: Number(data.bidPrice || 0),
    bidQty: Number(data.bidQty || 0),
    askPrice: Number(data.askPrice || 0),
    askQty: Number(data.askQty || 0),
  }
}

// ─── Anomaly Detection Helpers ──────────────────────────────────────────────

/** Calculate bid/ask imbalance percentage */
export function calculateImbalance(ob: OrderBookData): number {
  const totalBid = ob.bids.reduce((s, b) => s + b.quantity * b.price, 0)
  const totalAsk = ob.asks.reduce((s, a) => s + a.quantity * a.price, 0)
  if (totalBid + totalAsk === 0) return 0
  return ((totalBid - totalAsk) / (totalBid + totalAsk)) * 200 // -100 to +100
}

/** Detect large walls in order book (potential absorption or wall anomaly) */
export function detectWalls(ob: OrderBookData, thresholdMultiplier = 5): Array<{ side: 'BID' | 'ASK'; price: number; quantity: number; valueUsd: number; ratio: number }> {
  const avgBidQty = ob.bids.reduce((s, b) => s + b.quantity, 0) / (ob.bids.length || 1)
  const avgAskQty = ob.asks.reduce((s, a) => s + a.quantity, 0) / (ob.asks.length || 1)

  const walls: Array<{ side: 'BID' | 'ASK'; price: number; quantity: number; valueUsd: number; ratio: number }> = []

  for (const bid of ob.bids) {
    if (bid.quantity >= avgBidQty * thresholdMultiplier) {
      walls.push({
        side: 'BID',
        price: bid.price,
        quantity: bid.quantity,
        valueUsd: bid.quantity * bid.price,
        ratio: bid.quantity / avgBidQty,
      })
    }
  }

  for (const ask of ob.asks) {
    if (ask.quantity >= avgAskQty * thresholdMultiplier) {
      walls.push({
        side: 'ASK',
        price: ask.price,
        quantity: ask.quantity,
        valueUsd: ask.quantity * ask.price,
        ratio: ask.quantity / avgAskQty,
      })
    }
  }

  return walls.sort((a, b) => b.ratio - a.ratio)
}

/** Classify trades into aggressive buys vs sells */
export function classifyTrades(trades: AggTrade[]): {
  aggressiveBuyVolume: number
  aggressiveSellVolume: number
  tradeCount: number
  avgTradeSize: number
  largeTrades: AggTrade[]
} {
  let aggressiveBuyVolume = 0
  let aggressiveSellVolume = 0
  const sizes: number[] = []
  const largeTrades: AggTrade[] = []

  for (const t of trades) {
    const value = t.price * t.quantity
    sizes.push(value)

    // isBuyerMaker=true means the trade was initiated by a seller (aggressive sell)
    // isBuyerMaker=false means the trade was initiated by a buyer (aggressive buy)
    if (t.isBuyerMaker) {
      aggressiveSellVolume += value
    } else {
      aggressiveBuyVolume += value
    }

    // Large trade = >2x average
    if (value > 0) largeTrades.push(t)
  }

  const avgTradeSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0
  const largeThreshold = avgTradeSize * 3

  return {
    aggressiveBuyVolume,
    aggressiveSellVolume,
    tradeCount: trades.length,
    avgTradeSize,
    largeTrades: largeTrades.filter(t => t.price * t.quantity >= largeThreshold),
  }
}
