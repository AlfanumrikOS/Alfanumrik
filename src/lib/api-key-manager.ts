/**
 * ALFANUMRIK -- School API Key Manager
 *
 * Manages creation, validation, revocation, and listing of school API keys
 * for the B2B developer platform. Keys use the `alfnk_` prefix and are
 * stored as SHA-256 hashes (raw key shown once at creation).
 *
 * Usage:
 *   import { createApiKey, validateApiKey, revokeApiKey, listApiKeys } from '@/lib/api-key-manager';
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { writeAuditEvent } from '@/lib/audit-pipeline';
import { createHash, randomBytes } from 'crypto';

// ─── Types ───────────────────────────────────────────────────

export interface CreateApiKeyInput {
  schoolId: string;
  name: string;
  scopes: string[];
  createdBy: string;
  ipAllowlist?: string[];
  expiresAt?: string;
}

export interface CreateApiKeyResult {
  success: boolean;
  keyId?: string;
  apiKey?: string;
  error?: string;
}

export interface ValidateApiKeyResult {
  valid: boolean;
  schoolId?: string;
  scopes?: string[];
  keyId?: string;
  error?: string;
}

export interface ApiKeyRecord {
  id: string;
  school_id: string;
  name: string;
  scopes: string[];
  created_by: string;
  ip_allowlist: string[] | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function hashSHA256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ─── Create API Key ─────────────────────────────────────────

/**
 * Create a new API key for a school.
 * Returns the raw key exactly once -- it is stored as a SHA-256 hash.
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  try {
    const rawKey = 'alfnk_' + randomBytes(32).toString('base64url');
    const keyHash = hashSHA256(rawKey);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('school_api_keys')
      .insert({
        school_id: input.schoolId,
        name: input.name,
        key_hash: keyHash,
        scopes: input.scopes,
        created_by: input.createdBy,
        ip_allowlist: input.ipAllowlist ?? null,
        expires_at: input.expiresAt ?? null,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('api_key_create_failed', { error: new Error(error.message) });
      return { success: false, error: error.message };
    }

    await writeAuditEvent({
      eventType: 'admin_action',
      actorUserId: input.createdBy,
      action: 'write',
      result: 'granted',
      resourceType: 'school_api_key',
      resourceId: data.id,
      metadata: { schoolId: input.schoolId, keyName: input.name },
    });

    return {
      success: true,
      keyId: data.id,
      apiKey: rawKey,
    };
  } catch (err) {
    logger.error('api_key_create_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { success: false, error: 'Internal error during key creation' };
  }
}

// ─── Validate API Key ───────────────────────────────────────

/**
 * Validate a raw API key. Hashes the key and looks it up by key_hash.
 * Optionally checks IP allowlist.
 */
export async function validateApiKey(
  rawKey: string,
  callerIp?: string,
): Promise<ValidateApiKeyResult> {
  try {
    const keyHash = hashSHA256(rawKey);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('school_api_keys')
      .select('id, school_id, scopes, ip_allowlist, expires_at, is_active')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return { valid: false, error: 'API key not found or inactive' };
    }

    // Check expiry
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at);
      if (expiresAt <= new Date()) {
        return { valid: false, error: 'API key expired' };
      }
    }

    // Check IP allowlist
    if (data.ip_allowlist && data.ip_allowlist.length > 0 && callerIp) {
      if (!data.ip_allowlist.includes(callerIp)) {
        return { valid: false, error: 'IP not in allowlist' };
      }
    }

    // Update last_used_at (fire-and-forget)
    void supabase
      .from('school_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id);

    return {
      valid: true,
      schoolId: data.school_id,
      scopes: data.scopes,
      keyId: data.id,
    };
  } catch (err) {
    logger.error('api_key_validate_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { valid: false, error: 'Key validation failed' };
  }
}

// ─── Revoke API Key ─────────────────────────────────────────

/**
 * Revoke an API key by setting is_active=false.
 */
export async function revokeApiKey(keyId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    await supabase
      .from('school_api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    await writeAuditEvent({
      eventType: 'admin_action',
      actorUserId: null,
      action: 'revoke',
      result: 'granted',
      resourceType: 'school_api_key',
      resourceId: keyId,
    });
  } catch (err) {
    logger.error('api_key_revoke_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

// ─── List API Keys ──────────────────────────────────────────

/**
 * List all API keys for a school. Excludes key_hash from the response.
 */
export async function listApiKeys(schoolId: string): Promise<ApiKeyRecord[]> {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('school_api_keys')
      .select('id, school_id, name, scopes, created_by, ip_allowlist, expires_at, is_active, created_at, last_used_at')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('api_key_list_failed', { error: new Error(error.message) });
      return [];
    }

    return (data as ApiKeyRecord[]) || [];
  } catch (err) {
    logger.error('api_key_list_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return [];
  }
}
