/**
 * REG-64 — PostHog server-side PII redactor (P13).
 *
 * Pins the contract for `redactPII()` in `src/lib/posthog/server.ts`. This
 * redactor is the layer-1 wall before any server-side PostHog event leaves
 * the Vercel function. P13 (Data Privacy) requires that no PII reaches
 * PostHog: not email, not phone, not full_name, not razorpay_signature, not
 * ip_address, not auth tokens.
 *
 * Why this regression exists:
 *   The Marking-Authenticity Wave 2 (2026-05-04) introduced server-side
 *   PostHog events for quiz grading + payment lifecycle. The base redactor
 *   (`@/lib/ops-events-redactor`) covers a common subset; the PostHog wrapper
 *   adds payment-surface and identity keys (EVENT_PROPERTY_PII_KEYS in
 *   `src/lib/posthog/types.ts`). If a future patch adds a new key to the
 *   PostHog surface without adding it to the deny set, this test catches it.
 *
 * Strategy: pure unit test. No env, no network, no SDK boot — we exercise
 * `redactPII` against synthetic shapes.
 */

import { describe, it, expect } from 'vitest';
import { redactPII } from '@/lib/posthog/server';
import { EVENT_PROPERTY_PII_KEYS } from '@/lib/posthog/types';

describe('redactPII — top-level PII keys are redacted', () => {
  it('redacts email at top level', () => {
    const out = redactPII({ email: 'alice@example.com', score: 90 });
    expect(out.email).toBe('[REDACTED]');
    expect(out.score).toBe(90);
  });

  it('redacts phone, parent_phone, full_name, school_name, school_address', () => {
    const input = {
      phone: '+919999999999',
      parent_phone: '+918888888888',
      full_name: 'Alice Sharma',
      school_name: 'DPS RK Puram',
      school_address: '12 Rajpath, New Delhi',
      grade: '8',
    };
    const out = redactPII(input);
    expect(out.phone).toBe('[REDACTED]');
    expect(out.parent_phone).toBe('[REDACTED]');
    expect(out.full_name).toBe('[REDACTED]');
    expect(out.school_name).toBe('[REDACTED]');
    expect(out.school_address).toBe('[REDACTED]');
    // Non-PII allowlisted shapes pass through untouched
    expect(out.grade).toBe('8');
  });

  it('redacts razorpay_signature and payment_card_* keys', () => {
    const out = redactPII({
      razorpay_signature: 'abcdef0123',
      card_number: '4242 4242 4242 4242',
      card_cvv: '123',
      card_expiry: '12/34',
      card_holder: 'A. Sharma',
      upi_id: 'alice@okicici',
      vpa: 'alice@paytm',
      amount: 19900,
      currency: 'INR',
    });
    expect(out.razorpay_signature).toBe('[REDACTED]');
    expect(out.card_number).toBe('[REDACTED]');
    expect(out.card_cvv).toBe('[REDACTED]');
    expect(out.card_expiry).toBe('[REDACTED]');
    expect(out.card_holder).toBe('[REDACTED]');
    expect(out.upi_id).toBe('[REDACTED]');
    expect(out.vpa).toBe('[REDACTED]');
    expect(out.amount).toBe(19900);
    expect(out.currency).toBe('INR');
  });

  it('redacts ip_address and ip', () => {
    const out = redactPII({ ip_address: '203.0.113.42', ip: '203.0.113.42', user_agent: 'Mozilla/5.0' });
    expect(out.ip_address).toBe('[REDACTED]');
    expect(out.ip).toBe('[REDACTED]');
    expect(out.user_agent).toBe('[REDACTED]');
  });

  it('redacts auth/credential keys via base redactor', () => {
    const out = redactPII({
      password: 'hunter2',
      token: 'eyJhbGc...',
      access_token: 'at-...',
      refresh_token: 'rt-...',
      api_key: 'sk_live_...',
      authorization: 'Bearer eyJ...',
      cookie: 'session=abc',
      service_role_key: 'sr-...',
    });
    // Base redactor handles these — names match SENSITIVE_KEYS in
    // supabase/functions/_shared/redact-pii.ts.
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
    expect(out.service_role_key).toBe('[REDACTED]');
  });
});

describe('redactPII — recursive (nested objects + arrays)', () => {
  it('redacts PII inside nested objects', () => {
    const out = redactPII({
      user: { email: 'a@b.com', grade: '8' },
      session: { id: 'sess-1', meta: { phone: '+919999' } },
    }) as Record<string, any>;
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.user.grade).toBe('8');
    expect(out.session.id).toBe('sess-1');
    expect(out.session.meta.phone).toBe('[REDACTED]');
  });

  it('redacts PII inside arrays of objects', () => {
    const out = redactPII({
      contacts: [
        { name: 'Alice', email: 'a@b.com' },
        { name: 'Bob', phone: '+918888' },
      ],
    }) as Record<string, any>;
    expect(out.contacts[0].email).toBe('[REDACTED]');
    expect(out.contacts[0].name).toBe('[REDACTED]');
    expect(out.contacts[1].phone).toBe('[REDACTED]');
    expect(out.contacts[1].name).toBe('[REDACTED]');
  });

  it('handles deeply nested PII (3+ levels)', () => {
    const out = redactPII({
      a: { b: { c: { email: 'x@y.com', ok: true } } },
    }) as Record<string, any>;
    expect(out.a.b.c.email).toBe('[REDACTED]');
    expect(out.a.b.c.ok).toBe(true);
  });

  it('handles array nested 2 levels with PII', () => {
    const out = redactPII({
      events: [{ details: [{ ip_address: '1.2.3.4' }] }],
    }) as Record<string, any>;
    expect(out.events[0].details[0].ip_address).toBe('[REDACTED]');
  });
});

describe('redactPII — clone semantics (does not mutate input)', () => {
  it('does not mutate the input object', () => {
    const input = { email: 'a@b.com', grade: '8' };
    const inputClone = { ...input };
    redactPII(input);
    expect(input).toEqual(inputClone);
    expect(input.email).toBe('a@b.com');
  });

  it('does not mutate nested input objects', () => {
    const inner = { email: 'a@b.com', score: 90 };
    const input = { user: inner };
    redactPII(input);
    expect(inner.email).toBe('a@b.com');
    expect(inner.score).toBe(90);
  });

  it('does not mutate input arrays', () => {
    const arr = [{ email: 'a@b.com' }, { phone: '+919999' }];
    const input = { contacts: arr };
    const arrSnapshot = JSON.parse(JSON.stringify(arr));
    redactPII(input);
    expect(arr).toEqual(arrSnapshot);
  });
});

describe('redactPII — preserves allowlisted / non-sensitive props', () => {
  it('preserves common analytics fields untouched', () => {
    const out = redactPII({
      student_id: 'uuid-123',
      role: 'student',
      grade: '8',
      board: 'CBSE',
      plan: 'pro',
      language: 'hi',
      session_id: 'sess-abc',
      score_percent: 80,
      xp_earned: 100,
      correct: 8,
      total: 10,
    });
    // None of these are in the PII denylist; all should survive.
    expect(out.student_id).toBe('uuid-123');
    expect(out.role).toBe('student');
    expect(out.grade).toBe('8');
    expect(out.board).toBe('CBSE');
    expect(out.plan).toBe('pro');
    expect(out.language).toBe('hi');
    expect(out.session_id).toBe('sess-abc');
    expect(out.score_percent).toBe(80);
    expect(out.xp_earned).toBe(100);
    expect(out.correct).toBe(8);
    expect(out.total).toBe(10);
  });

  it('preserves null and undefined values', () => {
    const out = redactPII({ a: null, b: undefined, c: 0, d: false, e: '' });
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe(0);
    expect(out.d).toBe(false);
    expect(out.e).toBe('');
  });
});

describe('redactPII — full-shape snapshot', () => {
  it('strips every PII field while keeping every allowed field (composite event)', () => {
    const input = {
      // Allowed
      student_id: 'uuid-1',
      session_id: 'sess-1',
      grade: '8',
      board: 'CBSE',
      plan: 'pro',
      score_percent: 80,
      xp_earned: 100,
      correct: 8,
      total: 10,
      // PII (must be redacted)
      email: 'a@b.com',
      phone: '+919999',
      parent_phone: '+918888',
      full_name: 'Alice',
      name: 'Alice S',
      school_name: 'DPS',
      school_address: '12 Road',
      address: '14 Road',
      razorpay_signature: 'sigval',
      card_number: '4242 4242',
      card_cvv: '111',
      card_expiry: '12/34',
      card_holder: 'A',
      upi_id: 'a@okicici',
      vpa: 'a@paytm',
      ip_address: '1.2.3.4',
      ip: '1.2.3.4',
      user_agent: 'Mozilla',
      // Auth keys (covered by base redactor)
      password: 'pw',
      token: 'tok',
      api_key: 'ak',
    };

    const out = redactPII(input);

    // Allowed fields preserved
    expect(out.student_id).toBe('uuid-1');
    expect(out.session_id).toBe('sess-1');
    expect(out.grade).toBe('8');
    expect(out.board).toBe('CBSE');
    expect(out.plan).toBe('pro');
    expect(out.score_percent).toBe(80);
    expect(out.xp_earned).toBe(100);
    expect(out.correct).toBe(8);
    expect(out.total).toBe(10);

    // Every PII key in EVENT_PROPERTY_PII_KEYS must be redacted (or the key itself
    // dropped via base redactor — accept either signal).
    for (const piiKey of EVENT_PROPERTY_PII_KEYS) {
      if (piiKey in input) {
        expect(out[piiKey]).toBe('[REDACTED]');
      }
    }
  });

  it('EVENT_PROPERTY_PII_KEYS contains the documented critical keys', () => {
    // Pin the deny set so a future delete is loud.
    for (const required of [
      'email',
      'phone',
      'parent_phone',
      'full_name',
      'name',
      'school_name',
      'school_address',
      'razorpay_signature',
      'card_number',
      'card_cvv',
      'card_expiry',
      'card_holder',
      'upi_id',
      'vpa',
      'ip_address',
      'ip',
      'user_agent',
    ]) {
      expect(EVENT_PROPERTY_PII_KEYS.has(required)).toBe(true);
    }
  });
});
