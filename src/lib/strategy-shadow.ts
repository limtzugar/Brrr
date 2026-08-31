import { randomUUID } from 'node:crypto'
import { db } from './db'
import { callLlm } from './llm-client'
import { getLlmConfigPublic } from './llm-config'
import { markLlmInvocationError } from './llm-invocation'
import {
  getStrategyShadowSystemPrompt,
  parseStrategyShadowResponse,
  STRATEGY_SHADOW_PROMPT_VERSION,
} from './strategy-shadow-contract'
import {
  claimNextLearningJob,
  completeLearningJob,
  deferLearningJob,
  enqueueLearningJob,
  failLearningJob,
  recoverStaleLearningJobs,
} from './strategy-learning-store'
import { resumeOutcomeBackfillJobs } from './strategy-outcome-backfill'

let shadowQueue = Promise.resolve()
let drainScheduled = false

async function isShadowModeEnabled(): Promise<boolean> {
  const setting = await db.appSettings.findUnique({
    where: { key: 'llm_shadow_enabled' },
  })
  return setting?.value !== 'false'
}

async function prepareEvaluation(decisionId: string): Promise<void> {
  await db.shadowEvaluation.upsert({
    where: { decisionId },
    update: {
      status: 'PENDING',
      attempts: { increment: 1 },
      errorMessage: null,
      completedAt: null,
    },
    create: {
      id: randomUUID(),
      decisionId,
      status: 'PENDING',
      promptVersion: STRATEGY_SHADOW_PROMPT_VERSION,
    },
  })
}

async function markEvaluationError(decisionId: string, message: string): Promise<void> {
  await db.$executeRaw`
    UPDATE ShadowEvaluation
    SET status = 'ERROR', errorMessage = ${message.slice(0, 2_000)},
        completedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
    WHERE decisionId = ${decisionId}
  `
}

async function evaluateStrategyDecision(
  decisionId: string,
): Promise<'DONE' | 'DEFER'> {
  if (!await isShadowModeEnabled()) return 'DONE'

  const config = await getLlmConfigPublic()
  if (!config.isConfigured) return 'DEFER'
  await prepareEvaluation(decisionId)

  try {
    const decision = await db.strategyDecision.findUnique({
      where: { id: decisionId },
      include: { snapshot: true },
    })
    if (!decision || decision.action !== 'ENTER' || !decision.snapshot) {
      await markEvaluationError(decisionId, 'No decyzji ENTER lub migawki rynku')
      return 'DONE'
    }

    const context = JSON.stringify({
      decision: {
        id: decision.id,
        strategyId: decision.strategyId,
        strategyType: decision.strategyType,
        symbol: decision.symbol,
        mode: decision.mode,
        exchange: decision.exchange,
        action: decision.action,
        reason: decision.reason,
        algorithmVersion: decision.algorithmVersion,
        parameters: JSON.parse(decision.parametersJson),
        decidedAt: decision.decidedAt.toISOString(),
      },
      marketSnapshot: {
        price: decision.snapshot.price,
        priceChange1h: decision.snapshot.priceChange1h,
        priceChange24h: decision.snapshot.priceChange24h,
        priceChange7d: decision.snapshot.priceChange7d,
        volume24h: decision.snapshot.volume24h,
        marketCap: decision.snapshot.marketCap,
        high24h: decision.snapshot.high24h,
        low24h: decision.snapshot.low24h,
        features: JSON.parse(decision.snapshot.featuresJson),
      },
    })

    const result = await callLlm(
      [
        { role: 'system', content: getStrategyShadowSystemPrompt() },
        { role: 'user', content: context },
      ],
      {
        maxTokens: 1_000,
        temperature: 0.1,
        timeoutMs: 30_000,
        operation: 'strategy_shadow',
        promptVersion: STRATEGY_SHADOW_PROMPT_VERSION,
        metadata: {
          decisionId: decision.id,
          strategyType: decision.strategyType,
          symbol: decision.symbol,
        },
      },
    )

    let parsed
    try {
      parsed = parseStrategyShadowResponse(result.content)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid shadow response'
      if (result.invocationId) {
        await markLlmInvocationError(result.invocationId, message).catch(() => {})
      }
      throw error
    }

    await db.$executeRaw`
      UPDATE ShadowEvaluation
      SET status = 'COMPLETED',
          recommendation = ${parsed.recommendation},
          confidence = ${parsed.confidence},
          thesis = ${parsed.thesis},
          argumentsJson = ${JSON.stringify(parsed.arguments)},
          invalidatorsJson = ${JSON.stringify(parsed.invalidators)},
          invocationId = ${result.invocationId ?? null},
          provider = ${config.provider},
          model = ${config.model},
          errorMessage = NULL,
          completedAt = CURRENT_TIMESTAMP,
          updatedAt = CURRENT_TIMESTAMP
      WHERE decisionId = ${decisionId}
    `
    return 'DONE'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown shadow evaluation error'
    await markEvaluationError(decisionId, message).catch(() => {})
    console.error(`[StrategyShadow] Evaluation failed for ${decisionId}:`, error)
    throw error
  }
}

async function drainStrategyShadowJobs(): Promise<void> {
  await recoverStaleLearningJobs()
  while (true) {
    const job = await claimNextLearningJob('SHADOW_EVALUATION')
    if (!job) return
    try {
      const outcome = await evaluateStrategyDecision(job.entityId)
      if (outcome === 'DEFER') {
        await deferLearningJob(job, 'LLM is not configured')
      } else {
        await completeLearningJob(job.id, job.lockToken)
      }
    } catch (error) {
      await failLearningJob(job, error)
    }
  }
}

function scheduleShadowDrain(): void {
  if (drainScheduled) return
  drainScheduled = true
  shadowQueue = shadowQueue
    .then(() => drainStrategyShadowJobs())
    .catch(error => {
      console.error('[StrategyShadow] Queue error:', error)
    })
    .finally(() => {
      drainScheduled = false
    })
}

export function enqueueStrategyShadowEvaluation(decisionId: string): void {
  void enqueueLearningJob({
    dedupeKey: `shadow:${decisionId}`,
    type: 'SHADOW_EVALUATION',
    entityType: 'StrategyDecision',
    entityId: decisionId,
    payload: { decisionId },
  })
    .then(scheduleShadowDrain)
    .catch(error => {
      console.error('[StrategyShadow] Persisting queue job failed:', error)
    })
}

export async function resumeStrategyLearningJobs(): Promise<void> {
  await recoverStaleLearningJobs()
  await resumeOutcomeBackfillJobs()
  scheduleShadowDrain()
}
