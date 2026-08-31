import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface ShadowRow {
  id: string
  decisionId: string
  status: string
  recommendation: string | null
  confidence: number | null
  thesis: string | null
  argumentsJson: string
  invalidatorsJson: string
  promptVersion: string
  invocationId: string | null
  provider: string | null
  model: string | null
  attempts: number
  errorMessage: string | null
  createdAt: Date
  completedAt: Date | null
  symbol: string
  strategyType: string
  action: string
  decidedAt: Date
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get('limit') || 50)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 200)

  try {
    const [setting, rows] = await Promise.all([
      db.appSettings.findUnique({ where: { key: 'llm_shadow_enabled' } }),
      db.$queryRaw<ShadowRow[]>`
        SELECT
          evaluation.id,
          evaluation.decisionId,
          evaluation.status,
          evaluation.recommendation,
          evaluation.confidence,
          evaluation.thesis,
          evaluation.argumentsJson,
          evaluation.invalidatorsJson,
          evaluation.promptVersion,
          evaluation.invocationId,
          evaluation.provider,
          evaluation.model,
          evaluation.attempts,
          evaluation.errorMessage,
          evaluation.createdAt,
          evaluation.completedAt,
          decision.symbol,
          decision.strategyType,
          decision.action,
          decision.decidedAt
        FROM ShadowEvaluation evaluation
        JOIN StrategyDecision decision ON decision.id = evaluation.decisionId
        ORDER BY evaluation.createdAt DESC
        LIMIT ${limit}
      `,
    ])

    return NextResponse.json({
      enabled: setting?.value !== 'false',
      evaluations: rows.map(row => ({
        ...row,
        arguments: JSON.parse(row.argumentsJson),
        invalidators: JSON.parse(row.invalidatorsJson),
        argumentsJson: undefined,
        invalidatorsJson: undefined,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch shadow evaluations' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Field enabled must be a boolean' }, { status: 400 })
    }
    await db.appSettings.upsert({
      where: { key: 'llm_shadow_enabled' },
      update: { value: String(body.enabled) },
      create: { key: 'llm_shadow_enabled', value: String(body.enabled) },
    })
    return NextResponse.json({ enabled: body.enabled })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to change shadow mode' },
      { status: 500 },
    )
  }
}
