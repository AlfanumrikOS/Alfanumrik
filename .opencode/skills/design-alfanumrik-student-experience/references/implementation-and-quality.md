# Implementation & Quality — Alfanumrik Student Surface

Read before writing or changing frontend code, auditing a repository, or declaring work complete. Grounded in the live tree (verified 2026-08-06). Companion references: `experience-contract.md` (UI/interaction/Foxy) and `information-architecture.md` (IA/routes).

## 1. Stack and repository layout

- **Frontend:** Next.js 16 App Router, React 18, Tailwind 3.4, SWR. Monorepo: `apps/host` (the web app), `packages/ui` (`@alfanumrik/ui`, shared components + `globals.css`), `packages/lib` (`@alfanumrik/lib`, hooks/DTOs/utilities).
- **Path aliases** (declared in `apps/host/tsconfig.json`): `@/*` → `apps/host/src/*`; `@alfanumrik/lib/*` → `packages/lib/src/*`; `@alfanumrik/ui/*` → `packages/ui/src/*`.
- **Canonical vs stub:** `packages/lib/src/<x>` and `packages/ui/src/<x>` are canonical. `apps/host/src/lib/<x>.ts` and `apps/host/src/components/<x>.tsx` are thin re-export stubs — **edit the package, never the stub.**
- **Supabase clients:** `packages/lib/src/supabase.ts` (client, respects RLS), `supabase-server.ts` (server), `supabase-admin.ts` (server-only, bypasses RLS — never in client code, P8).
- **Middleware:** `apps/host/src/proxy.ts` (renamed from `middleware.ts` for Next.js 16; build-enforced by `scripts/auth-guard.js`).

## 2. Rendering model

- **Root layout is a server component** (`apps/host/src/app/layout.tsx`): fonts, metadata, viewport, skip link, provider tree `SWRProvider → TenantConfigProvider → SchoolProvider → AuthProvider → CosmicThemeProvider → ErrorBoundary → GlobalAppLayout` (`:192-221`).
- **Student pages are effectively all client components** (`'use client'`) because they depend on `useAuth`/`isHi`/SWR. Keep them thin: split heavy loaded-state presentations behind `next/dynamic({ ssr: false })` (TodayHomeV2, FoxyPanel, ConversationManager, ContextPanel, PracticeCenter, InlineSimulation, LoadingState — e.g. `today/page.tsx:38-40`, `(student)/practice/page.tsx`).
- **One `<main>`:** the skip link targets the persistent `#main-content` in `GlobalAppLayout` (`layout.tsx:173`, `GlobalAppLayout.tsx:105`); `RoleShell` owns the semantic `<main>` (`packages/ui/src/navigation/RoleShell.tsx:48`). An `AppShell` nested inside it passes `contentAs="div"`.
- **Navigation mounts once at root** (`GlobalAppLayout.tsx:18-25,94-99`) and persists across navigations — no per-route nav re-mount. Nav chrome is lazy (`ssr:false`) to protect the shared bundle.

## 3. Data boundaries (the contract)

| Concern | Rule | Source |
|---|---|---|
| Remote state | SWR only (no Redux/Zustand). Keys are per-student — `studentId` in the key so different students on one device get separate cache entries (P13). | `packages/lib/src/swr.tsx` |
| SWR defaults | `DEFAULT_CONFIG` (`swr.tsx:44-57`): `revalidateOnFocus: false`, `revalidateOnReconnect: true`, `dedupingInterval: 10000`, `errorRetryCount: 2`, no retry on 4xx, `keepPreviousData: true` — tuned for Indian mobile networks. Don't override without a stated reason. | `packages/lib/src/swr.tsx` |
| Authed API | `authedFetch` (`packages/lib/src/authed-fetch.ts`) for authenticated API calls. Never `supabase-admin` in client code. | P8 |
| API routes are thin proxies | e.g. `/api/board-score` proxies the Supabase Edge Function; `/api/learner/*` and `/api/v2/today` resolve server-side. Student pages don't reach into the DB. | P8 |
| DTO ownership | `packages/lib` owns every render DTO (`today/types.ts`, `exams/types.ts`). `packages/ui` renders. Pages fetch. No component reinvents a shape. | |
| Re-present, don't re-compute | Client arithmetic limited to counting / bucketing / grouping / summing engine-decided values. Anything producing a *different* number than the engine (mastery, accuracy, predicted marks from `mastery_probability`, `p_know`, `attempts`, `effective_mastery`, confidence bands) requires assessment sign-off. | `student-dashboard-design` → Learner Data Semantics |
| Privacy | No PII in client logs, Sentry (`beforeSend` redactor), or analytics payloads. Never log `studentId`/`studentName`; log event names + non-identifying counts. Error boundaries must not attach the student's name/id to a caught error. | P13 |
| Cache headers | API routes set appropriate caching: 30s private cache for learner-next; CDN `s-maxage=60` for leaderboard. New student routes with safe public cache do the same. | `swr.tsx:119,193` |
| Flag gates | Client gates read `useFeatureFlags()`; OFF → surface hides or redirects, never errors. `/today` → `/dashboard`; flag-gated pages → `notFound()`. | `today/page.tsx:48-60`, `(student)/practice/page.tsx` |
| Response-shape changes | Any API response-shape change flags **mobile** (Flutter app sync) in the review chain. | P14 |

### Adaptive-logic honesty

- Render backend-owned recommendations and evidence; never simulate intelligence in presentation code. The Today queue (`resolveTodayQueue` → `/api/v2/today` → `TodayResponse`) decides "what next"; the UI only projects it (`packages/lib/src/today/types.ts:10-22`).
- Explain recommendations with concise reason labels; show source/freshness when it affects interpretation; keep mastery / retention / confidence / difficulty / next-action distinct.
- Do not imply IRT, SRS, CME, DKT/BKT, personalization, or outcome guarantees work unless the inspected data path proves it. Provide truthful loading, unavailable, insufficient-evidence, and recovery states.

## 4. State management and caching

- **Invalidation helpers** in `swr.tsx`: `invalidateSnapshot`, `invalidateDashboard`, `invalidateAll`, and `clearAllCache` (call on signout to prevent cross-account leakage).
- `useStudentSnapshot` enables `revalidateOnFocus` (it needs freshness); everything else follows the defaults.
- **Never re-derive client-side** what the server computes: streak (daily vs weekly Curiosity Dive — two different objects, never conflated), XP (server-computed only; constants from `packages/lib/src/xp-config.ts`; never hardcode a number; remember `quiz_daily_cap = 200`).

## 5. Code conventions

- `'use client'` on every client component; `isHi` flows via props or hooks, never a second context.
- No i18n library — inline ternaries / `const T = {}` maps / `todayCopy` for Today copy. Never ship an English-only user string (P7). Don't translate CBSE, XP, Bloom's, BoardScore™, Foxy, NCERT, PYQ.
- **No `dark:` classes** (dead CSS). Tokens over hex (hex only as a `var()` fallback). No new `PremiumCard` usage. No `framer-motion` or any runtime animation dependency.
- Grades are strings `"6"`–`"12"`, never integers (P5). Score formula is fixed (P1). XP formula + constants only in `xp-rules`/`xp-config` (P2).
- No `console.log` in prod paths (`no-console` warns except `warn`/`error`).

## 6. Testing

- **Unit/integration:** Vitest. Test files under `apps/host/src/__tests__/`, `packages/*/src/__tests__/`, `supabase/functions/**/__tests__/`. Component tests cover four states, bilingual copy, SWR hooks, and pure helpers (e.g. `pickActionForToday` is exported for exactly this).
- **E2E:** Playwright, specs in `e2e/` (30s timeout, 1 retry, trace on first retry). New journeys get a spec.
- **Structural guards:** `foxy-panel-no-static-embed.test.ts` (no static Foxy panel imports), CI bundle-size gate, secret scan, lint + type-check + auth gate, coverage merge, edge-function Deno tests.
- **Regression catalog:** `.claude/regression/00-header.md` is the authoritative source. When a change touches a P-invariant, add a regression entry and report the gap honestly. Do not claim "regression tests pass" for tests that don't exist.
- **Coverage:** thresholds in `vitest.config.ts` (config wins over any prose number).

## 7. Release gates (sequential, before push)

| Gate | Command / check |
|---|---|
| 1 Type | `npm run type-check` + `npm run type-check:scripts` — exit 0, no new `any`, no uncommented `@ts-ignore` |
| 2 Lint | `npm run lint` — exit 0 |
| 3 Tests | `npm test` — all pass; read the count from vitest's summary, never from a doc |
| 4 Build + bundle | `npm run build` — exit 0; bundle within caps read from source: `grep -nE '^const CAP_' scripts/check-bundle-size.mjs` |
| 5 Domain review | assessment / architect / ai-engineer / backend / ops / testing, per what changed |
| 6 Pre-push | no staged secrets, commit `type(scope): description` |

**Bundle caps (read from source, current 2026-08-06):** `CAP_SHARED_KB = 289` (authoritative first-load total, layout-inclusive), `CAP_PAGE_KB = 260`, `CAP_MIDDLEWARE_KB = 120` (`scripts/check-bundle-size.mjs:166-168`). A page reporting 0.0 kB or zero pages measured is a broken gate (vacuous pass), not a pass.

## 8. Audit severity

Grade findings on the student surface as:

| Severity | Meaning | Examples | Ships? |
|---|---|---|---|
| **S0 Blocker** | Violates a P-invariant (P1–P15) or leaks PII; wrong learner-facing number that misleads | Recomputing mastery/accuracy in the UI, hardcoded XP value, raw error string or PII to a student, bundle over cap, static Foxy embed | No |
| **S1 Critical** | Wrong learner-facing state, broken core interaction, blocking a11y failure | Missing error/empty state, keyboard trap, empty state on a failed fetch, missing denominator on a percentage, no Hindi | No |
| **S2 Major** | WCAG AA failure on content/target size, conformance drift | Sub-44px control, colour-only meaning, `dark:` class added, new `PremiumCard`, no comeback surface for a broken streak | Only with a tracked ticket + sign-off |
| **S3 Minor** | Quality/polish; reduced-motion gap on a loop; focus-order nicety | Soft contrast on a decorative fill, missing `aria-hidden` on a glyph | Yes, with a ticket |
| **S4 Cosmetic** | Styling/typography only, no behaviour impact | Padding nit, shadow consistency | Yes |

**Audit report shape** (per the parent skill): lead with the verdict; for each finding give severity, user impact, evidence (file:line), root cause, and recommended correction. Separate verified facts from inference. Never present a live defect as precedent.

Known open frontend tickets (fix when already in the file; none is precedent): no `<h1>` in the dashboard shell; language toggle below the 44px floor; BoardScore `role="tab"` without `tabpanel`; no `aria-live` for queue updates; no focus management after retry/tab switch; no comeback surface for a broken streak. Full D1–D13 table in `student-dashboard-design`.

## 9. Production Definition of Done

A student feature is done only when **all** of the following hold:

- [ ] **Gates:** type-check (workspaces + scripts), lint, tests, build all pass; bundle within `CAP_SHARED_KB` / `CAP_PAGE_KB` / `CAP_MIDDLEWARE_KB` (read from source).
- [ ] **Complete state model:** loading / loaded / empty / error implemented; empty never renders on a failed or in-flight fetch; partial/stale, offline, locked, completion/undo handled where relevant.
- [ ] **IA:** new destination follows one-name-one-icon; nav entry lives in `nav-config.ts`; flag/grade gating via the existing helpers.
- [ ] **Responsive:** 360px (bottom nav, no rail/aside), 768px (rail), 1024px+ (aside); safe areas handled by the shell; one-handed mode preserved.
- [ ] **Accessibility floor** (experience-contract §8) walked line by line; no new S0/S1/S2 items.
- [ ] **Bilingual (P7):** every user-facing string has a Hindi counterpart.
- [ ] **Learner data:** every surfaced number is a permitted re-presentation; denominators visible; N = 5 respected; assessment sign-off for any derived metric.
- [ ] **No PII** in logs/analytics (P13).
- [ ] **SWR defaults** not overridden without a stated reason; cache headers set on new API routes.
- [ ] **Foxy** (if integrated): via `FoxyPanelLauncher` only; panel off first paint; never outranks the page's primary CTA.
- [ ] **Tests:** unit for new logic + states, E2E for new journeys, structural guard for any invariant touched; regression catalog entry when a P-invariant is touched.
- [ ] **Review chain complete (P14):** assessment if learner data, quality for tokens/a11y/bundle, testing for coverage; backend if API contract changes; **mobile** flagged if a response shape changes.
- [ ] **Hygiene:** no `console.log` in prod paths, no secrets, commit `type(scope): description`.

**Completion rule:** do not declare a student dashboard complete because it renders. Require a functional primary journey (`sign in -> Today -> recommended action -> learning/practice session -> feedback -> updated evidence -> next action`), truthful data, responsive behavior, accessible interaction, defined failure recovery, and evidence that the requested adaptive behavior reaches the UI.
