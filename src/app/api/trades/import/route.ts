import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { BRRR_BASE_URL } from '@/lib/server-config'

export const dynamic = 'force-dynamic'

interface CsvRow {
  PAIR: string
  SIDE: string
  LEVERAGE: string
  ENTRY: string
  EXIT: string
  MARGIN: string
  NOTIONAL: string
  FEES: string
  PNL: string
  RESULT: string
  TRIGGER: string
  OPENED: string
  CLOSED: string
  DURATION_S?: string
}

function parseCsvLine(line: string, headers: string[]): Record<string, string> | null {
  const values = line.split(',')
  if (values.length < headers.length) return null
  const row: Record<string, string> = {}
  headers.forEach((h, i) => { row[h] = values[i]?.trim() ?? '' })
  return row
}

function movePct(entry: number, exit: number, side: string): number {
  return side === 'LONG'
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const csvText: string = body.csv ?? body.content ?? ''
    const importBatch: string = body.batch ?? `import-${Date.now()}`
    const clearExisting: boolean = body.clearExisting === true

    if (!csvText.trim()) {
      return NextResponse.json({ error: 'No CSV data' }, { status: 400 })
    }

    if (clearExisting) {
      await db.importedTrade.deleteMany({ where: { importBatch } })
    }

    const lines = csvText.trim().split(/\r?\n/)
    const headerLine = lines[0]
    const headers = headerLine.split(',').map(h => h.trim().replace(/^#/, ''))

    const trades: Prisma.ImportedTradeCreateManyInput[] = []
    for (let i = 1; i < lines.length; i++) {
      const parsed = parseCsvLine(lines[i], headers)
      if (!parsed || !parsed.PAIR) continue

      const entry = parseFloat(parsed.ENTRY)
      const exit = parseFloat(parsed.EXIT)
      const side = parsed.SIDE

      trades.push({
        source: 'csv',
        importBatch,
        pair: parsed.PAIR,
        side,
        leverage: parseInt(parsed.LEVERAGE) || 10,
        entryPrice: entry,
        exitPrice: exit,
        margin: parseFloat(parsed.MARGIN) || 0,
        notional: parseFloat(parsed.NOTIONAL) || 0,
        fees: parseFloat(parsed.FEES) || 0,
        pnl: parseFloat(parsed.PNL) || 0,
        result: parsed.RESULT,
        trigger: parsed.TRIGGER,
        openedAt: parsed.OPENED,
        closedAt: parsed.CLOSED,
        durationSec: parsed.DURATION_S ? parseFloat(parsed.DURATION_S) : null,
        movePct: movePct(entry, exit, side),
      })
    }

    if (trades.length === 0) {
      return NextResponse.json({ error: 'Nie znaleziono transakcji w CSV' }, { status: 400 })
    }

    // Batch insert in chunks of 500
    let inserted = 0
    for (let i = 0; i < trades.length; i += 500) {
      const chunk = trades.slice(i, i + 500)
      const result = await db.importedTrade.createMany({ data: chunk })
      inserted += result.count
    }

    return NextResponse.json({
      success: true,
      importBatch,
      inserted,
      total: trades.length,
    })
  } catch (error) {
    console.error('[/api/trades/import] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}

/** Import all CSV files from a directory path (server-side only) */
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const dirPath = searchParams.get('dir')
    if (!dirPath) {
      return NextResponse.json({ error: 'Param dir required' }, { status: 400 })
    }

    const fs = await import('fs/promises')
    const path = await import('path')
    const files = (await fs.readdir(dirPath)).filter(f => f.startsWith('dip-hunter-trades-') && f.endsWith('.csv'))
    const importBatch = `bulk-${Date.now()}`
    let totalInserted = 0

    for (const file of files) {
      const content = await fs.readFile(path.join(dirPath, file), 'utf-8')
      const res = await POST(new Request(`${BRRR_BASE_URL}/api/trades/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: content, batch: importBatch }),
      }))
      const data = await res.json()
      if (data.inserted) totalInserted += data.inserted
    }

    return NextResponse.json({ success: true, importBatch, files: files.length, inserted: totalInserted })
  } catch (error) {
    console.error('[/api/trades/import PUT] error:', error)
    return NextResponse.json({ error: 'Bulk import failed' }, { status: 500 })
  }
}
