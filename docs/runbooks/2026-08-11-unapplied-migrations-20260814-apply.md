# Runbook: apply the unapplied `20260814*` migrations

> **Purpose**: apply migrations `20260814000007` … `20260814000017` — the Phase 3
> subject restriction (M1, M2, M4, M5, M6, M3, M8), the `quiz_session_shuffles`
> answer-key column ACL, the `session_mode` column, the P0 written-answer
> scoring fix, and the keyless-serving / server-side-P6 change — and *prove* each
> one landed.
>
> **Owner**: ops (this runbook + the gate script). **Executor**: architect or ops
> with prod DB access. **Approver**: user (CEO) — `20260814000012` is a pricing
> change.
>
> ---
>
> ## STATUS OF EVERY MIGRATION IN THIS RUNBOOK: **UNEXECUTED**
>
> Nothing below has been applied, run, or verified against any database.
> The environment this runbook was authored in has **no database, no Docker and
> no linked Supabase project**. Every migration here is **syntax-validated only**
> — meaning it has been read end to end and its stated post-conditions derived
> from its own source. No `supabase db push`, no `psql`, no `db query` has been
> executed. Every "expected result" below is *derived from the migration source*,
> never observed. Treat the first real run as the first run.
>
> The companion gate script `scripts/verify-20260814-migrations.mjs` has likewise
> only been executed in its no-database degradation path.

---

## 0. What is in the set

| # | File | What it does | Blast radius |
|---|---|---|---|
| M1 | `20260814000007_subject_catalogue_restrict_math_science.sql` | `subjects.is_active = FALSE` for everything outside the keep-set `math, science, physics, chemistry, biology`; self-heals the keep-set back on | catalogue reads |
| M2 | `20260814000008_grade_subject_map_restrict_and_destream.sql` | archives + deletes out-of-keep-set grade-map rows; replaces grade 11-12 stream-scoped rows with stream-NULL rows. **Contains an assertion that ABORTS the whole transaction if any `(grade, board)` pair is left with zero rows** | curriculum map |
| M4 | `20260814000009_repair_student_subjects_after_restriction.sql` | ships + runs `archive_inactive_subject_enrollments()`; repairs `student_subject_enrollment`, `students.selected_subjects`, `students.preferred_subject` | every student row |
| M5 | `20260814000010_enforce_subject_enrollment_active_check.sql` | `enforce_subject_enrollment()` gains an `is_active` check — closes the write hole that makes M1 advisory | writes to `student_subject_enrollment` |
| M6 | `20260814000011_get_subject_violations_active_aware.sql` | `get_subject_violations()` joins `subjects … AND sub.is_active`. **Without it the verification signal is a false all-clear** | admin forensic read model |
| M3 | `20260814000012_plan_subject_access_restrict.sql` | **PRICING SURFACE CHANGE** — grants all 5 keep-set codes to *every* plan, sets `subscription_plans.max_subjects = NULL` on every plan | every paying and non-paying customer |
| M8 | `20260814000013_trim_teacher_subjects_taught.sql` | trims `teachers.subjects_taught` to the active intersection; audit row reports how many teachers are left with zero | every teacher row |
| — | `20260814000014_quiz_session_shuffles_answer_key_column_acl.sql` | **SECURITY** — denies `correct_answer_index_snapshot` + `integrity_hash` to `anon`/`authenticated` | P1/P3 answer-key leak |
| — | `20260814000015_quiz_session_shuffles_session_mode.sql` | persists `session_mode`; exam sessions become non-resumable | quiz resume path |
| — | `20260814000016_submit_quiz_v2_written_answer_scoring.sql` | **P0** — `submit_quiz_results_v2` scores written answers instead of aborting | *every* quiz containing a non-MCQ question |
| K | `20260814000017_keyless_question_serving_and_server_side_p6.sql` | **SECURITY + P6** — removes `correct_answer_index` from three serving RPC payloads, adds the `question_bank_p6_valid()` predicate as a server-side filter, makes `start_quiz_session` the P6 checkpoint, adds `check_formative_answer()` | every question-serving path |

> **`…0017` was added by a concurrent agent *while this runbook was being
> written*.** It was caught by the gate script's `ST-4` check ("no newer
> `20260814*` migration has appeared outside this gate"), read in full, and
> folded into Sections 1, 2, 4, 5 and 6 below. **`…0018` and later do not exist
> on disk** as of the last check. Re-run `node
> scripts/verify-20260814-migrations.mjs --offline` immediately before applying:
> if `ST-4` warns, another migration has landed and this runbook is incomplete
> until you read it and extend `MIGRATION_SET` in the script.

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
20260814000012  M3  plan access       ← PRICING. Requires M1 (FK on subjects.code)
20260814000013  M8  teacher trim      ← Requires M1; refuses to run otherwise
20260814000014      answer-key ACL
20260814000015      session_mode      ← Requires 0014 (its allowlist is what makes this grant necessary)
20260814000016      written scoring   ← P0. Independent of 0007-0013.
20260814000017  K   keyless serving   ← MUST follow 0016: both replace functions on the
                                         same P1 substrate, and 0017 replaces
                                         start_quiz_session, which 0016's written lane
                                         depends on.
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

**`…0016` is a P0 and should not wait.** Today, any quiz containing at least one
non-MCQ question **cannot be submitted at all** — the RPC raises
`session_not_started` before any anti-cheat check, no `quiz_sessions` row is
written, the student sees a network-error toast and loses the whole attempt, and
retrying re-raises forever (`…0016:5-19`). A pure written quiz is worse: zero MCQ
ids means `start_quiz_session` was never called and `p_session_id` arrives NULL.
`…0016` touches **nothing** that `…0007`-`…0013` touch. If the pricing decision
(M3) or the teacher-impact number (M8) needs another day, **ship `…0014`,
`…0015` and `…0016` on their own first** — they are a disjoint, independently
appliable slice.

> `supabase db push` cannot apply a subset. To ship the quiz slice alone, apply
> the three bodies by STDIN (§3.2) and record the versions afterwards, or hold
> `…0007`-`…0013` on a branch. Decide which before you start.

**`…0017` after `…0016`, and it has a client half of its own — a harder one.**
`…0017` replaces `start_quiz_session` with a body that **skips** any question
failing `question_bank_p6_valid()`: no snapshot row is written and the question
is absent from the returned array (`…0017:841-861`). The client must **drop any
served question the server did not snapshot** — the companion change in
`apps/host/src/app/(student)/quiz/page.tsx`. It also removes
`correct_answer_index` from the payloads of `select_quiz_questions_rag`,
`select_quiz_questions_v2` and both `get_quiz_questions` overloads, which means
the browser can no longer run the `correct_answer_index 0-3` half of P6
(`packages/lib/src/quiz/question-validation.ts`). If the migration ships without
the client change, that client gate sees `undefined` for every row and **rejects
100% of MCQs** — the migration's own header says so (`…0017:32-36`). **Ship the
two together or ship neither.** Confirm the client half is in the same deploy
before applying (§2 PF-9).

**`…0016` has a client half.** `apps/host/src/app/(student)/quiz/page.tsx:915`
calls `collectSessionQuestionIds()`
(`packages/lib/src/quiz/session-contract.ts`) so that *every* served question —
not just the MCQs — gets a `quiz_session_shuffles` snapshot row. The migration
scores written answers; the client change is what makes a **pure written** quiz
reach the RPC with a real `p_session_id` at all, and what makes P3 anti-cheat
Check 3's served-row `COUNT(*)` correct for mixed quizzes (`…0016:20-28`). **Ship
both in the same release.** The migration alone leaves the pure-written case
still broken.

---

## 2. Pre-flight — run every one of these BEFORE `db push`

Run against the target DB with the service role / `postgres` connection. All
read-only.

```bash
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
node scripts/verify-20260814-migrations.mjs --preflight      # runs PF-1..PF-8 below
```

Or by hand:

### PF-1 — are any of these already recorded applied?

```sql
SELECT version
  FROM supabase_migrations.schema_migrations
 WHERE version BETWEEN '20260814000007' AND '20260814000016'
 ORDER BY version;
```

**Expected**: **zero rows**. If a version *is* listed, `db push` will silently
skip it. Check whether its objects actually exist (§4) — if they do not, you are
in the **repair-skip** case and must stream the body via STDIN (§3.2). This
failure mode has happened on this prod before; see
`docs/runbooks/school-admin-portal-db-apply.md` §A.2.

### PF-2 — 🔴 the `is_content_ready` question (M3's real dependency)

`subjects.is_content_ready` is **COMPUTED, never seeded**. It is written only by
`public.compute_subject_content_readiness_v2()`
(`20260622000000:39`, `:99`), which sets it to
`(ready_chapters > 0 AND questions > 0)` where `ready_chapters` counts
`cbse_syllabus` rows with `rag_status IN ('partial','ready') AND is_in_scope`
and `questions` counts active `question_bank` rows for that subject code. A
subject nobody has ingested content for reads `false` forever, and *nothing in
this migration set recomputes it*.

M3's own header (`…0012:70-72`) states that `get_available_subjects()` requires
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

**Expected / decision table**:

| PF-2a `gates_on_content_ready` | PF-2b physics/chemistry/biology | Action |
|---|---|---|
| both `false` | anything | The gate is not live. M3's grants are visible on `is_active` alone. Proceed. |
| either `true` | all `true` | Gated, but ready. Proceed. |
| either `true` | any `false` | **STOP.** M3 will grant physics/chemistry/biology and grade 11-12 free/starter students will still see only `math`. Run `SELECT * FROM public.compute_subject_content_readiness_v2();` (service role), re-run PF-2b, and only proceed once all five read `true`. If a subject *cannot* be made ready (no `cbse_syllabus`/`question_bank` content), that is a **content** blocker, not a migration blocker — escalate; do not ship M3 into it. |

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

### PF-4 — the teacher blast radius (M8's precondition)

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
`after_codes` (`…0013:307-310`), and its step-1 guard proves the active catalogue
*is* the keep-set before it trims (`…0013:124-152`). So a disagreement in §4 (M8-4)
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
`plan_subject_access_subject_code_fkey → subjects(code)` (`…0012:100-104`), and
M8 step 1 aborts with *"missing from active"* (`…0013:135-149`). Both are correct
failures. Insert the missing `subjects` row; do not shrink the keep-set.

### PF-6 — every column `…0014` grants must already exist

`…0014` grants a **literal** 10-column allowlist. If any column is absent on the
target DB the `GRANT` errors and the whole transaction rolls back — deliberate
loud failure on a security ACL (`…0014:141-147`).

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

### PF-7 — `…0016` prerequisites

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

`…0016` is a plain `CREATE OR REPLACE` on that exact signature (`…0016:99-103`).
If the deployed function has a **different argument-type list**, `CREATE OR
REPLACE` creates a *second overload* rather than replacing, and every caller then
hits an ambiguity error. If the first query returns zero rows or more than one,
stop and reconcile before applying. `20260801100800` matters separately: it is
what makes `start_quiz_session` write an identity-shuffle / empty-snapshot row
for a non-MCQ, which is the exact server-side marker `…0016` keys the written
lane off (`…0016:20-28`).

### PF-8 — pricing reconciliation is staged in the same release (M3)

`…0012` is a customer-facing pricing change. **Applying it makes existing pricing
copy false the moment it commits.** The migration updates *no* copy
(`…0012:16-21`). These are the surfaces, all verified present on disk at
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

### PF-9 — 🔴 `…0017`'s client half is in the same deploy

`…0017` is the one migration in this set that **breaks the product if deployed
alone**. Two coupled client changes must ship with it:

1. **The P6 gate must stop requiring `correct_answer_index`.** The migration
   removes that key from three serving payloads; the browser gate at
   `packages/lib/src/quiz/question-validation.ts` currently checks it and would
   see `undefined` for every row → **100% of MCQs rejected** (`…0017:32-36`).
2. **The quiz page must drop any served question the server did not snapshot.**
   `start_quiz_session` now silently skips P6-failing questions
   (`…0017:841-861`).

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

Also verify the four prior definitions `…0017` rebuilds from are actually the
deployed ones, since it is a full-body `CREATE OR REPLACE` of each:

```sql
SELECT p.oid::regprocedure::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('select_quiz_questions_rag','select_quiz_questions_v2',
                     'get_quiz_questions','start_quiz_session')
 ORDER BY 1;
```

**Expected** (`…0017:113-123`): `select_quiz_questions_rag` 8 args,
`select_quiz_questions_v2` 7 args, `get_quiz_questions` **two** overloads (4-arg
and 5-arg), `start_quiz_session` 2 args — **five rows** (four distinct names, one of them doubled). `…0017` reuses each exact
signature so no new overload can be created; a signature that does not match
means the deployed body is not the one it was written against, and `CREATE OR
REPLACE` would add an overload instead of replacing. This repo has been burned by
exactly that twice (`20260702170000`, `20260729130000`). Stop and reconcile.

---

## 3. Apply

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
npx -y supabase db query --linked < supabase/migrations/20260814000016_submit_quiz_v2_written_answer_scoring.sql
```

> **Windows: use STDIN (`<`), never the argument form.** The argument form blows
> the ~32 KB command-line limit and the shell mangles `$$` dollar-quoting. Same
> caveat and same reasoning as `docs/runbooks/school-admin-portal-db-apply.md`
> §A.2.

Every migration in this set is individually idempotent and individually wrapped
in `BEGIN; … COMMIT;`, so streaming a body is safe to repeat.

**Two exceptions to "safe to repeat" that you must know about:**

1. **M2 / M3 / M8 audit rows are `NOT EXISTS`-guarded on the action code**
   (`…0008:215-218`, `…0012:178-181`, `…0013:325-328`). Re-running writes no
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

### M3 — `20260814000012` (PRICING)

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

> **Vacuous-pass warning, from the migration's own note (`…0012:237-240`):** if
> both `subscription_plans` and `plan_subject_access` are empty, M3-1 passes with
> nothing to check. On a seeded database `plan_codes` is `free, starter, pro,
> unlimited` (both CHECK constraints restrict it to those four). **M3-1 returning
> zero rows on a database with zero plans is not a pass.** The gate script
> therefore also asserts `plan_codes` is non-empty; do the same by hand.

**M3-5 — the customer-visible acceptance.** Sign in as (or impersonate) a grade
11 or 12 student on the **free** plan and open the subject picker. Expected:
Mathematics plus Physics, Chemistry and Biology, none of them locked. Before M3
that student saw exactly one unlocked subject — `math` — because M2 removes
`science` from 11-12 (`…0012:33-46`). If they still see only `math`, go back to
**PF-2**: this is the `is_content_ready` failure mode.

### M8 — `20260814000013`

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
the Q2/Q3 output from PF-4. Note what M8 does *not* fix (`…0013:24-38`):
`/api/teacher/subjects` already computed the intersection at read time, so the
trim changes no API response and un-blanks no Command Center. It makes the stored
state equal the effective state, so the stranded population becomes **countable**
and a stale array can no longer be round-tripped back by the teacher-profile
subject picker.

### `20260814000014` — answer-key ACL 🔒

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

> `options_version_at_serve` is in ACL-3 deliberately. `…0014`'s **own**
> in-transaction post-condition enumerates only 9 of the 10 columns it grants
> (`…0014:180-184` vs `:149-160`) — `options_version_at_serve` is granted and
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
(`…0014:33-41`).

> **RESIDUAL — do not report "the answer key is closed".** `…0014` closes the
> session-scoped vector only. `question_bank.correct_answer_index` remains
> readable by any authenticated user via policy
> `question_bank_authenticated_read` (finding C2, deferred in
> `20260814000000:21-33`) — a strictly **wider** read: all ~12.8k questions, not
> just the caller's own session. Closing C2 needs a coordinated application
> change. Say "the session-scoped vector and the hash oracle are closed".

### `20260814000015` — `session_mode`

```sql
-- SM-1 (blocking): column + CHECK exist.
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='quiz_session_shuffles'
           AND column_name='session_mode' AND is_nullable='YES'),
       (SELECT count(*) FROM pg_constraint
         WHERE conname='quiz_session_shuffles_session_mode_check'
           AND conrelid='public.quiz_session_shuffles'::regclass);   -- expect: 1 | 1

-- SM-2 (blocking): readable by the caller-role resume path, not by anon,
--       and the answer key is still denied (0014 not undone).
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
(`…0015:90-95`). The resume path treats NULL as **not resumable**
(`mode_unknown`), fail-closed, rather than assuming `cognitive` (`…0015:54-61`).
Do not backfill it.

### `20260814000016` — written-answer scoring (P0)

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
`…0016:79-84`). The written question counts as correct iff
`marks_awarded >= marks_possible * 0.5` — the same rule the student was already
shown per question during the quiz, so the P1 numerator now equals the number of
"correct" verdicts they saw. P1's formula itself is untouched.

Then repeat with a **pure written** quiz (zero MCQs). That path only works if the
client half shipped (§1) — if it still fails, the deploy is incomplete, not the
migration.

> **Documented trust boundary, carried forward deliberately (`…0016:66-77`):**
> `marks_awarded` / `marks_possible` are **client-supplied**, so a hand-crafted
> PostgREST call can claim full marks on a written answer. This is not new
> exposure — it is the pre-existing trust boundary of the whole written-answer
> flow, whose grading happens in the `ncert-question-engine` Edge Function and is
> never persisted server-side keyed to the session. Closing it needs that Edge
> Function to persist its evaluation against `(session_id, question_id)` and this
> RPC to read it back — a tracked follow-up, out of scope for a P0
> restore-service fix. XP remains daily-capped in the meantime. **Do not report
> written-answer scoring as tamper-proof.**

### `20260814000017` — keyless serving + server-side P6 🔒

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
-- which is why the probe is on the quoted literal (…0017:1152-1157). This probe
-- is a SUPERSET of the migration’s own post-condition 7a, which checks only
-- the three serving RPCs; start_quiz_session is asserted separately there
-- (…0017:1184-1185) and is folded in here.
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
migration asserts this in-transaction (`…0017:1177-1185`); K-4 re-asserts it
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
5. Re-run WA-2: a quiz containing a non-MCQ question still submits. `…0017`
   replaces `start_quiz_session`, which `…0016`'s written lane depends on for its
   identity-shuffle / empty-snapshot marker; the new P6 gate now sits in front of
   that write. **This interaction is not determinable from source alone —
   exercise it.**

> **RESIDUAL after `…0017` — state this precisely.** `…0017` does **not** revoke
> `question_bank.correct_answer_index` from `authenticated`; policy
> `question_bank_authenticated_read` is untouched, so the direct PostgREST read
> (K-5 step 3) still returns the key. What `…0017` does is remove the **last
> legitimate reason** the client needed it, which is the precondition that makes
> the column ACL shippable — the migration says so itself (`…0017:17-42`: the ACL
> "is drafted but CANNOT SHIP on its own"). The honest report is: *"the serving
> payloads are keyless and the browser no longer needs the key; the
> `question_bank` column ACL that closes finding C2 is now unblocked and still
> pending."* Do **not** report C2 as closed.
>
> Second residual, from the migration's own text (`…0017:1046-1055`):
> `check_formative_answer` reveals one question's verdict per authenticated,
> rate-limited, individually attributable call — a much smaller exposure than
> shipping every key in the page payload, but not zero, and it has **no
> replay-lock** (unlike `check_quiz_answer`). Deferred to architect.

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

### 5.5 M3 — `20260814000012` (PRICING)

**Source of truth**: the single audit row, action
`subject.plan_access.restricted_to_math_science`, written **before** any mutation
and carrying the complete pre-change state (`…0012:80-92`).

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

### 5.6 M8 — `20260814000013`

**Source of truth**: `public.teacher_subjects_taught_archive_20260814`, and the
exact statement is recorded in that table's own COMMENT (`…0013:224-225`):

```sql
UPDATE public.teachers t
   SET subjects_taught = a.subjects_taught_before
  FROM public.teacher_subjects_taught_archive_20260814 a
 WHERE a.teacher_id = t.id;
```

Lossless: one archive row per teacher, enforced by the unique index
`teacher_subj_archive_20260814_teacher_uniq`.

### 5.7 `20260814000014` — answer-key ACL

The migration's own footer records it (`…0014:266-269`), with the right warning:

```sql
-- REOPENS THE ANSWER-KEY LEAK. Do not run casually.
GRANT ALL ON TABLE public.quiz_session_shuffles TO authenticated;
GRANT ALL ON TABLE public.quiz_session_shuffles TO anon;
```

Every consumer was audited before the ACL landed (`…0014:65-98`): all three quiz
RPCs are `SECURITY DEFINER` (run as owner, caller ACLs irrelevant), every server
read of the key is service-role, and the one caller-role read path
(`packages/lib/src/state/student-state-builder.ts`) selects only re-granted
columns. **There is no known legitimate reason to run this.** If something broke,
the cause is far more likely a missing *additive column grant* (the mechanism
working as designed — see §5.8) than the ACL itself. Diagnose with ACL-3 first.

### 5.8 `20260814000015` — `session_mode`

Also in the file footer (`…0015:190-194`):

```sql
ALTER TABLE public.quiz_session_shuffles
  DROP CONSTRAINT IF EXISTS quiz_session_shuffles_session_mode_check;
ALTER TABLE public.quiz_session_shuffles DROP COLUMN IF EXISTS session_mode;
```

⚠️ This is a `DROP COLUMN` — **user approval required** per the constitution. It
also reintroduces the silent instrument swap on resume (a timed exam resumed as
untimed). Prefer leaving the column and NULLing it.

### 5.9 `20260814000016` — written-answer scoring

Re-apply the immediately prior definition by streaming
`supabase/migrations/20260809000500_submit_quiz_v2_unhinted_bonus.sql` (§3.2),
which `…0016` was copied from verbatim apart from the numbered deltas in its
header (`…0016:105-109`).

⚠️ **Rolling this back re-breaks the P0**: every quiz containing a non-MCQ
question becomes unsubmittable again, and students lose whole attempts. Do not
roll it back to fix a written-answer *scoring* complaint — fix forward.

### 5.10 `20260814000017` — keyless serving + server-side P6

Compensating, and **order-sensitive**. Re-apply the five prior definitions by
streaming their source migrations (§3.2), in this order — `start_quiz_session`
**last**, because it is the one `…0016`'s written lane sits on:

| Function | Restore from |
|---|---|
| `select_quiz_questions_rag` | `20260802100000` |
| `select_quiz_questions_v2` | `20260625000200` |
| `get_quiz_questions` (5-arg) | `20260505155525` |
| `get_quiz_questions` (4-arg) | `00000000000000_baseline_from_prod.sql` (the original overload) |
| `start_quiz_session` | `20260801100900` |

Recorded in the migration's own rollback note (`…0017:146-152`).

⚠️ **Three consequences, all of them bad, listed in the file itself:**

1. It **reopens the bulk answer-key read** — every serving payload ships
   `correct_answer_index` again.
2. It **re-requires the client-side key**. If the companion client change has
   already shipped, the browser P6 gate no longer looks for the key and the
   restored payload is simply ignored — but if you then also revert the client,
   you are back to the leak. **Do not roll this back after the client change has
   shipped** without reverting both together.
3. It **re-opens the latent `COALESCE(correct_answer_index, 0)` hole** in
   `start_quiz_session` (`…0017:854-860`), which silently snapshots index 0 as
   the answer key for a NULL-key MCQ — the SQL twin of the `null < 0` JS bug the
   2026-07-29 forensic audit found. That is a P1 correctness regression, not just
   a security one.

`question_bank_p6_valid()` and `check_formative_answer()` are **additive** — there
is no reason to drop them, and dropping `check_formative_answer` would break the
`/learn` Quick Check if its client half has shipped. Leave both in place.

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
silently. **Target a database that has `20260814000014` applied** — that is the
whole point; against an unmigrated DB tests 1-3 fail (correctly: the leak is
open).

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
> `'total'` — see `…0016`'s `RETURN jsonb_build_object('total', v_total,
> 'correct', v_correct, …)` and the idempotent-replay branch at `…0016:275-276`,
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

# 1. pre-flight  (PF-1..PF-8; exits non-zero on any blocker)
node scripts/verify-20260814-migrations.mjs --preflight
psql "$DB_URL" -f docs/subject-restriction-teacher-impact.sql   # record would_be_left_with_zero

# 2. apply
supabase db push --dry-run && supabase db push

# 3. verify   (exit 0 = pass, 1 = fail, 3 = no DB reachable / NOTHING verified)
node scripts/verify-20260814-migrations.mjs

# 4. discharge REG-380 (needs REAL, non-placeholder Supabase creds)
npx vitest run apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts
```

**Sign-off checklist**

- [ ] PF-1 clean, or repair-skip path chosen
- [ ] PF-2 resolved — `is_content_ready` measured, not assumed
- [ ] PF-3 zero stranded `(grade, board)` pairs, or seeded and re-checked
- [ ] PF-4 `would_be_left_with_zero` recorded, with Q2 + Q3
- [ ] PF-5 all five keep-set codes present in `public.subjects`
- [ ] PF-6 all ten ACL columns present
- [ ] PF-7 exactly one 11-arg `submit_quiz_results_v2`
- [ ] PF-8 pricing copy merged and staged in the same deploy — **CEO signed off**
- [ ] PF-9 `…0017`'s client half in the same deploy; all five serving-function
      signatures match
- [ ] `ST-4` clean — no `20260814*` migration newer than `…0017` has appeared
- [ ] `subjects` snapshot taken (M1 rollback insurance, §3.2)
- [ ] Staging rehearsal done
- [ ] `verify-20260814-migrations.mjs` exit 0 on prod
- [ ] M8-4 reconciles against PF-4
- [ ] M3-5 checked as a real grade-11 free-plan student
- [ ] ACL-5 returns 42501 with a real student JWT
- [ ] WA-2 checked: mixed quiz **and** pure-written quiz both submit
- [ ] K-5 checked in staging: MCQ quiz renders **and** submits (this is what a
      missing `…0017` client half breaks), payloads keyless, Quick Check works
- [ ] REG-380 Lane B run recorded → `P` discharged
- [ ] Report wording checked: "the session-scoped answer-key vector is closed and
      the serving payloads are keyless; finding **C2** (the `question_bank`
      column ACL) is **unblocked but still open**" — never "the answer key is
      closed"
