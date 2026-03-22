'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES, SUBJECT_META } from '@/lib/constants';
import { Button, Input, Select, Card, LoadingFoxy } from '@/components/ui';

type Role = 'student' | 'teacher' | 'guardian';
type Step = 'landing' | 'role' | 'auth' | 'profile' | 'subject';

/* ═══ Brand color tokens ═══ */
const P = {
  navy: '#1A365D',      // Brand deep navy
  rose: '#E8581C',      // Brand orange
  teal: '#0891B2',
  green: '#16A34A',
  purple: '#7C3AED',
  gold: '#F5A623',
  lightBg: '#F5F0EA',   // Warm cream
  cardBg: '#FFFFFF',
  text1: '#1A1207',
  text2: '#5C4F3A',
  text3: '#9C8E78',
  border: 'rgba(0,0,0,0.08)',
};

export default function Home() {
  const { isLoggedIn, isLoading, refreshStudent } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('landing');
  const [role, setRole] = useState<Role>('student');
  const [activeSpotlight, setActiveSpotlight] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  /* Auth */
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [authMethod, setAuthMethod] = useState<'email'|'phone'>('email');
  const [otpSent, setOtpSent] = useState(false); const [otp, setOtp] = useState('');
  const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signup'|'login'|'otp'|'forgot'>('signup');
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  /* Profile */
  const [name, setName] = useState(''); const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE'); const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('math'); const [saving, setSaving] = useState(false);
  const [selectedSubs, setSelectedSubs] = useState<string[]>(['math']);
  const [schoolName, setSchoolName] = useState('');
  const [subjectsTaught, setSubjectsTaught] = useState<string[]>(['math']);
  const [gradesTaught, setGradesTaught] = useState<string[]>(['9']);
  const [qualification, setQualification] = useState('');
  const [relationship, setRelationship] = useState('parent');
  const [parentPhone, setParentPhone] = useState('');
  const [childInviteCode, setChildInviteCode] = useState('');
  const [linkResult, setLinkResult] = useState<string | null>(null);

  // Handle logged-in users: check onboarding status using RPC (works on any device)
  useEffect(() => {
    if (isLoading) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Single RPC checks all roles + onboarding status
      const { data: roleData } = await supabase.rpc('get_user_role', { p_auth_user_id: user.id });
      if (roleData) {
        const rd = roleData as any;
        // Route to correct dashboard if any role completed onboarding
        if (rd.student?.onboarding_completed) { router.replace('/dashboard'); return; }
        if (rd.teacher?.onboarding_completed) { router.replace('/teacher'); return; }
        if (rd.guardian?.onboarding_completed) { router.replace('/parent'); return; }
        // User exists but onboarding not done — show profile form
        if (rd.roles?.length > 0) { setStep('profile'); return; }
      }
      // No role record at all — fresh user, stay on landing
    })();
  }, [isLoading, router]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (ev, sess) => {
      if ((ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') && sess?.user) {
        await refreshStudent();
        // Single RPC checks all roles + onboarding status
        const { data: roleData } = await supabase.rpc('get_user_role', { p_auth_user_id: sess.user.id });
        if (roleData) {
          const rd = roleData as any;
          if (rd.student?.onboarding_completed) { router.replace('/dashboard'); return; }
          if (rd.teacher?.onboarding_completed) { router.replace('/teacher'); return; }
          if (rd.guardian?.onboarding_completed) { router.replace('/parent'); return; }
          if (rd.roles?.length > 0) { setStep('profile'); return; }
        }
        // New user — show profile setup
        setStep('profile');
      }
    });
    return () => subscription.unsubscribe();
  }, [router, refreshStudent]);

  const sendOtp = async () => {
    const id = authMethod === 'email' ? email.trim() : phone.trim();
    if (!id) return; setLoading(true); setError('');
    const { error: e } = authMethod === 'email'
      ? await supabase.auth.signInWithOtp({ email: id, options: { shouldCreateUser: true } })
      : await supabase.auth.signInWithOtp({ phone: id });
    e ? setError(e.message) : setOtpSent(true); setLoading(false);
  };
  const verifyOtp = async () => {
    if (!otp.trim()) return; setLoading(true); setError('');
    const id = authMethod === 'email' ? email.trim() : phone.trim();
    const { error: e } = authMethod === 'email'
      ? await supabase.auth.verifyOtp({ email: id, token: otp.trim(), type: 'email' })
      : await supabase.auth.verifyOtp({ phone: id, token: otp.trim(), type: 'sms' });
    if (e) setError(e.message); setLoading(false);
  };
  const signUpWithPassword = async () => {
    if (!email.trim() || !password) return;
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true); setError('');
    const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password });
    if (e) {
      setError(e.message);
    } else if (data.session) {
      // Email confirmation disabled — user auto-signed-in, onAuthStateChange handles routing
    } else if (data.user && !data.session) {
      // Email confirmation required — show "check your email" screen
      setOtpSent(true);
    } else {
      // User may already exist (Supabase returns fake success to prevent enumeration)
      setError('An account with this email may already exist. Try Log In instead.');
    }
    setLoading(false);
  };
  const signInWithPassword = async () => {
    if (!email.trim() || !password) return;
    setLoading(true); setError('');
    const { data, error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (e) {
      if (e.message === 'Invalid login credentials') setError('Wrong email or password. Try again or use Forgot Password.');
      else if (e.message === 'Email not confirmed') setError('Please confirm your email first. Check your inbox for the confirmation link.');
      else setError(e.message);
    }
    // If success, onAuthStateChange handles routing to profile or dashboard
    setLoading(false);
  };
  const sendResetEmail = async () => {
    if (!email.trim()) { setError('Enter your email address first'); return; }
    setLoading(true); setError('');
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/auth/reset',
    });
    if (e) setError(e.message);
    else setResetSent(true);
    setLoading(false);
  };
  const saveProfile = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    if (role === 'student') {
      const { data: ex } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      const p = { name, grade, board, preferred_language: lang, email: user.email, phone: phone || undefined, parent_phone: parentPhone || undefined, onboarding_completed: false };
      ex ? await supabase.from('students').update(p).eq('id', ex.id) : await supabase.from('students').insert({ ...p, auth_user_id: user.id });
      setStep('subject');
    } else if (role === 'teacher') {
      const { data: ex } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
      const p = { name, school_name: schoolName, subjects_taught: subjectsTaught, grades_taught: gradesTaught, board, qualification, preferred_language: lang, email: user.email, is_active: true, onboarding_completed: true };
      ex ? await supabase.from('teachers').update(p).eq('id', ex.id) : await supabase.from('teachers').insert({ ...p, auth_user_id: user.id });
      const { data: stu } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      if (!stu) await supabase.from('students').insert({ auth_user_id: user.id, name, grade: gradesTaught[0]||'9', board, preferred_language: lang, email: user.email, onboarding_completed: true });
      await refreshStudent(); router.replace('/teacher');
    } else {
      const { data: ex } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
      const p = { name, relationship, preferred_language: lang, email: user.email, phone: phone||undefined, onboarding_completed: true };
      ex ? await supabase.from('guardians').update(p).eq('id', ex.id) : await supabase.from('guardians').insert({ ...p, auth_user_id: user.id });
      const { data: stu } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      if (!stu) await supabase.from('students').insert({ auth_user_id: user.id, name, grade:'9', board:'CBSE', preferred_language: lang, email: user.email, onboarding_completed: true });
      // Auto-link child if invite code provided
      if (childInviteCode.trim()) {
        const { data: gd } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
        if (gd) {
          await supabase.rpc('link_guardian_to_student_via_code', { p_guardian_id: gd.id, p_invite_code: childInviteCode.trim() });
        }
      }
      await refreshStudent(); router.replace('/parent');
    }
    setSaving(false);
  };
  const saveSubject = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const subs = selectedSubs.length > 0 ? selectedSubs : [subject]; await supabase.from('students').update({ preferred_subject: subs[0], selected_subjects: subs, onboarding_completed: true }).eq('auth_user_id', user.id);
    await refreshStudent(); router.replace('/dashboard'); setSaving(false);
  };
  const tog = (a: string[], i: string, s: (v: string[]) => void) => s(a.includes(i)?a.filter(x=>x!==i):[...a,i]);

  if (isLoading) return <LoadingFoxy />;

  /* ════════════════════════════════════════════════════════
     LANDING PAGE
  ════════════════════════════════════════════════════════ */
  if (step === 'landing') {

    return (
      <div style={{ background: '#fff', fontFamily: 'var(--font-body)' }}>
        {/* ═══ INLINE RESPONSIVE STYLES ═══ */}
        <style dangerouslySetInnerHTML={{ __html: `
          .lp-stats { display: grid; grid-template-columns: repeat(2, 1fr); }
          .lp-steps { display: grid; grid-template-columns: 1fr; gap: 16px; }
          .lp-features { display: grid; grid-template-columns: 1fr; gap: 12px; }
          .lp-roles { display: grid; grid-template-columns: 1fr; gap: 12px; }
          .lp-badges { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
          .lp-hero { padding: 48px 16px 72px; text-align: center; position: relative; overflow: hidden; }
          .lp-section { padding: 40px 16px; }
          .lp-cta { display: flex; flex-direction: column; align-items: center; gap: 10px; }
          .lp-nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 16px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
          .lp-stats-wrap { max-width: 900px; margin: -28px auto 0; padding: 0 16px; position: relative; z-index: 10; }
          .lp-container { max-width: 1100px; margin: 0 auto; width: 100%; }

          @media (min-width: 400px) {
            .lp-cta { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 12px; }
          }
          @media (min-width: 480px) {
            .lp-features { grid-template-columns: repeat(2, 1fr); gap: 14px; }
          }
          @media (min-width: 640px) {
            .lp-stats { grid-template-columns: repeat(4, 1fr); }
            .lp-steps { grid-template-columns: repeat(3, 1fr); gap: 20px; }
            .lp-roles { grid-template-columns: repeat(2, 1fr); gap: 14px; }
            .lp-hero { padding: 72px 20px 88px; }
            .lp-section { padding: 64px 20px; }
            .lp-nav-inner { padding: 0 20px; }
            .lp-stats-wrap { margin-top: -40px; padding: 0 20px; }
            .lp-badges { gap: 16px; }
          }
          @media (min-width: 900px) {
            .lp-features { grid-template-columns: repeat(3, 1fr); gap: 16px; }
            .lp-roles { grid-template-columns: repeat(3, 1fr); gap: 16px; }
          }
          @media (min-width: 1024px) {
            .lp-hero { padding: 100px 20px 100px; }
            .lp-section { padding: 80px 20px; }
          }
          @media (max-width: 374px) {
            .lp-hero h1 { font-size: clamp(22px, 7vw, 28px) !important; }
            .lp-section h2 { font-size: clamp(18px, 5vw, 24px) !important; }
          }
        ` }} />
        {/* ════ NAV ════ */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.05)', height: 64 }}>
          <div className="lp-nav-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🦊</span>
              <div>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: P.navy }}>Alfanumrik</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: P.text3, display: 'block', marginTop: -2, letterSpacing: 0.5 }}>Adaptive Learning OS</span>
              </div>
            </div>
            {/* Desktop nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }} className="hidden md:flex">
              <span style={{ fontSize: 13, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>How It Works</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>Features</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('for-whom')?.scrollIntoView({ behavior: 'smooth' })}>For Whom</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('trust')?.scrollIntoView({ behavior: 'smooth' })}>Trust & Security</span>
              <button onClick={() => {setAuthMode('login');setStep('auth');}} style={{ padding: '7px 18px', borderRadius: 8, border: `1.5px solid ${P.navy}`, background: 'transparent', color: P.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Log In</button>
              <button onClick={() => setStep('role')} style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: P.rose, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Get Started Free</button>
            </div>
            {/* Mobile hamburger */}
            <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden" style={{ fontSize: 24, background: 'none', border: 'none', cursor: 'pointer', color: P.navy }}>{mobileMenu ? '\u2715' : '\u2630'}</button>
          </div>
          {/* Mobile menu */}
          {mobileMenu && (
            <div className="md:hidden" style={{ position: 'absolute', top: 64, left: 0, right: 0, background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '16px', zIndex: 100 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: P.text1, cursor: 'pointer', padding: '8px 0' }} onClick={() => {document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });setMobileMenu(false);}}>How It Works</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: P.text1, cursor: 'pointer', padding: '8px 0' }} onClick={() => {document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });setMobileMenu(false);}}>Features</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: P.text1, cursor: 'pointer', padding: '8px 0' }} onClick={() => {document.getElementById('for-whom')?.scrollIntoView({ behavior: 'smooth' });setMobileMenu(false);}}>For Whom</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: P.text1, cursor: 'pointer', padding: '8px 0' }} onClick={() => {document.getElementById('trust')?.scrollIntoView({ behavior: 'smooth' });setMobileMenu(false);}}>Trust & Security</span>
                <div style={{ display: 'flex', gap: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <button onClick={() => {setAuthMode('login');setStep('auth');}} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1.5px solid ${P.navy}`, background: 'transparent', color: P.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Log In</button>
                  <button onClick={() => setStep('role')} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: P.rose, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Get Started</button>
                </div>
              </div>
            </div>
          )}
        </nav>

        {/* ════ HERO ════ */}
        <section className="lp-hero" style={{ background: `linear-gradient(135deg, ${P.navy} 0%, #0F2942 60%, #1A365D 100%)` }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(232,88,28,0.08) 0%, transparent 60%)', pointerEvents: 'none' }} />
          <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>🇮🇳 Startup India Recognized | ISO 27001 Certified</span>
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(28px, 5.5vw, 52px)', lineHeight: 1.15, color: '#fff', marginBottom: 18 }}>
              India&apos;s Smartest AI Tutor<br/>for CBSE Students
            </h1>
            <p style={{ fontSize: 'clamp(15px, 2vw, 19px)', color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, maxWidth: 580, margin: '0 auto 32px' }}>
              Foxy, your personal AI tutor, teaches at YOUR level — not your grade level.
              Powered by Bayesian mastery tracking, spaced repetition &amp; adaptive learning. Hindi, English &amp; 8 more languages.
            </p>
            <div className="lp-cta">
              <button onClick={() => setStep('role')} style={{ padding: '14px 32px', borderRadius: 10, border: 'none', background: P.rose, color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%', maxWidth: 240 }}>
                Start Learning Free
              </button>
              <button onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })} style={{ padding: '14px 32px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.25)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, cursor: 'pointer', width: '100%', maxWidth: 240 }}>
                See How It Works
              </button>
            </div>
          </div>
        </section>

        {/* ════ STATS BAR ════ */}
        <section className="lp-stats-wrap">
          <div className="lp-stats" style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            {[['2,100+','Practice Questions'],['726','CBSE Chapters'],['16','Subjects Covered'],['6+','Indian Languages']].map(([v, l]) => (
              <div key={l} style={{ padding: 'clamp(14px, 3vw, 28px) 8px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)', borderRight: '1px solid rgba(0,0,0,0.04)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(18px, 3vw, 32px)', color: P.rose }}>{v}</div>
                <div style={{ fontSize: 'clamp(9px, 1.4vw, 12px)', color: P.text3, marginTop: 2, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ════ HOW IT WORKS ════ */}
        <section id="how-it-works" className="lp-section" style={{ textAlign: 'center' }}>
          <div className="lp-container" style={{ margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3.5vw, 34px)', color: P.navy, marginBottom: 10 }}>How Alfanumrik Works</h2>
            <p style={{ fontSize: 14, color: P.text2, lineHeight: 1.7, maxWidth: 500, margin: '0 auto 40px' }}>
              Three steps to transform learning outcomes. No complex setup required.
            </p>
            <div className="lp-steps">
              {[
                { step: '1', icon: '📝', title: 'Sign Up & Choose Subjects', desc: 'Create your free account in 60 seconds. Pick your grade, board, and subjects. Foxy assesses your current level automatically.' },
                { step: '2', icon: '🦊', title: 'Learn with Foxy AI Tutor', desc: 'Ask questions in Hindi or English. Foxy teaches step by step, gives practice problems, creates quizzes, and tracks your mastery with spaced repetition.' },
                { step: '3', icon: '📈', title: 'Track Progress & Master Topics', desc: 'Spaced repetition ensures you never forget. Parents get daily reports. Teachers see class mastery heatmaps.' },
              ].map(s => (
                <div key={s.step} style={{ padding: '32px 24px', borderRadius: 16, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: -14, left: 24, width: 28, height: 28, borderRadius: '50%', background: P.rose, color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.step}</div>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>{s.icon}</div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: P.navy, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ fontSize: 13, color: P.text2, lineHeight: 1.65 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ FEATURES ════ */}
        <section id="features" className="lp-section" style={{ background: P.lightBg }}>
          <div className="lp-container" style={{ margin: '0 auto' }}>
            <h2 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3.5vw, 34px)', color: P.navy, marginBottom: 10 }}>
              Why Students Love Alfanumrik
            </h2>
            <p style={{ textAlign: 'center', fontSize: 14, color: P.text2, lineHeight: 1.7, maxWidth: 500, margin: '0 auto 40px' }}>
              Evidence-backed learning science meets AI. Built specifically for Indian school students.
            </p>
            <div className="lp-features">
              {[
                { icon: '🦊', t: 'Foxy AI Tutor', d: 'Ask any question in Hindi or English. Foxy explains step by step with voice support. Math symbols, diagrams, and exam tips built in.', bg: `${P.gold}15` },
                { icon: '🧠', t: 'Adaptive Learning Engine', d: 'AI tracks what you know using Bayesian mastery tracking. Every session targets your exact gaps.', bg: `${P.rose}0A` },
                { icon: '🔄', t: 'Spaced Repetition', d: 'Never forget what you learned. The app reminds you to revise at the scientifically optimal time.', bg: `${P.teal}0A` },
                { icon: '⚡', t: 'CBSE Aligned', d: '726 chapters across 16 subjects. Every question mapped to CBSE textbooks, competency frameworks, and board exam patterns.', bg: `${P.navy}0A` },
                { icon: '🎤', t: 'Voice Conversations', d: 'Talk to Foxy like a real teacher. Indian English and Hindi voice support for hands-free learning.', bg: `${P.purple}0A` },
                { icon: '🏆', t: 'Gamified & Fun', d: 'XP, streaks, leaderboards, and badges. Stay motivated with friendly competition and daily goals.', bg: `${P.green}0A` },
              ].map(f => (
                <div key={f.t} style={{ padding: '28px 24px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.05)', transition: 'all 0.3s' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 14, background: f.bg }}>{f.icon}</div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: P.navy, marginBottom: 6 }}>{f.t}</h3>
                  <p style={{ fontSize: 13, color: P.text2, lineHeight: 1.65 }}>{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ FOR WHOM ════ */}
        <section id="for-whom" className="lp-section">
          <div className="lp-container" style={{ margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3.5vw, 34px)', color: P.navy, marginBottom: 10 }}>
              Built for Every Stakeholder
            </h2>
            <p style={{ fontSize: 14, color: P.text2, lineHeight: 1.7, maxWidth: 500, margin: '0 auto 40px' }}>
              One platform. Different experiences. Students learn, teachers monitor, parents stay informed.
            </p>
            <div className="lp-roles">
              {[
                { icon: '🎓', role: 'Students', color: P.purple, items: ['AI tutor with voice & math symbols', 'Adaptive quizzes with instant feedback', 'Spaced repetition to never forget', 'XP, streaks & leaderboards', 'CBSE board exam preparation'] },
                { icon: '👩\u200D🏫', role: 'Teachers', color: P.teal, items: ['Create classes with a shareable code', 'View student mastery at a glance', 'Assign quizzes and track completion', 'Identify weak topics class-wide', 'NEP 2020 compliant reports'] },
                { icon: '👨\u200D👩\u200D👧', role: 'Parents', color: P.green, items: ['Daily activity summary of your child', 'Quiz scores and streak tracking', 'Weekly progress reports', 'Link multiple children', 'Zero setup required'] },
              ].map(r => (
                <div key={r.role} style={{ padding: '32px 24px', borderRadius: 16, background: '#fff', border: `1.5px solid ${r.color}20`, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 28 }}>{r.icon}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: r.color }}>{r.role}</span>
                  </div>
                  {r.items.map(item => (
                    <div key={item} style={{ display: 'flex', gap: 10, padding: '6px 0', fontSize: 13, color: P.text2, lineHeight: 1.5 }}>
                      <span style={{ color: r.color, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{'\u2713'}</span> {item}
                    </div>
                  ))}
                  <button onClick={() => { setRole(r.role === 'Teachers' ? 'teacher' as Role : r.role === 'Parents' ? 'guardian' as Role : 'student' as Role); setStep('role'); }} style={{ marginTop: 16, width: '100%', padding: '10px', borderRadius: 10, border: `1.5px solid ${r.color}30`, background: `${r.color}08`, color: r.color, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Get Started as {r.role.replace(/s$/, '')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ TRUST & SECURITY ════ */}
        <section id="trust" style={{ background: P.navy, padding: 'clamp(40px, 6vw, 64px) 16px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3vw, 30px)', color: '#fff', marginBottom: 10 }}>
              Trusted, Certified & Compliant
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, maxWidth: 500, margin: '0 auto 36px' }}>
              Built by Cusiosense Learning India Private Limited. Your data is protected by enterprise-grade security.
            </p>
            <div className="lp-badges" style={{ marginBottom: 32 }}>
              {[
                { badge: '🇮🇳', label: 'Startup India\nRecognized' },
                { badge: '🛡️', label: 'ISO 27001\nInformation Security' },
                { badge: '🤖', label: 'ISO 42001\nAI Management' },
                { badge: '📋', label: 'ISO 42005\nAI Governance' },
                { badge: '💳', label: 'PCI-DSS\nData Protection' },
                { badge: '📖', label: 'NEP 2020\nAligned' },
                { badge: '📝', label: 'CBSE\nCompliant' },
              ].map(b => (
                <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 80 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{b.badge}</div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ CTA ════ */}
        <section className="lp-section" style={{ textAlign: 'center' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 4vw, 36px)', color: P.navy, marginBottom: 10 }}>
              Ready to Learn Smarter?
            </h2>
            <p style={{ fontSize: 14, color: P.text2, lineHeight: 1.7, marginBottom: 28 }}>
              Join thousands of students, teachers, and parents across India. Free to start, no credit card needed.
            </p>
            <div className="lp-cta">
              <button onClick={() => setStep('role')} style={{ padding: '14px 36px', borderRadius: 10, border: 'none', background: P.rose, color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                Get Started Free
              </button>
              <button onClick={() => {setAuthMode('login');setStep('auth');}} style={{ padding: '14px 36px', borderRadius: 10, border: `1.5px solid ${P.navy}`, background: 'transparent', color: P.navy, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                Log In
              </button>
            </div>
          </div>
        </section>

        {/* ════ FOOTER ════ */}
        <footer style={{ background: P.navy, padding: 'clamp(24px, 4vw, 32px) 16px', textAlign: 'center' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>🦊</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#fff' }}>Alfanumrik</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Adaptive Learning OS</span>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, marginBottom: 8 }}>
              A product of Cusiosense Learning India Private Limited
            </p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
              Startup India Recognized | ISO 27001, 42001, 42005 & PCI-DSS Certified
              <br/>Alfanumrik and Alfanumrik Adaptive Learning OS are registered trademarks of Cusiosense Learning India Private Limited.
              <br/>{'\u00A9'} {new Date().getFullYear()} Cusiosense Learning India Private Limited. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    );
  }

    /* ════ STEP 2: ROLE SELECTION ════ */
  if (step === 'role') {
    const roles: Array<{id:Role;icon:string;title:string;hi:string;desc:string;color:string}> = [
      { id:'student', icon:'🎓', title:'Student', hi:'छात्र', desc:'Learn with Foxy AI, take quizzes, track your mastery.', color:P.rose },
      { id:'teacher', icon:'👩‍🏫', title:'Teacher', hi:'शिक्षक', desc:'Create classes, assign work, view mastery reports.', color:P.teal },
      { id:'guardian', icon:'👨‍👩‍👧', title:'Parent / Guardian', hi:'अभिभावक', desc:'Monitor progress, get daily learning updates.', color:P.green },
    ];
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <div style={{ maxWidth: 440, width: '100%' }} className="animate-slide-up">
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <span style={{ fontSize: 48 }}>🦊</span>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: P.navy, marginTop: 10 }}>Welcome to Alfanumrik</h1>
            <p style={{ fontSize: 14, color: P.text3, marginTop: 6 }}>I am…</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roles.map(r => (
              <button key={r.id} onClick={() => { setRole(r.id); setStep('auth'); }} style={{ display:'flex', alignItems:'center', gap:14, padding:'20px 24px', borderRadius:14, cursor:'pointer', border:`1.5px solid ${role===r.id?r.color:'rgba(0,0,0,0.08)'}`, background:role===r.id?`${r.color}08`:'#fff', transition:'all 0.3s', textAlign:'left', width:'100%' }}>
                <div style={{ width:52, height:52, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, background:`${r.color}10`, flexShrink:0 }}>{r.icon}</div>
                <div>
                  <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, color:P.text1 }}>{r.title} <span style={{ fontSize:12, color:P.text3, fontWeight:400 }}>({r.hi})</span></div>
                  <p style={{ fontSize:12, color:P.text2, lineHeight:1.5, marginTop:3 }}>{r.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => setStep('landing')} style={{ display:'block', width:'100%', textAlign:'center', marginTop:20, fontSize:13, color:P.text3, background:'transparent', border:'none', cursor:'pointer' }}>← Back to home</button>
        </div>
      </div>
    );
  }

  /* ════ STEP 3: AUTH ════ */
  if (step === 'auth') {
    const rl = role==='student'?'🎓 Student':role==='teacher'?'👩‍🏫 Teacher':'👨‍👩‍👧 Parent';
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <Card className="w-full max-w-sm animate-slide-up !p-8">
          <button onClick={() => setStep('role')} style={{ color:'var(--text-3)', fontSize:13, background:'none', border:'none', cursor:'pointer', marginBottom:20 }}>&larr; Change role</button>
          <div style={{ textAlign:'center', marginBottom:20 }}>
            <div style={{ fontSize:40, marginBottom:8 }}>🦊</div>
            <h2 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:22 }}>
              {authMode==='signup'?`Sign Up as ${rl}`:authMode==='login'?'Welcome Back!':authMode==='forgot'?'Reset Password':'Quick Login'}
            </h2>
            <p style={{ fontSize:13, color:'var(--text-3)', marginTop:4 }}>
              {authMode==='signup'?'Create your account to start learning':authMode==='login'?'Sign in with your email & password':authMode==='forgot'?'We will send a reset link to your email':'Get a 6-digit code on your email'}
            </p>
          </div>

          {/* Auth mode tabs */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:3, background:'var(--surface-2)', borderRadius:12, padding:3, marginBottom:16 }}>
            {([['signup','Sign Up'],['login','Log In'],['otp','OTP']] as const).map(([m,l])=>(
              <button key={m} onClick={()=>{setAuthMode(m);setError('');setOtpSent(false);setResetSent(false);}} style={{ padding:'8px 0', borderRadius:10, border:'none', cursor:'pointer', fontWeight:600, fontSize:12, background:authMode===m||authMode==='forgot'&&m==='login'?'var(--surface-1)':'transparent', color:authMode===m||authMode==='forgot'&&m==='login'?'var(--text-1)':'var(--text-3)', boxShadow:authMode===m?'0 1px 4px rgba(0,0,0,0.08)':'none' }}>{l}</button>
            ))}
          </div>

          {/* ─── SIGN UP WITH PASSWORD ─── */}
          {authMode==='signup'&&!otpSent&&(<>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <Input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>
              <div style={{ position:'relative' }}>
                <Input type={showPassword?'text':'password'} placeholder="Create password (min 6 chars)" value={password} onChange={e=>setPassword(e.target.value)}/>
                <button onClick={()=>setShowPassword(!showPassword)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'var(--text-3)' }}>{showPassword?'🙈':'👁️'}</button>
              </div>
              <Input type={showPassword?'text':'password'} placeholder="Confirm password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&signUpWithPassword()}/>
              {error&&<p style={{ color:'var(--red)', fontSize:13 }}>{error}</p>}
              <Button fullWidth onClick={signUpWithPassword} disabled={loading||!email.trim()||!password||!confirmPassword}>{loading?'Creating account...':'Create Account →'}</Button>
              <p style={{ fontSize:12, color:'var(--text-3)', textAlign:'center' }}>Already have an account? <button onClick={()=>{setAuthMode('login');setError('');}} style={{ color:'var(--orange)', fontWeight:700, background:'none', border:'none', cursor:'pointer' }}>Log In</button></p>
            </div>
          </>)}

          {/* Sign up confirmation message */}
          {authMode==='signup'&&otpSent&&(<>
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📧</div>
              <h3 style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:18, marginBottom:8 }}>Check Your Email!</h3>
              <p style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.6, marginBottom:16 }}>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.</p>
              <p style={{ fontSize:12, color:'var(--text-3)', lineHeight:1.6 }}>After confirming, come back here and Log In with your password.</p>
              <Button variant="ghost" fullWidth onClick={()=>{setAuthMode('login');setOtpSent(false);setError('');}} className="mt-4">Go to Log In →</Button>
            </div>
          </>)}

          {/* ─── LOG IN WITH PASSWORD ─── */}
          {authMode==='login'&&(<>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <Input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>
              <div style={{ position:'relative' }}>
                <Input type={showPassword?'text':'password'} placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&signInWithPassword()}/>
                <button onClick={()=>setShowPassword(!showPassword)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'var(--text-3)' }}>{showPassword?'🙈':'👁️'}</button>
              </div>
              {error&&<p style={{ color:'var(--red)', fontSize:13 }}>{error}</p>}
              <Button fullWidth onClick={signInWithPassword} disabled={loading||!email.trim()||!password}>{loading?'Signing in...':'Log In →'}</Button>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <button onClick={()=>{setAuthMode('forgot');setError('');setResetSent(false);}} style={{ fontSize:12, color:'var(--orange)', fontWeight:600, background:'none', border:'none', cursor:'pointer' }}>Forgot Password?</button>
                <button onClick={()=>{setAuthMode('signup');setError('');}} style={{ fontSize:12, color:'var(--text-3)', background:'none', border:'none', cursor:'pointer' }}>Create Account</button>
              </div>
            </div>
          </>)}

          {/* ─── FORGOT PASSWORD ─── */}
          {authMode==='forgot'&&!resetSent&&(<>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <Input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendResetEmail()}/>
              {error&&<p style={{ color:'var(--red)', fontSize:13 }}>{error}</p>}
              <Button fullWidth onClick={sendResetEmail} disabled={loading||!email.trim()}>{loading?'Sending...':'Send Reset Link →'}</Button>
              <button onClick={()=>{setAuthMode('login');setError('');}} style={{ fontSize:12, color:'var(--text-3)', background:'none', border:'none', cursor:'pointer', textAlign:'center', width:'100%' }}>&larr; Back to Log In</button>
            </div>
          </>)}
          {authMode==='forgot'&&resetSent&&(<>
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📧</div>
              <h3 style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:18, marginBottom:8 }}>Reset Link Sent!</h3>
              <p style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.6, marginBottom:16 }}>Check <strong>{email}</strong> for a password reset link. Click it to set a new password.</p>
              <Button variant="ghost" fullWidth onClick={()=>{setAuthMode('login');setResetSent(false);setError('');}} className="mt-2">Back to Log In</Button>
            </div>
          </>)}

          {/* ─── OTP (PASSWORDLESS) ─── */}
          {authMode==='otp'&&(<>
            {otpSent?(<>
              <p style={{ fontSize:13, color:'var(--text-2)', textAlign:'center', marginBottom:12 }}>OTP sent to <strong>{email}</strong></p>
              <Input className="text-center" type="text" placeholder="000000" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} onKeyDown={e=>e.key==='Enter'&&verifyOtp()}/>
              {error&&<p style={{ color:'var(--red)', fontSize:13, marginTop:8 }}>{error}</p>}
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
                <Button fullWidth onClick={verifyOtp} disabled={loading||otp.length<6}>{loading?'Verifying...':'Verify OTP →'}</Button>
                <Button variant="ghost" fullWidth onClick={()=>{setOtpSent(false);setOtp('');setError('');}}>Change email</Button>
              </div>
            </>):(<>
              <Input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendOtp()}/>
              {error&&<p style={{ color:'var(--red)', fontSize:13, marginTop:8 }}>{error}</p>}
              <Button fullWidth onClick={sendOtp} disabled={loading||!email.trim()} className="mt-3">{loading?'Sending...':'Send OTP →'}</Button>
            </>)}
          </>)}
        </Card>
      </div>
    );
  }

  /* ════ STEP 4: PROFILE ════ */
  if (step === 'profile') return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
      <Card className={`w-full animate-slide-up !p-8 ${role==='teacher'?'max-w-lg':'max-w-sm'}`}>
        {/* Role picker header */}
        <div style={{ textAlign:'center', marginBottom:16 }}>
          <div style={{ fontSize:40, marginBottom:6 }}>{role==='student'?'🎓':role==='teacher'?'👩‍🏫':'👨‍👩‍👧'}</div>
          <h2 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:22 }}>
            {role==='student'?'Student Profile':role==='teacher'?'Teacher Profile':'Parent Profile'}
          </h2>
          <p style={{ fontSize:13, color:'var(--text-3)', marginTop:4 }}>
            {role==='student'?'Tell us about yourself so Foxy can personalise your learning':role==='teacher'?'Set up your teaching profile':'Connect with your child\'s learning'}
          </p>
        </div>
        {/* Quick role switch */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, marginBottom:16, background:'var(--surface-2)', borderRadius:12, padding:3 }}>
          {([['student','🎓 Student'],['teacher','👩‍🏫 Teacher'],['guardian','👨‍👩‍👧 Parent']] as [Role, string][]).map(([r,l])=>(
            <button key={r} onClick={()=>setRole(r)} style={{ padding:'8px 0', borderRadius:10, border:'none', cursor:'pointer', fontWeight:600, fontSize:11, background:role===r?'var(--surface-1)':'transparent', color:role===r?'var(--text-1)':'var(--text-3)', boxShadow:role===r?'0 1px 4px rgba(0,0,0,0.08)':'none' }}>{l}</button>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Input placeholder="Full name" value={name} onChange={e=>setName(e.target.value)}/>
          {role==='student'&&(<>
            <Select value={grade} onChange={setGrade} options={GRADES.map(g=>({value:g,label:`Grade ${g}`}))}/>
            <Select value={board} onChange={setBoard} options={BOARDS.map(b=>({value:b,label:b}))}/>
            <div><p style={{ fontSize:11, color:'var(--text-3)', marginBottom:6, fontWeight:600 }}>Language</p>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                {LANGUAGES.slice(0,6).map(l=><button key={l.code} onClick={()=>setLang(l.code)} style={{ padding:'8px 4px', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', background:lang===l.code?`${P.rose}15`:'var(--surface-2)', border:`1.5px solid ${lang===l.code?P.rose:'var(--border)'}`, color:lang===l.code?P.rose:'var(--text-2)' }}>{l.labelNative}</button>)}
              </div></div>
            <Input placeholder="Parent/Guardian phone (optional)" type="tel" value={parentPhone} onChange={e=>setParentPhone(e.target.value)}/>
          </>)}
          {role==='teacher'&&(<>
            <Input placeholder="School name" value={schoolName} onChange={e=>setSchoolName(e.target.value)}/>
            <Input placeholder="Qualification (B.Ed, M.Sc)" value={qualification} onChange={e=>setQualification(e.target.value)}/>
            <Select value={board} onChange={setBoard} options={BOARDS.map(b=>({value:b,label:b}))}/>
            <div><p style={{ fontSize:11, color:'var(--text-3)', marginBottom:6, fontWeight:600 }}>Subjects</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {SUBJECT_META.slice(0,8).map(s=><button key={s.code} onClick={()=>tog(subjectsTaught,s.code,setSubjectsTaught)} style={{ padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:subjectsTaught.includes(s.code)?`${s.color}15`:'var(--surface-2)', border:`1.5px solid ${subjectsTaught.includes(s.code)?s.color:'var(--border)'}`, color:subjectsTaught.includes(s.code)?s.color:'var(--text-3)' }}>{s.icon} {s.name}</button>)}
              </div></div>
            <div><p style={{ fontSize:11, color:'var(--text-3)', marginBottom:6, fontWeight:600 }}>Grades</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {GRADES.map(g=><button key={g} onClick={()=>tog(gradesTaught,g,setGradesTaught)} style={{ width:40, height:40, borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', background:gradesTaught.includes(g)?`${P.teal}15`:'var(--surface-2)', border:`1.5px solid ${gradesTaught.includes(g)?P.teal:'var(--border)'}`, color:gradesTaught.includes(g)?P.teal:'var(--text-3)' }}>{g}</button>)}
              </div></div>
          </>)}
          {role==='guardian'&&(<>
            <Select value={relationship} onChange={setRelationship} options={[{value:'parent',label:'Parent'},{value:'guardian',label:'Guardian'},{value:'sibling',label:'Older Sibling'},{value:'tutor',label:'Private Tutor'}]}/>
            <div><p style={{ fontSize:11, color:'var(--text-3)', marginBottom:6, fontWeight:600 }}>Language</p>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                {LANGUAGES.slice(0,3).map(l=><button key={l.code} onClick={()=>setLang(l.code)} style={{ padding:'8px 4px', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', background:lang===l.code?`${P.green}15`:'var(--surface-2)', border:`1.5px solid ${lang===l.code?P.green:'var(--border)'}`, color:lang===l.code?P.green:'var(--text-2)' }}>{l.labelNative}</button>)}
              </div></div>
            <div style={{ padding:16, borderRadius:12, background:`${P.green}08`, border:`1px solid ${P.green}20` }}>
              <p style={{ fontSize:12, color:'var(--text-2)', lineHeight:1.6, marginBottom:10 }}><strong>Link your child&apos;s account</strong> — enter their invite code (found in child&apos;s Profile page)</p>
              <Input placeholder="Child's Invite Code (e.g. A1B2C3D4)" value={childInviteCode} onChange={e=>setChildInviteCode(e.target.value.toUpperCase())}/>
            </div>
          </>)}
          <Button fullWidth onClick={saveProfile} disabled={saving||!name.trim()} className="mt-1">{saving?'Saving…':role==='student'?'Continue →':'Complete Setup →'}</Button>
        </div>
      </Card>
    </div>
  );

  /* ════ STEP 5: SUBJECT ════ */
  if (step === 'subject') {
    const av = SUBJECT_META.filter(s=>parseInt(grade)<=10?['math','science','english','hindi','social_studies','coding'].includes(s.code):true);
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <Card className="w-full max-w-md animate-slide-up !p-8">
          <div style={{ textAlign:'center', marginBottom:20 }}>
            <div style={{ fontSize:40, marginBottom:6 }}>📚</div>
            <h2 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:22 }}>Pick your subjects</h2>
            <p style={{ fontSize:13, color:'var(--text-3)', marginTop:4 }}>Select all the subjects you want to study</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:20 }}>
            {av.map(s=><button key={s.code} onClick={()=>setSelectedSubs(p=>p.includes(s.code)?p.filter(x=>x!==s.code):[...p,s.code])} style={{ padding:16, borderRadius:14, textAlign:'left', cursor:'pointer', background:selectedSubs.includes(s.code)?`${s.color}12`:'var(--surface-2)', border:`1.5px solid ${selectedSubs.includes(s.code)?s.color:'var(--border)'}` }}>
              <div style={{ fontSize:24, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color:subject===s.code?s.color:'var(--text-1)' }}>{s.name}</div>
            </button>)}
          </div>
          <Button fullWidth onClick={saveSubject} disabled={saving||selectedSubs.length===0}>{saving?'Setting up…':'Start Learning 🚀'}</Button>
        </Card>
      </div>
    );
  }
  return null;
}
