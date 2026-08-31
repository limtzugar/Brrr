// ─── Bybit Sub-Accounts API ────────────────────────────────────────────────
// GET /api/bybit/sub-accounts?mode=real|demo
// Returns list of sub-accounts with balance info for each.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 10, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'real') as BybitMode
    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Mode must be "demo" or "real"' }, { status: 400 })
    }

    const client = await createBybitClient(mode)
    const subAccounts = await client.getSubAccounts()

    // Fetch balance for each sub-account
    const subsWithBalance = await Promise.all(
      subAccounts.map(async (sub) => {
        const balance = await client.getSubAccountBalance(sub.memberId)
        return { ...sub, balance }
      })
    )

    return NextResponse.json({
      success: true,
      mode,
      subAccounts: subsWithBalance,
    })
  } catch (error: any) {
    console.error('[/api/bybit/sub-accounts] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, subAccounts: [] },
      { status: 500 }
    )
  }
}
