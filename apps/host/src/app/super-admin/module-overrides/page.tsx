'use client';

/**
 * /super-admin/module-overrides — Platform-wide module force-disable.
 *
 * Lets ops/founder force-disable a platform module across EVERY tenant
 * (overriding tenant_modules rows + tenant-type defaults). Use cases:
 *   - Module has a security incident; kill it across all tenants while we patch
 *   - Module's downstream service (e.g. Live Classes provider) is down
 *   - Compliance: a module should never run for any tenant of a region
 *
 * Backed by GET / PUT /api/super-admin/module-overrides (auth: admin secret).
 *
 * UX:
 *   - Each module row shows: name, description, current force-disabled
 *     state, reason (if set), who/when last toggled.
 *   - Toggle button + reason textarea. The reason is REQUIRED on
 *     force-disable (server-side accepts blank but the UI prompts).
 *   - Audit row written to admin_audit_log on every change.
 */

import { useState, useEffect, useCallback } from 'react';
import AdminShell from '../_components/AdminShell';
import { adminHeaders, getAdminSecretFromSession } from '@alfanumrik/lib/admin-session';

const colors = {
  bg: '#FFFFFF',
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  border: '#E5E7EB',
  success: '#16A34A',
  danger: '#DC2626',
} as const;

const S: Record<string, React.CSSProperties> = {
  card: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
  },
  // S.button / S.input were not present in legacy admin-styles either;
  // preserving undefined-spread behaviour with empty objects.
  button: {},
  input: {},
};

interface OverrideRow {
  key: string;
  displayName: string;
  displayNameHi: string | null;
  description: string;
  isForceDisabled: boolean;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
}

interface OverridesResponse {
  modules: OverrideRow[];
}

export default function ModuleOverridesPage() {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverridesResponse | null>(null);
  // Per-row reason input (uncontrolled until user types).
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/module-overrides', {
        headers: adminHeaders(getAdminSecretFromSession()),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(body.data as OverridesResponse);
      // Pre-populate reason inputs with existing reasons so the textarea
      // shows them on first render.
      const initialReasons: Record<string, string> = {};
      for (const m of body.data.modules) {
        initialReasons[m.key] = m.reason ?? '';
      }
      setReasonInputs(initialReasons);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = async (m: OverrideRow) => {
    if (savingKey) return;
    const nextState = !m.isForceDisabled;
    const reason = reasonInputs[m.key] ?? '';
    if (nextState && !reason.trim()) {
      // Light enforcement — server accepts blank, but operationally we want
      // a paper trail.
      setError(`Reason required to force-disable ${m.displayName}.`);
      return;
    }

    setSavingKey(m.key);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/module-overrides', {
        method: 'PUT',
        headers: adminHeaders(getAdminSecretFromSession()),
        body: JSON.stringify({
          moduleKey: m.key,
          isForceDisabled: nextState,
          reason: nextState ? reason.trim() : null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <AdminShell>
      <div style={{ marginBottom: 16 }}>
        <h1 className="text-lg font-bold text-foreground m-0">
          Module Overrides
        </h1>
        <p style={{ fontSize: 12, color: colors.text2, margin: '4px 0 0' }}>
          Force-disable platform modules across every tenant. Resolution wins
          over both per-tenant settings and tenant-type defaults.
        </p>
      </div>

      {loading && (
        <div style={{ padding: 24, color: colors.text2 }}>Loading…</div>
      )}

      {error && (
        <div style={{ ...S.card, padding: 12, marginBottom: 12, borderLeft: `3px solid ${colors.danger}` }}>
          <div style={{ fontSize: 13, color: colors.danger }}>{error}</div>
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.modules.map(m => {
            const reasonValue = reasonInputs[m.key] ?? '';
            return (
              <div
                key={m.key}
                style={{
                  ...S.card,
                  padding: 14,
                  borderLeft: m.isForceDisabled
                    ? `3px solid ${colors.danger}`
                    : `3px solid ${colors.success}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text1 }}>
                      {m.displayName}
                      <span style={{
                        marginLeft: 8,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: m.isForceDisabled ? `${colors.danger}20` : `${colors.success}20`,
                        color: m.isForceDisabled ? colors.danger : colors.success,
                      }}>
                        {m.isForceDisabled ? 'Force-Disabled' : 'Available'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: colors.text3, marginTop: 2 }}>{m.description}</div>
                    {m.setAt && (
                      <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
                        Last changed: {new Date(m.setAt).toLocaleString('en-IN')}
                        {m.setBy && ` · by ${m.setBy.slice(0, 8)}…`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onToggle(m)}
                    disabled={savingKey === m.key}
                    style={{
                      ...S.button,
                      background: m.isForceDisabled ? colors.success : colors.danger,
                      color: '#fff',
                      minWidth: 140,
                    }}
                  >
                    {savingKey === m.key
                      ? 'Saving…'
                      : m.isForceDisabled
                        ? 'Re-enable'
                        : 'Force-Disable'}
                  </button>
                </div>

                <div>
                  <label
                    style={{ display: 'block', fontSize: 11, color: colors.text2, marginBottom: 4 }}
                    htmlFor={`reason-${m.key}`}
                  >
                    Reason (required when force-disabling — written to audit_log)
                  </label>
                  <textarea
                    id={`reason-${m.key}`}
                    value={reasonValue}
                    onChange={e => setReasonInputs(prev => ({ ...prev, [m.key]: e.target.value }))}
                    placeholder="e.g. Live Classes provider Vimeo is down — force-disabling for 24h"
                    rows={2}
                    maxLength={500}
                    style={{
                      ...S.input,
                      width: '100%',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                    disabled={savingKey === m.key}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
