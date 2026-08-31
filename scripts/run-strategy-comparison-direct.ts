/**
 * Direct strategy comparison — no HTTP server needed.
 * Run: npx tsx scripts/run-strategy-comparison-direct.ts
 */
import { fetchMarketChart } from '../src/lib/coingecko'
import { runBacktest, type BacktestRequest, type PricePoint } from '../src/lib/backtest-engine'

const COINS = ['bitcoin', 'ethereum', 'solana'] as const
const STRATEGIES = [
  'dip_buying', 'momentum', 'mean_reversion', 'breakout', 'grid', 'hurst_hcoo_lb',
] as const

const BASE: Partial<BacktestRequest> = {
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

async function main() {
  console.log('\nBRRR Strategy Comparison (direct)\n')
  const rows: Array<{ coin: string; strategy: string; return: number; pf: number; trades: number }> = []

  for (const coin of COINS) {
    console.log(`Fetching ${coin} market data...`)
    const chart = await fetchMarketChart(coin, 90, true)
    const prices: PricePoint[] = chart.prices
      .filter(([, price]) => price > 0)
      .map(([ts, price]) => ({
        date: new Date(ts).toISOString(),
        timestamp: ts,
        price,
      }))
    for (const strategy of STRATEGIES) {
      const result = runBacktest(prices, {
        ...BASE,
        coin_id: coin,
        strategy_type: strategy,
      } as BacktestRequest)
      const r = result.results
      const ret = r.total_return_pct ?? 0
      const wr = r.win_rate ?? 0
      const pf = r.profit_factor ?? 0
      const n = r.total_trades ?? 0
      rows.push({ coin, strategy, return: ret, pf, trades: n })
      console.log(
        `${coin.padEnd(12)} ${strategy.padEnd(18)}`,
        `${ret.toFixed(2)}%`.padStart(8),
        `WR ${wr.toFixed(1)}%`.padStart(10),
        `PF ${pf.toFixed(2)}`.padStart(8),
        `trades ${n}`.padStart(10),
      )
    }
  }

  console.log('\n=== BEST PER COIN ===')
  for (const coin of COINS) {
    const best = rows.filter(r => r.coin === coin).sort((a, b) => b.return - a.return)[0]
    console.log(`  ${coin}: ${best.strategy} (+${best.return.toFixed(2)}%, PF ${best.pf.toFixed(2)})`)
  }

  const best = [...rows].sort((a, b) => b.return - a.return)[0]
  console.log(`\n=== BEST OVERALL: ${best.coin} / ${best.strategy} (+${best.return.toFixed(2)}%) ===\n`)
}

main().catch(console.error)
