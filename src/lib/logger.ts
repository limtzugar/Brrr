// ─── Logger Utility ──────────────────────────────────────────────────────────
// Lightweight toggle-able logger for Brrr bot.
// - log() and warn() respect the ON/OFF flag (cached in-memory, persisted in DB)
// - error() ALWAYS logs — never suppress errors, they're critical for debugging
// - The flag is cached in memory for zero-overhead checks (no DB hit per log call)
// - Call initLogger() on server startup or first use to load the flag from DB

import { db } from './db'

// ─── In-memory cache (no DB hit per log call) ──────────────────────────────

let _logsEnabled: boolean = true   // Default: ON
let _initialized: boolean = false

/** Load the logs_enabled flag from DB (called once on server start) */
export async function initLogger(): Promise<void> {
  if (_initialized) return
  try {
    const setting = await db.appSettings.findUnique({ where: { key: 'logs_enabled' } })
    if (setting) {
      _logsEnabled = setting.value === 'true'
    }
    _initialized = true
  } catch {
    // DB might not be migrated yet — keep default
    _initialized = true
  }
}

/** Get current logs state (synchronous, uses cache) */
export function isLogsEnabled(): boolean {
  return _logsEnabled
}

/** Set logs ON or OFF (updates cache + persists to DB) */
export async function setLogsEnabled(enabled: boolean): Promise<void> {
  _logsEnabled = enabled
  try {
    await db.appSettings.upsert({
      where: { key: 'logs_enabled' },
      update: { value: String(enabled) },
      create: { key: 'logs_enabled', value: String(enabled) },
    })
  } catch {
    // DB might not be migrated yet — at least update in-memory
  }
}

// ─── Logging functions ─────────────────────────────────────────────────────

/** Info log — respects ON/OFF toggle */
export function log(...args: unknown[]): void {
  if (!_logsEnabled) return
  console.log(...args)
}

/** Warning log — respects ON/OFF toggle */
export function warn(...args: unknown[]): void {
  if (!_logsEnabled) return
  console.warn(...args)
}

/** Error log — ALWAYS logs, never suppressed (critical for debugging) */
export function error(...args: unknown[]): void {
  console.error(...args)
}

/** Debug log — only when logs are ON (alias for log with [DEBUG] prefix) */
export function debug(...args: unknown[]): void {
  if (!_logsEnabled) return
  console.log('[DEBUG]', ...args)
}
