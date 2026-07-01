import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logSchoolAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// GET — list classes for this school with enrollment counts
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const supabase = getSupabaseAdmin();
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, parseInt(params.get('limit') || '25'));
    const offset = (page - 1) * limit;
    const grade = params.get('grade');
    const academicYear = params.get('academic_year');

    let query = supabase
      .from('classes')
      .select('id, name, grade, section, academic_year, subject, class_code, is_active, max_students, created_at', { count: 'exact' })
      .eq('school_id', auth.schoolId)
      .is('deleted_at', null)
      .order('grade', { ascending: true })
      .order('section', { ascending: true })
      .range(offset, offset + limit - 1);

    if (grade) query = query.eq('grade', grade); // P5: grade is string
    if (academicYear) query = query.eq('academic_year', academicYear);

    const { data: classes, count, error } = await query;
    if (error) {
      logger.error('school-admin classes error', { error: new Error(error.message), method: 'GET' });
      return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
    }

    // Fetch enrollment counts per class
    const classIds = (classes || []).map(c => c.id);
    let enrollmentCounts: Record<string, number> = {};

    if (classIds.length > 0) {
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('class_id')
        .in('class_id', classIds)
        .eq('is_active', true);

      if (enrollments) {
        enrollmentCounts = enrollments.reduce((acc: Record<string, number>, e) => {
          acc[e.class_id] = (acc[e.class_id] || 0) + 1;
          return acc;
        }, {});
      }
    }

    const enriched = (classes || []).map(c => ({
      ...c,
      enrolled_count: enrollmentCounts[c.id] || 0,
    }));

    return NextResponse.json({ data: enriched, total: count || 0, page, limit });
  } catch (err) {
    logger.error('school-admin classes error', { error: err instanceof Error ? err : new Error(String(err)), method: 'GET' });
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}

// POST — create a class
export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { name, grade, section, academic_year, subject, class_code, max_students } = body as Record<string, unknown>;

    if (!name || !grade || !section) {
      return NextResponse.json({ error: 'Name, grade, and section are required' }, { status: 400 });
    }

    // P5: validate grade is string "6"-"12"
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    if (!validGrades.includes(String(grade))) {
      return NextResponse.json({ error: 'Grade must be "6" through "12"' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const autoCode = class_code || `${grade}-${section}-${academic_year || '2026'}`;

    const { data, error } = await supabase
      .from('classes')
      .insert({
        school_id: auth.schoolId,
        name,
        grade: String(grade), // P5: ensure string
        section,
        academic_year: academic_year || '2026-27',
        subject: subject || null,
        class_code: autoCode,
        max_students: max_students || 50,
        created_by: auth.userId,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('school-admin classes error', { error: new Error(error.message), method: 'POST' });
      return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
    }

    if (auth.schoolId) {
      void logSchoolAudit({
        schoolId: auth.schoolId,
        actorId: auth.userId ?? 'unknown',
        action: 'class.created',
        resourceType: 'class',
        resourceId: data.id,
        metadata: { name, grade: String(grade), section, academic_year: data.academic_year },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (err) {
    logger.error('school-admin classes error', { error: err instanceof Error ? err : new Error(String(err)), method: 'POST' });
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}

// PATCH — update a class
export async function PATCH(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { id, updates } = body as { id?: unknown; updates?: unknown };
    if (!id || !updates) return NextResponse.json({ error: 'Class id and updates required' }, { status: 400 });

    if (typeof id !== 'string' || !isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid class ID' }, { status: 400 });
    }

    const ALLOWED = ['name', 'section', 'subject', 'is_active', 'max_students', 'academic_year'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('classes')
      .update(safe)
      .eq('id', id)
      .eq('school_id', auth.schoolId);

    if (error) {
      logger.error('school-admin classes error', { error: new Error(error.message), method: 'PATCH' });
      return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
    }

    if (auth.schoolId) {
      void logSchoolAudit({
        schoolId: auth.schoolId,
        actorId: auth.userId ?? 'unknown',
        action: 'class.updated',
        resourceType: 'class',
        resourceId: id,
        metadata: { fields: Object.keys(safe) },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('school-admin classes error', { error: err instanceof Error ? err : new Error(String(err)), method: 'PATCH' });
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
