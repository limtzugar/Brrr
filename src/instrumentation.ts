// ─── Next.js Instrumentation — Startup Hooks ──────────────────────
// Runs once on server start. Used to initialize background schedulers.

import { BRRR_BASE_URL } from '@/lib/server-config'

let schedulersRegistered = false
export async function register() {
  // Only run on the primary server instance (not edge, not build)
  // Idempotency: Next.js may call register() multiple times in dev (HMR) — dedupe via global flag
  if (schedulersRegistered) return
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    schedulersRegistered = true
    ;(globalThis as unknown as { __brrrSchedulersRegistered?: boolean }).__brrrSchedulersRegistered = true
    console.log('[INSTRUMENTATION] Registering background schedulers...')

    // ── Recovery Point Scheduler — every 8 hours ──
    const RECOVERY_INTERVAL_MS = 8 * 60 * 60 * 1000  // 8h
    // SECURITY: no hardcoded fallback — schedulers stay off unless CRON_SECRET is set
    const CRON_SECRET = process.env.CRON_SECRET
    const BASE_URL = BRRR_BASE_URL
    if (!CRON_SECRET) {
      console.warn('[INSTRUMENTATION] CRON_SECRET not set — background cron schedulers DISABLED (set it in .env to enable)')
      return
    }

    // Initial run after 60s (let the server fully start)
    setTimeout(() => {
      triggerRecoveryPoint(BASE_URL, CRON_SECRET)
    }, 60_000)

    // Recurring every 8h
    setInterval(() => {
      triggerRecoveryPoint(BASE_URL, CRON_SECRET)
    }, RECOVERY_INTERVAL_MS)

    console.log(`[INSTRUMENTATION] Recovery scheduler: every ${RECOVERY_INTERVAL_MS / 3600000}h`)

    // ── Bybit Closed PnL Sync — every 2 minutes ──
    // Syncs realized PnL from Bybit's /v5/position/closed-pnl API
    // to ensure UI shows the correct Bybit-verified PnL instead of
    // locally computed values which can drift (fees, slippage, funding).
    const CLOSED_PNL_SYNC_INTERVAL_MS = 2 * 60 * 1000  // 2 minutes

    // Initial sync after 30s (faster than recovery — needed for PnL accuracy)
    setTimeout(() => {
      triggerClosedPnlSync(BASE_URL, CRON_SECRET)
    }, 30_000)

    // Recurring every 2 min
    setInterval(() => {
      triggerClosedPnlSync(BASE_URL, CRON_SECRET)
    }, CLOSED_PNL_SYNC_INTERVAL_MS)

    console.log(`[INSTRUMENTATION] Closed PnL sync scheduler: every ${CLOSED_PNL_SYNC_INTERVAL_MS / 60000}min`)

    // ── Trading runtime recovery ──
    // Both the strategy poller and the LLM learning queue are in-memory workers,
    // so reconstruct them from durable state after every server restart.
    setTimeout(() => {
      triggerTradingRuntime(BASE_URL, CRON_SECRET)
    }, 5_000)

    // ── CEX CROWD engine (headless paper scalper) — every 30s ──
    // Data-proven CROWD20 profile: CROWD-only, SHORT bias, 20x, TMO 60s.
    const CROWD_TICK_MS = parseInt(process.env.CROWD_TICK_MS || '30000', 10)
    setInterval(() => {
      triggerCrowdEngine(BASE_URL, CRON_SECRET)
    }, CROWD_TICK_MS)
    // First tick shortly after boot
    setTimeout(() => {
      triggerCrowdEngine(BASE_URL, CRON_SECRET)
    }, 15_000)
    console.log(`[INSTRUMENTATION] CEX CROWD engine scheduler: every ${CROWD_TICK_MS / 1000}s`)

    // ── SPOT MACD+RSI engine ("Górki i Dołki") — every 20 min ──
    const SPOT_TICK_MS = parseInt(process.env.SPOT_TICK_MS || '1200000', 10)
    setInterval(() => triggerSpotEngine(BASE_URL, CRON_SECRET), SPOT_TICK_MS)
    setTimeout(() => triggerSpotEngine(BASE_URL, CRON_SECRET), 20_000)
    console.log(`[INSTRUMENTATION] SPOT MACD+RSI engine scheduler: every ${SPOT_TICK_MS / 60000}min`)
  }
}

async function triggerSpotEngine(baseUrl: string, secret: string) {
  try {
    const res = await fetch(`${baseUrl}/api/cron/spot-macd-rsi`, { method: 'POST', headers: { 'x-cron-secret': secret } })
    const data = await res.json()
    if (!res.ok || data.ok === false) { console.error('[SPOT-ENGINE] tick failed:', data.error || `HTTP ${res.status}`); return }
    if (data.actions?.length) {
      console.log(`[SPOT-ENGINE] ${data.actions.join(' | ')} | equity=$${data.state.equity} pnl=$${data.state.realizedPnl} W/L=${data.state.wins}/${data.state.losses}`)
    }
  } catch (err: any) {
    console.error(`[SPOT-ENGINE] tick error: ${err.message}`)
  }
}

async function triggerCrowdEngine(baseUrl: string, secret: string) {
  try {
    const res = await fetch(`${baseUrl}/api/cron/cex-crowd-engine`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    })
    const data = await res.json()
    if (!res.ok || data.ok === false) {
      console.error('[CROWD-ENGINE] tick failed:', data.error || `HTTP ${res.status}`)
      return
    }
    if (data.opened?.length || data.closed?.length) {
      console.log(
        `[CROWD-ENGINE] opened=${data.opened.length} closed=${data.closed.length} ` +
        `equity=$${data.state.equity} pnl=$${data.state.realizedPnl} W/L=${data.state.wins}/${data.state.losses}`,
      )
    }
  } catch (err: any) {
    console.error(`[CROWD-ENGINE] tick error: ${err.message}`)
  }
}

async function triggerTradingRuntime(
  baseUrl: string,
  secret: string,
  attempt = 1,
) {
  try {
    const url = `${baseUrl}/api/cron/trading-runtime`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    console.log('[INSTRUMENTATION] Trading strategies and learning jobs resumed')
  } catch (err: any) {
    console.error(`[INSTRUMENTATION] Trading runtime recovery failed: ${err.message}`)
    if (attempt < 5) {
      setTimeout(() => {
        triggerTradingRuntime(baseUrl, secret, attempt + 1)
      }, 10_000)
    }
  }
}

async function triggerRecoveryPoint(baseUrl: string, secret: string) {
  try {
    const url = `${baseUrl}/api/cron/recovery-point`
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
    })
    const data = await res.json()
    if (data.success) {
      console.log(`[RECOVERY] Point created: ${data.filename} | remaining: ${data.remaining}`)
    } else {
      console.error(`[RECOVERY] Failed:`, data.error)
    }
  } catch (err: any) {
    console.error(`[RECOVERY] Error: ${err.message}`)
  }
}

async function triggerClosedPnlSync(baseUrl: string, secret: string) {
  try {
    const url = `${baseUrl}/api/cron/sync-closed-pnl?mode=real`
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
    })
    const data = await res.json()
    if (data.success) {
      console.log(`[CLOSED-PNL-SYNC] Bybit realized PnL: $${data.totalRealizedPnl?.toFixed(2) ?? '0'} | trades: ${data.tradeCount} | wins: ${data.wins} | losses: ${data.losses}`)
    } else {
      console.error(`[CLOSED-PNL-SYNC] Failed:`, data.error)
    }
  } catch (err: any) {
    console.error(`[CLOSED-PNL-SYNC] Error: ${err.message}`)
  }
}
