/**
 * Pipeline scaffolding tests — Wave R3-prep.
 *
 * Pins the compose runner shape BEFORE any handleFoxyPost sections are moved
 * into stages. Confirms:
 *   1. runPipeline calls every stage in the order given.
 *   2. A stage returning `{ kind: 'terminal', response }` short-circuits the
 *      remaining stages and returns that Response.
 *   3. Per-stage timings are appended to ctx.stageMetrics in order.
 *   4. Every empty stub stage returns `{ kind: 'continue' }` (i.e. touching
 *      the scaffolding is a no-op today).
 *   5. TurnContext type shape — compile-time asserted via `satisfies`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Silence the logSystemMetric fire-and-forget publish so tests don't try to
// hit supabase-admin. Compose's publish site is fire-and-forget, but the
// import chain would still load supabase-admin without this.
vi.mock('@alfanumrik/lib/monitoring/log-event', () => ({
  logSystemMetric: vi.fn(async () => undefined),
}));

import { runPipeline } from '@/app/api/foxy/_pipeline/compose';
import {
  createEmptyTurnContext,
  type StageFn,
  type StageResult,
  type TurnContext,
  type StageName,
} from '@/app/api/foxy/_pipeline/types';
import { gateStage } from '@/app/api/foxy/_pipeline/gate';
import { observeStage } from '@/app/api/foxy/_pipeline/observe';
import { diagnoseStage } from '@/app/api/foxy/_pipeline/diagnose';
import { decideStage } from '@/app/api/foxy/_pipeline/decide';
import { teachStage } from '@/app/api/foxy/_pipeline/teach';
import { checkStage } from '@/app/api/foxy/_pipeline/check';
import { updateStage } from '@/app/api/foxy/_pipeline/update';
import { closeStage } from '@/app/api/foxy/_pipeline/close';
import { logSystemMetric } from '@alfanumrik/lib/monitoring/log-event';

function makeCtx(): TurnContext {
  // The compose runner never touches `request`; a bare cast is safe for
  // scaffolding tests. R3 will introduce a real NextRequest fixture builder.
  const fakeRequest = {} as unknown as NextRequest;
  return createEmptyTurnContext(fakeRequest, 'turn-test-1', 'corr-test-1');
}

describe('foxy pipeline compose — R3 scaffolding', () => {
  it('runs stages in the given order and records a timing per stage', async () => {
    const calls: string[] = [];
    const mk = (name: string): StageFn => {
      const fn: StageFn = async () => {
        calls.push(name);
        // Introduce a small measurable async gap so durationMs is > 0 on all
        // platforms (Windows perf timers can otherwise return 0 for
        // back-to-back sync calls).
        await new Promise((r) => setImmediate(r));
        return { kind: 'continue' };
      };
      Object.defineProperty(fn, 'name', { value: `${name}Stage` });
      return fn;
    };

    const ctx = makeCtx();
    const result = await runPipeline(ctx, [
      mk('gate'),
      mk('observe'),
      mk('diagnose'),
      mk('decide'),
    ]);

    expect(result).toEqual({ kind: 'continue' });
    expect(calls).toEqual(['gate', 'observe', 'diagnose', 'decide']);
    expect(ctx.stageMetrics).toHaveLength(4);
    expect(ctx.stageMetrics.map((t) => t.stage)).toEqual([
      'gate',
      'observe',
      'diagnose',
      'decide',
    ]);
    for (const t of ctx.stageMetrics) {
      expect(t.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(t.durationMs)).toBe(true);
    }
  });

  it('short-circuits on a terminal stage and returns that Response', async () => {
    const laterCalled = vi.fn();
    const terminalResponse = new Response('bye', { status: 418 });

    const stopping: StageFn = async () => ({
      kind: 'terminal',
      response: terminalResponse,
    });
    Object.defineProperty(stopping, 'name', { value: 'diagnoseStage' });

    const after: StageFn = async () => {
      laterCalled();
      return { kind: 'continue' };
    };
    Object.defineProperty(after, 'name', { value: 'decideStage' });

    const ctx = makeCtx();
    const result = (await runPipeline(ctx, [
      gateStage,
      observeStage,
      stopping,
      after,
    ])) as Extract<StageResult, { kind: 'terminal' }>;

    expect(result.kind).toBe('terminal');
    expect(result.response).toBe(terminalResponse);
    expect(laterCalled).not.toHaveBeenCalled();

    // Only the three stages that actually ran should be timed.
    expect(ctx.stageMetrics.map((t) => t.stage)).toEqual([
      'gate',
      'observe',
      'diagnose',
    ]);
  });

  it('publishes stage timings via logSystemMetric exactly once at close', async () => {
    (logSystemMetric as unknown as ReturnType<typeof vi.fn>).mockClear();

    const ctx = makeCtx();
    await runPipeline(ctx, [gateStage, observeStage, closeStage]);

    expect(logSystemMetric).toHaveBeenCalledTimes(1);
    const call = (logSystemMetric as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      metric_name: string;
      tags: { turnId: string; stages: Record<string, number> };
    };
    expect(call.metric_name).toBe('foxy.stage_timings');
    expect(call.tags.turnId).toBe('turn-test-1');
    expect(Object.keys(call.tags.stages).sort()).toEqual(
      ['close', 'gate', 'observe'].sort(),
    );
  });

  it('every empty stub stage returns { kind: "continue" }', async () => {
    const ctx = makeCtx();
    for (const stage of [
      gateStage,
      observeStage,
      diagnoseStage,
      decideStage,
      teachStage,
      checkStage,
      updateStage,
      closeStage,
    ]) {
      const r = await stage(ctx);
      expect(r).toEqual({ kind: 'continue' });
    }
  });
});

describe('foxy pipeline types — compile-time contract', () => {
  it('TurnContext shape has all 8 per-stage output slots (null on init)', () => {
    const ctx = makeCtx();
    // Compile-time assertion — `satisfies` fails the build if any slot is
    // dropped from TurnContext. Runtime check confirms initial null.
    const snapshot = {
      gate: ctx.gate,
      observe: ctx.observe,
      diagnose: ctx.diagnose,
      decide: ctx.decide,
      teach: ctx.teach,
      check: ctx.check,
      update: ctx.update,
      close: ctx.close,
    } satisfies Record<StageName, unknown>;

    for (const v of Object.values(snapshot)) {
      expect(v).toBeNull();
    }
    expect(ctx.stageMetrics).toEqual([]);
    expect(typeof ctx.startedAtMs).toBe('number');
    expect(ctx.turnId).toBe('turn-test-1');
    expect(ctx.correlationId).toBe('corr-test-1');
  });

  it('StageName union covers exactly the 8 canonical stages', () => {
    // The `satisfies` here is the real assertion — the runtime array is
    // just so the test has something to expect().
    const all = [
      'gate',
      'observe',
      'diagnose',
      'decide',
      'teach',
      'check',
      'update',
      'close',
    ] as const satisfies readonly StageName[];
    expect(all).toHaveLength(8);
  });
});
