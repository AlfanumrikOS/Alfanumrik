/**
 * Identity System — Centralized Exports
 *
 * Import identity constants, types, and utilities from here.
 * Example: import { VALID_ROLES, getRoleDestination } from '@/lib/identity';
 * Example: import { resolveIdentity, needsBootstrap } from '@/lib/identity/onboarding';
 * Example: import { logIdentityEvent } from '@/lib/identity/audit';
 */

export * from './constants';

// Onboarding and audit are not re-exported from barrel to avoid
// pulling server-only deps (SupabaseClient, logger) into client bundles.
// Import directly:
//   import { resolveIdentity } from '@/lib/identity/onboarding';
//   import { logIdentityEvent } from '@/lib/identity/audit';
