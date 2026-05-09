'use client';

import { StalenessTag } from '@/components/admin-ui';
import type { ObsData } from './control-room-types';

interface SystemStatusBarProps {
  obsData: ObsData;
  lastUpdated: Date | null;
}

export default function SystemStatusBar({ obsData, lastUpdated }: SystemStatusBarProps) {
  const healthy = obsData.health.status === 'healthy';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0,
      border: `1px solid ${healthy ? '#BBF7D0' : '#FECACA'}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{
        padding: '12px 16px',
        background: healthy ? '#F0FDF4' : '#FEF2F2',
        display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid #E5E7EB',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: healthy ? '#16A34A' : '#DC2626' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
          {healthy ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED'}
        </span>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />
      </div>
      <div style={{ padding: '10px 16px', background: '#F9FAFB', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Active now', value: obsData.users.active_24h, warn: false },
          { label: '7d active', value: obsData.users.active_7d, warn: false },
          { label: 'Failed jobs', value: obsData.jobs.failed, warn: obsData.jobs.failed > 0 },
          { label: 'Pending', value: obsData.jobs.pending, warn: obsData.jobs.pending > 5 },
          { label: 'Flags', value: `${obsData.feature_flags.enabled}/${obsData.feature_flags.total}`, warn: false },
          { label: 'Cache', value: obsData.cache.size, warn: false },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>{item.label}:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: item.warn ? '#DC2626' : '#111827' }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
