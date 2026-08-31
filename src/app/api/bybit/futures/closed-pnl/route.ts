// ─── Bybit Futures Closed PnL API ────────────────────────────────────────
// GET /api/bybit/futures/closed-pnl?mode=real|demo&startTime=xxx&endTime=xxx&symbol=BTCUSDT&limit=50
// Returns closed PnL history from Bybit's authoritative source.
// Bybit's closedPnl is NET (after fees) — the definitive realized profit.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 30, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'real') as BybitMode
    const symbol = request.nextUrl.searchParams.get('symbol') || undefined
    const startTimeStr = request.nextUrl.searchParams.get('startTime')
    const endTimeStr = request.nextUrl.searchParams.get('endTime')
    const limitStr = request.nextUrl.searchParams.get('limit')

    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Mode must be "demo" or "real"' }, { status: 400 })
    }

    const client = await createBybitClient(mode)
    const closedPnl = await client.getClosedPnl({
      symbol,
      startTime: startTimeStr ? Number(startTimeStr) : undefined,
      endTime: endTimeStr ? Number(endTimeStr) : undefined,
      limit: limitStr ? Math.min(Number(limitStr), 100) : 50,
    })

    // Calculate summary stats
    const totalRealizedPnl = closedPnl.reduce((sum, t) => sum + Number(t.closedPnl), 0)
    const wins = closedPnl.filter(t => Number(t.closedPnl) > 0)
    const losses = closedPnl.filter(t => Number(t.closedPnl) <= 0)
    const totalFees = closedPnl.reduce((sum, t) => {
      // Bybit closedPnl is net (after fees), so fees are already deducted
      // We can estimate gross PnL + fees for display
      const qty = Number(t.qty)
      const entryPrice = Number(t.avgEntryPrice)
      const exitPrice = Number(t.avgExitPrice)
      const notional = qty * Math.max(entryPrice, exitPrice)
      // Approximate taker fee (0.055% for UTA VIP0)
      const estFee = notional * 0.00055
      return sum + estFee * 2 // entry + exit
    }, 0)

    return NextResponse.json({
      success: true,
      mode,
      trades: closedPnl.map(t => ({
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        leverage: t.leverage,
        orderType: t.orderType,
        execType: t.execType,
        avgEntryPrice: t.avgEntryPrice,
        avgExitPrice: t.avgExitPrice,
        closedPnl: t.closedPnl,  // NET PnL (after fees) from Bybit
        fillCount: t.fillCount,
        createdTime: t.createdTime,
        updatedTime: t.updatedTime,
      })),
      summary: {
        totalTrades: closedPnl.length,
        totalRealizedPnl,
        wins: wins.length,
        losses: losses.length,
        winRate: closedPnl.length > 0 ? (wins.length / closedPnl.length) * 100 : 0,
        avgWin: wins.length > 0 ? wins.reduce((s, t) => s + Number(t.closedPnl), 0) / wins.length : 0,
        avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + Number(t.closedPnl), 0) / losses.length : 0,
        estimatedFees: totalFees,
      },
      lastUpdated: Date.now(),
    })
  } catch (error: any) {
    console.error('[/api/bybit/futures/closed-pnl] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, trades: [], summary: null },
      { status: 500 }
    )
  }
}
