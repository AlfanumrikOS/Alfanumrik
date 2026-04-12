import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['suspend', 'restore'] as const;
type SuspendAction = (typeof VALID_ACTIONS)[number];

const MAX_BATCH = 500;

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { studentIds, action } = body;

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
    if (!action || !VALID_ACTIONS.includes(action as SuspendAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
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

    // ── Execute bulk update ──────────────────────────────────────
    const errors: string[] = [];
    let succeeded = 0;

    const updatePayload = action === 'suspend'
      ? { is_active: false, account_status: 'suspended' }
      : { is_active: true, account_status: 'active' };

    const { data, error } = await supabaseAdmin
      .from('students')
      .update(updatePayload)
      .in('id', studentIds)
      .select('id');

    if (error) {
      errors.push(error.message);
    } else {
      succeeded = data?.length ?? 0;
      if (succeeded < studentIds.length) {
        errors.push(`${studentIds.length - succeeded} student(s) not found or unchanged`);
      }
    }

    // ── Log events ───────────────────────────────────────────────
    await logOpsEvent({
      category: 'admin',
      source: 'bulk-actions/suspend-restore',
      severity: 'info',
      message: `bulk ${action}: ${studentIds.length} students`,
      context: { action, requested: studentIds.length, succeeded, failed: studentIds.length - succeeded },
    });

    await logAdminAudit(
      auth,
      `bulk.${action}`,
      'students',
      `batch_${studentIds.length}`,
      { action, requested: studentIds.length, succeeded, errors },
    );

    return NextResponse.json({
      success: true,
      data: {
        processed: studentIds.length,
        succeeded,
        failed: studentIds.length - succeeded,
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
