# Runbook — Content-gap detection (question bank going empty)

**Owner:** ops · **Created:** 2026-08-11 · **Severity of the thing it watches:** SEV1

---

## Why this detector matters more than a normal nightly

**Every question generator on this platform is manual-only.** `bulk-question-gen`,
`bulk-non-mcq-gen`, `extract-ncert-questions` and `generate-answers` are only
reachable by a super-admin hand-firing `/api/super-admin/ai/[fn]`, and the
`quiz-generator` Edge Function contains no AI call at all.

The consequence: **the question bank can only get thinner.** Nothing refills it
automatically. If coverage decays, no user-facing surface will tell you — students
just start seeing repeats, then thin subjects, then nothing. This nightly is the
only automated warning that it is happening.

That is why the suspension described below was a SEV1 blind spot rather than a
routine paused workflow.

---

## History — read before changing the triggers

| Date | Event |
|---|---|
| Phase 3.3 | Workflow created. Nightly at 04:00 UTC, catastrophic gap = red gate. |
| 2026-07-11 | **HARD-SUSPENDED** by commit `b66c25c3b` ("ci: contain production delivery paths"). |
| 2026-08-11 | **Restored** report-only, main-only (this runbook). |

### The original suspension reason (it was legitimate)

Verbatim from the removed comment:

> HARD-SUSPENDED IN PHASE 0. The previous manual path could execute scripts from
> an arbitrary dispatch ref while holding the production Supabase service-role
> secret. Restore only behind a protected, main-only ops environment with a
> read-only reporting credential.

This was a **real** security hole, not bureaucracy. `workflow_dispatch` can be
fired against any ref; the credentialed job had no ref guard; so anyone able to
dispatch the workflow could run arbitrary branch-controlled script content while
holding the production Supabase service-role key. Suspending it was correct.

**It was NOT suspended for noise, and NOT for cost.** Both scripts are read-only
(two `SELECT`s each — no `INSERT`/`UPDATE`/`DELETE`/`RPC`) and make **zero paid
API calls**. Verified 2026-08-11 against `scripts/check-content-gaps.ts` and
`scripts/audit-question-quality.ts`.

### Restore conditions — 2 of 3 met

| Condition | Status | Where |
|---|---|---|
| Protected ops environment | **Met** | `environment: production-ops` on the job. Confirm required reviewers are configured in GitHub repo settings — the workflow file cannot assert that. |
| Main-only | **Met** | `if: github.ref == 'refs/heads/main'` on the credentialed job. `schedule` only fires on the default branch; a dispatch from any other ref now skips the job instead of running it with the secret. |
| Read-only reporting credential | **NOT MET** | See open decision OD-1 below. |

The containment property is pinned by the `content-scan-main-only-containment`
check in `scripts/verify-devops-policy-contract.ts`. It replaced the old blanket
`workflow_dispatch`-only pin, which was over-broad: it made restoring *any*
scheduled detection a contract violation.

---

## Current posture

| | |
|---|---|
| Schedule | `0 4 * * *` (04:00 UTC / 09:30 IST), just after the 03:30 UTC pg_cron readiness recompute |
| Job guard | `github.ref == 'refs/heads/main'` + `environment: production-ops` |
| Mode | **`report`** by default — data conditions never turn CI red |
| Escalation | Repo variable `CONTENT_GAP_MODE` = `escalate` |
| Output | Job summary + `content-quality-<run_id>` artifact (30-day retention) |
| Alerting | `pipeline-alert.yml` — deduped `pipeline-failure` GitHub issue, auto-closes on next green |

**Report-only is deliberate.** A nightly that is red every night gets muted within
a fortnight — that is exactly how this one ended up suspended. Do not flip
`CONTENT_GAP_MODE` to `escalate` until the detector has produced one trustworthy
run (see OD-2).

### What still fails, even in report mode

A missing or broken credential **fails the job in both modes**. A detector that
cannot see the data is worse than no detector, because it looks green. Provisioning
a secret is a two-minute ops task, not an unbudgeted data-repair project, so this
will not become chronic noise.

---

## Verdicts and triage

The verdict is computed by `scripts/content-gap-verdict.mjs` and printed at the
top of the job summary.

### `DETECTOR_ERROR` — always red

The script produced no readable report. Content health is **UNKNOWN, not healthy.**

1. Check the `Resolve reporting credential` step — is `SUPABASE_URL` present on
   the `production-ops` environment?
2. Check the `Check content gaps` step's exit code in the summary table.
3. Re-run via `workflow_dispatch` **from `main`** (a dispatch from any other ref
   will skip the job by design and conclude with no scan).

### `DETECTOR_FAULT` — never escalates, but must be fixed

Rows were read from the database, yet **every** (subject, grade) pair bucketed to
zero. Rows cannot vanish — the bucketing key is wrong.

**Known cause.** `scripts/check-content-gaps.ts` keys `rag_content_chunks` on
snake_case subject codes:

```
const ragKey = `${t.subject}|Grade ${g}`;   // t.subject === 'math'
```

but production `rag_content_chunks.subject` stores **display names**
(`'Mathematics'`, `'Science'`, `'Social Studies'`). The SQL RPCs in
`supabase/migrations/00000000000000_baseline_from_prod.sql` explicitly map
`'math' -> 'Mathematics'` before comparing; this script does not. With ~16,006
chunks in the corpus, a report of "0 chunks everywhere" is a detector bug, not an
empty corpus.

The verdict script detects this shape and downgrades `CATASTROPHIC` to
`DETECTOR_FAULT` so a mapping bug can never masquerade as an empty question bank.

**Fix belongs in the script** (a subject-code normaliser). The per-(subject,grade)
**floors are assessment-owned content policy and were deliberately not touched** —
this is a key-mapping defect, not a threshold question. See OD-2.

### `CATASTROPHIC` — red only when `CONTENT_GAP_MODE=escalate`

One or more (subject, grade) pairs have **0 RAG chunks AND 0 questions**.

1. Open the `content-quality-<run_id>` artifact for the per-pair table.
2. Cross-check against `/api/super-admin/grounding/coverage` and the
   `ingestion_gaps` view before concluding content is missing. Note
   `cbse_syllabus.rag_status='partial'` does **not** mean missing text — it also
   reads `partial` when questions are merely unverified.
3. If genuinely empty, generation is manual: a super-admin must fire
   `/api/super-admin/ai/[fn]`. Loop in **assessment** for content QA before
   anything reaches `question_bank` (P6).

### `BELOW_FLOOR` — advisory, never escalates

Pairs under the P3 readiness floors. Informational; feeds content planning.

### `HEALTHY`

Nothing to do.

---

## Do not silence this by re-suspending the workflow

That is how the previous month-long blind spot happened. If it is noisy:

1. Set `CONTENT_GAP_MODE=report` (default) — the signal keeps being produced and
   remains readable in the job summary and artifact, but nothing goes red.
2. Fix the underlying detector defect.

Removing the `schedule` trigger will now fail the
`content-scan-main-only-containment` policy contract check.

---

## Open decisions (require a human)

### OD-1 — Provision a read-only Supabase reporting credential

**Status: OPEN. Blocks the third restore condition.**

No read-only Supabase secret exists in this repository today; every workflow uses
`SUPABASE_SERVICE_ROLE_KEY`. The job therefore prefers
`secrets.SUPABASE_CONTENT_REPORT_KEY` and **falls back to the service-role key**
so that detection works now.

This is an explicit, deliberate deviation from the written restore condition. It
is recorded here rather than papered over. To close it:

1. Create a Postgres role with `SELECT` on `rag_content_chunks` and
   `question_bank` only, and mint a PostgREST JWT for it.
2. Add it as `SUPABASE_CONTENT_REPORT_KEY` on the `production-ops` environment.
3. Delete the `|| secrets.SUPABASE_SERVICE_ROLE_KEY` fallback in the workflow.

Until then, each run emits a `::warning::` naming the gap.

**Owner: architect (credential/RBAC) + ops.**

### OD-2 — Fix the subject-code mapping, then flip to `escalate`

**Status: OPEN.**

Strong static evidence (see `DETECTOR_FAULT` above) says the first live run will
report zero chunks for every pair. Until a normaliser lands and one run returns a
trustworthy `HEALTHY` / `BELOW_FLOOR` / genuine `CATASTROPHIC` verdict, leave
`CONTENT_GAP_MODE` unset (report mode).

Sequence: ops fixes the normaliser → assessment confirms the subject/grade mapping
matches content policy → one clean nightly → flip `CONTENT_GAP_MODE=escalate`.

**Owner: ops (fix) + assessment (validate mapping).**

### OD-3 — Unpaginated reads may silently truncate counts

**Status: OPEN, unverified.**

`scripts/check-content-gaps.ts` issues bare `.select()` calls with no `.range()`
pagination loop. If the Supabase project sets `db-max-rows`, the row set is
truncated at a round number and **every count under-reports**, spuriously breaching
the floors. The verdict script suppresses escalation when totals land exactly on a
suspected page boundary (1,000 / 10,000 / 100,000), but that is a guard, not a fix.

Verify the project's `db-max-rows` setting; if set, add a pagination loop.

**Owner: ops (script) + architect (project config).**

---

## Related

- Workflow: `.github/workflows/content-quality-nightly.yml`
- Verdict logic: `scripts/content-gap-verdict.mjs`
- Detector: `scripts/check-content-gaps.ts` (thresholds = assessment-owned)
- Advisory audit: `scripts/audit-question-quality.ts`
- Alerting: `.github/workflows/pipeline-alert.yml`
- Containment contract: `scripts/verify-devops-policy-contract.ts`
  (`content-scan-main-only-containment`)
