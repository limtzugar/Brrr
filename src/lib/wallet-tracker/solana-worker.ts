// ─── Solana Tracking Worker ─────────────────────────────────────────────────
// Monitors Solana wallets via WebSocket logsSubscribe.
// Searches for transaction signatures involving tracked addresses.
// Uses Solana's built-in WebSocket API (no Geyser Plugin dependency).

import type { DetectedActivity, SupportedChain, TrackingWorkerConfig, TrackingWorkerStatus } from './types'

// ─── SPL Token Program IDs ────────────────────────────────────────────────
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

// Known DEX program IDs for swap detection
const DEX_PROGRAMS: Record<string, string> = {
  raydium_amm: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  raydium_clmm: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  orca_whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  jupiter_aggregator: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  jupiter_route: 'JUP6LkbZbjS1jKKvapdHNW74H1o4wjn9YWvywdY6uMx',
  pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  meteora: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
}

// ─── Worker Registry ──────────────────────────────────────────────────────

interface ActiveSolanaWorker {
  config: TrackingWorkerConfig
  ws: WebSocket | null
  status: TrackingWorkerStatus
  intervalId: NodeJS.Timeout | null
  onActivity: (activity: DetectedActivity) => void
  processedSignatures: Set<string>  // Dedup cache
  lastSlot: number
}

const solanaWorkers: Map<string, ActiveSolanaWorker> = new Map()

// ─── Start Solana Tracking Worker ─────────────────────────────────────────

export function startSolanaWorker(
  config: TrackingWorkerConfig,
  onActivity: (activity: DetectedActivity) => void,
): string {
  const workerId = `solana-${config.chain}-${Date.now()}`

  const worker: ActiveSolanaWorker = {
    config,
    ws: null,
    status: {
      chain: 'solana' as SupportedChain,
      status: 'disconnected',
      walletsTracked: config.walletAddresses.length,
      lastActivityAt: null,
      reconnectAttempts: 0,
      uptime: 0,
      eventsProcessed: 0,
      errors: [],
      startedAt: null,
    },
    intervalId: null,
    onActivity,
    processedSignatures: new Set(),
    lastSlot: 0,
  }

  solanaWorkers.set(workerId, worker)

  try {
    connectSolanaWebSocket(workerId)
  } catch (err) {
    console.error('[Solana-Worker] WebSocket connect failed:', err)
    worker.status.status = 'error'
    worker.status.errors.push(String(err))
    startSolanaPolling(workerId)
  }

  return workerId
}

// ─── Stop Solana Tracking Worker ──────────────────────────────────────────

export function stopSolanaWorker(workerId: string): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return

  if (worker.ws) {
    try { worker.ws.close() } catch {}
    worker.ws = null
  }

  if (worker.intervalId) {
    clearInterval(worker.intervalId)
    worker.intervalId = null
  }

  worker.status.status = 'disconnected'
  solanaWorkers.delete(workerId)
}

// ─── Get Worker Status ────────────────────────────────────────────────────

export function getSolanaWorkerStatus(workerId: string): TrackingWorkerStatus | null {
  return solanaWorkers.get(workerId)?.status ?? null
}

export function getAllSolanaWorkerStatuses(): TrackingWorkerStatus[] {
  return Array.from(solanaWorkers.values()).map(w => w.status)
}

// ─── WebSocket Connection ─────────────────────────────────────────────────

function connectSolanaWebSocket(workerId: string): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return

  const { config, status } = worker
  status.status = 'connecting'
  status.startedAt = new Date()

  const ws = new WebSocket(config.wsUrl)
  worker.ws = ws

  ws.onopen = () => {
    console.log('[Solana-Worker] Connected to Solana WebSocket')
    status.status = 'connected'
    status.reconnectAttempts = 0
    status.errors = []

    // Subscribe to logs for each tracked wallet address
    for (const address of config.walletAddresses) {
      subscribeWalletLogs(ws, address, workerId)
    }

    // Also subscribe to DEX program logs for broader coverage
    for (const [dexName, programId] of Object.entries(DEX_PROGRAMS)) {
      subscribeDexLogs(ws, programId, dexName, workerId)
    }
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string)
      handleSolanaMessage(data, workerId)
    } catch (err) {
      console.error('[Solana-Worker] Parse error:', err)
    }
  }

  ws.onerror = (err) => {
    console.error('[Solana-Worker] WebSocket error:', err)
    status.status = 'error'
    status.errors.push(`WebSocket error: ${String(err)}`)
  }

  ws.onclose = () => {
    console.log('[Solana-Worker] WebSocket closed')
    status.status = 'disconnected'
    attemptSolanaReconnect(workerId)
  }
}

// ─── WebSocket Subscriptions ──────────────────────────────────────────────

function subscribeWalletLogs(ws: WebSocket, address: string, workerId: string): void {
  // logsSubscribe — filters for transactions that mention this address
  const msg = {
    jsonrpc: '2.0',
    id: `sub-logs-${address.slice(0, 8)}`,
    method: 'logsSubscribe',
    params: [
      {
        mentions: [address],  // All transactions that mention this address
      },
      {
        commitment: 'confirmed',
      },
    ],
  }
  ws.send(JSON.stringify(msg))
}

function subscribeDexLogs(ws: WebSocket, programId: string, dexName: string, workerId: string): void {
  // Subscribe to DEX program logs for swap detection
  const msg = {
    jsonrpc: '2.0',
    id: `sub-dex-${dexName}-${programId.slice(0, 8)}`,
    method: 'logsSubscribe',
    params: [
      {
        mentions: [programId],
      },
      {
        commitment: 'confirmed',
      },
    ],
  }
  ws.send(JSON.stringify(msg))
}

// ─── Handle Solana Messages ───────────────────────────────────────────────

interface SolanaWsNotification {
  id?: string
  method?: string
  params?: Array<{ result?: { signature?: string; slot?: number; err?: unknown; logs?: string[] }; subscription?: number }>
  error?: { message: string }
}

function handleSolanaMessage(data: SolanaWsNotification, workerId: string): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return
  // Handle subscription confirmation
  if (data.id && !data.method) {
    if ('error' in data && data.error) {
      console.error(`[Solana-Worker] Subscription error:`, data.error)
      worker.status.errors.push(data.error.message)
    }
    return
  }

  // Handle notification
  if (data.method === 'logsNotification' && data.params?.[0]) {
    const result = data.params[0].result
    if (!result) return

    const { signature, slot, err, logs } = result
    if (!signature) return

    // Skip failed transactions
    if (err) return

    // Dedup
    if (worker.processedSignatures.has(signature)) return
    worker.processedSignatures.add(signature)

    // Keep dedup cache manageable
    if (worker.processedSignatures.size > 10000) {
      const entries = Array.from(worker.processedSignatures)
      worker.processedSignatures = new Set(entries.slice(-5000))
    }

    // Update slot tracking
    if (slot && slot > worker.lastSlot) {
      worker.lastSlot = slot
    }

    // Detect swap activity from logs
    const activity = detectSolanaSwap(signature, slot || 0, logs || [], worker)
    if (activity) {
      worker.onActivity(activity)
      worker.status.lastActivityAt = new Date()
    }

    worker.status.eventsProcessed++
  }
}

// ─── Detect Solana Swaps from Transaction Logs ────────────────────────────

function detectSolanaSwap(
  signature: string,
  slot: number,
  logs: string[],
  worker: ActiveSolanaWorker,
): DetectedActivity | null {
  // Detect which DEX was used from program invocation logs
  let detectedDex: string | undefined
  for (const [dexName, programId] of Object.entries(DEX_PROGRAMS)) {
    if (logs.some(log => log.includes(programId))) {
      detectedDex = dexName
      break
    }
  }

  // Check if any tracked wallet is involved
  let matchedWallet = ''
  for (const addr of worker.config.walletAddresses) {
    if (logs.some(log => log.includes(addr))) {
      matchedWallet = addr
      break
    }
  }

  if (!matchedWallet && !detectedDex) return null

  // Detect action from log patterns
  // Swap pattern: "Program log: Instruction: Swap" or "Instruction: Buy" / "Instruction: Sell"
  let action: 'buy' | 'sell' | 'transfer' = 'buy'
  const isSwap = logs.some(log =>
    log.includes('Swap') || log.includes('swap') ||
    log.includes('Instruction: Buy') || log.includes('Instruction: Sell')
  )

  if (logs.some(log => log.includes('Instruction: Sell') || log.includes('sell'))) {
    action = 'sell'
  } else if (logs.some(log => log.includes('Transfer') && !log.includes('TransferSol'))) {
    action = matchedWallet ? 'buy' : 'transfer'
  }

  if (!isSwap && action === 'transfer') return null // Skip non-swap transfers

  // Extract token addresses from logs
  // In production: parse inner instructions for SPL token transfers
  const tokenMints = extractTokenMintsFromLogs(logs)

  return {
    walletAddress: matchedWallet || worker.config.walletAddresses[0],
    chain: 'solana',
    txHash: signature,
    action,
    token: tokenMints[0] || '',
    amount: '0', // Will be enriched by on-chain lookup
    dex: detectedDex,
    slot,
    timestamp: new Date(),
    logLevel: detectedDex ? 'info' : 'warning',
  }
}

// ─── Extract Token Mints from Logs ────────────────────────────────────────

function extractTokenMintsFromLogs(logs: string[]): string[] {
  const mints: string[] = []

  // SPL Token program logs contain mint addresses
  // Pattern: "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoked"
  // followed by account addresses including the mint

  for (const log of logs) {
    // Look for known token program invocations
    if (log.includes(TOKEN_PROGRAM_ID) || log.includes(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Extract potential mint addresses from subsequent log lines
      // In production: use getParsedTransaction for full account info
    }
  }

  return mints
}

// ─── Polling Fallback ─────────────────────────────────────────────────────

function startSolanaPolling(workerId: string): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return

  console.log('[Solana-Worker] Starting polling fallback')

  worker.intervalId = setInterval(async () => {
    try {
      await pollSolanaWallets(worker)
    } catch (err) {
      worker.status.errors.push(`Poll error: ${String(err)}`)
    }
  }, worker.config.pollIntervalMs)
}

async function pollSolanaWallets(worker: ActiveSolanaWorker): Promise<void> {
  const { config } = worker

  for (const address of config.walletAddresses) {
    try {
      // getSignaturesForAddress — recent transactions for this address
      const res = await fetch(config.httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [address, { limit: 5, commitment: 'confirmed' }],
        }),
      })

      if (!res.ok) continue
      const data = await res.json()
      const signatures = data.result || []

      for (const sig of signatures) {
        if (worker.processedSignatures.has(sig.signature)) continue
        if (sig.err) continue

        worker.processedSignatures.add(sig.signature)

        // Fetch full transaction details
        const txRes = await fetch(config.httpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'getTransaction',
            params: [sig.signature, { encoding: 'jsonParsed', commitment: 'confirmed' }],
          }),
        })

        if (!txRes.ok) continue
        const txData = await txRes.json()
        const tx = txData.result

        if (!tx?.meta || tx.meta.err) continue

        // Parse transaction for swap activities
        const activity = parseSolanaTransaction(address, sig.signature, tx, worker)
        if (activity) {
          worker.onActivity(activity)
          worker.status.lastActivityAt = new Date()
        }

        worker.status.eventsProcessed++
      }
    } catch {
      // Silent fail for individual wallet polling
    }
  }
}

// ─── Parse Full Solana Transaction ────────────────────────────────────────

function parseSolanaTransaction(
  walletAddress: string,
  signature: string,
  tx: { meta?: { logMessages?: string[]; slot?: number }; transaction?: { message?: { instructions?: Array<{ programId?: string; parsed?: { type?: string; info?: Record<string, string> } }> } } },
  worker: ActiveSolanaWorker,
): DetectedActivity | null {
  const logs = tx.meta?.logMessages || []
  const instructions = tx.transaction?.message?.instructions || []

  // Detect DEX
  let detectedDex: string | undefined
  for (const ix of instructions) {
    const programId = ix.programId || (ix.parsed as { programId?: string } | undefined)?.programId
    if (!programId) continue
    for (const [dexName, dexProgramId] of Object.entries(DEX_PROGRAMS)) {
      if (programId === dexProgramId) {
        detectedDex = dexName
        break
      }
    }
  }

  // Detect action from parsed instruction type
  let action: 'buy' | 'sell' = 'buy'
  for (const ix of instructions) {
    const type = ix.parsed?.type
    if (type === 'sell' || type === 'Sell') { action = 'sell'; break }
    if (type === 'swap' || type === 'Swap' || type === 'buy' || type === 'Buy') { action = 'buy'; break }
  }

  // Extract token info from parsed instruction
  let token = ''
  let amount = '0'
  for (const ix of instructions) {
    const info = ix.parsed?.info
    if (info) {
      if (info.mint) token = info.mint
      if (info.source) token = info.source
      if (info.tokenAmount) amount = String(info.tokenAmount)
      if (info.amount) amount = String(info.amount)
    }
  }

  return {
    walletAddress,
    chain: 'solana',
    txHash: signature,
    action,
    token,
    amount,
    dex: detectedDex,
    slot: tx.meta?.slot,
    timestamp: new Date(),
    logLevel: 'info',
  }
}

// ─── Reconnection Logic ───────────────────────────────────────────────────

function attemptSolanaReconnect(workerId: string): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return

  const { config, status } = worker
  if (status.reconnectAttempts >= config.maxReconnectAttempts) {
    console.error('[Solana-Worker] Max reconnect attempts reached')
    status.status = 'error'
    status.errors.push('Max reconnect attempts reached')
    startSolanaPolling(workerId)
    return
  }

  status.reconnectAttempts++
  const delay = Math.min(config.reconnectIntervalMs * status.reconnectAttempts, 30000)

  console.log(`[Solana-Worker] Reconnecting in ${delay}ms (attempt ${status.reconnectAttempts})`)

  setTimeout(() => {
    if (solanaWorkers.has(workerId)) {
      try {
        connectSolanaWebSocket(workerId)
      } catch {
        attemptSolanaReconnect(workerId)
      }
    }
  }, delay)
}

// ─── Update Tracked Wallets ───────────────────────────────────────────────

export function updateSolanaWallets(workerId: string, walletAddresses: string[]): void {
  const worker = solanaWorkers.get(workerId)
  if (!worker) return

  worker.config.walletAddresses = walletAddresses
  worker.status.walletsTracked = walletAddresses.length

  if (worker.ws && worker.ws.readyState === WebSocket.OPEN) {
    for (const address of walletAddresses) {
      subscribeWalletLogs(worker.ws, address, workerId)
    }
  }
}
