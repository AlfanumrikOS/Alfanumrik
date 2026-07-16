// supabase/functions/_shared/__tests__/gmail-transport.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts includes only exact-path
// vitest files from this directory, so the npm suite is unaffected). Run via:
//   deno test --no-lock --no-check --allow-read --allow-env \
//     supabase/functions/_shared/__tests__/gmail-transport.test.ts
//
// Offline unit tests for the Gmail API transport (product decision 2026-07-16:
// Google Workspace is the email provider after Mailgun disabled the company
// account). NO socket is ever opened: every test injects a recording `fetcher`
// into createGmailTransport, and the RSA key used for the (real) RS256 JWT
// signing is generated in-process with WebCrypto. Wire shapes under test were
// verified against the live Google docs:
//   https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
//   https://developers.google.com/identity/protocols/oauth2/service-account
//
// Covered:
//   1. Token request shape — POST to the Google token URL with
//      grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer and an assertion
//      whose decoded claims carry iss/sub/scope/aud (+1h expiry) and whose
//      header says RS256/JWT. Signatures are NOT verified (that's Google's job).
//   2. Token caching — a second send reuses the cached access token (exactly
//      one token exchange for two message sends).
//   3. MIME — the base64url `raw` decodes to a multipart/alternative message
//      with BOTH text and html parts (base64 UTF-8, Hindi survives), an RFC
//      2047 encoded UTF-8 subject, and the X-Idempotency-Key correlation header.
//   4. Result mapping — Gmail `{ id }` → EmailSendResult.id on success;
//      gmail_http_<status> on HTTP failure; gmail_exception on a thrown
//      fetcher; gmail_auth_failed on a token-endpoint failure.
//   5. P13 — no console line emitted during a send carries the private key,
//      the access token, the signed JWT, or the full recipient address.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  clearGmailTokenCacheForTests,
  createGmailTransport,
  type EmailMessage,
} from '../relay-mailer.ts';

// ─── Test key material (generated in-process — never a real secret) ──────────

async function generateTestPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < pkcs8.length; i += CHUNK) {
    binary += String.fromCharCode(...pkcs8.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary).match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

// Generated once per test-file run; reused across tests (key generation is the
// slow part). The PEM is also handed to the transport with literal "\n"
// sequences in one test to pin the normalization path.
const TEST_PRIVATE_KEY_PEM = await generateTestPrivateKeyPem();

const CLIENT_EMAIL = 'relay@alfanumrik-test.iam.gserviceaccount.com';
const SENDER = 'mailer@alfanumrik.test';
const RECIPIENT = 'aarav.student@example.com';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const ACCESS_TOKEN = 'ya29.test-access-token-DO-NOT-LOG-0001';
const GMAIL_MESSAGE_ID = 'gmail-msg-id-19821abc0de';

// ─── Recording fetcher ────────────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

function makeFetcher(opts: {
  tokenStatus?: number;
  sendStatus?: number;
  throwOnSend?: boolean;
} = {}): { fetcher: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetcher = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url === TOKEN_URL) {
      const status = opts.tokenStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'bad assertion' }), { status });
      }
      return new Response(
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' }),
        { status: 200 },
      );
    }
    if (url === SEND_URL) {
      if (opts.throwOnSend) throw new Error('socket hangup (simulated)');
      const status = opts.sendStatus ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ error: { code: status, message: 'boom' } }), { status });
      }
      return new Response(JSON.stringify({ id: GMAIL_MESSAGE_ID, threadId: 'thread-1' }), { status: 200 });
    }
    throw new Error(`unexpected URL in test fetcher: ${url}`);
  }) as typeof fetch;
  return { fetcher, requests };
}

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: 'Alfanumrik <noreply@alfanumrik.test>',
    to: RECIPIENT,
    // Bilingual subject — the Hindi half forces the RFC 2047 path.
    subject: 'Verify your Alfanumrik account | अपना Alfanumrik खाता सत्यापित करें',
    html: '<p>Namaste! <strong>सत्यापित करें</strong></p>',
    text: 'Namaste! सत्यापित करें',
    replyTo: 'support@alfanumrik.test',
    headers: { 'X-Entity-Ref-ID': 'auth-signup-123' },
    tags: [{ name: 'category', value: 'auth' }],
    idempotencyKey: 'email:auth_email:test-key-0001',
    operation: 'send_auth_email',
    ...overrides,
  };
}

function makeTransport(fetcher: typeof fetch, privateKey = TEST_PRIVATE_KEY_PEM) {
  return createGmailTransport({
    clientEmail: CLIENT_EMAIL,
    privateKey,
    sender: SENDER,
    fetcher,
  });
}

// ─── Decoding helpers (test-side only) ────────────────────────────────────────

/** Decodes base64url AND standard base64 (the -/_ swaps are no-ops for the
 *  latter; padding is restored when absent). */
function base64UrlDecodeToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(b64url));
}

/** Extract the decoded UTF-8 content of the base64 MIME part that follows the
 *  given Content-Type line inside a decoded RFC 2822 message. */
function decodeMimePart(mime: string, contentType: string): string {
  const marker = `Content-Type: ${contentType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
  const start = mime.indexOf(marker);
  assert(start >= 0, `MIME must contain a base64 part with Content-Type: ${contentType}`);
  const rest = mime.slice(start + marker.length);
  const end = rest.indexOf('\r\n--');
  const b64 = rest.slice(0, end).replace(/\r\n/g, '');
  return new TextDecoder().decode(base64UrlDecodeToBytes(b64));
}

/** Run `fn` while capturing every console.log/info/warn/error line. */
async function withCapturedConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

// ─── 1. Token request shape (JWT-bearer grant, iss/sub/scope/aud claims) ─────

Deno.test('gmail transport: token request is a JWT-bearer grant whose claims carry iss/sub/scope/aud', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher, requests } = makeFetcher();
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(makeMessage()));
  assertEquals(result.success, true);

  // First request is the token exchange.
  const tokenReq = requests[0];
  assertEquals(tokenReq.url, TOKEN_URL);
  assertEquals(tokenReq.method, 'POST');
  assertStringIncludes(tokenReq.headers.get('content-type') ?? '', 'application/x-www-form-urlencoded');

  const params = new URLSearchParams(tokenReq.body);
  assertEquals(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

  const assertion = params.get('assertion') ?? '';
  const segments = assertion.split('.');
  assertEquals(segments.length, 3, 'assertion must be a three-segment JWT');

  // Header: RS256 / JWT. (Signature is NOT verified — shape only.)
  const header = JSON.parse(base64UrlDecodeToString(segments[0]));
  assertEquals(header.alg, 'RS256');
  assertEquals(header.typ, 'JWT');

  // Claims: iss = service account, sub = impersonated sender (domain-wide
  // delegation), scope = gmail.send, aud = the token endpoint, 1h expiry.
  const claims = JSON.parse(base64UrlDecodeToString(segments[1]));
  assertEquals(claims.iss, CLIENT_EMAIL);
  assertEquals(claims.sub, SENDER);
  assertEquals(claims.scope, 'https://www.googleapis.com/auth/gmail.send');
  assertEquals(claims.aud, TOKEN_URL);
  assertEquals(typeof claims.iat, 'number');
  assertEquals(claims.exp - claims.iat, 3600, 'expiry must be the documented 1h maximum');
});

// The PEM secret is often pasted with literal "\n" sequences — the transport
// must normalize them before PKCS8 import (same send must still succeed).
Deno.test('gmail transport: private key with literal \\n sequences is normalized and still signs', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher } = makeFetcher();
  const literalNewlinePem = TEST_PRIVATE_KEY_PEM.replace(/\n/g, '\\n');
  const { result } = await withCapturedConsole(() =>
    makeTransport(fetcher, literalNewlinePem).send(makeMessage()));
  assertEquals(result.success, true, 'literal-\\n PEM must be normalized, not rejected');
});

// ─── 2. Token caching ────────────────────────────────────────────────────────

Deno.test('gmail transport: second send reuses the cached access token (one token exchange, two sends)', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher, requests } = makeFetcher();
  const transport = makeTransport(fetcher);
  const { result: r1 } = await withCapturedConsole(() => transport.send(makeMessage()));
  const { result: r2 } = await withCapturedConsole(() => transport.send(makeMessage({ idempotencyKey: 'email:auth_email:test-key-0002' })));
  assertEquals(r1.success, true);
  assertEquals(r2.success, true);

  const tokenCalls = requests.filter((r) => r.url === TOKEN_URL);
  const sendCalls = requests.filter((r) => r.url === SEND_URL);
  assertEquals(tokenCalls.length, 1, 'the cached token must be reused — exactly one token exchange');
  assertEquals(sendCalls.length, 2, 'both messages must be dispatched');
  // Both sends carry the same cached bearer token.
  assertEquals(sendCalls[0].headers.get('authorization'), `Bearer ${ACCESS_TOKEN}`);
  assertEquals(sendCalls[1].headers.get('authorization'), `Bearer ${ACCESS_TOKEN}`);
});

// ─── 3. MIME shape (multipart/alternative, UTF-8, RFC 2047 subject) ──────────

Deno.test('gmail transport: raw MIME carries text + html parts, RFC 2047 UTF-8 subject, and the correlation header', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher, requests } = makeFetcher();
  const message = makeMessage();
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(message));
  assertEquals(result.success, true);

  const sendReq = requests.find((r) => r.url === SEND_URL)!;
  assertEquals(sendReq.method, 'POST');
  assertStringIncludes(sendReq.headers.get('content-type') ?? '', 'application/json');

  const body = JSON.parse(sendReq.body) as { raw?: string };
  assert(typeof body.raw === 'string' && body.raw.length > 0, 'send body must be { raw: <base64url> }');
  assert(!body.raw.includes('+') && !body.raw.includes('/') && !body.raw.includes('='),
    'raw must be base64url (no +, /, or padding)');

  const mime = base64UrlDecodeToString(body.raw);

  // Envelope headers.
  assertStringIncludes(mime, `From: ${message.from}`);
  assertStringIncludes(mime, `To: ${RECIPIENT}`);
  assertStringIncludes(mime, `Reply-To: ${message.replyTo}`);
  assertStringIncludes(mime, 'MIME-Version: 1.0');
  assertStringIncludes(mime, 'Content-Type: multipart/alternative; boundary=');
  // Non-ASCII (Hindi) subject → RFC 2047 UTF-8 encoded-word, never raw Devanagari.
  assertStringIncludes(mime, 'Subject: =?UTF-8?B?');
  // Idempotency key rides as a correlation header (Gmail has no dedup).
  assertStringIncludes(mime, `X-Idempotency-Key: ${message.idempotencyKey}`);
  // Custom headers + tags survive.
  assertStringIncludes(mime, 'X-Entity-Ref-ID: auth-signup-123');
  assertStringIncludes(mime, 'X-Alfanumrik-Tags: category=auth');

  // Both alternative parts decode back to the original UTF-8 content.
  assertEquals(decodeMimePart(mime, 'text/plain; charset=UTF-8'), message.text);
  assertEquals(decodeMimePart(mime, 'text/html; charset=UTF-8'), message.html);
});

// ─── 4. Result mapping ───────────────────────────────────────────────────────

Deno.test('gmail transport: success maps the Gmail message id to EmailSendResult.id', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher } = makeFetcher();
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(makeMessage()));
  assertEquals(result.success, true);
  assertEquals(result.provider, 'gmail');
  assertEquals(result.id, GMAIL_MESSAGE_ID, 'Gmail response { id } must surface as the provider message id');
});

Deno.test('gmail transport: HTTP failure maps to gmail_http_<status> (no id, no provider detail)', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher } = makeFetcher({ sendStatus: 400 });
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(makeMessage()));
  assertEquals(result.success, false);
  assertEquals(result.provider, 'gmail');
  assertEquals(result.code, 'gmail_http_400');
  assertEquals(result.id, undefined);
});

Deno.test('gmail transport: thrown fetcher maps to gmail_exception', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher } = makeFetcher({ throwOnSend: true });
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(makeMessage()));
  assertEquals(result.success, false);
  assertEquals(result.provider, 'gmail');
  assertEquals(result.code, 'gmail_exception');
});

Deno.test('gmail transport: token-endpoint failure maps to gmail_auth_failed (message never dispatched)', async () => {
  clearGmailTokenCacheForTests();
  const { fetcher, requests } = makeFetcher({ tokenStatus: 401 });
  const { result } = await withCapturedConsole(() => makeTransport(fetcher).send(makeMessage()));
  assertEquals(result.success, false);
  assertEquals(result.provider, 'gmail');
  assertEquals(result.code, 'gmail_auth_failed');
  assertEquals(requests.filter((r) => r.url === SEND_URL).length, 0,
    'a failed token exchange must never reach the Gmail send endpoint');
});

// ─── 5. P13: no secret / recipient material in any log line ──────────────────

Deno.test('gmail transport: no log line carries the private key, access token, JWT, or full recipient', async () => {
  clearGmailTokenCacheForTests();

  // Success send + HTTP-failure send + auth-failure send: capture EVERY line.
  const okFetch = makeFetcher();
  const { lines: okLines } = await withCapturedConsole(() => makeTransport(okFetch.fetcher).send(makeMessage()));

  clearGmailTokenCacheForTests();
  const failFetch = makeFetcher({ sendStatus: 500 });
  const { lines: failLines } = await withCapturedConsole(() => makeTransport(failFetch.fetcher).send(makeMessage()));

  clearGmailTokenCacheForTests();
  const authFetch = makeFetcher({ tokenStatus: 403 });
  const { lines: authLines } = await withCapturedConsole(() => makeTransport(authFetch.fetcher).send(makeMessage()));

  const allLines = [...okLines, ...failLines, ...authLines];
  assert(allLines.length > 0, 'expected at least the relay_email_sent / failed log lines');

  // A distinctive slice of the PEM body (never the whole thing in the assert).
  const keyFingerprint = TEST_PRIVATE_KEY_PEM.split('\n')[1];
  const signedJwtFingerprint = '.eyJ'; // start of any encoded JWT claims segment
  for (const line of allLines) {
    assert(!line.includes(keyFingerprint), 'private key material must NEVER be logged');
    assert(!line.includes('BEGIN PRIVATE KEY'), 'PEM headers must NEVER be logged');
    assert(!line.includes(ACCESS_TOKEN), 'the access token must NEVER be logged');
    assert(!line.includes(signedJwtFingerprint), 'a signed JWT must NEVER be logged');
    assert(!line.includes(RECIPIENT), 'the full recipient address must NEVER be logged (P13)');
  }
});
