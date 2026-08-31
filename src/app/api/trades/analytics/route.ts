import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const batch = searchParams.get('batch')
    const pair = searchParams.get('pair')
    const trigger = searchParams.get('trigger')

    const where: Record<string, unknown> = {}
    if (batch) where.importBatch = batch
    if (pair) where.pair = pair
    if (trigger) where.trigger = trigger

    const trades = await db.importedTrade.findMany({
      where,
      orderBy: { closedAt: 'desc' },
      take: 50000,
    })

    if (trades.length === 0) {
      return NextResponse.json({
        total: 0,
        message: 'No imported transactions. Use Import CSV.',
      })
    }

    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const wins = trades.filter(t => t.pnl > 0)
    const losses = trades.filter(t => t.pnl <= 0)
    const winRate = (wins.length / trades.length) * 100
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0

    const byPair = new Map<string, { pnl: number; count: number; wins: number }>()
    const byTrigger = new Map<string, { pnl: number; count: number; wins: number }>()
    const byResult = new Map<string, { pnl: number; count: number }>()

    for (const t of trades) {
      const pp = byPair.get(t.pair) ?? { pnl: 0, count: 0, wins: 0 }
      pp.pnl += t.pnl; pp.count++; if (t.pnl > 0) pp.wins++
      byPair.set(t.pair, pp)

      const tp = byTrigger.get(t.trigger) ?? { pnl: 0, count: 0, wins: 0 }
      tp.pnl += t.pnl; tp.count++; if (t.pnl > 0) tp.wins++
      byTrigger.set(t.trigger, tp)

      const br = byResult.get(t.result) ?? { pnl: 0, count: 0 }
      br.pnl += t.pnl; br.count++
      byResult.set(t.result, br)
    }

    const pairStats = [...byPair.entries()]
      .map(([pair, s]) => ({ pair, ...s, winRate: (s.wins / s.count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl)

    const triggerStats = [...byTrigger.entries()]
      .map(([trigger, s]) => ({ trigger, ...s, winRate: (s.wins / s.count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl)

    const tps = trades.filter(t => t.result === 'TP' && t.movePct != null)
    const stops = trades.filter(t => t.result === 'STOP' && t.movePct != null)
    const avgTpMove = tps.length ? tps.reduce((s, t) => s + (t.movePct ?? 0), 0) / tps.length : 0
    const avgStopMove = stops.length ? stops.reduce((s, t) => s + Math.abs(t.movePct ?? 0), 0) / stops.length : 0

    // Daily PnL for chart
    const dailyMap = new Map<string, { pnl: number; count: number }>()
    for (const t of trades) {
      const day = t.closedAt.slice(0, 10)
      const d = dailyMap.get(day) ?? { pnl: 0, count: 0 }
      d.pnl += t.pnl; d.count++
      dailyMap.set(day, d)
    }
    const dailyPnl = [...dailyMap.entries()]
      .map(([date, s]) => ({ date, ...s }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const batches = await db.importedTrade.groupBy({
      by: ['importBatch'],
      _count: { id: true },
      _sum: { pnl: true },
    })

    return NextResponse.json({
      total: trades.length,
      totalPnl: Math.round(totalPnl * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: wins.length ? Math.round((grossWin / wins.length) * 10000) / 10000 : 0,
      avgLoss: losses.length ? Math.round((grossLoss / losses.length) * 10000) / 10000 : 0,
      avgTpMovePct: Math.round(avgTpMove * 10000) / 10000,
      avgStopMovePct: Math.round(avgStopMove * 10000) / 10000,
      rrRatio: avgStopMove > 0 ? Math.round((avgTpMove / avgStopMove) * 100) / 100 : 0,
      pairStats: pairStats.slice(0, 20),
      worstPairs: [...pairStats].reverse().slice(0, 8),
      triggerStats,
      resultStats: [...byResult.entries()].map(([result, s]) => ({ result, ...s })),
      dailyPnl: dailyPnl.slice(-60),
      batches: batches.map(b => ({
        batch: b.importBatch,
        count: b._count.id,
        pnl: Math.round((b._sum.pnl ?? 0) * 100) / 100,
      })),
      recommended: {
        tpPricePct: 0.50,
        slPricePct: 0.20,
        whitelist: ['TAO-USDT', 'FIL-USDT', 'ICP-USDT', 'DOGE-USDT', 'LINK-USDT', 'AVAX-USDT'],
        blacklist: ['PEPE-USDT', 'ETH-USDT', 'BNB-USDT', 'ADA-USDT', 'ZEC-USDT', 'BTC-USDT'],
      },
    })
  } catch (error) {
    console.error('[/api/trades/analytics] error:', error)
    return NextResponse.json({ error: 'Analytics failed' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const count = await db.importedTrade.deleteMany()
    return NextResponse.json({ success: true, deleted: count.count })
  } catch (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}