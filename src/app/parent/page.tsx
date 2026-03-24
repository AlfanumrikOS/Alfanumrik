'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';

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

async function loadParentSession(): Promise<{ guardian: any; student: any } | null> {
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

function LoginScreen({ onLogin }: { onLogin: (g: any, s: any) => void }) {
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
        <input style={inputStyle} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
        <input style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, textAlign: 'center', textTransform: 'uppercase' }} placeholder="LINK CODE" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} onKeyDown={e => e.key === 'Enter' && submit()} />
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
// PROGRESS METER — Semicircular gauge for overall readiness
// ============================================================
function ProgressMeter({ percent, name, grade }: { percent: number; name: string; grade: string | number }) {
  const p = Math.min(100, Math.max(0, percent));
  const color = p >= 70 ? '#059669' : p >= 40 ? '#D97706' : '#EF4444';
  const label = p >= 70 ? 'On Track' : p >= 40 ? 'Needs Attention' : 'Falling Behind';
  // SVG semicircle arc
  const radius = 70;
  const circumference = Math.PI * radius; // half-circle
  const offset = circumference - (p / 100) * circumference;
  return (
    <div style={{ ...cardStyle, textAlign: 'center', paddingTop: 24, paddingBottom: 20 }}>
      <svg width="180" height="100" viewBox="0 0 180 100" style={{ display: 'block', margin: '0 auto' }}>
        {/* Background arc */}
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#1E293B" strokeWidth="12" strokeLinecap="round" />
        {/* Foreground arc */}
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${circumference}`} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s ease' }} />
        <text x="90" y="75" textAnchor="middle" fill={color} fontSize="28" fontWeight="700" fontFamily="inherit">{p}%</text>
        <text x="90" y="93" textAnchor="middle" fill="#64748B" fontSize="11" fontFamily="inherit">Study Health</text>
      </svg>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F8FAFC', margin: '8px 0 2px' }}>{name}</h2>
      <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>Grade {grade}</p>
      <span style={{
        display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20,
        fontSize: 12, fontWeight: 600, color,
        backgroundColor: `${color}18`, border: `1px solid ${color}40`,
      }}>{label}</span>
    </div>
  );
}

// ============================================================
// SMART ALERTS — Prominent parent alerts
// ============================================================
function SmartAlerts({ stats, weekSummary, dailyActivity, studentName }: {
  stats: any; weekSummary: any; dailyActivity: any[]; studentName: string;
}) {
  const alerts: { icon: string; text: string; hint: string; severity: 'red' | 'amber' }[] = [];

  // Detect inactive days from dailyActivity (count trailing inactive days)
  if (dailyActivity && dailyActivity.length > 0) {
    let inactiveDays = 0;
    for (let i = dailyActivity.length - 1; i >= 0; i--) {
      if (!dailyActivity[i].active) inactiveDays++;
      else break;
    }
    if (inactiveDays > 2) {
      alerts.push({
        icon: '\u26A0\uFE0F',
        text: `${studentName} hasn\u2019t studied in ${inactiveDays} days`,
        hint: 'Encourage them to do a quick review session',
        severity: inactiveDays > 4 ? 'red' : 'amber',
      });
    }
  }

  // Streak broken
  if (stats && stats.streak === 0 && stats.totalQuizzes > 0) {
    alerts.push({
      icon: '\uD83D\uDD25',
      text: 'Study streak was broken recently',
      hint: 'A short 5-minute quiz can restart the streak',
      severity: 'amber',
    });
  }

  // Low accuracy warning
  if (stats && stats.accuracy > 0 && stats.accuracy < 50) {
    alerts.push({
      icon: '\uD83D\uDCCB',
      text: `Accuracy is at ${stats.accuracy}% \u2014 below target`,
      hint: 'Suggest reviewing weak topics before attempting new ones',
      severity: 'red',
    });
  }

  // Low weekly activity
  if (weekSummary && weekSummary.activeDays <= 2) {
    alerts.push({
      icon: '\uD83D\uDCCB',
      text: `Only ${weekSummary.activeDays} active day${weekSummary.activeDays !== 1 ? 's' : ''} this week`,
      hint: 'Encourage them to study a little each day',
      severity: 'amber',
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      {alerts.map((a, i) => {
        const bg = a.severity === 'red' ? '#7F1D1D' : '#78350F';
        const border = a.severity === 'red' ? '#DC2626' : '#D97706';
        return (
          <div key={i} style={{
            backgroundColor: bg, borderRadius: 12, padding: '12px 14px',
            border: `1px solid ${border}60`, marginBottom: i < alerts.length - 1 ? 8 : 0,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#FEF2F2' }}>
              {a.icon} {a.text}
            </div>
            <div style={{ fontSize: 12, color: '#FBBF24', marginTop: 4, fontStyle: 'italic' }}>
              {a.hint}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// SIMPLE STAT — Compact single metric
// ============================================================
function SimpleStat({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div style={{ backgroundColor: '#0F172A', borderRadius: 12, padding: '14px 16px', border: '1px solid #1E293B', textAlign: 'center', flex: 1 }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ color, fontSize: 24, fontWeight: 700, margin: '4px 0 2px' }}>{value}</div>
      <div style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

// ============================================================
// WEAK AREAS — Top struggling subjects/topics
// ============================================================
function WeakAreas({ bktMastery, stats }: { bktMastery: any; stats: any }) {
  const weakTopics: { icon: string; name: string }[] = [];

  // Use BKT data to find weak areas
  if (bktMastery && bktMastery.levels) {
    const attempted = bktMastery.levels.attempted || 0;
    const familiar = bktMastery.levels.familiar || 0;
    if (attempted > 0) weakTopics.push({ icon: '\uD83D\uDCD0', name: `${attempted} topic${attempted > 1 ? 's' : ''} barely started` });
    if (familiar > 0) weakTopics.push({ icon: '\uD83D\uDCD8', name: `${familiar} topic${familiar > 1 ? 's' : ''} need more practice` });
  }

  // Low accuracy as a weak signal
  if (stats && stats.accuracy > 0 && stats.accuracy < 60) {
    weakTopics.push({ icon: '\uD83C\uDFAF', name: `Overall accuracy is low (${stats.accuracy}%)` });
  }

  if (weakTopics.length === 0) return null;

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Weak Areas</h3>
      {weakTopics.slice(0, 3).map((t, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          backgroundColor: '#1E293B', borderRadius: 10, marginBottom: i < Math.min(weakTopics.length, 3) - 1 ? 8 : 0,
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0' }}>{t.name}</span>
            <div style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>Needs practice</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY CHART — Simplified bars
// ============================================================
function WeeklyChart({ data }: { data: any[] }) {
  const maxQ = Math.max(...data.map(d => d.quizzes), 1);
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>This week</h3>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80, marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ height: Math.max(4, (d.quizzes / maxQ) * 64), backgroundColor: d.active ? '#6366F1' : '#1E293B', borderRadius: 4, marginBottom: 6, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 10, color: d.active ? '#E2E8F0' : '#475569' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SIMPLIFIED MASTERY — Mastered / In Progress / Needs Work
// ============================================================
function SimpleMastery({ levels, total }: { levels: Record<string, number>; total: number }) {
  if (total === 0) return null;
  const mastered = (levels.mastered || 0);
  const inProgress = (levels.proficient || 0) + (levels.familiar || 0);
  const needsWork = (levels.attempted || 0);
  const items = [
    { label: 'Mastered', count: mastered, color: '#059669' },
    { label: 'In Progress', count: inProgress, color: '#6366F1' },
    { label: 'Needs Work', count: needsWork, color: '#D97706' },
  ].filter(d => d.count > 0);
  if (items.length === 0) return null;
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Topic Mastery</h3>
      <div style={{ display: 'flex', gap: 10 }}>
        {items.map(d => (
          <div key={d.label} style={{
            flex: 1, textAlign: 'center', padding: '10px 8px',
            backgroundColor: '#1E293B', borderRadius: 10, borderTop: `3px solid ${d.color}`,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: d.color }}>{d.count}</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{d.label}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#475569', margin: '10px 0 0' }}>{total} concepts tracked</p>
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
function Dashboard({ guardian, student }: { guardian: any; student: any }) {
  const [dash, setDash] = useState<any>(null);
  const [tips, setTips] = useState<any[]>([]);
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
  const childName = dash.student?.name || student.name;
  const childGrade = dash.student?.grade || student.grade;

  // Compute overall readiness % from available signals
  const overallPercent = Math.round(
    ((s.accuracy || 0) * 0.4) +
    (Math.min((s.streak || 0) / 7, 1) * 100 * 0.2) +
    ((dash.weekSummary ? Math.min(dash.weekSummary.activeDays / 7, 1) * 100 : 0) * 0.2) +
    ((dash.bktMastery && dash.bktMastery.total > 0
      ? ((dash.bktMastery.levels.mastered || 0) + (dash.bktMastery.levels.proficient || 0)) / dash.bktMastery.total * 100
      : (s.accuracy || 0)) * 0.2)
  );

  // Download report handler
  const downloadReport = () => {
    const report = {
      student: childName,
      grade: childGrade,
      generatedAt: new Date().toISOString(),
      overallProgress: `${overallPercent}%`,
      weekSummary: dash.weekSummary ? {
        quizzes: dash.weekSummary.quizzes,
        avgScore: `${dash.weekSummary.avgScore}%`,
        activeDays: `${dash.weekSummary.activeDays}/7`,
      } : null,
      stats: {
        studyTimeMinutes: s.minutes || 0,
        accuracy: `${s.accuracy || 0}%`,
        streak: `${s.streak || 0} days`,
        totalQuizzes: s.totalQuizzes || 0,
      },
      mastery: dash.bktMastery ? {
        total: dash.bktMastery.total,
        mastered: dash.bktMastery.levels.mastered || 0,
        inProgress: (dash.bktMastery.levels.proficient || 0) + (dash.bktMastery.levels.familiar || 0),
        needsWork: dash.bktMastery.levels.attempted || 0,
      } : null,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${childName.replace(/\s+/g, '_')}_weekly_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header — minimal */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1E293B' }}>
        <p style={{ fontSize: 11, color: '#6366F1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, margin: 0 }}>Parent Dashboard</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ padding: '6px 12px', background: 'transparent', color: '#6366F1', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Refresh</button>
          <button onClick={logout} style={{ padding: '6px 12px', background: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

      {/* A. Child Progress Meter */}
      <ProgressMeter percent={overallPercent} name={childName} grade={childGrade} />

      {/* B. Smart Parent Alerts */}
      <SmartAlerts
        stats={s}
        weekSummary={dash.weekSummary}
        dailyActivity={dash.dailyActivity || []}
        studentName={childName}
      />

      {/* C. Download Report Button */}
      <button onClick={downloadReport} style={{
        width: '100%', padding: '14px 20px', backgroundColor: '#1E293B',
        color: '#E2E8F0', border: '1px solid #334155', borderRadius: 12,
        fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        {'\uD83D\uDCE5'} Download Weekly Report
      </button>

      {/* D. Three Simple Metrics */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <SimpleStat icon={'\u23F1\uFE0F'} label="Study Time" value={`${s.minutes || 0}m`} color="#8B5CF6" />
        <SimpleStat icon={'\uD83C\uDFAF'} label="Accuracy" value={`${s.accuracy || 0}%`} color={s.accuracy >= 70 ? '#059669' : s.accuracy >= 40 ? '#D97706' : '#EF4444'} />
        <SimpleStat
          icon={'\uD83D\uDCDA'}
          label="Mastered"
          value={dash.bktMastery ? (dash.bktMastery.levels.mastered || 0) : 0}
          color="#059669"
        />
      </div>

      {/* E. Weak Areas */}
      <WeakAreas bktMastery={dash.bktMastery} stats={s} />

      {/* Weekly Activity — simplified */}
      {dash.dailyActivity && <WeeklyChart data={dash.dailyActivity} />}

      {/* Simplified Mastery (Mastered / In Progress / Needs Work) */}
      {dash.bktMastery && dash.bktMastery.total > 0 && (
        <SimpleMastery levels={dash.bktMastery.levels} total={dash.bktMastery.total} />
      )}

      {/* Active Bursts / Adventures — kept as-is */}
      {dash.activeBursts && dash.activeBursts.length > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitle}>Active learning adventures</h3>
          {dash.activeBursts.map((b: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < dash.activeBursts.length - 1 ? '1px solid #1E293B' : 'none' }}>
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

      {/* Insights — kept */}
      {dash.insights && dash.insights.length > 0 && (
        <div style={cardStyle}>
          <h3 style={cardTitle}>Insights for you</h3>
          {dash.insights.map((insight: string, i: number) => (
            <p key={i} style={{ fontSize: 13, color: '#CBD5E1', margin: '6px 0', padding: '8px 12px', backgroundColor: '#1E293B', borderRadius: 8, lineHeight: 1.5 }}>{insight}</p>
          ))}
        </div>
      )}

      {/* Tips — collapsed by default */}
      <button onClick={() => setShowTips(!showTips)} style={{ width: '100%', padding: '10px 16px', backgroundColor: '#0F172A', color: '#6366F1', border: '1px solid #1E293B', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 14 }}>
        {showTips ? '\u25B2 Hide' : '\u25BC Show'} parenting tips
      </button>
      {showTips && tips.length > 0 && (
        <div style={cardStyle}>
          {tips.map((tip: any) => (
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
  const [guardian, setGuardian] = useState<any>(null);
  const [student, setStudent] = useState<any>(null);
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
