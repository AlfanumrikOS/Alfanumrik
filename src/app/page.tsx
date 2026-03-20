'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { GRADES, BOARDS, LANGUAGES, SUBJECT_META } from '@/lib/constants';
import { Button, Input, Select, Card, LoadingFoxy } from '@/components/ui';

type Role = 'student' | 'teacher' | 'guardian';
type Step = 'landing' | 'role' | 'auth' | 'profile' | 'subject';

export default function Home() {
  const { isLoggedIn, isLoading, refreshStudent } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('landing');
  const [role, setRole] = useState<Role>('student');

  /* Auth state */
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /* Student profile */
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE');
  const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('math');
  const [saving, setSaving] = useState(false);

  /* Teacher profile */
  const [schoolName, setSchoolName] = useState('');
  const [subjectsTaught, setSubjectsTaught] = useState<string[]>(['math']);
  const [gradesTaught, setGradesTaught] = useState<string[]>(['9']);
  const [qualification, setQualification] = useState('');

  /* Parent profile */
  const [relationship, setRelationship] = useState('parent');
  const [childCode, setChildCode] = useState('');

  useEffect(() => {
    if (!isLoading && isLoggedIn) router.replace('/dashboard');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await refreshStudent();
        // Check if onboarding is done
        const { data } = await supabase.from('students').select('onboarding_completed').eq('auth_user_id', session.user.id).single();
        if (data?.onboarding_completed) {
          router.replace('/dashboard');
        } else {
          setStep('profile');
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [router, refreshStudent]);

  /* ─── Auth handlers ─── */
  const sendOtp = async () => {
    const identifier = authMethod === 'email' ? email.trim() : phone.trim();
    if (!identifier) return;
    setLoading(true);
    setError('');

    if (authMethod === 'email') {
      const { error: e } = await supabase.auth.signInWithOtp({ email: identifier, options: { shouldCreateUser: true } });
      e ? setError(e.message) : setOtpSent(true);
    } else {
      const { error: e } = await supabase.auth.signInWithOtp({ phone: identifier });
      e ? setError(e.message) : setOtpSent(true);
    }
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (!otp.trim()) return;
    setLoading(true);
    setError('');
    const identifier = authMethod === 'email' ? email.trim() : phone.trim();

    if (authMethod === 'email') {
      const { error: e } = await supabase.auth.verifyOtp({ email: identifier, token: otp.trim(), type: 'email' });
      if (e) setError(e.message);
    } else {
      const { error: e } = await supabase.auth.verifyOtp({ phone: identifier, token: otp.trim(), type: 'sms' });
      if (e) setError(e.message);
    }
    setLoading(false);
  };

  /* ─── Save profile by role ─── */
  const saveProfile = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    if (role === 'student') {
      const { data: existing } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      const payload = { name, grade, board, preferred_language: lang, email: user.email, onboarding_completed: false };
      if (existing) {
        await supabase.from('students').update(payload).eq('id', existing.id);
      } else {
        await supabase.from('students').insert({ ...payload, auth_user_id: user.id });
      }
      setStep('subject');
    } else if (role === 'teacher') {
      const { data: existing } = await supabase.from('teachers').select('id').eq('auth_user_id', user.id).single();
      const payload = { name, school_name: schoolName, subjects_taught: subjectsTaught, grades_taught: gradesTaught, board, qualification, preferred_language: lang, email: user.email, is_active: true, onboarding_completed: true };
      if (existing) {
        await supabase.from('teachers').update(payload).eq('id', existing.id);
      } else {
        await supabase.from('teachers').insert({ ...payload, auth_user_id: user.id });
      }
      // Also create a minimal student profile so the teacher can explore the app
      const { data: stu } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      if (!stu) {
        await supabase.from('students').insert({ auth_user_id: user.id, name, grade: gradesTaught[0] || '9', board, preferred_language: lang, email: user.email, onboarding_completed: true });
      }
      await refreshStudent();
      router.replace('/teacher');
    } else {
      // Guardian
      const { data: existing } = await supabase.from('guardians').select('id').eq('auth_user_id', user.id).single();
      const payload = { name, relationship, preferred_language: lang, email: user.email, phone: phone || undefined, onboarding_completed: true };
      if (existing) {
        await supabase.from('guardians').update(payload).eq('id', existing.id);
      } else {
        await supabase.from('guardians').insert({ ...payload, auth_user_id: user.id });
      }
      // Also create a minimal student profile
      const { data: stu } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
      if (!stu) {
        await supabase.from('students').insert({ auth_user_id: user.id, name, grade: '9', board: 'CBSE', preferred_language: lang, email: user.email, onboarding_completed: true });
      }
      await refreshStudent();
      router.replace('/parent');
    }
    setSaving(false);
  };

  const saveSubject = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    await supabase.from('students').update({ preferred_subject: subject, onboarding_completed: true }).eq('auth_user_id', user.id);
    await refreshStudent();
    router.replace('/dashboard');
    setSaving(false);
  };

  const toggleArrayItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]);
  };

  if (isLoading) return <LoadingFoxy />;

  /* ═══════════════════════════════════════════════════════════
     STEP 1: LANDING PAGE — Hero + Features + CTA
  ═══════════════════════════════════════════════════════════ */
  if (step === 'landing') {
    return (
      <div className="mesh-bg min-h-dvh">
        {/* ─── Navbar ─── */}
        <nav style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(251,248,244,0.85)', backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🦊</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text-1)' }}>
                Alfanumrik
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep('auth')} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                Log In
              </button>
              <button onClick={() => setStep('role')} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
                Sign Up Free
              </button>
            </div>
          </div>
        </nav>

        {/* ─── Hero Section ─── */}
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 20px 32px', display: 'grid', gridTemplateColumns: '1fr', gap: 40, alignItems: 'center' }}
          className="hero-grid"
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 16px', borderRadius: 100, marginBottom: 20,
              background: 'rgba(232,88,28,0.08)', border: '1px solid rgba(232,88,28,0.2)',
              fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
              color: 'var(--orange)',
            }}>
              🇮🇳 Built for Indian Schools · CBSE / NCERT Aligned
            </div>

            <h1 style={{
              fontFamily: 'var(--font-display)', fontWeight: 800,
              fontSize: 'clamp(32px, 5vw, 56px)', lineHeight: 1.1,
              marginBottom: 16, color: 'var(--text-1)',
            }}>
              Meet <span className="gradient-text">Foxy</span>,<br />
              Your AI Tutor That<br />
              <span style={{ color: 'var(--teal)' }}>Adapts to You</span>
            </h1>

            <p style={{
              fontSize: 'clamp(15px, 2vw, 18px)', color: 'var(--text-2)',
              lineHeight: 1.65, maxWidth: 540, margin: '0 auto 28px',
            }}>
              Personalised CBSE/NCERT lessons powered by AI. Bayesian mastery tracking,
              spaced repetition, and adaptive difficulty — in Hindi, English & 6 more languages.
              Grades 6–12.
            </p>

            {/* Role-based CTA */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 32 }}>
              {([
                { r: 'student' as Role, icon: '🎓', label: "I'm a Student", color: 'var(--orange)' },
                { r: 'teacher' as Role, icon: '👩‍🏫', label: "I'm a Teacher", color: 'var(--teal)' },
                { r: 'guardian' as Role, icon: '👨‍👩‍👧', label: "I'm a Parent", color: 'var(--green)' },
              ]).map(({ r, icon, label, color }) => (
                <button key={r} onClick={() => { setRole(r); setStep('role'); }}
                  className="card-hover"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 24px', borderRadius: 16,
                    background: 'var(--surface-1)', border: '1.5px solid var(--border-mid)',
                    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
                    color: 'var(--text-1)', cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = color; }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--border-mid)'; }}
                >
                  <span style={{ fontSize: 20 }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
              No credit card · No app download · 726 NCERT chapters loaded
            </p>
          </div>
        </section>

        {/* ─── Subject Grid ─── */}
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 40px' }}>
          <h3 style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 16 }}>
            16 Subjects · Grades 6–12 · 726 NCERT Chapters
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8, maxWidth: 900, margin: '0 auto',
          }}>
            {SUBJECT_META.map(s => (
              <div key={s.code} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '12px 8px', borderRadius: 14,
                background: 'var(--surface-1)', border: '1px solid var(--border)',
                transition: 'all 0.2s',
              }}
              className="card-hover"
              >
                <span style={{ fontSize: 22 }}>{s.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: s.color, textAlign: 'center', lineHeight: 1.2 }}>{s.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Features Grid ─── */}
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 40px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}>
            {[
              { icon: '🧠', title: 'Bayesian Knowledge Tracing', desc: 'AI tracks exactly what you know and what you need to practice next — no more wasted time.' },
              { icon: '🔄', title: 'Spaced Repetition', desc: 'SM-2 algorithm schedules reviews at the optimal moment to lock concepts into long-term memory.' },
              { icon: '🦊', title: 'Foxy AI Tutor', desc: 'Chat with Foxy in Hindi or English. Socratic method, real-world Indian examples, adaptive difficulty.' },
              { icon: '📊', title: 'Teacher Dashboard', desc: 'Create classes, assign work, track mastery. See exactly which students need help and where.' },
              { icon: '👨‍👩‍👧', title: 'Parent Reports', desc: 'Daily progress updates, activity tracking, assignment scores. Know how your child is really doing.' },
              { icon: '🏆', title: 'Gamified Learning', desc: 'XP, streaks, leaderboards, and badges. Learning that feels like playing — backed by evidence.' },
            ].map(f => (
              <div key={f.title} style={{
                padding: 24, borderRadius: 20,
                background: 'var(--surface-1)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>{f.icon}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'var(--text-1)' }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Stats Bar ─── */}
        <section style={{
          borderTop: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(16px)',
          padding: '20px',
        }}>
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, textAlign: 'center' }}>
            {[
              ['726', 'NCERT Chapters'],
              ['16', 'Subjects'],
              ['7', 'Grades (6-12)'],
              ['6+', 'Languages'],
            ].map(([val, label]) => (
              <div key={label as string}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }} className="gradient-text">{val}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Footer CTA ─── */}
        <section style={{ textAlign: 'center', padding: '40px 20px 48px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(22px, 3.5vw, 32px)', marginBottom: 16 }}>
            Ready to start learning?
          </h2>
          <Button size="lg" onClick={() => setStep('role')}>
            Sign Up Free — It Takes 60 Seconds →
          </Button>
        </section>

        {/* ─── Footer ─── */}
        <footer style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Alfanumrik Learning OS v2.0 · Built with ❤️ in India · © 2026
          </p>
        </footer>

        <style jsx>{`
          @media (min-width: 768px) {
            .hero-grid { text-align: left; }
          }
        `}</style>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     STEP 2: ROLE SELECTION
  ═══════════════════════════════════════════════════════════ */
  if (step === 'role') {
    const roles: Array<{ id: Role; icon: string; title: string; titleHi: string; desc: string; color: string }> = [
      { id: 'student', icon: '🎓', title: 'Student', titleHi: 'छात्र', desc: 'Learn with Foxy AI tutor, take quizzes, track your mastery across all NCERT subjects.', color: 'var(--orange)' },
      { id: 'teacher', icon: '👩‍🏫', title: 'Teacher', titleHi: 'शिक्षक', desc: 'Create classes, assign work, view student mastery reports, and use AI teaching tools.', color: 'var(--teal)' },
      { id: 'guardian', icon: '👨‍👩‍👧', title: 'Parent / Guardian', titleHi: 'अभिभावक', desc: 'Monitor your child\'s progress, view activity reports, and get daily learning updates.', color: 'var(--green)' },
    ];

    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <div style={{ maxWidth: 480, width: '100%' }} className="animate-slide-up">
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <span style={{ fontSize: 48 }}>🦊</span>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, marginTop: 8, color: 'var(--text-1)' }}>
              Welcome to Alfanumrik
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 4 }}>
              I am…
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roles.map(r => (
              <button key={r.id}
                onClick={() => { setRole(r.id); setStep('auth'); }}
                className="card-hover"
                style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '20px 24px', borderRadius: 20, textAlign: 'left',
                  background: role === r.id ? `${r.color}08` : 'var(--surface-1)',
                  border: `1.5px solid ${role === r.id ? r.color : 'var(--border)'}`,
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, background: `${r.color}10`, flexShrink: 0,
                }}>
                  {r.icon}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text-1)' }}>
                    {r.title} <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>({r.titleHi})</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 2 }}>{r.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <button onClick={() => setStep('landing')}
            style={{
              display: 'block', width: '100%', textAlign: 'center', marginTop: 16,
              fontSize: 13, color: 'var(--text-3)', background: 'transparent', border: 'none', cursor: 'pointer',
            }}>
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     STEP 3: AUTH (Email / Phone OTP)
  ═══════════════════════════════════════════════════════════ */
  if (step === 'auth') {
    const roleLabel = role === 'student' ? '🎓 Student' : role === 'teacher' ? '👩‍🏫 Teacher' : '👨‍👩‍👧 Parent';
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <Card className="w-full max-w-sm animate-slide-up" style={{ padding: 32 }}>
          <button onClick={() => setStep('role')} style={{ color: 'var(--text-3)', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 20 }}>
            ← Change role
          </button>

          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🦊</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>
              Sign Up as {roleLabel}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              We'll send a one-time code to verify
            </p>
          </div>

          {/* Auth method toggle */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
            background: 'var(--surface-2)', borderRadius: 12, padding: 3, marginBottom: 16,
          }}>
            {(['email', 'phone'] as const).map(m => (
              <button key={m} onClick={() => { setAuthMethod(m); setOtpSent(false); setError(''); }}
                style={{
                  padding: '8px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13,
                  background: authMethod === m ? 'var(--surface-1)' : 'transparent',
                  color: authMethod === m ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: authMethod === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.2s',
                }}>
                {m === 'email' ? '✉️ Email' : '📱 Phone'}
              </button>
            ))}
          </div>

          {otpSent ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center', marginBottom: 12 }}>
                OTP sent to <strong>{authMethod === 'email' ? email : phone}</strong>
              </p>
              <Input
                className="text-center"
                style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' } as any}
                type="text" placeholder="000000" maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
              />
              {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Button fullWidth onClick={verifyOtp} disabled={loading || otp.length < 6}>
                  {loading ? 'Verifying…' : 'Verify OTP →'}
                </Button>
                <Button variant="ghost" fullWidth onClick={() => { setOtpSent(false); setOtp(''); setError(''); }}>
                  Change {authMethod}
                </Button>
              </div>
            </>
          ) : (
            <>
              {authMethod === 'email' ? (
                <Input type="email" placeholder="you@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendOtp()} />
              ) : (
                <Input type="tel" placeholder="+91 98765 43210" value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendOtp()} />
              )}
              {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}
              <Button fullWidth onClick={sendOtp} disabled={loading || !(authMethod === 'email' ? email.trim() : phone.trim())}
                style={{ marginTop: 12 }}>
                {loading ? 'Sending…' : 'Send OTP →'}
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     STEP 4: PROFILE — Role-specific onboarding
  ═══════════════════════════════════════════════════════════ */
  if (step === 'profile') {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <Card className="w-full animate-slide-up" style={{ padding: 32, maxWidth: role === 'teacher' ? 480 : 400 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>
              {role === 'student' ? '✏️' : role === 'teacher' ? '👩‍🏫' : '👨‍👩‍👧'}
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>
              {role === 'student' ? 'Tell us about you' : role === 'teacher' ? 'Teacher Profile' : 'Parent Profile'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              {role === 'student' ? 'This helps Foxy personalise your lessons' :
               role === 'teacher' ? 'Set up your teaching profile' :
               'Connect with your child\'s learning'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />

            {/* Student-specific fields */}
            {role === 'student' && (
              <>
                <Select value={grade} onChange={setGrade} options={GRADES.map(g => ({ value: g, label: `Grade ${g}` }))} />
                <Select value={board} onChange={setBoard} options={BOARDS.map(b => ({ value: b, label: b }))} />
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 600 }}>Preferred language</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {LANGUAGES.slice(0, 6).map(l => (
                      <button key={l.code} onClick={() => setLang(l.code)}
                        style={{
                          padding: '8px 4px', borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: lang === l.code ? 'rgba(232,88,28,0.1)' : 'var(--surface-2)',
                          border: `1.5px solid ${lang === l.code ? 'var(--orange)' : 'var(--border)'}`,
                          color: lang === l.code ? 'var(--orange)' : 'var(--text-2)',
                          transition: 'all 0.2s',
                        }}>
                        {l.labelNative}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Teacher-specific fields */}
            {role === 'teacher' && (
              <>
                <Input placeholder="School name" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
                <Input placeholder="Qualification (e.g., B.Ed, M.Sc)" value={qualification} onChange={(e) => setQualification(e.target.value)} />
                <Select value={board} onChange={setBoard} options={BOARDS.map(b => ({ value: b, label: b }))} />
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 600 }}>Subjects you teach</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {SUBJECT_META.slice(0, 8).map(s => (
                      <button key={s.code} onClick={() => toggleArrayItem(subjectsTaught, s.code, setSubjectsTaught)}
                        style={{
                          padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: subjectsTaught.includes(s.code) ? `${s.color}15` : 'var(--surface-2)',
                          border: `1.5px solid ${subjectsTaught.includes(s.code) ? s.color : 'var(--border)'}`,
                          color: subjectsTaught.includes(s.code) ? s.color : 'var(--text-3)',
                        }}>
                        {s.icon} {s.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 600 }}>Grades you teach</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {GRADES.map(g => (
                      <button key={g} onClick={() => toggleArrayItem(gradesTaught, g, setGradesTaught)}
                        style={{
                          width: 40, height: 40, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: gradesTaught.includes(g) ? 'rgba(8,145,178,0.1)' : 'var(--surface-2)',
                          border: `1.5px solid ${gradesTaught.includes(g) ? 'var(--teal)' : 'var(--border)'}`,
                          color: gradesTaught.includes(g) ? 'var(--teal)' : 'var(--text-3)',
                        }}>
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Guardian-specific fields */}
            {role === 'guardian' && (
              <>
                <Select value={relationship} onChange={setRelationship} options={[
                  { value: 'parent', label: 'Parent' },
                  { value: 'guardian', label: 'Guardian' },
                  { value: 'sibling', label: 'Older Sibling' },
                  { value: 'tutor', label: 'Private Tutor' },
                ]} />
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 600 }}>Preferred language</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {LANGUAGES.slice(0, 3).map(l => (
                      <button key={l.code} onClick={() => setLang(l.code)}
                        style={{
                          padding: '8px 4px', borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: lang === l.code ? 'rgba(22,163,74,0.1)' : 'var(--surface-2)',
                          border: `1.5px solid ${lang === l.code ? 'var(--green)' : 'var(--border)'}`,
                          color: lang === l.code ? 'var(--green)' : 'var(--text-2)',
                        }}>
                        {l.labelNative}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{
                  padding: 16, borderRadius: 14, background: 'rgba(22,163,74,0.06)',
                  border: '1px solid rgba(22,163,74,0.15)', marginTop: 4,
                }}>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                    <strong>Link your child's account</strong> after signing up.
                    Ask your child for their <strong>link code</strong> from their Profile page,
                    or create a new student account for them from your Parent Dashboard.
                  </p>
                </div>
              </>
            )}

            <Button fullWidth onClick={saveProfile} disabled={saving || !name.trim()} style={{ marginTop: 4 }}>
              {saving ? 'Saving…' : role === 'student' ? 'Continue →' : 'Complete Setup →'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     STEP 5: SUBJECT PICKER (Students only)
  ═══════════════════════════════════════════════════════════ */
  if (step === 'subject') {
    // Filter subjects by grade
    const gradeNum = parseInt(grade);
    const available = SUBJECT_META.filter(s => {
      if (gradeNum <= 10) return ['math', 'science', 'english', 'hindi', 'social_studies', 'coding'].includes(s.code);
      return true; // 11-12 see all
    });

    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
        <Card className="w-full max-w-md animate-slide-up" style={{ padding: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>📚</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>
              Pick your main subject
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              You can study all subjects — this is just your home base
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8, marginBottom: 20,
          }}>
            {available.map(s => (
              <button key={s.code} onClick={() => setSubject(s.code)}
                className="card-hover"
                style={{
                  padding: 16, borderRadius: 16, textAlign: 'left', cursor: 'pointer',
                  background: subject === s.code ? `${s.color}12` : 'var(--surface-2)',
                  border: `1.5px solid ${subject === s.code ? s.color : 'var(--border)'}`,
                  transition: 'all 0.2s',
                }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: subject === s.code ? s.color : 'var(--text-1)' }}>
                  {s.name}
                </div>
              </button>
            ))}
          </div>

          <Button fullWidth onClick={saveSubject} disabled={saving}>
            {saving ? 'Setting up…' : 'Start Learning 🚀'}
          </Button>
        </Card>
      </div>
    );
  }

  return null;
}
