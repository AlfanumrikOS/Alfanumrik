'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';

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

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const FILTER_BTN = 'rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2';
const FILTER_BTN_ACTIVE = 'rounded-md border border-foreground bg-foreground px-3.5 py-1.5 text-xs font-medium text-surface-1';
const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">AI Issue Reports</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            Student-reported problems with Foxy answers. Click a row to inspect and resolve.
          </p>
        </div>
        <button
          onClick={fetchIssues}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {/* Status filter */}
      <div className="mb-4 flex gap-2">
        {(['pending', 'resolved', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={statusFilter === s ? FILTER_BTN_ACTIVE : FILTER_BTN}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div
          data-testid="grounding-ai-issues-error"
          className="mb-4 rounded-md p-3 text-[13px] text-danger"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
        >
          Error: {error}
        </div>
      )}

      {saveMsg && (
        <div
          className="mb-4 rounded-md p-3 text-[13px] text-info"
          style={{ backgroundColor: 'color-mix(in srgb, var(--info) 10%, transparent)' }}
        >
          {saveMsg}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-surface-3">
        <table className="w-full border-collapse text-[13px]" data-testid="ai-issues-table">
          <thead>
            <tr>
              <th className={TH}>Timestamp</th>
              <th className={TH}>Student</th>
              <th className={TH}>Reason</th>
              <th className={TH}>Comment preview</th>
              <th className={TH}>Trace</th>
              <th className={TH}>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className={`${TD} text-center text-muted-foreground`}>
                  Loading...
                </td>
              </tr>
            )}
            {!loading && issues.length === 0 && !error && (
              <tr>
                <td colSpan={6} className={`${TD} text-center text-muted-foreground`}>
                  No issues in this queue.
                </td>
              </tr>
            )}
            {issues.map((issue) => {
              const isExpanded = expandedId === issue.id;
              const commentPreview = (issue.student_comment ?? '').slice(0, 80);
              return (
                <Fragment key={issue.id}>
                  <tr
                    onClick={() => expand(issue)}
                    className={`cursor-pointer ${isExpanded ? 'bg-surface-2' : ''}`}
                  >
                    <td className={TD}>{new Date(issue.created_at).toLocaleString()}</td>
                    <td className={`${TD} font-mono text-[11px]`}>
                      {issue.student_id.slice(0, 8)}…
                    </td>
                    <td className={TD}>
                      <code className="text-[11px] text-muted-foreground">{issue.reason_category}</code>
                    </td>
                    <td className={`${TD} max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap`}>
                      {commentPreview || <span className="text-muted-foreground">(no comment)</span>}
                    </td>
                    <td className={`${TD} font-mono text-[11px]`}>
                      {issue.trace_id ? `${issue.trace_id.slice(0, 8)}…` : '—'}
                    </td>
                    <td className={TD}>
                      <code
                        className={`text-[11px] ${
                          issue.admin_resolution && issue.admin_resolution !== 'pending'
                            ? 'text-success'
                            : 'text-warning'
                        }`}
                      >
                        {issue.admin_resolution ?? 'pending'}
                      </code>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr data-testid={`issue-detail-${issue.id}`}>
                      <td colSpan={6} className={`${TD} bg-surface-2`}>
                        <div className="mb-3 grid grid-cols-2 gap-4">
                          <div>
                            <div className={`${LABEL} mb-1`}>Student message</div>
                            {issue.foxy_message ? (
                              <div className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-md border border-surface-3 bg-surface-1 p-2 text-xs text-foreground">
                                [{issue.foxy_message.role}] {issue.foxy_message.content}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">(no linked message)</div>
                            )}
                            <div className={`${LABEL} mb-1 mt-3`}>Student comment</div>
                            <div className="whitespace-pre-wrap text-xs text-foreground">
                              {issue.student_comment || (
                                <span className="text-muted-foreground">(none)</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className={`${LABEL} mb-1`}>Trace</div>
                            {issue.trace ? (
                              <div className="text-xs leading-6 text-foreground">
                                <div><b>Caller:</b> {issue.trace.caller}</div>
                                <div><b>Subject / Grade:</b> {issue.trace.subject_code} / {issue.trace.grade}</div>
                                <div><b>Chapter:</b> {issue.trace.chapter_number ?? '—'}</div>
                                <div><b>Grounded:</b> {issue.trace.grounded ? 'yes' : 'no'}</div>
                                <div><b>Abstain:</b> <code className="text-[11px]">{issue.trace.abstain_reason ?? '—'}</code></div>
                                <div><b>Confidence:</b> {issue.trace.confidence !== null ? issue.trace.confidence.toFixed(2) : '—'}</div>
                                <div><b>Model:</b> <code className="text-[11px]">{issue.trace.claude_model ?? '—'}</code></div>
                                <div><b>Template:</b> <code className="text-[11px]">{issue.trace.prompt_template_id ?? '—'}</code></div>
                                <div><b>Latency:</b> {issue.trace.latency_ms ?? '—'} ms</div>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">(no linked trace)</div>
                            )}
                          </div>
                        </div>

                        {/* Admin actions */}
                        <div className="border-t border-surface-3 pt-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-[0_0_200px]">
                              <label className={LABEL}>Resolution</label>
                              <select
                                value={draftResolution}
                                onChange={(e) => setDraftResolution(e.target.value)}
                                className="mt-1 w-full cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm"
                                aria-label="Resolution"
                              >
                                {RESOLUTION_OPTIONS.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1">
                              <label className={LABEL}>Admin notes</label>
                              <textarea
                                value={draftNotes}
                                onChange={(e) => setDraftNotes(e.target.value)}
                                rows={3}
                                className="mt-1 w-full resize-y rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                                aria-label="Admin notes"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => saveResolution(issue)}
                              className="mt-[18px] rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
