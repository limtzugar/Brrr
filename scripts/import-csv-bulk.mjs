#!/usr/bin/env node
/** Bulk import all Dip Hunter CSV files into BRRR database via API */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const BRRR_PORT = 3020
const BASE = process.argv[2] ?? `http://localhost:${BRRR_PORT}`
const CSV_DIR = process.argv[3] ?? './data/csv'
const importBatch = `bulk-${Date.now()}`

const files = readdirSync(CSV_DIR).filter(f => f.startsWith('dip-hunter-trades-') && f.endsWith('.csv'))
console.log(`Importing ${files.length} CSV files from ${CSV_DIR}...`)

let total = 0
for (const file of files) {
  const csv = readFileSync(join(CSV_DIR, file), 'utf-8')
  const res = await fetch(`${BASE}/api/trades/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv, batch: importBatch }),
  })
  const data = await res.json()
  if (data.inserted) {
    total += data.inserted
    process.stdout.write(`\r${file}: +${data.inserted} (total: ${total})`)
  }
}

console.log(`\nDone: ${total} trades imported (batch: ${importBatch})`)

const analytics = await fetch(`${BASE}/api/trades/analytics?batch=${importBatch}`)
const stats = await analytics.json()
console.log(`PnL: $${stats.totalPnl}, WR: ${stats.winRate}%, PF: ${stats.profitFactor}`)