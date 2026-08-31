// ─── Market Regime Analysis API ──────────────────────────────────────────────
// GET /api/regime/analysis?symbol=BTCUSDT
//
// Pobiera świece 5m of Bybit public API, oblicza cechy (returns, volatility, ATR,
// momentum), a następnie uruchamia uproszczony ukryty model Markova (HMM)
// w TypeScripcie of 3 reżimami: KONSOLIDACJA / TREND / PANIKA.
//
// READ-ONLY — nie składa żadnych zleceń, nie wymaga kluczy API.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── Typy ────────────────────────────────────────────────────────────────────

interface Kline {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface RegimeResult {
  symbol: string
  regime: 'KONSOLIDACJA' | 'TREND' | 'PANIKA'
  probabilities: { KONSOLIDACJA: number; TREND: number; PANIKA: number }
  confidence: number
  volatilityPct: number
  momentumPct: number
  atrPct: number
  currentPrice: number
  candlesUsed: number
  modelConverged: boolean
  timestamp: number
}

// ─── Bybit Kline Fetcher ─────────────────────────────────────────────────────

const BYBIT_KLINE_URL = 'https://api.bybit.com/v5/market/kline'

async function fetchBybitKlines(symbol: string, totalCandles = 200): Promise<Kline[]> {
  // 200 × 5min = ~16.7h — wystarczająco dla HMM, a oszczędza pamięć
  const url = `${BYBIT_KLINE_URL}?category=linear&symbol=${symbol}&interval=5&limit=${Math.min(totalCandles, 200)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Bybit API error: ${res.status}`)

  const data = await res.json()
  if (data.retCode !== 0) throw new Error(`Bybit error: ${data.retMsg}`)

  const rows: any[][] = data.result.list
  if (!rows || rows.length === 0) return []

  // Sort chronologicznie (Bybit zwraca od najnowszych)
  rows.sort((a, b) => parseInt(a[0]) - parseInt(b[0]))

  return rows.map(r => ({
    openTime: parseInt(r[0]),
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
  }))
}

// ─── Feature Engineering ─────────────────────────────────────────────────────

interface Features {
  returns: number[]
  volatility20: number[]
  atrPct: number[]
  momentum10: number[]
  closes: number[]
}

function computeFeatures(klines: Kline[]): Features {
  // Log-returns
  const returns: number[] = []
  for (let i = 1; i < klines.length; i++) {
    returns.push(Math.log(klines[i].close / klines[i - 1].close))
  }

  // Rolling volatility (20-period, annualized %) — incremental, zero-allocation
  const volatility20: number[] = []
  const sqrt288 = Math.sqrt(288) // 288 × 5min = 24h
  if (returns.length >= 20) {
    let sum = 0, sumSq = 0
    for (let i = 0; i < 20; i++) { sum += returns[i]; sumSq += returns[i] ** 2 }
    for (let i = 19; i < returns.length; i++) {
      if (i > 19) {
        sum += returns[i] - returns[i - 20]
        sumSq += returns[i] ** 2 - returns[i - 20] ** 2
      }
      const mean = sum / 20
      const variance = sumSq / 20 - mean * mean
      volatility20.push(Math.sqrt(Math.max(variance, 0)) * sqrt288 * 100)
    }
  }

  // ATR(14) as % of close
  const atrPct: number[] = []
  for (let i = 14; i < klines.length; i++) {
    const trs: number[] = []
    for (let j = i - 13; j <= i; j++) {
      const tr = Math.max(
        klines[j].high - klines[j].low,
        Math.abs(klines[j].high - klines[j - 1].close),
        Math.abs(klines[j].low - klines[j - 1].close),
      )
      trs.push(tr)
    }
    const atr = trs.reduce((s, v) => s + v, 0) / 14
    atrPct.push((atr / klines[i].close) * 100)
  }

  // Momentum (10-period return %)
  const momentum10: number[] = []
  for (let i = 10; i < klines.length; i++) {
    momentum10.push(((klines[i].close / klines[i - 10].close) - 1) * 100)
  }

  // Align: wszystkie mają różne starty → weź overlapping
  // Wszystkie arrays kończą się on tym samym indeksie klines
  // returns: [1..N-1], vol20: [20..N-1], atrPct: [15..N-1], mom10: [11..N-1]
  // → ostatni element każdego jest ten sam (ostatnia świeca)
  return {
    returns,
    volatility20,
    atrPct,
    momentum10,
    closes: klines.map(k => k.close),
  }
}

// ─── Simplified Hidden Markov Model (Viterbi-like) ───────────────────────────
// Zamiast pełnego EM (który jest powolny i niestabilny w TS),
// używamy GMM (Gaussian Mixture Model) on zwinność + momentum do inicjalizacji
// 3 komponentów, a potem Viterbi on łańcuchu Markova of empirycznymi przejściami.

interface HMMState {
  mu: number
  sigma: number
}

function fitRegimeHMM(returns: number[], volatilities: number[]): {
  states: number[]
  params: HMMState[]
  transitionMatrix: number[][]
} | null {
  const N = Math.min(returns.length, volatilities.length)
  if (N < 80) return null

  // Używamy volatilities jako obserwacji — to odróżnia reżimy najlepiej
  const obs = volatilities.slice(-N)

  // K-means++ init on 3 klastry
  const nStates = 3

  // Wybierz 3初始 centroidy (k-means++)
  const centroids: number[] = []
  // Pierwszy centroid — losowy (ale powtarzalny)
  centroids.push(obs[Math.floor(N * 0.1)])
  // Drugi — najdalszy od pierwszego
  let maxDist = -1
  let maxIdx = 1
  for (let i = 0; i < N; i++) {
    const d = Math.abs(obs[i] - centroids[0])
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  centroids.push(obs[maxIdx])
  // Trzeci — najdalszy od obu
  maxDist = -1
  maxIdx = 2
  for (let i = 0; i < N; i++) {
    const d = Math.min(Math.abs(obs[i] - centroids[0]), Math.abs(obs[i] - centroids[1]))
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  centroids.push(obs[maxIdx])

  // Sortuj centroidy rosnąco (KONSOLIDACJA < TREND < PANIKA)
  centroids.sort((a, b) => a - b)

  // EM: kilka iteracji k-means — zero-allocation update (no .filter())
  const assignments = new Array(N).fill(0)
  const sums = new Array(nStates).fill(0)
  const counts = new Array(nStates).fill(0)
  for (let iter = 0; iter < 10; iter++) {
    // Assign
    for (let i = 0; i < N; i++) {
      let minD = Infinity
      for (let k = 0; k < nStates; k++) {
        const d = (obs[i] - centroids[k]) ** 2
        if (d < minD) { minD = d; assignments[i] = k }
      }
    }
    // Update centroids — without allocating intermediate arrays
    sums.fill(0); counts.fill(0)
    for (let i = 0; i < N; i++) {
      const k = assignments[i]
      sums[k] += obs[i]; counts[k]++
    }
    for (let k = 0; k < nStates; k++) {
      if (counts[k] > 2) centroids[k] = sums[k] / counts[k]
    }
  }

  // Oblicz parametry Gaussa per stan — zero-allocation
  const params: HMMState[] = []
  for (let k = 0; k < nStates; k++) {
    let sumK = 0, sumSqK = 0, cntK = 0
    for (let i = 0; i < N; i++) {
      if (assignments[i] === k) { sumK += obs[i]; sumSqK += obs[i] ** 2; cntK++ }
    }
    if (cntK < 5) {
      params.push({ mu: centroids[k], sigma: 0.5 })
      continue
    }
    const mu = sumK / cntK
    const variance = sumSqK / cntK - mu * mu
    params.push({ mu, sigma: Math.sqrt(Math.max(variance, 0.01)) })
  }

  // Oblicz macierz przejść of przypisań
  const transCount = Array.from({ length: nStates }, () => new Array(nStates).fill(1)) // Laplace smoothing
  for (let i = 1; i < N; i++) {
    transCount[assignments[i - 1]][assignments[i]]++
  }
  const transitionMatrix = transCount.map(row => {
    const sum = row.reduce((s, v) => s + v, 0)
    return row.map(v => v / sum)
  })

  // Forward algorithm: oblicz smoothed probabilities dla ostatniego okresu
  // (Właściwie używamy Viterbi dla całej sekwencji)
  // Dla wydajności: tylko Forward on ostatnich 100 obserwacjach

  return { states: assignments, params, transitionMatrix }
}

function computeForwardProbabilities(
  obs: number[],
  params: HMMState[],
  transitionMatrix: number[][],
): number[] {
  // Returns only the last time-step probabilities (we don't need full alpha matrix)
  const N = obs.length
  const K = params.length

  // Pre-compute emission constants
  const invSqrt2Pi = 1 / Math.sqrt(2 * Math.PI)
  const invSigma = params.map(p => 1 / p.sigma)
  const invSigmaSq = params.map(p => 1 / (p.sigma * p.sigma))

  // Emission probability (unnormalized — normalization cancels in forward scaling)
  const emit = (o: number, k: number) => {
    const diff = o - params[k].mu
    return Math.exp(-0.5 * diff * diff * invSigmaSq[k]) * invSigma[k] * invSqrt2Pi
  }

  // Only keep current and previous alpha (2 vectors instead of N×K matrix)
  const prev = new Array(K).fill(0)
  const curr = new Array(K).fill(0)

  // Init: uniform prior
  for (let k = 0; k < K; k++) {
    prev[k] = (1 / K) * emit(obs[0], k)
  }
  let sum = prev.reduce((s, v) => s + v, 0)
  if (sum > 0) for (let k = 0; k < K; k++) prev[k] /= sum

  // Recurse
  for (let t = 1; t < N; t++) {
    for (let k = 0; k < K; k++) {
      let a = 0
      for (let j = 0; j < K; j++) {
        a += prev[j] * transitionMatrix[j][k]
      }
      curr[k] = a * emit(obs[t], k)
    }
    sum = curr.reduce((s, v) => s + v, 0)
    if (sum > 0) for (let k = 0; k < K; k++) curr[k] /= sum
    // Swap
    for (let k = 0; k < K; k++) prev[k] = curr[k]
  }

  return prev
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { result: RegimeResult; timestamp: number }>()
const CACHE_TTL = 55_000 // 55s — just under the 60s update cycle

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol') || 'BTCUSDT'

  // Check cache
  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ ...cached.result, cached: true })
  }

  try {
    // 1. Fetch klines (200 × 5min ≈ 16.7h)
    const klines = await fetchBybitKlines(symbol, 200)
    if (klines.length < 60) {
      return NextResponse.json({ error: 'Not enough kline data', symbol, regime: 'KONSOLIDACJA', probabilities: { KONSOLIDACJA: 1, TREND: 0, PANIKA: 0 }, confidence: 0, timestamp: Date.now() }, { status: 502 })
    }

    // 2. Feature engineering
    const features = computeFeatures(klines)

    // 3. Align features — use the last N where all overlap
    const minLen = Math.min(
      features.volatility20.length,
      features.atrPct.length,
      features.momentum10.length,
      features.returns.length,
    )

    const volSlice = features.volatility20.slice(-minLen)
    const retSlice = features.returns.slice(-minLen)

    // 4. Fit HMM
    const hmmResult = fitRegimeHMM(retSlice, volSlice)

    let probabilities: { KONSOLIDACJA: number; TREND: number; PANIKA: number }
    let regime: RegimeResult['regime']
    let modelConverged = false

    if (hmmResult) {
      modelConverged = true

      // Compute forward probabilities — returns last time-step only
      const recentObs = volSlice.slice(-80)
      const lastProbs = computeForwardProbabilities(recentObs, hmmResult.params, hmmResult.transitionMatrix)

      // Map: state 0 (lowest sigma) → KONSOLIDACJA, state 1 → TREND, state 2 (highest sigma) → PANIKA
      // params are already sorted by mu (which corresponds to volatility level)
      probabilities = {
        KONSOLIDACJA: lastProbs[0],
        TREND: lastProbs[1],
        PANIKA: lastProbs[2],
      }

      // Dominant regime
      const maxProb = Math.max(probabilities.KONSOLIDACJA, probabilities.TREND, probabilities.PANIKA)
      regime = probabilities.KONSOLIDACJA === maxProb ? 'KONSOLIDACJA'
        : probabilities.TREND === maxProb ? 'TREND' : 'PANIKA'
    } else {
      // Fallback: rule-based on volatility
      const lastVol = volSlice[volSlice.length - 1] || 0
      if (lastVol < 30) {
        regime = 'KONSOLIDACJA'
        probabilities = { KONSOLIDACJA: 0.7, TREND: 0.25, PANIKA: 0.05 }
      } else if (lastVol < 80) {
        regime = 'TREND'
        probabilities = { KONSOLIDACJA: 0.15, TREND: 0.70, PANIKA: 0.15 }
      } else {
        regime = 'PANIKA'
        probabilities = { KONSOLIDACJA: 0.05, TREND: 0.25, PANIKA: 0.70 }
      }
    }

    // Momentum correction: if KONSOLIDACJA but strong momentum → TREND
    const lastMom = features.momentum10[features.momentum10.length - 1] || 0
    const confidence = Math.max(probabilities.KONSOLIDACJA, probabilities.TREND, probabilities.PANIKA)

    if (regime === 'KONSOLIDACJA' && Math.abs(lastMom) > 0.5 && confidence < 0.80) {
      regime = 'TREND'
      const shift = probabilities.KONSOLIDACJA * 0.5
      probabilities = {
        KONSOLIDACJA: probabilities.KONSOLIDACJA - shift,
        TREND: probabilities.TREND + shift,
        PANIKA: probabilities.PANIKA,
      }
    }

    // Normalize probabilities
    const pSum = probabilities.KONSOLIDACJA + probabilities.TREND + probabilities.PANIKA
    if (pSum > 0) {
      probabilities = {
        KONSOLIDACJA: probabilities.KONSOLIDACJA / pSum,
        TREND: probabilities.TREND / pSum,
        PANIKA: probabilities.PANIKA / pSum,
      }
    }

    const result: RegimeResult = {
      symbol,
      regime,
      probabilities,
      confidence: Math.max(probabilities.KONSOLIDACJA, probabilities.TREND, probabilities.PANIKA),
      volatilityPct: volSlice[volSlice.length - 1] || 0,
      momentumPct: lastMom,
      atrPct: features.atrPct[features.atrPct.length - 1] || 0,
      currentPrice: klines[klines.length - 1].close,
      candlesUsed: klines.length,
      modelConverged,
      timestamp: Date.now(),
    }

    // Cache
    cache.set(symbol, { result, timestamp: Date.now() })

    return NextResponse.json({ ...result, cached: false })
  } catch (error: any) {
    console.error('[/api/regime/analysis] error:', error.message)

    // Return cached if available
    if (cached) {
      return NextResponse.json({ ...cached.result, cached: true, stale: true, error: error.message })
    }

    return NextResponse.json({
      error: `Regime analysis error: ${error.message}`,
      symbol,
      regime: 'KONSOLIDACJA',
      probabilities: { KONSOLIDACJA: 0.5, TREND: 0.3, PANIKA: 0.2 },
      confidence: 0,
      volatilityPct: 0,
      momentumPct: 0,
      atrPct: 0,
      currentPrice: 0,
      candlesUsed: 0,
      modelConverged: false,
      timestamp: Date.now(),
    }, { status: 502 })
  }
}
