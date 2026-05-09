'use client';

/**
 * SchoolsTab — internal-admin School Management tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/schools?limit=25 — { data, total }
 *   - Card grid with name, city/state, teacher_count, student_count
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAdminFetch } from '../_hooks/useAdminFetch';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text3: '#484f58',
  orange: '#E8581C',
  blue: '#3b82f6',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
};

export interface SchoolsTabProps {
  secret: string;
}

export default function SchoolsTab({ secret }: SchoolsTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [schools, setSchools] = useState<Record<string, unknown>[]>([]);
  const [schoolTotal, setSchoolTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchSchools = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<{ data: Record<string, unknown>[]; total: number }>(
        '/api/internal/admin/schools?limit=25',
      );
      setSchools(d.data || []);
      setSchoolTotal(d.total || 0);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    fetchSchools();
  }, [fetchSchools]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>School Management</div>
        <button onClick={fetchSchools} style={S.btn()}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>{schoolTotal} schools</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {schools.map((s: Record<string, unknown>, i) => (
          <div key={i} style={{ ...S.card, borderTop: `2px solid ${C.blue}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{s.name as string || '—'}</div>
            <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{s.city as string || ''} · {s.state as string || ''}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div><span style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{s.teacher_count as number ?? 0}</span><br/><span style={{ fontSize: 9, color: C.text3 }}>TEACHERS</span></div>
              <div><span style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>{s.student_count as number ?? 0}</span><br/><span style={{ fontSize: 9, color: C.text3 }}>STUDENTS</span></div>
            </div>
          </div>
        ))}
        {schools.length === 0 && !loading && (
          <div style={{ color: C.text3, fontSize: 12, padding: 20 }}>No schools found</div>
        )}
      </div>
    </div>
  );
}
