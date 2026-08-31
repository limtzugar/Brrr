import { describe, expect, it } from 'vitest'
import { selectNearestHistoricalPrice } from '../strategy-outcome-backfill'

describe('historical outcome backfill', () => {
  it('selects the closest valid historical point', () => {
    const target = new Date('2026-01-01T04:00:00Z')
    const point = selectNearestHistoricalPrice([
      [new Date('2026-01-01T03:00:00Z').getTime(), 98],
      [new Date('2026-01-01T04:08:00Z').getTime(), 101],
      [new Date('2026-01-01T05:00:00Z').getTime(), 103],
    ], target)
    expect(point?.price).toBe(101)
  })

  it('refuses to fabricate a label from a distant point', () => {
    const point = selectNearestHistoricalPrice([
      [new Date('2026-01-01T08:00:00Z').getTime(), 101],
    ], new Date('2026-01-01T04:00:00Z'))
    expect(point).toBeNull()
  })

  it('ignores invalid prices', () => {
    const target = new Date('2026-01-01T04:00:00Z')
    expect(selectNearestHistoricalPrice([
      [target.getTime(), Number.NaN],
      [target.getTime(), -1],
    ], target)).toBeNull()
  })
})
