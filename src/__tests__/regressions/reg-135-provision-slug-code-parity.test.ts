/**
 * REG-135 — provision slug+code parity in provisionTrialSchool().
 *
 * Incident vector: the `provisionTrialSchool()` helper in
 * `src/lib/school-provisioning.ts` writes both a `code` and a `slug` column on
 * the schools INSERT. If either field is dropped, the self-serve trial path
 * breaks: the schools JOIN flow (which looks up by `slug`) stops finding
 * newly-provisioned schools, and the legacy code-keyed path also breaks.
 *
 * This is a STRUCTURAL regression pin — it reads the source file as text and
 * asserts the required fields are present in the INSERT payload. No DB required.
 *
 * Assertions:
 *   1. The schools INSERT in provisionTrialSchool() carries BOTH `slug` AND
 *      `code` as explicit field keys.
 *   2. `normalizeSlug` is exported from the same file.
 *   3. `normalizeSlug` is referenced (called) inside provisionTrialSchool() —
 *      the slug written to `schools` must pass through the canonical normaliser.
 *
 * Why a structural test and not a unit test over the live function?
 * The function calls multiple DB tables and has external side effects (email).
 * A structural source scan is deterministic, runs in <5 ms, catches the exact
 * failure mode (missing INSERT field), and avoids a complex mock chain that
 * could obscure which branch of the INSERT is actually executed. The trade-off
 * is deliberate; the companion integration test covers the live DB path.
 *
 * Catalogued as REG-135 in .claude/regression-catalog.md.
 * Next free id after REG-134 (Phase A Loops B & C, 2026-06-13).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(process.cwd(), 'src/lib/school-provisioning.ts');

// Read once; all assertions operate on this text.
const sourceText = readFileSync(SOURCE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the body of provisionTrialSchool() by finding the `export async
 * function provisionTrialSchool` declaration and capturing text until the
 * final closing brace of the function at indentation level 0.  We use a
 * simple brace-counting heuristic rather than a real AST — sufficient for
 * this pin (the function is the last export in the file and the file ends
 * with its closing `}`).
 */
function extractFunctionBody(src: string, fnName: string): string {
  const declIdx = src.indexOf(`function ${fnName}`);
  if (declIdx === -1) return '';
  // Walk forward to find the opening brace of the function body.
  const openBrace = src.indexOf('{', declIdx);
  if (openBrace === -1) return '';
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(declIdx, i + 1);
    }
  }
  // Unterminated — return everything from the declaration.
  return src.slice(declIdx);
}

const provisionBody = extractFunctionBody(sourceText, 'provisionTrialSchool');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('REG-135 — provision slug+code parity (src/lib/school-provisioning.ts)', () => {
  it('provisionTrialSchool exists in the source file', () => {
    expect(provisionBody.length).toBeGreaterThan(0);
  });

  it('schools INSERT contains the "slug" field', () => {
    // The INSERT payload is an object literal inside .insert({ ... }).
    // We look for a `slug:` key (with optional whitespace before the colon).
    // This catches both `slug: finalSlug` and `slug:finalSlug` styles.
    expect(provisionBody).toMatch(/\bslug\s*:/);
  });

  it('schools INSERT contains the "code" field', () => {
    expect(provisionBody).toMatch(/\bcode\s*:/);
  });

  it('both "slug" and "code" fields appear in the same .insert() call', () => {
    // Find the .insert({ ... }) call on the schools table and verify both keys
    // exist within the same block. We locate the insert block by finding
    // `.insert({` and scanning to its matching closing `})`.
    const insertStart = provisionBody.indexOf('.insert({');
    expect(insertStart, '.insert({ not found in provisionTrialSchool').toBeGreaterThan(-1);

    let depth = 0;
    let insertEnd = -1;
    for (let i = insertStart; i < provisionBody.length; i++) {
      if (provisionBody[i] === '{') depth += 1;
      else if (provisionBody[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          insertEnd = i;
          break;
        }
      }
    }
    expect(insertEnd, 'could not find closing } of .insert({').toBeGreaterThan(insertStart);

    const insertBlock = provisionBody.slice(insertStart, insertEnd + 1);
    expect(insertBlock).toMatch(/\bslug\s*:/);
    expect(insertBlock).toMatch(/\bcode\s*:/);
  });

  it('normalizeSlug is exported from school-provisioning.ts', () => {
    // The export must be a named export (not just a local function).
    // We accept both `export function normalizeSlug` and
    // `export { normalizeSlug }` forms.
    const hasDirectExport = /export\s+function\s+normalizeSlug\b/.test(sourceText);
    const hasNamedReExport = /export\s*\{[^}]*\bnormalizeSlug\b[^}]*\}/.test(sourceText);
    expect(
      hasDirectExport || hasNamedReExport,
      'normalizeSlug must be a named export from school-provisioning.ts',
    ).toBe(true);
  });

  it('normalizeSlug is referenced (called) inside provisionTrialSchool', () => {
    // The slug written to the schools table must derive from normalizeSlug —
    // either directly or via the generateSlug alias.  We accept any of:
    //   normalizeSlug(...)   — direct call
    //   generateSlug(...)    — alias (the file uses `function generateSlug`
    //                          which delegates to normalizeSlug)
    const callsNormalizeSlug = /\bnormalizeSlug\s*\(/.test(provisionBody);
    const callsGenerateSlug = /\bgenerateSlug\s*\(/.test(provisionBody);
    expect(
      callsNormalizeSlug || callsGenerateSlug,
      'provisionTrialSchool must call normalizeSlug() or generateSlug() to derive the slug',
    ).toBe(true);
  });

  it('generateSlug (the alias) delegates to normalizeSlug when present', () => {
    // The file uses `function generateSlug(name) { return normalizeSlug(name); }`.
    // Verify the alias body calls normalizeSlug so the delegation chain holds.
    const generateSlugBody = extractFunctionBody(sourceText, 'generateSlug');
    if (generateSlugBody.length === 0) {
      // generateSlug was removed — the direct normalizeSlug call is the only path.
      // The previous test already ensures provisionTrialSchool calls normalizeSlug.
      return;
    }
    expect(generateSlugBody).toMatch(/\bnormalizeSlug\s*\(/);
  });
});
