'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ArrowDown, ArrowUp, CircleStop, DollarSign, FlaskConical, Play, RefreshCw, Shield, Target,
  ShoppingCart, Zap, Tag, Wallet, ClipboardList, XCircle, BookOpen, Flame, TrendingUp, TrendingDown,
} from 'lucide-react'
import { type ActiveStrategyInfo, COIN_OPTIONS, strategyTypeBadge, strategyTypeLabel } from '@/lib/crypto-shared'
import { TE, useTE } from '@/lib/te-theme'
import type { BinanceOpenOrder, OrderBookEntry } from '@/lib/binance'

// ─── Buy Panel Coin Options (mapped to short IDs for Binance) ──────────────

const BUY_COINS = [
  { id: 'btc', label: 'BTC', name: 'Bitcoin' },
  { id: 'eth', label: 'ETH', name: 'Ethereum' },
  { id: 'sol', label: 'SOL', name: 'Solana' },
  { id: 'bnb', label: 'BNB', name: 'BNB' },
  { id: 'xrp', label: 'XRP', name: 'XRP' },
  { id: 'ada', label: 'ADA', name: 'Cardano' },
  { id: 'doge', label: 'DOGE', name: 'Dogecoin' },
  { id: 'dot', label: 'DOT', name: 'Polkadot' },
  { id: 'avax', label: 'AVAX', name: 'Avalanche' },
  { id: 'link', label: 'LINK', name: 'Chainlink' },
  { id: 'ltc', label: 'LTC', name: 'Litecoin' },
  { id: 'uni', label: 'UNI', name: 'Uniswap' },
  { id: 'atom', label: 'ATOM', name: 'Cosmos' },
  { id: 'near', label: 'NEAR', name: 'NEAR' },
  { id: 'apt', label: 'APT', name: 'Aptos' },
  { id: 'arb', label: 'ARB', name: 'Arbitrum' },
  { id: 'op', label: 'OP', name: 'Optimism' },
  { id: 'sui', label: 'SUI', name: 'Sui' },
  { id: 'pepe', label: 'PEPE', name: 'Pepe' },
  { id: 'shib', label: 'SHIB', name: 'Shiba Inu' },
  { id: 'trump', label: 'TRUMP', name: 'Official Trump' },
  { id: 'wld', label: 'WLD', name: 'Worldcoin' },
]

// ─── Buy Panel Component ────────────────────────────────────────────────────

function BuyPanel() {
  const te = useTE()
  const [selectedCoin, setSelectedCoin] = useState('btc')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [amountUsdc, setAmountUsdc] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [limitQty, setLimitQty] = useState('')
  const [mode, setMode] = useState<'demo' | 'real'>('real')
  const [loading, setLoading] = useState(false)
  const [fetchingInfo, setFetchingInfo] = useState(false)
  const [usdcAvailable, setUsdcAvailable] = useState<number | null>(null)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [orderResult, setOrderResult] = useState<any>(null)
  const [orderError, setOrderError] = useState<string | null>(null)

  const coinInfo = BUY_COINS.find(c => c.id === selectedCoin)

  const fetchTradeInfo = useCallback(async () => {
    setFetchingInfo(true)
    try {
      const res = await fetch(`/api/trade/info?coinId=${selectedCoin}&mode=${mode}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.warn('[BuyPanel] Info fetch error:', data.error)
        setUsdcAvailable(null)
        setCurrentPrice(null)
        return
      }
      const data = await res.json()
      setUsdcAvailable(data.usdcAvailable)
      setCurrentPrice(data.currentPrice)
      if (data.currentPrice > 0 && orderType === 'limit' && !limitPrice) {
        setLimitPrice(data.currentPrice.toFixed(data.currentPrice < 1 ? 6 : data.currentPrice < 100 ? 4 : 2))
      }
    } catch {
      setUsdcAvailable(null)
      setCurrentPrice(null)
    } finally {
      setFetchingInfo(false)
    }
  }, [selectedCoin, mode])

  useEffect(() => {
    void fetchTradeInfo()
  }, [fetchTradeInfo])

  const limitTotal = limitPrice && limitQty ? (Number(limitQty) * Number(limitPrice)).toFixed(2) : '0.00'

  const handleBuy = async () => {
    setLoading(true)
    setOrderError(null)
    setOrderResult(null)
    try {
      const body: Record<string, unknown> = {
        coinId: selectedCoin,
        mode,
        orderType,
      }
      if (orderType === 'market') {
        body.amountUsdc = Number(amountUsdc)
      } else {
        body.quantity = Number(limitQty)
        body.price = Number(limitPrice)
      }
      const res = await fetch('/api/trade/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setOrderError(data.error || 'Failed to place order')
      } else {
        setOrderResult(data)
        void fetchTradeInfo()
      }
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Connection error')
    } finally {
      setLoading(false)
    }
  }

  const presetAmounts = [10, 25, 50, 100, 500]

  return (
    <Card style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="size-4" style={{ color: te.orange }} />
            <CardTitle className="text-sm font-medium" style={{ color: te.text }}>Kup za USDC</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            {usdcAvailable !== null && (
              <div className="flex items-center gap-1 rounded-sm px-2 py-0.5" style={{ background: `${te.bgInput}80`, border: `1px solid ${te.border}`, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                <Wallet className="size-2.5" style={{ color: te.cyan }} />
                <span className="text-[10px] font-medium" style={{ color: te.cyan }}>{usdcAvailable.toFixed(2)}</span>
                <span className="text-[8px]" style={{ color: te.textMuted }}>USDC</span>
              </div>
            )}
            <Button variant="ghost" size="icon" className="size-6" onClick={fetchTradeInfo} disabled={fetchingInfo}>
              <RefreshCw className={`size-3 ${fetchingInfo ? 'animate-spin' : ''}`} style={{ color: te.textMuted }} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        <div>
          <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>KRYPTOWALUTA</Label>
          <Select value={selectedCoin} onValueChange={setSelectedCoin}>
            <SelectTrigger className="h-8 mt-1" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
              {BUY_COINS.map(c => (
                <SelectItem key={c.id} value={c.id} style={{ color: te.text }}>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold" style={{ fontFamily: te.mono }}>{c.label}</span>
                    <span className="text-[10px]" style={{ color: te.textMuted }}>{c.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {currentPrice !== null && currentPrice > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>CENA:</span>
            <span className="text-[12px] font-semibold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
              ${currentPrice < 1 ? currentPrice.toFixed(6) : currentPrice < 100 ? currentPrice.toFixed(4) : currentPrice < 10000 ? currentPrice.toFixed(2) : currentPrice.toFixed(0)}
            </span>
            <span className="text-[9px]" style={{ color: te.textMuted }}>{coinInfo?.label}/USDC</span>
          </div>
        )}

        <div>
          <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>TYP ZLECENIA</Label>
          <div className="flex gap-1 mt-1">
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-[10px] gap-1 rounded-sm" style={orderType === 'market' ? { background: te.orange, color: '#000', fontWeight: 600 } : { color: te.textMuted, border: `1px solid ${te.border}` }} onClick={() => setOrderType('market')}>
              <Zap className="size-3" />Market
            </Button>
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-[10px] gap-1 rounded-sm" style={orderType === 'limit' ? { background: te.orange, color: '#000', fontWeight: 600 } : { color: te.textMuted, border: `1px solid ${te.border}` }} onClick={() => setOrderType('limit')}>
              <Tag className="size-3" />Limit
            </Button>
          </div>
        </div>

        {orderType === 'market' && (
          <div>
            <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>KWOTA USDC</Label>
            <div className="relative mt-1">
              <Input type="number" placeholder="0.00" value={amountUsdc} onChange={e => setAmountUsdc(e.target.value)} className="h-8 pr-14" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }} min={0} step={0.01} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold" style={{ color: te.cyan }}>USDC</span>
            </div>
            <div className="flex gap-1 mt-1.5">
              {presetAmounts.map(amt => (
                <Button key={amt} variant="ghost" size="sm" className="h-5 flex-1 text-[9px] rounded-sm px-0" style={{ border: `1px solid ${te.border}`, color: te.textMuted }} onClick={() => setAmountUsdc(String(amt))}>${amt}</Button>
              ))}
              {usdcAvailable !== null && usdcAvailable > 0 && (
                <Button variant="ghost" size="sm" className="h-5 text-[9px] rounded-sm px-1" style={{ border: `1px solid ${te.cyan}40`, color: te.cyan }} onClick={() => setAmountUsdc(usdcAvailable.toFixed(2))}>MAX</Button>
              )}
            </div>
            {amountUsdc && currentPrice && Number(amountUsdc) > 0 && currentPrice > 0 && (
              <div className="mt-1.5 text-[10px]" style={{ color: te.textDim, fontFamily: te.mono }}>
                ~{(Number(amountUsdc) / currentPrice).toFixed(6)} {coinInfo?.label}
              </div>
            )}
          </div>
        )}

        {orderType === 'limit' && (
          <div className="space-y-2">
            <div>
              <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>CENA USDC</Label>
              <div className="relative mt-1">
                <Input type="number" placeholder="0.00" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} className="h-8 pr-14" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }} min={0} step={0.01} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold" style={{ color: te.cyan }}>USDC</span>
              </div>
              {currentPrice && currentPrice > 0 && (
                <Button variant="ghost" size="sm" className="h-5 text-[9px] rounded-sm px-1.5 mt-1" style={{ color: te.textMuted }} onClick={() => setLimitPrice(currentPrice.toFixed(currentPrice < 1 ? 6 : currentPrice < 100 ? 4 : 2))}>Use current price</Button>
              )}
            </div>
            <div>
              <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>AMOUNT {coinInfo?.label}</Label>
              <div className="relative mt-1">
                <Input type="number" placeholder="0.00" value={limitQty} onChange={e => setLimitQty(e.target.value)} className="h-8 pr-14" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }} min={0} step={0.001} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold" style={{ color: te.orange }}>{coinInfo?.label}</span>
              </div>
            </div>
            {Number(limitPrice) > 0 && Number(limitQty) > 0 && (
              <div className="flex items-center justify-between text-[10px] rounded-sm px-2 py-1" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
                <span style={{ color: te.textMuted }}>Total:</span>
                <span style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{limitTotal} USDC</span>
              </div>
            )}
          </div>
        )}

        <div>
          <Label className="text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>TRYB</Label>
          <div className="flex gap-1 mt-1">
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-[10px] gap-1 rounded-sm" style={mode === 'demo' ? { background: te.blue, color: '#fff', fontWeight: 600 } : { color: te.textMuted, border: `1px solid ${te.border}` }} onClick={() => setMode('demo')}>
              <FlaskConical className="size-3" />Testnet
            </Button>
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-[10px] gap-1 rounded-sm" style={mode === 'real' ? { background: te.red, color: '#fff', fontWeight: 600 } : { color: te.textMuted, border: `1px solid ${te.border}` }} onClick={() => setMode('real')}>
              <DollarSign className="size-3" />Real
            </Button>
          </div>
        </div>

        <Button className="w-full h-9 text-xs gap-1.5 rounded-sm font-semibold" style={{ background: te.green, color: '#000' }} disabled={loading || (orderType === 'market' ? !amountUsdc || Number(amountUsdc) <= 0 : !limitPrice || !limitQty || Number(limitPrice) <= 0 || Number(limitQty) <= 0)} onClick={handleBuy}>
          {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
          {loading ? 'Placing order...' : `KUP ${coinInfo?.label}`}
        </Button>

        {orderResult && (
          <div className="rounded-sm px-3 py-2 space-y-1" style={{ background: te.greenBg, border: `1px solid ${te.green}30` }}>
            <div className="text-[10px] font-semibold" style={{ color: te.green }}>Order placed!</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]" style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
              <div><span style={{ color: te.textMuted }}>Symbol:</span> <span style={{ color: te.text }}>{orderResult.symbol}</span></div>
              <div><span style={{ color: te.textMuted }}>Typ:</span> <span style={{ color: te.text }}>{orderResult.type}</span></div>
              {orderResult.filledQty && <div><span style={{ color: te.textMuted }}>Qty:</span> <span style={{ color: te.text }}>{orderResult.filledQty}</span></div>}
              {orderResult.avgPrice && <div><span style={{ color: te.textMuted }}>Cena:</span> <span style={{ color: te.text }}>${orderResult.avgPrice}</span></div>}
              {orderResult.quoteQty && <div><span style={{ color: te.textMuted }}>Value:</span> <span style={{ color: te.text }}>${orderResult.quoteQty}</span></div>}
              {orderResult.price && <div><span style={{ color: te.textMuted }}>Cena limit:</span> <span style={{ color: te.text }}>${orderResult.price}</span></div>}
              {orderResult.quantity && <div><span style={{ color: te.textMuted }}>Qty:</span> <span style={{ color: te.text }}>{orderResult.quantity}</span></div>}
              {orderResult.total && <div><span style={{ color: te.textMuted }}>Total:</span> <span style={{ color: te.text }}>${orderResult.total} USDC</span></div>}
              <div><span style={{ color: te.textMuted }}>Order ID:</span> <span style={{ color: te.text }}>{orderResult.orderId}</span></div>
            </div>
          </div>
        )}

        {orderError && (
          <div className="flex items-center gap-2 text-[10px] rounded-sm px-3 py-2" style={{ background: te.redBg, border: `1px solid ${te.red}30`, color: te.red }}>
            <span>✕</span><span>{orderError}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Order Book Panel ───────────────────────────────────────────────────────

function OrderBookPanel() {
  const te = useTE()
  const [selectedCoin, setSelectedCoin] = useState('btc')
  const [mode, setMode] = useState<'demo' | 'real'>('real')
  const [bids, setBids] = useState<OrderBookEntry[]>([])
  const [asks, setAsks] = useState<OrderBookEntry[]>([])
  const [bestBid, setBestBid] = useState(0)
  const [bestAsk, setBestAsk] = useState(0)
  const [spread, setSpread] = useState('')
  const [spreadPct, setSpreadPct] = useState('')
  const [totalBidUsdc, setTotalBidUsdc] = useState('')
  const [totalAskUsdc, setTotalAskUsdc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const coinInfo = BUY_COINS.find(c => c.id === selectedCoin)

  const fetchOrderBook = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/trade/orderbook?coinId=${selectedCoin}&mode=${mode}&limit=12`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to fetch order book')
        return
      }
      const data = await res.json()
      setBids(data.bids || [])
      setAsks(data.asks || [])
      setBestBid(data.bestBid || 0)
      setBestAsk(data.bestAsk || 0)
      setSpread(data.spread || '0')
      setSpreadPct(data.spreadPct || '0')
      setTotalBidUsdc(data.totalBidUsdc || '0')
      setTotalAskUsdc(data.totalAskUsdc || '0')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error')
    } finally {
      setLoading(false)
    }
  }, [selectedCoin, mode])

  useEffect(() => {
    void fetchOrderBook()
  }, [fetchOrderBook])

  // Auto-refresh every 10s
  useEffect(() => {
    const interval = setInterval(() => void fetchOrderBook(), 10000)
    return () => clearInterval(interval)
  }, [fetchOrderBook])

  const formatPrice = (p: number) => {
    if (p === 0) return '—'
    if (p < 0.01) return p.toFixed(8)
    if (p < 1) return p.toFixed(6)
    if (p < 100) return p.toFixed(4)
    if (p < 10000) return p.toFixed(2)
    return p.toFixed(0)
  }

  const formatQty = (q: number) => {
    if (q === 0) return '—'
    if (q < 0.001) return q.toFixed(8)
    if (q < 1) return q.toFixed(6)
    if (q < 100) return q.toFixed(4)
    return q.toFixed(2)
  }

  // Find max total for depth bar sizing
  const maxBidTotal = bids.length > 0 ? Math.max(...bids.map(b => b.total)) : 1
  const maxAskTotal = asks.length > 0 ? Math.max(...asks.map(a => a.total)) : 1

  return (
    <Card style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4" style={{ color: te.cyan }} />
            <CardTitle className="text-sm font-medium" style={{ color: te.text }}>Order Book</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={selectedCoin} onValueChange={setSelectedCoin}>
              <SelectTrigger className="h-6 w-[64px] text-[9px]" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
                {BUY_COINS.map(c => (
                  <SelectItem key={c.id} value={c.id} style={{ color: te.text, fontFamily: te.mono, fontSize: '10px' }}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost" size="sm"
              className="h-6 text-[9px] gap-0.5 rounded-sm px-1"
              style={mode === 'demo' ? { background: te.blue, color: '#fff' } : { color: te.textMuted, border: `1px solid ${te.border}` }}
              onClick={() => setMode(mode === 'demo' ? 'real' : 'demo')}
            >
              {mode === 'demo' ? 'T' : 'R'}
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={fetchOrderBook} disabled={loading}>
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} style={{ color: te.textMuted }} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {error && (
          <div className="text-[9px] rounded-sm px-2 py-1.5 mb-2" style={{ background: te.redBg, border: `1px solid ${te.red}30`, color: te.red }}>
            {error}
          </div>
        )}

        {/* Spread info */}
        {bestBid > 0 && bestAsk > 0 && (
          <div className="flex items-center justify-between text-[9px] mb-2 rounded-sm px-2 py-1" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
            <span style={{ color: te.green }}>Bid: <span style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${formatPrice(bestBid)}</span></span>
            <span style={{ color: te.textMuted }}>Spread: <span style={{ fontFamily: te.mono }}>{spreadPct}%</span></span>
            <span style={{ color: te.red }}>Ask: <span style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${formatPrice(bestAsk)}</span></span>
          </div>
        )}

        {/* Header row */}
        <div className="grid grid-cols-3 gap-x-2 text-[8px] mb-1" style={{ color: te.textDim, fontFamily: te.mono, letterSpacing: '0.06em' }}>
          <span>CENA</span>
          <span className="text-right">AMOUNT</span>
          <span className="text-right">SUMA</span>
        </div>

        {/* Asks (sells) - reversed so lowest ask is at bottom */}
        <div className="space-y-px mb-1">
          {[...asks].reverse().map((a, i) => (
            <div key={`ask-${i}`} className="grid grid-cols-3 gap-x-2 text-[9px] relative" style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
              <div className="absolute inset-0 rounded-sm" style={{ background: `${te.red}12`, width: `${(a.total / maxAskTotal) * 100}%`, marginLeft: 'auto', right: 0 }} />
              <span className="relative" style={{ color: te.red }}>{formatPrice(a.price)}</span>
              <span className="relative text-right" style={{ color: te.text }}>{formatQty(a.quantity)}</span>
              <span className="relative text-right" style={{ color: te.textMuted }}>{a.total < 1 ? a.total.toFixed(4) : a.total.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Spread separator */}
        {bestBid > 0 && bestAsk > 0 && (
          <div className="flex items-center justify-center text-[9px] py-0.5 my-0.5" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums', fontWeight: 700, background: `${te.bgInput}55`, borderRadius: '2px' }}>
            ${formatPrice((bestBid + bestAsk) / 2)}
          </div>
        )}

        {/* Bids (buys) - highest bid at top */}
        <div className="space-y-px mt-1">
          {bids.map((b, i) => (
            <div key={`bid-${i}`} className="grid grid-cols-3 gap-x-2 text-[9px] relative" style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
              <div className="absolute inset-0 rounded-sm" style={{ background: `${te.green}12`, width: `${(b.total / maxBidTotal) * 100}%` }} />
              <span className="relative" style={{ color: te.green }}>{formatPrice(b.price)}</span>
              <span className="relative text-right" style={{ color: te.text }}>{formatQty(b.quantity)}</span>
              <span className="relative text-right" style={{ color: te.textMuted }}>{b.total < 1 ? b.total.toFixed(4) : b.total.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="text-center rounded-sm px-2 py-1" style={{ background: te.greenBg, border: `1px solid ${te.green}15` }}>
            <div className="text-[8px]" style={{ color: te.textMuted }}>Bids total</div>
            <div className="text-[10px] font-semibold" style={{ color: te.green, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${Number(totalBidUsdc).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="text-center rounded-sm px-2 py-1" style={{ background: te.redBg, border: `1px solid ${te.red}15` }}>
            <div className="text-[8px]" style={{ color: te.textMuted }}>Asks total</div>
            <div className="text-[10px] font-semibold" style={{ color: te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${Number(totalAskUsdc).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        {loading && bids.length === 0 && (
          <div className="flex items-center justify-center py-4 text-[9px]" style={{ color: te.textMuted }}>
            <RefreshCw className="size-3 animate-spin mr-1.5" />Loading...
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Liquidation Map Panel (Futures, view-only) ─────────────────────────────

interface LiqLevel {
  leverage: number
  longLiqPrice: number
  shortLiqPrice: number
  estimatedLiqAmount: number
}

function LiquidationMapPanel() {
  const te = useTE()
  const [selectedCoin, setSelectedCoin] = useState('btc')
  const [markPrice, setMarkPrice] = useState(0)
  const [fundingRate, setFundingRate] = useState(0)
  const [fundingRatePct, setFundingRatePct] = useState('')
  const [annualizedFunding, setAnnualizedFunding] = useState('')
  const [openInterestUsd, setOpenInterestUsd] = useState('')
  const [sentiment, setSentiment] = useState<'long_heavy' | 'short_heavy' | 'neutral'>('neutral')
  const [levels, setLevels] = useState<LiqLevel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLiqData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/trade/liquidations?coinId=${selectedCoin}&mode=real`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to fetch data liquidacji')
        return
      }
      const data = await res.json()
      setMarkPrice(data.markPrice || 0)
      setFundingRate(data.fundingRate || 0)
      setFundingRatePct(data.fundingRatePct || '0')
      setAnnualizedFunding(data.annualizedFunding || '0')
      setOpenInterestUsd(data.openInterestUsd || '0')
      setSentiment(data.sentiment || 'neutral')
      setLevels(data.levels || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error')
    } finally {
      setLoading(false)
    }
  }, [selectedCoin])

  useEffect(() => {
    void fetchLiqData()
  }, [fetchLiqData])

  // Auto-refresh every 30s (funding rate doesn't change fast)
  useEffect(() => {
    const interval = setInterval(() => void fetchLiqData(), 30000)
    return () => clearInterval(interval)
  }, [fetchLiqData])

  const formatPrice = (p: number) => {
    if (p === 0) return '—'
    if (p < 0.01) return p.toFixed(8)
    if (p < 1) return p.toFixed(6)
    if (p < 100) return p.toFixed(4)
    if (p < 10000) return p.toFixed(2)
    return p.toFixed(0)
  }

  const coinInfo = BUY_COINS.find(c => c.id === selectedCoin)

  return (
    <Card style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="size-4" style={{ color: te.orange }} />
            <CardTitle className="text-sm font-medium" style={{ color: te.text }}>Liq. Map</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={selectedCoin} onValueChange={setSelectedCoin}>
              <SelectTrigger className="h-6 w-[64px] text-[9px]" style={{ background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
                {BUY_COINS.map(c => (
                  <SelectItem key={c.id} value={c.id} style={{ color: te.text, fontFamily: te.mono, fontSize: '10px' }}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="size-6" onClick={fetchLiqData} disabled={loading}>
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} style={{ color: te.textMuted }} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {error && (
          <div className="text-[9px] rounded-sm px-2 py-1.5 mb-2" style={{ background: te.redBg, border: `1px solid ${te.red}30`, color: te.red }}>
            {error}
          </div>
        )}

        {/* Funding Rate + OI compact stats */}
        {markPrice > 0 && (
          <div className="space-y-1.5 mb-3">
            {/* Funding rate */}
            <div className="flex items-center justify-between text-[9px] rounded-sm px-2 py-1" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
              <span style={{ color: te.textMuted }}>Funding</span>
              <div className="flex items-center gap-1">
                {fundingRate > 0 ? <TrendingUp className="size-2.5" style={{ color: te.green }} /> : fundingRate < 0 ? <TrendingDown className="size-2.5" style={{ color: te.red }} /> : null}
                <span style={{ color: fundingRate > 0 ? te.green : fundingRate < 0 ? te.red : te.textMuted, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                  {fundingRatePct}%
                </span>
              </div>
            </div>

            {/* OI + Sentiment */}
            <div className="flex items-center justify-between text-[9px] rounded-sm px-2 py-1" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
              <span style={{ color: te.textMuted }}>OI</span>
              <span style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                ${Number(openInterestUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>

            {/* Sentiment badge */}
            <div className="flex items-center justify-between text-[9px] rounded-sm px-2 py-1" style={{ background: `${te.bgInput}55`, border: `1px solid ${te.border}` }}>
              <span style={{ color: te.textMuted }}>Nastawienie</span>
              <Badge className="text-[8px] border px-1.5 py-0" style={{
                background: sentiment === 'long_heavy' ? te.greenBg : sentiment === 'short_heavy' ? te.redBg : `${te.bgInput}`,
                color: sentiment === 'long_heavy' ? te.green : sentiment === 'short_heavy' ? te.red : te.textMuted,
                borderColor: sentiment === 'long_heavy' ? `${te.green}30` : sentiment === 'short_heavy' ? `${te.red}30` : te.border,
              }}>
                {sentiment === 'long_heavy' ? 'LONG' : sentiment === 'short_heavy' ? 'SHORT' : 'NEUTRAL'}
              </Badge>
            </div>

            {/* Annualized funding */}
            <div className="flex items-center justify-between text-[9px]">
              <span style={{ color: te.textDim }}>Ann. funding</span>
              <span style={{ color: te.textDim, fontFamily: te.mono }}>{annualizedFunding}%</span>
            </div>
          </div>
        )}

        {/* Liquidation levels heatmap */}
        {levels.length > 0 && (
          <div>
            <div className="text-[8px] mb-1.5" style={{ color: te.textDim, fontFamily: te.mono, letterSpacing: '0.06em' }}>EST. POZIOMY LIKWIDACJI</div>

            {/* Current price reference */}
            <div className="flex items-center justify-between text-[9px] rounded-sm px-2 py-0.5 mb-1" style={{ background: `${te.orange}15`, border: `1px solid ${te.orange}30` }}>
              <span style={{ color: te.textMuted }}>Mark</span>
              <span style={{ color: te.orange, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>${formatPrice(markPrice)}</span>
            </div>

            {/* Short liquidation levels (above current price) */}
            <div className="text-[7px] mt-1 mb-0.5" style={{ color: te.red, fontFamily: te.mono, letterSpacing: '0.06em' }}>SHORT LIQ. ▲</div>
            {levels.filter(l => l.leverage >= 5).map(l => (
              <div key={`short-${l.leverage}`} className="flex items-center gap-1 mb-0.5">
                <div className="flex-1 h-3 rounded-sm relative overflow-hidden" style={{ background: `${te.bgInput}` }}>
                  <div className="absolute inset-y-0 right-0 rounded-sm" style={{
                    background: `${te.red}${Math.round(l.estimatedLiqAmount * 80).toString(16).padStart(2, '0')}`,
                    width: `${l.estimatedLiqAmount * 100}%`,
                  }} />
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[7px]" style={{ color: te.textMuted, fontFamily: te.mono }}>{l.leverage}x</span>
                </div>
                <span className="text-[8px] w-auto shrink-0" style={{ color: te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                  ${formatPrice(l.shortLiqPrice)}
                </span>
              </div>
            ))}

            {/* Divider — current price */}
            <div className="my-1" style={{ borderTop: `1px dashed ${te.border}` }} />

            {/* Long liquidation levels (below current price) */}
            <div className="text-[7px] mb-0.5" style={{ color: te.green, fontFamily: te.mono, letterSpacing: '0.06em' }}>LONG LIQ. ▼</div>
            {levels.filter(l => l.leverage >= 5).map(l => (
              <div key={`long-${l.leverage}`} className="flex items-center gap-1 mb-0.5">
                <div className="flex-1 h-3 rounded-sm relative overflow-hidden" style={{ background: `${te.bgInput}` }}>
                  <div className="absolute inset-y-0 left-0 rounded-sm" style={{
                    background: `${te.green}${Math.round(l.estimatedLiqAmount * 80).toString(16).padStart(2, '0')}`,
                    width: `${l.estimatedLiqAmount * 100}%`,
                  }} />
                  <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[7px]" style={{ color: te.textMuted, fontFamily: te.mono }}>{l.leverage}x</span>
                </div>
                <span className="text-[8px] w-auto shrink-0" style={{ color: te.green, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                  ${formatPrice(l.longLiqPrice)}
                </span>
              </div>
            ))}

            {/* Disclaimer */}
            <div className="text-[7px] mt-2 leading-tight" style={{ color: te.textDim }}>
              Estimated levels based on leverage and maintenance margin. Data from Binance Futures (USDT-M).
            </div>
          </div>
        )}

        {loading && levels.length === 0 && (
          <div className="flex items-center justify-center py-4 text-[9px]" style={{ color: te.textMuted }}>
            <RefreshCw className="size-3 animate-spin mr-1.5" />Loading...
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Open Orders Panel ─────────────────────────────────────────────────────

function OpenOrdersPanel() {
  const te = useTE()
  const [orders, setOrders] = useState<BinanceOpenOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [mode, setMode] = useState<'demo' | 'real'>('real')

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/trade/orders?mode=${mode}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to fetch orders')
        setOrders([])
        return
      }
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  const handleCancel = async (symbol: string, orderId: string) => {
    const key = `${symbol}:${orderId}`
    setCancelling(key)
    try {
      const res = await fetch('/api/trade/orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, orderId, mode }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to cancel order')
      } else {
        setOrders(prev => prev.filter(o => !(o.symbol === symbol && o.orderId === orderId)))
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Connection error')
    } finally {
      setCancelling(null)
    }
  }

  const formatTime = (ts: number) => {
    if (!ts) return '—'
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  // Extract base coin from symbol (e.g. "BTCUSDC" -> "BTC", "ETHUSDT" -> "ETH")
  const getBaseCoin = (symbol: string) => {
    if (symbol.endsWith('USDC')) return symbol.slice(0, -4)
    if (symbol.endsWith('USDT')) return symbol.slice(0, -4)
    return symbol
  }

  const getQuoteCoin = (symbol: string) => {
    if (symbol.endsWith('USDC')) return 'USDC'
    if (symbol.endsWith('USDT')) return 'USDT'
    return ''
  }

  return (
    <Card style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4" style={{ color: te.yellow }} />
            <CardTitle className="text-sm font-medium" style={{ color: te.text }}>Otwarte zlecenia</CardTitle>
            {orders.length > 0 && (
              <Badge className="text-[9px] border" style={{ background: te.yellowBg, color: te.yellow, borderColor: `${te.yellow}30` }}>{orders.length}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="sm"
              className="h-6 text-[9px] gap-0.5 rounded-sm px-1.5"
              style={mode === 'demo' ? { background: te.blue, color: '#fff' } : { color: te.textMuted, border: `1px solid ${te.border}` }}
              onClick={() => setMode(mode === 'demo' ? 'real' : 'demo')}
            >
              {mode === 'demo' ? <FlaskConical className="size-2.5" /> : <DollarSign className="size-2.5" />}
              {mode === 'demo' ? 'Test' : 'Real'}
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} style={{ color: te.textMuted }} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {error && (
          <div className="text-[10px] rounded-sm px-3 py-2 mb-2" style={{ background: te.redBg, border: `1px solid ${te.red}30`, color: te.red }}>
            {error}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-[10px]" style={{ color: te.textMuted }}>
            <RefreshCw className="size-3 animate-spin mr-2" />Loading orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-[10px]" style={{ color: te.textDim }}>
            No open orders on Binance ({mode === 'demo' ? 'testnet' : 'real'})
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: te.border }}>
            {orders.map(o => {
              const baseCoin = getBaseCoin(o.symbol)
              const quoteCoin = getQuoteCoin(o.symbol)
              const isBuy = o.side === 'BUY'
              const price = Number(o.price)
              const origQty = Number(o.origQty)
              const executedQty = Number(o.executedQty)
              const total = price * origQty
              const filledPct = origQty > 0 ? (executedQty / origQty) * 100 : 0

              return (
                <div key={`${o.symbol}:${o.orderId}`} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Side badge */}
                      <Badge className="text-[9px] shrink-0 border" style={{
                        background: isBuy ? te.greenBg : te.redBg,
                        color: isBuy ? te.green : te.red,
                        borderColor: isBuy ? `${te.green}30` : `${te.red}30`,
                      }}>
                        {isBuy ? <ArrowUp className="size-2.5 mr-0.5" /> : <ArrowDown className="size-2.5 mr-0.5" />}
                        {o.side}
                      </Badge>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold truncate" style={{ color: te.text, fontFamily: te.mono }}>{baseCoin}</span>
                          <span className="text-[8px]" style={{ color: te.textMuted }}>/{quoteCoin}</span>
                          <Badge variant="outline" className="text-[8px] px-1 py-0">{o.type}</Badge>
                          {o.timeInForce && <Badge variant="outline" className="text-[8px] px-1 py-0" style={{ color: te.textDim }}>{o.timeInForce}</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[9px]" style={{ fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: te.textMuted }}>Price: <span style={{ color: te.text }}>${price < 1 ? price.toFixed(6) : price < 100 ? price.toFixed(4) : price.toFixed(2)}</span></span>
                          <span style={{ color: te.textMuted }}>Qty: <span style={{ color: te.text }}>{origQty < 1 ? origQty.toFixed(6) : origQty.toFixed(4)}</span></span>
                          <span style={{ color: te.textMuted }}>Sum: <span style={{ color: te.text }}>${total < 1 ? total.toFixed(4) : total.toFixed(2)}</span></span>
                        </div>
                        {filledPct > 0 && filledPct < 100 && (
                          <div className="mt-1">
                            <div className="h-1 rounded-full overflow-hidden" style={{ background: te.bgInput, width: '80px' }}>
                              <div className="h-full rounded-full" style={{ width: `${filledPct}%`, background: te.yellow }} />
                            </div>
                            <span className="text-[8px]" style={{ color: te.textDim }}>Filled: {filledPct.toFixed(1)}%</span>
                          </div>
                        )}
                        <div className="text-[8px] mt-0.5" style={{ color: te.textDim }}>{formatTime(o.time)}</div>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 text-[9px] gap-0.5 rounded-sm shrink-0 px-1.5"
                      style={{ color: te.red, border: `1px solid ${te.red}40` }}
                      disabled={cancelling === `${o.symbol}:${o.orderId}`}
                      onClick={() => handleCancel(o.symbol, o.orderId)}
                    >
                      {cancelling === `${o.symbol}:${o.orderId}` ? <RefreshCw className="size-2.5 animate-spin" /> : <XCircle className="size-2.5" />}
                      Anuluj
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Trading Tab ──────────────────────────────────────────────────────

export default function TradingTab({ strategies, onRefresh }: { strategies: ActiveStrategyInfo[]; onRefresh: () => void }) {
  const te = useTE()
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const handleDeactivate = async (strategyId: string, mode: 'demo' | 'real') => {
    const key = `${strategyId}:${mode}`
    setDeactivating(key)
    try {
      const res = await fetch('/api/strategies/deactivate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId, mode }),
      })
      const data = await res.json()
      if (!res.ok) alert(data.error || 'Failed to deactivate')
      else onRefresh()
    } catch (err) { alert(err instanceof Error ? err.message : 'Connection error') }
    finally { setDeactivating(null) }
  }

  const runningStrategiessss = strategies.filter(s => s.status === 'running')
  const stoppedStrategiessss = strategies.filter(s => s.status !== 'running')

  const totalPnl = runningStrategiessss.reduce((sum, s) => sum + s.totalPnl, 0)
  const totalTrades = runningStrategiessss.reduce((sum, s) => sum + s.totalTrades, 0)
  const inPosition = runningStrategiessss.filter(s => s.inPosition).length

  return (
    <div className="space-y-4">
      {/* Compact stats bar — like exchange top bar */}
      <div className="flex items-center gap-4 flex-wrap rounded-sm px-3 py-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
        <div className="flex items-center gap-1.5">
          <Play className="size-3" style={{ color: te.green }} />
          <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>STRATEGIE</span>
          <span className="text-[13px] font-bold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{runningStrategiessss.length}</span>
        </div>
        <div style={{ width: '1px', height: '16px', background: te.border }} />
        <div className="flex items-center gap-1.5">
          <Target className="size-3" style={{ color: te.yellow }} />
          <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>W POZYCJI</span>
          <span className="text-[13px] font-bold" style={{ color: inPosition > 0 ? te.yellow : te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{inPosition}</span>
        </div>
        <div style={{ width: '1px', height: '16px', background: te.border }} />
        <div className="flex items-center gap-1.5">
          <DollarSign className="size-3" style={{ color: totalPnl >= 0 ? te.green : te.red }} />
          <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>PnL</span>
          <span className="text-[13px] font-bold" style={{ color: totalPnl >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${totalPnl.toFixed(2)}</span>
        </div>
        <div style={{ width: '1px', height: '16px', background: te.border }} />
        <div className="flex items-center gap-1.5">
          <Shield className="size-3" style={{ color: te.blue }} />
          <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono, letterSpacing: '0.06em' }}>TRADES</span>
          <span className="text-[13px] font-bold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{totalTrades}</span>
        </div>
      </div>

      {/* Order Book (narrow) + Liquidation Map (compact) | Buy Panel (wider) */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_4fr] gap-3">
        <div className="grid grid-cols-1 xl:grid-cols-[5fr_3fr] gap-3">
          <OrderBookPanel />
          <LiquidationMapPanel />
        </div>
        <BuyPanel />
      </div>

      {/* Open Orders — directly below trading area, like exchange bottom panel */}
      <OpenOrdersPanel />

      {runningStrategiessss.length === 0 ? (
        <Card style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px' }}>
          <CardContent className="py-12 text-center" style={{ color: te.textMuted }}>
            <Play className="size-8 mx-auto mb-2 opacity-50" />
            <p>No active strategies</p>
            <p className="text-xs mt-1">Go to the Strategies tab and click Demo or Real to activate</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h3 style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted }}>Active strategies</h3>
          {runningStrategiessss.map(s => (
            <Card key={`${s.strategyId}:${s.mode}`} style={{ background: te.bgCard, border: `1px solid ${te.green}33`, borderRadius: '4px' }}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: s.mode === 'demo' ? te.blue : te.red }}>
                      {s.mode === 'demo' ? <FlaskConical className="size-4 text-white" /> : <DollarSign className="size-4 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate" style={{ color: te.text }}>{s.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{s.symbol}</Badge>
                        {strategyTypeBadge(s.strategyType || 'dip_buying')}
                        <Badge className={`shrink-0 ${s.mode === 'demo' ? 'text-white text-[10px]' : 'text-white text-[10px]'}`} style={{ background: s.mode === 'demo' ? te.blue : te.red }}>{s.mode === 'demo' ? 'DEMO' : 'REAL'}</Badge>
                        {s.inPosition && <Badge style={{ background: te.yellow, color: '#000' }} className="text-[10px] shrink-0">IN POSITION</Badge>}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: te.textMuted }}>
                        {s.inPosition && s.entryPrice ? `Entry: $${s.entryPrice.toFixed(4)}` : `Waiting for ${strategyTypeLabel(s.strategyType || 'dip_buying')} signal...`}
                        {s.lastPrice ? ` | Obecna: $${s.lastPrice.toFixed(4)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <div style={{ fontFamily: te.mono, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted }}>PnL</div>
                      <div style={{ fontFamily: te.mono, fontSize: 14, fontWeight: 700, color: s.totalPnl >= 0 ? te.green : te.red, fontVariantNumeric: 'tabular-nums' }}>${s.totalPnl.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: te.mono, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted }}>Capital</div>
                      <div style={{ fontFamily: te.mono, fontSize: 14, fontWeight: 600, color: te.text, fontVariantNumeric: 'tabular-nums' }}>${s.currentCapital.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: te.mono, fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted }}>Win</div>
                      <div style={{ fontFamily: te.mono, fontSize: 14, fontWeight: 600, color: te.text, fontVariantNumeric: 'tabular-nums' }}>{s.totalTrades > 0 ? ((s.winningTrades / s.totalTrades) * 100).toFixed(0) : 0}%</div>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1 ml-auto shrink-0" style={{ borderColor: `${te.red}80`, color: te.red }} onClick={() => handleDeactivate(s.strategyId, s.mode as 'demo' | 'real')} disabled={deactivating === `${s.strategyId}:${s.mode}`}>
                      {deactivating === `${s.strategyId}:${s.mode}` ? <RefreshCw className="size-3 animate-spin" /> : <CircleStop className="size-3" />}Stop
                    </Button>
                  </div>
                </div>
                {s.errorMessage && <div className="mt-2 text-xs rounded px-2 py-1" style={{ color: te.red, background: te.redBg }}>{s.errorMessage}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {stoppedStrategiessss.length > 0 && (
        <div className="space-y-3">
          <h3 style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: te.textMuted }}>Stopped strategies</h3>
          {stoppedStrategiessss.map(s => (
            <Card key={`${s.strategyId}:${s.mode}`} style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderRadius: '4px', opacity: 0.6 }}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: te.text }}>{s.name}</span>
                    <Badge variant="outline" className="text-[10px]">{s.symbol}</Badge>
                    <Badge variant="outline" className="text-[10px]">{s.mode === 'demo' ? 'Demo' : 'Real'}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span style={{ color: te.textMuted }}>PnL: <span style={{ color: s.totalPnl >= 0 ? te.green : te.red }}>${s.totalPnl.toFixed(2)}</span></span>
                    <span style={{ color: te.textMuted }}>Trades: {s.totalTrades}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-sm" style={{ background: te.bgCard, border: `1px dashed ${te.borderLight}`, borderRadius: '4px' }}>
        <button className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => setShowHelp(!showHelp)} style={{ color: te.textMuted }}>
          <Shield className="size-3.5 shrink-0" style={{ color: te.blue }} />
          <span className="text-[10px] font-medium" style={{ fontFamily: te.mono, letterSpacing: '0.04em' }}>How does automated trading work?</span>
          <span className="ml-auto text-[9px]" style={{ fontFamily: te.mono, color: te.textDim }}>{showHelp ? '▲' : '▼'}</span>
        </button>
        {showHelp && (
          <div className="px-3 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs" style={{ color: te.textMuted }}>
              <div><span style={{ color: te.text, fontWeight: 500 }}>1.</span> Configure Bybit API keys in <span style={{ color: te.text }}>Settings</span> (gear icon in the header)</div>
              <div><span style={{ color: te.text, fontWeight: 500 }}>2.</span> Create an account on <span style={{ color: te.text, fontWeight: 600 }}>testnet.binance.vision</span> for Testnet mode</div>
              <div><span style={{ color: te.text, fontWeight: 500 }}>3.</span> Click <Badge style={{ background: te.blue, color: '#fff', fontSize: '10px' }} className="px-1 py-0">Demo</Badge> on a strategy — the system will start monitoring the market</div>
              <div><span style={{ color: te.text, fontWeight: 500 }}>4.</span> When a dip meets the conditions — the system will automatically buy and sell via TP/SL</div>
              <div><span style={{ color: te.text, fontWeight: 500 }}>5.</span> <Badge style={{ background: te.red, color: '#fff', fontSize: '10px' }} className="px-1 py-0">Real</Badge> uses real capital — make sure the strategy works in Demo first!</div>
              <div><span style={{ color: te.text, fontWeight: 500 }}>6.</span> Monitor status in this tab — you can stop the strategy at any time</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
