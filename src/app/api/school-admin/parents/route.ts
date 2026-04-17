import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── GET — List parent-student links for this school ─────────────────────────
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(100, parseInt(params.get('limit') || '25'));
  const offset = (page - 1) * limit;
  const search = params.get('search')?.trim();
  const status = params.get('status'); // 'approved', 'pending', 'rejected'

  // Step 1: Get all student IDs for this school
  let studentsQuery = supabase
    .from('students')
    .select('id, name, grade')
    .eq('school_id', auth.schoolId)
    .eq('is_active', true);

  // Apply search filter on student name if provided
  if (search) {
    studentsQuery = studentsQuery.ilike('name', `%${search}%`);
  }

  const { data: schoolStudents, error: studentsError } = await studentsQuery;

  if (studentsError) {
    logger.error('parents_list_students_failed', {
      error: new Error(studentsError.message),
      route: 'school-admin/parents',
    });
    return NextResponse.json(
      { success: false, error: studentsError.message },
      { status: 500 }
    );
  }

  if (!schoolStudents || schoolStudents.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      total: 0,
      page,
      limit,
    });
  }

  const studentIds = schoolStudents.map((s) => s.id);
  const studentMap = new Map(schoolStudents.map((s) => [s.id, { name: s.name, grade: s.grade }]));

  // Step 2: Get guardian-student links for these students
  let linksQuery = supabase
    .from('guardian_student_links')
    .select('guardian_id, student_id, status', { count: 'exact' })
    .in('student_id', studentIds);

  if (status && ['approved', 'pending', 'rejected'].includes(status)) {
    linksQuery = linksQuery.eq('status', status);
  }

  // Apply pagination
  linksQuery = linksQuery.range(offset, offset + limit - 1);

  const { data: links, count: totalLinks, error: linksError } = await linksQuery;

  if (linksError) {
    logger.error('parents_list_links_failed', {
      error: new Error(linksError.message),
      route: 'school-admin/parents',
    });
    return NextResponse.json(
      { success: false, error: linksError.message },
      { status: 500 }
    );
  }

  if (!links || links.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      total: totalLinks || 0,
      page,
      limit,
    });
  }

  // Step 3: Get guardian details
  const guardianIds = [...new Set(links.map((l) => l.guardian_id))];
  const { data: guardians, error: guardiansError } = await supabase
    .from('guardians')
    .select('id, auth_user_id, name, email, phone, preferred_language')
    .in('id', guardianIds);

  if (guardiansError) {
    logger.error('parents_list_guardians_failed', {
      error: new Error(guardiansError.message),
      route: 'school-admin/parents',
    });
    return NextResponse.json(
      { success: false, error: guardiansError.message },
      { status: 500 }
    );
  }

  const guardianMap = new Map(
    (guardians || []).map((g) => [
      g.id,
      {
        name: g.name,
        email: g.email,
        phone: g.phone,
        auth_user_id: g.auth_user_id,
        preferred_language: g.preferred_language,
      },
    ])
  );

  // Also search by guardian name if provided
  let filteredLinks = links;
  if (search) {
    filteredLinks = links.filter((l) => {
      const guardian = guardianMap.get(l.guardian_id);
      const student = studentMap.get(l.student_id);
      return (
        (guardian?.name && guardian.name.toLowerCase().includes(search.toLowerCase())) ||
        (student?.name && student.name.toLowerCase().includes(search.toLowerCase()))
      );
    });
  }

  // Build response
  const result = filteredLinks.map((l) => {
    const guardian = guardianMap.get(l.guardian_id);
    const student = studentMap.get(l.student_id);
    return {
      guardian_id: l.guardian_id,
      student_id: l.student_id,
      link_status: l.status,
      parent_name: guardian?.name || 'Unknown',
      parent_email: guardian?.email || null,
      parent_phone: guardian?.phone || null,
      student_name: student?.name || 'Unknown',
      student_grade: student?.grade || null, // P5: string
    };
  });

  return NextResponse.json({
    success: true,
    data: result,
    total: totalLinks || 0,
    page,
    limit,
  });
}

// ─── POST — Send bulk message to parents ─────────────────────────────────────
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

  const {
    message,
    message_hi,
    target,
    target_value,
    channel,
  } = body as {
    message?: string;
    message_hi?: string;
    target?: 'all' | 'grade' | 'class';
    target_value?: string;
    channel?: 'notification' | 'whatsapp' | 'email';
  };

  if (!message) {
    return NextResponse.json(
      { success: false, error: 'Message is required' },
      { status: 400 }
    );
  }

  if (!target || !['all', 'grade', 'class'].includes(target)) {
    return NextResponse.json(
      { success: false, error: 'Target must be "all", "grade", or "class"' },
      { status: 400 }
    );
  }

  if (!channel || !['notification', 'whatsapp', 'email'].includes(channel)) {
    return NextResponse.json(
      { success: false, error: 'Channel must be "notification", "whatsapp", or "email"' },
      { status: 400 }
    );
  }

  // P5: Validate grade target value
  if (target === 'grade') {
    if (!target_value) {
      return NextResponse.json(
        { success: false, error: 'target_value (grade) is required when target is "grade"' },
        { status: 400 }
      );
    }
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    if (!validGrades.includes(String(target_value))) {
      return NextResponse.json(
        { success: false, error: 'target_value must be a valid grade "6" through "12"' },
        { status: 400 }
      );
    }
  }

  if (target === 'class' && !target_value) {
    return NextResponse.json(
      { success: false, error: 'target_value (class_id) is required when target is "class"' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Step 1: Find target students in this school
  let studentIds: string[] = [];

  if (target === 'class' && target_value) {
    // Verify class belongs to this school
    const { data: cls } = await supabase
      .from('classes')
      .select('id')
      .eq('id', target_value)
      .eq('school_id', auth.schoolId)
      .maybeSingle();

    if (!cls) {
      return NextResponse.json(
        { success: false, error: 'Class not found in your school' },
        { status: 404 }
      );
    }

    const { data: enrollments } = await supabase
      .from('class_enrollments')
      .select('student_id')
      .eq('class_id', target_value)
      .eq('is_active', true);

    studentIds = (enrollments || []).map((e) => e.student_id);
  } else if (target === 'grade' && target_value) {
    const { data: students } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', auth.schoolId)
      .eq('grade', String(target_value)) // P5: string grade
      .eq('is_active', true);

    studentIds = (students || []).map((s) => s.id);
  } else {
    // target === 'all'
    const { data: students } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', auth.schoolId)
      .eq('is_active', true);

    studentIds = (students || []).map((s) => s.id);
  }

  if (studentIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: { sent_count: 0, failed_count: 0, channel },
    });
  }

  // Step 2: Find approved guardian links for these students
  const { data: links } = await supabase
    .from('guardian_student_links')
    .select('guardian_id')
    .in('student_id', studentIds)
    .eq('status', 'approved'); // Only send to approved parent-student links

  if (!links || links.length === 0) {
    return NextResponse.json({
      success: true,
      data: { sent_count: 0, failed_count: 0, channel, note: 'No approved parent links found' },
    });
  }

  const uniqueGuardianIds = [...new Set(links.map((l) => l.guardian_id))];

  // Step 3: Get guardian details
  const { data: guardians } = await supabase
    .from('guardians')
    .select('id, auth_user_id, phone, preferred_language')
    .in('id', uniqueGuardianIds);

  if (!guardians || guardians.length === 0) {
    return NextResponse.json({
      success: true,
      data: { sent_count: 0, failed_count: 0, channel, note: 'No guardian records found' },
    });
  }

  // Step 4: Dispatch via chosen channel
  let sentCount = 0;
  let failedCount = 0;

  if (channel === 'notification') {
    // Insert into notifications table for each guardian
    const BATCH_SIZE = 500;
    const notifications = guardians
      .filter((g) => g.auth_user_id)
      .map((g) => ({
        recipient_id: g.auth_user_id,
        recipient_type: 'guardian',
        notification_type: 'school_message',
        title: 'School Message',
        body: message,
        icon: '🏫',
      }));

    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const batch = notifications.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('notifications')
        .insert(batch);

      if (insertError) {
        failedCount += batch.length;
        logger.warn('parent_notification_batch_failed', {
          batchIndex: Math.floor(i / BATCH_SIZE),
          error: new Error(insertError.message),
          route: 'school-admin/parents',
        });
      } else {
        sentCount += batch.length;
      }
    }
  } else if (channel === 'whatsapp') {
    // Call whatsapp-notify Edge Function for each guardian with a phone number
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      logger.error('whatsapp_missing_env', {
        route: 'school-admin/parents',
      });
      return NextResponse.json(
        { success: false, error: 'WhatsApp service not configured' },
        { status: 503 }
      );
    }

    const guardiansWithPhone = guardians.filter((g) => g.phone);

    // Process in parallel with concurrency limit to avoid overwhelming the Edge Function
    const CONCURRENCY = 10;
    for (let i = 0; i < guardiansWithPhone.length; i += CONCURRENCY) {
      const batch = guardiansWithPhone.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (guardian) => {
          const lang = guardian.preferred_language === 'hi' ? 'hi' : 'en';
          const msgContent = lang === 'hi' && message_hi ? message_hi : message;

          const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-notify`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'score_notification',
              recipient_phone: guardian.phone,
              language: lang,
              data: { message: msgContent },
            }),
          });

          return res.ok;
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          sentCount++;
        } else {
          failedCount++;
        }
      }
    }

    // P13: Do not log individual phone numbers
    logger.info('parent_whatsapp_bulk_sent', {
      totalTargeted: guardiansWithPhone.length,
      sentCount,
      failedCount,
      route: 'school-admin/parents',
    });
  } else if (channel === 'email') {
    // Email channel: log as TODO — bulk email needs separate implementation
    // send-auth-email is for auth flows only
    logger.info('parent_email_bulk_requested', {
      guardianCount: guardians.length,
      note: 'Bulk email not yet implemented — queued for future delivery',
      route: 'school-admin/parents',
    });

    return NextResponse.json({
      success: true,
      data: {
        sent_count: 0,
        failed_count: 0,
        channel,
        note: 'Email channel is not yet available. Please use notification or whatsapp channel.',
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: { sent_count: sentCount, failed_count: failedCount, channel },
  });
}
