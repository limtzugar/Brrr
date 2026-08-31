'use client'

// ─── LLM Settings Section ────────────────────────────────────────────────────
// Embedded inside SettingsPanel. Lets the user pick an LLM provider,
// enter model name + API key (+ base URL / account ID where relevant),
// test the connection, and save. Keys are encrypted server-side.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTE } from '@/lib/te-theme'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Brain, Key, RefreshCw, Trash2, CheckCircle2, XCircle, FlaskConical, ChevronsUpDown } from 'lucide-react'

type Provider = 'openai' | 'anthropic' | 'cloudflare' | 'gemini'

interface ConfigPublic {
  provider: Provider
  model: string
  apiKeyMasked: string
  baseUrl?: string
  accountId?: string
  isConfigured: boolean
}

interface DefaultModels { openai: string; anthropic: string; cloudflare: string; gemini: string }

const PROVIDER_META: Record<Provider, { label: string; color: string; bg: string; hint: string }> = {
  openai:     { label: 'OpenAI', color: '#10a37f', bg: 'rgba(16,163,127,0.12)', hint: 'OpenAI / OpenRouter / Groq / Together / Ollama (format /v1/chat/completions)' },
  anthropic:  { label: 'Claude', color: '#d97757', bg: 'rgba(217,119,87,0.12)', hint: 'Anthropic Messages API (claude-sonnet-4, claude-opus-4)' },
  cloudflare: { label: 'Cloudflare', color: '#f6821f', bg: 'rgba(246,130,31,0.12)', hint: 'Cloudflare Workers AI — wymaga Account ID + API Token' },
  gemini:     { label: 'Gemini', color: '#4285f4', bg: 'rgba(66,133,244,0.12)', hint: 'Google Generative AI (gemini-2.5-pro, gemini-2.5-flash)' },
}

export default function LlmSettingsSection() {
  const te = useTE()
  const [config, setConfig] = useState<ConfigPublic | null>(null)
  const [defaults, setDefaults] = useState<DefaultModels | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [provider, setProvider] = useState<Provider>('openai')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [accountId, setAccountId] = useState('')

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const [modelOpen, setModelOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [modelsList, setModelsList] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchModels = useCallback(async () => {
    if (provider !== 'openai') return
    setModelsLoading(true)
    try {
      const apiBase = baseUrl || 'https://api.openai.com/v1'
      const base = apiBase.replace(/\/+$/, '')
      const modelsUrl = base.includes('openrouter.ai')
        ? 'https://openrouter.ai/api/v1/models'
        : `${base}/models`
      const headers: Record<string, string> = {}
      if (apiKey && apiKey.trim().length >= 5) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`
      }
      const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const ids: string[] = (data.data || [])
        .map((m: { id: string }) => m.id)
        .filter((id: string) => id && !id.startsWith('~'))
        .sort()
      setModelsList(ids)
    } catch {
      setModelsList([])
    } finally {
      setModelsLoading(false)
    }
  }, [provider, baseUrl, apiKey])

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/llm-settings')
      if (res.ok) {
        const data = await res.json()
        const cfg = data.config as ConfigPublic
        const def = data.defaultModels as DefaultModels
        setConfig(cfg)
        setDefaults(def)
        if (cfg) {
          setProvider(cfg.provider)
          setModel(cfg.model)
          setBaseUrl(cfg.baseUrl || '')
          setAccountId(cfg.accountId || '')
        }
      }
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchConfig() }, [fetchConfig])

  const placeholder = defaults ? defaults[provider] : ''
  const providerMeta = PROVIDER_META[provider]

  const handleSave = async () => {
    if (!apiKey || apiKey.trim().length < 5) {
      setResult('❌ Wpisz klucz API (min. 5 znaków)')
      return
    }
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch('/api/llm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: model || undefined, apiKey, baseUrl: baseUrl || undefined, accountId: accountId || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult(`❌ ${data.error || 'Błąd zapisu'}`)
      } else {
        setResult(`✅ Zapisano: ${provider}/${data.config?.model || model}`)
        setApiKey('')
        await fetchConfig()
      }
    } catch (err) {
      setResult(`❌ ${err instanceof Error ? err.message : 'Błąd'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!apiKey || apiKey.trim().length < 5) {
      setResult('❌ Wpisz klucz API przed testem')
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const res = await fetch('/api/llm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: model || undefined, apiKey, baseUrl: baseUrl || undefined, accountId: accountId || undefined, test: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult(`❌ ${data.error || 'Test nie powiódł się'}`)
      } else {
        setResult(data.message || (data.success ? '✅ Połączenie OK' : '❌ Test nie powiódł się'))
      }
    } catch (err) {
      setResult(`❌ ${err instanceof Error ? err.message : 'Błąd testu'}`)
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Usunąć konfigurację LLM?')) return
    try {
      await fetch('/api/llm-settings', { method: 'DELETE' })
      setApiKey('')
      setResult('Konfiguracja usunięta')
      await fetchConfig()
    } catch {}
  }

  return (
    <div style={{ background: te.bg, border: `1px solid ${te.border}`, borderLeft: `2px solid ${te.purple}`, borderRadius: '2px' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
        <div className="flex items-center gap-2">
          <Brain className="size-3.5" style={{ color: te.purple }} />
          <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: te.purple }}>LLM Analyst</span>
        </div>
        {config?.isConfigured && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider" style={{ background: te.purpleBg, color: te.purple, borderRadius: '1px' }}>
            ACTIVE · {config.provider}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-2 space-y-2">
        {/* Configured model info */}
        {config?.isConfigured && config.apiKeyMasked && (
          <div className="text-[10px] px-2 py-1 font-mono flex items-center justify-between" style={{ borderRadius: '1px', color: te.textDim, background: te.bgInput, border: `1px solid ${te.border}` }}>
            <span><span style={{ color: te.textDim }}>KEY:</span> <span style={{ color: te.textMuted }}>{config.apiKeyMasked}</span></span>
            <span style={{ color: te.purple, fontSize: '9px' }}>{config.provider}/{config.model}</span>
          </div>
        )}

        {/* Provider selector — 4 buttons */}
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(PROVIDER_META) as Provider[]).map(p => {
            const meta = PROVIDER_META[p]
            const active = provider === p
            return (
              <button
                key={p}
                onClick={() => { setProvider(p); setModel(defaults?.[p] || ''); setResult(null) }}
                className="px-1 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all"
                style={{
                  background: active ? meta.color : 'transparent',
                  color: active ? '#fff' : te.textDim,
                  border: `1px solid ${active ? meta.color : te.border}`,
                  borderRadius: '1px',
                }}
              >
                {meta.label}
              </button>
            )
          })}
        </div>

        {/* Provider hint */}
        <div className="text-[9px] font-mono" style={{ color: te.textDim }}>
          {providerMeta.hint}
        </div>

        {/* Dynamic fields */}
        <div className="space-y-1.5">
          {provider === 'openai' && (
            <div>
              <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>Base URL</Label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="h-7 text-[11px] font-mono"
                style={{ borderRadius: '2px', background: te.bgInput, borderColor: te.border, color: te.text }}
              />
              <div className="text-[9px] mt-0.5" style={{ color: te.textDim }}>
                Zmień na: openrouter.ai/api/v1, api.groq.com/openai/v1, localhost:11434/v1 (Ollama)
              </div>
            </div>
          )}
          {provider === 'cloudflare' && (
            <div>
              <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>Account ID</Label>
              <Input
                placeholder="np. eaa602a4dab1a6bda86cb255e582facc"
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                className="h-7 text-[11px] font-mono"
                style={{ borderRadius: '2px', background: te.bgInput, borderColor: te.border, color: te.text }}
              />
            </div>
          )}
          <div>
            <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>Model</Label>
            <div className="flex gap-1">
              <div className="flex-1 relative">
                <Popover open={modelOpen} onOpenChange={(open) => { setModelOpen(open); if (open) { setModelSearch(''); void fetchModels() } }}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex items-center justify-between w-full h-7 px-2 text-[11px] font-mono text-left truncate"
                      style={{ borderRadius: '2px', background: te.bgInput, border: `1px solid ${te.border}`, color: model ? te.text : te.textDim }}
                    >
                      <span className="truncate">{model || placeholder || 'Wybierz model...'}</span>
                      <ChevronsUpDown className="ml-1 size-3 shrink-0 opacity-40" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="start" style={{ borderRadius: '2px', border: `1px solid ${te.border}`, background: te.bg }}>
                    <Command shouldFilter={true}>
                      <CommandInput
                        placeholder="Szukaj modelu..."
                        value={modelSearch}
                        onValueChange={setModelSearch}
                        className="h-8 text-[11px]"
                        style={{ background: te.bg }}
                      />
                      <CommandList className="max-h-[280px]">
                        <CommandEmpty>
                          {modelsLoading
                            ? <span className="text-[10px]" style={{ color: te.textDim }}>Ładowanie modeli...</span>
                            : <span className="text-[10px]" style={{ color: te.textDim }}>Brak modeli. Wpisz ręcznie poniżej.</span>
                          }
                        </CommandEmpty>
                        <CommandGroup>
                          {(modelSearch
                            ? modelsList.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()))
                            : modelsList
                          ).slice(0, 200).map(m => (
                            <CommandItem
                              key={m}
                              value={m}
                              onSelect={(val) => { setModel(val); setModelOpen(false); setModelSearch('') }}
                              className="text-[10px] font-mono py-1 cursor-pointer"
                              style={{ borderRadius: '1px' }}
                            >
                              {m}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                ref={inputRef}
                className="flex-1 h-6 px-2 text-[10px] font-mono bg-transparent border-0 outline-none"
                style={{ color: te.textDim }}
                placeholder="lub wpisz ręcznie..."
                value={model}
                onChange={e => setModel(e.target.value)}
              />
              <span className="text-[9px] font-mono shrink-0" style={{ color: te.textDim }}>
                {modelsList.length > 0 && `${modelsList.length} modeli`}
                {modelsLoading && ' ⏳'}
              </span>
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>
              {provider === 'cloudflare' ? 'API Token' : 'API Key'}
            </Label>
            <Input
              placeholder={`${providerMeta.label} API Key`}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="h-7 text-[11px] font-mono"
              style={{ borderRadius: '2px', background: te.bgInput, borderColor: te.border, color: te.text }}
              type="password"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
            style={{ background: te.purple, color: te.bg, borderRadius: '2px', minWidth: '120px' }}
          >
            {saving ? <RefreshCw className="size-3 animate-spin" /> : <Key className="size-3" />}
            {saving ? '...' : 'ZAPISZ'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
            style={{ borderRadius: '2px', color: te.blue, background: `${te.blue}15`, border: `1px solid ${te.blue}33` }}
          >
            {testing ? <RefreshCw className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
            {testing ? '...' : 'TEST'}
          </button>
          {config?.isConfigured && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all"
              style={{ borderRadius: '2px', color: te.red, background: `${te.red}15` }}
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>

        {/* Result message */}
        {result && (
          <div
            className="text-[10px] px-3 py-1.5 font-mono flex items-start gap-1.5"
            style={{
              borderRadius: '2px',
              border: `1px solid ${result.startsWith('✅') ? `${te.green}22` : `${te.red}22`}`,
              color: result.startsWith('✅') ? te.green : te.red,
              background: result.startsWith('✅') ? `${te.green}10` : `${te.red}10`,
            }}
          >
            {result.startsWith('✅') ? <CheckCircle2 className="size-3 shrink-0 mt-0.5" /> : <XCircle className="size-3 shrink-0 mt-0.5" />}
            <span className="break-all">{result}</span>
          </div>
        )}

        {/* Help footer */}
        <div className="text-[9px] font-mono pt-1" style={{ color: te.textDim, borderTop: `1px solid ${te.border}` }}>
          Klucz jest szyfrowany (AES-256-GCM) w bazie. Używany przez zakładkę „LLM Analyst" oraz panel LLM w CEX Anomaly.
        </div>

        {loading && <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: te.textDim }}>Ładowanie...</div>}
      </div>
    </div>
  )
}
