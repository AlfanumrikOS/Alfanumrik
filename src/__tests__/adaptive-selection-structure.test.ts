import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PHASE 1 adaptive-loop fix — STRUCTURAL pins (always-on, runs in normal CI).
 *
 * Companion to the integration-lane e2e (migrations/adaptive-selection-e2e.test.ts).
 * These pins do NOT need a database: they grep the migration source so the
 * adaptive WIRING (which collapsed to random / threw 42883) cannot silently
 * regress back to the broken joins.
 *
 * Three migrations are pinned:
 *   - 20260622040000_fix_get_adaptive_questions_topic_join.sql
 *       get_adaptive_questions: join on topic_id (NOT concept_id), exclude via
 *       quiz_responses (NOT question_responses), 7-col RETURNS TABLE + 5-arg sig.
 *   - 20260622050000_restore_compute_post_quiz_action.sql
 *       compute_post_quiz_action restored: mastery_probability (NOT
 *       mastery_level::FLOAT), curriculum_topics (NOT chapter_topics).
 *   - 20260622060000_phase1_adaptive_refinement_retention_and_softdelete.sql
 *       revise gated on current_retention IS NOT NULL; get_adaptive_questions
 *       filters is_active + deleted_at on all branches. This is the FINAL body
 *       of both functions (re-CREATE-OR-REPLACEs both), so the live-shape pins
 *       assert against it.
 *
 * THE BUGS THESE WOULD CATCH (silent regression to the broken wiring):
 *   - re-introducing `qb.concept_id` (column absent on prod -> 42703, cognitive
 *     mode throws, empty ZPD pool).
 *   - excluding via `question_responses` (0 rows on prod -> every question looks
 *     unanswered + pure-random ordering, no adaptivity, infinite repeats).
 *   - using `mastery_level::FLOAT` (mastery_level is a TEXT enum -> cast throws).
 *   - joining `chapter_topics` (absent on prod -> 42P01).
 *   - un-gating the `revise` branch (NULL retention coalesced to 0 false-fired
 *     'revise'/"Retention dropped to 0%" for 36/54 rows).
 *   - dropping the is_active / deleted_at soft-delete guard (P6: never serve an
 *     inactive or soft-deleted question).
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (resilient-mastery-perform-structure.test.ts, track-a6-migration-conformance.test.ts).
 */

const FIX_ADAPTIVE =
  'supabase/migrations/20260622040000_fix_get_adaptive_questions_topic_join.sql';
const RESTORE_CME =
  'supabase/migrations/20260622050000_restore_compute_post_quiz_action.sql';
const REFINE =
  'supabase/migrations/20260622060000_phase1_adaptive_refinement_retention_and_softdelete.sql';

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
 *  never matches the RCA prose in the header comments (which mention the OLD,
 *  broken identifiers like concept_id / question_responses / mastery_level). */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

/**
 * Like normalised(), but ALSO strips the non-executable string-literal prose so
 * NEGATIVE assertions (`.not.toMatch`) don't trip on the RCA narrative that
 * legitimately names the OLD broken identifiers (concept_id, question_responses,
 * mastery_level::FLOAT, chapter_topics) inside:
 *   - COMMENT ON ... IS '...';  (the function/column comments)
 *   - the admin_audit_log INSERT ... VALUES (...) jsonb prose
 * These are documentation, not wiring. We assert wiring against the function
 * body only. Positive assertions still use normalised() (the full text).
 */
function codeOnly(rel: string): string {
  let sql = normalised(rel);
  // Drop every COMMENT ON ... ; statement (its IS '...' body holds the RCA prose).
  sql = sql.replace(/COMMENT ON [^;]*;/gi, ' ');
  // Drop the trailing audit INSERT (from the INSERT keyword to the final COMMIT).
  sql = sql.replace(/INSERT INTO public\.admin_audit_log[\s\S]*$/i, ' ');
  return sql;
}

describe('Phase-1 adaptive-loop fix — migrations present', () => {
  it('get_adaptive_questions topic-join fix migration exists', () => {
    expect(resolve(FIX_ADAPTIVE)).not.toBeNull();
  });
  it('compute_post_quiz_action restore migration exists', () => {
    expect(resolve(RESTORE_CME)).not.toBeNull();
  });
  it('phase-1 refinement (retention gate + soft-delete) migration exists', () => {
    expect(resolve(REFINE)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// get_adaptive_questions — wiring pins (against BOTH the original fix 040000 and
// the final refinement 060000, since 060000 re-emits the full body).
// ───────────────────────────────────────────────────────────────────────────
describe('Phase-1 fix — get_adaptive_questions joins on topic_id (NOT concept_id)', () => {
  for (const m of [FIX_ADAPTIVE, REFINE]) {
    describe(path.basename(m), () => {
      it('re-emits get_adaptive_questions (CREATE OR REPLACE)', () => {
        expect(normalised(m)).toMatch(
          /CREATE OR REPLACE FUNCTION public\.get_adaptive_questions/i,
        );
      });

      it('joins concept_mastery on cm.topic_id = qb.topic_id', () => {
        expect(normalised(m)).toMatch(
          /JOIN concept_mastery cm ON cm\.topic_id = qb\.topic_id/i,
        );
      });

      it('does NOT reference the absent qb.concept_id join key (the 42703 break)', () => {
        // The broken v1 did `JOIN concept_mastery cm ON qb.concept_id = cm.concept_id`.
        // qb.concept_id does not exist on prod. The function BODY (comments + audit
        // prose stripped) must never reference it again.
        expect(codeOnly(m)).not.toMatch(/qb\.concept_id/i);
      });

      it('excludes already-answered via quiz_responses on student_id (direct)', () => {
        const sql = normalised(m);
        expect(sql).toMatch(/LEFT JOIN quiz_responses qr/i);
        expect(sql).toMatch(/qr\.student_id\s*=\s*p_student_id/i);
        expect(sql).toMatch(/qr\.id IS NULL/i);
      });

      it('does NOT exclude via question_responses (empty on prod -> pure-random break)', () => {
        expect(codeOnly(m)).not.toMatch(/question_responses/i);
      });

      it('preserves the EXACT 5-arg signature', () => {
        const sql = normalised(m);
        expect(sql).toMatch(/p_student_id\s+uuid/i);
        expect(sql).toMatch(/p_subject\s+text/i);
        expect(sql).toMatch(/p_limit\s+integer/i);
        expect(sql).toMatch(/p_include_review\s+boolean/i);
        expect(sql).toMatch(/p_mode\s+text/i);
      });

      it('preserves the EXACT 7-column RETURNS TABLE shape, in order', () => {
        const sql = normalised(m);
        // question_id uuid, question_type text, bloom_level text,
        // priority_score numeric, source text, board_year integer, paper_section text
        expect(sql).toMatch(
          /RETURNS TABLE\(\s*question_id\s+uuid\s*,\s*question_type\s+text\s*,\s*bloom_level\s+text\s*,\s*priority_score\s+numeric\s*,\s*source\s+text\s*,\s*board_year\s+integer\s*,\s*paper_section\s+text\s*\)/i,
        );
      });

      it('DROPs only the exact 5-arg overload before re-creating (idempotent guard, not data)', () => {
        expect(normalised(m)).toMatch(
          /DROP FUNCTION IF EXISTS public\.get_adaptive_questions\(\s*uuid\s*,\s*text\s*,\s*integer\s*,\s*boolean\s*,\s*text\s*\)/i,
        );
      });
    });
  }
});

describe('Phase-1 fix — get_adaptive_questions filters is_active AND deleted_at (P6, refinement 060000)', () => {
  // The soft-delete guard is added by 060000 (the FINAL body). Pin it there.
  it('every served question must be is_active = true', () => {
    expect(normalised(REFINE)).toMatch(/qb\.is_active\s*=\s*true/i);
  });

  it('every served question must have deleted_at IS NULL', () => {
    expect(normalised(REFINE)).toMatch(/qb\.deleted_at IS NULL/i);
  });

  it('the soft-delete guard is on ALL THREE branches (cognitive due+zpd, board, practice)', () => {
    // The two cognitive CTEs + the board branch + the practice branch each carry
    // `qb.deleted_at IS NULL`. There are 4 such WHERE clauses total
    // (due_reviews, zpd_questions, board, practice).
    const sql = normalised(REFINE);
    const occurrences = (sql.match(/qb\.deleted_at IS NULL/gi) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// compute_post_quiz_action — wiring pins (against BOTH restore 050000 and the
// final refinement 060000, since 060000 re-emits the full body).
// ───────────────────────────────────────────────────────────────────────────
describe('Phase-1 fix — compute_post_quiz_action exists with the corrected schema wiring', () => {
  for (const m of [RESTORE_CME, REFINE]) {
    describe(path.basename(m), () => {
      it('re-emits compute_post_quiz_action (CREATE OR REPLACE)', () => {
        expect(normalised(m)).toMatch(
          /CREATE OR REPLACE FUNCTION public\.compute_post_quiz_action/i,
        );
      });

      it('uses mastery_probability (NOT mastery_level::FLOAT, which would throw on the TEXT enum)', () => {
        expect(normalised(m)).toMatch(/mastery_probability/i);
        // The broken cast must never reappear (mastery_level is a TEXT enum on prod).
        // Assert against the BODY only (audit prose legitimately names the old cast).
        expect(codeOnly(m)).not.toMatch(/mastery_level\s*::\s*float/i);
      });

      it('joins curriculum_topics (NOT the absent chapter_topics)', () => {
        expect(normalised(m)).toMatch(/JOIN curriculum_topics ct ON ct\.id = cm\.topic_id/i);
        // Body only: audit prose legitimately names the old chapter_topics table.
        expect(codeOnly(m)).not.toMatch(/chapter_topics/i);
      });

      it('preserves the 3-arg signature + 3-col RETURNS TABLE contract', () => {
        const sql = normalised(m);
        expect(sql).toMatch(/p_student_id\s+uuid/i);
        expect(sql).toMatch(/p_subject\s+text/i);
        expect(sql).toMatch(/p_grade\s+text/i);
        expect(sql).toMatch(
          /RETURNS TABLE\(\s*action_type\s+text\s*,\s*concept_id\s+uuid\s*,\s*reason\s+text\s*\)/i,
        );
      });

      it('classifies the weakest-topic mastery ladder into the 6 action types', () => {
        const sql = normalised(m);
        for (const action of [
          'remediate',
          'revise',
          'teach',
          'practice',
          'challenge',
          'exam_prep',
        ]) {
          expect(sql).toMatch(new RegExp(`'${action}'`, 'i'));
        }
      });

      it('Priority-1 remediate fires on error_count_conceptual >= 3', () => {
        expect(normalised(m)).toMatch(/error_count_conceptual\s*,?\s*0?\)?\s*>=\s*3/i);
      });
    });
  }
});

describe('Phase-1 fix — revise branch gated on measured retention (refinement 060000)', () => {
  // The gate is added by 060000 (the FINAL body). Pin it there.
  it('Priority-2 revise is gated on current_retention IS NOT NULL', () => {
    expect(normalised(REFINE)).toMatch(/cm\.current_retention IS NOT NULL/i);
  });

  it('the revise gate still requires current_retention < 0.5', () => {
    expect(normalised(REFINE)).toMatch(/cm\.current_retention\s*<\s*0\.5/i);
  });

  it('still emits the revise action when the (now gated) branch fires', () => {
    expect(normalised(REFINE)).toMatch(/'revise'::text/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Non-destructive / additive posture (P5-safe, no schema teardown).
// ───────────────────────────────────────────────────────────────────────────
describe('Phase-1 fix — migrations are non-destructive', () => {
  it('no migration drops a table or column', () => {
    for (const m of [FIX_ADAPTIVE, RESTORE_CME, REFINE]) {
      const sql = normalised(m);
      expect(sql).not.toMatch(/DROP TABLE/i);
      expect(sql).not.toMatch(/DROP COLUMN/i);
    }
  });

  it('the CME-column additions are additive (ADD COLUMN IF NOT EXISTS)', () => {
    const sql = normalised(RESTORE_CME);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+cme_next_concept_id/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+cme_reason/i);
  });

  it('both functions are GRANTed to authenticated + service_role', () => {
    for (const m of [FIX_ADAPTIVE, RESTORE_CME, REFINE]) {
      expect(normalised(m)).toMatch(/GRANT EXECUTE ON FUNCTION.*TO authenticated, service_role/i);
    }
  });
});
