// ─── Bybit V5 REST API Client ────────────────────────────────────────────────
// Supports both testnet (demo) and mainnet (real).
// Uses HMAC-SHA256 authentication.

import { createHmac } from 'crypto'
import { log, warn } from './logger'
import { updateBybitRateState, getBybitThrottleDelay } from './exchange-rate-state'

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URLS = {
  demo: 'https://api-testnet.bybit.com',
  real: 'https://api.bybit.com',
} as const

// All known Bybit testnet API endpoints (try in order)
const TESTNET_ENDPOINTS = [
  'https://api-testnet.bybit.com',
  'https://api-testnet.bybit.eu',
]

export type BybitMode = 'demo' | 'real'

interface BybitConfig {
  apiKey: string
  apiSecret: string
  mode: BybitMode
  subMemberId?: string   // Optional: set if API key is master account and funds are on sub-account
  subAccountName?: string // Optional: display name of sub-account
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BybitResponse {
  retCode: number
  retMsg: string
  result: unknown
  time: number
}

interface OrderResult {
  orderId: string
  orderLinkId: string
}

interface BalanceResult {
  accountType: string
  totalAvailableBalance?: string  // Account-level available margin (USD) — the correct field for futures
  totalEquity?: string           // Account total equity (USD)
  totalWalletBalance?: string    // Account wallet balance (USD)
  totalMarginBalance?: string    // Account margin balance (USD)
  totalPerpUPL?: string          // Account perp unrealised PnL (USD)
  totalInitialMargin?: string    // Account initial margin (USD)
  coin: Array<{
    coin: string
    equity: string
    availableToWithdraw: string   // Deprecated for UNIFIED since Jan 2025 — use totalAvailableBalance
    walletBalance: string
    unrealisedPnl: string
  }>
}

interface PositionResult {
  symbol: string
  side: string
  size: string
  avgPrice: string
  unrealisedPnl: string
  createdTime: string
}

interface TickerResult {
  symbol: string
  lastPrice: string
  highPrice24h: string
  lowPrice24h: string
  price24hPcnt: string
  volume24h: string
  turnover24h: string
}

export interface CoinBalance {
  coin: string
  equity: string
  availableToWithdraw: string
  walletBalance: string
  unrealisedPnl: string
  free: string
  locked: string
}

// ─── CoinGecko ID → Bybit Symbol Mapping ────────────────────────────────────

export const COIN_TO_BYBIT: Record<string, string> = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  binancecoin: 'BNBUSDT',
  ripple: 'XRPUSDT',
  cardano: 'ADAUSDT',
  dogecoin: 'DOGEUSDT',
  polkadot: 'DOTUSDT',
  'avalanche-2': 'AVAXUSDT',
  chainlink: 'LINKUSDT',
  'shiba-inu': 'SHIBUSDT',
  litecoin: 'LTCUSDT',
  uniswap: 'UNIUSDT',
  stellar: 'XLMUSDT',
  'polygon-pos': 'MATICUSDT',
  arbitrum: 'ARBUSDT',
  optimism: 'OPUSDT',
  near: 'NEARUSDT',
  aptos: 'APTUSDT',
  sui: 'SUIUSDT',
  pepe: 'PEPEUSDT',
  render: 'RENDERUSDT',
  injective: 'INJUSDT',
  cosmos: 'ATOMUSDT',
}

export function getBybitSymbol(coinId: string): string {
  return COIN_TO_BYBIT[coinId] || coinId.toUpperCase() + 'USDT'
}

// ─── Authentication ─────────────────────────────────────────────────────────

function generateSignature(params: string, timestamp: number, apiKey: string, apiSecret: string, recvWindow: number = 20000): string {
  const paramStr = `${timestamp}${apiKey}${recvWindow}${params}`
  return createHmac('sha256', apiSecret).update(paramStr).digest('hex')
}

function buildHeaders(params: string, apiKey: string, apiSecret: string, recvWindow: number = 20000, timestamp?: number): Record<string, string> {
  const ts = timestamp ?? Date.now()
  const sign = generateSignature(params, ts, apiKey, apiSecret, recvWindow)

  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-SIGN': sign,
    'X-BAPI-SIGN-TYPE': '2',
    'X-BAPI-TIMESTAMP': String(ts),
    'X-BAPI-RECV-WINDOW': String(recvWindow),
  }
}

/**
 * Build a query string from params with keys sorted alphabetically.
 * Bybit V5 API requires alphabetical sorting of query parameters for signature.
 */
function buildQueryString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))  // Sort alphabetically by key
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

// ─── Global Bybit Rate Limiter ───────────────────────────────────────────────
// Bybit UMA limit: 120 req/min per API key. We track ALL outgoing Bybit requests
// in a sliding window and proactively delay if approaching the limit.

const BYBIT_RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute sliding window
const BYBIT_RATE_LIMIT_MAX = 100            // 100 req/min (80% of 120 — safety margin)
const BYBIT_RATE_LIMIT_BURST_MAX = 20       // Max 20 requests in any 5-second burst

interface RateLimitEntry {
  timestamp: number
}

const globalBybitRequestLog: RateLimitEntry[] = []
let globalBybitBackoffUntil = 0

/** Record a Bybit API request and check if we should delay */
function checkGlobalBybitRateLimit(): { allowed: boolean; waitMs: number; remaining: number } {
  const now = Date.now()

  // If we're in a backoff period, return wait time
  if (globalBybitBackoffUntil > now) {
    return { allowed: false, waitMs: globalBybitBackoffUntil - now, remaining: 0 }
  }

  // Prune old entries (older than 1 minute)
  while (globalBybitRequestLog.length > 0 && (now - globalBybitRequestLog[0].timestamp) > BYBIT_RATE_LIMIT_WINDOW_MS) {
    globalBybitRequestLog.shift()
  }

  const remaining = BYBIT_RATE_LIMIT_MAX - globalBybitRequestLog.length

  // Check burst limit (last 5 seconds)
  const burstCount = globalBybitRequestLog.filter(e => (now - e.timestamp) < 5000).length
  if (burstCount >= BYBIT_RATE_LIMIT_BURST_MAX) {
    const waitMs = 5000 - (now - globalBybitRequestLog[globalBybitRequestLog.length - BYBIT_RATE_LIMIT_BURST_MAX].timestamp)
    return { allowed: false, waitMs: Math.max(waitMs, 500), remaining }
  }

  // Check minute limit
  if (globalBybitRequestLog.length >= BYBIT_RATE_LIMIT_MAX) {
    // Set backoff until oldest entry expires
    const oldestInWindow = globalBybitRequestLog[0]
    const waitMs = BYBIT_RATE_LIMIT_WINDOW_MS - (now - oldestInWindow.timestamp) + 100
    globalBybitBackoffUntil = now + waitMs
    warn(`[Bybit] Global rate limit approaching (${globalBybitRequestLog.length}/${BYBIT_RATE_LIMIT_MAX} in last min), backing off ${waitMs}ms`)
    return { allowed: false, waitMs, remaining: 0 }
  }

  // Approaching limit? (>80% used) — add a small delay
  if (globalBybitRequestLog.length >= BYBIT_RATE_LIMIT_MAX * 0.8) {
    return { allowed: true, waitMs: 200, remaining }  // gentle throttle
  }

  return { allowed: true, waitMs: 0, remaining }
}

/** Record that a Bybit request was made */
function recordBybitRequest(): void {
  globalBybitRequestLog.push({ timestamp: Date.now() })
}

/** Get global Bybit rate limit stats (for health endpoint) */
export function getBybitRateLimitStats(): { requestsLastMin: number; maxPerMin: number; backoffActive: boolean } {
  const now = Date.now()
  while (globalBybitRequestLog.length > 0 && (now - globalBybitRequestLog[0].timestamp) > BYBIT_RATE_LIMIT_WINDOW_MS) {
    globalBybitRequestLog.shift()
  }
  return {
    requestsLastMin: globalBybitRequestLog.length,
    maxPerMin: BYBIT_RATE_LIMIT_MAX,
    backoffActive: globalBybitBackoffUntil > now,
  }
}

// ─── BybitClient Singleton Cache ────────────────────────────────────────────
// Caches BybitClient instances by mode so timeOffset, rateLimitState, and
// sub-account detection persist across API route calls (within same process).

interface CachedClient {
  client: BybitClient
  createdAt: number
  apiKeyHash: string  // Detect if API keys changed → invalidate cache
}

const clientCache = new Map<string, CachedClient>()
const CLIENT_CACHE_TTL = 30 * 60 * 1000  // 30 minutes

function hashKey(key: string): string {
  // Simple hash for cache invalidation (don't need cryptographic strength)
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const chr = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0  // Convert to 32-bit int
  }
  return hash.toString(36)
}

// ─── API Client Class ───────────────────────────────────────────────────────

export class BybitClient {
  private config: BybitConfig
  private baseUrl: string
  private recvWindow: number = 20000
  private timeOffset: number = 0  // Server time offset in ms (serverTime - localTime)
  private timeOffsetFetched: boolean = false
  private lastTimeSyncAt: number = 0  // Timestamp of last successful time sync
  private static readonly TIME_SYNC_INTERVAL = 10 * 60 * 1000  // Re-sync every 10 minutes
  // Sub-account detection: if funds are on a sub-account, we store its memberId
  // so that all subsequent operations (orders, positions, etc.) use the correct sub-account
  private subMemberId: string | null = null
  private subAccountName: string | null = null
  // Position mode cache per symbol: 'MergedSingle' = One-Way (positionIdx=0),
  // 'BothSide' = Hedge mode (positionIdx: 1=Buy/Long, 2=Sell/Short).
  // Cached for 30 min to avoid extra API calls on every order.
  private positionModeCache: Map<string, { mode: 'MergedSingle' | 'BothSide'; timestamp: number }> = new Map()
  private static readonly POSITION_MODE_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
  // Rate limit backoff: when Bybit returns 429/10015/10016, pause before next request
  private rateLimitBackoffUntil: number = 0
  private consecutiveRateLimitHits: number = 0
  // Sub-accounts list cache (30 min TTL) — avoids redundant API calls
  private subAccountsCache: { data: Array<{ memberId: string; memberName: string }>; timestamp: number } | null = null
  private static readonly SUB_ACCOUNTS_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
  // Balance result cache (5s TTL) — prevents hitting Bybit on every single request
  private balanceCache: { data: any; timestamp: number } | null = null
  private static readonly BALANCE_CACHE_TTL = 5_000 // 5 seconds

  constructor(config: BybitConfig) {
    // Trim whitespace from API keys — common source of signature errors
    this.config = {
      apiKey: config.apiKey.trim(),
      apiSecret: config.apiSecret.trim(),
      mode: config.mode,
    }
    this.baseUrl = BASE_URLS[config.mode]
    // Pre-set sub-account if provided in config
    if (config.subMemberId) {
      this.subMemberId = config.subMemberId
      this.subAccountName = config.subAccountName || null
    }
  }

  /** Get the detected sub-account member ID (null if using main account) */
  getSubMemberId(): string | null { return this.subMemberId }

  /** Get the detected sub-account name (null if using main account) */
  getSubAccountName(): string | null { return this.subAccountName }

  /** Set the sub-account to use for all operations (orders, positions, balance).
   *  Called automatically after balance detection, or can be set manually. */
  setSubAccount(memberId: string, name?: string): void {
    this.subMemberId = memberId
    this.subAccountName = name || null
    log(`[Bybit] Sub-account set: "${name}" (${memberId})`)
  }

  /**
   * Synchronize local clock with Bybit server time.
   * This is CRITICAL for signature validation — Bybit rejects requests
   * where the timestamp differs from server time by more than recvWindow.
   */
  private async syncServerTime(): Promise<void> {
    try {
      const baseUrls: string[] = this.config.mode === 'demo'
        ? TESTNET_ENDPOINTS
        : [this.baseUrl]

      for (const baseUrl of baseUrls) {
        try {
          const localBefore = Date.now()
          const res = await fetch(`${baseUrl}/v5/market/time`, {
            signal: AbortSignal.timeout(10000),
          })
          const localAfter = Date.now()
          if (!res.ok) continue

          const json = await res.json() as BybitResponse
          if (json.retCode !== 0) continue

          const result = json.result as { timeSecond: string; timeNano: string }
          const serverTime = Number(result.timeSecond) * 1000
          const localTime = Math.round((localBefore + localAfter) / 2)
          this.timeOffset = serverTime - localTime
          this.timeOffsetFetched = true
          this.lastTimeSyncAt = Date.now()
          log(`[Bybit] Time sync: offset=${this.timeOffset}ms (server=${serverTime}, local=${localTime})`)
          return
        } catch {
          continue
        }
      }
    } catch {}
    // If sync fails, we'll use local time (may cause 10004 if clock is off)
    warn('[Bybit] Could not sync server time, using local clock')
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<BybitResponse> {
    // ── Global rate limit check (shared across ALL BybitClient instances) ──
    const globalLimit = checkGlobalBybitRateLimit()
    if (!globalLimit.allowed || globalLimit.waitMs > 0) {
      const waitMs = globalLimit.waitMs || 500
      log(`[Bybit] Global rate limit: waiting ${waitMs}ms (remaining: ${globalLimit.remaining})`)
      await new Promise(r => setTimeout(r, waitMs))
    }

    // Sync server time on first authenticated request (critical for signature)
    // Also re-sync every 10 minutes to catch clock drift
    if (!this.timeOffsetFetched || (Date.now() - this.lastTimeSyncAt > BybitClient.TIME_SYNC_INTERVAL)) {
      await this.syncServerTime()
    }

    // Wait if rate-limited by Bybit (per-instance backoff)
    if (this.rateLimitBackoffUntil > Date.now()) {
      const waitMs = this.rateLimitBackoffUntil - Date.now()
      log(`[Bybit] Instance rate limit backoff: waiting ${waitMs}ms...`)
      await new Promise(r => setTimeout(r, waitMs))
    }

    // Record this request for global rate limit tracking
    recordBybitRequest()

    // ── P1-3: Proactive throttle based on Bybit X-Bapi-Limit headers ──
    const bybitThrottleDelay = getBybitThrottleDelay(80)
    if (bybitThrottleDelay > 0) {
      log(`[Bybit] Proactive throttle: waiting ${bybitThrottleDelay}ms (X-Bapi-Limit headers)`)
      await new Promise(r => setTimeout(r, bybitThrottleDelay))
    }

    // For demo mode, try multiple testnet endpoints if one fails with auth error
    const baseUrls: string[] = this.config.mode === 'demo'
      ? TESTNET_ENDPOINTS
      : [this.baseUrl]

    let lastError: Error | null = null

    for (const baseUrl of baseUrls) {
      try {
        const url = `${baseUrl}${path}`
        let headers: Record<string, string>

        // Use server-compensated timestamp for signature
        const timestamp = Date.now() + this.timeOffset

        if (method === 'GET') {
          // Sort params alphabetically and build query string
          const qs = buildQueryString(params)
          const fullUrl = qs ? `${url}?${qs}` : url
          headers = buildHeaders(qs, this.config.apiKey, this.config.apiSecret, this.recvWindow, timestamp)

          const res = await fetch(fullUrl, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(15000),
          })

          // ── P1-3: Parse Bybit rate limit headers from EVERY GET response ──
          updateBybitRateState(res.headers)

          if (!res.ok) {
            if (res.status === 429) {
              this.consecutiveRateLimitHits++
              // P1-3: Prefer Retry-After header over exponential backoff
              const retryAfterHeader = res.headers.get('Retry-After')
              const backoffMs = retryAfterHeader
                ? parseInt(retryAfterHeader, 10) * 1000
                : Math.min(5000 * Math.pow(2, this.consecutiveRateLimitHits - 1), 60_000)
              this.rateLimitBackoffUntil = Date.now() + backoffMs
              warn(`[Bybit] HTTP 429 rate limit (GET), backing off for ${backoffMs}ms${retryAfterHeader ? ' (Retry-After header)' : ''}`)
              throw new Error(`Bybit rate limit (429), backing off for ${backoffMs}ms`)
            }
            if (res.status === 401 && this.config.mode === 'demo') {
              warn(`[Bybit] HTTP 401 on ${baseUrl}, trying next testnet endpoint...`)
              lastError = new Error(`Bybit API error: ${res.status} ${res.statusText}`)
              continue
            }
            throw new Error(`Bybit API error: ${res.status} ${res.statusText}`)
          }

          const json = await res.json() as BybitResponse

          // Detect Bybit rate limit warnings (retCode 10015 = IP banned, 10016 = rate limit)
          if (json.retCode === 10015 || json.retCode === 10016) {
            this.consecutiveRateLimitHits++
            const backoffMs = Math.min(5000 * Math.pow(2, this.consecutiveRateLimitHits - 1), 60_000)
            this.rateLimitBackoffUntil = Date.now() + backoffMs
            warn(`[Bybit] Rate limit hit (retCode ${json.retCode}), backing off for ${backoffMs}ms (hit #${this.consecutiveRateLimitHits})`)
          } else if (json.retCode === 0) {
            // Successful request — reset counter
            this.consecutiveRateLimitHits = 0
          }

          // Check for API-level auth errors (retCode != 0 with auth-related messages)
          if (json.retCode !== 0 && this.config.mode === 'demo') {
            const msg = json.retMsg?.toLowerCase() || ''
            if (msg.includes('invalid') || msg.includes('auth') || msg.includes('api key') || msg.includes('sign') || msg.includes('permission') || msg.includes('token')) {
              warn(`[Bybit] API auth error on ${baseUrl}: ${json.retMsg} (retCode: ${json.retCode}), trying next testnet endpoint...`)
              lastError = new Error(`Bybit API error: ${json.retCode} ${json.retMsg}`)
              continue
            }
          }

          // If we get a 10004 sign error, try re-syncing time and retrying once
          if (json.retCode === 10004) {
            warn(`[Bybit] Sign error (10004) — re-syncing server time and retrying...`)
            await this.syncServerTime()
            // Retry with same endpoint
            const retryTimestamp = Date.now() + this.timeOffset
            const retryQs = buildQueryString(params)
            const retryFullUrl = retryQs ? `${url}?${retryQs}` : url
            const retryHeaders = buildHeaders(retryQs, this.config.apiKey, this.config.apiSecret, this.recvWindow, retryTimestamp)
            const retryRes = await fetch(retryFullUrl, { method: 'GET', headers: retryHeaders, signal: AbortSignal.timeout(15000) })
            if (retryRes.ok) {
              const retryJson = await retryRes.json() as BybitResponse
              if (retryJson.retCode === 0) return retryJson
              // Still failed after time sync — continue to next endpoint
            }
          }

          return json
        } else {
          const body = JSON.stringify(params)
          headers = buildHeaders(body, this.config.apiKey, this.config.apiSecret, this.recvWindow, timestamp)
          // POST requests need Content-Type
          headers['Content-Type'] = 'application/json'

          const res = await fetch(url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(15000),
          })

          // ── P1-3: Parse Bybit rate limit headers from EVERY POST response ──
          updateBybitRateState(res.headers)

          if (!res.ok) {
            if (res.status === 429) {
              this.consecutiveRateLimitHits++
              // P1-3: Prefer Retry-After header over exponential backoff
              const retryAfterHeader = res.headers.get('Retry-After')
              const backoffMs = retryAfterHeader
                ? parseInt(retryAfterHeader, 10) * 1000
                : Math.min(5000 * Math.pow(2, this.consecutiveRateLimitHits - 1), 60_000)
              this.rateLimitBackoffUntil = Date.now() + backoffMs
              warn(`[Bybit] HTTP 429 rate limit (POST), backing off for ${backoffMs}ms${retryAfterHeader ? ' (Retry-After header)' : ''}`)
              throw new Error(`Bybit rate limit (429), backing off for ${backoffMs}ms`)
            }
            if (res.status === 401 && this.config.mode === 'demo') {
              warn(`[Bybit] HTTP 401 on ${baseUrl}, trying next testnet endpoint...`)
              lastError = new Error(`Bybit API error: ${res.status} ${res.statusText}`)
              continue
            }
            throw new Error(`Bybit API error: ${res.status} ${res.statusText}`)
          }

          const json = await res.json() as BybitResponse

          // Detect Bybit rate limit warnings (retCode 10015 = IP banned, 10016 = rate limit)
          if (json.retCode === 10015 || json.retCode === 10016) {
            this.consecutiveRateLimitHits++
            const backoffMs = Math.min(5000 * Math.pow(2, this.consecutiveRateLimitHits - 1), 60_000)
            this.rateLimitBackoffUntil = Date.now() + backoffMs
            warn(`[Bybit] Rate limit hit (retCode ${json.retCode}), backing off for ${backoffMs}ms (hit #${this.consecutiveRateLimitHits})`)
          } else if (json.retCode === 0) {
            // Successful request — reset counter
            this.consecutiveRateLimitHits = 0
          }

          // Check for API-level auth errors
          if (json.retCode !== 0 && this.config.mode === 'demo') {
            const msg = json.retMsg?.toLowerCase() || ''
            if (msg.includes('invalid') || msg.includes('auth') || msg.includes('api key') || msg.includes('sign') || msg.includes('permission') || msg.includes('token')) {
              warn(`[Bybit] API auth error on ${baseUrl}: ${json.retMsg} (retCode: ${json.retCode}), trying next testnet endpoint...`)
              lastError = new Error(`Bybit API error: ${json.retCode} ${json.retMsg}`)
              continue
            }
          }

          // If we get a 10004 sign error on POST, try re-syncing time
          if (json.retCode === 10004) {
            warn(`[Bybit] Sign error (10004) on POST — re-syncing server time and retrying...`)
            await this.syncServerTime()
            const retryTimestamp = Date.now() + this.timeOffset
            const retryHeaders = buildHeaders(body, this.config.apiKey, this.config.apiSecret, this.recvWindow, retryTimestamp)
            retryHeaders['Content-Type'] = 'application/json'
            const retryRes = await fetch(url, { method: 'POST', headers: retryHeaders, body, signal: AbortSignal.timeout(15000) })
            if (retryRes.ok) {
              const retryJson = await retryRes.json() as BybitResponse
              if (retryJson.retCode === 0) return retryJson
            }
          }

          return json
        }
      } catch (err) {
        if (this.config.mode === 'demo' && err instanceof Error) {
          warn(`[Bybit] Request failed on testnet: ${err.message}`)
          lastError = err
          continue
        }
        throw err
      }
    }

    throw lastError || new Error('Bybit: wszystkie endpointy testnet niedostępne')
  }

  // ─── Server Time ──────────────────────────────────────────────────────────

  /** Get Bybit server time (no auth required) */
  async getServerTime(): Promise<{ serverTime: number; localTime: number; diffMs: number }> {
    const baseUrls: string[] = this.config.mode === 'demo'
      ? TESTNET_ENDPOINTS
      : [this.baseUrl]

    for (const baseUrl of baseUrls) {
      try {
        const localBefore = Date.now()
        const res = await fetch(`${baseUrl}/v5/market/time`, {
          signal: AbortSignal.timeout(10000),
        })
        const localAfter = Date.now()
        if (!res.ok) continue

        const json = await res.json() as BybitResponse
        if (json.retCode !== 0) continue

        const result = json.result as { timeSecond: string; timeNano: string }
        const serverTime = Number(result.timeSecond) * 1000
        const localTime = Math.round((localBefore + localAfter) / 2)
        const diffMs = serverTime - localTime

        return { serverTime, localTime, diffMs }
      } catch {
        continue
      }
    }

    throw new Error('Nie udało się pobrać czasu serwera Bybit')
  }

  // ─── Account ────────────────────────────────────────────────────────────────

  /** Discover sub-accounts under this master account.
   *  Bybit V5: GET /v5/asset/transfer/query-sub-member-list
   *  Returns array of { memberId, memberName, ... }
   */
  async getSubAccounts(): Promise<Array<{ memberId: string; memberName: string }>> {
    // Return cached result if still valid
    if (this.subAccountsCache && Date.now() - this.subAccountsCache.timestamp < BybitClient.SUB_ACCOUNTS_CACHE_TTL) {
      return this.subAccountsCache.data
    }

    try {
      const response = await this.request('GET', '/v5/asset/transfer/query-sub-member-list', {})
      if (response.retCode !== 0) {
        warn(`[Bybit] getSubAccounts: ${response.retMsg} (retCode: ${response.retCode})`)
        return []
      }
      const result = response.result as { memberList?: Array<{ memberId: string; memberName: string }> }
      const subAccounts = (result.memberList || []).map(m => ({
        memberId: String(m.memberId),
        memberName: m.memberName || '',
      }))
      this.subAccountsCache = { data: subAccounts, timestamp: Date.now() }
      return subAccounts
    } catch (err) {
      warn(`[Bybit] getSubAccounts error: ${err instanceof Error ? err.message : err}`)
      return []
    }
  }

  /** Get balance for a specific sub-account by memberId.
   *  Tries UNIFIED then CONTRACT account types. */
  async getSubAccountBalance(memberId: string): Promise<{ usdt: number; accountType: string; totalEquity: number } | null> {
    for (const accountType of ['UNIFIED', 'CONTRACT'] as const) {
      try {
        const params: Record<string, unknown> = { accountType, memberId }
        const response = await this.request('GET', '/v5/account/wallet-balance', params)
        if (response.retCode !== 0) continue

        const result = response.result as { account: BalanceResult[] }
        const account = result.account?.[0]
        if (!account || !account.coin?.length) continue

        const usdtCoin = account.coin.find(c => c.coin === 'USDT')
        const usdt = usdtCoin ? Number(usdtCoin.walletBalance) : 0
        const totalEquity = account.coin.reduce((sum, c) => sum + Number(c.equity), 0)

        if (usdt > 0 || account.coin.some(c => Number(c.equity) > 0)) {
          return { usdt, accountType, totalEquity }
        }
      } catch { continue }
    }
    return null
  }

  /** Internal helper: query wallet-balance for a given accountType (and optional memberId for sub-accounts) */
  private async queryWalletBalance(accountType: string, memberId?: string): Promise<BalanceResult | null> {
    try {
      const params: Record<string, unknown> = { accountType }
      if (memberId) params.memberId = memberId

      const response = await this.request('GET', '/v5/account/wallet-balance', params)
      if (response.retCode !== 0) return null

      const result = response.result as { account?: BalanceResult[]; list?: BalanceResult[] }
      // Bybit V5 returns `result.list` (official docs) but some versions use `result.account`
      const accounts = result.list || result.account
      const account = accounts?.[0]
      if (account && account.coin?.length && account.coin.some(c => Number(c.equity) > 0 || Number(c.walletBalance) > 0)) {
        return account
      }
    } catch {
      // ignore, try next
    }
    return null
  }

  /** Get wallet balance — tries UNIFIED then CONTRACT, on main account AND sub-accounts */
  async getBalance(): Promise<BalanceResult & { source?: string }> {
    const accountTypes = ['UNIFIED', 'CONTRACT'] as const

    // 1) Try main account first
    for (const accountType of accountTypes) {
      const result = await this.queryWalletBalance(accountType)
      if (result) return { ...result, source: `main:${accountType}` }
    }

    // 2) Try sub-accounts (if main account has zero balance, funds might be on a sub-account)
    const subAccounts = await this.getSubAccounts()
    for (const sub of subAccounts) {
      for (const accountType of accountTypes) {
        const result = await this.queryWalletBalance(accountType, sub.memberId)
        if (result) {
          log(`[Bybit] Found balance on sub-account "${sub.memberName}" (${sub.memberId}), accountType: ${accountType}`)
          return { ...result, source: `sub:${sub.memberName}:${accountType}` }
        }
      }
    }

    return { accountType: 'UNIFIED', coin: [], source: 'none' }
  }

  /** Get all coin balances with non-zero holdings */
  async getAllBalances(): Promise<{ totalEquityUsdt: number; coins: CoinBalance[]; accountType: string; source?: string }> {
    try {
      const balance = await this.getBalance()
      const coins: CoinBalance[] = (balance.coin || [])
        .filter(c => Number(c.walletBalance) > 0 || Number(c.equity) > 0)
        .map(c => ({
          coin: c.coin,
          equity: c.equity,
          availableToWithdraw: c.availableToWithdraw,
          walletBalance: c.walletBalance,
          unrealisedPnl: c.unrealisedPnl,
          free: c.availableToWithdraw,
          locked: (Number(c.equity) - Number(c.availableToWithdraw)).toFixed(8),
        }))

      // Total equity is roughly the sum of all coin equities (USDT-denominated)
      const totalEquityUsdt = coins.reduce((sum, c) => sum + Number(c.equity), 0)

      return {
        totalEquityUsdt,
        coins,
        accountType: balance.accountType,
        source: balance.source,
      }
    } catch {
      return { totalEquityUsdt: 0, coins: [], accountType: 'UNIFIED' }
    }
  }

  /** Test API key validity by fetching balance and server time sync.
   *  Tries main account (UNIFIED, CONTRACT) then sub-accounts. */
  async testConnection(): Promise<{ success: boolean; message: string; balance?: number; timeDiff?: number; accountType?: string; source?: string }> {
    try {
      // First check server time sync
      const timeInfo = await this.getServerTime()
      const timeDiff = timeInfo.diffMs

      if (Math.abs(timeDiff) > 5000) {
        return {
          success: false,
          message: `Desynchronizacja czasu: różnica ${timeDiff > 0 ? '+' : ''}${timeDiff}ms. Serwer: ${new Date(timeInfo.serverTime).toISOString()}, Lokalny: ${new Date(timeInfo.localTime).toISOString()}`,
          timeDiff,
        }
      }

      // Try main account: UNIFIED then CONTRACT
      const accountTypes = ['UNIFIED', 'CONTRACT'] as const
      for (const accountType of accountTypes) {
        const result = await this.queryWalletBalance(accountType)
        if (result) {
          const usdtCoin = result.coin?.find(c => c.coin === 'USDT')
          const usdtBalance = usdtCoin ? Number(usdtCoin.walletBalance) : 0
          return {
            success: true,
            message: `Połączono z Bybit (${this.config.mode}, konto główne ${accountType}). Saldo USDT: ${usdtBalance.toFixed(2)}`,
            balance: usdtBalance,
            timeDiff,
            accountType,
            source: `main:${accountType}`,
          }
        }
      }

      // Try sub-accounts
      const subAccounts = await this.getSubAccounts()
      for (const sub of subAccounts) {
        for (const accountType of accountTypes) {
          const result = await this.queryWalletBalance(accountType, sub.memberId)
          if (result) {
            const usdtCoin = result.coin?.find(c => c.coin === 'USDT')
            const usdtBalance = usdtCoin ? Number(usdtCoin.walletBalance) : 0
            log(`[Bybit] testConnection: found balance on sub-account "${sub.memberName}" (${sub.memberId}), ${accountType}`)
            return {
              success: true,
              message: `Połączono z Bybit (${this.config.mode}, subkonto "${sub.memberName}" ${accountType}). Saldo USDT: ${usdtBalance.toFixed(2)}`,
              balance: usdtBalance,
              timeDiff,
              accountType,
              source: `sub:${sub.memberName}:${accountType}`,
            }
          }
        }
      }

      // API key works but no USDT found anywhere
      return {
        success: true,
        message: `Połączono z Bybit (${this.config.mode}), ale brak USDT na koncie głównym i subkontach. Przelej USDT na konto Unified Trading.`,
        balance: 0,
        timeDiff,
        accountType: 'NONE',
        source: 'none',
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Błąd połączenia z Bybit'
      // Provide helpful diagnostic info
      if (errMsg.includes('sign') || errMsg.includes('10004')) {
        return {
          success: false,
          message: `Błąd podpisu (10004). Możliwe przyczyny: (1) błędny API Secret, (2) białe znaki w kluczu, (3) klucze z innego środowiska (testnet vs mainnet). Sprawdź czy klucz i secret są dokładnie takie same jak na Bybit.`,
        }
      }
      return {
        success: false,
        message: errMsg,
      }
    }
  }

  // ─── Market Data ────────────────────────────────────────────────────────────

  /** Get ticker for a symbol */
  async getTicker(symbol: string): Promise<TickerResult> {
    const response = await this.request('GET', '/v5/market/tickers', {
      category: 'spot',
      symbol,
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit ticker error: ${response.retMsg}`)
    }
    const result = response.result as { list: TickerResult[] }
    return result.list?.[0] || null
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  /** Place a market buy order (spot) */
  async marketBuy(symbol: string, qty: string, orderLinkId?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      category: 'spot',
      symbol,
      side: 'Buy',
      orderType: 'Market',
      qty,
    }
    if (orderLinkId) params.orderLinkId = orderLinkId

    const response = await this.request('POST', '/v5/order/create', params)
    if (response.retCode !== 0) {
      throw new Error(`Bybit order error: ${response.retMsg}`)
    }
    return response.result as OrderResult
  }

  /** Place a market sell order (spot) */
  async marketSell(symbol: string, qty: string, orderLinkId?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      category: 'spot',
      symbol,
      side: 'Sell',
      orderType: 'Market',
      qty,
    }
    if (orderLinkId) params.orderLinkId = orderLinkId

    const response = await this.request('POST', '/v5/order/create', params)
    if (response.retCode !== 0) {
      throw new Error(`Bybit order error: ${response.retMsg}`)
    }
    return response.result as OrderResult
  }

  /** Place a limit sell order (for TP) */
  async limitSell(symbol: string, qty: string, price: string, orderLinkId?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      category: 'spot',
      symbol,
      side: 'Sell',
      orderType: 'Limit',
      qty,
      price,
    }
    if (orderLinkId) params.orderLinkId = orderLinkId

    const response = await this.request('POST', '/v5/order/create', params)
    if (response.retCode !== 0) {
      throw new Error(`Bybit limit order error: ${response.retMsg}`)
    }
    return response.result as OrderResult
  }

  /** Cancel an order */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const response = await this.request('POST', '/v5/order/cancel', {
      category: 'spot',
      symbol,
      orderId,
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit cancel error: ${response.retMsg}`)
    }
  }

  /** Get open orders for a symbol */
  async getOpenOrders(symbol: string): Promise<Array<{ orderId: string; side: string; orderType: string; price: string; qty: string; orderStatus: string }>> {
    const response = await this.request('GET', '/v5/order/realtime', {
      category: 'spot',
      symbol,
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit orders error: ${response.retMsg}`)
    }
    const result = response.result as { list: Array<{ orderId: string; side: string; orderType: string; price: string; qty: string; orderStatus: string }> }
    return result.list || []
  }

  // ─── Order History ──────────────────────────────────────────────────────────

  /** Get order history to check fill price */
  async getOrderHistory(symbol: string, limit: number = 5): Promise<Array<{ orderId: string; side: string; orderType: string; price: string; avgPrice: string; qty: string; cumExecQty: string; orderStatus: string; createdTime: string }>> {
    const response = await this.request('GET', '/v5/order/history', {
      category: 'spot',
      symbol,
      limit,
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit order history error: ${response.retMsg}`)
    }
    const result = response.result as { list: Array<{ orderId: string; side: string; orderType: string; price: string; avgPrice: string; qty: string; cumExecQty: string; orderStatus: string; createdTime: string }> }
    return result.list || []
  }

  // ─── Spot Asset Balance ─────────────────────────────────────────────────────

  /** Get coin balance for spot trading */
  async getCoinBalance(coin: string): Promise<number> {
    const response = await this.request('GET', '/v5/asset/coin-balance', {
      coin,
      accountType: 'spot',
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit coin balance error: ${response.retMsg}`)
    }
    const result = response.result as { balance: { free: string; locked: string; walletBalance: string } }
    return Number(result.balance?.walletBalance || 0)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── LINEAR PERPETUAL (USDT-M) FUTURES ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  // All futures methods use category: 'linear' for USDT-M contracts.
  // Bybit V5 docs: https://bybit-exchange.github.io/docs/v5/order

  /** Get wallet balance for futures trading.
   *  Tries UNIFIED first (most common for USDT-M futures),
   *  falls back to CONTRACT (classic derivative account).
   *  Bybit V5 has different account types and the user may have either.
   *  Uses balance cache (5s TTL) and cached subMemberId fast path to minimise API calls.
   */
  async getFuturesBalance(): Promise<{
    totalEquityUsdt: number
    availableBalance: number
    totalWalletBalance: number
    totalUnrealisedPnl: number
    coins: CoinBalance[]
    accountType: string
    source: string
    subAccountName?: string
  }> {
    // Return cached balance if fresh enough (5s TTL)
    if (this.balanceCache && Date.now() - this.balanceCache.timestamp < BybitClient.BALANCE_CACHE_TTL) {
      return this.balanceCache.data
    }

    // Try account types in order: UNIFIED (most common), CONTRACT (classic)
    const accountTypes = ['UNIFIED', 'CONTRACT'] as const

    // Helper to parse a balance response into our format
    const parseBalance = (account: BalanceResult, accountType: string): {
      totalEquityUsdt: number; availableBalance: number; totalWalletBalance: number
      totalUnrealisedPnl: number; coins: CoinBalance[]; accountType: string
    } | null => {
      const coins: CoinBalance[] = (account.coin || [])
        .filter(c => Number(c.walletBalance) > 0 || Number(c.equity) > 0)
        .map(c => ({
          coin: c.coin,
          equity: c.equity,
          availableToWithdraw: c.availableToWithdraw,
          walletBalance: c.walletBalance,
          unrealisedPnl: c.unrealisedPnl,
          free: c.availableToWithdraw,
          locked: (Number(c.equity) - Number(c.availableToWithdraw)).toFixed(8),
        }))
      if (coins.length === 0) return null
      const usdtCoin = coins.find(c => c.coin === 'USDT')
      // Use totalAvailableBalance from account level (correct for UNIFIED futures margin)
      // Fallback to USDT walletBalance if totalAvailableBalance is not available
      const accountAvailableBalance = Number(account.totalAvailableBalance || 0)
      const usdtAvailable = accountAvailableBalance > 0
        ? accountAvailableBalance
        : Number(usdtCoin?.availableToWithdraw || 0)
      return {
        totalEquityUsdt: Number(account.totalEquity || 0) || coins.reduce((sum, c) => sum + Number(c.equity), 0),
        availableBalance: usdtAvailable,
        totalWalletBalance: Number(usdtCoin?.walletBalance || 0),
        totalUnrealisedPnl: Number(usdtCoin?.unrealisedPnl || 0),
        coins,
        accountType,
      }
    }

    // Fast path: try cached sub-account first (saves 3+ API calls on repeat invocations)
    if (this.subMemberId) {
      for (const accountType of accountTypes) {
        const result = await this.queryWalletBalance(accountType, this.subMemberId!)
        if (result) {
          const parsed = parseBalance(result, accountType)
          if (parsed) {
            const ret = { ...parsed, source: `sub:${this.subAccountName}:${accountType}`, subAccountName: this.subAccountName! }
            this.balanceCache = { data: ret, timestamp: Date.now() }
            return ret
          }
        }
      }
      // Cached sub-account had no balance — clear it and fall through to full discovery
      this.subMemberId = null
      this.subAccountName = null
    }

    // 1) Try main account
    for (const accountType of accountTypes) {
      const result = await this.queryWalletBalance(accountType)
      if (result) {
        const parsed = parseBalance(result, accountType)
        if (parsed) {
          log(`[Bybit] getFuturesBalance: found balance in main ${accountType} account (USDT: ${parsed.totalWalletBalance})`)
          this.subMemberId = null
          this.subAccountName = null
          const ret = { ...parsed, source: `main:${accountType}` }
          this.balanceCache = { data: ret, timestamp: Date.now() }
          return ret
        }
      }
    }

    // 2) Try sub-accounts (cache the discovery result)
    const subAccounts = await this.getSubAccounts()
    for (const sub of subAccounts) {
      for (const accountType of accountTypes) {
        const result = await this.queryWalletBalance(accountType, sub.memberId)
        if (result) {
          const parsed = parseBalance(result, accountType)
          if (parsed) {
            log(`[Bybit] getFuturesBalance: found balance on sub-account "${sub.memberName}" (${sub.memberId}), ${accountType} (USDT: ${parsed.totalWalletBalance})`)
            // Auto-set sub-account for all future operations (orders, positions, etc.)
            this.subMemberId = sub.memberId
            this.subAccountName = sub.memberName
            const ret = { ...parsed, source: `sub:${sub.memberName}:${accountType}`, subAccountName: sub.memberName }
            this.balanceCache = { data: ret, timestamp: Date.now() }
            return ret
          }
        }
      }
    }

    // No balance found anywhere
    warn('[Bybit] getFuturesBalance: no balance found on main account or sub-accounts. Is the API key correct and does the account have USDT?')
    const ret = { totalEquityUsdt: 0, availableBalance: 0, totalWalletBalance: 0, totalUnrealisedPnl: 0, coins: [], accountType: 'NONE', source: 'empty' }
    this.balanceCache = { data: ret, timestamp: Date.now() }
    return ret
  }

  /** Get open linear perpetual positions */
  async getLinearPositions(symbol?: string): Promise<Array<{
    symbol: string
    side: 'Buy' | 'Sell'
    size: string
    avgPrice: string
    unrealisedPnl: string
    leverage: string
    markPrice: string
    liqPrice: string
    createdTime: string
    positionIdx: number
    takeProfit: string
    stopLoss: string
    tpTriggerBy: string
    slTriggerBy: string
    trailingStop: string
    tpslMode: string
  }>> {
    const params: Record<string, unknown> = {
      category: 'linear',
      settleCoin: 'USDT',
    }
    if (symbol) params.symbol = symbol
    // If we detected a sub-account, query positions on that sub-account
    if (this.subMemberId) params.memberId = this.subMemberId

    const response = await this.request('GET', '/v5/position/list', params)
    if (response.retCode !== 0) {
      throw new Error(`Bybit positions error: ${response.retMsg}`)
    }
    const result = response.result as { list: Array<{
      symbol: string
      side: 'Buy' | 'Sell'
      size: string
      avgPrice: string
      unrealisedPnl: string
      leverage: string
      markPrice: string
      liqPrice: string
      createdTime: string
      positionIdx: number
      takeProfit: string
      stopLoss: string
      tpTriggerBy: string
      slTriggerBy: string
      trailingStop: string
      tpslMode: string
    }> }
    // Bybit returns ALL positions including zero-size; filter those out
    return (result.list || []).filter(p => Number(p.size) > 0)
  }

  /** Get closed profit & loss history for linear perpetual positions.
   *  Bybit V5: GET /v5/position/closed-pnl
   *  Returns the REALIZED PnL as reported by Bybit (after fees).
   *  This is the authoritative source for actual closed trade profits.
   *
   *  @param symbol - Optional symbol filter (e.g. 'BTCUSDT')
   *  @param startTime - Unix timestamp in milliseconds (optional)
   *  @param endTime - Unix timestamp in milliseconds (optional)
   *  @param limit - Max records to return (default 50, max 100)
   */
  async getClosedPnl(params?: {
    symbol?: string
    startTime?: number
    endTime?: number
    limit?: number
  }): Promise<Array<{
    symbol: string
    side: string
    qty: string
    leverage: string
    orderPrice: string
    orderType: string
    execType: string
    avgEntryPrice: string
    avgExitPrice: string
    closedPnl: string
    fillCount: string
    createdTime: string
    updatedTime: string
  }>> {
    const queryParams: Record<string, unknown> = {
      category: 'linear',
      limit: params?.limit || 50,
    }
    if (params?.symbol) queryParams.symbol = params.symbol
    if (params?.startTime) queryParams.startTime = params.startTime
    if (params?.endTime) queryParams.endTime = params.endTime
    if (this.subMemberId) queryParams.memberId = this.subMemberId

    try {
      const response = await this.request('GET', '/v5/position/closed-pnl', queryParams)
      if (response.retCode !== 0) {
        warn(`[Bybit] getClosedPnl: ${response.retMsg} (retCode: ${response.retCode})`)
        return []
      }
      const result = response.result as { list: Array<{
        symbol: string
        side: string
        qty: string
        leverage: string
        orderPrice: string
        orderType: string
        execType: string
        avgEntryPrice: string
        avgExitPrice: string
        closedPnl: string
        fillCount: string
        createdTime: string
        updatedTime: string
     }> }
      return result.list || []
    } catch (err) {
      warn(`[Bybit] getClosedPnl error: ${err instanceof Error ? err.message : err}`)
      return []
    }
  }

  /** Set leverage for a linear perpetual symbol */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const body: Record<string, unknown> = {
      category: 'linear',
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    }
    // If sub-account detected, set leverage on that sub-account
    if (this.subMemberId) body.subMemberId = this.subMemberId

    const response = await this.request('POST', '/v5/position/set-leverage', body)
    if (response.retCode !== 0) {
      // 110028 = leverage not modified (already set) — not an error
      if (response.retCode === 110028) return
      throw new Error(`Bybit set leverage error (${response.retCode}): ${response.retMsg}`)
    }
  }

  /** Detect position mode for a symbol (One-Way vs Hedge).
   *  Bybit V5: GET /v5/account/position-mode?category=linear&symbol=XXX
   *  Returns 'MergedSingle' (One-Way, positionIdx=0) or 'BothSide' (Hedge, positionIdx=1/2).
   *  Result is cached for 30 min per symbol to avoid extra API calls.
   */
  async getPositionMode(symbol: string): Promise<'MergedSingle' | 'BothSide'> {
    const cached = this.positionModeCache.get(symbol)
    if (cached && Date.now() - cached.timestamp < BybitClient.POSITION_MODE_CACHE_TTL) {
      return cached.mode
    }
    try {
      const params: Record<string, unknown> = { category: 'linear', symbol }
      if (this.subMemberId) params.subMemberId = this.subMemberId
      const response = await this.request('GET', '/v5/account/position-mode', params)
      if (response.retCode === 0) {
        const result = response.result as { positionMode?: string }
        const mode = (result.positionMode === 'BothSide' ? 'BothSide' : 'MergedSingle') as 'MergedSingle' | 'BothSide'
        this.positionModeCache.set(symbol, { mode, timestamp: Date.now() })
        log(`[Bybit] getPositionMode: ${symbol} = ${mode}`)
        return mode
      }
      // If API fails, default to MergedSingle (One-Way) — safest assumption
      warn(`[Bybit] getPositionMode: ${symbol} API error ${response.retCode}: ${response.retMsg}, defaulting to MergedSingle`)
      return 'MergedSingle'
    } catch (err) {
      warn(`[Bybit] getPositionMode: ${symbol} exception: ${err instanceof Error ? err.message : err}, defaulting to MergedSingle`)
      return 'MergedSingle'
    }
  }

  /** Compute the correct positionIdx for a given symbol and side.
   *  One-Way mode (MergedSingle): positionIdx = 0 for both Buy and Sell.
   *  Hedge mode (BothSide): positionIdx = 1 for Buy (Long), 2 for Sell (Short).
   *  This is CRITICAL for TP/SL — wrong positionIdx causes Bybit to silently ignore SL/TP.
   */
  async getPositionIdx(symbol: string, side: 'Buy' | 'Sell'): Promise<number> {
    const mode = await this.getPositionMode(symbol)
    if (mode === 'BothSide') {
      return side === 'Buy' ? 1 : 2
    }
    return 0
  }

  /** Place a linear perpetual market order */
  async placeLinearOrder(params: {
    symbol: string
    side: 'Buy' | 'Sell'
    qty: string          // Contract quantity (in USD for linear USDT perps)
    orderType?: 'Market' | 'Limit'
    price?: string       // Required for Limit orders
    timeInForce?: 'IOC' | 'GTC' | 'PostOnly'
    reduceOnly?: boolean
    orderLinkId?: string
    stopLoss?: string    // Trigger price for SL
    slTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
    takeProfit?: string  // Trigger price for TP
    tpTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
  }): Promise<OrderResult & { retCode?: number; retMsg?: string; slConfirmed?: boolean; tpConfirmed?: boolean }> {
    // P0 FIX: Detect position mode and use correct positionIdx
    const positionIdx = await this.getPositionIdx(params.symbol, params.side)

    const body: Record<string, unknown> = {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || 'Market',
      qty: params.qty,
      positionIdx,
    }
    // If we detected a sub-account, place order on that sub-account
    if (this.subMemberId) {
      body.subMemberId = this.subMemberId
    }
    if (params.price) body.price = params.price
    if (params.timeInForce) body.timeInForce = params.timeInForce
    if (params.reduceOnly) body.reduceOnly = true
    if (params.orderLinkId) body.orderLinkId = params.orderLinkId
    if (params.stopLoss) {
      body.stopLoss = params.stopLoss
      body.slTriggerBy = params.slTriggerBy || 'MarkPrice'
    }
    if (params.takeProfit) {
      body.takeProfit = params.takeProfit
      body.tpTriggerBy = params.tpTriggerBy || 'MarkPrice'
    }
    // tpslMode is REQUIRED by Bybit V5 when both TP and SL are set on the same order.
    // 'Full' = TP/SL closes the entire position. Without this, Bybit may reject
    // the order (retCode 10001) or silently ignore TP/SL.
    if (params.stopLoss || params.takeProfit) {
      body.tpslMode = 'Full'
    }

    // Log full payload for debugging (mask any sensitive fields if added later)
    console.log('[BYBIT] placeLinearOrder payload:', JSON.stringify(body, null, 2))

    const response = await this.request('POST', '/v5/order/create', body)
    if (response.retCode !== 0) {
      return { orderId: '', orderLinkId: '', retCode: response.retCode, retMsg: response.retMsg }
    }

    // P1 FIX (v2): TP/SL confirmation logic.
    // Bybit POST /v5/order/create response does NOT include stopLoss/takeProfit fields
    // in the result object — it only returns { orderId, orderLinkId }. Checking for
    // result.stopLoss/takeProfit was always producing false "NOT CONFIRMED" alerts.
    // Instead, we trust retCode === 0: if Bybit accepted the order with SL/TP params,
    // they were applied. Actual verification happens in the async reconcile step
    // (open/route.ts) which queries the position after settlement.
    const result = response.result as Record<string, unknown> & { orderId: string; orderLinkId: string }
    const slConfirmed = !params.stopLoss || response.retCode === 0
    const tpConfirmed = !params.takeProfit || response.retCode === 0

    // Log full response for audit trail
    console.log('[BYBIT] placeLinearOrder response:', JSON.stringify(response, null, 2))

    return {
      orderId: result.orderId || '',
      orderLinkId: result.orderLinkId || '',
      retCode: response.retCode || 0,
      retMsg: response.retMsg || 'OK',
      slConfirmed,
      tpConfirmed,
    }
  }

  /** Close a linear perpetual position (reduce-only market order) */
  async closeLinearPosition(params: {
    symbol: string
    side: 'Buy' | 'Sell'  // Opposite of position side: Buy position → Sell to close
    qty: string
    orderLinkId?: string
  }): Promise<OrderResult & { retCode?: number; retMsg?: string; slConfirmed?: boolean; tpConfirmed?: boolean }> {
    return this.placeLinearOrder({
      symbol: params.symbol,
      side: params.side,
      qty: params.qty,
      orderType: 'Market',
      timeInForce: 'IOC',       // Immediate-or-Cancel: prevent market order becoming limit
      reduceOnly: true,
      orderLinkId: params.orderLinkId,
    })
  }

  /** Get instrument info (tick size, lot size, min qty) for a linear symbol */
  async getInstrumentInfo(symbol: string): Promise<{
    lotSizeFilter: { basePrecision: string; quotePrecision: string; minOrderQty: string; maxOrderQty: string; qtyStep: string }
    priceFilter: { tickSize: string; minPrice: string; maxPrice: string }
  } | null> {
    const response = await this.request('GET', '/v5/market/instruments-info', {
      category: 'linear',
      symbol,
    })
    if (response.retCode !== 0) return null
    const result = response.result as { list: Array<{
      lotSizeFilter: { basePrecision: string; quotePrecision: string; minOrderQty: string; maxOrderQty: string; qtyStep: string }
      priceFilter: { tickSize: string; minPrice: string; maxPrice: string }
    }> }
    return result.list?.[0] || null
  }

  /** Get linear ticker (mark price, last price) */
  async getLinearTicker(symbol: string): Promise<{
    lastPrice: string
    markPrice: string
    indexPrice: string
    fundingRate: string
    volume24h: string
  } | null> {
    const response = await this.request('GET', '/v5/market/tickers', {
      category: 'linear',
      symbol,
    })
    if (response.retCode !== 0) return null
    const result = response.result as { list: Array<{
      lastPrice: string
      markPrice: string
      indexPrice: string
      fundingRate: string
      volume24h: string
    }> }
    return result.list?.[0] || null
  }

  /** Get order history for a linear symbol (for fill reconciliation) */
  async getLinearOrderHistory(symbol: string, limit: number = 5): Promise<Array<{
    orderId: string
    orderLinkId: string
    side: string
    orderType: string
    price: string
    avgPrice: string
    qty: string
    cumExecQty: string
    cumExecFee: string
    orderStatus: string
    createdTime: string
    updatedTime: string
  }>> {
    const response = await this.request('GET', '/v5/order/history', {
      category: 'linear',
      symbol,
      limit,
    })
    if (response.retCode !== 0) {
      throw new Error(`Bybit linear order history error: ${response.retMsg}`)
    }
    const result = response.result as { list: Array<{
      orderId: string
      orderLinkId: string
      side: string
      orderType: string
      price: string
      avgPrice: string
      qty: string
      cumExecQty: string
      cumExecFee: string
      orderStatus: string
      createdTime: string
      updatedTime: string
    }> }
    return result.list || []
  }

  /** Cancel all open orders for a linear symbol (emergency use) */
  async cancelAllLinearOrders(symbol: string): Promise<void> {
    const body: Record<string, unknown> = {
      category: 'linear',
      symbol,
      stopOrderType: 'Order',
    }
    if (this.subMemberId) body.subMemberId = this.subMemberId

    const response = await this.request('POST', '/v5/order/cancel-all', body)
    if (response.retCode !== 0) {
      throw new Error(`Bybit cancel all error: ${response.retMsg}`)
    }
  }

  /** Switch margin mode for a specific symbol to ISOLATED (per-pair).
   *  Bybit UTA accounts are globally Cross Margin, but Isolated can be set per-symbol.
   *  This is the recommended mode for bot trading — each position risks only its own margin.
   *  Bybit V5: POST /v5/position/switch-isolated
   *  Parameters: category, symbol, tradeMode (0=Cross, 1=Isolated), buyLeverage, sellLeverage
   *  retCode 110024 = "not modified" (already in that mode) — not an error.
   */
  async switchIsolatedMargin(symbol: string, leverage: number): Promise<{ success: boolean; alreadySet: boolean; message: string }> {
    try {
      const body: Record<string, unknown> = {
        category: 'linear',
        symbol,
        tradeMode: 1,  // 0=Cross, 1=Isolated
        buyLeverage: String(leverage),
        sellLeverage: String(leverage),
      }
      // Sub-account support
      if (this.subMemberId) body.subMemberId = this.subMemberId

      const response = await this.request('POST', '/v5/position/switch-isolated', body)

      if (response.retCode === 0) {
        log(`[Bybit] switchIsolatedMargin: ${symbol} → ISOLATED ${leverage}x`)
        return { success: true, alreadySet: false, message: `${symbol} switched to Isolated ${leverage}x` }
      }

      // 110024 = not modified (already Isolated with same leverage)
      if (response.retCode === 110024) {
        log(`[Bybit] switchIsolatedMargin: ${symbol} already ISOLATED ${leverage}x`)
        return { success: true, alreadySet: true, message: `${symbol} already Isolated ${leverage}x` }
      }

      warn(`[Bybit] switchIsolatedMargin: ${symbol} error ${response.retCode}: ${response.retMsg}`)
      return { success: false, alreadySet: false, message: `Error ${response.retCode}: ${response.retMsg}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      warn(`[Bybit] switchIsolatedMargin: ${symbol} exception: ${msg}`)
      return { success: false, alreadySet: false, message: msg }
    }
  }

  /** Switch margin mode for a specific symbol back to CROSS (per-pair).
   *  Bybit V5: POST /v5/position/switch-isolated with tradeMode=0
   */
  async switchCrossMargin(symbol: string, leverage: number): Promise<{ success: boolean; alreadySet: boolean; message: string }> {
    try {
      const body: Record<string, unknown> = {
        category: 'linear',
        symbol,
        tradeMode: 0,  // 0=Cross
        buyLeverage: String(leverage),
        sellLeverage: String(leverage),
      }
      if (this.subMemberId) body.subMemberId = this.subMemberId

      const response = await this.request('POST', '/v5/position/switch-isolated', body)

      if (response.retCode === 0) {
        return { success: true, alreadySet: false, message: `${symbol} switched to Cross ${leverage}x` }
      }
      if (response.retCode === 110024) {
        return { success: true, alreadySet: true, message: `${symbol} already Cross ${leverage}x` }
      }

      return { success: false, alreadySet: false, message: `Error ${response.retCode}: ${response.retMsg}` }
    } catch (err) {
      return { success: false, alreadySet: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  /** Update trading stop (SL/TP/trailing) for an open position.
   *  Bybit V5: POST /v5/position/trading-stop
   *  This is used to update the native SL/TP after the position is already open,
   *  e.g. when trailing stop activates or after partial TP reduces position size.
   *  Parameters: category, symbol, stopLoss, takeProfit, trailingStop, tpslMode, slTriggerBy, tpTriggerBy
   *
   *  P0 FIX: positionIdx is now auto-detected from account position mode + position side.
   *  If side is not provided, we fetch the open position from Bybit to determine it.
   */
  async setTradingStop(params: {
    symbol: string
    side?: 'Buy' | 'Sell'   // P0 FIX: position side needed for Hedge mode positionIdx
    stopLoss?: string
    slTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
    takeProfit?: string
    tpTriggerBy?: 'LastPrice' | 'MarkPrice' | 'IndexPrice'
    trailingStop?: string    // Trailing stop distance in percentage (e.g. '0.5' = 0.5%)
    tpslMode?: 'Full' | 'Partial'
  }): Promise<{ success: boolean; retCode?: number; retMsg?: string }> {
    try {
      // P0 FIX: Determine correct positionIdx from position mode + side
      let positionIdx = 0
      let side = params.side
      if (!side) {
        // Fallback: fetch the open position from Bybit to determine its side
        try {
          const positions = await this.getLinearPositions(params.symbol)
          const openPos = positions.find(p => Number(p.size) > 0)
          if (openPos) {
            side = openPos.side as 'Buy' | 'Sell'
          }
        } catch {
          // If position fetch fails, default to One-Way (positionIdx=0)
        }
      }
      if (side) {
        positionIdx = await this.getPositionIdx(params.symbol, side)
      }

      const body: Record<string, unknown> = {
        category: 'linear',
        symbol: params.symbol,
        positionIdx,
      }
      if (this.subMemberId) body.subMemberId = this.subMemberId

      if (params.stopLoss) {
        body.stopLoss = params.stopLoss
        body.slTriggerBy = params.slTriggerBy || 'MarkPrice'
      }
      if (params.takeProfit) {
        body.takeProfit = params.takeProfit
        body.tpTriggerBy = params.tpTriggerBy || 'MarkPrice'
      }
      if (params.trailingStop) {
        body.trailingStop = params.trailingStop
      }
      // tpslMode is required when both TP and SL are set
      if (params.stopLoss || params.takeProfit) {
        body.tpslMode = params.tpslMode || 'Full'
      }

      console.log('[BYBIT] setTradingStop payload:', JSON.stringify(body, null, 2))
      const response = await this.request('POST', '/v5/position/trading-stop', body)

      if (response.retCode === 0) {
        log(`[Bybit] setTradingStop: ${params.symbol} SL=${params.stopLoss || 'unchanged'} TP=${params.takeProfit || 'unchanged'} trail=${params.trailingStop || 'unchanged'}`)
        return { success: true }
      }

      // 110025 = position is zero or position does not exist
      // 110043 = TP/SL not modified
      if (response.retCode === 110043) {
        return { success: true, retCode: response.retCode, retMsg: 'Not modified (already set)' }
      }

      warn(`[Bybit] setTradingStop: ${params.symbol} error ${response.retCode}: ${response.retMsg}`)
      return { success: false, retCode: response.retCode, retMsg: response.retMsg }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      warn(`[Bybit] setTradingStop: ${params.symbol} exception: ${msg}`)
      return { success: false, retMsg: msg }
    }
  }
}

// ─── Helper: Create BybitClient from stored DB keys ──────────────────────────

export async function createBybitClient(mode: BybitMode): Promise<BybitClient> {
  const { db } = await import('./db')
  const { decrypt } = await import('./encryption')

  const api = await db.exchangeApi.findUnique({
    where: { exchange_mode: { exchange: 'bybit', mode } },
  })

  if (!api || !api.isConfigured) {
    throw new Error(`Klucze API Bybit (${mode}) nie są skonfigurowane`)
  }

  const apiKey = decrypt(api.apiKey)
  const apiSecret = decrypt(api.apiSecret)
  const keyHash = hashKey(apiKey + apiSecret)
  const subMemberId = (api as any).subMemberId || undefined
  const subAccountName = (api as any).subAccountName || undefined

  // Check cache for existing client with same keys
  const cacheKey = `${mode}:${subMemberId || 'main'}`
  const cached = clientCache.get(cacheKey)

  if (cached && (Date.now() - cached.createdAt) < CLIENT_CACHE_TTL && cached.apiKeyHash === keyHash) {
    // Reuse cached client — timeOffset and rate limit state are preserved
    return cached.client
  }

  // Create new client and cache it
  const client = new BybitClient({
    apiKey,
    apiSecret,
    mode,
    subMemberId,
    subAccountName,
  })

  clientCache.set(cacheKey, {
    client,
    createdAt: Date.now(),
    apiKeyHash: keyHash,
  })

  log(`[Bybit] Created new client for ${cacheKey} (cached for ${CLIENT_CACHE_TTL / 60000}min)`)

  return client
}
