import { NextRequest, NextResponse } from 'next/server'

// Simple proxy to Binance public klines API (no auth needed)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol') || 'BTCUSDT'
    const interval = searchParams.get('interval') || '1d'
    const limit = searchParams.get('limit') || '500'
    const startTime = searchParams.get('startTime')

    const params = new URLSearchParams({ symbol, interval, limit })
    if (startTime) params.set('startTime', startTime)

    // Use AbortController + longer timeout for large kline requests
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    let res: Response
    try {
      res = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`, {
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Binance API error: ${res.status}` }, { status: res.status })
    }

    // Use text() + JSON.parse to avoid timeout on large streaming responses
    const text = await res.text()
    const data = JSON.parse(text)
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
