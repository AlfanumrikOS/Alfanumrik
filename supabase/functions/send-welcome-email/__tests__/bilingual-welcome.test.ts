// supabase/functions/send-welcome-email/__tests__/bilingual-welcome.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file).
// Run via:
//   deno test --no-lock --no-check --allow-read --allow-env \
//     supabase/functions/send-welcome-email/__tests__/bilingual-welcome.test.ts
//
// `--allow-net` is only needed on a COLD cache to fetch the esm.sh
// `@supabase/supabase-js` module once (imported by index.ts). After the cache
// is warm the suite runs fully offline: the handler-capture test stubs
// globalThis.fetch (GoTrue user lookup + audit insert) and injects a stub
// EmailTransport via setDefaultEmailTransport(), so no socket is ever opened.
//
// What this suite pins:
//   P7  — every role variant (student/teacher/parent) renders BOTH English and
//         Hindi (Devanagari) in ONE html body and ONE text body, on the SAME
//         shared v49 primitives as send-auth-email (_shared/bilingual-email.ts:
//         stacked EN → languageDivider → HI, dual-language subject). Technical
//         terms (CBSE, XP, product names) are NOT translated.
//   Deliverability hygiene — the actual send carries: a From display name
//         ("Alfanumrik <welcome@alfanumrik.com>"), BOTH html and text parts,
//         and a mailto-only List-Unsubscribe header. No List-Unsubscribe-Post:
//         RFC 8058 one-click requires a real HTTPS endpoint, which we do not
//         have — advertising one against a mailto URI is a fake signal.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { languageDivider } from '../../_shared/bilingual-email.ts';
import {
  parentEmail,
  studentEmail,
  teacherEmail,
  WELCOME_LIST_UNSUBSCRIBE,
  welcomeEmailHeaders,
  type RenderedWelcomeEmail,
} from '../templates.ts';
import {
  setDefaultEmailTransport,
  type EmailMessage,
} from '../../_shared/relay-mailer.ts';

const SITE = 'https://alfanumrik.test';
const DEVANAGARI = /[ऀ-ॿ]/;

/** All three role variants, rendered once with representative inputs. */
function renderAll(): Array<{ role: string; email: RenderedWelcomeEmail; cta: string }> {
  return [
    { role: 'student', email: studentEmail(SITE, 'Aarav Sharma', '8', 'CBSE'), cta: `${SITE}/dashboard` },
    { role: 'teacher', email: teacherEmail(SITE, 'Priya Nair', 'DAV Public School'), cta: `${SITE}/dashboard` },
    { role: 'parent', email: parentEmail(SITE, 'Rohit Verma'), cta: `${SITE}/parent` },
  ];
}

/** Split the html body into its English and Hindi halves at the shared divider. */
function splitOnDivider(html: string): { en: string; hi: string } {
  // The hidden preheader div is intentionally dual-language (same house shape
  // as send-auth-email); drop it so the EN/HI-purity assertions below run on
  // the VISIBLE sections only.
  const visible = html.replace(/<div style="display:none;[\s\S]*?<\/div>/, '');
  const parts = visible.split(languageDivider());
  assertEquals(parts.length, 2, 'welcome html must contain the shared language divider exactly once');
  return { en: parts[0], hi: parts[1] };
}

// ─── (a) Every role variant: html AND text carry both English and Devanagari ─

Deno.test('welcome templates: each role renders English + Devanagari in BOTH html and text', () => {
  for (const { role, email } of renderAll()) {
    assert(DEVANAGARI.test(email.html), `${role} html must contain Devanagari`);
    assert(DEVANAGARI.test(email.text), `${role} text must contain Devanagari`);
    assertStringIncludes(email.html, 'Welcome', `${role} html must contain English copy`);
    assertStringIncludes(email.text, 'Welcome', `${role} text must contain English copy`);
    assert(DEVANAGARI.test(email.subject), `${role} subject must carry the Hindi half`);
    assertStringIncludes(email.subject, 'Welcome to Alfanumrik', `${role} subject must carry the English half`);
    assertStringIncludes(email.subject, ' | ', `${role} subject must use the dual-language "EN | HI" house shape`);
    assert(email.text.trim().length > 0, `${role} text part must be non-empty (both parts are sent)`);
  }
});

Deno.test('welcome templates: v49 stacked structure — EN section first, divider, then HI section', () => {
  for (const { role, email, cta } of renderAll()) {
    const { en, hi } = splitOnDivider(email.html);
    assert(!DEVANAGARI.test(en), `${role}: English section (before divider) must not contain Devanagari`);
    assert(DEVANAGARI.test(hi), `${role}: Hindi section (after divider) must contain Devanagari`);
    // Both language sections carry the same CTA destination (shared ctaButton).
    assertStringIncludes(en, `href="${cta}"`, `${role}: EN section must link the CTA`);
    assertStringIncludes(hi, `href="${cta}"`, `${role}: HI section must link the CTA`);
    // Shared v49 wrapper (not the retired parallel welcome wrapper).
    assertStringIncludes(email.html, 'Alfanumrik EdTech Pvt. Ltd., India');
    // Text mirrors the bilingual content, including the CTA URL.
    assertStringIncludes(email.text, cta, `${role}: text part must mirror the CTA URL`);
  }
});

// ─── (c) Technical terms are NOT translated (P7) ─────────────────────────────

Deno.test('welcome templates: CBSE/XP stay untranslated inside the Hindi section (P7)', () => {
  const student = studentEmail(SITE, 'Aarav Sharma', '8', 'CBSE');
  const teacher = teacherEmail(SITE, 'Priya Nair');
  const parent = parentEmail(SITE, 'Rohit Verma');

  const studentHi = splitOnDivider(student.html).hi;
  assertStringIncludes(studentHi, 'XP', 'student HI section must keep "XP" in Latin script');
  assertStringIncludes(studentHi, 'CBSE', 'student HI section must keep the board code "CBSE"');
  assertStringIncludes(studentHi, 'Foxy', 'product name "Foxy" must not be translated');

  const teacherHi = splitOnDivider(teacher.html).hi;
  assertStringIncludes(teacherHi, 'CBSE', 'teacher HI section must keep "CBSE" in Latin script');

  const parentHi = splitOnDivider(parent.html).hi;
  assertStringIncludes(parentHi, 'XP', 'parent HI section must keep "XP" in Latin script');
  assertStringIncludes(parentHi, 'Parent Link Code', '"Parent Link Code" is a product term — untranslated');

  // The text part mirrors the same untranslated terms in its Hindi half.
  for (const { email } of renderAll()) {
    const textHi = email.text.slice(email.text.search(DEVANAGARI));
    assert(/XP|CBSE/.test(textHi), 'text Hindi half must keep XP/CBSE in Latin script');
  }
});

// ─── (b) Deliverability headers ──────────────────────────────────────────────

Deno.test('welcome headers: mailto-only List-Unsubscribe, NO fake one-click List-Unsubscribe-Post', () => {
  for (const role of ['student', 'teacher', 'parent'] as const) {
    const headers = welcomeEmailHeaders(role);
    assertEquals(headers['List-Unsubscribe'], '<mailto:unsubscribe@alfanumrik.com>');
    assertEquals(WELCOME_LIST_UNSUBSCRIBE, '<mailto:unsubscribe@alfanumrik.com>');
    assert(!('List-Unsubscribe-Post' in headers),
      'List-Unsubscribe-Post must NOT be sent: RFC 8058 one-click needs an HTTPS endpoint we do not have');
    assert(headers['X-Entity-Ref-ID'].startsWith(`welcome-${role}-`), 'per-send entity ref must carry the role');
  }
});

// ─── (b, end-to-end) The ACTUAL send carries the hygiene items ────────────────
//
// Handler-capture (same technique as send-auth-email/__tests__/always-200.test.ts):
// stub Deno.serve to grab the handler, stub globalThis.fetch for the GoTrue
// user lookup + audit insert, and inject a capturing stub transport. This
// exercises the REAL index.ts send path — auth gate, template dispatch, and the
// exact EmailMessage handed to the relay — with no socket.

type Handler = (req: Request) => Promise<Response> | Response;

async function loadWelcomeHandler(): Promise<Handler> {
  Deno.env.set('SUPABASE_URL', 'http://supabase.test');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-test-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');
  Deno.env.set('MAILGUN_API_KEY', 'key-mg-test-0001');
  Deno.env.set('MAILGUN_DOMAIN', 'mg.alfanumrik.test');
  Deno.env.set('SITE_URL', SITE);

  let captured: Handler | null = null;
  const realServe = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (handler: Handler) => {
    captured = handler;
    return {
      finished: Promise.resolve(),
      shutdown: () => Promise.resolve(),
      ref() {},
      unref() {},
      addr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 },
    };
  };
  try {
    await import(new URL(`../index.ts?cb=${Date.now()}`, import.meta.url).href);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  assert(captured, 'index.ts did not call Deno.serve() — handler not captured');
  return captured;
}

/** Offline fetch stub: GoTrue user lookup succeeds; PostgREST writes ack. */
function stubFetch(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/user')) {
      return Promise.resolve(new Response(JSON.stringify({
        id: '11111111-2222-3333-4444-555555555555',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'aarav.student@example.com',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    // audit_logs / notifications inserts — acknowledge, never leave the process.
    return Promise.resolve(new Response(JSON.stringify([]), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

// sanitizeOps/sanitizeResources are off for this one test: constructing the
// supabase-js client inside the handler starts a GoTrue-internal interval that
// outlives the request (index.ts production behavior — not something this test
// may change). No socket is ever opened; fetch and the transport are stubbed.
Deno.test({
  name: 'welcome send: From display name + html AND text parts + mailto-only List-Unsubscribe on the wire',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
  const handler = await loadWelcomeHandler();
  const restoreFetch = stubFetch();
  let sent: EmailMessage | null = null;
  setDefaultEmailTransport({
    name: 'stub-capture',
    send: (m: EmailMessage) => {
      sent = m;
      return Promise.resolve({ success: true, provider: 'mailgun', id: 'mg-welcome-0001' });
    },
  });
  try {
    const res = await handler(new Request('http://localhost/functions/v1/send-welcome-email', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer test-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'student', name: 'Aarav Sharma', grade: '8', board: 'CBSE' }),
    }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sent, true);

    assert(sent, 'the relay must receive the send');
    const m = sent as EmailMessage;
    // Hygiene 1: From carries a display name (existing address kept).
    assertEquals(m.from, 'Alfanumrik <welcome@alfanumrik.com>');
    // Hygiene 2: BOTH parts sent; text mirrors the bilingual content.
    assert(m.html.length > 0 && m.text.length > 0, 'both html and text parts must be sent');
    assert(DEVANAGARI.test(m.html) && DEVANAGARI.test(m.text), 'both parts must be bilingual');
    assertStringIncludes(m.html, 'Welcome aboard');
    // Hygiene 3: mailto-only List-Unsubscribe; no fake one-click header.
    assertEquals(m.headers?.['List-Unsubscribe'], '<mailto:unsubscribe@alfanumrik.com>');
    assert(!(m.headers && 'List-Unsubscribe-Post' in m.headers), 'no List-Unsubscribe-Post on a mailto-only URI');
    assertEquals(m.replyTo, 'support@alfanumrik.com');
    // P13: the send goes to the JWT user's own email, never body-supplied.
    assertEquals(m.to, 'aarav.student@example.com');
  } finally {
    setDefaultEmailTransport(null);
    restoreFetch();
  }
  },
});
