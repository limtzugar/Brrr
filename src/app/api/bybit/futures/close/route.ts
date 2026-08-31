// ─── Bybit Futures Close Position API (OPTIMIZED) ────────────────────────────
// POST /api/bybit/futures/close
// Closes a linear perpetual position with a reduce-only market order.
//
// OPTIMIZATIONS vs v1:
//   1. [PARALLEL] getPositions + getInstrumentInfo + cancelAllOrders run concurrently
//   2. [CACHED] Instrument info from cache (skip ~200ms if available)
//   3. [ASYNC] Fill reconciliation is fire-and-forget (not on critical path)
//
// Server: z.ai Beijing → Bybit Singapore (CN→SG RTT ~160-280ms)
// Critical path: ~400-600ms (was ~1400ms)
//   - Parallel: verify position + cancel SL/TP + get rounding info = ~200ms
//   - Then: close order = ~230ms
//   - Return immediately, reconcile fill in background
//
// Body: { symbol, side, size, mode, cancelSLTP?: boolean }

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, type BybitMode } from '@/lib/bybit'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getCachedInstrument,
  setCachedInstrumentFromRaw,
} from '@/lib/bybit-instrument-cache'
import { log, warn, error as logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface CloseRequest {
  symbol: string        // e.g. 'BTCUSDT'
  side: 'Buy' | 'Sell' // The CLOSE side: opposite of position side
                        // Buy position → Sell to close, Sell position → Buy to close
  size: number          // Position size in USD (notional). Ignored for full close; used for partial.
  mode: BybitMode
  cancelSLTP?: boolean  // Cancel native SL/TP on close (default: true for full, false for partial)
  reduceOnly?: boolean  // If true, only reduce position (never open opposite). Used for partial TP.
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateResult = checkRateLimit(ip, 20, 60_000)
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const startTime = Date.now()

  try {
    const body = await request.json() as CloseRequest
    const { symbol, side, size, mode, cancelSLTP, reduceOnly } = body
    const isPartialClose = reduceOnly === true

    // ── Validate ──
    if (!symbol || !side || !size || !mode) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: symbol, side, size, mode' },
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

    const client = await createBybitClient(mode)

    // ── Step 1: PARALLEL — verify position + cancel SL/TP + get instrument info ──
    // These 3 calls are independent — run them concurrently to save ~300ms

    const [positionsResult, cancelResult, instrumentResult] = await Promise.all([
      // 1a: Verify position exists on Bybit
      client.getLinearPositions(symbol),
      // 1b: Cancel native SL/TP orders (non-fatal if none exist)
      // For partial close (reduce-only): DON'T cancel SL/TP — position still has remainder
      (!isPartialClose && cancelSLTP !== false)
        ? client.cancelAllLinearOrders(symbol).catch(() => null)
        : Promise.resolve(null),
      // 1c: Get instrument info for qty rounding (use cache if available)
      getCachedInstrument(symbol)
        ? Promise.resolve('cached')
        : client.getInstrumentInfo(symbol).catch(() => null),
    ])

    // Process position data
    const ourPosition = positionsResult.find(p => p.symbol === symbol)

    if (!ourPosition || Number(ourPosition.size) === 0) {
      return NextResponse.json({
        success: false,
        error: `No open position found for ${symbol}`,
        latency: Date.now() - startTime,
      })
    }

    // Determine close side: opposite of position side
    const closeSide: 'Buy' | 'Sell' = ourPosition.side === 'Buy' ? 'Sell' : 'Buy'
    const actualQty = ourPosition.size

    // For partial close (reduce-only), calculate partial qty from notional USD
    // Full close: use actualQty from Bybit (safest — always matches reality)
    // Partial close: convert notional USD → base coin qty using mark price
    let closeQty = actualQty // default: full position
    if (isPartialClose) {
      const ticker = await client.getLinearTicker(symbol).catch(() => null)
      if (ticker && ticker.markPrice) {
        const markPrice = parseFloat(ticker.markPrice)
        if (markPrice > 0) {
          const cachedInfo = getCachedInstrument(symbol)
          const qtyStep = cachedInfo?.qtyStep || 0.001
          // Convert notional USD → base coin qty, round by qtyStep
          let partialQty = Math.floor((size / markPrice) / qtyStep) * qtyStep
          if (partialQty > 0) {
            closeQty = partialQty.toFixed(cachedInfo?.qtyDecimals ?? 2)
            log(`[futures/close] Partial close: $${size} notional → ${closeQty} base @ $${markPrice.toFixed(2)}`)
          }
        }
      }
    }

    // Process instrument info (cache if freshly fetched)
    let qtyDecimals = 2 // safe default for USDT perps
    if (instrumentResult === 'cached') {
      const cached = getCachedInstrument(symbol)!
      qtyDecimals = cached.qtyDecimals
    } else if (instrumentResult && typeof instrumentResult === 'object') {
      setCachedInstrumentFromRaw(symbol, instrumentResult)
      const cached = getCachedInstrument(symbol)
      if (cached) qtyDecimals = cached.qtyDecimals
    }

    // ── Step 2: Place reduce-only market close order (CRITICAL PATH) ──
    // For full close: use closeLinearPosition (always reduceOnly=true)
    // For partial close: use placeLinearOrder with reduceOnly flag
    let closeResult
    if (isPartialClose) {
      closeResult = await client.placeLinearOrder({
        symbol,
        side: closeSide,
        qty: String(closeQty),
        orderType: 'Market',
        timeInForce: 'IOC',
        reduceOnly: true,
      })
    } else {
      closeResult = await client.closeLinearPosition({
        symbol,
        side: closeSide,
        qty: actualQty,
      })
    }

    if (closeResult.retCode && closeResult.retCode !== 0) {
      logError(`[futures/close] Close failed: ${closeResult.retCode} ${closeResult.retMsg}`)
      return NextResponse.json({
        success: false,
        error: `Bybit close error (${closeResult.retCode}): ${closeResult.retMsg}`,
        latency: Date.now() - startTime,
      })
    }

    // ── CRITICAL PATH ENDS HERE — return immediately ⚡ ──
    const criticalLatency = Date.now() - startTime
    const realizedPnl = Number(ourPosition.unrealisedPnl)

    // ── Step 3: Fill reconciliation — FIRE-AND-FORGET ──
    const orderId = closeResult.orderId
    const reconcileSymbol = symbol

    ;(async () => {
      try {
        // Wait for order to settle in history (CN→SG RTT ~200ms + Bybit DB settle)
        await new Promise(r => setTimeout(r, 650))
        const history = await client.getLinearOrderHistory(reconcileSymbol, 3)
        const ourOrder = history.find(o => o.orderId === orderId)
        if (ourOrder) {
          const fillPrice = Number(ourOrder.avgPrice) || null
          const fillFee = Math.abs(Number(ourOrder.cumExecFee)) || null
          log(`[futures/close/reconcile] ${closeSide} ${reconcileSymbol} orderId=${orderId} fillPrice=${fillPrice} fillFee=${fillFee} pnl=${realizedPnl}`)
        } else {
          warn(`[futures/close/reconcile] Order ${orderId} not found in history yet`)
        }

        // ── Post-Close Verification: Tiered Emergency Close ──
        // SAFETY PRINCIPLE: An unclosed futures position = unlimited liability.
        // But a blind market order after 1850ms+ can suffer extreme slippage.
        // Strategy: Limit IOC with slippage cap first → market fallback only if needed.
        await new Promise(r => setTimeout(r, 1200)) // Wait for position update to propagate
        const verifyPositions = await client.getLinearPositions(reconcileSymbol).catch(() => [])
        const stillOpen = verifyPositions.find(p => p.symbol === reconcileSymbol && Number(p.size) > 0)
        if (stillOpen) {
          const emergencySide: 'Buy' | 'Sell' = stillOpen.side === 'Buy' ? 'Sell' : 'Buy'
          const markPrice = parseFloat(stillOpen.markPrice) || 0
          const currentGrossPnl = parseFloat(stillOpen.unrealisedPnl) || 0
          const originalGrossPnl = realizedPnl // PnL at original close attempt

          warn(`[futures/close/reconcile] POSITION STILL OPEN! ${reconcileSymbol} size=${stillOpen.size} side=${stillOpen.side} markPrice=${markPrice} currentGrossPnl=${currentGrossPnl.toFixed(3)} originalGrossPnl=${originalGrossPnl?.toFixed(3) ?? 'N/A'}`)

          // ── TIER 1: Limit IOC with 0.5% slippage cap ──
          // For SELL to close (long position): limit below mark → markPrice * 0.995
          // For BUY to close (short position): limit above mark → markPrice * 1.005
          const TIER1_SLIPPAGE_BPS = 50 // 0.5% = 50 basis points
          let tier1Succeeded = false
          let tier1OrderId = ''

          if (markPrice > 0) {
            const slippageMultiplier = emergencySide === 'Sell'
              ? 1 - (TIER1_SLIPPAGE_BPS / 10000)  // Sell: accept lower price
              : 1 + (TIER1_SLIPPAGE_BPS / 10000)  // Buy: accept higher price
            let limitPrice = markPrice * slippageMultiplier

            // Round limit price to tick size (default $0.01 for USDT perps)
            const cachedInfo = getCachedInstrument(reconcileSymbol)
            const tickSize = cachedInfo?.tickSize || 0.01
            limitPrice = Math.floor(limitPrice / tickSize) * tickSize
            // For Buy: round UP to ensure fill; for Sell: round DOWN is already done by floor
            if (emergencySide === 'Buy') {
              limitPrice = Math.ceil((markPrice * slippageMultiplier) / tickSize) * tickSize
            }

            try {
              log(`[futures/close/reconcile] TIER 1: Limit IOC ${emergencySide} ${stillOpen.size} ${reconcileSymbol} @ $${limitPrice.toFixed(2)} (mark=$${markPrice.toFixed(2)} slippage=${TIER1_SLIPPAGE_BPS}bps)`)
              const tier1Result = await client.placeLinearOrder({
                symbol: reconcileSymbol,
                side: emergencySide,
                qty: stillOpen.size,
                orderType: 'Limit',
                price: limitPrice.toFixed(2),
                timeInForce: 'IOC',       // Immediate-or-Cancel: won't leave hanging order
                reduceOnly: true,
                orderLinkId: `emergency_t1_${Date.now()}`,
              })

              if (tier1Result.retCode === 0 && tier1Result.orderId) {
                tier1OrderId = tier1Result.orderId
                log(`[futures/close/reconcile] TIER 1 order placed: orderId=${tier1OrderId}`)

                // Wait for IOC to settle, then verify
                await new Promise(r => setTimeout(r, 1500))
                const afterTier1 = await client.getLinearPositions(reconcileSymbol).catch(() => [])
                const remaining = afterTier1.find(p => p.symbol === reconcileSymbol && Number(p.size) > 0)
                if (!remaining) {
                  tier1Succeeded = true
                  // Reconcile Tier 1 fill
                  const t1History = await client.getLinearOrderHistory(reconcileSymbol, 5).catch(() => [])
                  const t1Order = t1History.find(o => o.orderId === tier1OrderId)
                  if (t1Order) {
                    const t1FillPrice = Number(t1Order.avgPrice) || 0
                    const t1FillFee = Math.abs(Number(t1Order.cumExecFee)) || 0
                    const t1PnlDelta = currentGrossPnl - (originalGrossPnl || 0)
                    log(`[futures/close/reconcile] TIER 1 FILLED: ${reconcileSymbol} fillPrice=$${t1FillPrice.toFixed(2)} fee=$${t1FillFee.toFixed(3)} grossPnlDelta=$${t1PnlDelta.toFixed(3)}`)
                  }
                  log(`[futures/close/reconcile] ✅ Emergency close TIER 1 succeeded for ${reconcileSymbol}`)
                } else {
                  warn(`[futures/close/reconcile] TIER 1 partial/no fill: ${reconcileSymbol} remaining=${remaining.size} — escalating to TIER 2`)
                }
              } else {
                warn(`[futures/close/reconcile] TIER 1 order rejected: ${tier1Result.retCode} ${tier1Result.retMsg} — escalating to TIER 2`)
              }
            } catch (e: any) {
              warn(`[futures/close/reconcile] TIER 1 error: ${e.message} — escalating to TIER 2`)
            }
          }

          // ── TIER 2: Market order (guaranteed fill, unlimited slippage) ──
          // LAST RESORT: unclosed position = infinite risk > any finite slippage
          if (!tier1Succeeded) {
            try {
              warn(`[futures/close/reconcile] TIER 2: Market order ${emergencySide} ${stillOpen.size} ${reconcileSymbol} (no slippage cap — UNLIMITED RISK)`)
              const tier2Result = await client.closeLinearPosition({
                symbol: reconcileSymbol,
                side: emergencySide,
                qty: stillOpen.size,
              })

              if (tier2Result.retCode === 0) {
                // Re-fetch position to confirm
                await new Promise(r => setTimeout(r, 1000))
                const afterTier2 = await client.getLinearPositions(reconcileSymbol).catch(() => [])
                const stillRemaining = afterTier2.find(p => p.symbol === reconcileSymbol && Number(p.size) > 0)

                // Reconcile Tier 2 fill
                const t2History = await client.getLinearOrderHistory(reconcileSymbol, 5).catch(() => [])
                const t2Order = t2History.find(o => o.orderId === tier2Result.orderId)
                if (t2Order) {
                  const t2FillPrice = Number(t2Order.avgPrice) || 0
                  const t2FillFee = Math.abs(Number(t2Order.cumExecFee)) || 0
                  const t2SlippagePct = markPrice > 0 ? Math.abs(t2FillPrice - markPrice) / markPrice * 100 : 0
                  const t2PnlDelta = currentGrossPnl - (originalGrossPnl || 0)

                  if (t2SlippagePct > 1.0) {
                    warn(`[futures/close/reconcile] ⚠️ HIGH SLIPPAGE: ${reconcileSymbol} fillPrice=$${t2FillPrice.toFixed(2)} markPrice=$${markPrice.toFixed(2)} slippage=${t2SlippagePct.toFixed(2)}% fee=$${t2FillFee.toFixed(3)} grossPnlDelta=$${t2PnlDelta.toFixed(3)}`)
                  } else {
                    log(`[futures/close/reconcile] TIER 2 FILLED: ${reconcileSymbol} fillPrice=$${t2FillPrice.toFixed(2)} slippage=${t2SlippagePct.toFixed(2)}% fee=$${t2FillFee.toFixed(3)} grossPnlDelta=$${t2PnlDelta.toFixed(3)}`)
                  }
                }

                if (stillRemaining) {
                  logError(`[futures/close/reconcile] 🚨 CRITICAL: Position STILL OPEN after TIER 2! ${reconcileSymbol} size=${stillRemaining.size} — MANUAL INTERVENTION REQUIRED`)
                } else {
                  log(`[futures/close/reconcile] ✅ Emergency close TIER 2 (market) succeeded for ${reconcileSymbol}`)
                }
              } else {
                logError(`[futures/close/reconcile] 🚨 TIER 2 FAILED: ${tier2Result.retCode} ${tier2Result.retMsg} — POSITION STILL OPEN! MANUAL CLOSE REQUIRED`)
              }
            } catch (e: any) {
              logError(`[futures/close/reconcile] 🚨 TIER 2 error: ${e.message} — POSITION STILL OPEN! MANUAL CLOSE REQUIRED`)
            }
          }
        }
      } catch (err: any) {
        warn(`[futures/close/reconcile] Failed: ${err.message}`)
      }
    })()

    log(`[futures/close] Closed ${closeSide} ${symbol} qty=${actualQty} orderId=${closeResult.orderId} pnl=${realizedPnl} latency=${criticalLatency}ms`)

    return NextResponse.json({
      success: true,
      orderId: closeResult.orderId,
      orderLinkId: closeResult.orderLinkId,
      symbol,
      side: closeSide,
      qty: actualQty,
      fillPrice: null,         // Will be reconciled async
      fillFee: null,
      realizedPnl,
      nativeSLCancelled: cancelSLTP,
      fillPending: true,
      latency: criticalLatency,
    })
  } catch (error: any) {
    logError('[/api/bybit/futures/close] error:', error.message)
    return NextResponse.json(
      { success: false, error: error.message, latency: Date.now() - startTime },
      { status: 500 }
    )
  }
}
