import { fetchMarketChart } from './coingecko'
import { db } from './db'
import {
  claimNextLearningJob,
  completeLearningJob,
  deferLearningJob,
  failLearningJob,
  recoverStaleLearningJobs,
} from './strategy-learning-store'
import { calculateLongReturnPct } from './strategy-outcomes'

const MAX_HISTORICAL_POINT_DISTANCE_MS = 70 * 60_000
let backfillQueue = Promise.resolve()
let drainScheduled = false

export interface HistoricalPricePoint {
  timestampMs: number
  price: number
}

export function selectNearestHistoricalPrice(
  prices: ReadonlyArray<readonly [number, number]>,
  targetAt: Date,
  maxDistanceMs = MAX_HISTORICAL_POINT_DISTANCE_MS,
): HistoricalPricePoint | null {
  const targetMs = targetAt.getTime()
  let nearest: HistoricalPricePoint | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const [timestampMs, price] of prices) {
    if (!Number.isFinite(timestampMs) || !Number.isFinite(price) || price <= 0) continue
    const distance = Math.abs(timestampMs - targetMs)
    if (distance < nearestDistance) {
      nearest = { timestampMs, price }
      nearestDistance = distance
    }
  }
  return nearest && nearestDistance <= maxDistanceMs ? nearest : null
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function drainOutcomeBackfillJobs(): Promise<void> {
  await recoverStaleLearningJobs()
  while (true) {
    const job = await claimNextLearningJob('OUTCOME_BACKFILL')
    if (!job) return
    try {
      const payload = parseObject(job.payloadJson)
      const horizon = typeof payload.horizon === 'string' ? payload.horizon : null
      const targetAtRaw = typeof payload.targetAt === 'string' ? payload.targetAt : null
      if (!horizon || !targetAtRaw) {
        throw new Error('Outcome backfill payload is missing horizon or targetAt')
      }
      const targetAt = new Date(targetAtRaw)
      if (!Number.isFinite(targetAt.getTime())) {
        throw new Error('Outcome backfill targetAt is invalid')
      }

      const decision = await db.strategyDecision.findUnique({
        where: { id: job.entityId },
        include: { snapshot: true, outcomes: true },
      })
      if (!decision || !decision.snapshot) {
        throw new Error('Outcome backfill decision or entry snapshot is missing')
      }
      if (decision.outcomes.some(item => item.horizon === horizon)) {
        await completeLearningJob(job.id, job.lockToken)
        continue
      }

      const sourceData = parseObject(decision.sourceDataJson)
      const coinId = typeof sourceData.coinId === 'string' ? sourceData.coinId : null
      if (!coinId) {
        throw new Error('Decision does not contain a CoinGecko coinId')
      }

      const ageDays = Math.ceil(
        Math.max(0, Date.now() - targetAt.getTime()) / (24 * 60 * 60_000),
      )
      const chart = await fetchMarketChart(
        coinId,
        Math.min(90, Math.max(2, ageDays + 1)),
        true,
        10 * 60_000,
      )
      const point = selectNearestHistoricalPrice(chart.prices, targetAt)
      if (!point) {
        await deferLearningJob(
          job,
          'No sufficiently close historical price point is available yet',
          new Date(Date.now() + 60 * 60_000),
        )
        continue
      }

      const observedAt = new Date(point.timestampMs)
      const observationLagMs = observedAt.getTime() - targetAt.getTime()
      await db.tradeOutcome.upsert({
        where: {
          decisionId_horizon: {
            decisionId: decision.id,
            horizon,
          },
        },
        update: {},
        create: {
          decisionId: decision.id,
          horizon,
          returnPct: calculateLongReturnPct(decision.snapshot.price, point.price),
          price: point.price,
          targetAt,
          observedAt,
          observationLagMs,
          priceSource: 'coingecko-market-chart-hourly',
          isValid: true,
          evaluatedAt: new Date(),
        },
      })
      await completeLearningJob(job.id, job.lockToken)
    } catch (error) {
      await failLearningJob(job, error)
    }
  }
}

export function enqueueOutcomeBackfillDrain(): void {
  if (drainScheduled) return
  drainScheduled = true
  backfillQueue = backfillQueue
    .then(() => drainOutcomeBackfillJobs())
    .catch(error => {
      console.error('[StrategyOutcomes] Backfill queue failed:', error)
    })
    .finally(() => {
      drainScheduled = false
    })
}

export async function resumeOutcomeBackfillJobs(): Promise<void> {
  await recoverStaleLearningJobs()
  enqueueOutcomeBackfillDrain()
}
