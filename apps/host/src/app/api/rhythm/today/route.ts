/**
 * Pedagogy v2 — Wave 1B
 * GET /api/rhythm/today
 *
 * Returns today's daily-rhythm queue for the authenticated student:
 *   5 SRS reviews + 1 ZPD problem + 1 reflection
 *
 * Gating: ff_pedagogy_v2_daily_rhythm. When off, returns 404.
 *
 * Queue composition (student lookup, SRS reviews, ZPD targeting, remediation
 * lane) lives in the runtime-agnostic shared module
 * `@alfanumrik/lib/learn/build-rhythm-queue` (moved out of this route
 * verbatim, 2026-07-30, so the WhatsApp bot can reuse it with a service-role
 * client). This route is the auth + flag-gate + per-student-cache wrapper.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import { buildRhythmQueue } from '@alfanumrik/lib/learn/build-rhythm-queue';
import { logger } from '@alfanumrik/lib/logger';
import { cacheFetchAsync, CACHE_TTL, cacheInvalidatePrefixAsync } from '@alfanumrik/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Bearer-AWARE, RLS-respecting client. The cookie-only
  // createSupabaseServerClient() NULLs auth.uid() for `Authorization: Bearer`
  // callers (the entire Flutter app), so every RLS-scoped read inside
  // buildRhythmQueue denied and the student lookup returned null → a spurious
  // 404 no_student_profile. createSupabaseRouteClient forwards the caller's JWT
  // under the anon key on the Bearer path and delegates to the cookie client
  // for web. Never service-role; RLS enforced on both paths.
  const supabase = await createSupabaseRouteClient(request);

  const auth = await authorizeRequest(request, 'study_plan.view', { requireStudentId: true });
  if (!auth.authorized || !auth.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = auth.userId;

  // Flag gate.
  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DAILY_RHYTHM, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Phase 5 perf: the daily-rhythm composition below issues ~5 Supabase reads
  // (student row, due reviews, question_bank, curriculum_topics, ZPD pool) and
  // fires on dashboard mount alongside the other per-student aggregate calls.
  // Collapse repeat reads within a 30s window with a SERVER-SIDE cache keyed by
  // userId + day bucket (the reflection prompt + queue rotate daily, so the day
  // belongs in the key). The key includes userId so students NEVER collide
  // (P13: per-student data must never be shared). This is a server cache, NOT a
  // CDN/`s-maxage` header — Vercel's edge does not vary by auth, so a public
  // cache would leak one student's queue to another. This handler has no writes
  // (all reads + read RPCs), so it is safe to cache.
  //
  // ONLY REAL RESULTS ARE CACHED. The previous implementation stored a
  // `{ __noProfile: true }` SENTINEL for a failed student lookup, which pinned
  // the 404 for that user for the whole TTL. Combined with the cookie-only
  // client above, a SINGLE Bearer request was enough to poison the key and 404
  // the student's dashboard even after the client bug was fixed. Now a null
  // build is returned as `null`: `cacheGetAsync` cannot distinguish a stored
  // null from a cache miss, so the next request re-runs the build instead of
  // being pinned. (Same idiom as /api/learner/scheduled's "return null to skip
  // caching" — do not re-introduce a truthy sentinel here.)
  const dayKey = Math.floor(Date.now() / 86_400_000);
  let queue: unknown | null;
  try {
    queue = await cacheFetchAsync<unknown | null>(
      `rhythm:today:${userId}:${dayKey}`,
      CACHE_TTL.USER,
      async () => (await buildRhythmQueue(supabase, userId)) ?? null,
    );
  } catch (err) {
    // Transient student-lookup failure — surfaced as 500, never cached.
    logger.error('rhythm/today: build failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      userId,
    });
    return NextResponse.json({ error: 'student_lookup_failed' }, { status: 500 });
  }
  if (!queue) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  return NextResponse.json(queue, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}

/**
 * POST /api/rhythm/today
 *
 * Cache-bust endpoint: invalidates this student's rhythm queue from both
 * in-memory L1 and Redis L2. Called by quiz/page.tsx after quiz submission
 * so the next GET /api/rhythm/today returns a fresh queue reflecting the
 * student's updated chapter progress.
 *
 * Auth: same as GET — requires authenticated Supabase session.
 * No body required. Returns { ok: true } on success.
 */
export async function POST(_request: Request) {
  // DELIBERATELY still the cookie client — but NOT because Bearer is impossible
  // here. An earlier revision of this comment claimed `supabase.auth.getUser()`
  // "cannot work on a stateless Bearer client built with persistSession: false".
  // That is FALSE, and the false version is the dangerous one to leave behind:
  // it reads as a technical constraint and would steer a future change away from
  // the one-line fix. Verified in the installed SDK (2026-08-12):
  //   • supabase-js sets `hasCustomAuthorizationHeader: true` whenever
  //     `global.headers` carries an authorization key — which is exactly what
  //     createSupabaseRouteClient() does on the Bearer path
  //     (@supabase/supabase-js/dist/index.cjs, _initSupabaseAuthClient).
  //   • auth-js's _getUser() short-circuits its "no session" bail on that flag
  //     and issues GET /user with the forwarded header intact
  //     (@supabase/auth-js/dist/main/GoTrueClient.js `_getUser`, and
  //     lib/fetch.js, which only overwrites Authorization when a jwt arg is
  //     passed).
  // So `getUser()` WOULD resolve the Bearer caller. The real reason POST is
  // unchanged is SCOPE: this P0 is about restoring RLS identity on read/submit
  // paths, and changing POST's auth semantics pulls in a backend/frontend/
  // testing review chain for a handler whose only caller today is web
  // (quiz/page.tsx post-submit cache-bust).
  //
  // Security posture while it stays cookie-only: FAIL-CLOSED. A Bearer-only
  // caller gets 401; the sole capability is invalidating the caller's OWN cache
  // prefix, keyed by the getUser()-verified id, so no cross-student
  // invalidation is reachable. Blast radius of the gap is a <=30s stale rhythm
  // queue on mobile (CACHE_TTL.USER = 30_000 ms, packages/lib/src/cache.ts).
  // Follow-up: move to authorizeRequest() or createSupabaseRouteClient().
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Invalidate both L1 and L2 cache for this student's rhythm key.
  // Uses prefix-match so all dayKey variants are busted (handles edge case
  // where POST fires at midnight boundary and GET uses next day's key).
  await cacheInvalidatePrefixAsync(`rhythm:today:${userId}:`);

  return NextResponse.json({ ok: true });
}
