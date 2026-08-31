// ─── Rate Limiter — Persistent + Redis-backed ──────────────────────────────
// Supports three backends (auto-detected):
//   1. Redis (REDIS_URL env) — multi-instance, production
//   2. File-backed (RATE_LIMIT_DIR env) — persistent across restarts, single instance
//   3. In-memory (default) — fallback, lost on restart

import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { log, warn } from './logger'

// ─── Interface ─────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
}

export interface RateLimiter {
  check(ip: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult
  cleanup(): void
}

// ─── In-Memory Rate Limiter ────────────────────────────────────────────────

class InMemoryRateLimiter implements RateLimiter {
  private limits = new Map<string, RateLimitEntry>()

  check(ip: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now()
    const entry = this.limits.get(ip)

    if (!entry || now > entry.resetAt) {
      this.limits.set(ip, { count: 1, resetAt: now + windowMs })
      return { allowed: true, remaining: limit - 1 }
    }

    if (entry.count >= limit) {
      return { allowed: false, remaining: 0 }
    }

    entry.count++
    return { allowed: true, remaining: limit - entry.count }
  }

  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.limits) {
      if (now > entry.resetAt) this.limits.delete(ip)
    }
  }
}

// ─── File-Backed Rate Limiter ──────────────────────────────────────────────

class FileRateLimiter implements RateLimiter {
  private dir: string
  private cache = new Map<string, RateLimitEntry>()
  private lastCleanup = Date.now()

  constructor(dir: string) {
    this.dir = dir
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // Directory may already exist
    }
  }

  check(ip: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now()
    const safeIp = ip.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${this.dir}/rl_${safeIp}.json`

    let entry = this.cache.get(ip)

    // Try reading from file if not cached
    if (!entry) {
      try {
        const raw = readFileSync(filePath, 'utf-8')
        entry = JSON.parse(raw) as RateLimitEntry
        this.cache.set(ip, entry)
      } catch {
        // File doesn't exist or invalid JSON
      }
    }

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs }
    } else if (entry.count >= limit) {
      // Persist the blocked state
      this.persist(safeIp, filePath, entry)
      return { allowed: false, remaining: 0 }
    } else {
      entry.count++
    }

    this.cache.set(ip, entry)
    this.persist(safeIp, filePath, entry)

    // Periodic cleanup
    if (now - this.lastCleanup > 5 * 60 * 1000) {
      this.cleanup()
      this.lastCleanup = now
    }

    return { allowed: true, remaining: limit - entry.count }
  }

  private persist(safeIp: string, filePath: string, entry: RateLimitEntry): void {
    try {
      writeFileSync(filePath, JSON.stringify(entry), 'utf-8')
    } catch {
      // Silently fail — memory still works
    }
  }

  cleanup(): void {
    const now = Date.now()

    // Clean cache
    for (const [ip, entry] of this.cache) {
      if (now > entry.resetAt) this.cache.delete(ip)
    }

    // Clean files
    try {
      const files = readdirSync(this.dir).filter((f: string) => f.startsWith('rl_'))
      for (const file of files) {
        try {
          const raw = readFileSync(`${this.dir}/${file}`, 'utf-8')
          const entry = JSON.parse(raw) as RateLimitEntry
          if (now > entry.resetAt) {
            try { unlinkSync(`${this.dir}/${file}`) } catch { /* ignore */ }
          }
        } catch {
          // Corrupt file — remove it
          try { unlinkSync(`${this.dir}/${file}`) } catch { /* ignore */ }
        }
      }
    } catch {
      // Directory access error
    }
  }
}

// Shared rate limit state for sync↔async convergence
// Updated by Redis async checks, read by sync checkRateLimit() wrapper
const sharedState = new Map<string, RateLimitEntry>()

// ─── Redis Rate Limiter ────────────────────────────────────────────────────

class RedisRateLimiter implements RateLimiter {
  private redisUrl: string
  private client: any = null
  private fallback = new InMemoryRateLimiter()
  private connected = false

  constructor(url: string) {
    this.redisUrl = url
    this.connect()
  }

  private async connect(): Promise<void> {
    try {
      // Dynamic import — Redis is optional dependency
      // Use Function constructor to prevent Vite from resolving at build time
      let createClient: any = null
      try {
        const mod = await new Function('return import("redis")')()
        createClient = mod?.createClient
      } catch {
        // redis package not installed
      }
      if (!createClient) {
        this.connected = false
        warn('[RateLimiter] Redis package not available, falling back to in-memory')
        return
      }
      this.client = createClient({ url: this.redisUrl })
      this.client.on('error', () => {
        this.connected = false
      })
      this.client.on('connect', () => {
        this.connected = true
      })
      await this.client.connect()
      this.connected = true
    } catch {
      warn('[RateLimiter] Redis unavailable, falling back to in-memory')
      this.connected = false
    }
  }

  async check(ip: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    if (!this.connected || !this.client) {
      return this.fallback.check(ip, limit, windowMs)
    }

    try {
      const key = `ratelimit:${ip}`
      const multi = this.client.multi()
      multi.incr(key)
      multi.pExpire(key, windowMs)
      const results = await multi.exec()
      const count = results?.[0]?.[1] ?? 0  // redis@4 returns [error, result] tuples
      // Mirror to shared state for sync path convergence
      sharedState.set(ip, { count, resetAt: Date.now() + windowMs })

      if (count > limit) {
        return { allowed: false, remaining: 0 }
      }
      return { allowed: true, remaining: limit - count }
    } catch {
      return this.fallback.check(ip, limit, windowMs)
    }
  }

  cleanup(): void {
    this.fallback.cleanup()
  }
}

// ─── Auto-detect and export appropriate limiter ────────────────────────────

function createRateLimiter(): RateLimiter {
  // Priority: Redis > File > Memory
  const redisUrl = process.env.REDIS_URL
  const rateLimitDir = process.env.RATE_LIMIT_DIR

  if (redisUrl) {
    log('[RateLimiter] Using Redis backend:', redisUrl.replace(/\/\/.*@/, '//***@'))
    return new RedisRateLimiter(redisUrl)
  }

  if (rateLimitDir) {
    log('[RateLimiter] Using file-backed backend:', rateLimitDir)
    return new FileRateLimiter(rateLimitDir)
  }

  log('[RateLimiter] Using in-memory backend (set REDIS_URL or RATE_LIMIT_DIR for persistence)')
  return new InMemoryRateLimiter()
}

const limiter = createRateLimiter()

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => limiter.cleanup(), 5 * 60 * 1000)
}

// ─── Public API ─────────────────────────────────────────────────────────────
export function checkRateLimit(ip: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const shared = sharedState.get(ip)
  if (shared && now <= shared.resetAt) { if (shared.count >= limit) return { allowed: false, remaining: 0 } }
  const result = limiter.check(ip, limit, windowMs)
  if (isPromise(result)) {
    if (shared && now <= shared.resetAt) return { allowed: shared.count < limit, remaining: Math.max(0, limit - shared.count) }
    return { allowed: true, remaining: limit - 1 }
  }
  return result
}
export async function checkRateLimitAsync(ip: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const result = await limiter.check(ip, limit, windowMs)
  const now = Date.now()
  const shared = sharedState.get(ip)
  if (shared && now <= shared.resetAt) { shared.count = Math.max(shared.count, limit - result.remaining) }
  else if (result.allowed) { sharedState.set(ip, { count: limit - result.remaining, resetAt: now + windowMs }) }
  return result
}
function isPromise<T>(v: T | Promise<T>): v is Promise<T> { return v !== null && typeof (v as Promise<T>).then === 'function' }

export { limiter }
