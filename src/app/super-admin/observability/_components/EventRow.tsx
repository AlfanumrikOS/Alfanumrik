'use client';

import { colors } from '../../_components/admin-styles';

export interface TimelineEvent {
  id: string;
  occurred_at: string;
  category: string;
  source: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  subject_type: string | null;
  subject_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
  request_id: string | null;
  environment: string;
}

interface EventRowProps {
  event: TimelineEvent;
  onClick: (event: TimelineEvent) => void;
  isSelected: boolean;
}

function severityColor(severity: TimelineEvent['severity']): string {
  switch (severity) {
    case 'info': return colors.text3;
    case 'warning': return colors.warning;
    case 'error': return colors.danger;
    case 'critical': return colors.danger;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return '';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday ';
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ' ';
  } catch {
    return '';
  }
}

export default function EventRow({ event, onClick, isSelected }: EventRowProps) {
  const isCritical = event.severity === 'critical';

  return (
    <button
      onClick={() => onClick(event)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        background: isSelected ? colors.accentLight : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${colors.borderLight}`,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: 13,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = colors.surfaceHover; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Time */}
      <span style={{ fontSize: 11, color: colors.text3, whiteSpace: 'nowrap', minWidth: 70, fontFamily: 'monospace' }}>
        {formatDate(event.occurred_at)}{formatTime(event.occurred_at)}
      </span>

      {/* Severity dot */}
      <span style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: severityColor(event.severity),
        flexShrink: 0,
        boxShadow: isCritical ? `0 0 4px ${colors.danger}` : 'none',
      }} />

      {/* Category */}
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: colors.text2,
        background: colors.surface,
        padding: '1px 6px',
        borderRadius: 3,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
        minWidth: 50,
        textAlign: 'center',
      }}>
        {event.category}
      </span>

      {/* Source */}
      <span style={{ fontSize: 11, color: colors.text3, whiteSpace: 'nowrap', minWidth: 80, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {event.source}
      </span>

      {/* Message */}
      <span style={{
        flex: 1,
        color: isCritical ? colors.danger : colors.text1,
        fontWeight: isCritical ? 600 : 400,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {event.message}
      </span>

      {/* Subject ID (truncated) */}
      {event.subject_id && (
        <code style={{
          fontSize: 10,
          color: colors.text3,
          background: colors.surface,
          padding: '1px 4px',
          borderRadius: 2,
          maxWidth: 80,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.subject_id.length > 12 ? event.subject_id.slice(0, 12) + '...' : event.subject_id}
        </code>
      )}
    </button>
  );
}
