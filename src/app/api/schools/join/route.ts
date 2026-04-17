import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * POST /api/schools/join — Join a school via invite code
 *
 * Body: { code: string }
 *
 * Authentication: optional.
 * - If authenticated: links user to the school.
 * - If not authenticated: returns school info for pre-filled signup.
 *
 * Validates: code exists, is_active, not expired, uses < max_uses, seat limit.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string' || code.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: 'A valid invite code is required' },
        { status: 400 }
      );
    }

    const normalizedCode = code.trim().toUpperCase();

    // 1. Look up invite code
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('school_invite_codes')
      .select('id, school_id, code, role, class_id, max_uses, uses_count, expires_at, is_active')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle();

    if (inviteErr) {
      logger.error('join_code_lookup_failed', {
        error: inviteErr,
        route: '/api/schools/join',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to validate code' },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired invite code' },
        { status: 404 }
      );
    }

    // 2. Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This invite code has expired' },
        { status: 410 }
      );
    }

    // 3. Check max uses
    if (invite.uses_count >= invite.max_uses) {
      return NextResponse.json(
        { success: false, error: 'This invite code has reached its usage limit' },
        { status: 410 }
      );
    }

    // 4. Get school info
    const { data: school, error: schoolErr } = await supabaseAdmin
      .from('schools')
      .select('id, name, slug, logo_url, primary_color')
      .eq('id', invite.school_id)
      .single();

    if (schoolErr || !school) {
      return NextResponse.json(
        { success: false, error: 'School not found' },
        { status: 404 }
      );
    }

    // 5. Get class info if class-specific code
    let className: string | null = null;
    let classGrade: string | null = null;
    if (invite.class_id) {
      const { data: cls } = await supabaseAdmin
        .from('classes')
        .select('name, grade')
        .eq('id', invite.class_id)
        .single();

      if (cls) {
        className = cls.name;
        classGrade = cls.grade;
      }
    }

    // 6. Check if user is authenticated
    const cookieStore = await cookies();
    const supabaseServer = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // Read-only in route handler
          },
        },
      }
    );

    const { data: { user } } = await supabaseServer.auth.getUser();

    if (!user) {
      // Not authenticated — return school info for pre-filled signup
      return NextResponse.json({
        success: true,
        authenticated: false,
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          logo_url: school.logo_url,
        },
        role: invite.role,
        class_name: className,
        class_grade: classGrade,
        message: `Join ${school.name}${className ? `, ${className}` : ''} as a ${invite.role}. Sign up to continue.`,
      });
    }

    // 7. Check seat limit for students
    if (invite.role === 'student') {
      const { data: subscription } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seats_purchased')
        .eq('school_id', invite.school_id)
        .eq('status', 'active')
        .maybeSingle();

      if (subscription) {
        const { count: currentStudents } = await supabaseAdmin
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', invite.school_id);

        if (currentStudents !== null && currentStudents >= subscription.seats_purchased) {
          return NextResponse.json(
            { success: false, error: 'This school has reached its student seat limit. Please contact the school administrator.' },
            { status: 403 }
          );
        }
      }
    }

    // 8. Link user to school
    if (invite.role === 'student') {
      const { error: updateErr } = await supabaseAdmin
        .from('students')
        .update({ school_id: invite.school_id })
        .eq('auth_user_id', user.id);

      if (updateErr) {
        logger.error('join_student_link_failed', {
          error: updateErr,
          route: '/api/schools/join',
        });
        return NextResponse.json(
          { success: false, error: 'Failed to link to school. Please try again.' },
          { status: 500 }
        );
      }

      // If class-specific, enroll in class
      if (invite.class_id) {
        // Get student id
        const { data: student } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('auth_user_id', user.id)
          .single();

        if (student) {
          await supabaseAdmin
            .from('class_enrollments')
            .upsert(
              {
                class_id: invite.class_id,
                student_id: student.id,
                enrolled_at: new Date().toISOString(),
              },
              { onConflict: 'class_id,student_id' }
            );
        }
      }
    } else if (invite.role === 'teacher') {
      const { error: updateErr } = await supabaseAdmin
        .from('teachers')
        .update({ school_id: invite.school_id })
        .eq('auth_user_id', user.id);

      if (updateErr) {
        logger.error('join_teacher_link_failed', {
          error: updateErr,
          route: '/api/schools/join',
        });
        return NextResponse.json(
          { success: false, error: 'Failed to link to school. Please try again.' },
          { status: 500 }
        );
      }
    }

    // 9. Increment uses_count
    await supabaseAdmin
      .from('school_invite_codes')
      .update({ uses_count: invite.uses_count + 1 })
      .eq('id', invite.id);

    return NextResponse.json({
      success: true,
      authenticated: true,
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
      },
      role: invite.role,
      class_name: className,
      class_grade: classGrade,
      message: `You've been added to ${school.name}${className ? `, ${className}` : ''} as a ${invite.role}.`,
    });
  } catch (err) {
    logger.error('join_school_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/join',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
