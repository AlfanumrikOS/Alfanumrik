# Runbook: apply the unapplied `20260814*` migrations

> ## ⚠️ RENUMBERED 2026-08-11 — VERSIONS IN THIS RUNBOOK MOVED
>
> Six of these migrations were renumbered because `main` and
> `fix/ci-structural-defects` carried **different files at the same four
> versions** (`…0012`-`…0015`). `supabase db push` records applied migrations by
> numeric version prefix, so whichever branch landed first would have marked
> those versions applied and the other branch's files would have been **silently
> skipped forever, with no error** — including `…0014`, the answer-key column
> ACL, whose leak is confirmed live in production.
>
> | was | is now | file |
> |---|---|---|
> | `…0012` | `…0018` | `plan_subject_access_restrict` |
> | `…0013` | `…0019` | `trim_teacher_subjects_taught` |
> | `…0014` | `…0020` | `quiz_session_shuffles_answer_key_column_acl` |
> | `…0015` | `…0021` | `quiz_session_shuffles_session_mode` |
> | `…0016` | `…0022` | `submit_quiz_v2_written_answer_scoring` |
> | `…0017` | `…0023` | `keyless_question_serving_and_server_side_p6` |
>
> `…0007`-`…0011` are **unchanged** (no collision). The block was moved
> contiguously to preserve relative order: `…0021` extends the column allowlist
> `…0020` establishes, and `…0023` replaces `start_quiz_session`, which `…0021`
> and `…0022` both depend on. **No SQL was changed** — this was a rename plus
> reference update. Every `file:line` citation below still resolves, because the
> substitutions were same-length and no migration's line count changed.
>
> If you are reading a pre-2026-08-11 copy of this runbook, or an operator note
> that says "apply `…0014`", it means `…0020`.

> **Purpose**: apply migrations `20260814000007` … `20260814000024` — the Phase 3
> subject restriction (M1, M2, M4, M5, M6, M3, M8), the `quiz_session_shuffles`
> answer-key column ACL, the `session_mode` column, the P0 written-answer
> scoring fix, the keyless-serving / server-side-P6 change, and the
> `subjects_allowed` reconciliation — and *prove* each one landed.
>
> **Owner**: ops (this runbook + the gate script). **Executor**: architect or ops
> with prod DB access. **Approver**: user (CEO) — `20260814000018` is a pricing
> change.
>
> ---
>
> ## STATUS: **APPLIED TO PRODUCTION 2026-08-11 — 5 of 6 of the security/pricing slice**
>
> **This section previously read "STATUS OF EVERY MIGRATION IN THIS RUNBOOK:
> UNEXECUTED". That is no longer true and the old text has been replaced rather
> than annotated, because leaving it would misreport production.**
>
> On **2026-08-11**, against the production project **`shktyoxqhundlvkiwguu`**,
> via `supabase db push --db-url`, **exit 0**:
>
> | Version | File | Status |
> |---|---|---|
> | `20260814000018` | `plan_subject_access_restrict` | ✅ **APPLIED** |
> | `20260814000019` | `trim_teacher_subjects_taught` | ✅ **APPLIED** |
> | `20260814000020` | `quiz_session_shuffles_answer_key_column_acl` | ✅ **APPLIED** |
> | `20260814000021` | `quiz_session_shuffles_session_mode` | ✅ **APPLIED** |
> | `20260814000022` | `submit_quiz_v2_written_answer_scoring` | ✅ **APPLIED** |
> | `20260814000023` | `keyless_question_serving_and_server_side_p6` | 🔴 **STILL PENDING — deliberately held. See PF-9.** |
> | `20260814000024` | `reconcile_subjects_allowed_with_plan_reality` | 🔴 **STILL PENDING — landed on disk 2026-08-12, after the apply. Cannot ship alone; see below.** |
>
> **`…0024` is pending for a coupling reason, not a risk reason.** It sets the
> dead `subscription_plans.subjects_allowed` column to `-1` on every plan and
> changes **no price** (it carries its own in-transaction tamper assertion that
> aborts if any price, Razorpay id, `plan_code` or `is_active` moves). On its own
> it would be safe to ship today. But it sorts **above** `…0023`, and
> `supabase db push` cannot apply a subset — so any push that takes `…0024` takes
> `…0023` with it, and `…0023` must not ship before the frontend deploys. **`…0024`
> therefore inherits `…0023`'s hold.** To ship it earlier, stream its body alone
> via STDIN (§3.2) and record the version afterwards.
>
> **🔴 R1 — the session-scoped answer-key leak — is CLOSED.** Proven by a
> before/after anon-key probe whose *control* flipped, not merely by the absence
> of an error. Evidence in *Verified production state* below and in §4 `…0020`.
> This is the discharge of REG-380's central claim.
>
> **`…0023` was held back on purpose and MUST NOT be applied until the frontend
> deploys.** It strips `correct_answer_index` from the serving RPC payloads. The
> client half is committed but **not deployed**; the live client's P6 gate
> (`packages/lib/src/quiz/question-validation.ts`) still treats an absent index as
> a validation failure, so applying `…0023` against today's production frontend
> would fail P6 on **every** served question and render **empty quizzes in
> production**. It ships in the same release as the client, or after it — never
> before. See PF-9.
>
> **What is still derived-not-observed.** Everything in this runbook that was not
> exercised by the 2026-08-11 apply remains **syntax-validated only** — read end
> to end with its post-conditions derived from its own source. In particular
> `…0007`-`…0011` were **already applied before this runbook existed** (see PF-1)
> and were not re-verified by it, and the whole of `…0023` (§4 K-1..K-5, §5.10) is
> still unexecuted.
>
> **The pre-flight gate did NOT fully run — see the honest accounting in §2.**
> `psql` is not on PATH in the executing environment, so the gate's entire DB lane
> could not run: **10 checks are UNVERIFIED, not passed.** PF-2b and PF-4 were
> closed independently over PostgREST. **PF-6, PF-7a and PF-7b were never verified
> at all**; the apply proceeded without them, relying on each migration's
> in-transaction post-conditions to abort rather than half-apply. It worked, but
> that was a risk accepted, not a risk retired.

---

## Verified production state (2026-08-11)

Measured **read-only** against the production project `shktyoxqhundlvkiwguu` on
2026-08-11. Nothing was written and no migration was applied. Facts 1 and 2
change what you should expect at apply time; fact 3 closes off a dead end; fact 4
**resolves PF-1** and confirms a live security vulnerability.

**1. The catalogue restriction is already the live state.**
`GET /rest/v1/subjects?select=code,is_active,is_content_ready` returns
`is_active = true` for exactly five codes — `math`, `science`, `physics`,
`chemistry`, `biology` — and `false` for the other 18 (`accountancy`,
`business_studies`, `coding`, `computer_science`, `economics`, `english`,
`fine_arts`, `geography`, `health_fitness`, `hindi`, `history_sr`,
`home_science`, `informatics_practices`, `political_science`, `psychology`,
`sanskrit`, `social_studies`, `sociology`). That is exactly the keep-set M1
(`20260814000007`) targets, so **either M1 or an equivalent out-of-band change
has already been applied.**

*Consequence*: on this database M1 is an **idempotent no-op, not a conflict** —
its `WHERE is_active IS DISTINCT FROM …` guards are precisely what makes
re-applying it change nothing. It will therefore also write **no audit row**
(§3.2 exception 2), which means M1's declared rollback source will be absent.
**Take the `SELECT code, is_active FROM public.subjects ORDER BY code` snapshot
anyway** — it is now your only rollback source for the catalogue.

**2. `is_content_ready = true` for all five keep-set subjects.** This retires
PF-2's blocking risk; the measured values and what still has to be re-checked are
in PF-2 below.

**3. The migration ledger is unreadable over PostgREST — but it WAS read at apply
time over a direct connection. ✅ CORRECTED 2026-08-11 (post-apply).**

The PostgREST half stands: `GET /rest/v1/schema_migrations` with
`Accept-Profile: supabase_migrations` returns

```
PGRST106 — Invalid schema: supabase_migrations.
Only the following schemas are exposed: public, graphql_public
```

because `supabase_migrations` is not in PostgREST's exposed-schema list, for an
API key of any role. **Do not retry that route.**

**But the blanket claim "the ledger is unreadable" was too strong, and this
paragraph previously left it standing.** With a connection string,
`supabase migration list --db-url` reads it fine. That is what was done
immediately before the apply, and it settles PF-1 directly rather than
behaviourally:

| Versions | Ledger state before the apply |
|---|---|
| `…0007` – `…0011` | **already applied** |
| `…0012` – `…0017` | applied on **neither** branch |
| `…0018` – `…0023` | not applied |

**The `…0012`-`…0017` row is the important one: the version collision had not yet
bitten.** Neither `main` nor `fix/ci-structural-defects` had recorded any of those
six versions, so no file had yet been silently skipped. **The renumber was
preventive — and is now *provably* preventive rather than merely argued.** Had it
been done a release later, the first branch to land would have burned those
versions and the other branch's files (including the answer-key ACL) would have
been skipped forever with no error. Record this as the outcome: the hazard was
real, and it was closed before it fired.

*Consequence for `…0007`-`…0011`:* they were applied by some earlier route, not by
this runbook, and **this runbook never verified them**. Fact 1's observation that
production state matches M1's keep-set is consistent with that, but §4's M1/M2/M4/
M5/M6 checks remain **unrun**.

**4. ✅ PF-1 is RESOLVED for the migrations that matter — behaviourally, and the
answer is: the security slice is NOT applied.** A behavioural probe replaced the
ledger read, and it is *stronger* evidence than a ledger row: a `schema_migrations`
row records that an apply was attempted, whereas this tests the actual privilege
in the live database.

The probe exploits the fact that `…0020` runs
`REVOKE ALL ON TABLE public.quiz_session_shuffles FROM anon` (`…0020:127`) and
then re-grants **nothing** to `anon` — the column-level `GRANT SELECT (…)` at
`…0020:149-160` goes to `authenticated` only, deliberately (`…0020:145-147`).
Postgres raises privilege errors (`42501`) **before** RLS row-filtering, so an
anon request distinguishes the two states unambiguously: no privilege ⇒ `42501`;
privilege but no visible rows ⇒ `200 []`.

Run with the **anon** key (not service-role), against
`/rest/v1/quiz_session_shuffles`:

| Probe | Request | Result | Meaning |
|---|---|---|---|
| T1 | `select=correct_answer_index_snapshot&limit=1` | `[]` | column resolved; **no** privilege error |
| T2 (**decisive control**) | `select=question_id&limit=1` | `[]` | `anon` still holds table-level SELECT |
| T3 | `select=session_mode&limit=1` | `42703 column … does not exist` | the column is absent |

**Read the conclusions with the probe that proves each one — they are not
interchangeable:**

- **`20260814000020` is NOT APPLIED — MEASURED.** **T2 is the decisive probe.**
  Had `…0020` run, the table-level `REVOKE ALL … FROM anon` would make **every**
  column return `42501` for anon, `question_id` included. It returned `[]`, so
  the table-level grant to `anon` is intact and the migration has not run. T1
  alone would have been weaker evidence — an empty array there is also what a
  row-filtered read looks like.
- **🔴 R1 — the session-scoped answer-key read — is CONFIRMED LIVE IN
  PRODUCTION.** This is the defect `…0020` exists to close and which its own
  header describes at `…0020:33-41`: an authenticated student can read
  `correct_answer_index_snapshot` (and brute-force `integrity_hash`) for every
  question of their own **in-flight, not-yet-submitted** quiz, defeating P3
  anti-cheat and making the P1 score meaningless. **This is no longer inferred
  from migration source — it is measured.** Treat it as a live vulnerability with
  a written, ready-to-apply fix sitting unapplied.
- **`20260814000021` is NOT APPLIED — MEASURED.** T3: `session_mode` does not
  exist on the production table.
- **`20260814000022` and `20260814000023` are almost certainly NOT APPLIED —
  INFERRED, not measured.** `supabase db push` applies at the immediate
  `supabase/migrations/` root in ascending version order, and `…0021` has not
  run, so the two later versions cannot have been applied by that path. **Neither
  was probed directly.** Do not report them with the same confidence as `…0020`
  and `…0021`; probe them at apply time (PF-7's `submit_quiz_results_v2`
  signature query and PF-9's five-signature query both distinguish the states).

**What "`…0022` not applied" means for production today** — stated plainly,
because it is a second live P0 and it is easy to read past:

- **Any quiz containing at least one non-MCQ question still cannot be submitted
  at all.** The RPC raises `session_not_started` before any anti-cheat check, no
  `quiz_sessions` row is written, the student sees a network-error toast and
  loses the whole attempt, and retrying re-raises forever (`…0022:5-19`). A pure
  written quiz is worse still (§1). *Confidence: INFERRED, on the version-order
  argument above.*
- **Exam-mode P3 anti-cheat is still inverted.** The fix for it is *client-side*
  — `computeElapsedSeconds` in `packages/lib/src/quiz/session-contract.ts`, which
  makes the web client pass ELAPSED seconds instead of the exam-mode COUNTDOWN
  remainder to the RPC's `p_time` (`…0022:391-395`). Until it deploys, Check 1
  compares the wrong quantity to the 3s threshold. This one is **doubly
  inferred**: it rides the same undeployed release slice as `…0022`, whose two
  halves PF-9 records as present-but-uncommitted on disk at authoring time. It is
  a *deploy-composition* claim, not a database measurement — confirm it against
  the release branch, not against the DB.

> This does **not** contradict fact 1, and neither fact says anything about
> whether `…0007`'s *file* ran. `db push` applies in ascending version order, so
> an earlier version being applied while a later one is not is the normal shape.
> Fact 1 records only that **production state matches M1's keep-set**; fact 4
> records that the four later security/P0 migrations have not landed — two of
> them measured, two of them inferred.

> **Still do not infer applied-ness in the other direction either.** Fact 1 is
> evidence about the `subjects` table and nothing else. Every pre-flight and
> post-apply check in this runbook still has to be run, and **REG-380 stays `P`**
> (§6) — Lane B cannot pass against a database where `…0020` is not applied;
> tests 1-3 will correctly fail, because the leak is open.

Production can drift between this measurement and your apply. Re-measure all four
at apply time; treat the above as dated evidence, not as current state.

---

## Verified production state AFTER the apply (2026-08-11)

Everything above this line is the **pre-apply** measurement. This section is what
was measured **after** `supabase db push --db-url` returned exit 0.

### R1 IS CLOSED — the anon-key probe, re-run identically before and after

The probe from fact 4 was re-run **unchanged** against the same project with the
same anon key. Running it identically on both sides is what makes it evidence
rather than an anecdote:

| Probe | Before | After |
|---|---|---|
| `select=question_id` (**decisive control**) | `[]` | **`42501 permission denied`** |
| `select=correct_answer_index_snapshot` | `[]` | **`42501 permission denied`** |
| `select=session_mode` | `42703 column does not exist` | **`42501`** (column now exists) |

**Read the control first.** `question_id` is not a column `…0020` mentions
anywhere. It flipped from `[]` to `42501` **only** because
`REVOKE ALL ON TABLE public.quiz_session_shuffles FROM anon` (`…0020:127`)
executed and took the table-level grant away wholesale. That is a positive proof
that the REVOKE ran — not the absence of an error, and not something a
row-filtered empty read could imitate. The answer-key column returning `42501` is
then the leak itself being shut.

`session_mode` moving from `42703` (column absent) to `42501` (column present,
privilege denied) simultaneously confirms **`…0021`** landed: the error class
changed from *schema* to *privilege*, which only happens if the column now exists
**and** the ACL now covers it.

**🔴 R1 — the session-scoped answer-key read — is CLOSED.** It was confirmed live
in production earlier the same day; it is now confirmed shut, by measurement on
both sides. **This is the discharge of REG-380's central claim** (see §6 for what
that does and does not discharge — Lane B's 6 wire-level tests are still unrun).

### `…0018` — verified over PostgREST

- `subscription_plans.max_subjects` is **`NULL` on all four plans**
  (`free`, `starter`, `pro`, `unlimited`) — M3-3's expectation, met.
- `plan_subject_access` holds **exactly 5 rows per plan** — M3-1's expectation,
  met, and non-vacuously: `plan_codes` is non-empty, so the vacuous-pass warning
  at M3 does not apply.

M3-2 (that those 5 *are* the keep-set) and M3-4 (the audit row carrying both
rollback payloads) were **not** separately re-queried. M3-5, the customer-visible
acceptance as a real grade-11 free-plan student, was **not** performed.

### `…0019` — blast radius measured BEFORE the apply, and it was nil

PF-4's diagnostic was taken ahead of the apply: **8 teachers total, every one of
them with an empty `subjects_taught`.** Therefore **zero teachers were trimmed and
zero were left stranded**.

**PF-4 is closed with a measured value, not an assumption.** It also makes M8-4's
reconciliation trivially satisfiable — `left_with_zero` must be `0` — and means
there is **no support hand-off population** from this migration.

### 🔴 Now-live discrepancy created by the apply — pricing copy is factually wrong

`…0018` has landed, so **PF-8 did not hold**: the migration shipped *ahead* of the
copy, which is the exact failure PF-8 exists to prevent. See PF-8 for the full
surface list and the open action.

---

## 0. What is in the set

| # | File | What it does | Blast radius |
|---|---|---|---|
| M1 | `20260814000007_subject_catalogue_restrict_math_science.sql` | `subjects.is_active = FALSE` for everything outside the keep-set `math, science, physics, chemistry, biology`; self-heals the keep-set back on | catalogue reads |
| M2 | `20260814000008_grade_subject_map_restrict_and_destream.sql` | archives + deletes out-of-keep-set grade-map rows; replaces grade 11-12 stream-scoped rows with stream-NULL rows. **Contains an assertion that ABORTS the whole transaction if any `(grade, board)` pair is left with zero rows** | curriculum map |
| M4 | `20260814000009_repair_student_subjects_after_restriction.sql` | ships + runs `archive_inactive_subject_enrollments()`; repairs `student_subject_enrollment`, `students.selected_subjects`, `students.preferred_subject` | every student row |
| M5 | `20260814000010_enforce_subject_enrollment_active_check.sql` | `enforce_subject_enrollment()` gains an `is_active` check — closes the write hole that makes M1 advisory | writes to `student_subject_enrollment` |
| M6 | `20260814000011_get_subject_violations_active_aware.sql` | `get_subject_violations()` joins `subjects … AND sub.is_active`. **Without it the verification signal is a false all-clear** | admin forensic read model |
| M3 | `20260814000018_plan_subject_access_restrict.sql` | **PRICING SURFACE CHANGE** — grants all 5 keep-set codes to *every* plan, sets `subscription_plans.max_subjects = NULL` on every plan | every paying and non-paying customer |
| M8 | `20260814000019_trim_teacher_subjects_taught.sql` | trims `teachers.subjects_taught` to the active intersection; audit row reports how many teachers are left with zero | every teacher row |
| — | `20260814000020_quiz_session_shuffles_answer_key_column_acl.sql` | **SECURITY** — denies `correct_answer_index_snapshot` + `integrity_hash` to `anon`/`authenticated` | P1/P3 answer-key leak |
| — | `20260814000021_quiz_session_shuffles_session_mode.sql` | persists `session_mode`; exam sessions become non-resumable | quiz resume path |
| — | `20260814000022_submit_quiz_v2_written_answer_scoring.sql` | **P0** — `submit_quiz_results_v2` scores written answers instead of aborting | *every* quiz containing a non-MCQ question |
| K | `20260814000023_keyless_question_serving_and_server_side_p6.sql` | **SECURITY + P6** — removes `correct_answer_index` from three serving RPC payloads, adds the `question_bank_p6_valid()` predicate as a server-side filter, makes `start_quiz_session` the P6 checkpoint, adds `check_formative_answer()` | every question-serving path |
| SA | `20260814000024_reconcile_subjects_allowed_with_plan_reality.sql` | **DATA HYGIENE, NOT PRICING** — sets `subscription_plans.subjects_allowed = -1` (this table's own unlimited sentinel) on every plan, so the column stops encoding the pre-`…0018` `free = 2` / `starter = 4` cap that no longer exists in any enforcement path; adds a `COMMENT ON COLUMN` marking it non-enforcing. Writes **exactly one column** and asserts in-transaction that **no price, Razorpay id, `plan_code` or `is_active` moved** | none at runtime — the column has **zero** readers (see below) |

> **`…0023` was added by a concurrent agent *while this runbook was being
> written*, and `…0024` was added by another one *after the 2026-08-11 apply*.**
> Both were caught the same way and neither was found by reading the diff: the
> gate script's `ST-4` warned ("no newer `20260814*` migration has appeared
> outside this gate") and `ST-5` **failed**, taking the offline lane to exit 1
> until the file was read in full and folded into `MIGRATION_SET`. That exit 1 is
> the mechanism working, not a defect in it. **`…0025` and later do not exist on
> disk** as of 2026-08-12. Re-run `node scripts/verify-20260814-migrations.mjs
> --offline` immediately before applying: if `ST-4` warns or `ST-5` fails, another
> migration has landed and this runbook is incomplete until you read it and extend
> `MIGRATION_SET` + `PENDING_VERSIONS` in the script. **Do not weaken `ST-4`/`ST-5`
> to quiet them** — a file outside `MIGRATION_SET` is *unverified*, not
> verified-clean.

---

## 1. Apply order, and why it matters

`supabase db push` applies the files at the immediate `supabase/migrations/`
root in ascending version order, so **the filename order IS the apply order** —
you do not sequence these by hand. What follows is why that order is not
arbitrary, i.e. what breaks if you cherry-pick out of it.

```
20260814000007  M1  catalogue        ─┐
20260814000008  M2  grade map        ─┤ 0009 MUST come after both
20260814000009  M4  student repair   ←┘
20260814000010  M5  write gate
20260814000011  M6  violations RPC    ← nobody may trust get_subject_violations before this
20260814000018  M3  plan access       ← PRICING. Requires M1 (FK on subjects.code)
20260814000019  M8  teacher trim      ← Requires M1; refuses to run otherwise
20260814000020      answer-key ACL
20260814000021      session_mode      ← Requires 0020 (its allowlist is what makes this grant necessary)
20260814000022      written scoring   ← P0. Independent of 0007-0011 + 0018/0019.
20260814000023  K   keyless serving   ← MUST follow 0022: both replace functions on the
                                         same P1 substrate, and 0023 replaces
                                         start_quiz_session, which 0022's written lane
                                         depends on.
20260814000024  SA  subjects_allowed  ← MUST follow 0018 (it reconciles against the
                                         max_subjects=NULL / all-five-grants reality
                                         0018 establishes) and 20260620000800 (whose
                                         razorpay_plan_id_quarterly column its tamper
                                         guard snapshots). Independent of 0020-0023 —
                                         but sorts above them, so db push drags them in.
```

**`…0009` after `…0007` + `…0008`.** M4's repair is keyed on
`subjects.is_active IS DISTINCT FROM TRUE` (`…0009:100`, `:114`, `:200`). Run
before M1 nothing is inactive, so the repair is a no-op and every student keeps
a dangling enrollment. Its own header states the ordering requirement at
`…0009:49-52`. It must also come *before* M5: M4 only DELETEs enrollment rows and
never INSERTs, so M5's new write gate is irrelevant to it either way — but the
reverse is not true for a rollback (see §5.3).

**`…0011` before anyone trusts `get_subject_violations`.** The pre-M6 RPC builds
its `allowed` set from `grade_subject_map ⋈ plan_subject_access` and **never
joins `subjects`**, so it ignores `is_active` completely. After an
`is_active`-only flip it reports **zero violations while violations are real** —
a clean dashboard over a dirty database (`…0011:6-12`, and M1 says the same at
`…0007:24-28`). Do not use it as an acceptance signal for M1/M2/M4 until M6 is
applied. If you are forced to verify earlier, use the raw SQL in §4 (M4-1/M4-2)
instead, which reads `subjects.is_active` directly.

**`…0022` is a P0 and should not wait.** Today, any quiz containing at least one
non-MCQ question **cannot be submitted at all** — the RPC raises
`session_not_started` before any anti-cheat check, no `quiz_sessions` row is
written, the student sees a network-error toast and loses the whole attempt, and
retrying re-raises forever (`…0022:5-19`). A pure written quiz is worse: zero MCQ
ids means `start_quiz_session` was never called and `p_session_id` arrives NULL.
"Today" is not hypothetical: as of 2026-08-11 `…0022` is **inferred not applied**
on production (fact 4 — the inference is the version-order argument, not a direct
probe), so this P0 is live for real students right now. The same undeployed slice
carries the client-side fix for the inverted exam-mode anti-cheat timing
(`…0022:391-395`).
`…0022` touches **nothing** that `…0007`-`…0011` + `…0018`/`…0019` touch. If the pricing decision
(M3) or the teacher-impact number (M8) needs another day, **ship `…0020`,
`…0021` and `…0022` on their own first** — they are a disjoint, independently
appliable slice.

> `supabase db push` cannot apply a subset. To ship the quiz slice alone, apply
> the three bodies by STDIN (§3.2) and record the versions afterwards, or hold
> `…0007`-`…0011` + `…0018`/`…0019` on a branch. Decide which before you start.

**`…0023` after `…0022`, and it has a client half of its own — a harder one.**
`…0023` replaces `start_quiz_session` with a body that **skips** any question
failing `question_bank_p6_valid()`: no snapshot row is written and the question
is absent from the returned array (`…0023:841-861`). The client must **drop any
served question the server did not snapshot** — the companion change in
`apps/host/src/app/(student)/quiz/page.tsx`. It also removes
`correct_answer_index` from the payloads of `select_quiz_questions_rag`,
`select_quiz_questions_v2` and both `get_quiz_questions` overloads, which means
the browser can no longer run the `correct_answer_index 0-3` half of P6
(`packages/lib/src/quiz/question-validation.ts`). If the migration ships without
the client change, that client gate sees `undefined` for every row and **rejects
100% of MCQs** — the migration's own header says so (`…0023:32-36`). **Ship the
two together or ship neither.** Confirm the client half is in the same deploy
before applying (§2 PF-9).

**`…0022` has a client half.** `apps/host/src/app/(student)/quiz/page.tsx:915`
calls `collectSessionQuestionIds()`
(`packages/lib/src/quiz/session-contract.ts`) so that *every* served question —
not just the MCQs — gets a `quiz_session_shuffles` snapshot row. The migration
scores written answers; the client change is what makes a **pure written** quiz
reach the RPC with a real `p_session_id` at all, and what makes P3 anti-cheat
Check 3's served-row `COUNT(*)` correct for mixed quizzes (`…0022:20-28`). **Ship
both in the same release.** The migration alone leaves the pure-written case
still broken.

**`…0024` after `…0018`, and it CANNOT BE APPLIED ALONE via `db push`.** This is
the whole of its scheduling story, so state it exactly:

- **Why it must follow `…0018`.** `…0024` reconciles `subjects_allowed` against
  the reality `…0018` created — `max_subjects = NULL` on every plan and all five
  keep-set codes granted to every plan in `plan_subject_access`. Run before
  `…0018` it would assert `-1` against a paywall that is still live, encoding a
  false statement rather than removing one. `…0018` is already applied
  (2026-08-11), so this ordering constraint is already satisfied.
- **Second dependency: `20260620000800`.** `…0024`'s very first statement snapshots
  `razorpay_plan_id_quarterly` into its `_plan_price_guard` temp table. If that
  column is absent the migration errors there and rolls back cleanly — a wasted
  push, not a half-apply. **PF-10 checks this for one query.**
- **Why it is nevertheless PENDING.** `supabase db push` applies every unapplied
  file at the migrations root in version order and **cannot apply a subset**.
  `…0024` sorts *above* `…0023`, so pushing `…0024` pushes `…0023` too — and
  `…0023` renders **empty quizzes in production** until the repointed frontend
  deploys (PF-9). **`…0024` therefore inherits `…0023`'s hold.** It is not held
  because it is dangerous; it is held because it is downstream of something that
  is.
- **If you need `…0024` before the frontend ships**, stream its body alone via
  STDIN (§3.2) and record `20260814000024` in
  `supabase_migrations.schema_migrations` afterwards. There is no reason to rush
  this — the column it fixes has **zero runtime readers** (grepped repo-wide:
  the only occurrences are the generated `database.types.ts`, the baseline column
  definition, and `…0018`'s comment explaining why it was skipped), so the drift
  it closes is a correctness-of-the-record problem, not a live defect.

---

## 2. Pre-flight — run every one of these BEFORE `db push`

> ### ⚠️ WHAT ACTUALLY RAN ON 2026-08-11 — stated plainly
>
> **The gate's DB lane could not run at all: `psql` is not on PATH in the
> executing environment.** So for the 2026-08-11 production apply:
>
> | Check | Status on 2026-08-11 |
> |---|---|
> | PF-1 ledger | ✅ **VERIFIED** — read via `supabase migration list --db-url` (see *Verified production state*, fact 3) |
> | PF-2b keep-set readiness | ✅ **VERIFIED** — closed independently over PostgREST |
> | PF-4 teacher blast radius | ✅ **VERIFIED** — closed independently over PostgREST: 8 teachers, all empty |
> | PF-2a deployed-picker gate | ⚠️ **UNVERIFIED** |
> | PF-3 stranded `(grade, board)` pairs | ⚠️ **UNVERIFIED** |
> | PF-5 keep-set codes present | ⚠️ **UNVERIFIED** |
> | **PF-6 ACL column existence** | 🔴 **NEVER VERIFIED** |
> | **PF-7a `submit_quiz_results_v2` signature** | 🔴 **NEVER VERIFIED** |
> | **PF-7b chain-dep ledger rows** | 🔴 **NEVER VERIFIED** |
> | PF-8 pricing copy staged | 🔴 **DID NOT HOLD** — see PF-8 |
> | PF-9 `…0023` client half deployed | 🔴 **DID NOT HOLD** — `…0023` was held back instead; see PF-9 |
> | PF-10 `…0024` guard columns exist | ⚪ **N/A on 2026-08-11** — `…0024` did not exist on disk yet; run it before the next push |
>
> **10 checks are UNVERIFIED, not passed.** Do not read this table as a pass with
> caveats. The apply went ahead **without** PF-6, PF-7a and PF-7b, relying instead
> on each migration's own in-transaction post-conditions to abort rather than
> half-apply — every file in this set is wrapped `BEGIN; … COMMIT;` and asserts
> its own outcome before committing.
>
> **That reliance was a risk accepted, not a risk retired.** It happened to hold:
> `db push` returned exit 0 and the post-apply probes agree. But PF-6 and PF-7
> exist to catch failure modes the post-conditions cannot — PF-7a in particular
> guards against `CREATE OR REPLACE` silently creating a *second* overload rather
> than replacing, which this repo has been burned by twice (`20260702170000`,
> `20260729130000`) and which an in-transaction assertion on the new body would
> not necessarily notice. **Run PF-6 and PF-7 retroactively when a connection with
> `psql` is available**, and run all of them before any future apply.

Run against the target DB with the service role / `postgres` connection. All
read-only.

```bash
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
node scripts/verify-20260814-migrations.mjs --preflight      # runs PF-1..PF-7, PF-9, PF-10 below
                                                            # (PF-8 is human-only — see its note)
```

Or by hand:

### PF-1 — ✅ are any of these already recorded applied? — resolved 2026-08-11 for the security slice

```sql
SELECT version
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260814000007','20260814000008','20260814000009',
                   '20260814000010','20260814000011','20260814000018',
                   '20260814000019','20260814000020','20260814000021',
                   '20260814000022','20260814000023','20260814000024')
 ORDER BY version;
```

> **Why an explicit list and not `BETWEEN '…0007' AND '…0024'`.** After the
> 2026-08-11 renumber this set is **non-contiguous** — there is nothing at
> `…0012`-`…0017`, and those versions now belong to
> `fix/ci-structural-defects`'s migrations. A range would report *those* as
> "already recorded applied" and abort the release for a reason that has nothing
> to do with this set. (The range this replaced also ended one version short of
> its own tail, so it never checked the last migration in the gate.)

**Expected**: **zero rows**. If a version *is* listed, `db push` will silently
skip it. Check whether its objects actually exist (§4) — if they do not, you are
in the **repair-skip** case and must stream the body via STDIN (§3.2). This
failure mode has happened on this prod before; see
`docs/runbooks/school-admin-portal-db-apply.md` §A.2.

> **⚠️ This query needs a DB connection string — it cannot be run over
> PostgREST.** `GET /rest/v1/schema_migrations` with
> `Accept-Profile: supabase_migrations` returns `PGRST106 — Invalid schema:
> supabase_migrations. Only the following schemas are exposed: public,
> graphql_public`, for an API key of any role. `supabase migration list` is
> likewise unavailable without the connection string. Measured 2026-08-11; see
> *Verified production state*, fact 3. **Do not spend time re-attempting the
> ledger over the REST API.**

> **PF-1 was RESOLVED behaviourally on 2026-08-11** (fact 4), which is stronger
> evidence than a ledger row — it tests the live privilege, not the record of an
> apply. Result on production `shktyoxqhundlvkiwguu`:
>
> | Version | Status | Basis |
> |---|---|---|
> | `…0020` answer-key ACL | **NOT APPLIED** | **MEASURED** — anon `select=question_id` returned `[]`, so the table-level grant `…0020` revokes is intact |
> | `…0021` `session_mode` | **NOT APPLIED** | **MEASURED** — anon `select=session_mode` returned `42703 column … does not exist` |
> | `…0022` written scoring | not applied | **INFERRED** — `db push` applies in version order and `…0021` has not run; **not probed directly** |
> | `…0023` keyless serving | not applied | **INFERRED** — same argument; **not probed directly** |
> | `…0007`-`…0011` + `…0018`/`…0019` | **not determined** | the ledger was never read; fact 1 shows only that production *state* matches M1's keep-set |
>
> Consequence: there is **no repair-skip case** for `…0020`/`…0021` — their
> objects are absent and no ledger row can be suppressing them via the normal
> path, so `db push` will apply them. **This check stays mandatory and unskipped
> at apply time** for `…0007`-`…0011` + `…0018`/`…0019`, and the two INFERRED rows must be
> confirmed (PF-7 and PF-9 both distinguish the states from `pg_proc` alone).

> ### ✅ PF-1 was then read DIRECTLY, 2026-08-11, immediately before the apply
>
> `supabase migration list --db-url` — the connection-string route this section
> says is required — returned the ledger without difficulty. **This supersedes the
> behavioural inference above with a direct read**, and it also settles the row
> the behavioural probe could not reach at all (`…0007`-`…0011`):
>
> | Versions | Ledger state before the apply |
> |---|---|
> | `…0007` – `…0011` | **already applied** — by an earlier route, not by this runbook, and **not verified by it** |
> | `…0012` – `…0017` | applied on **neither** branch |
> | `…0018` – `…0023` | not applied — consistent with, and now stronger than, the behavioural probe |
>
> **`…0012`-`…0017` being applied on neither branch is the finding worth keeping.**
> It means the version collision this whole renumber existed to prevent **had not
> yet bitten** — no file had been silently skipped. The renumber was
> **preventive**, and this ledger read is the proof; previously that was an
> argument, not evidence. Nothing had to be repaired.
>
> There was therefore **no repair-skip case for any version in the set**, and
> §3.1's normal path was the correct one.

### PF-2 — ✅ the `is_content_ready` question (M3's real dependency) — measured green 2026-08-11

`subjects.is_content_ready` is **COMPUTED, never seeded**. It is written only by
`public.compute_subject_content_readiness_v2()`
(`20260622000000:39`, `:99`), which sets it to
`(ready_chapters > 0 AND questions > 0)` where `ready_chapters` counts
`cbse_syllabus` rows with `rag_status IN ('partial','ready') AND is_in_scope`
and `questions` counts active `question_bank` rows for that subject code. A
subject nobody has ingested content for reads `false` forever, and *nothing in
this migration set recomputes it*.

M3's own header (`…0018:70-72`) states that `get_available_subjects()` requires
`sub.is_active AND sub.is_content_ready`, and therefore that its new
physics/chemistry/biology grants stay **invisible** to grade 11-12 free/starter
students if those three are not content-ready — leaving them still seeing only
`math`, silently unfixed.

**That header claim is stale against the on-disk chain, and you must measure
which is true on the target DB before believing either.** The newest on-disk
definitions of **both** pickers gate on `sub.is_active` **only**:

- `get_available_subjects` — `20260621000400:66` (`WHERE sub.is_active;`). That
  migration exists *precisely* to remove the `is_content_ready` gate, and its
  header records that the gated version may still be live on prod.
- `get_available_subjects_v2` — `20260605000000:140` (`WHERE sub.is_active`).

The **baseline** (`00000000000000_baseline_from_prod.sql`, a pg_dump *of prod*)
carries the gated version. So whether the gate is live is a question about the
deployed function body, not about the repo. Measure it:

```sql
-- PF-2a: does the DEPLOYED picker gate on is_content_ready?
SELECT p.proname,
       position('is_content_ready' IN pg_get_functiondef(p.oid)) > 0 AS gates_on_content_ready
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('get_available_subjects', 'get_available_subjects_v2')
 ORDER BY p.proname;

-- PF-2b: readiness of the keep-set right now.
SELECT code, is_active, is_content_ready
  FROM public.subjects
 WHERE code IN ('math','science','physics','chemistry','biology')
 ORDER BY code;
```

**Measured on production, read-only, 2026-08-11 — the blocking risk is RETIRED.**
PF-2b returned `is_content_ready = true` for **all five** keep-set codes
(`math`, `science`, `physics`, `chemistry`, `biology`), all five also
`is_active = true`. So the STOP case below — M3 granting physics/chemistry/
biology while grade 11-12 free/starter students still see only `math` — **cannot
be reached at these values**, and it no longer matters whether the deployed
picker gates on `is_content_ready`: with all five ready, both branches of PF-2a
proceed. PF-2a itself was **not** measured and is now informational rather than
blocking.

> Also measured, and consistent: `computer_science`, `english`, `hindi`,
> `informatics_practices`, `sanskrit` and `social_studies` are content-ready but
> **inactive**. Readiness is computed per subject and is independent of the
> catalogue flip, so ready-but-inactive is the expected shape, not an anomaly.

**Still run both probes immediately before applying — production can drift
between the measurement above and your deploy.** The re-run is a pass when all
five keep-set codes read `is_content_ready = true` (any PF-2a result). If a
keep-set code has since flipped to `false` **and** PF-2a shows either picker
gating on `is_content_ready`, the original blocker is back: **STOP**, run
`SELECT * FROM public.compute_subject_content_readiness_v2();` (service role),
re-run PF-2b, and only proceed once all five read `true`. If a subject *cannot*
be made ready (no `cbse_syllabus` / `question_bank` content), that is a
**content** blocker, not a migration blocker — escalate; do not ship M3 into it.

> Note `compute_subject_content_readiness_v2()` loops only over
> `subjects WHERE is_active`, so running it **after** M1 covers exactly the
> keep-set. Running it before M1 also recomputes doomed subjects harmlessly.

### PF-3 — will M2's assertion fire?

M2 aborts the whole transaction if any `(grade, board)` pair that existed before
is left with zero mapped subjects (`…0008:160-193`). Compute that set first so
the abort is a decision, not a surprise. Grades 11-12 can never be stranded —
step 4 re-seeds four stream-NULL rows for every pre-existing 11/12 pair before
step 5 deletes anything (`…0008:141-158`) — so only 6-10 pairs are at risk:

```sql
WITH keep(code) AS (VALUES ('math'),('science'),('physics'),('chemistry'),('biology')),
pairs AS (SELECT DISTINCT grade, board FROM public.grade_subject_map)
SELECT p.grade, COALESCE(p.board, '<null>') AS board
  FROM pairs p
 WHERE p.grade NOT IN ('11','12')
   AND NOT EXISTS (
     SELECT 1
       FROM public.grade_subject_map g
      WHERE g.grade = p.grade
        AND g.board IS NOT DISTINCT FROM p.board
        AND g.subject_code IN (SELECT code FROM keep)
   )
 ORDER BY 1, 2;
```

**Expected**: **zero rows**.

**If it returns rows — the assertion is a deliberate abort, not a failure.** M2
is wrapped in `BEGIN; … COMMIT;`, so the `RAISE` rolls steps 1-5 back in full and
the database is left exactly as it was. Nothing is half-applied. The listed pairs
are `(grade, board)` combinations — typically an ICSE or State-board grade whose
only mapped subjects were english / hindi / social_studies — whose students would
otherwise have been silently wiped to an **empty subject list with no error
anywhere**.

**The fix is to seed, never to shrink.** For each listed pair, insert the missing
rows — `math` for grades 6-12 and `science` for grades 6-10 (grades 11-12 take
physics/chemistry/biology instead; there is deliberately no `science` row at
11-12, per `…0008:11-16`) — then re-run the migration. The migration's own HINT
says the same (`…0008:190`).

> **Do NOT weaken the keep-set, edit the assertion, or delete the offending
> `grade_subject_map` rows to make it pass.** The keep-set is CEO-locked and is
> declared exactly once per file on purpose. An abort here is the safety net
> doing its job.

### PF-4 — ✅ the teacher blast radius (M8's precondition) — MEASURED 2026-08-11, and it was nil

> **✅ CLOSED WITH A MEASURED VALUE, taken BEFORE the apply.** `psql` was
> unavailable, so the diagnostic below could not be run as written; the same
> question was answered over PostgREST instead:
>
> - `teachers_total` = **8**
> - **every one of the 8 has an empty `subjects_taught`**
> - ⇒ `would_be_left_with_zero` = **0**, `would_be_partially_trimmed` = **0**
>
> So `…0019` trimmed **zero teachers** and stranded **zero teachers**. PF-4 is
> closed on a measurement, not an assumption, and there is **no support hand-off
> population** from this migration.
>
> A teacher with an empty `subjects_taught` cannot be *trimmed* (nothing to
> remove) and cannot be *newly stranded* (already effectively stranded). M8-4's
> reconciliation is therefore satisfied by `left_with_zero = 0`; anything else
> means the population changed after this measurement.

M8's audit row reports `teachers_left_with_zero`. That number is only meaningful
if it agrees with the diagnostic taken beforehand. Run **Q1 of
`docs/subject-restriction-teacher-impact.sql`** and record
`would_be_left_with_zero`:

```bash
psql "$DB_URL" -f docs/subject-restriction-teacher-impact.sql
```

Record all three headline numbers (`teachers_total`, `would_be_left_with_zero`,
`would_be_partially_trimmed`). Q2 tells you which subjects are doing the
stranding; Q3 tells you whether those teachers own live classes and how many
student enrolments sit in them.

The two definitions **are** equivalent by construction: the diagnostic counts
teachers with a non-empty `subjects_taught` whose keep-set intersection is empty;
M8 counts rows in `_teacher_subject_trim` with non-empty `before_codes` and NULL
`after_codes` (`…0019:307-310`), and its step-1 guard proves the active catalogue
*is* the keep-set before it trims (`…0019:124-152`). So a disagreement in §4 (M8-4)
means **the catalogue changed between the two runs** — someone activated or
deactivated a subject out of band. Stop and reconcile; do not accept the newer
number.

Run the diagnostic as close in time to the apply as you can, and **before**
M1 — or after M1, which returns the same answer (the diagnostic keys on the
keep-set literal either way; `docs/subject-restriction-teacher-impact.sql:15-18`).

### PF-5 — all five keep-set codes exist in `public.subjects`

```sql
SELECT k.code, (s.code IS NOT NULL) AS present
  FROM (VALUES ('math'),('science'),('physics'),('chemistry'),('biology')) AS k(code)
  LEFT JOIN public.subjects s ON s.code = k.code
 ORDER BY 1;
```

**Expected**: five rows, all `present = true`.

A missing code fails **twice, loudly**: M3 step 3 aborts on
`plan_subject_access_subject_code_fkey → subjects(code)` (`…0018:100-104`), and
M8 step 1 aborts with *"missing from active"* (`…0019:135-149`). Both are correct
failures. Insert the missing `subjects` row; do not shrink the keep-set.

### PF-6 — 🔴 every column `…0020` grants must already exist — **NEVER VERIFIED**

> **🔴 NOT RUN on 2026-08-11.** `psql` was not on PATH and this query was never
> executed by any other route. **`…0020` was applied without it.**
>
> The apply succeeded, which after the fact tells us the columns *were* all
> present — a missing one would have errored the `GRANT` and rolled the
> transaction back, exactly as this section describes. **That is retrospective
> inference from a green apply, not a pre-flight check**, and it would have been
> no comfort at all had the transaction aborted mid-release. Run this
> retroactively when `psql` is available, and never skip it again.

`…0020` grants a **literal** 10-column allowlist. If any column is absent on the
target DB the `GRANT` errors and the whole transaction rolls back — deliberate
loud failure on a security ACL (`…0020:141-147`).

```sql
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'quiz_session_shuffles'
 ORDER BY column_name;
```

**Expected**: the result is a superset of
`session_id, question_id, student_id, shuffle_map, options_snapshot,
options_version_at_serve, created_at, student_selected_displayed_index,
student_time_spent_seconds, student_answered_at`.

`options_version_at_serve` and `integrity_hash` arrive from `20260504100500` /
`20260801100900`; the three `student_*` durability columns from `20260802130000`.
If any is missing, that earlier migration has not landed — apply it first.

### PF-7 — 🔴 `…0022` prerequisites — **NEVER VERIFIED**

> **🔴 NEITHER query was run on 2026-08-11.** `psql` was not on PATH. **`…0022`
> was applied without PF-7a (the overload-signature check) or PF-7b (the
> chain-dep ledger rows).**
>
> **PF-7a is the one to run retroactively, and soon.** The failure it guards is
> *silent*: if the deployed `submit_quiz_results_v2` had a different argument-type
> list, `CREATE OR REPLACE` creates a **second overload** instead of replacing,
> the migration still commits green, and every caller then hits an ambiguity error
> at runtime. A green `db push` does **not** rule this out — that is precisely why
> the check is a pre-flight and not a post-condition. This repo has been burned by
> exactly this twice (`20260702170000`, `20260729130000`).
>
> Run the first query now and confirm it returns **exactly one row**:
>
> ```sql
> SELECT p.oid::regprocedure::text
>   FROM pg_proc p
>  WHERE p.pronamespace = 'public'::regnamespace
>    AND p.proname = 'submit_quiz_results_v2'
>  ORDER BY 1;
> ```
>
> More than one row means the overload was created and written-answer scoring is
> broken in production.

```sql
-- exactly ONE overload must exist, with the 11-arg signature
SELECT p.oid::regprocedure::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'submit_quiz_results_v2'
 ORDER BY 1;

-- and the chain deps must be recorded applied
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260801100800','20260801100900','20260809000500')
 ORDER BY 1;
```

**Expected**: exactly one row from the first query, reading
`submit_quiz_results_v2(uuid,uuid,text,text,text,integer,jsonb,integer,uuid,integer,integer)`;
three rows from the second.

`…0022` is a plain `CREATE OR REPLACE` on that exact signature (`…0022:99-103`).
If the deployed function has a **different argument-type list**, `CREATE OR
REPLACE` creates a *second overload* rather than replacing, and every caller then
hits an ambiguity error. If the first query returns zero rows or more than one,
stop and reconcile before applying. `20260801100800` matters separately: it is
what makes `start_quiz_session` write an identity-shuffle / empty-snapshot row
for a non-MCQ, which is the exact server-side marker `…0022` keys the written
lane off (`…0022:20-28`).

### PF-8 — 🔴 pricing reconciliation is staged in the same release (M3) — **THIS GATE DID NOT HOLD**

> ## 🔴 OPEN — THE PRICING COPY IS NOW FACTUALLY WRONG IN PRODUCTION
>
> **`…0018` was applied to production on 2026-08-11. The copy was not.** This gate
> says the migration passes "only when the copy change is merged and staged for
> the same deploy"; it shipped ahead of the copy instead. **This is exactly the
> failure PF-8 exists to prevent, and it is live now.**
>
> **What is true in the database as of 2026-08-11:** `max_subjects` is `NULL` on
> all four plans and every plan grants all five keep-set subjects.
> **Free and starter now grant all five subjects with no cap.**
>
> **What the product still tells customers:**
>
> | Surface | Location | The false claim |
> |---|---|---|
> | Plan config (EN + HI) | `packages/lib/src/plans.ts` | `'2 subjects'` / `'2 विषय'`, `'4 subjects'` / `'4 विषय'` |
> | Public pricing page | `packages/ui/src/landing/v3/PricingPlansV3.tsx` | second, independent hardcoded `'2 subjects'` / `'4 subjects'` |
> | **Structured data → search results** | `packages/ui/src/JsonLd.tsx` | inherits `PLANS`; **feeds Google, so the stale claim propagates off-site** |
>
> **`JsonLd.tsx` is the one to weight highest.** The other two are wrong to a
> visitor already on the page; structured data pushes the wrong offer into search
> results, where it is cached, attributed to us, and not visible to anyone
> checking the site. It is also the surface least likely to be remembered in a
> copy fix.
>
> **Direction of the error is mitigating, not exculpating.** Customers are being
> under-promised and over-delivered — free/starter users get *more* than the page
> claims, so nobody is short-changed and there is no refund exposure. It remains a
> misrepresentation of the product and a brand/legal accuracy problem, and it
> makes the free tier look weaker than it is at the exact moment of the pricing
> decision.
>
> **Action — not owned by this runbook.** Ops owns neither `packages/lib/**` nor
> `packages/ui/**`. Hand to **frontend** (all three surfaces above) with
> **backend** (DB-held `subscription_plans.tagline` / `price_display`, also
> untouched by the migration), and get CEO sign-off on the new wording. Until it
> ships, treat this as a **known live discrepancy**, not a latent risk.
>
> Also brief the admin: `/super-admin/subjects/plan-access` reads live from the DB
> and self-updates, so its `max_subjects` input now shows "unlimited" for every
> plan. That is correct, not a bug.

`…0018` is a customer-facing pricing change. **Applying it makes existing pricing
copy false the moment it commits.** The migration updates *no* copy
(`…0018:16-21`). These are the surfaces, all verified present on disk at
authoring time:

| Surface | Location | What goes false |
|---|---|---|
| Plan config (EN + HI) | `packages/lib/src/plans.ts:37` `'2 subjects'` / `'2 विषय'`; `:52` `'4 subjects'` / `'4 विषय'` | free is no longer 2-subject, starter no longer 4-subject |
| Public pricing page | `/pricing` → `packages/ui/src/landing/v3/PricingV3.tsx` → `packages/ui/src/landing/v3/PricingPlansV3.tsx:73` `'2 subjects'`, `:91` `'4 subjects'`, `:83` tagline `'More chats, more subjects'` | **second, independent hardcoded copy** of the same claims |
| Everything else rendering `PLANS` | `packages/ui/src/landing/PricingTeaserV2.tsx`, `.../v3/PricingTeaserV3.tsx`, `packages/ui/src/billing/v2/PlanModal.tsx`, `packages/ui/src/JsonLd.tsx` (structured data → search results), `apps/host/src/app/super-admin/subscriptions/page.tsx` | inherit the same false claims |
| DB-held copy | `subscription_plans.tagline`, `subscription_plans.price_display` | not touched by the migration |
| Admin console | `/super-admin/subjects/plan-access` | reads live from the DB (`…/plan-access/route.ts:99`) so it self-updates — **but** the `max_subjects` input will now show "unlimited" for every plan; brief the admin |

**Gate**: PF-8 passes only when the copy change is merged and staged for the same
deploy as the migration. Ops does not own `packages/lib/**` or `packages/ui/**` —
hand this to **frontend** (copy) with **backend** (DB-held `tagline`/
`price_display`) and get explicit CEO sign-off on the new wording. Shipping the
migration ahead of the copy is a live misrepresentation of what customers are
paying for.

### PF-9 — 🔴 `…0023`'s client half is in the same deploy — **GATE HELD; `…0023` WAS NOT APPLIED**

> ## 🔴 `20260814000023` IS STILL PENDING — DELIBERATELY HELD BACK ON 2026-08-11
>
> **PF-9 did not pass, so `…0023` was excluded from the apply.** The other five
> migrations went to production; this one was physically moved out of
> `supabase/migrations/` for the duration of the `db push` so it could not be
> picked up, then restored afterwards. **The file is unchanged — same bytes,
> verified by hash.** It is committed and ready; it simply must not be applied
> yet.
>
> **Why it was held — the failure is total, not partial.** `…0023` strips
> `correct_answer_index` from the serving RPC payloads. The client that consumes
> those payloads **has been repointed and committed, but is NOT deployed to
> production.** The live client's P6 gate
> (`packages/lib/src/quiz/question-validation.ts`) still treats an absent
> `correct_answer_index` as a validation failure. So against today's deployed
> frontend, applying `…0023` would make **every served question fail P6** and
> render **empty quizzes in production** — every student, every subject, every
> grade, immediately. Not a degraded experience: no questions at all.
>
> **The rule: `…0023` ships in the same release as the client, or after it. Never
> before.** There is no flag to hedge with and no partial rollout — the coupling
> is in the payload shape itself.
>
> **This ordering constraint is the opposite of the rest of the set.** `…0018`
> through `…0022` were safe to apply ahead of their frontend (that is *why* the
> pricing-copy discrepancy in PF-8 is survivable). `…0023` is not. Do not
> generalise "the DB went first and it was fine" from those five to this one.
>
> **Before applying it, re-run this whole section**: confirm the client half is
> **deployed** (not merely merged), then confirm behaviourally in staging with K-5
> (§4). The signature query below must also still return its five rows.

`…0023` is the one migration in this set that **breaks the product if deployed
alone**. Two coupled client changes must ship with it:

1. **The P6 gate must stop requiring `correct_answer_index`.** The migration
   removes that key from three serving payloads; the browser gate at
   `packages/lib/src/quiz/question-validation.ts` currently checks it and would
   see `undefined` for every row → **100% of MCQs rejected** (`…0023:32-36`).
2. **The quiz page must drop any served question the server did not snapshot.**
   `start_quiz_session` now silently skips P6-failing questions
   (`…0023:841-861`).

There is no SQL probe for this — it is a deploy-composition check. Confirm by
inspection, then confirm behaviourally in staging with K-5 (§4) **before** prod.

> **Status at authoring (2026-08-11, verified by `git diff` in this worktree):**
> both halves are present and uncommitted alongside the migration —
> `packages/lib/src/quiz/question-validation.ts` (+47/-3, the P6 gate no longer
> requires the key) and `apps/host/src/app/(student)/quiz/page.tsx` (+140,
> including a "Server declined to snapshot questions; dropping before serve"
> branch). Also changed in the same set: `packages/lib/src/quiz-assembler.ts`,
> `packages/lib/src/domains/quiz.ts`, `packages/lib/src/supabase.ts`,
> `packages/lib/src/adaptive/select-adaptive-questions.ts`, and the `/learn`
> chapter page (the `check_formative_answer` caller). **Re-confirm at deploy
> time** — this note records what was on disk, not what is on the release
> branch.

Also verify the four prior definitions `…0023` rebuilds from are actually the
deployed ones, since it is a full-body `CREATE OR REPLACE` of each:

```sql
SELECT p.oid::regprocedure::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('select_quiz_questions_rag','select_quiz_questions_v2',
                     'get_quiz_questions','start_quiz_session')
 ORDER BY 1;
```

**Expected** (`…0023:113-123`): `select_quiz_questions_rag` 8 args,
`select_quiz_questions_v2` 7 args, `get_quiz_questions` **two** overloads (4-arg
and 5-arg), `start_quiz_session` 2 args — **five rows** (four distinct names, one of them doubled). `…0023` reuses each exact
signature so no new overload can be created; a signature that does not match
means the deployed body is not the one it was written against, and `CREATE OR
REPLACE` would add an overload instead of replacing. This repo has been burned by
exactly that twice (`20260702170000`, `20260729130000`). Stop and reconcile.

### PF-10 — ⚪ every `subscription_plans` column `…0024` reads or writes exists — **NOT YET RUN**

`…0024`'s very first statement is a `CREATE TEMP TABLE _plan_price_guard AS
SELECT …` over the pricing columns, and its audit payload also reads
`max_subjects`. A column missing from that list errors out at statement one.

```sql
SELECT c
  FROM UNNEST(ARRAY['plan_code','price_monthly','price_yearly','price_display',
                    'razorpay_plan_id','razorpay_plan_id_monthly',
                    'razorpay_plan_id_quarterly','is_active','max_subjects',
                    'subjects_allowed']) AS c
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='subscription_plans'
                      AND column_name = c);                  -- expect: 0 rows
```

**Expected**: **zero rows.** `razorpay_plan_id_quarterly` is the youngest of them
(added by `20260620000800`) and so the likeliest absentee on a forked or older
database; apply that migration first if it is listed.

> **This is a convenience gate, not a safety gate** — unlike PF-6, a miss here
> produces a clean transaction-wide abort, not a half-apply, because `…0024` is
> wrapped `BEGIN; … COMMIT;`. It exists to save you a failed push. **Do not
> "fix" a failure by removing a column from the migration's guard snapshot**: the
> guard is the entire proof that `…0024` moved no price.

---

## 3. Apply

> ### ✅ EXECUTED 2026-08-11 — production `shktyoxqhundlvkiwguu`, exit 0
>
> The **normal path (§3.1)** was used, invoked as `supabase db push --db-url`
> rather than via `supabase link`. **No repair-skip (§3.2) was needed** — PF-1's
> direct ledger read showed no version in the set already recorded applied.
>
> **Applied, in version order:**
>
> - `20260814000018_plan_subject_access_restrict`
> - `20260814000019_trim_teacher_subjects_taught`
> - `20260814000020_quiz_session_shuffles_answer_key_column_acl`
> - `20260814000021_quiz_session_shuffles_session_mode`
> - `20260814000022_submit_quiz_v2_written_answer_scoring`
>
> **Not applied — held back deliberately:** `20260814000023`. It was moved out of
> `supabase/migrations/` before the push so `db push` could not pick it up, and
> restored unchanged afterwards. See PF-9 for why; see §4 `…0023` for what remains
> unverified as a result.
>
> **Not applied — did not exist yet:** `20260814000024`, which landed on disk on
> **2026-08-12**, after this apply. It is now also pending, and pending for a
> *coupling* reason rather than a risk one — it sorts above `…0023` and `db push`
> cannot apply a subset. **The same move-it-aside trick used for `…0023` will not
> help here**: moving `…0024` aside does not release `…0023`. Either ship both
> after the frontend deploys, or stream `…0024`'s body alone via §3.2. See §1 and
> §4 `…0024`.
>
> **No staging rehearsal was performed**, contrary to §3.1's instruction below.
> Recorded as a deviation, not a footnote.
>
> **M1's rollback caveat still applies and was NOT discharged.** The
> `SELECT code, is_active FROM public.subjects ORDER BY code` snapshot that §3.2
> exception 2 calls "your real rollback source" is **not recorded as having been
> taken**. `…0007`-`…0011` were already applied long before this apply, so nothing
> in this release changed the catalogue — but if a catalogue rollback is ever
> needed, that snapshot does not exist and will have to be reconstructed.

### 3.1 Normal path — `supabase db push`

```bash
supabase login                                    # paste SUPABASE_ACCESS_TOKEN
supabase link --project-ref "$TARGET_PROJECT_REF" --password "$TARGET_DB_PASSWORD"

supabase db push --dry-run                        # read-only preview
supabase db push
```

**Rehearse on staging first.** Every one of the seven Phase 3 migrations touches
either every student row, every teacher row, or the pricing surface.

**Acceptance**: exit `0`; the ten files appear as pending → applied; no `ERROR:`
lines. An abort from M2's or M3's assertion is *expected behaviour* under the
conditions in PF-3 / PF-5, not a bug — see those sections.

### 3.2 Repair-skip path — stream the body via STDIN

If PF-1 shows a version already recorded applied but §4 shows its objects absent,
`db push` is a **no-op** for it. Stream the body directly:

```bash
npx -y supabase db query --linked < supabase/migrations/20260814000022_submit_quiz_v2_written_answer_scoring.sql
```

> **Windows: use STDIN (`<`), never the argument form.** The argument form blows
> the ~32 KB command-line limit and the shell mangles `$$` dollar-quoting. Same
> caveat and same reasoning as `docs/runbooks/school-admin-portal-db-apply.md`
> §A.2.

Every migration in this set is individually idempotent and individually wrapped
in `BEGIN; … COMMIT;`, so streaming a body is safe to repeat.

**Two exceptions to "safe to repeat" that you must know about:**

1. **M2 / M3 / M8 audit rows are `NOT EXISTS`-guarded on the action code**
   (`…0008:215-218`, `…0018:178-181`, `…0019:325-328`). Re-running writes no
   second row — deliberately, so the rollback snapshot stays unambiguous.
2. **M1's audit row is written only when the migration actually changed
   something** (`…0007:106-107` — `WHERE EXISTS (SELECT 1 FROM deactivated) OR
   EXISTS (SELECT 1 FROM reactivated)`). On a database already in the target
   state, M1 commits cleanly and writes **no audit row at all**. Since that row is
   M1's declared rollback source of truth (`…0007:30-37`), *"the audit row is
   absent"* means either "M1 never ran" **or** "M1 ran and had nothing to do" —
   the two are indistinguishable after the fact. Snapshot
   `SELECT code, is_active FROM public.subjects ORDER BY code` **before** applying
   and keep it with the change ticket. That snapshot is your real rollback source.

---

## 4. Post-apply verification

```bash
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
node scripts/verify-20260814-migrations.mjs
```

Exit `0` = every blocking check passed. Exit `1` = at least one failed. Exit `3`
= no database was reachable and **nothing was verified** (the script prints the
full list of checks it could not run and never exits `0` vacuously).

The individual SQL is below. "Offending rows" checks pass when they return
**zero rows** — the query is written to return exactly the rows that prove the
migration did not land.

### M1 — `20260814000007`

```sql
-- M1-1 (blocking): no active subject outside the keep-set.
SELECT code FROM public.subjects
 WHERE is_active
   AND code NOT IN ('math','science','physics','chemistry','biology')
 ORDER BY code;                                              -- expect: 0 rows

-- M1-2 (blocking): every keep-set code that EXISTS is active.
SELECT code FROM public.subjects
 WHERE code IN ('math','science','physics','chemistry','biology')
   AND is_active IS DISTINCT FROM TRUE
 ORDER BY code;                                              -- expect: 0 rows
```

> **Not assertable**: "exactly one `subject.catalogue.restricted_to_math_science`
> audit row." See §3.2 exception 2 — the row is conditional. `0 or 1` is the only
> honest expectation, and the check script treats `> 1` as the only failure.

### M2 — `20260814000008`

```sql
-- M2-1 (blocking): no out-of-keep-set map row survives.
SELECT grade, subject_code, COALESCE(stream,'<null>'), COALESCE(board,'<null>')
  FROM public.grade_subject_map
 WHERE subject_code NOT IN ('math','science','physics','chemistry','biology')
 ORDER BY 1,2,3,4;                                           -- expect: 0 rows

-- M2-2 (blocking): grades 11-12 are fully de-streamed.
SELECT grade, subject_code, stream, COALESCE(board,'<null>')
  FROM public.grade_subject_map
 WHERE grade IN ('11','12') AND stream IS NOT NULL
 ORDER BY 1,2;                                               -- expect: 0 rows

-- M2-3 (blocking): no (grade, board) pair that existed before is now empty.
-- The pre-change pair set = current rows UNION archived rows.
WITH pairs AS (
  SELECT DISTINCT grade, board FROM public.grade_subject_map
  UNION
  SELECT DISTINCT grade, board FROM public.grade_subject_map_archive_20260814
)
SELECT p.grade, COALESCE(p.board,'<null>')
  FROM pairs p
 WHERE NOT EXISTS (
   SELECT 1 FROM public.grade_subject_map g
    WHERE g.grade = p.grade AND g.board IS NOT DISTINCT FROM p.board
 )
 ORDER BY 1,2;                                               -- expect: 0 rows

-- M2-4 (blocking): every pre-existing 11/12 (grade,board) pair has the four
-- stream-NULL codes.
WITH pairs AS (
  SELECT DISTINCT grade, board FROM public.grade_subject_map
  UNION
  SELECT DISTINCT grade, board FROM public.grade_subject_map_archive_20260814
),
want(code) AS (VALUES ('math'),('physics'),('chemistry'),('biology'))
SELECT p.grade, COALESCE(p.board,'<null>'), w.code
  FROM pairs p CROSS JOIN want w
 WHERE p.grade IN ('11','12')
   AND NOT EXISTS (
     SELECT 1 FROM public.grade_subject_map g
      WHERE g.grade = p.grade AND g.board IS NOT DISTINCT FROM p.board
        AND g.subject_code = w.code AND g.stream IS NULL
   )
 ORDER BY 1,2,3;                                             -- expect: 0 rows

-- M2-5 (blocking): archive table exists, RLS on, no client-role grant.
SELECT c.relrowsecurity,
       has_table_privilege('authenticated','public.grade_subject_map_archive_20260814','SELECT'),
       has_table_privilege('anon','public.grade_subject_map_archive_20260814','SELECT'),
       has_table_privilege('service_role','public.grade_subject_map_archive_20260814','SELECT')
  FROM pg_class c
 WHERE c.oid = 'public.grade_subject_map_archive_20260814'::regclass;
                                            -- expect: 1 row  t | f | f | t

-- M2-6 (blocking): exactly one audit row.
SELECT count(*) FROM public.admin_audit_log
 WHERE action = 'subject.grade_map.restricted_and_destreamed';   -- expect: 1
```

> **Not assertable**: `is_core = TRUE` on the re-seeded 11/12 rows. Step 4 is
> `ON CONFLICT DO NOTHING` (`…0008:148`), so a *pre-existing* stream-NULL row for
> the same `(grade, subject_code, NULL, board)` key keeps whatever `is_core` it
> already had. The migration's intent (`…0008:129-132`) is `TRUE` for all four,
> but the post-state genuinely depends on pre-state and cannot be derived from
> source. Inspect it if it matters; do not gate on it.

### M4 — `20260814000009`

```sql
-- M4-1 (blocking): pass-1 residual — no enrollment on a dead/inactive subject.
SELECT sse.student_id, sse.subject_code
  FROM public.student_subject_enrollment sse
  LEFT JOIN public.subjects sub ON sub.code = sse.subject_code
 WHERE sub.code IS NULL OR sub.is_active IS DISTINCT FROM TRUE
 ORDER BY 1,2;                                               -- expect: 0 rows

-- M4-2 (blocking): pass-2 residual — enrollment-less students with a dead code.
SELECT s.id
  FROM public.students s
 WHERE COALESCE(array_length(s.selected_subjects,1),0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.student_subject_enrollment sse
                    WHERE sse.student_id = s.id)
   AND EXISTS (SELECT 1 FROM UNNEST(s.selected_subjects) AS c
                WHERE NOT EXISTS (SELECT 1 FROM public.subjects sub
                                   WHERE sub.code = c AND sub.is_active))
 ORDER BY 1;                                                 -- expect: 0 rows

-- M4-3 (blocking): pass-3 residual — preferred_subject normalised.
SELECT s.id, s.preferred_subject
  FROM public.students s
 WHERE s.preferred_subject IS NOT NULL
   AND (s.preferred_subject = 'Mathematics'
        OR NOT EXISTS (SELECT 1 FROM public.subjects sub
                        WHERE sub.code = s.preferred_subject AND sub.is_active))
 ORDER BY 1;                                                 -- expect: 0 rows

-- M4-4 (blocking): the repair function's ACL.
SELECT p.prosecdef,
       has_function_privilege('anon',         p.oid, 'EXECUTE'),
       has_function_privilege('authenticated',p.oid, 'EXECUTE'),
       has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'archive_inactive_subject_enrollments';
                                            -- expect: 1 row  t | f | f | t

-- M4-5 (ADVISORY, not a gate): the class NEITHER pass covers.
-- A student who HAS enrollment rows (all of them active) but whose
-- selected_subjects still contains an inactive code is invisible to pass 1
-- (its driving query needs an inactive/dangling enrollment row) AND to pass 2
-- (which needs ZERO enrollment rows). Derived from …0009:90-101 and :179-193.
SELECT count(*)
  FROM public.students s
 WHERE EXISTS (SELECT 1 FROM public.student_subject_enrollment sse
                WHERE sse.student_id = s.id)
   AND EXISTS (SELECT 1 FROM UNNEST(COALESCE(s.selected_subjects, ARRAY[]::TEXT[])) AS c
                WHERE NOT EXISTS (SELECT 1 FROM public.subjects sub
                                   WHERE sub.code = c AND sub.is_active));
```

**M4-5 is a real, source-derived gap, not a defect of this runbook.** If it
returns a non-zero count, those students keep a stale denormalised
`selected_subjects` array. It is cosmetic-to-moderate (the pickers read the
active catalogue) but it will not self-heal. Report the number to backend; do
not block the deploy on it and do **not** hand-patch rows during a release.

### M5 — `20260814000010`

```sql
-- M5-1 (blocking): the active check is in the body, and the function is INVOKER
-- with a pinned search_path.
SELECT p.prosecdef,
       position('subject_not_active' IN pg_get_functiondef(p.oid)) > 0,
       array_to_string(p.proconfig, ',')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'enforce_subject_enrollment';
        -- expect: 1 row  f | t | search_path=public, pg_catalog

-- M5-2 (blocking): the trigger still points at it.
SELECT t.tgname, t.tgenabled
  FROM pg_trigger t
 WHERE t.tgrelid = 'public.student_subject_enrollment'::regclass
   AND t.tgfoid  = 'public.enforce_subject_enrollment'::regproc
   AND NOT t.tgisinternal;
        -- expect: 1 row  trg_enforce_subject_enrollment | O
```

**M5-3 — behavioural probe (manual, rolls itself back).** Prove the write hole is
actually closed. Pick any real student id and any subject the migration
deactivated:

```sql
BEGIN;
INSERT INTO public.student_subject_enrollment (student_id, subject_code)
VALUES ('<a real students.id>', '<a now-inactive code, e.g. english>');
ROLLBACK;   -- unreachable: the INSERT above must raise first
```

**Expected**: `ERROR: subject_not_active`, `SQLSTATE 23514` (`check_violation`),
`DETAIL` carrying `{"subject": "<code>"}`. If it raises
`subject_not_valid_for_grade` or `subject_not_in_plan` instead, M5's new check is
**not** the first gate and the body is not the one in `…0010` — the ordering is
deliberate (`…0010:18-23`). If it *succeeds*, the write hole is open: M5 did not
land. Always `ROLLBACK`.

### M6 — `20260814000011`

```sql
-- M6-1 (blocking): the is_active join is present; SECURITY DEFINER + ACL.
SELECT p.prosecdef,
       position('sub.is_active' IN pg_get_functiondef(p.oid)) > 0,
       has_function_privilege('anon',          p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       has_function_privilege('service_role',  p.oid, 'EXECUTE')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'get_subject_violations';
        -- expect: 1 row  t | t | f | f | t

-- M6-2 (ADVISORY): what the now-meaningful RPC actually reports.
SELECT count(*) FROM public.get_subject_violations(NULL, NULL, NULL, 1000, 0);
```

**M6-2 is advisory, not a gate, and "0" is not a derivable expectation.** After
M4 no student holds an *inactive* subject, but `get_subject_violations` also
flags subjects that are active yet not mapped for the student's grade/stream, or
not granted on their plan. A grade-9 student enrolled in `physics` (active, but
mapped only at 11-12) is a legitimate hit. Any rows returned are **grade/plan**
violations, not catalogue violations. Triage them — with M4-1 green, the
catalogue lane is clean by construction.

### M3 — `20260814000018` (PRICING) — ✅ **APPLIED 2026-08-11; M3-1 + M3-3 verified**

> **Verified over PostgREST** (the SQL below was not run — `psql` unavailable):
> - **M3-3 ✅** — `subscription_plans.max_subjects` is `NULL` on all four plans
>   (`free`, `starter`, `pro`, `unlimited`).
> - **M3-1 ✅, non-vacuously** — `plan_subject_access` holds **exactly 5 rows per
>   plan**, and `plan_codes` is non-empty, so the vacuous-pass warning below does
>   not apply.
>
> **Not verified: M3-2** (that those 5 *are* the keep-set rather than 5 of
> something else), **M3-4** (exactly one audit row carrying both rollback
> payloads), and **M3-5** (the customer-visible check as a real grade-11 free-plan
> student). M3-4 matters for rollback: §5.5's procedure reads its `before` payload
> from that row, and nobody has confirmed it exists.
>
> 🔴 **This migration is what made the pricing copy false in production — see
> PF-8.** The DB is correct; the product's claims about it are not.

```sql
-- M3-1 (blocking): every plan grants exactly the 5 keep-set codes.
WITH plan_codes AS (
  SELECT plan_code FROM public.subscription_plans
  UNION
  SELECT plan_code FROM public.plan_subject_access
)
SELECT p.plan_code,
       (SELECT count(*) FROM public.plan_subject_access psa
         WHERE psa.plan_code = p.plan_code) AS n
  FROM plan_codes p
 WHERE (SELECT count(*) FROM public.plan_subject_access psa
         WHERE psa.plan_code = p.plan_code) <> 5
 ORDER BY 1;                                                 -- expect: 0 rows

-- M3-2 (blocking): and those 5 ARE the keep-set (not 5 of something else).
SELECT plan_code, subject_code
  FROM public.plan_subject_access
 WHERE subject_code NOT IN ('math','science','physics','chemistry','biology')
 ORDER BY 1,2;                                               -- expect: 0 rows

-- M3-3 (blocking): the subject-count cap is gone everywhere.
SELECT plan_code, max_subjects
  FROM public.subscription_plans
 WHERE max_subjects IS NOT NULL
 ORDER BY 1;                                                 -- expect: 0 rows

-- M3-4 (blocking): exactly one audit row, carrying BOTH rollback payloads.
SELECT count(*)
  FROM public.admin_audit_log
 WHERE action = 'subject.plan_access.restricted_to_math_science'
   AND details ? 'plan_subject_access_before'
   AND details ? 'max_subjects_before';                      -- expect: 1
```

> **Vacuous-pass warning, from the migration's own note (`…0018:237-240`):** if
> both `subscription_plans` and `plan_subject_access` are empty, M3-1 passes with
> nothing to check. On a seeded database `plan_codes` is `free, starter, pro,
> unlimited` (both CHECK constraints restrict it to those four). **M3-1 returning
> zero rows on a database with zero plans is not a pass.** The gate script
> therefore also asserts `plan_codes` is non-empty; do the same by hand.

**M3-5 — the customer-visible acceptance.** Sign in as (or impersonate) a grade
11 or 12 student on the **free** plan and open the subject picker. Expected:
Mathematics plus Physics, Chemistry and Biology, none of them locked. Before M3
that student saw exactly one unlocked subject — `math` — because M2 removes
`science` from 11-12 (`…0018:33-46`). If they still see only `math`, go back to
**PF-2**: this is the `is_content_ready` failure mode.

### M8 — `20260814000019` — ✅ **APPLIED 2026-08-11; blast radius measured nil**

> **PF-4 was measured BEFORE the apply: 8 teachers total, every one with an empty
> `subjects_taught`.** So `…0019` trimmed **zero** teachers and stranded **zero**.
>
> **M8-4's reconciliation therefore expects `left_with_zero = 0`** — but the audit
> row was **not queried**, so the reconciliation is *predicted*, not *performed*.
> M8-1, M8-2 and M8-3 were likewise not run.
>
> Consequences of the zero: **no support hand-off population** from this
> migration, and `left_with_zero_live` (the number §4 says to route to support) is
> `0`. Nothing to escalate.

```sql
-- M8-1 (blocking): no teacher differs from their active-intersection.
SELECT t.id
  FROM public.teachers t
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(u.c ORDER BY u.ord) AS after_codes
      FROM UNNEST(COALESCE(t.subjects_taught, ARRAY[]::TEXT[]))
           WITH ORDINALITY AS u(c, ord)
     WHERE EXISTS (SELECT 1 FROM public.subjects sub
                    WHERE sub.code = u.c AND sub.is_active)
  ) agg ON TRUE
 WHERE COALESCE(t.subjects_taught, ARRAY[]::TEXT[])
       IS DISTINCT FROM COALESCE(agg.after_codes, ARRAY[]::TEXT[])
 ORDER BY 1;                                                 -- expect: 0 rows

-- M8-2 (blocking): archive table — RLS on, service-role only.
SELECT c.relrowsecurity,
       has_table_privilege('authenticated','public.teacher_subjects_taught_archive_20260814','SELECT'),
       has_table_privilege('anon','public.teacher_subjects_taught_archive_20260814','SELECT'),
       has_table_privilege('service_role','public.teacher_subjects_taught_archive_20260814','SELECT')
  FROM pg_class c
 WHERE c.oid = 'public.teacher_subjects_taught_archive_20260814'::regclass;
                                            -- expect: 1 row  t | f | f | t

-- M8-3 (blocking): exactly one audit row.
SELECT count(*) FROM public.admin_audit_log
 WHERE action = 'subject.teacher_subjects.trimmed';          -- expect: 1

-- M8-4 (blocking): THE RECONCILIATION. Must equal PF-4's would_be_left_with_zero.
SELECT details->>'teachers_trimmed'              AS trimmed,
       details->>'teachers_left_with_zero'       AS left_with_zero,
       details->>'teachers_left_with_zero_live'  AS left_with_zero_live,
       details->>'teachers_partially_trimmed'    AS partially_trimmed
  FROM public.admin_audit_log
 WHERE action = 'subject.teacher_subjects.trimmed';
```

**M8-4**: `left_with_zero` **must equal** the `would_be_left_with_zero` you
recorded in PF-4. If they disagree, something changed between the two runs —
almost certainly a subject activated or deactivated out of band, or teachers
created/edited in the window. **Stop. Do not accept the newer number.** Re-run
the diagnostic, diff against PF-4, and find the change before you hand any number
to support.

`left_with_zero_live` is the **support hand-off number** — real, non-deleted,
active teachers who will open a blank Command Center. Route it to support with
the Q2/Q3 output from PF-4. Note what M8 does *not* fix (`…0019:24-38`):
`/api/teacher/subjects` already computed the intersection at read time, so the
trim changes no API response and un-blanks no Command Center. It makes the stored
state equal the effective state, so the stranded population becomes **countable**
and a stale array can no longer be round-tripped back by the teacher-profile
subject picker.

### `20260814000020` — answer-key ACL 🔒 — ✅ **APPLIED 2026-08-11, R1 CLOSED**

> **✅ VERIFIED ON THE WIRE, before and after.** The SQL probes below
> (`has_column_privilege`) were **not** run — `psql` was unavailable. What was run
> is the anon-key PostgREST probe from *Verified production state*, executed
> **identically on both sides of the apply**:
>
> | Probe | Before | After |
> |---|---|---|
> | `select=question_id` (**decisive control**) | `[]` | **`42501 permission denied`** |
> | `select=correct_answer_index_snapshot` | `[]` | **`42501 permission denied`** |
> | `select=session_mode` | `42703 column does not exist` | **`42501`** |
>
> **The control is what makes this proof.** `question_id` is a column `…0020` never
> mentions. It could only flip from `[]` to `42501` because
> `REVOKE ALL ON TABLE public.quiz_session_shuffles FROM anon` (`…0020:127`)
> executed and removed the table-level grant wholesale. An empty array on the
> answer-key column alone would have been ambiguous — it is also what a
> row-filtered read returns. The control removes that ambiguity in the affirmative
> direction: privilege was *taken away*, observably.
>
> **🔴 R1 — the session-scoped answer-key read — is CLOSED**, measured on both
> sides rather than inferred from migration source.
>
> **What this does NOT yet prove**, and must not be reported as proven:
> - The **deny side for `authenticated`** (ACL-1's `auth_key_idx` / `auth_hash`).
>   The probe used the **anon** key. `…0020` revokes from `anon` at table level but
>   re-grants a 10-column allowlist to `authenticated` — so the authenticated deny
>   is a *different* mechanism and is untested here. **ACL-5, with a real student
>   JWT, is still outstanding.**
> - The **allow side** (ACL-2 / probe 4): that the legitimate resume read still
>   succeeds for the owner. A REVOKE that over-reaches would also produce `42501`
>   everywhere. **Not verified — no false-positive check was performed.**
> - That scoring still works service-side (probe 5) and that
>   `submit_quiz_results_v2` still grades (probe 6).
>
> Run the SQL probes below and REG-380 Lane B (§6) to close those.

**The two probes that actually prove it.**

```sql
-- ACL-1 (blocking): the deny side. BOTH must read FALSE.
SELECT has_column_privilege('authenticated','public.quiz_session_shuffles',
                            'correct_answer_index_snapshot','SELECT') AS auth_key_idx,
       has_column_privilege('authenticated','public.quiz_session_shuffles',
                            'integrity_hash','SELECT')                AS auth_hash,
       has_column_privilege('anon','public.quiz_session_shuffles',
                            'correct_answer_index_snapshot','SELECT') AS anon_key_idx,
       has_column_privilege('anon','public.quiz_session_shuffles',
                            'integrity_hash','SELECT')                AS anon_hash;
                                            -- expect: f | f | f | f

-- ACL-2 (blocking): scoring + forensics keep the key.
SELECT has_column_privilege('service_role','public.quiz_session_shuffles',
                            'correct_answer_index_snapshot','SELECT'),
       has_column_privilege('service_role','public.quiz_session_shuffles',
                            'integrity_hash','SELECT');               -- expect: t | t

-- ACL-3 (blocking): the resume path survives — all 10 granted columns readable.
SELECT c AS ungranted_column
  FROM UNNEST(ARRAY['session_id','question_id','student_id','shuffle_map',
                    'options_snapshot','options_version_at_serve','created_at',
                    'student_selected_displayed_index','student_time_spent_seconds',
                    'student_answered_at']) AS c
 WHERE NOT has_column_privilege('authenticated','public.quiz_session_shuffles',c,'SELECT');
                                                             -- expect: 0 rows

-- ACL-4 (blocking): no client-role writes; anon holds nothing at all.
SELECT has_table_privilege('authenticated','public.quiz_session_shuffles','INSERT'),
       has_table_privilege('authenticated','public.quiz_session_shuffles','UPDATE'),
       has_table_privilege('authenticated','public.quiz_session_shuffles','DELETE'),
       has_any_column_privilege('anon','public.quiz_session_shuffles','SELECT');
                                            -- expect: f | f | f | f
```

> `options_version_at_serve` is in ACL-3 deliberately. `…0020`'s **own**
> in-transaction post-condition enumerates only 9 of the 10 columns it grants
> (`…0020:180-184` vs `:149-160`) — `options_version_at_serve` is granted and
> never asserted, so if that one grant were dropped or misspelled the migration
> would still COMMIT green and the resume path would break at runtime instead.
> The gap is architect-owned and pinned in its current state by
> `apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts`
> ("KNOWN GAP"). This runbook's ACL-3 covers all 10.

**ACL-5 (blocking) — the real-JWT PostgREST probe.** `has_column_privilege` proves
the catalog; only a real request proves the wire. With a signed-in student's JWT
(their own in-flight session):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/quiz_session_shuffles?select=question_id,correct_answer_index_snapshot&session_id=eq.$SESSION_ID" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $STUDENT_JWT"
```

**Expected**: HTTP **403**, body `{"code":"42501", …}` (`insufficient_privilege`).
Repeat for `integrity_hash` and for `select=*`. Then confirm the legitimate read
still works: `select=question_id,shuffle_map,options_snapshot,student_answered_at`
→ HTTP **200**.

**Anything other than 42501 on the key columns means the leak is open.** A `200`
is the exact production defect this migration exists to close: any signed-in
student with devtools reads the correct answer for every question of a quiz they
have not yet submitted, defeating P3 and making the P1 score meaningless
(`…0020:33-41`).

> **That defect — R1 — is CONFIRMED LIVE on production as of 2026-08-11**, so
> ACL-5 is a *post-apply* check whose pre-apply answer is already known to be the
> bad one. The confirmation came from the anon-key control probe in fact 4
> (`select=question_id` returning `[]` proves the table-level grant `…0020`
> revokes is still in place), not from ACL-5 itself — running ACL-5 with a real
> student JWT before applying will simply reproduce the leak. Run it **after**
> the apply, as written.

> **RESIDUAL — do not report "the answer key is closed".** `…0020` closes the
> session-scoped vector only. `question_bank.correct_answer_index` remains
> readable by any authenticated user via policy
> `question_bank_authenticated_read` (finding C2, deferred in
> `20260814000000:21-33`) — a strictly **wider** read: all ~12.8k questions, not
> just the caller's own session. Closing C2 needs a coordinated application
> change. Say "the session-scoped vector and the hash oracle are closed".

### `20260814000021` — `session_mode` — ✅ **APPLIED 2026-08-11; column existence confirmed**

> **Confirmed by the error class changing, not by a direct read.** The anon probe
> `select=session_mode` returned `42703 column does not exist` before the apply
> and **`42501 permission denied`** after. A *schema* error becoming a *privilege*
> error is only possible if the column now exists — Postgres cannot deny privilege
> on something absent.
>
> That establishes the column. **SM-1's CHECK constraint, and SM-2 onward, were
> not verified.**

```sql
-- SM-1 (blocking): column + CHECK exist.
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='quiz_session_shuffles'
           AND column_name='session_mode' AND is_nullable='YES'),
       (SELECT count(*) FROM pg_constraint
         WHERE conname='quiz_session_shuffles_session_mode_check'
           AND conrelid='public.quiz_session_shuffles'::regclass);   -- expect: 1 | 1

-- SM-2 (blocking): readable by the caller-role resume path, not by anon,
--       and the answer key is still denied (0020 not undone).
SELECT has_column_privilege('authenticated','public.quiz_session_shuffles','session_mode','SELECT'),
       has_column_privilege('service_role', 'public.quiz_session_shuffles','session_mode','SELECT'),
       has_column_privilege('anon',         'public.quiz_session_shuffles','session_mode','SELECT'),
       has_column_privilege('authenticated','public.quiz_session_shuffles','correct_answer_index_snapshot','SELECT');
                                            -- expect: t | t | f | f

-- SM-3 (blocking): the closed vocabulary really is closed.
--       Must raise 23514. Always ROLLBACK.
BEGIN;
UPDATE public.quiz_session_shuffles SET session_mode = 'not_a_mode'
 WHERE session_id = (SELECT session_id FROM public.quiz_session_shuffles LIMIT 1);
ROLLBACK;
```

`session_mode` is **NULL on every pre-existing row by construction** — the column
is nullable so historical rows are not retro-labelled with a guess
(`…0021:90-95`). The resume path treats NULL as **not resumable**
(`mode_unknown`), fail-closed, rather than assuming `cognitive` (`…0021:54-61`).
Do not backfill it.

### `20260814000022` — written-answer scoring (P0) — ✅ **APPLIED 2026-08-11; ⚠️ NOT VERIFIED**

> **Applied (exit 0), but nothing about it was checked** — not before (PF-7 never
> ran) and not after (WA-1/WA-2 never ran).
>
> **WA-1 is now the urgent one, and it is really PF-7a asked after the fact.**
> `…0022` is a `CREATE OR REPLACE` on an exact 11-arg signature. If the deployed
> function had a different argument-type list, the migration **created a second
> overload and still committed green**, and every caller now hits an ambiguity
> error — which would mean the P0 it was meant to fix (quizzes with a non-MCQ
> question being unsubmittable) is *still broken*, in a new way. **A green
> `db push` does not rule this out.** Run WA-1 / PF-7a as soon as `psql` is
> available.
>
> **WA-2** — that a mixed quiz **and** a pure-written quiz both actually submit —
> is the behavioural confirmation and is also outstanding. Note the client-side
> half of the exam-mode P3 fix (`computeElapsedSeconds` in
> `packages/lib/src/quiz/session-contract.ts`) rides the same undeployed frontend
> release as `…0023`'s client half, so exam-mode anti-cheat remains inverted until
> that deploys — a deploy-composition fact, not a database one.

```sql
-- WA-1 (blocking): exactly one overload, the 11-arg one, with the written lane
--       and the >= 50%-of-marks rule in the body; anon has no EXECUTE.
SELECT p.oid::regprocedure::text,
       position('v_is_written' IN pg_get_functiondef(p.oid)) > 0,
       position('v_marks_possible * 0.5' IN pg_get_functiondef(p.oid)) > 0,
       has_function_privilege('anon',          p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       has_function_privilege('service_role',  p.oid, 'EXECUTE')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'submit_quiz_results_v2';
   -- expect: exactly 1 row
   --   submit_quiz_results_v2(uuid,uuid,text,text,text,integer,jsonb,integer,uuid,integer,integer)
   --   | t | t | f | t | t
```

**WA-2 — the P0 acceptance, and the only one that matters.** Take a real quiz
containing at least one non-MCQ (short/medium/long-answer or NCERT-exercise)
question, in the browser, end to end, and submit it.

**Expected**: the submission succeeds; a `quiz_sessions` row is written; XP is
awarded; `quiz_responses` for the written question carries
`student_answer_text`, `marks_awarded`, `rubric_feedback` and `marks` populated
(all four columns pre-existed and were never written by v2 before —
`…0022:79-84`). The written question counts as correct iff
`marks_awarded >= marks_possible * 0.5` — the same rule the student was already
shown per question during the quiz, so the P1 numerator now equals the number of
"correct" verdicts they saw. P1's formula itself is untouched.

Then repeat with a **pure written** quiz (zero MCQs). That path only works if the
client half shipped (§1) — if it still fails, the deploy is incomplete, not the
migration.

> **Documented trust boundary, carried forward deliberately (`…0022:66-77`):**
> `marks_awarded` / `marks_possible` are **client-supplied**, so a hand-crafted
> PostgREST call can claim full marks on a written answer. This is not new
> exposure — it is the pre-existing trust boundary of the whole written-answer
> flow, whose grading happens in the `ncert-question-engine` Edge Function and is
> never persisted server-side keyed to the session. Closing it needs that Edge
> Function to persist its evaluation against `(session_id, question_id)` and this
> RPC to read it back — a tracked follow-up, out of scope for a P0
> restore-service fix. XP remains daily-capped in the meantime. **Do not report
> written-answer scoring as tamper-proof.**

### `20260814000023` — keyless serving + server-side P6 🔒 — 🔴 **NOT APPLIED; NONE OF THIS HAS RUN**

> **🔴 `…0023` was held back from the 2026-08-11 apply — see PF-9.** Every check in
> this subsection (**K-1 … K-5**) is therefore **UNEXECUTED**, and every "expect"
> below is still derived from the migration source, never observed.
>
> **Do not run these against production today.** They will all fail, correctly:
> `question_bank_p6_valid` and `check_formative_answer` do not exist there, and
> the three serving RPCs still emit `correct_answer_index`. A failure here right
> now is the expected state, not a defect.
>
> **K-5 is the one that matters most when the time comes.** It is the behavioural
> check — MCQ quiz renders *and* submits — and it is what catches the empty-quiz
> catastrophe PF-9 describes if the client half has not actually deployed. **Run
> K-5 in staging before prod, without exception.**

```sql
-- K-1 (blocking): the new P6 predicate exists, pure, and callable by both roles.
SELECT p.provolatile,          -- 'i' = IMMUTABLE
       p.prosecdef,            -- must be FALSE: it reads no table, grants no read
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       has_function_privilege('service_role',  p.oid, 'EXECUTE')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname = 'question_bank_p6_valid';
                                            -- expect: 1 row  i | f | t | t

-- K-2 (blocking): NO serving RPC emits a 'correct_answer_index' JSON member.
-- The QUOTED form is what a jsonb_build_object key looks like in prosrc; the
-- bare identifier legitimately survives as an ARGUMENT to question_bank_p6_valid,
-- which is why the probe is on the quoted literal (…0023:1152-1157). This probe
-- is a SUPERSET of the migration’s own post-condition 7a, which checks only
-- the three serving RPCs; start_quiz_session is asserted separately there
-- (…0023:1184-1185) and is folded in here.
SELECT p.oid::regprocedure::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('select_quiz_questions_rag','select_quiz_questions_v2',
                     'get_quiz_questions','start_quiz_session')
   AND position('''correct_answer_index''' IN p.prosrc) > 0
 ORDER BY 1;                                                 -- expect: 0 rows

-- K-3 (blocking): every serving RPC actually calls the P6 predicate, and both
-- get_quiz_questions overloads survived.
SELECT p.oid::regprocedure::text,
       position('question_bank_p6_valid' IN p.prosrc) > 0
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('select_quiz_questions_rag','select_quiz_questions_v2',
                     'get_quiz_questions','start_quiz_session')
 ORDER BY 1;
   -- expect: exactly 5 rows (rag 8-arg, v2 7-arg, get_quiz_questions 4-arg AND
   --         5-arg, start_quiz_session 2-arg — no extras), all column 2 = t

-- K-4 (blocking): P1 substrate intact — start_quiz_session still SNAPSHOTS the
-- key, and check_formative_answer is closed to anon.
SELECT (SELECT position('correct_answer_index_snapshot' IN p.prosrc) > 0
          FROM pg_proc p
         WHERE p.pronamespace='public'::regnamespace
           AND p.proname='start_quiz_session'),
       has_function_privilege('anon',
         'public.check_formative_answer(uuid,integer)', 'EXECUTE'),
       has_function_privilege('authenticated',
         'public.check_formative_answer(uuid,integer)', 'EXECUTE');
                                            -- expect: t | f | t
```

**K-4 column 1 is the one that matters most.** If `start_quiz_session` stopped
snapshotting `correct_answer_index_snapshot`, `submit_quiz_results_v2` would have
nothing to grade against and **P1 would be silently broken for every quiz**. The
migration asserts this in-transaction (`…0023:1177-1185`); K-4 re-asserts it
after the fact.

**K-5 — behavioural acceptance (staging first, mandatory).** There is no SQL
probe for the client coupling. In a browser:

1. Take a normal MCQ quiz end to end. **Expected**: questions render and the
   quiz submits. If the quiz is **empty or every question is rejected**, the
   client half of PF-9 did not ship — roll back (§5.10) or ship the client fix.
2. Open devtools → Network. **Expected**: no serving response body contains
   `correct_answer_index`.
3. `GET /rest/v1/question_bank?select=id,correct_answer_index&limit=1` with a
   student JWT. **Expected: still HTTP 200** — see the residual note below.
4. Use the `/learn` chapter Quick Check. **Expected**: the verdict still appears,
   now served by `check_formative_answer` rather than a key in the page payload.
5. Re-run WA-2: a quiz containing a non-MCQ question still submits. `…0023`
   replaces `start_quiz_session`, which `…0022`'s written lane depends on for its
   identity-shuffle / empty-snapshot marker; the new P6 gate now sits in front of
   that write. **This interaction is not determinable from source alone —
   exercise it.**

> **RESIDUAL after `…0023` — state this precisely.** `…0023` does **not** revoke
> `question_bank.correct_answer_index` from `authenticated`; policy
> `question_bank_authenticated_read` is untouched, so the direct PostgREST read
> (K-5 step 3) still returns the key. What `…0023` does is remove the **last
> legitimate reason** the client needed it, which is the precondition that makes
> the column ACL shippable — the migration says so itself (`…0023:17-42`: the ACL
> "is drafted but CANNOT SHIP on its own"). The honest report is: *"the serving
> payloads are keyless and the browser no longer needs the key; the
> `question_bank` column ACL that closes finding C2 is now unblocked and still
> pending."* Do **not** report C2 as closed.
>
> Second residual, from the migration's own text (`…0023:1046-1055`):
> `check_formative_answer` reveals one question's verdict per authenticated,
> rate-limited, individually attributable call — a much smaller exposure than
> shipping every key in the page payload, but not zero, and it has **no
> replay-lock** (unlike `check_quiz_answer`). Deferred to architect.

### `20260814000024` — `subjects_allowed` reconciliation 💰 — 🔴 **NOT APPLIED; NONE OF THIS HAS RUN**

> **`…0024` landed on disk on 2026-08-12, after the apply, and is PENDING for a
> coupling reason** — it sorts above `…0023` and `db push` cannot apply a subset
> (§1). Every check here (**SA-1 … SA-3**) is therefore **UNEXECUTED** and every
> "expect" is derived from the migration source, never observed.
>
> **Do not run SA-1/SA-2 against production today.** They will fail, correctly:
> `subjects_allowed` still reads `free = 2 | starter = 4 | pro = -1 |
> unlimited = -1` there and no reconciliation audit row exists. A failure right
> now is the expected state, not a defect.

```sql
-- SA-1 (blocking): every plan reads -1, the table's own unlimited sentinel.
-- IS DISTINCT FROM, not <>, so a NULL-valued row is offending too — NULL is
-- ambiguous with "not configured" and the column DEFAULT is 1, i.e. a cap of ONE.
SELECT plan_code, subjects_allowed
  FROM public.subscription_plans
 WHERE subjects_allowed IS DISTINCT FROM -1
 ORDER BY 1;                                                 -- expect: 0 rows

-- SA-2 (blocking): exactly one reconciliation audit row, carrying the rollback
-- payload. Guarded by NOT EXISTS on the action code, so "exactly 1" is the
-- derivable post-state (same shape as M2-6, M3-4, M8-3).
SELECT count(*)
  FROM public.admin_audit_log
 WHERE action = 'subscription_plans.subjects_allowed.reconciled'
   AND details ? 'subjects_allowed_before';                  -- expect: 1

-- SA-3 (ADVISORY, value-report): the pricing surface the migration asserts it
-- did not touch. No pass/fail — read it and reconcile (see below).
SELECT plan_code, price_monthly, price_yearly, price_display,
       razorpay_plan_id, razorpay_plan_id_monthly, razorpay_plan_id_quarterly,
       is_active
  FROM public.subscription_plans
 ORDER BY plan_code;
```

**SA-1 completes a coherence triangle, and all three legs must agree.**
`…0018` left the plan row internally contradictory: `max_subjects = NULL`
("unlimited") and five `plan_subject_access` grants, but `subjects_allowed` still
encoding the pre-`…0018` `free = 2` / `starter = 4` cap. Read SA-1 **together
with** the `…0018` checks already in this section:

| Leg | Check | Expectation |
|---|---|---|
| grants | **M3-1** | exactly 5 `plan_subject_access` rows per plan |
| selection cap | **M3-3** | `max_subjects IS NULL` on every plan |
| entitlement counter | **SA-1** | `subjects_allowed = -1` on every plan |

Any one of the three disagreeing means a plan row contradicts itself again.

> **Anti-vacuity: read M3-0 alongside SA-1.** On a database where
> `subscription_plans` has not been seeded there are no rows, so SA-1 passes with
> nothing to check — correct, but not a pass on production. M3-0 (already in this
> lane) is the guard that says at least one `plan_code` exists.

**SA-2 is also the price-invariance proof — this is the important part.** The
migration is a single `BEGIN; … COMMIT;` whose step-4b assertion compares every
live pricing/identity column against a `_plan_price_guard` temp snapshot taken
*before* the `UPDATE`, via `FULL OUTER JOIN` + `IS DISTINCT FROM` (so an added or
deleted plan row is caught too, and NULL-valued columns compare correctly instead
of silently passing). If anything moved, it `RAISE`s — **which rolls back the
audit row SA-2 is looking for.** So a committed audit row *is* the post-hoc
evidence that no price, Razorpay id, `plan_code` or `is_active` changed during
the apply. It is the strongest such statement obtainable after the fact: the
snapshot table is `ON COMMIT DROP`, so nothing else survives to compare against.

**Why SA-3 is advisory and carries no expected values.** Neither this runbook nor
the gate script hard-codes a price literal, for the same reason the migration
refuses to (`…0024:118-127`): a hard-coded price turns the check into a landmine
that fails on the next legitimate, CEO-approved price change. SA-3 prints the
live surface so a human can compare it against the customer-facing copy — and
that copy is a **known live discrepancy** since `…0018` shipped ahead of it
(PF-8). **A mismatch SA-3 surfaces is a PF-8 finding, not a `…0024` failure.**

> **What `…0024` does NOT do.** It does not change any entitlement, any price, or
> anything a customer can buy or see. The live subject-count enforcement path is
> `max_subjects` read by `set_student_subjects` (`IF v_max IS NOT NULL AND
> v_count > v_max`), surfaced as the 422 `max_subjects_exceeded` — untouched, and
> still unlimited exactly as `…0018` left it. `subjects_allowed` has **zero
> runtime readers** (grepped repo-wide 2026-08-11: generated
> `database.types.ts`, the baseline column definition, and `…0018`'s comment
> explaining the skip). So there is no behavioural acceptance test for this
> migration — there is no behaviour to test. SA-1..SA-3 are the whole of it.

---

## 5. Rollback

Every migration in this set is non-destructive: no `DROP TABLE`, no `DROP
COLUMN`, no row deleted without an archive. Rollback is therefore always a
*compensating* action, never a restore-from-backup — but the sources differ per
migration and **two of them are lossy**. Read §5.3 and §5.1 before you promise a
clean revert.

### 5.1 M1 — `20260814000007`

**Source of truth**: the single `admin_audit_log` row, action
`subject.catalogue.restricted_to_math_science` (`…0007:30-37`).

```sql
BEGIN;
WITH a AS (
  SELECT details FROM public.admin_audit_log
   WHERE action = 'subject.catalogue.restricted_to_math_science'
   ORDER BY created_at LIMIT 1
)
UPDATE public.subjects s SET is_active = TRUE
  FROM a
 WHERE s.code IN (SELECT jsonb_array_elements_text(a.details->'deactivated'));

WITH a AS (
  SELECT details FROM public.admin_audit_log
   WHERE action = 'subject.catalogue.restricted_to_math_science'
   ORDER BY created_at LIMIT 1
)
UPDATE public.subjects s SET is_active = FALSE
  FROM a
 WHERE s.code IN (SELECT jsonb_array_elements_text(a.details->'reactivated'));
COMMIT;
```

⚠️ **LOSSY / ABSENT-SOURCE CASE.** The audit INSERT is conditional on the
migration having actually changed something (`…0007:106-107`). If M1 ran against
a database already in the target state, **no audit row exists and there is no
rollback source at all**. This is why §3.2 tells you to snapshot
`SELECT code, is_active FROM public.subjects ORDER BY code` before applying. If
you skipped that and the row is absent, you cannot reconstruct the pre-change
`is_active` state from anything in the database.

### 5.2 M2 — `20260814000008`

**Source of truth**: `public.grade_subject_map_archive_20260814` (`…0008:69-72`).

```sql
BEGIN;
-- 1. Restore every deleted row.
INSERT INTO public.grade_subject_map
  (id, grade, subject_code, stream, is_core, min_questions_seeded, created_at, updated_at, board)
SELECT id, grade, subject_code, stream, is_core, min_questions_seeded, created_at, updated_at, board
  FROM public.grade_subject_map_archive_20260814
ON CONFLICT DO NOTHING;

-- 2. Remove the stream-NULL 11/12 rows the migration INSERTed.
--    Discriminator: created_at at/after the migration's audit timestamp, since
--    step 4 was ON CONFLICT DO NOTHING and left any PRE-EXISTING stream-NULL
--    row untouched. Verify the SELECT before converting it to a DELETE.
SELECT g.*
  FROM public.grade_subject_map g
 WHERE g.grade IN ('11','12')
   AND g.stream IS NULL
   AND g.subject_code IN ('math','physics','chemistry','biology')
   AND g.created_at >= (SELECT created_at FROM public.admin_audit_log
                         WHERE action = 'subject.grade_map.restricted_and_destreamed');
ROLLBACK;   -- then re-run as a DELETE once you have eyeballed the rows
```

⚠️ Step 2 is a **heuristic**, not a recorded fact. Nothing distinguishes a row
step 4 inserted from a pre-existing stream-NULL row other than `created_at`.
Inspect before deleting.

### 5.3 M4 — `20260814000009` ⚠️ **LOSSY — read this before promising a revert**

**Sources**: `legacy_subjects_archive` rows with `reason = 'subject_deactivated'`
(the removed enrollment codes) plus the per-student `admin_audit_log` rows with
action `subject.inactive_enrollment.archived` (`archived`, `kept`,
`new_preferred_subject`).

Three things are **not recoverable**:

1. **The original `preferred_subject`.** The audit row records only
   `new_preferred_subject` (`…0009:158-166`, `:245-253`). The prior value is
   recorded nowhere.
2. **The original ordering of `selected_subjects`.** `kept` and `archived`
   together reconstruct the *set*, but not how the two interleaved in the
   original array.
3. **Enrollment row metadata** beyond `(student_id, subject_code)` — the archive
   stores `invalid_subjects TEXT[]`, not the deleted rows.

**Ordering constraint**: re-INSERTing archived enrollments fires
`enforce_subject_enrollment()`, which after **M5** rejects any inactive subject
with `subject_not_active`. So an M4 rollback **must** follow an M1 rollback (§5.1)
or precede M5 — otherwise every re-INSERT raises `23514`.

Given all of the above: if M4 must be reverted, escalate to architect and treat
it as a data-recovery task with a PITR restore as the honest option, not a
scripted compensating migration.

### 5.4 M5 / M6 — `20260814000010` / `20260814000011`

Both are pure `CREATE OR REPLACE FUNCTION`; the previous full body for each is in
the **baseline**:

```bash
grep -n "enforce_subject_enrollment\|get_subject_violations" \
  supabase/migrations/00000000000000_baseline_from_prod.sql
```

Extract the prior body, re-apply it, then **re-assert the hardening the replace
discards** — `ALTER FUNCTION … SET search_path = public, pg_catalog`
(`20260516010000:36`, `:44`) and, for `get_subject_violations`, the
service-role-only EXECUTE posture from `20260516040000`. Rolling M6 back
re-introduces the false all-clear: the RPC will report zero violations while
violations are real.

### 5.5 M3 — `20260814000018` (PRICING)

**Source of truth**: the single audit row, action
`subject.plan_access.restricted_to_math_science`, written **before** any mutation
and carrying the complete pre-change state (`…0018:80-92`).

```sql
BEGIN;
WITH a AS (
  SELECT details FROM public.admin_audit_log
   WHERE action = 'subject.plan_access.restricted_to_math_science'
   ORDER BY created_at LIMIT 1
)
DELETE FROM public.plan_subject_access;                        -- full replace

INSERT INTO public.plan_subject_access (plan_code, subject_code)
SELECT e->>'plan_code', e->>'subject_code'
  FROM public.admin_audit_log l,
       LATERAL jsonb_array_elements(l.details->'plan_subject_access_before') AS e
 WHERE l.action = 'subject.plan_access.restricted_to_math_science'
ON CONFLICT DO NOTHING;

UPDATE public.subscription_plans sp
   SET max_subjects = (m.value)::int
  FROM public.admin_audit_log l,
       LATERAL jsonb_each(l.details->'max_subjects_before') AS m(key, value)
 WHERE l.action = 'subject.plan_access.restricted_to_math_science'
   AND sp.plan_code = m.key
   AND jsonb_typeof(m.value) <> 'null';
COMMIT;
```

**Roll the pricing COPY back in the same deploy** (PF-8's surface list). Copy that
promises unlimited subjects against a database that meters them is the same
misrepresentation in the opposite direction.

### 5.6 M8 — `20260814000019`

**Source of truth**: `public.teacher_subjects_taught_archive_20260814`, and the
exact statement is recorded in that table's own COMMENT (`…0019:224-225`):

```sql
UPDATE public.teachers t
   SET subjects_taught = a.subjects_taught_before
  FROM public.teacher_subjects_taught_archive_20260814 a
 WHERE a.teacher_id = t.id;
```

Lossless: one archive row per teacher, enforced by the unique index
`teacher_subj_archive_20260814_teacher_uniq`.

### 5.7 `20260814000020` — answer-key ACL

The migration's own footer records it (`…0020:266-269`), with the right warning:

```sql
-- REOPENS THE ANSWER-KEY LEAK. Do not run casually.
GRANT ALL ON TABLE public.quiz_session_shuffles TO authenticated;
GRANT ALL ON TABLE public.quiz_session_shuffles TO anon;
```

Every consumer was audited before the ACL landed (`…0020:65-98`): all three quiz
RPCs are `SECURITY DEFINER` (run as owner, caller ACLs irrelevant), every server
read of the key is service-role, and the one caller-role read path
(`packages/lib/src/state/student-state-builder.ts`) selects only re-granted
columns. **There is no known legitimate reason to run this.** If something broke,
the cause is far more likely a missing *additive column grant* (the mechanism
working as designed — see §5.8) than the ACL itself. Diagnose with ACL-3 first.

### 5.8 `20260814000021` — `session_mode`

Also in the file footer (`…0021:190-194`):

```sql
ALTER TABLE public.quiz_session_shuffles
  DROP CONSTRAINT IF EXISTS quiz_session_shuffles_session_mode_check;
ALTER TABLE public.quiz_session_shuffles DROP COLUMN IF EXISTS session_mode;
```

⚠️ This is a `DROP COLUMN` — **user approval required** per the constitution. It
also reintroduces the silent instrument swap on resume (a timed exam resumed as
untimed). Prefer leaving the column and NULLing it.

### 5.9 `20260814000022` — written-answer scoring

Re-apply the immediately prior definition by streaming
`supabase/migrations/20260809000500_submit_quiz_v2_unhinted_bonus.sql` (§3.2),
which `…0022` was copied from verbatim apart from the numbered deltas in its
header (`…0022:105-109`).

⚠️ **Rolling this back re-breaks the P0**: every quiz containing a non-MCQ
question becomes unsubmittable again, and students lose whole attempts. Do not
roll it back to fix a written-answer *scoring* complaint — fix forward.

### 5.10 `20260814000023` — keyless serving + server-side P6

Compensating, and **order-sensitive**. Re-apply the five prior definitions by
streaming their source migrations (§3.2), in this order — `start_quiz_session`
**last**, because it is the one `…0022`'s written lane sits on:

| Function | Restore from |
|---|---|
| `select_quiz_questions_rag` | `20260802100000` |
| `select_quiz_questions_v2` | `20260625000200` |
| `get_quiz_questions` (5-arg) | `20260505155525` |
| `get_quiz_questions` (4-arg) | `00000000000000_baseline_from_prod.sql` (the original overload) |
| `start_quiz_session` | `20260801100900` |

Recorded in the migration's own rollback note (`…0023:146-152`).

⚠️ **Three consequences, all of them bad, listed in the file itself:**

1. It **reopens the bulk answer-key read** — every serving payload ships
   `correct_answer_index` again.
2. It **re-requires the client-side key**. If the companion client change has
   already shipped, the browser P6 gate no longer looks for the key and the
   restored payload is simply ignored — but if you then also revert the client,
   you are back to the leak. **Do not roll this back after the client change has
   shipped** without reverting both together.
3. It **re-opens the latent `COALESCE(correct_answer_index, 0)` hole** in
   `start_quiz_session` (`…0023:854-860`), which silently snapshots index 0 as
   the answer key for a NULL-key MCQ — the SQL twin of the `null < 0` JS bug the
   2026-07-29 forensic audit found. That is a P1 correctness regression, not just
   a security one.

`question_bank_p6_valid()` and `check_formative_answer()` are **additive** — there
is no reason to drop them, and dropping `check_formative_answer` would break the
`/learn` Quick Check if its client half has shipped. Leave both in place.

### 5.11 `20260814000024` — `subjects_allowed` reconciliation

Compensating, single statement, and the rollback source is the migration's own
audit row — the same audit-row-keyed discipline as `…0007` and `…0018`:

```sql
-- 1. Read the pre-change values (a plan_code → value JSONB object).
SELECT details->'subjects_allowed_before'
  FROM public.admin_audit_log
 WHERE action = 'subscription_plans.subjects_allowed.reconciled';

-- 2. Restore each plan from it.
UPDATE public.subscription_plans sp
   SET subjects_allowed = (b.value)::INT
  FROM (SELECT key, value
          FROM public.admin_audit_log l,
               jsonb_each_text(l.details->'subjects_allowed_before')
         WHERE l.action = 'subscription_plans.subjects_allowed.reconciled') b
 WHERE sp.plan_code = b.key;
```

Then optionally restore the column comment (or drop it with
`COMMENT ON COLUMN public.subscription_plans.subjects_allowed IS NULL`).

⚠️ **There is no operational reason to roll this back, and one reason not to.**
The column has zero runtime readers, so reverting changes no behaviour — it only
puts the stale `free = 2` / `starter = 4` cap back into the row. If anything ever
*starts* reading the column, that restored `2` silently reinstates exactly the
free-tier limit `…0018` was written to remove. **If you are rolling back `…0018`
itself, roll this back too** (the values become true again); otherwise leave it.

> **If the audit row is missing, you cannot roll back from it.** The `NOT EXISTS`
> guard means the row is written once; a `…0024` that aborted wrote no row *and*
> made no change, so there is nothing to revert. A row that is absent on a
> database where `subjects_allowed` already reads `-1` everywhere means someone
> changed it out of band — reconcile before touching anything.

---

## 6. Discharging REG-380's `P` status — the 6 skipped live-DB probes

`apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts`
has two lanes:

- **Lane A (static)** — always runs in plain `npm test`. It replays the whole
  migration chain's GRANT/REVOKE statements and asserts the derived ACL, plus a
  drift guard and a mutation-proof block. This lane is green today and proves the
  ACL *in SQL*.
- **Lane B (live DB)** — `describeIntegration = hasSupabaseIntegrationEnv() ?
  describe : describe.skip`. **6 tests, all currently skipped**, because CI sets
  placeholder Supabase credentials (`apps/host/src/__tests__/helpers/integration.ts:23-38`
  rejects any URL/key containing `placeholder`).

The six:

| # | Test | Proves |
|---|---|---|
| 1 | `selecting correct_answer_index_snapshot is refused with 42501` | the deny, on the wire |
| 2 | `selecting integrity_hash is refused with 42501` | the hash oracle is closed |
| 3 | `a wildcard select(*) is also refused` | no escape hatch |
| 4 | `the legitimate resume read still succeeds for the owner` | no false positive |
| 5 | `the service-role client reads the answer key` | scoring/forensics survive |
| 6 | `submit_quiz_results_v2 still grades the session server-side` | P1 intact |

**Running them.** Point the suite at a real Supabase project (staging, or a
throwaway — the fixtures create and delete their own user, student, question and
session in `beforeAll`/`afterAll`):

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<real anon key>"
export SUPABASE_SERVICE_ROLE_KEY="<real service role key>"

npx vitest run apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts
```

None of the three may contain the string `placeholder` or the lane self-skips
silently. **Target a database that has `20260814000020` applied** — that is the
whole point; against an unmigrated DB tests 1-3 fail (correctly: the leak is
open).

> **⚠️ SUPERSEDED — this note is now out of date and is kept only to show the
> sequence.** It read: *"Production is confirmed to be that unmigrated DB as of
> 2026-08-11 — `…0020` is measured not applied (fact 4). Pointing Lane B at prod
> today reproduces the leak and fails tests 1-3 by design."*
>
> **`…0020` was applied to production later the same day.** Production is no longer
> the unmigrated DB. Tests 1-3 would now be expected to **pass** there — but
> **do not point Lane B at production to discharge REG-380**: the fixtures create
> and delete their own user, student, question and quiz session in
> `beforeAll`/`afterAll`, which is not something to run against live customer data.
> Point it at staging or a throwaway project with `…0020` applied.

> ### ✅ REG-380's central claim IS discharged — by measurement, not by Lane B
>
> The claim REG-380 exists to pin is that the session-scoped answer-key read is
> closed. **On 2026-08-11 that was proven on the wire in production**: an anon-key
> probe run identically before and after the apply showed the **control column**
> `question_id` flip from `[]` to `42501`, proving
> `REVOKE ALL … FROM anon` executed, with
> `correct_answer_index_snapshot` flipping the same way. See *Verified production
> state AFTER the apply* and §4 `…0020`. **R1 is CLOSED.**
>
> **This does not by itself flip REG-380 from `P` to full.** The six Lane B tests
> below are still **unrun**, and they cover things the anon probe did not:
>
> - the deny side for **`authenticated`** (the probe used the **anon** key — a
>   different mechanism, since `…0020` re-grants a 10-column allowlist to
>   `authenticated`)
> - the **allow** side — that the legitimate owner resume read still succeeds
>   (tests 3-4). An over-reaching REVOKE also yields `42501` everywhere, and
>   nothing measured so far would distinguish that.
> - that service-role scoring and `submit_quiz_results_v2` still work (5-6)
>
> **So: report R1 as closed — that is now a measurement. Do not yet report REG-380
> as fully discharged.** Run Lane B against a migrated staging project and record
> the run (project ref, date, vitest summary) in the change ticket.

**These six passing IS the discharge condition for REG-380's `P` (partial)
status.** Lane A proves the ACL in SQL; only Lane B proves it on the wire through
PostgREST with a real `authenticated` JWT. Until they have run green against a
migrated database, REG-380 stays `P` and nobody may report the session-scoped
answer-key vector as verified closed. Record the run (project ref, date, vitest
summary line) in the change ticket.

> ⚠️ **Known defect in probe 6, found while writing this runbook — architect /
> testing to resolve, NOT fixed here (ops does not own tests).** Test 6 asserts
> `parsed?.correct_answers` and `parsed?.total_questions`
> (`…acl.test.ts:942-943`). `submit_quiz_results_v2` returns `'correct'` and
> `'total'` — see `…0022`'s `RETURN jsonb_build_object('total', v_total,
> 'correct', v_correct, …)` and the idempotent-replay branch at `…0022:275-276`,
> which uses the same key names. Both assertions will therefore compare
> `undefined` to `1` and **fail** on the first real run. The `score_percent`
> assertion is correct. Expect this test to go red for a contract reason, not a
> security one — fix the assertion, do not weaken the migration.

---

## 7. Quick reference

```bash
# 0. link
supabase link --project-ref "$TARGET_PROJECT_REF" --password "$TARGET_DB_PASSWORD"
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# 1. pre-flight  (PF-1..PF-7, PF-9, PF-10; exits non-zero on any blocker.
#                 PF-8 is human-only — pricing copy — and lives in §2 alone)
node scripts/verify-20260814-migrations.mjs --preflight
psql "$DB_URL" -f docs/subject-restriction-teacher-impact.sql   # record would_be_left_with_zero

# 2. apply
supabase db push --dry-run && supabase db push

# 3. verify   (exit 0 = pass, 1 = fail, 3 = no DB reachable / NOTHING verified)
node scripts/verify-20260814-migrations.mjs

# 4. discharge REG-380 (needs REAL, non-placeholder Supabase creds)
npx vitest run apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts
```

**Sign-off checklist** — state as of the 2026-08-11 production apply

- [x] PF-1 clean, or repair-skip path chosen — **READ DIRECTLY** via
      `supabase migration list --db-url`: `…0007`-`…0011` already applied,
      `…0012`-`…0017` applied on **neither** branch (the collision never bit — the
      renumber was provably preventive), `…0018`-`…0023` not applied. **No
      repair-skip needed.** The ledger is unreadable over PostgREST (`PGRST106`)
      but reads fine over a connection string
- [x] PF-2 resolved — `is_content_ready` measured green on prod 2026-08-11
      (PF-2b, over PostgREST). PF-2a **not** measured; informational only
- [ ] PF-3 zero stranded `(grade, board)` pairs — ⚠️ **UNVERIFIED** (`psql` absent)
- [x] PF-4 `would_be_left_with_zero` recorded — **MEASURED: 8 teachers total, all
      with empty `subjects_taught` ⇒ 0 trimmed, 0 stranded.** Q2/Q3 not run (moot
      at zero)
- [ ] PF-5 all five keep-set codes present — ⚠️ **UNVERIFIED**
- [ ] PF-6 all ten ACL columns present — 🔴 **NEVER VERIFIED; `…0020` applied
      without it.** Run retroactively
- [ ] PF-7 exactly one 11-arg `submit_quiz_results_v2` — 🔴 **NEVER VERIFIED;
      `…0022` applied without it.** Run retroactively — a silent second overload
      would not have shown up in a green `db push`
- [ ] PF-8 pricing copy merged and staged in the same deploy — 🔴 **DID NOT HOLD.
      `…0018` shipped ahead of the copy; `plans.ts`, `PricingPlansV3.tsx` and
      `JsonLd.tsx` are FACTUALLY WRONG IN PRODUCTION NOW.** Open action on
      frontend + backend; CEO sign-off on new wording still required
- [ ] PF-9 `…0023`'s client half in the same deploy — 🔴 **DID NOT HOLD, so
      `…0023` WAS HELD BACK and is still pending.** Client is committed but **not
      deployed**; applying `…0023` first = empty quizzes in production. Serving-
      function signature check also **not** run
- [ ] PF-10 all ten `subscription_plans` guard columns present — ⚪ **NOT RUN**;
      `…0024` did not exist on disk at the 2026-08-11 apply
- [x] `ST-4` / `ST-5` clean as of **2026-08-12** — but note they were **NOT clean
      in between**: `…0024` landed after the apply, `ST-4` warned, `ST-5` failed,
      and the `--offline` lane exited **1** until `…0024` was read and folded into
      `MIGRATION_SET` + `PENDING_VERSIONS`. That is the tripwire working. **Re-run
      `--offline` immediately before any push** — a `20260814*` file outside the
      gate at *any* version, including the `…0012`-`…0017` hole the renumber left,
      is unverified, not verified-clean. A file in the hole is another branch's,
      and is the collision this whole renumber existed to prevent
- [ ] `subjects` snapshot taken (M1 rollback insurance, §3.2) — ⚠️ **not recorded
      as taken**; catalogue rollback source does not exist
- [ ] Staging rehearsal done — 🔴 **NOT DONE.** Applied straight to production
- [ ] `verify-20260814-migrations.mjs` exit 0 on prod — ⚠️ **not run against the
      DB** (`--offline` structural lane only; the DB lane needs `psql`)
- [ ] M8-4 reconciles against PF-4 — expect `left_with_zero = 0`; **not queried**
- [ ] M3-5 checked as a real grade-11 free-plan student — **not done**
- [ ] ACL-5 returns 42501 with a real student JWT — **not done** (the 2026-08-11
      probe used the **anon** key, which does not exercise the `authenticated`
      deny path)
- [ ] WA-2 checked: mixed quiz **and** pure-written quiz both submit — **not done**
- [ ] K-5 checked in staging: MCQ quiz renders **and** submits (this is what a
      missing `…0023` client half breaks), payloads keyless, Quick Check works —
      **not done; blocked until `…0023` is applied to staging**
- [ ] SA-1 every plan reads `subjects_allowed = -1` (read with M3-1 + M3-3 as the
      coherence triangle, and with M3-0 as the anti-vacuity guard) — **not done;
      `…0024` is pending.** It will fail on prod today, correctly
- [ ] SA-2 exactly one `subscription_plans.subjects_allowed.reconciled` audit row
      carrying `subjects_allowed_before` — **not done.** This row is both the
      rollback source (§5.11) **and** the post-hoc proof that `…0024`'s
      in-transaction price/Razorpay/`plan_code`/`is_active` tamper guard passed
- [ ] SA-3 live pricing surface read and reconciled against the customer-facing
      copy — **not done.** Advisory: a mismatch here is a **PF-8** finding, not a
      `…0024` failure
- [x] **R1 (session-scoped answer-key leak) CLOSED** — anon probe re-run
      identically before/after; the `question_id` control flipped `[]` → `42501`,
      proving `REVOKE ALL … FROM anon` executed
- [ ] REG-380 Lane B run recorded → `P` discharged — **still unrun.** R1's central
      claim is discharged by measurement, but the 6 wire-level tests (incl. the
      `authenticated` deny and the allow-side false-positive check) have not run
- [ ] Report wording checked: "the session-scoped answer-key vector is closed and
      the serving payloads are keyless; finding **C2** (the `question_bank`
      column ACL) is **unblocked but still open**" — never "the answer key is
      closed"
