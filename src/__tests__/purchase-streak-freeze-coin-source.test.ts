/**
 * Static SQL-parse regression for the purchase_streak_freeze RPC migration.
 *
 * Background (quality close-out, 2026-06-16):
 *   The coins branch of `purchase_streak_freeze` originally wrote its
 *   `coin_transactions` ledger row with `source = 'streak_freeze_purchase'`.
 *   That value is NOT in the `coin_transactions_source_check` allow-list
 *   (baseline `00000000000000_baseline_from_prod.sql:10601`), so every coins
 *   purchase tripped the CHECK → Postgres 23514 → the shop route returned 500.
 *
 *   The fix repoints the INSERT to `source = 'redemption'` — the canonical
 *   allow-listed value for spending currency on a shop item — and records the
 *   specific item (`streak_freeze`) in `metadata`.
 *
 * This test pins that fix STATICALLY (no live DB): it reads the migration SQL
 * and asserts the coins-branch ledger INSERT uses an allow-listed `source`,
 * never the rejected literal, and that the migration still adds the
 * `students.freezes_*` inventory columns and defines the RPC.
 *
 * It lives at the TOP of `src/__tests__/` (NOT in `src/__tests__/migrations/`)
 * on purpose: `src/__tests__/migrations/**` is the LIVE-DB integration lane
 * (excluded from `npm test`, gated on real STAGING_SUPABASE_* secrets — see
 * vitest.config.ts:17-20). A purely static SQL-parse regression must run in the
 * normal `npm test` lane to gate every PR, mirroring the file-reading pattern in
 * `src/__tests__/irt/cron-schedule-parity.test.ts` and the static SQL-parse
 * pins in `src/__tests__/quiz-rpc-signature-parity.test.ts`.
 *
 * If anyone re-introduces a non-allow-listed `coin_transactions.source` here,
 * this fails at CI time instead of in production with a 500.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve from the repo root rather than from the test file so this is stable
// in both worktree and root checkouts. __dirname = src/__tests__.
const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260616120000_purchase_streak_freeze_rpc.sql',
);

// The single source of truth for the allow-list: baseline
// 00000000000000_baseline_from_prod.sql:10601 coin_transactions_source_check.
const COIN_SOURCE_ALLOW_LIST = [
  'quiz_complete',
  'first_quiz_of_day',
  'streak_3_day',
  'streak_7_day',
  'streak_30_day',
  'revise_decaying_topic',
  'study_task_complete',
  'study_plan_week',
  'score_milestone',
  'redemption',
  'xp_migration',
  'admin_adjustment',
  'daily_challenge',
] as const;

// The exact value that violated the CHECK (→ 23514 → 500) before the fix.
const REJECTED_SOURCE = 'streak_freeze_purchase';

const sql = readFileSync(MIGRATION_PATH, 'utf8');

/** SQL with every line-comment line removed, so a comment that legitimately
 *  names a value in prose can neither satisfy nor break the SQL-level checks. */
const codeOnly = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/**
 * Extract the `coin_transactions` INSERT statement (the coins-branch ledger
 * write) so the source-value assertions operate on the real statement.
 */
function extractCoinTransactionsInsert(source: string): string {
  const match = source.match(
    /INSERT\s+INTO\s+coin_transactions[\s\S]*?VALUES\s*\([\s\S]*?\)\s*;/i,
  );
  expect(match, 'coins-branch INSERT INTO coin_transactions not found').not.toBeNull();
  return match![0];
}

describe('purchase_streak_freeze migration — coin_transactions source allow-list (P11-adjacent ledger integrity)', () => {
  it('reads the migration file', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('coins-branch INSERT uses the allow-listed source "redemption"', () => {
    const insert = extractCoinTransactionsInsert(codeOnly);
    // The source literal sits in the VALUES tuple alongside the negative amount.
    const sourceLiteral = insert.match(/-p_cost\s*,\s*'([^']+)'/i);
    expect(sourceLiteral, 'could not parse source literal from coins INSERT').not.toBeNull();
    const source = sourceLiteral![1];

    expect(source).toBe('redemption');
    expect(COIN_SOURCE_ALLOW_LIST).toContain(source);
  });

  it('the parsed coins-branch source value is a member of the known allow-list', () => {
    const insert = extractCoinTransactionsInsert(codeOnly);
    const source = insert.match(/-p_cost\s*,\s*'([^']+)'/i)?.[1];
    expect(source).toBeDefined();
    expect(COIN_SOURCE_ALLOW_LIST).toContain(source!);
  });

  it('does NOT contain the rejected literal "streak_freeze_purchase" anywhere in executable SQL', () => {
    // The header comment is allowed to reference the rejected value while
    // explaining the fix, but no executable statement may use it.
    expect(codeOnly).not.toContain(REJECTED_SOURCE);
  });

  it('still adds the students.freezes_* inventory columns (ADD COLUMN IF NOT EXISTS)', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+freezes_available\b/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+freezes_used_total\b/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+last_freeze_used_at\b/i);
  });

  it('still defines the purchase_streak_freeze RPC', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.purchase_streak_freeze\s*\(/i,
    );
  });
});
