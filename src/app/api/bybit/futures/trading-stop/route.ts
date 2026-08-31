// ─── Bybit Futures Trading Stop API ──────────────────────────────────────────
// POST /api/bybit/futures/trading-stop
// Updates the native SL/TP/trailing stop for an existing open position on Bybit.
// This is CRITICAL for REAL mode: when the UI trailing stop moves, we must sync
// it to Bybit so the exchange protects the position even if the browser crashes.
//
// Bybit V5: POST /v5/position/trading-stop
// Parameters: category, symbol, stopLoss, takeProfit, trailingStop, tpslMode, slTriggerBy, tpTriggerBy
//
// Body: { symbol, mode, stopLoss?, takeProfit?, trailingStop?, tpslMode? }

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import { log, warn } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface TradingStopRequest {
  symbol: string           // e.g. 'BTCUSDT'
  mode: BybitMode          // 'demo' or 'real'
  side?: 'Buy' | 'Sell'   // P0 FIX: position side needed for Hedge mode positionIdx
  stopLoss?: number        // New SL price
  slTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
  takeProfit?: number      // New TP price
  tpTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
  trailingStop?: number    // Trailing stop distance as percentage (e.g. 0.5 = 0.5%)
  tpslMode?: 'Full' | 'Partial'
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 20, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = await request.json() as TradingStopRequest
    const { symbol, mode, side, stopLoss, slTriggerBy, takeProfit, tpTriggerBy, trailingStop, tpslMode } = body

    // ── Validate ──
    if (!symbol || !mode) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: symbol, mode' },
        { status: 400 }
      )
    }
    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json(
        { success: false, error: 'Mode must be "demo" or "real"' },
        { status: 400 }
      )
    }
    // At least one stop parameter must be provided
    if (!stopLoss && !takeProfit && !trailingStop) {
      return NextResponse.json(
        { success: false, error: 'At least one of stopLoss, takeProfit, or trailingStop must be provided' },
        { status: 400 }
      )
    }

    // Get instrument info for price decimal rounding
    const { getCachedInstrument } = await import('@/lib/bybit-instrument-cache')
    const cached = getCachedInstrument(symbol)
    const priceDecimals = cached?.priceDecimals ?? 2  // fallback to 2 decimals

    const client = await createBybitClient(mode)

    const params: Parameters<typeof client.setTradingStop>[0] = {
      symbol,
      ...(side ? { side } : {}),  // P0 FIX: pass side for Hedge mode positionIdx
    }

    if (stopLoss && stopLoss > 0) {
      params.stopLoss = stopLoss.toFixed(priceDecimals)
      params.slTriggerBy = slTriggerBy || 'MarkPrice'
    }
    if (takeProfit && takeProfit > 0) {
      params.takeProfit = takeProfit.toFixed(priceDecimals)
      params.tpTriggerBy = tpTriggerBy || 'MarkPrice'
    }
    if (trailingStop && trailingStop > 0) {
      // Bybit trailing stop is in percentage with 1 decimal precision (e.g. '0.5')
      params.trailingStop = trailingStop.toFixed(1)
    }
    if (tpslMode) {
      params.tpslMode = tpslMode
    }

    const result = await client.setTradingStop(params)

    if (result.success) {
      log(`[futures/trading-stop] ${symbol} SL=${stopLoss?.toFixed(priceDecimals) || '-'} TP=${takeProfit?.toFixed(priceDecimals) || '-'} trail=${trailingStop || '-'} OK`)
      return NextResponse.json({
        success: true,
        symbol,
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null,
        trailingStop: trailingStop || null,
        retCode: result.retCode,
      })
    } else {
      warn(`[futures/trading-stop] ${symbol} FAILED: ${result.retMsg}`)
      return NextResponse.json({
        success: false,
        error: result.retMsg || 'Unknown Bybit error',
        retCode: result.retCode,
      }, { status: 502 })
    }
  } catch (error: any) {
    warn(`[futures/trading-stop] error: ${error.message}`)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
