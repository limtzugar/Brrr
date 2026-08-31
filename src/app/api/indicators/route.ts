import { NextResponse } from "next/server";
import { fetchMarketChart } from "@/lib/coingecko";
import {
  computeMA,
  computeStdDev,
  computeHurstExponent,
  round4,
} from "@/lib/backtest-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ─── EMA Computation ────────────────────────────────────────────────────────

function computeEMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA value is the SMA of the first `period` prices
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sum += prices[i];
      result.push(null);
    } else if (i === period - 1) {
      sum += prices[i];
      const sma = sum / period;
      result.push(sma);
    } else {
      const prevEMA = result[i - 1]!;
      const ema = (prices[i] - prevEMA) * multiplier + prevEMA;
      result.push(ema);
    }
  }
  return result;
}

// ─── RSI Computation (Wilder's RSI, period 14) ──────────────────────────────

function computeRSI(prices: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];

  if (prices.length < period + 1) {
    return prices.map(() => null);
  }

  // Compute price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // First period: simple average of gains and losses
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill null for the first `period` entries (we need period changes, so index period in prices)
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // First RSI value at index `period`
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0);
  result.push(rsi0);

  // Subsequent RSI values using exponential smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push(rsi);
  }

  return result;
}

// ─── MACD Computation (12, 26, 9) ───────────────────────────────────────────

interface MACDPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

function computeMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDPoint[] {
  const emaFast = computeEMA(prices, fastPeriod);
  const emaSlow = computeEMA(prices, slowPeriod);

  // MACD line = EMA12 - EMA26
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i]! - emaSlow[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = 9-period EMA of MACD line
  // We need to extract non-null MACD values and compute EMA on them
  const validMacdValues: number[] = [];
  const validMacdIndices: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      validMacdValues.push(macdLine[i]!);
      validMacdIndices.push(i);
    }
  }

  const signalEma = computeEMA(validMacdValues, signalPeriod);

  // Build signal array aligned to original price indices
  const signalLine: (number | null)[] = new Array(prices.length).fill(null);
  for (let j = 0; j < validMacdIndices.length; j++) {
    signalLine[validMacdIndices[j]] = signalEma[j];
  }

  // Build result
  const result: MACDPoint[] = [];
  for (let i = 0; i < prices.length; i++) {
    const m = macdLine[i];
    const s = signalLine[i];
    result.push({
      macd: m !== null ? round4(m) : null,
      signal: s !== null ? round4(s) : null,
      histogram: m !== null && s !== null ? round4(m - s) : null,
    });
  }

  return result;
}

// ─── Bollinger Bands Computation (20, 2) ────────────────────────────────────

interface BBPoint {
  upper: number | null;
  middle: number | null;
  lower: number | null;
  price: number;
}

function computeBollingerBands(
  prices: number[],
  period: number = 20,
  stdMultiplier: number = 2
): BBPoint[] {
  const ma = computeMA(prices, period);
  const stdDev = computeStdDev(prices, period);

  const result: BBPoint[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (ma[i] !== null && stdDev[i] !== null) {
      const middle = ma[i]!;
      const sd = stdDev[i]!;
      result.push({
        upper: round4(middle + stdMultiplier * sd),
        middle: round4(middle),
        lower: round4(middle - stdMultiplier * sd),
        price: prices[i],
      });
    } else {
      result.push({
        upper: null,
        middle: null,
        lower: null,
        price: prices[i],
      });
    }
  }
  return result;
}

// ─── Downsampling Helper ────────────────────────────────────────────────────

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const result: T[] = [];
  for (let i = 0; i < arr.length; i += step) {
    result.push(arr[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== arr[arr.length - 1]) {
    result.push(arr[arr.length - 1]);
  }
  return result;
}

// ─── GET Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);

    // ─── Parse and validate query params ──────────────────────────────────
    const coinId = searchParams.get("coin_id");
    if (!coinId) {
      return NextResponse.json(
        { error: "Missing required query parameter: coin_id" },
        { status: 400 }
      );
    }

    const daysParam = searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 90;
    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { error: "Invalid 'days' parameter. Must be a number between 1 and 365." },
        { status: 400 }
      );
    }

    // Optional interval override: 'hourly' or 'daily'
    // If not provided, auto-select based on days (hourly for <=90, daily for >90)
    const intervalParam = searchParams.get("interval");
    const useHourly = intervalParam === 'hourly' ? true : intervalParam === 'daily' ? false : days <= 90;

    const indicatorsParam = searchParams.get("indicators") || "";
    const requestedIndicators = indicatorsParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const validIndicators = ["hurst", "rsi", "macd", "bb"];
    const invalidIndicators = requestedIndicators.filter(
      (ind) => !validIndicators.includes(ind)
    );
    if (invalidIndicators.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid indicator(s): ${invalidIndicators.join(", ")}. Valid indicators are: ${validIndicators.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // If no indicators specified, compute all
    const indicators = requestedIndicators.length > 0 ? requestedIndicators : validIndicators;

    // ─── Fetch historical price data ──────────────────────────────────────
    const chart = await fetchMarketChart(coinId, days, useHourly);

    if (!chart.prices || chart.prices.length < 10) {
      return NextResponse.json(
        { error: "Insufficient historical data for this coin." },
        { status: 404 }
      );
    }

    // Build price array
    const prices: number[] = [];
    const dates: string[] = [];
    for (const [ts, price] of chart.prices) {
      if (price > 0) {
        prices.push(price);
        dates.push(new Date(ts).toISOString());
      }
    }

    const dataPoints = prices.length;

    // ─── Compute requested indicators ─────────────────────────────────────
    const indicatorResults: Record<string, unknown[]> = {};

    if (indicators.includes("hurst")) {
      // Adapt Hurst window to data density: use 100 for hourly, scale down for daily
      const hurstWindow = useHourly ? 100 : Math.min(50, Math.floor(prices.length * 0.7));
      const hurstValues = hurstWindow >= 20 ? computeHurstExponent(prices, hurstWindow) : prices.map(() => null);
      const hurstData = dates
        .map((date, i) => ({
          date,
          value: hurstValues[i],
        }))
        .filter((p) => p.value !== null);
      indicatorResults.hurst = downsample(hurstData, 500);
    }

    if (indicators.includes("rsi")) {
      const rsiValues = computeRSI(prices, 14);
      const rsiData = dates
        .map((date, i) => ({
          date,
          value: rsiValues[i] !== null ? round4(rsiValues[i]!) : null,
        }))
        .filter((p) => p.value !== null);
      indicatorResults.rsi = downsample(rsiData, 500);
    }

    if (indicators.includes("macd")) {
      const macdValues = computeMACD(prices, 12, 26, 9);
      const macdData = dates
        .map((date, i) => ({
          date,
          macd: macdValues[i].macd,
          signal: macdValues[i].signal,
          histogram: macdValues[i].histogram,
        }))
        .filter((p) => p.macd !== null);
      indicatorResults.macd = downsample(macdData, 500);
    }

    if (indicators.includes("bb")) {
      const bbValues = computeBollingerBands(prices, 20, 2);
      const bbData = dates
        .map((date, i) => ({
          date,
          upper: bbValues[i].upper,
          middle: bbValues[i].middle,
          lower: bbValues[i].lower,
          price: bbValues[i].price,
        }))
        .filter((p) => p.upper !== null);
      indicatorResults.bb = downsample(bbData, 500);
    }

    // ─── Build price data for response (also downsample if needed) ────────
    const priceData = dates.map((date, i) => ({
      date,
      price: prices[i],
    }));

    // ─── Return response ──────────────────────────────────────────────────
    return NextResponse.json(
      {
        coin_id: coinId,
        days,
        interval: useHourly ? 'hourly' : 'daily',
        data_points: dataPoints,
        prices: downsample(priceData, 500),
        indicators: indicatorResults,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("[/api/indicators] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute indicators. Please try again later." },
      { status: 502 }
    );
  }
}
