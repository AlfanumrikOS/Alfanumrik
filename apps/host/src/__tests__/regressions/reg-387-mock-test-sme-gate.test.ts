/**
 * REG-387 — `start_mock_test_attempt` keeps the human-SME gate on ALL THREE
 * rungs of its question-assembly fallback ladder.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * `is_verified` is the HUMAN SME sign-off (set only via
 * `POST /api/super-admin/questions/verify`); it is a different column from the
 * agent-written `verification_state` / `verified_against_ncert` pair. Decision A
 * (CEO-approved option 3, migration `20260814000014`) deliberately split the
 * two audiences:
 *
 *   PRACTICE  — serves AI-verified content. A wrong question costs one
 *               confusing minute and is recoverable.
 *   MOCK TEST — keeps the human-SME gate. A wrong question corrupts a score a
 *               parent will screenshot. The record is permanent.
 *
 * Migration `20260814000014` removed `is_verified = true` from
 * `get_quiz_questions` (the practice rung) and its own header carries a
 * `TO REVERSE THIS DECISION:` block naming the exact one-line edit that would
 * remove the gate from the exam rung too. A documented one-line path to
 * deleting a safety property, with nothing pinning it, is how the property
 * quietly disappears six months later during an unrelated availability push
 * ("mock tests are returning insufficient_questions — just drop the filter
 * like we did for practice"). This file is the thing that says no.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS PROVES — AND WHAT IT EXPLICITLY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * There is NO Postgres in the unit-test environment, so this cannot execute
 * `start_mock_test_attempt` and observe an unverified row being excluded. It
 * is a SOURCE-TEXT contract pin, the same technique this repo already uses for
 * SQL contracts (`__tests__/contract/select-quiz-questions-rag-verification-
 * gate.test.ts`, `v3-school-rpc-predeploy.test.ts`, and the SQL/TS literal
 * parity pattern behind REG-48).
 *
 * PROVES:
 *   - the EFFECTIVE definition of the function (the last migration that
 *     CREATE-OR-REPLACEs it, resolved at test time — not a hardcoded file)
 *     carries `is_verified = true` on each of its three ladder rungs;
 *   - each gate sits inside a `public.question_bank` SELECT, so it is a row
 *     filter and not a comment or an unrelated predicate;
 *   - no later migration DROPs the function or replaces it without the gate;
 *   - migration 20260814000014 does not touch this function in EXECUTABLE SQL
 *     (its only mention is the comment claiming it doesn't).
 *
 * DOES NOT PROVE:
 *   - that the deployed database matches these files. `supabase functions
 *     list`-style drift (a hand-run `CREATE OR REPLACE` in the SQL editor) is
 *     invisible to every static test. See `docs/runbooks/edge-function-drift-
 *     report.md` for the precedent where on-disk and deployed genuinely
 *     disagreed in production.
 *   - that `is_verified = true` semantically means "an SME approved it" — that
 *     is a property of the write path (`/api/super-admin/questions/verify`),
 *     not of this query.
 *   - anything about mock-test SCORING (P1) or the all-or-nothing assembly
 *     gate; those are pinned elsewhere.
 *
 * MUTATION-TESTED: the `assertSmeGateIntact` routine below is run against four
 * deliberately-corrupted copies of the real SQL (all three gates removed, and
 * each one removed individually) and each mutant is asserted to FAIL. A pin
 * that cannot be shown to fail is decoration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');

const FN = 'start_mock_test_attempt';

/** Strip SQL line comments so no assertion can be satisfied by prose. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

interface Definer {
  file: string;
  sql: string;
}

/**
 * Resolve the EFFECTIVE definition: every migration that CREATE-OR-REPLACEs
 * the function, in timestamp (== filename) order; the last one wins, exactly
 * as Postgres applies them. Deliberately NOT a hardcoded path — if someone
 * adds `20261001000000_relax_mock_test_gate.sql`, this test reads THAT file
 * and fails, rather than passing forever against a superseded definition.
 */
function findDefiners(): Definer[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const out: Definer[] = [];
  for (const f of files) {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    const exec = executable(raw);
    if (new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${FN}\\s*\\(`, 'i').test(exec)) {
      out.push({ file: f, sql: exec });
    }
  }
  return out;
}

/**
 * Slice the function body out of a migration: from its CREATE statement to the
 * dollar-quote terminator that closes it. Everything after (grants, DO-blocks,
 * verification harnesses) is excluded so their text cannot satisfy a gate
 * assertion by accident.
 */
function functionBody(sql: string): string {
  const m = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${FN}\\s*\\(`, 'i').exec(sql);
  if (!m) throw new Error(`No CREATE for ${FN} in the supplied SQL`);
  const from = sql.slice(m.index);
  // The body opens with `AS $tag$` (or `AS $$`) and closes with the same tag.
  const open = /AS\s+(\$[A-Za-z_]*\$)/.exec(from);
  if (!open) throw new Error(`No dollar-quoted body opener for ${FN}`);
  const tag = open[1];
  const bodyStart = open.index + open[0].length;
  const close = from.indexOf(tag, bodyStart);
  if (close < 0) throw new Error(`Unterminated dollar-quoted body for ${FN}`);
  return from.slice(bodyStart, close);
}

/**
 * THE CONTRACT. Throws on any violation. Extracted as a function purely so the
 * mutation witnesses below can run the IDENTICAL routine against corrupted
 * input — if the assertions here were inlined into an `it()`, "this pin would
 * fail if the predicate were removed" would be an untested claim.
 */
function assertSmeGateIntact(body: string): void {
  // Every rung reads question_bank. Split on the table reference so each
  // fragment is one rung's WHERE clause.
  const rungs = body.split(/FROM\s+public\.question_bank/i).slice(1);
  if (rungs.length !== 3) {
    throw new Error(
      `expected exactly 3 public.question_bank SELECTs (the 3-step fallback ladder), found ${rungs.length}`,
    );
  }
  rungs.forEach((rung, i) => {
    // Only look at this rung's own WHERE clause — stop at ORDER BY so the
    // next rung's text can never satisfy this rung's assertion.
    const where = rung.split(/ORDER\s+BY/i)[0];
    if (!/\bAND\s+is_verified\s*=\s*true\b/i.test(where)) {
      throw new Error(
        `ladder step ${i + 1} of ${FN} has no \`AND is_verified = true\` — ` +
          'the human-SME gate on the exam path has been removed (Decision A option 2 reversal)',
      );
    }
  });
}

const definers = findDefiners();

describe('REG-387: start_mock_test_attempt human-SME gate (P6/exam integrity)', () => {
  it('is defined by at least one migration (non-vacuity floor for every assertion below)', () => {
    expect(definers.length).toBeGreaterThan(0);
    // Documented current state. If this fails because a NEW migration
    // redefines the function, that is correct and intended — read the new
    // file, confirm it kept all three gates, then update this expectation.
    expect(definers.map((d) => d.file)).toEqual([
      '20260722097000_start_mock_test_attempt_rpc.sql',
    ]);
  });

  it('the EFFECTIVE definition keeps `is_verified = true` on all three fallback rungs', () => {
    const effective = definers[definers.length - 1];
    expect(() => assertSmeGateIntact(functionBody(effective.sql))).not.toThrow();
  });

  it('carries exactly three SME gates — one per ladder step, none added, none lost', () => {
    const body = functionBody(definers[definers.length - 1].sql);
    const gates = body.match(/\bis_verified\s*=\s*true\b/gi) ?? [];
    expect(gates).toHaveLength(3);
  });

  it('each gate sits in a real row filter, alongside is_active, not in isolation', () => {
    const body = functionBody(definers[definers.length - 1].sql);
    const paired = body.match(/\bis_active\s*=\s*true\s+AND\s+is_verified\s*=\s*true\b/gi) ?? [];
    expect(paired).toHaveLength(3);
  });

  it('the three rungs are the documented ladder: exact difficulty, +/-1 band, then any difficulty', () => {
    // Pins that the gate is on the WIDENING rungs too. Step 3 is the dangerous
    // one: it is the "we are short, take anything" branch, and it is exactly
    // the rung an availability-motivated edit would relax first.
    const body = functionBody(definers[definers.length - 1].sql);
    const rungs = body.split(/FROM\s+public\.question_bank/i).slice(1)
      .map((r) => r.split(/ORDER\s+BY/i)[0]);

    expect(rungs[0]).toMatch(/difficulty\s*=\s*v_target/i);
    expect(rungs[1]).toMatch(/difficulty\s+BETWEEN\s*\(v_target\s*-\s*1\)\s*AND\s*\(v_target\s*\+\s*1\)/i);
    // Step 3 constrains subject/grade only — no difficulty predicate at all.
    expect(rungs[2]).not.toMatch(/\bdifficulty\b/i);
    rungs.forEach((r) => expect(r).toMatch(/\bis_verified\s*=\s*true\b/i));
  });

  it('no migration DROPs the function (a drop would silently unpin everything above)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    const droppers = files.filter((f) =>
      new RegExp(`DROP\\s+FUNCTION\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${FN}\\b`, 'i')
        .test(executable(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8'))),
    );
    expect(droppers).toEqual([]);
  });

  it('migration 20260814000014 issues no DDL against this function (it only names it in prose)', () => {
    // The tiered-verification migration's own header claims "This file
    // contains no reference to that function beyond this comment". That claim
    // is very slightly WRONG and the difference is worth recording rather than
    // asserting around: the identifier also appears inside a `jsonb_build_object`
    // STRING LITERAL in the migration's audit row ('exam_path',
    // 'start_mock_test_attempt untouched — ...'). That is a narrative value
    // written into audit_logs, not a reference to the function.
    //
    // So the property pinned here is the one that actually matters — migration
    // 14 issues NO DDL against the function — rather than the stronger but
    // false "the identifier does not appear in executable SQL".
    const raw = readFileSync(
      resolve(MIGRATIONS_DIR, '20260814000014_tiered_verification_serving_and_truthful_picker.sql'),
      'utf8',
    );
    expect(raw).toContain(FN); // non-vacuity: the file really does name it

    const exec = executable(raw);
    for (const verb of ['CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 'DROP FUNCTION', 'ALTER FUNCTION']) {
      expect(exec).not.toMatch(
        new RegExp(`${verb.replace(/ /g, '\\s+')}\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${FN}\\b`, 'i'),
      );
    }
    // And it must not have smuggled the practice-path change onto the exam
    // path: migration 14 touches `is_verified` in exactly one place, §2's
    // exam_ready_count aggregate, never as a removed serving predicate.
    expect(definers.map((d) => d.file)).not.toContain(
      '20260814000014_tiered_verification_serving_and_truthful_picker.sql',
    );
  });
});

describe('REG-387 mutation witnesses: the pin above demonstrably FAILS when the gate is removed', () => {
  const body = functionBody(definers[definers.length - 1].sql);

  it('sanity: the unmutated body passes (otherwise every mutant below is meaningless)', () => {
    expect(() => assertSmeGateIntact(body)).not.toThrow();
  });

  it('FAILS when the documented one-line reversal removes all three gates', () => {
    const mutant = body.replace(/\s+AND\s+is_verified\s*=\s*true\b/gi, '');
    expect(mutant).not.toEqual(body); // the mutation actually applied
    expect(() => assertSmeGateIntact(mutant)).toThrow(/human-SME gate/);
  });

  // Per-rung mutants. The all-three case is the loud reversal; a SINGLE
  // removed gate is the quiet one — the "just relax the last-resort top-up"
  // edit — and it must fail just as hard.
  for (const step of [1, 2, 3] as const) {
    it(`FAILS when ONLY ladder step ${step}'s gate is removed`, () => {
      let seen = 0;
      const mutant = body.replace(/\s+AND\s+is_verified\s*=\s*true\b/gi, (match) => {
        seen += 1;
        return seen === step ? '' : match;
      });
      expect(seen).toBe(3);
      expect(mutant).not.toEqual(body);
      expect(() => assertSmeGateIntact(mutant)).toThrow(
        new RegExp(`ladder step ${step} of ${FN} has no`),
      );
    });
  }

  it('FAILS if a rung is deleted outright rather than merely relaxed', () => {
    // Removing a whole fallback step would leave the surviving rungs gated and
    // pass a naive "every rung has the gate" check. The count floor catches it.
    const firstRung = body.search(/FROM\s+public\.question_bank/i);
    const secondRung = body.search(/FROM\s+public\.question_bank/i) + 1;
    const mutant =
      body.slice(0, firstRung) +
      body.slice(secondRung).replace(/FROM\s+public\.question_bank/i, 'FROM public.some_other_table');
    expect(() => assertSmeGateIntact(mutant)).toThrow(/expected exactly 3/);
  });
});
