// ─── LLM Settings Endpoint ───────────────────────────────────────────────────
// GET:    Fetch current LLM config (masked key — safe for UI)
// POST:   Save config { provider, model, apiKey, baseUrl?, accountId? }
//         If { test: true } — run a connection test instead of saving.
// DELETE: Remove all LLM config

import { NextResponse } from 'next/server'
import {
  getLlmConfigPublic,
  saveLlmConfig,
  deleteLlmConfig,
  DEFAULT_MODELS,
  type LlmProvider,
} from '@/lib/llm-config'
import { testLlmConnection } from '@/lib/llm-client'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const VALID_PROVIDERS: LlmProvider[] = ['openai', 'anthropic', 'cloudflare', 'gemini']

// ─── GET: current config (masked) ─────────────────────────────────────────────

export async function GET() {
  try {
    const config = await getLlmConfigPublic()
    return NextResponse.json({ config, defaultModels: DEFAULT_MODELS })
  } catch (error) {
    console.error('[/api/llm-settings] GET error:', error)
    return NextResponse.json({ error: 'Błąd pobierania ustawień LLM' }, { status: 500 })
  }
}

// ─── POST: save config OR run connection test ─────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { provider, model, apiKey, baseUrl, accountId, test } = body as {
      provider?: string
      model?: string
      apiKey?: string
      baseUrl?: string
      accountId?: string
      test?: boolean
    }

    // ── Connection test branch ──
    // Tests credentials WITHOUT persisting them — so a failed test does not
    // overwrite a working config. The user must press SAVE to persist.
    if (test === true) {
      const ip = request.headers.get('x-forwarded-for') || 'unknown'
      const rate = checkRateLimit(`llm-settings-test:${ip}`, 5, 60 * 1000)
      if (!rate.allowed) return NextResponse.json({ error: 'Zbyt wiele testów. Poczekaj ~60s.' }, { status: 429 })

      if (!provider || !apiKey) {
        return NextResponse.json({ error: 'Test wymaga provider + apiKey' }, { status: 400 })
      }
      // Build an in-memory config and test it directly (no DB write)
      const explicitConfig = {
        provider: provider as LlmProvider,
        model: (model?.trim() || DEFAULT_MODELS[provider as LlmProvider]),
        apiKey: apiKey.trim(),
        baseUrl: provider === 'openai' ? (baseUrl?.trim() || undefined) : undefined,
        accountId: provider === 'cloudflare' ? (accountId?.trim() || undefined) : undefined,
      }
      const result = await testLlmConnection(explicitConfig)
      return NextResponse.json({ test: true, ...result })
    }

    // ── Save branch ──
    if (!provider || !VALID_PROVIDERS.includes(provider as LlmProvider)) {
      return NextResponse.json({ error: `Nieprawidłowy provider. Dozwolone: ${VALID_PROVIDERS.join(', ')}` }, { status: 400 })
    }
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 5) {
      return NextResponse.json({ error: 'Brak lub zbyt krótki klucz API' }, { status: 400 })
    }

    await saveLlmConfig({
      provider: provider as LlmProvider,
      model,
      apiKey,
      baseUrl,
      accountId,
    })

    const config = await getLlmConfigPublic()
    return NextResponse.json({ success: true, message: 'Konfiguracja LLM zapisana', config })
  } catch (error) {
    console.error('[/api/llm-settings] POST error:', error)
    return NextResponse.json({ error: 'Błąd zapisu ustawień LLM' }, { status: 500 })
  }
}

// ─── DELETE: remove config ────────────────────────────────────────────────────

export async function DELETE() {
  try {
    await deleteLlmConfig()
    return NextResponse.json({ success: true, message: 'Konfiguracja LLM usunięta' })
  } catch (error) {
    console.error('[/api/llm-settings] DELETE error:', error)
    return NextResponse.json({ error: 'Błąd usuwania ustawień LLM' }, { status: 500 })
  }
}
