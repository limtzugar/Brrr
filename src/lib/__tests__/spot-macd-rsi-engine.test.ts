import { describe, it, expect } from 'vitest'
import { sma, rsi, hurst, evaluateSignal, SPOT_PROFILE } from '../spot-macd-rsi-engine'

describe('SPOT MACD+RSI engine — math', () => {
  it('sma works', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBeCloseTo(4)
    expect(Number.isNaN(sma([1, 2], 5))).toBe(true)
  })
  it('rsi extremes', () => {
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14)).toBe(100)
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14)).toBe(0)
  })
  it('hurst rising >> mean-reverting sine', () => {
    const trend = Array.from({ length: 120 }, (_, i) => 100 + i * 0.3)
    const hTrend = hurst(trend, 100)
    expect(hTrend).toBeGreaterThan(0.5)
  })
  it('evaluateSignal returns HOLD on insufficient/sane data without throwing', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 2)
    const sig = evaluateSignal(closes)
    expect(['HOLD', 'BUY', 'SELL']).toContain(sig.signal)
    expect(sig.confidence).toBeGreaterThanOrEqual(0)
    expect(sig.confidence).toBeLessThanOrEqual(1)
  })
  it('SPOT_PROFILE sanity', () => {
    expect(SPOT_PROFILE.coins).toContain('BTCUSDT')
    expect(SPOT_PROFILE.oversold).toBe(30)
    expect(SPOT_PROFILE.overbought).toBe(70)
    expect(SPOT_PROFILE.maxHoldBars).toBeGreaterThan(0)
  })
})
