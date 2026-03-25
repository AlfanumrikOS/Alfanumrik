'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Short name for the section, shown in fallback UI */
  section?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Lightweight error boundary for individual page sections.
 * Unlike the global ErrorBoundary, this doesn't reload the page —
 * it isolates a crash to one section so the rest of the page still works.
 *
 * Usage: <SectionErrorBoundary section="Quiz Results">...</SectionErrorBoundary>
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[SectionError:${this.props.section || 'unknown'}]`, error, info.componentStack?.slice(0, 300));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: 'var(--surface-2, #f5f0ea)',
            border: '1px solid var(--border, #e5e0d8)',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            {this.props.section ? `${this.props.section} couldn't load.` : 'This section couldn\'t load.'}
            {' '}
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{
                background: 'none', border: 'none', color: 'var(--orange, #E8581C)',
                fontWeight: 600, cursor: 'pointer', fontSize: 13,
              }}
            >
              Try again
            </button>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
