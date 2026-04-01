'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

// ============================================================
// INTERFACES
// ============================================================
interface ParentSession {
  id: string;
  name: string;
}

interface StudentSession {
  id: string;
  name: string;
  grade: string;
}

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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Session expiry: 4 hours in milliseconds
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SESSION_KEY = 'alfanumrik_parent_session';

// ============================================================
// HMAC SESSION HELPERS
// Uses Web Crypto API — all processing is client-side only.
// The "secret" here is a per-session nonce stored alongside the
// payload, so the goal is tamper detection (integrity), not
// confidentiality. Data lives in sessionStorage (tab-scoped).
// ============================================================

async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function storeParentSession(guardian: Record<string, unknown>, student: Record<string, unknown>) {
  const nonce = crypto.randomUUID();
  const issuedAt = Date.now();
  // Only store non-sensitive identifying fields
  const safeGuardian = { id: guardian.id, name: guardian.name };
  const safeStudent = { id: student.id, name: student.name, grade: student.grade };
  const payload = JSON.stringify({ guardian: safeGuardian, student: safeStudent, issuedAt });
  const hmac = await hmacSign(payload, nonce);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ payload, hmac, nonce }));
}

async function loadParentSession(): Promise<{ guardian: ParentSession; student: StudentSession } | null> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { payload, hmac, nonce } = JSON.parse(raw);
    if (!payload || !hmac || !nonce) return null;

    // Verify integrity
    const expected = await hmacSign(payload, nonce);
    if (expected !== hmac) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    const { guardian, student, issuedAt } = JSON.parse(payload);

    // Check expiry
    if (Date.now() - issuedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return { guardian, student };
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function clearParentSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SB_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

// ============================================================
// PARENT LOGIN SCREEN
// ============================================================
// -- Brute-force protection for parent login --
// Tuition centers try to brute-force link codes to monitor students
// they don't own. Progressive lockout: 3 -> 5 -> 15 -> 60 min.
const LOCKOUT_KEY = 'alf_parent_lockout';
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 3;
const LOCKOUT_DURATIONS = [3 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]; // 3m, 5m, 15m, 1h

function getLockoutState(): { attempts: number; lockedUntil: number; lockoutLevel: number } {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { attempts: 0, lockedUntil: 0, lockoutLevel: 0 };
    return JSON.parse(raw);
  } catch { return { attempts: 0, lockedUntil: 0, lockoutLevel: 0 }; }
}

function recordFailedAttempt(): string | null {
  const state = getLockoutState();
  state.attempts++;
  if (state.attempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    const duration = LOCKOUT_DURATIONS[Math.min(state.lockoutLevel, LOCKOUT_DURATIONS.length - 1)];
    state.lockedUntil = Date.now() + duration;
    state.lockoutLevel++;
    state.attempts = 0;
    sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
    const minutes = Math.ceil(duration / 60_000);
    return `Too many failed attempts. Locked for ${minutes} minute${minutes > 1 ? 's' : ''}.`;
  }
  sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
  return null;
}

function clearLockoutAttempts() {
  sessionStorage.removeItem(LOCKOUT_KEY);
}

function isLockedOut(): { locked: boolean; message: string } {
  const state = getLockoutState();
  if (state.lockedUntil > Date.now()) {
    const remaining = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
    return { locked: true, message: `Account locked. Try again in ${remaining} minute${remaining > 1 ? 's' : ''}.` };
  }
  return { locked: false, message: '' };
}

function LoginScreen({ onLogin, isHi }: { onLogin: (g: ParentSession, s: StudentSession) => void; isHi: boolean }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!code.trim()) { setError(t(isHi, 'Please enter link code', 'कृपया लिंक कोड दर्ज करें')); return; }

    // Check lockout before attempting
    const lockout = isLockedOut();
    if (lockout.locked) { setError(lockout.message); return; }

    setLoading(true); setError('');
    try {
      const res = await api('parent_login', { link_code: code, parent_name: name || 'Parent' });
      setLoading(false);
      if (res.error) {
        // Record failed attempt for lockout
        const lockMsg = recordFailedAttempt();
        setError(lockMsg || res.error);
        return;
      }
      // Success — clear lockout state
      clearLockoutAttempts();
      await storeParentSession(res.guardian, res.student);
      onLogin(res.guardian, res.student);
    } catch (err) {
      setLoading(false);
      const lockMsg = recordFailedAttempt();
      setError(lockMsg || 'Connection error. Please try again.');
    }
  };

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen flex items-center justify-center">
      <div className="max-w-[380px] w-full text-center">
        <div className="text-5xl mb-3">&#x1F9D1;&#x200D;&#x1F393;</div>
        <h1 className="text-[22px] font-bold text-gray-900 mb-1">{t(isHi, 'Parent Dashboard', 'अभिभावक डैशबोर्ड')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t(isHi, "Enter your child's link code to view their progress", 'अपने बच्चे की प्रगति देखने के लिए लिंक कोड दर्ज करें')}</p>
        <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-[15px] outline-none mb-2.5 box-border" placeholder={t(isHi, 'Your name', 'आपका नाम')} value={name} onChange={e => setName(e.target.value)} aria-label={t(isHi, 'Your name', 'आपका नाम')} autoComplete="name" />
        <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-xl outline-none mb-2.5 box-border tracking-[4px] text-center uppercase" placeholder={t(isHi, 'LINK CODE', 'लिंक कोड')} value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} onKeyDown={e => e.key === 'Enter' && submit()} aria-label={t(isHi, 'Child link code', 'बच्चे का लिंक कोड')} />
        {error && <p className="text-red-500 text-[13px] my-2">{error}</p>}
        <button onClick={submit} disabled={loading} className={`w-full mt-2 px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer ${loading ? 'opacity-50' : 'opacity-100'}`}>
          {loading ? t(isHi, 'Connecting...', 'कनेक्ट हो रहा है...') : t(isHi, 'View Dashboard', 'डैशबोर्ड देखें')}
        </button>
        <p className="text-xs text-gray-500 mt-4">
          {t(isHi, "Ask your child for the link code from their Alfanumrik profile.", 'अपने बच्चे से उनकी Alfanumrik प्रोफ़ाइल से लिंक कोड मांगें।')}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// STAT CARD
// ============================================================
function Stat({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl px-3.5 py-3 border border-orange-200">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-gray-500 text-[11px] uppercase tracking-[0.5px]">{label}</span>
      </div>
      <span className="text-[22px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY CHART
// ============================================================
function WeeklyChart({ data }: { data: WeeklyDay[] }) {
  const maxQ = Math.max(...data.map(d => d.quizzes), 1);
  return (
    <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-3">This week</h3>
      <div className="flex items-end gap-2 h-[100px] mt-3">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={`rounded mb-1.5 transition-[height] duration-300 ${d.active ? 'bg-orange-500' : 'bg-orange-50'}`}
              style={{ height: Math.max(4, (d.quizzes / maxQ) * 80) }}
            />
            <span className={`text-[10px] ${d.active ? 'text-gray-900' : 'text-gray-500'}`}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// BKT MASTERY RING
// ============================================================
function MasteryRing({ levels, total }: { levels: Record<string, number>; total: number }) {
  if (total === 0) return <p className="text-gray-500 text-[13px] italic">No adaptive data yet.</p>;
  const data = [
    { label: 'Mastered', count: levels.mastered || 0, color: '#059669' },
    { label: 'Proficient', count: levels.proficient || 0, color: '#7C3AED' },
    { label: 'Familiar', count: levels.familiar || 0, color: '#2563EB' },
    { label: 'Attempted', count: levels.attempted || 0, color: '#D97706' },
  ].filter(d => d.count > 0);
  return (
    <div className="flex gap-3 flex-wrap">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 rounded-lg" style={{ borderLeft: `3px solid ${d.color}` }}>
          <span className="text-lg font-bold" style={{ color: d.color }}>{d.count}</span>
          <span className="text-xs text-gray-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
function Dashboard({ guardian, student, isHi }: { guardian: ParentSession; student: StudentSession; isHi: boolean }) {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [tips, setTips] = useState<ParentTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTips, setShowTips] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, t] = await Promise.all([
      api('get_child_dashboard', { student_id: student.id, guardian_id: guardian.id }),
      api('get_tips'),
    ]);
    setDash(d); setTips(t.tips || []);
    setLoading(false);
  }, [student.id, guardian.id]);

  useEffect(() => { load(); }, [load]);

  const logout = () => { clearParentSession(); window.location.reload(); };

  if (loading) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-20 text-gray-500">
        <div className="w-10 h-10 border-[3px] border-orange-200 border-t-orange-500 rounded-full mx-auto mb-4 animate-spin" />
        {t(isHi, `Loading ${student.name}'s progress...`, `${student.name} की प्रगति लोड हो रही है...`)}
      </div>
    </div>
  );

  if (!dash || dash.error) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-[60px] text-red-500">{dash?.error || t(isHi, 'Failed to load dashboard', 'डैशबोर्ड लोड करने में विफल')}</div>
    </div>
  );

  const s = dash.stats;
  const childName = dash.student?.name || student.name;

  const accuracyColor = (s.accuracy || 0) >= 70 ? 'border-emerald-600' : (s.accuracy || 0) >= 40 ? 'border-amber-600' : 'border-red-600';

  // Check if child has zero activity — show contextual empty state
  const hasNoActivity = (s.totalQuizzes || 0) === 0 && (s.xp || 0) === 0 && (s.totalChats || 0) === 0;

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div className="flex justify-between items-start mb-5 pb-4 border-b border-orange-200">
        <div>
          <p className="text-[11px] text-orange-500 font-semibold uppercase tracking-[1px] mb-1">{t(isHi, 'Parent Dashboard', 'अभिभावक डैशबोर्ड')}</p>
          <h1 className="text-[22px] font-bold text-gray-900 m-0">{childName}</h1>
          <p className="text-sm text-gray-500 mt-1 mb-0">{t(isHi, 'Grade', 'कक्षा')} {dash.student?.grade || student.grade} | {dash.subject || t(isHi, 'Science', 'विज्ञान')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-1.5 bg-transparent text-orange-500 border border-orange-200 rounded-md text-xs cursor-pointer">{t(isHi, 'Refresh', 'रिफ्रेश')}</button>
          <button onClick={logout} className="px-3 py-1.5 bg-transparent text-gray-500 border border-orange-200 rounded-md text-xs cursor-pointer">{t(isHi, 'Logout', 'लॉग आउट')}</button>
        </div>
      </div>

      {/* Contextual empty state when child has no data yet */}
      {hasNoActivity && (
        <div className="bg-white rounded-[14px] px-[18px] py-6 border border-orange-200 mb-4 text-center">
          <div className="text-4xl mb-3">&#x1F331;</div>
          <h3 className="text-[16px] font-semibold text-gray-900 mb-2">
            {t(isHi, `${childName} hasn't started learning yet`, `${childName} ने अभी तक पढ़ाई शुरू नहीं की है`)}
          </h3>
          <p className="text-[13px] text-gray-500 mb-3 leading-relaxed max-w-[300px] mx-auto">
            {t(isHi,
              'Once they take their first quiz or chat with Foxy, you\'ll see their progress here in real-time.',
              'जब वे अपनी पहली क्विज़ देंगे या Foxy से चैट करेंगे, तो आप यहाँ उनकी प्रगति देख सकेंगे।'
            )}
          </p>
          <div className="flex flex-col gap-2 text-left max-w-[280px] mx-auto">
            <p className="text-[12px] text-gray-400 font-semibold uppercase tracking-wide">{t(isHi, 'How to get started:', 'शुरू कैसे करें:')}</p>
            <p className="text-[13px] text-gray-600">1. {t(isHi, 'Ask your child to open Alfanumrik', 'अपने बच्चे को Alfanumrik खोलने को कहें')}</p>
            <p className="text-[13px] text-gray-600">2. {t(isHi, 'They can take a quiz or ask Foxy a question', 'वे एक क्विज़ दे सकते हैं या Foxy से सवाल पूछ सकते हैं')}</p>
            <p className="text-[13px] text-gray-600">3. {t(isHi, 'Come back here to see their progress!', 'उनकी प्रगति देखने के लिए यहाँ वापस आएं!')}</p>
          </div>
        </div>
      )}

      {/* Plain-Language Summary — trust-building, no jargon */}
      {!hasNoActivity && (
        <div className={`bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-4 border-l-[3px] ${accuracyColor}`}>
          <p className="text-[15px] font-semibold text-gray-900 mb-1.5">
            {(s.accuracy || 0) >= 70
              ? t(isHi, `${childName} is doing well!`, `${childName} अच्छा प्रदर्शन कर रहा है!`)
              : (s.accuracy || 0) >= 40
              ? t(isHi, `${childName} is making progress, but needs practice.`, `${childName} प्रगति कर रहा है, लेकिन अभ्यास की जरूरत है।`)
              : t(isHi, `${childName} needs extra support right now.`, `${childName} को अभी अतिरिक्त सहायता की जरूरत है।`)}
          </p>
          <p className="text-[13px] text-gray-500 m-0 leading-relaxed">
            {(s.streak || 0) >= 3
              ? t(isHi, `Studying consistently for ${s.streak} days. `, `${s.streak} दिनों से लगातार पढ़ाई कर रहा है। `)
              : s.streak === 0
              ? t(isHi, 'Not active today. ', 'आज सक्रिय नहीं है। ')
              : t(isHi, `Started a ${s.streak}-day streak. `, `${s.streak}-दिन की स्ट्रीक शुरू की। `)}
            {(s.totalQuizzes || 0) > 0
              ? t(isHi, `Completed ${s.totalQuizzes} quizzes with ${s.accuracy || 0}% accuracy. `, `${s.totalQuizzes} क्विज़ ${s.accuracy || 0}% सटीकता के साथ पूरी की। `)
              : t(isHi, 'No quizzes taken yet. ', 'अभी तक कोई क्विज़ नहीं दी। ')}
            {(s.avgScore || 0) >= 80
              ? t(isHi, 'Scoring above 80% — great progress!', '80% से ऊपर स्कोर — बहुत अच्छी प्रगति!')
              : (s.avgScore || 0) >= 50
              ? t(isHi, `Average score is ${s.avgScore}% — room to improve.`, `औसत स्कोर ${s.avgScore}% — सुधार की गुंजाइश है।`)
              : (s.avgScore || 0) > 0
              ? t(isHi, `Average score is ${s.avgScore}% — consider encouraging more practice.`, `औसत स्कोर ${s.avgScore}% — अधिक अभ्यास के लिए प्रोत्साहित करें।`)
              : ''}
          </p>
        </div>
      )}

      {/* This Week's Highlights */}
      {dash.weekSummary && !hasNoActivity && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-[14px] px-[18px] py-4 border border-orange-200 mb-4">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-2.5">{t(isHi, "This Week's Highlights", 'इस सप्ताह की मुख्य बातें')}</h3>
          <div className="flex flex-col gap-2">
            {(dash.weekSummary.quizzes || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-emerald-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Completed ${dash.weekSummary.quizzes} quiz${dash.weekSummary.quizzes > 1 ? 'zes' : ''} this week`,
                  `इस सप्ताह ${dash.weekSummary.quizzes} क्विज़ पूरी की`
                )}
              </div>
            )}
            {(dash.weekSummary.avgScore || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className={`font-bold text-sm ${(dash.weekSummary.avgScore || 0) >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>&#x2713;</span>
                {t(isHi,
                  `Weekly average score: ${dash.weekSummary.avgScore}%`,
                  `साप्ताहिक औसत स्कोर: ${dash.weekSummary.avgScore}%`
                )}
              </div>
            )}
            {(dash.weekSummary.activeDays || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-emerald-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Active for ${dash.weekSummary.activeDays} out of 7 days`,
                  `7 में से ${dash.weekSummary.activeDays} दिन सक्रिय`
                )}
              </div>
            )}
            {(s.totalChats || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-purple-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Used Foxy AI tutor ${s.totalChats} time${s.totalChats > 1 ? 's' : ''}`,
                  `Foxy AI ट्यूटर का ${s.totalChats} बार उपयोग किया`
                )}
              </div>
            )}
          </div>
          {(dash.weekSummary.quizzes || 0) === 0 && (dash.weekSummary.activeDays || 0) === 0 && (
            <p className="text-[13px] text-amber-600 mt-2">
              {t(isHi,
                `${childName} hasn't been active this week. A gentle reminder to practice can help!`,
                `${childName} इस सप्ताह सक्रिय नहीं रहा है। अभ्यास के लिए एक कोमल अनुस्मारक मदद कर सकता है!`
              )}
            </p>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <Stat icon="&#x2B50;" label="XP" value={s.xp || 0} color="#F59E0B" />
        <Stat icon="&#x1F525;" label={t(isHi, 'Streak', 'स्ट्रीक')} value={`${s.streak || 0}d`} color="#EF4444" />
        <Stat icon="&#x1F3AF;" label={t(isHi, 'Accuracy', 'सटीकता')} value={`${s.accuracy || 0}%`} color="#059669" />
        <Stat icon="&#x1F4DA;" label={t(isHi, 'Quizzes', 'क्विज़')} value={s.totalQuizzes || 0} color="#6366F1" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2.5 mb-4">
        <Stat icon="&#x23F1;" label={t(isHi, 'Study time', 'अध्ययन समय')} value={`${s.minutes || 0}m`} color="#8B5CF6" />
        <Stat icon="&#x1F4AC;" label={t(isHi, 'Foxy chats', 'Foxy चैट')} value={s.totalChats || 0} color="#EC4899" />
        <Stat icon="&#x1F4CA;" label={t(isHi, 'Avg score', 'औसत स्कोर')} value={`${s.avgScore || 0}%`} color="#2563EB" />
      </div>

      {/* Weekly Activity */}
      {dash.dailyActivity && <WeeklyChart data={dash.dailyActivity} />}

      {/* Week Summary */}
      {dash.weekSummary && (
        <div className="bg-white rounded-[14px] px-5 py-3.5 border border-orange-200 mb-3.5 flex justify-around text-center">
          <div><span className="text-xl font-bold text-orange-500">{dash.weekSummary.quizzes}</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'quizzes this week', 'इस सप्ताह क्विज़')}</span></div>
          <div className="w-px bg-orange-200" />
          <div><span className="text-xl font-bold text-emerald-600">{dash.weekSummary.avgScore}%</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'avg score', 'औसत स्कोर')}</span></div>
          <div className="w-px bg-orange-200" />
          <div><span className="text-xl font-bold text-amber-600">{dash.weekSummary.activeDays}/7</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'active days', 'सक्रिय दिन')}</span></div>
        </div>
      )}

      {/* BKT Adaptive Mastery */}
      {dash.bktMastery && dash.bktMastery.total > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Learning Progress', 'सीखने की प्रगति')}</h3>
          <MasteryRing levels={dash.bktMastery.levels} total={dash.bktMastery.total} />
          <p className="text-xs text-gray-500 mt-2.5 mb-0">
            {t(isHi,
              `${dash.bktMastery.total} concepts being tracked across all subjects`,
              `सभी विषयों में ${dash.bktMastery.total} अवधारणाओं की ट्रैकिंग`
            )}
          </p>
        </div>
      )}

      {/* Active Bursts / Adventures */}
      {dash.activeBursts && dash.activeBursts.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Active learning adventures', 'सक्रिय शिक्षण अभियान')}</h3>
          {dash.activeBursts.map((b: ActiveBurst, i: number) => (
            <div key={i} className={`flex items-center gap-3 py-2 ${i < (dash.activeBursts?.length ?? 0) - 1 ? 'border-b border-orange-200' : ''}`}>
              <span className="text-xl">{b.type === 'boss_battle' ? '\u2694\uFE0F' : b.type === 'mystery_solve' ? '\uD83D\uDD0D' : '\uD83C\uDFF0'}</span>
              <div className="flex-1">
                <span className="text-[13px] font-semibold text-gray-900">{b.title}</span>
                <div className="flex gap-1 mt-1">
                  <div className="flex-1 h-1.5 bg-orange-50 rounded-sm overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-sm" style={{ width: `${Math.round((b.progress / b.goal) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-500 min-w-[40px]">{b.progress}/{b.goal}</span>
                </div>
              </div>
              <span className="text-xs text-amber-500 font-semibold">+{b.xp} XP</span>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {dash.insights && dash.insights.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Insights for you', 'आपके लिए सुझाव')}</h3>
          {dash.insights.map((insight: string, i: number) => (
            <p key={i} className="text-[13px] text-gray-600 my-1.5 px-3 py-2 bg-orange-50 rounded-lg leading-relaxed">{insight}</p>
          ))}
        </div>
      )}

      {/* Tips toggle */}
      <button onClick={() => setShowTips(!showTips)} className="w-full px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold cursor-pointer mb-3.5">
        {showTips ? t(isHi, 'Hide parenting tips', 'पेरेंटिंग टिप्स छुपाएं') : t(isHi, 'Show parenting tips', 'पेरेंटिंग टिप्स दिखाएं')}
      </button>
      {showTips && tips.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          {tips.map((tip: ParentTip) => (
            <div key={tip.id} className="py-2.5 border-b border-orange-200">
              <span className="text-sm font-semibold text-gray-900">{tip.title}</span>
              <p className="text-[13px] text-gray-500 mt-1 mb-0">{tip.description}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-gray-500 my-5">
        Alfanumrik Learning OS | {t(isHi, 'Parent Portal', 'अभिभावक पोर्टल')} | {t(isHi, 'Logged in as', 'लॉग इन')} {guardian.name}
      </p>
    </div>
  );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
export default function ParentPage() {
  const auth = useAuth();
  const [guardian, setGuardian] = useState<ParentSession | null>(null);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (auth.isLoading) return;

    // First check if user is logged in via Supabase with guardian role
    if (auth.guardian) {
      setGuardian(auth.guardian);
      // Student data will be fetched by the dashboard API; load from verified session if available
      loadParentSession().then(session => {
        if (session) setStudent(session.student);
        setChecking(false);
      });
      return;
    }

    // Fallback: check sessionStorage for link-code-based login (HMAC-verified, expiry-checked)
    loadParentSession().then(session => {
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
      }
      setChecking(false);
    });
  }, [auth.isLoading, auth.guardian]);

  if (checking || auth.isLoading) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-20 text-gray-500">Loading...</div>
    </div>
  );

  const isHi = auth.isHi ?? false;

  if (!guardian || !student) {
    return <LoginScreen onLogin={(g, s) => { setGuardian(g); setStudent(s); }} isHi={isHi} />;
  }

  return <Dashboard guardian={guardian} student={student} isHi={isHi} />;
}
