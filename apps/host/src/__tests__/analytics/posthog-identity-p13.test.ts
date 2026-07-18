/**
 * REG-270 — PostHog identity + funnel-event PII boundary (P13).
 *
 * The EU-analytics turn-on (branch feat/instrument-b2c-funnel-analytics,
 * commits d545287f + e68916f5) consolidated three PostHog `identify()` call
 * sites onto the EU project (159341). This regression pins the P13 (Data
 * Privacy) contract that survives that consolidation:
 *
 * (a) IDENTITY — every identify() path hashes the caller's id BEFORE the SDK
 *     sees it. The distinct_id passed to `posthog.identify` is ALWAYS the
 *     16-hex SHA-256 prefix from `hashUserIdForAnalytics()`, NEVER a raw
 *     student_id / auth_user_id / UUID. Asserted across all three paths:
 *       1. packages/lib/src/PostHogProvider.tsx  → posthogIdentify({student_id})
 *       2. packages/lib/src/posthog/client.ts     → identify(rawUserId)
 *       3. packages/lib/src/analytics.ts          → identifyUser(authUserId)
 *     A raw-UUID-shaped distinct_id (/^[0-9a-f]{8}-[0-9a-f]{4}-/i) must NEVER
 *     reach posthog.identify.
 *
 * (b) FUNNEL EVENTS — the 7 B2C funnel events emit no property KEY matching
 *     /name|email|phone|token|card|signature/i and no PII-shaped VALUE (email
 *     address, bare phone number, raw UUID). `foxy_message_sent` carries NO
 *     message text (only subject/mode/language). The two-pass redactor in
 *     analytics.ts scrubs PII VALUES even when a caller accidentally passes
 *     them.
 *
 * Strategy: mock ONLY `posthog-js` (and `posthog-js/react`) so we can spy on
 * the real `posthog.identify` / `posthog.capture` calls. Everything else —
 * the hashing, the redaction pipeline, the fan-out — runs for real. Web Crypto
 * (`crypto.subtle`) is available under vitest/JSDOM, so hashes are genuine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted spies — stable across `vi.resetModules()` so both the static import
// (PostHogProvider) and the dynamic imports (posthog-client / posthog/client)
// resolve to the SAME spy instances.
const { initSpy, captureSpy, identifySpy, resetSpy } = vi.hoisted(() => ({
  initSpy: vi.fn(),
  captureSpy: vi.fn(),
  identifySpy: vi.fn(),
  resetSpy: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    init: initSpy,
    capture: captureSpy,
    identify: identifySpy,
    reset: resetSpy,
    debug: vi.fn(),
  },
}));

// PostHogProvider.tsx imports the React binding at module top-level. Mock it so
// importing the module doesn't drag in the real posthog-js internals.
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: unknown }) => children,
}));

// A canonical raw Supabase auth UUID and the two shape guards.
const RAW_UUID = '11111111-2222-3333-4444-555555555555';
const RAW_UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RAW_UUID_C = '00000000-1111-2222-3333-444444444444';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const HASH_SHAPE = /^[0-9a-f]{16}$/;

const originalEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const originalHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

beforeEach(() => {
  vi.resetModules();
  initSpy.mockClear();
  captureSpy.mockClear();
  identifySpy.mockClear();
  resetSpy.mockClear();
  // Env is read at module-load time by PostHogProvider (top-level consts), so
  // it MUST be set before the per-test dynamic import.
  (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
  (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
});

afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete (process.env as Record<string, string>)[k];
    else (process.env as Record<string, string>)[k] = v;
  };
  restore('NEXT_PUBLIC_POSTHOG_ENABLED', originalEnabled);
  restore('NEXT_PUBLIC_POSTHOG_KEY', originalKey);
  restore('NEXT_PUBLIC_POSTHOG_HOST', originalHost);
  delete (window as unknown as { va?: unknown }).va;
});

describe('REG-270 (a) — every identify() path sends a 16-hex hash, never a raw UUID (P13)', () => {
  it('PostHogProvider.posthogIdentify hashes student_id before posthog.identify', async () => {
    const mod = await import('@alfanumrik/lib/PostHogProvider');
    // posthogIdentify awaits the hash then calls posthog.identify synchronously,
    // so a single await guarantees the SDK call has happened.
    await mod.posthogIdentify({
      student_id: RAW_UUID,
      grade: '8',
      plan: 'pro',
      language: 'en',
      board: 'CBSE',
    });

    expect(identifySpy).toHaveBeenCalledTimes(1);
    const [distinctId, props] = identifySpy.mock.calls[0]!;
    expect(distinctId).toMatch(HASH_SHAPE);
    expect(distinctId).not.toMatch(UUID_SHAPE);
    expect(distinctId).not.toBe(RAW_UUID);
    // The raw UUID must not leak anywhere in the person properties either.
    expect(JSON.stringify(props)).not.toContain(RAW_UUID);
    // The person-property hash mirror is the SAME hashed value, not the UUID.
    expect((props as Record<string, unknown>).distinct_id_hash).toBe(distinctId);
  });

  it('posthog/client.identify hashes the raw userId internally', async () => {
    const mod = await import('@alfanumrik/lib/posthog/client');
    mod.identify(RAW_UUID, { grade: '8', plan: 'pro' });

    await vi.waitFor(() => expect(identifySpy).toHaveBeenCalledTimes(1));
    const [distinctId] = identifySpy.mock.calls[0]!;
    expect(distinctId).toMatch(HASH_SHAPE);
    expect(distinctId).not.toMatch(UUID_SHAPE);
    expect(distinctId).not.toBe(RAW_UUID);
  });

  it('analytics.identifyUser hashes the auth UUID before dispatch', async () => {
    const mod = await import('@alfanumrik/lib/analytics');
    await mod.identifyUser(RAW_UUID, { role: 'student', grade: '8', plan: 'pro' });

    await vi.waitFor(() => expect(identifySpy).toHaveBeenCalledTimes(1));
    const [distinctId] = identifySpy.mock.calls[0]!;
    expect(distinctId).toMatch(HASH_SHAPE);
    expect(distinctId).not.toMatch(UUID_SHAPE);
    expect(distinctId).not.toBe(RAW_UUID);
  });

  it('no identify() call from ANY of the three paths ever receives a UUID-shaped distinct_id', async () => {
    const provider = await import('@alfanumrik/lib/PostHogProvider');
    const typedClient = await import('@alfanumrik/lib/posthog/client');
    const analytics = await import('@alfanumrik/lib/analytics');

    // Distinct raw UUIDs so per-path in-memory identity dedup never suppresses a call.
    await provider.posthogIdentify({
      student_id: RAW_UUID,
      grade: '8',
      plan: 'pro',
      language: 'en',
    });
    typedClient.identify(RAW_UUID_B, { grade: '9' });
    await analytics.identifyUser(RAW_UUID_C, { role: 'student', grade: '10' });

    await vi.waitFor(() => expect(identifySpy).toHaveBeenCalledTimes(3));

    for (const [distinctId] of identifySpy.mock.calls) {
      expect(String(distinctId)).toMatch(HASH_SHAPE);
      expect(String(distinctId)).not.toMatch(UUID_SHAPE);
    }
    // Belt-and-braces: none of the raw UUIDs appear as any identify argument.
    const flat = JSON.stringify(identifySpy.mock.calls);
    for (const uuid of [RAW_UUID, RAW_UUID_B, RAW_UUID_C]) {
      expect(flat).not.toContain(uuid);
    }
  });
});

describe('REG-270 (b) — the 7 B2C funnel events carry no PII (P13)', () => {
  const PII_KEY_RE = /name|email|phone|token|card|signature/i;

  // Canonical payloads matching each event's declared shape in analytics.ts.
  // `signup_complete.method === 'email'` is a method LABEL (not an email
  // address) — so the value sweep checks for actual PII shapes (an `@`, a bare
  // 10-digit phone, a UUID), never the bare keyword.
  const funnelEvents: Array<[string, Record<string, unknown>]> = [
    ['signup_complete', { role: 'student', method: 'email' }],
    ['onboarding_complete', { role: 'student', grade: '8', board: 'CBSE', subjects: ['math', 'science'] }],
    ['quiz_started', { subject: 'math', grade: '8' }],
    ['quiz_completed', { subject: 'math', score: 80, questions: 10, grade: '8', time_seconds: 120 }],
    ['foxy_message_sent', { subject: 'math', mode: 'doubt', language: 'en' }],
    ['payment_success', { plan: 'pro', amount_inr: 19900, currency: 'INR', order_id: 'order_x', subscription_id: 'sub_x', billing_cycle: 'monthly' }],
    ['daily_return', { streak_days: 5 }],
  ];

  it.each(funnelEvents)(
    '%s forwards no PII-named key and no PII-shaped value',
    async (eventName, props) => {
      const mod = await import('@alfanumrik/lib/analytics');
      (mod.track as (e: string, p: Record<string, unknown>) => void)(eventName, props);

      await vi.waitFor(() =>
        expect(captureSpy.mock.calls.some((c) => c[0] === eventName)).toBe(true),
      );
      const call = captureSpy.mock.calls.find((c) => c[0] === eventName)!;
      const forwarded = call[1] as Record<string, unknown>;

      for (const key of Object.keys(forwarded)) {
        expect(key).not.toMatch(PII_KEY_RE);
      }
      for (const value of Object.values(forwarded)) {
        if (typeof value === 'string') {
          expect(value).not.toMatch(/@/); // no email address
          expect(value).not.toMatch(/\b\d{10}\b/); // no bare 10-digit phone
          expect(value).not.toMatch(UUID_SHAPE); // no raw UUID
        }
      }
    },
  );

  it('foxy_message_sent carries ONLY subject/mode/language — no message text', async () => {
    const mod = await import('@alfanumrik/lib/analytics');
    (mod.track as (e: string, p: Record<string, unknown>) => void)('foxy_message_sent', {
      subject: 'math',
      mode: 'doubt',
      language: 'en',
    });

    await vi.waitFor(() =>
      expect(captureSpy.mock.calls.some((c) => c[0] === 'foxy_message_sent')).toBe(true),
    );
    const forwarded = captureSpy.mock.calls.find((c) => c[0] === 'foxy_message_sent')![1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(forwarded).sort()).toEqual(['language', 'mode', 'subject']);
    for (const textKey of ['message', 'text', 'content', 'body', 'prompt', 'question']) {
      expect(forwarded[textKey]).toBeUndefined();
    }
  });

  it('scrubs injected PII values from a funnel payload (two-pass redactor)', async () => {
    const mod = await import('@alfanumrik/lib/analytics');
    // A buggy caller slips PII into signup_complete. The redactor must scrub
    // the VALUES before either backend sees them.
    (mod.track as (e: string, p: Record<string, unknown>) => void)('signup_complete', {
      role: 'student',
      method: 'email',
      email: 'alice@example.com',
      phone: '+919999999999',
      full_name: 'Alice Sharma',
      name: 'Alice',
      card_number: '4242424242424242',
      razorpay_signature: 'sig123deadbeef',
      token: 'eyJhbGciOiJIUzI1NiJ9.secret',
    });

    await vi.waitFor(() =>
      expect(captureSpy.mock.calls.some((c) => c[0] === 'signup_complete')).toBe(true),
    );
    const forwarded = captureSpy.mock.calls.find((c) => c[0] === 'signup_complete')![1] as Record<
      string,
      unknown
    >;

    // Legit funnel fields survive untouched.
    expect(forwarded.role).toBe('student');
    expect(forwarded.method).toBe('email');

    // No raw PII value survives anywhere in the forwarded payload.
    const flat = JSON.stringify(forwarded);
    expect(flat).not.toContain('alice@example.com');
    expect(flat).not.toContain('+919999999999');
    expect(flat).not.toContain('Alice Sharma');
    expect(flat).not.toContain('4242424242424242');
    expect(flat).not.toContain('sig123deadbeef');
    expect(flat).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});

describe('REG-270 (c) — track("quiz_started") fan-out + grade is a string (P5)', () => {
  it('fans out to Vercel Analytics AND PostHog with subject + STRING grade', async () => {
    const va = vi.fn();
    (window as unknown as { va: (cmd: string, props: Record<string, unknown>) => void }).va = va;

    const mod = await import('@alfanumrik/lib/analytics');
    mod.track('quiz_started', { subject: 'math', grade: '8' });

    // Vercel path is synchronous.
    expect(va).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ name: 'quiz_started', subject: 'math', grade: '8' }),
    );

    // PostHog capture path is fire-and-forget (async init) — wait for it.
    await vi.waitFor(() =>
      expect(captureSpy.mock.calls.some((c) => c[0] === 'quiz_started')).toBe(true),
    );
    const props = captureSpy.mock.calls.find((c) => c[0] === 'quiz_started')![1] as Record<
      string,
      unknown
    >;
    expect(props.subject).toBe('math');
    expect(props.grade).toBe('8');
    // P5 — grade must remain a string end-to-end, never coerced to a number.
    expect(typeof props.grade).toBe('string');
  });

  it('quiz_started grade stays a string even if passed as a numeric-looking value', async () => {
    const mod = await import('@alfanumrik/lib/analytics');
    mod.track('quiz_started', { subject: 'science', grade: '12' });

    await vi.waitFor(() =>
      expect(captureSpy.mock.calls.some((c) => c[0] === 'quiz_started')).toBe(true),
    );
    const props = captureSpy.mock.calls.find((c) => c[0] === 'quiz_started')![1] as Record<
      string,
      unknown
    >;
    expect(props.grade).toBe('12');
    expect(typeof props.grade).toBe('string');
    expect(props.grade).not.toBe(12);
  });
});
