/**
 * Foxy pipeline compose runner.
 *
 * SCAFFOLDING — see ./types.ts and the R3 note in each stage stub. The runner
 * is production-shaped (timing ledger, terminal short-circuit, publish-once
 * at close, never throws-from-instrumentation) but is NOT wired into route.ts
 * yet. R3 will land the invocation site.
 *
 * Contract:
 *   - Stages run in the order given.
 *   - After each stage, its wall-clock duration is appended to
 *     ctx.stageMetrics (via a mutation-hole exposed by the private cast; the
 *     TurnContext type declares stageMetrics as readonly to stages, but
 *     compose owns the ledger and is the only writer).
 *   - If a stage returns `{ kind: 'terminal', response }`, the runner
 *     publishes the timing ledger (fire-and-forget) and returns that
 *     Response immediately — later stages do not run.
 *   - If every stage returns `{ kind: 'continue' }`, the runner returns
 *     `{ kind: 'continue' }` so the caller can synthesize a fallback
 *     Response. (In R3 the `close` stage will always return terminal.)
 *   - Instrumentation NEVER throws. logSystemMetric is already fire-and-
 *     forget internally; we also wrap the publish site to swallow anything.
 */

import type { StageFn, StageResult, TurnContext, StageTiming, StageName } from './types';
import { logSystemMetric } from '@alfanumrik/lib/monitoring/log-event';

/** Stage names, in canonical pipeline order. Used to derive a stage's name
 *  from its function.name when possible, with a numeric fallback. */
const STAGE_ORDER: readonly StageName[] = [
  'gate',
  'observe',
  'diagnose',
  'decide',
  'teach',
  'check',
  'update',
  'close',
];

function nameStage(fn: StageFn, index: number): StageName {
  const raw = (fn.name || '').toLowerCase();
  const hit = STAGE_ORDER.find((s) => raw.includes(s));
  if (hit) return hit;
  // Positional fallback — keeps timings labeled even if a caller passes
  // arrow functions or a partial subset.
  return STAGE_ORDER[index] ?? 'close';
}

/** Publish the timing ledger. Fire-and-forget; guaranteed non-throwing.
 *
 *  NOTE ON METADATA SHAPE: the design brief called for
 *  `metadata:{ turnId, stages:{...} }`, but the real `system_metrics` table
 *  (see apps/host/src/types/monitoring.ts:47-54) exposes `tags` — not
 *  `metadata` — as its JSON side-channel. We put the same payload under
 *  `tags` here so it actually lands in the column. If R3 adds a `metadata`
 *  column, flip the field name; the shape stays the same. */
function publishTimings(ctx: TurnContext): void {
  try {
    const stagesTag: Record<string, number> = {};
    for (const t of ctx.stageMetrics) {
      stagesTag[t.stage] = Math.round(t.durationMs * 1000) / 1000;
    }
    // logSystemMetric is already internally try/caught; the outer try/catch
    // here is defense-in-depth in case a caller monkey-patches it.
    void logSystemMetric({
      metric_name: 'foxy.stage_timings',
      value: ctx.stageMetrics.reduce((a, t) => a + t.durationMs, 0),
      tags: { turnId: ctx.turnId, stages: stagesTag },
    });
  } catch {
    // Instrumentation must never break the hot path.
  }
}

export async function runPipeline(
  ctx: TurnContext,
  stages: StageFn[],
): Promise<StageResult> {
  // Compose owns the ledger — cast off the readonly stripe just here.
  const ledger = ctx.stageMetrics as StageTiming[];

  for (let i = 0; i < stages.length; i++) {
    const fn = stages[i];
    const stageName = nameStage(fn, i);
    const t0 = performance.now();
    let result: StageResult;
    try {
      result = await fn(ctx);
    } catch (e) {
      // Record the failed stage's timing so drift is visible in telemetry,
      // then re-throw. Route-level try/catch handles the user response —
      // compose deliberately does not swallow stage errors.
      const t1 = performance.now();
      ledger.push({ stage: stageName, durationMs: t1 - t0 });
      publishTimings(ctx);
      throw e;
    }
    const t1 = performance.now();
    ledger.push({ stage: stageName, durationMs: t1 - t0 });

    if (result.kind === 'terminal') {
      publishTimings(ctx);
      return result;
    }
  }

  publishTimings(ctx);
  return { kind: 'continue' };
}
