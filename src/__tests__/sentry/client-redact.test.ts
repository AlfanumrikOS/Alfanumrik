/**
 * Sentry client redaction (P13).
 *
 * The browser Sentry SDK runs `beforeSend` on every event, which calls
 * `redactSentryEvent` from src/lib/sentry-client-redact.ts. This file
 * exercises the redactor directly (without booting Sentry) so we can
 * regress every code path:
 *   - user identity → only opaque id survives
 *   - request headers → Authorization / Cookie / Set-Cookie / x-api-key stripped
 *   - request.url → sensitive query params replaced with [REDACTED]
 *   - request.data (body) → dropped wholesale
 *   - request.cookies → dropped wholesale
 *   - request.query_string (object form) → redactPII applied
 *   - extra → keys matching /email|phone|token|password|secret|key|cookie|auth/i dropped
 *   - contexts → same drop rule as extra
 *   - breadcrumbs → data redacted, url/to/from sanitised, message URLs sanitised
 *   - tags → redactPII applied
 *
 * Mirror of supabase/functions/_shared/redact-pii.ts test pattern. PII
 * leaving the browser is the highest-risk Sentry vector — every release
 * that touches Sentry config must keep this passing.
 */

import { describe, it, expect } from 'vitest';
import {
  redactSentryEvent,
  sanitizeUrl,
  SENSITIVE_QUERY_KEYS,
  SENSITIVE_CONTEXT_KEY_REGEX,
} from '@/lib/sentry-client-redact';

// ── 1. user identity ──────────────────────────────────────────────────

describe('redactSentryEvent: user identity', () => {
  it('keeps only the opaque id; drops email, ip_address, username', () => {
    const event: any = {
      user: {
        id: 'student-uuid-1',
        email: 'leaker@example.com',
        ip_address: '203.0.113.4',
        username: 'leaker',
      },
    };

    const out = redactSentryEvent(event);
    expect(out.user).toEqual({ id: 'student-uuid-1' });
    expect(out.user.email).toBeUndefined();
    expect(out.user.ip_address).toBeUndefined();
    expect(out.user.username).toBeUndefined();
  });

  it('survives missing user object', () => {
    const event: any = {};
    expect(() => redactSentryEvent(event)).not.toThrow();
  });
});

// ── 2. request headers ────────────────────────────────────────────────

describe('redactSentryEvent: request headers', () => {
  it('strips Authorization (both casings), Cookie / Set-Cookie, x-api-key', () => {
    const event: any = {
      request: {
        headers: {
          Authorization: 'Bearer sk_live_xxx',
          authorization: 'Bearer sk_live_yyy',
          Cookie: 'session=abc',
          cookie: 'session=def',
          'Set-Cookie': 'session=ghi',
          'set-cookie': 'session=jkl',
          'x-api-key': 'rzp_live_secret',
          'user-agent': 'Mozilla/5.0',
          'content-type': 'application/json',
        },
      },
    };

    const out = redactSentryEvent(event);
    const h = out.request.headers;
    expect(h.Authorization).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h.Cookie).toBeUndefined();
    expect(h.cookie).toBeUndefined();
    expect(h['Set-Cookie']).toBeUndefined();
    expect(h['set-cookie']).toBeUndefined();
    expect(h['x-api-key']).toBeUndefined();

    // Non-sensitive headers survive.
    expect(h['user-agent']).toBe('Mozilla/5.0');
    expect(h['content-type']).toBe('application/json');
  });
});

// ── 3. request URL query strings ──────────────────────────────────────

describe('redactSentryEvent: request.url query string sanitisation', () => {
  it.each([
    ['email', 'https://app.alfanumrik.com/login?email=leaker@example.com'],
    ['phone', 'https://app.alfanumrik.com/x?phone=9876543210'],
    ['token', 'https://app.alfanumrik.com/x?token=eyJhbGciOi...'],
    ['password', 'https://app.alfanumrik.com/x?password=hunter2'],
    ['key', 'https://app.alfanumrik.com/x?key=sk_live_xxx'],
  ])('replaces `%s=` query value with [REDACTED]', (param, url) => {
    const event: any = { request: { url } };
    const out = redactSentryEvent(event);
    // URL().searchParams.set encodes the literal as %5BREDACTED%5D — assert
    // either form so the test is robust to URL absolute/relative shape.
    expect(out.request.url).toMatch(/\[REDACTED\]|%5BREDACTED%5D/);
    expect(out.request.url).not.toContain(url.split('=')[1]);
    expect(SENSITIVE_QUERY_KEYS).toContain(param);
  });

  it('preserves non-sensitive query params', () => {
    const event: any = {
      request: { url: 'https://app.alfanumrik.com/x?page=2&grade=10&subject=math' },
    };
    const out = redactSentryEvent(event);
    expect(out.request.url).toContain('page=2');
    expect(out.request.url).toContain('grade=10');
    expect(out.request.url).toContain('subject=math');
  });

  it('redacts mixed query strings (email + page) but keeps the safe one', () => {
    const event: any = {
      request: { url: 'https://app.alfanumrik.com/x?page=3&email=a@b.com' },
    };
    const out = redactSentryEvent(event);
    expect(out.request.url).toContain('page=3');
    // URL-encoded [REDACTED] from URLSearchParams.set('email', '[REDACTED]').
    expect(out.request.url).toMatch(/email=(\[REDACTED\]|%5BREDACTED%5D)/);
    expect(out.request.url).not.toContain('a@b.com');
  });

  it('handles malformed URL gracefully (returns input untouched)', () => {
    const event: any = { request: { url: 'not-a-url' } };
    const out = redactSentryEvent(event);
    expect(out.request.url).toBe('not-a-url');
  });
});

describe('sanitizeUrl: helper edge cases', () => {
  it('redacts case-insensitive matches (Email, TOKEN, etc)', () => {
    const out = sanitizeUrl('https://x.test/?Email=a@b.com&TOKEN=abc');
    expect(out).toMatch(/\[REDACTED\]|%5BREDACTED%5D/);
    expect(out).not.toContain('a@b.com');
    expect(out).not.toContain('abc');
  });
});

// ── 4. request body and cookies ───────────────────────────────────────

describe('redactSentryEvent: request body and cookies', () => {
  it('drops request.data wholesale (browser bodies are never safe)', () => {
    const event: any = {
      request: {
        data: { email: 'a@b.com', form: { password: 'hunter2' } },
        url: 'https://x.test/',
      },
    };
    const out = redactSentryEvent(event);
    expect(out.request.data).toBeUndefined();
  });

  it('drops request.cookies wholesale', () => {
    const event: any = {
      request: { cookies: { session: 'abc', auth: 'xyz' } },
    };
    const out = redactSentryEvent(event);
    expect(out.request.cookies).toBeUndefined();
  });

  it('redacts object-form request.query_string with redactPII', () => {
    const event: any = {
      request: {
        query_string: { email: 'a@b.com', page: '2' },
      },
    };
    const out = redactSentryEvent(event);
    expect(out.request.query_string.email).toBe('[REDACTED]');
    expect(out.request.query_string.page).toBe('2');
  });
});

// ── 5. extra and contexts (key-name dropping) ─────────────────────────

describe('redactSentryEvent: extra/contexts key-name filtering', () => {
  it('drops extra entries whose key matches the sensitive regex', () => {
    const event: any = {
      extra: {
        user_email: 'leak@example.com',
        password_hash: 'abc',
        access_token: 'xxx',
        cookie_value: 'yyy',
        auth_header: 'Bearer xxx',
        secret_key: 'zzz',
        page: 'dashboard',
        latency_ms: 123,
      },
    };

    const out = redactSentryEvent(event);
    expect(out.extra.user_email).toBeUndefined();
    expect(out.extra.password_hash).toBeUndefined();
    expect(out.extra.access_token).toBeUndefined();
    expect(out.extra.cookie_value).toBeUndefined();
    expect(out.extra.auth_header).toBeUndefined();
    expect(out.extra.secret_key).toBeUndefined();
    expect(out.extra.page).toBe('dashboard');
    expect(out.extra.latency_ms).toBe(123);
  });

  it('the regex matches every documented key prefix', () => {
    for (const k of ['email', 'phone', 'token', 'password', 'secret', 'key', 'cookie', 'auth']) {
      expect(SENSITIVE_CONTEXT_KEY_REGEX.test(`my_${k}`)).toBe(true);
      expect(SENSITIVE_CONTEXT_KEY_REGEX.test(k.toUpperCase())).toBe(true);
    }
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('latency')).toBe(false);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('grade')).toBe(false);
  });

  it('runs redactPII on remaining extra values (nested PII)', () => {
    const event: any = {
      extra: {
        page: 'dashboard',
        debug: { email: 'a@b.com', step: 'click' },
      },
    };
    const out = redactSentryEvent(event);
    expect(out.extra.page).toBe('dashboard');
    expect(out.extra.debug.email).toBe('[REDACTED]');
    expect(out.extra.debug.step).toBe('click');
  });

  it('drops contexts entries whose key matches sensitive regex', () => {
    const event: any = {
      contexts: {
        device: { name: 'iPhone' },
        auth_state: { signed_in: true },
        user_email: 'leak@example.com',
      },
    };
    const out = redactSentryEvent(event);
    expect(out.contexts.device).toBeDefined();
    expect(out.contexts.auth_state).toBeUndefined();
    expect(out.contexts.user_email).toBeUndefined();
  });
});

// ── 6. breadcrumbs ────────────────────────────────────────────────────

describe('redactSentryEvent: breadcrumbs', () => {
  it('redactPIIs breadcrumb data and sanitises url/to/from fields', () => {
    const event: any = {
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: 'https://x.test/?email=a@b.com',
            to: 'https://x.test/dash?token=abc',
            url: 'https://x.test/?password=hunter2',
            page: 'home',
            email: 'leak@example.com',
          },
          message: 'navigated from https://x.test/?email=a@b.com to home',
        },
      ],
    };

    const out = redactSentryEvent(event);
    const bc = out.breadcrumbs[0];
    expect(bc.data.from).not.toContain('a@b.com');
    expect(bc.data.to).not.toContain('abc');
    expect(bc.data.url).not.toContain('hunter2');
    // redactPII drops the email value to [REDACTED] but key survives.
    expect(bc.data.email).toBe('[REDACTED]');
    expect(bc.data.page).toBe('home');
    // Message URL is sanitised inline.
    expect(bc.message).not.toContain('a@b.com');
    expect(bc.message).toMatch(/\[REDACTED\]|%5BREDACTED%5D/);
  });

  it('handles missing data and missing message safely', () => {
    const event: any = {
      breadcrumbs: [{ category: 'click' }, null, { message: 'plain text' }],
    };
    expect(() => redactSentryEvent(event)).not.toThrow();
    const out = redactSentryEvent(event);
    expect(out.breadcrumbs).toHaveLength(3);
  });
});

// ── 7. tags ───────────────────────────────────────────────────────────

describe('redactSentryEvent: tags', () => {
  it('runs redactPII on tags (drops password/token/email values)', () => {
    const event: any = {
      tags: { route: '/dashboard', email: 'a@b.com', token: 'abc' },
    };
    const out = redactSentryEvent(event);
    expect(out.tags.route).toBe('/dashboard');
    expect(out.tags.email).toBe('[REDACTED]');
    expect(out.tags.token).toBe('[REDACTED]');
  });
});

// ── 8. composite event (smoke test) ───────────────────────────────────

describe('redactSentryEvent: composite event end-to-end', () => {
  it('produces a fully scrubbed event with no PII surviving any path', () => {
    const event: any = {
      user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
      request: {
        url: 'https://x.test/login?email=a@b.com&page=1',
        headers: { Authorization: 'Bearer xx', 'user-agent': 'UA' },
        cookies: { sid: 'xxx' },
        data: { password: 'hunter2' },
      },
      extra: { user_email: 'a@b.com', page: 'home' },
      tags: { email: 'a@b.com', route: '/login' },
      breadcrumbs: [
        { data: { url: 'https://x.test/?token=abc' } },
      ],
    };

    const serialized = JSON.stringify(redactSentryEvent(event));

    // No raw PII anywhere in the serialised payload.
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('Bearer xx');
    expect(serialized).not.toContain('1.2.3.4');
    // The token from the breadcrumb URL must be sanitised.
    expect(serialized).not.toMatch(/\?token=abc/);
    expect(serialized).not.toMatch(/&token=abc/);

    // Useful debug context still survives.
    expect(serialized).toContain('"id":"u1"');
    expect(serialized).toContain('"page":"home"');
    expect(serialized).toContain('"route":"/login"');
  });
});
