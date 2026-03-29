'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';

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
// ── Brute-force protection for parent login ──
// Tuition centers try to brute-force link codes to monitor students
// they don't own. Progressive lockout: 3 → 5 → 15 → 60 min.
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

function LoginScreen({ onLogin }: { onLogin: (g: ParentSession, s: StudentSession) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!code.trim()) { setError('Please enter link code'); return; }

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
    <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>&#x1F9D1;&#x200D;&#x1F393;</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F8FAFC', margin: '0 0 4px' }}>Parent Dashboard</h1>
        <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px' }}>Enter your child&apos;s link code to view their progress</p>
        <input style={inputStyle} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} aria-label="Your name" autoComplete="name" />
        <input style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, textAlign: 'center', textTransform: 'uppercase' }} placeholder="LINK CODE" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} onKeyDown={e => e.key === 'Enter' && submit()} aria-label="Child link code" />
        {error && <p style={{ color: '#EF4444', fontSize: 13, margin: '8px 0' }}>{error}</p>}
        <button onClick={submit} disabled={loading} style={{ ...btnStyle, width: '100%', marginTop: 8, opacity: loading ? 0.5 : 1 }}>
          {loading ? 'Connecting...' : 'View Dashboard'}
        </button>
        <p style={{ fontSize: 12, color: '#475569', marginTop: 16 }}>
          Ask your child for the link code from their Alfanumrik profile.
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
    <div style={{ backgroundColor: '#0F172A', borderRadius: 12, padding: '12px 14px', border: '1px solid #1E293B' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</span>
      </div>
      <span style={{ color, fontSize: 22, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY CHART
// ============================================================
function WeeklyChart({ data }: { data: WeeklyDay[] }) {
  const maxQ = Math.max(...data.map(d => d.quizzes), 1);
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>This week</h3>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, marginTop: 12 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ height: Math.max(4, (d.quizzes / maxQ) * 80), backgroundColor: d.active ? '#6366F1' : '#1E293B', borderRadius: 4, marginBottom: 6, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 10, color: d.active ? '#E2E8F0' : '#475569' }}>{d.label}</span>
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
  if (total === 0) return <p style={{ color: '#475569', fontSize: 13, fontStyle: 'italic' }}>No adaptive data yet.</p>;
  const data = [
    { label: 'Mastered', count: levels.mastered || 0, color: '#059669' },
    { label: 'Proficient', count: levels.proficient || 0, color: '#7C3AED' },
    { label: 'Familiar', count: levels.familiar || 0, color: '#2563EB' },
    { label: 'Attempted', count: levels.attempted || 0, color: '#D97706' },
  ].filter(d => d.count > 0);
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', backgroundColor: '#1E293B', borderRadius: 8, borderLeft: `3px solid ${d.color}` }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: d.color }}>{d.count}</span>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
function Dashboard({ guardian, student }: { guardian: ParentSession; student: StudentSession }) {
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
    <div style={pageStyle}>
      <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #1E293B', borderTopColor: '#6366F1', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
        Loading {student.name}&apos;s progress...
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!dash || dash.error) return <div style={pageStyle}><div style={{ textAlign: 'center', padding: 60, color: '#EF4444' }}>{dash?.error || 'Failed to load dashboard'}</div></div>;

  const s = dash.stats;

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' }}>
        <div>
          <p style={{ fontSize: 11, color: '#6366F1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, margin: '0 0 4px' }}>Parent Dashboard</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>{dash.student?.name || student.name}</h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '4px 0 0' }}>Grade {dash.student?.grade || student.grade} | {dash.subject || 'Science'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ padding: '6px 12px', background: 'transparent', color: '#6366F1', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Refresh</button>
          <button onClick={logout} style={{ padding: '6px 12px', background: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

      {/* Plain-Language Summary — trust-building, no jargon */}
      <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `3px solid ${(s.accuracy || 0) >= 70 ? '#059669' : (s.accuracy || 0) >= 40 ? '#D97706' : '#DC2626'}` }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#F1F5F9', margin: '0 0 6px' }}>
          {(s.accuracy || 0) >= 70
            ? `${dash.student?.name || student.name} is doing well! 🌟`
            : (s.accuracy || 0) >= 40
            ? `${dash.student?.name || student.name} is making progress, but needs practice.`
            : `${dash.student?.name || student.name} needs extra support right now.`}
        </p>
        <p style={{ fontSize: 13, color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
          {(s.streak || 0) >= 3
            ? `Studying consistently for ${s.streak} days. `
            : s.streak === 0
            ? 'Not active today. '
            : `Started a ${s.streak}-day streak. `}
          {(s.totalQuizzes || 0) > 0
            ? `Completed ${s.totalQuizzes} quizzes with ${s.accuracy || 0}% accuracy. `
            : 'No quizzes taken yet. '}
          {(s.avgScore || 0) >= 80
            ? 'Scoring above 80% — great progress!'
            : (s.avgScore || 0) >= 50
            ? `Average score is ${s.avgScore}% — room to improve.`
            : (s.avgScore || 0) > 0
            ? `Average score is ${s.avgScore}% — consider encouraging more practice.`
            : ''}
        </p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
        <Stat icon="&#x2B50;" label="XP" value={s.xp || 0} color="#F59E0B" />
        <Stat icon="&#x1F525;" label="Streak" value={`${s.streak || 0}d`} color="#EF4444" />
        <Stat icon="&#x1F3AF;" label="Accuracy" value={`${s.accuracy || 0}%`} color="#059669" />
        <Stat icon="&#x1F4DA;" label="Quizzes" value={s.totalQuizzes || 0} color="#6366F1" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Stat icon="&#x23F1;" label="Study time" value={`${s.minutes || 0}m`} color="#8B5CF6" />
        <Stat icon="&#x1F4AC;" label="Foxy chats" value={s.totalChats || 0} color="#EC4899" />
        <Stat icon="&#x1F4CA;" label="Avg score" value={`${s.avgScore || 0}%`} color="#2563EB" />
      </div>

      {/* Weekly Activity */}
      {dash.dailyActivity && <WeeklyChart data={dash.dailyActivity} />}

      {/* Week Summary */}
      {dash.weekSummary && (
        <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-around', padding: '14px 20px', textAlign: 'center' }}>
          <div><span style={{ fontSize: 20, fontWeight: 700, color: '#6366F1' }}>{dash.weekSummary.quizzes}</span><br /><span style={{ fontSize: 11, color: '#64748B' }}>quizzes this week</span></div>
          <div style={{ width: 1, backgroundColor: '#1E293B' }} />
          <div><span style={{ fontSize: 20, fontWeight: 700, color: '#059669' }}>{dash.weekSummary.avgScore}%</span><br /><span style={{ fontSize: 11, color: '#64748B' }}>avg score</span></div>
          <div style={{ width: 1, backgroundColor: '#1E293B' }} />
          <div><span style={{ fontSize: 20, fontWeight: 700, color: '#D97706' }}>{dash.weekSummary.activeDays}/7</span><br /><span style={{ fontSize: 11, color: '#64748B' }}>active days</span></div>
        </div>
      )}

      {/* BKT Adaptive Mastery */}
      {dash.bktMastery && dash.bktMastery.total > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitle}>Learning Progress</h3>
          <MasteryRing levels={dash.bktMastery.levels} total={dash.bktMastery.total} />
          <p style={{ fontSize: 12, color: '#475569', margin: '10px 0 0' }}>{dash.bktMastery.total} concepts being tracked across all subjects</p>
        </div>
      )}

      {/* Active Bursts / Adventures */}
      {dash.activeBursts && dash.activeBursts.length > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitle}>Active learning adventures</h3>
          {dash.activeBursts.map((b: ActiveBurst, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < (dash.activeBursts?.length ?? 0) - 1 ? '1px solid #1E293B' : 'none' }}>
              <span style={{ fontSize: 20 }}>{b.type === 'boss_battle' ? '\u2694\uFE0F' : b.type === 'mystery_solve' ? '\uD83D\uDD0D' : '\uD83C\uDFF0'}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{b.title}</span>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 6, backgroundColor: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((b.progress / b.goal) * 100)}%`, backgroundColor: '#6366F1', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, color: '#94A3B8', minWidth: 40 }}>{b.progress}/{b.goal}</span>
                </div>
              </div>
              <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>+{b.xp} XP</span>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {dash.insights && dash.insights.length > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitle}>Insights for you</h3>
          {dash.insights.map((insight: string, i: number) => (
            <p key={i} style={{ fontSize: 13, color: '#CBD5E1', margin: '6px 0', padding: '8px 12px', backgroundColor: '#1E293B', borderRadius: 8, lineHeight: 1.5 }}>{insight}</p>
          ))}
        </div>
      )}

      {/* Tips toggle */}
      <button onClick={() => setShowTips(!showTips)} style={{ width: '100%', padding: '10px 16px', backgroundColor: '#0F172A', color: '#6366F1', border: '1px solid #1E293B', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 14 }}>
        {showTips ? 'Hide' : 'Show'} parenting tips
      </button>
      {showTips && tips.length > 0 && (
        <div style={cardStyle}>
          {tips.map((tip: ParentTip) => (
            <div key={tip.id} style={{ padding: '10px 0', borderBottom: '1px solid #1E293B' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9' }}>{tip.title}</span>
              <p style={{ fontSize: 13, color: '#94A3B8', margin: '4px 0 0' }}>{tip.description}</p>
            </div>
          ))}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 11, color: '#475569', margin: '20px 0' }}>
        Alfanumrik Learning OS | Parent Portal | Logged in as {guardian.name}
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

  if (checking || auth.isLoading) return <div style={pageStyle}><div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>Loading...</div></div>;

  if (!guardian || !student) {
    return <LoginScreen onLogin={(g, s) => { setGuardian(g); setStudent(s); }} />;
  }

  return <Dashboard guardian={guardian} student={student} />;
}

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = { maxWidth: 600, margin: '0 auto', padding: '20px 16px', fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif", color: '#E2E8F0', backgroundColor: '#0B1120', minHeight: '100vh' };
const cardStyle: React.CSSProperties = { backgroundColor: '#0F172A', borderRadius: 14, padding: '16px 18px', border: '1px solid #1E293B', marginBottom: 14 };
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: '#F1F5F9', margin: '0 0 12px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 10, color: '#E2E8F0', fontSize: 15, outline: 'none', marginBottom: 10, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '12px 20px', backgroundColor: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' };
