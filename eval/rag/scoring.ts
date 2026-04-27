// eval/rag/scoring.ts
//
// Pure scoring functions for the RAG evaluation harness. No I/O — every
// function takes data in, returns data out. This makes the scoring logic
// trivially unit-testable in Vitest (src/__tests__/eval/rag-scoring.test.ts).
//
// Verdict rules (must match eval/rag/README.md):
//   In-scope query passes iff:
//     1. Response was non-abstain (scope_correct = true), AND
//     2. At least one citation's chapter_number is in must_cite_chapter_numbers
//        (or must_cite_chapter_numbers is empty/absent — then any citation passes
//        and citation_correct = true; if no citations at all, citation_correct = false), AND
//     3. No forbidden phrase appears in the response text.
//
//   Out-of-scope query passes iff:
//     1. Response abstained (scope_correct = true), AND
//     2. (Optional) abstain_reason or response text contains an abstain_phrase.
//        We do not require this — abstaining is sufficient — but if abstain_phrases
//        is set and none match, we surface that as a soft signal in fail_reason.
//
// Failure mode taxonomy (fail_reason strings, used for triage):
//   - "scope_mismatch:in_scope_abstained"  — should answer, refused
//   - "scope_mismatch:out_of_scope_answered" — should refuse, answered
//   - "citation_mismatch"                  — answered but cited wrong chapter
//   - "no_citations"                       — answered but cited nothing
//   - "forbidden_phrase"                   — answer contained a banned phrase

import type { GoldQuery, Result, ScoredResult, EvalReport } from './types.ts';

/**
 * Score a single (query, result) pair. Pure function — no side effects.
 * Returns a fully populated ScoredResult with overall_pass set.
 */
export function scoreResult(query: GoldQuery, result: Result): ScoredResult {
  const responseText = (result.grounded_response.text ?? '').toLowerCase();
  const abstained = result.grounded_response.abstained === true;
  const abstainReason = (result.grounded_response.abstain_reason ?? '').toLowerCase();
  const citations = result.grounded_response.citations ?? [];
  const citationCount = citations.length;

  // ─── Forbidden phrases (case-insensitive substring match) ────────────────
  const forbidden = (query.expected.forbidden_phrases ?? []).map((p) => p.toLowerCase());
  const forbidden_phrase_present = forbidden.some((p) => responseText.includes(p));

  // ─── Abstain phrases (matches either response text or the reason code) ──
  const abstainPhrases = (query.expected.abstain_phrases ?? []).map((p) => p.toLowerCase());
  const abstain_phrase_present = abstainPhrases.some(
    (p) => responseText.includes(p) || abstainReason.includes(p),
  );

  if (query.expected.is_in_scope) {
    // ─── In-scope branch ──────────────────────────────────────────────────
    const scope_correct = !abstained && !result.error;

    // citation_correct semantics for in-scope:
    //   - abstained or runner error → null (not applicable)
    //   - must_cite list set: at least one citation chapter must be in the list
    //   - no must_cite list: at least one citation must exist; otherwise false
    let citation_correct: boolean | null;
    if (!scope_correct) {
      citation_correct = null;
    } else {
      const required = query.expected.must_cite_chapter_numbers ?? [];
      if (required.length === 0) {
        citation_correct = citationCount > 0;
      } else {
        citation_correct = citations.some((c) => required.includes(c.chapter_number));
      }
    }

    let fail_reason: string | undefined;
    if (!scope_correct) {
      fail_reason = result.error ? `runner_error:${result.error}` : 'scope_mismatch:in_scope_abstained';
    } else if (forbidden_phrase_present) {
      fail_reason = 'forbidden_phrase';
    } else if (citation_correct === false) {
      fail_reason = citationCount === 0 ? 'no_citations' : 'citation_mismatch';
    }

    const overall_pass =
      scope_correct && citation_correct === true && !forbidden_phrase_present;

    return {
      query_id: query.id,
      scope_correct,
      citation_correct,
      citation_count: citationCount,
      forbidden_phrase_present,
      abstain_phrase_present,
      overall_pass,
      fail_reason,
    };
  }

  // ─── Out-of-scope branch ───────────────────────────────────────────────
  const scope_correct = abstained;
  // Citations not applicable to out-of-scope expectations.
  const citation_correct: boolean | null = null;

  let fail_reason: string | undefined;
  if (!scope_correct) {
    fail_reason = result.error
      ? `runner_error:${result.error}`
      : 'scope_mismatch:out_of_scope_answered';
  } else if (abstainPhrases.length > 0 && !abstain_phrase_present) {
    // Soft warning only — abstaining is still a pass. We surface this in
    // fail_reason for triage but DO NOT fail overall_pass on it.
    fail_reason = undefined;
  }

  const overall_pass = scope_correct;

  return {
    query_id: query.id,
    scope_correct,
    citation_correct,
    citation_count: citationCount,
    forbidden_phrase_present,
    abstain_phrase_present,
    overall_pass,
    fail_reason,
  };
}

/**
 * Aggregate per-query scores into an EvalReport. Pure function. The latency
 * inputs come from the corresponding Result entries — pass them in as a
 * second argument so this stays I/O free.
 *
 * @param scored  Array of ScoredResult, one per query.
 * @param results Array of raw Result, parallel to `scored` (same order).
 *                Used only for latency stats. Pass [] to skip latency.
 * @param startedAt ISO timestamp run began (caller-supplied).
 * @param finishedAt ISO timestamp run ended (caller-supplied).
 */
export function aggregateReport(
  scored: ScoredResult[],
  results: Result[] = [],
  startedAt: string = new Date().toISOString(),
  finishedAt: string = new Date().toISOString(),
): EvalReport {
  const total = scored.length;
  const passed = scored.filter((s) => s.overall_pass).length;
  const failed = total - passed;
  const pass_rate = total === 0 ? 0 : passed / total;

  // For accurate in/out-of-scope counts, we need the GoldQuery context. We
  // infer it from citation_correct: null on out-of-scope queries. This is
  // safe given how scoreResult sets the field. (in-scope sets non-null when
  // scope_correct=true, null when scope_correct=false. Out-of-scope ALWAYS
  // sets null.) That ambiguity means we instead track separately by using
  // a pre-computed flag — but to keep this fn pure we use the scope_correct
  // pattern: if a result with citation_correct=null also has scope_correct=true,
  // it's out-of-scope (correctly abstained). If scope_correct=false AND
  // citation_correct=null, it could be either (in-scope abstained OR
  // out-of-scope answered). We can't disambiguate without GoldQuery, so for
  // the in/out breakdown we accept best-effort via fail_reason inspection.

  let inScopeTotal = 0;
  let inScopePassed = 0;
  let outOfScopeTotal = 0;
  let outOfScopePassed = 0;

  for (const s of scored) {
    const inferredOutOfScope =
      s.fail_reason === 'scope_mismatch:out_of_scope_answered' ||
      (s.scope_correct && s.citation_correct === null && s.citation_count === 0);
    if (inferredOutOfScope) {
      outOfScopeTotal += 1;
      if (s.overall_pass) outOfScopePassed += 1;
    } else {
      inScopeTotal += 1;
      if (s.overall_pass) inScopePassed += 1;
    }
  }

  const latencies = results
    .filter((r) => !r.error && Number.isFinite(r.latency_ms))
    .map((r) => r.latency_ms)
    .sort((a, b) => a - b);

  const mean_latency_ms =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((sum, n) => sum + n, 0) / latencies.length);
  const p95Index = Math.max(0, Math.floor(latencies.length * 0.95) - 1);
  const p95_latency_ms = latencies.length === 0 ? 0 : latencies[Math.min(p95Index, latencies.length - 1)];

  return {
    total,
    passed,
    failed,
    pass_rate,
    in_scope: {
      total: inScopeTotal,
      passed: inScopePassed,
      pass_rate: inScopeTotal === 0 ? 0 : inScopePassed / inScopeTotal,
    },
    out_of_scope: {
      total: outOfScopeTotal,
      passed: outOfScopePassed,
      pass_rate: outOfScopeTotal === 0 ? 0 : outOfScopePassed / outOfScopeTotal,
    },
    mean_latency_ms,
    p95_latency_ms,
    results: scored,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}
