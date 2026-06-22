import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PHASE 0 adaptive-loop fix — STRUCTURAL pin (always-on, runs in normal CI).
 *
 * Companion to the integration-lane e2e (adaptive-loop-e2e.test.ts). This pin
 * does NOT need a database: it greps the migration source so the error-isolation
 * that makes the quiz-submit resilient cannot silently regress.
 *
 * What it guards:
 *   1. Both Phase-0 migrations exist on disk.
 *   2. 20260622030000 wraps the per-response PERFORM update_learner_state_post_quiz(...)
 *      in a BEGIN … EXCEPTION WHEN OTHERS … END block. If a future edit re-emits the
 *      RPC body with the PERFORM un-wrapped (the original break), a single failing
 *      learner-state write would again abort the whole submit — this test fails first.
 *   3. The 13 CME/BKT columns the RPC writes are added by 20260622020000 (the other
 *      half of the break: the RPC threw because these columns were missing).
 *   4. Migrations stay non-destructive (no DROP TABLE / DROP COLUMN) and additive
 *      (ADD COLUMN IF NOT EXISTS).
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (track-a6-migration-conformance.test.ts, monitoring/intervention-alerts-rls.test.ts).
 */

const RESILIENT_MIGRATION =
  'supabase/migrations/20260622030000_submit_quiz_v2_resilient_mastery_perform.sql';
const COLUMNS_MIGRATION =
  'supabase/migrations/20260622020000_add_concept_mastery_cme_columns.sql';

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
/** Collapse whitespace + strip line comments so matching is layout-tolerant. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

// The 13 columns update_learner_state_post_quiz writes — their absence on live
// is what made the RPC throw. Stay in lockstep with 20260615181255's upsert.
const CME_COLUMNS = [
  'mastery_variance',
  'retention_half_life',
  'current_retention',
  'max_difficulty_succeeded',
  'error_count_conceptual',
  'error_count_procedural',
  'error_count_careless',
  'avg_response_time_ms',
  'confidence_score',
  'mastery_velocity',
  'bloom_mastery',
  'cme_action_type',
  'cme_action_at',
] as const;

describe('Phase-0 adaptive-loop fix — migrations present', () => {
  it('resilient submit_quiz_results_v2 migration exists', () => {
    expect(resolve(RESILIENT_MIGRATION)).not.toBeNull();
  });
  it('concept_mastery CME-columns migration exists', () => {
    expect(resolve(COLUMNS_MIGRATION)).not.toBeNull();
  });
});

describe('Phase-0 fix — per-response PERFORM is error-isolated (cannot regress)', () => {
  it('re-emits submit_quiz_results_v2 (CREATE OR REPLACE)', () => {
    expect(normalised(RESILIENT_MIGRATION)).toMatch(
      /CREATE OR REPLACE FUNCTION public\.submit_quiz_results_v2/i,
    );
  });

  it('calls update_learner_state_post_quiz per response', () => {
    expect(normalised(RESILIENT_MIGRATION)).toMatch(
      /PERFORM\s+update_learner_state_post_quiz\s*\(/i,
    );
  });

  it('wraps that PERFORM in a BEGIN … EXCEPTION WHEN OTHERS … END block', () => {
    const sql = normalised(RESILIENT_MIGRATION);

    // The PERFORM must sit between a BEGIN and an EXCEPTION WHEN OTHERS that
    // belong to the same wrapping block. We assert the ordered substring:
    //   BEGIN … PERFORM update_learner_state_post_quiz( … EXCEPTION WHEN OTHERS
    // with no intervening END (which would close the block before the PERFORM).
    const wrapped =
      /BEGIN\s+PERFORM\s+update_learner_state_post_quiz\s*\([^;]*\)\s*;\s*EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i;
    expect(sql).toMatch(wrapped);
  });

  it('the isolation handler RAISE NOTICEs (non-fatal) rather than re-raising', () => {
    const sql = normalised(RESILIENT_MIGRATION);
    // Within the per-response isolation block the handler must be a RAISE NOTICE,
    // never a bare RAISE / RAISE EXCEPTION (which would re-abort the submit).
    const block = sql.match(
      /BEGIN\s+PERFORM\s+update_learner_state_post_quiz\s*\([^;]*\)\s*;\s*EXCEPTION\s+WHEN\s+OTHERS\s+THEN([\s\S]*?)END\s*;/i,
    );
    expect(block).not.toBeNull();
    const handler = block![1];
    expect(handler).toMatch(/RAISE\s+NOTICE/i);
    expect(handler).not.toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('the authoritative atomic_quiz_profile_update still runs (score/XP unaffected)', () => {
    expect(normalised(RESILIENT_MIGRATION)).toMatch(/PERFORM\s+atomic_quiz_profile_update\s*\(/i);
  });
});

describe('Phase-0 fix — concept_mastery CME columns are added additively', () => {
  it('adds every column update_learner_state_post_quiz writes, with IF NOT EXISTS', () => {
    const sql = normalised(COLUMNS_MIGRATION);
    for (const col of CME_COLUMNS) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i'));
    }
  });
});

describe('Phase-0 fix — migrations are non-destructive', () => {
  it('neither migration drops a table or column', () => {
    for (const m of [RESILIENT_MIGRATION, COLUMNS_MIGRATION]) {
      const sql = normalised(m);
      expect(sql).not.toMatch(/DROP TABLE/i);
      expect(sql).not.toMatch(/DROP COLUMN/i);
    }
  });

  it('the resilient migration only DROPs the exact function overload before re-creating it', () => {
    // DROP FUNCTION IF EXISTS … submit_quiz_results_v2(<9 args>) is the idempotent
    // re-create guard — allowed. Assert it targets the function, not data.
    expect(normalised(RESILIENT_MIGRATION)).toMatch(
      /DROP FUNCTION IF EXISTS public\.submit_quiz_results_v2\s*\(/i,
    );
  });
});
