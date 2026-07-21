'use client';

/**
 * MasteryDistributionCard — Phase 2 Task 2.1. School-wide mastery-band
 * DonutChart for the Command Center. Lazy-loaded via next/dynamic from
 * CommandCenter.tsx (P10) exactly like its sibling panels.
 *
 * Data source: the SAME `get_classes_at_risk` rows already fetched for
 * ClassesAtRiskRail (no new API call, no new RPC, no new migration). Each row
 * carries `student_count` and `at_risk_count`, where at_risk_count is the
 * EXACT count of students whose average BKT p_know < 0.4 (the established
 * AT_RISK_PKNOW_THRESHOLD documented in migration
 * `20260614000000_phase3b_school_command_center_read_models.sql` and reused
 * verbatim here — no new threshold invented).
 *
 * Band choice (2, not 3): the RPC returns only the exact at-risk count per
 * class plus a class-level AVG(p_know); it does NOT return a per-student
 * breakdown of "developing" (>=0.4) vs "mastered" (>=0.8) — the other two
 * bands from the canonical 3-state model in
 * `packages/lib/src/cognitive-engine.ts` (classifyMasteryState: mastered
 * >=0.8, developing >=0.4, else building/at-risk). Synthesizing a
 * developing/mastered split from the class-level average would fabricate
 * student-level numbers that don't exist in the read model — so this card
 * renders the two bands the data ACTUALLY supports (At risk / On track),
 * both derived from the exact per-student p_know<0.4 predicate, and defers a
 * true 3-band split to a follow-up backend read-model RPC (see the Deferred
 * note in the Phase 2 task report — not fabricated here).
 *
 * Boundary discipline (frontend): 100% read-only, no mutations, no new
 * business-logic thresholds. Reuses the existing NoDataState/skeleton/error-
 * retry pattern already established by ClassesAtRiskRail/CommandCenter.
 */

import { DonutChart, type DonutSlice } from '@alfanumrik/ui/admin-ui/charts';
import type { ClassAtRiskRow } from '@alfanumrik/lib/school-admin/command-center-types';
import { Card } from '@alfanumrik/ui/ui/primitives';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface MasteryDistributionCardProps {
  rows: ClassAtRiskRow[];
  loading: boolean;
  error: boolean;
  isHi: boolean;
  onRetry: () => void;
}

export default function MasteryDistributionCard({
  rows,
  loading,
  error,
  isHi,
  onRetry,
}: MasteryDistributionCardProps) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.atRisk += row.at_risk_count;
      acc.total += row.student_count;
      return acc;
    },
    { atRisk: 0, total: 0 },
  );
  const onTrack = Math.max(0, totals.total - totals.atRisk);

  const slices: DonutSlice[] = [
    { name: tt(isHi, 'At risk', 'जोखिम में'), value: totals.atRisk },
    { name: tt(isHi, 'On track', 'सही राह पर'), value: onTrack },
  ];

  return (
    <Card
      variant="elevated"
      aria-label={tt(isHi, 'Mastery distribution', 'महारत वितरण')}
      className="p-4"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
          {tt(isHi, 'Mastery distribution', 'महारत वितरण')}
        </h3>
      </header>

      {loading ? (
        <div
          className="rounded-xl bg-[var(--surface-2)] animate-pulse"
          style={{ height: 240 }}
          aria-hidden="true"
        />
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--text-2)] mb-3">
            {tt(
              isHi,
              "Couldn't load mastery distribution.",
              'महारत वितरण लोड नहीं हो सका।',
            )}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-transform min-h-[44px]"
          >
            {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        </div>
      ) : (
        <DonutChart
          data={slices}
          height={240}
          emptyLabel={tt(isHi, 'No mastery data yet', 'अभी कोई महारत डेटा नहीं')}
        />
      )}
    </Card>
  );
}
