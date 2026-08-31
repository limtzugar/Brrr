// CoinGecko API Client with in-memory cache and retry logic

const BASE_URL = "https://api.coingecko.com/api/v3";

// ─── In-Memory Cache ────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// Prune expired cache entries every 60s to prevent unbounded growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) cache.delete(key)
    }
  }, 60_000)
}

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── Fetch with Retry ───────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 3, baseBackoffMs = 1500): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Use a longer timeout for large chart responses (CoinGecko uses chunked encoding)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (res.status === 429) {
        // Rate limited — exponential backoff with jitter
        const wait = baseBackoffMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`[CoinGecko] 429 rate limited, retrying in ${Math.round(wait)}ms (attempt ${attempt}/${retries})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        throw new Error(`CoinGecko API error: ${res.status} ${res.statusText}`);
      }

      // Parse JSON — use text() first then JSON.parse to avoid timeout on streaming body
      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      if (attempt === retries) {
        throw err;
      }
      const wait = baseBackoffMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.warn(`[CoinGecko] Request failed, retrying in ${Math.round(wait)}ms (attempt ${attempt}/${retries})`, err);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("CoinGecko: exhausted all retries");
}

// ─── Public Helpers ─────────────────────────────────────────────────────────

// Coins excluded from the dashboard (gold-backed tokens, not crypto-native)
const EXCLUDED_COIN_IDS = new Set([
  'pax-gold',       // PAXG
  'tether-gold',    // XAUT
])

/** Fetch top N coins by market cap (excludes gold-backed tokens) */
export async function fetchTopCoins(perPage = 100, ttlMs = 60_000): Promise<CoinMarket[]> {
  const cacheKey = `top-coins:${perPage}`;
  const cached = getCached<CoinMarket[]>(cacheKey);
  if (cached) return cached;

  // Fetch more to compensate for excluded coins
  const fetchCount = perPage + EXCLUDED_COIN_IDS.size;
  const url = `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${fetchCount}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
  const data = (await fetchWithRetry(url)) as CoinMarket[];
  const filtered = data.filter(c => !EXCLUDED_COIN_IDS.has(c.id));
  const result = filtered.slice(0, perPage);
  setCache(cacheKey, result, ttlMs);
  return result;
}

/** Fetch historical market chart for a coin.
 *  For ≤90 days: hourly granularity (no interval param).
 *  For >90 days: daily granularity (interval=daily). */
export async function fetchMarketChart(
  coinId: string,
  days: number,
  useHourly = false,
  ttlMs = 600_000 // 10 min
): Promise<MarketChart> {
  const granTag = useHourly && days <= 90 ? "hourly" : "daily";
  const cacheKey = `chart:${coinId}:${days}:${granTag}`;
  const cached = getCached<MarketChart>(cacheKey);
  if (cached) return cached;

  // CoinGecko returns hourly data automatically when days ≤ 90 and no interval param
  const intervalParam = useHourly && days <= 90 ? "" : "&interval=daily";
  const url = `${BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}${intervalParam}`;
  const data = (await fetchWithRetry(url)) as MarketChart;
  setCache(cacheKey, data, ttlMs);
  return data;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  sparkline_in_7d?: {
    price: number[];
  };
}

export interface MarketChart {
  prices: [number, number][];    // [timestamp, price]
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

/** Lightweight coin market data (no sparkline) for large paginated fetches */
export interface CoinMarketLite {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_1h: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d: number | null;
  total_volume: number;
  high_24h: number;
  low_24h: number;
}

/** Fetch top N coins with pagination (up to 1000). No sparkline to reduce payload. */
export async function fetchTopCoinsPaginated(totalCount = 1000, ttlMs = 120_000): Promise<CoinMarketLite[]> {
  const cacheKey = `top-coins-pag:${totalCount}`;
  const cached = getCached<CoinMarketLite[]>(cacheKey);
  if (cached) return cached;

  const perPage = 250;
  const pagesNeeded = Math.ceil(totalCount / perPage);
  const allCoins: CoinMarketLite[] = [];

  for (let page = 1; page <= pagesNeeded; page++) {
    try {
      const fetchCount = perPage + EXCLUDED_COIN_IDS.size;
      const url = `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${fetchCount}&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d`;
      const data = (await fetchWithRetry(url)) as CoinMarket[];
      const filtered = data.filter(c => !EXCLUDED_COIN_IDS.has(c.id));

      for (const c of filtered) {
        allCoins.push({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          image: c.image,
          current_price: c.current_price,
          market_cap: c.market_cap,
          market_cap_rank: c.market_cap_rank,
          price_change_percentage_1h: c.price_change_percentage_1h_in_currency,
          price_change_percentage_24h: c.price_change_percentage_24h_in_currency,
          price_change_percentage_7d: c.price_change_percentage_7d_in_currency,
          total_volume: c.total_volume,
          high_24h: c.high_24h,
          low_24h: c.low_24h,
        });
      }

      if (allCoins.length >= totalCount) break;
    } catch (err) {
      console.warn(`[CoinGecko] Failed to fetch page ${page}:`, err);
      break;
    }
  }

  const result = allCoins.slice(0, totalCount);
  setCache(cacheKey, result, ttlMs);
  return result;
}
