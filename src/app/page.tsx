'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES, SUBJECT_META } from '@/lib/constants';
import { Button, Input, Select, Card, LoadingFoxy } from '@/components/ui';

type Role = 'student' | 'teacher' | 'guardian';
type Step = 'landing' | 'role' | 'auth' | 'profile' | 'subject';

/* ═══ PowerSchool-mapped color tokens ═══ */
const P = {
  navy: '#1A365D',      // PS #00427C → Alfanumrik deep navy
  rose: '#E8581C',      // PS #DE4278 → Alfanumrik orange (brand)
  teal: '#0891B2',
  green: '#16A34A',
  purple: '#7C3AED',
  gold: '#F5A623',
  lightBg: '#F5F0EA',   // PS #EBF2F5 → warm cream
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
  const [schoolName, setSchoolName] = useState('');
  const [subjectsTaught, setSubjectsTaught] = useState<string[]>(['math']);
  const [gradesTaught, setGradesTaught] = useState<string[]>(['9']);
  const [qualification, setQualification] = useState('');
  const [relationship, setRelationship] = useState('parent');
  const [parentPhone, setParentPhone] = useState('');
  const [childInviteCode, setChildInviteCode] = useState('');
  const [linkResult, setLinkResult] = useState<string | null>(null);

  // Handle logged-in users: check onboarding status
  useEffect(() => {
    if (isLoading) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Not authenticated at all
      // Check if any role has completed onboarding
      const { data: stu } = await supabase.from('students').select('onboarding_completed').eq('auth_user_id', user.id).single();
      if (stu?.onboarding_completed) { router.replace('/dashboard'); return; }
      const { data: tch } = await supabase.from('teachers').select('onboarding_completed').eq('auth_user_id', user.id).single();
      if (tch?.onboarding_completed) { router.replace('/dashboard'); return; }
      const { data: gdn } = await supabase.from('guardians').select('onboarding_completed').eq('auth_user_id', user.id).single();
      if (gdn?.onboarding_completed) { router.replace('/dashboard'); return; }
      // User has auth session but hasn't completed onboarding — show profile form
      setStep('profile');
    })();
  }, [isLoading, router]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (ev, sess) => {
      if ((ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') && sess?.user) {
        await refreshStudent();
        // Check if user has completed onboarding in any role
        const { data: stu } = await supabase.from('students').select('onboarding_completed').eq('auth_user_id', sess.user.id).single();
        if (stu?.onboarding_completed) { router.replace('/dashboard'); return; }
        const { data: tch } = await supabase.from('teachers').select('onboarding_completed').eq('auth_user_id', sess.user.id).single();
        if (tch?.onboarding_completed) { router.replace('/dashboard'); return; }
        const { data: gdn } = await supabase.from('guardians').select('onboarding_completed').eq('auth_user_id', sess.user.id).single();
        if (gdn?.onboarding_completed) { router.replace('/dashboard'); return; }
        // No onboarding completed — go to profile setup
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
    await supabase.from('students').update({ preferred_subject: subject, onboarding_completed: true }).eq('auth_user_id', user.id);
    await refreshStudent(); router.replace('/dashboard'); setSaving(false);
  };
  const tog = (a: string[], i: string, s: (v: string[]) => void) => s(a.includes(i)?a.filter(x=>x!==i):[...a,i]);

  if (isLoading) return <LoadingFoxy />;

  /* ════════════════════════════════════════════════════════
     LANDING — PowerSchool clone layout
  ════════════════════════════════════════════════════════ */
  if (step === 'landing') {
    const spotlights = [
      { name: 'Priya Sharma', title: 'Science Teacher, Delhi Public School', quote: 'Foxy AI has changed how my students approach revision. The spaced repetition means they actually remember what they learned last month. My weakest students improved the most.', cta: 'Read Priya\'s Story' },
      { name: 'Rajesh Kumar', title: 'Parent of Grade 8 Student, Jaipur', quote: 'I finally know exactly what my son is learning and where he struggles. The daily digest is a game-changer — I don\'t need to ask him anymore.', cta: 'See Parent Experience' },
      { name: 'Ananya Reddy', title: 'Grade 10 Student, Hyderabad', quote: 'Foxy explains things the way my brain works. When I don\'t understand something, I just ask in Hindi and it breaks it down step by step. My board exam prep is way better now.', cta: 'Watch Ananya\'s Story' },
    ];
    const solutions = [
      { icon: '🧠', label: 'Adaptive Mastery Tracking', color: P.rose },
      { icon: '🦊', label: 'AI Tutor (Foxy)', color: P.teal },
      { icon: '📊', label: 'Teacher Dashboard', color: P.navy },
      { icon: '👨‍👩‍👧', label: 'Parent Reports', color: P.green },
      { icon: '🔄', label: 'Spaced Repetition', color: P.purple },
      { icon: '🏆', label: 'Gamified Learning', color: P.gold },
      { icon: '🔐', label: 'Role-Based Access', color: '#DC2626' },
    ];
    const rbac = [
      { icon: '👑', role: 'Super Admin', color: P.rose, can: ['All schools & users', 'Edit & delete anything', 'Assign roles', 'Billing & plans', 'Feature flags'], deny: ['No restrictions'] },
      { icon: '👩‍🏫', role: 'Teacher', color: P.teal, can: ['Create classes', 'Assign content', 'View class mastery', 'Grade work', 'Curriculum tools'], deny: ['Other schools', 'Billing', 'Role mgmt'] },
      { icon: '👨‍👩‍👧', role: 'Parent', color: P.green, can: ['Child progress', 'Activity reports', 'Score alerts', 'Foxy settings', 'Daily digests'], deny: ['Academic edits', 'Other children', 'Teacher tools'] },
      { icon: '🎓', role: 'Student', color: P.purple, can: ['Foxy AI tutor', 'Quizzes', 'Own progress', 'Leaderboard', 'Reviews', 'Join classes'], deny: ['Admin panel', 'Other students', 'Class settings'] },
    ];

    return (
      <div style={{ background: '#fff', fontFamily: 'var(--font-body)' }}>
        {/* ════ NAV — PowerSchool white sticky ════ */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', height: 72 }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 30px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 30 }}>🦊</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: P.navy }}>Alfanumrik</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('solutions')?.scrollIntoView({ behavior: 'smooth' })}>Solutions</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('rbac-section')?.scrollIntoView({ behavior: 'smooth' })}>RBAC</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: P.text2, cursor: 'pointer' }} onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>Features</span>
              <button onClick={() => {setAuthMode('login');setStep('auth');}} style={{ padding: '8px 20px', borderRadius: 6, border: `1.5px solid ${P.navy}`, background: 'transparent', color: P.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-display)' }}>Log In</button>
              <button onClick={() => setStep('role')} style={{ padding: '10px 24px', borderRadius: 6, border: 'none', background: P.rose, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-display)' }}>Get Started Free</button>
            </div>
          </div>
        </nav>

        {/* ════ HERO — Full-bleed dark with gradient ════ */}
        <section style={{ background: `linear-gradient(135deg, ${P.navy} 0%, #0F2942 60%, #1A365D 100%)`, padding: 'clamp(60px, 10vw, 120px) 30px 100px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(232,88,28,0.08) 0%, transparent 60%)', pointerEvents: 'none' }} />
          <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative', zIndex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(32px, 5.5vw, 56px)', lineHeight: 1.15, color: '#fff', marginBottom: 20 }}>
              Power What&apos;s Possible<br />in Indian Education
            </h1>
            <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: 'rgba(255,255,255,0.7)', lineHeight: 1.65, maxWidth: 600, margin: '0 auto 36px' }}>
              Transforming how schools advance learning through adaptive AI, 
              Bayesian mastery tracking, and connected technology for every stakeholder.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              <button onClick={() => setStep('role')} style={{ padding: '14px 36px', borderRadius: 6, border: 'none', background: P.rose, color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, cursor: 'pointer', transition: 'all 0.2s' }}>
                Explore Our Solutions
              </button>
              <button onClick={() => document.getElementById('rbac-section')?.scrollIntoView({ behavior: 'smooth' })} style={{ padding: '14px 36px', borderRadius: 6, border: '1.5px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                How It Works
              </button>
            </div>
          </div>
        </section>

        {/* ════ FEATURED CARDS — Floating overlap (PS pattern) ════ */}
        <section style={{ maxWidth: 1000, margin: '-60px auto 0', padding: '0 30px', position: 'relative', zIndex: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {[
              { tag: 'CBSE ALIGNED', title: 'Khan Academy India NCERT Chapters', desc: '726 chapters across 16 subjects, grades 6-12. Mapped to competency frameworks.', cta: 'Explore Curriculum' },
              { tag: 'AI POWERED', title: 'Meet Foxy, Your AI Tutor', desc: 'Socratic tutoring in Hindi & English. Adaptive difficulty. 4 learning modes.', cta: 'Try Foxy Free' },
              { tag: 'FOR SCHOOLS', title: 'Teacher & Parent Dashboards', desc: 'Role-based access. Class management. Mastery reports. Daily parent digests.', cta: 'See Dashboards' },
            ].map((c, i) => (
              <div key={i} onClick={() => setStep('role')} style={{ background: '#fff', borderRadius: 12, padding: '28px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'all 0.3s', border: '1px solid rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: P.rose, marginBottom: 8 }}>{c.tag}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: P.navy, marginBottom: 8, lineHeight: 1.3 }}>{c.title}</h3>
                <p style={{ fontSize: 13, color: P.text2, lineHeight: 1.6, marginBottom: 16 }}>{c.desc}</p>
                <span style={{ fontSize: 13, fontWeight: 700, color: P.rose }}>{c.cta} →</span>
              </div>
            ))}
          </div>
        </section>

        {/* ════ TRUST — "Making an Impact" ════ */}
        <section style={{ padding: '80px 30px 40px', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 36px)', color: P.navy, marginBottom: 40 }}>
            Making an Impact in Indian Schools
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 20, maxWidth: 900, margin: '0 auto' }}>
            {SUBJECT_META.slice(0, 8).map(s => (
              <div key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: P.lightBg, fontSize: 13, fontWeight: 600, color: P.text2 }}>
                <span>{s.icon}</span> {s.name}
              </div>
            ))}
            <div style={{ padding: '8px 16px', borderRadius: 8, background: P.lightBg, fontSize: 13, fontWeight: 600, color: P.text3 }}>+8 more subjects</div>
          </div>
        </section>

        {/* ════ TESTIMONIAL CAROUSEL (PS Spotlights) ════ */}
        <section style={{ background: P.lightBg, padding: '64px 30px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 2, color: P.text3, marginBottom: 24, textAlign: 'center' }}>Educator Spotlights</h2>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
              {spotlights.map((_, i) => (
                <button key={i} onClick={() => setActiveSpotlight(i)} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${i === activeSpotlight ? P.rose : P.border}`, background: i === activeSpotlight ? `${P.rose}0D` : '#fff', fontSize: 12, fontWeight: 600, color: i === activeSpotlight ? P.rose : P.text2, cursor: 'pointer' }}>
                  {spotlights[i].name.split(' ')[0]}
                </button>
              ))}
            </div>
            <div style={{ maxWidth: 700, margin: '0 auto', background: '#fff', borderRadius: 16, padding: 'clamp(24px, 4vw, 48px)', boxShadow: '0 4px 24px rgba(0,0,0,0.04)', borderLeft: `4px solid ${P.rose}` }}>
              <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: P.text1, lineHeight: 1.7, fontStyle: 'italic', marginBottom: 20 }}>
                &ldquo;{spotlights[activeSpotlight].quote}&rdquo;
              </p>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: P.navy }}>{spotlights[activeSpotlight].name}</div>
                <div style={{ fontSize: 13, color: P.text3 }}>{spotlights[activeSpotlight].title}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ════ SOLUTIONS PILLS (PS "Which Solution...") ════ */}
        <section id="solutions" style={{ padding: '80px 30px', textAlign: 'center' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 36px)', color: P.navy, marginBottom: 12 }}>
              Which Alfanumrik Solution Supports Your Priorities?
            </h2>
            <p style={{ fontSize: 15, color: P.text2, lineHeight: 1.65, maxWidth: 540, margin: '0 auto 40px' }}>
              One platform with adaptive AI, mastery tracking, and role-based access for every stakeholder.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {solutions.map(s => (
                <button key={s.label} onClick={() => setStep('role')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 24px', borderRadius: 10, border: `1.5px solid ${s.color}20`, background: `${s.color}08`, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: s.color, cursor: 'pointer', transition: 'all 0.2s' }}>
                  <span style={{ fontSize: 18 }}>{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ════ RBAC SECTION ════ */}
        <section id="rbac-section" style={{ background: P.navy, padding: '80px 30px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 36px)', color: '#fff', marginBottom: 12 }}>
                Role-Based Access Control
              </h2>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', maxWidth: 500, margin: '0 auto', lineHeight: 1.65 }}>
                Same system. Different access. Every user sees exactly what they need — enforced at the database layer by Supabase RLS.
              </p>
            </div>

            {/* Hierarchy */}
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <svg viewBox="0 0 680 120" width="100%" style={{ maxWidth: 600, display: 'block', margin: '0 auto' }}>
                <rect x="260" y="4" width="160" height="36" rx="6" fill="none" stroke={P.rose} strokeWidth="1.5"/>
                <text x="340" y="27" textAnchor="middle" fontFamily="Sora,sans-serif" fontSize="12" fontWeight="700" fill={P.rose}>👑 Super Admin</text>
                <line x1="300" y1="40" x2="120" y2="76" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 3"/>
                <line x1="340" y1="40" x2="340" y2="76" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 3"/>
                <line x1="380" y1="40" x2="560" y2="76" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 3"/>
                <rect x="40" y="78" width="160" height="36" rx="6" fill="none" stroke={P.teal} strokeWidth="1.5"/>
                <text x="120" y="101" textAnchor="middle" fontFamily="Sora,sans-serif" fontSize="12" fontWeight="700" fill={P.teal}>👩‍🏫 Teacher</text>
                <rect x="260" y="78" width="160" height="36" rx="6" fill="none" stroke={P.green} strokeWidth="1.5"/>
                <text x="340" y="101" textAnchor="middle" fontFamily="Sora,sans-serif" fontSize="12" fontWeight="700" fill={P.green}>👨‍👩‍👧 Parent</text>
                <rect x="480" y="78" width="160" height="36" rx="6" fill="none" stroke={P.purple} strokeWidth="1.5"/>
                <text x="560" y="101" textAnchor="middle" fontFamily="Sora,sans-serif" fontSize="12" fontWeight="700" fill={P.purple}>🎓 Student</text>
              </svg>
            </div>

            {/* Permission cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {rbac.map(r => (
                <div key={r.role} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, boxShadow: `0 0 8px ${r.color}60` }} />
                    <span style={{ fontSize: 20 }}>{r.icon}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: r.color }}>{r.role}</span>
                  </div>
                  <div style={{ padding: '14px 20px' }}>
                    {r.can.map(c => (
                      <div key={c} style={{ padding: '3px 0', fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.4 }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: `${r.color}20`, color: r.color }}>✓</span>{c}
                      </div>
                    ))}
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.12)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', letterSpacing: 1, marginBottom: 2 }}>CANNOT ACCESS</div>
                      {r.deny.map(d => (<div key={d} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>✕ {d}</div>))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ FEATURES (PS "Which Solution" grid) ════ */}
        <section id="features" style={{ padding: '80px 30px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <h2 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(24px, 3.5vw, 36px)', color: P.navy, marginBottom: 12 }}>
              Features That Level Up Your School
            </h2>
            <p style={{ textAlign: 'center', fontSize: 15, color: P.text2, lineHeight: 1.65, maxWidth: 500, margin: '0 auto 48px' }}>
              Evidence-backed learning science meets production-grade AI. One platform, one login.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {[
                { icon: '🧠', t: 'Bayesian Knowledge Tracing', d: 'AI tracks what each student knows. Practice targets gaps — zero time wasted.', bg: `${P.rose}0A` },
                { icon: '🔄', t: 'Spaced Repetition (SM-2)', d: 'Reviews at the optimal moment. Proven 0.54 SD effect size across studies.', bg: `${P.teal}0A` },
                { icon: '🦊', t: 'Foxy AI Tutor', d: 'Socratic tutoring in Hindi/English. NCERT-aligned, adaptive, 4 learning modes.', bg: `${P.gold}15` },
                { icon: '📊', t: 'Teacher Dashboard', d: 'Create classes, assign work, view mastery heatmaps, grade submissions.', bg: `${P.navy}0A` },
                { icon: '👨‍👩‍👧', t: 'Parent Monitoring', d: 'Daily digests, activity tracking, assignment scores, streak alerts.', bg: `${P.green}0A` },
                { icon: '🏆', t: 'Gamified Learning', d: 'XP, streaks, leaderboards, 14 badges. Strategic bursts backed by evidence.', bg: `${P.purple}0A` },
              ].map(f => (
                <div key={f.t} style={{ padding: '28px 24px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', transition: 'all 0.3s' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 14, background: f.bg }}>{f.icon}</div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: P.navy, marginBottom: 6 }}>{f.t}</h3>
                  <p style={{ fontSize: 13, color: P.text2, lineHeight: 1.65 }}>{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ SECURITY & TRUST (PS pattern) ════ */}
        <section style={{ background: P.lightBg, padding: '64px 30px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3vw, 30px)', color: P.navy, marginBottom: 12 }}>
              Our Commitment to Security
            </h2>
            <p style={{ fontSize: 14, color: P.text2, lineHeight: 1.65, maxWidth: 500, margin: '0 auto 32px' }}>
              Student, family, and educator data is protected by enterprise-grade security at every layer.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24 }}>
              {[
                { badge: '🔐', label: 'Supabase RLS' },
                { badge: '🛡️', label: 'Row-Level Policies' },
                { badge: '🇮🇳', label: 'CBSE Compliant' },
                { badge: '📋', label: 'NEP 2020 Aligned' },
              ].map(b => (
                <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{b.badge}</div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: P.text2 }}>{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ STATS (PS "Connecting..." counters) ════ */}
        <section style={{ background: P.navy, padding: '64px 30px', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(18px, 2.5vw, 24px)', color: 'rgba(255,255,255,0.8)', marginBottom: 40 }}>
            Connecting the Classroom to the Home — Across India
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, maxWidth: 800, margin: '0 auto' }}>
            {[['726','NCERT Chapters'],['16','Subjects'],['7','Grades (6–12)'],['6+','Languages']].map(([v, l]) => (
              <div key={l}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(28px, 4vw, 44px)', color: P.rose }}>{v}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ════ CTA (PS bottom bar) ════ */}
        <section style={{ padding: '80px 30px', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', color: P.navy, marginBottom: 12 }}>
              Let&apos;s Connect!
            </h2>
            <p style={{ fontSize: 15, color: P.text2, lineHeight: 1.65, marginBottom: 32 }}>
              Whether you&apos;re a student, teacher, or parent — start your free trial in 60 seconds.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, maxWidth: 520, margin: '0 auto' }}>
              {[
                { icon: '🎓', label: 'I\'m a Student', r: 'student' as Role },
                { icon: '👩‍🏫', label: 'I\'m a Teacher', r: 'teacher' as Role },
                { icon: '👨‍👩‍👧', label: 'I\'m a Parent', r: 'guardian' as Role },
              ].map(c => (
                <button key={c.label} onClick={() => { setRole(c.r); setStep('role'); }} style={{ padding: '20px 16px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: P.navy }}>{c.label}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ════ FOOTER ════ */}
        <footer style={{ background: P.navy, padding: '24px 30px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Alfanumrik Learning OS v2.0 · Built with ❤️ in India · © 2026 Alfanumrik
          </p>
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
            <h2 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:22 }}>Pick your main subject</h2>
            <p style={{ fontSize:13, color:'var(--text-3)', marginTop:4 }}>You can study all — this is your home base</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:20 }}>
            {av.map(s=><button key={s.code} onClick={()=>setSubject(s.code)} style={{ padding:16, borderRadius:14, textAlign:'left', cursor:'pointer', background:subject===s.code?`${s.color}12`:'var(--surface-2)', border:`1.5px solid ${subject===s.code?s.color:'var(--border)'}` }}>
              <div style={{ fontSize:24, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color:subject===s.code?s.color:'var(--text-1)' }}>{s.name}</div>
            </button>)}
          </div>
          <Button fullWidth onClick={saveSubject} disabled={saving}>{saving?'Setting up…':'Start Learning 🚀'}</Button>
        </Card>
      </div>
    );
  }
  return null;
}
