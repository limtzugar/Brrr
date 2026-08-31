'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, CircleStop, DollarSign, FlaskConical, Flame, Gauge,
  Pencil, Play, Plus, RefreshCw, Thermometer, Trash2, Trophy,
} from 'lucide-react'
import {
  type ActiveStrategyInfo, type StrategyConfig, type StrategyResult,
  type OptimizeResponse, type OptimizeResultItem,
  COIN_OPTIONS, STRATEGY_TYPE_OPTIONS, DEFAULT_STRATEGIES,
  strategyTypeBadge, strategyTypeIcon, strategyTypeLabel,
  getStrategyParamsFromConfig, getDefaultParamsForType, formatPct,
} from '@/lib/trading-shared'
import { useTE } from '@/lib/te-theme'

interface StrategiessssTabProps {
  activeStrategiessss: ActiveStrategyInfo[]
  onStrategyChange: () => void
}

// ─── TE Inline Helpers ──────────────────────────────────────────────────────

function teCard(te: ReturnType<typeof useTE>, overrides?: { background?: string; border?: string }) {
  return { background: overrides?.background ?? te.bgCard, border: `1px solid ${overrides?.border ?? te.border}`, borderRadius: '2px' }
}

function teInput(te: ReturnType<typeof useTE>) {
  return { background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }
}

function teSelect(te: ReturnType<typeof useTE>) {
  return { background: te.bgInput, border: `1px solid ${te.border}`, color: te.text, fontFamily: te.mono }
}

function teLabel(te: ReturnType<typeof useTE>) {
  return { color: te.textDim, fontFamily: te.mono, letterSpacing: '0.08em' }
}

function teBadge(bg: string, color: string, borderAlpha = '33') {
  return { background: bg, color, border: `1px solid ${color}${borderAlpha}`, fontFamily: 'inherit', letterSpacing: '0.04em' }
}

function teMetricBox(te: ReturnType<typeof useTE>) {
  return { background: te.bgInput, border: `1px solid ${te.border}` }
}

// ─── StrategyCard ────────────────────────────────────────────────────────────

function StrategyCard({ strategy, result, onEdit, onDelete, isEditing, editForm, onEditFormChange, onSave, onCancel, activeInfo, activatingKey, onActivate, onDeactivate, onRetry }: {
  strategy: StrategyConfig; result: StrategyResult | null; onEdit: () => void; onDelete: () => void;
  isEditing: boolean; editForm: StrategyConfig | null; onEditFormChange: (f: StrategyConfig | null) => void;
  onSave: () => void; onCancel: () => void; activeInfo: ActiveStrategyInfo[];
  activatingKey: string | null; onActivate: (s: StrategyConfig, mode: 'demo' | 'real') => void;
  onDeactivate: (strategyId: string, mode: 'demo' | 'real') => void; onRetry: (strategyId: string) => void;
}) {
  const te = useTE()
  const coinLabel = COIN_OPTIONS.find(c => c.id === strategy.coin_id)?.label || strategy.coin_id
  const demoActive = activeInfo.find(a => a.strategyId === strategy.id && a.mode === 'demo')
  const realActive = activeInfo.find(a => a.strategyId === strategy.id && a.mode === 'real')
  const demoActivating = activatingKey === `${strategy.id}:demo`
  const realActivating = activatingKey === `${strategy.id}:real`

  // ── Editing Mode ──
  if (isEditing && editForm) {
    const currentType = editForm.strategy_type || 'dip_buying'
    const handleTypeChange = (newType: string) => {
      const defaults = getDefaultParamsForType(newType)
      onEditFormChange({ ...editForm, strategy_type: newType, ...defaults })
    }

    return (
      <div style={{ ...teCard(te, { border: `${te.yellow}80` }), padding: 0 }}>
        {/* Header / Name Input */}
        <div className="px-3 pt-3 pb-2" style={{ borderBottom: `1px solid ${te.border}` }}>
          <input
            type="text"
            value={editForm.name}
            onChange={e => onEditFormChange({ ...editForm, name: e.target.value })}
            placeholder="Nazwa strategii"
            className="w-full px-2 py-1 text-[10px] font-bold rounded-sm outline-none"
            style={{ ...teInput(te), letterSpacing: '0.04em' }}
          />
        </div>

        {/* Form Body */}
        <div className="space-y-2 px-3 pb-3 pt-2">
          {/* Strategy Type */}
          <div>
            <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Typ strategii</span>
            <select
              value={currentType}
              onChange={e => handleTypeChange(e.target.value)}
              className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5"
              style={teSelect(te)}
            >
              {STRATEGY_TYPE_OPTIONS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Coin */}
          <div>
            <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Coin</span>
            <select
              value={editForm.coin_id}
              onChange={e => onEditFormChange({ ...editForm, coin_id: e.target.value })}
              className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5"
              style={teSelect(te)}
            >
              {COIN_OPTIONS.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Strategy-specific params */}
          {(currentType === 'dip_buying') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Dip 1h (%)</span>
                <input type="number" value={editForm.dip_threshold_1h} onChange={e => onEditFormChange({ ...editForm, dip_threshold_1h: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Dip 24h (%)</span>
                <input type="number" value={editForm.dip_threshold_24h} onChange={e => onEditFormChange({ ...editForm, dip_threshold_24h: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
            </div>
          )}
          {(currentType === 'momentum') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>MA period</span>
                <input type="number" value={editForm.ma_period} onChange={e => onEditFormChange({ ...editForm, ma_period: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} min={2} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Volume threshold</span>
                <input type="number" value={editForm.volume_threshold} onChange={e => onEditFormChange({ ...editForm, volume_threshold: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} step={0.1} min={0.1} />
              </div>
            </div>
          )}
          {(currentType === 'mean_reversion') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>MA period</span>
                <input type="number" value={editForm.ma_period} onChange={e => onEditFormChange({ ...editForm, ma_period: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} min={2} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Deviation threshold (σ)</span>
                <input type="number" value={editForm.deviation_threshold} onChange={e => onEditFormChange({ ...editForm, deviation_threshold: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} step={0.5} min={0.5} />
              </div>
            </div>
          )}
          {(currentType === 'breakout') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Okresy lookback</span>
                <input type="number" value={editForm.lookback_periods} onChange={e => onEditFormChange({ ...editForm, lookback_periods: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} min={2} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Paski potwierdzenia</span>
                <input type="number" value={editForm.breakout_confirm_bars} onChange={e => onEditFormChange({ ...editForm, breakout_confirm_bars: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} min={1} />
              </div>
            </div>
          )}
          {(currentType === 'grid') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Grid spacing (%)</span>
                <input type="number" value={editForm.grid_spacing_pct} onChange={e => onEditFormChange({ ...editForm, grid_spacing_pct: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} step={0.5} min={0.5} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Grid levels</span>
                <input type="number" value={editForm.grid_levels} onChange={e => onEditFormChange({ ...editForm, grid_levels: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} min={2} />
              </div>
            </div>
          )}
          {(currentType === 'hurst_hcoo_lb') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Okres Hurst</span>
                <input type="number" value={editForm.hurst_period} onChange={e => onEditFormChange({ ...editForm, hurst_period: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>H prog (0.1-0.9)</span>
                <input type="number" step={0.05} value={editForm.hurst_threshold} onChange={e => onEditFormChange({ ...editForm, hurst_threshold: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>BB okres</span>
                <input type="number" value={editForm.bb_period} onChange={e => onEditFormChange({ ...editForm, bb_period: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
              <div>
                <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>BB σ</span>
                <input type="number" step={0.5} value={editForm.bb_std} onChange={e => onEditFormChange({ ...editForm, bb_std: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
              </div>
            </div>
          )}

          {/* Common params */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Take Profit (%)</span>
              <input type="number" value={editForm.take_profit_pct} onChange={e => onEditFormChange({ ...editForm, take_profit_pct: Number(e.target.value) })} step={0.5} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Stop Loss (%)</span>
              <input type="number" value={editForm.stop_loss_pct} onChange={e => onEditFormChange({ ...editForm, stop_loss_pct: Number(e.target.value) })} step={0.5} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Max hold (h)</span>
              <input type="number" value={editForm.max_holding_hours} onChange={e => onEditFormChange({ ...editForm, max_holding_hours: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Fee (%)</span>
              <input type="number" value={editForm.fee_pct} onChange={e => onEditFormChange({ ...editForm, fee_pct: Number(e.target.value) })} step={0.01} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Dni</span>
              <input type="number" value={editForm.days} onChange={e => onEditFormChange({ ...editForm, days: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Capital ($)</span>
              <input type="number" value={editForm.initial_capital} onChange={e => onEditFormChange({ ...editForm, initial_capital: Number(e.target.value) })} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <button onClick={() => onEditFormChange({ ...editForm, compound: !editForm.compound })} className="flex items-center gap-1.5">
                <div className="w-6 h-3 rounded-full relative" style={{ background: editForm.compound ? te.green : te.borderLight }}>
                  <div className="size-2.5 rounded-full absolute top-0.5 transition-all" style={{ left: editForm.compound ? 12 : 2, background: editForm.compound ? '#fff' : te.textDim }} />
                </div>
                <span className="text-[9px]" style={{ color: te.textMuted, fontFamily: te.mono }}>Compound</span>
              </button>
            </div>
          </div>

          {/* Trailing Stop */}
          <div style={{ borderTop: `1px solid ${te.border}`, margin: '4px 0 0 0', paddingTop: 6 }}>
            <div className="flex items-center gap-2 mb-2">
              <Thermometer className="size-3" style={{ color: te.orange }} />
              <span className="text-[8px] font-bold uppercase" style={{ color: te.text, fontFamily: te.mono, letterSpacing: '0.06em' }}>Trailing Stop-Loss</span>
              <span className="text-[8px]" style={{ color: te.textMuted, fontFamily: te.mono }}>(0 = disabled)</span>
            </div>
            <div>
              <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Trailing SL (%)</span>
              <input type="number" value={editForm.trailing_stop_pct} onChange={e => onEditFormChange({ ...editForm, trailing_stop_pct: Number(e.target.value) })} step={0.5} min={0} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teInput(te)} />
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-2 pt-1">
            <button onClick={onSave} className="flex-1 px-3 py-1 text-[9px] font-bold rounded-sm transition-all" style={{ background: te.orange, color: '#000', border: 'none', fontFamily: te.mono, letterSpacing: '0.04em' }}>ZAPISZ</button>
            <button onClick={onCancel} className="px-2 py-1 text-[9px] font-bold rounded-sm" style={{ color: te.textDim, background: 'transparent', border: `1px solid ${te.border}`, fontFamily: te.mono, letterSpacing: '0.04em' }}>ANULUJ</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Display Mode ──
  const isActive = !!(demoActive || realActive)
  return (
    <div style={{ ...teCard(te, { background: isActive ? te.greenBg : te.bgCard, border: isActive ? `${te.green}80` : te.border }) }}>
      {/* Header */}
      <div className="px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {strategyTypeIcon(strategy.strategy_type || 'dip_buying')}
            <span className="text-[11px] font-bold" style={{ color: te.text, fontFamily: te.mono }}>{strategy.name}</span>
            {strategyTypeBadge(strategy.strategy_type || 'dip_buying')}
            <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ ...teBadge('transparent', te.textDim), border: `1px solid ${te.border}` }}>{coinLabel}</span>
            {demoActive && <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm inline-flex items-center gap-0.5" style={{ ...teBadge(te.blue, '#fff') }}><FlaskConical className="size-2.5" />DEMO</span>}
            {realActive && <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm inline-flex items-center gap-0.5" style={{ ...teBadge(te.red, '#fff') }}><DollarSign className="size-2.5" />REAL</span>}
          </div>
          <div className="flex gap-1 shrink-0">
            {demoActive ? (
              <button className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.blue, background: 'transparent', border: `1px solid ${te.blue}80`, fontFamily: te.mono }} onClick={() => onDeactivate(strategy.id, 'demo')} disabled={demoActivating}><CircleStop className="size-3" />STOP</button>
            ) : (
              <button className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.blue, background: 'transparent', border: `1px solid ${te.blue}50`, fontFamily: te.mono }} onClick={() => onActivate(strategy, 'demo')} disabled={demoActivating}>{demoActivating ? <RefreshCw className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}DEMO</button>
            )}
            {realActive ? (
              <button className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.red, background: 'transparent', border: `1px solid ${te.red}80`, fontFamily: te.mono }} onClick={() => onDeactivate(strategy.id, 'real')} disabled={realActivating}><CircleStop className="size-3" />STOP</button>
            ) : (
              <button className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.red, background: 'transparent', border: `1px solid ${te.red}50`, fontFamily: te.mono }} onClick={() => onActivate(strategy, 'real')} disabled={realActivating}>{realActivating ? <RefreshCw className="size-3 animate-spin" /> : <DollarSign className="size-3" />}REAL</button>
            )}
            <button onClick={onEdit} className="px-1.5 py-1 rounded-sm" style={{ color: te.textDim, background: 'transparent', border: 'none' }}><Pencil className="size-3" /></button>
            <button onClick={onDelete} className="px-1.5 py-1 rounded-sm" style={{ color: te.red, background: 'transparent', border: 'none' }}><Trash2 className="size-3" /></button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 pb-3 pt-2">
        {/* Active info panel */}
        {(demoActive || realActive) && (
          <div className="rounded-sm p-2 space-y-1" style={{ background: `${te.bgInput}55`, borderTop: `1px solid ${te.border}` }}>
            {demoActive && (
              <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: te.mono }}>
                <span className="flex items-center gap-1.5">
                  <FlaskConical className="size-3" style={{ color: te.blue }} />
                  <span className="font-bold" style={{ color: te.text }}>Demo</span>
                  {demoActive.inPosition && <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ ...teBadge(te.yellow, '#000') }}>POS</span>}
                  {demoActive.errorMessage && <span style={{ color: te.red, fontSize: '10px' }}>{demoActive.errorMessage}</span>}
                </span>
                <span style={{ color: te.textMuted }}>PnL: <span style={{ color: demoActive.totalPnl >= 0 ? te.green : te.red, fontWeight: 700 }}>${demoActive.totalPnl.toFixed(2)}</span> | Trades: {demoActive.totalTrades}{demoActive.lastPrice ? ` | $${demoActive.lastPrice.toFixed(2)}` : ''}</span>
              </div>
            )}
            {realActive && (
              <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: te.mono }}>
                <span className="flex items-center gap-1.5">
                  <DollarSign className="size-3" style={{ color: te.red }} />
                  <span className="font-bold" style={{ color: te.text }}>Real</span>
                  {realActive.inPosition && <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ ...teBadge(te.yellow, '#000') }}>POS</span>}
                  {realActive.errorMessage && <span style={{ color: te.red, fontSize: '10px' }}>{realActive.errorMessage}</span>}
                </span>
                <span style={{ color: te.textMuted }}>PnL: <span style={{ color: realActive.totalPnl >= 0 ? te.green : te.red, fontWeight: 700 }}>${realActive.totalPnl.toFixed(2)}</span> | Trades: {realActive.totalTrades}{realActive.lastPrice ? ` | $${realActive.lastPrice.toFixed(2)}` : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* Params Grid */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px]" style={{ fontFamily: te.mono }}>
          {(strategy.strategy_type === 'dip_buying' || !strategy.strategy_type) && (<>
            <div><span style={{ color: te.textMuted }}>Dip 24h:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.dip_threshold_24h}%</span></div>
            <div><span style={{ color: te.textMuted }}>Dip 1h:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.dip_threshold_1h}%</span></div>
          </>)}
          {strategy.strategy_type === 'momentum' && (<>
            <div><span style={{ color: te.textMuted }}>MA okres:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.ma_period}</span></div>
            <div><span style={{ color: te.textMuted }}>Wolumen:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.volume_threshold}x</span></div>
          </>)}
          {strategy.strategy_type === 'mean_reversion' && (<>
            <div><span style={{ color: te.textMuted }}>MA okres:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.ma_period}</span></div>
            <div><span style={{ color: te.textMuted }}>Odchylenie:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.deviation_threshold}σ</span></div>
          </>)}
          {strategy.strategy_type === 'breakout' && (<>
            <div><span style={{ color: te.textMuted }}>Lookback:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.lookback_periods}</span></div>
            <div><span style={{ color: te.textMuted }}>Potwierdzenie:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.breakout_confirm_bars} bar</span></div>
          </>)}
          {strategy.strategy_type === 'grid' && (<>
            <div><span style={{ color: te.textMuted }}>Spacing:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.grid_spacing_pct}%</span></div>
            <div><span style={{ color: te.textMuted }}>Levels:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.grid_levels}</span></div>
          </>)}
          {strategy.strategy_type === 'hurst_hcoo_lb' && (<>
            <div><span style={{ color: te.textMuted }}>Hurst ok:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.hurst_period}</span></div>
            <div><span style={{ color: te.textMuted }}>H prog:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.hurst_threshold}</span></div>
            <div><span style={{ color: te.textMuted }}>BB:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.bb_period}/{strategy.bb_std}σ</span></div>
          </>)}
          <div><span style={{ color: te.textMuted }}>TP:</span> <span className="font-bold" style={{ color: te.green }}>+{strategy.take_profit_pct}%</span></div>
          <div><span style={{ color: te.textMuted }}>SL:</span> <span className="font-bold" style={{ color: te.red }}>-{strategy.stop_loss_pct}%</span></div>
          <div><span style={{ color: te.textMuted }}>Hold:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.max_holding_hours}h</span></div>
          <div><span style={{ color: te.textMuted }}>Fee:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.fee_pct}%</span></div>
          <div><span style={{ color: te.textMuted }}>Capital:</span> <span className="font-bold" style={{ color: te.text }}>${strategy.initial_capital}</span></div>
          <div><span style={{ color: te.textMuted }}>Dni:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.days}</span></div>
          <div><span style={{ color: te.textMuted }}>Compound:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.compound ? 'Tak' : 'Nie'}</span></div>
          <div><span style={{ color: te.textMuted }}>Trailing SL:</span> <span className="font-bold" style={{ color: te.text }}>{strategy.trailing_stop_pct > 0 ? `${strategy.trailing_stop_pct}%` : 'Disabled'}</span></div>
          <div><span style={{ color: te.textMuted }}>Slippage:</span> <span className="font-bold" style={{ color: te.yellow }}>{(strategy.slippage_pct ?? 0.05).toFixed(2)}%</span></div>
          <div><span style={{ color: te.textMuted }}>Wick sim:</span> <span className="font-bold" style={{ color: strategy.simulate_wicks !== false ? te.green : te.red }}>{strategy.simulate_wicks !== false ? 'TAK' : 'NIE'}</span></div>
        </div>

        {/* Loading */}
        {result?.loading && (
          <div className="flex items-center gap-2 text-[10px] pt-2" style={{ color: te.textMuted, borderTop: `1px solid ${te.border}`, fontFamily: te.mono }}>
            <RefreshCw className="size-3 animate-spin" /><span>Obliczanie backtestu...</span>
          </div>
        )}

        {/* Error */}
        {result?.error && (
          <div className="flex items-center justify-between gap-2 text-[10px] pt-2" style={{ color: te.red, borderTop: `1px solid ${te.border}`, fontFamily: te.mono }}>
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="size-3 shrink-0" />
              <span>{result.error}</span>
              {result.retryCount && result.retryCount > 0 && <span style={{ color: te.textMuted }}>({result.retryCount}x retry)</span>}
            </div>
            <button className="px-2 py-0.5 text-[9px] font-bold rounded-sm shrink-0 inline-flex items-center gap-1" style={{ color: te.blue, background: 'transparent', border: `1px solid ${te.blue}44`, fontFamily: te.mono }} onClick={() => onRetry(strategy.id)}><RefreshCw className="size-3" /> RETRY</button>
          </div>
        )}

        {/* Results Grid */}
        {result?.data && (
          <div className="grid grid-cols-2 gap-2 pt-2" style={{ borderTop: `1px solid ${te.border}` }}>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>RETURN</span>
              <span className="text-[14px] font-bold" style={{ color: result.data.results.total_return_pct >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{result.data.results.total_return_pct >= 0 ? '+' : ''}{result.data.results.total_return_pct.toFixed(2)}%</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>WIN RATE</span>
              <span className="text-[14px] font-bold" style={{ color: result.data.results.win_rate >= 50 ? te.green : te.yellow, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{result.data.results.win_rate.toFixed(1)}%</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>MAX DD</span>
              <span className="text-[14px] font-bold" style={{ color: te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>-{result.data.results.max_drawdown_pct.toFixed(2)}%</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>INFO RATIO</span>
              <span className="text-[14px] font-bold" style={{ color: result.data.results.info_ratio >= 1 ? te.green : te.yellow, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{result.data.results.info_ratio.toFixed(2)}</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>TRADES</span>
              <span className="text-[14px] font-bold" style={{ color: te.text, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{result.data.results.total_trades}</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
              <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>CAPITAL KOŃCOWY</span>
              <span className="text-[14px] font-bold" style={{ color: result.data.results.final_capital > (result.data.parameters?.initial_capital as number ?? 0) ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>${result.data.results.final_capital.toFixed(0)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── StrategiessssTab Main Component ─────────────────────────────────────────────

export default function StrategiessssTab({ activeStrategiessss, onStrategyChange }: StrategiessssTabProps) {
  const te = useTE()
  const [strategies, setStrategiessss] = useState<StrategyConfig[]>(DEFAULT_STRATEGIES)
  const [results, setResults] = useState<Map<string, StrategyResult>>(new Map())
  const [running, setRunning] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [editForm, setEditForm] = useState<StrategyConfig | null>(null)
  const [activatingStrategy, setActivatingStrategy] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)

  const [optimizeCoin, setOptimizeCoin] = useState('solana')
  const [optimizeDays, setOptimizeDays] = useState(90)
  const [optimizeStrategyType, setOptimizeStrategyType] = useState('dip_buying')
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResponse | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('trading-strategies')
      if (saved) {
        const parsed = JSON.parse(saved) as StrategyConfig[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          const migrated = parsed.map(s => ({
            ...s, strategy_type: s.strategy_type || 'dip_buying',
            ma_period: s.ma_period ?? 20, volume_threshold: s.volume_threshold ?? 1.5,
            deviation_threshold: s.deviation_threshold ?? 2, lookback_periods: s.lookback_periods ?? 20,
            breakout_confirm_bars: s.breakout_confirm_bars ?? 2, grid_spacing_pct: s.grid_spacing_pct ?? 2,
            grid_levels: s.grid_levels ?? 5, hurst_period: s.hurst_period ?? 100,
            hurst_threshold: s.hurst_threshold ?? 0.5, bb_period: s.bb_period ?? 20, bb_std: s.bb_std ?? 2,
            slippage_pct: s.slippage_pct ?? 0.05, simulate_wicks: s.simulate_wicks ?? true,
          }))
          setStrategiessss(migrated)
        }
      }
    } catch {}
  }, [])

  useEffect(() => { try { localStorage.setItem('trading-strategies', JSON.stringify(strategies)) } catch {} }, [strategies])

  const runSingleBacktest = async (strategy: StrategyConfig, retryCount = 0): Promise<StrategyResult> => {
    const maxRetries = 2
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin_id: strategy.coin_id, days: strategy.days, strategy_type: strategy.strategy_type || 'dip_buying',
          dip_threshold_1h: strategy.dip_threshold_1h, dip_threshold_24h: strategy.dip_threshold_24h,
          take_profit_pct: strategy.take_profit_pct, stop_loss_pct: strategy.stop_loss_pct,
          initial_capital: strategy.initial_capital, compound: strategy.compound,
          max_holding_hours: strategy.max_holding_hours, fee_pct: strategy.fee_pct,
          ma_period: strategy.ma_period, volume_threshold: strategy.volume_threshold,
          deviation_threshold: strategy.deviation_threshold, lookback_periods: strategy.lookback_periods,
          breakout_confirm_bars: strategy.breakout_confirm_bars, grid_spacing_pct: strategy.grid_spacing_pct,
          grid_levels: strategy.grid_levels, hurst_period: strategy.hurst_period,
          hurst_threshold: strategy.hurst_threshold, bb_period: strategy.bb_period, bb_std: strategy.bb_std,
          slippage_pct: strategy.slippage_pct ?? 0.05, simulate_wicks: strategy.simulate_wicks ?? true,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const errMsg = errData.error || errData.details || `Error HTTP ${res.status}`
        if ((res.status === 429 || res.status === 502) && retryCount < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, retryCount)))
          return runSingleBacktest(strategy, retryCount + 1)
        }
        return { strategyId: strategy.id, loading: false, error: errMsg, data: null, retryCount }
      }
      const data = await res.json()
      return { strategyId: strategy.id, loading: false, error: null, data, retryCount }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Server connection error'
      if (retryCount < maxRetries) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, retryCount))); return runSingleBacktest(strategy, retryCount + 1) }
      return { strategyId: strategy.id, loading: false, error: errMsg, data: null, retryCount }
    }
  }

  const runAll = async () => {
    setRunning(true)
    const newResults = new Map<string, StrategyResult>()
    for (const s of strategies) newResults.set(s.id, { strategyId: s.id, loading: true, error: null, data: null })
    setResults(new Map(newResults))
    for (const strategy of strategies) {
      const result = await runSingleBacktest(strategy)
      newResults.set(strategy.id, result)
      setResults(new Map(newResults))
      if (strategies.indexOf(strategy) < strategies.length - 1) await new Promise(r => setTimeout(r, 1500))
    }
    setRunning(false)
  }

  const retryStrategy = async (strategyId: string) => {
    const strategy = strategies.find(s => s.id === strategyId)
    if (!strategy) return
    setResults(prev => { const newMap = new Map(prev); newMap.set(strategyId, { strategyId, loading: true, error: null, data: null }); return newMap })
    const result = await runSingleBacktest(strategy)
    setResults(prev => { const newMap = new Map(prev); newMap.set(strategyId, result); return newMap })
  }

  const addStrategy = () => {
    const id = `strategy-${Date.now()}`
    const defaultType = 'dip_buying'
    const newStrategy: StrategyConfig = {
      id, name: 'Nowa strategia', strategy_type: defaultType, coin_id: 'bitcoin',
      dip_threshold_1h: 0, dip_threshold_24h: -3, take_profit_pct: 5, stop_loss_pct: 2,
      max_holding_hours: 48, fee_pct: 0.2, initial_capital: 1000, days: 90, compound: true, trailing_stop_pct: 0,
      ma_period: 20, volume_threshold: 1.5, deviation_threshold: 2,
      lookback_periods: 20, breakout_confirm_bars: 2, grid_spacing_pct: 2, grid_levels: 5,
      hurst_period: 100, hurst_threshold: 0.5, bb_period: 20, bb_std: 2, slippage_pct: 0.05, simulate_wicks: true,
      leverage: 3, futures_alloc_pct: 50, ema_fast: 9, ema_slow: 21, rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30,
      futures_sl_pct: 2, futures_tp_pct: 4, max_futures_hours: 24, funding_rate_pct: 0.01,
    }
    setStrategiessss([...strategies, newStrategy]); setEditingId(id); setEditForm(newStrategy)
  }

  const deleteStrategy = (id: string) => {
    setStrategiessss(strategies.filter(s => s.id !== id))
    const newResults = new Map(results); newResults.delete(id); setResults(newResults)
    if (editingId === id) { setEditingId(null); setEditForm(null) }
  }

  const saveStrategy = () => {
    if (!editForm) return
    setStrategiessss(strategies.map(s => s.id === editForm.id ? editForm : s))
    setEditingId(null); setEditForm(null)
  }

  const runOptimize = async () => {
    setOptimizing(true); setOptimizeError(null); setOptimizeResult(null)
    try {
      const res = await fetch('/api/backtest/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin_id: optimizeCoin, days: optimizeDays, initial_capital: 1000, compound: true, fee_pct: 0.1, strategy_type: optimizeStrategyType }),
      })
      if (!res.ok) { const errData = await res.json().catch(() => ({})); setOptimizeError(errData.error || 'Optimization error') }
      else { setOptimizeResult(await res.json()) }
    } catch (err) { setOptimizeError(err instanceof Error ? err.message : 'Optimization error') }
    finally { setOptimizing(false) }
  }

  const addBestStrategy = () => {
    if (!optimizeResult?.best) return
    const best = optimizeResult.best
    const coinLabel = COIN_OPTIONS.find(c => c.id === best.params.coin_id)?.label || best.params.coin_id
    const id = `optimized-${Date.now()}`
    const newStrategy: StrategyConfig = {
      id, name: `${coinLabel} Optimized`, strategy_type: best.params.strategy_type || 'dip_buying',
      coin_id: best.params.coin_id, dip_threshold_1h: best.params.dip_threshold_1h ?? 0,
      dip_threshold_24h: best.params.dip_threshold_24h ?? -3, take_profit_pct: best.params.take_profit_pct ?? 5,
      stop_loss_pct: best.params.stop_loss_pct ?? 2, max_holding_hours: best.params.max_holding_hours ?? 48,
      fee_pct: best.params.fee_pct, initial_capital: best.params.initial_capital, days: best.params.days,
      compound: best.params.compound, trailing_stop_pct: 0,
      ma_period: best.params.ma_period ?? 20, volume_threshold: best.params.volume_threshold ?? 1.5,
      deviation_threshold: best.params.deviation_threshold ?? 2, lookback_periods: best.params.lookback_periods ?? 20,
      breakout_confirm_bars: best.params.breakout_confirm_bars ?? 2, grid_spacing_pct: best.params.grid_spacing_pct ?? 2,
      grid_levels: best.params.grid_levels ?? 5, hurst_period: best.params.hurst_period ?? 100,
      hurst_threshold: best.params.hurst_threshold ?? 0.5, bb_period: best.params.bb_period ?? 20,
      bb_std: best.params.bb_std ?? 2, slippage_pct: 0.05, simulate_wicks: true,
    }
    setStrategiessss([...strategies, newStrategy])
  }

  const addOptimizedStrategy = (item: OptimizeResultItem, rank: number) => {
    const coinLabel = COIN_OPTIONS.find(c => c.id === item.params.coin_id)?.label || item.params.coin_id
    const id = `optimized-${Date.now()}-${rank}`
    const newStrategy: StrategyConfig = {
      id, name: `${coinLabel} Top${rank}`, strategy_type: item.params.strategy_type || 'dip_buying',
      coin_id: item.params.coin_id, dip_threshold_1h: item.params.dip_threshold_1h ?? 0,
      dip_threshold_24h: item.params.dip_threshold_24h ?? -3, take_profit_pct: item.params.take_profit_pct ?? 5,
      stop_loss_pct: item.params.stop_loss_pct ?? 2, max_holding_hours: item.params.max_holding_hours ?? 48,
      fee_pct: item.params.fee_pct, initial_capital: item.params.initial_capital, days: item.params.days,
      compound: item.params.compound, trailing_stop_pct: 0,
      ma_period: item.params.ma_period ?? 20, volume_threshold: item.params.volume_threshold ?? 1.5,
      deviation_threshold: item.params.deviation_threshold ?? 2, lookback_periods: item.params.lookback_periods ?? 20,
      breakout_confirm_bars: item.params.breakout_confirm_bars ?? 2, grid_spacing_pct: item.params.grid_spacing_pct ?? 2,
      grid_levels: item.params.grid_levels ?? 5, hurst_period: item.params.hurst_period ?? 100,
      hurst_threshold: item.params.hurst_threshold ?? 0.5, bb_period: item.params.bb_period ?? 20,
      bb_std: item.params.bb_std ?? 2, slippage_pct: 0.05, simulate_wicks: true,
    }
    setStrategiessss([...strategies, newStrategy])
  }

  const bestStrategy = strategies.reduce((best, s) => {
    const r = results.get(s.id)
    if (!r?.data) return best
    if (!best || r.data.results.total_return_pct > best.returnPct) return { id: s.id, name: s.name, returnPct: r.data.results.total_return_pct }
    return best
  }, null as { id: string; name: string; returnPct: number } | null)

  const activateStrategy = async (strategy: StrategyConfig, mode: 'demo' | 'real') => {
    setActivatingStrategy(`${strategy.id}:${mode}`); setActivationError(null)
    try {
      const res = await fetch('/api/strategies/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: strategy.id, name: strategy.name, coinId: strategy.coin_id, mode,
          strategyType: strategy.strategy_type || 'dip_buying',
          strategyParams: getStrategyParamsFromConfig(strategy),
          dipThreshold1h: strategy.dip_threshold_1h, dipThreshold24h: strategy.dip_threshold_24h,
          takeProfitPct: strategy.take_profit_pct, stopLossPct: strategy.stop_loss_pct,
          maxHoldingHours: strategy.max_holding_hours, feePct: strategy.fee_pct,
          initialCapital: strategy.initial_capital, compound: strategy.compound,
        }),
      })
      const data = await res.json()
      if (!res.ok) setActivationError(data.error || 'Failed to activate strategy')
      else onStrategyChange()
    } catch (err) { setActivationError(err instanceof Error ? err.message : 'Server connection error') }
    finally { setActivatingStrategy(null) }
  }

  const deactivateStrategyHandler = async (strategyId: string, mode: 'demo' | 'real') => {
    setActivatingStrategy(`${strategyId}:${mode}`); setActivationError(null)
    try {
      const res = await fetch('/api/strategies/deactivate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId, mode }),
      })
      const data = await res.json()
      if (!res.ok) setActivationError(data.error || 'Failed to deactivate')
      else onStrategyChange()
    } catch (err) { setActivationError(err instanceof Error ? err.message : 'Connection error') }
    finally { setActivatingStrategy(null) }
  }

  const runningStrategiessss = activeStrategiessss.filter(s => s.status === 'running')
  const stoppedStrategiessss = activeStrategiessss.filter(s => s.status !== 'running')

  return (
    <div className="space-y-4">
      {/* Activation Error */}
      {activationError && (
        <div className="flex items-center justify-between gap-3 rounded-sm px-3 py-2" style={{ background: te.redBg, border: `1px solid ${te.red}44` }}>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: te.red, fontFamily: te.mono }}><AlertTriangle className="size-3.5 shrink-0" /><span>{activationError}</span></div>
          <button className="px-2 py-0.5 text-[9px] font-bold rounded-sm" style={{ color: te.red, background: 'transparent', border: `1px solid ${te.red}44`, fontFamily: te.mono }} onClick={() => setActivationError(null)}>ZAMKNIJ</button>
        </div>
      )}

      {/* Auto-Optimization Section */}
      <div style={{ ...teCard(te, { background: te.purpleBg, border: `${te.purple}30` }) }}>
        {/* Collapsible Header */}
        <div className="px-3 py-2" style={{ borderBottom: optimizeOpen ? `1px solid ${te.border}` : 'none' }}>
          <button className="flex items-center justify-between w-full" onClick={() => setOptimizeOpen(!optimizeOpen)}>
            <div className="flex items-center gap-2">
              <Flame className="size-3.5" style={{ color: te.purple }} />
              <span className="text-[10px] font-bold" style={{ color: te.text, fontFamily: te.mono, letterSpacing: '0.08em' }}>AUTO-OPTYMALIZACJA</span>
            </div>
            <span className="text-[9px]" style={{ color: te.textDim, fontFamily: te.mono }}>{optimizeOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {optimizeOpen && (
          <div className="space-y-3 px-3 pb-3 pt-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                <div>
                  <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Coin</span>
                  <select value={optimizeCoin} onChange={e => setOptimizeCoin(e.target.value)} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teSelect(te)}>
                    {COIN_OPTIONS.map(c => (<option key={c.id} value={c.id}>{c.label}</option>))}
                  </select>
                </div>
                <div>
                  <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Strategia</span>
                  <select value={optimizeStrategyType} onChange={e => setOptimizeStrategyType(e.target.value)} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teSelect(te)}>
                    {STRATEGY_TYPE_OPTIONS.map(t => (<option key={t.id} value={t.id}>{t.label}</option>))}
                  </select>
                </div>
                <div>
                  <span className="text-[7px] font-bold uppercase" style={{ ...teLabel(te) }}>Period (days)</span>
                  <select value={String(optimizeDays)} onChange={e => setOptimizeDays(Number(e.target.value))} className="w-full px-2 py-1 text-[10px] rounded-sm outline-none mt-0.5" style={teSelect(te)}>
                    <option value="30">30 dni</option>
                    <option value="90">90 dni</option>
                    <option value="180">180 dni</option>
                    <option value="365">365 dni</option>
                  </select>
                </div>
                <div>
                  <button className="w-full px-3 py-1 text-[9px] font-bold rounded-sm transition-all inline-flex items-center justify-center gap-1" style={{ background: te.purple, color: '#fff', border: 'none', fontFamily: te.mono, letterSpacing: '0.04em', marginTop: 14 }} onClick={runOptimize} disabled={optimizing}>
                    {optimizing ? (<><RefreshCw className="size-3 animate-spin" /> Szukam...</>) : (<><Flame className="size-3" /> Wykryj najlepszą</>)}
                  </button>
                </div>
              </div>
            </div>

            {optimizeError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-sm" style={{ background: te.redBg, border: `1px solid ${te.red}44` }}>
                <span className="text-[10px]" style={{ color: te.red, fontFamily: te.mono }}>{optimizeError}</span>
              </div>
            )}

            {optimizing && (
              <div className="flex items-center gap-3 text-[10px] rounded-sm px-3 py-2" style={{ color: te.textMuted, background: `${te.bgInput}55`, fontFamily: te.mono }}>
                <RefreshCw className="size-3 animate-spin" />
                <span>Testing parameter combinations ({strategyTypeLabel(optimizeStrategyType)})... May take 10-30s</span>
              </div>
            )}

            {optimizeResult && !optimizing && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[10px]" style={{ color: te.textMuted, fontFamily: te.mono }}>
                  <span>Tested <strong style={{ color: te.text }}>{optimizeResult.total_combinations}</strong> combinations</span>
                  <span style={{ color: te.border }}>|</span>
                  <span>Valid strategies: <strong style={{ color: te.text }}>{optimizeResult.valid_strategies}</strong></span>
                </div>

                {optimizeResult.best && (
                  <div className="rounded-sm p-3" style={{ background: te.greenBg, border: `1px solid ${te.green}30` }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Trophy className="size-3.5" style={{ color: te.green }} />
                        <span className="text-[10px] font-bold" style={{ color: te.green, fontFamily: te.mono }}>NAJLEPSZA ({strategyTypeLabel(optimizeResult.strategy_type)}) · {COIN_OPTIONS.find(c => c.id === optimizeResult.coin_id)?.label || optimizeResult.coin_id}</span>
                      </div>
                      <button className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.green, background: 'transparent', border: `1px solid ${te.green}50`, fontFamily: te.mono }} onClick={addBestStrategy}><Plus className="size-3" /> DODAJ</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
                        <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>RETURN</span>
                        <span className="text-[12px] font-bold" style={{ color: optimizeResult.best.total_return_pct >= 0 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{optimizeResult.best.total_return_pct >= 0 ? '+' : ''}{optimizeResult.best.total_return_pct.toFixed(2)}%</span>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
                        <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>WIN RATE</span>
                        <span className="text-[12px] font-bold" style={{ color: optimizeResult.best.win_rate >= 50 ? te.green : te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{optimizeResult.best.win_rate.toFixed(1)}%</span>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
                        <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>PROFIT FACTOR</span>
                        <span className="text-[12px] font-bold" style={{ color: optimizeResult.best.profit_factor >= 1.5 ? te.green : te.yellow, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>{optimizeResult.best.profit_factor >= 999 ? '999+' : optimizeResult.best.profit_factor.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-sm" style={teMetricBox(te)}>
                        <span className="text-[7px] font-bold" style={{ color: te.textDim, letterSpacing: '0.08em' }}>MAX DD</span>
                        <span className="text-[12px] font-bold" style={{ color: te.red, fontFamily: te.mono, fontVariantNumeric: 'tabular-nums' }}>-{optimizeResult.best.max_drawdown_pct.toFixed(2)}%</span>
                      </div>
                    </div>
                  </div>
                )}

                {optimizeResult.top_20.length > 1 && (
                  <div className="rounded-sm overflow-hidden" style={{ ...teCard(te) }}>
                    <div className="px-3 py-2" style={{ borderBottom: `1px solid ${te.border}` }}>
                      <span className="text-[8px] font-bold uppercase" style={{ color: te.text, fontFamily: te.mono, letterSpacing: '0.1em' }}>TOP 20 STRATEGII</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]" style={{ fontFamily: te.mono }}>
                        <thead><tr style={{ borderBottom: `1px solid ${te.border}` }}>
                          <th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>#</th>
                          {optimizeResult.strategy_type === 'dip_buying' && (<><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>DIP 1H</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>DIP 24H</th></>)}
                          {optimizeResult.strategy_type === 'momentum' && (<><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>MA</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>VOL</th></>)}
                          {optimizeResult.strategy_type === 'mean_reversion' && (<th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>DEV</th>)}
                          {optimizeResult.strategy_type === 'breakout' && (<><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>LOOK</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>CONF</th></>)}
                          {optimizeResult.strategy_type === 'grid' && (<><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>SPACE%</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>LVL</th></>)}
                          {optimizeResult.strategy_type === 'hurst_hcoo_lb' && (<><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>H-P</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>H-T</th><th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>BB</th></>)}
                          <th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>TP</th>
                          <th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>SL</th>
                          {optimizeResult.strategy_type !== 'grid' && (<th className="px-2 py-1.5 text-left font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>HOLD</th>)}
                          <th className="px-2 py-1.5 text-right font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>RETURN</th>
                          <th className="px-2 py-1.5 text-right font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>WR</th>
                          <th className="px-2 py-1.5 text-right font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>PF</th>
                          <th className="px-2 py-1.5 text-right font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>DD</th>
                          <th className="px-2 py-1.5 text-right font-bold text-[8px]" style={{ color: te.textDim, letterSpacing: '0.06em' }}>SCORE</th>
                          <th className="px-2 py-1.5"></th>
                        </tr></thead>
                        <tbody>
                          {optimizeResult.top_20.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: `1px solid ${te.border}`, background: idx === 0 ? te.greenBg : 'transparent' }}>
                              <td className="px-2 py-1.5 font-bold" style={{ color: te.text }}>{idx + 1}</td>
                              {optimizeResult.strategy_type === 'dip_buying' && (<><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.dip_threshold_1h}%</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.dip_threshold_24h}%</td></>)}
                              {optimizeResult.strategy_type === 'momentum' && (<><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.ma_period}</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.volume_threshold}x</td></>)}
                              {optimizeResult.strategy_type === 'mean_reversion' && (<td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.deviation_threshold}σ</td>)}
                              {optimizeResult.strategy_type === 'breakout' && (<><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.lookback_periods}</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.breakout_confirm_bars}</td></>)}
                              {optimizeResult.strategy_type === 'grid' && (<><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.grid_spacing_pct}%</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.grid_levels}</td></>)}
                              {optimizeResult.strategy_type === 'hurst_hcoo_lb' && (<><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.hurst_period}</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.hurst_threshold}</td><td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.bb_period}/{item.params.bb_std}σ</td></>)}
                              <td className="px-2 py-1.5" style={{ color: te.green }}>+{item.params.take_profit_pct}%</td>
                              <td className="px-2 py-1.5" style={{ color: te.red }}>-{item.params.stop_loss_pct}%</td>
                              {optimizeResult.strategy_type !== 'grid' && (<td className="px-2 py-1.5" style={{ color: te.text }}>{item.params.max_holding_hours}h</td>)}
                              <td className="px-2 py-1.5 text-right font-bold" style={{ color: item.total_return_pct >= 0 ? te.green : te.red }}>{item.total_return_pct >= 0 ? '+' : ''}{item.total_return_pct.toFixed(1)}%</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: item.win_rate >= 50 ? te.green : te.red }}>{item.win_rate.toFixed(0)}%</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: item.profit_factor >= 1.5 ? te.green : te.yellow }}>{item.profit_factor >= 999 ? '999+' : item.profit_factor.toFixed(1)}</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: te.red }}>-{item.max_drawdown_pct.toFixed(1)}%</td>
                              <td className="px-2 py-1.5 text-right font-bold" style={{ color: te.text }}>{item.score.toFixed(1)}</td>
                              <td className="px-2 py-1.5 text-right">
                                <button className="px-1 py-0.5 rounded-sm" style={{ color: te.orange, background: 'transparent', border: 'none' }} onClick={() => addOptimizedStrategy(item, idx + 1)} title="Dodaj do listy"><Plus className="size-3" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section Title + Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-[8px] font-bold" style={{ color: te.textDim, letterSpacing: '0.14em', fontFamily: te.mono }}>TWOJE STRATEGIE TRADINGOWE</span>
          <p className="text-[10px] mt-0.5" style={{ color: te.textMuted, fontFamily: te.mono }}>Porównaj różne konfiguracje — każdy typ strategii of własnymi parametrami</p>
        </div>
        <div className="flex gap-2">
          <button onClick={addStrategy} disabled={running} className="px-2 py-1 text-[9px] font-bold rounded-sm inline-flex items-center gap-1" style={{ color: te.textDim, background: 'transparent', border: `1px solid ${te.border}`, fontFamily: te.mono, letterSpacing: '0.04em' }}><Plus className="size-3" /> DODAJ</button>
          <button onClick={runAll} disabled={running || strategies.length === 0} className="px-3 py-1 text-[9px] font-bold rounded-sm transition-all inline-flex items-center gap-1" style={{ background: te.orange, color: '#000', border: 'none', fontFamily: te.mono, letterSpacing: '0.04em' }}>
            {running ? (<><RefreshCw className="size-3 animate-spin" /> Obliczam...</>) : (<><Play className="size-3" /> Testuj wszystkie</>)}
          </button>
        </div>
      </div>

      {/* Best Strategy Banner */}
      {bestStrategy && (
        <div className="flex items-center gap-2 text-[10px] rounded-sm px-3 py-2" style={{ background: te.greenBg, border: `1px solid ${te.green}20`, color: te.green, fontFamily: te.mono }}>
          <Trophy className="size-3.5" /><span>Najlepsza: <strong>{bestStrategy.name}</strong> ({bestStrategy.returnPct >= 0 ? '+' : ''}{bestStrategy.returnPct.toFixed(2)}%)</span>
        </div>
      )}

      {/* Running Strategiessss */}
      {runningStrategiessss.length > 0 && (
        <div>
          <span className="text-[8px] font-bold uppercase inline-flex items-center gap-1.5 mb-2" style={{ color: te.textDim, fontFamily: te.mono, letterSpacing: '0.1em' }}><Play className="size-3" /> AKTYWNE STRATEGIE ({runningStrategiessss.length})</span>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {runningStrategiessss.map(s => (
              <div key={`${s.strategyId}:${s.mode}`} className="shrink-0 min-w-[200px] rounded-sm p-3" style={{ background: te.greenBg, border: `1px solid ${te.green}30` }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="size-5 rounded-sm flex items-center justify-center" style={{ background: s.mode === 'demo' ? te.blue : te.red }}>{s.mode === 'demo' ? <FlaskConical className="size-2.5 text-white" /> : <DollarSign className="size-2.5 text-white" />}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold truncate" style={{ color: te.text, fontFamily: te.mono }}>{s.name}</span>
                      {s.inPosition && <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ ...teBadge(te.yellow, '#000') }}>POS</span>}
                    </div>
                    <div className="text-[8px]" style={{ color: te.textMuted, fontFamily: te.mono }}>{s.symbol} · {s.mode.toUpperCase()}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: te.mono }}>
                  <span className="font-bold" style={{ color: s.totalPnl >= 0 ? te.green : te.red }}>${s.totalPnl.toFixed(2)}</span>
                  <span style={{ color: te.textMuted }}>{s.totalTrades}t · {s.totalTrades > 0 ? ((s.winningTrades / s.totalTrades) * 100).toFixed(0) : 0}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stopped Strategiessss */}
      {stoppedStrategiessss.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {stoppedStrategiessss.map(s => (
            <div key={`${s.strategyId}:${s.mode}`} className="flex items-center gap-2 text-[9px] rounded-sm px-2 py-1 shrink-0" style={{ background: `${te.bgInput}55`, color: te.textMuted, fontFamily: te.mono }}>
              <span className="font-bold" style={{ color: te.text }}>{s.name}</span>
              <span>PnL: <span style={{ color: s.totalPnl >= 0 ? te.green : te.red }}>${s.totalPnl.toFixed(2)}</span></span>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {strategies.map(strategy => (
          <StrategyCard key={strategy.id} strategy={strategy} result={results.get(strategy.id) || null}
            onEdit={() => { setEditingId(strategy.id); setEditForm({ ...strategy }) }}
            onDelete={() => deleteStrategy(strategy.id)} isEditing={editingId === strategy.id} editForm={editForm}
            onEditFormChange={setEditForm} onSave={saveStrategy} onCancel={() => { setEditingId(null); setEditForm(null) }}
            activeInfo={activeStrategiessss} activatingKey={activatingStrategy}
            onActivate={activateStrategy} onDeactivate={deactivateStrategyHandler} onRetry={retryStrategy}
          />
        ))}
        {/* Add Strategy Button */}
        <button onClick={addStrategy} className="rounded-sm p-6 flex flex-col items-center justify-center gap-2 transition-all min-h-[200px]" style={{ border: `1px dashed ${te.border}`, color: te.textMuted, background: 'transparent' }} onMouseEnter={e => { e.currentTarget.style.borderColor = te.orange; e.currentTarget.style.color = te.orange }} onMouseLeave={e => { e.currentTarget.style.borderColor = te.border; e.currentTarget.style.color = te.textMuted }}>
          <Plus className="size-6" /><span className="text-[10px] font-bold" style={{ fontFamily: te.mono, letterSpacing: '0.06em' }}>DODAJ STRATEGIĘ</span>
        </button>
      </div>
    </div>
  )
}
