// ─── Bybit Futures Balance API ────────────────────────────────────────────────
// GET /api/bybit/futures/balance?mode=real|demo
// Returns UNIFIED account balance for futures trading.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  // Higher limit for internal balance polling (frontend polls every 30s)
  // Old limit of 10/min was too low — 2 concurrent calls (balance+positions) every 8s = 15/min
  const rateResult = checkRateLimit(ip, 30, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'real') as BybitMode
    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Mode must be "demo" or "real"' }, { status: 400 })
    }

    const client = await createBybitClient(mode)
    const balance = await client.getFuturesBalance()

    return NextResponse.json({
      success: true,
      mode,
      totalEquityUsdt: balance.totalEquityUsdt,
      availableBalance: balance.availableBalance,
      totalWalletBalance: balance.totalWalletBalance,
      totalUnrealisedPnl: balance.totalUnrealisedPnl,
      coins: balance.coins,
      accountType: balance.accountType,
      source: balance.source,
      subAccountName: balance.subAccountName,
      lastUpdated: Date.now(),
    })
  } catch (error: any) {
    console.error('[/api/bybit/futures/balance] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, availableBalance: 0, totalEquityUsdt: 0 },
      { status: 500 }
    )
  }
}
