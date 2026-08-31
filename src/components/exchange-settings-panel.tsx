'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Key, RefreshCw, FlaskConical, DollarSign } from 'lucide-react'

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [apis, setApis] = useState<Array<{ id: string; exchange: string; mode: string; isConfigured: boolean; apiKeyMasked: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [selectedExchange, setSelectedExchange] = useState<'bybit' | 'binance'>('bybit')

  // Form state for each exchange+mode
  const [bybitDemoApiKey, setBybitDemoApiKey] = useState('')
  const [bybitDemoApiSecret, setBybitDemoApiSecret] = useState('')
  const [bybitRealApiKey, setBybitRealApiKey] = useState('')
  const [bybitRealApiSecret, setBybitRealApiSecret] = useState('')
  const [binanceDemoApiKey, setBinanceDemoApiKey] = useState('')
  const [binanceDemoApiSecret, setBinanceDemoApiSecret] = useState('')
  const [binanceRealApiKey, setBinanceRealApiKey] = useState('')
  const [binanceRealApiSecret, setBinanceRealApiSecret] = useState('')

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

  useEffect(() => { fetchApis() }, [fetchApis])

  const getFormState = (exchange: string, mode: string) => {
    if (exchange === 'binance') {
      return mode === 'demo'
        ? { key: binanceDemoApiKey, setKey: setBinanceDemoApiKey, secret: binanceDemoApiSecret, setSecret: setBinanceDemoApiSecret }
        : { key: binanceRealApiKey, setKey: setBinanceRealApiKey, secret: binanceRealApiSecret, setSecret: setBinanceRealApiSecret }
    }
    return mode === 'demo'
      ? { key: bybitDemoApiKey, setKey: setBybitDemoApiKey, secret: bybitDemoApiSecret, setSecret: setBybitDemoApiSecret }
      : { key: bybitRealApiKey, setKey: setBybitRealApiKey, secret: bybitRealApiSecret, setSecret: setBybitRealApiSecret }
  }

  const clearFormState = (exchange: string, mode: string) => {
    if (exchange === 'binance') {
      if (mode === 'demo') { setBinanceDemoApiKey(''); setBinanceDemoApiSecret('') }
      else { setBinanceRealApiKey(''); setBinanceRealApiSecret('') }
    } else {
      if (mode === 'demo') { setBybitDemoApiKey(''); setBybitDemoApiSecret('') }
      else { setBybitRealApiKey(''); setBybitRealApiSecret('') }
    }
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
        fetchApis()
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

  const ExchangeForm = ({ exchange, mode, icon, title, borderColor, bgColor }: {
    exchange: string; mode: 'demo' | 'real'
    icon: React.ReactNode; title: string; borderColor: string; bgColor: string
  }) => {
    const form = getFormState(exchange, mode)
    const saveKey = `${exchange}:${mode}`
    const configured = apis.find(a => a.exchange === exchange && a.mode === mode)?.isConfigured
    const masked = apis.find(a => a.exchange === exchange && a.mode === mode)?.apiKeyMasked
    const isBinance = exchange === 'binance'
    const exchangeLabel = isBinance ? 'Binance' : 'Bybit'
    const apiEndpoint = isBinance ? (mode === 'demo' ? 'testnet.binance.vision' : 'api.binance.com') : mode === 'demo' ? 'api-testnet.bybit.com' : 'api.bybit.com'

    return (
      <Card className={borderColor}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {icon}
              <CardTitle className="text-sm">{title}</CardTitle>
            </div>
            <div className="flex items-center gap-1.5">
              {configured && (
                <Badge className={`${bgColor} text-white text-[10px]`}>Skonfigurowane</Badge>
              )}
              {isBinance && (
                <Badge className="bg-yellow-600 text-white text-[9px]">BINANCE</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isBinance && (
            <div className="text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 rounded px-2 py-1 flex items-center gap-2">
              <span>💰 Opłaty:</span>
              <span className="font-medium">Maker 0.10%</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-medium">Taker 0.10%</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-medium">BNB -25%</span>
            </div>
          )}
          {!isBinance && (
            <div className="text-[10px] text-orange-400 bg-orange-500/10 rounded px-2 py-1 flex items-center gap-2">
              <span>💰 Opłaty Futures:</span>
              <span className="font-medium">Maker 0.02%</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-medium">Taker 0.055%</span>
            </div>
          )}
          {configured && masked && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              Aktywny klucz: <span className="font-mono">{masked}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">API Key</Label>
              <Input placeholder={`${exchangeLabel} API Key`} value={form.key} onChange={e => form.setKey(e.target.value)} className="h-8 text-xs" type="password" />
            </div>
            <div>
              <Label className="text-xs">API Secret</Label>
              <Input placeholder={`${exchangeLabel} API Secret`} value={form.secret} onChange={e => form.setSecret(e.target.value)} className="h-8 text-xs" type="password" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className={`flex-1 h-7 text-xs ${bgColor} hover:opacity-90`} onClick={() => saveApiKeys(exchange, mode)} disabled={saving === saveKey}>
              {saving === saveKey ? <RefreshCw className="size-3 mr-1 animate-spin" /> : <Key className="size-3 mr-1" />}
              Zapisz i przetestuj
            </Button>
            {configured && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => deleteApiKeys(exchange, mode)}>Delete</Button>
            )}
          </div>
          {mode === 'real' && (
            <div className="text-[10px] text-red-500/80">
              ⚠️ Real capital — exchange: <span className="font-mono">{apiEndpoint}</span> — You are using real funds!
            </div>
          )}
          {mode === 'demo' && !isBinance && (
            <div className="text-[10px] text-muted-foreground">
              Bybit Testnet: <span className="font-mono">api-testnet.bybit.com</span> lub <span className="font-mono">api-testnet.bybit.eu</span>
            </div>
          )}
          {mode === 'demo' && isBinance && (
            <div className="text-[10px] text-muted-foreground">
              Binance Testnet: <span className="font-mono">testnet.binance.vision</span> — klucze of testnet.binance.vision
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <Key className="size-5" />
        <div>
          <h2 className="text-base font-semibold">Settings API</h2>
          <p className="text-xs text-muted-foreground">
            Configure API keys for automated trading. Supported exchanges: Bybit, Binance.
          </p>
        </div>
      </div>
      <div className="space-y-4 mt-2">
        <div className="flex items-center bg-muted rounded p-0.5">
          <button
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-sm transition-colors ${selectedExchange === 'bybit' ? 'bg-orange-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setSelectedExchange('bybit')}
          >
            🟠 Bybit
          </button>
          <button
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-sm transition-colors ${selectedExchange === 'binance' ? 'bg-yellow-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setSelectedExchange('binance')}
          >
            🟡 Binance
          </button>
        </div>

        {selectedExchange === 'bybit' && (
          <>
            <ExchangeForm
              exchange="bybit" mode="demo"
              icon={<FlaskConical className="size-4 text-blue-500" />}
              title="Demo (Testnet)"
              borderColor="border-blue-500/30"
              bgColor="bg-blue-600"
            />
            <ExchangeForm
              exchange="bybit" mode="real"
              icon={<DollarSign className="size-4 text-red-500" />}
              title="Real (Real capital)"
              borderColor="border-red-500/30"
              bgColor="bg-red-600"
            />
          </>
        )}

        {selectedExchange === 'binance' && (
          <>
            <ExchangeForm
              exchange="binance" mode="demo"
              icon={<FlaskConical className="size-4 text-yellow-500" />}
              title="Demo (Testnet)"
              borderColor="border-yellow-500/30"
              bgColor="bg-yellow-600"
            />
            <ExchangeForm
              exchange="binance" mode="real"
              icon={<DollarSign className="size-4 text-red-500" />}
              title="Real (Real capital)"
              borderColor="border-red-500/30"
              bgColor="bg-red-600"
            />
            <div className="text-[10px] text-muted-foreground bg-yellow-500/5 rounded px-3 py-2 space-y-1">
              <div className="font-medium text-yellow-600 dark:text-yellow-400">Informacje o oppatchch Binance:</div>
              <div>• Maker: <span className="font-medium text-amber-400">0.1000%</span> — oppatch za limity</div>
              <div>• Taker: <span className="font-medium text-amber-400">0.1000%</span> — oppatch za zlecenia rynkowe</div>
              <div>• Z BNB: <span className="font-medium text-emerald-400">-25%</span> fee discount</div>
              <div>• Backtest default: <span className="font-medium">0.10%</span> (avg Maker+Taker)</div>
            </div>
          </>
        )}

        {testResult && (
          <div className={`text-xs rounded px-3 py-2 ${testResult.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
            {testResult}
          </div>
        )}

        {loading && <div className="text-xs text-muted-foreground">Loading...</div>}
      </div>
    </>
  )
}
