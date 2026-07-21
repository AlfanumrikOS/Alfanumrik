/**
 * Pedagogy v2 — Wave 3 Task 6
 * POST /api/synthesis/parent-share
 *
 * Triggers WhatsApp delivery of the monthly synthesis to the linked guardian.
 *
 * Body: { synthesisRunId: string }
 * Returns: { ok: true, sentAt: string } | { error: string }
 *
 * Steps:
 *   1. Auth + flag check (ff_pedagogy_v2_monthly_synthesis).
 *   2. Load monthly_synthesis_runs row; verify student_id matches the
 *      authenticated user (via students.auth_user_id = auth.uid()).
 *   3. Find the linked guardian via guardian_student_links (status in
 *      ('approved','active')).
 *   4. Verify guardians.monthly_synthesis_optin = TRUE. If not, return
 *      403 and update synthesis row status to 'opted_out'.
 *   5. POST to whatsapp-notify Edge Function with the new
 *      'monthly_synthesis' template (added in same PR; Meta-side template
 *      approval is async — until approved, the WhatsApp Cloud API call
 *      itself fails and the row status becomes 'failed').
 *   6. On success: status='sent', sent_at=now(), whatsapp_id=<id>.
 *   7. On failure: status='failed', log the reason.
 */
import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';
import { buildInternalCallerHeaders } from '@alfanumrik/lib/security/internal-caller-signing';

export const dynamic = 'force-dynamic';

interface RequestBody { synthesisRunId?: string }

export async function POST(request: Request) {
  // House RBAC gate (added 2026-07-20, RCA fix Task 1.5). This is a
  // student-initiated action (share own monthly synthesis to a linked
  // guardian) so the closest existing permission code is used. The
  // pre-existing inline ownership check below (row.students.auth_user_id
  // !== userId) is kept as defense-in-depth -- this gate runs first so an
  // unauthorized caller is rejected before any DB access.
  const rbacAuth = await authorizeRequest(request, 'report.download_own');
  if (!rbacAuth.authorized) return rbacAuth.errorResponse!;

  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS, {
    userId, role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: RequestBody;
  try { body = await request.json() as RequestBody; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  if (!body.synthesisRunId || typeof body.synthesisRunId !== 'string') {
    return NextResponse.json({ error: 'missing_synthesis_run_id' }, { status: 400 });
  }

  // 2. Load synthesis row + verify student ownership.
  // Uses supabaseAdmin to allow joining auth.users → students → synthesis row
  // in one query without RLS-juggling. Authorization is enforced by the
  // explicit eq(auth_user_id) below.
  const { data: rowData, error: rowErr } = await supabaseAdmin
    .from('monthly_synthesis_runs')
    .select('id, student_id, synthesis_month, summary_text_en, summary_text_hi, parent_share_status, students!inner(id, name, auth_user_id, grade)')
    .eq('id', body.synthesisRunId)
    .maybeSingle();
  if (rowErr) {
    logger.warn('parent-share: synthesis row fetch failed', { userId, error: rowErr.message });
    return NextResponse.json({ error: 'synthesis_lookup_failed' }, { status: 500 });
  }
  if (!rowData) return NextResponse.json({ error: 'synthesis_not_found' }, { status: 404 });

  const row = rowData as unknown as {
    id: string;
    student_id: string;
    synthesis_month: string;
    summary_text_en: string;
    summary_text_hi: string;
    parent_share_status: string;
    students: { id: string; name: string; auth_user_id: string; grade: string };
  };
  if (row.students.auth_user_id !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.parent_share_status === 'sent') {
    return NextResponse.json({ ok: true, alreadySent: true });
  }

  // 3. Find linked guardian.
  const { data: linkRows } = await supabaseAdmin
    .from('guardian_student_links')
    .select('guardian_id, status')
    .eq('student_id', row.student_id)
    .in('status', ['approved', 'active'])
    .limit(1);
  const guardianId = (linkRows ?? [])[0]?.guardian_id ?? null;
  if (!guardianId) {
    return NextResponse.json({ error: 'no_linked_guardian' }, { status: 404 });
  }

  const { data: guardianRow } = await supabaseAdmin
    .from('guardians')
    .select('id, phone, preferred_language, monthly_synthesis_optin')
    .eq('id', guardianId)
    .maybeSingle();
  if (!guardianRow) return NextResponse.json({ error: 'guardian_not_found' }, { status: 404 });

  // 4. Opt-in gate.
  if (!guardianRow.monthly_synthesis_optin) {
    await supabaseAdmin
      .from('monthly_synthesis_runs')
      .update({ parent_share_status: 'opted_out' })
      .eq('id', row.id);
    return NextResponse.json({ error: 'guardian_opted_out' }, { status: 403 });
  }
  if (!guardianRow.phone) {
    return NextResponse.json({ error: 'guardian_phone_missing' }, { status: 422 });
  }

  // 5. Call whatsapp-notify with the new monthly_synthesis template.
  const whatsappUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-notify`;
  const language: 'en' | 'hi' = guardianRow.preferred_language === 'hi' ? 'hi' : 'en';
  const summaryPreview = (language === 'hi' ? row.summary_text_hi : row.summary_text_en).slice(0, 280);

  let waStatus: 'sent' | 'failed' = 'failed';
  let waId: string | null = null;
  try {
    const waPayload = JSON.stringify({ type: 'monthly_synthesis', recipient_phone: guardianRow.phone, language, data: { student_name: row.students.name, synthesis_month: row.synthesis_month, summary_preview: summaryPreview }, user_id: userId });
    const waSignHeaders = buildInternalCallerHeaders('POST', '/functions/v1/whatsapp-notify', waPayload, 'synthesis-parent-share-route');

    const waRes = await fetch(whatsappUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        ...(waSignHeaders ?? {}),
      },
      body: waPayload,
    });
    if (waRes.ok) {
      waStatus = 'sent';
      const waBody = await waRes.json().catch(() => ({}));
      waId = (waBody as { whatsapp_id?: string; message_id?: string }).whatsapp_id
          ?? (waBody as { message_id?: string }).message_id
          ?? null;
    } else {
      const errText = await waRes.text().catch(() => '');
      logger.warn('parent-share: whatsapp-notify returned non-OK', {
        userId, synthesisRunId: row.id, status: waRes.status, body: errText.slice(0, 200),
      });
    }
  } catch (e) {
    logger.warn('parent-share: whatsapp-notify network error', {
      userId, synthesisRunId: row.id, error: e instanceof Error ? e.message : String(e),
    });
  }

  // 6/7. Persist outcome.
  const sentAt = new Date().toISOString();
  await supabaseAdmin
    .from('monthly_synthesis_runs')
    .update({
      parent_share_status: waStatus,
      parent_share_sent_at: waStatus === 'sent' ? sentAt : null,
      parent_share_whatsapp_id: waId,
    })
    .eq('id', row.id);

  if (waStatus === 'sent') return NextResponse.json({ ok: true, sentAt, waId });
  return NextResponse.json({ error: 'whatsapp_delivery_failed' }, { status: 502 });
}
