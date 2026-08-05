/**
 * /api/learner/preferences — explicit "How Foxy explains" preferences writer
 * (D9/E, Foxy North-Star Phase 2 wave 2b).
 *
 * PATCH { learningStyle?, preferredExplanationDepth? }  (camelCase — the FIXED
 * contract the settings page is already built against; at least one key).
 *   Auth: authorizeRequest(request, 'memory.view_own', { requireStudentId: true })
 *   — self-scope only: the studentId comes from RBAC resolution, never the
 *   client. `memory.view_own` is the granted student permission for the
 *   learner-memory surface this writes the advisory hints of (no new
 *   permission code — role/permission additions need user approval).
 *
 *   Enum whitelists (zod, 400 on anything else):
 *     learningStyle              visual | verbal | example-first | balanced
 *     preferredExplanationDepth  quick | medium | deep
 *
 *   Write path: RLS-SCOPED update (P8 — no supabase-admin here) of the
 *   student's NEWEST student_learning_profiles row — the same deterministic
 *   newest-row pick loadStudentPreferences uses for reads (order updated_at
 *   desc, id desc, limit 1), so the row written is exactly the row Foxy will
 *   read back. The `learning_profiles_own` policy (baseline) scopes both the
 *   select and the update to the caller's own student row.
 *   NOTE: profiles are per (student, subject); writing the newest row keeps
 *   write/read symmetric today. If a later quiz creates a NEWER row for a
 *   different subject it starts from column defaults — the D9 implicit
 *   writer may then adjust it, but only because that new row carries
 *   preferences_set_by_user = false; this row stays protected.
 *
 *   Sets preferences_set_by_user = true (migration 20260808000200): the
 *   explicit-wins guard — the flag-gated implicit preference writer
 *   (daily-cron `preference_writer`, ff_preference_writer_v1) must never
 *   overwrite an explicit student choice.
 *
 *   Ships UNGATED: this is a user-initiated explicit action, not the
 *   implicit writer the flag governs.
 *
 * Advisory hints only (spec §1.5): these shape HOW Foxy explains — never
 * what it asserts about mastery. No XP, no scoring, no learner-state write.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

const LEARNING_STYLES = ['visual', 'verbal', 'example-first', 'balanced'] as const;
const EXPLANATION_DEPTHS = ['quick', 'medium', 'deep'] as const;

const PatchBodySchema = z
  .object({
    learningStyle: z.enum(LEARNING_STYLES).optional(),
    preferredExplanationDepth: z.enum(EXPLANATION_DEPTHS).optional(),
  })
  .strict()
  .refine(
    (b) => b.learningStyle !== undefined || b.preferredExplanationDepth !== undefined,
    { message: 'Provide learningStyle and/or preferredExplanationDepth' },
  );

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * RLS-scoped client for the caller (P8): Bearer-token-bound when the request
 * carries an Authorization header (mobile / API callers), else the cookie
 * session client (web). Never the service-role admin client.
 */
async function rlsClientFor(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }
  return createSupabaseServerClient();
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeRequest(request, 'memory.view_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  const studentId = auth.studentId!;

  let body: z.infer<typeof PatchBodySchema>;
  try {
    body = PatchBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const sb = await rlsClientFor(request);

  // Newest-row pick — MIRRORS loadStudentPreferences' deterministic read
  // (updated_at desc, id desc, limit 1) so write and read hit the same row.
  const { data: row, error: pickErr } = await sb
    .from('student_learning_profiles')
    .select('id')
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pickErr) {
    logger.error('learner_preferences_row_pick_failed', {
      error: new Error(pickErr.message),
      route: 'learner/preferences',
    });
    return err('Failed to load learning profile', 500);
  }
  if (!row) {
    // No profile row yet (pre-first-quiz). Nothing to anchor the preference
    // to — the settings page rolls back and keeps its defaults.
    return err('No learning profile yet — complete a quiz first', 404);
  }

  const update: Record<string, string | boolean> = { preferences_set_by_user: true };
  if (body.learningStyle !== undefined) update.learning_style = body.learningStyle;
  if (body.preferredExplanationDepth !== undefined) {
    update.preferred_explanation_depth = body.preferredExplanationDepth;
  }

  const { error: updErr } = await sb
    .from('student_learning_profiles')
    .update(update)
    .eq('id', (row as { id: string }).id)
    .eq('student_id', studentId); // belt-and-braces on top of RLS
  if (updErr) {
    logger.error('learner_preferences_update_failed', {
      error: new Error(updErr.message),
      route: 'learner/preferences',
    });
    return err('Failed to save preferences', 500);
  }

  // Audit — metadata only (P13): which fields changed, never free text.
  try {
    await logAudit(auth.userId!, {
      action: 'learner.preferences_updated',
      resourceType: 'student_learning_profiles',
      resourceId: (row as { id: string }).id,
      details: {
        set_learning_style: body.learningStyle ?? null,
        set_preferred_explanation_depth: body.preferredExplanationDepth ?? null,
        explicit: true,
      },
      status: 'success',
    });
  } catch {
    /* audit failures must never break the request */
  }

  return NextResponse.json({
    success: true,
    data: {
      learningStyle: body.learningStyle ?? null,
      preferredExplanationDepth: body.preferredExplanationDepth ?? null,
      preferencesSetByUser: true,
    },
  });
}
