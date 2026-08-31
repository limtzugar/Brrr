import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
let cachedData: { data: unknown; timestamp: number } | null = null

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 30, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  try {
    // Return cached data if still fresh
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
      return NextResponse.json(cachedData.data)
    }

    // Try primary API first, fallback to alternative endpoint
    const endpoints = [
      'https://api.alternativeme.dev/fng/?limit=30&format=json',
      'https://api.alternative.me/fng/?limit=30&format=json',
    ]

    let data: unknown = null
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          next: { revalidate: 300 },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          data = await res.json()
          break
        }
      } catch {
        // Try next endpoint
        continue
      }
    }

    if (!data) {
      // Return stale cache if available
      if (cachedData) {
        return NextResponse.json(cachedData.data)
      }
      // Return neutral fallback (value=50, Neutral) so scoring still works
      return NextResponse.json({
        data: [{ value: '50', value_classification: 'Neutral', timestamp: Math.floor(Date.now() / 1000).toString(), time_until_update: '300' }],
        metadata: { error: 'external_api_unreachable', notice: 'Using neutral fallback value' }
      })
    }

    cachedData = { data, timestamp: Date.now() }

    return NextResponse.json(data)
  } catch {
    // Return stale cache on error
    if (cachedData) {
      return NextResponse.json(cachedData.data)
    }
    return NextResponse.json({ error: 'Failed to fetch Fear & Greed data' }, { status: 500 })
  }
}
