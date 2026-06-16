/**
 * AtlasSchoolAdmin — dashboard-stats RPC argument-name contract (render unit).
 *
 * WHY THIS EXISTS
 *   PostgREST resolves RPCs BY ARGUMENT NAME. The DB function is
 *   get_school_dashboard_stats(p_school_id uuid). The call was migrated from the
 *   wrong arg name `{ school_id }` (which fails with "Could not find the function
 *   … in the schema cache") to the correct `{ p_school_id }`. This test pins the
 *   exact argument name so a refactor cannot silently regress it back.
 *
 *   Flow: fetchAdmin() reads school_admins (maybeSingle) → sets adminRecord →
 *   an effect calls fetchStats(school_id) → supabase.rpc('get_school_dashboard_stats',
 *   { p_school_id }). We drive that flow with a chainable supabase mock and assert
 *   the rpc call shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const SCHOOL_ID = '11111111-1111-4111-a111-111111111111';

// ── Auth / tenant seams ──────────────────────────────────────────────────────
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'admin-user-1',
    isLoading: false,
    isHi: false,
    setLanguage: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/tenant-context', () => ({
  useTenant: () => ({ schoolName: '', schoolId: null, branding: { primaryColor: '#7C3AED', logoUrl: null } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

// Shell helper used by AtlasSchoolAdmin — keep it a simple pure stub so the
// import doesn't drag the whole shell in.
vi.mock('@/app/school-admin/_components/SchoolAdminShell', () => ({
  resolveCachedSchoolName: () => null,
  SCHOOL_NAME_PLACEHOLDER: '—',
}));

// Atlas primitives — lightweight passthroughs (we only care about the RPC call).
vi.mock('@/components/atlas', () => {
  const passthrough = (tag: string) => {
    const Passthrough = (props: Record<string, unknown>) =>
      React.createElement(tag, null, props.children as React.ReactNode);
    Passthrough.displayName = `Passthrough(${tag})`;
    return Passthrough;
  };
  return {
    AtlasShell: passthrough('div'),
    AtlasCard: passthrough('div'),
    AtlasPill: passthrough('span'),
    AtlasButton: passthrough('button'),
    AtlasIcon: () => null,
    AtlasKpi: () => null,
    AtlasTrend: () => null,
    EditorialHeadline: passthrough('h1'),
  };
});

// ── Supabase mock: school_admins → adminRecord; rpc spy captures the call ─────
const rpcSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  function fromBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    ['select', 'eq', 'limit'].forEach((m) => {
      builder[m] = vi.fn().mockReturnValue(builder);
    });
    builder.maybeSingle = vi.fn().mockResolvedValue(
      table === 'school_admins'
        ? {
            data: {
              school_id: SCHOOL_ID,
              name: 'Principal Sharma',
              email: 'principal@greenwood.test',
              role: 'principal',
              schools: { name: 'Greenwood High' },
            },
            error: null,
          }
        : { data: null, error: null },
    );
    // `classes` query is awaited directly (not via maybeSingle) — make the
    // builder itself thenable so `.limit()` resolves to an empty list.
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => fromBuilder(table)),
      rpc: (...args: unknown[]) => {
        rpcSpy(...args);
        return Promise.resolve({ data: { total_students: 0, total_teachers: 0, total_classes: 0, active_today: 0, avg_mastery: 0, quizzes_today: 0, recent_activity: [] }, error: null });
      },
    },
  };
});

import AtlasSchoolAdmin from '@/app/school-admin/AtlasSchoolAdmin';

beforeEach(() => {
  rpcSpy.mockClear();
});

describe('AtlasSchoolAdmin — get_school_dashboard_stats argument name', () => {
  it('calls the RPC with { p_school_id } (PostgREST resolves by arg name)', async () => {
    render(React.createElement(AtlasSchoolAdmin));

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('get_school_dashboard_stats', { p_school_id: SCHOOL_ID });
    });
  });

  it('does NOT use the old { school_id } argument name', async () => {
    render(React.createElement(AtlasSchoolAdmin));

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled());
    const [, args] = rpcSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).toHaveProperty('p_school_id', SCHOOL_ID);
    expect(args).not.toHaveProperty('school_id');
  });
});
