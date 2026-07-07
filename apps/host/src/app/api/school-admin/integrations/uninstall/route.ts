/**
 * POST /api/school-admin/integrations/uninstall — Marketplace uninstall (Track A.6).
 * ============================================================================
 * Uninstall a marketplace listing for the caller's OWN school (terminal
 * transition → status='uninstalled'). Permission: `public_api.manage`.
 *
 *   Body: { listing_id: string }  — or  { install_id: string }
 *
 * Setting status='uninstalled' frees the (school, listing) slot in the partial
 * unique index so a future install creates a fresh row. TENANT ISOLATION:
 * school_id from authorizeSchoolAdmin ONLY — never the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = 'public_api.manage';

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, PERMISSION);
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { listing_id, install_id } = body as { listing_id?: string; install_id?: string };
    if ((!listing_id || typeof listing_id !== 'string') && (!install_id || typeof install_id !== 'string')) {
      return NextResponse.json(
        { success: false, error: 'listing_id or install_id is required' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Scope to this school + the active (non-uninstalled) install.
    let query = supabase
      .from('integration_installs')
      .update({ status: 'uninstalled' })
      .eq('school_id', schoolId) // tenant isolation
      .neq('status', 'uninstalled');

    if (install_id) {
      query = query.eq('id', install_id);
    } else {
      query = query.eq('listing_id', listing_id!);
    }

    const { data: updated, error } = await query.select('id, listing_id, status').maybeSingle();

    if (error) {
      logger.error('integration_uninstall_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/integrations/uninstall',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to uninstall integration' },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'No active install found for this listing' },
        { status: 404 },
      );
    }

    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'integration.uninstalled',
      resourceType: 'integration_install',
      resourceId: updated.id,
      metadata: { listing_id: updated.listing_id },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (err) {
    logger.error('integration_uninstall_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/integrations/uninstall',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
