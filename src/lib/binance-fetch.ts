// ─── Binance Fetch Utilities ─────────────────────────────────────────────────
// Provides rate-limit-safe fetching for Binance public API routes.
// - `binanceFetch`: single request with retry, 429-wait, 418-skip
//   NOW ALSO: reads X-RateLimit headers and updates shared exchange rate state
// - `batchFetch`: processes items in small batches with delay to avoid IP bans
//   NOW ALSO: dynamically adjusts batch delay based on Binance rate state

import {
  updateBinanceRateState,
  getBinanceThrottleDelay,
} from './exchange-rate-state'

// ─── Single fetch with retry / 429-wait / 418-skip / X-RateLimit-aware ─────

export interface BinanceFetchOptions {
  retries?: number        // max attempts (default 3)
  timeout?: number        // AbortSignal timeout ms (default 10_000)
  headers?: Record<string, string>
}

export async function binanceFetch<T = unknown>(
  url: string,
  opts: BinanceFetchOptions = {},
): Promise<T | null> {
  const { retries = 3, timeout = 10_000, headers } = opts

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // ── Proactive throttle: if Binance response headers say we're close to limit, slow down ──
      const throttleDelay = getBinanceThrottleDelay(1, 80)
      if (throttleDelay > 0) {
        console.warn(`[binanceFetch] Proactive throttle: waiting ${throttleDelay}ms (Binance rate state approaching limit)`)
        await new Promise(r => setTimeout(r, throttleDelay))
      }

      const res = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      })

      // ── P1-3: Parse X-RateLimit headers from EVERY response ──
      updateBinanceRateState(res.headers)

      // 429 → respect Retry-After, then retry
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10) * 1000
        console.warn(`[binanceFetch] 429 rate-limited, waiting ${retryAfter}ms (attempt ${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, retryAfter))
        continue
      }

      // 418 → IP banned; skip immediately — no point retrying
      if (res.status === 418) {
        console.error('[binanceFetch] IP banned (418), skipping')
        return null
      }

      if (!res.ok) {
        throw new Error(`Binance API ${res.status}: ${res.statusText}`)
      }

      return (await res.json()) as T
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`[binanceFetch] failed after ${retries} attempts: ${err.message}`)
        return null
      }
      // exponential backoff: 1s, 2s, 3s…
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  return null
}

// ─── Batch processor ─────────────────────────────────────────────────────────

export interface BatchFetchOptions {
  batchSize: number       // concurrent requests per batch (default 3)
  batchDelay: number      // ms delay between batches (default 500)
  minFetched?: number     // minimum successful items to consider result valid (default 1)
}

/**
 * Process an array of items in small, rate-limit-safe batches.
 * Returns an array of successfully-processed results (nulls / undefined are filtered out).
 *
 * P1-3: Now dynamically adjusts batch delay based on Binance rate state.
 */
export async function batchFetch<TItem, TResult>(
  items: TItem[],
  fn: (item: TItem) => Promise<TResult | null | undefined>,
  opts: BatchFetchOptions,
): Promise<TResult[]> {
  const { batchSize = 3, batchDelay = 500, minFetched = 1 } = opts

  const results: TResult[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const settled = await Promise.allSettled(batch.map(fn))

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value != null) {
        results.push(r.value)
      }
    }

    // Delay between batches (skip after the last batch)
    if (i + batchSize < items.length) {
      // ── P1-3: Dynamic batch delay based on Binance rate state ──
      const throttleDelay = getBinanceThrottleDelay(batchSize, 80)
      const effectiveDelay = batchDelay + throttleDelay

      if (throttleDelay > 0) {
        console.warn(`[batchFetch] Throttling: batch delay ${batchDelay}ms → ${effectiveDelay}ms (Binance rate state)`)
      }

      await new Promise(r => setTimeout(r, effectiveDelay))
    }
  }

  if (results.length < minFetched) {
    console.warn(
      `[batchFetch] only ${results.length}/${items.length} items fetched (minFetched=${minFetched})`,
    )
  }

  return results
}
