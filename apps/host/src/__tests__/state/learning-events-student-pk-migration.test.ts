/**
 * Static guard for 20260715120000_learning_events_add_student_pk.sql.
 *
 * The migration adds a NULLABLE students.id bridge column to
 * public.learning_events so the auth.uid()-keyed event log can join to
 * learner-state tables. It MUST be additive: no change to the existing
 * student_id column, no RLS change, no DROP.
 *
 * This is a PURE static test — it reads the SQL text + runs the real
 * lint-migrations placeholder check. No DB (that lives in the integration
 * lane), so it stays in the normal `npm test` lane.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Repo-root alias: /^(\.\.\/)+scripts\// → <repo>/scripts (see vitest.config.ts).
import { lintFile } from '../../scripts/lint-migrations.js';

const MIGRATION_REL =
  'supabase/migrations/20260715120000_learning_events_add_student_pk.sql';

function findRepoFile(relPath: string): string {
  const rel = relPath.split('/');
  const anchors: string[] = [];
  if (typeof __dirname !== 'undefined') anchors.push(__dirname);
  anchors.push(process.cwd());
  for (const anchor of anchors) {
    let dir = anchor;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, ...rel);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`could not locate ${relPath} from: ${anchors.join(', ')}`);
}

const migrationPath = findRepoFile(MIGRATION_REL);
const sql = readFileSync(migrationPath, 'utf8');
// Comment-free, lower-cased body for effect assertions (mirrors lint-migrations).
const body = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\n\r]*/g, '')
  .toLowerCase();

describe('learning_events add student_pk migration', () => {
  it('passes lint-migrations (not a SELECT-1 placeholder)', () => {
    expect(lintFile(migrationPath)).toEqual({ status: 'ok' });
  });

  it('adds a NULLABLE student_pk column idempotently', () => {
    expect(body).toContain('add column if not exists student_pk uuid');
    // Nullable: no NOT NULL on the new column.
    expect(body).not.toMatch(/student_pk\s+uuid[^;]*not\s+null/);
  });

  it('references students(id) with ON DELETE CASCADE', () => {
    expect(body).toMatch(/references\s+public\.students\s*\(\s*id\s*\)/);
    expect(body).toContain('on delete cascade');
  });

  it('creates an index idempotently', () => {
    expect(body).toMatch(/create\s+index\s+if\s+not\s+exists\s+idx_learning_events_student_pk/);
  });

  it('is additive — no DROP, no change to student_id, no RLS change', () => {
    expect(body).not.toContain('drop table');
    expect(body).not.toContain('drop column');
    expect(body).not.toContain('drop policy');
    expect(body).not.toContain('create policy');
    expect(body).not.toContain('alter column student_id');
    // Does not touch the existing auth.uid() column or its FK.
    expect(body).not.toMatch(/alter\s+table[^;]*drop\s+constraint/);
  });

  it('documents the deferred (not in-migration) backfill decision', () => {
    // The backfill is intentionally NOT run in-migration (high-volume append-only
    // log). Assert the file explains this so a reviewer/operator sees the plan.
    expect(sql.toLowerCase()).toContain('backfill');
    // No unguarded blanket UPDATE runs at deploy time (any UPDATE example must be
    // inside a comment; the executable body must contain no UPDATE statement).
    expect(body).not.toContain('update public.learning_events');
    expect(body).not.toMatch(/\bupdate\s+public\.learning_events/);
  });
});
