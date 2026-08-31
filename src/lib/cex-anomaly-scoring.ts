// ─── CEX Anomaly — Confidence Scoring Engine ────────────────────────────────
// Two-layer confidence scoring system (pure function — no React, no side effects)
//
//   Layer B: Soft Scoring (max 17 pts, min 6 required to enter)
//     +3  Trigger quality (ABSORB/FUNDING=3, INFLOW=2, ICEBERG/OI=1)
//     +2  VWAP alignment (correct side=+2, wrong side=0)
//     +2  SMA 8/21 cross (trend-aligned=+2, opposite=0)
//     +2  Momentum (aligned=+2, neutral=+1, opposite=0)
//     +2  MACD histogram (aligned=+2, fresh cross=+1, opposing=0)
//     +2  RSI zone (favorable=+2, neutral=+1, opposing=0)
//     +1  Volume confirming (>150% avg=+1)
//     +1  Real source bonus
//     +2  Funnel convergence bonus
//
//   Layer C: Boosters (don't affect entry gate, raise CTP threshold)
//     +2  Multi-signal (2 different triggers within 5s)
//     +1  Edge pair (BTC, PEPE, FET, FIL whitelist)
//     +1  Spread tight (<0.02%=+1, >0.05%=-1)
//
//   Entry gate: Layer B ≥ MIN_SCORE (5)
//   CTP threshold: uses total score (Layer B + Layer C)

import type {
  AnomalyCategory,
  PositionSide,
  OrderFlowAnomaly,
  ConfidenceBreakdown,
  PairSimulation,
  OIFundingData,
  CrossExchangeSnapshot,
} from './cex-anomaly-types'
import {
  SCORING,
  TA_CONFIG,
  FUNNEL,
} from './cex-anomaly-constants'

// ─── Input context for scoring ───────────────────────────────────────────────

export interface ScoringContext {
  anomaly: OrderFlowAnomaly
  side: PositionSide
  sim: PairSimulation
  isReversal: boolean
  funnelConverged: boolean
  isWsAnchored: boolean
  activePairSymbol: string
  oiFundingData: Record<string, OIFundingData>
  crossExSnapshot: CrossExchangeSnapshot | null
  recentAnomaliesOnPair: OrderFlowAnomaly[]  // anomalies on same pair within window
  recentAnomaliesForCombo: OrderFlowAnomaly[] // anomalies on same pair within FUNNEL window
  /** Fear & Greed Index value (0-100). null = not available. Used as contrarian signal. */
  fearGreedValue: number | null
}

export interface ScoringResult {
  confidence: ConfidenceBreakdown
  comboBonus: number
  /** Whether Layer B meets MIN_SCORE gate */
  passesGate: boolean
}

// ─── Main scoring function ───────────────────────────────────────────────────

export function computeConfidence(ctx: ScoringContext): ScoringResult {
  const { anomaly, side, sim, isReversal, funnelConverged, isWsAnchored, oiFundingData, crossExSnapshot, recentAnomaliesOnPair, recentAnomaliesForCombo, fearGreedValue } = ctx
  const entryPrice = sim.price

  const confidence: ConfidenceBreakdown = {
    // Layer B
    triggerQuality: 0,
    vwapAlign: 0,
    smaAlign: 0,
    momAlign: 0,
    macdAlign: 0,
    rsiAlign: 0,
    volumeConfirm: 0,
    layerB: 0,
    // Layer C
    multiSignal: 0,
    edgePair: 0,
    spreadTight: 0,
    layerC: 0,
    // Legacy (derived)
    sizeThreshold: false,
    cvdDivergence: false,
    liqCluster: false,
    reconfirmed: false,
    crossExchange: false,
    taVwap: false,
    taMom: false,
    taSma: false,
    taMacd: false,
    taRsi: false,
    total: 0,
  }

  // ── Layer B.1: Trigger Quality (+1 to +3) ──
  const effectiveCategory = isReversal ? 'ICEBERG_REVERSAL' as const : anomaly.category
  let triggerPts = 0
  switch (effectiveCategory) {
    case 'AGGRESSIVE_ABSORPTION':
      triggerPts = SCORING.TRIGGER_ABSORB_PTS  // +3
      break
    case 'FUNDING_EXTREME': {
      const base = anomaly.pair.split('-')[0]
      const quote = anomaly.pair.split('-')[1]
      const ccxtSym = `${base}/${quote}:${quote}`
      const fundData = oiFundingData[ccxtSym]
      const absRate = fundData ? Math.abs(fundData.fundingRate) : 0
      triggerPts = absRate > 0.0005 ? SCORING.TRIGGER_FUNDING_PTS : SCORING.TRIGGER_OI_PTS  // +3 or +1
      break
    }
    case 'WHALE_INFLOW':
      triggerPts = SCORING.TRIGGER_INFLOW_PTS  // +2
      break
    case 'ICEBERG_DETECTED':
      triggerPts = SCORING.TRIGGER_ICEBERG_PTS  // +1
      break
    case 'ICEBERG_REVERSAL':
      triggerPts = SCORING.TRIGGER_ICE_REV_PTS  // +1
      break
    case 'OI_SPIKE':
      triggerPts = SCORING.TRIGGER_OI_PTS  // +1
      break
    case 'CROWD_BIAS':
      triggerPts = SCORING.TRIGGER_CROWD_PTS  // +2
      break
    case 'TAKER_IMBALANCE':
      triggerPts = SCORING.TRIGGER_TAKER_PTS  // +2
      break
    case 'LIQUIDATION_CASCADE':
      triggerPts = SCORING.TRIGGER_LIQ_CASCADE_PTS  // +3
      break
    case 'OI_VELOCITY':
      triggerPts = SCORING.TRIGGER_OI_VEL_PTS  // +1
      break
    case 'ORDERBOOK_IMBALANCE':
      triggerPts = SCORING.TRIGGER_OB_IMBAL_PTS  // +2
      break
    case 'WHALE_SWEEP':
      triggerPts = SCORING.TRIGGER_SWEEP_PTS  // +3
      break
  }
  confidence.triggerQuality = triggerPts
  confidence.sizeThreshold = triggerPts > 0  // legacy compat

  // ── Layer B.2: VWAP Alignment (+2 / 0) ──
  if (sim.vwap > 0) {
    const vwapConfirm = (side === 'LONG' && sim.price > sim.vwap) || (side === 'SHORT' && sim.price < sim.vwap)
    if (vwapConfirm) {
      confidence.vwapAlign = SCORING.VWAP_ALIGNED_PTS  // +2
      confidence.taVwap = true  // legacy
    } else {
      confidence.vwapAlign = SCORING.VWAP_MISALIGNED_PTS  // 0
    }
  }

  // ── Layer B.3: SMA 8/21 Cross (+2 / 0) ──
  // BUG FIX: SMA scoring was gated on isWsAnchored (only active pair with WS).
  // This caused signals like WHALE_INFLOW and ICEBERG_REVERSAL to always fail
  // the confidence gate on non-active pairs (SMA=0, MOM=0 → Layer B too low).
  // The simulation computes SMA for ALL pairs, so we can score them all.
  if (sim.priceHistory.length >= TA_CONFIG.SMA_SLOW) {
    const smaConfirm = (side === 'LONG' && sim.sma8 > sim.sma21) || (side === 'SHORT' && sim.sma8 < sim.sma21)
    if (smaConfirm) {
      confidence.smaAlign = SCORING.SMA_ALIGNED_PTS  // +2
      confidence.taSma = true  // legacy
    } else {
      confidence.smaAlign = SCORING.SMA_MISALIGNED_PTS  // 0
    }
  }

  // ── Layer B.4: Momentum (+2 / +1 / 0) ──
  // BUG FIX: Momentum scoring was gated on isWsAnchored (only active pair with WS).
  // This caused signals like WHALE_INFLOW and ICEBERG_REVERSAL to always fail
  // the confidence gate on non-active pairs (SMA=0, MOM=0 → Layer B too low).
  // The simulation computes momentum for ALL pairs, so we can score them all.
  if (sim.momentum !== 0 || sim.priceHistory.length > 0) {
    const mom = sim.momentum
    const momAligned = (side === 'LONG' && mom > SCORING.MOM_ALIGNED_THRESHOLD) ||
                       (side === 'SHORT' && mom < -SCORING.MOM_ALIGNED_THRESHOLD)
    const momOpposite = (side === 'LONG' && mom < -SCORING.MOM_ALIGNED_THRESHOLD) ||
                        (side === 'SHORT' && mom > SCORING.MOM_ALIGNED_THRESHOLD)
    if (momAligned) {
      confidence.momAlign = SCORING.MOM_ALIGNED_PTS  // +2
      confidence.taMom = true  // legacy
    } else if (momOpposite) {
      confidence.momAlign = SCORING.MOM_MISALIGNED_PTS  // 0
    } else {
      // Neutral momentum (|MOM| < 0.001)
      confidence.momAlign = SCORING.MOM_NEUTRAL_PTS  // +1
      confidence.taMom = true  // legacy: counts as "not opposing"
    }
  }

  // ── Layer B.5: MACD Confirmation (+2 / +1 / 0) ──
  // MACD histogram confirms trend direction on the SAME timeframe as VWAP/SMA/MOM.
  // +2: histogram aligned with trade direction (positive+LONG, negative+SHORT)
  // +1: fresh zero-cross in favorable direction (momentum shifting our way)
  //  0: histogram opposing (no Layer B penalty, but Layer C penalty applies)
  if (sim.priceHistory.length >= TA_CONFIG.MACD_SLOW) {
    const hist = sim.macdHistogram
    const histPrev = sim.macdHistPrev
    const macdAligned = (side === 'LONG' && hist > 0) || (side === 'SHORT' && hist < 0)
    const macdOpposing = (side === 'LONG' && hist < 0) || (side === 'SHORT' && hist > 0)
    // Fresh zero-cross: histogram just crossed zero in our direction
    const freshCrossUp = side === 'LONG' && histPrev <= 0 && hist > 0
    const freshCrossDn = side === 'SHORT' && histPrev >= 0 && hist < 0

    if (macdAligned) {
      confidence.macdAlign = freshCrossUp || freshCrossDn
        ? SCORING.MACD_ALIGNED_PTS  // +2 (aligned + fresh cross = strongest)
        : SCORING.MACD_ALIGNED_PTS  // +2 (aligned, no cross)
      confidence.taMacd = true
    } else if (freshCrossUp || freshCrossDn) {
      // Cross just happened but histogram magnitude is tiny — partial confirmation
      confidence.macdAlign = SCORING.MACD_CROSS_PTS  // +1
      confidence.taMacd = true
    } else if (macdOpposing) {
      confidence.macdAlign = SCORING.MACD_MISALIGNED_PTS  // 0
    }
    // If histogram is exactly 0, no signal (neutral)
  }

  // ── Layer B.6: RSI Confirmation (+2 / +1 / 0) ──
  // RSI confirms momentum quality on the SAME timeframe as VWAP/SMA/MOM.
  // +2: RSI in favorable zone (not overbought for LONG, not oversold for SHORT)
  // +1: RSI neutral (40-60 range — no strong signal either way)
  //  0: RSI opposing (overbought+LONG or oversold+SHORT — fighting momentum)
  if (sim.rsiWarmup > TA_CONFIG.RSI_PERIOD) {
    const rsi = sim.rsi
    // LONG: RSI not overbought (< 70) = room to grow, oversold (< 30) = bounce potential
    // SHORT: RSI not oversold (> 30) = room to fall, overbought (> 70) = reversal potential
    const rsiFavorsLong = rsi < TA_CONFIG.RSI_OVERBOUGHT  // not overbought = LONG OK
    const rsiFavorsShort = rsi > TA_CONFIG.RSI_OVERSOLD   // not oversold = SHORT OK
    const rsiOverbought = rsi >= TA_CONFIG.RSI_OVERBOUGHT
    const rsiOversold = rsi <= TA_CONFIG.RSI_OVERSOLD

    if ((side === 'LONG' && rsiFavorsLong) || (side === 'SHORT' && rsiFavorsShort)) {
      // RSI in favorable zone — full confirmation
      confidence.rsiAlign = SCORING.RSI_ALIGNED_PTS  // +2
      confidence.taRsi = true
    } else if (rsi >= 40 && rsi <= 60) {
      // RSI neutral — no strong signal, slight positive
      confidence.rsiAlign = SCORING.RSI_NEUTRAL_PTS  // +1
      confidence.taRsi = true
    } else if ((side === 'LONG' && rsiOverbought) || (side === 'SHORT' && rsiOversold)) {
      // RSI opposing — overbought LONG or oversold SHORT = fighting momentum
      confidence.rsiAlign = SCORING.RSI_MISALIGNED_PTS  // 0
    }
  }

  // ── Layer B.5: Volume Confirming (+1) ──
  {
    const cvdData = sim.cvdData
    if (cvdData.length >= 10) {
      const lastVol = Math.abs(cvdData[cvdData.length - 1].cvdDelta)
      const avgVol = cvdData.slice(-10).reduce((s, d) => s + Math.abs(d.cvdDelta), 0) / 10
      if (avgVol > 0 && lastVol > avgVol * SCORING.VOLUME_CONFIRM_RATIO) {
        confidence.volumeConfirm = SCORING.VOLUME_CONFIRM_PTS  // +1
      }
    }
  }

  // ── Layer B.6: Real Source Bonus (+1) ──
  const realSourceBonus = anomaly.source === 'REAL' ? 1 : 0

  // ── Layer B.7: Funnel Convergence Bonus (+2) ──
  const hasConvergence = funnelConverged
  const convergenceBonus = hasConvergence ? 2 : 0

  // ── Layer B subtotal ──
  confidence.layerB = confidence.triggerQuality + confidence.vwapAlign + confidence.smaAlign +
                      confidence.momAlign + confidence.macdAlign + confidence.rsiAlign +
                      confidence.volumeConfirm + realSourceBonus + convergenceBonus

  // ── Layer C.1: Multi-Signal (+2) ──
  {
    const now = Date.now()
    const recentCats = new Set(recentAnomaliesOnPair
      .filter(a => a.id !== anomaly.id && (now - a.timestamp) < SCORING.MULTI_SIGNAL_WINDOW_MS)
      .map(a => a.category))
    recentCats.add(anomaly.category)
    if (recentCats.size >= 2) {
      confidence.multiSignal = SCORING.MULTI_SIGNAL_PTS  // +2
      confidence.cvdDivergence = true  // legacy
      confidence.reconfirmed = true  // legacy
    }
  }

  // ── Layer C.2: Edge Pair (+1) ──
  if ((SCORING.EDGE_PAIR_WHITELIST as readonly string[]).includes(anomaly.pair)) {
    confidence.edgePair = SCORING.EDGE_PAIR_PTS  // +1
  }

  // ── Layer C.3: Spread Tight (+1 / -1) ──
  {
    if (crossExSnapshot && crossExSnapshot.pair === anomaly.pair) {
      const depth = crossExSnapshot.depths[0]
      if (depth && depth.bestBid > 0 && depth.bestAsk > 0) {
        const spread = (depth.bestAsk - depth.bestBid) / ((depth.bestAsk + depth.bestBid) / 2)
        if (spread < SCORING.SPREAD_TIGHT_THRESHOLD) {
          confidence.spreadTight = SCORING.SPREAD_TIGHT_PTS  // +1
          confidence.crossExchange = true  // legacy
        } else if (spread > SCORING.SPREAD_WIDE_THRESHOLD) {
          confidence.spreadTight = SCORING.SPREAD_WIDE_PTS  // -1
        }
      }
    }
    // Fallback: assume tight spread for major pairs
    if (confidence.spreadTight === 0) {
      const isMajor = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT'].includes(anomaly.pair)
      if (isMajor) {
        confidence.spreadTight = SCORING.SPREAD_TIGHT_PTS  // +1
        confidence.crossExchange = true  // legacy
      }
    }
  }

  // ── Layer C.4: Fear & Greed Contrarian Bonus (+1) ──
  // Extreme Fear (0-25): market is oversold → LONG signals get +1 contrarian bonus
  // Extreme Greed (75-100): market is overbought → SHORT signals get +1 contrarian bonus
  // This is a Layer C booster — doesn't affect entry gate, but raises total score
  // and therefore CTP threshold (stronger conviction = more patience for profit).
  let fearGreedBonus = 0
  {
    if (fearGreedValue !== null) {
      const isExtremeFear = fearGreedValue <= 25
      const isExtremeGreed = fearGreedValue >= 75
      // Contrarian: trade AGAINST the crowd sentiment
      if (isExtremeFear && side === 'LONG') {
        // Market in extreme fear → LONG is contrarian → +1
        fearGreedBonus = 1
      } else if (isExtremeGreed && side === 'SHORT') {
        // Market in extreme greed → SHORT is contrarian → +1
        fearGreedBonus = 1
      }
      // Momentum alignment bonus (weaker signal):
      // Moderate fear (25-40) + LONG = slight confirmation (+0.5 rounded to 0 for integer)
      // Moderate greed (60-75) + SHORT = slight confirmation
      // We don't apply fractional points — only extreme values count.
    }
  }

  // ── Combo bonus ──
  let comboBonus = 0
  {
    const recentCats = new Set(recentAnomaliesForCombo
      .filter(a => a.id !== anomaly.id && (Date.now() - a.timestamp) < FUNNEL.WINDOW_MS)
      .map(a => a.category))
    recentCats.add(anomaly.category)
    const catArr = Array.from(recentCats)
    for (let i = 0; i < catArr.length; i++) {
      for (let j = i + 1; j < catArr.length; j++) {
        const comboKey = [catArr[i], catArr[j]].sort().join('+')
        const bonus = FUNNEL.COMBO_BONUSES[comboKey]
        if (bonus) {
          comboBonus += bonus
          break // only apply first matching combo
        }
      }
    }
  }

  // ── Layer C subtotal ──
  let misalignPenalty = 0
  if (confidence.vwapAlign === 0 && sim.vwap > 0) misalignPenalty += SCORING.VWAP_MISALIGNED_PENALTY   // -1
  // BUG FIX: Apply misalign penalties for all pairs, not just WS-anchored ones
  if (confidence.smaAlign === 0 && sim.priceHistory.length >= TA_CONFIG.SMA_SLOW) misalignPenalty += SCORING.SMA_MISALIGNED_PENALTY  // -1
  if (confidence.momAlign === 0 && (sim.momentum !== 0 || sim.priceHistory.length > 0)) misalignPenalty += SCORING.MOM_MISALIGNED_PENALTY  // -2
  if (confidence.macdAlign === 0 && sim.priceHistory.length >= TA_CONFIG.MACD_SLOW) misalignPenalty += SCORING.MACD_MISALIGNED_PENALTY  // -1
  if (confidence.rsiAlign === 0 && sim.rsiWarmup > TA_CONFIG.RSI_PERIOD) misalignPenalty += SCORING.RSI_MISALIGNED_PENALTY  // -1

  confidence.layerC = confidence.multiSignal + confidence.edgePair +
                      confidence.spreadTight + comboBonus + fearGreedBonus + misalignPenalty

  // ── Legacy: liqCluster always true (shield stop uses liq cluster) ──
  const longClusters = sim.liqBars.filter(b => b.price < entryPrice && b.longLiq > 0)
  const shortClusters = sim.liqBars.filter(b => b.price > entryPrice && b.shortLiq > 0)
  confidence.liqCluster = (side === 'LONG' && longClusters.length > 0) || (side === 'SHORT' && shortClusters.length > 0)

  // ── Total score: Layer B + Layer C ──
  confidence.total = confidence.layerB + confidence.layerC

  // ── Gate check ──
  const passesGate = hasConvergence || confidence.layerB >= SCORING.MIN_SCORE

  return { confidence, comboBonus, passesGate }
}
