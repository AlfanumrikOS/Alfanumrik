/**
 * Identity System — Onboarding Pipeline
 *
 * Server-side onboarding orchestration. This module is the single
 * authority for determining a user's onboarding state and resolving
 * their identity.
 *
 * Used by:
 * - POST /api/auth/bootstrap (primary bootstrap path)
 * - GET /api/auth/onboarding-status (state query)
 * - POST /api/auth/repair (admin repair)
 * - AuthContext fallback (client → server bootstrap)
 *
 * Design principles:
 * - Server-authoritative: client never decides identity state
 * - Idempotent: all operations safe to retry
 * - Observable: all state transitions logged
 * - Repairable: every broken state has a recovery path
 *
 * WARNING: Do not modify without running auth tests.
 * Changes here affect signup, login, and onboarding for all users.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingStep, ValidRole } from './constants';
import { isValidRole, ROLE_ALIASES } from './constants';

// ── Types ────────────────────────────────────────────────────

export interface OnboardingState {
  step: OnboardingStep;
  intended_role: string;
  profile_id: string | null;
  error_message: string | null;
  completed_at: string | null;
}

export interface IdentityResolution {
  /** Whether the user has any profile */
  hasProfile: boolean;
  /** Detected role from profile tables */
  detectedRole: ValidRole | null;
  /** Profile data for the detected role */
  profile: {
    type: 'student' | 'teacher' | 'guardian' | 'school_admin';
    id: string;
    name: string;
    [key: string]: unknown;
  } | null;
  /** Onboarding state record (may be null for legacy users) */
  onboarding: OnboardingState | null;
  /** Whether onboarding is complete */
  isOnboarded: boolean;
}

// ── Core Functions ───────────────────────────────────────────

/**
 * Resolve a user's complete identity state by checking all profile
 * tables and onboarding state. This is the single source of truth
 * for "what is this user's current identity?"
 *
 * @param supabase - Supabase client (user-scoped or admin)
 * @param authUserId - The user's auth.users UUID
 * @returns Complete identity resolution
 */
export async function resolveIdentity(
  supabase: SupabaseClient,
  authUserId: string
): Promise<IdentityResolution> {
  // Parallel fetch all profile tables + onboarding state
  const [
    studentResult,
    teacherResult,
    guardianResult,
    schoolAdminResult,
    onboardingResult,
  ] = await Promise.all([
    supabase
      .from('students')
      .select('id, name, grade, auth_user_id, is_demo, account_status')
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
    supabase
      .from('teachers')
      .select('id, name, auth_user_id, is_demo')
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
    supabase
      .from('guardians')
      .select('id, name, auth_user_id, is_demo')
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
    // Phase 3b (B3): school admins now flow through identity resolution so
    // GET /api/auth/onboarding-status and POST /api/auth/repair can SEE them.
    // Previously a school admin (school_admins row created by the app-side
    // helper or the bootstrap RPC) was invisible here — onboarding-status
    // reported hasProfile=false and repair could not classify them.
    //
    // NOTE: school_admins has NO unique constraint on auth_user_id (a person
    // may administer multiple schools), so a rare multi-school admin yields
    // >1 row and .maybeSingle() resolves to { data: null } WITHOUT throwing.
    // Such multi-school admins are handled by admin_repair_user_onboarding()'s
    // earliest-membership logic; the common single-school founder resolves
    // cleanly here.
    supabase
      .from('school_admins')
      .select('id, name, auth_user_id, school_id, role, is_active')
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
    supabase
      .from('onboarding_state')
      .select(
        'step, intended_role, profile_id, error_message, created_at, completed_at'
      )
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
  ]);

  const student = studentResult.data;
  const teacher = teacherResult.data;
  const guardian = guardianResult.data;
  const schoolAdmin = schoolAdminResult.data;
  const onboarding = onboardingResult.data as OnboardingState | null;

  const hasProfile = !!(student || teacher || guardian || schoolAdmin);

  // Role detection priority: institution_admin > teacher > guardian > student.
  // This mirrors the auth-route signup detect order in
  // apps/host/src/app/auth/{callback,confirm}/route.ts, where an existing
  // school_admins row wins over the other profile tables.
  let detectedRole: ValidRole | null = null;
  let profile: IdentityResolution['profile'] = null;

  if (schoolAdmin) {
    detectedRole = 'institution_admin';
    profile = { type: 'school_admin', ...schoolAdmin };
  } else if (teacher) {
    detectedRole = 'teacher';
    profile = { type: 'teacher', ...teacher };
  } else if (guardian) {
    detectedRole = 'parent';
    profile = { type: 'guardian', ...guardian };
  } else if (student) {
    detectedRole = 'student';
    profile = { type: 'student', ...student };
  }

  const isOnboarded =
    hasProfile && (onboarding?.step === 'completed' || !onboarding);
  // Legacy users without onboarding_state but WITH profiles are considered onboarded

  return {
    hasProfile,
    detectedRole,
    profile,
    onboarding,
    isOnboarded,
  };
}

/**
 * Determine whether a user needs bootstrap (profile creation).
 * Returns true if the user is authenticated but has no profile.
 *
 * @param identity - Result from resolveIdentity()
 */
export function needsBootstrap(identity: IdentityResolution): boolean {
  return !identity.hasProfile;
}

/**
 * Determine the intended role from various sources.
 * Priority: onboarding state > auth metadata > default
 *
 * @param identity - Result from resolveIdentity()
 * @param metadataRole - Role from user.user_metadata
 * @returns Validated role
 */
export function resolveIntendedRole(
  identity: IdentityResolution,
  metadataRole?: string | null
): ValidRole {
  // If already onboarded, use detected role
  if (identity.detectedRole) {
    return identity.detectedRole;
  }

  // If onboarding in progress, use intended role
  if (identity.onboarding?.intended_role) {
    const alias = ROLE_ALIASES[identity.onboarding.intended_role];
    if (alias) return alias;
  }

  // Use metadata role
  if (metadataRole) {
    const alias = ROLE_ALIASES[metadataRole];
    if (alias) return alias;
  }

  // Safe default
  return 'student';
}

/**
 * Check if a user's onboarding has failed and needs repair.
 */
export function needsRepair(identity: IdentityResolution): boolean {
  return identity.onboarding?.step === 'failed';
}

/**
 * Check if a user is a demo account.
 */
export function isDemoAccount(identity: IdentityResolution): boolean {
  if (!identity.profile) return false;
  return (
    identity.profile.is_demo === true ||
    identity.profile.account_status === 'demo'
  );
}

/**
 * Validate that all required identity records exist for a role.
 * Used by repair and health check flows.
 *
 * Role-generic: it operates purely on the IdentityResolution produced by
 * resolveIdentity(). Because resolveIdentity() now also queries school_admins
 * (Phase 3b B3), an institution_admin's presence/absence is reflected in
 * identity.hasProfile + identity.detectedRole here without any role-specific
 * branching — a school admin missing their school_admins row surfaces as a
 * missing "institution_admin profile row", and a missing/failed onboarding_state
 * surfaces identically to every other role.
 *
 * @returns List of missing records (empty = healthy)
 */
export function validateIdentityCompleteness(
  identity: IdentityResolution,
  expectedRole?: string
): string[] {
  const missing: string[] = [];
  const role = expectedRole
    ? ROLE_ALIASES[expectedRole] || expectedRole
    : identity.detectedRole;

  if (!identity.hasProfile) {
    missing.push(`${role || 'unknown'} profile row`);
  }

  if (!identity.onboarding) {
    missing.push('onboarding_state row');
  } else if (identity.onboarding.step === 'failed') {
    missing.push(
      `onboarding_state stuck in failed: ${identity.onboarding.error_message || 'unknown error'}`
    );
  } else if (identity.onboarding.step !== 'completed') {
    missing.push(
      `onboarding_state incomplete (step=${identity.onboarding.step})`
    );
  }

  return missing;
}

// ── Re-export types used by consumers ────────────────────────

export type { ValidRole, OnboardingStep };
