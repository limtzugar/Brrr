// ─── Market Ticker API ────────────────────────────────────────────────────────
// GET: Fetch prices for Gold, NASDAQ, S&P 500, Silver, WIG20, PLN/USD
// Uses Yahoo Finance API (server-side, no CORS issues) with caching

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Cache for 60 seconds
let cachedData: {
  timestamp: number
  data: Record<string, { price: number; change: number; changePercent: number; symbol: string; name: string }>
} | null = null

const CACHE_TTL = 60_000 // 1 minute

// Yahoo Finance symbol mappings
const YAHOO_SYMBOLS: Record<string, { yahooSymbol: string; name: string; currency: string }> = {
  gold: { yahooSymbol: 'GC=F', name: 'Gold', currency: 'USD' },
  nasdaq: { yahooSymbol: '^IXIC', name: 'NASDAQ', currency: 'USD' },
  sp500: { yahooSymbol: '^GSPC', name: 'S&P 500', currency: 'USD' },
  silver: { yahooSymbol: 'SI=F', name: 'Srebro', currency: 'USD' },
  wig20: { yahooSymbol: '^WIG20', name: 'WIG20', currency: 'PLN' },
}

async function fetchYahooQuote(yahooSymbol: string): Promise<{ price: number; change: number; changePercent: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null

    const price = meta.regularMarketPrice
    const prevClose = meta.chartPreviousClose || meta.previousClose
    if (!price) return null

    const change = prevClose ? price - prevClose : 0
    const changePercent = prevClose ? (change / prevClose) * 100 : 0

    return { price, change, changePercent }
  } catch {
    return null
  }
}

async function fetchPlnUsdRate(): Promise<{ price: number; change: number; changePercent: number } | null> {
  try {
    const url = 'https://api.frankfurter.app/latest?from=USD&to=PLN'
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const rate = data?.rates?.PLN
    if (!rate) return null

    // Frankfurter doesn't give previous rate, so we fetch yesterday's too
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const ydStr = yesterday.toISOString().split('T')[0]
    const tdStr = today.toISOString().split('T')[0]

    try {
      const histUrl = `https://api.frankfurter.app/${ydStr}..${tdStr}?from=USD&to=PLN`
      const histRes = await fetch(histUrl, { signal: AbortSignal.timeout(8000) })
      if (histRes.ok) {
        const histData = await histRes.json()
        const dates = Object.keys(histData.rates || {}).sort()
        if (dates.length >= 2) {
          const prevRate = histData.rates[dates[0]]?.PLN
          if (prevRate) {
            const change = rate - prevRate
            const changePercent = (change / prevRate) * 100
            return { price: rate, change, changePercent }
          }
        }
      }
    } catch {}

    return { price: rate, change: 0, changePercent: 0 }
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 30, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    // Return cached data if still fresh
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return NextResponse.json({ tickers: cachedData.data, cached: true })
    }

    // Fetch all tickers in parallel
    const [goldData, nasdaqData, sp500Data, silverData, wig20Data, plnUsdData] = await Promise.all([
      fetchYahooQuote(YAHOO_SYMBOLS.gold.yahooSymbol),
      fetchYahooQuote(YAHOO_SYMBOLS.nasdaq.yahooSymbol),
      fetchYahooQuote(YAHOO_SYMBOLS.sp500.yahooSymbol),
      fetchYahooQuote(YAHOO_SYMBOLS.silver.yahooSymbol),
      fetchYahooQuote(YAHOO_SYMBOLS.wig20.yahooSymbol),
      fetchPlnUsdRate(),
    ])

    const result: Record<string, { price: number; change: number; changePercent: number; symbol: string; name: string }> = {}

    if (goldData) {
      result.gold = { ...goldData, symbol: 'XAU/USD', name: 'Gold' }
    }
    if (nasdaqData) {
      result.nasdaq = { ...nasdaqData, symbol: 'NASDAQ', name: 'NASDAQ' }
    }
    if (sp500Data) {
      result.sp500 = { ...sp500Data, symbol: 'S&P 500', name: 'S&P 500' }
    }
    if (silverData) {
      result.silver = { ...silverData, symbol: 'XAG/USD', name: 'Srebro' }
    }
    if (wig20Data) {
      result.wig20 = { ...wig20Data, symbol: 'WIG20', name: 'WIG20' }
    }
    if (plnUsdData) {
      result.plnUsd = { ...plnUsdData, symbol: 'PLN/USD', name: 'PLN/USD' }
    }

    // Update cache
    cachedData = { timestamp: Date.now(), data: result }

    return NextResponse.json({ tickers: result, cached: false })
  } catch (error) {
    console.error('[/api/market-ticker] error:', error)
    // Return stale cache if available
    if (cachedData) {
      return NextResponse.json({ tickers: cachedData.data, cached: true, stale: true })
    }
    return NextResponse.json(
      { error: 'Failed to fetch market rates', tickers: {} },
      { status: 500 }
    )
  }
}
