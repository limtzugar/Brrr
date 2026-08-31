import { describe, expect, it } from 'vitest'
import {
  classifyPositionTransition,
  isVolumeSpike,
} from '../strategy-metrics'

describe('isVolumeSpike', () => {
  it('requires a warm-up history', () => {
    expect(isVolumeSpike(200, [100, 100, 100, 100], 1.5)).toBe(false)
  })

  it('detects volume above the historical multiplier', () => {
    expect(isVolumeSpike(151, [100, 100, 100, 100, 100], 1.5)).toBe(true)
  })

  it('does not compare the current volume with itself', () => {
    expect(isVolumeSpike(100, [100, 100, 100, 100, 100], 1.5)).toBe(false)
  })

  it('fails closed for invalid data', () => {
    expect(isVolumeSpike(0, [100, 100, 100, 100, 100], 1.5)).toBe(false)
    expect(isVolumeSpike(200, [100, 100, 100, 100, 100], 0)).toBe(false)
  })
})

describe('classifyPositionTransition', () => {
  it.each([
    [false, true, 'ENTER'],
    [true, false, 'EXIT'],
    [true, true, 'HOLD'],
    [false, false, 'NO_TRADE'],
  ] as const)('%s → %s is %s', (before, after, expected) => {
    expect(classifyPositionTransition(before, after)).toBe(expected)
  })
})
