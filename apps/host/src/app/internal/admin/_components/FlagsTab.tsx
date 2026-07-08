'use client';

/**
 * FlagsTab — internal-admin Feature Flags tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/feature-flags — flag list
 *   - PATCH /api/internal/admin/feature-flags — toggle is_enabled
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminHeaders } from '@alfanumrik/lib/admin-session';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { FeatureFlag } from '../_lib/internal-admin-types';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  badge: (color: string, bg?: string): React.CSSProperties => ({
    fontSize: 10, padding: '2px 8px', borderRadius: 10,
    background: bg || `${color}18`, color,
    fontWeight: 600, whiteSpace: 'nowrap' as const,
  }),
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
};

export interface FlagsTabProps {
  secret: string;
  onToast?: (msg: string) => void;
}

export default function FlagsTab({ secret, onToast }: FlagsTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<{ data: FeatureFlag[] }>('/api/internal/admin/feature-flags');
      setFlags(d.data || []);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const toggleFlag = async (flag: FeatureFlag) => {
    await fetch('/api/internal/admin/feature-flags', {
      method: 'PATCH',
      headers: adminHeaders(secret),
      body: JSON.stringify({ id: flag.id, is_enabled: !flag.is_enabled }),
    });
    onToast?.(`Flag "${flag.name}" ${!flag.is_enabled ? 'enabled' : 'disabled'}`);
    fetchFlags();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Feature Flags</div>
        <button onClick={fetchFlags} style={S.btn()}>↻ Refresh</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {flags.map(flag => (
          <div key={flag.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{flag.name}</div>
              <div style={{ fontSize: 11, color: C.text3, marginBottom: 6 }}>{flag.description}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={S.badge(flag.rollout_percentage === 100 ? C.green : C.yellow)}>
                  {flag.rollout_percentage}% rollout
                </span>
                {flag.target_grades && <span style={S.badge(C.blue)}>Grades: {flag.target_grades.join(', ')}</span>}
                {flag.target_roles && <span style={S.badge(C.purple)}>Roles: {flag.target_roles.join(', ')}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: flag.is_enabled ? C.green : C.text3, fontWeight: 600 }}>
                {flag.is_enabled ? 'ENABLED' : 'DISABLED'}
              </span>
              <button onClick={() => toggleFlag(flag)}
                style={{ ...S.btn(flag.is_enabled ? C.red : C.green) }}>
                {flag.is_enabled ? '⏸ Disable' : '▶ Enable'}
              </button>
            </div>
          </div>
        ))}
        {flags.length === 0 && !loading && (
          <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>No feature flags configured</div>
        )}
      </div>
    </div>
  );
}
