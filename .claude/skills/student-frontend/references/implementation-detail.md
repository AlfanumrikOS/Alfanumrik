# Reference: Student Frontend Implementation Detail

Read before writing or changing frontend code, auditing a repository, or declaring student-facing work complete. Loaded from `student-frontend/SKILL.md`. For `/dashboard` card-level detail specifically, read `student-dashboard-design` instead -- this file does not restate that skill's card recipe, tokens, motion, or defect tables; where the same underlying design-token system applies platform-wide, it is stated once, here.

## Design tokens (from `packages/ui/src/globals.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--bg #FBF8F4`, `--surface-1 #FFFFFF`, `--surface-2 #F5F0EA`, `--surface-3 #EDE6DC` |
| Text (AA-verified) | `--text-1 #1A1207`, `--text-2 #4A3F2E`, `--text-3 #6B6053` -- `--text-3` on `--surface-3` is 4.95:1, just past AA; do not push it darker |
| Borders | `--border`, `--border-mid`, `--border-strong` |
| Brand | `--orange #E8581C` + `--orange-rgb`, `--purple`, `--gold`, `--teal`, `--green`, `--red` |
| Semantic | `--success/--warning/--info/--danger`, `--primary/--primary-light/--primary-hover` |
| Gamification | `--xp-color` (gold), `--streak-color` (orange), `--level-up` (purple), `--mastery-low/mid/high` |
| Shadows | `--shadow-sm/md/lg/glow`, `--scrim` |
| Radius | `--radius-sm..2xl` (2/6/8/12/16px) -- Tailwind `rounded-*` maps onto these |
| CTA gradient | `--btn-primary-from #CB4710` -> `--btn-primary-to #C2440F`, AA-safe under white text. Bare `#fff` on `--orange` (3.59:1) is a FAIL -- only use white on the CTA stops or `--on-*` tokens |
| Paired on-surface | `--on-accent`, `--on-surface-inverse`, `--surface-inverse`, `--on-surface-accent` -- text on surface X uses `--on-X`; never bare `#fff` on a decorative background |
| Warm channel | `--accent-warm` + `--accent-warm-rgb` + `--accent-warm-strong` -- stable burnt-orange on every surface; use for Foxy mascot/avatar identity |
| Layout | `--layout-max-rail 220px`, `--layout-max-aside 320px`, `--layout-max-content min(1240px, ...)`, `--shell-header-h-compact 44px`, `--safe-top/bottom`, `--space-fluid-1...12` |
| Fonts | `--font-display` (Sora, headings/data), `--font-body` (Plus Jakarta Sans). `--font-serif` (Fraunces) is marketing-only -- never on the student surface. Always pass a mono fallback: `var(--font-mono, ui-monospace, monospace)` |

Standing warnings: **no `dark:` Tailwind classes** (`darkMode` targets an attribute that is never written -- dead CSS); **the app ships light-only** (`color-scheme: light` forced in the root layout); **tokens over raw hex/palette classes** -- a hex is acceptable only as a `var()` fallback.

## Responsive breakpoints and shell mechanics

| Width | Layout |
|---|---|
| < 768px | single content column; bottom nav visible; one-handed mode available |
| >= 768px | 220px sticky rail appears (`--layout-max-rail`); bottom nav hidden when the shell has a rail |
| >= 1024px | 320px aside appears (`--layout-max-aside`); content capped at `--layout-max-content`; bottom nav suppressed |

Bottom nav auto-hides on scroll-down, reappears on scroll-up (rAF-throttled, skipped under `prefers-reduced-motion`); respects `env(safe-area-inset-bottom)` for notched phones; hidden >=1024px and on print. One-handed mode is phone-only, persisted to `localStorage['alfanumrik:one-hand']`, with a bilingual `aria-label`/`aria-pressed` -- do not remove it on a phone layout. Sticky header compacts on scroll past 24px to `--shell-header-h-compact` via a CSS transition (no JS animation). Foxy is the bleed exception: a shell class containing `foxy-shell` drops the rail reservation, the content-width cap, and fluid side padding for edge-to-edge chat, and also skips the compact-on-scroll header -- renaming a shell class to anything containing that substring silently changes header behavior on that route, so rename with care.

## Motion

CSS-only is the default and preferred approach for every student card -- reveal, stagger, hover, press, spinners. Do not add a JS animation runtime for these. `framer-motion` is permitted, conditionally (CEO-approved, alongside a broader premium UI stack that is install-only until actually imported) -- reserve it for genuinely complex interaction (gesture/drag, shared-layout transitions, orchestrated exit-on-unmount, spring physics); anything CSS already does, do in CSS. Never import `framer-motion` (or any heavy dependency) into the shared import graph (root layout, `AuthContext`, or anything either pulls in) -- that cost lands on every route. Behind a `next/dynamic({ssr:false})` boundary where practical.

Reveal stagger uses `.os-reveal-card` + a `--reveal-i` CSS variable; roadmap nodes use `--stagger-i`. Tailwind animation utilities available: `float`, `scale-in`, `slide-up`, `fade-in`, `bounce-in`, `level-up`, `xp-burst`, `streak-pulse`, `mastery-fill`, `score-reveal`.

`tailwindcss-animate` is installed but deliberately **not** registered in `apps/host/tailwind.config.js` -- registering it redefines several in-use duration/easing classes as `animation-*` longhands emitted after `.animate-spin`/`.animate-pulse`, silently retiming existing animations. Anyone registering it owns resolving that collision first.

Reduced motion: a global blanket collapses all animation under `prefers-reduced-motion` for one-shot animations automatically. Looping/infinite animations need an explicit `animation: none !important` entry in the dedicated kill-block -- add a new looping class there if you introduce one. `AppShell` intentionally no-ops the media query in JS; CSS owns reduced motion, not JS.

## Accessibility floor (WCAG 2.2 AA) -- walk this on every new or touched component

- Bilingual `aria-label`/`aria-labelledby` where the heading is not self-describing
- `aria-busy="true"` on loading shells; `role="status"` (or `alert` for errors) on status/error panels
- `role="list"` + `role="listitem"` for repeated rows -- do not apply these roles to non-list DOM
- `role="progressbar"` + `aria-valuenow/min/max` + a bilingual label on any bar/ring/gauge
- `aria-hidden="true"` on every decorative emoji, glyph, and pure-presentation element
- `focus-visible:ring-2` (+ `ring-offset-2` where needed) on every interactive element; logical focus order; focus managed after a sheet/dialog opens and after retry/tab switches
- Touch target >= 44px (48px preferred) -- stricter than the WCAG 2.2 2.5.8 minimum of 24px
- Meaning is never colour-only (1.4.1) -- pair colour with an icon + label + number
- Contrast via tokens -- verify a custom colour against its actual background before shipping it
- No keyboard traps; Escape closes any sheet/dialog
- Focus never obscured by a sticky header/nav -- add `scroll-margin` where a target could land under it
- Reduced motion respected (see Motion above)
- Exactly one `h1` per page/screen
- Errors announced, not just coloured (3.3.x)

## Data boundaries (the contract)

| Concern | Rule |
|---|---|
| Remote state | SWR only. Keys are per-student so different students on one device get separate cache entries (P13) |
| SWR defaults | No focus-revalidation by default, ~10s dedupe, limited error retries, no retry on 4xx, `keepPreviousData: true` -- tuned for Indian mobile networks; don't override without a stated reason |
| Authed API calls | Use the shared authenticated-fetch helper; never `supabase-admin` in client code (P8) |
| API routes are thin proxies | Student pages never reach into the database directly |
| DTO ownership | `packages/lib` owns every render DTO; `packages/ui` renders; pages fetch. No component reinvents a shape |
| Re-present, don't re-compute | Client arithmetic limited to counting/bucketing/grouping/summing engine-decided values -- see `student-dashboard-design` -> Learner Data Semantics |
| Privacy | No PII in client logs, Sentry, or analytics payloads (P13) |
| Cache headers | API routes set caching appropriate to the data's freshness needs; a new student route with a safe public cache should do the same |
| Flag gates | Client gates read the feature-flag hook; when a flag is OFF the surface hides or redirects, never errors |
| Response-shape changes | Any API response-shape change flags **mobile** in the review chain (P14) |

## Audit severity (grading anything wrong on the student surface)

| Severity | Meaning | Examples | Ships? |
|---|---|---|---|
| S0 Blocker | Violates a P-invariant or leaks PII; a wrong learner-facing number that misleads | Recomputing mastery/accuracy in the UI, hardcoded XP value, raw error string or PII to a student, bundle over cap, static Foxy embed | No -- fix or revert before merge |
| S1 Critical | Wrong learner-facing state, broken core interaction, blocking a11y failure | Missing four-state coverage, keyboard trap, empty state on a failed fetch, missing denominator on a percentage, no Hindi for a user string | No |
| S2 Major | WCAG AA failure on content or target size, conformance drift | Sub-44px control, colour-only meaning, `dark:` class added, new `PremiumCard`, no comeback surface for a broken streak | Only with a tracked ticket + review chain sign-off |
| S3 Minor | Quality/polish; reduced-motion gap on a loop; focus-order nicety | Soft contrast on a decorative fill, missing `aria-hidden` on a glyph | Yes, with a ticket |
| S4 Cosmetic | Styling/typography only, no behaviour impact | Padding nit, shadow consistency | Yes |

## Production Definition of Done

A student feature is done only when all of the following hold: gates (`type-check` incl. `:scripts`, `lint`, `test`, `build`) pass and bundle stays within the caps read from `scripts/check-bundle-size.mjs`; all four states implemented with empty never rendering on a failed/in-flight fetch; new destination follows one-name-one-icon and lives in `nav-config.ts` with flag/grade gating via the existing helpers; responsive at 360/768/1024px+ with safe areas handled by the shell; the accessibility floor above walked line by line with no new S0/S1/S2; every user-facing string has a Hindi counterpart (P7); every surfaced number is a permitted re-presentation with assessment sign-off for anything derived, denominators visible, and the assessment-owned minimum-sample-size floor respected; no PII in logs/analytics (P13); SWR defaults not overridden without a stated reason; Foxy (if integrated) goes through `FoxyPanelLauncher` only and never outranks the page's primary CTA; tests added (unit for new logic + states, E2E for new journeys, a regression-catalog entry for any P-invariant touched); the P14 review chain is complete; no `console.log` in prod paths, no secrets, and the commit message follows `type(scope): description`.

## Known open frontend gaps (fix when already in the file; none is precedent)

| Gap | Where |
|---|---|
| No `<h1>` in the dashboard page shell | `StudentOSDashboard.tsx` (see `student-dashboard-design`) |
| Language toggle below the 44px touch floor | `StudentOSDashboard.tsx` header |
| BoardScore subject tabs use `role="tab"` with no `tabpanel`/`aria-controls` pairing | `BoardScoreWidget.tsx` |
| No `aria-live` region announces queue updates | dashboard shell |
| No focus management after a retry or a subject-tab switch | `BoardScoreWidget.tsx`, dashboard shell |
| No comeback surface for a broken/zero streak | streak badge component |

The full D1-D13 defect table, including dashboard-specific token/geometry outliers and learner-data-semantics defects, lives in `student-dashboard-design` -- this table only restates the subset relevant to platform-wide components (nav/header/streak badge), not the dashboard-specific ones.
