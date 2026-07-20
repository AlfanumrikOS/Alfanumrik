'use client';

import { StalenessTag } from '@alfanumrik/ui/admin-ui';
import type { ObsData } from './control-room-types';

interface SystemStatusBarProps {
  obsData: ObsData;
  lastUpdated: Date | null;
}

// Phase 3 (2026-07-20): hardcoded light-palette hexes replaced with the CSS
// custom-property tokens used by token-correct pages (foxy-quality et al.) so
// the bar follows the cosmic/dark theme.
export default function SystemStatusBar({ obsData, lastUpdated }: SystemStatusBarProps) {
  const healthy = obsData.health.status === 'healthy';
  const stateColor = healthy ? 'var(--success)' : 'var(--danger)';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0,
      border: `1px solid color-mix(in srgb, ${stateColor} 40%, transparent)`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{
        padding: '12px 16px',
        background: `color-mix(in srgb, ${stateColor} 8%, transparent)`,
        display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--surface-3)',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: stateColor }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
          {healthy ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED'}
        </span>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />
      </div>
      <div style={{ padding: '10px 16px', background: 'var(--surface-2)', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Active now', value: obsData.users.active_24h, warn: false },
          { label: '7d active', value: obsData.users.active_7d, warn: false },
          { label: 'Failed jobs', value: obsData.jobs.failed, warn: obsData.jobs.failed > 0 },
          { label: 'Pending', value: obsData.jobs.pending, warn: obsData.jobs.pending > 5 },
          { label: 'Flags', value: `${obsData.feature_flags.enabled}/${obsData.feature_flags.total}`, warn: false },
          { label: 'Cache', value: obsData.cache.size, warn: false },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.label}:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: item.warn ? 'var(--danger)' : 'var(--text-1)' }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
