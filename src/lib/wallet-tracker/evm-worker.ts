// ─── EVM Tracking Worker ────────────────────────────────────────────────────
// Monitors EVM wallets (Ethereum, Base, BSC) via WebSocket subscriptions.
// Uses Alchemy eth_subscribe for pendingTransactions or log filtering.
// Falls back to polling if WebSocket unavailable.

import type { DetectedActivity, SupportedChain, TrackingWorkerConfig, TrackingWorkerStatus } from './types'

// ─── ERC-20 Transfer Event Signature ──────────────────────────────────────
// event Transfer(address indexed from, address indexed to, uint256 value)
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// ─── Worker Registry ──────────────────────────────────────────────────────
// Singleton registry for all active EVM tracking workers.

interface ActiveWorker {
  config: TrackingWorkerConfig
  ws: WebSocket | null
  status: TrackingWorkerStatus
  intervalId: NodeJS.Timeout | null
  onActivity: (activity: DetectedActivity) => void
}

const evmWorkers: Map<string, ActiveWorker> = new Map()

// ─── Start EVM Tracking Worker ────────────────────────────────────────────

export function startEvmWorker(
  config: TrackingWorkerConfig,
  onActivity: (activity: DetectedActivity) => void,
): string {
  const workerId = `evm-${config.chain}-${Date.now()}`

  const worker: ActiveWorker = {
    config,
    ws: null,
    status: {
      chain: config.chain as SupportedChain,
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
  }

  evmWorkers.set(workerId, worker)

  try {
    connectWebSocket(workerId)
  } catch (err) {
    console.error(`[EVM-Worker] Failed to connect WebSocket for ${config.chain}:`, err)
    worker.status.status = 'error'
    worker.status.errors.push(String(err))
    // Fallback to polling
    startPolling(workerId)
  }

  return workerId
}

// ─── Stop EVM Tracking Worker ─────────────────────────────────────────────

export function stopEvmWorker(workerId: string): void {
  const worker = evmWorkers.get(workerId)
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
  evmWorkers.delete(workerId)
}

// ─── Get Worker Status ────────────────────────────────────────────────────

export function getEvmWorkerStatus(workerId: string): TrackingWorkerStatus | null {
  return evmWorkers.get(workerId)?.status ?? null
}

export function getAllEvmWorkerStatuses(): TrackingWorkerStatus[] {
  return Array.from(evmWorkers.values()).map(w => w.status)
}

// ─── WebSocket Connection ─────────────────────────────────────────────────

function connectWebSocket(workerId: string): void {
  const worker = evmWorkers.get(workerId)
  if (!worker) return

  const { config, status } = worker
  status.status = 'connecting'
  status.startedAt = new Date()

  try {
    const ws = new WebSocket(config.wsUrl)
    worker.ws = ws

    ws.onopen = () => {
      console.log(`[EVM-Worker] Connected to ${config.chain} WebSocket`)
      status.status = 'connected'
      status.reconnectAttempts = 0
      status.errors = []

      // Subscribe to pending transactions for each tracked wallet
      for (const address of config.walletAddresses) {
        // Method 1: alchemy_pendingTransactions (Alchemy Enhanced API)
        subscribePendingTransactions(ws, address, workerId)

        // Method 2: Subscribe to ERC-20 Transfer logs for this address
        subscribeTransferLogs(ws, address, config.chain, workerId)
      }
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        handleWsMessage(data, workerId)
      } catch (err) {
        console.error(`[EVM-Worker] Parse error:`, err)
      }
    }

    ws.onerror = (err) => {
      console.error(`[EVM-Worker] WebSocket error for ${config.chain}:`, err)
      status.status = 'error'
      status.errors.push(`WebSocket error: ${String(err)}`)
    }

    ws.onclose = () => {
      console.log(`[EVM-Worker] WebSocket closed for ${config.chain}`)
      status.status = 'disconnected'
      attemptReconnect(workerId)
    }
  } catch (err) {
    status.status = 'error'
    status.errors.push(`Connection failed: ${String(err)}`)
    startPolling(workerId)
  }
}

// ─── WebSocket Subscriptions ──────────────────────────────────────────────

function subscribePendingTransactions(ws: WebSocket, address: string, workerId: string): void {
  // Alchemy Enhanced API: alchemy_pendingTransactions
  const msg = {
    id: `sub-pending-${address.slice(0, 8)}`,
    method: 'eth_subscribe',
    params: [
      'alchemy_pendingTransactions',
      {
        fromAddress: address.toLowerCase(),
      },
    ],
  }
  ws.send(JSON.stringify(msg))

  // Also watch transactions TO this address (incoming transfers/swaps)
  const msgTo = {
    id: `sub-pending-to-${address.slice(0, 8)}`,
    method: 'eth_subscribe',
    params: [
      'alchemy_pendingTransactions',
      {
        toAddress: address.toLowerCase(),
      },
    ],
  }
  ws.send(JSON.stringify(msgTo))
}

function subscribeTransferLogs(ws: WebSocket, address: string, chain: string, workerId: string): void {
  // Standard eth_subscribe for logs: ERC-20 Transfer events involving this address
  const addressTopic = '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0')

  // Transfers FROM this address
  const msgFrom = {
    id: `sub-logs-from-${address.slice(0, 8)}`,
    method: 'eth_subscribe',
    params: [
      'logs',
      {
        topics: [ERC20_TRANSFER_TOPIC, addressTopic],
      },
    ],
  }
  ws.send(JSON.stringify(msgFrom))

  // Transfers TO this address
  const msgTo = {
    id: `sub-logs-to-${address.slice(0, 8)}`,
    method: 'eth_subscribe',
    params: [
      'logs',
      {
        topics: [ERC20_TRANSFER_TOPIC, null, addressTopic],
      },
    ],
  }
  ws.send(JSON.stringify(msgTo))
}

// ─── Handle WebSocket Message ─────────────────────────────────────────────

function handleWsMessage(data: { id?: string; method?: string; params?: Array<{ result?: string; subscription?: string }> }, workerId: string): void {
  const worker = evmWorkers.get(workerId)
  if (!worker) return

  // Handle subscription confirmation
  if (data.id && !data.method) {
    console.log(`[EVM-Worker] Subscription confirmed: ${data.id}`)
    return
  }

  // Handle new event notification
  if (data.method === 'eth_subscription' && data.params?.[0]) {
    const result = data.params[0].result
    if (typeof result === 'string') {
      // This is a pending transaction hash or log
      processEvmEvent(result, worker)
    } else if (typeof result === 'object' && result !== null) {
      // This is a log object with topics
      processEvmLog(result as { transactionHash?: string; topics?: string[]; data?: string; address?: string; blockNumber?: string }, worker)
    }
  }
}

// ─── Process EVM Events ──────────────────────────────────────────────────

function processEvmEvent(txHash: string, worker: ActiveWorker): void {
  // We received a pending transaction hash — fetch full details via HTTP
  worker.status.eventsProcessed++

  // In production: fetch tx details from RPC, decode input, detect swaps
  // For now: emit activity placeholder
  const activity: DetectedActivity = {
    walletAddress: worker.config.walletAddresses[0] || '',
    chain: worker.config.chain as SupportedChain,
    txHash,
    action: 'buy',  // Will be determined by decoding the transaction
    token: '',
    amount: '0',
    timestamp: new Date(),
    logLevel: 'info',
  }

  worker.onActivity(activity)
  worker.status.lastActivityAt = new Date()
}

function processEvmLog(
  log: { transactionHash?: string; topics?: string[]; data?: string; address?: string; blockNumber?: string },
  worker: ActiveWorker,
): void {
  worker.status.eventsProcessed++

  if (!log.topics || log.topics.length < 3) return

  const from = '0x' + (log.topics[1] || '').slice(-40)
  const to = '0x' + (log.topics[2] || '').slice(-40)
  const tokenContract = log.address || ''
  const rawValue = log.data || '0x0'

  // Check if this involves one of our tracked wallets
  const trackedLower = worker.config.walletAddresses.map(a => a.toLowerCase())
  const isFrom = trackedLower.includes(from.toLowerCase())
  const isTo = trackedLower.includes(to.toLowerCase())

  if (!isFrom && !isTo) return

  const walletAddress = isFrom ? from : to
  const action = isFrom ? 'sell' : 'buy' // Sending tokens = sell, receiving = buy

  // Decode value from hex
  const value = BigInt(rawValue || '0x0')
  // Note: In production, need to check decimals from token contract

  const activity: DetectedActivity = {
    walletAddress,
    chain: worker.config.chain as SupportedChain,
    txHash: log.transactionHash || '',
    action: action as 'buy' | 'sell',
    token: tokenContract,
    amount: value.toString(),
    blockNumber: log.blockNumber,
    timestamp: new Date(),
    logLevel: 'info',
  }

  worker.onActivity(activity)
  worker.status.lastActivityAt = new Date()
}

// ─── Polling Fallback ─────────────────────────────────────────────────────

function startPolling(workerId: string): void {
  const worker = evmWorkers.get(workerId)
  if (!worker) return

  console.log(`[EVM-Worker] Starting polling for ${worker.config.chain}`)

  worker.intervalId = setInterval(async () => {
    try {
      await pollEvmWallets(worker)
    } catch (err) {
      worker.status.errors.push(`Poll error: ${String(err)}`)
    }
  }, worker.config.pollIntervalMs)
}

async function pollEvmWallets(worker: ActiveWorker): Promise<void> {
  const { config } = worker

  for (const address of config.walletAddresses) {
    try {
      // Get latest block number
      const blockRes = await fetch(config.httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_blockNumber',
          params: [],
        }),
      })
      if (!blockRes.ok) continue
      const blockData = await blockRes.json()
      const currentBlock = parseInt(blockData.result, 16)

      // Get recent Transfer logs for this address
      const logsRes = await fetch(config.httpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getLogs',
          params: [{
            fromBlock: '0x' + Math.max(0, currentBlock - 10).toString(16),
            toBlock: 'latest',
            topics: [
              ERC20_TRANSFER_TOPIC,
              '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0'),
            ],
          }],
        }),
      })

      if (!logsRes.ok) continue
      const logsData = await logsRes.json()
      const logs = logsData.result || []

      for (const log of logs) {
        processEvmLog(log, worker)
      }
    } catch (err) {
      // Silent fail for individual wallet polling
    }
  }
}

// ─── Reconnection Logic ───────────────────────────────────────────────────

function attemptReconnect(workerId: string): void {
  const worker = evmWorkers.get(workerId)
  if (!worker) return

  const { config, status } = worker
  if (status.reconnectAttempts >= config.maxReconnectAttempts) {
    console.error(`[EVM-Worker] Max reconnect attempts reached for ${config.chain}`)
    status.status = 'error'
    status.errors.push('Max reconnect attempts reached')
    startPolling(workerId)
    return
  }

  status.reconnectAttempts++
  const delay = Math.min(config.reconnectIntervalMs * status.reconnectAttempts, 30000)

  console.log(`[EVM-Worker] Reconnecting in ${delay}ms (attempt ${status.reconnectAttempts})`)

  setTimeout(() => {
    if (evmWorkers.has(workerId)) {
      try {
        connectWebSocket(workerId)
      } catch {
        attemptReconnect(workerId)
      }
    }
  }, delay)
}

// ─── Update Tracked Wallets ───────────────────────────────────────────────

export function updateEvmWallets(workerId: string, walletAddresses: string[]): void {
  const worker = evmWorkers.get(workerId)
  if (!worker) return

  worker.config.walletAddresses = walletAddresses
  worker.status.walletsTracked = walletAddresses.length

  // If connected, re-subscribe
  if (worker.ws && worker.ws.readyState === WebSocket.OPEN) {
    for (const address of walletAddresses) {
      subscribePendingTransactions(worker.ws, address, workerId)
      subscribeTransferLogs(worker.ws, address, worker.config.chain, workerId)
    }
  }
}
