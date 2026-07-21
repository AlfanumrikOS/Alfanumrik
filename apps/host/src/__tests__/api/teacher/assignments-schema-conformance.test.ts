/**
 * Static source-parse regression — `POST /api/teacher/assignments` and its
 * downstream readers must only ever write/read REAL `assignments` columns.
 *
 * Background (production incident, 2026-07-21 — "Unable to create the
 * assignment"):
 *   The live `assignments` table (baseline `00000000000000_baseline_from_prod.sql:9904`,
 *   plus migration `20260721000300_assignments_add_chapter_difficulty.sql`)
 *   has EXACTLY these columns:
 *     id, class_id, teacher_id, title, description, assignment_type,
 *     topic_id, subject, grade, chapter, difficulty, due_date,
 *     time_limit_minutes, max_attempts, passing_score, is_mandatory,
 *     show_answers_after, allow_late_submission, randomize_questions,
 *     bloom_level, question_count, status, created_at, updated_at
 *
 *   It has NO `type` column and NO `is_active` column — those are
 *   `assignment_type` and `status` respectively. The pre-fix POST handler
 *   inserted `type`, `chapter`, `difficulty`, and `is_active` — the first and
 *   last of which do not exist and the middle two did not exist prior to
 *   the schema-repair migration. supabase-js does NOT throw on a write to a
 *   non-existent column — it returns the error in the result object — but
 *   this route DOES check `insertErr` and return a 500, so the bug manifested
 *   as "Failed to create assignment" on every single call.
 *
 * This test pins the fix STATICALLY (no live DB) by parsing the object-literal
 * keys of the `.from('assignments').insert({...})` call in the route and the
 * `.select('...')` column lists in every other reader of this table, and
 * asserting every key/column is a REAL `assignments` column.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE_PATH = resolve(
  process.cwd(),
  'src/app/api/teacher/assignments/route.ts',
);
const SUBMISSIONS_PAGE_PATH = resolve(
  process.cwd(),
  'src/app/teacher/submissions/page.tsx',
);
/**
 * Strip `//` line comments and `/* ... *\/` block comments before parsing.
 * The route's JSDoc header literally contains the prose
 * "supabase.from('assignments').insert(...)" (describing what the route
 * replaced) and a `{ class_id, title, ... }` body-shape example — both would
 * otherwise be mistaken for real code by the naive `.from()/.insert()`
 * string search below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const routeSrc = stripComments(readFileSync(ROUTE_PATH, 'utf8'));
const submissionsSrc = stripComments(readFileSync(SUBMISSIONS_PAGE_PATH, 'utf8'));

// ── Live `assignments` schema (single source of truth) ──
// baseline_from_prod.sql:9904 + 20260721000300_assignments_add_chapter_difficulty.sql
const ASSIGNMENTS_COLUMNS = [
  'id',
  'class_id',
  'teacher_id',
  'title',
  'description',
  'assignment_type',
  'topic_id',
  'subject',
  'grade',
  'chapter',
  'difficulty',
  'due_date',
  'time_limit_minutes',
  'max_attempts',
  'passing_score',
  'is_mandatory',
  'show_answers_after',
  'allow_late_submission',
  'randomize_questions',
  'bloom_level',
  'question_count',
  'status',
  'created_at',
  'updated_at',
] as const;

// Columns the pre-fix code wrote/read that DO NOT exist on `assignments`.
const PHANTOM_ASSIGNMENTS_COLUMNS = ['type', 'is_active'] as const;

/** Extract the object-literal payload of `.from('<table>').insert({ ... })`. */
function extractInsertPayloads(source: string, table: string): string[] {
  const payloads: string[] = [];
  const fromRe = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const after = source.slice(m.index + m[0].length);
    const insIdx = after.indexOf('.insert(');
    if (insIdx === -1) continue;
    const openIdx = after.indexOf('{', insIdx);
    if (openIdx === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < after.length; i++) {
      const ch = after[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    payloads.push(after.slice(openIdx + 1, end));
  }
  return payloads;
}

/** Parse top-level object-literal keys (`key: value,` / shorthand `key,`). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  let expectKey = true;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (ch === ',') {
      expectKey = true;
      i++;
      continue;
    }
    if (depth === 0 && expectKey) {
      // `key: value` form.
      const keyMatch = /^[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(body.slice(i));
      if (keyMatch) {
        keys.push(keyMatch[1]);
        expectKey = false;
        i += keyMatch[0].length;
        continue;
      }
      // Shorthand `key,` / trailing `key` form (no colon) — the identifier
      // itself is both the column name and the value expression.
      const shorthandMatch = /^[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=[,}]|$)/.exec(
        body.slice(i),
      );
      if (shorthandMatch) {
        keys.push(shorthandMatch[1]);
        expectKey = false;
        i += shorthandMatch[0].length;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/**
 * Extract the column list of every `.from('<table>').select('...')` call —
 * handles `col`, `col:alias_target`, and stops at whitespace/comma. Returns
 * the SOURCE column being read (the part after `:` when aliased), since
 * that's what must exist on the real table.
 */
function extractSelectColumns(source: string, table: string): string[] {
  const columns: string[] = [];
  const fromRe = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const after = source.slice(m.index + m[0].length);
    const selMatch = /\.select\(\s*['"]([\s\S]*?)['"]\s*[,)]/.exec(after.slice(0, 500));
    if (!selMatch) continue;
    const list = selMatch[1];
    for (const rawPart of list.split(',')) {
      const part = rawPart.trim();
      if (!part || part === '*') continue;
      // Skip embedded-relation selects like `assignment_submissions(count)`.
      if (part.includes('(')) continue;
      const aliasIdx = part.indexOf(':');
      const col = aliasIdx === -1 ? part : part.slice(aliasIdx + 1);
      columns.push(col.trim());
    }
  }
  return columns;
}

describe('POST /api/teacher/assignments — insert column contract', () => {
  const payloads = extractInsertPayloads(routeSrc, 'assignments');
  const allKeys = Array.from(new Set(payloads.flatMap(topLevelKeys)));

  it('parses at least one assignments insert payload', () => {
    expect(payloads.length).toBeGreaterThan(0);
    expect(allKeys.length).toBeGreaterThan(0);
  });

  it('every assignments INSERT key is a REAL assignments column', () => {
    for (const key of allKeys) {
      expect(
        ASSIGNMENTS_COLUMNS as readonly string[],
        `assignments INSERT writes column "${key}" which is NOT in the live schema ` +
          `(baseline_from_prod.sql:9904 + 20260721000300_assignments_add_chapter_difficulty.sql). ` +
          `Allowed: ${ASSIGNMENTS_COLUMNS.join(', ')}`,
      ).toContain(key);
    }
  });

  it('does NOT write any phantom column (type / is_active) to assignments', () => {
    for (const phantom of PHANTOM_ASSIGNMENTS_COLUMNS) {
      expect(
        allKeys,
        `assignments INSERT must never write the non-existent column "${phantom}" — ` +
          `use assignment_type / status instead. Writing it silently fails the whole ` +
          `insert (checked error → 500 "Failed to create assignment" on every call).`,
      ).not.toContain(phantom);
    }
  });

  it('writes assignment_type and status (the real equivalents of type/is_active)', () => {
    expect(allKeys).toContain('assignment_type');
    expect(allKeys).toContain('status');
  });

  it('writes the genuinely-added chapter and difficulty columns', () => {
    expect(allKeys).toContain('chapter');
    expect(allKeys).toContain('difficulty');
  });
});

describe('/teacher/submissions page — assignments SELECT column contract', () => {
  const columns = Array.from(
    new Set(extractSelectColumns(submissionsSrc, 'assignments')),
  );

  it('parses at least one assignments select column list', () => {
    expect(columns.length).toBeGreaterThan(0);
  });

  it('every selected assignments column is a REAL column (post-alias)', () => {
    for (const col of columns) {
      expect(
        ASSIGNMENTS_COLUMNS as readonly string[],
        `/teacher/submissions selects assignments.${col}, which is NOT a real column. ` +
          `Allowed: ${ASSIGNMENTS_COLUMNS.join(', ')}`,
      ).toContain(col);
    }
  });

  it('aliases the non-existent `type` field to the real assignment_type column', () => {
    expect(submissionsSrc).toMatch(/type:assignment_type/);
  });
});
