---
name: student-frontend
description: Frontend skill for the Alfanumrik student surface — student IA (Today / Learn / Practice / Progress / More), mobile-first responsive shells (AppShell, bottom nav, FAB), the UI system + four-state interaction patterns, adaptive-learning and recommendation journeys, Foxy integration without dashboard clutter, Next.js data boundaries, WCAG 2.2 AA + P10 performance, and testing / audit severity / production DoD. Complements student-dashboard-design, which owns the /dashboard card system.
user-invocable: false
---

# Skill: Student Frontend (UI / UX / IA)

The build rules for every student-facing page and component in Alfanumrik — navigation IA, responsive shells, design tokens, interaction patterns, data boundaries, accessibility, performance, and what "done" means before a student feature ships.

**Owning agent**: frontend. **assessment** owns every learner-data semantic (mastery / XP / scores / streaks / predictions) and any adaptive-loop rule the UI presents; **quality** reviews token/a11y/bundle conformance; **testing** adds coverage. For card-level detail on `/dashboard` specifically, read `student-dashboard-design` (this skill references it; it does not duplicate it).

This skill is grounded in the live tree (verified 2026-08-06). When live code and this file disagree, verify which is newer before trusting either — but a documented rule here wins over an undocumented one-off.

---

## 1. Student IA — the navigation model

### The canonical structure (from `packages/ui/src/navigation/nav-config.ts`)

The student navigates through **four core tabs + one center FAB + one "More" sheet**, not five flat tabs. The product IA you should design against is **Today / Learn / Practice / Progress / More**, where "Practice" resolves to the flag-gated Practice Center:

| Slot | Route | Label (en / hi) | Source |
|---|---|---|---|
| 1 | `/today` | Today / आज ☀️ | `CORE_TABS[0]` (`nav-config.ts:13`) — carries the streak badge |
| 2 | `/learn` | Learn / सीखें 📚 | `CORE_TABS[1]` (`nav-config.ts:14`) |
| — | `/foxy` | Foxy / फॉक्सी 🦊 | `CORE_TABS[2]` (`nav-config.ts:15`) — **center FAB**, not a flat tab (`isFab: true`) |
| 4 | `/progress` | Progress / प्रगति 📈 | `CORE_TABS[3]` (`nav-config.ts:16`) |
| 5 | "More" | More / और ☰ | the More-sheet overflow (`MobileBottomNav.tsx:358-385`) |
| → | `/practice` | Practice Center / अभ्यास केंद्र ⚡ | `MORE_ITEMS` (`nav-config.ts:29`), **flag-gated** by `ff_practice_os_v1` |

Rules that keep this IA honest:

- **One destination = one name = one icon.** This is a standing law (`nav-config.ts:6-11`). A route may appear in multiple nav projections but must wear the same label/icon in each. `/progress` was "Me" in the tabs and "My Progress" in the sidebar; that collision is fixed — do not reintroduce dual naming.
- **Foxy is the FAB.** Never add a fifth flat tab. `isFab` renders the raised 52px gradient button (`MobileBottomNav.tsx:263-303`).
- **"More" is a modal dialog, not a tab.** `role="dialog"` bottom sheet (`MobileBottomNav.tsx:108-117`), scrim behind, Escape closes, focus moves to the first button on open, `aria-expanded` on the trigger. Reuse this exact pattern for any new overflow surface.
- **Flag-gated More items** (`/practice`, `/exam-briefing`, `/revision`, `/me`) hide until their `flagName` is true — `isItemVisibleForFlags` (`nav-config.ts:149-156`). Grade-gated items (`/pyq`, `/mock-exam`, `gradeMin: 9`) render a lock + "Grade N+" chip, not a disabled link (`MobileBottomNav.tsx:125-161`).
- **Active state** uses segment-boundary matching — `isNavItemActive(pathname, href)` (`nav-config.ts:143-147`). `/learn/math/1` lights up `/learn`; `/me` must never light up `/memory` or `/mock-exam`.
- **Desktop sidebar** (`SIDEBAR_SECTIONS`, `nav-config.ts:59-112`) groups Home / Practice / Study / Account. Same name+icon as the mobile projections.
- **`/dashboard` is NOT a core tab.** It lives in More ("Home") and the sidebar Home section. Do not design a card or CTA that assumes the student lands on `/dashboard` daily — `/today` is the home tab.

### Route-group facts

- Student pages live under `apps/host/src/app/(student)/` (Learn, Progress, Practice, Quiz, Exams, Leaderboard, Revision, Exam-prep, Profile, etc.). The `(student)/layout.tsx` is a **pass-through** — it adds no chrome. Navigation chrome is mounted **once at root** by `GlobalAppLayout`.
- `/today`, `/foxy`, `/dive`, `/synthesis` are top-level routes (not under `(student)`).
- `nav-config` is the single source of nav entries; do not hand-roll a nav list in a page.

---

## 2. Mobile-first responsive design

### The shell stack (bottom-up)

1. **`GlobalAppLayout`** (`packages/ui/src/navigation/GlobalAppLayout.tsx`) — mounted once from the root layout. Lazy-loads `DesktopSidebar` + `MobileBottomNav` via `next/dynamic({ ssr: false })` (`:18-25`) so nav code stays out of the shared first-paint bundle. Renders the one persistent `#main-content` skip target (`:105`). Nav is suppressed for `isFocusedFoxy` (`:36`) and marketing/auth/other-portal routes (`:38-66`).
2. **`V3 RoleShell`** (`packages/ui/src/navigation/RoleShell.tsx`) — the canonical semantic `<main className="role-shell__content">` (`:48`). Do not mount a second `<main>`; `AppShell` passes `contentAs="div"` when nested inside it.
3. **`AppShell`** (`packages/ui/src/responsive/AppShell.tsx`) — the responsive grid primitive. Variants `mobile` / `rail` / `split` (`:47`).

### The breakpoint model (CSS-only, token-driven)

| Width | Layout | Owner |
|---|---|---|
| < 768px | single content column; bottom nav visible; one-handed mode available | `globals.css` base `.app-shell-v2` (`:1559-1570`) |
| ≥ 768px | 220px rail appears (`--layout-max-rail`), sticky under the header; bottom nav **hidden when the shell has a rail** | `globals.css:1997-2027` |
| ≥ 1024px | 320px aside appears (`--layout-max-aside`); content capped at `--layout-max-content: min(1240px, 100% - …)`; bottom nav suppressed | `globals.css:2030-2067` + `:948-956` |

Facts that matter:

- **Almost no Tailwind breakpoints.** Responsiveness is delegated to `AppShell` + CSS grid. The only sanctioned breakpoint idioms are `md:hidden` / `lg:hidden` on mobile dupes of rail/aside content (dashboard), and `md:p-6` hero padding. Spacing scales via `--space-fluid-1…12` clamps.
- **Bottom nav behavior:** auto-hides on scroll-down, reappears on scroll-up (rAF-throttled, skipped under `prefers-reduced-motion`) (`MobileBottomNav.tsx:24-47`); `padding-bottom: env(safe-area-inset-bottom)` for notched phones (`:256`); hidden ≥1024 (`globals.css:948-956`); hidden on print (`:1161-1162`).
- **One-handed mode** — phone-only (`AppShell.tsx:192-210`), persisted to `localStorage['alfanumrik:one-hand']`, bilingual `aria-label` + `aria-pressed`. Pulls content into the thumb-comfort zone. Do not remove it on a phone layout.
- **Sticky header compacts on scroll past 24px** (`AppShell.tsx:86,157-169`) to `--shell-header-h-compact` (~44px) — a CSS transition, no JS animation.
- **Safe areas:** `--safe-top` / `--safe-bottom` / `--shell-nav-h-notched` are applied by the shell; children should not re-add their own `env()` paddings.
- **Foxy is the bleed exception:** `bleed` + `className` containing `foxy-shell` drop the rail reservation, the 1240px cap, and the fluid side padding for edge-to-edge chat (`AppShell.tsx:81, AppShell.tsx:134-143`; `globals.css:1591-1634`). **Warning:** `AppShell.tsx:149` branches on `className?.includes('foxy-shell')` to skip compact-on-scroll — renaming a shell class to anything containing `foxy-shell` silently kills the compacting header on that route.
- **Touch floor:** `--tap-comfort: 48px` (`globals.css:1481`); `.touchable--comfort` enforces min 48px. House floor is 44px minimum for any interactive element, 48px preferred.

### Mobile-first authoring rules

1. Design for a 360×640 phone first (bottom nav visible, no rail, no aside), then verify 768 (rail) and 1024+ (aside).
2. Put repeated rail/aside content behind `md:hidden` / `lg:hidden` dupes only when the same data must be visible on both layouts. Getting the breakpoint wrong double-renders content (see the dashboard's prior `lg:hidden`/`xl:hidden` bugs in `student-dashboard-design`).
3. Never hardcode pixel widths for columns — use the grid + tokens.
4. Preserve the single-content-column contract: a card that needs two columns on mobile is wrong, not the shell.

---

## 3. UI system, interaction patterns, complete states

### Design tokens (from `packages/ui/src/globals.css`)

| Group | Tokens (line refs) |
|---|---|
| Surfaces | `--bg #FBF8F4` (`:130`), `--surface-1/2/3` (`:132-134`) |
| Text (AA-verified) | `--text-1 #1A1207`, `--text-2 #4A3F2E`, `--text-3 #6B6053` (`:151-153` — darkened to pass AA on surface-3, `:141-150`) |
| Borders | `--border`, `--border-mid`, `--border-strong` (`:137-139`) |
| Brand | `--orange #E8581C` + `--orange-rgb` (`:46-47`), `--purple`, `--gold`, `--teal`, `--green`, `--red` (`:66-86`) |
| Semantic | `--success/--warning/--info/--danger` (`:98-101`), `--primary/--primary-light/--primary-hover` (`:102-104`) |
| Gamification | `--xp-color`→gold, `--streak-color`→orange, `--level-up`→purple, `--mastery-low/mid/high` (`:109-111,124-126`) |
| Shadows | `--shadow-sm/md/lg/glow` (`:160-163`), `--scrim` (`:171`) |
| Radius | `--radius-sm..2xl` (`:180-184`) |
| CTA gradient | `--btn-primary-from #CB4710` / `--btn-primary-to #C2440F` — AA-safe with `#fff` (`:186-195`) |
| Paired on-surface | `--on-accent`, `--on-surface-inverse`, `--surface-inverse`, `--on-surface-accent` (`:218-251`) — **never bare `#fff` on a decorative surface; use the `--on-*` token for the surface you paint on** |
| Warm channel | `--accent-warm` / `--accent-warm-rgb` / `--accent-warm-strong` (`:57-65`) — stable burnt-orange on **every** surface; use it for Foxy mascot/avatar identity |
| Layout | `--layout-max-*`, `--shell-header-h-compact`, `--safe-*`, `--space-fluid-1…12`, `--tap-comfort` |
| Z-index | `--z-base…--z-skip` ladder (`:203-216`) |
| Fonts | `--font-display` (Sora) for headings/data, `--font-body` (Plus Jakarta Sans) for body (`:7-8`). `--font-serif` (Fraunces) is **marketing-only**. Always pass a mono fallback: `var(--font-mono, ui-monospace, monospace)`. |

Three standing warnings:

1. **`dark:` Tailwind utilities are dead CSS** — `darkMode: ['selector', '[data-theme="dark-disabled-pending-cleanup"]']` and that attribute is never written. Never author a `dark:` class.
2. **The app ships light-only.** `color-scheme: light` is forced in the root layout (`layout.tsx:112`); `data-theme="dark"` is not written in production. Contrast decisions are made against the warm cream surfaces only.
3. **Prefer tokens over raw hex or Tailwind palette classes.** A hex is acceptable only as a `var()` fallback.

### Component libraries

- **Primitives** (`packages/ui/src/ui/primitives/`): canonical `Card` / `CardHeader` / `CardBody` / `CardFooter`, `Button`, `Skeleton`, `EmptyState` — use for generic UI anywhere.
- **Wonder-blocks** (`packages/ui/src/ui/wonder-blocks.tsx`): `StreakBadge` (~`:1051`), `StatRing` (~`:1469`), plus `Skeleton` primitive (~`:1132`). **Two skeleton APIs exist — do not mix them up:** the exported `Skeleton` primitive takes `className` / `width` / `height` / `rounded` / `variant`; the dashboard's `DashboardSkeleton` uses a file-local `Bone` helper with `width` / `height` / `radius` / `className`. Check which one the component you're touching actually imports.
- **`PremiumCard` is legacy.** ~16 live render sites remain outside `/dashboard` (progress, leaderboard, exams pages) — inherited surface area, **not precedent. Do not add new `PremiumCard` usages.**
- **OS section shells** (dashboard-style cards) use the semantic-`<section>` + token recipe from `student-dashboard-design` — never `primitives/Card` as the shell, never `PremiumCard`.

### Interaction patterns

- **One primary action per screen.** The hero owns the primary CTA; nothing else competes for hero weight. Enforced deliberately on `/today` (`TodayHomeV2.tsx:14-16`).
- **Resume-first interruption recovery.** When a session is in progress, the dark "pick up where you left off" hero outranks everything (`TodayHomeV2.tsx:59-118`), and `rank === 1` of the Today queue is the primary CTA.
- **Press feedback:** `active:scale-[0.98]` / `active:scale-95` on touchable rows and FABs.
- **Focus visibility:** every interactive element ships `focus-visible:ring-2` (with `ring-offset-2` where the background is decorative).
- **Quiet by default:** cards with nothing to say self-hide (`PendingLinkApproval`, `ReviewsDueCard`) rather than occupying space.
- **No dark patterns:** no fake urgency, no guilt copy, no infinite-streak shaming. A broken streak offers a comeback path (none ships today — see severity S2 gap below), never shame.
- **Progress is visible and earned:** never fabricate, round up, or "encourage" a number. Every percentage shows its denominator; percentages over < N = 5 observations are suppressed or marked provisional (assessment-owned floor). See `student-dashboard-design` → Learner Data Semantics.

### The four states (mandatory for every data-driven card/screen)

| State | Requirement |
|---|---|
| Loading | Shape-matched skeleton; `<section aria-busy="true">`; bones mirror the loaded layout's proportions |
| Error | Bilingual, `role="status"`, **never the raw error string**, retry where the fetch is cheap |
| Empty | Dashed-border panel + decorative emoji (`aria-hidden`) + headline + sub-line + CTA. **May only blame the student when the emptiness is attributable to the student** — a platform content gap is not the child's inaction |
| Loaded | The real presentation |

- **Anti-pattern:** a failed/in-flight fetch must never masquerade as a positive empty state ("all caught up", "0 topics"). Gate every reassuring empty state on `loaded && !error`. Reference implementation: `RevisionRail.tsx:35-36,80`.
- `/today` is the canonical four-state page: gate skeleton (`today/page.tsx:78-86`), queue loading (`:156-168`), error + retry (`:171-187`), empty + free-practice CTA (`:191-206`), loaded → `TodayHomeV2` (`:209-219`).

### Motion

- **CSS-only motion is the DEFAULT and the preferred approach.** Transitions, reveals, hover/press states, staggers, spinners — CSS. Do not pull in a JS animation runtime to fade a div.
- **`framer-motion` is permitted, conditionally** (CEO-approved 2026-08-09, with the premium UI stack: `lucide-react`, 24 Radix primitives, `class-variance-authority`, `react-hook-form` + `@hookform/resolvers`, `sonner`, `vaul`, `cmdk`, `embla-carousel-react`; all install-only, zero imports as of that date). It supersedes the previous blanket ban. Reserve it for genuinely complex interaction: gesture/drag, shared-layout (`layoutId`) transitions, orchestrated enter/**exit**-on-unmount, spring physics. Anything CSS already does, do in CSS.
- **Never in the shared import graph.** `framer-motion` (and any other heavy premium dep) must **not** be imported into `apps/host/src/app/layout.tsx`, `packages/lib/src/AuthContext.tsx`, or any module either graph pulls in — that puts the cost on all 209 routes at once. Per-surface only.
- **Behind a dynamic boundary** where practical: `next/dynamic(..., { ssr: false })` on the component that uses `framer-motion`, not a static page-level import (same discipline as §8.1).
- **P10 still gates it** — `CAP_SHARED_KB = 289`, `CAP_PAGE_KB = 260` in `scripts/check-bundle-size.mjs`. Read §8 for the current per-page debt reality before assuming you have headroom; you probably do not.
- Reveal stagger: `.os-reveal-card` + `--reveal-i` (`globals.css:~3923-3962`); roadmap nodes stagger by `--stagger-i`.
- Tailwind animation utilities: `float`, `scale-in`, `slide-up`, `fade-in`, `bounce-in`, `level-up`, `xp-burst`, `streak-pulse`, `mastery-fill`, `score-reveal`.
- **`tailwindcss-animate` is installed but deliberately NOT registered** in `apps/host/tailwind.config.js`. Registering it redefines 8 in-use classes — `.duration-150/200/300/500/700/1000`, `.ease-out`, `.ease-in-out` — as `animation-*` longhands emitted **after** `.animate-spin` / `.animate-pulse`, silently retiming existing animations. Anyone registering it owns resolving that collision first.
- **Reduced motion:** global blanket kills all animation under `prefers-reduced-motion` (`globals.css:772-788`). Looping/infinite animations need an explicit `animation: none !important` entry in the kill block (`:779-786`); one-shots are collapsed automatically. `AppShell` reads the media query but intentionally no-ops — CSS owns reduced motion, not JS.

---

## 4. Adaptive-learning and recommendation journeys

### The Today home (the recommendation surface)

- `/today` is gated by `ff_today_home_v1`; when OFF it `router.replace('/dashboard')` (`today/page.tsx:48-60`). When ON it fetches the ordered queue from `GET /api/v2/today` via `useTodayQueue` (`packages/lib/src/today/use-today-queue.ts`) and renders `TodayHomeV2` (code-split, `today/page.tsx:38-40`).
- **Who decides "what next":** `resolveTodayQueue` (the Learner Loop) owns the ordering. `packages/lib/src/today/types.ts` only **projects** a resolved `LearnerAction` into a render DTO (`types.ts:10-22`). The UI never invents a recommendation — it renders the projection.
- **The item taxonomy** (`TodayItemType`, `types.ts:43-54`): `resume_in_progress`, `cold_start_diagnostic`, `teacher_remediation`, `srs_due`, `revise_decayed_topic`, `weak_topic_zpd`, `continue_lesson`, `new_topic`, `weekly_dive_due`, `monthly_synthesis_due`, `practice_weakest`.
- **The envelope** (`TodayResponse`, `types.ts:100-119`): `schemaVersion: 1`, `resolvedAt`, `primary` (= `queue[0]`), `queue`, `meta` (branch / masterySubjectCount / dueReviewCount / practicedToday). `primary.type === 'resume_in_progress'` drives the ResumeHero.
- **Deep links** are parsed from the resolver's `action.url` — never hand-built (`types.ts:13-14`; `deepLinkToHref` in `packages/lib/src/today/copy.ts`). Copy is i18n-keyed, never hardcoded English/Hindi in the DTO (`types.ts:15-16`).
- `estMinutes` is a **presentation badge**, not a timing-model value (`types.ts:17-18`).
- **Weekly Curiosity Dive** (`/dive`), **Monthly Synthesis** (`/synthesis`): separate Pedagogy v2 surfaces with their own forgiving streak object (missing one week does not reset; four consecutive does). Never conflate with the daily streak, never re-derive client-side.
- **Learner-loop fallbacks** for light-touch surfaces: `useLearnerNext` (`swr.tsx:189-207`), `useLearnerActionForToday` (`swr.tsx:272-309`, scheduled→next cascade; the pure `pickActionForToday` at `:259-270` pins the precedence). Endpoints 404 when flags are off → hooks return `null` → render nothing.

### Mastery presentation rules (assessment-owned)

Frontend **re-presents** engine-decided learner state; it does not compute it. Counting/bucketing/grouping engine-decided values is permitted; recomputing mastery, accuracy, or predicted marks from raw components requires assessment sign-off. Full rule + the `masteryPercent()` vs `accuracyPercent()` trap + `due_for_review` precedence + `not_started` exclusion + BoardScore contract live in `student-dashboard-design` → Learner Data Semantics. **That section binds every student surface in this skill, not just `/dashboard`.** If a new recommendation card touches `mastery_probability`, `p_know`, `attempts`/`correct_attempts`, `effective_mastery`, or a confidence band, hand off to assessment before writing copy.

### Recommendations hygiene

1. A recommendation must come from a server-decided signal (queue, learner loop, adaptive interventions) — never from client-side arithmetic on raw mastery rows.
2. Never render a cross-subject aggregate adjacent to a per-subject uncertainty band (mixed denominators read as one fact).
3. Every percentage ships with a visible denominator; < N = 5 is suppressed or marked provisional.
4. Empty/recommendation-missing states must not blame the student for a content/coverage gap.
5. Adaptive-remediation student lanes (Loops A/B/C surfaces) read only through the RLS-scoped server client — no direct table access, and no PII in the render path.

---

## 5. Foxy integration without dashboard clutter

The rule: **a student surface may surface Foxy, but the Foxy chat must never enter first paint and never crowd a page's own primary action.**

- **The only sanctioned embed is `FoxyPanelLauncher`** (`packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx`). It renders a compact CTA button until tapped, then dynamically imports the panel (`ssr:false`, `:25-29`). A regression test (`foxy-panel-no-static-embed.test.ts`) greps host `page.tsx` files and asserts no static `@alfanumrik/ui/foxy-panel/*` import exists. **Never import `FoxyPanel` directly from a page.**
- **Center FAB:** the `/foxy` route is the FAB in the bottom nav (`MobileBottomNav.tsx:263-303`). Do not add a second persistent Foxy entry point on the same viewport.
- **`/foxy` is edge-to-edge full screen** — `GlobalAppLayout` suppresses nav chrome for it (`GlobalAppLayout.tsx:36`), the shell bleeds (`AppShell` `bleed` + `foxy-shell`), body scroll locks via `:has()` (`globals.css:1597-1606`) with a no-`:has()` fallback (`:1608-1615`). The header blur is dropped there to kill scroll flicker (`:1629-1634`).
- **Embedded usage today:** dashboard (slot 2, wrapped in `<div className="my-3 flex justify-start">`, `StudentOSDashboard.tsx:308`), learn, quiz results. On any embed surface the launcher is a secondary action — it must never outrank the page's primary CTA.
- **Modes:** `learn / explain / practice / revise / doubt / homework / explorer` (Pedagogy v2 Wave 2). Daily usage limits are enforced per plan (P12) — surface "limit reached" as a clear bilingual state, never a raw API error.
- **Learner memory transparency:** `/memory` ("What Foxy remembers") is the transparency/erasure surface (`nav-config.ts:53`).
- **P13:** never send `studentId`/`studentName` to console, Sentry, or analytics with Foxy events — log event names and non-identifying counts only.

---

## 6. Next.js architecture and data boundaries

### Rendering model

- **The root layout is a server component** (`apps/host/src/app/layout.tsx`). It wires fonts, metadata, viewport, the skip link, `SWRProvider` → `TenantConfigProvider` → `SchoolProvider` → `AuthProvider` → `CosmicThemeProvider` → `ErrorBoundary` → `GlobalAppLayout` (`:192-221`).
- **Student pages are effectively all client components** (`'use client'`) because they depend on `useAuth`/`isHi`/SWR. Keep them light: split heavy loaded-state presentations behind `next/dynamic` (TodayHomeV2, ConversationManager, FoxyPanel, ContextPanel, FoxyTopBar, InlineSimulation, LoadingState — see `today/page.tsx:38-40`, `foxy/page.tsx:64-80`).
- **No page-local `<main>`:** the skip link targets the persistent `#main-content` in `GlobalAppLayout` (`layout.tsx:173`, `GlobalAppLayout.tsx:105`); `RoleShell` owns the semantic `<main>`. An `AppShell` nested inside it must pass `contentAs="div"`.
- **Language** comes from `AuthContext.isHi` — components read it via props or hooks, never a second context/global. No i18n library; inline ternaries or `const T = {}` label maps; `todayCopy` for Today-queue copy. Technical terms (CBSE, XP, Bloom's, BoardScore™, Foxy, NCERT, PYQ) are not translated.

### Data boundaries (the contract)

| Concern | Rule | Source |
|---|---|---|
| Remote state | SWR only (no Redux/Zustand). Keys are per-student (`studentId` in the key) so different students on one device get separate cache entries (P13). | `swr.tsx` |
| SWR defaults | `DEFAULT_CONFIG` (`swr.tsx:44-57`): `revalidateOnFocus: false`, `revalidateOnReconnect: true`, `dedupingInterval: 10000`, `errorRetryCount: 2`, no retry on 4xx, `keepPreviousData: true` — tuned for Indian mobile networks. Don't override without a stated reason. | `packages/lib/src/swr.tsx` |
| Authed API calls | `authedFetch` (`packages/lib/src/authed-fetch.ts`) — attaches the session; never `supabase-admin` in client code. | P8 |
| API routes are thin proxies | e.g. `/api/board-score` proxies the Supabase Edge Function; `/api/learner/*` resolve server-side. Student pages must not reach into the DB. | P8 / architecture |
| DTO ownership | `packages/lib/src` owns every render DTO (`today/types.ts`, `exams/types.ts`). `packages/ui` renders. Pages fetch. No component reinvents a shape. | |
| Re-present, don't re-compute | Client arithmetic limited to counting/bucketing/grouping/summing engine-decided values. Anything producing a *different* number than the engine = assessment sign-off. | `student-dashboard-design` |
| Privacy | No PII in client logs, Sentry (`beforeSend` redactor), or analytics payloads (P13). | |
| Cache headers | API routes set appropriate caching: 30s private cache for learner-next; CDN `s-maxage=60` for leaderboard. A new student route with a safe public cache should do the same. | `swr.tsx:119,193` |
| Flag gates | Client gates read `useFeatureFlags()`; when a flag is OFF the surface hides (or redirects) rather than erroring. `/today` → `/dashboard`; hooks resolve 404 → `null`. | `today/page.tsx:48-60` |

- **Error boundaries:** pages have page-level error/empty handling. `/dashboard`'s `error.tsx` cannot use `AuthContext` — it sniffs `localStorage['alfanumrik_language'] === 'hi'` (match that pattern in any new error boundary). A caught error must never be logged with the student's name/id attached.
- **API-response-shape changes flag mobile.** Any change to a response shape consumed by the Flutter app requires a mobile sync check (P14 chain).

---

## 7. WCAG 2.2 AA accessibility floor

Run this checklist on **every** new or touched student component. Known gaps are catalogued (see §9) — none is precedent.

- [ ] Bilingual `aria-label`/`aria-labelledby` on the section/dialog where the heading is not self-describing.
- [ ] `aria-busy="true"` on loading shells; `role="status"` (or `alert` for errors) on status/error panels.
- [ ] `role="list"` + `role="listitem"` for repeated rows; don't slap `list`/`listitem` on non-list DOM.
- [ ] `role="progressbar"` + `aria-valuenow/min/max` + bilingual label on any bar/ring/gauge.
- [ ] `aria-hidden="true"` on every decorative emoji, glyph, and pure-presentation element.
- [ ] `focus-visible:ring-2` (+ `ring-offset-2` where needed) on every interactive element; logical focus order; focus moved/managed after sheet/dialog open and after retry/tab switches (gap D9 today — fix if you touch it).
- [ ] Touch target ≥ 44px (48px preferred); never below 44 for a primary control. (WCAG 2.2 2.5.8 minimum is 24px — the house floor is stricter.)
- [ ] Meaning is never colour-only (WCAG 1.4.1) — pair colour with icon + label + number.
- [ ] Contrast via tokens: text uses `--text-1/2/3` (AA-verified against every warm surface, `globals.css:141-153`); white text only on the CTA gradient stops or via `--on-*` tokens (`:186-251`). Verify any custom colour against its actual background — `--text-3` on `--surface-3` is 4.95:1 (just past AA); don't push it darker.
- [ ] No keyboard traps; Escape closes the More sheet (`MobileBottomNav.tsx:54-58`) — match for any new dialog/sheet.
- [ ] Focus never obscured by sticky header/nav — add scroll-margin where a target could land under the compact header.
- [ ] Reduced motion: no looping animation ships without an entry in the reduced-motion kill block (`globals.css:779-786`); one-shots are auto-collapsed by the blanket (`:772-788`).
- [ ] Meaningful page structure: exactly one `h1` per page/screen (the `/dashboard` shell is missing one — D5 — don't copy that).
- [ ] Accessible authentication (WCAG 2.2 3.3.7/3.3.8): no cognitive-test gating beyond what ships today; form errors are announced, not just coloured.

House documentation of a11y intent lives in `globals.css` (contrast rationale, `:141-153,186-251`) and the `student-dashboard-design` accessibility floor. Follow it, don't rewrite it.

---

## 8. Performance standards (P10)

The target is Indian 4G (2–5 Mbps) on low-cost Android. Enforced caps live in `scripts/check-bundle-size.mjs` — read them, don't quote a remembered number (`grep -nE '^const CAP_' scripts/check-bundle-size.mjs`):

- `CAP_SHARED_KB` (authoritative first-load total, layout-chunk-inclusive) — **currently 289 kB**.
- `CAP_PAGE_KB` — **260 kB** per page.
- `CAP_MIDDLEWARE_KB` — **120 kB**.

**Current state, so you are not surprised (2026-08-09):** **101 of 209 routes already exceed `CAP_PAGE_KB`**, worst is **306.1 kB at `/(student)/progress/dashboard`**. The gate passes only because it ratchets each page against its **recorded baseline** — not because pages are under the absolute cap. Practical consequence: a page carrying pre-existing debt has **zero** free headroom; any byte you add to it fails the ratchet even though the cap number looks far away.

House techniques you must keep honest:

1. **Code-split heavy UI** with `next/dynamic({ ssr: false })` — Foxy panel, TodayHomeV2, ConversationManager, ContextPanel, InlineSimulation, nav chrome. A new heavy surface on a page = a dynamic boundary, not a static import.
2. **Animation runtime is opt-in and per-surface, never shared** — CSS-only is the default; `framer-motion` is permitted for genuinely complex interaction behind a `next/dynamic({ ssr: false })` boundary, and must never enter the root-layout / `AuthContext` import graph (see §3).
3. **Self-hosted fonts** via `next/font` (Sora, Plus Jakarta Sans) — no third-party font CDN (`layout.tsx:160-169`).
4. **SWR caching** is the network strategy — instant stale-while-revalidate, 10s dedupe, no focus storms (`swr.tsx:44-57`).
5. **Nav mounts once at root** and persists across navigations — no per-route nav re-mount (`GlobalAppLayout.tsx:94-99`).
6. **`next/image`** for raster assets; decorative glyphs are text, not images.
7. **Lazy non-critical chrome** (`LayoutDeferredChrome`: consent banner, maintenance banner, offline indicator, PostHog init) — keep it out of the critical path.
8. Respect the reduced-motion + CSS-owns-layout discipline so paints stay cheap.

If a page can't stay under `CAP_PAGE_KB`, split the loaded state out of first paint — do not raise the cap without a CEO-approved rationale (see the cap-raise history in the product constitution).

---

## 9. Testing, audit severity, and known gaps

### Testing

- **Unit/integration:** Vitest. Test files live under `apps/host/src/__tests__/`, `packages/*/src/__tests__/`. Component tests cover four states, bilingual copy, SWR hooks, pure helpers (`pickActionForToday` is exported for exactly this).
- **E2E:** Playwright specs in `e2e/`. Dashboard/Today/Foxy flows are covered there — new journeys get a spec.
- **Structural guards:** `foxy-panel-no-static-embed.test.ts` (no static Foxy panel imports), bundle-size check in CI, regression catalog in `.claude/regression/00-header.md`.
- **Always add a test that pins an invariant** when the change touches one (score accuracy P1, XP economy P2, bilingual P7, bundle P10, privacy P13, RLS P8). Do not claim "regression tests pass" for tests that don't exist.

### Audit severity (grading anything wrong on the student surface)

| Severity | Meaning | Examples | Ships? |
|---|---|---|---|
| **S0 Blocker** | Violates a P-invariant (P1–P15) or leaks PII; wrong learner-facing number that misleads | Recomputing mastery/accuracy in the UI, hardcoded XP value, raw error string or student PII to a student, bundle over cap, static Foxy embed | No — fix or revert before merge |
| **S1 Critical** | Wrong learner-facing state, broken core interaction, blocking a11y failure | Four states missing (no error/empty), keyboard trap, empty state on a failed fetch, missing denominator on a percentage, no Hindi for a user string | No |
| **S2 Major** | WCAG AA failure on content or target size, missing state polish, conformance drift | `< 44px` control, colour-only meaning, `dark:` class added, new `PremiumCard`, no comeback surface for a broken streak (documented gap D4) | Only with a tracked ticket + review chain sign-off |
| **S3 Minor** | Quality/polish; reduced-motion gap on a loop; focus-order nicety | Slightly soft contrast on a decorative fill, missing `aria-hidden` on a glyph | Yes, with a ticket |
| **S4 Cosmetic** | Styling/typography only, no behaviour impact | Padding nit, shadow consistency | Yes |

### Known gaps / open frontend tickets (none is precedent — fix when in the file)

| # | Gap | Where | Owner |
|---|---|---|---|
| D5 | No `<h1>` in the dashboard page shell | `StudentOSDashboard.tsx` | frontend |
| D6 | Language toggle at `minHeight: 32` (< 44px floor) | `StudentOSDashboard.tsx:264` | frontend |
| D7 | BoardScore tabs use `role="tab"` with no `tabpanel`/`aria-controls` pairing | `BoardScoreWidget.tsx:379-408` | frontend |
| D8 | No `aria-live` region announces queue updates | dashboard shell | frontend |
| D9 | No focus management after retry or tab switch | `BoardScoreWidget.tsx`, `StudentOSDashboard.tsx` | frontend |
| D4 | No comeback surface for a zero/broken streak | `wonder-blocks.tsx:1051-1073` | frontend (product decision) |

Full defect table (D1–D13) incl. learner-data and token outliers: `student-dashboard-design` → Known Defects.

---

## 10. Production Definition of Done

A student feature is done only when **all** of the following hold:

- [ ] **Gates:** `npm run type-check` + `npm run type-check:scripts`, `npm run lint`, `npm test`, `npm run build` all pass; bundle within `CAP_SHARED_KB` / `CAP_PAGE_KB` / `CAP_MIDDLEWARE_KB` (read from source).
- [ ] **Four states** (loading / error / empty / loaded) implemented; empty never renders on a failed or in-flight fetch.
- [ ] **IA**: new destination follows one-name-one-icon; nav entry lives in `nav-config.ts` (not a page); flag/grade gating via the existing helpers.
- [ ] **Responsive**: works at 360px (bottom nav, no rail/aside), 768px (rail), 1024px+ (aside); safe areas handled by the shell.
- [ ] **Accessibility floor** (§7) walked line by line; no new S0/S1/S2 items.
- [ ] **Bilingual** (P7): every user-facing string has a Hindi counterpart via `isHi`.
- [ ] **Learner data**: every surfaced number is a permitted re-presentation; denominators visible; `N = 5` respected; assessment sign-off obtained for any derived metric.
- [ ] **No PII** in logs/analytics (P13).
- [ ] **SWR defaults** not overridden without a stated reason; cache headers set on new API routes.
- [ ] **Foxy** (if integrated): via `FoxyPanelLauncher` only; panel off first paint; never outranks the page's primary CTA.
- [ ] **Tests added**: unit for new logic + four states, E2E for new journeys, structural guard for any invariant touched; regression catalog entry when the change touches a P-invariant.
- [ ] **Review chain complete** (P14): assessment if learner data, quality for tokens/a11y/bundle, testing for coverage; backend if API contract changes; **mobile** flagged if a response shape changes.
- [ ] **Lint hygiene**: no `console.log` in prod paths, no secrets, commit message `type(scope): description`.

## Rejection Conditions

Reject (or stop and hand off) when the change:
- Recomputes mastery/accuracy/scores/predictions client-side, or hardcodes an XP/level/score number → assessment.
- Renders a student-facing percentage without its visible denominator, or under N = 5 → assessment.
- Renders a cross-subject aggregate next to a per-subject confidence band.
- Ships an empty state that blames the student for a possible content gap.
- Ships a user-facing string with no Hindi counterpart (P7).
- Authors `dark:` classes, adds a new `PremiumCard`, or imports `FoxyPanel` statically into a page (P10/P12 guard).
- Imports `framer-motion` (or any heavy premium dep) into the root layout, `packages/lib/src/AuthContext.tsx`, or any module in those import graphs — that hits all 209 routes (P10).
- Reaches for `framer-motion` for motion CSS already does, or ships it with no `next/dynamic({ ssr: false })` boundary where one was practical (P10).
- Registers `tailwindcss-animate` in `tailwind.config.js` without resolving the 8-class `.duration-*` / `.ease-*` collision (§3).
- Breaches the page's recorded P10 ratchet baseline, or raises a `CAP_*` constant without CEO approval.
- Uses a raw hex or palette colour where a token exists; uses bare `#fff` on a decorative surface without the matching `--on-*` token.
- Omits any of the four states, or renders raw error text / PII to a student (P13).
- Encodes meaning by colour alone; has any interactive target under 44px.
- Overrides SWR defaults, adds a second `<main>`, or mounts nav chrome outside `GlobalAppLayout`.
- Changes an API response shape without flagging **mobile**.
- Ships an S0/S1 (or unreviewed S2) item, or has an incomplete review chain (P14).

## Review Chain

frontend implements → **assessment** reviews whenever learner data or an adaptive-loop rule is surfaced (mastery, XP, scores, streaks, predictions, queue semantics) against the re-present/re-compute line → **quality** reviews token/a11y/bundle/IA conformance → **testing** adds coverage and E2E. Invariants in scope: P7 (bilingual), P8 (RLS boundary), P10 (bundle budget), P12 (AI safety, for Foxy surfaces), P13 (privacy), P14 (chain completeness). Data-contract or API-shape changes additionally require **backend**; any API response-shape change flags **mobile**.
