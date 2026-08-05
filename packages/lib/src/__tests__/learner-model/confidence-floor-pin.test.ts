/**
 * Phase 2 confidence_score SCALE-SHIFT pin (assessment-flagged sweep, 2026-08-05).
 *
 * Migration 20260807000400 replaced the mastery_variance pseudo-decay
 * `GREATEST(0.01, 0.25/(1 + attempts*0.1))` with the Beta-posterior variance
 *   alpha = 1 + independent_correct*1.0 + hinted_correct*0.45
 *   beta  = 1 + (independent_attempts - independent_correct)*1.0
 *             + (hinted_attempts   - hinted_correct)*0.45
 *   variance = alpha*beta / ((alpha+beta)^2 * (alpha+beta+1))
 * and this variance feeds the confidence_score blend
 *   confidence_score = LEAST(1.0, mastery * (1 - variance)).
 *
 * SCALE SHIFT this documents: on LOW-ATTEMPT topics confidence_score is now
 * substantially HIGHER than under the old scale —
 *   1 attempt:  old factor 1 - 0.25/1.1      ≈ 0.7727 (×0.77)
 *               new factor 1 - 2/36          ≈ 0.9444 (×0.94, independent)
 *                                            ≈ 0.9300 (hinted, 0.45 pseudo-count)
 *   FLOOR: with α,β ≥ 1 the Beta variance is bounded by 1/12 ≈ 0.0833, so the
 *   blend factor can never drop below ~0.9167 — vs the old worst case ×0.7727.
 *
 * CONSUMER SWEEP RESULT (2026-08-05 audit, encoded below where pinnable):
 *   - progress page severity split (>0.7 critical / >0.4 high, page.tsx:475-477)
 *     and KnowledgeGapActions.computeSeverity consume the `get_knowledge_gaps`
 *     RPC output whose confidence is DERIVED AS `1 - mastery_probability`
 *     (migrations 20260623000700 / 20260623000800) — NOT the re-scaled
 *     concept_mastery.confidence_score. Their threshold semantics SURVIVE.
 *     Pinned here by asserting the derivation source in both RPC migrations.
 *   - exam-prep `.gte('confidence_score', 0.7)` + super-admin profile route +
 *     DataPanel read the knowledge_gaps TABLE (legacy detector confidence; no
 *     live writer re-points it to the new blend) — unaffected today, flagged
 *     as a watch item if a writer is ever added.
 *   - super-admin progress route / view-as page read
 *     concept_mastery.confidence_score DISPLAY-ONLY (no thresholds) — values
 *     rise on low-attempt topics, no semantics to break.
 *
 * SQL WINS: if any assertion fails, re-audit the consumers before touching
 * either side.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'supabase', 'migrations'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (supabase/migrations) not found');
}

function readMigration(name: string): string {
  return fs.readFileSync(
    path.join(findRepoRoot(), 'supabase', 'migrations', name),
    'utf8',
  );
}

const EVIDENCE_MIGRATION =
  '20260807000400_update_learner_state_post_quiz_evidence.sql';
const GAP_RPC_MIGRATION =
  '20260623000700_derive_bloom_progression_and_knowledge_gaps_from_concept_mastery.sql';
const GAP_DASHBOARD_MIGRATION =
  '20260623000800_derive_dashboard_bloom_and_gaps_from_concept_mastery.sql';

/** TS replica of the migration's Beta-posterior variance (for documentation
 *  fixtures only — SQL is the single writer; this is never used in app code). */
function betaVariance(
  indAttempts: number,
  indCorrect: number,
  hintAttempts: number,
  hintCorrect: number,
): number {
  const alpha = 1.0 + indCorrect * 1.0 + hintCorrect * 0.45;
  const beta =
    1.0 + (indAttempts - indCorrect) * 1.0 + (hintAttempts - hintCorrect) * 0.45;
  return (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1.0));
}

function oldPseudoDecayVariance(attempts: number): number {
  return Math.max(0.01, 0.25 / (1 + attempts * 0.1));
}

describe('confidence_score scale-shift pin — migration 20260807000400', () => {
  const sql = readMigration(EVIDENCE_MIGRATION);

  it('mastery_variance is the Beta-posterior (alpha/beta pseudo-counts, hinted discount 0.45)', () => {
    expect(sql).toContain("v_alpha := 1.0 + v_ind_correct * 1.0 + v_hint_correct * 0.45;");
    expect(sql).toContain('v_beta  := 1.0 + (v_ind_attempts - v_ind_correct) * 1.0');
    expect(sql).toContain('v_variance := (v_alpha * v_beta)');
    expect(sql).toContain('/ (((v_alpha + v_beta) ^ 2) * (v_alpha + v_beta + 1.0));');
  });

  it('v_variance has exactly ONE assignment (no residual pseudo-decay code path)', () => {
    const assignments = sql.match(/v_variance\s*:=/g) ?? [];
    expect(assignments).toHaveLength(1);
    // The old pseudo-decay may be cited in comments, but must not be assigned.
    expect(sql).not.toMatch(/v_variance\s*:=\s*GREATEST\(0\.01/);
  });

  it('confidence_score blend LEAST(1.0, mastery * (1 - variance)) appears in BOTH the INSERT and the RETURN jsonb', () => {
    const blends =
      sql.match(/LEAST\(1\.0, v_new_mastery \* \(1\.0 - v_variance\)\)/g) ?? [];
    expect(blends.length).toBe(2);
  });

  it('documents the new floor: 1-attempt blend factor ≈ 0.944 independent / 0.930 hinted (old ≈ 0.773)', () => {
    // First INDEPENDENT correct attempt: alpha=2, beta=1 → 2/36.
    const vIndependent = betaVariance(1, 1, 0, 0);
    expect(vIndependent).toBeCloseTo(2 / 36, 10);
    expect(1 - vIndependent).toBeCloseTo(0.9444, 3);
    // First independent WRONG attempt is symmetric (alpha=1, beta=2).
    expect(betaVariance(1, 0, 0, 0)).toBeCloseTo(vIndependent, 10);
    // First HINTED correct attempt: alpha=1.45, beta=1 → factor ≈ 0.930.
    expect(1 - betaVariance(0, 0, 1, 1)).toBeCloseTo(0.93, 2);
    // Old pseudo-decay at 1 attempt: 0.25/1.1 → factor ≈ 0.7727.
    expect(1 - oldPseudoDecayVariance(1)).toBeCloseTo(0.7727, 3);
    // The shift assessment flagged: ×0.94 vs ×0.77 on low-attempt topics.
    expect(1 - vIndependent).toBeGreaterThan(1 - oldPseudoDecayVariance(1));
  });

  it('hard floor on the new scale: blend factor never drops below 1 - 1/12 ≈ 0.9167 for any counts', () => {
    const cases: Array<[number, number, number, number]> = [
      [1, 1, 0, 0],
      [1, 0, 0, 0],
      [0, 0, 1, 1],
      [0, 0, 1, 0],
      [5, 3, 2, 1],
      [20, 10, 10, 5],
      [100, 100, 0, 0],
      [100, 0, 0, 0],
    ];
    for (const [ia, ic, ha, hc] of cases) {
      const v = betaVariance(ia, ic, ha, hc);
      expect(v).toBeLessThanOrEqual(1 / 12 + 1e-12);
      expect(1 - v).toBeGreaterThanOrEqual(1 - 1 / 12 - 1e-12);
    }
  });

  it('variance shrinks monotonically as independent evidence accumulates (confidence tightens)', () => {
    let prev = Infinity;
    for (let n = 1; n <= 20; n++) {
      const v = betaVariance(n, n, 0, 0);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('hinted evidence is weaker than independent evidence (higher variance at equal counts)', () => {
    expect(betaVariance(0, 0, 1, 1)).toBeGreaterThan(betaVariance(1, 1, 0, 0));
    expect(betaVariance(0, 0, 10, 10)).toBeGreaterThan(betaVariance(10, 10, 0, 0));
  });
});

describe('confidence_score consumer survival — gap RPCs derive their own confidence from mastery, NOT from concept_mastery.confidence_score', () => {
  it('get_knowledge_gaps (20260623000700) derives confidence_score = 1 - mastery_probability', () => {
    const sql = readMigration(GAP_RPC_MIGRATION);
    expect(sql).toContain(
      '(1 - COALESCE(cm.mastery_probability, 0)) AS confidence_score',
    );
    // The severity split the progress page + KnowledgeGapActions re-derive
    // (strict >0.7 / >0.4) is computed on THIS derived value.
    expect(sql).toContain("WHEN w.confidence_score > 0.7 THEN 'critical'");
    expect(sql).toContain("WHEN w.confidence_score > 0.4 THEN 'high'");
    // Never reads the re-scaled concept_mastery.confidence_score column.
    expect(sql).not.toContain('cm.confidence_score');
  });

  it('dashboard gap derivation (20260623000800) also derives 1 - mastery_probability and never reads cm.confidence_score', () => {
    const sql = readMigration(GAP_DASHBOARD_MIGRATION);
    expect(sql).toContain(
      'ROUND((1 - COALESCE(cm.mastery_probability, 0))::numeric, 4) AS confidence_score',
    );
    expect(sql).not.toContain('cm.confidence_score');
  });
});
