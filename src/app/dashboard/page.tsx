'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getSubjects, getFeatureFlags, getNextTopics, generateNotifications, getCmeNextAction } from '@/lib/supabase';
import { useDashboardData } from '@/lib/swr';
import { Card, SectionHeader, SubjectChip, StreakBadge, MasteryRing, SheetModal, BottomNav } from '@/components/ui';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { StudentLearningProfile, Subject, CurriculumTopic, CmeAction } from '@/lib/types';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';
import QuickActions from '@/components/dashboard/QuickActions';
import DailyChallenge from '@/components/dashboard/DailyChallenge';
import FoxyBannerCard from '@/components/dashboard/FoxyBannerCard';
import ProgressSnapshot from '@/components/dashboard/ProgressSnapshot';
import ExamReadiness from '@/components/dashboard/ExamReadiness';
import TodaysPlan from '@/components/dashboard/TodaysPlan';

// Lazy load OnboardingFlow — only shown to brand new students (XP=0)
const OnboardingFlow = dynamic(() => import('@/components/onboarding/OnboardingFlow'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();

  // Static data (loaded once)
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [nextTopics, setNextTopics] = useState<CurriculumTopic[]>([]);
  const [cmeAction, setCmeAction] = useState<CmeAction | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [onboardingDone, setOnboardingDone] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('alfanumrik_onboarded') === 'true';
    return false;
  });

  // SWR: auto-caching, dedup, background revalidation
  const { data: dashData } = useDashboardData(student?.id);

  // Derive values directly from SWR — no useState copy cascade
  const profiles: StudentLearningProfile[] = dashData?.profiles ?? [];
  const dueCount: number = dashData?.due_count ?? 0;
  const unreadCount: number = dashData?.unread_count ?? 0;
  const knowledgeGaps = (dashData?.knowledge_gaps ?? []).map((g: { id: string; target_concept_name: string }) => ({
    id: g.id,
    topic_title: g.target_concept_name,
  }));
  const upcomingExams = (dashData?.exams ?? []).map((e: { exam_date: string; exam_name: string; [key: string]: unknown }) => {
    const daysLeft = Math.max(0, Math.ceil((new Date(e.exam_date).getTime() - Date.now()) / 86400000));
    return { ...e, days_left: daysLeft };
  }).filter((e: { days_left: number }) => e.days_left <= 14);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
  }, [isLoading, isLoggedIn, activeRole, router]);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(isHi
      ? (h < 12 ? 'शुभ प्रभात' : h < 17 ? 'नमस्ते' : 'शुभ संध्या')
      : (h < 12 ? 'Good morning' : h < 17 ? 'Hello' : 'Good evening'));
  }, [isHi]);

  const loadStaticData = useCallback(async () => {
    if (!student) return;
    const [subs, , nextTopicsResult] = await Promise.all([
      getSubjects(),
      getFeatureFlags(),
      getNextTopics(student.id, student.preferred_subject, student.grade),
    ]);
    setSubjects(subs);
    setNextTopics(nextTopicsResult.slice(0, 3));
    const gradeKey = (student.grade || '9').replace('Grade ', '').trim();
    const gradeSubjects = GRADE_SUBJECTS[gradeKey] || GRADE_SUBJECTS['9'];
    const rawSelected = (student.selected_subjects || [student.preferred_subject].filter(Boolean)) as string[];
    setSelectedSubjects(rawSelected.filter(s => gradeSubjects.includes(s)));
    generateNotifications(student.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  useEffect(() => {
    if (student) { loadStaticData(); refreshSnapshot(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- student?.id is the stable identity; student object reference changes on every render
  }, [student?.id, loadStaticData, refreshSnapshot]);

  // Non-blocking CME recommendation — fire-and-forget, updates when ready
  useEffect(() => {
    if (!student?.id || !student.preferred_subject || !student.grade) return;
    let cancelled = false;
    getCmeNextAction(student.id, student.preferred_subject, student.grade)
      .then((action) => { if (!cancelled && action) setCmeAction(action); })
      .catch(() => {}); // silently ignore — best-effort
    return () => { cancelled = true; };
  }, [student?.id, student?.preferred_subject, student?.grade]);

  if (isLoading) return <DashboardSkeleton />;
  if (!student) {
    if (activeRole === 'teacher' || activeRole === 'guardian') return <DashboardSkeleton />;
    router.replace('/');
    return <DashboardSkeleton />;
  }

  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);
  const mastered = snapshot?.topics_mastered ?? 0;
  const meta = SUBJECT_META.find((s) => s.code === student.preferred_subject);
  const firstName = student.name?.split(' ')[0] || '';

  // Show onboarding for brand new students
  const isNewStudent = totalXp === 0 && !onboardingDone && !student.onboarding_completed;
  if (isNewStudent) {
    return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* ═══ DEMO MODE INDICATOR ═══ */}
      {student?.is_demo && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-center">
          <span className="text-xs font-medium text-amber-700">
            {isHi ? '🔶 डेमो मोड — यह एक प्रदर्शन खाता है' : '🔶 Demo Mode — This is a demonstration account'}
          </span>
        </div>
      )}

      {/* ═══ HEADER — compact: greeting, streak, notifications ═══ */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-3)]">{greeting},</p>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {firstName} 👋
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <StreakBadge count={streak} compact />
            <button
              onClick={() => router.push('/notifications')}
              className="relative p-1"
            >
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: '#DC2626', fontSize: 10, lineHeight: 1 }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
        <SectionErrorBoundary section="Dashboard">
          {/* ═══ 1. FOXY BANNER — single clear primary action ═══ */}
          <FoxyBannerCard
            isHi={isHi}
            streak={streak}
            dueCount={dueCount}
            knowledgeGaps={knowledgeGaps}
            nextTopic={nextTopics[0] ?? null}
            subjectMeta={meta ? { icon: meta.icon, name: meta.name, color: meta.color } : null}
          />

          {/* ═══ 2. TODAY'S PLAN — actionable daily learning path ═══ */}
          <TodaysPlan
            isHi={isHi}
            dueCount={dueCount}
            knowledgeGaps={knowledgeGaps}
            nextTopics={nextTopics}
            preferredSubject={student.preferred_subject || 'math'}
            streak={streak}
            cmeAction={cmeAction}
          />

          {/* ═══ 3. PROGRESS SNAPSHOT — XP, level, streak, mastered ═══ */}
          <ProgressSnapshot
            totalXp={totalXp}
            streak={streak}
            mastered={mastered}
            isHi={isHi}
          />

          {/* ═══ 3b. EXAM READINESS — predicted board grade ═══ */}
          {(() => {
            const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
            const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
            const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
            const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0;
            return (
              <ExamReadiness
                accuracy={accuracy}
                totalQuizzes={totalSessions}
                isHi={isHi}
                grade={student.grade}
              />
            );
          })()}

          {/* ═══ 4. DAILY CHALLENGE — compact engagement hook ═══ */}
          {totalXp > 0 && (
            <DailyChallenge
              isHi={isHi}
              studentName={student.name}
              streak={streak}
              grade={student.grade}
            />
          )}

          {/* ═══ 4. UPCOMING EXAM — only if within 2 weeks ═══ */}
          {upcomingExams.length > 0 && (
            <button
              onClick={() => router.push('/exams')}
              className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]"
              style={{
                background: upcomingExams[0].days_left <= 7 ? 'rgba(220,38,38,0.06)' : 'rgba(232,88,28,0.06)',
                border: `1px solid ${upcomingExams[0].days_left <= 7 ? 'rgba(220,38,38,0.15)' : 'rgba(232,88,28,0.15)'}`,
              }}
            >
              <span className="text-xl">📋</span>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-semibold truncate">{upcomingExams[0].exam_name}</div>
                <div className="text-xs text-[var(--text-3)]">
                  {new Date(upcomingExams[0].exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold" style={{ color: upcomingExams[0].days_left <= 7 ? '#DC2626' : 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                  {upcomingExams[0].days_left}
                </div>
                <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'दिन' : 'days'}</div>
              </div>
            </button>
          )}

          {/* ═══ 5. QUICK ACTIONS — fast access to core features ═══ */}
          <QuickActions isHi={isHi} />

          {/* ═══ 6. MY SUBJECTS — horizontal chips with mastery rings ═══ */}
          {subjects.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader icon="📚">{isHi ? 'मेरे विषय' : 'My Subjects'}</SectionHeader>
                <button onClick={() => setShowSubjectPicker(true)} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ color: 'var(--orange)', background: 'rgba(232,88,28,0.08)' }}>
                  {isHi ? '+ बदलो' : '+ Edit'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {subjects.filter(s => selectedSubjects.includes(s.code)).map((s) => {
                  const profile = profiles.find(p => p.subject === s.code);
                  const masteryPct = profile && profile.total_questions_asked > 0
                    ? Math.round((profile.total_questions_answered_correctly / profile.total_questions_asked) * 100)
                    : 0;
                  return (
                    <button
                      key={s.code}
                      onClick={async () => {
                        await supabase.from('students').update({ preferred_subject: s.code }).eq('id', student.id);
                        router.push('/foxy');
                      }}
                      className="rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.97]"
                      style={{
                        background: student.preferred_subject === s.code ? `${s.color}08` : 'var(--surface-1)',
                        border: `1.5px solid ${student.preferred_subject === s.code ? s.color : 'var(--border)'}`,
                      }}
                    >
                      <MasteryRing value={masteryPct} size={40} strokeWidth={3} color={s.color}>
                        <span className="text-sm">{s.icon}</span>
                      </MasteryRing>
                      <div className="text-left min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{s.name}</div>
                        <div className="text-xs text-[var(--text-3)]">{profile?.xp ?? 0} XP</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ SUBJECT PICKER MODAL ═══ */}
          <SheetModal
            open={showSubjectPicker}
            onClose={() => setShowSubjectPicker(false)}
            title={isHi ? 'विषय चुनो' : 'Choose Your Subjects'}
          >
            <div className="grid grid-cols-2 gap-2 mb-4">
              {subjects.map((s) => {
                const sel = selectedSubjects.includes(s.code);
                return (
                  <button key={s.code} onClick={() => {
                    setSelectedSubjects(prev => sel ? prev.filter(x => x !== s.code) : [...prev, s.code]);
                  }} className="p-3 rounded-xl text-left transition-all active:scale-[0.97] flex items-center gap-2"
                    style={{ background: sel ? `${s.color}12` : 'var(--surface-2)', border: `1.5px solid ${sel ? s.color : 'var(--border)'}` }}>
                    <span className="text-lg">{s.icon}</span>
                    <span className="text-sm font-semibold" style={{ color: sel ? s.color : 'var(--text-2)' }}>{s.name}</span>
                    {sel && <span className="ml-auto text-xs" style={{ color: s.color }}>&#10003;</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={async () => {
              const subs = selectedSubjects.length > 0 ? selectedSubjects : [student.preferred_subject];
              await supabase.from('students').update({ selected_subjects: subs, preferred_subject: subs[0] }).eq('id', student.id);
              setShowSubjectPicker(false);
              loadStaticData();
            }} disabled={selectedSubjects.length === 0} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
              style={{ background: 'var(--orange)' }}>
              {isHi ? `${selectedSubjects.length} विषय सेव करो` : `Save ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`}
            </button>
          </SheetModal>
        </SectionErrorBoundary>
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
