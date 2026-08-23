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
`packages/lib/src/usage-sentinel.ts`). Migration 20260729130500 adds
`usage_limit_for_display()` purely to map 999999 back to -1 so delegating did
not silently turn every unlimited row into a literal "999999". Neither value may
ever reach a rendered string.

Mobile notes this is the exact class REG-90 was created for: a contract change
that compiles on both sides and still produces a wrong number on a real screen.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-328 | `usage_limit_display_equals_enforcement_and_sentinel_never_renders` | **(a) School coverage is visible.** A student whose `subscription_plan` column still says `free` but whose server answer is the school-derived cap gets that cap in `checkDailyUsage` — `limit !== 5`, `allowed === true` at 7 and 12 chats used (the old free cap would have blocked at 5), and a finite school cap (e.g. a `basic` school -> starter quiz cap of 20) is displayed verbatim with the right `remaining`. **(b) Limit and count come from the SAME response**, so badge and gate describe one consistent moment — the local usage read is asserted NOT to run on the server branch. **(c) Pure-B2C is unchanged**, table-driven over 10 (plan, feature) pairs including the legacy aliases and `_monthly`/`_yearly` suffixes, asserted IDENTICALLY on the server branch and the fallback branch, so no B2C student's number moves in either direction. **(d) Conservative fallback contract** — five distinct server failures (non-2xx, network throw, `success:false`, missing `limit`/`count`, non-numeric `limit`/`count`) each degrade to the school-blind local default and NEVER to unlimited; `checkDailyUsage` never throws even on a synchronous transport explosion; and a genuine `limit: 0` is honoured as a real answer rather than treated as a failure. **(e) `/api/usage/daily` route contract** — it relays `get_plan_limit`'s number with no local arithmetic and calls that exact RPC with the caller's own id; returns **503 with NO `data` key** when the RPC errors or returns a non-number (asserted over `null`/`undefined`/string/object/array), and the 503 body is asserted to contain neither `999999` nor a `limit` key so no generous number can leak on a failure path; an unsupported/typo'd/blank feature is 400 **before** auth and before any RPC (its `get_plan_limit` ELSE arm returns the generous `ai_calls_total` cap, so forwarding it would over-promise); 401/403 short-circuit before any DB work; a request-supplied `studentId`/`student_id` is IGNORED in favour of `auth.studentId` (P8); the response body contains exactly `{feature, limit, count, remaining, allowed}` with no student id and no PII (P13); a usage-row READ ERROR still yields 200 with count 0 while the server-side gate remains the real stop; and the route is READ-ONLY — it calls only `get_plan_limit`, never `check_and_record_usage` / `record_ai_usage` / `get_student_usage` (P12). **(f) The unlimited sentinel never renders.** Every unlimited path (server branch and paid-tier fallback branch) yields a limit that `isUnlimitedUsage()` detects; values ABOVE the sentinel are also unlimited (>=, not ==); finite caps 0/1/5/20/200/999998 are NOT mistaken for unlimited; `UNLIMITED_USAGE_SENTINEL === 999999` mirrors the DB mapping; and a static-source canary pins the Foxy header badge to render through `isUnlimitedUsage(chatUsage.limit)` with an Unlimited/असीमित arm, and asserts the literal `999999` appears nowhere in `foxy/page.tsx`. **(g) Flutter tri-state** — `UsageLimit.fromServer` folds BOTH sentinels (`<= 0` and `>= 999999`) to `unlimited`, keeps `isKnown === false` distinct from `unlimited`, and `label()` returns Unlimited/असीमित rather than any number. | `apps/host/src/__tests__/lib/usage-server-authority.test.ts` (39), `apps/host/src/__tests__/api/usage-daily-contract.test.ts` (22), `mobile/test/data/models/daily_usage_limit_test.dart`, `mobile/test/data/repositories/usage_daily_parse_test.dart` | E |
| REG-329 | `get_plan_limit_school_coverage_is_monotone` | **SQL source contract (runs on every PR) + live-DB semantics (does NOT).** Source-contract half, over `20260729130400` and `20260729130500`: the `get_plan_limit` signature, volatility, `SECURITY DEFINER` and `search_path` are preserved and there is no `DROP FUNCTION`, so `check_and_record_usage` / `record_ai_usage` keep resolving; the file is `CREATE OR REPLACE`-only and writes no data; **the personal branch is byte-identical to the baseline body** (same SELECT / join on `plan_code` / `status IN ('active','trial')` / `ORDER BY sort_order DESC` / free fallback literals 5,5 / the `-1 -> 999999` mapping) — the entire "strict no-op for pure B2C" proof rests on that, so drift there is a failure; the return is `GREATEST(v_personal, v_school)` and there is **no `RETURN v_school;` anywhere**, which is exactly how a personally-`unlimited` student under a `basic` school would get downgraded; every school-branch bail-out returns `v_personal`; the school->consumer tier map is asserted arm-by-arm against the TypeScript authority `normalizeSchoolPlanToConsumerCode()` at RUNTIME (not hardcoded), so `trial -> pro`, `basic -> starter`, `standard/premium -> pro`, `enterprise/school_premium -> unlimited` and the fail-closed `-> free` for unknown codes cannot drift from `effective-plan.ts`; the tier ranking mirrors `planTier()`; only `active`/`trial` school subscriptions contribute (P11); the school branch fails SOFT (`EXCEPTION WHEN OTHERS` -> `v_code := NULL`) with `to_regclass` guards on every optional table, so a B2B lookup error can never fail a quota check that used to succeed; the candidate-school set is the UNION of all three link definitions; `_school_active_student_ids` (seat BILLING) is untouched; EXECUTE is re-REVOKEd from PUBLIC/anon/authenticated rather than relying on the pre-existing ACL; no RLS policy, no table DDL and no grade column is touched (P8, P5); and a runnable manual DOWN is present as the no-deploy kill switch. For `20260729130500`: all four limits are single calls to `get_plan_limit` with the local `v_foxy_limit`/`v_quiz_limit` authority deleted, all four pass through `usage_limit_for_display()` (asserted as exactly 4 wrapped calls) so `999999` cannot leak into a JSON contract that has always used `-1`, the five-key return shape is preserved, the plan LABEL uses the same join+status filter as `get_plan_limit` and `ss.plan_id = sp.id` is gone, and the known `used`-always-0 defect is documented in the migration rather than silently patched. | `apps/host/src/__tests__/get-plan-limit-school-coverage-structure.test.ts` (24 tests, UNIT lane), `apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts` (8 tests, INTEGRATION lane — see the gap below) | P |

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

## REG-330 — Institution-entitlement override is now a FLOOR on `get_plan_limit` (2026-07-29, super-admin quota-override P0-1)

**The defect this migration closes.** `/super-admin/entitlements` already
wrote school-scoped daily-limit overrides (`limit.foxy_chat_daily`,
`limit.quiz_daily`) into `institution_entitlements`, with a full audit trail
and a "resolved effective value" preview in the panel. But
`getResolvedEntitlements()`/`isEntitledEnforced()`
(`packages/lib/src/entitlements/resolver.ts`) — the only TS code that ever
read that table — has ZERO callers anywhere in the actual Foxy/quiz quota
path. The REAL enforcement + display authority is 100% SQL: both
`check_and_record_usage()` and `get_student_usage()` derive their limit
exclusively from `get_plan_limit()` (REG-329's `20260729130400`/
`20260729130500`), which never consulted `institution_entitlements` at all.
An operator could set an override, see it reflected in the panel's own
preview, and it would do NOTHING at the moment a student actually sent a Foxy
message or started a quiz. Migration `20260729130600` wires the override in
as a THIRD candidate value inside `get_plan_limit()` — `effective_limit =
GREATEST(v_personal, v_school, v_institution_override)` — so both enforcement
and display inherit the fix automatically with ZERO application/TS code
changes, mirroring `20260729130400`/`20260729130500`'s zero-TS-change shape.
The override is a documented FLOOR, not a ceiling: an admin-set value can only
raise a student's effective cap, never lower it below their personal plan or
their school's tier-derived coverage. Deliberately NOT gated behind
`ff_institution_entitlements_v1` — the change is monotonic and a provable
no-op for every school with no `institution_entitlements` row, so gating it
would ship the fix "wired but inert", the exact trap this task exists to
close (see the migration's own "FLAG GATING" header section for the full
risk-shape argument distinguishing this from `isEntitledEnforced()`'s
toggle-gate, which manages a different, non-monotonic hazard).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-330 | `get_plan_limit_institution_override_is_a_floor` | **SQL source contract (runs on every PR) + live-DB semantics (does NOT, same shape as REG-329).** Source-contract half, over `20260729130600`: `get_plan_limit`'s signature/volatility/`SECURITY DEFINER`/`search_path` are preserved with no `DROP FUNCTION`, so `check_and_record_usage`/`get_student_usage` keep resolving; the file is `CREATE OR REPLACE`-only and writes no data; the personal (§1) branch and the school (§2) candidate-school query stay byte-identical to `20260729130400`'s baseline, so the "strict no-op for pure B2C" and school-tier no-op proofs both remain valid without re-derivation; the return is `GREATEST(v_personal, v_school, v_institution_override)` — the THIRD term — with no path that returns the override alone or reassigns over `v_personal`; the `p_feature -> entitlement_key` mapping is pinned exact (`foxy_chat -> limit.foxy_chat_daily`, `quiz -> limit.quiz_daily`, every other feature including `notes`/`ai_total` resolves NO key — a hard no-op, confirmed by asserting the ONLY two `'limit.*'` string literals anywhere in the executable SQL are those two); the institution-override lookup fails SOFT (a second, independent `EXCEPTION WHEN OTHERS` block beyond the school branch's own) so a bad optional lookup can never fail a quota check; `coerce_institution_limit_max()`'s five malformed-value branches (non-object/array/null, missing `max` key, `period` outside day/week/month, negative, non-integer) are each pinned to resolve to `NULL` via the SOURCE TEXT of its CASE arms, `{max:null}` is pinned to the shared `999999` unlimited sentinel, and a well-formed non-negative integer passes through verbatim; a malformed row is excluded via `MAX()` aggregation, never a raised error; `effective_from`/`effective_to` window checks against `now()` are pinned present on BOTH institution-override query arms (roster branch and direct-link fallback, 2 occurrences each); `entitlement_key` is matched with `=`, never `LIKE`/`ILIKE`/`~`; the candidate-school CTE is confirmed duplicated verbatim (not shared) exactly twice, matching the migration's own documented rationale; EXECUTE is re-REVOKEd from PUBLIC/anon/authenticated on BOTH `get_plan_limit` and the new `coerce_institution_limit_max`; no RLS policy, table/index DDL, or grade column is touched (P8, P5); a runnable manual DOWN restores `20260729130400`'s post-change `GREATEST(v_personal, v_school)` (i.e. removes only the institution-override term, not the school term); and the file is confirmed to read no feature flag anywhere in its executable body (deliberately ungated, per its own documented rationale). Live-DB half: 7 architect-specified condition-2 pins plus a display==enforcement parity check, added as nested `describe` blocks inside the EXISTING `get-plan-limit-school-coverage.test.ts` (reusing its `beforeAll` catalog-presence gate and seedSchool/seedStudent/giveStudentPlan/planLimit/catalogCap helpers rather than a duplicate rig) — (1) a pure-B2C student is unaffected by the 3rd GREATEST term; (2) a school with NO `institution_entitlements` row resolves exactly as `20260729130400` already proved; (3) an override BELOW the school's tier-derived cap does NOT lower the result (floor, not ceiling); (4) an override ABOVE both personal and tier-derived caps WINS; (5) a malformed override (`{max:-1}`) falls through to NULL with no error and no effect; (6) an override with `effective_to` in the past is ignored; (7) two covering schools (one via the DIRECT `students.school_id` link, one via the ROSTER `class_students` path) each holding a valid override — the HIGHER one wins via the `MAX()` aggregate; plus a `get_student_usage` display-equals-enforcement check under an active override. | `apps/host/src/__tests__/get-plan-limit-institution-override-structure.test.ts` (18 tests, UNIT lane), `apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts` (8 new tests nested under `institution-override floor (20260729130600)`, 16 total in the file, INTEGRATION lane — see the gap below) | P |

### Known gap — REG-330 is PARTIAL, and this is the honest statement (same shape as REG-329)

All 7 of architect's condition-2 pins plus the display-parity check are
BEHAVIOURAL and require a live Postgres to execute plpgsql (the function body
is `LANGUAGE plpgsql`, and `coerce_institution_limit_max` needs a real jsonb
evaluator). They are written as REAL assertions in the nested
`describe('institution-override floor (20260729130600)', …)` block added to
`apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts`
(seeds synthetic schools — including a roster-linked second covering school
via `classes`/`class_students` for the multi-school pin — synthetic students,
and `institution_entitlements` rows via the live service-role client, calls
`get_plan_limit`/`get_student_usage`, and relies on `ON DELETE CASCADE` from
`institution_entitlements.school_id`/`classes.school_id`/
`class_students.class_id`/`.student_id` for automatic teardown — no separate
tracking array needed). That file lives in the INTEGRATION lane: it runs only
under `RUN_INTEGRATION_TESTS=1` with real `STAGING_SUPABASE_*` secrets, and
was confirmed locally (no live creds available in this environment) to
collect cleanly and skip all 16 tests in the file (8 pre-existing REG-329
pins + 8 new REG-330 pins) rather than error — i.e. the suite is verified
STRUCTURALLY SOUND (collects, no syntax/type errors, correct skip behaviour)
but its live-DB assertions themselves were NOT executed against a real
database as part of this work.

**On a normal PR none of REG-330's 8 live-DB pins execute.** What gates every
PR is the unit-lane source-contract file
(`get-plan-limit-institution-override-structure.test.ts`, 18 tests, all
passing locally), which can only detect SOURCE drift — it cannot prove the
plpgsql actually behaves as GREATEST-floor semantics at runtime. Do not read a
green PR as "the institution-override floor semantics were verified" — read
it as "the migration source still has the shape that makes those semantics
true". Status is therefore `P`, not `E`, and it stays `P` until the
integration lane runs against a live DB in CI — same caveat, same honesty
posture as REG-329.

### Invariants covered by this section (REG-330)

- P11 (payment integrity) — entitlement is granted strictly as a function of
  an already-existing, operator-written `institution_entitlements` row (a
  commercial-contract fact written via the audited `/super-admin/entitlements`
  panel). No pricing, no subscription status, and no payment record is
  written by this migration; a malformed or expired override row contributes
  nothing (fails closed to the pre-existing `GREATEST(v_personal, v_school)`
  value).
- P8 (RLS boundary) — no RLS posture change; the function reads
  `institution_entitlements` via `SECURITY DEFINER` on behalf of a caller with
  no direct RLS grant on that table, returns a single integer, and leaks no
  row/school identifier/commercial-term/PII (P13).
- P5 (grade format) — no grade column is read or written anywhere in this
  migration; pinned by a negative source-text assertion.
- Display/enforcement single-authority (extends REG-329's point) — the
  override reaches BOTH `check_and_record_usage` (enforcement) and
  `get_student_usage` (display) through the same `get_plan_limit()` call, so
  the two cannot drift apart for a school-covered student the way REG-328
  found them drifting before.

### Catalog total

Pre-REG-330: 329 entries (through REG-329, `get_plan_limit` school-coverage +
`get_student_usage` single-limit-authority migrations). The institution-
override floor fix adds REG-330 (`get_plan_limit`'s third `GREATEST` term
reading `institution_entitlements`, plus the new `coerce_institution_limit_max`
helper — PARTIAL, same honest shape as REG-329: source-contract in the unit
lane, semantics in the integration lane only, not yet run against a live DB).
**Total catalog: 330 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-331 — BoardScore™ subject-scoping fix batch (2026-07-30, CEO-reported "all subjects shown" defect)

Two independent bugs fixed in one wave, per
`docs/superpowers/specs/2026-07-30-boardscore-subject-scoping.md`:

**Bug 1 (compute always failed).** `computeBoardScore()` in the Deno Edge
Function `supabase/functions/board-score/index.ts` used a PostgREST nested
embed (`cme_concept_state.select('... curriculum_topics!inner (... subjects
!inner (code))')`) requiring an undeclared FK from
`cme_concept_state.concept_id` to `curriculum_topics.id` — every `compute`
call 500'd/422'd. Rewritten as three flat fetches (`subjects` id lookup →
`curriculum_topics` id+chapter_number → `cme_concept_state` by student_id
only) joined via an in-memory `Map`, mirroring the existing pattern in
`cme-engine/index.ts`. The scoring formula itself (`computeRetention`,
`classifyMastery`, the chapter-weighted `effective_mastery × marks_allocated`
loop, confidence-band widening, recovery-plan ranking, and the
`board_score_predictions` upsert shape) is confirmed BYTE-FOR-BYTE UNCHANGED —
verified this session via explicit `git diff` review (not "tests still
pass," per the spec's own §8 item 8 instruction that a formula claim needs
diff-level proof, not test-inference).

**Bug 2 (subjects not student-chosen).** The nightly cron computed a
prediction for EVERY subject with active `cbse_chapter_weights` at a
student's grade — no reference to what the student actually selected. New
`getStudentBoardSubjects(studentId, grade)`
(`apps/host/src/app/api/cron/board-score/_lib/get-student-board-subjects.ts`)
replaces `getActiveSubjectsForGrade(grade)`: 3-step intersection of (1) the
student's own `students.selected_subjects`, (2) `subject_kind IN
('cbse_core','cbse_elective')` — never `platform_elective` — via a real
`subjects` table join, and (3) subjects with active `cbse_chapter_weights` at
that grade. Also enforced defense-in-depth at `POST /api/board-score`
(422 `subject_not_eligible` before any Edge Function call) and in the Edge
Function's `get` action (`platform_elective` codes excluded from every
response even for pre-existing stray rows).

Two migrations ship alongside: a one-row data-quality fix
(`cbse_chapter_weights.subject_code`: `'social_science'` → `'social_studies'`
for Grade-10 rows — without this, a student who correctly selected
`social_studies` could never get a Grade-10 SST BoardScore, since the join
key would never match) and a defensive cleanup DELETE for pre-fix
over-broad `board_score_predictions` rows (currently a verified NO-OP — the
table has zero rows in every reachable environment, since Bug 1 meant
`compute` had never successfully written a row — shipped anyway as a
standing correctness invariant against a deploy-order race between the
migration and the application-code fix).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-331 | `boardscore_subject_scoping_and_embed_fix` | **(a) Subject-scoping logic (AC2-AC4, REAL execution via mocked Supabase, not just structural)** — `getStudentBoardSubjects` returns exactly `['math']` for `selected_subjects=['math']` at grade 10, never `science`/`social_studies`/`english` despite those having grade-10 weights (AC2); `[]` for `selected_subjects=[]` OR `NULL`, with the `subjects`/`cbse_chapter_weights` tables never even queried — no fallback to "all subjects" (AC3); `coding` (`platform_elective`) never appears in the result even when present in `selected_subjects`, PROVEN via asserting the exact `.in('subject_kind', ['cbse_core','cbse_elective'])` filter argument the function sent — not by trusting a canned response (AC4); a selected subject with no `cbse_chapter_weights` row at that grade (e.g. `hindi`) is silently excluded, not an error; malformed/null `selected_subjects` and a students-lookup error both resolve to `[]` without throwing; multiple per-chapter weight rows for one subject de-duplicate to one entry. **(b) `POST /api/board-score` eligibility gate (AC5)** — returns `422 { error: 'subject_not_eligible' }` and makes ZERO `fetch` calls to the Edge Function for a subject not in the student's `getStudentBoardSubjects` result, INCLUDING a subject that has `cbse_chapter_weights` at that grade but was never selected (the exact bug-recurrence path if only the cron were fixed); confirms the route calls `getStudentBoardSubjects(studentId, grade)` with the resolved values before deciding; confirms it DOES forward to the Edge Function for an eligible subject; confirms the pre-existing `422 invalid_subject_code` malformed-body path short-circuits before the eligibility check even runs. **(c) Cron per-student scoping (structural)** — `apps/host/src/app/api/cron/board-score/route.ts` imports and calls `getStudentBoardSubjects(studentId, grade)` INSIDE the per-student loop (after the student destructure, not hoisted); the old `getActiveSubjectsForGrade` function and the old per-grade `subjectsByGrade` Map cache are both confirmed ABSENT from the file (a grade-only cache is invalid once subjects are student-scoped — two students in the same grade can now get different subject sets). **(d) Edge Function embed fix + formula-untouched (structural + explicit git-diff review)** — the broken `curriculum_topics!inner(...)`/`subjects!inner(code)` nested-embed pattern is confirmed ABSENT as executable code (the fix's own explanatory comment legitimately NAMES the old pattern in prose, so the assertion strips `//` line-comments and requires the pattern's real multiline field-list shape, not a bare string match); the flat three-query pattern (`subjects` → `curriculum_topics` → `cme_concept_state`, joined via `topicChapterMap: Map`) is confirmed PRESENT; five formula-integrity pins assert `computeRetention`'s exact decay expression, `classifyMastery`'s four exact thresholds (0.75/0.50/0.25), confidence-band widening (`bandHalf = coveragePct < 60 ? 15 : 10`), the chapter-scoring loop's `effective_mastery`/`predicted_marks` expressions, and the upsert's exact `onConflict` natural key — all BYTE-IDENTICAL to pre-fix source, so a FUTURE edit to this file cannot silently drift the formula without a test failing (this session's own `git diff` review, which caught nothing, is not itself a durable guardrail once merged). `getBoardScores`' defensive `platform_elective` exclusion filter also pinned present. **(e) Migration structural pins (source-contract only, no live-DB execution — see gap below)** — `20260801110000` is pinned to the exact `UPDATE public.cbse_chapter_weights SET subject_code = 'social_studies' ... WHERE subject_code = 'social_science' AND grade = '10' AND board = 'CBSE'` predicate (scoped to the EXECUTABLE SQL between `BEGIN;`/`COMMIT;`, so the file's own documented manual-DOWN text — which legitimately runs the update in reverse — cannot false-negative the idempotency check), confirmed idempotent by construction (the WHERE clause only matches the pre-fix value) and DDL/RLS-free; `20260801110100` is pinned to the exact `DELETE FROM public.board_score_predictions bsp WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = bsp.student_id AND bsp.subject_code = ANY(COALESCE(s.selected_subjects, '{}')))` predicate, its `RAISE NOTICE`/`GET DIAGNOSTICS` observability, its own in-file honesty about being a current zero-row no-op, and DDL/RLS-free. `deno check` on the Edge Function found 4 pre-existing `SupabaseClient<any,"public",any>` type errors, confirmed via a side-by-side `deno check` on the pre-batch `git show HEAD` copy of the same file to be UNCHANGED by this batch (same 4 errors, same lines, unrelated to the diff) — reported as an honest pre-existing-defect finding, not fixed as part of this pass (out of scope; not testing's file to fix). | `apps/host/src/__tests__/get-student-board-subjects.test.ts` (9), `apps/host/src/__tests__/api/board-score-post-route.test.ts` (5), `apps/host/src/__tests__/board-score-cron-structural.test.ts` (6), `apps/host/src/__tests__/board-score-edge-function-structural.test.ts` (12), `apps/host/src/__tests__/board-score-subject-scoping-migrations-structure.test.ts` (12) — 44 tests | P | P1-adjacent, P5, P6-adjacent |

### Known gap — REG-331 is PARTIAL, and this is the honest statement

The subject-scoping LOGIC (`getStudentBoardSubjects`) and the ROUTE-level
eligibility gate (`POST /api/board-score`) are executed via mocked Supabase
responses in the Vitest lane and run on every PR — that part is genuinely
behaviorally verified, not just structural. What does NOT execute anywhere
in this pass:

1. **The Edge Function itself.** `supabase/functions/board-score/index.ts`
   is Deno code. `deno check` (type-check only, no execution) was run and
   passed with zero NEW errors (4 pre-existing, unrelated errors confirmed
   present in the pre-batch version too) — but no Deno *test* runner
   executed `computeBoardScore()` or `getBoardScores()` against a real or
   mocked Postgres. The flat-fetch-plus-Map-join rewrite (Bug 1) is
   therefore pinned STRUCTURALLY (source-text pattern absence/presence) and
   by formula-byte-identity, not by running the function.
2. **The nightly cron end-to-end.** `apps/host/src/app/api/cron/board-score/route.ts`
   iterating real students and calling a real (or even mocked) Edge Function
   fetch is not exercised — only the per-student-loop wiring is pinned via
   source text (the old cache is gone, the new call site is inside the
   loop).
3. **Both migrations' actual SQL execution.** No live-DB integration test
   runs the `UPDATE`/`DELETE` against a seeded Postgres and asserts a
   before/after row count, unlike the precedent set by
   `get-plan-limit-school-coverage.test.ts` for REG-329/330 (which at least
   HAS an integration-lane companion file, even though it doesn't run on a
   normal PR either). No integration-lane companion exists yet for these two
   migrations — this is a bigger gap than REG-329/330's, which have the
   integration file even if it doesn't execute in this environment.

Do not read a green PR as "BoardScore now computes correctly end-to-end
against a live database" — read it as "the subject-scoping decision logic is
behaviorally correct against every mocked scenario tested, the route
correctly gates on that logic, and the Edge Function's source no longer
contains the specific broken pattern nor a formula drift." Closing gaps 1-3
requires either a Deno test harness for this function (none exists in this
repo for `board-score` specifically) or a live-DB integration suite
following the REG-329/330 precedent — both out of scope for this pass per
the task's own Priority 4 framing ("you likely can't execute Deno against a
live DB").

### Invariants covered by this section (REG-331)

- P1-adjacent (BoardScore's own documented formula, not quiz P1) — the
  scoring formula, retention decay, confidence-band widening, and upsert
  shape are pinned byte-identical; explicitly NOT a P1 (quiz
  `score_percent`) change per spec §6.
- P5 (grade format) — `grade` flows through `getStudentBoardSubjects` and
  every Edge Function call as a string throughout; no integer coercion
  introduced.
- P6-adjacent (content-scoping correctness) — a student never sees a
  "predicted board score" for a subject CBSE does not examine
  (`platform_elective`) or a subject they never elected — the defect this
  whole batch exists to close was students seeing predictions for
  subjects they didn't choose.

### Catalog total

Pre-REG-331: 330 entries (through REG-330, institution-entitlement override
floor). The BoardScore subject-scoping fix batch adds REG-331 (PostgREST
embed-fix + per-student subject-scoping + the two supporting migrations —
PARTIAL: the TypeScript-side logic and route gate are behaviorally tested on
every PR, the Deno Edge Function and both migrations are pinned
structurally only, with no live execution in this pass — see the gap
statement above). **Total catalog: 331 entries (target: 35 — TARGET
EXCEEDED). REG-332 is the next free id.**

---

## REG-367..REG-369 — Student-OS IA consolidation: silent-failure guards (2026-08-05)

> **Renumbered 2026-08-05 (was REG-345..REG-347).** Upstream PR #1465 (Foxy
> North-Star, 7-commit program) reached `main` first and consumed
> REG-345..REG-366, so per this catalog's numbering convention the
> not-yet-merged side moves up. This batch's Foxy sibling moved
> REG-348 → REG-370 in `02-foxy-ai.md` in the same pass. Anything still
> reading "REG-345..REG-348" for these four guards is stale.

Source: `docs/superpowers/specs/2026-08-05-student-ia-consolidation-design.md`.
Three of the four defects fixed in this pass share ONE failure class — a
cross-file contract that no compiler, no linter, no type and no render test
relates, so when the two sides disagree **nothing fails**. The student
silently sees a duplicated panel, an unreadable label, or a 404. Each guard
below is a static/DOM canary written specifically because the ordinary gates
are structurally blind to its defect. (The fourth, the Foxy mastery-ring
squeeze, is REG-370 in `02-foxy-ai.md`.)

**REG-367 — AppShell rail/aside breakpoint parity.** `StudentOSDashboard`
renders `MasterySnapshot` and `RevisionRail` TWICE on purpose (once in
`AppShell`'s `rail`/`aside` slots, once inline in the content column) and
relies on CSS to show exactly one of each. But the slots are revealed by
`@media (min-width: …)` rules in `packages/ui/src/globals.css` while the
inline copies are hidden by Tailwind `{bp}:hidden` utilities in the TSX —
two mechanisms, two files, two languages, no relation. They had drifted:
inline copies hid at `lg`(1024)/`xl`(1280) while the slots revealed at
768/1024, so `MasterySnapshot` double-rendered across 768-1023px and
`RevisionRail` across 1024-1279px. JSDOM evaluates no media query, so a
render test cannot see this; the only distinguishing fact is whether the two
NUMBERS agree.

**REG-368 — MasteryRing centre label must fit inside the ring.** The
wonder-blocks `MasteryRing` fallback centre label was hardcoded `text-xs`
(12px) regardless of `size`. At the Foxy call site (`size=40 strokeWidth=4`)
the inner clear diameter is 32px while a bold "100%" at 12px measures
~30-31px, so the absolutely-positioned label painted over the ring stroke.
Purely visual: no error, no warning, no failing assertion anywhere.

**REG-369 — internal-link canary.** `BoardScoreWidget` shipped a prominent
AnswerChecker™ CTA linking to `/answer-checker`. No `page.tsx` and no
`next.config.js` redirect for that path has ever existed, so it 404'd for
every student whose recovery plan carried recoverable marks — i.e. exactly
the engaged users it targeted. A plain string `href` is not type-checked
against the route tree, the CTA rendered only behind a data condition
(`ctaGain > 0`) that no fixture produced, and a 404 is a runtime event on
the USER's machine — invisible to build, lint and every render test.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-367 | `student_os_inline_breakpoint_parity` | **The invariant, not the current string:** the hide-breakpoint of each inline copy, resolved to PIXELS through the Tailwind screens scale, EQUALS the `min-width` of the media query that reveals its rail/aside counterpart, PARSED OUT OF `packages/ui/src/globals.css` at test time (move the media query to 820px and this fails until the TSX follows). Supporting pins that stop the parity check going vacuous: (a) a minimal brace-aware CSS reader attributes a declaration block to its ENCLOSING at-rule (a flat regex over a 4k-line stylesheet cannot), strips comments first so a `{` in prose cannot desync the stack, and THROWS rather than defaulting when `.app-shell-v2 > .app-shell-{rail,aside} { display: block }` is not found exactly once or does not sit inside exactly one `@media (min-width: Npx)`; (b) the current reveal values (rail 768, aside 1024) are asserted so a deliberate shell redesign surfaces as a reviewed change instead of silently re-pointing the parity assertions; (c) `apps/host/tailwind.config.js` is asserted NOT to define `theme.screens`, which is the only thing making the `md`=768/`lg`=1024 px translation legitimate; (d) both markup hooks (`student-os-snapshot-inline`, `student-os-revision-inline`) are proven to have ZERO CSS rules anywhere across `apps/host/src` + `packages/ui/src` + `packages/lib/src`, so "the Tailwind class is the sole visibility control" is a pinned fact, not an assumption; (e) the PREMISE is pinned — after comment-stripping, `<MasterySnapshot>` and `<RevisionRail>` each appear exactly TWICE and both `rail={`/`aside={` slots exist, so a refactor that drops one copy cannot make the parity assertions meaningless. **Teeth, on pure helpers with no source touched:** the two exact shipped regressions (`snapshot lg:hidden` vs rail@768, `revision xl:hidden` vs aside@1024) are asserted to FLAG; the fixed classNames are asserted to ACCEPT; ambiguous (`md:hidden lg:hidden`), missing, unconditional-`hidden`, and unknown-breakpoint (`tablet:hidden`) inputs all THROW rather than silently passing; the CSS reader refuses a `display:block` rule with no enclosing media query (which would silently mean "always shown"). | `apps/host/src/__tests__/student-os-inline-duplicate-render.test.ts` (18) | E | P7-adjacent (student-visible layout integrity), operational integrity |
| REG-368 | `mastery_ring_label_fits_ring` | Tests RENDER the component exported from the `@alfanumrik/ui/ui` barrel (the same barrel every app call site imports, so a re-point follows automatically) and read `style.fontSize` + text content OFF THE DOM. They never restate the implementation's own `Math.max(9, Math.round(size * 0.1875))` — a test that recomputed the formula would agree with any future formula, correct or not, and would pin nothing. **No-visual-regression pin:** the DEFAULT `size=64` must render EXACTLY 12px, identical to the old hardcoded `text-xs`, both implicitly and explicitly. **Fit model:** this suite uses its OWN typographic model, deliberately STRICTER than the component's (0.65em per glyph vs the component's 0.62), applied to the ACTUAL rendered glyph count against the ACTUAL inner clear diameter (`size - 2*strokeWidth`) with NO breathing-room subtraction — so the geometry assertions pass only with real margin. Worst-case "100%" is asserted to fit at the exact 40/4 geometry that overflowed, with an explicit REGRESSION WITNESS that the old 12px would NOT have fit there (proving the assertion has teeth rather than passing trivially). The fit + legibility (`>= 9px` floor, never fractional px) + `%`-glyph-retention checks then run across every real call-site `size`/`strokeWidth` pair, enumerated from a filtered grep and documented IN the file — including the fact that the 64/5 row is the component's declared DEFAULTS with NO shipping call site (`dev/ui/page.tsx` imports a DIFFERENT same-named component from `@alfanumrik/ui/ui/primitives`, proved by the `bandLabel` prop wonder-blocks does not declare), while the real size-64 site is `learn/os/SubjectHeader.tsx:59` at 64/6. Also pinned: monotonic scaling (a bigger ring never gets a smaller label); the `%` glyph is dropped ONLY on a synthetic sub-shipping ring too narrow for four glyphs, never on a real call site, and never yields empty/`NaN`; the fallback label is bypassed entirely when `children` are passed (most call sites) while `aria-label` still reports `Mastery: N%` on BOTH paths — the a11y contract must not depend on whether the glyph fit; display-only clamping of out-of-range values (150→100%, -20→0%) is asserted as a DISPLAY guard explicitly not P1 quiz math. **Documented limit:** JSDOM does no layout and no font metrics, so this is a geometric model against rendered inputs, not a measured text width — the strongest check available short of a screenshot test. | `apps/host/src/__tests__/components/ui/mastery-ring-label-fit.test.tsx` (31) | E | P1-adjacent (display-only clamp, explicitly NOT quiz scoring), a11y |
| REG-369 | `no_dead_internal_links` | Enumerates the App Router page tree (route groups `(x)` contribute no URL segment, `_private` folders are not routable, `[id]`/`[...slug]`/`[[...path]]` become matchers), parses `source` values out of `next.config.js`'s `redirects()` body ONLY (bounded at the next `async <name>(` sibling so `rewrites()`/`headers()` cannot bleed in), collects every LITERAL internal `href="/…"` / `to="/…"` across `apps/host/src` + `packages/ui/src`, and asserts each resolves to a page, a redirect, or an allowlisted known-dead entry. The BROAD form was chosen over a narrow `/answer-checker` grep because it generalises the fix instead of pinning one string. **Non-vacuity is asserted, not assumed:** >100 routes enumerated (incl. `/dashboard`, `/pricing`), >100 source files scanned, >20 literal internal hrefs found, and the redirect parser is proven to have found the right function body (contains the Study Menu v2 `/review` + `/study-plan` sources, and does NOT contain the `rewrites()`/`headers()` `/(.*)`/`/ingest*` sources). **The specific defect is a HARD assertion, not allowlist-mediated:** no `/answer-checker` href exists anywhere in scanned source, no `/answer-checker` page or redirect exists either (stated as the REASON the first assertion holds — if AnswerChecker ships for real this flips first and the CTA may legitimately return), and `BoardScoreWidget.tsx` carries no anchor to it while still documenting the removal (so a wholesale revert is visible here too). **Anti-rot allowlist:** `KNOWN_DEAD_LINKS` carries exactly TWO reviewed PRE-EXISTING dead links outside this pass's four fixes — `/super-admin/students` (the directory exists but holds only `[id]/page.tsx`, no index, so the Foxy-report "back to students" link 404s) and `/upgrade` (no page, no redirect; `/pricing` and `/billing` are both plausible targets, so picking one is a product decision). A dedicated test asserts each allowlisted path is STILL dead AND STILL linked — so the moment either is fixed the suite FAILS and forces the entry to be DELETED. The allowlist cannot rot into permanent cover, and it is documented in-file with a `TODO(frontend)`. **Teeth, on pure matchers with no source touched:** flags the `/answer-checker` class; accepts exact static routes, correctly-filled dynamic segments (and rejects wrong segment counts in both directions), catch-all (`[...slug]` needs ≥1 segment) and optional catch-all (`[[...path]]` matches the bare parent), and redirect-only paths; strips route groups without leaking a literal `(student)` and without banning legitimate underscores INSIDE segment names (`/support/[ticket_id]` is a real route); normalizes query/hash/trailing slash; and does not treat a literal `.` in a route as a wildcard. **Deliberate limits, stated so the canary is not over-claimed:** literal hrefs only (template/computed hrefs are skipped — resolving them needs data-flow analysis and guessing produces false positives), `router.push`/`redirect()` call sites are not scanned, `/api/*` is skipped (route handlers, covered by the API route-manifest specs), and external/`#`/`mailto:`/`tel:` are not internal links. So PASSING does not prove every link works; FAILING always means a real dead literal link. | `apps/host/src/__tests__/internal-href-route-resolution.test.ts` (16) | E | P15-adjacent (student navigation funnel), operational integrity |

### Invariants covered by this section (REG-367..REG-369)

- **P7-adjacent (student-visible UI integrity)** — REG-367 pins that the
  responsive dashboard shows each panel exactly once at every viewport. The
  defect was language-independent (a layout duplication, not a copy gap), so
  this is adjacent to P7 rather than a bilingual-parity pin.
- **P1-adjacent (display-only, explicitly NOT quiz scoring)** — REG-368's
  clamp assertions pin `MasteryRing` as a DISPLAY guard over whatever value
  it is handed. P1 lives in `submitQuizResults()`; nothing here re-derives
  `score_percent`, and the suite says so in-file so a future reader does not
  mistake the clamp for scoring authority.
- **P15-adjacent (navigation funnel integrity)** — REG-369 closes a
  user-visible 404 on a prominent CTA. Not the signup funnel P15 names, but
  the same class of "the path the user is invited to take must exist".
- **Operational integrity (silent-failure classes)** — all three defects
  produced NO error, NO warning, NO type error and NO failing test. Each
  guard exists because the ordinary gates are structurally blind to its
  defect: JSDOM evaluates no media query (REG-367), does no layout or font
  metrics (REG-368), and a 404 happens on the user's machine after the build
  is long green (REG-369).

### Known limits — stated, not papered over

None of these three is a browser-truth check. REG-367 and REG-369 are
static-source canaries; REG-368 renders for real but asserts a geometric
model against rendered inputs because JSDOM supplies no font metrics. A
visual-regression or Playwright-viewport run would be strictly stronger for
REG-367/REG-368 and is not part of this pass. REG-369's `KNOWN_DEAD_LINKS`
allowlist means the suite is green while two real 404s remain in production
— they are documented above and in-file with a `TODO(frontend)`, and the
anti-rot test forces their deletion the moment either is fixed.

### Catalog total

Pre-REG-367: 366 entries (through REG-366, the K9 leadership standalone-route
fold-in — see `07-teacher-school.md`; REG-332..REG-366 live in
`02-foxy-ai.md`, `03-quiz-integrity.md`, `04-payments.md`, `05-xp-scoring.md`,
`07-teacher-school.md`, `10-rbac-rls.md`, `11-infrastructure.md` and
`13-rag-cache.md`, not this shard, which is why this file's previous running
counter above still reads 331). That 366 is the header's declared total and
is carried forward here unaltered — see the honesty note in `00-header.md`
about REG-361..REG-365, which are narrated in the header but have no shard
body entry yet; if those five are later found to be uncatalogued rather than
merely unfiled, every total in this paragraph shifts down by 5 in lock-step
and the ids assigned below do not move. The Student-OS IA consolidation batch
adds REG-367 (AppShell rail/aside breakpoint parity), REG-368 (MasteryRing
centre-label fit) and REG-369 (internal-link canary, carrying a documented
2-entry anti-rot allowlist). REG-370 (the Foxy mastery-ring no-shrink guard
from the same pass) lands in `02-foxy-ai.md`.
**Total catalog after this shard's three: 369 entries (target: 35 — TARGET
EXCEEDED); after REG-370: 370 entries. REG-371 is the next free id** (the
ops-owned `docs/superpowers/specs/2026-08-05-student-ia-consolidation-design.md`
proposals are being renumbered into REG-371..REG-377 in a parallel pass; if
that batch lands first, the next free id moves to REG-378).

---

## Phase 4 — `/today` as a prioritized action queue (2026-08-11)

Commit `b008c20c7`. `/today` is the DEFAULT student route — the first screen
after login. It was rebuilt in place (no V3 fork) as a prioritized action
queue, and the same commit added the surface's FIRST analytics events (it had
zero). The quiz-resume half of the same commit is catalogued in
`03-quiz-integrity.md` (REG-380..REG-387).

The unifying property of every entry below is **honesty under uncertainty**:
each pins a case where the previous surface asserted something it did not
know — that the student had finished their day, that an activity takes 7
minutes, that they had 0 unread updates, that a machine reason string was
learner-facing copy.

**Verification (2026-08-11):** re-run green from `apps/host` in the same
8-file vitest pass recorded in `03-quiz-integrity.md` — `today-page-states`
39 passed, `reason-copy` 42 passed, `TodayHomeV2` 54 passed; **0 skipped in
all three.**

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-388 | `today_content_tree_and_three_item_plan_cap` | The loaded surface renders EXACTLY six blocks in ONE fixed DOM order — greeting → primary → plan → reminder → progress → foxy — asserted with `compareDocumentPosition`, not by index. Nothing sits above the primary card except the greeting (every direct child before `today-primary` is enumerated and must equal `['today-greeting']`), and no achievement / leaderboard / badge / `rank #` / `level N` hero appears anywhere (the streak survives ONLY inside the compact progress statement, block 5). **HARD CAP OF THREE:** a queue of six items renders exactly 3 plan rows, with `MAX_PLAN_ITEMS === 3` pinned as the exported constant so the cap cannot be raised silently in the component. The plan renders in SERVER order and is never re-sorted client-side; the block is omitted entirely when the queue holds only the primary. Exactly ONE primary CTA exists on the screen (`getAllByTestId('today-primary-cta')` has length 1) even with a 3-item queue, and it navigates to the resolver's own deep link. Exactly ONE reminder slot, resolved by urgency (exam > streak-at-risk > unread), and the streak reminder deliberately carries no competing CTA. A11y floor: 44px minimum tap target on every interactive control, labelled primary/plan landmarks, the plan as a real list, every decorative glyph `aria-hidden`. | `apps/host/src/__tests__/components/today/TodayHomeV2.test.tsx` | E | P7 (via REG-389), UX contract |
| REG-389 | `today_reason_copy_completeness_self_extending` | The resolver emits opaque MACHINE reasons; `todayReasonCopy` is the ONLY bridge to something a child reads, and both halves are pinned. **Completeness is SELF-EXTENDING — this is the load-bearing property:** the reason list is EXTRACTED FROM SOURCE at test time by parsing every `reason: 'x' \| 'y';` literal out of `packages/lib/src/state/learner-loop/types.ts`, not hardcoded in the test. Adding a 13th resolver branch without adding a phrase FAILS the suite instead of shipping a card with no justification. The extractor is itself guarded against silent breakage (`expect(reasons.length).toBeGreaterThanOrEqual(12)` plus three spot-checked literals), so a broken regex cannot vacuously pass. Measured at this commit: exactly **12** reasons — `decay_above_threshold`, `in_progress_lesson`, `live_session`, `month_end_default`, `no_signals_yet`, `reviews_due_today`, `reviews_stacking`, `sunday_default`, `teacher_assigned`, `todays_zpd`, `unstarted_chapter_available`, `weakest_topic_practice`. Every one maps (`it.each`) to one of the 6 approved EN phrases, to a NON-EMPTY Hindi phrase that is Devanagari (`/[ऀ-ॿ]/`) and is NOT the English string echoed back (P7), and never to the machine reason itself. **An UNKNOWN reason returns `null` → renders NO chip, never the raw key** — pinned both at the copy function and on the rendered component. The 6th approved phrase ("Prepare for your test") is proven to come from the real exam schedule and from no resolver reason, so it is not fabricated from learner state. **No-jargon guard:** every `en:`/`hi:` literal in `packages/lib/src/today/copy.ts` (sanity floor: >40 strings found) is word-boundary-checked against IRT, BKT, DKT, CME, SRS, ZPD, theta, decay, probability, confidence, fatigue, cognitive load; and all 11 rendered item types × both languages are re-checked on the DOM in `TodayHomeV2`, which also proves the raw `todays_zpd` never prints. | `apps/host/src/__tests__/lib/today/reason-copy.test.ts`; `apps/host/src/__tests__/components/today/TodayHomeV2.test.tsx` (`no internal vocabulary on screen`, `renders no reason chip at all for a reason the copy table does not know`) | E | **P7** |
| REG-390 | `today_no_fabricated_metrics` | Numbers with no reliable source are OMITTED, not invented. (a) **`estMinutes`**: the minutes badge is NOT rendered for a type whose estimate comes from `map-action`'s static per-type preset (authoring-time placeholders, not measurements); it IS rendered for `srs_due`, whose estimate is derived from a real `dueCount`; and it disappears again when `srs_due` arrives with no `dueCount`. (b) **Unread count**: a `null` unread count renders NO reminder — never a "0 updates" reminder. (c) **No weekly aggregate is claimed**: the progress statement is asserted to match none of `/this week\|quizzes this week\|% this week/i`, because no source for one exists. (d) The XP clause is omitted entirely at 0 XP and labelled explicitly as a TOTAL (not "earned today") when present; "No streak yet" is stated honestly at streak 0. (e) The primary card omits subject and concept rather than inventing them when absent. **Documented gap — clause (b) is `P` at the PAGE layer:** the component-level behaviour (null → no reminder) is genuinely asserted, but the page-level test that claims to pin "passes null for the unread count when the notifications read FAILED, never 0" asserts `expect(H.notifications.data).toBeUndefined()` — its own fixture — because the `next/dynamic` stub swallows props. Nothing currently fails if `/today`'s page maps a failed notifications read to `0` before handing it down. See the follow-up below. | `apps/host/src/__tests__/components/today/TodayHomeV2.test.tsx` (`estimated effort — shown only when reliable`, `renders NO reminder when the unread count never arrived (null)…`, `claims no weekly aggregate it does not have`, `progress statement`, `omits the subject and concept rather than inventing them`) | **P** (a,c,d,e = E; b = E at component, P at page) | honesty contract |
| REG-391 | `today_state_machine_locked_state_distinct` | `/today` lands in exactly ONE honest state with at least one working control, whatever happens to the network, the flag or the learner model. **The `locked` state is the real fix and the reason this entry exists:** `ff_today_home_v1` gates BOTH the page (client flag → redirect) and `GET /api/v2/today` (server flag → 404 → `useTodayQueue` resolves `null`), and those two reads can disagree. The null case used to fall into the empty branch and render "You're all caught up ✅" — telling a student they had finished their day when the surface had in fact been switched off. It is now its own state: copy reads "Your plan is turned off right now" + "Nothing is lost", is asserted to match NEITHER `/caught up\|all done/i`, is proven DISTINCT from both `today-empty` and `today-complete`, and offers a working way out (`href="/dashboard"`). The other branches are likewise distinct and pinned: gate-loading (auth or flags resolving; emits NO state telemetry before the gate resolves), logged-out → `replace('/login')`, flag-off → `replace('/dashboard')`, loading (skeleton + `role="status"` "Loading your plan"), recoverable error (`role="alert"`, "Nothing has been lost", a retry that actually calls `mutate()`, and NEVER `today-complete`/`today-empty`), offline (reported as offline rather than a generic error when there is no connection AND no cache; a cached plan still serves rather than blanking; reacts to a post-mount `offline` event), empty vs complete (`practicedToday` false vs true → two different screens, both offering an action), and insufficient-evidence ("We don't know your level yet" — distinct from empty, still offering the one action that fixes it, and NOT fired once `masterySubjectCount > 0`). **Exclusivity is pinned mechanically:** across 6 scenarios the set of the 9 state roots present in the DOM must have length exactly 1, and at most one `today_state_shown` event may fire per render. All five copy-bearing states re-render in Hindi with Devanagari present (P7). | `apps/host/src/__tests__/today/today-page-states.test.tsx` | E | **P7**, honesty contract |
| REG-392 | `today_analytics_pii_free` | `/today` emitted ZERO events before this commit — there was no evidence on which to ramp its own flag. Seven event types were added (`today_viewed`, `today_primary_cta_clicked`, `today_plan_item_clicked`, `today_foxy_clicked`, `today_reminder_clicked`, `today_state_shown`, `today_retry_clicked`), and P13 requires every property to be a closed-vocabulary enum or a count. Pinned: `today_viewed` fires exactly ONCE per resolved queue (a re-render with the same `resolvedAt` does not double-count) with the payload asserted by EXACT equality to `{branch, primary_type, primary_reason, plan_count, reminder}` plus a `JSON.stringify` negative match proving no chapter title (`Nutrition`), no deep link (`/quiz`), no student id (`stu-`) and no email (`@`); `today_primary_cta_clicked` = `{type, reason}` exactly; `today_plan_item_clicked` = `{type, reason, rank}` exactly (server rank, not a client index); `today_foxy_clicked` = `{has_subject: boolean}` — subject PRESENCE only, never the subject code; `today_state_shown` = `{state}` from a closed 8-value union, emitted for stale/loading/error/empty/complete/locked/offline/insufficient_evidence; `today_retry_clicked` = `{state: 'error'\|'offline'}`. Note `reason` is deliberately the MACHINE reason, not the learner phrase — analytics wants branch identity, and that string is proven (REG-389) never to reach a student. **Documented gap — why this is `P`: `today_reminder_clicked` has NO asserting test.** It is declared in `packages/lib/src/analytics.ts:174` and emitted at `packages/ui/src/today/v2/TodayHomeV2.tsx:517`, and a repo-wide grep finds no third reference. 6 of the 7 new events are pinned; that one is not. | `apps/host/src/__tests__/components/today/TodayHomeV2.test.tsx` (`analytics` describe); `apps/host/src/__tests__/today/today-page-states.test.tsx` (`reportedState()` assertions + `today_retry_clicked` + `today_primary_cta_clicked`) | **P** (6 of 7 events pinned) | **P13**, P7 |

### Follow-ups opened by this section (recorded, not silently dropped)

1. **REG-390 clause (b) — page-layer unread-count plumbing is unpinned.**
   `today-page-states.test.tsx`'s "passes null for the unread count when the
   notifications read FAILED, never 0" asserts its own fixture
   (`expect(H.notifications.data).toBeUndefined()`), not the page's behaviour,
   because the `next/dynamic` mock replaces `TodayHomeV2` with a stub that
   discards props. Fix: have the stub record the props it receives and assert
   `unreadCount === null`. Small, and it turns a tautology into a real pin.
2. **REG-392 — `today_reminder_clicked` has no test.** Add a click assertion
   on the reminder row for both the `exam` and `unread` variants; that closes
   the entry to `E`.
3. **REG-385 (in `03-quiz-integrity.md`) is partly source-text.** The `/quiz`
   URL contract, the `mode=practice` branch and the always-on persistence call
   are pinned by reading `page.tsx` as a string. A Playwright spec that
   deep-links `/quiz?session=<id>` and `/quiz?mode=practice` against a seeded
   session would be strictly stronger and is not part of this pass.

**Catalog impact of this section: 5 entries added (REG-388..REG-392). See
`00-header.md` for the reconciled total — this shard's own running counters
above are historical and are deliberately not re-derived here.**

---

## `/today` reason honesty — the deliberately-silent set (2026-08-11)

The third of the four Phase 4 blocker fixes in commit `6a67ca8ed`. Its three
siblings are in `03-quiz-integrity.md` (REG-393, REG-394, REG-396) together
with the two P0 submission defects (REG-397, REG-398).

**Verification (2026-08-11), real output:** re-run from `apps/host` in the same
pass as the whole security + quiz + today sweep —
`Test Files 36 passed (36) | Tests 815 passed | 6 skipped (821)`; the 6 skips
are REG-380's live-DB probes, none of them in this entry's file.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-395 | `today_enumerated_silent_reason_set_both_directions` | Three reason→copy mappings ASSERTED THINGS THE SYSTEM NEVER DETERMINED, and are now deliberately silent (`null` → the renderer omits the chip; it already handled a falsy reason). (a) `sunday_default` → *"Ready for the next concept"* was decided by `isSundayIst()` **and nothing else**, on a Curiosity Dive that sits OUTSIDE the concept sequence — telling a child we assessed them as ready when we looked at a calendar. (b) `month_end_default` → *"Review due"* was decided by `isMonthEndDayIst()`, on a monthly Synthesis where nothing is due and nothing is reviewed; it also COLLIDED with `today.item.srs_due.label` ("Reviews due"), actively misleading a student who had learned that phrase means flashcards. (c) `no_signals_yet` → silent because it fires precisely BECAUSE we know nothing about the learner, so any readiness claim from zero evidence contradicts its own card ("Find your starting point / a quick diagnostic"). All three cards are self-explanatory without a chip. **The test is NOT weakened — this is the load-bearing part.** REG-389's contract was "every resolver reason maps to an approved phrase"; a silent mapping would have satisfied a naive relaxation to "phrase OR null", which would have let ANY future reason go silent unnoticed. It instead asserts **"approved phrase OR a member of an ENUMERATED silent set"**, pinned in BOTH directions against an independent literal list held in the test: every enumerated reason MUST be silent in production, AND every non-enumerated resolver reason MUST NOT be silent, AND every enumerated reason must be a REAL resolver reason (not a stale literal). So a 13th resolver branch satisfies neither arm and FAILS, and silencing a fourth reason in production without a deliberate edit here also FAILS. Silence is symmetric across languages (`a silent reason renders nothing in BOTH languages` — no half-suppressed chip, P7), the two dishonest phrases are pinned ABSENT from the copy table, and REG-389's self-extending source-extraction of the reason set is preserved underneath. | `apps/host/src/__tests__/lib/today/reason-copy.test.ts` (`the deliberate no-chip set is exactly the three calendar-driven reasons`, the two `it.each` completeness sweeps EN + HI, `a silent reason renders nothing in BOTH languages`, `the two dishonest mappings are gone: no reason claims readiness or a due review from a DATE`); `packages/lib/src/today/copy.ts` (`isSilentTodayReason`) | E | **P7**, honesty contract |

**Relationship to REG-389:** REG-389 remains valid and is NOT superseded — its
completeness property (the reason list is extracted from source at test time,
so a new resolver branch with no phrase fails the suite) is what makes REG-395
meaningful. REG-395 narrows the ACCEPTED outcome of that sweep from "a phrase"
to "a phrase, or one of exactly three enumerated silences". Do not merge the two
entries: deleting REG-395's enumeration would silently re-widen REG-389.

---

> **Restored + renumbered 2026-08-23 (launch-readiness catalog reconciliation).**
> Filed as REG-380/381/382 on 2026-08-11; deleted wholesale by `b00b9c872`'s
> stale-base merge resolution while the parallel Phase 4 lineage's own
> REG-380/381/382 (`quiz_session_shuffles_answer_key_column_acl` /
> `resume_payload_answer_key_non_disclosure` /
> `p3_anticheat_survives_resume_both_directions`, `03-quiz-integrity.md`) was
> kept — a direct 3-way id collision. Restored verbatim from `origin/main` and
> renumbered to REG-400/401/402 (`+20`, same shift as the rest of this
> collision range — see `00-header.md`). Re-verified 2026-08-23 — see the
> per-entry note below the table for exact current pass counts (one
> regression found: REG-400's file has 1 new failure out of 23). Do not
> re-use REG-380/381/382.

## Leaderboard SEV1 batch — envelope seam, band totality, no client-side cross-student reads — 2026-08-11

Three defects took the whole `/leaderboard` page down or made it lie, and all three
shipped because nothing tested the thing that broke.

**The seam.** `GET /api/v1/leaderboard/me` returns the v1 envelope `{ success, data }`.
The page's SWR fetcher did `return res.json()` and then read `bandData.band` — off the
ENVELOPE, not off `data`. Always `undefined`. `PercentileBandCard` indexed that into a
`Record<PercentileBand, …>` copy table, `COPY[undefined]` was `undefined`, and
`undefined.emoji` threw during render. The card sits inside
`<SectionErrorBoundary section="Leaderboard">`, which wraps **all seven tabs**, so one key
of nesting blanked the entire page. Both sides had tests: the route's own suite asserted
`body.data.band === 'top_10'`, the page's suite asserted a flat hand-written fixture (and
mocked `PercentileBandCard` to `() => null`, so it could not have seen the crash). Each
side was self-consistent; the PAIR was broken, and nothing tested the pair.

**The union.** Three of the five labels `bandFromPercentile()` emits (`top_1`, `middle`,
`bottom_25`) had no copy row at all, and a fourth (`top_50`) is emitted only by the SQL
`CASE` in migration `20260813000006` — a SECOND producer nobody had reconciled against the
card.

**The impossible feature.** Four tabs read cross-student tables from the BROWSER with the
anon key. `performance_scores` / `score_history` / `challenge_streaks` are own-row-only
under RLS and `student_titles` is service-role-only, so each read returned at most ONE row
and the page rendered it as a peer board: the caller was permanently rank #1 with a gold
medal under a "Top 10 by Performance Score" header the server never produced, "My Titles"
was permanently empty, and "My Class" keyed off `students.class_id` — a column that does
not exist — so every enrolled student was told "You're not in a class yet." None of those
reads ERRORED. They succeeded and returned almost nothing.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-400 | `leaderboard_me_envelope_seam` | The page and the route are tested TOGETHER, not each against a fixture: the page's `fetch` for `/api/v1/leaderboard/me` is answered by invoking the ROUTE's real exported `GET`, and `PercentileBandCard` is NOT mocked. Pins: (a) the real envelope renders a card carrying the route's OWN band, incl. the `bandFromPercentile()`-derived band when the RPC omits one; (b) the route emits exactly `{ success, data }` and `body.band` is `undefined` while `body.data.band` is not — the defect in one assertion; (c) fourteen degenerate payloads (`success:false`, `data:null`, `{}`, `null`, `[]`, string body, truncated envelope, `data` as a string, band as object/number/unknown-label, non-2xx, non-JSON, network rejection) each render NO card, NO boundary fallback and NO throw; (d) a FLAT un-enveloped body — the shape the page used to assume — produces no card, so reverting the fetcher to `res.json()` goes red; (e) blast radius: all six tab controls stay mounted in both the healthy and the degenerate case, i.e. the boundary never trips. Verified to FAIL (5 tests) against a working tree with the fetcher reverted. | `apps/host/src/__tests__/app/leaderboard-band-envelope-seam.test.tsx` (23 tests) | **22/23 as of 2026-08-23 — see note below** | P7, P13 |
| REG-401 | `percentile_band_union_totality` | TOTALITY + PRODUCER DRIFT. All seven bands (top_1, top_10, top_25, top_50, middle, bottom_25, keep_going) each resolve to THEMSELVES (asserted via the rendered `data-band`, so a band with no copy row resolves to the `keep_going` fallback and fails), carry non-empty EN copy, carry Devanagari (`/[ऀ-ॿ]/`) HI copy in both heading and body, differ between EN and HI, produce seven DISTINCT headings, and expose no absolute rank (`/#\d+/`, U10). Totality on hostile input: `undefined`, `null`, empty string, unknown label, number, object, array and the three prototype keys (`toString`, `constructor`, `__proto__`) all render the fallback without throwing. DRIFT GUARD — the declared union is asserted a SUPERSET of BOTH producers, read from source because neither is importable: the TS `bandFromPercentile()` in the me route (thresholds re-derived from its own source, then swept across percentiles 0..100 plus each threshold ±0.1) and the SQL `CASE` in migration `20260813000006` (the only emitter of `top_50`). Both extractors carry explicit non-vacuity assertions, plus a negative control proving the guard can fail. Verified to FAIL (3 tests) with the `top_1` copy row deleted. | `apps/host/src/__tests__/ui/percentile-band-card-totality.test.tsx` (46 tests) | E | P7 |
| REG-402 | `leaderboard_no_client_cross_student_reads` | The `/leaderboard` page never calls `supabase.from()` for any of the four cross-student tables — `performance_scores`, `score_history`, `challenge_streaks`, `student_titles` — asserted against a spy on the client that is left in place PRECISELY so the absence is observable. Rankings render the SERVER's rank (a 4-row board with the caller at #4 renders `#4`, not `#1`, and the caller holds no medal) and the board is labelled from the server's `ranked_by`, never "Performance Score". Own-scoped replacements pinned separately: `/titles` (session-derived `student_id`, `?student_id` ignored, 7-field whitelist, 500-not-empty-list on read failure), `/streaks` (peer whitelist EXACTLY rank / student_id / name / grade / current_streak / badges; a peer's `best_streak` never on the wire while the caller's own is; badges filtered to those already implied by the exposed streak, unknown ids dropped fail-closed; threshold applied server-side; grade coerced to STRING per P5; students read scoped `.in(ids)`, never a full-table scan), `/my-class` (membership from `class_students`, never `students.class_id`; flag-OFF 404 vs `enrolled:false` vs `enrolled:true,items:[]` vs 5xx are FOUR distinguishable outcomes). All three routes are `Cache-Control: private` only. | `apps/host/src/__tests__/app/leaderboard-data-load-error.test.tsx` (25 tests) + `apps/host/src/__tests__/api/v1/leaderboard/own-scoped-routes.test.ts` (33 tests) + `e2e/ui-error-states.spec.ts` (re-pointed at `/api/v1/leaderboard`) | E | P5, P8, P13 |

### REG-400 — one test now fails (found during 2026-08-23 restoration)

`leaderboard-band-envelope-seam.test.tsx` → `the caller own performance score
crosses the seam too` now fails with `Unable to find an element with the
text: 84` (was passing 23/23 when filed 2026-08-11). Not investigated further
in this pass — this file is outside test-infrastructure/catalog scope — but
noted here rather than silently claimed as fully green: this could be a
genuine display-format drift (own score no longer rendered as a bare `84`)
or an unrelated brittleness in the text matcher; either way it is a real,
reproducible failure as of 2026-08-23 and should be triaged by
frontend/assessment. The other 22 tests in the file, and both REG-401/402's
backing files (`percentile-band-card-totality.test.tsx` 46/46,
`leaderboard-data-load-error.test.tsx` 25/25,
`own-scoped-routes.test.ts` 33/33), are fully green.

### Invariants covered by this section

- **P7 (bilingual UI)** — REG-401 reads the copy off the RENDERED DOM in both languages
  rather than off the source table, so a band wired to the wrong language branch fails.
- **P8 (RLS boundary)** — REG-402 pins the architectural correction: a peer board is
  STRUCTURALLY IMPOSSIBLE from the browser under own-row-only RLS. The fix was never to
  loosen a policy; it was to move the read server-side behind an explicit whitelist. No
  policy was weakened in this batch.
- **P13 (data privacy)** — the `/streaks` whitelist is the sharp edge: it is the one route
  in the batch that legitimately returns PEER rows, and its exclusions (`best_streak`,
  `avatar_url`, school/city, `last_challenge_date`, `mercy_days_used_week`) are asserted
  field-by-field rather than by a "no email" smoke check.
- **P5 (grade format)** — both peer-row routes are fed an INTEGER grade in the fixture and
  asserted to emit the string `'8'`, so the coercion is pinned at the boundary where it matters.

### The durable lesson

REG-400 exists because **two green suites either side of a contract prove nothing about the
contract**. A fixture is written from the same understanding as the code that consumes it,
so when that understanding is wrong the fixture is wrong in the same direction and the test
agrees with the bug. The seam test therefore uses NO fixture for `/me`: it drives the real
route handler and the real card, and doubles only what is below the route and beside the
page. Any new page-to-route contract on a surface wrapped in a shared error boundary should
be pinned the same way.

### Catalog total

Pre-REG-400: 379 entries. This section adds REG-400, REG-401 and REG-402.
**Total catalog: 382 entries (target: 35 — TARGET EXCEEDED). REG-403 is the next free id**
(REG-371..REG-377 remain RESERVED).

---
