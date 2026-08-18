/**
 * REG-388 — Tier-0 never-serve floor TOTALITY across the question-serving rungs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROPERTY
 * ═══════════════════════════════════════════════════════════════════════════
 * A row whose `verification_state` says the verifier DISPROVED it must never
 * reach a student — on any rung, under any fallback, at any pool size. There
 * is no availability argument that re-admits a question we have proven wrong;
 * spec §3.4 states this explicitly as the one predicate with no fallback rung.
 *
 * "Disproved" is THREE states, not one. The CHECK was widened from four to six
 * states by `20260510064952_qb_fixer.sql`:
 *
 *     'legacy_unverified', 'pending', 'verified',        <- not disproved
 *     'failed', 'failed_fix_in_flight', 'failed_unfixable' <- disproved
 *
 * `failed_fix_in_flight` is a row proven wrong and currently claimed by the
 * repair agent; `failed_unfixable` is proven wrong AND proven unrepairable.
 * Neither is an "in progress" state. Every downstream gate nevertheless kept
 * testing only the literal `'failed'` for three months, so both were servable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY *TOTALITY* IS THE THING WORTH PINNING
 * ═══════════════════════════════════════════════════════════════════════════
 * ai-engineer's audit found the verification floor existed in FIVE DIFFERENT
 * DIALECTS across the serving surface. Per-rung tests cannot catch that: each
 * rung's own test passes against its own dialect, and the defect lives in the
 * DISAGREEMENT between them. A student routed to rung 3 because rung 1 came
 * back thin gets a different safety guarantee than a student routed to rung 1,
 * and nothing in the codebase relates the two. This file is the cross-rung
 * relation.
 *
 * Migration `20260814000014_tiered_verification_serving_and_truthful_picker.sql`
 * unified FOUR of the five SQL/TS rungs. The fifth is recorded below as an
 * explicit, failing-when-fixed gap rather than papered over.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS PROVES — AND WHAT IT EXPLICITLY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * There is NO Postgres in this environment. These RPCs cannot be executed, so
 * this is a SOURCE-TEXT contract pin in the style the repo already uses for
 * SQL contracts (`__tests__/contract/select-quiz-questions-rag-verification-
 * gate.test.ts`) and for SQL/TS literal parity (REG-48).
 *
 * PROVES: every `question_bank` row-filter block inside the four rewritten
 * functions carries the disproved-state exclusion; the excluded set is
 * literally the same three states in all four; the TS client rung names the
 * identical three; and the set is exactly the disproved half of the CHECK.
 *
 * DOES NOT PROVE: that the predicate FUNCTIONS as an unconditional floor at
 * runtime (that it is not nested inside a conditional branch) — the
 * behavioural mirror for that lives in
 * `select-quiz-questions-rag-tier0-floor.test.ts`, and only for the RAG rung.
 * Also does not prove the deployed database matches these files.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');

const TIERED_MIGRATION = '20260814000014_tiered_verification_serving_and_truthful_picker.sql';
const CHECK_MIGRATION = '20260510064952_qb_fixer.sql';

/** The floor, as this test understands it. Every rung must agree with this. */
const DISPROVED = ['failed', 'failed_fix_in_flight', 'failed_unfixable'] as const;
const NOT_DISPROVED = ['legacy_unverified', 'pending', 'verified'] as const;

function executable(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function readMigration(file: string): string {
  return executable(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
}

const tieredSql = readMigration(TIERED_MIGRATION);

/** Extract a named function's dollar-quoted body from a migration. */
function functionBody(sql: string, name: string, occurrence = 0): string {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'gi');
  const hits = [...sql.matchAll(re)];
  const hit = hits[occurrence];
  if (!hit) throw new Error(`No CREATE #${occurrence} for public.${name}`);
  const from = sql.slice(hit.index);
  const open = /AS\s+(\$[A-Za-z_]*\$)/.exec(from);
  if (!open) throw new Error(`No dollar-quoted body for public.${name}`);
  const tag = open[1];
  const start = open.index + open[0].length;
  const end = from.indexOf(tag, start);
  if (end < 0) throw new Error(`Unterminated body for public.${name}`);
  return from.slice(start, end);
}

/**
 * The four rungs migration 20260814000014 rewrote. `get_quiz_questions` has
 * two overloads and BOTH are rewritten — leaving the 4-arg one un-floored
 * would just relocate the defect, so both are listed separately.
 */
const REWRITTEN_RUNGS: Array<{ label: string; body: string }> = [
  { label: 'get_quiz_questions (5-arg overload)', body: functionBody(tieredSql, 'get_quiz_questions', 0) },
  { label: 'get_quiz_questions (4-arg overload)', body: functionBody(tieredSql, 'get_quiz_questions', 1) },
  { label: 'select_quiz_questions_rag', body: functionBody(tieredSql, 'select_quiz_questions_rag') },
  { label: 'select_quiz_questions_v2', body: functionBody(tieredSql, 'select_quiz_questions_v2') },
];

/**
 * Split a function body into the row-filter blocks that read `question_bank`.
 * A block runs from a `question_bank` reference to the next clause boundary
 * that ends a WHERE (`ORDER BY`, `GROUP BY`, `LIMIT`, `)` of the enclosing
 * subquery, or the next `question_bank`), so one rung's predicates can never
 * satisfy another's assertion.
 */
function questionBankFilterBlocks(body: string): string[] {
  const parts = body.split(/\bquestion_bank\b/i).slice(1);
  return parts
    .map((p) => p.split(/\bORDER\s+BY\b|\bGROUP\s+BY\b/i)[0])
    // Only blocks that actually filter rows (i.e. carry a WHERE with the
    // baseline is_active predicate) are subject to the floor. A bare
    // `question_bank` mention in a comment-stripped DDL fragment is not.
    .filter((p) => /\bis_active\s*=\s*true\b/i.test(p));
}

const DISPROVED_NOT_IN = /verification_state\s+NOT\s+IN\s*\(([^)]*)\)/gi;

function statesIn(fragment: string): string[][] {
  const out: string[][] = [];
  for (const m of fragment.matchAll(DISPROVED_NOT_IN)) {
    out.push([...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]));
  }
  return out;
}

describe('REG-388: the disproved-state set is the disproved half of the CHECK constraint', () => {
  it('the CHECK really does allow exactly the six states this test partitions', () => {
    const checkSql = readMigration(CHECK_MIGRATION);
    const m = /check\s*\(\s*verification_state\s+in\s*\(([\s\S]*?)\)\s*\)/i.exec(checkSql);
    expect(m, `no verification_state CHECK found in ${CHECK_MIGRATION}`).toBeTruthy();
    const states = [...m![1].matchAll(/'([^']+)'/g)].map((s) => s[1]);
    expect(states.sort()).toEqual([...DISPROVED, ...NOT_DISPROVED].sort());
  });

  it('the two halves are disjoint and exhaustive (no state is silently unclassified)', () => {
    const all = [...DISPROVED, ...NOT_DISPROVED];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(6);
  });
});

describe('REG-388: every rewritten SQL serving rung applies the SAME three-state floor', () => {
  it('finds all four rewritten rungs (non-vacuity floor for everything below)', () => {
    expect(REWRITTEN_RUNGS.map((r) => r.label)).toHaveLength(4);
    REWRITTEN_RUNGS.forEach((r) => expect(r.body.length).toBeGreaterThan(200));
  });

  it.each(REWRITTEN_RUNGS)('$label: has at least one question_bank row-filter block', ({ body }) => {
    // Guards against the split heuristic silently matching nothing, which
    // would make every per-block assertion below vacuously true.
    expect(questionBankFilterBlocks(body).length).toBeGreaterThan(0);
  });

  it.each(REWRITTEN_RUNGS)(
    '$label: EVERY question_bank row-filter block excludes all three disproved states',
    ({ label, body }) => {
      const blocks = questionBankFilterBlocks(body);
      blocks.forEach((block, i) => {
        const sets = statesIn(block);

        if (sets.length === 0) {
          // A block may satisfy the floor IMPLICITLY by pinning
          // verification_state to a single NON-disproved state — an equality
          // is strictly narrower than the NOT IN, so the floor holds a
          // fortiori. `select_quiz_questions_rag`'s v_verified_pool COUNT
          // query is the real instance (`verification_state = 'verified'`),
          // and the migration says so in a comment. Accepting it is not a
          // weakening: the equality target is asserted to be in the
          // NOT_DISPROVED half, so pinning to `= 'failed'` would still fail.
          const eq = /verification_state\s*=\s*'([^']+)'/i.exec(block);
          expect(
            eq,
            `${label}: row-filter block #${i + 1} has NEITHER a ` +
              'verification_state NOT IN (...) NOR an equality pin — a disproved ' +
              'question can be served on this rung',
          ).toBeTruthy();
          expect(
            NOT_DISPROVED as readonly string[],
            `${label}: block #${i + 1} pins verification_state to a DISPROVED state`,
          ).toContain(eq![1]);
          return;
        }

        sets.forEach((set) => {
          expect(set.sort(), `${label}: block #${i + 1} excludes the wrong state set`).toEqual(
            [...DISPROVED].sort(),
          );
        });
      });
    },
  );

  it.each(REWRITTEN_RUNGS)(
    '$label: no rung silently narrows the floor back to the single literal `failed`',
    ({ body }) => {
      // The pre-fix dialect. `!=`/`<>` against the bare literal is the exact
      // shape that let two disproved states through for three months.
      expect(body).not.toMatch(/verification_state\s*(!=|<>)\s*'failed'/i);
    },
  );

  it('all four rungs agree LITERALLY — one set, not four coincidentally-equal ones', () => {
    const perRung = REWRITTEN_RUNGS.map(({ body }) =>
      JSON.stringify([...new Set(statesIn(body).map((s) => JSON.stringify([...s].sort())))].sort()),
    );
    expect(new Set(perRung).size, 'the rungs exclude different state sets from one another').toBe(1);
    expect(JSON.parse(perRung[0])).toEqual([JSON.stringify([...DISPROVED].sort())]);
  });

  it.each(REWRITTEN_RUNGS)(
    '$label: soft-deleted rows are excluded on every row-filter block too (rest of Tier-0)',
    ({ body }) => {
      questionBankFilterBlocks(body).forEach((block, i) => {
        expect(block, `row-filter block #${i + 1} is missing deleted_at IS NULL`).toMatch(
          /deleted_at\s+IS\s+NULL/i,
        );
      });
    },
  );
});

describe('REG-388: the TS client rung names the identical set (SQL/TS literal parity, REG-48 pattern)', () => {
  const libSource = readFileSync(
    resolve(REPO_ROOT, 'packages', 'lib', 'src', 'supabase.ts'),
    'utf8',
  );

  it('packages/lib/src/supabase.ts declares DISPROVED_VERIFICATION_STATES with exactly the three states', () => {
    const m = /const\s+DISPROVED_VERIFICATION_STATES\s*=\s*\[([\s\S]*?)\]/.exec(libSource);
    expect(m, 'DISPROVED_VERIFICATION_STATES not found — the TS rung lost its floor').toBeTruthy();
    const states = [...m![1].matchAll(/'([^']+)'/g)].map((s) => s[1]);
    expect(states.sort()).toEqual([...DISPROVED].sort());
  });

  it('the direct-question_bank fallback actually APPLIES that constant (not merely declares it)', () => {
    // A declared-but-unused constant is the failure mode a literal-parity test
    // alone would miss: the numbers agree and nothing filters.
    expect(libSource).toMatch(
      /for\s*\(\s*const\s+state\s+of\s+DISPROVED_VERIFICATION_STATES\s*\)[\s\S]{0,160}?\.neq\(\s*'verification_state'\s*,\s*state\s*\)/,
    );
  });
});

describe('REG-388: KNOWN GAPS — recorded so this pin never reads as full coverage', () => {
  /**
   * ⚠️ DEFECT WITNESS, NOT AN ENDORSEMENT.
   *
   * `quiz-generator` is the PRIMARY question-serving path and it has NO
   * verification floor at all — it filters `is_active` only. It is the fifth
   * dialect ai-engineer found, and it was deliberately OUT OF SCOPE for
   * migration 20260814000014 (an Edge Function, not SQL; ai-engineer owns the
   * follow-up).
   *
   * This asserts the gap STILL EXISTS. That is intentional and it is the
   * honest option: a passing REG-388 must not be readable as "the floor is
   * total". The moment ai-engineer adds the floor, THIS TEST FAILS — which is
   * the trigger to delete this block and fold quiz-generator into the
   * REWRITTEN_RUNGS-style totality assertions above.
   *
   * Do not "fix" this test by relaxing it. Fix the Edge Function.
   */
  it('WITNESS: quiz-generator STILL has no verification floor (delete this test when it is added)', () => {
    const gen = readFileSync(
      resolve(REPO_ROOT, 'supabase', 'functions', 'quiz-generator', 'index.ts'),
      'utf8',
    );
    // Non-vacuity: it really does query question_bank, and really does filter.
    expect(gen).toMatch(/\.from\(\s*'question_bank'\s*\)/);
    expect(gen).toMatch(/\.eq\(\s*'is_active'\s*,\s*true\s*\)/);
    // The gap itself.
    expect(
      /verification_state/.test(gen),
      'quiz-generator now references verification_state — the gap this witness records ' +
        'has been closed. Delete this test and add quiz-generator to the totality assertions.',
    ).toBe(false);
  });

  /**
   * Recorded divergence, deliberately NOT unified. `select_quiz_questions_rag`
   * uses a STRICT `content_status = 'published'`; the other three rungs are
   * null-tolerant (`IS NULL OR = 'published'`), because content_status is
   * NULLABLE with DEFAULT 'published' and legacy rows carry explicit NULLs.
   *
   * Relaxing the RAG predicate would WIDEN what serves. Migration 14's header
   * states no widening ships during a SEV1 without a census first; architect
   * owns the follow-up. Pinned so that when it changes it is a deliberate,
   * visible act rather than a drive-by consistency edit.
   */
  it('RECORDED DIVERGENCE: RAG rung is content_status-STRICT while the other three are null-tolerant', () => {
    const rag = REWRITTEN_RUNGS.find((r) => r.label === 'select_quiz_questions_rag')!.body;
    const others = REWRITTEN_RUNGS.filter((r) => r.label !== 'select_quiz_questions_rag');

    // NB: the column is written `qb.content_status` in some rungs and bare
    // `content_status` in others, so the optional table qualifier is part of
    // the contract being matched, not incidental.
    const NULL_TOLERANT = /(?:\w+\.)?content_status\s+IS\s+NULL\s+OR\s+(?:\w+\.)?content_status\s*=\s*'published'/i;

    expect(rag).not.toMatch(NULL_TOLERANT);
    expect(rag).toMatch(/(?:\w+\.)?content_status\s*=\s*'published'/i);

    others.forEach(({ label, body }) => {
      expect(body, `${label} should be null-tolerant on content_status`).toMatch(NULL_TOLERANT);
    });
  });
});
