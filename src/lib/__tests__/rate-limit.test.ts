// ─── Rate Limiter tests ─────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit } from '../rate-limit'

describe('Rate Limiter', () => {
  it('allows first request', () => {
    const result = checkRateLimit('192.168.1.1', 5, 60000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks after exceeding limit', () => {
    const ip = '10.0.0.' + Math.floor(Math.random() * 255)
    const limit = 3
    const window = 60000

    // Use up all requests
    checkRateLimit(ip, limit, window) // remaining: 2
    checkRateLimit(ip, limit, window) // remaining: 1
    checkRateLimit(ip, limit, window) // remaining: 0

    // Next should be blocked
    const result = checkRateLimit(ip, limit, window)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('tracks limits per IP independently', () => {
    const ip1 = '172.16.0.1'
    const ip2 = '172.16.0.2'
    const limit = 2

    // Exhaust ip1
    checkRateLimit(ip1, limit, 60000)
    checkRateLimit(ip1, limit, 60000)

    // ip1 should be blocked
    expect(checkRateLimit(ip1, limit, 60000).allowed).toBe(false)

    // ip2 should still be allowed
    expect(checkRateLimit(ip2, limit, 60000).allowed).toBe(true)
  })

  it('resets after window expires', () => {
    const ip = '192.168.99.1'
    const limit = 1
    const windowMs = 1 // 1ms window

    checkRateLimit(ip, limit, windowMs)
    expect(checkRateLimit(ip, limit, windowMs).allowed).toBe(false)

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = checkRateLimit(ip, limit, 60000)
        expect(result.allowed).toBe(true)
        resolve()
      }, 10)
    })
  })

  it('works with limit=1 (single request allowed)', () => {
    const ip = '10.1.1.1'
    const result1 = checkRateLimit(ip, 1, 60000)
    expect(result1.allowed).toBe(true)
    expect(result1.remaining).toBe(0)

    const result2 = checkRateLimit(ip, 1, 60000)
    expect(result2.allowed).toBe(false)
  })
})
