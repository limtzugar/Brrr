import { NextResponse } from "next/server";
import { THEMES, THEME_CONNECTIONS, WHAT_IF_SCENARIOS, runMonteCarlo, estimateParams } from "@/lib/market-analysis-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 20, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "themes";

    switch (action) {
      case "themes": {
        const themes = THEMES.map(t => ({
          id: t.id,
          name: t.name,
          color: t.color,
          pixelIcon: t.pixelIcon,
          subThemes: t.subThemes,
          companies: t.companies.map(c => ({
            symbol: c.symbol,
            name: c.name,
            marketCap: c.marketCap,
            sector: c.sector,
            relevance: c.relevance,
          })),
        }));
        return NextResponse.json({ themes, connections: THEME_CONNECTIONS });
      }

      case "scenarios": {
        return NextResponse.json({ scenarios: WHAT_IF_SCENARIOS });
      }

      case "monte_carlo": {
        const symbol = url.searchParams.get("symbol") || "NVDA";
        const horizon = Number(url.searchParams.get("horizon") || 30);
        const change24h = Number(url.searchParams.get("change24h") || 0);
        const change7d = Number(url.searchParams.get("change7d") || 0);
        const price = Number(url.searchParams.get("price") || 100);

        // Clamp horizon
        const safeHorizon = Math.max(7, Math.min(90, horizon));
        const { dailyReturn, dailyVol } = estimateParams(change24h, change7d);
        const result = runMonteCarlo(price, dailyReturn, dailyVol, safeHorizon, 300);

        return NextResponse.json({
          symbol,
          monteCarlo: {
            median: result.median,
            p5: result.p5,
            p25: result.p25,
            p75: result.p75,
            p95: result.p95,
            currentPrice: result.currentPrice,
            chanceUp: Math.round(result.chanceUp * 10) / 10,
            finalMedian: Math.round(result.finalMedian * 100) / 100,
            horizon: result.horizon,
          },
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[/api/market-analysis] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
