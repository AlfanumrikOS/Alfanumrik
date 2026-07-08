/**
 * Structural tests for migration 20260428140000_backfill_cbse_syllabus_rag_status.
 *
 * Verifies the migration file exists and contains the expected SQL constructs:
 *   - One-shot recompute_syllabus_status() backfill loop (idempotent)
 *   - cbse_syllabus_rag_ready() helper RPC (chat-readiness probe)
 *   - cbse_syllabus_rag_diagnostic view (stale-flag detection)
 *   - Idempotent SQL idioms (CREATE OR REPLACE, DO $$ ... $$ block)
 *
 * These tests are filesystem-only — no live database required — so they run
 * in the standard CI pipeline alongside other unit tests.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Section 10 cleanup (2026-05-03): pre-baseline migrations were moved from
// `supabase/migrations/` to `supabase/migrations/_legacy/timestamped/`. Resolve
// to whichever path exists so this test stays valid before AND after the
// baseline-from-prod lands.
const MIGRATION_PATH = (() => {
  const candidates = [
    path.resolve('supabase/migrations/20260428140000_backfill_cbse_syllabus_rag_status.sql'),
    path.resolve('supabase/migrations/_legacy/timestamped/20260428140000_backfill_cbse_syllabus_rag_status.sql'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
})();

describe('cbse_syllabus rag_status backfill migration', () => {
  it('migration file exists at the expected path', () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('contains a recompute_syllabus_status backfill loop over cbse_syllabus', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/SELECT\s+DISTINCT\s+grade,\s*subject_code,\s*chapter_number\s+FROM\s+cbse_syllabus/i);
    expect(sql).toMatch(/PERFORM\s+recompute_syllabus_status\s*\(\s*r\.grade\s*,\s*r\.subject_code\s*,\s*r\.chapter_number\s*\)/i);
  });

  it('declares the cbse_syllabus_rag_ready helper function with proper grants', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+cbse_syllabus_rag_ready\s*\(/i);
    expect(sql).toMatch(/RETURNS\s+boolean/i);
    expect(sql).toMatch(/v_chunks\s*>=\s*50/);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+cbse_syllabus_rag_ready[^;]*TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+cbse_syllabus_rag_ready[^;]*TO\s+service_role/i);
  });

  it('declares the cbse_syllabus_rag_diagnostic view with sync_state column', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+cbse_syllabus_rag_diagnostic\b/i);
    expect(sql).toMatch(/\bsync_state\b/);
    expect(sql).toMatch(/'STALE'/);
    expect(sql).toMatch(/'IN_SYNC'/);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+cbse_syllabus_rag_diagnostic[^;]*TO\s+authenticated/i);
  });

  it('uses idempotent SQL idioms (CREATE OR REPLACE + DO $$ ... $$ + transactional)', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    // Re-runnable function/view definitions
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW/i);
    // Anonymous block for the backfill loop with graceful fallback
    expect(sql).toMatch(/DO\s+\$\$/);
    expect(sql).toMatch(/EXCEPTION\s+WHEN\s+undefined_function/i);
    // Wrapped in BEGIN/COMMIT for atomicity
    expect(sql).toMatch(/^\s*BEGIN\s*;/m);
    expect(sql).toMatch(/^\s*COMMIT\s*;/m);
  });
});
