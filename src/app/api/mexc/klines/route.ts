import { NextRequest, NextResponse } from 'next/server'

// ─── MEXC Spot Klines Proxy ────────────────────────────────────────────────
// GET /api/mexc/klines?symbol=TSLAXUSDT&interval=15m&limit=500
// Proxies to MEXC Spot API — no auth needed.
// Returns: [[time, open, high, low, close, volume, ...], ...]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol') || 'BTCUSDT'
    const interval = searchParams.get('interval') || '15m'
    const limit = searchParams.get('limit') || '500'
    const startTime = searchParams.get('startTime')
    const endTime = searchParams.get('endTime')

    const params = new URLSearchParams({ symbol, interval, limit })
    if (startTime) params.set('startTime', startTime)
    if (endTime) params.set('endTime', endTime)

    // Use AbortController + longer timeout for kline requests
    const mCtrl = new AbortController()
    const mTmr = setTimeout(() => mCtrl.abort(), 60_000)
    let res: Response
    try {
      res = await fetch(`https://api.mexc.com/api/v3/klines?${params.toString()}`, {
        signal: mCtrl.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
    } finally {
      clearTimeout(mTmr)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ error: `MEXC API error: ${res.status}`, detail: text }, { status: res.status })
    }

    const txt = await res.text()
    const data = JSON.parse(txt)
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
