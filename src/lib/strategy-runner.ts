// ─── Strategy Runner Engine ─────────────────────────────────────────────────
// Monitors active strategies, detects signals, and executes trades on Bybit/MEXC.
// Supports multiple strategy types: dip_buying, momentum, mean_reversion, breakout, dca, grid
// Runs as a singleton in-memory process on the server.

import { db } from './db'
import { decrypt } from './encryption'
import { BybitClient, getBybitSymbol, type BybitMode } from './bybit'
import { MexcClient, getMexcSymbol, type MexcMode, getExchangeFees } from './mexc'
import { fetchTopCoins, type CoinMarket } from './coingecko'
import { log, warn, error as logError } from './logger'
import {
  classifyPositionTransition,
  isVolumeSpike,
} from './strategy-metrics'
import { recordStrategyTelemetry } from './strategy-telemetry'
import { enqueueStrategyShadowEvaluation } from './strategy-shadow'
import {
  normalizeTradingSymbol,
  recordDueTradeOutcomes,
} from './strategy-outcomes'
import { recordExecutionLeg } from './strategy-learning-store'
import { enqueueOutcomeBackfillDrain } from './strategy-outcome-backfill'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Unified exchange client interface for strategy operations */
interface UnifiedExchangeClient {
  testConnection(): Promise<{ success: boolean; message: string }>
  marketBuy(symbol: string, quantity: string, orderLinkId?: string): Promise<{ orderId: string }>
  marketSell(symbol: string, quantity: string, orderLinkId?: string): Promise<{ orderId: string }>
  getCoinBalance(coin: string): Promise<number>
  getOrderHistory(symbol: string, limit: number): Promise<Array<{ orderId: string; avgPrice: string; price: string }>>
}

/** Wrap a BybitClient or MexcClient to match the unified interface */
class BybitMexcAdapter implements UnifiedExchangeClient {
  private client: BybitClient | MexcClient
  constructor(client: BybitClient | MexcClient) { this.client = client }

  async testConnection() { return this.client.testConnection() }

  async marketBuy(symbol: string, quantity: string, orderLinkId?: string) {
    const result = await this.client.marketBuy(symbol, quantity, orderLinkId)
    return { orderId: result.orderId }
  }

  async marketSell(symbol: string, quantity: string, orderLinkId?: string) {
    const result = await this.client.marketSell(symbol, quantity, orderLinkId)
    return { orderId: result.orderId }
  }

  async getCoinBalance(coin: string): Promise<number> {
    return this.client.getCoinBalance(coin)
  }

  async getOrderHistory(symbol: string, limit: number) {
    return this.client.getOrderHistory(symbol, limit)
  }
}

/** Create a unified exchange client from stored API credentials */
function wrapClient(client: BybitClient | MexcClient): UnifiedExchangeClient {
  return new BybitMexcAdapter(client)
}

interface RunningStrategy {
  dbId: string
  strategyId: string
  name: string
  coinId: string
  symbol: string
  mode: BybitMode
  exchange: string

  // Strategy type
  strategyType: string  // dip_buying, momentum, mean_reversion, breakout, dca, grid, hurst_hcoo_lb
  strategyParams: Record<string, unknown>  // Type-specific parameters

  // Strategy parameters (legacy dip-buying fields kept for backward compat)
  dipThreshold1h: number
  dipThreshold24h: number
  takeProfitPct: number
  stopLossPct: number
  maxHoldingHours: number
  feePct: number
  initialCapital: number
  compound: boolean

  // Runtime state
  currentCapital: number
  totalPnl: number
  totalTrades: number
  winningTrades: number

  // Current position
  inPosition: boolean
  entryPrice: number | null
  entryDate: string | null
  positionSize: number | null
  peakPrice: number | null       // for trailing stop
  trailingStopPct: number        // 0 = disabled; % drop from peak triggers exit

  // Exchange client (unified interface for all exchanges)
  client: UnifiedExchangeClient

  // Last known prices for 1h change calculation
  lastPrice: number | null
  lastPriceTime: number | null
  price1hAgo: number | null
  volumeSamples: number[]

  // DCA-specific state
  dcaTotalSpent: number
  dcaTotalQuantity: number
  dcaLastBuyTime: number | null

  // Grid-specific state
  gridBoughtLevels: Map<number, { price: number; qty: number; date: string }>
}

// ─── Singleton State ────────────────────────────────────────────────────────

const runningStrategies = new Map<string, RunningStrategy>()
let pollIntervalId: ReturnType<typeof setInterval> | null = null
let isPolling = false

async function recordExecutionLegSafely(
  input: Parameters<typeof recordExecutionLeg>[0],
): Promise<void> {
  try {
    await recordExecutionLeg(input)
  } catch (telemetryError) {
    logError('[StrategyRunner] Execution telemetry failed:', telemetryError)
  }
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/** Create a unified exchange client from stored API credentials */
async function createExchangeClient(exchange: string, mode: string): Promise<UnifiedExchangeClient> {
  if (exchange === 'binance') {
    throw new Error('Handel przez Binance został wyłączony')
  }

  const apiRecord = await db.exchangeApi.findUnique({
    where: { exchange_mode: { exchange, mode } },
  })

  if (!apiRecord || !apiRecord.isConfigured) {
    throw new Error(`Brak skonfigurowanych kluczy API dla ${exchange.toUpperCase()} (${mode}). Ustaw klucze w Ustawieniach.`)
  }

  const apiKey = decrypt(apiRecord.apiKey)
  const apiSecret = decrypt(apiRecord.apiSecret)

  if (exchange === 'mexc') {
    return new BybitMexcAdapter(new MexcClient({ apiKey, apiSecret, mode: mode as MexcMode }))
  }

  return new BybitMexcAdapter(new BybitClient({ apiKey, apiSecret, mode: mode as BybitMode }))
}

/** Get the trading symbol for a coin on a specific exchange */
function getExchangeSymbol(coinId: string, exchange: string): string {
  if (exchange === 'mexc') return getMexcSymbol(coinId)
  return getBybitSymbol(coinId)
}

/** Activate a strategy with full config (called from API route) */
export async function activateStrategyWithConfig(config: {
  strategyId: string
  name: string
  coinId: string
  mode: BybitMode
  strategyType?: string
  strategyParams?: Record<string, unknown>
  dipThreshold1h: number
  dipThreshold24h: number
  takeProfitPct: number
  stopLossPct: number
  maxHoldingHours: number
  feePct: number
  initialCapital: number
  compound: boolean
}): Promise<{ success: boolean; message: string; dbId?: string }> {
  const { strategyId, name, coinId, mode } = config
  const existingKey = `${strategyId}:${mode}`

  if (runningStrategies.has(existingKey)) {
    return { success: false, message: `Strategia jest już aktywna w trybie ${mode}` }
  }

  // Create exchange client
  const exchange = config.strategyParams?.exchange as string || 'bybit'
  let client: UnifiedExchangeClient
  try {
    client = await createExchangeClient(exchange, mode)
    const test = await client.testConnection()
    if (!test.success) {
      return { success: false, message: `Błąd połączenia z ${exchange.toUpperCase()}: ${test.message}` }
    }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : `Błąd tworzenia klienta ${exchange.toUpperCase()}` }
  }

  const symbol = getExchangeSymbol(coinId, exchange)
  const strategyType = config.strategyType || 'dip_buying'
  const strategyParams = config.strategyParams || {}

  // Check if there's an existing DB record for this strategy+mode
  let dbRecord = await db.activeStrategy.findFirst({
    where: { strategyId, mode },
  })

  if (dbRecord) {
    // Resume existing strategy
    await db.activeStrategy.update({
      where: { id: dbRecord.id },
      data: { status: 'running', errorMessage: null, strategyType, strategyParams: JSON.stringify(strategyParams) },
    })
  } else {
    // Create new DB record
    dbRecord = await db.activeStrategy.create({
      data: {
        strategyId,
        name,
        coinId,
        symbol,
        mode,
        exchange,
        strategyType,
        strategyParams: JSON.stringify(strategyParams),
        dipThreshold1h: config.dipThreshold1h,
        dipThreshold24h: config.dipThreshold24h,
        takeProfitPct: config.takeProfitPct,
        stopLossPct: config.stopLossPct,
        maxHoldingHours: config.maxHoldingHours,
        feePct: config.feePct,
        initialCapital: config.initialCapital,
        compound: config.compound,
        status: 'running',
        currentCapital: config.initialCapital,
      },
    })
  }

  // Add to in-memory running strategies
  const running: RunningStrategy = {
    dbId: dbRecord.id,
    strategyId,
    name,
    coinId,
    symbol,
    mode,
    exchange,
    strategyType,
    strategyParams,
    dipThreshold1h: config.dipThreshold1h,
    dipThreshold24h: config.dipThreshold24h,
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
    maxHoldingHours: config.maxHoldingHours,
    feePct: config.feePct,
    initialCapital: config.initialCapital,
    compound: config.compound,
    currentCapital: dbRecord.currentCapital || config.initialCapital,
    totalPnl: dbRecord.totalPnl,
    totalTrades: dbRecord.totalTrades,
    winningTrades: dbRecord.winningTrades,
    inPosition: dbRecord.inPosition,
    entryPrice: dbRecord.entryPrice,
    entryDate: dbRecord.entryDate,
    positionSize: dbRecord.positionSize,
    peakPrice: dbRecord.entryPrice,
    trailingStopPct: Number(strategyParams.trailing_stop_pct ?? 0),
    client,
    lastPrice: null,
    lastPriceTime: null,
    price1hAgo: null,
    volumeSamples: [],
    dcaTotalSpent: 0,
    dcaTotalQuantity: 0,
    dcaLastBuyTime: null,
    gridBoughtLevels: new Map(),
  }

  runningStrategies.set(existingKey, running)

  // Start polling if not already
  startPolling()

  return { success: true, message: `Strategia "${name}" (${getStrategyTypeLabel(strategyType)}) aktywowana w trybie ${mode === 'demo' ? 'Demo' : 'Real'}`, dbId: dbRecord.id }
}

/** Get a human-readable label for strategy type */
function getStrategyTypeLabel(type: string): string {
  switch (type) {
    case 'dip_buying': return 'Dip Buying'
    case 'momentum': return 'Momentum'
    case 'mean_reversion': return 'Mean Reversion'
    case 'breakout': return 'Breakout'
    case 'dca': return 'DCA'
    case 'grid': return 'Grid Trading'
    case 'hurst_hcoo_lb': return 'Hurst HCOO_LB'
    default: return type
  }
}

/** Deactivate a strategy — stop monitoring and cancel any open orders */
export async function deactivateStrategy(strategyId: string, mode: BybitMode): Promise<{ success: boolean; message: string }> {
  const key = `${strategyId}:${mode}`
  const running = runningStrategies.get(key)

  if (!running) {
    return { success: false, message: 'Strategia nie jest aktywna' }
  }

  let positionClosed = false
  let closeError: Error | null = null

  // If in position, try to close it at market
  if (running.inPosition && running.positionSize && running.positionSize > 0) {
    try {
      const baseCoin = running.symbol.replace('USDT', '')
      const balance = await running.client.getCoinBalance(baseCoin)
      if (balance > 0) {
        const order = await running.client.marketSell(running.symbol, balance.toString(), `dh-close-${Date.now()}`)
        log(`[StrategyRunner] Closed position on ${running.symbol} (deactivation)`)

        await new Promise(r => setTimeout(r, 2000))
        const history = await running.client.getOrderHistory(running.symbol, 1)
        const fillOrder = history.find(o => o.orderId === order.orderId)
        const exitPrice = fillOrder ? Number(fillOrder.avgPrice || fillOrder.price) : (running.entryPrice ?? 0)

        const savedEntryPrice = running.entryPrice
        const savedPositionSize = running.positionSize
        const profitPct = savedEntryPrice ? ((exitPrice - savedEntryPrice) / savedEntryPrice) * 100 : 0
        const entryFee = (savedPositionSize ?? 0) * (running.feePct / 100)
        const exitValue = (savedPositionSize ?? 0) * (1 + profitPct / 100)
        const exitFee = exitValue * (running.feePct / 100)
        const totalFees = entryFee + exitFee
        const netPnl = (savedPositionSize ?? 0) * (profitPct / 100) - exitFee
        const netProfitPct = savedPositionSize ? (netPnl / savedPositionSize) * 100 : 0

        running.totalPnl += netPnl
        running.totalTrades++
        if (netProfitPct > 0) running.winningTrades++
        if (running.compound) running.currentCapital = Math.max(1, running.currentCapital + netPnl)

        const capitalAfter = running.currentCapital
        const exitDate = new Date().toISOString()

        running.inPosition = false
        running.entryPrice = null
        running.entryDate = null
        running.positionSize = null

        await db.$transaction([
          db.tradeLog.create({
            data: {
              activeStrategyId: running.dbId,
              mode: running.mode,
              coinId: running.coinId,
              symbol: running.symbol,
              side: 'sell',
              entryPrice: savedEntryPrice,
              exitPrice,
              exitDate,
              exitReason: 'signal',
              quantity: balance,
              positionSize: savedPositionSize || 0,
              profitPct,
              netProfitPct,
              feesPaid: totalFees,
              capitalAfter,
              orderId: order.orderId,
              orderStatus: 'Filled',
            },
          }),
          db.activeStrategy.update({
            where: { id: running.dbId },
            data: {
              status: 'stopped',
              inPosition: false, entryPrice: null, entryDate: null, positionSize: null,
              currentCapital: capitalAfter, totalPnl: running.totalPnl,
              totalTrades: running.totalTrades, winningTrades: running.winningTrades,
              lastTradeAt: exitDate, errorMessage: null,
            },
          }),
        ])
        positionClosed = true
      }
    } catch (err) {
      closeError = err instanceof Error ? err : new Error(String(err))
      logError(`[StrategyRunner] Error closing position on deactivation:`, err)
    }
  }

  // If position was not closed (no balance, or no position), just update status.
  // If close errored, mark status as 'error'.
  if (!positionClosed) {
    if (closeError) {
      await db.activeStrategy.update({
        where: { id: running.dbId },
        data: { status: 'error', errorMessage: `Błąd zamknięcia: ${closeError.message}` },
      })
    } else {
      await db.activeStrategy.update({
        where: { id: running.dbId },
        data: { status: 'stopped', inPosition: false, entryPrice: null, entryDate: null, positionSize: null },
      })
    }
  }

  runningStrategies.delete(key)

  // Stop polling if no more strategies
  if (runningStrategies.size === 0) {
    stopPolling()
  }

  return { success: true, message: `Strategia "${running.name}" zatrzymana` }
}

/** Get status of all active strategies */
export function getActiveStrategiesStatus(): Array<{
  strategyId: string
  name: string
  coinId: string
  symbol: string
  mode: string
  status: string
  strategyType: string
  inPosition: boolean
  entryPrice: number | null
  entryDate: string | null
  currentCapital: number
  totalPnl: number
  totalTrades: number
  winningTrades: number
  lastPrice: number | null
}> {
  return Array.from(runningStrategies.values()).map(s => ({
    strategyId: s.strategyId,
    name: s.name,
    coinId: s.coinId,
    symbol: s.symbol,
    mode: s.mode,
    status: 'running',
    strategyType: s.strategyType,
    inPosition: s.inPosition,
    entryPrice: s.entryPrice,
    entryDate: s.entryDate,
    currentCapital: s.currentCapital,
    totalPnl: s.totalPnl,
    totalTrades: s.totalTrades,
    winningTrades: s.winningTrades,
    lastPrice: s.lastPrice,
  }))
}

/** Check if a specific strategy+mode is active */
export function isStrategyActive(strategyId: string, mode: BybitMode): boolean {
  return runningStrategies.has(`${strategyId}:${mode}`)
}

// ─── Polling Engine ─────────────────────────────────────────────────────────

function startPolling() {
  if (pollIntervalId) return
  log('[StrategyRunner] Starting polling engine...')

  // Poll every 60 seconds
  pollIntervalId = setInterval(pollAllStrategies, 60_000)

  // Also run immediately
  setTimeout(pollAllStrategies, 1000)
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId)
    pollIntervalId = null
  }
  log('[StrategyRunner] Polling engine stopped')
}

async function pollAllStrategies() {
  if (isPolling) return
  isPolling = true

  try {
    // Fetch current coin data from CoinGecko (single request for all)
    let coins: CoinMarket[] = []
    try {
      coins = await fetchTopCoins(70, 30_000) // Short cache for live trading
    } catch (err) {
      logError('[StrategyRunner] CoinGecko fetch error:', err)
      return
    }

    // Build lookup map
    const coinMap = new Map<string, CoinMarket>()
    const currentPrices = new Map<string, number>()
    for (const coin of coins) {
      coinMap.set(coin.id, coin)
      const baseSymbol = normalizeTradingSymbol(coin.symbol)
      currentPrices.set(baseSymbol, coin.current_price)
      currentPrices.set(`${baseSymbol}USDT`, coin.current_price)
      currentPrices.set(`${baseSymbol}USDC`, coin.current_price)
    }
    for (const strategy of runningStrategies.values()) {
      const coin = coinMap.get(strategy.coinId)
      if (coin) {
        currentPrices.set(normalizeTradingSymbol(strategy.symbol), coin.current_price)
      }
    }

    // Process each running strategy
    for (const [key, strategy] of runningStrategies) {
      try {
        await processStrategy(strategy, coinMap)
      } catch (err) {
        logError(`[StrategyRunner] Error processing strategy ${strategy.name}:`, err)
        // Update DB with error
        try {
          await db.activeStrategy.update({
            where: { id: strategy.dbId },
            data: { errorMessage: err instanceof Error ? err.message : 'Unknown error' },
          })
        } catch {}
      }
    }

    try {
      await recordDueTradeOutcomes(currentPrices)
      enqueueOutcomeBackfillDrain()
    } catch (outcomeError) {
      logError('[StrategyRunner] Horizon outcome evaluation failed:', outcomeError)
    }
  } finally {
    isPolling = false
  }
}

async function processStrategy(strategy: RunningStrategy, coinMap: Map<string, CoinMarket>) {
  const coin = coinMap.get(strategy.coinId)
  if (!coin) {
    warn(`[StrategyRunner] No CoinGecko data for ${strategy.coinId}`)
    return
  }

  const currentPrice = coin.current_price
  const wasInPosition = strategy.inPosition
  const totalPnlBefore = strategy.totalPnl

  const now = Date.now()

  // Keep an hourly anchor instead of overwriting it on every one-minute poll.
  if (!strategy.lastPriceTime) {
    strategy.lastPrice = currentPrice
    strategy.lastPriceTime = now
  } else if (now - strategy.lastPriceTime >= 3600_000) {
    strategy.price1hAgo = strategy.lastPrice
    strategy.lastPrice = currentPrice
    strategy.lastPriceTime = now
  }

  // Dispatch to strategy-specific logic
  switch (strategy.strategyType) {
    case 'dip_buying':
      await processDipBuying(strategy, coin, currentPrice)
      break
    case 'momentum':
      await processMomentum(strategy, coin, currentPrice)
      break
    case 'mean_reversion':
      await processMeanReversion(strategy, coin, currentPrice)
      break
    case 'breakout':
      await processBreakout(strategy, coin, currentPrice)
      break
    case 'dca':
      await processDCA(strategy, coin, currentPrice)
      break
    case 'grid':
      await processGrid(strategy, coin, currentPrice)
      break
    case 'hurst_hcoo_lb':
      await processHurstHcooLb(strategy, coin, currentPrice)
      break
    default:
      await processDipBuying(strategy, coin, currentPrice)
  }

  // Persist state to DB periodically
  await db.activeStrategy.update({
    where: { id: strategy.dbId },
    data: {
      inPosition: strategy.inPosition,
      entryPrice: strategy.entryPrice,
      entryDate: strategy.entryDate,
      positionSize: strategy.positionSize,
      currentCapital: strategy.currentCapital,
      totalPnl: strategy.totalPnl,
      totalTrades: strategy.totalTrades,
      winningTrades: strategy.winningTrades,
      lastSignalAt: new Date().toISOString(),
    },
  })

  const action = classifyPositionTransition(
    wasInPosition,
    strategy.inPosition,
  )
  const reason = action === 'ENTER'
    ? `${strategy.strategyType}:entry_signal`
    : action === 'EXIT'
      ? `${strategy.strategyType}:exit_signal`
      : action === 'HOLD'
        ? `${strategy.strategyType}:position_open`
        : `${strategy.strategyType}:no_entry_signal`

  try {
    const decisionId = await recordStrategyTelemetry({
      activeStrategyId: strategy.dbId,
      strategyId: strategy.strategyId,
      strategyType: strategy.strategyType,
      symbol: strategy.symbol,
      mode: strategy.mode,
      exchange: strategy.exchange,
      action,
      reason,
      strategyParams: strategy.strategyParams,
      coin,
      currentPrice,
      price1hAgo: strategy.price1hAgo,
      volumeSampleCount: strategy.volumeSamples.length,
      pnlDelta: strategy.totalPnl - totalPnlBefore,
    })
    if (action === 'ENTER') {
      // Fire-and-forget: shadow evaluation happens after the baseline action and
      // has no reference to the exchange client, so it cannot alter execution.
      enqueueStrategyShadowEvaluation(decisionId)
    }
  } catch (telemetryError) {
    logError(
      `[StrategyRunner] Telemetry failed for ${strategy.name}:`,
      telemetryError,
    )
  }
}

// ─── Dip Buying Strategy ────────────────────────────────────────────────────

async function processDipBuying(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const change1h = coin.price_change_percentage_1h_in_currency
  const change24h = coin.price_change_percentage_24h_in_currency

  if (strategy.inPosition) {
    await checkExit(strategy, currentPrice)
  } else {
    await checkDipEntry(strategy, change1h, change24h, currentPrice, coin)
  }
}

async function checkDipEntry(
  strategy: RunningStrategy,
  change1h: number | null,
  change24h: number | null,
  currentPrice: number,
  coin: CoinMarket
) {
  const dip1hMet = change1h !== null ? change1h <= strategy.dipThreshold1h : strategy.dipThreshold1h >= 0
  const dip24hMet = change24h !== null ? change24h <= strategy.dipThreshold24h : false

  if (!dip1hMet || !dip24hMet) return

  log(`[StrategyRunner] Dip signal detected for ${strategy.name} (${strategy.symbol}): 1h=${change1h?.toFixed(2)}%, 24h=${change24h?.toFixed(2)}%`)

  const positionSize = strategy.compound ? strategy.currentCapital : strategy.initialCapital
  const quantity = positionSize / currentPrice

  if (positionSize < 5) {
    warn(`[StrategyRunner] Position too small ($${positionSize.toFixed(2)}) for ${strategy.symbol}`)
    return
  }

  try {
    const order = await strategy.client.marketBuy(
      strategy.symbol,
      quantity.toFixed(6),
      `dh-buy-${strategy.strategyId}-${Date.now()}`
    )

    log(`[StrategyRunner] BUY order placed: ${strategy.symbol} qty=${quantity.toFixed(6)} ~$${positionSize.toFixed(2)} orderId=${order.orderId}`)

    await new Promise(r => setTimeout(r, 2000))
    const history = await strategy.client.getOrderHistory(strategy.symbol, 1)
    const fillOrder = history.find(o => o.orderId === order.orderId)
    const fillPrice = fillOrder ? Number(fillOrder.avgPrice || fillOrder.price) : currentPrice

    strategy.inPosition = true
    strategy.entryPrice = fillPrice
    strategy.entryDate = new Date().toISOString()
    strategy.positionSize = positionSize
    strategy.peakPrice = fillPrice

    await db.$transaction([
      db.tradeLog.create({
        data: {
          activeStrategyId: strategy.dbId,
          mode: strategy.mode,
          coinId: strategy.coinId,
          symbol: strategy.symbol,
          side: 'buy',
          entryPrice: fillPrice,
          entryDate: strategy.entryDate,
          quantity,
          positionSize,
          orderId: order.orderId,
          orderStatus: 'Filled',
        },
      }),
      db.activeStrategy.update({
        where: { id: strategy.dbId },
        data: { inPosition: true, entryPrice: fillPrice, entryDate: strategy.entryDate, positionSize, lastTradeAt: strategy.entryDate, errorMessage: null },
      }),
    ])

  } catch (err) {
    logError(`[StrategyRunner] BUY order failed for ${strategy.symbol}:`, err)
    await db.activeStrategy.update({
      where: { id: strategy.dbId },
      data: { errorMessage: `Błąd kupna: ${err instanceof Error ? err.message : 'Unknown'}` },
    })
  }
}

// ─── Momentum Strategy ──────────────────────────────────────────────────────

async function processMomentum(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const maPeriod = (strategy.strategyParams.ma_period as number) ?? 20
  const volumeThreshold = (strategy.strategyParams.volume_threshold as number) ?? 1.5

  // Use sparkline data to compute MA
  const sparkline = coin.sparkline_in_7d?.price
  if (!sparkline || sparkline.length < maPeriod) return

  // Compute simple MA from sparkline
  let sum = 0
  const len = sparkline.length
  for (let i = len - maPeriod; i < len; i++) {
    sum += sparkline[i]
  }
  const ma = sum / maPeriod

  // Compare against prior polling snapshots. The previous implementation
  // compared total_volume with itself, so its threshold was meaningless.
  const volumeOk = isVolumeSpike(
    coin.total_volume,
    strategy.volumeSamples,
    volumeThreshold,
  )
  strategy.volumeSamples.push(coin.total_volume)
  if (strategy.volumeSamples.length > 60) strategy.volumeSamples.shift()

  if (strategy.inPosition) {
    // Exit if price crosses below MA
    if (currentPrice < ma) {
      log(`[StrategyRunner] Momentum exit: ${strategy.name} price ${currentPrice} < MA ${ma.toFixed(2)}`)
      await checkExit(strategy, currentPrice, 'signal')
    } else {
      await checkExit(strategy, currentPrice)
    }
  } else {
    // Entry: price above MA AND volume > average * threshold
    if (currentPrice > ma && volumeOk) {
      log(`[StrategyRunner] Momentum entry: ${strategy.name} price ${currentPrice} > MA ${ma.toFixed(2)}`)
      await executeBuy(strategy, currentPrice)
    }
  }
}

// ─── Mean Reversion Strategy ────────────────────────────────────────────────

async function processMeanReversion(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const maPeriod = (strategy.strategyParams.ma_period as number) ?? 20
  const deviationThreshold = (strategy.strategyParams.deviation_threshold as number) ?? 2

  const sparkline = coin.sparkline_in_7d?.price
  if (!sparkline || sparkline.length < maPeriod) return

  // Compute MA and stdDev
  let sum = 0
  const len = sparkline.length
  for (let i = len - maPeriod; i < len; i++) {
    sum += sparkline[i]
  }
  const ma = sum / maPeriod

  let sumSq = 0
  for (let i = len - maPeriod; i < len; i++) {
    sumSq += (sparkline[i] - ma) ** 2
  }
  const stdDev = Math.sqrt(sumSq / maPeriod)

  const lowerBand = ma - deviationThreshold * stdDev

  if (strategy.inPosition) {
    // Exit: price returns to MA (within 0.5 stdDev)
    if (currentPrice >= ma || currentPrice >= ma + 0.5 * stdDev) {
      log(`[StrategyRunner] Mean Reversion exit: ${strategy.name} price ${currentPrice} >= MA ${ma.toFixed(2)}`)
      await checkExit(strategy, currentPrice, 'signal')
    } else {
      await checkExit(strategy, currentPrice)
    }
  } else {
    // Entry: price below lower Bollinger Band
    if (currentPrice <= lowerBand) {
      log(`[StrategyRunner] Mean Reversion entry: ${strategy.name} price ${currentPrice} <= lower band ${lowerBand.toFixed(2)}`)
      await executeBuy(strategy, currentPrice)
    }
  }
}

// ─── Breakout Strategy ──────────────────────────────────────────────────────

async function processBreakout(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const lookback = (strategy.strategyParams.lookback_periods as number) ?? 20

  const sparkline = coin.sparkline_in_7d?.price
  if (!sparkline || sparkline.length < lookback) return

  // Find high of last lookback periods
  let high = 0
  for (let i = sparkline.length - lookback; i < sparkline.length; i++) {
    if (sparkline[i] > high) high = sparkline[i]
  }

  if (strategy.inPosition) {
    // Exit if price falls below breakout level (stored in strategyParams)
    const breakoutLevel = (strategy.strategyParams._breakoutLevel as number) ?? high
    if (currentPrice < breakoutLevel) {
      log(`[StrategyRunner] Breakout exit: ${strategy.name} price ${currentPrice} < breakout ${breakoutLevel.toFixed(2)}`)
      await checkExit(strategy, currentPrice, 'signal')
    } else {
      await checkExit(strategy, currentPrice)
    }
  } else {
    // Entry: price breaks above recent high
    if (currentPrice > high) {
      log(`[StrategyRunner] Breakout entry: ${strategy.name} price ${currentPrice} > high ${high.toFixed(2)}`)
      strategy.strategyParams._breakoutLevel = high
      await executeBuy(strategy, currentPrice)
    }
  }
}

// ─── DCA Strategy ───────────────────────────────────────────────────────────

async function processDCA(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const buyIntervalHours = (strategy.strategyParams.buy_interval_hours as number) ?? 168
  const buyAmount = (strategy.strategyParams.buy_amount as number) ?? 100
  const targetProfitPct = (strategy.strategyParams.target_profit_pct as number) ?? 15

  const now = Date.now()
  const lastBuyTime = strategy.dcaLastBuyTime ?? new Date(strategy.entryDate ?? Date.now()).getTime()
  const hoursSinceLastBuy = (now - lastBuyTime) / (1000 * 60 * 60)

  // Buy at interval
  if (hoursSinceLastBuy >= buyIntervalHours) {
    const quantity = buyAmount / currentPrice
    if (buyAmount >= 5) {
      try {
        const legKind = strategy.dcaTotalQuantity > 0 ? 'ADD' : 'ENTER'
        const order = await strategy.client.marketBuy(
          strategy.symbol,
          quantity.toFixed(6),
          `dh-dca-buy-${strategy.strategyId}-${Date.now()}`
        )
        const fee = buyAmount * (strategy.feePct / 100)
        const actualQty = (buyAmount - fee) / currentPrice
        strategy.dcaTotalSpent += buyAmount
        strategy.dcaTotalQuantity += actualQty
        strategy.dcaLastBuyTime = now

        await recordExecutionLegSafely({
          activeStrategyId: strategy.dbId,
          strategyId: strategy.strategyId,
          strategyType: strategy.strategyType,
          symbol: strategy.symbol,
          kind: legKind,
          idempotencyKey: `${strategy.exchange}:${order.orderId}`,
          orderId: order.orderId,
          price: currentPrice,
          quantity: actualQty,
          notional: buyAmount,
          fee,
          executedAt: new Date(now),
          metadata: { source: 'dca', buyIntervalHours },
        })

        log(`[StrategyRunner] DCA buy: ${strategy.name} $${buyAmount} @ ${currentPrice}`)
      } catch (err) {
        logError(`[StrategyRunner] DCA buy failed:`, err)
      }
    }
  }

  // Check target profit
  if (strategy.dcaTotalQuantity > 0 && strategy.dcaTotalSpent > 0) {
    const currentValue = strategy.dcaTotalQuantity * currentPrice
    const pnlPct = ((currentValue - strategy.dcaTotalSpent) / strategy.dcaTotalSpent) * 100

    if (pnlPct >= targetProfitPct) {
      log(`[StrategyRunner] DCA target profit reached: ${strategy.name} PnL=${pnlPct.toFixed(2)}%`)
      // Sell all
      try {
        const baseCoin = strategy.symbol.replace('USDT', '')
        const balance = await strategy.client.getCoinBalance(baseCoin)
        let sellOrderId: string | undefined
        if (balance > 0) {
          const order = await strategy.client.marketSell(strategy.symbol, balance.toString(), `dh-dca-sell-${Date.now()}`)
          sellOrderId = order.orderId
        }

        const sellValue = strategy.dcaTotalQuantity * currentPrice
        const exitFee = sellValue * (strategy.feePct / 100)
        const grossProfit = sellValue - strategy.dcaTotalSpent
        const netProfit = grossProfit - exitFee
        strategy.currentCapital += netProfit
        strategy.totalPnl += netProfit
        strategy.totalTrades++
        if (netProfit > 0) strategy.winningTrades++

        strategy.inPosition = false
        strategy.entryPrice = null
        strategy.entryDate = null
        strategy.positionSize = null
        strategy.dcaTotalSpent = 0
        strategy.dcaTotalQuantity = 0
        strategy.dcaLastBuyTime = null

        if (sellOrderId) {
          await recordExecutionLegSafely({
            activeStrategyId: strategy.dbId,
            strategyId: strategy.strategyId,
            strategyType: strategy.strategyType,
            symbol: strategy.symbol,
            kind: 'EXIT',
            idempotencyKey: `${strategy.exchange}:${sellOrderId}`,
            orderId: sellOrderId,
            price: currentPrice,
            quantity: balance,
            notional: sellValue,
            fee: exitFee,
            grossPnl: grossProfit,
            netPnl: netProfit,
            metadata: { source: 'dca', targetProfitPct },
          })
        }

        log(`[StrategyRunner] DCA position closed: PnL=$${netProfit.toFixed(2)}`)
      } catch (err) {
        logError(`[StrategyRunner] DCA sell failed:`, err)
      }
    }
  }

  // Mark as in position if we have DCA buys
  if (strategy.dcaTotalQuantity > 0) {
    strategy.inPosition = true
    strategy.positionSize = strategy.dcaTotalSpent
  }
}

// ─── Grid Strategy ──────────────────────────────────────────────────────────

async function processGrid(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const gridSpacingPct = (strategy.strategyParams.grid_spacing_pct as number) ?? 2
  const gridLevels = (strategy.strategyParams.grid_levels as number) ?? 5
  const basePrice = (strategy.strategyParams.base_price as number) ?? currentPrice

  const perGridAmount = strategy.initialCapital / gridLevels

  // Check buy levels
  for (let i = 1; i <= gridLevels; i++) {
    const buyLevel = basePrice * (1 - (gridSpacingPct / 100) * i)
    const sellLevel = basePrice * (1 + (gridSpacingPct / 100) * i)

    // Buy at grid level
    if (currentPrice <= buyLevel && !strategy.gridBoughtLevels.has(i)) {
      const quantity = perGridAmount / currentPrice
      if (perGridAmount >= 5) {
        try {
          const legKind = strategy.gridBoughtLevels.size > 0 ? 'ADD' : 'ENTER'
          const order = await strategy.client.marketBuy(strategy.symbol, quantity.toFixed(6), `dh-grid-buy-${i}-${Date.now()}`)
          const fee = perGridAmount * (strategy.feePct / 100)
          const actualQty = (perGridAmount - fee) / buyLevel
          const executedAt = new Date()
          strategy.gridBoughtLevels.set(i, { price: buyLevel, qty: actualQty, date: executedAt.toISOString() })
          strategy.currentCapital = Math.max(0, strategy.currentCapital - perGridAmount)
          await recordExecutionLegSafely({
            activeStrategyId: strategy.dbId,
            strategyId: strategy.strategyId,
            strategyType: strategy.strategyType,
            symbol: strategy.symbol,
            kind: legKind,
            idempotencyKey: `${strategy.exchange}:${order.orderId}`,
            orderId: order.orderId,
            price: buyLevel,
            quantity: actualQty,
            notional: perGridAmount,
            fee,
            executedAt,
            metadata: { source: 'grid', level: i, gridSpacingPct },
          })
          log(`[StrategyRunner] Grid buy level ${i}: ${strategy.name} @ ${buyLevel.toFixed(2)}`)
        } catch (err) {
          logError(`[StrategyRunner] Grid buy failed:`, err)
        }
      }
    }

    // Sell at grid level
    if (currentPrice >= sellLevel) {
      const buyInfo = strategy.gridBoughtLevels.get(i)
      if (buyInfo) {
        try {
          const baseCoin = strategy.symbol.replace('USDT', '')
          const balance = await strategy.client.getCoinBalance(baseCoin)
          if (balance >= buyInfo.qty) {
            const order = await strategy.client.marketSell(strategy.symbol, buyInfo.qty.toFixed(6), `dh-grid-sell-${i}-${Date.now()}`)
            const sellValue = buyInfo.qty * sellLevel
            const exitFee = sellValue * (strategy.feePct / 100)
            const grossProfit = sellValue - perGridAmount
            const netProfit = grossProfit - exitFee
            strategy.currentCapital += sellValue - exitFee
            strategy.totalPnl += netProfit
            strategy.totalTrades++
            if (netProfit > 0) strategy.winningTrades++

            strategy.gridBoughtLevels.delete(i)
            await recordExecutionLegSafely({
              activeStrategyId: strategy.dbId,
              strategyId: strategy.strategyId,
              strategyType: strategy.strategyType,
              symbol: strategy.symbol,
              kind: strategy.gridBoughtLevels.size === 0 ? 'EXIT' : 'REDUCE',
              idempotencyKey: `${strategy.exchange}:${order.orderId}`,
              orderId: order.orderId,
              price: sellLevel,
              quantity: buyInfo.qty,
              notional: sellValue,
              fee: exitFee,
              grossPnl: grossProfit,
              netPnl: netProfit,
              metadata: { source: 'grid', level: i, gridSpacingPct },
            })
            log(`[StrategyRunner] Grid sell level ${i}: ${strategy.name} @ ${sellLevel.toFixed(2)} PnL=$${netProfit.toFixed(2)}`)
          }
        } catch (err) {
          logError(`[StrategyRunner] Grid sell failed:`, err)
        }
      }
    }
  }

  // Mark as in position if we have grid buys
  strategy.inPosition = strategy.gridBoughtLevels.size > 0
}

// ─── Hurst HCOO_LB Strategy ────────────────────────────────────────────────

async function processHurstHcooLb(strategy: RunningStrategy, coin: CoinMarket, currentPrice: number) {
  const hurstThreshold = (strategy.strategyParams.hurst_threshold as number) ?? 0.5
  const bbPeriod = (strategy.strategyParams.bb_period as number) ?? 20
  const bbStd = (strategy.strategyParams.bb_std as number) ?? 2

  const sparkline = coin.sparkline_in_7d?.price
  if (!sparkline || sparkline.length < bbPeriod) return

  // Compute Bollinger Band
  let sum = 0
  const len = sparkline.length
  for (let i = len - bbPeriod; i < len; i++) {
    sum += sparkline[i]
  }
  const ma = sum / bbPeriod

  let sumSq = 0
  for (let i = len - bbPeriod; i < len; i++) {
    sumSq += (sparkline[i] - ma) ** 2
  }
  const stdDev = Math.sqrt(sumSq / bbPeriod)

  const lowerBand = ma - bbStd * stdDev

  // Simplified Hurst approximation using R/S on recent sparkline
  // For live trading, we use a simpler approximation since we have limited data
  const recentPrices = sparkline.slice(-100) // Use last 100 data points
  let hurst: number | null = null
  if (recentPrices.length >= 30) {
    const logReturns: number[] = []
    for (let i = 1; i < recentPrices.length; i++) {
      if (recentPrices[i - 1] > 0 && recentPrices[i] > 0) {
        logReturns.push(Math.log(recentPrices[i] / recentPrices[i - 1]))
      }
    }
    if (logReturns.length >= 20) {
      // Quick R/S estimate using 2 sub-periods
      const mid = Math.floor(logReturns.length / 2)
      const rsEstimates: number[] = []
      for (const subset of [logReturns.slice(0, mid), logReturns.slice(mid)]) {
        const mean = subset.reduce((a, b) => a + b, 0) / subset.length
        let cumSum = 0
        const cumDev: number[] = []
        for (const val of subset) {
          cumSum += val - mean
          cumDev.push(cumSum)
        }
        const R = Math.max(...cumDev) - Math.min(...cumDev)
        let sumSqDiff = 0
        for (const val of subset) {
          sumSqDiff += (val - mean) ** 2
        }
        const S = Math.sqrt(sumSqDiff / subset.length)
        if (S > 0) rsEstimates.push(R / S)
      }
      if (rsEstimates.length >= 2) {
        // Approximate: H ≈ log(avg_R/S) / log(n/2) - simplified
        const avgRS = rsEstimates.reduce((a, b) => a + b, 0) / rsEstimates.length
        if (avgRS > 0) {
          hurst = Math.log(avgRS) / Math.log(mid)
          hurst = Math.max(0, Math.min(1, hurst))
        }
      }
    }
  }

  if (strategy.inPosition) {
    // Exit: price returns to MA, or Hurst regime shift
    if (currentPrice >= ma) {
      log(`[StrategyRunner] Hurst HCOO_LB exit: ${strategy.name} price ${currentPrice} >= MA ${ma.toFixed(2)}`)
      await checkExit(strategy, currentPrice, 'signal')
    } else if (hurst !== null && hurst >= hurstThreshold) {
      log(`[StrategyRunner] Hurst HCOO_LB regime shift exit: ${strategy.name} H=${hurst.toFixed(3)} >= ${hurstThreshold}`)
      await checkExit(strategy, currentPrice, 'signal')
    } else {
      await checkExit(strategy, currentPrice)
    }
  } else {
    // Entry: H < threshold (mean-reverting) AND price <= lower BB
    const hurstOk = hurst === null || hurst < hurstThreshold
    if (hurstOk && currentPrice <= lowerBand) {
      log(`[StrategyRunner] Hurst HCOO_LB entry: ${strategy.name} price ${currentPrice} <= LB ${lowerBand.toFixed(2)} H=${hurst?.toFixed(3) ?? 'N/A'}`)
      await executeBuy(strategy, currentPrice)
    }
  }
}

// ─── Common Exit Check ──────────────────────────────────────────────────────

async function checkExit(strategy: RunningStrategy, currentPrice: number, forceReason?: 'signal') {
  if (!strategy.entryPrice || !strategy.entryDate || !strategy.positionSize) return

  // Track peak for trailing stop
  if (strategy.inPosition) {
    if (!strategy.peakPrice || currentPrice > strategy.peakPrice) {
      strategy.peakPrice = currentPrice
    }
  }

  const profitPct = ((currentPrice - strategy.entryPrice) / strategy.entryPrice) * 100
  const entryTime = new Date(strategy.entryDate).getTime()
  const holdingHours = (Date.now() - entryTime) / (1000 * 60 * 60)

  let exitReason: 'take_profit' | 'stop_loss' | 'time_stop' | 'signal' | null = forceReason || null
  let exitPrice = currentPrice

  if (forceReason) {
    exitPrice = currentPrice
  } else if (profitPct <= -strategy.stopLossPct) {
    exitReason = 'stop_loss'
    exitPrice = strategy.entryPrice * (1 - strategy.stopLossPct / 100)
  } else if (
    strategy.trailingStopPct > 0 &&
    strategy.peakPrice &&
    strategy.peakPrice > strategy.entryPrice &&
    ((strategy.peakPrice - currentPrice) / strategy.peakPrice) * 100 >= strategy.trailingStopPct
  ) {
    exitReason = 'take_profit'
    exitPrice = currentPrice
  } else if (profitPct >= strategy.takeProfitPct) {
    exitReason = 'take_profit'
    exitPrice = strategy.entryPrice * (1 + strategy.takeProfitPct / 100)
  } else if (holdingHours >= strategy.maxHoldingHours) {
    exitReason = 'time_stop'
    exitPrice = currentPrice
  }

  if (!exitReason) return

  log(`[StrategyRunner] EXIT signal: ${strategy.name} reason=${exitReason} profitPct=${profitPct.toFixed(2)}%`)

  // Place market sell order
  try {
    const baseCoin = strategy.symbol.replace('USDT', '')
    const balance = await strategy.client.getCoinBalance(baseCoin)
    const sellQty = Math.max(balance, 0)

    if (sellQty <= 0) {
      warn(`[StrategyRunner] No ${baseCoin} balance to sell for ${strategy.name}`)
      strategy.inPosition = false
      strategy.entryPrice = null
      strategy.entryDate = null
      strategy.positionSize = null
      return
    }

    const order = await strategy.client.marketSell(
      strategy.symbol,
      sellQty.toFixed(6),
      `dh-sell-${strategy.strategyId}-${Date.now()}`
    )

    await new Promise(r => setTimeout(r, 2000))
    const history = await strategy.client.getOrderHistory(strategy.symbol, 1)
    const fillOrder = history.find(o => o.orderId === order.orderId)
    const actualExitPrice = fillOrder ? Number(fillOrder.avgPrice || fillOrder.price) : exitPrice

    const actualProfitPct = ((actualExitPrice - strategy.entryPrice) / strategy.entryPrice) * 100
    const entryFee = strategy.positionSize * (strategy.feePct / 100)
    const exitValue = strategy.positionSize * (1 + actualProfitPct / 100)
    const exitFee = exitValue * (strategy.feePct / 100)
    const totalFees = entryFee + exitFee
    const grossPnl = strategy.positionSize * (actualProfitPct / 100)
    const netPnl = grossPnl - totalFees
    const netProfitPct = (netPnl / strategy.positionSize) * 100

    if (strategy.compound) {
      strategy.currentCapital = Math.max(1, strategy.currentCapital + netPnl)
    }

    strategy.totalPnl += netPnl
    strategy.totalTrades++
    if (netProfitPct > 0) strategy.winningTrades++

    const capitalAfter = strategy.currentCapital
    const savedEntryPrice = strategy.entryPrice
    const savedPositionSize = strategy.positionSize

    strategy.inPosition = false
    strategy.entryPrice = null
    strategy.entryDate = null
    strategy.positionSize = null

    const [savedTrade] = await db.$transaction([
      db.tradeLog.create({
        data: {
          activeStrategyId: strategy.dbId,
          mode: strategy.mode,
          coinId: strategy.coinId,
          symbol: strategy.symbol,
          side: 'sell',
          entryPrice: savedEntryPrice,
          exitPrice: actualExitPrice,
          exitDate: new Date().toISOString(),
          exitReason,
          quantity: sellQty,
          positionSize: savedPositionSize || 0,
          profitPct: actualProfitPct,
          netProfitPct,
          feesPaid: totalFees,
          capitalAfter,
          orderId: order.orderId,
          orderStatus: 'Filled',
        },
      }),
      db.activeStrategy.update({
        where: { id: strategy.dbId },
        data: { inPosition: false, entryPrice: null, entryDate: null, positionSize: null, currentCapital: capitalAfter, totalPnl: strategy.totalPnl, totalTrades: strategy.totalTrades, winningTrades: strategy.winningTrades, lastTradeAt: new Date().toISOString(), errorMessage: null },
      }),
    ])

    try {
      await recordExecutionLeg({
        activeStrategyId: strategy.dbId,
        strategyId: strategy.strategyId,
        strategyType: strategy.strategyType,
        symbol: strategy.symbol,
        kind: 'EXIT',
        idempotencyKey: `${strategy.exchange}:${order.orderId}`,
        orderId: order.orderId,
        tradeLogId: savedTrade.id,
        price: actualExitPrice,
        quantity: sellQty,
        notional: exitValue,
        fee: exitFee,
        grossPnl,
        netPnl,
        metadata: { source: 'common-exit', exitReason, totalFees },
      })
    } catch (telemetryError) {
      logError('[StrategyRunner] Execution telemetry failed after SELL:', telemetryError)
    }

    log(`[StrategyRunner] SELL executed: ${strategy.symbol} @${actualExitPrice.toFixed(4)} PnL=${netPnl.toFixed(2)} reason=${exitReason}`)

  } catch (err) {
    logError(`[StrategyRunner] SELL order failed for ${strategy.symbol}:`, err)
    await db.activeStrategy.update({
      where: { id: strategy.dbId },
      data: { errorMessage: `Błąd sprzedaży: ${err instanceof Error ? err.message : 'Unknown'}` },
    })
  }
}

// ─── Common Buy Execution ───────────────────────────────────────────────────

async function executeBuy(strategy: RunningStrategy, currentPrice: number) {
  const positionSize = strategy.compound ? strategy.currentCapital : strategy.initialCapital
  const quantity = positionSize / currentPrice

  if (positionSize < 5) {
    warn(`[StrategyRunner] Position too small ($${positionSize.toFixed(2)}) for ${strategy.symbol}`)
    return
  }

  try {
    const order = await strategy.client.marketBuy(
      strategy.symbol,
      quantity.toFixed(6),
      `dh-buy-${strategy.strategyId}-${Date.now()}`
    )

    log(`[StrategyRunner] BUY order placed: ${strategy.symbol} qty=${quantity.toFixed(6)} ~$${positionSize.toFixed(2)} orderId=${order.orderId}`)

    await new Promise(r => setTimeout(r, 2000))
    const history = await strategy.client.getOrderHistory(strategy.symbol, 1)
    const fillOrder = history.find(o => o.orderId === order.orderId)
    const fillPrice = fillOrder ? Number(fillOrder.avgPrice || fillOrder.price) : currentPrice

    strategy.inPosition = true
    strategy.entryPrice = fillPrice
    strategy.entryDate = new Date().toISOString()
    strategy.positionSize = positionSize
    strategy.peakPrice = fillPrice

    const [savedTrade] = await db.$transaction([
      db.tradeLog.create({
        data: {
          activeStrategyId: strategy.dbId,
          mode: strategy.mode,
          coinId: strategy.coinId,
          symbol: strategy.symbol,
          side: 'buy',
          entryPrice: fillPrice,
          entryDate: strategy.entryDate,
          quantity,
          positionSize,
          orderId: order.orderId,
          orderStatus: 'Filled',
        },
      }),
      db.activeStrategy.update({
        where: { id: strategy.dbId },
        data: { inPosition: true, entryPrice: fillPrice, entryDate: strategy.entryDate, positionSize, lastTradeAt: strategy.entryDate, errorMessage: null },
      }),
    ])

    try {
      await recordExecutionLeg({
        activeStrategyId: strategy.dbId,
        strategyId: strategy.strategyId,
        strategyType: strategy.strategyType,
        symbol: strategy.symbol,
        kind: 'ENTER',
        idempotencyKey: `${strategy.exchange}:${order.orderId}`,
        orderId: order.orderId,
        tradeLogId: savedTrade.id,
        price: fillPrice,
        quantity,
        notional: positionSize,
        fee: positionSize * (strategy.feePct / 100),
        metadata: { source: 'common-entry' },
      })
    } catch (telemetryError) {
      logError('[StrategyRunner] Execution telemetry failed after BUY:', telemetryError)
    }

  } catch (err) {
    logError(`[StrategyRunner] BUY order failed for ${strategy.symbol}:`, err)
    await db.activeStrategy.update({
      where: { id: strategy.dbId },
      data: { errorMessage: `Błąd kupna: ${err instanceof Error ? err.message : 'Unknown'}` },
    })
  }
}

// ─── Initialize on Server Start ─────────────────────────────────────────────

/** Resume any strategies that were running when the server shut down */
export async function resumeActiveStrategies() {
  const activeStrategies = await db.activeStrategy.findMany({
    where: { status: 'running' },
  })

  if (activeStrategies.length === 0) return

  log(`[StrategyRunner] Resuming ${activeStrategies.length} active strategies...`)

  for (const record of activeStrategies) {
    try {
      const client = await createExchangeClient(record.exchange || 'bybit', record.mode)
      const key = `${record.strategyId}:${record.mode}`

      let parsedParams: Record<string, unknown> = {}
      try {
        parsedParams = record.strategyParams ? JSON.parse(record.strategyParams) : {}
      } catch {}

      const running: RunningStrategy = {
        dbId: record.id,
        strategyId: record.strategyId,
        name: record.name,
        coinId: record.coinId,
        symbol: record.symbol,
        mode: record.mode as BybitMode,
        exchange: record.exchange,
        strategyType: record.strategyType || 'dip_buying',
        strategyParams: parsedParams,
        dipThreshold1h: record.dipThreshold1h,
        dipThreshold24h: record.dipThreshold24h,
        takeProfitPct: record.takeProfitPct,
        stopLossPct: record.stopLossPct,
        maxHoldingHours: record.maxHoldingHours,
        feePct: record.feePct,
        initialCapital: record.initialCapital,
        compound: record.compound,
        currentCapital: record.currentCapital,
        totalPnl: record.totalPnl,
        totalTrades: record.totalTrades,
        winningTrades: record.winningTrades,
        inPosition: record.inPosition,
        entryPrice: record.entryPrice,
        entryDate: record.entryDate,
        positionSize: record.positionSize,
        peakPrice: record.entryPrice,
        trailingStopPct: Number(parsedParams.trailing_stop_pct ?? 0),
        client,
        lastPrice: null,
        lastPriceTime: null,
        price1hAgo: null,
        volumeSamples: [],
        dcaTotalSpent: 0,
        dcaTotalQuantity: 0,
        dcaLastBuyTime: null,
        gridBoughtLevels: new Map(),
      }

      runningStrategies.set(key, running)
      log(`[StrategyRunner] Resumed: ${record.name} (${record.strategyType || 'dip_buying'}, ${record.mode})`)
    } catch (err) {
      logError(`[StrategyRunner] Failed to resume ${record.name}:`, err)
      await db.activeStrategy.update({
        where: { id: record.id },
        data: { status: 'error', errorMessage: `Resume failed: ${err instanceof Error ? err.message : 'Unknown'}` },
      })
    }
  }

  if (runningStrategies.size > 0) {
    startPolling()
  }
}
