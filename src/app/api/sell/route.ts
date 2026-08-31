// ─── Instant Sell API ────────────────────────────────────────────────────────
// POST: Sell all holdings of a specific coin (or all coins) at market price
// Body: { mode, exchange, symbol?, coin?, sellAll? }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { MexcClient, type MexcMode } from '@/lib/mexc'
import { BinanceClient, type BinanceMode } from '@/lib/binance'
import { decrypt } from '@/lib/encryption'
import { error as logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { mode = 'demo', exchange = 'bybit', symbol, coin, sellAll = false } = body

    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Mode must be "demo" or "real"' }, { status: 400 })
    }
    if (exchange === 'binance') {
      return NextResponse.json({ error: 'Trading via Binance has been disabled' }, { status: 410 })
    }
    if (!['bybit', 'mexc', 'binance'].includes(exchange)) {
      return NextResponse.json({ error: 'Unsupported exchange' }, { status: 400 })
    }

    // Get API keys from DB
    const apiRecord = await db.exchangeApi.findUnique({
      where: { exchange_mode: { exchange, mode } },
    })

    if (!apiRecord?.isConfigured) {
      return NextResponse.json({ error: `No API keys configured for ${exchange} (${mode})` }, { status: 400 })
    }

    const apiKey = decrypt(apiRecord.apiKey)
    const apiSecret = decrypt(apiRecord.apiSecret)

    const results: Array<{ coin: string; symbol: string; success: boolean; message: string; details?: unknown }> = []

    if (exchange === 'binance') {
      const client = new BinanceClient({ apiKey, apiSecret, mode: mode as BinanceMode })

      if (sellAll) {
        // Sell all non-USDT coins
        const balances = await client.getAllBalances()
        const holdings = balances.coins.filter((c: { coin: string; free: string }) =>
          c.coin !== 'USDT' && Number(c.free) > 0
        )

        for (const holding of holdings) {
          const sym = `${holding.coin}USDT`
          try {
            const order = await client.marketSell(sym, holding.free)
            results.push({ coin: holding.coin, symbol: sym, success: true, message: `Sold ${holding.free} ${holding.coin}`, details: order })
          } catch (err) {
            results.push({ coin: holding.coin, symbol: sym, success: false, message: err instanceof Error ? err.message : 'Sell failed' })
          }
        }
      } else if (symbol && coin) {
        // Sell specific coin
        const balances = await client.getAllBalances()
        const holding = balances.coins.find((c: { coin: string }) => c.coin === coin)
        const freeAmount = holding?.free || '0'

        if (Number(freeAmount) <= 0) {
          return NextResponse.json({ error: `No available funds ${coin} to sell` }, { status: 400 })
        }

        const order = await client.marketSell(symbol, freeAmount)
        results.push({ coin, symbol, success: true, message: `Sold ${freeAmount} ${coin}`, details: order })
      } else {
        return NextResponse.json({ error: 'Podaj coin i symbol, albo sellAll=true' }, { status: 400 })
      }
    } else if (exchange === 'mexc') {
      const client = new MexcClient({ apiKey, apiSecret, mode: mode as MexcMode })

      if (sellAll) {
        // Sell all non-USDT coins
        const balances = await client.getAllBalances()
        const holdings = balances.coins.filter((c: { coin: string; free: string }) =>
          c.coin !== 'USDT' && Number(c.free) > 0
        )

        for (const holding of holdings) {
          const sym = `${holding.coin}USDT`
          try {
            const order = await client.marketSell(sym, holding.free)
            results.push({ coin: holding.coin, symbol: sym, success: true, message: `Sold ${holding.free} ${holding.coin}`, details: order })
          } catch (err) {
            results.push({ coin: holding.coin, symbol: sym, success: false, message: err instanceof Error ? err.message : 'Sell failed' })
          }
        }
      } else if (symbol && coin) {
        // Sell specific coin
        const balances = await client.getAllBalances()
        const holding = balances.coins.find((c: { coin: string }) => c.coin === coin)
        const freeAmount = holding?.free || '0'

        if (Number(freeAmount) <= 0) {
          return NextResponse.json({ error: `No available funds ${coin} to sell` }, { status: 400 })
        }

        const order = await client.marketSell(symbol, freeAmount)
        results.push({ coin, symbol, success: true, message: `Sold ${freeAmount} ${coin}`, details: order })
      } else {
        return NextResponse.json({ error: 'Podaj coin i symbol, albo sellAll=true' }, { status: 400 })
      }
    } else {
      // Bybit — use createBybitClient() for sub-account support
      const client = await createBybitClient(mode as BybitMode)

      if (sellAll) {
        const balancesResult = await client.getAllBalances()
        const holdings = balancesResult.coins.filter((c: { coin: string; free: string }) =>
          c.coin !== 'USDT' && Number(c.free) > 0
        )

        for (const holding of holdings) {
          const sym = `${holding.coin}USDT`
          try {
            const order = await client.marketSell(sym, holding.free)
            results.push({ coin: holding.coin, symbol: sym, success: true, message: `Sold ${holding.free} ${holding.coin}`, details: order })
          } catch (err) {
            results.push({ coin: holding.coin, symbol: sym, success: false, message: err instanceof Error ? err.message : 'Sell failed' })
          }
        }
      } else if (symbol && coin) {
        const balancesResult = await client.getAllBalances()
        const holding = balancesResult.coins.find((c: { coin: string }) => c.coin === coin)
        const freeAmount = holding?.free || '0'

        if (Number(freeAmount) <= 0) {
          return NextResponse.json({ error: `No available funds ${coin} to sell` }, { status: 400 })
        }

        const order = await client.marketSell(symbol, freeAmount)
        results.push({ coin, symbol, success: true, message: `Sold ${freeAmount} ${coin}`, details: order })
      } else {
        return NextResponse.json({ error: 'Podaj coin i symbol, albo sellAll=true' }, { status: 400 })
      }
    }

    const allSuccess = results.every(r => r.success)
    return NextResponse.json({
      success: allSuccess,
      results,
      ...(allSuccess ? {} : { warning: 'Some sells failed — check individual results' })
    })
  } catch (error) {
    logError('[/api/sell] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sell failed' },
      { status: 500 }
    )
  }
}
