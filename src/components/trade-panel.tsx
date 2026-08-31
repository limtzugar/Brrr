'use client'

// ─── Trade Panel — TE Slide-Out Panel ────────────────────────────────────────
// Slide-out panel from the right side for quick crypto trading via API.
// Teenage Engineering functional design: clean mono type, thin 1px borders,
// orange accent, industrial LED indicators.

import { useState, useEffect, useCallback } from 'react'
import { TE, useTE } from '@/lib/te-theme'
import { PIXEL_ICONS } from '@/components/pixel-art'
import { formatPrice, formatPct, sanitizeImageUrl } from '@/lib/trading-shared'

// ─── PixelIcon Component (icons ONLY) ─────────────────────────────────────

function PixelIcon({ grid, color, size = 20 }: { grid: number[][]; color: string; size?: number }) {
  const te = useTE()
  if (!grid) return null
  const px = size / 8
  return (
    <svg width={size} height={size} style={{ imageRendering: 'pixelated' }} className="shrink-0">
      {grid.map((row, y) =>
        row.map((cell, x) =>
          cell ? <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} fill={color} /> : null
        )
      )}
    </svg>
  )
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TradeTarget {
  coinId: string
  symbol: string
  name: string
  image: string
  currentPrice: number
  priceChange24h: number | null
}

interface TradePanelProps {
  open: boolean
  onClose: () => void
  target: TradeTarget | null
  defaultExchange: 'bybit' | 'mexc' | 'binance'
  defaultMode: 'demo' | 'real'
  usdtBalance: number
}

// ─── LED Dot ─────────────────────────────────────────────────────────────

function LED({ color, active }: { color: string; active: boolean }) {
  const te = useTE()
  return (
    <span
      style={{
        width: 6,
        height: 6,
        display: 'inline-block',
        borderRadius: '50%',
        background: active ? color : te.border,
        boxShadow: active ? `0 0 4px ${color}, 0 0 8px ${color}44` : 'none',
      }}
    />
  )
}

// ─── Separator ─────────────────────────────────────────────────────────────

function Separator() {
  const te = useTE()
  return (
    <div
      style={{
        height: '2px',
        background: `repeating-linear-gradient(90deg, ${te.border} 0px, ${te.border} 4px, transparent 4px, transparent 8px)`,
        margin: '8px 0',
      }}
    />
  )
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function TradePanel({ open, onClose, target, defaultExchange, defaultMode, usdtBalance }: TradePanelProps) {
  const te = useTE()
  const [exchange, setExchange] = useState<'bybit' | 'mexc' | 'binance'>(defaultExchange)
  const [mode, setMode] = useState<'demo' | 'real'>(defaultMode)
  const [amountUsdt, setAmountUsdt] = useState<string>('50')
  const [orderResult, setOrderResult] = useState<{
    success: boolean
    symbol?: string
    orderId?: string
    estimatedPrice?: number
    estimatedTotal?: string
    error?: string
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Sync with parent defaults
  useEffect(() => { setExchange(defaultExchange) }, [defaultExchange])
  useEffect(() => { setMode(defaultMode) }, [defaultMode])

  // Reset when target changes
  useEffect(() => {
    setOrderResult(null)
    setSubmitting(false)
  }, [target?.coinId])

  // Quick amount presets
  const presets = [10, 25, 50, 100, 250, 500]
  const numAmount = parseFloat(amountUsdt) || 0
  const fee = exchange === 'binance' ? 0.1 : 0.1 // taker fee %
  const feeUsdt = numAmount * (fee / 100)
  const netUsdt = numAmount - feeUsdt
  const estimatedQty = target && target.currentPrice > 0 ? netUsdt / target.currentPrice : 0

  // Submit market buy
  const handleBuy = useCallback(async () => {
    if (!target || numAmount <= 0 || submitting) return
    setSubmitting(true)
    setOrderResult(null)
    try {
      const res = await fetch('/api/trade/market-buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coinId: target.coinId,
          symbol: target.symbol,
          exchange,
          mode,
          amountUsdt: numAmount,
        }),
      })
      const data = await res.json()
      setOrderResult(data)
    } catch (err) {
      setOrderResult({ success: false, error: err instanceof Error ? err.message : 'Connection error' })
    } finally {
      setSubmitting(false)
    }
  }, [target, numAmount, exchange, mode, submitting])

  if (!target) return null

  const isPositive = (target.priceChange24h ?? 0) >= 0
  const changeColor = isPositive ? te.green : te.red

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '100%',
          maxWidth: 400,
          height: '100vh',
          background: te.bgCard,
          borderLeft: `1px solid ${te.border}`,
          zIndex: 101,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Panel Header ── */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${te.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: te.bg,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              background: te.green,
              boxShadow: `0 0 6px ${te.green}`,
              borderRadius: '50%',
            }}
          />
          <span
            style={{
              fontFamily: te.mono,
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              color: te.orange,
            }}
          >
            QUICK TRADE
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: te.bgCard,
              border: `1px solid ${te.border}`,
              borderRadius: 2,
              cursor: 'pointer',
              color: te.textMuted,
              fontFamily: te.mono,
              fontSize: '12px',
              padding: 0,
            }}
          >
            x
          </button>
        </div>

        {/* ── Coin Info ── */}
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ position: 'relative' }}>
              <img
                src={sanitizeImageUrl(target.image)}
                alt={target.symbol}
                style={{
                  width: 36,
                  height: 36,
                  border: `1px solid ${te.border}`,
                  borderRadius: 2,
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: te.mono, fontSize: '14px', fontWeight: 700, color: te.text }}>
                  {target.symbol.toUpperCase()}
                </span>
                <span style={{ fontFamily: te.mono, fontSize: '10px', color: te.textDim }}>
                  {target.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <span style={{ fontFamily: te.mono, fontSize: '16px', fontWeight: 700, color: te.text, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(target.currentPrice)}
                </span>
                <span style={{ fontFamily: te.mono, fontSize: '11px', fontWeight: 700, color: changeColor }}>
                  {formatPct(target.priceChange24h)}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Exchange Selector ── */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '6px' }}>
              GIEŁDA
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['bybit', 'binance'] as const).map(ex => {
                const isActive = exchange === ex
                const exColor = ex === 'binance' ? te.yellow : te.orange
                return (
                  <button
                    key={ex}
                    onClick={() => setExchange(ex)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: isActive ? exColor : te.bg,
                      border: `1px solid ${isActive ? exColor : te.border}`,
                      borderRadius: 2,
                      color: isActive ? '#fff' : te.textMuted,
                      fontFamily: te.mono,
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase' as const,
                      cursor: 'pointer',
                      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    }}
                  >
                    {ex === 'binance' ? 'BNB' : ex.toUpperCase()}
                  </button>
                )
              })}
            </div>
            {/* Fee info */}
            <div style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, marginTop: '4px', letterSpacing: '0.04em' }}>
              {exchange === 'binance' ? 'Binance: Maker 0.1% / Taker 0.1%' : 'Bybit Futures: Maker 0.02% / Taker 0.055%'}
            </div>
          </div>

          {/* ── Mode Selector ── */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '6px' }}>
              TRYB
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setMode('demo')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: mode === 'demo' ? te.blue : te.bg,
                  border: `1px solid ${mode === 'demo' ? te.blue : te.border}`,
                  borderRadius: 2,
                  color: mode === 'demo' ? '#fff' : te.textMuted,
                  fontFamily: te.mono,
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase' as const,
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <LED color={te.blue} active={mode === 'demo'} /> DEMO
              </button>
              <button
                onClick={() => setMode('real')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: mode === 'real' ? te.red : te.bg,
                  border: `1px solid ${mode === 'real' ? te.red : te.border}`,
                  borderRadius: 2,
                  color: mode === 'real' ? '#fff' : te.textMuted,
                  fontFamily: te.mono,
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase' as const,
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <LED color={te.red} active={mode === 'real'} /> REAL
              </button>
            </div>
            {mode === 'real' && (
              <div style={{
                fontFamily: te.mono, fontSize: '7px', color: te.red, marginTop: '4px',
                letterSpacing: '0.04em', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <PixelIcon grid={PIXEL_ICONS.warning} color={te.red} size={10} />
                TRYB REAL — real funds
              </div>
            )}
          </div>

          <Separator />

          {/* ── Amount Input ── */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '6px' }}>
              KWOTA USDT
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: te.bg,
                border: `1px solid ${te.border}`,
                borderRadius: 2,
                padding: '0 8px',
                height: 36,
              }}
            >
              <span style={{ fontFamily: te.mono, fontSize: '12px', fontWeight: 700, color: te.orange, marginRight: '8px' }}>$</span>
              <input
                type="number"
                value={amountUsdt}
                onChange={e => { setAmountUsdt(e.target.value); setOrderResult(null) }}
                style={{
                  flex: 1,
                  fontFamily: te.mono,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: te.text,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
                min={1}
                max={10000}
                step={1}
              />
              <span style={{ fontFamily: te.mono, fontSize: '9px', color: te.textDim }}>USDT</span>
            </div>

            {/* Quick presets */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
              {presets.map(preset => (
                <button
                  key={preset}
                  onClick={() => { setAmountUsdt(String(preset)); setOrderResult(null) }}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    background: numAmount === preset ? `${te.orange}22` : te.bg,
                    border: `1px solid ${numAmount === preset ? te.orange : te.border}`,
                    borderRadius: 2,
                    color: numAmount === preset ? te.orange : te.textMuted,
                    fontFamily: te.mono,
                    fontSize: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  ${preset}
                </button>
              ))}
            </div>

            {/* Balance info */}
            <div style={{
              fontFamily: te.mono, fontSize: '7px', color: te.textDim, marginTop: '4px',
              letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between',
            }}>
              <span>DOSTĘPNE: {usdtBalance.toFixed(2)} USDT</span>
              {numAmount > usdtBalance && (
                <span style={{ color: te.red, fontWeight: 600 }}>NIEWYSTARCZAJĄCE</span>
              )}
            </div>
          </div>

          <Separator />

          {/* ── Order Summary ── */}
          <div
            style={{
              background: te.bg,
              border: `1px solid ${te.border}`,
              borderRadius: 2,
              padding: '10px',
              marginBottom: '12px',
            }}
          >
            <div style={{ fontFamily: te.mono, fontSize: '7px', color: te.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
              <PixelIcon grid={PIXEL_ICONS.target} color={te.orange} size={10} /> PODSUMOWANIE ZAMÓWIENIA
            </div>
            {[
              { label: 'TYP', value: 'MARKET BUY', color: te.green },
              { label: 'PARA', value: `${target.symbol.toUpperCase()}/USDT`, color: te.text },
              { label: 'KWOTA', value: `$${numAmount.toFixed(2)}`, color: te.text },
              { label: 'OPŁATA', value: `-$${feeUsdt.toFixed(2)} (${fee}%)`, color: te.textMuted },
              { label: 'NETTO', value: `$${netUsdt.toFixed(2)}`, color: te.text },
              { label: 'ILOŚĆ', value: estimatedQty < 1 ? estimatedQty.toFixed(6) : estimatedQty.toFixed(4), color: te.purple },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '3px 0',
                  borderBottom: i < 5 ? `1px solid ${te.border}33` : 'none',
                }}
              >
                <span style={{ fontFamily: te.mono, fontSize: '8px', color: te.textDim, letterSpacing: '0.06em' }}>
                  {item.label}
                </span>
                <span style={{ fontFamily: te.mono, fontSize: '10px', fontWeight: 700, color: item.color, fontVariantNumeric: 'tabular-nums' }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {/* ── Buy Button ── */}
          <button
            onClick={handleBuy}
            disabled={submitting || numAmount <= 0 || numAmount > 10000 || (mode === 'real' && numAmount > usdtBalance)}
            style={{
              width: '100%',
              padding: '12px',
              background: submitting ? te.textDim : te.green,
              border: `1px solid ${submitting ? te.textDim : te.green}`,
              borderRadius: 2,
              color: '#000',
              fontFamily: te.mono,
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s, transform 0.1s',
              opacity: (mode === 'real' && numAmount > usdtBalance) ? 0.4 : 1,
            }}
            onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = '#00cc44' }}
            onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.background = te.green }}
          >
            {submitting ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                WYKONYWANIE...
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <PixelIcon grid={PIXEL_ICONS.lightning} color="#000" size={14} />
                KUP {target.symbol.toUpperCase()} — ${numAmount.toFixed(0)}
              </span>
            )}
          </button>

          {/* Mode warning for real */}
          {mode === 'real' && (
            <div style={{
              fontFamily: te.mono, fontSize: '7px', color: te.red, marginTop: '6px',
              textAlign: 'center', letterSpacing: '0.06em', fontWeight: 600,
            }}>
              UWAGA: TRYB REAL — ZAMÓWIENIE NIEODWRACALNE
            </div>
          )}

          {/* ── Order Result ── */}
          {orderResult && (
            <div
              style={{
                marginTop: '12px',
                background: orderResult.success ? `${te.green}10` : `${te.red}10`,
                border: `1px solid ${orderResult.success ? te.green : te.red}44`,
                borderRadius: 2,
                padding: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <LED color={orderResult.success ? te.green : te.red} active />
                <span style={{
                  fontFamily: te.mono, fontSize: '9px', fontWeight: 700,
                  color: orderResult.success ? te.green : te.red,
                  letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                }}>
                  {orderResult.success ? 'ZAMÓWIENIE ZŁOŻONE' : 'BŁĄD'}
                </span>
              </div>
              {orderResult.success ? (
                <div style={{ fontFamily: te.mono, fontSize: '9px', color: te.text }}>
                  <div>Para: <strong>{orderResult.symbol}</strong></div>
                  <div>ID: <strong>{orderResult.orderId}</strong></div>
                  {orderResult.estimatedPrice && (
                    <div>Cena: <strong>{formatPrice(orderResult.estimatedPrice)}</strong></div>
                  )}
                </div>
              ) : (
                <div style={{ fontFamily: te.mono, fontSize: '9px', color: te.red }}>
                  {orderResult.error || 'Unknown error'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ marginTop: 'auto', padding: '8px 16px', borderTop: `1px solid ${te.border}`, background: te.bg }}>
          <div style={{ fontFamily: te.mono, fontSize: '6px', color: te.textDim, letterSpacing: '0.06em', textAlign: 'center' }}>
            BRRR TRADE ENGINE v0.1 — MARKET BUY ONLY
          </div>
        </div>
      </div>
    </>
  )
}
