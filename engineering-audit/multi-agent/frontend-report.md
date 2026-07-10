# Agent C - Frontend and Design-System Report

Status: Complete - Stage 1 reconnaissance only
Date: 2026-07-10
Mode: Read-heavy audit; no product code changes.

## 1. Scope inspected

- Next.js host UI under `apps/host/src/app`, focused on student dashboard/learn/Foxy handoff, parent shell/glance, teacher command center, school-admin command center, role navigation, welcome/mobile E2E hints, loading/error/empty/success states, accessibility, visual polish, browser-size compatibility, and feature-flag-hidden/dead states.
- Shared UI/design-system primitives under `packages/ui/src`, especially responsive shells, role bottom nav, primitive tokens, global CSS, and parent/teacher/school-admin composed surfaces.
- Test and E2E evidence under `apps/host/src/__tests__` and `e2e` where it confirms or limits confidence.

## 2. Files inspected

- `apps/host/src/app/(student)/dashboard/page.tsx`
- `apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx`
- `apps/host/src/app/(student)/learn/page.tsx`
- `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`
- `apps/host/src/app/parent/_components/ParentShell.tsx`
- `apps/host/src/app/parent/page.tsx`
- `packages/ui/src/parent/ParentGlanceHome.tsx`
- `apps/host/src/app/teacher/_components/TeacherShell.tsx`
- `apps/host/src/app/teacher/CommandCenter.tsx`
- `apps/host/src/app/school-admin/_components/SchoolAdminShell.tsx`
- `apps/host/src/app/school-admin/_components/ConsolidatedSchoolNav.tsx`
- `apps/host/src/app/school-admin/CommandCenter.tsx`
- `packages/ui/src/ui/primitives/tokens.ts`
- `packages/ui/src/responsive/AppShell.tsx`
- `packages/ui/src/navigation/RoleBottomNav.tsx`
- `packages/ui/src/globals.css`
- `e2e/welcome-v2.spec.ts`
- `e2e/certification/student.spec.ts`
- `apps/host/src/__tests__/responsive/MobileNav.test.tsx`
- Targeted `rg` scans for loading/error/empty states, feature flags, dead/hidden states, and route ownership.

## 3. Confirmed findings

1. P1 - Student dashboard flag/comment drift can confuse rollout and demo expectations.
   `StudentOSDashboard.tsx` still documents itself as rendering only when `ff_student_os_v1` resolves ON and says the legacy Atlas dashboard renders otherwise, but `dashboard/page.tsx` dynamically imports and always returns `StudentOSDashboard`. A test also states AtlasDashboard was removed and `ff_student_os_v1` is always-on. This is not a runtime break by itself, but it is a high-confidence demo/readiness risk because operators may expect a flag fallback that no longer exists.

2. P1 - Student dashboard and learn flow are the strongest mobile-first surfaces, but they are not consistently matched by adjacent student pages.
   `StudentOSDashboard` uses `AppShell variant="mobile"`, a single-column above-the-fold mission, explicit loading/profile-error gates, ARIA labels for badges, and a disclosure for secondary study actions. `/learn` uses canonical primitives, locked-subject visibility, skeleton chapter loading, and an actionable Foxy empty state. The chapter page wraps the learning flow in `AppShell`, distinguishes load error from empty state, and routes weak-concept recovery to Foxy. By contrast, certification tests for the broader student demo journey still only assert "body is non-empty" for dashboard and simple reachability for `/quiz`, `/foxy`, `/progress`, and `/notifications`; this is too shallow to certify polish, state quality, or mobile layout consistency.

3. P1 - Parent shell/glance is production-minded, but the login/link-code path still uses page-local hand-rolled chrome.
   `ParentShell` filters nav by guardian vs link-code mode, gates unread badge fetches to guardian mode, skips shell flash while auth resolves, and renders mobile nav. `ParentGlanceHome` has skeleton, error, empty-activity derivation, read-only moments, and flag-gated Encourage. However, the parent login, pending-approval, and sign-in-gate screens in `parent/page.tsx` use custom button/div styling rather than shared primitives in several places, increasing visual drift from the glance home and role shell.

4. P1 - Teacher command center is functionally rich but accessibility and small-screen density need another pass.
   The command center has strong state coverage: skeleton, not-a-teacher setup, hard error with retry, no-class empty state, optimistic remediation rollback, hidden grading-queue button when flag off, and parent-notify success/error toasts. The roster heatmap is horizontally scrollable and clickable, but heatmap cell buttons expose information mainly through `title`, use compact 32px-ish hit areas, and rely heavily on color/opacity. That is acceptable as a dense desktop tool, but it is weak for keyboard/screen-reader/touch confidence.

5. P1 - School-admin command center and nav consolidation are a launch-positive surface, with a few mobile/accessibility edges.
   `SchoolAdminShell` deliberately always renders `ConsolidatedSchoolNav` so new admins retain access to setup/enrollment/invite routes. The nav groups every school-admin route into five sections, hides truly flag-only entries, and shows module-disabled entries as locked rather than dead links. The command center has multi-school picker, first-run setup checklist, overview skeleton/error/no-data, paginated panels, and feature-gated School Pulse. Mobile shell uses fixed bottom role nav and disables the drawer, but the command center header buttons are 36px high and the consolidated nav's locked rows are non-focusable `div`s with only an emoji lock label.

6. P2 - Shared design-system primitives have good foundations, but product routes frequently bypass them.
   `tokens.ts` defines 44-56px control heights and focus rings; `AppShell` handles safe-area, one-handed mode, reduced-motion-aware compaction, and Foxy body-lock fallback; `RoleBottomNav` supplies navigation landmarks, active states, badges, more sheet, focus on sheet open, Escape close, and reduced-motion scroll behavior. Global CSS includes contrast-checked text tokens, skip nav, focus-visible fallback, reduced-motion behavior, and safe-area bottom padding. The risk is adoption inconsistency: several role pages still use raw buttons, inline colors, `title`, emoji-only decoration, or 36px controls.

7. P2 - Welcome/mobile E2E has unusually good viewport coverage, but flag-default assertions are intentionally non-load-bearing.
   `welcome-v2.spec.ts` covers `?v=1/?v=2`, anonymous cookie shape, Hindi `lang`, light-theme lock, role switcher, pricing carousel/grid, footer behavior, and viewports 375x667, 768x1024, 1920x1080, and 2560x1440. However, default flag ON/OFF checks skip when the 5-minute cache is stale, so the reliable demo entry points are the query escape hatches, not default `/welcome` flag propagation.

8. P2 - Feature-flag-hidden/dead-state discipline is generally good, with one notable documentation mismatch.
   The repo repeatedly hides additive features when flags are off instead of showing disabled tombstones: teacher grading queue is omitted when off, school staff/reports-depth/principal-AI nav entries hide unless flags allow them, school Pulse does not mount while off, and multiple APIs return feature-absent 404s. The main mismatch found in this pass is the student dashboard comment/flag drift described in Finding 1.

## 4. Evidence

- `apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx:4-6` says the component renders only when `ff_student_os_v1` resolves ON and legacy Atlas renders otherwise; `apps/host/src/app/(student)/dashboard/page.tsx:6-12` always dynamically imports and returns `StudentOSDashboard`.
- `apps/host/src/__tests__/dashboard-institution-admin-redirect.test.ts` search result states AtlasDashboard was removed and `ff_student_os_v1` is always-on.
- `StudentOSDashboard.tsx:162-202` separates skeleton, logged-in/no-profile recovery, and redirect window states; `StudentOSDashboard.tsx:270-370` uses `AppShell variant="mobile"` and demotes secondary actions behind a disclosure.
- `apps/host/src/app/(student)/learn/page.tsx:292-343` keeps locked subjects visible with upgrade CTAs; `learn/page.tsx:402-425` renders skeleton and actionable Foxy empty state.
- `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx:148-152` defines retryable load error distinct from empty; `:719-727` sends in-flow doubts to Foxy; `:968-1021` routes weak concepts to Foxy.
- `apps/host/src/app/parent/_components/ParentShell.tsx:137-181` avoids shell flash while auth resolves; `:183-207` filters nav by link-code vs guardian mode; `:222-253` renders sidebar plus mobile nav.
- `packages/ui/src/parent/ParentGlanceHome.tsx:245-278` has skeleton and error states; `:280-295` derives empty/no-activity state and moments from already-fetched data.
- `apps/host/src/app/teacher/CommandCenter.tsx:804-873` covers loading, setup, error, and no-class empty states; `:378-390` hides grading queue when the flag is off; `:143-211` renders the heatmap as compact clickable table cells.
- `apps/host/src/app/school-admin/_components/SchoolAdminShell.tsx:333-339` documents why the shell must always wrap the school-admin command center; `ConsolidatedSchoolNav.tsx:127-215` lists all grouped school-admin routes; `:365-379` renders module-disabled rows as locked.
- `apps/host/src/app/school-admin/CommandCenter.tsx:407-443` handles multi-school picker; `:459-508` first-run setup checklist; `:635-727` command-center skeleton/error/panel composition.
- `packages/ui/src/ui/primitives/tokens.ts:20-42` sets 44px+ control heights and focus rings; `packages/ui/src/responsive/AppShell.tsx:18-34` documents mobile-first, one-handed, safe responsive shell; `packages/ui/src/navigation/RoleBottomNav.tsx:184-232` exposes nav landmark, aria labels, active state, badges, and More sheet.
- `packages/ui/src/globals.css:128-140` contrast-checked text tokens; `:760-775` reduced-motion clamp; `:794-830` safe-area bottom padding, skip nav, focus-visible fallback.
- `e2e/welcome-v2.spec.ts:19-20` lists viewport coverage; `:95-115` marks default flag checks as skip-tolerant under cache; `:223-250` checks mobile pricing carousel vs tablet grid.
- `e2e/certification/student.spec.ts:49-59` dashboard certification only checks non-empty body/no application error; `:78-90` checks `/foxy` and `/progress` reachability rather than visual/state correctness.

## 5. Risks

- Demo risk: student dashboard rollout comments and code disagree, so a demo script or release checklist could describe a flag fallback that does not exist.
- Mobile polish risk: teacher heatmap and school-admin command controls can be technically reachable but cramped below desktop widths.
- Accessibility risk: `title`-only data disclosure, non-focusable locked rows, 36px header controls, emoji-as-content, and mixed raw buttons create uneven keyboard/screen-reader behavior.
- Visual consistency risk: canonical primitives exist, but route-local hand styling remains in parent login, teacher command rows, and school-admin header/checklist details.
- Certification risk: current journey E2E mostly checks reachability for authenticated role paths; it does not catch sparse screens, state regressions, overlapping mobile chrome, or weak empty/error surfaces.

## 6. Dependencies

- Shared UI primitives: `@alfanumrik/ui/ui/primitives`, `AppShell`, `RoleBottomNav`, `DashboardSidebar`, `ConsolidatedSchoolNav`.
- Auth/role context: `useAuth`, `useParentAuth`, `useTenant`, school-admin context and role hooks.
- Feature flags: `ff_subjects_os_v1`, `ff_parent_encourage_v1`, `ff_teacher_assignment_lifecycle`, `ff_teacher_gradebook_depth`, `ff_teacher_parent_comms`, `ff_school_admin_rbac`, `ff_school_reports_depth`, `ff_principal_ai_v1`, `ff_school_pulse_v1`, `ff_school_provisioning`, welcome v2 flag.
- Runtime data: student snapshot/subjects/chapter content, parent dashboard payload, teacher dashboard/read-model hooks, school-admin overview/classes-at-risk/teacher-engagement endpoints.
- E2E credentials and seeded certification accounts for real visual journey validation.

## 7. Recommended action

1. Fix documentation/flag truth for the student dashboard in Stage 2: either update comments/tests/readiness docs to say Student OS is the sole dashboard, or restore an explicit flag dispatch if fallback is still required.
2. Add a mobile visual QA batch for `/dashboard`, `/learn`, `/learn/[subject]/[chapter]`, `/parent`, `/teacher`, and `/school-admin` at 360x640, 390x844, 768x1024, 1366x768, and 1920x1080.
3. Normalize route-local buttons and state panels onto canonical primitives where safe, starting with parent login/link-code gates, school-admin command header buttons, and teacher heatmap/action buttons.
4. Improve teacher heatmap accessibility: replace `title`-only details with visible/ARIA labels, increase touch targets or provide row drill-through controls, and avoid color/opacity-only meaning.
5. Make locked module nav rows keyboard-discoverable or pair them with explanatory tooltips/help text; avoid non-focusable disabled content that looks actionable.
6. Strengthen certification E2E to assert role-specific first meaningful content, absence of infinite skeletons, mobile nav presence, no overlapping fixed chrome, and at least one loading/error/empty/success state per role journey.

## 8. Files proposed for modification

No product files modified in Stage 1. Candidate Stage 2 files:

- `apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx`
- `apps/host/src/app/(student)/dashboard/page.tsx`
- `apps/host/src/app/parent/page.tsx`
- `apps/host/src/app/teacher/CommandCenter.tsx`
- `apps/host/src/app/school-admin/CommandCenter.tsx`
- `apps/host/src/app/school-admin/_components/ConsolidatedSchoolNav.tsx`
- `packages/ui/src/ui/primitives/*`
- `e2e/certification/*.spec.ts`
- New or expanded visual specs under `e2e/visual-regression/`

## 9. Tests required

- Unit/component: focused tests for parent login/link-code gates after primitive migration; teacher heatmap a11y labels and click targets; school-admin locked-nav explanatory state.
- E2E: role smoke with seeded accounts for student, parent, teacher, and school-admin that validates visible first screen, mobile nav/sidebar behavior, no app error, no infinite skeleton, and no overlap at mobile/tablet/desktop.
- Visual regression: Playwright screenshots for the six named role/demo routes at 360x640, 390x844, 768x1024, 1366x768, and 1920x1080.
- Accessibility: axe or equivalent pass on role shells plus keyboard tab-order checks for command centers, More sheets, locked nav rows, and Foxy/learn CTAs.
- Feature-flag parity: flag-off tests that prove additive entries are hidden and no dead/tombstone controls render; flag-on tests that prove routes are reachable and not only visible.

## 10. Confidence level

Medium-high for static UI architecture, state coverage, and design-system adoption findings. I inspected the relevant source files and test specs directly.

Medium for actual visual polish at runtime because Stage 1 did not run the app, capture screenshots, or execute Playwright. Runtime/browser validation is required before launch signoff.

## 11. Unresolved questions

- Is `ff_student_os_v1` intentionally retired/always-on, and should all references to legacy Atlas fallback be removed from comments, docs, and runbooks?
- Which demo account set is authoritative for visual certification across student, parent, teacher, and school-admin?
- Should teacher command center remain desktop-first with mobile reachability, or does it need a true mobile command layout?
- Should module-disabled school-admin nav rows be visible locked affordances, hidden items, or focusable upsell/help rows?
- Are live screenshots from current Vercel/production required for Stage 1 signoff, or is code evidence sufficient until Stage 2?
