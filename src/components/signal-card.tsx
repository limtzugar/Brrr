'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronDown, ChevronUp, LineChart as LineChartIcon, SlidersHorizontal, Thermometer, Calculator } from 'lucide-react'
import MiniChart from '@/components/mini-chart'
import InteractiveSparkline from '@/components/interactive-sparkline'
import {
  type DipSignal,
  formatPrice,
  formatPct,
  pctColor,
  formatVolume,
  signalBadge,
  calculateConfidenceScore,
  confidenceColor,
  confidenceTextColor,
  sanitizeImageUrl,
} from '@/lib/trading-shared'
import { useTE } from '@/lib/te-theme'

interface SignalCardProps {
  signal: DipSignal
  onOpenChart: (coinId: string, symbol: string, name: string, image: string, currentPrice: number, priceChange24h: number | null) => void
  fearGreedValue?: number
  hasCustomThreshold?: boolean
  taConfirmed?: { rsi: number; macdHist: number; type: 'RSI_OVERSOLD' | 'MACD_BULL' | 'BOTH' } | null
}

export default function SignalCard({ signal, onOpenChart, fearGreedValue, hasCustomThreshold, taConfirmed }: SignalCardProps) {
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
    <div className="w-full">
      <button
        className="flex items-center gap-2 px-3 py-1.5 transition-colors w-full text-left group"
        style={{ borderBottom: `1px solid ${te.border}` }}
        onMouseEnter={(e) => (e.currentTarget.style.background = te.bgCardHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => setExpanded(!expanded)}
      >
        <img
          src={sanitizeImageUrl(signal.image)} alt={signal.symbol} className="size-5 rounded-full shrink-0"
          onClick={(e) => { e.stopPropagation(); onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h) }}
          title="Open TradingView chart"
          style={{ cursor: 'pointer' }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span
              className="text-xs font-medium truncate"
              style={{ color: te.text }}
              onClick={(e) => { e.stopPropagation(); onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h) }}
            >
              {signal.symbol.toUpperCase()}
            </span>
            <span className="text-[10px]" style={{ color: te.textMuted }}>#{signal.market_cap_rank}</span>
            {hasCustomThreshold && (
              <TooltipProvider><Tooltip><TooltipTrigger><SlidersHorizontal className="size-2.5 text-orange-500" /></TooltipTrigger><TooltipContent className="text-xs">Niestandardowe progi</TooltipContent></Tooltip></TooltipProvider>
            )}
            {(fearGreedValue !== undefined && fearGreedValue < 25) && (
              <span className="text-[8px] px-1 rounded-sm bg-orange-500/20 text-orange-400 font-bold">BOOST</span>
            )}
            {signalBadge(signal.signal_type)}
            {taConfirmed && (
              <span
                className="text-[8px] px-1 rounded-sm font-bold inline-flex items-center gap-0.5"
                style={{
                  background: taConfirmed.type === 'BOTH' ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.12)',
                  color: '#22c55e',
                  border: `1px solid ${taConfirmed.type === 'BOTH' ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.35)'}`,
                  animation: taConfirmed.type === 'BOTH' ? 'ta-pulse 1.4s ease-in-out infinite' : undefined,
                }}
                title={`TA Confirm: RSI ${taConfirmed.rsi.toFixed(1)} | MACD hist ${taConfirmed.macdHist.toFixed(4)} | ${taConfirmed.type}`}
              >
                {taConfirmed.type === 'BOTH' ? '✓✓ TA JAZDA!' : '✓ TA'}
              </span>
            )}
          </div>
          <div className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(signal.current_price)}</div>
        </div>
        <div className="hidden sm:block">
          <MiniChart data={signal.sparkline_7d} isPositive={isPositive7d} width={44} height={16} />
        </div>
        <div className="text-right">
          <div className="text-xs font-medium" style={{ color: (signal.price_change_24h ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPct(signal.price_change_24h)}</div>
          <div className="text-[10px]" style={{ color: (signal.price_change_1h ?? 0) >= 0 ? te.green : te.red }}>1h {formatPct(signal.price_change_1h)}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className={`text-[8px] px-1 py-0 ${confidenceTextColor(confScore)}`}>{confScore}</Badge>
          <div
            className="flex items-center justify-center size-6 rounded transition-colors"
            style={{ background: expanded ? te.orange + '1a' : 'transparent', border: `1px solid ${expanded ? te.orange + '55' : te.border}` }}
          >
            <ChevronDown
              className="size-3.5 transition-transform duration-300"
              style={{ color: expanded ? te.orange : te.textMuted, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </div>
        </div>
      </button>

        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{ maxHeight: expanded ? 800 : 0, opacity: expanded ? 1 : 0 }}
        >
          <div className="px-3 py-2">
            <Separator className="my-3" />
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Signal confidence</span>
                <span className={`text-xs font-bold ${confidenceTextColor(confScore)}`}>{confScore}/100</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${confidenceColor(confScore)}`} style={{ width: `${confScore}%` }} />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-red-500">Ryzykowne</span>
                <span className="text-[9px] text-amber-500">Umiarkowane</span>
                <span className="text-[9px] text-emerald-500">Pewne</span>
              </div>
            </div>

            <div className="mb-3">
              <InteractiveSparkline data={signal.sparkline_7d} isPositive={isPositive7d} width={320} height={80} showLabel />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">7d Change</div>
                <div className={`font-medium ${pctColor(signal.price_change_7d)}`}>{formatPct(signal.price_change_7d)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Dip Score</div>
                <div className={`font-medium ${signal.estimated_rsi < 30 ? 'text-red-500' : signal.estimated_rsi < 50 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {signal.estimated_rsi.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Vol 24h</div>
                <div className="font-medium">{formatVolume(signal.volume_24h)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">High / Low 24h</div>
                <div className="font-medium text-xs">{formatPrice(signal.high_24h)} / {formatPrice(signal.low_24h)}</div>
              </div>
            </div>

            <Separator className="my-3" />

            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Thermometer className="size-3.5 text-orange-500" />
                <span className="text-xs font-medium">Trailing Stop-Loss</span>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-end gap-1 mb-2 h-8">
                  <div className="flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full bg-emerald-500/40 rounded-t" style={{ height: '100%' }} />
                    <span className="text-[9px] text-muted-foreground mt-0.5">Entry</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full bg-orange-500/40 rounded-t" style={{ height: `${Math.max(10, 100 - trailingPct * 8)}%` }} />
                    <span className="text-[9px] text-muted-foreground mt-0.5">Trailing SL</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full bg-red-500/30 rounded-t" style={{ height: '30%' }} />
                    <span className="text-[9px] text-muted-foreground mt-0.5">ATR</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">Entry price</div>
                    <div className="font-medium">{formatPrice(signal.current_price)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Trailing SL ({trailingPct}%)</div>
                    <div className="font-medium text-orange-500">{formatPrice(trailingStopPrice)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-[10px] shrink-0">Trailing %</Label>
                  <Slider value={[trailingPct]} onValueChange={v => setTrailingPct(v[0])} min={0.5} max={10} step={0.5} className="flex-1" />
                  <Input type="number" value={trailingPct} onChange={e => setTrailingPct(Number(e.target.value))} className="w-16 h-7 text-xs" step={0.5} min={0.5} max={10} />
                </div>
              </div>
            </div>

            <Separator className="my-3" />

            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="size-3.5 text-purple-500" />
                <span className="text-xs font-medium">Position size calculator</span>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div>
                    <Label className="text-[10px]">Capital ($)</Label>
                    <Input type="number" value={accountBalance} readOnly className="h-7 text-xs bg-muted" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Ryzyko on trade (%)</Label>
                    <div className="flex items-center gap-1">
                      <Slider value={[riskPct]} onValueChange={v => setRiskPct(v[0])} min={0.5} max={5} step={0.5} className="flex-1" />
                      <span className="text-xs font-medium w-8 text-right">{riskPct}%</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">Stop Loss %</span>
                    <div className="font-medium">{stopLossPct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Volatility (ATR proxy)</span>
                    <div className="font-medium">{formatPrice(atrProxy)}</div>
                  </div>
                </div>
                <Separator className="my-2" />
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="text-center p-2 rounded bg-purple-500/10">
                    <div className="text-muted-foreground text-[10px]">Position size</div>
                    <div className="font-bold text-purple-600">${positionSizeUsd.toFixed(0)}</div>
                  </div>
                  <div className="text-center p-2 rounded bg-purple-500/10">
                    <div className="text-muted-foreground text-[10px]">Coin amount</div>
                    <div className="font-bold text-purple-600">{positionSizeCoins < 1 ? positionSizeCoins.toFixed(4) : positionSizeCoins.toFixed(2)}</div>
                  </div>
                  <div className="text-center p-2 rounded bg-purple-500/10">
                    <div className="text-muted-foreground text-[10px]">Alokacja</div>
                    <div className="font-bold text-purple-600">{allocationPct.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => onOpenChart(signal.coin_id, signal.symbol, signal.name, signal.image, signal.current_price, signal.price_change_24h)}
              >
                <LineChartIcon className="size-3.5" />
                Open TradingView chart
              </Button>
            </div>
          </div>
        </div>
    </div>
  )
}
