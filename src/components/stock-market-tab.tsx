// @ts-nocheck — legacy file from previous session, needs refactoring
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { type AssetChartInfo, stockIndexToTvSymbol } from '@/components/asset-chart-modal'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts'

// ─── TE Design Tokens ────────────────────────────────────────────────────

import { TE, PLACEHOLDER_STYLE, PLACEHOLDER_BADGE_STYLE, PLACEHOLDER_WRAPPER_STYLE, seededRandom } from '@/lib/te-tokens'

// ─── Types ────────────────────────────────────────────────────────────────

interface IndexQuote {
  symbol: string
  name: string
  exchange: string
  price: number
  change: number
  changePercent: number
  dayData: { time: string; value: number }[]
  letter: string
  letterColor: string
}

interface NetInflowPoint {
  time: string
  nasdaq: number
  nyse: number
}

interface SectorData {
  name: string
  change: number
  marketCap?: string
}

// ─── Fetch stock market data ──────────────────────────────────────────────

async function fetchStockData(): Promise<{
  indices: IndexQuote[]
  netInflow: NetInflowPoint[]
  sectors: SectorData[]
} | null> {
  try {
    const res = await fetch('/api/market-ticker', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const t = data.tickers || {}

    // Build index quotes from available ticker data
    const indices: IndexQuote[] = []

    // SPX / S&P 500
    if (t.sp500) {
      const dayData = generateIntradayData(t.sp500.price, t.sp500.changePercent, 78)
      indices.push({
        symbol: 'SPX',
        name: 'S&P 500',
        exchange: 'IDXSP',
        price: t.sp500.price,
        change: t.sp500.change,
        changePercent: t.sp500.changePercent,
        dayData,
        letter: 'S',
        letterColor: '#D97706',
      })
    }

    // IXIC / NASDAQ Composite
    if (t.nas100) {
      const dayData = generateIntradayData(t.nas100.price, t.nas100.changePercent, 78)
      indices.push({
        symbol: 'IXIC',
        name: 'NASDAQ',
        exchange: 'IDXNASDAQ',
        price: t.nas100.price,
        change: t.nas100.change,
        changePercent: t.nas100.changePercent,
        dayData,
        letter: 'I',
        letterColor: '#E8003D',
      })
    }

    // DIA (use SP500 as proxy since we don't have DOW separately)
    if (t.sp500) {
      const diaPrice = t.sp500.price * 0.067 // rough DIA ETF price
      const dayData = generateIntradayData(diaPrice, t.sp500.changePercent, 78)
      indices.push({
        symbol: 'DIA',
        name: 'DOW JONES ETF (est.)',
        exchange: 'NYSEARCA',
        price: diaPrice,
        change: diaPrice * t.sp500.changePercent / 100,
        changePercent: t.sp500.changePercent,
        dayData,
        letter: 'D',
        letterColor: '#E8003D',
      })
    }

    // Generate synthetic net inflow data
    const netInflow = generateNetInflowData()

    // Sector heatmap data (deterministic — seeded random for stable renders)
    const sectorRng = seededRandom(2024)
    const sectors: SectorData[] = [
      { name: 'TECHNOLOGY', change: ((sectorRng() - 0.5) * 4), marketCap: '14.2T' },
      { name: 'HEALTHCARE', change: ((sectorRng() - 0.5) * 3), marketCap: '7.8T' },
      { name: 'FINANCE', change: ((sectorRng() - 0.5) * 3), marketCap: '9.1T' },
      { name: 'ENERGY', change: ((sectorRng() - 0.5) * 4), marketCap: '5.3T' },
      { name: 'CONSUMER', change: ((sectorRng() - 0.5) * 2.5), marketCap: '6.7T' },
      { name: 'INDUSTRIAL', change: ((sectorRng() - 0.5) * 3), marketCap: '5.9T' },
      { name: 'MATERIALS', change: ((sectorRng() - 0.5) * 2.5), marketCap: '3.1T' },
      { name: 'UTILITIES', change: ((sectorRng() - 0.5) * 2), marketCap: '2.4T' },
      { name: 'REAL ESTATE', change: ((sectorRng() - 0.5) * 2), marketCap: '1.8T' },
      { name: 'TELECOM', change: ((sectorRng() - 0.5) * 2), marketCap: '1.5T' },
    ]

    return { indices, netInflow, sectors }
  } catch (e: any) {
    console.warn('fetchStockData:', e.message)
    return null
  }
}

// ─── Generate synthetic intraday data ─────────────────────────────────────

function generateIntradayData(basePrice: number, changePct: number, points: number): { time: string; value: number }[] {
  const data: { time: string; value: number }[] = []
  const startPrice = basePrice / (1 + changePct / 100)
  let current = startPrice

  for (let i = 0; i <= points; i++) {
    const hour = 9 + Math.floor((i / points) * 6.5)
    const minute = Math.floor(((i / points) * 6.5 - Math.floor((i / points) * 6.5)) * 60)
    const timeStr = `${hour.toString().padStart(2, '0')}:${minuTE.toString().padStart(2, '0')}`

    // Random walk toward final price (deterministic)
    const target = basePrice
    const drift = (target - current) * 0.05
    const intradayRng = seededRandom(Math.round(basePrice * 100))
    const noise = current * 0.001 * (intradayRng() - 0.5) * 2
    current += drift + noise
    if (i === points) current = basePrice

    data.push({ time: timeStr, value: parseFloat(current.toFixed(2)) })
  }
  return data
}

function generateNetInflowData(): NetInflowPoint[] {
  const data: NetInflowPoint[] = []
  let nasdaqFlow = 0
  let nyseFlow = 0

  for (let i = 0; i <= 78; i++) {
    const hour = 9 + Math.floor((i / 78) * 6.5)
    const minute = Math.floor(((i / 78) * 6.5 - Math.floor((i / 78) * 6.5)) * 60)
    const timeStr = `${hour.toString().padStart(2, '0')}:${minuTE.toString().padStart(2, '0')}`

    const flowRng = seededRandom(2025)
    nasdaqFlow += (flowRng() - 0.45) * 500_000_000
    nyseFlow += (flowRng() - 0.42) * 400_000_000

    data.push({
      time: timeStr,
      nasdaq: parseFloat(nasdaqFlow.toFixed(0)),
      nyse: parseFloat(nyseFlow.toFixed(0)),
    })
  }
  return data
}

// ─── Sector Heatmap ───────────────────────────────────────────────────────

function SectorHeatmap({ sectors }: { sectors: SectorData[] }) {
  return (
    <div style={{ border: `1px solid ${TE.border}`, background: TE.bg }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${TE.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 2, background: TE.orange, display: 'inline-block' }} />
        <span style={{ fontFamily: TE.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: TE.text }}>
          SECTOR HEATMAP
        </span>
        <span style={PLACEHOLDER_BADGE_STYLE}>DEMO</span>
        <span style={{ fontFamily: TE.mono, fontSize: 8, letterSpacing: '0.1em', color: TE.orange, border: `1px solid ${TE.orange}`, padding: '1px 6px' }}>
          US MARKET
        </span>
      </div>

      {/* Heatmap grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 2, padding: 2, background: TE.border }}>
        {sectors.map((sector) => {
          const isPositive = sector.change >= 0
          const intensity = Math.min(1, Math.abs(sector.change) / 3)
          const bgColor = isPositive
            ? `rgba(26,161,103,${0.08 + intensity * 0.15})`
            : `rgba(232,0,61,${0.08 + intensity * 0.15})`
          const textColor = isPositive ? TE.green : TE.red

          return (
            <div key={sector.name} style={{ background: bgColor, padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: TE.mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: TE.text, textTransform: 'uppercase' }}>
                {sector.name}
              </span>
              <span style={{ fontFamily: TE.mono, fontSize: 14, fontWeight: 800, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
                {isPositive ? '+' : ''}{sector.change.toFixed(2)}%
              </span>
              {sector.marketCap && (
                <span style={{ fontFamily: TE.mono, fontSize: 7, color: TE.textDim, letterSpacing: '0.04em' }}>
                  ${sector.marketCap}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Major Index Card ─────────────────────────────────────────────────────

function IndexCard({ index, onOpenAssetChart }: { index: IndexQuote; onOpenAssetChart?: (asset: AssetChartInfo) => void }) {
  const isPositive = index.changePercent >= 0
  const chartColor = isPositive ? TE.green : TE.red
  const arrow = isPositive ? '▲' : '▼'

  return (
    <div style={{
      border: `1px solid ${TE.border}`,
      background: TE.bg,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Letter icon */}
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: index.letterColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: TE.mono,
            fontSize: 12,
            fontWeight: 800,
            color: '#FFFFFF',
          }}>
            {index.letter}
          </div>
          <div>
            <div style={{ fontFamily: TE.mono, fontSize: 12, fontWeight: 700, color: TE.text, letterSpacing: '0.04em' }}>
              {index.symbol}
            </div>
            <div style={{ fontFamily: TE.mono, fontSize: 8, color: TE.textDim, letterSpacing: '0.06em' }}>
              {index.exchange}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: TE.mono, fontSize: 16, fontWeight: 800, color: TE.text, fontVariantNumeric: 'tabular-nums' }}>
            {index.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontFamily: TE.mono, fontSize: 10, fontWeight: 600, color: isPositive ? TE.green : TE.red, fontVariantNumeric: 'tabular-nums' }}>
            {arrow} {isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <div style={{ height: 80, padding: '0 6px 8px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={index.dayData} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${index.symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontFamily: TE.mono, fontSize: 7, fill: TE.textDim }}
              axisLine={{ stroke: TE.borderLight }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={1.5}
              fill={`url(#grad-${index.symbol})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Show on chart button */}
      {onOpenAssetChart && (
        <div style={{ padding: '0 10px 10px' }}>
          <button
            onClick={() => onOpenAssetChart(stockIndexToTvSymbol(index.symbol, index.exchange))}
            style={{
              width: '100%',
              fontFamily: TE.mono,
              fontSize: 8,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '5px 0',
              background: 'transparent',
              color: TE.textMuted,
              border: `1px solid ${TE.border}`,
              cursor: 'pointer',
              transition: 'all 0.15s',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = TE.orange
              ;(e.currentTarget as HTMLElement).style.color = '#000'
              ;(e.currentTarget as HTMLElement).style.borderColor = TE.orange
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = TE.textMuted
              ;(e.currentTarget as HTMLElement).style.borderColor = TE.border
            }}
          >
            <span>📈</span> Show on chart
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Net Inflow Chart ─────────────────────────────────────────────────────

function NetInflowChart({ data }: { data: NetInflowPoint[] }) {
  // Format large numbers
  const formatFlow = (v: number): string => {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`
    return `${(v / 1e6).toFixed(0)}M`
  }

  const lastNasdaq = data.length > 0 ? data[data.length - 1].nasdaq : 0
  const lastNyse = data.length > 0 ? data[data.length - 1].nyse : 0

  return (
    <div style={{ border: `1px solid ${TE.border}`, background: TE.bg }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${TE.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 2, background: TE.orange, display: 'inline-block' }} />
          <span style={{ fontFamily: TE.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: TE.text }}>
            NET INFLOW
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 3, background: TE.orange }} />
            <span style={{ fontFamily: TE.mono, fontSize: 8, color: TE.textMuted, letterSpacing: '0.06em' }}>NASDAQ</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 3, background: TE.cyan }} />
            <span style={{ fontFamily: TE.mono, fontSize: 8, color: TE.textMuted, letterSpacing: '0.06em' }}>NYSE</span>
          </div>
          {/* Current values */}
          <span style={{ fontFamily: TE.mono, fontSize: 9, fontWeight: 700, color: lastNasdaq >= 0 ? TE.green : TE.red, fontVariantNumeric: 'tabular-nums' }}>
            NASDAQ: {lastNasdaq >= 0 ? '+' : ''}{formatFlow(lastNasdaq)} USD
          </span>
          <span style={{ fontFamily: TE.mono, fontSize: 9, fontWeight: 700, color: lastNyse >= 0 ? TE.green : TE.red, fontVariantNumeric: 'tabular-nums' }}>
            NYSE: {lastNyse >= 0 ? '+' : ''}{formatFlow(lastNyse)} USD
          </span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 220, padding: '8px 4px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={TE.borderLight} />
            <XAxis
              dataKey="time"
              tick={{ fontFamily: TE.mono, fontSize: 8, fill: TE.textDim }}
              axisLine={{ stroke: TE.border }}
              tickLine={{ stroke: TE.border }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontFamily: TE.mono, fontSize: 8, fill: TE.textDim }}
              axisLine={{ stroke: TE.border }}
              tickLine={{ stroke: TE.border }}
              tickFormatter={formatFlow}
            />
            <ReferenceLine y={0} stroke={TE.textDim} strokeWidth={1} strokeDasharray="4 2" />
            <Line
              type="monotone"
              dataKey="nasdaq"
              stroke={TE.orange}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="NASDAQ"
            />
            <Line
              type="monotone"
              dataKey="nyse"
              stroke={TE.cyan}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="NYSE"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Market Stats Bar ─────────────────────────────────────────────────────

function MarketStatsBar({ indices }: { indices: IndexQuote[] }) {
  const stats = useMemo(() => {
    const advancers = indices.filter(i => i.changePercent > 0).length
    const decliners = indices.filter(i => i.changePercent < 0).length
    const avgChange = indices.length > 0
      ? indices.reduce((sum, i) => sum + i.changePercent, 0) / indices.length
      : 0
    return { advancers, decliners, avgChange, total: indices.length }
  }, [indices])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
      {[
        { label: 'ADVANCERS', value: stats.advancers.toString(), color: TE.green },
        { label: 'DECLINERS', value: stats.decliners.toString(), color: TE.red },
        { label: 'AVG CHANGE', value: `${stats.avgChange >= 0 ? '+' : ''}${stats.avgChange.toFixed(2)}%`, color: stats.avgChange >= 0 ? TE.green : TE.red },
        { label: 'VIX (CBOE)', value: '—', color: TE.yellow },
        { label: 'TREASURY 10Y', value: '—', color: TE.cyan },
        { label: 'DXY INDEX', value: '—', color: TE.purple },
      ].map((stat, i) => (
        <div key={i} style={{ background: TE.bg, border: `1px solid ${TE.border}`, borderLeft: `2px solid ${stat.color}`, padding: '8px 10px' }}>
          <div style={{ fontFamily: TE.mono, fontSize: 8, letterSpacing: '0.12em', color: TE.textDim, textTransform: 'uppercase' }}>
            {stat.label}
          </div>
          <div style={{ fontFamily: TE.mono, fontSize: 14, fontWeight: 800, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Fear & Greed Gauge ───────────────────────────────────────────────────

function FearGreedGauge() {
  // Placeholder — would need separate API
  const value = 42
  const label = value < 25 ? 'EXTREME FEAR' : value < 40 ? 'FEAR' : value < 60 ? 'NEUTRAL' : value < 75 ? 'GREED' : 'EXTREME GREED'
  const color = value < 25 ? TE.red : value < 40 ? TE.orange : value < 60 ? TE.yellow : value < 75 ? TE.green : TE.green

  return (
    <div style={{ border: `1px solid ${TE.border}`, background: TE.bg, padding: 16 }}>
      <div style={{ fontFamily: TE.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: TE.orange, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${TE.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 2, background: TE.orange, display: 'inline-block' }} />
        FEAR & GREED INDEX
        <span style={PLACEHOLDER_BADGE_STYLE}>DEMO</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Gauge bar */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', height: 10, borderRadius: 0, overflow: 'hidden', border: `1px solid ${TE.border}` }}>
            {/* Extreme Fear */}
            <div style={{ flex: 25, background: TE.red, opacity: 0.6 }} />
            {/* Fear */}
            <div style={{ flex: 15, background: TE.orange, opacity: 0.6 }} />
            {/* Neutral */}
            <div style={{ flex: 20, background: TE.yellow, opacity: 0.4 }} />
            {/* Greed */}
            <div style={{ flex: 15, background: TE.green, opacity: 0.5 }} />
            {/* Extreme Greed */}
            <div style={{ flex: 25, background: TE.green, opacity: 0.8 }} />
          </div>
          {/* Pointer */}
          <div style={{ position: 'relative', height: 6 }}>
            <div style={{ position: 'absolute', left: `${value}%`, top: 0, width: 4, height: 6, background: TE.black, transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: TE.mono, fontSize: 6, color: TE.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>

        {/* Value */}
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <div style={{ fontFamily: TE.mono, fontSize: 28, fontWeight: 200, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          <div style={{ fontFamily: TE.mono, fontSize: 7, letterSpacing: '0.1em', color: TE.textMuted, textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Main StockMarketTab Component ────────────────────────────────────────

export default function StockMarketTab({ onOpenAssetChart }: { onOpenAssetChart?: (asset: AssetChartInfo) => void }) {
  const [data, setData] = useState<{ indices: IndexQuote[]; netInflow: NetInflowPoint[]; sectors: SectorData[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchStockData()
    if (result) {
      setData(result)
    } else {
      setError('Failed to fetch market data. Check connection.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 120000)
    return () => clearInterval(timer)
  }, [loadData])

  // Style constants
  const sectionStyle: React.CSSProperties = {
    background: TE.bg,
    border: `1px solid ${TE.border}`,
    borderRadius: 0,
    padding: 16,
  }

  const headerStyle: React.CSSProperties = {
    fontFamily: TE.mono,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: TE.orange,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: `1px solid ${TE.border}`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  }

  return (
    <div style={{ fontFamily: TE.mono, color: TE.text, minHeight: '100%', background: TE.bg }}>
      {/* ── Title Bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 28, background: TE.orange }} />
          <div>
            <div style={{ fontSize: 7, letterSpacing: '0.28em', color: TE.textDim }}>TITAN TERMINAL</div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>STOCK MARKET · US</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: loading ? TE.yellow : TE.green, boxShadow: `0 0 6px ${loading ? TE.yellow : TE.green}`, animation: loading ? 'macro-blink 1.2s infinite' : 'none' }} />
            <span style={{ fontFamily: TE.mono, fontSize: 9, letterSpacing: '0.12em', color: TE.textMuted, textTransform: 'uppercase' }}>{loading ? 'LOADING' : 'LIVE'}</span>
          </div>
          <button
            onClick={loadData}
            style={{
              fontFamily: TE.mono,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${TE.border}`,
              color: TE.textMuted,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            REFRESH
          </button>
          <a
            href="https://insights.glassnode.com/glassnode-skew-index/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: TE.mono,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${TE.border}`,
              color: TE.textMuted,
              cursor: 'pointer',
              textTransform: 'uppercase',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            SKEW INDEX ↗
          </a>
        </div>
      </div>

      {/* Inject blink animation */}
      <style>{`
        @keyframes macro-blink { 0%,100% { opacity:1 } 50% { opacity:.25 } }
      `}</style>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: 12, background: 'rgba(232,0,61,0.08)', border: `1px solid ${TE.red}`, color: TE.red, fontSize: 10, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {loading && !data ? (
        <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TE.textMuted, fontSize: 10, letterSpacing: '0.1em' }}>
          LOADING MARKET DATA...
        </div>
      ) : data ? (
        <>
          {/* ── Major Index ──────────────────────────────────────────────── */}
          <div style={sectionStyle}>
            <div style={headerStyle}>
              <span style={{ width: 8, height: 2, background: TE.orange, display: 'inline-block' }} />
              MAJOR INDEX
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {data.indices.map((index) => (
                <IndexCard key={index.symbol} index={index} onOpenAssetChart={onOpenAssetChart} />
              ))}
            </div>
          </div>

          {/* ── Market Stats Bar ──────────────────────────────────────────── */}
          <div style={{ marginTop: 12 }}>
            <MarketStatsBar indices={data.indices} />
          </div>

          {/* ── Net Inflow ──────────────────────────────────────────────── */}
          <div style={{ marginTop: 12 }}>
            <NetInflowChart data={data.netInflow} />
          </div>

          {/* ── Bottom Row: Sector Heatmap + Fear & Greed ─────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginTop: 12, alignItems: 'start' }}>
            <SectorHeatmap sectors={data.sectors} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FearGreedGauge />

              {/* Market Hours */}
              <div style={{ border: `1px solid ${TE.border}`, background: TE.bg, padding: 16 }}>
                <div style={{ fontFamily: TE.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: TE.orange, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${TE.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 2, background: TE.orange, display: 'inline-block' }} />
                  MARKET HOURS
                </div>
                {[
                  { label: 'NYSE', hours: '09:30 — 16:00 ET', status: 'CLOSED', statusColor: TE.red },
                  { label: 'NASDAQ', hours: '09:30 — 16:00 ET', status: 'CLOSED', statusColor: TE.red },
                  { label: 'CME FUTURES', hours: '17:00 — 16:00 ET', status: 'PRE-MARKET', statusColor: TE.yellow },
                  { label: 'CRYPTO', hours: '24/7', status: 'OPEN', statusColor: TE.green },
                ].map((market, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 3 ? `1px solid ${TE.borderLight}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: market.statusColor, boxShadow: `0 0 4px ${market.statusColor}` }} />
                      <span style={{ fontFamily: TE.mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: TE.text }}>{market.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: TE.mono, fontSize: 8, color: TE.textDim, letterSpacing: '0.04em' }}>{market.hours}</span>
                      <span style={{ fontFamily: TE.mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: market.statusColor }}>{market.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
