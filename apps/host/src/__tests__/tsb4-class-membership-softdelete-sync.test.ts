import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TSB-4 (engineering-audit remediation) — class-membership SOFT-DELETE sync (P8).
 *
 * THE CHANGE UNDER TEST
 * =====================
 * Migration `20260702030000_class_membership_softdelete_sync.sql` adds two
 * bidirectional `AFTER UPDATE OF is_active` triggers between the two
 * class-membership join tables — `class_students` and `class_enrollments` —
 * each keyed on the natural key `(class_id, student_id)` — so a soft de-enroll
 * (`is_active=false`) on EITHER table is mirrored onto the counterpart row.
 *
 * WHY IT MATTERS (the live P8 divergence being closed)
 * ----------------------------------------------------
 * The school-admin de-enroll path flips `is_active=false` on `class_enrollments`
 * ONLY. The existing INSERT mirror (20260620000700) is INSERT-only, so nothing
 * propagated that flip. The de-enrolled student therefore stayed
 * `is_active=true` on `class_students` — the table the live teacher boundary
 * reads (`canAccessStudent` / the `is_teacher_of(uuid)` SECURITY DEFINER helper
 * resolve a teacher's reachable students through `class_students WHERE
 * is_active = true`). So a de-enrolled student REMAINED VISIBLE to the assigned
 * teacher. The UPDATE mirror closes that, going forward.
 *
 * RECURSION SAFETY (provably terminating)
 * ---------------------------------------
 * Two independent guards make the round-trip terminate after exactly one bounce:
 *   (1) TRIGGER-LEVEL `WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)` — the
 *       body only runs when is_active actually changed on the source row.
 *   (2) ROW-LEVEL `WHERE ... AND is_active IS DISTINCT FROM NEW.is_active` on the
 *       mirrored UPDATE — the reverse-fired trigger finds zero differing rows, so
 *       its UPDATE touches 0 rows → no AFTER...FOR EACH ROW trigger re-fires.
 *
 * ─── Lane note (why this is a migration-SHAPE test, not a live-DB test) ──────
 * This repo has NO local live-Postgres lane. The RLS/trigger regression
 * convention (see `src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts` and
 * `src/__tests__/contract/portal-rbac-remediation-migration-canaries.test.ts`)
 * is SOURCE-LEVEL: assert the exact SHAPE of the migration text, because the
 * shape IS the guarantee. A behavioural "de-enroll on class_enrollments flips
 * class_students.is_active to false" proof would need a live DB to run the
 * UPDATE, fire the AFTER trigger, and read back the counterpart row —
 * infeasible here without standing up Postgres. Deferred to an integration lane.
 *
 * Owner: testing. Catalog: REG-200.
 */

const MIGRATION_REL = 'supabase/migrations/20260702030000_class_membership_softdelete_sync.sql';

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
 * Strip every `-- … (end of line)` comment so the active-SQL assertions inspect
 * EXECUTABLE SQL only. CRITICAL for THIS migration: its ADR header prose narrates
 * "DROP", "DISABLE ROW LEVEL SECURITY", "DELETE", "canAccessStudent",
 * "is_teacher_of", "CREATE POLICY", etc. as discussion of what it deliberately
 * does NOT do. Without stripping, every absence-assertion below would be a false
 * positive. Same line-comment-only convention as the sibling canary test (none of
 * these migrations use C-style block comments around statements, only line comments).
 */
function executableSql(rel: string): string {
  return readRaw(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const PRESENT = resolveRepo(MIGRATION_REL) !== null;
const RAW = readRaw(MIGRATION_REL);
const EXEC = executableSql(MIGRATION_REL);

// ════════════════════════════════════════════════════════════════════════════
// 0. Presence + NON-VACUITY. An empty/over-stripped parse must NOT pass green.
//    (assertion 6 — exactly TWO trigger fn defs + TWO CREATE TRIGGER survive.)
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: migration presence + parse non-vacuity', () => {
  it(`${MIGRATION_REL} exists`, () => {
    expect(PRESENT).toBe(true);
  });

  it('the comment-stripped active body is substantial (not an over-stripped empty string)', () => {
    expect(EXEC.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(300);
    // The transaction wrapper survives the strip.
    expect(EXEC).toMatch(/\bBEGIN\b/);
    expect(EXEC).toMatch(/\bCOMMIT\b/);
  });

  it('contains EXACTLY TWO trigger function definitions AND EXACTLY TWO CREATE TRIGGER statements', () => {
    const fnDefs = (EXEC.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi) || []).length;
    const triggers = (EXEC.match(/CREATE\s+TRIGGER/gi) || []).length;
    expect(fnDefs).toBe(2);
    expect(triggers).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. TWO `AFTER UPDATE OF is_active` triggers, one per direction; each mirrors
//    is_active on the (class_id, student_id) natural key.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: bidirectional AFTER UPDATE OF is_active mirror triggers', () => {
  it('defines an AFTER UPDATE OF is_active trigger ON class_students (→ enrollments)', () => {
    expect(EXEC).toMatch(
      /AFTER\s+UPDATE\s+OF\s+"?is_active"?\s+ON\s+"?public"?\."?class_students"?/i,
    );
  });

  it('defines an AFTER UPDATE OF is_active trigger ON class_enrollments (→ students)', () => {
    expect(EXEC).toMatch(
      /AFTER\s+UPDATE\s+OF\s+"?is_active"?\s+ON\s+"?public"?\."?class_enrollments"?/i,
    );
  });

  it('class_students→enrollments fn mirrors is_active onto class_enrollments on (class_id, student_id)', () => {
    expect(EXEC).toMatch(
      /UPDATE\s+"?public"?\."?class_enrollments"?\s+SET\s+"?is_active"?\s*=\s*NEW\.is_active[\s\S]*?WHERE[\s\S]*?class_id\s*=\s*NEW\.class_id[\s\S]*?student_id\s*=\s*NEW\.student_id/i,
    );
  });

  it('class_enrollments→students fn mirrors is_active onto class_students on (class_id, student_id)', () => {
    expect(EXEC).toMatch(
      /UPDATE\s+"?public"?\."?class_students"?\s+SET\s+"?is_active"?\s*=\s*NEW\.is_active[\s\S]*?WHERE[\s\S]*?class_id\s*=\s*NEW\.class_id[\s\S]*?student_id\s*=\s*NEW\.student_id/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RECURSION GUARD present on BOTH layers (trigger-level WHEN + row-level
//    WHERE). The round-trip terminates after one bounce → no trigger storm.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: recursion guard present on BOTH layers', () => {
  it('TRIGGER-LEVEL: WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active) on BOTH triggers', () => {
    const whenGuards =
      EXEC.match(/WHEN\s*\(\s*OLD\.is_active\s+IS\s+DISTINCT\s+FROM\s+NEW\.is_active\s*\)/gi) || [];
    // One WHEN clause per CREATE TRIGGER (both directions).
    expect(whenGuards.length).toBe(2);
  });

  it('ROW-LEVEL: WHERE ... is_active IS DISTINCT FROM NEW.is_active on BOTH mirrored UPDATEs', () => {
    const rowGuards =
      EXEC.match(/is_active\s+IS\s+DISTINCT\s+FROM\s+NEW\.is_active/gi) || [];
    // The WHEN clauses use `OLD.is_active IS DISTINCT FROM ...`; the row-level
    // predicate uses the bare column `is_active IS DISTINCT FROM ...`. Subtract
    // the 2 WHEN matches to isolate the 2 row-level guards.
    const whenGuards =
      EXEC.match(/OLD\.is_active\s+IS\s+DISTINCT\s+FROM\s+NEW\.is_active/gi) || [];
    expect(rowGuards.length - whenGuards.length).toBe(2);
    // And the row-level guard sits inside each mirrored UPDATE's WHERE clause.
    expect(EXEC).toMatch(
      /WHERE[\s\S]*?AND\s+is_active\s+IS\s+DISTINCT\s+FROM\s+NEW\.is_active/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. POSTURE: CREATE OR REPLACE + SECURITY DEFINER + pinned search_path; triggers
//    re-created idempotently via DROP TRIGGER IF EXISTS.
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: safety posture (idempotent, SECURITY DEFINER, pinned search_path)', () => {
  it('both functions are CREATE OR REPLACE (replayable / idempotent)', () => {
    expect((EXEC.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi) || []).length).toBe(2);
  });

  it('both functions are SECURITY DEFINER', () => {
    expect((EXEC.match(/SECURITY\s+DEFINER/gi) || []).length).toBe(2);
  });

  it('both functions pin search_path to public, pg_temp', () => {
    const pins =
      EXEC.match(/SET\s+"?search_path"?\s*=\s*'public'\s*,\s*'pg_temp'/gi) || [];
    expect(pins.length).toBe(2);
  });

  it('triggers are re-created idempotently (DROP TRIGGER IF EXISTS before each CREATE)', () => {
    expect((EXEC.match(/DROP\s+TRIGGER\s+IF\s+EXISTS/gi) || []).length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. NON-DESTRUCTIVE / NO GATED CHANGE: triggers + comments only. NO DROP
//    TABLE/COLUMN, NO RLS disable, NO policy churn, and it does NOT redefine the
//    boundary helpers (canAccessStudent / is_teacher_of live in app/baseline).
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: non-destructive, no gated change (active SQL only)', () => {
  it('no DROP TABLE / DROP COLUMN', () => {
    expect(EXEC).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(EXEC).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it('no RLS posture change (no DISABLE ROW LEVEL SECURITY, no policy churn)', () => {
    expect(EXEC).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(EXEC).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(EXEC).not.toMatch(/DROP\s+POLICY/i);
    expect(EXEC).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('no TRUNCATE and no standalone data DELETE', () => {
    expect(EXEC).not.toMatch(/\bTRUNCATE\b/i);
    expect(EXEC).not.toMatch(/(^|;)\s*DELETE\s+FROM\b/im);
  });

  it('does NOT redefine the boundary helpers (canAccessStudent / is_teacher_of are app/baseline)', () => {
    // Those identifiers may appear in the ADR header prose (explaining WHY) but
    // must never appear in executable SQL — this file does not repoint the boundary.
    expect(EXEC).not.toMatch(/canAccessStudent/i);
    expect(EXEC).not.toMatch(/is_teacher_of/i);
  });

  it('the only DROPs in executable SQL are the idempotent DROP TRIGGER IF EXISTS guards', () => {
    const drops = EXEC.match(/\bDROP\s+\w+/gi) || [];
    expect(drops.length).toBeGreaterThan(0); // sanity: guards exist
    for (const d of drops) {
      expect(d).toMatch(/DROP\s+TRIGGER/i);
    }
  });

  it('mutates ONLY the two roster tables (no CREATE TABLE, no ALTER TABLE)', () => {
    expect(EXEC).not.toMatch(/CREATE\s+TABLE/i);
    expect(EXEC).not.toMatch(/ALTER\s+TABLE/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. CANONICAL ADR: the header declares class_enrollments canonical(-by-intent)
//    and DEFERS the DROP / boundary-repoint to a separate CEO-gated cleanup.
//    (Header assertions run against the RAW text — the ADR lives in comments.)
// ════════════════════════════════════════════════════════════════════════════
describe('TSB-4: ADR / canonicality header declares the deferral', () => {
  it('names class_enrollments as the canonical(-by-intent) table', () => {
    expect(RAW).toMatch(/class_enrollments/);
    expect(RAW).toMatch(/CANONICAL-BY-INTENT/i);
  });

  it('explicitly defers the DROP + boundary-repoint to a separate CEO-gated cleanup', () => {
    expect(RAW).toMatch(/CEO-gated/i);
    // "NO DROP HERE" — the DROP of the redundant table is NOT in this slice.
    expect(RAW).toMatch(/NO\s+DROP\s+HERE/i);
    // The repoint of canAccessStudent / is_teacher_of is named as future cleanup.
    expect(RAW).toMatch(/repoint/i);
  });
});
