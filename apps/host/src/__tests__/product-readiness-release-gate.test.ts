import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildReleaseGatePlan,
  formatReleaseGatePlan,
  runReleaseGatePlan,
  runReleaseGateStep,
  type ReleaseGateStep,
} from '../../../../scripts/product-readiness-release-gate';

function commandLines(steps: ReleaseGateStep[]): string[] {
  return steps.map((step) => step.command);
}

function repoPath(rel: string): string {
  return resolve(__dirname, '../../../..', rel);
}

describe('RCA-20 product readiness release gate runner', () => {
  it('keeps the repo-owned release gate executable and ordered', () => {
    const plan = buildReleaseGatePlan();
    const commands = commandLines(plan.repoSteps);

    expect(commands[0]).toBe('npm run type-check --workspaces --if-present');
    expect(commands[1]).toBe('npm run lint --workspaces --if-present');
    expect(commands[2]).toBe('npx tsx scripts/verify-devops-policy-contract.ts');
    expect(commands).toContain('npm run eval:tenant-isolation -w apps/host');
    expect(commands).toContain('npx tsx scripts/pre-rollout-checklist.ts');
    expect(commands).toContain('npx cross-env NODE_OPTIONS=--max-old-space-size=6144 npm run build -w apps/host');
    expect(commands).toContain('npm run gen:openapi:check -w apps/host');
    expect(commands).toContain('npx vitest run src/__tests__/mobile-legacy-traffic-verifier.test.ts');
    expect(commands).toContain('npx vitest run src/__tests__/grade-format-verifier.test.ts');
    expect(commands).toContain('npx vitest run src/__tests__/feature-flag-reconciliation.test.ts');
    expect(commands).toContain('npx vitest run src/__tests__/api/cron/job-health-smoke.test.ts');

    expect(plan.repoSteps.every((step) => step.owner === 'repo')).toBe(true);
    expect(plan.repoSteps.every((step) => step.rcaItems.length > 0)).toBe(true);
    expect(plan.repoSteps.every((step) => step.command.trim().length > 0)).toBe(true);
  });

  it('runs the production build before the long host Vitest tail', () => {
    const ids = buildReleaseGatePlan().repoSteps.map((step) => step.id);

    expect(ids.indexOf('host-build')).toBeGreaterThan(ids.indexOf('devops-policy-contract'));
    expect(ids.indexOf('host-build')).toBeLessThan(ids.indexOf('school-admin-roster'));
    expect(ids.indexOf('host-build')).toBeLessThan(ids.indexOf('tenant-isolation-eval'));
    expect(ids.indexOf('host-build')).toBeLessThan(ids.indexOf('openapi-check'));
  });

  it('keeps the release-gate production build on the proven Next build path', () => {
    const hostBuild = buildReleaseGatePlan().repoSteps.find((step) => step.id === 'host-build');
    expect(hostBuild?.command).toContain('NODE_OPTIONS=--max-old-space-size=6144');
    expect(hostBuild?.command).not.toContain('NEXT_RELEASE_GATE_DIST_DIR');
    expect(hostBuild?.command).not.toContain('NEXT_DISABLE_WEBPACK_BUILD_WORKER');
    expect(hostBuild?.command).not.toContain('NEXT_WEBPACK_MEMORY_OPTIMIZATIONS');

    const nextConfigSource = readFileSync(repoPath('apps/host/next.config.js'), 'utf8');
    expect(nextConfigSource).not.toContain('NEXT_RELEASE_GATE_DIST_DIR');
    expect(nextConfigSource).not.toContain('? false : undefined');
    expect(nextConfigSource).not.toContain('? true : undefined');
    // webpackBuildWorker is default-ON (Vercel preview OOM fix, 2026-07-17):
    // the experiment must be explicitly opted in (Sentry's custom webpack fn
    // would otherwise auto-disable it), while NEXT_DISABLE_WEBPACK_BUILD_WORKER=1
    // remains the env kill switch.
    expect(nextConfigSource).toContain(
      "webpackBuildWorker: process.env.NEXT_DISABLE_WEBPACK_BUILD_WORKER !== '1'"
    );
    expect(nextConfigSource).toContain("...(process.env.NEXT_WEBPACK_MEMORY_OPTIMIZATIONS === '1'");
  });

  it('runs host-scoped Vitest gates from apps/host while keeping workspace gates at repo root', () => {
    const plan = buildReleaseGatePlan();
    const byId = new Map(plan.repoSteps.map((step) => [step.id, step]));

    expect(byId.get('type-check')?.cwd).toBe('.');
    expect(byId.get('lint')?.cwd).toBe('.');
    expect(byId.get('school-admin-roster')?.cwd).toBe('apps/host');
    expect(byId.get('live-readiness-evidence')?.cwd).toBe('apps/host');
    expect(byId.get('tenant-isolation-eval')?.cwd).toBe('.');
    expect(byId.get('host-build')?.cwd).toBe('.');
  });

  it('keeps live/operator proof separate from local repo execution', () => {
    const plan = buildReleaseGatePlan();
    const liveGateText = plan.operatorSteps
      .map((step) => `${step.id} ${step.command}`)
      .join('\n');

    expect(liveGateText).toContain('verify-live-tenant-isolation-smoke.ts');
    expect(liveGateText).toContain('verify-feature-flag-matrix.ts --env=production');
    expect(liveGateText).toContain('verify-db-function-hardening-live.ts --input=<rows.json>');
    expect(liveGateText).toContain('verify-job-health-live.ts --input=<rows.json>');
    expect(liveGateText).toContain('verify-incident-id-live.ts --input=<evidence.json>');
    expect(liveGateText).toContain('verify-mobile-legacy-traffic-live.ts --input=<rows.json>');
    expect(liveGateText).toContain('playwright test e2e/certification');
    expect(liveGateText).toContain('service-role exception review');
    expect(liveGateText).not.toContain('execute scripts/xc3-service-role-migration-batch.json against prioritized routes');

    expect(plan.operatorSteps.every((step) => step.owner === 'operator')).toBe(true);
  });

  it('supports a dry run that never executes commands', () => {
    const plan = buildReleaseGatePlan();
    const executed: string[] = [];
    const result = runReleaseGatePlan(plan.repoSteps.slice(0, 2), {
      dryRun: true,
      runCommand(step) {
        executed.push(step.command);
        return { status: 0 };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      {
        id: plan.repoSteps[0].id,
        command: plan.repoSteps[0].command,
        cwd: plan.repoSteps[0].cwd,
        skipped: true,
        status: 0,
      },
      {
        id: plan.repoSteps[1].id,
        command: plan.repoSteps[1].command,
        cwd: plan.repoSteps[1].cwd,
        skipped: true,
        status: 0,
      },
    ]);
    expect(executed).toEqual([]);
  });

  it('stops at the first failing command in execution mode', () => {
    const plan = buildReleaseGatePlan();
    const attempted: string[] = [];
    const result = runReleaseGatePlan(plan.repoSteps.slice(0, 3), {
      runCommand(step) {
        attempted.push(step.id);
        return { status: step.id === 'lint' ? 1 : 0 };
      },
    });

    expect(result.ok).toBe(false);
    expect(attempted).toEqual(['type-check', 'lint']);
    expect(result.results).toEqual([
      {
        id: 'type-check',
        command: 'npm run type-check --workspaces --if-present',
        cwd: '.',
        skipped: false,
        status: 0,
      },
      {
        id: 'lint',
        command: 'npm run lint --workspaces --if-present',
        cwd: '.',
        skipped: false,
        status: 1,
      },
    ]);
  });

  it('performs build lock hygiene before the host production build gate', () => {
    const plan = buildReleaseGatePlan();
    const hostBuild = plan.repoSteps.find((step) => step.id === 'host-build');
    expect(hostBuild).toBeDefined();

    const events: string[] = [];
    const result = runReleaseGateStep(hostBuild!, {
      buildLock: {
        hasActiveNextBuild: () => {
          events.push('check-active-build');
          return false;
        },
        hasStaleNextBuildLock: () => {
          events.push('check-stale-lock');
          return true;
        },
        removeStaleNextBuildLock: () => {
          events.push('remove-stale-lock');
        },
        waitForNextBuildExit: () => {
          events.push('wait-for-build');
          return true;
        },
      },
      runCommand(step) {
        events.push(`run:${step.id}`);
        return { status: 0 };
      },
    });

    expect(result.status).toBe(0);
    expect(events).toEqual([
      'check-active-build',
      'check-stale-lock',
      'remove-stale-lock',
      'run:host-build',
    ]);
  });

  it('waits for active Next builds before running the host production build gate', () => {
    const hostBuild = buildReleaseGatePlan().repoSteps.find((step) => step.id === 'host-build');
    expect(hostBuild).toBeDefined();

    const events: string[] = [];
    const result = runReleaseGateStep(hostBuild!, {
      buildLock: {
        hasActiveNextBuild: () => {
          events.push('check-active-build');
          return true;
        },
        waitForNextBuildExit: () => {
          events.push('wait-for-build');
          return true;
        },
        hasStaleNextBuildLock: () => {
          events.push('check-stale-lock');
          return false;
        },
        removeStaleNextBuildLock: () => {
          events.push('remove-stale-lock');
        },
      },
      runCommand(step) {
        events.push(`run:${step.id}`);
        return { status: 0 };
      },
    });

    expect(result.status).toBe(0);
    expect(events).toEqual([
      'check-active-build',
      'wait-for-build',
      'check-stale-lock',
      'run:host-build',
    ]);
  });

  it('retries the host production build once after stale-lock cleanup', () => {
    const hostBuild = buildReleaseGatePlan().repoSteps.find((step) => step.id === 'host-build');
    expect(hostBuild).toBeDefined();

    const events: string[] = [];
    let staleLockChecks = 0;
    const result = runReleaseGateStep(hostBuild!, {
      buildLock: {
        hasActiveNextBuild: () => {
          events.push('check-active-build');
          return false;
        },
        waitForNextBuildExit: () => {
          events.push('wait-for-build');
          return true;
        },
        hasStaleNextBuildLock: () => {
          events.push('check-stale-lock');
          staleLockChecks += 1;
          return staleLockChecks === 2;
        },
        removeStaleNextBuildLock: () => {
          events.push('remove-stale-lock');
        },
      },
      runCommand(step) {
        events.push(`run:${step.id}`);
        return { status: events.filter((event) => event === 'run:host-build').length === 1 ? 1 : 0 };
      },
    });

    expect(result.status).toBe(0);
    expect(events).toEqual([
      'check-active-build',
      'check-stale-lock',
      'run:host-build',
      'wait-for-build',
      'check-stale-lock',
      'remove-stale-lock',
      'run:host-build',
    ]);
  });

  it('does not retry the host production build when cleanup finds no stale lock', () => {
    const hostBuild = buildReleaseGatePlan().repoSteps.find((step) => step.id === 'host-build');
    expect(hostBuild).toBeDefined();

    const events: string[] = [];
    const result = runReleaseGateStep(hostBuild!, {
      buildLock: {
        hasActiveNextBuild: () => {
          events.push('check-active-build');
          return false;
        },
        waitForNextBuildExit: () => {
          events.push('wait-for-build');
          return true;
        },
        hasStaleNextBuildLock: () => {
          events.push('check-stale-lock');
          return false;
        },
        removeStaleNextBuildLock: () => {
          events.push('remove-stale-lock');
        },
      },
      runCommand(step) {
        events.push(`run:${step.id}`);
        return { status: 1 };
      },
    });

    expect(result.status).toBe(1);
    expect(events).toEqual([
      'check-active-build',
      'check-stale-lock',
      'run:host-build',
      'wait-for-build',
      'check-stale-lock',
    ]);
  });

  it('prints repo and operator gates in the plan output', () => {
    const output = formatReleaseGatePlan(buildReleaseGatePlan());

    expect(output).toContain('Repo-Owned Gates');
    expect(output).toContain('Operator-Owned Gates');
    expect(output).toContain('npm run type-check --workspaces --if-present');
    expect(output).toContain('npx tsx scripts/verify-mobile-legacy-traffic-live.ts --input=<rows.json>');
  });
});
