// ─── Sell All API ────────────────────────────────────────────────────────────
// POST: Market sell all non-USDT coins on the selected exchange

import { NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import { createMexcClient, type MexcMode } from '@/lib/mexc'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const sellAllSchema = z.object({
  exchange: z.enum(['bybit', 'mexc']).default('bybit'),
  mode: z.enum(['demo', 'real']).default('demo'),
})

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 10, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    const body = await request.json()
    const parsed = sellAllSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.flatten() }, { status: 400 })
    }
    const { exchange, mode } = parsed.data

    const results: Array<{ coin: string; symbol: string; qty: string; status: 'success' | 'error'; message: string }> = []

    if (exchange === 'bybit') {
      const client = await createBybitClient(mode as BybitMode)
      const balances = await client.getAllBalances()
      const nonUsdt = balances.coins.filter(c => c.coin !== 'USDT' && Number(c.free) > 0)

      for (const coin of nonUsdt) {
        const symbol = `${coin.coin}USDT`
        const qty = Number(coin.free).toFixed(Number(coin.free) < 1 ? 6 : 4)
        try {
          await client.marketSell(symbol, qty, `sell-all-${Date.now()}`)
          results.push({ coin: coin.coin, symbol, qty, status: 'success', message: `Sold ${qty} ${coin.coin}` })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Sell failed'
          results.push({ coin: coin.coin, symbol, qty, status: 'error', message: msg })
        }
      }
    } else {
      // MEXC
      const client = await createMexcClient(mode as MexcMode)
      const balances = await client.getAllBalances()
      const nonUsdt = balances.coins.filter(c => c.coin !== 'USDT' && Number(c.free) > 0)

      for (const coin of nonUsdt) {
        const symbol = `${coin.coin}USDT`
        const qty = Number(coin.free).toFixed(Number(coin.free) < 1 ? 6 : 4)
        try {
          await client.marketSell(symbol, qty, `sell-all-${Date.now()}`)
          results.push({ coin: coin.coin, symbol, qty, status: 'success', message: `Sold ${qty} ${coin.coin}` })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Sell failed'
          results.push({ coin: coin.coin, symbol, qty, status: 'error', message: msg })
        }
      }
    }

    const successCount = results.filter(r => r.status === 'success').length
    const errorCount = results.filter(r => r.status === 'error').length

    return NextResponse.json({
      success: errorCount === 0,
      message: `Sold ${successCount}/${results.length} assets${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
      results,
      soldCount: successCount,
      errorCount,
    })
  } catch (error) {
    console.error('[/api/sell-all] error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
