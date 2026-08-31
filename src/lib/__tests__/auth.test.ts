import { describe, expect, it } from 'vitest'
import { createSessionToken } from '../auth'

describe('createSessionToken', () => {
  it('is deterministic without exposing the API key', async () => {
    const token = await createSessionToken('super-secret-key')
    expect(token).toHaveLength(64)
    expect(token).toBe(await createSessionToken('super-secret-key'))
    expect(token).not.toContain('super-secret-key')
  })

  it('changes when the API key changes', async () => {
    expect(await createSessionToken('key-a')).not.toBe(
      await createSessionToken('key-b'),
    )
  })
})
