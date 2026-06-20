/**
 * guardian-invite.ts — minor parental-consent auto-invite (Track B, Feature 1).
 *
 * WHY: when a student signs up as a minor (<13) the signup captures a
 * `parent_consent_email` in auth metadata, but historically NO guardian link
 * or invite was ever created — the parental linkage silently never happened
 * (COPPA/DPDP consent gap). This module closes that by creating a PENDING
 * guardian_student_links row and dispatching a bilingual parent-invite email.
 *
 * REUSE, NOT REINVENT:
 *   - Pending invite rides the EXISTING `guardian_student_links` table with
 *     `guardian_id = NULL`, `status = 'pending'`, `link_code = <student.invite_code>`.
 *     The partial unique index `idx_gsl_unique_pending_student`
 *     (student_id WHERE guardian_id IS NULL AND status='pending') guarantees AT
 *     MOST ONE pending invite per student — so re-invites refresh, never duplicate.
 *   - The parent later redeems `link_code` (= the child's stable, unique
 *     `students.invite_code`) through the SAME RPC the parent portal already
 *     uses (`link_guardian_via_invite_code`), so acceptance reuses verified
 *     machinery rather than a parallel code path.
 *   - Email goes through the existing `deliverEmail` / `send-transactional-email`
 *     seam (bilingual EN/HI per P7), keyed for idempotency on the pending-link
 *     row id.
 *
 * P13: the parent email is NEVER logged. Only a redacted form and the link id
 * appear in structured logs.
 *
 * P15: callers in the signup path MUST treat `enqueueGuardianInvite` as
 * fire-and-forget — it never throws and a failure never blocks profile
 * creation.
 *
 * Server-only (imports supabase-admin + email-delivery). Never import in client.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { deliverEmail, type EmailLocale } from '@/lib/email-delivery';

/** Redact an email for logs — first char + domain only. Never log the local part. */
function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return email[0] + '***@' + email.slice(at + 1);
}

function baseAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://alfanumrik.com').replace(/\/$/, '');
}

export interface CreateGuardianInviteResult {
  ok: boolean;
  /** The pending guardian_student_links row id (idempotency anchor). */
  linkId?: string;
  /** The child's redemption code (= students.invite_code). */
  linkCode?: string;
  /** True when a pre-existing pending invite was reused rather than created. */
  reused?: boolean;
  error?: string;
  code?: 'STUDENT_NOT_FOUND' | 'ALREADY_LINKED' | 'NO_INVITE_CODE' | 'DB_ERROR';
}

/**
 * Idempotently create (or reuse) a PENDING guardian invite for `studentId`
 * addressed to `guardianEmail`, then dispatch the bilingual parent-invite email.
 *
 * Idempotency: keyed by the partial unique index on
 * (student_id) WHERE guardian_id IS NULL AND status='pending'. A second call
 * resolves the existing pending row instead of inserting a duplicate. If the
 * student already has an ACTIVE/APPROVED guardian link, this is a no-op success
 * (`code: 'ALREADY_LINKED'`) — we never create a fresh invite for an
 * already-connected child.
 *
 * NEVER throws. Returns a structured result. Email dispatch is fire-and-forget
 * (its own failures do not flip `ok`).
 *
 * @param guardianEmail Parent/guardian email. Used ONLY as the email `to` and
 *   never logged in clear, never persisted into params (P13).
 */
export async function createGuardianInvite(
  studentId: string,
  guardianEmail: string,
  locale: EmailLocale = 'en',
): Promise<CreateGuardianInviteResult> {
  const admin = getSupabaseAdmin();
  const email = guardianEmail.trim();

  // 1. Resolve the student + ensure a redemption code exists.
  const { data: student, error: studentErr } = await admin
    .from('students')
    .select('id, name, invite_code, is_active')
    .eq('id', studentId)
    .maybeSingle();

  if (studentErr) {
    logger.error('guardian_invite_student_lookup_failed', {
      error: new Error(studentErr.message),
      studentId,
    });
    return { ok: false, error: 'Student lookup failed', code: 'DB_ERROR' };
  }
  if (!student || !student.is_active) {
    return { ok: false, error: 'Student not found', code: 'STUDENT_NOT_FOUND' };
  }

  const linkCode = (student.invite_code as string | null)?.trim() || '';
  if (!linkCode) {
    // invite_code has a DB default, so this should be unreachable; guard anyway.
    return { ok: false, error: 'Student has no invite code', code: 'NO_INVITE_CODE' };
  }

  // 2. If the child is ALREADY linked to a guardian, do not create an invite.
  const { data: activeLink, error: activeErr } = await admin
    .from('guardian_student_links')
    .select('id')
    .eq('student_id', studentId)
    .not('guardian_id', 'is', null)
    .in('status', ['approved', 'active'])
    .limit(1)
    .maybeSingle();

  if (activeErr) {
    logger.error('guardian_invite_active_link_check_failed', {
      error: new Error(activeErr.message),
      studentId,
    });
    return { ok: false, error: 'Link check failed', code: 'DB_ERROR' };
  }
  if (activeLink) {
    return { ok: true, reused: true, linkCode, code: 'ALREADY_LINKED' };
  }

  // 3. Look for an existing PENDING invite (guardian_id IS NULL) — the partial
  //    unique index guarantees at most one. Reuse it; otherwise insert.
  const { data: existingPending, error: pendingErr } = await admin
    .from('guardian_student_links')
    .select('id')
    .eq('student_id', studentId)
    .is('guardian_id', null)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (pendingErr) {
    logger.error('guardian_invite_pending_lookup_failed', {
      error: new Error(pendingErr.message),
      studentId,
    });
    return { ok: false, error: 'Pending lookup failed', code: 'DB_ERROR' };
  }

  let linkId: string;
  let reused = false;

  if (existingPending) {
    linkId = existingPending.id as string;
    reused = true;
    // Refresh the row so the link_code stays in sync (idempotent touch).
    await admin
      .from('guardian_student_links')
      .update({ link_code: linkCode, updated_at: new Date().toISOString() })
      .eq('id', linkId);
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from('guardian_student_links')
      .insert({
        student_id: studentId,
        guardian_id: null,
        status: 'pending',
        permission_level: 'view',
        is_verified: false,
        link_code: linkCode,
        initiated_by: 'minor_consent_invite',
      })
      .select('id')
      .single();

    if (insertErr) {
      // Race: a concurrent invite won the partial unique index. Re-read it.
      const { data: raceRow } = await admin
        .from('guardian_student_links')
        .select('id')
        .eq('student_id', studentId)
        .is('guardian_id', null)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (raceRow) {
        linkId = raceRow.id as string;
        reused = true;
      } else {
        logger.error('guardian_invite_insert_failed', {
          error: new Error(insertErr.message),
          studentId,
        });
        return { ok: false, error: 'Failed to create invite', code: 'DB_ERROR' };
      }
    } else {
      linkId = inserted.id as string;
    }
  }

  // 4. Dispatch the bilingual parent-invite email — fire-and-forget, keyed on
  //    the pending-link row id so re-invites de-duplicate. P13: the parent
  //    email is the `to` field only, never logged in clear, never in params.
  const acceptUrl = `${baseAppUrl()}/parent?link_code=${encodeURIComponent(linkCode)}`;
  void deliverEmail({
    template: 'parent-guardian-invite',
    to: email,
    locale,
    params: {
      student_name: (student.name as string | null) ?? undefined,
      link_code: linkCode,
      accept_url: acceptUrl,
      idempotency_key: linkId,
    },
  }).catch(() => {
    /* deliverEmail never throws, but belt-and-suspenders for P15. */
  });

  logger.info('guardian_invite_created', {
    studentId,
    linkId,
    reused,
    guardianEmailRedacted: redactEmail(email),
  });

  return { ok: true, linkId, linkCode, reused };
}

/**
 * Fire-and-forget wrapper for the SIGNUP path (P15). NEVER throws, NEVER
 * blocks. Used by the bootstrap seam when a minor signs up with a
 * parent_consent_email. Any failure is swallowed (logged at warn) so profile
 * creation can never be impacted.
 */
export function enqueueGuardianInvite(
  studentId: string,
  guardianEmail: string,
  locale: EmailLocale = 'en',
): void {
  // Intentionally not awaited by callers. We still catch here so an unhandled
  // rejection can never surface in the signup request lifecycle.
  void createGuardianInvite(studentId, guardianEmail, locale).catch((e) => {
    logger.warn('guardian_invite_enqueue_failed', {
      studentId,
      reason: e instanceof Error ? e.message : String(e),
    });
  });
}
