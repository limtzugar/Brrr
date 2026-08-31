import { NextResponse } from "next/server";
import { fetchMarketChart } from "@/lib/coingecko";
import {
  type BacktestRequest,
  type PricePoint,
  runBacktest,
  round4,
  round2,
} from "@/lib/backtest-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { optimizeSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// ─── Optimize-specific Types ────────────────────────────────────────────────

interface OptimizeResult {
  params: BacktestRequest;
  score: number;
  total_return_pct: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  max_drawdown_pct: number;
  info_ratio: number;
  final_capital: number;
}

// ─── Default Param Grids per Strategy ──────────────────────────────────────

const DEFAULT_GRIDS: Record<string, Record<string, number[]>> = {
  dip_buying: {
    dip_threshold_1h: [0, -2, -3, -5],
    dip_threshold_24h: [-2, -3, -5, -8, -10],
    take_profit_pct: [2, 3, 4, 5, 7, 10],
    stop_loss_pct: [2, 3, 5, 7, 10],
    max_holding_hours: [24, 48, 72, 96],
  },
  momentum: {
    ma_period: [10, 20, 50],
    volume_threshold: [1.2, 1.5, 2.0],
    take_profit_pct: [3, 5, 8, 10],
    stop_loss_pct: [2, 3, 5, 7],
    max_holding_hours: [24, 48, 72, 96],
  },
  mean_reversion: {
    deviation_threshold: [1.5, 2, 2.5, 3],
    take_profit_pct: [2, 3, 5],
    stop_loss_pct: [3, 5, 7, 10],
    max_holding_hours: [48, 72, 96, 168],
  },
  breakout: {
    lookback_periods: [10, 20, 30],
    breakout_confirm_bars: [1, 2, 3],
    take_profit_pct: [3, 5, 8, 10],
    stop_loss_pct: [2, 3, 5, 7],
    max_holding_hours: [24, 48, 72],
  },
  grid: {
    grid_spacing_pct: [1, 1.5, 2, 3, 5],
    grid_levels: [3, 5, 7, 10],
    take_profit_pct: [2, 3, 5],
    stop_loss_pct: [5, 7, 10, 15],
  },
  hurst_hcoo_lb: {
    hurst_period: [50, 100, 150],
    hurst_threshold: [0.4, 0.5, 0.6],
    bb_period: [15, 20, 30],
    bb_std: [1.5, 2, 2.5],
    take_profit_pct: [3, 5, 7],
    stop_loss_pct: [3, 5, 7],
    max_holding_hours: [48, 72, 96],
  },
  futures_compound: {
    leverage: [2, 3, 5],
    futures_alloc_pct: [30, 50, 70],
    ema_fast: [5, 9, 12],
    ema_slow: [21, 30, 50],
    rsi_period: [10, 14, 20],
    rsi_overbought: [65, 70, 75],
    rsi_oversold: [25, 30, 35],
    futures_sl_pct: [1.5, 2, 3],
    futures_tp_pct: [3, 4, 6],
    max_futures_hours: [12, 24, 48],
    take_profit_pct: [2, 3, 5],
    stop_loss_pct: [3, 5, 7],
    dip_threshold_24h: [-3, -5, -8],
  },
};

// ─── Combination Generator ─────────────────────────────────────────────────

function generateCombinations(grid: Record<string, number[]>): Record<string, number>[] {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{}];

  const results: Record<string, number>[] = [{}];
  for (const key of keys) {
    const values = grid[key];
    if (!values || values.length === 0) continue;
    const newResults: Record<string, number>[] = [];
    for (const existing of results) {
      for (const val of values) {
        newResults.push({ ...existing, [key]: val });
      }
    }
    results.length = 0;
    results.push(...newResults);
  }
  return results;
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // Rate limit: 5 requests per minute per IP (most expensive endpoint)
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateResult = checkRateLimit(ip, 5, 60 * 1000);
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
    let validated: ReturnType<typeof optimizeSchema.parse>;
    try {
      validated = optimizeSchema.parse(body);
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error ? validationError.message : "Invalid input";
      return NextResponse.json(
        { error: "Validation failed", details: message },
        { status: 400 }
      );
    }

    const coinId = validated.coin_id;
    const days = validated.days;
    const initialCapital = validated.initial_capital;
    const compound = validated.compound;
    const feePct = validated.fee_pct;
    const strategyType = validated.strategy_type || "dip_buying";

    // Build param grid: merge defaults with custom overrides
    const defaultGrid = DEFAULT_GRIDS[strategyType] || DEFAULT_GRIDS.dip_buying;
    const customGrid = validated.custom_grid;

    const grid: Record<string, number[]> = {};
    for (const [key, defaultValues] of Object.entries(defaultGrid)) {
      const customValues = customGrid?.[key as keyof typeof customGrid];
      // Only use custom values if provided and non-empty
      if (customValues && Array.isArray(customValues) && customValues.length > 0) {
        grid[key] = customValues as number[];
      } else {
        grid[key] = defaultValues;
      }
    }

    // Generate all parameter combinations
    const combinations = generateCombinations(grid);

    // Hard cap: reject if too many combinations
    if (combinations.length > 5000) {
      return NextResponse.json(
        {
          error: "Too many parameter combinations",
          details: `Grid would produce ${combinations.length} combinations. Maximum allowed is 5000. Reduce the number of values in your grid.`,
        },
        { status: 400 }
      );
    }

    // Fetch historical data once
    const useHourly = days <= 90;
    const chart = await fetchMarketChart(coinId, days, useHourly);

    if (!chart.prices || chart.prices.length < 10) {
      return NextResponse.json(
        { error: "Brak wystarczających danych historycznych dla tej monety." },
        { status: 404 }
      );
    }

    const prices: PricePoint[] = chart.prices
      .filter(([, price]) => price > 0)
      .map(([ts, price]) => ({
        date: new Date(ts).toISOString(),
        price: round4(price),
        timestamp: ts,
      }));

    console.log(`[optimize] Running ${combinations.length} combinations for ${coinId} (${days}d, ${strategyType})`);

    // Run all backtests
    const results: OptimizeResult[] = [];
    for (const combo of combinations) {
      // Build BacktestRequest from the combination
      const params: BacktestRequest = {
        coin_id: coinId,
        days,
        strategy_type: strategyType,
        initial_capital: initialCapital,
        compound,
        fee_pct: feePct,
        slippage_pct: 0.05,
        simulate_wicks: true,
      };

      // Apply strategy-specific params from the combination
      for (const [key, value] of Object.entries(combo)) {
        (params as unknown as Record<string, unknown>)[key] = value;
      }

      const btResult = runBacktest(prices, params);
      const r = btResult.results;

      // Minimum trades filter
      if (r.total_trades < 3) continue;

      // Composite score
      const tradeCountScore = Math.min(r.total_trades / 20, 1) * 100;
      const drawdownPenalty = Math.min(r.max_drawdown_pct / 50, 1) * 100;

      const score =
        (r.total_return_pct * 0.4) +
        (r.win_rate * 0.25) +
        (Math.min(r.profit_factor, 5) / 5 * 100 * 0.2) +
        (tradeCountScore * 0.05) +
        ((100 - drawdownPenalty) * 0.1);

      results.push({
        params,
        score: round2(score),
        total_return_pct: r.total_return_pct,
        win_rate: r.win_rate,
        total_trades: r.total_trades,
        profit_factor: r.profit_factor,
        max_drawdown_pct: r.max_drawdown_pct,
        info_ratio: r.info_ratio,
        final_capital: r.final_capital,
      });
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, 20);

    console.log(`[optimize] Done. ${results.length} valid strategies. Best score: ${topResults[0]?.score || 'N/A'}`);

    return NextResponse.json({
      coin_id: coinId,
      days,
      strategy_type: strategyType,
      total_combinations: combinations.length,
      valid_strategies: results.length,
      best: topResults[0] || null,
      top_20: topResults,
    });
  } catch (error) {
    console.error("[/api/backtest/optimize] Error:", error);
    return NextResponse.json(
      { error: "Optymalizacja nie powiodła się. Spróbuj ponownie później." },
      { status: 502 }
    );
  }
}
