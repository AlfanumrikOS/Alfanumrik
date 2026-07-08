/**
 * POST /api/super-admin/projectors/replay — re-invoke ONE subscriber over the
 * state-event bus for ONE student.
 *
 * Why this endpoint exists:
 *   When a projection (e.g. mastery_state) drifts or a subscriber is patched
 *   to fix a bug, ops need a surgical way to rebuild a single student's
 *   projection without replaying the whole bus. The dispatcher's
 *   `replayForStudent` does the work; this endpoint is the admin-gated
 *   trigger surface.
 *
 * Contract:
 *   Body: { subscriberName: string (1-100), studentId: string (>=1) }
 *   Auth: authorizeAdmin (session + admin_users row).
 *   200  → { replayed, errors }            // normal completion
 *   400  → bad body
 *   401  → not admin (helper's response)
 *   404  → { error: 'unknown_subscriber' } // dispatcher threw "unknown subscriber: …"
 *   422  → { error: 'not_student_scoped' } // subscriber lacks studentIdFromEvent
 *   500  → { error: 'replay_failed', detail: '…' }
 *
 * Idempotency: the dispatcher does NOT mutate subscriber_offsets. Replay is
 * a read-side rebuild — re-running yields the same projection (subscriber
 * idempotency is the contract).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { standardDispatcher } from '@alfanumrik/lib/state/subscribers/dispatcher';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  subscriberName: z.string().min(1).max(100),
  studentId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = bodySchema.safeParse(parsedBody);
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Invalid body', detail: validation.error.flatten() },
      { status: 400 },
    );
  }
  const { subscriberName, studentId } = validation.data;

  logger.info('projector_replay_invoked', {
    admin_user_id: auth.userId,
    subscriber: subscriberName,
    student_id: studentId,
  });

  try {
    const result = await standardDispatcher.replayForStudent(subscriberName, studentId, {
      sb: supabaseAdmin,
      dryRun: false,
      now: () => new Date(),
      log: (line) => {
        logger.info('projector_replay_subscriber_log', {
          subscriber: line.subscriber,
          eventId: line.eventId,
          eventKind: line.eventKind,
          outcome: line.outcome,
          message: line.message,
        });
      },
    });

    if (result.refused === 'not_student_scoped') {
      return NextResponse.json({ error: 'not_student_scoped' }, { status: 422 });
    }

    return NextResponse.json(
      { replayed: result.replayed ?? 0, errors: result.errors ?? [] },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unknown subscriber')) {
      return NextResponse.json({ error: 'unknown_subscriber' }, { status: 404 });
    }
    logger.error('projector_replay_failed', {
      error: err instanceof Error ? err : new Error(message),
      subscriber: subscriberName,
      student_id: studentId,
    });
    return NextResponse.json(
      { error: 'replay_failed', detail: message },
      { status: 500 },
    );
  }
}
