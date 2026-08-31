import { createHash, randomUUID } from 'node:crypto'
import { db } from './db'

export const STRATEGY_ALGORITHM_VERSION = 'strategy-runner-v2'
export const FEATURE_SCHEMA_VERSION = 'market-features-v2'

type JsonRecord = Record<string, unknown>

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeJson(nested)]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function buildTacticRunKey(input: {
  activeStrategyId: string
  algorithmVersion: string
  parametersHash: string
}): string {
  return sha256([
    input.activeStrategyId,
    input.algorithmVersion,
    input.parametersHash,
  ].join(':'))
}

export function buildDecisionEventKey(
  activeStrategyId: string,
  decidedAt: Date,
  action = 'DECISION',
): string {
  // Strategy runner polls once per minute. Bucketing prevents duplicate decisions
  // after retries while retaining a complete, ordered decision stream.
  return `${activeStrategyId}:${decidedAt.toISOString().slice(0, 16)}:${action}`
}

export async function enqueueLearningJob(input: {
  dedupeKey: string
  type: string
  entityType: string
  entityId: string
  payload?: JsonRecord
  maxAttempts?: number
  availableAt?: Date
}): Promise<string> {
  const job = await db.learningJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      dedupeKey: input.dedupeKey,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadJson: stableJson(input.payload ?? {}),
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: input.availableAt ?? new Date(),
    },
  })
  return job.id
}

export interface ClaimedLearningJob {
  id: string
  dedupeKey: string
  type: string
  entityType: string
  entityId: string
  payloadJson: string
  attempts: number
  maxAttempts: number
  lockToken: string
}

export async function recoverStaleLearningJobs(
  now = new Date(),
  leaseMs = 5 * 60_000,
): Promise<number> {
  const staleBefore = new Date(now.getTime() - leaseMs)
  const result = await db.learningJob.updateMany({
    where: {
      status: 'RUNNING',
      lockedAt: { lt: staleBefore },
      completedAt: null,
    },
    data: {
      status: 'RETRY',
      lockedAt: null,
      lockToken: null,
      availableAt: now,
      lastError: 'Worker lease expired; job recovered after restart',
    },
  })
  return result.count
}

export async function claimNextLearningJob(
  type: string,
  now = new Date(),
): Promise<ClaimedLearningJob | null> {
  const candidate = await db.learningJob.findFirst({
    where: {
      type,
      status: { in: ['PENDING', 'RETRY'] },
      availableAt: { lte: now },
      completedAt: null,
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
  })
  if (!candidate || candidate.attempts >= candidate.maxAttempts) return null

  const lockToken = randomUUID()
  const claimed = await db.learningJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: ['PENDING', 'RETRY'] },
      lockToken: null,
    },
    data: {
      status: 'RUNNING',
      attempts: { increment: 1 },
      lockedAt: now,
      lockToken,
      lastError: null,
    },
  })
  if (claimed.count !== 1) return null

  return {
    id: candidate.id,
    dedupeKey: candidate.dedupeKey,
    type: candidate.type,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    payloadJson: candidate.payloadJson,
    attempts: candidate.attempts + 1,
    maxAttempts: candidate.maxAttempts,
    lockToken,
  }
}

export async function completeLearningJob(
  jobId: string,
  lockToken: string,
): Promise<boolean> {
  const result = await db.learningJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockToken },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      lockedAt: null,
      lockToken: null,
      lastError: null,
    },
  })
  return result.count === 1
}

export async function failLearningJob(
  job: ClaimedLearningJob,
  error: unknown,
  now = new Date(),
): Promise<boolean> {
  const isDead = job.attempts >= job.maxAttempts
  const backoffMs = Math.min(60 * 60_000, 2 ** job.attempts * 30_000)
  const message = error instanceof Error ? error.message : String(error)
  const result = await db.learningJob.updateMany({
    where: { id: job.id, status: 'RUNNING', lockToken: job.lockToken },
    data: {
      status: isDead ? 'DEAD' : 'RETRY',
      availableAt: new Date(now.getTime() + backoffMs),
      completedAt: isDead ? now : null,
      lockedAt: null,
      lockToken: null,
      lastError: message.slice(0, 2_000),
    },
  })
  return result.count === 1
}

export async function deferLearningJob(
  job: ClaimedLearningJob,
  reason: string,
  availableAt = new Date(Date.now() + 15 * 60_000),
): Promise<boolean> {
  const result = await db.learningJob.updateMany({
    where: { id: job.id, status: 'RUNNING', lockToken: job.lockToken },
    data: {
      status: 'RETRY',
      attempts: { decrement: 1 },
      availableAt,
      lockedAt: null,
      lockToken: null,
      lastError: reason.slice(0, 2_000),
    },
  })
  return result.count === 1
}

export interface ExecutionLegInput {
  activeStrategyId: string
  strategyId: string
  strategyType: string
  symbol: string
  kind: 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT'
  idempotencyKey: string
  orderId?: string
  tradeLogId?: string
  decisionId?: string
  price: number
  quantity: number
  notional: number
  fee: number
  executedAt?: Date
  grossPnl?: number
  netPnl?: number
  metadata?: JsonRecord
}

export async function recordExecutionLeg(input: ExecutionLegInput): Promise<string> {
  const executedAt = input.executedAt ?? new Date()
  const existing = await db.tradeLeg.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  })
  if (existing) return existing.id

  return db.$transaction(async tx => {
    let episode = await tx.tradeEpisode.findFirst({
      where: {
        activeStrategyId: input.activeStrategyId,
        symbol: input.symbol,
        status: 'OPEN',
      },
      orderBy: { openedAt: 'desc' },
    })

    if (!episode) {
      const run = await tx.tacticRun.findFirst({
        where: { activeStrategyId: input.activeStrategyId, status: 'RUNNING' },
        orderBy: { startedAt: 'desc' },
      })
      episode = await tx.tradeEpisode.create({
        data: {
          episodeKey: `${input.activeStrategyId}:${input.orderId ?? input.idempotencyKey}`,
          tacticRunId: run?.id,
          activeStrategyId: input.activeStrategyId,
          strategyId: input.strategyId,
          strategyType: input.strategyType,
          symbol: input.symbol,
          status: input.kind === 'EXIT' ? 'CLOSED' : 'OPEN',
          entryPrice: input.kind === 'EXIT' ? null : input.price,
          exitPrice: input.kind === 'EXIT' ? input.price : null,
          quantity: input.quantity,
          grossPnl: input.grossPnl,
          netPnl: input.netPnl,
          feesPaid: input.fee,
          openedAt: executedAt,
          closedAt: input.kind === 'EXIT' ? executedAt : null,
        },
      })
    }

    const leg = await tx.tradeLeg.create({
      data: {
        episodeId: episode.id,
        idempotencyKey: input.idempotencyKey,
        decisionId: input.decisionId,
        tradeLogId: input.tradeLogId,
        kind: input.kind,
        orderId: input.orderId,
        price: input.price,
        quantity: input.quantity,
        notional: input.notional,
        fee: input.fee,
        executedAt,
        metadataJson: stableJson(input.metadata ?? {}),
      },
    })

    const aggregate = await tx.tradeLeg.aggregate({
      where: { episodeId: episode.id },
      _sum: { fee: true },
    })
    await tx.tradeEpisode.update({
      where: { id: episode.id },
      data: {
        status: input.kind === 'EXIT' ? 'CLOSED' : 'OPEN',
        exitPrice: input.kind === 'EXIT' ? input.price : episode.exitPrice,
        quantity: input.kind === 'ENTER' ? input.quantity : episode.quantity,
        grossPnl: input.grossPnl ?? episode.grossPnl,
        netPnl: input.netPnl ?? episode.netPnl,
        feesPaid: aggregate._sum.fee ?? 0,
        closedAt: input.kind === 'EXIT' ? executedAt : episode.closedAt,
      },
    })
    return leg.id
  })
}
