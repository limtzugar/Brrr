// ─── Transfer API Route ───────────────────────────────────────────────────
// Handles crypto transfer/withdrawal requests.
// For now, validates the request and returns a mock success response.

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

// ─── Validation ─────────────────────────────────────────────────────────────

const VALID_EXCHANGES = ['bybit', 'mexc', 'binance', 'phantom'] as const
const VALID_ASSETS = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'DOGE'] as const
const VALID_NETWORKS = ['bitcoin', 'ethereum', 'arbitrum', 'optimism', 'solana', 'tron', 'bsc', 'xrp', 'dogecoin'] as const

const NETWORK_ASSET_MAP: Record<string, string[]> = {
  bitcoin: ['BTC'],
  ethereum: ['ETH', 'USDT', 'USDC'],
  arbitrum: ['ETH'],
  optimism: ['ETH'],
  solana: ['SOL', 'USDT', 'USDC'],
  tron: ['USDT'],
  bsc: ['USDT', 'USDC', 'BNB'],
  xrp: ['XRP'],
  dogecoin: ['DOGE'],
}

// Simple address validation patterns (basic format check, not full validation)
const ADDRESS_PATTERNS: Record<string, RegExp> = {
  bitcoin: /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,62})$/,
  ethereum: /^0x[a-fA-F0-9]{40}$/,
  arbitrum: /^0x[a-fA-F0-9]{40}$/,
  optimism: /^0x[a-fA-F0-9]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tron: /^T[A-Za-z1-9]{33}$/,
  bsc: /^0x[a-fA-F0-9]{40}$/,
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  dogecoin: /^D[A-Za-z0-9]{25,34}$/,
}

interface TransferRequest {
  from: string
  to: string
  asset: string
  amount: string
  network: string
  address: string
  memo?: string
}

function validateTransferRequest(body: TransferRequest): { valid: boolean; error?: string } {
  // Check required fields
  if (!body.from || !body.to || !body.asset || !body.amount || !body.network || !body.address) {
    return { valid: false, error: 'Missing required fields' }
  }

  // Validate source and destination
  if (!VALID_EXCHANGES.includes(body.from as any)) {
    return { valid: false, error: `Invalid source: ${body.from}` }
  }
  if (!VALID_EXCHANGES.includes(body.to as any)) {
    return { valid: false, error: `Invalid destination: ${body.to}` }
  }
  if (body.from === body.to) {
    return { valid: false, error: 'Source and destination cannot be the same' }
  }

  // Validate asset
  if (!VALID_ASSETS.includes(body.asset as any)) {
    return { valid: false, error: `Invalid asset: ${body.asset}` }
  }

  // Validate amount
  const amount = Number(body.amount)
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Amount must be a positive number' }
  }
  if (amount > 1e9) {
    return { valid: false, error: 'Amount exceeds maximum limit' }
  }

  // Validate network
  if (!VALID_NETWORKS.includes(body.network as any)) {
    return { valid: false, error: `Invalid network: ${body.network}` }
  }

  // Validate asset-network compatibility
  const allowedAssets = NETWORK_ASSET_MAP[body.network]
  if (allowedAssets && !allowedAssets.includes(body.asset)) {
    return { valid: false, error: `${body.asset} is not supported on ${body.network} network` }
  }

  // Validate address format (basic check)
  const pattern = ADDRESS_PATTERNS[body.network]
  if (pattern && !pattern.test(body.address)) {
    return { valid: false, error: `Invalid ${body.network} address format` }
  }

  // Address length sanity check
  if (body.address.length < 20 || body.address.length > 120) {
    return { valid: false, error: 'Address length is invalid' }
  }

  return { valid: true }
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
  const rateLimit = await checkRateLimitAsync(ip, 10, 60000) // 10 requests per minute
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429 }
    )
  }

  try {
    const body: TransferRequest = await request.json()

    // Validate request
    const validation = validateTransferRequest(body)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // Mock transfer processing
    // In production, this would:
    // 1. Check actual balance on source exchange
    // 2. Initiate withdrawal via exchange API
    // 3. Track transaction status
    // 4. Notify user of progress

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const mockTxHash = `${body.network.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}…${Math.random().toString(36).slice(2, 6)}`

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500))

    return NextResponse.json({
      success: true,
      message: `Transfer of ${body.amount} ${body.asset} initiated from ${body.from.toUpperCase()} to ${body.to.toUpperCase()}`,
      transfer: {
        id: txId,
        from: body.from,
        to: body.to,
        asset: body.asset,
        amount: body.amount,
        network: body.network,
        address: body.address,
        memo: body.memo || null,
        status: 'pending',
        txHash: mockTxHash,
        createdAt: new Date().toISOString(),
        estimatedConfirmationTime: body.network === 'solana' ? '~30s' : body.network === 'tron' ? '~1min' : body.network === 'bitcoin' ? '~30min' : '~5min',
      },
    })
  } catch (error) {
    console.error('[Transfer API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
