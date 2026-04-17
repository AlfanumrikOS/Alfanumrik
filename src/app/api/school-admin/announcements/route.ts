import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── GET — List announcements for this school ────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(100, parseInt(params.get('limit') || '25'));
  const offset = (page - 1) * limit;

  const { data, count, error } = await supabase
    .from('school_announcements')
    .select(
      'id, title, title_hi, body, body_hi, target_grades, target_classes, created_by, published_at, is_active, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('school_id', auth.schoolId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('announcements_list_failed', {
      error: new Error(error.message),
      route: 'school-admin/announcements',
    });
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  // Derive status from published_at
  const enriched = (data || []).map((a) => ({
    ...a,
    status: a.published_at ? 'published' : 'draft',
  }));

  return NextResponse.json({
    success: true,
    data: enriched,
    total: count || 0,
    page,
    limit,
  });
}

// ─── POST — Create announcement (draft or publish immediately) ───────────────
export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { title, title_hi, body: announcementBody, body_hi, target_grades, target_classes, publish_now } = body as {
    title?: string;
    title_hi?: string;
    body?: string;
    body_hi?: string;
    target_grades?: string[];
    target_classes?: string[];
    publish_now?: boolean;
  };

  if (!title || !announcementBody) {
    return NextResponse.json(
      { success: false, error: 'Title and body are required' },
      { status: 400 }
    );
  }

  // P5: Validate target_grades if provided — must be strings "6"-"12"
  const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
  if (target_grades && target_grades.length > 0) {
    const invalidGrades = target_grades.filter((g) => !validGrades.includes(String(g)));
    if (invalidGrades.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid grades: ${invalidGrades.join(', ')}. Must be "6" through "12"` },
        { status: 400 }
      );
    }
  }

  const supabase = getSupabaseAdmin();

  const insertData: Record<string, unknown> = {
    school_id: auth.schoolId,
    title,
    body: announcementBody,
    created_by: auth.userId,
    is_active: true,
  };

  // P7: optional Hindi translations
  if (title_hi) insertData.title_hi = title_hi;
  if (body_hi) insertData.body_hi = body_hi;
  if (target_grades && target_grades.length > 0) insertData.target_grades = target_grades.map(String);
  if (target_classes && target_classes.length > 0) insertData.target_classes = target_classes;
  if (publish_now) insertData.published_at = new Date().toISOString();

  const { data: announcement, error } = await supabase
    .from('school_announcements')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    logger.error('announcement_create_failed', {
      error: new Error(error.message),
      route: 'school-admin/announcements',
    });
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  // If published immediately, deliver notifications to targeted students
  if (publish_now && announcement) {
    await deliverAnnouncementNotifications(
      supabase,
      auth.schoolId!,
      auth.userId!,
      announcement.id,
      title,
      announcementBody,
      target_grades?.map(String),
      target_classes
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        ...announcement,
        status: announcement.published_at ? 'published' : 'draft',
      },
    },
    { status: 201 }
  );
}

// ─── PATCH — Update or publish/unpublish ─────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { id, updates } = body as {
    id?: string;
    updates?: Record<string, unknown>;
  };

  if (!id || !updates) {
    return NextResponse.json(
      { success: false, error: 'Announcement id and updates are required' },
      { status: 400 }
    );
  }

  // Build safe update object — only allow known fields
  const ALLOWED_FIELDS = ['title', 'title_hi', 'body', 'body_hi', 'target_grades', 'target_classes', 'is_active'];
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_FIELDS.includes(k)) safe[k] = v;
  }

  // P5: Validate target_grades if being updated
  if (safe.target_grades && Array.isArray(safe.target_grades)) {
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    const grades = safe.target_grades as string[];
    const invalidGrades = grades.filter((g) => !validGrades.includes(String(g)));
    if (invalidGrades.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid grades: ${invalidGrades.join(', ')}. Must be "6" through "12"` },
        { status: 400 }
      );
    }
    safe.target_grades = grades.map(String);
  }

  // Handle publish/unpublish special action
  const shouldPublish = updates.publish === true;
  const shouldUnpublish = updates.publish === false;

  if (shouldPublish) {
    safe.published_at = new Date().toISOString();
  } else if (shouldUnpublish) {
    safe.published_at = null;
  }

  if (Object.keys(safe).length === 0) {
    return NextResponse.json(
      { success: false, error: 'No valid fields to update' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Fetch the announcement first to verify it belongs to this school
  const { data: existing, error: fetchError } = await supabase
    .from('school_announcements')
    .select('id, school_id, title, body, target_grades, target_classes')
    .eq('id', id)
    .eq('school_id', auth.schoolId)
    .maybeSingle();

  if (fetchError) {
    logger.error('announcement_fetch_failed', {
      error: new Error(fetchError.message),
      route: 'school-admin/announcements',
    });
    return NextResponse.json(
      { success: false, error: fetchError.message },
      { status: 500 }
    );
  }

  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'Announcement not found in your school' },
      { status: 404 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('school_announcements')
    .update(safe)
    .eq('id', id)
    .eq('school_id', auth.schoolId)
    .select()
    .single();

  if (updateError) {
    logger.error('announcement_update_failed', {
      error: new Error(updateError.message),
      route: 'school-admin/announcements',
    });
    return NextResponse.json(
      { success: false, error: updateError.message },
      { status: 500 }
    );
  }

  // If just published, deliver notifications
  if (shouldPublish && updated) {
    const announcementTitle = (safe.title as string) || existing.title;
    const announcementBody = (safe.body as string) || existing.body;
    const grades = (safe.target_grades as string[]) || existing.target_grades;
    const classes = (safe.target_classes as string[]) || existing.target_classes;

    await deliverAnnouncementNotifications(
      supabase,
      auth.schoolId!,
      auth.userId!,
      id,
      announcementTitle,
      announcementBody,
      grades,
      classes
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      ...updated,
      status: updated.published_at ? 'published' : 'draft',
    },
  });
}

// ─── DELETE — Soft delete (set is_active = false) ────────────────────────────
export async function DELETE(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { id } = body as { id?: string };
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'Announcement id is required' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('school_announcements')
    .update({ is_active: false })
    .eq('id', id)
    .eq('school_id', auth.schoolId);

  if (error) {
    logger.error('announcement_delete_failed', {
      error: new Error(error.message),
      route: 'school-admin/announcements',
    });
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

// ─── Helper: Deliver announcement notifications to students ──────────────────
async function deliverAnnouncementNotifications(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  senderId: string,
  announcementId: string,
  title: string,
  body: string,
  targetGrades?: string[],
  targetClasses?: string[]
): Promise<void> {
  try {
    let studentIds: string[] = [];

    if (targetClasses && targetClasses.length > 0) {
      // Get students enrolled in target classes
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('student_id')
        .in('class_id', targetClasses)
        .eq('is_active', true);

      if (enrollments) {
        studentIds = enrollments.map((e) => e.student_id);
      }
    } else if (targetGrades && targetGrades.length > 0) {
      // Get students in target grades at this school
      const { data: students } = await supabase
        .from('students')
        .select('id')
        .eq('school_id', schoolId)
        .in('grade', targetGrades.map(String)) // P5: string grades
        .eq('is_active', true);

      if (students) {
        studentIds = students.map((s) => s.id);
      }
    } else {
      // All students in this school
      const { data: students } = await supabase
        .from('students')
        .select('id')
        .eq('school_id', schoolId)
        .eq('is_active', true);

      if (students) {
        studentIds = students.map((s) => s.id);
      }
    }

    // Deduplicate
    const uniqueIds = [...new Set(studentIds)];
    if (uniqueIds.length === 0) return;

    // Get auth_user_ids for notification recipient_id
    const { data: studentRecords } = await supabase
      .from('students')
      .select('auth_user_id')
      .in('id', uniqueIds)
      .not('auth_user_id', 'is', null);

    if (!studentRecords || studentRecords.length === 0) return;

    // Batch insert notifications (limit to 500 per batch to avoid payload size issues)
    const BATCH_SIZE = 500;
    const notifications = studentRecords.map((s) => ({
      recipient_id: s.auth_user_id,
      recipient_type: 'student',
      notification_type: 'announcement',
      title,
      body,
      icon: '📢',
    }));

    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const batch = notifications.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('notifications')
        .insert(batch);

      if (insertError) {
        logger.warn('announcement_notification_batch_failed', {
          announcementId,
          batchIndex: Math.floor(i / BATCH_SIZE),
          error: new Error(insertError.message),
          route: 'school-admin/announcements',
        });
      }
    }

    logger.info('announcement_notifications_delivered', {
      announcementId,
      recipientCount: notifications.length,
      route: 'school-admin/announcements',
    });
  } catch (err) {
    // Non-blocking: notification delivery failure should not fail the API response
    logger.error('announcement_notification_delivery_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      announcementId,
      route: 'school-admin/announcements',
    });
  }
}
