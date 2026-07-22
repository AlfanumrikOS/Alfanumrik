'use client';

/**
 * /super-admin/synthesis-health — Phase 8 item 8.4 dashboard.
 *
 * Renders Monthly-Synthesis WhatsApp delivery health: a trailing-24h summary
 * (with failure-rate), a 14-day per-day sent/failed/opted_out/flagged trend,
 * and the last 10 failures for triage. Fed by /api/super-admin/synthesis-health
 * which reads monthly_synthesis_runs status counts. The nightly
 * /api/cron/synthesis-delivery-monitor emits the CEO-email alert when the 24h
 * failure rate exceeds 20% over >= 5 attempts.
 *
 * P13: renders run ids, student ids, month labels, and timestamps ONLY. Never
 * the summary body, the bundle, the parent's phone, or the student's name.
 * P7: bilingual via AuthContext isHi.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import AdminShell, { useAdmin } from '../_components/AdminShell';

interface WindowCounts {
  sent: number;
  failed: number;
  opted_out: number;
  flagged: number;
  suppressed: number;
  pending: number;
  failure_rate_pct: number | null;
  opted_out_pct: number | null;
}

interface DailyCount {
  day: string;
  sent: number;
  failed: number;
  opted_out: number;
  flagged: number;
  suppressed: number;
  pending: number;
}

interface RecentFailure {
  synthesisRunId: string;
  studentId: string;
  synthesisMonth: string;
  createdAt: string;
}

interface DashboardData {
  window: WindowCounts;
  dailyCounts: DailyCount[];
  recentFailures: RecentFailure[];
}

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const TD_R = `${TD} text-right`;

function SynthesisHealthPageInner() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const t = (en: string, hi: string) => (isHi ? hi : en);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/synthesis-health');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { success: boolean; data: DashboardData };
      if (body.success) setData(body.data);
      else setError('API returned success=false');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading && !data) {
    return <p className="text-muted-foreground">{t('Loading delivery health…', 'डिलीवरी स्वास्थ्य लोड हो रहा है…')}</p>;
  }
  if (error || !data) {
    return (
      <div>
        <p className="text-danger">{error ?? t('No data', 'कोई डेटा नहीं')}</p>
        <button
          type="button"
          onClick={fetchDashboard}
          className="mt-3 rounded-md border border-surface-3 bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-3"
        >
          {t('Retry', 'पुनः प्रयास')}
        </button>
      </div>
    );
  }

  const w = data.window;
  const attempts = w.sent + w.failed;
  const failing = w.failure_rate_pct !== null && w.failure_rate_pct > 20 && attempts >= 5;
  const rateClass =
    w.failure_rate_pct === null
      ? 'text-muted-foreground'
      : w.failure_rate_pct > 20
        ? 'text-danger'
        : w.failure_rate_pct > 5
          ? 'text-warning'
          : 'text-success';

  const tiles: Array<{ label: string; value: number | string; klass?: string }> = [
    { label: t('Sent', 'भेजा गया'), value: w.sent, klass: 'text-success' },
    { label: t('Failed', 'विफल'), value: w.failed, klass: w.failed > 0 ? 'text-danger' : 'text-foreground' },
    { label: t('Opted out', 'ऑप्ट-आउट'), value: w.opted_out },
    { label: t('Flagged', 'चिह्नित'), value: w.flagged, klass: w.flagged > 0 ? 'text-warning' : 'text-foreground' },
    { label: t('Pending', 'लंबित'), value: w.pending },
    { label: t('Failure rate', 'विफलता दर'), value: w.failure_rate_pct === null ? '—' : `${w.failure_rate_pct}%`, klass: rateClass },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">
          {t('Monthly Synthesis — Delivery Health', 'मासिक संश्लेषण — डिलीवरी स्वास्थ्य')}
        </h1>
        <p className="mb-1.5 text-sm text-muted-foreground">
          {t(
            'WhatsApp delivery outcomes for the Claude-authored parent summary. The nightly monitor alerts the CEO email when the 24h failure rate exceeds 20% over 5+ attempts (the silent Meta-template-approval failure mode).',
            'क्लॉड-लिखित अभिभावक सारांश के WhatsApp डिलीवरी परिणाम। नाइटली मॉनिटर CEO ईमेल को अलर्ट करता है जब 24 घंटे की विफलता दर 5+ प्रयासों पर 20% से अधिक हो जाती है (मौन Meta-टेम्पलेट-अनुमोदन विफलता)।',
          )}
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          {t(`Trailing 24h: ${attempts} delivery attempt(s).`, `पिछले 24 घंटे: ${attempts} डिलीवरी प्रयास।`)}
        </p>
      </div>

      {/* Breach banner */}
      {failing && (
        <div className="mb-4 rounded-lg border border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-[13px] text-danger">
          {t(
            `⚠ Delivery failing: ${w.failure_rate_pct}% of ${attempts} attempts failed in the last 24h. Check the monthly_synthesis WhatsApp template approval status in Meta.`,
            `⚠ डिलीवरी विफल: पिछले 24 घंटों में ${attempts} में से ${w.failure_rate_pct}% प्रयास विफल हुए। Meta में monthly_synthesis WhatsApp टेम्पलेट अनुमोदन स्थिति जांचें।`,
          )}
        </div>
      )}

      {/* KPI tiles */}
      <section className="mb-5 grid grid-cols-6 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {tile.label}
            </div>
            <div className={`mt-1 text-[28px] font-bold ${tile.klass ?? 'text-foreground'}`}>{tile.value}</div>
            <div className="text-[11px] text-muted-foreground">{t('last 24h', 'पिछले 24 घंटे')}</div>
          </div>
        ))}
      </section>

      {/* Daily trend table */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('Daily delivery — last 14 days', 'दैनिक डिलीवरी — पिछले 14 दिन')}
        </h2>
        {data.dailyCounts.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            {t('No synthesis runs in the last 14 days.', 'पिछले 14 दिनों में कोई संश्लेषण रन नहीं।')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>{t('Day (UTC)', 'दिन (UTC)')}</th>
                  <th className={TH_R}>{t('Sent', 'भेजा')}</th>
                  <th className={TH_R}>{t('Failed', 'विफल')}</th>
                  <th className={TH_R}>{t('Opted out', 'ऑप्ट-आउट')}</th>
                  <th className={TH_R}>{t('Flagged', 'चिह्नित')}</th>
                  <th className={TH_R}>{t('Pending', 'लंबित')}</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyCounts.map((d) => (
                  <tr key={d.day}>
                    <td className={TD}>{d.day}</td>
                    <td className={TD_R}>{d.sent}</td>
                    <td className={`${TD_R} ${d.failed > 0 ? 'font-semibold text-danger' : ''}`}>{d.failed}</td>
                    <td className={TD_R}>{d.opted_out}</td>
                    <td className={`${TD_R} ${d.flagged > 0 ? 'text-warning' : ''}`}>{d.flagged}</td>
                    <td className={TD_R}>{d.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Last 10 failures — triage */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('Recent failures — last 10', 'हाल की विफलताएँ — अंतिम 10')}
        </h2>
        {data.recentFailures.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            {t('No delivery failures in the last 14 days.', 'पिछले 14 दिनों में कोई डिलीवरी विफलता नहीं।')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>{t('Created at', 'बनाया गया')}</th>
                  <th className={TH}>{t('Month', 'माह')}</th>
                  <th className={TH}>{t('Run ID', 'रन ID')}</th>
                  <th className={TH}>{t('Student ID', 'छात्र ID')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((r) => (
                  <tr key={r.synthesisRunId}>
                    <td className={`${TD} text-xs text-muted-foreground`}>
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className={TD}>{r.synthesisMonth}</td>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {r.synthesisRunId.slice(0, 8)}…
                    </td>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {r.studentId.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function SynthesisHealthPage() {
  return (
    <AdminShell>
      <SynthesisHealthPageInner />
    </AdminShell>
  );
}
