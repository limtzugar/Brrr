// ─── EVM Copy Trade Execution Engine ────────────────────────────────────────
// Executes copy trades on EVM chains (Ethereum, Base, BSC).
// Uses 1inch Aggregator API for swaps and Flashbots for MEV protection.

import type { CopyTradeRequest, CopyTradeResult, SupportedChain } from './types'
import { CHAIN_RPC } from './types'

// ─── 1inch API Configuration ──────────────────────────────────────────────

const INCH_API_BASE = 'https://api.1inch.dev/swap/v6.0'
const INCH_API_KEY = process.env.INCH_API_KEY || ''

// Chain ID mapping for 1inch
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
}

// Native token addresses
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'

// ─── Flashbots Configuration ──────────────────────────────────────────────

const FLASHBOTS_RELAY = 'https://relay.flashbots.net'
const FLASHBOTS_PROTECT_RPC = 'https://rpc.flashbots.net'

// ─── Execute Copy Trade on EVM ────────────────────────────────────────────

export async function executeEvmCopyTrade(
  request: CopyTradeRequest,
  walletPrivateKey: string, // Hex encoded private key
): Promise<CopyTradeResult> {
  try {
    const { sourceActivity, copyAmount, slippageBps, mevProtection } = request
    const chain = sourceActivity.chain as SupportedChain
    const chainId = CHAIN_IDS[chain]

    if (!chainId) {
      return { success: false, error: `Unsupported chain: ${chain}` }
    }

    // 1. Determine input/output tokens
    const isBuy = sourceActivity.action === 'buy'
    const srcToken = sourceActivity.token || NATIVE_TOKEN
    const inputToken = isBuy ? NATIVE_TOKEN : srcToken
    const outputToken = isBuy ? srcToken : NATIVE_TOKEN

    // 2. Get quote from 1inch
    const quoteResult = await get1inchQuote({
      chainId,
      src: inputToken,
      dst: outputToken,
      amount: copyAmount,
    })

    if (!quoteResult.success || !quoteResult.data) {
      return {
        success: false,
        error: quoteResult.error || '1inch quote failed',
      }
    }

    // 3. Build swap transaction via 1inch
    const walletAddress = deriveEvmAddress(walletPrivateKey)

    const swapResult = await get1inchSwap({
      chainId,
      src: inputToken,
      dst: outputToken,
      amount: copyAmount,
      from: walletAddress,
      slippage: Math.floor(slippageBps / 100), // Convert bps to percentage
    })

    if (!swapResult.success || !swapResult.data) {
      return {
        success: false,
        error: swapResult.error || '1inch swap build failed',
      }
    }

    // 4. Sign and send transaction
    let txHash: string | undefined

    if (mevProtection && chain === 'ethereum') {
      // Use Flashbots Protect for MEV protection
      txHash = await sendViaFlashbots(swapResult.data, walletPrivateKey, chain)
    } else {
      // Standard submission
      txHash = await sendEvmTransaction(swapResult.data, walletPrivateKey, chain)
    }

    if (!txHash) {
      return {
        success: false,
        error: 'Transaction was not sent',
      }
    }

    return {
      success: true,
      txHash,
      copyAmount,
      slippageBps,
      dex: '1inch',
      mevProtected: mevProtection && chain === 'ethereum',
    }
  } catch (err) {
    return {
      success: false,
      error: `Error wykonania EVM: ${String(err)}`,
    }
  }
}

// ─── 1inch Quote API ──────────────────────────────────────────────────────

interface InchQuoteParams {
  chainId: number
  src: string
  dst: string
  amount: string
}

interface InchQuoteResult {
  success: boolean
  data?: {
    srcAmount: string
    dstAmount: string
    srcUsd: number
    dstUsd: number
    priceImpact: number
    [key: string]: unknown
  }
  error?: string
}

async function get1inchQuote(params: InchQuoteParams): Promise<InchQuoteResult> {
  try {
    const url = `${INCH_API_BASE}/${params.chainId}/quote?src=${params.src}&dst=${params.dst}&amount=${params.amount}`

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    }
    if (INCH_API_KEY) {
      headers['Authorization'] = `Bearer ${INCH_API_KEY}`
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, error: `1inch quote error: ${errText}` }
    }

    const data = await res.json()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: `1inch quote failed: ${String(err)}` }
  }
}

// ─── 1inch Swap API ───────────────────────────────────────────────────────

interface InchSwapParams {
  chainId: number
  src: string
  dst: string
  amount: string
  from: string
  slippage: number
}

interface InchSwapResult {
  success: boolean
  data?: {
    tx: {
      from: string
      to: string
      data: string
      value: string
      gas: number
      gasPrice: string
    }
    [key: string]: unknown
  }
  error?: string
}

async function get1inchSwap(params: InchSwapParams): Promise<InchSwapResult> {
  try {
    const url = `${INCH_API_BASE}/${params.chainId}/swap?src=${params.src}&dst=${params.dst}&amount=${params.amount}&from=${params.from}&slippage=${params.slippage}`

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    }
    if (INCH_API_KEY) {
      headers['Authorization'] = `Bearer ${INCH_API_KEY}`
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, error: `1inch swap error: ${errText}` }
    }

    const data = await res.json()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: `1inch swap failed: ${String(err)}` }
  }
}

// ─── Send EVM Transaction ─────────────────────────────────────────────────

async function sendEvmTransaction(
  swapData: InchSwapResult['data'],
  privateKey: string,
  chain: string,
): Promise<string | undefined> {
  if (!swapData?.tx) return undefined

  try {
    // In production: use ethers.js to sign and send
    // import { ethers } from 'ethers'
    // const provider = new ethers.JsonRpcProvider(CHAIN_RPC[chain].http)
    // const wallet = new ethers.Wallet(privateKey, provider)
    // const tx = await wallet.sendTransaction({
    //   to: swapData.tx.to,
    //   data: swapData.tx.data,
    //   value: swapData.tx.value,
    //   gasLimit: swapData.tx.gas,
    //   gasPrice: swapData.tx.gasPrice,
    // })
    // await tx.wait()
    // return tx.hash

    // Placeholder for demo
    const mockHash = `0x${Date.now().toString(16)}${privateKey.slice(0, 8)}`
    console.log(`[EVM-Exec] Would send transaction (mock): ${mockHash}`)
    return mockHash
  } catch (err) {
    console.error(`[EVM-Exec] Transaction failed:`, err)
    return undefined
  }
}

// ─── Send via Flashbots (MEV Protection) ──────────────────────────────────

async function sendViaFlashbots(
  swapData: InchSwapResult['data'],
  privateKey: string,
  chain: string,
): Promise<string | undefined> {
  if (!swapData?.tx) return undefined

  try {
    // In production: use Flashbots Protect RPC or Builder API
    // import { ethers } from 'ethers'
    // const flashbotsProvider = new ethers.JsonRpcProvider(FLASHBOTS_PROTECT_RPC)
    // const wallet = new ethers.Wallet(privateKey, flashbotsProvider)
    // const tx = await wallet.sendTransaction({
    //   to: swapData.tx.to,
    //   data: swapData.tx.data,
    //   value: swapData.tx.value,
    //   gasLimit: swapData.tx.gas,
    //   maxFeePerGas: swapData.tx.gasPrice,
    //   maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    //   type: 2,
    // })
    // await tx.wait()
    // return tx.hash

    // Placeholder for demo
    const mockHash = `0xfb_${Date.now().toString(16)}`
    console.log(`[EVM-Exec] Would send via Flashbots (mock): ${mockHash}`)
    return mockHash
  } catch (err) {
    console.error(`[EVM-Exec] Flashbots submission failed:`, err)
    // Fallback to standard submission
    return sendEvmTransaction(swapData, privateKey, chain)
  }
}

// ─── Derive EVM Address from Private Key ──────────────────────────────────

function deriveEvmAddress(privateKey: string): string {
  // In production: use ethers.utils.computeAddress(privateKey)
  return `0x${privateKey.slice(-40)}`
}

// ─── Get Token Price (1inch) ──────────────────────────────────────────────

export async function getEvmTokenPrice(
  tokenAddress: string,
  chain: SupportedChain,
): Promise<number | null> {
  try {
    const chainId = CHAIN_IDS[chain]
    if (!chainId) return null

    const url = `${INCH_API_BASE}/${chainId}/token-price?address=${tokenAddress}`
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (INCH_API_KEY) headers['Authorization'] = `Bearer ${INCH_API_KEY}`

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const data = await res.json()
    return data[tokenAddress]?.price ?? null
  } catch {
    return null
  }
}
