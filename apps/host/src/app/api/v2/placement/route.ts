/**
 * GET /api/v2/placement?subject=<code> — six cold-start probes for the
 * first-run placement check.
 *
 * Questions come from question_bank through selectPlacementQuestions, the
 * cold-start sibling of the live adaptive selector — same table, same column
 * vocabulary, same P6 shape guard. There is no second question source.
 *
 * Read-only. No mastery write happens here; answers go to
 * POST /api/v2/placement/answer.
 *
 * Query-param validation follows the same convention as the other /v2 GET
 * routes with query params (GET /v2/quiz/questions, GET /v2/learn/concept,
 * GET /v2/parent/glance): manual checks + a VALIDATION_ERROR code. There is
 * no JSON body on a GET request, so validateBody() (used by the POST routes
 * in this family) does not apply here.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getStudentByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { selectPlacementQuestions } from '@alfanumrik/lib/adaptive/select-placement-questions';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_placement_v1';
const PROBE_COUNT = 6;

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'study_plan.view', { requireStudentId: true });
  if (!auth.authorized || !auth.userId) return auth.errorResponse!;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return v2Error('Not found', 404, 'NOT_FOUND');

  const url = new URL(request.url);
  const subject = url.searchParams.get('subject');
  if (!subject || subject.length === 0 || subject.length > 40) {
    return v2Error('subject is required (1-40 characters)', 400, 'VALIDATION_ERROR');
  }
  const langParam = url.searchParams.get('lang');
  if (langParam !== null && langParam !== 'en' && langParam !== 'hi') {
    return v2Error('lang must be "en" or "hi"', 400, 'VALIDATION_ERROR');
  }

  try {
    const identity = await getStudentByAuthUserId(auth.userId);
    if (!identity.ok) return v2Error('Profile lookup failed', 500, 'INTERNAL_ERROR');
    if (!identity.data) return v2Error('No student profile found', 404, 'NO_STUDENT_PROFILE');

    // P5: grade stays a string end to end.
    const grade = identity.data.grade == null ? null : String(identity.data.grade);
    if (!grade) return v2Error('Student has no grade set', 409, 'NO_GRADE');

    const supabase = await createSupabaseServerClient();
    const questions = await selectPlacementQuestions(
      supabase as never,
      { subject, grade, count: PROBE_COUNT },
      langParam === 'hi',
    );

    return v2Success({ schemaVersion: 1 as const, subject, grade, questions });
  } catch (err) {
    logger.error('v2_placement_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/placement',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
