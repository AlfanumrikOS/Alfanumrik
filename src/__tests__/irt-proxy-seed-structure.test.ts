/**
 * Phase 5 — IRT-proxy difficulty seed — STRUCTURAL pins
 * (Lane: NORMAL — always-on, no database required.)
 *
 * Pins the migration source
 *   supabase/migrations/20260622100000_seed_irt_difficulty_proxy.sql
 * so the data seed cannot silently regress. It gives the proxy ranking path
 * (computeSelectionScore / select_questions_by_irt_info) real theta-scale signal
 * BEFORE 2PL calibration accrues, by mapping the curated integer difficulty band
 * onto irt_difficulty for UNCALIBRATED items only.
 *
 * THE BUGS THESE WOULD CATCH:
 *   - the band map drifting from easy=-1 / medium=0 / hard=+1 (would mis-rank
 *     every uncalibrated item against the student's theta).
 *   - dropping the uncalibrated-only guard (irt_calibration_n + irt_calibrated)
 *     → the seed would CLOBBER real 2PL-fitted irt_b values written by the IRT
 *     cron, corrupting Fisher-info selection.
 *   - dropping the `IS DISTINCT FROM` idempotency guard → a re-run writes 0.0
 *     over 0.0 (medium/ELSE bands) and churns updated_at, breaking value-stable
 *     idempotency.
 *   - the seed becoming destructive (DROP / DELETE / touching another table).
 *
 * Mirrors the repo's grep-the-migration-file conformance style
 * (sm2-interval-clamp-structure.test.ts, adaptive-selection-structure.test.ts).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SEED = 'supabase/migrations/20260622100000_seed_irt_difficulty_proxy.sql';

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

// ───────────────────────────────────────────────────────────────────────────
describe('IRT-proxy seed — migration present', () => {
  it('the seed migration exists', () => {
    expect(resolve(SEED)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('IRT-proxy seed — band map (-1.0 / 0.0 / +1.0)', () => {
  it('maps the integer difficulty band 1/2/3 to -1.0 / 0.0 / +1.0', () => {
    const sql = normalised(SEED);
    // CASE difficulty WHEN 1 THEN -1.0 WHEN 2 THEN 0.0 WHEN 3 THEN 1.0 ELSE 0.0
    expect(sql).toMatch(/CASE\s+difficulty/i);
    expect(sql).toMatch(/WHEN\s+1\s+THEN\s+-1\.0/i);
    expect(sql).toMatch(/WHEN\s+2\s+THEN\s+0\.0/i);
    expect(sql).toMatch(/WHEN\s+3\s+THEN\s+1\.0/i);
    expect(sql).toMatch(/ELSE\s+0\.0/i);
  });

  it('writes the irt_difficulty column on question_bank only (UPDATE target)', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/UPDATE\s+public\.question_bank/i);
    expect(sql).toMatch(/SET\s+irt_difficulty\s*=/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('IRT-proxy seed — uncalibrated-only guard (never clobber real 2PL)', () => {
  it('only touches rows still at the default/unseeded irt_difficulty (NULL or 0)', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/WHERE\s*\(\s*irt_difficulty\s+IS\s+NULL\s+OR\s+irt_difficulty\s*=\s*0\s*\)/i);
  });

  it('excludes any 2PL-fitted item (irt_calibration_n = 0 guard)', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/COALESCE\(\s*irt_calibration_n\s*,\s*0\s*\)\s*=\s*0/i);
  });

  it('excludes any calibrated item (irt_calibrated IS NOT TRUE guard)', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/irt_calibrated\s+IS\s+NOT\s+TRUE/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('IRT-proxy seed — value-stable idempotency (IS DISTINCT FROM)', () => {
  it('skips rows already at the exact target via IS DISTINCT FROM the same CASE', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/irt_difficulty\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+difficulty/i);
    // The idempotency CASE must re-state the SAME band map (so the guard tracks
    // the write exactly). Two CASE difficulty blocks => SET + IS DISTINCT FROM.
    const caseCount = (sql.match(/CASE\s+difficulty/gi) ?? []).length;
    expect(caseCount).toBeGreaterThanOrEqual(2);
  });

  it('is wrapped in an idempotent DO block guarded by to_regclass (fresh-DB safe)', () => {
    const sql = normalised(SEED);
    expect(sql).toMatch(/DO\s+\$seed_irt_difficulty_proxy\$/i);
    expect(sql).toMatch(/to_regclass\(\s*'public\.question_bank'\s*\)\s+IS\s+NOT\s+NULL/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('IRT-proxy seed — non-destructive (UPDATE-only on question_bank)', () => {
  it('contains no DROP TABLE / DROP COLUMN', () => {
    const sql = normalised(SEED);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('performs no DELETE and no TRUNCATE', () => {
    const sql = normalised(SEED);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('does not CREATE/ALTER any table or column (pure data seed)', () => {
    const sql = normalised(SEED);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('never writes scoring/XP-adjacent columns (P1/P2 untouched)', () => {
    const sql = normalised(SEED);
    // Only irt_difficulty is set; assert no stray score/xp writes crept in.
    expect(sql).not.toMatch(/score_percent/i);
    expect(sql).not.toMatch(/xp_total/i);
    // The ONLY question_bank column SET is irt_difficulty.
    expect(sql).not.toMatch(/SET\s+irt_difficulty\s*=\s*[^ ]+\s*,/i);
  });
});
