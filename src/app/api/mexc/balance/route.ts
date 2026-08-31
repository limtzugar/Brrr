// ─── MEXC Balance API ────────────────────────────────────────────────────────
// GET: Fetch current wallet balance from MEXC (demo or real)

import { NextResponse } from 'next/server'
import { createMexcClient, type MexcMode } from '@/lib/mexc'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 10, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    const { searchParams } = new URL(request.url)
    const mode = (searchParams.get('mode') || 'real') as MexcMode

    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json(
        { error: 'Mode musi być "demo" lub "real"' },
        { status: 400 }
      )
    }

    const client = await createMexcClient(mode)

    const balances = await client.getAllBalances()

    return NextResponse.json({
      mode,
      exchange: 'mexc',
      totalEquityUsdt: balances.totalEquityUsdt,
      coins: balances.coins,
      accountType: 'spot',
      serverTimeDiff: null,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/mexc/balance] error:', error)
    const msg = error instanceof Error ? error.message : 'Nieznany błąd'
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
