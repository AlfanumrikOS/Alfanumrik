'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@alfanumrik/lib/sanitize';
import { LoadingFoxy } from '@alfanumrik/ui/ui';

/* ── Notification preference keys ── */
const NOTIF_PREFS_KEY = 'notif_prefs';

interface NotifPrefs {
  daily_quiz_reminder: boolean;
  streak_alerts: boolean;
  weekly_progress_report: boolean;
}

function loadNotifPrefs(): NotifPrefs {
  if (typeof window === 'undefined') {
    return { daily_quiz_reminder: true, streak_alerts: true, weekly_progress_report: true };
  }
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) return JSON.parse(raw) as NotifPrefs;
  } catch {
    /* ignore malformed JSON */
  }
  return { daily_quiz_reminder: true, streak_alerts: true, weekly_progress_report: true };
}

function saveNotifPrefs(prefs: NotifPrefs): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

/* ── Toggle Switch component ── */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: checked ? 'var(--orange, #E8581C)' : 'var(--surface-2, #e5e7eb)',
        /* ring color when focused */
      }}
    >
      <span
        className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
        style={{
          transform: checked ? 'translateX(22px)' : 'translateX(2px)',
        }}
      />
    </button>
  );
}

/* ── Section card wrapper ── */
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
        <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3, #9ca3af)' }}>
          {title}
        </h2>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border, #e5e7eb)' }}>
        {children}
      </div>
    </div>
  );
}

/* ── Row within a section ── */
function SettingsRow({
  label,
  sublabel,
  right,
  onClick,
  danger,
}: {
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const El = onClick ? 'button' : 'div';
  return (
    <El
      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors"
      onClick={onClick}
      style={
        onClick
          ? { cursor: 'pointer' }
          : undefined
      }
    >
      <div className="flex-1 min-w-0">
        <span
          className="text-sm font-medium block"
          style={{ color: danger ? '#DC2626' : 'var(--text-1, #111827)' }}
        >
          {label}
        </span>
        {sublabel && (
          <span className="text-xs block mt-0.5" style={{ color: 'var(--text-3, #9ca3af)' }}>
            {sublabel}
          </span>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </El>
  );
}

/* ══════════════════════════════════════════════════════════
   Settings Page
   ══════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const router = useRouter();
  const { student, isLoggedIn, isLoading, isHi, setLanguage, language, signOut } = useAuth();

  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    daily_quiz_reminder: true,
    streak_alerts: true,
    weekly_progress_report: true,
  });

  /* Toast / feedback state */
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);

  /* Inline password change form state */
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [showPwFields, setShowPwFields] = useState(false);

  /* Load notification prefs from localStorage on mount */
  useEffect(() => {
    setNotifPrefs(loadNotifPrefs());
  }, []);

  /* Auth guard */
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* Auto-dismiss toast after 3 s */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (msg: string, ok = true) => setToast({ msg, ok });

  /* ── Notification toggle ── */
  const toggleNotif = (key: keyof NotifPrefs) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    saveNotifPrefs(next);
  };

  /* ── Language toggle ── */
  const handleLanguage = (lang: string) => {
    setLanguage(lang);
  };

  /* ── Inline password change ── */
  const handleInlinePasswordChange = async () => {
    if (!student?.email) return;
    setPwError('');
    if (!currentPassword) {
      setPwError(isHi ? 'वर्तमान पासवर्ड दर्ज करें' : 'Enter current password');
      return;
    }
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      setPwError(pwCheck.error);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError(isHi ? 'पासवर्ड मेल नहीं खा रहे' : 'Passwords do not match');
      return;
    }

    setPwLoading(true);
    // Step 1: Verify current password
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: student.email,
      password: currentPassword,
    });
    if (signInErr) {
      setPwError(isHi ? 'वर्तमान पासवर्ड गलत है' : 'Current password is incorrect');
      setPwLoading(false);
      return;
    }
    // Step 2: Update to new password
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) {
      setPwError(updateErr.message);
      setPwLoading(false);
      return;
    }
    // Step 3: Success — sign out and redirect
    setPwLoading(false);
    showToast(isHi ? 'पासवर्ड अपडेट हो गया! लॉगिन पर जा रहे हैं...' : 'Password updated! Redirecting to login...', true);
    await supabase.auth.signOut();
    setTimeout(() => router.replace('/login'), 2000);
  };

  /* ── Forgot password (email link fallback) ── */
  const handleForgotPassword = async () => {
    if (!student?.email) return;
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(student.email, {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?type=recovery`,
      });
      if (error) throw error;
      showToast(
        isHi
          ? 'पासवर्ड रीसेट लिंक आपके email पर भेजा गया।'
          : 'Password reset link sent to your email.',
        true,
      );
    } catch {
      showToast(
        isHi ? 'कुछ गलत हुआ। फिर से कोशिश करें।' : 'Something went wrong. Please try again.',
        false,
      );
    } finally {
      setPwLoading(false);
    }
  };

  /* ── Sign out ── */
  const handleSignOut = async () => {
    setSignOutLoading(true);
    try {
      await signOut();
      router.replace('/');
    } catch {
      showToast(
        isHi ? 'Sign out नहीं हो सका। फिर कोशिश करें।' : 'Sign out failed. Please try again.',
        false,
      );
      setSignOutLoading(false);
    }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  /* ── Avatar initials ── */
  const initials = (student.name ?? 'S')
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="mesh-bg min-h-dvh pb-12">
      {/* ─── Header ─── */}
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label={isHi ? 'वापस' : 'Back'}
            className="text-[var(--text-3)] text-lg leading-none p-1 -ml-1"
          >
            ←
          </button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'सेटिंग्स' : 'Settings'}
          </h1>
        </div>
      </header>

      {/* ─── Toast notification ─── */}
      {toast && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-xs w-[90vw] px-4 py-3 rounded-2xl text-sm font-medium shadow-lg text-white text-center transition-all"
          style={{ background: toast.ok ? '#16A34A' : '#DC2626' }}
          role="status"
        >
          {toast.msg}
        </div>
      )}

      <main className="app-container py-6 max-w-md mx-auto space-y-5">
        {/* ════════════════════════════════════════
            SECTION 1 — Profile Summary
            ════════════════════════════════════════ */}
        <div
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
        >
          {/* Avatar circle */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0 select-none"
            style={{ background: 'linear-gradient(135deg, var(--orange, #E8581C), var(--purple, #7C3AED))' }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-base font-bold truncate"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
            >
              {student.name}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'कक्षा' : 'Grade'} {student.grade}
              {student.board ? ` · ${student.board}` : ''}
            </div>
            <Link
              href="/onboarding"
              className="text-xs font-semibold mt-1.5 inline-block"
              style={{ color: 'var(--orange, #E8581C)' }}
            >
              {isHi ? 'प्रोफ़ाइल संपादित करें →' : 'Edit profile →'}
            </Link>
          </div>
        </div>

        {/* ════════════════════════════════════════
            SECTION 2 — Language
            ════════════════════════════════════════ */}
        <SettingsSection title={isHi ? 'भाषा / Language' : 'Language'}>
          <SettingsRow
            label="English"
            right={
              language === 'en' ? (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--orange, #E8581C)', color: '#fff' }}
                >
                  {isHi ? 'चुना गया' : 'Selected'}
                </span>
              ) : null
            }
            onClick={() => handleLanguage('en')}
          />
          <SettingsRow
            label="हिंदी"
            right={
              language === 'hi' ? (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--orange, #E8581C)', color: '#fff' }}
                >
                  चुना गया
                </span>
              ) : null
            }
            onClick={() => handleLanguage('hi')}
          />
        </SettingsSection>

        {/* ════════════════════════════════════════
            SECTION 3 — Notifications
            ════════════════════════════════════════ */}
        <SettingsSection title={isHi ? 'सूचनाएँ' : 'Notifications'}>
          <SettingsRow
            label={isHi ? 'दैनिक क्विज़ रिमाइंडर' : 'Daily quiz reminder'}
            sublabel={
              isHi
                ? 'हर दिन क्विज़ के लिए याद दिलाएं'
                : 'Remind me to take a quiz each day'
            }
            right={
              <ToggleSwitch
                checked={notifPrefs.daily_quiz_reminder}
                onChange={() => toggleNotif('daily_quiz_reminder')}
                label={isHi ? 'दैनिक क्विज़ रिमाइंडर' : 'Daily quiz reminder'}
              />
            }
          />
          <SettingsRow
            label={isHi ? 'स्ट्रीक अलर्ट' : 'Streak alerts'}
            sublabel={
              isHi
                ? 'स्ट्रीक टूटने से पहले सूचना पाएं'
                : 'Get notified before your streak breaks'
            }
            right={
              <ToggleSwitch
                checked={notifPrefs.streak_alerts}
                onChange={() => toggleNotif('streak_alerts')}
                label={isHi ? 'स्ट्रीक अलर्ट' : 'Streak alerts'}
              />
            }
          />
          <SettingsRow
            label={isHi ? 'साप्ताहिक प्रगति रिपोर्ट' : 'Weekly progress report'}
            sublabel={
              isHi
                ? 'हर हफ्ते की पढ़ाई का सारांश'
                : 'Summary of your weekly learning'
            }
            right={
              <ToggleSwitch
                checked={notifPrefs.weekly_progress_report}
                onChange={() => toggleNotif('weekly_progress_report')}
                label={isHi ? 'साप्ताहिक प्रगति रिपोर्ट' : 'Weekly progress report'}
              />
            }
          />
        </SettingsSection>

        {/* ════════════════════════════════════════
            SECTION 4 — Account
            ════════════════════════════════════════ */}
        <SettingsSection title={isHi ? 'खाता' : 'Account'}>
          <SettingsRow
            label={isHi ? 'पासवर्ड बदलें' : 'Change Password'}
            sublabel={isHi ? 'वर्तमान पासवर्ड से सत्यापित करें' : 'Verify with your current password'}
            right={
              <span className="text-[var(--text-3)] text-sm" aria-hidden="true">
                {showPwForm ? '↑' : '→'}
              </span>
            }
            onClick={() => { setShowPwForm(!showPwForm); setPwError(''); }}
          />
          {showPwForm && (
            <div className="px-4 py-3 space-y-3" style={{ background: 'var(--surface-2, #f9fafb)' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPwFields ? 'text' : 'password'}
                  placeholder={isHi ? 'वर्तमान पासवर्ड' : 'Current password'}
                  aria-label={isHi ? 'वर्तमान पासवर्ड' : 'Current password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2"
                  style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface-1, #fff)' }}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPwFields ? 'text' : 'password'}
                  placeholder={isHi ? `नया पासवर्ड (कम से कम ${PASSWORD_MIN_LENGTH} अक्षर)` : `New password (min ${PASSWORD_MIN_LENGTH} chars)`}
                  aria-label={isHi ? 'नया पासवर्ड' : 'New password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2"
                  style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface-1, #fff)' }}
                />
              </div>
              <input
                type={showPwFields ? 'text' : 'password'}
                placeholder={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                aria-label={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInlinePasswordChange()}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2"
                style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface-1, #fff)' }}
              />
              {/* Password strength indicator */}
              {newPassword && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[1, 2, 3, 4].map(i => {
                    const hasLower = /[a-z]/.test(newPassword);
                    const hasUpper = /[A-Z]/.test(newPassword);
                    const hasDigit = /\d/.test(newPassword);
                    const score = (newPassword.length >= PASSWORD_MIN_LENGTH ? 1 : 0) + (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0);
                    return (
                      <div
                        key={i}
                        style={{
                          flex: 1, height: 4, borderRadius: 2,
                          background: i <= score
                            ? score === 4 ? '#16A34A' : score >= 3 ? '#F5A623' : '#DC2626'
                            : 'var(--surface-2, #e5e7eb)',
                          transition: 'background 0.3s',
                        }}
                      />
                    );
                  })}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4, whiteSpace: 'nowrap' }}>
                    {newPassword.length < PASSWORD_MIN_LENGTH
                      ? (isHi ? 'बहुत छोटा' : 'Too short')
                      : validatePassword(newPassword).valid
                        ? (isHi ? 'मज़बूत' : 'Strong')
                        : (isHi ? 'अधिक विविधता चाहिए' : 'Needs more variety')}
                  </span>
                </div>
              )}
              {/* Show/hide toggle */}
              <button
                onClick={() => setShowPwFields(!showPwFields)}
                className="text-xs font-medium"
                style={{ color: 'var(--text-3)' }}
                type="button"
              >
                {showPwFields ? (isHi ? 'पासवर्ड छिपाएँ' : 'Hide passwords') : (isHi ? 'पासवर्ड दिखाएँ' : 'Show passwords')}
              </button>
              {pwError && <p style={{ color: '#DC2626', fontSize: 13 }} role="alert">{pwError}</p>}
              <button
                onClick={handleInlinePasswordChange}
                disabled={pwLoading || !currentPassword || !newPassword || !confirmNewPassword}
                className="w-full rounded-lg py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--orange, #E8581C)' }}
              >
                {pwLoading
                  ? (isHi ? 'अपडेट हो रहा है…' : 'Updating…')
                  : (isHi ? 'पासवर्ड अपडेट करें' : 'Update Password')}
              </button>
              {/* Forgot password fallback */}
              <button
                onClick={handleForgotPassword}
                disabled={pwLoading}
                className="w-full text-xs font-medium py-1"
                style={{ color: 'var(--text-3)' }}
                type="button"
              >
                {isHi ? 'पासवर्ड भूल गए? रीसेट लिंक भेजें' : 'Forgot your password? Send reset link'}
              </button>
            </div>
          )}
          <SettingsRow
            label={isHi ? 'खाता हटाएं' : 'Delete Account'}
            sublabel={isHi ? 'स्थायी रूप से डेटा मिटाएं' : 'Permanently erase your data'}
            right={
              <Link
                href="/settings/account/delete"
                className="text-[var(--text-3)] text-sm"
                aria-label={isHi ? 'खाता हटाएं' : 'Delete account'}
              >
                →
              </Link>
            }
          />
          <SettingsRow
            label={signOutLoading ? (isHi ? 'Sign out हो रहा है…' : 'Signing out…') : (isHi ? 'Sign Out' : 'Sign Out')}
            danger
            right={
              <span className="text-[#DC2626] text-sm" aria-hidden="true">
                →
              </span>
            }
            onClick={signOutLoading ? undefined : handleSignOut}
          />
        </SettingsSection>

        {/* ════════════════════════════════════════
            SECTION 5 — App Info
            ════════════════════════════════════════ */}
        <SettingsSection title={isHi ? 'ऐप जानकारी' : 'App Info'}>
          <SettingsRow
            label={isHi ? 'ऐप संस्करण' : 'App Version'}
            right={
              <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                v2.0 — Alfa OS
              </span>
            }
          />
          <SettingsRow
            label={isHi ? 'सहायता से संपर्क करें' : 'Contact Support'}
            sublabel={isHi ? 'सवाल? हम मदद करेंगे।' : 'Have a question? We are here.'}
            right={
              <Link
                href="/help"
                className="text-[var(--text-3)] text-sm"
                aria-label={isHi ? 'सहायता से संपर्क करें' : 'Contact support'}
              >
                →
              </Link>
            }
          />
        </SettingsSection>

        {/* Bottom breathing room */}
        <div className="h-4" />
      </main>
    </div>
  );
}
