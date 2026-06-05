'use client';

import type { ObsData, AnalyticsData, FeatureFlag } from './control-room-types';

interface PendingActionsProps {
  obsData: ObsData | null;
  analytics: AnalyticsData | null;
  flags: FeatureFlag[];
}

export default function PendingActions({ obsData, analytics, flags }: PendingActionsProps) {
  const pendingItems: { icon: string; text: string; href: string; isAlert: boolean }[] = [];
  if (obsData && obsData.jobs.failed > 0) {
    pendingItems.push({ icon: '⚠️', text: `${obsData.jobs.failed} failed job${obsData.jobs.failed > 1 ? 's' : ''} need review`, href: '/super-admin/diagnostics', isAlert: true });
  }
  if (analytics) {
    pendingItems.push({ icon: '📝', text: 'Content items may need review', href: '/super-admin/cms', isAlert: false });
  }
  if (flags.length > 0 || obsData) {
    const enabled = obsData ? obsData.feature_flags.enabled : flags.filter(f => f.enabled).length;
    const total = obsData ? obsData.feature_flags.total : flags.length;
    pendingItems.push({ icon: '🚩', text: `${enabled} flags active / ${total} total`, href: '/super-admin/flags', isAlert: false });
  }
  pendingItems.push({ icon: '🆘', text: 'Check support center', href: '/super-admin/support', isAlert: false });

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Pending Actions</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#fff', background: '#2563EB',
            borderRadius: 10, padding: '1px 7px', lineHeight: '16px',
          }}>{pendingItems.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {pendingItems.map((item, i) => (
            <a
              key={i}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px', borderRadius: 6, textDecoration: 'none',
                background: item.isAlert ? 'rgba(239,68,68,0.06)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!item.isAlert) e.currentTarget.style.background = '#F9FAFB'; }}
              onMouseLeave={e => { if (!item.isAlert) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                <span style={{ fontSize: 12, color: item.isAlert ? '#DC2626' : 'var(--text-1)', fontWeight: item.isAlert ? 600 : 400 }}>{item.text}</span>
              </div>
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>{'→'}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
