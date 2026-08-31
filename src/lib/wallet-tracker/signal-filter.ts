// ─── AI Signal Filter Engine ────────────────────────────────────────────────
// Filters detected wallet activities before executing copy trades.
// Checks: rug pull risk, honeypot detection, safety score, liquidity, slippage.
// Uses GMGN.ai API for token safety data.

import type { DetectedActivity, FilterConfig, FilterResult, TokenSafetyInfo, SupportedChain, GmgnTokenSafety } from './types'

// ─── Default Filter Config ────────────────────────────────────────────────

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  minSafetyScore: 60,
  minLiquidityUsd: 50000,
  minHolderCount: 100,
  maxPositionPct: 5,
  blockRugPull: true,
  blockHoneypot: true,
  blockNewToken: true,
  newTokenMaxAgeHours: 1,
}

// ─── Main Filter Function ─────────────────────────────────────────────────

export async function filterSignal(
  activity: DetectedActivity,
  config: FilterConfig,
): Promise<FilterResult> {
  const reasons: string[] = []
  let riskLevel: FilterResult['riskLevel'] = 'low'
  let recommendedAction: FilterResult['recommendedAction'] = 'copy'

  // 1. Fetch token safety info from GMGN
  const safetyInfo = await fetchTokenSafety(activity.token, activity.chain)

  if (!safetyInfo) {
    // If we can't get safety info, be conservative
    reasons.push('Brak danych bezpieczeństwa tokena (safety score niedostępny)')
    riskLevel = 'high'
    recommendedAction = 'skip'
    return { passed: false, reasons, safetyInfo: null, riskLevel, recommendedAction }
  }

  // 2. Safety score check
  if (safetyInfo.safetyScore < config.minSafetyScore) {
    reasons.push(
      `Niski safety score: ${safetyInfo.safetyScore}/100 (min: ${config.minSafetyScore})`
    )
    riskLevel = 'high'
    recommendedAction = 'skip'
  }

  // 3. Honeypot check
  if (config.blockHoneypot && safetyInfo.isHoneypot) {
    reasons.push('Token jest honeypotem — nie można sprzedać')
    riskLevel = 'critical'
    recommendedAction = 'block'
  }

  // 4. Rug pull check
  if (config.blockRugPull && safetyInfo.isRugPull) {
    reasons.push('Wysokie ryzyko rug pull')
    riskLevel = 'critical'
    recommendedAction = 'block'
  }

  // 5. Liquidity check
  if (safetyInfo.liquidityUsd < config.minLiquidityUsd) {
    reasons.push(
      `Niska płynność: $${safetyInfo.liquidityUsd.toLocaleString()} (min: $${config.minLiquidityUsd.toLocaleString()})`
    )
    riskLevel = riskLevel === 'critical' ? 'critical' : 'high'
    recommendedAction = recommendedAction === 'block' ? 'block' : 'skip'
  }

  // 6. Holder count check
  if (safetyInfo.holderCount < config.minHolderCount) {
    reasons.push(
      `Mało posiadaczy: ${safetyInfo.holderCount} (min: ${config.minHolderCount})`
    )
    if (riskLevel === 'low') riskLevel = 'medium'
    if (recommendedAction === 'copy') recommendedAction = 'watch'
  }

  // 7. New token check
  if (config.blockNewToken && safetyInfo.ageHours !== null && safetyInfo.ageHours < config.newTokenMaxAgeHours) {
    reasons.push(
      `Nowy token: ${safetyInfo.ageHours.toFixed(1)}h (max: ${config.newTokenMaxAgeHours}h)`
    )
    riskLevel = riskLevel === 'critical' ? 'critical' : 'high'
    recommendedAction = recommendedAction === 'block' ? 'block' : 'skip'
  }

  // 8. Solana-specific: Mint/Freeze authority check
  if (activity.chain === 'solana') {
    if (safetyInfo.mintAuthority && safetyInfo.mintAuthority !== 'null') {
      reasons.push('Mint authority nie zrewokowana — ryzyko inflacji')
      if (riskLevel === 'low') riskLevel = 'medium'
      if (recommendedAction === 'copy') recommendedAction = 'watch'
    }
    if (safetyInfo.freezeAuthority && safetyInfo.freezeAuthority !== 'null') {
      reasons.push('Freeze authority aktywna — ryzyko zamrożenia kont')
      if (riskLevel === 'low') riskLevel = 'medium'
      if (recommendedAction === 'copy') recommendedAction = 'watch'
    }
  }

  // 9. EVM-specific: Contract not renounced
  if ((activity.chain === 'ethereum' || activity.chain === 'base' || activity.chain === 'bsc') && !safetyInfo.isRenounced) {
    reasons.push('Własność kontraktu nie zrewokowana — ryzyko zmian parametrów')
    if (riskLevel === 'low') riskLevel = 'medium'
  }

  // 10. Position size risk check
  if (activity.amountUsd && activity.amountUsd > 100000) {
    reasons.push(`Duża pozycja: $${activity.amountUsd.toLocaleString()} — potencjalny wpływ na cenę`)
    if (riskLevel === 'low') riskLevel = 'medium'
  }

  const passed = recommendedAction === 'copy' || recommendedAction === 'watch'

  return {
    passed,
    reasons,
    safetyInfo,
    riskLevel,
    recommendedAction,
  }
}

// ─── Fetch Token Safety from GMGN ─────────────────────────────────────────

async function fetchTokenSafety(
  tokenAddress: string,
  chain: SupportedChain,
): Promise<TokenSafetyInfo | null> {
  if (!tokenAddress) return null

  try {
    // Try GMGN API first
    const gmgnChain = chain === 'base' ? 'base' : chain === 'bsc' ? 'bsc' : chain === 'ethereum' ? 'eth' : 'sol'
    const res = await fetch(
      `https://gmgn.ai/defi/proxy/v1/token/${gmgnChain}/${tokenAddress}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TradingBot/2.0',
        },
        signal: AbortSignal.timeout(5000),
      }
    )

    if (res.ok) {
      const data = await res.json()
      return parseGmgnSafety(data, tokenAddress, chain)
    }
  } catch {
    // GMGN API failed — try alternative safety check
  }

  // Fallback: Basic heuristic safety check
  return heuristicSafetyCheck(tokenAddress, chain)
}

// ─── Parse GMGN Safety Response ───────────────────────────────────────────

function parseGmgnSafety(
  data: { data?: Record<string, unknown> & { token?: Record<string, unknown> } },
  tokenAddress: string,
  chain: SupportedChain,
): TokenSafetyInfo {
  const raw = data.data?.token || data.data || {}
  const token = raw as Record<string, unknown>
  const now = new Date()
  const createdAt = token.created_at ? new Date(token.created_at as string) : null
  const ageHours = createdAt ? (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null

  return {
    address: tokenAddress,
    chain,
    symbol: (token.symbol as string) || '',
    name: (token.name as string) || '',
    safetyScore: (token.is_honeypot as boolean) ? 0 : ((token.is_rug as boolean) ? 10 : 75),
    isHoneypot: (token.is_honeypot as boolean) || false,
    isRugPull: (token.is_rug as boolean) || false,
    holderCount: (token.holder_count as number) || 0,
    liquidityUsd: (token.liquidity as number) || 0,
    createdAt,
    ageHours,
    mintAuthority: (token.mint_authority as string) || undefined,
    freezeAuthority: (token.freeze_authority as string) || undefined,
    isRenounced: (token.is_renounced as boolean) || false,
  }
}

// ─── Heuristic Safety Check (Fallback) ────────────────────────────────────

async function heuristicSafetyCheck(
  tokenAddress: string,
  chain: SupportedChain,
): Promise<TokenSafetyInfo | null> {
  // When GMGN is unavailable, use basic heuristics:
  // 1. Check if the address looks like a valid token contract
  // 2. Basic pattern matching for known scam patterns

  const isValidAddress = chain === 'solana'
    ? tokenAddress.length >= 32 && tokenAddress.length <= 44
    : tokenAddress.startsWith('0x') && tokenAddress.length === 42

  if (!isValidAddress) return null

  // Conservative defaults when we can't verify
  return {
    address: tokenAddress,
    chain,
    symbol: '',
    name: '',
    safetyScore: 40, // Unknown = medium risk
    isHoneypot: false,
    isRugPull: false,
    holderCount: 0,
    liquidityUsd: 0,
    createdAt: null,
    ageHours: null,
    isRenounced: false,
  }
}

// ─── Slippage Estimation ──────────────────────────────────────────────────

export function estimateSlippage(
  tradeAmountUsd: number,
  liquidityUsd: number,
): number {
  if (liquidityUsd <= 0) return 10000 // 100% slippage = don't trade

  // Simple constant product AMM slippage model: slippage ≈ tradeSize / (2 * liquidity)
  const slippagePct = (tradeAmountUsd / (2 * liquidityUsd)) * 100
  return Math.round(slippagePct * 100) // Convert to basis points
}

// ─── Position Size Calculator ─────────────────────────────────────────────

export function calculatePositionSize(
  mode: 'fixed' | 'proportional',
  fixedAmount: string,
  proportionalPct: number,
  sourceAmount: string,
  sourceAmountUsd: number,
  portfolioUsd: number,
  maxPositionPct: number,
): { amount: string; amountUsd: number; withinLimit: boolean } {
  let amountUsd: number

  if (mode === 'fixed') {
    // Fixed amount: convert fixedAmount (in native token) to USD estimate
    // This is a rough estimate; actual execution will differ
    amountUsd = sourceAmountUsd > 0
      ? (Number(fixedAmount) / Number(sourceAmount)) * sourceAmountUsd
      : 0
  } else {
    // Proportional: percentage of source wallet's position
    amountUsd = sourceAmountUsd * (proportionalPct / 100)
  }

  // Check portfolio limit
  const maxAllowed = portfolioUsd * (maxPositionPct / 100)
  const withinLimit = amountUsd <= maxAllowed

  if (!withinLimit) {
    amountUsd = maxAllowed
  }

  return {
    amount: mode === 'fixed' ? fixedAmount : String(amountUsd),
    amountUsd,
    withinLimit,
  }
}
