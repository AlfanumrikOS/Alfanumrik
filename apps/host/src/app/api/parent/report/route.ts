import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { isGuardianLinkedToStudent } from '@alfanumrik/lib/domains/relationship';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * POST /api/parent/report — Generate AI weekly report for a child
 * Permission: child.view_progress
 * Resource check: parent must be linked to student via guardian_student_links.
 *
 * Body: { student_id: string, language?: "en" | "hi" }
 *
 * Returns cached report if <24h old, otherwise calls the Edge Function.
 */

// Bound the parent-report-generator hop (AI generation can hang upstream).
// 25s interim per architect review 2026-08-03: a 15s abort discarded
// completed-but-unpersisted AI generations (route upserts the report cache
// only AFTER the response), causing parent retry loops that restarted full
// generation. Single hop within the 30s maxDuration budget allows 25s.
// Durable fix = move persistence into parent-report-generator so aborted
// responses still populate the cache.
const REPORT_TIMEOUT_MS = 25_000;

// Timeout-bounded fetch. Mirrors the module-private helper at
// packages/lib/src/supabase.ts:40 (`fetchWithTimeout`) — that copy is not
// exported from @alfanumrik/lib, so the canonical semantics are replicated
// here until packages/lib exposes a shared export (P1-4a follow-up).
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function createRlsScopedClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // RLS-scoped cache access only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

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

    // ── Check for cached report (24h) via RLS-scoped client ──
    const cacheClient = await createRlsScopedClient(request);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await cacheClient
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

    // Forward the parent's own JWT (same pattern as /api/board-score) so the
    // Edge Function's resolveSecurityPrincipal resolves them via the
    // authenticated path and runs its own independent guardian + link
    // verification. The anon key satisfies neither that path nor the
    // internal-service signature path there — sending it was a 100% failure
    // (deny_auth, HTTP 401) for every parent who ever hit this route,
    // confirmed live via Vercel runtime error logs.
    let edgeAuthHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!edgeAuthHeader) {
      const { data: { session } } = await cacheClient.auth.getSession();
      if (session?.access_token) {
        edgeAuthHeader = `Bearer ${session.access_token}`;
      }
    }
    if (!edgeAuthHeader) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/parent-report-generator`;

    let efResponse: Response;
    try {
      efResponse = await fetchWithTimeout(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': edgeAuthHeader,
        },
        body: JSON.stringify({
          student_id,
          parent_id: guardian.id,
          language: safeLanguage,
        }),
      }, REPORT_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn('parent_report_edge_function_timeout', {
          route: '/api/parent/report',
          timeoutMs: REPORT_TIMEOUT_MS,
        });
        return NextResponse.json(
          { success: false, error: 'Report generation timed out. Please try again later.' },
          { status: 504 }
        );
      }
      throw err; // non-timeout network errors keep the pre-existing outer-catch 500 path
    }

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
        cacheClient
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
