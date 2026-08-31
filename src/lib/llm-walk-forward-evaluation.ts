import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { db } from './db'
import { deriveMarketRegime, type DerivedMarketRegime } from './market-regime'

export const EVALUATION_VERSION = 'llm-walk-forward-v1'

export const walkForwardConfigSchema = z.object({
  horizon: z.enum(['1H', '4H', '24H', 'FINAL']).default('24H'),
  feePctPerSide: z.number().min(0).max(5).default(0.1),
  slippagePctPerSide: z.number().min(0).max(5).default(0.05),
  baselineLatencyMs: z.number().int().min(0).max(120_000).default(0),
  fallbackLlmLatencyMs: z.number().int().min(0).max(120_000).default(1_000),
  latencyAdverseBpsPerSecond: z.number().min(0).max(100).default(0.5),
  cautionExposure: z.number().min(0).max(1).default(0.5),
  minTrainingSamples: z.number().int().min(10).max(10_000).default(30),
  testWindowSamples: z.number().int().min(5).max(1_000).default(20),
  minFoldTestSamples: z.number().int().min(5).max(1_000).default(10),
  minPromotionSamples: z.number().int().min(30).max(100_000).default(100),
  maxObservationDelayMinutes: z.number().int().min(1).max(10_080).default(15),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).strict()

export type WalkForwardConfig = z.infer<typeof walkForwardConfigSchema>

export interface EvaluationInputRow {
  decisionId: string
  symbol: string
  strategyType: string
  decidedAt: Date | string | number
  priceChange24h: number | null
  priceChange7d: number | null
  featuresJson: string
  horizon: string
  grossReturnPct: number
  evaluatedAt: Date | string | number
  recommendation: 'ALLOW' | 'CAUTION' | 'AVOID'
  confidence: number
  llmLatencyMs: number | null
}

export interface EvaluationSample {
  decisionId: string
  symbol: string
  strategyType: string
  regime: DerivedMarketRegime
  decidedAt: string
  recommendation: 'ALLOW' | 'CAUTION' | 'AVOID'
  confidence: number
  grossReturnPct: number
  baselineReturnPct: number
  llmReturnPct: number
  deltaReturnPct: number
  exposure: number
  llmLatencyMs: number
  observationDelayMinutes: number | null
}

export interface ReturnMetrics {
  sampleCount: number
  meanReturnPct: number
  medianReturnPct: number
  compoundedReturnPct: number
  winRatePct: number
  maxDrawdownPct: number
  standardDeviationPct: number
}

export interface ConfidenceInterval {
  mean: number
  lower: number
  upper: number
  confidenceLevel: 0.95
}

export interface WalkForwardResult {
  id: string
  evaluationVersion: string
  createdAt: string
  config: WalkForwardConfig
  status: 'INSUFFICIENT_DATA' | 'NOT_PROMOTED' | 'PROMOTION_CANDIDATE'
  reasons: string[]
  sampleCount: number
  excludedLateSamples: number
  outOfSampleCount: number
  foldCount: number
  baseline: ReturnMetrics
  baselinePlusLlm: ReturnMetrics
  pairedDelta95: ConfidenceInterval | null
  folds: Array<{
    trainCount: number
    testCount: number
    testFrom: string
    testTo: string
    baseline: ReturnMetrics
    baselinePlusLlm: ReturnMetrics
  }>
  byPair: Record<string, SegmentMetrics>
  byStrategy: Record<string, SegmentMetrics>
  byRegime: Record<string, SegmentMetrics>
}

interface SegmentMetrics {
  baseline: ReturnMetrics
  baselinePlusLlm: ReturnMetrics
  meanDeltaPct: number
  pairedDelta95: ConfidenceInterval | null
}

const HORIZON_MS: Partial<Record<WalkForwardConfig['horizon'], number>> = {
  '1H': 60 * 60 * 1_000,
  '4H': 4 * 60 * 60 * 1_000,
  '24H': 24 * 60 * 60 * 1_000,
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function tCritical95(degreesOfFreedom: number): number {
  const exact: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  }
  if (exact[degreesOfFreedom]) return exact[degreesOfFreedom]
  if (degreesOfFreedom < 20) return 2.101
  if (degreesOfFreedom < 30) return 2.045
  return 1.96
}

export function confidenceInterval95(values: number[]): ConfidenceInterval | null {
  if (values.length < 2) return null
  const average = mean(values)
  const margin = tCritical95(values.length - 1) * standardDeviation(values) / Math.sqrt(values.length)
  return {
    mean: round(average),
    lower: round(average - margin),
    upper: round(average + margin),
    confidenceLevel: 0.95,
  }
}

export function computeReturnMetrics(returns: number[]): ReturnMetrics {
  if (returns.length === 0) {
    return {
      sampleCount: 0,
      meanReturnPct: 0,
      medianReturnPct: 0,
      compoundedReturnPct: 0,
      winRatePct: 0,
      maxDrawdownPct: 0,
      standardDeviationPct: 0,
    }
  }

  const sorted = [...returns].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]

  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    equity *= Math.max(0, 1 + value / 100)
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  }

  return {
    sampleCount: returns.length,
    meanReturnPct: round(mean(returns)),
    medianReturnPct: round(median),
    compoundedReturnPct: round((equity - 1) * 100),
    winRatePct: round((returns.filter(value => value > 0).length / returns.length) * 100),
    maxDrawdownPct: round(maxDrawdown),
    standardDeviationPct: round(standardDeviation(returns)),
  }
}

function exposureForRecommendation(
  recommendation: EvaluationSample['recommendation'],
  cautionExposure: number,
): number {
  if (recommendation === 'ALLOW') return 1
  if (recommendation === 'CAUTION') return cautionExposure
  return 0
}

function asDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function extractRegime(row: EvaluationInputRow): DerivedMarketRegime {
  try {
    const features = JSON.parse(row.featuresJson) as { regime?: DerivedMarketRegime }
    if (features.regime) return features.regime
  } catch {}
  return deriveMarketRegime(row.priceChange24h, row.priceChange7d)
}

export function buildEvaluationSamples(
  rows: EvaluationInputRow[],
  config: WalkForwardConfig,
): { samples: EvaluationSample[]; excludedLateSamples: number } {
  const samples: EvaluationSample[] = []
  let excludedLateSamples = 0
  const roundTripCostPct = 2 * (config.feePctPerSide + config.slippagePctPerSide)
  const baselineLatencyPenalty = (config.baselineLatencyMs / 1_000)
    * config.latencyAdverseBpsPerSecond / 100
  const horizonMs = HORIZON_MS[config.horizon]
  const fromMs = config.from ? new Date(config.from).getTime() : Number.NEGATIVE_INFINITY
  const toMs = config.to ? new Date(config.to).getTime() : Number.POSITIVE_INFINITY

  for (const row of rows) {
    const decidedAt = asDate(row.decidedAt)
    const evaluatedAt = asDate(row.evaluatedAt)
    if (!decidedAt || !evaluatedAt || decidedAt.getTime() < fromMs || decidedAt.getTime() > toMs) continue

    let observationDelayMinutes: number | null = null
    if (horizonMs !== undefined) {
      observationDelayMinutes = Math.max(
        0,
        (evaluatedAt.getTime() - decidedAt.getTime() - horizonMs) / 60_000,
      )
      if (observationDelayMinutes > config.maxObservationDelayMinutes) {
        excludedLateSamples += 1
        continue
      }
    }

    const exposure = exposureForRecommendation(row.recommendation, config.cautionExposure)
    const llmLatencyMs = row.llmLatencyMs ?? config.fallbackLlmLatencyMs
    const llmLatencyPenalty = (llmLatencyMs / 1_000)
      * config.latencyAdverseBpsPerSecond / 100
    const baselineReturnPct = row.grossReturnPct - roundTripCostPct - baselineLatencyPenalty
    const llmReturnPct = exposure * (row.grossReturnPct - roundTripCostPct - llmLatencyPenalty)

    samples.push({
      decisionId: row.decisionId,
      symbol: row.symbol,
      strategyType: row.strategyType,
      regime: extractRegime(row),
      decidedAt: decidedAt.toISOString(),
      recommendation: row.recommendation,
      confidence: row.confidence,
      grossReturnPct: round(row.grossReturnPct),
      baselineReturnPct: round(baselineReturnPct),
      llmReturnPct: round(llmReturnPct),
      deltaReturnPct: round(llmReturnPct - baselineReturnPct),
      exposure,
      llmLatencyMs,
      observationDelayMinutes: observationDelayMinutes === null ? null : round(observationDelayMinutes),
    })
  }

  return {
    samples: samples.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
    excludedLateSamples,
  }
}

function segmentMetrics(samples: EvaluationSample[]): SegmentMetrics {
  const deltas = samples.map(sample => sample.deltaReturnPct)
  return {
    baseline: computeReturnMetrics(samples.map(sample => sample.baselineReturnPct)),
    baselinePlusLlm: computeReturnMetrics(samples.map(sample => sample.llmReturnPct)),
    meanDeltaPct: round(mean(deltas)),
    pairedDelta95: confidenceInterval95(deltas),
  }
}

function groupMetrics(
  samples: EvaluationSample[],
  key: (sample: EvaluationSample) => string,
): Record<string, SegmentMetrics> {
  const groups = new Map<string, EvaluationSample[]>()
  for (const sample of samples) {
    const groupKey = key(sample)
    const group = groups.get(groupKey) || []
    group.push(sample)
    groups.set(groupKey, group)
  }
  return Object.fromEntries(
    [...groups.entries()].map(([groupKey, group]) => [groupKey, segmentMetrics(group)]),
  )
}

export function evaluateWalkForwardSamples(
  samples: EvaluationSample[],
  config: WalkForwardConfig,
  excludedLateSamples = 0,
): Omit<WalkForwardResult, 'id' | 'createdAt' | 'evaluationVersion'> {
  const folds: WalkForwardResult['folds'] = []
  const outOfSample: EvaluationSample[] = []
  let trainEnd = config.minTrainingSamples

  while (trainEnd < samples.length) {
    const test = samples.slice(trainEnd, trainEnd + config.testWindowSamples)
    if (test.length < config.minFoldTestSamples) break
    outOfSample.push(...test)
    folds.push({
      trainCount: trainEnd,
      testCount: test.length,
      testFrom: test[0].decidedAt,
      testTo: test[test.length - 1].decidedAt,
      baseline: computeReturnMetrics(test.map(sample => sample.baselineReturnPct)),
      baselinePlusLlm: computeReturnMetrics(test.map(sample => sample.llmReturnPct)),
    })
    trainEnd += test.length
  }

  const baseline = computeReturnMetrics(outOfSample.map(sample => sample.baselineReturnPct))
  const baselinePlusLlm = computeReturnMetrics(outOfSample.map(sample => sample.llmReturnPct))
  const pairedDelta95 = confidenceInterval95(outOfSample.map(sample => sample.deltaReturnPct))
  const reasons: string[] = []
  let status: WalkForwardResult['status'] = 'NOT_PROMOTED'

  if (outOfSample.length < config.minPromotionSamples) {
    status = 'INSUFFICIENT_DATA'
    reasons.push(`Za mało próbek out-of-sample: ${outOfSample.length}/${config.minPromotionSamples}.`)
  } else {
    if (!pairedDelta95 || pairedDelta95.lower <= 0) {
      reasons.push('Dolna granica 95% CI różnicy nie jest dodatnia.')
    }
    if (baselinePlusLlm.meanReturnPct <= baseline.meanReturnPct) {
      reasons.push('Średni zwrot baseline+LLM nie przewyższa baseline.')
    }
    if (baselinePlusLlm.maxDrawdownPct > baseline.maxDrawdownPct) {
      reasons.push('Baseline+LLM zwiększa maksymalny drawdown.')
    }
    if (reasons.length === 0) {
      status = 'PROMOTION_CANDIDATE'
      reasons.push('Kandydat spełnia bramki statystyczne; nadal wymaga ręcznej akceptacji.')
    }
  }

  return {
    config,
    status,
    reasons,
    sampleCount: samples.length,
    excludedLateSamples,
    outOfSampleCount: outOfSample.length,
    foldCount: folds.length,
    baseline,
    baselinePlusLlm,
    pairedDelta95,
    folds,
    byPair: groupMetrics(outOfSample, sample => sample.symbol),
    byStrategy: groupMetrics(outOfSample, sample => sample.strategyType),
    byRegime: groupMetrics(outOfSample, sample => sample.regime),
  }
}

async function loadEvaluationRows(config: WalkForwardConfig): Promise<EvaluationInputRow[]> {
  return db.$queryRaw<EvaluationInputRow[]>`
    SELECT
      decision.id AS decisionId,
      decision.symbol,
      decision.strategyType,
      decision.decidedAt,
      snapshot.priceChange24h,
      snapshot.priceChange7d,
      snapshot.featuresJson,
      outcome.horizon,
      outcome.returnPct AS grossReturnPct,
      outcome.evaluatedAt,
      evaluation.recommendation,
      evaluation.confidence,
      invocation.latencyMs AS llmLatencyMs
    FROM ShadowEvaluation evaluation
    JOIN StrategyDecision decision ON decision.id = evaluation.decisionId
    JOIN MarketSnapshot snapshot ON snapshot.decisionId = decision.id
    JOIN TradeOutcome outcome ON outcome.decisionId = decision.id
      AND outcome.horizon = ${config.horizon}
    LEFT JOIN LlmInvocation invocation ON invocation.id = evaluation.invocationId
    WHERE evaluation.status = 'COMPLETED'
      AND evaluation.recommendation IN ('ALLOW', 'CAUTION', 'AVOID')
      AND evaluation.confidence IS NOT NULL
      AND outcome.returnPct IS NOT NULL
    ORDER BY decision.decidedAt ASC
    LIMIT 10000
  `
}

export async function runWalkForwardEvaluation(input: unknown): Promise<WalkForwardResult> {
  const config = walkForwardConfigSchema.parse(input)
  const rows = await loadEvaluationRows(config)
  const { samples, excludedLateSamples } = buildEvaluationSamples(rows, config)
  const evaluated = evaluateWalkForwardSamples(samples, config, excludedLateSamples)
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const result: WalkForwardResult = {
    id,
    evaluationVersion: EVALUATION_VERSION,
    createdAt,
    ...evaluated,
  }

  await db.$executeRaw`
    INSERT INTO EvaluationRun (
      id, evaluationVersion, horizon, status, sampleCount, outOfSampleCount,
      foldCount, baselineMeanReturn, llmMeanReturn, deltaMeanReturn,
      confidenceLower95, confidenceUpper95, configJson, resultJson, completedAt
    ) VALUES (
      ${id}, ${EVALUATION_VERSION}, ${config.horizon}, ${result.status},
      ${result.sampleCount}, ${result.outOfSampleCount}, ${result.foldCount},
      ${result.baseline.meanReturnPct}, ${result.baselinePlusLlm.meanReturnPct},
      ${result.pairedDelta95?.mean ?? null}, ${result.pairedDelta95?.lower ?? null},
      ${result.pairedDelta95?.upper ?? null}, ${JSON.stringify(config)},
      ${JSON.stringify(result)}, CURRENT_TIMESTAMP
    )
  `

  return result
}
