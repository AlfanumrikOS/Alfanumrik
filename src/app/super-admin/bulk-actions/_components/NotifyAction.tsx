'use client';

import { useState } from 'react';
import { useAdmin } from '../../_components/AdminShell';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

interface NotifyResult {
  sent: number;
  failed: number;
  errors: string[];
}

interface NotifyActionProps {
  selectedIds: Set<string>;
}

const NOTIFICATION_TYPES = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'update', label: 'Update' },
  { value: 'reminder', label: 'Reminder' },
];

export default function NotifyAction({ selectedIds }: NotifyActionProps) {
  const { apiFetch } = useAdmin();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('announcement');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const [error, setError] = useState('');

  const execute = async () => {
    if (selectedIds.size === 0 || !title.trim() || !body.trim()) return;
    setExecuting(true);
    setResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/bulk-actions/notify', {
        method: 'POST',
        body: JSON.stringify({
          studentIds: Array.from(selectedIds),
          title: title.trim(),
          body: body.trim(),
          type,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setResult(d.data);
        setTitle('');
        setBody('');
      } else {
        setError(d.error || 'Request failed');
      }
    } catch {
      setError('Network error');
    }
    setExecuting(false);
  };

  return (
    <div style={{ ...S.card, marginTop: 16, borderLeft: `3px solid ${colors.warning}` }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>
        Send Notification
      </h3>

      {selectedIds.size === 0 ? (
        <p style={{ fontSize: 13, color: colors.text3 }}>Select students from the table above to send a notification.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: colors.text2, marginBottom: 12 }}>
            <strong>{selectedIds.size}</strong> recipient{selectedIds.size !== 1 ? 's' : ''}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Notification title"
                  style={{ ...S.searchInput, width: '100%' }}
                  data-testid="notify-title"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  style={S.select}
                  data-testid="notify-type"
                >
                  {NOTIFICATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Body</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Notification body text..."
                rows={4}
                style={{
                  ...S.searchInput,
                  width: '100%',
                  resize: 'vertical' as const,
                  minHeight: 80,
                }}
                data-testid="notify-body"
              />
            </div>
            <div>
              <button
                onClick={execute}
                disabled={executing || !title.trim() || !body.trim()}
                style={{ ...S.primaryBtn, opacity: (executing || !title.trim() || !body.trim()) ? 0.6 : 1 }}
                data-testid="execute-notify"
              >
                {executing ? 'Sending...' : 'Send Notification'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Result display */}
      {result && (
        <div style={{ ...S.cardSurface, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <StatusBadge label={`${result.sent} sent`} variant="success" />
            {result.failed > 0 && <StatusBadge label={`${result.failed} failed`} variant="danger" />}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: colors.danger, fontWeight: 600, marginBottom: 4 }}>Errors:</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: colors.danger, padding: '2px 0' }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: colors.danger }}>{error}</div>
      )}
    </div>
  );
}
