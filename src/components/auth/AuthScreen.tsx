'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUBJECT_META } from '@/lib/constants';
import { validatePassword } from '@/lib/sanitize';
import { VALID_GRADES, VALID_BOARDS } from '@/lib/identity';

const AUTH_GRADES = VALID_GRADES;
const AUTH_BOARDS = VALID_BOARDS;

interface AuthScreenProps {
  onSuccess: () => void;
  /** Pre-select a role tab (from ?role= query param) */
  initialRole?: 'student' | 'teacher' | 'parent';
}

export function AuthScreen({ onSuccess, initialRole = 'student' }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'check-email'>('login');
  const [roleTab, setRoleTab] = useState<'student' | 'teacher' | 'parent'>(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Teacher fields
  const [schoolName, setSchoolName] = useState('');
  const [subjectsTaught, setSubjectsTaught] = useState<string[]>([]);
  const [gradesTaught, setGradesTaught] = useState<string[]>([]);

  // Student age / parental consent fields
  const [studentAgeRange, setStudentAgeRange] = useState<'13-18' | '10-12'>('13-18');
  const [parentEmail, setParentEmail] = useState('');
  const [parentConsent, setParentConsent] = useState(false);

  // Parent fields
  const [phone, setPhone] = useState('');
  const [linkCode, setLinkCode] = useState('');

  // Email verification pending
  const [pendingEmail, setPendingEmail] = useState('');
  const [consentData, setConsentData] = useState(false);
  const [consentAnalytics, setConsentAnalytics] = useState(false);

  const TEACHER_SUBJECTS = SUBJECT_META.filter(s =>
    ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi'].includes(s.code)
  );
  const TEACHER_GRADES = VALID_GRADES;

  const toggleSubject = (code: string) => {
    setSubjectsTaught(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };
  const toggleGradeTaught = (g: string) => {
    setGradesTaught(prev => prev.includes(g) ? prev.filter(c => c !== g) : [...prev, g]);
  };

  const ROLE_TABS = [
    { key: 'student' as const, label: 'Student', emoji: '🎓', color: '#E8590C' },
    { key: 'teacher' as const, label: 'Teacher', emoji: '👩‍🏫', color: '#2563EB' },
    { key: 'parent' as const, label: 'Parent', emoji: '👨‍👩‍👧', color: '#16A34A' },
  ];

  const activeRoleColor = ROLE_TABS.find(r => r.key === roleTab)?.color ?? '#E8590C';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) { setError(authError.message); setLoading(false); return; }
      onSuccess();
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name'); return; }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }

    if (roleTab === 'teacher') {
      if (!schoolName.trim()) { setError('Please enter your school name'); return; }
      if (subjectsTaught.length === 0) { setError('Please select at least one subject'); return; }
      if (gradesTaught.length === 0) { setError('Please select at least one grade'); return; }
    }

    if (roleTab === 'student' && studentAgeRange === '10-12') {
      if (!parentEmail.trim()) { setError('Parent/guardian email is required for students under 13'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim())) { setError('Please enter a valid parent/guardian email'); return; }
      if (!parentConsent) { setError('Please confirm parental consent to continue'); return; }
    }

    if (!consentData) { setError('Please consent to data processing to continue'); return; }

    setError(''); setLoading(true);
    try {
      const metaData: Record<string, string> = { name: name.trim(), role: roleTab, consent_data: 'true', consent_analytics: consentAnalytics ? 'true' : 'false' };
      if (roleTab === 'student') {
        metaData.grade = grade;
        metaData.board = board;
        if (studentAgeRange === '10-12') {
          metaData.is_minor = 'true';
          metaData.parent_consent_email = parentEmail.trim();
        }
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: metaData,
          emailRedirectTo: `${window.location.origin}/auth/callback?type=signup`,
        },
      });
      if (authError) { setError(authError.message); setLoading(false); return; }
      if (authData.user) {
        const session = authData.session;

        if (session) {
          // Session exists — bootstrap profile via server
          try {
            const bootstrapPayload: Record<string, unknown> = {
              role: roleTab,
              name: name.trim(),
            };

            if (roleTab === 'student') {
              bootstrapPayload.grade = grade;
              bootstrapPayload.board = board;
            } else if (roleTab === 'teacher') {
              bootstrapPayload.school_name = schoolName.trim();
              bootstrapPayload.subjects_taught = subjectsTaught;
              bootstrapPayload.grades_taught = gradesTaught;
            } else if (roleTab === 'parent') {
              bootstrapPayload.phone = phone.trim() || null;
              bootstrapPayload.link_code = linkCode.trim() || null;
            }

            const bootstrapRes = await fetch('/api/auth/bootstrap', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bootstrapPayload),
            });

            if (!bootstrapRes.ok) {
              const errData = await bootstrapRes.json().catch(() => ({}));
              console.error('[Signup] Bootstrap failed:', errData);
              // Show error but don't block — AuthContext fallback will handle
              setError(errData.error || 'Profile setup failed. Please try logging in again.');
              setLoading(false);
              // Still call onSuccess since auth identity exists
              // The AuthContext fallback will create the profile
              onSuccess();
              return;
            }
          } catch (bootstrapErr) {
            console.error('[Signup] Bootstrap error:', bootstrapErr);
            // Non-fatal — proceed with onSuccess, AuthContext will handle
          }

          // Fire-and-forget welcome email
          const welcomePayload: Record<string, string> = { role: roleTab, name: name.trim(), email: email.trim() };
          if (roleTab === 'student') { welcomePayload.grade = grade; welcomePayload.board = board; }
          if (roleTab === 'teacher') { welcomePayload.school_name = schoolName.trim(); }
          fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify(welcomePayload),
          }).catch(() => {});

          onSuccess();
        } else {
          // No session — email confirmation required
          setPendingEmail(email.trim());
          setMode('check-email');
          setSuccess('');
          setError('');
          setLoading(false);
        }
      }
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email'); return; }
    setError(''); setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (resetError) { setError(resetError.message); setLoading(false); return; }
      setSuccess('Password reset link sent to your email!');
      setLoading(false);
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleResendVerification = async () => {
    setError(''); setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
      });
      if (resendError) { setError(resendError.message); } else { setSuccess('Verification email sent again! Check your inbox.'); }
      setLoading(false);
    } catch { setError('Connection error.'); setLoading(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: 12,
    border: '1.5px solid var(--border)', background: 'var(--surface-2)',
    fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
    color: 'var(--text-1)',
  };

  const chipStyle = (selected: boolean, color: string): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    border: `1.5px solid ${selected ? color : 'var(--border)'}`,
    background: selected ? `${color}18` : 'var(--surface-2)',
    color: selected ? color : 'var(--text-3)',
    cursor: 'pointer', transition: 'all 0.15s ease',
  });

  const subtitle = roleTab === 'teacher'
    ? 'Empower your classroom with AI'
    : roleTab === 'parent'
      ? 'Track your child\'s learning journey'
      : 'AI Tutor for CBSE Students';

  const signupTitle = roleTab === 'teacher'
    ? 'Join as Teacher'
    : roleTab === 'parent'
      ? 'Join as Parent'
      : 'Start Learning Now';

  const buttonGradient = roleTab === 'teacher'
    ? 'linear-gradient(135deg, #2563EB, #3B82F6)'
    : roleTab === 'parent'
      ? 'linear-gradient(135deg, #16A34A, #22C55E)'
      : 'linear-gradient(135deg, #E8590C, #F59E0B)';

  return (
    <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Hero */}
        <div className="text-center mb-5">
          <div className="text-6xl mb-2 animate-float">🦊</div>
          <h1 className="text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', background: 'linear-gradient(135deg, #E8590C, #F59E0B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Alfanumrik
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-2)' }}>{subtitle}</p>
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>CBSE Grades 6-12</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(22,163,74,0.08)', color: '#16A34A' }}>Hindi & English</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>AI-Powered Adaptive</span>
          </div>
        </div>

        {/* Role Tabs */}
        {mode !== 'check-email' && (
          <div className="flex gap-1 mb-4 p-1 rounded-2xl" role="tablist" aria-label="Account type" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
            {ROLE_TABS.map(tab => {
              const isActive = roleTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => { setRoleTab(tab.key); setError(''); setSuccess(''); }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                  style={{
                    background: isActive ? `${tab.color}15` : 'transparent',
                    color: isActive ? tab.color : 'var(--text-3)',
                    borderBottom: isActive ? `2.5px solid ${tab.color}` : '2.5px solid transparent',
                  }}
                >
                  <span className="mr-1" aria-hidden="true">{tab.emoji}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Form Card */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <h2 className="text-lg font-bold mb-4 text-center" style={{ color: 'var(--text-1)' }}>
            {mode === 'login' ? 'Welcome Back!' : mode === 'signup' ? signupTitle : mode === 'check-email' ? 'Check Your Email' : 'Reset Password'}
          </h2>

          {error && (
            <div role="alert" className="mb-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="mb-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#D1FAE5', color: '#059669', border: '1px solid #A7F3D0' }}>
              {success}
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgot} className="space-y-3">
            {mode === 'check-email' && (
              <div className="text-center space-y-4 py-2">
                <div className="text-4xl" aria-hidden="true">📧</div>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  We sent a verification link to<br/><strong style={{ color: 'var(--text-1)' }}>{pendingEmail}</strong>
                </p>
                <p className="text-xs" style={{ color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Click the link in your email to verify your account and start learning. Check your spam folder if you don&apos;t see it.
                </p>
                <button type="button" onClick={handleResendVerification} disabled={loading} className="w-full text-center text-xs font-semibold py-2" style={{ color: activeRoleColor }}>
                  {loading ? '...' : "Didn't receive it? Resend Email"}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <input type="text" placeholder="Your Name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} required aria-label="Your name" autoComplete="name" />
            )}

            {mode !== 'check-email' && (
              <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required aria-label="Email address" autoComplete="email" />
            )}

            {mode !== 'forgot' && mode !== 'check-email' && (
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} placeholder="Password (min 8 chars, A-z, 0-9)" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 44 }} required minLength={8} aria-label="Password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--text-3)' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            )}

            {/* Student signup fields */}
            {mode === 'signup' && roleTab === 'student' && (
              <>
                <div className="flex gap-2">
                  <select value={grade} onChange={e => setGrade(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }} aria-label="Select your grade">
                    {AUTH_GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={board} onChange={e => setBoard(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }} aria-label="Select your board">
                    {AUTH_BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5" htmlFor="age-range" style={{ color: 'var(--text-2)' }}>Age Range</label>
                  <select id="age-range" value={studentAgeRange} onChange={e => { setStudentAgeRange(e.target.value as '13-18' | '10-12'); if (e.target.value === '13-18') { setParentEmail(''); setParentConsent(false); } }} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="13-18">13 &ndash; 18 years</option>
                    <option value="10-12">10 &ndash; 12 years</option>
                  </select>
                </div>

                {studentAgeRange === '10-12' && (
                  <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#F59E0B' }}>Parental consent required for students under 13</p>
                    <input type="email" placeholder="Parent/Guardian Email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} style={inputStyle} required aria-label="Parent or guardian email" autoComplete="email" />
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={parentConsent} onChange={e => setParentConsent(e.target.checked)} className="mt-0.5" style={{ accentColor: '#E8590C' }} />
                      <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                        I confirm that my parent/guardian has given consent for me to use this platform
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}

            {/* Teacher signup fields */}
            {mode === 'signup' && roleTab === 'teacher' && (
              <>
                <input type="text" placeholder="School Name" value={schoolName} onChange={e => setSchoolName(e.target.value)} style={inputStyle} required aria-label="School name" autoComplete="organization" />
                <fieldset>
                  <legend className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Subjects You Teach</legend>
                  <div className="flex flex-wrap gap-1.5" role="group">
                    {TEACHER_SUBJECTS.map(s => (
                      <button key={s.code} type="button" onClick={() => toggleSubject(s.code)} aria-pressed={subjectsTaught.includes(s.code)} style={chipStyle(subjectsTaught.includes(s.code), '#2563EB')}>
                        {s.icon} {s.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Grades You Teach</legend>
                  <div className="flex flex-wrap gap-1.5" role="group">
                    {TEACHER_GRADES.map(g => (
                      <button key={g} type="button" onClick={() => toggleGradeTaught(g)} aria-pressed={gradesTaught.includes(g)} style={chipStyle(gradesTaught.includes(g), '#2563EB')}>
                        {g}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {/* Parent signup fields */}
            {mode === 'signup' && roleTab === 'parent' && (
              <>
                <input type="tel" placeholder="Phone Number (optional)" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} aria-label="Phone number" autoComplete="tel" />
                <div>
                  <input type="text" placeholder="Child Link Code (optional)" value={linkCode} onChange={e => setLinkCode(e.target.value)} style={inputStyle} maxLength={8} aria-label="Child link code" />
                  <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--text-3)' }}>
                    Have a link code from your child&apos;s school? Enter it to connect!
                  </p>
                </div>
              </>
            )}

            {/* DPDPA Consent Checkboxes */}
            {mode === 'signup' && (
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={consentData} onChange={e => setConsentData(e.target.checked)} className="mt-0.5 shrink-0" style={{ accentColor: activeRoleColor, width: 16, height: 16 }} />
                  <span>
                    I consent to the collection and processing of my data as described in the{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: activeRoleColor }}>Privacy Policy</a>
                    <span style={{ color: '#EF4444' }}> *</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={consentAnalytics} onChange={e => setConsentAnalytics(e.target.checked)} className="mt-0.5 shrink-0" style={{ accentColor: activeRoleColor, width: 16, height: 16 }} />
                  <span>I consent to analytics tracking to improve the platform</span>
                </label>
              </div>
            )}

            {mode !== 'check-email' && (
              <button type="submit" disabled={loading} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50" style={{ background: buttonGradient }}>
                {loading ? '...' : mode === 'login' ? 'Log In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
              </button>
            )}
          </form>

          {mode === 'login' && (
            <button onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }} className="w-full text-center text-xs mt-3 font-semibold" style={{ color: 'var(--text-3)' }}>
              Forgot password?
            </button>
          )}

          <div className="mt-4 pt-4 text-center text-xs" style={{ borderTop: '1px solid var(--border)' }}>
            {mode === 'login' ? (
              <span style={{ color: 'var(--text-3)' }}>New here? <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>Create Account</button></span>
            ) : (
              <span style={{ color: 'var(--text-3)' }}>Already have an account? <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>Log In</button></span>
            )}
          </div>

          <p className="text-center text-xs mt-3" style={{ color: '#9CA3AF' }}>
            Parent? <a href="/parent" style={{ color: '#E8581C', fontWeight: 500 }}>Go to Parent Portal &rarr;</a>
          </p>
        </div>

        {/* Trust signals */}
        <div className="mt-5 text-center space-y-2">
          <div className="flex items-center justify-center gap-4 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
            <span>🛡️ Safe & Secure</span>
            <span>🇮🇳 Made in India</span>
            <span>🔒 No Ads</span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            By signing up, you agree to our <a href="/terms" className="underline">Terms</a> & <a href="/privacy" className="underline">Privacy Policy</a>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
