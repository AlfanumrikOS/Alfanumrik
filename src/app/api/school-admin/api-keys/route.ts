import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/api-keys — List API keys for this school
 * Permission: school.manage_api_keys
 *
 * Returns: id, name, key_prefix (NOT key_hash), permissions,
 *          last_used_at, expires_at, is_active, created_at
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_api_keys');
    if (!auth.authorized) return auth.errorResponse;

    const supabase = getSupabaseAdmin();

    const { data: keys, error } = await supabase
      .from('school_api_keys')
      .select('id, name, key_prefix, permissions, last_used_at, expires_at, is_active, created_at')
      .eq('school_id', auth.schoolId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('school_api_keys_list_error', {
        error: new Error(error.message),
        route: '/api/school-admin/api-keys',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch API keys' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { keys: keys ?? [] },
    });
  } catch (err) {
    logger.error('school_api_keys_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/api-keys',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/school-admin/api-keys — Generate a new API key
 * Permission: school.manage_api_keys
 *
 * Body: { name: string, permissions: string[], expires_in_days?: number }
 * Available permissions: ['students.read', 'reports.read', 'classes.read']
 *
 * Returns the FULL key ONCE in the response (never stored in plaintext).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_api_keys');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { name, permissions, expires_in_days } = body as {
      name?: string;
      permissions?: string[];
      expires_in_days?: number;
    };

    // Validate name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { success: false, error: 'API key name is required' },
        { status: 400 }
      );
    }

    if (name.trim().length > 100) {
      return NextResponse.json(
        { success: false, error: 'API key name must be 100 characters or fewer' },
        { status: 400 }
      );
    }

    // Validate permissions
    const ALLOWED_PERMISSIONS = ['students.read', 'reports.read', 'classes.read'];

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return NextResponse.json(
        { success: false, error: `permissions is required. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    const invalidPerms = permissions.filter((p) => !ALLOWED_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid permissions: ${invalidPerms.join(', ')}. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate expires_in_days if provided
    if (expires_in_days !== undefined && expires_in_days !== null) {
      const days = Number(expires_in_days);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return NextResponse.json(
          { success: false, error: 'expires_in_days must be an integer between 1 and 365' },
          { status: 400 }
        );
      }
    }

    // Generate API key (Edge-compatible, no Node crypto)
    const rawBytes = new Uint8Array(32);
    crypto.getRandomValues(rawBytes);
    const hex = Array.from(rawBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const fullKey = `sk_school_${hex}`;
    const prefix = hex.substring(0, 8);

    // SHA-256 hash for storage
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(fullKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Calculate expiration
    let expiresAt: string | null = null;
    if (expires_in_days) {
      const d = new Date();
      d.setDate(d.getDate() + Number(expires_in_days));
      expiresAt = d.toISOString();
    }

    const supabase = getSupabaseAdmin();

    const { data: newKey, error } = await supabase
      .from('school_api_keys')
      .insert({
        school_id: auth.schoolId,
        name: name.trim(),
        key_prefix: prefix,
        key_hash: keyHash,
        permissions,
        expires_at: expiresAt,
        is_active: true,
        created_by: auth.userId,
      })
      .select('id, name, key_prefix, permissions, expires_at, created_at')
      .single();

    if (error) {
      logger.error('school_api_key_create_error', {
        error: new Error(error.message),
        route: '/api/school-admin/api-keys',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create API key' },
        { status: 500 }
      );
    }

    // Log key creation for audit trail
    logger.info('school_api_key_created', {
      route: '/api/school-admin/api-keys',
      schoolId: auth.schoolId,
      keyId: newKey.id,
      keyName: name.trim(),
      permissions,
    });

    // Return the full key ONCE — it will never be retrievable again
    return NextResponse.json(
      {
        success: true,
        data: {
          key: fullKey,
          id: newKey.id,
          name: newKey.name,
          key_prefix: newKey.key_prefix,
          permissions: newKey.permissions,
          expires_at: newKey.expires_at,
          created_at: newKey.created_at,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('school_api_keys_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/api-keys',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/school-admin/api-keys — Revoke an API key
 * Permission: school.manage_api_keys
 *
 * Body: { id: string }
 * Soft-deletes by setting is_active = false (audit trail preserved).
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_api_keys');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { id } = body as { id?: string };

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'API key id is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Scope to this school to prevent cross-school revocation
    const { data: updated, error } = await supabase
      .from('school_api_keys')
      .update({ is_active: false })
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .select('id, name, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'API key not found' },
          { status: 404 }
        );
      }
      logger.error('school_api_key_revoke_error', {
        error: new Error(error.message),
        route: '/api/school-admin/api-keys',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }

    // Log revocation for audit trail
    logger.info('school_api_key_revoked', {
      route: '/api/school-admin/api-keys',
      schoolId: auth.schoolId,
      keyId: id,
      keyName: updated.name,
    });

    return NextResponse.json({
      success: true,
      data: { id: updated.id, is_active: updated.is_active },
    });
  } catch (err) {
    logger.error('school_api_keys_delete_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/api-keys',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
