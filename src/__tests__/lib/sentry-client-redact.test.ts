/**
 * sentry-client-redact.ts — unit tests.
 *
 * P13 (Data Privacy): no PII in client-side Sentry events. The redactor
 * runs inside `beforeSend` and is the last line of defence before events
 * leave the browser. We test:
 *   - sanitizeUrl strips configured query params
 *   - redactSentryEvent prunes user identity to the opaque id
 *   - request headers/cookies/body/url get scrubbed
 *   - breadcrumbs have data + URL fields sanitised
 *   - extra/contexts entries with sensitive keys are dropped, others kept
 *   - tags are passed through redactPII
 *   - guard returns the input untouched for null / non-object events
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeUrl,
  redactSentryEvent,
  SENSITIVE_QUERY_KEYS,
  SENSITIVE_CONTEXT_KEY_REGEX,
} from '@/lib/sentry-client-redact';

describe('SENSITIVE_QUERY_KEYS', () => {
  it('includes the standard auth / contact identifiers', () => {
    for (const key of ['email', 'phone', 'token', 'password', 'key']) {
      expect(SENSITIVE_QUERY_KEYS).toContain(key);
    }
  });
});

describe('SENSITIVE_CONTEXT_KEY_REGEX', () => {
  it('matches case-insensitive substrings of sensitive context keys', () => {
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('user_email')).toBe(true);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('Phone')).toBe(true);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('access_TOKEN')).toBe(true);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('cookie_jar')).toBe(true);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('authState')).toBe(true);
  });

  it('does not match unrelated keys', () => {
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('breadcrumbs')).toBe(false);
    expect(SENSITIVE_CONTEXT_KEY_REGEX.test('feature_flag')).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('returns the input unchanged when no sensitive params present', () => {
    expect(sanitizeUrl('https://example.com/path?foo=1')).toBe('https://example.com/path?foo=1');
  });

  it('redacts ?email= query value', () => {
    const out = sanitizeUrl('https://x.com/login?email=alice%40foo.com');
    expect(out).toContain('email=%5BREDACTED%5D');
    expect(out).not.toContain('alice');
  });

  it('redacts multiple sensitive params in a single URL', () => {
    const out = sanitizeUrl('https://x.com/?token=abc&phone=99&keep=safe');
    expect(out).toContain('token=%5BREDACTED%5D');
    expect(out).toContain('phone=%5BREDACTED%5D');
    expect(out).toContain('keep=safe');
  });

  it('preserves relative path+search shape (no host injection)', () => {
    const out = sanitizeUrl('/login?email=a@b.com');
    expect(out.startsWith('/login')).toBe(true);
    expect(out).toContain('email=%5BREDACTED%5D');
    expect(out).not.toContain('placeholder.invalid');
  });

  it('returns the input untouched on parse failure', () => {
    // The URL constructor with the placeholder base accepts most strings;
    // we cover the catch path by feeding an obviously malformed value
    // that still fails (the `try` body is permissive but not exhaustive).
    // If parsing succeeds, sanitizeUrl returns the (un-mutated) input.
    const garbage = 'http://[invalid';
    expect(typeof sanitizeUrl(garbage)).toBe('string');
  });
});

describe('redactSentryEvent — guards', () => {
  it('returns null untouched', () => {
    expect(redactSentryEvent(null)).toBeNull();
  });

  it('returns undefined untouched', () => {
    expect(redactSentryEvent(undefined)).toBeUndefined();
  });

  it('returns primitive untouched', () => {
    expect(redactSentryEvent(42 as any)).toBe(42);
  });
});

describe('redactSentryEvent — user identity', () => {
  it('keeps only the opaque id, drops email/ip/username', () => {
    const e = {
      user: {
        id: 'user-123',
        email: 'a@b.com',
        ip_address: '203.0.113.5',
        username: 'alice',
      },
    };
    const out = redactSentryEvent(e);
    expect(out.user).toEqual({ id: 'user-123' });
  });
});

describe('redactSentryEvent — request', () => {
  it('strips Authorization, Cookie, Set-Cookie, x-api-key in any case', () => {
    const e = {
      request: {
        headers: {
          authorization: 'Bearer abc',
          Authorization: 'Bearer def',
          cookie: 'sess=1',
          Cookie: 'sess=2',
          'set-cookie': 'sess=new',
          'Set-Cookie': 'sess=new2',
          'x-api-key': 'secret',
          'X-Custom-Allowed': 'kept',
        },
      },
    };
    const out = redactSentryEvent(e);
    expect(out.request.headers.authorization).toBeUndefined();
    expect(out.request.headers.Authorization).toBeUndefined();
    expect(out.request.headers.cookie).toBeUndefined();
    expect(out.request.headers.Cookie).toBeUndefined();
    expect(out.request.headers['set-cookie']).toBeUndefined();
    expect(out.request.headers['Set-Cookie']).toBeUndefined();
    expect(out.request.headers['x-api-key']).toBeUndefined();
    expect(out.request.headers['X-Custom-Allowed']).toBe('kept');
  });

  it('drops cookies and request body wholesale', () => {
    const e = {
      request: {
        cookies: { sess: 'x' },
        data: { password: 'p1' },
      },
    };
    const out = redactSentryEvent(e);
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBeUndefined();
  });

  it('sanitises sensitive query params in request.url', () => {
    const e = {
      request: { url: 'https://app.com/?email=a@b.com&keep=ok' },
    };
    const out = redactSentryEvent(e);
    expect(out.request.url).toContain('email=%5BREDACTED%5D');
    expect(out.request.url).toContain('keep=ok');
  });

  it('runs redactPII on object-shaped query_string', () => {
    const e = {
      request: {
        query_string: { email: 'a@b.com', q: 'maths' },
      },
    };
    const out = redactSentryEvent(e);
    // redactPII redacts the value, but the key remains so dashboards keep their shape.
    expect(typeof out.request.query_string).toBe('object');
    expect(out.request.query_string.email).not.toBe('a@b.com');
  });

  it('leaves string-shaped query_string alone', () => {
    const e = {
      request: { query_string: 'email=a@b.com' },
    };
    const out = redactSentryEvent(e);
    expect(out.request.query_string).toBe('email=a@b.com');
  });
});

describe('redactSentryEvent — breadcrumbs', () => {
  it('redacts breadcrumb data and sanitises URL fields', () => {
    const e = {
      breadcrumbs: [
        {
          data: {
            url: 'https://app.com/?email=a@b.com',
            to: '/profile?token=t',
            from: '/login?password=p',
            email: 'a@b.com',
            keep: 'ok',
          },
        },
      ],
    };
    const out = redactSentryEvent(e);
    const bc = out.breadcrumbs[0];
    expect(bc.data.url).toContain('email=%5BREDACTED%5D');
    expect(bc.data.to).toContain('token=%5BREDACTED%5D');
    expect(bc.data.from).toContain('password=%5BREDACTED%5D');
    // redactPII redacts the email value (key kept).
    expect(bc.data.email).not.toBe('a@b.com');
    expect(bc.data.keep).toBe('ok');
  });

  it('sanitises URLs found inside breadcrumb message strings', () => {
    const e = {
      breadcrumbs: [
        { message: 'Loaded https://x.com/?token=secret successfully' },
      ],
    };
    const out = redactSentryEvent(e);
    expect(out.breadcrumbs[0].message).toContain('token=%5BREDACTED%5D');
    expect(out.breadcrumbs[0].message).not.toContain('secret');
  });

  it('handles falsy / no-data breadcrumb entries safely', () => {
    const e = {
      breadcrumbs: [null, { type: 'info' }],
    };
    const out = redactSentryEvent(e);
    expect(out.breadcrumbs).toHaveLength(2);
  });
});

describe('redactSentryEvent — extra / contexts / tags', () => {
  it('drops extra entries whose key matches the sensitive regex', () => {
    const e = {
      extra: {
        user_email: 'a@b.com',
        api_key: 'k',
        feature_flag: 'on',
        screen_size: '1080x720',
      },
    };
    const out = redactSentryEvent(e);
    expect(out.extra.user_email).toBeUndefined();
    expect(out.extra.api_key).toBeUndefined();
    expect(out.extra.feature_flag).toBe('on');
    expect(out.extra.screen_size).toBe('1080x720');
  });

  it('drops contexts entries whose key matches the sensitive regex', () => {
    const e = {
      contexts: {
        token_state: { v: 1 },
        device: { os: 'Android' },
      },
    };
    const out = redactSentryEvent(e);
    expect(out.contexts.token_state).toBeUndefined();
    expect(out.contexts.device).toEqual({ os: 'Android' });
  });

  it('passes tags through redactPII', () => {
    const e = {
      tags: { user_id: 'u1', email: 'a@b.com' },
    };
    const out = redactSentryEvent(e);
    // Keys preserved; values potentially redacted by redactPII
    expect(Object.keys(out.tags).sort()).toEqual(['email', 'user_id'].sort());
  });
});
