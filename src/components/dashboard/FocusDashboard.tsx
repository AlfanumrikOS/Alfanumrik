'use client';

/**
 * FocusDashboard — Single unified card above the fold.
 *
 * Hick's Law: "The more choices you give a user, the longer it takes to decide."
 *
 * BEFORE: 3 separate cards (Today's Goal, Continue Learning, Streak & XP)
 *         → Student saw 3 CTAs, all pointing to similar actions. Paralysis.
 *
 * AFTER: 1 card.
 *   - ONE action: the most important thing for this student RIGHT NOW.
 *   - ONE CTA button: no ambiguity.
 *   - Streak + XP: footer row inside the same card (info, not action).
 *
 * Upgrade rule: can add context beneath the CTA, never add a second CTA card.
 */

import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Button, ProgressBar, Skeleton } from '@/components/ui';
import { calculateLevel, xpToNextLevel, getLevelName, XP_PER_LEVEL } from '@/lib/xp-rules';
import type { CmeAction } from '@/lib/types';

interface FocusDashboardProps {
  studentId: string;
  studentName: string;
  isHi: boolean;
  grade: string;
  xp: number;
  level: number;
  streak: number;
  preferredSubject?: string | null;
}

/* ── Fetchers ── */

async function fetchLatestCmeAction(studentId: string): Promise<{
  cmeAction: CmeAction | null;
  lastSubject: string | null;
  lastTopic: string | null;
  lastMastery: number | null;
}> {
  const { data: session } = await supabase
    .from('quiz_sessions')
    .select('subject, cme_next_action, score_percent')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestMastery } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_probability')
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let topicName: string | null = null;
  if (latestMastery?.topic_id) {
    const { data: topic } = await supabase
      .from('curriculum_topics')
      .select('title')
      .eq('id', latestMastery.topic_id)
      .maybeSingle();
    topicName = topic?.title ?? null;
  }

  let cmeAction: CmeAction | null = null;
  if (session?.cme_next_action && typeof session.cme_next_action === 'object') {
    cmeAction = session.cme_next_action as CmeAction;
  }

  return {
    cmeAction,
    lastSubject: session?.subject ?? null,
    lastTopic: topicName,
    lastMastery: latestMastery?.mastery_probability != null
      ? Math.round(latestMastery.mastery_probability * 100)
      : null,
  };
}

async function fetchDueReviewCount(studentId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('spaced_repetition_cards')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .lte('next_review_date', today);

  if (count != null && count > 0) return count;

  const { count: cmCount } = await supabase
    .from('concept_mastery')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString());

  return cmCount ?? 0;
}

/* ── Action resolver ── */

type FocusAction = {
  icon: string;
  eyebrow: string;
  title: string;
  cta: string;
  href: string;
  // Optional context shown under the CTA — never a second action
  context?: string;
};

function resolveFocusAction(params: {
  isHi: boolean;
  isNewUser: boolean;
  dueCount: number;
  cmeAction: CmeAction | null;
  lastTopic: string | null;
  lastSubject: string | null;
}): FocusAction {
  const { isHi, isNewUser, dueCount, cmeAction, lastTopic, lastSubject } = params;

  // New user → single opinionated entry point
  if (isNewUser) {
    return {
      icon: '🦊',
      eyebrow: isHi ? 'शुरुआत करते हैं' : 'Let\'s get started',
      title: isHi ? 'अपनी पहली क्विज़ दो और जानो तुम कहाँ हो' : 'Take your first quiz — see where you stand',
      cta: isHi ? 'शुरू करो' : 'Start Now',
      href: '/quiz',
    };
  }

  // Spaced repetition due — highest priority (forgetting curve)
  if (dueCount >= 3) {
    const count = Math.min(dueCount, 5);
    return {
      icon: '🔄',
      eyebrow: isHi ? 'भूलने से पहले' : 'Before you forget',
      title: isHi
        ? `${count} टॉपिक रिव्यू करो — अभी`
        : `Review ${count} topic${count > 1 ? 's' : ''} before they fade`,
      cta: isHi ? 'रिव्यू करो' : 'Review Now',
      href: '/review',
      context: isHi
        ? 'स्पेस्ड रिपीटिशन: सही समय पर रिव्यू = लंबे समय तक याद'
        : 'Spaced repetition: reviewing now locks it in long-term',
    };
  }

  // CME recommendation — most accurate signal
  if (cmeAction) {
    if (cmeAction.type === 'teach' || cmeAction.type === 're_teach') {
      return {
        icon: '📖',
        eyebrow: isHi ? 'अगला अध्याय' : 'Next up',
        title: isHi ? `${cmeAction.title} सीखो` : `Learn: ${cmeAction.title}`,
        cta: isHi ? 'अभी सीखो' : 'Learn Now',
        href: '/foxy',
        context: isHi ? 'Foxy तुम्हें step-by-step सिखाएगी' : 'Foxy will teach you step by step',
      };
    }
    if (cmeAction.type === 'practice' || cmeAction.type === 'challenge') {
      return {
        icon: '⚡',
        eyebrow: isHi ? 'प्रैक्टिस टाइम' : 'Practice time',
        title: isHi ? `${cmeAction.title} की प्रैक्टिस करो` : `Practice: ${cmeAction.title}`,
        cta: isHi ? 'प्रैक्टिस' : 'Practice Now',
        href: '/quiz',
        context: lastSubject
          ? (isHi ? `विषय: ${lastSubject}` : `Subject: ${lastSubject}`)
          : undefined,
      };
    }
    if (cmeAction.type === 'revise' || cmeAction.type === 'remediate') {
      return {
        icon: '🧠',
        eyebrow: isHi ? 'दोहराना ज़रूरी है' : 'Time to revise',
        title: isHi ? `${cmeAction.title} दोहराओ` : `Revise: ${cmeAction.title}`,
        cta: isHi ? 'दोहराओ' : 'Revise',
        href: '/review',
      };
    }
  }

  // Has history: continue last topic via Foxy (not quiz — avoids triple-quiz)
  if (lastTopic) {
    return {
      icon: '▶',
      eyebrow: isHi ? 'जारी रखो' : 'Continue where you left off',
      title: lastTopic,
      cta: isHi ? 'जारी रखो' : 'Continue',
      href: '/foxy',
      context: lastSubject
        ? (isHi ? `विषय: ${lastSubject}` : `Subject: ${lastSubject}`)
        : undefined,
    };
  }

  // Fallback: do a quiz (only appears when there's genuinely nothing better)
  return {
    icon: '⚡',
    eyebrow: isHi ? 'आज का लक्ष्य' : "Today's goal",
    title: isHi ? 'एक क्विज़ पूरा करो' : 'Complete one quiz',
    cta: isHi ? 'क्विज़ दो' : 'Take Quiz',
    href: '/quiz',
  };
}

/* ── Component ── */

export default function FocusDashboard({
  studentId,
  studentName,
  isHi,
  grade,
  xp,
  level,
  streak,
  preferredSubject,
}: FocusDashboardProps) {
  const router = useRouter();

  const { data: cmeData, isLoading: cmeLoading } = useSWR(
    studentId ? `focus-cme/${studentId}` : null,
    () => fetchLatestCmeAction(studentId),
    { dedupingInterval: 10000, revalidateOnFocus: false }
  );

  const { data: dueCount = 0, isLoading: dueLoading } = useSWR(
    studentId ? `focus-due/${studentId}` : null,
    () => fetchDueReviewCount(studentId),
    { dedupingInterval: 10000, revalidateOnFocus: false }
  );

  const lvl = calculateLevel(xp);
  const prog = xpToNextLevel(xp);
  const levelName = getLevelName(lvl);
  const isNewUser = xp === 0 && !cmeData?.lastSubject;
  const loading = cmeLoading || dueLoading;

  const action = resolveFocusAction({
    isHi,
    isNewUser,
    dueCount,
    cmeAction: cmeData?.cmeAction ?? null,
    lastTopic: cmeData?.lastTopic ?? null,
    lastSubject: cmeData?.lastSubject ?? null,
  });

  return (
    <section aria-label={isHi ? 'फोकस कार्ड' : 'Focus Card'}>
      {/* ── Single unified card: action + XP/streak footer ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          border: '1.5px solid rgba(232,88,28,0.18)',
          boxShadow: '0 2px 20px rgba(232,88,28,0.06)',
          background: 'var(--surface-1)',
        }}
      >
        {/* Action section */}
        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton variant="text" width="35%" />
              <Skeleton variant="title" width="85%" />
              <Skeleton variant="text" width={140} height={44} />
            </div>
          ) : (
            <>
              {/* Eyebrow label */}
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--orange)' }}>
                {action.icon} {action.eyebrow}
              </p>

              {/* Primary action title */}
              <p
                className="text-base font-bold leading-snug mb-3"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
              >
                {action.title}
              </p>

              {/* ONE CTA — never two */}
              <Button
                variant="primary"
                size="md"
                onClick={() => router.push(action.href)}
                className="w-full"
              >
                {action.cta} →
              </Button>

              {/* Optional context line — never a clickable action */}
              {action.context && (
                <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                  {action.context}
                </p>
              )}
            </>
          )}
        </div>

        {/* XP + Streak footer — informational only, no CTA */}
        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}
        >
          {loading ? (
            <Skeleton variant="text" width="100%" height={16} />
          ) : (
            <div className="flex items-center gap-3">
              {/* Streak */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span style={{ fontSize: 16 }}>{streak > 0 ? '🔥' : '❄️'}</span>
                <span
                  className="text-sm font-bold"
                  style={{ color: streak > 0 ? 'var(--orange)' : 'var(--text-3)' }}
                >
                  {streak}
                </span>
                <span className="text-xs text-[var(--text-3)]">
                  {isHi ? 'दिन' : 'day'}{streak !== 1 && !isHi ? 's' : ''}
                </span>
              </div>

              <span className="text-[var(--border)]">·</span>

              {/* Level */}
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'var(--purple)12', color: 'var(--purple)', border: '1px solid var(--purple)25' }}
              >
                {isHi ? `स्तर ${lvl}` : `Lv ${lvl}`}
              </span>

              {/* XP progress */}
              <div className="flex-1 min-w-0">
                <ProgressBar
                  value={prog.progress}
                  color="var(--purple)"
                  height={6}
                  label={`${prog.current}/${XP_PER_LEVEL} XP`}
                  showPercent={false}
                />
              </div>

              {/* XP number */}
              <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-3)' }}>
                {prog.current} XP
              </span>
            </div>
          )}
        </div>
      </div>
      {/* ── NCERT Practice quick-link (secondary, below main card) ── */}
      <button
        onClick={() => router.push('/quiz/ncert')}
        className="mt-3 w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
        style={{
          border: '1.5px solid var(--border)',
          background: 'var(--surface-1)',
        }}
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: '#16A34A14', color: '#16A34A' }}
        >
          📚
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'NCERT अभ्यास' : 'NCERT Practice'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'MCQ · लघु उत्तर · दीर्घ उत्तर — CBSE शैली' : 'MCQ · Short Answer · Long Answer — CBSE style'}
          </div>
        </div>
        <span style={{ color: 'var(--text-3)', fontSize: 18 }}>›</span>
      </button>
    </section>
  );
}
