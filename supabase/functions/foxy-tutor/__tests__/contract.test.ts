// supabase/functions/foxy-tutor/__tests__/contract.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   deno test --no-lock --no-check --allow-read \
//     supabase/functions/foxy-tutor/__tests__/contract.test.ts
// (matches the `edge-function-tests` CI lane invocation in
//  .github/workflows/ci.yml — `--allow-read` only, no `--allow-env`/`--allow-net`
//  needed since this file never touches Deno.env and its only remote import,
//  the std assert module, is warmed into the Deno cache by the same lane that
//  runs every other Deno test target.)
//
// ── Approach: STATIC-SOURCE CONTRACT CANARY ──────────────────────────────────
// foxy-tutor/index.ts passes its handler inline to the std-lib `serve()`
// (imported from https://deno.land/std@0.168.0/http/server.ts), not the
// native `Deno.serve()`. Unlike send-auth-email's test (which stubs the
// native `Deno.serve` global to capture and directly invoke the real
// handler), a named import from a remote ES module cannot be monkey-patched
// from outside the importing module — there's no seam here. This is the
// SAME shape as scan-ocr / teacher-dashboard / bulk-jee-neet-import (un-
// exported inline handler, std/native serve() at module top level), and
// this repo's established answer for that shape is the static-source
// canary: read index.ts as text and assert the security-/contract-critical
// lines exist, in the right order, with nothing weakening them. Following
// that convention here rather than inventing a new one.
//
// Contracts pinned (P2-4a foxy-tutor tombstone, 2026-08-04):
//   0. index.ts is a serve() Edge Function (canary precondition).
//   1. Every non-OPTIONS request gets HTTP 410 Gone — no other status
//      literal appears anywhere in the file (defense against a future edit
//      silently reintroducing a 200/500 branch).
//   2. The 410 body carries `code: 'GONE'` and `canonical: '/api/foxy'`
//      (CANONICAL bound to the literal '/api/foxy', not composed from env).
//   3. OPTIONS is handled first and short-circuits to a CORS-only response
//      BEFORE the 410 body is ever constructed.
//   4. The function boots without any secrets/env/DB client — no
//      `Deno.env.get(...)`, no `createClient(`, no Supabase/JWT import — so
//      it can 410 even a caller with no valid auth at all (the whole point:
//      old APKs with stale/invalid tokens must still get a clean 410).
//   5. No PII is ever read or logged (P13): the request body is never read
//      (no `.json(`/`.text(`/`.formData(` on req), no `authorization`
//      header is referenced, and the one console line logs only the method
//      and a length-capped user-agent string.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

// ─── 0. File shape sanity ────────────────────────────────────────────────────

Deno.test('foxy-tutor: is a serve() Edge Function (canary precondition)', () => {
  assert(/\bserve\(\s*\(req/.test(SRC), 'expected a top-level serve((req) => …) handler');
  assert(
    !/export\s+(async\s+)?function/.test(SRC),
    'handler appears to be exported now — prefer a behavioral test (à la send-auth-email) over this static canary',
  );
});

// ─── 1. Every non-OPTIONS response is 410 — no other status literal exists ───

Deno.test('foxy-tutor contract 1: the tombstone response is HTTP 410 Gone', () => {
  assertStringIncludes(SRC, 'status: 410', 'the non-OPTIONS response must be status 410');
});

Deno.test('foxy-tutor contract 1b: no status literal other than 410 appears anywhere (P2-4a canary)', () => {
  const statusLiterals = SRC.match(/status:\s*\d{3}/g) ?? [];
  assertEquals(
    statusLiterals,
    ['status: 410'],
    `expected exactly one status literal (410) in the tombstone; found: ${JSON.stringify(statusLiterals)}. ` +
      'A future edit must not silently reintroduce a 200/4xx/5xx branch — every non-OPTIONS request must 410.',
  );
});

// ─── 2. Body shape: code GONE + canonical pointer ────────────────────────────

Deno.test('foxy-tutor contract 2: response body carries code: GONE', () => {
  assertStringIncludes(SRC, "code: 'GONE'", "the tombstone body must set code: 'GONE'");
});

Deno.test('foxy-tutor contract 2b: CANONICAL is the literal /api/foxy, not env-derived', () => {
  assert(
    /const\s+CANONICAL\s*=\s*'\/api\/foxy'/.test(SRC),
    "expected `const CANONICAL = '/api/foxy'` — the replacement route must be a fixed literal, not read from Deno.env",
  );
  assertStringIncludes(SRC, 'canonical: CANONICAL', 'the response body must expose the canonical pointer as `canonical`');
});

// ─── 3. OPTIONS is handled first and short-circuits before the 410 body ─────

Deno.test('foxy-tutor contract 3: OPTIONS short-circuits to a CORS-only response before the 410 body', () => {
  const optionsIdx = SRC.indexOf("req.method === 'OPTIONS'");
  const goneIdx = SRC.indexOf("code: 'GONE'");
  assert(optionsIdx > 0, "expected an `if (req.method === 'OPTIONS')` guard");
  assert(goneIdx > 0, "expected the code: 'GONE' body to exist");
  assert(optionsIdx < goneIdx, 'the OPTIONS guard must be checked BEFORE the 410 body is constructed');

  // The OPTIONS branch itself must be a bare CORS response — no status
  // override (so it defaults to 200) and no JSON body.
  const optionsBranch = SRC.slice(optionsIdx, goneIdx);
  assert(
    /new Response\(\s*null\s*,\s*\{\s*headers:\s*corsHeaders\s*\}\s*\)/.test(optionsBranch),
    'expected the OPTIONS branch to return `new Response(null, { headers: corsHeaders })` with no status override and no body',
  );
});

// ─── 4. No secrets/DB/auth needed to boot or to serve a 410 ──────────────────

Deno.test('foxy-tutor contract 4: boots and serves without any env, DB client, or auth check', () => {
  assert(!/Deno\.env\.get\(/.test(SRC), 'must not read any Deno.env var — the tombstone must 410 with zero configuration');
  assert(!/createClient\(/.test(SRC), 'must not construct a Supabase client — no DB dependency for a tombstone');
  assert(!/supabase-js/.test(SRC), 'must not import the Supabase client library at all');
  assert(
    !/authorization/i.test(SRC),
    'must not inspect the Authorization header — old/invalid-token callers must still get a clean 410, not a 401',
  );
});

// ─── 5. No PII is ever read or logged (P13) ──────────────────────────────────

Deno.test('foxy-tutor contract 5: the request body is never read', () => {
  assert(!/req\.json\(/.test(SRC), 'must not call req.json() — no body parsing at all');
  assert(!/req\.text\(/.test(SRC), 'must not call req.text() — no body parsing at all');
  assert(!/req\.formData\(/.test(SRC), 'must not call req.formData() — no body parsing at all');
});

Deno.test('foxy-tutor contract 5b: the single log line carries only method + capped user-agent, nothing else', () => {
  const logLines = SRC.match(/console\.(warn|log|error|info)\([^)]*\)/gs) ?? [];
  assertEquals(logLines.length, 1, `expected exactly one console.* call; found ${logLines.length}: ${JSON.stringify(logLines)}`);
  const line = logLines[0];
  assertStringIncludes(line, 'req.method', 'log line must include the request method');
  assertStringIncludes(line, 'userAgent', 'log line must include the (already-capped) userAgent variable');
  // Belt-and-braces: the log line itself must not reference any PII-shaped
  // source (email/phone/token/authorization/body), even indirectly.
  assert(
    !/email|phone|token|authorization|req\.body/i.test(line),
    `log line must not reference any PII-shaped field: ${line}`,
  );
});

Deno.test('foxy-tutor contract 5c: the logged user-agent is length-capped', () => {
  assert(
    /user-agent'\)\s*\|\|\s*'unknown'\)\.slice\(\s*0\s*,\s*120\s*\)/.test(SRC),
    'the user-agent read from headers must be capped (.slice(0, 120)) before it is ever logged',
  );
});
