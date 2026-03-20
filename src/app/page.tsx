'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES } from '@/lib/constants';

const SUBJECTS = [
  { code: 'math', name: 'Mathematics', icon: '∑', color: '#6C5CE7' },
  { code: 'science', name: 'Science', icon: '⚛', color: '#0891B2' },
  { code: 'physics', name: 'Physics', icon: '⚡', color: '#2563EB' },
  { code: 'chemistry', name: 'Chemistry', icon: '🧪', color: '#DC2626' },
  { code: 'biology', name: 'Biology', icon: '🧬', color: '#16A34A' },
  { code: 'english', name: 'English', icon: 'Aa', color: '#E17055' },
  { code: 'hindi', name: 'Hindi', icon: 'अ', color: '#E84393' },
  { code: 'economics', name: 'Economics', icon: '📈', color: '#D97706' },
];

export default function Home() {
  const { isLoggedIn, isLoading, student, refreshStudent } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<'welcome' | 'auth' | 'profile' | 'subject'>('welcome');
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE');
  const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('math');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading && isLoggedIn) router.replace('/dashboard');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await refreshStudent();
        const { data } = await supabase
          .from('students')
          .select('onboarding_completed')
          .eq('auth_user_id', session.user.id)
          .single();
        if (data?.onboarding_completed) {
          router.replace('/dashboard');
        } else {
          setStep('profile');
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [router, refreshStudent]);

  const sendOtp = async () => {
    if (!email.trim()) return;
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    if (error) setError(error.message);
    else setOtpSent(true);
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (!otp.trim()) return;
    setLoading(true); setError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: 'email',
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { data: existing } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
    if (existing) {
      await supabase.from('students').update({
        name, grade, board, preferred_language: lang, onboarding_completed: false,
      }).eq('id', existing.id);
    } else {
      await supabase.from('students').insert({
        auth_user_id: user.id, name, grade, board, preferred_language: lang, email: user.email,
      });
    }
    setStep('subject');
    setSaving(false);
  };

  const saveSubject = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    await supabase.from('students').update({
      preferred_subject: subject, onboarding_completed: true,
    }).eq('auth_user_id', user.id);
    await refreshStudent();
    router.replace('/dashboard');
    setSaving(false);
  };

  if (isLoading) {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center">
        <div className="text-5xl animate-float">🦊</div>
      </div>
    );
  }

  /* ─── Welcome ─────────────────────────────────────── */
  if (step === 'welcome') {
    return (
      <div className="mesh-bg min-h-dvh flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-8 text-center">
          {/* Fox mascot */}
          <div
            className="text-7xl mb-6 animate-float"
            style={{ filter: 'drop-shadow(0 4px 20px rgba(232, 88, 28, 0.3))' }}
          >
            🦊
          </div>

          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-xs font-semibold tracking-wider uppercase"
            style={{
              background: 'rgba(232, 88, 28, 0.08)',
              border: '1px solid rgba(232, 88, 28, 0.2)',
              color: 'var(--orange)',
            }}
          >
            AI-Powered Learning OS
          </div>

          {/* Headline */}
          <h1
            className="text-5xl md:text-6xl font-bold mb-4 leading-[1.1]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Meet <span className="gradient-text">Foxy</span>,
            <br />your AI tutor
          </h1>

          <p className="text-lg text-[var(--text-2)] mb-10 max-w-sm leading-relaxed">
            Personalised CBSE/NCERT lessons in Hindi, English & 6 more languages. Grades 6–12.
          </p>

          {/* Subject chips */}
          <div className="flex flex-wrap gap-2 justify-center mb-10 max-w-sm">
            {SUBJECTS.map((s) => (
              <span
                key={s.code}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
                style={{
                  background: `${s.color}10`,
                  border: `1px solid ${s.color}25`,
                  color: s.color,
                }}
              >
                <span>{s.icon}</span>
                {s.name}
              </span>
            ))}
          </div>

          <button className="btn-primary w-full max-w-xs text-lg py-4" onClick={() => setStep('auth')}>
            Start Learning Free →
          </button>
          <p className="text-xs text-[var(--text-3)] mt-3">No credit card. No app download.</p>
        </div>

        {/* Stats bar */}
        <div
          className="border-t px-6 py-5"
          style={{
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(16px)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto text-center">
            {([['2,157+', 'Questions'], ['3,574+', 'RAG Chunks'], ['16', 'Subjects']] as const).map(
              ([val, label]) => (
                <div key={label}>
                  <div className="text-xl font-bold gradient-text">{val}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5">{label}</div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ─── Auth ────────────────────────────────────────── */
  if (step === 'auth') {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <div
          className="rounded-3xl p-8 w-full max-w-sm animate-slide-up"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-mid)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
          }}
        >
          <button
            onClick={() => setStep('welcome')}
            className="text-[var(--text-3)] text-sm mb-6 flex items-center gap-1 hover:text-[var(--text-2)]"
          >
            ← Back
          </button>

          <div className="text-4xl mb-4 text-center">🦊</div>
          <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Sign In / Sign Up
          </h2>
          <p className="text-sm text-[var(--text-3)] text-center mb-6">
            We'll send a magic link to your email
          </p>

          {otpSent ? (
            <>
              <p className="text-sm text-[var(--text-2)] mb-3 text-center">
                OTP sent to <strong>{email}</strong>
              </p>
              <input
                className="input-base mb-3 text-center text-2xl tracking-[0.3em]"
                type="text"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
              />
              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
              <button className="btn-primary w-full mb-3" onClick={verifyOtp} disabled={loading || otp.length < 6}>
                {loading ? 'Verifying…' : 'Verify OTP →'}
              </button>
              <button
                className="btn-ghost w-full text-sm"
                onClick={() => { setOtpSent(false); setOtp(''); setError(''); }}
              >
                Change email
              </button>
            </>
          ) : (
            <>
              <input
                className="input-base mb-3"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
              />
              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
              <button className="btn-primary w-full" onClick={sendOtp} disabled={loading || !email.trim()}>
                {loading ? 'Sending…' : 'Send OTP →'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ─── Profile ─────────────────────────────────────── */
  if (step === 'profile') {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <div
          className="rounded-3xl p-8 w-full max-w-sm animate-slide-up"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-mid)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
          }}
        >
          <div className="text-4xl mb-4 text-center">✏️</div>
          <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Tell us about you
          </h2>
          <p className="text-sm text-[var(--text-3)] text-center mb-6">
            This helps Foxy personalise your lessons
          </p>

          <div className="space-y-3">
            <input
              className="input-base"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select className="input-base" value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADES.map((g) => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
            <select className="input-base" value={board} onChange={(e) => setBoard(e.target.value)}>
              {BOARDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <div>
              <p className="text-xs text-[var(--text-3)] mb-2 ml-1">Preferred language</p>
              <div className="grid grid-cols-3 gap-2">
                {LANGUAGES.slice(0, 6).map((l) => (
                  <button
                    key={l.code}
                    onClick={() => setLang(l.code)}
                    className="py-2 px-2 rounded-xl text-xs font-semibold transition-all"
                    style={{
                      background: lang === l.code ? 'rgba(232, 88, 28, 0.1)' : 'var(--surface-2)',
                      border: lang === l.code ? '1.5px solid var(--orange)' : '1.5px solid var(--border)',
                      color: lang === l.code ? 'var(--orange)' : 'var(--text-2)',
                    }}
                  >
                    {l.labelNative}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-primary w-full mt-2" onClick={saveProfile} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Subject Picker ──────────────────────────────── */
  if (step === 'subject') {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <div
          className="rounded-3xl p-8 w-full max-w-sm animate-slide-up"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-mid)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
          }}
        >
          <div className="text-4xl mb-4 text-center">📚</div>
          <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Pick your main subject
          </h2>
          <p className="text-sm text-[var(--text-3)] text-center mb-6">
            You can study all subjects — this is just your home base
          </p>

          <div className="grid grid-cols-2 gap-2 mb-6">
            {SUBJECTS.map((s) => (
              <button
                key={s.code}
                onClick={() => setSubject(s.code)}
                className="p-4 rounded-2xl text-left transition-all"
                style={{
                  background: subject === s.code ? `${s.color}12` : 'var(--surface-2)',
                  border: subject === s.code ? `1.5px solid ${s.color}` : '1.5px solid var(--border)',
                }}
              >
                <div className="text-2xl mb-1">{s.icon}</div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: subject === s.code ? s.color : 'var(--text-1)' }}
                >
                  {s.name}
                </div>
              </button>
            ))}
          </div>

          <button className="btn-primary w-full" onClick={saveSubject} disabled={saving}>
            {saving ? 'Setting up…' : 'Start Learning 🚀'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
