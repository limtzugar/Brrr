// ─── Bybit Futures Switch Isolated Margin API ──────────────────────────────────
// POST /api/bybit/futures/switch-isolated
// Switches one or more symbols to ISOLATED margin mode per-pair.
// Bybit UTA accounts are globally Cross, but Isolated is set per-symbol.
// This is the recommended mode for bot trading — each position risks only its own margin.
//
// Body: { symbols: string[], leverage: number, mode: 'demo'|'real' }
// Returns: { results: Array<{ symbol, success, alreadySet, message }> }

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import { log, error as logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface SwitchRequest {
  symbols: string[]     // e.g. ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  leverage: number      // e.g. 10
  mode: BybitMode
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 5, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = await request.json() as SwitchRequest
    const { symbols, leverage, mode } = body

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { error: 'symbols must be a non-empty array' },
        { status: 400 }
      )
    }
    if (!leverage || leverage < 1 || leverage > 100) {
      return NextResponse.json(
        { error: 'leverage must be 1-100' },
        { status: 400 }
      )
    }
    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json(
        { error: 'mode must be "demo" or "real"' },
        { status: 400 }
      )
    }

    const client = await createBybitClient(mode)

    // Process symbols sequentially (Bybit rate limit: ~13 req/s)
    const results: Array<{ symbol: string; success: boolean; alreadySet: boolean; message: string }> = []
    for (const symbol of symbols) {
      const result = await client.switchIsolatedMargin(symbol, leverage)
      results.push({ symbol, ...result })
      // Small delay to respect rate limits
      if (symbols.length > 1) {
        await new Promise(r => setTimeout(r, 100))
      }
    }

    const switched = results.filter(r => r.success && !r.alreadySet).length
    const alreadySet = results.filter(r => r.success && r.alreadySet).length
    const failed = results.filter(r => !r.success).length

    log(`[switch-isolated] ${mode}: ${switched} switched, ${alreadySet} already set, ${failed} failed out of ${symbols.length} symbols`)

    return NextResponse.json({
      success: failed === 0,
      results,
      summary: { total: symbols.length, switched, alreadySet, failed },
    })
  } catch (error: any) {
    logError('[/api/bybit/futures/switch-isolated] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
