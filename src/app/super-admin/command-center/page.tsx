'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import { colors, S } from '../_components/admin-styles';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DashboardData {
  issues_by_severity: Record<string, number>;
  issues_by_status: Record<string, number>;
  recommendations_by_status: Record<string, number>;
  executions_by_status: Record<string, number>;
  recent_issues: Issue[];
  summary: {
    open_issues: number;
    pending_recommendations: number;
    in_pipeline: number;
    resolved_this_week: number;
  };
}

interface Issue {
  id: string;
  title: string;
  description: string;
  source: string;
  category: string;
  severity: string;
  status: string;
  affected_users: number;
  detected_at: string;
  assigned_agent: string | null;
  resolution_notes: string | null;
  [key: string]: unknown;
}

interface Recommendation {
  id: string;
  issue_id: string;
  issue_title: string;
  recommendation: string;
  impact: string;
  effort: string;
  risk: string;
  status: string;
  agent_owner: string;
  created_at: string;
  [key: string]: unknown;
}

interface Execution {
  id: string;
  recommendation_id: string;
  recommendation_text: string;
  type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  staging_url: string | null;
  [key: string]: unknown;
}

interface LearningQuality {
  overall_quiz_accuracy: number;
  content_coverage: number;
  topics_with_gaps: number;
  blooms_levels_covered: number;
  accuracy_by_subject: { subject: string; avg_score: number; total_sessions: number }[];
  content_gaps: { subject: string; chapter: string; topic: string }[];
  blooms_distribution: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Badge mappings                                                     */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const severityBadge: Record<string, BadgeVariant> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const statusBadge: Record<string, BadgeVariant> = {
  open: 'danger',
  investigating: 'warning',
  recommendation_pending: 'info',
  in_progress: 'info',
  resolved: 'success',
  wont_fix: 'neutral',
};

const riskBadge: Record<string, BadgeVariant> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

const impactBadge: Record<string, BadgeVariant> = {
  high: 'success',
  medium: 'info',
  low: 'neutral',
};

const execStatusBadge: Record<string, BadgeVariant> = {
  pending: 'neutral',
  staging: 'info',
  testing: 'warning',
  approved: 'info',
  deployed: 'success',
  rolled_back: 'danger',
  failed: 'danger',
};

const recStatusBadge: Record<string, BadgeVariant> = {
  proposed: 'warning',
  approved: 'success',
  rejected: 'danger',
  implemented: 'info',
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS = ['Overview', 'Issues', 'Recommendations', 'Pipeline', 'Learning', 'Settings'] as const;
type Tab = (typeof TABS)[number];

const CATEGORIES = ['onboarding', 'ux', 'learning', 'quiz', 'rag', 'performance', 'admin', 'payment', 'mobile'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const AGENTS = ['architect', 'frontend', 'backend', 'assessment', 'ai-engineer', 'mobile', 'ops'] as const;
const ISSUE_STATUSES = ['open', 'investigating', 'recommendation_pending', 'in_progress', 'resolved', 'wont_fix'] as const;

const SEVERITY_COLORS: Record<string, string> = {
  critical: colors.danger,
  high: colors.warning,
  medium: colors.accent,
  low: colors.text3,
};

const MODES = [
  {
    key: 'observe',
    label: 'Observe',
    description: 'Detection only. Issues are created but no recommendations generated.',
  },
  {
    key: 'suggest',
    label: 'Suggest',
    description: 'Detection + recommendations. All actions require manual approval.',
  },
  {
    key: 'controlled_act',
    label: 'Controlled Act',
    description: 'Low-risk auto-staging after 24h. Medium/high-risk require approval.',
  },
] as const;

const THRESHOLDS = [
  { label: 'Quiz wrong rate', value: '30%' },
  { label: 'AI error rate', value: '10%' },
  { label: 'Auth failure rate', value: '5%' },
  { label: 'Payment failure rate', value: '2%' },
  { label: 'Stale content', value: '90 days' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString();
}

function truncate(s: string, max: number) {
  if (!s) return '\u2014';
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

/* ------------------------------------------------------------------ */
/*  Page content                                                       */
/* ------------------------------------------------------------------ */

function CommandCenterContent() {
  const { apiFetch } = useAdmin();

  // State
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('suggest');

  // Data
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [learning, setLearning] = useState<LearningQuality | null>(null);
  const [learningLoading, setLearningLoading] = useState(false);

  // Filters (Issues tab)
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [drawerContent, setDrawerContent] = useState<'issue-detail' | 'issue-create' | 'rec-detail'>('issue-detail');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);

  // Create issue form
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    category: 'ux',
    severity: 'medium',
    assigned_agent: '',
  });

  /* ---- Fetchers ---- */

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard');
      const json = await res.json();
      setDashboard(json.data || json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const fetchIssues = useCallback(async () => {
    setIssuesLoading(true);
    try {
      const params = new URLSearchParams({ action: 'issues', limit: '50', offset: '0' });
      if (filterStatus) params.set('status', filterStatus);
      if (filterCategory) params.set('category', filterCategory);
      if (filterSeverity) params.set('severity', filterSeverity);
      const res = await apiFetch(`/api/super-admin/improvement?${params}`);
      if (!res.ok) throw new Error('Failed to load issues');
      const json = await res.json();
      setIssues(json.data || json || []);
    } catch {
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }, [apiFetch, filterStatus, filterCategory, filterSeverity]);

  const fetchRecommendations = useCallback(async () => {
    setRecsLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=recommendations');
      if (!res.ok) throw new Error('Failed to load recommendations');
      const json = await res.json();
      setRecommendations(json.data || json || []);
    } catch {
      setRecommendations([]);
    } finally {
      setRecsLoading(false);
    }
  }, [apiFetch]);

  const fetchExecutions = useCallback(async () => {
    setExecLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=executions');
      if (!res.ok) throw new Error('Failed to load executions');
      const json = await res.json();
      setExecutions(json.data || json || []);
    } catch {
      setExecutions([]);
    } finally {
      setExecLoading(false);
    }
  }, [apiFetch]);

  const fetchLearning = useCallback(async () => {
    setLearningLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/improvement/learning-quality');
      if (!res.ok) throw new Error('Failed to load learning quality');
      const json = await res.json();
      setLearning(json.data || json);
    } catch {
      setLearning(null);
    } finally {
      setLearningLoading(false);
    }
  }, [apiFetch]);

  /* ---- Effects ---- */

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (tab === 'Issues') fetchIssues();
  }, [tab, fetchIssues]);

  useEffect(() => {
    if (tab === 'Recommendations') fetchRecommendations();
  }, [tab, fetchRecommendations]);

  useEffect(() => {
    if (tab === 'Pipeline') fetchExecutions();
  }, [tab, fetchExecutions]);

  useEffect(() => {
    if (tab === 'Learning') fetchLearning();
  }, [tab, fetchLearning]);

  /* ---- Actions ---- */

  const handleCreateIssue = async () => {
    if (!createForm.title.trim()) return;
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=issue', {
        method: 'POST',
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          category: createForm.category,
          severity: createForm.severity,
          assigned_agent: createForm.assigned_agent || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to create issue');
      setDrawerOpen(false);
      setCreateForm({ title: '', description: '', category: 'ux', severity: 'medium', assigned_agent: '' });
      fetchIssues();
      fetchDashboard();
    } catch {
      // Error is handled silently; could add toast in the future
    }
  };

  const handleUpdateIssueStatus = async (issueId: string, newStatus: string) => {
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=issue', {
        method: 'PATCH',
        body: JSON.stringify({ id: issueId, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update issue');
      setDrawerOpen(false);
      fetchIssues();
      fetchDashboard();
    } catch {
      // silent
    }
  };

  const handleRecAction = async (recId: string, action: 'approved' | 'rejected') => {
    try {
      const res = await apiFetch('/api/super-admin/improvement?action=recommendation', {
        method: 'PATCH',
        body: JSON.stringify({ id: recId, status: action }),
      });
      if (!res.ok) throw new Error('Failed to update recommendation');
      setDrawerOpen(false);
      fetchRecommendations();
      fetchDashboard();
    } catch {
      // silent
    }
  };

  /* ---- Drawer openers ---- */

  const openIssueDetail = (issue: Issue) => {
    setSelectedIssue(issue);
    setDrawerContent('issue-detail');
    setDrawerTitle(issue.title);
    setDrawerOpen(true);
  };

  const openCreateIssue = () => {
    setDrawerContent('issue-create');
    setDrawerTitle('Create Issue');
    setDrawerOpen(true);
  };

  const openRecDetail = (rec: Recommendation) => {
    setSelectedRec(rec);
    setDrawerContent('rec-detail');
    setDrawerTitle('Recommendation Details');
    setDrawerOpen(true);
  };

  /* ---- Column defs ---- */

  const recentIssueColumns: Column<Issue>[] = [
    { key: 'title', label: 'Title', render: (r) => truncate(r.title, 50) },
    { key: 'category', label: 'Category' },
    {
      key: 'severity', label: 'Severity',
      render: (r) => <StatusBadge label={r.severity} variant={severityBadge[r.severity] || 'neutral'} />,
    },
    {
      key: 'status', label: 'Status',
      render: (r) => <StatusBadge label={r.status.replace(/_/g, ' ')} variant={statusBadge[r.status] || 'neutral'} />,
    },
    { key: 'detected_at', label: 'Detected At', render: (r) => fmtDate(r.detected_at) },
  ];

  const issueColumns: Column<Issue>[] = [
    { key: 'title', label: 'Title', render: (r) => truncate(r.title, 40) },
    { key: 'source', label: 'Source' },
    { key: 'category', label: 'Category' },
    {
      key: 'severity', label: 'Severity',
      render: (r) => <StatusBadge label={r.severity} variant={severityBadge[r.severity] || 'neutral'} />,
    },
    {
      key: 'status', label: 'Status',
      render: (r) => <StatusBadge label={r.status.replace(/_/g, ' ')} variant={statusBadge[r.status] || 'neutral'} />,
    },
    { key: 'affected_users', label: 'Affected', sortable: true },
    { key: 'detected_at', label: 'Detected', render: (r) => fmtDate(r.detected_at) },
    { key: 'assigned_agent', label: 'Agent', render: (r) => r.assigned_agent || '\u2014' },
  ];

  const recColumns: Column<Recommendation>[] = [
    { key: 'recommendation', label: 'Recommendation', render: (r) => truncate(r.recommendation, 80) },
    { key: 'issue_title', label: 'Issue', render: (r) => truncate(r.issue_title, 30) },
    {
      key: 'impact', label: 'Impact',
      render: (r) => <StatusBadge label={r.impact} variant={impactBadge[r.impact] || 'neutral'} />,
    },
    { key: 'effort', label: 'Effort' },
    {
      key: 'risk', label: 'Risk',
      render: (r) => <StatusBadge label={r.risk} variant={riskBadge[r.risk] || 'neutral'} />,
    },
    {
      key: 'status', label: 'Status',
      render: (r) => <StatusBadge label={r.status} variant={recStatusBadge[r.status] || 'neutral'} />,
    },
    { key: 'agent_owner', label: 'Agent Owner', render: (r) => r.agent_owner || '\u2014' },
  ];

  const execColumns: Column<Execution>[] = [
    { key: 'type', label: 'Type' },
    {
      key: 'status', label: 'Status',
      render: (r) => <StatusBadge label={r.status.replace(/_/g, ' ')} variant={execStatusBadge[r.status] || 'neutral'} />,
    },
    { key: 'recommendation_text', label: 'Recommendation', render: (r) => truncate(r.recommendation_text, 60) },
    { key: 'started_at', label: 'Started', render: (r) => fmtDate(r.started_at) },
    { key: 'completed_at', label: 'Completed', render: (r) => fmtDate(r.completed_at) },
    {
      key: 'staging_url', label: 'Staging URL',
      render: (r) => r.staging_url ? (
        <a href={r.staging_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, textDecoration: 'none', fontSize: 12 }}>
          View
        </a>
      ) : '\u2014',
    },
  ];

  /* ---- Render helpers ---- */

  const renderSeverityBar = () => {
    if (!dashboard) return null;
    const sev = dashboard.issues_by_severity;
    const total = (Object.values(sev) as number[]).reduce((a: number, b: number) => a + b, 0);
    if (total === 0) return <div style={{ color: colors.text3, fontSize: 13 }}>No issues detected</div>;
    const order = ['critical', 'high', 'medium', 'low'];
    return (
      <div>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 28, marginBottom: 10 }}>
          {order.map(level => {
            const count = sev[level] || 0;
            if (count === 0) return null;
            const pct = (count / total) * 100;
            return (
              <div
                key={level}
                style={{
                  width: `${pct}%`,
                  background: SEVERITY_COLORS[level],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 30,
                }}
                title={`${level}: ${count}`}
              >
                {count}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {order.map(level => (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colors.text2 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLORS[level], display: 'inline-block' }} />
              {level}: {sev[level] || 0}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBloomsBar = () => {
    if (!learning || !learning.blooms_distribution) return null;
    const dist = learning.blooms_distribution;
    const maxVal = Math.max(...(Object.values(dist) as number[]), 1);
    const levels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {levels.map(level => {
          const val = dist[level] || dist[level.toLowerCase()] || 0;
          const pct = (val / maxVal) * 100;
          return (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 80, fontSize: 12, color: colors.text2, textAlign: 'right' }}>{level}</div>
              <div style={{ flex: 1, height: 20, background: colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: colors.accent, borderRadius: 4, minWidth: val > 0 ? 4 : 0 }} />
              </div>
              <div style={{ width: 40, fontSize: 12, color: colors.text1, fontWeight: 600 }}>{val}</div>
            </div>
          );
        })}
      </div>
    );
  };

  /* ---- Drawer contents ---- */

  const renderDrawerContent = () => {
    if (drawerContent === 'issue-create') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: colors.text2, fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</label>
            <input
              style={{ ...S.searchInput, width: '100%' }}
              value={createForm.title}
              onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Issue title"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: colors.text2, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
            <textarea
              style={{ ...S.searchInput, width: '100%', minHeight: 100, resize: 'vertical' as const }}
              value={createForm.description}
              onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the issue..."
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: colors.text2, fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
              <select
                style={{ ...S.select, width: '100%' }}
                value={createForm.category}
                onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: colors.text2, fontWeight: 600, display: 'block', marginBottom: 4 }}>Severity</label>
              <select
                style={{ ...S.select, width: '100%' }}
                value={createForm.severity}
                onChange={e => setCreateForm(f => ({ ...f, severity: e.target.value }))}
              >
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: colors.text2, fontWeight: 600, display: 'block', marginBottom: 4 }}>Assigned Agent (optional)</label>
            <select
              style={{ ...S.select, width: '100%' }}
              value={createForm.assigned_agent}
              onChange={e => setCreateForm(f => ({ ...f, assigned_agent: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 8 }}>
            <button style={S.primaryBtn} onClick={handleCreateIssue}>Create Issue</button>
          </div>
        </div>
      );
    }

    if (drawerContent === 'issue-detail' && selectedIssue) {
      const issue = selectedIssue;
      const fieldStyle: React.CSSProperties = { marginBottom: 14 };
      const labelStyle: React.CSSProperties = { fontSize: 11, color: colors.text3, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.8 };
      const valStyle: React.CSSProperties = { fontSize: 13, color: colors.text1 };
      return (
        <div>
          <div style={fieldStyle}>
            <div style={labelStyle}>Description</div>
            <div style={valStyle}>{issue.description || '\u2014'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={labelStyle}>Source</div>
              <div style={valStyle}>{issue.source || '\u2014'}</div>
            </div>
            <div>
              <div style={labelStyle}>Category</div>
              <div style={valStyle}>{issue.category}</div>
            </div>
            <div>
              <div style={labelStyle}>Severity</div>
              <StatusBadge label={issue.severity} variant={severityBadge[issue.severity] || 'neutral'} />
            </div>
            <div>
              <div style={labelStyle}>Status</div>
              <StatusBadge label={issue.status.replace(/_/g, ' ')} variant={statusBadge[issue.status] || 'neutral'} />
            </div>
            <div>
              <div style={labelStyle}>Affected Users</div>
              <div style={valStyle}>{issue.affected_users ?? '\u2014'}</div>
            </div>
            <div>
              <div style={labelStyle}>Detected At</div>
              <div style={valStyle}>{fmtDate(issue.detected_at)}</div>
            </div>
            <div>
              <div style={labelStyle}>Assigned Agent</div>
              <div style={valStyle}>{issue.assigned_agent || 'Unassigned'}</div>
            </div>
          </div>
          {issue.resolution_notes && (
            <div style={fieldStyle}>
              <div style={labelStyle}>Resolution Notes</div>
              <div style={valStyle}>{issue.resolution_notes}</div>
            </div>
          )}
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 14, marginTop: 14 }}>
            <div style={labelStyle}>Change Status</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {ISSUE_STATUSES.filter(s => s !== issue.status).map(s => (
                <button
                  key={s}
                  style={S.secondaryBtn}
                  onClick={() => handleUpdateIssueStatus(issue.id, s)}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (drawerContent === 'rec-detail' && selectedRec) {
      const rec = selectedRec;
      const fieldStyle: React.CSSProperties = { marginBottom: 14 };
      const labelStyle: React.CSSProperties = { fontSize: 11, color: colors.text3, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.8 };
      const valStyle: React.CSSProperties = { fontSize: 13, color: colors.text1 };
      return (
        <div>
          <div style={fieldStyle}>
            <div style={labelStyle}>Recommendation</div>
            <div style={valStyle}>{rec.recommendation}</div>
          </div>
          <div style={fieldStyle}>
            <div style={labelStyle}>Related Issue</div>
            <div style={valStyle}>{rec.issue_title || '\u2014'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={labelStyle}>Impact</div>
              <StatusBadge label={rec.impact} variant={impactBadge[rec.impact] || 'neutral'} />
            </div>
            <div>
              <div style={labelStyle}>Effort</div>
              <div style={valStyle}>{rec.effort}</div>
            </div>
            <div>
              <div style={labelStyle}>Risk</div>
              <StatusBadge label={rec.risk} variant={riskBadge[rec.risk] || 'neutral'} />
            </div>
            <div>
              <div style={labelStyle}>Status</div>
              <StatusBadge label={rec.status} variant={recStatusBadge[rec.status] || 'neutral'} />
            </div>
            <div>
              <div style={labelStyle}>Agent Owner</div>
              <div style={valStyle}>{rec.agent_owner || '\u2014'}</div>
            </div>
            <div>
              <div style={labelStyle}>Created</div>
              <div style={valStyle}>{fmtDate(rec.created_at)}</div>
            </div>
          </div>
          {rec.status === 'proposed' && (
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 14, marginTop: 14, display: 'flex', gap: 10 }}>
              <button
                style={{ ...S.primaryBtn, background: colors.success }}
                onClick={() => handleRecAction(rec.id, 'approved')}
              >
                Approve
              </button>
              <button
                style={S.dangerBtn}
                onClick={() => handleRecAction(rec.id, 'rejected')}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  /* ---- Loading / Error ---- */

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: colors.text3, fontSize: 14 }}>Loading...</div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: 60, color: colors.danger, fontSize: 14 }}>{error}</div>;
  }

  /* ---- Main render ---- */

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={S.h1}>Command Center</h1>
          <StatusBadge label={mode === 'suggest' ? 'Suggest' : mode === 'observe' ? 'Observe' : 'Controlled Act'} variant="info" />
        </div>
        <div style={S.subtitle}>Product improvement monitoring &amp; automation</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t}
            style={{
              ...S.filterBtn,
              ...(tab === t ? S.filterActive : {}),
            }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ============ Overview Tab ============ */}
      {tab === 'Overview' && dashboard && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <StatCard label="Open Issues" value={dashboard.summary.open_issues} icon={'\u2298'} accentColor={colors.danger} />
            <StatCard label="Pending Recommendations" value={dashboard.summary.pending_recommendations} icon={'\u25C8'} accentColor={colors.warning} />
            <StatCard label="In Pipeline" value={dashboard.summary.in_pipeline} icon={'\u229E'} accentColor={colors.accent} />
            <StatCard label="Resolved This Week" value={dashboard.summary.resolved_this_week} icon={'\u2295'} accentColor={colors.success} />
          </div>

          <div style={{ ...S.card, marginBottom: 24 }}>
            <h2 style={S.h2}>Issues by Severity</h2>
            {renderSeverityBar()}
          </div>

          <div>
            <h2 style={S.h2}>Recent Issues</h2>
            <DataTable
              columns={recentIssueColumns}
              data={(dashboard.recent_issues || []).slice(0, 5)}
              keyField="id"
              onRowClick={openIssueDetail}
              emptyMessage="No recent issues"
            />
          </div>
        </div>
      )}

      {/* ============ Issues Tab ============ */}
      {tab === 'Issues' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={S.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {ISSUE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select style={S.select} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select style={S.select} value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
              <option value="">All Severities</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button style={S.primaryBtn} onClick={openCreateIssue}>Create Issue</button>
          </div>
          <DataTable
            columns={issueColumns}
            data={issues}
            keyField="id"
            onRowClick={openIssueDetail}
            loading={issuesLoading}
            emptyMessage="No issues match the current filters"
          />
        </div>
      )}

      {/* ============ Recommendations Tab ============ */}
      {tab === 'Recommendations' && (
        <div>
          <DataTable
            columns={recColumns}
            data={recommendations}
            keyField="id"
            onRowClick={openRecDetail}
            loading={recsLoading}
            emptyMessage="No recommendations yet"
          />
        </div>
      )}

      {/* ============ Pipeline Tab ============ */}
      {tab === 'Pipeline' && (
        <div>
          <DataTable
            columns={execColumns}
            data={executions}
            keyField="id"
            loading={execLoading}
            emptyMessage="No executions in the pipeline"
          />
        </div>
      )}

      {/* ============ Learning Tab ============ */}
      {tab === 'Learning' && (
        <div>
          {learningLoading && <div style={{ textAlign: 'center', padding: 40, color: colors.text3, fontSize: 14 }}>Loading...</div>}
          {!learningLoading && learning && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                <StatCard label="Overall Quiz Accuracy" value={`${learning.overall_quiz_accuracy}%`} icon={'\u2298'} accentColor={colors.accent} />
                <StatCard label="Content Coverage" value={`${learning.content_coverage}%`} icon={'\u25C8'} accentColor={colors.success} />
                <StatCard label="Topics with Gaps" value={learning.topics_with_gaps} icon={'\u229E'} accentColor={colors.warning} />
                <StatCard label="Bloom\'s Levels Covered" value={learning.blooms_levels_covered} icon={'\u2295'} accentColor={colors.accent} />
              </div>

              <div style={{ ...S.card, marginBottom: 24 }}>
                <h2 style={S.h2}>Quiz Accuracy by Subject</h2>
                <DataTable
                  columns={[
                    { key: 'subject', label: 'Subject' },
                    { key: 'avg_score', label: 'Avg Score', sortable: true, render: (r: { avg_score: number }) => `${r.avg_score}%` },
                    { key: 'total_sessions', label: 'Total Sessions', sortable: true },
                  ] as Column<{ subject: string; avg_score: number; total_sessions: number }>[]}
                  data={learning.accuracy_by_subject || []}
                  keyField="subject"
                  emptyMessage="No quiz data available"
                />
              </div>

              <div style={{ ...S.card, marginBottom: 24 }}>
                <h2 style={S.h2}>Content Gaps</h2>
                <DataTable
                  columns={[
                    { key: 'subject', label: 'Subject' },
                    { key: 'chapter', label: 'Chapter' },
                    { key: 'topic', label: 'Topic' },
                  ] as Column<{ subject: string; chapter: string; topic: string }>[]}
                  data={(learning.content_gaps || []).slice(0, 20)}
                  keyField="topic"
                  emptyMessage="No content gaps detected"
                />
              </div>

              <div style={{ ...S.card }}>
                <h2 style={S.h2}>Bloom&apos;s Distribution</h2>
                {renderBloomsBar()}
              </div>
            </>
          )}
          {!learningLoading && !learning && (
            <div style={{ textAlign: 'center', padding: 40, color: colors.text3, fontSize: 14 }}>
              Learning quality data unavailable
            </div>
          )}
        </div>
      )}

      {/* ============ Settings Tab ============ */}
      {tab === 'Settings' && (
        <div>
          <div style={{ ...S.card, marginBottom: 24 }}>
            <h2 style={S.h2}>Operating Mode</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {MODES.map(m => {
                const selected = mode === m.key;
                return (
                  <div
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    style={{
                      ...S.card,
                      cursor: 'pointer',
                      borderColor: selected ? colors.text1 : colors.border,
                      borderWidth: selected ? 2 : 1,
                      background: selected ? colors.surface : colors.bg,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 16, height: 16, borderRadius: '50%',
                          border: `2px solid ${selected ? colors.text1 : colors.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.text1 }} />}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: colors.text1 }}>{m.label}</span>
                      {m.key === 'suggest' && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: colors.accent, background: colors.accentLight, padding: '1px 6px', borderRadius: 4 }}>
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: colors.text2, lineHeight: 1.4 }}>{m.description}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>Detection Thresholds</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {THRESHOLDS.map(t => (
                <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: colors.surface, borderRadius: 6 }}>
                  <span style={{ fontSize: 13, color: colors.text2 }}>{t.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drawer */}
      <DetailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        {renderDrawerContent()}
      </DetailDrawer>
    </div>
  );
}

export default function CommandCenterPage() {
  return (
    <AdminShell>
      <CommandCenterContent />
    </AdminShell>
  );
}
