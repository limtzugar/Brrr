// ─── OI + Funding Rate API ────────────────────────────────────────────────
// GET /api/ccxt/oi-funding
// Fetches Open Interest and Funding Rate from Bybit public API (primary)
// with OKX fallback. No API keys needed — works in EU (MiCA-safe).
//
// Binance Futures fapi is MiCA-restricted → NOT used.
//
// Data flow:
//   1. Bybit v5/market/tickers (bulk) → mark price, funding rate, OI value
//   2. Bybit v5/market/open-interest per symbol → OI in contracts
//   3. If Bybit fails → OKX /api/v5/public/funding-rate + open-interest
//   4. Compares current OI vs cached previous OI to detect spikes
//   5. Flags funding rates exceeding FUNDING_EXTREME_THRESHOLD

import { NextRequest, NextResponse } from 'next/server'
import { SCORING } from '@/lib/cex-anomaly-constants'

export const dynamic = 'force-dynamic'

// ─── Thresholds (imported from shared constants — single source of truth) ───
const OI_SPIKE_THRESHOLD_PCT = SCORING.OI_SPIKE_THRESHOLD_PCT
const FUNDING_EXTREME_THRESHOLD = SCORING.FUNDING_EXTREME_THRESHOLD

// ─── OI Cache ──────────────────────────────────────────────────────────
let previousOI: Record<string, number> = {}
let cachedData: {
  timestamp: number
  data: Record<string, any>
  oiSpikes: string[]
  fundingExtreme: string[]
  source?: string
} | null = null
const CACHE_TTL = 30_000

// ─── Symbol mappings ──────────────────────────────────────────────────
// Our internal symbol format: BTC-USDT
// CCXT/Bybit format: BTCUSDT (for v5 API)
// OKX format: BTC-USDT-SWAP

const PAIRS = [
  { our: 'BTC-USDT', bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP', ccxt: 'BTC/USDT:USDT' },
  { our: 'ETH-USDT', bybit: 'ETHUSDT', okx: 'ETH-USDT-SWAP', ccxt: 'ETH/USDT:USDT' },
  { our: 'SOL-USDT', bybit: 'SOLUSDT', okx: 'SOL-USDT-SWAP', ccxt: 'SOL/USDT:USDT' },
  { our: 'BNB-USDT', bybit: 'BNBUSDT', okx: 'BNB-USDT-SWAP', ccxt: 'BNB/USDT:USDT' },
  { our: 'XRP-USDT', bybit: 'XRPUSDT', okx: 'XRP-USDT-SWAP', ccxt: 'XRP/USDT:USDT' },
  { our: 'DOGE-USDT', bybit: 'DOGEUSDT', okx: 'DOGE-USDT-SWAP', ccxt: 'DOGE/USDT:USDT' },
  { our: 'ADA-USDT', bybit: 'ADAUSDT', okx: 'ADA-USDT-SWAP', ccxt: 'ADA/USDT:USDT' },
  { our: 'LINK-USDT', bybit: 'LINKUSDT', okx: 'LINK-USDT-SWAP', ccxt: 'LINK/USDT:USDT' },
  { our: 'FIL-USDT', bybit: 'FILUSDT', okx: 'FIL-USDT-SWAP', ccxt: 'FIL/USDT:USDT' },
  { our: 'SUI-USDT', bybit: 'SUIUSDT', okx: 'SUI-USDT-SWAP', ccxt: 'SUI/USDT:USDT' },
  { our: 'PEPE-USDT', bybit: 'PEPEUSDT', okx: 'PEPE-USDT-SWAP', ccxt: 'PEPE/USDT:USDT' },
  { our: 'HYPE-USDT', bybit: 'HYPEUSDT', okx: 'HYPE-USDT-SWAP', ccxt: 'HYPE/USDT:USDT' },
  { our: 'FET-USDT', bybit: 'FETUSDT', okx: 'FET-USDT-SWAP', ccxt: 'FET/USDT:USDT' },
  { our: 'ICP-USDT', bybit: 'ICPUSDT', okx: 'ICP-USDT-SWAP', ccxt: 'ICP/USDT:USDT' },
  { our: 'TAO-USDT', bybit: 'TAOUSDT', okx: 'TAO-USDT-SWAP', ccxt: 'TAO/USDT:USDT' },
  { our: 'ZEC-USDT', bybit: 'ZECUSDT', okx: 'ZEC-USDT-SWAP', ccxt: 'ZEC/USDT:USDT' },
  { our: 'DASH-USDT', bybit: 'DASHUSDT', okx: 'DASH-USDT-SWAP', ccxt: 'DASH/USDT:USDT' },
  { our: 'ASTER-USDT', bybit: 'ASTERUSDT', okx: 'ASTER-USDT-SWAP', ccxt: 'ASTER/USDT:USDT' },
  { our: 'INJ-USDT', bybit: 'INJUSDT', okx: 'INJ-USDT-SWAP', ccxt: 'INJ/USDT:USDT' },
  { our: 'TRUMP-USDT', bybit: 'TRUMPUSDT', okx: 'TRUMP-USDT-SWAP', ccxt: 'TRUMP/USDT:USDT' },
  { our: 'WLD-USDT', bybit: 'WLDUSDT', okx: 'WLD-USDT-SWAP', ccxt: 'WLD/USDT:USDT' },
]

const BYBIT_TO_PAIR = Object.fromEntries(PAIRS.filter(p => p.bybit).map(p => [p.bybit, p]))
const OKX_TO_PAIR = Object.fromEntries(PAIRS.filter(p => p.okx).map(p => [p.okx, p]))

// Only keep OI for pairs we care about
const KNOWN_SYMBOLS = new Set(PAIRS.map(p => p.ccxt))

// ─── Bybit fetch (primary) ──────────────────────────────────────────
async function fetchFromBybit(): Promise<Record<string, any>> {
  const results: Record<string, any> = {}

  // Step 1: Bulk tickers (has funding rate, mark price, OI value)
  const tickerRes = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!tickerRes.ok) throw new Error(`Bybit tickers API: ${tickerRes.status}`)
  const tickerData = await tickerRes.json()

  if (tickerData.retCode !== 0) {
    throw new Error(`Bybit API error: ${tickerData.retMsg}`)
  }

  const tickers: Map<string, any> = new Map()
  for (const t of tickerData.result?.list || []) {
    if (BYBIT_TO_PAIR[t.symbol]) {
      tickers.set(t.symbol, t)
    }
  }

  // Step 2: Build per-pair data from tickers
  // Bybit tickers include openInterestValue which is OI in USD
  for (const [bybitSym, ticker] of tickers) {
    const pair = BYBIT_TO_PAIR[bybitSym]
    if (!pair) continue

    const markPrice = parseFloat(ticker.markPrice)
    const indexPrice = parseFloat(ticker.indexPrice)
    const fundingRate = parseFloat(ticker.fundingRate)
    const nextFundingTime = parseInt(ticker.nextFundingTime) || 0
    const openInterestValue = parseFloat(ticker.openInterestValue) || 0
    // openInterest is in contracts (base asset units)
    const openInterest = parseFloat(ticker.openInterest) || 0

    if (isNaN(markPrice) || markPrice <= 0) continue

    results[pair.ccxt] = {
      symbol: pair.ccxt,
      exchangeSymbol: bybitSym,
      exchange: 'bybit',
      openInterest,
      openInterestUsd: openInterestValue || (openInterest * markPrice),
      fundingRate,
      fundingTimestamp: Date.now(),
      nextFundingTime,
      markPrice,
      indexPrice: indexPrice || markPrice,
    }
  }

  return results
}

// ─── OKX fetch (fallback) ──────────────────────────────────────────
async function fetchFromOKX(): Promise<Record<string, any>> {
  const results: Record<string, any> = {}
  const okxPairs = PAIRS.filter(p => p.okx)

  // Fetch funding rates (batch — can use ?instId= or fetch all)
  // OKX allows multiple instIds separated by comma (but limited)
  // We'll fetch per-pair in parallel batches

  const batchSize = 5
  for (let i = 0; i < okxPairs.length; i += batchSize) {
    const batch = okxPairs.slice(i, i + batchSize)
    const promises = batch.map(async (pair) => {
      try {
        // Funding rate
        const frRes = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${pair.okx}`, {
          signal: AbortSignal.timeout(5_000),
        })
        const frData = frRes.ok ? await frRes.json() : null
        const frInfo = frData?.data?.[0]

        // Open Interest
        const oiRes = await fetch(`https://www.okx.com/api/v5/public/open-interest?instId=${pair.okx}&instType=SWAP`, {
          signal: AbortSignal.timeout(5_000),
        })
        const oiData = oiRes.ok ? await oiRes.json() : null
        const oiInfo = oiData?.data?.[0]

        // Mark price from tickers
        const tkRes = await fetch(`https://www.okx.com/api/v5/public/mark-price?instId=${pair.okx}&instType=SWAP`, {
          signal: AbortSignal.timeout(5_000),
        })
        const tkData = tkRes.ok ? await tkRes.json() : null
        const tkInfo = tkData?.data?.[0]

        if (!frInfo && !oiInfo) return

        const fundingRate = parseFloat(frInfo?.fundingRate || '0')
        const nextFundingTime = parseInt(frInfo?.nextFundingTime || '0')
        const markPrice = parseFloat(tkInfo?.markPx || oiInfo?.oi ? '0' : '0')
        const oiUsd = parseFloat(oiInfo?.oiUsd || '0')
        const oiCcy = parseFloat(oiInfo?.oiCcy || '0')

        results[pair.ccxt] = {
          symbol: pair.ccxt,
          exchangeSymbol: pair.okx,
          exchange: 'okx',
          openInterest: oiCcy,
          openInterestUsd: oiUsd,
          fundingRate,
          fundingTimestamp: parseInt(frInfo?.fundingTime || '0') || Date.now(),
          nextFundingTime,
          markPrice: markPrice || (oiUsd > 0 && oiCcy > 0 ? oiUsd / oiCcy : 0),
          indexPrice: markPrice || 0,
        }
      } catch {
        // Skip this pair on error
      }
    })
    await Promise.allSettled(promises)
  }

  return results
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')

    // Return cached if fresh
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      const filtered = filterData(cachedData, symbolsParam)
      return NextResponse.json({
        ...filtered,
        source: cachedData.source || 'multi-exchange',
        cached: true,
      })
    }

    // ── Try Bybit first, fall back to OKX ──
    let results: Record<string, any> = {}
    let source = 'bybit-public'

    try {
      results = await fetchFromBybit()
      if (Object.keys(results).length < 3) {
        console.warn('[/api/ccxt/oi-funding] Bybit returned too few results, trying OKX')
        throw new Error('Insufficient Bybit data')
      }
    } catch (bybitErr: any) {
      console.warn('[/api/ccxt/oi-funding] Bybit failed:', bybitErr.message, '→ trying OKX')
      try {
        results = await fetchFromOKX()
        source = 'okx-public'
      } catch (okxErr: any) {
        console.error('[/api/ccxt/oi-funding] OKX also failed:', okxErr.message)
        throw new Error(`Both Bybit and OKX failed: Bybit=${bybitErr.message}, OKX=${okxErr.message}`)
      }
    }

    // ── Detect OI Spikes and Extreme Funding ──
    const oiSpikes: string[] = []
    const fundingExtreme: string[] = []

    for (const [ccxtSymbol, data] of Object.entries(results)) {
      // OI Spike detection
      const prevOI = previousOI[ccxtSymbol]
      if (prevOI && prevOI > 0 && data.openInterestUsd > 0) {
        const oiChangePct = ((data.openInterestUsd - prevOI) / prevOI) * 100
        if (Math.abs(oiChangePct) >= OI_SPIKE_THRESHOLD_PCT) {
          oiSpikes.push(ccxtSymbol)
        }
      }
      if (data.openInterestUsd > 0) {
        previousOI[ccxtSymbol] = data.openInterestUsd
      }

      // Extreme Funding detection
      if (Math.abs(data.fundingRate) >= FUNDING_EXTREME_THRESHOLD) {
        fundingExtreme.push(ccxtSymbol)
      }
    }

    // Prune previousOI: only keep known symbols
    for (const key of Object.keys(previousOI)) {
      if (!KNOWN_SYMBOLS.has(key)) delete previousOI[key]
    }

    const snapshot = { data: results, oiSpikes, fundingExtreme, fetchedAt: Date.now(), source }
    cachedData = { timestamp: Date.now(), data: results, oiSpikes, fundingExtreme, source }

    const filtered = filterData(snapshot, symbolsParam)
    return NextResponse.json({
      ...filtered,
      source,
      cached: false,
    })
  } catch (error: any) {
    console.error('[/api/ccxt/oi-funding] error:', error.message)

    if (cachedData) {
      const { searchParams } = new URL(request.url)
      const symbolsParam = searchParams.get('symbols')
      const filtered = filterData(cachedData, symbolsParam)
      return NextResponse.json({
        ...filtered,
        source: (cachedData as any).source || 'multi-exchange',
        cached: true,
        stale: true,
        error: error.message,
      })
    }

    return NextResponse.json({
      error: `OI/Funding API error: ${error.message}`,
      data: {},
      oiSpikes: [],
      fundingExtreme: [],
      fetchedAt: Date.now(),
    }, { status: 502 })
  }
}

function filterData(snapshot: any, symbolsParam: string | null) {
  if (!symbolsParam) return snapshot

  const requested = new Set(symbolsParam.split(',').map(s => s.trim()))
  const filteredData: Record<string, any> = {}

  for (const [key, val] of Object.entries(snapshot.data || {})) {
    const data = val as any
    if (requested.has(key) || (data.exchangeSymbol && requested.has(data.exchangeSymbol))) {
      filteredData[key] = val
    }
  }

  return {
    data: filteredData,
    oiSpikes: snapshot.oiSpikes || [],
    fundingExtreme: snapshot.fundingExtreme || [],
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  }
}
