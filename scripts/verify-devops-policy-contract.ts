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

export function buildDevopsPolicyChecks(): DevopsPolicyCheck[] {
  return [
    {
      id: 'runbook-current-date',
      label: 'deployment runbook is current',
      file: 'DEPLOYMENT_RUNBOOK.md',
      pass: includesAll('**Last updated:** 2026-07-10'),
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
      pass: includesAll('Web Rollback - Vercel', 'Edge Function Rollback - Supabase', 'Database Roll Forward / Compensating Migration'),
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
      label: 'production cron runner targets the configured production domain',
      file: '.github/workflows/production-cron-runner.yml',
      pass: includesAll("TARGET_URL: ${{ vars.PRODUCTION_CRON_TARGET_URL || vars.PRODUCTION_DOMAIN || 'https://alfanumrik.com' }}"),
      failure: 'Production cron runner must fall back to vars.PRODUCTION_DOMAIN so its AWS-loaded CRON_SECRET matches the targeted runtime.',
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
