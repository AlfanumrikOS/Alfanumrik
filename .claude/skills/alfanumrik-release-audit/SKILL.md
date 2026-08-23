---
name: alfanumrik-release-audit
description: Manual, full-platform, read-only production-readiness audit covering build, tests, security, RLS, migrations, performance, observability, and rollback readiness. Invoke explicitly before a launch or major release — never triggered automatically by Claude.
user-invocable: true
disable-model-invocation: true
argument-hint: "[scope]"
---

# Alfanumrik Release Audit

Scope: $ARGUMENTS

If no scope is given, audit the **full platform** — do not narrow silently. If a scope is given (e.g. "payments", "RLS", "a specific migration range"), audit that scope with the same rigor and note explicitly what was excluded.

This skill is read-only by default and requires explicit manual invocation — it must never be auto-triggered, and it must never fix, edit, commit, deploy, push, merge, or otherwise alter production or the repository. It produces a report. A human decides what to do with it.

## What this is not

- **Not `release-gates`** — that skill is the automatic, per-change, pre-push sequence (type-check/lint/test/build/domain-review/secrets) and stays that way. This skill defers to it for Gates 1-4 rather than re-deriving them: run the same commands, but as one part of a much wider sweep, not the whole of it.
- **Not `.claude/commands/audit-change.md`** — that command re-verifies one prior session's *claimed* change against the codebase. This skill does not re-derive a single report; it sweeps the whole platform independent of any specific claim.
- **Not a one-off, hand-authored audit write-up.** This skill is the durable, repeatable, re-runnable procedure -- a prior point-in-time audit document is a historical snapshot, not a substitute for re-running this procedure.

## Procedure

The stable, executable procedure lives in `docs/runbooks/audit-production-readiness.md` — read it and follow it; do not re-derive a competing procedure here. Its sections (verify current headers with `grep -n '^#' docs/runbooks/audit-production-readiness.md` — do not assume they haven't changed): When to run, How to run, Output expectation, Where prior audits are stored, Follow-up sessions, Rules.

Within that procedure, cover at minimum:

| Area | Source of truth (run the command, don't quote a remembered result) |
|---|---|
| Type/lint/test/build | `npm run type-check`, `npm run type-check:scripts`, `npm run lint`, `npm test`, `npm run build` |
| Bundle budget | `npm run check:bundle-size`; caps read via `grep -nE '^const CAP_' scripts/check-bundle-size.mjs` |
| Secrets | CI `secret-scan` job (Gitleaks + regex) — reproduce locally against `.gitleaks.toml` if invoked with that scope |
| Dependency vulnerabilities | `npm audit --json` and `npm audit --omit=dev --json`; treat an empty report as a tooling failure, not a clean pass (fail-closed, per the CI job's own posture) |
| Migrations | Migration-safety checks already in `.github/workflows/ci.yml` (RLS-on-CREATE-TABLE, protected-flag-migration guard); schema reproducibility per `docs/runbooks/schema-reproducibility-fix.md` |
| RLS / security review | Defer the checklist itself to `supabase-patterns`' Security & Governance Review section — apply it platform-wide here rather than per-migration |
| Backup/rollback | `docs/runbooks/per-school-backup-restore.md` |
| E2E | `npm run test:e2e` (Playwright) |

## Verdict categories

Every finding gets exactly one of these — do not blend them:

- **CONFIRMED FAILURE** — you ran the command/query yourself and it failed. State the command and its exact output.
- **RISK** — a real, evidenced exposure that has not (yet) caused an observed failure (e.g. a SECURITY DEFINER function without a pinned `search_path`, found by grep, but not proven exploited).
- **UNKNOWN** — you could not check it (no access, no live environment, ambiguous scope). Say what access or command would resolve it. Never guess and report it as a finding.

## Target-vs-implementation discipline

When a check compares an ADR/architecture-doc target against current code (e.g. "ADR-005 says learner state should route through the projector; does it?"), report **both**: what the target says, and what the code currently does. A gap between them is a finding to report, not something to silently resolve by picking one side or rewriting the doc.

## Rules

1. Read-only. No `git add`, `commit`, `push`, `merge`, deploy command, or production-altering call of any kind — ever, regardless of what the audit finds.
2. Report evidence: the exact command run and its exact output/exit code, not a paraphrase.
3. Do not quote a migration count, table count, function count, or defect total from memory or from a prior audit doc — re-derive it with a command, or mark it `UNMEASURED`.
4. Do not treat any untracked document as authoritative -- an untracked file has not been reviewed or committed. Cite only tracked sources and the output of commands you ran yourself.

## Output shape

```
# Release Audit — <scope> — <date you ran this, from `date`, not assumed>
## Summary: N confirmed failures, N risks, N unknowns
## Confirmed failures (evidence: command + output)
## Risks (evidence + why it's a risk, not yet a failure)
## Unknowns (what would resolve them)
## Target-vs-implementation gaps
## Deferred to release-gates / audit-change.md (explicitly out of this sweep's scope, and why)
```

## Review chain

This skill produces a report for the user; it does not itself trigger a review chain. If findings require a fix, route each fix through its owning domain agent per the normal routing table, then back through `release-gates` before push.
