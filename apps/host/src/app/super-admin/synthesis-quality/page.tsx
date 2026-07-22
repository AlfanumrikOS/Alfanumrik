'use client';

/**
 * /super-admin/synthesis-quality — Phase 8 item 8.6 dashboard.
 *
 * Renders the Monthly-Synthesis LLM-as-judge signal: 7-day rolling averages,
 * prior-week delta (drift detector), per-day trend, and the 10 lowest-overall
 * scores in the last 30 days for human triage. Fed by
 * /api/super-admin/synthesis-quality which reads synthesis_quality_scores
 * (populated nightly by /api/cron/synthesis-quality-sample). Mirrors
 * /super-admin/foxy-quality.
 *
 * P13: never renders the summary body, the bundle, the phone, or the student
 * name. Rows are keyed on synthesis_run_id + student_id; findings are
 * counts-only. P7: bilingual via AuthContext isHi.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import AdminShell, { useAdmin } from '../_components/AdminShell';

interface AvgScores {
  overall: number;
  grounding: number;
  tone: number;
  noFabrication: number;
  scope: number;
}

interface DailyAverage {
  day: string;
  count: number;
  overall: number;
  grounding: number;
  tone: number;
  noFabrication: number;
  scope: number;
}

interface LowestScore {
  synthesisRunId: string;
  studentId: string;
  scoredAt: string;
  overall: number;
  grounding: number;
  tone: number;
  noFabrication: number;
  scope: number;
  oracleFindings: { unbacked_number_count?: number; unbacked_topic_count?: number };
  notes: string | null;
}

interface DashboardData {
  rubricVersion: string;
  totalScored: number;
  last7DayAvg: AvgScores | null;
  prev7DayAvg: AvgScores | null;
  weeklyDelta: number | null;
  dailyAverages: DailyAverage[];
  lowestRecent: LowestScore[];
}

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const TD_R = `${TD} text-right`;

function SynthesisQualityPageInner() {
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
      const res = await apiFetch('/api/super-admin/synthesis-quality');
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
    return <p className="text-muted-foreground">{t('Loading quality scores…', 'गुणवत्ता स्कोर लोड हो रहे हैं…')}</p>;
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

  const deltaClass =
    data.weeklyDelta === null
      ? 'text-muted-foreground'
      : data.weeklyDelta >= 0
        ? 'text-success'
        : data.weeklyDelta <= -10
          ? 'text-danger'
          : 'text-warning';

  const overallClass = (v: number) =>
    v < 50 ? 'text-danger' : v < 70 ? 'text-warning' : 'text-foreground';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">
          {t('Synthesis Quality (LLM-as-judge)', 'संश्लेषण गुणवत्ता (LLM-निर्णायक)')}
        </h1>
        <p className="mb-1.5 text-sm text-muted-foreground">
          {t(
            'Nightly Sonnet judge + deterministic oracle score the Claude-authored monthly parent summary on 4 dimensions: grounding (vs the SynthesisBundle), no-fabrication (oracle-authoritative), parent-readable tone, and CBSE scope. Composite uses 0.35 / 0.35 / 0.20 / 0.10 weights.',
            'नाइटली Sonnet निर्णायक + नियतात्मक ओरेकल क्लॉड-लिखित मासिक अभिभावक सारांश को 4 आयामों पर आंकते हैं: ग्राउंडिंग (SynthesisBundle के विरुद्ध), बिना-मनगढ़ंत (ओरेकल-आधिकारिक), अभिभावक-पठनीय टोन, और CBSE दायरा।',
          )}{' '}
          {t('Rubric:', 'रूब्रिक:')} <strong>{data.rubricVersion}</strong>.
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          {t(`${data.totalScored} summaries scored in the last 30 days.`, `पिछले 30 दिनों में ${data.totalScored} सारांश आंके गए।`)}
        </p>
      </div>

      {/* KPI tiles */}
      <section className="mb-5 grid grid-cols-5 gap-3">
        {([
          { label: t('Overall', 'कुल'), key: 'overall' },
          { label: t('Grounding', 'ग्राउंडिंग'), key: 'grounding' },
          { label: t('No-fabrication', 'बिना-मनगढ़ंत'), key: 'noFabrication' },
          { label: t('Tone', 'टोन'), key: 'tone' },
          { label: t('CBSE scope', 'CBSE दायरा'), key: 'scope' },
        ] as const).map(({ label, key }) => {
          const cur = data.last7DayAvg?.[key];
          const prev = data.prev7DayAvg?.[key];
          const delta = cur !== undefined && prev !== undefined ? cur - prev : null;
          const localDeltaClass =
            delta === null
              ? ''
              : key === 'overall'
                ? deltaClass
                : delta >= 0
                  ? 'text-success'
                  : delta <= -10
                    ? 'text-danger'
                    : 'text-warning';
          return (
            <div key={key} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-1 text-[28px] font-bold text-foreground">{cur ?? '—'}</div>
              <div className="text-[11px] text-muted-foreground">{t('last 7d avg', 'पिछले 7 दिन औसत')}</div>
              {delta !== null && (
                <div className={`mt-1 text-xs font-medium ${localDeltaClass}`}>
                  {delta > 0 ? '+' : ''}
                  {delta} {t('vs prev 7d', 'बनाम पिछले 7 दिन')}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Drift banner */}
      {data.weeklyDelta !== null && data.weeklyDelta <= -10 && (
        <div className="mb-4 rounded-lg border border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-[13px] text-danger">
          {t(
            `⚠ Quality drift: overall is ${data.weeklyDelta} points vs the prior 7 days. Investigate before widening the Monthly Synthesis rollout.`,
            `⚠ गुणवत्ता में गिरावट: कुल स्कोर पिछले 7 दिनों की तुलना में ${data.weeklyDelta} अंक है। मासिक संश्लेषण रोलआउट बढ़ाने से पहले जांच करें।`,
          )}
        </div>
      )}

      {/* Daily trend table */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('Daily averages — last 14 days', 'दैनिक औसत — पिछले 14 दिन')}
        </h2>
        {data.dailyAverages.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            {t('No scores yet. The nightly cron will populate this on the next run.', 'अभी कोई स्कोर नहीं। नाइटली क्रॉन अगली बार इसे भर देगा।')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>{t('Day (UTC)', 'दिन (UTC)')}</th>
                  <th className={TH_R}>{t('Count', 'संख्या')}</th>
                  <th className={TH_R}>{t('Overall', 'कुल')}</th>
                  <th className={TH_R}>{t('Grounding', 'ग्राउंडिंग')}</th>
                  <th className={TH_R}>{t('No-fab', 'बिना-मन')}</th>
                  <th className={TH_R}>{t('Tone', 'टोन')}</th>
                  <th className={TH_R}>{t('Scope', 'दायरा')}</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyAverages.map((d) => (
                  <tr key={d.day}>
                    <td className={TD}>{d.day}</td>
                    <td className={TD_R}>{d.count}</td>
                    <td className={`${TD_R} font-semibold`}>{d.overall}</td>
                    <td className={TD_R}>{d.grounding}</td>
                    <td className={TD_R}>{d.noFabrication}</td>
                    <td className={TD_R}>{d.tone}</td>
                    <td className={TD_R}>{d.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lowest 10 — triage queue */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('Lowest overall — last 30 days', 'सबसे कम कुल — पिछले 30 दिन')}
        </h2>
        {data.lowestRecent.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            {t('Nothing scored yet.', 'अभी कुछ भी आंका नहीं गया।')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>{t('Scored at', 'आंका गया')}</th>
                  <th className={TH_R}>{t('Overall', 'कुल')}</th>
                  <th className={TH_R}>{t('Grnd', 'ग्रा')}</th>
                  <th className={TH_R}>{t('No-fab', 'बिना')}</th>
                  <th className={TH_R}>{t('Tone', 'टोन')}</th>
                  <th className={TH_R}>{t('Scope', 'दायरा')}</th>
                  <th className={TH}>{t('Judge note', 'निर्णायक टिप्पणी')}</th>
                  <th className={TH}>{t('Run', 'रन')}</th>
                </tr>
              </thead>
              <tbody>
                {data.lowestRecent.map((r) => (
                  <tr key={r.synthesisRunId}>
                    <td className={`${TD} text-xs text-muted-foreground`}>
                      {new Date(r.scoredAt).toLocaleString()}
                    </td>
                    <td className={`${TD_R} font-bold ${overallClass(r.overall)}`}>{r.overall}</td>
                    <td className={TD_R}>{r.grounding}</td>
                    <td className={`${TD_R} ${r.noFabrication === 0 ? 'font-bold text-danger' : ''}`}>{r.noFabrication}</td>
                    <td className={TD_R}>{r.tone}</td>
                    <td className={TD_R}>{r.scope}</td>
                    <td className={`${TD} max-w-[320px] text-xs text-muted-foreground`}>
                      {r.notes ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {r.synthesisRunId.slice(0, 8)}…
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

export default function SynthesisQualityPage() {
  return (
    <AdminShell>
      <SynthesisQualityPageInner />
    </AdminShell>
  );
}
