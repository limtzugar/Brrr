// ─── TE Tokens + seededRandom tests ────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { TE, seededRandom, seededSparkline, PLACEHOLDER_BADGE_STYLE, PLACEHOLDER_WRAPPER_STYLE } from '../te-tokens'

describe('TE Design Tokens', () => {
  it('has orange primary color #FF6600', () => {
    expect(TE.orange).toBe('#FF6600')
  })

  it('has orangeDark and orangeLight variants', () => {
    expect(TE.orangeDark).toBe('#CC5200')
    expect(TE.orangeLight).toBe('#FF8533')
  })

  it('has background tokens', () => {
    expect(TE.bg).toBe('#0a0a0a')
    expect(TE.bgCard).toBe('#111111')
    expect(TE.bgCardHover).toBe('#1a1a1a')
    expect(TE.bgInput).toBe('#1a1a1a')
  })

  it('has border tokens', () => {
    expect(TE.border).toBe('#222222')
    expect(TE.borderLight).toBe('#333333')
  })

  it('has text tokens', () => {
    expect(TE.text).toBe('#e0e0e0')
    expect(TE.textMuted).toBe('#888888')
    expect(TE.textDim).toBe('#555555')
  })

  it('has semantic colors', () => {
    expect(TE.green).toBe('#10b981')
    expect(TE.red).toBe('#ef4444')
    expect(TE.blue).toBe('#3b82f6')
    expect(TE.purple).toBe('#8b5cf6')
    expect(TE.yellow).toBe('#eab308')
    expect(TE.cyan).toBe('#06b6d4')
  })

  it('has semantic background colors with rgba', () => {
    expect(TE.greenBg).toContain('rgba')
    expect(TE.redBg).toContain('rgba')
    expect(TE.blueBg).toContain('rgba')
    expect(TE.purpleBg).toContain('rgba')
    expect(TE.yellowBg).toContain('rgba')
  })

  it('has monospace font family', () => {
    expect(TE.mono).toContain('JetBrains Mono')
    expect(TE.mono).toContain('monospace')
  })
})

describe('seededRandom', () => {
  it('returns deterministic values for same seed', () => {
    const rng1 = seededRandom(42)
    const rng2 = seededRandom(42)
    const vals1 = Array.from({ length: 10 }, () => rng1())
    const vals2 = Array.from({ length: 10 }, () => rng2())
    expect(vals1).toEqual(vals2)
  })

  it('returns different values for different seeds', () => {
    const rng1 = seededRandom(42)
    const rng2 = seededRandom(99)
    const val1 = rng1()
    const val2 = rng2()
    expect(val1).not.toBe(val2)
  })

  it('produces values between 0 and 1', () => {
    const rng = seededRandom(12345)
    for (let i = 0; i < 100; i++) {
      const val = rng()
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThan(1)
    }
  })

  it('produces different values on each call', () => {
    const rng = seededRandom(7)
    const val1 = rng()
    const val2 = rng()
    expect(val1).not.toBe(val2)
  })
})

describe('seededSparkline', () => {
  it('returns array of specified length', () => {
    const data = seededSparkline(42, 8)
    expect(data).toHaveLength(8)
  })

  it('returns deterministic data for same seed', () => {
    const data1 = seededSparkline(42)
    const data2 = seededSparkline(42)
    expect(data1).toEqual(data2)
  })

  it('returns different data for different seeds', () => {
    const data1 = seededSparkline(42)
    const data2 = seededSparkline(99)
    expect(data1).not.toEqual(data2)
  })

  it('clamps values between 0 and 100', () => {
    const data = seededSparkline(999, 50)
    for (const val of data) {
      expect(val).toBeGreaterThanOrEqual(5)
      expect(val).toBeLessThanOrEqual(95)
    }
  })

  it('defaults to 8 data points', () => {
    const data = seededSparkline(42)
    expect(data).toHaveLength(8)
  })
})

describe('Placeholder styles', () => {
  it('PLACEHOLDER_BADGE_STYLE has warning styling', () => {
    expect(PLACEHOLDER_BADGE_STYLE.color).toContain('d97706')
    expect(PLACEHOLDER_BADGE_STYLE.fontSize).toBe('9px')
    expect(PLACEHOLDER_BADGE_STYLE.fontWeight).toBe(700)
  })

  it('PLACEHOLDER_WRAPPER_STYLE has dashed border', () => {
    expect(PLACEHOLDER_WRAPPER_STYLE.border).toContain('dashed')
    expect(PLACEHOLDER_WRAPPER_STYLE.background).toContain('rgba(217,119,6')
  })
})
