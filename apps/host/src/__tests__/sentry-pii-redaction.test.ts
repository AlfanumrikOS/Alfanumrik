/**
 * Sentry / PostHog PII redaction — privacy-policy alignment regression.
 *
 * D7 follow-up #4 (2026-05-05). Pins the comparison matrix between
 * `docs/legal/privacy-policy-scaffold.md` Section 11 ("Security Measures —
 * PII redaction in logs: passwords, tokens, emails, phone numbers, and API
 * keys are stripped from server logs and Sentry events before storage")
 * and the actual `beforeSend` / `redactPII` implementation.
 *
 * Why this test exists separately from REG-49 (sentry-client-redact.test.ts):
 *
 *   REG-49 pins the client-redactor's behavior on synthetic Sentry events
 *   (user, request.headers, breadcrumbs, extra, contexts, tags). It is the
 *   contract pin for `redactSentryEvent()`.
 *
 *   This file pins the broader privacy-policy alignment for the SHARED base
 *   redactor (`supabase/functions/_shared/redact-pii.ts` → `redactPII`),
 *   which is what `sentry.server.config.ts` and `sentry.edge.config.ts` rely
 *   on for the bulk of their scrubbing. Failures here mean the privacy
 *   policy text and the code disagree — that's a publishable-policy risk,
 *   not just a test failure.
 *
 * Coverage matrix (each PII category in Section 11 + Section 7.1):
 *   - Passwords / tokens / API keys / service-role keys
 *   - Email addresses (top-level, nested, in arrays)
 *   - Phone numbers (incl. parent_phone)
 *   - Authorization / Cookie / Set-Cookie / x-api-key headers
 *   - Identity surface: full_name, school_name, school_address
 *   - Payment surface: razorpay_signature, card_number, card_cvv,
 *                      card_expiry, card_holder, upi_id, vpa, upi_pin
 *   - Network identifiers: ip_address
 *
 * NOT scoped here (covered elsewhere):
 *   - Sentry client redactor structural rules — REG-49 in
 *     `src/__tests__/lib/sentry-client-redact.test.ts`.
 *   - PostHog event-level redaction — REG-64 in
 *     `src/__tests__/lib/posthog/redactor.test.ts`.
 *   - PostHog person-properties allowlist — covered in posthog/server.ts tests.
 */

import { describe, it, expect } from 'vitest';
import { redactPII } from '@alfanumrik/lib/ops-events-redactor';
import { redactSentryEvent } from '@alfanumrik/lib/sentry-client-redact';

describe('Privacy policy Section 11 — PII redaction alignment', () => {
  describe('Auth / credential surface (P13 + Section 11 explicit)', () => {
    it('redacts passwords at any nesting depth', () => {
      const out = redactPII({
        password: 'hunter2',
        nested: { password: 'p2', deep: { password: 'p3' } },
      }) as Record<string, any>;
      expect(out.password).toBe('[REDACTED]');
      expect(out.nested.password).toBe('[REDACTED]');
      expect(out.nested.deep.password).toBe('[REDACTED]');
    });

    it('redacts tokens / access_token / refresh_token / authorization', () => {
      const out = redactPII({
        token: 'eyJ...',
        access_token: 'at-...',
        refresh_token: 'rt-...',
        authorization: 'Bearer eyJ...',
      }) as Record<string, any>;
      expect(out.token).toBe('[REDACTED]');
      expect(out.access_token).toBe('[REDACTED]');
      expect(out.refresh_token).toBe('[REDACTED]');
      expect(out.authorization).toBe('[REDACTED]');
    });

    it('redacts api_key / apikey / x-api-key / service_role_key', () => {
      const out = redactPII({
        api_key: 'sk_live_xxx',
        apikey: 'sk_live_yyy',
        'x-api-key': 'sk_live_zzz',
        service_role_key: 'sr-...',
      }) as Record<string, any>;
      expect(out.api_key).toBe('[REDACTED]');
      expect(out.apikey).toBe('[REDACTED]');
      expect(out['x-api-key']).toBe('[REDACTED]');
      expect(out.service_role_key).toBe('[REDACTED]');
    });

    it('redacts cookie + set-cookie keys', () => {
      const out = redactPII({
        cookie: 'sb-access-token=abc; sb-refresh-token=def',
        'set-cookie': 'sb-access-token=new; HttpOnly',
      }) as Record<string, any>;
      expect(out.cookie).toBe('[REDACTED]');
      expect(out['set-cookie']).toBe('[REDACTED]');
    });
  });

  describe('Identity surface (Section 11 + DPDP minor protections)', () => {
    it('redacts email everywhere it appears', () => {
      const out = redactPII({
        email: 'alice@example.com',
        student: { email: 'bob@example.com' },
        contacts: [{ email: 'c@d.com' }],
      }) as Record<string, any>;
      expect(out.email).toBe('[REDACTED]');
      expect(out.student.email).toBe('[REDACTED]');
      expect(out.contacts[0].email).toBe('[REDACTED]');
    });

    it('redacts phone + parent_phone + mobile_number', () => {
      const out = redactPII({
        phone: '+919999999999',
        parent_phone: '+918888888888',
        mobile_number: '+917777777777',
      }) as Record<string, any>;
      expect(out.phone).toBe('[REDACTED]');
      expect(out.parent_phone).toBe('[REDACTED]');
      expect(out.mobile_number).toBe('[REDACTED]');
    });

    it('redacts full_name / first_name / last_name (D7 #4 expansion)', () => {
      const out = redactPII({
        full_name: 'Alice Sharma',
        first_name: 'Alice',
        last_name: 'Sharma',
      }) as Record<string, any>;
      expect(out.full_name).toBe('[REDACTED]');
      expect(out.first_name).toBe('[REDACTED]');
      expect(out.last_name).toBe('[REDACTED]');
    });

    it('redacts school_name + school_address', () => {
      const out = redactPII({
        school_name: 'DPS RK Puram',
        school_address: '12 Rajpath, New Delhi',
      }) as Record<string, any>;
      expect(out.school_name).toBe('[REDACTED]');
      expect(out.school_address).toBe('[REDACTED]');
    });

    it('does NOT over-redact bare `name` (event_name, subject_name etc. legitimate)', () => {
      // The base redactor MUST NOT eat fields like `event_name`, `subject_name`,
      // `class_name`, `name` (when used as a generic label). PostHog has its
      // own narrower deny list for analytics-event payloads where bare `name`
      // is a known PII vector. Keep the base redactor coarse-grained.
      const out = redactPII({
        event_name: 'quiz_graded',
        subject_name: 'Mathematics',
        name: 'morning_session_v1',
      }) as Record<string, any>;
      expect(out.event_name).toBe('quiz_graded');
      expect(out.subject_name).toBe('Mathematics');
      expect(out.name).toBe('morning_session_v1');
    });
  });

  describe('Payment surface (Section 2.6 + P11)', () => {
    it('redacts razorpay_signature + razorpay_webhook_signature', () => {
      const out = redactPII({
        razorpay_signature: 'sig_abc123',
        razorpay_webhook_signature: 'sig_def456',
        razorpay_payment_id: 'pay_xxx', // OK to log per Section 2.6
      }) as Record<string, any>;
      expect(out.razorpay_signature).toBe('[REDACTED]');
      expect(out.razorpay_webhook_signature).toBe('[REDACTED]');
      // Payment IDs are explicitly allowed by the policy (used for support).
      expect(out.razorpay_payment_id).toBe('pay_xxx');
    });

    it('redacts full card data per Section 2.6 ("we do NOT store full card numbers, CVV…")', () => {
      const out = redactPII({
        card_number: '4242 4242 4242 4242',
        card_cvv: '123',
        card_expiry: '12/34',
        card_holder: 'Alice Sharma',
      }) as Record<string, any>;
      expect(out.card_number).toBe('[REDACTED]');
      expect(out.card_cvv).toBe('[REDACTED]');
      expect(out.card_expiry).toBe('[REDACTED]');
      expect(out.card_holder).toBe('[REDACTED]');
    });

    it('redacts UPI handles + PIN', () => {
      const out = redactPII({
        upi_id: 'alice@okicici',
        vpa: 'alice@paytm',
        upi_pin: '1234',
      }) as Record<string, any>;
      expect(out.upi_id).toBe('[REDACTED]');
      expect(out.vpa).toBe('[REDACTED]');
      expect(out.upi_pin).toBe('[REDACTED]');
    });
  });

  describe('Network identifiers (DPDP Act minimization for minors)', () => {
    // ip_address is INTENTIONALLY NOT in the base redactor — see comment in
    // supabase/functions/_shared/redact-pii.ts. Audit log is the documented
    // exception. The vectors that matter are handled per-surface:
    //   - Sentry: user.ip_address dropped in beforeSend (server/edge configs)
    //   - PostHog: disableGeoip + EVENT_PROPERTY_PII_KEYS includes ip_address
    it('drops user.ip_address from Sentry events (client-redact contract)', () => {
      const event = {
        user: { id: 'u1', ip_address: '203.0.113.42', email: 'a@b.com' },
      };
      const out = redactSentryEvent(event) as any;
      expect(out.user).toEqual({ id: 'u1' });
      expect(out.user.ip_address).toBeUndefined();
      expect(out.user.email).toBeUndefined();
    });
  });

  describe('Sentry client beforeSend integration', () => {
    // Spot-check that the new payment + identity keys flow through the
    // client beforeSend pipeline (which routes through redactPII for
    // extra/contexts/tags/breadcrumbs).
    it('redacts payment fields embedded in Sentry extra', () => {
      const event = {
        extra: {
          // Payment context attached to a webhook error
          payment: {
            razorpay_signature: 'sig_xxx',
            card_number: '4242 4242 4242 4242',
            amount: 19900, // safe — keep
          },
        },
      };
      const out = redactSentryEvent(event) as any;
      expect(out.extra.payment.razorpay_signature).toBe('[REDACTED]');
      expect(out.extra.payment.card_number).toBe('[REDACTED]');
      expect(out.extra.payment.amount).toBe(19900);
    });

    it('redacts identity fields embedded in Sentry contexts', () => {
      const event = {
        contexts: {
          student: {
            full_name: 'Alice Sharma',
            school_name: 'DPS',
            grade: '8', // safe — keep
          },
        },
      };
      const out = redactSentryEvent(event) as any;
      expect(out.contexts.student.full_name).toBe('[REDACTED]');
      expect(out.contexts.student.school_name).toBe('[REDACTED]');
      expect(out.contexts.student.grade).toBe('8');
    });

    it('does not over-redact safe fields alongside PII', () => {
      const event = {
        extra: {
          quiz: {
            score_percent: 80,
            xp_earned: 100,
            session_id: 'sess-abc',
            email: 'a@b.com', // PII — must redact
          },
        },
      };
      const out = redactSentryEvent(event) as any;
      expect(out.extra.quiz.score_percent).toBe(80);
      expect(out.extra.quiz.xp_earned).toBe(100);
      expect(out.extra.quiz.session_id).toBe('sess-abc');
      expect(out.extra.quiz.email).toBe('[REDACTED]');
    });
  });

  describe('Privacy-policy claim → enforcement matrix (canary)', () => {
    // This single test is a tripwire: if a future patch removes a key from
    // the SENSITIVE_KEYS deny list, this fires loudly and forces the patch
    // author to update the privacy policy too. Order matters less than
    // presence — we just want every Section 11 + 2.6 + DPDP claim to map
    // to an enforced redaction.
    const POLICY_CLAIMED_PII_KEYS = [
      // Section 11 explicit
      'password', 'token', 'email', 'phone', 'api_key',
      // Section 2.6 explicit
      'card_number', 'card_cvv', 'upi_pin',
      // Section 7.1 implicit (Sentry "PII redacted") + DPDP minimization
      'full_name', 'school_name', 'razorpay_signature',
      // Section 11 explicit on auth
      'authorization', 'cookie', 'service_role_key',
      // NOTE: `ip_address` deliberately omitted — see comment in redact-pii.ts.
      // The audit log writes ip_address for security forensics; the vector
      // that matters (Sentry's user.ip_address) is handled by beforeSend.
    ];

    it.each(POLICY_CLAIMED_PII_KEYS)(
      'enforces redaction for policy-claimed key: %s',
      (key) => {
        const input = { [key]: 'leaked_value_should_be_scrubbed' };
        const out = redactPII(input) as Record<string, any>;
        expect(out[key]).toBe('[REDACTED]');
      },
    );
  });
});
