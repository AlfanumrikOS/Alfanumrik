'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK CMS — Content Management System for Super Admin
   Hierarchy: Board → Grade → Subject → Chapter → Topic
   Workflow: Draft → Review → Published → Archived
   Protected via Supabase session + admin_users DB verification.
   ═══════════════════════════════════════════════════════════════ */

type View = 'overview' | 'topics' | 'questions' | 'versions';

interface Subject { id: string; code: string; name: string; icon: string; color: string; is_active: boolean; }
interface Topic {
  id: string; title: string; title_hi: string | null; grade: string; subject_id: string;
  parent_topic_id: string | null; chapter_number: number | null; display_order: number;
  topic_type: string; content_status: string; is_active: boolean; difficulty_level: number;
  bloom_focus: string; tags: string[]; description: string | null;
  created_at: string; updated_at: string | null; created_by: string | null; updated_by: string | null;
  reviewed_by: string | null; published_by: string | null; published_at: string | null;
}
interface Question {
  id: string; question_text: string; question_hi: string | null; question_type: string;
  options: unknown; correct_answer_index: number; correct_answer_text: string | null;
  explanation: string | null; hint: string | null; difficulty: number; bloom_level: string;
  grade: string; subject: string; tags: string[]; marks: number | null;
  content_status: string; is_active: boolean; is_verified: boolean;
  created_at: string; updated_at: string | null; created_by: string | null; reviewed_by: string | null;
}
interface Version {
  id: string; version_number: number; status: string; change_summary: string | null;
  created_by: string | null; created_at: string;
}
interface CmsStats { topics: number; questions: number; workflow: { published: number; draft: number; review: number; archived: number; }; }

const GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#F59E0B20', fg: '#F59E0B' },
  review: { bg: '#3B82F620', fg: '#3B82F6' },
  published: { bg: '#16A34A20', fg: '#16A34A' },
  archived: { bg: '#6B728020', fg: '#6B7280' },
};

export default function CmsPage() {
  const [view, setView] = useState<View>('overview');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [stats, setStats] = useState<CmsStats | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [topicTotal, setTopicTotal] = useState(0);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [filterGrade, setFilterGrade] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [page, setPage] = useState(1);

  // Version viewer
  const [versionEntityType, setVersionEntityType] = useState('');
  const [versionEntityId, setVersionEntityId] = useState('');

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAccessToken(session.access_token);
      else window.location.href = '/super-admin/login';
    });
  }, [supabase]);

  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  }), [accessToken]);

  const api = useCallback(async (params: string) => {
    const res = await fetch(`/api/super-admin/cms?${params}`, { headers: h() });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [h]);

  const apiPost = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/super-admin/cms?action=${action}`, { method: 'POST', headers: h(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [h]);

  const apiPatch = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/super-admin/cms?action=${action}`, { method: 'PATCH', headers: h(), body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [h]);

  // ── Data loaders ──
  const loadStats = useCallback(async () => {
    if (!accessToken) return;
    try { setStats(await api('action=stats')); } catch { /* */ }
  }, [accessToken, api]);

  const loadSubjects = useCallback(async () => {
    if (!accessToken) return;
    try { const r = await api('action=subjects'); setSubjects(r.data || []); } catch { /* */ }
  }, [accessToken, api]);

  const loadTopics = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ action: 'topics', page: String(page), limit: '25' });
      if (filterGrade) p.set('grade', filterGrade);
      if (filterSubject) p.set('subject_id', filterSubject);
      if (filterStatus) p.set('status', filterStatus);
      if (filterSearch) p.set('search', filterSearch);
      const r = await api(p.toString());
      setTopics(r.data || []); setTopicTotal(r.total || 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); }
    setLoading(false);
  }, [accessToken, api, page, filterGrade, filterSubject, filterStatus, filterSearch]);

  const loadQuestions = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ action: 'questions', page: String(page), limit: '25' });
      if (filterGrade) p.set('grade', filterGrade);
      if (filterSubject) p.set('subject', filterSubject);
      if (filterStatus) p.set('status', filterStatus);
      if (filterSearch) p.set('search', filterSearch);
      const r = await api(p.toString());
      setQuestions(r.data || []); setQuestionTotal(r.total || 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); }
    setLoading(false);
  }, [accessToken, api, page, filterGrade, filterSubject, filterStatus, filterSearch]);

  const loadVersions = useCallback(async () => {
    if (!accessToken || !versionEntityType || !versionEntityId) return;
    setLoading(true);
    try {
      const r = await api(`action=versions&entity_type=${versionEntityType}&entity_id=${versionEntityId}`);
      setVersions(r.data || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); }
    setLoading(false);
  }, [accessToken, api, versionEntityType, versionEntityId]);

  useEffect(() => {
    if (!accessToken) return;
    loadStats();
    loadSubjects();
  }, [accessToken, loadStats, loadSubjects]);

  useEffect(() => {
    if (view === 'topics') loadTopics();
    if (view === 'questions') loadQuestions();
    if (view === 'versions') loadVersions();
  }, [view, loadTopics, loadQuestions, loadVersions]);

  // ── Actions ──
  const transitionStatus = async (entityType: string, entityId: string, newStatus: string) => {
    try {
      await apiPost('transition', { entity_type: entityType, entity_id: entityId, new_status: newStatus });
      if (view === 'topics') loadTopics(); else loadQuestions();
      loadStats();
    } catch (e) { alert(e instanceof Error ? e.message : 'Transition failed'); }
  };

  const rollbackVersion = async (versionId: string) => {
    if (!confirm('Rollback to this version? Current state will be saved as a new version first.')) return;
    try {
      await apiPost('rollback', { version_id: versionId });
      alert('Rollback successful. Content reset to draft for review.');
      loadVersions();
    } catch (e) { alert(e instanceof Error ? e.message : 'Rollback failed'); }
  };

  const openVersions = (entityType: string, entityId: string) => {
    setVersionEntityType(entityType);
    setVersionEntityId(entityId);
    setView('versions');
  };

  if (!accessToken) return <div style={S.center}><p style={{ color: '#888' }}>Loading...</p></div>;

  const StatusBadge = ({ status }: { status: string }) => {
    const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
    return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.fg, fontWeight: 600 }}>{status}</span>;
  };

  const TransitionButtons = ({ entityType, entityId, currentStatus }: { entityType: string; entityId: string; currentStatus: string }) => {
    const transitions: Record<string, string[]> = {
      draft: ['review', 'archived'],
      review: ['published', 'draft'],
      published: ['archived', 'draft'],
      archived: ['draft'],
    };
    const available = transitions[currentStatus] || [];
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {available.map(s => (
          <button key={s} onClick={() => transitionStatus(entityType, entityId, s)}
            style={{ ...S.actionBtn, color: STATUS_COLORS[s]?.fg || '#888', borderColor: `${STATUS_COLORS[s]?.fg || '#888'}40`, fontSize: 10, padding: '3px 8px' }}>
            → {s}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', fontFamily: "'Plus Jakarta Sans', monospace" }}>
      {/* Header */}
      <header style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📚</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#E8581C' }}>ALFANUMRIK CMS</div>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Content Management</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/super-admin" style={{ ...S.navBtn, textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>

      {/* Nav */}
      <nav style={{ padding: '0 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 0, background: '#0f0f0f' }}>
        {[
          { key: 'overview' as View, label: 'Overview', icon: '📊' },
          { key: 'topics' as View, label: 'Topics', icon: '📝' },
          { key: 'questions' as View, label: 'Questions', icon: '❓' },
          ...(versionEntityId ? [{ key: 'versions' as View, label: 'Version History', icon: '🕐' }] : []),
        ].map(tab => (
          <button key={tab.key} onClick={() => { setView(tab.key); setPage(1); }} style={{
            padding: '12px 18px', fontSize: 12, fontWeight: view === tab.key ? 700 : 400,
            color: view === tab.key ? '#E8581C' : '#666', background: 'transparent', border: 'none',
            borderBottom: view === tab.key ? '2px solid #E8581C' : '2px solid transparent', cursor: 'pointer',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
        {loading && <div style={{ fontSize: 11, color: '#E8581C', marginBottom: 12 }}>Loading...</div>}
        {error && <div style={{ padding: '8px 14px', borderRadius: 8, background: '#2a1010', color: '#EF4444', fontSize: 12, marginBottom: 12, border: '1px solid #3a1515' }}>{error} <button onClick={() => setError('')} style={{ color: '#888', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8 }}>✕</button></div>}

        {/* ═══ OVERVIEW ═══ */}
        {view === 'overview' && stats && (
          <div>
            <h2 style={S.h2}>Content Overview</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
              <div style={{ ...S.card, borderLeft: '3px solid #E8581C' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#E8581C' }}>{stats.topics}</div>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Topics</div>
              </div>
              <div style={{ ...S.card, borderLeft: '3px solid #3B82F6' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#3B82F6' }}>{stats.questions}</div>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Questions</div>
              </div>
            </div>

            <h2 style={S.h2}>Workflow Status (Topics)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
              {Object.entries(stats.workflow).map(([status, count]) => (
                <div key={status} style={{ ...S.card, borderLeft: `3px solid ${STATUS_COLORS[status]?.fg || '#888'}`, cursor: 'pointer' }}
                  onClick={() => { setFilterStatus(status); setView('topics'); }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: STATUS_COLORS[status]?.fg || '#888' }}>{count}</div>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'capitalize' }}>{status}</div>
                </div>
              ))}
            </div>

            <h2 style={S.h2}>Subjects ({subjects.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {subjects.map(s => (
                <div key={s.id} style={{ ...S.card, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                  onClick={() => { setFilterSubject(s.id); setView('topics'); }}>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: '#888' }}>{s.code}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ TOPICS ═══ */}
        {view === 'topics' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Curriculum Topics</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setPage(1); }} style={S.select}>
                  <option value="">All Grades</option>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <select value={filterSubject} onChange={e => { setFilterSubject(e.target.value); setPage(1); }} style={S.select}>
                  <option value="">All Subjects</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={S.select}>
                  <option value="">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="review">In Review</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Search title..."
                  style={S.searchInput} onKeyDown={e => e.key === 'Enter' && loadTopics()} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{topicTotal} topics found</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Ch</th>
                    <th style={S.th}>Title</th>
                    <th style={S.th}>Grade</th>
                    <th style={S.th}>Type</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Bloom</th>
                    <th style={S.th}>Workflow</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No topics found</td></tr>}
                  {topics.map(t => (
                    <tr key={t.id}>
                      <td style={S.td}>{t.chapter_number ?? '—'}</td>
                      <td style={S.td}>
                        <strong>{t.title}</strong>
                        {t.title_hi && <div style={{ fontSize: 10, color: '#888' }}>{t.title_hi}</div>}
                      </td>
                      <td style={S.td}>{t.grade}</td>
                      <td style={S.td}><span style={{ fontSize: 10, color: '#aaa' }}>{t.topic_type}</span></td>
                      <td style={S.td}><StatusBadge status={t.content_status} /></td>
                      <td style={S.td}><span style={{ fontSize: 10, color: '#aaa' }}>{t.bloom_focus}</span></td>
                      <td style={S.td}><TransitionButtons entityType="topic" entityId={t.id} currentStatus={t.content_status} /></td>
                      <td style={S.td}>
                        <button onClick={() => openVersions('topic', t.id)} style={{ ...S.actionBtn, fontSize: 10 }}>History</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(topicTotal / 25))}</span>
              <button disabled={topics.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* ═══ QUESTIONS ═══ */}
        {view === 'questions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Question Bank</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setPage(1); }} style={S.select}>
                  <option value="">All Grades</option>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={S.select}>
                  <option value="">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="review">In Review</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Search question..."
                  style={{ ...S.searchInput, width: 250 }} onKeyDown={e => e.key === 'Enter' && loadQuestions()} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{questionTotal} questions found</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Question</th>
                    <th style={S.th}>Grade</th>
                    <th style={S.th}>Subject</th>
                    <th style={S.th}>Type</th>
                    <th style={S.th}>Diff</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Workflow</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No questions found</td></tr>}
                  {questions.map(q => (
                    <tr key={q.id}>
                      <td style={{ ...S.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.question_text.slice(0, 80)}{q.question_text.length > 80 ? '...' : ''}</td>
                      <td style={S.td}>{q.grade}</td>
                      <td style={S.td}>{q.subject}</td>
                      <td style={S.td}><span style={{ fontSize: 10 }}>{q.question_type || 'mcq'}</span></td>
                      <td style={S.td}>{q.difficulty}</td>
                      <td style={S.td}><StatusBadge status={q.content_status} /></td>
                      <td style={S.td}><TransitionButtons entityType="question" entityId={q.id} currentStatus={q.content_status} /></td>
                      <td style={S.td}>
                        <button onClick={() => openVersions('question', q.id)} style={{ ...S.actionBtn, fontSize: 10 }}>History</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(questionTotal / 25))}</span>
              <button disabled={questions.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* ═══ VERSION HISTORY ═══ */}
        {view === 'versions' && (
          <div>
            <h2 style={S.h2}>Version History — {versionEntityType} {versionEntityId.slice(0, 8)}</h2>
            <button onClick={() => setView(versionEntityType === 'topic' ? 'topics' : 'questions')} style={{ ...S.navBtn, marginBottom: 16 }}>← Back to list</button>

            {versions.length === 0 && <div style={{ ...S.card, textAlign: 'center', color: '#555', padding: 24 }}>No versions recorded yet.</div>}

            <div style={{ display: 'grid', gap: 10 }}>
              {versions.map(v => (
                <div key={v.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#E8581C' }}>v{v.version_number}</span>
                      <StatusBadge status={v.status} />
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                      {v.change_summary || 'No description'}
                    </div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                      {new Date(v.created_at).toLocaleString()}
                      {v.created_by && <span> · by {v.created_by.slice(0, 8)}</span>}
                    </div>
                  </div>
                  <button onClick={() => rollbackVersion(v.id)}
                    style={{ ...S.actionBtn, color: '#F59E0B', borderColor: '#F59E0B40' }}>
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#e0e0e0' },
  h2: { fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 12 },
  card: { padding: 16, borderRadius: 10, border: '1px solid #1e1e1e', background: '#111' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #1e1e1e', color: '#555', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.5 },
  td: { padding: '10px 12px', borderBottom: '1px solid #141414', color: '#ccc' },
  actionBtn: { background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600, color: '#888' },
  navBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#888', fontSize: 12, cursor: 'pointer' },
  pageBtn: { padding: '7px 16px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#888', fontSize: 12, cursor: 'pointer' },
  searchInput: { padding: '8px 14px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#e0e0e0', fontSize: 12, outline: 'none', width: 180 },
  select: { padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#e0e0e0', fontSize: 12, outline: 'none' },
};
