'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Bell,
  Brain,
  Calculator,
  Clock,
  Eye,
  Flame,
  Gauge,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  SlidersHorizontal,
  Thermometer,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import CryptoChartDialog from '@/components/crypto-chart-dialog'
import {
  type CoinData,
  type DipSignal,
  type FearGreedResponse,
  type CoinThresholds,
  type CryptoChartInfo,
  DEFAULT_COIN_THRESHOLDS,
  loadThresholds,
  saveThresholds,
  getCoinThreshold,
  formatPrice,
  formatPct,
  pctColor,
  formatVolume,
  signalBadge,
  calculateConfidenceScore,
  confidenceColor,
  confidenceTextColor,
  fearGreedBg,
  fearGreedLabel,
  MiniChart,
} from '@/lib/crypto-shared'
import { useTE } from '@/lib/te-theme'

export default function CryptoMonitorTab() {
  const te = useTE()
  const [signals, setSignals] = useState<DipSignal[]>([])
  const [coins, setCoins] = useState<CoinData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [signalFilter, setSignalFilter] = useState<'all' | 'buy_signal' | 'alert' | 'watch'>('all')
  const [sortBy, setSortBy] = useState<'rank' | 'change_1h' | 'change_24h'>('rank')
  const [chartCrypto, setChartCrypto] = useState<CryptoChartInfo | null>(null)
  const [chartOpen, setChartOpen] = useState(false)

  // Fear & Greed state
  const [fearGreedData, setFearGreedData] = useState<FearGreedResponse | null>(null)
  const [fearGreedLoading, setFearGreedLoading] = useState(false)

  // Replay Mode removed

  // Thresholds state
  const [thresholdsOpen, setThresholdsOpen] = useState(false)
  const [coinThresholds, setCoinThresholds] = useState<Record<string, CoinThresholds>>({})

  const openChart = useCallback((coinId: string, symbol: string, name: string, image: string, currentPrice: number, priceChange24h: number | null) => {
    setChartCrypto({ coinId, symbol, name, image, currentPrice, priceChange24h })
    setChartOpen(true)
  }, [])

  const closeChart = useCallback(() => {
    setChartOpen(false)
    setTimeout(() => setChartCrypto(null), 300)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [signalsRes, coinsRes] = await Promise.all([
        fetch('/api/signals'),
        fetch('/api/coins'),
      ])
      if (!signalsRes.ok || !coinsRes.ok) throw new Error('Błąd pobierania danych')
      const signalsData = await signalsRes.json()
      const coinsData = await coinsRes.json()
      const signalsWithConf = (signalsData.signals || []).map((s: DipSignal) => ({
        ...s,
        confidence_score: s.confidence_score || calculateConfidenceScore(s),
      }))
      setSignals(signalsWithConf)
      setCoins(coinsData.coins || [])
      setLastUpdated(signalsData.last_updated || coinsData.last_updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nieznany błąd')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchFearGreed = useCallback(async () => {
    setFearGreedLoading(true)
    try {
      const res = await fetch('/api/fear-greed')
      if (res.ok) {
        const data = await res.json()
        setFearGreedData(data)
      }
    } catch {}
    setFearGreedLoading(false)
  }, [])

  useEffect(() => { setCoinThresholds(loadThresholds()) }, [])
  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { fetchFearGreed() }, [fetchFearGreed])
  useEffect(() => {
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  const filteredSignals = signals
    .filter(s => signalFilter === 'all' || s.signal_type === signalFilter)
    .sort((a, b) => {
      if (sortBy === 'rank') return a.market_cap_rank - b.market_cap_rank
      if (sortBy === 'change_1h') return (a.price_change_1h || 0) - (b.price_change_1h || 0)
      return (a.price_change_24h || 0) - (b.price_change_24h || 0)
    })

  const topLosers = [...coins]
    .filter(c => c.price_change_percentage_24h !== null && c.price_change_percentage_24h < 0)
    .sort((a, b) => (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0))
    .slice(0, 10)

  const currentFG = fearGreedData?.data?.[0] ? Number(fearGreedData.data[0].value) : null

  const teCardStyle: React.CSSProperties = {
    background: te.bgCard,
    border: `1px solid ${te.border}`,
    borderRadius: '4px',
  }

  return (
    <div className="space-y-4">
      {/* Compact Summary Bar + Fear & Greed inline */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm">
          <LayoutDashboard className="size-3.5" style={{ color: te.blue }} />
          <span className="text-xs" style={{ color: te.textMuted }}>Monitorowane</span>
          <span className="font-bold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{coins.length}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5 text-sm">
          <Bell className="size-3.5" style={{ color: te.yellow }} />
          <span className="text-xs" style={{ color: te.textMuted }}>Sygnały</span>
          <span className="font-bold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{signals.length}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5 text-sm">
          <Zap className="size-3.5" style={{ color: te.red }} />
          <span className="text-xs" style={{ color: te.textMuted }}>Buy</span>
          <span className="font-bold" style={{ color: te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{signals.filter(s => s.signal_type === 'buy_signal').length}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5 text-sm">
          <Flame className="size-3.5" style={{ color: te.yellow }} />
          <span className="text-xs" style={{ color: te.textMuted }}>Alerts</span>
          <span className="font-bold" style={{ color: te.yellow, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{signals.filter(s => s.signal_type === 'alert').length}</span>
        </div>

        {currentFG !== null && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${fearGreedBg(currentFG)} text-white cursor-default`}>
                    <Gauge className="size-3" />
                    <span>{currentFG}</span>
                    <span className="hidden sm:inline">{fearGreedLabel(currentFG)}</span>
                    {currentFG < 25 && <Flame className="size-3" />}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <div>Fear & Greed Index: <strong>{currentFG}</strong> — {fearGreedLabel(currentFG)}</div>
                  {fearGreedData?.data?.[0]?.timestamp && (
                    <div style={{ color: te.textMuted }}>{new Date(Number(fearGreedData.data[0].timestamp) * 1000).toLocaleDateString('pl-PL')}</div>
                  )}
                  {currentFG < 25 && <div style={{ color: te.orange }}>🔥 Sentiment Boost aktywny</div>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
        {fearGreedLoading && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <RefreshCw className="size-3 animate-spin" style={{ color: te.textMuted }} />
          </>
        )}

        <Separator orientation="vertical" className="h-4" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex items-center gap-1 text-xs transition-colors" style={{ color: te.textMuted }}>
                <Shield className="size-3.5" />
                <span className="hidden sm:inline">Jak korzystać?</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs space-y-1">
              <div><strong>1.</strong> Dashboard pokazuje sygnały z top 100 MC — nie potrzebujesz konta</div>
              <div><strong>2.</strong> Kliknij ikonę monety — otworzy się wykres TradingView z RSI</div>
              <div><strong>3.</strong> ALERT / BUY SIGNAL — oceniasz sam i kupujesz ręcznie</div>
              <div><strong>4.</strong> Kupujesz na Bybit, Binance, OKX</div>
              <div className="flex flex-wrap gap-1 pt-1">
                <Badge variant="outline" className="text-[9px]">Bybit 0.1%</Badge>
                <Badge variant="outline" className="text-[9px]">Binance 0.1%</Badge>
                <Badge variant="outline" className="text-[9px]">Dane: CoinGecko</Badge>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={signalFilter} onValueChange={(v) => setSignalFilter(v as typeof signalFilter)}>
            <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Filtr sygnałów" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="buy_signal">Buy Signal</SelectItem>
              <SelectItem value="alert">Alert</SelectItem>
              <SelectItem value="watch">Watch</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Sortuj" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rank">Ranking MC</SelectItem>
              <SelectItem value="change_1h">Spadek 1h</SelectItem>
              <SelectItem value="change_24h">Spadek 24h</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-8" onClick={() => setThresholdsOpen(true)}>
            <SlidersHorizontal className="size-3.5" />Progi
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs" style={{ color: te.textMuted }}>
              <Clock className="size-3 inline mr-1" />{new Date(lastUpdated).toLocaleTimeString('pl-PL')}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`size-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />Odśwież
          </Button>
        </div>
      </div>

      {/* Replay Mode Controls removed */}

      {error && (
        <Card style={{ background: te.redBg, border: `1px solid ${te.red}50` }}>
          <CardContent className="text-sm" style={{ color: te.red }}>{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted, marginBottom: 12 }}>Sygnały Dip</h3>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} style={teCardStyle}><CardContent className="flex items-center gap-4"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-16" /></div></CardContent></Card>
              ))}
            </div>
          ) : filteredSignals.length === 0 ? (
            <Card style={teCardStyle}>
              <CardContent className="py-12 text-center" style={{ color: te.textMuted }}>
                <Eye className="size-8 mx-auto mb-2 opacity-50" />
                <p style={{ color: te.text }}>Brak aktywnych sygnałów dip</p>
                <p className="text-xs mt-1">Rynek jest spokojny — sprawdź później</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-2">
                {filteredSignals.map((signal) => (
                  <SignalCard
                    key={signal.coin_id}
                    signal={signal}
                    onOpenChart={openChart}
                    fearGreedValue={currentFG ?? undefined}
                    hasCustomThreshold={!!coinThresholds[signal.coin_id]}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div>
          <h3 style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted, marginBottom: 12 }}>Top 10 Spadków 24h</h3>
          <Card style={teCardStyle}>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[600px]">
                <div className="divide-y" style={{ borderColor: te.border }}>
                  {topLosers.map((coin) => (
                    <button
                      key={coin.id}
                      className="flex items-center gap-3 px-4 py-3 transition-colors w-full text-left group"
                      style={{ borderBottom: `1px solid ${te.border}` }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = te.bgCardHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => openChart(coin.id, coin.symbol, coin.name, coin.image, coin.current_price, coin.price_change_percentage_24h)}
                    >
                      <img src={coin.image} alt={coin.symbol} className="size-7 rounded-full" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate" style={{ color: te.text }}>{coin.symbol.toUpperCase()}</span>
                          <span className="text-xs" style={{ color: te.textMuted }}>#{coin.market_cap_rank}</span>
                        </div>
                        <div className="text-xs" style={{ color: te.textMuted, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(coin.current_price)}</div>
                      </div>
                      <MiniChart data={coin.sparkline_7d} isPositive={(coin.price_change_percentage_24h ?? 0) >= 0} width={60} height={24} />
                      <div className="text-right">
                        <div className="text-sm font-medium" style={{ color: (coin.price_change_percentage_24h ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPct(coin.price_change_percentage_24h)}</div>
                        <div className="text-xs" style={{ color: (coin.price_change_percentage_1h ?? 0) >= 0 ? te.green : te.red }}>1h: {formatPct(coin.price_change_percentage_1h)}</div>
                      </div>
                      <Maximize2 className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: te.textMuted }} />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-Coin Threshold Customizer Dialog */}
      <Dialog open={thresholdsOpen} onOpenChange={setThresholdsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5" />Progi alertów per-moneta</DialogTitle>
            <DialogDescription>Dostosuj progi RSI, spadku 24h i mnożnika wolumenu dla każdej monitorowanej monety.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="flex gap-2 mb-2">
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => {
                const newThresholds: Record<string, CoinThresholds> = {}
                coins.forEach(c => { newThresholds[c.id] = { ...DEFAULT_COIN_THRESHOLDS } })
                setCoinThresholds(newThresholds)
                saveThresholds(newThresholds)
              }}><Settings className="size-3" />Zastosuj domyślne dla wszystkich</Button>
            </div>
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {coins.slice(0, 50).map(coin => {
                  const thresholds = getCoinThreshold(coin.id, coinThresholds)
                  const isCustom = !!coinThresholds[coin.id]
                  return (
                    <div key={coin.id} className="flex items-center gap-3 p-2 rounded" style={isCustom ? { background: `${te.orange}0a`, border: `1px solid ${te.orange}33` } : { background: `${te.bgInput}55` }}>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <img src={coin.image} alt={coin.symbol} className="size-5 rounded-full" />
                        <span className="text-xs font-medium" style={{ color: te.text }}>{coin.symbol.toUpperCase()}</span>
                        {isCustom && <SlidersHorizontal className="size-3" style={{ color: te.orange }} />}
                      </div>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[9px]" style={{ color: te.textMuted }}>RSI próg</Label>
                          <Input type="number" value={thresholds.rsi_threshold} onChange={e => {
                            const newT = { ...coinThresholds, [coin.id]: { ...thresholds, rsi_threshold: Number(e.target.value) } }
                            setCoinThresholds(newT); saveThresholds(newT)
                          }} className="h-6 text-[10px]" step={5} />
                        </div>
                        <div>
                          <Label className="text-[9px]" style={{ color: te.textMuted }}>Spadek 24h (%)</Label>
                          <Input type="number" value={thresholds.drop_24h_threshold} onChange={e => {
                            const newT = { ...coinThresholds, [coin.id]: { ...thresholds, drop_24h_threshold: Number(e.target.value) } }
                            setCoinThresholds(newT); saveThresholds(newT)
                          }} className="h-6 text-[10px]" step={1} />
                        </div>
                        <div>
                          <Label className="text-[9px]" style={{ color: te.textMuted }}>Vol mnożnik</Label>
                          <Input type="number" value={thresholds.volume_multiplier_threshold} onChange={e => {
                            const newT = { ...coinThresholds, [coin.id]: { ...thresholds, volume_multiplier_threshold: Number(e.target.value) } }
                            setCoinThresholds(newT); saveThresholds(newT)
                          }} className="h-6 text-[10px]" step={0.5} />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px]" style={{ color: te.textMuted }} onClick={() => {
                        const newT = { ...coinThresholds }; delete newT[coin.id]
                        setCoinThresholds(newT); saveThresholds(newT)
                      }} disabled={!isCustom}><RotateCcw className="size-3" /></Button>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <CryptoChartDialog crypto={chartCrypto} open={chartOpen} onClose={closeChart} />
    </div>
  )
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ signal, onOpenChart, fearGreedValue, hasCustomThreshold }: {
  signal: DipSignal; onOpenChart: (coinId: string, symbol: string, name: string, image: string, currentPrice: number, priceChange24h: number | null) => void; fearGreedValue?: number; hasCustomThreshold?: boolean
}) {
  const te = useTE()
  const [expanded, setExpanded] = useState(false)
  const [trailingPct, setTrailingPct] = useState(2)
  const [riskPct, setRiskPct] = useState(1)

  const isPositive7d = (signal.price_change_7d ?? 0) >= 0
  const confScore = signal.confidence_score || calculateConfidenceScore(signal)
  const trailingStopPrice = signal.current_price * (1 - trailingPct / 100)
  const atrProxy = signal.high_24h - signal.low_24h
  const accountBalance = 10000
  const stopLossPct = Math.max(Math.abs(signal.price_change_24h || 2), 1)
  const positionSizeUsd = (accountBalance * (riskPct / 100)) / (stopLossPct / 100)
  const positionSizeCoins = positionSizeUsd / signal.current_price
  const allocationPct = (positionSizeUsd / accountBalance) * 100

  return (
    <Card className="overflow-hidden" style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <button className="shrink-0 group relative" onClick={() => onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h)} title="Otwórz wykres TradingView">
            <img src={signal.image} alt={signal.symbol} className="size-10 rounded-full group-hover:ring-2 transition-all" style={{ outlineColor: te.orange, outlineWidth: '2px' }} />
            <div className="absolute -bottom-0.5 -right-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: te.orange }}><Maximize2 className="size-2.5" style={{ color: '#000' }} /></div>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="font-semibold hover:underline underline-offset-2" style={{ color: te.text }} onClick={() => onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h)}>{signal.symbol.toUpperCase()}</button>
              <span className="text-xs" style={{ color: te.textMuted }}>{signal.name}</span>
              <span className="text-xs" style={{ color: te.textMuted }}>#{signal.market_cap_rank}</span>
              {hasCustomThreshold && <TooltipProvider><Tooltip><TooltipTrigger><SlidersHorizontal className="size-3" style={{ color: te.orange }} /></TooltipTrigger><TooltipContent className="text-xs">Niestandardowe progi</TooltipContent></Tooltip></TooltipProvider>}
              {(fearGreedValue !== undefined && fearGreedValue < 25) && <Badge style={{ background: te.orange, color: '#fff' }} className="text-[10px] gap-0.5 px-1.5 py-0">🔥 Sentiment Boost</Badge>}
            </div>
            <div className="text-sm" style={{ color: te.textMuted, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(signal.current_price)}</div>
          </div>
          <div className="hidden sm:block cursor-pointer" onClick={() => onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h)} title="Otwórz wykres">
            <MiniChart data={signal.sparkline_7d} isPositive={isPositive7d} width={80} height={32} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              {signalBadge(signal.signal_type)}
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${confidenceTextColor(confScore)}`}>{confScore}/100</Badge>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: (signal.price_change_1h ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>1h: {formatPct(signal.price_change_1h)}</span>
              <span style={{ color: (signal.price_change_24h ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>24h: {formatPct(signal.price_change_24h)}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>

        {expanded && (
          <>
            <Separator className="my-3" />
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: te.textMuted }}>Pewność sygnału</span>
                <span className="text-xs font-bold" style={{ color: confScore >= 70 ? te.green : confScore >= 40 ? te.yellow : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{confScore}/100</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: te.bgInput }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${confScore}%`, background: confScore >= 70 ? te.green : confScore >= 40 ? te.yellow : te.red }} />
              </div>
              <div className="flex justify-between mt-0.5">
                <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.red }}>Ryzykowne</span>
                <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.yellow }}>Umiarkowane</span>
                <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.green }}>Pewne</span>
              </div>
            </div>
            <div className="mb-3">
              <MiniChart data={signal.sparkline_7d} isPositive={isPositive7d} width={320} height={60} />
              <div style={{ fontFamily: te.mono, fontSize: '10px', color: te.textDim, marginTop: 2 }}>7 dni</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div style={{ color: te.textMuted, fontSize: '12px' }}>7d Change</div><div className="font-medium" style={{ color: (signal.price_change_7d ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPct(signal.price_change_7d)}</div></div>
              <div><div style={{ color: te.textMuted, fontSize: '12px' }}>Dip Score (RSI)</div><div className="font-medium" style={{ color: signal.estimated_rsi < 30 ? te.red : signal.estimated_rsi < 50 ? te.yellow : te.green, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{signal.estimated_rsi.toFixed(1)}</div></div>
              <div><div style={{ color: te.textMuted, fontSize: '12px' }}>Vol 24h</div><div className="font-medium" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatVolume(signal.volume_24h)}</div></div>
              <div><div style={{ color: te.textMuted, fontSize: '12px' }}>High / Low 24h</div><div className="font-medium text-xs" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(signal.high_24h)} / {formatPrice(signal.low_24h)}</div></div>
            </div>
            <Separator className="my-3" />
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2"><Thermometer className="size-3.5" style={{ color: te.orange }} /><span className="text-xs font-medium" style={{ color: te.text }}>Trailing Stop-Loss</span></div>
              <div className="rounded-lg p-3" style={{ background: `${te.bgInput}55` }}>
                <div className="flex items-end gap-1 mb-2 h-8">
                  <div className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full rounded-t" style={{ height: '100%', background: `${te.green}66` }} /><span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textMuted, marginTop: 2 }}>Wejście</span></div>
                  <div className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full rounded-t" style={{ height: `${Math.max(10, 100 - trailingPct * 8)}%`, background: `${te.orange}66` }} /><span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textMuted, marginTop: 2 }}>Trailing SL</span></div>
                  <div className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full rounded-t" style={{ height: '30%', background: `${te.red}44` }} /><span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textMuted, marginTop: 2 }}>ATR</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div style={{ color: te.textMuted }}>Cena wejścia</div><div className="font-medium" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(signal.current_price)}</div></div>
                  <div><div style={{ color: te.textMuted }}>Trailing SL ({trailingPct}%)</div><div className="font-medium" style={{ color: te.orange, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(trailingStopPrice)}</div></div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-[10px] shrink-0" style={{ color: te.textMuted }}>Trailing %</Label>
                  <Slider value={[trailingPct]} onValueChange={v => setTrailingPct(v[0])} min={0.5} max={10} step={0.5} className="flex-1" />
                  <Input type="number" value={trailingPct} onChange={e => setTrailingPct(Number(e.target.value))} className="w-16 h-7 text-xs" step={0.5} min={0.5} max={10} />
                </div>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2"><Calculator className="size-3.5" style={{ color: te.purple }} /><span className="text-xs font-medium" style={{ color: te.text }}>Kalkulator wielkości pozycji</span></div>
              <div className="rounded-lg p-3" style={{ background: `${te.bgInput}55` }}>
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div><Label className="text-[10px]" style={{ color: te.textMuted }}>Kapitał ($)</Label><Input type="number" value={accountBalance} readOnly className="h-7 text-xs" style={{ background: te.bgInput }} /></div>
                  <div><Label className="text-[10px]" style={{ color: te.textMuted }}>Ryzyko na trade (%)</Label><div className="flex items-center gap-1"><Slider value={[riskPct]} onValueChange={v => setRiskPct(v[0])} min={0.5} max={5} step={0.5} className="flex-1" /><span className="text-xs font-medium w-8 text-right" style={{ fontFamily: te.mono, color: te.text }}>{riskPct}%</span></div></div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div><span style={{ color: te.textMuted }}>Stop Loss %</span><div className="font-medium" style={{ fontFamily: te.mono, color: te.text, fontVariantNumeric: 'tabular-nums' }}>{stopLossPct.toFixed(1)}%</div></div>
                  <div><span style={{ color: te.textMuted }}>Zmienność (ATR proxy)</span><div className="font-medium" style={{ fontFamily: te.mono, color: te.text, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(atrProxy)}</div></div>
                </div>
                <Separator className="my-2" />
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="text-center p-2 rounded" style={{ background: te.purpleBg }}><div style={{ color: te.textMuted, fontFamily: te.mono, fontSize: '10px' }}>Wielkość pozycji</div><div className="font-bold" style={{ color: te.purple, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${positionSizeUsd.toFixed(0)}</div></div>
                  <div className="text-center p-2 rounded" style={{ background: te.purpleBg }}><div style={{ color: te.textMuted, fontFamily: te.mono, fontSize: '10px' }}>Ilość monet</div><div className="font-bold" style={{ color: te.purple, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{positionSizeCoins < 1 ? positionSizeCoins.toFixed(4) : positionSizeCoins.toFixed(2)}</div></div>
                  <div className="text-center p-2 rounded" style={{ background: te.purpleBg }}><div style={{ color: te.textMuted, fontFamily: te.mono, fontSize: '10px' }}>Alokacja</div><div className="font-bold" style={{ color: te.purple, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{allocationPct.toFixed(1)}%</div></div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h)}>
                <LineChartIcon className="size-3.5" />Otwórz wykres TradingView
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
