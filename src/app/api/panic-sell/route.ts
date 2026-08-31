// ─── Panic Sell API ──────────────────────────────────────────────────────────
// POST: Emergency sell ALL non-USDT positions across ALL configured exchanges
// Also cancels all open orders before selling.
// Body: { mode?, exchanges? } — optional filters
//
// ⚠️ This is a destructive endpoint — auth + rate limit enforced in proxy.ts middleware.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { createBybitClient, type BybitMode, COIN_TO_BYBIT } from '@/lib/bybit'
import { MexcClient, type MexcMode, COIN_TO_MEXC } from '@/lib/mexc'
import { BinanceClient, type BinanceMode, COIN_TO_BINANCE } from '@/lib/binance'
import { error as logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface SellResult {
  exchange: string
  coin: string
  symbol: string
  success: boolean
  message: string
  amount: string
  details?: unknown
}

interface CancelResult {
  exchange: string
  symbol: string
  success: boolean
  message: string
}

interface PanicResult {
  success: boolean
  sellResults: SellResult[]
  cancelResults: CancelResult[]
  totalSold: number
  errors: string[]
  timestamp: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // SECURITY: destructive endpoint — require an explicit confirmation token in
    // the body so a malformed/accidental call cannot nuke all holdings.
    if ((body as { confirm?: string }).confirm !== 'SELL_ALL') {
      return NextResponse.json(
        {
          error: 'Wymagane potwierdzenie: wyślij { "confirm": "SELL_ALL" }. Ta operacja anuluje wszystkie zlecenia i sprzedaje WSZYSTKIE pozycje nie-USDT na WSZYSTKICH skonfigurowanych giełdach.',
        },
        { status: 400 }
      )
    }

    const { mode: modeFilter, exchanges: exchangeFilter } = body as {
      mode?: string
      exchanges?: string[]
    }

    // Get all configured exchange APIs
    let apis = await db.exchangeApi.findMany({
      where: { isConfigured: true, exchange: { not: 'binance' } },
    })

    if (apis.length === 0) {
      return NextResponse.json(
        { error: 'Brak skonfigurowanych kluczy API' },
        { status: 400 }
      )
    }

    // Apply filters
    if (modeFilter) {
      apis = apis.filter(a => a.mode === modeFilter)
    }
    if (exchangeFilter && Array.isArray(exchangeFilter)) {
      apis = apis.filter(a => exchangeFilter.includes(a.exchange))
    }

    const sellResults: SellResult[] = []
    const cancelResults: CancelResult[] = []
    const errors: string[] = []

    // Process each exchange in parallel
    await Promise.allSettled(
      apis.map(async (api) => {
        const apiKey = decrypt(api.apiKey)
        const apiSecret = decrypt(api.apiSecret)

        try {
          if (api.exchange === 'binance') {
            const client = new BinanceClient({
              apiKey,
              apiSecret,
              mode: api.mode as BinanceMode,
            })

            // Step 1: Cancel all open orders for known symbols
            const knownSymbols = Object.values(COIN_TO_BINANCE)
            for (const symbol of knownSymbols) {
              try {
                const openOrders = await client.getOpenOrders(symbol)
                for (const order of openOrders) {
                  try {
                    await client.cancelOrder(symbol, order.orderId)
                    cancelResults.push({
                      exchange: 'binance',
                      symbol,
                      success: true,
                      message: `Anulowano zlecenie ${order.orderId}`,
                    })
                  } catch (err) {
                    cancelResults.push({
                      exchange: 'binance',
                      symbol,
                      success: false,
                      message: err instanceof Error ? err.message : 'Błąd anulowania',
                    })
                  }
                }
              } catch {
                // Silently skip if no orders or error
              }
            }

            // Step 2: Sell all non-USDT holdings
            const balances = await client.getAllBalances()
            const holdings = balances.coins.filter(c =>
              c.coin !== 'USDT' && Number(c.free) > 0
            )

            for (const holding of holdings) {
              const symbol = `${holding.coin}USDT`
              try {
                const order = await client.marketSell(symbol, holding.free)
                sellResults.push({
                  exchange: 'binance',
                  coin: holding.coin,
                  symbol,
                  success: true,
                  message: `Sprzedano ${holding.free} ${holding.coin} na Binance`,
                  amount: holding.free,
                  details: order,
                })
              } catch (err) {
                sellResults.push({
                  exchange: 'binance',
                  coin: holding.coin,
                  symbol,
                  success: false,
                  message: err instanceof Error ? err.message : 'Błąd sprzedaży',
                  amount: holding.free,
                })
                errors.push(`Binance ${holding.coin}: ${err instanceof Error ? err.message : 'Błąd'}`)
              }
            }
          } else if (api.exchange === 'mexc') {
            const client = new MexcClient({
              apiKey,
              apiSecret,
              mode: api.mode as MexcMode,
            })

            // Step 1: Cancel all open orders for known symbols
            const knownSymbols = Object.values(COIN_TO_MEXC)
            for (const symbol of knownSymbols) {
              try {
                const openOrders = await client.getOpenOrders(symbol)
                for (const order of openOrders) {
                  try {
                    await client.cancelOrder(symbol, order.orderId)
                    cancelResults.push({
                      exchange: 'mexc',
                      symbol,
                      success: true,
                      message: `Anulowano zlecenie ${order.orderId}`,
                    })
                  } catch (err) {
                    cancelResults.push({
                      exchange: 'mexc',
                      symbol,
                      success: false,
                      message: err instanceof Error ? err.message : 'Błąd anulowania',
                    })
                  }
                }
              } catch {
                // Silently skip if no orders or error
              }
            }

            // Step 2: Sell all non-USDT holdings
            const balances = await client.getAllBalances()
            const holdings = balances.coins.filter(c =>
              c.coin !== 'USDT' && Number(c.free) > 0
            )

            for (const holding of holdings) {
              const symbol = `${holding.coin}USDT`
              try {
                const order = await client.marketSell(symbol, holding.free)
                sellResults.push({
                  exchange: 'mexc',
                  coin: holding.coin,
                  symbol,
                  success: true,
                  message: `Sprzedano ${holding.free} ${holding.coin} na MEXC`,
                  amount: holding.free,
                  details: order,
                })
              } catch (err) {
                sellResults.push({
                  exchange: 'mexc',
                  coin: holding.coin,
                  symbol,
                  success: false,
                  message: err instanceof Error ? err.message : 'Błąd sprzedaży',
                  amount: holding.free,
                })
                errors.push(`MEXC ${holding.coin}: ${err instanceof Error ? err.message : 'Błąd'}`)
              }
            }
          } else {
            // Bybit — use createBybitClient() for sub-account support
            const client = await createBybitClient(api.mode as BybitMode)

            // Step 1: Cancel all open orders for known symbols
            const knownSymbols = Object.values(COIN_TO_BYBIT)
            for (const symbol of knownSymbols) {
              try {
                const openOrders = await client.getOpenOrders(symbol)
                for (const order of openOrders) {
                  try {
                    await client.cancelOrder(symbol, order.orderId)
                    cancelResults.push({
                      exchange: 'bybit',
                      symbol,
                      success: true,
                      message: `Anulowano zlecenie ${order.orderId}`,
                    })
                  } catch (err) {
                    cancelResults.push({
                      exchange: 'bybit',
                      symbol,
                      success: false,
                      message: err instanceof Error ? err.message : 'Błąd anulowania',
                    })
                  }
                }
              } catch {
                // Silently skip
              }
            }

            // Step 2: Sell all non-USDT holdings
            const balancesResult = await client.getAllBalances()
            const holdings = balancesResult.coins.filter(c =>
              c.coin !== 'USDT' && Number(c.free) > 0
            )

            for (const holding of holdings) {
              const symbol = `${holding.coin}USDT`
              try {
                const order = await client.marketSell(symbol, holding.free)
                sellResults.push({
                  exchange: 'bybit',
                  coin: holding.coin,
                  symbol,
                  success: true,
                  message: `Sprzedano ${holding.free} ${holding.coin} na Bybit`,
                  amount: holding.free,
                  details: order,
                })
              } catch (err) {
                sellResults.push({
                  exchange: 'bybit',
                  coin: holding.coin,
                  symbol,
                  success: false,
                  message: err instanceof Error ? err.message : 'Błąd sprzedaży',
                  amount: holding.free,
                })
                errors.push(`Bybit ${holding.coin}: ${err instanceof Error ? err.message : 'Błąd'}`)
              }
            }
          }
        } catch (err) {
          errors.push(`${api.exchange} (${api.mode}): ${err instanceof Error ? err.message : 'Błąd krytyczny'}`)
        }
      })
    )

    const totalSold = sellResults.filter(r => r.success).length
    const hasErrors = errors.length > 0
    const allFailed = sellResults.length > 0 && sellResults.every(r => !r.success)

    const result: PanicResult = {
      success: !allFailed,
      sellResults,
      cancelResults,
      totalSold,
      errors,
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(result, {
      status: allFailed ? 500 : 200,
    })
  } catch (error) {
    logError('[/api/panic-sell] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Błąd panic sell' },
      { status: 500 }
    )
  }
}
