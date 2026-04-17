import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ── Constants ────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_STATUSES = ['draft', 'scheduled', 'active', 'completed', 'cancelled'] as const;
type ExamStatus = typeof VALID_STATUSES[number];

/**
 * Allowed status transitions.
 * Key = current status, value = set of statuses it can transition to.
 */
const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['scheduled']),
  scheduled: new Set(['active', 'cancelled']),
  active: new Set(['completed', 'cancelled']),
  // completed and cancelled are terminal — no transitions allowed
};

// ── GET — List exams ─────────────────────────────────────────

/**
 * GET /api/school-admin/exams — List exams for this school
 * Permission: school.manage_exams
 *
 * Query params:
 *   ?page=      — page number (default 1)
 *   ?limit=     — items per page (default 20, max 100)
 *   ?status=    — filter by status
 *   ?grade=     — filter by grade (string "6"-"12")
 *   ?upcoming=  — if "true", filter start_time > now() AND status IN (scheduled, active)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_exams');
    if (!auth.authorized) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const status = searchParams.get('status');
    const grade = searchParams.get('grade');
    const upcoming = searchParams.get('upcoming');

    // Validate grade if provided (P5)
    if (grade && !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: 'Invalid grade. Must be "6" through "12".' },
        { status: 400 }
      );
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.includes(status as ExamStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('school_exams')
      .select(
        'id, title, subject, grade, target_classes, question_count, duration_minutes, start_time, end_time, status, created_by, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('school_id', auth.schoolId)
      .range(offset, offset + limit - 1);

    if (upcoming === 'true') {
      // Upcoming: start_time > now() AND status in (scheduled, active)
      query = query
        .gt('start_time', new Date().toISOString())
        .in('status', ['scheduled', 'active'])
        .order('start_time', { ascending: true });
    } else {
      // Default ordering: created_at DESC
      if (status) {
        query = query.eq('status', status);
      }
      query = query.order('created_at', { ascending: false });
    }

    if (grade) {
      query = query.eq('grade', grade);
    }

    const { data: exams, error, count } = await query;

    if (error) {
      logger.error('school_admin_exams_list_error', {
        error: new Error(error.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch exams' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        exams: exams || [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: count ? Math.ceil(count / limit) : 0,
        },
      },
    });
  } catch (err) {
    logger.error('school_admin_exams_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/exams',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── POST — Create an exam ────────────────────────────────────

/**
 * POST /api/school-admin/exams — Create an exam
 * Permission: school.manage_exams
 *
 * Body: {
 *   title: string (required),
 *   subject: string (required),
 *   grade: string "6"-"12" (required),
 *   target_classes?: string[] (UUIDs),
 *   question_count?: number (default 20),
 *   duration_minutes?: number (default 30),
 *   start_time: string ISO 8601 (required),
 *   end_time: string ISO 8601 (required),
 *   status?: 'draft' (default)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_exams');
    if (!auth.authorized) return auth.errorResponse;

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
      title,
      subject,
      grade,
      target_classes,
      question_count,
      duration_minutes,
      start_time,
      end_time,
      status,
    } = body as {
      title?: string;
      subject?: string;
      grade?: string;
      target_classes?: string[];
      question_count?: number;
      duration_minutes?: number;
      start_time?: string;
      end_time?: string;
      status?: string;
    };

    // Validate required fields
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json(
        { success: false, error: 'Title is required' },
        { status: 400 }
      );
    }

    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return NextResponse.json(
        { success: false, error: 'Subject is required' },
        { status: 400 }
      );
    }

    // P5: Grade must be a string "6"-"12"
    if (!grade || typeof grade !== 'string' || !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: 'Grade must be a string "6" through "12"' },
        { status: 400 }
      );
    }

    // Validate start_time and end_time
    if (!start_time || typeof start_time !== 'string') {
      return NextResponse.json(
        { success: false, error: 'start_time is required (ISO 8601 format)' },
        { status: 400 }
      );
    }
    if (!end_time || typeof end_time !== 'string') {
      return NextResponse.json(
        { success: false, error: 'end_time is required (ISO 8601 format)' },
        { status: 400 }
      );
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (isNaN(startDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'start_time is not a valid date' },
        { status: 400 }
      );
    }
    if (isNaN(endDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'end_time is not a valid date' },
        { status: 400 }
      );
    }
    if (endDate <= startDate) {
      return NextResponse.json(
        { success: false, error: 'end_time must be after start_time' },
        { status: 400 }
      );
    }

    // Validate question_count if provided
    const effectiveQuestionCount = question_count !== undefined ? Number(question_count) : 20;
    if (!Number.isInteger(effectiveQuestionCount) || effectiveQuestionCount <= 0) {
      return NextResponse.json(
        { success: false, error: 'question_count must be a positive integer' },
        { status: 400 }
      );
    }

    // Validate duration_minutes if provided
    const effectiveDuration = duration_minutes !== undefined ? Number(duration_minutes) : 30;
    if (!Number.isInteger(effectiveDuration) || effectiveDuration <= 0) {
      return NextResponse.json(
        { success: false, error: 'duration_minutes must be a positive integer' },
        { status: 400 }
      );
    }

    // Validate target_classes if provided
    if (target_classes !== undefined && target_classes !== null) {
      if (!Array.isArray(target_classes)) {
        return NextResponse.json(
          { success: false, error: 'target_classes must be an array of UUIDs' },
          { status: 400 }
        );
      }
    }

    // Status defaults to 'draft'
    const effectiveStatus = status || 'draft';
    if (effectiveStatus !== 'draft') {
      return NextResponse.json(
        { success: false, error: 'New exams must be created with status "draft"' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: newExam, error } = await supabase
      .from('school_exams')
      .insert({
        school_id: auth.schoolId,
        title: title.trim(),
        subject: subject.trim(),
        grade, // string per P5
        target_classes: target_classes || null,
        question_count: effectiveQuestionCount,
        duration_minutes: effectiveDuration,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        status: 'draft',
        created_by: auth.userId,
      })
      .select('id, title, subject, grade, target_classes, question_count, duration_minutes, start_time, end_time, status, created_at')
      .single();

    if (error) {
      logger.error('school_admin_exam_create_error', {
        error: new Error(error.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create exam' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, data: newExam },
      { status: 201 }
    );
  } catch (err) {
    logger.error('school_admin_exams_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/exams',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── PATCH — Update exam or change status ─────────────────────

/**
 * PATCH /api/school-admin/exams — Update an exam
 * Permission: school.manage_exams
 *
 * Body: {
 *   id: string (exam UUID),
 *   updates: {
 *     title?, subject?, grade?, target_classes?, question_count?,
 *     duration_minutes?, start_time?, end_time?, status?
 *   }
 * }
 *
 * Status transition rules enforced.
 * Cannot edit completed or cancelled exams.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_exams');
    if (!auth.authorized) return auth.errorResponse;

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

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Exam ID is required' },
        { status: 400 }
      );
    }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one field to update is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Fetch current exam to check status and validate transitions
    const { data: currentExam, error: fetchError } = await supabase
      .from('school_exams')
      .select('id, status, start_time, end_time')
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Exam not found' },
          { status: 404 }
        );
      }
      logger.error('school_admin_exam_fetch_error', {
        error: new Error(fetchError.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch exam' },
        { status: 500 }
      );
    }

    if (!currentExam) {
      return NextResponse.json(
        { success: false, error: 'Exam not found' },
        { status: 404 }
      );
    }

    // Cannot edit completed or cancelled exams
    if (currentExam.status === 'completed' || currentExam.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: `Cannot edit an exam with status "${currentExam.status}"` },
        { status: 409 }
      );
    }

    // Whitelist allowed update fields
    const ALLOWED_FIELDS = [
      'title', 'subject', 'grade', 'target_classes', 'question_count',
      'duration_minutes', 'start_time', 'end_time', 'status',
    ];
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json(
        { success: false, error: `Allowed fields: ${ALLOWED_FIELDS.join(', ')}` },
        { status: 400 }
      );
    }

    // ── Validate status transition ──
    if ('status' in sanitizedUpdates) {
      const newStatus = sanitizedUpdates.status as string;
      if (!VALID_STATUSES.includes(newStatus as ExamStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 }
        );
      }

      const allowed = STATUS_TRANSITIONS[currentExam.status];
      if (!allowed || !allowed.has(newStatus)) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot transition from "${currentExam.status}" to "${newStatus}". Allowed: ${
              allowed ? Array.from(allowed).join(', ') : 'none'
            }`,
          },
          { status: 409 }
        );
      }

      // draft -> scheduled requires start_time and end_time to be set
      if (currentExam.status === 'draft' && newStatus === 'scheduled') {
        const effectiveStartTime = sanitizedUpdates.start_time || currentExam.start_time;
        const effectiveEndTime = sanitizedUpdates.end_time || currentExam.end_time;
        if (!effectiveStartTime || !effectiveEndTime) {
          return NextResponse.json(
            { success: false, error: 'start_time and end_time are required to schedule an exam' },
            { status: 400 }
          );
        }
      }
    }

    // ── Validate grade (P5) ──
    if ('grade' in sanitizedUpdates) {
      const gradeVal = sanitizedUpdates.grade;
      if (typeof gradeVal !== 'string' || !VALID_GRADES.includes(gradeVal)) {
        return NextResponse.json(
          { success: false, error: 'Grade must be a string "6" through "12"' },
          { status: 400 }
        );
      }
    }

    // ── Validate title ──
    if ('title' in sanitizedUpdates) {
      if (typeof sanitizedUpdates.title !== 'string' || !(sanitizedUpdates.title as string).trim()) {
        return NextResponse.json(
          { success: false, error: 'Title must be a non-empty string' },
          { status: 400 }
        );
      }
      sanitizedUpdates.title = (sanitizedUpdates.title as string).trim();
    }

    // ── Validate subject ──
    if ('subject' in sanitizedUpdates) {
      if (typeof sanitizedUpdates.subject !== 'string' || !(sanitizedUpdates.subject as string).trim()) {
        return NextResponse.json(
          { success: false, error: 'Subject must be a non-empty string' },
          { status: 400 }
        );
      }
      sanitizedUpdates.subject = (sanitizedUpdates.subject as string).trim();
    }

    // ── Validate question_count ──
    if ('question_count' in sanitizedUpdates) {
      const qc = Number(sanitizedUpdates.question_count);
      if (!Number.isInteger(qc) || qc <= 0) {
        return NextResponse.json(
          { success: false, error: 'question_count must be a positive integer' },
          { status: 400 }
        );
      }
      sanitizedUpdates.question_count = qc;
    }

    // ── Validate duration_minutes ──
    if ('duration_minutes' in sanitizedUpdates) {
      const dm = Number(sanitizedUpdates.duration_minutes);
      if (!Number.isInteger(dm) || dm <= 0) {
        return NextResponse.json(
          { success: false, error: 'duration_minutes must be a positive integer' },
          { status: 400 }
        );
      }
      sanitizedUpdates.duration_minutes = dm;
    }

    // ── Validate time constraints ──
    if ('start_time' in sanitizedUpdates || 'end_time' in sanitizedUpdates) {
      const effectiveStart = sanitizedUpdates.start_time
        ? new Date(sanitizedUpdates.start_time as string)
        : new Date(currentExam.start_time);
      const effectiveEnd = sanitizedUpdates.end_time
        ? new Date(sanitizedUpdates.end_time as string)
        : new Date(currentExam.end_time);

      if ('start_time' in sanitizedUpdates && isNaN(effectiveStart.getTime())) {
        return NextResponse.json(
          { success: false, error: 'start_time is not a valid date' },
          { status: 400 }
        );
      }
      if ('end_time' in sanitizedUpdates && isNaN(effectiveEnd.getTime())) {
        return NextResponse.json(
          { success: false, error: 'end_time is not a valid date' },
          { status: 400 }
        );
      }
      if (effectiveEnd <= effectiveStart) {
        return NextResponse.json(
          { success: false, error: 'end_time must be after start_time' },
          { status: 400 }
        );
      }

      // Normalize to ISO strings
      if ('start_time' in sanitizedUpdates) {
        sanitizedUpdates.start_time = effectiveStart.toISOString();
      }
      if ('end_time' in sanitizedUpdates) {
        sanitizedUpdates.end_time = effectiveEnd.toISOString();
      }
    }

    // ── Validate target_classes ──
    if ('target_classes' in sanitizedUpdates) {
      if (sanitizedUpdates.target_classes !== null && !Array.isArray(sanitizedUpdates.target_classes)) {
        return NextResponse.json(
          { success: false, error: 'target_classes must be an array of UUIDs or null' },
          { status: 400 }
        );
      }
    }

    // ── Apply update ──
    const { data: updated, error } = await supabase
      .from('school_exams')
      .update(sanitizedUpdates)
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .select('id, title, subject, grade, target_classes, question_count, duration_minutes, start_time, end_time, status, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Exam not found' },
          { status: 404 }
        );
      }
      logger.error('school_admin_exam_update_error', {
        error: new Error(error.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update exam' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_exams_patch_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/exams',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── DELETE — Cancel exam (set to 'cancelled') ────────────────

/**
 * DELETE /api/school-admin/exams — Cancel an exam
 * Permission: school.manage_exams
 *
 * Body: { id: string }
 *
 * Only allowed if status is 'draft' or 'scheduled'.
 * This sets status to 'cancelled' rather than hard-deleting.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_exams');
    if (!auth.authorized) return auth.errorResponse;

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

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Exam ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Fetch current exam to check status
    const { data: currentExam, error: fetchError } = await supabase
      .from('school_exams')
      .select('id, status')
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Exam not found' },
          { status: 404 }
        );
      }
      logger.error('school_admin_exam_delete_fetch_error', {
        error: new Error(fetchError.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch exam' },
        { status: 500 }
      );
    }

    if (!currentExam) {
      return NextResponse.json(
        { success: false, error: 'Exam not found' },
        { status: 404 }
      );
    }

    // Only draft or scheduled exams can be cancelled
    if (currentExam.status !== 'draft' && currentExam.status !== 'scheduled') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot cancel an exam with status "${currentExam.status}". Only draft or scheduled exams can be cancelled.`,
        },
        { status: 409 }
      );
    }

    // Set status to cancelled
    const { data: cancelled, error } = await supabase
      .from('school_exams')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .select('id, title, status, updated_at')
      .single();

    if (error) {
      logger.error('school_admin_exam_cancel_error', {
        error: new Error(error.message),
        route: '/api/school-admin/exams',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to cancel exam' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: cancelled });
  } catch (err) {
    logger.error('school_admin_exams_delete_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/exams',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
