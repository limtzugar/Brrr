'use client'
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** Optional label for identifying which boundary caught the error */
  label?: string
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    // Log the full error to console so we can see it in browser devtools
    console.error('[ErrorBoundary] Caught error:', error?.message, error?.stack)
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log component stack trace for debugging
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
    console.error('[ErrorBoundary] Label:', this.props.label || 'unnamed')
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 text-center" style={{ background: '#0a0a0a', minHeight: 120 }}>
          <p style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>
            ERROR{this.props.label ? ` [${this.props.label}]` : ''}
          </p>
          <p style={{ color: '#888', fontFamily: 'monospace', fontSize: 11, marginTop: 4 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          {this.state.error?.stack && (
            <details style={{ marginTop: 8, textAlign: 'left' }}>
              <summary style={{ color: '#555', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer' }}>
                Stack trace
              </summary>
              <pre style={{ color: '#555', fontFamily: 'monospace', fontSize: 9, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                {this.state.error.stack.substring(0, 600)}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 12,
              background: '#FF6600',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 16px',
              fontSize: 11,
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
