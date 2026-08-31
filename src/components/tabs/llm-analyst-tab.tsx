'use client'

// ─── LLM Analyst Tab — per-strategy analysis + convictions + shadow + walk-forward ─
// Strategy cards with LLM insights, conviction pipeline (hypothesis→conviction),
// shadow evaluations history, and walk-forward evaluation runner.

import { useState, useEffect, useCallback } from 'react'
import { useTE } from '@/lib/te-theme'
import {
  Brain, RefreshCw, AlertTriangle, Settings, Trash2, History,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Lightbulb,
  Shield, BarChart3, Play, Eye, EyeOff, Zap, Target, Plus,
} from 'lucide-react'

const STRATEGY_META: Record<string, { name: string; icon: string; color: string }> = {
  dip_buying:    { name: 'Dip Buying',    icon: '📉', color: '#10a37f' },
  momentum:       { name: 'Momentum',      icon: '🚀', color: '#4285f4' },
  mean_reversion: { name: 'Mean Reversion',icon: '🔄', color: '#f59e0b' },
  breakout:       { name: 'Breakout',      icon: '💥', color: '#ef4444' },
  dca:            { name: 'DCA',           icon: '📊', color: '#8b5cf6' },
  grid:           { name: 'Grid',          icon: '📏', color: '#ec4899' },
  hurst_hcoo_lb:  { name: 'Hurst HCOO',    icon: '🌊', color: '#06b6d4' },
  cex_anomaly:    { name: 'CEX Anomaly',   icon: '⚡', color: '#f97316' },
  gravity_scalper:{ name: 'Gravity Scalper',icon: '🎯', color: '#84cc16' },
  global:         { name: 'Globalne',      icon: '🌍', color: '#64748b' },
}

interface LlmConfigPublic { provider: string; model: string; apiKeyMasked: string; isConfigured: boolean }

interface LlmHypothesis {
  pattern: string; rationale: string; pair?: string; direction?: string
  category?: string; evidence?: string[]; invalidators?: string[]; confidence: number; status: string
}

interface StrategyAnalysis {
  strategyType: string; strategyName: string; summary: string
  strengths: string[]; weaknesses: string[]
  hypotheses: LlmHypothesis[]; recommendations: string[]; confidence: number
}

interface LlmReport {
  timestamp: string; scope?: string; provider?: string; model?: string
  report: string; insights?: string[]; recommendations?: string[]
  strategies?: StrategyAnalysis[]; globalHypotheses?: LlmHypothesis[]; confidence: number
}

interface Conviction {
  id: string; source: string; status: string; strategyType: string; symbol: string | null
  direction: string; thesis: string; confidence: number; evidence: string[]
  invalidators: string[]; category: string | null; convictionStrength: number
  validatedAt: string | null; validationBy: string | null; createdAt: string
}

interface ShadowEval {
  id: string; decisionId: string; status: string; recommendation: string | null
  confidence: number | null; thesis: string | null; arguments: string[]
  invalidators: string[]; symbol: string; strategyType: string; action: string
  decidedAt: string; completedAt: string | null; errorMessage: string | null
}

interface EvaluationRun {
  id: string; horizon: string; status: string; sampleCount: number
  outOfSampleCount: number; foldCount: number
  baselineMeanReturn: number | null; llmMeanReturn: number | null
  deltaMeanReturn: number | null; confidenceLower95: number | null
  confidenceUpper95: number | null; completedAt: string
}

export default function LlmAnalystTab() {
  const te = useTE()
  const [config, setConfig] = useState<LlmConfigPublic | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [report, setReport] = useState<LlmReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<LlmReport[]>([])
  const [convictions, setConvictions] = useState<Conviction[]>([])
  const [shadowEvals, setShadowEvals] = useState<ShadowEval[]>([])
  const [shadowEnabled, setShadowEnabled] = useState(true)
  const [evalRuns, setEvalRuns] = useState<EvaluationRun[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shadowOpen, setShadowOpen] = useState(false)
  const [walkForwardOpen, setWalkForwardOpen] = useState(false)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})

  // Walk-forward config
  const [wfHorizon, setWfHorizon] = useState('24H')
  const [wfFolds, setWfFolds] = useState(3)
  const [wfRunning, setWfRunning] = useState(false)
  const [wfError, setWfError] = useState<string | null>(null)

  const refreshAll = useCallback(async () => {
    try {
      const [cfgRes, histRes, convRes, shadowRes, evalRes] = await Promise.allSettled([
        fetch('/api/llm-settings'),
        fetch('/api/llm-analyst'),
        fetch('/api/convictions'),
        fetch('/api/llm-shadow?limit=50'),
        fetch('/api/llm-evaluation'),
      ])
      if (cfgRes.status === 'fulfilled' && cfgRes.value.ok) {
        const d = await cfgRes.value.json(); setConfig(d.config)
      }
      if (histRes.status === 'fulfilled' && histRes.value.ok) {
        const d = await histRes.value.json(); setHistory(d.reports || [])
      }
      if (convRes.status === 'fulfilled' && convRes.value.ok) {
        setConvictions(await convRes.value.json())
      }
      if (shadowRes.status === 'fulfilled' && shadowRes.value.ok) {
        const d = await shadowRes.value.json()
        setShadowEvals(d.evaluations || [])
        setShadowEnabled(d.enabled)
      }
      if (evalRes.status === 'fulfilled' && evalRes.value.ok) {
        setEvalRuns((await evalRes.value.json()).runs || [])
      }
    } catch {}
  }, [])

  useEffect(() => { void refreshAll() }, [refreshAll])

  const runAnalysis = useCallback(async () => {
    if (!config?.isConfigured) { setError('LLM nie jest skonfigurowany.'); return }
    setAnalyzing(true); setError(null)
    try {
      const settled = await Promise.allSettled([
        fetch('/api/exchange').then(r => r.ok ? r.json() : null),
        fetch('/api/portfolio').then(r => r.ok ? r.json() : null),
        fetch('/api/strategies/status').then(r => r.ok ? r.json() : null),
        fetch('/api/fear-greed').then(r => r.ok ? r.json() : null),
        fetch('/api/regime/analysis').then(r => r.ok ? r.json() : null),
        fetch('/api/ccxt/oi-funding').then(r => r.ok ? r.json() : null),
      ])
      const portfolio = settled[1].status === 'fulfilled' ? settled[1].value : null
      const strategies = settled[2].status === 'fulfilled' ? (settled[2].value?.strategies || []) : []
      const fearGreed = settled[3].status === 'fulfilled' ? settled[3].value : null
      const regime = settled[4].status === 'fulfilled' ? settled[4].value : null
      const oiFunding = settled[5].status === 'fulfilled' ? settled[5].value : null

      let positions: any[] = []; let closedPositions: any[] = []
      const exchangeData = settled[0].status === 'fulfilled' ? settled[0].value : null
      const exchanges: any[] = exchangeData?.exchanges || []
      const bybitConfigured = exchanges.find((e: any) => e.exchange === 'bybit' && e.isConfigured)
      if (bybitConfigured) {
        try {
          const posRes = await fetch(`/api/bybit/futures/positions?mode=${bybitConfigured.mode}`)
          if (posRes.ok) { const d = await posRes.json(); positions = d.positions || [] }
        } catch {}
        try {
          const pnlRes = await fetch(`/api/bybit/futures/closed-pnl?mode=${bybitConfigured.mode}`)
          if (pnlRes.ok) { const d = await pnlRes.json(); closedPositions = (d.list || d.closedTrades || []).slice(0, 15) }
        } catch {}
      }

      const res = await fetch('/api/llm-analyst', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'full_system', portfolio, strategies, regime, macro: null,
          oiFunding, fearGreed, positions, closedPositions,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || 'Analiza nie powiodła się')
      }
      const data = await res.json()
      setReport(data)
      setExpandedCards({})
      await refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd analizy')
    } finally { setAnalyzing(false) }
  }, [config, refreshAll])

  const promoteConviction = async (convictionId: string) => {
    await fetch('/api/convictions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: convictionId, status: 'CONVICTION', validatedBy: 'MANUAL', convictionStrength: 0.8 }),
    })
    await refreshAll()
  }

  const rejectConviction = async (convictionId: string) => {
    await fetch('/api/convictions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: convictionId, status: 'REJECTED', validatedBy: 'MANUAL' }),
    })
    await refreshAll()
  }

  const deleteConviction = async (convictionId: string) => {
    await fetch(`/api/convictions?id=${convictionId}`, { method: 'DELETE' })
    await refreshAll()
  }

  const runWalkForward = async () => {
    setWfRunning(true); setWfError(null)
    try {
      const res = await fetch('/api/llm-evaluation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          horizon: wfHorizon, foldCount: wfFolds, feePct: 0.1, slippagePct: 0.05,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: 'Błąd' }))).error)
      await refreshAll()
    } catch (err) {
      setWfError(err instanceof Error ? err.message : 'Błąd walk-forward')
    } finally { setWfRunning(false) }
  }

  const toggleShadow = async (enable: boolean) => {
    await fetch('/api/llm-shadow', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable }),
    })
    setShadowEnabled(enable)
  }

  const clearHistory = async () => {
    if (!confirm('Wyczyścić historię raportów LLM?')) return
    await fetch('/api/llm-analyst', { method: 'DELETE' })
    setHistory([]); setReport(null)
  }

  const confidenceColor = (c: number) => c >= 60 ? te.green : c >= 40 ? te.orange : te.red
  const statusColor = (s: string) =>
    s === 'CONVICTION' ? te.green : s === 'REJECTED' ? te.red : s === 'VALIDATING' ? te.cyan : te.orange

  const convictionCounts = () => {
    const byStrategy: Record<string, { total: number; convicted: number; hypotheses: number; rejected: number }> = {}
    for (const c of convictions) {
      const key = c.strategyType || 'unknown'
      if (!byStrategy[key]) byStrategy[key] = { total: 0, convicted: 0, hypotheses: 0, rejected: 0 }
      byStrategy[key].total++
      if (c.status === 'CONVICTION') byStrategy[key].convicted++
      else if (c.status === 'HYPOTHESIS') byStrategy[key].hypotheses++
      else if (c.status === 'REJECTED') byStrategy[key].rejected++
    }
    return byStrategy
  }

  const toggleCard = (key: string) => {
    setExpandedCards(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* ── Header / Action Bar ───────────────────────────────────────────── */}
      <div className="rounded-sm flex items-center justify-between gap-3 px-3 py-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
        <div className="flex items-center gap-2">
          <Brain className="size-5" style={{ color: te.purple }} />
          <div>
            <div className="text-[13px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: te.purple }}>
              LLM ANALYST — PER STRATEGIA
            </div>
            <div className="text-[10px] font-mono" style={{ color: te.textDim }}>
              {config?.isConfigured
                ? `${config.provider} / ${config.model} · ${config.apiKeyMasked}`
                : 'Nie skonfigurowano modelu LLM'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('brrr:open-settings'))}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all"
            style={{ borderRadius: '2px', color: te.textMuted, background: te.bgInput, border: `1px solid ${te.border}` }}
          >
            <Settings className="size-3" /> USTAWIENIA
          </button>
          <button
            onClick={() => void runAnalysis()}
            disabled={analyzing || !config?.isConfigured}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
            style={{
              background: analyzing ? `${te.purple}30` : te.purple,
              color: '#fff', borderRadius: '2px', minWidth: '160px', justifyContent: 'center',
            }}
          >
            {analyzing ? <RefreshCw className="size-3.5 animate-spin" /> : <Brain className="size-3.5" />}
            {analyzing ? 'ANALIZUJĘ...' : '🔍 ANALIZUJ SYSTEM'}
          </button>
        </div>
      </div>

      {/* ── Not configured warning ────────────────────────────────────────── */}
      {!config?.isConfigured && (
        <div className="rounded-sm px-3 py-3 flex items-start gap-2" style={{ background: `${te.orange}10`, border: `1px solid ${te.orange}33` }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: te.orange }} />
          <div className="text-[11px] font-mono" style={{ color: te.text }}>
            <strong style={{ color: te.orange }}>Wymagana konfiguracja LLM.</strong> Otwórz Ustawienia → sekcja „LLM Analyst".
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="text-[11px] px-3 py-2 rounded-sm flex items-start gap-2" style={{ background: `${te.red}10`, color: te.red, border: `1px solid ${te.red}33`, fontFamily: te.mono }}>
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /><span className="break-all">{error}</span>
        </div>
      )}

      {/* ── Strategy Cards Grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Per-strategy cards from last report */}
        {report?.strategies?.map((strat) => {
          const meta = STRATEGY_META[strat.strategyType] || { name: strat.strategyName || strat.strategyType, icon: '📌', color: '#64748b' }
          const cardKey = `strat-${strat.strategyType}`
          const expanded = expandedCards[cardKey] !== false
          const counts = convictionCounts()[strat.strategyType] || { total: 0, convicted: 0, hypotheses: 0, rejected: 0 }

          return (
            <div key={cardKey} className="rounded-sm overflow-hidden" style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderLeft: `3px solid ${meta.color}` }}>
              <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => toggleCard(cardKey)}
                style={{ borderBottom: expanded ? `1px solid ${te.border}` : 'none' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px]">{meta.icon}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: meta.color }}>{meta.name}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ fontFamily: te.mono, color: confidenceColor(strat.confidence), background: `${confidenceColor(strat.confidence)}15` }}>
                    {strat.confidence}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {counts.convicted > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex items-center gap-1" style={{ color: te.green, background: `${te.green}15` }}>
                      <CheckCircle2 className="size-2.5" />{counts.convicted}
                    </span>
                  )}
                  {counts.hypotheses > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex items-center gap-1" style={{ color: te.orange, background: `${te.orange}15` }}>
                      <Lightbulb className="size-2.5" />{counts.hypotheses}
                    </span>
                  )}
                  {expanded ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
                </div>
              </div>

              {expanded && (
                <div className="px-3 py-2 space-y-2">
                  <div className="text-[10px] font-mono" style={{ color: te.text, lineHeight: 1.4 }}>{strat.summary}</div>

                  {strat.strengths.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold mb-0.5 uppercase" style={{ color: te.green }}>Mocne strony</div>
                      {strat.strengths.map((s, i) => <div key={i} className="text-[9px] font-mono" style={{ color: te.textMuted }}>+ {s}</div>)}
                    </div>
                  )}
                  {strat.weaknesses.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold mb-0.5 uppercase" style={{ color: te.red }}>Słabości</div>
                      {strat.weaknesses.map((w, i) => <div key={i} className="text-[9px] font-mono" style={{ color: te.textMuted }}>- {w}</div>)}
                    </div>
                  )}
                  {strat.recommendations.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold mb-0.5 uppercase" style={{ color: te.cyan }}>Rekomendacje</div>
                      {strat.recommendations.map((r, i) => <div key={i} className="text-[9px] font-mono" style={{ color: te.textMuted }}>→ {r}</div>)}
                    </div>
                  )}

                  {/* Hypotheses from this analysis */}
                  {strat.hypotheses.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold mb-1 uppercase flex items-center gap-1" style={{ color: te.purple }}>
                        <Lightbulb className="size-3" /> Hipotezy ({strat.hypotheses.length})
                      </div>
                      <div className="space-y-1">
                        {strat.hypotheses.map((h, i) => (
                          <div key={i} className="text-[9px] px-2 py-1.5 rounded-sm" style={{ fontFamily: te.mono, background: te.bg, border: `1px solid ${te.purple}22` }}>
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className="font-bold" style={{ color: te.orange }}>UNVALIDATED</span>
                              {h.direction !== 'NEUTRAL' && (
                                <span className="font-bold" style={{ color: h.direction === 'LONG' ? te.green : te.red }}>{h.direction}</span>
                              )}
                              {h.category && <span style={{ color: te.textDim }}>{h.category}</span>}
                              {h.pair && <span style={{ color: te.cyan }}>{h.pair}</span>}
                              <span style={{ color: confidenceColor(h.confidence) }}>{h.confidence}%</span>
                            </div>
                            <div style={{ color: te.text }}>{h.pattern}</div>
                            <div style={{ color: te.textMuted, fontSize: '8px' }}>{h.rationale.slice(0, 200)}</div>
                            {h.invalidators && h.invalidators.length > 0 && (
                              <div className="mt-0.5" style={{ color: te.red, fontSize: '8px' }}>
                                ❌ Unieważnia: {h.invalidators.join('; ').slice(0, 200)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* If no LLM analysis yet, show conviction-only cards */}
        {(!report?.strategies || report.strategies.length === 0) && convictions.length > 0 && (() => {
          const stratTypes = [...new Set(convictions.filter(c => c.strategyType !== 'global').map(c => c.strategyType))]
          if (stratTypes.length === 0) return null
          return stratTypes.map(st => {
            const meta = STRATEGY_META[st] || { name: st, icon: '📌', color: '#64748b' }
            const cardKey = `conv-${st}`
            const expanded = expandedCards[cardKey] !== false
            const stratConvictions = convictions.filter(c => c.strategyType === st)
            const convicted = stratConvictions.filter(c => c.status === 'CONVICTION')
            const hypotheses = stratConvictions.filter(c => c.status === 'HYPOTHESIS')

            return (
              <div key={cardKey} className="rounded-sm overflow-hidden" style={{ background: te.bgCard, border: `1px solid ${te.border}`, borderLeft: `3px solid ${meta.color}` }}>
                <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => toggleCard(cardKey)}
                  style={{ borderBottom: expanded ? `1px solid ${te.border}` : 'none' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">{meta.icon}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: meta.color }}>{meta.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {convicted.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ color: te.green, background: `${te.green}15` }}>{convicted.length} CONVICTION</span>}
                    {hypotheses.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ color: te.orange, background: `${te.orange}15` }}>{hypotheses.length} HYPOTHESIS</span>}
                    {expanded ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
                  </div>
                </div>
                {expanded && (
                  <div className="px-3 py-2 space-y-2">
                    {/* Convictions */}
                    {convicted.length > 0 && (
                      <div>
                        <div className="text-[9px] font-bold mb-1 uppercase flex items-center gap-1" style={{ color: te.green }}><CheckCircle2 className="size-3" /> Przekonania ({convicted.length})</div>
                        {convicted.map(c => (
                          <div key={c.id} className="text-[9px] px-2 py-1.5 mb-1 rounded-sm flex items-start justify-between gap-2" style={{ fontFamily: te.mono, background: te.bg, border: `1px solid ${te.green}33` }}>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold" style={{ color: te.green }}>CONVICTION</span>
                                {c.symbol && <span style={{ color: te.cyan }}>{c.symbol}</span>}
                                <span style={{ color: te.textDim }}>{c.confidence}%</span>
                              </div>
                              <div style={{ color: te.text }}>{c.thesis.slice(0, 250)}</div>
                            </div>
                            <button onClick={() => rejectConviction(c.id)} className="shrink-0" style={{ color: te.red }} title="Odrzuć"><XCircle className="size-3" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Hypotheses needing validation */}
                    {hypotheses.length > 0 && (
                      <div>
                        <div className="text-[9px] font-bold mb-1 uppercase flex items-center gap-1" style={{ color: te.orange }}><Lightbulb className="size-3" /> Hipotezy ({hypotheses.length})</div>
                        {hypotheses.map(c => (
                          <div key={c.id} className="text-[9px] px-2 py-1.5 mb-1 rounded-sm flex items-start justify-between gap-2" style={{ fontFamily: te.mono, background: te.bg, border: `1px solid ${te.orange}22` }}>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold" style={{ color: te.orange }}>HYPOTHESIS</span>
                                {c.category && <span style={{ color: te.textDim }}>{c.category}</span>}
                                {c.direction !== 'NEUTRAL' && <span style={{ color: c.direction === 'LONG' ? te.green : te.red }}>{c.direction}</span>}
                                <span style={{ color: te.textDim }}>{c.confidence}%</span>
                              </div>
                              <div style={{ color: te.text }}>{c.thesis.slice(0, 250)}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => promoteConviction(c.id)} className="px-1.5 py-0.5 rounded-sm text-[8px] font-bold uppercase" style={{ background: `${te.green}20`, color: te.green }} title="Awansuj do CONVICTION">✓</button>
                              <button onClick={() => rejectConviction(c.id)} className="px-1.5 py-0.5 rounded-sm text-[8px] font-bold uppercase" style={{ background: `${te.red}20`, color: te.red }} title="Odrzuć">✗</button>
                              <button onClick={() => deleteConviction(c.id)} style={{ color: te.textDim }} title="Usuń"><Trash2 className="size-3" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-[8px] font-mono" style={{ color: te.textDim }}>Uruchom ANALIZUJ SYSTEM by LLM wygenerował nowe hipotezy.</div>
                  </div>
                )}
              </div>
            )
          })
        })()}

        {/* Empty state */}
        {(!report?.strategies || report.strategies.length === 0) && convictions.length === 0 && config?.isConfigured && (
          <div className="rounded-sm p-4 text-center col-span-2" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
            <div className="text-[12px] font-bold mb-1" style={{ fontFamily: te.mono, color: te.textDim }}>BRAK DANYCH</div>
            <div className="text-[10px] font-mono" style={{ color: te.textMuted }}>
              Kliknij <strong style={{ color: te.purple }}>ANALIZUJ SYSTEM</strong> by uruchomić głęboką analizę per strategia.
            </div>
          </div>
        )}
      </div>

      {/* ── Global Report (collapsed by default) ──────────────────────────── */}
      {report && (
        <details className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
          <summary className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider cursor-pointer" style={{ fontFamily: te.mono, color: te.text }}>
            📄 PEŁNY RAPORT ({report.confidence}%) · {report.insights?.length || 0} insightów · {report.recommendations?.length || 0} rekomendacji
          </summary>
          <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${te.border}` }}>
            <div className="text-[10px] rounded-sm p-2 mt-2" style={{ background: te.bg, border: `1px solid ${te.border}`, fontFamily: te.mono, color: te.text, whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 300, overflowY: 'auto' }}>
              {report.report}
            </div>
            {report.insights && report.insights.length > 0 && (
              <div>{report.insights.map((ins, i) => <div key={i} className="text-[9px] font-mono flex items-start gap-1" style={{ color: te.text }}><span style={{ color: te.cyan }}>→</span>{ins}</div>)}</div>
            )}
            {report.recommendations && report.recommendations.length > 0 && (
              <div>{report.recommendations.map((rec, i) => <div key={i} className="text-[9px] font-mono" style={{ color: te.orange }}>{i + 1}. {rec}</div>)}</div>
            )}
          </div>
        </details>
      )}

      {/* ── Shadow Evaluations ────────────────────────────────────────────── */}
      <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
        <div className="flex items-center justify-between">
          <button onClick={() => setShadowOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 flex-1 text-left">
            {shadowOpen ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
            <Shield className="size-3.5" style={{ color: te.purple }} />
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: te.text }}>
              SHADOW EVALUATIONS ({shadowEvals.length})
            </span>
            {shadowEvals.length > 0 && (() => {
              const completed = shadowEvals.filter(e => e.status === 'COMPLETED')
              const allowed = completed.filter(e => e.recommendation === 'ALLOW').length
              const cautioned = completed.filter(e => e.recommendation === 'CAUTION').length
              const avoided = completed.filter(e => e.recommendation === 'AVOID').length
              return (
                <span className="text-[9px] font-mono flex items-center gap-1.5">
                  <span style={{ color: te.green }}>✓{allowed}</span>
                  <span style={{ color: te.orange }}>⚠{cautioned}</span>
                  <span style={{ color: te.red }}>✗{avoided}</span>
                </span>
              )
            })()}
          </button>
          <button
            onClick={() => toggleShadow(!shadowEnabled)}
            className="mr-2 flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase rounded-sm"
            style={{ background: shadowEnabled ? `${te.green}20` : `${te.red}20`, color: shadowEnabled ? te.green : te.red }}
          >
            {shadowEnabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            {shadowEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        {shadowOpen && (
          <div className="px-3 pb-2 space-y-1" style={{ borderTop: `1px solid ${te.border}`, maxHeight: 400, overflowY: 'auto' }}>
            {shadowEvals.length === 0 ? (
              <div className="text-[10px] font-mono py-4 text-center" style={{ color: te.textDim }}>
                Brak ocen shadow. Uruchom strategie w tle, a shadow automatycznie oceni każdą decyzję ENTER.
              </div>
            ) : (
              shadowEvals.map(e => (
                <div key={e.id} className="text-[9px] px-2 py-1.5 rounded-sm font-mono" style={{
                  background: te.bg,
                  border: `1px solid ${e.recommendation === 'ALLOW' ? `${te.green}33` : e.recommendation === 'CAUTION' ? `${te.orange}33` : `${te.red}33`}`,
                }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold" style={{ color: e.recommendation === 'ALLOW' ? te.green : e.recommendation === 'CAUTION' ? te.orange : te.red }}>
                      {e.recommendation || e.status}
                    </span>
                    {e.confidence && <span style={{ color: te.textDim }}>{e.confidence}%</span>}
                    <span style={{ color: te.cyan }}>{e.symbol}</span>
                    <span style={{ color: te.textDim }}>{e.strategyType}</span>
                    <span className="ml-auto" style={{ color: te.textDim, fontSize: '8px' }}>{new Date(e.completedAt || e.decidedAt).toLocaleString('pl')}</span>
                  </div>
                  {e.thesis && <div className="mt-0.5" style={{ color: te.textMuted }}>{e.thesis.slice(0, 200)}</div>}
                  {e.errorMessage && <div style={{ color: te.red }}>{e.errorMessage.slice(0, 200)}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Walk-Forward ──────────────────────────────────────────────────── */}
      <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
        <button onClick={() => setWalkForwardOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 w-full text-left">
          {walkForwardOpen ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
          <BarChart3 className="size-3.5" style={{ color: te.blue }} />
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: te.text }}>
            WALK-FORWARD EVALUATION ({evalRuns.length})
          </span>
        </button>
        {walkForwardOpen && (
          <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${te.border}` }}>
            {/* Config */}
            <div className="flex items-end gap-2 mt-2">
              <div>
                <label className="text-[9px] font-bold uppercase block mb-0.5" style={{ color: te.textDim }}>Horyzont</label>
                <select value={wfHorizon} onChange={e => setWfHorizon(e.target.value)} className="h-7 px-2 text-[10px] font-mono rounded-sm"
                  style={{ background: te.bgInput, borderColor: te.border, color: te.text }}>
                  {['1H', '4H', '24H', 'FINAL'].map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase block mb-0.5" style={{ color: te.textDim }}>Foldy</label>
                <select value={wfFolds} onChange={e => setWfFolds(Number(e.target.value))} className="h-7 px-2 text-[10px] font-mono rounded-sm"
                  style={{ background: te.bgInput, borderColor: te.border, color: te.text }}>
                  {[2, 3, 4, 5].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <button
                onClick={() => void runWalkForward()}
                disabled={wfRunning}
                className="flex items-center gap-1 px-3 py-0.5 text-[10px] font-bold uppercase rounded-sm disabled:opacity-40"
                style={{ background: te.blue, color: '#fff', borderRadius: '2px' }}
              >
                {wfRunning ? <RefreshCw className="size-3 animate-spin" /> : <Play className="size-3" />}
                {wfRunning ? '...' : 'URUCHOM'}
              </button>
            </div>
            {wfError && <div className="text-[10px] font-mono" style={{ color: te.red }}>{wfError}</div>}

            {/* Results table */}
            {evalRuns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] font-mono" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: te.textDim, borderBottom: `1px solid ${te.border}` }}>
                      <th className="text-left py-1 px-1">Data</th>
                      <th className="text-left py-1 px-1">Horyzont</th>
                      <th className="text-left py-1 px-1">Status</th>
                      <th className="text-right py-1 px-1">Sample</th>
                      <th className="text-right py-1 px-1">Base</th>
                      <th className="text-right py-1 px-1">LLM</th>
                      <th className="text-right py-1 px-1">Δ%</th>
                      <th className="text-right py-1 px-1">95%CI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalRuns.map(r => (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${te.border}22` }}>
                        <td className="py-1 px-1" style={{ color: te.textDim, fontSize: '8px' }}>{new Date(r.completedAt).toLocaleDateString('pl')}</td>
                        <td className="py-1 px-1" style={{ color: te.cyan }}>{r.horizon}</td>
                        <td className="py-1 px-1">
                          <span style={{ color: r.status === 'PROMOTION_CANDIDATE' ? te.green : r.status === 'NOT_PROMOTED' ? te.red : te.orange }}>
                            {r.status === 'PROMOTION_CANDIDATE' ? '⭐ PROMOTE' : r.status === 'NOT_PROMOTED' ? '✗ NO' : '? DATA'}
                          </span>
                        </td>
                        <td className="py-1 px-1 text-right" style={{ color: te.textDim }}>{r.outOfSampleCount}</td>
                        <td className="py-1 px-1 text-right" style={{ color: te.textDim }}>{r.baselineMeanReturn != null ? `${(r.baselineMeanReturn * 100).toFixed(2)}%` : '-'}</td>
                        <td className="py-1 px-1 text-right" style={{ color: te.text }}>{r.llmMeanReturn != null ? `${(r.llmMeanReturn * 100).toFixed(2)}%` : '-'}</td>
                        <td className="py-1 px-1 text-right font-bold" style={{ color: (r.deltaMeanReturn ?? 0) >= 0 ? te.green : te.red }}>
                          {r.deltaMeanReturn != null ? `${(r.deltaMeanReturn * 100).toFixed(2)}%` : '-'}
                        </td>
                        <td className="py-1 px-1 text-right" style={{ color: te.textDim, fontSize: '8px' }}>
                          {r.confidenceLower95 != null ? `[${(r.confidenceLower95 * 100).toFixed(2)}%, ${(r.confidenceUpper95! * 100).toFixed(2)}%]` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── History ───────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="rounded-sm" style={{ background: te.bgCard, border: `1px solid ${te.border}` }}>
          <div className="flex items-center">
            <button onClick={() => setHistoryOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 flex-1 text-left">
              {historyOpen ? <ChevronDown className="size-3.5" style={{ color: te.textDim }} /> : <ChevronRight className="size-3.5" style={{ color: te.textDim }} />}
              <History className="size-3.5" style={{ color: te.textMuted }} />
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: te.mono, color: te.text }}>HISTORIA RAPORTÓW ({history.length})</span>
            </button>
            <button onClick={() => void clearHistory()} className="mr-2 flex items-center gap-1 text-[9px] px-2 py-1 rounded-sm font-bold"
              style={{ fontFamily: te.mono, background: `${te.red}10`, color: te.red, border: `1px solid ${te.red}33` }}>
              <Trash2 className="size-3" /> WYCZYŚĆ
            </button>
          </div>
          {historyOpen && (
            <div className="px-3 pb-2 space-y-1" style={{ borderTop: `1px solid ${te.border}`, maxHeight: 200, overflowY: 'auto' }}>
              {history.map((h, i) => (
                <div key={i} className="text-[9px] flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer"
                  style={{ background: te.bg, border: `1px solid ${te.border}`, fontFamily: te.mono }}
                  onClick={() => setReport(h as any)}>
                  <span className="size-1.5 rounded-full shrink-0" style={{ background: confidenceColor(h.confidence) }} />
                  <span style={{ color: te.textDim, minWidth: 130 }}>{h.timestamp}</span>
                  <span style={{ color: confidenceColor(h.confidence), fontWeight: 700 }}>{h.confidence}%</span>
                  <span className="truncate" style={{ color: te.textMuted }}>{(h.report || '').slice(0, 80)}</span>
                  {h.provider && <span style={{ color: te.textDim, fontSize: 8 }}>{h.provider}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
