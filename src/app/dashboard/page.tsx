'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getStudentProfiles, getSubjects, getFeatureFlags, getNextTopics } from '@/lib/supabase';
import { Card, StatCard, ProgressBar, SectionHeader, ActionTile, SubjectChip, Avatar, LoadingFoxy, BottomNav } from '@/components/ui';

const QUICK_ACTIONS = [
  { href: '/foxy', icon: '🦊', label: 'Ask Foxy', labelHi: 'फॉक्सी से पूछो', color: '#E8581C' },
  { href: '/quiz', icon: '⚡', label: 'Quick Quiz', labelHi: 'क्विज़', color: '#F5A623' },
  { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू', color: '#0891B2' },
  { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति', color: '#16A34A' },
  { href: '/study-plan', icon: '📅', label: 'Study Plan', labelHi: 'अध्ययन योजना', color: '#7C3AED' },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड', color: '#DB2777' },
];

export default function Dashboard() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, language, setLanguage, refreshSnapshot } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [nextTopics, setNextTopics] = useState<any[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [flags, setFlags] = useState<any>({});
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

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
  }, [student]);

  useEffect(() => {
    if (student) { loadData(); refreshSnapshot(); }
  }, [student?.id]);

  if (isLoading || !student) return <LoadingFoxy />;

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

        {/* All Subjects */}
        {subjects.length > 0 && (
          <div>
            <SectionHeader icon="📚">{isHi ? 'सभी विषय' : 'All Subjects'}</SectionHeader>
            <div className="grid-subjects">
              {subjects.slice(0, 8).map((s) => (
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

        {/* XP by Subject */}
        {profiles.length > 1 && (
          <div>
            <SectionHeader icon="🏅">{isHi ? 'विषयवार XP' : 'XP by Subject'}</SectionHeader>
            <div className="space-y-2">
              {profiles.slice(0, 5).map((p) => {
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

      <BottomNav />
    </div>
  );
}
