'use client';

import { useState } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';

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

  const isError = status.includes('failed') || status.includes('Failed');

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Reports & Exports</h1>
        <p className="text-[13px] text-muted-foreground m-0">Export data as CSV or JSON files. Reports include up to 5,000 rows.</p>
      </div>

      {status && (
        <div
          className="mb-4 rounded-lg border px-3.5 py-2.5 text-[13px]"
          style={{
            borderColor: `color-mix(in srgb, var(--${isError ? 'danger' : 'success'}) 35%, transparent)`,
            backgroundColor: `color-mix(in srgb, var(--${isError ? 'danger' : 'success'}) 8%, transparent)`,
            color: `var(--${isError ? 'danger' : 'success'})`,
          }}
        >
          {status}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {reports.map(r => (
          <div key={r.type} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            <div className="mb-3">
              <div className="mb-0.5 text-[15px] font-bold text-foreground">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.desc}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => downloadReport(r.type, 'csv')}
                disabled={downloading !== null}
                className={[
                  'flex-1 rounded-md border border-surface-3 bg-surface-2 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-3',
                  downloading !== null ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                ].join(' ')}
              >
                {downloading === `${r.type}-csv` ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Downloading...
                  </span>
                ) : 'Download CSV'}
              </button>
              <button
                onClick={() => downloadReport(r.type, 'json')}
                disabled={downloading !== null}
                className={[
                  'flex-1 rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-xs font-medium text-foreground hover:bg-surface-2',
                  downloading !== null ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                ].join(' ')}
              >
                {downloading === `${r.type}-json` ? (
                  <span className="inline-flex items-center gap-1.5">
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
