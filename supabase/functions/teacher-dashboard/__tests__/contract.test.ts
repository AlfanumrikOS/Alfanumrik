// supabase/functions/teacher-dashboard/__tests__/contract.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   cd supabase/functions/teacher-dashboard && deno test --allow-read
// (--allow-all also works, matching the sibling alfabot-answer / grounded-answer
//  invocation; these tests only read the local file system, never the network.)
//
// ── Approach: STATIC-SOURCE CONTRACT CANARY ──────────────────────────────────
// teacher-dashboard/index.ts is a MONOLITHIC Deno.serve() handler: the request
// handler is passed inline to Deno.serve() at module top level and is NOT
// exported, and the Supabase client is built from a top-level esm.sh import
// (`createClient` + `getServiceClient()`). The JWT→teacher resolution lives in
// `resolveTeacherFromJwt()` which is also un-exported and calls the real
// service client. There is no seam to inject a mocked Supabase client, so the
// handler cannot be imported and invoked in a behavioral test the way
// alfabot-answer's exported `handleRequest` can.
//
// We therefore use the same strategy bulk-jee-neet-import uses for its
// un-mockable Deno.serve() handler: read index.ts as text and assert the
// security-critical control-flow lines exist and are ordered correctly.
//
// Contracts pinned (P9 RBAC / P13 cross-tenant isolation):
//   1. Missing/blank Authorization header → 401 before any handler dispatch.
//   2. No body-spoofing: teacher_id is resolved from the JWT (getUser → the
//      teachers row keyed by auth_user_id) and body.teacher_id is OVERRIDDEN,
//      never trusted, for every action.
//   3. Action allow-list: an unknown/empty action is rejected with 400, not
//      silently processed.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

// The JWT binding lives in resolveTeacherFromJwt(); dispatch lives in the
// top-level Deno.serve(). We scope ordering checks to the serve() body and
// content checks to the whole file (the binding helper is defined just above).
const SERVE_IDX = SRC.indexOf('Deno.serve(');
const HANDLER = SRC.slice(SERVE_IDX);

// ─── 0. File shape sanity ────────────────────────────────────────────────────

Deno.test('teacher-dashboard: is a Deno.serve() Edge Function (canary precondition)', () => {
  assert(SERVE_IDX > 0, 'expected a top-level Deno.serve( handler');
  assert(
    !/export\s+(async\s+)?function\s+handleRequest/.test(SRC),
    'handler appears to be exported now — prefer a behavioral mock test over the static canary',
  );
});

// ─── 1. Missing/blank Authorization header → 401 ─────────────────────────────

Deno.test('teacher-dashboard contract 1: missing/blank Authorization → 401 before dispatch', () => {
  // Bearer guard + 401 live in resolveTeacherFromJwt.
  assert(
    /authHeader\?\.startsWith\(['"]Bearer ['"]\)/.test(SRC),
    'expected a `Bearer ` prefix guard on the Authorization header',
  );
  assert(
    /if\s*\(\s*!authHeader\?\.startsWith\(['"]Bearer ['"]\)\s*\)\s*\{[\s\S]{0,200}?errorResponse\([^)]*401/.test(
      SRC,
    ),
    'expected `errorResponse(..., 401)` inside the missing-Bearer guard',
  );

  // The dispatcher must call the JWT binding and bail on its errorResponse
  // BEFORE reaching the action switch — no data path before the 401 check.
  const resolveCall = HANDLER.indexOf('resolveTeacherFromJwt(req, origin)');
  const bailLine = HANDLER.indexOf("if ('errorResponse' in auth) return auth.errorResponse");
  const switchIdx = HANDLER.indexOf('switch (action)');
  assert(resolveCall > 0, 'expected resolveTeacherFromJwt(req, origin) call in dispatcher');
  assert(bailLine > 0, 'expected the dispatcher to return auth.errorResponse on failure');
  assert(switchIdx > 0, 'expected action switch');
  assert(
    resolveCall < bailLine && bailLine < switchIdx,
    'JWT binding + 401/403 bail must precede the action switch (no handler runs before auth)',
  );
});

// ─── 2. No body-spoofing: teacher_id resolved from the JWT ───────────────────

Deno.test('teacher-dashboard contract 2a: identity resolved via supabase.auth.getUser(token)', () => {
  assertStringIncludes(SRC, 'authHeader.slice(7)');
  assert(
    /supabase\.auth\.getUser\(\s*token\s*\)/.test(SRC),
    'expected supabase.auth.getUser(token) to resolve caller identity',
  );
  // getUser failure → 401, no data returned.
  assert(
    /if\s*\(\s*authErr\s*\|\|\s*!user\s*\)\s*\{[\s\S]{0,160}?errorResponse\([^)]*401/.test(
      SRC,
    ),
    'expected 401 when getUser returns an error / no user',
  );
});

Deno.test('teacher-dashboard contract 2b: body.teacher_id is OVERRIDDEN from the JWT-resolved teacher', () => {
  // The canonical teacher row is looked up by the JWT user.id...
  assert(
    /\.from\(['"]teachers['"]\)[\s\S]{0,160}?\.eq\(['"]auth_user_id['"]\s*,\s*user\.id\s*\)/.test(
      SRC,
    ),
    'expected the teachers row to be resolved by auth_user_id = JWT user.id',
  );
  // resolveTeacherFromJwt returns the JWT-derived teacherId...
  assert(
    /return\s*\{\s*teacherId:\s*teacher\.id\s*\}/.test(SRC),
    'expected resolveTeacherFromJwt to return { teacherId: teacher.id }',
  );
  // ...and the dispatcher overrides body.teacher_id with it (the anti-spoof override).
  assert(
    /body\.teacher_id\s*=\s*auth\.teacherId/.test(HANDLER),
    'expected `body.teacher_id = auth.teacherId` — the JWT override that defeats body-supplied teacher_id spoofing',
  );

  // The override must happen BEFORE any handler in the switch reads teacher_id.
  const overrideIdx = HANDLER.indexOf('body.teacher_id = auth.teacherId');
  const switchIdx = HANDLER.indexOf('switch (action)');
  assert(overrideIdx > 0, 'JWT override of teacher_id not found');
  assert(switchIdx > 0, 'action switch not found');
  assert(
    overrideIdx < switchIdx,
    'teacher_id override must precede the action switch (every handler sees the trusted value)',
  );

  // If getUser succeeds but the caller is not a registered teacher → 403,
  // never a fall-through that would let a non-teacher reach a handler.
  assert(
    /if\s*\(\s*!teacher\s*\)\s*\{[\s\S]{0,160}?errorResponse\([^)]*403/.test(SRC),
    'expected 403 when the JWT user has no teachers row',
  );
});

// ─── 3. Action allow-list: unknown/empty action rejected ─────────────────────

Deno.test('teacher-dashboard contract 3: unknown/empty action → 400 (not silently processed)', () => {
  // The switch has a default arm that 400s on an unknown action.
  assert(
    /default:\s*[\s\S]{0,120}?errorResponse\(\s*`Unknown action:[^`]*`\s*,\s*400/.test(
      HANDLER,
    ),
    'expected a default switch arm returning 400 `Unknown action: ...`',
  );

  // Spot-check a representative slice of the explicit case allow-list. An
  // attacker-chosen string outside this set hits `default` and 400s.
  for (const a of [
    'get_dashboard',
    'get_alerts',
    'resolve_alert',
    'set_grade_book_cell',
    'deploy_intervention',
  ]) {
    assert(
      HANDLER.includes(`case '${a}':`),
      `expected explicit allow-list case for action '${a}'`,
    );
  }

  // No permissive matching that could let an empty/unknown action through:
  // action is read with String(body.action || '') and only dispatched via the
  // exact-match switch.
  assert(
    /const\s+action\s*=\s*String\(\s*body\.action\s*\|\|\s*['"]['"]\s*\)/.test(HANDLER),
    'expected action read as String(body.action || "") with exact-match switch dispatch',
  );
});

Deno.test('teacher-dashboard action module exposes auth, tenant, audit and metric labels for every public action', async () => {
  const { teacherDashboardActionNames, teacherDashboardActions } = await import('../actions.ts');
  const switchActions = [...HANDLER.matchAll(/case '([^']+)'/g)].map((match) => match[1]);
  assertEquals(teacherDashboardActionNames, switchActions);
  for (const name of teacherDashboardActionNames) {
    const action = teacherDashboardActions[name];
    assertEquals(action.name, name);
    assertEquals(action.requiresJwtTeacherBinding, true);
    assertEquals(action.requiresTenantTeacherBinding, true);
    assertEquals(action.auditLabel, `teacher_dashboard.${name}`);
    assertEquals(action.metricLabel, `teacher_dashboard.${name}`);
  }
});
