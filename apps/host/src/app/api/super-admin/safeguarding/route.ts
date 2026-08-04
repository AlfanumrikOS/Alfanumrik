/**
 * /api/super-admin/safeguarding — safeguarding escalation review queue.
 *
 * Safeguarding Phase 1 (ff_safeguarding_v1). Platform-level review surface
 * over `safeguarding_escalations` (the case rows written by /api/foxy when
 * the Tier-2 classifier confirms a disclosure). This is the catch-all queue:
 * every case lands here, including B2C students (school_id null) and schools
 * with zero active admins.
 *
 * GET  — list cases, optional ?status= filter, created_at desc, limit 50.
 *        LIST PAYLOADS NEVER CARRY `disclosure_excerpt` (P13) — the excerpt
 *        is returned ONLY on the single-row detail fetch (?id=<uuid>).
 * PATCH — status transition pending_review → reviewed | actioned | dismissed,
 *        with optional review_notes (REQUIRED non-empty for dismissed — ops
 *        advisory, adopted); stamps reviewed_by/reviewed_at. Audited
 *        metadata-only (action, escalation_id, status — never the excerpt).
 *
 * Auth: `authorizeAdmin(request, 'admin')` — the dominant /api/super-admin/*
 * convention. Reads via the service-role client (safeguarding_escalations is
 * not client-readable; this route is the sanctioned server-side path).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

const LIST_LIMIT = 50;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_STATUSES = ['pending_review', 'reviewed', 'actioned', 'dismissed'] as const;
// Only forward transitions out of pending_review are allowed.
const PATCH_TARGET_STATUSES = ['reviewed', 'actioned', 'dismissed'] as const;

// List projection — deliberately EXCLUDES disclosure_excerpt (P13).
const LIST_COLUMNS =
  'id, student_id, school_id, session_id, category, tier, status, created_at, reviewed_by, reviewed_at';
// Detail projection — the ONLY place the excerpt is returned.
const DETAIL_COLUMNS = `${LIST_COLUMNS}, classifier_meta, review_notes, disclosure_excerpt, retain_until`;

const PatchSchema = z.object({
  id: z.string().regex(UUID_RE, 'id must be a valid UUID'),
  status: z.enum(PATCH_TARGET_STATUSES),
  review_notes: z.string().trim().max(2000).optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  const params = request.nextUrl.searchParams;

  // Single-row detail (?id=) — the ONLY payload carrying disclosure_excerpt.
  const id = params.get('id');
  if (id) {
    if (!UUID_RE.test(id)) return err('Invalid id', 400);
    const { data, error } = await supabaseAdmin
      .from('safeguarding_escalations')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logger.error('super_admin_safeguarding_detail_failed', {
        error: new Error(error.message),
        route: 'super-admin/safeguarding',
      });
      return err('Failed to load escalation', 500);
    }
    if (!data) return err('Escalation not found', 404);
    // Canonical wire contract: single-row detail → { row } (the ONLY payload
    // carrying disclosure_excerpt).
    return NextResponse.json({ row: data });
  }

  // List — excerpt-free projection, newest first, capped at 50.
  const statusFilter = params.get('status');
  if (statusFilter && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    return err('Invalid status filter', 400);
  }

  let query = supabaseAdmin
    .from('safeguarding_escalations')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    logger.error('super_admin_safeguarding_list_failed', {
      error: new Error(error.message),
      route: 'super-admin/safeguarding',
    });
    return err('Failed to list escalations', 500);
  }

  // Canonical wire contract: list → { rows } (excerpt-free projection).
  return NextResponse.json({ rows: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  // Dismissal requires a written justification (ops advisory, adopted):
  // review_notes is trimmed by the schema, so whitespace-only is empty here.
  if (body.status === 'dismissed' && !body.review_notes) {
    return err('review_notes required for dismissal', 400);
  }

  // Load current status — transitions are only valid out of pending_review.
  const { data: current, error: loadErr } = await supabaseAdmin
    .from('safeguarding_escalations')
    .select('id, status')
    .eq('id', body.id)
    .maybeSingle();
  if (loadErr) {
    logger.error('super_admin_safeguarding_patch_load_failed', {
      error: new Error(loadErr.message),
      route: 'super-admin/safeguarding',
    });
    return err('Failed to load escalation', 500);
  }
  if (!current) return err('Escalation not found', 404);
  if ((current as { status: string }).status !== 'pending_review') {
    return err('Only pending_review escalations can be transitioned', 409);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('safeguarding_escalations')
    .update({
      status: body.status,
      review_notes: body.review_notes ?? null,
      reviewed_by: auth.userId,
      reviewed_at: nowIso,
    })
    .eq('id', body.id)
    .eq('status', 'pending_review') // guard against concurrent review
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (updateErr) {
    logger.error('super_admin_safeguarding_patch_failed', {
      error: new Error(updateErr.message),
      route: 'super-admin/safeguarding',
    });
    return err('Failed to update escalation', 500);
  }
  if (!updated) return err('Escalation was already reviewed', 409);

  // Audit — metadata ONLY (action, escalation_id, status). Never the excerpt,
  // never review_notes text (P13).
  await logAdminAudit(auth, 'safeguarding.review', 'safeguarding_escalation', body.id, {
    action: 'safeguarding.review',
    escalation_id: body.id,
    status: body.status,
  }).catch(() => { /* audit failures must never break the request */ });

  // Canonical wire contract: PATCH → { row } (updated row, excerpt-free —
  // the .select() above uses LIST_COLUMNS).
  return NextResponse.json({ row: updated });
}
