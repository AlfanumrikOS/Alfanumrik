/**
 * PATCH /api/student/study-plan
 *
 * Updates study plan task status and syncs plan progress counter.
 * Replaces two direct anon-client writes in study-plan/page.tsx.
 *
 * WHY:
 *   - Task update: no ownership check in client code beyond "task not in local state"
 *     (comment says "RLS enforces ownership" — but RLS on study_plan_tasks must be
 *     verified; we enforce at API layer regardless)
 *   - Plan progress update: study_plans.id came from client state — no server-side
 *     verification that the plan belongs to the authenticated student
 *
 * SECURITY:
 *   - Both writes resolve studentId from auth only
 *   - Task ownership verified: task must belong to a plan owned by the student
 *   - Plan ownership verified: plan.student_id must equal authenticated studentId
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeRequest(request, 'study_plan.write', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { task_id, status } = body;
  const studentId = auth.studentId!;

  if (typeof task_id !== 'string' || !task_id.trim()) return err('task_id required', 400);
  if (typeof status !== 'string' || !['pending', 'in_progress', 'completed', 'skipped'].includes(status)) {
    return err('status must be one of: pending, in_progress, completed, skipped', 400);
  }

  // Verify task ownership: task → plan → student
  const { data: task, error: taskFetchError } = await supabaseAdmin
    .from('study_plan_tasks')
    .select('id, plan_id')
    .eq('id', task_id)
    .single();

  if (taskFetchError || !task) {
    return err('Task not found', 404);
  }

  const { data: plan, error: planFetchError } = await supabaseAdmin
    .from('study_plans')
    .select('id, student_id, total_tasks')
    .eq('id', task.plan_id)
    .single();

  if (planFetchError || !plan) {
    return err('Study plan not found', 404);
  }

  // IDOR: plan must belong to authenticated student
  if (plan.student_id !== studentId) {
    logger.warn('study_plan_idor_attempt', { studentId, planStudentId: plan.student_id, taskId: task_id });
    return err('Task not found', 404); // 404 not 403 — prevents enumeration
  }

  // Update task status
  const updates: Record<string, string> = { status };
  if (status === 'completed') updates.completed_at = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('study_plan_tasks')
    .update(updates)
    .eq('id', task_id);

  if (updateError) {
    logger.error('study_plan_task_update_failed', { error: new Error(updateError.message), studentId, taskId: task_id });
    return err('Failed to update task', 500);
  }

  // Recompute plan progress from DB (not trusting client-computed values)
  const { data: completedTasks, error: countError } = await supabaseAdmin
    .from('study_plan_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', plan.id)
    .eq('status', 'completed');

  if (!countError) {
    const completed = (completedTasks as unknown as { count: number })?.count ?? 0;
    const pct = plan.total_tasks > 0 ? Math.round((completed / plan.total_tasks) * 100) : 0;

    const { error: planUpdateError } = await supabaseAdmin
      .from('study_plans')
      .update({ completed_tasks: completed, progress_percent: pct })
      .eq('id', plan.id);

    if (planUpdateError) {
      // Non-fatal — task was updated; plan progress counter will self-correct on next load
      logger.warn('study_plan_progress_update_failed', { error: new Error(planUpdateError.message), planId: plan.id });
    }

    return NextResponse.json({ success: true, completed_tasks: completed, progress_percent: pct });
  }

  return NextResponse.json({ success: true });
}
