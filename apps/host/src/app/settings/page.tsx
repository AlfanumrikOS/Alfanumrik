'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
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
        background: checked ? 'var(--orange, #F97316)' : 'var(--surface-2, #e5e7eb)',
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

  /* ── Password reset ── */
  const handleChangePassword = async () => {
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
            style={{ background: 'linear-gradient(135deg, var(--orange, #F97316), var(--purple, #7C3AED))' }}
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
              style={{ color: 'var(--orange, #F97316)' }}
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
                  style={{ background: 'var(--orange, #F97316)', color: '#fff' }}
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
                  style={{ background: 'var(--orange, #F97316)', color: '#fff' }}
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
            label={pwLoading ? (isHi ? 'भेजा जा रहा है…' : 'Sending…') : (isHi ? 'पासवर्ड बदलें' : 'Change Password')}
            sublabel={isHi ? 'रीसेट लिंक email पर भेजा जाएगा' : 'A reset link will be sent to your email'}
            right={
              <span className="text-[var(--text-3)] text-sm" aria-hidden="true">
                →
              </span>
            }
            onClick={pwLoading ? undefined : handleChangePassword}
          />
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
