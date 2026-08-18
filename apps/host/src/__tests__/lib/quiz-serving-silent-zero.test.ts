/**
 * getQuizQuestions() — the truthy-`[]` silent zero, and the Tier-0 floor the fix
 * made reachable (P6, SEV1 2026-08-11).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The RPC ladder short-circuited on `if (!error && data)`.
 * `get_quiz_questions` returns `COALESCE(jsonb_agg(q), '[]'::JSONB)` and filters
 * `is_verified = true`. **An empty array is truthy in JavaScript.** So a chapter
 * whose 40 questions were valid but merely UNVERIFIED came back as `[]`, the
 * guard accepted it, and the student was served a quiz with ZERO questions — the
 * `question_bank` fallback below it, which does NOT filter on `is_verified`,
 * never ran. A failed/narrow read rendered as "no content", the platform's
 * dominant defect class.
 *
 * The RPC applies a strictly NARROWER filter than the fallback, so "the RPC
 * found none" does not imply "the bank has none". Only a NON-EMPTY RPC result
 * may short-circuit the ladder.
 *
 * ── THE OTHER HALF ──────────────────────────────────────────────────────────
 * Making the fallback reachable made it dangerous: it previously filtered on
 * `is_active` alone, so a soft-deleted, draft, or verifier-DISPROVED row was
 * servable there. A question the automated NCERT verifier disproved must never
 * reach a student, on any rung. That floor is now enforced on the fallback query
 * and is pinned here by inspecting the predicates the function actually issues —
 * a fake that "helpfully" honours nothing would let the floor be deleted
 * silently.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED ───────────────────────────────────────
 * `is_verified` is NOT filtered on the fallback rung. That is the documented,
 * intentional posture (neither this rung nor either RPC rung above it has ever
 * gated serving on the human SME flag), and adding it would recreate the very
 * empty quiz this fix removes. Whether SME sign-off should gate serving at all
 * is a CEO decision, not a test's.
 *
 * P5: grades are strings throughout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Recording query-builder double ─────────────────────────────────────── */

interface Predicate { method: string; args: unknown[] }
interface RecordedQuery { table: string; columns: string; predicates: Predicate[] }

const { db } = vi.hoisted(() => ({
  db: {
    /** RPC name -> { data, error }. */
    rpc: {} as Record<string, { data: unknown; error: unknown }>,
    rpcCalls: [] as Array<{ name: string; params: unknown }>,
    /** table -> rows returned regardless of predicates (predicates are RECORDED,
     *  not applied — the assertions are about which predicates were ISSUED). */
    tables: {} as Record<string, { data: unknown; error: unknown }>,
    queries: [] as RecordedQuery[],
    /** auth.getUser() result — null user skips the dedup history read. */
    user: null as unknown,
  },
}));

vi.mock('@alfanumrik/lib/supabase-client', () => {
  // `limit` is CHAINABLE here, exactly as in PostgREST — the real builder is a
  // thenable that keeps accepting filters after `.limit()`, and getQuizQuestions
  // relies on that (it appends `.neq('verification_state', …)` after `.limit()`).
  // A fake whose `.limit()` resolved to a plain promise would make the Tier-0
  // floor untestable and would have hidden the ordering entirely.
  const CHAINABLE = ['eq', 'neq', 'is', 'or', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'not', 'limit', 'range'];

  function builder(table: string, columns: string) {
    const record: RecordedQuery = { table, columns, predicates: [] };
    db.queries.push(record);
    const result = () => db.tables[table] ?? { data: [], error: null };

    const api: Record<string, unknown> = {
      maybeSingle: () => {
        const r = result();
        return Promise.resolve({ data: (r.data as unknown[])?.[0] ?? null, error: r.error });
      },
      single: () => {
        const r = result();
        return Promise.resolve({ data: (r.data as unknown[])?.[0] ?? null, error: r.error });
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(onFulfilled, onRejected),
    };
    for (const m of CHAINABLE) {
      api[m] = (...args: unknown[]) => {
        record.predicates.push({ method: m, args });
        return api;
      };
    }
    return api;
  }

  const supabase = {
    from: (table: string) => ({ select: (columns = '*') => builder(table, columns) }),
    rpc: async (name: string, params: unknown) => {
      db.rpcCalls.push({ name, params });
      const r = db.rpc[name];
      if (!r) throw new Error(`function ${name} does not exist`);
      return r;
    },
    auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
  };

  return { supabase, supabaseUrl: 'http://localhost', supabaseAnonKey: 'anon' };
});

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: async () => false,
  ADAPTIVE_LIVE_SELECTION_FLAGS: [],
  IRT_SELECTION_FLAGS: [],
}));

/* ── Fixtures — synthetic content only (P13) ────────────────────────────── */

let seq = 0;
function validQuestion(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `q-${seq}`,
    question_text: `Which of these is a prime number? (variant ${seq})`,
    question_hi: null,
    question_type: 'mcq',
    options: ['2', '4', '6', '8'],
    correct_answer_index: 0,
    explanation: 'A prime number has exactly two distinct positive divisors, one and itself.',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 1,
    ...overrides,
  };
}

/** The question_bank fallback query — the LAST recorded query on that table. */
function fallbackQuery(): RecordedQuery {
  const q = [...db.queries].reverse().find((x) => x.table === 'question_bank');
  expect(q, 'the question_bank fallback query never ran').toBeDefined();
  return q!;
}

function predicateArgs(q: RecordedQuery, method: string): unknown[][] {
  return q.predicates.filter((p) => p.method === method).map((p) => p.args);
}

async function getQuizQuestions(...args: Parameters<typeof import('@alfanumrik/lib/supabase')['getQuizQuestions']>) {
  const mod = await import('@alfanumrik/lib/supabase');
  return mod.getQuizQuestions(...args);
}

beforeEach(() => {
  seq = 0;
  db.rpc = {};
  db.rpcCalls = [];
  db.tables = {};
  db.queries = [];
  db.user = null;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. The silent zero
// ════════════════════════════════════════════════════════════════════════════
describe('getQuizQuestions — an empty RPC result is NOT an answer', () => {
  it('RPC returns [] → the question_bank fallback RUNS and serves questions', async () => {
    db.rpc.get_quiz_questions = { data: [], error: null };
    db.tables.question_bank = {
      data: Array.from({ length: 5 }, () => validQuestion()),
      error: null,
    };

    const questions = await getQuizQuestions('science', '8', 5);

    expect(
      questions.length,
      'the RPC returned [] (truthy!) and the ladder short-circuited — a chapter ' +
        'with valid but unverified questions serves an EMPTY quiz',
    ).toBe(5);
    expect(db.queries.some((q) => q.table === 'question_bank')).toBe(true);
  });

  it('RPC returns a NON-empty result → it short-circuits (fallback does NOT run)', async () => {
    db.rpc.get_quiz_questions = {
      data: Array.from({ length: 3 }, () => validQuestion()),
      error: null,
    };
    db.tables.question_bank = { data: [validQuestion()], error: null };

    const questions = await getQuizQuestions('science', '8', 3);

    expect(questions).toHaveLength(3);
    expect(
      db.queries.some((q) => q.table === 'question_bank'),
      'a healthy non-empty RPC result must not trigger a second read',
    ).toBe(false);
  });

  it('RPC rows that ALL fail the P6 gate also fall through (not a silent zero either)', async () => {
    // Template markers — rejected by the canonical P6 gate.
    db.rpc.get_quiz_questions = {
      data: [validQuestion({ question_text: 'What is {{topic}}?' })],
      error: null,
    };
    db.tables.question_bank = {
      data: Array.from({ length: 4 }, () => validQuestion()),
      error: null,
    };

    const questions = await getQuizQuestions('science', '8', 4);
    expect(questions).toHaveLength(4);
  });

  it('the fallback re-runs the SAME P6 gate — it is not a relaxation', async () => {
    db.rpc.get_quiz_questions = { data: [], error: null };
    db.tables.question_bank = {
      data: [
        validQuestion(),
        validQuestion({ question_text: 'Fill in the [BLANK].' }),
        validQuestion({ options: ['2', '2', '4', '6'] }), // duplicate options
        validQuestion({ explanation: '' }),               // no explanation
        validQuestion({ correct_answer_index: 7 }),       // out of range
        validQuestion({ options: ['2', '4', '6'] }),      // only 3 options
      ],
      error: null,
    };

    const questions = await getQuizQuestions('science', '8', 10);
    expect(questions).toHaveLength(1);
    expect(questions[0].question_text).not.toContain('[BLANK]');
  });

  it('a MISSING RPC (older env) still reaches the fallback', async () => {
    // db.rpc has no entry → the double throws, exactly like a 404 from PostgREST.
    db.tables.question_bank = { data: [validQuestion(), validQuestion()], error: null };
    const questions = await getQuizQuestions('science', '8', 2);
    expect(questions).toHaveLength(2);
  });

  it('an RPC ERROR still reaches the fallback', async () => {
    db.rpc.get_quiz_questions = { data: null, error: { message: 'boom' } };
    db.tables.question_bank = { data: [validQuestion()], error: null };
    const questions = await getQuizQuestions('science', '8', 1);
    expect(questions).toHaveLength(1);
  });

  it('a genuinely empty bank returns [] — emptiness is still representable', async () => {
    db.rpc.get_quiz_questions = { data: [], error: null };
    db.tables.question_bank = { data: [], error: null };
    const questions = await getQuizQuestions('science', '8', 10);
    expect(questions).toEqual([]);
  });

  it('a FAILED fallback read throws — it never degrades to an empty quiz', async () => {
    db.rpc.get_quiz_questions = { data: [], error: null };
    db.tables.question_bank = { data: null, error: { message: 'connection reset' } };
    await expect(getQuizQuestions('science', '8', 10)).rejects.toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Tier-0 floor on the now-reachable fallback rung
// ════════════════════════════════════════════════════════════════════════════
describe('getQuizQuestions — the fallback enforces the never-serve floor', () => {
  beforeEach(() => {
    db.rpc.get_quiz_questions = { data: [], error: null };
    db.tables.question_bank = { data: [validQuestion()], error: null };
  });

  it('excludes EVERY verifier-disproved state', async () => {
    await getQuizQuestions('science', '8', 10);
    const excluded = predicateArgs(fallbackQuery(), 'neq')
      .filter(([col]) => col === 'verification_state')
      .map(([, value]) => value);

    // All three disproved states, not just the literal 'failed'. The CHECK
    // constraint was widened to six states by migration 20260510064952, and a
    // row mid-repair on a disproved question is still disproved.
    for (const state of ['failed', 'failed_fix_in_flight', 'failed_unfixable']) {
      expect(
        excluded,
        `a question in verification_state='${state}' is servable from the ` +
          `fallback — the verifier DISPROVED it and it must never reach a student`,
      ).toContain(state);
    }
  });

  it('excludes soft-deleted rows', async () => {
    await getQuizQuestions('science', '8', 10);
    expect(predicateArgs(fallbackQuery(), 'is')).toContainEqual(['deleted_at', null]);
  });

  it('excludes draft / review / archived content', async () => {
    await getQuizQuestions('science', '8', 10);
    const or = predicateArgs(fallbackQuery(), 'or').map(([expr]) => String(expr));
    expect(or.some((e) => e.includes('content_status'))).toBe(true);
    // Nullable with DEFAULT 'published' — a strict eq would drop every legacy
    // row carrying an explicit NULL and re-empty the quizzes this fix restores.
    expect(or.some((e) => e.includes('content_status.is.null'))).toBe(true);
    expect(or.some((e) => e.includes('content_status.eq.published'))).toBe(true);
  });

  it('still scopes to the requested subject, grade (STRING) and active rows', async () => {
    await getQuizQuestions('science', '8', 10);
    const eqs = predicateArgs(fallbackQuery(), 'eq');
    expect(eqs).toContainEqual(['subject', 'science']);
    expect(eqs).toContainEqual(['grade', '8']); // P5 — string, never 8
    expect(eqs).toContainEqual(['is_active', true]);
  });

  it('forwards an optional chapter filter to the fallback', async () => {
    await getQuizQuestions('science', '8', 10, null, 3);
    expect(predicateArgs(fallbackQuery(), 'eq')).toContainEqual(['chapter_number', 3]);
  });

  it('does NOT gate the fallback on is_verified (documented posture)', async () => {
    // The whole point of the fix: a chapter with 40 unverified-but-valid
    // questions must serve them. Re-adding this filter recreates the SEV1.
    await getQuizQuestions('science', '8', 10);
    const cols = fallbackQuery().predicates.flatMap((p) => p.args.slice(0, 1));
    expect(cols).not.toContain('is_verified');
  });

  it('never selects a column outside the serving projection', async () => {
    await getQuizQuestions('science', '8', 10);
    const cols = fallbackQuery().columns.split(',').map((c) => c.trim());
    // The answer key is served (the client marks answers), but nothing that
    // identifies a student or an internal workflow may ride along.
    for (const forbidden of ['student_id', 'created_by', 'verification_state', 'deleted_at']) {
      expect(cols).not.toContain(forbidden);
    }
  });
});
