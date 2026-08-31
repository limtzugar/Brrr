import { NextRequest, NextResponse } from 'next/server'

// ─── MEXC Spot Ticker Proxy ────────────────────────────────────────────────
// GET /api/mexc/ticker?symbols=TSLAXUSDT,NVDAXUSDT,BTCUSDT
// Returns: { TSLAXUSDT: { price, bid, ask, change24h, vol24h }, ... }

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols') || ''

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Missing symbols parameter' }, { status: 400 })
    }

    const symbols = symbolsParam.split(',').filter(Boolean)

    // Fetch 24h ticker for all requested symbols in parallel
    const results: Record<string, { price: number; bid: number; ask: number; change24h: number; vol24h: number }> = {}

    const fetches = symbols.map(async (sym) => {
      try {
        const res = await fetch(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'Accept': 'application/json' },
        })
        if (!res.ok) return
        const data = await res.json()
        results[sym] = {
          price: parseFloat(data.lastPrice) || 0,
          bid: parseFloat(data.bidPrice) || 0,
          ask: parseFloat(data.askPrice) || 0,
          change24h: parseFloat(data.priceChangePercent) || 0,
          vol24h: parseFloat(data.quoteVolume) || 0,
        }
      } catch {
        // Symbol not found or error — skip
      }
    })

    await Promise.all(fetches)

    return NextResponse.json(results)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
