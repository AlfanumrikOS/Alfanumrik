import { useEffect, useState } from 'react';
import { NoDataState, StalenessTag } from '@alfanumrik/ui/admin-ui';
import { getFeatureFlags } from '@alfanumrik/lib/supabase';
import { EDUCATION_INTELLIGENCE_FLAGS } from '@alfanumrik/lib/feature-flags';

export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

export function bandVariant(score: number | null | undefined): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (score == null || !Number.isFinite(score)) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'info';
  if (score >= 40) return 'warning';
  return 'danger';
}

export const NEW_MRR_CAVEAT =
  'v1 approximation — expansion revenue is folded into New MRR. Not yet separated from net-new logos.';
export const CHURN_SIGNAL_CAVEAT =
  'Payment-failure churn signal covers B2C subscriptions only. B2B/institutional churn is inferred from engagement, not billing.';

export function Caveat({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="ml-1 inline-flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full border border-surface-3 text-[9px] font-bold text-muted-foreground align-middle"
    >
      ⓘ
    </span>
  );
}

function RollupDate({ date }: { date: string | null }) {
  if (!date) return null;
  return (
    <span className="ml-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wider">Latest rollup</span>
      <span className="font-semibold text-foreground">{date}</span>
    </span>
  );
}

export function EICHeader({
  title,
  subtitle,
  rollupDate,
  generatedAt,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  rollupDate: string | null;
  generatedAt: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <div className="flex flex-wrap items-center">
          <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <RollupDate date={rollupDate} />
          {generatedAt && (
            <span className="ml-2">
              <StalenessTag lastUpdated={new Date(generatedAt)} />
            </span>
          )}
        </div>
        <p className="m-0 mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      <button
        onClick={onRefresh}
        className="shrink-0 rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
      >
        ↻ Refresh
      </button>
    </div>
  );
}

export function EICEmpty() {
  return (
    <NoDataState
      reason="no_data"
      title="No intelligence data yet"
      message="The nightly rollup tables have not been populated. Data appears after the first nightly job runs post-migration."
    />
  );
}

export function useEducationIntelligenceFlag(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((flags) => { if (!cancelled) setEnabled(Boolean(flags[EDUCATION_INTELLIGENCE_FLAGS.V1])); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  return enabled;
}
