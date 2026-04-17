'use client';

import { colors } from '../admin-styles';
import { StalenessTag } from '../StalenessTag';
import type { ObsData } from './control-room-types';

interface SystemStatusBarProps {
  obsData: ObsData;
  lastUpdated: Date | null;
}

export default function SystemStatusBar({ obsData, lastUpdated }: SystemStatusBarProps) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0,
      border: `1px solid ${obsData.health.status === 'healthy' ? '#BBF7D0' : '#FECACA'}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{
        padding: '12px 16px',
        background: obsData.health.status === 'healthy' ? colors.successLight : colors.dangerLight,
        display: 'flex', alignItems: 'center', gap: 8, borderRight: `1px solid ${colors.border}`,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: obsData.health.status === 'healthy' ? colors.success : colors.danger }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>
          {obsData.health.status === 'healthy' ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED'}
        </span>
        <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />
      </div>
      <div style={{ padding: '10px 16px', background: colors.surface, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Active now', value: obsData.users.active_24h, warn: false },
          { label: '7d active', value: obsData.users.active_7d, warn: false },
          { label: 'Failed jobs', value: obsData.jobs.failed, warn: obsData.jobs.failed > 0 },
          { label: 'Pending', value: obsData.jobs.pending, warn: obsData.jobs.pending > 5 },
          { label: 'Flags', value: `${obsData.feature_flags.enabled}/${obsData.feature_flags.total}`, warn: false },
          { label: 'Cache', value: obsData.cache.size, warn: false },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: colors.text3 }}>{item.label}:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: item.warn ? colors.danger : colors.text1 }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
