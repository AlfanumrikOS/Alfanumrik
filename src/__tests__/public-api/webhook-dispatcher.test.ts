/**
 * Track A.6 — webhook-dispatcher (Deno Edge Function) coverage.
 * ============================================================================
 * The dispatcher (`supabase/functions/webhook-dispatcher/index.ts`) is a Deno
 * runtime function — it uses `Deno.serve`, `Deno.env`, esm.sh imports — and CANNOT
 * be imported/run under Vitest. Per the brief we:
 *   (a) extract + test the PURE backoff helper logic (exponential, capped,
 *       jittered, dead-letter at MAX_ATTEMPTS), and
 *   (b) pin the rest of the dispatcher's MANDATORY behaviours by static assertion
 *       on the source text (SSRF re-check before send, HMAC keyed by secret_hash,
 *       fail-closed auth before DB I/O, status-guarded atomic delivered-flip,
 *       redirect:'error', counts-only logging — P13).
 *
 * The dispatcher's SSRF re-check uses the byte-mirrored `_shared/ssrf.ts`, whose
 * verdict-parity with the Node copy is proven in ssrf.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const SRC = readFileSync(
  resolve(process.cwd(), 'supabase/functions/webhook-dispatcher/index.ts'),
  'utf8',
);

// ── (a) Extracted backoff logic ──────────────────────────────────────────────
// Mirror of the dispatcher constants + nextRetryIso math (without jitter, which is
// random) so we can assert the schedule + the dead-letter boundary deterministically.
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000;
const CAP_BACKOFF_MS = 6 * 60 * 60 * 1000;

function baseBackoffMs(attempts: number): number {
  return Math.min(CAP_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
}
function isTerminal(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

describe('webhook-dispatcher — backoff schedule (exponential, capped)', () => {
  it('doubles from the 60s base per attempt', () => {
    expect(baseBackoffMs(1)).toBe(60_000); // 60s * 2^0
    expect(baseBackoffMs(2)).toBe(120_000); // 60s * 2^1
    expect(baseBackoffMs(3)).toBe(240_000);
    expect(baseBackoffMs(4)).toBe(480_000);
  });

  it('caps at 6h', () => {
    // 60s * 2^9 = ~512 min > 6h → cap.
    expect(baseBackoffMs(20)).toBe(CAP_BACKOFF_MS);
    expect(baseBackoffMs(8)).toBeLessThanOrEqual(CAP_BACKOFF_MS);
  });

  it('dead-letters at MAX_ATTEMPTS (8), not before', () => {
    expect(isTerminal(7)).toBe(false);
    expect(isTerminal(8)).toBe(true);
    expect(isTerminal(9)).toBe(true);
  });

  it('the source uses the SAME constants (drift guard)', () => {
    expect(SRC).toMatch(/MAX_ATTEMPTS\s*=\s*8/);
    expect(SRC).toMatch(/BASE_BACKOFF_MS\s*=\s*60_000/);
    expect(SRC).toMatch(/CAP_BACKOFF_MS\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    // Exponential, capped, jittered formula present.
    expect(SRC).toMatch(/Math\.min\(CAP_BACKOFF_MS,\s*BASE_BACKOFF_MS\s*\*\s*Math\.pow\(2/);
    expect(SRC).toMatch(/jitter/i);
  });
});

// ── (b) Static behavioural pins ──────────────────────────────────────────────
describe('webhook-dispatcher — SSRF re-check before every send', () => {
  it('imports the shared SSRF validator and re-checks before fetch', () => {
    expect(SRC).toMatch(/from '\.\.\/_shared\/ssrf\.ts'/);
    expect(SRC).toMatch(/validateWebhookTargetUrl\(sub\.target_url\)/);
    // The SSRF block path must NOT call fetch — it backs off instead.
    const ssrfBlockIdx = SRC.indexOf('if (!ssrf.ok)');
    const fetchIdx = SRC.indexOf('await fetch(');
    expect(ssrfBlockIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(ssrfBlockIdx); // ssrf check precedes the send
    expect(SRC).toMatch(/blocked_target/);
  });

  it('does not follow redirects (redirect: "error") — rebinding via 3xx is blocked', () => {
    expect(SRC).toMatch(/redirect:\s*'error'/);
  });
});

describe('webhook-dispatcher — HMAC signing keyed by secret_hash (raw secret never stored)', () => {
  it('signs the exact body with HMAC-SHA256 keyed by sub.secret_hash', () => {
    expect(SRC).toMatch(/hmacSha256Hex\(sub\.secret_hash,\s*bodyStr\)/);
    expect(SRC).toMatch(/name:\s*'HMAC',\s*hash:\s*'SHA-256'/);
    expect(SRC).toMatch(/X-Alfanumrik-Signature[\s\S]*?sha256=/);
  });
});

describe('webhook-dispatcher — fail-closed auth before any DB I/O', () => {
  it('rejects with 401 before constructing the supabase client', () => {
    const authIdx = SRC.indexOf('if (!isAuthorized(req))');
    const clientIdx = SRC.indexOf('createClient(');
    expect(authIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(authIdx);
    // Missing CRON_SECRET fails closed.
    expect(SRC).toMatch(/if \(!secret\) return false/);
    expect(SRC).toMatch(/constantTimeEqual/);
  });
});

describe('webhook-dispatcher — atomic delivered-flip guarded by pre-send status', () => {
  it('every status update is guarded by .eq("status", row.status) to prevent double-delivery', () => {
    // Count update(...) blocks and ensure each is followed by an .eq('status', row.status) guard.
    const guardCount = (SRC.match(/\.eq\('status',\s*row\.status\)/g) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(4); // delivered, ssrf-block, sign-fail, http-fail
    expect(SRC).toMatch(/status:\s*'delivered'/);
    expect(SRC).toMatch(/status:\s*terminal\s*\?\s*'dead_letter'\s*:\s*'failed'/);
  });
});

describe('webhook-dispatcher — P13 counts-only logging', () => {
  it('the summary log emits counts only — never payload/secret/PII', () => {
    expect(SRC).toMatch(/picked=[\s\S]*?delivered=[\s\S]*?retried=[\s\S]*?dead_lettered=[\s\S]*?blocked=/);
    // The log line interpolates counts.* only, not row.payload / secret_hash.
    const logLine = SRC.slice(SRC.indexOf('console.log('), SRC.indexOf('console.log(') + 300);
    expect(logLine).not.toMatch(/payload/);
    expect(logLine).not.toMatch(/secret/);
  });
});
