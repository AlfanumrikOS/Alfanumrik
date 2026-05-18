// supabase/functions/grounded-answer/mol-shadow.ts
//
// C4 wire-up (2026-05-19): fire-and-forget OpenAI shadow caller.
//
// Background:
//   C3 shipped telemetry-only shadow LOGGING via mol-telemetry-adapter.ts — it
//   writes a row into mol_request_logs every time grounded-answer makes a
//   Claude call, but does NOT actually fire a second model. C4.1 added this
//   helper as dormant infrastructure; C4.2a wires it into pipeline.ts and
//   pipeline-stream.ts so every grounded-answer LLM invocation gets a parallel
//   OpenAI shadow call. The shadow's response is discarded (Anthropic still
//   serves the student); the row in mol_request_logs is kept for an offline
//   grader (C4.2b) to compare quality.
//
// Status of THIS file (C4.2a):
//   * The helper is EXPORTED and WIRED into pipeline.ts + pipeline-stream.ts.
//   * Default-OFF feature flag means no production behavior change ships
//     until ops promotes the flag via super-admin UI (C4.2b).
//
// Architecture (locked, C4 architect review):
//   - In-process fire-and-forget. The caller wraps `shadowFireOpenAI` in
//     `void Promise.allSettled([...])` so the shadow can NEVER block the
//     user-facing baseline path. The convenience wrapper
//     `fireShadowAndForget()` codifies that pattern.
//   - Independent timeout (10s) + AbortController, completely separate from
//     the baseline Claude call's lifecycle.
//   - Swallows EVERY error path with console.warn — must never throw, must
//     never reject. The cost of an unhandled rejection in the request handler
//     is a 500 to a student (P12 violation).
//
// Feature-flag gating:
//   Flag name:  ff_grounded_answer_mol_shadow_v1
//   Stored in:  feature_flags.metadata jsonb
//   Envelope shape:
//     {
//       "enabled":     boolean,         // master kill bit; default false
//       "kill_switch": boolean,         // ops short-circuit; default false
//       "task_types":  string[],        // allow-list of TaskType literals
//       "rollout_pct": number (0-100)   // bucket sample
//     }
//   When `enabled !== true` OR `kill_switch === true` OR task_type is not in
//   `task_types` OR the sample bucket misses, the helper short-circuits with
//   ZERO side effects (no generateResponse call, no recordMolRequest call,
//   no logs except a JSON.stringify breadcrumb).
//
// Sample bucketing:
//   hash(request_id + ':' + task_type) % 100 < rollout_pct
//   The hash includes task_type so the same request_id can shadow on one
//   task and skip on another — useful when only `doubt_solving` is in the
//   allow-list and the rest of grounded-answer is unaffected.
//
// Telemetry-row design (C4.2a single-row model):
//   On a sample HIT, this helper builds a GenerateRequest whose
//   `config.system_prompt_override` carries the baseline's EXACT system
//   prompt (prompt-parity fix from C4.1 review), and whose
//   `config.shadow_role='shadow'` + `config.shadow_of_request_id` tell the
//   orchestrator to TAG its own auto-logged telemetry row.
//
//   The orchestrator (generateResponse → recordMolRequest) writes exactly
//   ONE row per shadow call. The helper writes NO additional rows on the
//   success path — the double-row bug from C4.1 is fixed.
//
//   FAILURE PATHS still write a defensive row via writeFailureRow():
//   when generateResponse throws or rejects (provider chain exhausted,
//   timeout race won by the helper, etc), the orchestrator's
//   recordMolRequest is never reached, so without writeFailureRow the
//   shadow failure would be invisible. We tag that defensive row
//   `shadow_role='shadow'` so cost/quality dashboards can filter on it
//   identically to a happy-path shadow row.
//
//   Net per-call rows:
//     - success                           → 1 (orchestrator auto-log, tagged)
//     - generateResponse throws/rejects   → 1 (writeFailureRow, tagged)
//     - flag off / kill / sample miss     → 0 (short-circuit, breadcrumb only)

import {
  generateResponse,
  type GenerateRequest,
  type TaskType,
  type Language,
  type ExamGoal,
  type StudentContext,
} from '../_shared/mol/index.ts';
import { recordMolRequest, type LogPayload } from '../_shared/mol/telemetry.ts';
import { getFlagEnvelope } from '../_shared/mol/feature-flag.ts';

/** Feature-flag name. Default OFF in feature_flags table — owner: ops. */
export const C4_SHADOW_FLAG = 'ff_grounded_answer_mol_shadow_v1';

/** Per-call shadow timeout. Independent from baseline; never blocks user. */
const SHADOW_TIMEOUT_MS = 10_000;

/** Default rollout when the envelope omits rollout_pct. Conservative. */
const DEFAULT_ROLLOUT_PCT = 0;

/**
 * What the shadow helper needs from the caller. Decoupled from the C3
 * mol-telemetry-adapter shape because shadow routing has different
 * concerns: we need the EXACT prompt + tokens that the baseline used so
 * the offline grader can compare apples to apples.
 */
export interface ShadowFireArgs {
  /** Baseline's request_id (the one stamped on the baseline's mol_request_logs row). */
  request_id: string;

  /** Full system prompt as sent to Claude — must match the baseline. */
  systemPrompt: string;

  /** User-facing question/message as sent to Claude. */
  userMessage: string;

  /** Token budget on the OpenAI side. Caller normally mirrors baseline's maxTokens. */
  maxTokens: number;

  /** Temperature mirror. Grader needs same sampling regime to be fair. */
  temperature: number;

  /** Classified task type (drives allow-list gate + MOL router behavior). */
  task_type: TaskType;

  /** MOL surface tag. Mirrors the baseline call's surface. */
  surface: 'foxy' | 'quiz' | 'solver' | 'ocr' | null;

  /** What model the baseline actually used. Recorded on the shadow row for analyst convenience. */
  baseline_provider: 'openai' | 'anthropic';

  /** Exact baseline model id. Same purpose as baseline_provider. */
  baseline_model: string;

  /** grounded_ai_traces.id for cross-service correlation. May be null for non-grounded callers. */
  trace_id: string | null;

  /** Anonymized student context. student_id may be null for diagnostic flows. */
  student_context: {
    student_id: string | null;
    grade: string | null;
    language?: Language | null;
    exam_goal?: ExamGoal | null;
    subject?: string | null;
  };
}

/**
 * Envelope shape stored in feature_flags.metadata for the shadow flag. All
 * fields optional at the type level so a partial/legacy row degrades to
 * "disabled" safely.
 */
interface ShadowEnvelope {
  enabled?: boolean;
  kill_switch?: boolean;
  task_types?: string[];
  rollout_pct?: number;
}

/**
 * Read + normalize the shadow envelope from feature_flags.metadata. Never
 * throws — on any error (flag missing, malformed JSON, network), returns
 * a fully-disabled envelope so the helper short-circuits.
 */
async function readShadowEnvelope(): Promise<Required<ShadowEnvelope>> {
  try {
    const { is_enabled, metadata } = await getFlagEnvelope(C4_SHADOW_FLAG);
    // The envelope's `enabled` flag wins over feature_flags.is_enabled IF
    // explicitly set; otherwise we treat the row's is_enabled column as the
    // master switch. This lets ops disable via the column without rewriting
    // the metadata payload.
    const envelope = metadata as ShadowEnvelope;
    const enabled = typeof envelope.enabled === 'boolean'
      ? envelope.enabled
      : is_enabled;
    const kill_switch = envelope.kill_switch === true;
    const task_types = Array.isArray(envelope.task_types)
      ? envelope.task_types.filter((t): t is string => typeof t === 'string')
      : [];
    const rollout_pct = typeof envelope.rollout_pct === 'number'
      && Number.isFinite(envelope.rollout_pct)
      ? Math.max(0, Math.min(100, envelope.rollout_pct))
      : DEFAULT_ROLLOUT_PCT;
    return { enabled, kill_switch, task_types, rollout_pct };
  } catch {
    return { enabled: false, kill_switch: false, task_types: [], rollout_pct: 0 };
  }
}

/**
 * Deterministic 0-99 bucket from `hash(request_id + ':' + task_type)`.
 * Matches the same xor-shift hash style as feature-flag.ts:inRolloutBucket
 * for consistency. Stable across worker boots so the same baseline always
 * shadows the same way (key for repeatable offline analysis).
 */
function shadowBucket(request_id: string, task_type: string): number {
  const key = `${request_id}:${task_type}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/**
 * The fire-and-forget OpenAI shadow caller. Always returns void; NEVER
 * throws; NEVER rejects with an unhandled error.
 *
 * Short-circuits (returns immediately, zero side effects) when:
 *   1. `enabled !== true` in the envelope
 *   2. `kill_switch === true`
 *   3. `args.task_type` is not in the envelope's `task_types` allow-list
 *   4. The sample bucket misses (rollout_pct gate)
 *   5. The flag-read itself fails (defensive — treat as disabled)
 *
 * On a sample HIT:
 *   - Builds a GenerateRequest pinned to provider='openai' and
 *     request_id=args.request_id (so the orchestrator's auto-log row carries
 *     the baseline's request_id for traceability).
 *   - Passes `system_prompt_override = args.systemPrompt` through config so
 *     MOL skips its own prompt-builder and uses the baseline's exact
 *     composed prompt — prompt-parity fix from C4.1 review.
 *   - Passes `shadow_role='shadow'` + `shadow_of_request_id` + `trace_id`
 *     through config so the orchestrator's auto-logged
 *     `recordMolRequest` row is the SINGLE correctly-tagged row per call
 *     — de-dup fix from C4.1 review.
 *   - Calls generateResponse with an independent 10s timeout enforced via
 *     Promise.race (defense in depth; MOL's own per-provider timeout is 20s).
 *
 * Failure rows are still written by writeFailureRow() below — generateResponse
 * throwing/rejecting bypasses the orchestrator's recordMolRequest call, so
 * without this defensive row a shadow-side failure would be invisible to
 * dashboards.
 */
export async function shadowFireOpenAI(args: ShadowFireArgs): Promise<void> {
  // Single structured breadcrumb per invocation. Survives even if the
  // flag-read or downstream call fails silently. Useful for ops to prove
  // call-attempt counts match logged rows.
  try {
    console.log(
      JSON.stringify({
        event: 'mol_shadow_attempted',
        request_id: args.request_id,
        task_type: args.task_type,
        surface: args.surface,
        trace_id: args.trace_id,
      }),
    );
  } catch {
    // JSON.stringify shouldn't fail on this shape, but be safe.
  }

  const envelope = await readShadowEnvelope();
  if (envelope.enabled !== true) return;
  if (envelope.kill_switch === true) return;
  if (!envelope.task_types.includes(args.task_type)) return;
  if (shadowBucket(args.request_id, args.task_type) >= envelope.rollout_pct) return;

  // From here on: every code path MUST end in either the orchestrator's
  // auto-log (success path), a writeFailureRow call (error path), or a
  // swallowed error log. NEVER throw upward.
  const startedAt = Date.now();
  let aborted = false;
  const abortTimer = setTimeout(() => {
    aborted = true;
  }, SHADOW_TIMEOUT_MS);

  try {
    const request: GenerateRequest = {
      task_type: args.task_type,
      input: {
        question: args.userMessage,
      },
      student_context: buildStudentContext(args),
      // RAG context already lives inside systemPrompt (the baseline composed
      // it). MOL's prompt-builder ignores rag_context when input.question is
      // present anyway — we keep it null to be explicit. With
      // system_prompt_override set below, MOL skips the prompt-builder
      // entirely so rag_context here is irrelevant either way.
      rag_context: null,
      config: {
        preferred_provider: 'openai',
        request_id: args.request_id,
        surface: args.surface ?? undefined,
        max_tokens_override: args.maxTokens,
        // ── C4.2a fixes ──
        // Prompt-parity (HIGH severity in C4.1 review): hand MOL the
        // baseline's EXACT composed prompt so the orchestrator skips its
        // own prompt-builder. The shadow leg must answer the SAME question
        // as baseline or the offline grader is comparing apples to oranges.
        system_prompt_override: args.systemPrompt,
        // De-dup (HIGH severity in C4.1 review): tell the orchestrator to
        // stamp shadow_role='shadow' and shadow_of_request_id onto its own
        // auto-logged recordMolRequest row. The helper no longer writes a
        // SECOND row on the success path — exactly one tagged row per call.
        shadow_role: 'shadow',
        shadow_of_request_id: args.request_id,
        // Cross-service correlation so the auto-logged row joins to the
        // baseline's grounded_ai_traces row.
        trace_id: args.trace_id,
      },
    };

    // Race generateResponse against our local timeout. MOL's per-provider
    // timeout is 20s by default — for shadow we cap at 10s so a stalled
    // shadow can never linger longer than the baseline path.
    //
    // If our timeout wins the race, the rejected promise propagates into
    // the catch below → writeFailureRow stamps a defensive shadow row.
    // generateResponse might still be running on the event loop after that;
    // if it eventually succeeds, the orchestrator will auto-log a second
    // row. That row IS shadow-tagged (we passed shadow_role through config)
    // so dashboards still attribute it correctly. Belt-and-braces noise of
    // at-most-one extra row per timed-out shadow; intentional trade-off.
    await Promise.race([
      generateResponse(request),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('shadow_timeout_10s')),
          SHADOW_TIMEOUT_MS,
        );
      }),
    ]);

    if (aborted) {
      // Race lost to the abort timer (defensive — Promise.race resolves
      // with the first settled, so this branch is mostly belt-and-braces).
      writeFailureRow(args, startedAt, ['openai:shadow_aborted']);
      return;
    }

    // Success path is intentionally EMPTY here. The orchestrator's
    // recordMolRequest call (inside generateResponse) wrote the single
    // tagged shadow row — see C4.2a de-dup fix above.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeFailureRow(args, startedAt, [`openai:${classifyShadowError(msg)}`]);
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Convenience wrapper that pipeline.ts / pipeline-stream.ts call after
 * the baseline Claude call succeeds. Wraps shadowFireOpenAI in
 * `void Promise.allSettled([...])` so the caller never has to remember the
 * fire-and-forget idiom. Returns void synchronously — the shadow runs on
 * the event loop alongside (not after) the user-facing path.
 */
export function fireShadowAndForget(args: ShadowFireArgs): void {
  void Promise.allSettled([shadowFireOpenAI(args)]).then(
    () => {},
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-shadow] floating-promise rejection swallowed: ${msg}`);
    },
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build the MOL StudentContext from the adapter-style args. Coerces null
 * student_id to a synthetic per-request literal so generateResponse's input
 * validation (which requires student_id) does not throw and abort the shadow
 * before it starts. The synthetic id is NEVER persisted; only the original
 * null student_id is written into the shadow log row.
 */
function buildStudentContext(args: ShadowFireArgs): StudentContext {
  return {
    student_id: args.student_context.student_id ?? `anon-shadow-${args.request_id}`,
    grade: args.student_context.grade ?? '',
    language: (args.student_context.language ?? 'en') as Language,
    exam_goal: args.student_context.exam_goal ?? undefined,
    subject: args.student_context.subject ?? undefined,
  };
}

/**
 * Coarse error classifier for failure_chain. The shadow side never throws
 * MolError directly out of generateResponse — every provider error becomes
 * an Error with a status-formatted message. We surface a small enum so
 * dashboards can spot timeouts vs auth vs 5xx without keyword-matching
 * arbitrary strings.
 */
function classifyShadowError(msg: string): string {
  if (msg.includes('shadow_timeout_10s')) return 'timeout';
  if (/40[13]/.test(msg)) return 'auth';
  if (/5\d\d/.test(msg)) return '5xx';
  if (msg.includes('NO_PROVIDER_AVAILABLE')) return 'no_provider';
  if (msg.includes('INVALID_INPUT')) return 'invalid_input';
  return 'unknown';
}

/**
 * Write a shadow-tagged failure row. The shadow had a chance to fire but
 * failed (timeout, provider 5xx, etc). Logging the row makes the failure
 * visible without skewing baseline metrics (failure_chain is the
 * discriminator dashboards filter on).
 */
function writeFailureRow(
  args: ShadowFireArgs,
  startedAt: number,
  failure_chain: string[],
): void {
  const payload: LogPayload = {
    request_id: args.request_id,
    student_id: args.student_context.student_id,
    task_type: args.task_type,
    surface: args.surface,
    provider: 'openai',
    // We don't know which model the chain attempted before failing; record
    // the baseline's MOL plan-table default for the task. For
    // dashboard parity an empty string would be fine too, but we leave a
    // sentinel string so the row is identifiable.
    model: 'openai:shadow_failed',
    passes: 0,
    fallback_count: 0,
    failure_chain: failure_chain.join('|'),
    latency_ms: Date.now() - startedAt,
    tokens: { prompt: 0, completion: 0 },
    usd_cost: 0,
    inr_cost: 0,
    grade: args.student_context.grade,
    language: args.student_context.language ?? null,
    exam_goal: args.student_context.exam_goal ?? null,
    shadow_of_request_id: args.request_id,
    shadow_role: 'shadow',
    trace_id: args.trace_id,
  };
  safeRecord(payload);
}

/**
 * Wrap recordMolRequest so a synchronous throw from the supabase client
 * lookup is also caught — recordMolRequest itself attaches a .then handler
 * to its async insert, but the client() lazy-init can throw.
 */
function safeRecord(payload: LogPayload): void {
  try {
    recordMolRequest(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mol-shadow] recordMolRequest threw synchronously: ${msg}`);
  }
}
