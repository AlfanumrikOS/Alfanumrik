'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase, getFeatureFlags } from '@alfanumrik/lib/supabase';
import { getLevelFromScore } from '@alfanumrik/lib/score-config';
import { useRealtimeRevalidator } from '@alfanumrik/lib/hooks/useRealtimeRevalidator';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { REALTIME_FLAGS, CONSUMER_MINIMALISM_FLAGS } from '@alfanumrik/lib/feature-flags';
import {
  type ParentSession,
  type StudentSession,
  storeParentSession,
  loadParentSession,
  clearParentSession,
  recordFailedAttempt,
  clearLockoutAttempts,
  isLockedOut,
} from './_components/parent-session';
import {
  readParentChildId,
  replaceParentChildId,
  resolveLinkedChild,
} from './_components/parent-child-scope';

// Parent Glance Home — the sole parent UI (legacy 8-tab dashboard removed).
// Lazy-loaded to keep the first-paint bundle tight.
const ParentGlanceHome = dynamic(() => import('@alfanumrik/ui/parent/ParentGlanceHome'), { ssr: false });
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import ParentV3PageGate from './_components/ParentV3PageGate';
import { ParentV3Home } from './_components/ParentV3Views';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

const PARENT_REQUEST_TIMEOUT_MS = 15_000;

async function withParentRequestTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('parent.request_timeout')), PARENT_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ============================================================
// INTERFACES
// ============================================================

interface DashboardStats {
  xp: number;
  streak: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
  totalChats: number;
  avgScore: number;
}

interface WeeklyDay {
  quizzes: number;
  active: boolean;
  label: string;
}

interface WeekSummary {
  quizzes: number;
  avgScore: number;
  activeDays: number;
}

interface BktMastery {
  levels: Record<string, number>;
  total: number;
}

interface ActiveBurst {
  type: string;
  title: string;
  progress: number;
  goal: number;
  xp: number;
}

interface ParentTip {
  id: string;
  title: string;
  description: string;
}

interface DashboardData {
  error?: string;
  student?: { name: string; grade: string };
  subject?: string;
  stats: DashboardStats;
  dailyActivity?: WeeklyDay[];
  weekSummary?: WeekSummary;
  bktMastery?: BktMastery;
  activeBursts?: ActiveBurst[];
  insights?: string[];
}

async function api(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('parent-portal', {
    body: { action, ...params },
  });
  if (error) {
    throw new Error(`API error: ${error.message || 'Unknown error'}`);
  }
  return data;
}

// ============================================================
// PARENT LOGIN SCREEN
// ============================================================
// Brute-force protection helpers (recordFailedAttempt, clearLockoutAttempts,
// isLockedOut) are imported from ./_components/parent-session so they can
// be reused and tested independently. Progressive lockout: 3 -> 5 -> 15 -> 60 min.

function LoginScreen({ onLogin, isHi, authUserId, prefillName }: { onLogin: (g: ParentSession, s: StudentSession) => void; isHi: boolean; authUserId?: string | null; prefillName?: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(prefillName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // When true, the parent has no Supabase session, so the parent-portal Edge
  // Function (JWT-required since PR #591) will reject the link-code login. We
  // surface an account-creation CTA instead of a dead "Connection error".
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // Consent gate (PP-1/3 Option B): when parent_login creates a fresh/pending
  // guardian↔child link, the Edge function returns { status: 'pending_approval',
  // student.name } with NO session. We hold that here to show a "waiting for
  // your child to approve" screen instead of routing into the dashboard.
  const [pendingApproval, setPendingApproval] = useState<{ childName?: string } | null>(null);

  const submit = async () => {
    if (!code.trim()) { setError(t(isHi, 'Please enter link code', 'कृपया लिंक कोड दर्ज करें')); return; }

    // Check lockout before attempting
    const lockout = isLockedOut();
    if (lockout.locked) { setError(lockout.message); return; }

    // P15: the parent-portal Edge Function requires a Supabase Bearer JWT on
    // EVERY action (PR #591 P13 hardening) — including parent_login. A parent
    // with no Supabase session (authUserId is null) cannot complete a link-code
    // login and, even if they could, every dashboard fetch would 401. Route
    // them to create/sign into an account up-front (which mints the JWT) rather
    // than letting the request fail with an opaque "Connection error". The
    // guardian↔child boundary is unchanged: once signed in, the parent-portal
    // link check (guardian_student_links keyed by the JWT-derived guardian_id)
    // governs access exactly as today.
    if (!authUserId) {
      setNeedsSignIn(true);
      setError('');
      return;
    }

    setLoading(true); setError('');
    try {
      // Pass auth_user_id explicitly so the edge function can find the existing
      // guardian profile from Supabase auth signup — eliminates orphan guardians
      // even if the Authorization header token extraction fails.
      const res = await api('parent_login', { link_code: code, parent_name: name || 'Parent', auth_user_id: authUserId || null });
      setLoading(false);
      if (res.error) {
        // Record failed attempt for lockout
        const lockMsg = recordFailedAttempt();
        setError(lockMsg || res.error);
        return;
      }
      // Consent gate: a fresh/pending link returns a pending signal (HTTP 200,
      // no session). Do NOT store a session or route to the dashboard — show the
      // waiting screen and let the child approve first (P8/P13).
      if (res.status === 'pending_approval') {
        clearLockoutAttempts();
        setPendingApproval({ childName: res.student_name });
        return;
      }
      // Success (status 'approved' / already-linked re-submit, or legacy shape)
      // — clear lockout state and proceed to the dashboard as before.
      clearLockoutAttempts();
      await storeParentSession(res.guardian, res.student);
      onLogin(res.guardian, res.student);
    } catch (err) {
      setLoading(false);
      const lockMsg = recordFailedAttempt();
      setError(lockMsg || 'Connection error. Please try again.');
    }
  };

  // Consent gate: the link request was created but the child has not approved
  // yet. Explain what happens next and offer a "Check again" that re-runs the
  // (idempotent) parent_login — once the child approves, it returns 'approved'
  // and the fall-through above routes into the dashboard. No data is shown here
  // because no approved link exists yet (P13).
  if (pendingApproval) {
    const childName = pendingApproval.childName || t(isHi, 'your child', 'आपके बच्चे');
    return (
      <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh flex items-center justify-center">
        <div className="max-w-[400px] w-full text-center">
          <div className="text-5xl mb-3">&#x23F3;</div>
          <h1 className="text-[22px] font-bold text-gray-900 mb-2">
            {t(isHi, `Request sent to ${childName}`, `${childName} को अनुरोध भेजा गया`)}
          </h1>
          <p className="text-sm text-gray-600 mb-1 leading-relaxed">
            {t(
              isHi,
              'Ask your child to open Alfanumrik and approve your request. Once they approve, your dashboard unlocks automatically.',
              'अपने बच्चे से Alfanumrik खोलकर आपके अनुरोध को स्वीकार करने को कहें। स्वीकार करते ही आपका डैशबोर्ड अपने आप खुल जाएगा।',
            )}
          </p>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            {t(
              isHi,
              'They will see your request on their dashboard and in their notifications.',
              'उन्हें आपका अनुरोध उनके डैशबोर्ड और सूचनाओं में दिखेगा।',
            )}
          </p>
          <button
            onClick={submit}
            disabled={loading}
            className={`w-full px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer mb-3 ${loading ? 'opacity-50' : 'opacity-100'}`}
          >
            {loading ? t(isHi, 'Checking...', 'जाँच हो रही है...') : t(isHi, 'Check again', 'फिर से जाँचें')}
          </button>
          <button
            onClick={() => { setPendingApproval(null); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline bg-transparent border-none cursor-pointer"
          >
            {t(isHi, 'Back', 'वापस')}
          </button>
        </div>
      </div>
    );
  }

  // No Supabase session → show the account path. We preserve the entered link
  // code through sign-in via a returnTo back to /parent so the parent can
  // finish linking after authenticating.
  if (needsSignIn) {
    return (
      <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh flex items-center justify-center">
        <div className="max-w-[400px] w-full text-center">
          <div className="text-5xl mb-3">&#x1F510;</div>
          <h1 className="text-[22px] font-bold text-gray-900 mb-2">
            {t(isHi, 'Create a parent account', 'अभिभावक अकाउंट बनाएँ')}
          </h1>
          <p className="text-sm text-gray-600 mb-1 leading-relaxed">
            {t(
              isHi,
              "To view your child's progress securely, create a free parent account or sign in. It only takes a minute.",
              'अपने बच्चे की प्रगति सुरक्षित रूप से देखने के लिए एक मुफ़्त अभिभावक अकाउंट बनाएँ या साइन इन करें। इसमें बस एक मिनट लगता है।',
            )}
          </p>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            {t(
              isHi,
              'After signing in, enter your link code once to connect to your child.',
              'साइन इन करने के बाद, अपने बच्चे से जुड़ने के लिए एक बार अपना लिंक कोड दर्ज करें।',
            )}
          </p>
          <button
            onClick={() => { window.location.href = '/login?role=parent&redirectTo=/parent'; }}
            className="w-full px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer mb-3"
          >
            {t(isHi, 'Create / sign in to account', 'अकाउंट बनाएँ / साइन इन करें')}
          </button>
          <button
            onClick={() => { setNeedsSignIn(false); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline bg-transparent border-none cursor-pointer"
          >
            {t(isHi, 'Back', 'वापस')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh flex items-center justify-center">
      <div className="max-w-[380px] w-full text-center">
        <div className="text-5xl mb-3">&#x1F9D1;&#x200D;&#x1F393;</div>
        <h1 className="text-[22px] font-bold text-gray-900 mb-1">{t(isHi, 'Parent Dashboard', 'अभिभावक डैशबोर्ड')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t(isHi, "Enter your child's link code to view their progress", 'अपने बच्चे की प्रगति देखने के लिए लिंक कोड दर्ज करें')}</p>
        {prefillName ? (
          <p className="text-sm text-gray-700 mb-3 font-medium">
            {t(isHi, `Welcome, ${prefillName}!`, `स्वागत है, ${prefillName}!`)} {t(isHi, "Enter your child's link code to continue.", 'जारी रखने के लिए अपने बच्चे का लिंक कोड दर्ज करें।')}
          </p>
        ) : (
          <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-[15px] outline-none mb-2.5 box-border" placeholder={t(isHi, 'Your name', 'आपका नाम')} value={name} onChange={e => setName(e.target.value)} aria-label={t(isHi, 'Your name', 'आपका नाम')} autoComplete="name" />
        )}
        <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-xl outline-none mb-2.5 box-border tracking-[4px] text-center uppercase" placeholder={t(isHi, 'LINK CODE', 'लिंक कोड')} value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} onKeyDown={e => e.key === 'Enter' && submit()} aria-label={t(isHi, 'Child link code', 'बच्चे का लिंक कोड')} />
        {error && <p className="text-red-500 text-[13px] my-2">{error}</p>}
        <button onClick={submit} disabled={loading} className={`w-full mt-2 px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer ${loading ? 'opacity-50' : 'opacity-100'}`}>
          {loading ? t(isHi, 'Connecting...', 'कनेक्ट हो रहा है...') : t(isHi, 'View Dashboard', 'डैशबोर्ड देखें')}
        </button>
        <p className="text-xs text-gray-500 mt-4">
          {t(isHi, "Ask your child for the link code from their Alfanumrik profile.", 'अपने बच्चे से उनकी Alfanumrik प्रोफ़ाइल से लिंक कोड मांगें।')}
        </p>
        <p className="text-xs text-gray-400 mt-3">
          {t(isHi, 'Student or Teacher?', 'छात्र या शिक्षक?')}{' '}
          <a href="/login?switch=true" className="text-orange-500 font-medium hover:underline">
            {t(isHi, 'Login here \u2192', 'यहाँ लॉगिन करें \u2192')}
          </a>
        </p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = '/login';
          }}
          className="text-xs text-gray-400 mt-2 hover:text-gray-600 underline bg-transparent border-none cursor-pointer"
        >
          {t(isHi, 'Sign out & switch account', 'साइन आउट करें और अकाउंट बदलें')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// LINK-CODE SIGN-IN GATE (P15 dead-end fix)
// ============================================================
// Shown when a parent is in link-code mode (HMAC sessionStorage session, NO
// Supabase JWT). The parent-portal Edge Function requires a Bearer JWT on every
// action since the PR #591 P13 hardening, so a link-code parent's dashboard
// would 401 on every fetch. Instead of a broken/erroring dashboard, we surface a
// clear bilingual path to create or sign into a real account — which mints a
// JWT, makes them a guardian-mode parent, and unlocks the dashboard with the
// exact same guardian↔child boundary enforced server-side.
function LinkCodeSignInGate({ isHi, childName }: { isHi: boolean; childName: string }) {
  const goSignIn = () => { window.location.href = '/login?role=parent&redirectTo=/parent'; };
  const switchAccount = () => { clearParentSession(); window.location.reload(); };
  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh flex items-center justify-center">
      <div className="max-w-[400px] w-full text-center">
        <div className="text-5xl mb-3">&#x1F510;</div>
        <h1 className="text-[22px] font-bold text-gray-900 mb-2">
          {t(isHi, 'Sign in to view progress', 'प्रगति देखने के लिए साइन इन करें')}
        </h1>
        <p className="text-sm text-gray-600 mb-1 leading-relaxed">
          {t(
            isHi,
            `Create a free parent account to see ${childName}'s full dashboard, reports and weekly progress.`,
            `${childName} का पूरा डैशबोर्ड, रिपोर्ट और साप्ताहिक प्रगति देखने के लिए एक मुफ़्त अभिभावक अकाउंट बनाएँ।`,
          )}
        </p>
        <p className="text-xs text-gray-400 mb-6 leading-relaxed">
          {t(
            isHi,
            'Your child link is already saved — sign in once and it stays connected.',
            'आपका बच्चे का लिंक पहले ही सहेजा गया है — एक बार साइन इन करें और यह जुड़ा रहेगा।',
          )}
        </p>
        <button
          onClick={goSignIn}
          className="w-full px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer mb-3"
        >
          {t(isHi, 'Create / sign in to account', 'अकाउंट बनाएँ / साइन इन करें')}
        </button>
        <button
          onClick={switchAccount}
          className="text-xs text-gray-400 hover:text-gray-600 underline bg-transparent border-none cursor-pointer"
        >
          {t(isHi, 'Use a different link code', 'दूसरा लिंक कोड इस्तेमाल करें')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// STAT CARD
// ============================================================
// Avatar gradient pairs for the multi-child pill selector
const avatarGradientsDash = [
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#DB2777'],
  ['#8B5CF6', '#7C3AED'],
  ['#06B6D4', '#0891B2'],
  ['#F97316', '#EA580C'],
  ['#10B981', '#059669'],
];

function ChildSelectorPills({
  studentList,
  selectedIdx,
  onSelect,
}: {
  studentList: StudentSession[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  if (studentList.length <= 1) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      paddingBottom: 4,
      marginBottom: 16,
      scrollbarWidth: 'none',
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>
      <style>{`.child-pills::-webkit-scrollbar{display:none}`}</style>
      {studentList.map((child, idx) => {
        const selected = idx === selectedIdx;
        const [from, to] = avatarGradientsDash[child.name.charCodeAt(0) % avatarGradientsDash.length];
        return (
          <button
            key={child.id}
            onClick={() => onSelect(idx)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px 8px 8px',
              borderRadius: 24,
              border: selected ? 'none' : '1px solid #FDBA7444',
              backgroundColor: selected ? '#F97316' : '#FFFFFF',
              color: selected ? '#FFFFFF' : '#475569',
              fontSize: 13,
              fontWeight: selected ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              boxShadow: selected ? '0 2px 8px #F9731640' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {/* Avatar circle */}
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${from}, ${to})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}>
              {child.name.charAt(0).toUpperCase()}
            </div>
            {child.name.split(' ')[0]}
            {/* Grade badge */}
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              backgroundColor: selected ? 'rgba(255,255,255,0.25)' : '#FDBA7433',
              color: selected ? '#fff' : '#F97316',
              borderRadius: 8,
              padding: '1px 6px',
            }}>
              {t(false, 'G', 'क')}{child.grade}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
/** Performance score row from the performance_scores table */
interface PerfScoreRow {
  subject: string;
  overall_score: number;
  level_name: string;
}

function Dashboard({ guardian, initialStudent, allChildren, isHi, canFetchMessages }: { guardian: ParentSession; initialStudent: StudentSession; allChildren: StudentSession[]; isHi: boolean; canFetchMessages: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedChildId = readParentChildId(searchParams);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [perfScores, setPerfScores] = useState<PerfScoreRow[]>([]);
  const [labStreak, setLabStreak] = useState<number | null>(null);
  const loadSequence = useRef(0);

  // Derive current student from selectedChildIdx
  const children = useMemo(
    () => (allChildren.length > 0 ? allChildren : [initialStudent]),
    [allChildren, initialStudent],
  );
  const student = children[selectedChildIdx] ?? initialStudent;

  // Treat childId as a hint only. Resolve it against the guardian-scoped child
  // list before it can influence a data request; replace unknown ids with the
  // verified primary child.
  useEffect(() => {
    const scopedChild = resolveLinkedChild(children, requestedChildId, initialStudent.id);
    if (!scopedChild) return;
    const nextIndex = children.findIndex((child) => child.id === scopedChild.id);
    if (nextIndex >= 0 && nextIndex !== selectedChildIdx) {
      setDash(null);
      setPerfScores([]);
      setLabStreak(null);
      setSelectedChildIdx(nextIndex);
    }
    if (requestedChildId !== scopedChild.id) {
      router.replace(replaceParentChildId('/parent', searchParams, scopedChild.id));
    }
  }, [children, initialStudent.id, requestedChildId, router, searchParams, selectedChildIdx]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await withParentRequestTimeout(
        api('get_child_dashboard', { student_id: student.id, guardian_id: guardian.id }),
      );
      if (sequence !== loadSequence.current) return;
      if (!d || d.error) {
        setDash(null);
        setLoadError(t(
          isHi,
          `We couldn't load ${student.name}'s progress. Please try again.`,
          `${student.name} की प्रगति लोड नहीं हो सकी। कृपया फिर से कोशिश करें।`,
        ));
        return;
      }
      setDash(d);
    } catch {
      if (sequence !== loadSequence.current) return;
      setDash(null);
      setLoadError(t(
        isHi,
        `We couldn't load ${student.name}'s progress. Please try again.`,
        `${student.name} की प्रगति लोड नहीं हो सकी। कृपया फिर से कोशिश करें।`,
      ));
      return;
    } finally {
      // The primary dashboard request owns the full-page loading state. The
      // additive score/streak reads below must never keep the page spinning.
      if (sequence === loadSequence.current) setLoading(false);
    }

    // Fetch Performance Scores for this child (RLS handles parent access via guardian_student_links)
    try {
      const { data: psData } = await supabase
        .from('performance_scores')
        .select('subject, overall_score, level_name')
        .eq('student_id', student.id);
      if (sequence !== loadSequence.current) return;
      if (psData && psData.length > 0) {
        setPerfScores(psData.map((r: Record<string, unknown>) => ({
          subject: String(r.subject || ''),
          overall_score: Number(r.overall_score ?? 0),
          level_name: String(r.level_name || getLevelFromScore(Number(r.overall_score ?? 0))),
        })));
      } else {
        setPerfScores([]);
      }
    } catch {
      setPerfScores([]);
    }

    // Fetch STEM lab streak (RLS handles parent access via student_lab_streaks_guardian_select)
    try {
      const { data: streakRow } = await supabase
        .from('student_lab_streaks')
        .select('current_streak')
        .eq('student_id', student.id)
        .maybeSingle();
      if (sequence !== loadSequence.current) return;
      setLabStreak(streakRow ? Number(streakRow.current_streak ?? 0) : 0);
    } catch {
      setLabStreak(null);
    }
  }, [student.id, student.name, guardian.id, isHi]);

  useEffect(() => { load(); }, [load]);

  // Phase C.6 — realtime child-progress revalidation (default OFF via flag).
  // Subscribe to student_learning_profiles UPDATE filtered by the children
  // this parent is linked to. Debounced 5s — parents don't need sub-second
  // granularity, and after a child finishes a quiz several rows may update
  // in quick succession (one per subject). The 5s debounce coalesces them
  // into a single refetch.
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'parent' });
        if (!cancelled) setRealtimeEnabled(Boolean(flags[REALTIME_FLAGS.SUBSCRIPTIONS_V1]));
      } catch {
        if (!cancelled) setRealtimeEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const childIdsKey = children.map((c) => c.id).filter(Boolean).join(',');
  useRealtimeRevalidator({
    enabled: realtimeEnabled && childIdsKey.length > 0,
    channel: `parent-children-${guardian.id}`,
    table: 'student_learning_profiles',
    event: 'UPDATE',
    filter: childIdsKey ? `student_id=in.(${childIdsKey})` : null,
    debounceMs: 5000,
    onChange: load,
  });

  // Bug fix (2026-04-29 IST timezone): refetch when the tab regains focus or
  // becomes visible. Without this, a parent who opens the dashboard once in
  // the morning and returns hours later sees stale "today" stats — the chart
  // still shows the previous IST day as the rightmost cell because no
  // re-fetch was triggered.
  useEffect(() => {
    const onFocus = () => { load(); };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        load();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [load]);

  const logout = () => { clearParentSession(); window.location.reload(); };

  if (loading && !dash) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh">
      <div className="text-center py-20 text-gray-500">
        <div className="w-10 h-10 border-[3px] border-orange-200 border-t-orange-500 rounded-full mx-auto mb-4 animate-spin" />
        {t(isHi, `Loading ${student.name}'s progress...`, `${student.name} की प्रगति लोड हो रही है...`)}
      </div>
    </div>
  );

  if (loadError || !dash) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh">
      <ChildSelectorPills
        studentList={children}
        selectedIdx={selectedChildIdx}
        onSelect={(idx) => {
          const nextChild = children[idx];
          if (nextChild) router.replace(replaceParentChildId('/parent', searchParams, nextChild.id));
        }}
      />
      <div className="text-center py-[60px] text-red-600" role="alert">
        <p>{loadError || t(isHi, 'Failed to load dashboard', 'डैशबोर्ड लोड करने में विफल')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 min-h-[44px] rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white"
        >
          {t(isHi, 'Try again', 'फिर से कोशिश करें')}
        </button>
      </div>
    </div>
  );

  if (!dash || dash.error) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh">
      <div className="text-center py-[60px] text-red-500">{dash?.error || t(isHi, 'Failed to load dashboard', 'डैशबोर्ड लोड करने में विफल')}</div>
    </div>
  );

  const s = dash.stats;
  const childName = dash.student?.name || student.name;

    return (
      <div className="bg-[#FFF8F0] min-h-dvh">
        {children.length > 1 && (
          <div className="max-w-[600px] mx-auto px-4 pt-2">
            <ChildSelectorPills
              studentList={children}
              selectedIdx={selectedChildIdx}
              onSelect={(idx) => {
                if (idx === selectedChildIdx) return;
                const nextChild = children[idx];
                if (nextChild) router.replace(replaceParentChildId('/parent', searchParams, nextChild.id));
              }}
            />
          </div>
        )}
        <SectionErrorBoundary section="Parent Dashboard">
          <ParentGlanceHome
            stats={s}
            childName={childName}
            grade={dash.student?.grade || student.grade}
            subject={dash.subject}
            dailyActivity={dash.dailyActivity}
            weekSummary={dash.weekSummary}
            bktMastery={dash.bktMastery}
            insights={dash.insights}
            perfScores={perfScores}
            labStreak={labStreak}
            student={student}
            guardianId={guardian.id}
            canFetchReport={canFetchMessages}
            loading={loading}
            error={dash.error ?? null}
            onRefresh={load}
            onLogout={logout}
            isHi={isHi}
            t={t}
          />
        </SectionErrorBoundary>
      </div>
    );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
function ParentPageContent() {
  const auth = useAuth();
  const isHi = auth.isHi ?? false;
  const [guardian, setGuardian] = useState<ParentSession | null>(null);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [allChildren, setAllChildren] = useState<StudentSession[]>([]);
  const [checking, setChecking] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState(0);

  // D-authunify (ff_parent_unified_auth_v1, Wave D, Finding #5). When ON, the
  // Supabase guardian-JWT (auth.guardian) is the SINGLE source of truth for the
  // parent session — the HMAC sessionStorage cache (loadParentSession) is never
  // consulted. The real auth boundary is already server-side: the parent-portal
  // Edge Function requires a Bearer JWT on every action and /api/parent/report
  // uses authorizeRequest, so the HMAC payload was only ever a client cache.
  // When OFF (default), the existing dual path below is byte-identical.
  // Read via the same useFeatureFlags() SWR hook used for ff_parent_glance_v1.
  const { data: flags } = useFeatureFlags();
  const unifiedAuth = flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1] === true;

  // Fetch all children for this guardian so the multi-child selector works
  const fetchAllChildren = useCallback(async (guardianId: string, primaryStudent: StudentSession) => {
    try {
      const res = await withParentRequestTimeout(api('get_children', { guardian_id: guardianId }));
      if (res?.children && Array.isArray(res.children)) {
        const normalized: StudentSession[] = res.children.map((c: Record<string, unknown>) => ({
          id: String(c.id || ''),
          name: String(c.name || 'Child'),
          grade: String(c.grade || ''),
        }));
        setAllChildren(normalized.length > 0 ? normalized : [primaryStudent]);
      } else if (res?.students && Array.isArray(res.students)) {
        const normalized: StudentSession[] = res.students.map((c: Record<string, unknown>) => ({
          id: String(c.id || ''),
          name: String(c.name || 'Child'),
          grade: String(c.grade || ''),
        }));
        setAllChildren(normalized.length > 0 ? normalized : [primaryStudent]);
      } else {
        setAllChildren([primaryStudent]);
      }
    } catch {
      setAllChildren([primaryStudent]);
    }
  }, []);

  // D-authunify (flag ON only): resolve the parent session purely from the
  // guardian-JWT. The primary student is seeded from get_children (served by
  // the parent-portal Edge Function, which requires the Bearer JWT) instead of
  // the HMAC sessionStorage cache. No loadParentSession() call on this path.
  const resolveGuardianFromJwt = useCallback(async (g: ParentSession) => {
    setScopeError(null);
    try {
      const res = await withParentRequestTimeout(api('get_children', { guardian_id: g.id }));
      const raw = (res?.children ?? res?.students);
      const normalized: StudentSession[] = Array.isArray(raw)
        ? raw.map((c: Record<string, unknown>) => ({
            id: String(c.id || ''),
            name: String(c.name || 'Child'),
            grade: String(c.grade || ''),
          }))
        : [];
      setAllChildren(normalized);
      setStudent(normalized.length > 0 ? normalized[0] : null);
      if (normalized.length === 0) {
        setScopeError(t(isHi, 'No linked child was found.', 'कोई जुड़ा हुआ बच्चा नहीं मिला।'));
      }
    } catch {
      setAllChildren([]);
      setStudent(null);
      setScopeError(t(
        isHi,
        'Could not load linked children. Please try again.',
        'जुड़े हुए बच्चों को लोड नहीं किया जा सका। कृपया फिर से कोशिश करें।',
      ));
    }
  }, [isHi]);

  useEffect(() => {
    if (auth.isLoading) return;
    setChecking(true);
    setScopeError(null);

    // ── D-authunify ON: guardian-JWT is the single source of truth ──────────
    // No HMAC sessionStorage fallback. If there's no auth.guardian, leave
    // guardian/student null so the normal LoginScreen (unauthenticated state)
    // renders — we never silently revive a stale HMAC cache.
    if (unifiedAuth) {
      if (auth.guardian) {
        setGuardian(auth.guardian);
        resolveGuardianFromJwt(auth.guardian).then(() => setChecking(false));
      } else {
        setGuardian(null);
        setStudent(null);
        setChecking(false);
      }
      return;
    }

    // ── Flag OFF (default): existing dual path, byte-identical to today ──────
    // First check if user is logged in via Supabase with guardian role
    if (auth.guardian) {
      setGuardian(auth.guardian);
      // Student data will be fetched by the dashboard API; load from verified session if available
      loadParentSession().then(async session => {
        if (session) {
          setStudent(session.student);
          fetchAllChildren(auth.guardian!.id, session.student);
        } else {
          // An authenticated guardian must not be sent back to the login form
          // just because the optional link-code cache is absent.
          await resolveGuardianFromJwt(auth.guardian!);
        }
        setChecking(false);
      });
      return;
    }

    // Fallback: check sessionStorage for link-code-based login (HMAC-verified, expiry-checked)
    loadParentSession().then(session => {
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
        fetchAllChildren(session.guardian.id, session.student);
      }
      setChecking(false);
    });
  }, [auth.isLoading, auth.guardian, fetchAllChildren, unifiedAuth, resolveGuardianFromJwt, scopeAttempt]);

  if (checking || auth.isLoading) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh">
      <div className="text-center py-20 text-gray-500">Loading...</div>
    </div>
  );

  if (scopeError && guardian) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-dvh">
      <div className="mt-10 rounded-2xl border border-red-200 bg-white p-6 text-center text-red-700" role="alert">
        <p>{scopeError}</p>
        <button
          type="button"
          onClick={() => setScopeAttempt((attempt) => attempt + 1)}
          className="mt-4 min-h-[44px] rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white"
        >
          {t(isHi, 'Try again', 'फिर से कोशिश करें')}
        </button>
      </div>
    </div>
  );

  if (!guardian || !student) {
    // If guardian profile exists from signup, pre-fill name
    const prefillName = auth.guardian?.name || '';
    return <LoginScreen onLogin={(g, s) => { setGuardian(g); setStudent(s); fetchAllChildren(g.id, s); }} isHi={isHi} authUserId={auth.authUserId} prefillName={prefillName || undefined} />;
  }

  // ── Link-code-mode hard gate (P15 dead-end fix) ─────────────────────────
  // The parent home (AtlasParent / Dashboard) fetches all of its data through
  // the `parent-portal` Edge Function, which — since the PR #591 P13 hardening
  // — REQUIRES a Supabase Bearer JWT on every action (get_child_dashboard,
  // get_children, get_monthly_report, even parent_login). guardian-mode
  // parents have that JWT (supabase.functions.invoke auto-attaches it).
  // Link-code-mode parents authenticate via an HMAC sessionStorage payload and
  // have NO Supabase session, so every parent-portal call returns 401 and the
  // ENTIRE dashboard is dead for them.
  //
  // We detect link-code mode as "we resolved a guardian/student session but
  // there is no Supabase guardian (auth.guardian is null → no JWT)". Rather
  // than render a dashboard that will 401 on first paint, we route these
  // parents to create/sign into a real account (which mints a JWT and makes
  // them a guardian-mode parent). The cross-child boundary is unchanged: once
  // they sign in, the parent-portal link check (guardian_student_links keyed
  // by the JWT-derived guardian_id) governs access exactly as today.
  const isLinkCodeMode = !auth.guardian;
  if (isLinkCodeMode) {
    return <LinkCodeSignInGate isHi={isHi} childName={student.name} />;
  }

  // canFetchMessages: only guardian-mode parents (a real Supabase JWT) can hit
  // /api/parent/messages. Link-code parents have an anonymous HMAC session and
  // would 401 — the cosmic teacher-note card is gated off for them.
  const canFetchMessages = !!auth.guardian;
  return (
    <Dashboard
      guardian={guardian}
      initialStudent={student}
      allChildren={allChildren}
      isHi={isHi}
      canFetchMessages={canFetchMessages}
    />
  );
}

export default function ParentPage() {
  return <ParentV3PageGate legacy={<LegacyParentPage />} v3={<ParentV3Home />} />;
}

function LegacyParentPage() {
  return (
    <Suspense>
      <ParentPageContent />
    </Suspense>
  );
}
