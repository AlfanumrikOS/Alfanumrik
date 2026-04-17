import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EnrollRow {
  name: string;
  email: string;
  grade: string;
  section?: string;
  parent_email?: string;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

/**
 * POST /api/schools/enroll — Bulk enroll students into a school
 * Permission: institution.manage_students
 *
 * Body: {
 *   school_id: string,
 *   students: [{ name, email, grade, section?, parent_email? }]
 * }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { school_id, students } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one student is required' },
        { status: 400 }
      );
    }

    if (students.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Maximum 200 students per batch' },
        { status: 400 }
      );
    }

    // Verify the user is admin of this school
    const { data: adminRecord } = await supabaseAdmin
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', auth.userId)
      .eq('school_id', school_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!adminRecord) {
      return NextResponse.json(
        { success: false, error: 'Not authorized for this school' },
        { status: 403 }
      );
    }

    // Check seat limit
    const { data: subscription } = await supabaseAdmin
      .from('school_subscriptions')
      .select('seats_purchased')
      .eq('school_id', school_id)
      .eq('status', 'active')
      .maybeSingle();

    if (subscription) {
      const { count: currentStudents } = await supabaseAdmin
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', school_id);

      const seatsRemaining = subscription.seats_purchased - (currentStudents ?? 0);
      if (students.length > seatsRemaining) {
        return NextResponse.json(
          {
            success: false,
            error: `Only ${seatsRemaining} seats remaining (${subscription.seats_purchased} purchased, ${currentStudents ?? 0} enrolled). Cannot add ${students.length} students.`,
          },
          { status: 403 }
        );
      }
    }

    // Validate rows
    const errors: RowError[] = [];
    const validRows: EnrollRow[] = [];

    students.forEach((row: Record<string, string>, idx: number) => {
      const rowNum = idx + 1;
      const name = row.name?.trim();
      const email = row.email?.trim();
      const grade = String(row.grade ?? '').trim();
      const section = row.section?.trim() || undefined;
      const parentEmail = row.parent_email?.trim() || undefined;

      if (!name || name.length < 2) {
        errors.push({ row: rowNum, field: 'name', message: 'Name must be at least 2 characters' });
      }
      if (!email || !EMAIL_REGEX.test(email)) {
        errors.push({ row: rowNum, field: 'email', message: 'Invalid email format' });
      }
      if (!VALID_GRADES.includes(grade)) {
        errors.push({ row: rowNum, field: 'grade', message: `Grade must be one of ${VALID_GRADES.join(', ')}` });
      }
      if (parentEmail && !EMAIL_REGEX.test(parentEmail)) {
        errors.push({ row: rowNum, field: 'parent_email', message: 'Invalid parent email format' });
      }

      if (name && name.length >= 2 && email && EMAIL_REGEX.test(email) && VALID_GRADES.includes(grade)) {
        validRows.push({ name, email, grade, section, parent_email: parentEmail });
      }
    });

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid rows to import',
          errors,
        },
        { status: 400 }
      );
    }

    // Create student records
    // Note: This creates pre-registration records. Students still need to sign up.
    // The school_id is set so when they sign up with this email, they'll be linked.
    let successCount = 0;
    const importErrors: RowError[] = [...errors];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];

      // Check if student already exists in this school
      const { data: existing } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('email', row.email)
        .eq('school_id', school_id)
        .maybeSingle();

      if (existing) {
        importErrors.push({
          row: i + 1,
          field: 'email',
          message: `Student with email already exists in this school`,
        });
        continue;
      }

      // Create a pre-registration record
      // This creates a student record without an auth_user_id
      // When the student signs up with this email, the auth flow will link them
      const { error: insertErr } = await supabaseAdmin
        .from('students')
        .insert({
          name: row.name,
          email: row.email,
          grade: row.grade,
          school_id,
          board: 'CBSE',
          is_active: true,
        });

      if (insertErr) {
        importErrors.push({
          row: i + 1,
          field: 'email',
          message: insertErr.message,
        });
        continue;
      }

      successCount++;

      // If section specified, enroll in matching class
      if (row.section) {
        const { data: matchingClass } = await supabaseAdmin
          .from('classes')
          .select('id')
          .eq('school_id', school_id)
          .eq('grade', row.grade)
          .eq('section', row.section)
          .maybeSingle();

        if (matchingClass) {
          const { data: newStudent } = await supabaseAdmin
            .from('students')
            .select('id')
            .eq('email', row.email)
            .eq('school_id', school_id)
            .single();

          if (newStudent) {
            await supabaseAdmin
              .from('class_enrollments')
              .upsert(
                {
                  class_id: matchingClass.id,
                  student_id: newStudent.id,
                  enrolled_at: new Date().toISOString(),
                },
                { onConflict: 'class_id,student_id' }
              );
          }
        }
      }
    }

    logAudit(auth.userId, {
      action: 'bulk_enroll',
      resourceType: 'students',
      resourceId: school_id,
    });

    return NextResponse.json({
      success: true,
      data: {
        total: students.length,
        success_count: successCount,
        error_count: importErrors.length,
        errors: importErrors,
      },
    });
  } catch (err) {
    logger.error('school_enroll_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/enroll',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
