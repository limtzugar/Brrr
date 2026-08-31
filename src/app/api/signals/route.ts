import { NextResponse } from "next/server";
import { fetchTopCoins, type CoinMarket } from "@/lib/coingecko";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ─── Signal Classification ──────────────────────────────────────────────────

type SignalType = "buy_signal" | "alert" | "watch";

interface DipSignal {
  coin_id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_1h: number | null;
  price_change_24h: number | null;
  price_change_7d: number | null;
  volume_24h: number;
  market_cap_rank: number;
  signal_type: SignalType;
  estimated_rsi: number;
  volume_vs_avg: number;
  high_24h: number;
  low_24h: number;
  sparkline_7d: number[] | null;
}

function estimateRSI(priceChange24h: number | null): number {
  if (priceChange24h === null) return 50;
  const rsi = 50 + priceChange24h * 2;
  return round2(Math.max(0, Math.min(100, rsi))) ?? 0;
}

function classifySignal(
  change1h: number | null,
  change24h: number | null,
  rsi: number
): SignalType | null {
  // We use 24h drop as the PRIMARY signal — 1h is supplementary
  // This is more practical: big 24h drops happen regularly, while
  // requiring both 1h AND 24h to be extreme simultaneously is too rare.

  if (change24h === null) return null;

  // BUY SIGNAL: Capitulation — massive 24h dump
  // 24h <= -15% OR (24h <= -10% AND 1h <= -5% AND RSI < 25)
  if (change24h <= -15) {
    return "buy_signal";
  }
  if (change24h <= -10 && change1h !== null && change1h <= -5 && rsi < 25) {
    return "buy_signal";
  }

  // ALERT: Real dip — significant 24h drop with momentum
  // 24h <= -8% OR (24h <= -5% AND 1h <= -3%)
  if (change24h <= -8) {
    return "alert";
  }
  if (change24h <= -5 && change1h !== null && change1h <= -3) {
    return "alert";
  }

  // WATCH: Mild dip — worth keeping an eye on
  // 24h <= -5% OR (24h <= -3% AND 1h <= -2%)
  if (change24h <= -5) {
    return "watch";
  }
  if (change24h <= -3 && change1h !== null && change1h <= -2) {
    return "watch";
  }

  return null;
}

// ─── Endpoint ───────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    // Rate limit: 30 requests per minute per IP (read-only, less expensive)
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateResult = checkRateLimit(ip, 30, 60 * 1000);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": "60" },
        }
      );
    }

    const coins = await fetchTopCoins(100);

    // Calculate average volume for volume_vs_avg ratio
    const volumes = coins
      .map((c: CoinMarket) => c.total_volume)
      .filter((v: number) => v > 0);
    const avgVolume = volumes.length > 0 ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length : 1;

    const signals: DipSignal[] = [];

    for (const coin of coins) {
      const change1h = coin.price_change_percentage_1h_in_currency;
      const change24h = coin.price_change_percentage_24h_in_currency;
      const change7d = coin.price_change_percentage_7d_in_currency;

      const rsi = estimateRSI(change24h);
      const signalType = classifySignal(change1h, change24h, rsi);

      if (signalType) {
        signals.push({
          coin_id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          image: coin.image,
          current_price: round2(coin.current_price) ?? 0,
          price_change_1h: round2(change1h),
          price_change_24h: round2(change24h),
          price_change_7d: round2(change7d),
          volume_24h: round2(coin.total_volume) ?? 0,
          market_cap_rank: coin.market_cap_rank,
          signal_type: signalType,
          estimated_rsi: rsi,
          volume_vs_avg: round2(coin.total_volume / avgVolume) ?? 0,
          high_24h: round2(coin.high_24h) ?? 0,
          low_24h: round2(coin.low_24h) ?? 0,
          sparkline_7d: coin.sparkline_in_7d?.price || null,
        });
      }
    }

    // Sort by signal severity: buy_signal first, then alert, then watch
    const order: Record<SignalType, number> = { buy_signal: 0, alert: 1, watch: 2 };
    signals.sort((a, b) => order[a.signal_type] - order[b.signal_type]);

    return NextResponse.json(
      {
        signals,
        summary: {
          total_signals: signals.length,
          buy_signals: signals.filter((s) => s.signal_type === "buy_signal").length,
          alerts: signals.filter((s) => s.signal_type === "alert").length,
          watches: signals.filter((s) => s.signal_type === "watch").length,
        },
        last_updated: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("[/api/signals] Error:", error);
    return NextResponse.json(
      { error: "Failed to analyze dip signals. Please try again later." },
      { status: 502 }
    );
  }
}

function round2(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}
