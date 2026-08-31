// ─── Market Buy API Route ────────────────────────────────────────────────────
// Executes a market buy order on the selected exchange via API.
// Supports Bybit and MEXC.

import { NextRequest, NextResponse } from 'next/server'
import { createBybitClient, getBybitSymbol, type BybitMode } from '@/lib/bybit'
import { createMexcClient, getMexcSymbol, type MexcMode } from '@/lib/mexc'

export const dynamic = 'force-dynamic'

interface MarketBuyRequest {
  coinId: string
  symbol: string
  exchange: 'bybit' | 'mexc'
  mode: 'demo' | 'real'
  amountUsdt: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as MarketBuyRequest
    const { coinId, symbol, exchange, mode, amountUsdt } = body

    // Validation
    if (!coinId || !symbol) {
      return NextResponse.json({ error: 'Missing coin ID or symbol' }, { status: 400 })
    }
    if (!exchange || !['bybit', 'mexc'].includes(exchange)) {
      return NextResponse.json({ error: 'Unsupported exchange' }, { status: 400 })
    }
    if (!mode || !['demo', 'real'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    if (!amountUsdt || amountUsdt <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
    }
    // Cap at $10000 to prevent fat-finger
    if (amountUsdt > 10000) {
      return NextResponse.json({ error: 'Maksymalna kwota to $10,000 USDT' }, { status: 400 })
    }

    const symbolUpper = symbol.toUpperCase()

    if (exchange === 'bybit') {
      const client = await createBybitClient(mode as BybitMode)
      const bybitSymbol = getBybitSymbol(coinId)
      // For Bybit spot market buy, qty is in base currency
      // We need to calculate base qty from USDT amount + current price
      const ticker = await client.getTicker(bybitSymbol)
      if (!ticker || !ticker.lastPrice) {
        return NextResponse.json({ error: `Failed to fetch price for ${bybitSymbol} of Bybit` }, { status: 404 })
      }
      const price = Number(ticker.lastPrice)
      if (price <= 0) {
        return NextResponse.json({ error: `Invalid price ${bybitSymbol}: ${price}` }, { status: 400 })
      }
      // Calculate quantity in base currency
      const qty = amountUsdt / price
      // Bybit has minimum order sizes — round appropriately
      const qtyStr = qty < 1 ? qty.toFixed(6) : qty.toFixed(4)

      const order = await client.marketBuy(bybitSymbol, qtyStr)
      return NextResponse.json({
        success: true,
        exchange: 'bybit',
        mode,
        symbol: bybitSymbol,
        side: 'Buy',
        type: 'Market',
        qty: qtyStr,
        estimatedPrice: price,
        estimatedTotal: amountUsdt.toFixed(2),
        orderId: order.orderId,
        orderLinkId: order.orderLinkId,
      })
    }

    if (exchange === 'mexc') {
      const client = await createMexcClient(mode as MexcMode)
      const mexcSymbol = getMexcSymbol(coinId)
      // MEXC supports quoteOrderQty for market buys (buy in USDT directly)
      const order = await client.marketBuy(mexcSymbol, '0', amountUsdt.toFixed(2))
      return NextResponse.json({
        success: true,
        exchange: 'mexc',
        mode,
        symbol: mexcSymbol,
        side: 'Buy',
        type: 'Market',
        qty: order.quantity || '0',
        quoteQty: amountUsdt.toFixed(2),
        orderId: order.orderId,
        orderLinkId: order.orderLinkId,
      })
    }

    return NextResponse.json({ error: 'Unsupported exchange' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Market Buy] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
