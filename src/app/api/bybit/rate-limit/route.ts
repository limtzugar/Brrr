// ─── Bybit Rate Limit Status API ───────────────────────────────────────────────
// GET /api/bybit/rate-limit
// Returns real-time Bybit rate limit state from:
//   1. X-Bapi-Limit-Status / X-Bapi-Limit headers (from exchange-rate-state.ts)
//   2. Internal request log (requests in last 60s)
// Used by Execution Clock to show REAL Bybit rate usage, not just local queue depth.

import { NextResponse } from 'next/server'
import { getBybitRateState } from '@/lib/exchange-rate-state'
import { getBybitRateLimitStats } from '@/lib/bybit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const headerState = getBybitRateState()
  const logStats = getBybitRateLimitStats()

  // Calculate real usage percentage from X-Bapi-Limit headers
  // X-Bapi-Limit-Status = remaining requests in window
  // X-Bapi-Limit = max requests per window
  let headerUsedPct = 0
  if (headerState.remaining !== null && headerState.limit !== null && headerState.limit > 0) {
    headerUsedPct = Math.round(((headerState.limit - headerState.remaining) / headerState.limit) * 100)
  }

  // Calculate usage from request log (fallback when headers not yet available)
  const logUsedPct = logStats.maxPerMin > 0
    ? Math.round((logStats.requestsLastMin / logStats.maxPerMin) * 100)
    : 0

  // Use header-based percentage when available (more accurate), fallback to log
  const usedPct = headerState.remaining !== null ? headerUsedPct : logUsedPct

  // Is the state fresh? (<2min old for headers)
  const headerAge = Date.now() - headerState.lastUpdated
  const headerFresh = headerAge < 120_000

  return NextResponse.json({
    // Real Bybit rate limit from response headers
    bybitRemaining: headerState.remaining,
    bybitLimit: headerState.limit,
    bybitRetryAfter: headerState.retryAfter,
    bybitHeaderUsedPct: headerFresh ? headerUsedPct : null,
    // Internal request log (always available)
    requestsLastMin: logStats.requestsLastMin,
    maxPerMin: logStats.maxPerMin,
    backoffActive: logStats.backoffActive,
    logUsedPct,
    // Combined: best available metric
    usedPct,
    fresh: headerFresh,
    timestamp: Date.now(),
  })
}
