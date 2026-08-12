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
| 2026-08-11 | **Both detector preconditions closed in code** — canonical-column fix + real pagination. OD-2 and OD-3 CLOSED. Escalation still blocked on OD-1 and OD-4. |

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
| Protected ops environment | **Met in-file; settings action required** | `environment: production-ops` on the job. See "Required GitHub settings" immediately below — the workflow file cannot assert them. |
| Main-only | **Met** | `if: github.ref == 'refs/heads/main'` on the credentialed job. `schedule` only fires on the default branch; a dispatch from any other ref now skips the job instead of running it with the secret. |
| Read-only reporting credential | **NOT MET** | See open decision OD-1 below. |

### Required GitHub settings on the `production-ops` environment

These live in Settings → Environments → `production-ops`. They cannot be
expressed in the workflow file.

| Setting | Required value | Why |
|---|---|---|
| Deployment branch policy | **Selected branches → `main` only** | This is the setting that supplies containment. Pairs with the in-file `if: github.ref == 'refs/heads/main'` as defence in depth. |
| Required reviewers | **Leave EMPTY. Do not configure.** | See the warning below. |

> **Do NOT add required reviewers to `production-ops`.** An earlier revision of
> the workflow header asked for exactly that; it was wrong. This is an
> **unattended 04:00 UTC nightly**. A required reviewer makes every scheduled
> run park in *Waiting for approval* until it expires, so the detector goes
> permanently silent while the workflow still looks configured and enabled.
> That is the same green-but-blind failure mode this restore exists to
> eliminate — it would simply relocate the blind spot from a suspended
> workflow to a perpetually-pending one. Branch policy is the correct control
> here; a human gate is not.

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

Rows carrying both canonical taxonomy columns were read, yet **every**
(subject, grade) pair bucketed to zero. Rows cannot vanish — the bucketing key
is wrong.

**Historical cause — FIXED 2026-08-11 (OD-2 closed).** Two independent
all-zeros defects existed, and the diagnosis changed during the fix:

1. **RAG side.** The script keyed on snake_case codes (`'math'`) while reading
   the *legacy* `rag_content_chunks.subject` display-name column
   (`'Mathematics'`). The obvious fix — translate `'math' -> 'Mathematics'` —
   was **rejected**. `rag_content_chunks` stores the taxonomy twice, and the
   live retrieval path reads the *canonical* pair, so the script now reads
   that instead. See "Which columns the detector reads" below.
2. **question_bank side (previously unnoticed).** The script keyed
   `` `${subject}|Grade ${g}` `` while `chk_question_bank_grade_p5` constrains
   `question_bank.grade` to a **bare** `'6'`..`'12'`. That key matched zero
   rows in production. Nothing in the earlier analysis had caught this; the
   `DETECTOR_FAULT` guard would have fired on both sides at once.

Both sides now key on `'<snake_case_subject>|<bare grade>'`.

The verdict script keeps this guard, measured against **attributed** rows, so
the next mapping drift also cannot masquerade as an empty question bank. If the
verdict reappears, diff the distinct values of `subject_code` / `grade_short` /
`question_bank.subject` against `TARGET_SUBJECTS`.

The per-(subject, grade) **floors are assessment-owned content policy and were
deliberately not touched** — this was a key-mapping defect, not a threshold
question.

### `UNATTRIBUTED_CORPUS` — never escalates; backfill, not generation

Every active chunk read is missing `subject_code` and/or `grade_short`. The
script is reading the right columns; the **data** has no values in them.

Consequence: `match_rag_chunks_ncert` filters on exactly those two columns, so
RAG grounding returns nothing for every (subject, grade). It is a total
retrieval blackout — but it is **not** an empty question bank and must not be
reported as one. Fix is a backfill migration from the legacy `subject`/`grade`
display-name columns. **Owner: architect.**

Partial unattribution (the common case) does not produce this verdict; it is
reported as its own section and metric in every run. Treat a rising
`ragUnattributed` as the cheapest lever in the report.

---

## Which columns the detector reads, and why

`rag_content_chunks` stores grade and subject **twice**:

| Column | Example | Read by |
|---|---|---|
| `grade` | `'Grade 10'` | legacy `match_rag_chunks` (only `/api/concept-engine`) |
| `grade_short` | `'10'` (CHECK `'6'..'12'`) | **`match_rag_chunks_ncert`** |
| `subject` | `'Mathematics'` | legacy `match_rag_chunks` |
| `subject_code` | `'math'` | **`match_rag_chunks_ncert`** |

The detector reads **`subject_code` + `grade_short`** — the canonical pair.

**Why not the legacy pair.** `match_rag_chunks_ncert` is the production
retrieval path: `/api/foxy`, `supabase/functions/grounded-answer/` and
`quiz-generator` all go through it, and its body filters
`c.subject_code = p_subject_code AND c.grade_short = p_grade` (its own SQL
`COMMENT` says "snake_case subject_code, P5 grade_short"). A chunk present in
the legacy columns but with a NULL `subject_code` is **invisible to every
student-facing query**. Counting it as coverage would make the detector lie in
the optimistic direction — the only direction that actually hurts.

**`question_bank` has no second notation.** `subject` is FK'd to
`subjects.code` (snake_case) and `grade` carries the P5 CHECK.

### How NULL-attributed rows are treated

The corpus was built by a legacy ingestion tool no longer in the codebase
(`scripts/ncert-ingestion/CLAUDE.md`), so some rows may carry NULL canonical
columns. The detector:

- **Excludes** them from every (subject, grade) bucket — matching what the
  retriever does.
- **Counts and reports** them as `ragUnattributed` / `questionUnattributed`,
  with a percentage, in both the JSON and the job summary.
- Keeps `attributed + unattributed == rows read`, so the two views reconcile.

This is deliberate: an unattributed chunk is a **backfill** task (populate two
columns), which is far cheaper than the content-generation task the resulting
gap would otherwise be mistaken for. It is usually the most actionable number
in the report.

> **Not changed, flagged for assessment:** the detector filters only on
> `is_active = true`. `question_bank` also has a `deleted_at` column that the
> query ignores, so soft-deleted-but-active rows would be counted. Whether
> `deleted_at IS NULL` belongs in the readiness definition is assessment-owned
> content policy, not an ops call.

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

## What remains before `CONTENT_GAP_MODE=escalate`

Read this table before flipping anything. **Do not flip while any BLOCKING row
is open.**

| # | Blocker | Status | Owner |
|---|---|---|---|
| OD-2 | Detector counts columns retrieval cannot see | **CLOSED 2026-08-11** — reads canonical `subject_code`/`grade_short`; question_bank grade key fixed; NULL-attribution reported separately | ops |
| OD-3 | Counts silently truncated by PostgREST | **CLOSED 2026-08-11** — server-side exact count + `.range()` loop + `paginationComplete` attestation | ops |
| OD-1 | Reporting credential not reachable from `production-ops` | **OPEN — BLOCKING** | architect |
| OD-4 | `production-ops` GitHub environment settings not confirmed | **OPEN — BLOCKING** | architect |
| OD-5 | One trustworthy live run observed end-to-end | **OPEN — BLOCKING** (cannot start until OD-1/OD-4 clear) | ops |

Sequence: OD-1 + OD-4 (settings/credential) → OD-5 (one clean nightly, verdict
`HEALTHY` / `BELOW_FLOOR` / genuine `CATASTROPHIC`, with `paginationComplete:
true` and a plausible `ragUnattributed`) → **then** set the repo variable
`CONTENT_GAP_MODE=escalate`.

The two code preconditions are closed, but code correctness alone does not make
escalation safe: escalation routes into `pipeline-alert.yml` and opens GitHub
issues, so it must not be enabled while the job cannot authenticate.

---

## Open decisions (require a human)

### OD-1 — Provision a read-only Supabase reporting credential

**Status: OPEN. BLOCKING. Blocks the third restore condition — and probably
blocks the job running at all.**

> **Escalated 2026-08-11 — this is likely breaking every run today, not just a
> hygiene gap.** `.github/workflows/rag-cosine-replay.yml:91-95` records, from
> the GitHub environment settings page rather than by inference, that
> `SUPABASE_SERVICE_ROLE_KEY` lives in the **`supabase`** environment. It also
> records that two runs (`30325456772`, `30326862812`) aborted at preflight
> after assuming `production-ops` — an inference drawn from *this* workflow
> that "proved false". If that still holds, then on `production-ops` both
> `SUPABASE_CONTENT_REPORT_KEY` and `SUPABASE_SERVICE_ROLE_KEY` resolve to
> empty, the credential preflight exits 1, and **this nightly fails every night
> straight into the alerting that was just wired up** — chronic noise on a
> brand-new detector, which is exactly how the original suspension happened.
> `SUPABASE_URL` may be affected the same way; it is unverified.
>
> The fix is to provision `SUPABASE_CONTENT_REPORT_KEY` (and confirm
> `SUPABASE_URL`) on `production-ops` — which is the correct end state anyway.
> **Do not resolve this by widening the service-role key's scope**; that
> re-exposes an RLS-bypassing credential to every workflow, undoing the
> containment the `supabase`-environment scoping deliberately bought.
>
> Cannot be verified from inside the repo. **Owner: architect**, from the
> environment settings page.

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

### OD-2 — Fix the subject/grade mapping

**Status: CLOSED 2026-08-11 (ops).**

The detector now reads the canonical `subject_code` / `grade_short` pair — the
columns `match_rag_chunks_ncert` actually filters on — rather than translating
`'math' -> 'Mathematics'` toward the legacy display-name columns. A second,
previously unnoticed defect on the `question_bank` side (`"…|Grade 10"` vs the
P5-constrained bare `'10'`) was fixed at the same time. NULL-attributed rows
are excluded from coverage and reported as their own signal. Full rationale in
"Which columns the detector reads, and why" above.

Verified without a live database: `apps/host/src/__tests__/check-content-gaps.test.ts`
(20 tests) pins the column selection, both bucketing keys, the NULL-attribution
accounting, and P13 (no PII-bearing column is ever selected).

**Residual, for assessment (non-blocking):** confirm that `TARGET_SUBJECTS`
codes still match the live `subjects.code` set, and rule on whether
`question_bank.deleted_at IS NULL` belongs in the readiness definition.

### OD-3 — Unpaginated reads silently truncate counts

**Status: CLOSED 2026-08-11 (ops).**

Truncation was the **expected** state, not a hypothetical: PostgREST caps a
bare `.select()` at `db-max-rows` (commonly 1,000) against a ~16,006-chunk
corpus.

`fetchAllRows()` now takes an authoritative server-side `count: 'exact'` first,
then pages with `.range()` — advancing by the *observed* batch length, so a
`db-max-rows` **smaller** than the requested page size cannot cause an early
stop that falsely reports a complete read. It publishes `paginationComplete`,
and the script downgrades its own exit code from 1 to 2 on an incomplete read
rather than declaring a catastrophe off numbers it knows are short.

**Why this mattered more than it looked.** Truncation under-reports, which
inflates gaps — it cannot manufacture a false green on healthy data. But the
verdict script suppresses escalation on a suspected truncated read, so *while
truncation was happening, a genuine catastrophic gap was permanently suppressed
too*. The mitigation converted a false-red into a false-green for real gaps.
`content-gap-verdict.mjs` now trusts the explicit `paginationComplete` flag
instead of guessing from round numbers, so a legitimate corpus of exactly
10,000 rows no longer has its escalation silently swallowed. The round-number
heuristic is retained only as a fallback for pre-2026-08-11 report artifacts.

**No longer requires knowing the project's `db-max-rows`** — the loop is
correct for any value.

### OD-4 — Confirm the `production-ops` environment settings

**Status: OPEN. BLOCKING.**

Cannot be asserted from the workflow file. Required: deployment branch policy =
`main` only; required reviewers **empty**. See "Required GitHub settings" above
for why a required reviewer would silently kill this unattended nightly.

**Owner: architect.**

### OD-5 — Observe one trustworthy live run

**Status: OPEN. BLOCKING. Gated on OD-1 and OD-4.**

Acceptance for the run: verdict is `HEALTHY`, `BELOW_FLOOR` or a genuine
`CATASTROPHIC` (**not** `DETECTOR_ERROR` / `DETECTOR_FAULT` /
`UNATTRIBUTED_CORPUS`), `paginationComplete` is `true`, rows read reconcile
with the server-side exact counts, and `ragUnattributed` is plausible against
the ~16,006-chunk corpus. Cross-check the totals against
`/api/super-admin/grounding/coverage` and the `ingestion_gaps` view before
believing any gap.

Only then set `CONTENT_GAP_MODE=escalate`.

**Owner: ops.**

---

---

## Adjacent finding — not this workflow, higher priority than it

Recorded here because it surfaced during this workflow's credential review and
would otherwise be lost. **Triage only; not fixed by ops.**

`.github/workflows/rag-eval.yml:52` passes `SUPABASE_SERVICE_ROLE_KEY` to a job
that has **no `environment:`, no ref guard, and a `pull_request` trigger** whose
`paths` filter includes the workflow file itself and the script it runs. That is
strictly weaker containment than the workflow this runbook covers — it is the
same shape as the hole `b66c25c3b` closed here on 2026-07-11, still open
elsewhere. Its only protection is a fork guard
(`head.repo.full_name == github.repository`).

Either branch of the outcome is a defect, and they need opposite fixes:

- **If the key IS reachable at repo scope** — a same-repo branch PR can execute
  attacker-controlled workflow + script content while holding the production
  RLS-bypassing credential. Security defect; fix by scoping and adding a ref
  guard.
- **If it is NOT** (consistent with `rag-cosine-replay.yml:91-95`, which scopes
  the key to the `supabase` environment) — the job's own preflight makes it
  `exit 0` with "RAG eval skipped", so this nightly has been silently
  no-opping. A second green-but-blind detector.

**Owner: architect.** Reported, not actioned, per task scope.

---

## Related

- Workflow: `.github/workflows/content-quality-nightly.yml`
- Verdict logic: `scripts/content-gap-verdict.mjs`
- Detector: `scripts/check-content-gaps.ts` (thresholds = assessment-owned)
- Detector tests: `apps/host/src/__tests__/check-content-gaps.test.ts`
- Canonical retrieval RPC (defines which columns count):
  `match_rag_chunks_ncert` in `supabase/migrations/00000000000000_baseline_from_prod.sql`
- Advisory audit: `scripts/audit-question-quality.ts`
- Alerting: `.github/workflows/pipeline-alert.yml`
- Containment contract: `scripts/verify-devops-policy-contract.ts`
  (`content-scan-main-only-containment`)
