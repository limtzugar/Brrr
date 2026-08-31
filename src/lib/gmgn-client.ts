// ─── GMGN API Client — Solana Token Intelligence ──────────────────────────
// Integrates with GMGN.ai API for:
//   - Token safety scoring (rug/honeypot detection)
//   - Smart Money wallet tracking
//   - Token market data (volume, holders, price)
//   - Swap execution via Jupiter routing
//
// API docs: https://gmgn.ai/api/docs (unofficial, reverse-engineered)

export interface GmgnTokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
  logoUrl: string | null
  price: number
  priceChange1h: number
  priceChange24h: number
  volume24h: number
  volume1h: number
  liquidity: number
  marketCap: number
  fdv: number
  holderCount: number
  topHolderPct: number           // % held by top 10 holders
  age: string                    // e.g. "2h", "3d"
  createdAt: number              // Unix ms
}

export interface GmgnTokenSecurity {
  address: string
  isScam: boolean
  isHoneypot: boolean
  isRenounced: boolean
  mintAuthority: string | null   // null = renounced
  freezeAuthority: string | null // null = renounced
  sellTax: number                // 0-100%
  buyTax: number                 // 0-100%
  isOpenSource: boolean          // Contract source verified
  isProxy: boolean               // Proxy contract (upgradeable)
  canMint: boolean               // Mint authority can create new tokens
  canFreeze: boolean             // Freeze authority can freeze accounts
  safetyScore: number            // 0-100 (higher = safer)
  flags: string[]                // ["high_sell_tax", "mint_not_renounced", etc.]
}

export interface GmgnSmartMoneyWallet {
  address: string
  label: string                  // e.g. "Smart Money", "Whale", "Insider"
  pnl24h: number
  pnl7d: number
  winRate: number                // 0-1
  tradeCount: number
  avgHoldingTime: number         // seconds
  totalPnlUsd: number
  tags: string[]                 // ["sniper", "early_buyer", "whale"]
}

export interface GmgnSwapQuote {
  inputMint: string
  outputMint: string
  inAmount: number
  outAmount: number
  priceImpact: number
  fee: number
  route: Array<{
    pool: string
    dex: string
    inAmount: number
    outAmount: number
  }>
}

export interface GmgnSwapResult {
  signature: string
  status: 'confirmed' | 'failed' | 'pending'
  inputAmount: number
  outputAmount: number
  priceImpact: number
  fee: number
}

// ─── HTTP Client with Rate Limiting ────────────────────────────────────────

const GMGN_BASE = 'https://gmgn.ai'
const GMGN_API_BASE = 'https://gmgn.ai/api'

class RateLimiter {
  private timestamps: number[] = []
  constructor(private maxRequests: number, private windowMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0]
      const waitMs = this.windowMs - (now - oldestInWindow) + 50
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))
    }
    this.timestamps.push(Date.now())
  }
}

const rateLimiter = new RateLimiter(30, 60_000) // 30 req/min

async function gmgnFetch(path: string, opts?: RequestInit): Promise<Response> {
  await rateLimiter.wait()
  const url = path.startsWith('http') ? path : `${GMGN_API_BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'TradingBot/2.0',
      ...(opts?.headers || {}),
    },
  })
  if (res.status === 429) {
    // Rate limited — exponential backoff
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10) * 1000
    await new Promise(r => setTimeout(r, retryAfter))
    return gmgnFetch(path, opts)
  }
  return res
}

// ─── Token Intelligence ────────────────────────────────────────────────────

export async function getTokenInfo(mint: string): Promise<GmgnTokenInfo | null> {
  try {
    const res = await gmgnFetch(`/v1/solana/tokens/${mint}`)
    if (!res.ok) return null
    const json = await res.json()
    return json.data?.token || json.data || null
  } catch {
    return null
  }
}

export async function getTokenSecurity(mint: string): Promise<GmgnTokenSecurity | null> {
  try {
    const res = await gmgnFetch(`/v1/solana/tokens/${mint}/security`)
    if (!res.ok) return null
    const json = await res.json()
    return json.data?.security || json.data || null
  } catch {
    return null
  }
}

export async function getBatchTokenSecurity(mints: string[]): Promise<Map<string, GmgnTokenSecurity>> {
  const results = new Map<string, GmgnTokenSecurity>()
  // Process in batches of 5 to respect rate limits
  for (let i = 0; i < mints.length; i += 5) {
    const batch = mints.slice(i, i + 5)
    const promises = batch.map(async (mint) => {
      const sec = await getTokenSecurity(mint)
      if (sec) results.set(mint, sec)
    })
    await Promise.allSettled(promises)
  }
  return results
}

// ─── Smart Money Wallets ───────────────────────────────────────────────────

export async function getSmartMoneyWallets(period: '1h' | '6h' | '24h' | '7d' = '24h'): Promise<GmgnSmartMoneyWallet[]> {
  try {
    const res = await gmgnFetch(`/v1/solana/wallets/smart-money?period=${period}`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data?.wallets || json.data || []
  } catch {
    return []
  }
}

export async function getWalletTrades(address: string, limit = 20): Promise<Array<{
  signature: string
  tokenMint: string
  tokenSymbol: string
  side: 'buy' | 'sell'
  amount: number
  amountUsd: number
  timestamp: number
  pnlUsd?: number
}>> {
  try {
    const res = await gmgnFetch(`/v1/solana/wallets/${address}/trades?limit=${limit}`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data?.trades || json.data || []
  } catch {
    return []
  }
}

// ─── Swap via Jupiter (GMGN relay) ─────────────────────────────────────────

export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,        // In lamports for SOL, raw units for tokens
  slippageBps: number = 100,  // 1% default
): Promise<GmgnSwapQuote | null> {
  try {
    const res = await gmgnFetch(
      `/v1/solana/swap/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
    )
    if (!res.ok) return null
    const json = await res.json()
    return json.data?.quote || json.data || null
  } catch {
    return null
  }
}

export async function executeSwap(
  quote: GmgnSwapQuote,
  userPublicKey: string,
  priorityFeeLamports: number = 100_000,  // ~0.0001 SOL priority fee
): Promise<GmgnSwapResult | null> {
  try {
    const res = await gmgnFetch('/v1/solana/swap/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote,
        userPublicKey,
        priorityFeeLamports,
        computeUnitLimit: 200_000,
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data || null
  } catch {
    return null
  }
}

// ─── Trending Tokens ───────────────────────────────────────────────────────

export async function getTrendingTokens(period: '5m' | '1h' | '6h' | '24h' = '1h'): Promise<GmgnTokenInfo[]> {
  try {
    const res = await gmgnFetch(`/v1/solana/trending?period=${period}`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data?.tokens || json.data || []
  } catch {
    return []
  }
}

// ─── New Token Pairs ───────────────────────────────────────────────────────

export async function getNewPairs(limit = 20): Promise<Array<{
  pairAddress: string
  tokenMint: string
  tokenSymbol: string
  dex: string
  initialLiquidity: number
  createdAt: number
  creatorAddress: string
}>> {
  try {
    const res = await gmgnFetch(`/v1/solana/new-pairs?limit=${limit}`)
    if (!res.ok) return []
    const json = await res.json()
    return json.data?.pairs || json.data || []
  } catch {
    return []
  }
}

// ─── Safety Score Calculation ──────────────────────────────────────────────

export function calculateSafetyScore(sec: GmgnTokenSecurity, token: GmgnTokenInfo): {
  score: number       // 0-100
  verdict: 'SAFE' | 'CAUTION' | 'DANGER' | 'AVOID'
  reasons: string[]
} {
  let score = 50 // Start neutral
  const reasons: string[] = []

  // Hard blockers
  if (sec.isHoneypot) { score = 0; reasons.push('HONEYPOT: Cannot sell'); return { score, verdict: 'AVOID', reasons } }
  if (sec.isScam)     { score = 0; reasons.push('SCAM: Flagged as scam'); return { score, verdict: 'AVOID', reasons } }
  if (sec.sellTax > 30) { score = Math.max(0, score - 40); reasons.push(`HIGH SELL TAX: ${sec.sellTax}%`) }
  if (sec.buyTax > 10)  { score = Math.max(0, score - 20); reasons.push(`BUY TAX: ${sec.buyTax}%`) }

  // Mint/Freeze authority
  if (sec.canMint)   { score -= 15; reasons.push('MINT NOT RENOUNCED: Supply can be inflated') }
  if (sec.canFreeze) { score -= 15; reasons.push('FREEZE NOT RENOUNCED: Accounts can be frozen') }
  if (sec.isRenounced) { score += 10; reasons.push('CONTRACT RENOUNCED') }

  // Proxy contract
  if (sec.isProxy) { score -= 20; reasons.push('PROXY CONTRACT: Upgradeable, rules can change') }
  if (sec.isOpenSource) { score += 5; reasons.push('SOURCE VERIFIED') }

  // Concentration
  if (token.topHolderPct > 30) { score -= 15; reasons.push(`TOP HOLDERS: ${token.topHolderPct.toFixed(1)}% concentrated`) }
  if (token.topHolderPct < 15) { score += 5 }

  // Liquidity
  if (token.liquidity < 1000)  { score -= 20; reasons.push('LOW LIQUIDITY: < $1K') }
  if (token.liquidity < 5000)  { score -= 10; reasons.push('LOW LIQUIDITY: < $5K') }
  if (token.liquidity > 50000) { score += 10; reasons.push('GOOD LIQUIDITY') }
  if (token.liquidity > 100000){ score += 5 }

  // Age — very new tokens are risky
  const ageHours = (Date.now() - token.createdAt) / 3_600_000
  if (ageHours < 1)   { score -= 15; reasons.push('VERY NEW: < 1 hour old') }
  if (ageHours < 6)   { score -= 5; reasons.push('NEW: < 6 hours old') }
  if (ageHours > 24)  { score += 5 }

  // Holder count
  if (token.holderCount < 50)  { score -= 10; reasons.push(`FEW HOLDERS: ${token.holderCount}`) }
  if (token.holderCount > 500) { score += 5; reasons.push('GOOD HOLDER DISTRIBUTION') }

  // Clamp
  score = Math.max(0, Math.min(100, score))

  const verdict = score >= 70 ? 'SAFE' : score >= 45 ? 'CAUTION' : score >= 20 ? 'DANGER' : 'AVOID'

  return { score, verdict, reasons }
}

// ─── SOL constants ─────────────────────────────────────────────────────────

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const LAMPORTS_PER_SOL = 1_000_000_000
