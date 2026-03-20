'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, Input, LoadingFoxy, BottomNav } from '@/components/ui';

interface ChildData {
  student_id: string; name: string; grade: string; board: string;
  school: string; xp_total: number; streak_days: number;
  last_active: string; preferred_subject: string; invite_code: string;
}

export default function ParentDashboard() {
  const { guardian, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [children, setChildren] = useState<ChildData[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkCode, setLinkCode] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');
  const [linking, setLinking] = useState(false);
  const [activeChild, setActiveChild] = useState<string | null>(null);
  const [childActivity, setChildActivity] = useState<any>(null);
  const [childQuizzes, setChildQuizzes] = useState<any[]>([]);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);

  const loadChildren = useCallback(async () => {
    if (!guardian) return;
    setLoading(true);
    const { data } = await supabase.rpc('get_guardian_dashboard', { p_guardian_id: guardian.id });
    if (data?.children) {
      setChildren(data.children);
      if (data.children.length > 0 && !activeChild) setActiveChild(data.children[0].student_id);
    }
    setLoading(false);
  }, [guardian, activeChild]);

  useEffect(() => { if (guardian) loadChildren(); }, [guardian, loadChildren]);

  // Load active child's recent activity
  useEffect(() => {
    if (!activeChild) return;
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data: act } = await supabase.from('daily_activity').select('*').eq('student_id', activeChild).order('activity_date', { ascending: false }).limit(7);
      setChildActivity(act || []);
      const { data: quizzes } = await supabase.from('quiz_sessions').select('*').eq('student_id', activeChild).order('created_at', { ascending: false }).limit(5);
      setChildQuizzes(quizzes || []);
    })();
  }, [activeChild]);

  const linkChild = async () => {
    if (!linkCode.trim() || !guardian) return;
    setLinking(true); setLinkError(''); setLinkSuccess('');
    const { data, error } = await supabase.rpc('link_guardian_to_student_via_code', {
      p_guardian_id: guardian.id, p_invite_code: linkCode.trim(),
    });
    if (error) { setLinkError(error.message); }
    else if (data?.error) { setLinkError(data.error); }
    else { setLinkSuccess(data?.message || 'Linked successfully!'); setLinkCode(''); loadChildren(); }
    setLinking(false);
  };

  if (isLoading) return <LoadingFoxy />;
  const child = children.find(c => c.student_id === activeChild);
  const todayAct = childActivity?.[0];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              👨‍👩‍👧 Parent Dashboard
            </h1>
            <p className="text-[11px] text-[var(--text-3)]">{guardian?.name || 'Parent'}</p>
          </div>
          <button onClick={() => router.push('/profile')} className="text-sm px-3 py-1.5 rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>Profile</button>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
        {/* Children tabs */}
        {children.length > 1 && (
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {children.map(c => (
              <button key={c.student_id} onClick={() => setActiveChild(c.student_id)}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{ background: activeChild === c.student_id ? 'var(--orange)' : 'var(--surface-1)', color: activeChild === c.student_id ? '#fff' : 'var(--text-2)', border: '1px solid var(--border)' }}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16"><div className="text-4xl animate-float mb-3">👨‍👩‍👧</div><p className="text-sm text-[var(--text-3)]">Loading...</p></div>
        ) : children.length === 0 ? (
          /* No children linked — show link form */
          <Card>
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🔗</div>
              <h2 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>Link Your Child</h2>
              <p className="text-sm text-[var(--text-3)] mb-6 max-w-xs mx-auto">Ask your child to open their Profile and share the Invite Code with you</p>
              <div className="max-w-xs mx-auto space-y-3">
                <Input placeholder="Enter Invite Code (e.g. A1B2C3D4)" value={linkCode} onChange={e => setLinkCode(e.target.value.toUpperCase())} className="text-center text-lg font-bold tracking-widest" />
                {linkError && <p className="text-xs text-red-500">{linkError}</p>}
                {linkSuccess && <p className="text-xs text-green-600 font-semibold">{linkSuccess}</p>}
                <Button fullWidth onClick={linkChild} disabled={linking || !linkCode.trim()}>{linking ? 'Linking...' : 'Link Child'}</Button>
              </div>
            </div>
          </Card>
        ) : child ? (
          <>
            {/* Child Summary Card */}
            <Card accent={child.preferred_subject === 'math' ? '#3B82F6' : child.preferred_subject === 'science' ? '#10B981' : '#E8581C'}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--orange), #F5A623)' }}>
                  {child.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold truncate">{child.name}</div>
                  <div className="text-[11px] text-[var(--text-3)]">Grade {child.grade} | {child.board} {child.school ? `| ${child.school}` : ''}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-lg font-extrabold" style={{ color: 'var(--orange)' }}>{child.xp_total || 0}</div>
                  <div className="text-[10px] text-[var(--text-3)] font-semibold">Total XP</div>
                </div>
                <div className="text-center p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-lg font-extrabold" style={{ color: '#EF4444' }}>{child.streak_days || 0}</div>
                  <div className="text-[10px] text-[var(--text-3)] font-semibold">Day Streak</div>
                </div>
                <div className="text-center p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-lg font-extrabold" style={{ color: '#16A34A' }}>{todayAct?.xp_earned || 0}</div>
                  <div className="text-[10px] text-[var(--text-3)] font-semibold">Today XP</div>
                </div>
              </div>
            </Card>

            {/* Today's Activity */}
            <Card>
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Today&apos;s Activity</h3>
              {todayAct ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Sessions', value: todayAct.sessions_count || 0, color: '#3B82F6' },
                    { label: 'Questions', value: todayAct.questions_asked || 0, color: '#8B5CF6' },
                    { label: 'Correct', value: todayAct.questions_correct || 0, color: '#16A34A' },
                    { label: 'Minutes', value: todayAct.minutes_spent || 0, color: '#F59E0B' },
                  ].map(s => (
                    <div key={s.label} className="p-3 rounded-xl text-center" style={{ background: `${s.color}08`, border: `1px solid ${s.color}15` }}>
                      <div className="text-xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[10px] text-[var(--text-3)] font-semibold mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="text-3xl mb-2">😴</div>
                  <p className="text-sm text-[var(--text-3)]">{child.name} hasn&apos;t studied today yet</p>
                </div>
              )}
            </Card>

            {/* 7-Day Activity */}
            <Card>
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Last 7 Days</h3>
              <div className="flex items-end gap-1.5 h-20">
                {(childActivity || []).slice(0, 7).reverse().map((day: any, i: number) => {
                  const maxXp = Math.max(...(childActivity || []).map((d: any) => d.xp_earned || 0), 1);
                  const pct = ((day.xp_earned || 0) / maxXp) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full rounded-t-lg transition-all" style={{ height: `${Math.max(pct, 8)}%`, background: day.xp_earned > 0 ? 'var(--orange)' : 'var(--surface-2)', minHeight: 4 }} />
                      <span className="text-[9px] text-[var(--text-3)]">{new Date(day.activity_date).toLocaleDateString('en-IN', { weekday: 'narrow' })}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Recent Quizzes */}
            <Card>
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Recent Quizzes</h3>
              {childQuizzes.length > 0 ? (
                <div className="space-y-2">
                  {childQuizzes.map((q: any) => (
                    <div key={q.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-extrabold" style={{ background: q.score_percent >= 80 ? '#16A34A20' : q.score_percent >= 50 ? '#F59E0B20' : '#EF444420', color: q.score_percent >= 80 ? '#16A34A' : q.score_percent >= 50 ? '#F59E0B' : '#EF4444' }}>
                        {q.score_percent || 0}%
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold capitalize truncate">{q.subject}</div>
                        <div className="text-[10px] text-[var(--text-3)]">{new Date(q.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} | {q.total_questions || 0} questions</div>
                      </div>
                      <div className="text-xs font-bold" style={{ color: 'var(--orange)' }}>+{q.xp_earned || 0} XP</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-[var(--text-3)] py-4">No quizzes taken yet</p>
              )}
            </Card>

            {/* Link another child */}
            <Card>
              <h3 className="text-sm font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>Link Another Child</h3>
              <div className="flex gap-2">
                <Input placeholder="Invite Code" value={linkCode} onChange={e => setLinkCode(e.target.value.toUpperCase())} className="flex-1 text-center font-bold tracking-wider" />
                <Button onClick={linkChild} disabled={linking || !linkCode.trim()}>{linking ? '...' : 'Link'}</Button>
              </div>
              {linkError && <p className="text-xs text-red-500 mt-1">{linkError}</p>}
              {linkSuccess && <p className="text-xs text-green-600 font-semibold mt-1">{linkSuccess}</p>}
            </Card>
          </>
        ) : null}
      </main>
      <BottomNav />
    </div>
  );
}
