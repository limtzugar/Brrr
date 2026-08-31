// ─── App Settings API ───────────────────────────────────────────────────────
// GET:  Fetch all app settings (e.g. logs_enabled)
// PATCH: Update a setting (key + value)

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { initLogger, setLogsEnabled, isLogsEnabled } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── GET: Fetch app settings ─────────────────────────────────────────────

export async function GET() {
  try {
    await initLogger()

    const settings = await db.appSettings.findMany()
    const result: Record<string, string> = {}
    for (const s of settings) {
      result[s.key] = s.value
    }

    // Include current in-memory state for logs_enabled
    return NextResponse.json({
      settings: result,
      logsEnabled: isLogsEnabled(),
    })
  } catch (error) {
    console.error('[/api/settings] GET error:', error)
    return NextResponse.json({ error: 'Błąd pobierania ustawień' }, { status: 500 })
  }
}

// ─── PATCH: Update a setting ─────────────────────────────────────────────

export async function PATCH(request: Request) {
  try {
    await initLogger()

    const body = await request.json()
    const { key, value } = body

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Brak key lub value' }, { status: 400 })
    }

    // SECURITY: allowlist — arbitrary key/value upsert could overwrite internal
    // state (e.g. authoritative PnL blobs or LLM config) via a plain PATCH.
    const ALLOWED_KEYS = new Set([
      'logs_enabled',
      'llm_shadow_enabled',
      'llm_provider', 'llm_model', 'llm_api_key', 'llm_base_url', 'llm_account_id',
    ])
    const ALLOWED_PREFIXES = ['llm_analyst_', 'llm_reports_history', 'bybit_closed_pnl_']
    const isAllowed = typeof key === 'string'
      && (ALLOWED_KEYS.has(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p)))
    if (!isAllowed) {
      return NextResponse.json(
        {
          error: `Klucz '${String(key).slice(0, 64)}' nie jest dozwolony`,
          allowedKeys: [...ALLOWED_KEYS],
          allowedPrefixes: ALLOWED_PREFIXES,
        },
        { status: 403 }
      )
    }

    // Handle logs_enabled specially — update in-memory cache too
    if (key === 'logs_enabled') {
      const enabled = value === 'true' || value === true
      await setLogsEnabled(enabled)
      return NextResponse.json({
        success: true,
        key: 'logs_enabled',
        value: String(enabled),
        logsEnabled: isLogsEnabled(),
      })
    }

    // Generic upsert for other settings
    const setting = await db.appSettings.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    })

    return NextResponse.json({ success: true, key: setting.key, value: setting.value })
  } catch (error) {
    console.error('[/api/settings] PATCH error:', error)
    return NextResponse.json({ error: 'Błąd aktualizacji ustawień' }, { status: 500 })
  }
}
