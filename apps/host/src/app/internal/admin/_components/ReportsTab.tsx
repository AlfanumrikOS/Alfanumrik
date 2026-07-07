'use client';

/**
 * ReportsTab — internal-admin Reports & Exports tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - 6 export cards (students, teachers, parents, quizzes, chats, audit) each
 *     with CSV + JSON download buttons.
 *   - downloadReport() hits GET /api/internal/admin/reports?type=&format=,
 *     blobs the response, triggers a browser download, and toggles a green
 *     "✓ <type> downloaded" / red "Download failed" status pill for ~3s.
 *   - The status pill colour is keyed off the substring "fail" — preserved.
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens (Task 6
 * decision: chrome/tab content keep dark theme; admin-ui surface-* tokens
 * are not used here).
 */

import { useState } from 'react';
import { adminHeaders } from '@alfanumrik/lib/admin-session';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text3: '#484f58',
  green: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#E8581C',
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

export interface ReportsTabProps {
  secret: string;
}

export default function ReportsTab({ secret }: ReportsTabProps) {
  const [reportStatus, setReportStatus] = useState('');

  const downloadReport = async (type: string, format: string) => {
    setReportStatus(`Generating ${type} report...`);
    try {
      const res = await fetch(`/api/internal/admin/reports?type=${type}&format=${format}`, {
        headers: adminHeaders(secret),
      });
      if (!res.ok) { setReportStatus('Failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `alfanumrik-${type}-${Date.now()}.${format}`;
      a.click(); URL.revokeObjectURL(url);
      setReportStatus(`✓ ${type} downloaded`);
      setTimeout(() => setReportStatus(''), 3000);
    } catch { setReportStatus('Download failed'); }
  };

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Reports & Exports</div>
      {reportStatus && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: reportStatus.includes('fail') ? `${C.red}15` : `${C.green}15`,
          color: reportStatus.includes('fail') ? C.red : C.green, fontSize: 12, marginBottom: 16, border: `1px solid ${reportStatus.includes('fail') ? C.red : C.green}30` }}>
          {reportStatus}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {[
          { type: 'students', icon: '🎓', label: 'Student Records', desc: 'Names, grades, XP, plans, status' },
          { type: 'teachers', icon: '👩‍🏫', label: 'Teacher Records', desc: 'Names, schools, active status' },
          { type: 'parents', icon: '👨‍👩‍👧', label: 'Parent Records', desc: 'Names, emails, contact info' },
          { type: 'quizzes', icon: '⚡', label: 'Quiz Sessions', desc: 'Scores, subjects, completion' },
          { type: 'chats', icon: '🤖', label: 'AI Chat Sessions', desc: 'Subjects, message counts' },
          { type: 'audit', icon: '🔍', label: 'Audit Trail', desc: 'All user & admin actions' },
        ].map(r => (
          <div key={r.type} style={S.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{r.icon} {r.label}</div>
            <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>{r.desc}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => downloadReport(r.type, 'csv')} style={{ ...S.btn(C.green), flex: 1 }}>⬇ CSV</button>
              <button onClick={() => downloadReport(r.type, 'json')} style={{ ...S.btn(C.blue), flex: 1 }}>⬇ JSON</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
