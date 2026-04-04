'use client';

/**
 * ALFANUMRIK SUPER ADMIN — Command Center
 * Full-featured CMS + operational backbone for platform management.
 *
 * Auth: sessionStorage (never URL params). On first visit show login form.
 *
 * Tabs:
 *  1. Command Center  — live KPIs, sparkline, AI health, revenue snapshot
 *  2. Users           — filterable table, detail drawer, bulk actions
 *  3. Content CMS     — topics editor, question bank, chapter list
 *  4. Schools         — school list + per-school metrics
 *  5. Revenue         — payment history, MRR, plan distribution
 *  6. AI Monitor      — hourly call chart, error rate, subject heat-map
 *  7. Feature Flags   — enable/disable flags, rollout % controls
 *  8. Support         — ticket queue, status updates, admin notes
 *  9. Audit Logs      — user & admin action streams
 * 10. Reports         — CSV / JSON export for every entity
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAdminSecretFromSession,
  setAdminSecretInSession,
  clearAdminSession,
  adminHeaders,
} from '@/lib/admin-session';

// ─── Types ────────────────────────────────────────────────────

type Tab =
  | 'command'
  | 'users'
  | 'content'
  | 'schools'
  | 'revenue'
  | 'ai'
  | 'flags'
  | 'support'
  | 'logs'
  | 'reports';

interface CommandData {
  totals: Record<string, number>;
  activity: Record<string, number>;
  ai: { calls_last_1h: number; calls_last_24h: number };
  revenue: { today_inr: number; last_7d_inr: number; last_30d_inr: number };
  support: { open_tickets: number };
  sparkline: Array<{ date: string; quizzes: number }>;
}

interface Student {
  id: string;
  name: string;
  email: string;
  grade: string;
  board: string;
  subscription_plan: string;
  xp_total: number;
  streak_days: number;
  is_active: boolean;
  account_status: string;
  created_at: string;
  [key: string]: unknown;
}

interface SupportTicket {
  id: string;
  student_id: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  is_enabled: boolean;
  rollout_percentage: number;
  target_grades: string[] | null;
  target_roles: string[] | null;
  updated_at: string;
}

interface LogEntry {
  id: string;
  auth_user_id?: string;
  admin_id?: string;
  action: string;
  resource_type?: string;
  entity_type?: string;
  status?: string;
  created_at: string;
  details?: Record<string, unknown>;
}

interface Topic {
  id: string;
  subject?: { code: string; name: string };
  grade: string;
  chapter_number: number;
  title: string;
  display_order: number;
  is_active: boolean;
  difficulty_level: string;
  estimated_minutes: number;
}

interface Question {
  id: string;
  subject: string;
  grade: string;
  chapter_number: number;
  question_text: string;
  question_type: string;
  difficulty: string;
  bloom_level: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

// ─── Styles ───────────────────────────────────────────────────

const C = {
  bg: '#080c10',
  bg2: '#0d1117',
  bg3: '#161b22',
  border: '#21262d',
  text1: '#e6edf3',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  page: { minHeight: '100vh', background: C.bg, color: C.text1, fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif", fontSize: 13 },
  header: { padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sidebar: { width: 200, minHeight: 'calc(100vh - 49px)', borderRight: `1px solid ${C.border}`, background: C.bg2, padding: '8px 0', flexShrink: 0 },
  content: { flex: 1, padding: 20, overflowX: 'auto' as const, minHeight: 'calc(100vh - 49px)' },
  navItem: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 16px', fontSize: 12, fontWeight: active ? 700 : 400,
    color: active ? C.orange : C.text2,
    background: active ? `${C.orange}12` : 'transparent',
    borderLeft: active ? `2px solid ${C.orange}` : '2px solid transparent',
    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left' as const,
    transition: 'all 0.15s',
  }),
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  kpiCard: (color: string): React.CSSProperties => ({
    padding: '14px 16px', borderRadius: 10,
    border: `1px solid ${C.border}`, background: C.bg3,
    borderTop: `2px solid ${color}`,
  }),
  badge: (color: string, bg?: string): React.CSSProperties => ({
    fontSize: 10, padding: '2px 8px', borderRadius: 10,
    background: bg || `${color}18`, color,
    fontWeight: 600, whiteSpace: 'nowrap' as const,
  }),
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  btnDanger: { padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: `${C.red}15`, color: C.red, border: `1px solid ${C.red}30` },
  input: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 12, outline: 'none', fontFamily: 'inherit' },
  select: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: `1px solid ${C.border}`, color: C.text3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.2, whiteSpace: 'nowrap' as const },
  td: { padding: '9px 12px', borderBottom: `1px solid #0d1117`, color: C.text2, verticalAlign: 'middle' as const },
  h2: { fontSize: 11, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 14 },
  section: { marginBottom: 28 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
};

// ─── Mini sparkline SVG ────────────────────────────────────────

function Sparkline({ data, color = C.orange }: { data: number[]; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 80, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────

function KPI({ label, value, sub, color, sparkData }: {
  label: string; value: string | number; sub?: string; color?: string; sparkData?: number[];
}) {
  const c = color || C.orange;
  return (
    <div style={S.kpiCard(c)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
          <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 2 }}>{label}</div>
        </div>
        {sparkData && <Sparkline data={sparkData} color={c} />}
      </div>
      {sub && <div style={{ fontSize: 10, color: C.text2, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (s: string) => void }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const tryLogin = async () => {
    if (!val.trim()) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/internal/admin/stats', {
        headers: { 'x-admin-secret': val.trim() },
      });
      if (res.ok) {
        setAdminSecretInSession(val.trim());
        onLogin(val.trim());
      } else {
        setErr('Invalid secret. Access denied.');
      }
    } catch {
      setErr('Network error. Please retry.');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...S.card, maxWidth: 360, width: '100%', margin: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>🦊</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>ALFANUMRIK</div>
          <div style={{ fontSize: 10, color: C.text3, letterSpacing: 2, marginTop: 2 }}>SUPER ADMIN CONSOLE</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <input
            type="password"
            placeholder="Admin secret key"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && tryLogin()}
            style={{ ...S.input, width: '100%', boxSizing: 'border-box' as const }}
            autoFocus
          />
        </div>
        {err && <div style={{ fontSize: 11, color: C.red, marginBottom: 10 }}>{err}</div>}
        <button onClick={tryLogin} disabled={loading} style={{ ...S.btn(), width: '100%', justifyContent: 'center' }}>
          {loading ? 'Verifying...' : 'Access Console'}
        </button>
        <div style={{ fontSize: 10, color: C.text3, marginTop: 14, textAlign: 'center' }}>
          Secret is stored in sessionStorage only — cleared on tab close.
        </div>
      </div>
    </div>
  );
}

// ─── User Detail Drawer ────────────────────────────────────────

function UserDrawer({ student, secret, onClose, onRefresh }: {
  student: Student;
  secret: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    fetch(`/api/internal/admin/users/${student.id}`, { headers: adminHeaders(secret) })
      .then(r => r.ok ? r.json() : null)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [student.id, secret]);

  const doAction = async (action: string, extras?: Record<string, unknown>) => {
    setActionLoading(action);
    await fetch(`/api/internal/admin/users/${student.id}`, {
      method: 'PATCH',
      headers: adminHeaders(secret),
      body: JSON.stringify({ action, ...extras }),
    });
    setActionLoading('');
    onRefresh();
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 420, background: C.bg2, borderLeft: `1px solid ${C.border}`, height: '100%', overflowY: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{student.name || '—'}</div>
            <div style={{ fontSize: 11, color: C.text3 }}>{student.email}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text2, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Quick Stats */}
        <div style={{ ...S.grid2, marginBottom: 16 }}>
          <div style={S.card}><div style={{ fontSize: 18, fontWeight: 700, color: C.yellow }}>{student.xp_total ?? 0}</div><div style={{ fontSize: 10, color: C.text3 }}>XP TOTAL</div></div>
          <div style={S.card}><div style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>{student.streak_days ?? 0}</div><div style={{ fontSize: 10, color: C.text3 }}>STREAK DAYS</div></div>
        </div>

        {/* Info */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          {[
            ['Grade', student.grade || '—'],
            ['Board', student.board || '—'],
            ['Plan', student.subscription_plan || 'free'],
            ['Status', student.is_active ? 'Active' : 'Suspended'],
            ['Joined', new Date(student.created_at).toLocaleDateString()],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.text3, fontSize: 11 }}>{k}</span>
              <span style={{ fontWeight: 600, fontSize: 11 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ ...S.h2, marginBottom: 10 }}>Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {student.is_active ? (
            <button onClick={() => doAction('suspend')} style={S.btnDanger} disabled={!!actionLoading}>
              {actionLoading === 'suspend' ? '...' : '⛔ Suspend'}
            </button>
          ) : (
            <button onClick={() => doAction('restore')} style={S.btn(C.green)} disabled={!!actionLoading}>
              {actionLoading === 'restore' ? '...' : '✅ Restore'}
            </button>
          )}
          <button onClick={() => doAction('upgrade_plan', { plan: 'premium' })} style={S.btn(C.yellow)} disabled={!!actionLoading}>
            {actionLoading === 'upgrade_plan' ? '...' : '⭐ Upgrade Premium'}
          </button>
          <button onClick={() => doAction('reset_streak')} style={S.btn(C.blue)} disabled={!!actionLoading}>
            🔄 Reset Streak
          </button>
          <button onClick={() => doAction('reset_xp')} style={S.btn(C.purple)} disabled={!!actionLoading}>
            🎯 Reset XP
          </button>
        </div>

        {/* Recent activity */}
        {loading ? (
          <div style={{ color: C.text3, fontSize: 11 }}>Loading activity...</div>
        ) : detail ? (
          <>
            <div style={S.h2}>Recent Quizzes</div>
            <div style={{ marginBottom: 14 }}>
              {((detail.recent_quizzes as Array<Record<string, unknown>>) || []).slice(0, 5).map((q, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                  <span style={{ color: C.text2 }}>{q.subject as string}</span>
                  <span style={{ color: C.orange, fontWeight: 600 }}>{q.score_percent as number ?? 0}%</span>
                </div>
              ))}
              {(detail.recent_quizzes as unknown[])?.length === 0 && <div style={{ color: C.text3, fontSize: 11 }}>No quizzes yet</div>}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function SuperAdminPage() {
  const [secret, setSecret] = useState('');
  const [tab, setTab] = useState<Tab>('command');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data state
  const [command, setCommand] = useState<CommandData | null>(null);
  const [users, setUsers] = useState<Student[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userRole, setUserRole] = useState('student');
  const [userSearch, setUserSearch] = useState('');
  const [userGrade, setUserGrade] = useState('');
  const [userPlan, setUserPlan] = useState('');
  const [selectedUser, setSelectedUser] = useState<Student | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicTotal, setTopicTotal] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [contentView, setContentView] = useState<'topics' | 'questions'>('topics');
  const [contentSubject, setContentSubject] = useState('');
  const [contentGrade, setContentGrade] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [contentPage, setContentPage] = useState(1);
  const [schools, setSchools] = useState<Record<string, unknown>[]>([]);
  const [schoolTotal, setSchoolTotal] = useState(0);
  const [revenue, setRevenue] = useState<Record<string, unknown> | null>(null);
  const [revPeriod, setRevPeriod] = useState('30d');
  const [aiData, setAiData] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logSource, setLogSource] = useState('all');
  const [reportStatus, setReportStatus] = useState('');

  // ── Auth ──
  useEffect(() => {
    const saved = getAdminSecretFromSession();
    if (saved) setSecret(saved);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  const h = useCallback(() => adminHeaders(secret), [secret]);

  // ── Fetchers ──
  const fetchCommand = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/internal/admin/command-center', { headers: h() });
    if (res.ok) setCommand(await res.json());
    setLoading(false);
  }, [h]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
    if (userSearch) p.set('search', userSearch);
    if (userGrade) p.set('grade', userGrade);
    if (userPlan) p.set('plan', userPlan);
    const res = await fetch(`/api/internal/admin/users?${p}`, { headers: h() });
    if (res.ok) { const d = await res.json(); setUsers(d.data || []); setUserTotal(d.total || 0); }
    setLoading(false);
  }, [h, userRole, userPage, userSearch, userGrade, userPlan]);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({
      resource: contentView, page: String(contentPage), limit: '25',
    });
    if (contentSubject) p.set('subject', contentSubject);
    if (contentGrade) p.set('grade', contentGrade);
    if (contentSearch) p.set('search', contentSearch);
    const res = await fetch(`/api/internal/admin/content?${p}`, { headers: h() });
    if (res.ok) {
      const d = await res.json();
      if (contentView === 'topics') { setTopics(d.data || []); setTopicTotal(d.total || 0); }
      else { setQuestions(d.data || []); setQuestionTotal(d.total || 0); }
    }
    setLoading(false);
  }, [h, contentView, contentPage, contentSubject, contentGrade, contentSearch]);

  const fetchSchools = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/internal/admin/schools?limit=25', { headers: h() });
    if (res.ok) { const d = await res.json(); setSchools(d.data || []); setSchoolTotal(d.total || 0); }
    setLoading(false);
  }, [h]);

  const fetchRevenue = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/internal/admin/revenue?period=${revPeriod}`, { headers: h() });
    if (res.ok) setRevenue(await res.json());
    setLoading(false);
  }, [h, revPeriod]);

  const fetchAI = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/internal/admin/ai-monitor', { headers: h() });
    if (res.ok) setAiData(await res.json());
    setLoading(false);
  }, [h]);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/internal/admin/feature-flags', { headers: h() });
    if (res.ok) { const d = await res.json(); setFlags(d.data || []); }
    setLoading(false);
  }, [h]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/internal/admin/support?status=${ticketStatus}&page=${ticketPage}&limit=25`, { headers: h() });
    if (res.ok) { const d = await res.json(); setTickets(d.data || []); setTicketTotal(d.total || 0); }
    setLoading(false);
  }, [h, ticketStatus, ticketPage]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/internal/admin/logs?source=${logSource}&page=${logPage}&limit=25`, { headers: h() });
    if (res.ok) { const d = await res.json(); setLogs(d.data || []); setLogTotal(d.total || 0); }
    setLoading(false);
  }, [h, logSource, logPage]);

  // Auto-load on tab switch
  useEffect(() => {
    if (!secret) return;
    if (tab === 'command') fetchCommand();
    else if (tab === 'users') fetchUsers();
    else if (tab === 'content') fetchContent();
    else if (tab === 'schools') fetchSchools();
    else if (tab === 'revenue') fetchRevenue();
    else if (tab === 'ai') fetchAI();
    else if (tab === 'flags') fetchFlags();
    else if (tab === 'support') fetchTickets();
    else if (tab === 'logs') fetchLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, tab]);

  // Re-fetch when filters change
  useEffect(() => { if (secret && tab === 'users') fetchUsers(); }, [secret, tab, userRole, userPage, userSearch, userGrade, userPlan, fetchUsers]);
  useEffect(() => { if (secret && tab === 'content') fetchContent(); }, [secret, tab, contentView, contentPage, contentSubject, contentGrade, contentSearch, fetchContent]);
  useEffect(() => { if (secret && tab === 'revenue') fetchRevenue(); }, [secret, tab, revPeriod, fetchRevenue]);
  useEffect(() => { if (secret && tab === 'support') fetchTickets(); }, [secret, tab, ticketStatus, ticketPage, fetchTickets]);
  useEffect(() => { if (secret && tab === 'logs') fetchLogs(); }, [secret, tab, logSource, logPage, fetchLogs]);

  // ── Bulk actions ──
  const bulkAction = async (action: string, extras?: Record<string, unknown>) => {
    const ids = Array.from(selectedUsers);
    if (ids.length === 0) { showToast('No users selected'); return; }
    const res = await fetch('/api/internal/admin/bulk-action', {
      method: 'POST', headers: h(),
      body: JSON.stringify({ action, ids, ...extras }),
    });
    const d = await res.json();
    showToast(res.ok ? `Done: ${d.affected} users affected` : `Error: ${d.error}`);
    setSelectedUsers(new Set());
    fetchUsers();
  };

  // ── Feature flag toggle ──
  const toggleFlag = async (flag: FeatureFlag) => {
    await fetch('/api/internal/admin/feature-flags', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ id: flag.id, is_enabled: !flag.is_enabled }),
    });
    showToast(`Flag "${flag.name}" ${!flag.is_enabled ? 'enabled' : 'disabled'}`);
    fetchFlags();
  };

  // ── Support ticket update ──
  const resolveTicket = async (id: string) => {
    await fetch('/api/internal/admin/support', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ id, status: 'resolved' }),
    });
    showToast('Ticket resolved');
    fetchTickets();
  };

  // ── Report download ──
  const downloadReport = async (type: string, format: string) => {
    setReportStatus(`Generating ${type} report...`);
    try {
      const res = await fetch(`/api/internal/admin/reports?type=${type}&format=${format}`, { headers: h() });
      if (!res.ok) { setReportStatus('Failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `alfanumrik-${type}-${Date.now()}.${format}`;
      a.click(); URL.revokeObjectURL(url);
      setReportStatus(`✓ ${type} downloaded`);
      setTimeout(() => setReportStatus(''), 3000);
    } catch { setReportStatus('Download failed'); }
  };

  if (!secret) return <LoginScreen onLogin={setSecret} />;

  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: 'command', icon: '⚡', label: 'Command Center' },
    { key: 'users', icon: '👥', label: 'Users' },
    { key: 'content', icon: '📚', label: 'Content CMS' },
    { key: 'schools', icon: '🏫', label: 'Schools' },
    { key: 'revenue', icon: '💰', label: 'Revenue' },
    { key: 'ai', icon: '🤖', label: 'AI Monitor' },
    { key: 'flags', icon: '🚩', label: 'Feature Flags' },
    { key: 'support', icon: '🎫', label: 'Support' },
    { key: 'logs', icon: '🔍', label: 'Audit Logs' },
    { key: 'reports', icon: '📋', label: 'Reports' },
  ];

  return (
    <div style={S.page}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', fontSize: 12, color: C.text1, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🦊</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.orange, letterSpacing: 0.5 }}>ALFANUMRIK</div>
            <div style={{ fontSize: 9, color: C.text3, letterSpacing: 2, textTransform: 'uppercase' }}>Super Admin Console</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {loading && <span style={{ fontSize: 10, color: C.orange }}>● LIVE</span>}
          <span style={{ fontSize: 10, color: C.text3 }}>{new Date().toLocaleString()}</span>
          <button onClick={() => { clearAdminSession(); setSecret(''); }} style={{ ...S.btn(C.red), padding: '5px 10px', fontSize: 10 }}>Sign Out</button>
        </div>
      </header>

      <div style={{ display: 'flex' }}>
        {/* Sidebar */}
        <nav style={S.sidebar}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={S.navItem(tab === t.key)}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main style={S.content}>

          {/* ═══════ COMMAND CENTER ═══════ */}
          {tab === 'command' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>Command Center</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>Live platform health — refreshes on tab visit</div>
                </div>
                <button onClick={fetchCommand} style={S.btn()}>↻ Refresh</button>
              </div>

              {command ? (
                <>
                  {/* KPI Row 1 — Platform */}
                  <div style={S.h2}>Platform Scale</div>
                  <div style={{ ...S.gridAuto, marginBottom: 20 }}>
                    <KPI label="Active Students" value={command.totals.students} color={C.orange} />
                    <KPI label="Teachers" value={command.totals.teachers} color={C.blue} />
                    <KPI label="Parents" value={command.totals.guardians} color={C.green} />
                    <KPI label="Schools" value={command.totals.schools} color={C.purple} />
                    <KPI label="Premium Users" value={command.totals.premium_students} color={C.yellow} sub={`${command.totals.basic_students} Basic`} />
                  </div>

                  {/* KPI Row 2 — Activity */}
                  <div style={S.h2}>Today's Activity</div>
                  <div style={{ ...S.gridAuto, marginBottom: 20 }}>
                    <KPI label="DAU" value={command.activity.dau} color={C.orange} sparkData={command.sparkline.map(s => s.quizzes)} />
                    <KPI label="WAU" value={command.activity.wau} color={C.blue} />
                    <KPI label="New Signups (24h)" value={command.activity.new_students_24h} color={C.green} sub={`+${command.activity.new_students_7d} this week`} />
                    <KPI label="Quiz Sessions (24h)" value={command.activity.quiz_sessions_24h} color={C.yellow} />
                    <KPI label="AI Chats (24h)" value={command.activity.chat_sessions_24h} color={C.purple} />
                  </div>

                  {/* Bottom row — AI + Revenue + Support */}
                  <div style={S.grid3}>
                    <div style={S.card}>
                      <div style={S.h2}>AI Engine</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.purple }}>{command.ai.calls_last_1h}</div>
                      <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>CALLS THIS HOUR</div>
                      <div style={{ fontSize: 12, color: C.text2, marginTop: 8 }}>{command.ai.calls_last_24h.toLocaleString()} in last 24h</div>
                    </div>
                    <div style={S.card}>
                      <div style={S.h2}>Revenue</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>₹{Math.round(command.revenue.today_inr).toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>TODAY</div>
                      <div style={{ fontSize: 12, color: C.text2, marginTop: 8 }}>
                        ₹{Math.round(command.revenue.last_7d_inr).toLocaleString()} (7d) · ₹{Math.round(command.revenue.last_30d_inr).toLocaleString()} (30d)
                      </div>
                    </div>
                    <div style={S.card}>
                      <div style={S.h2}>Support Queue</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: command.support.open_tickets > 5 ? C.red : C.green }}>
                        {command.support.open_tickets}
                      </div>
                      <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>OPEN TICKETS</div>
                      <button onClick={() => setTab('support')} style={{ ...S.btn(), marginTop: 10, fontSize: 11 }}>View Queue →</button>
                    </div>
                  </div>

                  {/* Sparkline chart */}
                  {command.sparkline.length > 0 && (
                    <div style={{ ...S.card, marginTop: 16 }}>
                      <div style={{ ...S.h2, marginBottom: 10 }}>Quiz Activity — Last 7 Days</div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
                        {command.sparkline.map((s, i) => {
                          const max = Math.max(...command.sparkline.map(x => x.quizzes), 1);
                          const h = Math.max(4, Math.round((s.quizzes / max) * 56));
                          return (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <div style={{ width: '100%', height: h, background: `${C.orange}80`, borderRadius: 3, minHeight: 4 }} title={`${s.quizzes} quizzes`} />
                              <div style={{ fontSize: 9, color: C.text3 }}>{s.date.slice(5)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: C.text3 }}>
                  {loading ? '⟳ Loading metrics...' : 'No data. Click Refresh.'}
                </div>
              )}
            </div>
          )}

          {/* ═══════ USERS ═══════ */}
          {tab === 'users' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>User Management</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selectedUsers.size > 0 && (
                    <>
                      <button onClick={() => bulkAction('suspend')} style={S.btnDanger}>⛔ Suspend {selectedUsers.size}</button>
                      <button onClick={() => bulkAction('restore')} style={S.btn(C.green)}>✅ Restore {selectedUsers.size}</button>
                      <button onClick={() => bulkAction('upgrade_plan', { plan: 'premium' })} style={S.btn(C.yellow)}>⭐ → Premium</button>
                    </>
                  )}
                  <button onClick={fetchUsers} style={S.btn()}>↻</button>
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {['student', 'teacher', 'parent'].map(r => (
                  <button key={r} onClick={() => { setUserRole(r === 'parent' ? 'guardian' : r); setUserPage(1); }}
                    style={{ ...S.btn(), ...(userRole === (r === 'parent' ? 'guardian' : r) ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
                    {r === 'student' ? '🎓' : r === 'teacher' ? '👩‍🏫' : '👨‍👩‍👧'} {r}
                  </button>
                ))}
                <input value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserPage(1); }}
                  placeholder="Search name..." style={{ ...S.input, width: 160 }} />
                {userRole === 'student' && (
                  <>
                    <select value={userGrade} onChange={e => { setUserGrade(e.target.value); setUserPage(1); }} style={S.select}>
                      <option value="">All Grades</option>
                      {['6','7','8','9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                    </select>
                    <select value={userPlan} onChange={e => { setUserPlan(e.target.value); setUserPage(1); }} style={S.select}>
                      <option value="">All Plans</option>
                      <option value="free">Free</option>
                      <option value="basic">Basic</option>
                      <option value="premium">Premium</option>
                    </select>
                  </>
                )}
              </div>

              <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>
                {userTotal.toLocaleString()} users
                {selectedUsers.size > 0 && ` · ${selectedUsers.size} selected`}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}><input type="checkbox" onChange={e => setSelectedUsers(e.target.checked ? new Set(users.map(u => u.id)) : new Set())} /></th>
                      <th style={S.th}>Name</th>
                      <th style={S.th}>Email</th>
                      {userRole === 'student' && <><th style={S.th}>Grade</th><th style={S.th}>XP</th><th style={S.th}>Plan</th><th style={S.th}>Streak</th></>}
                      <th style={S.th}>Status</th>
                      <th style={S.th}>Joined</th>
                      <th style={S.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr><td colSpan={10} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.text3 }}>No users found</td></tr>
                    )}
                    {users.map(u => (
                      <tr key={u.id} style={{ background: selectedUsers.has(u.id) ? `${C.orange}08` : 'transparent' }}>
                        <td style={S.td}>
                          <input type="checkbox" checked={selectedUsers.has(u.id)}
                            onChange={e => { const s = new Set(selectedUsers); e.target.checked ? s.add(u.id) : s.delete(u.id); setSelectedUsers(s); }} />
                        </td>
                        <td style={{ ...S.td, fontWeight: 600, color: C.text1 }}>{u.name || '—'}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{u.email || '—'}</td>
                        {userRole === 'student' && (
                          <>
                            <td style={S.td}>{u.grade || '—'}</td>
                            <td style={S.td}><span style={{ color: C.yellow, fontWeight: 700 }}>{(u.xp_total ?? 0).toLocaleString()}</span></td>
                            <td style={S.td}>
                              <span style={S.badge(u.subscription_plan === 'premium' ? C.yellow : u.subscription_plan === 'basic' ? C.blue : C.text3)}>
                                {u.subscription_plan || 'free'}
                              </span>
                            </td>
                            <td style={S.td}>{u.streak_days ?? 0}🔥</td>
                          </>
                        )}
                        <td style={S.td}>
                          <span style={S.badge(u.is_active !== false ? C.green : C.red)}>
                            {u.is_active !== false ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: C.text3 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                        <td style={S.td}>
                          <button onClick={() => setSelectedUser(u)} style={{ ...S.btn(), padding: '4px 10px', fontSize: 11 }}>View →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
                <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={S.btn()}>← Prev</button>
                <span style={{ fontSize: 12, color: C.text3 }}>Page {userPage} / {Math.max(1, Math.ceil(userTotal / 25))}</span>
                <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={S.btn()}>Next →</button>
              </div>
            </div>
          )}

          {/* ═══════ CONTENT CMS ═══════ */}
          {tab === 'content' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Content CMS</div>
                <button onClick={fetchContent} style={S.btn()}>↻ Refresh</button>
              </div>

              {/* View toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {(['topics', 'questions'] as const).map(v => (
                  <button key={v} onClick={() => { setContentView(v); setContentPage(1); }}
                    style={{ ...S.btn(), ...(contentView === v ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
                    {v === 'topics' ? '📖 Topics' : '❓ Questions'}
                  </button>
                ))}
                <select value={contentSubject} onChange={e => { setContentSubject(e.target.value); setContentPage(1); }} style={S.select}>
                  <option value="">All Subjects</option>
                  {['math', 'science', 'english', 'social_science', 'hindi'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select value={contentGrade} onChange={e => { setContentGrade(e.target.value); setContentPage(1); }} style={S.select}>
                  <option value="">All Grades</option>
                  {['6','7','8','9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <input value={contentSearch} onChange={e => { setContentSearch(e.target.value); setContentPage(1); }}
                  placeholder="Search..." style={{ ...S.input, width: 180 }} />
              </div>

              {contentView === 'topics' && (
                <>
                  <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{topicTotal} topics</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Subject</th><th style={S.th}>Grade</th>
                          <th style={S.th}>Ch.</th><th style={S.th}>Title</th>
                          <th style={S.th}>Order</th><th style={S.th}>Difficulty</th>
                          <th style={S.th}>Est. Min</th><th style={S.th}>Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topics.map(t => (
                          <tr key={t.id}>
                            <td style={S.td}>{t.subject?.code || '—'}</td>
                            <td style={S.td}>{t.grade}</td>
                            <td style={S.td}>{t.chapter_number}</td>
                            <td style={{ ...S.td, fontWeight: 600, color: C.text1, maxWidth: 260 }}>{t.title}</td>
                            <td style={S.td}>{t.display_order}</td>
                            <td style={S.td}><span style={S.badge(t.difficulty_level === 'hard' ? C.red : t.difficulty_level === 'medium' ? C.yellow : C.green)}>{t.difficulty_level || '—'}</span></td>
                            <td style={S.td}>{t.estimated_minutes || '—'}</td>
                            <td style={S.td}><span style={S.badge(t.is_active ? C.green : C.text3)}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {contentView === 'questions' && (
                <>
                  <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{questionTotal} questions</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Subject</th><th style={S.th}>Grade</th>
                          <th style={S.th}>Ch.</th><th style={S.th}>Question</th>
                          <th style={S.th}>Type</th><th style={S.th}>Difficulty</th>
                          <th style={S.th}>Bloom</th><th style={S.th}>Active</th><th style={S.th}>Verified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.map(q => (
                          <tr key={q.id}>
                            <td style={S.td}>{q.subject}</td>
                            <td style={S.td}>{q.grade}</td>
                            <td style={S.td}>{q.chapter_number}</td>
                            <td style={{ ...S.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.question_text}</td>
                            <td style={S.td}><span style={S.badge(C.blue)}>{q.question_type}</span></td>
                            <td style={S.td}><span style={S.badge(q.difficulty === 'hard' ? C.red : q.difficulty === 'medium' ? C.yellow : C.green)}>{q.difficulty || '—'}</span></td>
                            <td style={S.td}>{q.bloom_level || '—'}</td>
                            <td style={S.td}><span style={S.badge(q.is_active ? C.green : C.red)}>{q.is_active ? 'Yes' : 'No'}</span></td>
                            <td style={S.td}><span style={S.badge(q.is_verified ? C.green : C.text3)}>{q.is_verified ? '✓' : '—'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
                <button disabled={contentPage <= 1} onClick={() => setContentPage(p => p - 1)} style={S.btn()}>← Prev</button>
                <span style={{ fontSize: 12, color: C.text3 }}>Page {contentPage}</span>
                <button disabled={(contentView === 'topics' ? topics : questions).length < 25} onClick={() => setContentPage(p => p + 1)} style={S.btn()}>Next →</button>
              </div>
            </div>
          )}

          {/* ═══════ SCHOOLS ═══════ */}
          {tab === 'schools' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>School Management</div>
                <button onClick={fetchSchools} style={S.btn()}>↻ Refresh</button>
              </div>
              <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>{schoolTotal} schools</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {schools.map((s: Record<string, unknown>, i) => (
                  <div key={i} style={{ ...S.card, borderTop: `2px solid ${C.blue}` }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{s.name as string || '—'}</div>
                    <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{s.city as string || ''} · {s.state as string || ''}</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div><span style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{s.teacher_count as number ?? 0}</span><br/><span style={{ fontSize: 9, color: C.text3 }}>TEACHERS</span></div>
                      <div><span style={{ fontSize: 18, fontWeight: 700, color: C.orange }}>{s.student_count as number ?? 0}</span><br/><span style={{ fontSize: 9, color: C.text3 }}>STUDENTS</span></div>
                    </div>
                  </div>
                ))}
                {schools.length === 0 && !loading && (
                  <div style={{ color: C.text3, fontSize: 12, padding: 20 }}>No schools found</div>
                )}
              </div>
            </div>
          )}

          {/* ═══════ REVENUE ═══════ */}
          {tab === 'revenue' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Revenue & Subscriptions</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['7d', '30d', '90d'] as const).map(p => (
                    <button key={p} onClick={() => setRevPeriod(p)}
                      style={{ ...S.btn(C.green), ...(revPeriod === p ? { background: `${C.green}20`, borderColor: C.green } : {}) }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {revenue && (
                <>
                  <div style={{ ...S.gridAuto, marginBottom: 20 }}>
                    <KPI label={`Revenue (${revPeriod})`} value={`₹${Math.round(revenue.total_revenue_inr as number).toLocaleString()}`} color={C.green} />
                    <KPI label="Premium Users" value={revenue.premium_count as number} color={C.yellow} />
                    {Object.entries((revenue.plan_distribution as Record<string, number>) || {}).map(([plan, count]) => (
                      <KPI key={plan} label={`${plan} plan`} value={count} color={plan === 'premium' ? C.yellow : plan === 'basic' ? C.blue : C.text3} />
                    ))}
                  </div>

                  {/* Bar chart of daily revenue */}
                  <div style={{ ...S.card }}>
                    <div style={{ ...S.h2 }}>Daily Revenue — {revPeriod}</div>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80, overflowX: 'auto' }}>
                      {((revenue.daily_revenue as Array<{ date: string; amount_inr: number }>) || []).map((d, i) => {
                        const maxAmt = Math.max(...((revenue.daily_revenue as Array<{ amount_inr: number }>) || []).map(x => x.amount_inr), 1);
                        const barH = Math.max(4, Math.round((d.amount_inr / maxAmt) * 72));
                        return (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 20, flex: 1 }}>
                            <div style={{ width: '80%', height: barH, background: `${C.green}80`, borderRadius: 2 }} title={`₹${d.amount_inr} on ${d.date}`} />
                            <div style={{ fontSize: 8, color: C.text3, transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>
                              {d.date.slice(5)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════ AI MONITOR ═══════ */}
          {tab === 'ai' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>AI Monitor</div>
                <button onClick={fetchAI} style={S.btn(C.purple)}>↻ Refresh</button>
              </div>

              {aiData && (
                <>
                  <div style={{ ...S.gridAuto, marginBottom: 20 }}>
                    <KPI label="Total Requests (24h)" value={(aiData.summary as Record<string, number>)?.total_requests_24h ?? 0} color={C.purple} />
                    <KPI label="Errors (24h)" value={(aiData.summary as Record<string, number>)?.total_errors_24h ?? 0} color={C.red} />
                    <KPI label="Error Rate" value={`${(aiData.summary as Record<string, number>)?.error_rate_pct ?? 0}%`} color={C.yellow} />
                  </div>

                  <div style={S.grid2}>
                    {/* Hourly chart */}
                    <div style={S.card}>
                      <div style={S.h2}>Hourly Requests — Last 24h</div>
                      <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 60 }}>
                        {((aiData.hourly as Array<Record<string, unknown>>) || []).map((h, i) => {
                          const maxReq = Math.max(...((aiData.hourly as Array<Record<string, unknown>>) || []).map(x => Number(x.requests)), 1);
                          const barH = Math.max(3, Math.round((Number(h.requests) / maxReq) * 56));
                          return (
                            <div key={i} style={{ flex: 1, height: barH, background: `${C.purple}70`, borderRadius: 1 }}
                              title={`${h.requests} calls at ${h.hour}`} />
                          );
                        })}
                      </div>
                    </div>

                    {/* Subject heat-map */}
                    <div style={S.card}>
                      <div style={S.h2}>Top Subjects (24h)</div>
                      {((aiData.top_subjects as Array<{ subject: string; count: number }>) || []).map((s, i) => {
                        const max = ((aiData.top_subjects as Array<{ count: number }>) || [])[0]?.count || 1;
                        return (
                          <div key={i} style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                              <span>{s.subject}</span><span style={{ color: C.purple, fontWeight: 600 }}>{s.count}</span>
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: C.border }}>
                              <div style={{ height: '100%', width: `${(s.count / max) * 100}%`, background: C.purple, borderRadius: 2 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════ FEATURE FLAGS ═══════ */}
          {tab === 'flags' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Feature Flags</div>
                <button onClick={fetchFlags} style={S.btn()}>↻ Refresh</button>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {flags.map(flag => (
                  <div key={flag.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{flag.name}</div>
                      <div style={{ fontSize: 11, color: C.text3, marginBottom: 6 }}>{flag.description}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={S.badge(flag.rollout_percentage === 100 ? C.green : C.yellow)}>
                          {flag.rollout_percentage}% rollout
                        </span>
                        {flag.target_grades && <span style={S.badge(C.blue)}>Grades: {flag.target_grades.join(', ')}</span>}
                        {flag.target_roles && <span style={S.badge(C.purple)}>Roles: {flag.target_roles.join(', ')}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: flag.is_enabled ? C.green : C.text3, fontWeight: 600 }}>
                        {flag.is_enabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                      <button onClick={() => toggleFlag(flag)}
                        style={{ ...S.btn(flag.is_enabled ? C.red : C.green) }}>
                        {flag.is_enabled ? '⏸ Disable' : '▶ Enable'}
                      </button>
                    </div>
                  </div>
                ))}
                {flags.length === 0 && !loading && (
                  <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>No feature flags configured</div>
                )}
              </div>
            </div>
          )}

          {/* ═══════ SUPPORT ═══════ */}
          {tab === 'support' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Support Tickets</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['open', 'pending', 'resolved', 'all'].map(s => (
                    <button key={s} onClick={() => { setTicketStatus(s); setTicketPage(1); }}
                      style={{ ...S.btn(), ...(ticketStatus === s ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
                      {s}
                    </button>
                  ))}
                  <button onClick={fetchTickets} style={S.btn()}>↻</button>
                </div>
              </div>

              <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>{ticketTotal} tickets</div>

              <div style={{ display: 'grid', gap: 10 }}>
                {tickets.map(t => (
                  <div key={t.id} style={{ ...S.card, borderLeft: `3px solid ${t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{t.subject || 'No subject'}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={S.badge(t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green)}>{t.status}</span>
                        {t.status !== 'resolved' && (
                          <button onClick={() => resolveTicket(t.id)} style={S.btn(C.green)}>✓ Resolve</button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.text2, marginBottom: 6 }}>{t.message}</div>
                    <div style={{ fontSize: 10, color: C.text3 }}>{new Date(t.created_at).toLocaleString()}</div>
                    {t.admin_notes && <div style={{ fontSize: 11, color: C.blue, marginTop: 6, padding: '4px 8px', background: `${C.blue}10`, borderRadius: 4 }}>Note: {t.admin_notes}</div>}
                  </div>
                ))}
                {tickets.length === 0 && !loading && (
                  <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>No tickets in this queue</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
                <button disabled={ticketPage <= 1} onClick={() => setTicketPage(p => p - 1)} style={S.btn()}>← Prev</button>
                <span style={{ fontSize: 12, color: C.text3 }}>Page {ticketPage} / {Math.max(1, Math.ceil(ticketTotal / 25))}</span>
                <button disabled={tickets.length < 25} onClick={() => setTicketPage(p => p + 1)} style={S.btn()}>Next →</button>
              </div>
            </div>
          )}

          {/* ═══════ AUDIT LOGS ═══════ */}
          {tab === 'logs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Audit Logs</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['all', 'admin'].map(s => (
                    <button key={s} onClick={() => { setLogSource(s); setLogPage(1); }}
                      style={{ ...S.btn(), ...(logSource === s ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
                      {s === 'all' ? '👤 User Logs' : '🔑 Admin Logs'}
                    </button>
                  ))}
                  <button onClick={() => downloadReport('audit', 'csv')} style={S.btn(C.green)}>⬇ Export CSV</button>
                  <button onClick={fetchLogs} style={S.btn()}>↻</button>
                </div>
              </div>

              <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>{logTotal.toLocaleString()} total entries</div>

              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Time</th>
                      <th style={S.th}>Action</th>
                      <th style={S.th}>{logSource === 'admin' ? 'Entity Type' : 'Resource'}</th>
                      <th style={S.th}>Status</th>
                      <th style={S.th}>Actor</th>
                      <th style={S.th}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td style={{ ...S.td, fontSize: 10, whiteSpace: 'nowrap', color: C.text3 }}>{new Date(l.created_at).toLocaleString()}</td>
                        <td style={S.td}><code style={{ color: C.orange, background: `${C.orange}15`, padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>{l.action}</code></td>
                        <td style={S.td}>{l.resource_type || l.entity_type || '—'}</td>
                        <td style={S.td}>
                          {l.status && <span style={S.badge(l.status === 'success' ? C.green : l.status === 'denied' ? C.red : C.yellow)}>{l.status}</span>}
                        </td>
                        <td style={{ ...S.td, fontSize: 10 }}><code>{(l.auth_user_id || l.admin_id || '—').slice(0, 12)}</code></td>
                        <td style={{ ...S.td, fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {l.details ? JSON.stringify(l.details).slice(0, 80) : '—'}
                        </td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.text3 }}>No logs found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
                <button disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)} style={S.btn()}>← Prev</button>
                <span style={{ fontSize: 12, color: C.text3 }}>Page {logPage} / {Math.max(1, Math.ceil(logTotal / 25))}</span>
                <button disabled={logs.length < 25} onClick={() => setLogPage(p => p + 1)} style={S.btn()}>Next →</button>
              </div>
            </div>
          )}

          {/* ═══════ REPORTS ═══════ */}
          {tab === 'reports' && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Reports & Exports</div>
              {reportStatus && (
                <div style={{ padding: '8px 14px', borderRadius: 8, background: reportStatus.includes('fail') ? `${C.red}15` : `${C.green}15`,
                  color: reportStatus.includes('fail') ? C.red : C.green, fontSize: 12, marginBottom: 16, border: `1px solid ${reportStatus.includes('fail') ? C.red : C.green}30` }}>
                  {reportStatus}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {[
                  { type: 'students', icon: '🎓', label: 'Student Records', desc: 'Names, grades, XP, plans, status' },
                  { type: 'teachers', icon: '👩‍🏫', label: 'Teacher Records', desc: 'Names, schools, active status' },
                  { type: 'parents', icon: '👨‍👩‍👧', label: 'Parent Records', desc: 'Names, emails, contact info' },
                  { type: 'quizzes', icon: '⚡', label: 'Quiz Sessions', desc: 'Scores, subjects, completion' },
                  { type: 'chats', icon: '🤖', label: 'AI Chat Sessions', desc: 'Subjects, message counts' },
                  { type: 'audit', icon: '🔍', label: 'Audit Trail', desc: 'All user & admin actions' },
                ].map(r => (
                  <div key={r.type} style={S.card}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{r.icon} {r.label}</div>
                    <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>{r.desc}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => downloadReport(r.type, 'csv')} style={{ ...S.btn(C.green), flex: 1 }}>⬇ CSV</button>
                      <button onClick={() => downloadReport(r.type, 'json')} style={{ ...S.btn(C.blue), flex: 1 }}>⬇ JSON</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>

      {/* User Detail Drawer */}
      {selectedUser && (
        <UserDrawer
          student={selectedUser}
          secret={secret}
          onClose={() => setSelectedUser(null)}
          onRefresh={fetchUsers}
        />
      )}
    </div>
  );
}
