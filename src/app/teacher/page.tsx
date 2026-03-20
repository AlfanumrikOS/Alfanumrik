'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, Input, LoadingFoxy, BottomNav } from '@/components/ui';

export default function TeacherDashboard() {
  const { teacher, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'classes' | 'create'>('overview');
  const [className, setClassName] = useState('');
  const [classGrade, setClassGrade] = useState('9');
  const [classSection, setClassSection] = useState('A');
  const [creating, setCreating] = useState(false);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState('');

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);

  const loadData = useCallback(async () => {
    if (!teacher) return;
    setLoading(true);
    const { data: cls } = await supabase.from('classes').select('*').eq('created_by', teacher.id).eq('is_active', true).order('created_at', { ascending: false });
    setClasses(cls || []);
    if (cls && cls.length > 0 && !activeClass) setActiveClass(cls[0].id);

    // Get total student count across all classes
    if (cls && cls.length > 0) {
      const classIds = cls.map((c: any) => c.id);
      const { data: stu } = await supabase.from('class_students').select('*, students(id, name, grade, xp_total, streak_days, last_active, preferred_subject)').in('class_id', classIds);
      setStudents(stu || []);
    }
    setLoading(false);
  }, [teacher, activeClass]);

  useEffect(() => { if (teacher) loadData(); }, [teacher, loadData]);

  const createClass = async () => {
    if (!teacher || !className.trim()) return;
    setCreating(true);
    const code = (className.trim().substring(0, 3) + classGrade + classSection + Math.random().toString(36).substring(2, 5)).toUpperCase();
    const { error } = await supabase.from('classes').insert({
      name: className.trim(), grade: classGrade, section: classSection,
      class_code: code, created_by: teacher.id, school_id: null, is_active: true,
    });
    if (!error) { setClassName(''); setTab('classes'); loadData(); }
    setCreating(false);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopyMsg(code);
    setTimeout(() => setCopyMsg(''), 2000);
  };

  if (isLoading) return <LoadingFoxy />;

  const classStudents = students.filter(s => s.class_id === activeClass);
  const activeClassData = classes.find(c => c.id === activeClass);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>👩‍🏫 Teacher Dashboard</h1>
            <p className="text-[11px] text-[var(--text-3)]">{teacher?.name || 'Teacher'} | {teacher?.school_name || 'School'}</p>
          </div>
          <button onClick={() => router.push('/profile')} className="text-sm px-3 py-1.5 rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>Profile</button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="app-container pt-3 pb-1">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          {([['overview', 'Overview'], ['classes', 'My Classes'], ['create', '+ Create']] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
              style={{ background: tab === t ? 'var(--surface-1)' : 'transparent', color: tab === t ? 'var(--text-1)' : 'var(--text-3)', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.06)' : 'none' }}>{l}</button>
          ))}
        </div>
      </div>

      <main className="app-container py-4 space-y-4">
        {loading ? (
          <div className="text-center py-16"><div className="text-4xl animate-float mb-3">👩‍🏫</div><p className="text-sm text-[var(--text-3)]">Loading...</p></div>
        ) : tab === 'overview' ? (
          <>
            {/* Stats overview */}
            <div className="grid grid-cols-3 gap-3">
              <Card><div className="text-center"><div className="text-2xl font-extrabold" style={{ color: '#0891B2' }}>{classes.length}</div><div className="text-[10px] text-[var(--text-3)] font-semibold mt-1">Classes</div></div></Card>
              <Card><div className="text-center"><div className="text-2xl font-extrabold" style={{ color: 'var(--orange)' }}>{students.length}</div><div className="text-[10px] text-[var(--text-3)] font-semibold mt-1">Students</div></div></Card>
              <Card><div className="text-center"><div className="text-2xl font-extrabold" style={{ color: '#16A34A' }}>{teacher?.subjects_taught?.length || 0}</div><div className="text-[10px] text-[var(--text-3)] font-semibold mt-1">Subjects</div></div></Card>
            </div>

            {/* Recent activity from students */}
            <Card>
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--font-display)' }}>Your Students</h3>
              {students.length > 0 ? (
                <div className="space-y-2">
                  {students.slice(0, 10).map((s: any) => (
                    <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, #0891B2, #06B6D4)' }}>
                        {s.students?.name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{s.students?.name || 'Student'}</div>
                        <div className="text-[10px] text-[var(--text-3)]">Grade {s.students?.grade} | {s.students?.xp_total || 0} XP | {s.students?.streak_days || 0}d streak</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-3">📚</div>
                  <p className="text-sm text-[var(--text-3)] mb-3">No students yet. Create a class and share the code!</p>
                  <Button onClick={() => setTab('create')}>Create First Class</Button>
                </div>
              )}
            </Card>
          </>
        ) : tab === 'classes' ? (
          <>
            {classes.length === 0 ? (
              <Card>
                <div className="text-center py-8">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-sm text-[var(--text-3)] mb-3">No classes yet</p>
                  <Button onClick={() => setTab('create')}>Create First Class</Button>
                </div>
              </Card>
            ) : (
              <>
                {/* Class tabs */}
                <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {classes.map(c => (
                    <button key={c.id} onClick={() => setActiveClass(c.id)} className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: activeClass === c.id ? '#0891B2' : 'var(--surface-1)', color: activeClass === c.id ? '#fff' : 'var(--text-2)', border: '1px solid var(--border)' }}>
                      {c.name}
                    </button>
                  ))}
                </div>

                {activeClassData && (
                  <Card>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>{activeClassData.name}</h3>
                        <p className="text-[11px] text-[var(--text-3)]">Grade {activeClassData.grade} | Section {activeClassData.section}</p>
                      </div>
                      <button onClick={() => copyCode(activeClassData.class_code)} className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                        style={{ background: copyMsg === activeClassData.class_code ? '#16A34A15' : '#0891B215', color: copyMsg === activeClassData.class_code ? '#16A34A' : '#0891B2', border: '1px solid ' + (copyMsg === activeClassData.class_code ? '#16A34A30' : '#0891B230') }}>
                        {copyMsg === activeClassData.class_code ? 'Copied!' : `Code: ${activeClassData.class_code}`}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-3)] mb-3">Share this code with students so they can join your class</p>

                    {/* Students in this class */}
                    {classStudents.length > 0 ? (
                      <div className="space-y-2">
                        {classStudents.map((s: any) => (
                          <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, #0891B2, #06B6D4)' }}>
                              {s.students?.name?.[0] || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold truncate">{s.students?.name || 'Student'}</div>
                              <div className="text-[10px] text-[var(--text-3)]">{s.students?.xp_total || 0} XP | {s.students?.streak_days || 0}d streak</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-sm text-[var(--text-3)] py-4">No students in this class yet. Share the class code!</p>
                    )}
                  </Card>
                )}
              </>
            )}
          </>
        ) : (
          /* Create Class */
          <Card>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">📋</div>
              <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>Create a New Class</h2>
              <p className="text-xs text-[var(--text-3)] mt-1">Students will join using the class code</p>
            </div>
            <div className="space-y-3">
              <Input placeholder="Class name (e.g. 9-A Science)" value={className} onChange={e => setClassName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-3)] font-bold uppercase tracking-wide mb-1 block">Grade</label>
                  <select value={classGrade} onChange={e => setClassGrade(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}>
                    {['6', '7', '8', '9', '10', '11', '12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-3)] font-bold uppercase tracking-wide mb-1 block">Section</label>
                  <select value={classSection} onChange={e => setClassSection(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}>
                    {['A', 'B', 'C', 'D', 'E'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Button fullWidth onClick={createClass} disabled={creating || !className.trim()}>
                {creating ? 'Creating...' : 'Create Class'}
              </Button>
            </div>
          </Card>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
