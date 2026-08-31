// ─── Bybit Instrument & Leverage Cache ──────────────────────────────────────
// Caches instrument info (qtyStep, tickSize, minOrderQty) and leverage per symbol.
// Instrument specs rarely change — 1h TTL is safe and saves ~150ms per API call.
// Leverage is idempotent — if already set, we skip the setLeverage() call entirely.

const INSTRUMENT_TTL = 3_600_000 // 1 hour — instrument specs are quasi-static
const LEVERAGE_TTL = 600_000     // 10 min — leverage might change between sessions

interface CachedInstrument {
  qtyStep: number
  minOrderQty: number
  qtyDecimals: number   // pre-computed: how many decimal places for qty
  tickSize: number
  priceDecimals: number // pre-computed: how many decimal places for price
  timestamp: number
}

interface CachedLeverage {
  leverage: number
  timestamp: number
}

// ── In-memory maps (per-process, survive across requests) ──
const instrumentCache = new Map<string, CachedInstrument>()
const leverageCache = new Map<string, CachedLeverage>()

// ── Instrument Info ──

export function getCachedInstrument(symbol: string): CachedInstrument | null {
  const cached = instrumentCache.get(symbol)
  if (!cached) return null
  if (Date.now() - cached.timestamp > INSTRUMENT_TTL) {
    instrumentCache.delete(symbol)
    return null
  }
  return cached
}

export function setCachedInstrument(
  symbol: string,
  qtyStep: number,
  minOrderQty: number,
  tickSize: number
): void {
  instrumentCache.set(symbol, {
    qtyStep,
    minOrderQty,
    qtyDecimals: computeDecimals(qtyStep),
    tickSize,
    priceDecimals: computeDecimals(tickSize),
    timestamp: Date.now(),
  })
}

/** Build CachedInstrument from raw Bybit instrument response */
export function setCachedInstrumentFromRaw(symbol: string, raw: any): void {
  const qtyStep = parseFloat(raw.lotSizeFilter.qtyStep)
  const minOrderQty = parseFloat(raw.lotSizeFilter.minOrderQty)
  const tickSize = parseFloat(raw.priceFilter.tickSize)
  setCachedInstrument(symbol, qtyStep, minOrderQty, tickSize)
}

/** Count decimal places in a number (e.g. 0.001 → 3, 1 → 0, 0.01 → 2) */
function computeDecimals(step: number): number {
  if (step >= 1) return 0
  const str = step.toString()
  const dotIdx = str.indexOf('.')
  if (dotIdx === -1) return 0
  // Trim trailing zeros: "0.100" → 1 decimal
  const afterDot = str.slice(dotIdx + 1).replace(/0+$/, '')
  return afterDot.length
}

// ── Leverage ──

export function getCachedLeverage(symbol: string, desiredLeverage: number): boolean {
  const cached = leverageCache.get(symbol)
  if (!cached) return false
  if (Date.now() - cached.timestamp > LEVERAGE_TTL) {
    leverageCache.delete(symbol)
    return false
  }
  return cached.leverage === desiredLeverage
}

export function setCachedLeverage(symbol: string, leverage: number): void {
  leverageCache.set(symbol, { leverage, timestamp: Date.now() })
}

/** Clear cached leverage for a specific symbol (useful before retry after error) */
export function clearCachedLeverage(symbol: string): void {
  leverageCache.delete(symbol)
}

/** Clear cached instrument for a specific symbol (useful before retry after qty error) */
export function clearCachedInstrument(symbol: string): void {
  instrumentCache.delete(symbol)
}

// ── Debug / Admin ──

export function getCacheStats() {
  return {
    instruments: instrumentCache.size,
    leverages: leverageCache.size,
    entries: {
      instruments: Array.from(instrumentCache.entries()).map(([sym, d]) => ({
        symbol: sym,
        qtyStep: d.qtyStep,
        tickSize: d.tickSize,
        ageMs: Date.now() - d.timestamp,
      })),
      leverages: Array.from(leverageCache.entries()).map(([sym, d]) => ({
        symbol: sym,
        leverage: d.leverage,
        ageMs: Date.now() - d.timestamp,
      })),
    },
  }
}

/** Clear all caches (useful after switching accounts or testnet↔mainnet) */
export function clearAllCaches(): void {
  instrumentCache.clear()
  leverageCache.clear()
}
