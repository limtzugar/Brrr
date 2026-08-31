'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTE } from '@/lib/te-theme'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DollarSign, FlaskConical, Key, RefreshCw, Trash2, ChevronDown, Users, Plus, Terminal, Volume2, VolumeX } from 'lucide-react'
import LlmSettingsSection from './llm-settings-section'

interface ApiRecord {
  id: string
  exchange: string
  mode: string
  isConfigured: boolean
  apiKeyMasked: string
  subMemberId: string | null
  subAccountName: string | null
}

interface SubAccount {
  memberId: string
  memberName: string
  balance: { usdt: number; accountType: string; totalEquity: number } | null
}

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose: _onClose }: SettingsPanelProps) {
  const te = useTE()
  const [apis, setApis] = useState<ApiRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Sub-account state
  const [subAccounts, setSubAccounts] = useState<Record<string, SubAccount[]>>({})  // key: "bybit:real"
  const [loadingSubs, setLoadingSubs] = useState<Record<string, boolean>>({})

  const [bybitDemoApiKey, setBybitDemoApiKey] = useState('')
  const [bybitDemoApiSecret, setBybitDemoApiSecret] = useState('')
  const [bybitRealApiKey, setBybitRealApiKey] = useState('')
  const [bybitRealApiSecret, setBybitRealApiSecret] = useState('')

  // Logs toggle state
  const [logsEnabled, setLogsEnabledState] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)

  const fetchApis = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/exchange')
      if (res.ok) {
        const data = await res.json()
        setApis(data.exchanges || [])
      }
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  // Fetch logs setting on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          setLogsEnabledState(data.logsEnabled !== false)
        }
      } catch {}
    }
    fetchSettings()
  }, [])

  useEffect(() => { fetchApis() }, [fetchApis])

  const getFormState = (exchange: string, mode: string) => {
    void exchange
    return mode === 'demo'
      ? { key: bybitDemoApiKey, setKey: setBybitDemoApiKey, secret: bybitDemoApiSecret, setSecret: setBybitDemoApiSecret }
      : { key: bybitRealApiKey, setKey: setBybitRealApiKey, secret: bybitRealApiSecret, setSecret: setBybitRealApiSecret }
  }

  const clearFormState = (exchange: string, mode: string) => {
    void exchange
    if (mode === 'demo') { setBybitDemoApiKey(''); setBybitDemoApiSecret('') }
    else { setBybitRealApiKey(''); setBybitRealApiSecret('') }
  }

  const saveApiKeys = async (exchange: string, mode: 'demo' | 'real') => {
    const form = getFormState(exchange, mode)
    if (!form.key || !form.secret) {
      setTestResult('Fill both fields: API Key and API Secret')
      return
    }
    const saveKey = `${exchange}:${mode}`
    setSaving(saveKey)
    setTestResult(null)
    try {
      const res = await fetch('/api/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, mode, apiKey: form.key, apiSecret: form.secret }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult(`❌ ${data.error}`)
      } else {
        setTestResult(`✅ ${data.message}`)
        clearFormState(exchange, mode)
        await fetchApis()
        // Auto-detect sub-accounts after saving Bybit keys
        if (exchange === 'bybit') {
          fetchSubAccounts(exchange, mode)
        }
      }
    } catch (err) {
      setTestResult(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setSaving(null)
    }
  }

  const deleteApiKeys = async (exchange: string, mode: 'demo' | 'real') => {
    try {
      await fetch(`/api/exchange?exchange=${exchange}&mode=${mode}`, { method: 'DELETE' })
      fetchApis()
      setTestResult('Keys removed')
    } catch {}
  }

  // Fetch sub-accounts for a given exchange:mode
  const fetchSubAccounts = async (exchange: string, mode: string) => {
    if (exchange !== 'bybit') return
    const key = `${exchange}:${mode}`
    setLoadingSubs(prev => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`/api/bybit/sub-accounts?mode=${mode}`)
      if (res.ok) {
        const data = await res.json()
        setSubAccounts(prev => ({ ...prev, [key]: data.subAccounts || [] }))
      }
    } catch {} finally {
      setLoadingSubs(prev => ({ ...prev, [key]: false }))
    }
  }

  // Select a sub-account and save it
  const selectSubAccount = async (exchange: string, mode: string, memberId: string | null, memberName: string | null) => {
    try {
      await fetch('/api/exchange', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, mode, subMemberId: memberId, subAccountName: memberName }),
      })
      fetchApis()
      const label = memberId ? `sub-account "${memberName}"` : 'main account'
      setTestResult(`✅ Przełączono on ${label}`)
    } catch {}
  }

  // Toggle logs ON/OFF
  const toggleLogs = async () => {
    setLogsLoading(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'logs_enabled', value: String(!logsEnabled) }),
      })
      if (res.ok) {
        const data = await res.json()
        setLogsEnabledState(data.logsEnabled !== false)
      }
    } catch {} finally {
      setLogsLoading(false)
    }
  }

  const ExchangeForm = ({ exchange, mode, icon, title, accentColor, accentBg }: {
    exchange: string; mode: 'demo' | 'real'
    icon: React.ReactNode; title: string; accentColor: string; accentBg: string
  }) => {
    const form = getFormState(exchange, mode)
    const saveKey = `${exchange}:${mode}`
    const apiConfig = apis.find(a => a.exchange === exchange && a.mode === mode)
    const configured = apiConfig?.isConfigured
    const masked = apiConfig?.apiKeyMasked
    const currentSubId = apiConfig?.subMemberId
    const currentSubName = apiConfig?.subAccountName
    const exchangeLabel = 'Bybit'
    const apiEndpoint = mode === 'demo' ? 'api-testnet.bybit.com' : 'api.bybit.com'
    const subsKey = `${exchange}:${mode}`
    const subs = subAccounts[subsKey] || []
    const isLoadingSubs = loadingSubs[subsKey]

    return (
      <div
        style={{
          background: te.bg,
          border: `1px solid ${te.border}`,
          borderLeft: `2px solid ${accentColor}`,
          borderRadius: '2px',
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: accentColor }}>{title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {configured && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider"
                style={{ background: accentBg, color: te.text, borderRadius: '1px' }}
              >
                ACTIVE
              </span>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3 py-2 space-y-2">
          {/* Fee bar */}
          <div className="text-[9px] px-2 py-1 flex items-center gap-2" style={{ borderRadius: '1px', color: te.orange, background: `${te.orange}12` }}>
            <span style={{ opacity: 0.6 }}>ISOLATED FUTURES:</span>
            <span className="font-medium">Maker 0.02%</span>
            <span style={{ opacity: 0.3 }}>|</span>
            <span className="font-medium">Taker 0.055%</span>
          </div>

          {/* Active key + sub-account info */}
          {configured && masked && (
            <div className="text-[10px] px-2 py-1 font-mono flex items-center justify-between" style={{ borderRadius: '1px', color: te.textDim, background: te.bgInput, border: `1px solid ${te.border}` }}>
              <span><span style={{ color: te.textDim }}>KEY:</span> <span style={{ color: te.textMuted }}>{masked}</span></span>
              {currentSubName && (
                <span style={{ color: te.orange, fontSize: '9px' }}>SUB: {currentSubName}</span>
              )}
            </div>
          )}

          {/* Input fields — full width stacked */}
          <div className="space-y-1.5">
            <div>
              <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>API Key</Label>
              <Input
                placeholder={`${exchangeLabel} API Key`}
                value={form.key}
                onChange={e => form.setKey(e.target.value)}
                className="h-7 text-[11px] font-mono"
                style={{ borderRadius: '2px', background: te.bgInput, borderColor: te.border, color: te.text }}
                type="password"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider mb-0.5 block" style={{ color: te.textDim }}>API Secret</Label>
              <Input
                placeholder={`${exchangeLabel} API Secret`}
                value={form.secret}
                onChange={e => form.setSecret(e.target.value)}
                className="h-7 text-[11px] font-mono"
                style={{ borderRadius: '2px', background: te.bgInput, borderColor: te.border, color: te.text }}
                type="password"
              />
            </div>
          </div>

          {/* Buttons — compact, aligned */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => saveApiKeys(exchange, mode)}
              disabled={saving === saveKey}
              className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
              style={{
                background: accentColor,
                color: te.bg,
                borderRadius: '2px',
                minWidth: '120px',
              }}
            >
              {saving === saveKey ? <RefreshCw className="size-3 animate-spin" /> : <Plus className="size-3" />}
              {saving === saveKey ? 'TEST...' : 'DODAJ SUBKONTO'}
            </button>
            {configured && (
              <button
                onClick={() => fetchSubAccounts(exchange, mode)}
                disabled={isLoadingSubs}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
                style={{ borderRadius: '2px', color: te.orange, background: `${te.orange}15` }}
              >
                {isLoadingSubs ? <RefreshCw className="size-3 animate-spin" /> : <Users className="size-3" />}
                SUB
              </button>
            )}
            {configured && (
              <button
                onClick={() => deleteApiKeys(exchange, mode)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all"
                style={{ borderRadius: '2px', color: te.red, background: `${te.red}15` }}
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>

          {/* ── Sub-account selector ── */}
          {configured && subs.length > 0 && (
            <div style={{ borderRadius: '2px', border: `1px solid ${te.border}`, background: te.bg }}>
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider font-bold" style={{ borderBottom: `1px solid ${te.border}`, color: te.textDim }}>
                <Users className="size-3 inline mr-1" />Subkonta ({subs.length})
              </div>
              <div className="py-1">
                {/* Main account option */}
                <button
                  onClick={() => selectSubAccount(exchange, mode, null, null)}
                  className="w-full text-left px-2 py-1 text-[10px] font-mono transition-colors flex items-center justify-between"
                  style={{ background: !currentSubId ? '#f7a60010' : 'transparent', color: !currentSubId ? te.orange : te.textDim }}
                >
                  <span>{!currentSubId ? '● ' : '○ '}Main account</span>
                </button>
                {/* Sub-accounts */}
                {subs.map(sub => (
                  <button
                    key={sub.memberId}
                    onClick={() => selectSubAccount(exchange, mode, sub.memberId, sub.memberName)}
                    className="w-full text-left px-2 py-1 text-[10px] font-mono transition-colors flex items-center justify-between"
                    style={{ background: currentSubId === sub.memberId ? '#f7a60010' : 'transparent', color: currentSubId === sub.memberId ? te.orange : te.textMuted }}
                  >
                    <span>{currentSubId === sub.memberId ? '● ' : '○ '}{sub.memberName || sub.memberId}</span>
                    {sub.balance && (
                      <span style={{ color: te.green, fontSize: '9px' }}>${sub.balance.usdt.toFixed(2)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mode warnings */}
          {mode === 'real' && (
            <div className="text-[9px] font-mono" style={{ color: `${te.red}aa` }}>
              LIVE — {apiEndpoint} — real funds
            </div>
          )}
          {mode === 'demo' && (
            <div className="text-[9px] font-mono" style={{ color: te.textDim }}>
              TESTNET — api-testnet.bybit.com
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-sm">
          <Key className="size-4" />
          <span className="uppercase tracking-wider text-[12px] font-bold">Settings API</span>
        </DialogTitle>
        <DialogDescription className="text-[10px]" style={{ color: te.textDim }}>
          Skonfiguruj klucze API do automatycznego tradingu.
        </DialogDescription>
      </DialogHeader>

      <div className="text-[9px] px-3 py-2 space-y-1 font-mono" style={{ borderRadius: '2px', border: `1px solid ${te.border}`, background: `${te.orange}11`, color: te.textDim }}>
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: te.orange }}>Quick Start — Demo Trading</div>
        <div>1. Bybit: <a href="https://testnet.bybit.com" target="_blank" rel="noreferrer" style={{ color: te.cyan }}>testnet.bybit.com</a> → API → Create Key (Read + Trade)</div>
        <div>2. Paste key into <span style={{ color: te.yellow }}>Bybit Demo</span> below → Save</div>
        <div>3. W headerze przełącz on <span style={{ color: te.green }}>DEMO</span> → testnet balance will appear</div>
        <div>4. CEX Anomaly: enable PAPER or REAL (demo) → SCALPER mode</div>
      </div>

      <div className="space-y-3 mt-1">
        <ExchangeForm exchange="bybit" mode="demo" icon={<FlaskConical className="size-3.5 text-blue-500" />} title="Demo / Testnet" accentColor="#3b82f6" accentBg="#3b82f640" />
        <ExchangeForm exchange="bybit" mode="real" icon={<DollarSign className="size-3.5 text-red-500" />} title="Real / Live" accentColor="#ef4444" accentBg="#ef444440" />
        <div className="text-[9px] px-3 py-2 space-y-0.5 font-mono" style={{ borderRadius: '2px', border: `1px solid ${te.border}`, background: te.bg, color: te.textDim }}>
          <div className="text-[10px] font-bold mb-1 uppercase tracking-wider" style={{ color: te.orange }}>Bybit USDT Futures</div>
          <div>Isolated Margin · Maker: <span style={{ color: te.yellow }}>0.0200%</span> · Taker: <span style={{ color: te.yellow }}>0.0550%</span> · Round-trip: <span style={{ color: te.yellow }}>0.1100%</span></div>
          <div style={{ color: te.textDim }}>UTA Cross → <span style={{ color: te.green }}>auto Isolated per-pair</span> · click SUB to select sub-account</div>
        </div>

        {testResult && (
          <div
            className="text-[10px] px-3 py-1.5 font-mono"
            style={{ borderRadius: '2px', border: `1px solid ${testResult.startsWith('✅') ? `${te.green}22` : `${te.red}22`}`, color: testResult.startsWith('✅') ? te.green : te.red, background: testResult.startsWith('✅') ? `${te.green}10` : `${te.red}10` }}
          >
            {testResult}
          </div>
        )}

        {/* ── Logs Toggle ── */}
        <div
          style={{
            background: te.bg,
            border: `1px solid ${te.border}`,
            borderLeft: `2px solid ${te.purple}`,
            borderRadius: '2px',
          }}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <Terminal className="size-3.5 text-violet-500" />
              <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: te.purple }}>Logi serwera</span>
            </div>
            <button
              onClick={toggleLogs}
              disabled={logsLoading}
              className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
              style={{
                background: logsEnabled ? te.green : te.red,
                color: te.bg,
                borderRadius: '2px',
                minWidth: '80px',
                justifyContent: 'center',
              }}
            >
              {logsLoading ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : logsEnabled ? (
                <Volume2 className="size-3" />
              ) : (
                <VolumeX className="size-3" />
              )}
              {logsLoading ? '...' : logsEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="px-3 pb-2 text-[9px] font-mono" style={{ color: te.textDim }}>
            {logsEnabled ? (
              <span>console.log + console.warn active — <span style={{ color: te.yellow }}>may clog bot</span></span>
            ) : (
              <span>Logi wyciszone — <span style={{ color: te.green }}>tylko console.error widoczny</span></span>
            )}
          </div>
        </div>

        {/* ── LLM Analyst Settings ── */}
        <LlmSettingsSection />

        {loading && <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: te.textDim }}>Loading...</div>}
      </div>
    </>
  )
}
