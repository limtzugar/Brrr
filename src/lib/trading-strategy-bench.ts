import { z } from 'zod'
import { db } from './db'
import { sha256, stableJson } from './strategy-learning-store'

export const STRATEGY_BENCH_VERSION = 'trading-strategy-bench-v1'

const finiteNumber = z.number().finite()

export const strategyRuleSchema = z.object({
  feature: z.string().min(1).max(100),
  operator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ', 'CROSS_ABOVE', 'CROSS_BELOW']),
  value: finiteNumber,
})

export const strategyArtifactSchema = z.object({
  schemaVersion: z.literal('strategy-artifact-v1'),
  strategyType: z.string().min(1).max(100),
  symbol: z.string().max(30).nullable(),
  direction: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
  entryRules: z.array(strategyRuleSchema).max(20),
  exitRules: z.array(strategyRuleSchema).max(20),
  risk: z.object({
    stopLossPct: finiteNumber.positive().max(50),
    takeProfitPct: finiteNumber.positive().max(500),
    maxHoldingHours: finiteNumber.positive().max(24 * 365),
    maxPositionPct: finiteNumber.positive().max(100),
  }).nullable(),
  provenance: z.object({
    convictionId: z.string().optional(),
    invocationId: z.string().nullable().optional(),
    evidence: z.array(z.string().max(1_000)).max(50),
    invalidators: z.array(z.string().max(1_000)).max(50),
  }),
})

export type StrategyArtifact = z.infer<typeof strategyArtifactSchema>

export function parseStrategyArtifact(value: unknown): StrategyArtifact {
  return strategyArtifactSchema.parse(value)
}

export interface VerificationMetrics {
  sampleCount: number
  foldCount: number
  profitableFoldRatio: number
  meanReturnPct: number
  confidenceLower95: number
  maxDrawdownPct: number
  feeStressMeanReturnPct: number
  invalidLabelCount: number
  simulatorErrorCount: number
  trainMeanReturnPct?: number
}

export interface PromotionPolicy {
  minSamples: number
  minFolds: number
  minProfitableFoldRatio: number
  minConfidenceLower95: number
  maxDrawdownPct: number
  minFeeStressMeanReturnPct: number
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  minSamples: 100,
  minFolds: 4,
  minProfitableFoldRatio: 0.75,
  minConfidenceLower95: 0,
  maxDrawdownPct: 20,
  minFeeStressMeanReturnPct: 0,
}

export type VerificationFailureClass =
  | 'INVALID_LABELS'
  | 'SIMULATOR_ERROR'
  | 'INSUFFICIENT_DATA'
  | 'OVERFIT'
  | 'UNSTABLE'
  | 'RISK_LIMIT'
  | 'FEE_FRAGILE'
  | null

export interface PromotionDecision {
  eligible: boolean
  failureClass: VerificationFailureClass
  reasons: string[]
}

export function evaluatePromotion(
  metrics: VerificationMetrics,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
): PromotionDecision {
  const reasons: string[] = []

  if (metrics.invalidLabelCount > 0) {
    return {
      eligible: false,
      failureClass: 'INVALID_LABELS',
      reasons: [`${metrics.invalidLabelCount} outcome labels failed timestamp/source validation`],
    }
  }
  if (metrics.simulatorErrorCount > 0) {
    return {
      eligible: false,
      failureClass: 'SIMULATOR_ERROR',
      reasons: [`${metrics.simulatorErrorCount} verifier/simulator errors occurred`],
    }
  }
  if (metrics.sampleCount < policy.minSamples || metrics.foldCount < policy.minFolds) {
    return {
      eligible: false,
      failureClass: 'INSUFFICIENT_DATA',
      reasons: [
        `requires at least ${policy.minSamples} samples and ${policy.minFolds} folds`,
      ],
    }
  }
  if (
    metrics.trainMeanReturnPct !== undefined
    && metrics.trainMeanReturnPct > 0
    && metrics.meanReturnPct <= 0
  ) {
    return {
      eligible: false,
      failureClass: 'OVERFIT',
      reasons: ['positive training return did not survive hidden validation data'],
    }
  }
  if (
    metrics.profitableFoldRatio < policy.minProfitableFoldRatio
    || metrics.confidenceLower95 <= policy.minConfidenceLower95
  ) {
    return {
      eligible: false,
      failureClass: 'UNSTABLE',
      reasons: ['edge is not stable across folds or its 95% lower bound is not positive'],
    }
  }
  if (metrics.maxDrawdownPct > policy.maxDrawdownPct) {
    reasons.push(`drawdown ${metrics.maxDrawdownPct}% exceeds ${policy.maxDrawdownPct}%`)
  }
  if (reasons.length > 0) {
    return { eligible: false, failureClass: 'RISK_LIMIT', reasons }
  }
  if (metrics.feeStressMeanReturnPct <= policy.minFeeStressMeanReturnPct) {
    return {
      eligible: false,
      failureClass: 'FEE_FRAGILE',
      reasons: ['edge disappears under stressed fees and slippage'],
    }
  }
  return {
    eligible: true,
    failureClass: null,
    reasons: ['passed hidden folds, uncertainty, risk, and fee-stress gates'],
  }
}

export interface DraftHypothesisInput {
  convictionId?: string
  invocationId?: string | null
  provider?: string | null
  model?: string | null
  strategyType: string
  symbol?: string | null
  direction?: string | null
  pattern: string
  rationale: string
  evidence?: string[]
  invalidators?: string[]
}

export async function createDraftExperimentFromHypothesis(
  input: DraftHypothesisInput,
): Promise<string> {
  const direction = input.direction === 'LONG' || input.direction === 'SHORT'
    ? input.direction
    : 'NEUTRAL'
  const artifact = parseStrategyArtifact({
    schemaVersion: 'strategy-artifact-v1',
    strategyType: input.strategyType,
    symbol: input.symbol ?? null,
    direction,
    // Analyst hypotheses are preserved as drafts. Rules remain empty until an
    // explicit compiler produces a validated declarative artifact.
    entryRules: [],
    exitRules: [],
    risk: null,
    provenance: {
      convictionId: input.convictionId,
      invocationId: input.invocationId ?? null,
      evidence: input.evidence ?? [],
      invalidators: input.invalidators ?? [],
    },
  })
  const artifactJson = stableJson(artifact)
  const artifactHash = sha256(artifactJson)
  const experimentKey = sha256(stableJson({
    invocationId: input.invocationId ?? null,
    strategyType: input.strategyType,
    symbol: input.symbol ?? null,
    pattern: input.pattern,
    artifactHash,
  }))
  const experiment = await db.strategyExperiment.upsert({
    where: { experimentKey },
    update: {},
    create: {
      experimentKey,
      hypothesis: `${input.pattern}\n\n${input.rationale}`.slice(0, 4_000),
      source: 'LLM_ANALYST',
      strategyType: input.strategyType,
      symbol: input.symbol ?? null,
      status: 'DRAFT',
      artifactJson,
      artifactHash,
      datasetVersion: 'pending:market-snapshots-v2',
      trainWindowJson: '{}',
      validationWindowJson: '{}',
      verifierVersion: STRATEGY_BENCH_VERSION,
      promptVersion: 'llm-analyst-v1',
      provider: input.provider ?? null,
      model: input.model ?? null,
      resultJson: stableJson({
        state: 'AWAITING_ARTIFACT_COMPILATION',
        safeguards: ['NO_LIVE_EXECUTION', 'HIDDEN_VALIDATION_REQUIRED'],
      }),
    },
  })
  return experiment.id
}
