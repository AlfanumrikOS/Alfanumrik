# Runbook: Branch Protection & Required Status Checks for `main`

**Date filed:** 2026-06-27
**Owner:** ops
**Severity:** HIGH (release integrity)
**Status:** APPLIED, live-verified 2026-07-12. `main` requires the strict, GitHub-Actions-app-bound aggregate `CI Gate`, one independent approval, stale-review dismissal, approval after the last push, conversation resolution, administrator enforcement, and no force-push/deletion.

This runbook captures a verified architect finding from the 2026-06-27 release-integrity
audit so it is durably actionable. It documents why `main` is currently unprotected, the
one-time (paid) prerequisite the user must action, and the exact remediation + verification
commands to run afterward.

The June findings and commands below are retained as history. They are
superseded by the live state above: the earlier claim that five required checks
were active had drifted and was false when re-audited on 2026-07-11.

---

## Problem / why this exists

On 2026-06-27, **PR #1141 merged to `main` while its "Lint, Type-check & Test" CI job was
FAILING**, turning `main` red and breaking the Production deploy.

Root cause: **`main` has NO branch protection, and it cannot be enabled on the current
GitHub plan.**

| Probe | Result |
|---|---|
| `GET /repos/AlfanumrikOS/Alfanumrik/branches/main` | `"protected": false` |
| `GET /repos/AlfanumrikOS/Alfanumrik/branches/main/protection` | HTTP 403 — "Upgrade to GitHub Pro or make this repository public" |
| `GET /repos/AlfanumrikOS/Alfanumrik/rulesets` | HTTP 403 — same upgrade message |

The repo is **private + owned by a User account**; the token has full `repo` scope — so the
403 is a **PLAN-TIER limit** (GitHub Free has no branch protection on private repos), **not a
permissions issue**. Result: nothing prevents a red or unreviewed PR from merging to the
Vercel (bom1/Mumbai) production branch.

---

## Prerequisite (user action — costs money)

Branch protection on a private repo is a paid capability. Enable it via **ONE** of:

- **Option A (recommended): Upgrade the `AlfanumrikOS` account to GitHub Pro (~$4/mo).**
  Settings → Billing → Plans. Unlocks branch protection + rulesets on private repos. Lowest
  cost, no structural change to the repo.
- **Option B: Transfer the repo into a GitHub Team org (~$4/user/mo).** Adds org-level RBAC
  on top of branch protection. Do this later, when there is more than one engineer.
- **Option C: Make the repo public.** **REJECTED** — proprietary code.

Until one of these is done, the remediation below will continue to return HTTP 403 and the
production branch remains unguarded.

---

## Remediation command

Run **after** the plan upgrade. No protection exists yet, so this is a full **PUT** (creates
the protection object in one call):

```bash
gh api -X PUT repos/AlfanumrikOS/Alfanumrik/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint, Type-check & Test","Secret Scanning","Edge Function Deno Tests","Integration Tests (live DB)","Production Build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

### What each setting does

| Setting | Value | Effect |
|---|---|---|
| `required_status_checks.strict` | `true` | The PR branch must be **up to date with `main`** before it can merge (re-runs checks against the latest base, so a stale green can't slip through). |
| `enforce_admins` | `true` | **Even the repo owner cannot merge past a red check** — this is THE fix for what happened on 2026-06-27. Also blocks force-push to `main`. |
| `required_pull_request_reviews` | `null` | A solo account **cannot approve its own PR**, so requiring a review would deadlock every merge. Leave `null` for now. Change to `{"required_approving_review_count":1}` once on a multi-engineer Team org (Option B). |
| `restrictions` | `null` | No per-user/team push allowlist (not needed for a solo/small repo). |

### Do NOT add these to `required_status_checks.contexts`

Adding a non-deterministic, advisory, or push-only check as *required* would permanently
deadlock PRs (they can never reach "all required checks green"):

- **`E2E Tests`** — runs `continue-on-error`; flaky by design, not a merge gate.
- **`Post-Deploy Health Check`** — runs on push to `main`, **after** merge; can never be
  green on a PR.
- **`Vercel`, `Supabase Preview`, `Vercel Agent Review`** — preview/advisory bots, not
  deterministic pass/fail gates.
- **`E2E Critical Paths (blocking)`** — *optional* to add later if it proves stable; leave
  out of the initial set.

---

## Verify

```bash
gh api repos/AlfanumrikOS/Alfanumrik/branches/main/protection/required_status_checks \
  --jq '{strict:.strict,contexts:.contexts}'
gh api repos/AlfanumrikOS/Alfanumrik/branches/main --jq '.protected'   # expect: true
```

Expected: the first call echoes `strict: true` and the 5 required contexts; the second
returns `true`.

---

## Maintenance rule

- Required-check context names **must byte-match** the names produced by the workflow (the
  same strings shown by `gh pr checks`). A required context that never reports (because the
  job was renamed) will **block every PR forever** — GitHub waits indefinitely for a check
  that will never arrive.
- **Whenever a job is renamed in `.github/workflows/ci.yml`, update the `contexts` array in
  the same change** (re-run the PUT above with the corrected list).
- **Emergency override** (e.g. a required check is wedged and a hotfix must land): temporarily
  set `enforce_admins:false`, merge the hotfix, then **immediately restore `enforce_admins:true`**.
  Treat the window as open until restored.
- **2026-07-20 (CI speed-up — context name deliberately preserved):** the check named
  `Lint, Type-check & Test` is now produced by the `unit-tests-merge` **fan-in** job in
  `ci.yml`, which fans in over `Lint & Type-check` (the renamed `quality` job) plus the 4
  `Unit Tests (shard N/4)` matrix jobs, re-merges shard reports (`--merge-reports`), and
  enforces the coverage thresholds from the root `vitest.config.ts`. The context name was
  kept byte-identical on purpose and its semantics are unchanged (it is green iff
  lint + type-check + all unit tests + coverage floors pass), so **no branch-protection
  PUT is needed** for this change. The fan-in runs with `if: always()` and re-asserts
  `needs` success explicitly, so a failed/skipped shard can never satisfy the check.
- **Re-run semantics (2026-07-20):** the shard blob artifacts (`vitest-blob-shard-N`) are
  uploaded with `retention-days: 1`. Using **"Re-run failed jobs"** on `unit-tests-merge`
  more than ~24h after the original run will fail at the blob-download step because the
  artifacts have expired — the remedy is **"Re-run all jobs"** (which regenerates the
  shards). Same-day shard re-runs are safe: `overwrite: true` on the upload prevents 409
  artifact-name conflicts. The fan-in cannot merge partial blobs — its first step requires
  every shard (and `quality`) to have concluded `success` before any download/merge happens.

---

## Cross-references

- CI workflow (source of the required-check names): `.github/workflows/ci.yml`
- CI pipeline-failure alerting (out-of-band `workflow_run` watcher that flags a red `main`):
  REG-130 in `.claude/regression-catalog.md`
- Related release-gate sequence: `.claude/skills/release-gates/SKILL.md`
