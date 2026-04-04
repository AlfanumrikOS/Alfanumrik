'use client';

/**
 * FocusDashboard — 3-card "one thing at a time" experience
 *
 * Based on Cognitive Load Theory (Hick's Law): fewer choices = more engagement.
 * Shows: Today's Goal, Continue Learning, Streak & XP.
 *
 * Data sources:
 * - Student profile (XP, level, streak) from props (already in AuthContext)
 * - Latest quiz session CME recommendation via SWR
 * - Due review count via SWR
 */

import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { Card, Button, MasteryRing, ProgressBar, Skeleton } from '@/components/ui';
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
  // Get most recent quiz session with CME recommendation
  const { data: session } = await supabase
    .from('quiz_sessions')
    .select('subject, cme_next_action, score_percent')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get latest concept mastery for "continue learning"
  const { data: latestMastery } = await supabase
    .from('concept_mastery')
    .select('topic_id, mastery_probability')
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get the topic name for the mastery entry
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
  // Try spaced repetition cards first
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('spaced_repetition_cards')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .lte('next_review_date', today);

  if (count != null && count > 0) return count;

  // Fallback: concept_mastery due items
  const { count: cmCount } = await supabase
    .from('concept_mastery')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString());

  return cmCount ?? 0;
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

  // SWR: CME action + last session data
  const { data: cmeData, isLoading: cmeLoading } = useSWR(
    studentId ? `focus-cme/${studentId}` : null,
    () => fetchLatestCmeAction(studentId),
    { dedupingInterval: 10000, revalidateOnFocus: false }
  );

  // SWR: due review count
  const { data: dueCount = 0, isLoading: dueLoading } = useSWR(
    studentId ? `focus-due/${studentId}` : null,
    () => fetchDueReviewCount(studentId),
    { dedupingInterval: 10000, revalidateOnFocus: false }
  );

  const lvl = calculateLevel(xp);
  const prog = xpToNextLevel(xp);
  const levelName = getLevelName(lvl);
  const isNewUser = xp === 0 && !cmeData?.lastSubject;

  /* ── Resolve Today's Goal ── */
  function getTodaysGoal(): { text: string; cta: string; href: string } {
    if (isNewUser) {
      return {
        text: isHi ? 'अपनी पहली क्विज़ शुरू करो!' : 'Start your first quiz to begin your journey!',
        cta: isHi ? 'शुरू करो' : 'Start Now',
        href: '/quiz',
      };
    }

    if (dueCount > 0) {
      const count = Math.min(dueCount, 5);
      return {
        text: isHi
          ? `${count} विषय रिव्यू करो, भूलने से पहले`
          : `Review ${count} topic${count > 1 ? 's' : ''} before they fade`,
        cta: isHi ? 'रिव्यू करो' : 'Review Now',
        href: '/review',
      };
    }

    const cme = cmeData?.cmeAction;
    if (cme) {
      if (cme.type === 'teach' || cme.type === 're_teach') {
        return {
          text: isHi
            ? `कुछ नया सीखो: ${cme.title}`
            : `Learn something new: ${cme.title}`,
          cta: isHi ? 'सीखो' : 'Learn',
          href: '/foxy',
        };
      }
      if (cme.type === 'practice' || cme.type === 'challenge') {
        return {
          text: isHi
            ? `${cme.title} की प्रैक्टिस करो`
            : `Practice ${cme.title} to build fluency`,
          cta: isHi ? 'प्रैक्टिस' : 'Practice',
          href: '/quiz',
        };
      }
      if (cme.type === 'revise' || cme.type === 'remediate') {
        return {
          text: isHi
            ? `${cme.title} दोहराओ`
            : `Revise ${cme.title}`,
          cta: isHi ? 'दोहराओ' : 'Revise',
          href: '/review',
        };
      }
    }

    // Default: take a quiz
    return {
      text: isHi ? 'आज 1 क्विज़ पूरा करो' : 'Complete 1 quiz today',
      cta: isHi ? 'क्विज़ शुरू करो' : 'Start Quiz',
      href: '/quiz',
    };
  }

  const goal = getTodaysGoal();
  const loading = cmeLoading || dueLoading;

  return (
    <section aria-label={isHi ? 'फोकस डैशबोर्ड' : 'Focus Dashboard'} className="space-y-3">

      {/* ── Card 1: Today's Goal ── */}
      <Card accent="var(--orange)">
        {loading ? (
          <div className="space-y-2">
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="title" width="90%" />
            <Skeleton variant="text" width={120} height={40} />
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--orange)' }}>
              {isHi ? 'आज का लक्ष्य' : "Today's Goal"}
            </p>
            <p
              className="text-base font-bold mt-1.5 leading-snug"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
            >
              {goal.text}
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-3"
              onClick={() => router.push(goal.href)}
            >
              {goal.cta} →
            </Button>
          </>
        )}
      </Card>

      {/* ── Card 2: Continue Learning ── */}
      <Card
        hoverable
        onClick={() => {
          if (cmeData?.lastSubject) {
            router.push(`/quiz?subject=${cmeData.lastSubject}`);
          } else {
            router.push('/quiz');
          }
        }}
      >
        {loading ? (
          <div className="flex items-center gap-4">
            <Skeleton variant="circle" width={56} height={56} />
            <div className="flex-1 space-y-2">
              <Skeleton variant="text" width="50%" />
              <Skeleton variant="title" width="80%" />
            </div>
          </div>
        ) : cmeData?.lastTopic ? (
          <div className="flex items-center gap-4">
            <MasteryRing
              value={cmeData.lastMastery ?? 0}
              size={56}
              strokeWidth={4}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text-3)]">
                {isHi ? 'सीखना जारी रखें' : 'Continue Learning'}
              </p>
              <p
                className="text-sm font-bold truncate mt-0.5"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
              >
                {cmeData.lastTopic}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {cmeData.lastSubject
                  ? `${cmeData.lastSubject.charAt(0).toUpperCase()}${cmeData.lastSubject.slice(1)} · ${isHi ? `कक्षा ${grade}` : `Grade ${grade}`}`
                  : isHi ? `कक्षा ${grade}` : `Grade ${grade}`}
              </p>
            </div>
            <span className="text-lg flex-shrink-0" aria-hidden="true">→</span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="text-2xl">📚</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text-3)]">
                {isHi ? 'सीखना जारी रखें' : 'Continue Learning'}
              </p>
              <p
                className="text-sm font-bold mt-0.5"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
              >
                {isHi ? 'अपना विषय चुनो' : 'Pick a subject to start'}
              </p>
            </div>
            <span className="text-lg flex-shrink-0" aria-hidden="true">→</span>
          </div>
        )}
      </Card>

      {/* ── Card 3: Streak & XP ── */}
      <Card>
        {loading ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton variant="text" width={60} />
              <Skeleton variant="text" width={100} />
            </div>
            <Skeleton variant="text" height={8} />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              {/* Streak */}
              <div className="flex items-center gap-2">
                <span className={streak > 0 ? 'streak-flame' : ''} style={{ fontSize: 20 }}>
                  🔥
                </span>
                <div>
                  <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: streak > 0 ? 'var(--orange)' : 'var(--text-3)' }}>
                    {streak}
                  </span>
                  <span className="text-xs text-[var(--text-3)] ml-1">
                    {isHi ? (streak === 1 ? 'दिन' : 'दिन') : (streak === 1 ? 'day' : 'days')}
                  </span>
                </div>
              </div>

              {/* Level badge */}
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--purple)12', color: 'var(--purple)', border: '1px solid var(--purple)25' }}
                >
                  {isHi ? `स्तर ${lvl}` : `Lv ${lvl}`}
                </span>
                <span className="text-xs text-[var(--text-3)]">{levelName}</span>
              </div>
            </div>

            {/* XP progress bar */}
            <ProgressBar
              value={prog.progress}
              color="var(--purple)"
              height={8}
              label={`${prog.current} / ${XP_PER_LEVEL} XP`}
              showPercent={false}
            />

            {/* Streak nudge */}
            {streak >= 3 && (
              <p className="text-xs mt-2.5 font-medium" style={{ color: 'var(--orange)' }}>
                {isHi
                  ? `अपनी ${streak} दिन की स्ट्रीक मत तोड़ो!`
                  : `Don't break your ${streak}-day streak!`}
              </p>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
