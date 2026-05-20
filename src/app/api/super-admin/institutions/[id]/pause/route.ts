import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  isValidUUID,
  supabaseAdminHeaders,
  supabaseAdminUrl,
} from '@/lib/admin-auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/super-admin/institutions/[id]/pause
 *
 * Pause a school: gate authentication / API access by flipping
 * `schools.is_active = false`, and record the audit fields
 * (`paused_at`, `paused_by_super_admin_id`, `pause_reason`) added by
 * migration 20260527000011_school_pause_audit.sql.
 *
 * Body: { reason: string, expectedSchoolName: string }
 *
 *   - `expectedSchoolName` MUST equal the school's current `name` exactly.
 *     This is the PostHog-style guardrail: the operator types the school
 *     name back to confirm they meant *this* school. The server enforces
 *     it — clients can't bypass by skipping the modal.
 *   - `reason` is required (>= 10 chars). Forces the operator to write
 *     down *why* — the field is surfaced in the operator dashboard's
 *     "currently paused" list and the audit log so on-call has context.
 *
 * Idempotency: re-pausing an already-paused school is allowed — it
 * refreshes `paused_at`, `paused_by_super_admin_id`, `pause_reason` and
 * writes a new audit entry. This matches the spec ("200 idempotent on
 * re-pause") and is intentional: if ops re-pauses, they have a new reason
 * worth recording.
 *
 * Spine compliance: this is a legitimate top-level write to
 * `schools.is_active` (tenant lifecycle, NOT learner state). No
 * state_event emit. If a `tenant.paused` event is added to the registry
 * later, follow up with a projector — out of scope here.
 *
 * Auth: authorizeAdmin (session + admin_users lookup). Super-admin only.
 */

interface PauseBody {
  reason?: string;
  expectedSchoolName?: string;
}

const REASON_MIN_LENGTH = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Pause is a tenant-wide access gate. Doc-comment above says super_admin
  // only — make the gate match the doc explicitly.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid school id.' }, { status: 400 });
  }

  let body: PauseBody;
  try {
    body = (await request.json()) as PauseBody;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const expectedSchoolName =
    typeof body.expectedSchoolName === 'string' ? body.expectedSchoolName.trim() : '';

  if (!expectedSchoolName) {
    return NextResponse.json(
      { error: 'expectedSchoolName is required — type the school name to confirm.' },
      { status: 400 },
    );
  }
  if (reason.length < REASON_MIN_LENGTH) {
    return NextResponse.json(
      { error: `reason must be at least ${REASON_MIN_LENGTH} characters.` },
      { status: 400 },
    );
  }

  // Load the school's current name so we can verify the operator's
  // retyped value before mutating. Soft-deleted schools are not pausable
  // (they're already excluded from operator queries).
  let school: { id: string; name: string; is_active: boolean | null } | null = null;
  try {
    const res = await fetch(
      supabaseAdminUrl(
        'schools',
        `id=eq.${encodeURIComponent(id)}&select=id,name,is_active&deleted_at=is.null&limit=1`,
      ),
      { headers: supabaseAdminHeaders() },
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'School lookup failed.' }, { status: 502 });
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'School not found.' }, { status: 404 });
    }
    school = rows[0];
  } catch (err) {
    logger.error('school_pause_lookup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      schoolId: id,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'School lookup failed.' },
      { status: 500 },
    );
  }

  // Guardrail: the retyped name MUST match. Compare against the stored
  // name verbatim — we trim the input above but don't normalize case
  // because school names can legitimately differ in case (e.g.
  // "delhi public school" vs "Delhi Public School").
  if (school!.name !== expectedSchoolName) {
    return NextResponse.json(
      {
        error:
          'School name does not match. Type the school name exactly as shown to confirm.',
      },
      { status: 400 },
    );
  }

  // Persist the pause + audit columns in one PATCH.
  const nowIso = new Date().toISOString();
  try {
    const res = await fetch(
      supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          is_active: false,
          paused_at: nowIso,
          paused_by_super_admin_id: auth.adminId,
          pause_reason: reason,
          updated_at: nowIso,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      logger.error('school_pause_update_failed', {
        schoolId: id,
        status: res.status,
        body: text,
      });
      return NextResponse.json(
        { error: `Pause failed: ${text}` },
        { status: res.status },
      );
    }
  } catch (err) {
    logger.error('school_pause_update_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      schoolId: id,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pause failed.' },
      { status: 500 },
    );
  }

  await logAdminAudit(auth, 'school.paused', 'school', id, {
    school_name: school!.name,
    reason,
    previously_active: school!.is_active !== false,
  });

  return NextResponse.json({
    success: true,
    schoolId: id,
    name: school!.name,
  });
}
