> **Frontend agent — Wave 1, Stage 1 (static/read-only) certification pass.**
> Generated 2026-07-02. Read-only: no application code was modified to produce this document.
> Scope per mandate: `src/app/**/page.tsx` (177 pages), `src/components/**` (375 files), client
> state/i18n, PWA, SEO, bundle budget (P10). `docs/audit/2026-07-02-discovery/01-frontend-surface.md`
> and `docs/audit/2026-07-02-validation/12-business-workflows.md` were read as supporting evidence
> only — every claim below was independently re-derived from the current tree (commit
> `137eb9749cf7f137fe43c639875889f7f729d49e`, branch `fix/prod-readiness-remaining`) via fresh
> Grep/Glob/Read passes, not copied from those documents.

---

## Task 1 — Page inventory sweep (100% classification)

Full machine-generated table: `docs/audit/2026-07-02-certification/evidence/inventory/pages.csv`
(177 rows, one per `src/app/**/page.tsx`, header `path,portal,tier,auth_gated,e2e_spec_match,bilingual_evidence,verdict`).

### Method
1. `find src/app -name page.tsx` → 177 files (exhaustive, matches discovery doc's count exactly).
2. Portal: derived from path prefix (`/super-admin`, `/school-admin`, `/internal/admin`, `/teacher`,
   `/parent`, `/support`) plus an explicit student/auth/public allowlist built from
   `src/lib/identity/constants.ts` `ROLE_DESTINATIONS` + `src/lib/middleware-helpers.ts`
   `ROUTE_ROLE_RULES` + direct enumeration of `src/app/*/page.tsx` top level.
3. Auth-gated: `ROUTE_ROLE_RULES` prefix match (server-enforced in `src/proxy.ts`) for
   parent/teacher/super-admin/school-admin; everything else classified by direct code read
   (`useRequireAuth`/`useAuth` presence, or absence of any auth hook for public pages).
4. E2E match: regex-extracted every `goto(`/`toHaveURL(`/`page.url().toContain(` string literal
   across all 37 `e2e/**/*.spec.ts` files (not just the 31 top-level ones — nested `grounding/` (6)
   and `synthetic/` (1) subdirs included), normalized (query strings stripped, `${TARGET}` stripped),
   then regex-matched against each page's route pattern (dynamic `[segments]` → `[^/]+`). Exact
   match only — no fuzzy prefix credit, so a route family (e.g. `/parent`) is not falsely credited
   for a child page's spec (e.g. `/parent/children`) or vice versa.
5. Bilingual evidence: `grep -l isHi` on the page file itself only (not nested components) —
   identical method to the discovery doc, reproduced independently: **97/177 hit, 80/177 no-hit**,
   exact match to the discovery doc's count, cross-confirming both passes used the same method
   correctly.
6. Tier: judgment calls documented below (not fully mechanical — flagged where the task's own
   examples conflict).

### Summary counts (from the CSV)

| Portal | Count |
|---|---:|
| super-admin | 62 |
| student | 41 |
| school-admin | 22 |
| public/marketing | 21 |
| teacher | 13 |
| parent | 11 |
| support | 3 |
| auth | 2 |
| dev-orphan | 1 |
| internal-admin | 1 |
| **Total** | **177** |

| Tier | Count |
|---|---:|
| Tier 0 | 17 |
| Tier 0 (dead route, 301-shadowed) | 1 (`/study-plan`) |
| Tier 1 | 82 |
| Tier 2 | 77 |

E2E spec match: **45/177** pages have at least one exact-route hit in an e2e spec (25.4%). Bilingual
evidence: **97/177** (54.8%).

### Tier classification note — the task's own examples conflict
The task text gives `/pricing` as a Tier 2 "static marketing" example, but also defines Tier 0 as
"payment/subscription pages." `/pricing` is not purely static — the discovery doc (confirmed by
direct read) states it carries a live Razorpay checkout CTA. I followed the task's literal Tier 2
example list for `/pricing` (and for `/careers, /contact, /press, /terms, /privacy, /refunds`) to
stay faithful to the instruction, but flag this as a borderline call: `/pricing`'s checkout CTA
makes it arguably Tier 0 by function. This is a classification-methodology note, not a code defect
— **HIGH confidence**, **Informational**.

`/study-plan` is tagged `Tier 0 (dead route, 301-shadowed)`: `page.tsx` + `layout.tsx` + `error.tsx`
still exist and are fully built (confirmed by direct read, 70-line page), but `next.config.js` has a
permanent `301 /study-plan → /exam-prep` redirect, so the page code is unreachable in production. It
still shows an e2e match (`public-pages.spec.ts` references `/study-plan`) — that test is asserting
redirect behavior, not exercising the dead page code. **HIGH confidence**, **Post-Release-Acceptable**
(dead code, not a live defect, but worth a cleanup ticket — same finding as the discovery doc, now
independently re-confirmed by direct file read of `next.config.js` redirects and the `/study-plan`
directory contents).

---

## Task 2 — Bundle budget re-verification (P10)

Raw output: `docs/audit/2026-07-02-certification/evidence/stage-1-static/local-command-output/frontend-bundle-build.log`
(full `npm run build` output, followed by full `node scripts/check-bundle-size.mjs` output, run
back-to-back against the same build artifact, same commit `137eb9749`).

### Commands run
```
npm run build                        # node scripts/auth-guard.js && next build (Turbopack)
node scripts/check-bundle-size.mjs   # P10 gate script
```
Both completed successfully (`EXITCODE:0` for the build; bundle-check script also exited 0).
Note: the first build attempt was killed by a 10-minute tool timeout during the TypeScript-check
phase (Turbopack compile alone finished in 120s); the retry (after confirming no orphaned build
lock/process remained) completed cleanly. This is a tooling artifact of my invocation, not a
project defect — logged for transparency since the log file's first ~10 lines show the earlier
partial run before being cleared and re-run cleanly.

### Results as of THIS run (2026-07-02, commit 137eb9749)

| Metric | Cap (per `.claude/CLAUDE.md` P10 + `scripts/check-bundle-size.mjs`) | Measured | Verdict |
|---|---:|---:|---|
| `CAP_SHARED_KB` (honest, layout-chunk-inclusive first-load total) | 284 kB | **279.9 kB** | **PASS** (4.1 kB headroom) |
| `CAP_MIDDLEWARE_KB` | 120 kB | **116.2 kB** | **PASS** (3.8 kB headroom) |
| `CAP_PAGE_KB` (per-page, page-specific chunks only) | 260 kB | **198.1 kB max** (`/super-admin/entitlements`) | **PASS**, 0/179 pages over cap |

**On `SHARED_JS_LIMIT_KB` (the constitution's "160 kB baseline / single-largest-shared-chunk"
metric):** this is NOT a computed value anywhere in the current `scripts/check-bundle-size.mjs` —
confirmed by grep (`SHARED_JS_LIMIT_KB` does not appear as a variable in any `.mjs`/`.js`/`.ts` file
in the repo). The constitution's own text (`.claude/CLAUDE.md` P10 section) describes it as a
narrative/comment-level concept ("the single-largest-shared-chunk metric... unchanged and passes")
rather than a script-enforced gate — the only script-enforced first-load gate that currently exists
is `CAP_SHARED_KB` (284 kB), which passes. I cannot independently re-verify a "160 kB" number because
no code in the repo currently computes it; treating the constitution's claim that it "passes" as
**NOT VERIFIED-DEFERRED** (no artifact to check it against) rather than confirming or denying it.

Top 15 heaviest pages, all PASS (from the log, page-specific chunks only, cap 260 kB):
`/super-admin/entitlements` 198.1, `/progress` 159.6, `/leaderboard` 144.3, `/super-admin/institutions`
139.9, `/school-admin` 138.9, `/internal/admin` 137.8, `/super-admin` 137.5, `/super-admin/subscriptions`
137.4, `/super-admin/command-center` 137.1, `/super-admin/intelligence/schools` 135.2,
`/super-admin/users` 134.9, `/super-admin/intelligence/schools/[id]` 134.6,
`/super-admin/grounding/health` 134.5, `/super-admin/alfabot` 134.3, `/super-admin/demo` 134.3.

**Verdict: P10 currently PASSES on all three enforced gates, as measured on this run, not merely
asserted from the constitution's stated history.** Headroom is thin on `CAP_SHARED_KB` (4.1 kB /
284 kB = 1.4%) — consistent with the constitution's own narrative of repeated small bumps (270→284
over multiple PRs) tracking framework/dependency drift rather than a comfortable margin.
**Confidence: HIGH** (directly measured, not inferred). **Risk impact: Informational** (currently
passing; the thin headroom on `CAP_SHARED_KB` is worth flagging as a **Should-Fix-Before-Release**
risk item only in the sense that the NEXT routine dependency bump is likely to require another cap
raise or the deferred `@supabase/*` first-paint-splitting fix the script's own comments call out
(TODO #1 in `scripts/check-bundle-size.mjs` lines 41-51) — not a current failure).

---

## Task 3 — User Journey Certification, UI-flow columns (7 roles)

### Role model ground truth (before tracing flows)
`src/lib/rbac-types.ts` `RoleName` (DB-seeded, `roles` table, migration
`20260612123200_rbac_matrix_conformance.sql`) declares **11 roles**: `student, parent, tutor,
teacher, support, reviewer, content_manager, finance, institution_admin, admin, super_admin`.

But the **client-side** `AuthContext.tsx` `UserRole` type (line 27) only has **5 values**:
`'student' | 'teacher' | 'guardian' | 'institution_admin' | 'none'`. And `src/lib/middleware-helpers.ts`
`ROUTE_ROLE_RULES` (server-enforced page gating in `src/proxy.ts`) only recognizes **4 role names**
for portal routing: `guardian, teacher, admin, super_admin, institution_admin` (student has no
explicit rule — `/dashboard` etc. are gated client-side only per the discovery doc, confirmed).
`src/lib/identity/constants.ts` `ROLE_DESTINATIONS` (single source of truth for post-login redirect,
used by login page + callback route + bootstrap API + AuthContext) only maps **4 roles**:
`student → /dashboard, teacher → /teacher, parent → /parent, institution_admin → /school-admin`.

This is the load-bearing fact for the "Content Author" / "Support Staff" sub-question below.

### Per-role UI-flow trace

| Role | Registration (UI) | Dashboard | Reports | Analytics | Notifications | Certificates | Logout |
|---|---|---|---|---|---|---|---|
| **Student** | `/onboarding` (grade/board/goal form, `src/app/onboarding/page.tsx`) — student-only; loading via `<LoadingFoxy/>`, redirects non-student roles away (see gap below) | `/dashboard` (`StudentOSDashboard.tsx`), has route-segment `loading.tsx` + `error.tsx` | `/reports`, `/progress` | `/progress` (charts), `/leaderboard` | `/notifications` page + presumably a bell in shell | **No dedicated UI.** XP-shop "certificate" purchase (`/api/student/shop/purchase` `certificate` handler) only queues a notification ("Certificate is being generated…") — no `Certificate*` component exists anywhere in `src/components/` (confirmed by grep, zero hits) and no PDF/render surface found. Functionally a stub from the frontend's perspective. | Wired via `/profile`, `/settings` (both call `signOut()` from `AuthContext`) |
| **Teacher** | `/teacher/onboarding` (school/subjects) | `/teacher` (`TeacherShell.tsx`) | `/teacher/reports` | `/teacher/reports`, `/teacher/grade-book` | **No dedicated teacher notification page or bell.** `src/components/school/NotificationCenter.tsx` exists but is imported by **nothing** in `src/app/` (confirmed: only 3 hits for `NotificationCenter` repo-wide — its own definition, a domain-types file, and a unit test; zero live mount points). Teacher only has `/teacher/messages` (teacher–parent messaging, a different surface). | Same as Student — no UI surface found for teacher-side certificate issuance/download. | `signOut()` in `TeacherShell.tsx` and `teacher/profile/page.tsx` |
| **Parent** | Link-code redemption at `/parent/children` (`/api/parent/link-code/request-otp`, `/redeem`) — parents don't "register" a student, they attach to one | `/parent` (hosts its own login form; exempt from the role-gate at exact path) | `/parent/reports` | `/parent/reports` (child progress trends, `overall_score`/`performance_scores` client-aggregated — see Task 4) | `/parent/notifications` (dedicated page exists — parent portal has this, teacher portal does not) | No dedicated UI (child's certificate, if any, would surface via the student-side stub above; nothing parent-specific found) | `signOut()` in `parent/page.tsx`, `parent/profile/page.tsx`, `ParentShell.tsx` |
| **School Administrator** (`institution_admin`) | `/school-admin/setup` (setup wizard) | `/school-admin` (`CommandCenter.tsx`) | `/school-admin/reports`, `/school-admin/reports-depth` | `/school-admin/reports-depth` (flag `use-school-reports-depth.ts`) | **Same `NotificationCenter.tsx` orphan gap as Teacher** — no mount point found in `school-admin/` either. `/school-admin/announcements` exists but that's outbound broadcast, not an inbound notification inbox. | No dedicated UI found | `signOut()` in `CommandCenter.tsx` |
| **Super Administrator** | `/super-admin/login` (credential entry, distinct auth mechanism — `admin-session.ts`, sessionStorage-based, per in-file comments similar to `/internal/admin`'s secret pattern) | `/super-admin` (shell home) | `/super-admin/reports` | `/super-admin/analytics`, `/analytics-b2b`, `/intelligence*`, `/learning` | `/super-admin/alerts`, `/observability/*` (ops-defined severity, frontend renders) | N/A (not a certificate-issuing surface) | `signOut()` in `AdminShell.tsx` |
| **Content Author** | **No distinct UI surface exists.** See analysis below. | — | — | — | — | — | — |
| **Support Staff** | **No distinct UI surface exists.** See analysis below. | — | — | — | — | — | — |

### "Content Author" and "Support Staff" — are these real, distinct roles?

**Short answer: they exist as DB-seeded RBAC roles with real permission grants (`content_manager`,
`reviewer`, `support`, `finance` in the `roles` table), but there is NO dedicated frontend
page/portal for any of them, and NO way for a browser session holding only one of these roles to
reach a UI surface that exercises those permissions.**

Evidence chain:
1. `roles` table (migration `20260612123200_rbac_matrix_conformance.sql` lines 83-94) seeds
   `content_manager` (hierarchy_level 60, "Creates and moderates curriculum content"), `reviewer`
   (58, "Content reviewer (approve/reject)"), `support` (55, "Support and operations staff"),
   `finance` (65, "Finance and accounts team") as real, non-system (`is_system_role=false`) roles
   with permission grants (e.g. `content_manager` is granted `content.*`-family permission codes at
   lines 268-278 of the same migration).
2. **But `ROUTE_ROLE_RULES` (`src/lib/middleware-helpers.ts` lines 268-288) — the server-side gate
   that decides which portal prefix a session may load — only recognizes 4 role strings:
   `guardian, teacher, admin, super_admin, institution_admin`.** There is no rule branch for
   `content_manager`, `reviewer`, `support`, or `finance`. A session holding only one of these roles
   cannot pass the gate for `/super-admin/*`, `/school-admin/*`, `/teacher/*`, or `/parent/*`.
3. `getRoleDestination()` (`src/lib/identity/constants.ts` line 64) — the single source of truth for
   post-login redirect, used by login page + auth callback + bootstrap API + AuthContext — falls
   back to `'student'` → `/dashboard` for any role not in its 4-entry `ROLE_ALIASES` map. So a user
   whose *only* role is `content_manager`/`reviewer`/`support`/`finance` would be silently redirected
   to the **student dashboard** on login, not to any admin-adjacent surface, and would then likely
   fail to load a `student` profile row (since they're not actually a student), a scenario the
   `AuthContext`/`onboarding` fallback logic wasn't obviously designed to handle for non-parent/
   non-teacher roles (see the related `/onboarding` gap noted below).
4. There is a **completely separate, unrelated concept** with overlapping names:
   `src/lib/admin-auth.ts` `ADMIN_LEVELS = ['support', 'analyst', 'content_manager', 'finance',
   'admin', 'super_admin']` — this is a hierarchy for **`admin_users` table rows** (internal staff
   who access `/internal/admin` or call `/api/super-admin/*` routes via `authorizeAdmin()`, gated by
   an `x-admin-secret` header / sessionStorage secret, NOT a Supabase-session `RoleName`). The
   `/api/super-admin/users` route (`admin_level` enum, line 86) manages *this* table, not the
   `user_roles`/`RoleName` table. **These are two independently-named, non-overlapping systems that
   happen to share the string `"content_manager"`, `"support"`, `"finance"` — a naming collision
   that is a genuine source of confusion for anyone reading the codebase, even though the two
   systems don't interact.** The `ADMIN_LEVELS` version DOES have a UI path: `/internal/admin`'s
   secret-gated console dispatches by `admin_level`.

**Conclusion for the journey certification:**
- If "Content Author" / "Support Staff" in the mission's 7-role list refers to the `RoleName`
  DB roles (`content_manager`/`reviewer`, `support`): **no distinct frontend portal exists.** These
  are effectively **API-only / dormant roles from a UI perspective** — permission codes are granted
  in the database and would be enforced correctly by any API route that calls
  `authorizeRequest(request, 'permission.code')` (per P9), but no `page.tsx` anywhere in the 177-page
  inventory is reachable by a session holding only these roles. This reads as either (a) intentional
  — these roles are meant for service-to-service/API-key actors, not humans with browser logins, or
  (b) an incomplete rollout where the UI layer hasn't caught up to the RBAC seed. I cannot determine
  intent from static code alone — **flagging for architect/ops clarification**, not asserting a
  defect.
- If "Content Author" / "Support Staff" instead maps to the `ADMIN_LEVELS` internal-staff hierarchy:
  **`content_manager` and `support` levels DO have a UI path** — `/internal/admin`'s 10-tab
  dispatcher (secret-gated, distinct from `/super-admin`), and by extension some `/super-admin/*`
  API routes gated with `authorizeAdmin(request, 'support')` or similar minimum-level checks (e.g.
  `/api/super-admin/users` requires only `'support'` level per line 9) — though the **page-level**
  gate for `/super-admin/*` pages is still the `RoleName`-based `ROUTE_ROLE_RULES` (admin/super_admin
  only), so an `admin_users` row with `admin_level='support'` and no corresponding `RoleName` grant
  of `admin`/`super_admin` would still be blocked from the `/super-admin/*` pages themselves, even
  though their `x-admin-secret`-gated API calls might succeed. This is a plausible **UI/API gating
  mismatch** worth a dedicated architect trace (not confirmed as exploitable from a static read —
  it depends on whether `admin_users` rows are ever provisioned without a matching `user_roles`
  grant, which is outside frontend's visibility).

**Confidence: HIGH** on the structural facts (role lists, route rules, redirect maps — all directly
read from source). **MEDIUM** on the "intentional vs. gap" interpretation (requires architect/ops
input on product intent). **Risk impact: Should-Fix-Before-Release** if these roles are meant to be
human-assignable via a UI today (the redirect-to-student-dashboard fallback for an unrecognized role
is a real rough edge); **Informational** if they are intentionally API/service-only roles reserved
for future UI work.

### Related UI-relevant observations (other agents' primary, noted for completeness per mandate)
- **`/onboarding` role-redirect gap**: `src/app/onboarding/page.tsx` lines 51-58 only redirects
  `activeRole === 'teacher'` or `'guardian'` away; there is no explicit branch for
  `institution_admin`. Since `AuthContext.UserRole` includes `institution_admin`, and nothing else
  in the file's effect handles it, an `institution_admin` session landing on `/onboarding` would fall
  through to `if (!student) return <LoadingFoxy />;` (line 99) and likely hang on an infinite loading
  spinner, since `student` would never populate for a non-student role. **I could not confirm from
  static reading whether `institution_admin` accounts are ever actually routed to `/onboarding`** —
  their own bootstrap flow appears to go through `/school-admin/setup` instead, so this may be an
  unreachable defensive gap rather than a live bug. **Confidence: MEDIUM** (the gap in the code is
  certain; reachability is not statically provable). **Risk impact: Post-Release-Acceptable**
  (defensive-code gap, not a confirmed reachable failure) — flagging for architect/backend to confirm
  no code path can land an institution_admin session on `/onboarding`.
- **Support portal auth pattern**: `/support`, `/support/new`, `/support/[ticket_id]` read
  `isLoggedIn`/`isLoading` from `useAuth()` directly with no `useRequireAuth()` redirect call visible
  in any of the three page files (re-confirmed by direct grep in this pass, matching the discovery
  doc's finding) — this is a different, weaker gating pattern than the rest of the authed surface.
  Not re-verified as exploitable (RLS would still gate the underlying data), but structurally
  inconsistent. **Confidence: HIGH** (grep-confirmed). **Risk impact: Post-Release-Acceptable** /
  worth a follow-up ticket.

---

## Task 4 — Independent re-verification worklist

### 4.1 — Leaderboard client-side re-aggregation (`src/app/leaderboard/page.tsx:168-239`)

**Re-read confirmed: still present, at the cited line range, in the current tree.** Direct read of
lines 140-260 shows:
- Step 1 (line 161): `getLeaderboard(period, 50)` → `src/lib/supabase.ts:752` calls the server RPC
  `get_leaderboard` first, falling back to a direct query on `students.xp_total` (a **server-computed,
  stored field** — not re-summed from raw `quiz_sessions` client-side). This satisfies P1/P2: the XP
  ranking base data is server-authoritative, not recomputed.
- Steps 2-3 (lines 168-245): a **separate enrichment layer** — the client issues its own direct
  Supabase query against the raw `performance_scores` table (`student_id, overall_score, level_name`,
  one row per student per subject — confirmed via `performance_scores_student_id_subject_key` unique
  constraint in `00000000000000_baseline_from_prod.sql:15728`), then computes
  `Math.round(agg.total / agg.count)` per student client-side to derive a cross-subject average
  score, and re-sorts the leaderboard by that derived value.

**Is this genuinely non-defective (client recompute agrees with server value), or a live bug?**
There is **no server-side RPC or view that pre-aggregates `overall_score` across subjects** for a
student (confirmed: grep across all migrations for a cross-subject aggregate function/view on
`performance_scores` found none). So there is no "server value" to disagree with — the client-side
average IS the only place this specific aggregate is computed, for this specific display. Critically,
**this exact same `Math.round(sum/count)` pattern is independently re-implemented in at least three
other places in the codebase**, all querying the same raw `performance_scores` table directly:
  - `src/app/progress/page.tsx:414` — `Math.round(perfScores.reduce((a,p) => a + Number(p.overall_score), 0) / perfScores.length)`
  - `src/components/dashboard/ProgressSnapshot.tsx:46` — `data.reduce((sum, row) => sum + Number(row.overall_score), 0) / data.length`
  - `src/app/parent/page.tsx` (lines 454-487) and `src/app/parent/reports/page.tsx` (lines 1556-1594) — same table, same per-subject shape, consumed for parent-facing display
  - `src/components/quiz/QuizResults.tsx:218-226` — same table, single-subject read (not an aggregate here, but same raw-table pattern)

Since all consumers use the identical formula against the identical raw rows, there is no drift risk
between them — they would all compute the same number for the same student at the same instant.
**This re-confirms the Phase 2 finding's conclusion (non-defective, S3-class cleanup) but narrows its
scope claim**: the phase-2 report frames this as a leaderboard-specific "dead-weight" finding; my
independent read shows it is actually **a platform-wide pattern** (no single source of truth /
no pre-aggregated view or RPC for "average performance score across a student's subjects") that
happens to be most visible in the leaderboard file because that's where it's combined with a
re-sort. The absence of a single canonical RPC is the more accurate characterization of the
maintainability risk (if the aggregation formula ever needs to change — e.g., to weight subjects
differently — it must be changed in 4+ places, which is the actual latent risk, not "wasted CPU
cycles on a redundant compute").

**Verdict: CONFIRMED benign. Tag: Post-Release-Acceptable, reclassified scope from "leaderboard
dead-weight" to "platform-wide missing single-source-of-truth aggregate for `performance_scores`
cross-subject average" — recommend the S3 cleanup ticket be broadened to cover all 4+ call sites, not
just the leaderboard page, if/when it's picked up.** **Confidence: HIGH** (direct read of all 4+
call sites, confirmed identical formula and identical raw-table source).

### 4.2 — Tier-0 loading/error/empty state spot-check

| Page | Loading | Error | Empty | Notes |
|---|---|---|---|---|
| `/login` (`src/app/login/page.tsx` + `src/components/auth/AuthScreen.tsx`) | **Deliberately no full-page loading gate** — in-file comment (lines 68-71) explains this is intentional: "Always show the login form — never block on loading state... prevents infinite spinner when session is stale/expired." Submit-button-level loading state exists (`AuthScreen.tsx` line 68 `const [loading, setLoading] = useState(false)`, set around every submit handler). | Handled: `errorParam` URL-driven bilingual banner (login page lines 74-90) for callback failures, plus `AuthScreen.tsx` line 68 `const [error, setError] = useState('')` with 15+ bilingual `setError(...)` call sites covering every validation/API-failure branch (lines 143-288 sampled). | N/A (form, not a list) | Loading-state absence here is a documented product decision, not an oversight — confirmed by the in-file rationale comment. |
| `/quiz` (`src/app/quiz/page.tsx`, 1874 lines) | `LoadingFoxy` component, dynamic-imported with `loading: () => <LoadingFoxy/>` (line 23); guard `if (isLoading \|\| !student) return <LoadingFoxy/>` (line 1210) and two more `<LoadingFoxy/>` returns (lines 1863, 1873) | `SectionErrorBoundary` imported (`src/components/SectionErrorBoundary.tsx`); route-segment `src/app/quiz/error.tsx` also exists (App Router boundary, catches uncaught render errors) | `getEmptyStateHeading()`/`getEmptyStateSubtitle()` helper functions (lines 1234-1243) feeding bilingual empty-state copy | All three states present and distinctly implemented. |
| `/billing` (`src/app/billing/page.tsx`, 436 lines) | Explicit skeleton (`animate-pulse` blocks, lines 90-150) for both the auth-loading and data-loading phases, rendered as **two separate skeleton branches** (auth skeleton lines 90-102, data skeleton lines 121-151) | Explicit error branch (lines 154-171) with bilingual message + a "Try Again" retry button calling `fetchStatus()` | "Not logged in" branch (lines 105-118) functions as a soft empty/redirect state with bilingual CTA to `/login` | Most thorough of the four spot-checked pages — 4 distinct render branches (auth-loading / not-logged-in / data-loading / error) before the happy path. Also has route-segment `src/app/billing/error.tsx`. |
| `/foxy` (`src/app/foxy/page.tsx`, 2195 lines) | `LoadingFoxy` guard pattern (same as quiz) | `SectionErrorBoundary` wraps the chat surface explicitly (`<SectionErrorBoundary section="Foxy Chat">`, lines 1702 and closed 2168) — the widest, most explicit `SectionErrorBoundary` usage of the four; also `isLoading={conversationsLoading}` passed through to a child list component | `getEmptyStateHeading()`/`getEmptyStateSubtitle()` (lines 1234-1243, same helper pattern as quiz — likely shared or copy-pasted) | Also has route-segment `src/app/foxy/loading.tsx` + `src/app/foxy/error.tsx`. |

**Verdict: all 4 spot-checked Tier-0 pages have genuine, distinct loading/error/(empty-where-applicable)
handling confirmed by direct code read — this is not assumed from the journey-certification mission
framing, it's verified.** The one deliberate deviation (`/login`'s no-full-page-loading-gate) is
documented in-code as an intentional anti-flicker/anti-infinite-spinner decision, not a gap.
**Confidence: HIGH** (direct read of implementation, not grep-heuristic). **Risk impact:
Informational** (no defect found).

### 4.3 — Correction to the discovery doc's error-boundary coverage heuristic
The discovery doc (§6) flags "`SectionErrorBoundary`/`ErrorBoundary` usage: 19/177 page files" as a
"large gap" against the three-states standard, while noting it might undercount if pages rely on a
layout-level boundary instead. **I confirmed this undercounting concern is real and material**:
Next.js App Router `error.tsx` files provide automatic error-boundary coverage for their entire route
subtree (any nested route without its own `error.tsx` inherits the nearest ancestor's). Direct count:
**25 `error.tsx` files** exist across the tree, including portal-root-level ones
(`/parent/error.tsx`, `/teacher/error.tsx`, `/school-admin/error.tsx`, `/super-admin/error.tsx`,
root `src/app/error.tsx`) that cover their entire nested subtree (11 parent pages, 13 teacher pages,
22 school-admin pages, 62 super-admin pages respectively) without each child page needing its own
`error.tsx` or inline `SectionErrorBoundary`. Similarly, **22 `loading.tsx` files** exist, several at
portal-root level (`/parent/loading.tsx`, `/teacher/loading.tsx`, `/school-admin/loading.tsx`,
`/super-admin/loading.tsx`) providing route-level Suspense-boundary loading UI to their subtrees.
**Recommend this correction be reflected in report 09 (Performance) / report 04 (Journey)**: the raw
per-page `SectionErrorBoundary` grep count (19/177) significantly understates actual error-boundary
coverage once route-segment `error.tsx`/`loading.tsx` inheritance is accounted for. I did not attempt
to compute an exact "effective coverage %" (that would require walking the route tree and matching
each of the 177 pages to its nearest ancestor `error.tsx`/`loading.tsx`, which is a larger effort than
this pass's budget allows) — flagging the correction directionally, not with a precise revised number.
**Confidence: HIGH** (file counts directly verified). **Risk impact: Informational** (corrects a
prior document's likely-pessimistic heuristic; does not itself indicate a defect).

---

## Cross-cutting observations worth carrying into reports 03/04/09

1. **Two independently-named, non-overlapping RBAC-adjacent systems share role-name strings**
   (`RoleName.content_manager/support/finance` in `rbac-types.ts` vs. `AdminLevel` in
   `admin-auth.ts`) — see Task 3. Purely a naming-collision readability risk at the code level; no
   evidence of actual privilege confusion (the two systems check different tables/mechanisms), but
   worth an architect-level rename recommendation given it could confuse future contributors or
   auditors (as it nearly did in this pass — required cross-referencing three files to disambiguate).
2. **`e2e/` has 37 spec files** (31 top-level + 6 in `grounding/` + 1 in `synthetic/`), not the "17
   specs" figure in `.claude/CLAUDE.md`'s architecture table — another point-in-time drift in the
   constitution's own numbers, consistent with the doc's self-disclosed "last reconciled 2026-04-27"
   staleness caveat. Not a defect, just a documentation-currency note for whoever next reconciles the
   constitution.
3. **Notification UX is inconsistent across portals**: Student has `/notifications`, Parent has
   `/parent/notifications`, but Teacher and School-Admin have no dedicated notification inbox page,
   and the one shared component built for this purpose (`NotificationCenter.tsx`) is not mounted
   anywhere. **Confidence: HIGH** (grep-confirmed zero live imports). **Risk impact:
   Should-Fix-Before-Release** if teacher/school-admin notification delivery is expected to have a UI
   home (backend's daily-cron and other producers may well be generating notification rows that
   currently have no teacher/school-admin-side surface to read them) — recommend a backend+frontend
   joint check on whether `notification`-type rows are being generated for `teacher`/`institution_admin`
   audiences with no UI consumer.
4. **Certificates feature is a UI stub, not a shipped feature**, for all roles. If "Certificates" is
   expected to be a certifiable journey step per the mission's column list, it should be marked NOT
   READY rather than partially-credited — there is no rendering, download, or display surface
   anywhere in `src/components/` or `src/app/`, only a shop-purchase-triggered notification promising
   future delivery. **Confidence: HIGH**. **Risk impact: Should-Fix-Before-Release** if Certificates
   is a marketed/expected feature for this release; **Informational** if it's known-roadmap and not
   claimed as shipped.

---

## Files referenced in this pass (exact paths, for reviewer cross-check)
- `D:\Alfa_local\Alfanumrik\src\lib\rbac-types.ts` (RoleName, lines 11-14)
- `D:\Alfa_local\Alfanumrik\src\lib\admin-auth.ts` (ADMIN_LEVELS, lines 28-51)
- `D:\Alfa_local\Alfanumrik\src\lib\middleware-helpers.ts` (ROUTE_ROLE_RULES, lines 268-302)
- `D:\Alfa_local\Alfanumrik\src\lib\identity\constants.ts` (ROLE_DESTINATIONS/getRoleDestination, lines 43-67)
- `D:\Alfa_local\Alfanumrik\src\lib\AuthContext.tsx` (UserRole type, line 27; signOut, lines 734-739)
- `D:\Alfa_local\Alfanumrik\src\app\onboarding\page.tsx` (role-redirect logic, lines 43-99)
- `D:\Alfa_local\Alfanumrik\src\app\leaderboard\page.tsx` (lines 140-260)
- `D:\Alfa_local\Alfanumrik\src\app\progress\page.tsx` (line 414)
- `D:\Alfa_local\Alfanumrik\src\components\dashboard\ProgressSnapshot.tsx` (lines 42-46)
- `D:\Alfa_local\Alfanumrik\src\lib\supabase.ts` (getLeaderboard, lines 752-773)
- `D:\Alfa_local\Alfanumrik\src\components\school\NotificationCenter.tsx` (orphan component, zero live imports)
- `D:\Alfa_local\Alfanumrik\src\app\login\page.tsx`, `src\components\auth\AuthScreen.tsx`
- `D:\Alfa_local\Alfanumrik\src\app\quiz\page.tsx` (lines 23, 1210, 1234-1243, 1863, 1873)
- `D:\Alfa_local\Alfanumrik\src\app\billing\page.tsx` (lines 90-171)
- `D:\Alfa_local\Alfanumrik\src\app\foxy\page.tsx` (lines 1234-1243, 1702-2168)
- `D:\Alfa_local\Alfanumrik\scripts\check-bundle-size.mjs` (full file read)
- `D:\Alfa_local\Alfanumrik\supabase\migrations\20260612123200_rbac_matrix_conformance.sql` (lines 60-159)
- `D:\Alfa_local\Alfanumrik\supabase\migrations\00000000000000_baseline_from_prod.sql` (performance_scores schema, lines 12643-19241)
- `D:\Alfa_local\Alfanumrik\src\app\api\student\shop\purchase\route.ts` (certificate handler, lines 321-366)
