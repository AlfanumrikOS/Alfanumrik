'use client';

const colors = {
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  border: '#E5E7EB',
  surface: '#F9FAFB',
  accent: '#2563EB',
  accentLight: '#EFF6FF',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
} as const;

interface SnapshotData {
  breakerState: 'closed' | 'degraded' | 'open';
  breakerReason: string;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  healthAgeSeconds: number | null;
  lastDeploy: { git_sha: string; occurred_at: string; environment: string } | null;
  eventCounts: { info: number; warning: number; error: number; critical: number };
}

interface SystemSnapshotProps {
  data: SnapshotData | null;
  loading: boolean;
  /**
   * Set when the snapshot fetch failed. Required to keep a failed read
   * distinguishable from a slow one: the caller used to swallow the failure
   * (`if (res.ok) …` + bare `catch`), leaving `data` null forever, and this
   * component's `!data` branch renders "Loading snapshot…" — so the AI-breaker
   * / health / deploy strip sat in a permanent, retry-less pseudo-loading state
   * that an operator reads as "still fetching" rather than "we are blind".
   */
  error?: string | null;
  /** Re-runs the snapshot fetch. */
  onRetry?: () => void;
  /** Bilingual toggle (AuthContext.isHi). */
  isHi?: boolean;
}

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  );
}

function breakerColor(state: SnapshotData['breakerState']): string {
  switch (state) {
    case 'closed': return colors.success;
    case 'degraded': return colors.warning;
    case 'open': return colors.danger;
  }
}

function healthColor(status: SnapshotData['healthStatus']): string {
  switch (status) {
    case 'healthy': return colors.success;
    case 'degraded': return colors.warning;
    case 'unhealthy': return colors.danger;
    case 'unknown': return colors.text3;
  }
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return 'N/A';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDeployTime(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  } catch {
    return 'unknown';
  }
}

export default function SystemSnapshot({ data, loading, error, onRetry, isHi = false }: SystemSnapshotProps) {
  // Failed read takes precedence over the loading shell. Asserts NO status:
  // a strip that could not read breaker/health/deploy state has no colour it
  // can honestly show, so it shows none rather than a reassuring grey or green.
  if (!loading && error && !data) {
    return (
      <div
        role="alert"
        style={{
          display: 'flex', gap: 12, padding: '10px 16px', marginBottom: 16,
          background: colors.surface, border: `1px solid ${colors.danger}`,
          borderRadius: 8, fontSize: 12, color: colors.danger,
          alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        <span aria-hidden>&#9888;</span>
        <span style={{ minWidth: 0, flex: '1 1 220px' }}>
          {isHi
            ? `सिस्टम स्नैपशॉट लोड नहीं हो सका (${error}) — ब्रेकर, हेल्थ और डिप्लॉय स्थिति अज्ञात है।`
            : `Couldn’t load the system snapshot (${error}) — breaker, health and deploy state are unknown.`}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 44, minWidth: 44,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 14px', borderRadius: 6,
              border: `1px solid ${colors.danger}`, background: 'transparent',
              color: colors.danger, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isHi ? 'पुनः प्रयास करें' : 'Retry'}
          </button>
        )}
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div style={{
        display: 'flex', gap: 16, padding: '10px 16px', marginBottom: 16,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 8, fontSize: 12, color: colors.text3,
      }}>
        Loading snapshot...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', gap: 20, padding: '10px 16px', marginBottom: 16,
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: 8, fontSize: 12, flexWrap: 'wrap', alignItems: 'center',
    }}>
      {/* Breaker State */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusDot color={breakerColor(data.breakerState)} />
        <span style={{ fontWeight: 600, color: colors.text1 }}>AI Breaker</span>
        <span style={{ color: colors.text2 }}>{data.breakerState}</span>
        <span style={{ color: colors.text3, fontSize: 11 }}>({data.breakerReason})</span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: colors.border }} />

      {/* Health Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusDot color={healthColor(data.healthStatus)} />
        <span style={{ fontWeight: 600, color: colors.text1 }}>Health</span>
        <span style={{ color: colors.text2 }}>{data.healthStatus}</span>
        {data.healthAgeSeconds != null && (
          <span style={{ color: colors.text3, fontSize: 11 }}>({formatAge(data.healthAgeSeconds)})</span>
        )}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: colors.border }} />

      {/* Last Deploy */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, color: colors.text1 }}>Deploy</span>
        {data.lastDeploy ? (
          <>
            <code style={{ fontSize: 11, color: colors.accent, background: colors.accentLight, padding: '1px 6px', borderRadius: 3 }}>
              {data.lastDeploy.git_sha.slice(0, 7)}
            </code>
            <span style={{ color: colors.text3, fontSize: 11 }}>
              {formatDeployTime(data.lastDeploy.occurred_at)} / {data.lastDeploy.environment}
            </span>
          </>
        ) : (
          <span style={{ color: colors.text3 }}>none</span>
        )}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: colors.border }} />

      {/* Event Counts (1h) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, color: colors.text1 }}>1h</span>
        <span style={{ color: colors.text3 }}>{data.eventCounts.info} info</span>
        <span style={{ color: colors.warning }}>{data.eventCounts.warning} warn</span>
        <span style={{ color: colors.danger }}>{data.eventCounts.error} err</span>
        {data.eventCounts.critical > 0 && (
          <span style={{ color: colors.danger, fontWeight: 700 }}>{data.eventCounts.critical} crit</span>
        )}
      </div>
    </div>
  );
}
