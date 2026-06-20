/**
 * /api/school-admin/webhooks — Outbound webhook subscription management (Track A.6).
 * ============================================================================
 * A school admin registers/lists/deactivates the outbound webhook sinks for
 * THEIR OWN school. Permission: `public_api.manage`.
 *
 *   POST   — create a subscription. Returns the raw HMAC signing secret EXACTLY
 *            ONCE; only secret_hash is persisted (P13). target_url must be https
 *            and pass the SSRF guard (no private/loopback/link-local) at create.
 *   GET    — list this school's subscriptions (never returns secret_hash).
 *   DELETE — deactivate a subscription (soft: is_active=false).
 *
 * TENANT ISOLATION: school_id is taken from authorizeSchoolAdmin ONLY — never the
 * request body. Every query is scoped to auth.schoolId.
 *
 * NOTE: this is the OUTBOUND school-integration webhook system, COMPLETELY
 * SEPARATE from the inbound Razorpay payment webhook (P11). Different secret,
 * different direction, different table. Razorpay HMAC handling is untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';
import { validateWebhookTargetUrl } from '@/lib/public-api/ssrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = 'public_api.manage';

/** Allowed outbound event names a subscription may subscribe to (v1). */
const ALLOWED_EVENT_TYPES = [
  'roster.import.completed',
  'student.enrolled',
  'report.generated',
];

const MAX_EVENT_TYPES = 20;

/** SHA-256 hex of a value (Edge + Node compatible via Web Crypto). */
async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * GET — list this school's webhook subscriptions. Never returns secret_hash.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, PERMISSION);
    if (!auth.authorized) return auth.errorResponse!;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, target_url, event_types, is_active, description, created_at, updated_at')
      .eq('school_id', auth.schoolId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('webhook_subscriptions_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/webhooks',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch webhook subscriptions' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: { subscriptions: data ?? [] } });
  } catch (err) {
    logger.error('webhook_subscriptions_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/webhooks',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST — create a subscription.
 * Body: { target_url: string, event_types: string[], description?: string }
 * Returns the raw signing secret ONCE in `data.secret`.
 */
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

    const { target_url, event_types, description } = body as {
      target_url?: string;
      event_types?: string[];
      description?: string;
    };

    // Validate target_url — https only + SSRF block (private/loopback/link-local).
    if (!target_url || typeof target_url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'target_url is required' },
        { status: 400 },
      );
    }
    const ssrf = validateWebhookTargetUrl(target_url);
    if (!ssrf.ok) {
      return NextResponse.json(
        { success: false, error: ssrf.reason ?? 'target_url is not allowed' },
        { status: 400 },
      );
    }

    // Validate event_types.
    if (!Array.isArray(event_types) || event_types.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `event_types is required. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
        },
        { status: 400 },
      );
    }
    if (event_types.length > MAX_EVENT_TYPES) {
      return NextResponse.json(
        { success: false, error: `Maximum ${MAX_EVENT_TYPES} event_types per subscription` },
        { status: 400 },
      );
    }
    const invalid = event_types.filter((e) => !ALLOWED_EVENT_TYPES.includes(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid event_types: ${invalid.join(', ')}. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
        },
        { status: 400 },
      );
    }

    if (description !== undefined && (typeof description !== 'string' || description.length > 200)) {
      return NextResponse.json(
        { success: false, error: 'description must be a string of 200 characters or fewer' },
        { status: 400 },
      );
    }

    // Generate the HMAC signing secret (CSPRNG). Raw shown ONCE; only the hash
    // is stored (P13 — never persist the raw secret).
    const rawBytes = new Uint8Array(32);
    crypto.getRandomValues(rawBytes);
    const hex = Array.from(rawBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const rawSecret = `whsec_${hex}`;
    const secretHash = await sha256Hex(rawSecret);

    const supabase = getSupabaseAdmin();
    const { data: created, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        school_id: schoolId, // tenant from auth only
        target_url,
        event_types,
        secret_hash: secretHash,
        is_active: true,
        description: description?.trim() || null,
        created_by: auth.userId,
      })
      .select('id, target_url, event_types, is_active, description, created_at')
      .single();

    if (error) {
      logger.error('webhook_subscription_create_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/webhooks',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create webhook subscription' },
        { status: 500 },
      );
    }

    // P13: audit carries metadata only — never the raw secret or its hash.
    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'webhook_subscription.created',
      resourceType: 'webhook_subscription',
      resourceId: created.id,
      metadata: { event_types, target_host: ssrf.host },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    // Return the raw secret ONCE — it can never be retrieved again.
    return NextResponse.json(
      {
        success: true,
        data: {
          id: created.id,
          target_url: created.target_url,
          event_types: created.event_types,
          is_active: created.is_active,
          description: created.description,
          created_at: created.created_at,
          // Raw HMAC signing secret — shown exactly once.
          secret: rawSecret,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    logger.error('webhook_subscriptions_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/webhooks',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE — deactivate a subscription (soft). Body: { id: string }.
 * Scoped to this school so a caller can never deactivate another school's sink.
 */
export async function DELETE(request: NextRequest) {
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

    const { id } = body as { id?: string };
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Subscription id is required' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: updated, error } = await supabase
      .from('webhook_subscriptions')
      .update({ is_active: false })
      .eq('id', id)
      .eq('school_id', schoolId) // tenant isolation
      .select('id, is_active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Webhook subscription not found' },
          { status: 404 },
        );
      }
      logger.error('webhook_subscription_delete_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/webhooks',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to deactivate webhook subscription' },
        { status: 500 },
      );
    }

    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'webhook_subscription.deactivated',
      resourceType: 'webhook_subscription',
      resourceId: id,
      metadata: {},
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, data: { id: updated.id, is_active: updated.is_active } });
  } catch (err) {
    logger.error('webhook_subscriptions_delete_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/webhooks',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
