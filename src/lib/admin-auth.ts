/**
 * Admin authentication helper — server-side and client-side utilities.
 *
 * Security model:
 *  - Server routes: check `x-admin-secret` request header ONLY (never URL params).
 *  - Client: stores the secret in sessionStorage (cleared on tab close), never in the URL.
 *  - All admin actions are logged to admin_audit_log via logAdminAction().
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// ─── Server-side auth ─────────────────────────────────────────

/**
 * Validates the x-admin-secret header on a server request.
 * Returns 401 NextResponse if invalid, null if valid.
 */
export function requireAdminSecret(request: NextRequest): NextResponse | null {
  const provided = request.headers.get('x-admin-secret');
  const expected = process.env.SUPER_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 503 });
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // auth OK
}

/**
 * Log an admin action to admin_audit_log (fire-and-forget).
 */
export async function logAdminAction(opts: {
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('admin_audit_log').insert({
      admin_id: null, // set to admin_users.id when proper admin accounts are used
      action: opts.action,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id ?? null,
      details: opts.details ?? {},
      ip_address: opts.ip ?? null,
    });
  } catch {
    // Never let audit log failures break the main flow
  }
}

// Client-side session helpers are in @/lib/admin-session (safe for 'use client' components)
