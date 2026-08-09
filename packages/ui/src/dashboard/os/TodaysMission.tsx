'use client';

/**
 * TodaysMission — the PRIMARY hero of the Alfa OS dashboard (ff_student_os_v1).
 *
 * Decision-first design: this is the single dominant CTA on the page. It fetches
 * the learner-loop queue from /api/v2/today (gated by ff_today_home_v1, which IS
 * enabled globally) via the shared useTodayQueue hook. This replaces the former
 * DailyRhythmQueue which fetched /api/rhythm/today (gated by
 * ff_pedagogy_v2_daily_rhythm — OFF in production), meaning the hero was empty
 * for all students.
 *
 * ONE-PRIMARY-ACTION RULE (2026-08-05 declutter). The card previously rendered
 * up to FIVE competing calls to action at once: the primary queue row, two
 * secondary rows, an always-on "Begin lesson" GlowButton, and (in the empty
 * state) a "Pick a lesson" button — the last two both routing to /learn and
 * sitting ~40 px apart. Now:
 *
 *   - Exactly ONE primary action renders: the top queue item (or the cold-start
 *     diagnostic card).
 *   - The two secondary queue rows sit behind a single collapsed disclosure
 *     ("Something else?" / "कुछ और?") with aria-expanded + aria-controls.
 *   - The GlowButton is no longer always-on. It is the SOLE fallback CTA inside
 *     the empty/error card, so it can never co-exist with a queue row (and it
 *     replaced, rather than joined, the old ghost "Pick a lesson" button — it
 *     carries that button's copy and `mission-empty-cta` testid).
 *   - "Try again" still appears only on an SWR error.
 *
 * Every destination and the `deepLinkToHref` mapping are unchanged — this is
 * prominence and presentation only.
 *
 * HERO TOPIC (2026-08-06 RCA W1). The h1 headline no longer depends on the
 * parent's separate `getNextTopics` client chain (4-5 sequential PostgREST
 * round-trips that gated the hero for 1.5-2.5s on 4G). The headline now derives
 * from the SAME queue fetch this card already makes: when the primary action is
 * chapter-anchored, its `chapterTitle` is the headline; otherwise the bilingual
 * greeting stands in. One fetch, one source of truth — the resolver decides
 * what is "next", never a parallel client query.
 *
 * No engine logic here — queue ordering lives in the resolver. This supplies
 * the editorial chrome + queue display + fallback CTA. Bilingual via isHi.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import { todayCopy, deepLinkToHref } from '@alfanumrik/lib/today/copy';
import { ALWAYS_NATIVE_SCRIPT } from '@alfanumrik/lib/today/render';
import { PremiumCard, GlowButton } from '@alfanumrik/ui/ui';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';
/* Warm channel + AA-verified accent pairing — one shared ladder for the whole
   dashboard (this file used to declare its own copy). */
import {
  WARM,
  WARM_06,
  WARM_10,
  WARM_15,
  WARM_25,
  ACCENT_SURFACE,
  ACCENT_FROM,
  ACCENT_TO,
  ON_ACCENT,
} from '@alfanumrik/ui/dashboard/os/palette';

interface TodaysMissionProps {
  isHi: boolean;
  studentName: string;
  grade: string | null | undefined;
  subjectCode: string;
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

  // Hero headline: the primary action's chapter title when it is chapter-anchored
  // (start_quiz / continue_lesson / revise_decayed_topic / introduce_new_topic),
  // otherwise the bilingual greeting. Derived from the SAME queue fetch — no
  // parallel getNextTopics chain (RCA W1).
  const heroTitle = queueData?.primary?.chapterTitle;

  // Secondary queue rows are collapsed by default — one primary action wins the
  // card. Purely local UI state; no persistence, no analytics.
  const [showAlternatives, setShowAlternatives] = useState(false);

  const beginLesson = () => {
    // Only reachable from the empty/error card, where no chapter is known —
    // the resolver produced nothing for this student, so the subject picker is
    // the honest destination (the queue primary owns chapter-level routing).
    router.push('/learn');
  };

  return (
    <PremiumCard
      glow
      gradient
      className="os-mission p-5 md:p-6 rounded-3xl"
    >
      {/* Soft warm corner glow — the hero's signature warmth, kept warm via the
          stable --accent-warm channel. */}
      <div
        className="pointer-events-none absolute -top-12 -left-10 w-48 h-48 rounded-full opacity-70"
        aria-hidden="true"
        style={{
          background: `radial-gradient(circle, ${WARM_15} 0%, transparent 70%)`,
        }}
      />
      <div className="relative" aria-label={isHi ? 'आज का मिशन' : "Today's mission"}>
        {/* Section eyebrow — same treatment as every other dashboard card
            (text-fluid-2xs / bold / uppercase / tracking-widest). Only the
            colour differs: the hero owns the warm brand signal. Was an
            11 px one-off below the design system's documented 12 px floor. */}
        <p
          className="text-fluid-2xs font-bold uppercase tracking-widest mb-2"
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

        {/* Hero headline. One fluid step (--text-2xl, 24 → 30 px) replaces the
            `text-2xl md:text-[1.7rem]` breakpoint pair — the size now scales
            smoothly from a 360 px phone instead of snapping at md, and it is
            the same scale every other card on the page reads from. */}
        <h1
          className="text-fluid-2xl font-bold leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {heroTitle
            ? heroTitle
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
                  style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
                >
                  {isHi ? 'डायग्नोस्टिक शुरू करें' : 'Start your diagnostic'}
                </p>
                <p className="text-fluid-xs mb-4" style={{ color: 'var(--text-3)' }}>
                  {isHi
                    ? '10 मिनट · Foxy आपका पर्सनलाइज्ड प्लान बनाएगा'
                    : '10 min · Foxy will personalise your study plan'}
                </p>
                {/* AA-verified accent pairing. This used to paint white on a
                    gradient that STARTS at bare #E8581C — 3.59:1, a documented
                    fail. ACCENT_SURFACE's stops (#CB4710 → #C2440F) are the
                    contrast-checked ones and ON_ACCENT is their only legal
                    foreground. */}
                <span
                  className="inline-flex items-center justify-center gap-1.5 min-h-tap-min px-5 py-2.5 rounded-xl text-fluid-sm font-bold"
                  style={{
                    background: ACCENT_SURFACE,
                    color: ON_ACCENT,
                    boxShadow: 'var(--shadow-glow)',
                  }}
                >
                  {isHi ? 'शुरू करें' : 'Begin diagnostic'} →
                </span>
              </button>
            ) : (
              <>
                {/* PRIMARY action. This is the one thing the page wants the
                    student to tap, and it used to be a flat 6% wash with a 1 px
                    hairline — nearly indistinguishable from the secondary rows
                    below, which are a flat grey wash with a 1 px hairline.
                    It now carries the same warm gradient + 1.5 px accent edge as
                    the cold-start card (one primary treatment on the surface),
                    and terminates in a filled accent chevron so the affordance
                    reads as a button rather than a list row. Destination and
                    copy are untouched. */}
                <button
                  type="button"
                  onClick={() => router.push(deepLinkToHref(queueData.primary.deepLink))}
                  className="w-full text-left flex items-center gap-3 rounded-2xl px-4 py-3 min-h-tap-comfort transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                  style={{
                    background: `linear-gradient(135deg, ${WARM_10}, ${WARM_06})`,
                    border: `1.5px solid ${WARM_25}`,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                  data-testid="mission-primary-action"
                >
                  <span className="text-2xl shrink-0" aria-hidden="true">
                    {todayIcon(queueData.primary.iconHint)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-fluid-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {todayCopy(queueData.primary.labelKey, isHi)}
                    </p>
                    <p className="text-fluid-xs truncate" style={{ color: 'var(--text-3)' }}>
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
                    <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }}>
                      ~{queueData.primary.estMinutes} {isHi ? 'मिनट' : 'min'}
                    </p>
                  </div>
                  <span
                    className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-fluid-sm font-bold"
                    style={{ background: ACCENT_SURFACE, color: ON_ACCENT }}
                    aria-hidden="true"
                  >
                    →
                  </span>
                </button>

                {/* Secondary actions (up to 2 more) — collapsed behind ONE
                    ghost disclosure so the primary action above stands alone.
                    The rows stay in the markup but are removed from both the
                    render and the accessibility tree while collapsed (the
                    `hidden` attribute), and the Tailwind `flex` utility is
                    applied ONLY when open so it cannot out-specify `[hidden]`.
                    Destinations are untouched. */}
                {queueData.queue.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowAlternatives((v) => !v)}
                      aria-expanded={showAlternatives}
                      aria-controls="mission-alternatives"
                      data-testid="mission-alternatives-toggle"
                      className="self-start inline-flex items-center gap-1.5 min-h-tap-min rounded-lg px-2 text-fluid-xs font-semibold transition-colors hover:opacity-80 focus:outline-none focus-visible:ring-2"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {isHi ? 'कुछ और?' : 'Something else?'}
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          transform: showAlternatives ? 'rotate(180deg)' : 'none',
                          transition: 'transform 160ms ease',
                        }}
                      >
                        ▾
                      </span>
                    </button>
                    <div
                      id="mission-alternatives"
                      hidden={!showAlternatives}
                      className={showAlternatives ? 'flex flex-col gap-2' : undefined}
                    >
                      {queueData.queue.slice(1, 3).map((item) => (
                        <button
                          key={item.rank}
                          type="button"
                          onClick={() => router.push(deepLinkToHref(item.deepLink))}
                          className="w-full text-left flex items-center gap-3 rounded-2xl px-4 py-2.5 min-h-tap-min transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
                          style={{
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span className="text-lg shrink-0" aria-hidden="true">{todayIcon(item.iconHint)}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-fluid-xs font-semibold truncate block" style={{ color: 'var(--text-2)' }}>
                              {todayCopy(item.labelKey, isHi)}
                            </span>
                            <span className="text-fluid-2xs truncate block" style={{ color: 'var(--text-3)' }}>
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
                          <span className="text-fluid-2xs shrink-0 font-data tabular-nums" style={{ color: 'var(--text-3)' }}>
                            ~{item.estMinutes}m
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Empty / error fallback — never collapse to nothing. Renders an
            actionable, friendly card (P7 bilingual) routing to /learn. Error
            and empty share this card; raw error text is never shown. A subtle
            retry re-runs the SWR fetch when the failure was an error.

            This card now carries the ONLY fallback CTA on the whole hero: the
            GlowButton that used to sit always-on below the queue was moved in
            here and took over the old ghost button's copy + testid. Because it
            renders only when `showEmptyState` is true, it can never appear
            alongside a queue row. */}
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
            <p className="text-fluid-base font-bold" style={{ color: 'var(--text-1)' }}>
              {isHi
                ? 'तुम्हारा सीखने का रास्ता तैयार हो रहा है'
                : 'Your learning path is getting ready'}
            </p>
            <p className="text-fluid-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'शुरू करने के लिए एक पाठ चुनो।'
                : 'Pick a lesson to begin.'}
            </p>
            {/* The single fallback action. GlowButton paints a
                `--orange → --orange-light` gradient with WHITE text, and those
                two tokens are not the warm channel this surface uses. We
                scope-override them on this wrapper ONLY, so the button renders
                burnt-orange (with its CSS-only shimmer) without touching
                GlowButton or the globals.
                The override now points at the CTA stops (ACCENT_FROM/ACCENT_TO,
                #CB4710 → #C2440F) rather than bare --accent-warm: white on
                #E8581C is 3.59:1 and fails AA, which is exactly what this
                override used to produce. */}
            <div
              className="mt-3"
              style={{
                ['--orange' as string]: ACCENT_FROM,
                ['--orange-light' as string]: ACCENT_TO,
              }}
            >
              <GlowButton
                size="lg"
                fullWidth
                onClick={beginLesson}
                className="md:w-auto"
                icon={<span aria-hidden="true">▶</span>}
                data-testid="mission-empty-cta"
              >
                <span>
                  {isHi ? 'पाठ चुनो' : 'Pick a lesson'}
                </span>
                <span aria-hidden="true" className="ml-1">→</span>
              </GlowButton>
            </div>
            {queueError && (
              <button
                type="button"
                onClick={() => retryQueue()}
                className="mt-2 inline-flex items-center min-h-tap-min text-fluid-xs font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 rounded"
                style={{ color: 'var(--text-3)' }}
                data-testid="mission-empty-retry"
              >
                {isHi ? 'फिर से कोशिश करें' : 'Try again'}
              </button>
            )}
          </div>
        )}
        </div>
      </div>
    </PremiumCard>
  );
}
