import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

export const runtime = 'nodejs';

const MAX_BATCH = 500;
const SEND_BATCH_SIZE = 10;

/** Delay helper for rate-limiting email sends */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { studentIds } = body;

    // ── Validate inputs ──────────────────────────────────────────
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'studentIds must be a non-empty array' },
        { status: 400 },
      );
    }
    if (studentIds.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Max ${MAX_BATCH} students per request` },
        { status: 400 },
      );
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = studentIds.filter((id: unknown) => typeof id !== 'string' || !uuidRegex.test(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid UUIDs: ${invalidIds.slice(0, 5).join(', ')}${invalidIds.length > 5 ? '...' : ''}` },
        { status: 400 },
      );
    }

    // ── Look up emails for all students ──────────────────────────
    const { data: students, error: lookupError } = await supabaseAdmin
      .from('students')
      .select('id, email, auth_user_id')
      .in('id', studentIds);

    if (lookupError) {
      return NextResponse.json(
        { success: false, error: `Failed to look up students: ${lookupError.message}` },
        { status: 500 },
      );
    }

    if (!students || students.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No students found for the provided IDs' },
        { status: 404 },
      );
    }

    // ── Process in batches of SEND_BATCH_SIZE ────────────────────
    const errors: string[] = [];
    let sent = 0;

    for (let i = 0; i < students.length; i += SEND_BATCH_SIZE) {
      const batch = students.slice(i, i + SEND_BATCH_SIZE);

      // Process each student in the batch concurrently
      const results = await Promise.allSettled(
        batch.map(async (student) => {
          if (!student.email) {
            throw new Error(`Student ${student.id}: no email on file`);
          }

          // Use Supabase Auth admin API to generate a signup confirmation link.
          // This triggers the auth email hook (send-auth-email), which sends the
          // branded verification email via Mailgun.
          const { error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: student.email,
          });

          if (linkError) {
            throw new Error(`Student ${student.id}: ${linkError.message}`);
          }
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          sent++;
        } else {
          errors.push(result.reason?.message || 'Unknown error');
        }
      }

      // Rate limit: wait between batches (skip after last batch)
      if (i + SEND_BATCH_SIZE < students.length) {
        await delay(1000);
      }
    }

    const notFound = studentIds.length - students.length;
    if (notFound > 0) {
      errors.push(`${notFound} student ID(s) not found in database`);
    }

    // ── Log events ───────────────────────────────────────────────
    await logOpsEvent({
      category: 'admin',
      source: 'bulk-actions/resend-invites',
      severity: 'info',
      message: `bulk invite resend: ${sent}/${studentIds.length} sent`,
      context: { requested: studentIds.length, found: students.length, sent, failed: students.length - sent },
    });

    await logAdminAudit(
      auth,
      'bulk.resend_invites',
      'students',
      `batch_${studentIds.length}`,
      { requested: studentIds.length, sent, failed: students.length - sent + notFound, errors: errors.slice(0, 20) },
    );

    return NextResponse.json({
      success: true,
      data: {
        sent,
        failed: studentIds.length - sent,
        errors,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
