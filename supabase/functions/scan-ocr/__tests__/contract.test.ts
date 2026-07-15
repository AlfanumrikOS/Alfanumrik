// supabase/functions/scan-ocr/__tests__/contract.test.ts
//
// Deno test runner (NOT Vitest). Run via:
//   cd supabase/functions/scan-ocr && deno test --allow-read
//
// ── STATIC-SOURCE CONTRACT CANARY ────────────────────────────────────────────
// scan-ocr is a serve()/Deno.serve() handler with an un-exported inline request
// handler and top-level esm.sh imports — the same shape as teacher-dashboard /
// bulk-jee-neet-import, so we use the repo's static-source canary strategy:
// read index.ts as text and assert the security-critical control-flow holds.
//
// WHY THIS EXISTS (regression pinned)
// ===================================
// 2026-07-13, edge-auth sweep: scan-ocr returned HTTP 500 to an unauthenticated
// request while its sibling ncert-solver returned a structured 401. Root cause:
// the handler called `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)` at the
// TOP of the handler, but neither constant was DECLARED anywhere in the file —
// a ReferenceError that threw on EVERY request (auth or not), BEFORE admitAiRoute
// could run, and OUTSIDE the try/catch, surfacing as a bare 500. The function was
// effectively down for all callers.
//
// Contracts pinned:
//   1. SUPABASE_URL and SUPABASE_SERVICE_KEY are DECLARED (const) — not just used.
//   2. Each is bound from Deno.env (service-role connection), matching ncert-solver.
//   3. admitAiRoute() is invoked (the Platform Security Layer admission that
//      returns the structured 401/403 for unauthenticated / wrong-caller requests).
//   4. The createClient(...) that feeds admitAiRoute is not left referencing an
//      undeclared identifier (belt-and-braces against the exact regression).

import {
  assert,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

Deno.test('scan-ocr: is a serve() Edge Function (canary precondition)', () => {
  assert(/serve\(\s*async\s*\(req/.test(SRC), 'expected a serve(async (req) => …) handler');
});

Deno.test('scan-ocr contract 1: SUPABASE_URL is declared, not just referenced', () => {
  assert(
    /(?:const|let|var)\s+SUPABASE_URL\s*=/.test(SRC),
    'SUPABASE_URL must be DECLARED — an undeclared reference throws a ReferenceError before any auth guard (2026-07-13 500 regression)',
  );
});

Deno.test('scan-ocr contract 2: SUPABASE_SERVICE_KEY is declared and bound from Deno.env', () => {
  assert(
    /(?:const|let|var)\s+SUPABASE_SERVICE_KEY\s*=/.test(SRC),
    'SUPABASE_SERVICE_KEY must be DECLARED',
  );
  assertStringIncludes(
    SRC,
    "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')",
    'SUPABASE_SERVICE_KEY should bind the service-role key from the environment',
  );
});

Deno.test('scan-ocr contract 3: admission guard (admitAiRoute) is invoked', () => {
  assertStringIncludes(
    SRC,
    'admitAiRoute(',
    'the Platform Security Layer admission must run so unauthenticated requests get a structured 401, not a 500',
  );
});

Deno.test('scan-ocr contract 4: the admission client is built before admitAiRoute', () => {
  const clientIdx = SRC.indexOf('createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  const admitIdx = SRC.indexOf('admitAiRoute(');
  assert(clientIdx > 0, 'expected createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) feeding admission');
  assert(admitIdx > clientIdx, 'admitAiRoute must run after the service-role client is constructed');
});
