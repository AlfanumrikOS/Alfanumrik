import { describe, it, expect } from 'vitest';
import { shouldDeploy, buildPrBody } from '../../../../agents/runtime/layers/l7-deploy';
import type { L7DeployInputs } from '../../../../agents/runtime/layers/l7-deploy';

/**
 * L7 deploy — pure-logic tests.
 *
 * We don't shell out to git/gh here. We pin the two pure helpers:
 *   - shouldDeploy: only `approve` + non-empty diff triggers push
 *   - buildPrBody: PR body has the audit trail in the right shape
 */

describe('shouldDeploy', () => {
  it('fires on approve + non-empty diff', () => {
    expect(shouldDeploy({ decision: 'approve', filesChanged: 3 })).toMatchObject({ go: true });
  });

  it('skips on request_changes', () => {
    expect(shouldDeploy({ decision: 'request_changes', filesChanged: 5 }).go).toBe(false);
  });

  it('skips on reject', () => {
    expect(shouldDeploy({ decision: 'reject', filesChanged: 5 }).go).toBe(false);
  });

  it('skips on escalate_to_human', () => {
    expect(shouldDeploy({ decision: 'escalate_to_human', filesChanged: 5 }).go).toBe(false);
  });

  it('skips on approve with empty diff (no PR spam)', () => {
    const r = shouldDeploy({ decision: 'approve', filesChanged: 0 });
    expect(r.go).toBe(false);
    expect(r.reason).toMatch(/empty diff/i);
  });
});

const baseInputs: L7DeployInputs = {
  worktree: {
    root: '/tmp/wt',
    branch: 'auto/abcd1234/code_agent/efgh5678',
    baseline: 'main',
    repoRoot: '/tmp/repo',
  },
  cycleId: '11111111-1111-1111-1111-111111111111',
  taskId: '22222222-2222-2222-2222-222222222222',
  goalText: 'Add a "last seen" badge to teacher avatar row',
  l4Summary: 'What I changed:\n- src/components/teacher/AvatarRow.tsx: added badge',
  l4FilesChanged: [{ path: 'src/components/teacher/AvatarRow.tsx', change: 'modified' }],
  l5Verdicts: [
    { evaluator: 'tenant_isolation', verdict: 'pass', blocking: true },
    { evaluator: 'unit_tests', verdict: 'pass', blocking: false },
  ],
  l6Decision: 'approve',
  l6Reasoning: 'DECISION: approve\n\nReasoning paragraph.',
  rubricVersion: 'v1.0.0',
  tokensSpent: 15234,
};

describe('buildPrBody', () => {
  it('includes the audit trail fields a reviewer needs', () => {
    const body = buildPrBody(baseInputs);
    expect(body).toContain(baseInputs.cycleId);
    expect(body).toContain(baseInputs.taskId);
    expect(body).toContain(baseInputs.goalText);
    expect(body).toContain(baseInputs.l4Summary);
    expect(body).toContain('tenant_isolation');
    expect(body.toLowerCase()).toContain('rubric version');
    expect(body).toContain('v1.0.0');
    expect(body).toContain('15234');
  });

  it('marks blocking evaluators distinctly from non-blocking', () => {
    const body = buildPrBody(baseInputs);
    // tenant_isolation is blocking → '(blocking)' tag
    expect(body).toMatch(/tenant_isolation.*\(blocking\)/);
    // unit_tests is non-blocking → no '(blocking)' tag on its line
    const unitTestsLine = body.split('\n').find(l => l.includes('unit_tests'));
    expect(unitTestsLine).toBeDefined();
    expect(unitTestsLine).not.toMatch(/\(blocking\)/);
  });

  it('includes the mesh-cron tag for reviewer filtering', () => {
    expect(buildPrBody(baseInputs)).toContain('[mesh-cron]');
  });

  it('truncates very long critic reasoning to keep the PR body sane', () => {
    const longReasoning = 'x'.repeat(8000);
    const body = buildPrBody({ ...baseInputs, l6Reasoning: longReasoning });
    expect(body.length).toBeLessThan(12_000);
    expect(body).toContain('critic reasoning truncated');
  });

  it('handles empty files_changed gracefully (defensive — shouldDeploy guards but body must not crash)', () => {
    const body = buildPrBody({ ...baseInputs, l4FilesChanged: [] });
    expect(body).toContain('_(none)_');
  });
});
