'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardBody,
  Button,
  Badge,
  Alert,
  EmptyState,
  Skeleton as UiSkeleton,
  type Tone,
} from '@/components/ui/primitives';

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

/** Viva score % → primitive tone (presentation only; the number is server-read). */
function vivaTone(pct: number): Tone {
  if (pct >= 70) return 'success';
  if (pct >= 40) return 'warning';
  return 'danger';
}

// ─── Skeleton ───────────────────────────────────────────────────
function LabSkeleton() {
  return (
    <Card>
      <CardBody className="p-4 sm:p-5">
        <UiSkeleton className="mb-4 h-5 w-44" />
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <UiSkeleton className="h-16 rounded-xl" />
          <UiSkeleton className="h-16 rounded-xl" />
          <UiSkeleton className="h-16 rounded-xl" />
        </div>
        <div className="space-y-2">
          <UiSkeleton className="h-12 rounded-xl" />
          <UiSkeleton className="h-12 rounded-xl" />
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Main widget ────────────────────────────────────────────────
export default function ParentLabReportWidget({
  studentId,
  studentName,
  isHi,
  onScheduleClick,
}: ParentLabReportWidgetProps) {
  const router = useRouter();
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

  if (loading) return <LabSkeleton />;

  if (error) {
    return (
      <Card>
        <CardBody className="p-4 sm:p-5">
          <h3 className="mb-2 text-base font-semibold text-foreground">
            {t(isHi, '🔬 Lab Activity — This Week', '🔬 लैब गतिविधि — इस सप्ताह')}
          </h3>
          <Alert tone="danger" className="mb-3">
            {t(isHi, "Couldn't load lab activity. Try again.", 'लैब गतिविधि लोड नहीं हो सकी। पुनः प्रयास करें।')}
          </Alert>
          <Button size="sm" variant="secondary" onClick={load}>
            {t(isHi, 'Retry', 'पुनः प्रयास')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  // Avg viva % from cumulative streak counters (shown only when there's data).
  const vivaMax = streak?.total_viva_max ?? 0;
  const vivaScore = streak?.total_viva_score ?? 0;
  const vivaPct = vivaMax > 0 ? Math.round((vivaScore / vivaMax) * 100) : null;
  const currentStreak = streak?.current_streak ?? 0;

  const isEmpty = obs.length === 0 && weekCount === 0;

  return (
    <Card>
      <CardBody className="p-4 sm:p-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">
            {t(isHi, '🔬 Lab Activity — This Week', '🔬 लैब गतिविधि — इस सप्ताह')}
          </h3>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t(isHi, 'Last 7 days', 'पिछले 7 दिन')}
          </span>
        </div>

        {/* Empty state */}
        {isEmpty ? (
          <EmptyState
            icon={<span aria-hidden="true">🧪</span>}
            title={t(isHi, 'No labs yet', 'अभी तक कोई प्रयोग नहीं')}
            description={t(
              isHi,
              `${studentName} hasn't done any labs yet. Encourage them with a lab challenge!`,
              `${studentName} ने अभी तक कोई प्रयोग नहीं किया है। उन्हें एक लैब चुनौती के लिए प्रेरित करें!`,
            )}
            action={
              <Button onClick={onScheduleClick ?? (() => router.push('/parent/calendar'))}>
                {t(isHi, 'Schedule a lab →', 'एक लैब निर्धारित करें →')}
              </Button>
            }
          />
        ) : (
          <>
            {/* Stats: stack on mobile, 3-col on sm+ */}
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-surface-3 bg-surface-2 px-3 py-2.5">
                <div className="mb-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(isHi, 'Experiments', 'प्रयोग')}
                </div>
                <div className="text-xl font-bold text-primary">{weekCount}</div>
              </div>
              <div className="rounded-xl border border-surface-3 bg-surface-2 px-3 py-2.5">
                <div className="mb-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(isHi, 'Lab Streak', 'लैब स्ट्रीक')}
                </div>
                <div className="text-xl font-bold text-streak">
                  {currentStreak}
                  <span className="ml-1 text-xs font-medium text-streak">
                    {t(isHi, currentStreak === 1 ? 'day' : 'days', 'दिन')}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-surface-3 bg-surface-2 px-3 py-2.5">
                <div className="mb-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(isHi, 'Avg Viva', 'औसत वाइवा')}
                </div>
                <div className="text-xl font-bold text-secondary">
                  {vivaPct === null ? <span className="text-muted-foreground">—</span> : `${vivaPct}%`}
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
                      className="rounded-xl border border-surface-3 bg-surface-2 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex-shrink-0 text-lg leading-none" aria-hidden="true">{sim.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-foreground">{sim.title}</span>
                            <Badge tone={isGuided ? 'brand' : 'info'}>
                              {isGuided ? t(isHi, 'Guided', 'गाइडेड') : t(isHi, 'Simple', 'सरल')}
                            </Badge>
                            {vivaItemPct !== null && (
                              <Badge tone={vivaTone(vivaItemPct)}>
                                {t(isHi, `Viva ${vivaItemPct}%`, `वाइवा ${vivaItemPct}%`)}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{relativeDate(o.created_at, isHi)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatDuration(o.time_spent_seconds, isHi)}</span>
                          </div>
                          {snippet && (
                            <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">
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
              <p className="py-3 text-center text-sm text-muted-foreground">
                {t(isHi, 'No labs in the last 7 days.', 'पिछले 7 दिनों में कोई प्रयोग नहीं।')}
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
