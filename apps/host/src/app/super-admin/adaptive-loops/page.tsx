'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { StatCard, StatusBadge, AdminErrorState } from '@alfanumrik/ui/admin-ui';
import { AdminDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

// Neutral palette mapped to brand tokens (matches the diagnostics page).
const colors = {
  bg: 'var(--surface-1)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  border: 'var(--border)',
  borderLight: 'var(--surface-2)',
  surface: 'var(--surface-2)',
  accent: '#2563EB',
  success: 'var(--success)',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  danger: 'var(--danger)',
  dangerLight: '#FEF2F2',
} as const;

const S = {
  h2: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  } as React.CSSProperties,
  card: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
  } as React.CSSProperties,
};

// Aggregate-only health shape returned by /api/super-admin/adaptive-loops
// (get_adaptive_loops_health RPC — counts / ratios / timestamps only, P13).
interface AdaptiveLoopsHealth {
  window_hours: number;
  storm_days: number;
  daily_new_by_signal: {
    mastery_cliff: number;
    inactivity: number;
    at_risk_concentration: number;
    blocked_prerequisite: number;
  };
  daily_new_total: number;
  ceiling_violation_count: number;
  ceiling_violation_students: number;
  terminal_total: number;
  escalation_total: number;
  escalation_share: number;
  last_success_at: string | null;
  hours_since_last_success: number | null;
  generated_at: string;
}

// Loop labels (bilingual). trigger_signal is a technical column name — the
// human-facing label is translated; the loop letter + the signal code are not.
const SIGNAL_META: Array<{
  key: keyof AdaptiveLoopsHealth['daily_new_by_signal'];
  loop: string;
  en: string;
  hi: string;
}> = [
  { key: 'mastery_cliff', loop: 'A', en: 'Mastery cliff', hi: 'महारत गिरावट' },
  { key: 'inactivity', loop: 'B', en: 'Inactivity', hi: 'निष्क्रियता' },
  { key: 'at_risk_concentration', loop: 'C', en: 'At-risk concentration', hi: 'जोखिम संकेंद्रण' },
  { key: 'blocked_prerequisite', loop: 'D', en: 'Blocked prerequisite', hi: 'अवरुद्ध पूर्वापेक्षा' },
];

const HEARTBEAT_STALE_HOURS = 26;
const ESCALATION_STORM_PCT = 50;

function AdaptiveLoopsContent() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const [health, setHealth] = useState<AdaptiveLoopsHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/adaptive-loops');
      if (!res.ok) {
        throw new Error(
          isHi
            ? `अनुरोध विफल (HTTP ${res.status})`
            : `Request failed (HTTP ${res.status})`,
        );
      }
      const d = await res.json();
      if (!d.success || !d.data) {
        throw new Error(d.error || (isHi ? 'डेटा लोड नहीं हो सका' : 'Could not load data'));
      }
      setHealth(d.data as AdaptiveLoopsHealth);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : isHi
            ? 'अनुकूली लूप स्वास्थ्य लोड करने में विफल'
            : 'Failed to load adaptive loops health',
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, isHi]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (loading && !health) {
    return (
      <AdminDashboardSkeleton
        label={isHi ? 'अनुकूली लूप स्वास्थ्य लोड हो रहा है…' : 'Loading adaptive loops health…'}
      />
    );
  }

  if (error && !health) {
    return <AdminErrorState onRetry={fetchHealth} message={error} isHi={isHi} />;
  }

  const ceilingBreached = (health?.ceiling_violation_count ?? 0) > 0;
  const escalationPct = health ? health.escalation_share * 100 : 0;
  const stormBreached = escalationPct > ESCALATION_STORM_PCT;
  const hoursSince = health?.hours_since_last_success ?? null;
  const heartbeatStale = hoursSince === null || hoursSince > HEARTBEAT_STALE_HOURS;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground mb-1">
            {isHi ? 'अनुकूली लूप स्वास्थ्य' : 'Adaptive Loops Health'}
          </h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            {isHi
              ? 'लूप A/B/C/D निर्माण-दर, सीमा उल्लंघन, एस्केलेशन हिस्सा, और नाइटली क्रॉन हार्टबीट'
              : 'Loops A/B/C/D creation rate, ceiling violations, escalation share, and nightly cron heartbeat'}
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          {isHi ? 'रीफ्रेश' : 'Refresh'}
        </button>
      </div>

      {/* Partial-failure banner. */}
      {error && health && <AdminErrorState compact onRetry={fetchHealth} message={error} isHi={isHi} />}

      {health && (
        <>
          {/* Ceiling violation — the top alert. Prominent red banner when > 0. */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              padding: '12px 16px',
              background: ceilingBreached ? colors.dangerLight : colors.successLight,
              border: `1px solid ${ceilingBreached ? '#FECACA' : '#BBF7D0'}`,
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <StatusBadge
              label={
                ceilingBreached
                  ? isHi
                    ? 'सीमा उल्लंघन का पता चला'
                    : 'Ceiling violation detected'
                  : isHi
                    ? 'सीमा बरकरार (≤1/छात्र/दिन)'
                    : 'Ceiling holding (≤1/student/day)'
              }
              variant={ceilingBreached ? 'danger' : 'success'}
            />
            <span style={{ fontSize: 12, color: colors.text2 }}>
              {ceilingBreached
                ? isHi
                  ? `पिछले 7 दिनों में ${health.ceiling_violation_count} उल्लंघन (${health.ceiling_violation_students} छात्र) — मध्यस्थ की ≤1/छात्र/रात गारंटी विफल`
                  : `${health.ceiling_violation_count} violation(s) across ${health.ceiling_violation_students} student(s) in the last 7 days — the arbiter's ≤1/student/night guarantee is not holding`
                : isHi
                  ? 'पिछले 7 दिनों में कोई प्रति-छात्र सीमा उल्लंघन नहीं'
                  : 'No per-student ceiling violations in the last 7 days'}
            </span>
          </div>

          {/* Daily-new by signal (Loops A/B/C/D). */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={S.h2}>
              {isHi
                ? `दैनिक नई हस्तक्षेप (पिछले ${health.window_hours}घं)`
                : `Daily-new interventions (last ${health.window_hours}h)`}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {SIGNAL_META.map((s) => (
                <StatCard
                  key={s.key}
                  label={`${isHi ? s.hi : s.en} · Loop ${s.loop}`}
                  value={health.daily_new_by_signal[s.key]}
                  accentColor={colors.accent}
                />
              ))}
              <StatCard
                label={isHi ? 'कुल नई' : 'Total new'}
                value={health.daily_new_total}
                accentColor={colors.text3}
              />
            </div>
          </div>

          {/* Escalation share + heartbeat. */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={S.h2}>{isHi ? 'एस्केलेशन और क्रॉन स्वास्थ्य' : 'Escalation & cron health'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {/* Escalation share */}
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>
                    {isHi ? 'एस्केलेशन हिस्सा' : 'Escalation share'}
                  </div>
                  <StatusBadge
                    label={stormBreached ? (isHi ? 'तूफान (>50%)' : 'Storm (>50%)') : isHi ? 'सामान्य' : 'Normal'}
                    variant={stormBreached ? 'danger' : 'success'}
                  />
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: stormBreached ? colors.danger : colors.text1, lineHeight: 1.2 }}>
                  {escalationPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                  {isHi
                    ? `${health.storm_days} दिनों में ${health.escalation_total}/${health.terminal_total} टर्मिनल परिणाम`
                    : `${health.escalation_total}/${health.terminal_total} terminal outcomes over ${health.storm_days}d`}
                </div>
              </div>

              {/* Cron last-success heartbeat */}
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>
                    {isHi ? 'नाइटली क्रॉन हार्टबीट' : 'Nightly cron heartbeat'}
                  </div>
                  <StatusBadge
                    label={heartbeatStale ? (isHi ? 'बासी (>26घं)' : 'Stale (>26h)') : isHi ? 'ताज़ा' : 'Fresh'}
                    variant={heartbeatStale ? 'danger' : 'success'}
                  />
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: heartbeatStale ? colors.danger : colors.text1, lineHeight: 1.2 }}>
                  {hoursSince === null ? (isHi ? 'कभी नहीं' : 'Never') : `${hoursSince.toFixed(1)}h`}
                </div>
                <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                  {health.last_success_at
                    ? `${isHi ? 'अंतिम सफल रन' : 'Last successful run'}: ${new Date(health.last_success_at).toLocaleString()}`
                    : isHi
                      ? 'कोई सफल रन दर्ज नहीं'
                      : 'No successful run recorded'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: colors.text3 }}>
            {isHi ? 'उत्पन्न' : 'Generated'}: {new Date(health.generated_at).toLocaleString()}
            {' · '}
            {isHi
              ? 'केवल समग्र गणना (कोई छात्र PII नहीं)'
              : 'Aggregate counts only (no student PII)'}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdaptiveLoopsPage() {
  return (
    <AdminShell>
      <AdaptiveLoopsContent />
    </AdminShell>
  );
}
