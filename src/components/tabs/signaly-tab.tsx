'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Bell, Clock, Eye, Gauge, LayoutDashboard, Maximize2, RefreshCw,
  RotateCcw, Shield, SlidersHorizontal, Zap, Settings, Flame,
  AlertTriangle, DollarSign, ChevronDown, ChevronRight, X,
} from 'lucide-react'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import MiniChart from '@/components/mini-chart'
import InteractiveSparkline from '@/components/interactive-sparkline'
import SignalCard from '@/components/signal-card'
import CryptoChartDialog from '@/components/crypto-chart-dialog'
import {
  type DipSignal, type CoinData, type CryptoChartInfo, type CoinThresholds,
  type FearGreedResponse,
  formatPrice, formatPct, pctColor, sanitizeImageUrl,
  calculateConfidenceScore, fearGreedBg, fearGreedLabel,
  loadThresholds, saveThresholds, getCoinThreshold, DEFAULT_COIN_THRESHOLDS,
} from '@/lib/trading-shared'
import { useTE, useTheme } from '@/lib/te-theme'
import { PixelDigit } from '@/components/cex-anomaly/cex-anomaly-execution-clock'
import { COIN_TO_BINANCE } from '@/lib/binance'

// ─── Active cyan border (for highlighting bulk backtest panel when active) ──
const activeCyanBorder = (te: ReturnType<typeof useTE>, active: boolean) => active
  ? `1px solid ${te.cyan}88`
  : `1px solid ${te.border}`

// ─── TA Confirmation Info (RSI + MACD convergence) ────────────────────────────
interface TaConfirmInfo {
  rsi: number
  macdHist: number
  type: 'RSI_OVERSOLD' | 'MACD_BULL' | 'BOTH'
  fetchedAt: number
}


// ─── Spot Position Interface ─────────────────────────────────────────────────
interface SpotPosition {
  id: string
  coinId: string
  symbol: string        // e.g. 'BTC'
  name: string
  image: string
  entryPrice: number    // avg buy price
  currentPrice: number  // live price
  quantity: number      // amount of coins
  costUsd: number       // total spent in USDT (including fee)
  pnl: number           // unrealized PnL in USDT
  pnlPercent: number    // unrealized PnL %
  fee: number           // entry fee paid
  takeProfitPct: number // TP as % above entry (e.g. 5 = +5%)
  stopLossPct: number   // SL as % below entry (e.g. 3 = -3%)
  openedAt: number      // timestamp
  orderConfirmed: boolean
  orderId?: string
}

// ─── Closed Position (for transaction history) ──────────────────────────────
interface ClosedSpotPosition extends SpotPosition {
  closedAt: number
  closeReason: string   // e.g. 'TP +5%', 'SL -3%', 'MANUAL'
  closePrice: number
  realizedPnl: number   // final PnL in USDT
  realizedPnlPct: number // final PnL %
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function SignalyTab() {
  const te = useTE()
  const { theme } = useTheme()
  // theme is used to switch border highlight intensity in the bulk backtest panel
  void theme
  const [signals, setSignals] = useState<DipSignal[]>([])
  const [coins, setCoins] = useState<CoinData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [signalFilter, setSignalFilter] = useState<'all' | 'buy_signal' | 'alert' | 'watch'>('all')
  const [sortBy, setSortBy] = useState<'rank' | 'change_1h' | 'change_24h'>('rank')
  const [chartCrypto, setChartCrypto] = useState<CryptoChartInfo | null>(null)
  const [chartOpen, setChartOpen] = useState(false)

  const [fearGreedData, setFearGreedData] = useState<FearGreedResponse | null>(null)
  const [fearGreedLoading, setFearGreedLoading] = useState(false)

  const [thresholdsOpen, setThresholdsOpen] = useState(false)
  const [coinThresholds, setCoinThresholds] = useState<Record<string, CoinThresholds>>({})

  // ─── Wallet State ──────────────────────────────────────────────────────────
  const [walletBalance, setWalletBalance] = useState(1000)
  const [walletInput, setWalletInput] = useState('1000')
  const [spotTrading, setSpotTrading] = useState(false)       // PAPER mode
  const [binanceReal, setBinanceReal] = useState(false)       // REAL Binance mode
  const [spotPositions, setSpotPositions] = useState<SpotPosition[]>([])
  const [buyAmountPct, setBuyAmountPct] = useState(5)         // % of wallet per buy
  const [takeProfitPct, setTakeProfitPct] = useState(5)       // default TP %
  const [stopLossPct, setStopLossPct] = useState(3)           // default SL %
  const [walletSettingsOpen, setWalletSettingsOpen] = useState(true)
  const [binanceBalance, setBinanceBalance] = useState<number | null>(null)
  const [closedSpotPositions, setClosedSpotPositions] = useState<ClosedSpotPosition[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  // ─── Bulk Backtest State ───────────────────────────────────────────────────
  const [bulkBacktestOpen, setBulkBacktestOpen] = useState(false)
  const [bulkBacktestLoading, setBulkBacktestLoading] = useState(false)
  const [bulkBacktestError, setBulkBacktestError] = useState<string | null>(null)
  const [bulkBacktestResults, setBulkBacktestResults] = useState<Array<{
    coin_id: string
    symbol: string
    name: string
    image: string
    total_trades: number
    win_rate: number
    total_return_pct: number
    max_drawdown_pct: number
    profit_factor: number
    avg_net_profit_pct: number
    error?: string
  }>>([])
  const [bulkStrategy, setBulkStrategy] = useState<'dip_buying' | 'momentum' | 'mean_reversion' | 'breakout'>('dip_buying')
  const [bulkDays, setBulkDays] = useState<number>(180)
  const [bulkTakeProfitPct, setBulkTakeProfitPct] = useState<number>(5)
  const [bulkStopLossPct, setBulkStopLossPct] = useState<number>(3)
  const [bulkDipThreshold1h, setBulkDipThreshold1h] = useState<number>(-5)
  const [bulkDipThreshold24h, setBulkDipThreshold24h] = useState<number>(-10)

  // ─── TA Confirmations (RSI + MACD convergence per coin) ────────────────────
  const [taConfirmations, setTaConfirmations] = useState<Record<string, TaConfirmInfo>>({})
  const taConfirmationsRef = useRef<Record<string, TaConfirmInfo>>({})
  taConfirmationsRef.current = taConfirmations
  const taConfirmTickRef = useRef(0)

  // Track processed signal IDs to avoid duplicate buys
  const processedSignalsRef = useRef<Set<string>>(new Set())
  const [initialCapital, setInitialCapital] = useState(1000)

  // ─── Stable Refs for callbacks ──────────────────────────────────────────
  const coinsRef = useRef(coins)
  coinsRef.current = coins
  const signalsRef = useRef(signals)
  signalsRef.current = signals
  const spotPositionsRef = useRef(spotPositions)
  spotPositionsRef.current = spotPositions
  const spotTradingRef = useRef(spotTrading)
  spotTradingRef.current = spotTrading
  const binanceRealRef = useRef(binanceReal)
  binanceRealRef.current = binanceReal
  const walletBalanceRef = useRef(walletBalance)
  walletBalanceRef.current = walletBalance
  const buyAmountPctRef = useRef(buyAmountPct)
  buyAmountPctRef.current = buyAmountPct
  const takeProfitPctRef = useRef(takeProfitPct)
  takeProfitPctRef.current = takeProfitPct
  const stopLossPctRef = useRef(stopLossPct)
  stopLossPctRef.current = stopLossPct

  // Trigger counter — incremented in event handlers to re-run auto-buy effect
  const [botTrigger, setBotTrigger] = useState(0)

  const openChart = useCallback((coinId: string, symbol: string, name: string, image: string, currentPrice: number, priceChange24h: number | null) => {
    setChartCrypto({ coinId, symbol, name, image, currentPrice, priceChange24h })
    setChartOpen(true)
  }, [])

  const closeChart = useCallback(() => {
    setChartOpen(false)
    setTimeout(() => setChartCrypto(null), 300)
  }, [])

  // ─── Auto-Buy Logic ────────────────────────────────────────────────────────
  const handleAutoBuy = useCallback((signal: DipSignal) => {
    const curSpotTrading = spotTradingRef.current
    const curBinanceReal = binanceRealRef.current
    const curWallet = walletBalanceRef.current
    const curBuyPct = buyAmountPctRef.current
    const curPositions = spotPositionsRef.current
    const curTP = takeProfitPctRef.current
    const curSL = stopLossPctRef.current

    if (!curSpotTrading && !curBinanceReal) return
    if (signal.signal_type !== 'buy_signal') return
    // Avoid duplicate buys for the same signal
    const signalKey = `${signal.coin_id}_${signal.current_price.toFixed(2)}`
    if (processedSignalsRef.current.has(signalKey)) return
    processedSignalsRef.current.add(signalKey)
    // Prune old keys (keep max 200)
    if (processedSignalsRef.current.size > 200) {
      const arr = Array.from(processedSignalsRef.current)
      processedSignalsRef.current = new Set(arr.slice(-100))
    }

    const buyAmount = curWallet * (curBuyPct / 100)
    if (buyAmount < 5) {
      console.log(`[SPOT] Skip buy ${signal.symbol} — buyAmount $${buyAmount.toFixed(2)} < $5 minimum`)
      return
    }
    if (curWallet < buyAmount) {
      console.log(`[SPOT] Skip buy ${signal.symbol} — wallet $${curWallet.toFixed(2)} < buyAmount $${buyAmount.toFixed(2)}`)
      return
    }

    // Check if already have a position for this coin
    const existingPosition = curPositions.find(p => p.coinId === signal.coin_id)
    if (existingPosition) {
      console.log(`[SPOT] Skip buy ${signal.symbol} — already have position`)
      return
    }

    if (curBinanceReal) {
      // REAL Binance mode — call API
      console.log(`[SPOT REAL] Buying ${signal.symbol} for $${buyAmount.toFixed(2)}`)
      const binanceSymbol = COIN_TO_BINANCE[signal.coin_id] || signal.symbol.toUpperCase() + 'USDT'
      fetch('/api/binance/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'BUY',
          coinId: signal.coin_id,
          symbol: binanceSymbol,
          amountUsdt: buyAmount,
          mode: 'real',
        }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            const fee = buyAmount * 0.001
            const quantity = Number(data.quantity) || buyAmount / signal.current_price
            const avgPrice = Number(data.avgPrice) || signal.current_price
            const position: SpotPosition = {
              id: generateId(),
              coinId: signal.coin_id,
              symbol: signal.symbol.toUpperCase(),
              name: signal.name,
              image: signal.image,
              entryPrice: avgPrice,
              currentPrice: avgPrice,
              quantity,
              costUsd: buyAmount,
              pnl: 0,
              pnlPercent: 0,
              fee,
              takeProfitPct: curTP,
              stopLossPct: curSL,
              openedAt: Date.now(),
              orderConfirmed: true,
              orderId: data.orderId,
            }
            setSpotPositions(prev => [...prev, position])
            setWalletBalance(prev => prev - buyAmount)
            console.log(`[SPOT REAL] Buy confirmed: ${signal.symbol} qty=${quantity} @ $${avgPrice}`)
          } else {
            console.error(`[SPOT REAL] Buy failed: ${data.error}`)
          }
        })
        .catch(err => {
          console.error(`[SPOT REAL] Buy error:`, err)
        })
    } else {
      // PAPER mode — simulate
      const fee = buyAmount * 0.001
      const quantity = (buyAmount - fee) / signal.current_price
      const position: SpotPosition = {
        id: generateId(),
        coinId: signal.coin_id,
        symbol: signal.symbol.toUpperCase(),
        name: signal.name,
        image: signal.image,
        entryPrice: signal.current_price,
        currentPrice: signal.current_price,
        quantity,
        costUsd: buyAmount,
        pnl: 0,
        pnlPercent: 0,
        fee,
        takeProfitPct: curTP,
        stopLossPct: curSL,
        openedAt: Date.now(),
        orderConfirmed: true,
      }
      setSpotPositions(prev => [...prev, position])
      setWalletBalance(prev => prev - buyAmount)
      console.log(`[SPOT PAPER] Buy: ${signal.symbol} qty=${quantity.toFixed(6)} @ $${signal.current_price} fee=$${fee.toFixed(4)}`)
    }
  }, []) // fully stable — reads reactive state via refs

  // ─── Manual Sell ───────────────────────────────────────────────────────────
  const handleSell = useCallback((position: SpotPosition) => {
    if (binanceReal) {
      // REAL Binance mode — call API
      const binanceSymbol = COIN_TO_BINANCE[position.coinId] || position.symbol + 'USDT'
      console.log(`[SPOT REAL] Selling ${position.symbol} qty=${position.quantity}`)
      fetch('/api/binance/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SELL',
          symbol: binanceSymbol,
          quantity: position.quantity,
          mode: 'real',
        }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            const sellAmount = Number(data.amount) || (position.quantity * position.currentPrice)
            const sellFee = sellAmount * 0.001
            const netProceeds = sellAmount - sellFee
            const realizedPnl = netProceeds - position.costUsd
            const realizedPnlPct = position.costUsd > 0 ? (realizedPnl / position.costUsd) * 100 : 0
            // Save to transaction history
            setClosedSpotPositions(prev => [{
              ...position,
              closedAt: Date.now(),
              closeReason: 'MANUAL',
              closePrice: position.currentPrice,
              realizedPnl,
              realizedPnlPct,
            }, ...prev].slice(0, 50))
            setWalletBalance(prev => prev + sellAmount)
            setSpotPositions(prev => prev.filter(p => p.id !== position.id))
            console.log(`[SPOT REAL] Sell confirmed: ${position.symbol} for $${sellAmount.toFixed(2)}`)
          } else {
            console.error(`[SPOT REAL] Sell failed: ${data.error}`)
          }
        })
        .catch(err => {
          console.error(`[SPOT REAL] Sell error:`, err)
        })
    } else {
      // PAPER mode — simulate
      const sellValue = position.quantity * position.currentPrice
      const sellFee = sellValue * 0.001
      const netProceeds = sellValue - sellFee
      const realizedPnl = netProceeds - position.costUsd
      const realizedPnlPct = position.costUsd > 0 ? (realizedPnl / position.costUsd) * 100 : 0
      // Save to transaction history
      setClosedSpotPositions(prev => [{
        ...position,
        closedAt: Date.now(),
        closeReason: 'MANUAL',
        closePrice: position.currentPrice,
        realizedPnl,
        realizedPnlPct,
      }, ...prev].slice(0, 50))
      setWalletBalance(prev => prev + netProceeds)
      setSpotPositions(prev => prev.filter(p => p.id !== position.id))
      console.log(`[SPOT PAPER] Sell: ${position.symbol} qty=${position.quantity.toFixed(6)} @ $${position.currentPrice} proceeds=$${netProceeds.toFixed(2)} pnl=$${position.pnl.toFixed(2)}`)
    }
  }, [binanceReal])

  // ─── Update Position Prices + TP/SL Auto-Close ───────────────────────────────
  const updatePositionPrices = useCallback(() => {
    const currentCoins = coinsRef.current
    const currentPositions = spotPositionsRef.current
    const curBinanceReal = binanceRealRef.current
    if (currentPositions.length === 0 || currentCoins.length === 0) return

    const coinPriceMap = new Map<string, number>()
    for (const c of currentCoins) {
      coinPriceMap.set(c.id, c.current_price)
    }

    // Check TP/SL and auto-close
    const positionsToClose: string[] = []
    const closeReasons: Record<string, string> = {}

    for (const pos of currentPositions) {
      const livePrice = coinPriceMap.get(pos.coinId)
      if (livePrice === undefined) continue

      const tpPrice = pos.entryPrice * (1 + pos.takeProfitPct / 100)
      const slPrice = pos.entryPrice * (1 - pos.stopLossPct / 100)

      if (livePrice >= tpPrice) {
        positionsToClose.push(pos.id)
        closeReasons[pos.id] = `TP +${pos.takeProfitPct}%`
      } else if (livePrice <= slPrice) {
        positionsToClose.push(pos.id)
        closeReasons[pos.id] = `SL -${pos.stopLossPct}%`
      }
    }

    // Auto-close positions that hit TP/SL
    if (positionsToClose.length > 0) {
      const newClosed: ClosedSpotPosition[] = []
      for (const posId of positionsToClose) {
        const pos = currentPositions.find(p => p.id === posId)
        if (!pos) continue
        const livePrice = coinPriceMap.get(pos.coinId) || pos.currentPrice
        const reason = closeReasons[posId]

        if (curBinanceReal) {
          const binanceSymbol = COIN_TO_BINANCE[pos.coinId] || pos.symbol + 'USDT'
          fetch('/api/binance/spot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'SELL', symbol: binanceSymbol, quantity: pos.quantity, mode: 'real' }),
          }).then(r => r.json()).then(data => {
            if (data.success) {
              const sellAmount = Number(data.amount) || (pos.quantity * livePrice)
              const sellFee = sellAmount * 0.001
              const netProceeds = sellAmount - sellFee
              const realizedPnl = netProceeds - pos.costUsd
              const realizedPnlPct = pos.costUsd > 0 ? (realizedPnl / pos.costUsd) * 100 : 0
              setClosedSpotPositions(prev => [{
                ...pos,
                closedAt: Date.now(),
                closeReason: reason,
                closePrice: livePrice,
                realizedPnl,
                realizedPnlPct,
              }, ...prev].slice(0, 50))
              setWalletBalance(prev => prev + sellAmount)
              console.log(`[SPOT REAL] Auto-close ${pos.symbol} — ${reason} @ $${livePrice.toFixed(2)}`)
            } else {
              console.error(`[SPOT REAL] Auto-close sell failed: ${data.error}`)
            }
          }).catch(err => console.error(`[SPOT REAL] Auto-close error:`, err))
        } else {
          const sellValue = pos.quantity * livePrice
          const sellFee = sellValue * 0.001
          const netProceeds = sellValue - sellFee
          const realizedPnl = netProceeds - pos.costUsd
          const realizedPnlPct = pos.costUsd > 0 ? (realizedPnl / pos.costUsd) * 100 : 0
          newClosed.push({
            ...pos,
            closedAt: Date.now(),
            closeReason: reason,
            closePrice: livePrice,
            realizedPnl,
            realizedPnlPct,
          })
          setWalletBalance(prev => prev + netProceeds)
          console.log(`[SPOT PAPER] Auto-close ${pos.symbol} — ${reason} @ $${livePrice.toFixed(2)} proceeds=$${netProceeds.toFixed(2)}`)
        }
      }
      if (newClosed.length > 0) {
        setClosedSpotPositions(prev => [...newClosed, ...prev].slice(0, 50))
      }
      setSpotPositions(prev => prev.filter(p => !positionsToClose.includes(p.id)))
    }

    // Update prices for remaining positions
    setSpotPositions(prev => prev.map(pos => {
      const livePrice = coinPriceMap.get(pos.coinId)
      if (livePrice === undefined) return pos
      const newPnl = (livePrice - pos.entryPrice) * pos.quantity
      const newPnlPct = pos.entryPrice > 0 ? ((livePrice - pos.entryPrice) / pos.entryPrice) * 100 : 0
      return { ...pos, currentPrice: livePrice, pnl: newPnl, pnlPercent: newPnlPct }
    }))
  }, []) // fully stable — reads coins/spotPositions/binanceReal via refs

  // ─── Fetch Data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [signalsResult, coinsResult] = await Promise.allSettled([
      fetch('/api/signals').then(r => r.ok ? r.json() : Promise.reject('signals failed')),
      fetch('/api/coins').then(r => r.ok ? r.json() : Promise.reject('coins failed')),
    ])
    let signalsOk = false
    if (signalsResult.status === 'fulfilled') {
      const signalsData = signalsResult.value
      const signalsWithConf = (signalsData.signals || []).map((s: DipSignal) => ({
        ...s,
        confidence_score: s.confidence_score || calculateConfidenceScore(s),
      }))
      setSignals(signalsWithConf)
      setLastUpdated(signalsData.last_updated)
      signalsOk = true
    }
    if (coinsResult.status === 'fulfilled') {
      const coinsData = coinsResult.value
      setCoins(coinsData.coins || [])
      if (!signalsOk) setLastUpdated(coinsData.last_updated)
    }
    if (!signalsOk && coinsResult.status !== 'fulfilled') {
      setError('Błąd pobierania danych — sprawdź połączenie')
    }
    setLoading(false)
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

  useEffect(() => { try { setCoinThresholds(loadThresholds()) } catch {} }, [])
  useEffect(() => { fetchData().catch(() => {}) }, [fetchData])
  useEffect(() => { fetchFearGreed().catch(() => {}) }, [fetchFearGreed])

  useEffect(() => {
    const interval = setInterval(() => fetchData().catch(() => {}), 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Auto-buy effect — triggered by new signals or bot state change
  useEffect(() => {
    if (!spotTradingRef.current && !binanceRealRef.current) return
    if (signals.length === 0) return
    const buySignals = signals.filter(s => s.signal_type === 'buy_signal')
    if (buySignals.length === 0) return
    const timer = setTimeout(() => {
      for (const sig of buySignals) {
        handleAutoBuy(sig)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [signals, botTrigger, handleAutoBuy])

  // Update position prices when coins data changes
  useEffect(() => {
    if (spotPositions.length > 0) updatePositionPrices()
  }, [spotPositions.length, updatePositionPrices])

  // ─── Binance Balance Polling ───────────────────────────────────────────────
  useEffect(() => {
    if (!binanceReal) {
      setBinanceBalance(null)
      return
    }
    const fetchBalance = async () => {
      try {
        const res = await fetch('/api/binance/spot?mode=real')
        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setBinanceBalance(data.totalEquityUsdt)
          }
        }
      } catch {
        console.error('[SPOT] Balance fetch failed')
      }
    }
    fetchBalance()
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [binanceReal])

  // ─── TA Confirmations WS effect ─────────────────────────────────────────────
  // Every 30s, fetch RSI + MACD for the top 5 buy_signal coins (rate-limited API).
  // Computes convergence: RSI_OVERSOLD (RSI<35) + MACD_BULL (hist>0) → BOTH.
  useEffect(() => {
    let mounted = true
    const fetchTaConfirm = async () => {
      const buySignals = signalsRef.current.filter(s => s.signal_type === 'buy_signal').slice(0, 5)
      if (buySignals.length === 0) return
      // Process 2 coins per tick to stay under rate limit (10/min)
      const tick = taConfirmTickRef.current++
      const batch = buySignals.slice((tick * 2) % Math.max(1, buySignals.length), ((tick * 2) % Math.max(1, buySignals.length)) + 2)
      for (const sig of batch) {
        try {
          const url = `/api/indicators?coin_id=${encodeURIComponent(sig.coin_id)}&days=14&interval=hourly&indicators=rsi,macd`
          const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
          if (!res.ok) continue
          const data = await res.json()
          const rsiArr = data?.indicators?.rsi ?? []
          const macdArr = data?.indicators?.macd ?? []
          if (!Array.isArray(rsiArr) || rsiArr.length === 0) continue
          const lastRsi = rsiArr[rsiArr.length - 1]?.value
          const lastMacdHist = Array.isArray(macdArr) && macdArr.length > 0 ? macdArr[macdArr.length - 1]?.histogram : 0
          if (typeof lastRsi !== 'number') continue
          const rsiOversold = lastRsi < 35
          const macdBull = (typeof lastMacdHist === 'number') && lastMacdHist > 0
          const type: TaConfirmInfo['type'] = rsiOversold && macdBull ? 'BOTH' : rsiOversold ? 'RSI_OVERSOLD' : 'MACD_BULL'
          if (!mounted) return
          setTaConfirmations(prev => ({
            ...prev,
            [sig.coin_id]: { rsi: lastRsi, macdHist: typeof lastMacdHist === 'number' ? lastMacdHist : 0, type, fetchedAt: Date.now() },
          }))
        } catch {
          /* skip individual coin errors */
        }
      }
    }
    fetchTaConfirm()
    const interval = setInterval(fetchTaConfirm, 30_000)
    return () => { mounted = false; clearInterval(interval) }
  }, [signals.length])

  // ─── Bulk Backtest Callback ─────────────────────────────────────────────────
  const runBulkBacktest = useCallback(async () => {
    setBulkBacktestLoading(true)
    setBulkBacktestError(null)
    try {
      const coinIds = coinsRef.current.slice(0, 10).map(c => c.id)
      if (coinIds.length === 0) {
        setBulkBacktestError('Brak monet do backtestu')
        return
      }
      const body = {
        coin_ids: coinIds,
        days: bulkDays,
        strategy_type: bulkStrategy,
        dip_threshold_1h: bulkDipThreshold1h,
        dip_threshold_24h: bulkDipThreshold24h,
        take_profit_pct: bulkTakeProfitPct,
        stop_loss_pct: bulkStopLossPct,
        initial_capital: 1000,
        compound: true,
        max_holding_hours: 48,
        fee_pct: 0.1,
      }
      const res = await fetch('/api/backtest/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const results = (data.results ?? []).map((r: { coin_id: string; results: { total_trades: number; win_rate: number; total_return_pct: number; max_drawdown_pct: number; profit_factor: number; avg_net_profit_pct: number }; error?: string }) => {
        const coin = coinsRef.current.find(c => c.id === r.coin_id)
        return {
          coin_id: r.coin_id,
          symbol: coin?.symbol ?? r.coin_id,
          name: coin?.name ?? r.coin_id,
          image: coin?.image ?? '',
          total_trades: r.results?.total_trades ?? 0,
          win_rate: r.results?.win_rate ?? 0,
          total_return_pct: r.results?.total_return_pct ?? 0,
          max_drawdown_pct: r.results?.max_drawdown_pct ?? 0,
          profit_factor: r.results?.profit_factor ?? 0,
          avg_net_profit_pct: r.results?.avg_net_profit_pct ?? 0,
          error: r.error,
        }
      })
      setBulkBacktestResults(results)
    } catch (err) {
      setBulkBacktestError(err instanceof Error ? err.message : 'Backtest failed')
    } finally {
      setBulkBacktestLoading(false)
    }
  }, [bulkDays, bulkStrategy, bulkDipThreshold1h, bulkDipThreshold24h, bulkTakeProfitPct, bulkStopLossPct])

  // ─── Set initial capital from Binance balance on REAL activation ──────────
  useEffect(() => {
    if (binanceReal && binanceBalance !== null && binanceBalance > 0) {
      setWalletBalance(binanceBalance)
      setInitialCapital(binanceBalance)
      setWalletInput(binanceBalance.toFixed(2))
    }
  }, [binanceReal, binanceBalance])

  // ─── Wallet Stats ──────────────────────────────────────────────────────────
  const walletStats = useMemo(() => {
    const totalPnl = spotPositions.reduce((sum, p) => sum + p.pnl, 0)
    const totalFees = spotPositions.reduce((sum, p) => sum + p.fee, 0)
    const roi = initialCapital > 0 ? ((walletBalance + totalPnl) / initialCapital - 1) * 100 : 0
    return {
      balance: walletBalance,
      positions: spotPositions.length,
      unrealizedPnl: totalPnl,
      roi,
      fees: totalFees,
      initial: initialCapital,
    }
  }, [walletBalance, spotPositions, initialCapital])

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

  // Helper to format balance for PixelDigit
  const fmtBalance = (val: number) => {
    if (val >= 10000) return (val / 1000).toFixed(1) + 'K'
    if (val >= 1000) return val.toFixed(0)
    return val.toFixed(2)
  }

  return (
    <div className="space-y-4">
      {/* ═══ PAPER SPOT WALLET ═════════════════════════════════════════════════ */}
      <div className="rounded-sm p-2" style={{
        background: te.bgCard,
        border: `1px solid ${(spotTrading || binanceReal) ? (binanceReal ? '#f7a600' : te.green) : te.border}`,
        opacity: (spotTrading || binanceReal) ? 1 : 0.85,
      }}>
        {/* Header Row */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={() => setWalletSettingsOpen(o => !o)}
            className="flex items-center gap-1 cursor-pointer"
            style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
          >
            {walletSettingsOpen
              ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
              : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
            }
            <DollarSign className="size-3.5" style={{ color: (spotTrading || binanceReal) ? (binanceReal ? '#f7a600' : te.green) : te.textDim }} />
            <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
              WALLET
            </span>
          </button>
          {/* Paper mode badge */}
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-sm" style={{
            fontFamily: te.mono,
            background: '#f7a60015',
            color: '#f7a600',
            border: '1px solid #f7a60033',
          }}>
            PAPER ONLY
          </span>
          {/* PAPER button */}
          <button onClick={() => {
            if (spotTrading && !binanceReal) {
              // Stopping paper — update input
              setWalletInput(walletBalance.toFixed(2))
            }
            if (binanceReal) {
              // Can't have paper without real — turn real off first
              setBinanceReal(false)
            }
            setSpotTrading(!spotTrading)
            setBotTrigger(t => t + 1) // trigger auto-buy check after bot state changes
          }}
            className="flex items-center gap-1 px-3 py-1 rounded-sm text-[11px] font-bold transition-all"
            style={{
              fontFamily: te.mono,
              background: spotTrading && !binanceReal ? `${te.green}20` : `${te.green}10`,
              color: spotTrading && !binanceReal ? '#fff' : te.green,
              border: `1px solid ${spotTrading && !binanceReal ? te.green : `${te.green}33`}`,
              boxShadow: spotTrading && !binanceReal ? `0 0 8px ${te.green}44` : 'none',
            }}>
            {spotTrading && !binanceReal ? '● PAPER' : (spotTrading && binanceReal ? '● PAPER' : '○ PAPER')}
          </button>
          {/* Positions count */}
          {spotPositions.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
              fontFamily: te.mono, color: (spotTrading || binanceReal) ? te.green : te.textMuted,
              background: (spotTrading || binanceReal) ? `${te.green}15` : `${te.textMuted}10`,
            }}>
              {spotPositions.length} POS
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[12px]" style={{ fontFamily: te.mono, color: te.text }}>KAPITAŁ:</span>
            {/* REAL mode: show Binance balance (read-only) */}
            {binanceReal && binanceBalance !== null ? (
              <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-sm" style={{
                fontFamily: te.mono, color: '#f7a600',
                background: '#f7a60015', border: '1px solid #f7a60033',
              }}>
                ${binanceBalance.toFixed(2)}
              </span>
            ) : (
              <input
                type="text"
                value={(spotTrading || binanceReal) ? walletBalance.toFixed(2) : walletInput}
                disabled={spotTrading || binanceReal}
                onChange={e => setWalletInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(walletInput.replace(/[^\d.]/g, ''))
                  if (parsed > 0) {
                    setWalletBalance(parsed)
                    setInitialCapital(parsed)
                    setWalletInput(parsed.toFixed(2))
                    // Clear positions on capital change
                    setSpotPositions([])
                    processedSignalsRef.current.clear()
                  } else {
                    setWalletInput(String(walletBalance))
                  }
                }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="w-24 px-1.5 py-0.5 text-[11px] font-bold rounded-sm text-right"
                style={{
                  fontFamily: te.mono, color: te.text,
                  background: te.bgInput, border: `1px solid ${te.border}`,
                  outline: 'none', opacity: (spotTrading || binanceReal) ? 0.5 : 1,
                }}
              />
            )}
          </div>
        </div>

        {/* Collapsible Wallet Content */}
        {walletSettingsOpen && (<>
          {/* Stats Grid — 5 columns: BALANCE | POSITIONS | UNRL P/L | ROI | FEES */}
          <div className="grid grid-cols-5 gap-2 mb-2">
            {/* BALANCE */}
            <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
              <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>BALANCE</div>
              <div className="flex items-center">
                <span className="text-[11px] font-bold mr-0.5" style={{ fontFamily: te.mono, color: walletStats.balance >= walletStats.initial ? te.green : te.red }}>$</span>
                <PixelDigit
                  chars={fmtBalance(walletStats.balance)}
                  color={walletStats.balance >= walletStats.initial ? te.green : te.red}
                  size={3}
                />
              </div>
            </div>
            {/* POSITIONS */}
            <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
              <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>POSITIONS</div>
              <PixelDigit
                chars={String(walletStats.positions)}
                color={walletStats.positions > 0 ? te.orange : te.textDim}
                size={3}
              />
            </div>
            {/* UNRL P/L */}
            <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${walletStats.unrealizedPnl >= 0 ? `${te.green}22` : `${te.red}22`}` }}>
              <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>UNRL P/L</div>
              <PixelDigit
                chars={`${walletStats.unrealizedPnl >= 0 ? '+' : '-'}${Math.abs(walletStats.unrealizedPnl).toFixed(2)}`}
                color={walletStats.unrealizedPnl >= 0 ? te.green : te.red}
                size={3}
              />
            </div>
            {/* ROI */}
            <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
              <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>ROI</div>
              <PixelDigit
                chars={`${walletStats.roi >= 0 ? '+' : '-'}${Math.abs(walletStats.roi).toFixed(1)}%`}
                color={walletStats.roi >= 0 ? te.green : te.red}
                size={3}
              />
            </div>
            {/* FEES */}
            <div className="p-2 rounded-sm flex flex-col items-center" style={{ background: te.bgInput, border: `1px solid ${te.border}` }}>
              <div className="text-[8px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.1em' }}>FEES</div>
              <PixelDigit
                chars={`$${walletStats.fees.toFixed(2)}`}
                color={te.textDim}
                size={3}
              />
            </div>
          </div>

          {/* Buy Amount Row */}
          <div className="flex items-center gap-3 mb-2 px-1">
            <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.textMuted, letterSpacing: '0.08em' }}>ZAKUP:</span>
            <input
              type="range"
              min={1}
              max={20}
              value={buyAmountPct}
              onChange={e => setBuyAmountPct(Number(e.target.value))}
              className="signaly-slider flex-1 cursor-pointer"
              style={{ accentColor: te.orange }}
            />
            <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.orange }}>
              {buyAmountPct}%
            </span>
            <span className="text-[10px]" style={{ fontFamily: te.mono, color: te.textDim }}>
              ${(walletBalance * buyAmountPct / 100).toFixed(2)} per trade
            </span>
          </div>

          {/* TP / SL Settings Row */}
          <div className="flex items-center gap-3 mb-2 px-1">
            {/* TP */}
            <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.green, letterSpacing: '0.08em' }}>TP:</span>
            <input
              type="range"
              min={1}
              max={50}
              step={0.5}
              value={takeProfitPct}
              onChange={e => setTakeProfitPct(Number(e.target.value))}
              className="signaly-slider flex-1 cursor-pointer"
              style={{ accentColor: te.green }}
            />
            <span className="text-[11px] font-bold min-w-[40px] text-right" style={{ fontFamily: te.mono, color: te.green }}>
              +{takeProfitPct}%
            </span>
            {/* SL */}
            <span className="text-[11px] font-bold ml-2" style={{ fontFamily: te.mono, color: te.red, letterSpacing: '0.08em' }}>SL:</span>
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={stopLossPct}
              onChange={e => setStopLossPct(Number(e.target.value))}
              className="signaly-slider flex-1 cursor-pointer"
              style={{ accentColor: te.red }}
            />
            <span className="text-[11px] font-bold min-w-[40px] text-right" style={{ fontFamily: te.mono, color: te.red }}>
              -{stopLossPct}%
            </span>
          </div>

          {/* Position List */}
          {spotPositions.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${te.border} transparent` }}>
              {spotPositions.map(pos => (
                <div key={pos.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{
                  background: te.bgInput,
                  border: `1px solid ${pos.pnl >= 0 ? `${te.green}22` : `${te.red}22`}`,
                }}>
                  <img src={sanitizeImageUrl(pos.image)} alt={pos.symbol} className="size-5 rounded-full shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>{pos.symbol}</span>
                      {pos.orderConfirmed && (
                        <span className="text-[7px] px-1 rounded-sm" style={{ fontFamily: te.mono, color: te.green, background: `${te.green}15` }}>CONF</span>
                      )}
                      {binanceReal && (
                        <span className="text-[7px] px-1 rounded-sm" style={{ fontFamily: te.mono, color: '#f7a600', background: '#f7a60015' }}>REAL</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                      <span>Entry: ${pos.entryPrice.toFixed(pos.entryPrice < 1 ? 6 : 2)}</span>
                      <span>Now: ${pos.currentPrice.toFixed(pos.currentPrice < 1 ? 6 : 2)}</span>
                      <span style={{ color: te.green }}>TP: ${(pos.entryPrice * (1 + pos.takeProfitPct / 100)).toFixed(pos.entryPrice < 1 ? 6 : 2)}</span>
                      <span style={{ color: te.red }}>SL: ${(pos.entryPrice * (1 - pos.stopLossPct / 100)).toFixed(pos.entryPrice < 1 ? 6 : 2)}</span>
                      <span>Qty: {pos.quantity.toFixed(pos.quantity < 1 ? 6 : 4)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-bold" style={{ fontFamily: te.mono, color: pos.pnl >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums' }}>
                      {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                    </div>
                    <div className="text-[9px]" style={{ fontFamily: te.mono, color: pos.pnlPercent >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums' }}>
                      {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                    </div>
                  </div>
                  <button
                    onClick={() => handleSell(pos)}
                    className="shrink-0 px-2 py-1 rounded-sm text-[10px] font-bold transition-all"
                    style={{
                      fontFamily: te.mono,
                      background: `${te.red}20`,
                      color: te.red,
                      border: `1px solid ${te.red}44`,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = `${te.red}40`
                      e.currentTarget.style.borderColor = te.red
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = `${te.red}20`
                      e.currentTarget.style.borderColor = `${te.red}44`
                    }}
                  >
                    SELL
                  </button>
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>

      {/* ═══ TRANSACTION HISTORY ═══════════════════════════════════════════════ */}
      <div className="rounded-sm p-2" style={{
        background: te.bgCard,
        border: `1px solid ${closedSpotPositions.length > 0 ? te.border : `${te.border}66`}`,
        opacity: closedSpotPositions.length > 0 ? 1 : 0.7,
      }}>
        <button
          onClick={() => setHistoryOpen(o => !o)}
          className="flex items-center gap-1 cursor-pointer w-full"
          style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
        >
          {historyOpen
            ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} />
            : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
          }
          <Clock className="size-3.5" style={{ color: closedSpotPositions.length > 0 ? te.cyan : te.textDim }} />
          <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
            HISTORIA TRANSAKCJI
          </span>
          {closedSpotPositions.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
              fontFamily: te.mono, color: te.cyan,
              background: `${te.cyan}15`, border: `1px solid ${te.cyan}33`,
            }}>
              {closedSpotPositions.length}
            </span>
          )}
          {closedSpotPositions.length > 0 && (
            <span className="ml-2 text-[10px] font-bold" style={{
              fontFamily: te.mono,
              color: closedSpotPositions.reduce((sum, p) => sum + p.realizedPnl, 0) >= 0 ? te.green : te.red,
            }}>
              Total: {closedSpotPositions.reduce((sum, p) => sum + p.realizedPnl, 0) >= 0 ? '+' : ''}${closedSpotPositions.reduce((sum, p) => sum + p.realizedPnl, 0).toFixed(2)}
            </span>
          )}
        </button>

        {historyOpen && (
          <div className="mt-2">
            {closedSpotPositions.length === 0 ? (
              <div className="text-[10px] text-center py-3" style={{ color: te.textDim, fontFamily: te.mono }}>
                Brak zamkniętych transakcji — pozycje zamkną się automatycznie przy TP/SL lub ręcznie przez SELL
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${te.border} transparent` }}>
                {closedSpotPositions.map(pos => {
                  const isTP = pos.closeReason.startsWith('TP')
                  const isSL = pos.closeReason.startsWith('SL')
                  const reasonColor = isTP ? te.green : isSL ? te.red : te.textDim
                  const duration = pos.closedAt - pos.openedAt
                  const durationStr = duration < 60000 ? `${Math.floor(duration / 1000)}s` : duration < 3600000 ? `${Math.floor(duration / 60000)}m` : `${Math.floor(duration / 3600000)}h ${Math.floor((duration % 3600000) / 60000)}m`
                  return (
                    <div key={pos.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{
                      background: te.bgInput,
                      border: `1px solid ${pos.realizedPnl >= 0 ? `${te.green}15` : `${te.red}15`}`,
                    }}>
                      <img src={sanitizeImageUrl(pos.image)} alt={pos.symbol} className="size-4 rounded-full shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>{pos.symbol}</span>
                          <span className="text-[7px] px-1 rounded-sm font-bold" style={{
                            fontFamily: te.mono, color: reasonColor,
                            background: isTP ? `${te.green}15` : isSL ? `${te.red}15` : `${te.textDim}10`,
                          }}>{pos.closeReason}</span>
                          {binanceReal && pos.orderConfirmed && (
                            <span className="text-[7px] px-1 rounded-sm" style={{ fontFamily: te.mono, color: '#f7a600', background: '#f7a60015' }}>REAL</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>
                          <span>Entry: ${pos.entryPrice.toFixed(pos.entryPrice < 1 ? 6 : 2)}</span>
                          <span>Exit: ${pos.closePrice.toFixed(pos.closePrice < 1 ? 6 : 2)}</span>
                          <span>Qty: {pos.quantity.toFixed(pos.quantity < 1 ? 6 : 4)}</span>
                          <span>Czas: {durationStr}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold" style={{ fontFamily: te.mono, color: pos.realizedPnl >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums' }}>
                          {pos.realizedPnl >= 0 ? '+' : ''}{pos.realizedPnl.toFixed(2)}
                        </div>
                        <div className="text-[8px]" style={{ fontFamily: te.mono, color: pos.realizedPnlPct >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums' }}>
                          {pos.realizedPnlPct >= 0 ? '+' : ''}{pos.realizedPnlPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
          <AlertTriangle className="size-3.5" style={{ color: te.yellow }} />
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
            <SlidersHorizontal className="size-3.5" /> Progi
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs" style={{ color: te.textMuted }}>
              <Clock className="size-3 inline mr-1" />
              {new Date(lastUpdated).toLocaleTimeString('pl-PL')}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`size-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Odśwież
          </Button>
        </div>
      </div>

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
            <ScrollArea className="max-h-[300px]">
              <Card style={teCardStyle}>
                <CardContent className="p-0">
                  <div className="divide-y" style={{ borderColor: te.border }}>
                    {filteredSignals.map((signal) => (
                      <SignalCard
                        key={signal.coin_id}
                        signal={signal}
                        onOpenChart={openChart}
                        fearGreedValue={currentFG ?? undefined}
                        hasCustomThreshold={!!coinThresholds[signal.coin_id]}
                        taConfirmed={taConfirmations[signal.coin_id] ?? null}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </ScrollArea>
          )}
        </div>

        <div>
          <h3 style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted, marginBottom: 12 }}>Top 10 Spadków 24h</h3>
          <div className="rounded border overflow-hidden" style={{ borderColor: te.border, background: te.bgCard }}>
            <ScrollArea className="max-h-[300px]">
              <div className="divide-y" style={{ borderColor: te.border }}>
                {topLosers.map((coin) => (
                  <button
                    key={coin.id}
                    className="flex items-center gap-2 px-3 py-1.5 transition-colors w-full text-left group"
                    onMouseEnter={(e) => (e.currentTarget.style.background = te.bgCardHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => openChart(coin.id, coin.symbol, coin.name, coin.image, coin.current_price, coin.price_change_percentage_24h)}
                  >
                    <img src={sanitizeImageUrl(coin.image)} alt={coin.symbol} className="size-5 rounded-full" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium truncate" style={{ color: te.text }}>{coin.symbol.toUpperCase()}</span>
                        <span className="text-[10px]" style={{ color: te.textMuted }}>#{coin.market_cap_rank}</span>
                      </div>
                      <div className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(coin.current_price)}</div>
                    </div>
                    <InteractiveSparkline data={coin.sparkline_7d} isPositive={(coin.price_change_percentage_24h ?? 0) >= 0} width={60} height={28} />
                    <div className="text-right">
                      <div className="text-xs font-medium" style={{ color: (coin.price_change_percentage_24h ?? 0) >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{formatPct(coin.price_change_percentage_24h)}</div>
                      <div className="text-[10px]" style={{ color: (coin.price_change_percentage_1h ?? 0) >= 0 ? te.green : te.red }}>1h {formatPct(coin.price_change_percentage_1h)}</div>
                    </div>
                    <Maximize2 className="size-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ color: te.textMuted }} />
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      {/* Per-Coin Threshold Customizer Dialog */}
      <Dialog open={thresholdsOpen} onOpenChange={setThresholdsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-5" /> Progi alertów per-moneta
            </DialogTitle>
            <DialogDescription>
              Dostosuj progi RSI, spadku 24h i mnożnika wolumenu dla każdej monitorowanej monety. Niestandardowe progi są oznaczone ikoną ⚙️ na karcie sygnału.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="flex gap-2 mb-2">
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => {
                const newThresholds: Record<string, CoinThresholds> = {}
                coins.forEach(c => { newThresholds[c.id] = { ...DEFAULT_COIN_THRESHOLDS } })
                setCoinThresholds(newThresholds)
                saveThresholds(newThresholds)
              }}>
                <Settings className="size-3" /> Zastosuj domyślne dla wszystkich
              </Button>
            </div>
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {coins.slice(0, 50).map(coin => {
                  const thresholds = getCoinThreshold(coin.id, coinThresholds)
                  const isCustom = !!coinThresholds[coin.id]
                  return (
                    <div key={coin.id} className="flex items-center gap-3 p-2 rounded" style={isCustom ? { background: `${te.orange}0a`, border: `1px solid ${te.orange}33` } : { background: `${te.bgInput}55` }}>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <img src={sanitizeImageUrl(coin.image)} alt={coin.symbol} className="size-5 rounded-full" />
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

      {/* ═══ BULK BACKTEST PANEL ═════════════════════════════════════════════ */}
      <div className="rounded-sm p-2" style={{
        background: te.bgCard,
        border: activeCyanBorder(te, bulkBacktestOpen),
      }}>
        <button
          onClick={() => setBulkBacktestOpen(o => !o)}
          className="flex items-center gap-1 cursor-pointer w-full"
          style={{ background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
        >
          {bulkBacktestOpen
            ? <ChevronDown className="size-3.5" style={{ color: te.cyan }} />
            : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />
          }
          <Gauge className="size-3.5" style={{ color: te.cyan }} />
          <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.text, letterSpacing: '0.1em' }}>
            BULK BACKTEST
          </span>
          {bulkBacktestResults.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{
              fontFamily: te.mono, color: te.cyan,
              background: `${te.cyan}15`, border: `1px solid ${te.cyan}33`,
            }}>
              {bulkBacktestResults.length}
            </span>
          )}
          <span className="ml-2 text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>
            Top 10 coins · {bulkStrategy} · {bulkDays}d
          </span>
        </button>

        {bulkBacktestOpen && (
          <div className="mt-2 space-y-2">
            {/* Strategy + params row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={bulkStrategy} onValueChange={(v) => setBulkStrategy(v as typeof bulkStrategy)}>
                <SelectTrigger className="w-[140px] h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dip_buying">Dip Buying</SelectItem>
                  <SelectItem value="momentum">Momentum</SelectItem>
                  <SelectItem value="mean_reversion">Mean Reversion</SelectItem>
                  <SelectItem value="breakout">Breakout</SelectItem>
                </SelectContent>
              </Select>
              {/* Days */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.textDim }}>DAYS</span>
                <input type="number" value={bulkDays} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 30 && v <= 730) setBulkDays(v) }}
                  className="w-14 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                  style={{ fontFamily: te.mono, color: te.cyan, background: te.bgInput, border: `1px solid ${te.border}` }} />
              </div>
              {/* TP */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.green }}>TP</span>
                <input type="number" value={bulkTakeProfitPct} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 100) setBulkTakeProfitPct(v) }}
                  step={0.5} className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                  style={{ fontFamily: te.mono, color: te.green, background: te.bgInput, border: `1px solid ${te.border}` }} />
                <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>%</span>
              </div>
              {/* SL */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.red }}>SL</span>
                <input type="number" value={bulkStopLossPct} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 100) setBulkStopLossPct(v) }}
                  step={0.5} className="w-12 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                  style={{ fontFamily: te.mono, color: te.red, background: te.bgInput, border: `1px solid ${te.border}` }} />
                <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>%</span>
              </div>
              {/* Dip thresholds (only for dip_buying) */}
              {bulkStrategy === 'dip_buying' && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.orange }}>1H</span>
                    <input type="number" value={bulkDipThreshold1h} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v <= 0) setBulkDipThreshold1h(v) }}
                      step={0.5} className="w-14 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                      style={{ fontFamily: te.mono, color: te.orange, background: te.bgInput, border: `1px solid ${te.border}` }} />
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: te.orange }}>24H</span>
                    <input type="number" value={bulkDipThreshold24h} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v <= 0) setBulkDipThreshold24h(v) }}
                      step={0.5} className="w-14 text-[10px] font-bold px-1 py-0.5 rounded-sm outline-none text-center"
                      style={{ fontFamily: te.mono, color: te.orange, background: te.bgInput, border: `1px solid ${te.border}` }} />
                    <span className="text-[8px]" style={{ fontFamily: te.mono, color: te.textDim }}>%</span>
                  </div>
                </>
              )}
              <Button
                onClick={() => void runBulkBacktest()}
                disabled={bulkBacktestLoading}
                size="sm"
                className="h-7 text-[10px] gap-1 ml-auto"
              >
                {bulkBacktestLoading ? <RefreshCw className="size-3 animate-spin" /> : <Zap className="size-3" />}
                {bulkBacktestLoading ? 'RUNNING...' : 'RUN BACKTEST'}
              </Button>
            </div>

            {/* Error */}
            {bulkBacktestError && (
              <div className="text-[10px] px-2 py-1 rounded-sm" style={{ color: te.red, background: `${te.red}15`, border: `1px solid ${te.red}33`, fontFamily: te.mono }}>
                ⚠ {bulkBacktestError}
              </div>
            )}

            {/* Results table */}
            {bulkBacktestResults.length > 0 && (
              <div className="space-y-0.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                <div className="grid grid-cols-[1fr_60px_60px_70px_70px_60px] gap-1 px-2 py-0.5 text-[8px] font-bold" style={{ fontFamily: te.mono, color: te.textDim, letterSpacing: '0.04em', borderBottom: `1px solid ${te.border}` }}>
                  <span>COIN</span>
                  <span className="text-right">TRADES</span>
                  <span className="text-right">WR%</span>
                  <span className="text-right">RET%</span>
                  <span className="text-right">DD%</span>
                  <span className="text-right">PF</span>
                </div>
                {bulkBacktestResults.map(r => (
                  <div key={r.coin_id} className="grid grid-cols-[1fr_60px_60px_70px_70px_60px] gap-1 px-2 py-0.5 items-center text-[10px]" style={{ fontFamily: te.mono, background: te.bgInput, border: `1px solid ${te.border}` }}>
                    <div className="flex items-center gap-1 min-w-0">
                      {r.image && <img src={sanitizeImageUrl(r.image)} alt={r.symbol} className="size-3 rounded-full" />}
                      <span className="font-bold truncate" style={{ color: te.text }}>{r.symbol.toUpperCase()}</span>
                    </div>
                    <span className="text-right" style={{ color: te.textDim }}>{r.error ? '—' : r.total_trades}</span>
                    <span className="text-right" style={{ color: r.error ? te.textDim : (r.win_rate >= 50 ? te.green : te.red) }}>
                      {r.error ? '—' : `${r.win_rate.toFixed(0)}%`}
                    </span>
                    <span className="text-right font-bold" style={{ color: r.error ? te.textDim : (r.total_return_pct >= 0 ? te.green : te.red) }}>
                      {r.error ? 'ERR' : `${r.total_return_pct >= 0 ? '+' : ''}${r.total_return_pct.toFixed(1)}%`}
                    </span>
                    <span className="text-right" style={{ color: te.red }}>{r.error ? '—' : `${r.max_drawdown_pct.toFixed(1)}%`}</span>
                    <span className="text-right" style={{ color: r.error ? te.textDim : (r.profit_factor >= 1 ? te.green : te.red) }}>
                      {r.error ? '—' : r.profit_factor.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
