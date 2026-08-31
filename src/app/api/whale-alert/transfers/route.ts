// ─── Whale Alert Transfers API ─────────────────────────────────────────────
// GET /api/whale-alert/transfers
// Fetches large crypto transfers from Whale Alert API and maps them to
// WHALE_INFLOW signals for the CEX Anomaly engine.
//
// Whale Alert tracks on-chain transfers >= $500K (free tier) with 10 req/min.
// Data includes: blockchain, from/to owner/type, symbol, amount, USD value.
//
// Requires env: WHALE_ALERT_API_KEY
// Optional env: WHALE_ALERT_MIN_USD (default: 1_000_000 = $1M)

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const WHALE_ALERT_API = 'https://api.whale-alert.io/v1'
const DEFAULT_MIN_USD = 1_000_000 // $1M — matches SIZE_THRESHOLDS.WHALE_INFLOW

// ─── Cache ─────────────────────────────────────────────────────────────────
let cachedResult: {
  timestamp: number
  signals: WhaleInflowSignal[]
} | null = null
const CACHE_TTL = 60_000 // 60s — matches other Binance endpoints

interface WhaleTransaction {
  blockchain: string
  symbol: string
  transaction_type: string
  hash: string
  from: { address: string; owner: string; owner_type: string }
  to: { address: string; owner: string; owner_type: string }
  timestamp: number
  amount: number
  amount_usd: number
}

interface WhaleInflowSignal {
  symbol: string         // Our format: BTC-USDT
  blockchain: string     // e.g. 'ethereum', 'bitcoin', 'tron'
  side: 'BID' | 'ASK'   // BID = inflow to exchange (bullish), ASK = outflow (bearish)
  valueUsd: number
  amount: number
  fromOwner: string
  fromType: string
  toOwner: string
  toType: string
  details: string
  hash: string
  timestamp: number
}

// Map Whale Alert symbols to our USDT pair format
const SYMBOL_TO_PAIR: Record<string, string> = {
  btc: 'BTC-USDT',
  eth: 'ETH-USDT',
  usdt: 'USDT-USDT',   // USDT inflow = stablecoin ready to buy
  usdc: 'USDC-USDT',
  bnb: 'BNB-USDT',
  sol: 'SOL-USDT',
  xrp: 'XRP-USDT',
  ada: 'ADA-USDT',
  doge: 'DOGE-USDT',
  avax: 'AVAX-USDT',
  sui: 'SUI-USDT',
  link: 'LINK-USDT',
  arb: 'ARB-USDT',
  matic: 'MATIC-USDT',
  fil: 'FIL-USDT',
  inj: 'INJ-USDT',
  fet: 'FET-USDT',
  icp: 'ICP-USDT',
  pepe: 'PEPE-USDT',
  ton: 'TON-USDT',
  zec: 'ZEC-USDT',
  tao: 'TAOUSDT',
  trump: 'TRUMP-USDT',
  wld: 'WLD-USDT',
}

function mapToSignal(tx: WhaleTransaction): WhaleInflowSignal | null {
  const symbolKey = tx.symbol?.toLowerCase() || ''
  const pair = SYMBOL_TO_PAIR[symbolKey]
  if (!pair) return null  // Not a tracked symbol

  const toExchange = tx.to?.owner_type === 'exchange'
  const fromExchange = tx.from?.owner_type === 'exchange'

  let side: 'BID' | 'ASK'
  let details: string

  if (toExchange && !fromExchange) {
    side = 'BID'
    details = `${formatUsd(tx.amount_usd)} ${tx.symbol.toUpperCase()} → ${tx.to.owner || 'exchange'} (${tx.blockchain})`
  } else if (fromExchange && !toExchange) {
    side = 'BID'
    details = `${formatUsd(tx.amount_usd)} ${tx.symbol.toUpperCase()} ← ${tx.from.owner || 'exchange'} (${tx.blockchain})`
  } else if (toExchange && fromExchange) {
    side = 'BID'
    details = `${formatUsd(tx.amount_usd)} ${tx.symbol.toUpperCase()} ${tx.from.owner}→${tx.to.owner} (${tx.blockchain})`
  } else {
    side = 'BID'
    details = `${formatUsd(tx.amount_usd)} ${tx.symbol.toUpperCase()} (${tx.blockchain})`
  }

  // Special: USDT/USDC inflow to exchange = whale preparing to buy
  if ((symbolKey === 'usdt' || symbolKey === 'usdc') && toExchange) {
    side = 'BID'
    details = `${formatUsd(tx.amount_usd)} stablecoins → ${tx.to.owner || 'exchange'} — buying power incoming`
  }

  return {
    symbol: pair,
    blockchain: tx.blockchain,
    side,
    valueUsd: tx.amount_usd,
    amount: tx.amount,
    fromOwner: tx.from?.owner || 'unknown',
    fromType: tx.from?.owner_type || 'unknown',
    toOwner: tx.to?.owner || 'unknown',
    toType: tx.to?.owner_type || 'unknown',
    details,
    hash: tx.hash,
    timestamp: tx.timestamp,
  }
}

function formatUsd(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 10, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const apiKey = process.env.WHALE_ALERT_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'WHALE_ALERT_API_KEY not configured',
      signals: [],
      timestamp: Date.now(),
    }, { status: 503 })
  }

  try {
    // Return cached if fresh
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return NextResponse.json({
        ...cachedResult,
        cached: true,
      })
    }

    const minUsd = parseInt(process.env.WHALE_ALERT_MIN_USD || String(DEFAULT_MIN_USD), 10)
    const start = Math.floor(Date.now() / 1000) - 600

    const url = `${WHALE_ALERT_API}/transactions?api_key=${apiKey}&min_value=${Math.floor(minUsd / 1000)}&start=${start}&limit=100`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown')
      console.error(`[whale-alert] API error ${res.status}: ${errText}`)

      if (cachedResult) {
        return NextResponse.json({
          ...cachedResult,
          cached: true,
          stale: true,
          error: `Whale Alert API ${res.status}`,
        })
      }

      return NextResponse.json({
        success: false,
        error: `Whale Alert API error: ${res.status}`,
        signals: [],
        timestamp: Date.now(),
      }, { status: 502 })
    }

    const data = await res.json()
    const transactions: WhaleTransaction[] = data.transactions || []

    const signals: WhaleInflowSignal[] = []
    for (const tx of transactions) {
      const signal = mapToSignal(tx)
      if (signal) signals.push(signal)
    }

    signals.sort((a, b) => b.valueUsd - a.valueUsd)

    const result = {
      success: true,
      signals,
      totalTransactions: transactions.length,
      filteredSignals: signals.length,
      source: 'whale-alert',
      timestamp: Date.now(),
    }

    if (signals.length > 0) {
      cachedResult = { timestamp: Date.now(), signals }
    }

    return NextResponse.json({ ...result, cached: false })
  } catch (error: any) {
    console.error('[whale-alert] error:', error.message)

    if (cachedResult) {
      return NextResponse.json({
        ...cachedResult,
        cached: true,
        stale: true,
        error: error.message,
      })
    }

    return NextResponse.json({
      success: false,
      error: `Whale Alert error: ${error.message}`,
      signals: [],
      timestamp: Date.now(),
    }, { status: 502 })
  }
}
