/**
 * /api/super-admin/alfabot/denylist
 *
 * Manage AlfaBot denylist entries (anon_id blocklist).
 *
 *   GET    — list current denylist rows (anon_id, reason, added_by, created_at)
 *   POST   — add an anon_id with reason
 *   DELETE — remove an anon_id
 *
 * Auth: `authorizeAdmin(request, 'super_admin')` — mutating an abuse blocklist
 *       is a platform-wide control; restricted to super_admin level. GET is
 *       gated at the same level (the list is itself sensitive).
 *
 * Audit (P14): every mutating action writes an audit_logs row via
 * logAdminAudit with action = 'alfabot.denylist_added' /
 * 'alfabot.denylist_removed' and the target anon_id in resource_id.
 *
 * Permission (NEW): `alfabot.manage_denylist`. The RBAC matrix needs to add
 * this code; until the architect-approved migration ships, the route falls
 * back to super_admin level (which super_admin always has).
 *
 * P13: anon_id is NOT PII (it's a cookie-minted opaque identifier), so the
 * list response is safe. Reason text is free-form but admin-authored — it
 * MUST NOT contain student email/phone/name. The route does not enforce this
 * (callers are admins, not visitors); the runbook reminds reviewers.
 *
 * Owner: ops
 * Reviewers: architect (RBAC), backend (audit shape), testing
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Validation schemas ──────────────────────────────────────────────────────

// anon_id is the 24-char base32-ish identifier produced by `generateAnonId()`
// (see src/lib/anon-id.ts). We accept any non-empty printable string ≤64 chars
// for forward-compat — the cookie format may evolve.
const addSchema = z.object({
  anonId: z.string().trim().min(1).max(64).regex(/^[\w-]+$/, 'anonId must be alphanumeric / dash / underscore'),
  reason: z.string().trim().min(1).max(500),
});

const removeSchema = z.object({
  anonId: z.string().trim().min(1).max(64),
});

// ─── GET — list ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const { data, error } = await supabaseAdmin
      .from('alfabot_denylist')
      .select('anon_id, reason, added_by, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      logger.error('super-admin.alfabot-denylist: list failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: data ?? [],
      total: data?.length ?? 0,
    });
  } catch (err) {
    logger.error('super-admin.alfabot-denylist: GET error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}

// ─── POST — add ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { anonId, reason } = parsed.data;

  try {
    const { error } = await supabaseAdmin
      .from('alfabot_denylist')
      .upsert(
        {
          anon_id: anonId,
          reason,
          added_by: auth.userId,
        },
        { onConflict: 'anon_id' },
      );

    if (error) {
      logger.error('super-admin.alfabot-denylist: insert failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Add failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    await logAdminAudit(
      auth,
      'alfabot.denylist_added',
      'alfabot_denylist',
      anonId,
      { reason, anonId },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({ success: true, anonId });
  } catch (err) {
    logger.error('super-admin.alfabot-denylist: POST error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}

// ─── DELETE — remove ─────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { anonId } = parsed.data;

  try {
    const { error } = await supabaseAdmin
      .from('alfabot_denylist')
      .delete()
      .eq('anon_id', anonId);

    if (error) {
      logger.error('super-admin.alfabot-denylist: delete failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Delete failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    await logAdminAudit(
      auth,
      'alfabot.denylist_removed',
      'alfabot_denylist',
      anonId,
      { anonId },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({ success: true, anonId });
  } catch (err) {
    logger.error('super-admin.alfabot-denylist: DELETE error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
