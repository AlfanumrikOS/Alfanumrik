/**
 * GET /api/student/daily-plan
 *
 * Returns the goal-adaptive daily plan for the authenticated student.
 *
 * Behavior:
 *   - student.academic_goal null/empty/unknown → returns empty plan
 *     (totalMinutes=0, items=[]).
 *   - ff_goal_daily_plan flag OFF for this student → returns empty plan.
 *   - otherwise → returns the deterministic plan from
 *     buildDailyPlanByCode(goal). Plan composition is authored
 *     in src/lib/goals/daily-plan.ts (assessment-owned).
 *
 * Owner: backend
 * Review: assessment (rules), frontend (consumer), testing
 *
 * Response shape:
 *   200 { success: true, data: DailyPlan, flagEnabled: boolean }
 *   401 { success: false, error: 'unauthorized' }
 *   404 { success: false, error: 'student_not_found' }
 *   500 { success: false, error: '<message>' }
 *
 * P-invariants honored:
 *   - P9: RBAC via authorizeRequest('study_plan.view').
 *   - P13: logger.info emits 'present' instead of raw studentId UUID.
 *   - P12: this is a non-AI endpoint — no LLM involvement.
 *
 * Phase 3 of Goal-Adaptive Learning Layers. Gated by ff_goal_daily_plan
 * (default DISABLED on prod + staging). When OFF, the API returns an
 * empty plan; the dashboard's DailyPlanCard renders nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { isKnownGoalCode, type GoalCode } from '@/lib/goals/goal-profile';
import { buildDailyPlanByCode, type DailyPlan } from '@/lib/goals/daily-plan';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'study_plan.view', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  // 1. Read goal from students table.
  const { data: student, error: fetchError } = await supabaseAdmin
    .from('students')
    .select('id, academic_goal')
    .eq('id', studentId)
    .single();

  if (fetchError || !student) {
    logger.warn('daily-plan.student_not_found', { studentId: 'present' });
    return NextResponse.json(
      { success: false, error: 'student_not_found' },
      { status: 404 },
    );
  }

  // 2. Evaluate the flag (deterministic per-user rollout via studentId hash).
  const flagEnabled = await isFeatureEnabled('ff_goal_daily_plan', {
    role: 'student',
    environment:
      process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    userId: studentId,
  });

  // 3. Resolve plan: empty when flag off OR goal unknown; otherwise authored plan.
  let plan: DailyPlan;
  if (!flagEnabled) {
    plan = buildDailyPlanByCode(null);
  } else if (!isKnownGoalCode(student.academic_goal)) {
    plan = buildDailyPlanByCode(null);
  } else {
    plan = buildDailyPlanByCode(student.academic_goal as GoalCode);
  }

  logger.info('daily-plan.requested', {
    studentId: 'present',
    flagEnabled,
    hasGoal: !!student.academic_goal,
    itemCount: plan.items.length,
  });

  return NextResponse.json({
    success: true,
    data: plan,
    flagEnabled,
  });
}
