'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', padding: '40px 20px', textAlign: 'center',
          fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
        }}>
          <span style={{ fontSize: 48, marginBottom: 16 }}>🦊</span>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 8px' }}>
            Oops! Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 20px', maxWidth: 400 }}>
            Foxy ran into a problem. Please try refreshing the page.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '10px 24px', backgroundColor: 'var(--orange, #E8581C)', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Refresh Page
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre style={{
              marginTop: 20, padding: 16, backgroundColor: 'var(--surface-2, #f5f0ea)',
              borderRadius: 8, fontSize: 12, textAlign: 'left', maxWidth: '100%',
              overflow: 'auto', color: '#DC2626',
            }}>
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
