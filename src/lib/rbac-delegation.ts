/**
 * ALFANUMRIK RBAC — Delegation Token Manager
 *
 * Creates, validates, and revokes delegation tokens that allow one user
 * to share a subset of their permissions with another user or role.
 *
 * Key features:
 * - Tokens are stored as SHA-256 hashes (raw token only returned on creation)
 * - Cascading revocation: validates that the granter still holds all delegated permissions
 * - Use-count limits and time-based expiry
 *
 * Usage:
 *   import { createDelegationToken, validateDelegationToken, revokeDelegationToken } from '@/lib/rbac-delegation';
 *
 *   const result = await createDelegationToken({
 *     granterUserId: 'teacher-uuid',
 *     schoolId: 'school-uuid',
 *     permissions: ['quiz.attempt', 'study_plan.view'],
 *     expiryDays: 7,
 *   });
 */

import { createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { getUserPermissions, invalidateForSecurityEvent } from '@/lib/rbac';

// ─── Types ──────────────────────────────────────────────────

export interface DelegationTokenInput {
  granterUserId: string;
  granteeUserId?: string | null;
  schoolId: string;
  permissions: string[];
  resourceScope?: Record<string, unknown> | null;
  maxUses?: number | null;
  expiryDays: number;
}

export interface DelegationTokenResult {
  success: boolean;
  token?: string;
  tokenId?: string;
  error?: string;
}

export interface DelegationValidation {
  valid: boolean;
  tokenId?: string;
  granterUserId?: string;
  granteeUserId?: string | null;
  permissions?: string[];
  schoolId?: string;
  resourceScope?: Record<string, unknown> | null;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────

const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 30;
const TOKEN_BYTES = 32; // 256-bit random token

// ─── Helpers ────────────────────────────────────────────────

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

// ─── Create Delegation Token ────────────────────────────────

/**
 * Create a delegation token that shares a subset of the granter's permissions.
 *
 * Validates:
 * - Permissions array is non-empty
 * - Expiry is between 1-30 days
 * - Granter holds all permissions being delegated
 *
 * Returns the raw token (shown once) and the tokenId.
 */
export async function createDelegationToken(
  input: DelegationTokenInput,
): Promise<DelegationTokenResult> {
  // Validate permissions
  if (!input.permissions || input.permissions.length === 0) {
    return { success: false, error: 'At least one permission is required' };
  }

  // Validate expiry
  if (input.expiryDays < MIN_EXPIRY_DAYS || input.expiryDays > MAX_EXPIRY_DAYS) {
    return {
      success: false,
      error: `Expiry must be between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS} days`,
    };
  }

  try {
    // Verify granter holds all delegated permissions
    const granterPerms = await getUserPermissions(input.granterUserId, input.schoolId);
    const isSuperAdmin = granterPerms.roles.some((r) => r.name === 'super_admin');

    if (!isSuperAdmin) {
      const missingPerms = input.permissions.filter(
        (p) => !granterPerms.permissions.includes(p),
      );
      if (missingPerms.length > 0) {
        return {
          success: false,
          error: `Granter does not hold permissions: ${missingPerms.join(', ')}`,
        };
      }
    }

    // Generate token and hash
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + input.expiryDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('delegation_tokens')
      .insert({
        token_hash: tokenHash,
        granter_user_id: input.granterUserId,
        grantee_user_id: input.granteeUserId ?? null,
        school_id: input.schoolId,
        permissions: input.permissions,
        resource_scope: input.resourceScope ?? null,
        max_uses: input.maxUses ?? null,
        expires_at: expiresAt,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      logger.error('rbac_delegation_create_failed', {
        error: new Error(error.message),
        route: 'rbac-delegation',
      });
      return { success: false, error: error.message };
    }

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'delegation_grant',
        actorUserId: input.granterUserId,
        effectiveUserId: input.granteeUserId ?? null,
        schoolId: input.schoolId,
        action: 'grant',
        result: 'granted',
        resourceType: 'delegation_token',
        resourceId: data.id,
        metadata: {
          permissions: input.permissions,
          expiryDays: input.expiryDays,
          maxUses: input.maxUses ?? null,
        },
      });
    } catch {
      // Audit write failed — not critical
    }

    // Invalidate delegator cache so delegation takes effect immediately.
    // Best-effort; failure must not cause the creation to fail.
    try {
      await invalidateForSecurityEvent([input.granterUserId], 'delegation_granted');
    } catch (invErr) {
      logger.error('rbac_delegation_cache_invalidation_failed', {
        error: invErr instanceof Error ? invErr : new Error(String(invErr)),
        route: 'rbac-delegation',
      });
    }

    return { success: true, token: rawToken, tokenId: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_delegation_create_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-delegation',
    });
    return { success: false, error: message };
  }
}

// ─── Validate Delegation Token ──────────────────────────────

/**
 * Validate a raw delegation token.
 *
 * Checks:
 * - Token hash exists and status is active
 * - Token has not expired
 * - Token has not exceeded max_uses
 * - **Cascading revocation**: granter still holds all delegated permissions
 *
 * Side effect: increments use_count on successful validation.
 */
export async function validateDelegationToken(
  rawToken: string,
): Promise<DelegationValidation> {
  try {
    const tokenHash = hashToken(rawToken);
    const supabase = getSupabaseAdmin();

    const { data: token, error: fetchError } = await supabase
      .from('delegation_tokens')
      .select('id, granter_user_id, grantee_user_id, school_id, permissions, resource_scope, max_uses, use_count, expires_at, status')
      .eq('token_hash', tokenHash)
      .single();

    if (fetchError || !token) {
      return { valid: false, error: 'Token not found' };
    }

    // Check status
    if (token.status !== 'active') {
      return { valid: false, error: `Token is ${token.status}` };
    }

    // Check expiry
    if (new Date(token.expires_at) <= new Date()) {
      // Auto-expire the token
      await supabase
        .from('delegation_tokens')
        .update({ status: 'expired' })
        .eq('id', token.id);

      return { valid: false, error: 'Token has expired' };
    }

    // Check use count
    if (token.max_uses !== null && token.use_count >= token.max_uses) {
      // Auto-exhaust the token
      await supabase
        .from('delegation_tokens')
        .update({ status: 'exhausted' })
        .eq('id', token.id);

      return { valid: false, error: 'Token has been exhausted (max uses reached)' };
    }

    // Cascading revocation: verify granter still holds all delegated permissions
    const granterPerms = await getUserPermissions(token.granter_user_id, token.school_id);
    const isSuperAdmin = granterPerms.roles.some((r) => r.name === 'super_admin');

    if (!isSuperAdmin) {
      const missingPerms = (token.permissions as string[]).filter(
        (p) => !granterPerms.permissions.includes(p),
      );
      if (missingPerms.length > 0) {
        // Granter lost permissions — cascade revoke the token
        await supabase
          .from('delegation_tokens')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
          })
          .eq('id', token.id);

        return {
          valid: false,
          error: 'Token revoked: granter no longer holds delegated permissions',
        };
      }
    }

    // Increment use count
    await supabase
      .from('delegation_tokens')
      .update({ use_count: token.use_count + 1 })
      .eq('id', token.id);

    return {
      valid: true,
      tokenId: token.id,
      granterUserId: token.granter_user_id,
      granteeUserId: token.grantee_user_id,
      permissions: token.permissions as string[],
      schoolId: token.school_id,
      resourceScope: token.resource_scope as Record<string, unknown> | null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_delegation_validate_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-delegation',
    });
    return { valid: false, error: message };
  }
}

// ─── Revoke Delegation Token ────────────────────────────────

/**
 * Revoke an active delegation token.
 *
 * Side effects:
 * - Updates token status to 'revoked'
 * - Writes audit event (fire-and-forget)
 */
export async function revokeDelegationToken(
  tokenId: string,
  revokedBy: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch token to verify it exists and is active
    const { data: token, error: fetchError } = await supabase
      .from('delegation_tokens')
      .select('id, granter_user_id, grantee_user_id, status, school_id')
      .eq('id', tokenId)
      .single();

    if (fetchError || !token) {
      return { success: false, error: 'Token not found' };
    }

    if (token.status !== 'active') {
      return { success: false, error: `Token is already ${token.status}` };
    }

    // Revoke the token
    const { error: updateError } = await supabase
      .from('delegation_tokens')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
      })
      .eq('id', tokenId)
      .eq('status', 'active');

    if (updateError) {
      logger.error('rbac_delegation_revoke_failed', {
        error: new Error(updateError.message),
        route: 'rbac-delegation',
      });
      return { success: false, error: updateError.message };
    }

    // Fire-and-forget audit event
    try {
      const { writeAuditEvent } = await import('@/lib/audit-pipeline');
      await writeAuditEvent({
        eventType: 'delegation_revoke',
        actorUserId: revokedBy,
        schoolId: token.school_id,
        action: 'revoke',
        result: 'granted',
        resourceType: 'delegation_token',
        resourceId: tokenId,
        metadata: {
          granterUserId: token.granter_user_id,
          granteeUserId: token.grantee_user_id,
        },
      });
    } catch {
      // Audit write failed — not critical
    }

    // SECURITY: Invalidate caches for both the granter and the grantee so the
    // revoked delegation is immediately enforced. Without this, the delegatee
    // retains the delegated permissions for up to 5 minutes. Best-effort.
    try {
      const userIds: string[] = [];
      if (token.granter_user_id) userIds.push(token.granter_user_id);
      if (token.grantee_user_id) userIds.push(token.grantee_user_id);
      if (userIds.length > 0) {
        await invalidateForSecurityEvent(userIds, 'delegation_revoked');
      }
    } catch (invErr) {
      logger.error('rbac_delegation_cache_invalidation_failed', {
        error: invErr instanceof Error ? invErr : new Error(String(invErr)),
        route: 'rbac-delegation',
      });
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('rbac_delegation_revoke_exception', {
      error: err instanceof Error ? err : new Error(message),
      route: 'rbac-delegation',
    });
    return { success: false, error: message };
  }
}
