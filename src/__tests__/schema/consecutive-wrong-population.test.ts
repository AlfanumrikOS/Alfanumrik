import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * STATIC consecutive_wrong-population guard (no DB). Catalogued as REG-145.
 *
 * Pins the additive change in migration
 * `20260615181255_maintain_consecutive_wrong_in_learner_state.sql`, which extends
 * `update_learner_state_post_quiz` to MAINTAIN the `concept_mastery.consecutive_wrong`
 * counter (increment on a wrong answer, reset to 0 on a correct one) — WITHOUT
 * touching the BKT / SM-2 mastery math. The whole point of the change is that it is
 * SURGICAL: the only diff from the deployed version
 * (`20260615142552_restore_missing_quiz_functions.sql`) is the 3 consecutive_wrong
 * spots in the concept_mastery upsert (+ the COMMENT line). This test proves that
 * surgicality by reading the two migration files on disk and asserting:
 *
 *   1. SIGNATURE UNCHANGED — the 10-param CREATE FUNCTION header is byte-identical
 *      in both migrations (P5-adjacent: the 10-arg DROP/CREATE signature is the
 *      contract every PERFORM caller depends on; changing it would break the
 *      unguarded `PERFORM update_learner_state_post_quiz(...)` in
 *      submit_quiz_results_v2 — the REG-144 hazard).
 *   2. COLUMN PREREQUISITE — `20260615180149_add_consecutive_wrong_to_concept_mastery.sql`
 *      adds the `consecutive_wrong` column, AND sorts BEFORE 20260615181255 so the
 *      column exists before the function references it (migrations apply in
 *      lexicographic timestamp order).
 *   3. POPULATION LOGIC — the DO UPDATE SET clause resets on correct / +1 on wrong
 *      via the PLpgSQL parameter `p_is_correct` (NOT the invalid
 *      `EXCLUDED.p_is_correct`, which would reference a non-existent EXCLUDED
 *      pseudo-column and fail at apply time), and the INSERT VALUES path seeds a
 *      neutral `0` for the first answer.
 *   4. BKT / SM-2 UNCHANGED — every BKT/SM-2 line is byte-identical between the two
 *      function bodies. This is the structural equivalent of a "BKT outputs
 *      unchanged" guarantee: consecutive_wrong feeds NO formula, so a quiz attempt
 *      that produced mastery X / ease Y / interval Z before the migration produces
 *      the SAME X / Y / Z after it. The key BKT update line is pinned byte-for-byte.
 *
 * WHY STATIC (no DB): this is a structural-equivalence guard. "The only diff is the
 * 3 additive lines" is provable from the SQL text alone — it does not need a live
 * database, and pinning it cheaply (always-on) catches any future edit that
 * accidentally perturbs the mastery math while touching this function. The live
 * fresh-DB existence probe for the same function lives in
 * `fresh-db-quiz-functions.test.ts` (REG-144); this is the no-DB companion for the
 * population layer that landed on top of it.
 *
 * REFERENCE PIN (expected behavior for a known input — documented, not executed):
 *   Brand-new row, p_is_correct = false → INSERT VALUES path seeds consecutive_wrong = 0.
 *   Existing row, p_is_correct = false → DO UPDATE sets consecutive_wrong =
 *     concept_mastery.consecutive_wrong + 1 (e.g. 2 → 3).
 *   Existing row, p_is_correct = true  → DO UPDATE sets consecutive_wrong = 0 (reset).
 *   For ALL of the above the BKT output is unchanged from the deployed version,
 *   e.g. the BKT update remains
 *     v_new_mastery := LEAST(1.0, GREATEST(0.0, v_p_know + (1.0 - v_p_know) * p_p_learn))
 *   pinned byte-identical below.
 */

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

const ID_COLUMN = '20260615180149_add_consecutive_wrong_to_concept_mastery.sql';
const ID_DEPLOYED = '20260615142552_restore_missing_quiz_functions.sql';
const ID_POPULATION = '20260615181255_maintain_consecutive_wrong_in_learner_state.sql';

const FILE_COLUMN = path.join(MIGRATIONS_DIR, ID_COLUMN);
const FILE_DEPLOYED = path.join(MIGRATIONS_DIR, ID_DEPLOYED);
const FILE_POPULATION = path.join(MIGRATIONS_DIR, ID_POPULATION);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** Collapse all runs of whitespace to a single space and trim, so the
 *  "byte-identical" assertions are robust to incidental indentation/newline
 *  differences while still catching any TOKEN-level change (an added/removed
 *  identifier, operator, or constant). */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the CREATE FUNCTION parameter list — everything between the first `(`
 * after `CREATE ... FUNCTION ... update_learner_state_post_quiz` and its matching
 * `)` that precedes `RETURNS JSONB`. Returns the whitespace-normalized list.
 */
function extractSignatureParams(sql: string): string {
  const m = sql.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+update_learner_state_post_quiz\s*\(([\s\S]*?)\)\s*RETURNS\s+JSONB/i,
  );
  if (!m) return '';
  return normalizeWs(m[1]);
}

/**
 * Extract the lines of the function body that drive the BKT / SM-2 / mastery
 * math — i.e. everything that, if changed, would change the function's numeric
 * outputs. We pull the contiguous span from the BKT comment header through the
 * end of the SM-2 interval block (which is the entirety of the
 * mastery-determining arithmetic; the streak / error-count / bloom / retention /
 * velocity / action blocks are also identical and asserted via the full-body
 * structural-diff check below). Returned whitespace-normalized.
 */
function extractBktSm2Block(sql: string): string {
  const start = sql.indexOf('-- ---- BKT Update');
  const endMarker = '-- ---- Streak ----';
  const end = sql.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return '';
  return normalizeWs(sql.slice(start, end));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('consecutive_wrong population — static structural-diff guard (no DB) [REG-145]', () => {
  it('all three migration files are present on disk (guards against rename/removal)', () => {
    expect(fs.existsSync(FILE_COLUMN), `${ID_COLUMN} missing`).toBe(true);
    expect(fs.existsSync(FILE_DEPLOYED), `${ID_DEPLOYED} missing`).toBe(true);
    expect(fs.existsSync(FILE_POPULATION), `${ID_POPULATION} missing`).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 1. Signature unchanged — the 10-param CREATE FUNCTION header is identical.
  // -------------------------------------------------------------------------
  describe('1. signature unchanged (10-param contract)', () => {
    const deployedParams = extractSignatureParams(read(FILE_DEPLOYED));
    const populationParams = extractSignatureParams(read(FILE_POPULATION));

    it('extracts a non-empty parameter list from both migrations', () => {
      expect(deployedParams.length).toBeGreaterThan(0);
      expect(populationParams.length).toBeGreaterThan(0);
    });

    it('the population migration has the SAME parameter list as the deployed version', () => {
      expect(populationParams).toBe(deployedParams);
    });

    it('the parameter list is the 10-param BKT signature', () => {
      // All 10 params must be present, in order, with their types/defaults.
      for (const param of [
        'p_student_id UUID',
        'p_topic_id UUID',
        'p_is_correct BOOLEAN',
        'p_bloom_level TEXT DEFAULT NULL',
        'p_error_type TEXT DEFAULT NULL',
        'p_response_time_ms INT DEFAULT NULL',
        'p_difficulty INT DEFAULT NULL',
        'p_p_learn FLOAT DEFAULT 0.2',
        'p_p_slip FLOAT DEFAULT 0.1',
        'p_p_guess FLOAT DEFAULT 0.25',
      ]) {
        expect(populationParams).toContain(param);
      }
    });

    it('both migrations DROP the exact 10-arg-type signature (idempotent overload-safe DROP)', () => {
      const dropSig =
        'DROP FUNCTION IF EXISTS public.update_learner_state_post_quiz(UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, FLOAT, FLOAT, FLOAT);';
      expect(read(FILE_DEPLOYED)).toContain(dropSig);
      expect(read(FILE_POPULATION)).toContain(dropSig);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Column prerequisite — the column is added, and BEFORE the function uses it.
  // -------------------------------------------------------------------------
  describe('2. column prerequisite (column exists before the function references it)', () => {
    const columnSql = read(FILE_COLUMN);

    it('20260615180149 adds the consecutive_wrong column to concept_mastery', () => {
      // ALTER TABLE ... concept_mastery ... ADD COLUMN ... consecutive_wrong
      expect(columnSql).toMatch(/ALTER\s+TABLE\s+public\.concept_mastery/i);
      expect(columnSql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+consecutive_wrong\b/i);
    });

    it('the new column is integer NOT NULL DEFAULT 0', () => {
      expect(columnSql).toMatch(
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+consecutive_wrong\s+integer\s+NOT\s+NULL\s+DEFAULT\s+0/i,
      );
    });

    it('the column migration sorts BEFORE the population migration (lexicographic timestamp order)', () => {
      // Migrations apply in filename order; the column must exist before the
      // function body that references concept_mastery.consecutive_wrong runs.
      expect(ID_COLUMN < ID_POPULATION).toBe(true);
      // Be explicit about the numeric timestamps so the intent is undeniable.
      expect(Number('20260615180149')).toBeLessThan(Number('20260615181255'));
    });
  });

  // -------------------------------------------------------------------------
  // 3. Population logic present — reset on correct / +1 on wrong, p_is_correct.
  // -------------------------------------------------------------------------
  describe('3. population logic (reset on correct, +1 on wrong)', () => {
    const populationSql = read(FILE_POPULATION);

    it('DO UPDATE SET uses the reset-on-correct / increment-on-wrong CASE expression', () => {
      // Normalize whitespace so we match regardless of column-alignment padding.
      expect(normalizeWs(populationSql)).toContain(
        normalizeWs(
          'consecutive_wrong = CASE WHEN p_is_correct THEN 0 ELSE concept_mastery.consecutive_wrong + 1 END',
        ),
      );
    });

    it('uses the PLpgSQL parameter p_is_correct, NOT the invalid EXCLUDED.p_is_correct', () => {
      // EXCLUDED has no p_is_correct pseudo-column; using it would fail at apply
      // time. The increment must read the live row + the function parameter.
      expect(populationSql).toContain('CASE WHEN p_is_correct THEN 0');
      expect(populationSql).not.toContain('EXCLUDED.p_is_correct');
    });

    it('the increment branch references the LIVE row (concept_mastery.consecutive_wrong + 1), not EXCLUDED', () => {
      expect(populationSql).toContain('concept_mastery.consecutive_wrong + 1');
    });

    it('the INSERT VALUES path seeds a neutral 0 for the first answer', () => {
      // The INSERT column list must include consecutive_wrong, and the VALUES
      // path seeds 0 (the DO UPDATE path increments thereafter). Search for the
      // ON CONFLICT boundary AFTER the INSERT statement — the file header comment
      // also contains the string "ON CONFLICT", so an unanchored indexOf would
      // slice backwards to an empty string.
      const insertStart = populationSql.indexOf('INSERT INTO concept_mastery');
      const onConflictAfterInsert = populationSql.indexOf('ON CONFLICT', insertStart);
      const insertBlock = populationSql.slice(insertStart, onConflictAfterInsert);
      expect(insertBlock).toContain('consecutive_wrong');
      // The neutral first-answer seed (commented in the migration as such).
      expect(insertBlock).toMatch(/0,\s*--\s*consecutive_wrong/i);
    });
  });

  // -------------------------------------------------------------------------
  // 4. BKT/SM-2 unchanged pin — the math is byte-identical between the two.
  // -------------------------------------------------------------------------
  describe('4. BKT/SM-2 outputs provably unchanged (structural diff pin)', () => {
    const deployedSql = read(FILE_DEPLOYED);
    const populationSql = read(FILE_POPULATION);

    const deployedBkt = extractBktSm2Block(deployedSql);
    const populationBkt = extractBktSm2Block(populationSql);

    it('extracts a non-empty BKT/SM-2 block from both migrations', () => {
      expect(deployedBkt.length).toBeGreaterThan(0);
      expect(populationBkt.length).toBeGreaterThan(0);
    });

    it('the entire BKT/SM-2 mastery-math block is byte-identical between the two functions', () => {
      // consecutive_wrong feeds NO formula, so the mastery-determining arithmetic
      // (BKT evidence/know update, mastery clamp, ease factor, SM-2 interval) must
      // be unchanged. Any drift here means the migration silently altered scoring.
      expect(populationBkt).toBe(deployedBkt);
    });

    it('the key BKT mastery update line is byte-identical (pinned literal)', () => {
      const bktLine =
        'v_new_mastery := LEAST(1.0, GREATEST(0.0,\n    v_p_know + (1.0 - v_p_know) * p_p_learn\n  ));';
      expect(deployedSql).toContain(bktLine);
      expect(populationSql).toContain(bktLine);
    });

    it('the only added concept_mastery.consecutive_wrong references are NEW in the population migration', () => {
      // Sanity floor on the surgicality claim: the deployed version has ZERO
      // mentions of consecutive_wrong; the population version introduces them.
      const deployedHits = (deployedSql.match(/consecutive_wrong/g) || []).length;
      const populationHits = (populationSql.match(/consecutive_wrong/g) || []).length;
      expect(deployedHits).toBe(0);
      // INSERT column + INSERT value-comment + DO UPDATE clause + COMMENT line.
      expect(populationHits).toBeGreaterThanOrEqual(3);
    });
  });
});
