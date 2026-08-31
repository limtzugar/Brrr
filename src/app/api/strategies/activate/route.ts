// ─── Strategy Activation ────────────────────────────────────────────────────
// POST: Activate a strategy (demo or real mode)
// Now supports universal multi-strategy framework

import { NextResponse } from 'next/server'
import { activateStrategyWithConfig } from '@/lib/strategy-runner'
import { getBybitSymbol, type BybitMode } from '@/lib/bybit'
import { getMexcSymbol } from '@/lib/mexc'
import { checkRateLimit } from '@/lib/rate-limit'
import { strategyActivateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    // Rate limit: 10 requests per minute
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateResult = checkRateLimit(ip, 10, 60 * 1000)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.' },
        { status: 429 }
      )
    }

    const body = await request.json()

    // Validate with Zod
    const parsed = strategyActivateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const {
      strategyId,
      name,
      coinId,
      mode,
      strategyType: type,
      strategyParams,
      dipThreshold1h,
      dipThreshold24h,
      takeProfitPct,
      stopLossPct,
      maxHoldingHours,
      feePct,
      initialCapital,
      compound,
    } = parsed.data

    // Parse strategy params (before symbol resolution, since exchange is in params)
    let parsedParams: Record<string, unknown> = {}
    if (strategyParams) {
      try {
        parsedParams = typeof strategyParams === 'string' ? JSON.parse(strategyParams) : strategyParams
      } catch {
        parsedParams = {}
      }
    }

    // Resolve symbol based on exchange
    const exchange = (parsedParams?.exchange as string) || 'bybit'
    if (exchange === 'binance') {
      return NextResponse.json(
        { error: 'Handel przez Binance został wyłączony' },
        { status: 410 }
      )
    }
    let symbol: string | undefined
    if (exchange === 'mexc') {
      symbol = getMexcSymbol(coinId)
    } else {
      symbol = getBybitSymbol(coinId)
    }
    if (!symbol) {
      return NextResponse.json(
        { error: `Nie znaleziono symbolu dla ${coinId} na ${exchange.toUpperCase()}` },
        { status: 400 }
      )
    }

    // Activate the strategy
    const result = await activateStrategyWithConfig({
      strategyId,
      name,
      coinId,
      mode: mode as BybitMode,
      strategyType: type,
      strategyParams: parsedParams,
      dipThreshold1h: Number(dipThreshold1h) || 0,
      dipThreshold24h: Number(dipThreshold24h) || -3,
      takeProfitPct: Number(takeProfitPct) || 5,
      stopLossPct: Number(stopLossPct) || 2,
      maxHoldingHours: Number(maxHoldingHours) || 48,
      feePct: Number(feePct) || 0.2,
      initialCapital: Number(initialCapital) || 1000,
      compound: Boolean(compound),
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      dbId: result.dbId,
    })
  } catch (error) {
    console.error('[/api/strategies/activate] Error:', error)
    return NextResponse.json(
      { error: 'Błąd aktywacji strategii. Spróbuj ponownie później.' },
      { status: 500 }
    )
  }
}
