'use client';

import { useCallback, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Grounding Traces</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Search grounded_ai_traces for incident triage. P13: prompt bodies are never shown — only the template hash.
          </p>
        </div>
      </div>

      {/* Search form */}
      <form
        onSubmit={runSearch}
        data-testid="traces-search-form"
        style={{ ...S.card, marginBottom: 16 }}
      >
        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['traceId', 'studentId', 'abstainReason'] as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                ...S.filterBtn,
                ...(mode === m ? S.filterActive : {}),
              }}
            >
              {m === 'traceId' ? 'By Trace ID' : m === 'studentId' ? 'By Student' : 'By Abstain Reason'}
            </button>
          ))}
        </div>

        {/* Mode-specific inputs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {mode === 'traceId' && (
            <input
              type="text"
              placeholder="Trace UUID"
              value={traceIdInput}
              onChange={(e) => setTraceIdInput(e.target.value)}
              style={{ ...S.searchInput, width: 340 }}
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
                style={{ ...S.searchInput, width: 340 }}
                aria-label="Student ID"
              />
              <input
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                style={{ ...S.searchInput, width: 200 }}
                aria-label="From"
              />
              <input
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                style={{ ...S.searchInput, width: 200 }}
                aria-label="To"
              />
            </>
          )}
          {mode === 'abstainReason' && (
            <>
              <select
                value={abstainReasonInput}
                onChange={(e) => setAbstainReasonInput(e.target.value)}
                style={S.select}
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
                style={{ ...S.searchInput, width: 200 }}
                aria-label="From"
              />
              <input
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                style={{ ...S.searchInput, width: 200 }}
                aria-label="To"
              />
            </>
          )}
        </div>

        {/* Optional filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Caller (foxy, ncert-solver, ...)"
            value={callerFilter}
            onChange={(e) => setCallerFilter(e.target.value)}
            style={{ ...S.searchInput, width: 240 }}
            aria-label="Caller filter"
          />
          <input
            type="text"
            placeholder="Grade"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            style={{ ...S.searchInput, width: 120 }}
            aria-label="Grade filter"
          />
          <input
            type="text"
            placeholder="Subject"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            style={{ ...S.searchInput, width: 160 }}
            aria-label="Subject filter"
          />
        </div>

        <button type="submit" style={S.primaryBtn} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div
          data-testid="grounding-traces-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error: {error}
        </div>
      )}

      {truncated && (
        <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8 }}>
          Results truncated — narrow filters to see more.
        </div>
      )}

      {/* Results */}
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table} data-testid="traces-results-table">
          <thead>
            <tr>
              <th style={S.th}>Timestamp</th>
              <th style={S.th}>Caller</th>
              <th style={S.th}>Subject</th>
              <th style={S.th}>Grade</th>
              <th style={S.th}>Chapter</th>
              <th style={S.th}>Grounded</th>
              <th style={S.th}>Abstain</th>
              <th style={S.th}>Confidence</th>
              <th style={S.th}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {!loading && traces.length === 0 && !error && (
              <tr>
                <td colSpan={9} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                  No traces — run a search above.
                </td>
              </tr>
            )}
            {traces.map((t) => {
              const isExpanded = expandedId === t.id;
              return (
                <>
                  <tr
                    key={t.id}
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    style={{ cursor: 'pointer', background: isExpanded ? colors.surface : undefined }}
                  >
                    <td style={S.td}>{new Date(t.created_at).toLocaleString()}</td>
                    <td style={S.td}>{t.caller}</td>
                    <td style={S.td}>{t.subject_code}</td>
                    <td style={S.td}>{t.grade}</td>
                    <td style={S.td}>{t.chapter_number ?? '—'}</td>
                    <td style={S.td}>
                      <span style={{ color: t.grounded ? colors.success : colors.danger, fontWeight: 600 }}>
                        {t.grounded ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text2 }}>{t.abstain_reason || '—'}</code>
                    </td>
                    <td style={S.td}>{t.confidence !== null ? t.confidence.toFixed(2) : '—'}</td>
                    <td style={S.td}>{t.latency_ms ?? '—'} ms</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${t.id}-detail`} data-testid={`trace-detail-${t.id}`}>
                      <td colSpan={9} style={{ ...S.td, background: colors.surface }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                              Retrieval
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Chunks retrieved:</b> {t.chunk_count ?? 0}
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Top similarity:</b> {t.top_similarity !== null ? t.top_similarity.toFixed(3) : '—'}
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Embedding model:</b>{' '}
                              <code style={{ fontSize: 11 }}>{t.embedding_model ?? '—'}</code>
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Chunk IDs:</b>
                              <div style={{ fontSize: 11, color: colors.text2, marginTop: 4, wordBreak: 'break-all' }}>
                                {(t.retrieved_chunk_ids ?? []).slice(0, 6).join(', ') || '(none)'}
                                {(t.retrieved_chunk_ids ?? []).length > 6 && ` +${(t.retrieved_chunk_ids ?? []).length - 6} more`}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                              Generation (P13: hashes only, no body)
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Claude model:</b> <code style={{ fontSize: 11 }}>{t.claude_model ?? '—'}</code>
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Prompt template:</b> <code style={{ fontSize: 11 }}>{t.prompt_template_id ?? '—'}</code>
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Prompt hash:</b>{' '}
                              <code style={{ fontSize: 11, color: colors.text2 }}>{t.prompt_hash ?? '—'}</code>
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Answer length:</b> {t.answer_length ?? '—'} chars
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1, marginBottom: 6 }}>
                              <b>Tokens:</b> in {t.input_tokens ?? '—'} / out {t.output_tokens ?? '—'}
                            </div>
                            <div style={{ fontSize: 12, color: colors.text1 }}>
                              <b>Query preview:</b>{' '}
                              <span style={{ color: colors.text2 }}>{t.query_preview ?? '—'}</span>
                            </div>
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

export default function GroundingTracesPage() {
  return (
    <AdminShell>
      <TracesContent />
    </AdminShell>
  );
}