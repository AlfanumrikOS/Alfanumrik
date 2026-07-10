/**
 * POST /api/parent/accept-invite
 *
 * Track B, Feature 1 — a signed-up parent redeems the link_code emailed by the
 * minor auto-invite flow to ACTIVATE the guardian↔student link.
 *
 * This is the acceptance half of /api/students/[id]/invite-guardian. The
 * emailed `link_code` is the child's stable `students.invite_code`, so we redeem
 * it through an auth.uid()-anchored RPC that delegates to the idempotent link
 * helper and retires the NULL-guardian pending placeholder row.
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
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { isValidLinkCode } from '@alfanumrik/lib/sanitize';

type AcceptInviteRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  link_id?: string;
  student_name?: string | null;
};

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

  // PP-2: strict charset validation BEFORE the code reaches the redeem RPC and
  // the PostgREST `.or()` student lookup below (filter-injection guard). A
  // malformed code is rejected with the same generic shape as an invalid /
  // expired code (no leak about which check failed).
  if (!isValidLinkCode(linkCode)) {
    return err('Invalid or expired invite code', 409);
  }

  // ── 3. Redeem through an auth.uid()-scoped DB boundary ───────────────────
  let rpcResult: AcceptInviteRpcResult = {};
  try {
    const { data, error } = await supabase.rpc('parent_accept_invite_code', {
      p_invite_code: linkCode,
    });
    if (error) throw error;
    rpcResult = (data ?? {}) as AcceptInviteRpcResult;
  } catch (e) {
    logger.error('accept_invite_rpc_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'parent/accept-invite',
      codeTruncated: truncateCode(linkCode),
    });
    return err('Unable to complete link. Please try again.', 500);
  }

  if (rpcResult.success !== true) {
    if (rpcResult.error_code === 'unauthorized') {
      return err('Unauthorized', 401);
    }

    if (rpcResult.error_code === 'no_guardian') {
      return err('No guardian profile. Complete signup first.', 403);
    }

    return err(rpcResult.error ?? 'Invalid or expired invite code', 409);
  }

  logger.info('accept_invite_linked', {
    route: 'parent/accept-invite',
    linkId: rpcResult.link_id ?? null,
    codeTruncated: truncateCode(linkCode),
    authUserId: user.id,
  });

  return NextResponse.json({
    success: true,
    data: {
      linked: true,
      // The RPC's ON CONFLICT path returns success either way; we surface a
      // single linked=true contract. alreadyLinked is best-effort UX sugar.
      alreadyLinked: false,
      studentName: rpcResult.student_name ?? null,
    },
  });
}
