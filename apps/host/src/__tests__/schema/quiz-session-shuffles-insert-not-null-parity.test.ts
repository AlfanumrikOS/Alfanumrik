import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSchemaState,
  checkInsertCoversNotNull,
  resolveMigrationsDir,
} from './_helpers/insert-not-null-parity';

/**
 * Static, no-DB canary for the exact defect class fixed by
 * `supabase/migrations/20260801100800_fix_start_quiz_session_options_version_null.sql`
 * (P0: start_quiz_session() silently failed EVERY call for ~3 months because
 * `20260504100500_backfill_quiz_shuffles_integrity.sql` tightened
 * `quiz_session_shuffles.options_version_at_serve` / `integrity_hash` to
 * NOT NULL while the deployed function's INSERT never populated either
 * column, and nothing in CI called the RPC against a real Postgres to
 * notice).
 *
 * GENERALIZATION: this is not a hand-pinned regex over one migration's text.
 * `checkInsertCoversNotNull` (`./_helpers/insert-not-null-parity.ts`) replays
 * every migration file in order to compute the table's FINAL NOT-NULL/DEFAULT
 * column state, finds the LAST (CREATE OR REPLACE-wins) body of the writer
 * function, and diffs its INSERT column list against that state. Any FUTURE
 * migration that tightens a NOT NULL constraint on `quiz_session_shuffles`
 * without a matching INSERT-list update in `start_quiz_session` — the exact
 * mistake this file documents — fails this test immediately, with the
 * missing column(s) named, no live DB required.
 *
 * The second `describe` block below proves the checker is not vacuously
 * green: it feeds a synthetic, minimal migration pair that reproduces the
 * bug shape (NOT NULL column added, function's INSERT list never updated)
 * through the SAME code path and asserts the checker reports it.
 */

describe('quiz_session_shuffles / start_quiz_session — INSERT vs NOT NULL parity (P0 regression, static)', () => {
  const migrationsDir = resolveMigrationsDir();

  it('every NOT NULL, no-DEFAULT column of quiz_session_shuffles is populated by start_quiz_session\'s INSERT', () => {
    const result = checkInsertCoversNotNull(migrationsDir, {
      table: 'quiz_session_shuffles',
      fn: 'start_quiz_session',
    });

    expect(result.functionFound, 'start_quiz_session must exist in the migration chain').toBe(true);
    expect(result.insertFound, 'start_quiz_session must contain an INSERT INTO quiz_session_shuffles').toBe(
      true,
    );
    expect(
      result.missingColumns,
      `start_quiz_session's INSERT is missing NOT NULL columns: ${result.missingColumns.join(', ')}. ` +
        `Required: [${result.requiredNotNullColumns.join(', ')}]. ` +
        `Found in INSERT: [${(result.insertColumns ?? []).join(', ')}]. ` +
        'This is the exact P0 defect class fixed by migration 20260801100800 — ' +
        'a NOT NULL constraint the writer function does not populate.',
    ).toEqual([]);
  });

  it('sanity: options_version_at_serve and integrity_hash are actually part of the required set (the check is not vacuous)', () => {
    const state = buildSchemaState(migrationsDir, 'quiz_session_shuffles');
    expect(state.get('options_version_at_serve')).toEqual({ notNull: true, hasDefault: false });
    expect(state.get('integrity_hash')).toEqual({ notNull: true, hasDefault: false });
    // Baseline-declared columns should also be present and NOT NULL.
    expect(state.get('session_id')?.notNull).toBe(true);
    expect(state.get('question_id')?.notNull).toBe(true);
    // created_at is NOT NULL but DEFAULT now() — must NOT be in the required
    // set (Postgres fills it in when the INSERT omits it).
    expect(state.get('created_at')).toEqual({ notNull: true, hasDefault: true });
  });
});

describe('insert-not-null-parity checker — self-test against a synthetic reproduction of the P0 bug shape', () => {
  /**
   * Builds a throwaway migrations directory with two files:
   *   1. a CREATE TABLE + a function that fully populates it (the "before"
   *      state — should PASS), and
   *   2. an ALTER TABLE ... SET NOT NULL on a new column, with the function
   *      LEFT UNCHANGED (the exact P0 shape — should FAIL and name the
   *      column).
   * This proves the generic checker actually catches the bug class, not
   * just the one migration it happens to be pinned against above.
   */
  function withTempMigrationsDir(files: Record<string, string>, run: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insert-not-null-parity-selftest-'));
    try {
      for (const [name, contents] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), contents, 'utf-8');
      }
      run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('reports the bug shape: a NOT NULL column added after the writer function is not caught up', () => {
    withTempMigrationsDir(
      {
        '00000000000000_baseline.sql': `
          CREATE TABLE "public"."widget_shuffles" (
            "id" "uuid" NOT NULL,
            "value" text NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL
          );

          CREATE OR REPLACE FUNCTION "public"."start_widget_session"("p_id" "uuid") RETURNS "jsonb"
              LANGUAGE "plpgsql"
              AS $$
          BEGIN
            INSERT INTO widget_shuffles (id, value) VALUES (p_id, 'x');
            RETURN jsonb_build_object('ok', true);
          END;
          $$;
        `,
        '20260101000000_tighten_new_column.sql': `
          ALTER TABLE widget_shuffles ADD COLUMN IF NOT EXISTS options_version_at_serve int;
          UPDATE widget_shuffles SET options_version_at_serve = 0 WHERE options_version_at_serve IS NULL;
          ALTER TABLE widget_shuffles ALTER COLUMN options_version_at_serve SET NOT NULL;
          -- BUG: start_widget_session was never updated to populate the new column.
        `,
      },
      (dir) => {
        const result = checkInsertCoversNotNull(dir, {
          table: 'widget_shuffles',
          fn: 'start_widget_session',
        });
        expect(result.functionFound).toBe(true);
        expect(result.insertFound).toBe(true);
        expect(result.missingColumns).toEqual(['options_version_at_serve']);
      },
    );
  });

  it('is green once a later CREATE OR REPLACE catches the INSERT up (mirrors the real 20260801100800 fix)', () => {
    withTempMigrationsDir(
      {
        '00000000000000_baseline.sql': `
          CREATE TABLE "public"."widget_shuffles" (
            "id" "uuid" NOT NULL,
            "value" text NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL
          );

          CREATE OR REPLACE FUNCTION "public"."start_widget_session"("p_id" "uuid") RETURNS "jsonb"
              LANGUAGE "plpgsql"
              AS $$
          BEGIN
            INSERT INTO widget_shuffles (id, value) VALUES (p_id, 'x');
            RETURN jsonb_build_object('ok', true);
          END;
          $$;
        `,
        '20260101000000_tighten_new_column.sql': `
          ALTER TABLE widget_shuffles ADD COLUMN IF NOT EXISTS options_version_at_serve int;
          UPDATE widget_shuffles SET options_version_at_serve = 0 WHERE options_version_at_serve IS NULL;
          ALTER TABLE widget_shuffles ALTER COLUMN options_version_at_serve SET NOT NULL;
        `,
        '20260102000000_fix.sql': `
          CREATE OR REPLACE FUNCTION "public"."start_widget_session"("p_id" "uuid") RETURNS "jsonb"
              LANGUAGE "plpgsql"
              AS $$
          BEGIN
            INSERT INTO widget_shuffles (id, value, options_version_at_serve) VALUES (p_id, 'x', 0);
            RETURN jsonb_build_object('ok', true);
          END;
          $$;
        `,
      },
      (dir) => {
        const result = checkInsertCoversNotNull(dir, {
          table: 'widget_shuffles',
          fn: 'start_widget_session',
        });
        expect(result.missingColumns).toEqual([]);
      },
    );
  });

  it('treats a NOT NULL column WITH a DEFAULT as not required (Postgres fills it in)', () => {
    withTempMigrationsDir(
      {
        '00000000000000_baseline.sql': `
          CREATE TABLE "public"."widget_shuffles" (
            "id" "uuid" NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL
          );

          CREATE OR REPLACE FUNCTION "public"."start_widget_session"("p_id" "uuid") RETURNS "jsonb"
              LANGUAGE "plpgsql"
              AS $$
          BEGIN
            INSERT INTO widget_shuffles (id) VALUES (p_id);
            RETURN jsonb_build_object('ok', true);
          END;
          $$;
        `,
      },
      (dir) => {
        const result = checkInsertCoversNotNull(dir, {
          table: 'widget_shuffles',
          fn: 'start_widget_session',
        });
        expect(result.missingColumns).toEqual([]);
      },
    );
  });
});
