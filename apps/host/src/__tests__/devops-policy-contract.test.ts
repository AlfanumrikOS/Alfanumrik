import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReleaseGatePlan } from '../../../../scripts/product-readiness-release-gate';
import {
  buildDevopsPolicyChecks,
  productionDeploymentAuthorityIsSafe,
  runDevopsPolicyChecks,
} from '../../../../scripts/verify-devops-policy-contract';

/**
 * Applies a single mutation to `text`, failing LOUDLY if `find` is not present.
 *
 * WHY THIS EXISTS (2026-08-09): every `.pass(text.replace(find, replace))`
 * assertion below is a mutation test — it proves the policy check REJECTS a
 * degraded workflow. `String.prototype.replace` returns the input unchanged
 * when `find` does not match. So the instant a search literal goes stale
 * (workflow edited, whitespace shifted, CRLF, a job's `needs` list extended),
 * the "mutant" becomes byte-identical to the clean file, `pass()` correctly
 * returns TRUE, and the assertion `.toBe(false)` fails — or, far worse for the
 * inverse-polarity case, silently passes while testing nothing at all.
 *
 * This is not hypothetical. The CRLF variant of it is documented at length in
 * the release-mutation test below, and on 2026-08-09 the real thing happened:
 * a workflow change appended `migrations, deploy-functions` to the completion
 * gate's `needs`, which stranded the literal
 * `needs: [health-check, post-deploy-verify, release]` — a rot the raw
 * `.replace()` had no way to report as "stale literal" rather than "policy
 * regression".
 *
 * A non-matching search string must be a loud, self-describing failure, never
 * a spurious pass and never an ambiguous one. This helper asserts presence
 * BEFORE mutating, and asserts the mutation actually changed the text after.
 * It deliberately does not change WHAT any mutation asserts.
 */
function mutate(text: string, find: string, replace: string): string {
  if (!text.includes(find)) {
    throw new Error(
      'STALE MUTATION LITERAL: the search string below was not found in the source text, so '
      + '`.replace()` would silently no-op and this mutation would assert nothing against an '
      + 'UNMUTATED file. This is a rotted test, not necessarily a policy regression — re-read the '
      + 'current source and update the literal verbatim, preserving what the mutation means.\n'
      + `--- search string (${find.length} chars) ---\n${find}\n--- end ---`,
    );
  }

  const mutated = text.replace(find, replace);
  if (mutated === text) {
    throw new Error(
      'NO-OP MUTATION: the search string was found but replacing it produced byte-identical text '
      + '(is `replace` equal to `find`?). The mutation assertion would be vacuous.\n'
      + `--- search string ---\n${find}\n--- end ---`,
    );
  }

  return mutated;
}

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

  it('rejects a reintroduced ci.yml health-check duplicate (P0-4: poll lives only in deploy-production.yml)', () => {
    // P0-4 (2026-08-03): ci.yml's post-deploy health-check job was deleted as a
    // duplicate of deploy-production.yml's. The contract now asserts the
    // bounded exact-SHA poll in deploy-production.yml (which the check reads
    // itself) and that ci.yml carries NO health-check job at all.
    const ci = readFileSync(resolve(__dirname, '../../../../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
    const checks = buildDevopsPolicyChecks();
    const ciGate = checks.find((check) => check.id === 'ci-gate-and-exact-sha-poll');
    expect(ciGate?.pass(ci)).toBe(true);

    const reintroduced = `${ci}\n  health-check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo duplicate poll\n`;
    expect(ciGate?.pass(reintroduced)).toBe(false);
  });

  it('rejects a reintroduced id-token: write grant on the break-glass run job (P2-6: least privilege after AWS decommission)', () => {
    // P2-6 (2026-08-03): AWS OIDC (configure-aws-credentials) was the only
    // consumer of id-token: write; the grant was removed with the AWS
    // decommission. The contract enforces the grant stays gone via the yaml-key
    // form, NOT the substring — the removal-rationale comment in the workflow
    // still contains the literal text "id-token: write", so a substring guard
    // would false-fail on the clean tree. Normalize CRLF -> LF first so the
    // LF-only injection literal below is not a silent no-op on a Windows checkout.
    const workflow = readFileSync(
      resolve(__dirname, '../../../../.github/workflows/production-cron-runner.yml'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const checks = buildDevopsPolicyChecks();
    const breakGlass = checks.find((check) => check.id === 'production-cron-break-glass');

    // Clean tree: removal-rationale comment carries the substring but no grant.
    expect(breakGlass?.pass(workflow)).toBe(true);

    // Reintroducing a real yaml-key grant under the run job's permissions block
    // must trip the check.
    const regranted = mutate(
      workflow,
      '      # Removed with the 2026-08-03 AWS decommission; least privilege restored.\n      contents: read',
      '      # Removed with the 2026-08-03 AWS decommission; least privilege restored.\n      contents: read\n      id-token: write',
    );
    expect(regranted).not.toBe(workflow); // guard against a silent no-op replace
    expect(breakGlass?.pass(regranted)).toBe(false);
  });

  it('rejects unsafe release rollback/tag and Vercel authority mutations', () => {
    // Normalize CRLF -> LF before reading. On a Windows checkout with
    // core.autocrlf=true (documented precedent in .gitattributes, which only
    // narrowly pins *.sql to eol=lf), this file is materialized on disk with
    // CRLF line endings while every mutation string below is an LF-only
    // literal. Without normalizing, `.replace()` silently no-ops (finds no
    // match), the "mutated" text equals the original, and every
    // `.pass(mutated)).toBe(false)` assertion below spuriously passes on a
    // release job whose if-condition was NEVER actually mutated — masking a
    // real regression instead of catching one. Normalizing makes this
    // assertion environment-independent without weakening it.
    const workflow = readFileSync(resolve(__dirname, '../../../../.github/workflows/deploy-production.yml'), 'utf8').replace(/\r\n/g, '\n');
    const checks = buildDevopsPolicyChecks();
    const release = checks.find((check) => check.id === 'production-release-control');
    expect(release?.pass(workflow)).toBe(true);

    // Every mutation below goes through `mutate()`, NOT a bare `.replace()`, so
    // that a search literal which has drifted out of the workflow fails loudly
    // as "stale literal" instead of quietly asserting against an unmutated file.
    // See the helper's docblock for the 2026-08-09 incident that motivated it.
    expect(release?.pass(mutate(workflow, "steps.health.outputs.rollback_authorized == 'true'", "steps.health.outputs.rollback_authorized != 'false'"))).toBe(false);
    expect(release?.pass(mutate(workflow, "b.ok===false&&['degraded','unhealthy'].includes(b.status)", "b.ok!==true"))).toBe(false);
    expect(release?.pass(mutate(workflow, 'if [ "$SEMANTIC_UNHEALTHY" = "true" ]; then CURRENT_SHA_UNHEALTHY=1; fi', 'if [ "$SEMANTIC_UNHEALTHY" != "false" ]; then CURRENT_SHA_UNHEALTHY=1; fi'))).toBe(false);
    expect(release?.pass(mutate(workflow, '[ "$SEMANTIC_UNHEALTHY" != "true" ]', '[ "$SEMANTIC_UNHEALTHY" = "false" ]'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'if [ "$BYPASS_BLOCKED" -gt 0 ]; then', 'if [ "$BYPASS_BLOCKED" -gt 0 ] && [ "$BYPASS_BLOCKED" = "$PROBES" ]; then'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'rollback_baseline_valid:', 'rollback_candidate_valid:'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'ROLLBACK_VERIFY_WINDOW_SECONDS=300', 'ROLLBACK_VERIFY_WINDOW_SECONDS=0'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"', 'vercel promote "$ROLLBACK_BASELINE_DEPLOYMENT_ID"'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"', 'vercel ls --prod\n          vercel rollback "$ROLLBACK_BASELINE_DEPLOYMENT_ID"'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'if [ "$PRODUCTION_MIGRATIONS_CHANGED" = "true" ] || [ "$EDGE_FUNCTIONS_CHANGED" = "true" ]; then', 'if false; then'))).toBe(false);
    expect(release?.pass(mutate(workflow, "${{ !cancelled()\n      && needs.health-check.result == 'success'", "${{ needs.health-check.result == 'success'"))).toBe(false);
    expect(release?.pass(mutate(workflow, "${{ !cancelled()\n      && github.ref == 'refs/heads/main'", "${{ github.ref == 'refs/heads/main'"))).toBe(false);
    expect(release?.pass(mutate(workflow, "      && needs.post-deploy-verify.result == 'success'\n", ''))).toBe(false);
    expect(release?.pass(mutate(workflow, 'if: ${{ always() }}\n    steps:\n      - name: Enforce terminal production release outcomes', 'if: ${{ success() }}\n    steps:\n      - name: Enforce terminal production release outcomes'))).toBe(false);

    // The completion gate's `needs` list. Read verbatim from the workflow — it
    // grew `migrations, deploy-functions` in the 2026-08-09 Wave 1 change, which
    // is exactly what stranded the previous literal. Dropping `release` from the
    // gate's dependencies must still be rejected.
    const completionNeeds = 'needs: [health-check, post-deploy-verify, release, migrations, deploy-functions]';
    expect(release?.pass(mutate(workflow, completionNeeds, 'needs: [health-check, post-deploy-verify, migrations, deploy-functions]'))).toBe(false);
    // Wave 1 invariant: the completion gate must depend on the migration lane,
    // so a green production release cannot be declared without verified database
    // state. Dropping `migrations` from the gate's dependencies must be rejected.
    expect(release?.pass(mutate(workflow, completionNeeds, 'needs: [health-check, post-deploy-verify, release, deploy-functions]'))).toBe(false);

    expect(release?.pass(mutate(workflow, 'RELEASE_RESULT: ${{ needs.release.result }}', 'RELEASE_RESULT: success'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'EXPECTED_SHA: ${{ github.sha }}', 'EXPECTED_SHA: stale-sha'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'require_equal "Release result" "$RELEASE_RESULT" "success"', 'echo "$RELEASE_RESULT"'))).toBe(false);
    expect(release?.pass(mutate(workflow, 'echo "Production release completion evidence is incomplete."\n            exit 1', 'echo "Production release completion evidence is incomplete."\n            exit 0'))).toBe(false);

    // apps/host/vercel.json is the authoritative deploy config — the repo-root
    // copy was deleted 2026-08-03 (ci.yml quality job guards its reappearance).
    const vercel = readFileSync(resolve(__dirname, '../../../../apps/host/vercel.json'), 'utf8');
    const unsafe = JSON.stringify({ ...JSON.parse(vercel), git: { deploymentEnabled: { main: false } } });
    expect(productionDeploymentAuthorityIsSafe(vercel, workflow)).toBe(true);
    expect(productionDeploymentAuthorityIsSafe(unsafe, workflow)).toBe(false);
  });
});
