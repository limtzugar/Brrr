'use client'

// @ts-nocheck — legacy file from previous session, needs refactoring
// ─── Transfer Tab — TE Clean Style ────────────────────────────────────────
// Crypto transfer/withdrawal interface with TE design language.
// Clean monospace typography, sharp edges, industrial functional layout.

'use client'

import { useState, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TE, useTE } from '@/lib/te-theme'
import { PIXEL_ICONS } from '@/components/pixel-art'

// ─── PixelIcon (local, matching existing tab pattern) ──────────────────────

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

// ─── Types ──────────────────────────────────────────────────────────────────

type ExchangeSource = 'bybit' | 'mexc' | 'binance' | 'phantom'
type AssetSymbol = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'USDC' | 'BNB' | 'XRP' | 'DOGE'

interface TransferForm {
  from: ExchangeSource
  to: ExchangeSource
  asset: AssetSymbol
  amount: string
  network: string
  address: string
  memo: string
}

interface TransferRecord {
  id: string
  from: ExchangeSource
  to: ExchangeSource
  asset: AssetSymbol
  amount: string
  network: string
  address: string
  status: 'pending' | 'confirming' | 'completed' | 'failed'
  txHash: string
  createdAt: string
  fee: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EXCHANGES: { value: ExchangeSource; label: string }[] = [
  { value: 'bybit', label: 'BYBIT' },
  { value: 'mexc', label: 'MEXC' },
  { value: 'binance', label: 'BINANCE' },
  { value: 'phantom', label: 'PHANTOM' },
]

const ASSETS: { value: AssetSymbol; label: string }[] = [
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
  { value: 'SOL', label: 'SOL' },
  { value: 'USDT', label: 'USDT' },
  { value: 'USDC', label: 'USDC' },
  { value: 'BNB', label: 'BNB' },
  { value: 'XRP', label: 'XRP' },
  { value: 'DOGE', label: 'DOGE' },
]

const NETWORK_MAP: Record<AssetSymbol, { value: string; label: string }[]> = {
  BTC: [{ value: 'bitcoin', label: 'Bitcoin' }],
  ETH: [
    { value: 'ethereum', label: 'Ethereum (ERC-20)' },
    { value: 'arbitrum', label: 'Arbitrum' },
    { value: 'optimism', label: 'Optimism' },
  ],
  SOL: [{ value: 'solana', label: 'Solana' }],
  USDT: [
    { value: 'ethereum', label: 'Ethereum (ERC-20)' },
    { value: 'tron', label: 'Tron (TRC-20)' },
    { value: 'solana', label: 'Solana' },
    { value: 'bsc', label: 'BSC (BEP-20)' },
  ],
  USDC: [
    { value: 'ethereum', label: 'Ethereum (ERC-20)' },
    { value: 'solana', label: 'Solana' },
    { value: 'bsc', label: 'BSC (BEP-20)' },
  ],
  BNB: [{ value: 'bsc', label: 'BSC (BEP-20)' }],
  XRP: [{ value: 'xrp', label: 'XRP Ledger' }],
  DOGE: [{ value: 'dogecoin', label: 'Dogecoin' }],
}

const FEE_MAP: Record<string, string> = {
  bitcoin: '0.0001 BTC',
  ethereum: '0.001 ETH',
  arbitrum: '0.00005 ETH',
  optimism: '0.00005 ETH',
  solana: '0.00001 SOL',
  tron: '1 TRX',
  bsc: '0.0005 BNB',
  xrp: '0.25 XRP',
  dogecoin: '1 DOGE',
}

const MOCK_BALANCES: Record<ExchangeSource, Record<AssetSymbol, number>> = {
  bybit: { BTC: 0.05, ETH: 1.2, SOL: 15, USDT: 5420.50, USDC: 1200, BNB: 3, XRP: 500, DOGE: 10000 },
  mexc: { BTC: 0.01, ETH: 0.5, SOL: 8, USDT: 2300, USDC: 500, BNB: 1, XRP: 200, DOGE: 5000 },
  binance: { BTC: 0.12, ETH: 2.5, SOL: 30, USDT: 12000, USDC: 3000, BNB: 10, XRP: 1500, DOGE: 25000 },
  phantom: { BTC: 0, ETH: 0, SOL: 45, USDT: 0, USDC: 800, BNB: 0, XRP: 0, DOGE: 0 },
}

const MOCK_HISTORY: TransferRecord[] = [
  { id: 'tx-001', from: 'bybit', to: 'phantom', asset: 'SOL', amount: '10', network: 'solana', address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', status: 'completed', txHash: '5Kj…mN3p', createdAt: '2026-03-18T14:30:00Z', fee: '0.00001 SOL' },
  { id: 'tx-002', from: 'binance', to: 'bybit', asset: 'USDT', amount: '2000', network: 'tron', address: 'TJYSqMhMr4BYU9gKzwNE7c4kZPQF29c9nS', status: 'completed', txHash: 'a8f…2kL9', createdAt: '2026-03-17T09:15:00Z', fee: '1 TRX' },
  { id: 'tx-003', from: 'phantom', to: 'mexc', asset: 'USDC', amount: '500', network: 'solana', address: 'mexc_deposit_usdc_sol', status: 'pending', txHash: '3hR…pQ7z', createdAt: '2026-03-19T11:00:00Z', fee: '0.00001 SOL' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

// Use TE dark tokens directly (no theme context needed)
const T = TE

function statusColor(T: typeof TE, status: TransferRecord['status']): string {
  switch (status) {
    case 'completed': return T.green
    case 'pending': return T.yellow
    case 'confirming': return T.cyan
    case 'failed': return T.red
  }
}

function statusLabel(status: TransferRecord['status']): string {
  switch (status) {
    case 'completed': return 'COMPLETED'
    case 'pending': return 'PENDING'
    case 'confirming': return 'CONFIRMING'
    case 'failed': return 'FAILED'
  }
}

function exchangeLabel(src: ExchangeSource): string {
  return EXCHANGES.find(e => e.value === src)?.label ?? src.toUpperCase()
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function TransferTab() {
  const te = useTE()

  const [form, setForm] = useState<TransferForm>({
    from: 'bybit',
    to: 'phantom',
    asset: 'SOL',
    amount: '',
    network: 'solana',
    address: '',
    memo: '',
  })

  const [confirmStep, setConfirmStep] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)
  const [history] = useState<TransferRecord[]>(MOCK_HISTORY)

  const availableNetworks = useMemo(() => NETWORK_MAP[form.asset] ?? [], [form.asset])
  const estimatedFee = FEE_MAP[form.network] ?? '—'
  const availableBalance = MOCK_BALANCES[form.from]?.[form.asset] ?? 0

  const updateForm = useCallback(<K extends keyof TransferForm>(key: K, value: TransferForm[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      // Auto-select network when asset changes
      if (key === 'asset') {
        const networks = NETWORK_MAP[value as AssetSymbol]
        if (networks && networks.length > 0) {
          next.network = networks[0].value
        }
      }
      // Prevent same source and destination
      if (key === 'from' && value === next.to) {
        next.to = EXCHANGES.find(e => e.value !== value)?.value ?? 'phantom'
      }
      if (key === 'to' && value === next.from) {
        next.from = EXCHANGES.find(e => e.value !== value)?.value ?? 'bybit'
      }
      return next
    })
  }, [])

  const handleMax = useCallback(() => {
    setForm(prev => ({ ...prev, amount: String(availableBalance) }))
  }, [availableBalance])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      setForm(prev => ({ ...prev, address: text.trim() }))
    } catch {
      // Clipboard not available
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!confirmStep) {
      setConfirmStep(true)
      return
    }

    setSubmitting(true)
    setSubmitResult(null)

    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          asset: form.asset,
          amount: form.amount,
          network: form.network,
          address: form.address,
          memo: form.memo || undefined,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setSubmitResult({ success: true, message: data.message || 'Transfer initiated successfully' })
        setForm(prev => ({ ...prev, amount: '', address: '', memo: '' }))
        setConfirmStep(false)
      } else {
        setSubmitResult({ success: false, message: data.error || 'Transfer failed' })
        setConfirmStep(false)
      }
    } catch {
      setSubmitResult({ success: false, message: 'Network error — check connection' })
      setConfirmStep(false)
    } finally {
      setSubmitting(false)
    }
  }, [confirmStep, form])

  const handleCancel = useCallback(() => {
    setConfirmStep(false)
    setSubmitResult(null)
  }, [])

  const isFormValid = form.amount && Number(form.amount) > 0 && form.address.trim().length > 0

  // ─── Shared Input Style ──────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    background: T.bgInput,
    borderColor: T.border,
    color: T.text,
    fontFamily: T.mono,
    borderRadius: 2,
    fontSize: '12px',
  }

  const selectStyle: React.CSSProperties = {
    background: T.bgInput,
    borderColor: T.border,
    color: T.text,
    fontFamily: T.mono,
    borderRadius: 2,
    fontSize: '12px',
  }

  const selectContentStyle: React.CSSProperties = {
    background: te.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 2,
  }

  const sectionHeaderStyle = (color: string): React.CSSProperties => ({
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderBottom: `1px solid ${color}`,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  })

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Transfer Form Panel ─────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${T.border}`, background: T.bgCard }}>
        {/* Panel Header */}
        <div style={sectionHeaderStyle(T.pink)}>
          <PixelIcon grid={PIXEL_ICONS.transfer} color={T.pink} size={18} />
          <span className="font-mono text-[11px] font-semibold tracking-wider uppercase" style={{ color: T.pink }}>
            CRYPTO TRANSFER
          </span>
          <div style={{ flex: 1 }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.green, boxShadow: `0 0 4px ${T.green}` }} />
          <span className="font-mono text-[9px] tracking-wider uppercase" style={{ color: T.textDim }}>READY</span>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-4">
          {/* Source / Destination Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source */}
            <div>
              <label className="te-label block mb-1.5">Source</label>
              <Select value={form.from} onValueChange={v => updateForm('from', v as ExchangeSource)}>
                <SelectTrigger className="h-9 w-full" style={selectStyle}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={selectContentStyle}>
                  {EXCHANGES.map(ex => (
                    <SelectItem key={ex.value} value={ex.value} className="font-mono text-[11px]" style={{ color: te.text }}>
                      {ex.label}
                      {ex.value === 'phantom' ? ' (External)' : ' (Exchange)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Destination */}
            <div>
              <label className="te-label block mb-1.5">Destination</label>
              <Select value={form.to} onValueChange={v => updateForm('to', v as ExchangeSource)}>
                <SelectTrigger className="h-9 w-full" style={selectStyle}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={selectContentStyle}>
                  {EXCHANGES.map(ex => (
                    <SelectItem key={ex.value} value={ex.value} className="font-mono text-[11px]" style={{ color: te.text }}>
                      {ex.label}
                      {ex.value === 'phantom' ? ' (External)' : ' (Exchange)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Transfer Direction Indicator */}
          <div className="flex items-center justify-center py-1">
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: `${T.pink}10`, border: `1px solid ${T.pink}33` }}>
              <span className="font-mono text-[10px] font-semibold" style={{ color: T.textMuted }}>{exchangeLabel(form.from)}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.pink} strokeWidth="2" strokeLinecap="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              <span className="font-mono text-[10px] font-semibold" style={{ color: T.textMuted }}>{exchangeLabel(form.to)}</span>
            </div>
          </div>

          {/* Asset / Amount Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Asset */}
            <div>
              <label className="te-label block mb-1.5">Asset</label>
              <Select value={form.asset} onValueChange={v => updateForm('asset', v as AssetSymbol)}>
                <SelectTrigger className="h-9 w-full" style={selectStyle}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={selectContentStyle}>
                  {ASSETS.map(a => (
                    <SelectItem key={a.value} value={a.value} className="font-mono text-[11px]" style={{ color: te.text }}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="te-label">Amount</label>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px]" style={{ color: T.textDim }}>
                    Available: {availableBalance} {form.asset}
                  </span>
                  <button
                    className="te-btn"
                    style={{ padding: '2px 8px', fontSize: '9px' }}
                    onClick={handleMax}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => updateForm('amount', e.target.value)}
                  className="h-9 pr-16"
                  style={inputStyle}
                  step="any"
                  min="0"
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] font-semibold"
                  style={{ color: T.textDim }}
                >
                  {form.asset}
                </span>
              </div>
            </div>
          </div>

          {/* Network */}
          <div>
            <label className="te-label block mb-1.5">Network</label>
            <Select value={form.network} onValueChange={v => updateForm('network', v)}>
              <SelectTrigger className="h-9 w-full" style={selectStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={selectContentStyle}>
                {availableNetworks.map(n => (
                  <SelectItem key={n.value} value={n.value} className="font-mono text-[11px]" style={{ color: te.text }}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="font-mono text-[9px] mt-1 block" style={{ color: T.textDim }}>
              ⚠ Make sure the network matches the destination address
            </span>
          </div>

          {/* Destination Address */}
          <div>
            <label className="te-label block mb-1.5">Destination Address</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder={form.to === 'phantom' ? 'Enter wallet address (e.g. Solana address)' : 'Enter deposit address'}
                value={form.address}
                onChange={e => updateForm('address', e.target.value)}
                className="h-9 flex-1"
                style={inputStyle}
              />
              <button
                className="te-btn"
                style={{ padding: '0 12px', fontSize: '9px', height: '36px' }}
                onClick={handlePaste}
                title="Paste from clipboard"
              >
                PASTE
              </button>
            </div>
          </div>

          {/* Memo / Tag */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="te-label">Memo / Tag</label>
              <span className="font-mono text-[8px]" style={{ color: T.textDim }}>(optional)</span>
            </div>
            <Input
              type="text"
              placeholder="Required for some exchanges (e.g. Binance memo)"
              value={form.memo}
              onChange={e => updateForm('memo', e.target.value)}
              className="h-9"
              style={inputStyle}
            />
          </div>

          {/* Fee Estimate */}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: T.bgInput, border: `1px solid ${T.border}` }}>
            <span className="te-label">Estimated Fee</span>
            <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color: T.text }}>
              {estimatedFee}
            </span>
          </div>

          {/* Confirmation Step */}
          {confirmStep && (
            <div className="p-3 space-y-2" style={{ background: `${T.pink}08`, border: `1px solid ${T.pink}33` }}>
              <div className="flex items-center gap-2 mb-2">
                <PixelIcon grid={PIXEL_ICONS.warning} color={T.yellow} size={16} />
                <span className="font-mono text-[11px] font-semibold" style={{ color: T.yellow }}>CONFIRM TRANSFER</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="te-label">From</span>
                <span className="font-mono text-[11px]" style={{ color: T.text }}>{exchangeLabel(form.from)}</span>
                <span className="te-label">To</span>
                <span className="font-mono text-[11px]" style={{ color: T.text }}>{exchangeLabel(form.to)}</span>
                <span className="te-label">Asset</span>
                <span className="font-mono text-[11px]" style={{ color: T.text }}>{form.amount} {form.asset}</span>
                <span className="te-label">Network</span>
                <span className="font-mono text-[11px]" style={{ color: T.text }}>{NETWORK_MAP[form.asset]?.find(n => n.value === form.network)?.label ?? form.network}</span>
                <span className="te-label">Address</span>
                <span className="font-mono text-[10px] truncate" style={{ color: T.text }}>{form.address}</span>
                <span className="te-label">Fee</span>
                <span className="font-mono text-[11px]" style={{ color: T.text }}>{estimatedFee}</span>
                {form.memo && (
                  <>
                    <span className="te-label">Memo</span>
                    <span className="font-mono text-[11px]" style={{ color: T.text }}>{form.memo}</span>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  className="te-btn te-btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'PROCESSING…' : 'CONFIRM & SEND'}
                </button>
                <button
                  className="te-btn"
                  onClick={handleCancel}
                  disabled={submitting}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* Submit Result */}
          {submitResult && (
            <div className="p-3" style={{
              background: submitResult.success ? T.greenBg : T.redBg,
              border: `1px solid ${submitResult.success ? T.green + '44' : T.red + '44'}`,
            }}>
              <span className="font-mono text-[11px]" style={{ color: submitResult.success ? T.green : T.red }}>
                {submitResult.message}
              </span>
            </div>
          )}

          {/* Transfer Button (when not in confirm step) */}
          {!confirmStep && (
            <button
              className="te-btn te-btn-primary w-full justify-center"
              onClick={handleSubmit}
              disabled={!isFormValid}
              style={{ opacity: isFormValid ? 1 : 0.4, cursor: isFormValid ? 'pointer' : 'not-allowed' }}
            >
              <PixelIcon grid={PIXEL_ICONS.transfer} color={isFormValid ? '#050505' : T.textDim} size={14} />
              TRANSFER {form.asset}
            </button>
          )}
        </div>
      </div>

      {/* ── Recent Transfers Panel ──────────────────────────────────────── */}
      <div style={{ border: `1px solid ${T.border}`, background: T.bgCard }}>
        {/* Panel Header */}
        <div style={sectionHeaderStyle(T.textMuted)}>
          <PixelIcon grid={PIXEL_ICONS.signal} color={T.textMuted} size={16} />
          <span className="font-mono text-[11px] font-semibold tracking-wider uppercase" style={{ color: T.textMuted }}>
            RECENT TRANSFERS
          </span>
          <div style={{ flex: 1 }} />
          <span className="font-mono text-[9px] tracking-wider uppercase" style={{ color: T.textDim }}>
            {history.length} RECORDS
          </span>
        </div>

        {/* Table */}
        {history.length === 0 ? (
          <div className="py-8 text-center">
            <PixelIcon grid={PIXEL_ICONS.eye} color={T.textDim} size={24} />
            <p className="font-mono text-[11px] mt-2" style={{ color: T.textMuted }}>No transfer history</p>
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['DATE', 'FROM → TO', 'ASSET', 'AMOUNT', 'NETWORK', 'FEE', 'STATUS'].map(h => (
                    <th
                      key={h}
                      className="font-mono text-[9px] font-semibold tracking-wider uppercase text-left px-3 py-2"
                      style={{ color: T.textDim, background: T.bgInput }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(tx => (
                  <tr key={tx.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[10px] tabular-nums" style={{ color: T.textMuted }}>
                        {new Date(tx.createdAt).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[10px]" style={{ color: T.text }}>
                        {exchangeLabel(tx.from)} → {exchangeLabel(tx.to)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[10px] font-bold" style={{ color: T.text }}>{tx.asset}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[10px] tabular-nums" style={{ color: T.text }}>{tx.amount}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[9px]" style={{ color: T.textMuted }}>{tx.network}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[9px] tabular-nums" style={{ color: T.textDim }}>{tx.fee}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(T, tx.status), boxShadow: `0 0 4px ${statusColor(T, tx.status)}` }} />
                        <span className="font-mono text-[9px] font-semibold" style={{ color: statusColor(T, tx.status) }}>
                          {statusLabel(tx.status)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
