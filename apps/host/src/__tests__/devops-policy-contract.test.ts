import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReleaseGatePlan } from '../../../../scripts/product-readiness-release-gate';
import {
  buildDevopsPolicyChecks,
  productionDeploymentAuthorityIsSafe,
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
    const checks = buildDevopsPolicyChecks();
    const result = runDevopsPolicyChecks(checks);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'manual-only-containment',
      'production-cron-break-glass',
      'production-cron-script-single-job',
      'production-release-control',
      'ci-gate-and-exact-sha-poll',
      'vercel-authority-cutover-safe',
    ]));
    expect(result.checked).toBeGreaterThanOrEqual(18);
  });

  it('rejects unsafe release rollback/tag and Vercel authority mutations', () => {
    const workflow = readFileSync(resolve(__dirname, '../../../../.github/workflows/deploy-production.yml'), 'utf8');
    const checks = buildDevopsPolicyChecks();
    const release = checks.find((check) => check.id === 'production-release-control');
    expect(release?.pass(workflow)).toBe(true);
    expect(release?.pass(workflow.replace("steps.health.outputs.rollback_authorized == 'true'", "steps.health.outputs.rollback_authorized != 'false'"))).toBe(false);
    expect(release?.pass(workflow.replace("b.ok===false&&['degraded','unhealthy'].includes(b.status)", "b.ok!==true"))).toBe(false);
    expect(release?.pass(workflow.replace('if [ "$SEMANTIC_UNHEALTHY" = "true" ]; then CURRENT_SHA_UNHEALTHY=1; fi', 'if [ "$SEMANTIC_UNHEALTHY" != "false" ]; then CURRENT_SHA_UNHEALTHY=1; fi'))).toBe(false);
    expect(release?.pass(workflow.replace('[ "$SEMANTIC_UNHEALTHY" != "true" ]', '[ "$SEMANTIC_UNHEALTHY" = "false" ]'))).toBe(false);
    expect(release?.pass(workflow.replace('if [ "$BYPASS_BLOCKED" -gt 0 ]; then', 'if [ "$BYPASS_BLOCKED" -gt 0 ] && [ "$BYPASS_BLOCKED" = "$PROBES" ]; then'))).toBe(false);
    expect(release?.pass(workflow.replace('rollback_baseline_valid:', 'rollback_candidate_valid:'))).toBe(false);
    expect(release?.pass(workflow.replace('ROLLBACK_VERIFY_WINDOW_SECONDS=300', 'ROLLBACK_VERIFY_WINDOW_SECONDS=0'))).toBe(false);
    expect(release?.pass(workflow.replace('vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"', 'vercel promote "$ROLLBACK_BASELINE_DEPLOYMENT_ID"'))).toBe(false);
    expect(release?.pass(workflow.replace('vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"', 'vercel ls --prod\n          vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"'))).toBe(false);
    expect(release?.pass(workflow.replace('if [ "$PRODUCTION_MIGRATIONS_CHANGED" = "true" ] || [ "$EDGE_FUNCTIONS_CHANGED" = "true" ]; then', 'if false; then'))).toBe(false);

    const vercel = readFileSync(resolve(__dirname, '../../../../vercel.json'), 'utf8');
    const unsafe = JSON.stringify({ ...JSON.parse(vercel), git: { deploymentEnabled: { main: false } } });
    expect(productionDeploymentAuthorityIsSafe(vercel, workflow)).toBe(true);
    expect(productionDeploymentAuthorityIsSafe(unsafe, workflow)).toBe(false);
  });
});
