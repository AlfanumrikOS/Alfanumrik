import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { isGuardianLinkedToStudent } from '@/lib/domains/relationship';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';

/**
 * POST /api/parent/report — Generate AI weekly report for a child
 * Permission: child.view_progress
 * Resource check: parent must be linked to student via guardian_student_links.
 *
 * Body: { student_id: string, language?: "en" | "hi" }
 *
 * Returns cached report if <24h old, otherwise calls the Edge Function.
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { student_id, language = 'en' } = body;

    // ── Input validation ──
    if (!student_id || !isValidUUID(student_id)) {
      return NextResponse.json(
        { success: false, error: 'Valid student_id is required' },
        { status: 400 }
      );
    }

    const safeLanguage = ['en', 'hi'].includes(language) ? language : 'en';

    // ── Resolve parent (guardian) ID from auth user ──
    const guardianResult = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianResult.ok || !guardianResult.data) {
      return NextResponse.json(
        { success: false, error: 'No parent profile found' },
        { status: 403 }
      );
    }
    const guardian = guardianResult.data;

    // ── Verify parent-student link ──
    const linkCheck = await isGuardianLinkedToStudent(guardian.id, student_id);
    if (!linkCheck.ok || !linkCheck.data) {
      return NextResponse.json(
        { success: false, error: 'You are not linked to this student' },
        { status: 403 }
      );
    }

    // ── Check for cached report (24h) ──
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabaseAdmin
      .from('parent_weekly_reports')
      .select('report, generated_at')
      .eq('student_id', student_id)
      .eq('guardian_id', guardian.id)
      .gte('generated_at', twentyFourHoursAgo)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      logAudit(auth.userId!, {
        action: 'view',
        resourceType: 'parent_weekly_report',
        resourceId: student_id,
        details: { source: 'cache' },
      });

      return NextResponse.json(
        {
          success: true,
          data: {
            report: cached.report,
            generated_at: cached.generated_at,
            cached: true,
          },
        },
        {
          headers: {
            'Cache-Control': 'private, max-age=3600, stale-while-revalidate=7200',
          },
        }
      );
    }

    // ── Call Edge Function to generate new report ──
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/parent-report-generator`;

    const efResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        student_id,
        parent_id: guardian.id,
        language: safeLanguage,
      }),
    });

    if (!efResponse.ok) {
      const errorData = await efResponse.json().catch(() => ({}));
      const errorMsg = (errorData as Record<string, string>).error || 'Report generation failed';

      // Rate limit from edge function
      if (efResponse.status === 429) {
        return NextResponse.json(
          { success: false, error: errorMsg },
          { status: 429 }
        );
      }

      logger.error('parent_report_edge_function_failed', {
        error: new Error(errorMsg),
        route: '/api/parent/report',
        status: efResponse.status,
      });

      return NextResponse.json(
        { success: false, error: 'Could not generate report. Please try again later.' },
        { status: 502 }
      );
    }

    const result = await efResponse.json();

    // ── Cache the report in DB (fire-and-forget) ──
    if (result.report) {
      Promise.resolve(
        supabaseAdmin
          .from('parent_weekly_reports')
          .upsert(
            {
              student_id,
              guardian_id: guardian.id,
              report: result.report,
              language: safeLanguage,
              generated_at: result.generated_at || new Date().toISOString(),
            },
            { onConflict: 'student_id,guardian_id' }
          )
      ).catch((err: unknown) => {
        logger.warn('parent_report_cache_failed', {
          error: err instanceof Error ? err : new Error(String(err)),
          route: '/api/parent/report',
        });
      });
    }

    logAudit(auth.userId!, {
      action: 'generate',
      resourceType: 'parent_weekly_report',
      resourceId: student_id,
      details: { language: safeLanguage },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          report: result.report,
          generated_at: result.generated_at,
          cached: false,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=3600, stale-while-revalidate=7200',
        },
      }
    );
  } catch (err) {
    logger.error('parent_report_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/parent/report',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
