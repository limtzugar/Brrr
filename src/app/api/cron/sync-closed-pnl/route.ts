// ─── Cron: Sync Closed PnL from Bybit ────────────────────────────────
// Called every 2 minutes by the scheduler. Fetches closed positions from Bybit
// and stores them in the database (AppSettings) as the authoritative PnL source.
//
// GET /api/cron/sync-closed-pnl?token=xxx&mode=real|demo
//
// Bybit's closedPnl is NET (after fees) — the definitive realized profit.
// This ensures UI always shows the correct Bybit-verified PnL, not the
// locally computed value which can drift due to:
// - Fee calculation differences (VIP tiers, taker vs maker)
// - Partial fills with different prices
// - Funding rate deductions
// - SL/TP trigger price vs fill price slippage

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { db } from '@/lib/db'

// SECURITY: no hardcoded fallback — route disabled unless CRON_SECRET is set
const CRON_SECRET = process.env.CRON_SECRET

// In-memory cache of last sync to avoid duplicate processing
let lastSyncTimestamp: number = 0
let lastSyncResult: { totalPnl: number; tradeCount: number; timestamp: number } | null = null

export async function GET(req: NextRequest) {
  // Auth check
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET env var not set — sync disabled' }, { status: 503 })
  }
  const token = req.headers.get('x-cron-secret') || ''
  if (token !== CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const mode = (req.nextUrl.searchParams.get('mode') || 'real') as BybitMode

  try {
    const client = await createBybitClient(mode)

    // Get closed PnL from last 24 hours (sufficient for 2-min sync interval)
    // We use the startTime to limit API response size
    const startTime = Date.now() - 24 * 60 * 60 * 1000
    const closedPnl = await client.getClosedPnl({
      startTime,
      limit: 100,
    })

    if (closedPnl.length === 0) {
      lastSyncResult = { totalPnl: 0, tradeCount: 0, timestamp: Date.now() }
      return NextResponse.json({
        success: true,
        mode,
        tradeCount: 0,
        totalPnl: 0,
        message: 'No closed trades in last 24h',
        lastUpdated: Date.now(),
      })
    }

    // Calculate total realized PnL from Bybit (NET, after fees)
    const totalRealizedPnl = closedPnl.reduce((sum, t) => sum + Number(t.closedPnl), 0)

    // Store the synced data in AppSettings for the frontend to read
    // This allows the UI to compare its local PnL tracking with Bybit's authoritative value
    const syncData = {
      mode,
      totalRealizedPnl,
      tradeCount: closedPnl.length,
      trades: closedPnl.map(t => ({
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        avgEntryPrice: t.avgEntryPrice,
        avgExitPrice: t.avgExitPrice,
        closedPnl: Number(t.closedPnl),
        createdTime: t.createdTime,
        updatedTime: t.updatedTime,
      })),
      syncedAt: Date.now(),
    }

    // Persist to AppSettings
    const settingsKey = `bybit_closed_pnl_sync_${mode}`
    await db.appSettings.upsert({
      where: { key: settingsKey },
      update: { value: JSON.stringify(syncData) },
      create: { key: settingsKey, value: JSON.stringify(syncData) },
    })

    // Also store a summary for quick reads
    const summaryKey = `bybit_closed_pnl_summary_${mode}`
    const summaryData = {
      totalRealizedPnl,
      tradeCount: closedPnl.length,
      wins: closedPnl.filter(t => Number(t.closedPnl) > 0).length,
      losses: closedPnl.filter(t => Number(t.closedPnl) <= 0).length,
      lastTradeTime: closedPnl[0]?.updatedTime || null,
      syncedAt: Date.now(),
    }
    await db.appSettings.upsert({
      where: { key: summaryKey },
      update: { value: JSON.stringify(summaryData) },
      create: { key: summaryKey, value: JSON.stringify(summaryData) },
    })

    lastSyncTimestamp = Date.now()
    lastSyncResult = { totalPnl: totalRealizedPnl, tradeCount: closedPnl.length, timestamp: Date.now() }

    return NextResponse.json({
      success: true,
      mode,
      tradeCount: closedPnl.length,
      totalRealizedPnl,
      wins: closedPnl.filter(t => Number(t.closedPnl) > 0).length,
      losses: closedPnl.filter(t => Number(t.closedPnl) <= 0).length,
      syncedAt: Date.now(),
    })
  } catch (error: any) {
    console.error('[/api/cron/sync-closed-pnl] error:', error.message)
    return NextResponse.json({
      success: false,
      error: error.message,
      syncedAt: Date.now(),
    }, { status: 500 })
  }
}
