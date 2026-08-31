// ─── Bybit Balance API ────────────────────────────────────────────────────────
// GET: Fetch current wallet balance from Bybit (demo or real)

import { NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 10, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    const { searchParams } = new URL(request.url)
    const mode = (searchParams.get('mode') || 'demo') as BybitMode

    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json(
        { error: 'Mode must be "demo" or "real"' },
        { status: 400 }
      )
    }

    const client = await createBybitClient(mode)

    // Get full balance info
    const [balanceInfo, timeInfo] = await Promise.allSettled([
      client.getAllBalances(),
      client.getServerTime(),
    ])

    const balances = balanceInfo.status === 'fulfilled'
      ? balanceInfo.value
      : { totalEquityUsdt: 0, coins: [], accountType: 'UNIFIED' }

    const time = timeInfo.status === 'fulfilled'
      ? timeInfo.value
      : null

    return NextResponse.json({
      mode,
      totalEquityUsdt: balances.totalEquityUsdt,
      coins: balances.coins,
      accountType: balances.accountType,
      serverTimeDiff: time?.diffMs || null,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/bybit/balance] error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
