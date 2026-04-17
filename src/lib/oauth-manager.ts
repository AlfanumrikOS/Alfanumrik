/**
 * ALFANUMRIK -- OAuth2 Developer Platform Manager
 *
 * Manages OAuth app registration, token validation, and the triple-intersection
 * scope resolution algorithm for the B2B developer platform.
 *
 * Usage:
 *   import { registerApp, tripleIntersection, validateAccessToken, revokeAppTokens } from '@/lib/oauth-manager';
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';
import { getUserPermissions } from '@/lib/rbac';
import { createHash, randomBytes } from 'crypto';

// ─── Types ───────────────────────────────────────────────────

export interface RegisterAppInput {
  name: string;
  description?: string;
  developerId: string;
  developerOrg?: string;
  logoUrl?: string;
  homepageUrl?: string;
  privacyPolicyUrl: string;
  redirectUris: string[];
  requestedScopes: string[];
  appType?: 'web' | 'mobile' | 'server';
}

export interface RegisterAppResult {
  success: boolean;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  error?: string;
}

export interface ScopeDefinition {
  code: string;
  permissions_required: string[];
}

export interface ValidateTokenResult {
  valid: boolean;
  appId?: string;
  userId?: string;
  schoolId?: string;
  scopes?: string[];
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function hashSHA256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ─── Register App ────────────────────────────────────────────

/**
 * Register a new OAuth app on the developer platform.
 * Returns the raw clientSecret exactly once -- it is stored as a SHA-256 hash.
 */
export async function registerApp(input: RegisterAppInput): Promise<RegisterAppResult> {
  // Validation
  if (!input.privacyPolicyUrl) {
    return { success: false, error: 'privacyPolicyUrl is required' };
  }
  if (!input.redirectUris || input.redirectUris.length === 0) {
    return { success: false, error: 'At least one redirectUri is required' };
  }
  if (!input.requestedScopes || input.requestedScopes.length === 0) {
    return { success: false, error: 'At least one scope is required' };
  }

  try {
    const clientId = randomBytes(16).toString('hex');
    const clientSecret = randomBytes(32).toString('base64url');
    const clientSecretHash = hashSHA256(clientSecret);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('oauth_apps')
      .insert({
        client_id: clientId,
        client_secret_hash: clientSecretHash,
        name: input.name,
        description: input.description ?? null,
        developer_id: input.developerId,
        developer_org: input.developerOrg ?? null,
        logo_url: input.logoUrl ?? null,
        homepage_url: input.homepageUrl ?? null,
        privacy_policy_url: input.privacyPolicyUrl,
        redirect_uris: input.redirectUris,
        requested_scopes: input.requestedScopes,
        app_type: input.appType ?? 'web',
        review_status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      logger.error('oauth_register_app_failed', { error: new Error(error.message) });
      return { success: false, error: error.message };
    }

    await writeAuditEvent({
      eventType: 'oauth_consent',
      actorUserId: input.developerId,
      action: 'write',
      result: 'granted',
      resourceType: 'oauth_app',
      resourceId: data.id,
      metadata: { appName: input.name, clientId },
    });

    return {
      success: true,
      clientId,
      clientSecret,
      appId: data.id,
    };
  } catch (err) {
    logger.error('oauth_register_app_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { success: false, error: 'Internal error during app registration' };
  }
}

// ─── Triple Intersection ────────────────────────────────────

/**
 * Compute the effective permissions from:
 *   1. App's requested scopes
 *   2. School's consent scopes
 *   3. User's actual permissions (from RBAC)
 *
 * Algorithm:
 *   effectiveScopes = appScopes INTERSECT consentScopes
 *   permissionCodes = union of permissions_required for each effectiveScope
 *   result = permissionCodes INTERSECT userPermissions
 */
export function tripleIntersection(
  appScopes: string[],
  consentScopes: string[],
  userPermissions: string[],
  scopeDefinitions: ScopeDefinition[],
): string[] {
  // Step 1: intersect app scopes with consent scopes
  const consentSet = new Set(consentScopes);
  const effectiveScopes = appScopes.filter((s) => consentSet.has(s));

  // Step 2: get permission codes from scope definitions for effective scopes
  const scopeDefMap = new Map<string, string[]>();
  for (const def of scopeDefinitions) {
    scopeDefMap.set(def.code, def.permissions_required);
  }

  const permissionCodes = new Set<string>();
  for (const scope of effectiveScopes) {
    const perms = scopeDefMap.get(scope);
    if (perms) {
      for (const p of perms) {
        permissionCodes.add(p);
      }
    }
  }

  // Step 3: intersect with user's actual permissions
  const userPermSet = new Set(userPermissions);
  return Array.from(permissionCodes).filter((p) => userPermSet.has(p));
}

// ─── Validate Access Token ──────────────────────────────────

/**
 * Validate a raw OAuth access token.
 * Hashes the token and looks it up in oauth_tokens.
 */
export async function validateAccessToken(rawToken: string): Promise<ValidateTokenResult> {
  try {
    const tokenHash = hashSHA256(rawToken);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('app_id, user_id, school_id, scopes, access_token_expires_at')
      .eq('access_token_hash', tokenHash)
      .is('revoked_at', null)
      .single();

    if (error || !data) {
      return { valid: false, error: 'Token not found or revoked' };
    }

    // Check expiry
    const expiresAt = new Date(data.access_token_expires_at);
    if (expiresAt <= new Date()) {
      return { valid: false, error: 'Token expired' };
    }

    return {
      valid: true,
      appId: data.app_id,
      userId: data.user_id,
      schoolId: data.school_id,
      scopes: data.scopes,
    };
  } catch (err) {
    logger.error('oauth_validate_token_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { valid: false, error: 'Token validation failed' };
  }
}

// ─── Revoke App Tokens ──────────────────────────────────────

/**
 * Revoke all active tokens for an OAuth app, optionally scoped to a school.
 */
export async function revokeAppTokens(appId: string, schoolId?: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('app_id', appId)
      .is('revoked_at', null);

    if (schoolId) {
      query = query.eq('school_id', schoolId);
    }

    await query;

    await writeAuditEvent({
      eventType: 'oauth_consent',
      actorUserId: null,
      action: 'revoke',
      result: 'granted',
      resourceType: 'oauth_tokens',
      resourceId: appId,
      metadata: { schoolId: schoolId ?? null },
    });
  } catch (err) {
    logger.error('oauth_revoke_tokens_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}
