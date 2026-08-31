import type { CoinMarket } from './coingecko'
import { db } from './db'
import type { StrategyAction } from './strategy-metrics'
import { deriveMarketRegime } from './market-regime'
import {
  buildDecisionEventKey,
  buildTacticRunKey,
  FEATURE_SCHEMA_VERSION,
  sha256,
  stableJson,
  STRATEGY_ALGORITHM_VERSION,
} from './strategy-learning-store'

export interface StrategyTelemetryInput {
  activeStrategyId: string
  strategyId: string
  strategyType: string
  symbol: string
  mode: string
  exchange: string
  action: StrategyAction
  reason: string
  strategyParams: Record<string, unknown>
  coin: CoinMarket
  currentPrice: number
  price1hAgo: number | null
  volumeSampleCount: number
  pnlDelta: number
}

export async function recordStrategyTelemetry(
  input: StrategyTelemetryInput,
): Promise<string> {
  const decidedAt = new Date()
  const parametersJson = stableJson(input.strategyParams)
  const parametersHash = sha256(parametersJson)
  const runKey = buildTacticRunKey({
    activeStrategyId: input.activeStrategyId,
    algorithmVersion: STRATEGY_ALGORITHM_VERSION,
    parametersHash,
  })
  const eventKey = buildDecisionEventKey(
    input.activeStrategyId,
    decidedAt,
    input.action,
  )
  const reasonCode = input.reason.split(':').at(-1) ?? input.reason
  const features = {
    price1hAgo: input.price1hAgo,
    volumeSampleCount: input.volumeSampleCount,
    regime: deriveMarketRegime(
      input.coin.price_change_percentage_24h_in_currency,
      input.coin.price_change_percentage_7d_in_currency,
    ),
  }

  const decision = await db.$transaction(async tx => {
    const tacticRun = await tx.tacticRun.upsert({
      where: { runKey },
      update: {
        status: 'RUNNING',
        endedAt: null,
      },
      create: {
        runKey,
        activeStrategyId: input.activeStrategyId,
        strategyId: input.strategyId,
        strategyType: input.strategyType,
        symbol: input.symbol,
        mode: input.mode,
        exchange: input.exchange,
        algorithmVersion: STRATEGY_ALGORITHM_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        parametersJson,
        parametersHash,
      },
    })

    const saved = await tx.strategyDecision.upsert({
      where: { eventKey },
      update: {},
      create: {
        tacticRunId: tacticRun.id,
        eventKey,
        activeStrategyId: input.activeStrategyId,
        strategyId: input.strategyId,
        strategyType: input.strategyType,
        symbol: input.symbol,
        mode: input.mode,
        exchange: input.exchange,
        action: input.action,
        reason: input.reason,
        reasonCode,
        rulesJson: stableJson([reasonCode]),
        algorithmVersion: STRATEGY_ALGORITHM_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        parametersJson,
        sourceDataJson: stableJson({
          provider: 'coingecko',
          coinId: input.coin.id,
          symbol: input.coin.symbol,
        }),
        dataTimestamp: decidedAt,
        decidedAt,
        snapshot: {
          create: {
            price: input.currentPrice,
            priceChange1h: input.coin.price_change_percentage_1h_in_currency,
            priceChange24h: input.coin.price_change_percentage_24h_in_currency,
            priceChange7d: input.coin.price_change_percentage_7d_in_currency,
            volume24h: input.coin.total_volume,
            marketCap: input.coin.market_cap,
            high24h: input.coin.high_24h,
            low24h: input.coin.low_24h,
            featuresJson: stableJson(features),
            capturedAt: decidedAt,
          },
        },
      },
    })

    if (input.action === 'ENTER') {
      await tx.learningJob.upsert({
        where: { dedupeKey: `shadow:${saved.id}` },
        update: {},
        create: {
          dedupeKey: `shadow:${saved.id}`,
          type: 'SHADOW_EVALUATION',
          entityType: 'StrategyDecision',
          entityId: saved.id,
          payloadJson: stableJson({ decisionId: saved.id }),
        },
      })
    }
    return saved
  })

  if (input.action !== 'EXIT') return decision.id

  const entryDecision = await db.strategyDecision.findFirst({
    where: {
      activeStrategyId: input.activeStrategyId,
      action: 'ENTER',
      decidedAt: { lte: decision.decidedAt },
    },
    orderBy: { decidedAt: 'desc' },
  })
  if (!entryDecision) return decision.id

  const trade = await db.tradeLog.findFirst({
    where: {
      activeStrategyId: input.activeStrategyId,
      side: 'sell',
      createdAt: { gte: entryDecision.decidedAt },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!trade) return decision.id

  await db.tradeOutcome.upsert({
    where: {
      decisionId_horizon: {
        decisionId: entryDecision.id,
        horizon: 'FINAL',
      },
    },
    update: {
      tradeLogId: trade.id,
      returnPct: trade.netProfitPct,
      netPnl: input.pnlDelta,
      price: trade.exitPrice,
      capitalAfter: trade.capitalAfter,
      targetAt: trade.createdAt,
      observedAt: trade.createdAt,
      observationLagMs: 0,
      priceSource: input.exchange,
      isValid: true,
      invalidReason: null,
      evaluatedAt: new Date(),
    },
    create: {
      decisionId: entryDecision.id,
      tradeLogId: trade.id,
      horizon: 'FINAL',
      returnPct: trade.netProfitPct,
      netPnl: input.pnlDelta,
      price: trade.exitPrice,
      capitalAfter: trade.capitalAfter,
      targetAt: trade.createdAt,
      observedAt: trade.createdAt,
      observationLagMs: 0,
      priceSource: input.exchange,
    },
  })

  return decision.id
}
