# Student IA Consolidation — Design & Approval Track

**Status:** PROPOSAL — awaiting CEO approval. Nothing in this document has been built.
**Date:** 2026-08-05
**Owner:** ops (document) — implementation spans frontend, backend, mobile, assessment, testing, quality, architect
**Scope:** Presentation layer only. No scoring, XP, anti-cheat, or payment logic is touched (see §3.5).
**Approval gates:** §3. **Cost/risk:** §6. **Open questions:** §8.

---

## 0. Executive summary

The student surface has 35 live top-level routes, two rival navigation
taxonomies that describe the same app differently, and two rival component
libraries whose names deliberately collide. This is not a design failure — it is
a *process* failure with a specific, repeating signature: roughly seven
redesign programs each shipped their ADDITIVE half (a new route, a new hub, a
new component set) and left their CONSOLIDATING half (the deletion, the
redirect, the migration) behind a default-OFF feature flag that was never
flipped. Exactly one consolidation in the entire history completed end-to-end:
`/rewards` → `/leaderboard`.

The proposal is to finish the consolidations that were already designed and
paid for, rather than start an eighth program. Concretely: collapse the 28
in-scope student routes to 12 canonical URLs behind four tabs plus the Foxy
FAB, adopt four IA laws, and promote one button system. The single most
valuable piece of work — a unified parameterized quiz runtime — is not new: it
is literally the flag `ff_unified_quiz_v1`, documented in-source as "not yet
built."

What needs CEO sign-off is narrow and specific: permanent 301 redirects (SEO +
existing deep links), Flutter deep-link parity for already-installed APKs, and
confirmation that this is presentation-only. Phase 0 (three already-executing
bugfixes) needs no approval and can proceed today.

---

## 1. Problem statement and root cause

### 1.1 Root cause — the "additive half only" failure mode

`packages/lib/src/flags/registries/consumer.ts` is the confession. Each block
in that file is a redesign program; nearly every one is default-OFF, and
several are documented as never having been built at all:

| Flag | Declared at | Documented state |
|---|---|---|
| `ff_today_home_v1` | `consumer.ts:69` | Wave A. OFF → `/today` `router.replace('/dashboard')`; `/api/v2/today` returns 404 |
| `ff_unified_quiz_v1` | `consumer.ts:70` | **"single parameterized quiz runtime (Wave B, not yet built)"** — `consumer.ts:57` |
| `ff_parent_glance_v1` | `consumer.ts:71` | "Wave C, not yet built" (`consumer.ts:58`) |
| `ff_parent_unified_auth_v1` | `consumer.ts:72` | "Wave D, not yet built" (`consumer.ts:59`) |
| `ff_study_menu_v2` | `consumer.ts:48` | Default OFF; legacy 4-item "Review" group still renders (`consumer.ts:40-45`) |
| `ff_practice_os_v1` | `consumer.ts:182` | "Not yet seeded by any migration" → resolves OFF; `/practice` `notFound()`s |
| `ff_revision_os_v1` | `consumer.ts:163` | "Not yet seeded by any migration" → resolves OFF; `/revision` `notFound()`s |
| `ff_test_os_v1` | `consumer.ts:205` | "Not yet seeded by any migration" → resolves OFF; `/exam-briefing` `notFound()`s |
| `ff_me_v2` | referenced `nav-config.ts:38, :84` | Gates `/me`, an "additive presentation layer over /profile" |
| `ff_student_os_v1` | `consumer.ts:133` | "Not yet seeded by any migration" |
| `ff_subjects_os_v1` | `consumer.ts:147` | "Not yet seeded by any migration" |
| `ff_editorial_atlas_v1` (+4 role canaries) | `consumer.ts:25-31` | Default false |

Read the pattern in the source comments themselves. `consumer.ts:173-179`
describes the Practice Center as "additive; no existing surface changes."
`consumer.ts:192-195` describes the briefing hub as "additive; no existing
exam/quiz/results surface changes." `nav-config.ts:34-37` describes `/me` as
"Additive presentation layer over /profile." Each statement was true and
responsible in isolation. Summed over seven programs, "additive, no existing
surface changes" *is* the disease: every program added a destination and none
removed one.

The one counter-example proves it can be done. `apps/host/src/app/(student)/rewards/page.tsx:1-15`
is a real server-side `redirect('/leaderboard')` whose comment explicitly notes
it *used to* re-export the leaderboard component and therefore "served
leaderboard content at the `/rewards` URL" — a duplicate surface, correctly
killed. The Study Menu v2 301s in `apps/host/next.config.js:153-155` are the
other half-success: the redirects shipped, but `consumer.ts:40-45` records that
the flag that would retire the legacy menu is still OFF.

**Countermeasure (non-negotiable, see §6.1):** a consolidation phase may not
ship unless its deletion half ships in the same PR.

### 1.2 Symptom 1 — two rival nav taxonomies (three, counting the dead one)

`packages/ui/src/navigation/nav-config.ts` defines two independent
descriptions of the same application:

- `SIDEBAR_SECTIONS` (`nav-config.ts:44-89`) — 18 items across 4 sections
  (Home 3, Practice 7, Study 4, Account 4).
- `MORE_ITEMS` (`nav-config.ts:14-42`) — 17 items, flat, no sections.

A third, `STUDENT_NAV_ITEMS` (`packages/ui/src/responsive/MobileNav.tsx:214-220`),
is exported with the docstring "Default 5-item nav config for the student
portal" and is rendered nowhere.

Verified inconsistencies:

| Problem | Evidence |
|---|---|
| One route, three names | `/progress` is "Me" (tab, `nav-config.ts:11`), "My Progress" (sidebar, `nav-config.ts:50`), "Progress" (dead nav, `MobileNav.tsx:218`) |
| Three things called "Me" | tab "Me" → `/progress` (`:11`); "Me (New)" → `/me` (`:38`, `:84`); "Profile" → `/profile` (`:33`, `:80`) |
| "Practice" used 3 ways in one section | Section titled "Practice" (`:54`) containing "Practice Center" → `/practice` (`:57`) and "Practice" → `/quiz` (`:58`) |
| One route, two icons | `/progress` is 🙂 in tabs (`:11`) and 📈 in sidebar (`:50`); `/dashboard` is ☀️/🏠 depending on surface (`:8` vs `:15`, `:48`) |
| Nav asymmetry | `/quiz` appears only in the sidebar (`:58`); `/leaderboard` (`:26`) and `/notifications` (`:39`) only in the More sheet; `/learn` and `/today` only in the bottom tabs (`:9`, `:8`) |
| Desktop/mobile gate divergence | `DesktopSidebar.tsx:19` hard-codes `const [hasUpcomingExam] = useState(true)` — never set, never derived — so "Exam Sprint" (`requiresUpcomingExam: true`, `:32`/`:74`) **always** renders on desktop while being genuinely exam-gated on mobile |
| Dead badge code | `MobileBottomNav.tsx:177` renders a due-count badge for `item.href === '/review'`; `DesktopSidebar.tsx:129` computes `const isReview = item.href === '/review'`. `/review` is in neither `CORE_TABS`, `MORE_ITEMS`, nor `SIDEBAR_SECTIONS`, and has no page (`apps/host/src/app/review/` contains only `error.tsx` + `layout.tsx`) — it is a permanent 301 (`next.config.js:153`). The badge can never render. |

### 1.3 Symptom 2 — duplicate paths to one destination

`/review` is a `permanent: true` 301 to `/refresh?tab=flashcards`
(`next.config.js:153`), yet four live UI surfaces still link *to the redirect*
rather than the destination: `packages/ui/src/dashboard/FocusDashboard.tsx:148`
and `:185`, `packages/ui/src/dashboard/QuickActions.tsx:20`,
`packages/ui/src/dashboard/sections/QuickActionsSection.tsx:37`, plus a
`router.push('/review')` at
`apps/host/src/app/(student)/exam-prep/page.tsx:634`. The same destination is
presented under three different names — "Revise" (`QuickActions.tsx:20`),
"Refresh" (`nav-config.ts:28`, `:71`), and the Study-Menu-v2 flashcards tab.

Mechanically verified link-site counts (live UI only, `__tests__` excluded;
command in §9):

| Destination | Distinct live link sites |
|---|---|
| `/dashboard` | 51 |
| `/quiz` | 30 |
| `/foxy` | 23 |
| `/learn` | 12 |
| `/refresh` | 2 (plus every `/review` link above, arriving via 301) |

These counts span all portals and include redirect sources, so they are an
upper bound on *maintenance surface*, not a literal "ways a student can reach
it from home." The precise per-surface tap-count walk (previously estimated at
~45-60 tap targets on the mobile dashboard, ~75 with the More sheet open) was
**not** independently re-derived today and is carried here as an estimate, not
a verified metric. The verified structural fact is sufficient for the decision:
`/dashboard` and `/quiz` each have dozens of independent link sites, so any
route change is a dozens-of-call-sites edit, not a one-line edit.

`/dashboard` and `/today` are both "home." `/today` currently
`router.replace('/dashboard')`s when `ff_today_home_v1` is OFF
(`apps/host/src/app/today/page.tsx:6-8`), so the platform ships two home
implementations and serves one.

### 1.4 Symptom 3 — two rival component libraries

`packages/ui/src/ui/index.ts:12-21` states the position plainly: the canonical
Phase-2 primitive library under `@alfanumrik/ui/ui/primitives` has names that
**"intentionally collide with the legacy set (Button, Card, Badge, …)"**, so it
is exposed under a `primitives` namespace "rather than clobbering the legacy
root names," pending a migration that would promote it to the root barrel
"once a page migrates off Wonder Blocks."

That migration has barely started. Verified:

- **4 separate `MasteryRing` implementations**: `packages/ui/src/cosmic/MasteryRing.tsx:34`,
  `packages/ui/src/landing/v3/MotionPrimitives.tsx:137`,
  `packages/ui/src/ui/primitives/ProgressRing.tsx:161`,
  `packages/ui/src/ui/wonder-blocks.tsx:887`.
- **2 `Button` systems**: legacy `wonder-blocks.tsx` re-exported at the root
  (`ui/index.ts:24`) vs `primitives` (`ui/index.ts:25`).
- **Adoption:** 1,538 raw `<button` occurrences across 478 `.tsx` files vs 14
  non-test source files importing `ui/primitives` (of which 2 are the barrels
  themselves). Effective app-level adoption: ~12 files.

Consequence: there is no enforceable notion of "the primary action on this
screen," because there is no single button system to enforce it in.

---

## 2. Current-state inventory and the proposed mapping

### 2.1 Full verified student route inventory (35 live top-level destinations)

Derived from `find apps/host/src/app -name page.tsx` (§9).

**`(student)` route group — 16 live + 1 redirect:**
`/assignments`, `/dashboard`, `/exam-prep`, `/exams` (+ `/exams/mock`,
`/exams/mock/[paperId]`, `/exams/mock/[paperId]/results`), `/leaderboard`,
`/learn` (+ `/learn/[subject]/[chapter]`, `/learn/foxy-test`), `/library`,
`/mock-exam` (+ `/mock-exam/results`), `/practice` (+ `/practice/exam`,
`/practice/exam/mock`), `/profile`, `/progress` (+ `/progress/dashboard`),
`/pyq`, `/quiz` (+ `/quiz/ncert`), `/reports`, `/revision`, `/simulations`,
and `/rewards` → 301 to `/leaderboard`.

**Root-level student-facing — 19 live + 1 redirect-only:**
`/today`, `/refresh`, `/dive`, `/synthesis`, `/hpc`, `/me`, `/settings`,
`/notifications`, `/support`, `/help`, `/billing`, `/stem-centre`,
`/challenge`, `/diagnostic`, `/tests`, `/tutor`, `/scan`, `/foxy`,
`/exam-briefing`, and `/review` → 301 to `/refresh?tab=flashcards` (no
`page.tsx`).

> **Correction to the brief.** The consolidation was scoped as "28 student
> routes." 28 is the count of **in-scope** routes named in §2.2, not the size
> of the surface. The verified live surface is **35** top-level destinations
> (plus 2 redirect-only URLs). Seven live routes are explicitly **out of
> scope** and unchanged by this proposal: `/simulations`, `/scan`, `/tutor`,
> `/challenge`, `/help`, `/support`, `/welcome`/`/join` (onboarding, P15 —
> deliberately untouched). Net effect if fully executed: **35 → 19** live
> destinations, of which **12** are the canonical student IA.

### 2.2 Proposed 28 → 12 mapping

Four tabs + Foxy FAB. Every row below is a route that exists today.

| # | Canonical destination | Absorbs (28 in-scope routes) | Disposition of the old URL |
|---|---|---|---|
| 1 | `/today` | `/dashboard`, `/today` | `/dashboard` → 301 `/today` |
| 2 | `/learn` | `/learn`, `/library`, `/refresh`, `/revision`, `/dive`, `/stem-centre` | 301 to `/learn?tab=…` |
| 3 | `/learn/[subject]/[chapter]` | (existing detail route, retained) | unchanged |
| 4 | `/practice` | `/quiz`, `/practice`, `/pyq`, `/mock-exam`, `/exams`, `/exam-prep`, `/exam-briefing`, `/diagnostic`, `/assignments`, `/tests` | 301 to `/practice?mode=…` |
| 5 | `/practice/results/[sessionId]` | `/mock-exam/results`, `/exams/mock/[paperId]/results` | 301 |
| 6 | `/me` | `/me`, `/profile` | `/profile` → 301 `/me` |
| 7 | `/me/progress` | `/progress`, `/progress/dashboard` | 301 |
| 8 | `/me/reports` | `/reports`, `/synthesis`, `/hpc` | 301 |
| 9 | `/me/leaderboard` | `/leaderboard` | 301 |
| 10 | `/me/settings` | `/settings`, `/notifications` | 301 |
| 11 | `/me/billing` | `/billing` | 301 |
| 12 | `/foxy` | `/foxy` (FAB, unchanged) | unchanged |

**Row 4 is the whole programme.** Ten routes collapse into one parameterized
runtime — `/practice?mode={practice,pyq,mock,exam,diagnostic,assignment,sprint}`.
That is precisely the artifact `ff_unified_quiz_v1` was created to gate and
which `consumer.ts:57` records as "not yet built." Rows 1-3 and 6-11 are
navigation and URL work; row 4 is engineering. Sequence accordingly (§5).

### 2.3 The four IA laws

1. **One destination = one name = one icon.** Enforced by a single nav config
   (law 3) plus a test asserting no `href` appears under two labels.
2. **One question per screen.** Each screen answers exactly one user question;
   a screen that answers three is three screens or a tabbed one.
3. **One nav config for all viewports.** `CORE_TABS`, `MORE_ITEMS`,
   `SIDEBAR_SECTIONS`, and `STUDENT_NAV_ITEMS` collapse into one source of
   truth that every viewport projects from. Deletes `STUDENT_NAV_ITEMS`
   outright and removes the `DesktopSidebar.tsx:19` divergence by construction.
4. **No new route without deleting one.** A net-additive student route requires
   explicit CEO approval. This is the mechanical answer to §1.1.

### 2.4 The button system

Five roles: `primary`, `secondary`, `tertiary`, `destructive`, `link`.
**Exactly one `primary` per viewport.** Enforcement, in order of strength:

1. Promote `primitives` to the root barrel (`packages/ui/src/ui/index.ts`),
   retiring the intentional name collision documented at `ui/index.ts:12-21`.
2. ESLint rule banning raw `<button>` in `apps/host/src/app/**` and
   `packages/ui/src/**` (allowlist for the primitive's own implementation).
3. A test asserting ≤1 `primary` per student screen.

Honest cost note: step 2 has a **1,538-occurrence / 478-file** blast radius.
This is a multi-week mechanical migration and is deliberately sequenced last
(Phase 5) and is *independently abandonable* without losing Phases 0-4.

---

## 3. Approval gates — what needs CEO sign-off and why

Phases 0-1 need no approval. Everything below is a decision only the CEO can
make, because each has a cost outside engineering.

### 3.1 GATE A — Permanent 301 redirects (SEO + existing deep links)

**Decision required:** approve issuing `permanent: true` (301) redirects for up
to 16 student URLs (§2.2).

**Why it needs you:** 301 is cached by browsers and intermediaries and is
treated by search engines as a permanent move. It is expensive to reverse —
users who have hit the 301 keep following it from cache even after the config
is reverted. Precedent exists and worked: `next.config.js:153-155` (Study Menu
v2) and `(student)/rewards/page.tsx`.

**Verified blast radius:** `/dashboard` has **51** live link sites and `/quiz`
has **30** (§1.3). Every one must be repointed in the same PR as its redirect,
or the app permanently self-redirects on its own internal navigation — a real
latency and SEO-signal cost, not a theoretical one.

**Options:** (a) 301 as proposed; (b) 302 temporary for one release, then 301
after a bake period — safer, reversible, costs one extra release cycle;
(c) keep old URLs live as thin re-exports — rejected, that is exactly the
duplicate-surface pattern `/rewards` was fixed to remove.
**Recommendation: (b).**

### 3.2 GATE B — Mobile / Flutter deep-link parity (already-installed APKs)

**Decision required:** accept the old-APK degradation described below, or fund
a forced-upgrade gate before the route changes ship.

**Verified facts.** `mobile/lib/core/router/app_router.dart` declares its own
GoRouter paths — `/today` (`:191`), `/learn` (`:196`), `/quiz` (`:247`),
`/progress` (`:269`), `/leaderboard` (`:274`), `/settings` (`:279`),
`/library` (`:311`), `/refresh` (`:343`), `/assignments` (`:355`), `/exams`
(`:371`), `/dive` (`:411`), `/synthesis` (`:424`), `/hpc` (`:430`), `/pyq`
(`:326`), `/diagnostic` (`:335`), and more. Web `next.config.js` redirects do
**not** apply to these — they are in-app routes.

The coupling is the server-emitted deep link.
`mobile/lib/ui/screens/today/today_deeplink.dart` is explicit: *"The server
emits WEB routes in `deepLink.route` … this is the SINGLE place that web →
mobile route translation happens."* If `/api/v2/today` starts emitting
`/practice?mode=pyq`, an old APK's `resolveMobileRoute` will not match any
branch.

**The good news, verified:** the resolver's fallback is
`return '/today';` — *"Unknown / web-only route — land on the Today home
rather than a 404."* So old APKs **do not crash**. **The bad news:** they
silently navigate to the wrong place. A student tapping "Continue your PYQ
practice" lands on Today with no error. Silent mis-navigation is harder to
detect than a crash and will not appear in Sentry.

**Options:** (a) ship web-first, accept silent mis-navigation for old APKs
until natural upgrade; (b) ship a mobile release that widens
`resolveMobileRoute` to understand the new route shapes **before** the server
emits them (the resolver is one file — this is cheap and is the standard
expand-then-contract sequencing); (c) version the deep-link contract so the
server emits old-shape routes to old clients.
**Recommendation: (b), and it is a hard prerequisite, not a follow-up.**

### 3.3 GATE C — RBAC / permission implications

**Assessment: no RBAC change is required, and none is proposed.** Verified:

- Student page routes are **not** middleware-gated. `apps/host/src/proxy.ts:1226-1233`
  documents the removed Layer 0.9 and lists the STUDENT_PROTECTED routes
  ("documented here for reference; **enforcement is client-side**") — including
  `/dashboard`, `/quiz`, `/progress`, `/review`. So renaming student page
  routes does not touch a server-side authorization boundary.
- The pinned `scripts/route-access-manifest.json` artifact (ratcheted under
  REG-339, "390 entries === 390 route files on disk") covers
  `apps/host/src/app/api/**/route.ts`. This proposal is page-level; the
  manifest is affected **only** if API routes are added or removed. The
  unified quiz runtime (Phase 4) may consolidate API routes — **if it does,
  the manifest and its ratchet must be updated in the same PR**, and architect
  review is mandatory.

**What the CEO is signing off on here is a negative:** confirmation that "no
RBAC change" is the intent, so that any phase which *does* turn out to need one
must come back for approval rather than proceed.

### 3.4 GATE D — Feature flags and the audit trail

Each phase gets its own flag (§5). Per the ops rejection conditions, every flag
state change must be written to the audit trail via the existing super-admin
feature-flag path. Flags that gate a *student-visible destination* also need a
seeded migration — note that `ff_practice_os_v1`, `ff_revision_os_v1`,
`ff_test_os_v1`, `ff_student_os_v1`, and `ff_subjects_os_v1` are all documented
in `consumer.ts` as **"not yet seeded by any migration."** Reusing an unseeded
flag name without seeding it means the phase can never be turned on from the
admin panel. Architect owns the seed migrations.

### 3.5 GATE E — Confirmation that P1-P6 are NOT touched

**This is a presentation-layer change.** Explicitly unchanged:

| Invariant | Status under this proposal |
|---|---|
| P1 Score accuracy — `Math.round((correct/total)*100)` | **Untouched.** No change to `submitQuizResults()`, `QuizResults.tsx`, or `atomic_quiz_profile_update()`. |
| P2 XP economy — constants in `packages/lib/src/xp-rules.ts` | **Untouched.** No XP constant read or written. |
| P3 Anti-cheat — 3s/question, all-same-answer, response count | **Untouched.** The unified runtime (Phase 4) *reuses* the existing quiz engine's checks; it does not reimplement them. |
| P4 Atomic submission via RPC | **Untouched.** Same RPC, same single transaction. |
| P5 Grade format (strings) | **Untouched.** Nav grade gates already use `gradeMin` numerics against `parseInt` of a string grade (`nav-config.ts:96-105`, `DesktopSidebar.tsx:21`) — this proposal does not change that contract. |
| P6 Question quality | **Untouched.** No change to question selection, validation, or the question bank. |
| P7 Bilingual UI | **In scope and load-bearing.** Every nav label carries `labelHi`; the consolidated config must preserve Hi/En parity for all 12 destinations. Frontend + testing own this. |
| P10 Bundle budget | **Must be measured, not assumed.** Consolidation should reduce total route count but Phase 4 creates one large parameterized route. Gate 4 applies; caps read from `scripts/check-bundle-size.mjs`. |
| P13 Data privacy | No new data surfaces. No PII in any new analytics event. |
| P15 Onboarding integrity | **Deliberately out of scope.** `/welcome`, `/join`, `/onboarding`, and the auth callbacks are untouched. |

**The single riskiest place this promise could break is Phase 4.** If the
"unified runtime" is implemented as a *rewrite* rather than a *parameterization
of the existing engine*, P1-P4 move from "untouched" to "reimplemented," and
this ceases to be a presentation-layer change. §5 makes non-rewrite a gate
condition, and assessment holds a veto.

---

## 4. P14 review chains required, per phase

Per `.claude/skills/review-chains/SKILL.md` and the constitution's chain matrix.

| Phase | Making agent | Mandatory reviewers | Trigger |
|---|---|---|---|
| 0 — bugfixes | frontend | testing, quality | Presentation-only defect fixes |
| 1 — nav unification | frontend | **ops**, testing, quality | "Super-admin pages / nav config" → frontend must be reviewed by ops + testing; P7 bilingual parity → testing |
| 2 — link repointing | frontend | testing, quality | High call-site count; no behavior change |
| 3 — component system | frontend | quality, testing | Lint rule + barrel promotion is repo-wide |
| 4 — unified quiz runtime | frontend + backend | **assessment (veto)**, architect, testing, quality, **mobile** | Touches the quiz surface → assessment must confirm P1-P6 untouched; mobile must confirm contract parity |
| 5 — route 301s | architect (config) + frontend | **ops**, **mobile**, backend, testing, quality | Deployment config → architect makes, ops + testing review; deep-link contract → mobile |

Cross-cutting, every phase: **testing** after every change, **quality** before
every commit (Gates 1-6 of the release-gates skill).

**Assessment sign-off is required and non-waivable for Phase 4.** Per the ops
boundary rules, a learner-facing metric or scoring surface cannot change
without assessment validating the definition. Assessment's specific question to
answer: *"is the unified runtime a parameterization of the existing engine, or
a reimplementation?"* If reimplementation, Phase 4 is rejected and returns to
design.

---

## 5. Phased rollout — flags, ordering, rollback

Ordered least → most risky. Each phase has an independent flag and can be
abandoned without blocking the next, **except** the §6.1 rule: a consolidation
phase may not ship without its deletion half.

### Phase 0 — Bugfixes (ALREADY EXECUTING — no approval needed)
- Dashboard double-render; mastery-ring overlap; dead `/answer-checker` CTA at
  `packages/ui/src/dashboard/os/BoardScoreWidget.tsx:584` (verified: no
  `apps/host/src/app/answer-checker/` route exists — the link 404s).
- **Flag:** none. **Rollback:** git revert. **Risk:** minimal.
- **Approval: NOT REQUIRED** (bug fixes within existing behavior).

### Phase 1 — Nav config unification (`ff_student_ia_nav_v1`, seeded OFF)
- Collapse `CORE_TABS` / `MORE_ITEMS` / `SIDEBAR_SECTIONS` into one config;
  delete `STUDENT_NAV_ITEMS` (`MobileNav.tsx:214-220`); delete the dead
  `/review` badge branches (`MobileBottomNav.tsx:177`, `DesktopSidebar.tsx:129`);
  derive `hasUpcomingExam` instead of hard-coding it (`DesktopSidebar.tsx:19`).
- **No URLs change.** Names and icons only.
- **Deletion half (must ship together):** `STUDENT_NAV_ITEMS`, both dead
  `/review` badge branches, the hard-coded `useState(true)`.
- **Rollback:** flag OFF → old configs render. Requires keeping both configs
  for one release — accepted, and the ONLY phase where dual-config is allowed.
- **Risk:** low. **Approval: not required** (no URL, no data, no invariant).

### Phase 2 — Link repointing (no flag)
- Repoint the 4 live `/review` link sites to `/refresh?tab=flashcards`
  (`FocusDashboard.tsx:148,:185`, `QuickActions.tsx:20`,
  `QuickActionsSection.tsx:37`, `exam-prep/page.tsx:634`). Removes a 301 hop
  from live internal navigation.
- **Rollback:** git revert. **Risk:** low. **Approval: not required.**

### Phase 3 — Component system (`ff_ia_primitives_root_v1` for the barrel swap)
- Promote `primitives` to the root barrel; add the ESLint raw-`<button>` ban
  with a ratcheted allowlist; add the ≤1-primary-per-screen test; collapse the
  4 `MasteryRing` implementations to 1.
- **Cost, stated honestly:** 1,538 occurrences / 478 files. Multi-week. Do it
  as a ratchet (record the current count, fail CI if it rises) rather than a
  big-bang migration.
- **Rollback:** flag OFF restores the legacy root barrel. **Risk:** medium
  (visual regression breadth). **Approval: not required**, but it is a real
  budget line the CEO should see before it starts.

### Phase 4 — Unified quiz runtime (`ff_unified_quiz_v1` — the existing flag)
- Build what `consumer.ts:57` says was never built: one parameterized runtime
  behind `/practice?mode=…` absorbing the 10 routes in §2.2 row 4.
- **Hard gate:** must be a parameterization of the existing quiz engine.
  Assessment holds a veto (§4). P1-P4 must be demonstrably untouched.
- **Deletion half:** the absorbed route files are deleted in the same PR the
  flag reaches 100%.
- **Rollback:** flag OFF → the 10 legacy routes serve unchanged. This is the
  strongest rollback posture of any phase and is the reason this phase is
  ordered before the 301s.
- **Risk:** HIGH — largest engineering scope, touches the quiz surface.
- **Approval: REQUIRED** (Gate E confirmation; assessment sign-off).

### Phase 5 — Route 301s (`ff_student_ia_routes_v1` + `next.config.js`)
- Issue the redirects in §2.2. **Last**, deliberately: a 301 is the only step
  in this plan that is expensive to reverse.
- **Prerequisite:** Gate B option (b) — the mobile `resolveMobileRoute` widening
  must be **shipped and adopted** first.
- **Rollback:** remove the redirect entries and redeploy — but browser/CDN 301
  caches persist. Effective rollback window is short. Recommend 302 for one
  release (Gate A option b) before promoting to 301.
- **Risk:** HIGH (irreversible-ish, SEO, deep links).
- **Approval: REQUIRED** (Gate A + Gate B).

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **"Additive half only" recurrence** — the failure mode that created this. A phase ships its new surface, the deletion is deferred, and we end with an 8th taxonomy. | **High** (7/7 historical precedent) | **Severe** — actively worse than doing nothing | **Countermeasure: a consolidation phase MAY NOT SHIP unless its deletion half ships in the same PR.** Encoded as IA law 4 and as a per-phase "Deletion half" line in §5. Quality rejects any phase PR whose deletion half is missing. |
| R2 | Phase 4 becomes a rewrite, silently moving P1-P6 into scope | Medium | Severe (invariant breach) | Assessment veto (§4); explicit non-rewrite gate condition; regression pins REG-373/374 (§7) |
| R3 | Old-APK silent mis-navigation after route changes | **High if Gate B option (a)** | Medium — invisible in Sentry, degrades trust | Gate B option (b): ship the mobile resolver widening first. Verified fallback is `/today`, not a crash. |
| R4 | 301s cached, rollback ineffective | Medium | High | Gate A option (b): 302 for one release, bake, then promote |
| R5 | Dozens of internal links left pointing at redirects | **High** (already true today — 4 live `/review` links) | Medium (latency, SEO signal) | Phase 2 does this first, before any new redirect exists; add a test asserting no live `href` targets a `next.config.js` redirect source |
| R6 | Bilingual (P7) parity lost while merging 3 nav configs into 1 | Medium | High (invariant) | Testing pins Hi/En parity for all 12 destinations (REG-372) |
| R7 | Phase 3 visual regression across 478 files | Medium | Medium | Ratchet, not big-bang; flag-gated barrel swap |
| R8 | Bundle budget (P10) regression from one large parameterized route | Medium | Medium | Gate 4; `next/dynamic` split as already done for `TodayHomeV2` (`today/page.tsx:38-40`) |
| R9 | Phase 4 consolidates API routes, breaking the pinned route-access manifest | Medium | Medium | Architect review mandatory; manifest + ratchet updated in the same PR (§3.3) |
| R10 | Unseeded flags reused, phase cannot be enabled from admin | Medium | Low | Gate D: architect seeds every gating flag via migration before the phase ships |
| R11 | Scope creep into onboarding (P15) | Low | Severe | `/welcome`, `/join`, `/onboarding`, auth callbacks explicitly out of scope (§2.1, §3.5) |

---

## 7. Proposed regression-catalog entries

`.claude/regression/00-header.md` is authoritative. When this spec was first
drafted it read **344 entries, latest REG-344**, and this section proposed
REG-345..REG-351.

**Renumbered twice on 2026-08-05 (orchestrator decisions).** First: testing's
four Phase 0 regression tests — implemented and green — took REG-345..348, so
these proposals shifted to REG-349..355. Then upstream PR #1465 ("Foxy
North-Star: 7-commit program") landed and consumed **REG-345 through REG-366**,
colliding with both. Final assignment: testing's four Phase 0 tests
(`student_os_inline_breakpoint_parity`, `mastery_ring_label_fits_ring`,
`no_dead_internal_links`, `foxy_mastery_ring_no_shrink`) now hold
**REG-367..REG-370**, and the proposals below hold **REG-371..REG-377**.
Next free id after this section is **REG-378**.

Implemented-and-shipped takes precedence over proposed-and-unapproved, and this
spec defers id assignment to testing in the first place. These remain
*proposals* — no shard is edited by this document.

| Proposed # | Test name | Asserts | Suggested shard |
|---|---|---|---|
| REG-371 | `student_nav_single_source` | IA laws 1 + 3: exactly ONE exported student nav config; no `href` appears under two different labels or two different icons across any viewport projection; `STUDENT_NAV_ITEMS` is ABSENT; no nav item's `href` is a `next.config.js` redirect source. Turns any reintroduced rival taxonomy red. | `15-cross-cutting.md` |
| REG-372 | `student_nav_bilingual_parity` | P7: every destination in the consolidated config carries a non-empty `label` AND `labelHi`, with `labelHi` containing Devanagari; no destination regresses to English-only. | `15-cross-cutting.md` |
| REG-373 | `unified_quiz_runtime_engine_reuse` | P1/P2/P3/P4: the unified runtime calls the EXISTING scoring/XP/anti-cheat/atomic-submit path — score formula, XP constants sourced from `xp-rules.ts`, the 3 anti-cheat checks, and `atomic_quiz_profile_update()` are reached unchanged; no second implementation of any of the four exists behind `ff_unified_quiz_v1`. This is the pin that makes "presentation-layer only" mechanically true. | `03-quiz-integrity.md` |
| REG-374 | `unified_quiz_mode_parameter_completeness` | Every one of the 10 absorbed routes maps to exactly one `mode` parameter, and each mode resolves to a live runtime configuration — no mode silently falls through to a default. Flag OFF → all 10 legacy routes serve unchanged (rollback posture pinned). | `03-quiz-integrity.md` |
| REG-375 | `student_route_redirect_integrity` | Every retired student URL has a redirect entry, each resolves to a live destination in ≤1 hop, and no redirect chains to another redirect. Complements the Study Menu v2 precedent. | `15-cross-cutting.md` |
| REG-376 | `mobile_deeplink_route_coverage` | Gate B: every `deepLink.route` shape the server can emit is matched by a branch in `resolveMobileRoute` (`mobile/lib/ui/screens/today/today_deeplink.dart`) — the `/today` catch-all is a genuine fallback, never the resolution for a route the server actively emits. | `15-cross-cutting.md` |
| REG-377 | `single_primary_action_per_screen` | The button contract: ≤1 `primary` per student screen; raw `<button>` count does not rise above the recorded ratchet floor; and the `MasteryRing` implementation count is exactly ONE. **Target, not a statement of today: there are currently FOUR** (`packages/ui/src/ui/primitives/ProgressRing.tsx:161`, `packages/ui/src/ui/wonder-blocks.tsx:887`, `packages/ui/src/cosmic/MasteryRing.tsx:34`, `packages/ui/src/landing/v3/MotionPrimitives.tsx:137`), and the `@alfanumrik/ui/ui` barrel root-exports the wonder-blocks one — so this entry can only go green after Phase 3 collapses them, and until then it is a ratchet on the count, not a pass. | `15-cross-cutting.md` |

Testing owns final naming, shard placement, and id assignment at implementation
time (ids may shift again if other work lands first — as the two renumbers
above already demonstrate).

---

## 8. Open questions for the CEO

1. **Gate A — redirect posture.** 301 immediately, or 302 for one release then
   301? (Recommendation: 302 first. Cost: one extra release cycle. Benefit: a
   real rollback window on the only irreversible step in the plan.)
2. **Gate B — mobile sequencing.** Is shipping the Flutter resolver widening
   *before* the web route changes an acceptable hard prerequisite? If not, are
   you accepting silent mis-navigation for already-installed APKs — which will
   not surface in Sentry?
3. **Phase 3 budget.** The component-system migration is a 1,538-occurrence /
   478-file mechanical change. Fund it now, defer it, or drop it? Phases 0-2
   and 4-5 do not depend on it.
4. **Phase 4 scope.** Do you want all 10 routes absorbed in one runtime, or a
   narrower first cut (e.g. `/quiz` + `/practice` + `/pyq` only) to prove the
   parameterization before committing to exams and assignments?
5. **`/simulations`, `/tutor`, `/challenge`, `/lab-notebook`, `/scan`.** These
   are live but outside the proposed IA. Keep as unlinked deep-links, fold into
   Learn, or retire? (They are currently reachable but largely unnavigable —
   the same sediment, one layer down.)
6. **The dormant flags.** Seven programs' flags are still OFF and several are
   unseeded (`ff_student_os_v1`, `ff_subjects_os_v1`, `ff_practice_os_v1`,
   `ff_revision_os_v1`, `ff_test_os_v1`). Do we **formally retire** the ones
   this plan supersedes — deleting their flag constants, routes, and code — as
   part of the deletion halves? Recommendation: yes; otherwise this plan adds
   an 8th layer instead of removing seven.
7. **IA law 4 enforcement.** Do you want "no new student route without deleting
   one" to be an actual CEO approval gate, or an advisory norm? Advisory norms
   are precisely what produced §1.1.

---

## 9. Verification commands

Every count and file:line in this document was produced on 2026-08-05 by:

```bash
# Route inventory
find "apps/host/src/app/(student)" -name page.tsx
ls apps/host/src/app/

# Live link sites per destination (test files excluded)
grep -rn "href=[\"']/quiz[\"']\|href: '/quiz'\|push('/quiz'" \
  apps/host/src packages/ui/src --include=*.tsx --include=*.ts \
  | grep -v "__tests__" | wc -l

# Component-system adoption
grep -ro "<button" apps/host/src packages/ui/src --include=*.tsx | wc -l   # 1538
grep -rln "ui/primitives" apps/host/src packages/ui/src --include=*.tsx --include=*.ts
grep -rn "function MasteryRing" apps/host/src packages/ui/src --include=*.tsx --include=*.ts

# Catalog id
head -12 .claude/regression/00-header.md
```

Two figures in this document are **estimates, not measurements**, and are
labelled as such at their use site: the "~45-60 tap targets on the mobile
dashboard (~75 with the More sheet open)" figure (§1.3), and the "5-7 distinct
nav paths to `/quiz`" framing, which was replaced here with the mechanically
verified 30 live link sites. No other number in this document is inferred.
