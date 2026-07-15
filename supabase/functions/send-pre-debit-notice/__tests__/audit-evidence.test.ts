// supabase/functions/send-pre-debit-notice/__tests__/audit-evidence.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file,
// so the npm suite is unaffected). Run via:
//   deno test --no-lock --no-check --allow-read --allow-env \
//     supabase/functions/send-pre-debit-notice/__tests__/audit-evidence.test.ts
//
// No socket is EVER opened at runtime: the send-path tests inject a stub
// EmailTransport via setDefaultEmailTransport(), so the shared relay never
// reaches fetchWithTimeout. `--allow-net` is only needed on a COLD cache to
// warm the one `deno.land/std` assert import (shared with the REG-177 suite,
// same std@0.210.0 pin); after that the file runs offline with just
// `--allow-read --allow-env` (the permission set of the `edge-function-tests`
// CI lane).
//
// ── REG-241: RBI pre-debit-notice audit-evidence + fail-closed posture ───────
// Phase 2 (RBI pre-debit audit-evidence fix) changed the `subscription_events`
// audit-insert metadata in ../index.ts so it now carries, for every notice:
//   - provider_message_id — the Resend message id (sendResult.provider_id),
//     which pins THIS audit row to a specific Resend delivery. Under the
//     Mailgun→Resend migration the business idempotency key stopped riding a
//     *searchable* provider field, so persisting the returned message id is now
//     the ONLY way a Razorpay/RBI dispute can correlate an audit row to a
//     concrete delivery. A Resend message id is not PII (P13) — safe to store.
//   - provider_status — the authoritative relay outcome (message id on success,
//     a PII-free failure code on failure).
//   - relay_dispatches — renamed from `attempts`; how many times WE handed the
//     notice to the shared relay (the relay retries the HTTP POST internally).
//
// Fail-closed posture (RBI e-mandate: a notice that cannot be delivered MUST
// NOT be treated as sent — the cron then skips/retries the auto-charge rather
// than silently debiting the customer) is preserved: relay-not-configured OR a
// send failure → sendResult.ok=false → eventType='pre_debit_notice_failed' →
// HTTP 500. This test promotes backend's throwaway offline assertion into a
// committed, deterministic pin.
//
// ── Approach: real relay seam + source-pinned mapping mirror (hybrid) ─────────
// The full handler is intentionally NOT invoked here. Unlike send-auth-email,
// ../index.ts (a) imports `@supabase/supabase-js` from esm.sh (a cold-cache
// network dependency) and (b) makes a real `subscription_events` SELECT in its
// pre-flight idempotency path, so a handler-capture drive would need a live DB
// / a mocked network layer the handler gives no seam to inject. The
// audit-metadata mapping itself is ALSO not an exported unit — it is inline in
// the Deno.serve() closure. So this test:
//
//   1. Exercises the REAL relay code path for the load-bearing fact:
//      `sendEmail()` (../../_shared/relay-mailer.ts) with a stub transport
//      injected via the REAL `setDefaultEmailTransport()`. This proves the
//      injected transport's returned id actually flows through the real relay
//      to `EmailSendResult.id` — the value ../index.ts persists as
//      `provider_message_id` — and that a failing transport yields a PII-free
//      failure code, no id.
//   2. Mirrors the two tiny inline pieces ../index.ts does NOT export — the
//      post-send branch of `sendEmailWithRetry` (index.ts:248-270) and the
//      audit-metadata mapping (index.ts:355 + 380/386/387/388) — as
//      `toRelayResult()` / `buildAuditEvidence()`, kept byte-equal to source.
//   3. Adds a SOURCE CANARY (Deno.readTextFileSync of ../index.ts) asserting
//      those exact mapping expressions still exist verbatim. THIS is what makes
//      the pin durable: if a future edit drops `provider_message_id`, renames
//      `relay_dispatches` back to `attempts`, or flips the fail-closed
//      eventType, the mirror and the source diverge and the canary turns red.
//
// Preferring real code over reimplementation, per the task: the one fact that
// could regress silently (id → provider_message_id) rides REAL code; the
// unexportable 6-line mapping is mirrored AND source-pinned so it cannot drift
// unnoticed.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  type EmailSendResult,
  sendEmail,
  setDefaultEmailTransport,
} from '../../_shared/relay-mailer.ts';

// ─── Mirror of ../index.ts sendEmailWithRetry's return shape (index.ts:248) ──
interface RelayResult {
  ok: boolean;
  provider_id?: string;
  error?: string;
  attempts: number;
}

// Mirror of ../index.ts:267-269 — the post-`sendEmail` branch of
// sendEmailWithRetry. Pinned verbatim by the source canary below.
function toRelayResult(r: EmailSendResult): RelayResult {
  return r.success
    ? { ok: true, provider_id: r.id, attempts: 1 }
    : { ok: false, error: r.code ?? 'relay_send_failed', attempts: 1 };
}

// Mirror of ../index.ts:249-251 — the relay-not-configured guard, which returns
// BEFORE sendEmail is ever called (RESEND_API_KEY absent).
const RELAY_NOT_CONFIGURED: RelayResult = { ok: false, error: 'relay_not_configured', attempts: 0 };

interface AuditEvidence {
  eventType: string;
  metadata: {
    provider_message_id: string | null;
    provider_status: string;
    relay_dispatches: number;
    error: string | null;
  };
}

// Mirror of ../index.ts:355 + the audit metadata built at index.ts:380/386/387/388.
// Kept BYTE-EQUAL to the source expressions (the source canary asserts they
// still exist verbatim in ../index.ts).
function buildAuditEvidence(sendResult: RelayResult): AuditEvidence {
  const eventType = sendResult.ok ? 'pre_debit_notice_sent' : 'pre_debit_notice_failed';
  return {
    eventType,
    metadata: {
      provider_message_id: sendResult.provider_id ?? null,
      relay_dispatches: sendResult.attempts,
      provider_status: sendResult.ok ? (sendResult.provider_id ?? 'delivered') : (sendResult.error ?? 'relay_send_failed'),
      error: sendResult.error ?? null,
    },
  };
}

// A representative regulated notice. Content is irrelevant to the stub transport
// (no socket is opened); it just satisfies the EmailMessage shape.
function preDebitMessage() {
  return {
    from: 'Alfanumrik Billing <billing@alfanumrik.com>',
    to: 'customer@example.com',
    subject: 'Reminder: ₹499 auto-debit',
    html: '<p>notice</p>',
    text: 'notice',
    replyTo: 'support@alfanumrik.com',
    idempotencyKey: 'pre_debit_sub-123_2026-07-20',
    operation: 'send_pre_debit_notice',
  };
}

// ─── Success path ────────────────────────────────────────────────────────────
// A successful relay dispatch → audit row carries the Resend message id as
// provider_message_id (non-null, equal to the injected transport's id), a
// success provider_status, relay_dispatches=1, and the 'sent' outcome.
Deno.test('pre-debit audit: successful relay dispatch persists provider_message_id equal to the Resend id (dispute-reconcilable)', async () => {
  const RESEND_ID = 'resend-msg-uuid-abc123';
  setDefaultEmailTransport({
    name: 'stub-ok',
    send: () => Promise.resolve({ success: true, id: RESEND_ID }),
  });
  try {
    // REAL relay path — proves the injected id flows through sendEmail().
    const result = await sendEmail(preDebitMessage());
    assertEquals(result.success, true, 'stub transport reports success');
    assertEquals(result.id, RESEND_ID, 'real relay surfaces the injected transport id');

    const relay = toRelayResult(result);
    const audit = buildAuditEvidence(relay);

    // provider_message_id is non-null AND exactly the Resend delivery id, so an
    // audit row can be correlated to a specific Resend delivery in a dispute.
    assert(audit.metadata.provider_message_id !== null, 'provider_message_id must not be null on success');
    assertEquals(audit.metadata.provider_message_id, RESEND_ID, 'provider_message_id must equal the injected Resend id');
    // provider_status reflects success (the delivery id), never a failure code.
    assertEquals(audit.metadata.provider_status, RESEND_ID, 'provider_status must reflect the successful delivery');
    assert(audit.metadata.provider_status !== 'relay_send_failed', 'provider_status must not be a failure default on success');
    assertEquals(audit.metadata.relay_dispatches, 1, 'one relay dispatch on the success path');
    assertEquals(audit.metadata.error, null, 'no error on success');
    // Success maps to the SENT outcome (HTTP 200 in the handler).
    assertEquals(audit.eventType, 'pre_debit_notice_sent');
  } finally {
    setDefaultEmailTransport(null);
  }
});

// Defensive branch: a success WITHOUT a provider id (EmailSendResult.id is
// optional) → provider_message_id null, provider_status falls back to
// 'delivered' — pins the `?? 'delivered'` / `?? null` fallbacks. Still 'sent'.
Deno.test("pre-debit audit: success without a provider id falls back to provider_status='delivered'", async () => {
  setDefaultEmailTransport({
    name: 'stub-ok-no-id',
    send: () => Promise.resolve({ success: true }),
  });
  try {
    const result = await sendEmail(preDebitMessage());
    assertEquals(result.success, true);

    const audit = buildAuditEvidence(toRelayResult(result));
    assertEquals(audit.metadata.provider_message_id, null, 'no id → provider_message_id null');
    assertEquals(audit.metadata.provider_status, 'delivered', "no id → provider_status 'delivered' fallback");
    assertEquals(audit.eventType, 'pre_debit_notice_sent');
  } finally {
    setDefaultEmailTransport(null);
  }
});

// ─── Fail-closed path #1: transport returns ok:false (send failure) ──────────
// The regulated evidence of a NON-delivery: no provider_message_id, a PII-free
// failure code as provider_status, and the FAILED outcome (→ HTTP 500 → cron
// never treats the charge as noticed). NOT a success.
Deno.test('pre-debit audit: relay send failure is fail-closed (provider_message_id null, failed outcome, NOT sent)', async () => {
  setDefaultEmailTransport({
    name: 'stub-fail',
    send: () => Promise.resolve({ success: false, code: 'resend_http_500' }),
  });
  try {
    const result = await sendEmail(preDebitMessage());
    assertEquals(result.success, false, 'stub transport reports failure');
    assertEquals(result.id, undefined, 'a failed relay surfaces no message id');

    const audit = buildAuditEvidence(toRelayResult(result));
    assertEquals(audit.metadata.provider_message_id, null, 'no delivery → no provider_message_id');
    assertEquals(audit.metadata.provider_status, 'resend_http_500', 'provider_status carries the PII-free failure code');
    assertEquals(audit.metadata.relay_dispatches, 1, 'one relay dispatch was attempted');
    // The load-bearing fail-closed assertion.
    assertEquals(audit.eventType, 'pre_debit_notice_failed', 'send failure must map to the FAILED outcome');
    assert(audit.eventType !== 'pre_debit_notice_sent', 'a send failure must NEVER be recorded as sent');
  } finally {
    setDefaultEmailTransport(null);
  }
});

// ─── Fail-closed path #2: relay not configured (RESEND_API_KEY absent) ───────
// sendEmailWithRetry short-circuits BEFORE calling sendEmail (index.ts:249-251),
// so relay_dispatches=0. Same fail-closed evidence: null id, failure status,
// FAILED outcome.
Deno.test('pre-debit audit: relay-not-configured is fail-closed (0 dispatches, provider_message_id null, failed outcome)', () => {
  const audit = buildAuditEvidence(RELAY_NOT_CONFIGURED);
  assertEquals(audit.metadata.provider_message_id, null, 'unconfigured relay → no provider_message_id');
  assertEquals(audit.metadata.provider_status, 'relay_not_configured', 'provider_status is the failure code');
  assertEquals(audit.metadata.relay_dispatches, 0, 'notice was never handed to the relay');
  assertEquals(audit.metadata.error, 'relay_not_configured');
  assertEquals(audit.eventType, 'pre_debit_notice_failed', 'unconfigured relay must map to the FAILED outcome');
  assert(audit.eventType !== 'pre_debit_notice_sent', 'an unconfigured relay must NEVER be recorded as sent');
});

// ─── Source canary: pin the exact audit-metadata mapping in ../index.ts ──────
// Makes REG-241 durable against drift. The mirrors above only test the mapping
// the mirrors themselves encode; this asserts ../index.ts still encodes the
// SAME expressions. Any silent divergence (dropped provider_message_id, renamed
// relay_dispatches, flipped fail-closed eventType) turns this red.
Deno.test('pre-debit audit: ../index.ts still builds the pinned audit-evidence mapping (drift canary)', () => {
  const src = Deno.readTextFileSync(new URL('../index.ts', import.meta.url));

  // Audit-metadata mapping (index.ts:380/386/387).
  assertStringIncludes(
    src,
    'provider_message_id: sendResult.provider_id ?? null',
    'audit row must persist the Resend message id as provider_message_id',
  );
  assertStringIncludes(
    src,
    'relay_dispatches: sendResult.attempts',
    'audit row must carry relay_dispatches (renamed from attempts)',
  );
  assertStringIncludes(
    src,
    "provider_status: sendResult.ok ? (sendResult.provider_id ?? 'delivered') : (sendResult.error ?? 'relay_send_failed')",
    'provider_status must map success→delivery id (or delivered) and failure→failure code',
  );

  // Fail-closed outcome selector (index.ts:355).
  assertStringIncludes(
    src,
    "const eventType = sendResult.ok ? 'pre_debit_notice_sent' : 'pre_debit_notice_failed'",
    'a non-ok relay result must map to the FAILED (fail-closed) outcome',
  );

  // sendEmailWithRetry branches the mirror encodes (index.ts:250/268/269).
  assertStringIncludes(
    src,
    "return { ok: false, error: 'relay_not_configured', attempts: 0 }",
    'unconfigured relay short-circuits to a fail-closed result with 0 dispatches',
  );
  assertStringIncludes(
    src,
    '{ ok: true, provider_id: result.id, attempts: 1 }',
    'a successful relay result carries the provider id through as provider_id',
  );
  assertStringIncludes(
    src,
    "{ ok: false, error: result.code ?? 'relay_send_failed', attempts: 1 }",
    'a failed relay result carries a PII-free failure code, no provider id',
  );
});
