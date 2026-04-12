import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

export const runtime = 'nodejs';

const MAX_BATCH = 500;

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { studentIds, title, body: notificationBody, type } = body;

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
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 },
      );
    }
    if (!notificationBody || typeof notificationBody !== 'string' || notificationBody.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'body is required' },
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

    // ── Build notification rows ──────────────────────────────────
    // notifications table schema: id, recipient_id, recipient_type, title, body,
    // icon, notification_type, read_at, created_at
    const notificationType = (typeof type === 'string' && type.trim()) ? type.trim() : 'announcement';
    const now = new Date().toISOString();

    const rows = studentIds.map((studentId: string) => ({
      recipient_id: studentId,
      recipient_type: 'student',
      title: title.trim(),
      body: notificationBody.trim(),
      icon: '📢',
      notification_type: notificationType,
      read_at: null,
      created_at: now,
    }));

    // ── Batch insert ─────────────────────────────────────────────
    const errors: string[] = [];
    let sent = 0;

    // Insert in chunks of 100 to avoid payload size issues
    const CHUNK_SIZE = 100;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .insert(chunk)
        .select('id');

      if (error) {
        errors.push(`chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`);
      } else {
        sent += data?.length ?? 0;
      }
    }

    // ── Log events ───────────────────────────────────────────────
    await logOpsEvent({
      category: 'admin',
      source: 'bulk-actions/notify',
      severity: 'info',
      message: `bulk notification: "${title}" to ${studentIds.length} students`,
      context: { notificationType, sent, failed: studentIds.length - sent, totalRequested: studentIds.length },
    });

    await logAdminAudit(
      auth,
      'bulk.notify',
      'notifications',
      `batch_${studentIds.length}`,
      { title, notificationType, sent, failed: studentIds.length - sent, errors },
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
