// ─── Paper Trading Latency Simulator ────────────────────────────────────────
// Simulates realistic Bybit V5 API latencies for PAPER trading mode.
// Makes paper trading feel identical to real API — same phase transitions,
// same timing breakdowns, same cache behavior.
//
// Server: z.ai Beijing → Bybit Singapore (CN→SG RTT ~160-280ms, avg ~200ms)
// With occasional spikes from CN→SG infrastructure jitter.
//
// REAL Bybit V5 optimized flow benchmarks (CN→SG):
//   OPEN:  ~300-600ms (cached), ~600-1000ms (cache miss on new symbol)
//   CLOSE: ~400-600ms
//
// Phase breakdown for OPEN:
//   SIG:   3-15ms   (signal detection + handler dispatch)
//   QUEUE: 0-300ms  (bybitEnqueue throttle — 75ms between requests)
//   API:   300-700ms (instrument cache check + leverage set + place order)
//
// Phase breakdown for CLOSE:
//   SIG:   3-15ms
//   QUEUE: 0-300ms
//   API:   320-600ms (parallel: verify+cancel+instrument → close order)

// ─── Simulated Instrument Cache ─────────────────────────────────────────────
// Mirrors real bybit-instrument-cache behavior:
// - First call for a symbol: cache MISS → ~160-280ms API call (1 RTT CN→SG)
// - Subsequent calls: cache HIT → ~0ms
// - Cache expires after 1 hour (simulated)
const instrumentCache = new Map<string, { cachedAt: number }>()
const INSTRUMENT_CACHE_TTL_MS = 60 * 60 * 1000 // 1h

// ─── Simulated Leverage Cache ───────────────────────────────────────────────
// Mirrors real bybit-instrument-cache leverage behavior:
// - First setLeverage for symbol+value: cache MISS → ~160-320ms API call
// - Same leverage within 10min: cache HIT → ~0ms (skip)
// - Different leverage: cache MISS → ~160-320ms
const leverageCache = new Map<string, { leverage: number; cachedAt: number }>()
const LEVERAGE_CACHE_TTL_MS = 10 * 60 * 1000 // 10min

// ─── Random Helpers ─────────────────────────────────────────────────────────
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const randInt = (min: number, max: number) => Math.round(rand(min, max))

// Gaussian-ish distribution (sum of 3 randoms = roughly bell-shaped)
// Centered around (min+max)/2 with occasional outliers
const gaussRand = (min: number, max: number) => {
  const r1 = Math.random(), r2 = Math.random(), r3 = Math.random()
  const avg = (r1 + r2 + r3) / 3 // 0-1, bell-shaped around 0.5
  return min + avg * (max - min)
}

// ─── Open Flow Latency ──────────────────────────────────────────────────────
export interface OpenLatencyBreakdown {
  sigMs: number          // Signal detection → handler dispatch
  queueMs: number        // bybitEnqueue wait (0 if queue empty, ~75ms if busy)
  apiInstrumentMs: number  // getInstrumentInfo (0 if cached, 160-280ms if miss)
  apiLeverageMs: number    // setLeverage (0 if cached, 160-320ms if miss)
  apiOrderMs: number       // placeLinearOrder (always 180-380ms, peak ~260-330)
  apiMs: number           // Total API phase = instrument + leverage + order
  totalMs: number         // SIG + QUEUE + API
  cacheHit: {
    instrument: boolean
    leverage: boolean
  }
}

/**
 * Simulate realistic Bybit V5 OPEN position latency.
 * Tracks per-symbol cache state (instrument + leverage) just like real API.
 * Tuned for CN→SG network (Beijing→Singapore, RTT ~160-280ms).
 *
 * @param symbol   e.g. 'BTCUSDT'
 * @param leverage e.g. 10
 * @returns LatencyBreakdown with per-phase timing
 */
export function simulateOpenLatency(symbol: string, leverage: number): OpenLatencyBreakdown {
  const now = Date.now()

  // ── SIG phase: signal detection + handler dispatch ──
  const sigMs = randInt(3, 15)

  // ── QUEUE phase: bybitEnqueue throttle ──
  // In reality: 75ms gap between requests, so if queue has items, you wait.
  // CN→SG jitter can compress gaps — simulate higher queue times when busy.
  // 70% chance queue is near-empty (0-50ms), 30% chance busy (150-300ms)
  const queueMs = Math.random() < 0.7
    ? randInt(0, 50)     // queue mostly empty — immediate dispatch
    : randInt(150, 300)  // queue busy — wait for throttle gap + CN→SG jitter

  // ── API phase: instrument cache check ──
  const cachedInstr = instrumentCache.get(symbol)
  const instrCacheValid = cachedInstr && (now - cachedInstr.cachedAt) < INSTRUMENT_CACHE_TTL_MS
  // GET instrument: 1 RTT CN→SG = ~160-280ms
  const apiInstrumentMs = instrCacheValid ? 0 : Math.round(gaussRand(160, 280))
  if (!instrCacheValid) {
    instrumentCache.set(symbol, { cachedAt: now })
  }

  // ── API phase: leverage cache check ──
  const levKey = symbol
  const cachedLev = leverageCache.get(levKey)
  const levCacheValid = cachedLev
    && cachedLev.leverage === leverage
    && (now - cachedLev.cachedAt) < LEVERAGE_CACHE_TTL_MS
  // POST setLeverage: 1 RTT + Bybit processing = ~160-320ms
  const apiLeverageMs = levCacheValid ? 0 : Math.round(gaussRand(160, 320))
  if (!levCacheValid) {
    leverageCache.set(levKey, { leverage, cachedAt: now })
  }

  // ── API phase: place market order (always happens) ──
  // Bybit V5 market order on linear perps: 1 RTT + matching engine
  // CN→SG RTT ~200ms + Bybit processing ~30-80ms = typically 230-310ms
  // Bell-shaped distribution — most land around 260-330ms
  const apiOrderMs = Math.round(gaussRand(180, 380))

  const apiMs = apiInstrumentMs + apiLeverageMs + apiOrderMs
  const totalMs = sigMs + queueMs + apiMs

  return {
    sigMs,
    queueMs,
    apiInstrumentMs,
    apiLeverageMs,
    apiOrderMs,
    apiMs,
    totalMs,
    cacheHit: {
      instrument: !!instrCacheValid,
      leverage: !!levCacheValid,
    },
  }
}

// ─── Close Flow Latency ─────────────────────────────────────────────────────
export interface CloseLatencyBreakdown {
  sigMs: number          // Signal detection → handler dispatch
  queueMs: number        // bybitEnqueue wait
  apiParallelMs: number  // Promise.all(getPositions + cancelOrders + instrumentInfo)
  apiCloseMs: number     // closeLinearPosition (reduce-only market order)
  apiMs: number          // Total API phase = parallel + close
  totalMs: number        // SIG + QUEUE + API
}

/**
 * Simulate realistic Bybit V5 CLOSE position latency.
 * Close is faster than open because:
 *   1. Position verification + order cancellation + instrument info run in PARALLEL
 *   2. Only the close order is sequential
 * Tuned for CN→SG network (Beijing→Singapore, RTT ~160-280ms).
 *
 * @param symbol e.g. 'BTCUSDT'
 * @returns LatencyBreakdown with per-phase timing
 */
export function simulateCloseLatency(symbol: string): CloseLatencyBreakdown {
  // ── SIG phase ──
  const sigMs = randInt(3, 15)

  // ── QUEUE phase ──
  const queueMs = Math.random() < 0.7
    ? randInt(0, 50)
    : randInt(150, 300)

  // ── API phase: parallel calls ──
  // getLinearPositions: 1 RTT CN→SG = ~140-230ms
  // cancelAllLinearOrders: 1 RTT = ~140-200ms (may have none to cancel)
  // getInstrumentInfo: ~0ms (usually cached by now) or ~160-280ms (rare miss)
  // Promise.all takes as long as the slowest → typically getPositions dominates
  const getPositionsMs = Math.round(gaussRand(140, 230))
  const cancelOrdersMs = Math.round(gaussRand(140, 200))
  // Instrument is usually cached from open flow, but occasionally miss
  const instrMs = instrumentCache.has(symbol) ? 0 : Math.round(gaussRand(160, 280))
  const apiParallelMs = Math.max(getPositionsMs, cancelOrdersMs, instrMs)

  // ── API phase: close order ──
  // Reduce-only market close: 1 RTT + matching = ~180-360ms
  // Bell-shaped, peak ~260-320ms
  const apiCloseMs = Math.round(gaussRand(180, 360))

  const apiMs = apiParallelMs + apiCloseMs
  const totalMs = sigMs + queueMs + apiMs

  return {
    sigMs,
    queueMs,
    apiParallelMs,
    apiCloseMs,
    apiMs,
    totalMs,
  }
}

// ─── Cache Management ───────────────────────────────────────────────────────
/** Clear all simulated caches (useful for testing cache-miss paths) */
export function clearPaperLatencyCaches() {
  instrumentCache.clear()
  leverageCache.clear()
}

/** Get cache stats for debugging */
export function getPaperLatencyCacheStats() {
  return {
    instrumentCacheSize: instrumentCache.size,
    leverageCacheSize: leverageCache.size,
    instruments: [...instrumentCache.keys()],
    leverages: [...leverageCache.entries()].map(([k, v]) => `${k}:${v.leverage}`),
  }
}

// ─── Timing Helpers for setTimeout Chains ────────────────────────────────────
// These return ms delays for each phase transition, allowing the execution
// clock to animate through SIG → QUEUE → API → DONE realistically.

export interface OpenPhaseDelays {
  sigToQueueMs: number    // Delay before SIG → QUEUE transition
  queueToApiMs: number    // Delay before QUEUE → API transition
  apiToDoneMs: number     // Delay before API → DONE transition
  breakdown: OpenLatencyBreakdown
}

/** Get setTimeout delays for OPEN phase transitions */
export function getOpenPhaseDelays(symbol: string, leverage: number): OpenPhaseDelays {
  const breakdown = simulateOpenLatency(symbol, leverage)
  return {
    sigToQueueMs: breakdown.sigMs,
    queueToApiMs: breakdown.queueMs,
    apiToDoneMs: breakdown.apiMs,
    breakdown,
  }
}

export interface ClosePhaseDelays {
  sigToQueueMs: number
  queueToApiMs: number
  apiToDoneMs: number
  breakdown: CloseLatencyBreakdown
}

/** Get setTimeout delays for CLOSE phase transitions */
export function getClosePhaseDelays(symbol: string): ClosePhaseDelays {
  const breakdown = simulateCloseLatency(symbol)
  return {
    sigToQueueMs: breakdown.sigMs,
    queueToApiMs: breakdown.queueMs,
    apiToDoneMs: breakdown.apiMs,
    breakdown,
  }
}
