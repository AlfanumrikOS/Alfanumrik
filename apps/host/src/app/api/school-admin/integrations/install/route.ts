/**
 * POST /api/school-admin/integrations/install — Marketplace install (Track A.6).
 * ============================================================================
 * Install (or re-activate / pause) a marketplace listing for the caller's OWN
 * school. Permission: `public_api.manage`.
 *
 *   Body: { listing_id: string, status?: 'active'|'paused', config?: object }
 *
 * Lifecycle: pending → active → paused → uninstalled. This route creates a row
 * (default 'active') or transitions an existing non-uninstalled row. The DB
 * partial unique index (school_id, listing_id) WHERE status<>'uninstalled'
 * guarantees ONE active install per (school, listing); a re-install after
 * uninstall creates a fresh row.
 *
 * TENANT ISOLATION: school_id from authorizeSchoolAdmin ONLY — never the body.
 * P13: `config` is non-secret only — any issued key/secret lives hashed in its
 * own table, never raw in config. We reject a `config` that smells like a secret.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = 'public_api.manage';

/** Config keys that would indicate a raw secret slipped into non-secret config. */
const FORBIDDEN_CONFIG_KEYS = ['secret', 'api_key', 'apikey', 'key', 'token', 'password'];

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

    const { listing_id, status, config } = body as {
      listing_id?: string;
      status?: string;
      config?: Record<string, unknown>;
    };

    if (!listing_id || typeof listing_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'listing_id is required' },
        { status: 400 },
      );
    }

    const targetStatus = status ?? 'active';
    if (targetStatus !== 'active' && targetStatus !== 'paused') {
      return NextResponse.json(
        { success: false, error: 'status must be "active" or "paused"' },
        { status: 400 },
      );
    }

    // P13: reject secrets in non-secret config.
    if (config !== undefined) {
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        return NextResponse.json(
          { success: false, error: 'config must be a JSON object' },
          { status: 400 },
        );
      }
      const offending = Object.keys(config).filter((k) =>
        FORBIDDEN_CONFIG_KEYS.includes(k.toLowerCase()),
      );
      if (offending.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `config must not contain secrets (${offending.join(', ')}). Secrets are stored hashed elsewhere.`,
          },
          { status: 400 },
        );
      }
    }

    const supabase = getSupabaseAdmin();

    // Listing must exist and be active (catalog is world-readable, active-only).
    const { data: listing, error: listingError } = await supabase
      .from('integration_listings')
      .select('id, is_active')
      .eq('id', listing_id)
      .maybeSingle();

    if (listingError) {
      logger.error('integration_install_listing_lookup_failed', {
        error: new Error(listingError.message),
        route: '/api/school-admin/integrations/install',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to verify listing' },
        { status: 500 },
      );
    }
    if (!listing || !listing.is_active) {
      return NextResponse.json(
        { success: false, error: 'Listing not found or inactive' },
        { status: 404 },
      );
    }

    // Is there an existing non-uninstalled install for this (school, listing)?
    const { data: existing } = await supabase
      .from('integration_installs')
      .select('id, status')
      .eq('school_id', schoolId)
      .eq('listing_id', listing_id)
      .neq('status', 'uninstalled')
      .maybeSingle();

    let resultRow: { id: string; status: string };

    if (existing) {
      // Transition the existing active/paused/pending row.
      const { data: updated, error: updateError } = await supabase
        .from('integration_installs')
        .update({
          status: targetStatus,
          ...(config !== undefined ? { config } : {}),
        })
        .eq('id', existing.id)
        .eq('school_id', schoolId) // tenant isolation
        .select('id, status')
        .single();

      if (updateError) {
        logger.error('integration_install_update_failed', {
          error: new Error(updateError.message),
          route: '/api/school-admin/integrations/install',
          schoolId,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to update install' },
          { status: 500 },
        );
      }
      resultRow = updated;
    } else {
      // Fresh install.
      const { data: inserted, error: insertError } = await supabase
        .from('integration_installs')
        .insert({
          school_id: schoolId, // tenant from auth only
          listing_id,
          status: targetStatus,
          installed_by: auth.userId,
          config: config ?? {},
        })
        .select('id, status')
        .single();

      if (insertError) {
        // 23505 = the partial unique index fired (concurrent install) — treat as
        // "already installed" rather than a 500.
        if (insertError.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'This integration is already installed for your school' },
            { status: 409 },
          );
        }
        logger.error('integration_install_insert_failed', {
          error: new Error(insertError.message),
          route: '/api/school-admin/integrations/install',
          schoolId,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to create install' },
          { status: 500 },
        );
      }
      resultRow = inserted;
    }

    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'integration.installed',
      resourceType: 'integration_install',
      resourceId: resultRow.id,
      metadata: { listing_id, status: resultRow.status },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json(
      { success: true, data: { id: resultRow.id, status: resultRow.status } },
      { status: existing ? 200 : 201 },
    );
  } catch (err) {
    logger.error('integration_install_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/integrations/install',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
