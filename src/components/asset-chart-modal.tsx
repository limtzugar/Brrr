// @ts-nocheck — legacy file from previous session, needs refactoring
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── TE Design Tokens ────────────────────────────────────────────────────

import { useTE } from '@/lib/te-theme'

// ─── Chart Intervals ─────────────────────────────────────────────────────────

const CHART_INTERVALS = [
  { label: '1m', tv: '1' },
  { label: '5m', tv: '5' },
  { label: '15m', tv: '15' },
  { label: '30m', tv: '30' },
  { label: '1h', tv: '60' },
  { label: '4h', tv: '240' },
  { label: '1D', tv: 'D' },
] as const

// ─── Types ───────────────────────────────────────────────────────────────

export interface AssetChartInfo {
  /** TradingView symbol, e.g. "BINANCE:BTCUSDT", "SP:SPX", "NYMEX:CL1!" */
  tvSymbol: string
  /** Display name, e.g. "Bitcoin", "S&P 500" */
  name: string
  /** Short label, e.g. "BTC", "SPX" */
  symbol: string
  /** Asset type for styling context */
  type: 'crypto' | 'stock' | 'index' | 'commodity' | 'forex'
}

// ─── Symbol Mapping Helpers ──────────────────────────────────────────────

/** Map ticker-bar keys to TradingView symbols */
export function tickerKeyToTvSymbol(key: string): { tvSymbol: string; name: string; symbol: string; type: AssetChartInfo['type'] } | null {
  const map: Record<string, { tvSymbol: string; name: string; symbol: string; type: AssetChartInfo['type'] }> = {
    btc:      { tvSymbol: 'BINANCE:BTCUSDT', name: 'Bitcoin',  symbol: 'BTC', type: 'crypto' },
    eth:      { tvSymbol: 'BINANCE:ETHUSDT', name: 'Ethereum', symbol: 'ETH', type: 'crypto' },
    usdtPln:  { tvSymbol: 'FX:USDPLN',       name: 'USDT/PLN', symbol: 'USD/PLN', type: 'forex' },
    gold:     { tvSymbol: 'OANDA:XAUUSD',    name: 'Gold',     symbol: 'XAU', type: 'commodity' },
    silver:   { tvSymbol: 'OANDA:XAGUSD',    name: 'Silver',   symbol: 'XAG', type: 'commodity' },
    oil:      { tvSymbol: 'NYMEX:CL1!',      name: 'Crude Oil WTI', symbol: 'CL', type: 'commodity' },
    sp500:    { tvSymbol: 'SP:SPX',          name: 'S&P 500',  symbol: 'SPX', type: 'index' },
    nas100:   { tvSymbol: 'NASDAQ:NDX',      name: 'NASDAQ 100', symbol: 'NDX', type: 'index' },
  }
  return map[key] || null
}

/** Map crypto coin ticker (e.g. "BTC") to TradingView symbol */
export function cryptoTickerToTvSymbol(ticker: string): { tvSymbol: string; name: string; symbol: string; type: AssetChartInfo['type'] } {
  const upper = ticker.toUpperCase()
  const nameMap: Record<string, string> = {
    BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'Ripple',
    ADA: 'Cardano', DOGE: 'Dogecoin', DOT: 'Polkadot', AVAX: 'Avalanche',
    LINK: 'Chainlink', SHIB: 'Shiba Inu', LTC: 'Litecoin', UNI: 'Uniswap',
    XLM: 'Stellar', MATIC: 'Polygon', TRX: 'TRON', TON: 'Toncoin',
    NEAR: 'NEAR Protocol', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism',
    INJ: 'Injective', KAS: 'Kaspa', IMX: 'Immutable', MNT: 'Mantle',
    PEPE: 'Pepe', BONK: 'Bonk', RNDR: 'Render', FET: 'Fetch.ai',
    GRT: 'The Graph', AAVE: 'Aave', MKR: 'Maker', ALGO: 'Algorand',
    FIL: 'Filecoin', ATOM: 'Cosmos', VET: 'VeChain', XTZ: 'Tezos',
    ICP: 'Internet Computer', HBAR: 'Hedera', QNT: 'Quant', FTM: 'Fantom',
    EOS: 'EOS', SAND: 'The Sandbox', MANA: 'Decentraland', GALA: 'Gala',
    THETA: 'Theta', EGLD: 'MultiversX', ONE: 'Harmony', IOTX: 'IoTeX',
    ZIL: 'Zilliqa', CHZ: 'Chiliz', ENJ: 'Enjin', HOT: 'Holo', ANKR: 'Ankr',
    USDT: 'Tether', USDC: 'USD Coin', WBTC: 'Wrapped Bitcoin', LEO: 'LEO',
    XMR: 'Monero', OKB: 'OKB', CRO: 'Cronos', HYPE: 'Hyperliquid',
    SUI: 'Sui', TIA: 'Celestia', JUP: 'Jupiter',
    NOT: 'Notcoin', TRUMP: 'Official Trump', WLD: 'Worldcoin',
  }
  return {
    tvSymbol: `BINANCE:${upper}USDT`,
    name: nameMap[upper] || upper,
    symbol: upper,
    type: 'crypto',
  }
}

/** Map stock index symbol to TradingView symbol */
export function stockIndexToTvSymbol(symbol: string, exchange: string): { tvSymbol: string; name: string; symbol: string; type: AssetChartInfo['type'] } {
  const map: Record<string, { tvSymbol: string; name: string; symbol: string; type: AssetChartInfo['type'] }> = {
    SPX:    { tvSymbol: 'SP:SPX',        name: 'S&P 500',    symbol: 'SPX',    type: 'index' },
    IXIC:   { tvSymbol: 'NASDAQ:NDX',    name: 'NASDAQ 100', symbol: 'NDX',    type: 'index' },
    DIA:    { tvSymbol: 'NYSEARCA:DIA',  name: 'DOW JONES ETF', symbol: 'DIA', type: 'index' },
    'CL=F': { tvSymbol: 'NYMEX:CL1!',    name: 'Crude Oil WTI', symbol: 'CL', type: 'commodity' },
    'GC=F': { tvSymbol: 'OANDA:XAUUSD',  name: 'Gold',       symbol: 'XAU',   type: 'commodity' },
    'SI=F': { tvSymbol: 'OANDA:XAGUSD',  name: 'Silver',     symbol: 'XAG',   type: 'commodity' },
  }
  return map[symbol] || { tvSymbol: `${exchange}:${symbol}`, name: symbol, symbol, type: 'stock' }
}

// ─── Type badge colors ───────────────────────────────────────────────────

const TYPE_COLORS: Record<AssetChartInfo['type'], { bg: string; text: string; border: string }> = {
  crypto:     { bg: 'rgba(255,102,0,0.08)', text: '#FF6600', border: '#FF6600' },
  stock:      { bg: 'rgba(26,161,103,0.08)', text: '#1AA167', border: '#1AA167' },
  index:      { bg: 'rgba(59,130,246,0.08)', text: '#3B82F6', border: '#3B82F6' },
  commodity:  { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: '#D97706' },
  forex:      { bg: 'rgba(139,92,246,0.08)', text: '#8B5CF6', border: '#8B5CF6' },
}

// ─── AssetChartModal ─────────────────────────────────────────────────────

export default function AssetChartModal({ asset, open, onClose }: {
  asset: AssetChartInfo | null
  open: boolean
  onClose: () => void
}) {
  const te = useTE()
  const containerRef = useRef<HTMLDivElement>(null)
  const [widgetLoading, setWidgetLoading] = useState(false)
  const [containerId, setContainerId] = useState('tv-asset-chart-0')
  const _idCounter = useRef(0)
  const _widgetInstance = useRef<any>(null)
  const [selectedInterval, setSelectedInterval] = useState<string>('60')

  useEffect(() => {
    if (!open || !asset || !containerRef.current) return

    // Destroy old widget if exists
    if (_widgetInstance.current) {
      try {
        if (typeof _widgetInstance.current.remove === 'function') {
          _widgetInstance.current.remove()
        }
      } catch {}
      _widgetInstance.current = null
    }

    // Generate unique container ID
    const newId = `tv-asset-chart-${++_idCounter.current}`
    containerRef.current.id = newId
    setContainerId(newId)

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.getElementById(newId)
        if (!container) return

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
            script.onerror = () => setWidgetLoading(false)
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
              symbol: asset.tvSymbol,
              interval: selectedInterval,
              timezone: 'Europe/Warsaw',
              theme: 'light',
              style: '1',
              locale: 'pl',
              toolbar_bg: '#FFFFFF',
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
                'Volume@tv-basicstudies',
              ],
              overrides: {
                'mainSeriesProperties.candleStyle.upColor': '#1AA167',
                'mainSeriesProperties.candleStyle.downColor': '#E8003D',
                'mainSeriesProperties.candleStyle.borderUpColor': '#1AA167',
                'mainSeriesProperties.candleStyle.borderDownColor': '#E8003D',
                'mainSeriesProperties.candleStyle.wickUpColor': '#1AA167',
                'mainSeriesProperties.candleStyle.wickDownColor': '#E8003D',
                'PaneProperties.background': '#FFFFFF',
                'PaneProperties.backgroundType': 'solid',
                'PaneProperties.vertGridProperties.color': '#F0F0F0',
                'PaneProperties.horzGridProperties.color': '#F0F0F0',
                'scalesProperties.textColor': '#666666',
                'scalesProperties.backgroundColor': '#FFFFFF',
              },
              loading_screen: { backgroundColor: '#FFFFFF', foregroundColor: '#999999' },
            })
            _widgetInstance.current = widget
            setTimeout(() => setWidgetLoading(false), 1500)
          } catch {
            setWidgetLoading(false)
          }
        }

        loadAndInitWidget()
      })
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
  }, [open, asset, selectedInterval])

  const handleClose = useCallback(() => {
    const container = document.getElementById(containerId)
    if (container) container.innerHTML = ''
    onClose()
  }, [onClose, containerId])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleClose])

  if (!open || !asset) return null

  const typeStyle = TYPE_COLORS[asset.type]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        style={{
          background: te.bg,
          border: `1px solid ${te.border}`,
          width: '94vw',
          maxWidth: 1200,
          height: '85vh',
          maxHeight: 800,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: `1px solid ${te.border}`,
          background: te.surface,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Type badge */}
            <span style={{
              fontFamily: te.mono,
              fontSize: 7,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              background: typeStyle.bg,
              color: typeStyle.text,
              border: `1px solid ${typeStyle.border}`,
            }}>
              {asset.type}
            </span>
            {/* Symbol */}
            <span style={{
              fontFamily: te.mono,
              fontSize: 14,
              fontWeight: 800,
              color: te.text,
              letterSpacing: '0.04em',
            }}>
              {asset.symbol}
            </span>
            {/* Name */}
            <span style={{
              fontFamily: te.mono,
              fontSize: 9,
              color: te.textMuted,
              letterSpacing: '0.04em',
            }}>
              {asset.name}
            </span>
            {/* Interval selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {CHART_INTERVALS.map(ci => (
                <button
                  key={ci.tv}
                  onClick={() => setSelectedInterval(ci.tv)}
                  style={{
                    fontFamily: te.mono,
                    fontSize: 9,
                    fontWeight: selectedInterval === ci.tv ? 700 : 400,
                    letterSpacing: '0.06em',
                    padding: '2px 6px',
                    background: selectedInterval === ci.tv ? te.blue : 'transparent',
                    color: selectedInterval === ci.tv ? '#fff' : te.textDim,
                    border: `1px solid ${selectedInterval === ci.tv ? te.blue : te.border}`,
                    borderRadius: 2,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    lineHeight: 1.2,
                  }}
                >{ci.label}</button>
              ))}
            </div>
            {/* TV Symbol */}
            <span style={{
              fontFamily: te.mono,
              fontSize: 7,
              color: te.textDim,
              letterSpacing: '0.06em',
              background: te.bg,
              padding: '1px 5px',
              border: `1px solid ${te.borderLight}`,
            }}>
              {asset.tvSymbol}
            </span>
          </div>

          <button
            onClick={handleClose}
            style={{
              fontFamily: te.mono,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '4px 12px',
              background: 'transparent',
              color: te.textMuted,
              border: `1px solid ${te.border}`,
              cursor: 'pointer',
              transition: 'all 0.15s',
              lineHeight: 1,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = te.black
              ;(e.currentTarget as HTMLElement).style.color = te.bg
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = te.textMuted
            }}
          >
            ZAMKNIJ ✕
          </button>
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, position: 'relative', background: '#FFFFFF' }}>
          {widgetLoading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#FFFFFF',
              zIndex: 10,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 24,
                  height: 24,
                  border: `2px solid ${te.border}`,
                  borderTopColor: te.orange,
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontFamily: te.mono, fontSize: 8, letterSpacing: '0.1em', color: te.textDim, textTransform: 'uppercase' }}>
                  ŁADOWANIE WYKRESU…
                </span>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      {/* Spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
