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
  type MolResult,
  type TaskType,
  type Language,
  type ExamGoal,
  type StudentContext,
} from '../_shared/mol/index.ts';
import {
  recordMolRequest,
  recordShadowText,
  type LogPayload,
} from '../_shared/mol/telemetry.ts';
import { getFlagEnvelope } from '../_shared/mol/feature-flag.ts';

/** Feature-flag name. Default OFF in feature_flags table — owner: ops. */
export const C4_SHADOW_FLAG = 'ff_grounded_answer_mol_shadow_v1';

/**
 * Feature-flag name for the C4.2b-ii text-capture path. Default OFF.
 * INDEPENDENT of C4_SHADOW_FLAG. Text capture writes to
 * mol_shadow_text_buffer only when BOTH this flag AND C4_SHADOW_FLAG are
 * enabled (since capture happens inside this helper, which itself is gated
 * by C4_SHADOW_FLAG).
 */
export const C4_TEXT_CAPTURE_FLAG = 'ff_mol_shadow_text_capture_v1';

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

  // ── C4.2b-ii text-capture (2026-05-20) ─────────────────────────────────
  // The two fields below feed the Sonnet grader's offline comparison.
  // Default-OFF feature flag (ff_mol_shadow_text_capture_v1) means these
  // are written to the buffer table ONLY when ops explicitly enables text
  // capture. Both fields are optional at the type level so existing
  // call sites (which don't yet supply them) keep compiling.

  /**
   * The baseline (Anthropic) response text the user was served. Drives
   * three text-capture behaviors:
   *
   *   * non-empty string → INLINE write. Non-streaming caller (pipeline.ts)
   *     has baseline text ready at shadow-fire time; helper redacts +
   *     writes mol_shadow_text_buffer inline.
   *   * undefined → STASH. Streaming caller (pipeline-stream.ts) doesn't
   *     have baseline text yet; helper stashes the shadow's text keyed
   *     by request_id; caller drains via `recordShadowTextFromStash` after
   *     stream completes.
   *   * empty string ('') → SKIP. Callers (e.g. the grounding-check
   *     shadow leg) that want the shadow row in mol_request_logs but NOT
   *     a buffer row. No inline write, no stash entry.
   *
   * All three paths are gated by the ff_mol_shadow_text_capture_v1
   * feature flag. When the flag is off, every path is a no-op.
   */
  baseline_response_text?: string;

  /**
   * The system prompt the shadow used, when it diverges from the baseline.
   * NULL (the default) means prompt-parity (C4.2a fix) — the shadow reused
   * the baseline's exact prompt verbatim. Non-null only when a future C5
   * change adopts a divergent shadow prompt (e.g. for OpenAI-specific
   * formatting tweaks); persisted on the buffer row so the grader can see
   * what each leg actually saw.
   */
  shadow_system_prompt_override?: string | null;
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
 * C4.2b-ii: read the text-capture feature flag. Cheaper than readShadowEnvelope
 * because the text-capture flag only has the is_enabled column wired today —
 * no rollout/allow-list envelope. Returns true iff is_enabled=true on the row.
 *
 * Cached for 5 minutes inside getFlagEnvelope so the call cost amortizes
 * across requests in a single Edge worker.
 *
 * Never throws — on any error (flag missing, network), returns false so
 * the text capture path stays dormant.
 */
async function isTextCaptureEnabled(): Promise<boolean> {
  try {
    const { is_enabled, metadata } = await getFlagEnvelope(C4_TEXT_CAPTURE_FLAG);
    // Same pattern as readShadowEnvelope: an explicit metadata.enabled wins
    // when set, otherwise the row's is_enabled column wins.
    const md = (metadata ?? {}) as { enabled?: boolean };
    if (typeof md.enabled === 'boolean') return md.enabled;
    return is_enabled === true;
  } catch {
    return false;
  }
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

// ─── In-process stash for streaming text-capture (C4.2b-ii) ────────────────
//
// pipeline-stream.ts cannot supply baseline_response_text at shadow fire
// time (the stream hasn't started yet). The fix: stash the shadow's
// resolved text inside this module keyed by the SHADOW's request_id, then
// pipeline-stream.ts calls `recordShadowTextFromStash` AFTER the stream
// completes (when accumulated baseline text is known).
//
// Lifecycle:
//   * Entries added inside shadowFireOpenAI ONLY when both feature flags
//     are on AND baseline_response_text is absent (streaming caller).
//   * Entries removed when recordShadowTextFromStash drains them.
//   * Entries auto-expire after STASH_TTL_MS so an orphaned shadow (caller
//     never called recordShadowTextFromStash, e.g. stream errored before
//     it could) does not leak memory across requests.
//
// Edge worker scope: the Map lives per worker. Supabase recycles workers
// frequently; an entry that outlives its worker just gets garbage-collected
// alongside the worker process. Worst case: one row never makes it into
// mol_shadow_text_buffer. Acceptable — the grader treats missing rows as
// `skipped_no_text` which is already a first-class outcome.

interface StashedShadow {
  shadow_request_id: string;
  baseline_request_id: string;
  baseline_system_prompt: string;
  shadow_system_prompt: string | null;
  shadow_response_text: string;
  question_text: string;
  expiresAt: number;
}

/** TTL for stashed shadow entries. 60s covers the slowest streaming case. */
const STASH_TTL_MS = 60_000;

const __shadowTextStash = new Map<string, StashedShadow>();

/** Drop expired entries. Cheap O(N) sweep; N is bounded by per-worker QPS. */
function sweepStash(now: number): void {
  for (const [k, v] of __shadowTextStash.entries()) {
    if (v.expiresAt <= now) __shadowTextStash.delete(k);
  }
}

/**
 * Test-only seam: reset the stash so unit tests don't share state.
 * Not part of the public contract.
 */
export function __resetShadowTextStashForTests(): void {
  __shadowTextStash.clear();
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
  // If baseline is already openai, shadowing with openai is redundant and wasteful.
  if (args.baseline_provider === 'openai') {
    return;
  }

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
    //
    // C4.2b-ii: capture the MolResult so we can write text capture (the
    // shadow_response_text comes from molResult.text). For non-streaming
    // callers (baseline_response_text present in args), we write the buffer
    // row INLINE. For streaming callers (baseline_response_text absent),
    // we stash the shadow text for `recordShadowTextFromStash` to pick up
    // after the stream completes.
    const molResult = (await Promise.race([
      generateResponse(request),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('shadow_timeout_10s')),
          SHADOW_TIMEOUT_MS,
        );
      }),
    ])) as MolResult;

    if (aborted) {
      // Race lost to the abort timer (defensive — Promise.race resolves
      // with the first settled, so this branch is mostly belt-and-braces).
      writeFailureRow(args, startedAt, ['openai:shadow_aborted']);
      return;
    }

    // ── C4.2b-ii: text capture branch ──
    // Gated by ff_mol_shadow_text_capture_v1 (default OFF). When OFF we
    // skip the flag read AND the write entirely so the steady-state cost
    // is zero for the (default) shadow-only configuration.
    //
    // Two paths, distinguished by args.baseline_response_text:
    //   * INLINE path: baseline_response_text is a non-empty string. The
    //     non-streaming caller (pipeline.ts) has baseline text ready at
    //     shadow-fire time. Redact + write to mol_shadow_text_buffer now.
    //   * STASH path: baseline_response_text is undefined. The streaming
    //     caller (pipeline-stream.ts) doesn't have baseline text yet;
    //     stash shadow text keyed by request_id; the caller drains via
    //     recordShadowTextFromStash after the stream completes.
    //   * SKIP path: baseline_response_text is an empty string. The
    //     caller (e.g. grounding-check shadow) wants the shadow row but
    //     NOT the text capture. No inline write, no stash entry.
    //
    // Sentinel semantics:
    //   undefined → stash (streaming)
    //   ''        → skip (text-capture-not-wanted-for-this-leg)
    //   non-empty → inline (non-streaming with baseline text)
    try {
      if (
        args.baseline_response_text !== ''
        && (await isTextCaptureEnabled())
      ) {
        // The shadow's request_id is what the orchestrator stamped on the
        // recordMolRequest row (and what generateResponse returns as
        // request_id). We pass args.request_id (the baseline's id) as the
        // MOL config.request_id, so molResult.request_id === args.request_id.
        // The buffer's shadow_request_id therefore equals args.request_id
        // — matches the grader cron's SELECT shape (look up by
        // mol_request_logs.request_id, which is the SAME UUID).
        const shadow_request_id = molResult.request_id ?? args.request_id;
        const shadow_response_text = molResult.text ?? '';

        if (typeof args.baseline_response_text === 'string') {
          // Inline path: pipeline.ts has baseline text ready right now.
          recordShadowText({
            baseline_request_id: args.request_id,
            shadow_request_id,
            question_text: args.userMessage,
            baseline_system_prompt: args.systemPrompt,
            shadow_system_prompt: args.shadow_system_prompt_override ?? null,
            baseline_response_text: args.baseline_response_text,
            shadow_response_text,
          });
        } else {
          // Stash path: pipeline-stream.ts will call recordShadowTextFromStash
          // after the stream completes. Sweep first so we don't carry stale
          // entries from previous requests on this worker.
          const now = Date.now();
          sweepStash(now);
          __shadowTextStash.set(args.request_id, {
            shadow_request_id,
            baseline_request_id: args.request_id,
            baseline_system_prompt: args.systemPrompt,
            shadow_system_prompt: args.shadow_system_prompt_override ?? null,
            shadow_response_text,
            question_text: args.userMessage,
            expiresAt: now + STASH_TTL_MS,
          });
        }
      }
    } catch (textErr) {
      // Text-capture failure MUST NOT propagate. The orchestrator's
      // single-row auto-log (mol_request_logs) is independent and has
      // already been written.
      const msg = textErr instanceof Error ? textErr.message : String(textErr);
      console.warn(`[mol-shadow] text capture inline/stash threw: ${msg}`);
    }

    // Success path is intentionally EMPTY here for the mol_request_logs
    // row. The orchestrator's recordMolRequest call (inside generateResponse)
    // wrote the single tagged shadow row — see C4.2a de-dup fix above.
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
 *
 * C4.2b-i (2026-05-19): when Supabase Edge's `EdgeRuntime.waitUntil` is
 * available, register the floating promise with it. Without this hook the
 * runtime can recycle the worker as soon as the user-facing response is
 * flushed — which would tear down a still-running shadow call mid-flight
 * (the OpenAI request might take 5-10s while the baseline Claude response
 * returns in 1-2s for cache-hit prompts). `waitUntil` extends the worker's
 * lifetime until the registered promise settles, preserving the shadow
 * row write. Falls back gracefully in environments without EdgeRuntime
 * (Vitest unit tests, local dev) — the floating promise still runs to
 * completion in those environments because the event loop is owned by
 * the test harness, not by Supabase's request-scoped runtime.
 */
export function fireShadowAndForget(args: ShadowFireArgs): void {
  const shadowPromise = Promise.allSettled([shadowFireOpenAI(args)]).then(
    () => {},
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-shadow] floating-promise rejection swallowed: ${msg}`);
    },
  );

  // Edge Runtime extension: keep the function alive until the shadow
  // completes. `EdgeRuntime` is a Supabase Edge global, not a Web standard;
  // we check for its presence + the `waitUntil` method defensively because
  // (a) Vitest and Deno-local don't define it, and (b) future runtime
  // upgrades could rename the API. A missing API is fine — the floating
  // promise still runs to completion in any environment that owns the
  // event loop beyond the request scope.
  const edgeRuntime = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  if (
    typeof edgeRuntime !== 'undefined' &&
    edgeRuntime !== null &&
    typeof (edgeRuntime as { waitUntil?: unknown }).waitUntil === 'function'
  ) {
    try {
      (edgeRuntime as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(
        shadowPromise,
      );
    } catch (err) {
      // Defensive: any oddity in the waitUntil call must NEVER bubble.
      // The shadow still runs on the event loop; we just lose the
      // lifetime-extension guarantee.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mol-shadow] EdgeRuntime.waitUntil threw: ${msg}`);
    }
  }
}

/**
 * C4.2b-ii: complete the text-capture write for the streaming path.
 *
 * Streaming callers (pipeline-stream.ts) fire shadowFireOpenAI BEFORE the
 * Claude stream starts (parity with the parallelism design from C4.2a).
 * At that point the baseline_response_text is not known — it accumulates
 * during the stream. shadowFireOpenAI therefore STASHES the shadow's
 * response text keyed by the baseline's request_id; this function drains
 * the stash and writes the mol_shadow_text_buffer row.
 *
 * Call this after the stream's `final` ok:true event lands, with the full
 * accumulated baseline text. If the shadow never finished (timeout, error,
 * flag off), the stash is empty and this is a no-op.
 *
 * Always returns synchronously (the underlying recordShadowText is fire-
 * and-forget). Never throws.
 *
 * The args mirror the inline path:
 *   baseline_request_id    : the baseline's request_id (also the stash key)
 *   baseline_response_text : the FULL accumulated stream text
 *
 * The shadow_text, system prompts, and question_text are pulled from the
 * stashed entry so the streaming caller doesn't have to re-derive them.
 */
export function recordShadowTextFromStash(args: {
  baseline_request_id: string;
  baseline_response_text: string;
}): void {
  try {
    const now = Date.now();
    sweepStash(now);
    const entry = __shadowTextStash.get(args.baseline_request_id);
    if (!entry) {
      // No stash entry: text capture was disabled at fire time, OR the
      // shadow short-circuited, OR the worker recycled. Either way, no
      // row gets written for this request.
      return;
    }
    // Drain immediately so a second accidental call cannot double-write.
    __shadowTextStash.delete(args.baseline_request_id);

    if (!args.baseline_response_text || args.baseline_response_text.length === 0) {
      // Defensive: nothing useful to write. Don't pollute the buffer with
      // empty rows.
      return;
    }

    recordShadowText({
      baseline_request_id: entry.baseline_request_id,
      shadow_request_id: entry.shadow_request_id,
      question_text: entry.question_text,
      baseline_system_prompt: entry.baseline_system_prompt,
      shadow_system_prompt: entry.shadow_system_prompt,
      baseline_response_text: args.baseline_response_text,
      shadow_response_text: entry.shadow_response_text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mol-shadow] recordShadowTextFromStash threw: ${msg}`);
  }
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
