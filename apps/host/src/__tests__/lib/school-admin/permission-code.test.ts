import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 3B Wave C — schoolAdminPermissionCode selector tests (NO DB).
 *
 * The selector is a PURE flag-conditional chooser: it makes no auth decision, it
 * only picks WHICH permission string a route hands to authorizeSchoolAdmin so the
 * code can deploy AHEAD of the grants migration (flag-OFF → the route's original
 * pre-Wave-C code; flag-ON → the CEO-approved matrix code). We mock only
 * isFeatureEnabled and assert the off/on branch + that the flag is read.
 */

const mockIsFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

import { schoolAdminPermissionCode } from '@alfanumrik/lib/school-admin/permission-code';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('schoolAdminPermissionCode', () => {
  it('returns the OFF code (pre-Wave-C original) when the flag is OFF', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const code = await schoolAdminPermissionCode({
      off: 'school.manage_billing',
      on: 'institution.manage_billing',
    });
    expect(code).toBe('school.manage_billing');
  });

  it('returns the ON code (CEO-approved matrix code) when the flag is ON', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const code = await schoolAdminPermissionCode({
      off: 'school.manage_billing',
      on: 'institution.manage_billing',
    });
    expect(code).toBe('institution.manage_billing');
  });

  it('reads the ff_school_admin_rbac flag (the Wave C master flag)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    await schoolAdminPermissionCode({ off: 'a', on: 'b' });
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(mockIsFeatureEnabled.mock.calls[0][0]).toBe('ff_school_admin_rbac');
  });

  it('passes an environment scope (mirrors the other server-side school-admin gates)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    await schoolAdminPermissionCode({ off: 'a', on: 'b' });
    const opts = mockIsFeatureEnabled.mock.calls[0][1] as { environment?: string } | undefined;
    expect(opts).toBeDefined();
    expect(typeof opts!.environment).toBe('string');
    expect(opts!.environment!.length).toBeGreaterThan(0);
  });

  it('is a pure selector — different code pairs round-trip the chosen side unchanged', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    expect(
      await schoolAdminPermissionCode({ off: 'school.view_billing', on: 'institution.view_billing' }),
    ).toBe('institution.view_billing');
    mockIsFeatureEnabled.mockResolvedValue(false);
    expect(
      await schoolAdminPermissionCode({ off: 'school.view_billing', on: 'institution.view_billing' }),
    ).toBe('school.view_billing');
  });
});
