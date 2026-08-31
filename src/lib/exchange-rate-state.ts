// ─── Exchange Rate Limit State ───────────────────────────────────────────────
// Shared in-memory state tracking rate limit quotas reported by Binance & Bybit
// in their HTTP response headers. Both binanceFetch and bybit.request() update
// this state on every response, and the proactive throttle reads it to decide
// whether to slow down before hitting 429.

interface BinanceRateState {
  /** X-Mbx-Used-Weight-1m — current 1-minute weight usage */
  usedWeight1m: number
  /** X-Mbx-Used-Weight-5m — current 5-minute weight usage */
  usedWeight5m: number
  /** X-Mbx-RateLimit-Order-Remaining — remaining order requests (if present) */
  orderRemaining: number | null
  /** Timestamp of last Binance response header update */
  lastUpdated: number
}

interface BybitRateState {
  /** X-Bapi-Limit-Status — remaining requests in current window */
  remaining: number | null
  /** X-Bapi-Limit — max requests per window */
  limit: number | null
  /** Retry-After header value (seconds) when 429 received */
  retryAfter: number | null
  /** Timestamp of last Bybit response header update */
  lastUpdated: number
}

// ─── Singleton state (module-level) ──────────────────────────────────────────
// This is shared across all importers in the same Node.js process.

const binanceState: BinanceRateState = {
  usedWeight1m: 0,
  usedWeight5m: 0,
  orderRemaining: null,
  lastUpdated: 0,
}

const bybitState: BybitRateState = {
  remaining: null,
  limit: null,
  retryAfter: null,
  lastUpdated: 0,
}

// ─── Binance ─────────────────────────────────────────────────────────────────

export function updateBinanceRateState(headers: Headers): void {
  const w1m = headers.get('X-Mbx-Used-Weight-1m')
  const w5m = headers.get('X-Mbx-Used-Weight-5m')
  const ordRem = headers.get('X-Mbx-RateLimit-Order-Remaining')

  if (w1m) binanceState.usedWeight1m = parseInt(w1m, 10)
  if (w5m) binanceState.usedWeight5m = parseInt(w5m, 10)
  binanceState.orderRemaining = ordRem ? parseInt(ordRem, 10) : null
  binanceState.lastUpdated = Date.now()
}

export function getBinanceRateState(): Readonly<BinanceRateState> {
  return binanceState
}

/**
 * Check if Binance is approaching rate limit and we should slow down.
 * @param weightPerRequest — estimated weight of the next request (default 1)
 * @param safetyMarginPct — % of limit to start throttling (default 80%)
 *   Binance typical 1m limit: 2400 weight. 80% = 1920.
 * @returns throttle delay in ms, or 0 if no throttle needed
 */
export function getBinanceThrottleDelay(weightPerRequest = 1, safetyMarginPct = 80): number {
  const now = Date.now()
  // If state is stale (>5min old), don't throttle based on it
  if (now - binanceState.lastUpdated > 300_000) return 0

  const BINANCE_1M_WEIGHT_LIMIT = 2400
  const threshold = BINANCE_1M_WEIGHT_LIMIT * (safetyMarginPct / 100)

  if (binanceState.usedWeight1m + weightPerRequest > threshold) {
    // Approaching limit — add delay proportional to how close we are
    const ratio = (binanceState.usedWeight1m + weightPerRequest) / BINANCE_1M_WEIGHT_LIMIT
    if (ratio >= 1.0) {
      // At or over limit — wait 5s
      return 5000
    }
    // Between 80-100%: gradual throttle 200ms → 2000ms
    const overThreshold = (ratio - safetyMarginPct / 100) / (1 - safetyMarginPct / 100)
    return Math.round(200 + overThreshold * 1800)
  }
  return 0
}

// ─── Bybit ───────────────────────────────────────────────────────────────────

export function updateBybitRateState(headers: Headers): void {
  const remaining = headers.get('X-Bapi-Limit-Status')
  const limit = headers.get('X-Bapi-Limit')
  const retryAfter = headers.get('Retry-After')

  if (remaining) bybitState.remaining = parseInt(remaining, 10)
  if (limit) bybitState.limit = parseInt(limit, 10)
  bybitState.retryAfter = retryAfter ? parseInt(retryAfter, 10) : null
  bybitState.lastUpdated = Date.now()
}

export function getBybitRateState(): Readonly<BybitRateState> {
  return bybitState
}

/**
 * Check if Bybit is approaching rate limit and we should slow down.
 * @param safetyMarginPct — % of limit to start throttling (default 80%)
 *   Bybit typical: 120 req/min. 80% = 96.
 * @returns throttle delay in ms, or 0 if no throttle needed
 */
export function getBybitThrottleDelay(safetyMarginPct = 80): number {
  const now = Date.now()

  // If Retry-After was set, respect it
  if (bybitState.retryAfter && bybitState.retryAfter > 0) {
    const retryAt = bybitState.lastUpdated + bybitState.retryAfter * 1000
    if (now < retryAt) {
      return retryAt - now
    }
  }

  // If state is stale (>2min old), don't throttle based on it
  if (now - bybitState.lastUpdated > 120_000) return 0

  if (bybitState.remaining !== null && bybitState.limit !== null && bybitState.limit > 0) {
    const threshold = bybitState.limit * (safetyMarginPct / 100)
    if (bybitState.remaining <= bybitState.limit - threshold) {
      // Remaining is below safety margin — approaching limit
      const usedPct = 1 - (bybitState.remaining / bybitState.limit)
      if (usedPct >= 1.0) return 5000 // At limit
      // Between 80-100% used: gradual throttle 200ms → 3000ms
      const overThreshold = (usedPct - safetyMarginPct / 100) / (1 - safetyMarginPct / 100)
      return Math.round(200 + overThreshold * 2800)
    }
  }
  return 0
}
