import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NULL_TENANT } from '@alfanumrik/lib/types';

// Mock @sentry/nextjs so we can assert tag calls without an SDK init.
vi.mock('@sentry/nextjs', () => ({
  setTag: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import { setSentrySchoolContext } from '@alfanumrik/lib/sentry/school-context';

describe('setSentrySchoolContext', () => {
  beforeEach(() => {
    vi.mocked(Sentry.setTag).mockClear();
  });

  it('sets school_id, school_slug, school_plan tags when ctx has a schoolId', () => {
    setSentrySchoolContext({
      schoolId: '11111111-1111-1111-1111-111111111111',
      schoolSlug: 'dps-rohini',
      schoolName: 'DPS Rohini',
      plan: 'enterprise',
      isActive: true,
      branding: NULL_TENANT.branding,
    });

    expect(Sentry.setTag).toHaveBeenCalledWith('school_id', '11111111-1111-1111-1111-111111111111');
    expect(Sentry.setTag).toHaveBeenCalledWith('school_slug', 'dps-rohini');
    expect(Sentry.setTag).toHaveBeenCalledWith('school_plan', 'enterprise');
    expect(Sentry.setTag).toHaveBeenCalledTimes(3);
  });

  it('skips slug + plan tags when those fields are null', () => {
    setSentrySchoolContext({
      schoolId: '22222222-2222-2222-2222-222222222222',
      schoolSlug: null,
      schoolName: null,
      // Plan defaults to 'free' in the parser; explicit null here exercises the guard.
      plan: '' as unknown as string,
      isActive: true,
      branding: NULL_TENANT.branding,
    });

    expect(Sentry.setTag).toHaveBeenCalledWith('school_id', '22222222-2222-2222-2222-222222222222');
    // No school_slug call.
    expect(Sentry.setTag).not.toHaveBeenCalledWith('school_slug', expect.anything());
    // No school_plan call (empty string is falsy).
    expect(Sentry.setTag).not.toHaveBeenCalledWith('school_plan', expect.anything());
    expect(Sentry.setTag).toHaveBeenCalledTimes(1);
  });

  it('no-ops for NULL_TENANT (no schoolId)', () => {
    setSentrySchoolContext(NULL_TENANT);
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  it('swallows Sentry library errors instead of throwing', () => {
    vi.mocked(Sentry.setTag).mockImplementationOnce(() => {
      throw new Error('Sentry boom');
    });

    expect(() =>
      setSentrySchoolContext({
        schoolId: '33333333-3333-3333-3333-333333333333',
        schoolSlug: 'kvs-noida',
        schoolName: 'KV Noida',
        plan: 'pilot',
        isActive: true,
        branding: NULL_TENANT.branding,
      }),
    ).not.toThrow();
  });
});
