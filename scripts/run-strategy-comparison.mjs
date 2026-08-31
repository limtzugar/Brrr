#!/usr/bin/env node
/**
 * Run backtests for all 6 strategy types on BTC/ETH/SOL and print comparison table.
 * Usage: node scripts/run-strategy-comparison.mjs [baseUrl]
 */
const BRRR_PORT = 3020
const BASE = process.argv[2] ?? `http://localhost:${BRRR_PORT}`

const COINS = ['bitcoin', 'ethereum', 'solana']
const STRATEGIES = [
  { type: 'dip_buying', label: 'Dip Buying' },
  { type: 'momentum', label: 'Momentum' },
  { type: 'mean_reversion', label: 'Mean Reversion' },
  { type: 'breakout', label: 'Breakout' },
  { type: 'grid', label: 'Grid' },
  { type: 'hurst_hcoo_lb', label: 'Hurst HCOO' },
]

const PARAMS = {
  days: 90,
  initial_capital: 1000,
  compound: true,
  fee_pct: 0.1,
  take_profit_pct: 5,
  stop_loss_pct: 1.5,
  dip_threshold_1h: 0,
  dip_threshold_24h: -3,
  max_holding_hours: 48,
}

async function runBacktest(coinId, strategyType) {
  const res = await fetch(`${BASE}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coin_id: coinId, strategy_type: strategyType, ...PARAMS }),
  })
  if (!res.ok) {
    const err = await res.text()
    return { error: err.slice(0, 80) }
  }
  const data = await res.json()
  return data.results ?? data
}

console.log(`\nBRRR Strategy Comparison — ${BASE}\n`)
console.log('Coin'.padEnd(12), 'Strategy'.padEnd(18), 'Return%'.padStart(8), 'WR%'.padStart(6), 'PF'.padStart(6), 'Sharpe'.padStart(8), 'MaxDD%'.padStart(8), 'Trades'.padStart(7))
console.log('-'.repeat(85))

const summary = []

for (const coin of COINS) {
  for (const strat of STRATEGIES) {
    process.stdout.write(`Testing ${coin}/${strat.type}...`)
    const r = await runBacktest(coin, strat.type)
    process.stdout.write('\r')

    if (r.error) {
      console.log(coin.padEnd(12), strat.label.padEnd(18), 'ERROR'.padStart(8))
      continue
    }

    const row = {
      coin, strategy: strat.label,
      return: r.total_return_pct ?? 0,
      winRate: r.win_rate_pct ?? 0,
      pf: r.profit_factor ?? 0,
      sharpe: r.sharpe_ratio ?? 0,
      maxDd: r.max_drawdown_pct ?? 0,
      trades: r.total_trades ?? 0,
    }
    summary.push(row)

    console.log(
      coin.padEnd(12),
      strat.label.padEnd(18),
      `${row.return.toFixed(2)}%`.padStart(8),
      `${row.winRate.toFixed(1)}%`.padStart(6),
      row.pf.toFixed(2).padStart(6),
      row.sharpe.toFixed(2).padStart(8),
      `${row.maxDd.toFixed(1)}%`.padStart(8),
      String(row.trades).padStart(7),
    )
  }
}

// Best per coin
console.log('\n=== BEST PER COIN ===')
for (const coin of COINS) {
  const best = summary.filter(s => s.coin === coin).sort((a, b) => b.return - a.return)[0]
  if (best) console.log(`  ${coin}: ${best.strategy} (+${best.return.toFixed(2)}%, PF ${best.pf.toFixed(2)})`)
}

// Best overall
const bestOverall = [...summary].sort((a, b) => b.return - a.return)[0]
if (bestOverall) {
  console.log(`\n=== BEST OVERALL ===`)
  console.log(`  ${bestOverall.coin} / ${bestOverall.strategy}: +${bestOverall.return.toFixed(2)}% (PF ${bestOverall.pf.toFixed(2)}, ${bestOverall.trades} trades)`)
}