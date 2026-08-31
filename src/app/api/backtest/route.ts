import { NextResponse } from "next/server";
import { fetchMarketChart } from "@/lib/coingecko";
import {
  type BacktestRequest,
  type PricePoint,
  runBacktest,
  round4,
} from "@/lib/backtest-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { backtestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // Rate limit: 20 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateResult = checkRateLimit(ip, 20, 60 * 1000);
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
    let params: BacktestRequest;
    try {
      params = backtestSchema.parse(body);
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error ? validationError.message : "Invalid input";
      return NextResponse.json(
        { error: "Validation failed", details: message },
        { status: 400 }
      );
    }

    // Fetch historical data — use hourly data for ≤90 days
    const useHourly = params.days <= 90;
    const chart = await fetchMarketChart(params.coin_id, params.days, useHourly);

    if (!chart.prices || chart.prices.length < 10) {
      return NextResponse.json(
        { error: "Not enough historical data for this coin." },
        { status: 404 }
      );
    }

    // Build price array
    const prices: PricePoint[] = chart.prices
      .filter(([, price]) => price > 0)
      .map(([ts, price]) => ({
        date: new Date(ts).toISOString(),
        price: round4(price),
        timestamp: ts,
      }));

    // Run the backtest simulation
    const { trades, equityCurve, results } = runBacktest(prices, params);

    return NextResponse.json(
      {
        coin_id: params.coin_id,
        strategy_type: params.strategy_type || "dip_buying",
        parameters: params,
        results,
        trades,
        equity_curve: equityCurve,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("[/api/backtest] Error:", error);
    return NextResponse.json(
      { error: "Backtest failed. Try again later." },
      { status: 502 }
    );
  }
}
