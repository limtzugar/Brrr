'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ErrorBoundary } from '@/components/error-boundary'
import MarketTickerBar from '@/components/market-ticker-bar'
import SettingsPanel from '@/components/settings-panel'
import SignalyTab from '@/components/tabs/signaly-tab'
import StrategiesTab from '@/components/tabs/strategie-tab'
import BacktestTab from '@/components/tabs/backtest-tab'
import TradeHistoryTab from '@/components/tabs/trade-history-tab'

import CexAnomalyTab from '@/components/tabs/cex-anomaly-tab'
import HurstTab from '@/components/tabs/hurst-tab'
import LlmAnalystTab from '@/components/tabs/llm-analyst-tab'
import { PixelDigit } from '@/components/cex-anomaly/cex-anomaly-execution-clock'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import {
  Bell, Brain,
  Network, Play, RefreshCw, Scan, Settings, Target, Wallet, Zap,
  PanelLeftClose, PanelLeftOpen, Power, Sun, Moon, Activity, Sparkles,
} from 'lucide-react'
import { type ActiveStrategyInfo, type CapitalData } from '@/lib/trading-shared'
import { TE, useTE, useTheme } from '@/lib/te-theme'

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function Home() {
  const te = useTE()
  const { theme, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState('cexanomaly')
  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategyInfo[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)

  // Capital state
  const [capital, setCapital] = useState<CapitalData>({
    mode: 'demo', totalEquityUsdt: 0, coins: [],
    lastUpdated: null, error: null, loading: false,
  })
  const [apiConfigured, setApiConfigured] = useState<'demo' | 'real' | 'both' | null>(null)
  const [activeMode, setActiveMode] = useState<'demo' | 'real'>('demo')
  const activeExchange = 'bybit' as const
  const [capitalExpanded, setCapitalExpanded] = useState(false)
  const [apiKilled, setApiKilled] = useState(false)

  // Fetch active strategies
  const fetchActiveStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/strategies/status')
      if (res.ok) { const data = await res.json(); setActiveStrategies(data.strategies || []) }
    } catch {}
  }, [])

  // Check API config
  const checkApiConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/exchange')
      if (res.ok) {
        const data = await res.json()
        const exchanges: Array<{ exchange: string; mode: string; isConfigured: boolean }> = data.exchanges || []
        const byExchange = exchanges.filter(e => e.exchange === 'bybit')
        const demoOk = byExchange.some(e => e.mode === 'demo' && e.isConfigured)
        const realOk = byExchange.some(e => e.mode === 'real' && e.isConfigured)

        setApiConfigured(demoOk && realOk ? 'both' : demoOk ? 'demo' : realOk ? 'real' : null)
        if (!demoOk && realOk) setActiveMode('real')
      }
    } catch {}
  }, [])

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    if (!apiConfigured || apiKilled) return
    setCapital(prev => ({ ...prev, loading: true }))
    try {
      const res = await fetch(`/api/bybit/balance?mode=${activeMode}`)
      if (res.ok) {
        const data = await res.json()
        setCapital({ mode: activeMode, totalEquityUsdt: data.totalEquityUsdt || 0, coins: data.coins || [], lastUpdated: data.lastUpdated, error: null, loading: false })
      } else {
        const data = await res.json()
        setCapital(prev => ({ ...prev, error: data.error || 'Błąd pobierania salda', loading: false }))
      }
    } catch { setCapital(prev => ({ ...prev, error: 'Błąd połączenia', loading: false })) }
  }, [apiConfigured, activeMode, apiKilled])

  useEffect(() => { void checkApiConfig() }, [checkApiConfig])
  useEffect(() => {
    if (apiConfigured) { void fetchBalance(); const interval = setInterval(() => void fetchBalance(), 30000); return () => clearInterval(interval) }
  }, [apiConfigured, fetchBalance])
  useEffect(() => { void fetchActiveStrategies(); const interval = setInterval(() => void fetchActiveStrategies(), 30000); return () => clearInterval(interval) }, [fetchActiveStrategies])
  useEffect(() => { if (!settingsOpen) { void checkApiConfig(); if (apiConfigured) void fetchBalance() } }, [settingsOpen, checkApiConfig, apiConfigured, fetchBalance])

  const runningCount = activeStrategies.filter(s => s.status === 'running').length
  const usdtCoin = capital.coins.find(c => c.coin === 'USDT')
  const nonUsdtCoins = capital.coins.filter(c => c.coin !== 'USDT' && Number(c.equity) > 0)

  type TabDef = { value: string; icon: React.ComponentType<{ className?: string }>; label: string }
  type TabGroup = { label: string; tabs: TabDef[] }

  const tabGroups: TabGroup[] = [
    {
      label: 'TRADE',
      tabs: [
        { value: 'signals', icon: Bell, label: 'Sygnały' },
        { value: 'hurst', icon: Activity, label: 'Hurst' },
        { value: 'strategies', icon: Target, label: 'Strategie' },
        { value: 'backtest', icon: Brain, label: 'Backtest' },
        { value: 'history', icon: Wallet, label: 'Historia' },
        { value: 'cexanomaly', icon: Scan, label: 'CEX Anomaly' },
        { value: 'llm', icon: Sparkles, label: 'LLM Analyst' },
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-background" style={{ background: te.bg }}>
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="border-b sticky top-0 z-50"
        style={{
          background: te.bgCard,
          borderColor: te.border,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
          {/* Left: Logo — pixel diagonal up arrow */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center size-8 rounded"
              style={{ background: '#0d0d0d', border: `1px solid ${te.border}` }}
            >
              {/* Pixel arrow diagonal up — 5×5 grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 4px)', gridTemplateRows: 'repeat(5, 4px)', gap: '1px' }}>
                {[
                  [0,0,0,0,1],
                  [0,0,0,1,0],
                  [1,0,1,0,0],
                  [0,1,0,0,0],
                  [0,0,0,0,0],
                ].flatMap((row, ri) => row.map((on, ci) => (
                  <div key={`${ri}-${ci}`} style={{ width: 4, height: 4, background: on ? te.green : `${te.green}10` }} />
                )))}
              </div>
            </div>
            <div className="hidden sm:block">
              <h1
                className="text-sm font-bold tracking-tight leading-tight"
                style={{ color: te.text, fontFamily: te.mono }}
              >
                BRRR
              </h1>
            </div>
          </div>

          {/* Center: Capital */}
          <div className="flex items-center gap-2">
            {runningCount > 0 && (
              <span
                className="te-badge"
                style={{ background: te.greenBg, color: te.green, border: `1px solid ${te.green}33` }}
              >
                <Play className="size-2.5" />{runningCount}
              </span>
            )}

            {apiConfigured ? (
              <button
                className="flex items-center gap-2 rounded px-2 py-1 transition-colors"
                style={{ background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = te.bgCardHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => setCapitalExpanded(!capitalExpanded)}
              >
                <span
                  className="te-badge"
                  style={{
                    background: te.orange + '1a',
                    color: te.orange,
                    border: `1px solid ${te.orange}33`,
                  }}
                >
                  BYBIT
                </span>

                {/* Mode Badge */}
                {apiConfigured === 'both' ? (
                  <div className="flex items-center rounded p-0.5" style={{ background: te.bgInput }}>
                    <span role="button" tabIndex={0} className="px-1.5 py-0 te-badge" style={activeMode === 'demo' ? { background: te.blue, color: '#fff' } : { color: te.textMuted }} onClick={e => { e.stopPropagation(); setActiveMode('demo') }}>DEMO</span>
                    <span role="button" tabIndex={0} className="px-1.5 py-0 te-badge" style={activeMode === 'real' ? { background: te.red, color: '#fff' } : { color: te.textMuted }} onClick={e => { e.stopPropagation(); setActiveMode('real') }}>REAL</span>
                  </div>
                ) : apiConfigured === 'demo' ? (
                  <span className="te-badge" style={{ background: te.blueBg, color: te.blue, border: `1px solid ${te.blue}33` }}>DEMO</span>
                ) : (
                  <span className="te-badge" style={{ background: te.redBg, color: te.red, border: `1px solid ${te.red}33` }}>REAL</span>
                )}

                {capital.error ? (
                  <span className="text-[10px] max-w-[120px] truncate" style={{ color: te.red }} title={capital.error}>
                    {capital.error.includes('sign') || capital.error.includes('10004') ? 'Błąd podpisu' : capital.error}
                  </span>
                ) : (
                  <>
                    <Wallet className="size-3" style={{ color: te.textMuted }} />
                    <span className="text-[13px] font-bold mr-0.5" style={{ fontFamily: te.mono, color: capital.totalEquityUsdt > 0 ? te.green : te.red }}>$</span>
                    <PixelDigit
                      chars={`${capital.totalEquityUsdt >= 10000 ? (capital.totalEquityUsdt / 1000).toFixed(1) + 'K' : capital.totalEquityUsdt >= 1000 ? (capital.totalEquityUsdt / 1000).toFixed(2) + 'K' : capital.totalEquityUsdt.toFixed(2)}`}
                      color={capital.totalEquityUsdt > 0 ? te.green : te.red}
                      size={4}
                    />
                    {capital.coins.length > 0 && (
                      <svg width="64" height="20" className="ml-1" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                        {(() => {
                          // Generate sparkline from capital history or simulated data
                          const points = Array.from({ length: 30 }, (_, i) => {
                            const base = capital.totalEquityUsdt
                            const variance = base * 0.02
                            return base + (Math.sin(i * 0.5) * variance) + (Math.random() - 0.5) * variance * 0.5
                          })
                          const min = Math.min(...points)
                          const max = Math.max(...points)
                          const range = max - min || 1
                          const isUp = points[points.length - 1] >= points[0]
                          const color = isUp ? te.green : te.red
                          const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * 64},${20 - ((p - min) / range) * 18}`).join(' ')
                          const areaD = pathD + ` L64,20 L0,20 Z`
                          return <>
                            <path d={areaD} fill={color} opacity={0.1} />
                            <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
                          </>
                        })()}
                      </svg>
                    )}
                    {usdtCoin && (<span className="hidden sm:inline text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono }}>USDT: {Number(usdtCoin.walletBalance).toFixed(0)}</span>)}
                    {nonUsdtCoins.length > 0 && (
                      <span className="text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                        {nonUsdtCoins.length} coins {capitalExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </>
                )}

                <span
                  role="button"
                  tabIndex={0}
                  className="size-5 flex items-center justify-center rounded cursor-pointer"
                  style={{ color: te.textMuted }}
                  onClick={e => { e.stopPropagation(); fetchBalance() }}
                >
                  <RefreshCw className={`size-2.5 ${capital.loading ? 'animate-spin' : ''}`} />
                </span>
                {/* Kill API button — disconnects private API in emergency */}
                <span
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer"
                  style={{
                    fontFamily: te.mono,
                    color: apiKilled ? te.red : te.textDim,
                    background: apiKilled ? `${te.red}20` : 'transparent',
                    border: `1px solid ${apiKilled ? te.red : te.border}`,
                    letterSpacing: '0.05em',
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    if (!apiKilled) {
                      setApiKilled(true)
                      setCapital(prev => ({ ...prev, totalEquityUsdt: 0, coins: [], error: 'API KILLED', loading: false }))
                    } else {
                      setApiKilled(false)
                      setCapital(prev => ({ ...prev, error: null, loading: true }))
                      void fetchBalance()
                    }
                  }}
                  onMouseEnter={e => { if (!apiKilled) e.currentTarget.style.borderColor = te.red }}
                  onMouseLeave={e => { if (!apiKilled) e.currentTarget.style.borderColor = te.border }}
                  title={apiKilled ? 'API disconnected — click to reconnect' : 'KILL API — emergency disconnect'}
                >
                  <Power className="size-2.5" />
                  {apiKilled ? 'KILLED' : 'KILL'}
                </span>
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] transition-colors"
                style={{
                  background: te.orange + '1a',
                  color: te.orange,
                  border: `1px solid ${te.orange}44`,
                  fontFamily: te.mono,
                }}
                onClick={() => setSettingsOpen(true)}
                onMouseEnter={e => { e.currentTarget.style.background = te.orange + '33' }}
                onMouseLeave={e => { e.currentTarget.style.background = te.orange + '1a' }}
              >
                <Settings className="size-3" />
                Setup API
              </button>
            )}
          </div>

          {/* Right: Live + Theme Toggle + Settings */}
          <div className="flex items-center gap-2">
            <span className="te-badge" style={{ color: te.green, border: `1px solid ${te.green}44` }}>
              <span className="size-1.5 rounded-full animate-pulse" style={{ background: te.green }} />
              LIVE
            </span>
            {/* Theme toggle */}
            <button
              className="size-7 flex items-center justify-center rounded border transition-colors"
              style={{ borderColor: te.border, color: te.textMuted, background: te.bgCard }}
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onMouseEnter={e => { e.currentTarget.style.borderColor = te.borderLight; e.currentTarget.style.color = te.text }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = te.border; e.currentTarget.style.color = te.textMuted }}
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <button
                  className="size-7 flex items-center justify-center rounded border transition-colors"
                  style={{ borderColor: te.border, color: te.textMuted, background: te.bgCard }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = te.borderLight; e.currentTarget.style.color = te.text }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = te.border; e.currentTarget.style.color = te.textMuted }}
                >
                  <Settings className="size-3.5" />
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" style={{ background: te.bgCard, borderColor: te.border }}>
                <DialogHeader className="sr-only">
                  <DialogTitle><VisuallyHidden.Root>Ustawienia API — Bybit</VisuallyHidden.Root></DialogTitle>
                </DialogHeader>
                <SettingsPanel onClose={() => setSettingsOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Expanded: coin balances */}
        {capitalExpanded && nonUsdtCoins.length > 0 && (
          <div className="border-t" style={{ borderColor: te.border, background: te.bgCard + 'cc' }}>
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {nonUsdtCoins.map(coin => (
                <div key={coin.coin} className="flex items-center justify-between rounded px-2 py-1" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
                  <span className="te-badge" style={{ color: te.text }}>{coin.coin}</span>
                  <span className="te-mono text-[10px]" style={{ color: te.textMuted }}>{Number(coin.equity).toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Market Ticker Bar */}
      <MarketTickerBar />

      {/* ─── Main Content — Sidebar + Content ─────────────────────────────── */}
      <div className="flex min-h-[calc(100vh-52px)]">
        {/* Left Sidebar Navigation — collapsible with arrow toggle */}
        <nav
          className="shrink-0 border-r flex flex-col py-2 sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto overflow-x-hidden transition-[width] duration-200 ease-in-out"
          style={{
            background: te.bg, borderColor: te.border,
            width: navCollapsed ? 44 : undefined,
          }}
        >
          {/* Header row: NAVIGATION label + collapse toggle */}
          <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b" style={{ borderColor: te.border }}>
            {!navCollapsed && (
              <span className="te-badge" style={{ color: te.textDim, letterSpacing: '0.12em' }}>
                NAVIGATION
              </span>
            )}
            <button
              onClick={() => setNavCollapsed(c => !c)}
              className="flex items-center justify-center size-6 rounded-sm transition-colors ml-auto"
              style={{
                background: 'transparent',
                border: `1px solid ${te.border}`,
                color: te.textMuted,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = te.bgCardHover; e.currentTarget.style.color = te.text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = te.textMuted }}
              title={navCollapsed ? 'Rozwiń menu' : 'Zwiń menu'}
            >
              {navCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </button>
          </div>

          {tabGroups.map((group, gi) => (
            <div key={group.label}>
              {/* Group separator + label */}
              {gi > 0 && (
                <div className="mx-2 my-1" style={{ borderTop: `1px solid ${te.border}` }} />
              )}
              {!navCollapsed && (
                <div className="px-3 py-1">
                  <span className="text-[8px] font-bold tracking-[0.14em]" style={{ color: te.textDim, fontFamily: te.mono }}>
                    {group.label}
                  </span>
                </div>
              )}
              {/* Group tabs */}
              {group.tabs.map(tab => {
                const isActiveTab = activeTab === tab.value
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className="flex items-center gap-2.5 py-2 text-sm transition-all relative w-full"
                    style={{
                      color: isActiveTab ? te.orange : te.textMuted,
                      background: isActiveTab ? te.orange + '0d' : 'transparent',
                      borderRight: isActiveTab ? `2px solid ${te.orange}` : '2px solid transparent',
                      fontFamily: te.mono,
                      fontSize: '11px',
                      letterSpacing: '0.02em',
                      paddingLeft: navCollapsed ? undefined : 12,
                      paddingRight: navCollapsed ? undefined : 16,
                      justifyContent: navCollapsed ? 'center' : undefined,
                    }}
                    title={navCollapsed ? tab.label : undefined}
                    onMouseEnter={e => {
                      if (!isActiveTab) {
                        e.currentTarget.style.background = te.bgCardHover
                        e.currentTarget.style.color = te.text
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActiveTab) {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = te.textMuted
                      }
                    }}
                  >
                    <tab.icon className="size-4 shrink-0" />
                    {!navCollapsed && <span>{tab.label}</span>}
                    {isActiveTab && !navCollapsed && (
                      <span className="ml-auto size-1 rounded-full" style={{ background: te.orange }} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          {/* TE Footer */}
          <div className="mt-auto pt-4 px-3 border-t" style={{ borderColor: te.border }}>
            {!navCollapsed && (
              <div>
                <p className="te-badge" style={{ color: te.textDim, letterSpacing: '0.12em' }}>
                  BRRR v2.0
                </p>
                <p className="text-[8px] mt-1" style={{ color: te.textDim, fontFamily: te.mono }}>
                  TE DESIGN SYSTEM
                </p>
              </div>
            )}
          </div>
        </nav>

        {/* Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6" style={{ background: te.bg }}>
          {activeTab === 'signals' && <ErrorBoundary><SignalyTab /></ErrorBoundary>}
          {activeTab === 'strategies' && <ErrorBoundary><StrategiesTab activeStrategies={activeStrategies} onStrategyChange={fetchActiveStrategies} /></ErrorBoundary>}
          {activeTab === 'backtest' && <ErrorBoundary><BacktestTab /></ErrorBoundary>}
          {activeTab === 'history' && <ErrorBoundary><TradeHistoryTab /></ErrorBoundary>}
          {activeTab === 'cexanomaly' && <ErrorBoundary><CexAnomalyTab /></ErrorBoundary>}
          {activeTab === 'hurst' && <ErrorBoundary><HurstTab /></ErrorBoundary>}
          {activeTab === 'llm' && <ErrorBoundary><LlmAnalystTab /></ErrorBoundary>}

        </main>
      </div>
    </div>
  )
}
