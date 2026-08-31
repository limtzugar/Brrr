'use client'

import React from 'react'
import { useTE } from '@/lib/te-theme'
import { formatPnl, formatPrice } from '@/lib/cex-anomaly-helpers'
import { TAG_COLORS, SCORING, DANGER } from '@/lib/cex-anomaly-constants'
import { MiniSparkline } from '@/components/cex-anomaly/cex-anomaly-mini-sparkline'
import type { ActivePosition } from '@/lib/cex-anomaly-types'

export interface ActivePositionCardProps {
  pos: ActivePosition
  posNum: number // 1-9 for keyboard shortcut
  pairDecimals: number // from ALL_PAIRS.find
  effectiveTP: number // take profit % from mode config
  dataMono: React.CSSProperties
  bybitTrading?: boolean // true = real Bybit trading active (show BYBIT ✓ / EST badges)
  onManualClose: (posId: string) => void
}

/** Format timestamp to HH:MM:SS.mmm */
function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

export const ActivePositionCard = React.memo(function ActivePositionCard({
  pos,
  posNum,
  pairDecimals,
  effectiveTP,
  dataMono,
  bybitTrading,
  onManualClose,
}: ActivePositionCardProps) {
  const te = useTE()
  const dec = Math.max(pairDecimals, 5)

  const isProfit = pos.pnl >= 0
  const pnlColor = isProfit ? te.green : te.red
  const isLong = pos.side === 'LONG'
  const distToCluster = isLong
    ? ((pos.currentPrice - pos.nearestLiqCluster) / pos.entryPrice) * 100
    : ((pos.nearestLiqCluster - pos.currentPrice) / pos.entryPrice) * 100
  const dangerLevel =
    distToCluster < DANGER.CRITICAL_THRESHOLD
      ? 'CRITICAL'
      : distToCluster < DANGER.WARNING_THRESHOLD
        ? 'WARNING'
        : 'SAFE'
  const dangerColor =
    dangerLevel === 'CRITICAL' ? te.red : dangerLevel === 'WARNING' ? te.orange : te.green

  // Execution timing
  const signalMs =
    pos.signalDetectedAt
      ? pos.orderSentAt && pos.orderSentAt - pos.signalDetectedAt
      : null
  const execMs =
    pos.orderSentAt && pos.orderConfirmedAt
      ? pos.orderConfirmedAt - pos.orderSentAt
      : null
  const totalMs =
    pos.signalDetectedAt && pos.orderConfirmedAt
      ? pos.orderConfirmedAt - pos.signalDetectedAt
      : null
  const ageMs = Date.now() - pos.openedAt

  // Price calculations
  const tpPct = effectiveTP / 100
  const tpPrice = isLong
    ? pos.entryPrice * (1 + tpPct)
    : pos.entryPrice * (1 - tpPct)
  const slPrice = pos.shieldStopLoss

  // Price range bar
  const markers = [pos.nearestLiqCluster, pos.entryPrice, pos.currentPrice, tpPrice]
  if (pos.trailingActive) markers.push(pos.trailingStop)
  const rangeMin = Math.min(...markers)
  const rangeMax = Math.max(...markers)
  const range = rangeMax - rangeMin || 1
  const toPct = (p: number) => ((p - rangeMin) / range) * 100
  const liqPct = toPct(pos.nearestLiqCluster)
  const entryPct = toPct(pos.entryPrice)
  const currPct = toPct(pos.currentPrice)
  const tpPctPos = toPct(tpPrice)
  const trailPct = pos.trailingActive ? toPct(pos.trailingStop) : -1
  const profitLeft = Math.min(entryPct, tpPctPos)
  const profitWidth = Math.abs(tpPctPos - entryPct)
  const dangerLeft = Math.min(liqPct, entryPct)
  const dangerWidth = Math.abs(entryPct - liqPct)

  // Side colors
  const sideColor = isLong ? te.green : te.red
  const sideBg = isLong ? `${te.green}08` : `${te.red}08`

  return (
    <div style={{
      borderBottom: `1px solid ${te.border}`,
      borderLeft: `3px solid ${sideColor}`,
      background: sideBg,
    }}>
      {/* Main flex row: info + PnL panel */}
      <div className="flex">
        {/* Left side: position info */}
        <div className="flex-1 min-w-0 px-2 py-1.5">

          {/* Row 1: main info badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-sm"
              style={{
                fontFamily: te.mono,
                background: `${sideColor}22`,
                color: sideColor,
                border: `1px solid ${sideColor}44`,
                boxShadow: `0 0 6px ${sideColor}22`,
              }}
            >
              {isLong ? '▲ LONG' : '▼ SHORT'} {pos.leverage}x
            </span>
            <span className="text-[11px] font-bold" style={{ ...dataMono, color: te.text }}>
              {pos.pair.replace('-USDT', '')}
            </span>
            <span className="text-[10px]" style={{ fontFamily: te.mono, color: te.textDim }}>
              ${pos.marginUsd.toFixed(1)}
              <span style={{ color: te.textDim, fontSize: '8px' }}>/{pos.sizeUsd.toFixed(0)}</span>
            </span>
            <span
              className="text-[9px] font-bold px-0.5 rounded-sm"
              style={{
                fontFamily: te.mono,
                background: TAG_COLORS[pos.anomaly.tag].bg,
                color: TAG_COLORS[pos.anomaly.tag].text,
              }}
            >
              {pos.anomaly.tag}{pos.contrarian ? ' (Rev)' : ''}
            </span>
            <span
              className="text-[9px] font-bold"
              style={{ fontFamily: te.mono, color: dangerColor }}
              title={`SHIELD ${dangerLevel} | LIQ: ${formatPrice(pos.nearestLiqCluster, dec)} | Stop: ${formatPrice(pos.shieldStopLoss, dec)} | Dist: ${distToCluster.toFixed(2)}%`}
            >
              🛡{dangerLevel === 'CRITICAL' ? '!!' : dangerLevel === 'WARNING' ? '!' : ''}
            </span>
            {pos.trailingActive && (
              <span
                className="text-[8px] font-bold px-0.5 rounded-sm"
                style={{
                  fontFamily: te.mono,
                  color: te.orange,
                  background: `${te.orange}1a`,
                }}
              >
                TRAIL
              </span>
            )}
            {pos.partialTpTaken && (
              <span
                className="text-[7px] font-bold px-0.5 rounded-sm"
                style={{
                  fontFamily: te.mono,
                  color: te.purple,
                  background: `${te.purple}1a`,
                }}
              >
                ½TP
              </span>
            )}
            {bybitTrading && (
              pos.bybitVerified && pos.bybitVerifiedAt && (Date.now() - pos.bybitVerifiedAt) < 60_000 ? (
                <span
                  className="text-[7px] font-bold px-0.5 rounded-sm"
                  style={{
                    fontFamily: te.mono,
                    color: '#f7a600',
                    background: '#f7a60015',
                    border: '1px solid #f7a60033',
                  }}
                  title={`PnL verified by Bybit at ${new Date(pos.bybitVerifiedAt).toLocaleTimeString()} | Bybit unrealisedPnl: $${(pos.bybitRealisedPnl ?? 0).toFixed(3)}`}
                >
                  BYBIT ✓
                </span>
              ) : (
                <span
                  className="text-[7px] font-bold px-0.5 rounded-sm"
                  style={{
                    fontFamily: te.mono,
                    color: te.textDim,
                    background: `${te.textDim}0a`,
                    border: `1px solid ${te.textDim}22`,
                  }}
                  title="PnL is estimated from local price data (not yet verified by Bybit)"
                >
                  EST
                </span>
              )
            )}
            <span className="ml-auto">
              <MiniSparkline data={pos.priceHistory} isProfit={isProfit} />
            </span>
          </div>

          {/* Row 1b: Key prices — E / TP / SL (prominent, large) */}
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.text }}>
              ${formatPrice(pos.entryPrice, dec)}<span className="text-[9px] ml-0.5" style={{ color: te.textDim }}>E</span>
            </span>
            <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.green }}>
              ${formatPrice(tpPrice, dec)}<span className="text-[9px] ml-0.5" style={{ color: `${te.green}88` }}>TP</span>
            </span>
            <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.red }}>
              ${formatPrice(slPrice, dec)}<span className="text-[9px] ml-0.5" style={{ color: `${te.red}88` }}>SL</span>
            </span>
            <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: pos.bybitVerified ? te.cyan : te.textDim }}>
              ${formatPrice(pos.currentPrice, dec)}<span className="text-[9px] ml-0.5" style={{ color: pos.bybitVerified ? `${te.cyan}88` : `${te.textDim}88` }}>AC</span>
            </span>
            {pos.trailingActive && (
              <span className="text-[12px] font-bold" style={{ fontFamily: te.mono, color: te.orange }}>
                ${formatPrice(pos.trailingStop, dec)}<span className="text-[9px] ml-0.5" style={{ color: `${te.orange}88` }}>TR</span>
              </span>
            )}
          </div>

          {/* Row 1c: Net PnL — compact */}
          <div className="flex items-center gap-1.5 mt-0.5" style={{ paddingLeft: 2 }}>
            <span className="text-[9px] font-bold" style={{ fontFamily: te.mono, color: pnlColor }}>
              NET ${pos.pnl.toFixed(3)}
            </span>
            <span
              className="text-[9px] font-bold"
              title={`GROSS $${(pos.bybitVerified && pos.bybitGrossPnl !== undefined ? pos.bybitGrossPnl : pos.pnl + (pos.totalFees || 0)).toFixed(3)} | FEE $${(pos.totalFees || (pos.sizeUsd * 0.00055 * 2)).toFixed(3)}${pos.bybitVerified ? ' | Bybit verified' : ''}`}
              style={{ fontFamily: te.mono, color: pos.bybitVerified ? '#f7a600' : te.textDim }}
            >
              {pos.bybitVerified ? '●' : ''}
            </span>
          </div>

          {/* Row 2: confidence score — compact, details in tooltip */}
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className="text-[9px] font-bold"
              title={pos.confidence ? `TRG+${pos.confidence.triggerQuality ?? 0} VWP${(pos.confidence.vwapAlign ?? 0) > 0 ? '+' : ''}${pos.confidence.vwapAlign ?? 0} SMA${(pos.confidence.smaAlign ?? 0) > 0 ? '+' : ''}${pos.confidence.smaAlign ?? 0} MOM${(pos.confidence.momAlign ?? 0) > 0 ? '+' : ''}${pos.confidence.momAlign ?? 0} MACD${(pos.confidence.macdAlign ?? 0) > 0 ? '+' : ''}${pos.confidence.macdAlign ?? 0} RSI${(pos.confidence.rsiAlign ?? 0) > 0 ? '+' : ''}${pos.confidence.rsiAlign ?? 0} VOL${(pos.confidence.volumeConfirm ?? 0) > 0 ? '✓' : '✗'} +C${(pos.confidence.layerC ?? 0) > 0 ? pos.confidence.layerC : 0}` : ''}
              style={{
                fontFamily: te.mono,
                color:
                  pos.confidence && (pos.confidence.layerB ?? pos.confidence.total) >= SCORING.MIN_SCORE
                    ? te.green
                    : te.red,
                letterSpacing: '0.04em',
              }}
            >
              ●{(pos.confidence?.layerB ?? pos.confidence?.total ?? 0)}/{SCORING.MIN_SCORE}
            </span>
          </div>

          {/* Row 2b: age + pending status */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {pos.orderConfirmedAt === null && pos.orderSentAt !== null && (
              <span
                className="text-[10px] font-bold px-1 rounded-sm"
                style={{
                  fontFamily: te.mono,
                  color: te.orange,
                  background: `${te.orange}11`,
                }}
              >
                PENDING...
              </span>
            )}
            {pos.orderConfirmedAt !== null && (
              <span
                className="text-[9px]"
                style={{ fontFamily: te.mono, color: te.textDim }}
                title={`Opened ${fmtTime(pos.orderConfirmedAt)}${signalMs !== null ? ` | SIG→EX ${signalMs}ms` : ''}${execMs !== null ? ` | API ${execMs}ms` : ''}${totalMs !== null ? ` | Total ${totalMs}ms` : ''}`}
              >
                @{fmtTime(pos.orderConfirmedAt)}
              </span>
            )}
            <span className="text-[10px] ml-auto" style={{ fontFamily: te.mono, color: te.textDim }}>
              AGE{' '}
              {ageMs < 60000 ? `${(ageMs / 1000).toFixed(0)}s` : `${(ageMs / 60000).toFixed(1)}m`}
            </span>
          </div>

          {/* Row 3: price range bar — LIQ · entry · current · trailing · TP */}
          <div className="mt-1 px-1">
            <div className="relative h-1.5 rounded-full" style={{ background: te.bgInput }}>
              <div
                className="absolute top-0 h-full rounded-full"
                style={{
                  left: `${dangerLeft}%`,
                  width: `${dangerWidth}%`,
                  background: `linear-gradient(to right, ${te.red}44, ${te.red}11)`,
                }}
              />
              <div
                className="absolute top-0 h-full rounded-full"
                style={{
                  left: `${profitLeft}%`,
                  width: `${profitWidth}%`,
                  background: `linear-gradient(to right, ${te.green}11, ${te.green}44)`,
                }}
              />
              <div
                className="absolute top-0 h-full"
                style={{ left: `${liqPct}%`, transform: 'translateX(-50%)' }}
              >
                <div style={{ width: 2, height: '100%', background: te.red, borderRadius: 1 }} />
              </div>
              <div
                className="absolute top-0 h-full"
                style={{ left: `${entryPct}%`, transform: 'translateX(-50%)' }}
              >
                <div style={{ width: 1, height: '100%', background: te.textDim }} />
              </div>
              {pos.trailingActive && (
                <div
                  className="absolute top-0 h-full"
                  style={{ left: `${trailPct}%`, transform: 'translateX(-50%)' }}
                >
                  <div style={{ width: 2, height: '100%', background: te.orange, borderRadius: 1 }} />
                </div>
              )}
              <div
                className="absolute"
                style={{
                  left: `${currPct}%`,
                  transform: 'translateX(-50%)',
                  top: -2,
                  width: 6,
                  height: 6,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isProfit ? te.green : te.red,
                    boxShadow: `0 0 4px ${isProfit ? te.green : te.red}88`,
                  }}
                />
              </div>
              <div
                className="absolute top-0 h-full"
                style={{ left: `${tpPctPos}%`, transform: 'translateX(-50%)' }}
              >
                <div style={{ width: 2, height: '100%', background: te.green, borderRadius: 1 }} />
              </div>
            </div>
          </div>

          {/* Close row */}
          <div className="flex items-center gap-1.5 mt-1">
            <button
              onClick={() => onManualClose(pos.id)}
              className="text-[11px] font-bold px-2 py-1 rounded-sm transition-all cursor-pointer flex-shrink-0"
              style={{
                fontFamily: te.mono,
                color: te.bg,
                background: te.orange,
                border: `1px solid ${te.orange}`,
                letterSpacing: '0.08em',
                minWidth: 28,
                textAlign: 'center' as const,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)' }}
              title={`Close position #${posNum}`}
            >
              {posNum}
            </button>
            <button
              onClick={() => onManualClose(pos.id)}
              className="flex-1 text-[10px] font-bold py-1 rounded-sm transition-all cursor-pointer"
              style={{
                fontFamily: te.mono,
                letterSpacing: '0.1em',
                color: te.bg,
                background: isProfit ? te.green : te.red,
                border: `1px solid ${isProfit ? te.green : te.red}`,
                opacity: 0.9,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.filter = 'brightness(1.2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.filter = 'brightness(1)' }}
            >
              CLOSE {isProfit ? 'PROFIT' : 'LOSS'}
            </button>
          </div>
        </div>

        {/* Right side: Unrealized PnL (Bybit-style) — larger, no overlap */}
        <div
          className="flex flex-col items-center justify-center shrink-0 self-stretch"
          style={{
            width: 120,
            minWidth: 120,
            background: `${pnlColor}0c`,
            borderLeft: `1px solid ${pnlColor}33`,
            padding: '8px 4px',
          }}
        >
          <span className="text-[9px] font-bold tracking-wider mb-1" style={{ fontFamily: te.mono, color: `${pnlColor}aa` }}>
            UNRL P/L
          </span>
          <span
            className="text-[22px] font-bold leading-none"
            style={{ fontFamily: te.mono, color: pnlColor }}
          >
            {formatPnl(pos.pnl)}
          </span>
          <span
            className="text-[13px] font-bold leading-none mt-1"
            style={{ fontFamily: te.mono, color: pnlColor }}
          >
            {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  )
})
