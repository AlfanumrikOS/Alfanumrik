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
 * daily-cron); the other ~40 relied on review discipline.
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

// ── repo / file resolution ──────────────────────────────────────────────────
// __dirname-relative, NOT cwd-relative. This file lives at
// apps/host/src/__tests__/, four levels below the repo root. The previous
// implementation here resolved candidates off `process.cwd()` (`cwd/rel` then
// `cwd/../rel`) -- every supported invocation of this suite runs with
// `cwd = apps/host` (see vitest.config.ts: "test.root = CWD = apps/host in
// every [supported invocation]"), and from apps/host NEITHER
// `apps/host/supabase/functions` NOR (one hop up) `apps/supabase/functions`
// is the real repo-root `supabase/functions` -- the real directory is TWO
// hops up from apps/host, one hop past what that helper checked. Two
// consequences: (1) the intended repo-root directory could never be reached
// through either candidate, and (2) if unrelated tooling ever created a stray
// directory at exactly `apps/host/supabase/functions` (e.g. a script invoked
// with the wrong working directory), `existsSync` would silently accept that
// bogus, near-empty directory as FUNCTIONS_ABS instead of falling through --
// which is what produced this suite's spurious "ledger has no stale entries"
// failure (every real ledger entry looked "deleted" against that wrong
// directory's near-empty listing). `__dirname` is fixed at authoring time and
// is immune to both the wrong-depth bug and the cwd-dependent hijack.
const FUNCTIONS_ABS = (() => {
  const abs = resolve(__dirname, '../../../../supabase/functions');
  return existsSync(abs) ? abs : null;
})();

type Mechanism =
  | 'ai-admission'
  | 'security-principal'
  | 'internal-cron'
  | 'admin-key'
  | 'jwt-user'
  | 'shared-secret'
  | 'tombstone';

const MECHANISM_SIGNATURES: ReadonlyArray<readonly [Mechanism, RegExp]> = [
  ['ai-admission', /admitAiRoute\s*\(/],
  ['security-principal', /resolveSecurityPrincipal\s*\(/],
  ['internal-cron', /verifyInternalCronRequest\s*\(/],
  ['admin-key', /x-admin-key|ADMIN_API_KEY/],
  ['jwt-user', /\.auth\.getUser\s*\(|resolveTeacherFromJwt|Authorization/],
  ['shared-secret', /CRON_SECRET|INTERNAL_FN_SECRET|INTERNAL_SECRET|x-internal-secret|SEND_EMAIL_HOOK_SECRET|verifyRequestSignature\s*\(/],
] as const;

/**
 * TOMBSTONE EXEMPTION (P2-4a, 2026-08-04) — the ONLY way a function may be
 * unguarded and still pass this sweep.
 *
 * A retired function whose entire body is a structured HTTP 410 response
 * (e.g. `foxy-tutor`, replaced by the Next.js route `/api/foxy`) has no auth
 * requirement because it never touches data, secrets, or Supabase — old
 * clients (installed APKs still pinned to the retired endpoint) must reach
 * the 410 WITHOUT a token, by design (see the function's own header comment
 * and `docs/runbooks/edge-function-drift-report.md`).
 *
 * This exemption is intentionally narrow and mechanical, not a name-based
 * allowlist: a function only qualifies if its index.ts source proves ALL of
 * the following simultaneously —
 *   1. it returns an HTTP 410 status literal, AND
 *   2. it returns the tombstone's `code: 'GONE'` marker, AND
 *   3. it never calls createClient( — no Supabase client, so no data access, AND
 *   4. it never calls Deno.env.get( — no secret/config reads at all.
 * If ANY condition fails — e.g. a future edit reintroduces a Supabase client
 * or an env read — `isProvableTombstone` returns false and the function
 * falls back to being judged as a normal (unguarded) function by the sweep,
 * exactly as before this exemption existed. This is what keeps the
 * exemption from silently widening into a way to hide a real unguarded
 * endpoint: the safety conditions are checked, not just the mechanism label.
 */
const TOMBSTONE_SAFE_SIGNATURES = {
  gone410Status: /status:\s*410\b/,
  goneCodeMarker: /code:\s*['"]GONE['"]/,
} as const;

const TOMBSTONE_UNSAFE_SIGNATURES: readonly RegExp[] = [
  /createClient\s*\(/,
  /Deno\.env\.get\s*\(/,
];

function isProvableTombstone(fn: string): boolean {
  const idx = resolve(FUNCTIONS_ABS!, fn, 'index.ts');
  if (!existsSync(idx)) return false;
  const src = readFileSync(idx, 'utf8');
  const hasGoneStatus = TOMBSTONE_SAFE_SIGNATURES.gone410Status.test(src);
  const hasGoneCode = TOMBSTONE_SAFE_SIGNATURES.goneCodeMarker.test(src);
  const hasUnsafeAccess = TOMBSTONE_UNSAFE_SIGNATURES.some((re) => re.test(src));
  return hasGoneStatus && hasGoneCode && !hasUnsafeAccess;
}

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
  // H1 fix (2026-07-29, P11-adjacent): removed the client-controlled
  // `x-cron-source: pg_cron` bare-header bypass and replaced it with
  // verifyInternalCronRequest() — the same fail-closed internal-cron
  // contract daily-cron/queue-consumer use. 'internal-cron' is the upgrade
  // (the real guard now). 'jwt-user' still matches on the literal outbound
  // `Authorization:` header used for REST calls (not a guard by itself here
  // — see the LIMITATIONS note above).
  // CORRECTION (2026-07-29, testing verification): the fix's own PR
  // description claimed 'shared-secret' would stop matching once the
  // CRON_SECRET literal moved into the shared helper — verified FALSE by
  // running this sweep. 'shared-secret' still matches because index.ts's own
  // header comment (documenting the new auth flow: "CRON_SECRET fast path,
  // get_cron_secret() DB fallback...") contains the literal substring
  // "CRON_SECRET", and MECHANISM_SIGNATURES tests raw source text
  // (comments included, not stripped). This is a detector false-positive on
  // prose, not a second real guard mechanism — but the ledger must reflect
  // what the sweep ACTUALLY detects, so 'shared-secret' stays pinned here.
  'alert-deliverer': ['jwt-user', 'internal-cron', 'shared-secret'],
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
  'extract-diagrams': ['ai-admission', 'admin-key'],
  'extract-ncert-questions': ['ai-admission', 'admin-key'],
  // Retired 2026-07-01, re-added 2026-08-04 as a P2-4a 410 tombstone (see
  // docs/runbooks/edge-function-drift-report.md). No auth by design: the
  // whole function returns a structured 410 GONE pointing at the canonical
  // `/api/foxy` route, for every method, unauthenticated — old APKs still
  // pinned to the retired edge endpoint must reach the 410 without a token.
  // Zero attack surface (no createClient, no Deno.env.get, no data access);
  // see isProvableTombstone() above, which this pin depends on staying true.
  'foxy-tutor': ['tombstone'],
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
  // 2026-07-30 (WhatsApp bot Phase 2): outbound send relay. Real guard =
  // admitAiRoute with a static profile (route 'whatsapp-send', callerTypes
  // ['internal_service']) — only Next.js callers registered in
  // security_internal_callers ('whatsapp-webhook-route', 'whatsapp-drain-cron',
  // migration 20260801100600) may invoke it; fail-closed before any I/O.
  // Same posture as whatsapp-notify, minus that function's 'jwt-user'
  // false-positive (no literal "Authorization" appears in this source —
  // Twilio Basic-auth header construction lives in _shared/whatsapp/
  // twilio-transport.ts, which the sweep does not scan).
  'whatsapp-send': ['ai-admission'],
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
    const unguarded = listFunctionDirs().filter(
      (fn) => detectMechanisms(fn).length === 0 && !isProvableTombstone(fn),
    );
    expect(
      unguarded,
      `UNGUARDED Edge Functions (deployed with --no-verify-jwt, so this is an open endpoint): ${unguarded.join(', ')}. ` +
        `Add an auth guard (see _shared/security/) and a ledger entry in this file, or — if the function is a ` +
        `retired pure-410 tombstone — make it pass isProvableTombstone().`,
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

      // Tombstone-pinned functions are verified against isProvableTombstone(),
      // not MECHANISM_SIGNATURES — they carry no auth mechanism by design.
      // If a future edit adds a Supabase client, an env/secret read, or drops
      // the 410/GONE markers, isProvableTombstone() flips to false and THIS
      // assertion fails — the real safety condition, not a label comparison.
      if (expected.length === 1 && expected[0] === 'tombstone') {
        if (!isProvableTombstone(fn)) {
          drift.push(
            `${fn}: pinned as ['tombstone'] but no longer proves a pure-410 tombstone ` +
              `(missing 410/GONE markers, or gained createClient()/Deno.env.get() access) ` +
              `— this is a SECURITY REGRESSION: the function is unguarded and no longer exempt.`,
          );
        }
        continue;
      }

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
