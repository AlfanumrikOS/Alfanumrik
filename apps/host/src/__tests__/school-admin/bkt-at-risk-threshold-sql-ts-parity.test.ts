/**
 * BKT 0.4 at-risk threshold — SQL ↔ TS literal parity drift canary.
 *
 * WHY THIS EXISTS (Task 3.4, RCA promotion — .claude/regression/07-teacher-school.md)
 * ======================================================================
 * `PULSE_THRESHOLDS.at_risk_mastery` (packages/lib/src/pulse/signals.ts) and the
 * `AT_RISK_PKNOW_THRESHOLD` cutoff hardcoded into the school-reporting SQL RPCs
 * (`get_classes_at_risk` in migration 20260614000000_phase3b_school_command_center_read_models.sql,
 * `get_school_mastery_rollup` in migration 20260614000003_phase3b_school_reporting.sql)
 * are independently declared as the literal `0.4` in two different languages —
 * they are NOT wired to one shared constant. Both migrations' own header comments
 * assert this is "the faithful SQL twin of the established BKT p_know floor", but
 * nothing before this test MECHANICALLY enforced that claim: a future edit to
 * PULSE_THRESHOLDS.at_risk_mastery (or a future redefinition of either RPC) could
 * silently drift the two surfaces apart, so Student Pulse and the School Command
 * Center / Reports "at risk" counts would disagree for the exact same student.
 *
 * `xp-sql-literal-parity.test.ts` (REG-48/SLC-2) is the model for this pattern —
 * anchor the TS constant, then grep the authoritative SQL for the literal and
 * assert equality, so drift on EITHER side fails CI.
 *
 * HONESTY NOTE: this is a STATIC content-pin (source-level grep), not a live-DB
 * behavioral probe. The live-DB behavioral boundary itself (a student at exactly
 * 0.40 is NOT at-risk) is already covered by REG-96 (school-command-center-read-models.test.ts)
 * and REG-99 (school-reporting.test.ts) — both gated on a live Supabase connection.
 * This test adds the piece those don't cover: proving the TS and SQL LITERALS are
 * the same number, so an edit to one without the other is caught even with no DB
 * available (e.g. in the standard unit-test CI job).
 *
 * REGRESSION CATALOG: REG-291 in .claude/regression/07-teacher-school.md.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PULSE_THRESHOLDS } from '@alfanumrik/lib/pulse/signals';

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

const COMMAND_CENTER_MIGRATION =
  'supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql';
const SCHOOL_REPORTING_MIGRATION =
  'supabase/migrations/20260614000003_phase3b_school_reporting.sql';

/** Matches `... ps.student_avg_pknow < 0.4   -- AT_RISK_PKNOW_THRESHOLD` (or any
 *  future variable name before the comparison), tolerant of whitespace. */
const RE_AT_RISK_LITERAL = /student_avg_pknow\s*<\s*([\d.]+)\s*(?:--\s*AT_RISK_PKNOW_THRESHOLD)?/gi;

function extractAtRiskLiterals(rel: string): number[] {
  const sql = read(rel);
  return [...sql.matchAll(RE_AT_RISK_LITERAL)].map((m) => Number(m[1]));
}

describe('BKT at-risk threshold — TS anchor (PULSE_THRESHOLDS.at_risk_mastery)', () => {
  it('is 0.4 (the platform-wide at-risk p_know cutoff)', () => {
    expect(PULSE_THRESHOLDS.at_risk_mastery).toBe(0.4);
  });
});

describe('BKT at-risk threshold — SQL parity: get_classes_at_risk (School Command Center)', () => {
  it('the migration exists', () => {
    expect(resolveRepo(COMMAND_CENTER_MIGRATION)).not.toBeNull();
  });

  it('the AT_RISK_PKNOW_THRESHOLD literal equals PULSE_THRESHOLDS.at_risk_mastery', () => {
    const literals = extractAtRiskLiterals(COMMAND_CENTER_MIGRATION);
    // Guard against the regex silently matching nothing (would otherwise pass vacuously).
    expect(literals.length).toBeGreaterThanOrEqual(1);
    for (const n of literals) expect(n).toBe(PULSE_THRESHOLDS.at_risk_mastery);
  });
});

describe('BKT at-risk threshold — SQL parity: get_school_mastery_rollup (Reports)', () => {
  it('the migration exists', () => {
    expect(resolveRepo(SCHOOL_REPORTING_MIGRATION)).not.toBeNull();
  });

  it('the AT_RISK_PKNOW_THRESHOLD literal equals PULSE_THRESHOLDS.at_risk_mastery', () => {
    const literals = extractAtRiskLiterals(SCHOOL_REPORTING_MIGRATION);
    expect(literals.length).toBeGreaterThanOrEqual(1);
    for (const n of literals) expect(n).toBe(PULSE_THRESHOLDS.at_risk_mastery);
  });
});

describe('BKT at-risk threshold — cross-surface drift sweep', () => {
  it('every SQL at-risk literal across both Phase 3B surfaces equals the TS constant', () => {
    const offenders: Array<{ file: string; value: number }> = [];
    for (const f of [COMMAND_CENTER_MIGRATION, SCHOOL_REPORTING_MIGRATION]) {
      for (const n of extractAtRiskLiterals(f)) {
        if (n !== PULSE_THRESHOLDS.at_risk_mastery) offenders.push({ file: f, value: n });
      }
    }
    expect(offenders).toEqual([]);
  });
});
