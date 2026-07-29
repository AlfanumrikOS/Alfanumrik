// apps/host/src/__tests__/lib/ai/eval/emit.test.ts
//
// Phase 4 — Runtime `ResponseEval` observability sensor: FIRE-AND-FORGET emitter.
//
// Pins the emission contract from the spec (§5 PII rules + §6 emission):
//   * `logResponseEval` emits via the injectable `logOpsEvent` ONCE with
//     category:'ai' / source:'response-eval' / severity:'info'.
//   * The emitted `context` carries dimension scores/raws/codes + flag reasons +
//     correlation UUIDs + scope enums + numbers ONLY — NEVER response/message
//     text and NEVER a PII-shaped key (email/phone/name/token).
//   * NEVER-THROW: a throwing injected `logOpsEvent` still resolves cleanly, and
//     `scoreResponse` never throws on well-formed input.
//
// Owner: testing. Source under test: packages/lib/src/ai/eval/emit.ts (barrel).

import { describe, it, expect, vi } from 'vitest';

import { scoreResponse, logResponseEval, evaluateAndEmit, type ResponseEvalSignals } from '@alfanumrik/lib/ai/eval';

function signals(overrides: Partial<ResponseEvalSignals> = {}): ResponseEvalSignals {
  return {
    curriculumInScope: true,
    curriculumReason: null,
    confidence: 0.9,
    groundedFromChunks: true,
    citationsCount: 2,
    screenCategories: [],
    gradeRangeSoftFail: false,
    masteryLevel: 0.6,
    latencyMs: 500,
    costUsd: 0.01,
    traceId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    messageId: '33333333-3333-4333-8333-333333333333',
    grade: '8',
    subject: 'science',
    ...overrides,
  };
}

// Recursively collect every string leaf value from the context for the "no prose"
// scan. Codes/UUIDs/enums have no interior whitespace; free response text would.
function stringLeaves(v: unknown, acc: string[] = []): string[] {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringLeaves(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringLeaves(x, acc));
  return acc;
}

const PII_KEY_RE = /email|phone|\bname\b|password|token|secret|ip_?addr|address/i;

describe('logResponseEval — single fire-and-forget emission (category ai / response-eval)', () => {
  it('calls the injected logOpsEvent exactly once with the correct envelope', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const record = scoreResponse(signals());

    await logResponseEval(record, { logOpsEvent: spy });

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg.category).toBe('ai');
    expect(arg.source).toBe('response-eval');
    expect(arg.severity).toBe('info'); // fire-and-forget tier
    expect(arg.message).toBe('response_eval');
    expect(arg.subjectType).toBe('foxy_message');
    expect(arg.subjectId).toBe(record.messageId);
    expect(arg.requestId).toBe(record.traceId);
    expect(arg.context).toBeTypeOf('object');
  });

  it('emitted context carries the 9 dimension scores + flag data + correlation ids', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const record = scoreResponse(signals());
    await logResponseEval(record, { logOpsEvent: spy });
    const ctx = spy.mock.calls[0][0].context as Record<string, unknown>;

    for (const dim of [
      'accuracy',
      'curriculum_alignment',
      'hallucination_risk',
      'age_appropriateness',
      'difficulty_fit',
      'learning_effectiveness',
      'toxicity',
      'latency',
      'cost',
    ]) {
      expect(ctx).toHaveProperty(`${dim}_score`);
      expect(ctx).toHaveProperty(`${dim}_source`);
      expect(ctx).toHaveProperty(`${dim}_available`);
    }
    expect(ctx.flagged).toBe(false);
    expect(ctx.flag_reasons).toEqual([]);
    expect(ctx.trace_id).toBe(record.traceId);
    expect(ctx.session_id).toBe(record.sessionId);
    expect(ctx.message_id).toBe(record.messageId);
    expect(ctx.grade).toBe('8'); // scope enum, not PII
    expect(ctx.subject).toBe('science');
  });
});

describe('logResponseEval — P13: context is codes/ids/numbers only (no text, no PII keys)', () => {
  it('has NO PII-shaped keys and NO free-text (prose) string values', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    // Use a flagged record so codes + flag_reasons are populated (worst case).
    const record = scoreResponse(
      signals({ screenCategories: ['blocklist'], curriculumInScope: false, curriculumReason: 'off_topic' }),
    );
    await logResponseEval(record, { logOpsEvent: spy });
    const ctx = spy.mock.calls[0][0].context as Record<string, unknown>;

    // (a) no PII-shaped keys
    for (const key of Object.keys(ctx)) {
      expect(PII_KEY_RE.test(key), `context key "${key}" looks PII-shaped`).toBe(false);
    }

    // (b) every string leaf is a compact code/uuid/enum — never prose. A response
    // or student message would contain interior whitespace; codes never do.
    for (const s of stringLeaves(ctx)) {
      expect(/\s/.test(s), `context string "${s}" contains whitespace (possible prose/PII)`).toBe(false);
      expect(s.length).toBeLessThanOrEqual(64); // UUIDs are 36; codes far shorter
    }
  });
});

describe('logResponseEval / evaluateAndEmit — never throw into the caller', () => {
  it('resolves cleanly when the injected logOpsEvent THROWS synchronously', async () => {
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const record = scoreResponse(signals());
    await expect(logResponseEval(record, { logOpsEvent: throwing })).resolves.toBeUndefined();
  });

  it('evaluateAndEmit composes + emits and never throws (even with a throwing sink)', async () => {
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    await expect(evaluateAndEmit(signals(), { logOpsEvent: throwing })).resolves.toBeUndefined();

    const ok = vi.fn().mockResolvedValue(undefined);
    await evaluateAndEmit(signals(), { logOpsEvent: ok });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok.mock.calls[0][0].source).toBe('response-eval');
  });

  it('scoreResponse never throws on well-formed OR degenerate-but-typed input', () => {
    const inputs: ResponseEvalSignals[] = [
      signals(),
      signals({ confidence: null, masteryLevel: null, latencyMs: null, costUsd: null }),
      signals({ citationsCount: 0, groundedFromChunks: false, screenCategories: ['screen_error'] }),
      signals({ confidence: 5, masteryLevel: -3, latencyMs: -100, costUsd: -1 }), // out-of-range but finite
    ];
    for (const s of inputs) {
      expect(() => scoreResponse(s)).not.toThrow();
    }
  });
});
