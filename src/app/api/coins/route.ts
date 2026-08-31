import { NextResponse } from "next/server";
import { fetchTopCoins, type CoinMarket } from "@/lib/coingecko";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Rate limit: 30 requests per minute per IP
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

    const formatted = coins.map((c: CoinMarket) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: c.image,
      current_price: round2(c.current_price),
      market_cap: round2(c.market_cap),
      market_cap_rank: c.market_cap_rank,
      price_change_percentage_1h: round2(c.price_change_percentage_1h_in_currency),
      price_change_percentage_24h: round2(c.price_change_percentage_24h_in_currency),
      price_change_percentage_7d: round2(c.price_change_percentage_7d_in_currency),
      total_volume: round2(c.total_volume),
      high_24h: round2(c.high_24h),
      low_24h: round2(c.low_24h),
      sparkline_7d: c.sparkline_in_7d?.price || null,
    }));

    return NextResponse.json(
      { coins: formatted, last_updated: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("[/api/coins] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch coin data. Please try again later." },
      { status: 502 }
    );
  }
}

function round2(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}
