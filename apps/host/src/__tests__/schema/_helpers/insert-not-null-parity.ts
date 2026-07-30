import * as fs from 'fs';
import * as path from 'path';

/**
 * GENERALIZED static canary for the exact P0 bug class fixed by
 * `supabase/migrations/20260801100800_fix_start_quiz_session_options_version_null.sql`:
 * a migration tightened `quiz_session_shuffles.options_version_at_serve` (and
 * `integrity_hash`) to NOT NULL while the ONLY writer function
 * (`start_quiz_session`) never populated either column — so every INSERT
 * violated the constraint, for three months, with nothing in CI catching it.
 *
 * This module answers, PURELY BY READING MIGRATION SOURCE (no live DB
 * required — the whole point is to catch this class of defect in the
 * always-on unit lane, not just an integration lane that may itself be
 * gated/flaky), a mechanically checkable question:
 *
 *   "Does the writer function's INSERT column list cover every NOT-NULL,
 *    no-DEFAULT column of the target table, as of the LAST (CREATE OR
 *    REPLACE-wins) definition of both across the migration chain?"
 *
 * This is intentionally NOT a full SQL parser. It handles the DDL shapes this
 * repo's migrations actually use (verified against
 * `supabase/migrations/00000000000000_baseline_from_prod.sql` and the quiz
 * shuffle-integrity migrations): quoted/unquoted identifiers, optional
 * `"public".` schema qualification, `CREATE TABLE (IF NOT EXISTS)`,
 * `ALTER TABLE ADD COLUMN (IF NOT EXISTS)`, `ALTER TABLE ALTER COLUMN
 * SET/DROP NOT NULL`, `ALTER TABLE ALTER COLUMN SET/DROP DEFAULT`, and
 * `ALTER TABLE ADD CONSTRAINT ... PRIMARY KEY (...)`. It is reusable for any
 * {table, function} pair, not just this one — see
 * `quiz-session-shuffles-insert-not-null-parity.test.ts` for the pinned
 * instance and a synthetic self-test proving the checker actually detects
 * the bug shape.
 */

export interface ColumnState {
  notNull: boolean;
  hasDefault: boolean;
}

export type SchemaState = Map<string, ColumnState>;

export interface CheckConfig {
  /** Bare table name, e.g. 'quiz_session_shuffles'. Schema-qualification is handled internally. */
  table: string;
  /** Bare function name, e.g. 'start_quiz_session'. */
  fn: string;
  /**
   * Columns intentionally excluded from the "must appear in INSERT" requirement
   * — e.g. a column populated by a BEFORE INSERT trigger rather than the
   * function's literal column list. Empty by default: nothing in this repo's
   * quiz-shuffle path is trigger-populated, and silently exempting a column
   * would defeat the point of the canary, so callers must opt in explicitly
   * and are expected to justify each entry at the call site.
   */
  ignoreColumns?: string[];
}

export interface CheckResult {
  /** NOT NULL columns with no DEFAULT, as of the final migration state. */
  requiredNotNullColumns: string[];
  /** Column list from the LAST CREATE OR REPLACE of `fn`'s INSERT INTO `table`, or null if not found. */
  insertColumns: string[] | null;
  /** requiredNotNullColumns not present in insertColumns (case-insensitive). */
  missingColumns: string[];
  functionFound: boolean;
  insertFound: boolean;
}

// ── Repo-relative migration directory resolution (mirrors the existing
// `resolveRepo` pattern used by other structural tests; vitest's cwd is
// `apps/host` under the standard `npm test` invocation, but tolerate the
// repo root too). ────────────────────────────────────────────────────────
export function resolveMigrationsDir(): string {
  for (const c of [
    path.resolve(process.cwd(), 'supabase/migrations'),
    path.resolve(process.cwd(), '..', 'supabase/migrations'),
    path.resolve(process.cwd(), '..', '..', 'supabase/migrations'),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('insert-not-null-parity: could not resolve supabase/migrations directory');
}

/** Every root-level *.sql migration (baseline + timestamped), chronological by filename. `_legacy/` is excluded — Supabase's own CLI skips it too. */
export function listMigrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f));
}

function tableRefPattern(table: string): string {
  const t = escapeRe(table);
  return `(?:"?public"?\\s*\\.\\s*)?"?${t}"?`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a comma-separated list at depth 0, respecting nested parens and single-quoted strings (with '' escaping). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          cur += s[++i];
        } else {
          inQuote = false;
        }
      }
      continue;
    }
    if (c === "'") {
      inQuote = true;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim().length) parts.push(cur);
  return parts;
}

/** Find the balanced-paren block starting at `sql[openIndex] === '('`. Returns contents (exclusive of the outer parens) and the index just past the closing paren. */
function extractParenBlock(sql: string, openIndex: number): { contents: string; end: number } | null {
  if (sql[openIndex] !== '(') return null;
  let depth = 0;
  for (let i = openIndex; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return { contents: sql.slice(openIndex + 1, i), end: i + 1 };
    }
  }
  return null;
}

function stripIdent(id: string): string {
  return id.trim().replace(/^"+|"+$/g, '').toLowerCase();
}

function upsert(state: SchemaState, col: string, patch: Partial<ColumnState>): void {
  const key = stripIdent(col);
  const existing = state.get(key) ?? { notNull: false, hasDefault: false };
  state.set(key, { ...existing, ...patch });
}

/** Apply every column-defining/altering statement for `table` found in one migration file's text, IN SOURCE ORDER, to `state`. Mutates `state`. */
function applyFileToSchemaState(sql: string, table: string, state: SchemaState): void {
  const tRe = tableRefPattern(table);

  // 1) CREATE TABLE (IF NOT EXISTS)? <table> ( ...columns... )
  const createRe = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tRe}\\s*\\(`, 'gi');
  for (const m of sql.matchAll(createRe)) {
    const openIdx = m.index! + m[0].length - 1;
    const block = extractParenBlock(sql, openIdx);
    if (!block) continue;
    for (const rawItem of splitTopLevel(block.contents)) {
      const item = rawItem.trim();
      if (!item) continue;
      const asTableConstraint = /^(CONSTRAINT\s+"?[a-zA-Z_][\w$]*"?\s+)?(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(
        item,
      );
      if (asTableConstraint) {
        const pk = item.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i);
        if (pk) {
          for (const col of splitTopLevel(pk[1])) upsert(state, col, { notNull: true });
        }
        continue;
      }
      const nameMatch = item.match(/^"?([a-zA-Z_][\w$]*)"?\s+/);
      if (!nameMatch) continue;
      const notNull = /\bNOT\s+NULL\b/i.test(item) || /\bPRIMARY\s+KEY\b/i.test(item);
      const hasDefault = /\bDEFAULT\b/i.test(item);
      state.set(stripIdent(nameMatch[1]), { notNull, hasDefault });
    }
  }

  // 2) ALTER TABLE (ONLY)? <table> ADD COLUMN (IF NOT EXISTS)? <col> <rest...>
  const addColRe = new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${tRe}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?([a-zA-Z_][\\w$]*)"?([^;]*);`,
    'gi',
  );
  for (const m of sql.matchAll(addColRe)) {
    const col = m[1];
    const rest = m[2] ?? '';
    const notNull = /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest);
    const hasDefault = /\bDEFAULT\b/i.test(rest);
    state.set(stripIdent(col), { notNull, hasDefault });
  }

  // 3) ALTER TABLE (ONLY)? <table> ALTER COLUMN <col> SET/DROP NOT NULL | SET/DROP DEFAULT
  const alterColRe = new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${tRe}\\s+ALTER\\s+COLUMN\\s+"?([a-zA-Z_][\\w$]*)"?\\s+(SET\\s+NOT\\s+NULL|DROP\\s+NOT\\s+NULL|SET\\s+DEFAULT|DROP\\s+DEFAULT)`,
    'gi',
  );
  for (const m of sql.matchAll(alterColRe)) {
    const col = m[1];
    const verb = m[2].toUpperCase().replace(/\s+/g, ' ');
    if (verb === 'SET NOT NULL') upsert(state, col, { notNull: true });
    else if (verb === 'DROP NOT NULL') upsert(state, col, { notNull: false });
    else if (verb === 'SET DEFAULT') upsert(state, col, { hasDefault: true });
    else if (verb === 'DROP DEFAULT') upsert(state, col, { hasDefault: false });
  }

  // 4) ALTER TABLE (ONLY)? <table> ADD CONSTRAINT ... PRIMARY KEY (col1, col2, ...)
  const pkConstraintRe = new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${tRe}\\s+ADD\\s+CONSTRAINT\\s+"?[a-zA-Z_][\\w$]*"?\\s+PRIMARY\\s+KEY\\s*\\(([^)]*)\\)`,
    'gi',
  );
  for (const m of sql.matchAll(pkConstraintRe)) {
    for (const col of splitTopLevel(m[1])) upsert(state, col, { notNull: true });
  }
}

/** Build the final column NOT-NULL/DEFAULT state for `table` by replaying every migration file, in chronological (filename) order. */
export function buildSchemaState(migrationsDir: string, table: string): SchemaState {
  const state: SchemaState = new Map();
  for (const file of listMigrationFiles(migrationsDir)) {
    const sql = fs.readFileSync(file, 'utf-8');
    applyFileToSchemaState(sql, table, state);
  }
  return state;
}

/**
 * Find the INSERT INTO `table` column list from the LAST `CREATE OR REPLACE
 * FUNCTION <fn>(...)` across the migration chain (CREATE OR REPLACE
 * semantics: the last one deployed wins — earlier bodies are irrelevant to
 * "what does the DB actually run today"). Returns null if the function
 * (or an INSERT into `table` within it) is never found.
 */
export function findFinalInsertColumns(
  migrationsDir: string,
  table: string,
  fn: string,
): { functionFound: boolean; insertFound: boolean; columns: string[] | null } {
  const fnRe = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:"?public"?\\s*\\.\\s*)?"?${escapeRe(fn)}"?\\s*\\(`,
    'gi',
  );
  const files = listMigrationFiles(migrationsDir);

  let lastBody: string | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf-8');
    let m: RegExpExecArray | null;
    const re = new RegExp(fnRe.source, fnRe.flags);
    while ((m = re.exec(sql))) {
      // Skip past the arg-list paren block to reach `RETURNS ... AS $tag$ body $tag$`.
      const argOpen = m.index + m[0].length - 1;
      const argBlock = extractParenBlock(sql, argOpen);
      if (!argBlock) continue;
      const afterArgs = sql.slice(argBlock.end);
      const bodyMatch = afterArgs.match(/AS\s+(\$[a-zA-Z_]*\$)([\s\S]*?)\1/);
      if (bodyMatch) {
        lastBody = bodyMatch[2];
      }
    }
  }

  if (lastBody === null) return { functionFound: false, insertFound: false, columns: null };

  const insertRe = new RegExp(`INSERT\\s+INTO\\s+${tableRefPattern(table)}\\s*\\(`, 'i');
  const insertMatch = lastBody.match(insertRe);
  if (!insertMatch || insertMatch.index === undefined) {
    return { functionFound: true, insertFound: false, columns: null };
  }
  const openIdx = insertMatch.index + insertMatch[0].length - 1;
  const block = extractParenBlock(lastBody, openIdx);
  if (!block) return { functionFound: true, insertFound: false, columns: null };

  const columns = splitTopLevel(block.contents).map((c) => stripIdent(c));
  return { functionFound: true, insertFound: true, columns };
}

/** Full check: does the LAST-deployed `fn`'s INSERT into `table` cover every NOT-NULL, no-DEFAULT column of `table`'s final schema state? */
export function checkInsertCoversNotNull(migrationsDir: string, cfg: CheckConfig): CheckResult {
  const schemaState = buildSchemaState(migrationsDir, cfg.table);
  const ignore = new Set((cfg.ignoreColumns ?? []).map((c) => c.toLowerCase()));

  const requiredNotNullColumns = [...schemaState.entries()]
    .filter(([col, s]) => s.notNull && !s.hasDefault && !ignore.has(col))
    .map(([col]) => col)
    .sort();

  const { functionFound, insertFound, columns } = findFinalInsertColumns(migrationsDir, cfg.table, cfg.fn);
  const insertColumnsSet = new Set((columns ?? []).map((c) => c.toLowerCase()));

  const missingColumns = insertFound
    ? requiredNotNullColumns.filter((c) => !insertColumnsSet.has(c))
    : requiredNotNullColumns.slice(); // function/INSERT absent entirely -> everything "missing"

  return {
    requiredNotNullColumns,
    insertColumns: columns,
    missingColumns,
    functionFound,
    insertFound,
  };
}
