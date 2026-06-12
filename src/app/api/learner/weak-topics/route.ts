/**
 * GET /api/learner/weak-topics — the learner's weak-topic stack.
 *
 * Phase 5 of ADR-001. Returns chapters where mastery is below
 * REVISE_MIN_MASTERY (0.6 by default) AND the learner has at least one
 * attempt on record, sorted weakest-first. Consumed by:
 *
 *   - A future PR's Concept Chain daily-challenge node selector
 *     (personalised picks drawn from this set vs grade-wide).
 *   - A future PR's leaderboard mastery-percentile tab.
 *
 * Reuses the pure weakTopicsForStudent() helper so /api/learner/weak-topics
 * and the (future) compete selector never disagree about which topics
 * are weak.
 *
 * Gating: ff_personalised_compete_v1. When OFF, 404s.
 *
 * Response (200):
 *   { schemaVersion: 1,
 *     resolvedAt: ISO,
 *     items: WeakTopic[]
 *   }
 *
 * Errors:
 *   401 unauthenticated
 *   404 flag off / no profile / no weak topics
 *   500 builder failure
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import {
  weakTopicsForStudent,
  type WeakTopic,
} from '@/lib/state/learner-loop/weak-topics';
import { logger } from '@/lib/logger';
import { cacheFetchAsync, CACHE_TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_personalised_compete_v1';

export interface WeakTopicsResponse {
  schemaVersion: 1;
  resolvedAt: string;
  items: WeakTopic[];
}

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId, role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Phase 5 perf: the state-builder read is the expensive part and fires on
  // dashboard mount alongside the other per-student aggregate calls. Collapse
  // repeat reads within a 30s window with a SERVER-SIDE cache keyed by userId
  // (one student → one auth uid; students NEVER collide — P13: per-student data
  // must never be shared). This is a server cache, NOT a CDN/`s-maxage` header —
  // Vercel's edge does not vary by auth, so a public cache would leak one
  // student's weak topics to another. The 404/200 branching stays OUTSIDE the
  // cache so a transient "no weak topics yet" never pins a misleading payload.
  let items: WeakTopic[];
  try {
    items = await cacheFetchAsync(
      `learner:weak-topics:${userId}`,
      CACHE_TTL.USER,
      async () => {
        const builder = createStudentStateBuilder({ sb: supabase });
        const state = await builder(userId);
        return weakTopicsForStudent(state);
      },
    );
  } catch (err) {
    logger.warn('learner/weak-topics: state builder failed', {
      userId, error: (err as Error).message,
    });
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'no_weak_topics' }, { status: 404 });
  }

  const response: WeakTopicsResponse = {
    schemaVersion: 1,
    resolvedAt: new Date().toISOString(),
    items,
  };

  return NextResponse.json(response, {
    headers: {
      // Mastery shifts after every quiz; keep this cache short so
      // Compete picks reflect recent activity.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  });
}
