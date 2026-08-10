## Subject Governance (Phase H — 2026-04-15)

Source: `docs/superpowers/specs/2026-04-15-subject-governance-design.md` §11.3

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| SG-1 | `class_6_free_plan_no_senior_subjects` | Grade 6 free-plan student never sees Physics/Chemistry/Biology/Accountancy in API, hook, picker, or PATCH preferences | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-2 | `api_never_returns_global_subject_list` | `GET /api/student/subjects` returns a strict subset of the canonical 17 for every student profile | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-3 | `grade_11_commerce_excludes_physics` | Grade 11 commerce stream RPC + validator excludes physics/chemistry/biology | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-4 | `grade_11_science_excludes_accountancy` | Grade 11 science stream RPC + validator excludes accountancy/business_studies | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-5 | `plan_downgrade_clamps_selected_subjects` | Downgrading pro → starter surfaces previously-allowed subjects as `is_locked=true` and `validateSubjectWrite` rejects with reason='plan' | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-6 | `admin_delete_flags_without_deleting_enrollments` | Admin DELETE on `plan_subject_access` flags affected students in the violations report; `student_subject_enrollment` rows are preserved until ops repair | `src/__tests__/regression-subject-leak.test.tsx` | E |

## Phase 3 — server-authoritative allowed-subject policy (2026-08-10)

Source: Phase 3 commit `de5838efa` (subject entitlement policy + navigation IA
trim). Catalogued 2026-08-11 after a quality review flagged this area as
under-catalogued.

**Why these entries exist.** A block of tests had landed in
`apps/host/src/__tests__/regression-subject-leak.test.tsx` under a `describe`
self-labelled *"Regression #8"*, and five migrations
(`20260814000007`..`000011`) had shipped, with **no catalog entry for any of
it**. "Regression #8" is a FILE-LOCAL sequence number continuing that file's own
`#1`..`#7` comment headings — it is **not** a catalog id and never was. SG-7..SG-18
below are the real ids. The file-local numbering is left alone; do not renumber it.

**Test counts in this section are per-claim, not per-file, and the file is
moving.** The `Regression #8` block measured 23 tests when SG-7..SG-13 were
written and 26 at the end of the same session — it was under concurrent edit by
another agent. The per-entry counts below were verified against the tests each
entry actually cites, all of which still exist by name. **Known uncatalogued
residue:** the 3 newest tests in that block — the `NULL board resolves
identically to board=CBSE` sub-describe (`board=null` yields the same subjects
as `board="CBSE"`; preserves the fail-closed + mobile contract; still falls back
to generic rows when no CBSE row exists) — arrived after this pass and have **no
SG entry yet**. They are a distinct claim (board-NULL resolution parity), not
covered by SG-7..SG-13; file them rather than assuming SG-7 covers them.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| SG-7 | `api_subjects_never_serves_inactive_any_grade` | `GET /api/student/subjects` returns codes from the active catalogue ONLY — exactly the keep-set, zero retired codes — for **every** grade `"6"`..`"12"` and on **both** fallback triggers, `v1_empty_rows` AND `v1_rpc_error`. The `v1_empty_rows` path is the leak that actually existed: the old `fallbackSubjectsForGradeAndBoard()` read `grade_subject_map` with no join to `subjects.is_active`. The fixture maps EVERY subject at EVERY grade on purpose, so `is_active` is the only gate doing work. P5 pinned inline (`typeof grade === 'string'`). 14 tests | `apps/host/src/__tests__/regression-subject-leak.test.tsx` → `describe('Regression #8: …')` | E |
| SG-8 | `api_subjects_fallback_fails_closed` | The fallback fails CLOSED, never open: every returned row is `isLocked: true` (never `false`) and `readyChapterCount: 0`, because the fallback has no plan context and must grant nothing. When nothing active matches it returns `[]` — never a hardcoded catalogue — in both starvation cases (grade maps only to deactivated subjects; grade has zero `grade_subject_map` rows), and the empty picker is logged to `ops_events` so ops can see it. Supersedes the pre-fix behaviour of hydrating from `SUBJECT_META`/`getSubjectsForGrade` with `isLocked: false`. 2 dedicated tests + the `isLocked`/`readyChapterCount` clauses of SG-7's 14 | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-9 | `subjects_route_no_raw_catalogue_import` | STATIC source guard on `src/app/api/student/subjects/route.ts`: the file matches neither `SUBJECT_META` nor `getSubjectsForGrade` nor `GRADE_SUBJECTS` nor an import from `@alfanumrik/lib/constants`, **and** carries no `eslint-disable` for `alfanumrik/no-raw-subject-imports`. That disable comment was the ONLY thing silencing the governance rule on this file — this is precisely what regressed before, so re-adding it must fail here even if the rule itself would then pass. 2 tests | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-10 | `learn_chapter_page_is_active_filter` | LEAK 2: `src/app/(student)/learn/[subject]/[chapter]/page.tsx` resolves its `.from('subjects')…maybeSingle()` read with an `.eq('is_active', true)` filter, so a deep link to a removed subject cannot resolve to a `subject_id`. Siblings `foxy/page.tsx` and `(student)/exams/page.tsx` already filtered; this one did not. 1 test | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-11 | `fallback_ops_event_no_pii` | P13: the `ops_events` row written on the fallback path carries no PII — the serialized row never matches `/name\|email\|phone/i`, and `context` keys are exactly `['fallback_subject_count', 'reason']` (an allow-list, so a widening edit fails rather than silently shipping a new field). 1 test | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-12 | `student_subjects_mobile_contract_stable` | The mobile response contract is unchanged: each subject object's key set is exactly `code, color, icon, isCore, isLocked, name, nameHi, readyChapterCount, subjectKind`, with `code/name/nameHi/icon/color/subjectKind` string, `isCore/isLocked` boolean, `readyChapterCount` number. `mobile/lib/data/models/subject.dart` casts `code`/`name` with `as String` (throws on null), so a rename or type change here is a breaking mobile release, not a web-only change. 1 test | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-13 | `fallback_stream_gating_and_auth_unweakened` | On the fallback path a grade-11 commerce student never picks up a science-stream `grade_subject_map` row (returns `['math']` only), and the route still returns **401** when unauthenticated — the fallback widened the data path without weakening the auth gate. 2 tests | `apps/host/src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-14 | `gsm_restriction_strands_no_grade_board_pair` | **M2** (`20260814000008`): the grade-map restriction snapshots every `(grade, board)` pair BEFORE mutating, and RAISEs `check_violation` if any snapshotted pair would be left with zero mapped subjects — NULL-safe on board (`IS NOT DISTINCT FROM`). Without it an ICSE/State-board grade whose only mapped subjects were outside the keep-set is silently wiped to zero and every student on that pair sees an empty subject list with no error anywhere. The assertion sits after the DELETE and inside `BEGIN`/`COMMIT`, so a failure rolls steps 1-5 back; the HINT explicitly refuses the "weaken the keep-set to make this pass" escape hatch. Also pins the 11-12 de-streaming and that the stream-NULL INSERT precedes the DELETE (no momentarily-empty pair), and that deleted rows are archived to an RLS-enabled table (P8). 6 tests | `apps/host/src/__tests__/migrations/subject-catalogue-restriction-phase3.test.ts` | **P** — see "Unexecuted migrations" below |
| SG-15 | `enforce_subject_enrollment_active_write_gate` | **M5** (`20260814000010`): `subjects.is_active` gates **reads only** without this migration. `get_available_subjects`/`_v2` both end `WHERE sub.is_active`, but the `enforce_subject_enrollment()` BEFORE INSERT OR UPDATE trigger checked only `grade_subject_map` + `plan_subject_access` and never joined `subjects` — so a direct INSERT of a deactivated subject SUCCEEDED, making M1/M2 a UI filter rather than a policy. This adds the `is_active` EXISTS check raising `subject_not_active`, and pins the error PRECEDENCE (`student_missing_grade` < `subject_not_active` < `subject_not_valid_for_grade` < `subject_not_in_plan`) so a student with no grade still fails exactly as before. Also pins SECURITY INVOKER (a validation trigger must not be DEFINER), the restated `search_path` (`CREATE OR REPLACE` discards SET clauses — omitting it silently reverts `20260516010000`), and that no trigger is recreated. 4 tests | `apps/host/src/__tests__/migrations/subject-catalogue-restriction-phase3.test.ts` | **P** — see "Unexecuted migrations" below |
| SG-16 | `get_subject_violations_is_active_aware` | **M6** (`20260814000011`): without this, the phase's primary verification signal is a **FALSE ALL-CLEAR** — `get_subject_violations()` built `allowed` from `grade_subject_map ⋈ plan_subject_access` and never joined `subjects`, so after an `is_active`-only flip it reports ZERO violations while students are still enrolled in removed subjects: a clean-looking dashboard over a dirty database. Anyone verifying M1 with this RPC before M6 lands gets that false all-clear. Pins the INNER `JOIN subjects … AND sub.is_active` (a LEFT JOIN would re-admit inactive subjects into `allowed` and restore the bug), that the join is in `allowed` and NOT in `enrolled` (direction matters — joining the wrong side hides violations instead of surfacing them), the unchanged signature/return shape, STABLE + SECURITY DEFINER + pinned `search_path`, the re-asserted service_role-only ACL, and that no PII column is selected (P13). 6 tests | `apps/host/src/__tests__/migrations/subject-catalogue-restriction-phase3.test.ts` | **P** — see "Unexecuted migrations" below |
| SG-17 | `subject_catalogue_restricted_by_keep_set` | **M1** (`20260814000007`): the catalogue restriction is driven by `NOT IN (keep-set)` and never by an enumerated removal list — `public.subjects` holds codes absent from `seed.sql` (`informatics_practices`, `psychology`, `fine_arts`, …, inserted out of band on prod), so an enumerated list would silently leave 6+ subjects live. Keep-set (`math, science, physics, chemistry, biology`) declared exactly ONCE, as a `VALUES` CTE, so it cannot drift within the file. Pins the self-heal branch (a prior partial restriction cannot leave e.g. biology dark), idempotency via `is_active IS DISTINCT FROM` on both branches, the single `subject.catalogue.restricted_to_math_science` audit row that is the ONLY rollback source of truth (gated so a no-op re-run writes no second row), and non-destructiveness (no DROP, no DELETE on `subjects`). 6 tests | `apps/host/src/__tests__/migrations/subject-catalogue-restriction-phase3.test.ts` | **P** — see "Unexecuted migrations" below |
| SG-18 | `student_repair_after_restriction` | **M4** (`20260814000009`): ships `archive_inactive_subject_enrollments()` re-keyed from `is_content_ready = FALSE` to `is_active IS DISTINCT FROM TRUE`, reason `subject_deactivated`, and runs it once. Pins that it is a CLONE — the legacy `archive_dead_subject_enrollments()` is not redefined, so its own callers are untouched — that it is service_role-only (a student must not invoke the repair), and the two DELIBERATE non-actions: `students.stream` is never rewritten (a stream-NULL map row matches every student regardless of stream, so rewriting it destroys analytics data for zero resolution benefit) and `teachers.subjects_taught` is never trimmed (gated on a pending CEO decision). 5 tests | `apps/host/src/__tests__/migrations/subject-catalogue-restriction-phase3.test.ts` | **P** — see "Unexecuted migrations" below |

### Unexecuted migrations — why SG-14..SG-18 are `P` and not `E`

**None of the five migrations `20260814000007`..`000011` has ever executed
against a real Postgres.** There is no database in this environment at all. The
tests backing SG-14..SG-18 are **static SQL-text pins**: they read the migration
files off disk and assert the load-bearing clauses are PRESENT in the source.
They do not execute one line of SQL.

So, precisely:

- "the write gate rejects a deactivated subject" (SG-15) is pinned as source
  text, not as observed behaviour;
- "the `(grade, board)` assertion rolls the transaction back" (SG-14) is pinned
  as the presence of a `RAISE` inside `BEGIN`/`COMMIT`, not as an observed abort;
- "the violations RPC stops giving a false all-clear" (SG-16) is pinned as the
  presence of the `is_active` join, not as an observed non-zero report;
- SG-17's idempotency and SG-18's repair passes are pinned as guard clauses, not
  as observed re-run behaviour.

A green run means a refactor cannot SILENTLY delete the clause. It does not mean
the migration works.

**What would upgrade `P` → `E`:** apply the five migrations to a scratch Supabase
project (`supabase db push`), then assert BEHAVIOUR — (a) a direct
`INSERT INTO student_subject_enrollment` of a deactivated `subject_code` raises
`subject_not_active`; (b) `get_subject_violations()` returns a non-zero row count
for a student holding a deactivated subject (and returned zero before M6);
(c) M2 aborts and rolls back on a seeded board whose grade maps only to
out-of-keep-set subjects; (d) each migration re-run is a no-op (zero rows
affected, no second audit row).

**Enforcement caveat — these tests do not run in the default lane.**
`apps/host/vitest.config.ts` excludes `src/__tests__/migrations/**`, so
`npm test` does NOT execute SG-14..SG-18. They run only under
`npm run test:integration` (`RUN_INTEGRATION_TESTS=1 vitest run`) — the same lane
as every other migration structure test in this repo. Verified green there:
**32/32**. Anyone quoting "the Phase 3 migration pins pass" from a plain
`npm test` run has not run them.

### Non-vacuity / mutation evidence (SG-14..SG-18)

Static absence-pins are the easiest kind of test to write vacuously, and these
migrations carry unusually long prose headers that NAME the very things asserted
absent — so every assertion runs against `--`-comment-stripped SQL, a
non-vacuity floor asserts each file still has >200 chars of executable SQL inside
`BEGIN`/`COMMIT`, and the four load-bearing pins were mutation-checked:

| Mutation | Pin flags? |
|---|---|
| M5 `subject_not_active` block deleted (the pre-fix state) | yes |
| M6 `JOIN subjects` → `LEFT JOIN subjects` (restores the false all-clear) | yes |
| M2 stranded-pair `RAISE EXCEPTION` deleted | yes |
| M5 `is_active` check moved AFTER the grade check (precedence regression) | yes |

One assertion also failed for real on first run (the keep-set CTE regex stopped
at the first tuple and saw only `math`) — the harness is live, not inert.

### E2E coverage

Playwright spec `e2e/subject-governance.spec.ts` — three scenarios from §11.5:

- Grade 11 science onboarding: stream capture → subject picker excludes accountancy → dashboard shows only stream-valid subjects.
- Legacy user with invalid enrollment: ReselectBanner visible → reselect → no invalid subjects surface.
- Plan downgrade: post-refresh dashboard has no unlocked physics/chemistry/biology chips.

### Invariants covered by this section

- P5 (grade format — strings; SG-7 pins `typeof grade === 'string'` across all 7 grades)
- P8 (RLS boundary — governance service on server; SG-14 archive table ships RLS in the same migration; SG-16/SG-18 service_role-only ACLs)
- P9 (RBAC enforcement — 422 on write, 200 on read-only allowed intersection; SG-13 pins the 401 is not weakened by the fallback)
- P13 (data privacy — SG-11 `ops_events` fallback payload carries no PII; SG-16 the violations RPC selects no PII column)

