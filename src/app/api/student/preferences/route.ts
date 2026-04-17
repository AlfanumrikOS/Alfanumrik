/**
 * PATCH /api/student/preferences
 *
 * Replaces the three direct client-side DB writes in dashboard/page.tsx:
 *   - supabase.from('students').update({ preferred_subject })
 *   - supabase.from('students').update({ selected_subjects, preferred_subject })
 *   - supabase.from('smart_nudges').update({ is_dismissed: true })
 *
 * WHY this API route instead of direct client writes:
 *   - Direct anon writes bypass authorizeRequest → no audit log, no rate limit
 *   - An attacker with a valid session could PATCH any student_id
 *   - This route enforces: auth → ownership check → write → audit
 *
 * Body shape (one of):
 *   { action: 'set_preferred_subject', subject: string }
 *   { action: 'set_selected_subjects', subjects: string[], preferred_subject: string }
 *   { action: 'dismiss_nudge', nudge_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { validateSubjectWrite } from '@/lib/subjects';

const VALID_ACTIONS = ['set_preferred_subject', 'set_selected_subjects', 'dismiss_nudge'] as const;
type Action = typeof VALID_ACTIONS[number];

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  // Auth — student must be logged in
  const auth = await authorizeRequest(request, 'quiz.attempt', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { action } = body as { action?: Action };
  if (!action || !VALID_ACTIONS.includes(action)) {
    return err(`action must be one of: ${VALID_ACTIONS.join(', ')}`, 400);
  }

  // Resolve the student row that belongs to this auth user
  // (auth.studentId is already the student's UUID from the RBAC layer)
  const studentId = auth.studentId!;

  try {
    switch (action) {
      case 'set_preferred_subject': {
        const subject = body.subject;
        if (typeof subject !== 'string' || !subject.trim()) {
          return err('subject must be a non-empty string', 400);
        }

        // Subject governance: validate against student's allowed subjects
        const validation = await validateSubjectWrite(studentId, subject, { supabase: supabaseAdmin });
        if (!validation.ok) {
          return NextResponse.json(
            {
              error: validation.error.code,
              subject: validation.error.subject,
              reason: validation.error.reason,
              allowed: validation.error.allowed,
            },
            { status: 422 },
          );
        }

        const { error } = await supabaseAdmin
          .from('students')
          .update({ preferred_subject: subject, updated_at: new Date().toISOString() })
          .eq('id', studentId);

        if (error) {
          logger.error('student_preferences_set_subject_failed', {
            error: new Error(error.message),
            studentId,
          });
          return err('Failed to update preferred subject', 500);
        }

        logAudit(auth.userId!, {
          action: 'set_preferred_subject',
          resourceType: 'student',
          resourceId: studentId,
          details: { subject },
        });

        return NextResponse.json({ success: true });
      }

      case 'set_selected_subjects': {
        const subjects = body.subjects;
        const preferred = body.preferred_subject;

        if (!Array.isArray(subjects) || subjects.length === 0) {
          return err('subjects must be a non-empty array', 400);
        }
        if (typeof preferred !== 'string') {
          return err('preferred_subject must be a string', 400);
        }
        if (!subjects.every((s) => typeof s === 'string' && s.trim().length > 0)) {
          return err('subjects must contain only non-empty strings', 400);
        }

        // Subject governance: route through set_student_subjects RPC, which
        // enforces grade/stream/plan/max-subjects rules server-side atomically.
        const { error: rpcError } = await supabaseAdmin.rpc('set_student_subjects', {
          p_student_id: studentId,
          p_subjects: subjects,
          p_preferred: preferred,
        });

        if (rpcError) {
          const msg = rpcError.message || '';
          if (msg.includes('subject_not_allowed')) {
            // Surface the offending subject + allowed set so the UI can
            // correct the selection without a second round-trip.
            return NextResponse.json(
              {
                error: 'subject_not_allowed',
                detail: msg,
              },
              { status: 422 },
            );
          }
          if (msg.includes('max_subjects_exceeded')) {
            return NextResponse.json(
              {
                error: 'max_subjects_exceeded',
                detail: msg,
              },
              { status: 422 },
            );
          }
          if (msg.includes('not_authorized')) {
            return NextResponse.json(
              { error: 'not_authorized', detail: msg },
              { status: 403 },
            );
          }

          logger.error('student_preferences_set_subjects_rpc_failed', {
            error: new Error(msg),
            studentId,
          });
          return err('Failed to update selected subjects', 500);
        }

        logAudit(auth.userId!, {
          action: 'set_selected_subjects',
          resourceType: 'student',
          resourceId: studentId,
          details: { subjects, preferred_subject: preferred },
        });

        return NextResponse.json({ success: true });
      }

      case 'dismiss_nudge': {
        const nudgeId = body.nudge_id;
        if (typeof nudgeId !== 'string' || !nudgeId.trim()) {
          return err('nudge_id must be a non-empty string', 400);
        }

        // Verify nudge belongs to this student before updating
        const { data: nudge, error: fetchErr } = await supabaseAdmin
          .from('smart_nudges')
          .select('id, student_id')
          .eq('id', nudgeId)
          .maybeSingle();

        if (fetchErr || !nudge) {
          return err('Nudge not found', 404);
        }

        if (nudge.student_id !== studentId) {
          // Ownership mismatch — do not reveal that the nudge exists
          logger.warn('student_preferences_nudge_ownership_mismatch', {
            nudgeId,
            claimedStudentId: studentId,
            actualStudentId: nudge.student_id,
          });
          return err('Nudge not found', 404);
        }

        const { error } = await supabaseAdmin
          .from('smart_nudges')
          .update({ is_dismissed: true, updated_at: new Date().toISOString() })
          .eq('id', nudgeId);

        if (error) {
          logger.error('student_preferences_dismiss_nudge_failed', {
            error: new Error(error.message),
            nudgeId,
            studentId,
          });
          return err('Failed to dismiss nudge', 500);
        }

        return NextResponse.json({ success: true });
      }
    }
  } catch (e) {
    logger.error('student_preferences_unhandled', {
      error: e instanceof Error ? e : new Error(String(e)),
      action,
      studentId,
    });
    return err('Internal server error', 500);
  }
}
