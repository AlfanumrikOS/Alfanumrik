/**
 * WhatsApp Daily 6 — compose pipeline + pure helpers (Phase 3).
 *
 * Binding spec: docs/superpowers/specs/2026-07-30-whatsapp-daily6-behavioral-spec.md
 * Module under test: apps/host/src/app/api/whatsapp/_lib/daily6.ts
 *
 * Pins here (builder handoff numbering):
 *   (vii)  P6 quality gate table — template braces, [BLANK], <4 / duplicate /
 *          empty options, out-of-range correct_answer_index, empty explanation
 *          all reject; a clean question passes.
 *   (viii) mixed_recall_queue injection seam runs AFTER get_practice_queue and
 *          BEFORE the RAG top-up — pinned by static call-order on the module
 *          source (the call is an intra-module direct call, so a spy cannot
 *          intercept it) plus runtime behavior (no top-up when the queue
 *          fills the set; top-up covers exactly the post-seam deficit).
 *   plus spec (a): queue accepted VERBATIM (no bot-side re-ranking), cold-start
 *          seed-once-and-retry, one-refetch-per-node P6 handling, exact RAG
 *          top-up argument mapping, graceful degradation when the top-up RPC
 *          denies (the on-disk select_quiz_questions_rag has no service-role
 *          ownership skip — documented contract deviation in the module).
 *
 * House pattern: supabaseAdmin mocked via lazy Proxy, logger mocked at the
 * module boundary. Owner: testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Module-boundary mocks ──────────────────────────────────────────────────

let mockAdminImpl: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_target, prop) {
      if (!mockAdminImpl) return undefined;
      const value = mockAdminImpl[prop];
      return typeof value === 'function' ? value.bind(mockAdminImpl) : value;
    },
  }),
}));

const loggerCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'error', msg, meta }),
    debug: vi.fn(),
  },
}));

import {
  passesP6Gate,
  truncateAtSentence,
  applyMixedRecallInjection,
  composeDaily6Set,
  formatNextReview,
} from '@/app/api/whatsapp/_lib/daily6';

// ─── supabaseAdmin state ────────────────────────────────────────────────────

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcHandler = RpcResult[] | ((args: Record<string, any>) => RpcResult);

const st = {
  rpcCalls: [] as Array<{ name: string; args: Record<string, any> }>,
  rpcHandlers: {} as Record<string, RpcHandler>,
  /** learning_graph rows for the cold-start node scan (select 'node_code'). */
  nodeRows: [] as Array<{ node_code: string }>,
  /** adaptive_mastery head-count for the cold-start zero check. */
  masteryCount: 0,
};

function resetState() {
  st.rpcCalls.length = 0;
  st.rpcHandlers = {};
  st.nodeRows = [];
  st.masteryCount = 0;
}

function buildMockAdmin() {
  return {
    from(table: string) {
      if (table === 'learning_graph') {
        return {
          select: () => {
            const c: any = {
              eq: () => c,
              limit: () => c,
              then: (res: any, rej: any) =>
                Promise.resolve({ data: st.nodeRows, error: null }).then(res, rej),
            };
            return c;
          },
        };
      }
      if (table === 'adaptive_mastery') {
        return {
          select: () => {
            const c: any = {
              eq: () => c,
              in: () => c,
              then: (res: any, rej: any) =>
                Promise.resolve({ count: st.masteryCount, error: null }).then(res, rej),
            };
            return c;
          },
        };
      }
      throw new Error(`unexpected from(${table}) in compose tests`);
    },
    rpc: async (name: string, args: Record<string, any>) => {
      st.rpcCalls.push({ name, args });
      const h = st.rpcHandlers[name];
      if (!h) return { data: null, error: { message: `no handler for ${name}` } };
      if (typeof h === 'function') return h(args);
      return h.length > 1 ? h.shift()! : h[0];
    },
  };
}

function rpcCallsOf(name: string) {
  return st.rpcCalls.filter((c) => c.name === name);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function validQ(id: string) {
  return {
    id,
    question_text: `What is the value in ${id}?`,
    options: [`${id}-a`, `${id}-b`, `${id}-c`, `${id}-d`],
    correct_answer_index: 1,
    explanation: `Because of the ${id} rule.`,
  };
}

function queueItem(node: string, over: Record<string, unknown> = {}) {
  return { node_code: node, title: `Title ${node}`, source: 'srs_due', mastery_pct: 60, ...over };
}

const SIX_NODES = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];

/** Default per-node question feed: node Nk → question q-Nk (all P6-valid). */
function perNodeFeed(map: Record<string, any[]>) {
  st.rpcHandlers.get_questions_for_node = (args) => {
    const list = map[args.p_node_code as string] ?? [];
    const q = list.shift() ?? null;
    return { data: q ? [q] : [], error: null };
  };
}

beforeEach(() => {
  resetState();
  loggerCalls.length = 0;
  mockAdminImpl = buildMockAdmin();
});

afterEach(() => {
  // Spec correction 2 (double-XP protection): NOTHING in the compose pipeline
  // may ever touch record_adaptive_response.
  expect(st.rpcCalls.map((c) => c.name)).not.toContain('record_adaptive_response');
});

// ─────────────────────────────────────────────────────────────────────────────
// (vii) P6 quality gate table
// ─────────────────────────────────────────────────────────────────────────────

describe('passesP6Gate — P6 quality gate (spec correction 3 / (b))', () => {
  it('accepts a clean question (non-empty text, 4 distinct options, index 0-3, explanation)', () => {
    expect(passesP6Gate(validQ('q1'))).toBe(true);
  });

  it.each([
    ['empty question_text', { ...validQ('q'), question_text: '' }],
    ['whitespace-only question_text', { ...validQ('q'), question_text: '   ' }],
    ['missing question_text', { ...validQ('q'), question_text: null }],
    ['template braces {{name}}', { ...validQ('q'), question_text: 'Solve {{value}} now' }],
    ['[BLANK] marker', { ...validQ('q'), question_text: 'Fill the [BLANK] here' }],
    ['lowercase [blank] marker', { ...validQ('q'), question_text: 'Fill the [blank] here' }],
    ['only 3 options', { ...validQ('q'), options: ['a', 'b', 'c'] }],
    ['5 options', { ...validQ('q'), options: ['a', 'b', 'c', 'd', 'e'] }],
    ['options not an array', { ...validQ('q'), options: 'a,b,c,d' }],
    ['duplicate options', { ...validQ('q'), options: ['a', 'b', 'a', 'd'] }],
    ['duplicate-after-trim options', { ...validQ('q'), options: ['a', 'b', ' a ', 'd'] }],
    ['an empty option', { ...validQ('q'), options: ['a', '', 'c', 'd'] }],
    ['a whitespace-only option', { ...validQ('q'), options: ['a', '  ', 'c', 'd'] }],
    ['a non-string option', { ...validQ('q'), options: ['a', 42, 'c', 'd'] }],
    ['correct_answer_index 4 (out of range)', { ...validQ('q'), correct_answer_index: 4 }],
    ['correct_answer_index -1', { ...validQ('q'), correct_answer_index: -1 }],
    ['correct_answer_index 1.5 (non-integer)', { ...validQ('q'), correct_answer_index: 1.5 }],
    ['correct_answer_index missing', { ...validQ('q'), correct_answer_index: null }],
    ['correct_answer_index as string', { ...validQ('q'), correct_answer_index: '2' }],
    ['empty explanation', { ...validQ('q'), explanation: '' }],
    ['whitespace-only explanation', { ...validQ('q'), explanation: '   ' }],
    ['missing explanation', { ...validQ('q'), explanation: null }],
  ])('rejects: %s', (_label, q) => {
    expect(passesP6Gate(q as any)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// truncateAtSentence (spec (d) — wrong-answer explanation, ~300 chars)
// ─────────────────────────────────────────────────────────────────────────────

describe('truncateAtSentence — explanation truncation at a sentence boundary', () => {
  it('returns short strings untouched', () => {
    expect(truncateAtSentence('Short explanation.')).toBe('Short explanation.');
  });

  it('cuts long text at the last sentence boundary within the limit', () => {
    const s = `${'First sentence about fractions. '.repeat(6)}${'x'.repeat(400)}`;
    const out = truncateAtSentence(s);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith('.')).toBe(true);
  });

  it('honours the Devanagari danda (।) as a sentence boundary', () => {
    const s = `${'यह एक वाक्य है। '.repeat(30)}`;
    const out = truncateAtSentence(s);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith('।')).toBe(true);
  });

  it('falls back to an ellipsis when no boundary exists near the limit', () => {
    const s = 'y'.repeat(500);
    const out = truncateAtSentence(s);
    expect(out.endsWith('…')).toBe(true);
    // PINNED ACTUAL: the ellipsis fallback appends '…' AFTER the 300-char cut,
    // so the ceiling is max+1 (301). Spec (d) says "~300 chars" — acceptable.
    expect(out.length).toBeLessThanOrEqual(301);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatNextReview (spec (h))
// ─────────────────────────────────────────────────────────────────────────────

describe('formatNextReview — IST weekday within 6 days, else "12 Aug" form', () => {
  const now = new Date('2026-08-10T00:00:00Z');

  it('renders an IST weekday for a review within 6 days', () => {
    // 2026-08-13 is a Thursday (IST and UTC agree at midnight+5:30).
    expect(formatNextReview('2026-08-13T04:00:00Z', now)).toBe('Thu');
  });

  it('renders "<day> <Mon>" beyond 6 days out', () => {
    expect(formatNextReview('2026-08-25T10:00:00Z', now)).toBe('25 Aug');
  });

  it('returns empty string for an unparseable date', () => {
    expect(formatNextReview('not-a-date', now)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (viii) Injection seam — position pinned statically + runtime contract
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMixedRecallInjection — Phase-6 seam (spec (j))', () => {
  // apps/host/src/__tests__/whatsapp → ../../ = apps/host/src
  const daily6Src = readFileSync(
    resolve(__dirname, '..', '..', 'app', 'api', 'whatsapp', '_lib', 'daily6.ts'),
    'utf8',
  );

  it('STATIC call-order pin: the seam call sits AFTER get_practice_queue and BEFORE the RAG top-up', () => {
    // The seam is an intra-module direct call, so a module spy cannot observe
    // it — pin the call order in the source instead (REG-118-style canary).
    const iQueue = daily6Src.indexOf("rpc('get_practice_queue'");
    const iSeam = daily6Src.indexOf('applyMixedRecallInjection(queue,'); // call site only
    const iTopup = daily6Src.indexOf("rpc('select_quiz_questions_rag'");
    expect(iQueue).toBeGreaterThan(-1);
    expect(iSeam).toBeGreaterThan(-1);
    expect(iTopup).toBeGreaterThan(-1);
    expect(iQueue).toBeLessThan(iSeam);
    expect(iSeam).toBeLessThan(iTopup);
  });

  it('is exported as a discrete, testable step (spec (j).1)', () => {
    expect(typeof applyMixedRecallInjection).toBe('function');
  });

  it('is the identity today (Phase 6 replaces the body — same QueueItem contract)', () => {
    const queue = [queueItem('N1'), queueItem('N2', { source: 'zpd' })];
    const out = applyMixedRecallInjection(queue, {
      studentId: 'stu-1',
      subject: 'MATH',
      grade: '8',
    });
    expect(out).toEqual(queue);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// composeDaily6Set (spec (a)/(b))
// ─────────────────────────────────────────────────────────────────────────────

describe('composeDaily6Set — queue verbatim, per-node fetch, P6 gate', () => {
  it('happy path: 6-node queue, all P6-valid → set in RPC queue order, meta carries node/source/mastery, no seed, no top-up', async () => {
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: SIX_NODES.map((n, i) => queueItem(n, { mastery_pct: 50 + i })) }, error: null },
    ];
    perNodeFeed(Object.fromEntries(SIX_NODES.map((n) => [n, [validQ(`q-${n}`)]])));

    const out = await composeDaily6Set('stu-1', 'MATH', '8');

    // Exact RPC argument mapping (spec (a)) — P5 grade STRING.
    expect(rpcCallsOf('get_practice_queue')).toHaveLength(1);
    expect(rpcCallsOf('get_practice_queue')[0].args).toEqual({
      p_student_id: 'stu-1',
      p_subject: 'MATH',
      p_grade: '8',
      p_session_size: 6,
    });

    // Queue accepted VERBATIM — no bot-side re-ranking.
    expect(out.questionIds).toEqual(SIX_NODES.map((n) => `q-${n}`));
    expect(out.meta.map((m) => m.node_code)).toEqual(SIX_NODES);
    expect(out.meta[0]).toEqual({
      question_id: 'q-N1',
      node_code: 'N1',
      source: 'srs_due',
      mastery_pct_before: 50,
      title: 'Title N1',
    });

    expect(rpcCallsOf('seed_adaptive_mastery')).toHaveLength(0);
    // Full set → the top-up (which sits AFTER the seam) is never invoked.
    expect(rpcCallsOf('select_quiz_questions_rag')).toHaveLength(0);
  });

  it('accumulates exclude ids: each per-node fetch excludes everything already picked', async () => {
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: ['N1', 'N2', 'N3'].map((n) => queueItem(n)) }, error: null },
    ];
    // The module passes its live excludeIds array by reference — snapshot it
    // AT CALL TIME (which is what PostgREST serialization sees in production).
    const excludeSnapshots: string[][] = [];
    const feed: Record<string, any[]> = {
      N1: [validQ('q-N1')],
      N2: [validQ('q-N2')],
      N3: [validQ('q-N3')],
    };
    st.rpcHandlers.get_questions_for_node = (args) => {
      excludeSnapshots.push([...(args.p_exclude_ids as string[])]);
      const q = (feed[args.p_node_code as string] ?? []).shift() ?? null;
      return { data: q ? [q] : [], error: null };
    };

    await composeDaily6Set('stu-1', 'MATH', '8');

    expect(excludeSnapshots).toEqual([[], ['q-N1'], ['q-N1', 'q-N2']]);
    const calls = rpcCallsOf('get_questions_for_node');
    expect(calls.every((c) => c.args.p_count === 1 && c.args.p_bloom_level === null)).toBe(true);
  });

  it('P6-invalid candidate → exactly ONE refetch (excluding the bad id); second valid candidate is picked', async () => {
    const bad = { ...validQ('bad-1'), options: ['a', 'a', 'c', 'd'] }; // duplicate options
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: [queueItem('N1')] }, error: null },
    ];
    perNodeFeed({ N1: [bad, validQ('good-1')] });
    // Deficit of 5 → top-up attempted but denied; degrade gracefully.
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];

    const out = await composeDaily6Set('stu-1', 'MATH', '8');

    const nodeCalls = rpcCallsOf('get_questions_for_node');
    expect(nodeCalls).toHaveLength(2); // one fetch + ONE refetch, never more
    expect(nodeCalls[1].args.p_exclude_ids).toContain('bad-1');
    expect(out.questionIds).toEqual(['good-1']);
  });

  it('both candidates P6-invalid → the slot falls to top-up (node contributes nothing)', async () => {
    const bad1 = { ...validQ('bad-1'), explanation: '' };
    const bad2 = { ...validQ('bad-2'), question_text: 'Has {{template}}' };
    st.rpcHandlers.get_practice_queue = [{ data: { queue: [queueItem('N1')] }, error: null }];
    perNodeFeed({ N1: [bad1, bad2] });
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: [validQ('topup-1')], error: null },
    ];

    const out = await composeDaily6Set('stu-1', 'MATH', '8');

    expect(rpcCallsOf('get_questions_for_node')).toHaveLength(2);
    expect(out.questionIds).toEqual(['topup-1']);
    expect(out.meta[0]).toEqual({
      question_id: 'topup-1',
      node_code: null,
      source: 'topup',
      mastery_pct_before: null,
      title: null,
    });
  });

  it('cold start (spec (a).1): empty queue + zero mastery rows → seed ONCE with exact args, retry the queue', async () => {
    st.nodeRows = [{ node_code: 'N1' }, { node_code: 'N2' }];
    st.masteryCount = 0;
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: [] }, error: null },
      { data: { queue: SIX_NODES.map((n) => queueItem(n)) }, error: null },
    ];
    st.rpcHandlers.seed_adaptive_mastery = [{ data: null, error: null }];
    perNodeFeed(Object.fromEntries(SIX_NODES.map((n) => [n, [validQ(`q-${n}`)]])));

    const out = await composeDaily6Set('stu-1', 'MATH', '8');

    expect(rpcCallsOf('seed_adaptive_mastery')).toHaveLength(1);
    expect(rpcCallsOf('seed_adaptive_mastery')[0].args).toEqual({
      p_student_id: 'stu-1',
      p_subject: 'MATH',
      p_grade: '8',
    });
    expect(rpcCallsOf('get_practice_queue')).toHaveLength(2); // seed-and-retry
    expect(out.questionIds).toHaveLength(6);
  });

  it('short queue with EXISTING mastery rows → no seed; deficit topped up via RAG with the exact spec arg mapping', async () => {
    st.nodeRows = [{ node_code: 'N1' }];
    st.masteryCount = 7; // not a cold start
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: ['N1', 'N2', 'N3', 'N4'].map((n) => queueItem(n)) }, error: null },
    ];
    perNodeFeed(
      Object.fromEntries(['N1', 'N2', 'N3', 'N4'].map((n) => [n, [validQ(`q-${n}`)]])),
    );
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: [validQ('topup-1'), validQ('topup-2')], error: null },
    ];

    const out = await composeDaily6Set('stu-1', 'MATH', '8');

    expect(rpcCallsOf('seed_adaptive_mastery')).toHaveLength(0);
    const rag = rpcCallsOf('select_quiz_questions_rag');
    expect(rag).toHaveLength(1);
    // Spec (a).2 exact mapping: select_quiz_questions_rag(student, subject,
    // grade, NULL, deficit, 'mixed', '{mcq}', NULL).
    expect(rag[0].args).toEqual({
      p_student_id: 'stu-1',
      p_subject: 'MATH',
      p_grade: '8',
      p_chapter_number: null,
      p_count: 2,
      p_difficulty_mode: 'mixed',
      p_question_types: ['mcq'],
      p_query_embedding: null,
    });
    expect(out.questionIds).toEqual(['q-N1', 'q-N2', 'q-N3', 'q-N4', 'topup-1', 'topup-2']);
    expect(out.meta[4].source).toBe('topup');
  });

  it('top-up rows are P6-gated and deduped against already-picked ids', async () => {
    st.masteryCount = 3;
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: [queueItem('N1')] }, error: null },
    ];
    perNodeFeed({ N1: [validQ('q-N1')] });
    st.rpcHandlers.select_quiz_questions_rag = [
      {
        data: [
          validQ('q-N1'), // duplicate of a picked id → skipped
          { ...validQ('bad-topup'), options: ['a', 'b', 'c'] }, // P6-invalid → skipped
          validQ('topup-ok'),
        ],
        error: null,
      },
    ];

    const out = await composeDaily6Set('stu-1', 'MATH', '8');
    expect(out.questionIds).toEqual(['q-N1', 'topup-ok']);
  });

  it('top-up RPC denial (documented select_quiz_questions_rag ownership-check deviation) degrades gracefully to the node picks', async () => {
    st.masteryCount = 3;
    st.rpcHandlers.get_practice_queue = [
      { data: { queue: ['N1', 'N2', 'N3', 'N4'].map((n) => queueItem(n)) }, error: null },
    ];
    perNodeFeed(
      Object.fromEntries(['N1', 'N2', 'N3', 'N4'].map((n) => [n, [validQ(`q-${n}`)]])),
    );
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];

    const out = await composeDaily6Set('stu-1', 'MATH', '8');
    // 4 node picks survive; the caller enforces the floor of 3.
    expect(out.questionIds).toHaveLength(4);
  });

  it('get_practice_queue failure → empty node picks, still no throw (caller floor-3 refuses the session)', async () => {
    st.rpcHandlers.get_practice_queue = [{ data: null, error: { message: 'rpc down' } }];
    st.rpcHandlers.select_quiz_questions_rag = [
      { data: null, error: { message: 'Access denied' } },
    ];
    const out = await composeDaily6Set('stu-1', 'MATH', '8');
    expect(out.questionIds).toEqual([]);
    expect(out.meta).toEqual([]);
  });
});
