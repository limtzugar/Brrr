// @ts-nocheck — legacy file from previous session, needs refactoring
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { AlertTriangle, FlaskConical, DollarSign, Key, RefreshCw } from 'lucide-react'
import { type CapitalData } from '@/lib/crypto-shared'
import AssetChartModal, { type AssetChartInfo, cryptoTickerToTvSymbol } from '@/components/asset-chart-modal'

interface PortfelTabProps {
  onOpenAssetChart?: (asset: AssetChartInfo) => void
}

export default function PortfelTab({ onOpenAssetChart }: PortfelTabProps) {
  const [exchange, setExchange] = useState<'bybit' | 'mexc' | 'binance'>('bybit')
  const [mode, setMode] = useState<'demo' | 'real'>('demo')
  const [balance, setBalance] = useState<{
    totalEquityUsdt: number
    coins: Array<{
      coin: string; equity: string; walletBalance: string; availableToWithdraw: string; unrealisedPnl: string; free: string; locked: string
    }>
    lastUpdated: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ time: string; value: number }>>([])
  const [configs, setConfigs] = useState<Array<{ exchange: string; mode: string; isConfigured: boolean }>>([])
  const [sellAllLoading, setSellAllLoading] = useState(false)
  const [sellAllResult, setSellAllResult] = useState<{ message: string; soldCount: number; errorCount: number } | null>(null)
  const [sellAllConfirm, setSellAllConfirm] = useState(false)

  const checkConfigs = useCallback(async () => {
    try { const res = await fetch('/api/exchange'); if (res.ok) { const data = await res.json(); setConfigs(data.exchanges || []) } } catch {}
  }, [])

  useEffect(() => { void checkConfigs() }, [checkConfigs])

  const fetchBalance = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const baseUrl = exchange === 'mexc' ? '/api/mexc/balance' : exchange === 'binance' ? '/api/binance/balance' : '/api/bybit/balance'
      const res = await fetch(`${baseUrl}?mode=${mode}`)
      if (res.ok) {
        const data = await res.json()
        setBalance({ totalEquityUsdt: data.totalEquityUsdt || 0, coins: data.coins || [], lastUpdated: data.lastUpdated })
        setHistory(prev => {
          const now = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
          const entry = { time: now, value: data.totalEquityUsdt || 0 }
          const newHist = [...prev, entry]
          return newHist.length > 60 ? newHist.slice(-60) : newHist
        })
      } else { const data = await res.json(); setError(data.error || 'Failed to fetch balance') }
    } catch { setError('Connection error') }
    finally { setLoading(false) }
  }, [exchange, mode])

  useEffect(() => {
    const bybitOk = configs.some(c => c.exchange === 'bybit' && c.isConfigured)
    const mexcOk = configs.some(c => c.exchange === 'mexc' && c.isConfigured)
    const binanceOk = configs.some(c => c.exchange === 'binance' && c.isConfigured)
    if (!bybitOk && !binanceOk && mexcOk) setExchange('mexc')
    if (!bybitOk && !mexcOk && binanceOk) setExchange('binance')
    if (bybitOk || mexcOk || binanceOk) void fetchBalance()
  }, [configs, fetchBalance])

  useEffect(() => { const interval = setInterval(() => void fetchBalance(), 30000); return () => clearInterval(interval) }, [fetchBalance])

  const handleSellAll = useCallback(async () => {
    setSellAllLoading(true); setSellAllResult(null)
    try {
      const res = await fetch('/api/sell-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchange, mode }) })
      const data = await res.json()
      if (res.ok) { setSellAllResult({ message: data.message, soldCount: data.soldCount, errorCount: data.errorCount }); await fetchBalance() }
      else { setSellAllResult({ message: data.error || 'Sell failed', soldCount: 0, errorCount: 1 }) }
    } catch { setSellAllResult({ message: 'Server connection error', soldCount: 0, errorCount: 1 }) }
    finally { setSellAllLoading(false); setSellAllConfirm(false) }
  }, [exchange, mode, fetchBalance])

  const usdtCoin = balance?.coins.find(c => c.coin === 'USDT')
  const nonUsdtCoins = balance?.coins.filter(c => c.coin !== 'USDT' && Number(c.equity) > 0) || []
  const isConfigured = configs.some(c => c.exchange === exchange && c.isConfigured)
  const capitalChange = history.length >= 2 ? history[history.length - 1].value - history[history.length - 2].value : 0
  const capitalChangePct = history.length >= 2 && history[history.length - 2].value > 0 ? ((history[history.length - 1].value - history[history.length - 2].value) / history[history.length - 2].value) * 100 : 0

  return (
    <div className="min-h-[calc(100vh-120px)] bg-neutral-200 dark:bg-neutral-800 rounded-xl p-4">
      <div className="max-w-md mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Portfel</h2>
          <div className="flex items-center gap-1.5">
            {isConfigured && nonUsdtCoins.length > 0 && (
              <Dialog open={sellAllConfirm} onOpenChange={setSellAllConfirm}>
                <DialogTrigger asChild><Button variant="destructive" size="sm" className="h-7 px-2.5 text-[10px] font-bold gap-1" disabled={sellAllLoading}><span>🔥</span>SELL ALL</Button></DialogTrigger>
                <DialogContent className="max-w-xs"><DialogHeader className="sr-only"><DialogTitle><VisuallyHidden.Root>Confirm sell all assets</VisuallyHidden.Root></DialogTitle></DialogHeader>
                  <div className="text-center py-4 space-y-3">
                    <div className="size-12 mx-auto rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center"><span className="text-2xl">🔥</span></div>
                    <div><p className="text-sm font-bold">Sell everything?</p><p className="text-xs text-muted-foreground mt-1">Market sell {nonUsdtCoins.length} assets on {exchange === 'bybit' ? 'Bybit' : exchange === 'binance' ? 'Binance' : 'MEXC'} ({mode})</p></div>
                    <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground bg-muted rounded-md px-2 py-1.5">{nonUsdtCoins.map(c => c.coin).join(', ')}</div>
                    <div className="flex items-center gap-2 justify-center pt-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSellAllConfirm(false)}>Anuluj</Button>
                      <Button variant="destructive" size="sm" className="h-8 text-xs gap-1" onClick={() => void handleSellAll()} disabled={sellAllLoading}>{sellAllLoading && <RefreshCw className="size-3 animate-spin" />}SPRZEDAJ WSZYSTKO</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <Button variant="ghost" size="sm" className="size-7" onClick={() => void fetchBalance()} disabled={loading}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
          </div>
        </div>
        {sellAllResult && <div className={`text-[10px] px-3 py-2 rounded-md border ${sellAllResult.errorCount === 0 ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`}><span className="font-medium">{sellAllResult.message}</span><button className="ml-2 underline opacity-60 hover:opacity-100" onClick={() => setSellAllResult(null)}>zamknij</button></div>}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-md p-0.5 text-xs">
            <button className={`px-2 py-1 rounded-sm font-medium transition-colors ${exchange === 'bybit' ? 'bg-orange-600 text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setExchange('bybit')}>BYBIT</button>
            <button className={`px-2 py-1 rounded-sm font-medium transition-colors ${exchange === 'mexc' ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setExchange('mexc')}>MEXC</button>
            <button className={`px-2 py-1 rounded-sm font-medium transition-colors ${exchange === 'binance' ? 'bg-yellow-600 text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setExchange('binance')}>Binance</button>
          </div>
          <div className="flex items-center bg-muted rounded-md p-0.5 text-xs">
            <button className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${mode === 'demo' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setMode('demo')}>DEMO</button>
            <button className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${mode === 'real' ? 'bg-red-600 text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setMode('real')}>REAL</button>
          </div>
        </div>
        {!isConfigured && <Card className="bg-white dark:bg-neutral-900 border shadow-sm"><CardContent className="py-6 text-center"><Key className="size-8 mx-auto mb-2 text-muted-foreground" /><p className="text-xs text-muted-foreground">API keys for {exchange === 'bybit' ? 'Bybit' : exchange === 'binance' ? 'Binance' : 'MEXC'} ({mode}) are not configured.</p><p className="text-xs text-muted-foreground mt-1">Click ⚙️ in header to add keys.</p></CardContent></Card>}
        {isConfigured && <Card className="bg-white dark:bg-neutral-900 border shadow-sm"><CardContent className="pt-4 pb-3 px-4"><div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Portfolio value</span>{balance?.lastUpdated && <span className="text-[9px] text-muted-foreground">{new Date(balance.lastUpdated).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}</div><div className="text-2xl font-bold tracking-tight">${balance?.totalEquityUsdt.toFixed(2) || '0.00'}</div>{usdtCoin && <div className="text-[10px] text-muted-foreground mt-0.5">USDT: {Number(usdtCoin.walletBalance).toFixed(2)} ({Number(usdtCoin.free).toFixed(2)} available)</div>}</CardContent></Card>}
        {isConfigured && history.length > 1 && (<Card className="bg-white dark:bg-neutral-900 border shadow-sm"><CardContent className="pt-3 pb-2 px-4"><div className="flex items-center justify-between mb-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Equity curve</span>{capitalChange !== 0 && <span className={`text-[10px] font-semibold ${capitalChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{capitalChange >= 0 ? '+' : ''}{capitalChange.toFixed(2)} ({capitalChangePct >= 0 ? '+' : ''}{capitalChangePct.toFixed(2)}%)</span>}</div>
          <ChartContainer config={{ value: { label: 'Capital', color: '#10b981' } }} className="w-full h-[100px] mt-1"><AreaChart data={history} margin={{ top: 4, right: 4, bottom: 2, left: 4 }}><defs><linearGradient id="capCurveGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={capitalChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.25} /><stop offset="95%" stopColor={capitalChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} /><XAxis dataKey="time" tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Capital']} />} /><Area type="monotone" dataKey="value" stroke={capitalChange >= 0 ? '#10b981' : '#ef4444'} strokeWidth={2} fill="url(#capCurveGrad)" dot={history.length <= 10} isAnimationActive={false} /></AreaChart></ChartContainer></CardContent></Card>)}
        {isConfigured && nonUsdtCoins.length > 0 && (<Card className="bg-white dark:bg-neutral-900 border shadow-sm"><CardContent className="pt-3 pb-2 px-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Aktywa ({nonUsdtCoins.length})</span><div className="mt-2 space-y-1">{nonUsdtCoins.map(coin => { const equity = Number(coin.equity); const locked = Number(coin.locked); const pnl = Number(coin.unrealisedPnl); return (<div key={coin.coin} className="flex items-center justify-between bg-neutral-100 dark:bg-neutral-800 rounded-md px-2.5 py-1.5"><div className="flex items-center gap-2"><div className="size-5 rounded-full bg-gradient-to-br from-primary/30 to-primary/60 flex items-center justify-center"><span className="text-[8px] font-bold text-primary">{coin.coin.slice(0, 2)}</span></div><div><div className="text-xs font-semibold">{coin.coin}</div>{locked > 0 && <div className="text-[9px] text-muted-foreground">{locked.toFixed(4)} zablokowane</div>}</div></div><div className="flex items-center gap-2"><div className="text-right"><div className="text-xs font-semibold">{equity.toFixed(4)}</div>{pnl !== 0 && <div className={`text-[9px] ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}</div>}</div>{onOpenAssetChart && <button onClick={() => onOpenAssetChart(cryptoTickerToTvSymbol(coin.coin))} className="shrink-0 px-1.5 py-0.5 text-[7px] font-mono uppercase tracking-wider border border-border rounded hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground" title="Show on chart TradingView">📈 Wykres</button>}</div></div>) })}</div></CardContent></Card>)}
        {error && <Card className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"><CardContent className="pt-3 pb-2 px-4"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-red-500 shrink-0" /><span className="text-xs text-red-600 dark:text-red-400">{error}</span></div></CardContent></Card>}
      </div>
    </div>
  )
}
