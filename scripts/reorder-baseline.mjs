#!/usr/bin/env node
/**
 * reorder-baseline.mjs
 * --------------------
 * Two-pass stream transform applied to a sanitized pg_dump baseline:
 *
 *   1. Rewrite PL/pgSQL `<table>%ROWTYPE` declarations to `RECORD`.
 *   2. Move every `LANGUAGE sql` function block to AFTER the last PL/pgSQL
 *      function block, topologically sorted by inter-function dependency
 *      (functions referenced by others come first).
 *
 * Both passes preserve total line count: pass 1 is a 1:1 token swap, and
 * pass 2 is a pure reorder of contiguous function blocks (with their trailing
 * separator blank lines). All non-function lines stay byte-for-byte where
 * pg_dump put them.
 *
 * Why pass 1 exists (`%ROWTYPE` → `RECORD`)
 * -----------------------------------------
 * pg_dump emits objects in dependency-aware topological order and relies on
 * `SET check_function_bodies = false` so a function body is not validated
 * against missing referenced objects on first parse. That covers PL/pgSQL
 * function BODIES.
 *
 * The single documented exception is `%ROWTYPE` declarations in PL/pgSQL
 * `DECLARE` blocks. `%ROWTYPE` is resolved at PARSE time of the function
 * (before `check_function_bodies` kicks in), so a `CREATE FUNCTION` whose
 * DECLARE references a not-yet-created table fails on a fresh replay even
 * with the `check_function_bodies` toggle off. Rewriting `<table>%ROWTYPE`
 * to the generic `RECORD` type fixes that — `RECORD` is resolved at runtime
 * via the `SELECT INTO` (or `RETURNING ... INTO`) that populates it, and
 * field access (`v_rec.column_name`) works identically.
 *
 * Why pass 2 exists (`LANGUAGE sql` reorder)
 * ------------------------------------------
 * Postgres validates `LANGUAGE sql` function bodies at CREATE time *even
 * with* `check_function_bodies = false`. The toggle only defers PL/pgSQL
 * bodies. Pure-SQL function bodies are parsed-and-bound up front, so a
 * `LANGUAGE sql` function that calls another function (sql or plpgsql)
 * fails to create if the callee doesn't exist yet.
 *
 * Phase 1 dry-run (CI run 25256333169) failed at line 1803 of the sanitized
 * baseline:
 *   - `check_foxy_quota` is `LANGUAGE sql` and was emitted alphabetically
 *     before `check_plan_limits` (line 1820), which it calls.
 *   - pg_dump's natural alphabetical-within-class ordering is wrong for this
 *     class of dependency.
 *
 * The narrow fix: extract every `LANGUAGE sql` function block, topologically
 * sort by sql→sql dependency (using a dump-wide function-name set), and
 * re-emit them all *after* the last PL/pgSQL function in the file. By that
 * point every plpgsql callee has been defined (they're created without body
 * validation anyway, so order among themselves doesn't matter), and the
 * sql-function topo sort solves sql→sql dependencies.
 *
 * Earlier iterations bucket-reordered every top-level statement in pg_dump's
 * output. That broke pg_dump's careful within-class ordering and required a
 * new bucket-fix for every prod-specific dependency class we tripped on
 * (function-to-function calls, view-on-view, functional indexes, partial-
 * index predicates, …). PRs #464, #466, #467, #469 each shipped one of those
 * fixes; #470 walked them all back. This script keeps the diff narrow:
 * only `LANGUAGE sql` function ordering is touched, and only because pg_dump
 * + `check_function_bodies = false` provably fail to handle it.
 *
 * Idempotent: running the script on its own output is a no-op.
 *   - Pass 1 has no `%ROWTYPE` strings left to rewrite.
 *   - Pass 2 sees the sql functions already at the end in topological order;
 *     re-running produces an identical layout.
 *
 * Usage:
 *   node scripts/reorder-baseline.mjs < input.sql > output.sql
 *   node scripts/reorder-baseline.mjs --input input.sql --output output.sql
 *
 * Self-tests:
 *   node scripts/reorder-baseline.mjs --self-test
 *
 * Owned by the architect agent (CI/baseline tooling).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath as _fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: %ROWTYPE → RECORD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite `<schema>.<table>%ROWTYPE` and `<table>%ROWTYPE` (with or without
 * double-quoted identifiers, case-insensitive on the literal `ROWTYPE`
 * keyword) to `RECORD`.
 *
 * Identifier shapes accepted (matching pg_dump output):
 *   - public.adaptive_mastery%ROWTYPE
 *   - "public"."adaptive_mastery"%ROWTYPE
 *   - adaptive_mastery%ROWTYPE
 *   - "adaptive_mastery"%ROWTYPE
 *   - adaptive_mastery%RowType   (case-insensitive)
 *
 * The regex consumes the full `<ident>(.<ident>)?%ROWTYPE` token and replaces
 * it with `RECORD`. Whitespace is preserved (the substitution is exact).
 */
const ROWTYPE_RE =
  /(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?%ROWTYPE/gi;

export function rewriteRowtype(src) {
  return src.replace(ROWTYPE_RE, 'RECORD');
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: reorder LANGUAGE sql functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match a top-level `CREATE (OR REPLACE) FUNCTION` header line.
 * Captures the function name (with optional schema qualifier).
 *
 * pg_dump emits the header with the name in either bare or double-quoted
 * form, optionally schema-qualified:
 *   CREATE OR REPLACE FUNCTION public.foo(args) RETURNS …
 *   CREATE OR REPLACE FUNCTION "public"."foo"(args) RETURNS …
 *   CREATE FUNCTION foo(args) RETURNS …
 */
const CREATE_FN_RE =
  /^CREATE (?:OR REPLACE )?FUNCTION\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))(?:\.(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)))?\s*\(/;

/**
 * Detect the LANGUAGE clause inside a function block. pg_dump emits this on
 * its own line as `    LANGUAGE "sql"` or `    LANGUAGE plpgsql`, optionally
 * with attribute clauses appended (`SECURITY DEFINER`, `IMMUTABLE`, etc.).
 */
const LANGUAGE_RE = /\bLANGUAGE\s+"?(sql|plpgsql|c|internal|plperl|plpython3u|plv8)"?/i;

/**
 * Extract the body content of a function block as a single string for
 * dependency scanning. Strips line comments (`--` to end-of-line) and the
 * function header (everything before and including `AS $TAG$`).
 */
function extractBodyForDepScan(blockLines) {
  let inBody = false;
  const out = [];
  for (const line of blockLines) {
    if (!inBody) {
      const m = line.match(/AS\s+(\$[A-Za-z0-9_]*\$)/);
      if (m) {
        inBody = true;
        // Append the rest of the AS line (post-tag) to the body — for
        // single-line bodies the entire body is here.
        const idx = line.indexOf(m[0]) + m[0].length;
        out.push(line.substring(idx));
        continue;
      }
      continue;
    }
    out.push(line);
  }
  // Strip line comments (`-- …` to end-of-line). Keep string literals as-is;
  // the rare false positive (a function name inside a string) is harmless.
  return out.map((l) => l.replace(/--.*$/, '')).join('\n');
}

/**
 * Given a function body string and a Set of all known function names in the
 * dump, return the subset of names that this body calls.
 *
 * Detection heuristic: any identifier `<name>` immediately followed by `(`
 * is a candidate. We then filter against the known-functions set so only
 * dump-defined functions count (built-ins like `now()`, `coalesce()`,
 * `jsonb_build_object()` are ignored automatically — they're not in our
 * dump's function set).
 *
 * Schema-qualified calls (`public.foo(...)`) and bare calls (`foo(...)`)
 * are both handled. The terminal-name capture (group 2) is what we look up.
 */
function findReferencedFunctions(body, knownNames) {
  const refs = new Set();
  const callRe =
    /(?:"?([A-Za-z_][A-Za-z0-9_]*)"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/g;
  let m;
  while ((m = callRe.exec(body)) !== null) {
    const name = m[2];
    if (knownNames.has(name)) refs.add(name);
  }
  return refs;
}

/**
 * Parse the source into an ordered list of "segments". A segment is either:
 *   - { kind: 'lines', text: string }
 *     non-function content (tables, indexes, policies, blank lines, …),
 *     emitted byte-for-byte unchanged.
 *   - { kind: 'fn', name, lang, lines, trailing }
 *     a CREATE FUNCTION block. `lines` is the function-block lines from
 *     `CREATE OR REPLACE FUNCTION` through the closing `$TAG$;` line
 *     (inclusive). `trailing` is the blank lines that immediately follow,
 *     bundled with the function so reorder moves the visual separator
 *     along with the block.
 *
 * pg_dump output interleaves CREATE TABLE, CREATE FUNCTION, COMMENT ON, and
 * other top-level statements. Each function block is bounded:
 *   open  : `CREATE OR REPLACE FUNCTION … RETURNS …`  (header)
 *           `    LANGUAGE … …`                         (attribute lines)
 *           `    SET search_path TO …`
 *           `    AS $TAG$`                             (body opener)
 *   body  : zero or more lines (may contain nested $sub$ … $sub$ literals
 *           with a DIFFERENT tag than the outer; Postgres requires nested
 *           dollar-quotes to use distinct tags so the outer close is
 *           unambiguous)
 *   close : a line containing `$TAG$;` (may share the line with body
 *           content like `END; $$;` or `RETURN; $_$;`)
 *
 * Single-line bodies are also supported (`AS $$ SELECT 1 $$;` on one line).
 */
function parseSegments(src) {
  const lines = src.split('\n');
  const segments = [];
  let pendingLines = [];
  let i = 0;

  const flushPending = () => {
    if (pendingLines.length > 0) {
      segments.push({ kind: 'lines', text: pendingLines.join('\n') });
      pendingLines = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!CREATE_FN_RE.test(line)) {
      pendingLines.push(line);
      i += 1;
      continue;
    }

    // Found a CREATE FUNCTION header. Scan forward for `AS $TAG$` opener.
    const blockLines = [];
    let openTag = null;
    let bodyOpenLineIdx = -1;
    let restOfOpenLine = '';
    let j = i;
    while (j < lines.length) {
      const cur = lines[j];
      blockLines.push(cur);
      const asMatch = cur.match(/AS\s+(\$[A-Za-z0-9_]*\$)/);
      if (asMatch) {
        openTag = asMatch[1];
        bodyOpenLineIdx = j;
        restOfOpenLine = cur.substring(cur.indexOf(asMatch[0]) + asMatch[0].length);
        break;
      }
      j += 1;
    }

    if (openTag === null) {
      // Malformed: no AS $TAG$ found before EOF. Fall back to lines.
      pendingLines.push(line);
      i += 1;
      // Drop the speculatively-collected blockLines; the next loop iteration
      // will pick up subsequent lines into pendingLines.
      continue;
    }

    // Look for the closing tag. The closer is the next occurrence of
    // `<openTag>;` AFTER the opener, anywhere on subsequent lines (or on
    // the same line, after the opener — that's a single-line body).
    const closeNeedle = openTag + ';';
    let closeLineIdx = -1;
    if (restOfOpenLine.includes(closeNeedle)) {
      // Single-line body — the close is on the same line as the AS opener.
      closeLineIdx = bodyOpenLineIdx;
    } else {
      // Multi-line body — scan forward.
      let k = bodyOpenLineIdx + 1;
      while (k < lines.length) {
        if (lines[k].includes(closeNeedle)) {
          closeLineIdx = k;
          break;
        }
        // Append body line to blockLines as we go.
        blockLines.push(lines[k]);
        k += 1;
      }
      if (closeLineIdx === -1) {
        // Malformed: no closer found. Treat the unclosed block as raw lines.
        // This is defensive — pg_dump always closes its blocks.
        pendingLines.push(...blockLines);
        i = lines.length;
        break;
      }
      blockLines.push(lines[closeLineIdx]);
    }

    // Extract metadata from the block.
    const headerLine = blockLines[0];
    const m = headerLine.match(CREATE_FN_RE);
    const funcName = m[3] || m[4] || m[1] || m[2];

    let lang = null;
    for (const bl of blockLines) {
      const lm = bl.match(LANGUAGE_RE);
      if (lm) {
        lang = lm[1].toLowerCase();
        break;
      }
    }

    // Collect trailing blank lines so the visual separator moves with the
    // function on reorder.
    const trailing = [];
    let t = closeLineIdx + 1;
    while (t < lines.length && lines[t].trim() === '') {
      trailing.push(lines[t]);
      t += 1;
    }

    flushPending();
    segments.push({
      kind: 'fn',
      name: funcName,
      lang,
      lines: blockLines,
      trailing,
    });

    i = t;
  }

  flushPending();
  return segments;
}

/**
 * Serialize a segment list back to a single string.
 *
 * Note: each segment carries its own line content. Concatenating with `\n`
 * exactly inverts `src.split('\n')` IF every segment's `text` / `lines` /
 * `trailing` together cover all original lines without overlap or gap.
 */
function serializeSegments(segments) {
  const parts = [];
  for (const seg of segments) {
    if (seg.kind === 'lines') {
      parts.push(seg.text);
    } else {
      parts.push(seg.lines.join('\n'));
      if (seg.trailing.length > 0) {
        parts.push(seg.trailing.join('\n'));
      }
    }
  }
  return parts.join('\n');
}

/**
 * Topologically sort a list of fn segments by sql→sql inter-dependency.
 *
 * Each fn has a `name` and a body. Build a graph where edge A → B means
 * "A's body calls B". Emit B before A (callee first). Functions with no
 * inter-fn deps keep their original order (stable sort by original index).
 *
 * Cycles are emitted in original order with a warning. Postgres will reject
 * the cycle on replay anyway, so failing fast (with diagnostics) is
 * preferable to silently choosing some order.
 */
function topoSortSqlFunctions(sqlFns, allKnownNames) {
  // name → array of indices (handles overloads).
  const fnsByName = new Map();
  sqlFns.forEach((fn, idx) => {
    const arr = fnsByName.get(fn.name) || [];
    arr.push(idx);
    fnsByName.set(fn.name, arr);
  });

  // Compute deps for each fn: the set of OTHER sql-fn names this one calls.
  // (Calls into plpgsql don't constrain ordering within the sql group;
  // every plpgsql fn is already defined before the sql group emits.)
  const deps = sqlFns.map((fn) => {
    const body = extractBodyForDepScan(fn.lines);
    const refs = findReferencedFunctions(body, allKnownNames);
    const sqlOnlyRefs = new Set();
    for (const r of refs) {
      if (r === fn.name) continue;
      if (fnsByName.has(r)) sqlOnlyRefs.add(r);
    }
    return sqlOnlyRefs;
  });

  // Build the graph. edges: dep-index → [dependent-indices].
  const inDegree = sqlFns.map(() => 0);
  const adj = sqlFns.map(() => []);
  for (let i = 0; i < sqlFns.length; i += 1) {
    for (const depName of deps[i]) {
      const depIndices = fnsByName.get(depName) || [];
      for (const di of depIndices) {
        if (di === i) continue;
        adj[di].push(i);
        inDegree[i] += 1;
      }
    }
  }

  // Kahn's algorithm with stable ordering by original index.
  const result = [];
  const ready = [];
  for (let i = 0; i < sqlFns.length; i += 1) {
    if (inDegree[i] === 0) ready.push(i);
  }
  ready.sort((a, b) => a - b);

  while (ready.length > 0) {
    const idx = ready.shift();
    result.push(idx);
    for (const next of adj[idx]) {
      inDegree[next] -= 1;
      if (inDegree[next] === 0) {
        // Insert preserving original-index priority.
        let inserted = false;
        for (let q = 0; q < ready.length; q += 1) {
          if (ready[q] > next) {
            ready.splice(q, 0, next);
            inserted = true;
            break;
          }
        }
        if (!inserted) ready.push(next);
      }
    }
  }

  if (result.length !== sqlFns.length) {
    console.error(
      `WARNING: cycle detected among LANGUAGE sql functions. ` +
        `${sqlFns.length - result.length} function(s) could not be topologically ordered. ` +
        `Postgres will likely reject these. Emitting in original order.`,
    );
    const seen = new Set(result);
    for (let i = 0; i < sqlFns.length; i += 1) {
      if (!seen.has(i)) result.push(i);
    }
  }

  return result.map((i) => sqlFns[i]);
}

/**
 * Reorder pass 2: move every LANGUAGE sql function block to AFTER the last
 * non-sql function block (i.e. to the end of the function section), topo-
 * sorted by sql→sql dependency.
 *
 * Strategy:
 *   1. Parse src into segments.
 *   2. Identify sql-language fn segments (`lang === 'sql'`).
 *   3. If there are no sql fns or no plpgsql fns, return src unchanged.
 *   4. Find the index of the last plpgsql fn segment.
 *   5. Topo-sort sql fn segments.
 *   6. Remove sql fn segments from the segment list, then re-insert them
 *      immediately after the last plpgsql fn segment (in topo order).
 *   7. Serialize.
 *
 * Line-count preservation: each fn segment moves with its trailing blank
 * lines. The total line count of the file is preserved exactly (segments
 * cover all original lines, and reordering segments is a permutation).
 *
 * Idempotency: when run on already-reordered output, sql fns are already
 * after the last plpgsql fn AND the topo sort is stable, so re-running
 * yields an identical layout.
 */
export function reorderSqlFunctions(src) {
  const segments = parseSegments(src);

  // Collect every fn name in the dump (regardless of language).
  const knownNames = new Set();
  for (const seg of segments) {
    if (seg.kind === 'fn') knownNames.add(seg.name);
  }

  // Index of last plpgsql fn segment, presence of any sql fn.
  let lastPlpgsqlIdx = -1;
  let hasSqlFn = false;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (s.kind !== 'fn') continue;
    if (s.lang === 'plpgsql') lastPlpgsqlIdx = i;
    if (s.lang === 'sql') hasSqlFn = true;
  }

  // No-op if there's nothing to reorder.
  if (!hasSqlFn || lastPlpgsqlIdx === -1) return src;

  // Collect sql fn segments (in original order) and their indices.
  const sqlFnSegs = [];
  const sqlFnIndices = new Set();
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].kind === 'fn' && segments[i].lang === 'sql') {
      sqlFnSegs.push(segments[i]);
      sqlFnIndices.add(i);
    }
  }

  // Topo-sort the sql fns by sql→sql dependency.
  const ordered = topoSortSqlFunctions(sqlFnSegs, knownNames);

  // Build the new segment list:
  //   - non-sql-fn segments at index <= lastPlpgsqlIdx (in original order)
  //   - then ordered sql fn segments
  //   - then non-sql-fn segments at index > lastPlpgsqlIdx (in original
  //     order)
  const before = [];
  const after = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (sqlFnIndices.has(i)) continue;
    if (i <= lastPlpgsqlIdx) before.push(segments[i]);
    else after.push(segments[i]);
  }

  return serializeSegments([...before, ...ordered, ...after]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full rewrite: pass 1 (%ROWTYPE → RECORD), then pass 2 (reorder LANGUAGE
 * sql). Idempotent — running it on its own output is a no-op.
 */
export function rewriteAll(src) {
  return reorderSqlFunctions(rewriteRowtype(src));
}

// Kept exported under the old name so any external caller (workflow, runbook
// snippet) that referenced `reorder()` keeps working without an interface
// break.
export const reorder = rewriteAll;

// ─────────────────────────────────────────────────────────────────────────────
// Self-tests (run with --self-test)
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
  let passed = 0;
  let failed = 0;
  const expect = (label, cond, detail) => {
    if (cond) {
      passed += 1;
      process.stdout.write(`  PASS  ${label}\n`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };

  // ── Pass 1: %ROWTYPE rewrite ──────────────────────────────────────────────

  // 1. Schema-qualified bare-identifier form.
  expect(
    'rewrites public.adaptive_mastery%ROWTYPE → RECORD',
    rewriteRowtype('  v_rec public.adaptive_mastery%ROWTYPE;') ===
      '  v_rec RECORD;',
  );

  // 2. Schema-qualified quoted form.
  expect(
    'rewrites "public"."adaptive_mastery"%ROWTYPE → RECORD',
    rewriteRowtype('  v_rec "public"."adaptive_mastery"%ROWTYPE;') ===
      '  v_rec RECORD;',
  );

  // 3. Unqualified bare form.
  expect(
    'rewrites adaptive_mastery%ROWTYPE → RECORD',
    rewriteRowtype('DECLARE v adaptive_mastery%ROWTYPE;') ===
      'DECLARE v RECORD;',
  );

  // 4. Unqualified quoted form.
  expect(
    'rewrites "adaptive_mastery"%ROWTYPE → RECORD',
    rewriteRowtype('DECLARE v "adaptive_mastery"%ROWTYPE;') ===
      'DECLARE v RECORD;',
  );

  // 5. Case-insensitive on the ROWTYPE keyword.
  expect(
    'case-insensitive: %RowType also rewrites',
    rewriteRowtype('v public.foo%RowType;') === 'v RECORD;',
  );

  // 6. Inside a CREATE FUNCTION dollar-quoted body (single line).
  const sqlSingle =
    "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v public.foo%ROWTYPE; BEGIN RETURN; END; $$;";
  const expSingle =
    "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v RECORD; BEGIN RETURN; END; $$;";
  expect('rewrites %ROWTYPE inside single-line $$ … $$ body', rewriteRowtype(sqlSingle) === expSingle);

  // 7. Inside a CREATE FUNCTION dollar-quoted body (multi-line).
  const sqlMulti = [
    'CREATE OR REPLACE FUNCTION public.bkt_update() RETURNS void LANGUAGE plpgsql AS $$',
    'DECLARE',
    '  v_rec public.adaptive_mastery%ROWTYPE;',
    'BEGIN',
    '  RETURN;',
    'END;',
    '$$;',
  ].join('\n');
  const out7 = rewriteRowtype(sqlMulti);
  expect('rewrites %ROWTYPE inside multi-line $$ … $$ body',
    out7.includes('  v_rec RECORD;') && !out7.includes('%ROWTYPE'));

  // 8. Multiple ROWTYPEs in one chunk.
  const sqlMany =
    'DECLARE a foo%ROWTYPE; b public.bar%ROWTYPE; c "baz"%ROWTYPE;';
  expect('rewrites multiple %ROWTYPE on one line',
    rewriteRowtype(sqlMany) === 'DECLARE a RECORD; b RECORD; c RECORD;');

  // 9. No %ROWTYPE → no-op (byte-for-byte identical).
  const noop = [
    'CREATE TABLE IF NOT EXISTS public.adaptive_mastery (id uuid PRIMARY KEY);',
    "CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    'CREATE INDEX idx_foo ON public.foo(id);',
    'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
    "COMMENT ON SCHEMA public IS 'standard';",
    '',
  ].join('\n');
  expect('no-op when input has no %ROWTYPE (byte-stable)', rewriteRowtype(noop) === noop);

  // 10. Idempotency: rewriteRowtype on its own output is a no-op.
  const once = rewriteRowtype(sqlMulti);
  const twice = rewriteRowtype(once);
  expect('idempotent: rewriteRowtype(rewriteRowtype(x)) === rewriteRowtype(x)', once === twice);

  // 11. Line count is unchanged (RECORD rewrite is a 1:1 token swap).
  const nLines = sqlMulti.split('\n').length;
  const nLinesAfter = rewriteRowtype(sqlMulti).split('\n').length;
  expect('rewriteRowtype: line count unchanged after rewrite',
    nLines === nLinesAfter, `before=${nLines} after=${nLinesAfter}`);

  // 12. Boundary: %ROWTYPE-like substring inside a comment without a
  //     preceding identifier is left alone.
  const comment = '-- this %ROWTYPE comment will not match (no preceding ident)';
  expect('comment without preceding identifier is left alone',
    rewriteRowtype(comment) === comment);

  // 13. Identifier with digits.
  expect('identifier with digits handled',
    rewriteRowtype('v t1_v2%ROWTYPE;') === 'v RECORD;');

  // 14. Underscore-leading identifier.
  expect('underscore-leading identifier handled',
    rewriteRowtype('v _internal_state%ROWTYPE;') === 'v RECORD;');

  // ── Pass 2: LANGUAGE sql reorder ──────────────────────────────────────────

  // 15. SQL function calling another SQL function (the regression from CI run
  //     25256333169): `check_foxy_quota` (sql) referenced `check_plan_limits`
  //     before the latter was emitted. After reorder, the callee precedes the
  //     caller and both end up after the plpgsql block.
  const fixture15 = [
    'CREATE OR REPLACE FUNCTION public.check_foxy_quota(p_id uuid) RETURNS jsonb',
    '    LANGUAGE sql SECURITY DEFINER',
    '    AS $$ SELECT public.check_plan_limits(p_id, $1::text) $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.check_plan_limits(p_id uuid, p_kind text) RETURNS jsonb',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN jsonb_build_object($1::text, $2); END; $$;',
    '',
  ].join('\n');
  const out15 = reorderSqlFunctions(fixture15);
  const planIdx15 = out15.indexOf('check_plan_limits(p_id uuid, p_kind text)');
  const foxyIdx15 = out15.indexOf('check_foxy_quota(p_id uuid)');
  expect(
    'sql_function_after_dependent: callee plpgsql comes before sql caller',
    planIdx15 > -1 && foxyIdx15 > -1 && planIdx15 < foxyIdx15,
    `plan=${planIdx15} foxy=${foxyIdx15}`,
  );

  // 15b. Line-count preservation on reorder.
  expect(
    'reorder: line count unchanged',
    fixture15.split('\n').length === out15.split('\n').length,
    `before=${fixture15.split('\n').length} after=${out15.split('\n').length}`,
  );

  // 16. Mixed plpgsql and sql interspersed: plpgsql untouched in place,
  //     sql appended after the last plpgsql.
  const fixture16 = [
    'CREATE OR REPLACE FUNCTION public.s1(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT p $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.g1(p uuid) RETURNS uuid',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN p; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s2(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT p $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.g2(p uuid) RETURNS uuid',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN p; END; $$;',
    '',
  ].join('\n');
  const out16 = reorderSqlFunctions(fixture16);
  const g1Idx = out16.indexOf('public.g1(');
  const g2Idx = out16.indexOf('public.g2(');
  const s1Idx = out16.indexOf('public.s1(');
  const s2Idx = out16.indexOf('public.s2(');
  expect(
    'mixed_plpgsql_and_sql: plpgsql in place, sql appended after',
    g1Idx > -1 && g2Idx > -1 && s1Idx > -1 && s2Idx > -1 &&
      g1Idx < g2Idx && g2Idx < s1Idx && s1Idx < s2Idx,
    `g1=${g1Idx} g2=${g2Idx} s1=${s1Idx} s2=${s2Idx}`,
  );
  expect(
    'mixed_plpgsql_and_sql: line count unchanged',
    fixture16.split('\n').length === out16.split('\n').length,
  );

  // 17. Independent SQL functions: stable order preserved.
  const fixture17 = [
    'CREATE OR REPLACE FUNCTION public.g1(p uuid) RETURNS uuid',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN p; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.alpha(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT p $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.beta(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT p $$;',
    '',
  ].join('\n');
  const out17 = reorderSqlFunctions(fixture17);
  const aIdx = out17.indexOf('public.alpha(');
  const bIdx = out17.indexOf('public.beta(');
  expect(
    'sql_function_independent: stable order preserved (alpha before beta)',
    aIdx > -1 && bIdx > -1 && aIdx < bIdx,
    `alpha=${aIdx} beta=${bIdx}`,
  );

  // 18. SQL function with nested dollar-quoted strings inside the body.
  //     The body uses tag `$_$` as the outer delimiter and contains literal
  //     `$$` inside (which is NOT the closing tag). The reorder must not
  //     mistake the inner `$$` for the closing delimiter.
  const fixture18 = [
    'CREATE OR REPLACE FUNCTION public.gen(p text) RETURNS text',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN p; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.normalize(p text) RETURNS text',
    '    LANGUAGE sql IMMUTABLE',
    '    AS $_$',
    '  SELECT regexp_replace(p, $$\\d+$$, $$N$$, $$g$$);',
    '$_$;',
    '',
  ].join('\n');
  const out18 = reorderSqlFunctions(fixture18);
  // Body must be intact (the inner $$ literals must survive).
  expect(
    'sql_function_with_nested_dollar: body preserved across reorder',
    out18.includes('regexp_replace(p, $$\\d+$$, $$N$$, $$g$$);'),
  );
  expect(
    'sql_function_with_nested_dollar: line count unchanged',
    fixture18.split('\n').length === out18.split('\n').length,
  );

  // 19. Cycle: two sql fns calling each other → warn + emit in original
  //     order. Capture stderr to validate the warning was emitted.
  const fixture19 = [
    'CREATE OR REPLACE FUNCTION public.anchor() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT public.f2() $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f2() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT public.f1() $$;',
    '',
  ].join('\n');
  const origConsoleError = console.error;
  let warnedMsg = '';
  console.error = (msg) => { warnedMsg += String(msg) + '\n'; };
  let out19;
  try {
    out19 = reorderSqlFunctions(fixture19);
  } finally {
    console.error = origConsoleError;
  }
  const f1Idx = out19.indexOf('public.f1()');
  const f2Idx = out19.indexOf('public.f2()');
  expect(
    'cycle_in_sql_functions: warning emitted',
    /cycle detected/i.test(warnedMsg),
    warnedMsg ? warnedMsg.slice(0, 80) : '(no warning)',
  );
  expect(
    'cycle_in_sql_functions: original order preserved (f1 before f2)',
    f1Idx > -1 && f2Idx > -1 && f1Idx < f2Idx,
    `f1=${f1Idx} f2=${f2Idx}`,
  );

  // 20. Idempotency on the new pass: running on already-reordered output is
  //     a no-op.
  const out15Twice = reorderSqlFunctions(out15);
  expect(
    'reorderSqlFunctions: idempotent on already-reordered input',
    out15 === out15Twice,
  );

  // 21. End-to-end: rewriteAll combines both passes; preserves line count.
  const combined = [
    'CREATE OR REPLACE FUNCTION public.g1(p uuid) RETURNS uuid',
    '    LANGUAGE plpgsql',
    '    AS $$ DECLARE v public.adaptive_mastery%ROWTYPE; BEGIN RETURN p; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s1(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT public.g1(p) $$;',
    '',
  ].join('\n');
  const outAll = rewriteAll(combined);
  expect(
    'rewriteAll: %ROWTYPE rewritten in plpgsql AND sql moved after',
    !outAll.includes('%ROWTYPE') && outAll.indexOf('public.s1(') > outAll.indexOf('public.g1('),
  );
  expect(
    'rewriteAll: line count unchanged',
    combined.split('\n').length === outAll.split('\n').length,
  );

  // 22. End-to-end idempotency.
  const outAll2 = rewriteAll(outAll);
  expect('rewriteAll: idempotent', outAll === outAll2);

  // 23. sql→sql topological dep order: callee before caller.
  const fnChainAllSql = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.check_plan_limits(p_id uuid, p_kind text) RETURNS jsonb',
    '    LANGUAGE sql',
    '    AS $$ SELECT jsonb_build_object($1::text, $2) $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.check_foxy_quota(p_student_id uuid) RETURNS jsonb',
    '    LANGUAGE sql',
    "    AS $$ SELECT public.check_plan_limits(p_student_id, 'foxy') $$;",
    '',
  ].join('\n');
  const outChain = rewriteAll(fnChainAllSql);
  const planIdxC = outChain.indexOf('check_plan_limits(p_id uuid');
  const foxyIdxC = outChain.indexOf('check_foxy_quota(p_student_id');
  expect(
    'sql→sql topological dep order: callee before caller',
    planIdxC > -1 && foxyIdxC > -1 && planIdxC < foxyIdxC,
    `plan=${planIdxC} foxy=${foxyIdxC}`,
  );

  // 24. No-op when there are no sql functions.
  const noSql = [
    'CREATE OR REPLACE FUNCTION public.g1(p uuid) RETURNS uuid',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN p; END; $$;',
    '',
  ].join('\n');
  expect('reorderSqlFunctions: no-op when no sql fns present',
    reorderSqlFunctions(noSql) === noSql);

  // 25. No-op when there are no plpgsql fns (no anchor for the reorder).
  const noPl = [
    'CREATE OR REPLACE FUNCTION public.s1(p uuid) RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT p $$;',
    '',
  ].join('\n');
  expect('reorderSqlFunctions: no-op when no plpgsql fns present',
    reorderSqlFunctions(noPl) === noPl);

  // 26. DO blocks are left alone (they don't match CREATE FUNCTION).
  const doBlock = [
    'CREATE OR REPLACE FUNCTION public.g1() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'DO $$ BEGIN PERFORM public.something(); END $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
  ].join('\n');
  const outDo = reorderSqlFunctions(doBlock);
  expect(
    'do_block_left_alone: DO block preserved',
    outDo.includes('DO $$ BEGIN PERFORM public.something(); END $$;'),
  );
  expect(
    'do_block_left_alone: line count preserved',
    doBlock.split('\n').length === outDo.split('\n').length,
  );

  // 27. Closing dollar-tag on the same line as body content (e.g. `END; $$;`).
  //     This is the most common pg_dump emission shape and was a parser bug
  //     in an early draft of pass 2.
  const sameLineClose = [
    'CREATE OR REPLACE FUNCTION public.g1() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$',
    'BEGIN',
    '  RETURN;',
    'END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.tab1() RETURNS int',
    '    LANGUAGE sql IMMUTABLE',
    '    AS $$ SELECT 1 $$;',
    '',
    '',
    'CREATE TABLE IF NOT EXISTS public.t1 (id uuid PRIMARY KEY);',
    '',
  ].join('\n');
  const outSL = reorderSqlFunctions(sameLineClose);
  // tab1 (sql) must appear AFTER g1 (plpgsql) but BEFORE the table line.
  // Wait — actually after, since we move sql to "after the last plpgsql".
  // The CREATE TABLE is non-fn content; sql gets inserted between g1 and
  // the table.
  const g1Pos = outSL.indexOf('public.g1()');
  const tabPos = outSL.indexOf('public.tab1()');
  const tablePos = outSL.indexOf('CREATE TABLE IF NOT EXISTS public.t1');
  expect(
    'same_line_close: parser correctly bounds plpgsql function with `END; $$;`',
    g1Pos > -1 && tabPos > -1 && tablePos > -1 && g1Pos < tabPos && tabPos < tablePos,
    `g1=${g1Pos} tab1=${tabPos} table=${tablePos}`,
  );
  expect(
    'same_line_close: line count preserved',
    sameLineClose.split('\n').length === outSL.split('\n').length,
  );

  // 28. Nested dollar-quote with DIFFERENT inner tag (`$sql$ … $sql$` inside
  //     `$_$ … $_$` outer). Postgres requires nested tags to differ; pg_dump
  //     follows that rule. The parser must not close the outer body on the
  //     inner tag.
  const nested = [
    'CREATE OR REPLACE FUNCTION public.cleanup_ops_events() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $_$',
    'DECLARE v_dispatch bigint;',
    'BEGIN',
    '  EXECUTE $sql$ DELETE FROM x WHERE y $sql$ INTO v_dispatch;',
    'END; $_$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s_after() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
  ].join('\n');
  const outNest = reorderSqlFunctions(nested);
  // s_after should land AFTER cleanup_ops_events (the only plpgsql).
  const cleanPos = outNest.indexOf('public.cleanup_ops_events()');
  const sAfterPos = outNest.indexOf('public.s_after()');
  expect(
    'nested_dollar_tag: parser uses outer tag to find close',
    cleanPos > -1 && sAfterPos > -1 && cleanPos < sAfterPos,
    `clean=${cleanPos} sAfter=${sAfterPos}`,
  );
  // Verify the inner $sql$ string content is intact.
  expect(
    'nested_dollar_tag: inner $sql$ literal preserved',
    outNest.includes('EXECUTE $sql$ DELETE FROM x WHERE y $sql$ INTO v_dispatch;'),
  );

  // 29. Interleaved tables between functions (pg_dump common shape — e.g.
  //     CREATE TABLE → CREATE FUNCTION RETURNS SETOF that-table).
  //     Tables must stay where pg_dump put them; only sql functions move.
  const interleaved = [
    'CREATE TABLE IF NOT EXISTS public.parent_table (id uuid PRIMARY KEY);',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.fn_using_parent() RETURNS SETOF public.parent_table',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE TABLE IF NOT EXISTS public.child_table (id uuid PRIMARY KEY);',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.sql_helper() RETURNS uuid',
    '    LANGUAGE sql',
    '    AS $$ SELECT gen_random_uuid() $$;',
    '',
  ].join('\n');
  const outInt = reorderSqlFunctions(interleaved);
  // parent_table must come first (it was first in input).
  const parentPos = outInt.indexOf('public.parent_table');
  const fnPos = outInt.indexOf('public.fn_using_parent');
  const childPos = outInt.indexOf('public.child_table');
  const sqlPos = outInt.indexOf('public.sql_helper');
  expect(
    'interleaved_tables: tables stay in pg_dump order, sql moves to after last plpgsql',
    parentPos > -1 && fnPos > -1 && childPos > -1 && sqlPos > -1 &&
      parentPos < fnPos && fnPos < sqlPos && sqlPos < childPos,
    `parent=${parentPos} fn=${fnPos} sql=${sqlPos} child=${childPos}`,
  );
  expect(
    'interleaved_tables: line count preserved',
    interleaved.split('\n').length === outInt.split('\n').length,
  );

  process.stdout.write(`\nself-test: ${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit(selfTest());
  }

  let inPath = null;
  let outPath = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--input' || args[i] === '-i') inPath = args[i + 1];
    if (args[i] === '--output' || args[i] === '-o') outPath = args[i + 1];
    if (args[i] === '--help' || args[i] === '-h') {
      console.error('usage: node scripts/reorder-baseline.mjs [--input X] [--output Y] [--self-test]');
      console.error('       (defaults to stdin / stdout if --input / --output omitted)');
      process.exit(0);
    }
  }

  const input = inPath
    ? readFileSync(inPath, 'utf8')
    : readFileSync(0, 'utf8'); // fd 0 = stdin
  const output = rewriteAll(input);
  if (outPath) {
    writeFileSync(outPath, output);
  } else {
    process.stdout.write(output);
  }
}

const _entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const _self = _fileURLToPath(import.meta.url).replace(/\\/g, '/');
if (_entry === _self) {
  await main();
}
