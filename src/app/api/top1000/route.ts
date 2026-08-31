import { NextResponse } from "next/server";
import { fetchTopCoinsPaginated } from "@/lib/coingecko";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const rateResult = checkRateLimit(ip, 10, 60 * 1000);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const url = new URL(request.url);
    const count = Math.min(1000, Math.max(1, Number(url.searchParams.get("count") || 1000)));

    const coins = await fetchTopCoinsPaginated(count);

    const formatted = coins.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: c.image,
      current_price: round2(c.current_price),
      market_cap: round2(c.market_cap),
      market_cap_rank: c.market_cap_rank,
      price_change_percentage_1h: round2(c.price_change_percentage_1h),
      price_change_percentage_24h: round2(c.price_change_percentage_24h),
      price_change_percentage_7d: round2(c.price_change_percentage_7d),
      total_volume: round2(c.total_volume),
      high_24h: round2(c.high_24h),
      low_24h: round2(c.low_24h),
    }));

    return NextResponse.json(
      { coins: formatted, total: formatted.length, last_updated: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    console.error("[/api/top1000] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch top 1000 coin data." },
      { status: 502 }
    );
  }
}

function round2(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}
