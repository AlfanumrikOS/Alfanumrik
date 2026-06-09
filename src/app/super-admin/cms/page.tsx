'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { VALID_GRADES } from '@/lib/identity';
import { toast } from '@/components/ui/toast';

// Local style constants — replaces former `S` and `colors` from admin-styles
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '2px solid #E5E7EB',
  color: '#6B7280',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1,
  background: '#F9FAFB',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #F3F4F6',
  color: '#111827',
  fontSize: 13,
};
const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 8,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
};
const searchInputStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#111827',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  width: 220,
  boxSizing: 'border-box',
};
const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#111827',
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
};
const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #E5E7EB',
  borderRadius: 5,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
  color: '#6B7280',
};
const pageBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
  background: '#FFFFFF',
  color: '#6B7280',
  fontSize: 12,
  cursor: 'pointer',
};

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

const GRADES = VALID_GRADES;
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#F9FAFB', fg: '#9CA3AF' },
  review: { bg: '#FFFBEB', fg: '#D97706' },
  published: { bg: '#F0FDF4', fg: '#16A34A' },
  archived: { bg: '#F9FAFB', fg: '#9CA3AF' },
};

function CmsContent() {
  const { apiFetch, headers: h } = useAdmin();
  const [view, setView] = useState<View>('overview');

  // Assets
  const [assets, setAssets] = useState<{ id: string; file_name: string; file_type: string; file_size: number | null; storage_path: string; alt_text: string | null; caption: string | null; created_at: string }[]>([]);
  const [assetEntityType, setAssetEntityType] = useState('');
  const [assetEntityId, setAssetEntityId] = useState('');
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetForm, setAssetForm] = useState<Record<string, string>>({});

  // Create forms
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [topicForm, setTopicForm] = useState<Record<string, string>>({});
  const [questionForm, setQuestionForm] = useState<Record<string, string>>({});

  // Version diff
  const [diffSnapshot, setDiffSnapshot] = useState<Record<string, unknown> | null>(null);
  const [diffVersionNum, setDiffVersionNum] = useState(0);
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

  const accessToken = true; // always truthy when inside AdminShell

  const api = useCallback(async (params: string) => {
    const res = await apiFetch(`/api/super-admin/cms?${params}`);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [apiFetch]);

  const apiPost = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await apiFetch(`/api/super-admin/cms?action=${action}`, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [apiFetch]);

  const apiPatch = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await apiFetch(`/api/super-admin/cms?action=${action}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    return res.json();
  }, [apiFetch]);

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
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Transition failed'); }
  };

  const rollbackVersion = async (versionId: string) => {
    if (!confirm('Rollback to this version? Current state will be saved as a new version first.')) return;
    try {
      await apiPost('rollback', { version_id: versionId });
      toast.success('Rollback successful. Content reset to draft for review.');
      loadVersions();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rollback failed'); }
  };

  const createTopic = async () => {
    if (!topicForm.title || !topicForm.grade || !topicForm.subject_id) {
      toast.error('Title, grade, and subject are required.'); return;
    }
    try {
      await apiPost('create_topic', topicForm);
      setShowCreateTopic(false); setTopicForm({});
      loadTopics(); loadStats();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Create failed'); }
  };

  const createQuestion = async () => {
    if (!questionForm.question_text || !questionForm.grade || !questionForm.subject) {
      toast.error('Question text, grade, and subject are required.'); return;
    }
    try {
      const payload = {
        ...questionForm,
        options: questionForm.options ? JSON.parse(questionForm.options) : ['A', 'B', 'C', 'D'],
        correct_answer_index: questionForm.correct_answer_index ? parseInt(questionForm.correct_answer_index) : 0,
        difficulty: questionForm.difficulty ? parseInt(questionForm.difficulty) : 1,
      };
      await apiPost('create_question', payload);
      setShowCreateQuestion(false); setQuestionForm({});
      loadQuestions(); loadStats();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Create failed'); }
  };

  const viewVersionDiff = async (versionId: string, versionNumber: number) => {
    try {
      const r = await api(`action=version_detail&version_id=${versionId}`);
      setDiffSnapshot(r.data?.snapshot || r.data || null);
      setDiffVersionNum(versionNumber);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Load failed'); }
  };

  const openVersions = (entityType: string, entityId: string) => {
    setDiffSnapshot(null);
    setVersionEntityType(entityType);
    setVersionEntityId(entityId);
    setView('versions');
  };

  const loadAssets = async (entityType: string, entityId: string) => {
    try {
      const res = await apiFetch(`/api/super-admin/platform-ops?action=assets&entity_type=${entityType}&entity_id=${entityId}`);
      if (res.ok) { const d = await res.json(); setAssets(d.data || []); }
    } catch { /* */ }
    setAssetEntityType(entityType);
    setAssetEntityId(entityId);
  };

  const registerAsset = async () => {
    if (!assetForm.file_name || !assetForm.storage_path) { toast.error('File name and storage path required'); return; }
    try {
      await apiFetch('/api/super-admin/platform-ops?action=register_asset', {
        method: 'POST',
        body: JSON.stringify({
          entity_type: assetEntityType || 'general',
          entity_id: assetEntityId || null,
          file_name: assetForm.file_name,
          file_type: assetForm.file_type || 'application/octet-stream',
          file_size: assetForm.file_size ? parseInt(assetForm.file_size) : null,
          storage_path: assetForm.storage_path,
          alt_text: assetForm.alt_text || null,
          caption: assetForm.caption || null,
        }),
      });
      setAssetForm({}); setShowAssetForm(false);
      if (assetEntityType && assetEntityId) loadAssets(assetEntityType, assetEntityId);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Register failed'); }
  };

  const deleteAsset = async (assetId: string) => {
    if (!confirm('Remove this asset?')) return;
    try {
      await apiFetch('/api/super-admin/platform-ops?action=delete_asset', {
        method: 'POST', body: JSON.stringify({ id: assetId }),
      });
      if (assetEntityType && assetEntityId) loadAssets(assetEntityType, assetEntityId);
    } catch { toast.error('Delete failed'); }
  };

  const CmsStatusBadge = ({ status }: { status: string }) => {
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
            style={{ ...actionBtnStyle, color: STATUS_COLORS[s]?.fg || '#9CA3AF', fontSize: 10, padding: '3px 8px' }}>
            &rarr; {s}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ marginBottom: 4 }}>Content Management</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>Topics, questions, versions, and assets</p>
        </div>
      </div>

      {/* Nav Tabs */}
      <nav style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${'#E5E7EB'}`, marginBottom: 20 }}>
        {[
          { key: 'overview' as View, label: 'Overview' },
          { key: 'topics' as View, label: 'Topics' },
          { key: 'questions' as View, label: 'Questions' },
          ...(versionEntityId ? [{ key: 'versions' as View, label: 'Version History' }] : []),
        ].map(tab => (
          <button key={tab.key} onClick={() => { setView(tab.key); setPage(1); }} style={{
            padding: '10px 18px', fontSize: 13, fontWeight: view === tab.key ? 700 : 400,
            color: view === tab.key ? '#111827' : '#9CA3AF', background: 'transparent', border: 'none',
            borderBottom: view === tab.key ? `2px solid ${'#111827'}` : '2px solid transparent', cursor: 'pointer',
            marginBottom: -2,
          }}>
            {tab.label}
          </button>
        ))}
      </nav>

      {loading && <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>Loading...</div>}
      {error && <div style={{ padding: '8px 14px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 12, marginBottom: 12, border: '1px solid #FECACA' }}>{error} <button onClick={() => setError('')} style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8 }}>Close</button></div>}

        {/* Overview */}
        {view === 'overview' && stats && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Content Overview</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
              <div style={{ ...cardStyle, borderLeft: `2px solid ${'#2563EB'}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#111827' }}>{stats.topics}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1 }}>Topics</div>
              </div>
              <div style={{ ...cardStyle, borderLeft: `2px solid ${'#2563EB'}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#6B7280' }}>{stats.questions}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1 }}>Questions</div>
              </div>
            </div>

            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Workflow Status (Topics)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
              {Object.entries(stats.workflow).map(([status, count]) => (
                <div key={status} style={{ ...cardStyle, borderLeft: `3px solid ${STATUS_COLORS[status]?.fg || '#9CA3AF'}`, cursor: 'pointer' }}
                  onClick={() => { setFilterStatus(status); setView('topics'); }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: STATUS_COLORS[status]?.fg || '#9CA3AF' }}>{count}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' }}>{status}</div>
                </div>
              ))}
            </div>

            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Subjects ({subjects.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {subjects.map(s => (
                <div key={s.id} style={{ ...cardStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                  onClick={() => { setFilterSubject(s.id); setView('topics'); }}>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>{s.code}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {view === 'topics' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 12, margin: 0 }}>Curriculum Topics</h2>
                <button onClick={() => { setShowCreateTopic(!showCreateTopic); setTopicForm({}); }}
                  style={{ ...actionBtnStyle, color: '#6B7280', borderColor: '#E5E7EB', fontSize: 11 }}>
                  {showCreateTopic ? '✕ Cancel' : '+ New Topic'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setPage(1); }} style={selectStyle}>
                  <option value="">All Grades</option>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <select value={filterSubject} onChange={e => { setFilterSubject(e.target.value); setPage(1); }} style={selectStyle}>
                  <option value="">All Subjects</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={selectStyle}>
                  <option value="">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="review">In Review</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Search title..."
                  style={searchInputStyle} onKeyDown={e => e.key === 'Enter' && loadTopics()} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>{topicTotal} topics found</div>

            {showCreateTopic && (
              <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `2px solid ${'#2563EB'}` }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginBottom: 12 }}>Create New Topic</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input placeholder="Title *" value={topicForm.title || ''} onChange={e => setTopicForm(f => ({ ...f, title: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Title (Hindi)" value={topicForm.title_hi || ''} onChange={e => setTopicForm(f => ({ ...f, title_hi: e.target.value }))} style={searchInputStyle} />
                  <select value={topicForm.grade || ''} onChange={e => setTopicForm(f => ({ ...f, grade: e.target.value }))} style={selectStyle}>
                    <option value="">Grade *</option>
                    {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={topicForm.subject_id || ''} onChange={e => setTopicForm(f => ({ ...f, subject_id: e.target.value }))} style={selectStyle}>
                    <option value="">Subject *</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input placeholder="Chapter number" type="number" value={topicForm.chapter_number || ''} onChange={e => setTopicForm(f => ({ ...f, chapter_number: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Display order" type="number" value={topicForm.display_order || ''} onChange={e => setTopicForm(f => ({ ...f, display_order: e.target.value }))} style={searchInputStyle} />
                  <select value={topicForm.topic_type || 'concept'} onChange={e => setTopicForm(f => ({ ...f, topic_type: e.target.value }))} style={selectStyle}>
                    <option value="concept">Concept</option>
                    <option value="chapter">Chapter</option>
                    <option value="subtopic">Subtopic</option>
                  </select>
                  <select value={topicForm.bloom_focus || 'understand'} onChange={e => setTopicForm(f => ({ ...f, bloom_focus: e.target.value }))} style={selectStyle}>
                    <option value="remember">Remember</option>
                    <option value="understand">Understand</option>
                    <option value="apply">Apply</option>
                    <option value="analyze">Analyze</option>
                    <option value="evaluate">Evaluate</option>
                    <option value="create">Create</option>
                  </select>
                </div>
                <textarea placeholder="Description" value={topicForm.description || ''} onChange={e => setTopicForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...searchInputStyle, width: '100%', minHeight: 80, marginTop: 10, resize: 'vertical' as const }} />
                <button onClick={createTopic} style={{ ...actionBtnStyle, marginTop: 10, color: '#6B7280', borderColor: '#E5E7EB', padding: '8px 20px' }}>
                  Create Topic (Draft)
                </button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Ch</th>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Grade</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Bloom</th>
                    <th style={thStyle}>Workflow</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', padding: 24 }}>No topics found</td></tr>}
                  {topics.map(t => (
                    <tr key={t.id}>
                      <td style={tdStyle}>{t.chapter_number ?? '—'}</td>
                      <td style={tdStyle}>
                        <strong>{t.title}</strong>
                        {t.title_hi && <div style={{ fontSize: 10, color: '#9CA3AF' }}>{t.title_hi}</div>}
                      </td>
                      <td style={tdStyle}>{t.grade}</td>
                      <td style={tdStyle}><span style={{ fontSize: 10, color: '#6B7280' }}>{t.topic_type}</span></td>
                      <td style={tdStyle}><CmsStatusBadge status={t.content_status} /></td>
                      <td style={tdStyle}><span style={{ fontSize: 10, color: '#6B7280' }}>{t.bloom_focus}</span></td>
                      <td style={tdStyle}><TransitionButtons entityType="topic" entityId={t.id} currentStatus={t.content_status} /></td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { loadAssets('topic', t.id); }} style={{ ...actionBtnStyle, fontSize: 10, color: '#6B7280', borderColor: '#E5E7EB' }}>Assets</button>
                          <button onClick={() => openVersions('topic', t.id)} style={{ ...actionBtnStyle, fontSize: 10 }}>History</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={pageBtnStyle}>← Prev</button>
              <span style={{ fontSize: 12, color: '#9CA3AF', padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(topicTotal / 25))}</span>
              <button disabled={topics.length < 25} onClick={() => setPage(p => p + 1)} style={pageBtnStyle}>Next →</button>
            </div>
          </div>
        )}

        {/* Questions */}
        {view === 'questions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 12, margin: 0 }}>Question Bank</h2>
                <button onClick={() => { setShowCreateQuestion(!showCreateQuestion); setQuestionForm({}); }}
                  style={{ ...actionBtnStyle, color: '#6B7280', borderColor: '#E5E7EB', fontSize: 11 }}>
                  {showCreateQuestion ? '✕ Cancel' : '+ New Question'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setPage(1); }} style={selectStyle}>
                  <option value="">All Grades</option>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={selectStyle}>
                  <option value="">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="review">In Review</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Search question..."
                  style={{ ...searchInputStyle, width: 250 }} onKeyDown={e => e.key === 'Enter' && loadQuestions()} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>{questionTotal} questions found</div>

            {showCreateQuestion && (
              <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `2px solid ${'#2563EB'}` }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginBottom: 12 }}>Create New Question</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <select value={questionForm.grade || ''} onChange={e => setQuestionForm(f => ({ ...f, grade: e.target.value }))} style={selectStyle}>
                    <option value="">Grade *</option>
                    {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <input placeholder="Subject code (math, science...) *" value={questionForm.subject || ''} onChange={e => setQuestionForm(f => ({ ...f, subject: e.target.value }))} style={searchInputStyle} />
                  <select value={questionForm.question_type || 'mcq'} onChange={e => setQuestionForm(f => ({ ...f, question_type: e.target.value }))} style={selectStyle}>
                    <option value="mcq">MCQ</option>
                    <option value="true_false">True/False</option>
                    <option value="short_answer">Short Answer</option>
                    <option value="fill_blank">Fill in the Blank</option>
                  </select>
                  <select value={questionForm.difficulty || '1'} onChange={e => setQuestionForm(f => ({ ...f, difficulty: e.target.value }))} style={selectStyle}>
                    <option value="1">Easy (1)</option>
                    <option value="2">Medium (2)</option>
                    <option value="3">Hard (3)</option>
                  </select>
                </div>
                <textarea placeholder="Question text *" value={questionForm.question_text || ''} onChange={e => setQuestionForm(f => ({ ...f, question_text: e.target.value }))}
                  style={{ ...searchInputStyle, width: '100%', minHeight: 60, marginTop: 10, resize: 'vertical' as const }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <input placeholder="Option A *" value={questionForm.opt_a || ''} onChange={e => setQuestionForm(f => ({ ...f, opt_a: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Option B *" value={questionForm.opt_b || ''} onChange={e => setQuestionForm(f => ({ ...f, opt_b: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Option C" value={questionForm.opt_c || ''} onChange={e => setQuestionForm(f => ({ ...f, opt_c: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Option D" value={questionForm.opt_d || ''} onChange={e => setQuestionForm(f => ({ ...f, opt_d: e.target.value }))} style={searchInputStyle} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <select value={questionForm.correct_answer_index || '0'} onChange={e => setQuestionForm(f => ({ ...f, correct_answer_index: e.target.value }))} style={selectStyle}>
                    <option value="0">Correct: A</option>
                    <option value="1">Correct: B</option>
                    <option value="2">Correct: C</option>
                    <option value="3">Correct: D</option>
                  </select>
                  <input placeholder="Marks" type="number" value={questionForm.marks || ''} onChange={e => setQuestionForm(f => ({ ...f, marks: e.target.value }))} style={searchInputStyle} />
                </div>
                <textarea placeholder="Explanation (shown after answering)" value={questionForm.explanation || ''} onChange={e => setQuestionForm(f => ({ ...f, explanation: e.target.value }))}
                  style={{ ...searchInputStyle, width: '100%', minHeight: 50, marginTop: 10, resize: 'vertical' as const }} />
                <button onClick={() => {
                  const opts = [questionForm.opt_a || 'A', questionForm.opt_b || 'B', questionForm.opt_c || 'C', questionForm.opt_d || 'D'].filter(Boolean);
                  setQuestionForm(f => ({ ...f, options: JSON.stringify(opts) }));
                  setTimeout(createQuestion, 50);
                }} style={{ ...actionBtnStyle, marginTop: 10, color: '#6B7280', borderColor: '#E5E7EB', padding: '8px 20px' }}>
                  Create Question (Draft)
                </button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Question</th>
                    <th style={thStyle}>Grade</th>
                    <th style={thStyle}>Subject</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Diff</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Workflow</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', padding: 24 }}>No questions found</td></tr>}
                  {questions.map(q => (
                    <tr key={q.id}>
                      <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.question_text.slice(0, 80)}{q.question_text.length > 80 ? '...' : ''}</td>
                      <td style={tdStyle}>{q.grade}</td>
                      <td style={tdStyle}>{q.subject}</td>
                      <td style={tdStyle}><span style={{ fontSize: 10 }}>{q.question_type || 'mcq'}</span></td>
                      <td style={tdStyle}>{q.difficulty}</td>
                      <td style={tdStyle}><CmsStatusBadge status={q.content_status} /></td>
                      <td style={tdStyle}><TransitionButtons entityType="question" entityId={q.id} currentStatus={q.content_status} /></td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { loadAssets('question', q.id); }} style={{ ...actionBtnStyle, fontSize: 10, color: '#6B7280', borderColor: '#E5E7EB' }}>Assets</button>
                          <button onClick={() => openVersions('question', q.id)} style={{ ...actionBtnStyle, fontSize: 10 }}>History</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={pageBtnStyle}>← Prev</button>
              <span style={{ fontSize: 12, color: '#9CA3AF', padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(questionTotal / 25))}</span>
              <button disabled={questions.length < 25} onClick={() => setPage(p => p + 1)} style={pageBtnStyle}>Next →</button>
            </div>
          </div>
        )}

        {/* Version History */}
        {view === 'versions' && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Version History — {versionEntityType} {versionEntityId.slice(0, 8)}</h2>
            <button onClick={() => setView(versionEntityType === 'topic' ? 'topics' : 'questions')} style={{ ...actionBtnStyle, marginBottom: 16 }}>← Back to list</button>

            {versions.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: '#9CA3AF', padding: 24 }}>No versions recorded yet.</div>}

            <div style={{ display: 'grid', gap: 10 }}>
              {versions.map(v => (
                <div key={v.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>v{v.version_number}</span>
                      <CmsStatusBadge status={v.status} />
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                      {v.change_summary || 'No description'}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                      {new Date(v.created_at).toLocaleString()}
                      {v.created_by && <span> · by {v.created_by.slice(0, 8)}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => viewVersionDiff(v.id, v.version_number)}
                      style={{ ...actionBtnStyle, color: '#6B7280', borderColor: '#E5E7EB', fontSize: 10 }}>
                      View
                    </button>
                    <button onClick={() => rollbackVersion(v.id)}
                      style={{ ...actionBtnStyle, color: '#6B7280', borderColor: '#E5E7EB', fontSize: 10 }}>
                      Rollback
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Version Diff Viewer */}
            {diffSnapshot && (
              <div style={{ marginTop: 20 }}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ marginBottom: 12 }}>Version {diffVersionNum} — Snapshot</h2>
                <div style={{ ...cardStyle, overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: 180 }}>Field</th>
                        <th style={thStyle}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(diffSnapshot)
                        .filter(([k]) => !['id', 'created_at', 'deleted_at', 'search_vector'].includes(k))
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, val]) => (
                        <tr key={key}>
                          <td style={{ ...tdStyle, fontWeight: 600, color: '#6B7280', fontSize: 11 }}>{key}</td>
                          <td style={{ ...tdStyle, fontSize: 12, maxWidth: 600, wordBreak: 'break-word' as const }}>
                            {val === null ? <span style={{ color: '#9CA3AF' }}>null</span>
                              : typeof val === 'object' ? <pre style={{ margin: 0, fontSize: 10, color: '#9CA3AF', whiteSpace: 'pre-wrap' as const }}>{JSON.stringify(val, null, 2)}</pre>
                              : typeof val === 'boolean' ? <span style={{ color: val ? '#16A34A' : '#9CA3AF' }}>{String(val)}</span>
                              : String(val)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={() => setDiffSnapshot(null)} style={{ ...actionBtnStyle, marginTop: 10, fontSize: 11 }}>Close</button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Asset Panel */}
        {assetEntityId && (
          <div style={{ marginTop: 20, padding: 16, background: '#F9FAFB', borderRadius: 10, border: `1px solid ${'#E5E7EB'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 12, margin: 0 }}>Assets — {assetEntityType} {assetEntityId.slice(0, 8)}</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setShowAssetForm(!showAssetForm)}
                  style={{ ...actionBtnStyle, color: '#6B7280', borderColor: '#E5E7EB', fontSize: 10 }}>
                  {showAssetForm ? 'Cancel' : '+ Attach Asset'}
                </button>
                <button onClick={() => { setAssetEntityId(''); setAssets([]); }}
                  style={{ ...actionBtnStyle, fontSize: 10 }}>Close</button>
              </div>
            </div>

            {showAssetForm && (
              <div style={{ marginBottom: 12, padding: 12, background: '#FFFFFF', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input placeholder="File name *" value={assetForm.file_name || ''} onChange={e => setAssetForm(f => ({ ...f, file_name: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Storage path * (e.g. cms-media/topics/abc.png)" value={assetForm.storage_path || ''} onChange={e => setAssetForm(f => ({ ...f, storage_path: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="File type (image/png)" value={assetForm.file_type || ''} onChange={e => setAssetForm(f => ({ ...f, file_type: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="File size (bytes)" type="number" value={assetForm.file_size || ''} onChange={e => setAssetForm(f => ({ ...f, file_size: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Alt text" value={assetForm.alt_text || ''} onChange={e => setAssetForm(f => ({ ...f, alt_text: e.target.value }))} style={searchInputStyle} />
                  <input placeholder="Caption" value={assetForm.caption || ''} onChange={e => setAssetForm(f => ({ ...f, caption: e.target.value }))} style={searchInputStyle} />
                </div>
                <button onClick={registerAsset} style={{ ...actionBtnStyle, marginTop: 8, color: '#6B7280', borderColor: '#E5E7EB', padding: '6px 16px' }}>Register Asset</button>
              </div>
            )}

            {assets.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>No assets attached. Click &quot;+ Attach Asset&quot; to add one.</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>File</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Size</th>
                    <th style={thStyle}>Path</th>
                    <th style={thStyle}>Alt</th>
                    <th style={thStyle}>Added</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={a.id}>
                      <td style={tdStyle}><strong>{a.file_name}</strong></td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{a.file_type}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.storage_path}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{a.alt_text || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{new Date(a.created_at).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <button onClick={() => deleteAsset(a.id)} style={{ ...actionBtnStyle, color: '#9CA3AF', borderColor: '#E5E7EB', fontSize: 10 }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
    </div>
  );
}

export default function CmsPage() {
  return <AdminShell><CmsContent /></AdminShell>;
}
