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

import { recordMolRequest, type LogPayload } from '../_shared/mol/telemetry.ts';
import type { TaskType, StudentContext } from '../_shared/mol/types.ts';
import { isFlagEnabled } from '../_shared/mol/feature-flag.ts';
import type { ClaudeResponse } from './claude.ts';

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
 * - 'concept-engine' → null     (internal indexing; no student-facing surface)
 * - 'diagnostic'     → null     (internal health probes; no student surface)
 * - anything else    → null     (defensive — future callers must register here)
 *
 * No 'ocr' mapping in C3 — OCR runs through `scan-ocr`, not grounded-answer.
 * It's kept in the type for forward compatibility.
 */
export function mapCallerToSurface(caller: string): 'foxy' | 'quiz' | 'solver' | 'ocr' | null {
  switch (caller) {
    case 'foxy':
      return 'foxy';
    case 'quiz-generator':
      return 'quiz';
    case 'ncert-solver':
      return 'solver';
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
 * - caller='diagnostic' or unknown → 'explanation' (broad fallback)
 *
 * Note on the mode parameter: today we don't split soft/strict in the task
 * type. We pass `mode` through so C4 can decide to split if dashboards need
 * it (e.g. 'doubt_solving' vs 'doubt_solving_strict'); for C3 it's ignored.
 */
export function mapPipelineToTaskType(args: {
  caller: string;
  mode: 'soft' | 'strict';
  isGroundingCheck: boolean;
}): TaskType {
  if (args.isGroundingCheck) return 'grounding_check';
  switch (args.caller) {
    case 'foxy':
      return 'doubt_solving';
    case 'ncert-solver':
      return 'step_by_step';
    case 'quiz-generator':
      return 'quiz_generation';
    case 'concept-engine':
      return 'concept_explanation';
    case 'diagnostic':
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

  // We only log successful (ok:true) calls — these are the rows MOL cares
  // about for cost/latency dashboards. Failed calls (timeout/auth/etc) are
  // observable via grounded_ai_traces.abstain_reason='upstream_error' and
  // the circuit-breaker telemetry; logging them into mol_request_logs as
  // zero-token/zero-cost rows would skew the per-model averages.
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

    const payload: LogPayload = {
      request_id: args.traceId,
      student_id: args.studentContext?.student_id ?? null,
      task_type: taskType,
      surface,
      provider: PROVIDER_LITERAL,
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
      tokens: {
        prompt: typeof claude.inputTokens === 'number' ? claude.inputTokens : 0,
        completion: typeof claude.outputTokens === 'number' ? claude.outputTokens : 0,
      },
      // Cost lives in the MOL telemetry helper — recordMolRequest only
      // writes what LogPayload carries. C3 leaves cost computation to the
      // pricing table in _shared/mol/telemetry.ts via calcCost() if a
      // future call site wants to populate it. For shadow logs we ship
      // 0 here; cost can be backfilled via SQL from prompt_tokens +
      // completion_tokens + model_pricing seed.
      usd_cost: 0,
      inr_cost: 0,
      grade: args.studentContext?.grade ?? null,
      language: args.studentContext?.language ?? null,
      exam_goal: args.studentContext?.exam_goal ?? null,
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
 *   - Centralizes the request_id generation so future C4 work has a single
 *     place to swap UUID-per-call for trace_id reuse.
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

/** Fresh per-call request_id. crypto.randomUUID is available in Deno. */
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
