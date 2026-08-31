// ─── Cron: SPOT "Górki i Dołki" engine (headless paper, MACD+RSI) ───────────
// POST /api/cron/spot-macd-rsi  → run one tick
// GET  /api/cron/spot-macd-rsi  → read-only state
// Guard: CRON_SECRET env (503 when unset — no fallback, audit 2026-07-31).

import { NextRequest, NextResponse } from 'next/server'
import { runSpotTick, getSpotState } from '@/lib/spot-macd-rsi-engine'

const CRON_SECRET = process.env.CRON_SECRET
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const token = req.headers.get('x-cron-secret') || ''
  return token === CRON_SECRET
}

export async function POST(req: NextRequest) {
  if (!CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET env var not set — spot engine disabled' }, { status: 503 })
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runSpotTick())
  } catch (e) {
    console.error('[/api/cron/spot-macd-rsi] tick error:', e)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'tick failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET env var not set — spot engine disabled' }, { status: 503 })
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await getSpotState())
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'state read failed' }, { status: 500 })
  }
}
