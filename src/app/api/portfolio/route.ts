// ─── Unified Portfolio API ────────────────────────────────────────────────────
// GET: Aggregate balances from supported configured exchanges
// Returns combined portfolio with per-exchange breakdown and USDT valuations

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { BybitClient, type BybitMode } from '@/lib/bybit'
import { MexcClient, type MexcMode, MEXC_FEES } from '@/lib/mexc'
import { BinanceClient, type BinanceMode, BINANCE_FEES } from '@/lib/binance'

export const dynamic = 'force-dynamic'

interface ExchangeBalance {
  exchange: string
  mode: string
  totalEquityUsdt: number
  usdtBalance: number
  coins: Array<{
    coin: string
    equity: string
    free: string
    locked: string
    walletBalance: string
  }>
  fees: { maker: number; taker: number }
  error: string | null
}

interface PortfolioResponse {
  totalValueUsdt: number
  totalUsdtCash: number
  exchanges: ExchangeBalance[]
  allCoins: Array<{
    coin: string
    totalEquity: number
    totalFree: number
    totalLocked: number
    exchanges: Array<{ exchange: string; equity: number; free: number; locked: number }>
  }>
  lastUpdated: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const modeFilter = searchParams.get('mode') // optional: 'demo' | 'real'

    // Get all configured exchange APIs
    const apis = await db.exchangeApi.findMany({
      where: { isConfigured: true, exchange: { not: 'binance' } },
    })

    if (apis.length === 0) {
      return NextResponse.json({
        totalValueUsdt: 0,
        totalUsdtCash: 0,
        exchanges: [],
        allCoins: [],
        lastUpdated: new Date().toISOString(),
      })
    }

    // Filter by mode if specified
    const filteredApis = modeFilter
      ? apis.filter(a => a.mode === modeFilter)
      : apis

    // Fetch balances from all exchanges in parallel
    const exchangeResults = await Promise.allSettled(
      filteredApis.map(async (api): Promise<ExchangeBalance> => {
        const apiKey = decrypt(api.apiKey)
        const apiSecret = decrypt(api.apiSecret)

        try {
          if (api.exchange === 'binance') {
            const client = new BinanceClient({
              apiKey,
              apiSecret,
              mode: api.mode as BinanceMode,
            })
            const balances = await client.getAllBalances()
            const usdtCoin = balances.coins.find(c => c.coin === 'USDT')
            return {
              exchange: 'binance',
              mode: api.mode,
              totalEquityUsdt: balances.totalEquityUsdt,
              usdtBalance: usdtCoin ? Number(usdtCoin.free) : 0,
              coins: balances.coins.map(c => ({
                coin: c.coin,
                equity: c.equity,
                free: c.free || '0',
                locked: c.locked || '0',
                walletBalance: c.walletBalance || c.equity,
              })),
              fees: { ...BINANCE_FEES },
              error: null,
            }
          } else if (api.exchange === 'mexc') {
            const client = new MexcClient({
              apiKey,
              apiSecret,
              mode: api.mode as MexcMode,
            })
            const balances = await client.getAllBalances()
            const usdtCoin = balances.coins.find(c => c.coin === 'USDT')
            return {
              exchange: 'mexc',
              mode: api.mode,
              totalEquityUsdt: balances.totalEquityUsdt,
              usdtBalance: usdtCoin ? Number(usdtCoin.free) : 0,
              coins: balances.coins.map(c => ({
                coin: c.coin,
                equity: c.equity,
                free: c.free || '0',
                locked: c.locked || '0',
                walletBalance: c.walletBalance || c.equity,
              })),
              fees: { ...MEXC_FEES },
              error: null,
            }
          } else {
            // Bybit
            const client = new BybitClient({
              apiKey,
              apiSecret,
              mode: api.mode as BybitMode,
            })
            const balances = await client.getAllBalances()
            const usdtCoin = balances.coins.find(c => c.coin === 'USDT')
            return {
              exchange: 'bybit',
              mode: api.mode,
              totalEquityUsdt: balances.totalEquityUsdt,
              usdtBalance: usdtCoin ? Number(usdtCoin.walletBalance) : 0,
              coins: balances.coins.map(c => ({
                coin: c.coin,
                equity: c.equity,
                free: c.free || '0',
                locked: c.locked || '0',
                walletBalance: c.walletBalance || c.equity,
              })),
              fees: { maker: 0.1, taker: 0.1 },
              error: null,
            }
          }
        } catch (err) {
          return {
            exchange: api.exchange,
            mode: api.mode,
            totalEquityUsdt: 0,
            usdtBalance: 0,
            coins: [],
            fees: api.exchange === 'mexc' ? { ...MEXC_FEES } : api.exchange === 'binance' ? { ...BINANCE_FEES } : { maker: 0.1, taker: 0.1 },
            error: err instanceof Error ? err.message : 'Błąd pobierania salda',
          }
        }
      })
    )

    const exchanges: ExchangeBalance[] = exchangeResults.map(r =>
      r.status === 'fulfilled' ? r.value : {
        exchange: 'unknown',
        mode: 'demo',
        totalEquityUsdt: 0,
        usdtBalance: 0,
        coins: [],
        fees: { maker: 0, taker: 0 },
        error: r.status === 'rejected' ? r.reason?.message : 'Unknown error',
      }
    )

    // Aggregate across exchanges
    const totalValueUsdt = exchanges.reduce((sum, e) => sum + e.totalEquityUsdt, 0)
    const totalUsdtCash = exchanges.reduce((sum, e) => sum + e.usdtBalance, 0)

    // Merge coins across exchanges
    const coinMap = new Map<string, {
      coin: string
      totalEquity: number
      totalFree: number
      totalLocked: number
      exchanges: Array<{ exchange: string; equity: number; free: number; locked: number }>
    }>()

    for (const ex of exchanges) {
      for (const c of ex.coins) {
        if (Number(c.equity) <= 0 && Number(c.free) <= 0) continue
        const existing = coinMap.get(c.coin)
        if (existing) {
          existing.totalEquity += Number(c.equity)
          existing.totalFree += Number(c.free)
          existing.totalLocked += Number(c.locked)
          existing.exchanges.push({
            exchange: ex.exchange,
            equity: Number(c.equity),
            free: Number(c.free),
            locked: Number(c.locked),
          })
        } else {
          coinMap.set(c.coin, {
            coin: c.coin,
            totalEquity: Number(c.equity),
            totalFree: Number(c.free),
            totalLocked: Number(c.locked),
            exchanges: [{
              exchange: ex.exchange,
              equity: Number(c.equity),
              free: Number(c.free),
              locked: Number(c.locked),
            }],
          })
        }
      }
    }

    const allCoins = Array.from(coinMap.values())
      .filter(c => c.totalEquity > 0 || c.coin === 'USDT')
      .sort((a, b) => {
        // USDT first, then by equity descending
        if (a.coin === 'USDT') return -1
        if (b.coin === 'USDT') return 1
        return b.totalEquity - a.totalEquity
      })

    const response: PortfolioResponse = {
      totalValueUsdt,
      totalUsdtCash,
      exchanges,
      allCoins,
      lastUpdated: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[/api/portfolio] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Błąd pobierania portfela' },
      { status: 500 }
    )
  }
}
