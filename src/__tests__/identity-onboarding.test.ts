/**
 * Identity Onboarding Pipeline Tests
 *
 * Tests for src/lib/identity/onboarding.ts — the single authority
 * for determining a user's onboarding state and resolving identity.
 *
 * Mock strategy: mock Supabase client's .from().select().eq().single() chain
 * per table (students, teachers, guardians, onboarding_state).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveIdentity,
  needsBootstrap,
  resolveIntendedRole,
  needsRepair,
  isDemoAccount,
  validateIdentityCompleteness,
  type IdentityResolution,
  type OnboardingState,
} from '../lib/identity/onboarding';

// ── Mock Helpers ────────────────────────────────────────────

const AUTH_USER_ID = 'user-uuid-123';

/** Builds a mock row for a profile table */
function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'student-1',
    name: 'Test Student',
    grade: '9',
    auth_user_id: AUTH_USER_ID,
    is_demo: false,
    account_status: 'active',
    ...overrides,
  };
}

function teacherRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'teacher-1',
    name: 'Test Teacher',
    auth_user_id: AUTH_USER_ID,
    is_demo: false,
    ...overrides,
  };
}

function guardianRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guardian-1',
    name: 'Test Guardian',
    auth_user_id: AUTH_USER_ID,
    is_demo: false,
    ...overrides,
  };
}

function onboardingRow(overrides: Partial<OnboardingState & { created_at: string }> = {}): OnboardingState & { created_at: string } {
  return {
    step: 'completed' as const,
    intended_role: 'student',
    profile_id: 'student-1',
    error_message: null,
    completed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** No row found response */
const NO_ROW = { data: null, error: { code: 'PGRST116', message: 'No rows found' } };

/** Row found response */
function found(data: unknown) {
  return { data, error: null };
}

/**
 * Create a mock SupabaseClient that returns configured responses
 * for each table query.
 */
function createMockSupabase(config: {
  students?: unknown;
  teachers?: unknown;
  guardians?: unknown;
  onboarding_state?: unknown;
}) {
  const responses: Record<string, { data: unknown; error: unknown }> = {
    students: config.students !== undefined ? found(config.students) : NO_ROW,
    teachers: config.teachers !== undefined ? found(config.teachers) : NO_ROW,
    guardians: config.guardians !== undefined ? found(config.guardians) : NO_ROW,
    onboarding_state:
      config.onboarding_state !== undefined
        ? found(config.onboarding_state)
        : NO_ROW,
  };

  const mockFrom = vi.fn((table: string) => {
    const response = responses[table] || NO_ROW;
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(response),
        }),
      }),
    };
  });

  return { from: mockFrom } as unknown as SupabaseClient;
}

// ── resolveIdentity() ───────────────────────────────────────

describe('resolveIdentity', () => {
  it('returns hasProfile=true, detectedRole="student" when student profile exists', async () => {
    const sb = createMockSupabase({
      students: studentRow(),
      onboarding_state: onboardingRow(),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.hasProfile).toBe(true);
    expect(result.detectedRole).toBe('student');
    expect(result.profile?.type).toBe('student');
  });

  it('returns hasProfile=true, detectedRole="teacher" when teacher profile exists', async () => {
    const sb = createMockSupabase({
      teachers: teacherRow(),
      onboarding_state: onboardingRow({ intended_role: 'teacher' }),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.hasProfile).toBe(true);
    expect(result.detectedRole).toBe('teacher');
    expect(result.profile?.type).toBe('teacher');
  });

  it('returns hasProfile=true, detectedRole="parent" when guardian profile exists', async () => {
    const sb = createMockSupabase({
      guardians: guardianRow(),
      onboarding_state: onboardingRow({ intended_role: 'parent' }),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.hasProfile).toBe(true);
    expect(result.detectedRole).toBe('parent');
    expect(result.profile?.type).toBe('guardian');
  });

  it('returns hasProfile=false when no profiles exist', async () => {
    const sb = createMockSupabase({});
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.hasProfile).toBe(false);
    expect(result.detectedRole).toBeNull();
    expect(result.profile).toBeNull();
  });

  it('returns isOnboarded=true when profile exists and onboarding step is completed', async () => {
    const sb = createMockSupabase({
      students: studentRow(),
      onboarding_state: onboardingRow({ step: 'completed' }),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.isOnboarded).toBe(true);
  });

  it('returns isOnboarded=true when profile exists but NO onboarding_state (legacy user)', async () => {
    const sb = createMockSupabase({
      students: studentRow(),
      // no onboarding_state
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.isOnboarded).toBe(true);
    expect(result.onboarding).toBeNull();
  });

  it('returns isOnboarded=false when no profile exists', async () => {
    const sb = createMockSupabase({});
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.isOnboarded).toBe(false);
  });

  it('returns correct onboarding state when it exists', async () => {
    const state = onboardingRow({
      step: 'profile_created',
      intended_role: 'teacher',
      profile_id: 'teacher-1',
      error_message: null,
    });
    const sb = createMockSupabase({
      onboarding_state: state,
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.onboarding).not.toBeNull();
    expect(result.onboarding!.step).toBe('profile_created');
    expect(result.onboarding!.intended_role).toBe('teacher');
    expect(result.onboarding!.profile_id).toBe('teacher-1');
  });

  it('returns null onboarding when no onboarding_state row', async () => {
    const sb = createMockSupabase({
      students: studentRow(),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.onboarding).toBeNull();
  });

  it('teacher role takes precedence over student when both profiles exist', async () => {
    const sb = createMockSupabase({
      students: studentRow(),
      teachers: teacherRow(),
      onboarding_state: onboardingRow(),
    });
    const result = await resolveIdentity(sb, AUTH_USER_ID);

    expect(result.detectedRole).toBe('teacher');
    expect(result.profile?.type).toBe('teacher');
  });
});

// ── needsBootstrap() ────────────────────────────────────────

describe('needsBootstrap', () => {
  it('returns true when no profile exists', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: null,
      isOnboarded: false,
    };
    expect(needsBootstrap(identity)).toBe(true);
  });

  it('returns false when profile exists', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: null,
      isOnboarded: true,
    };
    expect(needsBootstrap(identity)).toBe(false);
  });
});

// ── resolveIntendedRole() ───────────────────────────────────

describe('resolveIntendedRole', () => {
  it('returns detected role when profile already exists', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'teacher',
      profile: { type: 'teacher', id: 'teacher-1', name: 'Test' },
      onboarding: onboardingRow({ intended_role: 'student' }) as OnboardingState,
      isOnboarded: true,
    };
    // Even though onboarding says student, detected role (teacher) wins
    expect(resolveIntendedRole(identity, 'student')).toBe('teacher');
  });

  it('returns onboarding intended_role when in progress (no profile)', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: {
        step: 'identity_created',
        intended_role: 'parent',
        profile_id: null,
        error_message: null,
        completed_at: null,
      },
      isOnboarded: false,
    };
    expect(resolveIntendedRole(identity)).toBe('parent');
  });

  it('returns metadata role when no profile and no onboarding', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: null,
      isOnboarded: false,
    };
    expect(resolveIntendedRole(identity, 'teacher')).toBe('teacher');
  });

  it('maps "guardian" metadata to "parent"', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: null,
      isOnboarded: false,
    };
    expect(resolveIntendedRole(identity, 'guardian')).toBe('parent');
  });

  it('defaults to "student" when nothing available', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: null,
      isOnboarded: false,
    };
    expect(resolveIntendedRole(identity)).toBe('student');
  });
});

// ── needsRepair() ───────────────────────────────────────────

describe('needsRepair', () => {
  it('returns true when onboarding step is "failed"', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: {
        step: 'failed',
        intended_role: 'student',
        profile_id: null,
        error_message: 'Profile creation failed',
        completed_at: null,
      },
      isOnboarded: false,
    };
    expect(needsRepair(identity)).toBe(true);
  });

  it('returns false when onboarding step is "completed"', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: onboardingRow({ step: 'completed' }) as OnboardingState,
      isOnboarded: true,
    };
    expect(needsRepair(identity)).toBe(false);
  });

  it('returns false when no onboarding state', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: null,
      isOnboarded: true,
    };
    expect(needsRepair(identity)).toBe(false);
  });
});

// ── isDemoAccount() ─────────────────────────────────────────

describe('isDemoAccount', () => {
  it('returns true when profile has is_demo=true', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Demo Student', is_demo: true, account_status: 'active' },
      onboarding: null,
      isOnboarded: true,
    };
    expect(isDemoAccount(identity)).toBe(true);
  });

  it('returns true when profile has account_status="demo"', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Demo Student', is_demo: false, account_status: 'demo' },
      onboarding: null,
      isOnboarded: true,
    };
    expect(isDemoAccount(identity)).toBe(true);
  });

  it('returns false for regular accounts', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Regular Student', is_demo: false, account_status: 'active' },
      onboarding: null,
      isOnboarded: true,
    };
    expect(isDemoAccount(identity)).toBe(false);
  });

  it('returns false when no profile', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: null,
      isOnboarded: false,
    };
    expect(isDemoAccount(identity)).toBe(false);
  });
});

// ── validateIdentityCompleteness() ──────────────────────────

describe('validateIdentityCompleteness', () => {
  it('returns empty array when fully complete (profile + completed onboarding)', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: onboardingRow({ step: 'completed' }) as OnboardingState,
      isOnboarded: true,
    };
    expect(validateIdentityCompleteness(identity)).toEqual([]);
  });

  it('returns missing items when no profile', () => {
    const identity: IdentityResolution = {
      hasProfile: false,
      detectedRole: null,
      profile: null,
      onboarding: {
        step: 'identity_created',
        intended_role: 'student',
        profile_id: null,
        error_message: null,
        completed_at: null,
      },
      isOnboarded: false,
    };
    const missing = validateIdentityCompleteness(identity);
    expect(missing.length).toBeGreaterThan(0);
    // Should mention missing profile
    expect(missing.some((m) => m.includes('profile row'))).toBe(true);
    // Should mention incomplete onboarding
    expect(missing.some((m) => m.includes('incomplete'))).toBe(true);
  });

  it('returns missing items when onboarding step is "failed"', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: {
        step: 'failed',
        intended_role: 'student',
        profile_id: null,
        error_message: 'DB timeout',
        completed_at: null,
      },
      isOnboarded: false,
    };
    const missing = validateIdentityCompleteness(identity);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((m) => m.includes('failed'))).toBe(true);
    expect(missing.some((m) => m.includes('DB timeout'))).toBe(true);
  });

  it('returns missing items when no onboarding_state', () => {
    const identity: IdentityResolution = {
      hasProfile: true,
      detectedRole: 'student',
      profile: { type: 'student', id: 'student-1', name: 'Test' },
      onboarding: null,
      isOnboarded: true,
    };
    const missing = validateIdentityCompleteness(identity);
    expect(missing.length).toBe(1);
    expect(missing[0]).toBe('onboarding_state row');
  });
});
