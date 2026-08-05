/**
 * Foxy pipeline TurnContext + StageFn/StageResult shapes.
 *
 * SCAFFOLDING — R3 decomposition will move handleFoxyPost sections into the
 * stage modules under this directory. See
 * docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
 * §7 R3 mapping table for the section-to-stage assignments.
 *
 * DO NOT wire runPipeline into route.ts yet — the invocation lands in the R3
 * wave alongside the section extractions, byte-identical to today's inline
 * flow (pinned by the 16 foxy-golden-turns fixtures).
 *
 * ─── TurnContext shape ─────────────────────────────────────────────────────
 *
 * TurnContext is "readonly-after-produce": each stage is the sole producer of
 * its own slot; downstream stages read but never mutate what an upstream
 * stage produced. Enforced structurally by grouping fields under per-stage
 * output interfaces and typing each slot as `Readonly<...> | null`. Every
 * output starts as `null` and is populated exactly once by its producing
 * stage. `stageMetrics` is the sole append-only surface (owned by compose).
 *
 * The per-stage interfaces below are intentionally small — they mark the
 * *contract* between stages, not the full internal shape of any one stage.
 * R3 will widen them as sections move in.
 */

import type { NextRequest } from 'next/server';

// ─── Stage name union ───────────────────────────────────────────────────────

export type StageName =
  | 'gate'
  | 'observe'
  | 'diagnose'
  | 'decide'
  | 'teach'
  | 'check'
  | 'update'
  | 'close';

// ─── Per-stage output interfaces (contract-only; widened in R3) ────────────
//
// Every field on these interfaces is READONLY: once a stage produces its
// output, downstream stages read but never mutate. Stages that have not yet
// been decomposed keep their slot at `null`; the compose runner never
// interprets the slot's shape — it only orders StageFn calls.

/** GATE — authz, kill-switch, body parse, grade/subject validation. */
export interface GateOutput {
  readonly studentId: string;
  readonly subject: string;
  readonly grade: string; // P5: always the STRING "6".."12", never int
  readonly chapter: string | null;
  readonly message: string;
  readonly mode: string;
  readonly sessionId: string | null;
}

/** OBSERVE — quota check, safeguarding pre-scan, prior-session context. */
export interface ObserveOutput {
  readonly quotaOk: boolean;
  readonly safeguardingFlag: 'none' | 'watch' | 'block';
  readonly priorSessionSnippet: string | null;
}

/** DIAGNOSE — cognitive-context load, RAG retrieval, misconception lookup. */
export interface DiagnoseOutput {
  readonly cognitiveContextLoaded: boolean;
  readonly ragChunkCount: number;
  readonly recentMisconceptionCount: number;
}

/** DECIDE — ladder rung selection, teaching-director prompt shape. */
export interface DecideOutput {
  readonly nextAction: string | null;
  readonly ladderRung: string | null;
  readonly promptTemplateId: string | null;
}

/** TEACH — Claude call (streaming or non-streaming), structured extraction. */
export interface TeachOutput {
  readonly streamed: boolean;
  readonly responseTokens: number | null;
}

/** CHECK — output-safety backstop, oracle gate for MCQs, math-verify. */
export interface CheckOutput {
  readonly safetyVerdict: 'pass' | 'blocked';
  readonly oracleVerdict: 'pass' | 'blocked' | 'n/a';
}

/** UPDATE — session/turn persistence, misconception log, XP/mastery hooks. */
export interface UpdateOutput {
  readonly turnPersisted: boolean;
  readonly xpAwarded: number;
}

/** CLOSE — telemetry publish, response finalization. */
export interface CloseOutput {
  readonly telemetryPublished: boolean;
}

// ─── Per-stage timing record (append-only, owned by compose) ───────────────

export interface StageTiming {
  readonly stage: StageName;
  readonly durationMs: number;
}

// ─── The TurnContext itself ────────────────────────────────────────────────

export interface TurnContext {
  // Immutable request handles (set by the top-level route wrapper before
  // runPipeline is invoked; never re-assigned).
  readonly request: NextRequest;
  readonly turnId: string;
  readonly correlationId: string;
  readonly startedAtMs: number;

  // Per-stage output slots. Each starts as `null` and is populated exactly
  // once by its producing stage. Structurally readonly.
  gate: Readonly<GateOutput> | null;
  observe: Readonly<ObserveOutput> | null;
  diagnose: Readonly<DiagnoseOutput> | null;
  decide: Readonly<DecideOutput> | null;
  teach: Readonly<TeachOutput> | null;
  check: Readonly<CheckOutput> | null;
  update: Readonly<UpdateOutput> | null;
  close: Readonly<CloseOutput> | null;

  // Append-only timing ledger, owned by compose.runPipeline. Stages MUST NOT
  // push to this directly.
  readonly stageMetrics: StageTiming[];
}

// ─── Stage function contract ───────────────────────────────────────────────

export type StageResult =
  | { kind: 'continue' }
  | { kind: 'terminal'; response: Response };

export type StageFn = (ctx: TurnContext) => Promise<StageResult> | StageResult;

/** Convenience factory for empty-context construction (used by scaffolding
 *  and by tests). R3 will replace this with the real route-level builder. */
export function createEmptyTurnContext(
  request: NextRequest,
  turnId: string,
  correlationId: string,
): TurnContext {
  return {
    request,
    turnId,
    correlationId,
    startedAtMs: Date.now(),
    gate: null,
    observe: null,
    diagnose: null,
    decide: null,
    teach: null,
    check: null,
    update: null,
    close: null,
    stageMetrics: [],
  };
}
