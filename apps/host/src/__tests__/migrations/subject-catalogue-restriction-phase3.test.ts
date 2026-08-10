import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SG-14..SG-18 — Phase 3 subject-catalogue restriction migrations (M1, M2, M4,
 * M5, M6). Static SQL-text pins.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES AND DOES NOT PROVE — read before trusting a green run.
 *
 * These are STRUCTURAL pins. They read the migration files off disk and assert
 * that the load-bearing clauses are PRESENT in the SQL source. They do NOT
 * execute any SQL. As of the commit that added this file, NONE of these five
 * migrations has ever run against a real Postgres in this environment (there is
 * no database here at all), so:
 *
 *   - "the write gate rejects a deactivated subject" is pinned as SOURCE TEXT,
 *     not as observed behaviour;
 *   - "the (grade, board) assertion rolls the transaction back" is pinned as
 *     the presence of a RAISE inside a BEGIN/COMMIT, not as an observed abort;
 *   - "get_subject_violations no longer gives a false all-clear" is pinned as
 *     the presence of the is_active join, not as an observed non-zero report.
 *
 * A green run here means a refactor cannot SILENTLY delete the clause. It does
 * not mean the migration works. Upgrading these entries from P to E requires a
 * live-Postgres run (`supabase db push` against a scratch project, then the
 * behavioural assertions listed per-describe below).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'supabase', 'migrations');

function readMigration(basename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, basename), 'utf8');
}

/**
 * Strip `--` line comments. Every "clause is absent" assertion must run against
 * executable SQL only — these migrations carry unusually long prose headers that
 * NAME the very things being asserted absent (e.g. M1's header discusses the
 * enumerated removal list it deliberately does not use), so an un-stripped
 * absence check would false-positive on the documentation.
 */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const M1 = readMigration('20260814000007_subject_catalogue_restrict_math_science.sql');
const M2 = readMigration('20260814000008_grade_subject_map_restrict_and_destream.sql');
const M4 = readMigration('20260814000009_repair_student_subjects_after_restriction.sql');
const M5 = readMigration('20260814000010_enforce_subject_enrollment_active_check.sql');
const M6 = readMigration('20260814000011_get_subject_violations_active_aware.sql');

const M1_SQL = executableSql(M1);
const M2_SQL = executableSql(M2);
const M4_SQL = executableSql(M4);
const M5_SQL = executableSql(M5);
const M6_SQL = executableSql(M6);

/** The CEO-locked keep-set. Restated here so a drift in the SQL fails loudly. */
const KEEP_SET = ['math', 'science', 'physics', 'chemistry', 'biology'];

// Non-vacuity floor: if a migration were renamed or emptied, every "not to
// match" assertion below would pass trivially. Prove there is real SQL first.
describe('SG-14..SG-18 preconditions (non-vacuity)', () => {
  it.each([
    ['M1 20260814000007', M1_SQL],
    ['M2 20260814000008', M2_SQL],
    ['M4 20260814000009', M4_SQL],
    ['M5 20260814000010', M5_SQL],
    ['M6 20260814000011', M6_SQL],
  ])('%s has non-trivial executable SQL wrapped in a transaction', (_label, sql) => {
    expect(sql.length).toBeGreaterThan(200);
    expect(sql).toMatch(/\bBEGIN;/);
    expect(sql).toMatch(/\bCOMMIT;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SG-17 — M1: catalogue restriction is keep-set-driven, self-healing, idempotent
// ─────────────────────────────────────────────────────────────────────────────
describe('SG-17 (M1): subject catalogue restricted by KEEP-SET, never by a removal list', () => {
  it('declares the keep-set exactly once, as a VALUES CTE, with exactly the 5 codes', () => {
    // Capture to the CTE's own closing paren at start-of-line — a non-greedy
    // `\)` would stop at the first tuple's paren and only ever see 'math'.
    const keepCte = M1_SQL.match(/WITH keep\(code\) AS \(\s*VALUES([\s\S]*?)\n\)/);
    expect(keepCte).not.toBeNull();

    const codes = [...keepCte![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual([...KEEP_SET].sort());

    // Declared ONCE — a second declaration is how the set drifts within a file.
    expect(M1_SQL.match(/WITH keep\(code\) AS/g)).toHaveLength(1);
  });

  it('deactivates by NOT IN (keep), never by an enumerated removal list', () => {
    expect(M1_SQL).toMatch(
      /SET is_active = FALSE\s+WHERE s\.code NOT IN \(SELECT k\.code FROM keep k\)/,
    );
    // An enumerated removal list would silently miss the out-of-band subjects
    // (informatics_practices, psychology, ...) that exist on prod but not in
    // seed.sql. Pin that no such list is used in executable SQL.
    expect(M1_SQL).not.toMatch(/code\s+IN\s*\(\s*'(english|hindi|social_studies)'/);
  });

  it('self-heals the keep-set back on (a prior partial restriction cannot leave biology dark)', () => {
    expect(M1_SQL).toMatch(
      /SET is_active = TRUE\s+WHERE s\.code IN \(SELECT k\.code FROM keep k\)/,
    );
  });

  it('is idempotent — both UPDATE branches guard on IS DISTINCT FROM', () => {
    expect(M1_SQL).toMatch(/is_active IS DISTINCT FROM FALSE/);
    expect(M1_SQL).toMatch(/is_active IS DISTINCT FROM TRUE/);
  });

  it('writes the single rollback-source-of-truth audit row, gated so a no-op re-run writes none', () => {
    expect(M1_SQL).toContain("'subject.catalogue.restricted_to_math_science'");
    expect(M1_SQL).toMatch(/'deactivated',[\s\S]{0,120}FROM deactivated/);
    expect(M1_SQL).toMatch(/'reactivated',[\s\S]{0,120}FROM reactivated/);
    expect(M1_SQL).toMatch(
      /WHERE EXISTS \(SELECT 1 FROM deactivated\)\s*OR EXISTS \(SELECT 1 FROM reactivated\)/,
    );
  });

  it('is non-destructive — no DROP and no DELETE on subjects', () => {
    expect(M1_SQL).not.toMatch(/\bDROP\b/i);
    expect(M1_SQL).not.toMatch(/DELETE\s+FROM\s+public\.subjects/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SG-14 — M2: no (grade, board) pair may be stranded with zero subjects
// ─────────────────────────────────────────────────────────────────────────────
describe('SG-14 (M2): grade-map restriction asserts every (grade, board) pair survives non-empty', () => {
  it('snapshots the pre-change (grade, board) pairs before any mutation', () => {
    expect(M2_SQL).toMatch(/_gsm_pairs_before/);
    const snapshotIdx = M2_SQL.indexOf('_gsm_pairs_before');
    const deleteIdx = M2_SQL.search(/DELETE FROM public\.grade_subject_map/);
    expect(snapshotIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    // The snapshot must be taken BEFORE the delete or it proves nothing.
    expect(snapshotIdx).toBeLessThan(deleteIdx);
  });

  it('RAISEs when any snapshotted pair would be left with zero mapped subjects', () => {
    expect(M2_SQL).toMatch(/RAISE EXCEPTION\s*\n?\s*'grade_subject_map restriction would strand/);
    expect(M2_SQL).toMatch(/FROM _gsm_pairs_before p/);
    expect(M2_SQL).toMatch(/WHERE NOT EXISTS/);
    // board comparison must be NULL-safe or a NULL-board pair never matches.
    expect(M2_SQL).toMatch(/g\.board IS NOT DISTINCT FROM p\.board/);
    expect(M2_SQL).toMatch(/ERRCODE = 'check_violation'/);
  });

  it('the assertion runs AFTER the delete and inside the transaction, so a failure rolls everything back', () => {
    const deleteIdx = M2_SQL.search(/DELETE FROM public\.grade_subject_map/);
    const raiseIdx = M2_SQL.indexOf('would strand');
    const commitIdx = M2_SQL.lastIndexOf('COMMIT;');
    expect(deleteIdx).toBeLessThan(raiseIdx);
    expect(raiseIdx).toBeLessThan(commitIdx);
  });

  it('the HINT refuses the weaken-the-keep-set escape hatch', () => {
    expect(M2_SQL).toMatch(/Do NOT weaken the keep-set to make this pass/);
  });

  it('de-streams grades 11-12 (stream-scoped rows deleted, stream-NULL rows inserted first)', () => {
    expect(M2_SQL).toMatch(
      /gsm\.grade IN \('11', '12'\) AND gsm\.stream IS NOT NULL/,
    );
    // Step 4 (insert stream-NULL) must precede step 5 (delete) so no pair is
    // ever momentarily empty.
    const insertIdx = M2_SQL.search(/INSERT INTO public\.grade_subject_map/);
    const deleteIdx = M2_SQL.search(/DELETE FROM public\.grade_subject_map/);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(deleteIdx);
  });

  it('archives every row the delete will remove, into an RLS-enabled table (P8)', () => {
    expect(M2_SQL).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(M2_SQL).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    const archiveIdx = M2_SQL.search(/INSERT INTO public\._?grade_subject_map/i);
    expect(archiveIdx).toBeGreaterThan(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SG-18 — M4: student repair covers the case the legacy function cannot see
// ─────────────────────────────────────────────────────────────────────────────
describe('SG-18 (M4): student repair after restriction', () => {
  it('ships archive_inactive_subject_enrollments keyed on is_active, reason subject_deactivated', () => {
    expect(M4_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.archive_inactive_subject_enrollments\(\)/,
    );
    expect(M4_SQL).toMatch(/is_active IS DISTINCT FROM TRUE/);
    expect(M4_SQL).toContain("'subject_deactivated'");
    // It is a CLONE, not a re-key of the legacy function — the legacy
    // is_content_ready path must stay intact for its own callers.
    expect(M4_SQL).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.archive_dead_subject_enrollments/,
    );
  });

  it('is service_role-only (a student must not be able to invoke the repair)', () => {
    expect(M4_SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.archive_inactive_subject_enrollments\(\) FROM PUBLIC/,
    );
    expect(M4_SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.archive_inactive_subject_enrollments\(\) FROM anon, authenticated/,
    );
    expect(M4_SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.archive_inactive_subject_enrollments\(\) TO service_role/,
    );
  });

  it('runs the repair once as part of the migration', () => {
    expect(M4_SQL).toMatch(/FROM public\.archive_inactive_subject_enrollments\(\)/);
  });

  it('DELIBERATELY never rewrites students.stream', () => {
    // A stream-NULL grade-map row matches every student regardless of stream,
    // so rewriting students.stream would destroy analytics data for zero
    // resolution benefit. Pin the absence in executable SQL.
    expect(M4_SQL).not.toMatch(/UPDATE\s+public\.students[\s\S]{0,200}?\bSET\b[\s\S]{0,120}?\bstream\s*=/i);
  });

  it('DELIBERATELY never trims teachers.subjects_taught (pending CEO decision)', () => {
    expect(M4_SQL).not.toMatch(/UPDATE\s+public\.teachers/i);
    expect(M4_SQL).not.toMatch(/subjects_taught\s*=/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SG-15 — M5: is_active becomes a WRITE gate, not just a read filter
// ─────────────────────────────────────────────────────────────────────────────
describe('SG-15 (M5): enforce_subject_enrollment rejects a deactivated subject', () => {
  const body = (() => {
    const m = M5_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.enforce_subject_enrollment\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/,
    );
    if (!m) throw new Error('enforce_subject_enrollment body not found');
    return m[1];
  })();

  it('checks subjects.is_active and raises subject_not_active', () => {
    expect(body).toMatch(
      /SELECT EXISTS\(\s*SELECT 1 FROM subjects sub\s+WHERE sub\.code = NEW\.subject_code\s+AND sub\.is_active\s*\)/,
    );
    expect(body).toMatch(/RAISE EXCEPTION 'subject_not_active'/);
    expect(body).toMatch(/ERRCODE = 'check_violation'/);
  });

  it('preserves the pre-existing error precedence: missing-grade still wins', () => {
    const gradeIdx = body.indexOf("'student_missing_grade'");
    const activeIdx = body.indexOf("'subject_not_active'");
    const forGradeIdx = body.indexOf("'subject_not_valid_for_grade'");
    const planIdx = body.indexOf("'subject_not_in_plan'");

    expect(gradeIdx).toBeGreaterThan(-1);
    expect(activeIdx).toBeGreaterThan(-1);
    expect(forGradeIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);

    // grade < not_active < not_valid_for_grade < not_in_plan
    expect(gradeIdx).toBeLessThan(activeIdx);
    expect(activeIdx).toBeLessThan(forGradeIdx);
    expect(forGradeIdx).toBeLessThan(planIdx);
  });

  it('restates search_path (CREATE OR REPLACE discards SET clauses) and stays SECURITY INVOKER', () => {
    expect(M5_SQL).toMatch(/SET search_path = public, pg_catalog/);
    // A validation trigger must NOT be SECURITY DEFINER.
    expect(M5_SQL).not.toMatch(/SECURITY DEFINER/);
  });

  it('does not recreate the trigger (pure function replace)', () => {
    expect(M5_SQL).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    expect(M5_SQL).not.toMatch(/DROP\s+TRIGGER/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SG-16 — M6: the verification signal stops giving a false all-clear
// ─────────────────────────────────────────────────────────────────────────────
describe('SG-16 (M6): get_subject_violations is is_active-aware', () => {
  it('joins subjects on is_active inside the allowed CTE', () => {
    expect(M6_SQL).toMatch(
      /JOIN subjects sub\s+ON sub\.code = gsm\.subject_code\s+AND sub\.is_active/,
    );
    // The join must be INNER (a LEFT JOIN would re-admit inactive subjects
    // into `allowed` and restore the false all-clear).
    expect(M6_SQL).not.toMatch(/LEFT JOIN subjects sub/);
  });

  it('the is_active join is inside `allowed`, not inside `enrolled` (direction matters)', () => {
    const allowedIdx = M6_SQL.indexOf('allowed AS (');
    const enrolledIdx = M6_SQL.indexOf('enrolled AS (');
    const joinIdx = M6_SQL.search(/JOIN subjects sub/);
    expect(allowedIdx).toBeGreaterThan(-1);
    expect(enrolledIdx).toBeGreaterThan(allowedIdx);
    expect(joinIdx).toBeGreaterThan(allowedIdx);
    expect(joinIdx).toBeLessThan(enrolledIdx);
  });

  it('keeps the signature and return shape unchanged', () => {
    expect(M6_SQL).toMatch(
      /get_subject_violations\(\s*p_plan\s+TEXT\s+DEFAULT NULL,\s*p_grade\s+TEXT\s+DEFAULT NULL,\s*p_stream\s+TEXT\s+DEFAULT NULL,\s*p_limit\s+INTEGER\s+DEFAULT 100,\s*p_offset\s+INTEGER\s+DEFAULT 0\s*\)/,
    );
    for (const col of [
      'student_id',
      'grade',
      'stream',
      'plan',
      'invalid_subjects',
      'total',
      'total_count',
    ]) {
      expect(M6_SQL).toContain(col);
    }
  });

  it('stays SECURITY DEFINER + STABLE with a pinned search_path', () => {
    expect(M6_SQL).toMatch(/STABLE/);
    expect(M6_SQL).toMatch(/SECURITY DEFINER/);
    expect(M6_SQL).toMatch(/SET search_path = public, pg_catalog/);
  });

  it('re-asserts the service_role-only ACL after CREATE OR REPLACE (P8/P13)', () => {
    expect(M6_SQL).toMatch(/REVOKE ALL\s+ON FUNCTION public\.get_subject_violations[\s\S]{0,80}FROM PUBLIC/);
    expect(M6_SQL).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_subject_violations[\s\S]{0,80}FROM anon, authenticated/,
    );
    expect(M6_SQL).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.get_subject_violations[\s\S]{0,80}TO service_role/,
    );
  });

  it('returns UUIDs and subject codes only — no PII column is selected (P13)', () => {
    const body = M6_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.get_subject_violations[\s\S]*?\$\$([\s\S]*?)\$\$;/,
    );
    expect(body).not.toBeNull();
    expect(body![1]).not.toMatch(/\b(full_name|email|phone|first_name|last_name)\b/i);
  });
});
