'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, RefreshCw, Shield, X } from 'lucide-react'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { type CryptoChartInfo, sanitizeImageUrl, getTradingViewSymbol, formatPrice, formatPct } from '@/lib/trading-shared'
import { useTE } from '@/lib/te-theme'

const CHART_INTERVALS = [
  { label: '1m', tv: '1' },
  { label: '5m', tv: '5' },
  { label: '15m', tv: '15' },
  { label: '30m', tv: '30' },
  { label: '1h', tv: '60' },
  { label: '4h', tv: '240' },
  { label: '1D', tv: 'D' },
] as const

interface CryptoChartDialogProps {
  crypto: CryptoChartInfo | null
  open: boolean
  onClose: () => void
}

export default function CryptoChartDialog({ crypto, open, onClose }: CryptoChartDialogProps) {
  const te = useTE()
  const containerRef = useRef<HTMLDivElement>(null)
  const [widgetLoading, setWidgetLoading] = useState(false)
  const [containerId, setContainerId] = useState('tv-chart-0')
  const _idCounter = useRef(0)
  const _widgetInstance = useRef<any>(null)

  const [selectedInterval, setSelectedInterval] = useState<string>('60')
  const [trailEnabled, setTrailEnabled] = useState(false)
  const [trailType, setTrailType] = useState<'pct' | 'atr'>('pct')
  const [trailPct, setTrailPct] = useState(3)
  const [atrMultiplier, setAtrMultiplier] = useState(2)
  const [atrPeriod, setAtrPeriod] = useState(14)
  const [entryPrice, setEntryPrice] = useState(0)
  const [trailPanelOpen, setTrailPanelOpen] = useState(false)

  const tvSymbol = crypto ? getTradingViewSymbol(crypto.coinId, crypto.symbol) : ''

  useEffect(() => {
    if (crypto) setEntryPrice(crypto.currentPrice)
  }, [crypto])

  const trailStopLevel = useMemo(() => {
    if (!trailEnabled || !crypto) return 0
    if (trailType === 'pct') {
      return entryPrice * (1 - trailPct / 100)
    } else {
      const estimatedATR = crypto.currentPrice * 0.02
      return entryPrice - atrMultiplier * estimatedATR
    }
  }, [trailEnabled, trailType, entryPrice, trailPct, atrMultiplier, crypto])

  const trailDistance = useMemo(() => {
    if (!trailEnabled || !crypto || trailStopLevel <= 0) return { dollar: 0, percent: 0 }
    const dollar = crypto.currentPrice - trailStopLevel
    const percent = (dollar / crypto.currentPrice) * 100
    return { dollar, percent }
  }, [trailEnabled, crypto, trailStopLevel])

  const riskLevel = useMemo(() => {
    if (!trailEnabled) return 'safe' as const
    if (trailDistance.percent > 10) return 'safe' as const
    if (trailDistance.percent > 5) return 'warning' as const
    return 'danger' as const
  }, [trailEnabled, trailDistance])

  const gaugeStopPct = useMemo(() => {
    if (!trailEnabled || !crypto || entryPrice <= 0) return 0
    const ratio = trailStopLevel / entryPrice
    return Math.max(0, Math.min(100, ratio * 100))
  }, [trailEnabled, crypto, entryPrice, trailStopLevel])

  const gaugeCurrentPct = useMemo(() => {
    if (!crypto || entryPrice <= 0) return 100
    const ratio = crypto.currentPrice / entryPrice
    return Math.max(0, Math.min(110, ratio * 100))
  }, [crypto, entryPrice])

  useEffect(() => {
    if (!open || !crypto || !containerRef.current) return

    const newId = `tv-chart-${++_idCounter.current}`
    setContainerId(newId)

    const raf = requestAnimationFrame(() => {
      const container = document.getElementById(newId)
      if (!container) return

      if (_widgetInstance.current) {
        try {
          if (typeof _widgetInstance.current.remove === 'function') {
            _widgetInstance.current.remove()
          }
        } catch {}
        _widgetInstance.current = null
      }
      container.innerHTML = ''
      setWidgetLoading(true)

      const loadAndInitWidget = () => {
        const TV = (window as unknown as Record<string, unknown>).TradingView
        if (!TV) {
          const existingScript = document.querySelector('script[src*="tradingview"]')
          if (existingScript) {
            existingScript.addEventListener('load', () => initWidget(newId))
            return
          }
          const script = document.createElement('script')
          script.src = 'https://s3.tradingview.com/tv.js'
          script.async = true
          script.onload = () => initWidget(newId)
          script.onerror = () => {
            setWidgetLoading(false)
          }
          document.head.appendChild(script)
        } else {
          initWidget(newId)
        }
      }

      const initWidget = (cId: string) => {
        const targetContainer = document.getElementById(cId)
        if (!targetContainer) return

        const TVConstructor = (window as unknown as Record<string, unknown>).TradingView as any
        try {
          const widget = new TVConstructor.widget({
            container_id: cId,
            autosize: true,
            symbol: tvSymbol,
            interval: selectedInterval,
            timezone: 'Europe/Warsaw',
            theme: 'dark',
            style: '1',
            locale: 'pl',
            toolbar_bg: '#2a2e39',
            enable_publishing: false,
            allow_symbol_change: true,
            save_image: false,
            hide_top_toolbar: false,
            hide_legend: false,
            hide_side_toolbar: false,
            withdateranges: true,
            details: true,
            hotlist: false,
            calendar: false,
            studies: [
              'RSI@tv-basicstudies',
              'MASimple@tv-basicstudies',
            ],
            overrides: {
              'mainSeriesProperties.candleStyle.upColor': '#26a69a',
              'mainSeriesProperties.candleStyle.downColor': '#ef5350',
              'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
              'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
              'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
              'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
              'PaneProperties.background': '#2a2e39',
              'PaneProperties.backgroundType': 'solid',
              'PaneProperties.vertGridProperties.color': '#363a45',
              'PaneProperties.horzGridProperties.color': '#363a45',
              'scalesProperties.textColor': '#8f98a0',
              'scalesProperties.backgroundColor': '#2a2e39',
            },
            loading_screen: { backgroundColor: '#2a2e39', foregroundColor: '#8f98a0' },
          })
          _widgetInstance.current = widget
          setTimeout(() => setWidgetLoading(false), 1500)
        } catch {
          setWidgetLoading(false)
        }
      }

      loadAndInitWidget()
    })

    return () => {
      cancelAnimationFrame(raf)
      if (_widgetInstance.current) {
        try {
          if (typeof _widgetInstance.current.remove === 'function') {
            _widgetInstance.current.remove()
          }
        } catch {}
        _widgetInstance.current = null
      }
      const container = document.getElementById(containerId)
      if (container) container.innerHTML = ''
    }
  }, [open, crypto, tvSymbol, selectedInterval])

  const handleClose = useCallback(() => {
    const container = document.getElementById(containerId)
    if (container) container.innerHTML = ''
    onClose()
  }, [onClose, containerId])

  useEffect(() => {
    if (!open) {
      setTrailEnabled(false)
      setTrailPanelOpen(false)
      setTrailType('pct')
      setTrailPct(3)
      setAtrMultiplier(2)
      setAtrPeriod(14)
    }
  }, [open])

  if (!open || !crypto) return null

  const riskBadgeColor = riskLevel === 'safe'
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : riskLevel === 'warning'
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      : 'bg-red-500/20 text-red-400 border-red-500/30'

  const riskLabel = riskLevel === 'safe' ? 'Safe' : riskLevel === 'warning' ? 'Warning' : 'Danger'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent showCloseButton={false} className="max-w-[95vw] w-full h-[90vh] p-0 gap-0 overflow-hidden bg-slate-900 border-slate-700">
        <DialogHeader className="sr-only">
          <DialogTitle>
            <VisuallyHidden.Root>Wykres {crypto.symbol.toUpperCase()} — TradingView</VisuallyHidden.Root>
          </DialogTitle>
        </DialogHeader>
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <img src={sanitizeImageUrl(crypto.image)} alt={crypto.symbol} className="size-8 rounded-full" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-lg">{crypto.symbol.toUpperCase()}</span>
                <span className="text-slate-400 text-sm">{crypto.name}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-white font-medium">{formatPrice(crypto.currentPrice)}</span>
                {crypto.priceChange24h !== null && (
                  <span className={crypto.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {formatPct(crypto.priceChange24h)} 24h
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {trailEnabled && trailStopLevel > 0 && (
              <>
                <Badge className={`text-[10px] gap-1 ${riskBadgeColor} border`} title="Poziom stop">
                  <Shield className="size-2.5" />
                  {formatPrice(trailStopLevel)}
                </Badge>
                <Badge className="text-[10px] gap-1 bg-slate-700/50 text-slate-300 border border-slate-600" title="Distance">
                  {trailDistance.percent.toFixed(1)}% / {formatPrice(trailDistance.dollar)}
                </Badge>
                <Badge className={`text-[10px] gap-1 ${riskBadgeColor} border`} title="Ocena ryzyka">
                  {riskLevel === 'safe' ? <Shield className="size-2.5" /> : riskLevel === 'warning' ? <AlertTriangle className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
                  {riskLabel}
                </Badge>
              </>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={trailEnabled ? 'default' : 'ghost'}
                    size="icon"
                    className={`size-8 ${trailEnabled ? 'bg-red-600 hover:bg-red-700 text-white' : 'text-slate-400 hover:text-white'}`}
                    onClick={() => {
                      setTrailEnabled(!trailEnabled)
                      if (!trailEnabled) setTrailPanelOpen(true)
                    }}
                  >
                    <Shield className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {trailEnabled ? 'Disable Trailing Stop' : 'Enable Trailing Stop'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex items-center gap-0.5">
              {CHART_INTERVALS.map(ci => (
                <button
                  key={ci.tv}
                  onClick={() => setSelectedInterval(ci.tv)}
                  className="h-6 px-1.5 text-[10px] font-mono font-semibold transition-colors"
                  style={{
                    background: selectedInterval === ci.tv ? te.blue : 'transparent',
                    color: selectedInterval === ci.tv ? '#fff' : te.textDim,
                    border: `1px solid ${selectedInterval === ci.tv ? te.blue : te.border}`,
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                >{ci.label}</button>
              ))}
            </div>
            <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">
              TradingView
            </Badge>
            <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-white" onClick={handleClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Collapsible Trailing Stop Panel */}
        <div className="shrink-0">
          <button
            className="w-full flex items-center justify-center gap-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
            onClick={() => setTrailPanelOpen(!trailPanelOpen)}
          >
            {trailEnabled && <div className="size-1.5 rounded-full bg-red-500 animate-pulse" />}
            <span>Trailing Stop</span>
            {trailPanelOpen ? <span>&#9650;</span> : <span>&#9660;</span>}
          </button>

          {trailPanelOpen && (
            <div className="px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/50 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-slate-400">Trailing Stop</Label>
                <Switch
                  checked={trailEnabled}
                  onCheckedChange={setTrailEnabled}
                  className="data-[state=checked]:bg-red-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-slate-400">Typ</Label>
                <Select value={trailType} onValueChange={(v: string) => setTrailType(v as 'pct' | 'atr')}>
                  <SelectTrigger className="h-7 w-[130px] text-[11px] bg-slate-700 border-slate-600 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="pct" className="text-[11px] text-slate-200 focus:bg-slate-700">Procentowy</SelectItem>
                    <SelectItem value="atr" className="text-[11px] text-slate-200 focus:bg-slate-700">ATR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {trailType === 'pct' && (
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] text-slate-400">Trail %</Label>
                  <Input
                    type="number"
                    value={trailPct}
                    onChange={e => setTrailPct(Number(e.target.value))}
                    className="h-7 w-[70px] text-[11px] bg-slate-700 border-slate-600 text-slate-200"
                    min={0.1} max={50} step={0.1}
                  />
                </div>
              )}

              {trailType === 'atr' && (
                <>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-slate-400">ATR multiplier</Label>
                    <Input
                      type="number"
                      value={atrMultiplier}
                      onChange={e => setAtrMultiplier(Number(e.target.value))}
                      className="h-7 w-[60px] text-[11px] bg-slate-700 border-slate-600 text-slate-200"
                      min={0.5} max={10} step={0.5}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-slate-400">ATR okres</Label>
                    <Input
                      type="number"
                      value={atrPeriod}
                      onChange={e => setAtrPeriod(Number(e.target.value))}
                      className="h-7 w-[60px] text-[11px] bg-slate-700 border-slate-600 text-slate-200"
                      min={5} max={50} step={1}
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-slate-400">Entry price</Label>
                <Input
                  type="number"
                  value={entryPrice}
                  onChange={e => setEntryPrice(Number(e.target.value))}
                  className="h-7 w-[110px] text-[11px] bg-slate-700 border-slate-600 text-slate-200"
                  min={0}
                  step={crypto.currentPrice >= 1 ? 0.01 : 0.00001}
                />
              </div>

              {trailEnabled && trailStopLevel > 0 && (
                <div className="flex items-center gap-3 ml-auto">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500">Poziom stop:</span>
                    <span className="text-[11px] text-red-400 font-medium">{formatPrice(trailStopLevel)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500">Distance:</span>
                    <span className="text-[11px] text-slate-300 font-medium">{trailDistance.percent.toFixed(1)}% ({formatPrice(trailDistance.dollar)})</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chart Container with gauge overlay */}
        <div className="flex-1 w-full relative" style={{ height: trailPanelOpen ? 'calc(90vh - 110px)' : 'calc(90vh - 72px)' }}>
          {widgetLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
              <div className="flex items-center gap-3 text-slate-400">
                <RefreshCw className="size-5 animate-spin" />
                <span>Loading TradingView chart...</span>
              </div>
            </div>
          )}
          <div id={containerId} ref={containerRef} className="w-full h-full" />

          {trailEnabled && trailStopLevel > 0 && (
            <div className="absolute right-0 top-0 bottom-0 w-[52px] z-20 pointer-events-none flex">
              <div className="relative w-2 bg-slate-800/80 border-l border-slate-700/50 rounded-l my-8 mx-auto">
                <div
                  className="absolute left-0 right-0 h-[2px] bg-emerald-500 z-10"
                  style={{ bottom: '100%' }}
                  title={`Entry price: ${formatPrice(entryPrice)}`}
                >
                  <div className="absolute -left-1 -top-[1px] w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </div>

                <div
                  className="absolute left-0 right-0 z-10"
                  style={{ bottom: `${gaugeStopPct}%` }}
                  title={`Stop: ${formatPrice(trailStopLevel)}`}
                >
                  <div className="border-t-2 border-dashed border-red-500 w-full" />
                  <div className="absolute -left-1 -top-[3px] w-1.5 h-1.5 rounded-sm bg-red-500 rotate-45" />
                </div>

                <div
                  className="absolute left-0 right-0 z-10"
                  style={{ bottom: `${Math.min(gaugeCurrentPct, 100)}%` }}
                  title={`Aktualna: ${formatPrice(crypto.currentPrice)}`}
                >
                  <div className="absolute -left-1.5 -top-[4px] w-2 h-2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
                </div>

                <div
                  className="absolute bottom-0 left-0 right-0 bg-red-500/10"
                  style={{ height: `${gaugeStopPct}%` }}
                />
              </div>

              <div className="flex flex-col justify-between py-8 pl-1 text-[8px] font-mono w-10">
                <span className="text-white/70 truncate" title={formatPrice(crypto.currentPrice)}>
                  {crypto.currentPrice >= 1 ? crypto.currentPrice.toFixed(0) : crypto.currentPrice.toFixed(4)}
                </span>
                <span className="text-emerald-400/70 truncate" title={formatPrice(entryPrice)}>
                  {entryPrice >= 1 ? entryPrice.toFixed(0) : entryPrice.toFixed(4)}
                </span>
                <span className="text-red-400/70 truncate" title={formatPrice(trailStopLevel)}>
                  {trailStopLevel >= 1 ? trailStopLevel.toFixed(0) : trailStopLevel.toFixed(4)}
                </span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
