// supabase/functions/grounded-answer/mol-telemetry-adapter.ts
//
// C3 (MOL grounded-answer integration, 2026-05-18).
// Telemetry-only adapter: shadow-logs every callClaude() invocation in
// grounded-answer into mol_request_logs WITHOUT routing the call through
// MOL. Zero user-visible behavior change. Gated by feature flag
// `ff_grounded_answer_mol_telemetry_v1` (default OFF; flag check happens
// at the call site, not in this adapter).
//
// Why an adapter and not a direct telemetry import:
//   1. We need to map grounded-answer's (caller, mode, isGroundingCheck)
//      tuple to MOL's (surface, task_type) tuple in exactly one place so
//      the contract doesn't drift across pipeline.ts, pipeline-stream.ts,
//      and grounding-check.ts.
//   2. We need to split ClaudeResponse's flat inputTokens/outputTokens
//      into MOL's TokenUsage shape at a single boundary.
//   3. We need to swallow ALL errors here — telemetry writes must NEVER
//      bubble up and affect the student-facing response.
//
// TODO(c4-handoff): When Phase C4 ships shadow-routing through MOL, the
// telemetry rows must come from the MOL request itself (router.ts emits
// recordMolRequest internally). The C4 implementer MUST REPLACE the
// shadowLogClaudeCall sites in pipeline.ts / pipeline-stream.ts /
// grounding-check.ts with the through-MOL routed call — do NOT stack a
// shadow log on top of an already-routed call or every request will
// double-count in mol_request_logs.

import {
  recordMolRequest,
  calcCost,
  toInr,
  type LogPayload,
} from '../_shared/mol/telemetry.ts';
import type { TaskType, StudentContext } from '../_shared/mol/types.ts';
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts';
import { failureLabel, type ClaudeResponse } from './claude.ts';

/** Feature-flag name. Default OFF in feature_flags table — owner: ops. */
const C3_TELEMETRY_FLAG = 'ff_grounded_answer_mol_telemetry_v1';

/** Anthropic provider literal — only provider exercised in C3. C4 may add 'openai'. */
const PROVIDER_LITERAL = 'anthropic';

/**
 * Stable surface label for mol_request_logs.surface. Maps grounded-answer's
 * `caller` (5 values) to MOL's `surface` enum (4 values + null).
 *
 * - 'foxy'           → 'foxy'   (student chat surface)
 * - 'ncert-solver'   → 'solver' (problem-solver surface)
 * - 'quiz-generator' → 'quiz'   (quiz authoring + generation)
 * - 'lesson'         → 'lesson' (Lesson Generation Agent — student-facing
 *                                generative lesson notes; GenAI Phase 5b)
 * - 'concept-engine' → null     (internal indexing; no student-facing surface)
 * - 'diagnostic'     → null     (internal health probes; no student surface)
 * - anything else    → null     (defensive — future callers must register here)
 *
 * No 'ocr' mapping in C3 — OCR runs through `scan-ocr`, not grounded-answer.
 * It's kept in the type for forward compatibility.
 *
 * The 'lesson' surface has no dedicated slot in mol_request_logs' documented
 * enum, but the column is free-text (`text`, no CHECK — see migration
 * 20260518000001 comment "'foxy' | 'quiz' | 'solver' | 'ocr' | other") and
 * LogPayload.surface is `string | null`, so registering 'lesson' explicitly
 * (rather than conflating it with 'foxy' chat or the internal-null bucket)
 * keeps its cost/latency attribution clean. A formal enum/CHECK slot is an
 * architect follow-up.
 */
export function mapCallerToSurface(caller: string): 'foxy' | 'quiz' | 'solver' | 'ocr' | 'lesson' | null {
  switch (caller) {
    case 'foxy':
      return 'foxy';
    case 'quiz-generator':
      return 'quiz';
    case 'ncert-solver':
      return 'solver';
    case 'lesson':
      return 'lesson';
    case 'concept-engine':
    case 'diagnostic':
      return null;
    default:
      return null;
  }
}

/**
 * Map the (caller, mode, isGroundingCheck) tuple to MOL's TaskType. The
 * isGroundingCheck flag wins over caller because the second-pass fact-check
 * is structurally different from any primary answer regardless of which
 * upstream caller initiated it.
 *
 * - isGroundingCheck=true  → 'grounding_check' (the C3-introduced literal)
 * - caller='foxy'          → 'doubt_solving'   (Foxy chat is always doubt-style)
 * - caller='ncert-solver'  → 'step_by_step'    (the solver emits ordered steps)
 * - caller='quiz-generator'→ 'quiz_generation' (matches MOL plan-table label)
 * - caller='concept-engine'→ 'concept_explanation'
 * - caller='lesson'        → 'concept_explanation' (structured chapter lesson
 *                            notes are, task-wise, extended concept teaching;
 *                            no lesson-specific TaskType literal exists and
 *                            adding one to _shared/mol/types.ts is an architect
 *                            follow-up — MOL ignores unknown task_types anyway)
 * - caller='diagnostic'    → 'evaluation'      (initial knowledge assessment)
 * - unknown caller         → 'explanation'     (broad fallback)
 *
 * Note on the mode parameter: today we don't split soft/strict in the task
 * type. We pass `mode` through so C4 can decide to split if dashboards need
 * it (e.g. 'doubt_solving' vs 'doubt_solving_strict'); for C3 it's ignored.
 *
 * TODO(c5): mapping-refinement
 * When C5 lands, this map needs:
 *   1. Foxy mode plumbed in to split doubt_solving/practice/learn/explain/revise
 *   2. template_name plumbed in to split quiz-generator generator vs evaluator
 *   3. New 'recall' literal added to TaskType union and used for Foxy revise + SRS reviews
 * Backfill plan: SQL re-tag historical mol_request_logs rows by JOINing grounded_ai_traces
 * on the new trace_id column (added in C4) to recover the original caller intent.
 */
export function mapPipelineToTaskType(args: {
  caller: string;
  mode: 'soft' | 'strict';
  isGroundingCheck: boolean;
}): TaskType {
  if (args.isGroundingCheck) return 'grounding_check';
  switch (args.caller) {
    case 'foxy':
      // KNOWN COARSENESS (C5 refinement): collapses all Foxy modes (learn/explain/practice/revise)
      // to doubt_solving. Pedagogically:
      //   - practice mode is closer to quiz_generation
      //   - learn mode is concept_explanation
      //   - explain mode is explanation
      //   - revise mode is recall (C5-pending task type)
      // Fixing this requires plumbing Foxy mode into GroundedRequest.generation as a first-class
      // field — a contract change that's out of scope for "telemetry-only" C3.
      // See TODO(c5): mapping-refinement above.
      return 'doubt_solving';
    case 'ncert-solver':
      return 'step_by_step';
    case 'quiz-generator':
      // KNOWN COARSENESS (C5 refinement): collapses pass-1 generator + pass-2 verifier calls.
      // The verifier (quiz_answer_verifier_v1 template) is structurally `evaluation`, not
      // `quiz_generation`. Distinguishing them requires the adapter to know which template
      // the call uses — needs template_name plumbed into the call site.
      // See TODO(c5): mapping-refinement above.
      return 'quiz_generation';
    case 'concept-engine':
      return 'concept_explanation';
    case 'lesson':
      // Lesson notes = extended, structured concept teaching for a chapter.
      return 'concept_explanation';
    case 'diagnostic':
      // Diagnostic callers run initial knowledge assessment, which is structurally
      // `evaluation` (the student is being measured, not taught). Distinct from
      // the broad `explanation` fallback used for unknown callers.
      return 'evaluation';
    default:
      // Broad fallback — 'explanation' is the most generic TaskType in MOL.
      // Keeps telemetry rows valid even if a brand-new caller is registered
      // in config.ts before this adapter is updated.
      return 'explanation';
  }
}

/**
 * Minimal student-context surface needed by the adapter. We deliberately
 * do NOT depend on the MOL StudentContext type here — grounded-answer's
 * GroundedRequest doesn't carry `language` or `exam_goal`, and the adapter
 * must accept a `null` context for anonymous diagnostic flows (the
 * mol_request_logs.student_id column is NULLABLE — see C3 pre-verified
 * facts list).
 */
export interface AdapterStudentContext {
  student_id: string | null;
  grade: string | null;
  subject?: string | null;
  language?: string | null;
  exam_goal?: string | null;
}

/**
 * Fire-and-forget shadow log for one Claude call. Builds the LogPayload,
 * calls recordMolRequest, and SWALLOWS every error path with a console.warn.
 *
 * NEVER throws. Callers must rely on the no-throw guarantee — the cost of
 * an unhandled promise rejection in the request handler is a 500 to a
 * student, which is exactly the harm telemetry is forbidden to cause (P12).
 */
export async function shadowLogClaudeCall(args: {
  traceId: string;
  studentContext: AdapterStudentContext | null;
  caller: string;
  mode: 'soft' | 'strict';
  isGroundingCheck: boolean;
  latencyMs: number;
  claudeResponse: ClaudeResponse;
  /**
   * 2026-09-02 (§5 data-integrity fix): the REAL grounded_ai_traces.id for
   * this call, when the caller has one available. Deliberately a separate
   * field from `traceId` above — `traceId` is MOL's own synthetic
   * mol_request_logs.request_id, generated fresh on every call by
   * shadowLogClaudeCallIfEnabled; it has never referred to
   * grounded_ai_traces.id despite the shared name, which is exactly the
   * confusion this field's distinct name is meant to end. Optional and
   * additive: undefined -> mol_request_logs.trace_id stays NULL, byte-
   * identical to pre-fix behavior. Only pipeline-stream.ts's Foxy call site
   * supplies this today (see its own comment for why pipeline.ts's two call
   * sites do not yet) — the FK join this enables is real but partial.
   */
  groundedTraceId?: string | null;
}): Promise<void> {
  // Risk #4 (architect-flagged): every flag-gated entry emits a single
  // structured log line BEFORE the recordMolRequest call. Lets ops prove
  // row-count parity vs telemetry-attempt count in production logs even
  // if mol_request_logs writes are failing silently.
  try {
    console.log(
      JSON.stringify({
        event: 'mol_telemetry_attempted',
        trace_id: args.traceId,
        caller: args.caller,
        mode: args.mode,
        is_grounding_check: args.isGroundingCheck,
        ok: args.claudeResponse.ok,
        latency_ms: args.latencyMs,
      }),
    );
  } catch {
    // Even the log emit must never throw — JSON.stringify on a circular
    // value would crash; pathological but cheap to defend against.
  }

  // 2026-09-01 (cost-visibility fix): every non-final rung of claude.ts's
  // modelOrder fallback loop gets its OWN mol_request_logs row now, tagged
  // shadow_role='failed_attempt' — regardless of whether the overall call
  // eventually succeeded (ok:true after 1+ retries) or exhausted every rung
  // (ok:false). Before this, a request that failed twice on Anthropic then
  // succeeded on OpenAI produced exactly one row (the OpenAI success); the
  // two failed Anthropic attempts were only a string on that row's
  // failure_chain, with zero cost/count accounting of their own. Every
  // dashboard number computed from this table before this fix is a floor.
  //
  // Runs unconditionally (before the ok:false early-return below), because
  // failed attempts can precede EITHER outcome. shadow_role='failed_attempt'
  // (not 'baseline') keeps these out of mol_shadow_pairs_v1 and any existing
  // AVG(usd_cost)-style query scoped to shadow_role='baseline' — the exact
  // "skew the per-model averages" concern the old code comment here raised,
  // now solved by tagging rather than by omission.
  const failedAttempts = args.claudeResponse.failedAttempts;
  if (Array.isArray(failedAttempts) && failedAttempts.length > 0) {
    try {
      const taskType = mapPipelineToTaskType({
        caller: args.caller,
        mode: args.mode,
        isGroundingCheck: args.isGroundingCheck,
      });
      const surface = mapCallerToSurface(args.caller);
      const zeroTokens = { prompt: 0, completion: 0, cache_read: 0, cache_write: 0 };
      for (const fa of failedAttempts) {
        const payload: LogPayload = {
          request_id: generateRequestId(),
          student_id: args.studentContext?.student_id ?? null,
          task_type: taskType,
          surface,
          provider: fa.provider,
          model: fa.model,
          passes: 1,
          fallback_count: 0,
          // The reason this ONE rung failed — not the whole chain's history,
          // which the eventual baseline/failure row already carries.
          failure_chain: failureLabel(fa.provider, fa.outcome),
          latency_ms: args.latencyMs,
          tokens: zeroTokens,
          // 0 is accurate, not a placeholder — see FailedAttempt's doc
          // comment in claude.ts: every current failure kind returns before
          // a response body is parsed, so there is never real usage to
          // attach. calcCost() would compute 0 from zeroTokens regardless;
          // stated directly here so a future reader doesn't have to trace
          // through calcCost to confirm it.
          usd_cost: 0,
          inr_cost: 0,
          grade: args.studentContext?.grade ?? null,
          language: args.studentContext?.language ?? null,
          exam_goal: args.studentContext?.exam_goal ?? null,
          shadow_role: 'failed_attempt',
          trace_id: args.groundedTraceId,
        };
        recordMolRequest(payload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-telemetry-adapter] failed-attempt logging swallowed: ${msg}`);
    }
  }

  // We only log the FINAL row below for successful (ok:true) calls — these
  // are the rows that represent an answer actually served to the student.
  // A total failure (ok:false, every rung exhausted) is observable via
  // grounded_ai_traces.abstain_reason='upstream_error' and the circuit-
  // breaker telemetry; its individual rung failures are now captured above
  // regardless.
  if (!args.claudeResponse.ok) return;

  try {
    const claude = args.claudeResponse;
    const taskType = mapPipelineToTaskType({
      caller: args.caller,
      mode: args.mode,
      isGroundingCheck: args.isGroundingCheck,
    });
    const surface = mapCallerToSurface(args.caller);

    const fallbackCount = typeof claude.fallback_count === 'number' ? claude.fallback_count : 0;
    const failureChainArr = Array.isArray(claude.failure_chain) ? claude.failure_chain : [];
    // Schema stores failure_chain as TEXT (joined). Empty array → null so the
    // column reads as "no fallback fired" instead of an empty string.
    const failureChain = failureChainArr.length > 0 ? failureChainArr.join('|') : null;

    const tokens = {
      prompt: typeof claude.inputTokens === 'number' ? claude.inputTokens : 0,
      completion: typeof claude.outputTokens === 'number' ? claude.outputTokens : 0,
      // 2026-09-01: the Foxy answer path caches (claude.ts sets cache_control in
      // 12 places), so on a cached turn the bulk of the prompt is reported by
      // Anthropic under these two counters, NOT under input_tokens. Dropping
      // them here is what made a real Foxy turn log 22 prompt tokens and price
      // at $0.004367 when ~11,500 tokens were actually sent. calcCost() bills
      // reads at 0.1x and writes at 1.25x; both are 0 for OpenAI.
      cache_read: typeof claude.cacheReadTokens === 'number' ? claude.cacheReadTokens : 0,
      cache_write: typeof claude.cacheWriteTokens === 'number' ? claude.cacheWriteTokens : 0,
    };
    // Cost is computed at write time via calcCost() / toInr(), using the
    // PRICING table in _shared/mol/telemetry.ts. The PRICING table also
    // does alias-prefix matching for date-pinned model strings (e.g.
    // OpenAI's 'gpt-4o-2024-08-06' → 'gpt-4o' pricing). Unknown models
    // yield 0; that's the same fail-safe as before the PR audit fix —
    // we never want a missing PRICING row to break the request path.
    //
    // PR audit 2026-05-19: this used to hardcode 0/0 with a "cost can be
    // backfilled via SQL" comment. The shadow data revealed that without
    // baseline cost rows the C5 cutover decision is impossible without
    // a SQL backfill step — and 30 days of zero-cost baseline rows make
    // every dashboard look wrong in the meantime. Computing here at
    // write time keeps mol_request_logs immediately useful.
    const provider = claude.provider || 'anthropic';
    const usdCost = calcCost(provider, claude.model, tokens);
    const inrCost = toInr(usdCost);

    const payload: LogPayload = {
      request_id: args.traceId,
      student_id: args.studentContext?.student_id ?? null,
      task_type: taskType,
      surface,
      provider: provider,
      // C3 always reports the model that actually answered. C4/C5 will
      // start splitting this between attempted and answered models.
      model: claude.model,
      // passes=1 in C3 because we are NOT running the MOL router's 2-pass
      // pipeline yet — grounded-answer makes exactly one primary call per
      // log row (grounding-check is its own log row with passes=1 too).
      passes: 1,
      fallback_count: fallbackCount,
      failure_chain: failureChain,
      latency_ms: args.latencyMs,
      tokens,
      usd_cost: usdCost,
      inr_cost: inrCost,
      grade: args.studentContext?.grade ?? null,
      language: args.studentContext?.language ?? null,
      exam_goal: args.studentContext?.exam_goal ?? null,
      // ── C4.2b-i baseline tagging fix (2026-05-19) ──
      // Every row this adapter writes is, by definition, a BASELINE row:
      // the C3 telemetry adapter only fires for the user-facing Claude
      // call that served the student. Tagging shadow_role='baseline' here
      // makes mol_shadow_pairs_v1 return non-empty rows once C4.2a's
      // shadow rows start landing (the view's JOIN is
      //    baseline.shadow_role = 'baseline' AND shadow.shadow_role = 'shadow').
      // Before this fix, baseline rows wrote shadow_role=NULL and the
      // view's INNER JOIN excluded every pair — silent zero-row defect
      // architects flagged on PR #856.
      //
      // Two-flag interaction (recap, from the C4.2b-i task spec):
      //   * ff_grounded_answer_mol_telemetry_v1 ON, shadow OFF
      //     → baseline rows tagged 'baseline', no shadow rows
      //     → view returns 0 rows (correct: no pairs to show)
      //   * both telemetry + shadow flags ON
      //     → baseline rows tagged 'baseline', shadow rows tagged 'shadow'
      //     → view returns one row per pair (correct, what we want)
      //   * only shadow flag ON
      //     → shadow helper fires but adapter writes nothing (its own
      //       feature-flag check short-circuited at the call site)
      //     → view returns 0 rows (correct: no baseline anchor exists)
      shadow_role: 'baseline',
      // 2026-09-02 (§5 data-integrity fix): the real grounded_ai_traces.id,
      // when the caller supplied one. Same convention as shadow_of_request_id
      // above: pass the value through as-is (undefined stays undefined) and
      // let recordMolRequest's `p.trace_id ?? null` coalesce at insert time.
      // Coalescing here too would be redundant AND changes this payload's
      // own shape (undefined -> null) ahead of that insert-time step, which
      // is what stamps_shadow_role's LogPayload-contract test pins against.
      // See groundedTraceId's doc comment above for scope.
      trace_id: args.groundedTraceId,
    };

    // recordMolRequest is itself a fire-and-forget (returns void), but it
    // accesses the supabase client lazily — that lookup CAN throw on a
    // misconfigured worker. The outer try/catch covers that.
    recordMolRequest(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mol-telemetry-adapter] sync error swallowed: ${msg}`);
  }
}

/**
 * Convenience wrapper that pipeline.ts / pipeline-stream.ts / grounding-check.ts
 * call at every Claude invocation site. Generates a fresh UUID for the MOL
 * request_id (decoupled from grounded_ai_traces.id which is server-assigned
 * later in the pipeline), checks the feature flag, and fires the shadow log
 * fire-and-forget if the flag is ON.
 *
 * Why a thin wrapper instead of calling shadowLogClaudeCall directly:
 *   - Centralizes the feature-flag check so we cannot accidentally ship a
 *     site that ignores the kill switch.
 *   - Centralizes request_id generation in one place. See generateRequestId()
 *     below for the design invariant: request_id stays MOL-internal and
 *     synthetic; cross-service correlation to grounded_ai_traces is added
 *     via a separate trace_id column in C4.
 *   - Keeps the caller's diff minimal — one function call vs five lines of
 *     boilerplate per site.
 *
 * NEVER awaits and NEVER throws. The floating promise is caught with a
 * .catch attached so a stalled feature-flag fetch cannot become an
 * unhandled rejection.
 */
export function shadowLogClaudeCallIfEnabled(args: {
  studentId: string | null;
  grade: string | null;
  subject?: string | null;
  caller: string;
  mode: 'soft' | 'strict';
  isGroundingCheck: boolean;
  latencyMs: number;
  claudeResponse: ClaudeResponse;
  /** See shadowLogClaudeCall's doc comment on the same field. */
  groundedTraceId?: string | null;
}): void {
  // The flag check itself is async (a fetch + Array.find against the
  // in-process 5-minute cache). To guarantee zero impact on request
  // latency we never await it from the request handler — the entire
  // gated-shadow-log chain runs as a detached promise with its own
  // .catch attached.
  //
  // Steady-state cost: the cache-hit path is sub-millisecond (a single
  // Array.find call). Cold-cache cost is one HTTP GET to Supabase REST;
  // worst case ~100-200ms but it amortizes over hundreds of calls.
  void (async () => {
    try {
      const enabled = await isFlagEnabled(C3_TELEMETRY_FLAG, {
        student_id: args.studentId ?? undefined,
      });
      if (!enabled) return;

      const traceId = generateRequestId();
      await shadowLogClaudeCall({
        traceId,
        studentContext:
          args.studentId !== null || args.grade !== null
            ? {
                student_id: args.studentId,
                grade: args.grade,
                subject: args.subject ?? null,
                language: null,
                exam_goal: null,
              }
            : null,
        caller: args.caller,
        mode: args.mode,
        isGroundingCheck: args.isGroundingCheck,
        latencyMs: args.latencyMs,
        claudeResponse: args.claudeResponse,
        groundedTraceId: args.groundedTraceId,
      });
    } catch (err) {
      // Defensive: shadowLogClaudeCall already swallows; this catches the
      // isFlagEnabled fetch path which has its own try/catch but we still
      // want belt-and-braces.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-telemetry-adapter] gated wrapper error swallowed: ${msg}`);
    }
  })().catch((err) => {
    // void IIFE rejection — should be unreachable because the inner
    // try/catch covers everything, but defended for completeness.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mol-telemetry-adapter] floating-promise rejection: ${msg}`);
  });
}

/**
 * Generates a fresh UUID for mol_request_logs.request_id on every call.
 *
 * DESIGN INVARIANT (do not change): request_id is intentionally synthetic and MOL-internal.
 * It is the JOIN key for baseline-Anthropic ↔ shadow-OpenAI row pairs that C4 will write
 * (baseline.request_id = shadow.shadow_of_request_id). Swapping to grounded_ai_traces.id
 * reuse would break that JOIN because the router needs the SAME request_id for both legs of
 * a single MOL call — which trace_id cannot provide (a grounded-answer trace can spawn
 * multiple MOL calls: primary + grounding-check).
 *
 * Cross-service correlation (mol_request_logs ↔ grounded_ai_traces) is solved separately
 * by adding a `trace_id text` column to mol_request_logs in C4, populated from the
 * grounded-answer pipeline AFTER finalizeGrounded returns the trace_id.
 */
function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (vitest under
  // older Node). Not cryptographically strong; only used in tests.
  return `mol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Type re-export for callers that want a single import surface. Adapter
 * users should import LogPayload from here (not from _shared/mol/telemetry)
 * so we keep grounded-answer's MOL touchpoint to exactly one file.
 */
export type { LogPayload, TaskType, StudentContext };
