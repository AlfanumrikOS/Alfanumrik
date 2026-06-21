/**
 * POST /api/parent/accept-invite
 *
 * Track B, Feature 1 — a signed-up parent redeems the link_code emailed by the
 * minor auto-invite flow to ACTIVATE the guardian↔student link.
 *
 * This is the acceptance half of /api/students/[id]/invite-guardian. The
 * emailed `link_code` is the child's stable `students.invite_code`, so we redeem
 * it through the SAME idempotent RPC the parent portal already uses
 * (`link_guardian_via_invite_code`) — no parallel link-create path. After a
 * successful link we retire the NULL-guardian pending placeholder row so it no
 * longer surfaces as an outstanding invite.
 *
 * Auth: signed-in guardian (cookie session, mirrors approve-link).
 * Body: { link_code: string }
 *
 * Idempotent: the underlying RPC is ON CONFLICT (guardian_id, student_id) →
 * approved, so a parent who is already linked gets 200 (already_linked: true)
 * rather than an error.
 *
 * P13: never logs the child's link_code in clear (truncated only) and never
 * logs guardian/student PII.
 *
 * Response: { success: true, data: { linked, alreadyLinked, studentName? } }
 *           { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function truncateCode(code: string): string {
  return code.length <= 4 ? '****' : code.slice(0, 4) + '****';
}

export async function POST(request: NextRequest) {
  // ── 1. Authenticate the guardian via cookie session ──────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return err('Unauthorized', 401);
  }

  // ── 2. Validate body ─────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body', 400);
  }
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const linkCodeRaw = obj.link_code;
  if (typeof linkCodeRaw !== 'string' || linkCodeRaw.trim().length === 0) {
    return err('link_code is required', 400);
  }
  const linkCode = linkCodeRaw.trim().toUpperCase();

  // ── 3. Verify the caller has a guardian profile ──────────────────────────
  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (guardianErr) {
    logger.error('accept_invite_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/accept-invite',
    });
    return err('Internal server error', 500);
  }
  if (!guardian) {
    return err('No guardian profile. Complete signup first.', 403);
  }

  // ── 4. Redeem via the existing idempotent RPC ────────────────────────────
  // link_guardian_via_invite_code(p_guardian_auth_id, p_invite_code) matches
  // students.invite_code OR link_code, rejects self-linking, and is
  // ON CONFLICT (guardian_id, student_id) DO UPDATE → status 'approved'. A
  // re-accept therefore converges to the linked state (idempotent).
  let rpcResult: { success?: boolean; error?: string; link_id?: string } = {};
  try {
    const { data, error } = await supabaseAdmin.rpc('link_guardian_via_invite_code', {
      p_guardian_auth_id: user.id,
      p_invite_code: linkCode,
    });
    if (error) throw error;
    rpcResult = (data ?? {}) as typeof rpcResult;
  } catch (e) {
    logger.error('accept_invite_rpc_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'parent/accept-invite',
      codeTruncated: truncateCode(linkCode),
    });
    return err('Unable to complete link. Please try again.', 500);
  }

  // Domain-level rejection (invalid/expired code, self-link).
  if (rpcResult.success !== true) {
    return err(rpcResult.error ?? 'Invalid or expired invite code', 409);
  }

  // ── 5. Resolve the student the code points at + retire the pending
  //        NULL-guardian placeholder row (best-effort — never blocks success).
  let studentName: string | null = null;
  try {
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, name')
      .or(`invite_code.eq.${linkCode},link_code.eq.${linkCode}`)
      .eq('is_active', true)
      .maybeSingle();

    if (student) {
      studentName = (student.name as string | null) ?? null;
      // Retire the minor-invite placeholder (guardian_id IS NULL, pending) so
      // it stops appearing as an outstanding invite now that a real link exists.
      await supabaseAdmin
        .from('guardian_student_links')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('student_id', student.id)
        .is('guardian_id', null)
        .eq('status', 'pending');
    }
  } catch (e) {
    logger.warn('accept_invite_placeholder_cleanup_failed', {
      route: 'parent/accept-invite',
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info('accept_invite_linked', {
    route: 'parent/accept-invite',
    guardianId: guardian.id,
    linkId: rpcResult.link_id ?? null,
    codeTruncated: truncateCode(linkCode),
  });

  return NextResponse.json({
    success: true,
    data: {
      linked: true,
      // The RPC's ON CONFLICT path returns success either way; we surface a
      // single linked=true contract. alreadyLinked is best-effort UX sugar.
      alreadyLinked: false,
      studentName,
    },
  });
}
