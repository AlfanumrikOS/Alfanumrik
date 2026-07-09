import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { redactPIIInText } from '@alfanumrik/lib/ops-events-redactor';

/**
 * Tier-2 PR B (engineering-audit remediation) — super-admin observability CSV
 * export `message`-column PII redaction (P13). Catalog: REG-202.
 *
 * THE CHANGE UNDER TEST (2 edits)
 * ===============================
 *   1. `src/app/api/super-admin/observability/export/route.ts` (~line 97) — the
 *      free-form `message` CSV column is now wrapped in `redactPIIInText(...)`
 *      before egress:
 *        escapeCSV(row.message ? redactPIIInText(row.message).text : row.message)
 *      Null/empty `message` is passed through untouched.
 *   2. `src/lib/ops-events-redactor.ts` — `redactPIIInText` is added to the
 *      re-export barrel (one line), alongside the existing `redactPII`.
 *
 * WHY IT MATTERS (P13 boundary)
 * -----------------------------
 * Ops event messages are developer-authored templates and PII-free at write time
 * (`logOpsEvent`), so on clean rows `redactPIIInText` is an IDENTITY transform
 * (behavior-preserving). But this CSV is the LAST line of defense before bulk
 * egress: a single mis-instrumented upstream message carrying an email / Indian
 * phone / Razorpay id would otherwise be exfiltrated verbatim. This mirrors the
 * SAO-3 defense-in-depth treatment of the `context_json` column, which deep-
 * redacts via the key-based `redactPII` two lines below.
 *
 * ─── Lane note (why Assertion 1 is a SOURCE-level pin, not a route boot) ──────
 * The route reads through the RLS-bypassing admin client and the unit lane has NO
 * live Postgres / DB fixtures. The established convention for egress-redaction
 * pins is source-level, comment-stripped (see the admin-route auth-gate sweep and
 * the REG-201 active-enrollment scoping pin `active-enrollment-scoping.test.ts`):
 * assert the exact shape of the route source because the shape IS the guarantee.
 * The behavioural lane is covered DIRECTLY here in Assertion 2 — `redactPIIInText`
 * is a pure function and is unit-testable without the route.
 *
 * Owner: testing.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function resolveRepo(rel: string): string {
  for (const c of [resolve(REPO_ROOT, rel), resolve(process.cwd(), rel)]) {
    if (existsSync(c)) return c;
  }
  return resolve(REPO_ROOT, rel);
}

/**
 * Strip TS comments so the assertions inspect EXECUTABLE source only. CRITICAL
 * here: the route's header JSDoc + the ~6-line block comment above the redaction
 * call narrate "redactPIIInText", "row.message", "identity transform", etc. as
 * prose. Without stripping, an assertion could pass against a comment even if the
 * live wrapping were removed (vacuous). Strips block comments first, then `//`.
 */
function stripComments(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function readSource(rel: string): string {
  return stripComments(readFileSync(resolveRepo(rel), 'utf8'));
}

const EXPORT_ROUTE = 'src/app/api/super-admin/observability/export/route.ts';
const REDACTOR_BARREL = 'src/lib/ops-events-redactor.ts';

describe('Tier-2 PR B — super-admin export message redaction (P13) — REG-202', () => {
  // ── Assertion 1 (SOURCE PIN): the route wraps row.message in redactPIIInText ─
  describe('observability/export/route.ts — message column is redactor-wrapped', () => {
    const src = readSource(EXPORT_ROUTE);

    it('imports redactPIIInText from the ops-events-redactor barrel', () => {
      // The import must be from the Next.js-side barrel, not the Deno _shared path.
      expect(src).toMatch(
        /import\s*\{[^}]*\bredactPIIInText\b[^}]*\}\s*from\s*['"](?:@\/lib|@alfanumrik\/lib)\/ops-events-redactor['"]/,
      );
    });

    it('wraps row.message in redactPIIInText(...).text before it reaches the CSV', () => {
      // Whitespace-collapse so the assertion is robust to formatting.
      const collapsed = src.replace(/\s+/g, ' ');
      // The exact ternary: redact when present, pass null/empty through untouched.
      expect(collapsed).toContain(
        'escapeCSV(row.message ? redactPIIInText(row.message).text : row.message)',
      );
    });

    it('preserves null/empty passthrough (the falsy branch returns row.message verbatim)', () => {
      const collapsed = src.replace(/\s+/g, ' ');
      // The falsy arm of the ternary must be the raw `row.message`, NOT a
      // coerced '' or a second redactor call — null/empty is passed through.
      expect(collapsed).toMatch(
        /row\.message\s*\?\s*redactPIIInText\(row\.message\)\.text\s*:\s*row\.message/,
      );
    });

    it('still deep-redacts the context_json column via redactPII (SAO-3 sibling intact)', () => {
      // Guard: the new message wrapping did not displace the existing SAO-3
      // context redaction two lines below.
      const collapsed = src.replace(/\s+/g, ' ');
      expect(collapsed).toContain('JSON.stringify(redactPII(row.context))');
    });
  });

  // ── Assertion 2 (BEHAVIOR): redactPIIInText redacts PII, identity on clean ──
  describe('redactPIIInText behavior (imported via @alfanumrik/lib/ops-events-redactor)', () => {
    it('redacts an email in a free-form message', () => {
      const out = redactPIIInText('quiz failed for student aarav.sharma@gmail.com');
      expect(out.text).not.toContain('aarav.sharma@gmail.com');
      expect(out.text).toContain('[REDACTED_EMAIL]');
      expect(out.applied).toContain('email');
    });

    it('redacts an Indian mobile number in a free-form message', () => {
      const out = redactPIIInText('parent contact +91 9876543210 bounced');
      expect(out.text).not.toContain('9876543210');
      expect(out.text).toContain('[REDACTED_PHONE]');
      expect(out.applied).toContain('phone');
    });

    it('redacts a Razorpay id in a free-form message', () => {
      const out = redactPIIInText('refund issued for pay_Nabc123XYZ45678');
      expect(out.text).not.toContain('pay_Nabc123XYZ45678');
      expect(out.text).toContain('[REDACTED_PAYMENT_ID]');
      expect(out.applied).toContain('razorpay_id');
    });

    it('returns a clean developer-template message UNCHANGED (identity transform on clean rows)', () => {
      // Proves the egress redactor is behavior-preserving on the PII-free
      // developer templates that ops events carry at write time.
      const clean = 'quiz_graded: session completed in 42s with 7/10 correct';
      const out = redactPIIInText(clean);
      expect(out.text).toBe(clean);
      expect(out.applied).toEqual([]);
    });

    it('passes empty string through unchanged (null/empty passthrough parity)', () => {
      const out = redactPIIInText('');
      expect(out.text).toBe('');
      expect(out.applied).toEqual([]);
    });
  });

  // ── Assertion 3 (BARREL): redactPIIInText is exported from the Next barrel ──
  describe('@alfanumrik/lib/ops-events-redactor barrel exports redactPIIInText', () => {
    it('exposes redactPIIInText as a callable function (runtime import)', () => {
      expect(typeof redactPIIInText).toBe('function');
    });

    it('re-exports redactPIIInText in the barrel source (alongside redactPII)', () => {
      const src = readSource(REDACTOR_BARREL);
      expect(src).toMatch(/export\s*\{[^}]*\bredactPIIInText\b[^}]*\}/);
      // The canonical implementation still lives in the shared Deno-compatible module.
      expect(src).toContain('redact-pii');
    });
  });
});
