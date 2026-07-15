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
// No real network call is ever made at runtime: the send-path tests inject a
// stub EmailTransport via setDefaultEmailTransport(), so the relay never opens
// a socket.
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
// binding a socket. Because the module reads its config (hook secret, relay
// creds) from Deno.env at LOAD time, we re-import it with a cache-busting query
// string for each env scenario (missing-secret vs configured). This exercises
// the REAL handler logic — signature verification, payload validation, relay
// dispatch, and the top-level catch — not a static-source canary.

import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { setDefaultEmailTransport } from '../../_shared/relay-mailer.ts';
import { authEmailTokenDimension } from '../../_shared/auth-email-links.ts';
import { createEmailIdempotencyKey } from '../../_shared/reliability.ts';

type Handler = (req: Request) => Promise<Response> | Response;

// A valid standardwebhooks symmetric secret. The part after `whsec_` must be
// base64. index.ts strips a leading `v1,` (Supabase's storage format) before
// constructing the Webhook; we pass the bare `whsec_...` form here.
const SECRET = 'whsec_' + btoa('alfanumrik-send-auth-email-test-secret');

// Product decision 2026-07-15: Mailgun is the email provider. index.ts resolves
// its config guard from MAILGUN_API_KEY + MAILGUN_DOMAIN only (it no longer reads
// RESEND_API_KEY). Every scenario key below is cleared before the scenario env is
// applied so an ambient MAILGUN_* (e.g. on a dev/prod-shaped machine) can never
// leak into the "no relay config" path and flip it green→red. RESEND_API_KEY is
// kept in the clear-list purely as belt-and-braces (index.ts ignores it) so a
// stray ambient value can never influence a scenario.
const ENV_KEYS = ['SEND_EMAIL_HOOK_SECRET', 'RESEND_API_KEY', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'SITE_URL'];

const realServe = Deno.serve;
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

// Mailgun is the configured transport (product decision 2026-07-15). Setting
// MAILGUN_API_KEY + MAILGUN_DOMAIN makes index.ts's config guard fall through to
// the send path, where the injected stub transport (setDefaultEmailTransport)
// handles the dispatch — no socket is ever opened.
const CONFIGURED = {
  SEND_EMAIL_HOOK_SECRET: SECRET,
  MAILGUN_API_KEY: 'key-mg-test-0001',
  MAILGUN_DOMAIN: 'mg.alfanumrik.test',
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
    // No SEND_EMAIL_HOOK_SECRET configured. Mailgun IS configured, proving the
    // 200-with-warning here comes from the missing hook secret, not the relay.
    MAILGUN_API_KEY: 'key-mg-test-0001',
    MAILGUN_DOMAIN: 'mg.alfanumrik.test',
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

// ─── Path 6: relay send FAILURE → 200 (success:false, auth proceeds) ─────────
Deno.test('send-auth-email: relay send failure returns 200 with success:false', async () => {
  const handler = await loadHandler(CONFIGURED);
  // Inject a stub transport that reports a PII-free failure code — no socket
  // is opened, and fetchWithTimeout is never reached.
  setDefaultEmailTransport({
    name: 'stub-fail',
    send: () => Promise.resolve({ success: false, provider: 'mailgun', code: 'mailgun_http_400' }),
  });
  try {
    const res = await handler(signedRequest(validPayloadBody()));
    assertEquals(res.status, 200, 'email-provider failure must NOT block signup');
    const body = await res.json();
    assertEquals(body.success, false, 'send failed → success:false but still 200');
  } finally {
    setDefaultEmailTransport(null);
  }
});

// ─── Path 7: relay send SUCCESS → 200 (success:true) ────────────────────────
Deno.test('send-auth-email: relay send success returns 200 with success:true', async () => {
  const handler = await loadHandler(CONFIGURED);
  setDefaultEmailTransport({
    name: 'stub-ok',
    send: () => Promise.resolve({ success: true, provider: 'mailgun', id: 'mailgun-msg-uuid-0001' }),
  });
  try {
    const res = await handler(signedRequest(validPayloadBody()));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  } finally {
    setDefaultEmailTransport(null);
  }
});

// ─── Path 8: no relay config → 200 (defers to Supabase built-in email) ───────
Deno.test('send-auth-email: missing relay config returns 200 (no_relay_config)', async () => {
  const handler = await loadHandler({
    SEND_EMAIL_HOOK_SECRET: SECRET,
    // No MAILGUN_* → Mailgun (the email provider) is unconfigured → no transport.
  });
  const res = await handler(signedRequest(validPayloadBody()));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.warning, 'no_relay_config');
});

// ─── Path 8b: Mailgun configured → send is ATTEMPTED via Mailgun ─────────────
// Product decision 2026-07-15: Mailgun is the email provider. When MAILGUN_API_KEY
// + MAILGUN_DOMAIN are set the config guard must NOT short-circuit to
// no_relay_config — it must fall through to the Mailgun send path. We inject a
// stub transport (no socket) to prove the guard let the send through; the stub's
// success surfaces as success:true, still HTTP 200. Resend is never auto-selected.
Deno.test('send-auth-email: Mailgun config attempts send via Mailgun (no no_relay_config)', async () => {
  const handler = await loadHandler({
    SEND_EMAIL_HOOK_SECRET: SECRET,
    // Mailgun is the configured (and only) transport — no RESEND_API_KEY needed.
    MAILGUN_API_KEY: 'key-mg-test-0001',
    MAILGUN_DOMAIN: 'mg.alfanumrik.test',
  });
  setDefaultEmailTransport({
    name: 'stub-mailgun',
    send: () => Promise.resolve({ success: true, provider: 'mailgun', id: 'mg-msg-uuid-0001' }),
  });
  try {
    const res = await handler(signedRequest(validPayloadBody()));
    assertEquals(res.status, 200);
    const body = await res.json();
    // Guard fell through to the send path (NOT the no_relay_config short-circuit).
    assertEquals(body.success, true, 'Mailgun config must attempt the send, not warn no_relay_config');
    assertEquals(body.warning, undefined, 'no_relay_config must NOT fire when Mailgun is configured');
  } finally {
    setDefaultEmailTransport(null);
  }
});

// ─── Path 8c: Mailgun key WITHOUT domain → treated as unconfigured (no_relay_config)
// The Mailgun transport needs BOTH MAILGUN_API_KEY and MAILGUN_DOMAIN. A key
// without a domain is not a usable transport, so the guard must still degrade to
// no_relay_config (→ 200, Supabase built-in email can take over).
Deno.test('send-auth-email: Mailgun key without domain still returns 200 (no_relay_config)', async () => {
  const handler = await loadHandler({
    SEND_EMAIL_HOOK_SECRET: SECRET,
    MAILGUN_API_KEY: 'key-mg-test-0001',
    // No MAILGUN_DOMAIN.
  });
  const res = await handler(signedRequest(validPayloadBody()));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.warning, 'no_relay_config');
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

// ─── Token-varying idempotency key (REQUIRED P15 fix) ────────────────────────
// The relay sets an Idempotency-Key on the send (Mailgun is the email provider —
// product decision 2026-07-15). index.ts folds the per-auth token into the key
// via createEmailIdempotencyKey({ correlationId: authEmailTokenDimension(...) }).
// Both helpers are pure + exported, so we assert the contract directly (no
// handler, no transport):
//   - SAME token twice → SAME key  (a genuine retry dedupes, no double-send)
//   - DISTINCT tokens  → DISTINCT keys (a re-requested confirm/reset SENDS)

const IDEMPOTENCY_BASE = {
  template: 'auth_email',
  recipient: 'aarav.student@example.com',
  subject: 'Verify your Alfanumrik account | अपना Alfanumrik खाता सत्यापित करें',
};

Deno.test('send-auth-email: same token twice produces the SAME idempotency key (genuine retry dedupe)', () => {
  const dim = authEmailTokenDimension({ token: 'tok-123', tokenHash: 'hash-abc-123' });
  const key1 = createEmailIdempotencyKey({ ...IDEMPOTENCY_BASE, correlationId: dim });
  const key2 = createEmailIdempotencyKey({ ...IDEMPOTENCY_BASE, correlationId: dim });
  assertEquals(key1, key2, 'same token must yield the same key so the provider dedupes a genuine retry');
});

Deno.test('send-auth-email: two distinct tokens produce TWO DISTINCT idempotency keys (re-requested links send)', () => {
  const keyA = createEmailIdempotencyKey({
    ...IDEMPOTENCY_BASE,
    correlationId: authEmailTokenDimension({ token: 'tokA', tokenHash: 'hashA' }),
  });
  const keyB = createEmailIdempotencyKey({
    ...IDEMPOTENCY_BASE,
    correlationId: authEmailTokenDimension({ token: 'tokB', tokenHash: 'hashB' }),
  });
  assert(keyA !== keyB, 'distinct tokens must yield distinct keys so re-requested confirmations actually send');
});

Deno.test('send-auth-email: authEmailTokenDimension prefers tokenHash and folds in the email-change new token', () => {
  // tokenHash wins over token.
  assertEquals(
    authEmailTokenDimension({ token: 't', tokenHash: 'th' }),
    authEmailTokenDimension({ tokenHash: 'th' }),
    'tokenHash must be preferred over token',
  );
  // Email-change new token widens the dimension → distinct key from a plain confirm.
  const change = authEmailTokenDimension({ tokenHash: 'th', tokenHashNew: 'thn' });
  assert(change.includes('thn'), 'email-change new token must be folded into the dimension');
  assert(
    change !== authEmailTokenDimension({ tokenHash: 'th' }),
    'email-change dimension must differ from the plain-confirm dimension',
  );
});
