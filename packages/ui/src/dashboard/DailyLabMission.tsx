'use client';

/**
 * DailyLabMission — Tier 2 R8 dashboard card.
 *
 * Surfaces a deterministic, grade-appropriate "Daily Lab Mission" pulled from
 * /api/student/daily-lab. The card is intentionally lightweight (no heavy
 * dependencies) to honour the dashboard's bundle budget; total payload of this
 * component is under 2 kB minified.
 *
 * Responsive grid: full-width on mobile, half on sm, third on lg — composed
 * via the dashboard's existing Tailwind grid wrappers.
 *
 * Bilingual via the AuthContext `isHi` flag — title falls back to English when
 * the simulation has no Hindi label (mostly for DB-driven sims).
 *
 * Completed-state: when the API reports `completed_today=true` the card
 * collapses to a single green confirmation line. No claim button is rendered
 * here — the bonus is claimed automatically by the celebration overlay in
 * /stem-centre after the student finishes the lab.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DailyLabResponse {
  simulation_id: string;
  experiment_id: string | null;
  title: string;
  title_hi: string;
  subject: string;
  emoji: string;
  estimated_minutes: number;
  bonus_coins: number;
  deeplink: string;
  completed_today: boolean;
}

const SUBJECT_LABEL_HI: Record<string, string> = {
  physics: 'भौतिकी',
  chemistry: 'रसायन',
  biology: 'जीव विज्ञान',
  math: 'गणित',
  science: 'विज्ञान',
  computer_science: 'कंप्यूटर',
  coding: 'कोडिंग',
};

export default function DailyLabMission({ isHi }: { isHi: boolean }) {
  const [data, setData] = useState<DailyLabResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/student/daily-lab', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setErrored(true);
          return;
        }
        const body = await res.json();
        if (!cancelled && body?.success && body?.data) setData(body.data as DailyLabResponse);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || errored || !data) return null;

  const title = isHi && data.title_hi ? data.title_hi : data.title;
  const subjectLabel = isHi
    ? (SUBJECT_LABEL_HI[data.subject] ?? data.subject)
    : data.subject.charAt(0).toUpperCase() + data.subject.slice(1);

  if (data.completed_today) {
    return (
      <div
        className="w-full rounded-2xl p-4 flex items-center gap-3"
        style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
        }}
        aria-label={isHi ? 'आज का लैब मिशन पूरा' : "Today's lab mission complete"}
      >
        <span className="text-2xl flex-shrink-0">{data.emoji}</span>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-bold text-green-700 truncate">
            {isHi ? 'आज का लैब पूरा!' : "Today's lab done!"}
          </div>
          <div className="text-xs text-[var(--text-3)] truncate">
            {isHi
              ? `+${data.bonus_coins} सिक्के मिले — कल नया मिशन`
              : `+${data.bonus_coins} coins earned — new mission tomorrow`}
          </div>
        </div>
        <span className="text-green-600 text-lg flex-shrink-0">&#10003;</span>
      </div>
    );
  }

  return (
    <Link
      href={data.deeplink}
      className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.98] min-h-[44px]"
      style={{
        background: 'linear-gradient(135deg, rgba(245,166,35,0.10), rgba(232,88,28,0.10))',
        border: '1px solid rgba(232,88,28,0.25)',
      }}
      aria-label={isHi ? 'आज का लैब मिशन शुरू करें' : "Start today's lab mission"}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden="true">{data.emoji}</span>
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
            {isHi ? 'आज का लैब मिशन' : "Today's Lab Mission"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
            🪙 +{data.bonus_coins}
          </span>
        </div>
        <div className="text-sm font-bold text-gray-900 truncate">{title}</div>
        <div className="text-xs text-[var(--text-3)] truncate">
          {subjectLabel} · ~{data.estimated_minutes}{isHi ? ' मिनट' : ' min'}
        </div>
      </div>
      <span className="text-orange-500 text-sm font-semibold flex-shrink-0">
        {isHi ? 'शुरू →' : 'Start →'}
      </span>
    </Link>
  );
}
