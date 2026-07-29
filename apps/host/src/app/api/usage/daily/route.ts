import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/usage/daily?feature=foxy_chat|quiz — the DISPLAYED daily quota,
 * read from the SAME authority that ENFORCES it.
 *
 * WHY THIS ROUTE EXISTS (P0-1, the school-demo defect)
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforcement lives in `check_and_record_usage()`, which derives its cap from
 * `get_plan_limit()`. Since migration 20260729130000 that function returns
 * GREATEST(personal B2C limit, school B2B coverage-derived limit), so a student
 * covered by a paid/trial SCHOOL plan is enforced at the school tier.
 *
 * The Foxy screen, however, computed its badge from the TypeScript `PLAN_LIMITS`
 * constant keyed on the `students.subscription_plan` COLUMN — which is
 * school-blind. A school-covered student therefore saw "5 chats left" and, worse,
 * was BLOCKED client-side at 5 (`foxy/page.tsx` opens the limit modal and returns
 * before ever reaching the API) even though the server would have allowed
 * unlimited. This route closes that gap by letting the client read the server's
 * authoritative number instead of re-deriving one.
 *
 * NO NEW AUTHORITY IS CREATED. This is a thin read-through to `get_plan_limit()`
 * plus the usage row. It holds zero limit logic of its own, so what a student
 * SEES cannot drift from what is ENFORCED. `get_plan_limit` has EXECUTE REVOKEd
 * from `anon`/`authenticated` (migration 20260729130000 §5), which is precisely
 * why the browser cannot call it directly and needs this service-role hop.
 *
 * AUTH (P9): authorizeRequest(request, <feature permission>) — 'foxy.chat' for
 * foxy_chat, 'quiz.attempt' for quiz. Both are granted to the `student` role by
 * the RBAC matrix (20260612123200), so no genuinely entitled student is denied.
 *
 * TENANT SAFETY (P8/P13): the student is resolved STRICTLY from the caller's own
 * auth user id (`auth.studentId`, which authorizeRequest derives from
 * students.auth_user_id = caller). No studentId is accepted from the request, so
 * a caller can only ever read their OWN quota. The response is four integers and
 * a boolean — no names, emails, phones, school identity, or roster data. Logs
 * carry the route and the error only; no student identifier.
 *
 * P12 (AI-safety): this route is READ-ONLY. It never increments, never records,
 * and never grants. The hard gate remains `checkAndIncrementQuota` →
 * `check_and_record_usage` in /api/foxy. Nothing here can let a student exceed
 * the enforced cap.
 *
 * NEVER OVER-PROMISE: if `get_plan_limit` cannot be resolved we return 503 with
 * no data rather than guessing a generous cap. The client then falls back to its
 * local conservative default (today's behavior), which under-promises for
 * school-covered students but never over-promises for anyone.
 *
 * Response: { success: true, data: { feature, limit, count, remaining, allowed } }
 *         | { success: false, error }
 */

/**
 * Feature → the RBAC permission the student role already holds for it.
 *
 * A `Map`, NOT an object literal, and deliberately so. As a plain object typed
 * `Record<string, string>` this table inherited `Object.prototype`, so
 * `FEATURE_PERMISSION['toString']` returned a FUNCTION and
 * `FEATURE_PERMISSION['__proto__']` an OBJECT — both truthy, so the
 * `if (!permission)` guard below did not reject them and a caller-controlled
 * `?feature=` walked past input validation. Observed consequences, both real:
 *   • student caller → the non-string permission matches no granted code, so
 *     `authorizeRequest` takes its deny branch, where
 *     `requiredPermission.split('.')[0]` (rbac.ts:785) throws a TypeError.
 *     That call is above the try block, so it escaped as an unhandled 500.
 *   • super-admin caller → rbac's `isSuperAdmin` short-circuit skips the
 *     permission check entirely, so the request reached `get_plan_limit` with
 *     `p_feature='toString'`, landing in its generous ai_calls_total ELSE arm —
 *     precisely the over-promise this guard exists to prevent.
 *
 * `Map.prototype.get` consults no prototype chain, so inherited keys are
 * unreachable by construction rather than by a guard someone must remember at
 * each new call site. It also fixes the type lie that hid this: with
 * `noUncheckedIndexedAccess` off (apps/host/tsconfig.json), `Record<string,
 * string>` indexing types as a non-optional `string`, so TypeScript saw
 * `if (!permission)` as a redundant check and gave no signal. `Map.get` returns
 * `string | undefined`, making the guard meaningful to the compiler.
 */
const FEATURE_PERMISSION = new Map<string, string>([
  ['foxy_chat', 'foxy.chat'],
  ['quiz', 'quiz.attempt'],
]);

export async function GET(request: NextRequest) {
  const feature = new URL(request.url).searchParams.get('feature') ?? 'foxy_chat';
  const permission = FEATURE_PERMISSION.get(feature);

  // Validate input BEFORE any auth/DB work — an unknown feature must never be
  // forwarded to get_plan_limit (whose ELSE branch returns the generous
  // ai_calls_total cap and would over-promise for a typo'd feature name), and
  // must never be forwarded to authorizeRequest as a non-string.
  if (typeof permission !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Unsupported feature' },
      { status: 400 },
    );
  }

  const auth = await authorizeRequest(request, permission);
  if (!auth.authorized) return auth.errorResponse!;

  // Caller's OWN student row only — never a request-supplied id.
  const studentId = auth.studentId;
  if (!studentId) {
    return NextResponse.json(
      { success: false, error: 'No student profile for this account' },
      { status: 404 },
    );
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    const [limitRes, usageRes] = await Promise.all([
      // THE enforcement authority — the identical RPC check_and_record_usage
      // derives its cap from. School coverage is already folded in here.
      supabaseAdmin.rpc('get_plan_limit', {
        p_student_id: studentId,
        p_feature: feature,
      }),
      // The NARROW usage shape — the only shape check_and_record_usage writes
      // (student_id, feature, usage_date, usage_count). Deliberately NOT
      // get_student_usage(), whose `used` values read wide columns
      // (foxy_chats_used, …) that no writer in the migration chain ever
      // populates, so they are effectively always 0.
      supabaseAdmin
        .from('student_daily_usage')
        .select('usage_count')
        .eq('student_id', studentId)
        .eq('feature', feature)
        .eq('usage_date', today)
        .maybeSingle(),
    ]);

    if (limitRes.error || typeof limitRes.data !== 'number') {
      // Fail-soft, conservative: no authoritative number means we say nothing.
      // The client keeps its local default rather than being handed a guess.
      logger.warn('usage_daily_limit_lookup_failed', {
        route: '/api/usage/daily',
        feature,
        error: limitRes.error?.message,
      });
      return NextResponse.json(
        { success: false, error: 'Limit unavailable' },
        { status: 503 },
      );
    }

    if (usageRes.error) {
      // A missing row legitimately means "no usage yet"; a read ERROR is
      // different, so it is logged. We still fall through with 0, matching the
      // pre-existing client behavior — and the server-side gate is what
      // actually stops an over-limit turn, so an optimistic count here cannot
      // let anyone exceed the cap (P12).
      logger.warn('usage_daily_count_lookup_failed', {
        route: '/api/usage/daily',
        feature,
        error: usageRes.error.message,
      });
    }

    const limit = limitRes.data;
    const count = usageRes.data?.usage_count ?? 0;

    return NextResponse.json({
      success: true,
      data: {
        feature,
        limit,
        count,
        remaining: Math.max(0, limit - count),
        allowed: count < limit,
      },
    });
  } catch (err) {
    logger.error('usage_daily_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/usage/daily',
    });
    return NextResponse.json(
      { success: false, error: 'Failed to resolve usage' },
      { status: 500 },
    );
  }
}
