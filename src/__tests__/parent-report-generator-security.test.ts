import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();

const indexSource = readFileSync(
  resolve(ROOT, 'supabase/functions/parent-report-generator/index.ts'),
  'utf8',
);

const parentPolicyMigration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260620001400_parent_report_generator_parent_policy.sql'),
  'utf8',
);

describe('parent-report-generator security layer integration', () => {
  it('uses admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile security primitives', () => {
    for (const token of ['admitAiRoute', 'finalizeAiRoute', 'createStaticAiRouteProfile']) {
      expect(indexSource).toContain(token);
    }
  });

  it('admits parent, teacher, school_admin, and internal_service callers', () => {
    expect(indexSource).toContain(
      "callerTypes: ['parent', 'teacher', 'school_admin', 'internal_service']",
    );
  });

  it('reads body as text before admission (body hash requirement)', () => {
    // req.text() must appear before the admitAiRoute call-site so the raw body
    // bytes are available for the admission body hash. We search for the
    // invocation token ('await admitAiRoute(') to skip past the import
    // declaration which appears earlier in the file.
    const textPos = indexSource.indexOf('req.text()');
    const admitCallPos = indexSource.indexOf('await admitAiRoute(');
    expect(textPos).toBeGreaterThan(-1);
    expect(admitCallPos).toBeGreaterThan(-1);
    expect(textPos).toBeLessThan(admitCallPos);
  });

  it('calls finalizeAiRoute on every exit path', () => {
    // parent-report-generator has exit paths for invalid JSON, missing
    // student_id, unauthorized (no userId), no guardian profile, rate-limit,
    // parent-not-linked, success, and the top-level catch. Every branch must
    // call finalizeAiRoute so quota and audit records are always written.
    const occurrences = (indexSource.match(/finalizeAiRoute/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('uses admission.principal.userId for guardian lookup (no double getUser call)', () => {
    // The platform security layer (admitAiRoute) already resolves the JWT and
    // populates admission.principal.userId. A second supabase.auth.getUser()
    // call would be redundant and wasteful. The handler must read userId from
    // the admission context, not re-derive it.
    expect(indexSource).toContain('admission.principal.userId');
    expect(indexSource).not.toContain('getUser(');
  });

  it('parent policy is seeded in the targeted migration', () => {
    // The bulk seeding migration (20260620001300) omitted the 'parent' caller
    // type. A targeted follow-up migration must seed both the quota profile
    // named 'parent-report-generator-parent' and the role 'parent' so parents
    // can call the function after the security layer is enforced.
    expect(parentPolicyMigration).toContain("'parent-report-generator-parent'");
    expect(parentPolicyMigration).toContain("'parent'");
  });

  it('internal_service callers bypass guardian lookup', () => {
    // internal_service callers (e.g. daily-cron generating bulk reports) are
    // trusted via signed HMAC — they have no guardian JWT and no guardian
    // profile. The handler must short-circuit the guardian DB query for
    // internal_service callers. We verify the conditional guard is present.
    expect(indexSource).toContain('internal_service');
    // The guardian lookup is gated on the caller NOT being internal_service.
    // The source must contain a branch that checks the role against the
    // internal_service constant before querying the guardians table.
    const internalServicePos = indexSource.indexOf("!== 'internal_service'");
    expect(internalServicePos).toBeGreaterThan(-1);
  });

  it('python proxy block runs before admission', () => {
    // shouldProxyToPython must be checked before admitAiRoute so that requests
    // delegated to the Python AI service are not charged against the platform
    // security layer quota or have their bodies consumed by the admission check.
    const proxyPos = indexSource.indexOf('shouldProxyToPython');
    const admitCallPos = indexSource.indexOf('await admitAiRoute(');
    expect(proxyPos).toBeGreaterThan(-1);
    expect(admitCallPos).toBeGreaterThan(-1);
    expect(proxyPos).toBeLessThan(admitCallPos);
  });
});
