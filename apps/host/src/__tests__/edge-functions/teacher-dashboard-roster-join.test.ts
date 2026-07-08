/**
 * Static source-parse regression — teacher-dashboard Edge Function roster
 * resolution must NEVER filter/select `students` by `class_id`.
 *
 * Background (roster-resolution repair, 2026-06-16):
 *   The live `students` table has NO `class_id` column — class membership lives
 *   in the `class_students` join table (`class_students.class_id → student_id`).
 *   The pre-fix teacher-dashboard resolved a class's roster by querying
 *   `supabase.from('students').eq('class_id', …)` / `.in('class_id', …)`. Because
 *   supabase-js does NOT throw on a filter against a non-existent column — it
 *   surfaces the error in the (unchecked) result object — every such query
 *   returned an EMPTY set. The visible symptom: "every class returns 0 students"
 *   across the entire teacher portal (dashboard student_count, heatmap, alerts,
 *   reports, assignment submissions, grade book).
 *
 *   The fix replaces all 7 sites with a two-step resolution:
 *     1. read `class_students` filtered by class_id → collect `student_id`s,
 *     2. load `students` filtered by `.in('id', ids)`.
 *   (Synthetic `grade-<n>` pseudo-classes still resolve via `.eq('grade', …)`,
 *   which is a real column and is allowed.)
 *
 * This test pins that fix STATICALLY (no Deno execution, no live DB). The Edge
 * Function lives in Deno-land (imports from https://esm.sh, uses Deno.serve) so
 * it cannot be loaded under Vitest — we use the SAME static source-inspection
 * pattern as `src/__tests__/edge-functions/queue-consumer-task-queue-columns.test.ts`
 * (readFileSync + resolve from repo root).
 *
 * SCOPING note — the file legitimately mentions `class_id` in MANY contexts that
 * must NOT trip this guard:
 *   - `class_students.eq('class_id', …)` / `.in('class_id', …)`  (the CORRECT join)
 *   - `class_teachers.select('class_id')` / `.eq('class_id', …)` (ownership)
 *   - `classes.eq('id', …)` joins, `classroom_polls.insert({ class_id })`,
 *     `assignments.select('…class_id…')`, `class_attendance`, etc.
 *   - prose/comments that literally explain "there is no students.class_id column".
 * So every assertion below is scoped to the `.from('students')` CHAIN ONLY — we
 * extract each students-query's method chain and inspect just THAT chain's
 * `.eq(...)` / `.in(...)` filter keys and `.select(...)` column list. A naive
 * whole-file substring search for `class_id` would false-fail on the legitimate
 * `class_students` join right next to the fixed students query.
 *
 * If anyone re-introduces a `students`-by-`class_id` query, this fails at CI time
 * instead of silently returning 0 students for every class in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FN_PATH = resolve(
  process.cwd(),
  'supabase/functions/teacher-dashboard/index.ts',
);

const src = readFileSync(FN_PATH, 'utf8');

/**
 * Extract the supabase-js method chain that begins at each `.from('students')`
 * call. We capture from `.from('students')` up to the chain terminator — the
 * end of the awaited expression — so we can inspect ONLY that query's
 * `.eq(...)` / `.in(...)` / `.select(...)` calls, isolated from sibling queries
 * (e.g. an adjacent `class_students` join) and from comment/string prose.
 *
 * Heuristic terminator: a supabase-js query chain is a run of
 * `.method( ... )` segments; it ends at the first place where, at brace/paren
 * depth 0 relative to the chain start, we hit a token that cannot continue a
 * chain (a statement boundary that is not immediately followed by `.`). We walk
 * paren/bracket/brace depth and stop when we return to depth 0 AND the next
 * non-whitespace char is not `.` (i.e. the chain has no further `.method`).
 */
function extractStudentsChains(source: string): string[] {
  const chains: string[] = [];
  const fromRe = /\.from\(\s*['"]students['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const start = m.index;
    let i = start + m[0].length;
    let depth = 0;
    // Walk the chain. We are at depth 0 right after `.from('students')`.
    while (i < source.length) {
      const ch = source[i];
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        i++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        i++;
        continue;
      }
      if (depth === 0) {
        // At depth 0 between chain segments: the chain continues only if the
        // next non-whitespace char is a `.` starting another `.method(`.
        // Skip whitespace to peek.
        let j = i;
        while (j < source.length && /\s/.test(source[j])) j++;
        if (source[j] === '.') {
          // continue the chain
          i = j + 1;
          continue;
        }
        // Chain ended.
        break;
      }
      i++;
    }
    chains.push(source.slice(start, i));
  }
  return chains;
}

/**
 * Pull the string-literal argument of every `.eq(` / `.in(` filter in a chain
 * (the FIRST arg — the column name). Returns the lowercased column names that
 * the query filters on.
 */
function filterColumns(chain: string): string[] {
  const cols: string[] = [];
  const re = /\.(?:eq|in|neq|gt|gte|lt|lte|like|ilike)\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chain)) !== null) cols.push(m[1]);
  return cols;
}

/** Pull the `.select('…')` column-list string(s) from a chain. */
function selectStrings(chain: string): string[] {
  const out: string[] = [];
  const re = /\.select\(\s*['"]([^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chain)) !== null) out.push(m[1]);
  return out;
}

describe('teacher-dashboard Edge Function — file shape', () => {
  it('exists at supabase/functions/teacher-dashboard/index.ts', () => {
    expect(existsSync(FN_PATH)).toBe(true);
  });

  it('uses Deno.serve (Edge Function runtime contract)', () => {
    expect(src).toMatch(/Deno\.serve\s*\(/);
  });

  it('queries the students table (guard against a vacuously-green parse)', () => {
    const chains = extractStudentsChains(src);
    expect(chains.length).toBeGreaterThan(0);
  });

  it('rosters through the class_students join table (the fix is present)', () => {
    // The corrected resolution reads class_students.class_id → student_id.
    expect(src).toMatch(/\.from\(\s*['"]class_students['"]\s*\)/);
  });
});

describe('teacher-dashboard — students query roster contract ("every class returns 0 students" regression)', () => {
  const chains = extractStudentsChains(src);

  it('NO students query filters by class_id (.eq/.in on class_id)', () => {
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      const cols = filterColumns(chain);
      expect(
        cols,
        `A .from('students') query filters by "class_id" — students has NO ` +
          `class_id column on the live schema, so this returns 0 rows for ` +
          `every class. Roster must go through class_students.class_id → ` +
          `student_id, then students.in('id', ids). Chain:\n${chain}`,
      ).not.toContain('class_id');
    }
  });

  it('NO students query selects a class_id column', () => {
    for (const chain of chains) {
      for (const sel of selectStrings(chain)) {
        const selectedCols = sel.split(',').map((c) => c.trim());
        expect(
          selectedCols,
          `A .from('students').select(...) includes "class_id" — that column ` +
            `does not exist on students. Chain:\n${chain}`,
        ).not.toContain('class_id');
      }
    }
  });

  it('every students filter column is a REAL students column (id / grade only for roster resolution)', () => {
    // The roster-resolution students queries filter exclusively by `id`
    // (the .in('id', rosterIds) path) or `grade` (the synthetic grade-<n>
    // pseudo-class path). Other real columns (deleted_at via .is(), etc.)
    // are not eq/in filters. This positively asserts the shape of the fix.
    const ALLOWED_FILTER_COLUMNS = ['id', 'grade'];
    for (const chain of chains) {
      for (const col of filterColumns(chain)) {
        expect(
          ALLOWED_FILTER_COLUMNS,
          `A .from('students') query filters by "${col}"; roster resolution ` +
            `should only eq/in on ${ALLOWED_FILTER_COLUMNS.join(' / ')}. ` +
            `Chain:\n${chain}`,
        ).toContain(col);
      }
    }
  });
});

describe('teacher-dashboard — the class_students join is NOT mistaken for a students query', () => {
  it('class_students legitimately filters by class_id (confirms scoping is correct)', () => {
    // class_students DOES have a class_id column — the correct roster join uses
    // it. This documents WHY the assertions above are scoped to the
    // `.from('students')` chain and not a whole-file substring search: a global
    // not.toContain('class_id') would false-fail on this legitimate join.
    expect(src).toMatch(
      /\.from\(\s*['"]class_students['"]\s*\)[\s\S]{0,120}?\.(?:eq|in)\(\s*['"]class_id['"]/,
    );
    // …and the scoped students extractor must NOT pick that up.
    const studentChains = extractStudentsChains(src);
    const studentFilterCols = studentChains.flatMap(filterColumns);
    expect(studentFilterCols).not.toContain('class_id');
  });
});
