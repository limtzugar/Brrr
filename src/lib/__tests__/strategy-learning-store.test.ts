import { describe, expect, it } from 'vitest'
import {
  buildDecisionEventKey,
  buildTacticRunKey,
  sha256,
  stableJson,
} from '../strategy-learning-store'

describe('strategy learning identity helpers', () => {
  it('hashes equivalent parameter objects identically', () => {
    const first = stableJson({ z: 1, nested: { b: true, a: 2 } })
    const second = stableJson({ nested: { a: 2, b: true }, z: 1 })
    expect(first).toBe(second)
    expect(sha256(first)).toBe(sha256(second))
  })

  it('changes tactic run identity when parameters change', () => {
    const common = {
      activeStrategyId: 'strategy-1',
      algorithmVersion: 'runner-v2',
    }
    expect(buildTacticRunKey({
      ...common,
      parametersHash: sha256('{"threshold":1}'),
    })).not.toBe(buildTacticRunKey({
      ...common,
      parametersHash: sha256('{"threshold":2}'),
    }))
  })

  it('deduplicates same-minute retries but preserves distinct actions', () => {
    const at = new Date('2026-07-29T10:21:58Z')
    expect(buildDecisionEventKey('strategy-1', at, 'ENTER')).toBe(
      'strategy-1:2026-07-29T10:21:ENTER',
    )
    expect(buildDecisionEventKey('strategy-1', at, 'ENTER')).not.toBe(
      buildDecisionEventKey('strategy-1', at, 'EXIT'),
    )
  })
})
