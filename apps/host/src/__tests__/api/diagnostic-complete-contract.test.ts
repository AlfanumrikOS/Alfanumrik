import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/diagnostic/complete — contract tests
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  WHY THIS FILE WAS REWRITTEN (2026-07-29) — a test was PINNING a defect.
 *
 * The previous revision stubbed `question_bank.select -> { data: [] }` and then
 * asserted `score_percent === 70` for a body that CLAIMED 7 of 10 correct. With
 * an empty question bank the server can derive nothing, so that assertion could
 * only ever pass if the route trusted the CLIENT's `is_correct` flag. The test
 * was not verifying P1 — it was protecting a client-trust scoring vulnerability,
 * and it would have failed the moment the vulnerability was fixed.
 *
 * Every scoring case below now carries a REAL `question_bank` fixture with real
 * `correct_answer_index` values, and the score is asserted against the
 * SERVER-derived correct count. The adversarial block is the load-bearing pin:
 * a client claiming `is_correct: true` on every answer while submitting wrong
 * indices must score 0.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contracts pinned:
 *   1. P1 score formula: score_percent = Math.round((correct / total) * 100),
 *      computed SERVER-side from question_bank.correct_answer_index.
 *   2. C1 (spec §7A / AC-28): the client's `is_correct` is NEVER read — not as
 *      the numerator, not as the stored `diagnostic_responses.is_correct`. It is
 *      ignored in BOTH directions (a false claim cannot deflate a score either).
 *      An unresolvable question_id scores as incorrect, never as the claim.
 *   3. C2 (AC-30): avg < 3s per question forces recommended_difficulty 'medium'
 *      and placement_confidence 'low' regardless of score.
 *   4. AC-31 / §7.5a placement boundaries: 49 → easy, 50 → medium, 79 → medium,
 *      80 → hard. (The 40/70 cuts this file used to assert were the PRE-fix
 *      thresholds; under the 5/6/4 blueprint they placed nearly everyone at
 *      'hard'. Moved, not weakened.)
 *   5. AC-32: the diagnostic is XP-neutral — `atomic_quiz_profile_update` and
 *      every other XP-bearing RPC is never called. (UPDATED 2026-08-24: this
 *      used to read "any other RPC". Phase 5D adds a NON-XP mastery-seeding
 *      call to `update_learner_state_post_quiz`, which does not violate AC-32.
 *      See the XP-neutrality block for the corrected assertions.)
 *   6. 409 ALREADY_COMPLETED idempotency guard.
 *   7. Delete-then-insert on diagnostic_responses (retry safety).
 *   8. Response envelope the /diagnostic page consumes.
 *   9. Phase 5 (2026-08-24): per-question `question_results`, derived
 *      weak/strong topics, and damped mastery seeding. See the Phase 5 banner
 *      near the bottom of this file.
 *
 * P13: every fixture id is synthetic (`student-1`, `q-0`, a fixed UUID). No real
 * student data, no names, no emails, no phone numbers.
 */

// ── RBAC mock ─────────────────────────────────────────────────────────────────

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

function setAuthorized(userId = 'auth-user-1') {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    roles: ['student'],
    permissions: ['diagnostic.complete'],
  });
}

function setUnauthorized() {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ),
  });
}

// ── Recording Supabase admin mock ─────────────────────────────────────────────

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
const results = new Map<string, { data: unknown; error: unknown }>();

/**
 * The RPC spy. AC-32 asserts over the RPC NAMES here (no XP-bearing RPC), and
 * the Phase 5D block asserts the mastery-seed call shape. It is NOT a
 * "no RPC ever" spy any more — see the XP-neutrality block for why.
 */
const mockRpc = vi.fn();

function setResult(key: string, result: { data: unknown; error: unknown }) {
  results.set(key, result);
}

function makeBuilder(table: string) {
  const rec: RecordedQuery = { table, op: 'select', filters: [] };
  recorded.push(rec);
  const resolveResult = () =>
    results.get(`${rec.table}.${rec.op}`) ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert: (rows: unknown) => {
      rec.op = 'insert';
      rec.payload = rows;
      return builder;
    },
    update: (vals: unknown) => {
      rec.op = 'update';
      rec.payload = vals;
      return builder;
    },
    delete: () => {
      rec.op = 'delete';
      return builder;
    },
    single: () => Promise.resolve(resolveResult()),
    maybeSingle: () => Promise.resolve(resolveResult()),
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(resolveResult()).then(onF, onR),
  };
  for (const f of ['eq', 'neq', 'in', 'gte', 'lte']) {
    builder[f] = (col: string, val: unknown) => {
      rec.filters.push([f, col, val]);
      return builder;
    };
  }
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => makeBuilder(t),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

/**
 * Phase 5C topic-title resolution goes through the shared `syllabus`-tagged
 * cached taxonomy reader (ADR-007 / `alfanumrik/no-inline-taxonomy-reads`),
 * not an inline `.from('curriculum_topics')`. Mocked here so the route's
 * behaviour is tested without `unstable_cache` memoising across cases.
 */
const { mockGetTopicTitlesByIds } = vi.hoisted(() => ({
  mockGetTopicTitlesByIds: vi.fn(),
}));
vi.mock('@/lib/curriculum/cached-taxonomy', () => ({
  getTopicTitlesByIds: (...a: unknown[]) => mockGetTopicTitlesByIds(...a),
}));

import { POST } from '@/app/api/diagnostic/complete/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-1';
const SESSION_ID = '11111111-1111-1111-1111-111111111111';

/** Seconds per question in the default fixture — comfortably above the C2 floor. */
const NORMAL_SECONDS = 6;

interface BankRow {
  id: string;
  question_text: string;
  options: string[];
  correct_answer_index: number;
}

function makeBankRow(id: string, correctIndex: number): BankRow {
  return {
    id,
    question_text: `Synthetic diagnostic item ${id} — which option is correct?`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: correctIndex,
  };
}

type Claim = 'honest' | 'all-true' | 'all-false';

interface DiagCase {
  responses: Array<Record<string, unknown>>;
  bank: BankRow[];
}

/**
 * Build a MATCHED (responses, question_bank) pair in which exactly `correct` of
 * `total` submitted indices equal the bank row's `correct_answer_index`.
 *
 * `claim` controls what the client asserts in the wire field `is_correct`:
 *   'honest'    → the truth (the server must agree)
 *   'all-true'  → lies upward (the server must ignore it → AC-28)
 *   'all-false' → lies downward (the server must ignore that too)
 */
function buildCase(
  total: number,
  correct: number,
  opts: { claim?: Claim; seconds?: number } = {}
): DiagCase {
  const claim = opts.claim ?? 'honest';
  const seconds = opts.seconds ?? NORMAL_SECONDS;
  const responses: Array<Record<string, unknown>> = [];
  const bank: BankRow[] = [];

  for (let i = 0; i < total; i++) {
    const id = `q-${i}`;
    const selected = i % 4;
    const shouldBeCorrect = i < correct;
    // Wrong answers point at a DIFFERENT index than the student picked.
    const correctIndex = shouldBeCorrect ? selected : (selected + 1) % 4;
    bank.push(makeBankRow(id, correctIndex));
    responses.push({
      question_id: id,
      selected_answer_index: selected,
      is_correct:
        claim === 'honest' ? shouldBeCorrect : claim === 'all-true' ? true : false,
      time_taken_seconds: seconds,
      topic: null,
      difficulty: 2,
      bloom_level: 'understand',
    });
  }

  return { responses, bank };
}

/** Arm the `question_bank` fixture for a case and hand back its responses. */
function arm(c: DiagCase): Array<Record<string, unknown>> {
  setResult('question_bank.select', { data: c.bank, error: null });
  return c.responses;
}

/** Convenience: build + arm in one step for the common honest case. */
function armed(total: number, correct: number, opts: { claim?: Claim; seconds?: number } = {}) {
  return arm(buildCase(total, correct, opts));
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function post(responses: unknown) {
  return POST(makeRequest({ session_id: SESSION_ID, responses }));
}

/** Standard happy-path DB state: student exists, assessment open, writes succeed. */
function setHappyPathDb() {
  setResult('students.select', { data: { id: STUDENT_ID }, error: null });
  setResult('diagnostic_assessments.select', {
    data: { id: SESSION_ID, is_completed: false },
    error: null,
  });
  // Default bank: empty. Every scoring test MUST arm a real fixture — an empty
  // bank now legitimately means "nothing resolvable", i.e. score 0.
  setResult('question_bank.select', { data: [], error: null });
  setResult('diagnostic_responses.delete', { data: null, error: null });
  setResult('diagnostic_responses.insert', { data: null, error: null });
  setResult('diagnostic_assessments.update', { data: null, error: null });
}

function queriesFor(table: string, op: RecordedQuery['op']) {
  return recorded.filter((r) => r.table === table && r.op === op);
}

function insertedRows(): Array<Record<string, unknown>> {
  const inserts = queriesFor('diagnostic_responses', 'insert');
  expect(inserts.length).toBeGreaterThan(0);
  return inserts[0].payload as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  results.clear();
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockGetTopicTitlesByIds.mockResolvedValue([]);
  setAuthorized();
  setHappyPathDb();
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — auth (P9)', () => {
  it('returns 401 when unauthenticated and touches no tables', async () => {
    setUnauthorized();
    const res = await post(armed(4, 2));
    expect(res.status).toBe(401);
    expect(recorded.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C1 / AC-28 — THE PIN. Correctness is re-derived server-side, always.
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — C1 client-trust rejection (AC-28)', () => {
  it('scores 0 when a client claims is_correct:true for 15 answers that are ALL wrong', async () => {
    const responses = armed(15, 0, { claim: 'all-true' });
    // Sanity: the request really does claim every answer is correct.
    expect(responses.every((r) => r.is_correct === true)).toBe(true);

    const res = await post(responses);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.score_percent).toBe(0);
    expect(body.data.correct_answers).toBe(0);
    expect(body.data.total_questions).toBe(15);
  });

  it('persists is_correct:false on every diagnostic_responses row despite the all-true claim', async () => {
    await post(armed(15, 0, { claim: 'all-true' }));

    const rows = insertedRows();
    expect(rows.length).toBe(15);
    for (const row of rows) {
      expect(row.is_correct).toBe(false);
      // The stored correct_index comes from the bank, not the payload.
      expect(typeof row.correct_index).toBe('number');
      expect(row.correct_index).not.toBe(row.student_index);
    }
  });

  it('ignores the client claim in the DEFLATING direction too: all-false claim on all-correct answers scores 100', async () => {
    const responses = armed(10, 10, { claim: 'all-false' });
    expect(responses.every((r) => r.is_correct === false)).toBe(true);

    const res = await post(responses);
    const body = await res.json();
    expect(body.data.score_percent).toBe(100);
    expect(body.data.correct_answers).toBe(10);
    for (const row of insertedRows()) expect(row.is_correct).toBe(true);
  });

  it('scores a partially-forged submission from the bank, not the claim (7 real correct of 10, claimed 10)', async () => {
    const res = await post(armed(10, 7, { claim: 'all-true' }));
    const body = await res.json();
    expect(body.data.score_percent).toBe(70);
    expect(body.data.correct_answers).toBe(7);
  });

  it('treats a forged question_id with no bank row as INCORRECT, never as the claim', async () => {
    const c = buildCase(4, 4); // all four genuinely correct …
    // … then the client appends a fifth answer for a question that does not exist.
    c.responses.push({
      question_id: 'q-does-not-exist',
      selected_answer_index: 0,
      is_correct: true,
      time_taken_seconds: NORMAL_SECONDS,
      topic: null,
      difficulty: 2,
      bloom_level: 'understand',
    });
    const res = await post(arm(c));
    const body = await res.json();
    // 4 of 5 resolvable-and-correct → Math.round((4/5)*100) = 80
    expect(body.data.correct_answers).toBe(4);
    expect(body.data.total_questions).toBe(5);
    expect(body.data.score_percent).toBe(80);

    const rows = insertedRows();
    expect(rows[4].is_correct).toBe(false);
    expect(rows[4].correct_index).toBeNull();
  });

  it('scores 0 when the question_bank lookup returns nothing at all (unresolvable != trusted)', async () => {
    const c = buildCase(10, 10, { claim: 'all-true' });
    setResult('question_bank.select', { data: [], error: null });
    const res = await post(c.responses);
    const body = await res.json();
    expect(body.data.score_percent).toBe(0);
  });

  it('scores 0 when the question_bank lookup ERRORS (fail-closed, not fail-to-client)', async () => {
    const c = buildCase(10, 10, { claim: 'all-true' });
    setResult('question_bank.select', { data: null, error: { message: 'bank read exploded' } });
    const res = await post(c.responses);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.score_percent).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — P1 score formula', () => {
  it('computes Math.round((7/10)*100) = 70 for 7 server-verified correct of 10', async () => {
    const res = await post(armed(10, 7));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(70);
    expect(body.data.correct_answers).toBe(7);
    expect(body.data.total_questions).toBe(10);
  });

  it('rounds 1/3 to exactly 33 (integer, never 33.33)', async () => {
    const res = await post(armed(3, 1));
    const body = await res.json();
    expect(body.data.score_percent).toBe(33);
    expect(Number.isInteger(body.data.score_percent)).toBe(true);
  });

  it('rounds 2/3 up to 67', async () => {
    const res = await post(armed(3, 2));
    const body = await res.json();
    expect(body.data.score_percent).toBe(67);
  });

  it('returns 0 for zero correct and 100 for all correct', async () => {
    let res = await post(armed(5, 0));
    expect((await res.json()).data.score_percent).toBe(0);

    recorded.length = 0;
    res = await post(armed(5, 5));
    expect((await res.json()).data.score_percent).toBe(100);
  });

  // AC-20 — P1 holds on the Rung-3 short form, not just the 15-item form.
  it('AC-20: a 10-item short form with 7 correct scores 70 (P1 unchanged at short lengths)', async () => {
    const res = await post(armed(10, 7));
    expect((await res.json()).data.score_percent).toBe(70);
  });

  it('AC-20: every ladder form length (15, 14, 12, 10) keeps Math.round((c/t)*100)', async () => {
    for (const total of [15, 14, 12, 10]) {
      recorded.length = 0;
      const correct = Math.floor(total / 2);
      const res = await post(armed(total, correct));
      const body = await res.json();
      expect(body.data.score_percent).toBe(Math.round((correct / total) * 100));
      expect(body.data.total_questions).toBe(total);
    }
  });

  // AC-29 — randomized property test over the SERVER-derived count.
  it('AC-29: score_percent === Math.round((serverCorrect/total)*100) across 200 random cases', async () => {
    let seed = 20260729;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let n = 0; n < 200; n++) {
      const total = 1 + Math.floor(rand() * 15);
      const correct = Math.floor(rand() * (total + 1));
      // Randomly pick which direction the client lies in — the answer must not
      // depend on it at all.
      const claim: Claim = (['honest', 'all-true', 'all-false'] as const)[
        Math.floor(rand() * 3)
      ];
      recorded.length = 0;
      const res = await post(armed(total, correct, { claim }));
      const body = await res.json();
      expect(body.data.correct_answers).toBe(correct);
      expect(body.data.total_questions).toBe(total);
      expect(body.data.score_percent).toBe(Math.round((correct / total) * 100));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — placement boundaries (AC-31, §7.5a)', () => {
  // These were 39/40/69/70 before the 5/6/4 blueprint landed. The blueprint
  // moves an average student from ~95% expected score to ~65%, so the old cuts
  // placed nearly everyone at 'hard'. Boundaries MOVED to 50/80 — not relaxed.
  const cases: Array<[number, string]> = [
    [49, 'easy'], // just below the medium boundary
    [50, 'medium'], // boundary: medium starts here
    [79, 'medium'], // just below the hard boundary
    [80, 'hard'], // boundary: hard starts here
  ];

  for (const [correct, expected] of cases) {
    it(`recommends "${expected}" at exactly ${correct}%`, async () => {
      const res = await post(armed(100, correct));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.score_percent).toBe(correct);
      expect(body.data.recommended_difficulty).toBe(expected);
      expect(body.data.placement_confidence).toBe('normal');
    });
  }

  it('exports the boundary constants from the shared lib so route and tests cannot drift apart', async () => {
    // NOT imported from the route module: a Next.js 16 App Router `route.ts`
    // may export only handlers + fixed segment-config keys, so a constant
    // exported there fails `next build`. The shared leaf is the single source.
    const { DIAGNOSTIC_PLACEMENT_THRESHOLDS } = await import(
      '@alfanumrik/lib/diagnostic/placement'
    );
    expect(DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium).toBe(50);
    expect(DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard).toBe(80);
  });

  it('the route module exports ONLY POST (a stray export breaks `next build`)', async () => {
    const mod = await import('@/app/api/diagnostic/complete/route');
    // Next.js 16 types route-module exports against a closed index signature:
    // any non-handler, non-segment-config export is `never` and fails the build.
    const ALLOWED = new Set([
      'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
      'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
      'preferredRegion', 'maxDuration', 'generateStaticParams',
    ]);
    const stray = Object.keys(mod).filter((k) => !ALLOWED.has(k));
    expect(stray).toEqual([]);
  });

  it('server placement cuts and client result thresholds are the SAME values', async () => {
    // The two used to be independent literals ({medium:50,hard:80} on the
    // server, {strong:80,mid:50} on the client) with nothing asserting they
    // agreed — a drift would have made the encouragement badge contradict the
    // server's own recommendation. Both now read one export.
    const { DIAGNOSTIC_PLACEMENT_THRESHOLDS } = await import(
      '@alfanumrik/lib/diagnostic/placement'
    );
    const { RESULT_THRESHOLDS } = await import('@/app/diagnostic/copy');

    expect(RESULT_THRESHOLDS.mid).toBe(DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium);
    expect(RESULT_THRESHOLDS.strong).toBe(DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard);

    // And the client copy module must not re-declare the numbers as literals.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/diagnostic/copy.ts'),
      'utf-8',
    );
    const decl = src.slice(src.indexOf('export const RESULT_THRESHOLDS'));
    const body = decl.slice(0, decl.indexOf('}') + 1);
    expect(body).toContain('DIAGNOSTIC_PLACEMENT_THRESHOLDS');
    expect(body).not.toMatch(/\b(50|80)\b/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — C2 speed-run placement guard (AC-30)', () => {
  it('forces medium + low confidence when avg time per question is under 3s, even at 100%', async () => {
    const res = await post(armed(15, 15, { seconds: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The score itself is NOT suppressed — the diagnostic is XP-neutral, there
    // is nothing to reject. Only the placement is disarmed.
    expect(body.data.score_percent).toBe(100);
    expect(body.data.recommended_difficulty).toBe('medium');
    expect(body.data.placement_confidence).toBe('low');
  });

  it('forces medium + low confidence at 0% too (the guard is score-independent)', async () => {
    const res = await post(armed(15, 0, { seconds: 1 }));
    const body = await res.json();
    expect(body.data.score_percent).toBe(0);
    expect(body.data.recommended_difficulty).toBe('medium');
    expect(body.data.placement_confidence).toBe('low');
  });

  it('exactly 3s average is NOT a speed run (boundary is strictly-less-than)', async () => {
    const res = await post(armed(15, 15, { seconds: 3 }));
    const body = await res.json();
    expect(body.data.placement_confidence).toBe('normal');
    expect(body.data.recommended_difficulty).toBe('hard');
  });

  it('writes placement_confidence into the diagnostic_assessments summary', async () => {
    await post(armed(15, 15, { seconds: 1 }));
    const updates = queriesFor('diagnostic_assessments', 'update');
    expect(updates.length).toBe(1);
    const nextPath = (updates[0].payload as Record<string, unknown>).next_path as Record<
      string,
      unknown
    >;
    expect(nextPath.placement_confidence).toBe('low');
    expect(nextPath.recommended_difficulty).toBe('medium');
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — XP neutrality (AC-32, P2 untouched)', () => {
  // ⚠️ AC-32 IS ABOUT XP, NOT ABOUT RPCs IN GENERAL.
  //
  // This block used to assert `expect(mockRpc).not.toHaveBeenCalled()` — "no
  // RPC at all". That was a true statement about the route in 2026-07 and a
  // WRONG statement of the invariant. Phase 5D (2026-08-24) makes the route
  // call `update_learner_state_post_quiz` to seed `concept_mastery`, which
  // awards no XP, touches no `students` row and creates no `quiz_sessions`
  // row — i.e. it does not violate AC-32 at all.
  //
  // The assertions below therefore name the XP-bearing RPCs explicitly rather
  // than banning the whole mechanism. The topic-bearing counterpart of this
  // test (where the mastery RPC actually fires) lives in the Phase 5D block
  // further down; the fixtures HERE carry no `topic_id`, so nothing fires.
  const XP_BEARING_RPCS = [
    'atomic_quiz_profile_update',
    'submit_quiz_results',
    'submit_quiz_results_v2',
    'award_xp',
  ];

  it('never calls atomic_quiz_profile_update or any other XP-bearing RPC', async () => {
    const res = await post(armed(15, 15));
    expect(res.status).toBe(200);
    for (const call of mockRpc.mock.calls) {
      expect(XP_BEARING_RPCS).not.toContain(call[0]);
    }
  });

  it('calls no RPC at all when no question carries a topic_id (nothing to attribute mastery to)', async () => {
    // The default fixture bank rows have no topic_id — the exact shape of the
    // ~9.5% of reachable question_bank rows that still have a NULL topic.
    const res = await post(armed(15, 15));
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('writes no XP field into any diagnostic table payload', async () => {
    await post(armed(15, 12));
    const payloads = recorded
      .filter((r) => r.op === 'insert' || r.op === 'update')
      .flatMap((r) => (Array.isArray(r.payload) ? r.payload : [r.payload]))
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');

    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      for (const key of Object.keys(p)) {
        expect(key).not.toMatch(/xp|level|streak/i);
      }
    }
  });

  it('touches no XP-bearing table', async () => {
    await post(armed(15, 12));
    const tables = new Set(recorded.map((r) => r.table));
    for (const forbidden of ['quiz_sessions', 'student_learning_profiles', 'students_xp']) {
      expect(tables.has(forbidden)).toBe(false);
    }
    // `students` is read (id lookup) but never written.
    expect(queriesFor('students', 'update').length).toBe(0);
    expect(queriesFor('students', 'insert').length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/complete — response envelope', () => {
  it('returns every field the /diagnostic page expects', async () => {
    const res = await post(armed(4, 2));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.session_id).toBe(SESSION_ID);
    expect(body.data.score_percent).toBe(50);
    expect(body.data.correct_answers).toBe(2);
    expect(body.data.total_questions).toBe(4);
    expect(Array.isArray(body.data.weak_topics)).toBe(true);
    expect(Array.isArray(body.data.strong_topics)).toBe(true);
    expect(['easy', 'medium', 'hard']).toContain(body.data.recommended_difficulty);
    expect(['low', 'normal']).toContain(body.data.placement_confidence);
  });
});

describe('POST /api/diagnostic/complete — 409 on already-completed assessment', () => {
  it('returns 409 ALREADY_COMPLETED and never touches diagnostic_responses', async () => {
    setResult('diagnostic_assessments.select', {
      data: { id: SESSION_ID, is_completed: true },
      error: null,
    });

    const res = await post(armed(4, 2));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('ALREADY_COMPLETED');

    // Idempotency guard: no delete, no insert, no summary update
    expect(queriesFor('diagnostic_responses', 'delete').length).toBe(0);
    expect(queriesFor('diagnostic_responses', 'insert').length).toBe(0);
    expect(queriesFor('diagnostic_assessments', 'update').length).toBe(0);
  });
});

describe('POST /api/diagnostic/complete — delete-then-insert (retry safety)', () => {
  it('deletes prior responses for the assessment BEFORE inserting the new batch', async () => {
    const res = await post(armed(4, 2));
    expect(res.status).toBe(200);

    const deleteIdx = recorded.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'delete'
    );
    const insertIdx = recorded.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'insert'
    );
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(insertIdx);

    // Delete is scoped to THIS assessment only
    expect(recorded[deleteIdx].filters).toContainEqual(['eq', 'assessment_id', SESSION_ID]);

    // Insert carries exactly one row per response, all bound to the assessment
    const rows = recorded[insertIdx].payload as Array<Record<string, unknown>>;
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.assessment_id).toBe(SESSION_ID);
      expect(row.student_id).toBe(STUDENT_ID);
    }
  });

  it('a retry (second submit while still incomplete) re-runs delete-then-insert — no duplicate accumulation path', async () => {
    await post(armed(4, 2));
    // Simulate retry: assessment still open (e.g. summary update failed earlier)
    const before = recorded.length;
    const res = await post(armed(4, 3));
    expect(res.status).toBe(200);

    const secondRun = recorded.slice(before);
    const deleteIdx = secondRun.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'delete'
    );
    const insertIdx = secondRun.findIndex(
      (r) => r.table === 'diagnostic_responses' && r.op === 'insert'
    );
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(insertIdx);
  });
});

describe('POST /api/diagnostic/complete — summary write to diagnostic_assessments', () => {
  it('marks the assessment complete with the P1 score in raw_score_pct', async () => {
    const res = await post(armed(10, 8));
    expect(res.status).toBe(200);

    const updates = queriesFor('diagnostic_assessments', 'update');
    expect(updates.length).toBe(1);
    const payload = updates[0].payload as Record<string, unknown>;
    expect(payload.is_completed).toBe(true);
    expect(payload.raw_score_pct).toBe(80);
    expect(payload.total_questions).toBe(10);
    expect(payload.correct_answers).toBe(8);
    expect((payload.next_path as Record<string, unknown>).recommended_difficulty).toBe('hard');
    // Update is scoped to this assessment AND this student (ownership)
    expect(updates[0].filters).toContainEqual(['eq', 'id', SESSION_ID]);
    expect(updates[0].filters).toContainEqual(['eq', 'student_id', STUDENT_ID]);
  });

  it('writes the SERVER-derived correct count, not the client claim, into raw_score_pct', async () => {
    await post(armed(10, 3, { claim: 'all-true' }));
    const payload = queriesFor('diagnostic_assessments', 'update')[0].payload as Record<
      string,
      unknown
    >;
    expect(payload.correct_answers).toBe(3);
    expect(payload.raw_score_pct).toBe(30);
  });

  it('still returns 200 with the score when the summary update fails (responses are saved)', async () => {
    setResult('diagnostic_assessments.update', {
      data: null,
      error: { message: 'transient write failure' },
    });
    const res = await post(armed(4, 2));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(50);
  });
});

describe('POST /api/diagnostic/complete — error paths', () => {
  it('returns 500 INSERT_ERROR and skips the summary update when the response insert fails', async () => {
    setResult('diagnostic_responses.insert', {
      data: null,
      error: { message: 'insert exploded' },
    });
    const res = await post(armed(4, 2));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('INSERT_ERROR');
    expect(queriesFor('diagnostic_assessments', 'update').length).toBe(0);
  });

  it('returns 404 SESSION_NOT_FOUND when the assessment does not belong to the student', async () => {
    setResult('diagnostic_assessments.select', {
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });
    const res = await post(armed(4, 2));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 404 NO_STUDENT when no student profile exists for the auth user', async () => {
    setResult('students.select', { data: null, error: { message: 'No rows' } });
    const res = await post(armed(4, 2));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_STUDENT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 5 (2026-08-24) — CEO defect #4: "After diagnostic test completion it
// does not adapt to strengthen the student upon wrong answers. Student shall
// also know why was the answer incorrect."
//
// Three things were broken, all pinned below:
//   5A  `question_results` — the route returned only aggregates, so the results
//       screen had nothing per-question to render an explanation against, and
//       `placement_confidence` (returned since day one) was dropped by the
//       client type.
//   5C  `weak_topics` / `strong_topics` were HARDCODED `[]`, which is why
//       "Areas to strengthen" had never rendered in production.
//   5D  the placement was a terminal write — `next_path` had zero readers and
//       nothing fed `concept_mastery`.
// ══════════════════════════════════════════════════════════════════════════════

/** Bank row shape once topic metadata is attached (the real column set). */
interface TopicBankRow extends BankRow {
  topic_id: string | null;
  bloom_level: string | null;
  difficulty: number | null;
}

const TOPIC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TOPIC_B = 'bbbbbbbb-0000-4000-8000-000000000002';

/**
 * Build a matched (responses, question_bank, curriculum_topics) triple where
 * each entry of `spec` is `[topicId, correctCount, wrongCount]`.
 */
function armTopics(
  spec: Array<[topicId: string | null, correct: number, wrong: number]>,
  opts: {
    seconds?: number;
    titles?: Record<string, { title: string | null; title_hi: string | null }>;
  } = {},
) {
  const seconds = opts.seconds ?? NORMAL_SECONDS;
  const responses: Array<Record<string, unknown>> = [];
  const bank: TopicBankRow[] = [];
  let n = 0;

  for (const [topicId, correct, wrong] of spec) {
    for (let i = 0; i < correct + wrong; i++) {
      const id = `tq-${n++}`;
      const selected = i % 4;
      const shouldBeCorrect = i < correct;
      bank.push({
        ...makeBankRow(id, shouldBeCorrect ? selected : (selected + 1) % 4),
        topic_id: topicId,
        bloom_level: 'understand',
        difficulty: 2,
      });
      responses.push({
        question_id: id,
        selected_answer_index: selected,
        is_correct: shouldBeCorrect,
        time_taken_seconds: seconds,
        // The CLIENT topic field is deliberately garbage here: the route must
        // key on question_bank.topic_id and never on this.
        topic: 'client-supplied-nonsense',
        difficulty: 9,
        bloom_level: 'create',
      });
    }
  }

  setResult('question_bank.select', { data: bank, error: null });

  const defaultTitles: Record<string, { title: string | null; title_hi: string | null }> = {
    [TOPIC_A]: { title: 'Linear Equations', title_hi: 'रैखिक समीकरण' },
    [TOPIC_B]: { title: 'Trigonometry', title_hi: 'त्रिकोणमिति' },
  };
  const titles = opts.titles ?? defaultTitles;
  mockGetTopicTitlesByIds.mockResolvedValue(
    Object.entries(titles).map(([id, t]) => ({ id, ...t })),
  );

  return responses;
}

function masteryCalls() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'update_learner_state_post_quiz');
}

// ── 5A — the student is finally told something ────────────────────────────────

describe('POST /api/diagnostic/complete — 5A per-question results', () => {
  it('returns one question_results entry per response, in served order', async () => {
    const res = await post(armed(6, 4));
    const body = await res.json();
    expect(Array.isArray(body.data.question_results)).toBe(true);
    expect(body.data.question_results.length).toBe(6);
    expect(
      body.data.question_results.map((r: { question_number: number }) => r.question_number),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      body.data.question_results.map((r: { question_id: string }) => r.question_id),
    ).toEqual(['q-0', 'q-1', 'q-2', 'q-3', 'q-4', 'q-5']);
  });

  it('question_results.is_correct is the SERVER verdict, never the client claim', async () => {
    // Client claims all 10 correct; only 3 really are.
    const res = await post(armed(10, 3, { claim: 'all-true' }));
    const body = await res.json();
    const flags = body.data.question_results.map((r: { is_correct: boolean }) => r.is_correct);
    expect(flags.filter(Boolean).length).toBe(3);
    // …and it agrees exactly with the headline count in the same response.
    expect(flags.filter(Boolean).length).toBe(body.data.correct_answers);
  });

  it('the per-question verdicts can never contradict the P1 headline score', async () => {
    for (const [total, correct] of [[15, 0], [15, 15], [12, 5], [10, 7]] as const) {
      recorded.length = 0;
      const res = await post(armed(total, correct));
      const body = await res.json();
      const derivedCorrect = body.data.question_results.filter(
        (r: { is_correct: boolean }) => r.is_correct,
      ).length;
      expect(derivedCorrect).toBe(body.data.correct_answers);
      expect(body.data.score_percent).toBe(Math.round((derivedCorrect / total) * 100));
    }
  });

  it('carries the authoritative correct_index and the student index for the review UI', async () => {
    const res = await post(armed(4, 2));
    const body = await res.json();
    for (const r of body.data.question_results) {
      expect(typeof r.selected_index).toBe('number');
      expect(typeof r.correct_index).toBe('number');
      expect(r.is_correct).toBe(r.selected_index === r.correct_index);
    }
  });

  it('an unresolvable question_id yields a null correct_index and is_correct false (never a green row)', async () => {
    const c = buildCase(3, 3);
    c.responses.push({
      question_id: 'ghost',
      selected_answer_index: 1,
      is_correct: true,
      time_taken_seconds: NORMAL_SECONDS,
      topic: null,
      difficulty: 2,
      bloom_level: 'understand',
    });
    const res = await post(arm(c));
    const body = await res.json();
    const ghost = body.data.question_results[3];
    expect(ghost.question_id).toBe('ghost');
    expect(ghost.correct_index).toBeNull();
    expect(ghost.is_correct).toBe(false);
  });

  it('does NOT re-send question text, options or explanations (P10 — the client already has them)', async () => {
    const res = await post(armed(4, 2));
    const body = await res.json();
    for (const r of body.data.question_results) {
      expect(Object.keys(r).sort()).toEqual([
        'correct_index',
        'is_correct',
        'question_id',
        'question_number',
        'selected_index',
      ]);
    }
  });

  it('placement_confidence reaches the client on both the normal and low paths', async () => {
    let body = await (await post(armed(10, 8))).json();
    expect(body.data.placement_confidence).toBe('normal');

    recorded.length = 0;
    body = await (await post(armed(10, 8, { seconds: 1 }))).json();
    expect(body.data.placement_confidence).toBe('low');
  });
});

// ── 5C — weak/strong topics are derived, never a literal ──────────────────────

describe('POST /api/diagnostic/complete — 5C derived weak/strong topics', () => {
  it('THE PIN: weak_topics is derived from real per-topic accuracy, not the old hardcoded []', async () => {
    // Topic A: 0 correct / 3 wrong -> 0%   -> weak
    // Topic B: 4 correct / 0 wrong -> 100% -> strong
    const res = await post(armTopics([[TOPIC_A, 0, 3], [TOPIC_B, 4, 0]]));
    const body = await res.json();
    expect(body.data.weak_topics).toEqual(['Linear Equations']);
    expect(body.data.strong_topics).toEqual(['Trigonometry']);
  });

  it('keys on question_bank.topic_id, NOT the client-supplied topic field', async () => {
    const res = await post(armTopics([[TOPIC_A, 0, 2]]));
    const body = await res.json();
    expect(body.data.weak_topics).toEqual(['Linear Equations']);
    expect(JSON.stringify(body.data)).not.toContain('client-supplied-nonsense');
  });

  it('P7: returns a Hindi sibling list of the same length for both lists', async () => {
    const res = await post(armTopics([[TOPIC_A, 0, 2], [TOPIC_B, 3, 0]]));
    const body = await res.json();
    expect(body.data.weak_topics_hi).toEqual(['रैखिक समीकरण']);
    expect(body.data.strong_topics_hi).toEqual(['त्रिकोणमिति']);
    expect(body.data.weak_topics_hi.length).toBe(body.data.weak_topics.length);
    expect(body.data.strong_topics_hi.length).toBe(body.data.strong_topics.length);
  });

  it('OMITS a NULL topic_id rather than fabricating a label', async () => {
    const res = await post(armTopics([[null, 0, 4], [TOPIC_A, 0, 2]]));
    const body = await res.json();
    expect(body.data.weak_topics).toEqual(['Linear Equations']);
  });

  it('OMITS a topic whose curriculum_topics title cannot be resolved (never renders a UUID)', async () => {
    const res = await post(
      armTopics([[TOPIC_A, 0, 3], [TOPIC_B, 0, 3]], {
        titles: { [TOPIC_A]: { title: 'Linear Equations', title_hi: 'रैखिक समीकरण' } },
      }),
    );
    const body = await res.json();
    expect(body.data.weak_topics).toEqual(['Linear Equations']);
    for (const label of [...body.data.weak_topics, ...body.data.strong_topics]) {
      expect(label).not.toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('still returns 200 with the score when the curriculum_topics lookup errors', async () => {
    const responses = armTopics([[TOPIC_A, 0, 4]]);
    // getTopicTitlesByIds THROWS on a genuine DB error (it does not return an
    // error tuple) — the route must absorb that, not 500 the student.
    mockGetTopicTitlesByIds.mockRejectedValue(new Error('topics read exploded'));
    const res = await post(responses);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(0);
    expect(body.data.weak_topics).toEqual([]);
  });

  it('C5: suppresses BOTH lists on a low-confidence speed run', async () => {
    const res = await post(armTopics([[TOPIC_A, 0, 4], [TOPIC_B, 4, 0]], { seconds: 1 }));
    const body = await res.json();
    expect(body.data.placement_confidence).toBe('low');
    expect(body.data.weak_topics).toEqual([]);
    expect(body.data.strong_topics).toEqual([]);
    // …but the per-question review the client renders is NOT suppressed.
    expect(body.data.question_results.length).toBe(8);
  });

  it('skips the topic-title lookup entirely when no question has a topic_id', async () => {
    await post(armed(10, 5));
    expect(mockGetTopicTitlesByIds).not.toHaveBeenCalled();
  });

  it('never reads curriculum_topics inline — it goes through the cached taxonomy reader (ADR-007)', async () => {
    await post(armTopics([[TOPIC_A, 0, 2]]));
    expect(mockGetTopicTitlesByIds).toHaveBeenCalledWith([TOPIC_A]);
    expect(queriesFor('curriculum_topics', 'select').length).toBe(0);
  });

  it('de-duplicates topic ids before the lookup', async () => {
    await post(armTopics([[TOPIC_A, 3, 3]]));
    expect(mockGetTopicTitlesByIds).toHaveBeenCalledWith([TOPIC_A]);
  });
});

// ── 5D — the diagnostic feeds the canonical mastery spine ─────────────────────

describe('POST /api/diagnostic/complete — 5D mastery seeding', () => {
  it('calls update_learner_state_post_quiz exactly once per answered topic-resolved question', async () => {
    await post(armTopics([[TOPIC_A, 1, 2], [TOPIC_B, 2, 0]]));
    expect(masteryCalls().length).toBe(5);
  });

  it('skips questions with a NULL topic_id — no call, and no crash', async () => {
    await post(armTopics([[null, 2, 2], [TOPIC_A, 1, 1]]));
    const calls = masteryCalls();
    expect(calls.length).toBe(2);
    for (const c of calls) {
      expect((c[1] as Record<string, unknown>).p_topic_id).toBe(TOPIC_A);
    }
  });

  it('passes the SERVER-derived correctness, the bank topic, and the bank bloom level', async () => {
    await post(armTopics([[TOPIC_A, 1, 1]]));
    const args = masteryCalls().map((c) => c[1] as Record<string, unknown>);
    expect(args.map((a) => a.p_is_correct)).toEqual([true, false]);
    for (const a of args) {
      expect(a.p_student_id).toBe(STUDENT_ID);
      expect(a.p_topic_id).toBe(TOPIC_A);
      // Bloom from question_bank ('understand'), NOT the client's 'create'.
      expect(a.p_bloom_level).toBe('understand');
    }
  });

  it('passes p_difficulty as an INTEGER — a TEXT value would 42883 before the function body runs', async () => {
    await post(armTopics([[TOPIC_A, 2, 0]]));
    for (const c of masteryCalls()) {
      const d = (c[1] as Record<string, unknown>).p_difficulty;
      expect(typeof d).toBe('number');
      expect(Number.isInteger(d as number)).toBe(true);
      // …and it is the BANK difficulty (2), not the client claimed 9.
      expect(d).toBe(2);
    }
  });

  it('passes the DAMPED diagnostic BKT priors, not the RPC defaults', async () => {
    const { DIAGNOSTIC_BKT_PARAMS, QUIZ_BKT_PARAM_DEFAULTS } = await import(
      '@alfanumrik/lib/diagnostic/evidence'
    );
    await post(armTopics([[TOPIC_A, 1, 1]]));
    for (const c of masteryCalls()) {
      const a = c[1] as Record<string, unknown>;
      expect(a.p_p_learn).toBe(DIAGNOSTIC_BKT_PARAMS.p_p_learn);
      expect(a.p_p_slip).toBe(DIAGNOSTIC_BKT_PARAMS.p_p_slip);
      expect(a.p_p_guess).toBe(DIAGNOSTIC_BKT_PARAMS.p_p_guess);
      // Explicitly NOT the quiz defaults — a diagnostic is a cold-start
      // estimate, not a practice attempt.
      expect(a.p_p_learn).not.toBe(QUIZ_BKT_PARAM_DEFAULTS.p_p_learn);
    }
  });

  it('does NOT reuse p_hint_level as the damping dial (a diagnostic shows no hints)', async () => {
    await post(armTopics([[TOPIC_A, 1, 1]]));
    for (const c of masteryCalls()) {
      const a = c[1] as Record<string, unknown>;
      // Absent/null => the RPC treats the attempt as independent, which is the
      // truth. Routing it into hinted_attempts to buy damping would be a
      // semantic lie in a column whose whole job is independence reporting.
      expect(a.p_hint_level ?? null).toBeNull();
    }
  });

  it('C5: writes NOTHING to the spine on a low-confidence speed run', async () => {
    const res = await post(armTopics([[TOPIC_A, 2, 2]], { seconds: 1 }));
    expect((await res.json()).data.placement_confidence).toBe('low');
    expect(masteryCalls().length).toBe(0);
  });

  it('RESILIENCE: a mastery-write error does not fail the completion response', async () => {
    const responses = armTopics([[TOPIC_A, 2, 2]]);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'mastery write exploded' } });
    const res = await post(responses);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(50);
    expect(body.data.question_results.length).toBe(4);
  });

  it('RESILIENCE: a THROWN mastery error does not fail the completion response either', async () => {
    const responses = armTopics([[TOPIC_A, 4, 0]]);
    mockRpc.mockRejectedValue(new Error('connection reset'));
    const res = await post(responses);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.score_percent).toBe(100);
  });

  it('RESILIENCE: one failing write does not abort the remaining writes', async () => {
    const responses = armTopics([[TOPIC_A, 2, 2]]);
    let n = 0;
    mockRpc.mockImplementation(() => {
      n++;
      return n === 2
        ? Promise.reject(new Error('transient'))
        : Promise.resolve({ data: null, error: null });
    });
    const res = await post(responses);
    expect(res.status).toBe(200);
    expect(masteryCalls().length).toBe(4);
  });

  it('P2: the mastery write is the ONLY rpc — no XP-bearing RPC is ever reached', async () => {
    await post(armTopics([[TOPIC_A, 3, 1]]));
    const names = new Set(mockRpc.mock.calls.map((c) => c[0]));
    expect(names).toEqual(new Set(['update_learner_state_post_quiz']));
  });

  it('P2: still touches no XP-bearing table on the topic-bearing path', async () => {
    await post(armTopics([[TOPIC_A, 3, 1]]));
    const tables = new Set(recorded.map((r) => r.table));
    for (const forbidden of ['quiz_sessions', 'student_learning_profiles']) {
      expect(tables.has(forbidden)).toBe(false);
    }
    expect(queriesFor('students', 'update').length).toBe(0);
  });

  it('seeds the spine only AFTER the responses are durably inserted', async () => {
    const responses = armTopics([[TOPIC_A, 2, 0]]);
    setResult('diagnostic_responses.insert', {
      data: null,
      error: { message: 'insert exploded' },
    });
    const res = await post(responses);
    expect(res.status).toBe(500);
    // A submission that did not persist must not move mastery.
    expect(masteryCalls().length).toBe(0);
  });
});
