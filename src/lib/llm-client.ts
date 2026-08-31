// ─── Universal LLM Client (multi-provider) ───────────────────────────────────
// Single entry point `callLlm()` that dispatches to the right provider API.
// Supports: openai-compatible (OpenAI/OpenRouter/Groq/Ollama), Anthropic,
// Cloudflare Workers AI, Google Gemini.
//
// Returns a unified { content, usage } shape regardless of provider.

import { getLlmConfig, type LlmConfig } from './llm-config'
import { createLlmInvocation } from './llm-invocation'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  maxTokens?: number       // default 4096
  temperature?: number     // default 0.3
  timeoutMs?: number       // default 60_000
  operation?: string
  promptVersion?: string
  metadata?: Record<string, unknown>
}

export interface LlmUsage {
  input: number
  output: number
  costUsd?: number
}

export interface LlmResult {
  content: string
  usage?: LlmUsage
  latencyMs?: number
  invocationId?: string
}

type ResolvedLlmCallOptions = Required<Pick<LlmCallOptions, 'maxTokens' | 'temperature' | 'timeoutMs'>>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

async function readHttpError(res: Response, provider: string): Promise<string> {
  let detail = ''
  try {
    const body = await res.text()
    // Try to extract a message from common JSON error shapes
    try {
      const j = JSON.parse(body)
      detail = j.error?.message || j.error || j.message || j.detail || ''
      if (typeof detail !== 'string') detail = JSON.stringify(detail)
    } catch {
      detail = body.slice(0, 300)
    }
  } catch {}
  return `${provider} API error ${res.status}${detail ? `: ${detail}` : ''}`
}

// ─── OpenAI-compatible (OpenAI / OpenRouter / Groq / Together / Ollama) ───────

async function callOpenAI(
  cfg: LlmConfig,
  messages: LlmMessage[],
  opts: ResolvedLlmCallOptions,
): Promise<LlmResult> {
  const baseUrl = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`
  // DeepSeek V4 Flash Free defaults to a long reasoning trace. For BRRR's
  // strict JSON contracts this can consume the whole completion budget before
  // the final answer. OpenCode's compatible endpoint supports disabling it.
  const modelOptions = cfg.model === 'deepseek-v4-flash-free'
    ? { thinking: { type: 'disabled' } }
    : {}

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...modelOptions,
    }),
    signal: timeoutSignal(opts.timeoutMs),
  })

  if (!res.ok) throw new Error(await readHttpError(res, 'OpenAI'))

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''
  const reportedCost = Number(data.usage?.cost)
  const usage: LlmUsage | undefined = data.usage
    ? {
        input: data.usage.prompt_tokens || 0,
        output: data.usage.completion_tokens || 0,
        costUsd: Number.isFinite(reportedCost) ? reportedCost : undefined,
      }
    : undefined
  return { content, usage }
}

// ─── Anthropic (Claude Messages API) ─────────────────────────────────────────

async function callAnthropic(
  cfg: LlmConfig,
  messages: LlmMessage[],
  opts: ResolvedLlmCallOptions,
): Promise<LlmResult> {
  // Anthropic separates system prompt from messages array
  const systemMsgs = messages.filter(m => m.role === 'system')
  const convoMsgs = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.map(m => m.content).join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      system: system || undefined,
      messages: convoMsgs.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }),
    signal: timeoutSignal(opts.timeoutMs),
  })

  if (!res.ok) throw new Error(await readHttpError(res, 'Anthropic'))

  const data = await res.json()
  // content is an array of blocks; concatenate text blocks
  const content = Array.isArray(data.content)
    ? data.content.map((b: any) => b?.text || '').join('')
    : ''
  const usage: LlmUsage | undefined = data.usage
    ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 }
    : undefined
  return { content, usage }
}

// ─── Cloudflare Workers AI ───────────────────────────────────────────────────

async function callCloudflare(
  cfg: LlmConfig,
  messages: LlmMessage[],
  opts: ResolvedLlmCallOptions,
): Promise<LlmResult> {
  if (!cfg.accountId) throw new Error('Cloudflare: brak Account ID w konfiguracji LLM')
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }),
    signal: timeoutSignal(opts.timeoutMs),
  })

  if (!res.ok) throw new Error(await readHttpError(res, 'Cloudflare'))

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''
  const usage: LlmUsage | undefined = data.usage
    ? { input: data.usage.prompt_tokens || 0, output: data.usage.completion_tokens || 0 }
    : undefined
  return { content, usage }
}

// ─── Google Gemini (generateContent) ─────────────────────────────────────────

async function callGemini(
  cfg: LlmConfig,
  messages: LlmMessage[],
  opts: ResolvedLlmCallOptions,
): Promise<LlmResult> {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const convoMsgs = messages.filter(m => m.role !== 'system')
  const systemText = systemMsgs.map(m => m.content).join('\n\n')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents: convoMsgs.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        temperature: opts.temperature,
      },
    }),
    signal: timeoutSignal(opts.timeoutMs),
  })

  if (!res.ok) throw new Error(await readHttpError(res, 'Gemini'))

  const data = await res.json()
  const content = Array.isArray(data.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts.map((p: any) => p?.text || '').join('')
    : ''
  const usage: LlmUsage | undefined = data.usageMetadata
    ? { input: data.usageMetadata.promptTokenCount || 0, output: data.usageMetadata.candidatesTokenCount || 0 }
    : undefined
  return { content, usage }
}

// ─── Public entry point ──────────────────────────────────────────────────────

function withDefaults(opts?: LlmCallOptions): ResolvedLlmCallOptions {
  return {
    maxTokens: opts?.maxTokens ?? 4096,
    temperature: opts?.temperature ?? 0.3,
    timeoutMs: opts?.timeoutMs ?? 60_000,
  }
}

/**
 * Call the configured LLM provider with a unified message interface.
 * Reads provider config from AppSettings automatically.
 * Pass `explicitConfig` to test a config WITHOUT persisting it.
 * @throws Error if LLM is not configured or the API call fails.
 */
export async function callLlm(
  messages: LlmMessage[],
  opts?: LlmCallOptions,
  explicitConfig?: LlmConfig,
): Promise<LlmResult> {
  const cfg = explicitConfig ?? await getLlmConfig()
  if (!cfg) {
    throw new Error('LLM is not configured. Open Settings → LLM section.')
  }
  const o = withDefaults(opts)
  const startedAt = Date.now()
  const operation = opts?.operation || 'unspecified'
  const metadataJson = JSON.stringify(opts?.metadata || {})

  try {
    let result: LlmResult
    switch (cfg.provider) {
      case 'openai':      result = await callOpenAI(cfg, messages, o); break
      case 'anthropic':   result = await callAnthropic(cfg, messages, o); break
      case 'cloudflare':  result = await callCloudflare(cfg, messages, o); break
      case 'gemini':      result = await callGemini(cfg, messages, o); break
      default:
        throw new Error(`Unsupported LLM provider: ${String(cfg.provider)}`)
    }

    const latencyMs = Date.now() - startedAt
    let invocationId: string | undefined
    try {
      invocationId = await createLlmInvocation({
        operation,
        provider: cfg.provider,
        model: cfg.model,
        promptVersion: opts?.promptVersion,
        status: 'SUCCESS',
        inputTokens: result.usage?.input,
        outputTokens: result.usage?.output,
        costUsd: result.usage?.costUsd,
        latencyMs,
        metadataJson,
      })
    } catch (logError) {
      console.error('[LLM] Failed to save invocation telemetry:', logError)
    }
    return { ...result, latencyMs, invocationId }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    try {
      await createLlmInvocation({
        operation,
        provider: cfg.provider,
        model: cfg.model,
        promptVersion: opts?.promptVersion,
        status: 'ERROR',
        latencyMs,
        errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown error',
        metadataJson,
      })
    } catch (logError) {
      console.error('[LLM] Failed to save error telemetry:', logError)
    }
    throw error
  }
}

// ─── Connection test ─────────────────────────────────────────────────────────

/**
 * Test the LLM connection. Uses the persisted config by default.
 * Pass `explicitConfig` to test credentials WITHOUT saving them first
 * (so a failed test does not overwrite a working config).
 */
export async function testLlmConnection(
  explicitConfig?: LlmConfig,
): Promise<{ success: boolean; message: string }> {
  const cfg = explicitConfig ?? await getLlmConfig()
  if (!cfg) {
    return { success: false, message: 'LLM nie jest skonfigurowany.' }
  }
  try {
    const result = await callLlm(
      [
        { role: 'system', content: 'Answer with one word.' },
        { role: 'user', content: 'Napisz PONG' },
      ],
      {
        maxTokens: 10,
        temperature: 0,
        timeoutMs: 20_000,
        operation: 'connection_test',
        promptVersion: 'connection-test-v1',
      },
      cfg,
    )
    const ok = result.content.trim().length > 0
    return {
      success: ok,
      message: ok
        ? `✅ Connection OK (${cfg.provider}/${cfg.model}) — response: "${result.content.trim().slice(0, 40)}"`
        : '❌ No content in model response',
    }
  } catch (err) {
    return {
      success: false,
      message: `❌ ${err instanceof Error ? err.message : 'Unknown connection error'}`,
    }
  }
}
