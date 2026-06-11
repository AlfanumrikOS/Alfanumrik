// supabase/functions/parent-portal/__tests__/contract.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   cd supabase/functions/parent-portal && deno test --allow-read
// (--allow-all also works, matching the sibling alfabot-answer / grounded-answer
//  invocation; these tests only read the local file system, never the network.)
//
// ── Approach: STATIC-SOURCE CONTRACT CANARY ──────────────────────────────────
// parent-portal/index.ts is a MONOLITHIC Deno.serve() handler: the request
// handler is passed inline to Deno.serve() at module top level and is NOT
// exported, and the Supabase client is built from a top-level esm.sh import
// (`createClient` + `getServiceClient()`). There is no seam to inject a mocked
// Supabase client, so the handler cannot be imported and invoked in a
// behavioral test the way alfabot-answer's exported `handleRequest` /
// `__setSupabaseClientForTests` can.
//
// We therefore use the same strategy bulk-jee-neet-import uses for its
// un-mockable Deno.serve() handler: read index.ts as text and assert the
// security-critical control-flow lines exist and are ordered correctly. This
// pins the contract so a future edit that deletes the JWT override, the
// Bearer extraction, the getUser() identity resolution, or the 401-on-missing-
// auth path will turn this test RED.
//
// Contracts pinned (P9 RBAC / P13 cross-tenant isolation):
//   1. Missing/blank Authorization header → 401 before any handler dispatch.
//   2. No body-spoofing: guardian_id is resolved from the JWT (getUser → the
//      guardians row keyed by auth_user_id) and body.guardian_id is OVERRIDDEN,
//      never trusted, for every data action.
//   3. Action allow-list: an unknown/empty action is rejected with 400, not
//      silently processed.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

// Locate the top-level Deno.serve() handler body so ordering assertions are
// scoped to the dispatch boundary, not to unrelated helper functions above it.
const SERVE_IDX = SRC.indexOf('Deno.serve(');
const HANDLER = SRC.slice(SERVE_IDX);

// ─── 0. File shape sanity ────────────────────────────────────────────────────

Deno.test('parent-portal: is a Deno.serve() Edge Function (canary precondition)', () => {
  assert(SERVE_IDX > 0, 'expected a top-level Deno.serve( handler');
  // The handler is NOT exported — this is WHY we use a static canary. If a
  // future refactor exports it, switch this file to a behavioral mock test.
  assert(
    !/export\s+(async\s+)?function\s+handleRequest/.test(SRC),
    'handler appears to be exported now — prefer a behavioral mock test over the static canary',
  );
});

// ─── 1. Missing/blank Authorization header → 401 ─────────────────────────────

Deno.test('parent-portal contract 1: missing/blank Authorization → 401 before dispatch', () => {
  // Bearer guard exists.
  assert(
    /authHeader\?\.startsWith\(['"]Bearer ['"]\)/.test(HANDLER),
    'expected a `Bearer ` prefix guard on the Authorization header',
  );
  // The guard returns 401 (not 403/200) when the header is missing/invalid.
  assert(
    /if\s*\(\s*!authHeader\?\.startsWith\(['"]Bearer ['"]\)\s*\)\s*\{[\s\S]{0,160}?errorResponse\([^)]*401/.test(
      HANDLER,
    ),
    'expected `errorResponse(..., 401)` inside the missing-Bearer guard',
  );

  // The 401 auth guard must run BEFORE any action is dispatched to a handler.
  const authGuardIdx = HANDLER.indexOf("authHeader?.startsWith('Bearer ')");
  const firstHandlerCall = HANDLER.indexOf('handleParentLogin(');
  const switchIdx = HANDLER.indexOf('switch (action)');
  assert(authGuardIdx > 0, 'auth guard not found in handler');
  assert(firstHandlerCall > 0, 'expected handleParentLogin dispatch');
  assert(switchIdx > 0, 'expected action switch');
  assert(
    authGuardIdx < firstHandlerCall && authGuardIdx < switchIdx,
    'auth guard must precede ALL action dispatch (no data path before the 401 check)',
  );
});

// ─── 2. No body-spoofing: guardian_id resolved from the JWT ──────────────────

Deno.test('parent-portal contract 2a: identity resolved via supabase.auth.getUser(token)', () => {
  // Bearer token is sliced off the header and passed to getUser — identity is
  // derived from the cryptographically-verified JWT, not from the body.
  assertStringIncludes(HANDLER, 'authHeader.slice(7)');
  assert(
    /supabase\.auth\.getUser\(\s*token\s*\)/.test(HANDLER),
    'expected supabase.auth.getUser(token) to resolve caller identity',
  );
  // getUser failure → 401, no data returned.
  assert(
    /if\s*\(\s*authErr\s*\|\|\s*!user\s*\)\s*\{[\s\S]{0,120}?errorResponse\([^)]*401/.test(
      HANDLER,
    ),
    'expected 401 when getUser returns an error / no user',
  );
});

Deno.test('parent-portal contract 2b: body.guardian_id is OVERRIDDEN from the JWT-resolved guardian', () => {
  // The canonical guardian row is looked up by the JWT user.id...
  assert(
    /\.from\(['"]guardians['"]\)[\s\S]{0,160}?\.eq\(['"]auth_user_id['"]\s*,\s*authUserId\s*\)/.test(
      HANDLER,
    ),
    'expected the guardians row to be resolved by auth_user_id = JWT user.id',
  );
  // ...and then body.guardian_id is reassigned to it (the anti-spoof override).
  assert(
    /body\.guardian_id\s*=\s*guardian\.id/.test(HANDLER),
    'expected `body.guardian_id = guardian.id` — the JWT override that defeats body-supplied guardian_id spoofing',
  );

  // The override must happen BEFORE any data handler that reads guardian_id.
  const overrideIdx = HANDLER.indexOf('body.guardian_id = guardian.id');
  const dashboardDispatch = HANDLER.indexOf('handleGetChildDashboard(');
  const childrenDispatch = HANDLER.indexOf('handleGetChildren(');
  assert(overrideIdx > 0, 'JWT override of guardian_id not found');
  assert(dashboardDispatch > 0 && childrenDispatch > 0, 'data dispatches not found');
  assert(
    overrideIdx < dashboardDispatch && overrideIdx < childrenDispatch,
    'guardian_id override must precede every data handler dispatch',
  );

  // Defense-in-depth: the function must NOT read body.auth_user_id as a trust
  // source. The historical vuln (see the comment at ~line 1069) was trusting a
  // body-supplied auth_user_id. Assert it is never assigned FROM the body.
  assert(
    !/authUserId\s*=\s*[^;\n]*body\.auth_user_id/.test(HANDLER),
    'authUserId must be derived from the JWT, never from body.auth_user_id',
  );
});

// ─── 3. Action allow-list: unknown/empty action rejected ─────────────────────

Deno.test('parent-portal contract 3: unknown/empty action → 400 (not silently processed)', () => {
  // The switch has a default arm that 400s on an unknown action.
  assert(
    /default:\s*[\s\S]{0,120}?errorResponse\(\s*`Unknown action:[^`]*`\s*,\s*400/.test(
      HANDLER,
    ),
    'expected a default switch arm returning 400 `Unknown action: ...`',
  );

  // An empty action ('') is NOT 'parent_login' and falls through the switch to
  // the default 400 arm. Assert the only fast-path action is parent_login and
  // that it is gated on an exact equality (not a permissive prefix/includes).
  assert(
    /action\s*===\s*['"]parent_login['"]/.test(HANDLER),
    'expected an exact `action === "parent_login"` check (no loose matching)',
  );

  // The known data actions are dispatched only via explicit case labels — an
  // attacker-chosen string outside this set cannot reach a handler.
  for (const a of [
    'get_child_dashboard',
    'get_tips',
    'get_children',
    'get_monthly_report',
  ]) {
    assert(
      HANDLER.includes(`case '${a}':`),
      `expected explicit allow-list case for action '${a}'`,
    );
  }
});
