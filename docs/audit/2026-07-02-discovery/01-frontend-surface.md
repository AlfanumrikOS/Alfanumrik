> **Phase 1 Discovery — read-only inventory.** No code was modified to produce this document.
> Generated 2026-07-02. Scope: `src/app/**/page.tsx`, `src/components/`, `src/lib/` (client-state
> modules), `next.config.js`, `src/proxy.ts`. Enumeration (section 1) is exhaustive (all 177 page
> files, via `find src/app -name page.tsx`). Deep per-page attributes (loading/error/empty state,
> bilingual coverage, feature-flag gating) are **sampled** — a representative subset was opened and
> read; the remainder is characterized via codebase-wide grep signals which are noted as
> **heuristic** (pattern match, not manual verification) and called out explicitly wherever used.

# Frontend Surface Inventory

## Summary Counts

| Portal | Pages | % of 177 |
|---|---:|---:|
| Public / Marketing | 21 | 11.9% |
| Dev-only / orphan | 1 | 0.6% |
| Auth | 2 | 1.1% |
| Student | 41 | 23.2% |
| Parent | 11 | 6.2% |
| Teacher | 13 | 7.3% |
| School Admin | 22 | 12.4% |
| Internal Admin (legacy ops console) | 1 | 0.6% |
| Super Admin | 62 | 35.0% |
| Support (cross-portal) | 3 | 1.7% |
| **Total** | **177** | 100% |

Note the constitution's frontend-agent portal table (`.claude/agents` prompt) lists far fewer
pages per portal than actually exist on disk (e.g. "Super Admin: 10 pages" vs. **62** found here;
Teacher/Parent tables also under-list current routes; **School Admin isn't in that table's portal
list at all**). See Findings & Gaps (§6) for the full drift accounting.

---

## 1. Page Route Enumeration

Legend for **Auth**: `Public` = no session required · `Authed` = any logged-in user (client-side
`useAuth()`/`useRequireAuth()` gate, no server role check) · `Role:X` = server-side role-gated via
`src/lib/middleware-helpers.ts` `ROUTE_ROLE_RULES` (prefix match) · `Session(cookie)` = gated only
by presence of a Supabase auth cookie in `src/proxy.ts` Layer 0.6, no role check · `Secret` =
gated by an admin secret (sessionStorage / server env), not a Supabase session.

### 1.1 Public / Marketing (21)

| Path | Purpose |
|---|---|
| `/` | Home / landing page |
| `/welcome` | Marketing welcome landing (separate from `/`; sitemap priority 1) |
| `/login` | Auth login screen, all 3 roles |
| `/pricing` | Pricing plans + Razorpay checkout CTA |
| `/about` | Company / about page |
| `/for-parents` | Parent-audience marketing page |
| `/for-schools` | School / B2B marketing page |
| `/for-teachers` | Teacher-audience marketing page |
| `/product` | Product overview marketing page |
| `/demo` | Product demo / sandbox |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/contact` | Contact us |
| `/help` | Help center — FAQ, AlfaBot widget, support-ticket entry |
| `/security` | Security practices page |
| `/research` | Pedagogy research / methodology marketing page |
| `/careers` | Careers / jobs page |
| `/press` | Press / media page |
| `/refunds` | Refund policy |
| `/schools` | B2B school-trial signup landing |
| `/join` | Redeem a school invite code (join a school) |

### 1.2 Dev-only / Orphan (1)

| Path | Purpose | Note |
|---|---|---|
| `/dev/cosmic-preview` | Internal design-system preview for the Cosmic redesign | Not linked from any nav; not in sitemap; ships to prod bundle. Flag: `ff_cosmic_redesign_v1` referenced elsewhere in codebase but preview page itself renders unconditionally per grep sample. |

### 1.3 Auth (2)

| Path | Auth | Purpose |
|---|---|---|
| `/auth/reset` | Public (pre-session) | Password reset flow (P15 critical path) |
| `/onboarding` | Authed | Post-signup onboarding: grade/board (student), school/subjects (teacher), phone/link-code (parent) |

### 1.4 Student Portal (41)

| Path | Auth | Purpose |
|---|---|---|
| `/dashboard` | Authed | Main student home / daily rhythm queue |
| `/quiz` | Authed | Quiz engine — practice / cognitive / exam modes (assessment-owned logic) |
| `/quiz/ncert` | Authed | NCERT-sourced quiz variant |
| `/progress` | Authed | Progress / mastery charts |
| `/study-plan` | Authed | **Dead route** — shadowed by permanent redirect `/study-plan → /exam-prep` in `next.config.js`; see §6 |
| `/foxy` | Authed | AI tutor (Foxy) chat |
| `/profile` | Authed | Student profile + XP shop |
| `/leaderboard` | Authed | Class / school leaderboard |
| `/notifications` | Authed | Notification center |
| `/scan` | Authed | OCR homework-scan solver |
| `/simulations` | Authed | Interactive science/physics simulations (118-component library) |
| `/exams` | Authed | Exam-prep / mock-exam hub |
| `/exams/mock` | Authed | Mock-exam paper picker |
| `/exams/mock/[paperId]` | Authed | Mock-exam runner |
| `/exams/mock/[paperId]/results` | Authed | Mock-exam results |
| `/learn` | Authed | Chapter learning hub (Pedagogy v2 daily rhythm) |
| `/learn/[subject]/[chapter]` | Authed | Chapter reader / lesson view |
| `/learn/foxy-test` | Authed (dev/QA) | Internal Foxy test harness, not in nav |
| `/dive` | Authed | Weekly Curiosity Dive (Pedagogy v2 Wave 2) |
| `/dive/history` | Authed | Dive history archive |
| `/synthesis` | Authed | Monthly Synthesis ritual (Pedagogy v2 Wave 3) |
| `/today` | Authed | "Today" daily-rhythm queue standalone view |
| `/refresh` | Authed | Study Menu v2 — flashcards/chapters refresh hub (destination of `/review`, `/revise` redirects) |
| `/revision` | Authed | Revision OS page (flag: `ff_revision_os_v1` via `use-revision-os-flag.ts`) |
| `/practice` | Authed | Practice OS page (flag: `ff_practice_os_v1` via `use-practice-os-flag.ts`) |
| `/exam-briefing` | Authed | Pre-exam briefing / readiness page |
| `/exam-prep` | Authed | Exam-prep hub — replaces legacy `/study-plan` |
| `/mock-exam` | Authed | Legacy mock-exam entry (predates `/exams/mock`) |
| `/mock-exam/results` | Authed | Legacy mock-exam results |
| `/diagnostic` | Authed | Diagnostic placement test |
| `/hpc` | Authed | CBSE Holistic Progress Card view (reads `/api/synthesis/state`) |
| `/lab-notebook/[studentId]` | Authed | STEM lab notebook, per-student |
| `/settings` | Authed | Account settings |
| `/settings/account/delete` | Authed | Account deletion / DPDP right-to-erasure flow |
| `/billing` | Authed | Student billing / subscription management (Razorpay) |
| `/stem-centre` | Authed | STEM lab / daily-lab-mission center |
| `/challenge` | Authed | Daily challenge / class challenge mode |
| `/pyq` | Authed | Previous Year Questions bank |
| `/tutor` | Authed | Adaptive Tutor Phase 0 (`ff_tutor_v1`; 404-falls-back to "coming soon" when OFF) — distinct experiment from `/foxy` |
| `/library` | Authed | NCERT content library, browse-first (no progress pressure), reuses `/learn` subject/chapter hooks |
| `/reports` | Authed | Root-level student report page (monthly report metrics via `cognitive-engine.ts`) — distinct from `/parent/reports`, `/teacher/reports`, `/school-admin/reports` |

### 1.5 Parent Portal (11)

| Path | Auth | Purpose |
|---|---|---|
| `/parent` | Role:guardian (exempt at exact path — hosts its own login) | Parent portal home / login |
| `/parent/children` | `Session(cookie)` + Role:guardian | Manage linked children, link-code redeem |
| `/parent/reports` | `Session(cookie)` + Role:guardian | Child progress reports |
| `/parent/profile` | `Session(cookie)` + Role:guardian | Parent profile settings |
| `/parent/support` | `Session(cookie)` + Role:guardian | Parent support/help |
| `/parent/attendance` | Role:guardian | Child attendance view |
| `/parent/billing` | Role:guardian | Parent billing / subscription |
| `/parent/calendar` | Role:guardian | School calendar view |
| `/parent/consent` | Role:guardian | DPDP consent management |
| `/parent/messages` | Role:guardian | Parent–teacher messaging |
| `/parent/notifications` | Role:guardian | Parent notification center |

`/parent/{children,reports,profile,support}` carry **both** the middleware Layer 0.6 cookie-presence
check and the Layer 0.65 role rule (`ROUTE_ROLE_RULES`, allowed roles `guardian/admin/super_admin`);
the other 6 `/parent/*` pages rely on the role rule alone (no separate cookie-presence layer).

### 1.6 Teacher Portal (13)

All under `Role:teacher` (`ROUTE_ROLE_RULES` prefix `/teacher`, allowed `teacher/admin/super_admin`).

| Path | Purpose |
|---|---|
| `/teacher` | Teacher portal home |
| `/teacher/classes` | Manage classes |
| `/teacher/students` | Student roster |
| `/teacher/reports` | Class reports |
| `/teacher/worksheets` | Worksheet generator/library |
| `/teacher/profile` | Teacher profile |
| `/teacher/assignments` | Assignment management |
| `/teacher/attendance` | Attendance taking (only page seen with explicit `useRequireAuth('teacher')` client-side role arg — see §1.9) |
| `/teacher/grade-book` | Gradebook |
| `/teacher/lab-leaderboard` | STEM lab leaderboard, teacher view |
| `/teacher/messages` | Teacher–parent messaging |
| `/teacher/onboarding` | Teacher onboarding (school/subjects) |
| `/teacher/submissions` | Assignment submissions review |

### 1.7 School Admin Portal (22)

All under `Role:institution_admin` (`ROUTE_ROLE_RULES` prefix `/school-admin`, allowed
`institution_admin/admin/super_admin`). **Not present in the frontend-agent constitution's Portal
Pages table at all** — see §6.

| Path | Purpose |
|---|---|
| `/school-admin` | School admin portal home |
| `/school-admin/ai-assistant` | Principal AI assistant |
| `/school-admin/ai-config` | AI feature config for the school |
| `/school-admin/announcements` | School announcements |
| `/school-admin/api-keys` | API key management (integrations) |
| `/school-admin/audit-log` | School audit log |
| `/school-admin/billing` | School billing / invoices |
| `/school-admin/branding` | White-label branding config |
| `/school-admin/classes` | Class management |
| `/school-admin/content` | Content management (school-scoped) |
| `/school-admin/enroll` | Student enrollment |
| `/school-admin/exams` | Exam scheduling |
| `/school-admin/invite-codes` | Invite-code management |
| `/school-admin/modules` | Feature-module toggles |
| `/school-admin/parents` | Parent roster |
| `/school-admin/rbac` | School-level RBAC config |
| `/school-admin/reports` | School reports |
| `/school-admin/reports-depth` | Deep-analytics reports (flag: `use-school-reports-depth.ts`) |
| `/school-admin/setup` | School setup wizard |
| `/school-admin/staff` | Staff management |
| `/school-admin/students` | Student roster |
| `/school-admin/teachers` | Teacher roster |

### 1.8 Internal Admin — legacy ops console (1)

| Path | Auth | Purpose |
|---|---|---|
| `/internal/admin` | `Secret` (sessionStorage `alfa_admin_secret`) + `src/proxy.ts` Layer 2.1 gate on `/internal/admin*` + `/api/internal/admin*`, separate `RATE_LIMIT_ADMIN_MAX=60/min` bucket | Thin 10-tab dispatcher (`Logs / Reports / Flags / Support / AIMonitor / Revenue / Schools / Content / Users / Command`), each tab a component under `_components/`. Legacy, predates the `/super-admin/*` panel; still live and gated separately. |

### 1.9 Super Admin (62)

All gated `Role:admin|super_admin` via `ROUTE_ROLE_RULES` prefix `/super-admin`; `/super-admin/login`
is the credential-entry page. Session token stored client-side (`admin-session.ts`), consumed by
`sessionStorage`-based secret pattern similar to `/internal/admin` per code comments in
`super-admin/page.tsx`.

| Path | Purpose |
|---|---|
| `/super-admin` | Super admin home/shell |
| `/super-admin/login` | Admin login |
| `/super-admin/alerts` | Ops alerts |
| `/super-admin/alfabot` | AlfaBot conversation monitor list |
| `/super-admin/alfabot/[sessionId]` | AlfaBot conversation detail |
| `/super-admin/analytics` | Product analytics dashboard |
| `/super-admin/analytics-b2b` | B2B/school analytics dashboard |
| `/super-admin/bulk-actions` | Bulk user/data actions |
| `/super-admin/bulk-upload` | Bulk content upload |
| `/super-admin/bulk-upload/schools` | Bulk school upload |
| `/super-admin/cms` | CMS page-status workflow (backend owns transition logic) |
| `/super-admin/command-center` | Ops command center |
| `/super-admin/content` | Content management |
| `/super-admin/demo` | Demo-mode management |
| `/super-admin/diagnostics` | System diagnostics |
| `/super-admin/entitlements` | Plan entitlements management |
| `/super-admin/flags` | Feature-flag management |
| `/super-admin/foxy-quality` | Foxy/AI response quality dashboard |
| `/super-admin/goal-profiles` | Goal-profile config |
| `/super-admin/grounding/ai-issues` | RAG grounding — AI issue queue |
| `/super-admin/grounding/coverage` | RAG grounding — coverage dashboard |
| `/super-admin/grounding/health` | RAG grounding — health dashboard |
| `/super-admin/grounding/traces` | RAG grounding — trace inspector |
| `/super-admin/grounding/verification-queue` | RAG grounding — human verification queue |
| `/super-admin/health` | System health dashboard |
| `/super-admin/institutions` | Institution (school) management |
| `/super-admin/intelligence` | BI/intelligence hub |
| `/super-admin/intelligence/geography` | Geographic distribution analytics |
| `/super-admin/intelligence/revenue` | Revenue analytics |
| `/super-admin/intelligence/schools` | School-level intelligence list |
| `/super-admin/intelligence/schools/[id]` | School-level intelligence detail |
| `/super-admin/invoices` | Invoice management |
| `/super-admin/learning` | Learner/learning analytics |
| `/super-admin/logs` | System/audit log viewer |
| `/super-admin/marking-integrity` | Marking-authenticity forensic dashboard |
| `/super-admin/marking-integrity/[studentId]` | Per-student marking-integrity detail |
| `/super-admin/misconceptions` | Misconception curator |
| `/super-admin/module-overrides` | Feature-module override management |
| `/super-admin/mol-shadow` | MoL Phase 1A shadow-mode dashboard |
| `/super-admin/oauth-apps` | OAuth client app management |
| `/super-admin/observability` | Observability hub |
| `/super-admin/observability/channels` | Alert delivery channels |
| `/super-admin/observability/rules` | Alert rules config |
| `/super-admin/oracle-health` | Oracle grader health dashboard |
| `/super-admin/rbac` | Platform RBAC matrix viewer |
| `/super-admin/readiness-rubric` | Release-readiness rubric dashboard |
| `/super-admin/reports` | Reporting hub |
| `/super-admin/sla` | SLA dashboard |
| `/super-admin/students/[id]` | Per-student admin detail view |
| `/super-admin/subjects` | Subject catalog management |
| `/super-admin/subjects/grade-map` | Subject-to-grade mapping |
| `/super-admin/subjects/plan-access` | Subject plan-access gating |
| `/super-admin/subjects/violations` | Subject-access violation log |
| `/super-admin/subscribers` | Subscriber list |
| `/super-admin/subscriptions` | Subscription management |
| `/super-admin/support` | Support-ticket admin view |
| `/super-admin/users` | User management |
| `/super-admin/view-as/[studentId]/dashboard` | Impersonation view — student dashboard |
| `/super-admin/view-as/[studentId]/foxy` | Impersonation view — student Foxy |
| `/super-admin/view-as/[studentId]/progress` | Impersonation view — student progress |
| `/super-admin/view-as/[studentId]/quizzes` | Impersonation view — student quizzes |
| `/super-admin/workbench` | Ops workbench |

### 1.10 Support (cross-portal, 3)

| Path | Auth | Purpose |
|---|---|---|
| `/support` | Authed (`useAuth()`, no `useRequireAuth` redirect enforcement observed) | Support ticket list |
| `/support/new` | Authed | New support ticket |
| `/support/[ticket_id]` | Authed | Ticket detail/thread |

All three read `isLoggedIn`/`isLoading` from `useAuth()` directly rather than `useRequireAuth()` —
worth flagging since the pattern differs from the rest of the authed surface (see §6).

---

## 2. Layouts, Route Groups, Redirects, Middleware-Affected Paths

### 2.1 Layouts (34 found via `**/layout.tsx`, plus root `src/app/layout.tsx`)
`dashboard, exams, foxy, help, hpc, internal/admin, leaderboard, mock-exam, notifications, parent,
pricing, privacy, product, profile, progress, pyq, quiz, reports, review*, scan, school-admin,
simulations, study-plan*, super-admin, super-admin/view-as/[studentId], teacher, terms, dive,
dive/history, synthesis, for-parents, for-schools, for-teachers, welcome` + root `layout.tsx`.

`*` = `review/layout.tsx` and `study-plan/layout.tsx` are now vestigial — see §6 (dead-route findings).

### 2.2 Redirects (`next.config.js` `async redirects()`)
| Source | Destination | Permanent | Note |
|---|---|---|---|
| `/review` | `/refresh?tab=flashcards` | Yes (301) | No `page.tsx` remains at `/review` — only `layout.tsx` + `error.tsx` |
| `/revise` | `/refresh?tab=chapters` | Yes (301) | No `/revise` directory exists at all |
| `/study-plan` | `/exam-prep` | Yes (301) | **`page.tsx` + `layout.tsx` still exist at `/study-plan` and are unreachable in production** |

These are Study Menu v2 consolidation redirects (2026-05-20), gated behind `ff_study_menu_v2`
(default OFF) for sidebar-link purposes only — the redirects themselves are unconditional.

### 2.3 Middleware-affected paths (`src/proxy.ts`)
| Layer | Path(s) | Behavior |
|---|---|---|
| 0.6 | `/parent/children`, `/parent/reports`, `/parent/profile`, `/parent/support` | Redirect to `/parent` if no `sb-*-auth-token` cookie present |
| 0.65 | `/parent/*` (exempt at exact `/parent`), `/teacher/*`, `/super-admin/*`, `/school-admin/*` | Server-side role-prefix enforcement via `ROUTE_ROLE_RULES` (`findRouteRule()`) |
| 2.1 | `/internal/admin*`, `/api/internal/admin*` | Secret-gated, own 60 req/min rate bucket |
| 2 | `/wp-*`, `/phpmy*`, `*.php`, `*.env`, `/.git*`, `/admin*` (excluding `/internal/admin`), `/cgi-bin*` | Bot/scanner path block |
| — (comment-documented, not enforced in middleware) | `/dashboard, /quiz, /foxy, /progress, /learn, /profile, /reports, /study-plan, /review, /scan, /notifications, /exams, /leaderboard, /hpc, /simulations, /stem-centre, /research, /billing` | "STUDENT_PROTECTED" list — **enforcement is entirely client-side** (`AuthContext` + RLS); no cookie/session check happens in `proxy.ts` for these paths. `/study-plan` and `/review` appear in this list even though they now 301-redirect before any page code runs. |
| — | `/manifest.json` | Rewritten to `/api/school-config/manifest` (white-label PWA manifest) |
| Cache-Control header rule | `/(dashboard\|foxy\|quiz\|progress\|review\|study-plan\|leaderboard\|simulations\|profile\|notifications\|reports\|scan\|exams\|help)` | `public, max-age=60, stale-while-revalidate=300` — again references `/review` and `/study-plan`, both now redirect-shadowed or page-less |

Rate-limit buckets: general 600 req/min/IP, parent 20 req/min/IP, `/internal/admin` 60 req/min/IP.

---

## 3. Shared Component Inventory (`src/components/`)

Top-level, non-exhaustive-count method: `find <dir> -name "*.tsx" | wc -l` per directory (includes
nested subfolders, so counts include e.g. `dashboard/os/*`).

| Directory | ~Files | Purpose (sampled) |
|---|---:|---|
| `simulations/` | 118 | Interactive physics/science simulation components — by far the largest component surface |
| `dashboard/` | 26 | Dashboard cards/sections (`DailyChallenge`, `ExamReadiness`, `FoxyBannerCard`, `os/*` subfolder) |
| `landing/` | 25 | Marketing landing sections (`Footer(V2)`, `FAQV2`, `FinalCTA(V2)`, `CredibilityStrip`) |
| `foxy/` | 18 | Foxy chat UI (`ChatBubble`, `ChatInput`, `ConversationManager`, `FoxySessionComplete`) |
| `admin-ui/` | 11 | Shared super-admin chrome (`DataTable`, `DetailDrawer`, `ScoreBar`, `charts/`) |
| `alfabot/` | 11 | AlfaBot landing-page widget (`AlfaBotLauncher`, `AlfaBotMount`, scope-lock UI) |
| `learn/` | 11 | Chapter reader UI (`ChapterReadinessBadge/Card/View`, `os/*`) |
| `quiz/` | 11 | Quiz UI — `QuizSetup`, `QuizResults`, `FeedbackOverlay`, `MisconceptionExplainer` (assessment-reviewed) |
| `cosmic/` | 10 | Cosmic redesign design-system primitives (`CosmicButton`, `GlowCard`, `MasteryRing`) |
| `school/` | 10 | Cross-portal school-branding widgets (`SchoolAnnouncementBanner`, `NotificationCenter`) |
| `challenge/` | 6 | Daily/class challenge UI |
| `parent/` | 6 | Parent-portal widgets (`ParentGlanceHome`, `WeeklyReport`, `ParentChildChat`) |
| `review/` | 6 | (Legacy — flagged `os/` subfolder only; page itself redirect-shadowed) |
| `pulse/` | 7 | Student Pulse UI (`StudentPulse`, `SchoolPulsePanel`, `PulseTimeline`) — flag `ff_school_pulse_v1` |
| `practice/` | 7 | Practice OS UI |
| `exam-briefing/` | 7 | Exam-briefing UI |
| `school-admin/` | 4 | Wraps `principal-ai/` subfolder |
| `responsive/` | 4 | `AppShell`, `MobileNav`, `Touchable`, `Breadcrumbs` — shared responsive shell primitives |
| `xp/` | 4 | XP display widgets (`XPProgressRing`, `XPDailyStatus`, `XPRewardShop`) |
| `refresh/` | 4 | Study Menu v2 refresh-hub sections |
| `navigation/` | 3 | `DesktopSidebar`, `GlobalAppLayout`, `MobileBottomNav`, `nav-config.ts` |
| `exams/` | 3 | Mock-test runner/results/paper-card |
| `study-plan/` | 3 | (Legacy — page redirect-shadowed) |
| `onboarding/` | 3 | `OnboardingFlow`, `StreamStep`, `SubjectStep` |
| `progress/` | 3 | Progress-page charts (assessment-reviewed data contracts) |
| `ui/` | 5 | Generic primitives (`toast`, `SkillTree`, `RoadmapNode`, `SoundToggle`) |
| `score/` | 2 | `ScoreCard`, `ScoreHero` |
| `dive/`, `synthesis/`, `grounding/`, `today/`, `stem/` | 2 each | Pedagogy v2 / grounding / today-queue / STEM widgets |
| `achievements/`, `auth/`, `coins/`, `goals/`, `scan/`, `subjects/` | 1 each | Single-purpose widgets |
| Loose files at `src/components/` root | ~26 | `ErrorBoundary.tsx`, `SectionErrorBoundary.tsx`, `Skeleton.tsx`, `PermissionGate.tsx`, `PostHogProvider.tsx`, `SchoolThemeProvider.tsx`, `JsonLd.tsx`, `NetworkStatus.tsx`, `PWAInstallPrompt.tsx`, `UpgradeModal.tsx`, `CookieConsent.tsx`, `MaintenanceBanner.tsx`, `DemoModeBanner/Wrapper.tsx`, etc. |

---

## 4. Client State

### 4.1 Contexts
| Context | File | Shape (abridged) |
|---|---|---|
| `AuthContext` | `src/lib/AuthContext.tsx` | `authUserId, student, snapshot, teacher, guardian, roles: UserRole[], activeRole, setActiveRole, isLoggedIn, isLoading, isHi/language, theme (light/dark/hc/system)` — marked `⚠️ CRITICAL AUTH PATH` in-file |
| `SchoolContext` | `src/lib/SchoolContext.tsx` | White-label tenant config (school branding, consumed via `x-school-*` headers set in `proxy.ts`) |
| `CosmicThemeProvider` | `src/lib/cosmic-theme.tsx` | Resolved `data-theme` for the cosmic redesign, only meaningful when `ff_cosmic_redesign_v1` is ON |
| `PostHogProvider` | `src/lib/PostHogProvider.tsx` / `src/components/PostHogProvider.tsx` | Analytics provider, lazy-loaded per P10 budget note |

### 4.2 SWR (`src/lib/swr.tsx`)
Default config tuned for Indian 4G: `revalidateOnFocus: false` (per-hook override), `revalidateOnReconnect: true`, `dedupingInterval: 10000`, `errorRetryCount: 2` with exponential backoff (no retry on 4xx), `keepPreviousData: true`. `STATIC_CONFIG` variant: 60s dedupe + 5-min poll for near-static data. Hooks exported: `useStudentProfiles`, plus wrappers around `getSubjects`, `getStudentSnapshot`, `getFeatureFlags`, `getStudyPlan`, `getReviewCards`, `getLeaderboard`, `getStudentNotifications`, `getMasteryOverview`. Only **13 page files** call `useSWR` directly (most SWR consumption is via these named hooks or via components, not raw `useSWR` in the page).

### 4.3 localStorage / offline surfaces
- `src/lib/offlineStore.ts` — `alf_`-prefixed localStorage cache, 24h TTL, versioned envelope (`CACHE_VERSION`), used for offline progress/flashcard continuity (explicitly localStorage, not IndexedDB, per in-file comment: "upgrade to IndexedDB if data exceeds 5MB").
- `public/sw.js` (118 lines) — service worker, cache-first for fonts/icons per `next.config.js` header rules; registered via `src/lib/RegisterSW.tsx`.
- 29 files under `src/` reference `localStorage` directly (grep count, includes non-page lib modules like `use-atlas-flag.ts`, `use-foxy-os-flag.ts`, and 7+ per-page usages in `library/page.tsx` "recently explored" strip, `school/pending-invite.ts`, etc.) — not all funneled through `offlineStore.ts`, i.e. **two parallel localStorage patterns coexist** (raw `localStorage.*` calls vs. the `cacheSet`/`cacheGet` wrapper). Flagged as inconsistency in §6.

---

## 5. Page → API Dependency Map (best-effort)

Method: `grep -o "fetch(['\"\`]/api/..." src/app/**/page.tsx` — catches only **direct `fetch()` calls
written inline in the page file itself**. Pages that fetch via `useSWR` wrapper hooks
(`src/lib/swr.tsx`), `src/lib/supabase.ts` helpers, or a nested component (e.g. `admin-ui/DataTable`,
`school-admin/authed-fetch.ts`) are **not captured** here even though they do call APIs — this is
a known gap in the grep method, not evidence those pages are API-free. 40 page files had at least
one direct-`fetch` hit; all matches are tabulated below (76 individual call sites).

| Page | API endpoint(s) called directly |
|---|---|
| `/dive` | `/api/dive/state`, `/api/dive/start` |
| `/dive/history` | `/api/dive/history` |
| `/synthesis` | `/api/synthesis/state`, `/api/synthesis/parent-share` |
| `/hpc` | `/api/synthesis/state` |
| `/challenge` | `/api/learner/weak-topics` |
| `/demo` | `/api/client-error` |
| `/billing` | `/api/payments/status`, `/api/payments/cancel` |
| `/diagnostic` | `/api/diagnostic/start`, `/api/diagnostic/complete` |
| `/exams` | `/api/exams/sync-mastery` |
| `/join` | `/api/schools/join` |
| `/leaderboard` | `/api/v1/leaderboard/mastery` |
| `/help` | `/api/foxy`, `/api/support/tickets` |
| `/foxy` | `/api/foxy/feedback`, `/api/student/foxy-interaction` |
| `/profile` | `/api/student/shop/purchase` |
| `/quiz` | `/api/rhythm/remediation/{id}/resolve`, `/api/rhythm/today` |
| `/tutor` | `/api/tutor/next`, `/api/tutor/answer` |
| `/parent/consent` | `/api/parent/billing`, `/api/parent/consent` |
| `/stem-centre` | `/api/student/daily-lab/claim` |
| `/schools` | `/api/schools/trial` |
| `/parent/children` | `/api/parent/link-code/request-otp`, `/api/parent/link-code/redeem` |
| `/settings/account/delete` | `/api/v1/account/delete` |
| `/support/new` | `/api/support/tickets` |
| `/parent/billing` | `/api/parent/billing`, `/api/payments/cancel` |
| `/super-admin/bulk-upload` | `/api/super-admin/bulk-upload` |
| `/teacher/students` | `/api/teacher/students/{id}/notes` |
| `/school-admin/content` | `/api/school-admin/content`, `/api/school-admin/content/bulk` |
| `/school-admin/parents` | `/api/school-admin/parents`, `/api/school-admin/classes` |
| `/super-admin/module-overrides` | `/api/super-admin/module-overrides` |
| `/super-admin/misconceptions` | `/api/super-admin/misconceptions` |
| `/teacher/profile` | `/api/teacher/profile` |
| `/school-admin/classes` | `/api/school-admin/classes` |
| `/super-admin/login` | `/api/super-admin/login` |
| `/teacher/lab-leaderboard` | `/api/teacher/lab-leaderboard` |
| `/school-admin/exams` | `/api/school-admin/exams`, `/api/school-admin/classes` |
| `/teacher/classes` | `/api/teacher/classes`, `/api/teacher/classes/{id}`, `/api/teacher/classes/{id}/archive` |
| `/school-admin/reports` | `/api/school-admin/reports`, `/api/school-admin/classes` |
| `/teacher/assignments` | `/api/teacher/assignments` |
| `/school-admin/billing` | `/api/school-admin/invoices` |
| `/school-admin/announcements` | `/api/school-admin/announcements`, `/api/school-admin/classes` |
| `/super-admin/goal-profiles` | `/api/super-admin/goal-profiles` |

14 additional pages use a fetch wrapper instead of raw `fetch()` (found via grep for
`authed-fetch`/`school-admin/authed-fetch` imports): `parent/support`, `parent/calendar`,
`teacher/messages`, `parent/messages`, `school-admin/{setup,rbac,modules,invite-codes,enroll,
branding,api-keys,audit-log,ai-config}`, `parent/notifications` — their actual endpoints are inside
the wrapper call sites, not captured by the literal-`fetch` grep.

---

## 6. Findings & Gaps

**Portal-table drift vs. constitution.** The frontend agent's own system-prompt "Portal Pages"
table and `.claude/CLAUDE.md`'s file map both undercount the current surface:
- Super Admin: constitution says "10 pages" / `.claude/CLAUDE.md` says "43 pages" (reconciled
  2026-04-27); actual count on disk today is **62 page files**. Both numbers are stale.
- Teacher: constitution's frontend-agent table lists 6 pages (`/teacher, classes, students,
  reports, worksheets, profile`); actual is **13** (missing `assignments, attendance, grade-book,
  lab-leaderboard, messages, onboarding, submissions`).
- Parent: constitution's frontend-agent table lists 5 pages; actual is **11** (missing
  `attendance, billing, calendar, consent, messages, notifications`).
- **School Admin (22 pages) is not represented in the frontend-agent's Portal Pages table at all**,
  despite being clearly frontend-owned (`src/app/school-admin/*/page.tsx`) and role-gated in
  middleware alongside teacher/parent/super-admin.
- Student portal: constitution's table lists 12 pages; actual is **41**, including two full
  generations of overlapping features (`/mock-exam` vs `/exams/mock`, `/study-plan` [dead] vs
  `/exam-prep`, `/review` [dead] vs `/refresh`, `/tutor` vs `/foxy`).
- `/internal/admin` (legacy secret-gated ops console, distinct auth mechanism from `/super-admin`)
  is not mentioned in either agent-facing document's page inventory.

**Dead / orphaned routes (confirmed by direct file read, not just grep):**
1. `/study-plan` — `page.tsx` (70 lines) + `layout.tsx` + `error.tsx` still exist and are fully
   built, but `next.config.js` has a permanent 301 `/study-plan → /exam-prep`, making the page code
   unreachable in production. It is also still listed in the proxy's "STUDENT_PROTECTED" comment
   and in the `next.config.js` Cache-Control header path group — both now reference a route that
   never reaches page code.
2. `/review` — `layout.tsx` (10 lines) + `error.tsx` remain with **no `page.tsx`**; the route is
   entirely redirect-driven (`/review → /refresh?tab=flashcards`). The leftover layout/error files
   are dead weight.
3. `/dev/cosmic-preview` — no inbound nav link found; ships to the production bundle with no
   auth gate observed in the sampled read; likely fine for an internal design-tool but not
   documented anywhere as intentionally public.
4. `/learn/foxy-test` — naming and lack of nav linkage strongly suggest a QA/dev harness page
   shipping at a real, guessable, authed URL.

**Duplicate/overlapping student features** (legacy + replacement coexisting, not officially
deprecated for all of them): `/mock-exam` + `/mock-exam/results` (legacy) vs. `/exams/mock/*`
(current); `/tutor` (Adaptive Tutor Phase 0, flag `ff_tutor_v1`) vs. `/foxy` (production AI tutor) —
both reachable simultaneously with no cross-link found in the sampled reads.

**Auth-pattern inconsistency.** Most authed pages use `useRequireAuth()` (redirect-on-fail hook);
the grep for `useRequireAuth\(` found only **5 literal call sites** across the entire `src/app`
tree, four of them bare (`useRequireAuth()`) and only `teacher/attendance` passing an explicit role
argument (`useRequireAuth('teacher')`). The 3 `/support/*` pages instead read `useAuth()` directly
with no enforced redirect visible in the sampled lines — meaning route protection there is weaker
/ different in shape from the rest of the authed surface and worth an architect/frontend review to
confirm it's intentional (support may be reachable pre-verification by design, or this may be a gap).

**Two parallel localStorage caching patterns.** `src/lib/offlineStore.ts` provides a versioned,
TTL'd `cacheSet/cacheGet` wrapper, but 29 files reference `localStorage` directly instead of going
through it (e.g., `library/page.tsx`'s "recently explored" strip, several `use-*-flag.ts` hooks).
Not a bug per se, but a maintainability/consistency gap — no single source of truth for what's
cached, for how long, or under what key prefix.

**Missing/loading/error/empty state — sampled + heuristic signal only.** Full manual verification
of all 177 pages' three-state handling (per Implementation Standard #1) was out of scope for this
read-only pass. Codebase-wide grep signals (heuristic, pattern-based, may both over- and
under-count depending on idiom used):
- `isLoading` bilingual flag `isHi` referenced: **97/177** page files.
- Explicit `<Skeleton>` component usage: **32/177** page files (many others likely use inline
  spinner/`LoadingFoxy` patterns not captured by this grep — e.g. `/reports`, `/tutor` both use
  `LoadingFoxy` from `@/components/ui`, not `<Skeleton>`).
- `SectionErrorBoundary`/`ErrorBoundary` usage: **19/177** page files — this is a large gap against
  Implementation Standard #1 ("three states per page") if taken at face value; recommend a
  dedicated audit pass (not this document) before treating it as a confirmed defect, since some
  pages may rely on a shared error boundary at the layout level instead of per-page.
- `useFeatureFlag`/`ff_`-literal/`isFeatureEnabled` references: **39/177** page files.
- Some kind of loading-branch pattern (`isLoading ? / loading && / if (isLoading)`): **61/177**.
- Some kind of empty-state pattern (`.length === 0` / "empty state" / `EmptyState`, case-insensitive,
  noisy signal): **114/177** — likely over-counts (matches unrelated `.length === 0` checks that
  aren't rendering an empty state).
Recommend: a dedicated `testing`/`quality` audit pass using each page's actual render tree rather
than grep, since this document's mandate was read-only enumeration, not verification.

**Bilingual (P7) coverage gap by count.** 80/177 pages (177-97) show no `isHi` grep hit at all.
Some of these are legitimately English-only by design (e.g., `/super-admin/*` internal ops tooling
is not a P7-covered "user-facing" surface for students/parents/teachers), but others in this set
are student/parent/teacher-facing (e.g., `/mock-exam`, `/simulations` component internals — page
itself didn't match but nested components might carry `isHi` instead, which this page-level grep
would miss). Needs assessment/frontend follow-up to separate "correctly English-only admin tooling"
from "should be bilingual and isn't."

**Sitemap/crawlability oddity.** `src/app/sitemap.ts` lists `/dashboard`, `/foxy`, `/leaderboard`,
`/progress`, `/exams`, `/scan`, `/stem-centre` under a comment "App pages (indexable but
auth-gated)" — i.e., these authed pages are intentionally submitted to search engines for SEO
even though an anonymous crawler will only ever see the client-side auth-redirect shell. Flagging
as a design choice to confirm with ops/SEO owner, not asserting it's wrong.

**API dependency map is necessarily partial** (see §5 caveat) — 40 pages showed direct `fetch()`
calls, 14 more use a `school-admin/authed-fetch` wrapper, and the remainder (over 100 pages) either
call zero APIs (static marketing pages), or fetch exclusively through `src/lib/supabase.ts`
helpers / SWR hooks / nested components, none of which this grep method surfaces. A true page→API
contract map would require either static analysis with import-graph resolution or per-page manual
tracing — out of scope for this pass.
