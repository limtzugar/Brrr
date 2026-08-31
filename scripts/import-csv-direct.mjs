#!/usr/bin/env node
/** Direct Prisma bulk import — faster than 162 HTTP calls */
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const prisma = new PrismaClient()
const CSV_DIR = process.argv[2] ?? './data/csv'
const importBatch = `bulk-${Date.now()}`

function movePct(entry, exit, side) {
  return side === 'LONG' ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100
}

const files = readdirSync(CSV_DIR).filter(f => f.startsWith('dip-hunter-trades-') && f.endsWith('.csv'))
console.log(`Direct import: ${files.length} files`)

// Clear previous bulk imports
await prisma.importedTrade.deleteMany({ where: { source: 'csv' } })

let total = 0
const allTrades = []

for (const file of files) {
  const lines = readFileSync(join(CSV_DIR, file), 'utf-8').trim().split(/\r?\n/)
  const headers = lines[0].split(',').map(h => h.trim().replace(/^#/, ''))
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',')
    if (vals.length < headers.length) continue
    const row = {}
    headers.forEach((h, j) => { row[h] = vals[j]?.trim() })
    if (!row.PAIR) continue
    const entry = parseFloat(row.ENTRY)
    const exit = parseFloat(row.EXIT)
    allTrades.push({
      source: 'csv', importBatch, pair: row.PAIR, side: row.SIDE,
      leverage: parseInt(row.LEVERAGE) || 10,
      entryPrice: entry, exitPrice: exit,
      margin: parseFloat(row.MARGIN) || 0, notional: parseFloat(row.NOTIONAL) || 0,
      fees: parseFloat(row.FEES) || 0, pnl: parseFloat(row.PNL) || 0,
      result: row.RESULT, trigger: row.TRIGGER,
      openedAt: row.OPENED, closedAt: row.CLOSED,
      durationSec: row.DURATION_S ? parseFloat(row.DURATION_S) : null,
      movePct: movePct(entry, exit, row.SIDE),
    })
  }
}

for (let i = 0; i < allTrades.length; i += 1000) {
  const chunk = allTrades.slice(i, i + 1000)
  const r = await prisma.importedTrade.createMany({ data: chunk })
  total += r.count
  process.stdout.write(`\rInserted ${total}/${allTrades.length}`)
}

console.log(`\nDone: ${total} trades (batch: ${importBatch})`)

const agg = await prisma.importedTrade.aggregate({ _sum: { pnl: true }, _count: { id: true } })
console.log(`Total PnL: $${(agg._sum.pnl ?? 0).toFixed(2)}, count: ${agg._count.id}`)

await prisma.$disconnect()