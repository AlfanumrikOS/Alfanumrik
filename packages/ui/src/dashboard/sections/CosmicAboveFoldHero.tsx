'use client';

/**
 * CosmicAboveFoldHero — the cosmic (ff_cosmic_redesign_v1 ON) composition of
 * the student "Today" home, faithful to the CEO-approved prototype
 * (alfa_design_src/31_*.js TodayScreen) but wired to REAL dashboard data only.
 *
 * This component is rendered ONLY when useCosmicTheme().cosmicEnabled is true.
 * When the flag is OFF the dashboard keeps its legacy AboveFoldHero DOM
 * untouched (page.tsx switches between the two), so flag-OFF is byte-identical.
 *
 * Display-only. No scoring (P1), XP (P2), progress, or anti-cheat logic lives
 * here — every number is a server value passed in as a prop. MasteryRing /
 * ProgressBar render server values verbatim.
 *
 * Faithful elements composed from the cosmic primitives:
 *   - Greeting header (good morning + name · grade)        → real student.name / grade
 *   - HERO streak+goal GlowCard with cosmic Foxy floating  → real streak / today XP / total XP
 *   - Today's plan list as cosmic plan cards               → real nextTopics (BKT)
 *   - Subject mastery 2-col grid w/ MasteryRing            → real allowedSubjects + bktMastery
 *   - Foxy/tutor invite MascotBubble                       → static encouragement copy
 *
 * Data provenance (REAL only — no prototype LEARN_DATA mocks):
 *   - name / grade        : Student (AuthContext)
 *   - streak              : students.current_streak (snapshot) via prop
 *   - totalXp             : students.xp_total (snapshot) via prop
 *   - todayXp / dailyGoal : today's xp_transactions sum vs XP_RULES.quiz_daily_cap (the
 *                           existing "daily goal" the legacy XPDailyStatus already shows).
 *                           The prototype shows "minutes done / goal"; we have no
 *                           per-day minutes datum, so we honestly surface today's XP
 *                           toward the real 200-XP daily goal instead of fabricating minutes.
 *   - plan items          : nextTopics (next BKT topics) — title / chapter / minutes / difficulty
 *   - subject rings       : allowedSubjects (code/name/icon/color) × bktMastery[code] (server %)
 *
 * P7 (bilingual): every visible string branches on isHi. Technical terms
 * (XP, CBSE) are not translated. Hindi parity references the prototype's hi
 * strings in alfa_design_src/39_*.js.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';
import { XP_RULES } from '@alfanumrik/lib/xp-config';
import { GlowCard, MasteryRing, Chip, CosmicButton, MascotBubble } from '@alfanumrik/ui/cosmic';
import { FoxyMark } from '@alfanumrik/ui/landing/FoxyMark';
import { trackDashboardCta } from '@alfanumrik/lib/posthog/dashboard-cta';
import type { CurriculumTopic, Student } from '@alfanumrik/lib/types';
import type { Subject as AllowedSubject } from '@alfanumrik/lib/subjects.types';

interface CosmicAboveFoldHeroProps {
  student: Student;
  /** students.current_streak (server). Display only. */
  streak: number;
  /** students.xp_total (server). Display only. */
  totalXp: number;
  isHi: boolean;
  /** Next BKT topics — the real source for the "Today's plan" cards. */
  nextTopics: CurriculumTopic[];
  /** Unlocked subjects (code/name/icon/color) for the mastery grid. */
  allowedSubjects: AllowedSubject[];
  /** Per-subject average mastery_probability% from concept_mastery (server). */
  bktMastery: Record<string, number>;
  /** Greeting string already localized to time-of-day + isHi by the caller. */
  greeting: string;
  /** Unread notification count (server) for the bell badge. */
  unreadCount: number;
  /** Open the subject picker bottom sheet (owned by page.tsx). */
  onPickSubjects: () => void;
}

const DAILY_GOAL_XP = XP_RULES.quiz_daily_cap; // 200 — the real, single source of daily goal.

export default function CosmicAboveFoldHero({
  student,
  streak,
  totalXp,
  isHi,
  nextTopics,
  allowedSubjects,
  bktMastery,
  greeting,
  unreadCount,
  onPickSubjects,
}: CosmicAboveFoldHeroProps) {
  const router = useRouter();

  // Today's earned XP (real) — same source XPDailyStatus reads, used here to
  // drive the hero "goal" progress. Display-only; never recomputed into score.
  const [todayXp, setTodayXp] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          'get_daily_xp_by_category',
          { p_student_id: student.id },
        );
        if (!rpcErr && rpcData && !cancelled) {
          const sum = (rpcData as Array<{ total_xp: number }>).reduce(
            (a, r) => a + (Number(r.total_xp) || 0),
            0,
          );
          setTodayXp(sum);
          return;
        }
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: txns } = await supabase
          .from('xp_transactions')
          .select('amount')
          .eq('student_id', student.id)
          .gte('created_at', todayStart.toISOString());
        if (cancelled) return;
        setTodayXp((txns ?? []).reduce((a, t) => a + (Number(t.amount) || 0), 0));
      } catch {
        if (!cancelled) setTodayXp(0); // non-fatal — hero still renders the goal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student.id]);

  const gradeLabel = student.grade
    ? isHi
      ? `कक्षा ${student.grade}`
      : `Class ${student.grade}`
    : '';

  const doneXp = todayXp ?? 0;
  const remainingXp = Math.max(0, DAILY_GOAL_XP - doneXp);
  const hasSubjects = allowedSubjects.length > 0;

  const subjectMeta = (code: string | null | undefined) =>
    code ? allowedSubjects.find((s) => s.code === code) : undefined;
  const preferredSubject = student.preferred_subject;
  const continueTopic = nextTopics[0];
  // A chapter deep-link needs a known subject; fall back to Foxy when either
  // the chapter number or the preferred subject is missing.
  const continueDest =
    continueTopic?.chapter_number && preferredSubject
      ? `/learn/${preferredSubject}/${continueTopic.chapter_number}`
      : '/foxy';

  return (
    <div className="cosmic-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Greeting header ─────────────────────────────────────────────────
          good morning + name · grade. Matches prototype TodayScreen header. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>
            {greeting} <span aria-hidden="true">✨</span>
          </div>
          <h1
            className="cosmic-h-display"
            style={{ fontSize: 24, lineHeight: 1.1, marginTop: 2, color: 'var(--text)' }}
            data-testid="cosmic-greeting-name"
          >
            {student.name}
            {gradeLabel && (
              <span style={{ color: 'var(--text-3)', fontSize: 13, fontWeight: 500 }}>
                {' '}· {gradeLabel}
              </span>
            )}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => router.push('/notifications')}
          className="cosmic-icon-btn"
          aria-label={isHi ? 'सूचनाएँ' : 'Notifications'}
          style={{ position: 'relative', flexShrink: 0 }}
        >
          <span aria-hidden="true" style={{ fontSize: 16 }}>🔔</span>
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                width: 7,
                height: 7,
                borderRadius: 99,
                background: 'var(--coral)',
              }}
            />
          )}
        </button>
      </div>

      {/* ── HERO: streak + goal GlowCard with cosmic Foxy ───────────────────
          Real streak chip, real today-XP/goal, real total XP, primary CTA. */}
      <GlowCard style={{ padding: 18, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Chip tone="saffron" style={{ marginBottom: 12 }} icon={<span aria-hidden="true">🔥</span>}>
              {streak} {isHi ? 'दिन की लय' : 'day streak'}
            </Chip>

            <div className="cosmic-h-display" style={{ fontSize: 22, lineHeight: 1.15, color: 'var(--text)' }}>
              {remainingXp > 0 ? (
                <>
                  {isHi ? 'आज का लक्ष्य' : "You're"}{' '}
                  <span style={{ color: 'var(--violet)' }}>
                    {isHi
                      ? `${remainingXp} XP दूर`
                      : `${remainingXp} XP from today's goal`}
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--mint)' }}>
                  {isHi ? 'आज का लक्ष्य पूरा! 🎉' : "Today's goal complete! 🎉"}
                </span>
              )}
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <div>
                <div className="cosmic-h-display cosmic-tab-num" style={{ fontSize: 26, color: 'var(--text)' }}>
                  {doneXp}
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/{DAILY_GOAL_XP}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {isHi ? 'आज XP' : 'XP today'}
                </div>
              </div>
              <div>
                <div
                  className="cosmic-h-display cosmic-tab-num"
                  style={{ fontSize: 26, color: 'var(--saffron)' }}
                >
                  {totalXp.toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {isHi ? 'कुल XP' : 'Total XP'}
                </div>
              </div>
            </div>

            <CosmicButton
              style={{ marginTop: 14, width: '100%' }}
              icon={<span aria-hidden="true">▶</span>}
              data-testid="cosmic-primary-cta"
              onClick={() => {
                trackDashboardCta({
                  section: 'above_fold_hero',
                  action: 'cosmic_continue_cta',
                  destination: continueDest,
                });
                router.push(continueTopic ? continueDest : '/quiz');
              }}
            >
              {isHi ? 'जारी रखें' : 'Continue'}
            </CosmicButton>
          </div>

          {/* Cosmic Foxy floats top-right of the hero. */}
          <div style={{ flexShrink: 0, marginTop: -4 }}>
            <FoxyMark variant="cosmic" px={92} />
          </div>
        </div>
      </GlowCard>

      {/* ── Foxy invite bubble ──────────────────────────────────────────────
          Encouragement nudge to open the cosmic tutor. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            trackDashboardCta({
              section: 'above_fold_hero',
              action: 'cosmic_foxy_bubble',
              destination: '/foxy',
            });
            router.push('/foxy');
          }}
          aria-label={isHi ? 'Foxy से पूछें' : 'Ask Foxy'}
          style={{ flexShrink: 0, marginTop: 2, background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
        >
          <FoxyMark variant="cosmic" px={32} />
        </button>
        <MascotBubble style={{ flex: 1 }}>
          {isHi
            ? `नमस्ते ${student.name}! आज कुछ नया सीखें — मैं मदद के लिए यहाँ हूँ।`
            : `Hi ${student.name}! Ready to learn something today? Tap me anytime for help.`}
        </MascotBubble>
      </div>

      {/* ── Today's plan ────────────────────────────────────────────────────
          Real next BKT topics rendered as cosmic plan cards. The first is the
          "current" focus; the rest are upcoming. No "done" status is shown
          because we have no per-topic completion datum here (real-data rule). */}
      {nextTopics.length > 0 && (
        <>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="cosmic-h-display" style={{ fontSize: 16, color: 'var(--text)' }}>
              {isHi ? 'आज की योजना' : "Today's plan"}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextTopics.map((topic, i) => {
              const isCurrent = i === 0;
              const meta = subjectMeta(preferredSubject);
              const title = isHi && topic.title_hi ? topic.title_hi : topic.title;
              const difficulty = Math.max(1, Math.min(5, topic.difficulty_level || 1));
              const dest =
                topic.chapter_number && preferredSubject
                  ? `/learn/${preferredSubject}/${topic.chapter_number}`
                  : '/foxy';
              return (
                <button
                  key={topic.id}
                  onClick={() => {
                    trackDashboardCta({
                      section: 'above_fold_hero',
                      action: 'cosmic_plan_card',
                      destination: dest,
                    });
                    router.push(dest);
                  }}
                  className="cosmic-card"
                  style={{
                    padding: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                    appearance: 'none',
                    cursor: 'pointer',
                    color: 'var(--text)',
                    borderColor: isCurrent ? 'var(--stroke-glow)' : 'var(--stroke)',
                    background: isCurrent ? 'var(--bg-card-2)' : 'var(--bg-card)',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      background: isCurrent
                        ? (meta?.color ?? 'var(--violet)')
                        : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    {isCurrent ? '▶' : (meta?.icon ?? '📘')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-3)',
                        marginTop: 2,
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      {meta?.name && <span>{meta.name}</span>}
                      {topic.estimated_minutes != null && (
                        <>
                          {meta?.name && <span aria-hidden="true">·</span>}
                          <span>{topic.estimated_minutes} {isHi ? 'मिनट' : 'min'}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span aria-label={isHi ? `कठिनाई ${difficulty}/5` : `Difficulty ${difficulty} of 5`}>
                        {'●'.repeat(difficulty)}
                        <span style={{ opacity: 0.25 }}>{'●'.repeat(5 - difficulty)}</span>
                      </span>
                    </div>
                  </div>
                  <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: 16 }}>
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Subject mastery rings ───────────────────────────────────────────
          2-col grid of cosmic cards: MasteryRing (server %) + subject label.
          The prototype shows "min today"; we have no per-subject daily minutes,
          so we show the real mastery % subtitle / a "Start lesson" hint. */}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="cosmic-h-display" style={{ fontSize: 16, color: 'var(--text)' }}>
          {isHi ? 'विषय' : 'Subjects'}
        </div>
      </div>

      {hasSubjects ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {allowedSubjects.slice(0, 4).map((s) => {
            const mastery = Math.max(0, Math.min(100, bktMastery[s.code] ?? 0));
            return (
              <button
                key={s.code}
                onClick={() => {
                  trackDashboardCta({
                    section: 'above_fold_hero',
                    action: 'cosmic_subject_card',
                    destination: '/progress',
                  });
                  router.push('/progress');
                }}
                className="cosmic-card"
                style={{
                  padding: 14,
                  textAlign: 'left',
                  cursor: 'pointer',
                  appearance: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  color: 'var(--text)',
                }}
              >
                <MasteryRing
                  percent={mastery}
                  size={44}
                  fromColor={s.color}
                  label={isHi ? `${s.nameHi} महारत ${mastery}%` : `${s.name} mastery ${mastery}%`}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{mastery}</span>
                </MasteryRing>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isHi ? s.nameHi : s.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {mastery > 0
                      ? isHi
                        ? `${mastery}% महारत`
                        : `${mastery}% mastery`
                      : isHi
                        ? 'पाठ शुरू करें'
                        : 'Start lesson'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        // Zero-state — no subjects selected yet. Route to the picker the page owns.
        <GlowCard style={{ padding: 18 }}>
          <div className="cosmic-h-display" style={{ fontSize: 16, color: 'var(--text)' }}>
            {isHi ? 'अपने विषय चुनें' : 'Choose your subjects'}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
            {isHi ? 'सीखना शुरू करने के लिए विषय चुनें' : 'Select subjects to unlock learning'}
          </p>
          <CosmicButton
            style={{ marginTop: 14 }}
            onClick={() => {
              trackDashboardCta({
                section: 'above_fold_hero',
                action: 'cosmic_pick_subjects',
                destination: 'modal:subject_picker',
              });
              onPickSubjects();
            }}
          >
            {isHi ? '+ विषय चुनें' : '+ Choose subjects'}
          </CosmicButton>
        </GlowCard>
      )}
    </div>
  );
}
