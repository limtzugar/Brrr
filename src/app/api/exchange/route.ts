// ─── Exchange API Keys Management ─────────────────────────────────────────
// GET: List configured exchanges (masked keys)
// POST: Save/update API keys for a supported trading exchange
// DELETE: Remove API keys for an exchange

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, maskApiKey } from '@/lib/encryption'
import { decrypt } from '@/lib/encryption'
import { BybitClient, type BybitMode } from '@/lib/bybit'
import { exchangeKeySchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

// ─── GET: List configured exchanges ───────────────────────────────────────

export async function GET(request: Request) {
  try {
    const apis = await db.exchangeApi.findMany({
      where: { exchange: { not: 'binance' } },
    })

    const result = apis.map(api => ({
      id: api.id,
      exchange: api.exchange,
      mode: api.mode,
      isConfigured: api.isConfigured,
      apiKeyMasked: api.isConfigured ? maskApiKey(decrypt(api.apiKey)) : '',
      subMemberId: (api as any).subMemberId || null,
      subAccountName: (api as any).subAccountName || null,
      createdAt: api.createdAt,
      updatedAt: api.updatedAt,
    }))

    return NextResponse.json({ exchanges: result })
  } catch (error) {
    console.error('[/api/exchange] GET error:', error)
    return NextResponse.json(
      { error: 'Błąd pobierania kluczy API' },
      { status: 500 }
    )
  }
}

// ─── POST: Save/Update API Keys ───────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Validate with Zod
    const parsed = exchangeKeySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { exchange, mode, apiKey, apiSecret } = parsed.data

    if (exchange === 'binance') {
      return NextResponse.json(
        { error: 'Handel przez Binance został wyłączony' },
        { status: 410 }
      )
    }

    // Test connection based on exchange type
    let testResult: { success: boolean; message: string; balance?: number }

    {
      const client = new BybitClient({
        apiKey,
        apiSecret,
        mode: mode as BybitMode,
      })
      testResult = await client.testConnection()
      if (!testResult.success) {
        return NextResponse.json(
          { error: `Błąd połączenia z Bybit: ${testResult.message}` },
          { status: 400 }
        )
      }
    }

    // Encrypt and save
    const encryptedKey = encrypt(apiKey)
    const encryptedSecret = encrypt(apiSecret)

    // Auto-detect sub-account if using Bybit master account
    let subMemberId: string | null = null
    let subAccountName: string | null = null
    if (exchange === 'bybit' && (testResult as any).source?.startsWith('sub:')) {
      // testConnection found balance on a sub-account — auto-save it
      const client = new BybitClient({ apiKey, apiSecret, mode: mode as BybitMode })
      // Re-trigger detection by calling getFuturesBalance
      const futBal = await client.getFuturesBalance()
      if (client.getSubMemberId()) {
        subMemberId = client.getSubMemberId()
        subAccountName = client.getSubAccountName()
      }
    }

    const record = await db.exchangeApi.upsert({
      where: { exchange_mode: { exchange, mode } },
      update: {
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
        isConfigured: true,
        ...(subMemberId ? { subMemberId, subAccountName } : {}),
      },
      create: {
        exchange,
        mode,
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
        isConfigured: true,
        ...(subMemberId ? { subMemberId, subAccountName } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      message: testResult.message,
      balance: testResult.balance,
      exchange: {
        id: record.id,
        exchange: record.exchange,
        mode: record.mode,
        isConfigured: record.isConfigured,
        apiKeyMasked: maskApiKey(apiKey),
        subMemberId: (record as any).subMemberId || null,
        subAccountName: (record as any).subAccountName || null,
      },
    })
  } catch (error) {
    console.error('[/api/exchange] POST error:', error)
    return NextResponse.json(
      { error: 'Błąd zapisywania kluczy API' },
      { status: 500 }
    )
  }
}

// ─── PATCH: Update sub-account selection ──────────────────────────────────

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { exchange, mode, subMemberId, subAccountName } = body

    if (!exchange || !mode) {
      return NextResponse.json({ error: 'Missing exchange or mode' }, { status: 400 })
    }
    if (exchange === 'binance') {
      return NextResponse.json({ error: 'Handel przez Binance został wyłączony' }, { status: 410 })
    }

    const record = await db.exchangeApi.update({
      where: { exchange_mode: { exchange, mode } },
      data: {
        ...(subMemberId ? { subMemberId, subAccountName } as any : {}),
      },
    })

    return NextResponse.json({
      success: true,
      exchange: {
        id: record.id,
        exchange: record.exchange,
        mode: record.mode,
        subMemberId: (record as any).subMemberId || null,
        subAccountName: (record as any).subAccountName || null,
      },
    })
  } catch (error) {
    console.error('[/api/exchange] PATCH error:', error)
    return NextResponse.json({ error: 'Błąd aktualizacji subkonta' }, { status: 500 })
  }
}

// ─── DELETE: Remove API Keys ──────────────────────────────────────────────

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const exchange = searchParams.get('exchange') || 'bybit'
    const mode = searchParams.get('mode')

    if (!mode) {
      return NextResponse.json(
        { error: 'Brak parametru "mode"' },
        { status: 400 }
      )
    }

    await db.exchangeApi.deleteMany({
      where: { exchange, mode },
    })

    return NextResponse.json({ success: true, message: 'Klucze API usunięte' })
  } catch (error) {
    console.error('[/api/exchange] DELETE error:', error)
    return NextResponse.json(
      { error: 'Błąd usuwania kluczy API' },
      { status: 500 }
    )
  }
}
