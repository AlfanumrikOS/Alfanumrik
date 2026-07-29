## H2b — Event-Sourced Canonical-Write Migration (Stage 1 dual-write parity) — 2026-06-30

ADR-005 begins moving the canonical `scheduled_actions` write OFF the `/api/learner/next`
route and ONTO an event-sourced projector. Slice H2b ships the **Stage 1 dual-write parity
phase** (merged via PR #1141 + #1144 follow-ups): a new event kind
`learner.next_action_resolved` (`src/lib/state/events/registry.ts`), a new projector
`scheduledActionsWriter` (`src/lib/state/subscribers/scheduled-actions-writer.ts`) that OWNS
the `scheduled_actions` upsert once cutover completes, and a dual-write at the route. The route
(`src/app/api/learner/next/route.ts`) RETAINS its synchronous inline `scheduled_actions` upsert
(the existing E10 write) AND, best-effort, ALSO `publishEvent('learner.next_action_resolved')`
gated behind `ff_event_bus_v1`. This is the PARITY phase: the inline write stays authoritative
while the projector is proven to produce a byte-identical row before Stage 2 cuts over to
projector-only. P8 is UNCHANGED — `scheduled_actions` keeps its existing table/RLS posture;
no new table, no RLS toggle. The projector and the inline write target the SAME row via the
SAME conflict key, so the substrate's data-ownership boundary is untouched during parity.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-215 | `h2b_next_action_resolved_dualwrite_parity` | ADR-005 / P8: the `/api/learner/next` route DUAL-WRITES during Stage 1 — the synchronous inline `scheduled_actions` upsert (retained, E10) PLUS a best-effort `publishEvent('learner.next_action_resolved')` gated by `ff_event_bus_v1`. PARITY is pinned end-to-end: the published event, fed through the REAL `scheduledActionsWriter` projector, projects to a row BYTE-EQUAL to the inline upsert (same conflict key, 1:1 column mapping, `source` hard-coded scheduler). Flag-gating: flag ON → exactly one inline upsert AND one publishEvent; flag OFF → ZERO inline upserts and ZERO publishEvents, response byte-unchanged. Bus-outage isolation: an async `publishEvent` rejection is swallowed (best-effort) — the route still returns 200 with the resolver payload, so the event bus can never degrade the live next-action path. Projector independently pinned: binds to `learner.next_action_resolved`, idempotent on re-delivery (identical event → identical row), `dryRun` no-op, throws on substrate upsert error (retry), safe no-op on malformed payload. P8 substrate (scheduled_actions table/RLS) unchanged — no new table, no RLS toggle. | `src/__tests__/api/learner/next/route.test.ts` + `src/lib/state/subscribers/scheduled-actions-writer.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary / canonical-write substrate) — REG-215 pins that H2b leaves the
  `scheduled_actions` table and its RLS posture untouched: the new projector writes the SAME
  row via the SAME upsert conflict key as the route's inline write (no new table, no RLS
  toggle, no second source of truth). The dual-write is additive parity, not a substrate change.
- ADR-005 (canonical write route → projector) — the byte-equal projection assertion is the
  GATE on the Stage 2 cutover. The published event, run through the REAL `scheduledActionsWriter`,
  must produce a row identical to the inline upsert; any column-mapping, conflict-key, or
  `source` drift between the two writers fails REG-215 and blocks cutover.
- Dual-write resilience (async-dispatch-aware) — the event publish is best-effort and
  flag-gated: an event-bus rejection cannot 500 the live next-action route, and
  `ff_event_bus_v1=OFF` makes the publish a no-op with a byte-unchanged response. The inline
  write remains the sole authority throughout Stage 1.

### Stage 2 sunset condition

REG-215 is the PARITY guard for the dual-write phase ONLY. It may be retired (the inline
E10 write deleted and this entry closed) once, and only once: (1) `ff_event_bus_v1` AND
`ff_projector_runner_v1` are both ramped to 100%, AND (2) production parity between the
inline write and the projector-produced row has been confirmed over the bake window. Until
all three hold, the inline `scheduled_actions` upsert stays authoritative and REG-215 stays
green. Deleting the inline write or closing E10 before that is a blocking regression.

### Catalog total

H2b Stage 1 dual-write parity adds REG-215 (event-sourced canonical-write migration —
`learner.next_action_resolved` event + `scheduledActionsWriter` projector + route dual-write;
byte-equal projection through the real projector, flag-gating ON/OFF, best-effort bus-outage
isolation, idempotent projector; P8 substrate unchanged; gates the ADR-005 Stage 2 cutover).
**Total catalog: 182 entries (target: 35 — TARGET EXCEEDED).**

---

## Alfa OS shell launch — Practice / Revision / Test OS (Master Action Plan 2.3–2.5)

The three Alfa OS "front door" surfaces (Practice Center `/practice`, Revision
Center `/revision`, Exam Briefing hub `/exam-briefing`) are PRESENTATION-ONLY
wrappers over already-shipped engines (the `/quiz` engine + `GET
/api/practice/history`; the spaced-repetition state + `GET
/api/revision/overview` handing off to `/refresh`; and `exam_configs`/
`exam_chapters` + the exam runtime). No scoring / XP / anti-cheat / exam-timing
/ mastery / schema change rides on any of them — P1/P2/P3 boundaries are
untouched. Each surface ships behind its own default-**client**-OFF flag
(`ff_practice_os_v1`, `ff_revision_os_v1`, `ff_test_os_v1`) whose OFF path is
byte-identical to today, wired flag-gated into `packages/ui/src/navigation/
nav-config.ts` and surfaced via a CTA on `/exams`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-306 | `alfa_os_shell_launch_flag_gating_and_seed_shape` | **(a) Flag-OFF client identity:** the synchronous first-paint reader for every Alfa OS flag (`getPracticeOsFlagSync` / `getRevisionOsFlagSync` / `getTestOsFlagSync`, and the sibling `getSubjectsOsFlagSync`) resolves **FALSE** with no cache + no localStorage override — the production first-paint truth — so the nav/CTA additions cannot regress the existing nav on first paint; `FLAG_DEFAULTS` carries every OS flag = `false`; the dev-force localStorage override is a STRICT no-op under `NODE_ENV==='production'` and only returns TRUE when `NODE_ENV!=='production'` AND the key is exactly `'1'`. **(b) Existing nav not regressed:** the student-mobile-navigation + grade-lock nav assertions still hold with the flag-gated additions present. **(c) Shell render contract:** each of PracticeCenter / RevisionCenter / ExamBriefingHub renders its documented surface (rings/buckets/briefing, Quick-Start / Start CTA into the existing engine) without importing any scoring/XP path. **(d) PredictedScoreCard byte-parity guard** (`exam-briefing-helpers`) unchanged. **(e) Seed-shape (REG-125 companion):** the three new `20260722104000/104100/104200_seed_ff_*_os_v1.sql` migrations each carry the canonical explicit column list led by `flag_name` (never `name`/`enabled`), a `to_regclass('public.feature_flags')` fresh-DB guard, `ON CONFLICT (flag_name) DO NOTHING` (never `DO UPDATE`, never `(name)`), no destructive DDL, and are idempotent — verified live by the repo-wide REG-125 static scanner over ROOT migrations. NOTE: matching the OFF precedent of `ff_foxy_os_v1` / `ff_engagement_dashboard_v1`, these three seed `is_enabled=false`/rollout 0 — launch-ready, NOT live: the shells are finished, tested, and nav-wired behind their flags (nav entries carry a `flagName` that `isItemVisibleForFlags()` respects, so an OFF flag simply hides the entry — no 404-route exposure). Go-live is a DELIBERATE, SEPARATE activation the user approves (an operator flip via `admin_flip_feature_flag`, or a follow-up activation migration — documented in each migration header), NOT an autonomous closed loop; REG-125 pins SHAPE, not default state, so this is conformant either way. | `apps/host/src/__tests__/lib/learning-os-flag-off-identity.test.ts` (39), `apps/host/src/__tests__/components/practice/PracticeCenter.test.tsx` (5), `apps/host/src/__tests__/components/revision/RevisionCenter.test.tsx` (5), `apps/host/src/__tests__/components/exam-briefing/ExamBriefingHub.test.tsx` (5), `apps/host/src/__tests__/components/exam-briefing-helpers.test.ts` (22), `apps/host/src/__tests__/student-mobile-navigation.test.tsx` (2) + `nav-grade-lock.test.ts` (6), `apps/host/src/__tests__/regressions/reg-125-feature-flags-insert-shape.test.ts` (11) | E |

### Invariants covered by this section

- P1/P2/P3 (score / XP / anti-cheat) — the Alfa OS shells are presentation
  wrappers over existing engines; REG-306(c) pins that no shell imports a
  scoring/XP path, so no second, drifting formula can be introduced.
- Default-OFF client-first-paint safety — REG-306(a) is the byte-identity
  guarantee: the sync reader is FALSE at first paint regardless of the DB
  seed, so an operator can dark-launch/roll back the nav additions without a
  first-paint flash and the OFF path stays identical to today.
- REG-125 companion (seed shape) — REG-306(e) folds the three new presentation
  flags into the same repo-wide static scanner that turns a `feature_flags`
  seed-shape drift into a PR-CI failure.

### Catalog total

Alfa OS shell launch adds REG-306 (Practice/Revision/Test OS presentation
shells — default-OFF client-first-paint flag identity + existing-nav
non-regression + shell render contract + PredictedScoreCard byte-parity +
REG-125-conformant seed shape for the three new flag seeds).
**Total catalog: 307 entries (see `00-header.md` for the authoritative running count).**

---


## REG-328..REG-329 — Daily-limit display must equal daily-limit enforcement (2026-07-29, school-demo P0-1)

**The defect.** Enforcement (`check_and_record_usage` -> `get_plan_limit`) and
DISPLAY had drifted into two independent authorities:

  * SQL: `get_plan_limit()` read ONLY `student_subscriptions`, never
    `schools` / `school_subscriptions`. A student fully covered by a paid or
    trial SCHOOL plan was still capped at the free tier's 5 Foxy chats/day, and
    that cap was ENFORCED at the moment of use. This is what made the school
    demo fail.
  * SQL: `get_student_usage()` — the read-only usage-widget feed — carried a
    SECOND, independently written copy of the limit logic that never called
    `get_plan_limit()` at all.
  * TypeScript: `checkDailyUsage` computed the badge from the `PLAN_LIMITS`
    constant keyed on the `students.subscription_plan` COLUMN, which is
    school-blind. A school-covered student saw "5 chats left" and was BLOCKED
    CLIENT-SIDE at 5 (the Foxy page opens the limit modal and returns before
    ever reaching the API) even though the server would have allowed unlimited.
  * Flutter: `dashboard_repository` parsed the limit as a plain int with a
    literal default, so an unlimited tier could render as a finite countdown.

The fix collapses all four onto one authority: `get_plan_limit()` now returns
`GREATEST(personal_limit, school_derived_limit)`; `get_student_usage()`
delegates all four of its limits to it; `checkDailyUsage` PREFERS the new
`GET /api/usage/daily` read-through and demotes `PLAN_LIMITS` to a conservative
offline fallback; and Flutter's `UsageLimit` becomes an explicit tri-state
(unknown / unlimited / finite) that handles BOTH unlimited sentinels.

**Two unlimited sentinels exist by design and this is a real trap.** `-1` is
the DB DISPLAY sentinel (`subscription_plans.foxy_chats_per_day`,
`get_student_usage`'s JSON contract); `999999` is the ENFORCEMENT/TS sentinel
(`get_plan_limit`, `UNLIMITED_USAGE_SENTINEL` in
`packages/lib/src/usage-sentinel.ts`). Migration 20260729130100 adds
`usage_limit_for_display()` purely to map 999999 back to -1 so delegating did
not silently turn every unlimited row into a literal "999999". Neither value may
ever reach a rendered string.

Mobile notes this is the exact class REG-90 was created for: a contract change
that compiles on both sides and still produces a wrong number on a real screen.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-328 | `usage_limit_display_equals_enforcement_and_sentinel_never_renders` | **(a) School coverage is visible.** A student whose `subscription_plan` column still says `free` but whose server answer is the school-derived cap gets that cap in `checkDailyUsage` — `limit !== 5`, `allowed === true` at 7 and 12 chats used (the old free cap would have blocked at 5), and a finite school cap (e.g. a `basic` school -> starter quiz cap of 20) is displayed verbatim with the right `remaining`. **(b) Limit and count come from the SAME response**, so badge and gate describe one consistent moment — the local usage read is asserted NOT to run on the server branch. **(c) Pure-B2C is unchanged**, table-driven over 10 (plan, feature) pairs including the legacy aliases and `_monthly`/`_yearly` suffixes, asserted IDENTICALLY on the server branch and the fallback branch, so no B2C student's number moves in either direction. **(d) Conservative fallback contract** — five distinct server failures (non-2xx, network throw, `success:false`, missing `limit`/`count`, non-numeric `limit`/`count`) each degrade to the school-blind local default and NEVER to unlimited; `checkDailyUsage` never throws even on a synchronous transport explosion; and a genuine `limit: 0` is honoured as a real answer rather than treated as a failure. **(e) `/api/usage/daily` route contract** — it relays `get_plan_limit`'s number with no local arithmetic and calls that exact RPC with the caller's own id; returns **503 with NO `data` key** when the RPC errors or returns a non-number (asserted over `null`/`undefined`/string/object/array), and the 503 body is asserted to contain neither `999999` nor a `limit` key so no generous number can leak on a failure path; an unsupported/typo'd/blank feature is 400 **before** auth and before any RPC (its `get_plan_limit` ELSE arm returns the generous `ai_calls_total` cap, so forwarding it would over-promise); 401/403 short-circuit before any DB work; a request-supplied `studentId`/`student_id` is IGNORED in favour of `auth.studentId` (P8); the response body contains exactly `{feature, limit, count, remaining, allowed}` with no student id and no PII (P13); a usage-row READ ERROR still yields 200 with count 0 while the server-side gate remains the real stop; and the route is READ-ONLY — it calls only `get_plan_limit`, never `check_and_record_usage` / `record_ai_usage` / `get_student_usage` (P12). **(f) The unlimited sentinel never renders.** Every unlimited path (server branch and paid-tier fallback branch) yields a limit that `isUnlimitedUsage()` detects; values ABOVE the sentinel are also unlimited (>=, not ==); finite caps 0/1/5/20/200/999998 are NOT mistaken for unlimited; `UNLIMITED_USAGE_SENTINEL === 999999` mirrors the DB mapping; and a static-source canary pins the Foxy header badge to render through `isUnlimitedUsage(chatUsage.limit)` with an Unlimited/असीमित arm, and asserts the literal `999999` appears nowhere in `foxy/page.tsx`. **(g) Flutter tri-state** — `UsageLimit.fromServer` folds BOTH sentinels (`<= 0` and `>= 999999`) to `unlimited`, keeps `isKnown === false` distinct from `unlimited`, and `label()` returns Unlimited/असीमित rather than any number. | `apps/host/src/__tests__/lib/usage-server-authority.test.ts` (39), `apps/host/src/__tests__/api/usage-daily-contract.test.ts` (22), `mobile/test/data/models/daily_usage_limit_test.dart`, `mobile/test/data/repositories/usage_daily_parse_test.dart` | E |
| REG-329 | `get_plan_limit_school_coverage_is_monotone` | **SQL source contract (runs on every PR) + live-DB semantics (does NOT).** Source-contract half, over `20260729130000` and `20260729130100`: the `get_plan_limit` signature, volatility, `SECURITY DEFINER` and `search_path` are preserved and there is no `DROP FUNCTION`, so `check_and_record_usage` / `record_ai_usage` keep resolving; the file is `CREATE OR REPLACE`-only and writes no data; **the personal branch is byte-identical to the baseline body** (same SELECT / join on `plan_code` / `status IN ('active','trial')` / `ORDER BY sort_order DESC` / free fallback literals 5,5 / the `-1 -> 999999` mapping) — the entire "strict no-op for pure B2C" proof rests on that, so drift there is a failure; the return is `GREATEST(v_personal, v_school)` and there is **no `RETURN v_school;` anywhere**, which is exactly how a personally-`unlimited` student under a `basic` school would get downgraded; every school-branch bail-out returns `v_personal`; the school->consumer tier map is asserted arm-by-arm against the TypeScript authority `normalizeSchoolPlanToConsumerCode()` at RUNTIME (not hardcoded), so `trial -> pro`, `basic -> starter`, `standard/premium -> pro`, `enterprise/school_premium -> unlimited` and the fail-closed `-> free` for unknown codes cannot drift from `effective-plan.ts`; the tier ranking mirrors `planTier()`; only `active`/`trial` school subscriptions contribute (P11); the school branch fails SOFT (`EXCEPTION WHEN OTHERS` -> `v_code := NULL`) with `to_regclass` guards on every optional table, so a B2B lookup error can never fail a quota check that used to succeed; the candidate-school set is the UNION of all three link definitions; `_school_active_student_ids` (seat BILLING) is untouched; EXECUTE is re-REVOKEd from PUBLIC/anon/authenticated rather than relying on the pre-existing ACL; no RLS policy, no table DDL and no grade column is touched (P8, P5); and a runnable manual DOWN is present as the no-deploy kill switch. For `20260729130100`: all four limits are single calls to `get_plan_limit` with the local `v_foxy_limit`/`v_quiz_limit` authority deleted, all four pass through `usage_limit_for_display()` (asserted as exactly 4 wrapped calls) so `999999` cannot leak into a JSON contract that has always used `-1`, the five-key return shape is preserved, the plan LABEL uses the same join+status filter as `get_plan_limit` and `ss.plan_id = sp.id` is gone, and the known `used`-always-0 defect is documented in the migration rather than silently patched. | `apps/host/src/__tests__/get-plan-limit-school-coverage-structure.test.ts` (24 tests, UNIT lane), `apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts` (8 tests, INTEGRATION lane — see the gap below) | P |

### Known gap — REG-329 is PARTIAL, and this is the honest statement

Architect's three condition-2 pins are BEHAVIOURAL and require a live Postgres
to execute plpgsql:

  1. a pure-B2C student's limit is byte-identical pre/post;
  2. a school-covered student on a `trial` school resolves to the `pro` cap;
  3. a personally-`unlimited` student under a `basic` school is NOT downgraded.

They are written as REAL assertions in
`apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts`
(seeds synthetic schools/students/subscriptions, calls `get_plan_limit` and
`get_student_usage` through the service-role client, asserts against the actual
`subscription_plans` catalog rows rather than hardcoded caps, and tears
everything down). That file lives in the INTEGRATION lane: it runs only under
`RUN_INTEGRATION_TESTS=1` with real `STAGING_SUPABASE_*` secrets, and skips
cleanly (8 skipped) otherwise.

**On a normal PR those three pins do not execute.** What gates every PR is the
unit-lane source-contract file, which can only detect SOURCE drift. Do not read
a green PR as "the school-coverage semantics were verified" — read it as "the
migration source still has the shape that makes those semantics true". Status is
therefore `P`, not `E`, and it stays `P` until the integration lane runs against
a live DB in CI.

Two further items deliberately NOT fixed and NOT claimed as covered:

- `get_student_usage`'s four `used` values read `student_daily_usage` WIDE
  columns (`foxy_chats_used`, `quizzes_used`, `notes_generated`,
  `ai_calls_total`) that no writer in the migration chain populates —
  `check_and_record_usage` writes the NARROW `(student_id, feature, usage_date,
  usage_count)` shape. `used` is therefore effectively always 0. The migration
  header documents this; no test asserts a true count, because the behaviour was
  intentionally carried over unchanged.
- The free-tier quiz cap is unresolved between the catalog row
  (`subscription_plans.quizzes_per_day`, column default 3, actual prod value
  unknown from the repo) and the TS/Dart display constants (both 5). The
  migration's deploy-log block RAISE NOTICEs the real value for an operator; the
  tests assert the TS constant's CURRENT value (5) and do not assert that it
  agrees with prod, because it may not. This is a live display/enforcement split
  OUTSIDE SQL awaiting a data-or-code decision.

### Invariants covered by this section

- P8/P13 (tenant boundary, privacy) — REG-328(e): `/api/usage/daily` resolves the
  student strictly from the caller's own auth identity, ignores any
  request-supplied id, and returns five integers/booleans with no PII.
- P11 (payment integrity) — REG-329: entitlement is granted strictly as a
  function of an already-existing `school_subscriptions` row in
  `status IN ('active','trial')`. No pricing, no subscription status and no
  payment record is written; a cancelled/expired school contributes nothing.
- P12 (AI safety / daily limits) — REG-328(e): the display route is read-only and
  cannot let a student exceed the enforced cap; the hard gate remains
  `check_and_record_usage`.
- Display/enforcement single-authority — the whole point. REG-328 pins it in TS
  and Flutter; REG-329 pins it in SQL (source-level on every PR, semantically
  only in the integration lane).

### Catalog total

Pre-REG-328: 327 entries (through REG-327, diagnostic blueprint/ladder — see
`03-quiz-integrity.md`). The school-coverage daily-limit fix adds REG-328
(display == enforcement across the TS client, the new `/api/usage/daily`
read-through and the Flutter tri-state parse, plus the "no sentinel ever
renders" guarantee) and REG-329 (the `get_plan_limit` / `get_student_usage`
SQL single-limit-authority migrations — PARTIAL: source-contract in the unit
lane, semantics in the integration lane only).
**Total catalog: 329 entries (target: 35 — TARGET EXCEEDED).**

Renumbering note (2026-07-29): these two entries originally claimed
REG-324/REG-325. The same-day DSA-audit batch (PR #1415) merged to `main` first
and took REG-322..REG-325, so this batch was renumbered to REG-326..REG-329
during the rebase. Nothing from either batch was dropped or reworded.

---
