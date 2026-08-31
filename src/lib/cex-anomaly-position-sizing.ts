// ─── CEX Anomaly — Position Sizing Engine ────────────────────────────────────
// Risk-based margin calculation — pure function, fully testable

import type { ConfidenceBreakdown, PositionSide, ChaseState, LiquidationBar, ActivePosition, OrderFlowAnomaly, AnomalyTag } from './cex-anomaly-types'
import { LIMITS, TRADING_MODES, EXECUTION, type TradingMode, type LeverageLevel } from './cex-anomaly-constants'

export interface PositionSizingInput {
  confidence: ConfidenceBreakdown
  side: PositionSide
  entryPrice: number
  liqBars: LiquidationBar[]
  leverage: LeverageLevel
  tradingMode: TradingMode
  balance: number
  executionMode: 'TAKER' | 'MAKER'
  makerFeeRate: number
  takerFeeRate: number
  shieldOffset: number
  isCascadeTrigger: boolean
  anomaly: OrderFlowAnomaly
  isReversal: boolean
  isContrarianMode: boolean
  simCvd: number
  anomalyTimestamp: number
  /** Custom SL override as % (e.g. 0.50 = 0.50%). Null = use default. */
  customSLPct: number | null
}

export interface PositionSizingResult {
  marginUsd: number
  notionalSize: number
  shieldStopLoss: number
  nearestLiqCluster: number
  entryFee: number
  estimatedExitFee: number
  totalFees: number
  entryFeeRate: number
  exitFeeRate: number
  roundTripRate: number
  chaseState: ChaseState | null
}

/** Compute position size, stop loss, fees, and chase state */
export function computePositionSize(input: PositionSizingInput): PositionSizingResult {
  const {
    confidence, side, entryPrice, liqBars, leverage, tradingMode, balance,
    executionMode, makerFeeRate, takerFeeRate, shieldOffset,
    isCascadeTrigger, anomaly, isReversal, isContrarianMode,
    simCvd, anomalyTimestamp, customSLPct,
  } = input

  const currentModeConfig = TRADING_MODES[tradingMode]
  const basePct = currentModeConfig.positionSizePct

  // Conviction-based position sizing
  const scoreForSizing = confidence.total
  const sizingMultiplier = isCascadeTrigger ? 1.6
    : scoreForSizing >= 11 ? 1.6
    : scoreForSizing >= 9 ? 1.4
    : scoreForSizing >= 7 ? 1.0
    : 0.6

  const riskBudgetPct = 0.02 // 2% of wallet = max loss per position
  const riskBudget = balance * riskBudgetPct
  // Stop distance depends on leverage (sniper shield for 10x+)
  // Custom SL override: if customSLPct is set, use it instead of defaults
  const defaultStopPct = leverage >= 100 ? 0.0004   // 0.04% sniper shield
                : leverage >= 20  ? 0.005    // 0.5%
                : leverage >= 10  ? 0.005    // 0.5% — AGGRESSIVE 10x: SL 0.50%, TP 1.2%, R:R ≈ 2.4:1
                : 0.03                               // 3% liq cluster shield
  const stopPct = customSLPct !== null ? customSLPct / 100 : defaultStopPct
  // Fixed $8 margin regardless of wallet balance (user requirement)
  // At 10x leverage = $80 notional, at 5x = $40, at 1x = $8
  const maxNotional = balance * 10
  const marginUsd = LIMITS.MIN_MARGIN_USD  // Always $8 — no scaling with balance
  const notionalSize = Math.min(marginUsd * leverage, maxNotional)

  // Sniper Shield: leverage-aware stop placement
  // Custom SL override: if customSLPct is set, use it instead of defaults
  const defaultSniperShieldPct = leverage >= 100 ? 0.0004
                        : leverage >= 20  ? 0.005
                        : leverage >= 10  ? 0.005    // 0.5% — matches stopPct for AGGRESSIVE 10x
                        : 0
  const sniperShieldPct = customSLPct !== null ? customSLPct / 100 : defaultSniperShieldPct

  let nearestLiqCluster: number
  let shieldStopLoss: number

  // ── Custom SL: DIRECT mode — ignore liqBars, set SL at exact custom distance ──
  // When user sets custom SL (e.g. 6%), they expect EXACTLY 6% from entry on Bybit.
  // The liqBars-based shield can place SL at a different distance (e.g. 5.67% from fallback
  // or 3% from a nearby cluster), which is confusing and defeats the purpose of custom SL.
  if (customSLPct !== null) {
    // Custom SL: set EXACTLY at the specified distance from entry price
    const customSlPctFraction = customSLPct / 100  // e.g. 6.0 → 0.06
    if (side === 'LONG') {
      shieldStopLoss = entryPrice * (1 - customSlPctFraction)
      nearestLiqCluster = entryPrice * (1 - customSlPctFraction * 1.5) // estimate for display
    } else {
      shieldStopLoss = entryPrice * (1 + customSlPctFraction)
      nearestLiqCluster = entryPrice * (1 + customSlPctFraction * 1.5) // estimate for display
    }
  } else if (side === 'LONG') {
    // ── Auto mode: use liqBars + sniper shield ──
    const belowBars = liqBars.filter(b => b.price < entryPrice)
    const biggestCluster = belowBars.reduce((max, b) =>
      b.longLiq > max.longLiq ? b : max, belowBars[0] || { price: entryPrice * 0.95, longLiq: 0 })
    nearestLiqCluster = biggestCluster.price
    const liqShield = nearestLiqCluster * (1 - shieldOffset)
    const sniperShield = entryPrice * (1 - sniperShieldPct)
    // We take the TIGHTER stop (closer to entry = less risk).
    // Math.max picks the higher price = closer to entry for LONG.
    if (sniperShieldPct > 0) {
      shieldStopLoss = Math.max(liqShield, sniperShield)
      // Hard cap: SL must not be further than sniperShield distance from entry
      shieldStopLoss = Math.max(shieldStopLoss, entryPrice * (1 - sniperShieldPct))
    } else {
      shieldStopLoss = liqShield
    }
  } else {
    // ── Auto mode: SHORT ──
    const aboveBars = liqBars.filter(b => b.price > entryPrice)
    const biggestCluster = aboveBars.reduce((max, b) =>
      b.shortLiq > max.shortLiq ? b : max, aboveBars[0] || { price: entryPrice * 1.05, shortLiq: 0 })
    nearestLiqCluster = biggestCluster.price
    const liqShield = nearestLiqCluster * (1 + shieldOffset)
    const sniperShield = entryPrice * (1 + sniperShieldPct)
    // Math.min picks the lower price = closer to entry for SHORT.
    if (sniperShieldPct > 0) {
      shieldStopLoss = Math.min(liqShield, sniperShield)
      // Hard cap: SL must not be further than sniperShield distance from entry
      shieldStopLoss = Math.min(shieldStopLoss, entryPrice * (1 + sniperShieldPct))
    } else {
      shieldStopLoss = liqShield
    }
  }

  // Fees: both entry and exit are Taker (0.055%) for Bybit UTA VIP0
  // Even if entry is via limit order, Bybit may charge taker if filled instantly.
  // Conservative approach: assume worst-case taker on both sides.
  const entryFeeRate = takerFeeRate
  const exitFeeRate = takerFeeRate
  const entryFee = notionalSize * entryFeeRate
  const estimatedExitFee = notionalSize * exitFeeRate
  const totalFees = entryFee + estimatedExitFee
  const roundTripRate = entryFeeRate + exitFeeRate

  // Maker chase state: place limit inside spread
  const chaseState: ChaseState | null = executionMode === 'MAKER' ? {
    attempts: 0,
    limitPrice: side === 'LONG'
      ? entryPrice * (1 - EXECUTION.LIMIT_OFFSET_BPS / 10_000)
      : entryPrice * (1 + EXECUTION.LIMIT_OFFSET_BPS / 10_000),
    originalPrice: entryPrice,
    status: 'PENDING',
  } : null

  return {
    marginUsd,
    notionalSize,
    shieldStopLoss,
    nearestLiqCluster,
    entryFee,
    estimatedExitFee,
    totalFees,
    entryFeeRate,
    exitFeeRate,
    roundTripRate,
    chaseState,
  }
}
