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
      // Bumped in lockstep with a real runbook revision — this literal is the
      // mechanism that forces the header date forward when deployment policy
      // changes, so it MUST be updated together with the doc, never to make a
      // red check green. 2026-07-11 -> 2026-08-11: documented the two bounded
      // exceptions to the exact-SHA release assertion (identical-tree no-op
      // and Vercel intentionally-skipped build) and corrected the false claim
      // that `CI Gate` is a required status check.
      pass: includesAll('**Last updated:** 2026-08-11'),
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
      label: 'broken schedules stay suspended',
      file: '.github/workflows/mesh-cron.yml',
      pass: (text) => workflowDispatchOnly(text)
        && includesAll('Agent mesh execution is suspended in Phase 0', 'enabled=false', "if: needs.gate.outputs.enabled == 'true'", 'environment: agent-mesh-break-glass')(text)
        && !text.includes('eval npm')
        && !text.includes('inputs.goal_override'),
      failure: 'The agent mesh cron must remain hard-suspended in Phase 0.',
    },
    {
      // 2026-08-11: the content-quality nightly used to be pinned to the SAME
      // blanket "workflow_dispatch-only + refuse everything" shape as mesh-cron,
      // by the check above. That shape was over-broad for this workflow and had
      // a real cost: it switched off the ONLY automated detector that warns the
      // question bank is going empty, on a platform where every question
      // generator is manual-only. The blind spot ran for a month.
      //
      // The hazard b66c25c3b actually closed was narrower than "no schedule": a
      // credentialed job reachable from `workflow_dispatch` on an ARBITRARY ref,
      // i.e. arbitrary branch-controlled script content executing with the
      // production Supabase credential. This check now pins that precise
      // property instead, which is strictly more targeted than the blanket ban:
      //
      //   1. no trigger may expose the credential to a contributor-chosen ref
      //      (`pull_request`/`pull_request_target` are forbidden outright);
      //   2. the credentialed job carries an explicit main-only ref guard, so a
      //      dispatch from any other ref skips it rather than running it;
      //   3. the job still runs inside the protected `production-ops`
      //      environment.
      //
      // Relaxing any of the three re-opens the original hole. Deleting the
      // schedule re-creates the blind spot. Both are regressions.
      id: 'content-scan-main-only-containment',
      label: 'credentialed content scan is scheduled but main-only',
      file: '.github/workflows/content-quality-nightly.yml',
      pass: (text) => {
        const triggers = triggerKeys(text).slice().sort();
        return JSON.stringify(triggers) === JSON.stringify(['schedule', 'workflow_dispatch'])
          && includesAll(
            "if: github.ref == 'refs/heads/main'",
            'environment: production-ops',
          )(text)
          && excludesAll('pull_request:', 'pull_request_target:')(text);
      },
      failure:
        'The credentialed content scan must stay schedule+dispatch only, guarded by an explicit '
        + "`if: github.ref == 'refs/heads/main'` ref check, and run in the protected production-ops "
        + 'environment. Never expose its Supabase credential to a contributor-chosen ref, and never '
        + 'delete its schedule (that is the question-bank-going-empty detector).',
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
          && includesAll('needs: gate', 'environment: production-break-glass')(run)
          // Least-privilege after the 2026-08-03 AWS decommission (P2-6): AWS OIDC
          // (configure-aws-credentials) was the ONLY consumer of id-token: write,
          // so the run job must NOT grant it. Assert the absence of the yaml-key
          // form — NOT the substring, which the removal-rationale comment still
          // contains, so a naive `!run.includes('id-token: write')` would
          // false-fail on the clean tree. This also replaces the old positive
          // `includesAll('id-token: write')` assertion that only passed because
          // that comment carried the substring (a false-green).
          && !/^[ \t]*id-token:[ \t]*write/m.test(run)
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
        const completion = mappingEntryBlock(text, 'production-release-completion-gate', 2);
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
          && includesAll(
            '!cancelled()',
            "needs.health-check.result == 'success'",
            "needs.health-check.outputs.exact_sha_verified == 'true'",
            'needs.health-check.outputs.verified_github_sha == github.sha',
          )(post)
          && includesAll('EXPECTED_SHA=', "b.ok===true&&b.status==='healthy'", "b.version?.git_sha||''", 'if [ "$BYPASS_BLOCKED" -gt 0 ]; then', 'exact_sha_verified=true', 'verified_github_sha=$GITHUB_SHA')(post)
          && includesAll(
            '!cancelled()',
            "github.ref == 'refs/heads/main'",
            "github.event_name == 'push'",
            "needs.health-check.result == 'success'",
            "needs.health-check.outputs.exact_sha_verified == 'true'",
            'needs.health-check.outputs.verified_github_sha == github.sha',
            "needs.post-deploy-verify.result == 'success'",
            "needs.post-deploy-verify.outputs.exact_sha_verified == 'true'",
            'needs.post-deploy-verify.outputs.verified_github_sha == github.sha',
          )(release)
          && jobDependencies(completion).includes('health-check')
          && jobDependencies(completion).includes('post-deploy-verify')
          && jobDependencies(completion).includes('release')
          // Wave 1 (2026-08-09): database state is a prerequisite for declaring
          // a production release complete. The gate's step already asserts
          // `needs.migrations.result == 'success'` and `migration_parity ==
          // 'verified'`, but in GitHub Actions a `needs.<job>` reference to a job
          // that is NOT a declared dependency evaluates to EMPTY rather than
          // erroring. Without this membership requirement those migration
          // assertions could be silently defanged by deleting one word from the
          // `needs` list, with no other visible change to the workflow.
          //
          // Scoped deliberately to `migrations` only. `deploy-functions` is also
          // in the gate's `needs` today, but the invariant encoded here is
          // migration/database verification; Edge Functions are a separate
          // deployment plane with their own rollback path, so pinning them here
          // would over-constrain the policy beyond what it is meant to guarantee.
          && jobDependencies(completion).includes('migrations')
          && includesAll(
            'if: ${{ always() }}',
            'EXPECTED_SHA: ${{ github.sha }}',
            'HEALTH_CHECK_RESULT: ${{ needs.health-check.result }}',
            'HEALTH_EXACT_SHA_VERIFIED: ${{ needs.health-check.outputs.exact_sha_verified }}',
            'HEALTH_VERIFIED_GITHUB_SHA: ${{ needs.health-check.outputs.verified_github_sha }}',
            'POST_DEPLOY_VERIFY_RESULT: ${{ needs.post-deploy-verify.result }}',
            'POST_EXACT_SHA_VERIFIED: ${{ needs.post-deploy-verify.outputs.exact_sha_verified }}',
            'POST_VERIFIED_GITHUB_SHA: ${{ needs.post-deploy-verify.outputs.verified_github_sha }}',
            'RELEASE_RESULT: ${{ needs.release.result }}',
            'require_equal "Health check result" "$HEALTH_CHECK_RESULT" "success"',
            'require_equal "Health exact-SHA proof" "$HEALTH_EXACT_SHA_VERIFIED" "true"',
            'require_equal "Health verified SHA" "$HEALTH_VERIFIED_GITHUB_SHA" "$EXPECTED_SHA"',
            'require_equal "Post-deploy verification result" "$POST_DEPLOY_VERIFY_RESULT" "success"',
            'require_equal "Post-deploy exact-SHA proof" "$POST_EXACT_SHA_VERIFIED" "true"',
            'require_equal "Post-deploy verified SHA" "$POST_VERIFIED_GITHUB_SHA" "$EXPECTED_SHA"',
            'require_equal "Release result" "$RELEASE_RESULT" "success"',
            'if [ "$FAILED" -ne 0 ]; then',
            'Production release completion evidence is incomplete.',
            'exit 1',
          )(completion)
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
      label: 'CI exposes aggregate gate; bounded exact-SHA production poll lives only in deploy-production',
      file: '.github/workflows/ci.yml',
      pass: (text) => {
        const gate = mappingEntryBlock(text, 'ci-gate', 2);
        // P0-4 (2026-08-03): ci.yml's post-deploy health-check job was DELETED
        // as a duplicate of deploy-production.yml's. The bounded exact-SHA
        // production poll now lives ONLY in deploy-production.yml — this check
        // asserts it there AND asserts the duplicate never reappears in ci.yml.
        const deployText = readFileSync(repoPath('.github/workflows/deploy-production.yml'), 'utf8');
        const deployHealth = mappingEntryBlock(deployText, 'health-check', 2);
        return /permissions:\r?\n  contents: read/.test(text)
          && includesAll(
            'name: CI Gate',
            // ─────────────────────────────────────────────────────────────
            // SUPERSEDES P2-16 (409123b5, 2026-08-07), reverted 2026-08-11.
            //
            // P2-16 pinned `if: ${{ always() && github.event_name !=
            // 'pull_request' }}` here, justified as: "the repository ruleset
            // enforces the 7 required checks directly, so freeing the gate
            // (and the 4 non-PR jobs it consumed) on PRs is a deliberate
            // runner-pressure cut."
            //
            // The premise is false. Verified live 2026-08-11 via
            // `gh api repos/AlfanumrikOS/Alfanumrik/rulesets/20528052`: the
            // required contexts are exactly "Secret Scanning",
            // "Lint, Type-check & Test", "Production Build" and
            // "CodeQL Analysis" — four, not seven, and NOT the aggregate
            // gate. So on a pull request the gate did not run and nothing
            // stood in for it; selected-school-rpc-integration,
            // protected-flag-migration-guard, foxy-alignment and
            // gen-mol-matrix were unenforced pre-merge. PR #1514 merged
            // green and turned main red on the next push (repair: #1517).
            //
            // The pin was also self-contradictory: the literals directly
            // below (`SAME_REPOSITORY_PR`, and what was then the fork-skip
            // accounting — since generalised into the expectedSkips lane
            // pinned further down) exist to handle pull_request events, and
            // were unreachable for the whole time the gate was push-only.
            //
            // This check's own label — "CI exposes aggregate gate" — is
            // better served by a gate that runs on every event. Pinning
            // `always()` on its own is strictly stronger than the old
            // conjunction: it keeps the terminal/aggregate posture on main
            // AND restores it on PRs.
            'if: ${{ always() }}',
            'SAME_REPOSITORY_PR',
            // ─────────────────────────────────────────────────────────────
            // EXPECTED-SKIP ACCOUNTING — spelling updated 2026-08-12.
            //
            // This slot used to pin one literal:
            //   forkSkips.push('integration-tests', 'e2e-critical-paths')
            // That single call encoded a fork-PR-only view of the world and
            // no longer exists in ci.yml. It was replaced because the shape
            // it pinned carried two defects, and these three literals exist
            // to keep both of them out:
            //
            // 1. workflow_dispatch could NEVER pass the gate. Under the old
            //    shape `integration-tests` stayed in `required` on every
            //    event, but its own `if:` (same-repo PR || push) makes it
            //    SKIPPED on a manual dispatch — so the gate read
            //    skipped !== 'success' and exited 1 with every other job
            //    green. Not flaky: structurally unpassable there.
            // 2. `e2e-critical-paths` sat in the gate's `needs` but on
            //    NEITHER list for push and workflow_dispatch, so on those
            //    events its result was read by nobody. A dependency that is
            //    declared and then never inspected is indistinguishable
            //    from one that always passes.
            //
            // The replacement classifies PER EVENT: every job in `needs`
            // lands in exactly one of `required` (must be 'success') or
            // `expectedSkips` (must be EXACTLY 'skipped'). That is strictly
            // stronger than what was pinned before — nothing is unchecked,
            // and nothing is forgiven for failing, because a job that RAN
            // and FAILED is never 'skipped'.
            //
            // Both conditional jobs are pinned INDIVIDUALLY rather than as
            // one combined literal: the generalised form builds the list
            // across two independent if/else branches, so a single combined
            // assertion could be satisfied while one whole branch was
            // deleted — silently dropping that job back to unchecked with
            // this check still green.
            //
            // The third literal is the load-bearing one. Populating
            // `expectedSkips` proves nothing unless the list is READ; a
            // check that only proved the array was built would be exactly
            // the hole described in (2), just relocated. It pins the
            // reconciliation into `failures` AND the exact comparison
            // (`!== 'skipped'`). Dropping the line so the array is built and
            // discarded, or relaxing the comparison to a truthiness test,
            // turns the entire expected-skip lane into a no-op.
            // ─────────────────────────────────────────────────────────────
            "expectedSkips.push('integration-tests')",
            "expectedSkips.push('e2e-critical-paths')",
            "failures.push(...expectedSkips.filter((job) => needs[job]?.result !== 'skipped'));",
            'process.exit(1)',
          )(gate)
          // The event skip must not come back by any spelling. `always()`
          // above is a substring of the old conjunction, so without this the
          // check would pass on a reintroduced PR skip.
          && !/^ {4}if:.*github\.event_name != 'pull_request'/m.test(gate)
          // Same reasoning applied to the superseded accounting itself: the
          // three literals above are all positive, so re-adding
          // `required.splice(required.indexOf('integration-tests'), 1)`
          // alongside them would satisfy this check while restoring the
          // mutation-based shape. That shape is the direct cause of both
          // defects above — it removes a job from `required` at runtime
          // instead of classifying it, which is why `e2e-critical-paths`
          // ended up on no list at all for push/dispatch. Classification, not
          // mutation, is the invariant.
          //
          // Scoped to `gate` and to the literal `required.splice(` on
          // purpose. Verified 2026-08-12: ci.yml contains exactly one match
          // for "splice" anywhere — the word "spliced" in a shell-quoting
          // comment at line ~2424, far outside the ci-gate block and not a
          // match for this literal — so this guard has no false positive to
          // trip on today.
          && !gate.includes('required.splice(')
          // Restored 2026-08-11: the four governance jobs 409123b5 dropped
          // must be BOTH declared dependencies and members of the gate
          // script's `required` array. A `needs` entry missing from
          // `required` is unenforced; a `required` entry missing from `needs`
          // resolves to undefined and fails on lookup. Requiring both means
          // the gate aggregates the identical job set on a PR and on the push
          // that merges it — the only condition under which a green PR is
          // evidence that main will stay green.
          && ['selected-school-rpc-integration', 'protected-flag-migration-guard', 'foxy-alignment', 'gen-mol-matrix']
            .every((job) => gate.includes(`      - ${job}`) && gate.includes(`'${job}'`))
          && includesAll('Trusted integration job requires', 'exit 1')(mappingEntryBlock(text, 'integration-tests', 2))
          && mappingEntryBlock(text, 'health-check', 2) === ''
          && includesAll('POLL_WINDOW_SECONDS=600', 'while [ "$SECONDS" -lt "$DEADLINE" ]; do', 'EXPECTED_SHA=', "b.ok===true&&b.status==='healthy'", "b.version?.git_sha||''")(deployHealth)
          && !deployHealth.includes('sleep 60')
          && !/soft[- ]pass|soft-success/i.test(deployHealth);
      },
      failure: 'CI must aggregate required jobs and must NOT duplicate the production health poll; deploy-production.yml must poll healthy exact SHA for about ten minutes without soft-pass.',
    },
    {
      id: 'vercel-authority-cutover-safe',
      label: 'Vercel Git main cannot be disabled before CLI is authoritative',
      // apps/host/vercel.json is the authoritative deploy config (Vercel
      // project root dir = apps/host). The root copy was deleted 2026-08-03;
      // ci.yml's quality job guards against it reappearing.
      file: 'apps/host/vercel.json',
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
