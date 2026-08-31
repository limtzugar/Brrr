// ─── Strategy Status ────────────────────────────────────────────────────────
// GET: Get status of all active strategies + trade history from DB

import { NextResponse } from 'next/server'
import { getActiveStrategiesStatus } from '@/lib/strategy-runner'
import { db } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 30, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    // Get in-memory running strategies
    const activeStatus = getActiveStrategiesStatus()

    // Get all DB records (including recently stopped)
    const dbRecords = await db.activeStrategy.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        tradeLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    })

    // Build complete status
    const strategies = dbRecords.map(record => {
      const liveStatus = activeStatus.find(s => s.strategyId === record.strategyId && s.mode === record.mode)

      return {
        id: record.id,
        strategyId: record.strategyId,
        name: record.name,
        coinId: record.coinId,
        symbol: record.symbol,
        mode: record.mode,
        strategyType: liveStatus?.strategyType ?? record.strategyType ?? 'dip_buying',
        status: liveStatus ? 'running' : record.status,
        inPosition: liveStatus?.inPosition ?? record.inPosition,
        entryPrice: liveStatus?.entryPrice ?? record.entryPrice,
        entryDate: liveStatus?.entryDate ?? record.entryDate,
        currentCapital: liveStatus?.currentCapital ?? record.currentCapital,
        totalPnl: liveStatus?.totalPnl ?? record.totalPnl,
        totalTrades: liveStatus?.totalTrades ?? record.totalTrades,
        winningTrades: liveStatus?.winningTrades ?? record.winningTrades,
        lastPrice: liveStatus?.lastPrice ?? null,
        errorMessage: record.errorMessage,
        trades: record.tradeLogs.map(t => ({
          id: t.id,
          side: t.side,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          entryDate: t.entryDate,
          exitDate: t.exitDate,
          exitReason: t.exitReason,
          quantity: t.quantity,
          positionSize: t.positionSize,
          profitPct: t.profitPct,
          netProfitPct: t.netProfitPct,
          feesPaid: t.feesPaid,
          capitalAfter: t.capitalAfter,
          orderStatus: t.orderStatus,
          createdAt: t.createdAt,
        })),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
    })

    return NextResponse.json({ strategies })
  } catch (error) {
    console.error('[/api/strategies/status] Error:', error)
    return NextResponse.json(
      { error: 'Błąd pobierania statusu strategii.' },
      { status: 500 }
    )
  }
}
