import { describe, expect, it } from 'vitest'
import {
  calculateLongReturnPct,
  calculateObservationLagMs,
  getDueOutcomeHorizons,
  getOutcomeTargetAt,
  isValidLiveObservation,
  normalizeTradingSymbol,
} from '../strategy-outcomes'

describe('strategy outcome helpers', () => {
  it('normalizes common exchange symbols', () => {
    expect(normalizeTradingSymbol('BTC/USDT')).toBe('BTCUSDT')
    expect(normalizeTradingSymbol('eth-usdc')).toBe('ETHUSDC')
  })

  it('calculates long return percentage', () => {
    expect(calculateLongReturnPct(100, 108)).toBeCloseTo(8)
    expect(calculateLongReturnPct(100, 94)).toBeCloseTo(-6)
  })

  it('returns only due and missing horizons', () => {
    const decidedAt = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-01T05:00:00Z')
    const due = getDueOutcomeHorizons(decidedAt, new Set(['1H']), now)
    expect(due.map(item => item.name)).toEqual(['4H'])
  })

  it('marks all horizons due after 24 hours', () => {
    const decidedAt = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-02T01:00:00Z')
    const due = getDueOutcomeHorizons(decidedAt, new Set(), now)
    expect(due.map(item => item.name)).toEqual(['1H', '4H', '24H'])
  })

  it('accepts a live label only close to its exact target timestamp', () => {
    const decidedAt = new Date('2026-01-01T00:00:00Z')
    const targetAt = getOutcomeTargetAt(decidedAt, 60 * 60_000)

    expect(targetAt.toISOString()).toBe('2026-01-01T01:00:00.000Z')
    expect(isValidLiveObservation(
      targetAt,
      new Date('2026-01-01T01:07:00Z'),
    )).toBe(true)
    expect(isValidLiveObservation(
      targetAt,
      new Date('2026-01-01T05:00:00Z'),
    )).toBe(false)
    expect(calculateObservationLagMs(
      targetAt,
      new Date('2026-01-01T01:07:00Z'),
    )).toBe(7 * 60_000)
  })

  it('rejects observations made before the horizon target', () => {
    const targetAt = new Date('2026-01-01T04:00:00Z')
    expect(isValidLiveObservation(
      targetAt,
      new Date('2026-01-01T03:59:59Z'),
    )).toBe(false)
  })
})
