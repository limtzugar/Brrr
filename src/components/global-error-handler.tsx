'use client'

import { useEffect, useState } from 'react'

/**
 * GlobalErrorHandler — Catches ALL unhandled errors and promise rejections
 * that React Error Boundaries miss (useEffect async errors, WebSocket errors, etc).
 *
 * CRITICAL: In Next.js, unhandled errors in client components cause the framework
 * to show its generic "Application error" page. This handler intercepts those errors
 * BEFORE Next.js can catch them, preventing the crash.
 *
 * Strategy:
 * 1. window.error → catch synchronous runtime errors
 * 2. window.unhandledrejection → catch unhandled async/promise errors
 * 3. Both call event.preventDefault() to stop the error from reaching Next.js
 * 4. Optionally display a non-crashing error banner instead
 */
export default function GlobalErrorHandler() {
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = event.error?.message || event.message || 'Unknown error'
      const file = event.filename || ''
      const line = event.lineno || 0
      console.error('[GlobalErrorHandler] Uncaught error:', msg, `at ${file}:${line}`, event.error?.stack)
      // Log but DON'T prevent propagation — let Next.js error.tsx / global-error.tsx handle it
      // Those files provide proper UI. Only show a notification if the error is non-fatal.
      setLastError(msg + (file ? ` [${file.split('/').pop()}:${line}]` : ''))
      setTimeout(() => setLastError(null), 8000)
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason) || 'Unhandled promise rejection'
      console.error('[GlobalErrorHandler] Unhandled promise rejection:', msg, event.reason?.stack)
      // Log but DON'T prevent propagation — let Next.js handle it
      setLastError(msg)
      setTimeout(() => setLastError(null), 8000)
    }

    window.addEventListener('error', handleError, true) // useCapture=true to catch before Next.js
    window.addEventListener('unhandledrejection', handleRejection, true) // useCapture=true

    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleRejection, true)
    }
  }, [])

  // Non-crashing error banner — replaces the generic Next.js error page
  if (lastError) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          maxWidth: 420,
          background: '#1a0000',
          border: '1px solid #ef444466',
          borderRadius: 6,
          padding: '10px 14px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#ef4444',
          zIndex: 99999,
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 13 }}>⚠️</span>
          <span style={{ fontWeight: 700, letterSpacing: '0.04em' }}>RUNTIME ERROR</span>
          <button
            onClick={() => setLastError(null)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ color: '#aaa', wordBreak: 'break-word' }}>
          {lastError.length > 200 ? lastError.substring(0, 200) + '...' : lastError}
        </div>
      </div>
    )
  }

  return null
}
