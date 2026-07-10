'use client';

import { Fragment, useCallback, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';

/**
 * Grounding Traces — super-admin page (Task 3.17c)
 *
 * Search form for incident triage. Supports three exclusive modes:
 *   - traceId lookup
 *   - studentId + date range
 *   - abstainReason + date range
 *
 * Click a row to expand into a detail view showing chunks + prompt
 * template hash (P13: no full prompt text).
 */

type SearchMode = 'traceId' | 'studentId' | 'abstainReason';

interface Trace {
  id: string;
  created_at: string;
  caller: string;
  student_id: string | null;
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query_hash: string | null;
  query_preview: string | null;
  embedding_model: string | null;
  retrieved_chunk_ids: string[] | null;
  top_similarity: number | null;
  chunk_count: number | null;
  claude_model: string | null;
  prompt_template_id: string | null;
  prompt_hash: string | null;
  grounded: boolean;
  abstain_reason: string | null;
  confidence: number | null;
  answer_length: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  client_reported_issue_id: string | null;
}

interface TracesResponse {
  success: boolean;
  data: {
    traces: Trace[];
    count: number;
    limit: number;
    truncated: boolean;
  };
  error?: string;
}

const ABSTAIN_REASONS = [
  'chapter_not_ready',
  'no_chunks_retrieved',
  'low_similarity',
  'no_supporting_chunks',
  'scope_mismatch',
  'upstream_error',
  'circuit_open',
];

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const SEARCH_INPUT_BASE = 'rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const FILTER_BTN = 'rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2';
const FILTER_BTN_ACTIVE = 'rounded-md border border-foreground bg-foreground px-3.5 py-1.5 text-xs font-medium text-surface-1';
const LABEL = 'mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

function TracesContent() {
  const { apiFetch } = useAdmin();
  const [mode, setMode] = useState<SearchMode>('traceId');
  const [traceIdInput, setTraceIdInput] = useState('');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [abstainReasonInput, setAbstainReasonInput] = useState('chapter_not_ready');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [callerFilter, setCallerFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const runSearch = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      setLoading(true);
      setError(null);
      setTraces([]);
      try {
        const params = new URLSearchParams();
        if (mode === 'traceId') {
          if (!traceIdInput) {
            setError('Trace ID is required');
            setLoading(false);
            return;
          }
          params.set('traceId', traceIdInput);
        } else if (mode === 'studentId') {
          if (!studentIdInput) {
            setError('Student ID is required');
            setLoading(false);
            return;
          }
          params.set('studentId', studentIdInput);
          if (fromInput) params.set('from', fromInput);
          if (toInput) params.set('to', toInput);
        } else if (mode === 'abstainReason') {
          params.set('abstainReason', abstainReasonInput);
          if (fromInput) params.set('from', fromInput);
          if (toInput) params.set('to', toInput);
        }
        if (callerFilter) params.set('caller', callerFilter);
        if (gradeFilter) params.set('grade', gradeFilter);
        if (subjectFilter) params.set('subject', subjectFilter);

        const res = await apiFetch(`/api/super-admin/grounding/traces?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error || `Request failed with status ${res.status}`);
          return;
        }
        const body = (await res.json()) as TracesResponse;
        if (!body.success) {
          setError(body.error || 'Request failed');
          return;
        }
        setTraces(body.data.traces);
        setTruncated(body.data.truncated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
    [apiFetch, mode, traceIdInput, studentIdInput, abstainReasonInput, fromInput, toInput, callerFilter, gradeFilter, subjectFilter],
  );

  return (
    <div data-testid="grounding-traces-page">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Grounding Traces</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            Search grounded_ai_traces for incident triage. P13: prompt bodies are never shown — only the template hash.
          </p>
        </div>
      </div>

      {/* Search form */}
      <form
        onSubmit={runSearch}
        data-testid="traces-search-form"
        className="mb-4 rounded-lg border border-surface-3 bg-surface-1 p-4"
      >
        {/* Mode selector */}
        <div className="mb-3 flex gap-2">
          {(['traceId', 'studentId', 'abstainReason'] as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={mode === m ? FILTER_BTN_ACTIVE : FILTER_BTN}
            >
              {m === 'traceId' ? 'By Trace ID' : m === 'studentId' ? 'By Student' : 'By Abstain Reason'}
            </button>
          ))}
        </div>

        {/* Mode-specific inputs */}
        <div className="mb-3 flex flex-wrap gap-2">
          {mode === 'traceId' && (
            <input
              type="text"
              placeholder="Trace UUID"
              value={traceIdInput}
              onChange={(e) => setTraceIdInput(e.target.value)}
              className={`${SEARCH_INPUT_BASE} w-[340px]`}
              aria-label="Trace ID"
            />
          )}
          {mode === 'studentId' && (
            <>
              <input
                type="text"
                placeholder="Student UUID"
                value={studentIdInput}
                onChange={(e) => setStudentIdInput(e.target.value)}
                className={`${SEARCH_INPUT_BASE} w-[340px]`}
                aria-label="Student ID"
              />
              <input
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className={`${SEARCH_INPUT_BASE} w-[200px]`}
                aria-label="From"
              />
              <input
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className={`${SEARCH_INPUT_BASE} w-[200px]`}
                aria-label="To"
              />
            </>
          )}
          {mode === 'abstainReason' && (
            <>
              <select
                value={abstainReasonInput}
                onChange={(e) => setAbstainReasonInput(e.target.value)}
                className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm"
                aria-label="Abstain reason"
              >
                {ABSTAIN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className={`${SEARCH_INPUT_BASE} w-[200px]`}
                aria-label="From"
              />
              <input
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className={`${SEARCH_INPUT_BASE} w-[200px]`}
                aria-label="To"
              />
            </>
          )}
        </div>

        {/* Optional filters */}
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Caller (foxy, ncert-solver, ...)"
            value={callerFilter}
            onChange={(e) => setCallerFilter(e.target.value)}
            className={`${SEARCH_INPUT_BASE} w-[240px]`}
            aria-label="Caller filter"
          />
          <input
            type="text"
            placeholder="Grade"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className={`${SEARCH_INPUT_BASE} w-[120px]`}
            aria-label="Grade filter"
          />
          <input
            type="text"
            placeholder="Subject"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className={`${SEARCH_INPUT_BASE} w-[160px]`}
            aria-label="Subject filter"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div
          data-testid="grounding-traces-error"
          className="mb-4 rounded-md bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-3 text-[13px] text-danger"
        >
          Error: {error}
        </div>
      )}

      {truncated && (
        <div className="mb-2 text-[11px] text-muted-foreground">
          Results truncated — narrow filters to see more.
        </div>
      )}

      {/* Results */}
      <div className="overflow-hidden rounded-lg border border-surface-3">
        <table className="w-full border-collapse text-[13px]" data-testid="traces-results-table">
          <thead>
            <tr>
              <th className={TH}>Timestamp</th>
              <th className={TH}>Caller</th>
              <th className={TH}>Subject</th>
              <th className={TH}>Grade</th>
              <th className={TH}>Chapter</th>
              <th className={TH}>Grounded</th>
              <th className={TH}>Abstain</th>
              <th className={TH}>Confidence</th>
              <th className={TH}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {!loading && traces.length === 0 && !error && (
              <tr>
                <td colSpan={9} className={`${TD} text-center text-muted-foreground`}>
                  No traces — run a search above.
                </td>
              </tr>
            )}
            {traces.map((t) => {
              const isExpanded = expandedId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className={`cursor-pointer ${isExpanded ? 'bg-surface-2' : ''}`}
                  >
                    <td className={TD}>{new Date(t.created_at).toLocaleString()}</td>
                    <td className={TD}>{t.caller}</td>
                    <td className={TD}>{t.subject_code}</td>
                    <td className={TD}>{t.grade}</td>
                    <td className={TD}>{t.chapter_number ?? '—'}</td>
                    <td className={TD}>
                      <span className={`font-semibold ${t.grounded ? 'text-success' : 'text-danger'}`}>
                        {t.grounded ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td className={TD}>
                      <code className="text-[11px] text-muted-foreground">{t.abstain_reason || '—'}</code>
                    </td>
                    <td className={TD}>{t.confidence !== null ? t.confidence.toFixed(2) : '—'}</td>
                    <td className={TD}>{t.latency_ms ?? '—'} ms</td>
                  </tr>
                  {isExpanded && (
                    <tr data-testid={`trace-detail-${t.id}`}>
                      <td colSpan={9} className={`${TD} bg-surface-2`}>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className={LABEL}>Retrieval</div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Chunks retrieved:</b> {t.chunk_count ?? 0}
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Top similarity:</b> {t.top_similarity !== null ? t.top_similarity.toFixed(3) : '—'}
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Embedding model:</b>{' '}
                              <code className="text-[11px]">{t.embedding_model ?? '—'}</code>
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Chunk IDs:</b>
                              <div className="mt-1 break-all text-[11px] text-muted-foreground">
                                {(t.retrieved_chunk_ids ?? []).slice(0, 6).join(', ') || '(none)'}
                                {(t.retrieved_chunk_ids ?? []).length > 6 && ` +${(t.retrieved_chunk_ids ?? []).length - 6} more`}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className={LABEL}>Generation (P13: hashes only, no body)</div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Claude model:</b> <code className="text-[11px]">{t.claude_model ?? '—'}</code>
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Prompt template:</b> <code className="text-[11px]">{t.prompt_template_id ?? '—'}</code>
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Prompt hash:</b>{' '}
                              <code className="text-[11px] text-muted-foreground">{t.prompt_hash ?? '—'}</code>
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Answer length:</b> {t.answer_length ?? '—'} chars
                            </div>
                            <div className="mb-1.5 text-xs text-foreground">
                              <b>Tokens:</b> in {t.input_tokens ?? '—'} / out {t.output_tokens ?? '—'}
                            </div>
                            <div className="text-xs text-foreground">
                              <b>Query preview:</b>{' '}
                              <span className="text-muted-foreground">{t.query_preview ?? '—'}</span>
                            </div>
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

export default function GroundingTracesPage() {
  return (
    <AdminShell>
      <TracesContent />
    </AdminShell>
  );
}
