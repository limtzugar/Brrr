// ─── LLM Configuration (encrypted) ──────────────────────────────────────────
// Stores provider/model/apiKey in AppSettings (key-value store).
// API keys are encrypted with AES-256-GCM via the existing encryption module.
// No DB schema change needed — reuses AppSettings key-value table.

import { db } from './db'
import { encrypt, decrypt, maskApiKey } from './encryption'

// ─── Types ──────────────────────────────────────────────────────────────────

export type LlmProvider = 'openai' | 'anthropic' | 'cloudflare' | 'gemini'

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey: string         // decrypted secret — server-side only
  baseUrl?: string       // openai-compatible only (OpenAI / OpenRouter / Groq / Ollama)
  accountId?: string     // cloudflare only
}

export interface LlmConfigPublic {
  provider: LlmProvider
  model: string
  apiKeyMasked: string   // masked — safe to return to UI
  baseUrl?: string
  accountId?: string
  isConfigured: boolean
}

// ─── AppSettings keys ────────────────────────────────────────────────────────

const KEYS = {
  provider: 'llm_provider',
  model: 'llm_model',
  apiKey: 'llm_api_key',
  baseUrl: 'llm_base_url',
  accountId: 'llm_account_id',
} as const

// ─── Default model per provider (used when model field left empty) ────────────

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5-20250929',
  cloudflare: '@cf/zai-org/glm-5.2',
  gemini: 'gemini-2.5-pro',
}

// ─── Read config (decrypts API key) ──────────────────────────────────────────

export async function getLlmConfig(): Promise<LlmConfig | null> {
  try {
    const rows = await db.appSettings.findMany({
      where: { key: { in: Object.values(KEYS) } },
    })
    const map = new Map(rows.map(r => [r.key, r.value]))

    const provider = (map.get(KEYS.provider) as LlmProvider | undefined) || null
    const encKey = map.get(KEYS.apiKey)
    const model = map.get(KEYS.model) || ''
    const baseUrl = map.get(KEYS.baseUrl) || undefined
    const accountId = map.get(KEYS.accountId) || undefined

    if (!provider || !encKey) return null

    let apiKey: string
    try {
      apiKey = decrypt(encKey)
    } catch {
      // If decryption fails (e.g. ENCRYPTION_KEY changed), treat as not configured
      return null
    }

    return {
      provider,
      model: model || DEFAULT_MODELS[provider],
      apiKey,
      baseUrl,
      accountId,
    }
  } catch (err) {
    console.error('[llm-config] getLlmConfig error:', err)
    return null
  }
}

// ─── Read public config (masked key — safe for UI/API responses) ─────────────

export async function getLlmConfigPublic(): Promise<LlmConfigPublic> {
  const cfg = await getLlmConfig()
  if (!cfg) {
    return {
      provider: 'openai',
      model: DEFAULT_MODELS.openai,
      apiKeyMasked: '',
      isConfigured: false,
    }
  }
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKeyMasked: maskApiKey(cfg.apiKey),
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    isConfigured: true,
  }
}

// ─── Save config (encrypts API key) ──────────────────────────────────────────

export interface SaveLlmConfigInput {
  provider: LlmProvider
  model?: string
  apiKey: string
  baseUrl?: string
  accountId?: string
}

export async function saveLlmConfig(input: SaveLlmConfigInput): Promise<void> {
  const provider = input.provider
  const model = (input.model?.trim() || DEFAULT_MODELS[provider]).trim()
  const encKey = encrypt(input.apiKey.trim())

  // baseUrl only relevant for openai-compatible providers
  const baseUrl = provider === 'openai' ? (input.baseUrl?.trim() || undefined) : undefined
  const accountId = provider === 'cloudflare' ? (input.accountId?.trim() || undefined) : undefined

  await db.appSettings.upsert({
    where: { key: KEYS.provider },
    update: { value: provider },
    create: { key: KEYS.provider, value: provider },
  })
  await db.appSettings.upsert({
    where: { key: KEYS.model },
    update: { value: model },
    create: { key: KEYS.model, value: model },
  })
  await db.appSettings.upsert({
    where: { key: KEYS.apiKey },
    update: { value: encKey },
    create: { key: KEYS.apiKey, value: encKey },
  })

  // Clear provider-specific fields then set if provided
  if (provider === 'openai' && baseUrl) {
    await db.appSettings.upsert({ where: { key: KEYS.baseUrl }, update: { value: baseUrl }, create: { key: KEYS.baseUrl, value: baseUrl } })
  } else {
    await db.appSettings.delete({ where: { key: KEYS.baseUrl } }).catch(() => {})
  }
  if (provider === 'cloudflare' && accountId) {
    await db.appSettings.upsert({ where: { key: KEYS.accountId }, update: { value: accountId }, create: { key: KEYS.accountId, value: accountId } })
  } else {
    await db.appSettings.delete({ where: { key: KEYS.accountId } }).catch(() => {})
  }
}

// ─── Delete all LLM config ───────────────────────────────────────────────────

export async function deleteLlmConfig(): Promise<void> {
  for (const key of Object.values(KEYS)) {
    await db.appSettings.delete({ where: { key } }).catch(() => {})
  }
}
