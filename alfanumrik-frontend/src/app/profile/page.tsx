'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { supabase, getSubscriptionPlans, getStudentSubscription } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES, type Language } from '@/lib/types';

export default function ProfilePage() {
  const { student, isLoggedIn, isLoading, isHi, language, setLanguage, refreshStudent, signOut } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [board, setBoard] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  useEffect(() => {
    if (!student) return;
    setName(student.name); setGrade(student.grade); setBoard(student.board ?? 'CBSE');
    setSchoolName(student.school_name ?? ''); setCity(student.city ?? '');
    Promise.all([getSubscriptionPlans(), getStudentSubscription(student.id)]).then(([p, s]) => { setPlans(p); setSubscription(s); });
  }, [student?.id]); // eslint-disable-line

  const saveProfile = async () => {
    if (!student) return;
    setSaving(true);
    await supabase.from('students').update({ name, grade, board, school_name: schoolName, city, preferred_language: language }).eq('id', student.id);
    await refreshStudent();
    setEditing(false); setSaving(false);
  };

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const currentPlan = subscription?.plan ?? plans.find(p => p.plan_code === 'free');
  const isPro = subscription?.plan_code === 'pro' || subscription?.plan_code === 'unlimited';

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
            <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>👤 {isHi ? 'प्रोफ़ाइल' : 'Profile'}</h1>
          </div>
          <button onClick={() => setEditing(!editing)} className="btn-ghost text-sm py-2 px-4">
            {editing ? (isHi ? 'रद्द' : 'Cancel') : (isHi ? 'संपादित करो' : 'Edit')}
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Avatar card */}
        <div className="glass rounded-3xl p-6 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-3"
            style={{ background: 'linear-gradient(135deg, var(--orange), var(--gold))' }}>
            {student.name[0]?.toUpperCase()}
          </div>
          <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{student.name}</h2>
          <p className="text-sm text-[var(--text-3)] mt-1">{student.email}</p>
          <div className="flex items-center gap-2 justify-center mt-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold"
              style={{ background: isPro ? 'rgba(255,184,0,0.15)' : 'rgba(255,255,255,0.07)', color: isPro ? 'var(--gold)' : 'var(--text-3)' }}>
              {isPro ? '⭐ Pro' : '🆓 Explorer'}
            </span>
            <span className="text-xs text-[var(--text-3)]">Grade {student.grade} · {student.board}</span>
          </div>
        </div>

        {/* Edit fields */}
        {editing ? (
          <div className="glass rounded-2xl p-5 space-y-3">
            <input className="input-base" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
            <select className="input-base" value={grade} onChange={e => setGrade(e.target.value)}>
              {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
            <select className="input-base" value={board} onChange={e => setBoard(e.target.value)}>
              {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <input className="input-base" placeholder="School name (optional)" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
            <input className="input-base" placeholder="City (optional)" value={city} onChange={e => setCity(e.target.value)} />
            <button className="btn-primary w-full" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        ) : (
          <div className="glass rounded-2xl p-5 space-y-3">
            {[
              { l: isHi ? 'कक्षा' : 'Grade', v: `Grade ${student.grade}` },
              { l: isHi ? 'बोर्ड' : 'Board', v: student.board },
              { l: isHi ? 'विद्यालय' : 'School', v: student.school_name ?? '—' },
              { l: isHi ? 'शहर' : 'City', v: student.city ?? '—' },
            ].map(({ l, v }) => (
              <div key={l} className="flex justify-between items-center py-2 border-b border-[var(--border)] last:border-0">
                <span className="text-sm text-[var(--text-3)]">{l}</span>
                <span className="text-sm font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Language */}
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-3">{isHi ? '🌐 भाषा' : '🌐 Language'}</h3>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.slice(0,6).map(l => (
              <button key={l.code} onClick={() => setLanguage(l.code as Language)}
                className="py-2 px-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: language === l.code ? 'rgba(255,107,53,0.2)' : 'var(--surface-2)',
                  border: language === l.code ? '1px solid rgba(255,107,53,0.5)' : '1px solid var(--border)',
                  color: language === l.code ? 'var(--orange)' : 'var(--text-2)' }}>
                {l.labelNative}
              </button>
            ))}
          </div>
        </div>

        {/* Subscription */}
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold mb-3">{isHi ? '💳 सदस्यता' : '💳 Subscription'}</h3>
          <div className="grid grid-cols-2 gap-2">
            {plans.map(p => {
              const isActive = subscription?.plan_code === p.plan_code || (!subscription && p.plan_code === 'free');
              return (
                <div key={p.plan_code} className="rounded-xl p-3 text-center"
                  style={{ background: isActive ? 'rgba(255,107,53,0.1)' : 'var(--surface-2)',
                    border: isActive ? '1.5px solid rgba(255,107,53,0.4)' : '1px solid var(--border)' }}>
                  <div className="font-bold text-sm">{p.name}</div>
                  <div className="text-lg font-bold mt-1 gradient-text">
                    {p.price_monthly === 0 ? 'Free' : `₹${p.price_monthly}/mo`}
                  </div>
                  {isActive && <div className="text-[10px] text-[var(--orange)] mt-1">✓ Active</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sign out */}
        <button onClick={async () => { await signOut(); router.replace('/'); }}
          className="btn-ghost w-full text-red-400 border-red-500/20">
          🚪 {isHi ? 'साइन आउट' : 'Sign Out'}
        </button>
      </div>
      <BottomNav />
    </div>
  );
}
