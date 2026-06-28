// supabase/functions/send-auth-email/__tests__/always-200.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   deno test --allow-read --allow-env --allow-net \
//     supabase/functions/send-auth-email/__tests__/always-200.test.ts
//
// `--allow-net` is only needed on a COLD cache to fetch the esm.sh
// `standardwebhooks` module once. After `deno cache` warms it, the test runs
// offline with just `--allow-read --allow-env` (matching the permission set of
// the existing `edge-function-tests` CI lane in .github/workflows/ci.yml).
// No real network call is ever made at runtime: the Mailgun HTTP call is
// intercepted by stubbing globalThis.fetch.
//
// ── AO-1: the P15 "always return HTTP 200" invariant, now EXECUTABLE ─────────
// P15 rule 1 (CLAUDE.md / .claude/CLAUDE.md): send-auth-email MUST return HTTP
// 200 on ALL code paths. Supabase Auth treats a non-200 from a Send-Email hook
// as a failure and BLOCKS the entire auth operation (signup / reset / magic
// link). A regression that returns non-200 silently breaks ALL signups.
//
// Until this file existed, the only "coverage" was a vacuous always-true
// marker in e2e/auth-onboarding-p15.spec.ts pointing at a unit group
// (`send_auth_email_always_200` in src/__tests__/auth-onboarding.test.ts) that
// was NEVER written (audit gap AO-1). This test replaces that false-green.
//
// ── Approach: capture the Deno.serve() handler, invoke it directly ───────────
// index.ts passes its request handler inline to Deno.serve() at module top
// level and does NOT export it. We stub Deno.serve BEFORE importing the module
// so the top-level `Deno.serve(handler)` call hands us the handler instead of
// binding a socket. Because the module reads its config (hook secret, Mailgun
// creds) from Deno.env at LOAD time, we re-import it with a cache-busting query
// string for each env scenario (missing-secret vs configured). This exercises
// the REAL handler logic — signature verification, payload validation, Mailgun
// dispatch, and the top-level catch — not a static-source canary.

import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

type Handler = (req: Request) => Promise<Response> | Response;

// A valid standardwebhooks symmetric secret. The part after `whsec_` must be
// base64. index.ts strips a leading `v1,` (Supabase's storage format) before
// constructing the Webhook; we pass the bare `whsec_...` form here.
const SECRET = 'whsec_' + btoa('alfanumrik-send-auth-email-test-secret');

const ENV_KEYS = ['SEND_EMAIL_HOOK_SECRET', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'SITE_URL'];

const realServe = Deno.serve;
const realFetch = globalThis.fetch;
let cacheBust = 0;

/**
 * Set the given env, stub Deno.serve to capture the handler, then freshly
 * (re-)evaluate index.ts so it reads THIS env at module load. Returns the
 * captured request handler.
 */
async function loadHandler(env: Record<string, string>): Promise<Handler> {
  for (const k of ENV_KEYS) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

  let captured: Handler | null = null;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (handler: Handler) => {
    captured = handler;
    // Return a minimal HttpServer-shaped object; the module ignores it.
    return {
      finished: Promise.resolve(),
      shutdown: () => Promise.resolve(),
      ref() {},
      unref() {},
      addr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 },
    };
  };

  try {
    await import(new URL(`../index.ts?cb=${cacheBust++}`, import.meta.url).href);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }

  assert(captured, 'index.ts did not call Deno.serve() — handler not captured');
  return captured;
}

/** A well-formed signup email payload that passes the user/email_data guard. */
function validPayloadBody() {
  return {
    user: { email: 'aarav.student@example.com' },
    email_data: {
      token: 'tok-123',
      token_hash: 'hash-abc-123',
      redirect_to: '/dashboard',
      email_action_type: 'signup',
      site_url: 'https://supabase.example',
      token_new: '',
      token_hash_new: '',
    },
  };
}

/**
 * Build a POST Request signed with `signingSecret` so the handler's
 * standardwebhooks verification (keyed by `SECRET` in env) passes when
 * signingSecret === SECRET, and FAILS when it differs (bad-signature path).
 */
function signedRequest(body: unknown, signingSecret = SECRET): Request {
  const payload = JSON.stringify(body);
  const wh = new Webhook(signingSecret);
  const id = 'msg_test_0001';
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, payload);
  const headers = new Headers({
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'webhook-signature': signature,
  });
  return new Request('http://localhost/functions/v1/send-auth-email', {
    method: 'POST',
    headers,
    body: payload,
  });
}

const CONFIGURED = {
  SEND_EMAIL_HOOK_SECRET: SECRET,
  MAILGUN_API_KEY: 'key-test-mailgun',
  MAILGUN_DOMAIN: 'mg.alfanumrik.com',
  SITE_URL: 'https://alfanumrik.test',
};

// ─── Path 1: non-POST method → 200 ──────────────────────────────────────────
Deno.test('send-auth-email: non-POST method returns 200 (must not block auth)', async () => {
  const handler = await loadHandler(CONFIGURED);
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 200, 'GET must return 200, not 405');
  const body = await res.json();
  assertEquals(body.error, 'Method not allowed');
});

// ─── Path 2: OPTIONS preflight → 200 ────────────────────────────────────────
Deno.test('send-auth-email: OPTIONS preflight returns 200', async () => {
  const handler = await loadHandler(CONFIGURED);
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
});

// ─── Path 3: missing webhook secret → 200 (fail-soft, auth proceeds) ─────────
Deno.test('send-auth-email: missing hook secret returns 200 with warning', async () => {
  const handler = await loadHandler({
    // No SEND_EMAIL_HOOK_SECRET configured.
    MAILGUN_API_KEY: 'key-test-mailgun',
    MAILGUN_DOMAIN: 'mg.alfanumrik.com',
  });
  const res = await handler(signedRequest(validPayloadBody()));
  assertEquals(res.status, 200, 'unconfigured secret must NOT block signup');
  const body = await res.json();
  assertEquals(body.success, false);
  assert(typeof body.warning === 'string', 'expected a warning field');
});

// ─── Path 4: bad signature → 200 (verification fails, auth proceeds) ─────────
Deno.test('send-auth-email: invalid webhook signature returns 200 with warning', async () => {
  const handler = await loadHandler(CONFIGURED);
  // Sign with a DIFFERENT secret so verification against env SECRET fails.
  const wrongSecret = 'whsec_' + btoa('a-totally-different-secret-value');
  const res = await handler(signedRequest(validPayloadBody(), wrongSecret));
  assertEquals(res.status, 200, 'signature mismatch must NOT block signup');
  const body = await res.json();
  assertEquals(body.success, false);
  assert(typeof body.warning === 'string', 'expected a warning field');
});

// ─── Path 5: malformed / invalid payload → 200 ──────────────────────────────
Deno.test('send-auth-email: valid signature but missing user/email_data returns 200', async () => {
  const handler = await loadHandler(CONFIGURED);
  // Correctly signed, but the body has no user.email and null email_data —
  // hits the `if (!user?.email || !email_data)` guard.
  const res = await handler(signedRequest({ user: {}, email_data: null }));
  assertEquals(res.status, 200, 'invalid payload must NOT block signup');
  const body = await res.json();
  assertEquals(body.error, 'Invalid payload');
});

// ─── Path 6: Mailgun send FAILURE → 200 (success:false, auth proceeds) ───────
Deno.test('send-auth-email: Mailgun send failure returns 200 with success:false', async () => {
  const handler = await loadHandler(CONFIGURED);
  // Stub the Mailgun HTTP call to a non-retryable 400 so no real network call
  // is made and fetchWithTimeout returns immediately (no retry backoff).
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('Mailgun rejected: domain not verified', { status: 400 }),
    )) as typeof fetch;
  try {
    const res = await handler(signedRequest(validPayloadBody()));
    assertEquals(res.status, 200, 'email-provider failure must NOT block signup');
    const body = await res.json();
    assertEquals(body.success, false, 'send failed → success:false but still 200');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Path 7: Mailgun send SUCCESS → 200 (success:true) ──────────────────────
Deno.test('send-auth-email: Mailgun send success returns 200 with success:true', async () => {
  const handler = await loadHandler(CONFIGURED);
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: '<mailgun-msg-id@mg.alfanumrik.com>' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
  try {
    const res = await handler(signedRequest(validPayloadBody()));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Path 8: no Mailgun config → 200 (defers to Supabase built-in email) ─────
Deno.test('send-auth-email: missing Mailgun config returns 200 (no_mailgun_config)', async () => {
  const handler = await loadHandler({
    SEND_EMAIL_HOOK_SECRET: SECRET,
    // No MAILGUN_API_KEY / MAILGUN_DOMAIN.
  });
  const res = await handler(signedRequest(validPayloadBody()));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.warning, 'no_mailgun_config');
});

// ─── Path 9: unexpected throw inside the try block → 200 (top-level catch) ───
Deno.test('send-auth-email: unexpected throw is caught and returns 200', async () => {
  const handler = await loadHandler(CONFIGURED);
  // A POST whose .text() rejects forces the very first await in the try block
  // to throw, exercising the outer catch (index.ts:347-353).
  const throwingReq = {
    method: 'POST',
    headers: new Headers(),
    text: () => Promise.reject(new Error('stream read boom')),
  } as unknown as Request;
  const res = await handler(throwingReq);
  assertEquals(res.status, 200, 'a thrown error must NEVER block signup');
  const body = await res.json();
  assertEquals(body.success, false);
});

// ─── Meta: assert no NON-200 status literal can sneak into a response ────────
// Defense-in-depth structural canary alongside the behavioral paths above:
// every `new Response(...)` in index.ts must carry `status: 200`. If a future
// edit introduces `status: 4xx`/`status: 5xx`, this turns red even for a path
// the behavioral tests above don't enumerate.
Deno.test('send-auth-email: source contains no non-200 Response status (P15 canary)', () => {
  const src = Deno.readTextFileSync(new URL('../index.ts', import.meta.url));
  const nonOk = src.match(/status:\s*(?!200\b)\d{3}/g);
  assertEquals(
    nonOk,
    null,
    `index.ts must only ever respond with status: 200 (P15). Found: ${JSON.stringify(nonOk)}`,
  );
});
