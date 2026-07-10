import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../../../eval/tenant-isolation/run';
import { audit, type RouteFinding, type Bucket } from '../../../scripts/audit-tenant-isolation';

/**
 * Unit test for the tenant_isolation L5 evaluator's verdict logic.
 *
 * We don't exercise the underlying static audit here — that's a heuristic
 * tested by its own usage in scripts/. This test pins down the bridge:
 * given (current findings) + (baseline), do we emit the right verdict?
 *
 * Severity order being tested: SAFE < REVIEW < NO_TENANT_SCOPING < NO_AUTH.
 * tenant_isolation is ALWAYS blocking (rubric R3.4) — we assert that too.
 */

const makeFinding = (
  routePath: string,
  bucket: Bucket,
): RouteFinding => ({
  routePath,
  filePath: `/fake${routePath}/route.ts`,
  methods: ['GET'],
  bucket,
  hasAuth: bucket !== 'NO_AUTH',
  hasTenantScoping: bucket === 'SAFE',
  isPublicByDesign: false,
  autoLabel: null,
  authMatches: [],
  tenantMatches: [],
  reason: 'test fixture',
});

const baseline = (entries: Array<[string, Bucket]>): Map<string, Bucket> =>
  new Map(entries);

describe('tenant_isolation evaluator — computeVerdict', () => {
  it('audits the current host API route surface', async () => {
    const findings = await audit();
    expect(findings.length).toBeGreaterThan(300);
    expect(findings.some((finding) => finding.routePath === '/api/public/v1/students')).toBe(true);
  });

  it('classifies internal cron routes with CRON_SECRET auth as system-safe', async () => {
    const findings = await audit();
    const smoke = findings.find((finding) => finding.routePath === '/api/internal/cron/job-health-smoke');
    expect(smoke).toMatchObject({
      bucket: 'SAFE',
      autoLabel: 'SYSTEM (cron)',
    });
  });

  it('passes when nothing changed against the baseline', () => {
    const current = [makeFinding('/api/a', 'SAFE'), makeFinding('/api/b', 'REVIEW')];
    const v = computeVerdict(
      current,
      baseline([['/api/a', 'SAFE'], ['/api/b', 'REVIEW']]),
      null,
      null,
    );
    expect(v.verdict).toBe('pass');
    expect(v.blocking).toBe(true);
    expect(v.evidence.regressions).toHaveLength(0);
  });

  it('fails when a new route lands in NO_AUTH', () => {
    const current = [makeFinding('/api/leaky', 'NO_AUTH')];
    const v = computeVerdict(current, baseline([]), null, null);
    expect(v.verdict).toBe('fail');
    expect(v.evidence.regressions).toHaveLength(1);
    expect(v.evidence.regressions[0]).toMatchObject({
      routePath: '/api/leaky',
      baseline_bucket: 'ABSENT',
      current_bucket: 'NO_AUTH',
    });
  });

  it('warns when a new route lands in REVIEW (non-blocking)', () => {
    const current = [makeFinding('/api/maybe', 'REVIEW')];
    const v = computeVerdict(current, baseline([]), null, null);
    expect(v.verdict).toBe('warn');
    expect(v.evidence.regressions).toHaveLength(1);
    // Still always blocking=true at the contract level — only the verdict is
    // softer. The Critic decides what to do with a warn.
    expect(v.blocking).toBe(true);
  });

  it('fails when an existing route regresses from REVIEW to NO_AUTH', () => {
    const current = [makeFinding('/api/legacy', 'NO_AUTH')];
    const v = computeVerdict(current, baseline([['/api/legacy', 'REVIEW']]), null, null);
    expect(v.verdict).toBe('fail');
    expect(v.evidence.regressions[0].reason).toMatch(/Severity increased/);
  });

  it('passes when a route improves (REVIEW → SAFE) and surfaces it', () => {
    const current = [makeFinding('/api/cleaned', 'SAFE')];
    const v = computeVerdict(current, baseline([['/api/cleaned', 'REVIEW']]), null, null);
    expect(v.verdict).toBe('pass');
    expect(v.evidence.new_safe_routes).toContain('/api/cleaned');
  });

  it('does not flag REVIEW→REVIEW or SAFE→SAFE as a regression', () => {
    const current = [makeFinding('/api/x', 'REVIEW'), makeFinding('/api/y', 'SAFE')];
    const v = computeVerdict(
      current,
      baseline([['/api/x', 'REVIEW'], ['/api/y', 'SAFE']]),
      null,
      null,
    );
    expect(v.verdict).toBe('pass');
  });

  it('treats NO_TENANT_SCOPING as blocking just like NO_AUTH', () => {
    const current = [makeFinding('/api/unscoped', 'NO_TENANT_SCOPING')];
    const v = computeVerdict(current, baseline([]), null, null);
    expect(v.verdict).toBe('fail');
  });

  it('echoes task_id and cycle_id back into the verdict for mesh writes', () => {
    const current = [makeFinding('/api/a', 'SAFE')];
    const v = computeVerdict(
      current,
      baseline([['/api/a', 'SAFE']]),
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );
    expect(v.task_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(v.cycle_id).toBe('22222222-2222-2222-2222-222222222222');
    expect(v.evaluator).toBe('tenant_isolation');
  });

  it('reports multiple regressions in one pass', () => {
    const current = [
      makeFinding('/api/one', 'NO_AUTH'),
      makeFinding('/api/two', 'NO_TENANT_SCOPING'),
      makeFinding('/api/three', 'REVIEW'),
    ];
    const v = computeVerdict(current, baseline([]), null, null);
    expect(v.verdict).toBe('fail');
    expect(v.evidence.regressions).toHaveLength(3);
    // The two blocking ones drive the fail verdict; the REVIEW one is also
    // listed but wouldn't have failed on its own.
    const blocking = v.evidence.regressions.filter(
      r => r.current_bucket === 'NO_AUTH' || r.current_bucket === 'NO_TENANT_SCOPING',
    );
    expect(blocking).toHaveLength(2);
  });
});
