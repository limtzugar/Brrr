'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis, ReferenceLine } from 'recharts'
import { AlertTriangle, ArrowDown, ArrowUp, RefreshCw, SlidersHorizontal, TrendingUp, Gauge } from 'lucide-react'
import {
  COIN_OPTIONS, formatPrice, getTradingViewSymbol,
} from '@/lib/trading-shared'
import { useTE } from '@/lib/te-theme'

const CHART_INTERVALS = [
  { label: '1m', tv: '1', maxDays: 7 },
  { label: '5m', tv: '5', maxDays: 30 },
  { label: '15m', tv: '15', maxDays: 30 },
  { label: '30m', tv: '30', maxDays: 90 },
  { label: '1h', tv: '60', maxDays: 90 },
  { label: '4h', tv: '240', maxDays: 180 },
  { label: '1D', tv: 'D', maxDays: 365 },
  { label: '1W', tv: 'W', maxDays: 365 },
] as const

const TIME_PERIODS = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
] as const

// Smart pairing: when user changes interval, auto-adjust period to a sensible default
const INTERVAL_DEFAULT_DAYS: Record<string, number> = {
  '1': 7,
  '5': 30,
  '15': 30,
  '30': 90,
  '60': 90,
  '240': 180,
  'D': 365,
  'W': 365,
}

// When user changes period, auto-select best interval for that period
const PERIOD_DEFAULT_INTERVAL: Record<number, string> = {
  7: '5',
  30: '60',
  90: '60',
  180: '240',
  365: 'D',
}

interface IndicatorData {
  hurst: Array<{ date: string; value: number }>
  rsi: Array<{ date: string; value: number }>
  macd: Array<{ date: string; macd: number; signal: number; histogram: number }>
  bb: Array<{ date: string; upper: number; middle: number; lower: number; price: number }>
}

export default function WykresyTab() {
  const te = useTE()
  const [selectedCoin, setSelectedCoin] = useState('bitcoin')
  const [selectedDays, setSelectedDays] = useState(90)
  const [selectedInterval, setSelectedInterval] = useState<string>('60')
  const [indicatorData, setIndicatorData] = useState<IndicatorData | null>(null)
  const [indicatorsLoading, setIndicatorsLoading] = useState(false)
  const [indicatorsError, setIndicatorsError] = useState<string | null>(null)
  const [widgetLoading, setWidgetLoading] = useState(true)
  const [coinPrice, setCoinPrice] = useState<number | null>(null)

  // Smart interval/period pairing
  const handleIntervalChange = useCallback((tv: string) => {
    setSelectedInterval(tv)
    // Auto-adjust period if current period is too large for this interval
    const intervalDef = CHART_INTERVALS.find(ci => ci.tv === tv)
    if (intervalDef && selectedDays > intervalDef.maxDays) {
      setSelectedDays(INTERVAL_DEFAULT_DAYS[tv] || 90)
    }
  }, [selectedDays])

  const handlePeriodChange = useCallback((days: number) => {
    setSelectedDays(days)
    // Auto-adjust interval if current interval can't support this period
    const currentMax = CHART_INTERVALS.find(ci => ci.tv === selectedInterval)?.maxDays || 365
    if (days > currentMax) {
      setSelectedInterval(PERIOD_DEFAULT_INTERVAL[days] || 'D')
    }
  }, [selectedInterval])

  const tvContainerRef = useRef<HTMLDivElement>(null)
  const _idCounter = useRef(0)
  const _currentContainerId = useRef('wykresy-tv-0')
  const _widgetInstance = useRef<any>(null)
  const [containerId, setContainerId] = useState('wykresy-tv-0')

  const coinOption = COIN_OPTIONS.find(c => c.id === selectedCoin)
  const tvSymbol = getTradingViewSymbol(selectedCoin, coinOption?.label || '')

  const fetchIndicators = useCallback(async () => {
    setIndicatorsLoading(true)
    setIndicatorsError(null)
    try {
      const res = await fetch(`/api/indicators?coin_id=${selectedCoin}&days=${selectedDays}&indicators=hurst,rsi,macd,bb`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Błąd pobierania wskaźników')
      }
      const data = await res.json()
      setIndicatorData({
        hurst: data.indicators?.hurst || [],
        rsi: data.indicators?.rsi || [],
        macd: data.indicators?.macd || [],
        bb: data.indicators?.bb || [],
      })
      if (data.prices && data.prices.length > 0) {
        setCoinPrice(data.prices[data.prices.length - 1].price)
      }
    } catch (err) {
      setIndicatorsError(err instanceof Error ? err.message : 'Nieznany błąd')
    } finally {
      setIndicatorsLoading(false)
    }
  }, [selectedCoin, selectedDays])

  useEffect(() => {
    if (!tvContainerRef.current) return
    const newId = `wykresy-tv-${++_idCounter.current}`
    _currentContainerId.current = newId
    setContainerId(newId)

    const raf = requestAnimationFrame(() => {
      const cId = _currentContainerId.current
      const container = document.getElementById(cId)
      if (!container) return

      if (_widgetInstance.current) {
        try { if (typeof _widgetInstance.current.remove === 'function') _widgetInstance.current.remove() } catch {}
        _widgetInstance.current = null
      }
      container.innerHTML = ''
      setWidgetLoading(true)

      const loadAndInitWidget = () => {
        const TV = (window as unknown as Record<string, unknown>).TradingView
        if (!TV) {
          const existingScript = document.querySelector('script[src*="tradingview"]')
          if (existingScript) { existingScript.addEventListener('load', () => initWidget(cId)); return }
          const script = document.createElement('script')
          script.src = 'https://s3.tradingview.com/tv.js'
          script.async = true
          script.onload = () => initWidget(cId)
          script.onerror = () => setWidgetLoading(false)
          document.head.appendChild(script)
        } else { initWidget(cId) }
      }

      const initWidget = (widgetContainerId: string) => {
        const targetContainer = document.getElementById(widgetContainerId)
        if (!targetContainer) return
        const TVConstructor = (window as unknown as Record<string, unknown>).TradingView as any
        try {
          const widget = new TVConstructor.widget({
            container_id: widgetContainerId, autosize: true, symbol: tvSymbol, interval: selectedInterval,
            timezone: 'Europe/Warsaw', theme: 'dark', style: '1', locale: 'pl',
            toolbar_bg: '#2a2e39', enable_publishing: false, allow_symbol_change: true,
            save_image: false, hide_top_toolbar: false, hide_legend: false,
            hide_side_toolbar: false, withdateranges: true, details: false,
            hotlist: false, calendar: false,
            studies: ['MASimple@tv-basicstudies', 'MAExp@tv-basicstudies', 'BB@tv-basicstudies', 'MACD@tv-basicstudies', 'RSI@tv-basicstudies', 'Volume@tv-basicstudies'],
            overrides: {
              'mainSeriesProperties.candleStyle.upColor': '#26a69a', 'mainSeriesProperties.candleStyle.downColor': '#ef5350',
              'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a', 'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
              'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a', 'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
              'PaneProperties.background': '#2a2e39', 'PaneProperties.backgroundType': 'solid',
              'PaneProperties.vertGridProperties.color': '#363a45', 'PaneProperties.horzGridProperties.color': '#363a45',
              'scalesProperties.textColor': '#8f98a0', 'scalesProperties.backgroundColor': '#2a2e39',
            },
            loading_screen: { backgroundColor: '#2a2e39', foregroundColor: '#8f98a0' },
          })
          _widgetInstance.current = widget
          setTimeout(() => setWidgetLoading(false), 1500)
        } catch { setWidgetLoading(false) }
      }
      loadAndInitWidget()
    })

    return () => {
      cancelAnimationFrame(raf)
      if (_widgetInstance.current) {
        try { if (typeof _widgetInstance.current.remove === 'function') _widgetInstance.current.remove() } catch {}
        _widgetInstance.current = null
      }
      const cleanupId = _currentContainerId.current
      const container = document.getElementById(cleanupId)
      if (container) container.innerHTML = ''
    }
  }, [tvSymbol, selectedDays, selectedInterval])

  useEffect(() => { void fetchIndicators() }, [fetchIndicators])

  const currentHurst = indicatorData?.hurst.length ? indicatorData.hurst[indicatorData.hurst.length - 1].value : null
  const currentRSI = indicatorData?.rsi.length ? indicatorData.rsi[indicatorData.rsi.length - 1].value : null
  const currentMACD = indicatorData?.macd.length ? indicatorData.macd[indicatorData.macd.length - 1] : null
  const currentBB = indicatorData?.bb.length ? indicatorData.bb[indicatorData.bb.length - 1] : null

  const bbPercentB = useMemo(() => {
    if (!currentBB || !currentBB.upper || !currentBB.lower) return null
    const range = currentBB.upper - currentBB.lower
    if (range === 0) return null
    return ((currentBB.price - currentBB.lower) / range) * 100
  }, [currentBB])

  const hurstInterpretation = currentHurst !== null ? (currentHurst < 0.5 ? 'Mean-reverting' : 'Trending') : null

  const formatChartDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const hurstChartData = useMemo(() => {
    if (!indicatorData?.hurst) return []
    return indicatorData.hurst.map(h => {
      const rsiPoint = indicatorData.rsi.find(r => r.date === h.date)
      return { date: formatChartDate(h.date), hurst: h.value, rsi: rsiPoint?.value ?? undefined }
    })
  }, [indicatorData])

  const teCardStyle: React.CSSProperties = {
    background: te.bgCard,
    border: `1px solid ${te.border}`,
    borderRadius: '4px',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontFamily: te.mono,
    fontSize: '9px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: te.textMuted,
    fontWeight: 700,
  }

  const dataValueStyle: React.CSSProperties = {
    fontFamily: te.mono,
    fontVariantNumeric: 'tabular-nums',
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedCoin} onValueChange={setSelectedCoin}>
          <SelectTrigger className="w-[160px]" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text }}><SelectValue /></SelectTrigger>
          <SelectContent style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            {COIN_OPTIONS.map(coin => (
              <SelectItem key={coin.id} value={coin.id} style={{ color: te.text }}>{coin.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-0.5">
          {CHART_INTERVALS.map(ci => (
            <Button key={ci.tv} variant={selectedInterval === ci.tv ? 'default' : 'ghost'} size="sm"
              className="h-6 px-1.5 text-[10px] font-mono rounded-sm"
              style={selectedInterval === ci.tv ? { background: te.orange, color: '#000' } : { color: te.textDim }}
              onClick={() => handleIntervalChange(ci.tv)}>{ci.label}</Button>
          ))}
          {TIME_PERIODS.map(tp => (
            <Button key={tp.days} variant={selectedDays === tp.days ? 'default' : 'ghost'} size="sm"
              className="h-6 px-2 text-[10px] rounded-sm"
              style={selectedDays === tp.days ? { background: te.orange, color: '#000' } : { color: te.textMuted }}
              onClick={() => handlePeriodChange(tp.days)}>{tp.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {coinPrice !== null && (
            <div className="flex items-center rounded-sm px-2 py-0.5" style={{ background: `${te.bgInput}80`, border: `1px solid ${te.border}`, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
              <span className="text-[11px] font-medium" style={{ color: te.text }}>{formatPrice(coinPrice)}</span>
              <span className="text-[9px] font-semibold ml-1.5" style={{ color: te.orange }}>{coinOption?.label || selectedCoin}</span>
            </div>
          )}
        </div>
      </div>

      <Card className="overflow-hidden" style={teCardStyle}>
        <div className="relative" style={{ height: '55vh', minHeight: '400px' }}>
          {widgetLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: te.bgCard }}>
              <div className="flex items-center gap-3" style={{ color: te.textMuted }}><RefreshCw className="size-5 animate-spin" /><span>Ładowanie wykresu TradingView...</span></div>
            </div>
          )}
          <div id={containerId} ref={tvContainerRef} className="w-full h-full" />
        </div>
      </Card>

      <Card style={teCardStyle}>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium" style={{ color: te.text }}>Hurst Exponent (HCCCO_LB)</CardTitle>
              {currentHurst !== null && (
                <Badge className="text-[10px] gap-1 border" style={{ background: currentHurst < 0.5 ? te.purpleBg : te.yellowBg, color: currentHurst < 0.5 ? te.purple : te.yellow, borderColor: currentHurst < 0.5 ? `${te.purple}50` : `${te.yellow}50` }}>
                  H = {currentHurst.toFixed(3)}
                </Badge>
              )}
              {hurstInterpretation && (
                <Badge className="text-[10px]" style={{ background: currentHurst! < 0.5 ? te.purple : te.yellow, color: '#fff' }}>{hurstInterpretation}</Badge>
              )}
            </div>
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: te.borderLight, color: te.textDim }}>RSI overlay</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          {indicatorsLoading ? (
            <div className="space-y-2" style={{ height: '200px' }}><Skeleton className="h-full w-full" style={{ background: te.bgInput }} /></div>
          ) : indicatorsError ? (
            <div className="flex items-center justify-center text-sm py-8" style={{ color: te.red }}><AlertTriangle className="size-4 mr-2" />{indicatorsError}</div>
          ) : hurstChartData.length === 0 ? (
            <div className="flex items-center justify-center text-sm py-8" style={{ color: te.textDim }}>Brak danych Hurst dla wybranego okresu (wymaga ≥100 punktów)</div>
          ) : (
            <ChartContainer config={{ hurst: { color: currentHurst !== null && currentHurst < 0.5 ? te.purple : te.yellow }, rsi: { color: te.textMuted } }} className="h-[200px] w-full">
              <AreaChart data={hurstChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="hurstGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={currentHurst !== null && currentHurst < 0.5 ? te.purple : te.yellow} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={currentHurst !== null && currentHurst < 0.5 ? te.purple : te.yellow} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={te.border} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: te.textDim }} interval="preserveStartEnd" />
                <YAxis yAxisId="hurst" domain={[0, 1]} tick={{ fontSize: 10, fill: te.textDim }} tickFormatter={(v: number) => v.toFixed(1)} />
                <YAxis yAxisId="rsi" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: te.textDim }} tickFormatter={(v: number) => v.toFixed(0)} />
                <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => { const v = Number(value); if (name === 'hurst') return [v.toFixed(3), 'Hurst']; if (name === 'rsi') return [v.toFixed(1), 'RSI']; return [String(v), name] }} />} />
                <ReferenceLine yAxisId="hurst" y={0.5} stroke={te.red} strokeDasharray="5 5" strokeWidth={1.5} label={{ value: 'H=0.5', position: 'insideTopRight', fill: te.red, fontSize: 10 }} />
                <Area yAxisId="hurst" type="monotone" dataKey="hurst" stroke={currentHurst !== null && currentHurst < 0.5 ? te.purple : te.yellow} fill="url(#hurstGradient)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="rsi" type="monotone" dataKey="rsi" stroke={te.textMuted} strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* RSI Card */}
        <Card style={teCardStyle}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-medium" style={{ color: te.textMuted }}>RSI (14)</span><Gauge className="size-3.5" style={{ color: te.textDim }} /></div>
            {indicatorsLoading ? <Skeleton className="h-6 w-16" style={{ background: te.bgInput }} /> : currentRSI !== null ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ ...dataValueStyle, color: currentRSI > 70 ? te.red : currentRSI < 30 ? te.green : te.text }}>{currentRSI.toFixed(1)}</span>
                  <Badge className="text-[9px] border" style={{ background: currentRSI > 70 ? te.redBg : currentRSI < 30 ? te.greenBg : te.bgInput, color: currentRSI > 70 ? te.red : currentRSI < 30 ? te.green : te.textMuted, borderColor: currentRSI > 70 ? `${te.red}50` : currentRSI < 30 ? `${te.green}50` : te.border }}>
                    {currentRSI > 70 ? 'Overbought' : currentRSI < 30 ? 'Oversold' : 'Neutral'}
                  </Badge>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: te.bgInput }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, currentRSI)}%`, background: currentRSI > 70 ? te.red : currentRSI < 30 ? te.green : te.yellow }} />
                </div>
              </>
            ) : <span className="text-sm" style={{ color: te.textDim }}>N/A</span>}
          </CardContent>
        </Card>

        {/* MACD Card */}
        <Card style={teCardStyle}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-medium" style={{ color: te.textMuted }}>MACD (12,26,9)</span><TrendingUp className="size-3.5" style={{ color: te.textDim }} /></div>
            {indicatorsLoading ? <Skeleton className="h-6 w-16" style={{ background: te.bgInput }} /> : currentMACD ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: te.textDim }}>MACD</span><span className="text-sm font-semibold" style={{ ...dataValueStyle, color: currentMACD.macd >= 0 ? te.green : te.red }}>{currentMACD.macd.toFixed(2)}</span></div>
                <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: te.textDim }}>Signal</span><span className="text-sm" style={{ color: te.text, ...dataValueStyle }}>{currentMACD.signal?.toFixed(2) ?? 'N/A'}</span></div>
                <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: te.textDim }}>Hist</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium" style={{ ...dataValueStyle, color: (currentMACD.histogram ?? 0) >= 0 ? te.green : te.red }}>{(currentMACD.histogram ?? 0).toFixed(2)}</span>
                    {(currentMACD.histogram ?? 0) >= 0 ? <ArrowUp className="size-3" style={{ color: te.green }} /> : <ArrowDown className="size-3" style={{ color: te.red }} />}
                  </div>
                </div>
              </div>
            ) : <span className="text-sm" style={{ color: te.textDim }}>N/A</span>}
          </CardContent>
        </Card>

        {/* Bollinger Bands Card */}
        <Card style={teCardStyle}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-medium" style={{ color: te.textMuted }}>Bollinger (20,2)</span><SlidersHorizontal className="size-3.5" style={{ color: te.textDim }} /></div>
            {indicatorsLoading ? <Skeleton className="h-6 w-16" style={{ background: te.bgInput }} /> : bbPercentB !== null ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-2"><span className="text-lg font-bold" style={{ color: te.text }}>%B</span><span className="text-sm font-medium" style={{ ...dataValueStyle, color: bbPercentB > 100 ? te.yellow : bbPercentB < 0 ? te.purple : te.textMuted }}>{bbPercentB.toFixed(1)}%</span></div>
                <div className="mt-1.5 relative h-1.5 rounded-full overflow-hidden" style={{ background: te.bgInput }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, bbPercentB))}%`, background: te.purple }} />
                  <div className="absolute top-0 left-1/2 w-px h-full" style={{ background: te.borderLight }} />
                </div>
                <div className="flex justify-between text-[9px] mt-0.5" style={{ color: te.textDim }}><span>Lower</span><span>Mid</span><span>Upper</span></div>
              </div>
            ) : <span className="text-sm" style={{ color: te.textDim }}>N/A</span>}
          </CardContent>
        </Card>

        {/* Hurst Card */}
        <Card style={teCardStyle}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] font-medium" style={{ color: te.textMuted }}>Hurst Exponent</span><Gauge className="size-3.5" style={{ color: te.textDim }} /></div>
            {indicatorsLoading ? <Skeleton className="h-6 w-16" style={{ background: te.bgInput }} /> : currentHurst !== null ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ ...dataValueStyle, color: currentHurst < 0.5 ? te.purple : te.yellow }}>{currentHurst.toFixed(3)}</span>
                  <Badge className="text-[9px] border" style={{ background: currentHurst < 0.5 ? te.purpleBg : te.yellowBg, color: currentHurst < 0.5 ? te.purple : te.yellow, borderColor: currentHurst < 0.5 ? `${te.purple}50` : `${te.yellow}50` }}>
                    {currentHurst < 0.5 ? 'Mean-reverting' : 'Trending'}
                  </Badge>
                </div>
                <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: te.bgInput }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, currentHurst * 100)}%`, background: currentHurst < 0.5 ? te.purple : te.yellow }} />
                  <div className="absolute top-0 left-1/2 w-px h-full" style={{ background: `${te.red}80` }} />
                </div>
                <div className="flex justify-between text-[9px] mt-0.5" style={{ color: te.textDim }}><span>0 (MR)</span><span>0.5</span><span>1 (Trend)</span></div>
              </div>
            ) : <span className="text-sm" style={{ color: te.textDim }}>N/A — wymaga ≥100 punktów danych</span>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
