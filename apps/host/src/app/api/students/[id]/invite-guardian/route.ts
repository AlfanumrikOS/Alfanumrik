/**
 * POST /api/students/[id]/invite-guardian
 *
 * Track B, Feature 1 — minor parental-consent auto-invite.
 *
 * Creates (idempotently) a PENDING guardian_student_links row for the student
 * and dispatches a bilingual parent-invite email. Closes the long-standing gap
 * where a minor's `parent_consent_email` was captured at signup but no guardian
 * link / invite was ever created.
 *
 * Auth: the STUDENT themselves (their resolved studentId must equal the route
 * id) OR a super_admin / admin. Tenant/owner-safe — a student can only invite a
 * guardian for their OWN account.
 *
 * Body: { guardian_email: string, locale?: 'en' | 'hi' }
 *
 * Idempotent: a re-invite reuses/refreshes the single pending row (enforced by
 * the partial unique index idx_gsl_unique_pending_student). Already-linked
 * children return 200 without creating a new invite.
 *
 * P13: the guardian email is NEVER logged in clear and never echoed back.
 *
 * Response: { success: true, data: { linkId, reused, alreadyLinked } }
 *           { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { createGuardianInvite } from '@alfanumrik/lib/identity/guardian-invite';

const BodySchema = z.object({
  guardian_email: z.string().trim().email('guardian_email must be a valid email').max(254),
  locale: z.enum(['en', 'hi']).optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // profile.view_own is held by the student role and auto-passed for super_admin.
  // requireStudentId resolves the caller's own student id for the ownership check.
  const auth = await authorizeRequest(request, 'profile.view_own', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: studentId } = await context.params;
  if (!isValidUUID(studentId)) {
    return err('Invalid student id', 400);
  }

  // ── Ownership / tenant boundary ──────────────────────────────────────────
  // Allowed callers: the student themselves (studentId match) OR an admin.
  const isAdmin = auth.roles.some((r) => r === 'super_admin' || r === 'admin');
  const isOwner = !!auth.studentId && auth.studentId === studentId;
  if (!isAdmin && !isOwner) {
    // Generic 403 — never leak whether the student exists.
    return err('Forbidden', 403);
  }

  // ── Validate body ────────────────────────────────────────────────────────
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const result = await createGuardianInvite(studentId, parsed.guardian_email, parsed.locale ?? 'en');

  if (!result.ok) {
    if (result.code === 'STUDENT_NOT_FOUND') return err('Student not found', 404);
    logger.error('invite_guardian_route_failed', {
      error: new Error(result.error ?? 'unknown'),
      route: 'students/[id]/invite-guardian',
      studentId,
    });
    return err('Failed to create guardian invite', 500);
  }

  return NextResponse.json({
    success: true,
    data: {
      linkId: result.linkId ?? null,
      reused: !!result.reused,
      alreadyLinked: result.code === 'ALREADY_LINKED',
    },
  });
}
