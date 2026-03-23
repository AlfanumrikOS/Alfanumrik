'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getStudentProfiles, getSubjects, getFeatureFlags, getNextTopics, getStudentNotifications, generateNotifications } from '@/lib/supabase';
import { Card, StatCard, ProgressBar, SectionHeader, ActionTile, SubjectChip, Avatar, BottomNav } from '@/components/ui';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import type { StudentLearningProfile, Subject, CurriculumTopic } from '@/lib/types';

const QUICK_ACTIONS = [
  { href: '/foxy', icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो', color: '#E8581C' },
  { href: '/quiz?mode=cognitive', icon: '🧠', label: 'Smart Quiz', labelHi: 'स्मार्ट क्विज़', color: '#7C3AED' },
  { href: '/quiz', icon: '⚡', label: 'Quick Quiz', labelHi: 'क्विज़', color: '#F5A623' },
  { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू', color: '#0891B2' },
  { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति', color: '#16A34A' },
  { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'अध्ययन योजना', color: '#7C3AED' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', color: '#DB2777' },
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

    // Cognitive 2.0: Knowledge gaps
    try {
      const { data: gaps } = await supabase.from('knowledge_gaps').select('id, topic_title, severity, description, description_hi').eq('student_id', student.id).order('severity').limit(3);
      setKnowledgeGaps(gaps ?? []);
    } catch {}

    // Cognitive 2.0: Learning velocity
    try {
      const { data: vel } = await supabase.from('learning_velocity').select('velocity_score').eq('student_id', student.id).order('velocity_score', { ascending: false }).limit(1);
      if (vel && vel.length > 0) {
        const v = vel[0].velocity_score;
        setVelocityTrend(v > 0.05 ? 'fast' : v > 0.02 ? 'steady' : 'slow');
      }
    } catch {}

    // Cognitive 2.0: Highest Bloom level
    try {
      const { data: bloom } = await supabase.from('bloom_progression').select('bloom_level, mastery').eq('student_id', student.id).gte('mastery', 0.7).order('mastery', { ascending: false }).limit(1);
      if (bloom && bloom.length > 0) setBloomLevel(bloom[0]);
    } catch {}
  }, [student]);

  useEffect(() => {
    if (student) { loadData(); refreshSnapshot(); }
  }, [student?.id]);

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
          <ProgressBar
            value={((currentXp % 500) / 500) * 100}
            label={`${isHi ? 'स्तर' : 'Level'} ${currentLevel}`}
            showPercent
          />
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
          </div>
        </Card>

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

        {/* XP by Subject (only selected subjects) */}
        {profiles.filter(p => selectedSubjects.includes(p.subject)).length > 0 && (
          <div>
            <SectionHeader icon="🏅">{isHi ? 'विषयवार XP' : 'XP by Subject'}</SectionHeader>
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
          </div>
        )}
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
