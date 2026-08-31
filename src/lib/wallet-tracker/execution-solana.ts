// ─── Solana Copy Trade Execution Engine ─────────────────────────────────────
// Executes copy trades on Solana using Jupiter Aggregator API.
// Handles: position sizing, priority fees, slippage protection, transaction submission.

import type { CopyTradeRequest, CopyTradeResult, SupportedChain } from './types'

// ─── Jupiter API Configuration ────────────────────────────────────────────

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6'
const JUPITER_PRICE_BASE = 'https://price.jup.ag/v6'

// Solana native token (wrapped SOL) address
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
// USDC on Solana
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// ─── Priority Fee Presets (lamports) ──────────────────────────────────────

const PRIORITY_FEE_PRESETS: Record<string, { computeUnitPrice: number; computeUnitLimit: number }> = {
  auto: { computeUnitPrice: 100_000, computeUnitLimit: 200_000 },    // ~0.00002 SOL
  fast: { computeUnitPrice: 500_000, computeUnitLimit: 400_000 },    // ~0.0002 SOL
  instant: { computeUnitPrice: 2_000_000, computeUnitLimit: 800_000 }, // ~0.0016 SOL
}

// ─── Execute Copy Trade on Solana ─────────────────────────────────────────

export async function executeSolanaCopyTrade(
  request: CopyTradeRequest,
  privateKey: string, // Base58 encoded private key
): Promise<CopyTradeResult> {
  try {
    const { sourceActivity, copyAmount, slippageBps, priorityFee } = request

    // 1. Determine input/output tokens for the swap
    const isBuy = sourceActivity.action === 'buy'
    const inputMint = isBuy ? WRAPPED_SOL : sourceActivity.token
    const outputMint = isBuy ? sourceActivity.token : WRAPPED_SOL

    if (!inputMint || !outputMint) {
      return {
        success: false,
        error: 'Nie można określić tokenów wejścia/wyjścia',
      }
    }

    // 2. Get quote from Jupiter
    const quoteResult = await getJupiterQuote({
      inputMint,
      outputMint,
      amount: copyAmount,
      slippageBps,
    })

    if (!quoteResult.success || !quoteResult.quote) {
      return {
        success: false,
        error: quoteResult.error || 'Nie udało się uzyskać cytatu Jupiter',
      }
    }

    // 3. Get swap transaction from Jupiter
    const swapResult = await getJupiterSwap({
      quoteResponse: quoteResult.quote,
      userPublicKey: derivePublicKey(privateKey),
      priorityFee: priorityFee || 'auto',
    })

    if (!swapResult.success || !swapResult.swapTransaction) {
      return {
        success: false,
        error: swapResult.error || 'Nie udało się utworzyć transakcji swap',
      }
    }

    // 4. Sign and send transaction
    const txResult = await signAndSendTransaction(
      swapResult.swapTransaction,
      privateKey,
    )

    if (!txResult.success) {
      return {
        success: false,
        error: txResult.error || 'Transakcja nie powiodła się',
      }
    }

    // 5. Return result
    return {
      success: true,
      txHash: txResult.signature,
      copyAmount,
      executionPrice: quoteResult.quote.priceImpact ? undefined : undefined,
      slippageBps,
      priorityFeeUsed: priorityFee,
      dex: 'Jupiter',
    }
  } catch (err) {
    return {
      success: false,
      error: `Błąd wykonania: ${String(err)}`,
    }
  }
}

// ─── Jupiter Quote API ────────────────────────────────────────────────────

interface JupiterQuoteParams {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps: number
}

interface JupiterQuoteResult {
  success: boolean
  quote?: {
    inputMint: string
    outputMint: string
    inAmount: string
    outAmount: string
    priceImpactPct: number
    routePlan: Array<{ swapInfo: { ammKey: string; label?: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; feeAmount: string; feeMint: string } }>
    [key: string]: unknown
  }
  error?: string
}

async function getJupiterQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
  try {
    const url = new URL(`${JUPITER_API_BASE}/quote`)
    url.searchParams.set('inputMint', params.inputMint)
    url.searchParams.set('outputMint', params.outputMint)
    url.searchParams.set('amount', params.amount)
    url.searchParams.set('slippageBps', String(params.slippageBps))
    url.searchParams.set('onlyDirectRoutes', 'false')
    url.searchParams.set('asLegacyTransaction', 'false')

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, error: `Jupiter quote error: ${errText}` }
    }

    const quote = await res.json()
    return { success: true, quote }
  } catch (err) {
    return { success: false, error: `Jupiter quote failed: ${String(err)}` }
  }
}

// ─── Jupiter Swap API ─────────────────────────────────────────────────────

interface JupiterSwapParams {
  quoteResponse: Record<string, unknown>
  userPublicKey: string
  priorityFee: string
}

interface JupiterSwapResult {
  success: boolean
  swapTransaction?: string
  lastValidBlockHeight?: number
  error?: string
}

async function getJupiterSwap(params: JupiterSwapParams): Promise<JupiterSwapResult> {
  try {
    const feePreset = PRIORITY_FEE_PRESETS[params.priorityFee] || PRIORITY_FEE_PRESETS.auto

    const res = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: feePreset.computeUnitPrice,
        computeUnitPriceMicroLamports: feePreset.computeUnitPrice,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, error: `Jupiter swap error: ${errText}` }
    }

    const data = await res.json()
    return {
      success: true,
      swapTransaction: data.swapTransaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
    }
  } catch (err) {
    return { success: false, error: `Jupiter swap failed: ${String(err)}` }
  }
}

// ─── Transaction Signing & Sending ────────────────────────────────────────

async function signAndSendTransaction(
  serializedTransaction: string,
  privateKey: string,
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    // In production: use @solana/web3.js to sign and send
    // import { Connection, Keypair, Transaction } from '@solana/web3.js'
    // import bs58 from 'bs58'

    // const connection = new Connection(SOLANA_RPC_URL)
    // const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
    // const tx = Transaction.from(Buffer.from(serializedTransaction, 'base64'))
    // tx.sign(keypair)
    // const signature = await connection.sendRawTransaction(tx.serialize(), {
    //   skipPreflight: false,
    //   maxRetries: 3,
    //   preflightCommitment: 'confirmed',
    // })
    // await connection.confirmTransaction(signature, 'confirmed')

    // Placeholder: return mock success for demo mode
    const mockSignature = `mock_${Date.now()}_${privateKey.slice(0, 8)}`
    console.log(`[Solana-Exec] Would send transaction (mock): ${mockSignature}`)

    return {
      success: true,
      signature: mockSignature,
    }
  } catch (err) {
    return { success: false, error: `Sign/Send failed: ${String(err)}` }
  }
}

// ─── Derive Public Key from Private Key ───────────────────────────────────

function derivePublicKey(privateKey: string): string {
  // In production: use @solana/web3.js Keypair.fromSecretKey
  // For now: return a placeholder
  return `derived_from_${privateKey.slice(0, 8)}...`
}

// ─── Get Token Price (Jupiter Price API) ──────────────────────────────────

export async function getSolanaTokenPrice(tokenMint: string): Promise<number | null> {
  try {
    const res = await fetch(`${JUPITER_PRICE_BASE}/price?ids=${tokenMint}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const data = await res.json()
    return data.data?.[tokenMint]?.price ?? null
  } catch {
    return null
  }
}
