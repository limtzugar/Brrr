import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { db } from '@/lib/db'
import { runWalkForwardEvaluation } from '@/lib/llm-walk-forward-evaluation'

export const dynamic = 'force-dynamic'

interface EvaluationHistoryRow {
  id: string
  status: string
  horizon: string
  sampleCount: number
  outOfSampleCount: number
  foldCount: number
  baselineMeanReturn: number | null
  llmMeanReturn: number | null
  deltaMeanReturn: number | null
  confidenceLower95: number | null
  confidenceUpper95: number | null
  completedAt: Date | string
  resultJson: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await runWalkForwardEvaluation(body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Nieprawidłowa konfiguracja ewaluacji', issues: error.issues },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ewaluacja nie powiodła się' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get('limit') || 20)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1), 100)

  try {
    const rows = await db.$queryRaw<EvaluationHistoryRow[]>`
      SELECT
        id, status, horizon, sampleCount, outOfSampleCount,
        foldCount, baselineMeanReturn, llmMeanReturn, deltaMeanReturn,
        confidenceLower95, confidenceUpper95, completedAt, resultJson
      FROM EvaluationRun
      ORDER BY completedAt DESC
      LIMIT ${limit}
    `
    return NextResponse.json({
      runs: rows.map(row => ({
        ...row,
        baselineMeanReturn: row.baselineMeanReturn,
        llmMeanReturn: row.llmMeanReturn,
        deltaMeanReturn: row.deltaMeanReturn,
        confidenceLower95: row.confidenceLower95,
        confidenceUpper95: row.confidenceUpper95,
        result: JSON.parse(row.resultJson || '{}'),
        resultJson: undefined,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Nie udało się pobrać ewaluacji' },
      { status: 500 },
    )
  }
}
