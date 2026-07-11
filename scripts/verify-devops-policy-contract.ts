#!/usr/bin/env -S npx tsx
/**
 * DevOps policy contract verifier.
 *
 * Keeps the deployment runbook aligned with the executable release process.
 * This intentionally checks source files as text so it stays dependency-free
 * and can run early in release gates.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DevopsPolicyCheck {
  id: string;
  label: string;
  file: string;
  pass: (text: string) => boolean;
  failure: string;
}

export interface DevopsPolicyResult {
  ok: boolean;
  checked: number;
  failures: Array<{ id: string; label: string; file: string; reason: string }>;
}

const REPO_ROOT = resolve(__dirname, '..');

function repoPath(rel: string): string {
  return resolve(REPO_ROOT, rel);
}

function includesAll(...needles: string[]): (text: string) => boolean {
  return (text) => needles.every((needle) => text.includes(needle));
}

function excludesAll(...needles: string[]): (text: string) => boolean {
  return (text) => needles.every((needle) => !text.includes(needle));
}

function mappingEntryBlock(text: string, key: string, indent = 0): string {
  const lines = text.split(/\r?\n/);
  const prefix = ' '.repeat(indent);
  const start = lines.findIndex((line) => line.startsWith(prefix + key + ':'));
  if (start < 0) return '';
  const sibling = new RegExp('^' + prefix + '[A-Za-z0-9_-]+:');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sibling.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start, end).join('\n');
}

function triggerKeys(text: string): string[] {
  const onBlock = mappingEntryBlock(text, 'on');
  return Array.from(onBlock.matchAll(/^ {2}([A-Za-z0-9_-]+):/gm), (match) => match[1]);
}

function workflowDispatchOnly(text: string): boolean {
  const triggers = triggerKeys(text);
  return triggers.length === 1 && triggers[0] === 'workflow_dispatch';
}

function workflowPushMainOnly(text: string): boolean {
  const triggers = triggerKeys(text);
  return triggers.length === 1 && triggers[0] === 'push'
    && /branches:\s*\[main\]/.test(mappingEntryBlock(text, 'on'));
}

function jobDependencies(jobBlock: string): string[] {
  const match = jobBlock.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
  return match ? match[1].split(',').map((value) => value.trim()).filter(Boolean) : [];
}

function workflowChoiceOptions(text: string, inputName: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === '      ' + inputName + ':');
  const options = lines.findIndex((line, index) => index > start && line === '        options:');
  if (start < 0 || options < 0) return [];
  const values: string[] = [];
  for (let index = options + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {10}-\s+(.+)$/);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

export function productionDeploymentAuthorityIsSafe(
  vercelText: string,
  workflowText = readFileSync(repoPath('.github/workflows/deploy-production.yml'), 'utf8'),
): boolean {
  const config = JSON.parse(vercelText) as { git?: { deploymentEnabled?: boolean | Record<string, boolean> } };
  const enabled = config.git?.deploymentEnabled;
  if (enabled === false) return false;
  if (enabled === undefined || enabled === true) return true;
  if (enabled['*'] === false) return false;
  if (enabled.main !== false) return true;
  const deploy = mappingEntryBlock(workflowText, 'deploy', 2);
  const health = mappingEntryBlock(workflowText, 'health-check', 2);
  return deploy.includes('vercel deploy --prebuilt --prod')
    && !/^ {4}if:/m.test(deploy)
    && jobDependencies(health).includes('deploy');
}

export function buildDevopsPolicyChecks(): DevopsPolicyCheck[] {
  return [
    {
      id: 'runbook-current-date',
      label: 'deployment runbook is current',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('**Last updated:** 2026-07-11'),
      failure: 'DEPLOYMENT_RUNBOOK.md must carry the current DevOps update date.',
    },
    {
      id: 'runbook-no-retired-manual-model',
      label: 'deployment runbook does not describe the retired manual-only model',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: excludesAll(
        'GitHub Actions is billing-blocked',
        'GitHub Actions is not used for deployment',
        'All Pending Migrations (as of 2026-06-09)',
        '7 functions changed since last deploy',
        'Deploy all 46 functions',
      ),
      failure: 'Remove stale CI-independent/manual-only deployment guidance.',
    },
    {
      id: 'runbook-release-gates',
      label: 'runbook requires repo-owned and live evidence gates',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll(
        'scripts/product-readiness-release-gate.ts',
        'scripts/live-readiness-evidence-manifest.json',
        'npx tsx scripts/verify-live-readiness-evidence.ts --input=<evidence-bundle.json>',
      ),
      failure: 'Runbook must require repo-owned gates and live evidence bundle validation.',
    },
    {
      id: 'runbook-multiplane-model',
      label: 'runbook documents the production deployment planes',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('Web app', 'Database', 'Edge Functions', 'Jobs / cron', 'Release evidence'),
      failure: 'Runbook must document web, DB, Edge, jobs, and evidence planes.',
    },
    {
      id: 'runbook-vercel-bypass',
      label: 'runbook requires real Vercel health verification',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('VERCEL_AUTOMATION_BYPASS_SECRET', 'A protection challenge from CI is not proof'),
      failure: 'Runbook must distinguish Vercel protection challenges from real health proof.',
    },
    {
      id: 'runbook-service-role-ratchet',
      label: 'runbook keeps service-role blast radius ratcheting down',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('Service-role/admin-client route count must never increase', 'XC-3'),
      failure: 'Runbook must enforce service-role/admin-client route-count ratcheting.',
    },
    {
      id: 'runbook-rollback-planes',
      label: 'runbook separates rollback by deployment plane',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll(
        'Web Rollback - Vercel',
        'Edge Function Rollback - Supabase',
        'Database Roll Forward / Compensating Migration',
        'vercel rollback <known-good-deployment-id>',
        'human-readable `vercel list` output',
        'automatic production-domain assignment',
      ),
      failure: 'Runbook must separate web, Edge, and database rollback procedures.',
    },
    {
      id: 'runbook-definition-of-done',
      label: 'runbook defines operational deployment completion',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('## Definition of Done', 'live evidence bundle is fresh and valid', 'production health is verified against the real app'),
      failure: 'Runbook must define operational deployment completion.',
    },
    {
      id: 'release-gate-includes-policy-contract',
      label: 'release gate executes the DevOps policy contract',
      file: 'scripts/product-readiness-release-gate.ts',
      pass: includesAll('devops-policy-contract', 'npx tsx scripts/verify-devops-policy-contract.ts'),
      failure: 'Product readiness release gate must execute this verifier.',
    },
    {
      id: 'manual-only-containment',
      label: 'broken schedules and AWS auto deploy stay suspended',
      file: '.github/workflows/mesh-cron.yml',
      pass: (text) => {
        const content = readFileSync(repoPath('.github/workflows/content-quality-nightly.yml'), 'utf8');
        const aws = readFileSync(repoPath('.github/workflows/deploy-aws.yml'), 'utf8');
        return workflowDispatchOnly(text)
          && workflowDispatchOnly(content)
          && workflowDispatchOnly(aws)
          && includesAll('Agent mesh execution is suspended in Phase 0', 'enabled=false', "if: needs.gate.outputs.enabled == 'true'", 'environment: agent-mesh-break-glass')(text)
          && !text.includes('eval npm')
          && !text.includes('inputs.goal_override')
          && includesAll('Credentialed content-quality execution is suspended in Phase 0', 'enabled=false', "if: needs.gate.outputs.enabled == 'true'", 'environment: production-ops')(content)
          && includesAll('AWS production delivery is suspended in Phase 0', 'enabled=false', 'DEPLOY_AWS_PRODUCTION', 'refs/heads/main', 'environment: production-break-glass')(aws)
          && !aws.includes('enabled=true');
      },
      failure: 'Mesh, credentialed content scans, and AWS delivery must remain hard-suspended in Phase 0.',
    },
    {
      id: 'production-cron-break-glass',
      label: 'production cron is one-job protected break-glass only',
      file: '.github/workflows/production-cron-runner.yml',
      pass: (text) => {
        const registry = JSON.parse(readFileSync(repoPath('scripts/job-registry.json'), 'utf8')) as { jobs: Array<{ path: string }> };
        const expected = registry.jobs.map((job) => job.path).sort();
        const choices = workflowChoiceOptions(text, 'job_path').sort();
        const gate = mappingEntryBlock(text, 'gate', 2);
        const run = mappingEntryBlock(text, 'run', 2);
        return workflowDispatchOnly(text)
          && JSON.stringify(expected) === JSON.stringify(choices)
          && !choices.includes('all')
          && includesAll('ENABLE_PRODUCTION_CRON_BREAK_GLASS', 'RUN_ONE_PRODUCTION_CRON', 'refs/heads/main')(gate)
          && includesAll('needs: gate', 'environment: production-break-glass', 'id-token: write')(run)
          && text.includes("TARGET_URL: 'https://alfanumrik.com'")
          && !text.includes('PRODUCTION_CRON_TARGET_URL');
      },
      failure: 'Cron break-glass must pin the canonical origin and require one allowlisted, confirmed, reviewed job.',
    },
    {
      id: 'production-cron-script-single-job',
      label: 'cron runtime forbids schedule/all selectors',
      file: 'scripts/run-production-crons.mjs',
      pass: includesAll('Scheduled GitHub production cron execution is disabled', 'all is forbidden', "eventName === 'workflow_dispatch'", 'validateProductionTarget(targetUrl)', "redirect: 'error'"),
      failure: 'Runtime must reject scheduled/all GitHub execution, non-canonical targets, and redirects.',
    },
    {
      id: 'production-release-control',
      label: 'production release is push-main serialized and exact-SHA gated',
      file: '.github/workflows/deploy-production.yml',
      pass: (text) => {
        const concurrency = mappingEntryBlock(text, 'concurrency');
        const gate = mappingEntryBlock(text, 'production-verification-gate', 2);
        const health = mappingEntryBlock(text, 'health-check', 2);
        const post = mappingEntryBlock(text, 'post-deploy-verify', 2);
        const release = mappingEntryBlock(text, 'release', 2);
        const semanticUnhealthy = "b.ok===false&&['degraded','unhealthy'].includes(b.status)";
        return workflowPushMainOnly(text)
          && concurrency.includes('cancel-in-progress: false')
          && includesAll("['healthy','degraded','unhealthy'].includes(b.status)", "typeof b.version?.git_sha==='string'")(gate)
          && includesAll(
            'rollback_baseline_valid:',
            'rollback_baseline_deployment_id:',
            'rollback_baseline_git_sha:',
            'app_timestamp_fresh',
            'https://api.vercel.com/v13/deployments/${CANONICAL_HOST}',
            "d.gitSource?.ref === 'main'",
            '[ "$BEFORE_GIT_SHA" = "$GITHUB_SHA" ]',
          )(gate)
          && jobDependencies(health).includes('deploy')
          && jobDependencies(health).includes('production-verification-gate')
          && health.split(semanticUnhealthy).length - 1 >= 2
          && includesAll(
            'POLL_WINDOW_SECONDS=600',
            'CURRENT_SHA_SEEN=0',
            'CURRENT_SHA_UNHEALTHY=0',
            'rollback_authorized=true',
            "steps.health.outputs.rollback_authorized == 'true'",
            'Immediate rollback revalidation',
            'if [ "$SEMANTIC_UNHEALTHY" = "true" ]; then CURRENT_SHA_UNHEALTHY=1; fi',
            '[ "$SEMANTIC_UNHEALTHY" != "true" ]',
            'ROLLBACK_BASELINE_VALID',
            'PRODUCTION_MIGRATIONS_CHANGED',
            'EDGE_FUNCTIONS_CHANGED',
            'if [ "$PRODUCTION_MIGRATIONS_CHANGED" = "true" ] || [ "$EDGE_FUNCTIONS_CHANGED" = "true" ]; then',
            'CANDIDATE_VALID',
            'vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"',
            '--timeout=3m',
            'ROLLBACK_VERIFY_WINDOW_SECONDS=300',
            'ROLLBACK_ALIAS_BEFORE_ID',
            'Rollback verified: canonical production is healthy at exact SHA',
          )(health)
          && includesAll('EXPECTED_SHA=', "b.ok===true&&b.status==='healthy'", "b.version?.git_sha||''", 'if [ "$BYPASS_BLOCKED" -gt 0 ]; then', 'exact_sha_verified=true', 'verified_github_sha=$GITHUB_SHA')(post)
          && includesAll("needs.health-check.outputs.exact_sha_verified == 'true'", 'needs.health-check.outputs.verified_github_sha == github.sha', "needs.post-deploy-verify.outputs.exact_sha_verified == 'true'", 'needs.post-deploy-verify.outputs.verified_github_sha == github.sha')(release)
          && text.includes("VERCEL_CLI_VERSION: '55.0.0'")
          && !text.includes('vercel ls --prod')
          && !text.includes('vercel@latest')
          && !/soft[- ]pass|soft-success/i.test(health + post)
          && !text.includes('force_deploy_all_functions');
      },
      failure: 'Production must be push-only, semantic/exact-SHA verified, and roll back only to a bound known-good deployment with post-rollback proof.',
    },
    {
      id: 'ci-gate-and-exact-sha-poll',
      label: 'CI exposes aggregate gate and bounded exact-SHA production poll',
      file: '.github/workflows/ci.yml',
      pass: (text) => {
        const gate = mappingEntryBlock(text, 'ci-gate', 2);
        const health = mappingEntryBlock(text, 'health-check', 2);
        return text.includes('permissions:\n  contents: read')
          && includesAll('name: CI Gate', 'if: always()', 'SAME_REPOSITORY_PR', "forkSkips.push('integration-tests', 'e2e-critical-paths')", 'process.exit(1)')(gate)
          && includesAll('Trusted integration job requires', 'exit 1')(mappingEntryBlock(text, 'integration-tests', 2))
          && includesAll('POLL_WINDOW_SECONDS=600', 'while [ "$SECONDS" -lt "$DEADLINE" ]; do', 'EXPECTED_SHA=', "b.ok===true&&b.status==='healthy'", "b.version?.git_sha||''")(health)
          && !health.includes('sleep 60')
          && !/soft[- ]pass|soft-success/i.test(health);
      },
      failure: 'CI must aggregate required jobs and poll healthy exact SHA for about ten minutes without soft-pass.',
    },
    {
      id: 'vercel-authority-cutover-safe',
      label: 'Vercel Git main cannot be disabled before CLI is authoritative',
      file: 'vercel.json',
      pass: productionDeploymentAuthorityIsSafe,
      failure: 'Do not disable Vercel Git main until CLI deploy is mandatory and directly verified.',
    },
    {
      id: 'production-workflow-bypass-secret',
      label: 'production workflow supports Vercel automation bypass',
      file: '.github/workflows/deploy-production.yml',
      pass: includesAll('VERCEL_AUTOMATION_BYPASS_SECRET', 'x-vercel-protection-bypass'),
      failure: 'Production workflow must support Vercel automation bypass health checks.',
    },
    {
      id: 'production-workflow-pinned-supabase-cli',
      label: 'production workflow pins the Supabase CLI version',
      file: '.github/workflows/deploy-production.yml',
      pass: (text) => (
        text.includes("SUPABASE_CLI_VERSION: '2.109.1'")
        && text.includes('version: ${{ env.SUPABASE_CLI_VERSION }}')
        && !text.includes('version: latest')
      ),
      failure: 'Production workflow must pin Supabase CLI instead of resolving latest during deploy.',
    },
    {
      id: 'production-cron-runner-domain-fallback',
      label: 'production cron runner pins the canonical production origin',
      file: '.github/workflows/production-cron-runner.yml',
      pass: (text) => text.includes("TARGET_URL: 'https://alfanumrik.com'") && !text.includes('PRODUCTION_CRON_TARGET_URL'),
      failure: 'Production cron runner must never send its AWS-loaded CRON_SECRET to a mutable target.',
    },
    {
      id: 'live-evidence-manifest-required-gates',
      label: 'live evidence manifest keeps all broad-launch gates required',
      file: 'scripts/live-readiness-evidence-manifest.json',
      pass: (text) => {
        const manifest = JSON.parse(text) as { gates?: Array<{ requiredForBroadLaunch?: boolean }> };
        return Array.isArray(manifest.gates) && manifest.gates.length >= 10 && manifest.gates.every((gate) => gate.requiredForBroadLaunch === true);
      },
      failure: 'Every live evidence gate must remain required for broad launch.',
    },
  ];
}

export function runDevopsPolicyChecks(checks = buildDevopsPolicyChecks()): DevopsPolicyResult {
  const failures: DevopsPolicyResult['failures'] = [];

  for (const check of checks) {
    const abs = repoPath(check.file);
    if (!existsSync(abs)) {
      failures.push({
        id: check.id,
        label: check.label,
        file: check.file,
        reason: `missing file: ${check.file}`,
      });
      continue;
    }

    const text = readFileSync(abs, 'utf8');
    let passed = false;
    try {
      passed = check.pass(text);
    } catch (error) {
      failures.push({
        id: check.id,
        label: check.label,
        file: check.file,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!passed) {
      failures.push({
        id: check.id,
        label: check.label,
        file: check.file,
        reason: check.failure,
      });
    }
  }

  return {
    ok: failures.length === 0,
    checked: checks.length,
    failures,
  };
}

function main(): number {
  const result = runDevopsPolicyChecks();
  if (result.ok) {
    // eslint-disable-next-line no-console
    console.log(`DevOps policy contract passed (${result.checked}/${result.checked} checks).`);
    return 0;
  }

  // eslint-disable-next-line no-console
  console.error(`DevOps policy contract failed (${result.failures.length}/${result.checked} checks failed):`);
  for (const failure of result.failures) {
    // eslint-disable-next-line no-console
    console.error(`- ${failure.id} (${failure.file}): ${failure.reason}`);
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
