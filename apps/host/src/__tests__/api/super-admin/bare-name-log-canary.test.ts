/**
 * SAO-4 (Cycle 6 — Super-Admin & Observability) — bare-name log canary (P13).
 *
 * WHY THIS EXISTS
 * ---------------
 * The structured logger redacts PII by KEY NAME (`SENSITIVE_KEYS` in
 * `supabase/functions/_shared/redact-pii.ts`). It DELIBERATELY omits the bare
 * keys `name` and `ip`/`ip_address` to avoid colliding with non-PII fields like
 * `event_name`, `subject_name`, `flag_name`, and metric labels. Only the
 * explicit `full_name` / `first_name` / `last_name` variants are caught.
 *
 * Consequence (audit SAO-4): a caller that logs a student's name under the bare
 * key `name` (or an email under `email`, a phone under `phone`) reaches Vercel
 * logs / Sentry `extra` UN-redacted. The redactor is key-based, so this is a
 * caller-discipline gap, not a structural guarantee.
 *
 * WHAT THIS CANARY DOES (and explicitly does NOT do)
 * --------------------------------------------------
 * It is a CONSERVATIVE lexical canary, NOT a taint analysis. For every
 * `logger.info|warn|error|debug(...)` call in the scanned source, it extracts the
 * balanced-paren argument text and flags an OBJECT KEY that is exactly `name`,
 * `email`, or `phone` (i.e. a bare key in key position — immediately preceded by
 * `{` or `,`).
 *
 * HEURISTIC NOTES (kept conservative to avoid false positives — a canary that
 * cries wolf gets deleted):
 *   - The `[{,]` anchor means underscore-prefixed safe keys are NOT matched:
 *     `full_name:`, `school_name:`, `event_name:`, `flag_name:`, `role_name:`,
 *     `display_name:`, `admin_name:` all start with a non-keyword token, so the
 *     `(name|email|phone)` alternation never matches at that position.
 *   - The same anchor avoids matching inside the event-name STRING argument
 *     (`logger.info('user name: x', {...})` — the `name:` there is preceded by a
 *     space, not `{`/`,`).
 *   - It does NOT attempt to prove the VALUE is actually a student's PII. A bare
 *     `name:` is the ambiguous case the audit flagged; surfacing it for human
 *     judgment is the point.
 *
 * IF THIS TEST FAILS: a logger call passes a bare `name`/`email`/`phone` key.
 * Either (a) normalize to `full_name` (which the redactor catches) / drop the
 * field, or (b) if the value is provably non-PII (e.g. a feature-flag name),
 * rename the key to a `*_name` form OR add the exact `file:line` to
 * SAFE_HIT_ALLOWLIST with a justification. Do NOT relax the regex.
 *
 * SCOPE: the super-admin route surface (the audit's concern) plus the
 * observability/analytics emit libs. Dynamically enumerated.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// Directories scanned recursively (every *.ts) + explicit observability/analytics libs.
const SCAN_DIRS = ['src/app/api/super-admin'].map((p) => path.join(REPO_ROOT, p));
const SCAN_FILES = [
  'src/lib/analytics.ts',
  'src/lib/logger.ts',
  'src/lib/ops-events.ts',
  'src/lib/ops-events-redactor.ts',
].map((p) => path.join(REPO_ROOT, p));

// Exact `relpath:line` hits that have been reviewed and confirmed non-PII.
// EMPTY today — the scan is clean. Adding an entry is a documented exception.
const SAFE_HIT_ALLOWLIST = new Set<string>([]);

const LOGGER_CALL_G = /logger\.(info|warn|error|debug)\s*\(/g;
// Object-KEY position: a `{` or `,` (start of an object or next property),
// optional whitespace, then exactly one of the bare PII keys, then `:`.
const BARE_PII_KEY = /[{,]\s*(name|email|phone)\s*:/;

function relPosix(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Balanced-paren slice of a logger call starting at the `(` after the method. */
function extractCallArgs(src: string, openParenIdx: number): string {
  let depth = 0;
  let i = openParenIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(openParenIdx, i);
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

const SCANNED_FILES: string[] = [
  ...SCAN_DIRS.flatMap(collectTsFiles),
  ...SCAN_FILES.filter((f) => existsSync(f)),
]
  .map(relPosix)
  .sort();

describe('SAO-4 — bare-name log canary (P13)', () => {
  it('scans a non-trivial slice of the admin + observability source', () => {
    // Guard against the scan silently collecting nothing (path drift).
    expect(SCANNED_FILES.length).toBeGreaterThanOrEqual(100);
    expect(SCANNED_FILES).toContain('src/lib/analytics.ts');
    expect(SCANNED_FILES).toContain('src/lib/logger.ts');
  });

  it('no logger call passes a bare name/email/phone key (would bypass key-based redaction)', () => {
    const hits: string[] = [];
    for (const rel of SCANNED_FILES) {
      const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      LOGGER_CALL_G.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LOGGER_CALL_G.exec(src))) {
        const openParen = m.index + m[0].length - 1; // index of the '(' in `logger.x(`
        const args = extractCallArgs(src, openParen);
        const keyMatch = BARE_PII_KEY.exec(args);
        if (!keyMatch) continue;
        const line = lineOf(src, m.index);
        const loc = `${rel}:${line}`;
        if (SAFE_HIT_ALLOWLIST.has(loc)) continue;
        hits.push(`${loc} -> bare '${keyMatch[1]}:' in logger.${m[1]}(...)`);
      }
    }
    // Expected []: callers use `full_name` (redacted) or omit PII. A non-empty
    // list means a student name/email/phone could reach logs un-redacted.
    expect(hits).toEqual([]);
  });
});
