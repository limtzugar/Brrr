// ─── Backtest Engine tests ──────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { runBacktest, type BacktestRequest, type PricePoint } from '../backtest-engine'

// Generate mock price data for deterministic testing
function generateMockPrices(basePrice: number, hours: number, volatility = 0.02): PricePoint[] {
  const prices: PricePoint[] = []
  const startDate = new Date('2025-01-01')
  for (let i = 0; i < hours; i++) {
    const noise = Math.sin(i * 0.3) * basePrice * volatility
    const trend = Math.sin(i * 0.02) * basePrice * 0.05
    const price = Math.max(basePrice * 0.1, basePrice + noise + trend)
    const date = new Date(startDate.getTime() + i * 3600000)
    prices.push({
      date: date.toISOString(),
      price,
      timestamp: date.getTime(),
      volume: 1000000 + Math.random() * 500000,
    })
  }
  return prices
}

const baseParams: BacktestRequest = {
  coin_id: 'bitcoin',
  days: 30,
  strategy_type: 'dip_buying',
  initial_capital: 1000,
  compound: false,
  fee_pct: 0.1,
  dip_threshold_24h: -3,
  take_profit_pct: 5,
  stop_loss_pct: 3,
  max_holding_hours: 48,
}

describe('Backtest Engine', () => {
  it('returns results for dip_buying strategy', () => {
    const prices = generateMockPrices(50000, 30 * 24)
    const result = runBacktest(prices, { ...baseParams, strategy_type: 'dip_buying' })

    expect(result).toBeDefined()
    expect(result.trades).toBeDefined()
    expect(result.equityCurve).toBeDefined()
    expect(result.results).toBeDefined()
    expect(result.results.total_trades).toBeGreaterThanOrEqual(0)
  })

  it('returns results for momentum strategy', () => {
    const prices = generateMockPrices(3000, 30 * 24)
    const result = runBacktest(prices, {
      ...baseParams,
      strategy_type: 'momentum',
      ma_period: 20,
      volume_threshold: 1.5,
    })

    expect(result).toBeDefined()
    expect(result.results.total_trades).toBeGreaterThanOrEqual(0)
  })

  it('compound mode runs without error', () => {
    const prices = generateMockPrices(50000, 30 * 24)
    const nonCompound = runBacktest(prices, { ...baseParams, compound: false })
    const compound = runBacktest(prices, { ...baseParams, compound: true })

    // Both should return valid results
    expect(nonCompound.results).toBeDefined()
    expect(compound.results).toBeDefined()
  })

  it('handles minimal price data', () => {
    const prices = generateMockPrices(50000, 24) // just 1 day
    const result = runBacktest(prices, { ...baseParams, days: 1 })

    expect(result).toBeDefined()
    expect(result.results).toBeDefined()
  })

  it('handles zero initial capital', () => {
    const prices = generateMockPrices(50000, 30 * 24)
    const result = runBacktest(prices, { ...baseParams, initial_capital: 0 })

    expect(result).toBeDefined()
    // initial_capital may not be in results when 0 — just verify it doesn't crash
  })

  it('fee_pct affects results structure', () => {
    const prices = generateMockPrices(50000, 90 * 24)
    const lowFee = runBacktest(prices, { ...baseParams, fee_pct: 0.01, days: 90 })
    const highFee = runBacktest(prices, { ...baseParams, fee_pct: 1.0, days: 90 })

    // Both should produce valid results
    expect(lowFee.results).toBeDefined()
    expect(highFee.results).toBeDefined()
  })

  it('models latency as additional adverse execution slippage', () => {
    const prices = generateMockPrices(50000, 90 * 24)
    const noLatency = runBacktest(prices, {
      ...baseParams,
      days: 90,
      latency_ms: 0,
      latency_adverse_bps_per_second: 1,
    })
    const delayed = runBacktest(prices, {
      ...baseParams,
      days: 90,
      latency_ms: 2_000,
      latency_adverse_bps_per_second: 1,
    })

    expect(delayed.results.latency_adverse_pct_per_side).toBeCloseTo(0.02)
    expect(delayed.results.slippage_pct).toBeCloseTo(0.07)
    expect(delayed.results.final_capital).toBeLessThanOrEqual(noLatency.results.final_capital)
  })
})
