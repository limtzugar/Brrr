import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const strategyType = url.searchParams.get('strategyType')
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

  try {
    const where: any = {}
    if (status) where.status = status
    if (strategyType) where.strategyType = strategyType

    const convictions = await db.conviction.findMany({
      where,
      orderBy: [{ convictionStrength: 'desc' }, { confidence: 'desc' }],
      take: limit,
    })

    return NextResponse.json(convictions.map(c => ({
      ...c,
      evidence: JSON.parse(c.evidence),
      invalidators: JSON.parse(c.invalidators),
    })))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch convictions' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      source = 'MANUAL',
      strategyType,
      symbol,
      direction = 'NEUTRAL',
      thesis,
      confidence = 0,
      evidence = [],
      invalidators = [],
      category,
      parentId,
      reportId,
    } = body

    if (!strategyType || !thesis) {
      return NextResponse.json({ error: 'strategyType i thesis są wymagane' }, { status: 400 })
    }

    const conviction = await db.conviction.create({
      data: {
        source,
        status: 'HYPOTHESIS',
        strategyType,
        symbol: symbol || null,
        direction,
        thesis: thesis.slice(0, 2000),
        confidence: Math.min(100, Math.max(0, confidence)),
        evidence: JSON.stringify(evidence.slice(0, 20)),
        invalidators: JSON.stringify(invalidators.slice(0, 20)),
        category: category || null,
        parentId: parentId || null,
        reportId: reportId || null,
      },
    })

    return NextResponse.json({
      ...conviction,
      evidence: JSON.parse(conviction.evidence),
      invalidators: JSON.parse(conviction.invalidators),
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create conviction' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, status, convictionStrength, validatedBy } = body

    if (!id) {
      try {
        const { ids, newStatus, newConvictionStrength, newValidatedBy } = body
        if (Array.isArray(ids) && ids.length > 0 && newStatus) {
          const data: any = { status: newStatus }
          if (newConvictionStrength !== undefined) data.convictionStrength = newConvictionStrength
          if (newValidatedBy) data.validationBy = newValidatedBy
          if (newStatus === 'CONVICTION' || newStatus === 'REJECTED') {
            data.validatedAt = new Date()
          }
          await db.conviction.updateMany({
            where: { id: { in: ids } },
            data,
          })
          return NextResponse.json({ success: true, updated: ids.length })
        }
      } catch {}
      return NextResponse.json({ error: 'id (pojedynczy) lub ids (batch) wymagane' }, { status: 400 })
    }

    const data: any = {}
    if (status) data.status = status
    if (convictionStrength !== undefined) data.convictionStrength = convictionStrength
    if (validatedBy) data.validationBy = validatedBy
    if (status === 'CONVICTION' || status === 'REJECTED') {
      data.validatedAt = new Date()
    }

    const conviction = await db.conviction.update({
      where: { id },
      data,
    })

    return NextResponse.json({
      ...conviction,
      evidence: JSON.parse(conviction.evidence),
      invalidators: JSON.parse(conviction.invalidators),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update conviction' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const strategyType = url.searchParams.get('strategyType')

    if (id) {
      await db.conviction.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }
    if (strategyType) {
      await db.conviction.deleteMany({ where: { strategyType } })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'id lub strategyType wymagane' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
