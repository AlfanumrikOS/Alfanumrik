'use client';

import { useState } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';

function ReportsContent() {
  const { apiFetch } = useAdmin();
  const [status, setStatus] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const downloadReport = async (type: string, format: string) => {
    setDownloading(`${type}-${format}`);
    setStatus(`Generating ${type} report...`);
    try {
      const res = await apiFetch(`/api/super-admin/reports?type=${type}&format=${format}`);
      if (!res.ok) { setStatus('Failed to generate report'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      a.href = url; a.download = `alfanumrik-${type}-${ts}.${format === 'json' ? 'json' : 'csv'}`; a.click();
      URL.revokeObjectURL(url);
      setStatus(`${type} report downloaded!`);
      setTimeout(() => setStatus(''), 3000);
    } catch { setStatus('Download failed'); }
    finally { setDownloading(null); }
  };

  const reports = [
    { type: 'students', label: 'Student Records', desc: 'Names, grades, XP, subscriptions, activity status' },
    { type: 'teachers', label: 'Teacher Records', desc: 'Names, schools, active status' },
    { type: 'parents', label: 'Parent Records', desc: 'Names, emails, phone numbers' },
    { type: 'quizzes', label: 'Quiz Sessions', desc: 'Scores, subjects, completion status' },
    { type: 'chats', label: 'Chat Sessions', desc: 'Subjects, message counts, activity' },
    { type: 'audit', label: 'Audit Logs', desc: 'All admin actions and system events' },
  ];

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.h1}>Reports & Exports</h1>
        <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Export data as CSV or JSON files. Reports include up to 5,000 rows.</p>
      </div>

      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: status.includes('failed') || status.includes('Failed') ? colors.dangerLight : colors.successLight,
          color: status.includes('failed') || status.includes('Failed') ? colors.danger : colors.success,
          border: `1px solid ${status.includes('failed') || status.includes('Failed') ? '#FECACA' : '#BBF7D0'}`,
        }}>
          {status}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {reports.map(r => (
          <div key={r.type} style={S.card}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.text1, marginBottom: 2 }}>{r.label}</div>
              <div style={{ fontSize: 12, color: colors.text3 }}>{r.desc}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => downloadReport(r.type, 'csv')}
                disabled={downloading !== null}
                style={{ ...S.dlBtn, flex: 1, opacity: downloading !== null ? 0.6 : 1, cursor: downloading !== null ? 'not-allowed' : 'pointer' }}
              >
                {downloading === `${r.type}-csv` ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Downloading...
                  </span>
                ) : 'Download CSV'}
              </button>
              <button
                onClick={() => downloadReport(r.type, 'json')}
                disabled={downloading !== null}
                style={{ ...S.secondaryBtn, flex: 1, fontSize: 12, opacity: downloading !== null ? 0.6 : 1, cursor: downloading !== null ? 'not-allowed' : 'pointer' }}
              >
                {downloading === `${r.type}-json` ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Downloading...
                  </span>
                ) : 'Download JSON'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return <AdminShell><ReportsContent /></AdminShell>;
}
