// ─── Universal Multi-Strategy Backtest Engine ────────────────────────────────
// Supports: dip_buying, momentum, mean_reversion, breakout, grid, hurst_hcoo_lb, futures_compound
// The canonical runBacktest() dispatches to the correct logic based on strategy_type.
//
// KEY IMPROVEMENTS (v2):
// - Intra-candle SL/TP simulation using estimated candle wicks
// - Realistic slippage model for market orders
// - Conservative execution: assumes worst-case within candle range

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacktestRequest {
  coin_id: string;
  days: number;
  strategy_type: string;  // dip_buying, momentum, mean_reversion, breakout, grid, hurst_hcoo_lb, futures_compound
  initial_capital: number;
  compound: boolean;
  fee_pct: number;

  // Execution model
  slippage_pct?: number;       // Market order slippage (default 0.05%)
  simulate_wicks?: boolean;    // Intra-candle SL/TP simulation (default true)
  latency_ms?: number;         // Decision-to-fill latency (default 0)
  latency_adverse_bps_per_second?: number; // Conservative adverse selection (default 0.5 bps/s)

  // Dip Buying params
  dip_threshold_1h?: number;
  dip_threshold_24h?: number;
  take_profit_pct?: number;
  stop_loss_pct?: number;
  max_holding_hours?: number;

  // Momentum params
  ma_period?: number;
  volume_threshold?: number;

  // Mean Reversion params
  deviation_threshold?: number;

  // Breakout params
  lookback_periods?: number;
  breakout_confirm_bars?: number;

  // DCA params
  buy_interval_hours?: number;
  buy_amount?: number;
  target_profit_pct?: number;

  // Grid params
  grid_spacing_pct?: number;
  grid_levels?: number;
  base_price?: number;

  // Hurst HCOO_LB params
  hurst_period?: number;          // Period for Hurst exponent calculation (default: 100)
  hurst_threshold?: number;       // Max Hurst value to consider mean-reverting (default: 0.5)
  bb_period?: number;             // Bollinger Band period (default: 20)
  bb_std?: number;                 // Bollinger Band std dev multiplier (default: 2)

  // Futures Compound params
  leverage?: number;              // Futures leverage multiplier (default: 3)
  futures_alloc_pct?: number;     // % of spot profits allocated to futures (default: 50)
  ema_fast?: number;              // Fast EMA period for trend detection (default: 9)
  ema_slow?: number;              // Slow EMA period for trend detection (default: 21)
  rsi_period?: number;            // RSI period for confirmation (default: 14)
  rsi_overbought?: number;        // RSI overbought threshold (default: 70)
  rsi_oversold?: number;          // RSI oversold threshold (default: 30)
  futures_sl_pct?: number;        // Futures stop-loss % (default: 2)
  futures_tp_pct?: number;        // Futures take-profit % (default: 4)
  max_futures_hours?: number;     // Max futures holding hours (default: 24)
  funding_rate_pct?: number;      // Hourly funding rate % for cost simulation (default: 0.01)
}

export interface Trade {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  exit_reason: "take_profit" | "stop_loss" | "time_stop" | "signal" | "target_profit" | "grid_sell" | "futures_close";
  profit_pct: number;
  net_profit_pct: number;
  capital_after: number;
  fees_paid: number;
  slippage_paid: number;  // NEW: total slippage cost
}

export interface EquityPoint {
  date: string;
  capital: number;
}

export interface PricePoint {
  date: string;
  price: number;
  timestamp: number;
  volume?: number;
}

export interface BacktestResults {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_profit_pct: number;
  avg_loss_pct: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  final_capital: number;
  profit_factor: number;
  info_ratio: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  avg_holding_hours: number;
  total_fees: number;
  total_slippage: number;  // NEW
  avg_net_profit_pct: number;
  breakeven_trades: number;
  consecutive_wins: number;
  consecutive_losses: number;
  data_granularity: "hourly" | "daily";
  slippage_pct: number;        // NEW: configured slippage
  wick_simulation: boolean;    // NEW: was wick sim active
  base_slippage_pct?: number;
  latency_ms?: number;
  latency_adverse_pct_per_side?: number;
}

// ─── Utility ────────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── Technical Indicators ───────────────────────────────────────────────────

export function computeMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) {
        sum += prices[j]
      }
      result.push(sum / period)
    }
  }
  return result
}

export function computeStdDev(prices: number[], period: number): (number | null)[] {
  const ma = computeMA(prices, period)
  const result: (number | null)[] = []
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1 || ma[i] === null) {
      result.push(null)
    } else {
      let sumSq = 0
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (prices[j] - ma[i]!) ** 2
      }
      result.push(Math.sqrt(sumSq / period))
    }
  }
  return result
}

// ─── Wick Estimation ────────────────────────────────────────────────────────
// Since CoinGecko only provides close prices (no OHLC), we estimate the
// intra-candle high and low to simulate realistic SL/TP execution.
//
// Method: Use rolling ATR-like metric computed from close-to-close changes.
// The estimated wick extends a configurable fraction beyond the close.

export interface CandleEstimate {
  close: number;
  estimated_high: number;
  estimated_low: number;
}

/**
 * Compute estimated candle high/low for each price point.
 * Uses rolling volatility to estimate wick size:
 *   estimated_high = max(current_close, prev_close) + atr * wick_factor
 *   estimated_low  = min(current_close, prev_close) - atr * wick_factor
 *
 * wick_factor defaults to 0.5 (conservative for crypto — wicks often extend
 * 50% of ATR beyond the body).
 */
function estimateCandleRanges(
  prices: PricePoint[],
  atrPeriod: number = 14,
  wickFactor: number = 0.5
): CandleEstimate[] {
  const closes = prices.map(p => p.price)
  const estimates: CandleEstimate[] = []

  // Compute true-range-like metric from close-to-close changes
  const trValues: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      trValues.push(0)
    } else {
      // "True range" proxy = |close[i] - close[i-1]|
      // This underestimates real TR but it's the best we can do with close-only data
      trValues.push(Math.abs(closes[i] - closes[i - 1]))
    }
  }

  // Compute rolling ATR
  const atrValues: number[] = []
  for (let i = 0; i < trValues.length; i++) {
    if (i < atrPeriod - 1) {
      // Use available data for initial periods
      let sum = 0
      for (let j = 0; j <= i; j++) sum += trValues[j]
      atrValues.push(sum / (i + 1))
    } else {
      let sum = 0
      for (let j = i - atrPeriod + 1; j <= i; j++) sum += trValues[j]
      atrValues.push(sum / atrPeriod)
    }
  }

  // Build estimates
  for (let i = 0; i < prices.length; i++) {
    const close = closes[i]
    const atr = atrValues[i] || close * 0.005 // fallback: 0.5% of price
    const wick = atr * wickFactor

    // For the first candle, we only have the close
    if (i === 0) {
      estimates.push({
        close,
        estimated_high: close + wick,
        estimated_low: close - wick,
      })
    } else {
      const prevClose = closes[i - 1]
      // The body spans from prev_close to current_close
      // Wick extends beyond the body
      const bodyHigh = Math.max(close, prevClose)
      const bodyLow = Math.min(close, prevClose)

      estimates.push({
        close,
        estimated_high: bodyHigh + wick,
        estimated_low: bodyLow - wick,
      })
    }
  }

  return estimates
}

// ─── Execution Price Model ──────────────────────────────────────────────────
// Applies slippage to entry/exit prices:
//   BUY:  executed_price = signal_price * (1 + slippage_pct / 100)
//   SELL: executed_price = signal_price * (1 - slippage_pct / 100)

function applyBuySlippage(price: number, slippagePct: number): number {
  return price * (1 + slippagePct / 100)
}

function applySellSlippage(price: number, slippagePct: number): number {
  return price * (1 - slippagePct / 100)
}

// ─── Information Ratio (mean/stdDev of per-trade returns) ──────────────────────
// Note: This is NOT a traditional Sharpe Ratio (which uses risk-free rate and sqrt(N) annualization).
// For per-trade returns, mean/stdDev is the correct Information Ratio metric.

export function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return mean / stdDev;
}

// ─── Compute Aggregate Results ──────────────────────────────────────────────

export function computeResults(
  trades: Trade[],
  initialCapital: number,
  equityCurve: EquityPoint[],
  granularity: "hourly" | "daily",
  slippagePct: number = 0.05,
  wickSimulation: boolean = true
): BacktestResults {
  const totalTrades = trades.length;

  const winners = trades.filter((t) => t.net_profit_pct > 0);
  const losers = trades.filter((t) => t.net_profit_pct < 0);
  const breakeven = trades.filter((t) => t.net_profit_pct === 0);

  const winningTrades = winners.length;
  const losingTrades = losers.length;
  const winRate = totalTrades > 0 ? round2((winningTrades / totalTrades) * 100) : 0;

  const avgProfitPct =
    winners.length > 0
      ? round2(winners.reduce((a, b) => a + b.net_profit_pct, 0) / winners.length)
      : 0;

  const avgLossPct =
    losers.length > 0
      ? round2(losers.reduce((a, b) => a + b.net_profit_pct, 0) / losers.length)
      : 0;

  // Use the last equity curve point as final capital — this accounts for
  // unrealized gains/losses on open positions that may exist after the last trade.
  // For grid/DCA strategies, the last trade's capital_after can differ significantly
  // from the actual portfolio value at the end of the backtest period.
  const finalCapital =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].capital
      : trades.length > 0
        ? trades[trades.length - 1].capital_after
        : initialCapital;

  const totalReturnPct = round2(((finalCapital - initialCapital) / initialCapital) * 100);

  // ─── Max Drawdown (from daily equity curve) ───
  let maxDrawdown = 0;
  let peak = initialCapital;
  for (const point of equityCurve) {
    if (point.capital > peak) {
      peak = point.capital;
    }
    const dd = ((peak - point.capital) / peak) * 100;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }

  // ─── Profit Factor (using NET profits after fees) ───
  const grossProfit = winners.reduce((a, b) => a + b.net_profit_pct, 0);
  const grossLoss = Math.abs(losers.reduce((a, b) => a + b.net_profit_pct, 0));
  const profitFactor =
    grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? 999 : 0;

  // ─── Information Ratio (mean/stdDev of per-trade net returns) ───
  const returns = trades.map((t) => t.net_profit_pct);
  const infoRatio = computeSharpe(returns);

  const bestTradePct =
    trades.length > 0
      ? round2(Math.max(...trades.map((t) => t.net_profit_pct)))
      : 0;

  const worstTradePct =
    trades.length > 0
      ? round2(Math.min(...trades.map((t) => t.net_profit_pct)))
      : 0;

  // Average holding period (hours)
  const holdingHours = trades.map((t) => {
    const entry = new Date(t.entry_date).getTime();
    const exit = new Date(t.exit_date).getTime();
    return (exit - entry) / (1000 * 60 * 60);
  });
  const avgHoldingHours =
    holdingHours.length > 0
      ? round2(holdingHours.reduce((a, b) => a + b, 0) / holdingHours.length)
      : 0;

  // Total fees paid
  const totalFees = round2(trades.reduce((a, b) => a + b.fees_paid, 0));

  // Total slippage cost
  const totalSlippage = round2(trades.reduce((a, b) => a + b.slippage_paid, 0));

  // Average net profit
  const avgNetProfitPct =
    totalTrades > 0
      ? round2(trades.reduce((a, b) => a + b.net_profit_pct, 0) / totalTrades)
      : 0;

  // Consecutive wins/losses
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const t of trades) {
    if (t.net_profit_pct > 0) {
      currentWins++;
      currentLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, currentWins);
    } else if (t.net_profit_pct < 0) {
      currentLosses++;
      currentWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, currentLosses);
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
  }

  return {
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    win_rate: winRate,
    avg_profit_pct: avgProfitPct,
    avg_loss_pct: avgLossPct,
    total_return_pct: totalReturnPct,
    max_drawdown_pct: round2(maxDrawdown),
    final_capital: round2(finalCapital),
    profit_factor: profitFactor,
    info_ratio: round2(infoRatio),
    best_trade_pct: bestTradePct,
    worst_trade_pct: worstTradePct,
    avg_holding_hours: avgHoldingHours,
    total_fees: totalFees,
    total_slippage: totalSlippage,
    avg_net_profit_pct: avgNetProfitPct,
    breakeven_trades: breakeven.length,
    consecutive_wins: maxConsecWins,
    consecutive_losses: maxConsecLosses,
    data_granularity: granularity,
    slippage_pct: slippagePct,
    wick_simulation: wickSimulation,
  };
}

// ─── Common Trade Execution Helpers ─────────────────────────────────────────

interface TradeExecution {
  entryPrice: number;
  exitPrice: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  slippageCost: number;
  actualProfitPct: number;
  netPnl: number;
  netProfitPct: number;
  capitalAfter: number;
}

/**
 * Execute a trade entry with slippage.
 * Returns the effective entry price and fee deduction from position size.
 */
function executeEntry(
  signalPrice: number,
  positionSize: number,
  feePct: number,
  slippagePct: number
): { effectivePrice: number; feeCost: number; slippageCost: number; netPositionSize: number } {
  const effectivePrice = applyBuySlippage(signalPrice, slippagePct)
  const feeCost = positionSize * (feePct / 100)
  const slippageCost = positionSize * (slippagePct / 100)
  const netPositionSize = positionSize - feeCost  // Slippage is in price, not deducted separately
  return { effectivePrice, feeCost, slippageCost, netPositionSize }
}

/**
 * Execute a trade exit with slippage and compute P&L.
 */
function executeExit(
  exitSignalPrice: number,
  entryPrice: number,
  netPositionSize: number,
  capital: number,
  initialCapital: number,
  compound: boolean,
  feePct: number,
  slippagePct: number
): TradeExecution {
  const effectiveExitPrice = applySellSlippage(exitSignalPrice, slippagePct)
  const actualProfitPct = ((effectiveExitPrice - entryPrice) / entryPrice) * 100
  const exitValue = netPositionSize * (1 + actualProfitPct / 100)
  const exitFee = exitValue * (feePct / 100)
  const entryFee = netPositionSize * (feePct / 100)
  const totalFees = entryFee + exitFee
  const slippageCost = netPositionSize * (slippagePct / 100) * 2  // Both entry + exit slippage
  const netPnl = netPositionSize * (actualProfitPct / 100) - exitFee
  const netProfitPct = (netPnl / (compound ? capital : initialCapital)) * 100
  const capitalAfter = compound ? round2(capital + netPnl) : capital

  return {
    entryPrice,
    exitPrice: effectiveExitPrice,
    entryFee,
    exitFee,
    totalFees,
    slippageCost,
    actualProfitPct,
    netPnl,
    netProfitPct,
    capitalAfter: Math.max(1, capitalAfter),
  }
}

// ─── Strategy-specific Backtest Functions ───────────────────────────────────

function runDipBuyingBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true

  const avgIntervalMs =
    prices.length > 1
      ? (prices[prices.length - 1].timestamp - prices[0].timestamp) / (prices.length - 1)
      : 24 * 60 * 60 * 1000;
  const intervalHours = avgIntervalMs / (1000 * 60 * 60);

  const dailyEquity: Map<string, number> = new Map();
  const firstDate = prices[0].date.split("T")[0];
  dailyEquity.set(firstDate, params.initial_capital);

  let capital = params.initial_capital;
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = "";
  let entryTimestamp = 0;
  let positionSize = 0;
  let netPositionSize = 0;

  const lookback24h = Math.max(1, Math.round(24 / intervalHours));

  const dip1h = params.dip_threshold_1h ?? 0
  const dip24h = params.dip_threshold_24h ?? -3
  const tpPct = params.take_profit_pct ?? 5
  const slPct = params.stop_loss_pct ?? 2
  const maxHold = params.max_holding_hours ?? 48

  // Pre-compute wick estimates for intra-candle simulation
  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  for (let i = Math.max(lookback24h, 1); i < prices.length; i++) {
    const current = prices[i];
    const previous = prices[i - 1];
    const past24h = prices[i - lookback24h];

    const dateKey = current.date.split("T")[0];
    const candle = candleEstimates ? candleEstimates[i] : null

    if (!inPosition) {
      const change1Period = ((current.price - previous.price) / previous.price) * 100;
      const change24h = ((current.price - past24h.price) / past24h.price) * 100;

      let shouldEnter = false;

      if (granularity === "hourly") {
        shouldEnter = change1Period <= dip1h && change24h <= dip24h;
      } else {
        shouldEnter = change24h <= dip24h && change1Period <= dip1h * 2;
      }

      if (shouldEnter) {
        inPosition = true;
        const rawPositionSize = params.compound ? capital : params.initial_capital;
        const entry = executeEntry(current.price, rawPositionSize, params.fee_pct, slippagePct)
        entryPrice = entry.effectivePrice
        entryDate = current.date;
        entryTimestamp = current.timestamp;
        positionSize = rawPositionSize
        netPositionSize = entry.netPositionSize
      }

      if (!dailyEquity.has(dateKey)) {
        dailyEquity.set(dateKey, capital);
      }
    } else {
      const holdingHours = (current.timestamp - entryTimestamp) / (1000 * 60 * 60);
      const profitPctAtClose = ((current.price - entryPrice) / entryPrice) * 100;

      let exitReason: Trade["exit_reason"] | null = null;
      let exitPrice = current.price;

      if (simulateWicks && candle) {
        // ─── INTRA-CANDLE SIMULATION ───
        // Check if the estimated candle LOW hit stop-loss
        // or the estimated candle HIGH hit take-profit
        const estimatedProfitAtLow = ((candle.estimated_low - entryPrice) / entryPrice) * 100
        const estimatedProfitAtHigh = ((candle.estimated_high - entryPrice) / entryPrice) * 100

        // Stop-loss: if the estimated low breaks SL level, SL was triggered intra-candle
        if (estimatedProfitAtLow <= -slPct) {
          exitReason = "stop_loss";
          // Conservative: SL fills at the SL price minus slippage
          exitPrice = entryPrice * (1 - slPct / 100);
        }
        // Take-profit: if the estimated high breaks TP level, TP was triggered intra-candle
        else if (estimatedProfitAtHigh >= tpPct) {
          exitReason = "take_profit";
          // Conservative: TP fills at the TP price minus slippage
          exitPrice = entryPrice * (1 + tpPct / 100);
        }
        // Time stop: checked at candle close
        else if (holdingHours >= maxHold) {
          exitReason = "time_stop";
          exitPrice = current.price;
        }
      } else {
        // ─── ORIGINAL CLOSE-ONLY LOGIC (no wick simulation) ───
        if (profitPctAtClose <= -slPct) {
          exitReason = "stop_loss";
          exitPrice = entryPrice * (1 - slPct / 100);
        } else if (profitPctAtClose >= tpPct) {
          exitReason = "take_profit";
          exitPrice = entryPrice * (1 + tpPct / 100);
        } else if (holdingHours >= maxHold) {
          exitReason = "time_stop";
          exitPrice = current.price;
        }
      }

      if (exitReason) {
        const exec = executeExit(exitPrice, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)

        if (params.compound) {
          capital = exec.capitalAfter
        }

        trades.push({
          entry_date: entryDate,
          entry_price: round4(entryPrice),
          exit_date: current.date,
          exit_price: round4(exec.exitPrice),
          exit_reason: exitReason,
          profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct),
          capital_after: round2(capital),
          fees_paid: round4(exec.totalFees),
          slippage_paid: round4(exec.slippageCost),
        });

        dailyEquity.set(dateKey, capital);
        inPosition = false;
      } else {
        const unrealizedPnl = netPositionSize * (profitPctAtClose / 100);
        const unrealizedCapital = capital + unrealizedPnl;
        if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > unrealizedCapital) {
          dailyEquity.set(dateKey, Math.min(capital, unrealizedCapital));
        }
      }
    }
  }

  // Force close if still in position
  if (inPosition) {
    const lastPoint = prices[prices.length - 1];
    const profitPct = ((lastPoint.price - entryPrice) / entryPrice) * 100;
    const exec = executeExit(lastPoint.price, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)

    if (params.compound) {
      capital = exec.capitalAfter
    }

    trades.push({
      entry_date: entryDate,
      entry_price: round4(entryPrice),
      exit_date: lastPoint.date,
      exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop",
      profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct),
      capital_after: round2(capital),
      fees_paid: round4(exec.totalFees),
      slippage_paid: round4(exec.slippageCost),
    });

    const dateKey = lastPoint.date.split("T")[0];
    dailyEquity.set(dateKey, capital);
  }

  const equityCurve = buildEquityCurve(dailyEquity);
  return { trades, equityCurve };
}

function runMomentumBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true
  const maPeriod = params.ma_period ?? 20
  const volumeThreshold = params.volume_threshold ?? 1.5
  const tpPct = params.take_profit_pct ?? 5
  const slPct = params.stop_loss_pct ?? 3

  const priceArr = prices.map(p => p.price)
  const maValues = computeMA(priceArr, maPeriod)

  const volumes = prices.map(p => p.volume ?? 0)
  const hasVolumeData = volumes.some(v => v > 0)
  const avgVolume = hasVolumeData && volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  let capital = params.initial_capital
  let inPosition = false
  let entryPrice = 0
  let entryDate = ""
  let entryTimestamp = 0
  let positionSize = 0
  let netPositionSize = 0
  let prevAboveMA = false

  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  for (let i = 1; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const ma = maValues[i]
    const currentAboveMA = ma !== null ? current.price > ma : false
    const currentVolume = current.volume ?? 0
    const candle = candleEstimates ? candleEstimates[i] : null

    if (!inPosition) {
      const volumeOk = !hasVolumeData || currentVolume > avgVolume * volumeThreshold
      if (ma !== null && !prevAboveMA && currentAboveMA && volumeOk) {
        inPosition = true
        const rawPositionSize = params.compound ? capital : params.initial_capital
        const entry = executeEntry(current.price, rawPositionSize, params.fee_pct, slippagePct)
        entryPrice = entry.effectivePrice
        entryDate = current.date
        entryTimestamp = current.timestamp
        positionSize = rawPositionSize
        netPositionSize = entry.netPositionSize
      }

      if (!dailyEquity.has(dateKey)) {
        dailyEquity.set(dateKey, capital)
      }
    } else {
      const profitPctAtClose = ((current.price - entryPrice) / entryPrice) * 100

      let exitReason: Trade["exit_reason"] | null = null
      let exitPrice = current.price

      if (simulateWicks && candle) {
        const estimatedProfitAtLow = ((candle.estimated_low - entryPrice) / entryPrice) * 100
        const estimatedProfitAtHigh = ((candle.estimated_high - entryPrice) / entryPrice) * 100

        // MA crossover exit (signal) — check at close
        if (ma !== null && current.price < ma && prevAboveMA) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // SL triggered intra-candle
        else if (estimatedProfitAtLow <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        }
        // TP triggered intra-candle
        else if (estimatedProfitAtHigh >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
      } else {
        if (ma !== null && current.price < ma && prevAboveMA) {
          exitReason = "signal"
          exitPrice = current.price
        } else if (profitPctAtClose <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        } else if (profitPctAtClose >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
      }

      if (exitReason) {
        const exec = executeExit(exitPrice, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
        if (params.compound) { capital = exec.capitalAfter }

        trades.push({
          entry_date: entryDate, entry_price: round4(entryPrice),
          exit_date: current.date, exit_price: round4(exec.exitPrice),
          exit_reason: exitReason, profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
          fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
        })

        dailyEquity.set(dateKey, capital)
        inPosition = false
      } else {
        const unrealizedPnl = netPositionSize * (profitPctAtClose / 100)
        const unrealizedCapital = capital + unrealizedPnl
        if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > unrealizedCapital) {
          dailyEquity.set(dateKey, Math.min(capital, unrealizedCapital))
        }
      }
    }

    prevAboveMA = currentAboveMA
  }

  // Force close
  if (inPosition) {
    const lastPoint = prices[prices.length - 1]
    const profitPct = ((lastPoint.price - entryPrice) / entryPrice) * 100
    const exec = executeExit(lastPoint.price, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
    if (params.compound) { capital = exec.capitalAfter }
    trades.push({
      entry_date: entryDate, entry_price: round4(entryPrice),
      exit_date: lastPoint.date, exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop", profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
      fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
    })
    dailyEquity.set(lastPoint.date.split("T")[0], capital)
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

function runMeanReversionBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true
  const maPeriod = params.ma_period ?? 20
  const deviationThreshold = params.deviation_threshold ?? 2
  const slPct = params.stop_loss_pct ?? 5
  const maxHold = params.max_holding_hours ?? 168

  const priceArr = prices.map(p => p.price)
  const maValues = computeMA(priceArr, maPeriod)
  const stdDevValues = computeStdDev(priceArr, maPeriod)

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  let capital = params.initial_capital
  let inPosition = false
  let entryPrice = 0
  let entryDate = ""
  let entryTimestamp = 0
  let positionSize = 0
  let netPositionSize = 0

  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  for (let i = 1; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const ma = maValues[i]
    const stdDev = stdDevValues[i]
    const candle = candleEstimates ? candleEstimates[i] : null

    if (!inPosition) {
      if (ma !== null && stdDev !== null && stdDev > 0) {
        const lowerBand = ma - deviationThreshold * stdDev
        if (current.price <= lowerBand) {
          inPosition = true
          const rawPositionSize = params.compound ? capital : params.initial_capital
          const entry = executeEntry(current.price, rawPositionSize, params.fee_pct, slippagePct)
          entryPrice = entry.effectivePrice
          entryDate = current.date
          entryTimestamp = current.timestamp
          positionSize = rawPositionSize
          netPositionSize = entry.netPositionSize
        }
      }

      if (!dailyEquity.has(dateKey)) {
        dailyEquity.set(dateKey, capital)
      }
    } else {
      const profitPctAtClose = ((current.price - entryPrice) / entryPrice) * 100
      const holdingHours = (current.timestamp - entryTimestamp) / (1000 * 60 * 60)

      let exitReason: Trade["exit_reason"] | null = null
      let exitPrice = current.price

      if (simulateWicks && candle && ma !== null && stdDev !== null) {
        const estimatedProfitAtLow = ((candle.estimated_low - entryPrice) / entryPrice) * 100
        const upperBand = ma + 0.5 * stdDev

        // Signal exit: price returns to MA (checked at close since it's a target, not a stop)
        if (current.price >= ma || current.price >= upperBand) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // SL triggered intra-candle
        else if (estimatedProfitAtLow <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        }
        // Time stop
        else if (holdingHours >= maxHold) {
          exitReason = "time_stop"
          exitPrice = current.price
        }
      } else {
        // Original logic
        if (ma !== null && stdDev !== null) {
          const upperBand = ma + 0.5 * stdDev
          if (current.price >= ma || current.price >= upperBand) {
            exitReason = "signal"
            exitPrice = current.price
          }
        }
        if (!exitReason && profitPctAtClose <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        } else if (!exitReason && holdingHours >= maxHold) {
          exitReason = "time_stop"
          exitPrice = current.price
        }
      }

      if (exitReason) {
        const exec = executeExit(exitPrice, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
        if (params.compound) { capital = exec.capitalAfter }

        trades.push({
          entry_date: entryDate, entry_price: round4(entryPrice),
          exit_date: current.date, exit_price: round4(exec.exitPrice),
          exit_reason: exitReason, profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
          fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
        })

        dailyEquity.set(dateKey, capital)
        inPosition = false
      } else {
        const unrealizedPnl = netPositionSize * (profitPctAtClose / 100)
        const unrealizedCapital = capital + unrealizedPnl
        if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > unrealizedCapital) {
          dailyEquity.set(dateKey, Math.min(capital, unrealizedCapital))
        }
      }
    }
  }

  // Force close
  if (inPosition) {
    const lastPoint = prices[prices.length - 1]
    const profitPct = ((lastPoint.price - entryPrice) / entryPrice) * 100
    const exec = executeExit(lastPoint.price, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
    if (params.compound) { capital = exec.capitalAfter }
    trades.push({
      entry_date: entryDate, entry_price: round4(entryPrice),
      exit_date: lastPoint.date, exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop", profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
      fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
    })
    dailyEquity.set(lastPoint.date.split("T")[0], capital)
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

function runBreakoutBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true
  const lookback = params.lookback_periods ?? 20
  const confirmBars = params.breakout_confirm_bars ?? 2
  const tpPct = params.take_profit_pct ?? 8
  const slPct = params.stop_loss_pct ?? 3

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  let capital = params.initial_capital
  let inPosition = false
  let entryPrice = 0
  let entryDate = ""
  let entryTimestamp = 0
  let positionSize = 0
  let netPositionSize = 0
  let breakoutLevel = 0

  let consecutiveAboveHigh = 0
  let recentHigh = 0

  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  for (let i = lookback; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const candle = candleEstimates ? candleEstimates[i] : null

    recentHigh = 0
    for (let j = i - lookback; j < i; j++) {
      if (prices[j].price > recentHigh) recentHigh = prices[j].price
    }

    if (!inPosition) {
      if (current.price > recentHigh) {
        consecutiveAboveHigh++
      } else {
        consecutiveAboveHigh = 0
      }

      if (consecutiveAboveHigh >= confirmBars) {
        inPosition = true
        const rawPositionSize = params.compound ? capital : params.initial_capital
        const entry = executeEntry(current.price, rawPositionSize, params.fee_pct, slippagePct)
        entryPrice = entry.effectivePrice
        entryDate = current.date
        entryTimestamp = current.timestamp
        breakoutLevel = recentHigh
        positionSize = rawPositionSize
        netPositionSize = entry.netPositionSize
        consecutiveAboveHigh = 0
      }

      if (!dailyEquity.has(dateKey)) {
        dailyEquity.set(dateKey, capital)
      }
    } else {
      const profitPctAtClose = ((current.price - entryPrice) / entryPrice) * 100

      let exitReason: Trade["exit_reason"] | null = null
      let exitPrice = current.price

      if (simulateWicks && candle) {
        const estimatedProfitAtLow = ((candle.estimated_low - entryPrice) / entryPrice) * 100
        const estimatedProfitAtHigh = ((candle.estimated_high - entryPrice) / entryPrice) * 100

        // Breakout level broken (signal exit)
        if (current.price < breakoutLevel) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // SL triggered intra-candle
        else if (estimatedProfitAtLow <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        }
        // TP triggered intra-candle
        else if (estimatedProfitAtHigh >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
      } else {
        if (current.price < breakoutLevel) {
          exitReason = "signal"
          exitPrice = current.price
        } else if (profitPctAtClose <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        } else if (profitPctAtClose >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
      }

      if (exitReason) {
        const exec = executeExit(exitPrice, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
        if (params.compound) { capital = exec.capitalAfter }

        trades.push({
          entry_date: entryDate, entry_price: round4(entryPrice),
          exit_date: current.date, exit_price: round4(exec.exitPrice),
          exit_reason: exitReason, profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
          fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
        })

        dailyEquity.set(dateKey, capital)
        inPosition = false
      } else {
        const unrealizedPnl = netPositionSize * (profitPctAtClose / 100)
        const unrealizedCapital = capital + unrealizedPnl
        if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > unrealizedCapital) {
          dailyEquity.set(dateKey, Math.min(capital, unrealizedCapital))
        }
      }
    }
  }

  // Force close
  if (inPosition) {
    const lastPoint = prices[prices.length - 1]
    const profitPct = ((lastPoint.price - entryPrice) / entryPrice) * 100
    const exec = executeExit(lastPoint.price, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
    if (params.compound) { capital = exec.capitalAfter }
    trades.push({
      entry_date: entryDate, entry_price: round4(entryPrice),
      exit_date: lastPoint.date, exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop", profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
      fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
    })
    dailyEquity.set(lastPoint.date.split("T")[0], capital)
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

function runDCABacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const buyIntervalHours = params.buy_interval_hours ?? 168
  const buyAmount = params.buy_amount ?? 100
  const targetProfitPct = params.target_profit_pct ?? 15

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  let totalSpent = 0
  let totalQuantity = 0
  let lastBuyTimestamp = prices[0].timestamp
  let totalFeesPaid = 0

  // First buy at the start (with slippage)
  const firstBuyPrice = applyBuySlippage(prices[0].price, slippagePct)
  const firstFee = buyAmount * (params.fee_pct / 100)
  const firstQty = (buyAmount - firstFee) / firstBuyPrice
  totalSpent += buyAmount
  totalQuantity += firstQty
  totalFeesPaid += firstFee
  lastBuyTimestamp = prices[0].timestamp

  const buyRecords: { date: string; price: number; amount: number; qty: number }[] = [
    { date: prices[0].date, price: firstBuyPrice, amount: buyAmount, qty: firstQty }
  ]

  for (let i = 1; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const hoursSinceLastBuy = (current.timestamp - lastBuyTimestamp) / (1000 * 60 * 60)

    if (hoursSinceLastBuy >= buyIntervalHours) {
      const buyPrice = applyBuySlippage(current.price, slippagePct)
      const fee = buyAmount * (params.fee_pct / 100)
      const qty = (buyAmount - fee) / buyPrice
      totalSpent += buyAmount
      totalQuantity += qty
      totalFeesPaid += fee
      lastBuyTimestamp = current.timestamp
      buyRecords.push({ date: current.date, price: buyPrice, amount: buyAmount, qty })
    }

    const currentValue = totalQuantity * current.price
    const totalPnL = currentValue - totalSpent
    const pnlPct = totalSpent > 0 ? (totalPnL / totalSpent) * 100 : 0

    const equity = currentValue + (params.initial_capital - totalSpent)
    dailyEquity.set(dateKey, Math.max(0, equity))

    if (pnlPct >= targetProfitPct && totalQuantity > 0) {
      const sellPrice = applySellSlippage(current.price, slippagePct)
      const sellValue = totalQuantity * sellPrice
      const sellFee = sellValue * (params.fee_pct / 100)
      const netSellValue = sellValue - sellFee
      totalFeesPaid += sellFee
      const netProfit = netSellValue - totalSpent
      const slippageCost = totalSpent * (slippagePct / 100) * 2  // Approximate

      trades.push({
        entry_date: buyRecords[0].date,
        entry_price: round4(buyRecords[0].price),
        exit_date: current.date,
        exit_price: round4(sellPrice),
        exit_reason: "target_profit",
        profit_pct: round2(pnlPct),
        net_profit_pct: round2((netProfit / totalSpent) * 100),
        capital_after: round2(params.initial_capital + netProfit),
        fees_paid: round4(totalFeesPaid),
        slippage_paid: round4(slippageCost),
      })

      totalSpent = 0
      totalQuantity = 0
      totalFeesPaid = 0
      buyRecords.length = 0

      const newBuyPrice = applyBuySlippage(current.price, slippagePct)
      const newFee = buyAmount * (params.fee_pct / 100)
      const newQty = (buyAmount - newFee) / newBuyPrice
      totalSpent += buyAmount
      totalQuantity += newQty
      totalFeesPaid += newFee
      lastBuyTimestamp = current.timestamp
      buyRecords.push({ date: current.date, price: newBuyPrice, amount: buyAmount, qty: newQty })
    }
  }

  // Force close remaining position at end
  if (totalQuantity > 0) {
    const lastPoint = prices[prices.length - 1]
    const sellPrice = applySellSlippage(lastPoint.price, slippagePct)
    const currentValue = totalQuantity * sellPrice
    const sellFee = currentValue * (params.fee_pct / 100)
    totalFeesPaid += sellFee
    const netProfit = (currentValue - sellFee) - totalSpent
    const pnlPct = totalSpent > 0 ? ((currentValue - sellFee - totalSpent) / totalSpent) * 100 : 0
    const slippageCost = totalSpent * (slippagePct / 100) * 2

    trades.push({
      entry_date: buyRecords[0].date,
      entry_price: round4(buyRecords[0].price),
      exit_date: lastPoint.date,
      exit_price: round4(sellPrice),
      exit_reason: "time_stop",
      profit_pct: round2(pnlPct),
      net_profit_pct: round2(pnlPct),
      capital_after: round2(params.initial_capital + netProfit),
      fees_paid: round4(totalFeesPaid),
      slippage_paid: round4(slippageCost),
    })

    dailyEquity.set(lastPoint.date.split("T")[0], Math.max(0, params.initial_capital + netProfit))
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

function runGridBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const gridSpacingPct = params.grid_spacing_pct ?? 2
  const gridLevels = params.grid_levels ?? 5
  const basePrice = params.base_price ?? prices[0].price

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  const gridBuyLevels: number[] = []
  const gridSellLevels: number[] = []
  for (let i = 1; i <= gridLevels; i++) {
    gridBuyLevels.push(basePrice * (1 - (gridSpacingPct / 100) * i))
    gridSellLevels.push(basePrice * (1 + (gridSpacingPct / 100) * i))
  }

  let cash = params.initial_capital
  const perGridAmount = params.initial_capital / gridLevels
  // Track each bought level with its actual cost basis (after entry fee)
  const boughtLevels = new Map<number, { price: number; qty: number; date: string; costBasis: number; entryFee: number }>()

  const candleEstimates = (params.simulate_wicks ?? true) ? estimateCandleRanges(prices) : null

  // Helper: compute total portfolio value = cash + unrealized value of open positions at current price
  function computeTotalPortfolioValue(currentPrice: number): number {
    let unrealizedValue = 0
    for (const [, info] of boughtLevels) {
      unrealizedValue += info.qty * currentPrice
    }
    return Math.max(0, cash + unrealizedValue)
  }

  for (let i = 0; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const candle = candleEstimates ? candleEstimates[i] : null

    // Check buy grid levels (use estimated low for wick simulation)
    const priceForBuyCheck = candle ? candle.estimated_low : current.price
    for (let j = 0; j < gridBuyLevels.length; j++) {
      const level = gridBuyLevels[j]
      if (priceForBuyCheck <= level && !boughtLevels.has(j)) {
        const buyPrice = applyBuySlippage(level, slippagePct)
        const entryFee = perGridAmount * (params.fee_pct / 100)
        const qty = (perGridAmount - entryFee) / buyPrice
        boughtLevels.set(j, { price: buyPrice, qty, date: current.date, costBasis: perGridAmount, entryFee })
        cash -= perGridAmount
      }
    }

    // Check sell grid levels (use estimated high for wick simulation)
    const priceForSellCheck = candle ? candle.estimated_high : current.price
    for (let j = 0; j < gridSellLevels.length; j++) {
      const sellLevel = gridSellLevels[j]
      if (priceForSellCheck >= sellLevel) {
        const buyInfo = boughtLevels.get(j)
        if (buyInfo) {
          const sellPrice = applySellSlippage(sellLevel, slippagePct)
          const sellValue = buyInfo.qty * sellPrice
          const sellFee = sellValue * (params.fee_pct / 100)
          const totalFees = buyInfo.entryFee + sellFee

          // Profit: what we received minus what we invested in this grid level
          const grossProfit = sellValue - buyInfo.costBasis
          const netProfit = sellValue - sellFee - buyInfo.costBasis
          const profitPct = (grossProfit / buyInfo.costBasis) * 100
          const netProfitPct = (netProfit / buyInfo.costBasis) * 100
          const slippageCost = buyInfo.costBasis * (slippagePct / 100) * 2

          // Return proceeds to cash
          cash += sellValue - sellFee

          // Remove from boughtLevels BEFORE computing capital_after
          // to avoid double-counting (cash already includes sellValue, but
          // boughtLevels still had the position which computeTotalPortfolioValue
          // would also count as unrealized value)
          boughtLevels.delete(j)

          // capital_after = total portfolio value at this moment (cash + unrealized open positions)
          const capitalAfter = computeTotalPortfolioValue(current.price)

          trades.push({
            entry_date: buyInfo.date,
            entry_price: round4(buyInfo.price),
            exit_date: current.date,
            exit_price: round4(sellPrice),
            exit_reason: "grid_sell",
            profit_pct: round2(profitPct),
            net_profit_pct: round2(netProfitPct),
            capital_after: round2(capitalAfter),
            fees_paid: round4(totalFees),
            slippage_paid: round4(slippageCost),
          })
        }
      }
    }

    // Track daily equity
    const totalValue = computeTotalPortfolioValue(current.price)
    dailyEquity.set(dateKey, totalValue)
  }

  // Force close remaining positions at end of backtest period
  if (boughtLevels.size > 0) {
    const lastPoint = prices[prices.length - 1]
    // Collect entries first to avoid mutating the map during iteration
    const remainingEntries = Array.from(boughtLevels.entries())
    for (const [levelIdx, info] of remainingEntries) {
      const sellPrice = applySellSlippage(lastPoint.price, slippagePct)
      const sellValue = info.qty * sellPrice
      const sellFee = sellValue * (params.fee_pct / 100)
      const totalFees = info.entryFee + sellFee

      const grossProfit = sellValue - info.costBasis
      const netProfit = sellValue - sellFee - info.costBasis
      const profitPct = (grossProfit / info.costBasis) * 100
      const netProfitPct = (netProfit / info.costBasis) * 100
      const slippageCost = info.costBasis * (slippagePct / 100) * 2

      cash += sellValue - sellFee
      boughtLevels.delete(levelIdx)

      const capitalAfter = computeTotalPortfolioValue(lastPoint.price)

      trades.push({
        entry_date: info.date,
        entry_price: round4(info.price),
        exit_date: lastPoint.date,
        exit_price: round4(sellPrice),
        exit_reason: "time_stop",
        profit_pct: round2(profitPct),
        net_profit_pct: round2(netProfitPct),
        capital_after: round2(capitalAfter),
        fees_paid: round4(totalFees),
        slippage_paid: round4(slippageCost),
      })
    }
    dailyEquity.set(lastPoint.date.split("T")[0], Math.max(0, cash))
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

// ─── Build Equity Curve ─────────────────────────────────────────────────────

// ─── Hurst Exponent (R/S Analysis) ─────────────────────────────────────────
// Computes the Hurst exponent using the Rescaled Range (R/S) method.
// H < 0.5 → mean-reverting (anti-persistent) — price tends to reverse
// H = 0.5 → random walk (Brownian motion)
// H > 0.5 → trending (persistent) — price tends to continue

export function computeHurstExponent(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null)
      continue
    }

    // Extract the window of prices
    const window = prices.slice(i - period + 1, i + 1)

    // Compute log returns
    const logReturns: number[] = []
    for (let j = 1; j < window.length; j++) {
      if (window[j - 1] > 0 && window[j] > 0) {
        logReturns.push(Math.log(window[j] / window[j - 1]))
      }
    }

    if (logReturns.length < 10) {
      result.push(null)
      continue
    }

    // R/S analysis on multiple sub-periods
    const subSizes = [4, 8, 16, 32].filter(s => s <= logReturns.length)
    if (subSizes.length < 2) {
      result.push(null)
      continue
    }

    const rsValues: { logN: number; logRS: number }[] = []

    for (const size of subSizes) {
      const numSubsets = Math.floor(logReturns.length / size)
      let totalRS = 0

      for (let s = 0; s < numSubsets; s++) {
        const subset = logReturns.slice(s * size, (s + 1) * size)

        // Mean of subset
        const mean = subset.reduce((a, b) => a + b, 0) / subset.length

        // Cumulative deviations from mean
        const cumDev: number[] = []
        let cumSum = 0
        for (const val of subset) {
          cumSum += val - mean
          cumDev.push(cumSum)
        }

        // Range R = max(cumDev) - min(cumDev)
        const R = Math.max(...cumDev) - Math.min(...cumDev)

        // Standard deviation S
        let sumSqDiff = 0
        for (const val of subset) {
          sumSqDiff += (val - mean) ** 2
        }
        const S = Math.sqrt(sumSqDiff / subset.length)

        // Rescaled range R/S
        if (S > 0 && R > 0) {
          totalRS += R / S
        }
      }

      if (numSubsets > 0) {
        const avgRS = totalRS / numSubsets
        if (avgRS > 0) {
          rsValues.push({ logN: Math.log(size), logRS: Math.log(avgRS) })
        }
      }
    }

    // Linear regression: log(R/S) = H * log(N) + c
    // Slope H is the Hurst exponent
    if (rsValues.length >= 2) {
      const n = rsValues.length
      const sumX = rsValues.reduce((a, b) => a + b.logN, 0)
      const sumY = rsValues.reduce((a, b) => a + b.logRS, 0)
      const sumXY = rsValues.reduce((a, b) => a + b.logN * b.logRS, 0)
      const sumX2 = rsValues.reduce((a, b) => a + b.logN ** 2, 0)

      const denominator = n * sumX2 - sumX ** 2
      if (denominator > 0) {
        const H = (n * sumXY - sumX * sumY) / denominator
        // Clamp to [0, 1] for sanity
        result.push(Math.max(0, Math.min(1, H)))
      } else {
        result.push(null)
      }
    } else {
      result.push(null)
    }
  }

  return result
}

// ─── Hurst HCOO_LB Strategy Backtest ──────────────────────────────────────
// Hurst Channel Oversold Overshoot — Lower Band
//
// Entry conditions (ALL must be true):
//   1. Hurst exponent H < hurst_threshold (mean-reverting regime detected)
//   2. Price drops below Bollinger Lower Band (oversold)
//
// Exit conditions (any):
//   1. Price returns to MA (signal exit — mean reversion complete)
//   2. Stop Loss hit (intra-candle simulation)
//   3. Take Profit hit (intra-candle simulation)
//   4. Time stop exceeded
//   5. Hurst rises above threshold (regime shift — no longer mean-reverting)

function runHurstHcooLbBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true

  const hurstPeriod = params.hurst_period ?? 100
  const hurstThreshold = params.hurst_threshold ?? 0.5
  const bbPeriod = params.bb_period ?? 20
  const bbStd = params.bb_std ?? 2

  const tpPct = params.take_profit_pct ?? 5
  const slPct = params.stop_loss_pct ?? 3
  const maxHold = params.max_holding_hours ?? 72

  const priceArr = prices.map(p => p.price)
  const maValues = computeMA(priceArr, bbPeriod)
  const stdDevValues = computeStdDev(priceArr, bbPeriod)
  const hurstValues = computeHurstExponent(priceArr, hurstPeriod)

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  let capital = params.initial_capital
  let inPosition = false
  let entryPrice = 0
  let entryDate = ""
  let entryTimestamp = 0
  let positionSize = 0
  let netPositionSize = 0

  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  // Start after the max of bbPeriod and hurstPeriod
  const startIndex = Math.max(bbPeriod, hurstPeriod)

  for (let i = startIndex; i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const ma = maValues[i]
    const stdDev = stdDevValues[i]
    const hurst = hurstValues[i]
    const candle = candleEstimates ? candleEstimates[i] : null

    if (!inPosition) {
      // Entry: H < threshold (mean-reverting) AND price <= lower Bollinger Band
      if (ma !== null && stdDev !== null && stdDev > 0 && hurst !== null) {
        const lowerBand = ma - bbStd * stdDev
        if (hurst < hurstThreshold && current.price <= lowerBand) {
          inPosition = true
          const rawPositionSize = params.compound ? capital : params.initial_capital
          const entry = executeEntry(current.price, rawPositionSize, params.fee_pct, slippagePct)
          entryPrice = entry.effectivePrice
          entryDate = current.date
          entryTimestamp = current.timestamp
          positionSize = rawPositionSize
          netPositionSize = entry.netPositionSize
        }
      }

      if (!dailyEquity.has(dateKey)) {
        dailyEquity.set(dateKey, capital)
      }
    } else {
      const profitPctAtClose = ((current.price - entryPrice) / entryPrice) * 100
      const holdingHours = (current.timestamp - entryTimestamp) / (1000 * 60 * 60)

      let exitReason: Trade["exit_reason"] | null = null
      let exitPrice = current.price

      if (simulateWicks && candle && ma !== null && stdDev !== null) {
        const estimatedProfitAtLow = ((candle.estimated_low - entryPrice) / entryPrice) * 100
        const estimatedProfitAtHigh = ((candle.estimated_high - entryPrice) / entryPrice) * 100

        // Regime shift exit: Hurst rises above threshold — no longer mean-reverting
        if (hurst !== null && hurst >= hurstThreshold) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // Signal exit: price returns to MA (mean reversion complete)
        else if (current.price >= ma) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // SL triggered intra-candle
        else if (estimatedProfitAtLow <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        }
        // TP triggered intra-candle
        else if (estimatedProfitAtHigh >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
        // Time stop
        else if (holdingHours >= maxHold) {
          exitReason = "time_stop"
          exitPrice = current.price
        }
      } else {
        // Regime shift exit
        if (hurst !== null && hurst >= hurstThreshold) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // Signal exit: price returns to MA
        else if (ma !== null && current.price >= ma) {
          exitReason = "signal"
          exitPrice = current.price
        }
        // SL
        else if (profitPctAtClose <= -slPct) {
          exitReason = "stop_loss"
          exitPrice = entryPrice * (1 - slPct / 100)
        }
        // TP
        else if (profitPctAtClose >= tpPct) {
          exitReason = "take_profit"
          exitPrice = entryPrice * (1 + tpPct / 100)
        }
        // Time stop
        else if (holdingHours >= maxHold) {
          exitReason = "time_stop"
          exitPrice = current.price
        }
      }

      if (exitReason) {
        const exec = executeExit(exitPrice, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
        if (params.compound) { capital = exec.capitalAfter }

        trades.push({
          entry_date: entryDate, entry_price: round4(entryPrice),
          exit_date: current.date, exit_price: round4(exec.exitPrice),
          exit_reason: exitReason, profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
          fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
        })

        dailyEquity.set(dateKey, capital)
        inPosition = false
      } else {
        const unrealizedPnl = netPositionSize * (profitPctAtClose / 100)
        const unrealizedCapital = capital + unrealizedPnl
        if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > unrealizedCapital) {
          dailyEquity.set(dateKey, Math.min(capital, unrealizedCapital))
        }
      }
    }
  }

  // Force close
  if (inPosition) {
    const lastPoint = prices[prices.length - 1]
    const exec = executeExit(lastPoint.price, entryPrice, netPositionSize, capital, params.initial_capital, params.compound, params.fee_pct, slippagePct)
    if (params.compound) { capital = exec.capitalAfter }
    trades.push({
      entry_date: entryDate, entry_price: round4(entryPrice),
      exit_date: lastPoint.date, exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop", profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct), capital_after: round2(capital),
      fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
    })
    dailyEquity.set(lastPoint.date.split("T")[0], capital)
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

function buildEquityCurve(dailyEquity: Map<string, number>): EquityPoint[] {
  const equityCurve: EquityPoint[] = Array.from(dailyEquity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, capital]) => ({ date, capital: round2(capital) }));

  // Fill gaps
  if (equityCurve.length > 1) {
    const filled: EquityPoint[] = [equityCurve[0]];
    for (let i = 1; i < equityCurve.length; i++) {
      const prevDate = new Date(filled[filled.length - 1].date);
      const currDate = new Date(equityCurve[i].date);
      const daysDiff = Math.round(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      for (let d = 1; d < daysDiff; d++) {
        const fillDate = new Date(prevDate.getTime() + d * 24 * 60 * 60 * 1000);
        filled.push({
          date: fillDate.toISOString().split("T")[0],
          capital: filled[filled.length - 1].capital,
        });
      }
      filled.push(equityCurve[i]);
    }
    equityCurve.splice(0, equityCurve.length, ...filled);
  }

  return equityCurve;
}

// ─── Futures Compound Strategy ─────────────────────────────────────────────
// Dual-engine strategy: spot dip-buying + futures day trading
//
// Concept:
// 1. SPOT ENGINE: Buys dips on spot market, sells at TP (accumulates profits)
// 2. FUTURES ENGINE: Takes spot profits, opens leveraged LONG/SHORT positions
//    based on EMA crossover + RSI confirmation
// 3. Futures profits flow BACK to spot capital pool → compound effect
//
// Risk management:
// - Strict SL on futures (typically 1-3%)
// - Quick TP on futures (typically 2-5%)
// - Only % of spot profits allocated to futures (not entire capital)
// - Funding rate cost simulation
// - Can go both LONG and SHORT (unlike spot-only strategies)

function computeEMAArray(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sum += prices[i];
      result.push(null);
    } else if (i === period - 1) {
      sum += prices[i];
      result.push(sum / period);
    } else {
      const prevEMA = result[i - 1]!;
      result.push((prices[i] - prevEMA) * multiplier + prevEMA);
    }
  }
  return result;
}

function computeRSIArray(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (prices.length < period + 1) return prices.map(() => null);

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(null);

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }

  return result;
}

function runFuturesCompoundBacktest(
  prices: PricePoint[],
  params: BacktestRequest,
  granularity: "hourly" | "daily"
): { trades: Trade[]; equityCurve: EquityPoint[] } {
  const trades: Trade[] = []
  const slippagePct = params.slippage_pct ?? 0.05
  const simulateWicks = params.simulate_wicks ?? true

  // Strategy params
  const leverage = params.leverage ?? 3
  const futuresAllocPct = params.futures_alloc_pct ?? 50
  const emaFast = params.ema_fast ?? 9
  const emaSlow = params.ema_slow ?? 21
  const rsiPeriodVal = params.rsi_period ?? 14
  const rsiOverbought = params.rsi_overbought ?? 70
  const rsiOversold = params.rsi_oversold ?? 30
  const futuresSlPct = params.futures_sl_pct ?? 2
  const futuresTpPct = params.futures_tp_pct ?? 4
  const maxFuturesHours = params.max_futures_hours ?? 24
  const fundingRatePct = params.funding_rate_pct ?? 0.01  // per 8h typically, we use hourly

  // Spot params
  const spotDipThreshold = params.dip_threshold_24h ?? -5
  const spotTpPct = params.take_profit_pct ?? 3
  const spotSlPct = params.stop_loss_pct ?? 5
  const spotMaxHoldingHours = params.max_holding_hours ?? 72

  const priceArr = prices.map(p => p.price)
  const emaFastValues = computeEMAArray(priceArr, emaFast)
  const emaSlowValues = computeEMAArray(priceArr, emaSlow)
  const rsiValues = computeRSIArray(priceArr, rsiPeriodVal)

  const candleEstimates = simulateWicks ? estimateCandleRanges(prices) : null

  // ─── Capital tracking ───────────────────────────────────────────────────
  let spotCapital = params.initial_capital
  let futuresPool = 0  // Capital allocated to futures (margin)

  // ─── Spot position tracking ─────────────────────────────────────────────
  let spotInPosition = false
  let spotEntryPrice = 0
  let spotEntryDate = ""
  let spotEntryTimestamp = 0
  let spotPositionSize = 0
  let spotNetPositionSize = 0

  // ─── Futures position tracking ──────────────────────────────────────────
  let futuresInPosition = false
  let futuresSide: 'long' | 'short' = 'long'
  let futuresEntryPrice = 0
  let futuresEntryDate = ""
  let futuresEntryTimestamp = 0
  let futuresMargin = 0     // Actual margin used
  let futuresPositionSize = 0  // Notional position (margin * leverage)
  let spotProfitsAccumulated = 0  // Accumulated spot profits available for futures

  const dailyEquity: Map<string, number> = new Map()
  dailyEquity.set(prices[0].date.split("T")[0], params.initial_capital)

  // Track 24h price change for spot dip detection
  const hoursPerCandle = granularity === "hourly" ? 1 : 24
  const candlesFor24h = Math.max(1, Math.round(24 / hoursPerCandle))

  for (let i = Math.max(emaSlow, rsiPeriodVal, candlesFor24h); i < prices.length; i++) {
    const current = prices[i]
    const dateKey = current.date.split("T")[0]
    const candle = candleEstimates ? candleEstimates[i] : null
    const emaF = emaFastValues[i]
    const emaS = emaSlowValues[i]
    const rsi = rsiValues[i]
    const prevEmaF = emaFastValues[i - 1]
    const prevEmaS = emaSlowValues[i - 1]

    // 24h price change for spot dip detection
    const price24hAgo = i >= candlesFor24h ? prices[i - candlesFor24h].price : current.price
    const change24h = ((current.price - price24hAgo) / price24hAgo) * 100

    // ─── FUTURES EXIT CHECK (check first — exits are priority) ────────────
    if (futuresInPosition) {
      let futuresExitReason: Trade["exit_reason"] | null = null
      let futuresExitPrice = current.price
      const hoursInFutures = (current.timestamp - futuresEntryTimestamp) / (1000 * 3600)

      if (futuresSide === 'long') {
        const profitPctAtClose = ((current.price - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage

        if (simulateWicks && candle) {
          const profitAtLow = ((candle.estimated_low - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage
          const profitAtHigh = ((candle.estimated_high - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage

          if (profitAtLow <= -futuresSlPct) {
            futuresExitReason = "stop_loss"
            futuresExitPrice = futuresEntryPrice * (1 - futuresSlPct / (100 * leverage))
          } else if (profitAtHigh >= futuresTpPct) {
            futuresExitReason = "take_profit"
            futuresExitPrice = futuresEntryPrice * (1 + futuresTpPct / (100 * leverage))
          }
        }

        if (!futuresExitReason) {
          if (profitPctAtClose <= -futuresSlPct) {
            futuresExitReason = "stop_loss"
            futuresExitPrice = futuresEntryPrice * (1 - futuresSlPct / (100 * leverage))
          } else if (profitPctAtClose >= futuresTpPct) {
            futuresExitReason = "take_profit"
            futuresExitPrice = futuresEntryPrice * (1 + futuresTpPct / (100 * leverage))
          } else if (hoursInFutures >= maxFuturesHours) {
            futuresExitReason = "time_stop"
            futuresExitPrice = current.price
          } else if (emaF !== null && emaS !== null && prevEmaF !== null && prevEmaS !== null
                     && prevEmaF >= prevEmaS && emaF < emaS) {
            futuresExitReason = "signal"
            futuresExitPrice = current.price
          }
        }
      } else {
        // SHORT position
        const profitPctAtClose = ((futuresEntryPrice - current.price) / futuresEntryPrice) * 100 * leverage

        if (simulateWicks && candle) {
          const profitAtHigh = ((candle.estimated_high - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage
          const profitAtLow = ((candle.estimated_low - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage

          if (profitAtHigh <= -futuresSlPct) {
            futuresExitReason = "stop_loss"
            futuresExitPrice = futuresEntryPrice * (1 + futuresSlPct / (100 * leverage))
          } else if (profitAtLow >= futuresTpPct) {
            futuresExitReason = "take_profit"
            futuresExitPrice = futuresEntryPrice * (1 - futuresTpPct / (100 * leverage))
          }
        }

        if (!futuresExitReason) {
          if (profitPctAtClose <= -futuresSlPct) {
            futuresExitReason = "stop_loss"
            futuresExitPrice = futuresEntryPrice * (1 + futuresSlPct / (100 * leverage))
          } else if (profitPctAtClose >= futuresTpPct) {
            futuresExitReason = "take_profit"
            futuresExitPrice = futuresEntryPrice * (1 - futuresTpPct / (100 * leverage))
          } else if (hoursInFutures >= maxFuturesHours) {
            futuresExitReason = "time_stop"
            futuresExitPrice = current.price
          } else if (emaF !== null && emaS !== null && prevEmaF !== null && prevEmaS !== null
                     && prevEmaF <= prevEmaS && emaF > emaS) {
            futuresExitReason = "signal"
            futuresExitPrice = current.price
          }
        }
      }

      if (futuresExitReason) {
        const effectiveExitPrice = applySellSlippage(futuresExitPrice, slippagePct)

        // Compute P&L for futures
        let futuresPnlPct: number
        if (futuresSide === 'long') {
          futuresPnlPct = ((effectiveExitPrice - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage
        } else {
          futuresPnlPct = ((futuresEntryPrice - effectiveExitPrice) / futuresEntryPrice) * 100 * leverage
        }

        // Funding rate cost
        const candlesHeld = Math.max(1, Math.round(hoursInFutures / hoursPerCandle))
        const fundingCost = futuresMargin * (fundingRatePct / 100) * candlesHeld

        const futuresGrossPnl = futuresMargin * (futuresPnlPct / 100)
        const exitFee = Math.abs(futuresMargin * (1 + futuresPnlPct / 100)) * (params.fee_pct / 100)
        const entryFee = futuresMargin * (params.fee_pct / 100)
        const totalFees = entryFee + exitFee + fundingCost
        const netPnl = futuresGrossPnl - totalFees

        // Futures profit flows back to spot capital
        spotCapital = round2(spotCapital + netPnl)
        spotCapital = Math.max(1, spotCapital)

        const totalCapital = spotCapital + futuresPool - futuresMargin

        trades.push({
          entry_date: futuresEntryDate,
          entry_price: round4(futuresEntryPrice),
          exit_date: current.date,
          exit_price: round4(effectiveExitPrice),
          exit_reason: futuresExitReason,
          profit_pct: round2(futuresPnlPct),
          net_profit_pct: round2((netPnl / (params.compound ? totalCapital : params.initial_capital)) * 100),
          capital_after: round2(spotCapital),
          fees_paid: round4(totalFees),
          slippage_paid: round4(futuresMargin * (slippagePct / 100) * 2),
        })

        futuresInPosition = false
        futuresPool = 0
      }
    }

    // ─── SPOT EXIT CHECK ──────────────────────────────────────────────────
    if (spotInPosition) {
      let spotExitReason: Trade["exit_reason"] | null = null
      let spotExitPrice = current.price
      const profitPctAtClose = ((current.price - spotEntryPrice) / spotEntryPrice) * 100

      if (simulateWicks && candle) {
        const profitAtLow = ((candle.estimated_low - spotEntryPrice) / spotEntryPrice) * 100
        const profitAtHigh = ((candle.estimated_high - spotEntryPrice) / spotEntryPrice) * 100

        if (profitAtLow <= -spotSlPct) {
          spotExitReason = "stop_loss"
          spotExitPrice = spotEntryPrice * (1 - spotSlPct / 100)
        } else if (profitAtHigh >= spotTpPct) {
          spotExitReason = "take_profit"
          spotExitPrice = spotEntryPrice * (1 + spotTpPct / 100)
        }
      }

      const hoursInSpot = (current.timestamp - spotEntryTimestamp) / (1000 * 3600)

      if (!spotExitReason) {
        if (profitPctAtClose <= -spotSlPct) {
          spotExitReason = "stop_loss"
          spotExitPrice = spotEntryPrice * (1 - spotSlPct / 100)
        } else if (profitPctAtClose >= spotTpPct) {
          spotExitReason = "take_profit"
          spotExitPrice = spotEntryPrice * (1 + spotTpPct / 100)
        } else if (hoursInSpot >= spotMaxHoldingHours) {
          spotExitReason = "time_stop"
          spotExitPrice = current.price
        }
      }

      if (spotExitReason) {
        const exec = executeExit(spotExitPrice, spotEntryPrice, spotNetPositionSize, spotCapital, params.initial_capital, true, params.fee_pct, slippagePct)
        spotCapital = exec.capitalAfter

        // Track spot profits for futures allocation
        if (exec.netPnl > 0) {
          spotProfitsAccumulated += exec.netPnl
        }

        trades.push({
          entry_date: spotEntryDate,
          entry_price: round4(spotEntryPrice),
          exit_date: current.date,
          exit_price: round4(exec.exitPrice),
          exit_reason: spotExitReason,
          profit_pct: round2(exec.actualProfitPct),
          net_profit_pct: round2(exec.netProfitPct),
          capital_after: round2(spotCapital),
          fees_paid: round4(exec.totalFees),
          slippage_paid: round4(exec.slippageCost),
        })

        spotInPosition = false
      }
    }

    // ─── FUTURES ENTRY CHECK ──────────────────────────────────────────────
    // Only enter futures if we have accumulated spot profits and no open futures position
    if (!futuresInPosition && spotProfitsAccumulated > 0 && emaF !== null && emaS !== null && prevEmaF !== null && prevEmaS !== null && rsi !== null) {
      const marginAvailable = spotProfitsAccumulated * (futuresAllocPct / 100)

      if (marginAvailable >= 10) {  // Minimum $10 margin
        let shouldEnter = false
        let side: 'long' | 'short' = 'long'

        // LONG: Fast EMA crosses above Slow EMA + RSI not overbought
        if (prevEmaF <= prevEmaS && emaF > emaS && rsi < rsiOverbought) {
          shouldEnter = true
          side = 'long'
        }
        // SHORT: Fast EMA crosses below Slow EMA + RSI not oversold
        else if (prevEmaF >= prevEmaS && emaF < emaS && rsi > rsiOversold) {
          shouldEnter = true
          side = 'short'
        }

        if (shouldEnter) {
          const entry = executeEntry(current.price, marginAvailable, params.fee_pct, slippagePct)

          futuresInPosition = true
          futuresSide = side
          futuresEntryPrice = entry.effectivePrice
          futuresEntryDate = current.date
          futuresEntryTimestamp = current.timestamp
          futuresMargin = marginAvailable
          futuresPositionSize = marginAvailable * leverage

          // Deduct margin from spot profits pool
          spotProfitsAccumulated -= marginAvailable
          spotCapital -= marginAvailable
          spotCapital = Math.max(1, spotCapital)
          futuresPool = marginAvailable
        }
      }
    }

    // ─── SPOT ENTRY CHECK (dip buying) ────────────────────────────────────
    if (!spotInPosition && change24h <= spotDipThreshold) {
      const rawPositionSize = params.compound ? spotCapital : params.initial_capital
      // Only use capital not already in futures
      const availableForSpot = futuresInPosition ? Math.max(0, spotCapital) : spotCapital
      if (availableForSpot >= 10) {
        const entry = executeEntry(current.price, availableForSpot, params.fee_pct, slippagePct)
        spotInPosition = true
        spotEntryPrice = entry.effectivePrice
        spotEntryDate = current.date
        spotEntryTimestamp = current.timestamp
        spotPositionSize = availableForSpot
        spotNetPositionSize = entry.netPositionSize
      }
    }

    // ─── Equity tracking ──────────────────────────────────────────────────
    let unrealizedFuturesPnl = 0
    if (futuresInPosition) {
      if (futuresSide === 'long') {
        unrealizedFuturesPnl = futuresMargin * ((current.price - futuresEntryPrice) / futuresEntryPrice) * leverage
      } else {
        unrealizedFuturesPnl = futuresMargin * ((futuresEntryPrice - current.price) / futuresEntryPrice) * leverage
      }
    }

    let unrealizedSpotPnl = 0
    if (spotInPosition) {
      const spotProfitPct = ((current.price - spotEntryPrice) / spotEntryPrice) * 100
      unrealizedSpotPnl = spotNetPositionSize * (spotProfitPct / 100)
    }

    const totalCapitalNow = spotCapital + unrealizedSpotPnl + futuresPool + unrealizedFuturesPnl
    if (!dailyEquity.has(dateKey) || dailyEquity.get(dateKey)! > totalCapitalNow) {
      dailyEquity.set(dateKey, Math.min(totalCapitalNow, totalCapitalNow))
    }
  }

  // Force close spot position
  if (spotInPosition) {
    const lastPoint = prices[prices.length - 1]
    const exec = executeExit(lastPoint.price, spotEntryPrice, spotNetPositionSize, spotCapital, params.initial_capital, true, params.fee_pct, slippagePct)
    spotCapital = exec.capitalAfter
    trades.push({
      entry_date: spotEntryDate, entry_price: round4(spotEntryPrice),
      exit_date: lastPoint.date, exit_price: round4(exec.exitPrice),
      exit_reason: "time_stop", profit_pct: round2(exec.actualProfitPct),
      net_profit_pct: round2(exec.netProfitPct), capital_after: round2(spotCapital),
      fees_paid: round4(exec.totalFees), slippage_paid: round4(exec.slippageCost),
    })
  }

  // Force close futures position
  if (futuresInPosition) {
    const lastPoint = prices[prices.length - 1]
    let futuresPnlPct: number
    if (futuresSide === 'long') {
      futuresPnlPct = ((lastPoint.price - futuresEntryPrice) / futuresEntryPrice) * 100 * leverage
    } else {
      futuresPnlPct = ((futuresEntryPrice - lastPoint.price) / futuresEntryPrice) * 100 * leverage
    }
    const netPnl = futuresMargin * (futuresPnlPct / 100) - futuresMargin * (params.fee_pct / 100) * 2
    spotCapital = round2(Math.max(1, spotCapital + netPnl))

    trades.push({
      entry_date: futuresEntryDate, entry_price: round4(futuresEntryPrice),
      exit_date: lastPoint.date, exit_price: round4(lastPoint.price),
      exit_reason: "time_stop", profit_pct: round2(futuresPnlPct),
      net_profit_pct: round2((netPnl / params.initial_capital) * 100),
      capital_after: round2(spotCapital),
      fees_paid: round4(futuresMargin * (params.fee_pct / 100) * 2),
      slippage_paid: round4(futuresMargin * (slippagePct / 100) * 2),
    })
  }

  return { trades, equityCurve: buildEquityCurve(dailyEquity) }
}

// ─── Main Backtest Engine (dispatcher) ──────────────────────────────────────

export function runBacktest(
  prices: PricePoint[],
  params: BacktestRequest
): {
  trades: Trade[];
  equityCurve: EquityPoint[];
  results: BacktestResults;
} {
  const strategyType = params.strategy_type || "dip_buying";
  const granularity = params.days <= 90 ? "hourly" as const : "daily" as const;
  const baseSlippagePct = Math.max(0, params.slippage_pct ?? 0.05)
  const latencyMs = Math.max(0, params.latency_ms ?? 0)
  const latencyAdverseBpsPerSecond = Math.max(0, params.latency_adverse_bps_per_second ?? 0.5)
  const latencyAdversePctPerSide = (latencyMs / 1_000) * latencyAdverseBpsPerSecond / 100
  const slippagePct = baseSlippagePct + latencyAdversePctPerSide
  const wickSimulation = params.simulate_wicks ?? true
  const executionAdjustedParams: BacktestRequest = {
    ...params,
    slippage_pct: slippagePct,
  }

  let trades: Trade[]
  let equityCurve: EquityPoint[]

  switch (strategyType) {
    case "momentum":
      ({ trades, equityCurve } = runMomentumBacktest(prices, executionAdjustedParams, granularity))
      break
    case "mean_reversion":
      ({ trades, equityCurve } = runMeanReversionBacktest(prices, executionAdjustedParams, granularity))
      break
    case "breakout":
      ({ trades, equityCurve } = runBreakoutBacktest(prices, executionAdjustedParams, granularity))
      break
    case "grid":
      ({ trades, equityCurve } = runGridBacktest(prices, executionAdjustedParams, granularity))
      break
    case "hurst_hcoo_lb":
      ({ trades, equityCurve } = runHurstHcooLbBacktest(prices, executionAdjustedParams, granularity))
      break
    case "futures_compound":
      ({ trades, equityCurve } = runFuturesCompoundBacktest(prices, executionAdjustedParams, granularity))
      break
    case "dip_buying":
    default:
      ({ trades, equityCurve } = runDipBuyingBacktest(prices, executionAdjustedParams, granularity))
      break
  }

  const results = computeResults(trades, params.initial_capital, equityCurve, granularity, slippagePct, wickSimulation);
  results.base_slippage_pct = baseSlippagePct
  results.latency_ms = latencyMs
  results.latency_adverse_pct_per_side = latencyAdversePctPerSide

  return { trades, equityCurve, results };
}
