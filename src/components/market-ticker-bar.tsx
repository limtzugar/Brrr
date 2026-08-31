// ─── Market Ticker Bar Component ───────────────────────────────────────────
// Displays real-time market prices: Gold, NASDAQ, Silver, WIG20, PLN/USD.
// Extracted from page.tsx to reduce monolith size.

'use client'

import { useState, useEffect, useCallback } from 'react'

interface MarketTicker {
  price: number
  change: number
  changePercent: number
  symbol: string
  name: string
}

function formatTickerPrice(key: string, t: MarketTicker): string {
  if (key === 'nasdaq') return t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (key === 'sp500') return t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (key === 'gold') return '$' + t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (key === 'silver') return '$' + t.price.toFixed(2)
  if (key === 'wig20') return t.price.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (key === 'plnUsd') return t.price.toFixed(4)
  return t.price.toFixed(2)
}

const TICKER_ORDER = ['gold', 'nasdaq', 'sp500', 'silver', 'wig20', 'plnUsd']

export default function MarketTickerBar() {
  const [tickers, setTickers] = useState<Record<string, MarketTicker>>({})
  const [loading, setLoading] = useState(true)

  const fetchTickers = useCallback(async () => {
    try {
      const res = await fetch('/api/market-ticker')
      if (res.ok) {
        const data = await res.json()
        if (data.tickers && Object.keys(data.tickers).length > 0) {
          setTickers(data.tickers)
        }
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTickers().catch(() => {})
    const interval = setInterval(() => fetchTickers().catch(() => {}), 120000) // Refresh every 2 min
    return () => clearInterval(interval)
  }, [fetchTickers])

  if (loading && Object.keys(tickers).length === 0) {
    return (
      <div className="border-b bg-muted/30 h-7 flex items-center px-4">
        <div className="flex items-center gap-6 text-[10px] text-muted-foreground animate-pulse">
          <span>Ładowanie kursów...</span>
        </div>
      </div>
    )
  }

  if (Object.keys(tickers).length === 0) return null

  return (
    <div className="border-b bg-muted/20 h-7 flex items-center overflow-hidden">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 flex items-center gap-5 overflow-x-auto scrollbar-none">
        {TICKER_ORDER.map(key => {
          const t = tickers[key]
          if (!t) return null
          const isPositive = t.change >= 0
          const changeColor = isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          const arrow = isPositive ? '▲' : '▼'
          return (
            <button
              key={key}
              className="flex items-center gap-1.5 whitespace-nowrap hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
              title={`${t.name}: ${formatTickerPrice(key, t)} (${isPositive ? '+' : ''}${t.changePercent.toFixed(2)}%)`}
            >
              <span className="text-[10px] font-semibold text-foreground">{t.symbol}</span>
              <span className="text-[10px] font-medium text-foreground">{formatTickerPrice(key, t)}</span>
              <span className={`text-[9px] font-medium ${changeColor}`}>
                {arrow} {isPositive ? '+' : ''}{t.changePercent.toFixed(2)}%
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
