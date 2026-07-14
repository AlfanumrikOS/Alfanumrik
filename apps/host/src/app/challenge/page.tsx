'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { LoadingFoxy, Button, Card, SectionHeader } from '@alfanumrik/ui/ui';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { supabase } from '@alfanumrik/lib/supabase';
import DailyChallengeCard from '@alfanumrik/ui/challenge/DailyChallengeCard';
import StreakBadge from '@alfanumrik/ui/challenge/StreakBadge';
import ShareResultCard from '@alfanumrik/ui/challenge/ShareResultCard';
import ClassChallengeBoard from '@alfanumrik/ui/challenge/ClassChallengeBoard';
import { selectCardsForStudent, type ChallengeData, type StudentChallenge } from '@alfanumrik/lib/challenge-engine';
import { getDifficultyForZPD, GRACE_PERIOD_DAYS, CHALLENGE_COINS } from '@alfanumrik/lib/challenge-config';
import { processStreakDay, detectMilestones, type StreakState } from '@alfanumrik/lib/challenge-streak';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import {
  rankChallengesByWeakTopics,
  type RankableChallenge,
} from '@alfanumrik/lib/challenge/rank-by-weak-topics';
import type { WeakTopic } from '@alfanumrik/lib/state/learner-loop/weak-topics';

// Lazy-load the game component to reduce initial page weight
const ConceptChain = dynamic(() => import('@alfanumrik/ui/challenge/ConceptChain'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <div className="text-4xl animate-float">🧩</div>
    </div>
  ),
});

/* ═══════════════════════════════════════════════════════════════
   /challenge — Daily Challenge Page (Concept Chain Game)
   States: loading, locked, unlocked/playing, solved, no-challenge
   ═══════════════════════════════════════════════════════════════ */

type PageState = 'loading' | 'locked' | 'playing' | 'solved' | 'no-challenge';

/** Get today's date in IST as YYYY-MM-DD */
function getTodayIST(): string {
  const now = new Date();
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

export default function ChallengePage() {
  const { student, isLoggedIn, isLoading, isHi, activeRole } = useAuth();
  const router = useRouter();
  // ADR-001 Phase 5 follow-on — picks personalised challenge when on.
  const { data: ccFlags } = useFeatureFlags();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [challenge, setChallenge] = useState<any>(null);
  const [streakState, setStreakState] = useState<StreakState | null>(null);
  const [studentChallenge, setStudentChallenge] = useState<StudentChallenge | null>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [milestones, setMilestones] = useState<Array<{ badgeLabel: string; badgeLabelHi: string; badgeIcon: string; coins: number }>>([]);
  const [showMilestone, setShowMilestone] = useState(false);
  // True when the picked challenge matched the student's weak-topic set.
  // Drives the "🎯 Personalised" badge on the play card.
  const [isPersonalised, setIsPersonalised] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const todayStr = useRef(getTodayIST());

  // Redirect if not logged in or wrong role
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
  }, [isLoading, isLoggedIn, activeRole, router]);

  // ── Main data fetch ──
  const loadData = useCallback(async () => {
    if (!student) return;
    setPageState('loading');

    try {
      const today = todayStr.current;

      // ADR-001 Phase 5 follow-on — when ff_personalised_compete_v1 is
      // on, fetch up to 12 candidate challenges (not just the first)
      // plus the student's weak-topic stack so we can pick the best
      // match. When off, behaves identically to the legacy single-pick.
      const personaliseOn = ccFlags?.ff_personalised_compete_v1 === true;
      const challengeLimit = personaliseOn ? 12 : 1;

      // Parallel fetches
      const [challengeRes, streakRes, attemptRes, weakTopicsRes] = await Promise.all([
        // 1. Fetch today's challenge(s) for student's grade
        supabase
          .from('daily_challenges')
          .select('*')
          .eq('grade', student.grade)
          .eq('challenge_date', today)
          .in('status', ['approved', 'live', 'auto_generated'])
          .limit(challengeLimit),

        // 2. Fetch streak
        supabase
          .from('challenge_streaks')
          .select('*')
          .eq('student_id', student.id)
          .limit(1)
          .single(),

        // 3. Check for existing attempt today (solved?)
        supabase
          .from('challenge_attempts')
          .select('*')
          .eq('student_id', student.id)
          .eq('challenge_date', today)
          .limit(1)
          .maybeSingle(),

        // 4. Personalisation input. 404 (flag off / no profile / no weak
        //    topics) is the expected "fall back to first" path.
        personaliseOn
          ? fetch('/api/learner/weak-topics', { credentials: 'same-origin' })
              .then(r => (r.ok ? r.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      // Parse streak (may not exist)
      const streak: StreakState = streakRes.data
        ? {
            currentStreak: streakRes.data.current_streak ?? 0,
            bestStreak: streakRes.data.best_streak ?? 0,
            lastChallengeDate: streakRes.data.last_challenge_date ?? null,
            mercyDaysUsedThisWeek: streakRes.data.mercy_days_used_this_week ?? 0,
            mercyWeekStart: streakRes.data.mercy_week_start ?? null,
            badges: streakRes.data.badges ?? [],
          }
        : {
            currentStreak: 0,
            bestStreak: 0,
            lastChallengeDate: null,
            mercyDaysUsedThisWeek: 0,
            mercyWeekStart: null,
            badges: [],
          };
      setStreakState(streak);

      // No challenge for today (array now since we removed .single())
      const candidateChallenges = Array.isArray(challengeRes.data)
        ? challengeRes.data
        : [];
      if (candidateChallenges.length === 0) {
        setPageState('no-challenge');
        return;
      }

      // Pick the best challenge. When the flag is off or weak-topics
      // are unavailable, rankChallengesByWeakTopics returns the first
      // input (matches legacy behaviour).
      const weakTopics: WeakTopic[] = (() => {
        const r = weakTopicsRes as { items?: unknown } | null;
        if (!r || !Array.isArray(r.items)) return [];
        return r.items as WeakTopic[];
      })();
      const rank = rankChallengesByWeakTopics(
        candidateChallenges as RankableChallenge[],
        weakTopics,
      );
      // The picked row is a daily_challenges row (not a ChallengeData
      // payload); ChallengeData lives at .challenge_data on the row.
      // Keep as `any` here to match the legacy single() shape — the
      // downstream code reads .subject / .topic / .challenge_data.
      const todayChallenge = (rank.picked ?? candidateChallenges[0]) as any;
      setChallenge(todayChallenge);
      setIsPersonalised(rank.score > 0);

      // Already solved?
      if (attemptRes.data && attemptRes.data.solved) {
        setAttempt(attemptRes.data);
        setPageState('solved');
        return;
      }

      // ── Check effort gate ──
      let isUnlocked = false;

      // Grace period: new students always unlocked
      if (student.created_at) {
        const createdDate = new Date(student.created_at);
        const now = new Date();
        const daysSinceCreation = Math.floor(
          (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceCreation <= GRACE_PERIOD_DAYS) {
          isUnlocked = true;
        }
      }

      // Check quiz sessions for today (completed, >= 5 questions)
      if (!isUnlocked) {
        const todayStart = `${today}T00:00:00+05:30`;
        const { data: quizToday } = await supabase
          .from('quiz_sessions')
          .select('id, total_questions')
          .eq('student_id', student.id)
          .gte('created_at', todayStart)
          .eq('status', 'completed')
          .gte('total_questions', 5)
          .limit(1);

        if (quizToday && quizToday.length > 0) {
          isUnlocked = true;
        }
      }

      if (!isUnlocked) {
        setPageState('locked');
        return;
      }

      // ── Prepare game cards ──
      const challengeData = todayChallenge.challenge_data as ChallengeData | null;
      if (!challengeData || !challengeData.baseChain || challengeData.baseChain.length === 0) {
        setPageState('no-challenge');
        return;
      }

      // Get student mastery to determine difficulty
      let mastery = 0.5; // default
      try {
        const { data: masteryData } = await supabase
          .from('concept_mastery')
          .select('mastery_probability')
          .eq('student_id', student.id)
          .gt('mastery_probability', 0);

        if (masteryData && masteryData.length > 0) {
          mastery =
            masteryData.reduce((sum: number, r: any) => sum + (r.mastery_probability ?? 0), 0) /
            masteryData.length;
        }
      } catch {
        // Non-fatal: use default mastery
      }

      const difficulty = getDifficultyForZPD(mastery);
      const selected = selectCardsForStudent(challengeData, difficulty);
      setStudentChallenge(selected);
      startTimeRef.current = Date.now();
      setPageState('playing');
    } catch (err) {
      console.warn('[challenge] Failed to load data:', err);
      setPageState('no-challenge');
    }
  }, [student, ccFlags?.ff_personalised_compete_v1]);

  useEffect(() => {
    if (student) loadData();
  }, [student, student?.id, loadData]);

  // ── On solve callback ──
  const handleSolved = useCallback(
    async (moves: number, hintsUsed: number, distractorsExcluded: number) => {
      if (!student || !challenge || !streakState) return;

      const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
      const coinsEarned = CHALLENGE_COINS.solve;

      // 1. Submit attempt via RPC
      try {
        await supabase.rpc('submit_challenge_attempt', {
          p_student_id: student.id,
          p_challenge_id: challenge.id,
          p_solved: true,
          p_moves: moves,
          p_hints_used: hintsUsed,
          p_distractors_excluded: distractorsExcluded,
          p_time_spent: timeSpent,
          p_coins_earned: coinsEarned,
        });
      } catch (err) {
        console.warn('[challenge] submit_challenge_attempt RPC failed:', err);
        // Fallback: insert directly
        try {
          await supabase.from('challenge_attempts').insert({
            student_id: student.id,
            challenge_id: challenge.id,
            challenge_date: todayStr.current,
            solved: true,
            moves,
            hints_used: hintsUsed,
            distractors_excluded: distractorsExcluded,
            time_spent: timeSpent,
            coins_earned: coinsEarned,
          });
        } catch {
          // Non-fatal: attempt recorded on next visit
        }
      }

      // 2. Process streak locally
      const previousStreak = streakState.currentStreak;
      const newStreakState = processStreakDay(streakState, todayStr.current, student.grade);
      setStreakState(newStreakState);

      // 3. Check milestones
      const newMilestones = detectMilestones(previousStreak, newStreakState.currentStreak, streakState.badges);
      if (newMilestones.length > 0) {
        setMilestones(newMilestones);
        setShowMilestone(true);
      }

      // 4. Store attempt for display
      setAttempt({
        solved: true,
        moves,
        hints_used: hintsUsed,
        distractors_excluded: distractorsExcluded,
        time_spent: timeSpent,
        coins_earned: coinsEarned,
      });

      setPageState('solved');
    },
    [student, challenge, streakState]
  );

  // ── Loading state ──
  if (isLoading || !student) {
    return <LoadingFoxy />;
  }

  // ── Render based on page state ──
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="rounded-xl p-2.5 transition-all"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              aria-label={isHi ? 'वापस जाओ' : 'Go back'}
            >
              <span className="text-lg">{'\u2190'}</span>
            </button>
            <div>
              <h1
                className="text-lg font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'डेली चैलेंज' : 'Daily Challenge'}
              </h1>
              <p className="text-xs text-[var(--text-3)]">
                {todayStr.current}
              </p>
            </div>
          </div>

          {/* Streak badge */}
          {streakState && (
            <StreakBadge
              streak={streakState.currentStreak}
              badges={streakState.badges}
              isHi={isHi}
              size="md"
            />
          )}
        </div>

        <SectionErrorBoundary section="Daily Challenge">
          {/* ══ LOADING STATE ══ */}
          {pageState === 'loading' && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center space-y-3">
                <div className="text-5xl animate-float">🧩</div>
                <p className="text-sm text-[var(--text-3)]">
                  {isHi ? 'चैलेंज लोड हो रहा है...' : 'Loading challenge...'}
                </p>
              </div>
            </div>
          )}

          {/* ══ LOCKED STATE ══ */}
          {pageState === 'locked' && (
            <div className="space-y-5 animate-fade-in">
              {/* Subject + topic preview */}
              <Card>
                <div className="text-center py-4 space-y-3">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    {'\uD83D\uDD12'}
                  </div>

                  {challenge && (
                    <div>
                      <p className="text-sm font-bold text-[var(--text-1)]">
                        {isHi
                          ? challenge.subject_hi || challenge.subject
                          : challenge.subject}
                      </p>
                      {challenge.topic && (
                        <p className="text-xs text-[var(--text-3)] mt-0.5">
                          {challenge.topic}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-sm text-[var(--text-2)] max-w-xs mx-auto">
                    {isHi
                      ? 'अनलॉक करने के लिए एक क्विज़ या Foxy सेशन पूरा करो'
                      : 'Complete a quiz or Foxy session to unlock'}
                  </p>
                </div>
              </Card>

              {/* Unlock CTAs */}
              <div className="space-y-2">
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  onClick={() => router.push('/foxy')}
                >
                  {isHi ? '🦊 Foxy से बात करो' : '🦊 Chat with Foxy'}
                </Button>
                <Button
                  variant="soft"
                  fullWidth
                  color="#7C3AED"
                  onClick={() => router.push('/quiz')}
                >
                  {isHi ? '📝 क्विज़ खेलो' : '📝 Take a Quiz'}
                </Button>
              </div>

              {/* Streak info */}
              {streakState && streakState.currentStreak > 0 && (
                <div className="text-center">
                  <p className="text-xs text-[var(--text-3)]">
                    {isHi
                      ? `तुम्हारी स्ट्रीक: ${streakState.currentStreak} दिन | सबसे अच्छी: ${streakState.bestStreak} दिन`
                      : `Your streak: ${streakState.currentStreak} days | Best: ${streakState.bestStreak} days`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ══ PLAYING STATE ══ */}
          {pageState === 'playing' && studentChallenge && challenge && (
            <div className="space-y-4 animate-fade-in">
              {/* Challenge info */}
              <div
                className="rounded-xl p-3 flex items-center gap-3"
                style={{
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.06), rgba(232, 88, 28, 0.04))',
                  border: '1px solid rgba(124, 58, 237, 0.15)',
                }}
              >
                <span className="text-xl" aria-hidden="true">🧩</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[var(--text-1)]">
                    {isHi
                      ? 'कार्ड को सही क्रम में लगाओ'
                      : 'Arrange cards in the correct order'}
                  </p>
                  {challenge.topic && (
                    <p className="text-xs text-[var(--text-3)] truncate">
                      {challenge.topic}
                    </p>
                  )}
                </div>
                {/* ADR-001 Phase 5 follow-on — "Personalised" pill when
                    today's challenge matches a weak-topic in the
                    student's state. Hidden when the flag is off or no
                    match. */}
                {isPersonalised && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: 'rgba(124, 58, 237, 0.10)',
                      color: 'var(--purple, #7C3AED)',
                      border: '1px solid rgba(124, 58, 237, 0.25)',
                    }}
                    data-testid="challenge-personalised-pill"
                  >
                    🎯 {isHi ? 'तुम्हारे लिए' : 'Personalised'}
                  </span>
                )}
              </div>

              {/* Game component */}
              <ConceptChain
                cards={studentChallenge.cards}
                correctOrder={studentChallenge.correctOrder}
                distractorIds={studentChallenge.distractorIds}
                explanation={challenge.explanation ?? ''}
                explanationHi={challenge.explanation_hi ?? ''}
                isHi={isHi}
                onSolved={handleSolved}
              />
            </div>
          )}

          {/* ══ SOLVED STATE ══ */}
          {pageState === 'solved' && (
            <div className="space-y-5 animate-fade-in">
              {/* Milestone celebration */}
              {showMilestone && milestones.length > 0 && (
                <div
                  className="rounded-2xl p-5 text-center space-y-2 animate-bounce-in"
                  style={{
                    background: 'linear-gradient(135deg, #FFF7ED, #F5E6FF)',
                    border: '1.5px solid rgba(232, 88, 28, 0.3)',
                  }}
                >
                  {milestones.map((m, i) => (
                    <div key={i}>
                      <div className="text-4xl mb-2">{m.badgeIcon}</div>
                      <p
                        className="text-base font-bold"
                        style={{ fontFamily: 'var(--font-display)', color: '#E8581C' }}
                      >
                        {isHi ? m.badgeLabelHi : m.badgeLabel}
                      </p>
                      <p className="text-sm font-semibold" style={{ color: '#7C3AED' }}>
                        +{m.coins} {isHi ? 'सिक्के' : 'coins'}
                      </p>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMilestone(false)}
                  >
                    {isHi ? 'आगे बढ़ो' : 'Continue'}
                  </Button>
                </div>
              )}

              {/* Share card */}
              {attempt && challenge && (
                <ShareResultCard
                  chainLength={studentChallenge?.correctOrder.length ?? 4}
                  moves={attempt.moves ?? 0}
                  streak={streakState?.currentStreak ?? 0}
                  subject={isHi ? (challenge.subject_hi || challenge.subject) : challenge.subject}
                  date={todayStr.current}
                  isHi={isHi}
                />
              )}

              {/* Class board */}
              {challenge && (
                <ClassChallengeBoard
                  grade={student.grade}
                  studentId={student.id}
                  challengeDate={todayStr.current}
                  isHi={isHi}
                />
              )}

              {/* Streak history */}
              {streakState && (
                <Card>
                  <div className="flex items-center justify-between">
                    <div>
                      <SectionHeader>
                        {isHi ? 'स्ट्रीक' : 'Streak'}
                      </SectionHeader>
                      <StreakBadge
                        streak={streakState.currentStreak}
                        badges={streakState.badges}
                        isHi={isHi}
                        size="lg"
                      />
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">
                        {isHi ? 'सबसे अच्छी' : 'Best'}
                      </p>
                      <p
                        className="text-xl font-bold"
                        style={{ fontFamily: 'var(--font-display)', color: '#7C3AED' }}
                      >
                        {streakState.bestStreak}
                      </p>
                      <p className="text-[10px] text-[var(--text-3)]">
                        {isHi ? 'दिन' : 'days'}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Come back tomorrow */}
              <div
                className="rounded-xl p-4 text-center"
                style={{
                  background: 'rgba(124, 58, 237, 0.04)',
                  border: '1px solid rgba(124, 58, 237, 0.12)',
                }}
              >
                <p className="text-sm font-semibold text-[var(--text-2)]">
                  {isHi ? 'कल नया चैलेंज आएगा!' : 'Come back tomorrow for a new challenge!'}
                </p>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  {isHi
                    ? 'हर दिन खेलो, स्ट्रीक बढ़ाओ!'
                    : 'Play every day to build your streak!'}
                </p>
              </div>

              {/* Back to dashboard */}
              <Button
                variant="soft"
                fullWidth
                color="#E8581C"
                onClick={() => router.push('/dashboard')}
              >
                {isHi ? 'डैशबोर्ड पर जाओ' : 'Back to Dashboard'}
              </Button>
            </div>
          )}

          {/* ══ NO CHALLENGE STATE ══ */}
          {pageState === 'no-challenge' && (
            <div className="text-center py-16 px-4 space-y-4 animate-fade-in">
              <div className="text-5xl">🧩</div>
              <h2
                className="text-lg font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isHi ? 'चैलेंज तैयार हो रहा है' : 'Today\'s challenge is being prepared'}
              </h2>
              <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto">
                {isHi
                  ? 'कुछ देर बाद फिर से देखो। हर दिन एक नया चैलेंज आता है!'
                  : 'Check back soon. A new challenge appears every day!'}
              </p>
              <Button
                variant="soft"
                color="#E8581C"
                onClick={() => router.push('/dashboard')}
              >
                {isHi ? 'डैशबोर्ड पर जाओ' : 'Go to Dashboard'}
              </Button>
            </div>
          )}
        </SectionErrorBoundary>
      </div>
      
    </div>
  );
}
