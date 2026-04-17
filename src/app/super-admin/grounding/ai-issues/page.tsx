'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

/**
 * Grounding AI Issues — super-admin page (Task 3.17d)
 *
 * Queue of student-reported ai_issue_reports. Triage-focused: click a
 * row to see message + linked trace. Admin sets resolution + notes.
 *
 * Privacy (P13): foxy_chat_messages.content contains the full student
 * query + AI answer. We only surface it when the student has filed a
 * report (implicit consent for admin review).
 */

interface TraceEmbed {
  id: string;
  created_at: string;
  caller: string;
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query_preview: string | null;
  grounded: boolean;
  abstain_reason: string | null;
  confidence: number | null;
  prompt_template_id: string | null;
  claude_model: string | null;
  latency_ms: number | null;
}

interface FoxyMessageEmbed {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface Issue {
  id: string;
  student_id: string;
  foxy_message_id: string | null;
  question_bank_id: string | null;
  trace_id: string | null;
  reason_category: string;
  student_comment: string | null;
  admin_notes: string | null;
  admin_resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  trace: TraceEmbed | null;
  foxy_message: FoxyMessageEmbed | null;
}

interface IssuesResponse {
  success: boolean;
  data: {
    issues: Issue[];
    count: number;
    status: string;
    limit: number;
    truncated?: boolean;
  };
  error?: string;
}

const RESOLUTION_OPTIONS = ['pending', 'content_fix', 'prompt_fix', 'false_positive', 'duplicate', 'wontfix'];

function AiIssuesContent() {
  const { apiFetch } = useAdmin();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Draft state for the currently-expanded row
  const [draftResolution, setDraftResolution] = useState<string>('');
  const [draftNotes, setDraftNotes] = useState<string>('');

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/grounding/ai-issues?status=${statusFilter}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as IssuesResponse;
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setIssues(body.data.issues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, statusFilter]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const expand = (issue: Issue) => {
    if (expandedId === issue.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(issue.id);
    setDraftResolution(issue.admin_resolution ?? 'pending');
    setDraftNotes(issue.admin_notes ?? '');
  };

  const saveResolution = useCallback(
    async (issue: Issue) => {
      setSaveMsg(null);
      try {
        const res = await apiFetch('/api/super-admin/grounding/ai-issues', {
          method: 'POST',
          body: JSON.stringify({
            action: 'resolve',
            id: issue.id,
            admin_resolution: draftResolution,
            admin_notes: draftNotes,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSaveMsg(`Save failed: ${body.error || res.status}`);
          return;
        }
        setSaveMsg('Saved');
        fetchIssues();
      } catch (err) {
        setSaveMsg(err instanceof Error ? err.message : 'Save failed');
      }
    },
    [apiFetch, draftResolution, draftNotes, fetchIssues],
  );

  return (
    <div data-testid="grounding-ai-issues-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>AI Issue Reports</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Student-reported problems with Foxy answers. Click a row to inspect and resolve.
          </p>
        </div>
        <button onClick={fetchIssues} style={S.secondaryBtn}>Refresh</button>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['pending', 'resolved', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{
              ...S.filterBtn,
              ...(statusFilter === s ? S.filterActive : {}),
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div
          data-testid="grounding-ai-issues-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error: {error}
        </div>
      )}

      {saveMsg && (
        <div style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.accentLight, color: colors.accent, fontSize: 13 }}>
          {saveMsg}
        </div>
      )}

      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table} data-testid="ai-issues-table">
          <thead>
            <tr>
              <th style={S.th}>Timestamp</th>
              <th style={S.th}>Student</th>
              <th style={S.th}>Reason</th>
              <th style={S.th}>Comment preview</th>
              <th style={S.th}>Trace</th>
              <th style={S.th}>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                  Loading...
                </td>
              </tr>
            )}
            {!loading && issues.length === 0 && !error && (
              <tr>
                <td colSpan={6} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                  No issues in this queue.
                </td>
              </tr>
            )}
            {issues.map((issue) => {
              const isExpanded = expandedId === issue.id;
              const commentPreview = (issue.student_comment ?? '').slice(0, 80);
              return (
                <>
                  <tr
                    key={issue.id}
                    onClick={() => expand(issue)}
                    style={{ cursor: 'pointer', background: isExpanded ? colors.surface : undefined }}
                  >
                    <td style={S.td}>{new Date(issue.created_at).toLocaleString()}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>
                      {issue.student_id.slice(0, 8)}…
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text2 }}>{issue.reason_category}</code>
                    </td>
                    <td style={{ ...S.td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {commentPreview || <span style={{ color: colors.text3 }}>(no comment)</span>}
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>
                      {issue.trace_id ? `${issue.trace_id.slice(0, 8)}…` : '—'}
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: issue.admin_resolution && issue.admin_resolution !== 'pending' ? colors.success : colors.warning }}>
                        {issue.admin_resolution ?? 'pending'}
                      </code>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${issue.id}-detail`} data-testid={`issue-detail-${issue.id}`}>
                      <td colSpan={6} style={{ ...S.td, background: colors.surface }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                              Student message
                            </div>
                            {issue.foxy_message ? (
                              <div style={{ fontSize: 12, color: colors.text1, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', padding: 8, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4 }}>
                                [{issue.foxy_message.role}] {issue.foxy_message.content}
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: colors.text3 }}>(no linked message)</div>
                            )}
                            <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 4px' }}>
                              Student comment
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, whiteSpace: 'pre-wrap' }}>
                              {issue.student_comment || <span style={{ color: colors.text3 }}>(none)</span>}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                              Trace
                            </div>
                            {issue.trace ? (
                              <div style={{ fontSize: 12, color: colors.text1, lineHeight: 1.6 }}>
                                <div><b>Caller:</b> {issue.trace.caller}</div>
                                <div><b>Subject / Grade:</b> {issue.trace.subject_code} / {issue.trace.grade}</div>
                                <div><b>Chapter:</b> {issue.trace.chapter_number ?? '—'}</div>
                                <div><b>Grounded:</b> {issue.trace.grounded ? 'yes' : 'no'}</div>
                                <div><b>Abstain:</b> <code style={{ fontSize: 11 }}>{issue.trace.abstain_reason ?? '—'}</code></div>
                                <div><b>Confidence:</b> {issue.trace.confidence !== null ? issue.trace.confidence.toFixed(2) : '—'}</div>
                                <div><b>Model:</b> <code style={{ fontSize: 11 }}>{issue.trace.claude_model ?? '—'}</code></div>
                                <div><b>Template:</b> <code style={{ fontSize: 11 }}>{issue.trace.prompt_template_id ?? '—'}</code></div>
                                <div><b>Latency:</b> {issue.trace.latency_ms ?? '—'} ms</div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: colors.text3 }}>(no linked trace)</div>
                            )}
                          </div>
                        </div>

                        {/* Admin actions */}
                        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                            <div style={{ flex: '0 0 200px' }}>
                              <label style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Resolution
                              </label>
                              <select
                                value={draftResolution}
                                onChange={(e) => setDraftResolution(e.target.value)}
                                style={{ ...S.select, width: '100%', marginTop: 4 }}
                                aria-label="Resolution"
                              >
                                {RESOLUTION_OPTIONS.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Admin notes
                              </label>
                              <textarea
                                value={draftNotes}
                                onChange={(e) => setDraftNotes(e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  marginTop: 4,
                                  padding: '8px 12px',
                                  borderRadius: 6,
                                  border: `1px solid ${colors.border}`,
                                  fontSize: 13,
                                  fontFamily: 'inherit',
                                  resize: 'vertical',
                                  boxSizing: 'border-box',
                                }}
                                aria-label="Admin notes"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => saveResolution(issue)}
                              style={{ ...S.primaryBtn, marginTop: 18 }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GroundingAiIssuesPage() {
  return (
    <AdminShell>
      <AiIssuesContent />
    </AdminShell>
  );
}