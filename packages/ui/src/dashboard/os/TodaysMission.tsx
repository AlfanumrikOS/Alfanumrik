'use client';

/**
 * TodaysMission — the PRIMARY hero of the Alfa OS dashboard (ff_student_os_v1).
 *
 * Decision-first design: this is the single dominant CTA on the page. It fetches
 * the learner-loop queue from /api/v2/today (gated by ff_today_home_v1, which IS
 * enabled globally) via the shared useTodayQueue hook. This replaces the former
 * DailyRhythmQueue which fetched /api/rhythm/today (gated by
 * ff_pedagogy_v2_daily_rhythm — OFF in production), meaning the hero was empty
 * for all students. The always-present "Begin lesson" CTA provides a direct
 * shortcut when the queue is loading or empty.
 *
 * No engine logic here — queue ordering lives in the resolver. This supplies
 * the editorial chrome + queue display + fallback CTA. Bilingual via isHi.
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import { todayCopy, deepLinkToHref } from '@alfanumrik/lib/today/copy';
import { ALWAYS_NATIVE_SCRIPT } from '@alfanumrik/lib/today/render';
import { PremiumCard, GlowButton } from '@alfanumrik/ui/ui';
import type { CurriculumTopic } from '@alfanumrik/lib/types';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';

/* Stable warm-orange tints. --orange-rgb is remapped to VIOLET under the
   cosmic-light student surface, so warm tints route through --accent-warm-rgb
   (re-pinned to burnt orange 232,88,28 in :root AND the cosmic-light block). */
const WARM_06 = 'rgb(var(--accent-warm-rgb) / 0.06)';
const WARM_10 = 'rgb(var(--accent-warm-rgb) / 0.10)';
const WARM_15 = 'rgb(var(--accent-warm-rgb) / 0.15)';
const WARM_20 = 'rgb(var(--accent-warm-rgb) / 0.20)';
const WARM_25 = 'rgb(var(--accent-warm-rgb) / 0.25)';
const WARM = 'var(--accent-warm, #E8581C)';

interface TodaysMissionProps {
  isHi: boolean;
  studentName: string;
  grade: string | null | undefined;
  subjectCode: string;
  todaysTopic: CurriculumTopic | undefined;
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hindi and Sanskrit are always shown in native Devanagari script — this is
 *  the culturally correct form in Indian education regardless of UI language.
 *  Uses the shared ALWAYS_NATIVE_SCRIPT constant from render.ts (single source of truth). */
function displaySubjectName(code: string): string {
  return ALWAYS_NATIVE_SCRIPT[code.toLowerCase()] ?? capitalize(code);
}

/**
 * Build the " · Chapter Title" suffix for subtitles. Uses Hindi title when
 * `isHi` is true and a Hindi title is available; falls back to the English
 * title. Returns '' when no title is present (graceful degradation).
 */
function chapterSuffix(item: TodayQueueItem, isHi: boolean): string {
  const title = isHi
    ? (item.chapterTitleHi ?? item.chapterTitle)
    : item.chapterTitle;
  return title ? ` · ${title}` : '';
}

export default function TodaysMission({
  isHi,
  studentName,
  grade,
  subjectCode,
  todaysTopic,
}: TodaysMissionProps) {
  const router = useRouter();
  const { student } = useAuth();
  const { data: queueData, isLoading: queueLoading, error: queueError, mutate: retryQueue } =
    useTodayQueue(student?.id);
  const firstName = studentName.split(' ')[0] || studentName;

  // The queue block must never silently collapse. After loading resolves, we
  // either have queue items, or we show an actionable empty/error card — never
  // nothing. `queueData` is null on a 404 (flag off / no profile); `queueError`
  // is set on a 5xx/network failure. Both fall through to the same friendly,
  // actionable card (P7 bilingual) so the hero never reads as "broken".
  const hasQueueItems = !!queueData && queueData.queue.length > 0;
  const showEmptyState = !queueLoading && !hasQueueItems;

  const beginLesson = () => {
    if (todaysTopic) {
      router.push(`/learn/${subjectCode}/${todaysTopic.chapter_number ?? 1}`);
    } else {
      router.push('/learn');
    }
  };

  return (
    <PremiumCard
      glow
      gradient
      className="os-mission p-5 md:p-6 rounded-3xl"
    >
      {/* Soft warm corner glow — the hero's signature warmth, kept warm via the
          stable --accent-warm channel (NOT the violet-remapped --orange-rgb). */}
      <div
        className="pointer-events-none absolute -top-12 -left-10 w-48 h-48 rounded-full opacity-70"
        aria-hidden="true"
        style={{
          background: `radial-gradient(circle, ${WARM_15} 0%, transparent 70%)`,
        }}
      />
      <div className="relative" aria-label={isHi ? 'आज का मिशन' : "Today's mission"}>
        <p
          className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2"
          style={{ color: WARM }}
        >
          <span aria-hidden="true" className="streak-flame mr-1.5">●</span>
          {isHi ? 'आज का मिशन' : "Today's mission"}
          {grade && (
            <>
              {' · '}
              {isHi ? `कक्षा ${grade}` : `Class ${grade}`}
            </>
          )}
        </p>

        <h1
          className="text-2xl md:text-[1.7rem] font-bold leading-[1.15] tracking-[-0.01em]"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--text-1)' }}
        >
          {todaysTopic?.title
            ? todaysTopic.title
            : isHi
              ? `चलो शुरू करें, ${firstName}`
              : `Let's get going, ${firstName}`}
        </h1>

      {/* Learner-loop queue — powered by /api/v2/today */}
      <div className="mt-3 flex flex-col gap-2">
        {queueLoading && (
          <div
            className="h-20 rounded-2xl animate-pulse"
            style={{ background: 'var(--surface-2)' }}
            aria-hidden="true"
          />
        )}
        {!queueLoading && queueData && queueData.queue.length > 0 && (
          <>
            {/* Cold-start: dominant full-width card instead of the normal queue */}
            {queueData.primary.type === 'cold_start_diagnostic' ? (
              <button
                type="button"
                onClick={() => router.push(deepLinkToHref(queueData.primary.deepLink))}
                className="w-full text-center rounded-2xl px-5 py-5 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                style={{
                  background: `linear-gradient(135deg, ${WARM_10}, ${WARM_06})`,
                  border: `1.5px solid ${WARM_25}`,
                }}
                data-testid="mission-primary-action"
                aria-label={isHi ? 'डायग्नोस्टिक शुरू करें' : 'Begin diagnostic'}
              >
                <div className="text-4xl mb-2" aria-hidden="true">🧭</div>
                <p
                  className="text-lg font-bold mb-1"
                  style={{ color: 'var(--text-1)', fontFamily: 'var(--font-serif)' }}
                >
                  {isHi ? 'डायग्नोस्टिक शुरू करें' : 'Start your diagnostic'}
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                  {isHi
                    ? '10 मिनट · Foxy आपका पर्सनलाइज्ड प्लान बनाएगा'
                    : '10 min · Foxy will personalise your study plan'}
                </p>
                <span
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, ${WARM}, var(--accent-warm-strong, #C2440F))`,
                    boxShadow: 'var(--shadow-glow)',
                  }}
                >
                  {isHi ? 'शुरू करें' : 'Begin diagnostic'} →
                </span>
              </button>
            ) : (
              <>
                {/* Primary action */}
                <button
                  type="button"
                  onClick={() => router.push(deepLinkToHref(queueData.primary.deepLink))}
                  className="w-full text-left flex items-center gap-3 rounded-2xl px-4 py-3 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                  style={{
                    background: WARM_06,
                    border: `1px solid ${WARM_15}`,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                  data-testid="mission-primary-action"
                >
                  <span className="text-2xl" aria-hidden="true">
                    {todayIcon(queueData.primary.iconHint)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {todayCopy(queueData.primary.labelKey, isHi)}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                      {todayCopy(queueData.primary.subtitleKey, isHi, {
                        subject: displaySubjectName((queueData.primary.meta?.subjectCode as string) ?? subjectCode),
                        chapterTitle: chapterSuffix(queueData.primary, isHi),
                        dueCount: String(queueData.primary.meta?.dueCount ?? ''),
                        days: String(queueData.primary.meta?.daysSinceLastTouch ?? ''),
                        progress: String(Math.round(((queueData.primary.meta?.progressPct as number) ?? 0) * 100)),
                        chapter: String(queueData.primary.meta?.chapterNumber ?? ''),
                        n: String(queueData.primary.estMinutes),
                      })}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      ~{queueData.primary.estMinutes} {isHi ? 'मिनट' : 'min'}
                    </p>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-3)' }}>→</span>
                </button>

                {/* Secondary actions (up to 2 more) */}
                {queueData.queue.slice(1, 3).map((item) => (
                  <button
                    key={item.rank}
                    type="button"
                    onClick={() => router.push(deepLinkToHref(item.deepLink))}
                    className="w-full text-left flex items-center gap-3 rounded-2xl px-4 py-2.5 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span className="text-lg" aria-hidden="true">{todayIcon(item.iconHint)}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold truncate block" style={{ color: 'var(--text-2)' }}>
                        {todayCopy(item.labelKey, isHi)}
                      </span>
                      <span className="text-[10px] truncate block" style={{ color: 'var(--text-3)' }}>
                        {todayCopy(item.subtitleKey, isHi, {
                          subject: displaySubjectName((item.meta?.subjectCode as string) ?? subjectCode),
                          chapterTitle: chapterSuffix(item, isHi),
                          dueCount: String(item.meta?.dueCount ?? ''),
                          days: String(item.meta?.daysSinceLastTouch ?? ''),
                          progress: String(Math.round(((item.meta?.progressPct as number) ?? 0) * 100)),
                          chapter: String(item.meta?.chapterNumber ?? ''),
                          n: String(item.estMinutes),
                        })}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      ~{item.estMinutes}m
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}

        {/* Empty / error fallback — never collapse to nothing. Renders an
            actionable, friendly card (P7 bilingual) routing to /learn. Error
            and empty share this card; raw error text is never shown. A subtle
            retry re-runs the SWR fetch when the failure was an error. */}
        {showEmptyState && (
          <div
            className="rounded-2xl px-4 py-4"
            style={{
              background: `linear-gradient(135deg, ${WARM_06}, ${WARM_10})`,
              border: `1.5px solid ${WARM_15}`,
            }}
            data-testid="mission-empty-state"
            role="status"
          >
            <div className="text-3xl mb-2" aria-hidden="true">🦊</div>
            <p className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              {isHi
                ? 'तुम्हारा सीखने का रास्ता तैयार हो रहा है'
                : 'Your learning path is getting ready'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'शुरू करने के लिए एक पाठ चुनो।'
                : 'Pick a lesson to begin.'}
            </p>
            <div className="mt-2.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/learn')}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2"
                style={{
                  background: WARM_10,
                  border: `1px solid ${WARM_20}`,
                  color: WARM,
                }}
                data-testid="mission-empty-cta"
              >
                {isHi ? 'पाठ चुनो' : 'Pick a lesson'}
                <span aria-hidden="true">→</span>
              </button>
              {queueError && (
                <button
                  type="button"
                  onClick={() => retryQueue()}
                  className="text-xs font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 rounded"
                  style={{ color: 'var(--text-3)' }}
                  data-testid="mission-empty-retry"
                >
                  {isHi ? 'फिर से कोशिश करें' : 'Try again'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

        {/* Always-present primary CTA — the single dominant warm action.
            GlowButton paints from --orange / --orange-light, which are VIOLET
            under the cosmic-light surface. We scope-override those two tokens to
            the stable warm channel on this wrapper ONLY, so the button renders
            burnt-orange (with its CSS-only shimmer) without touching GlowButton
            or the global cosmic remap. */}
        <div
          className="mt-4"
          style={{
            ['--orange' as string]: 'var(--accent-warm, #E8581C)',
            ['--orange-light' as string]: 'var(--accent-warm-strong, #C2440F)',
          }}
        >
          <GlowButton
            size="lg"
            fullWidth
            onClick={beginLesson}
            className="md:w-auto"
            icon={<span aria-hidden="true">▶</span>}
          >
            <span>
              {todaysTopic
                ? isHi
                  ? `पाठ शुरू करो · ${displaySubjectName(subjectCode)}`
                  : `Begin lesson · ${displaySubjectName(subjectCode)}`
                : isHi
                  ? 'आज का पाठ चुनो'
                  : "Pick today's lesson"}
            </span>
            <span aria-hidden="true" className="ml-1">→</span>
          </GlowButton>
        </div>
      </div>
    </PremiumCard>
  );
}
