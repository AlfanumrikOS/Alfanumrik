import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolveExperience: vi.fn(),
  redirect: vi.fn(),
  permissions: ['system.audit'] as string[],
}));

vi.mock('@/lib/admin-auth-server', () => ({
  requireAdminOrRedirect: mocks.requireAdmin,
}));

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  adminExperiencePermissions: () => mocks.permissions,
}));

vi.mock('@alfanumrik/lib/experience-v3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/experience-v3')>();
  return { ...actual, resolveExperienceV3: mocks.resolveExperience };
});

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/app/super-admin/_components/LegacySuperAdminPage', () => ({
  default: () => <div data-testid="legacy-super-admin">Legacy operator console</div>,
}));

vi.mock('@alfanumrik/ui/v3', () => ({
  DataState: ({ state }: { state: string }) => <div data-testid="data-state">{state}</div>,
}));

import SuperAdminPage from '@/app/super-admin/page';

describe('super-admin default V3 landing', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue({
      userId: 'admin-user-1',
      adminLevel: 'support',
      adminId: 'admin-1',
      email: 'operator@example.test',
      name: 'Operator',
      authorized: true,
    });
    mocks.resolveExperience.mockReset().mockResolvedValue(true);
    mocks.redirect.mockReset().mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`);
    });
    mocks.permissions = ['system.audit'];
  });

  it('server-redirects an authorized enabled assignment to the canonical command page', async () => {
    await expect(SuperAdminPage()).rejects.toThrow('NEXT_REDIRECT:/super-admin/command');

    expect(mocks.requireAdmin).toHaveBeenCalledWith('support');
    expect(mocks.resolveExperience).toHaveBeenCalledWith(expect.objectContaining({
      role: 'super-admin',
      userId: 'admin-user-1',
    }));
    expect(mocks.redirect).toHaveBeenCalledWith('/super-admin/command');
  });

  it('keeps the legacy console when the flag is off or resolution fails closed', async () => {
    mocks.resolveExperience.mockResolvedValue(false);

    render(await SuperAdminPage());

    expect(screen.getByTestId('legacy-super-admin')).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('fails closed instead of redirecting when the command capability is denied', async () => {
    mocks.permissions = [];

    render(await SuperAdminPage());

    expect(screen.getByTestId('data-state')).toHaveTextContent('permission');
    expect(screen.queryByTestId('legacy-super-admin')).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
