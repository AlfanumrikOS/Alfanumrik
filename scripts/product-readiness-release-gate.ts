#!/usr/bin/env -S npx tsx
/**
 * RCA-20 product readiness release gate runner.
 *
 * Runs the repo-owned verification baseline in order, while listing live
 * operator gates separately so local success is never confused with launch
 * readiness proof.
 */

import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export type ReleaseGateOwner = 'repo' | 'operator';

export interface ReleaseGateStep {
  id: string;
  label: string;
  owner: ReleaseGateOwner;
  rcaItems: string[];
  command: string;
  cwd: string;
}

export interface ReleaseGatePlan {
  repoSteps: ReleaseGateStep[];
  operatorSteps: ReleaseGateStep[];
}

export interface CommandResult {
  status: number | null;
}

export interface ReleaseGateRunOptions {
  dryRun?: boolean;
  runCommand?: (step: ReleaseGateStep) => CommandResult;
  buildLock?: BuildLockControls;
}

export interface ReleaseGateStepResult {
  id: string;
  command: string;
  cwd: string;
  skipped: boolean;
  status: number | null;
}

export interface ReleaseGateRunResult {
  ok: boolean;
  results: ReleaseGateStepResult[];
}

const REPO_ROOT = resolve(__dirname, '..');
const HOST_NEXT_LOCK = resolve(REPO_ROOT, 'apps/host/.next/lock');

export interface BuildLockControls {
  hasActiveNextBuild: () => boolean;
  waitForNextBuildExit: () => boolean;
  hasStaleNextBuildLock: () => boolean;
  removeStaleNextBuildLock: () => void;
}

function repoStep(id: string, label: string, rcaItems: string[], command: string, cwd = '.'): ReleaseGateStep {
  return {
    id,
    label,
    owner: 'repo',
    rcaItems,
    command,
    cwd,
  };
}

function operatorStep(id: string, label: string, rcaItems: string[], command: string): ReleaseGateStep {
  return {
    id,
    label,
    owner: 'operator',
    rcaItems,
    command,
    cwd: '.',
  };
}

function hostVitestStep(id: string, label: string, rcaItems: string[], testPaths: string): ReleaseGateStep {
  return repoStep(id, label, rcaItems, `npx vitest run ${testPaths}`, 'apps/host');
}

export function buildReleaseGatePlan(): ReleaseGatePlan {
  const repoSteps: ReleaseGateStep[] = [
    repoStep('type-check', 'Workspace TypeScript type-check', ['RCA-20'], 'npm run type-check --workspaces --if-present'),
    repoStep('lint', 'Workspace lint', ['RCA-20'], 'npm run lint --workspaces --if-present'),
    repoStep('devops-policy-contract', 'DevOps deployment policy contract', ['RCA-20'], 'npx tsx scripts/verify-devops-policy-contract.ts'),
    repoStep('host-build', 'Host production build', ['RCA-20'], 'npx cross-env NODE_OPTIONS=--max-old-space-size=6144 npm run build -w apps/host'),
    hostVitestStep(
      'school-admin-roster',
      'School-admin CSV and seat regression suite',
      ['RCA-16'],
      'src/__tests__/api/school-admin-students-post.test.ts src/__tests__/api/school-admin/seat-enforcement-routes.test.ts src/__tests__/api/school-admin/seat-enforcement-flag-off.test.ts src/__tests__/api-admin-client-allowlist.test.ts',
    ),
    hostVitestStep('route-access-manifest', 'Route access metadata contract', ['RCA-01', 'RCA-02'], 'src/__tests__/api/route-access-manifest.test.ts'),
    hostVitestStep('feature-flag-matrix', 'Feature flag environment matrix', ['RCA-24'], 'src/__tests__/lib/feature-flag-matrix.test.ts'),
    hostVitestStep('cron-job-registry', 'Cron job registry', ['RCA-17'], 'src/__tests__/api/cron-job-registry.test.ts'),
    hostVitestStep('cron-job-health-smoke', 'Cron job-health localhost smoke route', ['RCA-17'], 'src/__tests__/api/cron/job-health-smoke.test.ts'),
    hostVitestStep('edge-function-manifest', 'Edge function manifest', ['RCA-08'], 'src/__tests__/edge-functions/edge-function-manifest.test.ts'),
    hostVitestStep('legacy-api-inventory', 'Legacy API inventory', ['RCA-22'], 'src/__tests__/api/legacy-api-inventory.test.ts'),
    hostVitestStep('public-api-openapi', 'Public API OpenAPI route contract', ['RCA-07', 'RCA-15'], 'src/__tests__/public-api/openapi-route.test.ts'),
    hostVitestStep('db-function-hardening', 'DB function hardening manifest', ['RCA-18'], 'src/__tests__/db-function-hardening.test.ts'),
    hostVitestStep('incident-id-propagation', 'Incident ID propagation', ['RCA-23'], 'src/__tests__/incident-id-propagation.test.ts'),
    hostVitestStep('product-surface-matrix', 'Product surface matrix', ['RCA-12'], 'src/__tests__/product-surface-matrix.test.ts'),
    hostVitestStep('provisioning-paths', 'Provisioning path inventory', ['RCA-10'], 'src/__tests__/api/provisioning-path-inventory.test.ts'),
    hostVitestStep('mobile-v2-contract', 'Mobile /v2 contract manifest', ['RCA-25'], 'src/__tests__/mobile-v2-contract-manifest.test.ts'),
    hostVitestStep('grade-normalization', 'Grade normalization readiness', ['RCA-11'], 'src/__tests__/grade-normalization-readiness.test.ts'),
    hostVitestStep('grade-format-verifier', 'Grade format live verifier regression', ['RCA-11'], 'src/__tests__/grade-format-verifier.test.ts'),
    hostVitestStep('super-admin-pii', 'Super-admin PII readiness', ['RCA-14'], 'src/__tests__/super-admin-pii-readiness.test.ts'),
    hostVitestStep('foxy-rag', 'Foxy/RAG readiness', ['RCA-13'], 'src/__tests__/foxy-rag-readiness.test.ts'),
    hostVitestStep('certification-manifest', 'Certification readiness manifest', ['RCA-20'], 'src/__tests__/certification-readiness-manifest.test.ts'),
    hostVitestStep('student-learning', 'Student learning readiness', ['RCA-04', 'RCA-06'], 'src/__tests__/student-learning-readiness.test.ts'),
    hostVitestStep('xc3-service-role', 'XC-3 service-role migration batch', ['RCA-01'], 'src/__tests__/xc3-service-role-migration-batch.test.ts'),
    hostVitestStep('tsb4-membership', 'TSB-4 canonical membership cutover', ['RCA-03', 'RCA-21'], 'src/__tests__/tsb4-canonical-membership-cutover-readiness.test.ts'),
    hostVitestStep('historical-xp', 'Historical XP quantification artifact', ['RCA-06'], 'src/__tests__/historical-xp-inflation-quantification.test.ts'),
    hostVitestStep('feature-flag-live-verifier', 'Live feature flag verifier logic', ['RCA-24'], 'src/__tests__/feature-flag-live-matrix-verifier.test.ts'),
    hostVitestStep('feature-flag-reconciliation', 'Feature flag reconciliation planner', ['RCA-24'], 'src/__tests__/feature-flag-reconciliation.test.ts'),
    hostVitestStep('edge-secret-activation', 'Edge shared-secret activation readiness', ['RCA-08', 'RCA-09'], 'src/__tests__/edge-functions/edge-secret-activation-readiness.test.ts'),
    hostVitestStep('tenant-isolation-smoke', 'Live tenant isolation smoke verifier logic', ['RCA-19', 'RCA-20'], 'src/__tests__/live-tenant-isolation-smoke.test.ts'),
    hostVitestStep('db-function-live-verifier', 'Live DB function grant verifier logic', ['RCA-18'], 'src/__tests__/db-function-live-grant-verifier.test.ts'),
    hostVitestStep('job-health-live-verifier', 'Live job health verifier logic', ['RCA-17'], 'src/__tests__/job-health-live-verifier.test.ts'),
    hostVitestStep('pii-ops-runbook', 'PII exporter notification runbook', ['RCA-14'], 'src/__tests__/super-admin-pii-ops-runbook.test.ts'),
    hostVitestStep('incident-id-live-verifier', 'Live incident ID verifier logic', ['RCA-23'], 'src/__tests__/incident-id-live-verifier.test.ts'),
    hostVitestStep('mobile-legacy-traffic', 'Mobile legacy traffic verifier logic', ['RCA-04', 'RCA-22', 'RCA-25'], 'src/__tests__/mobile-legacy-traffic-verifier.test.ts'),
    hostVitestStep('live-readiness-evidence', 'Live readiness evidence bundle contract', ['RCA-20'], 'src/__tests__/live-readiness-evidence.test.ts'),
    repoStep('tenant-isolation-eval', 'Static tenant isolation evaluator', ['RCA-19', 'RCA-20'], 'npm run eval:tenant-isolation -w apps/host'),
    repoStep('pre-rollout-checklist', 'Grounded-answer pre-rollout checklist', ['RCA-13', 'RCA-20'], 'npx tsx scripts/pre-rollout-checklist.ts'),
    repoStep('openapi-check', 'OpenAPI generation drift check', ['RCA-07', 'RCA-15', 'RCA-25'], 'npm run gen:openapi:check -w apps/host'),
  ];

  const operatorSteps: ReleaseGateStep[] = [
    operatorStep('certification-e2e-live', 'Selected certification E2E live run', ['RCA-20'], 'CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification'),
    operatorStep('edge-secrets-smoke', 'Edge deploy and Upstash secret smoke', ['RCA-08', 'RCA-09'], 'supabase secrets set UPSTASH_REDIS_REST_URL=<redacted> UPSTASH_REDIS_REST_TOKEN=<redacted> --project-ref <target-project-ref> && smoke parent-portal logs/load'),
    operatorStep('tenant-isolation-live', 'Live tenant isolation smoke', ['RCA-19', 'RCA-20'], 'LIVE_TENANT_SMOKE_BASE_URL=<target> LIVE_TENANT_SMOKE_PARENT_A_TOKEN=<tenant-a-parent-jwt> LIVE_TENANT_SMOKE_TEACHER_A_TOKEN=<tenant-a-teacher-jwt> LIVE_TENANT_SMOKE_SCHOOL_ADMIN_A_TOKEN=<tenant-a-admin-jwt> LIVE_TENANT_SMOKE_STUDENT_B_ID=<tenant-b-student> LIVE_TENANT_SMOKE_CLASS_B_ID=<tenant-b-class> LIVE_TENANT_SMOKE_SCHOOL_B_ID=<tenant-b-school> npx tsx scripts/verify-live-tenant-isolation-smoke.ts'),
    operatorStep('feature-flags-production', 'Production feature flag DB comparison', ['RCA-24'], 'npx tsx scripts/verify-feature-flag-matrix.ts --env=production'),
    operatorStep('feature-flags-staging', 'Staging feature flag DB comparison', ['RCA-24'], 'npx tsx scripts/verify-feature-flag-matrix.ts --env=staging'),
    operatorStep('grade-format-target-db', 'Target DB grade format verification', ['RCA-11'], 'npx tsx scripts/verify-grade-format.ts'),
    operatorStep('db-function-grants-live', 'Target DB function grant inspection', ['RCA-18'], 'npx tsx scripts/verify-db-function-hardening-live.ts --input=<rows.json>'),
    operatorStep('job-health-live', 'Live job health inspection', ['RCA-17'], 'npx tsx scripts/verify-job-health-live.ts --input=<rows.json>'),
    operatorStep('pii-notification', 'Lower-tier PII exporter notification and audit review', ['RCA-14'], 'docs/runbooks/super-admin-pii-export-notification.md'),
    operatorStep('incident-id-live', 'Production incident ID observability proof', ['RCA-23'], 'npx tsx scripts/verify-incident-id-live.ts --input=<evidence.json>'),
    operatorStep('mobile-legacy-traffic-live', 'Mobile legacy quiz/payment traffic validation', ['RCA-04', 'RCA-22', 'RCA-25'], 'npx tsx scripts/verify-mobile-legacy-traffic-live.ts --input=<rows.json>'),
    operatorStep('historical-xp-target-db', 'Historical XP quantification and product decision', ['RCA-06'], 'run scripts/historical-xp-inflation-quantification.sql on target DB and obtain clamp/backfill decision'),
    operatorStep('xc3-exception-review', 'XC-3 service-role exception review and next narrowing pass', ['RCA-01'], 'perform service-role exception review of scripts/admin-client-allowlist.json and scripts/xc3-service-role-migration-batch.json for remaining cron/webhook/super-admin routes; record approved exceptions or next scoped-RPC narrowing candidates'),
    operatorStep('tsb4-live-cutover', 'TSB-4 canonical membership live repoint/smoke', ['RCA-03', 'RCA-21'], 'execute scripts/tsb4-canonical-membership-cutover.json through live smoke before retirement approval'),
    operatorStep('wireframe-expansion-signoff', 'Full wireframe/CTA expansion sign-off', ['RCA-12'], 'obtain product sign-off on the expanded scripts/product-surface-matrix.json 13-surface route/page/flag/API matrix and record any remaining surfaced CTA or hidden/dead states'),
  ];

  return { repoSteps, operatorSteps };
}

function defaultRunCommand(step: ReleaseGateStep): CommandResult {
  const result = spawnSync(step.command, {
    cwd: resolve(REPO_ROOT, step.cwd),
    shell: true,
    stdio: 'inherit',
  });
  return { status: result.status };
}

function defaultHasActiveNextBuild(): boolean {
  if (process.platform !== 'win32') {
    const result = spawnSync('sh', ['-lc', "ps -eo args | grep -E 'next.*build|npm.*run build -w apps/host' | grep -v grep"], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return result.status === 0 && result.stdout.trim().length > 0;
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "$pattern = 'next.*build|npm-cli.js.*build.*apps/host|npx-cli.js.*next.*build|jest-worker/processChild.js'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match $pattern -and $_.CommandLine -notmatch 'Get-CimInstance Win32_Process' } | Select-Object -First 1 -ExpandProperty ProcessId",
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

function defaultWaitForNextBuildExit(): boolean {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (!defaultHasActiveNextBuild()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  return !defaultHasActiveNextBuild();
}

const defaultBuildLockControls: BuildLockControls = {
  hasActiveNextBuild: defaultHasActiveNextBuild,
  waitForNextBuildExit: defaultWaitForNextBuildExit,
  hasStaleNextBuildLock: () => existsSync(HOST_NEXT_LOCK),
  removeStaleNextBuildLock: () => {
    rmSync(HOST_NEXT_LOCK, { force: true });
  },
};

function prepareHostBuildGate(buildLock: BuildLockControls): CommandResult | null {
  const hadActiveBuild = buildLock.hasActiveNextBuild();
  if (hadActiveBuild && !buildLock.waitForNextBuildExit()) {
    return { status: 1 };
  }

  if (buildLock.hasStaleNextBuildLock()) {
    buildLock.removeStaleNextBuildLock();
  }

  return null;
}

export function runReleaseGateStep(
  step: ReleaseGateStep,
  options: ReleaseGateRunOptions = {},
): CommandResult {
  const buildLock = options.buildLock ?? defaultBuildLockControls;
  if (step.id === 'host-build') {
    const preflightResult = prepareHostBuildGate(buildLock);
    if (preflightResult) return preflightResult;
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  const result = runCommand(step);

  if (step.id !== 'host-build' || result.status === 0) {
    return result;
  }

  if (!buildLock.waitForNextBuildExit() || !buildLock.hasStaleNextBuildLock()) {
    return result;
  }

  buildLock.removeStaleNextBuildLock();
  return runCommand(step);
}

export function runReleaseGatePlan(
  steps: ReleaseGateStep[],
  options: ReleaseGateRunOptions = {},
): ReleaseGateRunResult {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const results: ReleaseGateStepResult[] = [];

  for (const step of steps) {
    if (options.dryRun) {
      results.push({
        id: step.id,
        command: step.command,
        cwd: step.cwd,
        skipped: true,
        status: 0,
      });
      continue;
    }

    const result = runReleaseGateStep(step, { ...options, runCommand });
    results.push({
      id: step.id,
      command: step.command,
      cwd: step.cwd,
      skipped: false,
      status: result.status,
    });
    if (result.status !== 0) break;
  }

  return {
    ok: results.every((result) => result.status === 0),
    results,
  };
}

function formatStep(step: ReleaseGateStep, index: number): string {
  const cwd = step.cwd === '.' ? '' : ` (cwd: ${step.cwd})`;
  return `${index + 1}. [${step.rcaItems.join(', ')}] ${step.label}${cwd}\n   ${step.command}`;
}

export function formatReleaseGatePlan(plan: ReleaseGatePlan): string {
  return [
    'Product Readiness Release Gate',
    '==============================',
    '',
    'Repo-Owned Gates',
    '----------------',
    ...plan.repoSteps.map(formatStep),
    '',
    'Operator-Owned Gates',
    '--------------------',
    ...plan.operatorSteps.map(formatStep),
  ].join('\n');
}

function formatRunResult(result: ReleaseGateRunResult): string {
  const lines = result.results.map((step) => {
    const status = step.skipped ? 'DRY-RUN' : step.status === 0 ? 'PASS' : 'FAIL';
    const cwd = step.cwd === '.' ? '' : ` (cwd: ${step.cwd})`;
    return `[${status}] ${step.id}${cwd}: ${step.command}`;
  });
  lines.push('', `Summary: ${result.results.filter((step) => step.status === 0).length}/${result.results.length} repo gates passed.`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)): number {
  const plan = buildReleaseGatePlan();
  if (argv.includes('--list')) {
    // eslint-disable-next-line no-console
    console.log(formatReleaseGatePlan(plan));
    return 0;
  }

  const dryRun = argv.includes('--dry-run');
  const result = runReleaseGatePlan(plan.repoSteps, { dryRun });
  // eslint-disable-next-line no-console
  console.log(formatRunResult(result));
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('\nDry-run only. Operator-owned live gates are listed with --list and are not executed by this command.');
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
