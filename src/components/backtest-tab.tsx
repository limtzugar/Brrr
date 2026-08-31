'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Cell, } from 'recharts'
import { AlertTriangle, Brain, Clock, Play, RefreshCw, Target, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react'
import { type BacktestResponse, COIN_OPTIONS, STRATEGY_TYPE_OPTIONS, formatPrice, exitReasonLabel, exitReasonColor, type CoinData, } from '@/lib/crypto-shared'
import AssetChartModal, { type AssetChartInfo, cryptoTickerToTvSymbol } from '@/components/asset-chart-modal'

function MetricCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
  return (<Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div><div className={`text-2xl font-bold ${color}`}>{value}</div><div className="text-xs text-muted-foreground mt-0.5">{sub}</div></CardContent></Card>)
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (<div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className={`font-medium ${color}`}>{value}</span></div>)
}

function DrawdownHeatMap() {
  const [coins, setCoins] = useState<CoinData[]>([])
  const [heatMapTooltip, setHeatMapTooltip] = useState<{ coin: string; day: number; drawdown: number } | null>(null)

  useEffect(() => {
    const fetchCoins = async () => {
      try { const res = await fetch('/api/coins'); if (res.ok) { const data = await res.json(); setCoins(data.coins || []) } } catch {}
    }
    fetchCoins()
  }, [])

  const heatMapCoins = coins.slice(0, 15)
  const heatMapDays = 7
  const heatMapData = useMemo(() => {
    const data: { coinId: string; symbol: string; drawdowns: number[] }[] = []
    for (const coin of heatMapCoins) {
      const spark = coin.sparkline_7d; if (!spark || spark.length < 24) continue
      const drawdowns: number[] = []
      for (let day = 0; day < heatMapDays; day++) {
        const dayEnd = spark.length - 1 - day * 24; const dayStart = Math.max(0, dayEnd - 23)
        if (dayStart < 0 || dayEnd <= 0) { drawdowns.push(0); continue }
        let maxPrice = -Infinity; let maxDrawdown = 0
        for (let i = dayStart; i <= dayEnd; i++) { if (spark[i] > maxPrice) maxPrice = spark[i]; const dd = ((spark[i] - maxPrice) / maxPrice) * 100; if (dd < maxDrawdown) maxDrawdown = dd }
        drawdowns.push(maxDrawdown)
      }
      data.push({ coinId: coin.id, symbol: coin.symbol, drawdowns })
    }
    return data
  }, [heatMapCoins, heatMapDays])

  function drawdownCellColor(dd: number): string {
    if (dd === 0) return 'bg-white dark:bg-muted/20'
    if (dd > -2) return 'bg-red-100 dark:bg-red-900/20'
    if (dd > -5) return 'bg-red-300 dark:bg-red-700/40'
    if (dd > -10) return 'bg-red-500 dark:bg-red-600/60'
    return 'bg-red-700 dark:bg-red-500/80'
  }

  if (heatMapData.length === 0) return <div className="text-xs text-muted-foreground text-center py-4">Ładowanie danych heatmapy...</div>

  return (<>
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left pb-2 pr-3 font-medium text-muted-foreground">Moneta</th>{Array.from({ length: heatMapDays }, (_, i) => (<th key={i} className="text-center pb-2 px-1 font-medium text-muted-foreground">{i === 0 ? 'Dziś' : `-${i}d`}</th>))}</tr></thead>
      <tbody>{heatMapData.map(row => (<tr key={row.coinId}><td className="py-1 pr-3 font-medium">{row.symbol.toUpperCase()}</td>{row.drawdowns.map((dd, dayIdx) => (<td key={dayIdx} className="py-1 px-1"><button className={`w-full h-8 rounded ${drawdownCellColor(dd)} flex items-center justify-center text-[10px] font-medium hover:ring-2 ring-foreground/30 transition-all cursor-pointer`} onClick={() => setHeatMapTooltip({ coin: row.symbol.toUpperCase(), day: dayIdx, drawdown: dd })} title={`${row.symbol.toUpperCase()}: ${dd.toFixed(2)}%`}>{dd < -0.5 ? `${dd.toFixed(1)}%` : ''}</button></td>))}</tr>))}</tbody></table></div>
    {heatMapTooltip && <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded px-3 py-1.5"><span className="font-medium">{heatMapTooltip.coin}</span> — dzień {heatMapTooltip.day === 0 ? 'dziś' : `-${heatMapTooltip.day}d`}: <span className={heatMapTooltip.drawdown < -5 ? 'text-red-500 font-medium' : 'text-amber-500'}>{heatMapTooltip.drawdown.toFixed(2)}%</span></div>}
    <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground"><span>Skala:</span><div className="flex items-center gap-1"><div className="w-4 h-3 rounded bg-white dark:bg-muted/20 border" /><span>0%</span></div><div className="flex items-center gap-1"><div className="w-4 h-3 rounded bg-red-100 dark:bg-red-900/20" /><span>-2%</span></div><div className="flex items-center gap-1"><div className="w-4 h-3 rounded bg-red-300 dark:bg-red-700/40" /><span>-5%</span></div><div className="flex items-center gap-1"><div className="w-4 h-3 rounded bg-red-500 dark:bg-red-600/60" /><span>-10%</span></div><div className="flex items-center gap-1"><div className="w-4 h-3 rounded bg-red-700 dark:bg-red-500/80" /><span>-10%+</span></div></div>
  </>)
}

import { useMemo } from 'react'

export default function BacktestTab() {
  const [coinId, setCoinId] = useState('dogecoin')
  const [days, setDays] = useState(90)
  const [strategyType, setStrategyType] = useState('dip_buying')
  const [dipThreshold1h, setDipThreshold1h] = useState(-2)
  const [dipThreshold24h, setDipThreshold24h] = useState(-5)
  const [takeProfitPct, setTakeProfitPct] = useState(3)
  const [stopLossPct, setStopLossPct] = useState(5)
  const [initialCapital, setInitialCapital] = useState(1000)
  const [compound, setCompound] = useState(true)
  const [maxHoldingHours, setMaxHoldingHours] = useState(48)
  const [feePct, setFeePct] = useState(0.1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maPeriod, setMaPeriod] = useState(20)
  const [volumeThreshold, setVolumeThreshold] = useState(1.5)
  const [deviationThreshold, setDeviationThreshold] = useState(2)
  const [lookbackPeriods, setLookbackPeriods] = useState(20)
  const [breakoutConfirmBars, setBreakoutConfirmBars] = useState(2)
  const [gridSpacingPct, setGridSpacingPct] = useState(2)
  const [gridLevels, setGridLevels] = useState(5)
  const [hurstPeriod, setHurstPeriod] = useState(100)
  const [hurstThreshold, setHurstThreshold] = useState(0.5)
  const [bbPeriod, setBbPeriod] = useState(20)
  const [bbStd, setBbStd] = useState(2)

  const runBacktestFn = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin_id: coinId, days, strategy_type: strategyType, dip_threshold_1h: dipThreshold1h, dip_threshold_24h: dipThreshold24h,
          take_profit_pct: takeProfitPct, stop_loss_pct: stopLossPct, initial_capital: initialCapital, compound, max_holding_hours: maxHoldingHours, fee_pct: feePct,
          ma_period: maPeriod, volume_threshold: volumeThreshold, deviation_threshold: deviationThreshold, lookback_periods: lookbackPeriods,
          breakout_confirm_bars: breakoutConfirmBars, grid_spacing_pct: gridSpacingPct, grid_levels: gridLevels, hurst_period: hurstPeriod, hurst_threshold: hurstThreshold, bb_period: bbPeriod, bb_std: bbStd,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Backtest nie powiódł się') }
      setResult(await res.json())
    } catch (err) { setError(err instanceof Error ? err.message : 'Nieznany błąd') }
    finally { setRunning(false) }
  }

  const presetStrategies = [
    { name: 'Konserwatywna', dip1h: -3, dip24h: -10, tp: 2, sl: 3, days: 90 },
    { name: 'Zbalansowana', dip1h: -2, dip24h: -7, tp: 3, sl: 5, days: 90 },
    { name: 'Agresywna', dip1h: -1, dip24h: -5, tp: 5, sl: 8, days: 90 },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Brain className="size-4" />Konfiguracja Backtestu</CardTitle><CardDescription>Ustaw parametry strategii — wybierz typ i dostosuj</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><Label className="text-xs text-muted-foreground">Typ strategii</Label><Select value={strategyType} onValueChange={v => setStrategyType(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STRATEGY_TYPE_OPTIONS.map(t => { const Icon = t.icon; return <SelectItem key={t.id} value={t.id}><div className="flex items-center gap-2"><Icon className="size-3.5" /><span>{t.label}</span></div></SelectItem> })}</SelectContent></Select></div>
              {strategyType === 'dip_buying' && (<div><Label className="text-xs text-muted-foreground">Gotowe strategie</Label><div className="flex gap-2 mt-1">{presetStrategies.map(p => (<Button key={p.name} variant="outline" size="sm" className="text-xs" onClick={() => { setDipThreshold1h(p.dip1h); setDipThreshold24h(p.dip24h); setTakeProfitPct(p.tp); setStopLossPct(p.sl); setDays(p.days) }}>{p.name}</Button>))}</div></div>)}
              <div><Label className="text-xs">Moneta</Label><Select value={coinId} onValueChange={setCoinId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COIN_OPTIONS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Okres (dni)</Label><Input type="number" value={days} onChange={e => setDays(Number(e.target.value))} min={30} max={730} /></div><div><Label className="text-xs">Kapitał początkowy ($)</Label><Input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} min={100} /></div></div>
              {(strategyType === 'dip_buying') && <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Dip threshold 1h (%)</Label><Input type="number" value={dipThreshold1h} onChange={e => setDipThreshold1h(Number(e.target.value))} /></div><div><Label className="text-xs">Dip threshold 24h (%)</Label><Input type="number" value={dipThreshold24h} onChange={e => setDipThreshold24h(Number(e.target.value))} /></div></div>}
              {(strategyType === 'momentum') && <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Okres MA</Label><Input type="number" value={maPeriod} onChange={e => setMaPeriod(Number(e.target.value))} min={2} /></div><div><Label className="text-xs">Próg wolumenu (x)</Label><Input type="number" value={volumeThreshold} onChange={e => setVolumeThreshold(Number(e.target.value))} step={0.1} min={0.1} /></div></div>}
              {(strategyType === 'mean_reversion') && <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Okres MA</Label><Input type="number" value={maPeriod} onChange={e => setMaPeriod(Number(e.target.value))} min={2} /></div><div><Label className="text-xs">Próg odchylenia (σ)</Label><Input type="number" value={deviationThreshold} onChange={e => setDeviationThreshold(Number(e.target.value))} step={0.5} min={0.5} /></div></div>}
              {(strategyType === 'breakout') && <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Okresy lookback</Label><Input type="number" value={lookbackPeriods} onChange={e => setLookbackPeriods(Number(e.target.value))} min={2} /></div><div><Label className="text-xs">Paski potwierdzenia</Label><Input type="number" value={breakoutConfirmBars} onChange={e => setBreakoutConfirmBars(Number(e.target.value))} min={1} /></div></div>}
              {(strategyType === 'grid') && <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Odstęp siatki (%)</Label><Input type="number" value={gridSpacingPct} onChange={e => setGridSpacingPct(Number(e.target.value))} step={0.5} min={0.5} /></div><div><Label className="text-xs">Poziomy siatki</Label><Input type="number" value={gridLevels} onChange={e => setGridLevels(Number(e.target.value))} min={2} /></div></div>}
              {(strategyType === 'hurst_hcoo_lb') && <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Okres Hurst</Label><Input type="number" value={hurstPeriod} onChange={e => setHurstPeriod(Number(e.target.value))} className="h-8" /></div><div><Label className="text-xs">H prog (0.1-0.9)</Label><Input type="number" step={0.05} value={hurstThreshold} onChange={e => setHurstThreshold(Number(e.target.value))} className="h-8" /></div><div><Label className="text-xs">BB okres</Label><Input type="number" value={bbPeriod} onChange={e => setBbPeriod(Number(e.target.value))} className="h-8" /></div><div><Label className="text-xs">BB σ</Label><Input type="number" step={0.5} value={bbStd} onChange={e => setBbStd(Number(e.target.value))} className="h-8" /></div></div>}
              <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Take Profit (%)</Label><Input type="number" value={takeProfitPct} onChange={e => setTakeProfitPct(Number(e.target.value))} min={0.5} step={0.5} /></div><div><Label className="text-xs">Stop Loss (%)</Label><Input type="number" value={stopLossPct} onChange={e => setStopLossPct(Number(e.target.value))} min={0.5} step={0.5} /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs">Max hold (godz.)</Label><Input type="number" value={maxHoldingHours} onChange={e => setMaxHoldingHours(Number(e.target.value))} min={1} /></div><div><Label className="text-xs">Opłata trans. (%)</Label><Input type="number" value={feePct} onChange={e => setFeePct(Number(e.target.value))} min={0} max={1} step={0.01} /></div></div>
              <div className="flex items-center gap-2"><Switch checked={compound} onCheckedChange={setCompound} /><Label className="text-xs">Compound (reinwestycja zysków)</Label></div>
              {days <= 90 && <div className="flex items-center gap-2 text-xs text-blue-500 bg-blue-500/10 rounded-md px-3 py-2"><Zap className="size-3.5" /><span>Dane godzinowe (hourly) — bardziej precyzyjny backtest</span></div>}
              {days > 90 && <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-md px-3 py-2"><AlertTriangle className="size-3.5" /><span>Dane dzienne — backtest mniej precyzyjny (brak danych godzinowych dla &gt;90 dni)</span></div>}
              <Button className="w-full" onClick={runBacktestFn} disabled={running}>{running ? <><RefreshCw className="size-4 mr-2 animate-spin" />Obliczam...</> : <><Play className="size-4 mr-2" />Uruchom Backtest</>}</Button>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
          {error && <Card className="border-red-500/50 bg-red-500/5"><CardContent className="text-red-500 text-sm">{error}</CardContent></Card>}
          {!result && !error && !running && <Card><CardContent className="py-16 text-center text-muted-foreground"><Brain className="size-12 mx-auto mb-3 opacity-30" /><p className="text-lg font-medium">Skonfiguruj i uruchom backtest</p><p className="text-sm mt-1">Wybierz parametry strategii i kliknij &quot;Uruchom Backtest&quot;</p></CardContent></Card>}
          {result && (<>
            <div className="flex items-center gap-2"><Badge variant={result.results.data_granularity === 'hourly' ? 'default' : 'outline'} className="gap-1">{result.results.data_granularity === 'hourly' ? <><Zap className="size-3" /> Dane godzinowe</> : <><Clock className="size-3" /> Dane dzienne</>}</Badge>{result.results.data_granularity === 'daily' && <span className="text-xs text-amber-500">Wyniki mogą być mniej precyzyjne</span>}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Zwrot całkowity (net)" value={`${result.results.total_return_pct >= 0 ? '+' : ''}${result.results.total_return_pct.toFixed(2)}%`} sub={`Kapitał końcowy: $${result.results.final_capital.toFixed(2)}`} color={result.results.total_return_pct >= 0 ? 'text-emerald-500' : 'text-red-500'} icon={<TrendingUp className="size-4" />} />
              <MetricCard label="Win Rate" value={`${result.results.win_rate.toFixed(1)}%`} sub={`${result.results.winning_trades}W / ${result.results.losing_trades}L / ${result.results.breakeven_trades}BE z ${result.results.total_trades} trade'ów`} color={result.results.win_rate >= 50 ? 'text-emerald-500' : 'text-red-500'} icon={<Target className="size-4" />} />
              <MetricCard label="Max Drawdown" value={`-${result.results.max_drawdown_pct.toFixed(2)}%`} sub="Maksymalny spadek od szczytu" color={result.results.max_drawdown_pct > 20 ? 'text-red-500' : result.results.max_drawdown_pct > 10 ? 'text-amber-500' : 'text-emerald-500'} icon={<TrendingDown className="size-4" />} />
              <MetricCard label="Profit Factor" value={result.results.profit_factor >= 999 ? '999+' : result.results.profit_factor.toFixed(2)} sub={`Sharpe: ${result.results.sharpe_ratio.toFixed(2)}`} color={result.results.profit_factor >= 1.5 ? 'text-emerald-500' : result.results.profit_factor >= 1 ? 'text-amber-500' : 'text-red-500'} icon={<Trophy className="size-4" />} />
            </div>
            <Card><CardHeader><CardTitle className="text-base">Krzywa kapitału</CardTitle><CardDescription>{compound ? 'Z reinwestycją zysków (compound)' : 'Bez reinwestycji'} — {COIN_OPTIONS.find(c => c.id === coinId)?.label || coinId}, {days} dni ({result.results.data_granularity === 'hourly' ? 'dane godzinowe' : 'dane dzienne'})</CardDescription></CardHeader>
              <CardContent><ChartContainer config={{ capital: { label: 'Kapitał', color: result.results.total_return_pct >= 0 ? '#10b981' : '#ef4444' } }} className="h-[300px] w-full"><AreaChart data={result.equity_curve}><defs><linearGradient id="capitalGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={result.results.total_return_pct >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} /><stop offset="95%" stopColor={result.results.total_return_pct >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" opacity={0.1} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => '$' + v.toLocaleString()} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="capital" stroke={result.results.total_return_pct >= 0 ? '#10b981' : '#ef4444'} fill="url(#capitalGradient)" strokeWidth={2} /></AreaChart></ChartContainer></CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle className="text-base">Szczegółowe statystyki</CardTitle></CardHeader>
                <CardContent><div className="space-y-3 text-sm">
                  <StatRow label="Śr. net profit (wygrana)" value={result.results.avg_profit_pct > 0 ? `+${result.results.avg_profit_pct.toFixed(2)}%` : '0%'} color="text-emerald-500" />
                  <StatRow label="Śr. net strata (przegrana)" value={`${result.results.avg_loss_pct.toFixed(2)}%`} color="text-red-500" />
                  <StatRow label="Śr. net profit/trade" value={`${result.results.avg_net_profit_pct >= 0 ? '+' : ''}${result.results.avg_net_profit_pct.toFixed(2)}%`} color={result.results.avg_net_profit_pct >= 0 ? 'text-emerald-500' : 'text-red-500'} />
                  <StatRow label="Najlepszy trade" value={`+${result.results.best_trade_pct.toFixed(2)}%`} color="text-emerald-500" />
                  <StatRow label="Najgorszy trade" value={`${result.results.worst_trade_pct.toFixed(2)}%`} color="text-red-500" />
                  <StatRow label="Śr. czas trzymania" value={`${result.results.avg_holding_hours.toFixed(1)}h`} color="" />
                  <StatRow label="Seria wygranych" value={`${result.results.consecutive_wins} z rzędu`} color="text-emerald-500" />
                  <StatRow label="Seria przegranych" value={`${result.results.consecutive_losses} z rzędu`} color="text-red-500" />
                  <StatRow label="Sharpe Ratio" value={result.results.sharpe_ratio.toFixed(2)} color={result.results.sharpe_ratio >= 1 ? 'text-emerald-500' : 'text-amber-500'} />
                  <StatRow label="Profit Factor" value={result.results.profit_factor >= 999 ? '999+' : result.results.profit_factor.toFixed(2)} color={result.results.profit_factor >= 1.5 ? 'text-emerald-500' : result.results.profit_factor >= 1 ? 'text-amber-500' : 'text-red-500'} />
                  <StatRow label="Łączne opłaty" value={`$${result.results.total_fees.toFixed(2)}`} color="text-amber-500" />
                  <StatRow label="Łączny slippage" value={`$${(result.results.total_slippage ?? 0).toFixed(2)}`} color="text-amber-500" />
                  <StatRow label="Slippage / trade" value={`${(result.results.slippage_pct ?? 0.05).toFixed(2)}%`} color="text-amber-500" />
                  <StatRow label="Wick simulation" value={result.results.wick_simulation ? 'Włączona' : 'Wyłączona'} color={result.results.wick_simulation ? 'text-emerald-500' : 'text-muted-foreground'} />
                </div></CardContent>
              </Card>
              <Card className="border-amber-500/30 bg-amber-500/5"><CardHeader className="pb-2"><div className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-500" /><CardTitle className="text-sm">Model wykonania</CardTitle></div></CardHeader>
                <CardContent className="text-xs space-y-2"><div className="flex items-center gap-2"><Badge variant={result.results.data_granularity === 'hourly' ? 'default' : 'outline'} className="gap-1 text-[10px]">{result.results.data_granularity === 'hourly' ? 'Godzinowe' : 'Dzienne'}</Badge><span className="text-muted-foreground">{result.results.data_granularity === 'hourly' ? 'Kupno/sprzedaż na zamknięciu świecy 1H' : 'Kupno/sprzedaż na zamknięciu świecy 1D'}</span></div>
                  {result.results.wick_simulation && <p className="text-amber-600">Wick simulation aktywna — SL/TP sprawdzane również wewnątrz świecy (szacowany low/high na podstawie ATR). Wyniki są bardziej realistyczne niż bez wick sim, ale nadal mogą się różnić od rzeczywistego tradingu.</p>}
                  {!result.results.wick_simulation && <p className="text-red-500">Wick simulation wyłączona — SL/TP sprawdzane TYLKO na zamknięciu świecy. Może pomijać intra-candle stop-lossy, dając nierealistycznie optymistyczne wyniki.</p>}
                  <p className="text-muted-foreground">Slippage: {(result.results.slippage_pct ?? 0.05).toFixed(2)}% — realistyczne odchylenie ceny wykonania market order. Łączny koszt slippage: ${(result.results.total_slippage ?? 0).toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card><CardHeader><CardTitle className="text-base">Rozkład powodów wyjścia</CardTitle></CardHeader>
                <CardContent><ChartContainer config={{ take_profit: { label: 'Take Profit', color: '#10b981' }, stop_loss: { label: 'Stop Loss', color: '#ef4444' }, time_stop: { label: 'Time Stop', color: '#f59e0b' } }} className="h-[220px] w-full"><PieChart><Pie data={[{ name: 'take_profit', value: result.trades.filter(t => t.exit_reason === 'take_profit').length, fill: 'var(--color-take_profit)' }, { name: 'stop_loss', value: result.trades.filter(t => t.exit_reason === 'stop_loss').length, fill: 'var(--color-stop_loss)' }, { name: 'time_stop', value: result.trades.filter(t => t.exit_reason === 'time_stop').length, fill: 'var(--color-time_stop)' }].filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${exitReasonLabel(name)}: ${value}`}>{result.trades.length > 0 && [{ name: 'take_profit', value: result.trades.filter(t => t.exit_reason === 'take_profit').length }, { name: 'stop_loss', value: result.trades.filter(t => t.exit_reason === 'stop_loss').length }, { name: 'time_stop', value: result.trades.filter(t => t.exit_reason === 'time_stop').length }].filter(d => d.value > 0).map((entry, index) => <Cell key={`cell-${index}`} fill={entry.name === 'take_profit' ? '#10b981' : entry.name === 'stop_loss' ? '#ef4444' : '#f59e0b'} />)}</Pie><ChartTooltip content={<ChartTooltipContent />} /></PieChart></ChartContainer></CardContent>
              </Card>
            </div>
            {result.trades.length > 0 && (<Card><CardHeader className="pb-2"><CardTitle className="text-base">Historia trade'ów</CardTitle><CardDescription>{result.trades.length} trade'ów w okresie {days} dni | Łączne opłaty: ${result.results.total_fees.toFixed(2)}</CardDescription></CardHeader>
              <CardContent><ScrollArea className="h-[200px]"><div className="space-y-1"><div className="grid grid-cols-7 gap-2 text-xs font-medium text-muted-foreground px-2 py-1"><span>Wejście</span><span>Cena wej.</span><span>Wyjście</span><span>Cena wyj.</span><span>Gross</span><span>Net</span><span>Powód</span></div>{result.trades.map((trade, i) => (<div key={i} className="grid grid-cols-7 gap-2 text-xs px-2 py-2 rounded hover:bg-muted/50 items-center"><span className="text-muted-foreground">{new Date(trade.entry_date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}</span><span>${trade.entry_price.toFixed(4)}</span><span className="text-muted-foreground">{new Date(trade.exit_date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}</span><span>${trade.exit_price.toFixed(4)}</span><span className={trade.profit_pct >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}>{trade.profit_pct >= 0 ? '+' : ''}{trade.profit_pct.toFixed(2)}%</span><span className={trade.net_profit_pct >= 0 ? 'text-emerald-500 font-medium' : 'text-red-500 font-medium'}>{trade.net_profit_pct >= 0 ? '+' : ''}{trade.net_profit_pct.toFixed(2)}%</span><span className={exitReasonColor(trade.exit_reason)}>{exitReasonLabel(trade.exit_reason)}</span></div>))}</div></ScrollArea></CardContent>
            </Card>)}
          </>)}
        </div>
      </div>
      <Card><CardHeader className="pb-2"><div className="flex items-center gap-2"><CalendarDays className="size-4 text-red-500" /><CardTitle className="text-sm">Mapa spadków — Drawdown Heat Map</CardTitle></div><CardDescription className="text-xs">Maksymalny drawdown z wysoka dla top 15 monet w ostatnich 7 dniach</CardDescription></CardHeader><CardContent><DrawdownHeatMap /></CardContent></Card>
    </div>
  )
}

import { CalendarDays } from 'lucide-react'
