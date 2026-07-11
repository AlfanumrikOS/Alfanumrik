"""Source-policy checks for the production Python AI deployment workflow."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "python-ai-deploy.yml"
MAIN_PUSH_ONLY = (
    "if: github.event_name == 'push' && github.ref == 'refs/heads/main' "
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


def test_workflow_has_no_manual_or_non_main_deploy_path() -> None:
    source = _workflow_source()

    assert "workflow_dispatch:" not in source
    assert "branches: [main]" in source
    assert "CLOUD_RUN_SERVICE_STAGING" not in source
    assert "github.event.inputs" not in source
    assert "steps.target.outputs" not in source
    assert "Pick target service" not in source
    assert "CLOUD_RUN_SERVICE_PROD: ai-services" in source
    assert source.count("vars.ENABLE_PYTHON_AI_PRODUCTION_DEPLOY == 'true'") == 3


def test_every_credentialed_job_is_main_only_and_production_protected() -> None:
    source = _workflow_source()

    for job_name in ("build-and-push", "deploy", "post-deploy-smoke"):
        block = _job_block(source, job_name)
        assert MAIN_PUSH_ONLY in block
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
    assert "print-identity-token" in smoke
    assert "X-Serverless-Authorization: Bearer ${ID_TOKEN}" in smoke
    assert "::error::/readyz returned ${STATUS} (expected 200)" in smoke
    assert 'if [[ "${STATUS}" != "200" ]]' in smoke
    assert "::warning::/readyz" not in smoke


def test_manifest_render_is_fixed_to_production_origin() -> None:
    deploy = _job_block(_workflow_source(), "deploy")

    assert 'export ENVIRONMENT="production"' in deploy
    assert 'export ALLOWED_ORIGINS="https://alfanumrik.com"' in deploy
    assert "staging.alfanumrik.com" not in deploy
