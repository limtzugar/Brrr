'use client'

// ─── Next.js Global Error Boundary ──────────────────────────────────────────
// This is the LAST resort error handler for the entire application.
// Next.js uses this when an unhandled client-side error occurs that
// no React ErrorBoundary catches. Without this file, Next.js shows
// its default "Application error: a client-side exception has occurred" page.
//
// IMPORTANT: This component must be its own file and CANNOT use the
// layout.tsx wrapper (it replaces the entire root layout on error).

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Log the error for debugging
  console.error('[GlobalError] Unhandled client error:', error?.message, error?.stack)

  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a' }} className="dark">
        <div style={{
          minHeight: '100vh',
          background: '#0a0a0a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          padding: 32,
          fontFamily: 'monospace',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#FF6600', letterSpacing: '0.1em' }}>
            BRRR
          </span>
          <div style={{
            background: '#111',
            border: '1px solid #222',
            borderRadius: 4,
            padding: 16,
            maxWidth: 500,
            textAlign: 'left',
          }}>
            <div style={{ color: '#ef4444', marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
              Client Error
            </div>
            <div style={{ color: '#888', fontSize: 11, wordBreak: 'break-word' as const }}>
              {error?.message || 'Unknown client-side error'}
            </div>
            {error?.stack && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ color: '#555', fontSize: 10, cursor: 'pointer' }}>
                  Stack trace
                </summary>
                <pre style={{
                  color: '#555',
                  fontSize: 9,
                  whiteSpace: 'pre-wrap' as const,
                  maxHeight: 150,
                  overflow: 'auto',
                  marginTop: 4,
                }}>
                  {error.stack.substring(0, 800)}
                </pre>
              </details>
            )}
            {error?.digest && (
              <div style={{ color: '#555', fontSize: 9, marginTop: 8 }}>
                Digest: {error.digest}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#FF6600',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '8px 24px',
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#222',
                color: '#e0e0e0',
                border: '1px solid #333',
                borderRadius: 4,
                padding: '8px 24px',
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
