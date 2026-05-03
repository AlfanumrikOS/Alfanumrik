/**
 * Edge Function .ts parse-guard regression test
 *
 * Why this exists
 * ---------------
 * Today's deploy-production failure (Action run 25275123707) was caused by
 * `supabase/functions/grounded-answer/prompts/inline.ts` containing two issues
 * that Deno's TS parser rejects but our local `tsc --noEmit` never sees
 * (because `tsconfig.json` excludes `supabase/`):
 *
 *   1. Unescaped backticks INSIDE `String.raw\`...\`` template literals.
 *      The inner backtick prematurely closes the template, after which the
 *      parser tries to read prose as code.
 *   2. Unicode comparison characters `≤`, `≥`, `≠` inside the template body.
 *      When the template has already closed prematurely (issue #1), Deno's
 *      parser surfaces the cascading error AT the Unicode glyph as
 *      "Unexpected character".
 *
 * Architect fixed `inline.ts` in PR #496 (commit 08e63516). This test makes
 * sure the entire class of bug — anywhere in `supabase/functions/**` — fails
 * a PR check BEFORE it reaches `Deploy Changed Edge Functions`.
 *
 * Layers
 * ------
 * Layer 1 (mandatory): TypeScript SyntaxKind parse via the project's own
 *   `typescript` package. We use `ts.createSourceFile` and read its internal
 *   `parseDiagnostics` array. If non-empty, the file would also fail
 *   `deno check` on deploy. Empirically this catches the inner-backtick form
 *   of the original bug — once the template terminates early, the next
 *   non-ASCII glyph in code position becomes "Invalid character".
 *
 * Layer 2 (mandatory, defense-in-depth): a state-machine walker over each
 *   `.ts` file. It tracks whether the cursor is inside a backtick-delimited
 *   template literal (handling backslash escapes correctly), and flags:
 *   - Unicode comparison glyphs `≤` (U+2264), `≥` (U+2265), `≠` (U+2260)
 *     inside ANY template literal. The CLAUDE invariant in `inline.ts` (lines
 *     22-31) requires these to be ASCII-fied; this test enforces it
 *     mechanically and also covers any future prompt file in the same
 *     directory family.
 *   - Stray inner backticks: caught natively by Layer 1, but the walker
 *     gives a clearer error message pointing at the line and column.
 *
 * Constraints
 * -----------
 * - No new dependencies (re-uses `typescript` already in package.json).
 * - Must run < 5s for ~90 .ts files in `supabase/functions/`.
 * - Failure messages MUST point at `file:line:col` so the engineer can
 *   navigate directly to the offending character.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Resolve from the project root regardless of the test runner's cwd. Vitest
// runs from the package root so `process.cwd()` is reliable here, but using a
// fixed anchor keeps the test stable if that ever changes.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');

/** Recursive *.ts collector. Skips node_modules-style nested dirs (none today,
 *  but defensive). */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.isFile() && full.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const allTsFiles = collectTsFiles(FUNCTIONS_DIR);

/** Convert a 0-indexed character offset into 1-indexed `line:col`. Used so
 *  test failure messages point at exactly the byte the parser/walker
 *  rejected — same convention as TypeScript and Deno error output. */
function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

// ─── Layer 1: TS parser surfaces the same diagnostics Deno would ────────────

describe('Edge Function .ts files parse cleanly under TS scanner', () => {
  it('finds .ts files to scan (sanity check)', () => {
    expect(allTsFiles.length).toBeGreaterThan(10);
  });

  for (const file of allTsFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    it(`parses without syntax errors: ${rel}`, () => {
      const text = fs.readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);

      // `parseDiagnostics` is documented internal-but-stable on SourceFile;
      // it carries the syntactic errors `ts.createSourceFile` collects.
      // We surface line/col from the diagnostic's `start` so the failure
      // message points an engineer at the exact character.
      const diags = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
        .parseDiagnostics ?? [];

      if (diags.length > 0) {
        const formatted = diags.slice(0, 5).map((d) => {
          const start = d.start ?? 0;
          const { line, col } = offsetToLineCol(text, start);
          const msg = typeof d.messageText === 'string'
            ? d.messageText
            : (d.messageText as ts.DiagnosticMessageChain).messageText;
          return `  ${rel}:${line}:${col} — ${msg}`;
        }).join('\n');

        throw new Error(
          `TS syntax errors in ${rel} (would fail \`deno check\` on Edge Function deploy):\n` +
          formatted +
          (diags.length > 5 ? `\n  ...and ${diags.length - 5} more` : '') +
          '\n\nIf this file uses `String.raw\\`...\\``, check for unescaped inner ' +
          'backticks or Unicode chars (≤≥≠) bleeding into code position.'
        );
      }
    });
  }
});

// ─── Layer 2: hand-rolled walker for template-literal hygiene ───────────────

interface TemplateScanFinding {
  file: string;
  line: number;
  col: number;
  kind: 'unicode_comparison_in_template' | 'unterminated_template';
  detail: string;
}

/**
 * Walk a TS file as a character stream and report:
 *  - U+2264 (≤), U+2265 (≥), U+2260 (≠) chars sitting inside a backtick
 *    template literal. Per `inline.ts` lines 22-31 these must be ASCII-fied
 *    (`<=`, `>=`, `!=`) because Deno's parser has historically choked on them
 *    once a sibling backtick error knocks the parser off-rails.
 *  - Unterminated templates (a backtick that opens but never closes before
 *    EOF). Layer 1 also catches this, but the walker's location is the
 *    OPENING backtick which is more useful.
 *
 * The walker is intentionally minimal — it does not try to be a full TS
 * scanner. It tracks just enough state to know where it is:
 *
 *   state ∈ { code, line_comment, block_comment, single_string,
 *             double_string, template, regex, regex_class }
 *
 * Backslash-escape handling matters inside strings, regexes, and templates:
 * a `\`` is NOT a closing backtick. The walker honors that to prevent false
 * positives.
 *
 * Regex-literal handling is necessary because real Edge Function code (e.g.
 * `quiz-oracle.ts`, `export-report/index.ts`) uses regexes containing
 * backticks like `/^\`\`\`json/`. Without regex tracking, those backticks
 * would spuriously open a template state and break the unterminated-template
 * check. We disambiguate `/` between regex-start and division by inspecting
 * the previous non-whitespace token (coarse but sufficient for our codebase).
 */
function scanTemplates(file: string, text: string): TemplateScanFinding[] {
  const findings: TemplateScanFinding[] = [];
  type State =
    | 'code'
    | 'line_comment'
    | 'block_comment'
    | 'single_string'
    | 'double_string'
    | 'template'
    | 'regex'
    | 'regex_class';

  let state: State = 'code';
  // Stack of states pushed when `${` is encountered inside a template — we
  // re-enter `code` mode for the expression and pop back when matching `}`.
  // Track template-bracket depth so nested objects inside `${...}` don't
  // close the expression early.
  const stack: { state: State; bracketDepth: number }[] = [];
  let bracketDepth = 0;
  let templateOpenOffset = -1;

  /**
   * Last non-whitespace, non-comment character we saw in `code` state. Used
   * to disambiguate `/` between regex-start and division. A `/` starts a
   * regex when the previous token is one of:
   *   = ( [ , ; ! & | ? : { } ~ + - * % ^ < > or absent (start of file).
   * Otherwise it is division.
   */
  let lastCodeChar = '';

  const i_max = text.length;
  for (let i = 0; i < i_max; i++) {
    const ch = text[i];
    const next = i + 1 < i_max ? text[i + 1] : '';

    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') {
          state = 'line_comment';
          i++;
        } else if (ch === '/' && next === '*') {
          state = 'block_comment';
          i++;
        } else if (ch === '/') {
          // Regex vs division. Heuristic on lastCodeChar.
          const regexStarters = new Set([
            '', '=', '(', '[', ',', ';', '!', '&', '|', '?', ':', '{', '}',
            '~', '+', '-', '*', '%', '^', '<', '>', '\n',
          ]);
          if (regexStarters.has(lastCodeChar)) {
            state = 'regex';
          }
          // else: it's division — stay in code.
          lastCodeChar = ch;
        } else if (ch === "'") {
          state = 'single_string';
          lastCodeChar = ch;
        } else if (ch === '"') {
          state = 'double_string';
          lastCodeChar = ch;
        } else if (ch === '`') {
          state = 'template';
          templateOpenOffset = i;
          lastCodeChar = ch;
        } else if (ch === '}' && stack.length > 0) {
          // Closing a `${...}` expression — only when the brace stack we
          // tracked for THIS expression is back to zero.
          if (bracketDepth === 0) {
            const popped = stack.pop()!;
            state = popped.state;
            bracketDepth = popped.bracketDepth;
          } else {
            bracketDepth--;
          }
        } else if (ch === '{') {
          if (stack.length > 0) bracketDepth++;
          lastCodeChar = ch;
        } else if (/\s/.test(ch)) {
          // Whitespace doesn't change lastCodeChar — but a newline DOES
          // count as a "regex starter" (statement boundary), so reset.
          if (ch === '\n') lastCodeChar = '\n';
        } else {
          lastCodeChar = ch;
        }
        break;
      }
      case 'line_comment':
        if (ch === '\n') {
          state = 'code';
          lastCodeChar = '\n';
        }
        break;
      case 'block_comment':
        if (ch === '*' && next === '/') {
          state = 'code';
          i++;
          // Treat block comment like whitespace — don't update lastCodeChar.
        }
        break;
      case 'single_string':
        if (ch === '\\') i++; // skip escape
        else if (ch === "'") state = 'code';
        else if (ch === '\n') state = 'code'; // unterminated string — stop tracking
        break;
      case 'double_string':
        if (ch === '\\') i++;
        else if (ch === '"') state = 'code';
        else if (ch === '\n') state = 'code';
        break;
      case 'regex':
        if (ch === '\\') i++; // skip escape (e.g. \/ \` \n)
        else if (ch === '[') state = 'regex_class';
        else if (ch === '/') {
          // Closing slash. Skip flags (alpha chars) before returning to code.
          let j = i + 1;
          while (j < i_max && /[a-z]/i.test(text[j])) j++;
          i = j - 1;
          state = 'code';
          lastCodeChar = '/';
        } else if (ch === '\n') {
          // Real regex literals can't span newlines — bail out as code so
          // we don't silently swallow the rest of the file.
          state = 'code';
          lastCodeChar = '\n';
        }
        break;
      case 'regex_class':
        if (ch === '\\') i++;
        else if (ch === ']') state = 'regex';
        else if (ch === '\n') {
          state = 'code';
          lastCodeChar = '\n';
        }
        break;
      case 'template': {
        if (ch === '\\') {
          i++; // skip escape (e.g. \` or \$)
          break;
        }
        if (ch === '`') {
          state = 'code';
          templateOpenOffset = -1;
          lastCodeChar = '`';
          break;
        }
        if (ch === '$' && next === '{') {
          // Enter expression. Push current template state so the matching
          // `}` returns us here.
          stack.push({ state: 'template', bracketDepth });
          state = 'code';
          bracketDepth = 0;
          lastCodeChar = '{';
          i++;
          break;
        }
        // Inside template body — flag forbidden Unicode comparison glyphs.
        const code = ch.charCodeAt(0);
        if (code === 0x2264 /* ≤ */ || code === 0x2265 /* ≥ */ || code === 0x2260 /* ≠ */) {
          const { line, col } = offsetToLineCol(text, i);
          findings.push({
            file,
            line,
            col,
            kind: 'unicode_comparison_in_template',
            detail:
              `Unicode comparison char \`${ch}\` (U+${code.toString(16).toUpperCase().padStart(4, '0')}) ` +
              `inside template literal — replace with ASCII (<=, >=, !=). ` +
              `See supabase/functions/grounded-answer/prompts/inline.ts header (lines 22-31) ` +
              `for the rationale: Deno's TS parser has historically rejected these glyphs in ` +
              `Edge Function deploy.`,
          });
        }
        break;
      }
    }
  }

  if (state === 'template' && templateOpenOffset >= 0) {
    const { line, col } = offsetToLineCol(text, templateOpenOffset);
    findings.push({
      file,
      line,
      col,
      kind: 'unterminated_template',
      detail:
        'Backtick template literal opens here but never closes before EOF — ' +
        'most likely an unescaped inner backtick prematurely closed an earlier template ' +
        'and the parser has been off-rails since.',
    });
  }

  return findings;
}

describe('Edge Function template literals are ASCII-clean', () => {
  // Run the walker on every .ts file. The hot path is the prompts/ family,
  // but the bug class can manifest anywhere a String.raw template appears.
  for (const file of allTsFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    it(`template literals are ASCII-clean: ${rel}`, () => {
      const text = fs.readFileSync(file, 'utf8');
      const findings = scanTemplates(file, text);
      if (findings.length > 0) {
        const formatted = findings.slice(0, 5).map((f) =>
          `  ${rel}:${f.line}:${f.col} [${f.kind}] — ${f.detail}`
        ).join('\n');
        throw new Error(
          `Template-literal hygiene violations in ${rel}:\n` +
          formatted +
          (findings.length > 5 ? `\n  ...and ${findings.length - 5} more` : '')
        );
      }
    });
  }
});

// ─── Sanity tests for the scanner itself ────────────────────────────────────
//
// The walker is tricky enough (escape handling, nested ${...}, brace
// counting, regex disambiguation) that we encode known-good and known-bad
// inputs to make sure it reports what we expect. These guard against
// accidentally weakening the scanner during refactors.

describe('scanTemplates self-test', () => {
  it('flags U+2264 inside a String.raw template', () => {
    const src = "export const X = String.raw`step <= 30 ≤ words`;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unicode_comparison_in_template');
  });

  it('flags U+2265 and U+2260 too', () => {
    const src = "const A = `score ≥ 80`; const B = `a ≠ b`;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.kind === 'unicode_comparison_in_template')).toBe(true);
  });

  it('does not flag ≤ inside a // comment or /* block */', () => {
    const src = "// step <= 30 ≤ words\n/* and ≥ here */\nconst x = 1;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(0);
  });

  it('does not flag ≤ inside a single- or double-quoted string', () => {
    const src = "const a = 'has ≤ glyph'; const b = \"and ≥ here\";\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(0);
  });

  it('honors backslash-escaped backtick inside template (no false positive)', () => {
    // The walker must NOT treat `\`` as a real closing backtick.
    const src = "const x = `a \\` b ≤ c`;\n";
    const findings = scanTemplates('virtual.ts', src);
    // Should flag the ≤ as inside-template, NOT report unterminated.
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unicode_comparison_in_template');
  });

  it('handles ${...} expressions with nested braces correctly', () => {
    const src = "const x = `a ${ ({ k: 1 }).k } b ≤ c`;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unicode_comparison_in_template');
  });

  it('does not flag ≤ that lives inside a ${...} expression (code position)', () => {
    // Inside `${...}` we are in code mode; a stray ≤ here would be caught by
    // Layer 1 (TS parser) as Invalid character, not by the template walker.
    const src = "const x = `a ${1 + 2} b`;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(0);
  });

  it('reports unterminated template at the OPENING backtick', () => {
    const src = "const x = `never closed\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unterminated_template');
    // Opening backtick is at column 11 of line 1 (1-indexed).
    expect(findings[0].line).toBe(1);
    expect(findings[0].col).toBe(11);
  });

  it('does not enter template state from a backtick inside a regex literal', () => {
    // Real example pattern from supabase/functions/_shared/quiz-oracle.ts.
    // The backtick lives inside a regex char class, so the walker must NOT
    // treat it as opening a template.
    const src = "const r = s.replace(/^```json/i, '');\nconst t = `ok`;\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(0);
  });

  it('does not get tripped by `"` inside a regex pattern', () => {
    // From supabase/functions/export-report/index.ts:46 — escape function.
    const src = "function f(s) { return `\"${s.replace(/\"/g, '\"\"')}\"`; }\n";
    const findings = scanTemplates('virtual.ts', src);
    expect(findings).toHaveLength(0);
  });

  it('parses the real inline.ts cleanly (positive control)', () => {
    // After PR #496 the file is fixed — this test pins it.
    const file = path.join(FUNCTIONS_DIR, 'grounded-answer', 'prompts', 'inline.ts');
    if (!fs.existsSync(file)) return; // tolerate file move
    const text = fs.readFileSync(file, 'utf8');
    const findings = scanTemplates(file, text);
    expect(findings).toEqual([]);
  });
});
