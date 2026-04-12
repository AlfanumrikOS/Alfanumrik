'use client';

import { useState, useEffect, useCallback } from 'react';
import { colors, S } from '../../_components/admin-styles';
import { useAdmin } from '../../_components/AdminShell';
import type { TimelineEvent } from './EventRow';

interface EventDetailDrawerProps {
  eventId: string | null;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch {
    return iso;
  }
}

function severityStyle(severity: string): React.CSSProperties {
  switch (severity) {
    case 'critical': return { color: colors.danger, fontWeight: 700 };
    case 'error': return { color: colors.danger, fontWeight: 600 };
    case 'warning': return { color: colors.warning, fontWeight: 600 };
    default: return { color: colors.text2 };
  }
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontSize: 12,
        color: value ? colors.text1 : colors.text3,
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all',
      }}>
        {value || '--'}
      </div>
    </div>
  );
}

export default function EventDetailDrawer({ eventId, onClose }: EventDetailDrawerProps) {
  const { apiFetch } = useAdmin();
  const [event, setEvent] = useState<TimelineEvent | null>(null);
  const [related, setRelated] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchEvent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/observability/events/${id}?includeRelated=true`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to load event' }));
        setError(body.error || 'Failed to load event');
        return;
      }
      const data = await res.json();
      setEvent(data.event);
      setRelated(data.related || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (eventId) {
      fetchEvent(eventId);
    } else {
      setEvent(null);
      setRelated([]);
    }
  }, [eventId, fetchEvent]);

  const copyAsJson = () => {
    if (!event) return;
    const json = JSON.stringify({ event, related }, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: do nothing
    });
  };

  if (!eventId) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.15)', zIndex: 200,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 384, maxWidth: '90vw',
        background: colors.bg, borderLeft: `1px solid ${colors.border}`,
        zIndex: 201, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', borderBottom: `1px solid ${colors.border}`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text1 }}>Event Detail</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={copyAsJson} style={{ ...S.actionBtn, fontSize: 11 }}>
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
            <button onClick={onClose} style={{ ...S.actionBtn, fontSize: 14, padding: '2px 8px' }}>
              x
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ color: colors.text3, textAlign: 'center', padding: 24 }}>Loading...</div>
          )}

          {error && (
            <div style={{ color: colors.danger, fontSize: 13, padding: 12, background: colors.dangerLight, borderRadius: 6 }}>
              {error}
            </div>
          )}

          {!loading && !error && event && (
            <>
              {/* Event details */}
              <div style={{ marginBottom: 20 }}>
                <DetailRow label="Timestamp" value={formatTimestamp(event.occurred_at)} mono />
                <DetailRow label="Severity" value={event.severity} />
                {event.severity !== 'info' && (
                  <span style={{ ...severityStyle(event.severity), fontSize: 11 }}>
                    {event.severity.toUpperCase()}
                  </span>
                )}
                <DetailRow label="Category" value={event.category} />
                <DetailRow label="Source" value={event.source} />
                <DetailRow label="Message" value={event.message} />
                <DetailRow label="Subject Type" value={event.subject_type} />
                <DetailRow label="Subject ID" value={event.subject_id} mono />
                <DetailRow label="Request ID" value={event.request_id} mono />
                <DetailRow label="Environment" value={event.environment} />
                <DetailRow label="Event ID" value={event.id} mono />
              </div>

              {/* Context JSON */}
              {event.context && Object.keys(event.context).length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Context
                  </div>
                  <pre style={{
                    fontSize: 11, fontFamily: 'monospace', color: colors.text1,
                    background: colors.surface, padding: 10, borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    overflow: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    margin: 0,
                  }}>
                    {JSON.stringify(event.context, null, 2)}
                  </pre>
                </div>
              )}

              {/* Related events */}
              {related.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Related Events (request_id: {event.request_id?.slice(0, 12)}...)
                  </div>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
                    {related.map(r => (
                      <div
                        key={r.id}
                        style={{
                          padding: '6px 10px', borderBottom: `1px solid ${colors.borderLight}`,
                          fontSize: 11,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                          <span style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                            background: r.severity === 'error' || r.severity === 'critical' ? colors.danger :
                              r.severity === 'warning' ? colors.warning : colors.text3,
                          }} />
                          <span style={{ fontFamily: 'monospace', color: colors.text3, fontSize: 10 }}>
                            {formatTimestamp(r.occurred_at)}
                          </span>
                          <span style={{ color: colors.text2, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>
                            {r.category}
                          </span>
                        </div>
                        <div style={{ color: colors.text1 }}>{r.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
