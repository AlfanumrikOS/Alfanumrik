// eval/rag/types.ts
//
// Type contracts for the RAG evaluation harness. Mirrors the
// grounded-answer service response shape (supabase/functions/grounded-answer
// /types.ts) on the result side, and adds gold-query / scoring-result types.
//
// Single responsibility: type definitions only. No I/O, no logic. Imported by
// runner.ts (calls live service), scoring.ts (pure scoring functions), and
// the Vitest tests in src/__tests__/eval/.

/** CBSE grades supported by the platform (P5: strings only). */
export type Grade = '6' | '7' | '8' | '9' | '10' | '11' | '12';

/**
 * A single curated gold query. Authored by hand in the JSON fixture files
 * under eval/rag/fixtures/. Each query encodes the expected behaviour the
 * grounded-answer service must produce — both the in-scope happy path and
 * the must-abstain branches.
 */
export interface GoldQuery {
  /** Stable id, e.g. "g9-math-linear-eq-001". Used to track regressions across runs. */
  id: string;
  /** The natural-language student query. */
  query: string;
  /** Target grade (string per P5). */
  grade: Grade;
  /** Subject code, e.g. "math", "science". Lowercase. */
  subject: string;
  /** Optional hint to bias retrieval scope; runner may pass to the service. */
  chapter_number?: number;
  /** Optional canonical chapter title hint; runner may pass to the service. */
  chapter_title?: string;
  /** Expectations the response must satisfy to count as a pass. */
  expected: {
    /** false = the service MUST abstain (out-of-scope, off-curriculum, PII, etc.). */
    is_in_scope: boolean;
    /** Canonical NCERT chapter name. Optional; only used for soft assertions in notes. */
    expected_chapter?: string;
    /** Any chapter_number in this list is acceptable for citation. Empty/absent = any. */
    must_cite_chapter_numbers?: number[];
    /** Phrases the in-scope response MUST NOT contain (e.g. "I don't know"). */
    forbidden_phrases?: string[];
    /** Phrases an out-of-scope abstain MAY contain to confirm correct refusal. */
    abstain_phrases?: string[];
  };
  /** Free-form note. Use "chapter name unverified" when chapter wasn't double-checked. */
  notes?: string;
}

/**
 * Mirror of grounded-answer Citation (excerpt copied so eval/ has no Deno
 * imports). Keep in lockstep with supabase/functions/grounded-answer/types.ts.
 */
export interface ResultCitation {
  index: number;
  chunk_id: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
  media_url: string | null;
}

/**
 * Normalized result returned by runner.ts. Both grounded and abstain branches
 * collapse to the same shape so scoring.ts has one code path.
 *
 * - grounded=true responses → text=answer, citations=service citations, abstained=false
 * - abstain responses       → text="", citations=[], abstained=true
 *                             abstain_reason carries the service's reason code
 * - hop/runner errors       → text="", abstained=false, error="..."
 */
export interface Result {
  query_id: string;
  grounded_response: {
    text: string;
    citations: ResultCitation[];
    abstained: boolean;
    /** Present only when abstained=true. Mirrors GroundedResponse.abstain_reason. */
    abstain_reason?: string;
    /** trace_id from the service (for forensic correlation across runs). */
    trace_id?: string;
  };
  /** Wall-clock latency from runner POST → response parsed. */
  latency_ms: number;
  /** Set when the runner could not even invoke the service (network, missing env, etc.). */
  error?: string;
}

/**
 * Per-query scoring outcome. Computed by scoring.scoreResult() — pure function,
 * no I/O. The boolean gates (`scope_correct`, `citation_correct`) drive the
 * overall_pass verdict that gets aggregated.
 */
export interface ScoredResult {
  query_id: string;
  /**
   * For in-scope queries: true if response was provided (not abstained).
   * For out-of-scope queries: true if response abstained.
   */
  scope_correct: boolean;
  /**
   * - true: in-scope query, citations include at least one expected chapter_number
   *         (or no expected list was set, so any citation passes)
   * - false: in-scope query, no citation matched expected chapter_number
   * - null: not applicable (abstained, or out-of-scope query)
   */
  citation_correct: boolean | null;
  citation_count: number;
  /** True if any forbidden_phrase appeared in the response text. */
  forbidden_phrase_present: boolean;
  /** True if any abstain_phrase appeared in the response text or abstain_reason. */
  abstain_phrase_present: boolean;
  /** Composite verdict: scope_correct AND citation_correct AND no forbidden phrases. */
  overall_pass: boolean;
  /** Reason for failure when overall_pass=false. Empty when pass. */
  fail_reason?: string;
}

/**
 * Aggregate report produced by scoring.aggregateReport(). Persisted to
 * eval/rag/reports/<timestamp>.json by scripts/rag-eval.mjs.
 */
export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  /** Breakdown by in-scope vs out-of-scope so we see asymmetric regressions. */
  in_scope: { total: number; passed: number; pass_rate: number };
  out_of_scope: { total: number; passed: number; pass_rate: number };
  /** Mean latency across all queries that returned (excludes runner errors). */
  mean_latency_ms: number;
  p95_latency_ms: number;
  /** Per-query verdicts. */
  results: ScoredResult[];
  /** ISO 8601 UTC timestamp the run started. */
  started_at: string;
  /** ISO 8601 UTC timestamp the run finished. */
  finished_at: string;
}
