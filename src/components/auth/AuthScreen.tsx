'use client';

/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify/reset for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 * 3. Test ALL flows manually: signup, login, verify email, reset password, logout
 * 4. Verify on Chrome: /login renders, /dashboard redirects to /login when unauthenticated
 *
 * DO NOT: create middleware.ts, add client-side profile inserts, remove role tabs
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants';
// eslint-disable-next-line alfanumrik/no-raw-subject-imports -- AuthScreen is pre-login: no session yet, so neither useAllowedSubjects (student) nor useTeacherAllowedSubjects can run. Static SUBJECT_META is the correct data source for signup subject selection.
import { SUBJECT_META } from '@/lib/constants';
import { validatePassword } from '@/lib/sanitize';

const AUTH_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const AUTH_BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'];

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi','Jammu & Kashmir','Ladakh','Puducherry','Chandigarh',
];
const SCHOOL_BOARDS = ['CBSE', 'ICSE', 'State Board'];

interface AuthScreenProps {
  onSuccess: () => void;
  /** Pre-select a role tab (from ?role= query param) */
  initialRole?: 'student' | 'teacher' | 'parent' | 'institution_admin';
}

export function AuthScreen({ onSuccess, initialRole = 'student' }: AuthScreenProps) {
  // Pre-login language state. AuthContext bootstraps `isHi` from the same
  // localStorage key ('alfanumrik_language', values 'en' | 'hi'), so the
  // choice a user makes here carries into the app after sign-in. There is no
  // session yet at signup, so we read/write localStorage directly.
  const [isHi, setIsHi] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsHi(localStorage.getItem('alfanumrik_language') === 'hi');
    }
  }, []);
  const toggleLanguage = (hi: boolean) => {
    setIsHi(hi);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_language', hi ? 'hi' : 'en');
    }
  };
  const t = (en: string, hi: string) => (isHi ? hi : en);

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'check-email'>('login');
  const [roleTab, setRoleTab] = useState<'student' | 'teacher' | 'parent' | 'institution_admin'>(initialRole);
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

  // Institution admin fields
  const [instSchoolName, setInstSchoolName] = useState('');
  const [instCity, setInstCity] = useState('');
  const [instState, setInstState] = useState('');
  const [instBoard, setInstBoard] = useState('CBSE');
  const [principalName, setPrincipalName] = useState('');
  const [instPhone, setInstPhone] = useState('');

  // Email verification pending
  const [pendingEmail, setPendingEmail] = useState('');
  const [consentData, setConsentData] = useState(false);
  const [consentAnalytics, setConsentAnalytics] = useState(false);

  const TEACHER_SUBJECTS = SUBJECT_META.filter(s =>
    ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi'].includes(s.code)
  );
  const TEACHER_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

  const toggleSubject = (code: string) => {
    setSubjectsTaught(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };
  const toggleGradeTaught = (g: string) => {
    setGradesTaught(prev => prev.includes(g) ? prev.filter(c => c !== g) : [...prev, g]);
  };

  const ROLE_TABS = [
    { key: 'student' as const, label: t('Student', 'विद्यार्थी'), emoji: '🎓', color: '#E8590C' },
    { key: 'teacher' as const, label: t('Teacher', 'शिक्षक'), emoji: '👩‍🏫', color: '#2563EB' },
    { key: 'parent' as const, label: t('Parent', 'अभिभावक'), emoji: '👨‍👩‍👧', color: '#16A34A' },
    { key: 'institution_admin' as const, label: t('School', 'स्कूल'), emoji: '🏫', color: '#7C3AED' },
  ];

  const activeRoleColor = ROLE_TABS.find(r => r.key === roleTab)?.color ?? '#E8590C';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      // Defensive: clear any stale local session before a fresh signin.
      // The Supabase SDK persists tokens to localStorage; if a previous
      // project state, key rotation, or partial deploy left invalid tokens
      // behind, signInWithPassword can short-circuit on the stale state and
      // surface "AuthSessionMissingError" instead of completing. signOut
      // with scope='local' purges the local store WITHOUT a network round
      // trip, so it's safe even if Supabase Auth is degraded. See P15
      // (.claude/CLAUDE.md) — login must work for ALL users every time.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch { /* ignore — local-only signOut should never throw, but be defensive */ }

      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) { setError(authError.message); setLoading(false); return; }
      onSuccess();
    } catch { setError(t('Connection error. Please try again.', 'कनेक्शन में समस्या। कृपया फिर से प्रयास करें।')); setLoading(false); }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError(t('Please enter your name', 'कृपया अपना नाम दर्ज करें')); return; }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }

    if (roleTab === 'teacher') {
      if (!schoolName.trim()) { setError(t('Please enter your school name', 'कृपया अपने स्कूल का नाम दर्ज करें')); return; }
      if (subjectsTaught.length === 0) { setError(t('Please select at least one subject', 'कृपया कम से कम एक विषय चुनें')); return; }
      if (gradesTaught.length === 0) { setError(t('Please select at least one grade', 'कृपया कम से कम एक कक्षा चुनें')); return; }
    }

    if (roleTab === 'institution_admin') {
      if (!instSchoolName.trim()) { setError(t('Please enter the school name', 'कृपया स्कूल का नाम दर्ज करें')); return; }
      if (!instCity.trim()) { setError(t('Please enter the city', 'कृपया शहर दर्ज करें')); return; }
      if (!instState.trim()) { setError(t('Please select a state', 'कृपया राज्य चुनें')); return; }
    }

    if (roleTab === 'student' && studentAgeRange === '10-12') {
      if (!parentEmail.trim()) { setError(t('Parent/guardian email is required for students under 13', '13 वर्ष से कम उम्र के विद्यार्थियों के लिए अभिभावक का ईमेल आवश्यक है')); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim())) { setError(t('Please enter a valid parent/guardian email', 'कृपया एक मान्य अभिभावक ईमेल दर्ज करें')); return; }
      if (!parentConsent) { setError(t('Please confirm parental consent to continue', 'जारी रखने के लिए कृपया अभिभावक की सहमति की पुष्टि करें')); return; }
    }

    if (!consentData) { setError(t('Please consent to data processing to continue', 'जारी रखने के लिए कृपया डेटा प्रोसेसिंग की सहमति दें')); return; }

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
      // B4: Persist teacher fields into auth metadata so callback/confirm routes
      // can bootstrap the teacher profile after email confirmation.
      if (roleTab === 'teacher') {
        metaData.school_name = schoolName.trim();
        metaData.subjects_taught = JSON.stringify(subjectsTaught);
        metaData.grades_taught = JSON.stringify(gradesTaught);
      }

      if (roleTab === 'institution_admin') {
        metaData.school_name = instSchoolName.trim();
        metaData.city = instCity.trim();
        metaData.state = instState.trim();
        metaData.board = instBoard;
        if (principalName.trim()) metaData.principal_name = principalName.trim();
        if (instPhone.trim()) metaData.phone = instPhone.trim();
      }

      // Parent / guardian: persist the optional child link_code so the
      // server-side bootstrap (auth/callback or auth/confirm or
      // /api/auth/bootstrap) can pass it to bootstrap_user_profile and
      // wire the guardian to the student row immediately. Previously this
      // was dropped on the email-confirmation path, leaving guardians
      // with accounts but no children linked. (Phase 2-A hardening.)
      if (roleTab === 'parent' && linkCode.trim()) {
        metaData.link_code = linkCode.trim();
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
        // Profile creation happens server-side:
        // 1. If email verification required: /auth/callback bootstraps the profile
        // 2. If no verification: AuthContext.fetchUser() calls /api/auth/bootstrap
        // We do NOT create profiles client-side to maintain zero-frontend-trusted auth.

        const session = authData.session;
        if (session) {
          // No email verification required — user is immediately logged in
          // Send welcome email (fire-and-forget)
          const welcomePayload: Record<string, string> = { role: roleTab, name: name.trim(), email: email.trim() };
          if (roleTab === 'student') { welcomePayload.grade = grade; welcomePayload.board = board; }
          if (roleTab === 'teacher') { welcomePayload.school_name = schoolName.trim(); }
          fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify(welcomePayload),
          }).catch((err: unknown) => {
            console.warn('[auth] welcome email failed:', err instanceof Error ? err.message : String(err));
          });
          setLoading(false);
          onSuccess();
        } else {
          // Email confirmation required — show check-email screen
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('alfanumrik_pending_email', email.trim());
          }
          setPendingEmail(email.trim());
          setMode('check-email');
          setSuccess('');
          setError('');
          setLoading(false);
        }
      }
    } catch { setError(t('Connection error. Please try again.', 'कनेक्शन में समस्या। कृपया फिर से प्रयास करें।')); setLoading(false); }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError(t('Please enter your email', 'कृपया अपना ईमेल दर्ज करें')); return; }
    setError(''); setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (resetError) { setError(resetError.message); setLoading(false); return; }
      setSuccess(t('Password reset link sent to your email!', 'पासवर्ड रीसेट लिंक आपके ईमेल पर भेज दिया गया है!'));
      setLoading(false);
    } catch { setError(t('Connection error. Please try again.', 'कनेक्शन में समस्या। कृपया फिर से प्रयास करें।')); setLoading(false); }
  };

  const handleResendVerification = async () => {
    setError(''); setLoading(true);
    // B9: Recover email from sessionStorage if React state was lost (e.g. page refresh)
    const targetEmail = pendingEmail ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('alfanumrik_pending_email') ?? '' : '');
    if (!targetEmail) {
      setError(t('Email address not found. Please start sign-up again.', 'ईमेल पता नहीं मिला। कृपया साइन-अप फिर से शुरू करें।'));
      setLoading(false);
      return;
    }
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?type=signup`,
        },
      });
      if (resendError) { setError(resendError.message); } else { setSuccess(t('Verification email sent again! Check your inbox.', 'सत्यापन ईमेल फिर से भेज दिया गया है! अपना इनबॉक्स जाँचें।')); }
      setLoading(false);
    } catch { setError(t('Connection error.', 'कनेक्शन में समस्या।')); setLoading(false); }
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
    ? t('Empower your classroom with AI', 'AI के साथ अपनी कक्षा को सशक्त बनाएं')
    : roleTab === 'parent'
      ? t('Track your child\'s learning journey', 'अपने बच्चे की सीखने की यात्रा देखें')
      : roleTab === 'institution_admin'
        ? t('Manage your school on Alfanumrik', 'Alfanumrik पर अपने स्कूल का प्रबंधन करें')
        : t('AI Tutor for CBSE Students', 'CBSE विद्यार्थियों के लिए AI ट्यूटर');

  const signupTitle = roleTab === 'teacher'
    ? t('Join as Teacher', 'शिक्षक के रूप में जुड़ें')
    : roleTab === 'parent'
      ? t('Join as Parent', 'अभिभावक के रूप में जुड़ें')
      : roleTab === 'institution_admin'
        ? t('Register Your School', 'अपने स्कूल को पंजीकृत करें')
        : t('Start Learning Now', 'अभी सीखना शुरू करें');

  const buttonGradient = roleTab === 'teacher'
    ? 'linear-gradient(135deg, #2563EB, #3B82F6)'
    : roleTab === 'parent'
      ? 'linear-gradient(135deg, #16A34A, #22C55E)'
      : roleTab === 'institution_admin'
        ? 'linear-gradient(135deg, #7C3AED, #A855F7)'
        : 'linear-gradient(135deg, #E8590C, #F59E0B)';

  return (
    <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Language toggle (pre-login). Persists to localStorage key
            'alfanumrik_language' so the choice carries into AuthContext post-login. */}
        <div className="flex justify-end mb-2">
          <div className="inline-flex rounded-full p-0.5" role="group" aria-label={t('Language', 'भाषा')} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => toggleLanguage(false)}
              aria-pressed={!isHi}
              className="px-3 py-1 rounded-full text-xs font-bold transition-all"
              style={{ background: !isHi ? 'var(--orange)' : 'transparent', color: !isHi ? '#fff' : 'var(--text-3)' }}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => toggleLanguage(true)}
              aria-pressed={isHi}
              className="px-3 py-1 rounded-full text-xs font-bold transition-all"
              style={{ background: isHi ? 'var(--orange)' : 'transparent', color: isHi ? '#fff' : 'var(--text-3)' }}
            >
              हिंदी
            </button>
          </div>
        </div>
        {/* Hero */}
        <div className="text-center mb-5">
          <div className="text-6xl mb-2 animate-float">🦊</div>
          <h1 className="text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', background: 'linear-gradient(135deg, #E8590C, #F59E0B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Alfanumrik
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-2)' }}>{subtitle}</p>
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('CBSE Grades 6-12', 'CBSE कक्षा 6-12')}</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(22,163,74,0.08)', color: '#16A34A' }}>{t('Hindi & English', 'हिंदी और अंग्रेज़ी')}</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>{t('AI-Powered Adaptive', 'AI-संचालित अनुकूली')}</span>
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
            {mode === 'login' ? t('Welcome Back!', 'फिर से स्वागत है!') : mode === 'signup' ? signupTitle : mode === 'check-email' ? t('Check Your Email', 'अपना ईमेल जाँचें') : t('Reset Password', 'पासवर्ड रीसेट करें')}
          </h2>

          {error && (
            <div role="alert" className="mb-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' }}>
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
                  {t('We sent a verification link to', 'हमने एक सत्यापन लिंक भेजा है')}<br/><strong style={{ color: 'var(--text-1)' }}>{pendingEmail}</strong>
                </p>
                <p className="text-xs" style={{ color: 'var(--text-3)', lineHeight: 1.5 }}>
                  {t('Click the link in your email to verify your account and start learning. Check your spam folder if you don\'t see it.', 'अपना खाता सत्यापित करने और सीखना शुरू करने के लिए अपने ईमेल में दिए गए लिंक पर क्लिक करें। अगर यह न दिखे तो अपना स्पैम फ़ोल्डर जाँचें।')}
                </p>
                <button type="button" onClick={handleResendVerification} disabled={loading} className="w-full text-center text-xs font-semibold py-2" style={{ color: activeRoleColor }}>
                  {loading ? '...' : t("Didn't receive it? Resend Email", 'नहीं मिला? ईमेल फिर से भेजें')}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <input id="auth-name" name="name" type="text" placeholder={t('Your Name', 'आपका नाम')} value={name} onChange={e => setName(e.target.value)} style={inputStyle} required aria-label={t('Your name', 'आपका नाम')} autoComplete="name" />
            )}

            {mode !== 'check-email' && (
              <input id="auth-email" name="email" type="email" placeholder={t('Email address', 'ईमेल पता')} value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required aria-label={t('Email address', 'ईमेल पता')} autoComplete="email" />
            )}

            {mode !== 'forgot' && mode !== 'check-email' && (
              <div className="relative">
                <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} placeholder={t('Password (min 8 chars, A-z, 0-9)', 'पासवर्ड (कम से कम 8 अक्षर, A-z, 0-9)')} value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 44 }} required minLength={8} aria-label={t('Password', 'पासवर्ड')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--text-3)' }} aria-label={showPassword ? t('Hide password', 'पासवर्ड छिपाएं') : t('Show password', 'पासवर्ड दिखाएं')}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            )}

            {/* Student signup fields */}
            {mode === 'signup' && roleTab === 'student' && (
              <>
                <div className="flex gap-2">
                  <select id="auth-grade" name="grade" value={grade} onChange={e => setGrade(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }} aria-label={t('Select your grade', 'अपनी कक्षा चुनें')}>
                    {AUTH_GRADES.map(g => <option key={g} value={g}>{t('Grade', 'कक्षा')} {g}</option>)}
                  </select>
                  <select id="auth-board" name="board" value={board} onChange={e => setBoard(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }} aria-label={t('Select your board', 'अपना बोर्ड चुनें')}>
                    {AUTH_BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5" htmlFor="age-range" style={{ color: 'var(--text-2)' }}>{t('Age Range', 'आयु सीमा')}</label>
                  <select id="age-range" name="age-range" value={studentAgeRange} onChange={e => { setStudentAgeRange(e.target.value as '13-18' | '10-12'); if (e.target.value === '13-18') { setParentEmail(''); setParentConsent(false); } }} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="13-18">{t('13 – 18 years', '13 – 18 वर्ष')}</option>
                    <option value="10-12">{t('10 – 12 years', '10 – 12 वर्ष')}</option>
                  </select>
                </div>

                {studentAgeRange === '10-12' && (
                  <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#F59E0B' }}>{t('Parental consent required for students under 13', '13 वर्ष से कम उम्र के विद्यार्थियों के लिए अभिभावक की सहमति आवश्यक है')}</p>
                    <input id="auth-parent-email" name="parent-email" type="email" placeholder={t('Parent/Guardian Email', 'अभिभावक का ईमेल')} value={parentEmail} onChange={e => setParentEmail(e.target.value)} style={inputStyle} required aria-label={t('Parent or guardian email', 'अभिभावक का ईमेल')} autoComplete="email" />
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input id="auth-parent-consent" name="parent-consent" type="checkbox" checked={parentConsent} onChange={e => setParentConsent(e.target.checked)} className="mt-0.5" style={{ accentColor: '#E8590C' }} />
                      <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                        {t('I confirm that my parent/guardian has given consent for me to use this platform', 'मैं पुष्टि करता/करती हूँ कि मेरे अभिभावक ने मुझे इस प्लेटफ़ॉर्म का उपयोग करने की सहमति दी है')}
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}

            {/* Teacher signup fields */}
            {mode === 'signup' && roleTab === 'teacher' && (
              <>
                <input id="auth-school-name" name="school-name" type="text" placeholder={t('School Name', 'स्कूल का नाम')} value={schoolName} onChange={e => setSchoolName(e.target.value)} style={inputStyle} required aria-label={t('School name', 'स्कूल का नाम')} autoComplete="organization" />
                <fieldset>
                  <legend className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>{t('Subjects You Teach', 'आप कौन से विषय पढ़ाते हैं')}</legend>
                  <div className="flex flex-wrap gap-1.5" role="group">
                    {TEACHER_SUBJECTS.map(s => (
                      <button key={s.code} type="button" onClick={() => toggleSubject(s.code)} aria-pressed={subjectsTaught.includes(s.code)} style={chipStyle(subjectsTaught.includes(s.code), '#2563EB')}>
                        {s.icon} {s.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>{t('Grades You Teach', 'आप कौन सी कक्षाएँ पढ़ाते हैं')}</legend>
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
                <input id="auth-phone" name="phone" type="tel" placeholder={t('Phone Number (optional)', 'फ़ोन नंबर (वैकल्पिक)')} value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} aria-label={t('Phone number', 'फ़ोन नंबर')} autoComplete="tel" />
                <div>
                  <input id="auth-link-code" name="link-code" type="text" placeholder={t('Child Link Code (optional)', 'बच्चे का लिंक कोड (वैकल्पिक)')} value={linkCode} onChange={e => setLinkCode(e.target.value)} style={inputStyle} maxLength={8} aria-label={t('Child link code', 'बच्चे का लिंक कोड')} />
                  <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--text-3)' }}>
                    {t("Have a link code from your child's school? Enter it to connect!", 'अपने बच्चे के स्कूल से लिंक कोड मिला है? जुड़ने के लिए इसे दर्ज करें!')}
                  </p>
                </div>
              </>
            )}

            {/* Institution admin signup fields */}
            {mode === 'signup' && roleTab === 'institution_admin' && (
              <>
                <input id="auth-inst-school" name="school-name" type="text" placeholder={t('School Name *', 'स्कूल का नाम *')} value={instSchoolName} onChange={e => setInstSchoolName(e.target.value)} style={inputStyle} required aria-label={t('School name', 'स्कूल का नाम')} autoComplete="organization" />
                <div className="flex gap-2">
                  <input id="auth-inst-city" name="city" type="text" placeholder={t('City *', 'शहर *')} value={instCity} onChange={e => setInstCity(e.target.value)} style={{ ...inputStyle, flex: 1 }} required aria-label={t('City', 'शहर')} autoComplete="address-level2" />
                  <select id="auth-inst-state" name="state" value={instState} onChange={e => setInstState(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }} aria-label={t('State', 'राज्य')} required>
                    <option value="">{t('State *', 'राज्य *')}</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <select id="auth-inst-board" name="board-affiliation" value={instBoard} onChange={e => setInstBoard(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} aria-label={t('Board affiliation', 'बोर्ड संबद्धता')}>
                  {SCHOOL_BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input id="auth-principal-name" name="principal-name" type="text" placeholder={t('Principal Name (optional)', 'प्रधानाचार्य का नाम (वैकल्पिक)')} value={principalName} onChange={e => setPrincipalName(e.target.value)} style={inputStyle} aria-label={t('Principal name', 'प्रधानाचार्य का नाम')} autoComplete="name" />
                <input id="auth-school-phone" name="school-phone" type="tel" placeholder={t('School Phone (optional)', 'स्कूल फ़ोन (वैकल्पिक)')} value={instPhone} onChange={e => setInstPhone(e.target.value)} style={inputStyle} aria-label={t('School phone', 'स्कूल फ़ोन')} autoComplete="tel" />
              </>
            )}

            {/* DPDPA Consent Checkboxes */}
            {mode === 'signup' && (
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input id="auth-consent-data" name="consent-data" type="checkbox" checked={consentData} onChange={e => setConsentData(e.target.checked)} className="mt-0.5 shrink-0" style={{ accentColor: activeRoleColor, width: 16, height: 16 }} />
                  <span>
                    {t('I consent to the collection and processing of my data as described in the', 'मैं इसमें वर्णित अनुसार अपने डेटा के संग्रह और प्रोसेसिंग की सहमति देता/देती हूँ:')}{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: activeRoleColor }}>{t('Privacy Policy', 'गोपनीयता नीति')}</a>
                    <span style={{ color: 'var(--danger)' }}> *</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input id="auth-consent-analytics" name="consent-analytics" type="checkbox" checked={consentAnalytics} onChange={e => setConsentAnalytics(e.target.checked)} className="mt-0.5 shrink-0" style={{ accentColor: activeRoleColor, width: 16, height: 16 }} />
                  <span>{t('I consent to analytics tracking to improve the platform', 'मैं प्लेटफ़ॉर्म को बेहतर बनाने के लिए एनालिटिक्स ट्रैकिंग की सहमति देता/देती हूँ')}</span>
                </label>
              </div>
            )}

            {mode !== 'check-email' && (
              <button type="submit" disabled={loading} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50" style={{ background: buttonGradient }}>
                {loading ? '...' : mode === 'login' ? t('Log In', 'लॉग इन करें') : mode === 'signup' ? t('Create Account', 'खाता बनाएं') : t('Send Reset Link', 'रीसेट लिंक भेजें')}
              </button>
            )}
          </form>

          {mode === 'login' && (
            <button onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }} className="w-full text-center text-xs mt-3 font-semibold" style={{ color: 'var(--text-3)' }}>
              {t('Forgot password?', 'पासवर्ड भूल गए?')}
            </button>
          )}

          <div className="mt-4 pt-4 text-center text-xs" style={{ borderTop: '1px solid var(--border)' }}>
            {mode === 'login' ? (
              <span style={{ color: 'var(--text-3)' }}>{t('New here?', 'यहाँ नए हैं?')} <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>{t('Create Account', 'खाता बनाएं')}</button></span>
            ) : (
              <span style={{ color: 'var(--text-3)' }}>{t('Already have an account?', 'पहले से खाता है?')} <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>{t('Log In', 'लॉग इन करें')}</button></span>
            )}
          </div>
        </div>

        {/* Trust signals */}
        <div className="mt-5 text-center space-y-2">
          <div className="flex items-center justify-center gap-4 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
            <span>🛡️ {t('Safe & Secure', 'सुरक्षित')}</span>
            <span>🇮🇳 {t('Made in India', 'भारत में निर्मित')}</span>
            <span>🔒 {t('No Ads', 'कोई विज्ञापन नहीं')}</span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {t('By signing up, you agree to our', 'साइन अप करके, आप हमारी इन शर्तों से सहमत होते हैं:')} <a href="/terms" className="underline">{t('Terms', 'शर्तें')}</a> & <a href="/privacy" className="underline">{t('Privacy Policy', 'गोपनीयता नीति')}</a>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
