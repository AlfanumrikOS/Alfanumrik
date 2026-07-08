import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const engineSource = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/ncert-question-engine/index.ts'),
  'utf8',
);
const migrationSource = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260620001200_ncert_question_engine_security_policy.sql'),
  'utf8',
);

describe('ncert-question-engine Platform Security Layer rollout', () => {
  it('uses the shared security admission, quota, audit, CORS, and circuit primitives', () => {
    for (const token of [
      'resolveSecurityPrincipal',
      'resolveRoutePolicy',
      'reserveQuota',
      'settleQuota',
      'writeSecurityAudit',
      'recordCircuitOutcome',
      'securityCorsHeaders',
      'securityErrorResponse',
      'computeEstimatedCost',
    ]) {
      expect(engineSource).toContain(token);
    }
  });

  it('authorizes non-student callers against the requested student school or guardian link', () => {
    expect(engineSource).toContain('resolveAuthorizedStudentId');
    expect(engineSource).toContain("principal.role === 'parent'");
    expect(engineSource).toContain('guardian_student_links');
    expect(engineSource).toContain(".eq('students.school_id', principal.schoolId)");
    expect(engineSource).toContain("principal.role === 'teacher' || principal.role === 'school_admin'");
    expect(engineSource).toContain(".eq('school_id', principal.schoolId)");
  });

  it('installs independent route policies and quota profiles by role', () => {
    for (const profile of [
      'ncert-question-engine-student',
      'ncert-question-engine-parent',
      'ncert-question-engine-teacher',
      'ncert-question-engine-school-admin',
      'ncert-question-engine-internal-service',
    ]) {
      expect(migrationSource).toContain(profile);
    }

    expect(migrationSource).toContain("VALUES ('student'), ('parent'), ('teacher'), ('school_admin')");
    expect(migrationSource).toContain('security_route_policies');
    expect(migrationSource).toContain('school_id + user_id + role');
    expect(migrationSource).toContain('school_id + route');
  });
});
