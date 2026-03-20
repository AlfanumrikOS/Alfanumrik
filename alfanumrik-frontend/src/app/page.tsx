'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES, type Language } from '@/lib/types';

type OnboardStep = 'welcome' | 'auth' | 'profile' | 'subject';

const SUBJECTS_PREVIEW = [
  { code: 'math',     name: 'Mathematics', icon: '∑', color: '#6C5CE7' },
  { code: 'science',  name: 'Science',     icon: '⚛', color: '#00B894' },
  { code: 'physics',  name: 'Physics',     icon: '⚡', color: '#2563EB' },
  { code: 'chemistry',name: 'Chemistry',   icon: '🧪', color: '#DC2626' },
  { code: 'biology',  name: 'Biology',     icon: '🧬', color: '#16A34A' },
  { code: 'english',  name: 'English',     icon: 'Aa', color: '#E17055' },
  { code: 'hindi',    name: 'Hindi',       icon: 'अ', color: '#E84393' },
  { code: 'economics',name: 'Economics',   icon: '📈', color: '#D97706' },
];

export default function LandingPage() {
  const { isLoggedIn, isLoading, student, refreshStudent } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<OnboardStep>('welcome');
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE');
  const [language, setLanguage] = useState<Language>('en');
  const [selectedSubject, setSelectedSubject] = useState('math');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading && isLoggedIn) router.replace('/dashboard');
  }, [isLoading, isLoggedIn, router]);

  // listen for auth state — if user just verified OTP, move to profile
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await refreshStudent();
        const { data } = await supabase.from('students').select('onboarding_completed').eq('auth_user_id', session.user.id).single();
        if (data?.onboarding_completed) router.replace('/dashboard');
        else setStep('profile');
      }
    });
    return () => subscription.unsubscribe();
  }, [router, refreshStudent]);

  const sendOTP = async () => {
    if (!email.trim()) return;
    setAuthLoading(true); setAuthError('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) setAuthError(error.message);
    else setOtpSent(true);
    setAuthLoading(false);
  };

  const verifyOTP = async () => {
    if (!otp.trim()) return;
    setAuthLoading(true); setAuthError('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'email' });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    // check if student row exists
    const { data: existing } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
    if (existing) {
      await supabase.from('students').update({ name, grade, board, preferred_language: language, onboarding_completed: false }).eq('id', existing.id);
    } else {
      await supabase.from('students').insert({ auth_user_id: user.id, name, grade, board, preferred_language: language, email: user.email });
    }
    setStep('subject');
    setSaving(false);
  };

  const finishOnboarding = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    await supabase.from('students').update({ preferred_subject: selectedSubject, onboarding_completed: true }).eq('auth_user_id', user.id);
    await refreshStudent();
    router.replace('/dashboard');
    setSaving(false);
  };

  if (isLoading) return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-5xl animate-float">🦊</div>
    </div>
  );

  // ── Welcome ────────────────────────────────────────────────────
  if (step === 'welcome') return (
    <div className="mesh-bg min-h-dvh flex flex-col">
      {/* hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-8 text-center">
        <div className="text-7xl mb-6 animate-float" style={{ filter: 'drop-shadow(0 0 24px rgba(255,107,53,0.5))' }}>🦊</div>
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 text-xs font-semibold tracking-wider uppercase"
          style={{ background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.25)', color: 'var(--orange)' }}>
          AI-Powered Learning OS
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-4 leading-[1.1]" style={{ fontFamily: 'var(--font-display)' }}>
          Meet <span className="gradient-text">Foxy</span>,<br />your AI tutor
        </h1>
        <p className="text-lg text-[var(--text-2)] mb-10 max-w-sm leading-relaxed">
          Personalised CBSE/NCERT lessons in Hindi, English & 6 more languages. Grades 6–12.
        </p>

        {/* subject pills */}
        <div className="flex flex-wrap gap-2 justify-center mb-10 max-w-sm">
          {SUBJECTS_PREVIEW.map(s => (
            <span key={s.code} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
              style={{ background: `${s.color}18`, border: `1px solid ${s.color}30`, color: s.color }}>
              <span>{s.icon}</span>{s.name}
            </span>
          ))}
        </div>

        <button className="btn-primary w-full max-w-xs text-lg py-4" onClick={() => setStep('auth')}>
          Start Learning Free →
        </button>
        <p className="text-xs text-[var(--text-3)] mt-3">No credit card. No app download.</p>
      </div>

      {/* stats strip */}
      <div className="glass border-t border-[var(--border)] px-6 py-5">
        <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto text-center">
          {[['2,157+','Questions'],['3,574+','RAG Chunks'],['16','Subjects']].map(([v,l]) => (
            <div key={l}><div className="text-xl font-bold gradient-text">{v}</div><div className="text-xs text-[var(--text-3)] mt-0.5">{l}</div></div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Auth ───────────────────────────────────────────────────────
  if (step === 'auth') return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="glass rounded-3xl p-8 w-full max-w-sm animate-slide-up">
        <button onClick={() => setStep('welcome')} className="text-[var(--text-3)] text-sm mb-6 flex items-center gap-1 hover:text-[var(--text-2)]">
          ← Back
        </button>
        <div className="text-4xl mb-4 text-center">🦊</div>
        <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>Sign In / Sign Up</h2>
        <p className="text-sm text-[var(--text-3)] text-center mb-6">We'll send a magic link to your email</p>

        {!otpSent ? (
          <>
            <input className="input-base mb-3" type="email" placeholder="your@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOTP()} />
            {authError && <p className="text-red-400 text-sm mb-3">{authError}</p>}
            <button className="btn-primary w-full" onClick={sendOTP} disabled={authLoading || !email.trim()}>
              {authLoading ? 'Sending…' : 'Send OTP →'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-2)] mb-3 text-center">OTP sent to <strong>{email}</strong></p>
            <input className="input-base mb-3 text-center text-2xl tracking-[0.3em]" type="text" placeholder="000000"
              maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,''))}
              onKeyDown={e => e.key === 'Enter' && verifyOTP()} />
            {authError && <p className="text-red-400 text-sm mb-3">{authError}</p>}
            <button className="btn-primary w-full mb-3" onClick={verifyOTP} disabled={authLoading || otp.length < 6}>
              {authLoading ? 'Verifying…' : 'Verify OTP →'}
            </button>
            <button className="btn-ghost w-full text-sm" onClick={() => { setOtpSent(false); setOtp(''); setAuthError(''); }}>
              Change email
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ── Profile ────────────────────────────────────────────────────
  if (step === 'profile') return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="glass rounded-3xl p-8 w-full max-w-sm animate-slide-up">
        <div className="text-4xl mb-4 text-center">✏️</div>
        <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>Tell us about you</h2>
        <p className="text-sm text-[var(--text-3)] text-center mb-6">This helps Foxy personalise your lessons</p>

        <div className="space-y-3">
          <input className="input-base" placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} />

          <select className="input-base" value={grade} onChange={e => setGrade(e.target.value)}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>

          <select className="input-base" value={board} onChange={e => setBoard(e.target.value)}>
            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <div>
            <p className="text-xs text-[var(--text-3)] mb-2 ml-1">Preferred language</p>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.slice(0,6).map(l => (
                <button key={l.code} onClick={() => setLanguage(l.code)}
                  className="py-2 px-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ background: language === l.code ? 'rgba(255,107,53,0.2)' : 'var(--surface-2)',
                    border: language === l.code ? '1px solid rgba(255,107,53,0.5)' : '1px solid var(--border)',
                    color: language === l.code ? 'var(--orange)' : 'var(--text-2)' }}>
                  {l.labelNative}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-primary w-full mt-2" onClick={saveProfile}
            disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Subject ────────────────────────────────────────────────────
  if (step === 'subject') return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="glass rounded-3xl p-8 w-full max-w-sm animate-slide-up">
        <div className="text-4xl mb-4 text-center">📚</div>
        <h2 className="text-2xl font-bold text-center mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Pick your main subject
        </h2>
        <p className="text-sm text-[var(--text-3)] text-center mb-6">You can study all subjects — this is just your home base</p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          {SUBJECTS_PREVIEW.map(s => (
            <button key={s.code} onClick={() => setSelectedSubject(s.code)}
              className="p-4 rounded-2xl text-left transition-all"
              style={{ background: selectedSubject === s.code ? `${s.color}20` : 'var(--surface-2)',
                border: selectedSubject === s.code ? `1.5px solid ${s.color}` : '1px solid var(--border)' }}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-sm font-semibold" style={{ color: selectedSubject === s.code ? s.color : 'var(--text-1)' }}>
                {s.name}
              </div>
            </button>
          ))}
        </div>

        <button className="btn-primary w-full" onClick={finishOnboarding} disabled={saving}>
          {saving ? 'Setting up…' : 'Start Learning 🚀'}
        </button>
      </div>
    </div>
  );

  return null;
}
