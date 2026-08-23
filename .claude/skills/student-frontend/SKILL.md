---
name: student-frontend
description: Frontend skill for the Alfanumrik student surface -- student IA (Today / Learn / Practice / Progress / More), mobile-first responsive shells, the UI system and four-state interaction patterns, adaptive-learning journeys, Foxy integration, data boundaries, WCAG 2.2 AA + performance budgets, and testing / production DoD. Complements student-dashboard-design, which owns the /dashboard card system specifically.
user-invocable: false
---

# Skill: Student Frontend (UI / UX / IA)

**Ownership is directional, not overlapping:** this skill owns platform-wide student IA, navigation, shells, responsive behavior, accessibility, performance budgets, testing, and student-experience principles -- everything a student surface needs *except* the `/dashboard` route's card system. `student-dashboard-design` owns `/dashboard` card recipes, card-level learner-data semantics, and dashboard-specific defects -- read that skill for `/dashboard` work and do not restate its Motion, token, accessibility-floor, or defect tables here. This skill may defer to it; it does not duplicate it.

**Owning agent**: frontend. **assessment** owns every learner-data semantic (mastery/XP/scores/streaks/predictions) and any adaptive-loop rule the UI presents; **quality** reviews token/a11y/bundle conformance; **testing** adds coverage.

Full implementation detail (design tokens, full breakpoint tables, motion mechanics, the full accessibility checklist, the data-boundary table, testing/DoD/audit-severity, known gaps) lives in `references/implementation-detail.md` -- read it before writing or changing frontend code, auditing a repository, or declaring work complete. This file states the principles and the IA; that file states the mechanics.

## Student experience principles (non-negotiable)

- **Mobile IA is Today / Learn / Practice / Progress / More** -- four core tabs + a center Foxy FAB + a More sheet. See the nav model below; never add a fifth flat tab.
- **Current approved learning scope is Mathematics and Science** (grades 6-10: math+science; grades 11-12: math/physics/chemistry/biology, destreamed -- see `cbse-learning-rules` for the exact, currently-enforced catalogue). Do not build UI that assumes a broader subject list is servable today.
- **No fabricated or placeholder metrics.** Every student-facing number is a permitted re-presentation of engine-decided state (count/bucket/group/sum), never a client-side recomputation of mastery/accuracy/predicted marks, and never a number with no live data source behind it.
- **WCAG 2.2 AA** is the accessibility floor for every student-facing component.
- **Performance budgets**: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1, in addition to the bundle-size caps in `references/implementation-detail.md`.
- **Technology supports teachers; it does not replace them.** Never design or copy a surface that implies a teacher is unnecessary.

## 1. Student IA -- the navigation model

The canonical source is `packages/ui/src/navigation/nav-config.ts`. The student navigates through four core tabs + one center FAB + one "More" sheet -- not five flat tabs:

| Slot | Route | Label (en / hi) | Source |
|---|---|---|---|
| 1 | `/today` | Today / Aaj | `CORE_TABS[0]` -- carries the streak badge |
| 2 | `/learn` | Learn / Seekhein | `CORE_TABS[1]` |
| -- | `/foxy` | Foxy | `CORE_TABS[2]` -- center FAB, not a flat tab (`isFab: true`) |
| 4 | `/progress` | Progress / Pragati | `CORE_TABS[3]` |
| 5 | "More" | More | the More-sheet overflow |
| -> | `/practice` | Practice Center | `MORE_ITEMS`, flag-gated by `ff_practice_os_v1` -- design against the five-destination mental model (Today/Learn/Practice/Progress/More); implement through the flag-gated More entry until launch |

Nav laws: one destination = one name = one icon across every projection (tabs/More/sidebar); Foxy is the FAB, never a fifth flat tab; "More" is a modal dialog (`role="dialog"`, scrim, Escape closes, focus to first button on open), not a tab; active state uses segment-boundary matching so `/learn/math/1` lights up `/learn` but `/me` never lights up `/memory`; flag-gated items hide until their flag is true; grade-gated items (`/pyq`, `/mock-exam`, grade 9+) render a lock + "Grade N+" chip, never a disabled link; `/dashboard` is NOT a core tab -- it lives in More ("Home") and the sidebar, so never design a card or CTA assuming a student lands on `/dashboard` daily.

Student pages live under `apps/host/src/app/(student)/`; `(student)/layout.tsx` is a pass-through (no chrome). `/today`, `/foxy`, `/dive`, `/synthesis` are top-level routes. Navigation chrome mounts once at root via `packages/ui/src/navigation/GlobalAppLayout.tsx` -- never hand-roll a nav list in a page; read from `nav-config`.

## 2. Mobile-first responsive shells

The shell stack, bottom-up: `GlobalAppLayout` (mounted once at root, lazy-loads sidebar/bottom-nav via `next/dynamic({ssr:false})` so nav code stays out of the shared first-paint bundle) -> `RoleShell` (the one semantic `<main>` -- never mount a second one) -> `AppShell` (the responsive grid primitive: `mobile`/`rail`/`split` variants).

Breakpoints are CSS/token-driven, not Tailwind-breakpoint-driven: under 768px is a single content column with bottom nav visible; 768px+ adds a sticky rail; 1024px+ adds an aside and suppresses the bottom nav. The only sanctioned Tailwind breakpoint idioms are `md:hidden`/`lg:hidden` on mobile dupes of rail/aside content, and `md:p-6` hero padding -- getting the breakpoint wrong here has previously double-rendered content in production. Full breakpoint table and CSS specifics: `references/implementation-detail.md`.

Design mobile-first: 360px phone first (no rail/aside), then verify 768px (rail) and 1024px+ (aside). Never hardcode pixel column widths -- use the grid + tokens.

## 3. UI system, interaction, and the four states

Component libraries: generic cards/buttons/skeletons use `packages/ui/src/ui/primitives/*`. `PremiumCard` (`wonder-blocks.tsx`) is legacy -- existing render sites elsewhere in the app are inherited surface area, not precedent; never add a new usage. OS-dashboard-style section shells use the token-based card recipe documented in `student-dashboard-design` -- never `primitives/Card` or `PremiumCard` for those.

Design tokens, the full standing-warnings list (`dark:` is dead CSS, light-only app, tokens-over-hex), and the complete Motion policy (CSS-only default, conditional `framer-motion` use, the `tailwindcss-animate` registration hazard, reduced-motion handling) are in `references/implementation-detail.md` -- read it before touching visual styling or adding any animation.

Every data-bound region implements four states at minimum -- loading (shape-matched skeleton, `aria-busy`), loaded, empty (dashed panel + CTA, and **may only blame the student when the emptiness is attributable to the student** -- a platform content gap is not the child's inaction), and error (bilingual, `role="status"`, never the raw error string). Gate every reassuring empty state on `loaded && !error` so a failed or in-flight fetch never masquerades as good news.

Interaction rules: one primary action per screen; resume-first interruption recovery on `/today`; touch targets >= 44px (48 preferred); `focus-visible:ring-2` on every interactive element; quiet-by-default (a card with nothing to say self-hides); no dark patterns (no fake urgency, no guilt copy, no streak shaming -- a broken streak offers a comeback path, never shame); recognition over recall (translate engine acronyms like IRT/SRS/CME/BKT into plain reasons: "Review due", "Build this prerequisite").

## 4. Adaptive-learning and recommendation journeys

`/today` fetches an ordered queue from `GET /api/v2/today` and renders it -- **the resolver decides "what next"; the UI only projects the resolved action.** Never invent a recommendation client-side. Deep links come from the resolver's own `action.url`, never hand-built. Copy is i18n-keyed, never hardcoded.

Frontend **re-presents** engine-decided learner state; it does not compute it. Counting/bucketing/grouping an engine-decided value is fine (e.g. counting how many topics are in a bucket); recomputing mastery, accuracy, or predicted marks from raw components (`mastery_probability`, `p_know`, `attempts`, `effective_mastery`, a confidence band) requires assessment sign-off. The full rule, the `masteryPercent()` vs `accuracyPercent()` trap, the `due_for_review` precedence rule, and the `N=5` denominator-visibility floor are documented in `student-dashboard-design` -> Learner Data Semantics, and that section binds every student surface, not only `/dashboard`. If a new recommendation card touches any of those fields, hand off to assessment before writing copy.

Weekly Curiosity Dive (`/dive`) and Monthly Synthesis (`/synthesis`) are separate Pedagogy v2 surfaces with their own forgiving streak object (missing one week does not reset it; four consecutive does) -- never conflate with the daily streak, never re-derive either client-side.

## 5. Foxy integration without clutter

The only sanctioned embed is `FoxyPanelLauncher` (`packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx`) -- a compact CTA until tapped, then a dynamically-imported panel. **Never import the Foxy panel statically from a page** (enforced by a structural regression test). The `/foxy` route itself is the center FAB and is edge-to-edge full screen with nav chrome suppressed. On any embed surface, the launcher is a secondary action -- it must never outrank the page's primary CTA. Daily usage limits are enforced per plan (P12); surface "limit reached" as a clear bilingual state, never a raw API error. Never send `studentId`/`studentName` to console, Sentry, or analytics with a Foxy event -- log event names and non-identifying counts only.

## 6. Data boundaries and rendering

The root layout is a server component; student pages are effectively all client components (`'use client'`) because they depend on `useAuth`/`isHi`/SWR -- split heavy loaded-state presentations behind `next/dynamic({ssr:false})`. Remote state goes through SWR only (no Redux/Zustand), with per-student cache keys (P13). API routes are thin proxies -- student pages never reach into the database directly. `packages/lib` owns every render DTO; `packages/ui` renders; pages fetch. No PII in client logs, Sentry, or analytics payloads. Any API response-shape change flags **mobile** in the review chain. Full data-boundary table (SWR defaults, cache headers, flag-gate conventions): `references/implementation-detail.md`.

## 7. Accessibility and performance

WCAG 2.2 AA is the floor for every new or touched component -- the full checklist (bilingual `aria-label`, `aria-busy`, `role="status"`/`alert`, `role="progressbar"` with values, `aria-hidden` on decoration, focus management, touch-target size, colour-not-sole-meaning, reduced motion, one `h1` per screen) is in `references/implementation-detail.md`; walk it line by line on every change.

Performance budgets: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1, plus the bundle-size caps enforced in CI (`CAP_SHARED_KB`/`CAP_PAGE_KB`/`CAP_MIDDLEWARE_KB` -- read current values via `grep -nE '^const CAP_' scripts/check-bundle-size.mjs`, never quote a remembered number). A page carrying pre-existing debt against its recorded baseline has zero free headroom -- check before assuming you have room to add bytes.

## 8. Testing and Definition of Done

Unit/integration tests (Vitest) live under `apps/host/src/__tests__/`, `packages/*/src/__tests__/`; E2E specs (Playwright) live in `e2e/`. Add a regression-catalog entry when a change touches a P-invariant -- never claim "regression tests pass" for tests that don't exist. The full Production Definition-of-Done checklist and the S0-S4 audit-severity table for grading anything wrong on the student surface are in `references/implementation-detail.md` -- walk the DoD checklist before declaring any student feature complete.

## Rejection conditions

Reject (or hand off) a change that: recomputes mastery/accuracy/scores/predictions client-side, or hardcodes an XP/level/score number (-> assessment); renders a student-facing percentage without a visible denominator, or under the assessment-owned minimum sample size (-> assessment); ships an empty state that blames the student for a possible platform content gap; ships a user-facing string with no Hindi counterpart (P7); authors a `dark:` class, adds a new `PremiumCard` usage, or imports the Foxy panel statically into a page; imports `framer-motion` (or any heavy dependency) into the root layout or `AuthContext` import graph; breaches a page's recorded bundle-size ratchet baseline without CEO approval; omits any of the four states, or renders raw error text / PII to a student; has an interactive target under 44px; changes an API response shape without flagging mobile; duplicates `student-dashboard-design`'s Motion/token/accessibility-floor/defect tables instead of deferring to them.

## Review chain

frontend implements -> **assessment** reviews whenever learner data or an adaptive-loop rule is surfaced -> **quality** reviews token/a11y/bundle/IA conformance -> **testing** adds coverage and E2E. Invariants in scope: P7 (bilingual), P8 (RLS boundary), P10 (bundle budget), P12 (AI safety, for Foxy surfaces), P13 (privacy), P14 (chain completeness). API-shape changes additionally require **backend** and flag **mobile**.
