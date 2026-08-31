import { describe, expect, it } from 'vitest'
import {
  buildEvaluationSamples,
  confidenceInterval95,
  evaluateWalkForwardSamples,
  type EvaluationInputRow,
  type EvaluationSample,
  walkForwardConfigSchema,
} from '../llm-walk-forward-evaluation'
import { deriveMarketRegime } from '../market-regime'

function config(overrides: Record<string, unknown> = {}) {
  return walkForwardConfigSchema.parse({
    minTrainingSamples: 10,
    testWindowSamples: 10,
    minFoldTestSamples: 5,
    minPromotionSamples: 30,
    ...overrides,
  })
}

function sample(index: number, baselineReturnPct: number, llmReturnPct: number): EvaluationSample {
  return {
    decisionId: `decision-${index}`,
    symbol: index % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT',
    strategyType: index % 3 === 0 ? 'momentum' : 'dip_buying',
    regime: index % 2 === 0 ? 'BULLISH' : 'BEARISH',
    decidedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    recommendation: llmReturnPct === 0 ? 'AVOID' : 'ALLOW',
    confidence: 80,
    grossReturnPct: baselineReturnPct,
    baselineReturnPct,
    llmReturnPct,
    deltaReturnPct: llmReturnPct - baselineReturnPct,
    exposure: llmReturnPct === 0 ? 0 : 1,
    llmLatencyMs: 500,
    observationDelayMinutes: 0,
  }
}

describe('walk-forward LLM evaluation', () => {
  it('applies fees, slippage and measured LLM latency', () => {
    const decisionTime = new Date('2026-01-01T00:00:00Z')
    const row: EvaluationInputRow = {
      decisionId: 'd1',
      symbol: 'BTCUSDT',
      strategyType: 'momentum',
      decidedAt: decisionTime,
      priceChange24h: 4,
      priceChange7d: 8,
      featuresJson: '{}',
      horizon: '24H',
      grossReturnPct: 5,
      evaluatedAt: new Date(decisionTime.getTime() + 24 * 60 * 60 * 1_000),
      recommendation: 'ALLOW',
      confidence: 75,
      llmLatencyMs: 2_000,
    }
    const result = buildEvaluationSamples([row], config())

    expect(result.samples[0].baselineReturnPct).toBeCloseTo(4.7)
    expect(result.samples[0].llmReturnPct).toBeCloseTo(4.69)
    expect(result.samples[0].regime).toBe('BULLISH')
  })

  it('excludes horizon observations that arrived too late', () => {
    const decisionTime = new Date('2026-01-01T00:00:00Z')
    const row: EvaluationInputRow = {
      decisionId: 'late',
      symbol: 'BTCUSDT',
      strategyType: 'momentum',
      decidedAt: decisionTime,
      priceChange24h: 0,
      priceChange7d: 0,
      featuresJson: '{}',
      horizon: '24H',
      grossReturnPct: 1,
      evaluatedAt: new Date(decisionTime.getTime() + 25 * 60 * 60 * 1_000),
      recommendation: 'ALLOW',
      confidence: 75,
      llmLatencyMs: 100,
    }
    const result = buildEvaluationSamples([row], config())

    expect(result.samples).toHaveLength(0)
    expect(result.excludedLateSamples).toBe(1)
  })

  it('never promotes without the minimum out-of-sample count', () => {
    const samples = Array.from({ length: 25 }, (_, index) => sample(index, -1, 0))
    const result = evaluateWalkForwardSamples(samples, config())

    expect(result.status).toBe('INSUFFICIENT_DATA')
    expect(result.outOfSampleCount).toBe(15)
  })

  it('marks a statistically positive walk-forward result only as a candidate', () => {
    const samples = Array.from({ length: 150 }, (_, index) => {
      const baseline = index % 2 === 0 ? 1 : -1
      return sample(index, baseline, baseline > 0 ? 1 : 0)
    })
    const result = evaluateWalkForwardSamples(samples, config({
      minTrainingSamples: 30,
      testWindowSamples: 20,
      minFoldTestSamples: 10,
      minPromotionSamples: 100,
    }))

    expect(result.status).toBe('PROMOTION_CANDIDATE')
    expect(result.pairedDelta95?.lower).toBeGreaterThan(0)
    expect(result.foldCount).toBe(6)
    expect(result.byPair.BTCUSDT).toBeDefined()
    expect(result.byStrategy.momentum).toBeDefined()
    expect(result.byRegime.BEARISH).toBeDefined()
  })

  it('computes a paired 95% confidence interval', () => {
    const interval = confidenceInterval95([1, 2, 3, 4, 5])
    expect(interval?.mean).toBe(3)
    expect(interval?.lower).toBeLessThan(3)
    expect(interval?.upper).toBeGreaterThan(3)
  })
})

describe('market regime derivation', () => {
  it('uses deterministic non-forward-looking market changes', () => {
    expect(deriveMarketRegime(3, 8)).toBe('BULLISH')
    expect(deriveMarketRegime(-3, -8)).toBe('BEARISH')
    expect(deriveMarketRegime(0.5, 2)).toBe('SIDEWAYS')
    expect(deriveMarketRegime(3, -8)).toBe('MIXED')
    expect(deriveMarketRegime(null, null)).toBe('UNKNOWN')
  })
})
