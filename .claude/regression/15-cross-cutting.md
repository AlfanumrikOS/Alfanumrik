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

