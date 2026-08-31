'use client'

// ─── Next.js Route-Level Error Boundary ──────────────────────────────────────
// Catches errors within the app route that aren't caught by React ErrorBoundary.
// This is the second line of defense after global-error.tsx.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error('[RouteError] Unhandled error:', error?.message, error?.stack)

  return (
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
          Route Error
        </div>
        <div style={{ color: '#888', fontSize: 11, wordBreak: 'break-word' as const }}>
          {error?.message || 'An error occurred while loading this page'}
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
  )
}
