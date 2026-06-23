import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Canonical-mastery production fix — STRUCTURAL pins
 * (always-on, runs in normal CI; no database required).
 *
 * Companion to the integration-lane e2e (migrations/canonical-mastery-e2e.test.ts).
 * These pins grep the migration SOURCE so the two changes cannot silently
 * regress.
 *
 * THE BUG (RCA): the historical BKT writer stored the NUMERIC posterior as TEXT
 * in `mastery_level` and left the canonical numeric columns (`mastery_probability`
 * + `p_know`) frozen at the 0.1 default. Every dashboard/selector that reads a
 * NUMBER read the stale 0.1; every reader of the band read a number-as-text.
 *
 * THE FIX (two migrations):
 *   - 20260623000100_fix_post_quiz_canonical_mastery.sql
 *       update_learner_state_post_quiz now writes:
 *         mastery_probability = v_new_mastery   (canonical numeric)
 *         p_know              = v_new_mastery   (mirrors the same posterior)
 *         mastery_level       = DERIVED band via the CASE (NOT v_new_mastery::TEXT)
 *       prior-read is COALESCE(cm.mastery_probability, 0.1) — never a
 *       mastery_level::FLOAT cast.
 *       SECURITY DEFINER + SET search_path = public + the DROP FUNCTION IF EXISTS
 *       (exact 10-arg signature) + CREATE OR REPLACE idempotency guard retained.
 *   - 20260623000000_backfill_canonical_mastery_columns.sql
 *       idempotent, non-destructive (no DROP/DELETE) backfill that lifts the
 *       stranded numeric-as-text into mastery_probability + p_know and derives
 *       the band into mastery_level; guarded so re-runs touch 0 rows.
 *
 * THE BUGS THESE WOULD CATCH:
 *   - reverting the writer to mastery_level = v_new_mastery::TEXT (numeric-in-text).
 *   - dropping mastery_probability / p_know from the INSERT or ON CONFLICT set.
 *   - reverting the prior-read to mastery_level::FLOAT (reads the band as a number).
 *   - losing SECURITY DEFINER / search_path / the DROP+CREATE idempotency guard.
 *   - the backfill becoming destructive (DROP/DELETE) or losing its idempotency
 *     guards (re-run would double-apply / churn).
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (sm2-interval-clamp-structure.test.ts, adaptive-selection-structure.test.ts).
 */

const WRITER =
  'supabase/migrations/20260623000100_fix_post_quiz_canonical_mastery.sql';
const BACKFILL =
  'supabase/migrations/20260623000000_backfill_canonical_mastery_columns.sql';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip line comments so matching is layout-tolerant and
 *  never matches the RCA prose in the header comments. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}
/**
 * Like normalised(), but ALSO strips the non-executable string-literal prose
 * (COMMENT ON ... ; bodies + RAISE NOTICE strings) so NEGATIVE assertions
 * (`.not.toMatch`) don't trip on the header/comment narrative that legitimately
 * names the FORBIDDEN constructs (e.g. the COMMENT explains "instead of
 * v_new_mastery::TEXT"). We assert forbidden-construct absence against the
 * executable body only.
 */
function codeOnly(rel: string): string {
  let sql = normalised(rel);
  sql = sql.replace(/COMMENT ON [^;]*;/gi, ' ');
  sql = sql.replace(/RAISE NOTICE[^;]*;/gi, ' ');
  return sql;
}

// ───────────────────────────────────────────────────────────────────────────
describe('canonical-mastery fix — migrations present', () => {
  it('post-quiz canonical-mastery writer migration exists', () => {
    expect(resolve(WRITER)).not.toBeNull();
  });
  it('canonical-mastery backfill migration exists', () => {
    expect(resolve(BACKFILL)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Writer migration (20260623000100) — canonical write contract.
// ───────────────────────────────────────────────────────────────────────────
describe('post-quiz writer — update_learner_state_post_quiz canonical write', () => {
  it('idempotency: DROP FUNCTION IF EXISTS the exact 10-arg signature + CREATE OR REPLACE', () => {
    const sql = normalised(WRITER);
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.update_learner_state_post_quiz\(\s*UUID,\s*UUID,\s*BOOLEAN,\s*TEXT,\s*TEXT,\s*INT,\s*INT,\s*FLOAT,\s*FLOAT,\s*FLOAT\s*\)/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION update_learner_state_post_quiz/i);
  });

  it('hardening retained: SECURITY DEFINER + SET search_path = public', () => {
    const sql = normalised(WRITER);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path\s*=\s*public/i);
  });

  it('prior-read uses the canonical numeric column mastery_probability (NOT a mastery_level::FLOAT cast)', () => {
    const sql = normalised(WRITER);
    // Prior read = COALESCE(cm.mastery_probability, 0.1)
    expect(sql).toMatch(/COALESCE\(\s*cm\.mastery_probability\s*,\s*0\.1\s*\)/i);
    // and must NOT cast the band label to a float as a mastery source.
    expect(codeOnly(WRITER)).not.toMatch(/cm\.mastery_level\s*::\s*FLOAT/i);
  });

  it('INSERT column list includes mastery_level, mastery_probability AND p_know', () => {
    const sql = normalised(WRITER);
    expect(sql).toMatch(
      /INSERT INTO concept_mastery\s*\([^)]*\bmastery_level\b[^)]*\bmastery_probability\b[^)]*\bp_know\b/i,
    );
  });

  it('mastery_level VALUE is the derived band CASE, NEVER v_new_mastery::TEXT', () => {
    const code = codeOnly(WRITER);
    // The band CASE with the exact thresholds + labels must be present.
    expect(code).toMatch(/WHEN\s+v_new_mastery\s*>=\s*0\.95\s+THEN\s+'mastered'/i);
    expect(code).toMatch(/WHEN\s+v_new_mastery\s*>=\s*0\.70\s+THEN\s+'proficient'/i);
    expect(code).toMatch(/WHEN\s+v_new_mastery\s*>=\s*0\.40\s+THEN\s+'developing'/i);
    expect(code).toMatch(/ELSE\s+'beginner'/i);
    expect(code).toMatch(/THEN\s+'not_started'/i);
    // and the buggy numeric-into-text write must be GONE from the executable body.
    expect(code).not.toMatch(/mastery_level\s*=\s*v_new_mastery\s*::\s*TEXT/i);
    expect(code).not.toMatch(/v_new_mastery\s*::\s*TEXT/i);
  });

  it('INSERT VALUES set mastery_probability AND p_know to the numeric posterior (v_new_mastery)', () => {
    const sql = normalised(WRITER);
    // The VALUES list carries v_new_mastery twice (mastery_probability + p_know).
    // Pin the inline comments that name each canonical column, both = v_new_mastery.
    expect(read(WRITER)).toMatch(/v_new_mastery,\s*--\s*mastery_probability/i);
    expect(read(WRITER)).toMatch(/v_new_mastery,\s*--\s*p_know/i);
    expect(sql).toMatch(/v_new_mastery/);
  });

  it('ON CONFLICT DO UPDATE sets mastery_probability AND p_know AND mastery_level from EXCLUDED', () => {
    const sql = normalised(WRITER);
    expect(sql).toMatch(/ON CONFLICT \(student_id, topic_id\) DO UPDATE SET/i);
    expect(sql).toMatch(/mastery_probability\s*=\s*EXCLUDED\.mastery_probability/i);
    expect(sql).toMatch(/p_know\s*=\s*EXCLUDED\.p_know/i);
    expect(sql).toMatch(/mastery_level\s*=\s*EXCLUDED\.mastery_level/i);
  });

  it('dead update_concept_mastery_bkt is neutralized to the canonical layout (no numeric-in-text)', () => {
    const sql = normalised(WRITER);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_concept_mastery_bkt/i);
    // It too must write canonical columns and a band, never numeric-into-text.
    expect(sql).toMatch(/mastery_probability\s*=\s*EXCLUDED\.mastery_probability/i);
    expect(codeOnly(WRITER)).not.toMatch(/mastery_level\s*=\s*v_new_mastery\s*::\s*TEXT/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Backfill migration (20260623000000) — idempotent + non-destructive.
// ───────────────────────────────────────────────────────────────────────────
describe('canonical-mastery backfill — idempotent + non-destructive', () => {
  it('lifts the numeric-as-text posterior into mastery_probability AND p_know', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(
      /SET mastery_probability\s*=\s*cm\.mastery_level\s*::\s*double precision/i,
    );
    expect(sql).toMatch(/p_know\s*=\s*cm\.mastery_level\s*::\s*double precision/i);
  });

  it('derives the band into mastery_level via the CASE (same vocabulary as the writer)', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(/THEN\s+'mastered'/i);
    expect(sql).toMatch(/THEN\s+'proficient'/i);
    expect(sql).toMatch(/THEN\s+'developing'/i);
    expect(sql).toMatch(/ELSE\s+'beginner'/i);
    expect(sql).toMatch(/THEN\s+'not_started'/i);
  });

  it('idempotency guard A: only rewrites numeric-as-text rows (^[0-9.]+$) and skips already-canonical', () => {
    const sql = normalised(BACKFILL);
    // The numeric-as-text WHERE filter.
    expect(sql).toMatch(/WHERE\s+cm\.mastery_level\s*~\s*'\^\[0-9\.\]\+\$'/i);
    // Value-idempotent guard avoids churn on a partially-fixed row.
    expect(sql).toMatch(/mastery_probability IS DISTINCT FROM cm\.mastery_level\s*::\s*double precision/i);
  });

  it('idempotency guard B: label-placeholder branch only fires when mastery_probability = 0.1', () => {
    const sql = normalised(BACKFILL);
    expect(sql).toMatch(/cm\.mastery_probability\s*=\s*0\.1/i);
    // and it targets the NON-numeric (label) rows.
    expect(sql).toMatch(/cm\.mastery_level\s*!~\s*'\^\[0-9\.\]\+\$'/i);
  });

  it('is strictly non-destructive — NO DELETE, NO DROP TABLE/COLUMN', () => {
    const code = codeOnly(BACKFILL);
    expect(code).not.toMatch(/\bDELETE\b/i);
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('does not re-grade history — no XP / score / quiz_sessions writes (P1/P2 freeze)', () => {
    const code = codeOnly(BACKFILL);
    expect(code).not.toMatch(/atomic_quiz_profile_update/i);
    expect(code).not.toMatch(/quiz_sessions/i);
    expect(code).not.toMatch(/xp_total/i);
  });
});
