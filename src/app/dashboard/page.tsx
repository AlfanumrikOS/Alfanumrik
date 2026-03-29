'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getSubjects, getFeatureFlags, getNextTopics, generateNotifications } from '@/lib/supabase';
import { useDashboardData } from '@/lib/swr';
import { Card, StatCard, ProgressBar, SectionHeader, SubjectChip, Avatar, BottomNav } from '@/components/ui';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import { calculateLevel, xpToNextLevel, getLevelName } from '@/lib/xp-rules';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { StudentLearningProfile, Subject, CurriculumTopic } from '@/lib/types';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';
import { PlanBadge } from '@/components/PlanBadge';
import QuickActions from '@/components/dashboard/QuickActions';
import SubjectProgress from '@/components/dashboard/SubjectProgress';
import DailyChallenge from '@/components/dashboard/DailyChallenge';
import ComebackHook from '@/components/dashboard/ComebackHook';

const BLOOM_LABELS: Record<string, { icon: string; label: string; labelHi: string }> = {
  remember: { icon: '📖', label: 'Remember', labelHi: 'याद' },
  understand: { icon: '💡', label: 'Understand', labelHi: 'समझ' },
  apply: { icon: '🔧', label: 'Apply', labelHi: 'लागू' },
  analyze: { icon: '🔍', label: 'Analyze', labelHi: 'विश्लेषण' },
  evaluate: { icon: '⚖️', label: 'Evaluate', labelHi: 'मूल्यांकन' },
  create: { icon: '🚀', label: 'Create', labelHi: 'सृजन' },
};

export default function Dashboard() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, language, setLanguage, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [nextTopics, setNextTopics] = useState<CurriculumTopic[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [greeting, setGreeting] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [knowledgeGaps, setKnowledgeGaps] = useState<Array<{ id: string; topic_title?: string; severity: string; description: string; description_hi?: string }>>([]);
  const [showGapsAlert, setShowGapsAlert] = useState(true);
  const [velocityTrend, setVelocityTrend] = useState<'fast' | 'steady' | 'slow' | null>(null);
  const [bloomLevel, setBloomLevel] = useState<{ bloom_level: string; mastery: number } | null>(null);
  const [errorBreakdown, setErrorBreakdown] = useState<{ careless: number; conceptual: number; misinterpretation: number } | null>(null);
  const [retentionScore, setRetentionScore] = useState<number | null>(null);
  const [cbseReadiness, setCbseReadiness] = useState<number | null>(null);
  const [upcomingExams, setUpcomingExams] = useState<Array<{ id: string; exam_name: string; exam_type: string; subject: string; exam_date: string; days_left: number }>>([]);
  const [nudges, setNudges] = useState<Array<{ id: string; nudge_type: string; message: string; message_hi?: string; priority: number }>>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
    // Redirect non-student roles to their correct dashboard
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
  }, [isLoading, isLoggedIn, activeRole, router]);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(isHi
      ? (h < 12 ? 'शुभ प्रभात' : h < 17 ? 'नमस्ते' : 'शुभ संध्या')
      : (h < 12 ? 'Good morning' : h < 17 ? 'Hello' : 'Good evening'));
  }, [isHi]);

  // SWR: auto-caching, dedup, background revalidation, reconnect-resilient
  const { data: dashData } = useDashboardData(student?.id);

  const loadStaticData = useCallback(async () => {
    if (!student) return;
    const [subs, feats, nextTopicsResult] = await Promise.all([
      getSubjects(),
      getFeatureFlags(),
      getNextTopics(student.id, student.preferred_subject, student.grade),
    ]);
    setSubjects(subs);
    setFlags(feats);
    setNextTopics(nextTopicsResult.slice(0, 3));
    const gradeKey = (student.grade || '9').replace('Grade ', '').trim();
    const gradeSubjects = GRADE_SUBJECTS[gradeKey] || GRADE_SUBJECTS['9'];
    const rawSelected = (student.selected_subjects || [student.preferred_subject].filter(Boolean)) as string[];
    setSelectedSubjects(rawSelected.filter(s => gradeSubjects.includes(s)));
    generateNotifications(student.id).catch(() => {});
  }, [student]);

  // Process dashboard RPC data when SWR returns it
  useEffect(() => {
    if (!dashData) return;
    const d = dashData;
    setProfiles(d.profiles ?? []);
    setDueCount(d.due_count ?? 0);
    setUnreadCount(d.unread_count ?? 0);
    const gaps = d.knowledge_gaps ?? [];
    setKnowledgeGaps(gaps.map((g: any) => ({
      id: g.id,
      topic_title: g.target_concept_name,
      severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : 'moderate',
      description: `Missing prerequisite: ${g.missing_prerequisite_name}`,
      description_hi: `पूर्व ज्ञान की कमी: ${g.missing_prerequisite_name}`,
    })));
    if (d.velocity != null) {
      const v = Number(d.velocity);
      setVelocityTrend(v > 0.05 ? 'fast' : v > 0.02 ? 'steady' : 'slow');
    }
    if (d.bloom) {
      const level = d.bloom.current_bloom_level || 'remember';
      setBloomLevel({ bloom_level: level, mastery: Number(d.bloom[`${level}_mastery`]) || 0 });
    }
    if (d.cbse_readiness != null) setCbseReadiness(Math.round(d.cbse_readiness));
    const today = new Date();
    setUpcomingExams((d.exams ?? []).map((e: any) => ({
      ...e,
      days_left: Math.max(0, Math.ceil((new Date(e.exam_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))),
    })));
    setNudges(d.nudges ?? []);
    if (d.retention_score != null) setRetentionScore(Math.round(d.retention_score));
    if (d.error_breakdown) setErrorBreakdown({
      careless: d.error_breakdown.careless ?? 0,
      conceptual: d.error_breakdown.conceptual ?? 0,
      misinterpretation: d.error_breakdown.misinterpretation ?? 0,
    });
  }, [dashData]);

  useEffect(() => {
    if (student) { loadStaticData(); refreshSnapshot(); }
  }, [student?.id, loadStaticData, refreshSnapshot]);

  // Show skeleton while loading, but don't block non-student roles — they'll be redirected
  if (isLoading) return <DashboardSkeleton />;
  if (!student) {
    // Non-student role (teacher/guardian) — redirect is already in flight from useEffect
    // Show skeleton briefly while redirect completes
    if (activeRole === 'teacher' || activeRole === 'guardian') return <DashboardSkeleton />;
    // No student profile and no other role — something's wrong, redirect to home
    router.replace('/');
    return <DashboardSkeleton />;
  }

  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);
  const mastered = snapshot?.topics_mastered ?? 0;
  const inProgress = snapshot?.topics_in_progress ?? 0;
  const current = profiles.find((p) => p.subject === student.preferred_subject);
  const currentXp = current?.xp ?? 0;
  const currentLevel = current?.level ?? 1;
  const meta = subjects.find((s) => s.code === student.preferred_subject);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-3)]">{greeting},</p>
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {student.name} 👋
              </h1>
              <PlanBadge planCode={student.subscription_plan} size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
              className="text-xs px-3 py-1.5 rounded-xl border transition-colors"
              style={{ borderColor: 'var(--border-mid)', color: 'var(--text-3)' }}
            >
              {language === 'hi' ? '🌐 EN' : '🇮🇳 हिं'}
            </button>
            <button
              onClick={() => router.push('/notifications')}
              className="relative p-1.5"
            >
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: '#DC2626', fontSize: 10, lineHeight: 1 }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => router.push('/profile')}>
              <Avatar name={student.name} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
       <SectionErrorBoundary section="Dashboard">
        {/* ═══ WELCOME BANNER — only for new students with no activity ═══ */}
        {totalXp === 0 && profiles.length <= 1 && (
          <div className="rounded-2xl p-5 mb-1" style={{ background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)', border: '1px solid #FDBA7420' }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">🦊</span>
              <div>
                <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                  {isHi ? `स्वागत है, ${student.name}!` : `Welcome, ${student.name}!`}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'अपनी सीखने की यात्रा शुरू करें — 3 आसान कदम' : 'Start your learning journey — here\'s how'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => router.push('/foxy')} className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all active:scale-95" style={{ background: '#E8581C10', border: '1px solid #E8581C30' }}>
                <span className="text-xl">💬</span>
                <span className="text-[10px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>
                  {isHi ? 'Foxy से बात करो' : 'Chat with Foxy'}
                </span>
              </button>
              <button onClick={() => router.push('/quiz')} className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all active:scale-95" style={{ background: '#7C3AED10', border: '1px solid #7C3AED30' }}>
                <span className="text-xl">⚡</span>
                <span className="text-[10px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>
                  {isHi ? 'पहला क्विज़ लो' : 'Take First Quiz'}
                </span>
              </button>
              <button onClick={() => router.push('/study-plan')} className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all active:scale-95" style={{ background: '#0891B210', border: '1px solid #0891B230' }}>
                <span className="text-xl">📚</span>
                <span className="text-[10px] font-semibold text-center leading-tight" style={{ color: 'var(--text-2)' }}>
                  {isHi ? 'स्टडी प्लान बनाओ' : 'Create Study Plan'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Daily Challenge + Greeting — the first 5-second hook */}
        {totalXp > 0 && (
          <DailyChallenge
            isHi={isHi}
            studentName={student.name}
            streak={streak}
            grade={student.grade}
          />
        )}

        {/* XP Hero */}
        <Card accent={meta?.color}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{meta?.icon ?? '📚'}</span>
                <span className="font-semibold text-sm text-[var(--text-2)]">
                  {meta?.name ?? student.preferred_subject} · Grade {student.grade}
                </span>
              </div>
              <div className="text-3xl md:text-4xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="gradient-text">{totalXp.toLocaleString()}</span>
                <span className="text-base text-[var(--text-3)] ml-1">XP</span>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1 justify-end">
                <span className="text-xl streak-flame">🔥</span>
                <span className="text-2xl font-bold">{streak}</span>
              </div>
              <div className="text-xs text-[var(--text-3)]">{isHi ? 'दिन' : 'day streak'}</div>
              {velocityTrend && (
                <div className="text-xs mt-1" style={{ color: velocityTrend === 'fast' ? '#16A34A' : velocityTrend === 'steady' ? '#F59E0B' : '#EF4444' }}>
                  {velocityTrend === 'fast' ? '↑' : velocityTrend === 'steady' ? '→' : '↓'} {isHi ? (velocityTrend === 'fast' ? 'तेज़' : velocityTrend === 'steady' ? 'स्थिर' : 'धीमा') : velocityTrend}
                </div>
              )}
            </div>
          </div>
          {(() => {
            const lvl = calculateLevel(totalXp);
            const prog = xpToNextLevel(totalXp);
            const lvlName = getLevelName(lvl);
            return (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold" style={{ color: meta?.color || 'var(--orange)' }}>
                    {isHi ? `स्तर ${lvl}` : `Level ${lvl}`} · {lvlName}
                  </span>
                  <span className="text-[10px] text-[var(--text-3)]">{prog.current}/{prog.needed} XP</span>
                </div>
                <ProgressBar value={prog.progress} color={meta?.color} />
              </>
            );
          })()}
          <div className="grid-stats mt-4">
            <StatCard value={mastered} label={isHi ? 'महारत' : 'Mastered'} color="var(--gold)" />
            <StatCard value={inProgress} label={isHi ? 'जारी' : 'In Progress'} color="var(--teal)" />
            <StatCard
              value={dueCount}
              label={isHi ? 'रिव्यू' : 'Due Reviews'}
              color={dueCount > 0 ? 'var(--orange)' : 'var(--text-3)'}
            />
            <StatCard
              value={snapshot?.quizzes_taken ?? 0}
              label={isHi ? 'क्विज़' : 'Quizzes'}
              color="var(--purple)"
            />
            {bloomLevel && BLOOM_LABELS[bloomLevel.bloom_level] && (
              <StatCard
                icon={BLOOM_LABELS[bloomLevel.bloom_level].icon}
                value={`${Math.round(bloomLevel.mastery * 100)}%`}
                label={isHi ? BLOOM_LABELS[bloomLevel.bloom_level].labelHi : BLOOM_LABELS[bloomLevel.bloom_level].label}
                color="#7C3AED"
              />
            )}
            {retentionScore !== null && (
              <StatCard
                icon="🧠"
                value={`${retentionScore}%`}
                label={isHi ? 'याददाश्त' : 'Retention'}
                color="#0891B2"
              />
            )}
            {cbseReadiness !== null && (
              <StatCard
                icon="🎯"
                value={`${cbseReadiness}%`}
                label={isHi ? 'CBSE तैयारी' : 'CBSE Ready'}
                color="#16A34A"
              />
            )}
          </div>
        </Card>

        {/* Comeback Hook — contextual pull-back trigger */}
        <ComebackHook
          isHi={isHi}
          lastTopic={nextTopics[0] ? { title: nextTopics[0].title, subject: nextTopics[0].subject_id || '', progress: Math.round((nextTopics[0].difficulty_level || 0) * 20) } : null}
          almostMastered={profiles[0] ? { title: profiles[0].subject || 'Topic', mastery: profiles[0].total_questions_asked > 0 ? Math.round((profiles[0].total_questions_answered_correctly / profiles[0].total_questions_asked) * 100) : 0 } : null}
          dueReviews={dueCount}
          streak={streak}
          quizzesTaken={snapshot?.quizzes_taken ?? 0}
        />

        {/* Error Breakdown */}
        {errorBreakdown && (
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🔍</span>
              <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'गलती विश्लेषण' : 'Error Analysis'}
              </span>
            </div>
            <div className="space-y-2">
              {[
                { label: isHi ? 'लापरवाही' : 'Careless', pct: errorBreakdown.careless, color: '#F59E0B', icon: '⚡' },
                { label: isHi ? 'अवधारणा' : 'Conceptual', pct: errorBreakdown.conceptual, color: '#EF4444', icon: '🧠' },
                { label: isHi ? 'गलत समझ' : 'Misread', pct: errorBreakdown.misinterpretation, color: '#8B5CF6', icon: '🔍' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="text-xs w-4">{item.icon}</span>
                  <span className="text-xs font-semibold w-20" style={{ color: item.color }}>{item.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: `${item.color}15` }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${item.pct}%`, background: item.color }} />
                  </div>
                  <span className="text-[10px] text-[var(--text-3)] w-10 text-right">{item.pct}%</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Exam Countdown */}
        {upcomingExams.length > 0 && (
          <div>
            <SectionHeader icon="📋">{isHi ? 'आगामी परीक्षाएँ' : 'Upcoming Exams'}</SectionHeader>
            <div className="space-y-2">
              {upcomingExams.map(exam => {
                const isUrgent = exam.days_left <= 7;
                const examMeta = SUBJECT_META.find(s => s.code === exam.subject);
                const typeLabel = exam.exam_type === 'unit_test' ? (isHi ? 'UT' : 'UT') : exam.exam_type === 'half_yearly' ? (isHi ? 'अर्ध-वार्षिक' : 'Half-Yearly') : (isHi ? 'वार्षिक' : 'Annual');
                return (
                  <button key={exam.id} onClick={() => router.push(`/exams`)} className="w-full">
                    <Card className="!p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: isUrgent ? 'rgba(220,38,38,0.1)' : `${examMeta?.color ?? 'var(--orange)'}15` }}>
                        {examMeta?.icon ?? '📋'}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="font-semibold text-sm truncate">{exam.exam_name}</div>
                        <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                          {typeLabel} · {new Date(exam.exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold" style={{ color: isUrgent ? '#DC2626' : 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                          {exam.days_left}
                        </div>
                        <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'दिन' : 'days'}</div>
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Smart Nudges */}
        {nudges.length > 0 && (
          <div className="space-y-2">
            {nudges.map(nudge => {
              const nudgeIcons: Record<string, string> = { schedule_behind: '⚠️', revision_due: '🔄', streak_risk: '🔥', exam_approaching: '📋', weak_topic: '📉', milestone: '🎉', encouragement: '💪' };
              const nudgeColors: Record<string, string> = { schedule_behind: '#F59E0B', revision_due: '#0891B2', streak_risk: '#EF4444', exam_approaching: '#DC2626', weak_topic: '#8B5CF6', milestone: '#16A34A', encouragement: '#E8581C' };
              return (
                <div key={nudge.id} className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: `${nudgeColors[nudge.nudge_type] ?? 'var(--orange)'}08`, border: `1px solid ${nudgeColors[nudge.nudge_type] ?? 'var(--orange)'}20` }}>
                  <span className="text-base flex-shrink-0 mt-0.5">{nudgeIcons[nudge.nudge_type] ?? '💡'}</span>
                  <p className="text-xs text-[var(--text-2)] leading-relaxed flex-1">{isHi && nudge.message_hi ? nudge.message_hi : nudge.message}</p>
                  <button onClick={async () => { await supabase.from('smart_nudges').update({ is_dismissed: true }).eq('id', nudge.id); setNudges(prev => prev.filter(n => n.id !== nudge.id)); }} className="text-[var(--text-3)] text-xs flex-shrink-0">✕</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Continue Learning */}
        {nextTopics.length > 0 && (
          <div>
            <SectionHeader icon="▶">{isHi ? 'आगे सीखो' : 'Continue Learning'}</SectionHeader>
            {nextTopics.slice(0, 1).map((topic) => (
              <Card key={topic.id} hoverable onClick={() => router.push('/foxy')} className="flex items-center gap-4 !p-4">
                <div
                  className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: `${meta?.color ?? 'var(--orange)'}15` }}
                >
                  {meta?.icon ?? '📚'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm md:text-base truncate">{topic.title}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {isHi ? 'Foxy के साथ सीखो' : 'Learn with Foxy'} · Difficulty {topic.difficulty_level}/5
                  </div>
                </div>
                <span className="text-[var(--text-3)]">→</span>
              </Card>
            ))}
          </div>
        )}

        {/* Due Reviews Alert */}
        {dueCount > 0 && flags.spaced_repetition && (
          <button
            onClick={() => router.push('/review')}
            className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all"
            style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}
          >
            <span className="text-2xl">🔄</span>
            <div className="text-left">
              <div className="font-semibold text-sm" style={{ color: 'var(--gold)' }}>
                {dueCount} {isHi ? 'रिव्यू बाकी है!' : 'topics due for review!'}
              </div>
              <div className="text-xs text-[var(--text-3)]">{isHi ? 'स्मृति मजबूत करो' : 'Strengthen your memory'}</div>
            </div>
            <span className="ml-auto" style={{ color: 'var(--gold)' }}>→</span>
          </button>
        )}

        {/* Knowledge Gaps Alert */}
        {knowledgeGaps.length > 0 && showGapsAlert && (
          <div className="rounded-2xl p-4 relative" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <button onClick={() => setShowGapsAlert(false)} className="absolute top-2 right-3 text-[var(--text-3)] text-sm">✕</button>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔍</span>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: '#DC2626' }}>
                  {knowledgeGaps.length} {isHi ? 'ज्ञान अंतराल पाए गए' : 'knowledge gaps found'}
                </div>
                <div className="text-xs text-[var(--text-3)] mt-1 space-y-0.5">
                  {knowledgeGaps.slice(0, 2).map(g => (
                    <div key={g.id}>• {isHi && g.description_hi ? g.description_hi : g.description}</div>
                  ))}
                </div>
                <button
                  onClick={() => router.push('/foxy')}
                  className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}
                >
                  🦊 {isHi ? 'Foxy से ठीक करो' : 'Fix with Foxy'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <QuickActions isHi={isHi} />

        {/* My Subjects (only student's chosen subjects) */}
        {subjects.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader icon="📚">{isHi ? 'मेरे विषय' : 'My Subjects'}</SectionHeader>
              <button onClick={() => setShowSubjectPicker(true)} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ color: 'var(--orange)', background: 'rgba(232,88,28,0.08)' }}>
                {isHi ? '+ बदलो' : '+ Edit'}
              </button>
            </div>
            <div className="grid-subjects">
              {subjects.filter(s => selectedSubjects.includes(s.code)).map((s) => (
                <SubjectChip
                  key={s.code}
                  icon={s.icon}
                  name={s.name}
                  color={s.color}
                  active={student.preferred_subject === s.code}
                  size="sm"
                  onClick={async () => {
                    await supabase.from('students').update({ preferred_subject: s.code }).eq('id', student.id);
                    if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_subject', s.code);
                    router.push('/foxy');
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Subject Picker Modal */}
        {showSubjectPicker && (
          <>
            <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowSubjectPicker(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl max-h-[80vh] flex flex-col" style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}>
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} /></div>
              <div className="px-4 pb-2">
                <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'विषय चुनो' : 'Choose Your Subjects'}</h3>
                <p className="text-xs text-[var(--text-3)]">{isHi ? 'जो विषय पढ़ना है वो चुनो' : 'Select the subjects you want to study'}</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-2">
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
              </div>
              <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={async () => {
                  const subs = selectedSubjects.length > 0 ? selectedSubjects : [student.preferred_subject];
                  await supabase.from('students').update({ selected_subjects: subs, preferred_subject: subs[0] }).eq('id', student.id);
                  setShowSubjectPicker(false);
                  loadStaticData();
                }} disabled={selectedSubjects.length === 0} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: 'var(--orange)' }}>
                  {isHi ? `${selectedSubjects.length} विषय सेव करो` : `Save ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* XP by Subject (only selected subjects) */}
        <SubjectProgress
          profiles={profiles}
          subjects={subjects}
          selectedSubjects={selectedSubjects}
          isHi={isHi}
        />
       </SectionErrorBoundary>
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
