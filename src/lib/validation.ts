// ─── Zod Validation Schemas for API Routes ──────────────────────────────────
// Provides input validation for each Trading Platform API endpoint.
// Now supports universal multi-strategy framework.

import { z } from "zod";

// ─── Strategy Type Enum ─────────────────────────────────────────────────────

export const STRATEGY_TYPES = [
  "dip_buying",
  "momentum",
  "mean_reversion",
  "breakout",
  "grid",
  "hurst_hcoo_lb",
  "futures_compound",
] as const;

export type StrategyType = (typeof STRATEGY_TYPES)[number];

// ─── Backtest Schema (universal) ────────────────────────────────────────────

export const backtestSchema = z.object({
  coin_id: z.string().min(1).max(50),
  days: z.number().int().min(30).max(730),
  strategy_type: z.enum(STRATEGY_TYPES).optional().default("dip_buying"),
  initial_capital: z.number().positive().max(10000000),
  compound: z.boolean().optional().default(true),
  fee_pct: z.number().nonnegative().max(5).optional().default(0.1),

  // Execution model
  slippage_pct: z.number().nonnegative().max(1).optional().default(0.05),
  simulate_wicks: z.boolean().optional().default(true),
  latency_ms: z.number().int().nonnegative().max(120000).optional().default(0),
  latency_adverse_bps_per_second: z.number().nonnegative().max(100).optional().default(0.5),

  // Dip Buying params
  dip_threshold_1h: z.number().max(0).optional().default(0),
  dip_threshold_24h: z.number().max(0).optional().default(-3),
  take_profit_pct: z.number().positive().max(100).optional().default(5),
  stop_loss_pct: z.number().positive().max(100).optional().default(2),
  max_holding_hours: z.number().int().positive().max(720).optional().default(48),

  // Momentum params
  ma_period: z.number().int().min(2).max(500).optional(),
  volume_threshold: z.number().positive().max(100).optional(),

  // Mean Reversion params
  deviation_threshold: z.number().positive().max(10).optional(),

  // Breakout params
  lookback_periods: z.number().int().min(2).max(500).optional(),
  breakout_confirm_bars: z.number().int().min(1).max(20).optional(),

  // Grid params
  grid_spacing_pct: z.number().positive().max(50).optional(),
  grid_levels: z.number().int().min(2).max(50).optional(),
  base_price: z.number().positive().optional(),

  // Hurst HCOO_LB params
  hurst_period: z.number().int().min(20).max(500).optional(),
  hurst_threshold: z.number().min(0.1).max(0.9).optional(),
  bb_period: z.number().int().min(2).max(200).optional(),
  bb_std: z.number().positive().max(5).optional(),

  // Futures Compound params
  leverage: z.number().min(1).max(50).optional(),
  futures_alloc_pct: z.number().min(10).max(100).optional(),
  ema_fast: z.number().int().min(2).max(100).optional(),
  ema_slow: z.number().int().min(5).max(500).optional(),
  rsi_period: z.number().int().min(2).max(100).optional(),
  rsi_overbought: z.number().min(50).max(100).optional(),
  rsi_oversold: z.number().min(0).max(50).optional(),
  futures_sl_pct: z.number().positive().max(50).optional(),
  futures_tp_pct: z.number().positive().max(100).optional(),
  max_futures_hours: z.number().int().positive().max(168).optional(),
  funding_rate_pct: z.number().nonnegative().max(1).optional(),
});

// ─── Bulk Backtest Schema ───────────────────────────────────────────────────

export const bulkBacktestSchema = z.object({
  coin_ids: z.array(z.string().min(1).max(50)).min(1).max(15),
  days: z.number().int().min(30).max(730).optional().default(365),
  strategy_type: z.enum(STRATEGY_TYPES).optional().default("dip_buying"),
  dip_threshold_1h: z.number().max(0).optional().default(-5),
  dip_threshold_24h: z.number().max(0).optional().default(-10),
  take_profit_pct: z.number().positive().max(100).optional().default(3),
  stop_loss_pct: z.number().positive().max(100).optional().default(5),
  initial_capital: z.number().positive().max(10000000).optional().default(1000),
  compound: z.boolean().optional().default(true),
  max_holding_hours: z
    .number()
    .int()
    .positive()
    .max(720)
    .optional()
    .default(48),
  fee_pct: z.number().nonnegative().max(5).optional().default(0.1),

  // Momentum params
  ma_period: z.number().int().min(2).max(500).optional(),
  volume_threshold: z.number().positive().max(100).optional(),

  // Mean Reversion params
  deviation_threshold: z.number().positive().max(10).optional(),

  // Breakout params
  lookback_periods: z.number().int().min(2).max(500).optional(),
  breakout_confirm_bars: z.number().int().min(1).max(20).optional(),

  // Grid params
  grid_spacing_pct: z.number().positive().max(50).optional(),
  grid_levels: z.number().int().min(2).max(50).optional(),
  base_price: z.number().positive().optional(),

  // Hurst HCOO_LB params
  hurst_period: z.number().int().min(20).max(500).optional(),
  hurst_threshold: z.number().min(0.1).max(0.9).optional(),
  bb_period: z.number().int().min(2).max(200).optional(),
  bb_std: z.number().positive().max(5).optional(),
});

// ─── Optimize Schema (all strategies) ──────────────────────────────────────

export const optimizeSchema = z.object({
  coin_id: z.string().min(1).max(50).optional().default("solana"),
  days: z.number().int().min(30).max(365).optional().default(90),
  initial_capital: z.number().positive().max(1000000).optional().default(1000),
  compound: z.boolean().optional().default(true),
  fee_pct: z.number().nonnegative().max(5).optional().default(0.1),
  strategy_type: z.enum(STRATEGY_TYPES).optional().default("dip_buying"),
  custom_grid: z
    .object({
      // Dip Buying params
      dip_threshold_1h: z.array(z.number().max(0)).max(10).optional(),
      dip_threshold_24h: z.array(z.number().max(0)).max(10).optional(),
      take_profit_pct: z.array(z.number().positive().max(50)).max(10).optional(),
      stop_loss_pct: z.array(z.number().positive().max(50)).max(10).optional(),
      max_holding_hours: z
        .array(z.number().int().positive().max(720))
        .max(8)
        .optional(),
      // Momentum params
      ma_period: z.array(z.number().int().min(2).max(500)).max(8).optional(),
      volume_threshold: z.array(z.number().positive().max(100)).max(8).optional(),
      // Mean Reversion params
      deviation_threshold: z.array(z.number().positive().max(10)).max(8).optional(),
      // Breakout params
      lookback_periods: z.array(z.number().int().min(2).max(500)).max(8).optional(),
      breakout_confirm_bars: z.array(z.number().int().min(1).max(20)).max(6).optional(),
      // Grid params
      grid_spacing_pct: z.array(z.number().positive().max(50)).max(8).optional(),
      grid_levels: z.array(z.number().int().min(2).max(50)).max(8).optional(),
      // Hurst HCOO_LB params
      hurst_period: z.array(z.number().int().min(20).max(500)).max(6).optional(),
      hurst_threshold: z.array(z.number().min(0.1).max(0.9)).max(6).optional(),
      bb_period: z.array(z.number().int().min(2).max(200)).max(6).optional(),
      bb_std: z.array(z.number().positive().max(5)).max(6).optional(),
      // Futures Compound params
      leverage: z.array(z.number().min(1).max(50)).max(6).optional(),
      futures_alloc_pct: z.array(z.number().min(10).max(100)).max(6).optional(),
      ema_fast: z.array(z.number().int().min(2).max(100)).max(6).optional(),
      ema_slow: z.array(z.number().int().min(5).max(500)).max(6).optional(),
      rsi_period: z.array(z.number().int().min(2).max(100)).max(6).optional(),
      rsi_overbought: z.array(z.number().min(50).max(100)).max(6).optional(),
      rsi_oversold: z.array(z.number().min(0).max(50)).max(6).optional(),
      futures_sl_pct: z.array(z.number().positive().max(50)).max(8).optional(),
      futures_tp_pct: z.array(z.number().positive().max(100)).max(8).optional(),
      max_futures_hours: z.array(z.number().int().positive().max(168)).max(6).optional(),
      funding_rate_pct: z.array(z.number().nonnegative().max(1)).max(4).optional(),
    })
    .optional(),
});

// ─── Exchange API Key Schema ─────────────────────────────────────────────────

export const exchangeKeySchema = z.object({
  exchange: z.enum(["bybit", "binance"]).default("bybit"),
  mode: z.enum(["demo", "real"]),
  apiKey: z.string().min(8).max(256),
  apiSecret: z.string().min(8).max(256),
});

// ─── Strategy Activation Schema ──────────────────────────────────────────────

export const strategyActivateSchema = z.object({
  strategyId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  coinId: z.string().min(1).max(50),
  mode: z.enum(["demo", "real"]),
  strategyType: z.enum(STRATEGY_TYPES).optional().default("dip_buying"),
  strategyParams: z.unknown().optional(),
  dipThreshold1h: z.number().max(0).optional().default(0),
  dipThreshold24h: z.number().max(0).optional().default(-3),
  takeProfitPct: z.number().positive().max(100).optional().default(5),
  stopLossPct: z.number().positive().max(100).optional().default(2),
  maxHoldingHours: z.number().int().positive().max(720).optional().default(48),
  feePct: z.number().nonnegative().max(5).optional().default(0.2),
  initialCapital: z.number().positive().max(10000000).optional().default(1000),
  compound: z.boolean().optional().default(true),
});

// ─── Strategy Deactivation Schema ────────────────────────────────────────────

export const strategyDeactivateSchema = z.object({
  strategyId: z.string().min(1).max(100),
  mode: z.enum(["demo", "real"]),
});

// ─── Ingest Control Schema ───────────────────────────────────────────────────

export const ingestControlSchema = z.object({
  chains: z.array(z.enum(["eth", "bsc", "solana"])).min(1).max(3).optional(),
});
