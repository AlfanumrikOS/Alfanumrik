import { describe, it, expect } from 'vitest';
import { redactPII } from '@/lib/ops-events-redactor';

describe('redactPII', () => {
  it('redacts top-level sensitive keys', () => {
    const input = { username: 'alice', password: 'hunter2', token: 'abc', api_key: 'sk_xxx', note: 'safe' };
    const out = redactPII(input) as Record<string, any>;
    expect(out.username).toBe('alice');
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.note).toBe('safe');
  });

  it('redacts nested sensitive keys', () => {
    const out = redactPII({ user: { email: 'a@b.com', name: 'Alice' } }) as any;
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.user.name).toBe('Alice');
  });

  it('redacts inside arrays', () => {
    const out = redactPII({ items: [{ email: 'a@b.com' }, { email: 'c@d.com' }] }) as any;
    expect(out.items[0].email).toBe('[REDACTED]');
    expect(out.items[1].email).toBe('[REDACTED]');
  });

  it('handles circular references without infinite recursion', () => {
    const a: any = { name: 'Alice' };
    a.self = a;
    expect(() => redactPII(a)).not.toThrow();
  });

  it('returns a new object (does not mutate input)', () => {
    const input = { password: 'hunter2' };
    const out = redactPII(input) as any;
    expect(input.password).toBe('hunter2');
    expect(out.password).toBe('[REDACTED]');
  });

  it('covers all default sensitive keys', () => {
    const keys = ['password', 'token', 'secret', 'email', 'phone', 'api_key', 'access_token', 'refresh_token', 'service_role_key', 'authorization', 'cookie'];
    const input: Record<string, string> = {};
    for (const k of keys) input[k] = 'sensitive';
    const out = redactPII(input) as Record<string, string>;
    for (const k of keys) expect(out[k]).toBe('[REDACTED]');
  });
});