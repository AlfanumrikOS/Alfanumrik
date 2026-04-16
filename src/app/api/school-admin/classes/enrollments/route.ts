import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET — list students enrolled in a class
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const params = new URL(request.url).searchParams;
  const classId = params.get('class_id');
  if (!classId) return NextResponse.json({ error: 'class_id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Verify class belongs to this school
  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('school_id', auth.schoolId)
    .single();

  if (!cls) return NextResponse.json({ error: 'Class not found in your school' }, { status: 404 });

  const { data, error } = await supabase
    .from('class_enrollments')
    .select('id, student_id, enrolled_at, is_active, students(id, name, grade, xp_total, last_active)')
    .eq('class_id', classId)
    .eq('is_active', true)
    .order('enrolled_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

// POST — enroll students in a class
export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const { class_id, student_ids } = body;

  if (!class_id || !Array.isArray(student_ids) || student_ids.length === 0) {
    return NextResponse.json({ error: 'class_id and student_ids[] required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Verify class belongs to this school
  const { data: cls } = await supabase
    .from('classes')
    .select('id, max_students')
    .eq('id', class_id)
    .eq('school_id', auth.schoolId)
    .single();

  if (!cls) return NextResponse.json({ error: 'Class not found in your school' }, { status: 404 });

  // Verify all students belong to this school
  const { data: validStudents } = await supabase
    .from('students')
    .select('id')
    .in('id', student_ids)
    .eq('school_id', auth.schoolId);

  const validIds = new Set((validStudents || []).map(s => s.id));
  const enrollments = student_ids
    .filter((sid: string) => validIds.has(sid))
    .map((sid: string) => ({ class_id, student_id: sid, is_active: true }));

  if (enrollments.length === 0) {
    return NextResponse.json({ error: 'No valid students to enroll' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('class_enrollments')
    .upsert(enrollments, { onConflict: 'class_id,student_id' })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, enrolled: (data || []).length }, { status: 201 });
}

// DELETE — remove student from class (soft delete)
export async function DELETE(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const body = await request.json();
  const { class_id, student_id } = body;

  if (!class_id || !student_id) {
    return NextResponse.json({ error: 'class_id and student_id required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Verify class belongs to this school
  const { data: cls } = await supabase
    .from('classes')
    .select('id')
    .eq('id', class_id)
    .eq('school_id', auth.schoolId)
    .single();

  if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 });

  const { error } = await supabase
    .from('class_enrollments')
    .update({ is_active: false })
    .eq('class_id', class_id)
    .eq('student_id', student_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
