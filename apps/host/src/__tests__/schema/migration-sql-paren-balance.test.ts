import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static, no-DB paren-balance guard over `CREATE [OR REPLACE] FUNCTION ...`
 * bodies in the root migration chain.
 *
 * WHY THIS EXISTS
 *   `match_rag_chunks` / `match_rag_chunks_ncert` shipped with a dangling
 *   unclosed `(` in their quality-score WHERE-clause predicate — TWICE,
 *   independently, in two different files:
 *     - `supabase/migrations/00000000000000_baseline_from_prod.sql`
 *     - `supabase/migrations/20260620000900_fix_match_rag_chunks_drop_syllabus_version.sql`
 *   Both carried:
 *     AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality
 *     AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
 *   — the first `(` is never closed, so Postgres itself rejects the
 *   `CREATE OR REPLACE FUNCTION` statement with
 *   `ERROR: mismatched parentheses at or near ";" (SQLSTATE 42601)`. This is
 *   not a runtime/logic bug — the function body fails to PARSE, so it never
 *   even reaches `CREATE`, breaking every fresh-DB apply (CI live-DB lane,
 *   DR rebuild, new staging project) and, had it landed live, prod itself.
 *
 * WHY IT WENT UNDETECTED
 *   No existing test parses/validates SQL function-body syntax. Coverage was
 *   either (a) mocked RPC call-site tests, which never touch the SQL text at
 *   all, or (b) live-DB integration tests, which are `accepted-RED` /
 *   frequently skipped and have never actually applied a truly fresh baseline
 *   end-to-end (see `docs/runbooks/schema-reproducibility-debt.md`, "Project
 *   B"). A syntax error inside a `CREATE FUNCTION` body was invisible to both
 *   lanes.
 *
 * WHAT THIS TEST DOES
 *   For every root-level `supabase/migrations/*.sql` file (baseline +
 *   timestamped chain — `_legacy/` is deliberately excluded, since
 *   `supabase db push` skips it too), extract every
 *   `CREATE [OR REPLACE] FUNCTION ... AS <tag> ... <tag>;` body (dollar-quote
 *   tag is whatever Postgres/pg_dump used — `$$`, `$_$`, `$function$`, etc.,
 *   resolved dynamically, not hardcoded) and assert `(` count equals `)`
 *   count within that body, after stripping single-quoted string literals
 *   (`''` = escaped quote), `--` line comments, `/* *\/` block comments, and
 *   any nested dollar-quoted sub-strings (e.g. an inline `DO $$ ... $$` block)
 *   — none of those should contribute to the paren tally.
 *
 * WHAT THIS TEST DOES NOT DO
 *   This is a lint-style structural guard, not a SQL parser and not a
 *   correctness prover. It cannot catch semantic bugs (wrong column names,
 *   wrong operator precedence, wrong logic) — only "does this function body
 *   fail even to CREATE due to unbalanced parens". Bracket/brace balance is
 *   out of scope (Postgres function bodies don't use `[]`/`{}` as structural
 *   delimiters the way `()` is used here).
 *
 * See `.claude/regression/13-rag-cache.md` REG-400 for the full regression
 * catalog entry (paired with the already-catalogued Project B
 * schema-reproducibility debt, which this is a distinct failure mode from:
 * Project B is missing-relation/missing-column errors from out-of-band prod
 * drift; this is a hard SQL *syntax* parse failure that blocks even applying
 * the baseline itself, independent of Project B).
 */

// ── Repo-relative migration directory resolution (mirrors the existing
// `resolveMigrationsDir` pattern in
// `apps/host/src/__tests__/schema/_helpers/insert-not-null-parity.ts`; vitest's
// cwd is `apps/host` under the standard `npm test` invocation, but tolerate
// the repo root too — e.g. `npx vitest run apps/host/src/__tests__/...` run
// directly from the repo root). ────────────────────────────────────────────
function resolveMigrationsDir(): string {
  for (const c of [
    path.resolve(process.cwd(), 'supabase/migrations'),
    path.resolve(process.cwd(), '..', 'supabase/migrations'),
    path.resolve(process.cwd(), '..', '..', 'supabase/migrations'),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('migration-sql-paren-balance: could not resolve supabase/migrations directory');
}

/** Every root-level *.sql migration (baseline + timestamped), NOT `_legacy/` (matches what `supabase db push` actually applies). */
function listRootMigrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
}

// ── Extraction + balance-check helpers (the units under test in the
// fixture-based "proof" suite below, and reused by the real-migration scan). ──

interface ExtractedFunctionBody {
  /** Best-effort function name/signature prefix for readable failure messages. Not a parsed identifier — do not rely on exact formatting. */
  label: string;
  /** The dollar-quote tag used to delimit this body (e.g. `$$`, `$_$`, `$function$`). */
  tag: string;
  body: string;
  /** 1-based line number where the `CREATE FUNCTION` statement starts, for failure messages. */
  startLine: number;
}

function isInsideLineComment(sql: string, index: number): boolean {
  const lineStart = sql.lastIndexOf('\n', index - 1) + 1;
  return sql.slice(lineStart, index).includes('--');
}

/**
 * Extracts every `CREATE [OR REPLACE] FUNCTION ... AS <tag> ... <tag>` body
 * from a SQL source string. Dollar-quote tags are resolved dynamically
 * (whatever immediately follows `AS` — `$$`, `$_$`, `$function$`, etc.), never
 * hardcoded. `CREATE FUNCTION` text appearing inside a `--` line comment
 * (common in this codebase's migration headers, which narrate the fix in
 * prose) is skipped so it can't be mistaken for a real statement.
 */
function extractFunctionBodies(sql: string): ExtractedFunctionBody[] {
  const blocks: ExtractedFunctionBody[] = [];
  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(sql)) !== null) {
    if (isInsideLineComment(sql, match.index)) continue;

    const afterCreate = match.index + match[0].length;
    const asTagRe = /\bAS\s+(\$[A-Za-z_0-9]*\$)/gi;
    asTagRe.lastIndex = afterCreate;
    const asMatch = asTagRe.exec(sql);
    if (!asMatch) continue; // no dollar-quoted body found (e.g. truncated/malformed input) — nothing to check

    const tag = asMatch[1];
    const bodyStart = asMatch.index + asMatch[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) continue; // unterminated dollar-quote — not this guard's concern (would fail to parse for other reasons)

    const body = sql.slice(bodyStart, bodyEnd);
    const nameWindow = sql.slice(afterCreate, afterCreate + 300);
    const nameMatch = /^\s*"?([A-Za-z0-9_."]+)"?\s*\(/.exec(nameWindow);
    const label = nameMatch ? nameMatch[1] : '(unknown function name)';
    const startLine = sql.slice(0, match.index).split('\n').length;

    blocks.push({ label, tag, body, startLine });
    // Resume scanning after this body so a subsequent CREATE FUNCTION
    // statement is found fresh, rather than re-deriving from stale state.
    createRe.lastIndex = bodyEnd + tag.length;
  }
  return blocks;
}

/**
 * Counts `(` / `)` in `text`, skipping:
 *  - `--` line comments (to end of line)
 *  - `/* ... *\/` block comments
 *  - single-quoted string literals, with `''` as an escaped quote (covers
 *    plain `'...'` and Postgres `E'...'` literals alike — this codebase does
 *    not use backslash-escaped quotes, verified via `grep` across
 *    `supabase/migrations/*.sql`)
 *  - nested dollar-quoted sub-strings (e.g. an inline `DO $$ ... $$` block),
 *    matched by the same tag-echo rule as the outer extraction
 *
 * This is a pragmatic lexer-lite scan, not a full SQL parser — sufficient to
 * catch "this function body cannot even be CREATEd due to unbalanced parens"
 * without needing to understand SQL semantics.
 */
function countParensOutsideLiteralsAndComments(text: string): { open: number; close: number } {
  let open = 0;
  let close = 0;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    // Line comment: -- ... \n
    if (ch === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    // Single-quoted string literal ('' = escaped quote)
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Nested dollar-quoted sub-string (e.g. an inline DO $$ ... $$ block)
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i, i + 40));
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = text.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? n : closeIdx + tag.length;
        continue;
      }
    }

    if (ch === '(') open += 1;
    if (ch === ')') close += 1;
    i += 1;
  }

  return { open, close };
}

function isBalanced(text: string): boolean {
  const { open, close } = countParensOutsideLiteralsAndComments(text);
  return open === close;
}

// ─────────────────────────────────────────────────────────────────────────
// Part 1 — fixture-based proof that the helper actually catches this class
// of regression (not merely a vacuous pass against already-fixed files).
// ─────────────────────────────────────────────────────────────────────────

describe('extractFunctionBodies / paren-balance helper (fixture-based)', () => {
  it('flags a function body with a dangling unclosed paren (the exact REG-400 bug shape)', () => {
    const sql = `
CREATE OR REPLACE FUNCTION public.match_rag_chunks(query_text text, p_min_quality double precision DEFAULT 0.5)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
  LIMIT 5;
END;
$function$;
`;

    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe('public.match_rag_chunks');

    const { open, close } = countParensOutsideLiteralsAndComments(blocks[0].body);
    expect(open).not.toBe(close);
    expect(isBalanced(blocks[0].body)).toBe(false);
  });

  it('passes the same body once the dangling paren is closed (the actual fix shape)', () => {
    const sql = `
CREATE OR REPLACE FUNCTION public.match_rag_chunks(query_text text, p_min_quality double precision DEFAULT 0.5)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
  LIMIT 5;
END;
$function$;
`;

    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(isBalanced(blocks[0].body)).toBe(true);
  });

  it('does not miscount parens inside string literals (including a doubled-quote escape)', () => {
    const sql = `
CREATE FUNCTION public.example(p_chapter text)
 LANGUAGE plpgsql
AS $$
BEGIN
  -- literal parens inside a string, and a doubled '' escaped quote — none of
  -- these should be counted as structural parens
  PERFORM 1 WHERE p_chapter ILIKE '%(unit)%' AND p_chapter <> 'it''s (ok)';
END;
$$;
`;
    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(isBalanced(blocks[0].body)).toBe(true);
  });

  it('does not miscount parens inside -- line comments or /* block */ comments', () => {
    const sql = `
CREATE FUNCTION public.example()
 LANGUAGE plpgsql
AS $$
BEGIN
  -- this comment has an unbalanced paren on purpose (
  /* so does this block comment ( */
  PERFORM 1;
END;
$$;
`;
    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(isBalanced(blocks[0].body)).toBe(true);
  });

  it('resolves the dollar-quote tag dynamically ($_$, $tag$, not just $$)', () => {
    const sql = `
CREATE OR REPLACE FUNCTION public.example()
 LANGUAGE plpgsql
AS $_$
BEGIN
  PERFORM (1 + (2 * 3));
END;
$_$;
`;
    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tag).toBe('$_$');
    expect(isBalanced(blocks[0].body)).toBe(true);
  });

  it('skips CREATE FUNCTION text that appears inside a -- comment (prose narration, not a real statement)', () => {
    const sql = `
-- Note: the old CREATE OR REPLACE FUNCTION public.ghost() body used to leak (
-- but that was fixed.
CREATE OR REPLACE FUNCTION public.real_one()
 LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1;
END;
$$;
`;
    const blocks = extractFunctionBodies(sql);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe('public.real_one');
    expect(isBalanced(blocks[0].body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Part 2 — the real regression guard: every function body in the applied
// root migration chain must be paren-balanced.
// ─────────────────────────────────────────────────────────────────────────

describe('migration SQL function bodies are paren-balanced (root supabase/migrations/*.sql)', () => {
  const migrationsDir = resolveMigrationsDir();
  const files = listRootMigrationFiles(migrationsDir);

  it('non-vacuity: finds root migration files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('00000000000000_baseline_from_prod.sql');
  });

  it('non-vacuity: extracts a substantial number of CREATE FUNCTION bodies across the chain', () => {
    let total = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      total += extractFunctionBodies(sql).length;
    }
    // Floor, not an exact count (the migration set grows continuously — see
    // supabase/CLAUDE.md's "count it, don't quote it" guidance). This exists
    // only to prove the extractor isn't silently matching zero real bodies.
    expect(total).toBeGreaterThan(300);
  });

  it('every extracted CREATE FUNCTION body has balanced parentheses', () => {
    const failures: string[] = [];

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const blocks = extractFunctionBodies(sql);

      for (const block of blocks) {
        const { open, close } = countParensOutsideLiteralsAndComments(block.body);
        if (open !== close) {
          failures.push(
            `${file}:${block.startLine} — ${block.label} (tag ${block.tag}): ` +
              `${open} '(' vs ${close} ')' — mismatched parentheses would make ` +
              `Postgres reject this CREATE [OR REPLACE] FUNCTION with ` +
              `SQLSTATE 42601 ("mismatched parentheses at or near \\";\\"")`
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  // Direct regression pin for the exact two files this bug shipped in twice,
  // so a future revert of either fix fails immediately and legibly rather
  // than only surfacing via the generic scan above.
  it.each([
    '00000000000000_baseline_from_prod.sql',
    '20260620000900_fix_match_rag_chunks_drop_syllabus_version.sql',
  ])('%s: match_rag_chunks and match_rag_chunks_ncert (where present) are paren-balanced', (file) => {
    const fullPath = path.join(migrationsDir, file);
    expect(fs.existsSync(fullPath)).toBe(true);

    const sql = fs.readFileSync(fullPath, 'utf8');
    const blocks = extractFunctionBodies(sql).filter((b) =>
      /match_rag_chunks/i.test(b.label)
    );

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(
        isBalanced(block.body),
        `${file}:${block.startLine} — ${block.label} (tag ${block.tag}) has mismatched parentheses`
      ).toBe(true);
    }
  });
});
