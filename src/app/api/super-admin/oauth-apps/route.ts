/**
 * Super Admin — OAuth App Management
 *
 * GET  /api/super-admin/oauth-apps?action=list|detail
 * POST /api/super-admin/oauth-apps  { action: approve_app|reject_app|suspend_app }
 *
 * Admin-only endpoint for reviewing, approving, rejecting, and suspending
 * OAuth applications registered by third-party developers.
 *
 * Auth: session-based admin auth via authorizeAdmin() (P9).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  isValidUUID,
} from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const action = params.get('action') || 'list';
    const supabase = getSupabaseAdmin();

    // ------------------------------------------------------------------
    // action=detail — single app with full details
    // ------------------------------------------------------------------
    if (action === 'detail') {
      const appId = params.get('app_id');
      if (!appId || !isValidUUID(appId)) {
        return NextResponse.json(
          { success: false, error: 'Valid app_id is required' },
          { status: 400 }
        );
      }

      const { data: app, error } = await supabase
        .from('oauth_apps')
        .select('*')
        .eq('id', appId)
        .single();

      if (error || !app) {
        return NextResponse.json(
          { success: false, error: 'App not found' },
          { status: 404 }
        );
      }

      // Fetch associated consents for this app
      const { data: consents } = await supabase
        .from('oauth_consents')
        .select('id, school_id, granted_scopes, status, created_at')
        .eq('app_id', appId)
        .order('created_at', { ascending: false });

      // Count active tokens for this app
      const { count: activeTokenCount } = await supabase
        .from('oauth_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', appId)
        .is('revoked_at', null);

      return NextResponse.json({
        success: true,
        data: {
          ...app,
          // Strip sensitive hash from response
          client_secret_hash: undefined,
          consents: consents || [],
          active_token_count: activeTokenCount || 0,
        },
      });
    }

    // ------------------------------------------------------------------
    // action=list — all apps, optionally filtered by status
    // ------------------------------------------------------------------
    if (action === 'list') {
      const status = params.get('status'); // optional: pending, approved, rejected, suspended
      const page = Math.max(1, parseInt(params.get('page') || '1') || 1);
      const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25') || 25));
      const offset = (page - 1) * limit;

      let query = supabase
        .from('oauth_apps')
        .select('id, name, description, developer_org, logo_url, app_type, review_status, is_active, requested_scopes, created_at, updated_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && ['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
        query = query.eq('review_status', status);
      }

      const { data: apps, error, count } = await query;

      if (error) {
        logger.error('oauth_apps_list_failed', { error });
        return NextResponse.json(
          { success: false, error: 'Failed to fetch OAuth apps' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        data: apps || [],
        total: count || 0,
        page,
        limit,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use: list, detail' },
      { status: 400 }
    );
  } catch (err) {
    logger.error('oauth_apps_get_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'action is required in request body' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

    // ------------------------------------------------------------------
    // approve_app
    // ------------------------------------------------------------------
    if (action === 'approve_app') {
      const { appId } = body;
      if (!appId || !isValidUUID(appId)) {
        return NextResponse.json(
          { success: false, error: 'Valid appId is required' },
          { status: 400 }
        );
      }

      // Verify app exists and is in a reviewable state
      const { data: app, error: fetchErr } = await supabase
        .from('oauth_apps')
        .select('id, name, review_status')
        .eq('id', appId)
        .single();

      if (fetchErr || !app) {
        return NextResponse.json(
          { success: false, error: 'App not found' },
          { status: 404 }
        );
      }

      if (app.review_status === 'approved') {
        return NextResponse.json(
          { success: false, error: 'App is already approved' },
          { status: 409 }
        );
      }

      const { error: updateErr } = await supabase
        .from('oauth_apps')
        .update({
          review_status: 'approved',
          reviewed_by: auth.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', appId);

      if (updateErr) {
        logger.error('oauth_app_approve_failed', { error: updateErr, appId });
        return NextResponse.json(
          { success: false, error: 'Failed to approve app' },
          { status: 500 }
        );
      }

      await logAdminAudit(
        auth,
        'oauth_app.approved',
        'oauth_apps',
        appId,
        { app_name: app.name, previous_status: app.review_status },
        ipAddress || undefined
      );

      return NextResponse.json({ success: true, data: { appId, review_status: 'approved' } });
    }

    // ------------------------------------------------------------------
    // reject_app
    // ------------------------------------------------------------------
    if (action === 'reject_app') {
      const { appId, reason } = body;
      if (!appId || !isValidUUID(appId)) {
        return NextResponse.json(
          { success: false, error: 'Valid appId is required' },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'A rejection reason is required' },
          { status: 400 }
        );
      }

      const { data: app, error: fetchErr } = await supabase
        .from('oauth_apps')
        .select('id, name, review_status')
        .eq('id', appId)
        .single();

      if (fetchErr || !app) {
        return NextResponse.json(
          { success: false, error: 'App not found' },
          { status: 404 }
        );
      }

      const { error: updateErr } = await supabase
        .from('oauth_apps')
        .update({
          review_status: 'rejected',
          reviewed_by: auth.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', appId);

      if (updateErr) {
        logger.error('oauth_app_reject_failed', { error: updateErr, appId });
        return NextResponse.json(
          { success: false, error: 'Failed to reject app' },
          { status: 500 }
        );
      }

      await logAdminAudit(
        auth,
        'oauth_app.rejected',
        'oauth_apps',
        appId,
        { app_name: app.name, previous_status: app.review_status, reason: reason.trim() },
        ipAddress || undefined
      );

      return NextResponse.json({ success: true, data: { appId, review_status: 'rejected' } });
    }

    // ------------------------------------------------------------------
    // suspend_app — also revokes all active tokens
    // ------------------------------------------------------------------
    if (action === 'suspend_app') {
      const { appId, reason } = body;
      if (!appId || !isValidUUID(appId)) {
        return NextResponse.json(
          { success: false, error: 'Valid appId is required' },
          { status: 400 }
        );
      }
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'A suspension reason is required' },
          { status: 400 }
        );
      }

      const { data: app, error: fetchErr } = await supabase
        .from('oauth_apps')
        .select('id, name, review_status')
        .eq('id', appId)
        .single();

      if (fetchErr || !app) {
        return NextResponse.json(
          { success: false, error: 'App not found' },
          { status: 404 }
        );
      }

      if (app.review_status === 'suspended') {
        return NextResponse.json(
          { success: false, error: 'App is already suspended' },
          { status: 409 }
        );
      }

      // Suspend the app
      const { error: updateErr } = await supabase
        .from('oauth_apps')
        .update({
          review_status: 'suspended',
          is_active: false,
          reviewed_by: auth.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', appId);

      if (updateErr) {
        logger.error('oauth_app_suspend_failed', { error: updateErr, appId });
        return NextResponse.json(
          { success: false, error: 'Failed to suspend app' },
          { status: 500 }
        );
      }

      // Revoke all active tokens for this app
      const { data: revokedTokens, error: revokeErr } = await supabase
        .from('oauth_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('app_id', appId)
        .is('revoked_at', null)
        .select('id');
      const revokedCount = revokedTokens?.length ?? 0;

      if (revokeErr) {
        // Log but don't fail the suspension — the app is already suspended
        logger.error('oauth_app_suspend_token_revoke_failed', {
          error: revokeErr,
          appId,
        });
      }

      // Also revoke active consents
      const { error: consentErr } = await supabase
        .from('oauth_consents')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: auth.userId })
        .eq('app_id', appId)
        .eq('status', 'active');

      if (consentErr) {
        logger.error('oauth_app_suspend_consent_revoke_failed', {
          error: consentErr,
          appId,
        });
      }

      await logAdminAudit(
        auth,
        'oauth_app.suspended',
        'oauth_apps',
        appId,
        {
          app_name: app.name,
          previous_status: app.review_status,
          reason: reason.trim(),
          tokens_revoked: revokedCount || 0,
        },
        ipAddress || undefined
      );

      return NextResponse.json({
        success: true,
        data: {
          appId,
          review_status: 'suspended',
          tokens_revoked: revokedCount || 0,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use: approve_app, reject_app, suspend_app' },
      { status: 400 }
    );
  } catch (err) {
    logger.error('oauth_apps_post_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
