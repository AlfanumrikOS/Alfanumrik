'use client';

import { Component, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

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
    // Report to Sentry with component stack context
    Sentry.captureException(error, {
      tags: { boundary: 'component-error' },
      contexts: {
        react: { componentStack: errorInfo.componentStack?.slice(0, 500) },
      },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isHi = typeof window !== 'undefined' && (
        localStorage.getItem('alfanumrik_lang') === 'hi' ||
        navigator.language?.startsWith('hi')
      );

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', padding: '40px 20px', textAlign: 'center',
          fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
        }}>
          <span style={{ fontSize: 48, marginBottom: 16 }}>&#x1F98A;</span>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 8px' }}>
            {isHi ? 'कुछ गलत हो गया' : 'Oops! Something went wrong'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 20px', maxWidth: 400 }}>
            {isHi
              ? 'Foxy को एक समस्या हुई। कृपया पेज रिफ्रेश करें।'
              : 'Foxy ran into a problem. Please try refreshing the page.'}
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
            {isHi ? 'पेज रिफ्रेश करो' : 'Refresh Page'}
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
