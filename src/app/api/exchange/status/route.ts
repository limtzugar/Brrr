import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { BybitClient } from '@/lib/bybit'

export const dynamic = 'force-dynamic'

interface ExchangeTestResult {
  success: boolean
  message: string
  balance?: number
}

interface ExchangeStatus {
  exchange: string
  mode: string
  connected: boolean
  message: string
  balance: number
}

export async function GET() {
  try {
    const apis = await db.exchangeApi.findMany({
      where: { isConfigured: true, exchange: { not: 'binance' } },
    })
    const results: ExchangeStatus[] = []

    for (const api of apis) {
      let testResult: ExchangeTestResult = {
        success: false,
        message: 'Unknown exchange',
        balance: 0,
      }
      try {
        const apiKey = decrypt(api.apiKey)
        const apiSecret = decrypt(api.apiSecret)

        const client = new BybitClient({ apiKey, apiSecret, mode: api.mode as 'demo' | 'real' })
        testResult = await client.testConnection()
      } catch (err) {
        testResult = { success: false, message: err instanceof Error ? err.message : 'Connection error', balance: 0 }
      }

      results.push({
        exchange: api.exchange,
        mode: api.mode,
        connected: testResult.success,
        message: testResult.message,
        balance: testResult.balance ?? 0,
      })
    }

    const hasDemo = results.some(r => r.mode === 'demo' && r.connected)
    const hasReal = results.some(r => r.mode === 'real' && r.connected)

    return NextResponse.json({
      configured: results.length,
      hasDemo,
      hasReal,
      readyForTrading: hasDemo || hasReal,
      exchanges: results,
      hint: !results.length
        ? 'Dodaj klucze API w Settingsch → Bybit Demo (testnet.bybit.com)'
        : !hasDemo && !hasReal
          ? 'Keys configured but connection failed — check API permissions'
          : null,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}
