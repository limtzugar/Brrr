// ─── LLM Analyst Endpoint ───────────────────────────────────────────────────
// Analyzes trading-system data with the configured LLM provider.
// Supports two scopes:
//   - 'cex_anomaly' (default, backward-compatible): anomalies + positions + TA
//   - 'full_system': aggregates portfolio + strategies + regime + macro + CEX data
//
// Provider/model/apiKey are read from AppSettings via getLlmConfig() (encrypted).
// No hard-coded provider credentials anymore.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { callLlm } from '@/lib/llm-client'
import { getLlmConfigPublic } from '@/lib/llm-config'
import {
  getLlmAnalystSystemPrompt,
  LLM_ANALYST_PROMPT_VERSION,
  parseLlmAnalystResponse,
} from '@/lib/llm-contract'
import { markLlmInvocationError } from '@/lib/llm-invocation'
import { createDraftExperimentFromHypothesis } from '@/lib/trading-strategy-bench'

export const dynamic = 'force-dynamic'

// ─── POST: run analysis ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateResult = checkRateLimit(`llm-analyst:${ip}`, 10, 60 * 1000)
    if (!rateResult.allowed) return NextResponse.json({ error: 'Too many LLM requests. Wait ~60s.' }, { status: 429 })

    const cfg = await getLlmConfigPublic()
    if (!cfg.isConfigured) {
      return NextResponse.json(
        { error: 'LLM is not configured. Open Settings → LLM section and enter API key.' },
        { status: 503 },
      )
    }

    const body = await request.json()
    const scope: 'cex_anomaly' | 'full_system' = body.scope === 'full_system' ? 'full_system' : 'cex_anomaly'
    const {
      // CEX anomaly scope
      anomalies = [], positions = [], closedPositions = [], signalEvents = [], pairData = {}, settings = {},
      // Full-system scope
      portfolio = null, strategies = [], regime = null, macro = null, oiFunding = null, fearGreed = null,
    } = body

    const context = scope === 'full_system'
      ? buildFullSystemContext({ portfolio, strategies, regime, macro, oiFunding, fearGreed, anomalies, positions, closedPositions, signalEvents, pairData, settings })
      : buildCexAnomalyContext(anomalies, positions, closedPositions, signalEvents, pairData, settings)

    const result = await callLlm(
      [
        { role: 'system', content: getLlmAnalystSystemPrompt() },
        { role: 'user', content: context },
      ],
      {
        maxTokens: 4096,
        temperature: 0.3,
        timeoutMs: 60_000,
        operation: 'llm_analyst',
        promptVersion: LLM_ANALYST_PROMPT_VERSION,
        metadata: { scope },
      },
    )

    let parsed
    try {
      parsed = parseLlmAnalystResponse(result.content)
    } catch (contractError) {
      if (result.invocationId) {
        await markLlmInvocationError(
          result.invocationId,
          contractError instanceof Error ? contractError.message : 'Invalid response contract',
        ).catch(() => {})
      }
      return NextResponse.json(
        { error: contractError instanceof Error ? contractError.message : 'Invalid LLM response' },
        { status: 502 },
      )
    }

    // ── Save report to history ──
    try {
      const entry = {
        timestamp: new Date().toISOString(),
        scope,
        provider: cfg.provider,
        model: cfg.model,
        promptVersion: LLM_ANALYST_PROMPT_VERSION,
        invocationId: result.invocationId,
        usage: result.usage,
        latencyMs: result.latencyMs,
        ...parsed,
      }
      const existing = await db.appSettings.findUnique({ where: { key: 'llm_reports_history' } })
      const history = existing ? JSON.parse(existing.value) : []
      history.unshift(entry)
      await db.appSettings.upsert({ where: { key: 'llm_reports_history' }, update: { value: JSON.stringify(history.slice(0, 50)) }, create: { key: 'llm_reports_history', value: JSON.stringify(history.slice(0, 50)) } })
    } catch (e) { console.error('[llm-analyst] Failed to save report:', e) }

    // ── Save hypotheses as convictions ──
    try {
      const allHypotheses = [
        ...(parsed.globalHypotheses || []).map(h => ({ ...h, strategyType: 'global' })),
        ...(parsed.strategies || []).flatMap(s =>
          (s.hypotheses || []).map(h => ({ ...h, strategyType: s.strategyType }))
        ),
      ]
      for (const h of allHypotheses) {
        const conviction = await db.conviction.create({
          data: {
            source: 'LLM_ANALYST',
            status: 'HYPOTHESIS',
            strategyType: h.strategyType,
            symbol: h.pair || null,
            direction: h.direction || 'NEUTRAL',
            thesis: `${h.pattern}\n\n${h.rationale}`.slice(0, 2000),
            confidence: h.confidence || 50,
            evidence: JSON.stringify(h.evidence || []),
            invalidators: JSON.stringify(h.invalidators || []),
            category: h.category || null,
            reportId: result.invocationId || null,
          },
        })
        if (h.strategyType !== 'global') {
          await createDraftExperimentFromHypothesis({
            convictionId: conviction.id,
            invocationId: result.invocationId,
            provider: cfg.provider,
            model: cfg.model,
            strategyType: h.strategyType,
            symbol: h.pair || null,
            direction: h.direction,
            pattern: h.pattern,
            rationale: h.rationale,
            evidence: h.evidence || [],
            invalidators: h.invalidators || [],
          })
        }
      }
    } catch (e) { console.error('[llm-analyst] Failed to save convictions:', e) }

    return NextResponse.json({
      ...parsed,
      timestamp: new Date().toISOString(),
      scope,
      provider: cfg.provider,
      model: cfg.model,
      promptVersion: LLM_ANALYST_PROMPT_VERSION,
      invocationId: result.invocationId,
      usage: result.usage,
      latencyMs: result.latencyMs,
    })
  } catch (error) {
    console.error('[/api/llm-analyst] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'LLM analysis failed.' }, { status: 500 })
  }
}

// ─── GET: history ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [history, config] = await Promise.all([
      db.appSettings.findUnique({ where: { key: 'llm_reports_history' } }),
      getLlmConfigPublic(),
    ])
    return NextResponse.json({
      reports: history ? JSON.parse(history.value) : [],
      config, // isConfigured flag for UI
    })
  } catch { return NextResponse.json({ reports: [], config: { isConfigured: false } }) }
}

// ─── DELETE: clear report history ─────────────────────────────────────────────

export async function DELETE() {
  try {
    await db.appSettings.delete({ where: { key: 'llm_reports_history' } }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ success: false }, { status: 500 }) }
}

// ─── Context builder: CEX Anomaly scope (backward-compatible) ─────────────────

function buildCexAnomalyContext(anomalies: any[], positions: any[], closedPositions: any[], signalEvents: any[], pairData: Record<string, any>, settings: any): string {
  const lines: string[] = []
  lines.push('# DANE RYNKOWE — CEX ANOMALY')
  lines.push(`Czas: ${new Date().toISOString()}`)
  lines.push(`\n## USTAWIENIA\n- TP: ${settings.tpPct ?? 2}%\n- SL: ${settings.slPct ?? 6.5}%\n- Leverage: ${settings.leverage ?? 1}x\n- Tryb: ${settings.tradingMode ?? 'CONSERVATIVE'}`)
  if (anomalies.length > 0) { lines.push('\n## ANOMALIE (ostatnie 20)'); anomalies.slice(0, 20).forEach((a, i) => lines.push(`${i+1}. [${a.category}] ${a.pair} ${a.side} | $${(a.sizeUsd/1000).toFixed(1)}K | ${a.details} | ${a.exchange}`)) }
  if (positions.length > 0) { lines.push('\n## AKTYWNE POZYCJE'); positions.forEach((p, i) => lines.push(`${i+1}. ${p.pair} ${p.side} | PnL=${p.pnlPercent?.toFixed(2)}% | lev=${p.leverage}x`)) }
  if (closedPositions.length > 0) { lines.push('\n## CLOSED (last 15)'); closedPositions.slice(0, 15).forEach((p, i) => lines.push(`${i+1}. ${p.pair} | PnL=${p.pnlPercent?.toFixed(2)}% | ${p.status}`)) }
  if (signalEvents.length > 0) { lines.push('\n## TA SIGNALS (ostatnie 20)'); signalEvents.slice(-20).forEach((e, i) => lines.push(`${i+1}. ${e.signalType} ${e.pair} | PnL=${e.pnlPct?.toFixed(2)}% | ${e.closeReason}`)) }
  const pk = Object.keys(pairData); if (pk.length > 0) { lines.push('\n## INDICATORS'); pk.forEach(p => { const d = pairData[p]; lines.push(`- ${p}: price=${d.price} | RSI=${d.rsi?.toFixed(1)} | MACD=${d.macdHist?.toFixed(4)} | CVD=${d.cvd?.toFixed(0)}`) }) }
  lines.push('\n## TASK\nAnalyze the data. Provide conclusions, recommendations and hypotheses requiring later validation.')
  return lines.join('\n')
}

// ─── Context builder: full-system scope ──────────────────────────────────────

interface FullSystemInput {
  portfolio: any
  strategies: any[]
  regime: any
  macro: any
  oiFunding: any
  fearGreed: any
  anomalies: any[]
  positions: any[]
  closedPositions: any[]
  signalEvents: any[]
  pairData: Record<string, any>
  settings: any
}

function buildFullSystemContext(input: FullSystemInput): string {
  const lines: string[] = []
  const { portfolio, strategies, regime, macro, oiFunding, fearGreed, anomalies, positions, closedPositions, signalEvents, pairData, settings } = input
  lines.push('# WHOLE SYSTEM ANALYSIS — BRRR TRADING PLATFORM')
  lines.push(`Czas: ${new Date().toISOString()}`)

  // ── Portfolio ──
  if (portfolio) {
    lines.push('\n## PORTEFEL I SALDO')
    if (portfolio.totalEquityUsdt !== undefined) lines.push(`- Total Equity: $${Number(portfolio.totalEquityUsdt || 0).toFixed(2)}`)
    if (portfolio.mode) lines.push(`- Tryb: ${portfolio.mode}`)
    if (Array.isArray(portfolio.coins) && portfolio.coins.length > 0) {
      const nonZero = portfolio.coins.filter((c: any) => Number(c.equity) > 0)
      lines.push(`- Aktywa (${nonZero.length}): ${nonZero.slice(0, 15).map((c: any) => `${c.coin}=${Number(c.equity).toFixed(4)}`).join(', ')}`)
    }
  }

  // ── Strategiessss ──
  if (Array.isArray(strategies) && strategies.length > 0) {
    lines.push('\n## AKTYWNE STRATEGIE')
    strategies.forEach((s, i) => {
      lines.push(`${i+1}. ${s.name || s.symbol} | ${s.strategyType || s.strategyId} | ${s.status} | PnL=${Number(s.totalPnl || 0).toFixed(2)} | trades=${s.totalTrades} | win=${s.winningTrades}/${s.totalTrades}`)
    })
  }

  // ── Positions (futures / CEX anomaly) ──
  if (Array.isArray(positions) && positions.length > 0) {
    lines.push('\n## OTWARTE POZYCJE')
    positions.forEach((p, i) => lines.push(`${i+1}. ${p.pair || p.symbol} ${p.side} | size=$${Number(p.sizeUsd || 0).toFixed(0)} | PnL=${p.pnlPercent?.toFixed(2) ?? '?'}% | lev=${p.leverage ?? 1}x`))
  }
  if (Array.isArray(closedPositions) && closedPositions.length > 0) {
    lines.push('\n## CLOSED POSITIONS (last 15)')
    closedPositions.slice(0, 15).forEach((p, i) => lines.push(`${i+1}. ${p.pair || p.symbol} | PnL=${p.pnlPercent?.toFixed(2) ?? '?'}% | ${p.status ?? p.exitReason ?? ''}`))
  }

  // ── Regime ──
  if (regime) {
    lines.push('\n## MARKET REGIME')
    if (regime.regime) lines.push(`- Regime: ${regime.regime}`)
    if (regime.trend) lines.push(`- Trend: ${regime.trend}`)
    if (regime.volatility) lines.push(`- Volatility: ${regime.volatility}`)
    if (regime.notes) lines.push(`- Notatki: ${regime.notes}`)
  }

  // ── Macro ──
  if (macro) {
    lines.push('\n## KALENDARZ MAKRO')
    if (Array.isArray(macro.events)) macro.events.slice(0, 10).forEach((e: any, i: number) => lines.push(`${i+1}. ${e.time ?? ''} ${e.country ?? ''} ${e.event ?? e.title ?? ''} | actual=${e.actual ?? '?'} forecast=${e.forecast ?? '?'}`))
    else if (macro.nextEvent) lines.push(`- Next: ${macro.nextEvent}`)
  }

  // ── OI + Funding ──
  if (oiFunding && oiFunding.data && typeof oiFunding.data === 'object') {
    lines.push('\n## OPEN INTEREST + FUNDING')
    const symbols = Object.keys(oiFunding.data).slice(0, 15)
    symbols.forEach(sym => {
      const d = oiFunding.data[sym]
      lines.push(`- ${sym}: OI=$${Number(d.openInterestUsd || 0).toFixed(0)} | funding=${Number(d.fundingRate || 0).toFixed(5)} | mark=${d.markPrice ?? '?'}`)
    })
    if (Array.isArray(oiFunding.oiSpikes) && oiFunding.oiSpikes.length > 0) lines.push(`- OI SPIKES: ${oiFunding.oiSpikes.join(', ')}`)
    if (Array.isArray(oiFunding.fundingExtreme) && oiFunding.fundingExtreme.length > 0) lines.push(`- FUNDING EXTREME: ${oiFunding.fundingExtreme.join(', ')}`)
  }

  // ── Fear & Greed ──
  if (fearGreed) {
    lines.push('\n## FEAR & GREED INDEX')
    if (fearGreed.value !== undefined) lines.push(`- Value: ${fearGreed.value} (${fearGreed.classification || fearGreed.value_classification || ''})`)
  }

  // ── CEX anomalies + TA (shared sections) ──
  if (anomalies.length > 0) { lines.push('\n## ANOMALIE CEX (ostatnie 20)'); anomalies.slice(0, 20).forEach((a, i) => lines.push(`${i+1}. [${a.category}] ${a.pair} ${a.side} | $${(a.sizeUsd/1000).toFixed(1)}K | ${a.details} | ${a.exchange}`)) }
  const pk = Object.keys(pairData); if (pk.length > 0) { lines.push('\n## INDICATORS TA'); pk.slice(0, 20).forEach(p => { const d = pairData[p]; lines.push(`- ${p}: price=${d.price} | RSI=${d.rsi?.toFixed(1)} | MACD=${d.macdHist?.toFixed(4)} | CVD=${d.cvd?.toFixed(0)}`) }) }
  if (signalEvents.length > 0) { lines.push('\n## TA SIGNALS (ostatnie 20)'); signalEvents.slice(-20).forEach((e, i) => lines.push(`${i+1}. ${e.signalType} ${e.pair} | PnL=${e.pnlPct?.toFixed(2)}% | ${e.closeReason}`)) }

  lines.push('\n## USTAWIENIA TRADINGU')
  lines.push(`- TP: ${settings.tpPct ?? 2}% | SL: ${settings.slPct ?? 6.5}% | Leverage: ${settings.leverage ?? 1}x | Tryb: ${settings.tradingMode ?? 'CONSERVATIVE'}`)

  lines.push('\n## TASK')
  lines.push('Perform a DEEP analysis of the whole system:')
  lines.push('1. Assessment of overall portfolio health and risk exposure.')
  lines.push('2. Effectiveness of open positions and strategies — what works, what does not.')
  lines.push('3. Market context: regime, OI, funding, Fear&Greed — whether current positions align.')
  lines.push('4. Most important anomalies and TA signals — correlations between them.')
  lines.push('5. Concrete, prioritized recommendations (what to close, what to open, what to tune).')
  lines.push('6. Hypotheses for later validation (do not treat as learned rules).')
  return lines.join('\n')
}
