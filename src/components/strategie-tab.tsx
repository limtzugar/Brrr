'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertTriangle,
  CircleStop,
  DollarSign,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Trophy,
} from 'lucide-react'
import {
  type StrategyConfig,
  type StrategyResult,
  type OptimizeResponse,
  type OptimizeResultItem,
  type ActiveStrategyInfo,
  type BacktestResponse,
  COIN_OPTIONS,
  STRATEGY_TYPE_OPTIONS,
  getStrategyTypeInfo,
  strategyTypeBadge,
  strategyTypeIcon,
  strategyTypeLabel,
  getStrategyParamsFromConfig,
  getDefaultParamsForType,
  DEFAULT_STRATEGIES,
} from '@/lib/crypto-shared'

interface StrategiessssTabProps {
  activeStrategiessss: ActiveStrategyInfo[]
  onStrategyChange: () => void
}

export default function StrategiessssTab({ activeStrategiessss, onStrategyChange }: StrategiessssTabProps) {
  const [strategies, setStrategiessss] = useState<StrategyConfig[]>(DEFAULT_STRATEGIES)
  const [results, setResults] = useState<Map<string, StrategyResult>>(new Map())
  const [running, setRunning] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [editForm, setEditForm] = useState<StrategyConfig | null>(null)
  const [activatingStrategy, setActivatingStrategy] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)

  // Auto-optimize state
  const [optimizeCoin, setOptimizeCoin] = useState('solana')
  const [optimizeDays, setOptimizeDays] = useState(90)
  const [optimizeStrategyType, setOptimizeStrategyType] = useState('dip_buying')
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResponse | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('trading-strategies')
      if (saved) {
        const parsed = JSON.parse(saved) as StrategyConfig[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          const migrated = parsed.map(s => ({
            ...s,
            strategy_type: s.strategy_type || 'dip_buying',
            ma_period: s.ma_period ?? 20, volume_threshold: s.volume_threshold ?? 1.5,
            deviation_threshold: s.deviation_threshold ?? 2, lookback_periods: s.lookback_periods ?? 20,
            breakout_confirm_bars: s.breakout_confirm_bars ?? 2, grid_spacing_pct: s.grid_spacing_pct ?? 2,
            grid_levels: s.grid_levels ?? 5, hurst_period: s.hurst_period ?? 100,
            hurst_threshold: s.hurst_threshold ?? 0.5, bb_period: s.bb_period ?? 20, bb_std: s.bb_std ?? 2,
            slippage_pct: s.slippage_pct ?? 0.05, simulate_wicks: s.simulate_wicks ?? true,
          }))
          setStrategiessss(migrated)
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('trading-strategies', JSON.stringify(strategies)) } catch {}
  }, [strategies])

  const runSingleBacktest = async (strategy: StrategyConfig, retryCount = 0): Promise<StrategyResult> => {
    const maxRetries = 2
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin_id: strategy.coin_id, days: strategy.days, strategy_type: strategy.strategy_type || 'dip_buying',
          dip_threshold_1h: strategy.dip_threshold_1h, dip_threshold_24h: strategy.dip_threshold_24h,
          take_profit_pct: strategy.take_profit_pct, stop_loss_pct: strategy.stop_loss_pct,
          initial_capital: strategy.initial_capital, compound: strategy.compound,
          max_holding_hours: strategy.max_holding_hours, fee_pct: strategy.fee_pct,
          ma_period: strategy.ma_period, volume_threshold: strategy.volume_threshold,
          deviation_threshold: strategy.deviation_threshold, lookback_periods: strategy.lookback_periods,
          breakout_confirm_bars: strategy.breakout_confirm_bars, grid_spacing_pct: strategy.grid_spacing_pct,
          grid_levels: strategy.grid_levels, hurst_period: strategy.hurst_period,
          hurst_threshold: strategy.hurst_threshold, bb_period: strategy.bb_period, bb_std: strategy.bb_std,
          slippage_pct: strategy.slippage_pct ?? 0.05, simulate_wicks: strategy.simulate_wicks ?? true,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const errMsg = errData.error || errData.details || `Error HTTP ${res.status}`
        if ((res.status === 429 || res.status === 502) && retryCount < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, retryCount)))
          return runSingleBacktest(strategy, retryCount + 1)
        }
        return { strategyId: strategy.id, loading: false, error: errMsg, data: null, retryCount }
      }
      const data = await res.json()
      return { strategyId: strategy.id, loading: false, error: null, data, retryCount }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Server connection error'
      if (retryCount < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, retryCount)))
        return runSingleBacktest(strategy, retryCount + 1)
      }
      return { strategyId: strategy.id, loading: false, error: errMsg, data: null, retryCount }
    }
  }

  const runAll = async () => {
    setRunning(true)
    const newResults = new Map<string, StrategyResult>()
    for (const s of strategies) { newResults.set(s.id, { strategyId: s.id, loading: true, error: null, data: null }) }
    setResults(new Map(newResults))
    for (const strategy of strategies) {
      const result = await runSingleBacktest(strategy)
      newResults.set(strategy.id, result)
      setResults(new Map(newResults))
      if (strategies.indexOf(strategy) < strategies.length - 1) await new Promise(r => setTimeout(r, 1500))
    }
    setRunning(false)
  }

  const retryStrategy = async (strategyId: string) => {
    const strategy = strategies.find(s => s.id === strategyId)
    if (!strategy) return
    setResults(prev => { const m = new Map(prev); m.set(strategyId, { strategyId, loading: true, error: null, data: null }); return m })
    const result = await runSingleBacktest(strategy)
    setResults(prev => { const m = new Map(prev); m.set(strategyId, result); return m })
  }

  const addStrategy = () => {
    const id = `strategy-${Date.now()}`
    const newStrategy: StrategyConfig = {
      id, name: 'Nowa strategia', strategy_type: 'dip_buying', coin_id: 'bitcoin',
      dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 5, stop_loss_pct: 2,
      max_holding_hours: 48, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
      ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2, lookback_periods: 20, breakout_confirm_bars: 2,
      grid_spacing_pct: 2, grid_levels: 5, hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2, slippage_pct: 0.05, simulate_wicks: true,
      leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
      futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    }
    setStrategiessss([...strategies, newStrategy])
    setEditingId(id); setEditForm(newStrategy)
  }

  const deleteStrategy = (id: string) => {
    setStrategiessss(strategies.filter(s => s.id !== id))
    const newResults = new Map(results); newResults.delete(id); setResults(newResults)
    if (editingId === id) { setEditingId(null); setEditForm(null) }
  }

  const saveStrategy = () => {
    if (!editForm) return
    setStrategiessss(strategies.map(s => s.id === editForm.id ? editForm : s))
    setEditingId(null); setEditForm(null)
  }

  const runOptimize = async () => {
    setOptimizing(true); setOptimizeError(null); setOptimizeResult(null)
    try {
      const res = await fetch('/api/backtest/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin_id: optimizeCoin, days: optimizeDays, initial_capital: 1000, compound: true, fee_pct: 0.1, strategy_type: optimizeStrategyType }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setOptimizeError(d.error || 'Optimization error') }
      else { setOptimizeResult(await res.json()) }
    } catch (err) { setOptimizeError(err instanceof Error ? err.message : 'Optimization error') }
    finally { setOptimizing(false) }
  }

  const addBestStrategy = () => {
    if (!optimizeResult?.best) return
    const best = optimizeResult.best
    const coinLabel = COIN_OPTIONS.find(c => c.id === best.params.coin_id)?.label || best.params.coin_id
    const newStrategy: StrategyConfig = {
      id: `optimized-${Date.now()}`, name: `${coinLabel} Optimized`, strategy_type: best.params.strategy_type || 'dip_buying', coin_id: best.params.coin_id,
      dip_threshold_1h: best.params.dip_threshold_1h ?? 0, dip_threshold_24h: best.params.dip_threshold_24h ?? -3,
      take_profit_pct: best.params.take_profit_pct ?? 5, stop_loss_pct: best.params.stop_loss_pct ?? 2,
      max_holding_hours: best.params.max_holding_hours ?? 48, fee_pct: best.params.fee_pct, initial_capital: best.params.initial_capital,
      days: best.params.days, compound: best.params.compound, trailing_stop_pct: 0,
      ma_period: best.params.ma_period ?? 20, volume_threshold: best.params.volume_threshold ?? 1.5,
      deviation_threshold: best.params.deviation_threshold ?? 2, lookback_periods: best.params.lookback_periods ?? 20,
      breakout_confirm_bars: best.params.breakout_confirm_bars ?? 2, grid_spacing_pct: best.params.grid_spacing_pct ?? 2,
      grid_levels: best.params.grid_levels ?? 5, hurst_period: best.params.hurst_period ?? 100,
      hurst_threshold: best.params.hurst_threshold ?? 0.5, bb_period: best.params.bb_period ?? 20, bb_std: best.params.bb_std ?? 2,
      slippage_pct: 0.05, simulate_wicks: true,
    }
    setStrategiessss([...strategies, newStrategy])
  }

  const addOptimizedStrategy = (item: OptimizeResultItem, rank: number) => {
    const coinLabel = COIN_OPTIONS.find(c => c.id === item.params.coin_id)?.label || item.params.coin_id
    const newStrategy: StrategyConfig = {
      id: `optimized-${Date.now()}-${rank}`, name: `${coinLabel} Top${rank}`, strategy_type: item.params.strategy_type || 'dip_buying', coin_id: item.params.coin_id,
      dip_threshold_1h: item.params.dip_threshold_1h ?? 0, dip_threshold_24h: item.params.dip_threshold_24h ?? -3,
      take_profit_pct: item.params.take_profit_pct ?? 5, stop_loss_pct: item.params.stop_loss_pct ?? 2,
      max_holding_hours: item.params.max_holding_hours ?? 48, fee_pct: item.params.fee_pct, initial_capital: item.params.initial_capital,
      days: item.params.days, compound: item.params.compound, trailing_stop_pct: 0,
      ma_period: item.params.ma_period ?? 20, volume_threshold: item.params.volume_threshold ?? 1.5,
      deviation_threshold: item.params.deviation_threshold ?? 2, lookback_periods: item.params.lookback_periods ?? 20,
      breakout_confirm_bars: item.params.breakout_confirm_bars ?? 2, grid_spacing_pct: item.params.grid_spacing_pct ?? 2,
      grid_levels: item.params.grid_levels ?? 5, hurst_period: item.params.hurst_period ?? 100,
      hurst_threshold: item.params.hurst_threshold ?? 0.5, bb_period: item.params.bb_period ?? 20, bb_std: item.params.bb_std ?? 2,
      slippage_pct: 0.05, simulate_wicks: true,
    }
    setStrategiessss([...strategies, newStrategy])
  }

  const bestStrategy = strategies.reduce((best, s) => {
    const r = results.get(s.id); if (!r?.data) return best
    if (!best || r.data.results.total_return_pct > best.returnPct) return { id: s.id, name: s.name, returnPct: r.data.results.total_return_pct }
    return best
  }, null as { id: string; name: string; returnPct: number } | null)

  const activateStrategy = async (strategy: StrategyConfig, mode: 'demo' | 'real') => {
    setActivatingStrategy(`${strategy.id}:${mode}`); setActivationError(null)
    try {
      const res = await fetch('/api/strategies/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: strategy.id, name: strategy.name, coinId: strategy.coin_id, mode,
          strategyType: strategy.strategy_type || 'dip_buying', strategyParams: getStrategyParamsFromConfig(strategy),
          dipThreshold1h: strategy.dip_threshold_1h, dipThreshold24h: strategy.dip_threshold_24h,
          takeProfitPct: strategy.take_profit_pct, stopLossPct: strategy.stop_loss_pct,
          maxHoldingHours: strategy.max_holding_hours, feePct: strategy.fee_pct,
          initialCapital: strategy.initial_capital, compound: strategy.compound,
        }),
      })
      const data = await res.json()
      if (!res.ok) setActivationError(data.error || 'Failed to activate strategy')
      else onStrategyChange()
    } catch (err) { setActivationError(err instanceof Error ? err.message : 'Server connection error') }
    finally { setActivatingStrategy(null) }
  }

  const deactivateStrategyHandler = async (strategyId: string, mode: 'demo' | 'real') => {
    setActivatingStrategy(`${strategyId}:${mode}`); setActivationError(null)
    try {
      const res = await fetch('/api/strategies/deactivate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId, mode }),
      })
      const data = await res.json()
      if (!res.ok) setActivationError(data.error || 'Failed to deactivate')
      else onStrategyChange()
    } catch (err) { setActivationError(err instanceof Error ? err.message : 'Connection error') }
    finally { setActivatingStrategy(null) }
  }

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", color: '#111', minHeight: '100%', background: '#FFFFFF' }}>
      {activationError && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'rgba(232,0,61,0.08)', border: '1px solid #E8003D', padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#E8003D' }}><AlertTriangle className="size-4 shrink-0" /><span>{activationError}</span></div>
          <button onClick={() => setActivationError(null)} style={{ fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: '1px solid #E8003D', color: '#E8003D', padding: '2px 8px', cursor: 'pointer' }}>Zamknij</button>
        </div>
      )}
      {/* Auto-Optimize Section */}
      <div style={{ border: '1px solid #DDDDDD', background: '#FFFFFF', marginBottom: 12 }}>
        <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setOptimizeOpen(!optimizeOpen)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 2, background: '#FF6600', display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#FF6600' }}>AUTO-OPTYMALIZACJA</span>
          </div>
          {optimizeOpen ? <ChevronUp className="size-4" style={{ color: '#999' }} /> : <ChevronDown className="size-4" style={{ color: '#999' }} />}
        </button>
        {optimizeOpen && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px solid #DDDDDD' }}>
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                <div><Label className="text-xs">Coin</Label><Select value={optimizeCoin} onValueChange={setOptimizeCoin}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{COIN_OPTIONS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Strategia</Label><Select value={optimizeStrategyType} onValueChange={setOptimizeStrategyType}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{STRATEGY_TYPE_OPTIONS.map(t => { const Icon = t.icon; return <SelectItem key={t.id} value={t.id}><span className="flex items-center gap-1.5"><Icon className="size-3" />{t.label}</span></SelectItem> })}</SelectContent></Select></div>
                <div><Label className="text-xs">Period (days)</Label><Select value={String(optimizeDays)} onValueChange={v => setOptimizeDays(Number(v))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 dni</SelectItem><SelectItem value="90">90 dni</SelectItem><SelectItem value="180">180 dni</SelectItem><SelectItem value="365">365 dni</SelectItem></SelectContent></Select></div>
                <div><button className="w-full h-9" style={{ fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: optimizing ? '#999' : '#FF6600', color: '#000', border: 'none', cursor: optimizing ? 'not-allowed' : 'pointer', padding: '0 12px' }} onClick={runOptimize} disabled={optimizing}>{optimizing ? 'SEARCHING...' : 'DETECT BEST'}</button></div>
              </div>
            </div>
            {optimizeError && <div style={{ fontSize: 9, color: '#E8003D', background: 'rgba(232,0,61,0.08)', border: '1px solid #E8003D', padding: '8px 10px', marginTop: 8, letterSpacing: '0.04em' }}>{optimizeError}</div>}
            {optimizing && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: '#999', background: '#F5F5F5', border: '1px solid #DDDDDD', padding: '8px 10px', marginTop: 8, letterSpacing: '0.04em' }}><RefreshCw className="size-3.5 animate-spin" /><span>Testing parameter combinations ({getStrategyTypeInfo(optimizeStrategyType).label})... May take 10-30s</span></div>}
            {optimizeResult && !optimizing && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Tested <strong>{optimizeResult.total_combinations}</strong> combinations</span><span className="text-muted-foreground/50">|</span><span>Valid strategies: <strong>{optimizeResult.valid_strategies}</strong></span></div>
                {optimizeResult.best && (
                  <div style={{ background: 'rgba(26,161,103,0.06)', border: '1px solid rgba(26,161,103,0.3)', padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Trophy className="size-4" style={{ color: '#1AA167' }} /><span style={{ fontSize: 9, fontWeight: 700, color: '#1AA167', letterSpacing: '0.06em' }}>NAJLEPSZA STRATEGIA ({getStrategyTypeInfo(optimizeResult.strategy_type).label}) dla {COIN_OPTIONS.find(c => c.id === optimizeResult.coin_id)?.label || optimizeResult.coin_id}</span></div>
                      <button onClick={addBestStrategy} style={{ fontFamily: 'inherit', fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'transparent', border: '1px solid #1AA167', color: '#1AA167', padding: '3px 8px', cursor: 'pointer' }}>+ Dodaj do listy</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[{ label: 'RETURN', value: `${optimizeResult.best.total_return_pct >= 0 ? '+' : ''}${optimizeResult.best.total_return_pct.toFixed(2)}%`, color: optimizeResult.best.total_return_pct >= 0 ? '#1AA167' : '#E8003D' }, { label: 'WIN RATE', value: `${optimizeResult.best.win_rate.toFixed(1)}%`, color: optimizeResult.best.win_rate >= 50 ? '#1AA167' : '#D97706' }, { label: 'PROFIT FACTOR', value: optimizeResult.best.profit_factor >= 999 ? '999+' : optimizeResult.best.profit_factor.toFixed(2), color: optimizeResult.best.profit_factor >= 1.5 ? '#1AA167' : '#D97706' }, { label: 'MAX DRAWDOWN', value: `-${optimizeResult.best.max_drawdown_pct.toFixed(2)}%`, color: '#E8003D' }].map((stat, i) => (
                        <div key={i} style={{ background: '#FFFFFF', border: '1px solid #DDDDDD', padding: '6px 8px' }}><div style={{ fontSize: 7, letterSpacing: '0.1em', color: '#999', textTransform: 'uppercase' }}>{stat.label}</div><div style={{ fontSize: 16, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</div></div>
                      ))}
                    </div>
                    <Separator className="my-3" />
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                      {optimizeResult.strategy_type === 'dip_buying' && <><div><span className="text-muted-foreground">Dip 1h:</span> <span className="font-medium">{optimizeResult.best.params.dip_threshold_1h}%</span></div><div><span className="text-muted-foreground">Dip 24h:</span> <span className="font-medium">{optimizeResult.best.params.dip_threshold_24h}%</span></div></>}
                      {optimizeResult.best.params.take_profit_pct != null && <div><span className="text-muted-foreground">TP:</span> <span className="font-medium text-emerald-500">+{optimizeResult.best.params.take_profit_pct}%</span></div>}
                      {optimizeResult.best.params.stop_loss_pct != null && <div><span className="text-muted-foreground">SL:</span> <span className="font-medium text-red-500">-{optimizeResult.best.params.stop_loss_pct}%</span></div>}
                      {optimizeResult.best.params.max_holding_hours != null && <div><span className="text-muted-foreground">Max hold:</span> <span className="font-medium">{optimizeResult.best.params.max_holding_hours}h</span></div>}
                    </div>
                  </div>
                )}
                {optimizeResult.top_20.length > 1 && (
                  <div style={{ border: '1px solid #DDDDDD', background: '#FFFFFF' }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid #DDDDDD', background: 'rgba(255,102,0,0.04)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 8, height: 2, background: '#FF6600', display: 'inline-block' }} /><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#FF6600', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}>TOP 20 STRATEGII</span></div></div>
                    <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                      <table className="w-full text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="pb-1.5 pr-2 font-medium">#</th><th className="pb-1.5 pr-2 font-medium">TP</th><th className="pb-1.5 pr-2 font-medium">SL</th><th className="pb-1.5 pr-2 font-medium text-right">Zwrot</th><th className="pb-1.5 pr-2 font-medium text-right">WR</th><th className="pb-1.5 pr-2 font-medium text-right">PF</th><th className="pb-1.5 pr-2 font-medium text-right">DD</th><th className="pb-1.5 pr-2 font-medium text-right">Score</th><th className="pb-1.5 font-medium"></th></tr></thead>
                        <tbody>{optimizeResult.top_20.map((item, idx) => (
                          <tr key={idx} className={`border-b last:border-0 ${idx === 0 ? 'bg-emerald-500/5' : ''}`}>
                            <td className="py-1.5 pr-2 font-medium">{idx + 1}</td>
                            <td className="py-1.5 pr-2 text-emerald-500">+{item.params.take_profit_pct}%</td>
                            <td className="py-1.5 pr-2 text-red-500">-{item.params.stop_loss_pct}%</td>
                            <td className={`py-1.5 pr-2 text-right font-medium ${item.total_return_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{item.total_return_pct >= 0 ? '+' : ''}{item.total_return_pct.toFixed(1)}%</td>
                            <td className={`py-1.5 pr-2 text-right ${item.win_rate >= 50 ? 'text-emerald-500' : 'text-red-500'}`}>{item.win_rate.toFixed(0)}%</td>
                            <td className={`py-1.5 pr-2 text-right ${item.profit_factor >= 1.5 ? 'text-emerald-500' : 'text-amber-500'}`}>{item.profit_factor >= 999 ? '999+' : item.profit_factor.toFixed(1)}</td>
                            <td className="py-1.5 pr-2 text-right text-red-500">-{item.max_drawdown_pct.toFixed(1)}%</td>
                            <td className="py-1.5 pr-2 text-right font-medium">{item.score.toFixed(1)}</td>
                            <td className="py-1.5 text-right"><Button variant="ghost" size="icon" className="size-6" onClick={() => addOptimizedStrategy(item, idx + 1)} title="Dodaj do listy"><Plus className="size-3" /></Button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Header with actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 28, background: '#FF6600' }} />
          <div><div style={{ fontSize: 7, letterSpacing: '0.28em', color: '#999', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}>TE-STRAT SYSTEM</div><div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', color: '#111', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}>STRATEGIE TRADINGOWE</div></div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={addStrategy} disabled={running} style={{ fontFamily: 'inherit', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 10px', background: 'transparent', border: '1px solid #DDDDDD', color: '#666', cursor: running ? 'not-allowed' : 'pointer' }}>+ DODAJ</button>
          <button onClick={runAll} disabled={running || strategies.length === 0} style={{ fontFamily: 'inherit', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 10px', background: running ? '#999' : '#FF6600', border: 'none', color: '#000', cursor: running ? 'not-allowed' : 'pointer' }}>{running ? 'OBICZAM…' : '▶ TESTUJ WSZYSTKIE'}</button>
        </div>
      </div>

      {bestStrategy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(26,161,103,0.06)', border: '1px solid rgba(26,161,103,0.3)', padding: '8px 12px', marginBottom: 8 }}>
          <Trophy className="size-4" style={{ color: '#1AA167' }} /><span style={{ fontSize: 9, color: '#1AA167', letterSpacing: '0.04em' }}>Najlepsza: <strong>{bestStrategy.name}</strong> ({bestStrategy.returnPct >= 0 ? '+' : ''}{bestStrategy.returnPct.toFixed(2)}%)</span>
        </div>
      )}

      {/* Active Trading */}
      {(() => {
        const runningStrategiessss = activeStrategiessss.filter(s => s.status === 'running')
        const stoppedStrategiessss = activeStrategiessss.filter(s => s.status !== 'running')
        return (
          <>
            {runningStrategiessss.length > 0 && (
              <div><div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: '#999', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 4, height: 4, borderRadius: '50%', background: '#1AA167', boxShadow: '0 0 4px #1AA167' }} />AKTYWNE STRATEGIE ({runningStrategiessss.length})</div>
                <div className="flex gap-2 overflow-x-auto pb-2">{runningStrategiessss.map(s => (
                  <div key={`${s.strategyId}:${s.mode}`} style={{ border: '1px solid #DDDDDD', background: '#FFFFFF', padding: 8, minWidth: 200, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.mode === 'demo' ? '#3B82F6' : '#E8003D' }}>{s.mode === 'demo' ? <FlaskConical className="size-2.5 text-white" /> : <DollarSign className="size-2.5 text-white" />}</div><div style={{ minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ fontSize: 9, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>{s.inPosition && <span style={{ fontSize: 6, background: '#D97706', color: '#FFF', padding: '1px 3px', letterSpacing: '0.08em' }}>POS</span>}</div><div style={{ fontSize: 7, color: '#999', letterSpacing: '0.04em' }}>{s.symbol} · {s.mode.toUpperCase()}</div></div></div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 8 }}><span style={{ fontWeight: 700, color: s.totalPnl >= 0 ? '#1AA167' : '#E8003D' }}>${s.totalPnl.toFixed(2)}</span><span style={{ color: '#999' }}>{s.totalTrades}t · {s.totalTrades > 0 ? ((s.winningTrades / s.totalTrades) * 100).toFixed(0) : 0}%</span></div>
                  </div>
                ))}</div>
              </div>
            )}
            {stoppedStrategiessss.length > 0 && (
              <div className="flex gap-2 overflow-x-auto" style={{ marginTop: 6 }}>{stoppedStrategiessss.map(s => (
                <div key={`${s.strategyId}:${s.mode}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 8, color: '#999', border: '1px solid #E8E8E8', padding: '3px 8px', flexShrink: 0, letterSpacing: '0.04em' }}><span style={{ fontWeight: 600 }}>{s.name}</span><span>PnL: <span style={{ color: s.totalPnl >= 0 ? '#1AA167' : '#E8003D' }}>${s.totalPnl.toFixed(2)}</span></span></div>
              ))}</div>
            )}
          </>
        )
      })()}

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {strategies.map(strategy => (
          <StrategyCard key={strategy.id} strategy={strategy} result={results.get(strategy.id) || null}
            onEdit={() => { setEditingId(strategy.id); setEditForm({ ...strategy }) }} onDelete={() => deleteStrategy(strategy.id)}
            isEditing={editingId === strategy.id} editForm={editForm} onEditFormChange={setEditForm} onSave={saveStrategy}
            onCancel={() => { setEditingId(null); setEditForm(null) }} activeInfo={activeStrategiessss} activatingKey={activatingStrategy}
            onActivate={activateStrategy} onDeactivate={deactivateStrategyHandler} onRetry={retryStrategy} />
        ))}
        <button onClick={addStrategy} style={{ border: '1px dashed #FF6600', background: '#FFFFFF', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#FF6600', cursor: 'pointer', minHeight: 200, fontFamily: 'inherit' }}>
          <Plus className="size-6" style={{ color: '#FF6600' }} /><span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF6600' }}>Add strategy</span>
        </button>
      </div>
    </div>
  )
}

// ─── Strategy Card ────────────────────────────────────────────────────────────

function StrategyCard({ strategy, result, onEdit, onDelete, isEditing, editForm, onEditFormChange, onSave, onCancel, activeInfo, activatingKey, onActivate, onDeactivate, onRetry }: {
  strategy: StrategyConfig; result: StrategyResult | null; onEdit: () => void; onDelete: () => void;
  isEditing: boolean; editForm: StrategyConfig | null; onEditFormChange: (f: StrategyConfig | null) => void;
  onSave: () => void; onCancel: () => void; activeInfo: ActiveStrategyInfo[]; activatingKey: string | null;
  onActivate: (s: StrategyConfig, mode: 'demo' | 'real') => void; onDeactivate: (strategyId: string, mode: 'demo' | 'real') => void; onRetry: (strategyId: string) => void
}) {
  const coinLabel = COIN_OPTIONS.find(c => c.id === strategy.coin_id)?.label || strategy.coin_id
  const demoActive = activeInfo.find(a => a.strategyId === strategy.id && a.mode === 'demo')
  const realActive = activeInfo.find(a => a.strategyId === strategy.id && a.mode === 'real')
  const demoActivating = activatingKey === `${strategy.id}:demo`
  const realActivating = activatingKey === `${strategy.id}:real`

  if (isEditing && editForm) {
    const currentType = editForm.strategy_type || 'dip_buying'
    const handleTypeChange = (newType: string) => { onEditFormChange({ ...editForm, strategy_type: newType, ...getDefaultParamsForType(newType) }) }
    return (
      <div style={{ border: '2px solid #FF6600', background: '#FFFFFF' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #DDDDDD', background: 'rgba(255,102,0,0.04)' }}>
          <Input value={editForm.name} onChange={e => onEditFormChange({ ...editForm, name: e.target.value })} style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', border: '1px solid #DDDDDD', background: '#FFFFFF', padding: '4px 8px' }} placeholder="Nazwa strategii" />
        </div>
        <div style={{ padding: '10px 14px' }}>
          <div><Label className="text-xs">Typ strategii</Label><Select value={currentType} onValueChange={handleTypeChange}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{STRATEGY_TYPE_OPTIONS.map(t => { const Icon = t.icon; return <SelectItem key={t.id} value={t.id}><div className="flex items-center gap-2"><Icon className="size-3.5" /><span>{t.label}</span></div></SelectItem> })}</SelectContent></Select></div>
          <div><Label className="text-xs">Coin</Label><Select value={editForm.coin_id} onValueChange={v => onEditFormChange({ ...editForm, coin_id: v })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{COIN_OPTIONS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          {(currentType === 'dip_buying') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Dip 1h (%)</Label><Input type="number" value={editForm.dip_threshold_1h} onChange={e => onEditFormChange({ ...editForm, dip_threshold_1h: Number(e.target.value) })} className="h-8" /></div><div><Label className="text-xs">Dip 24h (%)</Label><Input type="number" value={editForm.dip_threshold_24h} onChange={e => onEditFormChange({ ...editForm, dip_threshold_24h: Number(e.target.value) })} className="h-8" /></div></div>}
          {(currentType === 'momentum') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">MA period</Label><Input type="number" value={editForm.ma_period} onChange={e => onEditFormChange({ ...editForm, ma_period: Number(e.target.value) })} className="h-8" min={2} /></div><div><Label className="text-xs">Volume threshold</Label><Input type="number" value={editForm.volume_threshold} onChange={e => onEditFormChange({ ...editForm, volume_threshold: Number(e.target.value) })} className="h-8" step={0.1} min={0.1} /></div></div>}
          {(currentType === 'mean_reversion') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">MA period</Label><Input type="number" value={editForm.ma_period} onChange={e => onEditFormChange({ ...editForm, ma_period: Number(e.target.value) })} className="h-8" min={2} /></div><div><Label className="text-xs">Deviation threshold (σ)</Label><Input type="number" value={editForm.deviation_threshold} onChange={e => onEditFormChange({ ...editForm, deviation_threshold: Number(e.target.value) })} className="h-8" step={0.5} min={0.5} /></div></div>}
          {(currentType === 'breakout') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Okresy lookback</Label><Input type="number" value={editForm.lookback_periods} onChange={e => onEditFormChange({ ...editForm, lookback_periods: Number(e.target.value) })} className="h-8" min={2} /></div><div><Label className="text-xs">Paski potwierdzenia</Label><Input type="number" value={editForm.breakout_confirm_bars} onChange={e => onEditFormChange({ ...editForm, breakout_confirm_bars: Number(e.target.value) })} className="h-8" min={1} /></div></div>}
          {(currentType === 'grid') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Grid spacing (%)</Label><Input type="number" value={editForm.grid_spacing_pct} onChange={e => onEditFormChange({ ...editForm, grid_spacing_pct: Number(e.target.value) })} className="h-8" step={0.5} min={0.5} /></div><div><Label className="text-xs">Grid levels</Label><Input type="number" value={editForm.grid_levels} onChange={e => onEditFormChange({ ...editForm, grid_levels: Number(e.target.value) })} className="h-8" min={2} /></div></div>}
          {(currentType === 'hurst_hcoo_lb') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Okres Hurst</Label><Input type="number" value={editForm.hurst_period} onChange={e => onEditFormChange({ ...editForm, hurst_period: Number(e.target.value) })} className="h-8" /></div><div><Label className="text-xs">H prog (0.1-0.9)</Label><Input type="number" step={0.05} value={editForm.hurst_threshold} onChange={e => onEditFormChange({ ...editForm, hurst_threshold: Number(e.target.value) })} className="h-8" /></div><div><Label className="text-xs">BB okres</Label><Input type="number" value={editForm.bb_period} onChange={e => onEditFormChange({ ...editForm, bb_period: Number(e.target.value) })} className="h-8" /></div><div><Label className="text-xs">BB σ</Label><Input type="number" step={0.5} value={editForm.bb_std} onChange={e => onEditFormChange({ ...editForm, bb_std: Number(e.target.value) })} className="h-8" /></div></div>}
          <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Take Profit (%)</Label><Input type="number" value={editForm.take_profit_pct} onChange={e => onEditFormChange({ ...editForm, take_profit_pct: Number(e.target.value) })} step={0.5} className="h-8" /></div><div><Label className="text-xs">Stop Loss (%)</Label><Input type="number" value={editForm.stop_loss_pct} onChange={e => onEditFormChange({ ...editForm, stop_loss_pct: Number(e.target.value) })} step={0.5} className="h-8" /></div></div>
          <div className="grid grid-cols-3 gap-2"><div><Label className="text-xs">Max hold (h)</Label><Input type="number" value={editForm.max_holding_hours} onChange={e => onEditFormChange({ ...editForm, max_holding_hours: Number(e.target.value) })} className="h-8" /></div><div><Label className="text-xs">Fee (%)</Label><Input type="number" value={editForm.fee_pct} onChange={e => onEditFormChange({ ...editForm, fee_pct: Number(e.target.value) })} step={0.01} className="h-8" /></div><div><Label className="text-xs">Dni</Label><Input type="number" value={editForm.days} onChange={e => onEditFormChange({ ...editForm, days: Number(e.target.value) })} className="h-8" /></div></div>
          <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Capital ($)</Label><Input type="number" value={editForm.initial_capital} onChange={e => onEditFormChange({ ...editForm, initial_capital: Number(e.target.value) })} className="h-8" /></div><div className="flex items-end gap-2 pb-0.5"><Switch checked={editForm.compound} onCheckedChange={v => onEditFormChange({ ...editForm, compound: v })} /><Label className="text-xs">Compound</Label></div></div>
          <div className="border-t pt-2 mt-1"><div className="flex items-center gap-2 mb-2"><Thermometer className="size-3.5 text-orange-500" /><Label className="text-xs font-medium">Trailing Stop-Loss</Label><span className="text-[10px] text-muted-foreground">(0 = disabled)</span></div><div><Label className="text-xs">Trailing SL (%)</Label><Input type="number" value={editForm.trailing_stop_pct} onChange={e => onEditFormChange({ ...editForm, trailing_stop_pct: Number(e.target.value) })} step={0.5} min={0} className="h-8" /></div></div>
          <div style={{ display: 'flex', gap: 4, paddingTop: 4 }}><button onClick={onSave} style={{ flex: 1, fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 0', background: '#FF6600', border: 'none', color: '#000', cursor: 'pointer' }}>Zapisz</button><button onClick={onCancel} style={{ fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 10px', background: 'transparent', border: '1px solid #DDDDDD', color: '#666', cursor: 'pointer' }}>Anuluj</button></div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ border: `1px solid ${(demoActive || realActive) ? 'rgba(26,161,103,0.4)' : '#DDDDDD'}`, background: (demoActive || realActive) ? 'rgba(26,161,103,0.03)' : '#FFFFFF' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #DDDDDD', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          {strategyTypeIcon(strategy.strategy_type || 'dip_buying')}
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{strategy.name}</span>
          {strategyTypeBadge(strategy.strategy_type || 'dip_buying')}
          <span style={{ fontSize: 7, letterSpacing: '0.08em', color: '#999', border: '1px solid #DDDDDD', padding: '1px 4px', textTransform: 'uppercase' }}>{coinLabel}</span>
          {demoActive && <span style={{ fontSize: 6, background: '#3B82F6', color: '#FFF', padding: '1px 4px', letterSpacing: '0.08em' }}>DEMO</span>}
          {realActive && <span style={{ fontSize: 6, background: '#E8003D', color: '#FFF', padding: '1px 4px', letterSpacing: '0.08em' }}>REAL</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {demoActive ? <button onClick={() => onDeactivate(strategy.id, 'demo')} disabled={demoActivating} style={{ fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 6px', background: 'transparent', border: '1px solid #3B82F6', color: '#3B82F6', cursor: 'pointer' }}><CircleStop className="size-2.5" style={{ marginRight: 2, verticalAlign: 'middle' }} />Stop Demo</button>
            : <button onClick={() => onActivate(strategy, 'demo')} disabled={demoActivating} style={{ fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 6px', background: 'transparent', border: '1px solid rgba(59,130,246,0.3)', color: '#3B82F6', cursor: demoActivating ? 'not-allowed' : 'pointer' }}>{demoActivating ? <RefreshCw className="size-2.5 animate-spin" style={{ marginRight: 2, verticalAlign: 'middle' }} /> : <FlaskConical className="size-2.5" style={{ marginRight: 2, verticalAlign: 'middle' }} />}Demo</button>}
          {realActive ? <button onClick={() => onDeactivate(strategy.id, 'real')} disabled={realActivating} style={{ fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 6px', background: 'transparent', border: '1px solid #E8003D', color: '#E8003D', cursor: 'pointer' }}><CircleStop className="size-2.5" style={{ marginRight: 2, verticalAlign: 'middle' }} />Stop Real</button>
            : <button onClick={() => onActivate(strategy, 'real')} disabled={realActivating} style={{ fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 6px', background: 'transparent', border: '1px solid rgba(232,0,61,0.3)', color: '#E8003D', cursor: realActivating ? 'not-allowed' : 'pointer' }}>{realActivating ? <RefreshCw className="size-2.5 animate-spin" style={{ marginRight: 2, verticalAlign: 'middle' }} /> : <DollarSign className="size-2.5" style={{ marginRight: 2, verticalAlign: 'middle' }} />}Real</button>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button onClick={onEdit} style={{ background: 'none', border: '1px solid #DDDDDD', padding: '2px 5px', cursor: 'pointer' }}><Pencil className="size-2.5" style={{ color: '#999' }} /></button>
            <button onClick={onDelete} style={{ background: 'none', border: '1px solid #DDDDDD', padding: '2px 5px', cursor: 'pointer' }}><Trash2 className="size-2.5" style={{ color: '#E8003D' }} /></button>
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {(demoActive || realActive) && (
          <div style={{ background: '#F5F5F5', border: '1px solid #E8E8E8', padding: 6, marginBottom: 8 }}>
            {demoActive && <div className="flex flex-col gap-0.5 text-xs"><span className="flex items-center gap-1.5 flex-wrap"><FlaskConical className="size-3 text-blue-500 shrink-0" /><span className="font-medium">Demo</span>{demoActive.inPosition && <Badge className="bg-amber-500 text-white text-[9px] px-1 py-0 shrink-0">W POZYCJI</Badge>}{demoActive.errorMessage && <span className="text-red-500 text-[10px]">{demoActive.errorMessage}</span>}</span><span className="text-muted-foreground pl-5">PnL: <span className={demoActive.totalPnl >= 0 ? 'text-emerald-500 font-medium' : 'text-red-500 font-medium'}>${demoActive.totalPnl.toFixed(2)}</span>{' | '}Trades: {demoActive.totalTrades}{demoActive.lastPrice ? ` | $${demoActive.lastPrice.toFixed(2)}` : ''}</span></div>}
            {realActive && <div className="flex flex-col gap-0.5 text-xs"><span className="flex items-center gap-1.5 flex-wrap"><DollarSign className="size-3 text-red-500 shrink-0" /><span className="font-medium">Real</span>{realActive.inPosition && <Badge className="bg-amber-500 text-white text-[9px] px-1 py-0 shrink-0">W POZYCJI</Badge>}{realActive.errorMessage && <span className="text-red-500 text-[10px]">{realActive.errorMessage}</span>}</span><span className="text-muted-foreground pl-5">PnL: <span className={realActive.totalPnl >= 0 ? 'text-emerald-500 font-medium' : 'text-red-500 font-medium'}>${realActive.totalPnl.toFixed(2)}</span>{' | '}Trades: {realActive.totalTrades}{realActive.lastPrice ? ` | $${realActive.lastPrice.toFixed(2)}` : ''}</span></div>}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 4, fontSize: 8, letterSpacing: '0.04em', marginBottom: 8 }}>
          {(strategy.strategy_type === 'dip_buying' || !strategy.strategy_type) && <><div><span className="text-muted-foreground">Dip 24h:</span> <span className="font-medium">{strategy.dip_threshold_24h}%</span></div><div><span className="text-muted-foreground">Dip 1h:</span> <span className="font-medium">{strategy.dip_threshold_1h}%</span></div></>}
          {strategy.strategy_type === 'momentum' && <><div><span className="text-muted-foreground">MA okres:</span> <span className="font-medium">{strategy.ma_period}</span></div><div><span className="text-muted-foreground">Wolumen:</span> <span className="font-medium">{strategy.volume_threshold}x</span></div></>}
          {strategy.strategy_type === 'mean_reversion' && <><div><span className="text-muted-foreground">MA okres:</span> <span className="font-medium">{strategy.ma_period}</span></div><div><span className="text-muted-foreground">Odchylenie:</span> <span className="font-medium">{strategy.deviation_threshold}σ</span></div></>}
          {strategy.strategy_type === 'breakout' && <><div><span className="text-muted-foreground">Lookback:</span> <span className="font-medium">{strategy.lookback_periods}</span></div><div><span className="text-muted-foreground">Potwierdzenie:</span> <span className="font-medium">{strategy.breakout_confirm_bars} bar</span></div></>}
          {strategy.strategy_type === 'grid' && <><div><span className="text-muted-foreground">Spacing:</span> <span className="font-medium">{strategy.grid_spacing_pct}%</span></div><div><span className="text-muted-foreground">Levels:</span> <span className="font-medium">{strategy.grid_levels}</span></div></>}
          {strategy.strategy_type === 'hurst_hcoo_lb' && <><div><span className="text-muted-foreground">Hurst ok:</span> <span className="font-medium">{strategy.hurst_period}</span></div><div><span className="text-muted-foreground">H prog:</span> <span className="font-medium">{strategy.hurst_threshold}</span></div><div><span className="text-muted-foreground">BB:</span> <span className="font-medium">{strategy.bb_period}/{strategy.bb_std}σ</span></div></>}
          <div><span className="text-muted-foreground">TP:</span> <span className="font-medium text-emerald-600">+{strategy.take_profit_pct}%</span></div>
          <div><span className="text-muted-foreground">SL:</span> <span className="font-medium text-red-600">-{strategy.stop_loss_pct}%</span></div>
          <div><span className="text-muted-foreground">Hold:</span> <span className="font-medium">{strategy.max_holding_hours}h</span></div>
          <div><span className="text-muted-foreground">Fee:</span> <span className="font-medium">{strategy.fee_pct}%</span></div>
          <div><span className="text-muted-foreground">Capital:</span> <span className="font-medium">${strategy.initial_capital}</span></div>
          <div><span className="text-muted-foreground">Dni:</span> <span className="font-medium">{strategy.days}</span></div>
          <div><span className="text-muted-foreground">Compound:</span> <span className="font-medium">{strategy.compound ? 'Tak' : 'Nie'}</span></div>
          <div><span className="text-muted-foreground">Trailing SL:</span> <span className="font-medium">{strategy.trailing_stop_pct > 0 ? `${strategy.trailing_stop_pct}%` : 'Disabled'}</span></div>
          <div><span className="text-muted-foreground">Slippage:</span> <span className="font-medium text-amber-500">{(strategy.slippage_pct ?? 0.05).toFixed(2)}%</span></div>
          <div><span className="text-muted-foreground">Wick sim:</span> <span className={`font-medium ${strategy.simulate_wicks !== false ? 'text-emerald-500' : 'text-red-500'}`}>{strategy.simulate_wicks !== false ? 'TAK' : 'NIE'}</span></div>
        </div>
        {result?.loading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#999', paddingTop: 6, borderTop: '1px solid #DDDDDD', letterSpacing: '0.04em' }}><RefreshCw className="size-3 animate-spin" /><span>Obliczanie backtestu…</span></div>}
        {result?.error && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 8, color: '#E8003D', paddingTop: 6, borderTop: '1px solid #DDDDDD' }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle className="size-3 shrink-0" /><span>{result.error}</span>{result.retryCount && result.retryCount > 0 && <span style={{ color: '#999' }}>({result.retryCount}x retry)</span>}</div><button onClick={() => onRetry(strategy.id)} style={{ fontFamily: 'inherit', fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'transparent', border: '1px solid #3B82F6', color: '#3B82F6', padding: '2px 5px', cursor: 'pointer' }}>Retry</button></div>}
        {result?.data && (
          <div className="grid grid-cols-2 gap-1" style={{ paddingTop: 6, borderTop: '1px solid #DDDDDD' }}>
            {[{ label: 'RETURN', value: `${result.data.results.total_return_pct >= 0 ? '+' : ''}${result.data.results.total_return_pct.toFixed(2)}%`, color: result.data.results.total_return_pct >= 0 ? '#1AA167' : '#E8003D' }, { label: 'WIN RATE', value: `${result.data.results.win_rate.toFixed(1)}%`, color: result.data.results.win_rate >= 50 ? '#1AA167' : '#D97706' }, { label: 'MAX DD', value: `-${result.data.results.max_drawdown_pct.toFixed(2)}%`, color: '#E8003D' }, { label: 'SHARPE', value: result.data.results.sharpe_ratio.toFixed(2), color: result.data.results.sharpe_ratio >= 1 ? '#1AA167' : '#D97706' }, { label: "TRADES", value: String(result.data.results.total_trades), color: '#111' }, { label: 'CAPITAL', value: `$${result.data.results.final_capital.toFixed(0)}`, color: result.data.results.final_capital > (result.data.parameters?.initial_capital as number ?? 0) ? '#1AA167' : '#E8003D' }].map((stat, i) => (
              <div key={i} style={{ background: '#F5F5F5', border: '1px solid #E8E8E8', padding: '4px 6px', textAlign: 'center' }}><div style={{ fontSize: 6, letterSpacing: '0.1em', color: '#999', textTransform: 'uppercase' }}>{stat.label}</div><div style={{ fontSize: 14, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</div></div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Need ChevronDown/Up for the optimize section
import { ChevronDown, ChevronUp, Thermometer } from 'lucide-react'
