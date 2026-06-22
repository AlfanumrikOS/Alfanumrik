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
import { useAuth } from '@/lib/AuthContext';
import { useTodayQueue } from '@/lib/today/use-today-queue';
import { todayIcon } from '@/lib/today/icon-map';
import { todayCopy, deepLinkToHref } from '@/lib/today/copy';
import { ALWAYS_NATIVE_SCRIPT } from '@/lib/today/render';
import type { CurriculumTopic } from '@/lib/types';

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
    <section
      className="os-mission rounded-3xl p-5 md:p-6 relative overflow-hidden"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
      }}
      aria-label={isHi ? 'आज का मिशन' : "Today's mission"}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.14em] mb-1.5"
        style={{ color: 'var(--orange, #E8581C)' }}
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
        className="text-xl md:text-2xl font-extrabold leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
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
            {/* Primary action */}
            <button
              type="button"
              onClick={() => router.push(deepLinkToHref(queueData.primary.deepLink))}
              className="w-full text-left flex items-center gap-3 rounded-2xl px-4 py-3 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
              style={{
                background: 'rgb(var(--orange-rgb) / 0.06)',
                border: '1px solid rgb(var(--orange-rgb) / 0.15)',
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
                <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--text-2)' }}>
                  {todayCopy(item.labelKey, isHi)}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  ~{item.estMinutes}m
                </span>
              </button>
            ))}
          </>
        )}

        {/* Empty / error fallback — never collapse to nothing. Renders an
            actionable, friendly card (P7 bilingual) routing to /learn. Error
            and empty share this card; raw error text is never shown. A subtle
            retry re-runs the SWR fetch when the failure was an error. */}
        {showEmptyState && (
          <div
            className="rounded-2xl px-4 py-3"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
            data-testid="mission-empty-state"
            role="status"
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
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
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2"
                style={{
                  background: 'rgb(var(--orange-rgb) / 0.10)',
                  border: '1px solid rgb(var(--orange-rgb) / 0.20)',
                  color: 'var(--orange, #E8581C)',
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

      {/* Always-present primary CTA — the single dominant action. */}
      <button
        type="button"
        onClick={beginLesson}
        className="mt-2 inline-flex items-center justify-center gap-2 w-full md:w-auto px-6 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          background: 'linear-gradient(135deg, var(--orange, #E8581C), #C9831A)',
          minHeight: 48,
        }}
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
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
