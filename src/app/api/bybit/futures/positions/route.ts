// ─── Bybit Futures Positions API ──────────────────────────────────────────────
// GET /api/bybit/futures/positions?mode=real|demo&symbol=BTCUSDT (optional)
// Returns open linear perpetual positions.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  // Higher limit for internal position polling (frontend polls every 30s)
  const rateResult = checkRateLimit(ip, 30, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'real') as BybitMode
    const symbol = request.nextUrl.searchParams.get('symbol') || undefined

    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Mode must be "demo" or "real"' }, { status: 400 })
    }

    const client = await createBybitClient(mode)
    const positions = await client.getLinearPositions(symbol)

    return NextResponse.json({
      success: true,
      mode,
      positions: positions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        avgPrice: p.avgPrice,
        unrealisedPnl: p.unrealisedPnl,
        leverage: p.leverage,
        markPrice: p.markPrice,
        liqPrice: p.liqPrice,
        createdTime: p.createdTime,
        positionIdx: p.positionIdx,
        // TP/SL fields from Bybit — critical for fast verify & UI display
        takeProfit: p.takeProfit,
        stopLoss: p.stopLoss,
        tpTriggerBy: p.tpTriggerBy,
        slTriggerBy: p.slTriggerBy,
        trailingStop: p.trailingStop,
        tpslMode: p.tpslMode,
        // Derived fields for UI convenience
        sizeUsd: Number(p.size) * Number(p.avgPrice),
        pnlPercent: Number(p.avgPrice) > 0
          ? ((Number(p.markPrice) - Number(p.avgPrice)) / Number(p.avgPrice)) * 100 * (p.side === 'Buy' ? 1 : -1)
          : 0,
      })),
      count: positions.length,
      lastUpdated: Date.now(),
    })
  } catch (error: any) {
    console.error('[/api/bybit/futures/positions] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, positions: [], count: 0 },
      { status: 500 }
    )
  }
}
