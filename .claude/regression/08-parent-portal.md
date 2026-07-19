## Consumer Minimalism — Wave A "Today" home (2026-06-06) — REG-83

Source: the adaptive "Today" home (`/today`) + the 4-tab student nav, both
flag-gated by `ff_today_home_v1` (default OFF, seeded by
`supabase/migrations/20260612000000_seed_phase1_consumer_minimalism_flags.sql`).
The Learner Loop resolver was refactored into an ordered `BRANCHES` array
(`src/lib/state/learner-loop/resolve-next-action.ts`) and grew a new
`resolveTodayQueue()` plus a `resume_in_progress` action kind. A thin BFF
(`src/app/api/v2/today/route.ts`) projects the resolved queue into render DTOs
via `src/lib/today/map-action.ts`; the page is `src/app/today/page.tsx` with
`src/components/today/*`.

Two load-bearing safety properties hold the whole wave together:

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_today_home_v1` OFF, `/today` is invisible: the page client-redirects to
   `/dashboard` (authenticated) / `/login` (unauthenticated) and never renders,
   the BFF returns 404, and the student bottom nav keeps the legacy
   `CORE_TABS` (Home / Practice / Foxy / Progress) — the Wave-A `TODAY_CORE_TABS`
   (Today / Learn / Foxy / Me) are gated entirely at the call site
   (`MobileBottomNav.tsx` / `DesktopSidebar.tsx`), so current users see exactly
   today's product. A regression that defaulted the flag ON, or that selected
   `TODAY_CORE_TABS` regardless of flag, would silently reshape navigation for
   every student.

2. **Resolver parity (the refactor's single highest blast radius).**
   `resolveNextLearnerAction` is widely imported across the learner loop; the
   if-ladder → ordered-`BRANCHES` refactor must be behaviour-preserving.
   `resolveTodayQueue` re-uses the SAME ordered `BRANCHES` (one source of truth)
   and its `primary`/`queue[0]` MUST equal the raw first-match branch that
   `resolveNextLearnerAction` returns (except under the documented live-resume
   exception, where a `resume_in_progress` action prepends). A drift between the
   two — a reordered branch, a changed predicate, or a queue whose head no
   longer mirrors the resolver — would route students to the wrong next action.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-83 | `today_home_flag_off_parity_and_resolver_mirror` | Two-layer pin on Wave A. **(a) Flag-OFF parity (E2E):** with `ff_today_home_v1` OFF (client `feature_flags` read stubbed), visiting `/today` redirects AWAY from `/today` (never a reachable standalone page) and the student bottom nav renders the legacy `CORE_TABS` with NO "Today"/"Learn"/"Me" tab. The always-green half (`/today` leaves itself for an auth gate) runs unconditionally in CI; the rendered-nav + flag-ON render/Continue-navigation/Hindi-heading halves are `test.fixme(!hasRealStudentCreds(), …)` — catalogued, green once the shared test-student fixture (REG-45/REG-69) lands — with the flag + `/api/v2/today` envelope + subjects all network-mocked so they pass the moment creds exist. **(b) Resolver mirror (unit):** `resolveTodayQueue(...).primary` and `.queue[0]` deep-equal `resolveNextLearnerAction(...)` across every non-live branch (cold-start, stacking reviews, today's ZPD, continue-lesson, Sunday dive, weakest fallback), `.branch === raw.kind`, and the `queue[0] === primary` invariant holds for idle/Sunday/cold-start; the live-resume exception is the ONLY case `primary` diverges from the raw first-match. Together: the flag-off layer proves current users are untouched; the resolver-mirror layer proves the BRANCHES refactor did not change what "next" the loop picks. | `e2e/today-home.spec.ts` (flag-OFF redirect + nav parity + flag-ON render/Continue/bilingual) + `src/__tests__/state/learner-loop/today-queue.test.ts` (resolveTodayQueue ↔ resolveNextLearnerAction primary/branch/queue[0] parity) + `src/__tests__/lib/today/map-action.test.ts` (LearnerAction → TodayQueueItem projection) | E (unit), P (E2E — flag-OFF redirect runs in CI; authenticated-render halves fixme'd until the shared student fixture lands) |

### Pinned tests

- `e2e/today-home.spec.ts::Today home — flag OFF (parity)::visiting /today redirects away (never stays on /today)` (runs in CI)
- `e2e/today-home.spec.ts::Today home — flag OFF (parity)::student bottom nav shows the EXISTING tabs, no "Today" tab` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::renders greeting strip + Today's Focus card with a Continue CTA` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::clicking Continue navigates to the resolver deep-link target` (fixme until fixture)
- `e2e/today-home.spec.ts::Today home — flag ON::renders the Hindi heading "आज" when language is Hindi` (fixme until fixture)
- `src/__tests__/state/learner-loop/today-queue.test.ts::resolveTodayQueue — primary mirrors resolveNextLearnerAction (non-live)::$name → primary deep-equals resolveNextLearnerAction`
- `src/__tests__/state/learner-loop/today-queue.test.ts::resolveTodayQueue — queue[0] === primary invariant`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79): the entire Wave A surface is
  inert with `ff_today_home_v1` OFF — no `/today` render, BFF 404, legacy nav.
- P7 (bilingual UI — no-coverage today) — adjacent: the Hindi-heading "आज"
  assertion is the first browser-level Hi/En check on this surface (gated on the
  auth fixture, not skipped for lack of a language toggle — the harness supports
  one via `localStorage['alfanumrik_language']`).
- Learner-loop routing correctness (P22 domain — assessment-owned rules): the
  resolver-mirror unit layer guards the ordered-`BRANCHES` refactor against a
  behaviour change in "what next".

### Notes on test strategy

REG-83 follows the **flag-OFF safety pattern** (REG-78/REG-79) for the
presentational half and the **contract/parity pattern** (REG-50/REG-51/REG-71)
for the resolver half. The E2E spec mocks the client flag read path
(`feature_flags` REST) + `/api/v2/today` envelope + `/api/student/subjects`, and
asserts on user-visible behaviour (redirect target, rendered tab labels,
Continue navigation URL), never on component internals. The authenticated-render
assertions are `test.fixme(!hasRealStudentCreds(), …)` for the SAME reason as
REG-45 (quiz happy-path) and REG-69 (/refresh): the mocked Supabase session
resolves a real `isLoggedIn` gate only against a real Supabase URL, so a
test-student fixture (TEST_STUDENT_EMAIL/PASSWORD) is required to drive a gated
page in CI — tracked in the TODO at the foot of `e2e/today-home.spec.ts`. The
resolver-mirror unit suite needs no fixture and runs green today; it is the
primary enforcement that the BRANCHES refactor stayed behaviour-preserving.

### Catalog total

Pre-Wave-A: 50 entries (REG-80/81/82 reserved). Consumer Minimalism Wave A adds
REG-83.

**Total (through Wave A): 51 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Consumer Minimalism — Wave C parent "glance" home (2026-06-06) — REG-84

Source: the parent "glance" home (`src/components/parent/ParentGlanceHome.tsx`)
flag-gated by `ff_parent_glance_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1] === false`, seeded by
`supabase/migrations/20260612000000_seed_phase1_consumer_minimalism_flags.sql`).
The parent page (`src/app/parent/page.tsx`) gained a flag branch
(`glanceEnabled && !showClassic`) that renders `<ParentGlanceHome>` — a
push-first, one-scroll reorg of the SAME already-fetched `get_child_dashboard`
payload (+ `perfScores` + `labStreak`) into three stacked sections (Snapshot /
Moments / Actions). `ParentGlanceHome` is `dynamic(ssr:false)`, fetches nothing
of its own, and exposes a "View classic dashboard" escape hatch.

Two load-bearing safety properties hold this wave together (same family as the
REG-78 / REG-79 cosmic flag-OFF safety tests and REG-83's Wave-A flag-OFF
parity):

1. **Flag-OFF parity (byte-identical current product).** With
   `ff_parent_glance_v1` OFF (production truth), the parent page renders the
   EXISTING 8-tab dashboard and `<ParentGlanceHome>` is never mounted — its
   lazy `dynamic()` import is never even resolved into the flag-OFF first-paint
   bundle. The branch is `glanceEnabled && !showClassic`, so the "View classic
   dashboard" reveal also falls back to the legacy tree even with the flag ON —
   nothing is ever lost. A regression that defaulted the flag ON, or inverted
   the ternary, would silently reshape the parent home for every guardian.

2. **Read-only contract (no new write surface).** `<ParentGlanceHome>` is a
   presentation reorg of props — it adds NO endpoint, NO POST, and NO
   "Encourage"/write affordance. Its Actions are NAVIGATION only: `<Link>`s to
   EXISTING routes (`/parent/reports`, `/parent/billing`,
   `/parent/messages` for guardian-mode | `/parent/support` for link-code) plus
   local-UI buttons (reveal classic, refresh, logout — all reusing the page's
   existing handlers). Its loading / empty / error states are derived from props
   alone. A regression that introduced a form/submit/new-endpoint affordance
   here would breach the Wave C "read-only glance" guarantee.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-84 | `parent_glance_flag_off_parity_and_read_only_contract` | Two-layer pin on Wave C. **(a) Flag-OFF parity (unit, page-branch replica):** a faithful replica of the page's `glanceEnabled && !showClassic` ternary, wired to a mocked `useFeatureFlags()` (the same SWR hook the page reads), selects the CLASSIC 8-tab branch when the flag is ABSENT (prod truth), explicitly `false`, or still loading (`data === undefined`); selects the GLANCE branch ONLY when the flag is `true` (proves the switch is live, not a dead no-op); and falls back to CLASSIC with the flag ON once `showClassic` is set (the reveal escape hatch). A standalone assertion pins `FLAG_DEFAULTS[PARENT_GLANCE_V1] === false` against a default-flip regression. **(b) Read-only render contract (unit, direct mount):** `<ParentGlanceHome>` renders the Snapshot, Moments, and Actions regions for a child with activity (stat values read straight off props — no recompute); the Actions are navigation `<Link>`s to `/parent/reports`, `/parent/billing`, and `/parent/messages` (guardian) / `/parent/support` (link-code); there is NO `<form>` / `<input>` / `<textarea>` / `button[type=submit]` anywhere and EVERY `<a href>` is an internal `/parent/*` route; the lazy `WeeklyReport` (Bearer-authed fetch) mounts only for `canFetchReport` parents; loading → skeleton (none of the three sections), `error` → Try-Again wired to `onRefresh`, and zero-activity → contextual empty state (with the classic-reveal footer still present); and the Hindi headline + Arabic-numeral stats render under `isHi` (P7). | `src/__tests__/components/parent/parent-glance-home.test.tsx` (15 tests: 6 page-branch dispatch + 9 component read-only/state) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::renders the CLASSIC 8-tab dashboard when the flag is ABSENT (prod truth)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::renders the GLANCE home when the flag is ON (switch is live, not dead)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::Parent page — ff_parent_glance_v1 flag-branch dispatch::falls back to the CLASSIC dashboard with the flag ON once classic is revealed`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Snapshot + Moments + Actions (read-only)::renders Actions as navigation links to EXISTING routes — no POST / write`

### Invariants covered by this section

- Flag-OFF safety (same family as REG-78/REG-79/REG-83): the entire Wave C
  surface is inert with `ff_parent_glance_v1` OFF — classic 8-tab dashboard
  renders, the glance home is never mounted, its `dynamic()` import never enters
  the flag-OFF bundle.
- Read-only / no-new-write-surface contract: the parent glance home is a
  presentation reorg; its Actions are navigation to existing routes only.
- P7 (bilingual UI — no-coverage today) — adjacent: the Hindi-headline +
  Arabic-numeral-stats assertion is a component-level Hi/En check on the new
  parent surface.

### Notes on test strategy

REG-84 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83): the
page-branch half renders a faithful replica of the page's dispatch ternary wired
to the REAL flag-read hook (`useFeatureFlags`) and asserts on which branch is
selected, never on component internals. The read-only half mounts the real
`<ParentGlanceHome>` with representative already-fetched props and asserts on
user-visible structure (the three section regions, the Action hrefs, the absence
of any write affordance, the prop-driven loading/empty/error states). Only the
flag-read hook and the lazily-imported `WeeklyReport` (which owns its own
Bearer-authed fetch) are mocked — both are seams, not business logic. The suite
needs no Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave C adds REG-84 (parent glance flag-OFF parity +
read-only contract).

**Total: 52 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Consumer Minimalism — Wave D parent → child "Encourage" (2026-06-13) — REG-85

Source: the parent → child "Encourage" (a.k.a. "D-encourage") feature, flag-gated
by `ff_parent_encourage_v1` (default OFF —
`FLAG_DEFAULTS[CONSUMER_MINIMALISM_FLAGS.PARENT_ENCOURAGE_V1] === false`, seeded by
`supabase/migrations/20260613000002_ff_parent_encourage_v1.sql`). This is the FIRST
parent→child WRITE affordance added to the otherwise read-only Wave C glance home.
A parent picks one of a curated set of **preset** cheers (`src/lib/parent/cheer-catalog.ts`,
8 presets) and the route (`src/app/api/v2/parent/encourage/route.ts`,
permission `child.encourage`, migrations `20260613000000`/`20260613000003`) fans it
out to the linked child's notifications feed (`parent_cheer` type) and records a
`parent_cheers` row (`20260613000001`). The button surface is
`src/components/parent/EncourageButton.tsx`, mounted by
`src/components/parent/ParentGlanceHome.tsx`.

Because this introduces a write affordance that did not exist in Wave C, three
load-bearing safety properties hold it together (same family as the REG-78 /
REG-79 / REG-83 / REG-84 flag-OFF safety tests, plus the AlfaBot P12/P13
content-safety entries REG-66 / REG-68):

1. **Preset-only messages (P12 — no free text to a child).** The parent can only
   choose a fixed, curated, bilingual, PII-free preset by its `message_key`. There
   is NO free-text input/textarea anywhere in the picker; the component imports
   `CHEER_PRESETS` and never duplicates the strings. The route hard-rejects a
   present-but-unknown `message_key` with 400, applies `DEFAULT_MESSAGE_KEY` only
   when absent, and re-derives the rendered title/body server-side from the catalog.
   A regression that added a text field, or accepted an arbitrary string as the
   message, would breach the P12 boundary (no unfiltered, parent-authored text ever
   reaches a child).

2. **PII-free notification `data` + audit (P13).** The `send_notification` `p_data`
   jsonb and the `audit_logs` row (`parent.child_encouraged`) carry ONLY UUIDs
   (guardian_id / student_id), enums (cheer_type), the preset `message_key`, and the
   catalog-derived bilingual strings — never the guardian's name / email / phone.
   The client component logs nothing. A regression that spread the guardian profile
   into the notification payload or the audit details would breach P13.

3. **Flag-OFF parity (Encourage hidden).** With `ff_parent_encourage_v1` OFF
   (production truth), `<ParentGlanceHome>` mounts NO Encourage affordance and its
   lazy `EncourageButton` `dynamic()` import never resolves into the flag-OFF
   bundle — the parent surface is byte-identical to the Wave C glance home (REG-84).
   The gate is TWO conditions, both required: `flags[PARENT_ENCOURAGE_V1] === true`
   AND `canFetchReport` (guardian-JWT mode). Link-code parents (who would 403 the
   guardian-only route) never see it even with the flag ON. A regression that
   defaulted the flag ON, dropped the guardian condition, or flipped the gate would
   silently expose a new write surface to every guardian (or to unauthorized
   link-code parents).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-85 | `parent_encourage_preset_only_pii_free_flag_off_parity` | Three-layer pin on Wave D. **(a) Preset-only (P12):** opening `<EncourageButton>` reveals exactly one button per `CHEER_PRESETS` entry, each label sourced from the SAME catalog module the backend reads (fails if the strings fork), and there is NO `<input>` / `<textarea>` / `<form>` anywhere; the route returns 400 for a present-but-unknown `message_key`, applies the DEFAULT only when absent, and never accepts free text. **(b) PII-free `data`/audit (P13):** selecting a preset POSTs EXACTLY `{ student_id, message_key }` (the preset's catalog key) with the parent's Supabase Bearer JWT, omitting the header when there's no session; on the server the `send_notification` `p_data` and the `parent.child_encouraged` audit row carry only UUIDs / enums / preset keys / catalog strings — no guardian name / email; the component maps 200 → success, 429 → "already cheered recently", 403 / other non-OK / network throw → a friendly generic error WITHOUT surfacing the raw server text. **(c) Flag-OFF parity:** `<ParentGlanceHome>` HIDES the Encourage button when the flag is ABSENT (prod truth), explicitly `false`, or still loading (`data === undefined`) — even for a guardian-mode parent — and when the flag is ON but the parent is NOT guardian-JWT (`canFetchReport === false`); it SHOWS the button (inside the Quick actions region, wired to the selected child) ONLY when the flag is `true` AND `canFetchReport` is `true`; the empty state mounts no Encourage affordance; and a standalone assertion pins `FLAG_DEFAULTS[PARENT_ENCOURAGE_V1] === false` against a default-flip regression. All copy is bilingual via `isHi` (P7). | `src/__tests__/components/parent/encourage-button.test.tsx` (10 tests: preset-only render + POST contract + response mapping + bilingual), `src/__tests__/components/parent/parent-glance-home.test.tsx` (PART 3 — 7 tests: the flag × guardian gate truth table), `src/__tests__/api/v2/parent/encourage/route.test.ts` (route contract — auth gate, ownership isolation, message_key validation, rate limit, PII-free notify/audit happy path, notify failure), `src/__tests__/api/v2/parent/encourage/cheer-catalog.test.ts` (catalog content-safety + bilingual) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — preset-only picker (P12)::reveals every CHEER_PRESETS title (English) when opened — no duplicated strings`
- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — POST contract::POSTs { student_id, message_key } with the parent Bearer token on preset select`
- `src/__tests__/components/parent/encourage-button.test.tsx::EncourageButton — response mapping::maps 403 → a friendly generic error (no raw server detail surfaced, P13)`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Encourage affordance gate (ff_parent_encourage_v1 × guardian)::SHOWS Encourage ONLY when the flag is ON AND the parent is guardian-JWT`
- `src/__tests__/components/parent/parent-glance-home.test.tsx::ParentGlanceHome — Encourage affordance gate (ff_parent_encourage_v1 × guardian)::HIDES Encourage when the flag is ON but the parent is NOT guardian-JWT (canFetchReport=false)`
- `src/__tests__/api/v2/parent/encourage/route.test.ts::POST /api/v2/parent/encourage — happy path::sends a notification with correct args and records the cheer (200)`

### Invariants covered by this section

- P12 (AI / content safety): preset-only cheers — no free, parent-authored text
  ever reaches a child; unknown `message_key` rejected at the route.
- P13 (data privacy): notification `data` jsonb + `audit_logs.details` for
  `parent.child_encouraged` carry UUIDs / enums / preset keys only — no PII; client
  surfaces friendly errors, never raw server text.
- P9 (RBAC) — adjacent: route gated by the `child.encourage` permission and a
  guardian↔student link check (cross-guardian isolation; link-code 403).
- Flag-OFF safety (same family as REG-78/REG-79/REG-83/REG-84): the entire Wave D
  write surface is inert with `ff_parent_encourage_v1` OFF — the Encourage button
  is never mounted and its `dynamic()` import never enters the flag-OFF bundle, so
  the parent surface is byte-identical to Wave C.
- P7 (bilingual UI) — adjacent: trigger / picker / success / rate-limit / error
  copy all switch on `isHi`; the catalog ships En + Hi for every preset.

### Notes on test strategy

REG-85 follows the **flag-OFF safety pattern** (REG-78/REG-79/REG-83/REG-84) for
the gate half and the **content-safety contract pattern** (REG-66/REG-68) for the
preset-only / PII-free halves. The component tests mock only two seams — the
Supabase session helper (Bearer token) and global `fetch` (network) — and assert
on user-visible structure (preset labels, the absence of any free-text affordance,
the exact POST body, the mapped success/rate-limit/error copy), never on internals.
The gate tests stub the lazy `EncourageButton` (as the existing suite stubs
`WeeklyReport`) and assert purely on whether `<ParentGlanceHome>` MOUNTS it across
the full flag × `canFetchReport` truth table, with each test resetting the mocked
flag state so the assertions are independent of ordering. The route + catalog tests
(already present) pin the server-side P12/P13 boundary. The whole set needs no
Supabase fixture and runs green in CI today.

### Catalog total

Consumer Minimalism Wave D adds REG-85 (parent → child Encourage preset-only +
PII-free + flag-OFF parity).

**Total: 53 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile parity — /v2 parent endpoints (Phase 2 Wave 2.4) — REG-89

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.4. Wave 2.2/2.3
(REG-87/REG-88) covered the STUDENT-facing `/v2` surface. Wave 2.4 adds the first
two PARENT-facing `/v2` BFF endpoints so the Flutter parent screens consume the
SAME contract as the web parent portal:

  - `GET /v2/parent/children` (`src/app/api/v2/parent/children/route.ts`) — the
    guardian's linked children, reusing `listChildrenForGuardian`.
  - `GET /v2/parent/glance?student_id=<uuid>` (`src/app/api/v2/parent/glance/route.ts`)
    — at-a-glance view for one linked child, reusing the `parent-portal` Edge
    Function `get_child_dashboard` action (the SAME payload the web
    `ParentGlanceHome` consumes; no aggregation duplicated).

Both are THIN reads — no new aggregation, no learner-state write. The load-bearing
property is the **P13 guardian-link boundary**: a parent must see ONLY children
they are linked to, with name + grade (P5 string) + the child's own learning stats
and NOTHING else (no guardian email/phone, no `schoolId`, no raw upstream error
text). The boundary is enforced twice on `glance` (defense-in-depth): the route's
own `getGuardianByAuthUserId` → `isGuardianLinkedToStudent(guardian.id, student_id)`
check (403 + NO upstream fetch when unlinked), AND the forwarded Bearer JWT re-runs
the Edge Function's own JWT-bound guardian+link guard. `children` projects the
relationship-domain rows down to `{ student_id, name, grade }` — the `schoolId` /
`linkId` / `linkStatus` fields the domain returns never cross the wire.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-89 | `v2_parent_children_glance_guardian_link_boundary_and_envelope` | Two-route pin on the Wave 2.4 parent `/v2` surface. **(a) RBAC + ownership (P9):** both routes call `authorizeRequest(_, 'child.view_progress')` and return its `errorResponse` verbatim (401/403) BEFORE any guardian/domain read; a caller with no guardian profile is 403 (`NO_GUARDIAN_PROFILE`), and `glance` validates `student_id` is a UUID (400 `VALIDATION_ERROR`) before resolving the guardian. **(b) Guardian-link boundary (P13 cross-guardian isolation):** `glance` returns 403 `NOT_LINKED` and performs NO upstream `fetch` when `isGuardianLinkedToStudent` is false (proven with a fetch spy asserted never-called); an Edge-Function 403 maps to 403 `NOT_LINKED`; `children` reuses `listChildrenForGuardian(authUserId)` so a guardian only ever sees their own links. **(c) P5/P13 projection:** `children` items are EXACTLY `{ student_id, name, grade }` with `grade` a string — the payload carries no `email` / `phone` / `schoolId`; `glance` returns `child: { student_id, name, grade:string }` + snapshot/moments/weeklyActivity derived from the EXISTING Edge fields, with no guardian PII anywhere; both responses round-trip through the registered `ParentChildrenResponse` / `ParentGlanceResponse` Zod schemas (`{ success, data }` envelope, `schemaVersion: 1`). **(d) No raw error text (P13):** a domain-read failure → 500 and an upstream Edge failure / unreachable fetch → 502, with the raw upstream/DB message never surfaced to the client; an Edge error-payload → 404 `NO_DATA`. | `src/__tests__/api/v2/parent/children/route.test.ts` (8 tests: auth gate + permission code, no-guardian 403, happy-path name+grade-only P13, empty links, Zod round-trip, 500 no-raw-text), `src/__tests__/api/v2/parent/glance/route.test.ts` (15 tests: auth gate + permission code, UUID validation 400, no-guardian 403, NOT_LINKED 403 + no-fetch, happy-path shaping + P5 grade + P13 no-PII, struggling-child concerns, Zod round-trip, 502/404/403 upstream-failure mapping no-raw-text) | E (unit — runs in CI, no fixture needed) |

### Pinned tests

- `src/__tests__/api/v2/parent/glance/route.test.ts::GET /api/v2/parent/glance — ownership::returns 403 when the guardian is NOT linked to the student (no data fetched)`
- `src/__tests__/api/v2/parent/glance/route.test.ts::GET /api/v2/parent/glance — happy path::shapes the get_child_dashboard payload into snapshot + moments + weeklyActivity`
- `src/__tests__/api/v2/parent/children/route.test.ts::GET /api/v2/parent/children — happy path::returns the linked children in the /v2 envelope, name+grade only (P13)`
- `src/__tests__/api/v2/parent/children/route.test.ts::GET /api/v2/parent/children — failure::returns 500 with no raw error text when the domain read fails`

### Invariants covered by this section

- P13 (data privacy — guardian-link boundary): a parent sees ONLY linked children;
  `glance` enforces the link at the route AND re-enforces via the forwarded-JWT Edge
  Function; the children list is scoped to the caller's own guardian links. No
  guardian PII (email/phone) and no `schoolId` / link metadata crosses the wire; no
  raw upstream/DB error text reaches the client.
- P9 (RBAC enforcement): both routes gated by `child.view_progress`; the auth
  `errorResponse` is returned verbatim before any domain read.
- P5 (grade format): `grade` is a string in both payloads.
- Mobile-parity contract integrity (extends REG-87/REG-88): both responses
  round-trip through the registered `ParentChildrenResponse` / `ParentGlanceResponse`
  Zod schemas the Dart client is generated from — the parent `/v2` surface is now
  covered by the same contract-conformance discipline as the student surface.

### Notes on test strategy

REG-89 follows the same **contract/parity pattern** as REG-87/REG-88 and the
encourage-route test (REG-85): the route tests mock only the seams
(`authorizeRequest`, the identity/relationship domain helpers, and — for `glance` —
global `fetch`) so the REAL projection and link-boundary logic run, and assert on
the observable contract (status, envelope, the EXACT projected fields, the absence
of PII via a `JSON.stringify` negative match, and which seam fired). The unlinked
case is proven by a `fetch` spy asserted never-called, so a regression that fetched
child data before the link check would fail. No Supabase fixture is needed; the
suite runs green in CI today.

### Catalog total

Phase 2 Wave 2.4 (mobile parity via one contract — parent endpoints) adds REG-89
(`/v2/parent/children` + `/v2/parent/glance` guardian-link boundary (P13) +
RBAC (P9) + P5 grade string + `{ success, data }` contract conformance).

**Total: 57 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Phase 2 parent-report-generator Python port (2026-06-09) - REG-102

Port of `supabase/functions/parent-report-generator/index.ts` to Python on
Cloud Run. Bilingual weekly parent report (en/hi). Template path only
(Phase 2.5 will add LLM-narrative variant via MoL). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-102 | `phase_2_parent_report_generator_python_port_stats_and_bilingual_template` | (1) **Wire-shape parity:** WeeklyStats has exactly the 9 TS-defined fields (quizzes_completed, avg_score, xp_earned, time_spent_minutes, topics_mastered, streak, foxy_sessions, subjects_studied, chapters_covered). (2) **Stats math parity:** avg_score rounds; time = (quiz_seconds + foxy_seconds) / 60; topics_mastered threshold is mastery_level >= 0.8 inclusive; chapters dedup via topics.title; missing learning_profile yields 0 xp_earned and 0 streak. (3) **Bilingual template integrity:** period_label is "This week" / "इस सप्ताह"; highlights for high-performer mention quiz count + avg_score + streak in both languages; zero-state highlights returns single placeholder; concerns lists low-score + low-time + zero-streak triggers; suggestion uses student name when provided and falls back to "your child" / "आपके बच्चे" when blank. A regression on any of these ships either malformed wire shape (parent portal can't render) or wrong-language copy (P7 bilingual violation). | `python/tests/unit/test_parent_report_generator_stats.py::test_compute_stats_empty_inputs_returns_zero_counters`, `python/tests/unit/test_parent_report_generator_stats.py::test_compute_stats_topics_mastered_threshold_at_0_8`, `python/tests/unit/test_parent_report_generator_stats.py::test_period_label_en_hi`, `python/tests/unit/test_parent_report_generator_stats.py::test_highlights_zero_state_returns_placeholder`, `python/tests/unit/test_parent_report_generator_stats.py::test_suggestion_uses_fallback_name_when_blank` | E |

### Invariants covered by this section

- P7 (bilingual UI) - REG-102 pins en/hi parity on template copy.
- P12 (AI safety) - N/A; no LLM call in Phase 2 port (template only).
- P13 (data privacy) - Logs only structural counters; never logs the
  report body, student name, or parent identity. JWT-bound guardian
  lookup prevents body.parent_id spoofing (TS line 605 fix preserved).

### Catalog total

Pre-Phase-2-parent-report-generator: 69 entries. Adds REG-102.

**Total: 70 entries.**

## Per-school deal-driven entitlements — precedence, parent→child, unlimited, flag-gated enforcement, super-admin API, RLS (2026-06-15) — REG-147

Source: per-school deal-driven entitlements feature. A school's effective value
for each of 12 catalog entitlement keys is resolved from a precedence chain
(platform override → institution_entitlements deal row → tenant_modules coarse
toggle → catalog plan default → deny). The runtime gate is config-read ALWAYS /
enforce ONLY when `ff_institution_entitlements_v1` is ON (seeded OFF, so shipping
is a zero-behavior change). Ops mints/edits the sparse `institution_entitlements`
deviation rows through a super-admin-only API (service-role writes, full audit);
school admins can READ their own school's entitlements but never write them;
learners have NO access at all (commercial terms, never learner data).

Files under test:
- `src/lib/entitlements/catalog.ts` — the canonical 12-key catalog (5 modules /
  5 features / 2 limits) + `isValidEntitlementKey` + `validateEntitlementValue`.
- `src/lib/entitlements/resolver.ts` — `getResolvedEntitlements` (config-read,
  flag-independent), `isEntitledEnforced` (flag-gated runtime gate), precedence,
  parent→child force-off (Q3), unlimited→999999 mapping (Q6), effective windows.
- `src/app/api/super-admin/entitlements/route.ts` — GET/PUT, super-admin auth,
  sparse upsert/delete, validate-before-write, contract-ownership, per-change
  audit (ids/keys/values only).
- `supabase/migrations/20260615205752_institution_entitlements.sql` (table + RLS)
  and the `20260615205753` flag seed (default OFF).

> **ID note:** REG-146 is the previous entry (SPEC-3 consecutive-wrong
> intervention alert active path, 2026-06-15). REG-147 is the next free id at the
> time this entry was written.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-147 | `institution_entitlements_resolution_and_boundary` | **(1) Precedence (highest first):** for `module.*`, a `platform_module_overrides` force-disable WINS over an institution row + tenant toggle + plan default (`resolved_by='platform_override'`, effective OFF); else an in-window `institution_entitlements` row wins (`'institution_entitlement'`); else a `tenant_modules` coarse toggle wins (`'tenant_module'`); else the catalog plan default (`'plan_default'`); else `'deny'`. A MALFORMED stored value is ignored and resolution falls through to the next layer. **(2) Plan default per category:** a module pulls the MODULE_REGISTRY projection (`module.ai_tutor` ON for school); a feature pulls the hardcoded per-plan grant (free `foxy_interact` OFF, pro ON); a live limit pulls usage.ts (free `foxy_chat_daily` max 5); a `school_subscriptions` read error FAILS CLOSED to the free plan (never escalates tier). **(3) Parent→child (Q3):** when `module.ai_tutor` resolves OFF (via tenant toggle OR platform override), `feature.foxy_interact` is forced OFF with `force_disabled_by_parent:true` and `resolved_by` reflecting the PARENT's source; parent ON → child keeps its own resolution. **(4) Unlimited (Q6):** a stored/default `{max:null}` → `effectiveMax === 999999` (UNLIMITED_SENTINEL); a finite cap passes through unchanged. **(5) Effective window:** an override with `effective_to` in the past OR `effective_from` in the future does NOT apply (falls through to plan default); an in-window override DOES apply. **(6) Flag gate:** `getResolvedEntitlements` reads config REGARDLESS of the flag and never consults it; `isEntitledEnforced` is a NO-OP pass-through (`{allowed:true, enforced:false}`, resolved value still surfaced) when `ff_institution_entitlements_v1` is OFF, and actually ENFORCES (`allowed:false` when not entitled, `allowed:true` when entitled, `enforced:true`) when ON; a positive/unlimited limit cap is allowed, a 0 cap is blocked; an unknown key is a pass-through. **(7) API auth + sparse + validation + audit:** non-super-admin → the `authorizeAdmin('super_admin')` failure response (403) with NO data leak and NO DB write/audit; GET `?school_id` returns the 12-row resolved panel set; PUT `{key,value}` upserts (onConflict `school_id,entitlement_key`), `{key,_delete:true}` deletes that key only, mixed in one request; an INVALID key OR wrong value shape (`{max}` for a toggle, `{enabled}` for a limit) → 400 BEFORE any write (all-or-nothing batch validation); a `contract_id` not belonging to the school → 400, a missing contract → 404, neither writes; every applied change emits exactly one `logAdminAudit` row (`entitlement.override.set`/`.clear`, entityId `school:key`, details carrying `school_id`/`key`/`new_value`/`actor` — ids/keys/values only, NO email/phone/name/password — P13). **(8) RLS + flag-seed (static source-level):** `institution_entitlements` has RLS ENABLED; `service_role` is FOR ALL (only writer, the sole `USING(true)` policy); `school_admin read own` uses the VERBATIM `school_admins.auth_user_id = auth.uid() AND is_active` subquery; `super_admin read all` uses the `user_roles ⋈ roles` + `r.name IN ('admin','super_admin')` + `is_active` + `expires_at` guard; NO student/parent policy anywhere; exactly 3 `CREATE POLICY`, each `DROP POLICY IF EXISTS`-preceded (idempotent); no role-scoped policy uses `USING(true)`; the `20260615205753` seed creates `ff_institution_entitlements_v1` with `is_enabled=false`/rollout 0, canonical `flag_name` shape + `ON CONFLICT (flag_name) DO NOTHING` (REG-125), `to_regclass`-guarded, pure data seed (no schema change). | `src/__tests__/entitlements/catalog.test.ts` (31), `src/__tests__/entitlements/resolver.test.ts` (26), `src/__tests__/api/super-admin/entitlements-route.test.ts` (22), `src/__tests__/entitlements/institution-entitlements-rls.test.ts` (20 — static source-level over both migrations) | U (unit + static source-level; the RLS file lives in `entitlements/`, not `migrations/`, so it runs in the normal lane) |

### Invariants covered by this section

- P8 RLS boundary — REG-147 (`institution_entitlements` has RLS enabled with a
  service-role-only writer; `school_admin` reads its OWN school via the verbatim
  `school_admins.auth_user_id = auth.uid() AND is_active` subquery; `super_admin`
  reads all via the `user_roles ⋈ roles` + active + expiry guard; NO learner
  policy → learners deny by RLS default. The resolver reads config only through
  the server-only `supabaseAdmin`).
- P9 RBAC enforcement — REG-147 (the admin API is gated by
  `authorizeAdmin(request, 'super_admin')`; a non-super-admin gets the 403
  failure response and reaches NO DB write or audit; commercial terms are
  read-only for school admins — only the service-role API writes).
- P13 Data privacy — REG-147 (every entitlement-change audit row carries
  ids/keys/values only — `school_id`/`key`/`old_value`/`new_value`/`actor` — and
  is asserted to contain no email/phone/name/password; the API deny path leaks no
  data).

### Catalog total

Pre-REG-147: 114 entries (through the SPEC-3 intervention-alert active path,
REG-146). The per-school deal-driven entitlements pin adds REG-147: a single
multi-file entry covering the 12-key catalog contract, the 5-layer resolution
precedence (platform → institution → tenant → plan → deny), parent→child
force-off, unlimited→999999 mapping, effective-window honouring, the config-read-
always / enforce-only-when-`ff_institution_entitlements_v1`-ON flag gate, the
super-admin-only GET/PUT API (validate-before-write + contract-ownership +
per-change PII-free audit), and the `institution_entitlements` RLS posture +
default-OFF flag seed (static source-level). 99 tests across 4 files.
**Total catalog: 115 entries (target: 35 — TARGET EXCEEDED).**

**Total: 115 entries.**

## Portal RBAC/SaaS remediation — E2E fix pass: phantom-table repoints + drift-guard off:/on: coverage + cache table + enrollment sync + reports/parents envelope (2026-06-16) — REG-155..REG-159

Source: the E2E fix-pass of `feat/portal-rbac-saas-remediation`. A cluster of
SILENT-FAILURE bugs was fixed — each one returned empty/wrong data with NO error,
so no existing test caught them. The fixes and their guards:

- **Phantom-table repoints (teacher dashboard functional).** The teacher-dashboard
  Edge Function and `/api/teacher/parent-notify` read three tables that never
  existed on disk: `bkt_mastery_state` → `concept_mastery` (BKT p_know/attempts),
  `teacher_class_assignments` → `class_teachers`, `classroom_responses` →
  `classroom_poll_responses`. Every mastery/roster/poll read silently returned
  empty. Two existing tests asserted the PHANTOM names and were REPAIRED to the
  real tables (not weakened) + a negative guard pins that the phantom names can
  never reappear in the Edge source.
- **schoolAdminPermissionCode({off,on}) drift-guard blind spot.** The standing
  RBAC permission-code drift guard only scanned `authorizeRequest`/
  `authorizeSchoolAdmin` literals and NEVER looked inside
  `schoolAdminPermissionCode({ off, on })`. That is exactly why
  `school.manage_api_keys` (the api-keys route `off:` arm, granted to no role)
  403'd every school admin with `ff_school_admin_rbac` OFF, undetected. The guard
  now extracts BOTH the `off:` and `on:` literals and subjects each to the
  "resolves to a granted role" invariant; with migration 20260620000500 seeding +
  granting the code, both arms resolve.
- **parent_weekly_reports cache table (20260620000600).** Created with
  UNIQUE(student_id, guardian_id) + RLS + guardian/service-role policies so the
  parent weekly-report 24h cache (which read a non-existent table → re-invoked
  Claude on every load) becomes real. Additive, idempotent.
- **class_students ↔ class_enrollments sync invariant (20260620000700).**
  Bidirectional backfill + AFTER INSERT triggers (each ON CONFLICT DO NOTHING,
  recursion-safe, SECURITY DEFINER) so a student enrolled via EITHER table appears
  on ALL surfaces. Additive, no new table, no RLS change.
- **reports + parents contract envelope.** `/api/school-admin/reports` now returns
  `{success,data}` on EVERY type (+ a new `student_search` type + `class_avg_score`
  on class_performance); `/api/school-admin/parents` GET now returns
  `{success,data:{links:[{id,status,linked_at,...}]}}`. The pages unwrap
  `json.data` and throw on `!json.success`, so a bare-payload regression would
  render a broken report/list with no error.

> **ID note:** REG-154 is the previous entry (pricing single-source-of-truth,
> 2026-06-16). REG-155..REG-159 are the next free ids (the task brief referenced
> "after REG-154").

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-155 | `teacher_dashboard_phantom_table_repoints` | **THE PHANTOM-TABLE REPOINT GUARD (teacher dashboard functional, P8-adjacent).** **(1) Mastery reads the REAL table:** the teacher-dashboard Edge source contains `from('concept_mastery')` (BKT p_know/attempts verbatim, `select('topic_id, p_know, attempts')`) and the phantom `from('bkt_mastery_state')` appears NOWHERE in the Edge source (negative guard — a refactor cannot regress to the non-existent name that returned empty silently). **(2) parent-notify mastery mock follows the route:** the `/api/teacher/parent-notify` `include_report` mastery line reads `concept_mastery` (the route's `buildReportSummaryLine` reads `from('concept_mastery').select('p_know')`), so the in-memory mock case is keyed on the real table — the mastery-summary assertion now exercises a real read path, not a phantom. **(3) Bloom source unchanged:** the Bloom rollup still reads `quiz_responses.bloom_level` (the answered-question row), untouched by the repoint. **(4) Whole-suite phantom sweep:** no test under `src/__tests__` still references `bkt_mastery_state` / `teacher_class_assignments` / `classroom_responses` as a live table name. | `src/__tests__/functions/teacher-dashboard-mastery-report.test.ts` (repaired: concept_mastery + negative guard), `src/__tests__/api/teacher/parent-notify/route.test.ts` (repaired: mock case `concept_mastery`) | U (unit; Edge source-string inspection + route handler with table-aware in-memory admin mock) |
| REG-156 | `rbac_drift_guard_covers_schoolAdminPermissionCode_off_on` | **THE DRIFT-GUARD off:/on: EXTENSION (P9 — the blind spot that 403'd school admins undetected).** **(1) Extension is live (not a no-op):** the guard now extracts both the `off:` and `on:` string literals from every `schoolAdminPermissionCode({ ... })` call site across `src/app/api/**/route.ts`; both extraction lists are non-empty. **(2) Both arms extracted from a known site:** the api-keys route yields `off: 'school.manage_api_keys'` AND `on: 'institution.manage'` on all three verbs. **(3) Folded into the core scan:** the extracted off/on codes are now members of the main `routeRefs` set the "every route code resolves to a role" assertion scans (`school.manage_api_keys` + `institution.manage` both present). **(4) New invariant enforced:** EVERY off:/on: arm resolves to a granted role (offenders list empty). **(5) The original blind-spot code resolves:** `school.manage_api_keys` is in the canonical universe (seeded + granted by 20260620000500), proving the end-to-end fix. **(6) Would-have-caught proof:** a synthetic `off: 'school.totally_ungranted'` arm is surfaced by the off-extraction regex and is absent from the universe — had it been a real route it would be a hard offender. | `src/__tests__/rbac-permission-code-drift-guard.test.ts` (extended: off:/on: extraction + dedicated coverage describe block) | U (unit; static scan of API route source + canonical permission universe built from migration SQL — no DB) |
| REG-157 | `parent_weekly_reports_cache_table_unique_rls` | **STATIC MIGRATION CANARY (20260620000600 — FIX B).** **(1) Table created idempotently:** `CREATE TABLE IF NOT EXISTS public.parent_weekly_reports`. **(2) Route-shaped columns:** `student_id, guardian_id, report, language, generated_at` all present (the columns the parent-report route reads/upserts). **(3) UNIQUE(student_id, guardian_id):** the constraint the route's `onConflict:'student_id,guardian_id'` upsert needs is present and added via a guarded `IF NOT EXISTS … pg_constraint` block (replay-safe). **(4) RLS enabled IN-MIGRATION (P8):** `ENABLE ROW LEVEL SECURITY` on the new table. **(5) Guardian policies:** SELECT/INSERT/UPDATE policies each scoped via `is_guardian_of(student_id)`, all idempotent (`DROP POLICY IF EXISTS` + CREATE); plus a `service_role` policy (the route's actual supabaseAdmin runtime path). **(6) FK cascade:** `student_id → students` and `guardian_id → guardians` both `ON DELETE CASCADE`. **(7) Additive-only:** no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE (executable SQL, comments stripped). **(8) Route still upserts onConflict student_id,guardian_id** (the constraint must keep matching). | `src/__tests__/contract/portal-rbac-remediation-migration-canaries.test.ts` (FIX B block) | U (static source-level; reads the migration SQL from disk with comments stripped — runs in the normal lane under `contract/`, not the excluded `migrations/` lane) |
| REG-158 | `class_students_class_enrollments_bidirectional_sync` | **STATIC MIGRATION CANARY (20260620000700 — FIX C, enrollment split-brain).** **(1) Backfill BOTH directions:** `class_students → class_enrollments` AND `class_enrollments → class_students`, each `ON CONFLICT (class_id, student_id) DO NOTHING`. **(2) AFTER INSERT trigger each direction:** one `AFTER INSERT ON class_students`, one `AFTER INSERT ON class_enrollments`. **(3) Recursion-safe mirror:** ≥4 `ON CONFLICT (class_id, student_id) DO NOTHING` occurrences (2 backfills + 2 trigger bodies, quoted-or-unquoted columns) — a conflict-skipped zero-row insert fires no row trigger, so the bounce terminates after one hop. **(4) SECURITY DEFINER + pinned search_path** on the mirror functions (a faithful copy of an already-authorized row, no privilege-escalation surface). **(5) Idempotent re-create:** `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`; functions are `CREATE OR REPLACE`. **(6) No new table** (no new RLS posture — operates on the two existing roster tables). **(7) Additive-only:** the ONLY DROPs in executable SQL are trigger/function (re-create) guards — no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE. | `src/__tests__/contract/portal-rbac-remediation-migration-canaries.test.ts` (FIX C block) | U (static source-level; comments stripped before the additive-only scan; normal lane under `contract/`) |
| REG-159 | `school_admin_reports_parents_response_envelope` | **THE REPORTS + PARENTS CONTRACT-ENVELOPE GUARD (silent-failure prevention).** **REPORTS** (`GET /api/school-admin/reports`): authz denial returns the auth `errorResponse` verbatim (no DB); `school_overview` / default / `class_performance` / `student_detail` / `subject_gaps` each return `{success:true, data}`; `class_performance` carries the NEW `class_avg_score` field (alongside backward-compat `avg_score`) and returns `class_avg_score:0` on an empty roster; `student_detail.student.grade` is a STRING (P5); the NEW `student_search` type is ROUTED (not "Unknown report type"), returns `data` as an array of `{id,name,grade,...}`, and short-circuits to `[]` for a <2-char query; an unknown type → 400 `{success:false, error}` (envelope on the error branch too). **PARENTS** (`GET /api/school-admin/parents`): authz denial verbatim; empty school → `{success:true, data:{links:[],total:0}}`; the happy path's `data.links[*]` carries the three load-bearing keys `id` (= `guardian_id:student_id`), `status`, `linked_at` PLUS the display fields (`parent_name`/`student_name`/`student_grade` string P5); `linked_at` falls back to `created_at` when the dedicated column is null; `page`/`limit` echoed in the envelope. **Also pinned:** REG-159 repairs the legacy `school-admin-api.test.ts` school_overview assertion that read the OLD flat shape — now reads `body.data.total_students` (repaired to the new envelope, not weakened). | `src/__tests__/api/school-admin/reports-envelope-contract.test.ts` (10), `src/__tests__/api/school-admin/parents-list-contract.test.ts` (5), `src/__tests__/school-admin-api.test.ts` (repaired school_overview case) | U (unit; real GET handlers with school-admin-auth + per-table chainable in-memory admin clients mocked) |

### Invariants covered by this section

- P8 RLS boundary — REG-157 (parent_weekly_reports ships RLS + guardian/service-role
  policies in the same migration that creates the table); REG-158 (the roster sync
  triggers are SECURITY DEFINER faithful copies that touch no RLS posture and add
  no new table); REG-155 (the teacher-dashboard mastery/roster reads now hit the
  real RLS-backed tables instead of phantom names that returned empty).
- P9 RBAC enforcement — REG-156 (the drift guard now covers the
  `schoolAdminPermissionCode({off,on})` extraction path — the exact blind spot
  that let `school.manage_api_keys`, granted to no role, 403 every school admin
  with the flag OFF; both arms now must resolve to a granted role).
- P5 Grade format — REG-159 (`student_detail` + `student_search` + parents `links`
  carry `grade` as a STRING through the new envelopes).
- Operational integrity / additive-migration safety — REG-157/REG-158 (both new
  migrations are additive + idempotent: no DROP TABLE/COLUMN/TRUNCATE/DELETE/UPDATE;
  the only DROPs are trigger/function/policy re-create guards).
- Silent-failure / contract-drift prevention — REG-155 (phantom-table reads that
  returned empty with no error), REG-159 (bare-payload regressions on the reports/
  parents endpoints would render broken surfaces with no error).

### Catalog total

Pre-REG-155: 122 entries (through the pricing single-source-of-truth guard,
REG-154). The E2E fix pass adds REG-155..REG-159: phantom-table repoints (teacher
dashboard functional), schoolAdminPermissionCode drift-guard off:/on: coverage +
school.manage_api_keys, parent_weekly_reports cache table, class_students↔
class_enrollments sync invariant, and the reports/parents response-envelope
contract (5 entries across 6 test files; 2 existing tests repaired to the correct
tables/envelope, not weakened). **Total catalog: 127 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 127 entries.**

## Engineering-Audit Cycle 7 — Parent Portal (P8/P9/P13) — 2026-06-29

Source: engineering-audit program, Cycle 7 (Parent Portal). The parent portal is
the cross-role data boundary with the highest blast radius: a parent must reach
exactly their own linked child's data and nothing else. The audit examined three
attack surfaces. (1) The link-code path: parent link codes flow into PostgREST
`.or()` filters at three sites (request-otp, accept-invite, parent-portal login),
so an unsanitized code is a filter-injection vector that could widen the
`students` query past the intended row. (2) The legacy Edge `parent_login` path:
no per-IP throttle in front of the DB lookup invited link-code brute-forcing.
(3) Parent self-service + child-data routes: the profile PATCH and every
child-scoped read must gate on a real permission AND a canonical guardian-link
boundary, never trust a body-supplied id, and never leak a child payload to an
unlinked parent. This cycle adds three entries pinning each surface.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-188 | `parent_link_code_filter_injection` | P8/P13: `isValidLinkCode` (`^[A-Z0-9]{4,12}$`, TS `src/lib/sanitize.ts` + byte-identical Deno twin `supabase/functions/_shared/link-code.ts`) rejects PostgREST filter-injection payloads (`A,deleted_at.is.null`, `*`, `.eq.`, commas/parens/colons/quotes/whitespace/lowercase/out-of-width) at all 3 link-code `.or()` sites — request-otp (→ enumeration-safe silentSuccess), accept-invite (→ 409), parent-portal handleParentLogin (→ 200 no-match); raw payload never reaches the students query; valid 6/8-char hex still flows. | `src/__tests__/security/parent-link-code-injection.test.ts`, `src/__tests__/api/parent/pp2-filter-injection-routes.test.ts` | E |
| REG-189 | `parent_login_ip_rate_limit` | P9/P13: the legacy Edge `parent_login` path enforces a per-IP server-side rate limit (5/hour via createRateLimiter) BEFORE the DB lookup → 429 + Retry-After on exceed (brute-force defense; consent-posture change remains USER-GATED); the rate-limit warn log carries limit/window/retry only — no IP/code/email/phone (P13). | `src/__tests__/edge-functions/parent-login-rate-limit.test.ts` | E |
| REG-190 | `parent_profile_authz_and_child_data_boundary` | P9/P13/P8: `PATCH /api/parent/profile` gates on `authorizeRequest('profile.update_own')` (already-granted parent permission) + self-scoped to auth.uid() (body id/guardian_id cannot retarget — no IDOR); every parent child-data route (9 enumerated: children/[student_id]/{chat,export,erasure-status,request-erasure}, report, billing, calendar, v2/parent/{glance,encourage}) consults a canonical guardian-link boundary + authorizeRequest and denies an unlinked parent 403 with no child payload. | `src/__tests__/api/parent/profile-auth-gate.test.ts`, `src/__tests__/api/parent/pp5-unlinked-deny.test.ts` | E |

### Invariants covered by this section

- P8 (RLS boundary — sanitized link codes cannot widen the `students` `.or()`
  query past the intended row at any of the 3 link-code sites; every parent
  child-data route consults a canonical guardian-link boundary so an unlinked
  parent's query never returns another family's child)
- P9 (RBAC enforcement — `PATCH /api/parent/profile` gates on the already-granted
  `profile.update_own` permission and self-scopes to `auth.uid()` so a body-supplied
  id/guardian_id cannot retarget another parent; the legacy Edge `parent_login`
  path enforces a per-IP rate limit before the DB lookup; every child-data route
  pairs the guardian-link boundary with `authorizeRequest`)
- P13 (data privacy — no child payload on any unlinked-parent deny path; the
  parent_login rate-limit warn log carries limit/window/retry only, never
  IP/code/email/phone; link-code request-otp denies are enumeration-safe
  silentSuccess)

### Catalog total

Pre-REG-188: 154 entries (through Engineering-Audit Cycle 6's REG-186/REG-187
admin route auth-gate sweep + bare-name log canary). Engineering-Audit Cycle 7
adds REG-188 (parent link-code filter-injection rejection across all 3 `.or()`
sites — TS + byte-identical Deno twin), REG-189 (parent_login per-IP rate limit
before the DB lookup, PII-free warn log), and REG-190 (parent profile PATCH
authz + self-scope + the 9-route child-data guardian-link boundary, no payload
on any unlinked deny).
**Total catalog: 157 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — PP-1/3: Parent-Link Consent / Option B (P8/P13/P15) — 2026-06-29

The Cycle-7 audit found that the legacy Edge `parent_login` action granted an
`active` / `is_verified:true` guardian↔child link from a bare link-code match —
a link code alone (e.g. leaked to a tuition centre) opened a child's data with
NO child consent (P8 parent↔child boundary + P13 privacy). CEO-approved Option B
FLIPS the posture: `parent_login` now creates a `pending` link that the STUDENT
must approve (via the existing `/api/parent/approve-link` flow) before any data
is exposed; the parent sees a bilingual "awaiting approval" screen and the
student is notified PII-free.

Because this is an intentional posture FLIP, there is NO characterization
tripwire of the old "active-without-approval" behaviour — REG-199 pins the NEW
consent invariant across all four surfaces (consent posture, no-data-while-
pending, the anti-orphan dashboard-wiring guard, and the still-green
student-owned approve-link flip from REG-117). The unit lane has no live DB, so
the Edge posture is pinned as comment-stripped static-source assertions (same
convention as `parent-login-rate-limit.test.ts` / REG-198), the no-access
boundary is pinned via the `ACTIVE_GUARDIAN_LINK_STATUSES` constant + the
relationship.ts / `canAccessStudent` filters, the anti-orphan guard is a
source pin on `StudentOSDashboard` (import + `<PendingLinkApproval` JSX), and a
light jsdom render test proves the wired card itself works (self-hides on empty,
shows Approve/Reject + parent name when pending, bilingual).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-199 | `parent_login_creates_pending_consent_link` | P8/P13/P15: `parent_login` creates a `pending` (not `active`) guardian_student_links row via ON CONFLICT upsert (no downgrade of an approved link), grants ZERO child data while pending (ACTIVE_GUARDIAN_LINK_STATUSES excludes pending; canAccessStudent denies), responds `pending_approval` with no session, and notifies the student PII-free via send_notification; the student approval surface (`PendingLinkApproval`) is wired into the live `StudentOSDashboard` (anti-orphan guard) and the student-owned approve-link flip (REG-117) is intact. Closes the Cycle-7 finding that a link code alone granted an active guardian link without consent | `src/__tests__/edge-functions/parent-login-consent.test.ts`, `src/__tests__/components/pending-link-approval.test.tsx` (companion render) | U | P8,P13,P15 |

### Invariants covered by this section

- P8 (parent↔child boundary) — REG-199 pins that `handleParentLogin` writes
  `status:'pending'`/`is_verified:false` on both branches (never
  `active`/`true`, never a downgrade), and that `ACTIVE_GUARDIAN_LINK_STATUSES`
  excludes `pending` so the relationship reads + `canAccessStudent`'s parent
  branch grant no child data until the student approves.
- P13 (data privacy) — REG-199 pins that the pending response carries only
  `student_name` + `link_id` (no session/guardian/grade/stats) and the student
  notification carries no guardian name/email/phone (only the opaque link_id).
- P15 (onboarding integrity) — REG-199's anti-orphan guard pins that the live
  `StudentOSDashboard` IMPORTS and RENDERS `PendingLinkApproval`, so the consent
  request can never silently un-wire and dead-end the parent at "pending".

### Catalog total

Pre-PP-1/3: 165 entries (through Remediation SAO-1/SAO-5's REG-198 super-admin
PII-export tiering). Remediation PP-1/3 adds REG-199 (parent-link consent /
Option B — the P8/P13/P15 consent-posture + no-data-while-pending + anti-orphan
dashboard-wiring pins).
**Total catalog: 166 entries (target: 35 — TARGET EXCEEDED).**

---

