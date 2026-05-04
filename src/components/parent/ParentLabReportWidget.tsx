'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Bilingual helper (P7) ─────────────────────────────────────
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ─── Props ─────────────────────────────────────────────────────
export interface ParentLabReportWidgetProps {
  studentId: string;
  studentName: string;
  isHi: boolean;
  /** Optional: handler for the empty-state CTA. If omitted, widget renders an <a href="/parent/calendar">. */
  onScheduleClick?: () => void;
}

// ─── Row shapes ─────────────────────────────────────────────────
interface ObservationRow {
  id: string;
  simulation_id: string;
  observation_type: 'simple' | 'guided' | string;
  observation_text: string | null;
  quiz_score: number | null;
  total_questions: number | null;
  time_spent_seconds: number | null;
  created_at: string;
}

interface StreakRow {
  current_streak: number;
  longest_streak: number;
  total_experiments: number;
  total_guided: number;
  total_viva_score: number;
  total_viva_max: number;
}

// ─── Inline lookup for built-in simulation labels ───────────────
// Keeping this tiny avoids importing the full simulations registry
// (which dynamic-imports 100+ components and would blow the bundle budget).
// For unknown IDs we slug-prettify the suffix as a graceful fallback.
const SIM_LABELS: Record<string, { title: string; titleHi: string; emoji: string }> = {
  'builtin-ohms-law':       { title: "Ohm's Law Lab",            titleHi: 'ओम का नियम',           emoji: '⚡' },
  'builtin-pendulum':       { title: 'Pendulum Lab',              titleHi: 'पेंडुलम लैब',          emoji: '🕒' },
  'builtin-lens-ray':       { title: 'Lens Ray Diagrams',         titleHi: 'लेंस किरण',             emoji: '🔍' },
  'builtin-wave':           { title: 'Wave on a String',          titleHi: 'तरंग प्रयोग',           emoji: '〰️' },
  'builtin-projectile':     { title: 'Projectile Motion',         titleHi: 'प्रक्षेप्य गति',         emoji: '🎯' },
  'builtin-ph-scale':       { title: 'pH Scale Explorer',         titleHi: 'pH मापक',              emoji: '🧪' },
  'builtin-pythagoras':     { title: 'Pythagoras Theorem',        titleHi: 'पाइथागोरस प्रमेय',     emoji: '📐' },
  'builtin-fractions':      { title: 'Pizza Fraction Lab',        titleHi: 'भिन्न प्रयोग',          emoji: '🍕' },
  'builtin-newton-laws':    { title: "Newton's Laws Lab",         titleHi: 'न्यूटन के नियम',       emoji: '🍎' },
  'builtin-bohr':           { title: 'Bohr Atom Model',           titleHi: 'बोर परमाणु',            emoji: '⚛️' },
  'builtin-photosynthesis': { title: 'Photosynthesis Lab',        titleHi: 'प्रकाश संश्लेषण',       emoji: '🌱' },
  'builtin-heart':          { title: 'Human Heart Lab',           titleHi: 'मानव हृदय',            emoji: '❤️' },
  'builtin-circuit':        { title: 'Electric Circuit',          titleHi: 'विद्युत परिपथ',         emoji: '🔌' },
  'builtin-magnet':         { title: 'Magnet Field Lines',        titleHi: 'चुंबकीय क्षेत्र',       emoji: '🧲' },
  'builtin-light-reflect':  { title: 'Light Reflection',          titleHi: 'प्रकाश परावर्तन',      emoji: '💡' },
  'builtin-cell':           { title: 'Cell Structure',            titleHi: 'कोशिका संरचना',         emoji: '🧬' },
};

function prettifySimId(id: string): string {
  // Strip 'builtin-' prefix, replace dashes, title-case.
  const stripped = id.replace(/^builtin-/, '').replace(/[-_]+/g, ' ').trim();
  if (!stripped) return id;
  return stripped.replace(/\b\w/g, c => c.toUpperCase());
}

function getSimLabel(id: string, isHi: boolean): { title: string; emoji: string } {
  const known = SIM_LABELS[id];
  if (known) return { title: isHi ? known.titleHi : known.title, emoji: known.emoji };
  return { title: prettifySimId(id), emoji: '🔬' };
}

// ─── Time helpers ───────────────────────────────────────────────
function relativeDate(iso: string, isHi: boolean): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days <= 0) return t(isHi, 'Today', 'आज');
  if (days === 1) return t(isHi, 'Yesterday', 'कल');
  if (days < 7) return t(isHi, `${days} days ago`, `${days} दिन पहले`);
  const weeks = Math.floor(days / 7);
  return t(isHi, `${weeks}w ago`, `${weeks} सप्ताह पहले`);
}

function formatDuration(seconds: number | null, isHi: boolean): string {
  const s = Math.max(0, seconds ?? 0);
  if (s < 60) return `${s}${t(isHi, 's', 'से')}`;
  const m = Math.floor(s / 60);
  return `${m}${t(isHi, 'm', 'मि')}`;
}

function truncate(text: string | null, max = 80): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + '…';
}

// ─── Skeleton ───────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 border border-orange-200">
      <div className="h-5 w-44 bg-orange-100 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <div className="h-16 bg-orange-50 rounded-xl animate-pulse" />
        <div className="h-16 bg-orange-50 rounded-xl animate-pulse" />
        <div className="h-16 bg-orange-50 rounded-xl animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-12 bg-gray-50 rounded-xl animate-pulse" />
        <div className="h-12 bg-gray-50 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}

// ─── Main widget ────────────────────────────────────────────────
export default function ParentLabReportWidget({
  studentId,
  studentName,
  isHi,
  onScheduleClick,
}: ParentLabReportWidgetProps) {
  const [obs, setObs] = useState<ObservationRow[]>([]);
  const [weekCount, setWeekCount] = useState(0);
  const [streak, setStreak] = useState<StreakRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sinceIso = sevenDaysAgo.toISOString();

      // Two parallel queries — RLS handles authorization.
      const [recentRes, countRes, streakRes] = await Promise.all([
        supabase
          .from('experiment_observations')
          .select('id, simulation_id, observation_type, observation_text, quiz_score, total_questions, time_spent_seconds, created_at')
          .eq('student_id', studentId)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('experiment_observations')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId)
          .gte('created_at', sinceIso),
        supabase
          .from('student_lab_streaks')
          .select('current_streak, longest_streak, total_experiments, total_guided, total_viva_score, total_viva_max')
          .eq('student_id', studentId)
          .maybeSingle(),
      ]);

      if (recentRes.error) throw recentRes.error;
      if (countRes.error) throw countRes.error;
      if (streakRes.error) throw streakRes.error;

      setObs((recentRes.data || []) as ObservationRow[]);
      setWeekCount(countRes.count ?? 0);
      setStreak((streakRes.data as StreakRow | null) ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-red-200">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-[15px] sm:text-base font-semibold text-gray-900">
            {t(isHi, '🔬 Lab Activity — This Week', '🔬 लैब गतिविधि — इस सप्ताह')}
          </h3>
        </div>
        <p className="text-sm text-red-600 mb-3">
          {t(isHi, "Couldn't load lab activity. Try again.", 'लैब गतिविधि लोड नहीं हो सकी। पुनः प्रयास करें।')}
        </p>
        <button
          onClick={load}
          className="min-h-[44px] px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-semibold cursor-pointer hover:bg-red-100"
        >
          {t(isHi, 'Retry', 'पुनः प्रयास')}
        </button>
      </div>
    );
  }

  // Avg viva % from cumulative streak counters (shown only when there's data).
  const vivaMax = streak?.total_viva_max ?? 0;
  const vivaScore = streak?.total_viva_score ?? 0;
  const vivaPct = vivaMax > 0 ? Math.round((vivaScore / vivaMax) * 100) : null;
  const currentStreak = streak?.current_streak ?? 0;

  const isEmpty = obs.length === 0 && weekCount === 0;

  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 border border-orange-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-[15px] sm:text-base font-semibold text-gray-900">
          {t(isHi, '🔬 Lab Activity — This Week', '🔬 लैब गतिविधि — इस सप्ताह')}
        </h3>
        <span className="text-[11px] text-gray-500 hidden sm:inline">
          {t(isHi, 'Last 7 days', 'पिछले 7 दिन')}
        </span>
      </div>

      {/* Empty state */}
      {isEmpty ? (
        <div className="text-center py-6 px-2">
          <div className="text-4xl mb-2" aria-hidden="true">{'🧪'}</div>
          <p className="text-[14px] text-gray-700 leading-relaxed mb-4 max-w-[320px] mx-auto">
            {t(
              isHi,
              `${studentName} hasn't done any labs yet. Encourage them with a lab challenge!`,
              `${studentName} ने अभी तक कोई प्रयोग नहीं किया है। उन्हें एक लैब चुनौती के लिए प्रेरित करें!`,
            )}
          </p>
          {onScheduleClick ? (
            <button
              onClick={onScheduleClick}
              className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold cursor-pointer hover:bg-orange-600"
            >
              {t(isHi, 'Schedule a lab →', 'एक लैब निर्धारित करें →')}
            </button>
          ) : (
            <a
              href="/parent/calendar"
              className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold no-underline hover:bg-orange-600"
            >
              {t(isHi, 'Schedule a lab →', 'एक लैब निर्धारित करें →')}
            </a>
          )}
        </div>
      ) : (
        <>
          {/* Stats: stack on mobile, 3-col on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            <div className="bg-orange-50 rounded-xl px-3 py-2.5 border border-orange-100">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">
                {t(isHi, 'Experiments', 'प्रयोग')}
              </div>
              <div className="text-xl font-bold text-orange-600">{weekCount}</div>
            </div>
            <div className="bg-amber-50 rounded-xl px-3 py-2.5 border border-amber-100">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">
                {t(isHi, 'Lab Streak', 'लैब स्ट्रीक')}
              </div>
              <div className="text-xl font-bold text-amber-600">
                {currentStreak}
                <span className="text-xs font-medium text-amber-500 ml-1">
                  {t(isHi, currentStreak === 1 ? 'day' : 'days', 'दिन')}
                </span>
              </div>
            </div>
            <div className="bg-purple-50 rounded-xl px-3 py-2.5 border border-purple-100">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">
                {t(isHi, 'Avg Viva', 'औसत वाइवा')}
              </div>
              <div className="text-xl font-bold text-purple-600">
                {vivaPct === null ? <span className="text-gray-400">—</span> : `${vivaPct}%`}
              </div>
            </div>
          </div>

          {/* Recent labs list */}
          {obs.length > 0 ? (
            <ul className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
              {obs.map(o => {
                const sim = getSimLabel(o.simulation_id, isHi);
                const isGuided = o.observation_type === 'guided';
                const hasViva = isGuided && o.total_questions != null && o.total_questions > 0;
                const vivaItemPct = hasViva
                  ? Math.round(((o.quiz_score ?? 0) / (o.total_questions ?? 1)) * 100)
                  : null;
                const snippet = truncate(o.observation_text, 80);
                return (
                  <li
                    key={o.id}
                    className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg flex-shrink-0 leading-none mt-0.5" aria-hidden="true">{sim.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-semibold text-gray-900 truncate">{sim.title}</span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              isGuided
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {isGuided ? t(isHi, 'Guided', 'गाइडेड') : t(isHi, 'Simple', 'सरल')}
                          </span>
                          {vivaItemPct !== null && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                vivaItemPct >= 70
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : vivaItemPct >= 40
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {t(isHi, `Viva ${vivaItemPct}%`, `वाइवा ${vivaItemPct}%`)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                          <span>{relativeDate(o.created_at, isHi)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatDuration(o.time_spent_seconds, isHi)}</span>
                        </div>
                        {snippet && (
                          <p className="text-[12px] text-gray-600 mt-1 leading-snug break-words">
                            “{snippet}”
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-gray-500 text-center py-3">
              {t(isHi, 'No labs in the last 7 days.', 'पिछले 7 दिनों में कोई प्रयोग नहीं।')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
