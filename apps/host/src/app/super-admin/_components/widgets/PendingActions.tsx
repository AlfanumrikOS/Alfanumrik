'use client';

import type { ObsData, FeatureFlag, AiHealthData } from './control-room-types';
import { countOpenCircuits } from './AiHealth';

interface PendingActionsProps {
  obsData: ObsData | null;
  flags: FeatureFlag[];
  aiHealth: AiHealthData | null;
}

/**
 * Phase 3 Master Control (2026-07-20): every item here must be derived from
 * live data. The old always-on placeholders ("Content items may need review",
 * unconditional "Check support center") were removed — a pending-actions list
 * that always has entries trains operators to ignore it. A real support-queue
 * signal is deferred until backend exposes an open-ticket count (none of the
 * existing endpoints return one).
 */
export default function PendingActions({ obsData, flags, aiHealth }: PendingActionsProps) {
  const pendingItems: { icon: string; text: string; href: string; isAlert: boolean }[] = [];
  if (obsData && obsData.jobs.failed > 0) {
    pendingItems.push({ icon: '⚠️', text: `${obsData.jobs.failed} failed job${obsData.jobs.failed > 1 ? 's' : ''} need review`, href: '/super-admin/diagnostics', isAlert: true });
  }
  // Real AI signal: circuit breaker(s) reporting open in the last minute.
  const openCircuits = countOpenCircuits(aiHealth);
  if (openCircuits > 0) {
    pendingItems.push({ icon: '🤖', text: `${openCircuits} AI circuit breaker${openCircuits > 1 ? 's' : ''} open`, href: '/super-admin/grounding/health', isAlert: true });
  }
  if (flags.length > 0 || obsData) {
    const enabled = obsData ? obsData.feature_flags.enabled : flags.filter(f => f.enabled).length;
    const total = obsData ? obsData.feature_flags.total : flags.length;
    pendingItems.push({ icon: '🚩', text: `${enabled} flags active / ${total} total`, href: '/super-admin/flags', isAlert: false });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Pending Actions</span>
          <span className="rounded-full bg-foreground px-[7px] text-[10px] font-bold leading-4 text-surface-1">
            {pendingItems.length}
          </span>
        </div>
        {pendingItems.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '4px 8px' }}>
            Nothing pending — all clear.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {pendingItems.map((item, i) => (
            <a
              key={i}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px', borderRadius: 6, textDecoration: 'none',
                background: item.isAlert ? 'color-mix(in srgb, var(--danger) 6%, transparent)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!item.isAlert) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { if (!item.isAlert) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                <span style={{ fontSize: 12, color: item.isAlert ? 'var(--danger)' : 'var(--text-1)', fontWeight: item.isAlert ? 600 : 400 }}>{item.text}</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{'→'}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
