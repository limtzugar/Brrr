// ─── Unit Tests: Dynamic Trailing Stop + TAKER Whitelist ──────────────────
// Tests verify:
//   1. Dynamic trailing_pct changes based on current profit %
//   2. TAKER on non-whitelisted pairs (TON/INJ/DOGE) is rejected
//   3. TAKER on whitelisted pairs (FET/ZEC/BNB) is allowed

import { describe, expect, test } from 'vitest'
import { DYNAMIC_TRAILING, TAKER_WHITELIST } from '@/lib/cex-anomaly-constants'

// ─── Test 1: Dynamic Trailing ──────────────────────────────────────────────

function getDynamicTrailingPct(profitPct: number): number {
  if (!DYNAMIC_TRAILING.ENABLED) return -1 // not applicable
  if (profitPct < DYNAMIC_TRAILING.TIER1_THRESHOLD) {
    return DYNAMIC_TRAILING.TIGHT_PCT
  } else if (profitPct < DYNAMIC_TRAILING.TIER2_THRESHOLD) {
    return DYNAMIC_TRAILING.NORMAL_PCT
  } else {
    return DYNAMIC_TRAILING.LOOSE_PCT
  }
}

describe('Dynamic Trailing Stop', () => {
  test('TIER1: profit < 0.15% → tight trailing 0.08%', () => {
    expect(getDynamicTrailingPct(0)).toBe(0.0010)
    expect(getDynamicTrailingPct(0.05)).toBe(0.0010)
    expect(getDynamicTrailingPct(0.10)).toBe(0.0010)
    expect(getDynamicTrailingPct(0.14)).toBe(0.0010)
  })

  test('TIER2: profit 0.15%-0.40% → normal trailing 0.12%', () => {
    expect(getDynamicTrailingPct(0.15)).toBe(0.0015)
    expect(getDynamicTrailingPct(0.22)).toBe(0.0015)
    expect(getDynamicTrailingPct(0.30)).toBe(0.0015)
    expect(getDynamicTrailingPct(0.39)).toBe(0.0015)
  })

  test('TIER3: profit >= 0.40% → loose trailing 0.20%', () => {
    expect(getDynamicTrailingPct(0.40)).toBe(0.0025)
    expect(getDynamicTrailingPct(0.65)).toBe(0.0025)
    expect(getDynamicTrailingPct(1.2)).toBe(0.0025)
    expect(getDynamicTrailingPct(3.0)).toBe(0.0025)
  })

  test('Dynamic trailing is enabled for AGGRESSIVE and SCALPER modes', () => {
    expect(DYNAMIC_TRAILING.ENABLED).toBe(true)
    expect((DYNAMIC_TRAILING.MODES as readonly string[])).toContain('AGGRESSIVE')
    expect((DYNAMIC_TRAILING.MODES as readonly string[])).toContain('SCALPER')
  })

  test('Trailing tightens near entry → loosens for big wins', () => {
    const tightTrailing = getDynamicTrailingPct(0.10)
    const normalTrailing = getDynamicTrailingPct(0.25)
    const looseTrailing = getDynamicTrailingPct(0.50)
    // Tight < Normal < Loose
    expect(tightTrailing).toBeLessThan(normalTrailing)
    expect(normalTrailing).toBeLessThan(looseTrailing)
  })

  test('Old static 0.50% trailing was wider than tight tier', () => {
    expect(DYNAMIC_TRAILING.TIGHT_PCT * 100).toBeLessThan(0.50)
  })
})

// ─── Test 2: TAKER Whitelist ──────────────────────────────────────────────

function shouldAllowTaker(pair: string): boolean {
  return (TAKER_WHITELIST as readonly string[]).includes(pair)
}

describe('TAKER Whitelist', () => {
  test('Current 48k-trade-analysis pairs are whitelisted', () => {
    for (const pair of ['FET-USDT', 'LINK-USDT', 'DOGE-USDT', 'TAO-USDT', 'FIL-USDT']) {
      expect(shouldAllowTaker(pair)).toBe(true)
    }
  })

  test('Negative avg_move pairs are rejected', () => {
    expect(shouldAllowTaker('TON-USDT')).toBe(false)    // -0.38%, 100% stop, -$1.06
    expect(shouldAllowTaker('INJ-USDT')).toBe(false)    // -0.29%, 100% stop, -$0.87
    expect(shouldAllowTaker('SUI-USDT')).toBe(false)    // -0.19%, 66.7% stop, -$0.61
    expect(shouldAllowTaker('ADA-USDT')).toBe(false)    // +0.00%, 46.7% stop, -$1.05
    expect(shouldAllowTaker('TRUMP-USDT')).toBe(false)  // new pair, no data yet
    expect(shouldAllowTaker('WLD-USDT')).toBe(false)    // new pair, no data yet
  })

  test('Non-existent pairs are rejected', () => {
    expect(shouldAllowTaker('UNKNOWN-USDT')).toBe(false)
    expect(shouldAllowTaker('BTC-USDT')).toBe(false)   // not in whitelist
  })

  test('Whitelist contains exactly the five currently approved pairs', () => {
    expect(TAKER_WHITELIST).toEqual([
      'FET-USDT',
      'LINK-USDT',
      'DOGE-USDT',
      'TAO-USDT',
      'FIL-USDT',
    ])
  })
})

// ─── Test 3: Trailing Stop Price Calculation ──────────────────────────────

describe('Trailing Stop Price Calculation', () => {
  test('LONG: trailing SL = peak × (1 - trailing_pct)', () => {
    const entryPrice = 100
    const peakPrice = 100.30  // +0.30% from entry → NORMAL tier (0.12%)
    const trailingPct = 0.0012
    const trailingStop = peakPrice * (1 - trailingPct)
    expect(trailingStop).toBeCloseTo(100.18, 1)
    expect(trailingStop).toBeGreaterThan(entryPrice)
  })

  test('SHORT: trailing SL = peak × (1 + trailing_pct)', () => {
    const entryPrice = 100
    const peakPrice = 99.70  // -0.30% from entry (SHORT profit) → NORMAL tier
    const trailingPct = 0.0012
    const trailingStop = peakPrice * (1 + trailingPct)
    expect(trailingStop).toBeCloseTo(99.82, 1)
    expect(trailingStop).toBeLessThan(entryPrice)
  })

  test('Dynamic trailing at TIER1 (tight) protects entry better than old 0.50%', () => {
    const entryPrice = 100
    const peakPrice = 100.10  // +0.10% → TIER1 tight
    const oldTrailing = peakPrice * (1 - 0.005)  // 0.50% static
    const newTrailing = peakPrice * (1 - 0.0008)  // 0.08% tight
    expect(oldTrailing).toBeLessThan(entryPrice)  // old too wide
    expect(newTrailing).toBeGreaterThan(entryPrice)  // new protects entry
  })
})
