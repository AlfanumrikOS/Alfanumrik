# 03 — Role-by-Role Journey QA

Date: 2026-09-03. Viewports: 360×800 (Moto G4 emulation, DPR 2) and 1366×768. Screenshots: `audit/evidence/alfanumrik/<page>-m.png` / `-d.png`, `protected-<route>.png`; traces: `audit/evidence/evidence-log.json`.

**Constraint stated up front:** no role could be logged in. Entering passwords is prohibited for me, the CEO's browser held no session, and `ff_demo_accounts_v2` is OFF (6 `demo_accounts` rows, no self-serve entry). Logged-in journeys below are therefore reconstructed from the nav data structures, page code, API census, live row counts (which show whether a screen has ever held data) and the unauthenticated redirect traces. Every screen a signed-out visitor can reach was walked and captured. Decision D-1 in the Gate-1 summary asks for session hand-off so the walk can be completed on real accounts.

## 0. Entry surfaces (walked live)

| Screen | Mobile capture | Observed | Defects |
|---|---|---|---|
| `/` → `/welcome` (302 by `proxy.ts:1372`) | `root-m.png` | Title "AI Tutor for CBSE Students (Class 6–12) — Alfanumrik"; hero "Every chapter … समझा"; subline "Foxy — the AI tutor built on your NCERT"; cookie bar covers the bottom 20% of the viewport incl. the hero CTA; hero text is `opacity:0` until JS reveals it (LCP 13.1 s throttled). Two `<h1>` elements (desktop + mobile copies) with the rotating words concatenated into one string. | J-01, J-07, J-21, J-29 |
| `/pricing` | `pricing-m.png` | "Every plan includes Foxy, your personal AI tutor" (banned term); ₹299/₹699/₹1,099 match `plans.ts`; "What ₹500/month replaces" comparison; scroll-reveal sections render blank in a full-page capture; footer says "Foxy AI tutor". | J-01 |
| `/login` | `login-m.png` | Fox mascot, tagline "AI Tutor for CBSE Students", role tabs Student/Teacher/Parent/School, email+password, Forgot, Create Account. Client validation copy present ("Min 8 characters…"). Footer "© 2026 Cusiosense Learning India Pvt. Ltd." (spelling to confirm; same in `/about` title). | J-01, J-29 |
| `/parent` | `parent-m.png` | Separate "Parent Dashboard — Enter your child's link code" form; a parent arriving from `/login` (Parent tab) and one arriving at `/parent` see different flows. | J-08 |
| `/super-admin/login` | `super-admin_login-m.png` | Navy/grey "SUPER ADMIN CONSOLE" — a third visual system (no brand colour, different input style). | J-19 |
| `/join`, `/onboarding` | `join-m.png`, `onboarding-m.png` | `/onboarding` redirects to `/login` when signed out; `/join` renders a code-entry screen with no back link. | — |
| `/demo` | `demo-m.png` | Lead form → `demo_requests` (2 rows live). Works. | — |
| `/for-schools`, `/for-parents`, `/for-teachers`, `/product`, `/about`, `/contact`, `/schools`, `/help`, `/privacy`, `/terms` | `*-m.png` | Render; `/schools` (₹99/seat page) is orphaned from nav/footer/sitemap and carries the default title + canonical `/`. `/about` and `/product` mention "tutor" 4× and 2×. | J-01, J-15, J-21 |
| `/internal/admin` signed out | `protected-internal_admin.png` | HTTP 401 raw HTML "ðŸ” Access Denied" — emoji mojibake (response lacks `charset`). | J-28 |
| `/billing` signed out | `protected-billing.png` | Renders "Please log in to view billing." inline, no shell, no redirect (every other student route redirects to `/login`). | J-20 |
| `/dev/ui` | — | 404 (correct). `/tests` → `/login`. | — |

Unauthenticated redirect trace (29 routes, `evidence-log.json`): every student/teacher/school-admin route → `/login`; `/parent/*` → `/parent`; `/super-admin*` → `/super-admin/login?from=session_invalid`; `/guardian` → `/parent`; `/school` → `/login`; `/upgrade` → `/pricing`. All redirects are client-side after a 200 HTML shell except `/dev/*` (404) and `/internal/admin` (401), confirming `proxy.ts:1277`.

## 1. Student

**Entry:** `/login` (Student tab) → `/dashboard` (`destinationForRole`) while the nav's home is `/today` (`nav-config.ts:78`). Two homes (J-08).
**Nav (data-driven, `nav-config.ts`):** Today · Practice · Foxy · Progress · More(14): Reminders, What Foxy remembers, Leaderboard, STEM Lab, [PYQ, Revision, Assignments, My Exams, Subjects, Curiosity Dive, Monthly Synthesis, NCERT Library — all behind `ff_nav_groups_v1` which is **OFF** live, so 8 destinations are unreachable from nav], Profile, Me (`ff_me_v2` ON), Help, My Tickets.
**Reachable screens and states (code + live data):**

| Screen | Data path | Live data | State risk |
|---|---|---|---|
| `/today` (`TodayHomeV2`) | `/api/v2/today` (curriculum via `get_chapter_titles_for_pairs`) | 16 calls/30 d | fine |
| `/dashboard` (`StudentOSDashboard`, 1,403 lines) | `/api/dashboard/reviews-due` (unbounded), `useAllowedSubjects` | 24 calls/30 d | loads 4 widgets; `BoardScoreWidget` 849 lines with 63 inline styles |
| `/practice`, `/quiz` (3,095 lines) | 6 question paths (02 §D-1); direct Edge call from the page | 10 sessions/30 d | Anti-cheat client+server; `/quiz` renders nothing until auth resolves |
| `/foxy` (2,602 lines) | `/api/foxy` → `grounded-answer` | 242 msgs/30 d | Own shell (`FoxyTopBar`), nav hidden on tablet/desktop by design; persist failure intermittent (C-005) |
| `/progress`, `/progress/dashboard` (orphan), `/reports` | `concept_mastery`, `student_learning_profiles` | 89 mastery rows | 1,583-line page; `DataErrorCard`/`DataPendingCard` local copies |
| `/learn`, `/learn/[subject]/[chapter]` (3,028 lines), `/library` | `chapters` + `curriculum_topics` + `cbse_syllabus` (02 §E.4) | | renders `null` while loading (inventory `nullWhileLoading`) |
| `/exams`, `/exams/mock`, `/exam-prep`, `/exam-briefing` (orphan), `/tests` | `mock_test_attempts` **0**, `student_exam_entries` no write path | | `/tests` add/edit shows "coming soon" |
| `/assignments` | `assignments` **0 rows** | | permanent empty state in production |
| `/dive`, `/synthesis` | flags scoped to development/staging (`target_environments`) / OFF | | empty shells in production if reached |
| `/leaderboard` (1,399), `/stem-centre`, `/hpc`, `/lab-notebook/[id]`, `/challenge`, `/diagnostic`, `/scan`, `/foxy/snap` | | | `/scan` linked only from `constants.ts` |
| `/profile` (1,250), `/me` (329), `/settings` (800, orphan), `/settings/whatsapp` | | | three account surfaces (J-08) |
| `/notifications`, `/support`, `/help` | 806 notifications; 2 tickets | | |
| `/tutor` | `ff_tutor_v1` OFF → "coming soon" | | dead surface with banned name |

## 2. Parent

**Entry:** `/parent` (own login/link-code form) or `/login` Parent tab. Layer 0.6 protects only 4 prefixes.
**Nav (`ParentShell.tsx`, hand-built):** Home, Children, Reports, Calendar, Attendance, Messages, Notifications, Billing, Profile, Support (10; `/parent/plan`, `/parent/settings`, `/parent/home` are stubs).

| Screen | Data path | Live data | State |
|---|---|---|---|
| `/parent/children` (1,399 lines) | `guardian_student_links` (2), link code / OTP, export | 5 guardians | 92 hex literals, local modals |
| `/parent/reports` (2,174 lines) | `/api/parent/report` **BROKEN 401** (C-003); `parent_weekly_reports` **0** | | primary parent promise unfulfilled |
| `/parent/messages` | `/api/parent/messages/threads` **BROKEN** (C-002) | 0 messages | |
| `/parent/attendance`, `/parent/calendar` | `student_attendance` **0** | | permanent empty |
| `/parent/billing` | `useCheckout` | | works (5 payments ever) |
| `/parent/consent` | inline; `/api/parent/consent/pending` does not exist (B-4); `parental_consent` **0** | | |
| `/parent/notifications`, `/parent/profile`, `/parent/support` (own `Toast`) | | | |

## 3. Teacher

**Entry:** `/login` Teacher tab → `/teacher` (CommandCenter, 1,668 lines) after `/teacher/onboarding` (orphan from nav).
**Nav (`TeacherShell.tsx`, 12 hand-built):** Home, Classes, Students, Assignments, Worksheets, Submissions, Grade book, Attendance, Reports, Messages, Lab leaderboard, Profile (+ stubs `assign`, `grade`, `insights`, `resources`, `settings`).

| Screen | Data path | Live data | State |
|---|---|---|---|
| `/teacher` CommandCenter | `use-teacher-data` hooks (`useAlerts`, `useClassOverview`, `useClassPulse`…), Edge `teacher-dashboard` (5,064 lines, no correlation id) | 9 teachers, 10 classes, 19 class_students | 102 inline styles; local `Shell` component |
| `/teacher/classes`, `/teacher/students` (1,087) | `/api/teacher/classes*` (no audit on archive), `/api/teacher/students` (orphan, unbounded — page queries Supabase directly) | | |
| `/teacher/assignments`, `/worksheets`, `/submissions`, `/grade-book` | `assignments` 0, `assignment_submissions` 0, `grade_book_entries` 0; worksheets only `answer-key` API | | every list is empty in production; create path has no zod/audit |
| `/teacher/messages` | `/api/teacher/messages/threads` **BROKEN** (C-001) | | |
| `/teacher/attendance` | `student_attendance` 0 | | |
| `/teacher/reports` (808) | 3 local tab components | | |

## 4. School admin

**Entry:** `/login` School tab → `/school-admin` (CommandCenter, purple; `ff_school_command_center` ON). Orange Atlas body retained at `_deprecated_AtlasSchoolAdmin.tsx` (not rendered). Setup wizard `/school-admin/setup` renders `null` while loading.
**Nav (`ConsolidatedSchoolNav.tsx`, 26 hrefs in 5 sections):** overview, students, teachers, staff, parents, classes, exams, content, enroll, invite-codes, reports, reports-depth, reports?tab=leadership, escalations (+safeguarding tab), announcements, ai-assistant, ai-config, billing, branding, modules, api-keys, audit-log, rbac, setup. 26 > 7.

| Screen | Data path | Live data | State |
|---|---|---|---|
| CommandCenter (691) | `resolveCommandCenterContext` routes (overview, classes-at-risk, teacher-engagement, leadership) | 15 schools, 2 school_admins | local `SchoolPicker`, `MasteryDistributionCard` duplicates of `command-center/*` components |
| `/students` (540), `/teachers` (637), `/staff`, `/parents` (1,069) | browser Supabase queries + invite routes; list APIs orphaned | 75 students | four people pages, one concept |
| `/enroll` (697) + `roster/validate` + `students/bulk-import` | JSON rows, dry-run | `school_invite_codes` 0 | no CSV template/preview/error file (G-09) |
| `/content` (1,502) | `school_questions`, `content/bulk` | | |
| `/reports` (1,317), `/reports-depth`, `/insights` stub | `reports/{mastery,bloom,export}` | | duplicated |
| `/exams` (1,349), `/announcements` (922), `/escalations`, `/api-keys`, `/rbac` (1,144), `/billing`, `/branding`, `/modules`, `/audit-log` (reads `school_audit_log`, **1 row**) | | `school_announcements` 0, `school_exams` — | most are empty in production |

## 5. Super admin

**Entry:** `/super-admin/login` (own limiter) → `/super-admin`. Page gate is client-side (`AdminShell` `useAdmin`); API gate `authorizeAdmin`.
**Nav (`AdminShell.tsx`, 53 hrefs):** grouped into ~10 sections; 62 pages import `AdminShell`.

| Cluster | Pages | Live data | State |
|---|---|---|---|
| Users & schools | `/users`, `/students/[id]`, `/institutions` (1,790), `/intelligence/*` (4), `/bulk-upload` (+schools), `/bulk-actions`, `/demo`, `/view-as/[studentId]/*` (4), `/foxy-report/[id]` (orphan) | 43 auth users; 0 impersonation sessions | works; heavy inline styling |
| Money | `/subscriptions`, `/subscribers`, `/entitlements`, `/invoices`, `/institutions` billing | 5 payments | 5 overlapping pages |
| Content & AI | `/content`, `/cms`, `/subjects` (+3 subpages orphaned), `/grounding/*` (5), `/foxy-quality`, `/ai-quality` (orphan), `/misconceptions`, `/marking-integrity`, `/learning`, `/goal-profiles`, `/mol-shadow`, `/synthesis-*`, `/alfabot` | | 6 RAG pages; no re-index or curriculum-version control |
| Platform | `/health`, `/diagnostics`, `/observability` (+2), `/oracle-health`, `/logs` (reads `admin_audit_log`), `/sla`, `/readiness-rubric`, `/flags`, `/module-overrides`, `/rbac`, `/oauth-apps`, `/workbench`, `/command-center`, `/adaptive-loops`, `/enroll-mfa` | 4 admin_users, 0 MFA enrolled (per 2026-09-02 audit) | 8 health-ish pages |
| Support | `/support`, `/support/tickets` (+ `/internal/admin` SupportTab) | 2 tickets | three UIs |

## 6. Defect list (severity-ranked)

| ID | Sev | Defect | Proof |
|---|---|---|---|
| J-01 | **P0** | Banned term "tutor" in live title, hero, pricing copy, login tagline, product/about copy, OG alt; `/tutor` + `/api/tutor/*` shipped | browser captures; `welcome/layout.tsx:34`, `HeroV3.tsx:371`, `AuthScreen.tsx:359`, `layout.tsx:23-73`; grep 135 files |
| J-02 | **P0** | Foxy, Quiz, Learn/Exams read three different chapter taxonomies; Foxy's own pipeline uses two | 02 §E.4 |
| J-03 | **P0** | Teacher and parent message threads fail (RPC EXECUTE) | C-001, C-002 |
| J-04 | **P0** | Parent report 401; weekly digest never produced | C-003 |
| J-05 | **P0** | Razorpay webhook never received; server-side payment reconciliation inert | C-007 |
| J-06 | **P0** | Crawlers get 429 challenge; Googlebot exemption unproven | C-008 |
| J-07 | P1 | LCP 5.1–13.1 s and FCP 1.7–5.8 s on throttled mid-range Android; hero opacity-gated | perf-results.json |
| J-08 | P1 | Two student homes (`/today` vs `/dashboard`), three student account pages, two parent entry flows | nav-config, `page.tsx`, `/parent` |
| J-09 | P1 | No global search for any role | 04 §19 |
| J-10 | P1 | School admin cannot self-serve CSV import with template/preview/error file; no parent import | 04 §3-5 |
| J-11 | P1 | Nav overload: school-admin 26, super-admin 53 items; 8 health, 6 RAG, 5 money, 3 support surfaces | shells |
| J-12 | P1 | Student routes protected client-side only; super-admin pages ungated server-side; 5 pages render `null` while loading | `proxy.ts:1277`, `super-admin/layout.tsx`, inventory `nullWhileLoading` |
| J-13 | P1 | Nav destinations that are flag-off/empty in production: `/tutor`, `/synthesis`, `/dive`, `/tests` write path, 8 `ff_nav_groups_v1` rows | live flags |
| J-14 | P1 | Retired `foxy-tutor` still hit by mobile clients (410) | C-006 |
| J-15 | P1 | 35 orphan pages incl. `/schools` (₹99/seat page) and `/settings` | inbound-links.json |
| J-16 | P1 | 169 unvalidated mutating routes; 20 unaudited admin/teacher mutations; 18 unbounded lists | 02 §E.2/E.3 |
| J-17 | P1 | No global announcements, curriculum editor/versioning, or re-index control; embedding backfill cron inactive | 04 §6, §15, §17 |
| J-18 | P1 | IRT calibration cron failing daily since 2026-08-06 (fix unverified) | C-004 |
| J-19 | P2 | Three visual systems on three login screens; six token systems; 9,000+ hex literals | captures; 01 §1b |
| J-20 | P2 | `/billing` signed-out renders a bare sentence instead of the shared redirect | `protected-billing.png` |
| J-21 | P2 | SEO: duplicated `<h1>` (2 per marketing page), duplicated `BreadcrumbList`/`Organization`/`FAQPage` JSON-LD blocks (home has 10 blocks), `/schools` and `/login` canonical → `/`, `/schools` default title | browser JS captures |
| J-22 | P2 | Anon RPC oracles (`is_active_admin`, `get_feature_flag_envelope`); 57 anon-executable SECURITY DEFINER functions | probes |
| J-23 | P2 | `subscription_plans.price_display` ₹1,499 vs ₹1,099 charged | live row |
| J-24 | P2 | Vernacular via 385 inline `isHi` ternaries; no catalogue; DB has `title_ta/te/bn/mr` with no UI | grep |
| J-25 | P2 | Foxy message persistence intermittently raises P0001 | C-005 |
| J-26 | P2 | 13 Edge Functions log without correlation id; 11 direct Anthropic calls bypass the retry helper | 02 §E.7 |
| J-27 | P2 | Generated types 17 RPCs behind live DB | 01 §1d |
| J-28 | P2 | `/internal/admin` 401 page renders mojibake (missing charset) | `protected-internal_admin.png` |
| J-29 | P3 | Cookie bar overlaps hero CTA on mobile; "Cusiosense" spelling in legal footer/about title unverified; 23 near-identical `error.tsx`; dead ECS/Dockerfile config | captures |

Totals: **P0 6 · P1 12 · P2 10 · P3 1** (29 defects). Screens captured: 19 public/auth × 2 viewports + 29 protected traces = 67 files.
