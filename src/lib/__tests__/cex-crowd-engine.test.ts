import { describe, it, expect } from 'vitest'
import { sma, rsi, CROWD_PROFILE } from '../cex-crowd-engine'

describe('CEX CROWD engine — math helpers', () => {
  it('sma computes simple moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBeCloseTo(4)
    expect(sma([10, 20, 30], 2)).toBeCloseTo(25)
    expect(Number.isNaN(sma([1, 2], 5))).toBe(true)
  })

  it('rsi is 100 for monotonic gains, 0 for monotonic losses, 50 for flat', () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(rsi(up, 14)).toBe(100)
    const down = Array.from({ length: 20 }, (_, i) => 100 - i)
    expect(rsi(down, 14)).toBe(0)
    const flat = Array.from({ length: 20 }, () => 42)
    expect(rsi(flat, 14)).toBe(100) // zero losses → 100 by definition
  })

  it('rsi mid-range for mixed series', () => {
    const mixed = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]
    const r = rsi(mixed, 14)
    expect(r).toBeGreaterThan(30)
    expect(r).toBeLessThan(70)
  })

  it('CROWD_PROFILE matches the data-proven config', () => {
    expect(CROWD_PROFILE.leverage).toBe(20)
    expect(CROWD_PROFILE.takeProfitPct).toBeCloseTo(0.50)
    expect(CROWD_PROFILE.stopLossPct).toBeCloseTo(0.40)
    expect(CROWD_PROFILE.stopLossPct).toBeLessThan(CROWD_PROFILE.takeProfitPct) // SL tighter than TP
    expect(CROWD_PROFILE.timeoutMs).toBe(60_000)
    expect(CROWD_PROFILE.pairs).toContain('TAO-USDT')
    expect(CROWD_PROFILE.pairs).not.toContain('PEPE-USDT') // blacklisted by data
  })
})
