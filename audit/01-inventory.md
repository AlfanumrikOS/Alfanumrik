# 01 — Frontend Inventory & Duplication Census

Date: 2026-09-03 · Repo: `AlfanumrikOS/Alfanumrik` @ `2cfd6348` (working tree on `fix/p2-1-dependency-upgrades`, only package.json/lock files modified — untouched) · Live DB: Supabase `shktyoxqhundlvkiwguu` (ap-south-1) · Live host: Vercel `prj_1PRfOVHYbSemMYSU5DXCMIUG9sda`, domains `alfanumrik.com`, `www`, `*.alfanumrik.com`.

Proof standard: every number below comes from a command run in this session, a live query, or a file:line. `.md` files in the repo were not used as sources. Raw outputs are in `audit/evidence/` (file names in brackets).

## 0. Scope facts that change the engagement brief

| Claim in brief | Verified state | Proof |
|---|---|---|
| "Dual-hosted on Vercel + AWS ECS Fargate" | **Single host.** The Fargate host was decommissioned 2026-08-03. All four DNS names resolve to Vercel. | `.github/workflows/production-cron-runner.yml:47-50` ("AWS Fargate host was decommissioned on 2026-08-03"); `nslookup alfanumrik.com / www / app / api` → 216.150.1.x/216.150.16.x (Vercel); no `aws-actions`/`ecs`/`docker build` step in any of the 30 workflows (`grep -rn -i "aws-actions\|ecs \|fargate" .github/workflows/*.yml` → only that comment). `Dockerfile` and `next.config.js` `DEPLOY_TARGET` branch remain on disk (dead). |
| "Middleware `middleware.ts`" | File is `apps/host/src/proxy.ts` (1,569 lines; Next.js 16 naming), enforced by `scripts/auth-guard.js` at build. | `apps/host/package.json` build script; `apps/host/src/proxy.ts:1565-1569` matcher. |
| Production is open to HTTP clients | **Every page returns 429 + "Vercel Security Checkpoint" to non-browser clients**, including a Googlebot user-agent; only `/api/v1/health` answers 200. | `curl` sweep of 50 paths → 429 (evidence: session log); `curl -A Googlebot /robots.txt` → 429 text/html. Browser (in-app + headless Chromium) passes. |

## 1a. Route & surface inventory

### Totals (from `find apps/host/src/app` — [evidence/inventory.json], [evidence/routes-table.md])

| Artifact | Count | Notes |
|---|---|---|
| `page.tsx` | **206** | 185 are `'use client'` (90%). Largest: `/quiz` 3,095 lines, `/learn/[subject]/[chapter]` 3,028, `/foxy` 2,602, `/parent/reports` 2,174, `/super-admin/institutions` 1,790. |
| `layout.tsx` | 35 | Root + 34 nested. 5 role shells (see §1a.4). |
| `loading.tsx` / `error.tsx` / `not-found.tsx` | 22 / 23 / 1 | 54 pages fall back to the root `loading.tsx`; 50 pages to the root `error.tsx` (inventory.json `nearestLoading/nearestError`). |
| `route.ts` | 409 (407 under `src/app/api`, 2 auth callbacks) | [evidence/agent-api-routes.csv] |
| Edge Function dirs on disk | 59 (+`_shared`) | 62 deployed (§1c.3). |

### 1a.1 Who can reach what — the actual gate model (code, not docs)

| Layer | Routes | Behaviour | Proof |
|---|---|---|---|
| Layer 0.65 role gate | `/parent/*`, `/teacher/*`, `/super-admin/*`, `/school-admin/*` | Redirects wrong-role users; **fail-open** on any lookup failure; **only enabled when `NODE_ENV=production`** (or `ENABLE_LAYER_065`). | `packages/lib/src/middleware-helpers.ts:365-386` (`ROUTE_ROLE_RULES`), `apps/host/src/proxy.ts:1085-1140` |
| Layer 0.6 session gate | `/parent/children`, `/parent/reports`, `/parent/profile`, `/parent/support` only | Cookie presence check → `/parent` | `proxy.ts:915-921` |
| Layer 2.1 | `/internal/admin/*` (page + API) | Server-side super_admin session required | `proxy.ts:1300+` (comment block "Layer 2.1") |
| Layer 2.5 | `/` | Unauthenticated → `/welcome` | `proxy.ts:1372-1385` |
| Student pages (`/dashboard`, `/quiz`, `/foxy`, `/progress`, `/learn`, `/profile`, `/reports`, `/exam-prep`, `/review`, `/scan`, `/notifications`, `/exams`, `/leaderboard`, `/hpc`, `/simulations`, `/stem-centre`, `/research`, `/billing`, `/today`, `/me`, `/settings`, `/tutor`…) | **No server-side gate.** Enforcement is client-side (`useAuth`/`useRequireAuth` redirects after hydration). | `proxy.ts:1270-1281` ("STUDENT_PROTECTED routes … enforcement is client-side") |
| `/super-admin/*` pages | **No server-side page gate** (only API routes are gated by `authorizeAdmin`); chrome renders ~150 ms before client redirect. | `apps/host/src/app/super-admin/layout.tsx:10-27` (explicit comment), `_components/AdminShell.tsx:105` `useAdmin` |
| `/dev/ui`, `/dev/cosmic-preview` | Hard 404 in production | `proxy.ts:750-757` |
| `/tests`, `/demo`, `/super-admin/demo`, `/learn/foxy-test` | `/tests` and `/demo` have **no production gate** (`/tests` is `ff_exam_schedule_v1`-gated client-side, `apps/host/src/app/tests/page.tsx:6-8`); `/learn/foxy-test` 404s in prod (`page.tsx:22-23`). | inventory.json `devGate` |

### 1a.2 Redirect stubs (20 pages that exist only to bounce)

`/practice/exam→/exam-prep`, `/quiz/ncert→/quiz`, `/rewards→/leaderboard`, `/simulations→/stem-centre`, `/parent/home`, `/parent/plan→/parent/calendar`, `/parent/settings`, `/school-admin/{academics,governance,insights,overview,people,settings}→/school-admin/*`, `/super-admin/alerts→/super-admin/observability/rules`, `/teacher/{assign,grade,insights→reports,resources,settings}`, `/upgrade→/pricing`. Proof: inventory.json `redirectStub` (each ≤40 lines with `redirect()`/`router.replace`), e.g. `apps/host/src/app/school-admin/overview/page.tsx:10-11`. Plus 8 `next.config.js` redirects (`/review`, `/revise`, `/study-plan`, `/mock-exam`, `/mock-exam/:path*`, `/practice/exam/mock`, `apps/host/next.config.js:170-190`) and 2 proxy redirects (`/guardian/*→/parent/*`, `/school/*→/school-admin/*`, `proxy.ts:760-780`).

### 1a.3 Pages with zero inbound links (35) — [evidence/inbound-links.json]

`/learn/foxy-test`, `/progress/dashboard`, `/quiz/ncert`, `/rewards`, `/simulations`, `/auth/reset`†, `/dev/cosmic-preview`, `/dev/ui`, `/exam-briefing`, `/internal/admin`†, `/join`, `/parent/home`, `/parent/plan`, `/parent/settings`, `/school-admin/{academics,governance,insights,overview,people,settings}`, **`/schools`** (the school marketing page; not in nav, footer, or sitemap), **`/settings`** (student settings page, 800 lines, only reachable by URL), `/super-admin/ai-quality`, `/super-admin/alerts`, `/super-admin/foxy-report/[studentId]`, `/super-admin/subjects/{grade-map,plan-access,violations}`, `/teacher/{assign,grade,insights,onboarding,resources,settings}`, **`/tutor`**.
† reached by email link / typed URL by design. Method: grep of `href=`, `href:`, `push(`, `replace(`, `redirect(`, `destination:` for each static route prefix across app+ui+lib+next.config, excluding the page's own folder and tests.

### 1a.4 Duplicate / parallel surfaces — verdicts with routing proof

| Group | Surfaces | What the router/nav actually sends users to | Verdict |
|---|---|---|---|
| Student home | `/today` (nav-config `CORE_TABS[0]`, `altHrefs:['/dashboard']`), `/dashboard` (`StudentOSDashboard`, 1,403-line shell), `/me` (`ff_me_v2` ON), `/` (client redirect to `/dashboard` for students, `apps/host/src/app/page.tsx:41-55`), `/welcome` | Login destination is `/dashboard` (`middleware-helpers.ts:destinationForRole`, `page.tsx`), but the primary nav tab is `/today` (`packages/ui/src/navigation/nav-config.ts:77-88`). Two homes are live. | **DUPLICATE (P1)** |
| Landing | `WelcomeV3` (default) vs `WelcomeV2` (`?v=2`, 3,163-line CSS module, 14 importers) vs legacy `packages/ui/src/landing/Hero.tsx` local `Nav` | `apps/host/src/app/welcome/page.tsx:31` | V2 still wired; retire |
| Foxy surfaces | `/foxy` (2,602 lines, own `FoxyTopBar`, sheets), `/foxy/snap`, `/scan`, `/tutor` (`ff_tutor_v1` OFF → "coming soon"), `/learn/foxy-test` | `/foxy` is nav slot 3; `/tutor` is orphan + flag OFF; `/scan` linked once from `constants.ts:149`. | `/tutor` + `/api/tutor/*` are dead code carrying the banned word |
| Admin consoles | `/super-admin/*` (62 pages, `AdminShell`) vs `/internal/admin` (1 page, 11 tab components, own `/api/internal/admin/*` 12 routes) | `/internal/admin` has no inbound link; support tickets are only readable there (`SupportTab`). | **DUPLICATE (P1)** — two consoles, two auth paths (Layer 2.1 vs `authorizeAdmin`) |
| Support | `/support` (+`/new`, `/[ticket_id]`), `/super-admin/support`, `/super-admin/support/tickets`, `/internal/admin` SupportTab, `/parent/support` (own local `Toast`) | 2 tickets in DB; 4 UIs. | DUPLICATE |
| Subscriptions | `/super-admin/subscribers`, `/subscriptions` (PaymentOpsTab), `/entitlements`, `/invoices`, `/institutions` (billing) | All in AdminShell nav, overlapping data. | DUPLICATE (P2) |
| Health/observability | `/super-admin/health`, `/diagnostics`, `/observability` (+rules, channels), `/oracle-health`, `/synthesis-health`, `/logs`, `/sla`, `/readiness-rubric` | 8 nav entries. | DUPLICATE (P2) |
| Content/CMS | `/super-admin/content` vs `/cms` vs `/school-admin/content` vs `/super-admin/grounding/verification-queue` | separate tables (`question_bank`, `cms_*`, `school_questions`). | PARTIAL DUPLICATE |
| School-admin IA | `/school-admin` (CommandCenter) + 5 redirect stubs; `/people` vs `/staff` vs `/teachers` vs `/students` vs `/parents` | `ConsolidatedSchoolNav.tsx` links `/staff`, `/teachers`, `/students`, `/parents` separately (people→students). Orange-legacy body kept at `_deprecated_AtlasSchoolAdmin.tsx` (not rendered, `school-admin/page.tsx:6-10`). | Legacy remnant on disk; nav has 26 entries (>7) |
| Settings/profile | `/settings` (orphan), `/profile`, `/me`, `/parent/profile`, `/parent/settings` (stub), `/teacher/profile`, `/teacher/settings` (stub), `/school-admin/settings` (stub), `/settings/whatsapp` | Student has 3 live "account" pages. | DUPLICATE (P2) |
| Reports | `/reports` (student, linked once), `/progress`, `/progress/dashboard` (orphan), `/parent/reports`, `/school-admin/reports` vs `/reports-depth`, `/teacher/reports`, `/super-admin/reports` | | PARTIAL |
| Bulk import | `/super-admin/bulk-upload` (CSV students, template), `/super-admin/bulk-upload/schools`, `/super-admin/bulk-actions`, `/school-admin/enroll` (+`roster/validate`), `/api/school-admin/students/bulk-import` (JSON), `/api/internal/admin/bulk-action` | Four different import contracts. | DUPLICATE (P1) |
| Login | `/login` (AuthScreen, 4 role tabs), `/parent` (own form), `/super-admin/login`, `/join`, `/onboarding`, `/teacher/onboarding` | Three login forms. | DUPLICATE (P2) |
| Billing | `/billing`, `/upgrade`(→`/pricing`), `/pricing`, `/parent/billing`, `/parent/plan`(stub), `/school-admin/billing` | | PARTIAL |
| Exams | `/exams`, `/exams/mock`, `/exam-prep`, `/exam-briefing` (orphan), `/tests` (flag), `/practice`, `/practice/exam`(stub), `/pyq` | | PARTIAL |

Full per-page table (206 rows, with layout chain, gate, guard lines, inbound links): [evidence/routes-table.md].

### 1a.5 App shells (chrome) — 6 distinct implementations

| Shell | File | Lines | Nav data | Used by |
|---|---|---|---|---|
| `GlobalAppLayout` + `DesktopSidebar`/`TabletNavRail`/`MobileBottomNav`/`NavMoreSheet` | `packages/ui/src/navigation/*` | 2,156 | **data-driven** (`nav-config.ts` CORE_TABS/MORE_ITEMS/SIDEBAR_SECTIONS; `getCoreTabs(role)` also has teacher/guardian branches that no shell uses) | students only (`GlobalAppLayout.tsx:78-100` excludes every other prefix) |
| `ParentShell` (+`ParentMobileNav`, `DashboardSidebar`) | `apps/host/src/app/parent/_components/` | 262+301 | hand-built items | `/parent/*` |
| `TeacherShell` (+`TeacherMobileNav`) | `apps/host/src/app/teacher/_components/` | 311+320 | hand-built | `/teacher/*` |
| `SchoolAdminShell` + `ConsolidatedSchoolNav` | `apps/host/src/app/school-admin/_components/` | 358+652 | hand-built, 26 hrefs | `/school-admin/*` |
| `AdminShell` | `apps/host/src/app/super-admin/_components/AdminShell.tsx` | 554 | hand-built, 53 hrefs, imported by 62 pages | `/super-admin/*` |
| `/internal/admin` page tabs | `apps/host/src/app/internal/admin/page.tsx` | 184 | hand-built tabs | `/internal/admin` |
| Also: `MarketingShell` (`packages/ui/src/landing/v3/marketing/`), 6 page-local `Navbar` copies (`/careers`, `/contact`, `/press`, `/refunds`, `/research`, `/security`), `RoleShell` (0 importers), `AppShell` (`packages/ui/src/responsive/AppShell.tsx`, 4 importers). | | | | |

Nav item counts vs the ≤7 target: student 4 core + 14 more (18); parent 10; teacher 12; school-admin 26; super-admin 53.

## 1b. Design-system census — [evidence/design-census.txt], [evidence/census-out.txt]

### Token sources (6 parallel systems)

| Source | Location | Size | Proof |
|---|---|---|---|
| Tailwind theme (colors map to CSS vars, radii, shadows, `sp-*`, `tap-*`) | `apps/host/tailwind.config.js` | 1 file; `darkMode` selector pointed at a value never written (dark mode deliberately dead) | `tailwind.config.js:22`, `:33-40` |
| `globals.css` `:root` "Atlas/light" block | `packages/ui/src/globals.css:6-351` | 125 custom props | design-census.txt |
| `[data-theme="dark-disabled-pending-cleanup"]` | `globals.css:379-420` | 22 props (dead) | |
| Second `:root` blocks | `globals.css:875-881`, `:1572-1663` | 5 + 52 props (fluid type + tap tokens) | |
| Cosmic skin | `html[data-design="cosmic"]` `globals.css:3586-3792` (+light/hc/parent/teacher/school variants `:3816-3959`) | 100 + 34 + 12 + 24 props; `ff_cosmic_redesign_v1` is **ON at 100%** in production (live `feature_flags`) | |
| CSS modules | `welcome-v2.module.css` 3,163 lines (14 importers), `welcome-v3.module.css` 2,690 (32), `marketing-v3.module.css` 231 (5), `alfabot.module.css` 830 (9) | own colours/type per module | |
| Code constants | `packages/lib/src/cosmic-theme.tsx`, `cosmic-fonts.ts`, `momentum-fonts.ts`, `packages/ui/src/dashboard/os/palette.ts`, `packages/lib/src/confetti-palette.ts` | | |

Totals: **385 custom-property declarations, 209 distinct names** (prefix families: `--space*` 21, `--text*` 17, `--z*` 10, `--radius*` 8, `--shadow*` 7, plus `--v3-*`, `--orange`, `--purple`, `--cream`, `--ink`, `--accent`). Theme mechanisms in use: `data-theme` (16 files), `data-design` (13), `data-role` (14), `CosmicThemeProvider`, `SchoolThemeProvider` (white-label), `prefers-color-scheme` (3) — five switching axes.

### Hard-coded values

| Metric | Count | Worst offenders |
|---|---|---|
| 6-digit hex literals in TS/TSX | **9,000+** (simulations 2,699; super-admin 1,723; teacher 678; parent 409; school-admin 212) | `parent/reports/page.tsx` 201, `super-admin/institutions/page.tsx` 169, `super-admin/bulk-upload/page.tsx` 103 |
| Top hex values | `#DC2626` 438, `#E8581C` 384, `#16A34A` 364, `#9CA3AF` 348, `#7C3AED` 310 | i.e. brand orange/purple and Tailwind greys are re-typed instead of tokenised |
| `style={{…}}` inline | 12,000+ (super-admin 2,267; simulations 2,211; teacher 871) | |
| Tailwind arbitrary `[#hex]`/`[Npx]` | 1,500+ (super-admin 492) | |
| Type scale | 5 competing systems: Tailwind `text-*` 3,969 uses; inline `fontSize:` 3,294; `text-[Npx]` 1,362; `.text-fluid-*` 212; `var(--text-*)` 31 | |
| Fonts | 9 families referenced (Plus Jakarta Sans, Sora, Inter, Roboto, Fraunces, Space Grotesk, Mukta, Noto Sans Devanagari, Hind); loaded from `next/font` in 2 lib files + `fonts.googleapis.com` links in `app/layout.tsx` and `welcome/layout.tsx` | measured 284 KB of font bytes on `/` (perf-results.json) |

### Component implementations (distinct definitions; ≥2 = duplication)

| Primitive | Distinct impls | Busiest | Notes |
|---|---|---|---|
| Button | 12 | `wonder-blocks.tsx` `Button` (59 importers) vs `ui/primitives/Button.tsx` (4) vs `cosmic/CosmicButton` (2) | 3 "official" kits |
| Input/Field | 18 | `wonder-blocks` `Input` 17 vs `primitives/Input` 1 | |
| Select/Menu | 11 | | |
| Toggle/Checkbox/Switch | 15 | `primitives/Checkbox` 1, `Switch` 1 | |
| Card | **77** | `wonder-blocks` `Card` 61, `admin-ui/StatCard` 40, `primitives/Card` 8; 42 page-local cards | |
| Modal/Sheet/Drawer | **42** | `wonder-blocks` `SheetModal` 13, `admin-ui/DetailDrawer` 10, `primitives/Dialog` 2 | |
| Table | 12 | `admin-ui/DataTable` 24, `primitives/Table` 1, `wonder-blocks` `ResponsiveTable` 4 | no sortable/bulk-select/paginated table exists |
| Nav/shell/header | **47** | see §1a.5 | |
| Toast/banner | 17 | `ui/toast.tsx` `Toaster` 1 importer (root layout); pages hand-roll banners | |
| Tabs | 24 | `primitives/Tabs` 1 importer | |
| Badge/Chip | 28 | `admin-ui/StatusBadge` 50, `wonder-blocks` `Badge` 27 | |
| Skeleton/Loading | **72** | `wonder-blocks` `Skeleton` 63, `Skeleton.tsx` kit 3-13 | |
| Empty state | 8 | `wonder-blocks` `EmptyState` 30, `admin-ui/NoDataState` 7 | |
| Error state | 35 | 23 near-identical `error.tsx` files | |
| Stat/KPI | 18 | `admin-ui/StatCard` 40 | |
| Avatar 4 · Breadcrumb 1 · **Pagination 0** · **Search/Command palette 0** · Progress 17 | | | no ⌘K anywhere (`grep -rn cmdk|CommandPalette` → 0) |

Raw `<button>` elements inside role surfaces: super-admin 369 (87 files), teacher 122, school-admin 86, parent 85, foxy 37. Stubs: 23 two-to-eight-line re-export shims still in `apps/host/src` (census-out.txt §A).

Visual drift evidence (same primitive on 5 screens): `audit/evidence/alfanumrik/login-m.png` (orange gradient CTA, AuthScreen), `pricing-m.png` (PricingV3 CTA), `for-schools-m.png` (MarketingShell CTA), `super-admin_login-m.png` (admin login CTA), `contact-m.png` (page-local Navbar + form button). Headless capture; see 03-journeys for screens.

## 1c. Hooks, API routes, middleware, Edge Functions

### Hooks — [evidence/hooks-list.tsv], [evidence/hooks-importers.tsv]

120 exported `use*` hooks. **19 orphans (0 importers):** `useAtlasFlag`, `useClassList`, `useDebounce`, `useDebouncedValue`, `useExamMode`, `useInViewOnce`, `useIsModuleEnabled`, `useLearnerDecision(s)`, `useRealtimeOpsEvents`, `useSchoolAdminCtx`, `useSimulations`, `useStudentProfiles`, `useStudyPlan`, `useSubjects`, `useTenantConfig`, `useTenantConfigValue`, `useTenantType`, `useVoicePlayback`. **Duplicated files:** `useFoxyOS.ts`, `useRealtimeRevalidator.ts`, `useRealtimeSubscription.ts`, `useTouchAndMouse.ts` exist in both `apps/host/src/hooks/` and `packages/lib/src/hooks/` (both `useFoxyOS` copies hard-code `API_BASE_URL='/api/py'`, a rewrite to `/api` that serves nothing — `next.config.js:196-199`). Auth/permission: `useAuth` (191 files) vs `useAdmin` (68) vs `usePermissions`; flags: `useFeatureFlags` vs `useAtlasFlag` (orphan) vs `isFeatureEnabled`. Client code calls Supabase directly (`.from(`) in **57 files** ([evidence/supabase-client-tables.tsv]; `students` 9, `school_admins` 6, `curriculum_topics` 4 …).

### API routes — [evidence/agent-api-routes.csv] (407 rows, 39 columns)

| Metric | Value |
|---|---|
| Auth wrapper (first match) | `authorizeRequest` 186 · `authorizeAdmin` 97 · `authorizeSchoolAdmin` 35 · `verifyCronAuth` 23 · `auth.getUser` 16 · env-secret 9 · `authorizeOperator` 4 · API-key 6 · other 8 · **none 23** |
| Of the 23 "none": 7 are false positives (school-admin report/pulse routes gate through `resolveCommandCenterContext` → `authorizeRequest`, `packages/lib/src/school-admin/command-center-context.ts:122`). Genuinely unauthenticated: `/api/alfabot/inquiry`, `/api/alfabot/lead`, `/api/error-report`, `/api/oauth/authorize`, `/api/schools/claim-admin`, `/api/tenant/config` (all use the **service-role client**), plus public GETs `/api/auth/pre-check`, `/api/client-error`, `/api/feature-flags/{check,voice}`, `/api/health`, `/api/public/v1/openapi`, `/api/school-config{,/manifest}`, `/api/schools/trial`. | |
| Super-admin tier (`authorizeAdmin` level literal) | `support` 34 · `admin` 11 · `super_admin` 23 · mixed 32 · none stated 28 |
| Validation | zod/`validateBody` in **71** routes; **336 have none**; **169 mutating routes with no schema validation**. UUID checks present in 60 routes (55 dynamic-segment routes). |
| Audit log call on mutating admin/teacher/school routes | 101 of 121 (20 missing: `/api/teacher/{assignments,classes,classes/[id],classes/[id]/archive,escalate,join-class,messages,parent-notify,profile,remediation,students/[id]/notes}`, `/api/school-admin/{gst-details,roster/validate}`, `/api/super-admin/{ai/[fn],logout,observability/rules/[id]/test,projectors/replay}`, `/api/internal/{agents/chapter-explorer,cron/*}`) |
| Bounded list queries | 18 flagged unbounded (e.g. `/api/teacher/students`, `/api/v2/exam-schedule`, `/api/super-admin/foxy-quality`, `/api/revision/overview`) |
| Rate limiting | 19 routes |
| Frontend callers | **83 routes have no frontend caller** (ORPHAN-FRONTEND; 21 are cron/webhook by design). Notable dead product routes: `/api/student/{profile,study-plan,daily-lab,exam-simulation,stem-observation}`, `/api/school-admin/{students,teachers,analytics,data-export,contracts,webhooks,integrations/*}`, `/api/v1/*` (11), `/api/v2/{quiz/start,quiz/questions,learn/concept,parent/glance,student/leaderboard}`, `/api/public/v1/*`, `/api/oauth/*`, `/api/teacher/{students,join-class,classes/available}`. |
| `withRoute()` envelope adoption | 17 of 407 |
| Namespace duplication | `/api/student/*` vs `/api/students` vs `/api/school-admin/students` vs `/api/super-admin/students`; `/api/exam` vs `/api/exams`; `/api/quiz` vs `/api/v2/quiz` vs `/api/practice`; `/api/foxy` vs `/api/tutor`; `/api/v1/*` (21) vs `/api/v2/*` (14) vs unversioned. |

### Middleware matchers

Single matcher `/((?!_next/static|_next/image|favicon.ico|sw.js|icons|robots.txt).*)` (`proxy.ts:1565-1569`) — runs on every request incl. all API routes. Layers: tenant resolution (0), `/api/v1/*` auth-header check (0.5), parent cookie gate (0.6), role gate (0.65, fail-open), bot paths (2), `/internal/admin` (2.1), `/`→`/welcome` (2.5), Upstash rate limits with in-memory fallback (3), CSP/security headers.

### Edge Functions — [evidence/edge-census.tsv], live `list_edge_functions`

| Metric | Value |
|---|---|
| On disk (index.ts) | 59 |
| Deployed (live API) | **62** — 3 with **no source in git**: `account-purge` v40, `data-erasure-purger` v35, `edge-health-audit` v22 |
| Tombstones (return 410) still deployed ACTIVE | 13: `foxy-tutor` (v74, still receiving hits: 3 invocations in the last 24 h, `function_edge_logs` fn `72d66c23`), `cme-engine`, `agent-orchestrator`, `agent-worker`, `auth-write-skeleton`, `embed-ncert-books`, `embed-rag-remaining`, `rag-answer-v3/v4/v5`, `rag-query-v3`, `rag-ingest-batch`, `rag-ingest-status` |
| Invoked from the web app | `grounded-answer` (Foxy live path via `packages/lib/src/ai/grounded-client.ts:239`), `ncert-question-engine` (direct from `(student)/quiz/page.tsx:1680`), `quiz-generator` (`packages/lib/src/supabase.ts:1733`), `parent-portal` (8 call sites), `teacher-dashboard` (9), `ncert-solver`, `scan-ocr`, `board-score`, `nep-compliance`, `send-welcome-email`, `send-transactional-email`, `whatsapp-notify/send`, `alfabot-answer`, `alfabot-send-inquiry`, `daily-cron`, `send-pre-debit-notice` |
| Invoked only by pg_cron / other functions | `alert-deliverer` (every minute, 36,615 audited calls/30d), `projector-runner` (*/2), `projector-health-check` (*/5), `synthetic-host-monitor` (*/5), `coverage-audit`, `monthly-synthesis-builder`, `verify-question-bank`, `webhook-dispatcher` |
| Correlation-id logging (`requestId`/`x-request-id`) | present in 33 of 46 live functions; **absent** in `teacher-dashboard` (5,064 lines, 9 app callers), `parent-portal` (1,613 lines, 8 callers), `scan-ocr`, `identity`, `session-guard`, `grade-written-answer`, `invoice-generator`, `send-renewal-reminder`, `webhook-dispatcher`, `alfabot-answer`, `bulk-jee-neet-curated-import` |
| Auth pattern not detected in handler by census (needs manual read before asserting) | `alfabot-answer`, `bulk-non-mcq-gen`, `bulk-question-gen`, `extract-ncert-questions`, `generate-answers`, `generate-concepts`, `generate-embeddings`, `grounded-answer` (signed by `grounded-client.ts:197` `INTERNAL_CALLER_SIGNING`), `ncert-question-engine`, `parent-report-generator`, `projector-*`, `queue-consumer`, `send-transactional-email`, `synthetic-host-monitor`, `verify-question-bank`, `whatsapp-notify`, `whatsapp-send` |
| `verify_jwt` | `false` on 61 of 62 deployed functions (only `edge-health-audit` true) |

Duplicate function families: email ×5 (`send-auth-email`, `send-welcome-email`, `send-transactional-email`, `send-renewal-reminder`, `send-pre-debit-notice` + Node `packages/lib/src/email-delivery.ts`, all Mailgun); WhatsApp ×2 (`whatsapp-notify`, `whatsapp-send`); embeddings ×5 live (`embed-diagrams`, `embed-ncert-qa`, `embed-questions`, `generate-embeddings`, `extract-*`) + 3 tombstones; question generation ×4 (`bulk-question-gen`, `bulk-non-mcq-gen`, `ncert-question-engine`, `quiz-generator`); JEE/NEET import ×2; answer pipelines: `grounded-answer` (live) vs `ncert-solver` vs `alfabot-answer` vs 4 rag-answer tombstones.

## 1d. Live schema snapshot (queried via Supabase MCP `execute_sql`, not migrations/types)

| Metric | Live value | Generated types (`apps/host/src/types/database.types.ts`, 31,970 lines, last regenerated in commit `07d61656` 2026-08-31) |
|---|---|---|
| Tables (public) | **427**, all with RLS enabled; 43 have RLS but **zero policies** (advisor `rls_enabled_no_policy`; e.g. `users`, `assessments`, `coupons`, `invite_codes`, `school_subscriptions`, `textbooks`, 12 `security_*` tables) | 426 — missing only `_feature_flags_dead_flags_backup_20260831` |
| Views | 26 | 26 |
| Functions | 687 distinct names (726 overloads); 445 SECURITY DEFINER; **57 SECDEF anon-executable**, 176 authenticated-executable (advisors) | 443 — **17 live functions absent from types**: `activate_subscription`, `atomic_quiz_profile_update`, `award_xp`, `bkt_update`, `check_rate_limit`, `get_quiz_questions`, `get_user_permissions`, `match_rag_chunks_ncert` (Foxy's live retrieval RPC), `school_admin_attach_created_student`, `school_admin_list_students`, `school_admin_student_create_preflight`, `school_admin_toggle_student_active`, … |
| Security advisors | 1,140 lints: 417 `pg_graphql_anon_table_exposed`, 424 authenticated-exposed, 57 anon SECDEF, 176 auth SECDEF, 21 `function_search_path_mutable`, 2 `extension_in_public` (vector, pg_trgm), 0 ERROR-level | [evidence/advisors-security.json] |
| Anon probes (placeholder UUIDs, anon key) | `foxy_get_student_state`/`foxy_get_student_timeline` → 400 "not authorized"; `get_user_role`/`security_resolve_user_context` → 400 "own identity only"; `is_active_admin(uuid)` → **200 false** (anon oracle); `get_feature_flag_envelope('ff_tutor_v1')` → **200 {enabled:false…}** (anon flag oracle); `get_school_by_domain` → 200 [] (intended) | session log |
| Row counts (live) | students 75 (30 active non-demo), teachers 9, guardians 5, schools 15, school_admins 2, classes 10, admin_users 4, auth.users 43; question_bank 18,765 (18,469 active); curriculum_topics 542 / chapters 551 / cbse_syllabus 1,148 (**three chapter taxonomies**); rag_content_chunks 27,778 (all `ncert_2025`, `vector(1024)`, model tag split `voyage-3` 13,859 / `voyage/voyage-3` 13,919 — no RPC filters on it); foxy_sessions 2,065; quiz_sessions 112; payment_history 5; feature_flags 202 (140 enabled); support_tickets 2; **0 rows** in assignment_submissions, mock_test_attempts, student_attendance, grade_book_entries, teacher_parent_messages, school_announcements, parent_weekly_reports, parental_consent, school_invite_codes, payment_webhook_events, admin_impersonation_sessions | |
| Indexes on hot tables (`pg_indexes`) | students 18, question_bank 38 (incl. HNSW), rag_content_chunks 24 (HNSW + GIN), quiz_sessions 12 (`student_id, idempotency_key`), notifications 7 (`recipient_id, type, idempotency_key`), payment_history 11 (`razorpay_payment_id` unique), audit_logs 9, curriculum_topics 15, cbse_syllabus 4, chapters 5 | |
| pg_cron | 23 jobs; `embedding-backfill-tick` **inactive**; retention jobs for `foxy_chat_messages` (90d) etc. present | |
| Vercel crons (`apps/host/vercel.json`) | 15 schedules incl. `/api/cron/whatsapp-drain` every minute | |

Schema reads by the frontend that hit tables with RLS-but-no-policy: none found for client-side `.from()` calls (57 client files use tables that all have ≥1 policy) — service-role routes are unaffected.

## 1e. Counts carried to Gate 1

Duplicate surface groups: **16** (§1a.4) · shells: **6** (+6 page-local navbars) · component duplication: Card 77, Nav 47, Modal 42, Skeleton 72, Badge 28, Tabs 24, Input 18, Toast 17, Progress 17, Toggle 15, Button 12, Table 12 · token systems: **6** · redirect stubs: 20 · orphan pages: 35 · orphan hooks: 19 · duplicated hook files: 4 · API routes without frontend caller: 83 · Edge tombstones deployed: 13 · deployed functions without source: 3 · schema drift: 1 table + 17 functions.
