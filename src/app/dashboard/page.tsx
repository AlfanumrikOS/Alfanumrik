'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import BottomNav from '@/lib/BottomNav';
import { supabase, getStudentProfiles, getFeatureFlags, getNextTopics, getDueReviews } from '@/lib/supabase';

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
    if (isHi) {
      setGreeting(h < 12 ? 'शुभ प्रभात' : h < 17 ? 'नमस्ते' : 'शुभ संध्या');
    } else {
      setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Hello' : 'Good evening');
    }
  }, [isHi]);

  const loadData = useCallback(async () => {
    if (!student) return;
    const [profs, subs, feats] = await Promise.all([
      getStudentProfiles(student.id),
      supabase.from('subjects').select('*').eq('is_active', true).order('name').then((r) => r.data ?? []),
      getFeatureFlags(),
    ]);
    setProfiles(profs);
    setSubjects(subs);
    setFlags(feats);
    setNextTopics((await getNextTopics(student.id, student.preferred_subject, student.grade)).slice(0, 3));

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

  if (isLoading || !student) {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center">
        <div className="text-5xl animate-float">🦊</div>
      </div>
    );
  }

  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);
  const mastered = snapshot?.topics_mastered ?? 0;
  const inProgress = snapshot?.topics_in_progress ?? 0;
  const current = profiles.find((p) => p.subject === student.preferred_subject);
  const currentXp = current?.xp ?? 0;
  const currentLevel = current?.level ?? 1;
  const subjectMeta = subjects.find((s) => s.code === student.preferred_subject);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* ─── Header ───────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          background: 'rgba(251, 248, 244, 0.85)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-3)]">{greeting},</p>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
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
              onClick={() => router.push('/profile')}
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, var(--orange), var(--gold))' }}
            >
              {student.name[0]?.toUpperCase()}
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content ─────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* ─── XP Hero Card ─────────────────────────────── */}
        <div
          className="rounded-3xl p-5 relative overflow-hidden"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
          }}
        >
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `radial-gradient(ellipse at top right, ${subjectMeta?.color ?? 'var(--orange)'}20 0%, transparent 70%)`,
            }}
          />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{subjectMeta?.icon ?? '📚'}</span>
                  <span className="font-semibold text-sm text-[var(--text-2)]">
                    {subjectMeta?.name ?? student.preferred_subject} · Grade {student.grade}
                  </span>
                </div>
                <div className="text-3xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)' }}>
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

            {/* XP progress bar */}
            <div className="mt-3">
              <div className="flex justify-between text-xs text-[var(--text-3)] mb-1.5">
                <span>{isHi ? 'स्तर' : 'Level'} {currentLevel}</span>
                <span>{currentXp % 500}/{500} XP</span>
              </div>
              <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full xp-bar gradient-brand"
                  style={{ width: `${Math.min(100, (currentXp % 500) / 500 * 100)}%` }}
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[
                { v: mastered, l: isHi ? 'महारत' : 'Mastered', c: 'var(--gold)' },
                { v: inProgress, l: isHi ? 'जारी' : 'In Progress', c: 'var(--teal)' },
                { v: dueCount, l: isHi ? 'रिव्यू' : 'Due Reviews', c: dueCount > 0 ? 'var(--orange)' : 'var(--text-3)' },
              ].map(({ v, l, c }) => (
                <div
                  key={l}
                  className="rounded-xl py-2 text-center"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div className="text-xl font-bold" style={{ color: c }}>{v}</div>
                  <div className="text-[10px] text-[var(--text-3)] mt-0.5">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Continue Learning ─────────────────────────── */}
        {nextTopics.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
              {isHi ? '▶ आगे सीखो' : '▶ Continue Learning'}
            </h2>
            <div className="space-y-2">
              {nextTopics.slice(0, 1).map((topic) => (
                <button
                  key={topic.topic_id}
                  onClick={() => router.push('/foxy')}
                  className="w-full rounded-2xl p-4 text-left card-hover flex items-center gap-4"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ background: `${subjectMeta?.color ?? 'var(--orange)'}15` }}
                  >
                    {subjectMeta?.icon ?? '📚'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{topic.title}</div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">
                      {isHi ? 'Foxy के साथ सीखो' : 'Learn with Foxy'} · Difficulty {topic.difficulty_level}/5
                    </div>
                  </div>
                  <span className="text-[var(--text-3)]">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Due Reviews Alert ─────────────────────────── */}
        {dueCount > 0 && flags.spaced_repetition && (
          <button
            onClick={() => router.push('/review')}
            className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all"
            style={{
              background: 'rgba(245, 166, 35, 0.08)',
              border: '1px solid rgba(245, 166, 35, 0.2)',
            }}
          >
            <span className="text-2xl">🔄</span>
            <div className="text-left">
              <div className="font-semibold text-sm" style={{ color: 'var(--gold)' }}>
                {dueCount} {isHi ? 'रिव्यू बाकी है!' : 'topics due for review!'}
              </div>
              <div className="text-xs text-[var(--text-3)]">
                {isHi ? 'स्मृति मजबूत करो' : 'Strengthen your memory'}
              </div>
            </div>
            <span className="ml-auto" style={{ color: 'var(--gold)' }}>→</span>
          </button>
        )}

        {/* ─── Quick Actions ────────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
            {isHi ? '⚡ त्वरित क्रियाएँ' : '⚡ Quick Actions'}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.href}
                onClick={() => router.push(a.href)}
                className="rounded-2xl p-3 text-center card-hover flex flex-col items-center gap-1.5"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                }}
              >
                <span className="text-2xl">{a.icon}</span>
                <span className="text-xs font-semibold" style={{ color: a.color }}>
                  {isHi ? a.labelHi : a.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── All Subjects ─────────────────────────────── */}
        {subjects.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
              {isHi ? '📚 सभी विषय' : '📚 All Subjects'}
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {subjects.slice(0, 8).map((s) => {
                const active = student.preferred_subject === s.code;
                return (
                  <button
                    key={s.code}
                    onClick={() => {
                      supabase.from('students').update({ preferred_subject: s.code }).eq('id', student.id);
                      router.push(`/learn/${s.code}`);
                    }}
                    className="rounded-xl p-2 text-center transition-all"
                    style={{
                      background: active ? `${s.color}12` : 'var(--surface-1)',
                      border: active ? `1.5px solid ${s.color}` : '1px solid var(--border)',
                    }}
                  >
                    <div className="text-lg">{s.icon}</div>
                    <div
                      className="text-[9px] mt-0.5 truncate font-semibold"
                      style={{ color: active ? s.color : 'var(--text-3)' }}
                    >
                      {s.name.split(' ')[0]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── XP by Subject ────────────────────────────── */}
        {profiles.length > 1 && (
          <div>
            <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
              {isHi ? '🏅 विषयवार XP' : '🏅 XP by Subject'}
            </h2>
            <div className="space-y-2">
              {profiles.slice(0, 5).map((p) => {
                const meta = subjects.find((s) => s.code === p.subject);
                const pct = Math.min(100, (p.xp % 500) / 500 * 100);
                return (
                  <div
                    key={p.id}
                    className="rounded-xl px-4 py-3 flex items-center gap-3"
                    style={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span className="text-lg">{meta?.icon ?? '📚'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold truncate">{meta?.name ?? p.subject}</span>
                        <span className="text-[var(--text-3)]">{p.xp} XP · Lv{p.level}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: meta?.color ?? 'var(--orange)' }}
                        />
                      </div>
                    </div>
                  </div>
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
