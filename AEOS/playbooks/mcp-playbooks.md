# MCP Operational Playbooks

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Playbook / Checklist
**Priority:** Critical
**Applies To:** Every MCP-mediated operation against a live external system — AWS, GitHub, Supabase and other databases, browser and Playwright automation, monitoring platforms — performed by Claude Code on the Alfanumrik platform.

---

# Purpose

Core document 16 defines the principles for interacting with external systems through the Model Context Protocol: observe before modifying, verify after modifying, never claim success without evidence. This playbook operationalizes those principles. It turns the eight-stage MCP loop into concrete, repeatable procedures an AI engineer can execute against the real servers the platform depends on.

These playbooks do not relax any rule in document 16. They make the rules executable. Where a playbook and a core document appear to differ, the core document and the project-root product invariants prevail.

---

# The MCP Operational Loop

Every MCP operation, regardless of server, follows the loop defined in document 16. Each stage gates the next, and each stage produces evidence.

```text
Observe
        v
Understand
        v
Plan
        v
Assess Risk
        v
Execute
        v
Verify
        v
Document
        v
Report
```

Stage intent, applied operationally:

- **Observe** — read the current state of the target object before touching it. Never assume state.
- **Understand** — explain what the observed state means and why the change is needed.
- **Plan** — state the smallest change that achieves the goal, and how it will be reversed.
- **Assess Risk** — classify the operation as read-only, reversible-write, or destructive; identify blast radius.
- **Execute** — perform the planned change only; no unrelated edits ride along.
- **Verify** — re-observe and confirm the system serves the intended new behavior.
- **Document** — record what changed, where, and the evidence collected.
- **Report** — present the result classified as verified, observed, inferred, or unknown.

Skipping a stage is prohibited unless it is explicitly not applicable, with the reason stated.

---

# Operating Disciplines

These disciplines apply across every MCP server. They are the connective tissue between the loop above and the per-server playbooks below.

## Read Before Write

No mutation begins until the current state of the target has been inspected. The inspection output is the baseline against which the change is later verified. An operation that mutates an object never inspected is an operation with no way to prove its effect.

## Dry Run First

Where the server or CLI supports a dry run, plan preview, or diff mode, run it before applying any destructive or high-impact change. Review the predicted effect against the plan. A dry run that reveals an unexpected effect halts the operation and returns it to the Understand stage.

## Minimum Change

Modify only what the task requires. No opportunistic refactors, no unrelated config edits, no broad sweeps during an operational task. The smallest safe change is the most verifiable and the most reversible.

## Idempotency

Prefer operations that produce the same end state whether run once or many times. Idempotent operations survive retries, partial failures, and concurrent runs without corrupting state. Where an operation is not naturally idempotent, guard it with a precondition check.

## Destructive-Operation Confirmation

The destructive operations enumerated in document 16 — deleting a database, bucket, repository, or service; removing IAM roles; rotating production secrets; dropping tables; force-pushing protected branches; destroying infrastructure — require explicit human confirmation. Claude Code never infers intent for a destructive action. The confirmation, and what was confirmed, becomes part of the record.

## Secret Handling

Secrets reached through MCP are never printed, logged, embedded in source, summarized verbatim, or written into generated documentation. Claude Code may confirm that a secret exists or is configured without ever exposing its value. A report states "the webhook signing secret is present in the environment," never the secret itself.

## Evidence Before Reporting

Every executed action produces evidence: an API response, CLI output, a resource status, a log line, a health-check result, a screenshot. If evidence cannot be collected, the operation is reported as verification-incomplete, never as success. This is the direct application of document 10: evidence overrides confidence.

---

# Per-Server Quick Playbooks

Each playbook below is the operational loop bound to a specific MCP server. Read the loop and the disciplines first; the playbooks assume them.

## AWS

Read-before-write targets: ECS service, task definition, CloudWatch logs and metrics, secrets references, IAM, load balancer.

1. **Observe** — confirm the active account and region first; both are easy to assume and dangerous to get wrong. Read the current resource state (service desired/running count, task definition revision, target-group health).
2. **Understand** — identify resource dependencies and the rollback strategy before planning the change.
3. **Plan** — define the smallest change (for example, a new task-definition revision) and the path back to the prior revision.
4. **Assess Risk** — is this reversible-write (deploy a new revision) or destructive (delete a service, remove an IAM role)? Destructive requires confirmation.
5. **Execute** — apply the planned change only. Prefer registering a new revision over mutating in place.
6. **Verify** — re-read service status, watch deployment roll out, confirm target-group health and CloudWatch error/latency within bounds.
7. **Document & Report** — record account, region, prior and new revision, health evidence, and rollback path.

Concrete provider mechanics (region values, timeouts, dashboard controls) live in the extensions layer — `aws.md`, `ecs.md`, `cloudfront.md`.

## GitHub

Read-before-write targets: branch state, pull request, workflow run, repository protection rules, secrets and variables (existence only).

1. **Observe** — read branch status, CI state, merge-conflict state, and required-review rules.
2. **Understand** — confirm the change respects repository governance; never plan to bypass protection.
3. **Plan** — define the branch, the commit scope, and the PR target.
4. **Assess Risk** — a force-push to a protected branch is destructive and requires confirmation; opening a PR is reversible.
5. **Execute** — push to a feature branch and open a reviewed pull request; never commit directly to a protected branch.
6. **Verify** — confirm CI gates ran and their results; confirm the PR reflects the intended diff and no secrets are staged.
7. **Document & Report** — record branch, PR identifier, CI gate results, and review requirements outstanding.

The pipeline gates these PRs feed are defined in document 20; provider specifics live in `github-actions.md`.

## Supabase

Read-before-write targets: schema, RLS policies, auth configuration, edge functions, storage.

1. **Observe** — inspect the current schema, the RLS policies on affected tables, and existing migrations. Never assume schema shape.
2. **Understand** — identify affected objects, backward-compatibility impact, and which product invariants the change touches (RLS boundary, data privacy).
3. **Plan** — author an ordered, idempotent, backward-compatible migration; every new table carries RLS plus policies in the same migration.
4. **Assess Risk** — dropping a table or column is destructive and requires confirmation and a compensating plan; an additive column is reversible.
5. **Execute** — apply the migration through the controlled path; prefer additive change. Run a dry run or diff where available before applying.
6. **Verify** — re-inspect the schema and policies, confirm RLS is enabled, and confirm the application can read and write through the RLS-scoped client. Confirm no service-role key reaches any client surface.
7. **Document & Report** — record the migration applied, its result, RLS posture, and the rollback or compensating migration.

Destructive schema changes additionally require approval per the project constitution. Provider mechanics live in `supabase.md`.

## Browser / Playwright

Read-before-write framing: browser automation is mostly observation, but it acts on live surfaces, so the same loop applies.

1. **Observe** — load the target surface and capture its starting state (URL, key elements, console state).
2. **Understand** — define the user journey being verified and the expected end state.
3. **Plan** — script the minimal interaction sequence; avoid steps that mutate production data without approval.
4. **Assess Risk** — running against production is read-mostly; any step that writes (submitting a form, triggering a payment) is treated as a reversible-write or destructive action and gated accordingly.
5. **Execute** — run the scripted journey deterministically; one journey at a time.
6. **Verify** — assert the expected end state, capture a screenshot as evidence, and confirm no console errors and no PII captured in artifacts.
7. **Document & Report** — record the journey, pass/fail, the screenshot reference, and any anomalies.

Playwright supplies the critical-journey evidence consumed by the QA sign-off gate (document 27).

---

# Failure Handling

When any MCP operation fails, follow document 16's failure sequence: preserve evidence, capture the error output, determine the root cause, avoid blind retries, recommend a corrective action, and re-verify after resolution. A retry is permitted only when accompanied by a hypothesis for why the outcome should differ — the debugging discipline of document 22 applies. Failures are never concealed.

---

# Reporting

Every MCP execution report carries the structure mandated by document 16: objective, systems accessed, actions performed, evidence collected, verification status, risks, remaining work, recommendations. Every claim is classified as **verified** (executed and observed), **observed** (confirmed by inspection), **inferred** (reasoned), or **unknown**. Inferred and unknown are never presented as verified.

---

# When MCP Access Is Unavailable

If the required MCP server, credential, or permission is not available, state this explicitly. Provide implementation guidance, an execution plan, and a verification checklist — but never claim that execution occurred. Per document 10, the absence of a result is treated as a failure, never as a pass.

---

# Definition of a Complete MCP Operation

An MCP operation is complete only when the action executed, evidence was collected, verification was performed, risks were documented, and a report was generated. Anything short of all five is partially complete and must be reported as such.

---

# References

- `08_TESTING_PROTOCOL.md` — The verification suite and regression discipline that MCP-driven changes must satisfy.
- `09_SECURITY_PROTOCOL.md` — Least privilege, secret handling, and security gating that govern every MCP credential and operation.
- `10_VERIFICATION_ENGINE.md` — The evidence-over-confidence execution model underlying every "observe then verify" loop in this playbook.
- `16_MCP_CONFIGURATION.md` — The core MCP operations protocol this playbook operationalizes; the eight-stage loop, read-before-write, dry-run, idempotency, destructive-operation confirmation, and secret-handling rules originate here.
- `20_DEPLOYMENT_PIPELINE.md` — The deployment flow and gates that AWS, GitHub, and Supabase MCP operations feed into.
- `22_DEBUGGING_PROTOCOL.md` — The reproduce-first, no-blind-retry discipline applied when an MCP operation fails.
- `27_QA_SIGNOFF.md` — The sign-off gate that consumes the evidence MCP operations produce.
- `AEOS/docs/extensions/aws.md`, `ecs.md`, `cloudfront.md`, `github-actions.md`, `supabase.md`, `vercel.md` — Provider-specific mechanics (regions, timeouts, dashboard and CLI controls, secret stores) referenced by the per-server playbooks.

---

# Final Directive

MCP turns reasoning into execution, and execution carries responsibility. Observe before you change. Dry-run before you commit. Change the minimum. Verify against the system, not against your expectation. Confirm every destructive act with a human. Never expose a secret, and never report success without evidence.

A live operation you cannot verify is a live operation you cannot trust — and an untrusted change must never be presented as done.

**End of Document**
