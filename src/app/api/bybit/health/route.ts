// ─── Bybit Health Check API ────────────────────────────────────────────────────
// GET /api/bybit/health?mode=real|demo
// Checks: API connectivity, timestamp sync, sub-account detection, balance access.
// Called proactively when user switches to REAL mode.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode, getBybitRateLimitStats } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import { log, warn } from '@/lib/logger'

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

    // 1. Server time sync
    const timeResult = await client.getServerTime()
    const absDrift = Math.abs(timeResult.diffMs)
    const timeOk = absDrift < 5000 // Bybit recvWindow default = 20000, but <5s is safe

    // 2. Balance access check
    let balanceOk = false
    let availableBalance: number | null = null
    let totalEquityUsdt: number | null = null
    let balanceError: string | null = null
    try {
      const balance = await client.getFuturesBalance()
      availableBalance = balance.availableBalance
      totalEquityUsdt = balance.totalEquityUsdt
      balanceOk = true
    } catch (e: any) {
      balanceError = e.message
      warn(`[bybit/health] Balance check failed: ${e.message}`)
    }

    // 3. Sub-account info
    const subMemberId = client.getSubMemberId()
    const subAccountName = client.getSubAccountName()

    const allOk = timeOk && balanceOk

    // Get global rate limit stats
    const rateLimitStats = getBybitRateLimitStats()

    log(`[bybit/health] mode=${mode} timeOk=${timeOk} drift=${timeResult.diffMs}ms balanceOk=${balanceOk} subAccount=${subAccountName || 'main'} overall=${allOk ? 'HEALTHY' : 'DEGRADED'} rateLimit=${rateLimitStats.requestsLastMin}/${rateLimitStats.maxPerMin}`)

    return NextResponse.json({
      success: true,
      mode,
      healthy: allOk,
      time: {
        serverTime: timeResult.serverTime,
        localTime: timeResult.localTime,
        diffMs: timeResult.diffMs,
        ok: timeOk,
        warning: absDrift >= 5000 ? `Clock drift ${absDrift}ms exceeds safe threshold (5000ms). Orders may be rejected with retCode 10004.` : null,
      },
      balance: balanceOk ? {
        ok: true,
        availableBalance,
        totalEquityUsdt,
      } : {
        ok: false,
        error: balanceError,
      },
      rateLimit: rateLimitStats,
      subAccount: subMemberId ? {
        memberId: subMemberId,
        name: subAccountName,
      } : null,
      timestamp: Date.now(),
    })
  } catch (error: any) {
    log(`[bybit/health] Error: ${error.message}`)
    return NextResponse.json({
      success: false,
      healthy: false,
      error: error.message,
    }, { status: 500 })
  }
}
