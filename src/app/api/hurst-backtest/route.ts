import { NextRequest, NextResponse } from 'next/server'
import {
  computeBB,
  computeHurst,
  computeHurstStrategySignals,
  runHurstStrategyBacktest,
} from '@/lib/cex-anomaly-helpers'

export const runtime = 'nodejs'
export const maxDuration = 60 // allow up to 60s for backtest computation

// BTC Hurst Strategy Backtest API
// Fetches historical 15m klines from Binance and runs the dual-trigger strategy.
// GET /api/hurst-backtest?symbol=BTCUSDT&interval=15m&days=90&bbPeriod=34&bbStdDev=2&hurstPeriod=50&slPct=2&tpPct=4&leverage=1&triggerLookback=10

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol') || 'BTCUSDT'
    const interval = searchParams.get('interval') || '15m'
    const days = Math.min(365, Math.max(7, Number(searchParams.get('days') || '90')))
    const bbPeriod = Number(searchParams.get('bbPeriod') || '34')
    const bbStdDev = Number(searchParams.get('bbStdDev') || '2.0')
    const hurstPeriod = Number(searchParams.get('hurstPeriod') || '50')
    const slPct = Number(searchParams.get('slPct') || '2.0')
    const tpPct = Number(searchParams.get('tpPct') || '4.0')
    const leverage = Number(searchParams.get('leverage') || '1')
    const triggerLookback = Number(searchParams.get('triggerLookback') || '10')

    // Calculate startTime from days parameter
    const endTime = Date.now()
    const startTime = endTime - days * 24 * 60 * 60 * 1000

    // Binance returns max 1000 candles per request.
    // For 15m interval: 1 day = 96 candles, 90 days = 8640 candles
    // We need to paginate to get all data
    const intervalMs: Record<string, number> = {
      '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000,
      '4h': 14400000, '1d': 86400000,
    }
    const barMs = intervalMs[interval] || 900000
    const totalBarsNeeded = Math.ceil(days * 24 * 60 * 60 * 1000 / barMs)

    const allKlines: number[][] = []
    let fetchStart = startTime
    const maxPerRequest = 1000

    // Paginate through Binance API to get all klines
    while (allKlines.length < totalBarsNeeded) {
      const params = new URLSearchParams({
        symbol,
        interval,
        startTime: String(fetchStart),
        limit: String(maxPerRequest),
      })

      // Use AbortController + longer timeout for kline pagination
      const hCtrl = new AbortController()
      const hTmr = setTimeout(() => hCtrl.abort(), 60_000)
      let hRes: Response
      try {
        hRes = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`, {
          signal: hCtrl.signal,
        })
      } finally {
        clearTimeout(hTmr)
      }

      if (!hRes.ok) {
        return NextResponse.json({ error: `Binance API error: ${hRes.status}` }, { status: hRes.status })
      }

      const hTxt = await hRes.text()
      const klines: number[][] = JSON.parse(hTxt)
      if (klines.length === 0) break

      allKlines.push(...klines)
      // Next page starts after the last candle
      fetchStart = klines[klines.length - 1][6] + 1 // [6] = closeTime

      // Don't fetch beyond now
      if (fetchStart > endTime) break
    }

    if (allKlines.length < 100) {
      return NextResponse.json({
        error: `Insufficient data: only ${allKlines.length} candles fetched. Need at least 100.`,
        candlesFetched: allKlines.length,
      }, { status: 400 })
    }

    // Extract close prices and timestamps
    const closes: number[] = []
    const timestamps: number[] = []
    for (const k of allKlines) {
      // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
      closes.push(parseFloat(String(k[4]))) // close price
      timestamps.push(Number(k[0]))          // open time
    }

    // Run the backtest
    const result = runHurstStrategyBacktest(
      closes,
      timestamps,
      bbPeriod,
      bbStdDev,
      hurstPeriod,
      triggerLookback,
      slPct,
      tpPct,
      0.10, // MEXC taker fee 0.10% round-trip
      leverage,
    )

    // Return results — trades with timestamps converted to ISO strings
    const tradesWithDates = result.trades.map(t => ({
      ...t,
      entryDate: t.timestamp ? new Date(timestamps[t.entryBar]).toISOString() : undefined,
      exitDate: t.timestamp ? new Date(timestamps[t.exitBar]).toISOString() : undefined,
    }))

    // Sample equity curve (don't return all n points if n is very large)
    const eqSampleRate = Math.max(1, Math.floor(result.equityCurve.length / 500))
    const sampledEquity = result.equityCurve.filter((_, i) => i % eqSampleRate === 0 || i === result.equityCurve.length - 1)
    const sampledTimestamps = timestamps.filter((_, i) => i % eqSampleRate === 0 || i === timestamps.length - 1)

    return NextResponse.json({
      meta: {
        symbol,
        interval,
        days,
        candlesFetched: allKlines.length,
        bbPeriod,
        bbStdDev,
        hurstPeriod,
        triggerLookback,
        slPct,
        tpPct,
        leverage,
        feePct: 0.10,
        firstCandle: timestamps[0] ? new Date(timestamps[0]).toISOString() : null,
        lastCandle: timestamps[timestamps.length - 1] ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
      },
      summary: {
        totalTrades: result.totalTrades,
        winRate: result.winRate,
        totalPnlPct: result.totalPnlPct,
        avgPnlPct: result.avgPnlPct,
        bestTradePct: result.bestTradePct,
        worstTradePct: result.worstTradePct,
        maxDrawdownPct: result.maxDrawdownPct,
        sharpeRatio: result.sharpeRatio,
        profitFactor: result.profitFactor,
        avgBarsHeld: result.avgBarsHeld,
        longTrades: result.longTrades,
        shortTrades: result.shortTrades,
        longWinRate: result.longWinRate,
        shortWinRate: result.shortWinRate,
        totalSignals: result.totalSignals,
        bbTouchCount: result.bbTouchCount,
        hurstCrossCount: result.hurstCrossCount,
      },
      trades: tradesWithDates,
      equityCurve: sampledEquity,
      equityTimestamps: sampledTimestamps,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
