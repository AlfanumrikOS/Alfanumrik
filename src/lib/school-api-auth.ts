/**
 * School API Key Authentication
 *
 * Shared authentication helper for public school API routes that use
 * API key authentication (as opposed to JWT-based school admin auth
 * in `school-admin-auth.ts`).
 *
 * Used by:
 *   - /api/v1/school/reports — ERP integration reports
 *   - /api/v1/school/students — ERP integration student list
 *
 * Auth flow:
 *   1. Extract Bearer token from Authorization header (must start with `sk_school_`)
 *   2. SHA-256 hash the key (Edge-compatible via crypto.subtle)
 *   3. Look up the hash in `school_api_keys` (must be active, not expired)
 *   4. Return school_id + key permissions on success, null on failure
 *   5. Fire-and-forget update to `last_used_at`
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';

// ─── Types ───────────────────────────────────────────────────

/** Result of a successful API key authentication. */
export interface SchoolApiKeyAuth {
  /** The school this API key belongs to. */
  schoolId: string;
  /** The primary key of the API key record. */
  keyId: string;
  /** Permission strings granted to this key (e.g. `['students.read', 'reports.read']`). */
  permissions: string[];
}

// ─── Main Auth Function ──────────────────────────────────────

/**
 * Authenticate an incoming request using a school API key.
 *
 * Expects: `Authorization: Bearer sk_school_...`
 * Verifies: SHA-256 hash matches, key is active, not expired.
 *
 * @param request - The incoming Next.js request (needs `headers.get('Authorization')`)
 * @returns The authenticated school context, or `null` if authentication fails.
 */
export async function authenticateApiKey(
  request: Request
): Promise<SchoolApiKeyAuth | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer sk_school_')) return null;

  const key = authHeader.replace('Bearer ', '');

  // SHA-256 hash the provided key (Edge-compatible)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from('school_api_keys')
    .select('id, school_id, permissions, expires_at')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget -- don't block the response)
  supabase
    .from('school_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    schoolId: data.school_id,
    keyId: data.id,
    permissions: data.permissions ?? [],
  };
}
