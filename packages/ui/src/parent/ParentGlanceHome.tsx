'use client';

/**
 * ParentGlanceHome — push-first, one-scroll parent "glance" home
 * (Consumer Minimalism Wave C, gated by `ff_parent_glance_v1`).
 *
 * This is a READ-ONLY presentation reorg. It consumes ONLY data the parent
 * `Dashboard` (src/app/parent/page.tsx) has ALREADY fetched (the
 * `get_child_dashboard` payload + perfScores + labStreak) and renders it as
 * three stacked sections in a single vertical scroll:
 *
 *   SNAPSHOT — plain-language weekly summary built from existing stats.
 *   MOMENTS  — short feed of notable items derived from existing report data
 *              (highlights/concerns when available via WeeklyReport, else the
 *              existing weekSummary / bktMastery / insights), plus an existing
 *              ScoreCard-free milestone read.
 *   ACTIONS  — navigation to EXISTING pages only (<Link> / router push).
 *
 * It does NOT refetch any data, does NOT add a new endpoint, does NOT POST,
 * and introduces NO "Encourage" write feature. All copy is bilingual via the
 * parent `t(isHi, en, hi)` helper passed in from the page (P7). No PII is
 * logged anywhere (P13) — the component logs nothing.
 *
 * Presentation rebuilt on canonical primitives (Phase 10) — token-only,
 * growth-mindset framing. All read-only derivations + gates are byte-intact.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Card,
  CardBody,
  Button,
  Badge,
  Alert,
  EmptyState,
  Skeleton,
} from '@alfanumrik/ui/ui/primitives';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { CONSUMER_MINIMALISM_FLAGS } from '@alfanumrik/lib/feature-flags';

// Reuse the AI weekly report for the richer "Moments" read. It owns its own
// fetch to /api/parent/report (Bearer-authed) + loading/error/skeleton states,
// so we lazy-load it and only mount it for guardian-mode parents (a real
// Supabase JWT). Link-code parents would 401, so we fall back to deriving
// moments from the already-fetched dashboard payload.
const WeeklyReport = dynamic(() => import('./WeeklyReport'), {
  ssr: false,
  loading: () => (
    <Card>
      <CardBody className="space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </CardBody>
    </Card>
  ),
});

// "Encourage" action (Wave D, ff_parent_encourage_v1). Lazy-loaded so its picker
// markup + the cheer-catalog data module never enter the flag-OFF first-paint
// bundle (P10). Mounted ONLY when the flag is ON AND the parent is in
// guardian-JWT mode (the route requires the guardian JWT). When the flag is OFF
// this import is never resolved and the glance home renders byte-identically.
const EncourageButton = dynamic(() => import('./EncourageButton'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[44px] rounded-xl border border-surface-3 bg-surface-1 px-4 py-3">
      <Skeleton className="h-4 w-1/2" />
    </div>
  ),
});

// ─── Bilingual helper signature (the page passes its own `t`) ───
type TFn = (isHi: boolean, en: string, hi: string) => string;

// ─── Shapes — mirror the already-fetched dashboard payload exactly. ───
// These are structural copies of the interfaces in src/app/parent/page.tsx.
// We do NOT re-derive analytics; we only read these fields.
interface DashboardStats {
  xp: number;
  streak: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
  totalChats: number;
  avgScore: number;
}
interface WeeklyDay {
  quizzes: number;
  active: boolean;
  label: string;
}
interface WeekSummary {
  quizzes: number;
  avgScore: number;
  activeDays: number;
}
interface BktMastery {
  levels: Record<string, number>;
  total: number;
}
interface PerfScoreRow {
  subject: string;
  overall_score: number;
  level_name: string;
}
interface StudentLike {
  id: string;
  name: string;
  grade: string;
}

export interface ParentGlanceHomeProps {
  /** Already-fetched child dashboard payload (get_child_dashboard). */
  stats: DashboardStats;
  childName: string;
  grade: string;
  subject?: string;
  dailyActivity?: WeeklyDay[];
  weekSummary?: WeekSummary;
  bktMastery?: BktMastery;
  insights?: string[];
  /** Already-fetched performance scores (RLS-scoped) — read-only here. */
  perfScores: PerfScoreRow[];
  /** Already-fetched STEM lab streak — read-only here. */
  labStreak: number | null;
  /** Selected child (for studentId, name). */
  student: StudentLike;
  /** Guardian id — only used to pass through to WeeklyReport when allowed. */
  guardianId: string;
  /** True only for guardian-mode (Supabase JWT) parents — gates WeeklyReport. */
  canFetchReport: boolean;
  /** Loading flag from the page (true while dash is being (re)fetched). */
  loading?: boolean;
  /** Error message from the page when the dash payload failed. */
  error?: string | null;
  /** Manual refresh — reuses the page's existing load(). */
  onRefresh: () => void;
  /** Logout — reuses the page's existing logout(). */
  onLogout: () => void;
  isHi: boolean;
  t: TFn;
}

// ─── Small weekly activity strip — reuses the SAME 7-day dailyActivity
//     renderer shape used by the legacy WeeklyChart (bars scaled to max). ───
function ActivityStrip({ data, t, isHi }: { data: WeeklyDay[]; t: TFn; isHi: boolean }) {
  const maxQ = Math.max(...data.map((d) => d.quizzes), 1);
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
        {t(isHi, 'This week at a glance', 'इस सप्ताह एक नज़र में')}
      </p>
      <div className="flex h-[64px] items-end gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={`mb-1 rounded transition-[height] duration-300 ${d.active ? 'bg-primary' : 'bg-surface-3'}`}
              style={{ height: Math.max(4, (d.quizzes / maxQ) * 48) }}
            />
            <span className={`text-2xs ${d.active ? 'text-foreground' : 'text-muted-foreground'}`}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Snapshot stat pill — mirrors the legacy parent Stat card styling. ───
function StatPill({ icon, label, value, valueClass }: { icon: string; label: string; value: string | number; valueClass: string }) {
  return (
    <div className="rounded-xl border border-surface-3 bg-surface-1 px-3 py-2.5">
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="text-sm" aria-hidden="true">{icon}</span>
        <span className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <span className={`text-xl font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

// ─── Timeline row for the Moments feed (read-only). ───
function MomentRow({ icon, iconClass, text }: { icon: string; iconClass: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span
        className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs ${iconClass}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-sm leading-relaxed text-foreground">{text}</p>
    </div>
  );
}

/**
 * Derive a SUBJECT-improving + SUBJECT-needs-help pair from already-present
 * perfScores. Pure read of existing fields — sort by overall_score, take the
 * top and bottom. No new analytics. Returns null when fewer than 2 scores.
 */
function deriveSubjectPair(perfScores: PerfScoreRow[]): { strong: PerfScoreRow; weak: PerfScoreRow } | null {
  if (!perfScores || perfScores.length < 2) return null;
  const sorted = [...perfScores].sort((a, b) => b.overall_score - a.overall_score);
  return { strong: sorted[0], weak: sorted[sorted.length - 1] };
}

export default function ParentGlanceHome(props: ParentGlanceHomeProps) {
  const {
    stats: s,
    childName,
    grade,
    subject,
    dailyActivity,
    weekSummary,
    bktMastery,
    insights,
    perfScores,
    labStreak,
    student,
    guardianId,
    canFetchReport,
    loading,
    error,
    onRefresh,
    onLogout,
    isHi,
    t,
  } = props;

  // ── "Encourage" action gate (Wave D). Two conditions, both required:
  //    1. ff_parent_encourage_v1 ON — read via the SAME shared SWR flag hook the
  //       parent page uses for ff_parent_glance_v1 (client read, no context).
  //    2. canFetchReport — the parent is in guardian-JWT mode. The encourage
  //       route requires the guardian's Supabase JWT (same gate WeeklyReport
  //       uses); link-code parents would 403, so the button is hidden for them.
  //    When either is false we render NOTHING new — the flag-OFF glance home is
  //    byte-identical to the Wave C surface. Hooks must run unconditionally, so
  //    the call sits above all early returns.
  const { data: flags } = useFeatureFlags();
  const encourageEnabled =
    flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1] === true && canFetchReport;

  // ── Loading state (Skeleton) ──
  if (loading) {
    return (
      <div className="mx-auto min-h-dvh max-w-[600px] bg-surface-2 px-4 py-5 text-foreground">
        <Skeleton className="mb-4 h-7 w-[55%]" />
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mb-3 h-[120px] rounded-xl" />
        <Skeleton className="h-[140px] rounded-xl" />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="mx-auto min-h-dvh max-w-[600px] bg-surface-2 px-4 py-5 text-foreground">
        <Card>
          <CardBody className="text-center">
            <div className="mb-2 text-3xl" aria-hidden="true">
              &#x26A0;
            </div>
            <Alert tone="danger" className="mb-3">
              {error}
            </Alert>
            <Button onClick={onRefresh}>{t(isHi, 'Try Again', 'पुनः प्रयास करें')}</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ── Empty state: child has no activity yet ──
  const hasNoActivity = (s.totalQuizzes || 0) === 0 && (s.xp || 0) === 0 && (s.totalChats || 0) === 0;

  // ── Snapshot derivations (read existing fields only) ──
  const subjectPair = deriveSubjectPair(perfScores);
  const accuracyHeadline =
    (s.accuracy || 0) >= 70
      ? t(isHi, `${childName} is doing well this week.`, `${childName} इस सप्ताह अच्छा कर रहा है।`)
      : (s.accuracy || 0) >= 40
        ? t(isHi, `${childName} is making steady progress.`, `${childName} स्थिर प्रगति कर रहा है।`)
        : t(isHi, `${childName} could use a little extra support.`, `${childName} को थोड़ी अतिरिक्त सहायता चाहिए।`);

  // ── Moments (read-only) derived directly from already-fetched payload. ──
  // Used as the fallback feed for link-code parents who can't load the AI
  // report, and as the always-present "milestone" rows alongside it.
  const derivedMoments: Array<{ icon: string; iconClass: string; text: string }> = [];
  if ((weekSummary?.quizzes || 0) > 0) {
    derivedMoments.push({
      icon: '✓',
      iconClass: 'text-success',
      text: t(
        isHi,
        `Completed ${weekSummary!.quizzes} quiz${weekSummary!.quizzes > 1 ? 'zes' : ''} this week.`,
        `इस सप्ताह ${weekSummary!.quizzes} क्विज़ पूरी की।`,
      ),
    });
  }
  if ((s.streak || 0) >= 3) {
    derivedMoments.push({
      icon: '🔥',
      iconClass: 'text-streak',
      text: t(isHi, `On a ${s.streak}-day learning streak.`, `${s.streak}-दिन की सीखने की स्ट्रीक पर।`),
    });
  }
  if (bktMastery && (bktMastery.levels?.mastered || 0) > 0) {
    derivedMoments.push({
      icon: '🌟',
      iconClass: 'text-secondary',
      text: t(
        isHi,
        `Mastered ${bktMastery.levels.mastered} concept${bktMastery.levels.mastered > 1 ? 's' : ''} so far.`,
        `अब तक ${bktMastery.levels.mastered} अवधारणा में महारत हासिल की।`,
      ),
    });
  }
  if ((s.totalChats || 0) > 0) {
    derivedMoments.push({
      icon: '💬',
      iconClass: 'text-secondary',
      text: t(
        isHi,
        `Asked Foxy ${s.totalChats} question${s.totalChats > 1 ? 's' : ''}.`,
        `Foxy से ${s.totalChats} सवाल पूछे।`,
      ),
    });
  }
  if (labStreak !== null && labStreak > 0) {
    derivedMoments.push({
      icon: '🔬',
      iconClass: 'text-info',
      text: t(isHi, `${labStreak}-day STEM lab streak.`, `${labStreak}-दिन की STEM लैब स्ट्रीक।`),
    });
  }
  // Pull in up to one existing insight line as a "note" moment (read-only).
  if (insights && insights.length > 0) {
    derivedMoments.push({ icon: '💡', iconClass: 'text-warning', text: insights[0] });
  }
  const cappedMoments = derivedMoments.slice(0, 5);

  return (
    <div className="mx-auto min-h-dvh max-w-[600px] bg-surface-2 px-4 py-5 text-foreground">
      {/* ── Header ── */}
      <div className="mb-4 flex items-start justify-between border-b border-surface-3 pb-3.5">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {t(isHi, "Today's glance", 'आज की झलक')}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{childName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(isHi, 'Grade', 'कक्षा')} {grade}
            {subject ? ` | ${subject}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            {t(isHi, 'Refresh', 'रिफ्रेश')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onLogout}>
            {t(isHi, 'Logout', 'लॉग आउट')}
          </Button>
        </div>
      </div>

      {/* ════════ EMPTY STATE ════════ */}
      {hasNoActivity ? (
        <EmptyState
          className="mb-4"
          icon={<span aria-hidden="true">🌱</span>}
          title={t(isHi, `${childName} hasn't started learning yet`, `${childName} ने अभी तक पढ़ाई शुरू नहीं की है`)}
          description={t(
            isHi,
            "Once they take their first quiz or chat with Foxy, you'll see a weekly glance of their progress right here.",
            'जब वे अपनी पहली क्विज़ देंगे या Foxy से चैट करेंगे, तो आप यहाँ उनकी प्रगति की साप्ताहिक झलक देख सकेंगे।',
          )}
        />
      ) : (
        <>
          {/* ════════ SECTION 1 — SNAPSHOT ════════ */}
          <section className="mb-5" aria-label={t(isHi, 'Weekly snapshot', 'साप्ताहिक झलक')}>
            <Card className="mb-3">
              <CardBody>
                <p className="mb-1.5 text-base font-semibold text-foreground">{accuracyHeadline}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {(weekSummary?.quizzes || 0) > 0
                    ? t(
                        isHi,
                        `${weekSummary!.quizzes} session${weekSummary!.quizzes > 1 ? 's' : ''} this week`,
                        `इस सप्ताह ${weekSummary!.quizzes} सत्र`,
                      )
                    : t(isHi, 'No sessions yet this week', 'इस सप्ताह अभी तक कोई सत्र नहीं')}
                  {' · '}
                  {(s.streak || 0) > 0
                    ? t(isHi, `🔥 ${s.streak}-day streak`, `🔥 ${s.streak}-दिन की स्ट्रीक`)
                    : t(isHi, 'Streak paused', 'स्ट्रीक रुकी हुई')}
                  {(weekSummary?.avgScore || 0) > 0
                    ? ` · ${t(isHi, `${weekSummary!.avgScore}% avg`, `${weekSummary!.avgScore}% औसत`)}`
                    : ''}
                </p>

                {/* One improving + one needs-help subject (existing perfScores). */}
                {subjectPair && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="success" icon={<span aria-hidden="true">⬆</span>}>
                      {t(isHi, `Strong: ${subjectPair.strong.subject}`, `मज़बूत: ${subjectPair.strong.subject}`)}
                    </Badge>
                    <Badge tone="warning" icon={<span aria-hidden="true">🤝</span>}>
                      {t(isHi, `Needs help: ${subjectPair.weak.subject}`, `मदद चाहिए: ${subjectPair.weak.subject}`)}
                    </Badge>
                  </div>
                )}

                {/* Small weekly activity strip — reuses the 7-day renderer. */}
                {dailyActivity && dailyActivity.length > 0 && (
                  <ActivityStrip data={dailyActivity} t={t} isHi={isHi} />
                )}
              </CardBody>
            </Card>

            {/* Compact snapshot stats — mirrors legacy Stat styling. */}
            <div className="grid grid-cols-2 gap-2.5">
              <StatPill icon="⭐" label="XP" value={s.xp || 0} valueClass="text-xp" />
              <StatPill icon="🎯" label={t(isHi, 'Accuracy', 'सटीकता')} value={`${s.accuracy || 0}%`} valueClass="text-success" />
              <StatPill icon="📚" label={t(isHi, 'Quizzes', 'क्विज़')} value={s.totalQuizzes || 0} valueClass="text-info" />
              <StatPill icon="⏱" label={t(isHi, 'Study time', 'अध्ययन समय')} value={`${s.minutes || 0}m`} valueClass="text-secondary" />
            </div>
          </section>

          {/* ════════ SECTION 2 — MOMENTS ════════ */}
          <section className="mb-5" aria-label={t(isHi, 'Recent moments', 'हाल के पल')}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t(isHi, 'Moments', 'पल')}
            </h2>

            {cappedMoments.length > 0 ? (
              <Card className="mb-3">
                <CardBody className="py-1">
                  {cappedMoments.map((m, i) => (
                    <div key={i} className={i < cappedMoments.length - 1 ? 'border-b border-surface-3' : ''}>
                      <MomentRow icon={m.icon} iconClass={m.iconClass} text={m.text} />
                    </div>
                  ))}
                </CardBody>
              </Card>
            ) : (
              <Card className="mb-3">
                <CardBody className="text-center">
                  <p className="text-sm text-muted-foreground">
                    {t(isHi, 'No new moments this week yet.', 'इस सप्ताह अभी तक कोई नया पल नहीं।')}
                  </p>
                </CardBody>
              </Card>
            )}

            {/* Richer AI report read — only for guardian-mode parents (Bearer
                auth). WeeklyReport owns its own fetch + loading/error states. */}
            {canFetchReport && (
              <WeeklyReport studentId={student.id} guardianId={guardianId} isHi={isHi} />
            )}
          </section>

          {/* ════════ SECTION 3 — ACTIONS ════════ */}
          <section aria-label={t(isHi, 'Quick actions', 'त्वरित क्रियाएँ')}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t(isHi, 'Actions', 'क्रियाएँ')}
            </h2>
            <div className="flex flex-col gap-2.5">
              {/* Encourage {child} — Wave D (ff_parent_encourage_v1). Rendered
                  ONLY when the flag is ON AND the parent is guardian-JWT mode.
                  Lazy-loaded; flag-OFF path stays byte-identical (nothing new). */}
              {encourageEnabled && (
                <EncourageButton studentId={student.id} childName={childName} isHi={isHi} />
              )}

              {/* View full report — opens the existing detailed reports page. */}
              <Link
                href="/parent/reports"
                className="flex min-h-[44px] items-center gap-3 rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 no-underline"
              >
                <span className="text-lg" aria-hidden="true">📊</span>
                <span className="flex-1 text-sm font-semibold text-foreground">{t(isHi, 'View full report', 'पूरी रिपोर्ट देखें')}</span>
                <span className="text-lg text-primary" aria-hidden="true">→</span>
              </Link>

              {/* Manage plan — existing billing page. */}
              <Link
                href="/parent/billing"
                className="flex min-h-[44px] items-center gap-3 rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 no-underline"
              >
                <span className="text-lg" aria-hidden="true">💳</span>
                <span className="flex-1 text-sm font-semibold text-foreground">{t(isHi, 'Manage plan', 'प्लान प्रबंधित करें')}</span>
                <span className="text-lg text-primary" aria-hidden="true">→</span>
              </Link>

              {/* Message teacher / support — existing pages. Guardian-mode
                  parents get the teacher-message thread; link-code parents
                  get support (messages requires a JWT). */}
              <Link
                href={canFetchReport ? '/parent/messages' : '/parent/support'}
                className="flex min-h-[44px] items-center gap-3 rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 no-underline"
              >
                <span className="text-lg" aria-hidden="true">💬</span>
                <span className="flex-1 text-sm font-semibold text-foreground">
                  {canFetchReport
                    ? t(isHi, 'Message teacher', 'शिक्षक को संदेश भेजें')
                    : t(isHi, 'Get support', 'सहायता प्राप्त करें')}
                </span>
                <span className="text-lg text-primary" aria-hidden="true">→</span>
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
