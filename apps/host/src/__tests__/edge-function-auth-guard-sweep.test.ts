import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * EDGE FUNCTION AUTH-GUARD SWEEP (P9 RBAC) — testing-strategy Phase 1, gap 1.
 *
 * WHY THIS EXISTS
 * ===============
 * Every Alfanumrik Edge Function is deployed with `--no-verify-jwt`
 * (deploy-production.yml / deploy-staging.yml — "most Alfanumrik functions
 * perform their own auth"). That makes self-enforced auth a REQUIREMENT, not
 * a convention: a function that forgets its guard is an open, unauthenticated
 * production endpoint the moment it deploys. Hand-written contract canaries
 * exist for a handful of functions (teacher-dashboard, parent-portal,
 * daily-cron, export-report); the other ~40 relied on review discipline.
 *
 * This sweep makes the guarantee structural:
 *   1. EVERY directory under supabase/functions/ (excluding _shared/_archive)
 *      must match at least ONE known auth-guard signature in its index.ts.
 *      A brand-new function with no guard fails CI by default.
 *   2. The per-function mechanism ledger below is PINNED (same posture-freeze
 *      approach as the sibling `rls-inventory.test.ts`). A guard mechanism
 *      silently disappearing from a function — e.g. an admitAiRoute() call
 *      dropped in a refactor — fails the sweep even if some weaker signature
 *      still matches. Changing a function's auth mechanism must be a
 *      deliberate, reviewed edit to this ledger.
 *
 * KNOWN MECHANISMS (signature regexes over index.ts source)
 * =========================================================
 *  - ai-admission        admitAiRoute() — Platform Security Layer admission
 *                        (quota + principal + policy) for AI routes.
 *  - security-principal  resolveSecurityPrincipal() — Platform Security Layer
 *                        principal resolution (JWT or internal caller).
 *  - internal-cron       verifyInternalCronRequest() — signed internal cron
 *                        requests (see _shared/security/internal-cron-auth.ts).
 *  - admin-key           x-admin-key / ADMIN_API_KEY constant-time compare.
 *  - jwt-user            Authorization-header JWT → auth.getUser() (or the
 *                        function-local equivalent, e.g. resolveTeacherFromJwt).
 *  - shared-secret       CRON_SECRET / internal secret header / explicit
 *                        verifyRequestSignature() call.
 *
 * LIMITATIONS (honest scope)
 * ==========================
 * This is a STATIC source sweep, consistent with the repo's static-canary
 * convention (teacher-dashboard/bulk-jee-neet-import contract tests): it
 * proves a guard signature EXISTS in the source, not that it executes before
 * every dispatch path. The live unauthenticated probe (scripts/
 * edge-auth-sweep.mjs, edge-auth-sweep.yml) covers the behavioral half —
 * including the ~40 DEPLOYED functions that have no source in this repo at
 * all (see the orphan ledger in that script). The `jwt-user` signature is
 * deliberately broad (an outbound `Authorization:` header also matches);
 * functions whose ONLY mechanism is jwt-user deserve per-function canaries
 * over time — the pinned ledger makes that worklist explicit.
 *
 * Owner: testing (architect reviews ledger edits). Plan: testing-strategy
 * Phase 1 (2026-07-13).
 */

// ── repo / file resolution (cwd or one level up, matching the sibling pins) ──
function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const FUNCTIONS_ABS = resolveRepo('supabase/functions');

type Mechanism =
  | 'ai-admission'
  | 'security-principal'
  | 'internal-cron'
  | 'admin-key'
  | 'jwt-user'
  | 'shared-secret';

const MECHANISM_SIGNATURES: ReadonlyArray<readonly [Mechanism, RegExp]> = [
  ['ai-admission', /admitAiRoute\s*\(/],
  ['security-principal', /resolveSecurityPrincipal\s*\(/],
  ['internal-cron', /verifyInternalCronRequest\s*\(/],
  ['admin-key', /x-admin-key|ADMIN_API_KEY/],
  ['jwt-user', /\.auth\.getUser\s*\(|resolveTeacherFromJwt|Authorization/],
  ['shared-secret', /CRON_SECRET|INTERNAL_FN_SECRET|INTERNAL_SECRET|x-internal-secret|SEND_EMAIL_HOOK_SECRET|verifyRequestSignature\s*\(/],
] as const;

/**
 * PINNED LEDGER — detected auth mechanism(s) per function as of 2026-07-13.
 * Generated from source with MECHANISM_SIGNATURES; verified UNGUARDED = [].
 *
 * To change: edit the function's guard code AND this entry in the same PR,
 * with review. Removing a mechanism from a function is a security-posture
 * change; adding one is an upgrade (update the entry so the stronger guard
 * is what's pinned).
 */
const AUTH_GUARD_LEDGER: Record<string, Mechanism[]> = {
  'account-purge': ['jwt-user', 'shared-secret'],
  'alert-deliverer': ['jwt-user', 'shared-secret'],
  'alfabot-answer': ['ai-admission'],
  'alfabot-send-inquiry': ['jwt-user'],
  'board-score': ['jwt-user'],
  'bulk-jee-neet-curated-import': ['jwt-user'],
  'bulk-jee-neet-import': ['ai-admission', 'admin-key'],
  'bulk-non-mcq-gen': ['ai-admission'],
  'bulk-question-gen': ['ai-admission'],
  'cme-engine': ['jwt-user'],
  'coverage-audit': ['jwt-user', 'shared-secret'],
  'daily-cron': ['internal-cron', 'jwt-user', 'shared-secret'],
  'data-erasure-purger': ['internal-cron'],
  'embed-diagrams': ['ai-admission', 'admin-key'],
  'embed-ncert-qa': ['ai-admission', 'admin-key'],
  'embed-questions': ['ai-admission', 'admin-key'],
  'export-report': ['jwt-user'],
  'extract-diagrams': ['ai-admission', 'admin-key'],
  'extract-ncert-questions': ['ai-admission', 'admin-key'],
  'generate-answers': ['ai-admission', 'admin-key'],
  'generate-concepts': ['ai-admission', 'admin-key'],
  'generate-embeddings': ['admin-key'],
  'grade-experiment-conclusion': ['jwt-user'],
  'grounded-answer': ['security-principal'],
  'identity': ['jwt-user'],
  'invoice-generator': ['jwt-user'],
  'monthly-synthesis-builder': ['internal-cron', 'shared-secret'],
  'ncert-question-engine': ['security-principal'],
  'ncert-solver': ['ai-admission', 'jwt-user'],
  'nep-compliance': ['jwt-user'],
  'parent-portal': ['jwt-user'],
  'parent-report-generator': ['ai-admission'],
  'projector-health-check': ['internal-cron'],
  'projector-runner': ['internal-cron'],
  'queue-consumer': ['internal-cron'],
  'quiz-generator': ['jwt-user'],
  'scan-ocr': ['ai-admission', 'jwt-user'],
  // 2026-07-15 correction: the Mailgun→Resend migration moved the outbound
  // `Authorization: Basic ...` Mailgun header into _shared/relay-mailer.ts, so
  // the old FALSE `jwt-user` match (the literal "Authorization" string) is gone.
  // Neither function ever did JWT-user auth. Real guard = the standardwebhooks
  // HMAC verify keyed by SEND_EMAIL_HOOK_SECRET (200-only, fail-closed).
  'send-auth-email': ['shared-secret'],
  // 2026-07-15 correction: same Mailgun-header false-positive removed by the
  // Resend migration. Real guard is unchanged — CRON_SECRET via checkCronSecret
  // (fail-closed 401 before any I/O). It never did JWT-user auth.
  'send-pre-debit-notice': ['shared-secret'],
  'send-renewal-reminder': ['jwt-user'],
  'send-transactional-email': ['jwt-user'],
  'send-welcome-email': ['jwt-user'],
  'session-guard': ['jwt-user'],
  'synthetic-host-monitor': ['internal-cron'],
  'teacher-dashboard': ['jwt-user'],
  'verify-question-bank': ['internal-cron'],
  'webhook-dispatcher': ['jwt-user', 'shared-secret'],
  'whatsapp-notify': ['ai-admission', 'jwt-user'],
};

function listFunctionDirs(): string[] {
  if (!FUNCTIONS_ABS) return [];
  return readdirSync(FUNCTIONS_ABS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

function detectMechanisms(fn: string): Mechanism[] {
  const idx = resolve(FUNCTIONS_ABS!, fn, 'index.ts');
  if (!existsSync(idx)) return [];
  const src = readFileSync(idx, 'utf8');
  return MECHANISM_SIGNATURES.filter(([, re]) => re.test(src)).map(([name]) => name);
}

describe('Edge Function auth-guard sweep (P9)', () => {
  it('precondition: supabase/functions resolves and is non-empty', () => {
    expect(FUNCTIONS_ABS).not.toBeNull();
    expect(listFunctionDirs().length).toBeGreaterThan(0);
  });

  it('every function directory has an index.ts entrypoint', () => {
    const missing = listFunctionDirs().filter(
      (fn) => !existsSync(resolve(FUNCTIONS_ABS!, fn, 'index.ts')),
    );
    expect(missing, `function dirs without index.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('every function matches at least one known auth-guard signature (no unguarded functions)', () => {
    const unguarded = listFunctionDirs().filter((fn) => detectMechanisms(fn).length === 0);
    expect(
      unguarded,
      `UNGUARDED Edge Functions (deployed with --no-verify-jwt, so this is an open endpoint): ${unguarded.join(', ')}. ` +
        `Add an auth guard (see _shared/security/) and a ledger entry in this file.`,
    ).toEqual([]);
  });

  it('every function has a pinned ledger entry (new functions must be classified)', () => {
    const unpinned = listFunctionDirs().filter((fn) => !(fn in AUTH_GUARD_LEDGER));
    expect(
      unpinned,
      `New Edge Function(s) without an AUTH_GUARD_LEDGER entry: ${unpinned.join(', ')}. ` +
        `Classify the auth mechanism and pin it here so the sweep can detect future drift.`,
    ).toEqual([]);
  });

  it('ledger has no stale entries for deleted functions', () => {
    const dirs = new Set(listFunctionDirs());
    const stale = Object.keys(AUTH_GUARD_LEDGER).filter((fn) => !dirs.has(fn));
    expect(
      stale,
      `AUTH_GUARD_LEDGER entries with no matching function dir: ${stale.join(', ')}. Remove them.`,
    ).toEqual([]);
  });

  it('detected mechanisms match the pinned ledger exactly (auth-posture freeze)', () => {
    const drift: string[] = [];
    for (const fn of listFunctionDirs()) {
      const expected = AUTH_GUARD_LEDGER[fn];
      if (!expected) continue; // reported by the unpinned test above
      const actual = detectMechanisms(fn);
      const exp = [...expected].sort().join(',');
      const act = [...actual].sort().join(',');
      if (exp !== act) drift.push(`${fn}: pinned [${exp}] but detected [${act}]`);
    }
    expect(
      drift,
      `Auth-guard posture drift:\n${drift.join('\n')}\n` +
        `If the change is deliberate, update AUTH_GUARD_LEDGER in the same PR (reviewer: security posture change).`,
    ).toEqual([]);
  });
});
