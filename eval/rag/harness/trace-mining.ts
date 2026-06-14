// eval/rag/harness/trace-mining.ts
//
// B1 retrieval-quality eval harness — Task 4: trace-mining tool.
//
// Samples DISTINCT queries from the production trace tables
// (`grounded_ai_traces` preferred, `retrieval_traces` as the richer fallback)
// to produce `trace_mined`-tier golden-item CANDIDATES — query candidates +
// provenance, ready for later relevance labeling by the Task 3 Sonnet judge.
// It does NOT label relevance here (that is Task 3 / Task 9).
//
// This module is offline tooling. It is NEVER imported by production / client
// code (enforced by the Task 8 import-boundary test). Any REAL DB read is
// service-role server-only / offline (B6) — the tests inject a FAKE client, so
// nothing here opens a connection.
//
// ── P13 is the headline invariant ───────────────────────────────────────────
//
// A1 — COLUMN-ALLOWLIST PROJECTION (MUST). The SELECT is built from an explicit
//   per-table non-PII column allowlist constant — NEVER `SELECT *`. The harness
//   must NEVER pull an identifier into memory:
//     - `grounded_ai_traces.student_id`   — FORBIDDEN
//     - `retrieval_traces.user_id`        — FORBIDDEN
//     - `retrieval_traces.session_id`     — FORBIDDEN
//   These three (plus any future identifier column) live in
//   `FORBIDDEN_TRACE_COLUMNS`; a unit test asserts neither the projection
//   constants nor the actual `.select()` string contain any of them.
//
// B3 — PII SCRUB + sha256-DEFAULT (MUST). Mined query text runs through
//   `redactPIIInText()` (via `scrub.ts`). Because that redactor deliberately
//   does NOT strip names, `query_sha256`-ONLY storage is the DEFAULT for
//   trace-mined query text: a candidate carries a `query_sha256` and NO preview
//   unless the caller explicitly opts in (`retainPreview`), in which case the
//   preview is the SCRUBBED text only. The sha256 is the canonical hex digest
//   (see `scrub.ts:sha256Hex`); for `retrieval_traces` the already-persisted
//   `query_sha256` column is PRESERVED (never re-hash a redacted preview).

import { scrubText, sha256Hex } from './scrub';

// ─── A1 — per-table non-PII column allowlists (spec §B1.3 → A1) ──────────────
//
// These are the EXACT non-PII columns the spec permits the harness to read.
// They are the AUTHORITY on "what may be projected"; `*_PROJECTION` below is the
// (possibly narrower) set the tool actually selects. The test pins:
//   projection ⊆ allowlist  AND  projection ∩ FORBIDDEN = ∅.

/** Allowed columns from `grounded_ai_traces` (spec §B1.3 → A1). */
export const GROUNDED_AI_TRACES_ALLOWLIST = [
  'caller',
  'grade',
  'subject_code',
  'chapter_number',
  'query_hash',
  'query_preview',
  'retrieved_chunk_ids',
  'top_similarity',
  'chunk_count',
  'grounded',
  'confidence',
  'latency_ms',
  'created_at',
] as const;
export type GroundedAiTracesColumn = (typeof GROUNDED_AI_TRACES_ALLOWLIST)[number];

/** Allowed columns from `retrieval_traces` (spec §B1.3 → A1). */
export const RETRIEVAL_TRACES_ALLOWLIST = [
  'caller',
  'grade',
  'subject',
  'chapter_number',
  'concept',
  'query_text',
  'query_sha256',
  'embedding_model',
  'reranked',
  'chunk_ids',
  'match_count',
  'latency_ms',
  'created_at',
] as const;
export type RetrievalTracesColumn = (typeof RETRIEVAL_TRACES_ALLOWLIST)[number];

/**
 * The forbidden identifier columns — NEVER projected (P13). Listing them
 * explicitly turns "did someone widen the projection to an identifier?" into a
 * single denylist assertion in `trace-mining.test.ts`.
 */
export const FORBIDDEN_TRACE_COLUMNS = [
  'student_id', // grounded_ai_traces
  'user_id', // retrieval_traces
  'session_id', // retrieval_traces
] as const;

// ─── The PROJECTION the tool actually selects ────────────────────────────────
//
// We project exactly the columns the candidate stub needs. Each is a member of
// its table's allowlist (the test enforces the subset relation). No identifier
// is ever named here.

/** What the tool SELECTs from `grounded_ai_traces`. */
export const GROUNDED_AI_TRACES_PROJECTION = [
  'caller',
  'grade',
  'subject_code',
  'chapter_number',
  'query_hash',
  'query_preview',
  'created_at',
] as const satisfies readonly GroundedAiTracesColumn[];

/** What the tool SELECTs from `retrieval_traces`. */
export const RETRIEVAL_TRACES_PROJECTION = [
  'caller',
  'grade',
  'subject',
  'chapter_number',
  'concept',
  'query_text',
  'query_sha256',
  'created_at',
] as const satisfies readonly RetrievalTracesColumn[];

export type TraceTable = 'grounded_ai_traces' | 'retrieval_traces';

/**
 * Build the comma-joined Postgres `select(...)` column string for a table from
 * its PROJECTION constant. NEVER returns `'*'`. This is the single place the
 * SELECT column list is materialised, so the denylist test has one seam.
 */
export function buildSelectColumns(table: TraceTable): string {
  const cols =
    table === 'grounded_ai_traces'
      ? GROUNDED_AI_TRACES_PROJECTION
      : RETRIEVAL_TRACES_PROJECTION;
  return cols.join(', ');
}

// ─── Mined candidate shape ───────────────────────────────────────────────────
//
// A candidate is a `trace_mined`-tier golden-item STUB: a query identity
// (sha256) + the non-PII context columns needed to label it later. It carries
// NO relevance labels (Task 3/9 supply those) and NO student identifier (it was
// never SELECTed). It maps onto the Task 1 `GoldenItem` + `GoldenProvenance`
// shape when the judge promotes it into the fixture.

export interface MinedCandidate {
  /** Which table the candidate was mined from. */
  trace_table: TraceTable;
  /** B3 — the DEFAULT identity for mined query text (64-hex sha256). */
  query_sha256: string;
  /**
   * A SCRUBBED query preview — present ONLY when the caller opts in via
   * `retainPreview` AND a preview text was available. Always post-
   * `redactPIIInText`. Absent by default (sha256-only is the default, B3).
   */
  query_preview?: string;
  /** P5 grade string, from the allowed `grade` column (may be null in a trace). */
  grade: string | null;
  /** Canonical snake_case subject code, from `subject_code` / `subject`. */
  subject: string | null;
  /** From the allowed `chapter_number` column. */
  chapter_number: number | null;
  /** From the allowed `concept` column (retrieval_traces only). */
  concept: string | null;
  /** When the candidate was mined (harness-side ISO timestamp). */
  mined_at: string;
}

export interface MineOptions {
  /** Max rows to pull per table (the tool dedupes after). Default 200. */
  limit?: number;
  /**
   * Opt-in to retaining a SCRUBBED query preview alongside the sha256. Default
   * `false` — sha256-only is the B3 default because `redactPIIInText` does not
   * strip names, so a preview is only safe where the caller has determined the
   * text is provably PII-free (e.g. an assessment-reviewed seed). Even when
   * true, the preview is the redacted text only.
   */
  retainPreview?: boolean;
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
}

// ─── Minimal injected-client contract ────────────────────────────────────────
//
// We depend on the NARROWEST possible Supabase surface so the tool can take
// either a real service-role client (offline) or a hand-rolled fake (tests),
// with no `any`. The chain is `from(table).select(cols).limit(n)` → awaitable.

interface TraceQueryResult {
  data: Record<string, unknown>[] | null;
  error: unknown;
}

interface TraceQueryBuilder extends PromiseLike<TraceQueryResult> {
  limit(n: number): PromiseLike<TraceQueryResult>;
}

interface TraceSelectable {
  select(columns: string): TraceQueryBuilder;
}

export interface TraceMiningClient {
  from(table: string): TraceSelectable;
}

// ─── Internal row → candidate projection ─────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Project a `grounded_ai_traces` row (already restricted to the projection
 * columns by the SELECT) into a candidate. Grounded traces carry only a
 * `query_preview` (already redacted ≤200 chars) — we re-scrub it (defense in
 * depth) and compute the sha256 over the SCRUBBED preview (grounded traces have
 * no full-text sha256 column). sha256-only by default.
 */
function projectGroundedRow(
  row: Record<string, unknown>,
  opts: Required<Pick<MineOptions, 'retainPreview'>>,
  minedAt: string,
): MinedCandidate {
  const previewRaw = asString(row.query_preview) ?? '';
  const scrubbed = scrubText(previewRaw);
  const candidate: MinedCandidate = {
    trace_table: 'grounded_ai_traces',
    query_sha256: sha256Hex(scrubbed.text),
    grade: asString(row.grade),
    subject: asString(row.subject_code),
    chapter_number: asNumber(row.chapter_number),
    concept: null,
    mined_at: minedAt,
  };
  if (opts.retainPreview && scrubbed.text.length > 0) {
    candidate.query_preview = scrubbed.text;
  }
  return candidate;
}

/**
 * Project a `retrieval_traces` row into a candidate. retrieval_traces carries
 * a `query_sha256` column (sha256 of the ORIGINAL full text) — we PRESERVE it
 * (never re-hash a redacted preview, which would diverge from the persisted
 * analytics identifier). If absent, fall back to hashing the scrubbed preview.
 */
function projectRetrievalRow(
  row: Record<string, unknown>,
  opts: Required<Pick<MineOptions, 'retainPreview'>>,
  minedAt: string,
): MinedCandidate {
  const previewRaw = asString(row.query_text) ?? '';
  const scrubbed = scrubText(previewRaw);
  const persistedSha = asString(row.query_sha256);
  const candidate: MinedCandidate = {
    trace_table: 'retrieval_traces',
    query_sha256: persistedSha ?? sha256Hex(scrubbed.text),
    grade: asString(row.grade),
    subject: asString(row.subject),
    chapter_number: asNumber(row.chapter_number),
    concept: asString(row.concept),
    mined_at: minedAt,
  };
  if (opts.retainPreview && scrubbed.text.length > 0) {
    candidate.query_preview = scrubbed.text;
  }
  return candidate;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Read candidate queries from `grounded_ai_traces` + `retrieval_traces` and
 * produce deduped `trace_mined`-tier golden-item candidate stubs.
 *
 * READ-ONLY: only `.select()` is ever invoked — zero writes to any table. The
 * SELECT is built from the A1 column-allowlist (`buildSelectColumns`), so no
 * identifier ever enters harness memory. Each candidate carries a
 * `query_sha256` by default (B3) and a SCRUBBED preview only on opt-in. Deduped
 * by `query_sha256`. NO relevance labels are assigned here (Task 3/9).
 */
export async function mineTraceCandidates(
  supabase: TraceMiningClient,
  options: MineOptions = {},
): Promise<MinedCandidate[]> {
  const limit = options.limit ?? 200;
  const now = options.now ?? (() => new Date());
  const minedAt = now().toISOString();
  const retainPreview = options.retainPreview ?? false;
  const projOpts = { retainPreview };

  const candidates: MinedCandidate[] = [];

  // ── grounded_ai_traces (preferred) ──
  const groundedRes = await supabase
    .from('grounded_ai_traces')
    .select(buildSelectColumns('grounded_ai_traces'))
    .limit(limit);
  if (!groundedRes.error && groundedRes.data) {
    for (const row of groundedRes.data) {
      candidates.push(projectGroundedRow(row, projOpts, minedAt));
    }
  }

  // ── retrieval_traces (richer fallback) ──
  const retrievalRes = await supabase
    .from('retrieval_traces')
    .select(buildSelectColumns('retrieval_traces'))
    .limit(limit);
  if (!retrievalRes.error && retrievalRes.data) {
    for (const row of retrievalRes.data) {
      candidates.push(projectRetrievalRow(row, projOpts, minedAt));
    }
  }

  // ── Dedupe by query_sha256 (the stable query identity) ──
  const seen = new Set<string>();
  const deduped: MinedCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.query_sha256)) continue;
    seen.add(c.query_sha256);
    deduped.push(c);
  }
  return deduped;
}
