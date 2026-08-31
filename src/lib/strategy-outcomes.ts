import { db } from './db'
import { enqueueLearningJob } from './strategy-learning-store'

export const OUTCOME_HORIZONS = [
  { name: '1H', delayMs: 60 * 60 * 1_000 },
  { name: '4H', delayMs: 4 * 60 * 60 * 1_000 },
  { name: '24H', delayMs: 24 * 60 * 60 * 1_000 },
] as const

export const LIVE_OUTCOME_TOLERANCE_MS = 10 * 60_000

export function normalizeTradingSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function calculateLongReturnPct(entryPrice: number, observedPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(observedPrice)) {
    throw new Error('Prices must be finite and entry price must be positive')
  }
  return ((observedPrice - entryPrice) / entryPrice) * 100
}

export function getDueOutcomeHorizons(
  decidedAt: Date,
  completedHorizons: ReadonlySet<string>,
  now: Date,
): Array<(typeof OUTCOME_HORIZONS)[number]> {
  const ageMs = now.getTime() - decidedAt.getTime()
  return OUTCOME_HORIZONS.filter(
    horizon => ageMs >= horizon.delayMs && !completedHorizons.has(horizon.name),
  )
}

export function getOutcomeTargetAt(
  decidedAt: Date,
  delayMs: number,
): Date {
  return new Date(decidedAt.getTime() + delayMs)
}

export function calculateObservationLagMs(
  targetAt: Date,
  observedAt: Date,
): number {
  return observedAt.getTime() - targetAt.getTime()
}

export function isValidLiveObservation(
  targetAt: Date,
  observedAt: Date,
  toleranceMs = LIVE_OUTCOME_TOLERANCE_MS,
): boolean {
  const lagMs = calculateObservationLagMs(targetAt, observedAt)
  return lagMs >= 0 && lagMs <= toleranceMs
}

export async function recordDueTradeOutcomes(
  currentPrices: ReadonlyMap<string, number>,
  now = new Date(),
): Promise<number> {
  const oldestDecision = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)
  const decisions = await db.strategyDecision.findMany({
    where: {
      action: 'ENTER',
      decidedAt: {
        gte: oldestDecision,
        lte: new Date(now.getTime() - OUTCOME_HORIZONS[0].delayMs),
      },
    },
    include: {
      snapshot: true,
      outcomes: true,
    },
    // Newest-first prevents a backlog of old decisions from starving labels
    // that are currently inside their narrow observation window.
    orderBy: { decidedAt: 'desc' },
    take: 2_000,
  })

  let recorded = 0
  for (const decision of decisions) {
    if (!decision.snapshot || decision.snapshot.price <= 0) continue
    const observedPrice = currentPrices.get(normalizeTradingSymbol(decision.symbol))
    if (observedPrice === undefined) continue

    const completed = new Set(decision.outcomes.map(outcome => outcome.horizon))
    const dueHorizons = getDueOutcomeHorizons(decision.decidedAt, completed, now)
    for (const horizon of dueHorizons) {
      const targetAt = getOutcomeTargetAt(decision.decidedAt, horizon.delayMs)
      const observationLagMs = calculateObservationLagMs(targetAt, now)
      if (!isValidLiveObservation(targetAt, now)) {
        await enqueueLearningJob({
          dedupeKey: `outcome-backfill:${decision.id}:${horizon.name}`,
          type: 'OUTCOME_BACKFILL',
          entityType: 'StrategyDecision',
          entityId: decision.id,
          payload: {
            decisionId: decision.id,
            horizon: horizon.name,
            symbol: decision.symbol,
            targetAt: targetAt.toISOString(),
          },
        })
        continue
      }

      const returnPct = calculateLongReturnPct(decision.snapshot.price, observedPrice)
      await db.tradeOutcome.upsert({
        where: {
          decisionId_horizon: {
            decisionId: decision.id,
            horizon: horizon.name,
          },
        },
        update: {},
        create: {
          decisionId: decision.id,
          horizon: horizon.name,
          returnPct,
          price: observedPrice,
          targetAt,
          observedAt: now,
          observationLagMs,
          priceSource: 'coingecko-live',
          isValid: true,
          evaluatedAt: now,
        },
      })
      recorded += 1
    }
  }
  return recorded
}
