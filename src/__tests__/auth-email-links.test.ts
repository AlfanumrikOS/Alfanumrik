import { describe, it, expect } from 'vitest';
import { buildAuthActionUrl } from '../../supabase/functions/_shared/auth-email-links';

describe('buildAuthActionUrl', () => {
  it('builds the signup confirmation URL from token_hash', () => {
    expect(buildAuthActionUrl({
      baseSiteUrl: 'https://alfanumrik.com',
      emailActionType: 'signup',
      tokenHash: 'abc123',
      redirectTo: 'https://alfanumrik.com/auth/callback?type=signup',
      email: 'user@example.com',
    })).toBe('https://alfanumrik.com/auth/confirm?token_hash=abc123&type=signup&next=%2Fauth%2Fcallback%3Ftype%3Dsignup');
  });

  it('routes legacy token links through /auth/confirm with the email address', () => {
    expect(buildAuthActionUrl({
      baseSiteUrl: 'https://alfanumrik.com',
      emailActionType: 'magic_link',
      token: 'legacy-token',
      email: 'user@example.com',
    })).toBe('https://alfanumrik.com/auth/confirm?token=legacy-token&type=magic_link&email=user%40example.com');
  });

  it('falls back to dashboard when no token data exists', () => {
    expect(buildAuthActionUrl({
      baseSiteUrl: 'https://alfanumrik.com',
      emailActionType: 'signup',
    })).toBe('https://alfanumrik.com/dashboard');
  });
});
