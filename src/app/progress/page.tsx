'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { getStudentProfiles, getSubjects, getBloomProgression, getLearningVelocity, getKnowledgeGaps, supabase } from '@/lib/supabase';
import { BLOOM_LEVELS, BLOOM_CONFIG } from '@/lib/cognitive-engine';
import type { BloomLevel, KnowledgeGap, LearningVelocity, CognitiveSessionMetrics, StudentLearningProfile, Subject } from '@/lib/types';
import { Card, Badge, ProgressBar, SectionHeader, StatCard, MasteryRing, LoadingFoxy, BottomNav, Button, EmptyState } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import ExamProphecy from '@/components/ExamProphecy';
import LearningJourney from '@/components/progress/LearningJourney';
import SubjectMasteryCard from '@/components/progress/SubjectMasteryCard';
import KnowledgeGapActions from '@/components/progress/KnowledgeGapActions';

/* ── Helpers ── */
function formatDate(d: Date | string | null): string {
  if (!d) return '---';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Cognitive Session Card (kept for advanced analytics section) ── */
function SessionMetricCard({ session, isHi }: { session: CognitiveSessionMetrics; isHi: boolean }) {
  const zpdAcc = session.zpd_accuracy_rate != null ? Math.round(session.zpd_accuracy_rate * 100) : null;
  const dur = session.session_start && session.session_end
    ? Math.round((new Date(session.session_end).getTime() - new Date(session.session_start).getTime()) / 60000)
    : null;

  return (
    <Card className="!p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[var(--text-2)]">
          {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0)} {isHi ? 'प्रश्न' : 'questions'}
        </span>
        <div className="flex items-center gap-2">
          {session.fatigue_detected && (
            <Badge color="var(--mastery-low)" size="sm">{isHi ? 'थकान' : 'Low Energy'}</Badge>
          )}
          {dur != null && (
            <span className="text-[10px] text-[var(--text-3)]">{dur}m</span>
          )}
        </div>
      </div>

      {zpdAcc != null && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-[var(--text-3)] mb-0.5">
            <span>{isHi ? 'सही स्तर पर सटीकता' : 'Right-Level Accuracy'}</span>
            <span>{zpdAcc}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${zpdAcc}%`,
                background: zpdAcc >= 70 ? 'var(--mastery-high)' : zpdAcc >= 40 ? 'var(--mastery-mid)' : 'var(--mastery-low)',
              }}
            />
          </div>
        </div>
      )}

      {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0) > 0 && (
        <div className="flex gap-0.5">
          {session.questions_in_zpd ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: 'var(--mastery-high)', minWidth: 16 }} title={`In ZPD: ${session.questions_in_zpd}`}>{session.questions_in_zpd}</div> : null}
          {session.questions_too_easy ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: '#3B82F6', minWidth: 16 }} title={`Too Easy: ${session.questions_too_easy}`}>{session.questions_too_easy}</div> : null}
          {session.questions_too_hard ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: 'var(--mastery-low)', minWidth: 16 }} title={`Too Hard: ${session.questions_too_hard}`}>{session.questions_too_hard}</div> : null}
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS PAGE — Story-First Redesign
   4 sections: Journey, Subject Mastery, Knowledge Gaps, Exam Readiness
   + collapsible Advanced Analytics
   ═══════════════════════════════════════════════════════════════ */

export default function ProgressPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();

  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [bloomData, setBloomData] = useState<Record<string, unknown>[]>([]);
  const [velocityData, setVelocityData] = useState<LearningVelocity[]>([]);
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<CognitiveSessionMetrics[]>([]);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();

    // Core data
    Promise.all([getStudentProfiles(student.id), getSubjects()]).then(([p, s]) => {
      setProfiles(p);
      setSubjects(s);
    });

    // Cognitive 2.0 data
    getBloomProgression(student.id).then(setBloomData).catch(() => {});
    getLearningVelocity(student.id).then(setVelocityData).catch(() => {});
    getKnowledgeGaps(student.id, undefined, 20).then(setKnowledgeGaps).catch(() => {});

    // Cognitive session metrics
    supabase
      .from('cognitive_session_metrics')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setSessionMetrics((data as CognitiveSessionMetrics[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  if (isLoading || !student) return <LoadingFoxy />;

  /* ── Aggregate stats ── */
  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
  const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
  const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0;
  const streakDays = snapshot?.current_streak ?? student.streak_days ?? 0;

  /* ── Bloom data grouped by subject ── */
  const bloomFlattened = bloomData.flatMap((b: Record<string, unknown>) =>
    BLOOM_LEVELS.map((level) => ({
      bloom_level: level as BloomLevel,
      mastery: Number(b[`${level}_mastery`]) || 0,
      subject: (b.subject as string) ?? 'unknown',
    })).filter(item => item.mastery > 0)
  );

  const bloomBySubject = new Map<string, Array<{ bloom_level: BloomLevel; mastery: number }>>();
  for (const row of bloomFlattened) {
    const subj = row.subject ?? 'unknown';
    if (!bloomBySubject.has(subj)) bloomBySubject.set(subj, []);
    bloomBySubject.get(subj)!.push({ bloom_level: row.bloom_level, mastery: row.mastery });
  }

  /* ── Velocity lookup by subject ── */
  const velocityBySubject = new Map<string, LearningVelocity>();
  for (const v of velocityData) {
    if (!velocityBySubject.has(v.subject)) {
      velocityBySubject.set(v.subject, v);
    }
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'आपकी सीखने की यात्रा' : 'Your Learning Journey'}
          </h1>
        </div>
      </header>

      <main className="app-container py-6 space-y-5">
        <SectionErrorBoundary section="Progress">

        {/* ═══ EMPTY STATE — zero quiz history ═══ */}
        {totalSessions === 0 ? (
          <Card className="!p-6 text-center">
            <div className="text-5xl mb-3">&#128202;</div>
            <h2 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'तुम्हारी प्रगति यहाँ दिखेगी' : 'Your progress will show up here'}
            </h2>
            <p className="text-sm text-[var(--text-2)] max-w-xs mx-auto leading-relaxed mb-2">
              {isHi
                ? 'पहला क्विज़ लो और Foxy तुम्हारी सटीकता, XP, और विषय-वार महारत track करेगा।'
                : 'Take your first quiz and Foxy will track your accuracy, XP, and subject-wise mastery.'}
            </p>
            <div className="flex flex-col items-center gap-3 mt-4 rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
                <span>&#127919; {isHi ? 'सटीकता' : 'Accuracy'}</span>
                <span>&#128293; {isHi ? 'स्ट्रीक' : 'Streak'}</span>
                <span>&#129504; {isHi ? 'Bloom विश्लेषण' : "Bloom's Analysis"}</span>
              </div>
              <p className="text-xs text-[var(--text-3)]">
                {isHi ? 'ये सब 1 क्विज़ के बाद unlock होगा' : 'All unlocked after just 1 quiz'}
              </p>
            </div>
            <div className="flex gap-3 mt-5 justify-center">
              <Button variant="primary" size="md" onClick={() => router.push('/quiz')}>
                {isHi ? 'पहला क्विज़ लो' : 'Take First Quiz'}
              </Button>
              <Button variant="ghost" size="md" onClick={() => router.push('/foxy')}>
                {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* ═══ SECTION 1: "Your Learning Journey" — Hero Summary ═══ */}
            <SectionErrorBoundary section="LearningJourney">
              <LearningJourney
                totalXp={totalXp}
                snapshot={snapshot}
                streakDays={streakDays}
                accuracy={accuracy}
                velocityData={velocityData}
                isHi={isHi}
              />
            </SectionErrorBoundary>

            {/* ═══ SECTION 2: "Subject Mastery" — Visual Progress Cards ═══ */}
            <div>
              <SectionHeader icon="&#128218;">
                {isHi ? 'विषय में दक्षता' : 'Subject Mastery'}
              </SectionHeader>
              {profiles.length === 0 ? (
                <Card className="!p-4 text-center">
                  <div className="text-2xl mb-1">&#128218;</div>
                  <div className="text-sm text-[var(--text-3)]">
                    {isHi ? 'और quiz दो ताकि विषयवार प्रगति दिखे' : 'Take more quizzes to see subject-wise progress'}
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {profiles.map((p) => {
                    const meta = subjects.find((s: { code: string }) => s.code === p.subject);
                    const subjectBloom = bloomBySubject.get(p.subject) ?? [];
                    const subjectVelocity = velocityBySubject.get(p.subject);

                    return (
                      <SectionErrorBoundary key={p.id} section={`Subject-${p.subject}`}>
                        <SubjectMasteryCard
                          profile={p}
                          subjectMeta={meta}
                          bloomData={subjectBloom}
                          velocity={subjectVelocity}
                          isHi={isHi}
                        />
                      </SectionErrorBoundary>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ═══ SECTION 3: "Knowledge Gaps" — Action-Oriented ═══ */}
            <SectionErrorBoundary section="KnowledgeGaps">
              <KnowledgeGapActions gaps={knowledgeGaps} isHi={isHi} />
            </SectionErrorBoundary>

            {/* ═══ SECTION 4: "Exam Readiness" — Simplified ═══ */}
            {(student.preferred_subject || profiles.length > 0) && (
              <SectionErrorBoundary section="ExamReadiness">
                <div>
                  <SectionHeader icon="&#127919;">
                    {isHi ? 'परीक्षा तैयारी' : 'Exam Readiness'}
                  </SectionHeader>
                  <ExamProphecy
                    studentId={student.id}
                    subject={student.preferred_subject ?? profiles[0]?.subject ?? 'math'}
                    grade={student.grade}
                    isHi={isHi}
                  />
                </div>
              </SectionErrorBoundary>
            )}

            {/* ═══ NEP Holistic Progress Card link ═══ */}
            <Link href="/hpc" className="block">
              <Card className="!p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                <span className="text-2xl">&#128203;</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi ? 'NEP समग्र प्रगति कार्ड' : 'NEP Holistic Progress Card'}
                  </div>
                  <div className="text-xs text-[var(--text-3)]">
                    {isHi ? 'Bloom, दक्षता, और CBSE तैयारी देखें' : 'View Bloom\'s, competencies, and CBSE readiness'}
                  </div>
                </div>
                <span className="text-[var(--text-3)]" aria-hidden="true">&rarr;</span>
              </Card>
            </Link>

            {/* ═══ ADVANCED ANALYTICS — Collapsible ═══ */}
            <div>
              <button
                onClick={() => setShowAdvancedAnalytics(!showAdvancedAnalytics)}
                className="w-full flex items-center justify-between py-2 px-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] transition-colors"
              >
                <span>
                  &#129504; {isHi ? 'उन्नत विश्लेषण' : 'Advanced Analytics'}
                </span>
                <span
                  className="transition-transform duration-200"
                  style={{ transform: showAdvancedAnalytics ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  &#9660;
                </span>
              </button>

              {showAdvancedAnalytics && (
                <div className="space-y-4 mt-2 animate-slide-up">
                  {/* Cognitive Session History */}
                  {sessionMetrics.length > 0 && (
                    <div>
                      <SectionHeader icon="&#129504;">{isHi ? 'स्मार्ट क्विज़ सत्र' : 'Smart Quiz Sessions'}</SectionHeader>
                      <div className="space-y-2">
                        {sessionMetrics.map((s) => (
                          <SessionMetricCard key={s.id} session={s} isHi={isHi} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Learning Velocity Details */}
                  {velocityData.length > 0 && (
                    <div>
                      <SectionHeader icon="&#128640;">{isHi ? 'सीखने की गति' : 'Learning Velocity'}</SectionHeader>
                      <div className="space-y-2">
                        {velocityData.slice(0, 8).map((v) => {
                          const rate = v.weekly_mastery_rate ?? 0;
                          const predicted = v.predicted_mastery_date ? new Date(v.predicted_mastery_date) : null;

                          return (
                            <Card key={v.id} className="!p-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold truncate">{v.subject}</div>
                                  <div className="text-[10px] text-[var(--text-3)]">
                                    {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-xs font-bold" style={{ color: 'var(--teal)' }}>
                                    {Math.round(rate * 100)}%
                                  </div>
                                  {predicted && (
                                    <div className="text-[9px] text-[var(--text-3)]">
                                      {isHi ? 'तक' : 'by'} {formatDate(predicted)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empty advanced state */}
                  {sessionMetrics.length === 0 && velocityData.length === 0 && (
                    <Card className="!p-4 text-center">
                      <p className="text-sm text-[var(--text-3)]">
                        {isHi ? 'और quiz दो, फिर analytics दिखेगा!' : 'Take more quizzes to unlock advanced analytics!'}
                      </p>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        </SectionErrorBoundary>
      </main>
      <BottomNav />
    </div>
  );
}
