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
import { createSupabaseRouteClient } from '@/lib/supabase-route';
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

  // XC-3 Phase 2 (batch 3 — Bearer batch): reads run through the Bearer-AWARE,
  // RLS-respecting route client, NOT the RLS-bypassing service-role admin client.
  // daily-plan has a mobile Bearer caller (mobile/lib/data/repositories/
  // daily_plan_repository.dart sends `Authorization: Bearer <jwt>` and NO cookie),
  // so the cookie-only createSupabaseServerClient() would NULL auth.uid() and RLS
  // would deny every read → empty/404 for mobile. createSupabaseRouteClient()
  // forwards the caller's JWT under the anon key (RLS enforced, never service-role)
  // on the Bearer path and falls back to the cookie client for web. Every read
  // below is a student-OWN row (or a public catalog) admitted by an existing
  // SELECT policy (studentId is ALWAYS auth.studentId — the caller's own id):
  //   - students                : students_select_merged owner branch
  //                               (auth_user_id = auth.uid()).
  //   - class_students          : "Students can view own enrollment"
  //                               (student_id ∈ students WHERE auth_user_id = auth.uid()).
  //   - classroom_lesson_plans  : "Students can view classroom lesson plans"
  //                               (class_id ∈ the caller's own class_students rows).
  //   - curriculum_topics       : topics_read_all (USING true — public catalog),
  //                               read via the embedded curriculum_topics(id,title).
  // RLS is therefore a real second line of defense behind authorizeRequest. The
  // students+class_students nested-read recursion incident is FIXED (migration
  // 20260702080000 + Phase 1). Fail-CLOSED: an RLS deny on the students read
  // yields student=null → 404 'student_not_found' (no payload, no 500). See
  // docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md §4.
  const supabase = await createSupabaseRouteClient(request);

  // 1. Read goal and class_id from students table.
  const { data: student, error: fetchError } = await supabase
    .from('students')
    .select('id, academic_goal, class_id')
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

  // 3. Resolve plan: check if there's a classroom lesson plan for today
  let plan: DailyPlan = buildDailyPlanByCode(null);
  let intercepted = false;

  if (flagEnabled) {
    // Resolve student's class_id
    let classId: string | null = student.class_id || null;

    if (!classId) {
      const { data: cs } = await supabase
        .from('class_students')
        .select('class_id')
        .eq('student_id', studentId)
        .eq('is_active', true)
        .maybeSingle();
      if (cs) {
        classId = cs.class_id;
      }
    }

    if (classId) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: lessonPlan } = await supabase
        .from('classroom_lesson_plans')
        .select('topic_id, curriculum_topics(id, title)')
        .eq('class_id', classId)
        .eq('date', todayStr)
        .maybeSingle();

      if (lessonPlan) {
        const topicTitle = (lessonPlan as any).curriculum_topics?.title || "Today's Topic";
        const topicId = lessonPlan.topic_id;
        plan = {
          goal: student.academic_goal as GoalCode,
          totalMinutes: 18,
          items: [
            {
              kind: 'concept',
              titleEn: `Classroom Sync: Concept walkthrough on "${topicTitle}"`,
              titleHi: `कक्षा सिंक: "${topicTitle}" पर अवधारणा वॉकथ्रू`,
              estimatedMinutes: 8,
              rationale: `classroom_sync: topic=${topicId}, class_id=${classId}, goal=${student.academic_goal || 'none'}`
            },
            {
              kind: 'practice',
              titleEn: `Classroom Sync: Targeted practice on "${topicTitle}"`,
              titleHi: `कक्षा सिंक: "${topicTitle}" पर लक्षित अभ्यास`,
              estimatedMinutes: 10,
              rationale: `classroom_sync: topic=${topicId}, class_id=${classId}, goal=${student.academic_goal || 'none'}`
            }
          ],
          generatedAt: new Date().toISOString()
        };
        intercepted = true;
      }
    }
  }

  if (!intercepted) {
    if (!flagEnabled) {
      plan = buildDailyPlanByCode(null);
    } else if (!isKnownGoalCode(student.academic_goal)) {
      plan = buildDailyPlanByCode(null);
    } else {
      plan = buildDailyPlanByCode(student.academic_goal as GoalCode);
    }
  }

  logger.info('daily-plan.requested', {
    studentId: 'present',
    flagEnabled,
    hasGoal: !!student.academic_goal,
    intercepted,
    itemCount: plan.items.length,
  });

  return NextResponse.json({
    success: true,
    data: plan,
    flagEnabled,
    intercepted,
  });
}
