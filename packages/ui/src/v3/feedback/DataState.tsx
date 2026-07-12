import type { ReactNode } from 'react';

export interface DataStateProps {
  state: 'loading' | 'empty' | 'error' | 'permission' | 'offline' | 'stale';
  title?: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

const DEFAULTS: Record<DataStateProps['state'], { title: string; description: string; symbol: string }> = {
  loading: { title: 'Loading', description: 'Preparing the latest information…', symbol: '◌' },
  empty: { title: 'Nothing here yet', description: 'New information will appear here when it is available.', symbol: '○' },
  error: { title: 'We could not load this', description: 'Please try again. Your existing work is safe.', symbol: '!' },
  permission: { title: 'Access unavailable', description: 'Your account does not have permission to view this information.', symbol: '×' },
  offline: { title: 'You are offline', description: 'Reconnect to load the latest information.', symbol: '↯' },
  stale: { title: 'Showing earlier information', description: 'We will refresh this view when a connection is available.', symbol: '↻' },
};

export function DataState({ state, title, description, action, compact = false }: DataStateProps) {
  const copy = DEFAULTS[state];
  if (state === 'loading') {
    return (
      <div className={`v3-data-state v3-data-state--loading ${compact ? 'v3-data-state--compact' : ''}`} role="status" aria-live="polite">
        <span className="v3-spinner" aria-hidden="true" />
        <span>{title || copy.title}</span>
        <span className="v3-sr-only">{description || copy.description}</span>
      </div>
    );
  }
  return (
    <div className={`v3-data-state v3-data-state--${state} ${compact ? 'v3-data-state--compact' : ''}`} role={state === 'error' ? 'alert' : 'status'}>
      <span className="v3-data-state__symbol" aria-hidden="true">{copy.symbol}</span>
      <div>
        <h3>{title || copy.title}</h3>
        <p>{description || copy.description}</p>
      </div>
      {action ? <div className="v3-data-state__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3, label = 'Loading content' }: { lines?: number; label?: string }) {
  return (
    <div className="v3-skeleton" role="status" aria-label={label}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} style={{ width: `${100 - (index % 3) * 14}%` }} />)}
    </div>
  );
}
