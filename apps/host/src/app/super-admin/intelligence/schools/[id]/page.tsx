'use client';

/**
 * /super-admin/intelligence/schools/[id] — EIC · School profile
 *
 * Consumes GET /api/super-admin/intelligence/school/[id]. Flag-gated by
 * ff_education_intelligence (notFound when OFF). English-only.
 *
 * Header (tier + composite + churn badge, red alert banner when band
 * high/critical), 5 pillar StatCards, composite + MRR history line charts,
 * churn detail (risk_score, band, reasons[], days_to_renewal).
 */

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { notFound, useParams } from 'next/navigation';
import AdminShell, { useAdmin } from '../../../_components/AdminShell';
import { StatCard, StatusBadge } from '@alfanumrik/ui/admin-ui';
import {
  formatINR,
  EICHeader,
  EICEmpty,
  Caveat,
  CHURN_SIGNAL_CAVEAT,
  useEducationIntelligenceFlag,
} from '../../shared';

const LineChart = dynamic(() => import('@alfanumrik/ui/admin-ui').then((m) => m.LineChart), { ssr: false });

const TIER_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  elite: 'success', healthy: 'info', needs_attention: 'warning', critical: 'danger',
};
const CHURN_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  low: 'success', medium: 'warning', high: 'danger', critical: 'danger',
};

function pillarAccent(score: number | null): string {
  if (score == null) return '#6B7280';
  if (score >= 80) return '#16A34A';
  if (score >= 60) return '#2563EB';
  if (score >= 40) return '#D97706';
  return '#DC2626';
}

interface HealthPoint {
  score_date: string;
  composite_score: number | null;
  tier: string | null;
  adoption_score: number | null;
  engagement_score: number | null;
  outcomes_score: number | null;
  retention_score: number | null;
  usage_score: number | null;
}
interface ChurnPoint {
  score_date: string;
  risk_score: number;
  risk_band: string | null;
  reasons: string[];
}
interface MrrPoint {
  snapshot_date: string;
  mrr: number;
  arr: number;
  seats_purchased: number;
}
interface SchoolDetail {
  school: { id: string; name: string | null; city: string | null; state: string | null };
  health_history: HealthPoint[];
  churn_history: ChurnPoint[];
  mrr_history: MrrPoint[];
  days_to_renewal?: number | null;
}

const PILLARS: { key: keyof HealthPoint; label: string }[] = [
  { key: 'adoption_score', label: 'Adoption' },
  { key: 'engagement_score', label: 'Engagement' },
  { key: 'outcomes_score', label: 'Outcomes' },
  { key: 'retention_score', label: 'Retention' },
  { key: 'usage_score', label: 'Usage' },
];

function SchoolDetailContent({ id }: { id: string }) {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/intelligence/school/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !data) return <div className="p-10 text-center text-muted-foreground">Loading school profile…</div>;
  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="mb-3 text-sm text-danger">{error}</div>
        <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const latestHealth = data.health_history[data.health_history.length - 1] ?? null;
  const latestChurn = data.churn_history[data.churn_history.length - 1] ?? null;
  const latestMrr = data.mrr_history[data.mrr_history.length - 1] ?? null;
  const daysToRenewal = data.days_to_renewal ?? null;
  const band = latestChurn?.risk_band ?? null;
  const showAlert = band === 'high' || band === 'critical';

  const hasData = data.health_history.length > 0 || data.churn_history.length > 0 || data.mrr_history.length > 0;

  return (
    <div>
      <a href="/super-admin/intelligence/schools" className="mb-3 inline-block text-[12px] text-muted-foreground hover:text-foreground">← Back to schools</a>

      <EICHeader
        title={data.school.name ?? `School ${id.slice(0, 8)}`}
        subtitle={`${data.school.city ?? '—'}${data.school.state ? `, ${data.school.state}` : ''}`}
        rollupDate={latestHealth?.score_date ?? latestMrr?.snapshot_date ?? null}
        generatedAt={null}
        onRefresh={fetchData}
      />

      {/* Header status row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge label={latestHealth?.tier ?? '—'} variant={TIER_VARIANT[latestHealth?.tier ?? ''] ?? 'neutral'} />
        <span className="text-sm text-foreground">
          Composite <strong className="tabular-nums">{latestHealth?.composite_score ?? '—'}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {band === 'critical' && <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />}
          <StatusBadge label={`Churn: ${band ?? '—'}`} variant={CHURN_VARIANT[band ?? ''] ?? 'neutral'} />
        </span>
        {latestMrr && <span className="text-sm text-foreground">MRR <strong>{formatINR(latestMrr.mrr)}</strong></span>}
      </div>

      {/* Red alert banner */}
      {showAlert && (
        <div className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_5%,transparent)] p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-danger">
            <span aria-hidden>⚠</span>
            Churn alert — {band} risk
            {daysToRenewal != null && <span>· renewal in {daysToRenewal} days</span>}
          </div>
          {latestChurn && latestChurn.reasons.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[13px] text-foreground">
              {latestChurn.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          <p className="m-0 mt-2 text-[11px] text-muted-foreground"><Caveat text={CHURN_SIGNAL_CAVEAT} /> {CHURN_SIGNAL_CAVEAT}</p>
        </div>
      )}

      {!hasData && <div className="mb-6"><EICEmpty /></div>}

      {/* 5 pillar StatCards */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Health Pillars (latest)</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {PILLARS.map(p => {
          const v = (latestHealth?.[p.key] as number | null) ?? null;
          return <StatCard key={String(p.key)} label={p.label} value={v ?? '—'} accentColor={pillarAccent(v)} subtitle="0-100" />;
        })}
      </div>

      {/* History charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Composite Health (30d)</h2>
          <LineChart
            series={[{
              name: 'Composite',
              data: data.health_history
                .filter(h => h.composite_score != null)
                .map(h => ({ x: h.score_date, y: h.composite_score as number })),
            }]}
          />
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">MRR (30d)</h2>
          <LineChart
            series={[{ name: 'MRR', data: data.mrr_history.map(m => ({ x: m.snapshot_date, y: m.mrr })) }]}
          />
        </div>
      </div>

      {/* Churn detail */}
      <div className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Churn Detail <Caveat text={CHURN_SIGNAL_CAVEAT} />
        </h2>
        {latestChurn ? (
          <div className="space-y-2 text-sm text-foreground">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <span>Risk score: <strong className="tabular-nums">{Math.round(latestChurn.risk_score)}</strong></span>
              <span>Band: <StatusBadge label={latestChurn.risk_band ?? '—'} variant={CHURN_VARIANT[latestChurn.risk_band ?? ''] ?? 'neutral'} /></span>
              <span>Days to renewal: <strong className={daysToRenewal != null && daysToRenewal <= 30 ? 'text-danger' : ''}>{daysToRenewal ?? '—'}</strong></span>
            </div>
            {latestChurn.reasons.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Reasons</div>
                <table className="w-full border-collapse text-[13px]">
                  <tbody>
                    {latestChurn.reasons.map((r, i) => (
                      <tr key={i} className="border-b border-surface-3"><td className="py-1.5">{r}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <EICEmpty />
        )}
      </div>
    </div>
  );
}

export default function SchoolProfilePage() {
  const flag = useEducationIntelligenceFlag();
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  if (flag === false) notFound();
  return (
    <AdminShell>
      {flag === null
        ? <div className="p-10 text-center text-muted-foreground">Loading…</div>
        : <SchoolDetailContent id={id} />}
    </AdminShell>
  );
}
