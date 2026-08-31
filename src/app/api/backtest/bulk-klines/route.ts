// ─── Bulk Backtest with Binance Klines (OHLCV) ──────────────────────────────
import { NextResponse } from 'next/server'
import { type BacktestRequest, type PricePoint, type BacktestResults, runBacktest, round4, round2 } from '@/lib/backtest-engine'
import { checkRateLimit } from '@/lib/rate-limit'
import { COIN_TO_BINANCE } from '@/lib/binance'

export const dynamic = 'force-dynamic'

function emptyResults(initialCapital: number): BacktestResults {
  return { total_trades: 0, winning_trades: 0, losing_trades: 0, win_rate: 0, avg_profit_pct: 0, avg_loss_pct: 0, total_return_pct: 0, max_drawdown_pct: 0, final_capital: initialCapital, profit_factor: 0, info_ratio: 0, best_trade_pct: 0, worst_trade_pct: 0, avg_holding_hours: 0, total_fees: 0, total_slippage: 0, avg_net_profit_pct: 0, breakeven_trades: 0, consecutive_wins: 0, consecutive_losses: 0, data_granularity: 'hourly', slippage_pct: 0.05, wick_simulation: true }
}

function coinIdToBinanceSymbol(coinId: string): string {
  return COIN_TO_BINANCE[coinId] || coinId.toUpperCase() + 'USDT'
}

async function fetchBinanceKlines(symbol: string, interval: string, limit: number): Promise<PricePoint[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Binance API ${res.status}`)
    const text = await res.text()
    const data = JSON.parse(text) as unknown[][]
    if (!Array.isArray(data)) throw new Error('Invalid kline response')
    const prices: PricePoint[] = []
    for (const k of data) {
      const openTime = Number(k[0]); const close = parseFloat(k[4] as string); const volume = parseFloat(k[5] as string)
      if (!isNaN(close) && close > 0) prices.push({ date: new Date(openTime).toISOString(), price: round4(close), timestamp: openTime, volume: isNaN(volume) ? 0 : volume })
    }
    return prices
  } finally { clearTimeout(timeout) }
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateResult = checkRateLimit(ip, 20, 60 * 1000)
    if (!rateResult.allowed) return NextResponse.json({ error: 'Too many requests (limit 20/min).' }, { status: 429 })

    const body = await request.json()
    const coinIds: string[] = Array.isArray(body.coin_ids) ? body.coin_ids.slice(0, 150) : []
    if (coinIds.length === 0) return NextResponse.json({ error: 'coin_ids cannot be empty' }, { status: 400 })

    const days = Math.min(Math.max(Number(body.days) || 5, 1), 30)
    const strategyType = body.strategy_type || 'dip_buying'
    let interval = '15m', granularityLabel = '15m'
    if (days > 7) { interval = '1h'; granularityLabel = '1h' }
    if (days > 14) { interval = '4h'; granularityLabel = '4h' }
    const msPerCandle: Record<string, number> = { '15m': 900000, '1h': 3600000, '4h': 14400000 }
    const limit = Math.min(1000, Math.ceil((days * 86400000) / msPerCandle[interval]))

    const params: Omit<BacktestRequest, 'coin_id'> = {
      days, strategy_type: strategyType,
      dip_threshold_1h: Number(body.dip_threshold_1h) || -3,
      dip_threshold_24h: Number(body.dip_threshold_24h) || -8,
      take_profit_pct: Math.min(Math.max(Number(body.take_profit_pct) || 5, 0.1), 100),
      stop_loss_pct: Math.min(Math.max(Number(body.stop_loss_pct) || 3, 0.1), 100),
      initial_capital: Math.min(Math.max(Number(body.initial_capital) || 1000, 1), 10000000),
      compound: typeof body.compound === 'boolean' ? body.compound : true,
      max_holding_hours: Math.min(Math.max(Number(body.max_holding_hours) || 48, 1), 720),
      fee_pct: Math.min(Math.max(Number(body.fee_pct) || 0.1, 0), 5),
      ma_period: body.ma_period ? Number(body.ma_period) : undefined,
      volume_threshold: body.volume_threshold ? Number(body.volume_threshold) : undefined,
      deviation_threshold: body.deviation_threshold ? Number(body.deviation_threshold) : undefined,
      lookback_periods: body.lookback_periods ? Number(body.lookback_periods) : undefined,
      breakout_confirm_bars: body.breakout_confirm_bars ? Number(body.breakout_confirm_bars) : undefined,
      hurst_period: body.hurst_period ? Number(body.hurst_period) : undefined,
      hurst_threshold: body.hurst_threshold ? Number(body.hurst_threshold) : undefined,
      bb_period: body.bb_period ? Number(body.bb_period) : undefined,
      bb_std: body.bb_std ? Number(body.bb_std) : undefined,
    }

    const MAX_CONCURRENT = 10
    const results: Array<{ coin_id: string; symbol: string; results: BacktestResults; error?: string }> = []
    const errors: string[] = []

    for (let i = 0; i < coinIds.length; i += MAX_CONCURRENT) {
      const batch = coinIds.slice(i, i + MAX_CONCURRENT)
      const batchResults = await Promise.allSettled(batch.map(async (coinId) => {
        const symbol = coinIdToBinanceSymbol(coinId)
        try {
          const prices = await fetchBinanceKlines(symbol, interval, limit)
          if (prices.length < 10) return { coin_id: coinId, symbol, results: emptyResults(params.initial_capital), error: 'No data' }
          const { results: btResults } = runBacktest(prices, { ...params, coin_id: coinId })
          return { coin_id: coinId, symbol, results: btResults }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error'
          errors.push(`${coinId} (${symbol}): ${message}`)
          return { coin_id: coinId, symbol, results: emptyResults(params.initial_capital), error: 'Error: ' + message }
        }
      }))
      for (const r of batchResults) { if (r.status === 'fulfilled') results.push(r.value) }
    }

    results.sort((a, b) => b.results.total_return_pct - a.results.total_return_pct)
    const valid = results.filter(r => !r.error)
    const returns = valid.map(r => r.results.total_return_pct).sort((a, b) => a - b)
    const sum = returns.reduce((s, r) => s + r, 0)
    const median = returns.length > 0 ? (returns.length % 2 === 0 ? (returns[returns.length / 2 - 1] + returns[returns.length / 2]) / 2 : returns[Math.floor(returns.length / 2)]) : 0
    const best = valid.length > 0 ? valid.reduce((b, r) => r.results.total_return_pct > b.results.total_return_pct ? r : b, valid[0]) : null
    const worst = valid.length > 0 ? valid.reduce((w, r) => r.results.total_return_pct < w.results.total_return_pct ? r : w, valid[0]) : null

    return NextResponse.json({
      coin_results: results,
      aggregated: {
        total_coins: results.length, successful_backtests: valid.length, failed_backtests: results.length - valid.length,
        avg_return_pct: round2(valid.length > 0 ? sum / valid.length : 0),
        median_return_pct: round2(median),
        best_coin: best ? { coin_id: best.coin_id, symbol: best.symbol, return_pct: round2(best.results.total_return_pct) } : null,
        worst_coin: worst ? { coin_id: worst.coin_id, symbol: worst.symbol, return_pct: round2(worst.results.total_return_pct) } : null,
        avg_win_rate: round2(valid.length > 0 ? valid.reduce((s, r) => s + r.results.win_rate, 0) / valid.length : 0),
        avg_max_drawdown_pct: round2(valid.length > 0 ? valid.reduce((s, r) => s + r.results.max_drawdown_pct, 0) / valid.length : 0),
        profitable_strategies: valid.filter(r => r.results.total_return_pct > 0).length,
        total_trades: valid.reduce((s, r) => s + r.results.total_trades, 0),
      },
      parameters: { ...params, coin_ids: coinIds, interval, granularity_label: granularityLabel, candles_per_coin: limit },
      last_updated: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    }, { headers: { 'Cache-Control': 'private, no-cache' } })
  } catch (error) {
    console.error('[/api/backtest/bulk-klines] Error:', error)
    return NextResponse.json({ error: 'Bulk backtest failed.' }, { status: 502 })
  }
}
