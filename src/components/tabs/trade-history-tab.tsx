'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TE } from '@/lib/te-theme'
import { Upload, BarChart3, Trash2, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'

interface Analytics {
  total: number
  totalPnl: number
  winRate: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  avgTpMovePct: number
  avgStopMovePct: number
  rrRatio: number
  pairStats: Array<{ pair: string; pnl: number; count: number; winRate: number }>
  worstPairs: Array<{ pair: string; pnl: number; count: number; winRate: number }>
  triggerStats: Array<{ trigger: string; pnl: number; count: number; winRate: number }>
  dailyPnl: Array<{ date: string; pnl: number; count: number }>
  batches: Array<{ batch: string; count: number; pnl: number }>
  recommended: { tpPricePct: number; slPricePct: number; whitelist: string[]; blacklist: string[] }
  message?: string
}

const CSV_DIR = 'C:\\Users\\pieczywo\\Desktop\\Appki\\BRRR\\Stare wersje\\CSV'

export default function TradeHistoryTab() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState('')

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/trades/analytics')
      const data = await res.json()
      setAnalytics(data)
    } catch {
      setStatus('Błąd pobierania analityki')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAnalytics() }, [fetchAnalytics])

  const importFromDirectory = async () => {
    setImporting(true)
    setStatus('Importowanie... (użyj: node scripts/import-csv-direct.mjs dla szybkiego importu)')
    try {
      const res = await fetch('/api/trades/analytics')
      const data = await res.json()
      if (data.total > 0) {
        setStatus(`Dane już załadowane: ${data.total.toLocaleString()} transakcji`)
        setAnalytics(data)
      } else {
        setStatus('Brak danych — uruchom: node scripts/import-csv-direct.mjs')
      }
    } catch {
      setStatus('Błąd — uruchom: node scripts/import-csv-direct.mjs')
    } finally {
      setImporting(false)
    }
  }

  const importFile = async (file: File) => {
    setImporting(true)
    const text = await file.text()
    try {
      const res = await fetch('/api/trades/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text, batch: `file-${Date.now()}` }),
      })
      const data = await res.json()
      setStatus(data.success ? `Zaimportowano ${data.inserted} transakcji` : (data.error ?? 'Error'))
      if (data.success) await fetchAnalytics()
    } finally {
      setImporting(false)
    }
  }

  const clearAll = async () => {
    if (!confirm('Usunąć wszystkie zaimportowane transakcje?')) return
    await fetch('/api/trades/analytics', { method: 'DELETE' })
    setAnalytics(null)
    setStatus('Wyczyszczono')
    await fetchAnalytics()
  }

  const Stat = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div className="p-3 rounded border" style={{ borderColor: TE.border, background: TE.bgCard }}>
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-lg font-mono font-semibold" style={{ color: color ?? TE.text }}>{value}</div>
    </div>
  )

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5" style={{ color: TE.orange }} />
          <h2 className="text-lg font-semibold">Historia Transakcji</h2>
          {analytics?.total ? (
            <Badge variant="outline">{analytics.total.toLocaleString()} trades</Badge>
          ) : null}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => void fetchAnalytics()} disabled={loading}>
            <RefreshCw className="size-3.5 mr-1" /> Odśwież
          </Button>
          <Button size="sm" onClick={() => void importFromDirectory()} disabled={importing}
            style={{ background: TE.orange, color: '#000' }}>
            <Upload className="size-3.5 mr-1" /> Import 162 CSV
          </Button>
          <label>
            <Button size="sm" variant="outline" asChild disabled={importing}>
              <span><Upload className="size-3.5 mr-1" /> Import plik</span>
            </Button>
            <input type="file" accept=".csv" className="hidden" onChange={e => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
            }} />
          </label>
          <Button size="sm" variant="destructive" onClick={() => void clearAll()}>
            <Trash2 className="size-3.5 mr-1" /> Wyczyść
          </Button>
        </div>
      </div>

      {status && <p className="text-sm opacity-70">{status}</p>}

      {!analytics?.total ? (
        <div className="text-center py-12 opacity-60">
          <p>Brak danych. Kliknij &quot;Import 162 CSV&quot; aby załadować historię Dip Hunter.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <Stat label="Total PnL" value={`$${analytics.totalPnl}`}
              color={analytics.totalPnl >= 0 ? TE.green : TE.red} />
            <Stat label="Win Rate" value={`${analytics.winRate}%`} />
            <Stat label="Profit Factor" value={analytics.profitFactor}
              color={analytics.profitFactor >= 1.2 ? TE.green : TE.red} />
            <Stat label="R:R Ratio" value={analytics.rrRatio}
              color={analytics.rrRatio >= 1 ? TE.green : TE.red} />
            <Stat label="Avg Win" value={`$${analytics.avgWin}`} color={TE.green} />
            <Stat label="Avg Loss" value={`$${analytics.avgLoss}`} color={TE.red} />
            <Stat label="TP Move %" value={`${analytics.avgTpMovePct}%`} />
            <Stat label="STOP Move %" value={`${analytics.avgStopMovePct}%`} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded p-3" style={{ borderColor: TE.border }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <TrendingUp className="size-4" style={{ color: TE.green }} /> Top Pairs
              </h3>
              <table className="w-full text-xs">
                <thead><tr className="opacity-50"><th className="text-left">Pair</th><th>PnL</th><th>WR</th><th>N</th></tr></thead>
                <tbody>
                  {analytics.pairStats.slice(0, 8).map(p => (
                    <tr key={p.pair} className="border-t" style={{ borderColor: TE.border }}>
                      <td>{p.pair}</td>
                      <td className="text-right font-mono" style={{ color: p.pnl >= 0 ? TE.green : TE.red }}>
                        ${p.pnl.toFixed(2)}
                      </td>
                      <td className="text-right">{p.winRate.toFixed(1)}%</td>
                      <td className="text-right">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border rounded p-3" style={{ borderColor: TE.border }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <TrendingDown className="size-4" style={{ color: TE.red }} /> Worst Pairs (blacklist)
              </h3>
              <table className="w-full text-xs">
                <thead><tr className="opacity-50"><th className="text-left">Pair</th><th>PnL</th><th>WR</th><th>N</th></tr></thead>
                <tbody>
                  {analytics.worstPairs.map(p => (
                    <tr key={p.pair} className="border-t" style={{ borderColor: TE.border }}>
                      <td>{p.pair}</td>
                      <td className="text-right font-mono" style={{ color: TE.red }}>${p.pnl.toFixed(2)}</td>
                      <td className="text-right">{p.winRate.toFixed(1)}%</td>
                      <td className="text-right">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded p-3" style={{ borderColor: TE.border }}>
            <h3 className="text-sm font-semibold mb-2">Rekomendacje (z analizy 48k trades)</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>TP: {analytics.recommended.tpPricePct}% price</Badge>
              <Badge>SL: {analytics.recommended.slPricePct}% price</Badge>
              <Badge variant="outline" style={{ color: TE.green }}>
                WL: {analytics.recommended.whitelist.join(', ')}
              </Badge>
              <Badge variant="outline" style={{ color: TE.red }}>
                BL: {analytics.recommended.blacklist.join(', ')}
              </Badge>
            </div>
          </div>
        </>
      )}
    </div>
  )
}