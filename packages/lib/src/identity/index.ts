/**
 * Identity System — Centralized Exports
 *
 * Import identity constants, types, and utilities from here.
 * Example: import { VALID_ROLES, getRoleDestination } from '@alfanumrik/lib/identity';
 * Example: import { resolveIdentity, needsBootstrap } from '@alfanumrik/lib/identity/onboarding';
 * Example: import { logIdentityEvent } from '@alfanumrik/lib/identity/audit';
 */

export * from './constants';

// Onboarding and audit are not re-exported from barrel to avoid
// pulling server-only deps (SupabaseClient, logger) into client bundles.
// Import directly:
//   import { resolveIdentity } from '@alfanumrik/lib/identity/onboarding';
//   import { logIdentityEvent } from '@alfanumrik/lib/identity/audit';
