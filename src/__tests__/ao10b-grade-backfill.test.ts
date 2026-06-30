import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeGrade } from '@/lib/identity/constants';

/**
 * AO-10b (engineering-audit remediation) — historical grade backfill +
 * write-path DEFAULT fix (P5: grades are bare "6".."12", never "Grade N",
 * never an integer).
 *
 * THE CHANGE UNDER TEST (one migration)
 * =====================================
 *  `20260702070000_ao10b_backfill_student_grade_p5.sql`
 *
 *  PART A (data backfill): rewrites legacy/prefixed `students.grade` values
 *    ("Grade 9", "Class 11", "Grade-7", "11th", " 8 ", …) to the bare in-range
 *    digit string using `substring(grade from '\d{1,2}')::int::text`. It mirrors
 *    the TypeScript `normalizeGrade` read-coercion (src/lib/identity/constants.ts:
 *    170-191) — extract the FIRST 1-2 digit run, keep it only when it lands in
 *    [6,12]. FAIL-SAFE: the UPDATE is gated on `grade NOT IN ('6'..'12')` AND the
 *    embedded number BETWEEN 6 AND 12, so already-bare rows AND ambiguous /
 *    out-of-range / no-digit rows ("Grade 5", "Grade 13", "Grade", NULL-ish) are
 *    LEFT UNTOUCHED. It NEVER invents the TS '9' safe default at the data layer —
 *    that default only applies at read time. A read-only COUNT pre-flight runs
 *    first; an RLS-enabled, service-role-only backup table
 *    (`_ao10b_grade_backfill_backup`) snapshots every changed row for rollback.
 *
 *  PART B (write-path fix): `CREATE OR REPLACE`s the two onboarding RPCs whose
 *    baseline default literal re-accrued the "Grade N" shape — `create_student_profile`
 *    ('Grade 9' -> '9') and `get_or_create_student` ('Grade 6' -> '6') — so new
 *    rows are P5-conformant at write time and the backfill does not re-accrue.
 *
 * ─── Lane note (why this is a migration-SHAPE test, not a live-DB test) ──────
 * This repo's `src/__tests__/migrations/**` lane is the LIVE-DB integration lane
 * (gated behind RUN_INTEGRATION_TESTS=1 with real Supabase secrets), so a pure
 * source pin placed there would NOT run in the normal per-PR `npm test` gate.
 * This file therefore lives in the normal lane at the `src/__tests__/` root,
 * matching the sibling REG-200 / REG-208 source pins
 * (`tsb4-class-membership-softdelete-sync.test.ts`,
 * `tsb4-enrollments-rls-reconcile.test.ts`). The convention is SOURCE-LEVEL:
 * assert the exact SHAPE of the migration text, because for a gated migration the
 * shape IS the guarantee. The behavioural proof — "the SQL extraction rewrites
 * 'Grade 9' to '9' and leaves 'Grade 5' alone" — needs a live DB to apply the
 * UPDATE and read the row back; that belongs in the integration lane and is
 * deferred. The TS↔SQL parity is documented here by exercising the live
 * `normalizeGrade` (the read-coercion the SQL mirrors) directly.
 *
 * Owner: testing. Catalog: REG-209.
 */

const MIGRATION_REL =
  'supabase/migrations/20260702070000_ao10b_backfill_student_grade_p5.sql';

function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readRaw(rel: string): string {
  const p = resolveRepo(rel);
  return p ? readFileSync(p, 'utf8').replace(/\r/g, '') : '';
}

/**
 * Strip every `-- … (end of line)` comment so the absence-assertions inspect
 * EXECUTABLE SQL only. CRITICAL here: the migration's ADR header narrates the
 * things it deliberately does NOT do — "Grade 9", "Grade 6", "DROP TABLE",
 * "never an integer", "safe default" — as discussion. Without stripping, every
 * "must NOT contain" assertion below would be a false positive. This migration
 * uses line comments only (no C-style block comments around statements),
 * matching the sibling canary convention.
 */
function executableSql(rel: string): string {
  return readRaw(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const MIGRATION_PRESENT = resolveRepo(MIGRATION_REL) !== null;
const RAW = readRaw(MIGRATION_REL);
const EXEC = executableSql(MIGRATION_REL);

// Reference RAW so the lint/type lanes treat it as used; the RAW text is the
// comment-inclusive source kept available for ADR-header assertions.
void RAW;

// ════════════════════════════════════════════════════════════════════════════
// 0. Presence + NON-VACUITY. An empty/over-stripped parse must NOT pass green.
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b grade backfill: presence + parse non-vacuity', () => {
  it(`${MIGRATION_REL} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('the comment-stripped active body is substantial (not an over-stripped empty)', () => {
    expect(EXEC.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(500);
    // Both parts are present.
    expect(EXEC).toMatch(/UPDATE\s+public\.students/i);
    expect(EXEC).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. EXTRACTION PARITY — the UPDATE uses substring(grade from '\d{1,2}')::int::text
//    and is gated on `grade NOT IN ('6'..'12')` AND the embedded number BETWEEN
//    6 AND 12. Mirrors TS normalizeGrade: already-bare rows + out-of-range /
//    ambiguous rows are excluded (fail-safe: only clearly-parseable rows touched).
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b (Part A): extraction parity with TS normalizeGrade', () => {
  it("the backfill UPDATE writes the extracted digit via substring(...)::int::text", () => {
    expect(EXEC).toMatch(
      /UPDATE\s+public\.students[\s\S]*?SET\s+grade\s*=\s*\(?\s*substring\(\s*s?\.?grade\s+from\s+'\\d\{1,2\}'\s*\)\s*\)?::int::text/i,
    );
  });

  it("the UPDATE is gated on grade NOT IN ('6'..'12') — already-bare rows are skipped", () => {
    // The bare-valid set, excluded by NOT IN so idempotent on a clean DB.
    expect(EXEC).toMatch(
      /grade\s+NOT\s+IN\s*\(\s*'6'\s*,\s*'7'\s*,\s*'8'\s*,\s*'9'\s*,\s*'10'\s*,\s*'11'\s*,\s*'12'\s*\)/i,
    );
  });

  it('the UPDATE is gated on the embedded number BETWEEN 6 AND 12 (out-of-range left untouched)', () => {
    expect(EXEC).toMatch(
      /substring\(\s*s?\.?grade\s+from\s+'\\d\{1,2\}'\s*\)::int\s+BETWEEN\s+6\s+AND\s+12/i,
    );
    // And the predicate also requires the digit run to EXIST (no-digit rows excluded).
    expect(EXEC).toMatch(
      /substring\(\s*s?\.?grade\s+from\s+'\\d\{1,2\}'\s*\)\s+IS\s+NOT\s+NULL/i,
    );
  });

  it('a read-only COUNT pre-flight runs before any mutation (counts parseable vs ambiguous)', () => {
    expect(EXEC).toMatch(/count\(\*\)/i);
    // Two counts: WILL-FIX (parseable, in-range) and WILL-LEAVE (ambiguous / out-of-range).
    expect((EXEC.match(/count\(\*\)/gi) || []).length).toBeGreaterThanOrEqual(2);
    // The ambiguous bucket is computed via the NEGATED predicate (NULL OR NOT BETWEEN).
    expect(EXEC).toMatch(/IS\s+NULL[\s\S]*?OR[\s\S]*?NOT\s+BETWEEN\s+6\s+AND\s+12/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. NO FORCED DEFAULT AT THE DATA LAYER — the migration must NOT write a
//    hardcoded '9' (or any constant) into students.grade for unparseable rows.
//    It writes ONLY the extracted digit. The read layer owns display defaults;
//    the data layer must never corrupt a real (or unparseable) value.
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b (Part A): no forced default written to students.grade', () => {
  it("contains NO unconditional `SET grade = '9'` (or any constant) on students", () => {
    // The ONLY SET grade on students.* is the extracted-digit expression. A
    // constant-literal assignment (SET grade = '9' / '6' / 'Grade 9') would be a
    // data-layer default corrupting unparseable rows — must not exist.
    const studentGradeConstAssign =
      /UPDATE\s+public\.students[\s\S]*?SET\s+grade\s*=\s*'(?:Grade\s*)?\d{1,2}'/i;
    expect(EXEC).not.toMatch(studentGradeConstAssign);
  });

  it('the students UPDATE has no ELSE/COALESCE fallback that injects a default digit', () => {
    // No CASE/COALESCE around the students.grade SET target that would supply a
    // safe-default when extraction yields NULL — the WHERE clause already excludes
    // those rows, so the SET expression is the bare substring cast only.
    expect(EXEC).not.toMatch(
      /SET\s+grade\s*=\s*COALESCE\(/i,
    );
    expect(EXEC).not.toMatch(
      /SET\s+grade\s*=\s*CASE\b/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. BACKUP TABLE RLS — the new _ao10b_grade_backfill_backup table is created
//    WITH RLS enabled AND a service-role-only policy in the SAME migration
//    (P8: every new table gets RLS + policy in its own migration).
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b (Part A): reversibility backup table is RLS-protected (service-role only)', () => {
  it('creates _ao10b_grade_backfill_backup (idempotent CREATE TABLE IF NOT EXISTS)', () => {
    expect(EXEC).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?public"?\."?_ao10b_grade_backfill_backup"?/i,
    );
  });

  it('ENABLES row level security on the backup table', () => {
    expect(EXEC).toMatch(
      /ALTER\s+TABLE\s+"?public"?\."?_ao10b_grade_backfill_backup"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
  });

  it('adds a service-role-only policy on the backup table (idempotent)', () => {
    expect(EXEC).toMatch(
      /CREATE\s+POLICY\s+"?_ao10b_backup_service_role_all"?\s+ON\s+"?public"?\."?_ao10b_grade_backfill_backup"?/i,
    );
    // Gated to the service_role.
    expect(EXEC).toMatch(/TO\s+service_role/i);
    // Idempotent re-create.
    expect(EXEC).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"?_ao10b_backup_service_role_all"?/i,
    );
  });

  it('snapshots changed rows BEFORE the UPDATE (id + old_grade + new_grade)', () => {
    expect(EXEC).toMatch(
      /INSERT\s+INTO\s+public\._ao10b_grade_backfill_backup\s*\(\s*id\s*,\s*old_grade\s*,\s*new_grade\s*\)/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. WRITE-PATH DEFAULTS (Part B) — the migration CREATE OR REPLACEs the two
//    onboarding RPCs with the BARE default, and the OLD "Grade N" literals are
//    GONE from these two function definitions.
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b (Part B): write-path RPC defaults flipped to bare grade', () => {
  it("create_student_profile is CREATE OR REPLACEd with p_grade DEFAULT '9' (not 'Grade 9')", () => {
    expect(EXEC).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"?public"?\."?create_student_profile"?/i,
    );
    expect(EXEC).toMatch(
      /"?p_grade"?\s+"?text"?\s+DEFAULT\s+'9'(?:::"?text"?)?/i,
    );
  });

  it("get_or_create_student is CREATE OR REPLACEd with p_grade DEFAULT '6' (not 'Grade 6')", () => {
    expect(EXEC).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"?public"?\."?get_or_create_student"?/i,
    );
    expect(EXEC).toMatch(
      /"?p_grade"?\s+"?text"?\s+DEFAULT\s+'6'(?:::"?text"?)?/i,
    );
  });

  it("the OLD 'Grade 9' / 'Grade 6' default literals are GONE from executable SQL", () => {
    // Neither prefixed default may survive anywhere in the active function bodies.
    expect(EXEC).not.toMatch(/DEFAULT\s+'Grade\s*9'/i);
    expect(EXEC).not.toMatch(/DEFAULT\s+'Grade\s*6'/i);
    // Belt-and-braces: no bare "Grade N" string literal in executable SQL at all.
    expect(EXEC).not.toMatch(/'Grade\s*\d{1,2}'/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. NO DROP / IDEMPOTENT — no DROP TABLE / DROP COLUMN; idempotency guards
//    present (IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE, the
//    snapshot NOT EXISTS replay guard).
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b: non-destructive + idempotent', () => {
  it('has no DROP TABLE / DROP COLUMN / TRUNCATE / standalone DELETE', () => {
    expect(EXEC).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(EXEC).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(EXEC).not.toMatch(/\bTRUNCATE\b/i);
    expect(EXEC).not.toMatch(/(^|;)\s*DELETE\s+FROM\b/im);
  });

  it('the only DROPs in executable SQL are idempotent DROP POLICY IF EXISTS guards', () => {
    const drops = EXEC.match(/\bDROP\s+\w+/gi) || [];
    expect(drops.length).toBeGreaterThan(0); // sanity: the idempotency guard exists
    for (const d of drops) {
      expect(d).toMatch(/DROP\s+POLICY/i);
    }
  });

  it('carries the full idempotency guard set', () => {
    expect(EXEC).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i);
    expect(EXEC).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS/i);
    expect(EXEC).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    // The snapshot INSERT is guarded so a replay does not duplicate the same change.
    expect(EXEC).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. P5 — no integer grade is ever written. The backfill writes ::int::text
//    (string), and nothing strips the ::text cast or writes a bare ::int.
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b: P5 — grade stays a string, never an integer', () => {
  it('the backfill SET target ends in ::text (the extracted digit is cast to string)', () => {
    expect(EXEC).toMatch(/SET\s+grade\s*=\s*\(?\s*substring\([\s\S]*?\)\s*\)?::int::text/i);
  });

  it('there is NO `SET grade = <expr>::int` that stops short of ::text (no integer write)', () => {
    // Any students.grade assignment that casts to ::int but NOT onward to ::text
    // would write an integer-shaped value. Must not exist. (Scoped to the SET
    // line via [^\n;]* so the WHERE clause's legitimate `::int BETWEEN` predicate
    // on a later line is not swept in.)
    expect(EXEC).not.toMatch(/SET\s+grade\s*=\s*[^\n;]*::int(?!::text)/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. BEHAVIOURAL PARITY (documents the contract the SQL mirrors) — the live TS
//    normalizeGrade, which the SQL extraction copies, agrees on the canonical
//    legacy formats. The SQL itself is proven in the live-DB lane; this asserts
//    the read-coercion the migration was written to match.
// ════════════════════════════════════════════════════════════════════════════
describe('AO-10b: TS normalizeGrade parity (the read-coercion the SQL mirrors)', () => {
  it('extracts the same bare digit the SQL would for canonical legacy formats', () => {
    const cases: Array<[string, string]> = [
      ['Grade 9', '9'],
      ['Class 10', '10'],
      ['Grade-7', '7'],
      ['11th', '11'],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeGrade(input)).toBe(expected);
      // P5: the extracted value is a string.
      expect(typeof normalizeGrade(input)).toBe('string');
    }
  });

  it('leaves an already-bare valid grade unchanged (matches the NOT IN skip)', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(normalizeGrade(g)).toBe(g);
    }
  });
});
