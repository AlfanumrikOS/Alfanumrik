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
 * Loading / empty / error states are all handled here. The parent page only
 * renders this once it already has `dash` resolved, so the "error" path is the
 * defensive case where the passed dash carries an error flag.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Skeleton } from '@alfanumrik/ui/ui';
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
    <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 animate-pulse">
      <div className="h-5 bg-orange-100 rounded w-2/3 mb-3" />
      <div className="h-4 bg-orange-50 rounded w-full mb-1.5" />
      <div className="h-4 bg-orange-50 rounded w-5/6" />
    </div>
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
    <div className="min-h-[44px] px-4 py-3 bg-white border border-orange-200 rounded-[12px] animate-pulse">
      <div className="h-4 bg-orange-50 rounded w-1/2" />
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
      <p className="text-[11px] text-gray-500 uppercase tracking-[0.5px] mb-2">
        {t(isHi, 'This week at a glance', 'इस सप्ताह एक नज़र में')}
      </p>
      <div className="flex items-end gap-2 h-[64px]">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={`rounded mb-1 transition-[height] duration-300 ${d.active ? 'bg-orange-500' : 'bg-orange-50'}`}
              style={{ height: Math.max(4, (d.quizzes / maxQ) * 48) }}
            />
            <span className={`text-[10px] ${d.active ? 'text-gray-900' : 'text-gray-400'}`}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Snapshot stat pill — mirrors the legacy parent Stat card styling. ───
function StatPill({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl px-3 py-2.5 border border-orange-200">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-sm">{icon}</span>
        <span className="text-gray-500 text-[10px] uppercase tracking-[0.5px]">{label}</span>
      </div>
      <span className="text-[20px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Timeline row for the Moments feed (read-only). ───
function MomentRow({ icon, accent, text }: { icon: string; accent: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span
        className="flex items-center justify-center w-6 h-6 rounded-full text-[12px] flex-shrink-0 mt-0.5"
        style={{ background: `${accent}18`, color: accent }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-[13px] text-gray-700 m-0 leading-relaxed">{text}</p>
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
      <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
        <Skeleton className="mb-4" height={28} width="55%" rounded="rounded-lg" />
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} rounded="rounded-xl" />
          ))}
        </div>
        <Skeleton className="mb-3" height={120} rounded="rounded-[14px]" />
        <Skeleton height={140} rounded="rounded-[14px]" />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
        <div className="bg-white rounded-[14px] px-[18px] py-6 border border-orange-200 text-center">
          <div className="text-3xl mb-2" aria-hidden="true">&#x26A0;</div>
          <p className="text-[14px] text-red-500 mb-3">{error}</p>
          <button
            onClick={onRefresh}
            className="min-h-[44px] px-5 py-2.5 bg-orange-500 text-white border-none rounded-[10px] text-[13px] font-semibold cursor-pointer"
          >
            {t(isHi, 'Try Again', 'पुनः प्रयास करें')}
          </button>
        </div>
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
  const derivedMoments: Array<{ icon: string; accent: string; text: string }> = [];
  if ((weekSummary?.quizzes || 0) > 0) {
    derivedMoments.push({
      icon: '✓',
      accent: '#059669',
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
      accent: '#EF4444',
      text: t(isHi, `On a ${s.streak}-day learning streak.`, `${s.streak}-दिन की सीखने की स्ट्रीक पर।`),
    });
  }
  if (bktMastery && (bktMastery.levels?.mastered || 0) > 0) {
    derivedMoments.push({
      icon: '🌟',
      accent: '#7C3AED',
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
      accent: '#EC4899',
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
      accent: '#0891B2',
      text: t(isHi, `${labStreak}-day STEM lab streak.`, `${labStreak}-दिन की STEM लैब स्ट्रीक।`),
    });
  }
  // Pull in up to one existing insight line as a "note" moment (read-only).
  if (insights && insights.length > 0) {
    derivedMoments.push({ icon: '💡', accent: '#D97706', text: insights[0] });
  }
  const cappedMoments = derivedMoments.slice(0, 5);

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      {/* ── Header ── */}
      <div className="flex justify-between items-start mb-4 pb-3.5 border-b border-orange-200">
        <div>
          <p className="text-[11px] text-orange-500 font-semibold uppercase tracking-[1px] mb-1">
            {t(isHi, "Today's glance", 'आज की झलक')}
          </p>
          <h1 className="text-[22px] font-bold text-gray-900 m-0">{childName}</h1>
          <p className="text-sm text-gray-500 mt-1 mb-0">
            {t(isHi, 'Grade', 'कक्षा')} {grade}
            {subject ? ` | ${subject}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRefresh}
            className="min-h-[36px] px-3 py-1.5 bg-transparent text-orange-500 border border-orange-200 rounded-md text-xs cursor-pointer"
          >
            {t(isHi, 'Refresh', 'रिफ्रेश')}
          </button>
          <button
            onClick={onLogout}
            className="min-h-[36px] px-3 py-1.5 bg-transparent text-gray-500 border border-orange-200 rounded-md text-xs cursor-pointer"
          >
            {t(isHi, 'Logout', 'लॉग आउट')}
          </button>
        </div>
      </div>

      {/* ════════ EMPTY STATE ════════ */}
      {hasNoActivity ? (
        <div className="bg-white rounded-[14px] px-[18px] py-6 border border-orange-200 mb-4 text-center">
          <div className="text-4xl mb-3" aria-hidden="true">&#x1F331;</div>
          <h3 className="text-[16px] font-semibold text-gray-900 mb-2">
            {t(isHi, `${childName} hasn't started learning yet`, `${childName} ने अभी तक पढ़ाई शुरू नहीं की है`)}
          </h3>
          <p className="text-[13px] text-gray-500 mb-0 leading-relaxed max-w-[320px] mx-auto">
            {t(
              isHi,
              "Once they take their first quiz or chat with Foxy, you'll see a weekly glance of their progress right here.",
              'जब वे अपनी पहली क्विज़ देंगे या Foxy से चैट करेंगे, तो आप यहाँ उनकी प्रगति की साप्ताहिक झलक देख सकेंगे।',
            )}
          </p>
        </div>
      ) : (
        <>
          {/* ════════ SECTION 1 — SNAPSHOT ════════ */}
          <section className="mb-5" aria-label={t(isHi, 'Weekly snapshot', 'साप्ताहिक झलक')}>
            <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3">
              <p className="text-[15px] font-semibold text-gray-900 mb-1.5">{accuracyHeadline}</p>
              <p className="text-[13px] text-gray-500 m-0 leading-relaxed">
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
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
                    <span aria-hidden="true">&#x2B06;</span>
                    {t(isHi, `Strong: ${subjectPair.strong.subject}`, `मज़बूत: ${subjectPair.strong.subject}`)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
                    <span aria-hidden="true">&#x1F91D;</span>
                    {t(isHi, `Needs help: ${subjectPair.weak.subject}`, `मदद चाहिए: ${subjectPair.weak.subject}`)}
                  </span>
                </div>
              )}

              {/* Small weekly activity strip — reuses the 7-day renderer. */}
              {dailyActivity && dailyActivity.length > 0 && (
                <ActivityStrip data={dailyActivity} t={t} isHi={isHi} />
              )}
            </div>

            {/* Compact snapshot stats — mirrors legacy Stat styling. */}
            <div className="grid grid-cols-2 gap-2.5">
              <StatPill icon="&#x2B50;" label="XP" value={s.xp || 0} color="#F59E0B" />
              <StatPill icon="&#x1F3AF;" label={t(isHi, 'Accuracy', 'सटीकता')} value={`${s.accuracy || 0}%`} color="#059669" />
              <StatPill icon="&#x1F4DA;" label={t(isHi, 'Quizzes', 'क्विज़')} value={s.totalQuizzes || 0} color="#6366F1" />
              <StatPill icon="&#x23F1;" label={t(isHi, 'Study time', 'अध्ययन समय')} value={`${s.minutes || 0}m`} color="#8B5CF6" />
            </div>
          </section>

          {/* ════════ SECTION 2 — MOMENTS ════════ */}
          <section className="mb-5" aria-label={t(isHi, 'Recent moments', 'हाल के पल')}>
            <h2 className="text-[13px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              {t(isHi, 'Moments', 'पल')}
            </h2>

            {cappedMoments.length > 0 ? (
              <div className="bg-white rounded-[14px] px-[18px] py-2.5 border border-orange-200 mb-3">
                {cappedMoments.map((m, i) => (
                  <div key={i} className={i < cappedMoments.length - 1 ? 'border-b border-orange-100' : ''}>
                    <MomentRow icon={m.icon} accent={m.accent} text={m.text} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3 text-center">
                <p className="text-[13px] text-gray-500 m-0">
                  {t(isHi, 'No new moments this week yet.', 'इस सप्ताह अभी तक कोई नया पल नहीं।')}
                </p>
              </div>
            )}

            {/* Richer AI report read — only for guardian-mode parents (Bearer
                auth). WeeklyReport owns its own fetch + loading/error states. */}
            {canFetchReport && (
              <WeeklyReport studentId={student.id} guardianId={guardianId} isHi={isHi} />
            )}
          </section>

          {/* ════════ SECTION 3 — ACTIONS ════════ */}
          <section aria-label={t(isHi, 'Quick actions', 'त्वरित क्रियाएँ')}>
            <h2 className="text-[13px] font-bold text-gray-500 uppercase tracking-wider mb-2">
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
                className="flex items-center gap-3 min-h-[44px] px-4 py-3 bg-white text-gray-900 border border-orange-200 rounded-[12px] no-underline"
              >
                <span className="text-lg" aria-hidden="true">&#x1F4CA;</span>
                <span className="flex-1 text-[14px] font-semibold">{t(isHi, 'View full report', 'पूरी रिपोर्ट देखें')}</span>
                <span className="text-orange-400 text-lg" aria-hidden="true">&#x2192;</span>
              </Link>

              {/* Manage plan — existing billing page. */}
              <Link
                href="/parent/billing"
                className="flex items-center gap-3 min-h-[44px] px-4 py-3 bg-white text-gray-900 border border-orange-200 rounded-[12px] no-underline"
              >
                <span className="text-lg" aria-hidden="true">&#x1F4B3;</span>
                <span className="flex-1 text-[14px] font-semibold">{t(isHi, 'Manage plan', 'प्लान प्रबंधित करें')}</span>
                <span className="text-orange-400 text-lg" aria-hidden="true">&#x2192;</span>
              </Link>

              {/* Message teacher / support — existing pages. Guardian-mode
                  parents get the teacher-message thread; link-code parents
                  get support (messages requires a JWT). */}
              <Link
                href={canFetchReport ? '/parent/messages' : '/parent/support'}
                className="flex items-center gap-3 min-h-[44px] px-4 py-3 bg-white text-gray-900 border border-orange-200 rounded-[12px] no-underline"
              >
                <span className="text-lg" aria-hidden="true">&#x1F4AC;</span>
                <span className="flex-1 text-[14px] font-semibold">
                  {canFetchReport
                    ? t(isHi, 'Message teacher', 'शिक्षक को संदेश भेजें')
                    : t(isHi, 'Get support', 'सहायता प्राप्त करें')}
                </span>
                <span className="text-orange-400 text-lg" aria-hidden="true">&#x2192;</span>
              </Link>
            </div>
          </section>
        </>
      )}

    </div>
  );
}
