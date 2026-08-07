# Alfanumrik Student Experience — Design Specification

- **Date:** 2026-08-07
- **Mode:** Design (full student surface)
- **Grounded in:** `.opencode/skills/design-alfanumrik-student-experience` references (`experience-contract.md`, `information-architecture.md`, `implementation-and-quality.md`), `packages/ui/src/navigation/nav-config.ts` (verified 2026-08-07), `packages/ui/src/globals.css`.
- **Companion:** the `student-dashboard-design` skill is the canonical `/dashboard` card recipe; this spec governs everything else and binds every surface to the shared learner-data semantics.

## 1. Learner problem and desired outcome

A CBSE student (grades 6–12, Hindi or English, mobile-first on 2–5 Mbps) opens the app to "what should I do next?" and currently has to assemble the answer from a mastery dashboard, a subject browser, and a separate quiz runtime. The desired outcome is a calm, adaptive learning control surface that:

- tells the student **what to do next**, with a truthful reason label;
- makes **acting on it** one tap away (the recommended-action slice);
- makes **improvement understandable** — evidence, not decoration;
- survives **low bandwidth, interruption, and failure** without lying about progress;
- is **safe by construction** for a child (age-appropriate AI, privacy, no payment clutter).

Completion condition for the surface: a functional primary journey `sign in → Today → recommended action → learning/practice session → feedback → updated evidence → next action`, with truthful data, responsive behaviour, accessible interaction, and defined failure recovery on every destination.

## 2. Learner context defaults

Where the repo does not force a narrower target, design for: middle-school learner; 360 px mobile first through 1024 px+ desktop; touch and keyboard; variable connectivity (SWR defaults tuned for Indian mobile networks); bilingual en/hi; real-data empty states. Payments, billing, transport, and generic school ERP features are **outside** the student experience boundary.

## 3. Information architecture (the five-destination model)

Primary navigation is stable and ordered. One destination = one name = one icon across every projection (`nav-config.ts:6-11`).

| Slot | Route | Label (en/hi) | Projection | Gating |
|---|---|---|---|---|
| 1 | `/today` | Today / आज | Tab `CORE_TABS[0]`, streak badge | `ff_today_home_v1`; OFF → `/dashboard` |
| 2 | `/learn` | Learn / सीखें | Tab `CORE_TABS[1]` | — |
| 3 | `/foxy` | Foxy / फॉक्सी | **Center FAB** `CORE_TABS[2]`, never a 5th tab | — |
| 4 | `/progress` | Progress / प्रगति | Tab `CORE_TABS[3]` | — |
| 5 | More | More / और | `role="dialog"` bottom sheet (`MobileBottomNav.tsx`) | — |

**Practice is the de-facto 5th destination.** `/practice` (Practice Center) is a More-sheet entry gated by `ff_practice_os_v1` until launch (`nav-config.ts:29-32`).

**More sheet** (`MORE_SHEET_GROUPS`, `nav-config.ts:66-70`) groups overflow into Practice / Study / Account, mirroring `SIDEBAR_SECTIONS` on desktop (`nav-config.ts:72-125`).

- Practice: Home (`/dashboard`), Assignments, STEM Lab, Practice Center (`ff_practice_os_v1`), PYQ (`gradeMin 9`), Mock Exam (`gradeMin 9`), Exam Briefing (`ff_test_os_v1`), Exam Sprint (`requiresUpcomingExam`).
- Study: Leaderboard, Library, Refresh, Revision Center (`ff_revision_os_v1`).
- Account: Profile, Me (`ff_me_v2`), What Foxy remembers (`/memory`), Settings & Notifications, Help & Support, My Tickets.

**Nav laws:** `isNavItemActive` uses segment-boundary matching (`nav-config.ts:156-160`); flag gating hides until ON (`isItemVisibleForFlags`); grade gating renders a lock + "Grade N+" chip, never hides a locked subject (`nav-config.ts:132-141`). `/dashboard` is **not** a core tab — `/today` is the home tab.

### Route map (student surfaces)

```
today ───────── TodayHomeV2 (adaptive queue)
dashboard ───── mastery-first home (student-dashboard-design skill)
learn ───────── subject → chapter → concept session → quiz entry
practice* ───── Practice Center (quick-start → existing /quiz engine)
quiz ────────── practice/exam runtime (never a drive-by)
foxy ────────── edge-to-edge AI tutor
progress ────── mastery, Bloom progression, gaps, velocity, streak/XP, pulse*
me* / profile ─ identity, parent link, language, privacy (GDPR/DPDP)
memory ──────── what Foxy remembers (transparency + erasure)
dive (+history) weekly Curiosity Dive (forgiving streak)
synthesis ───── monthly reflection
pyq / mock-exam / exam-briefing* / revision* / exam-prep — exam & review cluster
```

`*` flag-gated. Flag-gated pages read the flag client-side: PENDING → skeleton (never a 404 flash); OFF → `notFound()` or redirect to the existing equivalent; ON → the new surface (`today/page.tsx:48-60`, `(student)/practice/page.tsx`).

## 4. The primary journey (recommended-action slice)

```
sign in → Today → recommended action → session → feedback → updated evidence → next action
```

1. **Entry:** student lands on `/today` (home tab). Today queue items deep-link through `deepLinkToHref` parsed from the resolver's `action.url` — never hand-built URLs (`/quiz`, `/learn/<subject>/<chapter>`, `/dive`, `/synthesis`).
2. **Decision:** `resolveTodayQueue` → `GET /api/v2/today` → `TodayResponse` (DTO owned by `packages/lib/src/today/types.ts`) decides "what next". The UI only **projects** the decision — no client-side re-planning.
3. **Action:** the queue's top item is the primary action. Hero owns the single primary CTA (`TodayHomeV2.tsx:16`); nothing competes for its weight.
4. **Session:** tap-through runs in `/quiz` (practice) or a `/learn/<subject>/<chapter>` concept session.
5. **Feedback:** results arrive from the engine (score fixed `Math.round((correct/total)*100)`, XP server-computed, constants in `xp-config.ts`).
6. **Updated evidence:** `/api/v2/today` refetches; the queue re-ranks with a truthful reason ("Review due", "Build this prerequisite", "Ready for a challenge").
7. **Next action:** the loop continues from Today. Interruption mid-session surfaces as the resume-first hero (dark high-contrast, continue = only primary button, `TodayHomeV2.tsx:59-118`).

## 5. Screen anatomy and component inventory

### 5.1 Today (`/today`)
- **Hero:** greeting + primary CTA; resume-first variant when a session is in progress.
- **Queue:** prioritized rows, each with icon + reason label + action count + primary tap. Reason labels are translated engine decisions, never acronyms.
- **Streak chip:** daily streak object (server-owned); broken streak shows a comeback path, never shame.
- **Ritual entry rows:** Curiosity Dive / Synthesis surfaced when due.
- States: skeleton (`DashboardSkeleton`/`Bone`), loaded, empty (dashed panel + CTA, only blames the student when attributable), error (bilingual `role="status"` + retry), stale (`keepPreviousData`), offline (`OfflineBoundary`).

### 5.2 Learn (`/learn`, `/learn/[subject]/[chapter]`)
- **Subject grid/browser:** plan-based gating (free=2, starter=4, pro=all). Locked subjects visible + greyed + upgrade CTA, never hidden.
- **Chapter → concept session:** topics, questions, diagrams, learning-event recording; the main `/quiz` entry.
- **One primary action per screen** (enter concept session / continue); secondary rows use progressive disclosure.

### 5.3 Practice center (`/practice`, `ff_practice_os_v1`)
- **Quick-Start** hands off to the existing `/quiz` engine.
- **Mode cards:** adaptive / review / assignment / exam / mock — each with a reason and readiness signal, not just a button.
- Empty and locked states defined per mode; OFF flag → `notFound()`.

### 5.4 Progress (`/progress`)
- Mastery evidence, performance score, Bloom progression, knowledge gaps, learning velocity, streak/XP; Pulse (flag-gated).
- Every percentage shows its denominator; percentages over < 5 observations suppressed or marked provisional (assessment-owned floor). Re-present, never re-compute (client arithmetic limited to counting/bucketing/grouping engine-decided values).

### 5.5 Foxy (`/foxy` full screen + embeds)
- One persistent non-blocking entry: the center FAB. Embedded Foxy via `FoxyPanelLauncher` → `next/dynamic({ ssr:false })` panel; never a static `FoxyPanel` import (regression-tested).
- Modes: learn / explain / practice / revise / doubt / homework / explorer. Short actions: Explain simpler, Give an example, Hint, Quiz me, Save to notebook, Report issue.
- Truthfulness: Foxy never fabricates mastery, grades, teacher messages, or learning history; surfaced mastery comes from backend-owned state.
- `/memory` (Foxy North-Star Phase 1): learner-memory transparency + erasure.
- Full screen is edge-to-edge (`bleed` + `foxy-shell`), body scroll locked, header blur dropped.

### 5.6 Rituals — Dive (`/dive`, `/dive/history`) and Synthesis (`/synthesis`)
- Dive: weekly curiosity journey with its **own forgiving streak object** (missing one week does not reset; four consecutive does).
- Synthesis: monthly reflection.
- Both carry `layout.tsx` / `loading.tsx` / `error.tsx` boundaries.

### 5.7 Profile, Me, Memory, Settings
- `/profile`: identity, parent link, downloads, language, GDPR/DPDP export/delete.
- `/me` (`ff_me_v2`): additive presentation layer over `/profile`, same name/icon in every projection.
- `/memory`: what Foxy remembers, with erasure.

### Component inventory (shared, `packages/ui`)

| Component | Notes |
|---|---|
| `Card` primitive | `variant: flat | elevated | interactive`; **no new `PremiumCard` usage** (legacy) |
| `Skeleton` primitive | exported API (`className/width/height/rounded/variant`) vs dashboard `Bone` helper — never mix the two APIs |
| `FoxyPanelLauncher` | dynamic, non-blocking embed launcher |
| `OfflineBoundary` (`packages/ui/src/offline/v2`) | offline coverage for logged-in students |
| `MobileBottomNav` + nav-config | single source of nav truth; never hard-code a nav list |
| `GlobalAppLayout` / `RoleShell` | one `<main>` (skip-link target `#main-content`); nav mounts once at root |
| `TodayHomeV2` | dynamic, `ssr:false`, hero-first |
| `DashboardSkeleton` | must mirror first paint of the dashboard sections |

## 6. Responsive behaviour

- **360 px (mobile):** bottom nav (Today/Learn/Foxy FAB/Progress) + More sheet; no rail/aside; one-handed reach preserved.
- **768 px (tablet):** rail appears; same destinations, same labels/icons.
- **1024 px+ (desktop):** `SIDEBAR_SECTIONS` (Home / Practice / Study / Account) + content `min(1240px, …)`; aside up to `--layout-max-aside 320px`.
- Navigation presentation changes across breakpoints; the student's mental model never does.
- Safe areas handled by the shell (`--safe-top/bottom`); scroll-margin so targets never hide under the sticky header.
- CSS-only motion; `prefers-reduced-motion` blanket-collapses animation (`globals.css:772-788`).

## 7. State and permission matrix

| State | Rule (all data-bound regions) |
|---|---|
| Loading | Shape-matched skeleton, `aria-busy="true"` |
| Loaded | Real presentation |
| Empty / insufficient evidence | Dashed panel + `aria-hidden` emoji + headline + sub-line + CTA; may blame the student only when attributable |
| Recoverable error | Bilingual, `role="status"`, no raw error string, retry where cheap |
| Partial / stale | Show known data + freshness marker; `keepPreviousData` for stale-while-loading |
| Offline / interrupted | `OfflineBoundary`; queued answers, downloaded chapters, Foxy state |
| Locked / permission-limited | "Grade N+" chip + lock; locked subjects greyed + upgrade CTA |
| Completion / undo | Confirmation + undo where applicable; celebrate the specific win |

**Anti-pattern:** a failed or in-flight fetch must never render as a positive empty state ("all caught up"). Gate reassuring empties on `loaded && !error`.

**Permission surface:** RBAC enforced server-side (`authorizeRequest`); client `usePermissions()` is UI convenience only, not a boundary. Student routes read plan/grade gates (`getItemLockForGrade`, plan-based subject gating). Foxy: per-plan daily limits; "Limit reached" is a clear bilingual state.

## 8. Accessibility and safety requirements (WCAG 2.2 AA floor)

- Bilingual `aria-label` on sections/dialogs where the heading is not self-describing.
- `role="status"`/`alert` for status/error; `role="progressbar"` + `aria-valuenow/min/max` on bars/rings; `role="list"`/`listitem` on repeated rows.
- `aria-hidden="true"` on every decorative emoji/glyph.
- `focus-visible:ring-2` (+ `ring-offset-2` on decorative backgrounds); focus managed after sheet/dialog open and after retry/tab switches.
- Touch targets ≥ 44 px (48 preferred); no keyboard traps; Escape closes sheets/dialogs; exactly one `h1` per screen.
- Meaning never colour-only; contrast via tokens (`--text-3` is the AA limit on the warmest surface — don't push muted text darker).
- No `dark:` classes (dead CSS); app ships light-only (`color-scheme: light`).
- **Safety (P12):** age-appropriate, CBSE-scope AI responses, per-plan daily limits. **Privacy (P13):** no `studentId`/`studentName` in logs, Sentry, or analytics with Foxy events; SWR keys are per-student.
- **Reduced motion** respected globally; looping animations need explicit kill-block entries.

## 9. Data dependencies and event plan

### Data dependencies
- `GET /api/v2/today` → `TodayResponse` (queue + reasons). DTO owner: `packages/lib/src/today/types.ts`. Never hand-build deep links.
- `GET /api/learner/*` family (server-resolved). Student pages reach the DB only through API routes — never `supabase-admin` in client code (P8).
- `/api/board-score` proxies the Supabase Edge Function.
- Engine-owned values: mastery, accuracy, retention, confidence, predicted marks, streak, XP — **re-presented, never recomputed**. Any derived metric requires assessment sign-off.
- SWR defaults (`DEFAULT_CONFIG`): `revalidateOnFocus:false`, `revalidateOnReconnect:true`, `dedupingInterval:10000`, `errorRetryCount:2`, `keepPreviousData:true`; `useStudentSnapshot` opts into `revalidateOnFocus`. Don't override without a stated reason.
- Cache headers: 30 s private for learner-next; CDN `s-maxage=60` for leaderboard; new safe-public routes do the same.

### Event plan
- All events through `track()` (`packages/lib/src/analytics.ts`), names matching the tracking-plan conventions.
- Payloads carry event name + non-identifying counts only; the server correlates from the authenticated session. Never PII or identifiers.
- New surfaces emit events; placeholder analytics that fire but feed nothing are rejected.

## 10. Acceptance criteria

**Per-surface DoD (bind to the implementation-quality DoD, §9):**

- [ ] Gates: type-check (workspaces + scripts), lint, tests, build pass; bundle within caps read from `scripts/check-bundle-size.mjs`.
- [ ] Complete state model (loading / loaded / empty / error + extended set) on every data-bound region; empty never on failed/in-flight fetch.
- [ ] IA: one-name-one-icon; nav entries in `nav-config.ts`; flag/grade gating via existing helpers.
- [ ] Responsive 360 / 768 / 1024+; safe areas; one-handed mode.
- [ ] Accessibility floor walked line by line; no new S0/S1/S2 items.
- [ ] Bilingual: every user-facing string has a Hindi counterpart (P7).
- [ ] Learner data: permitted re-presentation only; denominators visible; N = 5 respected; assessment sign-off for derived metrics.
- [ ] No PII in logs/analytics (P13).
- [ ] Foxy (if integrated): `FoxyPanelLauncher` only; panel off first paint; never outranks the page's primary CTA.
- [ ] Tests: unit for new logic + states, E2E for new journeys, structural guard for any invariant touched; regression-catalog entry when a P-invariant is touched.
- [ ] Review chain complete (P14): assessment (learner data), quality (tokens/a11y/bundle), testing (coverage), backend (API contract changes), **mobile flagged if a response shape changes**.

**Completion rule:** not done because it renders. Requires the functional primary journey, truthful data, responsive behaviour, accessible interaction, defined failure recovery, and evidence that the requested adaptive behaviour reaches the UI.

## 11. Open risks

- **Queue reason drift:** reason labels must stay engine-owned; a presentation-side "smart" label that re-derives the decision breaks the honesty contract (S0).
- **Interruption recovery:** resume-first must restore the exact session state; a lost resume is a broken core interaction (S1).
- **Bilingual coverage:** new strings introduced without `todayCopy`/label-map routing ship English-only (P7 violation).
- **Empty-state honesty:** content/coverage gaps from the platform must not be narrated as learner inaction.
- **Pulse / adaptive loops:** surfaces gated by `ff_school_pulse_v1` / adaptive flags must render truthful insufficient-evidence states until real data exists — never simulated intelligence.
- **Mobile parity:** any API response-shape change from these surfaces flags the Flutter app in the review chain (P14).
- **Foxy limits:** daily-limit and safety escalation states must be defined before launch, not at support-ticket time.
