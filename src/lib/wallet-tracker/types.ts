// ─── Wallet Tracker: Shared Types ──────────────────────────────────────────
// Single source of truth for all Wallet Tracker & Copy Trader types.

// ─── Chain types ────────────────────────────────────────────────────────────

export const SUPPORTED_CHAINS = ['solana', 'ethereum', 'base', 'bsc'] as const
export type SupportedChain = typeof SUPPORTED_CHAINS[number]

export const CHAIN_RPC: Record<SupportedChain, { ws: string; http: string; symbol: string; icon: string }> = {
  solana: {
    ws: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    http: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    symbol: 'SOL',
    icon: '◎',
  },
  ethereum: {
    ws: process.env.ETHEREUM_WS_URL || 'wss://eth-mainnet.g.alchemy.com/v2/demo',
    http: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    symbol: 'ETH',
    icon: 'Ξ',
  },
  base: {
    ws: process.env.BASE_WS_URL || 'wss://base-mainnet.g.alchemy.com/v2/demo',
    http: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    symbol: 'ETH',
    icon: '🔵',
  },
  bsc: {
    ws: process.env.BSC_WS_URL || 'wss://bsc-ws-node.nariox.org:443',
    http: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    symbol: 'BNB',
    icon: '◆',
  },
}

// ─── Detected Activity ──────────────────────────────────────────────────────

export interface DetectedActivity {
  walletAddress: string
  chain: SupportedChain
  txHash: string
  action: 'buy' | 'sell' | 'transfer'
  token: string           // Token contract/mint address
  tokenSymbol?: string
  amount: string           // Raw amount as string
  amountUsd?: number
  dex?: string
  blockNumber?: string
  slot?: number
  timestamp: Date
  logLevel: 'info' | 'warning' | 'critical'
}

// ─── Signal Filter ──────────────────────────────────────────────────────────

export interface TokenSafetyInfo {
  address: string
  chain: SupportedChain
  symbol: string
  name: string
  safetyScore: number      // 0-100 from GMGN
  isHoneypot: boolean
  isRugPull: boolean
  holderCount: number
  liquidityUsd: number
  createdAt: Date | null
  ageHours: number | null
  mintAuthority?: string   // Solana
  freezeAuthority?: string // Solana
  isRenounced: boolean
}

export interface FilterResult {
  passed: boolean
  reasons: string[]
  safetyInfo: TokenSafetyInfo | null
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  recommendedAction: 'copy' | 'skip' | 'watch' | 'block'
}

export interface FilterConfig {
  minSafetyScore: number
  minLiquidityUsd: number
  minHolderCount: number
  maxPositionPct: number
  blockRugPull: boolean
  blockHoneypot: boolean
  blockNewToken: boolean
  newTokenMaxAgeHours: number
}

// ─── Copy Trade ─────────────────────────────────────────────────────────────

export interface CopyTradeRequest {
  trackedWalletId: string
  sourceActivity: DetectedActivity
  copyAmount: string        // Amount to trade
  copyAmountUsd: number
  slippageBps: number
  priorityFee: 'auto' | 'fast' | 'instant'
  mevProtection: boolean
}

export interface CopyTradeResult {
  success: boolean
  txHash?: string
  copyAmount?: string
  executionPrice?: number
  slippageBps?: number
  priorityFeeUsed?: string
  gasUsed?: string
  mevProtected?: boolean
  error?: string
  dex?: string
}

export interface PositionSizeConfig {
  mode: 'fixed' | 'proportional'
  fixedAmount: string       // e.g. "0.1" SOL
  proportionalPct: number   // e.g. 10 = 10% of source wallet position
  maxPositionPct: number    // Max % of our portfolio
}

// ─── Tracking Worker ────────────────────────────────────────────────────────

export interface TrackingWorkerConfig {
  chain: SupportedChain
  walletAddresses: string[]
  wsUrl: string
  httpUrl: string
  reconnectIntervalMs: number
  maxReconnectAttempts: number
  pollIntervalMs: number     // Fallback polling interval
}

export interface TrackingWorkerStatus {
  chain: SupportedChain
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  walletsTracked: number
  lastActivityAt: Date | null
  reconnectAttempts: number
  uptime: number             // seconds
  eventsProcessed: number
  errors: string[]
  startedAt: Date | null
}

// ─── GMGN API ───────────────────────────────────────────────────────────────

export interface GmgnWalletProfile {
  address: string
  chain: string
  smartMoneyScore: number
  pnl24h: number
  pnl7d: number
  winRate: number
  totalTrades: number
  tags: string[]
  recentTrades: GmgnRecentTrade[]
}

export interface GmgnRecentTrade {
  txHash: string
  action: 'buy' | 'sell'
  token: string
  tokenSymbol: string
  amount: string
  amountUsd: number
  dex: string
  timestamp: string
}

export interface GmgnTokenSafety {
  address: string
  chain: string
  symbol: string
  name: string
  safetyScore: number
  isHoneypot: boolean
  isRugPull: boolean
  holderCount: number
  liquidityUsd: number
  createdAt: string | null
  mintAuthority: string | null
  freezeAuthority: string | null
  isRenounced: boolean
}

export interface GmgnSmartMoneyResult {
  wallets: Array<{
    address: string
    chain: string
    label: string
    smartMoneyScore: number
    pnl7d: number
    winRate: number
    tags: string[]
  }>
  total: number
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface WalletTrackerStatus {
  workers: Record<SupportedChain, TrackingWorkerStatus | null>
  totalWallets: number
  activeWallets: number
  totalCopiedTrades: number
  totalCopiedPnl: number
  recentActivity: DetectedActivity[]
}

export interface AddWalletRequest {
  address: string
  chain: SupportedChain
  label?: string
  tags?: string[]
  copyTradeEnabled?: boolean
  copyTradeAmount?: string
  copyTradeMode?: 'fixed' | 'proportional'
  copyTradePct?: number
  minSafetyScore?: number
  minLiquidityUsd?: number
  blockRugPull?: boolean
  blockHoneypot?: boolean
}

export interface UpdateWalletRequest {
  label?: string
  tags?: string[]
  isActive?: boolean
  copyTradeEnabled?: boolean
  copyTradeAmount?: string
  copyTradeMode?: 'fixed' | 'proportional'
  copyTradePct?: number
  minSafetyScore?: number
  minLiquidityUsd?: number
  blockRugPull?: boolean
  blockHoneypot?: boolean
  status?: string
}
