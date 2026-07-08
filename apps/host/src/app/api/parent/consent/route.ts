/**
 * /api/parent/consent — DPDP parental consent capture, revocation, list.
 *
 * Phase D.1. India's Digital Personal Data Protection (DPDP) Act
 * requires explicit, verifiable parental consent before processing a
 * minor's personal data. This route is the single capture/revoke point.
 *
 * Routes:
 *   - POST   /api/parent/consent — record consent for one student
 *   - DELETE /api/parent/consent — revoke active consent
 *   - GET    /api/parent/consent — list caller's active consents
 *
 * Auth: guardian Supabase session (cookie or bearer). The route
 * verifies the caller is a linked guardian of the target student before
 * any mutation. Link-code-only parents (no Supabase auth) are NOT
 * accepted here — the consent capture screen redirects them to sign
 * in first.
 *
 * Side effects per write:
 *   1. INSERT/UPDATE parental_consent (via src/lib/dpdp/consent.ts)
 *   2. publishEvent('parent.consent_granted' | 'parent.consent_revoked')
 *   3. auditLog with action 'parent.consent.granted' | 'parent.consent.revoked'
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';
import { auditLog } from '@alfanumrik/lib/audit';
import {
  recordConsent,
  revokeConsent,
  listActiveConsentForGuardian,
  CONSENT_SCOPES,
  CURRENT_CONSENT_VERSION,
  type ConsentScope,
} from '@alfanumrik/lib/dpdp/consent';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ── Helpers ────────────────────────────────────────────────────────────

interface AuthedGuardian {
  authUserId: string;
  guardianId: string;
}

/**
 * Resolve the caller's Supabase session and map it to a guardians.id.
 * Returns null with an appropriate error response when the caller is
 * unauthenticated or has no guardian profile.
 */
async function authGuardian(): Promise<
  | { ok: true; data: AuthedGuardian }
  | { ok: false; response: NextResponse }
> {
  const sb = await createSupabaseServerClient();
  const { data: { user }, error: sessionError } = await sb.auth.getUser();
  if (sessionError || !user) {
    return { ok: false, response: err('Unauthorized', 401) };
  }

  const { data: guardian, error: gErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (gErr) {
    logger.error('parent_consent_guardian_lookup_failed', {
      error: new Error(gErr.message),
      route: 'parent/consent',
    });
    return { ok: false, response: err('Internal server error', 500) };
  }
  if (!guardian) {
    return { ok: false, response: err('Guardian account not found', 403) };
  }
  return { ok: true, data: { authUserId: user.id, guardianId: guardian.id } };
}

/**
 * Verify the resolved guardian is actually linked to the target student
 * via an active guardian_student_links row. Without this check, a
 * guardian could record consent for a student they have no relationship
 * with — DPDP audit theft.
 */
async function verifyGuardianLink(
  guardianId: string,
  studentId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select('id, status')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ['active', 'approved'])
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('parent_consent_link_verify_failed', {
      error: new Error(error.message),
      guardianId,
      studentId,
    });
    return false;
  }
  return !!data;
}

// ── POST — capture consent ─────────────────────────────────────────────

const PostBodySchema = z.object({
  studentId: z.string().refine(isValidUUID, 'studentId must be a valid UUID'),
  consentVersion: z.string().min(1).max(64).optional(),
  scopes: z.record(z.string(), z.boolean()),
  locale: z.enum(['en', 'hi']).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authGuardian();
  if (!auth.ok) return auth.response;
  const { authUserId, guardianId } = auth.data;

  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  // Strip any unknown scope keys (defense-in-depth — recordConsent
  // does the same check, but rejecting early keeps the audit clean).
  const cleanScopes: Partial<Record<ConsentScope, boolean>> = {};
  for (const [k, v] of Object.entries(body.scopes)) {
    if ((CONSENT_SCOPES as readonly string[]).includes(k)) {
      cleanScopes[k as ConsentScope] = v;
    }
  }

  // Required scopes: curriculum_access must be granted, otherwise we
  // cannot legally process any of the child's data. Block at the route.
  if (cleanScopes.curriculum_access !== true) {
    return err('curriculum_access scope is required to proceed', 400);
  }

  // Ownership check — the canonical DPDP-audit guard.
  const isLinked = await verifyGuardianLink(guardianId, body.studentId);
  if (!isLinked) {
    return err('Not linked to that student', 403);
  }

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null;
  const userAgent = request.headers.get('user-agent');

  const consentVersion = body.consentVersion ?? CURRENT_CONSENT_VERSION;

  const result = await recordConsent({
    guardianId,
    studentId: body.studentId,
    consentVersion,
    scopes: cleanScopes,
    locale: body.locale ?? 'en',
    ipAddress: ipAddress ?? undefined,
    userAgent: userAgent ?? undefined,
  });

  if (!result.ok) {
    if (result.code === 'CONFLICT') return err(result.error, 409);
    if (result.code === 'INVALID_INPUT') return err(result.error, 400);
    return err('Failed to record consent', 500);
  }
  const consentId = result.data;

  // Emit event + audit log. Both fire-and-forget — failures must not
  // roll back the canonical consent row.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'parent.consent_granted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: authUserId,
      tenantId: null,
      idempotencyKey: `consent_granted:${consentId}`,
      payload: {
        consentId,
        guardianId,
        studentId: body.studentId,
        consentVersion,
        scopes: cleanScopes,
        locale: body.locale ?? 'en',
      },
    });
  } catch (e) {
    logger.warn('parent_consent_granted_publish_failed', {
      route: 'parent/consent',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await auditLog({
    actor_id: authUserId,
    actor_role: 'guardian',
    action: 'parent.consent.granted',
    target_entity: 'parental_consent',
    target_id: consentId,
    metadata: {
      student_id: body.studentId,
      guardian_id: guardianId,
      consent_version: consentVersion,
      scopes: cleanScopes,
    },
    request,
  });

  return NextResponse.json({ success: true, consentId, consentVersion });
}

// ── DELETE — revoke consent ────────────────────────────────────────────

const DeleteBodySchema = z.object({
  studentId: z.string().refine(isValidUUID, 'studentId must be a valid UUID'),
});

export async function DELETE(request: NextRequest) {
  const auth = await authGuardian();
  if (!auth.ok) return auth.response;
  const { authUserId, guardianId } = auth.data;

  let body: z.infer<typeof DeleteBodySchema>;
  try {
    body = DeleteBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const isLinked = await verifyGuardianLink(guardianId, body.studentId);
  if (!isLinked) {
    return err('Not linked to that student', 403);
  }

  // Fetch consent_version of the row about to be revoked — the event
  // payload needs it for the regulator audit trail.
  const { data: activeRow } = await supabaseAdmin
    .from('parental_consent')
    .select('consent_version')
    .eq('guardian_id', guardianId)
    .eq('student_id', body.studentId)
    .is('revoked_at', null)
    .maybeSingle();

  const revokedVersion = (activeRow as { consent_version?: string } | null)?.consent_version
    ?? CURRENT_CONSENT_VERSION;

  const result = await revokeConsent({
    guardianId,
    studentId: body.studentId,
  });

  if (!result.ok) {
    if (result.code === 'NOT_FOUND') return err('No active consent to revoke', 404);
    return err('Failed to revoke consent', 500);
  }
  const consentId = result.data;

  try {
    await publishEvent(supabaseAdmin, {
      kind: 'parent.consent_revoked',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: authUserId,
      tenantId: null,
      idempotencyKey: `consent_revoked:${consentId}`,
      payload: {
        consentId,
        guardianId,
        studentId: body.studentId,
        consentVersion: revokedVersion,
      },
    });
  } catch (e) {
    logger.warn('parent_consent_revoked_publish_failed', {
      route: 'parent/consent',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await auditLog({
    actor_id: authUserId,
    actor_role: 'guardian',
    action: 'parent.consent.revoked',
    target_entity: 'parental_consent',
    target_id: consentId,
    metadata: {
      student_id: body.studentId,
      guardian_id: guardianId,
      consent_version: revokedVersion,
    },
    request,
  });

  return NextResponse.json({ success: true, consentId });
}

// ── GET — list active consents ─────────────────────────────────────────

export async function GET() {
  const auth = await authGuardian();
  if (!auth.ok) return auth.response;
  const { guardianId } = auth.data;

  const result = await listActiveConsentForGuardian(guardianId);
  if (!result.ok) {
    return err('Failed to list consents', 500);
  }

  return NextResponse.json({
    success: true,
    items: result.data,
    currentVersion: CURRENT_CONSENT_VERSION,
  });
}
