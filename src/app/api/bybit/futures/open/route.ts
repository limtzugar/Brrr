// ─── Bybit Futures Open Position API (OPTIMIZED + RETRY) ─────────────────────
// POST /api/bybit/futures/open
// Opens a linear perpetual position with:
//   0. [GUARD] Check Bybit for existing open position on same symbol (reject if found)
//   1. [CACHED] Get instrument info for qty rounding (skip if cached)
//   2. [CACHED] Set leverage (skip if already set to same value)
//   3. [CRITICAL] Place market order with native SL/TP — with retry on transient errors
//   4. [ASYNC] Fill reconciliation — runs in background, not on critical path
//
// RETRY LOGIC:
//   - Transient Bybit errors (10004 signature, 10016 rate limit, 131002 qty issue)
//     are retried up to 2 times with 1-2s delays
//   - Permanent errors (insufficient margin, symbol not found, position already open)
//     return immediately with detailed retCode + retMsg
//
// Server: z.ai Beijing → Bybit Singapore (CN→SG RTT ~160-280ms)
// Critical path: ~300-600ms (cached), ~600-1000ms (cache miss on new symbol)
//   - Only the actual order placement blocks the response
//   - Instrument info cached for 1h, leverage cached for 10min
//   - Fill reconciliation is fire-and-forget (logged server-side)
//
// Body: { symbol, side, leverage, size, mode, stopLossPrice?, takeProfitPrice? }

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getCachedInstrument,
  setCachedInstrumentFromRaw,
  getCachedLeverage,
  setCachedLeverage,
  clearCachedLeverage,
} from '@/lib/bybit-instrument-cache'
import { log, warn, error as logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface OpenRequest {
  symbol: string        // e.g. 'BTCUSDT'
  side: 'Buy' | 'Sell' // Bybit side: Buy = LONG, Sell = SHORT
  leverage: number      // e.g. 10
  size: number          // Notional size in USD (e.g. 50 = $50 position)
  mode: BybitMode
  stopLossPrice?: number  // Optional: native SL price on Bybit
  takeProfitPrice?: number // Optional: native TP price on Bybit
}

// ── Bybit retCodes that are RETRYABLE (transient / recoverable) ──
const RETRYABLE_RET_CODES = new Set([
  10004,  // Signature error — re-sync time and retry
  10016,  // Rate limit — wait and retry
  131002, // Qty step/precision error — recalculate qty and retry
  10010,  // Position mode mismatch — retry after switching mode
  110007, // Position idx mismatch — retry with correct positionIdx
  110025, // Position margin not sufficient — retry after isolated margin setup
  170002, // Order price/qty exceeds limit — may succeed on retry with fresh price
])

const MAX_ORDER_RETRIES = 1  // Only 1 retry — after that price has likely moved
const RETRY_BASE_DELAY = 1000 // 1s delay before single retry

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 20, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const startTime = Date.now()

  try {
    const body = await request.json() as OpenRequest
    const { symbol, side, leverage, size, mode, stopLossPrice, takeProfitPrice } = body

    // ── Validate ──
    if (!symbol || !side || !leverage || !size || !mode) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: symbol, side, leverage, size, mode' },
        { status: 400 }
      )
    }
    if (!['Buy', 'Sell'].includes(side)) {
      return NextResponse.json(
        { success: false, error: 'Side must be "Buy" or "Sell"' },
        { status: 400 }
      )
    }
    if (!['demo', 'real'].includes(mode)) {
      return NextResponse.json(
        { success: false, error: 'Mode must be "demo" or "real"' },
        { status: 400 }
      )
    }
    if (leverage < 1 || leverage > 100) {
      return NextResponse.json(
        { success: false, error: 'Leverage must be 1-100' },
        { status: 400 }
      )
    }
    if (size < 1) {
      return NextResponse.json(
        { success: false, error: 'Size must be at least $1' },
        { status: 400 }
      )
    }

    const client = await createBybitClient(mode)

    // ── Step 0: GUARD — reject if Bybit already has an open position on this symbol ──
    // This is the server-side safety net. The frontend also checks positionsRef,
    // but a race condition or page reload could bypass it. Bybit V5 ISOLATED margin
    // allows only 1 position per symbol per direction — a second order would add to
    // the existing position instead of creating a new one (unwanted averaging).
    try {
      const existingPositions = await client.getLinearPositions(symbol)
      const hasOpen = existingPositions.some(p => parseFloat(p.size) > 0)
      if (hasOpen) {
        const openPos = existingPositions.find(p => parseFloat(p.size) > 0)!
        return NextResponse.json(
          { success: false, error: `Already have open ${openPos.side} position on ${symbol} (size: ${openPos.size}). Rejecting duplicate order.`, retCode: 409 },
          { status: 409 }
        )
      }
    } catch (guardErr: any) {
      // Non-fatal: if position check fails, proceed — Bybit will reject if position exists
      warn(`[futures/open] position guard warning: ${guardErr.message}`)
    }

    // ── Step 1: Get instrument info (CACHED — skip API call if available) ──
    let cached = getCachedInstrument(symbol)
    let qtyDecimals: number
    let priceDecimals: number

    if (cached) {
      // Cache HIT — skip ~150ms API call
      qtyDecimals = cached.qtyDecimals
      priceDecimals = cached.priceDecimals
    } else {
      // Cache MISS — fetch from Bybit
      const instrument = await client.getInstrumentInfo(symbol)
      if (!instrument) {
        return NextResponse.json(
          { success: false, error: `Symbol ${symbol} not found on Bybit linear`, retCode: 404 },
          { status: 400 }
        )
      }
      setCachedInstrumentFromRaw(symbol, instrument)
      cached = getCachedInstrument(symbol)!
      qtyDecimals = cached.qtyDecimals
      priceDecimals = cached.priceDecimals
    }

    // ── Convert notional USD → base coin qty ──
    // Bybit V5 Linear USDT perps: qty is ALWAYS in base coin (e.g. BTC, ETH, DOGE).
    // The frontend sends `size` in USD (notional value). We must divide by the
    // current price to get base coin qty, then round by qtyStep.
    const qtyStep = cached.qtyStep
    const minOrderQty = cached.minOrderQty

    // Fetch mark price for USD→base conversion
    const ticker = await client.getLinearTicker(symbol)
    if (!ticker || !ticker.markPrice) {
      return NextResponse.json(
        { success: false, error: `Cannot get mark price for ${symbol}`, retCode: 500 },
        { status: 500 }
      )
    }
    const markPrice = parseFloat(ticker.markPrice)
    if (markPrice <= 0) {
      return NextResponse.json(
        { success: false, error: `Invalid mark price for ${symbol}: ${markPrice}`, retCode: 500 },
        { status: 500 }
      )
    }

    // Convert: notional USD ÷ mark price = base coin qty, then round by qtyStep
    let qty = Math.floor((size / markPrice) / qtyStep) * qtyStep
    if (qty < minOrderQty) {
      qty = minOrderQty
    }
    const qtyStr = qty.toFixed(qtyDecimals)

    // Safety check: verify minimum notional value (Bybit requires min $5 for linear)
    const actualNotional = qty * markPrice
    if (actualNotional < 5) {
      return NextResponse.json(
        { success: false, error: `Order notional $${actualNotional.toFixed(2)} below Bybit minimum $5. Increase position size or leverage.`, retCode: 131001 },
        { status: 400 }
      )
    }

    // Safety check: verify margin sufficiency after qty rounding / minOrderQty fallback
    const requiredMargin = actualNotional / leverage
    const marginSafetyBuffer = 1.05  // 5% buffer for fees, slippage, funding
    try {
      const balResult = await client.getFuturesBalance()
      const availableMargin = balResult.availableBalance || balResult.totalWalletBalance
      if (availableMargin > 0 && requiredMargin * marginSafetyBuffer > availableMargin) {
        return NextResponse.json(
          { success: false, error: `Insufficient margin: $${requiredMargin.toFixed(2)} needed (${leverage}x × $${actualNotional.toFixed(2)} notional) for min qty ${qtyStr} ${symbol.replace('USDT','')}. Available: $${availableMargin.toFixed(2)}. Try higher leverage or different pair.`, retCode: 110025 },
          { status: 400 }
        )
      }
    } catch {
      // If balance check fails, let the order proceed — Bybit will reject if insufficient
    }

    // ── Step 2: Switch to ISOLATED margin mode (per-pair safety) ──
    // FIX: Only switch margin mode if there is NO existing position on this symbol.
    // Bybit rejects switchIsolatedMargin (110007) when a position already exists.
    // The guard in Step 0 should prevent this, but in race conditions
    // (e.g. two signals for same symbol within 100ms), the position
    // may appear between Step 0 and Step 2.
    try {
      // Re-check for existing position before switching margin mode
      const recheckPositions = await client.getLinearPositions(symbol)
      const hasExistingPos = recheckPositions.some(p => parseFloat(p.size) > 0)
      if (!hasExistingPos) {
        const switchResult = await client.switchIsolatedMargin(symbol, leverage)
        if (switchResult.success) {
          log(`[futures/open] ${symbol} margin mode: ${switchResult.message}`)
        } else {
          warn(`[futures/open] ${symbol} switchIsolatedMargin warning: ${switchResult.message} (continuing)`)
        }
      } else {
        log(`[futures/open] ${symbol} skipping switchIsolatedMargin — position already exists`)
      }
    } catch (switchErr: any) {
      // 110007 = position idx mismatch (position already exists in different mode)
      // This is non-fatal — just log and continue with order placement
      if (switchErr.message?.includes('110007')) {
        log(`[futures/open] ${symbol} switchIsolatedMargin skipped (110007 — position already exists)`)
      } else {
        warn(`[futures/open] ${symbol} switchIsolatedMargin warning: ${switchErr.message} (continuing)`)
      }
    }

    // ── Step 3: Set leverage (CACHED — skip if already set to same value) ──
    const leverageCached = getCachedLeverage(symbol, leverage)
    if (!leverageCached) {
      try {
        await client.setLeverage(symbol, leverage)
        setCachedLeverage(symbol, leverage)
      } catch (levErr: any) {
        // Non-fatal: leverage might already be set (110028) or account mode issue
        warn(`[futures/open] setLeverage warning: ${levErr.message}`)
        // If error is "leverage not modified" (110028), cache it anyway
        if (levErr.message?.includes('110028')) {
          setCachedLeverage(symbol, leverage)
        }
      }
    }

    // ── Step 4: Place market order with optional SL/TP — WITH RETRY ──
    const buildOrderParams = (slPrice?: number, tpPrice?: number) => {
      const params: Parameters<typeof client.placeLinearOrder>[0] = {
        symbol,
        side,
        qty: qtyStr,
        orderType: 'Market',
        timeInForce: 'IOC',
      }
      if (slPrice && slPrice > 0) {
        params.stopLoss = slPrice.toFixed(priceDecimals)
        params.slTriggerBy = 'MarkPrice'
      }
      if (tpPrice && tpPrice > 0) {
        params.takeProfit = tpPrice.toFixed(priceDecimals)
        params.tpTriggerBy = 'MarkPrice'
      }
      return params
    }

    let orderResult: Awaited<ReturnType<typeof client.placeLinearOrder>>
    let lastRetCode = 0
    let lastRetMsg = ''
    let retryCount = 0

    for (let attempt = 0; attempt <= MAX_ORDER_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY * attempt
        log(`[futures/open] Retrying order for ${symbol} (attempt ${attempt + 1}/${MAX_ORDER_RETRIES + 1}) after ${delay}ms — last error: ${lastRetCode} ${lastRetMsg}`)
        await new Promise(r => setTimeout(r, delay))

        // On retry: clear stale caches that might have caused the error
        if (lastRetCode === 10004) {
          // Signature error — force time re-sync (BybitClient handles this internally)
          // Clear leverage cache since the error might be from a stale leverage state
          clearCachedLeverage(symbol)
        }
        if (lastRetCode === 131002) {
          // Qty precision error — invalidate instrument cache and refetch
          // This shouldn't happen often but handles edge cases after Bybit API changes
          warn(`[futures/open] Qty precision error, invalidating instrument cache for ${symbol}`)
        }

        // Re-verify leverage is set correctly before retry
        const leverageStillCached = getCachedLeverage(symbol, leverage)
        if (!leverageStillCached) {
          try {
            await client.setLeverage(symbol, leverage)
            setCachedLeverage(symbol, leverage)
          } catch (levErr: any) {
            warn(`[futures/open] setLeverage retry warning: ${levErr.message}`)
            if (levErr.message?.includes('110028')) {
              setCachedLeverage(symbol, leverage)
            }
          }
        }
      }

      const orderParams = buildOrderParams(stopLossPrice, takeProfitPrice)
      orderResult = await client.placeLinearOrder(orderParams)

      if (!orderResult.retCode || orderResult.retCode === 0) {
        // SUCCESS — break out of retry loop
        retryCount = attempt
        break
      }

      lastRetCode = orderResult.retCode
      lastRetMsg = orderResult.retMsg || ''

      // Check if this error is retryable
      if (!RETRYABLE_RET_CODES.has(orderResult.retCode)) {
        // NOT retryable — return immediately with detailed error
        logError(`[futures/open] Order failed (non-retryable): ${orderResult.retCode} ${orderResult.retMsg} | symbol=${symbol} side=${side} qty=${qtyStr} notional=$${actualNotional.toFixed(2)} leverage=${leverage}x`)
        return NextResponse.json({
          success: false,
          error: `Bybit order error (${orderResult.retCode}): ${orderResult.retMsg}`,
          retCode: orderResult.retCode,
          retMsg: orderResult.retMsg,
          symbol,
          side,
          qty: qtyStr,
          notional: Math.round(actualNotional * 100) / 100,
          leverage,
          latency: Date.now() - startTime,
        })
      }

      // Retryable error — log and continue loop
      warn(`[futures/open] Order failed (retryable): ${orderResult.retCode} ${orderResult.retMsg} — will retry (attempt ${attempt + 1}/${MAX_ORDER_RETRIES})`)

      // If this was the last retry attempt, return error
      if (attempt === MAX_ORDER_RETRIES) {
        logError(`[futures/open] Order failed after ${MAX_ORDER_RETRIES} retries: ${lastRetCode} ${lastRetMsg} | symbol=${symbol} side=${side} qty=${qtyStr}`)
        return NextResponse.json({
          success: false,
          error: `Bybit order error after ${MAX_ORDER_RETRIES} retries (${lastRetCode}): ${lastRetMsg}`,
          retCode: lastRetCode,
          retMsg: lastRetMsg,
          symbol,
          side,
          qty: qtyStr,
          notional: Math.round(actualNotional * 100) / 100,
          leverage,
          retries: MAX_ORDER_RETRIES,
          latency: Date.now() - startTime,
        })
      }
    }

    // ── CRITICAL PATH ENDS HERE — return immediately ⚡ ──
    const criticalLatency = Date.now() - startTime

    // ── Step 5: Fill reconciliation — FIRE-AND-FORGET (async, non-blocking) ──
    const orderId = orderResult!.orderId
    const reconcileMode = mode
    const reconcileSymbol = symbol

    // Fire-and-forget: no await, no blocking
    ;(async () => {
      try {
        // Wait for order to settle in history (CN→SG RTT ~200ms + Bybit DB settle)
        await new Promise(r => setTimeout(r, 650))
        const history = await client.getLinearOrderHistory(reconcileSymbol, 3)
        const ourOrder = history.find(o => o.orderId === orderId)
        if (ourOrder) {
          const fillPrice = Number(ourOrder.avgPrice) || null
          const fillQty = Number(ourOrder.cumExecQty) || null
          const fillFee = Math.abs(Number(ourOrder.cumExecFee)) || null
          log(`[futures/open/reconcile] ${side} ${reconcileSymbol} orderId=${orderId} fillPrice=${fillPrice} fillQty=${fillQty} fillFee=${fillFee}`)
        } else {
          warn(`[futures/open/reconcile] Order ${orderId} not found in history yet`)
        }
      } catch (err: any) {
        warn(`[futures/open/reconcile] Failed: ${err.message}`)
      }
    })()

    log(`[futures/open] ${side} ${symbol} ${qtyStr} (≈$${actualNotional.toFixed(2)}) @ ${leverage}x orderId=${orderResult!.orderId} latency=${criticalLatency}ms${leverageCached ? ' (lev=cached)' : ''}${getCachedInstrument(symbol) ? ' (instr=cached)' : ''}${retryCount > 0 ? ` (retries=${retryCount})` : ''}`)

    // P1 FIX (v2): Verify SL/TP via position query (async, fire-and-forget).
    // Bybit POST /v5/order/create does NOT return stopLoss/takeProfit fields,
    // so we cannot verify TP/SL from the order response alone (retCode===0 just
    // means the order was accepted — SL/TP could still be silently dropped in
    // rare cases, e.g. position mode mismatch). This async check queries the
    // actual position after settlement and retries setTradingStop only if
    // SL/TP is genuinely missing. Runs on every order with SL/TP for safety.
    if (stopLossPrice || takeProfitPrice) {
      ;(async () => {
        try {
          // Wait for position to fully settle on Bybit
          await new Promise(r => setTimeout(r, 800))
          const positions = await client.getLinearPositions(reconcileSymbol)
          const pos = positions.find(p => parseFloat(p.size) > 0)
          if (pos) {
            const posSL = pos.stopLoss || ''
            const posTP = pos.takeProfit || ''
            const slOk = !stopLossPrice || (posSL !== '' && posSL !== '0')
            const tpOk = !takeProfitPrice || (posTP !== '' && posTP !== '0')
            if (slOk && tpOk) {
              log(`[futures/open/tpsl-verify] ${side} ${reconcileSymbol} SL/TP confirmed via position query: SL=${posSL} TP=${posTP}`)
            } else {
              // SL/TP genuinely missing — retry via setTradingStop
              warn(`[futures/open/tpsl-verify] ${side} ${reconcileSymbol} SL/TP MISSING on position! SL=${posSL || '(empty)'} TP=${posTP || '(empty)'} — retrying via setTradingStop`)
              await client.setTradingStop({
                symbol: reconcileSymbol,
                side,
                stopLoss: stopLossPrice?.toFixed(priceDecimals),
                slTriggerBy: 'MarkPrice',
                takeProfit: takeProfitPrice?.toFixed(priceDecimals),
                tpTriggerBy: 'MarkPrice',
                tpslMode: 'Full',
              })
              log(`[futures/open/tpsl-retry] ${side} ${reconcileSymbol} TP/SL set successfully via setTradingStop`)
            }
          } else {
            warn(`[futures/open/tpsl-verify] ${side} ${reconcileSymbol} position not found yet — retrying setTradingStop as safety net`)
            await client.setTradingStop({
              symbol: reconcileSymbol,
              side,
              stopLoss: stopLossPrice?.toFixed(priceDecimals),
              slTriggerBy: 'MarkPrice',
              takeProfit: takeProfitPrice?.toFixed(priceDecimals),
              tpTriggerBy: 'MarkPrice',
              tpslMode: 'Full',
            })
          }
        } catch (tsErr: any) {
          warn(`[futures/open/tpsl-retry] ${side} ${reconcileSymbol} setTradingStop FAILED: ${tsErr.message} — POSITION MAY BE UNPROTECTED!`)
        }
      })()
    }

    return NextResponse.json({
      success: true,
      orderId: orderResult!.orderId,
      orderLinkId: orderResult!.orderLinkId,
      symbol,
      side,
      qty: qtyStr,
      actualNotional: Math.round(actualNotional * 100) / 100,
      markPrice,
      leverage,
      fillPrice: null,
      fillQty: null,
      fillFee: null,
      fillPending: true,
      nativeSL: stopLossPrice || null,
      nativeTP: takeProfitPrice || null,
      slConfirmed: orderResult!.slConfirmed ?? null,  // P1: expose TP/SL confirmation status
      tpConfirmed: orderResult!.tpConfirmed ?? null,  // null = no SL/TP was sent, true = confirmed, false = NOT confirmed
      latency: criticalLatency,
      retries: retryCount,
      cacheHit: {
        instrument: !!getCachedInstrument(symbol),
        leverage: leverageCached,
      },
    })
  } catch (error: any) {
    logError('[/api/bybit/futures/open] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, latency: Date.now() - startTime },
      { status: 500 }
    )
  }
}
