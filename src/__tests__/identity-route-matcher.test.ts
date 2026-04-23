import { describe, expect, it } from 'vitest';
import { matchIdentityRoute } from '@/lib/identity/route-matcher';

describe('matchIdentityRoute', () => {
  it('matches dynamic profile routes with a concrete user id', () => {
    expect(matchIdentityRoute('GET', '/profile/user-123')).toBe('profile');
  });

  it('does not treat the literal placeholder as the only valid profile route', () => {
    expect(matchIdentityRoute('GET', '/profile/:userId')).toBe('profile');
  });

  it('keeps existing exact routes stable', () => {
    expect(matchIdentityRoute('POST', '/resolve')).toBe('resolve');
    expect(matchIdentityRoute('GET', '/sessions')).toBe('sessions');
    expect(matchIdentityRoute('POST', '/sessions/validate')).toBe('validate-session');
    expect(matchIdentityRoute('GET', '/permissions')).toBe('permissions');
    expect(matchIdentityRoute('GET', '/onboarding-status')).toBe('onboarding-status');
  });

  it('returns not-found for unknown routes', () => {
    expect(matchIdentityRoute('GET', '/profile')).toBe('not-found');
    expect(matchIdentityRoute('DELETE', '/sessions')).toBe('not-found');
  });
});
