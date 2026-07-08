'use client';

/**
 * LogsTab — internal-admin Audit Logs tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/logs?source=&page=&limit=25 — paginated table
 *   - source toggle: 'all' (👤 User Logs) | 'admin' (🔑 Admin Logs)
 *   - Export CSV button triggers GET /api/internal/admin/reports?type=audit&format=csv
 *     blob download (status indicator was Reports-tab-only so it's silent here —
 *     matches the inline pre-refactor behaviour).
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens (Task 6
 * decision).
 */

import { useState, useEffect, useCallback } from 'react';
import { adminHeaders } from '@alfanumrik/lib/admin-session';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { LogEntry } from '../_lib/internal-admin-types';

const C = {
  bg2: '#0d1117',
  border: '#21262d',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
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
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: `1px solid ${C.border}`, color: C.text3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.2, whiteSpace: 'nowrap' as const },
  td: { padding: '9px 12px', borderBottom: `1px solid ${C.bg2}`, color: C.text2, verticalAlign: 'middle' as const },
};

export interface LogsTabProps {
  secret: string;
}

export default function LogsTab({ secret }: LogsTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logSource, setLogSource] = useState('all');

  const fetchLogs = useCallback(async () => {
    try {
      const d = await apiFetch<{ data: LogEntry[]; total: number }>(
        `/api/internal/admin/logs?source=${logSource}&page=${logPage}&limit=25`,
      );
      setLogs(d.data || []);
      setLogTotal(d.total || 0);
    } catch {
      // swallow — preserves pre-refactor "if (res.ok)" no-op-on-error behaviour
    }
  }, [apiFetch, logSource, logPage]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const exportCsv = async () => {
    try {
      const res = await fetch('/api/internal/admin/reports?type=audit&format=csv', {
        headers: adminHeaders(secret),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `alfanumrik-audit-${Date.now()}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { /* no-op — preserves pre-refactor silent-failure behaviour */ }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Audit Logs</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'admin'].map(s => (
            <button key={s} onClick={() => { setLogSource(s); setLogPage(1); }}
              style={{ ...S.btn(), ...(logSource === s ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
              {s === 'all' ? '👤 User Logs' : '🔑 Admin Logs'}
            </button>
          ))}
          <button onClick={exportCsv} style={S.btn(C.green)}>⬇ Export CSV</button>
          <button onClick={fetchLogs} style={S.btn()}>↻</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>{logTotal.toLocaleString()} total entries</div>

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Time</th>
              <th style={S.th}>Action</th>
              <th style={S.th}>{logSource === 'admin' ? 'Entity Type' : 'Resource'}</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Actor</th>
              <th style={S.th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{ ...S.td, fontSize: 10, whiteSpace: 'nowrap', color: C.text3 }}>{new Date(l.created_at).toLocaleString()}</td>
                <td style={S.td}><code style={{ color: C.orange, background: `${C.orange}15`, padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>{l.action}</code></td>
                <td style={S.td}>{l.resource_type || l.entity_type || '—'}</td>
                <td style={S.td}>
                  {l.status && <span style={S.badge(l.status === 'success' ? C.green : l.status === 'denied' ? C.red : C.yellow)}>{l.status}</span>}
                </td>
                <td style={{ ...S.td, fontSize: 10 }}><code>{(l.auth_user_id || l.admin_id || '—').slice(0, 12)}</code></td>
                <td style={{ ...S.td, fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.details ? JSON.stringify(l.details).slice(0, 80) : '—'}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.text3 }}>No logs found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
        <button disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)} style={S.btn()}>← Prev</button>
        <span style={{ fontSize: 12, color: C.text3 }}>Page {logPage} / {Math.max(1, Math.ceil(logTotal / 25))}</span>
        <button disabled={logs.length < 25} onClick={() => setLogPage(p => p + 1)} style={S.btn()}>Next →</button>
      </div>
    </div>
  );
}

