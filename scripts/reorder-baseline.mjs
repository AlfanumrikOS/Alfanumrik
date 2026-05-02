#!/usr/bin/env node
/**
 * reorder-baseline.mjs
 * --------------------
 * Two-pass stream transform applied to a sanitized pg_dump baseline:
 *
 *   1. Rewrite PL/pgSQL `<table>%ROWTYPE` declarations to `RECORD`.
 *   2. Move every `LANGUAGE sql` function block to AFTER the last PL/pgSQL
 *      function block, topologically sorted by inter-function dependency
 *      (functions referenced by others come first). Any matching
 *      `COMMENT ON FUNCTION <same-name>(<same-args>) IS '...';` statement
 *      is moved with the function so it lands AFTER its target instead of
 *      orphaned at its original pg_dump emit position.
 *
 * Both passes preserve total line count: pass 1 is a 1:1 token swap, and
 * pass 2 is a pure reorder of contiguous function blocks (with their trailing
 * separator blank lines and any attached COMMENT ON FUNCTION lines). All
 * non-function, non-attached-comment lines stay byte-for-byte where pg_dump
 * put them.
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
 * Why pass 2 also relocates `COMMENT ON FUNCTION`
 * -----------------------------------------------
 * pg_dump emits `COMMENT ON FUNCTION <qname>(<args>) IS '...';` as a top-
 * level statement at the natural alphabetical-within-class position of its
 * target function. When pass 2 moves a `LANGUAGE sql` function block to the
 * end of the function section, the matching COMMENT statement stays put —
 * which is now BEFORE the target function exists, and Postgres rejects the
 * statement on replay (`ERROR: function public.foo() does not exist`).
 *
 * Phase 1 dry-run after PR #479 (CI run 25257499959) hit exactly this:
 *   `COMMENT ON FUNCTION "public"."current_school_id"() IS '...'` at line 88
 *   was emitted before the moved `current_school_id` SQL function block.
 *
 * The narrow fix: when pass 2 extracts a `LANGUAGE sql` function block, also
 * find every `COMMENT ON FUNCTION <qname>(<args>) IS ...;` whose qualified
 * name AND arg type signature exactly match the function's, and move those
 * comments along with the block. Comments are attached to the function
 * segment and emitted immediately after the block. Other COMMENT classes
 * (`COMMENT ON TABLE`, `COMMENT ON COLUMN`, …) are left alone — only
 * `COMMENT ON FUNCTION` for moved sql functions is in scope.
 *
 * `ALTER FUNCTION ... OWNER TO`, `GRANT EXECUTE ON FUNCTION`, and
 * `REVOKE ... ON FUNCTION` are already stripped earlier in sanitization
 * (Section 2.1 of the workflow), so they cannot become orphaned here.
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
 *   - Pass 2 sees the sql functions already at the end in topological order
 *     with their COMMENT statements already attached; re-running produces an
 *     identical layout.
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
 * Match a top-level `COMMENT ON FUNCTION <qname>(<args>) IS '...';` statement.
 * pg_dump always emits this on a single line:
 *   COMMENT ON FUNCTION "public"."f"() IS 'note';
 *   COMMENT ON FUNCTION public.f(arg "uuid") IS 'note';
 *   COMMENT ON FUNCTION f() IS 'note';
 *
 * Anchored to start-of-line, terminated by `;` at end-of-line. Multi-line
 * COMMENT IS literals are not produced by pg_dump for function comments
 * (the IS literal is escaped onto a single line with embedded `''`), so we
 * match only single-line shapes.
 */
const COMMENT_FN_RE = /^COMMENT ON FUNCTION\s+(.+?)\s+IS\s+(?:'(?:[^']|'')*')\s*;\s*$/;

/**
 * Normalize a function arg list for cross-statement equality.
 *
 * pg_dump emits arg lists slightly differently in `CREATE FUNCTION` vs
 * `COMMENT ON FUNCTION`:
 *   CREATE  : ("p_id" "uuid", "p_kind" "text" DEFAULT NULL::"text")
 *   COMMENT : ("p_id" "uuid", "p_kind" "text")
 * The COMMENT form omits `DEFAULT ...` clauses (PostgreSQL's catalog match
 * for COMMENT is by signature, not defaults).
 *
 * The argument NAMES are also optional in COMMENT. In practice pg_dump emits
 * names in both, but the canonical Postgres rule for matching is by type
 * signature alone (in declaration order). This normalizer:
 *   - strips `DEFAULT <expr>` clauses (anything from `DEFAULT` to the next
 *     top-level comma or close-paren)
 *   - strips IN/OUT/INOUT/VARIADIC mode markers
 *   - strips arg names (the leading bare or quoted identifier of each arg)
 *   - removes outer parens, collapses whitespace, lowercases
 *   - returns a canonical comma-separated type list, e.g. `uuid,text`
 *
 * Empty arg list `()` returns `''`.
 */
function normalizeArgs(rawArgList) {
  // Trim outer parens.
  let s = rawArgList.trim();
  if (s.startsWith('(')) s = s.slice(1);
  if (s.endsWith(')')) s = s.slice(0, -1);
  s = s.trim();
  if (s.length === 0) return '';

  // Split top-level commas (depth-aware: skip commas inside parens, e.g.
  // `numeric(10,2)`). Default values can contain commas (e.g.
  // `DEFAULT make_array(1, 2, 3)`), so depth tracking is required.
  const args = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(' ) { depth += 1; buf += ch; continue; }
    if (ch === ')') { depth -= 1; buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      args.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) args.push(buf);

  const normalizeOne = (arg) => {
    let a = arg.trim();
    // Strip `DEFAULT <expr>` from the FIRST top-level `DEFAULT` keyword
    // onward (case-insensitive). pg_dump emits `DEFAULT` as a bare keyword.
    const defM = a.match(/\s+DEFAULT\s+/i);
    if (defM) a = a.slice(0, defM.index).trim();
    // Strip leading mode marker (IN/OUT/INOUT/VARIADIC) — case-insensitive.
    a = a.replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, '');
    // Tokenize: arg may be `<name> <type>` or just `<type>`. We can't tell
    // which without catalog knowledge, but for our equality check we need a
    // consistent shape. Strategy: drop the first token IF the second token
    // exists and looks type-like. But the simplest robust shape that works
    // for pg_dump output is "concatenate all remaining tokens, lowercase,
    // collapse spaces, strip surrounding quotes per-token". pg_dump always
    // includes both name and type, so the resulting strings will match
    // across CREATE and COMMENT byte-for-byte after this normalization.
    a = a.replace(/"([^"]+)"/g, '$1');     // unquote
    a = a.replace(/\s+/g, ' ').trim();      // collapse whitespace
    return a.toLowerCase();
  };

  return args.map(normalizeOne).join(',');
}

/**
 * Extract `(qualified-name, normalized-args)` from a `CREATE FUNCTION`
 * header line. Returns `null` if the line does not look like a function
 * header. The qualified name is always returned with explicit `<schema>.`
 * prefix, defaulting to `public` if no schema was emitted (matches pg_dump's
 * default search_path).
 */
function extractFunctionSignature(headerLine) {
  // Find the matching close-paren of the FIRST top-level `(` after the name.
  // pg_dump's emit shape: `CREATE [OR REPLACE] FUNCTION <qname>(<args>) RETURNS …`
  // <qname> is `"schema"."name"`, `schema.name`, `"name"`, or `name`.
  const m = headerLine.match(
    /^CREATE (?:OR REPLACE )?FUNCTION\s+("(?:[^"]+)"|[A-Za-z_][A-Za-z0-9_]*)(?:\.("(?:[^"]+)"|[A-Za-z_][A-Za-z0-9_]*))?\s*\(/,
  );
  if (!m) return null;
  const part1 = m[1].replace(/^"|"$/g, '');
  const part2 = m[2] ? m[2].replace(/^"|"$/g, '') : null;
  const schema = part2 ? part1 : 'public';
  const name = part2 || part1;
  // Find arg list by counting parens from the first `(`.
  const openIdx = headerLine.indexOf('(', m[0].length - 1);
  if (openIdx === -1) return null;
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return null;
  const argList = headerLine.substring(openIdx, closeIdx + 1);
  return {
    schema,
    name,
    qualifiedName: `${schema}.${name}`,
    argSig: normalizeArgs(argList),
  };
}

/**
 * Extract `(qualified-name, normalized-args)` from a `COMMENT ON FUNCTION`
 * line, plus the byte range / structural info needed to relocate it.
 *
 * Returns `null` if the line is not a `COMMENT ON FUNCTION` statement.
 *
 * Schema defaulting matches `extractFunctionSignature`: an unqualified name
 * is treated as `public.<name>`.
 */
function extractCommentFunctionSignature(line) {
  const m = line.match(/^COMMENT ON FUNCTION\s+(.+?)\s+IS\s+(?:'(?:[^']|'')*')\s*;\s*$/);
  if (!m) return null;
  const targetExpr = m[1]; // e.g. `"public"."f"(arg "uuid")` or `public.f()`
  // Parse the qualified-name + arg list from targetExpr.
  const nameMatch = targetExpr.match(
    /^("(?:[^"]+)"|[A-Za-z_][A-Za-z0-9_]*)(?:\.("(?:[^"]+)"|[A-Za-z_][A-Za-z0-9_]*))?\s*\(/,
  );
  if (!nameMatch) return null;
  const part1 = nameMatch[1].replace(/^"|"$/g, '');
  const part2 = nameMatch[2] ? nameMatch[2].replace(/^"|"$/g, '') : null;
  const schema = part2 ? part1 : 'public';
  const name = part2 || part1;
  // Locate the arg list inside targetExpr (depth-aware).
  const openIdx = targetExpr.indexOf('(', nameMatch[0].length - 1);
  if (openIdx === -1) return null;
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < targetExpr.length; i += 1) {
    const ch = targetExpr[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return null;
  const argList = targetExpr.substring(openIdx, closeIdx + 1);
  return {
    schema,
    name,
    qualifiedName: `${schema}.${name}`,
    argSig: normalizeArgs(argList),
  };
}

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
 *   - { kind: 'fn', name, qualifiedName, argSig, lang, lines, trailing,
 *                   attachedComments }
 *     a CREATE FUNCTION block. `lines` is the function-block lines from
 *     `CREATE OR REPLACE FUNCTION` through the closing `$TAG$;` line
 *     (inclusive). `trailing` is the blank lines that immediately follow,
 *     bundled with the function so reorder moves the visual separator
 *     along with the block. `attachedComments` is any
 *     `COMMENT ON FUNCTION <same-name>(<same-args>) IS '...';` statement
 *     pg_dump emitted in the trailing region (right after the trailing
 *     blanks of this fn block); absorbing it here lets the COMMENT travel
 *     with the fn on reorder.
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
    const sig = extractFunctionSignature(headerLine);

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

    // After the trailing blanks, check whether the very next non-blank line
    // is a `COMMENT ON FUNCTION` statement targeting THIS function (same
    // qualified name and argument signature). pg_dump emits the comment
    // right here for SQL-language functions; absorbing it into the fn
    // segment guarantees the comment moves with the function on reorder
    // (without that, pass 2 would orphan the COMMENT — see CI run
    // 25257499959 → ERROR: function public.current_school_id() does not
    // exist on baseline replay).
    //
    // Only the comment-matching-this-function case absorbs. Comments for
    // other functions (different sig, different name) are left in the
    // following lines segment — they stay where pg_dump put them.
    //
    // Idempotency: running the parser on already-rewritten output sees the
    // same shape (fn block, trailing blanks, matching COMMENT, trailing
    // blanks) and absorbs identically.
    const attachedComments = [];
    if (sig && t < lines.length) {
      const candidate = lines[t];
      if (candidate.startsWith('COMMENT ON FUNCTION')) {
        const csig = extractCommentFunctionSignature(candidate);
        if (
          csig &&
          csig.qualifiedName === sig.qualifiedName &&
          csig.argSig === sig.argSig
        ) {
          attachedComments.push(candidate);
          t += 1;
          // Re-collect trailing blanks following the comment.
          while (t < lines.length && lines[t].trim() === '') {
            trailing.push(lines[t]);
            t += 1;
          }
        }
      }
    }

    flushPending();
    segments.push({
      kind: 'fn',
      name: funcName,
      qualifiedName: sig ? sig.qualifiedName : `public.${funcName}`,
      argSig: sig ? sig.argSig : '',
      lang,
      lines: blockLines,
      trailing,
      // For sql-language fns whose pg_dump-emitted COMMENT was right after
      // the fn block (the common shape — see comment above). For plpgsql
      // fns whose COMMENT was right after, this also absorbs (harmlessly:
      // plpgsql fns don't move, and the COMMENT stays adjacent to its fn
      // either way). The attachComments-from-elsewhere pass below handles
      // the rare case of a COMMENT placed somewhere other than immediately
      // after the fn block.
      attachedComments,
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
 * `trailing` / `attachedComments` together cover all original lines without
 * overlap or gap.
 *
 * For fn segments, the order is:
 *   <function block lines>
 *   <attached comment lines>   (e.g. `COMMENT ON FUNCTION foo() IS '…';`)
 *   <trailing blank lines>
 *
 * The attached COMMENT goes BEFORE trailing blanks so each moved sql function
 * still has a visible separator after its comment, matching pg_dump's natural
 * shape (function → blank → comment → blank → next-statement). When a comment
 * was extracted from elsewhere in the file, the surrounding blank line at
 * the source site is also extracted (via `lines`-segment compaction) so the
 * total line count is preserved.
 */
function serializeSegments(segments) {
  const parts = [];
  for (const seg of segments) {
    if (seg.kind === 'lines') {
      parts.push(seg.text);
    } else {
      parts.push(seg.lines.join('\n'));
      if (seg.attachedComments && seg.attachedComments.length > 0) {
        parts.push(seg.attachedComments.join('\n'));
      }
      if (seg.trailing.length > 0) {
        parts.push(seg.trailing.join('\n'));
      }
    }
  }
  return parts.join('\n');
}

/**
 * Attach `COMMENT ON FUNCTION <qname>(<args>) IS '...';` statements to their
 * matching sql-language function segments when the COMMENT is NOT
 * immediately adjacent to the fn block. Mutates segments in place.
 *
 * Why this complements parse-time absorption
 * ------------------------------------------
 * `parseSegments` already absorbs the COMMENT for fns when pg_dump emitted
 * it right after the function block (the common shape — see the "After the
 * trailing blanks, check whether the very next non-blank line…" branch of
 * parseSegments). That covers ~all real-world cases.
 *
 * This function handles the rare orphan case: a COMMENT that pg_dump emitted
 * separated from its function (e.g. earlier in the file before the function
 * even exists, which is exactly the regression CI run 25257499959 hit on a
 * second sanitization pass — the parse-time absorption catches it cleanly).
 *
 * Algorithm:
 *   1. For each `lines` segment, scan its lines for COMMENT ON FUNCTION.
 *   2. When the COMMENT's `(qualifiedName, argSig)` matches an sql fn
 *      segment, splice the COMMENT line out of the `lines` segment and
 *      append it to the fn segment's `attachedComments`.
 *
 * Line-count preservation: the fn segment gains 1 line (the COMMENT) and
 * the source `lines` segment loses 1 line (the COMMENT). Surrounding blank
 * lines in the source segment are NOT touched — they belong to whatever
 * statement preceded or followed the COMMENT, not to the moved fn. The
 * `serializeSegments` join-with-`\n` semantics handle the rest.
 *
 * Schema defaulting: an unqualified COMMENT (`COMMENT ON FUNCTION f()`) is
 * matched against `public.f` (pg_dump's default search_path). Both forms
 * normalize to `<schema>.<name>` before the equality check.
 *
 * Overload handling: when a function has multiple overloads (e.g. three
 * `atomic_quiz_profile_update` signatures), the `(qualifiedName, argSig)`
 * key uniquely identifies each. Each COMMENT lands on its own overload.
 *
 * Plpgsql fn comments and other COMMENT classes (`COMMENT ON TABLE`,
 * `COMMENT ON COLUMN`, `COMMENT ON INDEX`, …) are never matched here and
 * stay in place untouched.
 */
function attachCommentsToSqlFunctions(segments) {
  // Build (qname, argSig) → fn segment lookup. Only sql-language fns are
  // candidates; plpgsql fns don't move, so their comments don't need to.
  const sqlFnByKey = new Map();
  for (const seg of segments) {
    if (seg.kind !== 'fn' || seg.lang !== 'sql') continue;
    const key = `${seg.qualifiedName}|${seg.argSig}`;
    // For overloads with the same normalized argSig (shouldn't happen in
    // valid Postgres but be defensive), keep the first.
    if (!sqlFnByKey.has(key)) sqlFnByKey.set(key, seg);
  }
  if (sqlFnByKey.size === 0) return;

  // Walk lines segments looking for orphaned COMMENT ON FUNCTION lines
  // (orphaned = not absorbed at parse time because they aren't immediately
  // adjacent to their fn block). Splice each match out of its lines segment
  // and append to the fn's attachedComments.
  for (const seg of segments) {
    if (seg.kind !== 'lines') continue;
    const segLines = seg.text.split('\n');
    const keep = [];
    let modified = false;
    for (let i = 0; i < segLines.length; i += 1) {
      const line = segLines[i];
      if (line.startsWith('COMMENT ON FUNCTION')) {
        const sig = extractCommentFunctionSignature(line);
        if (sig) {
          const key = `${sig.qualifiedName}|${sig.argSig}`;
          const fnSeg = sqlFnByKey.get(key);
          if (fnSeg) {
            fnSeg.attachedComments.push(line);
            modified = true;
            continue; // line is removed from source
          }
        }
      }
      keep.push(line);
    }
    if (modified) seg.text = keep.join('\n');
  }
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

  // Pull `COMMENT ON FUNCTION <sql-fn>(...) IS '...';` statements out of
  // their pg_dump emission positions and attach them to the sql fn segment
  // they target. They will travel with the fn block on reorder.
  attachCommentsToSqlFunctions(segments);

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

  // ── Pass 2 (extended): COMMENT ON FUNCTION relocation ─────────────────────
  // Regression class introduced by PR #479: when an sql function moves to
  // after the last plpgsql block, any matching `COMMENT ON FUNCTION` left
  // at the original pg_dump emit position becomes orphaned (refers to a
  // function not yet defined). CI run 25257499959 hit this on
  // `current_school_id`. Tests 30-37 pin the fix.

  // 30. sql_function_with_orphaned_comment_before:
  //     COMMENT emitted BEFORE the CREATE FUNCTION block. After reorder, the
  //     function moves to the end and the COMMENT must move with it.
  const fixture30 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.f1() IS 'orphaned before';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
  ].join('\n');
  const out30 = reorderSqlFunctions(fixture30);
  const f1CreatePos30 = out30.indexOf('FUNCTION public.f1()');
  const f1CommentPos30 = out30.indexOf('COMMENT ON FUNCTION public.f1()');
  expect(
    'sql_function_with_orphaned_comment_before: COMMENT moves to after CREATE',
    f1CreatePos30 > -1 && f1CommentPos30 > -1 && f1CommentPos30 > f1CreatePos30,
    `create=${f1CreatePos30} comment=${f1CommentPos30}`,
  );
  expect(
    'sql_function_with_orphaned_comment_before: line count preserved',
    fixture30.split('\n').length === out30.split('\n').length,
    `before=${fixture30.split('\n').length} after=${out30.split('\n').length}`,
  );

  // 31. sql_function_with_quoted_name_comment:
  //     COMMENT uses double-quoted "schema"."name" form. Must still match
  //     the CREATE FUNCTION (which may use the same or different quoting).
  const fixture31 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION "public"."f1"() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
    '',
    "COMMENT ON FUNCTION \"public\".\"f1\"() IS 'quoted comment';",
    '',
  ].join('\n');
  const out31 = reorderSqlFunctions(fixture31);
  // Comment should be absorbed by parse-time absorption (it's right after
  // f1's trailing blanks). Verify the COMMENT still exists and is now
  // adjacent to (or after) the f1 CREATE in the output.
  const f1CreatePos31 = out31.indexOf('FUNCTION "public"."f1"()');
  const f1CommentPos31 = out31.indexOf('COMMENT ON FUNCTION "public"."f1"()');
  expect(
    'sql_function_with_quoted_name_comment: COMMENT travels with quoted-name fn',
    f1CreatePos31 > -1 && f1CommentPos31 > -1 && f1CommentPos31 > f1CreatePos31,
    `create=${f1CreatePos31} comment=${f1CommentPos31}`,
  );
  expect(
    'sql_function_with_quoted_name_comment: line count preserved',
    fixture31.split('\n').length === out31.split('\n').length,
  );

  // 32. sql_function_with_multiple_overload_comments:
  //     Two sql fn overloads with different arg sigs. Each has its own
  //     COMMENT. Each COMMENT must travel with its own overload — no
  //     cross-contamination.
  const fixture32 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1(a uuid) RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.f1(a uuid) IS 'overload uuid';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1(a text) RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 2 $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.f1(a text) IS 'overload text';",
    '',
  ].join('\n');
  const out32 = reorderSqlFunctions(fixture32);
  // Each COMMENT must come after its own CREATE.
  const uuidCreate = out32.indexOf('FUNCTION public.f1(a uuid)');
  const uuidComment = out32.indexOf('COMMENT ON FUNCTION public.f1(a uuid)');
  const textCreate = out32.indexOf('FUNCTION public.f1(a text)');
  const textComment = out32.indexOf('COMMENT ON FUNCTION public.f1(a text)');
  expect(
    'sql_function_with_multiple_overload_comments: uuid COMMENT after uuid CREATE',
    uuidCreate > -1 && uuidComment > -1 && uuidComment > uuidCreate,
    `uuidCreate=${uuidCreate} uuidComment=${uuidComment}`,
  );
  expect(
    'sql_function_with_multiple_overload_comments: text COMMENT after text CREATE',
    textCreate > -1 && textComment > -1 && textComment > textCreate,
    `textCreate=${textCreate} textComment=${textComment}`,
  );
  // No COMMENT should appear before its target.
  expect(
    'sql_function_with_multiple_overload_comments: line count preserved',
    fixture32.split('\n').length === out32.split('\n').length,
  );

  // 33. sql_function_with_unqualified_comment:
  //     COMMENT omits the schema (`COMMENT ON FUNCTION f() IS ...`). Must
  //     still match `public.f` (pg_dump's default search_path).
  const fixture33 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    "COMMENT ON FUNCTION f1() IS 'unqualified comment';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
  ].join('\n');
  const out33 = reorderSqlFunctions(fixture33);
  const fCreatePos33 = out33.indexOf('FUNCTION public.f1()');
  const fCommentPos33 = out33.indexOf('COMMENT ON FUNCTION f1()');
  expect(
    'sql_function_with_unqualified_comment: unqualified COMMENT matches public.f',
    fCreatePos33 > -1 && fCommentPos33 > -1 && fCommentPos33 > fCreatePos33,
    `create=${fCreatePos33} comment=${fCommentPos33}`,
  );
  expect(
    'sql_function_with_unqualified_comment: line count preserved',
    fixture33.split('\n').length === out33.split('\n').length,
  );

  // 34. plpgsql_function_comment_unchanged:
  //     PL/pgSQL function with a COMMENT right after — neither moves. The
  //     output must be byte-for-byte equal to the input (or at least keep
  //     the comment adjacent to the same plpgsql function).
  const fixture34 = [
    'CREATE OR REPLACE FUNCTION public.gp() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.gp() IS 'plpgsql comment';",
    '',
    '',
    'CREATE TABLE IF NOT EXISTS public.t (id uuid PRIMARY KEY);',
    '',
  ].join('\n');
  const out34 = reorderSqlFunctions(fixture34);
  // No sql functions → reorder is a no-op (returns src unchanged).
  expect(
    'plpgsql_function_comment_unchanged: no-op when no sql fns to move',
    out34 === fixture34,
  );

  // 34b. plpgsql_function_comment_unchanged WITH a sql fn elsewhere:
  //      Even when an sql fn is present (forcing the reorder pass to run),
  //      the plpgsql fn and ITS comment must stay adjacent and in place.
  const fixture34b = [
    'CREATE OR REPLACE FUNCTION public.gp() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.gp() IS 'plpgsql comment';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
  ].join('\n');
  const out34b = reorderSqlFunctions(fixture34b);
  // gp (plpgsql) and its COMMENT must come BEFORE s1 (sql) in the output.
  const gpCreate34b = out34b.indexOf('FUNCTION public.gp()');
  const gpComment34b = out34b.indexOf('COMMENT ON FUNCTION public.gp()');
  const s1Create34b = out34b.indexOf('FUNCTION public.s1()');
  expect(
    'plpgsql_function_comment_unchanged: plpgsql comment stays adjacent to plpgsql fn',
    gpCreate34b > -1 && gpComment34b > -1 && s1Create34b > -1 &&
      gpCreate34b < gpComment34b && gpComment34b < s1Create34b,
    `gpCreate=${gpCreate34b} gpComment=${gpComment34b} s1Create=${s1Create34b}`,
  );

  // 35. comment_on_table_unchanged:
  //     COMMENT ON TABLE / COMMENT ON COLUMN near a moved sql function must
  //     never be absorbed into the fn segment. The reorder pass must touch
  //     only `COMMENT ON FUNCTION` whose target matches a moved sql fn.
  //
  //     Verification strategy: place a plpgsql anchor BEFORE the table-and-
  //     comments block (so reorder's `lastPlpgsqlIdx` includes the table
  //     section in `before`, which means table+comments stay in place
  //     relative to plpgsql content). Then verify the COMMENT ON TABLE /
  //     COMMENT ON COLUMN appear adjacent to the table CREATE in the output
  //     (i.e. were not extracted and attached to the s1 fn segment).
  const fixture35 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.s1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
    '',
    'CREATE TABLE IF NOT EXISTS public.t (id uuid PRIMARY KEY);',
    '',
    '',
    "COMMENT ON TABLE public.t IS 'a table';",
    "COMMENT ON COLUMN public.t.id IS 'the id';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.gp2() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
  ].join('\n');
  const out35 = reorderSqlFunctions(fixture35);
  // COMMENT ON TABLE/COLUMN must exist in the output (unchanged, not
  // absorbed) and must remain adjacent to the CREATE TABLE.
  const tableCreatePos = out35.indexOf('CREATE TABLE IF NOT EXISTS public.t');
  const tableCommentPos = out35.indexOf('COMMENT ON TABLE public.t');
  const colCommentPos = out35.indexOf('COMMENT ON COLUMN public.t.id');
  expect(
    'comment_on_table_unchanged: COMMENT ON TABLE stays put',
    tableCreatePos > -1 && tableCommentPos > -1 && colCommentPos > -1 &&
      tableCreatePos < tableCommentPos && tableCommentPos < colCommentPos,
    `tCreate=${tableCreatePos} tComment=${tableCommentPos} cComment=${colCommentPos}`,
  );
  expect(
    'comment_on_table_unchanged: line count preserved',
    fixture35.split('\n').length === out35.split('\n').length,
  );

  // 36. idempotency_with_comments:
  //     Running the pass twice on a fixture with COMMENT ON FUNCTION
  //     produces identical output. Critical for second sanitization passes
  //     in CI.
  const fixture36 = fixture30; // any fixture with a moved-comment shape
  const once36 = reorderSqlFunctions(fixture36);
  const twice36 = reorderSqlFunctions(once36);
  expect(
    'idempotency_with_comments: reorder(reorder(x)) === reorder(x)',
    once36 === twice36,
  );
  // Also verify same with the orphan-before fixture and the overload one.
  expect(
    'idempotency_with_comments: idempotent on overload fixture',
    reorderSqlFunctions(out32) === out32,
  );
  expect(
    'idempotency_with_comments: idempotent on quoted-name fixture',
    reorderSqlFunctions(out31) === out31,
  );

  // 37. Real-world shape: sql fn followed by COMMENT followed by another
  //     unrelated COMMENT ON FUNCTION (different name). Only the matching
  //     COMMENT is absorbed into the fn segment; the other stays put in
  //     the lines stream.
  const fixture37 = [
    'CREATE OR REPLACE FUNCTION public.anchor_p() RETURNS void',
    '    LANGUAGE plpgsql',
    '    AS $$ BEGIN RETURN; END; $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.unrelated_plpgsql() IS 'unrelated';",
    '',
    '',
    'CREATE OR REPLACE FUNCTION public.f1() RETURNS int',
    '    LANGUAGE sql',
    '    AS $$ SELECT 1 $$;',
    '',
    '',
    "COMMENT ON FUNCTION public.f1() IS 'f1 doc';",
    '',
  ].join('\n');
  const out37 = reorderSqlFunctions(fixture37);
  // Both COMMENTs survive; f1 COMMENT travels with f1 (after CREATE), and
  // the unrelated COMMENT stays in its original relative spot.
  const f1Create37 = out37.indexOf('FUNCTION public.f1()');
  const f1Comment37 = out37.indexOf("COMMENT ON FUNCTION public.f1()");
  const unrelated37 = out37.indexOf("COMMENT ON FUNCTION public.unrelated_plpgsql()");
  expect(
    'real_world_shape: matching COMMENT travels with its sql fn',
    f1Create37 > -1 && f1Comment37 > -1 && f1Comment37 > f1Create37,
    `f1Create=${f1Create37} f1Comment=${f1Comment37}`,
  );
  expect(
    'real_world_shape: unrelated COMMENT preserved in output',
    unrelated37 > -1,
  );
  expect(
    'real_world_shape: line count preserved',
    fixture37.split('\n').length === out37.split('\n').length,
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
