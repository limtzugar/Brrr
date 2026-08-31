// ─── Cron: CEX CROWD Engine (headless paper scalper) ────────────────────────
// POST /api/cron/cex-crowd-engine  → run one engine tick (entries + exits)
// GET  /api/cron/cex-crowd-engine  → read-only engine state
// Guard: CRON_SECRET env (503 when unset — no fallback, audit 2026-07-31).

import { NextRequest, NextResponse } from 'next/server'
import { runCrowdEngineTick, getCrowdEngineState } from '@/lib/cex-crowd-engine'

const CRON_SECRET = process.env.CRON_SECRET

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-cron-secret') || ''
  return token === CRON_SECRET
}

export async function POST(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET env var not set — cex-crowd engine disabled' }, { status: 503 })
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runCrowdEngineTick()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/cron/cex-crowd-engine] tick error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'engine tick failed' },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET env var not set — cex-crowd engine disabled' }, { status: 503 })
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await getCrowdEngineState())
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'state read failed' },
      { status: 500 },
    )
  }
}
