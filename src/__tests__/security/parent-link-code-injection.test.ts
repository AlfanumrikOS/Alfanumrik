/**
 * PP-2 — Parent link-code filter-injection guard (engineering-audit Cycle 7).
 *
 * `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) is the single defence that stops a
 * crafted `link_code` from reaching the PostgREST `.or()` filter
 * (`invite_code.eq.${code},link_code.eq.${code}`) and broadening / altering it
 * (PP-2 filter-injection class). It runs in THREE call sites before the
 * interpolation:
 *   - src/app/api/parent/link-code/request-otp/route.ts
 *   - src/app/api/parent/accept-invite/route.ts
 *   - supabase/functions/parent-portal/index.ts (handleParentLogin)
 *
 * The Next.js routes use the validator in `src/lib/sanitize.ts`; the Edge
 * function uses the Deno/Edge twin `supabase/functions/_shared/link-code.ts`.
 * The supabase/ ↔ src/ tree boundary forces two physical copies that MUST stay
 * byte-identical — this file pins both behaviour AND parity.
 *
 * Invariants: P8 (RLS boundary — a malformed code can never broaden a query),
 * P13 (no cross-family data leak via a widened filter).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isValidLinkCode, LINK_CODE_RE } from '@/lib/sanitize';
// The Deno/Edge twin is pure ESM with no Deno globals — importable under Vitest.
import {
  isValidLinkCode as isValidLinkCodeDeno,
  LINK_CODE_RE as LINK_CODE_RE_DENO,
} from '../../../supabase/functions/_shared/link-code';

// Server-generated codes: students.link_code = 6 uppercase hex,
// students.invite_code = 8 uppercase hex. The 4–12 window covers both with
// margin while admitting NO PostgREST metacharacter.
const VALID_CODES = [
  'ABC123', // 6-char link_code shape (uppercase hex)
  'ABCD1234', // 8-char invite_code shape (uppercase hex)
  'AB12', // minimum width (4)
  'ABCDEFGHIJKL', // maximum width (12)
  'ABCDEF', // all letters
  '123456', // all digits
  'A1B2C3D4', // mixed
];

// Each of these is either a PostgREST filter-injection payload or otherwise
// out-of-charset/width — every one MUST be rejected before the `.or()` filter.
const INJECTION_OR_MALFORMED = [
  'A,deleted_at.is.null', // comma → extra filter term (the canonical PP-2 payload)
  'x.eq.1', // dots + operator syntax (lowercase too)
  '*', // wildcard
  'AB,CD', // bare comma splits the .or() list
  'AB(CD)', // parentheses (PostgREST grouping)
  'AB)OR(1.eq.1', // grouping + boolean smuggle
  'AB:CD', // colon
  "AB'CD", // single quote
  'AB"CD', // double quote
  'AB CD', // whitespace
  'AB\tCD', // tab whitespace
  'abcd', // lowercase (codes are upper-only)
  'AbCd12', // mixed case
  'ABCDEFGHIJKLM', // 13 chars — too long
  'ABC', // 3 chars — too short
  '', // empty
  'AB-CD', // dash (not in [A-Z0-9])
  'AB_CD', // underscore
  'AB.CD', // dot
  'ＡＢＣＤ', // full-width unicode lookalikes
];

describe('PP-2 isValidLinkCode — accepts only server-generated code shapes', () => {
  it.each(VALID_CODES)('accepts a valid code: %s', (code) => {
    expect(isValidLinkCode(code)).toBe(true);
  });

  it.each(INJECTION_OR_MALFORMED)('rejects an injection / malformed code: %j', (code) => {
    expect(isValidLinkCode(code)).toBe(false);
  });

  it('rejects every PostgREST control character used to split/alter an .or() filter', () => {
    for (const ch of [',', '.', '(', ')', '*', ':', "'", '"', ' ', '\t', '\n']) {
      // Embed the metacharacter inside an otherwise-valid 6-char body.
      expect(isValidLinkCode(`ABC${ch}12`)).toBe(false);
    }
  });

  it('the canonical PP-2 payload "A,deleted_at.is.null" can never reach a query', () => {
    expect(isValidLinkCode('A,deleted_at.is.null')).toBe(false);
  });
});

describe('PP-2 TS ↔ Deno twin parity', () => {
  it('the two implementations agree on every fixture (no drift)', () => {
    for (const code of [...VALID_CODES, ...INJECTION_OR_MALFORMED]) {
      expect(isValidLinkCodeDeno(code)).toBe(isValidLinkCode(code));
    }
  });

  it('both expose an identical regex source + flags', () => {
    expect(LINK_CODE_RE.source).toBe('^[A-Z0-9]{4,12}$');
    expect(LINK_CODE_RE_DENO.source).toBe(LINK_CODE_RE.source);
    expect(LINK_CODE_RE_DENO.flags).toBe(LINK_CODE_RE.flags);
  });

  it('the regex literal is byte-identical in both source files (deploy-boundary copies)', () => {
    const tsSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/sanitize.ts'),
      'utf8',
    );
    const denoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/functions/_shared/link-code.ts'),
      'utf8',
    );
    const literal = 'export const LINK_CODE_RE = /^[A-Z0-9]{4,12}$/';
    expect(tsSrc).toContain(literal);
    expect(denoSrc).toContain(literal);
  });
});
