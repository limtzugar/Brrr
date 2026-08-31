import { describe, expect, it } from 'vitest'
import {
  evaluatePromotion,
  parseStrategyArtifact,
} from '../trading-strategy-bench'

describe('TradingStrategyBench contracts', () => {
  it('accepts a bounded declarative strategy artifact', () => {
    const artifact = parseStrategyArtifact({
      schemaVersion: 'strategy-artifact-v1',
      strategyType: 'momentum',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entryRules: [{ feature: 'return_1h', operator: 'GT', value: 1.5 }],
      exitRules: [{ feature: 'return_since_entry', operator: 'LTE', value: -2 }],
      risk: {
        stopLossPct: 2,
        takeProfitPct: 5,
        maxHoldingHours: 48,
        maxPositionPct: 10,
      },
      provenance: { evidence: [], invalidators: [] },
    })
    expect(artifact.entryRules[0].feature).toBe('return_1h')
  })

  it('rejects unbounded risk values in generated artifacts', () => {
    expect(() => parseStrategyArtifact({
      schemaVersion: 'strategy-artifact-v1',
      strategyType: 'momentum',
      symbol: null,
      direction: 'LONG',
      entryRules: [],
      exitRules: [],
      risk: {
        stopLossPct: 80,
        takeProfitPct: 5,
        maxHoldingHours: 48,
        maxPositionPct: 10,
      },
      provenance: { evidence: [], invalidators: [] },
    })).toThrow()
  })

  it('never promotes a result built from invalid labels', () => {
    const result = evaluatePromotion({
      sampleCount: 500,
      foldCount: 8,
      profitableFoldRatio: 1,
      meanReturnPct: 5,
      confidenceLower95: 3,
      maxDrawdownPct: 4,
      feeStressMeanReturnPct: 2,
      invalidLabelCount: 1,
      simulatorErrorCount: 0,
    })
    expect(result).toMatchObject({
      eligible: false,
      failureClass: 'INVALID_LABELS',
    })
  })

  it('classifies a train-only edge as overfit', () => {
    const result = evaluatePromotion({
      sampleCount: 500,
      foldCount: 8,
      profitableFoldRatio: 0.25,
      trainMeanReturnPct: 8,
      meanReturnPct: -1,
      confidenceLower95: -2,
      maxDrawdownPct: 10,
      feeStressMeanReturnPct: -2,
      invalidLabelCount: 0,
      simulatorErrorCount: 0,
    })
    expect(result.failureClass).toBe('OVERFIT')
  })

  it('requires robustness to fees before promotion', () => {
    const result = evaluatePromotion({
      sampleCount: 500,
      foldCount: 8,
      profitableFoldRatio: 0.875,
      trainMeanReturnPct: 3,
      meanReturnPct: 1.5,
      confidenceLower95: 0.2,
      maxDrawdownPct: 10,
      feeStressMeanReturnPct: -0.1,
      invalidLabelCount: 0,
      simulatorErrorCount: 0,
    })
    expect(result.failureClass).toBe('FEE_FRAGILE')
  })
})
