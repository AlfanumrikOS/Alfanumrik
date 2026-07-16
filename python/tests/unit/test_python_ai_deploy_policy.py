"""Source-policy checks for the production Python AI deployment workflow.

Policy history:
- Originally the credentialed jobs (build-and-push, deploy, post-deploy-smoke)
  fired ONLY on a push to main — `workflow_dispatch` was byte-pinned absent.
- 2026-07-15 (Wave 3, PR #1289): `workflow_dispatch` was deliberately added as a
  bare, input-free trigger so an operator can ship the current main HEAD in a
  supervised window without a junk python/* commit. The security gate is
  UNCHANGED: every credentialed job still requires
  github.ref == 'refs/heads/main' AND
  vars.ENABLE_PYTHON_AI_PRODUCTION_DEPLOY == 'true' AND the GitHub `Production`
  environment protections (plus the WIF provider's independent ref
  restriction). Dispatch-enablement requires the operator window (ENABLE var
  flipped true + workflow enabled) — the manual trigger adds a way to START a
  run, never new privilege or a new deploy target.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "python-ai-deploy.yml"
# Byte-pinned `if:` condition for every credentialed job. Wave 3 (2026-07-15)
# widened the event to allow gated workflow_dispatch; main-ref + ENABLE-var
# pins are unchanged.
MAIN_REF_GATED_DEPLOY = (
    "if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') "
    "&& github.ref == 'refs/heads/main' "
    "&& vars.ENABLE_PYTHON_AI_PRODUCTION_DEPLOY == 'true'"
)


def _workflow_source() -> str:
    return WORKFLOW_PATH.read_text(encoding="utf-8")


def _job_block(source: str, job_name: str) -> str:
    pattern = re.compile(
        rf"^  {re.escape(job_name)}:\n.*?(?=^  [a-z][a-z0-9-]*:\n|\Z)",
        flags=re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(source)
    assert match is not None, f"missing workflow job: {job_name}"
    return match.group(0)


def test_manual_dispatch_is_input_free_and_no_non_main_deploy_path() -> None:
    source = _workflow_source()

    # Wave 3 (2026-07-15): workflow_dispatch is allowed, but ONLY as a bare,
    # input-free trigger — exactly one occurrence, and no inputs that could
    # steer the deploy away from the fixed production target.
    assert source.count("workflow_dispatch:") == 1
    assert "inputs:" not in source
    assert "branches: [main]" in source
    assert "CLOUD_RUN_SERVICE_STAGING" not in source
    assert "github.event.inputs" not in source
    assert "steps.target.outputs" not in source
    assert "Pick target service" not in source
    assert "CLOUD_RUN_SERVICE_PROD: ai-services" in source
    # 4 = the 3 credentialed-job `if:` gates + 1 verbatim quote in the Wave 3
    # header doc comment (Triggers section). The next assertion proves the 3
    # job gates are each the FULL byte-pinned condition, so a fourth job
    # sneaking in a bare ENABLE check cannot hide inside this count.
    assert source.count("vars.ENABLE_PYTHON_AI_PRODUCTION_DEPLOY == 'true'") == 4
    # The gated condition appears exactly once per credentialed job — no
    # weaker workflow_dispatch-reachable variant exists anywhere else.
    assert source.count(MAIN_REF_GATED_DEPLOY) == 3


def test_every_credentialed_job_is_main_only_and_production_protected() -> None:
    source = _workflow_source()

    for job_name in ("build-and-push", "deploy", "post-deploy-smoke"):
        block = _job_block(source, job_name)
        assert MAIN_REF_GATED_DEPLOY in block
        assert "environment: Production" in block
        assert "uses: google-github-actions/auth@v2" in block

    assert source.count("uses: google-github-actions/auth@v2") == 3


def test_cloud_run_is_private_and_smoke_uses_google_identity_token() -> None:
    source = _workflow_source()
    deploy = _job_block(source, "deploy")
    smoke = _job_block(source, "post-deploy-smoke")

    assert "--invoker-iam-check" in deploy
    assert "--no-invoker-iam-check" not in deploy
    assert "remove-iam-policy-binding" in deploy
    assert "for MEMBER in allUsers allAuthenticatedUsers" in deploy
    assert 'member="serviceAccount:${{ secrets.GCP_SERVICE_ACCOUNT }}"' in deploy
    assert "broad Cloud Run invokers remain" in deploy
    assert 'gcloud projects get-iam-policy "${PROJECT}"' in deploy
    assert "broad project Cloud Run invokers remain" in deploy
    replace_position = deploy.index("gcloud run services replace")
    pre_hardening_position = deploy.index("DESCRIBE_OUTPUT=$(gcloud run services describe")
    assert pre_hardening_position < replace_position
    assert deploy.count("harden_invocation") == 3
    assert deploy.count("assert_project_iam_private") == 3
    project_preflight_position = deploy.index(
        "# A project-level broad grant would be inherited by a new service."
    )
    assert project_preflight_position < replace_position
    assert "DESCRIBE_STATUS=$?" in deploy
    assert "NOT_FOUND|not found|could not be found|404" in deploy
    assert "Unable to establish existing Cloud Run IAM posture" in deploy
    # Smoke identity-token pins. 2026-07-16: the invoker ID token is minted by
    # the auth action (token_format: id_token → IAM Credentials generateIdToken
    # as the federated WIF principal) instead of `gcloud auth
    # print-identity-token --audiences=...`, which current gcloud refuses for
    # external_account (WIF) credentials without impersonation. Policy
    # semantics are UNCHANGED: smoke still authenticates as the deploy SA (the
    # sole roles/run.invoker principal) via WIF, audience-bound to the deployed
    # service URL, and presents the token on X-Serverless-Authorization.
    assert "print-identity-token" not in smoke
    assert "token_format: 'id_token'" in smoke
    assert "id_token_audience: ${{ needs.deploy.outputs.service_url }}" in smoke
    assert "id_token_include_email: true" in smoke
    assert smoke.count('ID_TOKEN="${{ steps.auth.outputs.id_token }}"') == 2
    assert "X-Serverless-Authorization: Bearer ${ID_TOKEN}" in smoke
    assert "::error::/readyz returned ${STATUS} (expected 200)" in smoke
    assert 'if [[ "${STATUS}" != "200" ]]' in smoke
    assert "::warning::/readyz" not in smoke


def test_manifest_render_is_fixed_to_production_origin() -> None:
    deploy = _job_block(_workflow_source(), "deploy")

    assert 'export ENVIRONMENT="production"' in deploy
    assert 'export ALLOWED_ORIGINS="https://alfanumrik.com"' in deploy
    assert "staging.alfanumrik.com" not in deploy
