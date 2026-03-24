'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getStudentProfiles, getSubjects, getFeatureFlags, getNextTopics, getStudentNotifications, generateNotifications } from '@/lib/supabase';
import { Card, StatCard, ProgressBar, SectionHeader, ActionTile, SubjectChip, Avatar, BottomNav } from '@/components/ui';
import SmartNudge from '@/components/ui/SmartNudge';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import type { StudentLearningProfile, Subject, CurriculumTopic } from '@/lib/types';
import { SUBJECT_META } from '@/lib/constants';

/* Reduced to 6 most essential actions (from 9) — Hick's Law */
const QUICK_ACTIONS = [
  { href: '/foxy', icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो', color: '#E8581C' },
  { href: '/quiz?mode=cognitive', icon: '🧠', label: 'Smart Quiz', labelHi: 'स्मार्ट क्विज़', color: '#7C3AED' },
  { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'अध्ययन योजना', color: '#7C3AED' },
  { href: '/scan', icon: '📷', label: 'Scan', labelHi: 'स्कैन', color: '#0D9488' },
  { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू', color: '#0891B2' },
  { href: '/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट', color: '#16A34A' },
];

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
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState(false);

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

  const loadData = useCallback(async () => {
    if (!student) return;
    const [profs, subs, feats] = await Promise.all([
      getStudentProfiles(student.id),
      getSubjects(),
      getFeatureFlags(),
    ]);
    setProfiles(profs);
    setSubjects(subs);
    setFlags(feats);
    setNextTopics(
      (await getNextTopics(student.id, student.preferred_subject, student.grade)).slice(0, 3)
    );
    const { count } = await supabase
      .from('concept_mastery')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', student.id)
      .lte('next_review_at', new Date().toISOString());
    setDueCount(count ?? 0);

    // Load student's selected subjects
    setSelectedSubjects((student.selected_subjects || [student.preferred_subject].filter(Boolean)) as string[]);

    // Generate contextual notifications + get unread count
    try {
      await generateNotifications(student.id);
      const notifData = await getStudentNotifications(student.id);
      setUnreadCount(notifData?.unread_count ?? 0);
    } catch {}

    // Cognitive 2.0: Knowledge gaps (DB columns: target_concept_name, missing_prerequisite_name, status)
    try {
      const { data: gaps } = await supabase.from('knowledge_gaps')
        .select('id, target_concept_name, missing_prerequisite_name, status, confidence_score')
        .eq('student_id', student.id)
        .neq('status', 'resolved')
        .order('confidence_score', { ascending: false })
        .limit(3);
      setKnowledgeGaps((gaps ?? []).map(g => ({
        id: g.id,
        topic_title: g.target_concept_name,
        severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : 'moderate',
        description: `Missing prerequisite: ${g.missing_prerequisite_name}`,
        description_hi: `पूर्व ज्ञान की कमी: ${g.missing_prerequisite_name}`,
      })));
    } catch {}

    // Cognitive 2.0: Learning velocity (DB column: weekly_mastery_rate)
    try {
      const { data: vel } = await supabase.from('learning_velocity')
        .select('weekly_mastery_rate')
        .eq('student_id', student.id)
        .order('last_calculated_at', { ascending: false })
        .limit(1);
      if (vel && vel.length > 0) {
        const v = vel[0].weekly_mastery_rate ?? 0;
        setVelocityTrend(v > 0.05 ? 'fast' : v > 0.02 ? 'steady' : 'slow');
      }
    } catch {}

    // Cognitive 2.0: Highest Bloom level (DB has per-level mastery columns)
    try {
      const { data: bloom } = await supabase.from('bloom_progression')
        .select('current_bloom_level, remember_mastery, understand_mastery, apply_mastery, analyze_mastery, evaluate_mastery, create_mastery')
        .eq('student_id', student.id)
        .not('current_bloom_level', 'is', null)
        .limit(1);
      if (bloom && bloom.length > 0) {
        const b = bloom[0];
        const level = b.current_bloom_level || 'remember';
        const masteryKey = `${level}_mastery` as keyof typeof b;
        const mastery = Number(b[masteryKey]) || 0;
        setBloomLevel({ bloom_level: level, mastery });
      }
    } catch {}

    // Cognitive 2.0: Error breakdown from question_responses
    try {
      const { data: errData } = await supabase
        .from('question_responses')
        .select('is_correct, response_time_seconds')
        .eq('student_id', student.id)
        .eq('is_correct', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (errData && errData.length > 0) {
        const avgTime = errData.reduce((a, r) => a + (r.response_time_seconds || 10), 0) / errData.length;
        let careless = 0, conceptual = 0, misinterpretation = 0;
        errData.forEach(r => {
          const t = r.response_time_seconds || 10;
          if (t < avgTime * 0.3 || t < 3) careless++;
          else if (t > avgTime * 2.5) conceptual++;
          else misinterpretation++;
        });
        const total = errData.length;
        setErrorBreakdown({
          careless: Math.round((careless / total) * 100),
          conceptual: Math.round((conceptual / total) * 100),
          misinterpretation: Math.round((misinterpretation / total) * 100),
        });
      }
    } catch {}

    // Cognitive 2.0: Retention score from retention_tests
    try {
      const { data: retData } = await supabase
        .from('retention_tests')
        .select('score')
        .eq('student_id', student.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10);
      if (retData && retData.length > 0) {
        const avg = retData.reduce((a, r) => a + (r.score || 0), 0) / retData.length;
        setRetentionScore(Math.round(avg * 100));
      }
    } catch {}

    // Cognitive 2.0: CBSE Readiness from adaptive_profile
    try {
      const { data: profile } = await supabase
        .from('adaptive_profile')
        .select('cbse_readiness_pct')
        .eq('student_id', student.id)
        .limit(1);
      if (profile && profile.length > 0 && profile[0].cbse_readiness_pct != null) {
        setCbseReadiness(Math.round(profile[0].cbse_readiness_pct));
      }
    } catch {}

    // Exam countdown: upcoming exams
    try {
      const { data: exams } = await supabase
        .from('exam_configs')
        .select('id, exam_name, exam_type, subject, exam_date')
        .eq('student_id', student.id)
        .eq('is_active', true)
        .gte('exam_date', new Date().toISOString().split('T')[0])
        .order('exam_date')
        .limit(3);
      if (exams) {
        const today = new Date();
        setUpcomingExams(exams.map(e => ({
          ...e,
          days_left: Math.max(0, Math.ceil((new Date(e.exam_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))),
        })));
      }
    } catch {}

    // Smart nudges
    try {
      const { data: nudgeData } = await supabase
        .from('smart_nudges')
        .select('id, nudge_type, message, message_hi, priority')
        .eq('student_id', student.id)
        .eq('is_read', false)
        .eq('is_dismissed', false)
        .order('priority', { ascending: false })
        .limit(3);
      if (nudgeData) setNudges(nudgeData);
    } catch {}
  }, [student]);

  useEffect(() => {
    if (student) { loadData(); refreshSnapshot(); }
  }, [student?.id, loadData, refreshSnapshot]);

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
            <h1 className="text-lg md:text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {student.name} 👋
            </h1>
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

        {/* ═══ ABOVE THE FOLD: What should the user do right now? ═══ */}

        {/* 1. Exam Countdown — Prominent, answering "What's urgent?" */}
        {upcomingExams.length > 0 && (
          <button onClick={() => router.push('/exams')} className="w-full">
            <Card accent={upcomingExams[0].days_left <= 7 ? '#DC2626' : 'var(--orange)'} className="!p-4">
              <div className="flex items-center gap-4">
                <div className="text-center flex-shrink-0" style={{ minWidth: '56px' }}>
                  <div className="text-3xl font-bold" style={{ color: upcomingExams[0].days_left <= 7 ? '#DC2626' : 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                    {upcomingExams[0].days_left}
                  </div>
                  <div className="text-[10px] text-[var(--text-3)] font-semibold uppercase">{isHi ? 'दिन बाकी' : 'days left'}</div>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'अगली परीक्षा' : 'Next Exam'}
                  </div>
                  <div className="font-bold text-base truncate mt-0.5">{upcomingExams[0].exam_name}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">
                    {new Date(upcomingExams[0].exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {upcomingExams.length > 1 && ` · +${upcomingExams.length - 1} more`}
                  </div>
                </div>
                <span className="text-[var(--text-3)] text-lg">→</span>
              </div>
            </Card>
          </button>
        )}

        {/* 2. Resume Where You Left Off — Single clear CTA */}
        {nextTopics.length > 0 && (
          <Card hoverable onClick={() => router.push('/foxy')} className="!p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: `${meta?.color ?? 'var(--orange)'}15` }}>
                {meta?.icon ?? '📚'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {isHi ? 'जहाँ छोड़ा था वहाँ से शुरू करो' : 'Resume where you left off'}
                </div>
                <div className="font-semibold text-sm truncate mt-0.5">{nextTopics[0].title}</div>
              </div>
              <button className="px-4 py-2 rounded-xl text-xs font-bold text-white flex-shrink-0" style={{ background: 'var(--orange)' }}>
                {isHi ? 'शुरू करो' : 'Continue'}
              </button>
            </div>
          </Card>
        )}

        {/* 3. Today's Plan — Top 3 tasks only */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🎯</span>
              <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? "आज की योजना" : "Today's Plan"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl streak-flame">🔥</span>
              <span className="text-lg font-bold">{streak}</span>
              <span className="text-[10px] text-[var(--text-3)]">{isHi ? 'दिन' : 'days'}</span>
            </div>
          </div>
          <div className="space-y-2">
            {/* Show top 3 recommended actions */}
            {dueCount > 0 && flags.spaced_repetition && (
              <button onClick={() => router.push('/review')} className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}>
                <span className="text-lg">🔄</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold">{dueCount} {isHi ? 'रिव्यू बाकी' : 'reviews due'}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'स्मृति मजबूत करो' : 'Strengthen memory'}</div>
                </div>
                <span style={{ color: 'var(--gold)' }}>→</span>
              </button>
            )}
            {nextTopics.slice(1, 3).map(topic => (
              <button key={topic.id} onClick={() => router.push('/foxy')} className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: `${meta?.color ?? 'var(--orange)'}06`, border: `1px solid ${meta?.color ?? 'var(--orange)'}15` }}>
                <span className="text-lg">{meta?.icon ?? '📚'}</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold truncate">{topic.title}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}</div>
                </div>
                <span className="text-[var(--text-3)]">→</span>
              </button>
            ))}
            <button onClick={() => router.push('/study-plan')} className="w-full text-xs font-semibold py-2 text-center" style={{ color: 'var(--orange)' }}>
              {isHi ? 'पूरा प्लान देखो →' : 'See full plan →'}
            </button>
          </div>
        </Card>

        {/* ═══ BELOW THE FOLD: Progressive disclosure ═══ */}

        {/* Knowledge Gaps — Only if critical */}
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
                <button onClick={() => router.push('/foxy')} className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}>
                  🦊 {isHi ? 'Foxy से ठीक करो' : 'Fix with Foxy'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Smart Nudges — Client-side intelligent nudging */}
        <SmartNudge
          studentData={{
            subjects: profiles.map(p => ({
              name: subjects.find(s => s.code === p.subject)?.name ?? p.subject,
              streak: p.streak_days,
            })),
            studyPlan: { completed_pct: mastered > 0 ? Math.round((mastered / Math.max(mastered + inProgress, 1)) * 100) : undefined },
            upcomingExams: upcomingExams.map(e => ({ name: e.exam_name, date: e.exam_date, syllabus_pct: cbseReadiness ?? undefined })),
            stats: { problems_solved_today: snapshot?.quizzes_taken },
          }}
          maxNudges={2}
        />

        {/* DB-driven nudges */}
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

        {/* CBSE Readiness — Single progress bar */}
        {cbseReadiness !== null && (
          <Card className="!p-3">
            <div className="flex items-center gap-2 mb-2">
              <span>🎯</span>
              <span className="text-sm font-semibold">{isHi ? 'CBSE तैयारी' : 'CBSE Readiness'}</span>
              <span className="ml-auto text-base font-bold" style={{ color: cbseReadiness >= 70 ? '#16A34A' : cbseReadiness >= 40 ? '#F59E0B' : '#EF4444', fontFamily: 'var(--font-display)' }}>
                {cbseReadiness}%
              </span>
            </div>
            <ProgressBar value={cbseReadiness} color={cbseReadiness >= 70 ? '#16A34A' : cbseReadiness >= 40 ? '#F59E0B' : '#EF4444'} height={6} />
          </Card>
        )}

        {/* Quick Actions — Reduced to 6 */}
        <div>
          <SectionHeader icon="⚡">{isHi ? 'त्वरित क्रियाएँ' : 'Quick Actions'}</SectionHeader>
          <div className="grid-actions">
            {QUICK_ACTIONS.map((a) => (
              <ActionTile
                key={a.href}
                icon={a.icon}
                label={isHi ? a.labelHi : a.label}
                color={a.color}
                onClick={() => router.push(a.href)}
              />
            ))}
          </div>
        </div>

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
                  loadData();
                }} disabled={selectedSubjects.length === 0} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: 'var(--orange)' }}>
                  {isHi ? `${selectedSubjects.length} विषय सेव करो` : `Save ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Subject Progress — Collapsible (collapsed by default) */}
        {profiles.filter(p => selectedSubjects.includes(p.subject)).length > 0 && (
          <div>
            <button onClick={() => setExpandedSubjects(!expandedSubjects)} className="w-full flex items-center justify-between mb-2">
              <SectionHeader icon="🏅">{isHi ? 'विषयवार XP' : 'Subject Progress'}</SectionHeader>
              <span className="text-xs text-[var(--text-3)] transition-transform" style={{ transform: expandedSubjects ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </button>
            {!expandedSubjects ? (
              /* Collapsed: just progress bars */
              <div className="space-y-1.5">
                {profiles.filter(p => selectedSubjects.includes(p.subject)).map((p) => {
                  const sm = subjects.find((s) => s.code === p.subject);
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="text-sm">{sm?.icon ?? '📚'}</span>
                      <span className="text-xs font-semibold w-16 truncate">{sm?.name ?? p.subject}</span>
                      <div className="flex-1"><ProgressBar value={((p.xp % 500) / 500) * 100} color={sm?.color} height={4} /></div>
                      <span className="text-[10px] text-[var(--text-3)]">Lv{p.level}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Expanded: full cards */
              <div className="space-y-2">
                {profiles.filter(p => selectedSubjects.includes(p.subject)).map((p) => {
                  const sm = subjects.find((s) => s.code === p.subject);
                  return (
                    <Card key={p.id} className="!p-3 flex items-center gap-3">
                      <span className="text-lg">{sm?.icon ?? '📚'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold truncate">{sm?.name ?? p.subject}</span>
                          <span className="text-[var(--text-3)]">{p.xp} XP · Lv{p.level}</span>
                        </div>
                        <ProgressBar value={((p.xp % 500) / 500) * 100} color={sm?.color} height={5} />
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Detailed Analytics — Hidden behind progressive disclosure */}
        {(errorBreakdown || retentionScore !== null || velocityTrend) && (
          <div>
            <button onClick={() => setShowDetailedAnalytics(!showDetailedAnalytics)}
              className="w-full flex items-center justify-between py-2">
              <span className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                {isHi ? 'विस्तृत विश्लेषण' : 'Detailed Analytics'}
              </span>
              <span className="text-xs" style={{ color: 'var(--orange)' }}>
                {showDetailedAnalytics ? (isHi ? 'छुपाओ' : 'Hide') : (isHi ? 'देखो' : 'Show')} ↓
              </span>
            </button>
            {showDetailedAnalytics && (
              <div className="space-y-3">
                {/* Mini stats row */}
                <div className="grid grid-cols-3 gap-2">
                  <StatCard value={totalXp.toLocaleString()} label="XP" color="var(--orange)" />
                  {retentionScore !== null && <StatCard icon="🧠" value={`${retentionScore}%`} label={isHi ? 'याददाश्त' : 'Retention'} color="#0891B2" />}
                  {velocityTrend && <StatCard icon={velocityTrend === 'fast' ? '↑' : velocityTrend === 'steady' ? '→' : '↓'} value={isHi ? (velocityTrend === 'fast' ? 'तेज़' : velocityTrend === 'steady' ? 'स्थिर' : 'धीमा') : velocityTrend} label={isHi ? 'गति' : 'Velocity'} color={velocityTrend === 'fast' ? '#16A34A' : velocityTrend === 'steady' ? '#F59E0B' : '#EF4444'} />}
                </div>
                {/* Error breakdown */}
                {errorBreakdown && (
                  <Card>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">🔍</span>
                      <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'गलती विश्लेषण' : 'Error Analysis'}</span>
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
                <button onClick={() => router.push('/progress')} className="w-full text-xs font-semibold py-2 text-center" style={{ color: 'var(--orange)' }}>
                  {isHi ? 'पूरा विश्लेषण देखो →' : 'See full analytics →'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
