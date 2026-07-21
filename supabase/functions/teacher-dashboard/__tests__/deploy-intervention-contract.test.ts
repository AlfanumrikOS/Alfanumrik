// supabase/functions/teacher-dashboard/__tests__/deploy-intervention-contract.test.ts
//
// Deno test runner (NOT Vitest — vitest.config.ts does not include this file).
// Run via:
//   cd supabase/functions/teacher-dashboard && deno test --allow-read
//
// ── Why a static-source contract canary (same strategy as contract.test.ts) ──
// teacher-dashboard/index.ts is a MONOLITHIC Deno.serve() handler with no seam
// to inject a mocked Supabase client (see contract.test.ts's header comment
// for the full rationale). `handleDeployIntervention` cannot be imported and
// invoked in a behavioral test the way apps/host route handlers can, so this
// file pins its SOURCE shape instead.
//
// ── RCA background (Task T3, 2026-07-20) ──────────────────────────────────
// `handleDeployIntervention` previously wrote directly to `assignments` /
// `assignment_submissions` — a third, orphaned remediation-assignment
// pathway that bypassed `teacher_remediation_assignments` (the canonical
// table written by POST /api/teacher/remediation and read by the student
// daily-queue resolver + Loop A's escalation logic) and `adaptive_interventions`
// (Loop A-D). This canary pins the fix: the handler must write to the
// canonical table, respect the same DB dedupe backstop used by the teacher
// route (uq_teacher_remediation_assignments_open_dedupe, 23505 ==
// idempotent-success), and must NOT write to `assignments` /
// `assignment_submissions` at all.
//
// Companion Vitest coverage for the canonical table's shape/dedupe contract:
// apps/host/src/__tests__/api/teacher/remediation/route.test.ts (the resolver
// join itself is exercised by the daily-rhythm / today-resolver test suite,
// which reads teacher_remediation_assignments the same way regardless of
// which caller wrote the row).

import { assert, assertFalse } from 'https://deno.land/std@0.210.0/assert/mod.ts';

const INDEX_PATH = new URL('../index.ts', import.meta.url);
const SRC: string = Deno.readTextFileSync(INDEX_PATH);

// Scope all checks to the handler body only — a global-file check would be
// a false negative/positive if some OTHER handler (grade book, submissions,
// etc.) legitimately touches `assignments` / `assignment_submissions`.
const FN_START = SRC.indexOf('async function handleDeployIntervention(');
const FN_END = SRC.indexOf('\n// ─── JWT Binding', FN_START);
assert(FN_START > 0, 'expected to find handleDeployIntervention in index.ts');
assert(FN_END > FN_START, 'expected to find the next section marker after handleDeployIntervention');
const HANDLER_BODY = SRC.slice(FN_START, FN_END);

Deno.test('deploy_intervention: handler exists and is bounded correctly for scoped checks', () => {
  assert(HANDLER_BODY.includes('handleDeployIntervention'), 'sanity: slice contains the function name');
  assert(HANDLER_BODY.length > 200, 'sanity: slice is non-trivial');
});

Deno.test('deploy_intervention: writes to the canonical teacher_remediation_assignments table', () => {
  assert(
    HANDLER_BODY.includes("from('teacher_remediation_assignments')"),
    'expected an insert/select against teacher_remediation_assignments inside handleDeployIntervention',
  );
  assert(
    /\.from\(['"]teacher_remediation_assignments['"]\)[\s\S]{0,200}?\.insert\(\s*\{[\s\S]{0,300}?status:\s*['"]assigned['"]/.test(
      HANDLER_BODY,
    ),
    'expected an insert with status: "assigned" into teacher_remediation_assignments',
  );
  // Canonical identity shape (matches the migration + the teacher route):
  // internal teacher_id / student_id, class_id, chapter_id = topic_id.
  assert(/teacher_id:\s*teacherId/.test(HANDLER_BODY), 'expected teacher_id: teacherId in the insert payload');
  assert(/student_id:\s*studentId/.test(HANDLER_BODY), 'expected student_id: studentId in the insert payload');
  assert(/class_id:\s*classId/.test(HANDLER_BODY), 'expected class_id: classId in the insert payload');
  assert(/chapter_id:\s*topicId/.test(HANDLER_BODY), 'expected chapter_id: topicId in the insert payload');
});

Deno.test('deploy_intervention: no direct writes to assignments / assignment_submissions', () => {
  assertFalse(
    HANDLER_BODY.includes("from('assignments')"),
    'handleDeployIntervention must not write to the orphaned `assignments` table anymore',
  );
  assertFalse(
    HANDLER_BODY.includes("from('assignment_submissions')"),
    'handleDeployIntervention must not write to the orphaned `assignment_submissions` table anymore',
  );
  assertFalse(
    HANDLER_BODY.includes('question_count'),
    'the hardcoded 5|10 question_count fields belonged to the orphaned assignments write path',
  );
});

Deno.test('deploy_intervention: respects the same 23505 dedupe backstop as /api/teacher/remediation', () => {
  assert(
    HANDLER_BODY.includes('uq_teacher_remediation_assignments_open_dedupe'),
    'expected the named DB dedupe index to be checked in the 23505 handling',
  );
  assert(
    /insErr\.code\s*===\s*['"]23505['"]/.test(HANDLER_BODY),
    'expected an explicit 23505 code check before treating the insert conflict as idempotent-success',
  );
  // Pre-check against OPEN statuses (assigned | in_progress), matching the
  // teacher route's idempotency pre-check.
  assert(
    /\.in\(\s*['"]status['"]\s*,\s*OPEN_STATUSES\s*\)/.test(HANDLER_BODY),
    'expected an OPEN-status (assigned|in_progress) idempotency pre-check before inserting',
  );
});

Deno.test('deploy_intervention: still enforces the roster ownership gate before any write', () => {
  const ownsIdx = HANDLER_BODY.indexOf('assertTeacherOwnsClass(supabase, teacherId, classId)');
  const insertIdx = HANDLER_BODY.indexOf(".from('teacher_remediation_assignments')\n");
  assert(ownsIdx > 0, 'expected assertTeacherOwnsClass to still gate this handler (P8)');
  // At least one teacher_remediation_assignments reference must come after the
  // ownership check — the ownership 403 return precedes any DB write.
  assert(
    HANDLER_BODY.indexOf("errorResponse('Unauthorized access to class interventions', 403", ) > 0,
    'expected the 403 unauthorized-class-access guard to remain intact',
  );
  assert(ownsIdx < HANDLER_BODY.lastIndexOf('teacher_remediation_assignments'), 'ownership check must precede the writes');
  void insertIdx;
});

Deno.test('deploy_intervention: action remains registered 1:1 with actions.ts (no silent divergence)', async () => {
  const { teacherDashboardActionNames } = await import('../actions.ts');
  assert(
    teacherDashboardActionNames.includes('deploy_intervention'),
    'deploy_intervention should still be a declared action (this canary fixes the write path, it does not remove the action)',
  );
  assert(
    SRC.includes("case 'deploy_intervention':"),
    'expected the dispatcher switch to still route this action to handleDeployIntervention',
  );
});
