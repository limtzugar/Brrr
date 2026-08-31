import { NextResponse } from "next/server";
import { fetchMarketChart } from "@/lib/coingecko";
import {
  type BacktestRequest,
  type PricePoint,
  type BacktestResults,
  runBacktest,
  round4,
  round2,
} from "@/lib/backtest-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { bulkBacktestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// ─── Bulk-specific Types ────────────────────────────────────────────────────

interface CoinBacktestResult {
  coin_id: string;
  results: BacktestResults;
  error?: string;
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // Rate limit: 10 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateResult = checkRateLimit(ip, 10, 60 * 1000);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": "60" },
        }
      );
    }

    const body = await request.json();

    // Validate input with Zod schema
    let validated: ReturnType<typeof bulkBacktestSchema.parse>;
    try {
      validated = bulkBacktestSchema.parse(body);
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error ? validationError.message : "Invalid input";
      return NextResponse.json(
        { error: "Validation failed", details: message },
        { status: 400 }
      );
    }

    const coinIds: string[] = validated.coin_ids;
    const strategyType = validated.strategy_type || "dip_buying";
    const params: BacktestRequest = {
      coin_id: "",
      days: validated.days,
      strategy_type: strategyType,
      dip_threshold_1h: validated.dip_threshold_1h,
      dip_threshold_24h: validated.dip_threshold_24h,
      take_profit_pct: validated.take_profit_pct,
      stop_loss_pct: validated.stop_loss_pct,
      initial_capital: validated.initial_capital,
      compound: validated.compound,
      max_holding_hours: validated.max_holding_hours,
      fee_pct: validated.fee_pct,

      // Momentum params
      ma_period: validated.ma_period,
      volume_threshold: validated.volume_threshold,

      // Mean Reversion params
      deviation_threshold: validated.deviation_threshold,

      // Breakout params
      lookback_periods: validated.lookback_periods,
      breakout_confirm_bars: validated.breakout_confirm_bars,

      // Grid params
      grid_spacing_pct: validated.grid_spacing_pct,
      grid_levels: validated.grid_levels,
      base_price: validated.base_price,

      // Hurst HCOO_LB params
      hurst_period: validated.hurst_period,
      hurst_threshold: validated.hurst_threshold,
      bb_period: validated.bb_period,
      bb_std: validated.bb_std,
    };

    const useHourly = params.days <= 90;

    // Fetch and backtest each coin with concurrency limit
    const MAX_CONCURRENT = 3;
    const results: CoinBacktestResult[] = [];

    for (let i = 0; i < coinIds.length; i += MAX_CONCURRENT) {
      const batch = coinIds.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (coinId) => {
          try {
            const chart = await fetchMarketChart(coinId, params.days, useHourly);

            if (!chart.prices || chart.prices.length < 10) {
              return {
                coin_id: coinId,
                results: emptyResults(params.initial_capital, useHourly ? "hourly" : "daily"),
                error: "Brak danych historycznych",
              };
            }

            const prices: PricePoint[] = chart.prices
              .filter(([, price]) => price > 0)
              .map(([ts, price]) => ({
                date: new Date(ts).toISOString(),
                price: round4(price),
                timestamp: ts,
              }));

            const { results: btResults } = runBacktest(prices, { ...params, coin_id: coinId });

            return {
              coin_id: coinId,
              results: btResults,
            } as CoinBacktestResult;
          } catch (err) {
            console.error(`[bulk] Error for ${coinId}:`, err);
            return {
              coin_id: coinId,
              results: emptyResults(params.initial_capital, useHourly ? "hourly" : "daily"),
              error: "Błąd pobierania danych",
            };
          }
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        }
      }
    }

    // Sort by total_return_pct descending
    results.sort((a, b) => b.results.total_return_pct - a.results.total_return_pct);

    // Aggregated statistics
    const validResults = results.filter((r) => !r.error);
    const aggregated = computeAggregated(validResults, params.initial_capital);

    return NextResponse.json(
      {
        coin_results: results,
        aggregated,
        parameters: { ...params, coin_ids: coinIds },
        last_updated: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("[/api/backtest/bulk] Error:", error);
    return NextResponse.json(
      { error: "Bulk backtest nie powiódł się. Spróbuj ponownie później." },
      { status: 502 }
    );
  }
}

// ─── Aggregated Stats ───────────────────────────────────────────────────────

function computeAggregated(
  results: CoinBacktestResult[],
  _initialCapital: number
) {
  if (results.length === 0) {
    return {
      avg_return_pct: 0,
      avg_win_rate: 0,
      avg_profit_factor: 0,
      avg_info_ratio: 0,
      best_performer: null,
      worst_performer: null,
      coins_tested: 0,
      coins_profitable: 0,
    };
  }

  const returns = results.map((r) => r.results.total_return_pct);
  const winRates = results.map((r) => r.results.win_rate);
  const profitFactors = results.map((r) => r.results.profit_factor).filter((f) => f < 999);
  const infoRatios = results.map((r) => r.results.info_ratio);

  const bestPerformer = results.reduce((best, r) =>
    r.results.total_return_pct > best.results.total_return_pct ? r : best
  );
  const worstPerformer = results.reduce((worst, r) =>
    r.results.total_return_pct < worst.results.total_return_pct ? r : worst
  );

  return {
    avg_return_pct: round2(returns.reduce((a, b) => a + b, 0) / returns.length),
    avg_win_rate: round2(winRates.reduce((a, b) => a + b, 0) / winRates.length),
    avg_profit_factor: profitFactors.length > 0 ? round2(profitFactors.reduce((a, b) => a + b, 0) / profitFactors.length) : 0,
    avg_info_ratio: round2(infoRatios.reduce((a, b) => a + b, 0) / infoRatios.length),
    best_performer: bestPerformer.coin_id,
    worst_performer: worstPerformer.coin_id,
    coins_tested: results.length,
    coins_profitable: results.filter((r) => r.results.total_return_pct > 0).length,
  };
}

// ─── Empty Results Helper ───────────────────────────────────────────────────

function emptyResults(initialCapital: number, granularity: "hourly" | "daily"): BacktestResults {
  return {
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    win_rate: 0,
    avg_profit_pct: 0,
    avg_loss_pct: 0,
    total_return_pct: 0,
    max_drawdown_pct: 0,
    final_capital: initialCapital,
    profit_factor: 0,
    info_ratio: 0,
    best_trade_pct: 0,
    worst_trade_pct: 0,
    avg_holding_hours: 0,
    total_fees: 0,
    avg_net_profit_pct: 0,
    breakeven_trades: 0,
    consecutive_wins: 0,
    consecutive_losses: 0,
    data_granularity: granularity,
    total_slippage: 0,
    slippage_pct: 0.05,
    wick_simulation: true,
  };
}
