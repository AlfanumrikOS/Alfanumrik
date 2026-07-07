import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  isValidUUID,
  supabaseAdminHeaders,
  supabaseAdminUrl,
} from '@alfanumrik/lib/admin-auth';
import { logger } from '@alfanumrik/lib/logger';

/**
 * POST /api/super-admin/institutions/[id]/resume
 *
 * Resume a paused school: flip `schools.is_active = true` and clear the
 * pause audit fields (`paused_at`, `paused_by_super_admin_id`,
 * `pause_reason`).
 *
 * Body: { expectedSchoolName: string }
 *
 *   - `expectedSchoolName` MUST equal the school's current `name` exactly
 *     (same retype-name guardrail as `/pause`). Resuming the wrong school
 *     is just as dangerous as pausing the wrong one — both flip a
 *     tenant-wide access gate.
 *   - `reason` is intentionally NOT required here. The audit log captures
 *     who resumed and when; the *original* pause reason is what gets
 *     cleared from the row (and remains in the pause audit entry).
 *
 * Idempotency: resuming an already-active school still succeeds — it
 * leaves `is_active = true`, clears any stale paused_* fields if present,
 * and writes a `school.resumed` audit entry. The endpoint is safe to call
 * twice.
 *
 * Auth: authorizeAdmin (session + admin_users lookup). Super-admin only.
 */

interface ResumeBody {
  expectedSchoolName?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Resume is symmetric with pause — same tenant-wide access gate. Doc-comment
  // says super_admin only; make the gate match.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid school id.' }, { status: 400 });
  }

  let body: ResumeBody;
  try {
    body = (await request.json()) as ResumeBody;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const expectedSchoolName =
    typeof body.expectedSchoolName === 'string' ? body.expectedSchoolName.trim() : '';
  if (!expectedSchoolName) {
    return NextResponse.json(
      { error: 'expectedSchoolName is required — type the school name to confirm.' },
      { status: 400 },
    );
  }

  // Load the school. Same select shape as the pause route so that the two
  // endpoints share an identical mental model.
  let school: {
    id: string;
    name: string;
    is_active: boolean | null;
    paused_at: string | null;
    pause_reason: string | null;
  } | null = null;
  try {
    const res = await fetch(
      supabaseAdminUrl(
        'schools',
        `id=eq.${encodeURIComponent(id)}&select=id,name,is_active,paused_at,pause_reason&deleted_at=is.null&limit=1`,
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
    logger.error('school_resume_lookup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      schoolId: id,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'School lookup failed.' },
      { status: 500 },
    );
  }

  // Guardrail: retyped name MUST match. Verbatim compare, same rule as
  // /pause — see that route for the case-sensitivity rationale.
  if (school!.name !== expectedSchoolName) {
    return NextResponse.json(
      {
        error:
          'School name does not match. Type the school name exactly as shown to confirm.',
      },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  try {
    const res = await fetch(
      supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          is_active: true,
          paused_at: null,
          paused_by_super_admin_id: null,
          pause_reason: null,
          updated_at: nowIso,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      logger.error('school_resume_update_failed', {
        schoolId: id,
        status: res.status,
        body: text,
      });
      return NextResponse.json(
        { error: `Resume failed: ${text}` },
        { status: res.status },
      );
    }
  } catch (err) {
    logger.error('school_resume_update_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      schoolId: id,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Resume failed.' },
      { status: 500 },
    );
  }

  await logAdminAudit(auth, 'school.resumed', 'school', id, {
    school_name: school!.name,
    // Capture the prior pause context for the audit trail — once resumed
    // the row no longer carries this. NULL/undefined when the school was
    // already active (idempotent resume).
    previous_paused_at: school!.paused_at,
    previous_pause_reason: school!.pause_reason,
    was_paused: school!.is_active === false,
  });

  return NextResponse.json({
    success: true,
    schoolId: id,
    name: school!.name,
  });
}
