// ─── Strategy Deactivation ──────────────────────────────────────────────────
// POST: Deactivate a running strategy

import { NextResponse } from 'next/server'
import { deactivateStrategy } from '@/lib/strategy-runner'
import { type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import { strategyDeactivateSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateResult = checkRateLimit(ip, 10, 60 * 1000)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests.' },
        { status: 429 }
      )
    }

    const body = await request.json()

    // Validate with Zod
    const parsed = strategyDeactivateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { strategyId, mode } = parsed.data

    const result = await deactivateStrategy(strategyId, mode as BybitMode)

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: result.message })
  } catch (error) {
    console.error('[/api/strategies/deactivate] Error:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate strategy.' },
      { status: 500 }
    )
  }
}
