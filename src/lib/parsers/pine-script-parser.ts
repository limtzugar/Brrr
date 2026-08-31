// ─── Pine Script Parser ─────────────────────────────────────────────────────
// Extracts trading logic from TradingView Pine Script code.
// Converts Pine Script indicators/strategies into Trading Platform backtest parameters.
// Supports Pine Script v3, v4, v5.

export interface ParsedPineScript {
  name: string
  version: number
  type: 'strategy' | 'indicator' | 'unknown'
  description: string
  inputs: PineInput[]
  conditions: PineCondition[]
  strategyCalls: PineStrategyCall[]
  mappedStrategy: MappedStrategy | null
  warnings: string[]
  rawCode: string
}

export interface PineInput {
  name: string
  type: 'int' | 'float' | 'bool' | 'string' | 'source' | 'unknown'
  default: string | number | boolean
  min?: number
  max?: number
  step?: number
  group?: string
  tooltip?: string
}

export interface PineCondition {
  type: 'long_entry' | 'short_entry' | 'long_exit' | 'short_exit' | 'filter' | 'custom'
  description: string
  expression: string
  line: number
}

export interface PineStrategyCall {
  action: 'entry' | 'exit' | 'close'
  direction: 'long' | 'short' | 'both'
  name: string
  condition?: string
  limit?: string
  stop?: string
  qty?: string
  qtyPercent?: number
}

export interface MappedStrategy {
  strategyType: string
  params: Record<string, unknown>
  confidence: number // 0-100
  notes: string
}

// ─── Regex Patterns ────────────────────────────────────────────────────────

const PINE_VERSION_RE = /\/\/@version=(\d)/
const STRATEGY_DECL_RE = /strategy\s*\(\s*["']([^"']+)["']/i
const INDICATOR_DECL_RE = /indicator\s*\(\s*["']([^"']+)["']/i
const INPUT_INT_RE = /input\s*\(\s*(?:defval\s*=\s*)?(\d+)\s*,\s*["']([^"']+)["']\s*(?:,\s*minval\s*=\s*(-?\d+))?\s*(?:,\s*maxval\s*=\s*(\d+))?\s*(?:,\s*step\s*=\s*(\d+))?\s*(?:,\s*group\s*=\s*["']([^"']*)["'])?/i
const INPUT_FLOAT_RE = /input\s*\(\s*(?:defval\s*=\s*)?([\d.]+)\s*,\s*["']([^"']+)["']\s*(?:,\s*minval\s*=\s*([\d.-]+))?\s*(?:,\s*maxval\s*=\s*([\d.]+))?\s*(?:,\s*step\s*=\s*([\d.]+))?\s*(?:,\s*group\s*=\s*["']([^"']*)["'])?/i
const INPUT_BOOL_RE = /input\s*\(\s*(?:defval\s*=\s*)?(true|false)\s*,\s*["']([^"']+)["']/i
const INPUT_SOURCE_RE = /input\.source\s*\([^,]+,\s*["']([^"']+)["']/i

// Strategy calls
const STRATEGY_ENTRY_RE = /strategy\.(entry|exit|close)\s*\(\s*["']([^"']+)["']/i
const STRATEGY_LONG_RE = /strategy\.entry\s*\([^)]*direction\s*=\s*strategy\.(long|short)/i
const STRATEGY_QTY_PCT_RE = /qty_percent\s*=\s*([\d.]+)/i

// Common indicators
const TA_EMA_RE = /ta\.ema\s*\(\s*(?:close|src|source)\s*,\s*(\w+|\d+)\)/gi
const TA_SMA_RE = /ta\.sma\s*\(\s*(?:close|src|source)\s*,\s*(\w+|\d+)\)/gi
const TA_RSI_RE = /ta\.rsi\s*\(\s*(?:close|src|source)\s*,\s*(\w+|\d+)\)/gi
const TA_MACD_RE = /ta\.macd\s*\([^)]+\)/gi
const TA_BB_RE = /ta\.bb\s*\([^)]+\)/gi
const TA_ATR_RE = /ta\.atr\s*\(\s*(\w+|\d+)\)/gi
const TA_CROSS_RE = /ta\.crossover\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/gi
const TA_CROSSUNDER_RE = /ta\.crossunder\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/gi

// v3/v4 style
const EMA_RE_V3 = /ema\s*\(\s*(?:close|src)\s*,\s*(\w+|\d+)\)/gi
const SMA_RE_V3 = /sma\s*\(\s*(?:close|src)\s*,\s*(\w+|\d+)\)/gi
const RSI_RE_V3 = /rsi\s*\(\s*(?:close|src)\s*,\s*(\w+|\d+)\)/gi

// ─── Main Parser ───────────────────────────────────────────────────────────

export function parsePineScript(code: string): ParsedPineScript {
  const warnings: string[] = []
  const inputs: PineInput[] = []
  const conditions: PineCondition[] = []
  const strategyCalls: PineStrategyCall[] = []

  // Detect version
  const versionMatch = code.match(PINE_VERSION_RE)
  const version = versionMatch ? parseInt(versionMatch[1]) : 5

  // Detect type and name
  let name = 'Unnamed Script'
  let type: ParsedPineScript['type'] = 'unknown'

  const strategyMatch = code.match(STRATEGY_DECL_RE)
  const indicatorMatch = code.match(INDICATOR_DECL_RE)

  if (strategyMatch) {
    name = strategyMatch[1]
    type = 'strategy'
  } else if (indicatorMatch) {
    name = indicatorMatch[1]
    type = 'indicator'
    warnings.push('Skrypt jest indykatorem, nie strategią — warunki wejścia/wyjścia mogą wymagać ręcznego mapowania')
  }

  // Extract description from strategy/indicator call
  let description = ''
  const descMatch = code.match(/(?:strategy|indicator)\s*\([^)]*description\s*=\s*["']([^"']+)["']/i)
  if (descMatch) description = descMatch[1]

  // Parse inputs
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Skip comments
    if (line.startsWith('//')) continue

    // Input int
    let m = line.match(INPUT_INT_RE)
    if (m) {
      inputs.push({
        name: m[2],
        type: 'int',
        default: parseInt(m[1]),
        min: m[3] ? parseInt(m[3]) : undefined,
        max: m[4] ? parseInt(m[4]) : undefined,
        step: m[5] ? parseInt(m[5]) : undefined,
        group: m[6] || undefined,
      })
      continue
    }

    // Input float
    m = line.match(INPUT_FLOAT_RE)
    if (m) {
      inputs.push({
        name: m[2],
        type: 'float',
        default: parseFloat(m[1]),
        min: m[3] ? parseFloat(m[3]) : undefined,
        max: m[4] ? parseFloat(m[4]) : undefined,
        step: m[5] ? parseFloat(m[5]) : undefined,
        group: m[6] || undefined,
      })
      continue
    }

    // Input bool
    m = line.match(INPUT_BOOL_RE)
    if (m) {
      inputs.push({
        name: m[2],
        type: 'bool',
        default: m[1] === 'true',
      })
      continue
    }

    // Input source
    m = line.match(INPUT_SOURCE_RE)
    if (m) {
      inputs.push({
        name: m[1],
        type: 'source',
        default: 'close',
      })
      continue
    }
  }

  // Detect crossover/crossunder conditions (entry/exit signals)
  const crossMatches = [...code.matchAll(TA_CROSS_RE)]
  for (const cm of crossMatches) {
    const lineNum = code.substring(0, cm.index!).split('\n').length
    conditions.push({
      type: 'long_entry',
      description: `Crossover ${cm[1]} x ${cm[2]}`,
      expression: cm[0],
      line: lineNum,
    })
  }

  const crossUnderMatches = [...code.matchAll(TA_CROSSUNDER_RE)]
  for (const cm of crossUnderMatches) {
    const lineNum = code.substring(0, cm.index!).split('\n').length
    conditions.push({
      type: 'short_entry',
      description: `Crossunder ${cm[1]} x ${cm[2]}`,
      expression: cm[0],
      line: lineNum,
    })
  }

  // Detect RSI conditions
  const rsiMatches = version >= 5
    ? [...code.matchAll(TA_RSI_RE)]
    : [...code.matchAll(RSI_RE_V3)]
  const rsiPeriods = rsiMatches.map(m => m[1])

  // Detect EMA values
  const emaMatches = version >= 5
    ? [...code.matchAll(TA_EMA_RE)]
    : [...code.matchAll(EMA_RE_V3)]
  const emaPeriods = emaMatches.map(m => m[1])

  // Detect SMA values
  const smaMatches = version >= 5
    ? [...code.matchAll(TA_SMA_RE)]
    : [...code.matchAll(SMA_RE_V3)]
  const smaPeriods = smaMatches.map(m => m[1])

  // Detect strategy.entry / strategy.exit calls
  const entryMatches = [...code.matchAll(STRATEGY_ENTRY_RE)]
  for (const em of entryMatches) {
    const call: PineStrategyCall = {
      action: em[1] === 'entry' ? 'entry' : em[1] === 'exit' ? 'exit' : 'close',
      direction: 'both',
      name: em[2],
    }

    // Try to detect direction from same or next line
    const callLine = code.substring(em.index!, code.indexOf('\n', em.index!))
    const dirMatch = callLine.match(STRATEGY_LONG_RE)
    if (dirMatch) {
      call.direction = dirMatch[1] as 'long' | 'short'
    }

    // Detect qty_percent
    const qtyMatch = callLine.match(STRATEGY_QTY_PCT_RE)
    if (qtyMatch) {
      call.qtyPercent = parseFloat(qtyMatch[1])
    }

    strategyCalls.push(call)
  }

  // Detect RSI threshold conditions (oversold/overbought)
  const rsiConditionRe = /(?:rsi|ta\.rsi)\s*\([^)]+\)\s*(?:<|<=|>|>=)\s*(\d+)/gi
  const rsiCondMatches = [...code.matchAll(rsiConditionRe)]
  for (const rc of rsiCondMatches) {
    const threshold = parseInt(rc[1])
    const expr = rc[0]
    const lineNum = code.substring(0, rc.index!).split('\n').length
    const operator = expr.includes('<=') ? '<=' : expr.includes('>=') ? '>=' : expr.includes('<') ? '<' : '>'

    conditions.push({
      type: threshold < 40 ? 'long_entry' : threshold > 60 ? 'short_entry' : 'custom',
      description: `RSI ${operator} ${threshold}`,
      expression: expr,
      line: lineNum,
    })
  }

  // ─── Map to Trading Platform Strategy ───────────────────────────────────────

  const mappedStrategy = mapToTradingStrategy({
    name,
    inputs,
    conditions,
    emaPeriods,
    smaPeriods,
    rsiPeriods,
    strategyCalls,
    code,
    warnings,
  })

  return {
    name,
    version,
    type,
    description,
    inputs,
    conditions,
    strategyCalls,
    mappedStrategy,
    warnings,
    rawCode: code,
  }
}

// ─── Strategy Mapper ───────────────────────────────────────────────────────

function mapToTradingStrategy(context: {
  name: string
  inputs: PineInput[]
  conditions: PineCondition[]
  emaPeriods: string[]
  smaPeriods: string[]
  rsiPeriods: string[]
  strategyCalls: PineStrategyCall[]
  code: string
  warnings: string[]
}): MappedStrategy | null {
  const { inputs, conditions, emaPeriods, smaPeriods, rsiPeriods, strategyCalls, code, warnings } = context

  // ─── EMA Crossover Detection ──────────────────────────────────────────
  if (emaPeriods.length >= 2 || (emaPeriods.length >= 1 && smaPeriods.length >= 1)) {
    const fastPeriod = parseInt(emaPeriods[0]) || 9
    const slowPeriod = parseInt(emaPeriods[1] || smaPeriods[0]) || 21

    // Find TP/SL inputs
    const tpInput = inputs.find(i => /take.?profit|tp|profit/i.test(i.name))
    const slInput = inputs.find(i => /stop.?loss|sl/i.test(i.name))

    // Find MA filter
    const maFilterInput = inputs.find(i => /filter|trend|ma.?filter/i.test(i.name))

    return {
      strategyType: 'ema_crossover',
      params: {
        ema_fast: fastPeriod,
        ema_slow: slowPeriod,
        ema_cross_tp_pct: tpInput ? Number(tpInput.default) : 5,
        ema_cross_sl_pct: slInput ? Number(slInput.default) : 3,
        ema_cross_ma_filter: maFilterInput ? (maFilterInput.type === 'bool' ? (maFilterInput.default ? 50 : 0) : Number(maFilterInput.default)) : 0,
        take_profit_pct: tpInput ? Number(tpInput.default) : 5,
        stop_loss_pct: slInput ? Number(slInput.default) : 3,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
      },
      confidence: 75,
      notes: `EMA Crossover: fast=${fastPeriod}, slow=${slowPeriod}. Mapowanie automatyczne z Pine Script.`,
    }
  }

  // ─── RSI Strategy Detection ───────────────────────────────────────────
  if (rsiPeriods.length > 0) {
    const rsiPeriod = parseInt(rsiPeriods[0]) || 14
    const hasOversold = conditions.some(c => /RSI\s*[<]=?\s*3\d/.test(c.description))
    const hasOverbought = conditions.some(c => /RSI\s*[>]=?\s*6\d/.test(c.description))

    if (hasOversold || hasOverbought) {
      // This could be RSI divergence or mean reversion
      const tpInput = inputs.find(i => /take.?profit|tp/i.test(i.name))
      const slInput = inputs.find(i => /stop.?loss|sl/i.test(i.name))

      // Check for divergence patterns in code
      const hasDivergence = /diverg|div_/i.test(code)

      if (hasDivergence) {
        const lookbackInput = inputs.find(i => /lookback|pivot|length/i.test(i.name))
        const strengthInput = inputs.find(i => /strength|min/i.test(i.name))

        return {
          strategyType: 'rsi_divergence',
          params: {
            rsi_div_period: rsiPeriod,
            rsi_div_lookback: lookbackInput ? Number(lookbackInput.default) : 20,
            rsi_div_min_strength: strengthInput ? Number(strengthInput.default) : 1,
            take_profit_pct: tpInput ? Number(tpInput.default) : 5,
            stop_loss_pct: slInput ? Number(slInput.default) : 5,
            initial_capital: 1000,
            compound: true,
            fee_pct: 0.1,
          },
          confidence: 65,
          notes: `RSI Divergence: period=${rsiPeriod}. Wykryto warunki dywergencji w Pine Script.`,
        }
      }

      // Mean reversion / RSI-based dip buying
      const dipInput1h = inputs.find(i => /dip|threshold|oversold/i.test(i.name))
      return {
        strategyType: 'dip_buying',
        params: {
          dip_threshold_1h: dipInput1h ? Number(dipInput1h.default) : -2,
          dip_threshold_24h: -5,
          take_profit_pct: tpInput ? Number(tpInput.default) : 3,
          stop_loss_pct: slInput ? Number(slInput.default) : 5,
          initial_capital: 1000,
          compound: true,
          fee_pct: 0.1,
        },
        confidence: 55,
        notes: `RSI-based dip buying: RSI period=${rsiPeriod}. Mapowanie przybliżone — RSI conditions → dip thresholds.`,
      }
    }
  }

  // ─── MACD Detection ───────────────────────────────────────────────────
  if (/macd/i.test(code)) {
    const fastInput = inputs.find(i => /fast|short/i.test(i.name))
    const slowInput = inputs.find(i => /slow|long/i.test(i.name))
    const signalInput = inputs.find(i => /signal/i.test(i.name))
    const tpInput = inputs.find(i => /take.?profit|tp/i.test(i.name))
    const slInput = inputs.find(i => /stop.?loss|sl/i.test(i.name))

    return {
      strategyType: 'momentum',
      params: {
        ma_period: slowInput ? Number(slowInput.default) : 26,
        volume_threshold: 1.5,
        take_profit_pct: tpInput ? Number(tpInput.default) : 5,
        stop_loss_pct: slInput ? Number(slInput.default) : 5,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
        // MACD params stored as extra context
        _pine_macd_fast: fastInput ? Number(fastInput.default) : 12,
        _pine_macd_slow: slowInput ? Number(slowInput.default) : 26,
        _pine_macd_signal: signalInput ? Number(signalInput.default) : 9,
      },
      confidence: 50,
      notes: `MACD momentum: fast=${fastInput?.default || 12}, slow=${slowInput?.default || 26}, signal=${signalInput?.default || 9}. Mapowanie przybliżone — MACD → momentum strategy.`,
    }
  }

  // ─── Bollinger Bands Detection ────────────────────────────────────────
  if (/bb|bollinger/i.test(code)) {
    const bbPeriodInput = inputs.find(i => /bb|boll|length|period/i.test(i.name))
    const bbStdInput = inputs.find(i => /std|mult|dev/i.test(i.name))
    const tpInput = inputs.find(i => /take.?profit|tp/i.test(i.name))
    const slInput = inputs.find(i => /stop.?loss|sl/i.test(i.name))

    return {
      strategyType: 'mean_reversion',
      params: {
        ma_period: bbPeriodInput ? Number(bbPeriodInput.default) : 20,
        deviation_threshold: bbStdInput ? Number(bbStdInput.default) : 2,
        take_profit_pct: tpInput ? Number(tpInput.default) : 3,
        stop_loss_pct: slInput ? Number(slInput.default) : 5,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
      },
      confidence: 55,
      notes: `Bollinger Bands → Mean Reversion: period=${bbPeriodInput?.default || 20}, std=${bbStdInput?.default || 2}.`,
    }
  }

  // ─── Grid/DCA Detection ───────────────────────────────────────────────
  if (/grid|ladder|dca/i.test(code)) {
    const stepsInput = inputs.find(i => /step|level|count|ladder/i.test(i.name))
    const spacingInput = inputs.find(i => /spacing|gap|grid/i.test(i.name))
    const sizeInput = inputs.find(i => /size|percent|alloc/i.test(i.name))

    return {
      strategyType: 'dca_ladder',
      params: {
        dca_ladder_steps: stepsInput ? Number(stepsInput.default) : 4,
        dca_ladder_spacing_pct: spacingInput ? Number(spacingInput.default) : 3,
        dca_ladder_size_pct: sizeInput ? Number(sizeInput.default) : 25,
        take_profit_pct: 5,
        stop_loss_pct: 10,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
      },
      confidence: 45,
      notes: `Grid/DCA strategy detected. Mapowanie przybliżone — grid/ladder → DCA Ladder.`,
    }
  }

  // ─── Breakout Detection ───────────────────────────────────────────────
  if (/breakout|highest|lowest|channel|donchian/i.test(code)) {
    const lookbackInput = inputs.find(i => /length|period|lookback/i.test(i.name))
    const confirmInput = inputs.find(i => /confirm|bar/i.test(i.name))
    const tpInput = inputs.find(i => /take.?profit|tp/i.test(i.name))
    const slInput = inputs.find(i => /stop.?loss|sl/i.test(i.name))

    return {
      strategyType: 'breakout',
      params: {
        lookback_periods: lookbackInput ? Number(lookbackInput.default) : 20,
        breakout_confirm_bars: confirmInput ? Number(confirmInput.default) : 2,
        take_profit_pct: tpInput ? Number(tpInput.default) : 5,
        stop_loss_pct: slInput ? Number(slInput.default) : 5,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
      },
      confidence: 50,
      notes: `Breakout strategy detected. Mapowanie z highest/lowest → breakout.`,
    }
  }

  // ─── Fallback: Generic with AI analysis needed ────────────────────────
  if (strategyCalls.length > 0 || conditions.length > 0) {
    warnings.push('Nie udało się automatycznie zmapować strategii — wymaga analizy AI')
    return {
      strategyType: 'dip_buying',
      params: {
        dip_threshold_1h: -2,
        dip_threshold_24h: -5,
        take_profit_pct: 3,
        stop_loss_pct: 5,
        initial_capital: 1000,
        compound: true,
        fee_pct: 0.1,
        _pine_custom: true,
        _pine_conditions: conditions.map(c => c.description),
        _pine_inputs: inputs.map(i => `${i.name}=${i.default}`),
      },
      confidence: 20,
      notes: `Złożona strategia Pine Script — wymaga ręcznego dostrojenia. ${conditions.length} warunków, ${inputs.length} parametrów.`,
    }
  }

  warnings.push('Nie wykryto żadnej znanej strategii — Pine Script nie zawiera wystarczających sygnałów')
  return null
}

// ─── Summary Generator (for AI context) ────────────────────────────────────

export function generatePineScriptSummary(parsed: ParsedPineScript): string {
  const lines: string[] = []

  lines.push(`=== PINE SCRIPT ANALYSIS ===`)
  lines.push(`Name: ${parsed.name}`)
  lines.push(`Version: Pine Script v${parsed.version}`)
  lines.push(`Type: ${parsed.type}`)
  if (parsed.description) lines.push(`Description: ${parsed.description}`)
  lines.push('')

  if (parsed.inputs.length > 0) {
    lines.push(`INPUTS (${parsed.inputs.length}):`)
    for (const inp of parsed.inputs) {
      const range = inp.min !== undefined ? ` [${inp.min}..${inp.max}]` : ''
      lines.push(`  - ${inp.name} (${inp.type}): default=${inp.default}${range}`)
    }
    lines.push('')
  }

  if (parsed.conditions.length > 0) {
    lines.push(`CONDITIONS (${parsed.conditions.length}):`)
    for (const cond of parsed.conditions) {
      lines.push(`  - [${cond.type}] ${cond.description} (line ${cond.line})`)
    }
    lines.push('')
  }

  if (parsed.strategyCalls.length > 0) {
    lines.push(`STRATEGY CALLS (${parsed.strategyCalls.length}):`)
    for (const sc of parsed.strategyCalls) {
      lines.push(`  - ${sc.action} ${sc.direction} "${sc.name}"${sc.qtyPercent ? ` qty=${sc.qtyPercent}%` : ''}`)
    }
    lines.push('')
  }

  if (parsed.mappedStrategy) {
    lines.push(`MAPPED TO TRADING STRATEGY:`)
    lines.push(`  Strategy: ${parsed.mappedStrategy.strategyType}`)
    lines.push(`  Confidence: ${parsed.mappedStrategy.confidence}%`)
    lines.push(`  Params: ${JSON.stringify(parsed.mappedStrategy.params, null, 2)}`)
    lines.push(`  Notes: ${parsed.mappedStrategy.notes}`)
  } else {
    lines.push('MAPPING: FAILED — no compatible strategy detected')
  }

  if (parsed.warnings.length > 0) {
    lines.push('')
    lines.push('WARNINGS:')
    for (const w of parsed.warnings) {
      lines.push(`  ⚠️ ${w}`)
    }
  }

  return lines.join('\n')
}
