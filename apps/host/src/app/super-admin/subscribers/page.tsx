'use client';

/**
 * /super-admin/subscribers — operator console for the state-event runtime.
 *
 * Shows one row per registered subscriber with its cursor, lag, processed
 * counts, and dead-letter count. Each row has two actions:
 *
 *   - Replay  — opens a modal where the operator picks a reset mode
 *               (timestamp or event_id), types the subscriber name to
 *               confirm, and submits. The cursor moves BACKWARD so the
 *               next tick reprocesses events.
 *
 *   - View dead letters — opens a drawer listing unresolved dead-letter
 *               rows; each has a Retry button that deletes the row so the
 *               runtime picks the event back up on the next tick.
 *
 * !!! Idempotency warning !!!
 *
 *   Replaying / retrying causes subscribers to re-handle events. If a
 *   subscriber isn't idempotent, this WILL cause double-writes or
 *   double-side-effects. The confirmation modal calls this out
 *   prominently — operators MUST verify the subscriber's idempotency
 *   contract before proceeding. The route docstrings carry the same
 *   warning; this page is the operator-facing surface for it.
 */

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin, readAdminJson } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';

const colors = {
  bg: '#FFFFFF',
  surface2: '#F9FAFB',
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  border: '#E5E7EB',
  primary: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
} as const;

interface SubscriberRow {
  subscriber_name: string;
  kind_filter: string;
  last_processed_event_id: string | null;
  last_processed_occurred_at: string | null;
  events_processed: number;
  events_dead_lettered: number;
  updated_at: string;
  lag_seconds: number | null;
  dead_letter_count: number;
  pending_event_count: number;
}

interface DeadLetter {
  event_id: string;
  subscriber_name: string;
  attempt_count: number;
  last_error: string;
  first_attempted_at: string;
  last_attempted_at: string;
}

type ReplayMode = 'reset_to_timestamp' | 'reset_to_event_id';

function formatLag(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function lagColor(seconds: number | null): string {
  if (seconds === null) return colors.text3;
  if (seconds < 60) return colors.success;
  if (seconds < 600) return colors.warning;
  return colors.danger;
}

function SubscribersInner() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SubscriberRow[]>([]);

  const [replayFor, setReplayFor] = useState<SubscriberRow | null>(null);
  const [deadLettersFor, setDeadLettersFor] = useState<SubscriberRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/subscribers');
      const body = await readAdminJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setRows(body.data.subscribers as SubscriberRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 className="text-lg font-bold text-foreground m-0">{isHi ? 'इवेंट रनटाइम' : 'Event Runtime'}</h1>
        <p style={{ fontSize: 12, color: colors.text2, margin: '4px 0 0' }}>
          State-event runtime cursors. Replay moves cursors BACKWARD so subscribers
          reprocess events. Dead-letters can be retried by deleting them.
        </p>
        <div
          style={{
            marginTop: 8,
            padding: 10,
            background: `${colors.warning}15`,
            border: `1px solid ${colors.warning}50`,
            borderRadius: 6,
            fontSize: 12,
            color: colors.text1,
          }}
        >
          <strong>Idempotency warning:</strong> replaying or retrying causes the
          subscriber to re-handle events. If the subscriber is not idempotent,
          this will double-write. Verify the subscriber&apos;s <code>handle()</code>
          {' '}contract before proceeding.
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            border: `1px solid ${colors.danger}`,
            borderLeft: `3px solid ${colors.danger}`,
            borderRadius: 6,
            fontSize: 13,
            color: colors.danger,
            background: colors.bg,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, color: colors.text2 }}>Loading…</div>
      ) : (
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            background: colors.bg,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: colors.surface2 }}>
                <Th>Subscriber</Th>
                <Th>Kind filter</Th>
                <Th>Lag</Th>
                <Th>Processed</Th>
                <Th>Dead letters</Th>
                <Th>Pending</Th>
                <Th>Last cursor</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: colors.text2 }}>
                    No subscribers registered.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.subscriber_name}
                  style={{ borderTop: `1px solid ${colors.border}` }}
                >
                  <Td>
                    <code style={{ fontSize: 12 }}>{r.subscriber_name}</code>
                  </Td>
                  <Td>
                    <code style={{ fontSize: 11, color: colors.text2 }}>{r.kind_filter}</code>
                  </Td>
                  <Td>
                    <span style={{ color: lagColor(r.lag_seconds), fontWeight: 600 }}>
                      {formatLag(r.lag_seconds)}
                    </span>
                  </Td>
                  <Td>{r.events_processed.toLocaleString()}</Td>
                  <Td>
                    <span
                      style={{
                        color: r.dead_letter_count > 0 ? colors.danger : colors.text2,
                        fontWeight: r.dead_letter_count > 0 ? 600 : 400,
                      }}
                    >
                      {r.dead_letter_count}
                    </span>
                  </Td>
                  <Td>{r.pending_event_count.toLocaleString()}</Td>
                  <Td>
                    <div style={{ fontSize: 11, color: colors.text3 }}>
                      {r.last_processed_occurred_at
                        ? new Date(r.last_processed_occurred_at).toLocaleString('en-IN')
                        : '—'}
                    </div>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setReplayFor(r)}
                        style={btnSecondary}
                      >
                        Replay
                      </button>
                      <button
                        onClick={() => setDeadLettersFor(r)}
                        style={btnSecondary}
                        disabled={r.dead_letter_count === 0}
                      >
                        Dead letters ({r.dead_letter_count})
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {replayFor && (
        <ReplayModal
          subscriber={replayFor}
          onClose={() => setReplayFor(null)}
          onSuccess={() => {
            setReplayFor(null);
            void load();
          }}
        />
      )}

      {deadLettersFor && (
        <DeadLetterDrawer
          subscriber={deadLettersFor}
          onClose={() => setDeadLettersFor(null)}
          onChange={() => void load()}
        />
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: colors.text2,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        color: colors.text1,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 500,
  background: colors.bg,
  color: colors.text1,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: colors.primary,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: colors.danger,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

function ReplayModal({
  subscriber,
  onClose,
  onSuccess,
}: {
  subscriber: SubscriberRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { apiFetch } = useAdmin();
  const [mode, setMode] = useState<ReplayMode>('reset_to_timestamp');
  const [target, setTarget] = useState('');
  const [retypeName, setRetypeName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    target.trim() !== '' &&
    retypeName === subscriber.subscriber_name &&
    acknowledged;

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/super-admin/subscribers/${encodeURIComponent(subscriber.subscriber_name)}/replay`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode,
            target: target.trim(),
            expectedSubscriberName: retypeName,
          }),
        },
      );
      const body = await readAdminJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell onClose={onClose} title={`Replay subscriber: ${subscriber.subscriber_name}`}>
      <div
        style={{
          padding: 12,
          marginBottom: 12,
          background: `${colors.danger}10`,
          border: `1px solid ${colors.danger}40`,
          borderRadius: 6,
          fontSize: 12,
          color: colors.text1,
        }}
      >
        <strong style={{ color: colors.danger }}>WARNING:</strong> Moving the cursor
        backward CAUSES THE SUBSCRIBER TO REPROCESS EVENTS on its next tick.
        Subscriber idempotency is required for this to be safe. If the
        subscriber writes non-idempotently, replaying will double-write.
        Verify the subscriber&apos;s <code>handle()</code> contract before continuing.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label
            htmlFor="replay-mode"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          >
            Mode
          </label>
          <select
            id="replay-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ReplayMode)}
            style={{
              width: '100%',
              padding: 8,
              fontSize: 13,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
            }}
          >
            <option value="reset_to_timestamp">Reset to timestamp (ISO 8601)</option>
            <option value="reset_to_event_id">Reset to event_id</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="replay-target"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          >
            Target {mode === 'reset_to_timestamp' ? '(ISO timestamp)' : '(event UUID)'}
          </label>
          <input
            id="replay-target"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={
              mode === 'reset_to_timestamp'
                ? '2026-05-16T10:00:00.000Z'
                : '00000000-0000-0000-0000-000000000000'
            }
            style={{
              width: '100%',
              padding: 8,
              fontSize: 13,
              fontFamily: 'monospace',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
            }}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: colors.text2, marginBottom: 4 }}>
            Current cursor:{' '}
            <code>{subscriber.last_processed_occurred_at ?? 'null'}</code>
          </div>
          <div style={{ fontSize: 11, color: colors.text2 }}>
            The new cursor must be strictly BEFORE the current cursor. Forward
            jumps are rejected.
          </div>
        </div>

        <div>
          <label
            htmlFor="replay-retype"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          >
            Retype subscriber name to confirm
          </label>
          <input
            id="replay-retype"
            type="text"
            value={retypeName}
            onChange={(e) => setRetypeName(e.target.value)}
            placeholder={subscriber.subscriber_name}
            style={{
              width: '100%',
              padding: 8,
              fontSize: 13,
              fontFamily: 'monospace',
              border: `1px solid ${
                retypeName && retypeName !== subscriber.subscriber_name
                  ? colors.danger
                  : colors.border
              }`,
              borderRadius: 4,
            }}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 12,
            color: colors.text1,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            I have verified that this subscriber is idempotent and reprocessing
            events will not cause duplicate side-effects.
          </span>
        </label>

        {error && (
          <div
            style={{
              padding: 10,
              fontSize: 12,
              color: colors.danger,
              background: `${colors.danger}10`,
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={btnSecondary} disabled={submitting}>
            Cancel
          </button>
          <button
            onClick={onSubmit}
            style={{
              ...btnDanger,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            disabled={!canSubmit}
          >
            {submitting ? 'Replaying…' : 'Replay (move cursor backward)'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function DeadLetterDrawer({
  subscriber,
  onClose,
  onChange,
}: {
  subscriber: SubscriberRow;
  onClose: () => void;
  onChange: () => void;
}) {
  const { apiFetch } = useAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DeadLetter[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/super-admin/subscribers/${encodeURIComponent(subscriber.subscriber_name)}/dead-letters`,
      );
      const body = await readAdminJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setItems(body.data.dead_letters as DeadLetter[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, subscriber.subscriber_name]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRetry = async (eventId: string) => {
    if (
      !window.confirm(
        `Retry event ${eventId}? This will delete the dead-letter row and the runtime will re-attempt processing on its next tick. Make sure the root cause has been fixed.`,
      )
    ) {
      return;
    }
    setRetryingId(eventId);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/super-admin/subscribers/${encodeURIComponent(subscriber.subscriber_name)}/dead-letters/${encodeURIComponent(eventId)}/retry`,
        { method: 'POST' },
      );
      const body = await readAdminJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onChange();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <DrawerShell
      onClose={onClose}
      title={`Dead letters: ${subscriber.subscriber_name}`}
    >
      <div
        style={{
          padding: 10,
          marginBottom: 12,
          background: `${colors.warning}15`,
          border: `1px solid ${colors.warning}40`,
          borderRadius: 6,
          fontSize: 11,
          color: colors.text1,
        }}
      >
        Investigate <code>last_error</code> before retrying. If the root cause
        isn&apos;t fixed, the retry will just dead-letter again. The subscriber
        must be idempotent.
      </div>

      {loading ? (
        <div style={{ padding: 16, color: colors.text2, fontSize: 13 }}>Loading…</div>
      ) : error ? (
        <div
          style={{
            padding: 10,
            fontSize: 12,
            color: colors.danger,
            background: `${colors.danger}10`,
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16, color: colors.text2, fontSize: 13 }}>
          No unresolved dead-letters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <div
              key={it.event_id}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 10,
                background: colors.bg,
              }}
            >
              <div style={{ fontSize: 11, color: colors.text2, marginBottom: 4 }}>
                event_id
              </div>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{it.event_id}</code>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 8,
                  fontSize: 11,
                  color: colors.text2,
                }}
              >
                <div>
                  attempts: <strong style={{ color: colors.text1 }}>{it.attempt_count}</strong>
                </div>
                <div>
                  last: {new Date(it.last_attempted_at).toLocaleString('en-IN')}
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: colors.surface2,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: colors.danger,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {it.last_error}
              </div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => onRetry(it.event_id)}
                  style={{
                    ...btnSecondary,
                    opacity: retryingId === it.event_id ? 0.6 : 1,
                  }}
                  disabled={retryingId === it.event_id}
                >
                  {retryingId === it.event_id ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}

function ModalShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.bg,
          borderRadius: 8,
          padding: 20,
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: colors.text1,
              margin: 0,
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: colors.text2,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DrawerShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.bg,
          width: '100%',
          maxWidth: 540,
          height: '100%',
          padding: 20,
          overflow: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: colors.text1,
              margin: 0,
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: colors.text2,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function SubscribersPage() {
  return (
    <AdminShell>
      <SubscribersInner />
    </AdminShell>
  );
}
