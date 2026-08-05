/**
 * /api/school-admin/safeguarding — school-scoped safeguarding review queue.
 *
 * Safeguarding Phase 1 (ff_safeguarding_v1). School-admin surface over
 * `safeguarding_escalations`, mirroring `/api/school-admin/escalations`'s
 * auth + school-resolution pattern: `authorizeSchoolAdmin` resolves the
 * caller's active school membership and every query is hard-scoped to
 * `school_id = auth.schoolId` (P8 — never returns another school's rows;
 * B2C rows with school_id null are invisible here and live in the
 * super-admin queue instead).
 *
 * GET  — list this school's cases, optional ?status= filter, created_at
 *        desc, limit 50. LIST PAYLOADS NEVER CARRY `disclosure_excerpt`
 *        (P13) — the excerpt is returned ONLY on the single-row detail
 *        fetch (?id=<uuid>), and only when the row belongs to this school.
 * PATCH — status transition pending_review → reviewed | actioned |
 *        dismissed with optional review_notes; stamps reviewed_by/at.
 *        Dismissal REQUIRES non-empty review_notes (ops advisory, adopted).
 *        Audited metadata-only (action, escalation_id, status).
 *
 * Permission gate: `safeguarding.review` (NOT the generic
 * institution.view_analytics) — granted to institution_admin by migration
 * 20260806000100 in role_permissions; the ff_school_admin_rbac Wave C
 * capability matrix does not govern the code unless/until it is added
 * there (ungoverned codes defer to the RBAC check — see
 * schoolAdminRoleAllows in school-admin-auth.ts).
 *
 * Reads via the service-role client behind `authorizeSchoolAdmin` — the
 * established school-admin-panel convention (see escalations/route.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logAdminAuditByUserId } from '@alfanumrik/lib/admin-auth';

export const runtime = 'nodejs';

const LIST_LIMIT = 50;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_STATUSES = ['pending_review', 'reviewed', 'actioned', 'dismissed'] as const;
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
  // Dedicated safeguarding permission (quality-gate resolution): the review
  // lane is gated by 'safeguarding.review', not the generic analytics code.
  const auth = await authorizeSchoolAdmin(request, 'safeguarding.review');
  if (!auth.authorized) return auth.errorResponse!;

  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();
  const params = new URL(request.url).searchParams;

  // Single-row detail (?id=) — the ONLY payload carrying disclosure_excerpt.
  // Hard-scoped: the row must belong to THIS school (P8).
  const id = params.get('id');
  if (id) {
    if (!UUID_RE.test(id)) return err('Invalid id', 400);
    const { data, error } = await supabase
      .from('safeguarding_escalations')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();
    if (error) {
      logger.error('school_admin_safeguarding_detail_failed', {
        error: new Error(error.message),
        route: 'school-admin/safeguarding',
      });
      return err('Failed to load escalation', 500);
    }
    // Not found and cross-school are indistinguishable by design (no payload
    // on any deny — same posture as the pulse routes).
    if (!data) return err('Escalation not found', 404);
    // Canonical wire contract: single-row detail → { row } (the ONLY payload
    // carrying disclosure_excerpt).
    return NextResponse.json({ row: data });
  }

  const statusFilter = params.get('status');
  if (statusFilter && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    return err('Invalid status filter', 400);
  }

  let query = supabase
    .from('safeguarding_escalations')
    .select(LIST_COLUMNS)
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    logger.error('school_admin_safeguarding_list_failed', {
      error: new Error(error.message),
      route: 'school-admin/safeguarding',
    });
    return err('Failed to list escalations', 500);
  }

  // Canonical wire contract: list → { rows } (excerpt-free projection).
  return NextResponse.json({ rows: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'safeguarding.review');
  if (!auth.authorized) return auth.errorResponse!;

  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();

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

  // Load current row — MUST belong to this school (P8) and be pending.
  const { data: current, error: loadErr } = await supabase
    .from('safeguarding_escalations')
    .select('id, status')
    .eq('id', body.id)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (loadErr) {
    logger.error('school_admin_safeguarding_patch_load_failed', {
      error: new Error(loadErr.message),
      route: 'school-admin/safeguarding',
    });
    return err('Failed to load escalation', 500);
  }
  if (!current) return err('Escalation not found', 404);
  if ((current as { status: string }).status !== 'pending_review') {
    return err('Only pending_review escalations can be transitioned', 409);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from('safeguarding_escalations')
    .update({
      status: body.status,
      review_notes: body.review_notes ?? null,
      reviewed_by: auth.userId,
      reviewed_at: nowIso,
    })
    .eq('id', body.id)
    .eq('school_id', schoolId)
    .eq('status', 'pending_review') // guard against concurrent review
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (updateErr) {
    logger.error('school_admin_safeguarding_patch_failed', {
      error: new Error(updateErr.message),
      route: 'school-admin/safeguarding',
    });
    return err('Failed to update escalation', 500);
  }
  if (!updated) return err('Escalation was already reviewed', 409);

  // Audit — metadata ONLY (action, escalation_id, status). Never the excerpt,
  // never review_notes text (P13).
  await logAdminAuditByUserId(
    auth.userId ?? null,
    'safeguarding.review',
    'safeguarding_escalation',
    body.id,
    { action: 'safeguarding.review', escalation_id: body.id, status: body.status },
    undefined,
    { schoolId },
  ).catch(() => { /* audit failures must never break the request */ });

  // Canonical wire contract: PATCH → { row } (updated row, excerpt-free —
  // the .select() above uses LIST_COLUMNS).
  return NextResponse.json({ row: updated });
}
