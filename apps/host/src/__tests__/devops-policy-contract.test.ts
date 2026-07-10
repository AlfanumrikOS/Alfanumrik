import { describe, expect, it } from 'vitest';
import { buildReleaseGatePlan } from '../../../../scripts/product-readiness-release-gate';
import {
  buildDevopsPolicyChecks,
  runDevopsPolicyChecks,
} from '../../../../scripts/verify-devops-policy-contract';

describe('DevOps deployment policy contract', () => {
  it('is part of the repo-owned product readiness release gate', () => {
    const plan = buildReleaseGatePlan();
    const gate = plan.repoSteps.find((step) => step.id === 'devops-policy-contract');

    expect(gate).toBeDefined();
    expect(gate?.owner).toBe('repo');
    expect(gate?.command).toBe('npx tsx scripts/verify-devops-policy-contract.ts');
    expect(gate?.rcaItems).toEqual(['RCA-20']);
  });

  it('keeps the deployment runbook aligned with enforced production policy', () => {
    const result = runDevopsPolicyChecks(buildDevopsPolicyChecks());

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThanOrEqual(10);
  });
});
