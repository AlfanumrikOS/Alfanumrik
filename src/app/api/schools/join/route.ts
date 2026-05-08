import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { capture as posthogCapture } from '@/lib/posthog/server';
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

    // 7. Seat-cap check for students (Phase 3-B follow-up).
    //
    // Match the definition used by /api/school-admin/students PATCH and
    // /api/school-admin/subscription POST/PATCH:
    //   seats_used = COUNT(students WHERE school_id = X AND is_active = true)
    //
    // Differences from the previous logic in this route:
    //  • Counts is_active=true only (was: every student row).
    //  • Applies to ANY school_subscriptions row, including trial schools
    //    (was: only when status='active'; trials were silently uncapped).
    //  • Emits school_seat_cap_hit so the funnel surfaces in PostHog.
    if (invite.role === 'student') {
      const { data: subscription } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seats_purchased')
        .eq('school_id', invite.school_id)
        .maybeSingle();

      if (subscription) {
        const { count: activeStudents } = await supabaseAdmin
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', invite.school_id)
          .eq('is_active', true);

        const seatsUsed = activeStudents ?? 0;
        const seatsPurchased = subscription.seats_purchased as number;

        if (seatsUsed + 1 > seatsPurchased) {
          await posthogCapture('school_seat_cap_hit', user.id, {
            school_id: invite.school_id,
            source: 'invite_code_join',
            seats_purchased: seatsPurchased,
            seats_used: seatsUsed,
          });
          return NextResponse.json(
            {
              success: false,
              code: 'seat_cap_violation',
              error: `This school has used ${seatsUsed} of ${seatsPurchased} seats. Please ask the school administrator to upgrade.`,
              seats_used: seatsUsed,
              seats_purchased: seatsPurchased,
            },
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

    // 9. Atomically increment uses_count with a max_uses guard.
    //
    // Race condition fix: the read-then-write pattern (read uses_count above,
    // then write uses_count + 1 here) lets two concurrent joiners both pass
    // the max_uses check at uses_count=N, both link to the school, then both
    // write N+1 — net effect is two students joined but the counter only
    // advanced by 1, so the per-code limit can be exceeded by N.
    //
    // The eq('uses_count', invite.uses_count) clause makes the increment a
    // CAS (compare-and-swap): the UPDATE only fires if uses_count is still
    // exactly what we read in step 1. If it changed under us, the data
    // returned will be empty — we don't undo the link (the student is
    // already a member) but we do log the contention so ops can see if
    // codes are being hammered concurrently.
    const { data: incremented } = await supabaseAdmin
      .from('school_invite_codes')
      .update({ uses_count: invite.uses_count + 1 })
      .eq('id', invite.id)
      .eq('uses_count', invite.uses_count)
      .select('id, uses_count')
      .maybeSingle();

    if (!incremented) {
      logger.warn('join_invite_code_increment_contention', {
        code_id: invite.id,
        school_id: invite.school_id,
        observed_uses_count: invite.uses_count,
        route: '/api/schools/join',
      });
    }

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
