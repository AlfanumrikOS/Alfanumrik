# Alfanumrik Frontend Replacement

## Full Execution and Implementation Plan

**Programme name:** Alfanumrik One Experience  
**Product:** Alfanumrik Adaptive Learning OS™  
**Company:** CusioSense Learning India Private Limited  
**Plan date:** 11 July 2026  
**Recommended web programme:** 20–22 weeks with 6–8 dedicated contributors  
**Native alignment:** 3–4 additional weeks for the supported Flutter Student and Guardian scope  

---

## 1. Executive decision

Alfanumrik should replace the accumulated Atlas, Cosmic, Wonder Blocks, legacy role shells and page-local interfaces with one governed experience system. This is a complete frontend replacement, but it must not be implemented as a big-bang rewrite or another global CSS redesign.

The new product will be one Alfanumrik experience platform projected differently for five roles:

1. Student
2. Teacher
3. Parent
4. School Admin
5. Super Admin

The five roles will share the same design foundations, responsive shell, navigation mechanics, accessibility standards, interaction patterns and data-trust rules. Their workflows, permissions, vocabulary and decision density will remain role-specific.

The implementation must preserve:

- Supabase authentication and database contracts
- RBAC and tenant isolation
- Existing valid APIs and deep links during migration
- Feature flags and entitlement controls
- Adaptive-learning engines and recommendation logic
- Bilingual English/Hindi capability
- School white-label identity within controlled semantic tokens
- Existing analytics and operational observability
- A reversible production rollout

No global theme script may repaint the legacy application. No role squad may introduce another independent shell, navigation system, dialog library or colour dialect.

---

## 2. Product experience thesis

### 2.1 Design direction: Calm Intelligence

Alfanumrik should feel warm, intelligent, credible, encouraging and contemporary. It must not look like a generic corporate-blue SaaS dashboard, a dark operations cockpit or a child-focused gaming clone.

The visual foundation is:

| Semantic token | Reference value | Purpose |
|---|---:|---|
| Canvas | `#FBF7F1` | Warm application background |
| Surface | `#FFFDFC` | Cards, panels and sheets |
| Raised surface | `#FFFFFF` | Dialogs and floating controls |
| Deep ink | `#211E1A` | Primary text |
| Secondary ink | `#6D655E` | Supporting copy |
| Border | `#E5DBD0` | Dividers and component boundaries |
| Brand orange | `#E8581C` | Illustrations and large brand accents |
| Accessible action orange | `#B94718` | Primary button with white text |
| Orange soft | `#F8E5D9` | Selected states and callouts |
| Success | `#27734E` | Positive state |
| Warning | `#9A580A` | Attention |
| Danger | `#B42318` | Errors and destructive state |
| Information | `#176D68` | Limited informational meaning |

Role accents are restrained:

- Student: orange
- Teacher: deep teal
- Parent: muted plum
- School Admin: forest/olive
- Super Admin: graphite with orange

Role accents may colour a selected navigation item, icon, badge or chart series. They must not replace the shared canvas, typography, action colour or status semantics.

### 2.2 One role, one homepage, one primary decision

| Role | Home must answer immediately |
|---|---|
| Student | What should I learn next, and why? |
| Teacher | Which students need my attention today? |
| Parent | Is my child progressing, and what should I do? |
| School Admin | Where does the school require intervention? |
| Super Admin | What threatens platform, customer, learning or revenue health? |

Homepages must not begin with a decorative wall of statistics. A metric is shown only when it changes a decision.

### 2.3 Visible adaptive-learning identity

The student journey should expose a coherent operating loop:

> Diagnose → Plan → Learn → Practice → Review → Adapt

Every recommendation must explain why it is next in learner-friendly language. Foxy should explain, scaffold and check understanding inside the active learning context. It should not become a permanent rail that competes with the lesson or conversation.

### 2.4 Honest data

Every decision metric must have:

- A governed definition
- A real source
- A freshness timestamp where relevant
- A loading state
- An unavailable state represented by `—`
- A drill-down to supporting evidence
- No invented browser-side fallback

Estimated values must be explicitly labelled as estimates.

---

## 3. Replacement strategy

### 3.1 Build new, migrate safely, delete old

Create the new experience system in an isolated V3 namespace:

```text
packages/ui/src/v3/
├── foundations/
├── primitives/
├── feedback/
├── overlays/
├── patterns/
├── shells/
├── navigation/
├── data-display/
└── learning/
```

V3 styling must be locally scoped through a V3 root attribute and cascade layer. It must not globally reinterpret Tailwind classes, literal colours or legacy CSS variables.

Introduce one sticky cohort flag per role:

```text
ff_ui_v3_student
ff_ui_v3_teacher
ff_ui_v3_parent
ff_ui_v3_school_admin
ff_ui_v3_super_admin
```

Each role migrates through the same lifecycle:

1. Document the current workflow and add characterisation tests.
2. Define the canonical route and capability contract.
3. Build the V3 screen against existing production APIs or a temporary adapter.
4. Compare old and new experiences using identical seeded data.
5. Validate phone, tablet, desktop, keyboard, browser and accessibility behaviour.
6. Release to internal accounts.
7. Release to one friendly pilot school where applicable.
8. Roll out to 5%, 25%, 50% and 100% sticky cohorts.
9. Observe errors, task completion, support contacts and learning starts.
10. Delete the old component, adapter and compatibility CSS.
11. Remove the flag after a stable observation period.

Dual UI must have fixed sunset dates. V3 must not become a fifth permanent design dialect.

### 3.2 Immediate safety patch: days 1–5

Current users should not wait for the full replacement. The following compatibility fixes are independent of the new visual design:

- Restore student navigation from 768–1023 px.
- Remove the empty tablet rail reserved by the current AppShell.
- Restore the student mobile More destination, overflow routes and role switching.
- Hide `/practice` when unavailable or route Practice to the working Quiz experience.
- Restore all School Admin destinations through a grouped mobile More sheet.
- Add bottom clearance for the fixed School Admin mobile navigation.
- Make pre-hydration theme selection identical to the React theme provider.
- Remove student-role auto-enablement of the blue/Cosmic skin.
- Preserve Parent `childId` across Home, Reports, Calendar and Messages.
- Add recoverable Parent error handling; eliminate indefinite loading.
- Remove fabricated Teacher metrics.
- Repair the Teacher class filter.
- Redirect the non-functional Study Plan CTA to Exam Prep or hide it.
- Remove expired hard-coded examination countdowns.

These are safety corrections, not permission to visually redesign legacy pages.

---

## 4. Target frontend architecture

### 4.1 Route-group ownership

```text
apps/host/src/app/
├── (public)/
├── (auth)/
├── (student)/
│   ├── layout.tsx
│   ├── today/
│   ├── learn/
│   ├── practice/
│   └── progress/
├── teacher/
│   ├── layout.tsx
│   ├── today/
│   ├── classes/
│   ├── students/
│   ├── assign/
│   ├── grade/
│   └── insights/
├── parent/
│   ├── layout.tsx
│   ├── home/
│   ├── progress/
│   ├── plan/
│   └── messages/
├── school-admin/
│   ├── layout.tsx
│   ├── overview/
│   ├── people/
│   ├── academics/
│   ├── insights/
│   └── settings/
└── super-admin/
    ├── (public)/login/
    └── (gated)/
        ├── layout.tsx
        ├── command/
        ├── institutions/
        ├── operations/
        ├── revenue/
        └── governance/
```

Each role layout owns:

- Authentication and authorization
- Tenant resolution
- Persistent role context
- Responsive shell
- Navigation
- Toast/dialog portals
- Route transition feedback
- Role analytics

Pages must not mount their own persistent shell.

### 4.2 Server-first composition

Use React Server Components by default. Client components are limited to genuine interaction:

- Forms and local state
- Charts and simulations
- Drag and drop
- Real-time subscriptions
- Device capabilities
- Rich editors

Initial authorization, capability resolution and data composition should remain server-side where practical.

Engineering limits:

- No route entry file above 350 lines without architectural review.
- No page may combine shell, API access, business calculation and presentation.
- No UI component may import a service-role client.
- Public routes must not inherit authenticated Supabase/session code.
- Large simulations and rich AI tools load dynamically.

### 4.3 One capability resolver

Resolve availability once by combining:

- Application defaults
- Environment constraints
- Database overrides
- Tenant entitlements
- Role permissions
- User/cohort flags

The result drives both navigation and route access. A destination must never appear in navigation and then return a capability-driven 404.

Permission checks fail closed. UI must not flash restricted destinations while configuration loads.

### 4.4 Persistent role scope

Typed shell-level scope contracts:

```text
StudentScope: learner, curriculum, subject, active plan
TeacherScope: school, class, term, subject
ParentScope: active child
SchoolScope: school, academic year, campus
SuperAdminScope: institution, environment, operating range
```

Selected scope must survive navigation. Shareable analytical routes encode scope in the URL. API cache keys must include scope.

### 4.5 One tenant-branding provider

Resolve tenant identity once and expose:

- School name
- Approved logo
- Controlled accent
- Locale
- Curriculum
- Enabled modules

School branding may influence a tenant accent token. It must not replace global action, accessibility or status colours.

---

## 5. Responsive shell contract

Mobile is the source layout. Tablet and desktop enhance the same content order.

| Width | Navigation | Content behaviour |
|---:|---|---|
| 320–479 px | 56 px top bar and five-item bottom navigation | Single column; 16 px gutter |
| 480–767 px | Same mobile navigation | 20 px gutter; limited micro-metric pairs |
| 768–1023 px | Always-visible 72–80 px icon rail | One/two-column content; no navigation gap |
| 1024–1279 px | 80 px compact expandable rail | Adaptive multi-column workspace |
| 1280–1535 px | 240 px expanded sidebar | Full role workspace; 32 px gutter |
| 1536 px+ | 240 px sidebar and bounded content | Optional one pinned context panel |

Non-negotiable shell rules:

- There is never a breakpoint without navigation.
- Only one persistent navigation rail may exist.
- No persistent secondary panel below 1,440 px.
- At 1,440 px+, users may pin one context panel, never two.
- Context panels become drawers or bottom sheets on smaller screens.
- Mobile content receives bottom padding equal to navigation plus safe-area inset.
- Hover is supplementary; every action works by touch and keyboard.
- Minimum target is 48×48 px for primary touch controls.
- Input text remains at least 16 px on mobile to avoid iOS zoom.
- The virtual keyboard must not cover the active field or submission action.
- Use `100vh` fallback before `100dvh`.
- Provide static colour fallbacks before `color-mix()`.
- Avoid fixed page widths and fixed-height translated containers.
- There is no page-level horizontal overflow at 320 px.
- Tables scroll only within an identified data region or transform into labelled cards.

### Browser certification

- Chrome and Edge: latest two releases plus the approved baseline
- Firefox: latest two releases plus supported ESR/baseline
- Safari: Safari 14 baseline and latest Safari
- iOS Safari: baseline and latest iOS
- Android Chrome on a mid-range physical device
- Windows display scaling at 125% and 150%

Progressive enhancement must never remove navigation, content or the primary action.

---

## 6. Role information architecture

### 6.1 Student

#### Mobile destinations

1. Today
2. Learn
3. Practice
4. Progress
5. More

More contains Foxy history, Rewards, Notebook, Exam Plan, Downloads, Settings, Help and Role Switcher. Foxy remains a contextual action throughout Learn and Practice, with a direct deep link preserved.

#### Canonical route map

| Existing family | Target |
|---|---|
| `/dashboard`, `/today` | `/today` |
| `/learn`, `/library` | `/learn` with Browse view |
| `/quiz`, `/practice` | `/practice` with modes |
| `/review`, `/revision` | `/practice?mode=review` |
| `/exam-prep`, `/study-plan`, `/exams` | `/practice/exam` |
| `/mock-exam`, `/exams/mock` | `/practice/exam/mock` |
| `/progress`, `/reports` | `/progress` with report views |
| `/foxy` | Contextual assistant; direct link retained |

Student acceptance:

- Start the recommended activity within two taps.
- Explain why every activity is next.
- Lesson completion offers Practice, Review or Ask Foxy.
- Progress communicates mastery, effort and next action—not only XP.
- No permanent side rails reduce learning or chat width.
- Today, Foxy and Exam Plan consume one ranked recommendation authority.

### 6.2 Teacher

#### Mobile destinations

1. Today
2. Students
3. Assign
4. Inbox
5. More

Desktop expands the same manifest into Today, Classes, Students, Assign, Grade, Insights, Messages, Resources and Settings.

Teacher acceptance:

- Active class persists across every route.
- An at-risk student can move from evidence to intervention within three principal actions.
- Missing data displays `—`; no metric is created in the browser.
- Student detail opens in a drawer on desktop and focused page on mobile.
- Mobile Home is an attention queue, not a compressed heatmap.

### 6.3 Parent

#### Mobile destinations

1. Home
2. Progress
3. Plan
4. Messages
5. More

The active child selector remains visible in the shell and is encoded in child-scoped deep links.

Parent acceptance:

- Home immediately answers whether the child is on track.
- Selected child never changes silently.
- Reports use plain parent language before academic terminology.
- API failures show a recoverable state, never indefinite loading.
- Actions are explicit: encourage, review, follow the plan or contact the teacher.
- Link-code onboarding is one clear sequence after authentication.

### 6.4 School Admin

#### Mobile destinations

1. Overview
2. People
3. Academics
4. Insights
5. More

More exposes the complete grouped manifest, including Settings and Governance. Every valid desktop destination remains reachable within two mobile navigation actions.

School acceptance:

- School and academic-year scope persist.
- Overview prioritises exceptions and decisions.
- Metrics expose source, definition and freshness.
- No unexplained composite Health score.
- Learning operations remain distinct from transport, fees or generic ERP functionality.
- Fixed navigation never covers the final action.

### 6.5 Super Admin

#### Mobile destinations

1. Command
2. Institutions
3. Operations
4. Revenue
5. More

Desktop uses a persistent gated shell with command search.

Super Admin acceptance:

- One shell and permission model.
- Institution/environment scope is always visible.
- All operator tools use governed loading, stale and error states.
- `View as` uses the actual role UI through a read-only data adapter.
- `/internal/admin` capabilities move into the governed portal; the duplicate skin is retired.
- Destructive actions include impact, permission and audit context.

---

## 7. Design-system implementation

### Foundations

- Semantic colour tokens
- Typography and Hindi expansion rules
- 4 px spacing scale
- Radius system: 12 px controls, 16–20 px cards, pills only for filters/status
- Elevation
- Motion
- Breakpoints
- Focus rings
- Safe areas
- Z-index layers

### Primitives

- Button and icon button
- Link
- Input, textarea and select
- Checkbox, radio and switch
- Tabs
- Badge/status pill
- Tooltip
- Progress
- Divider

### Feedback

- Alert
- Toast/live region
- Skeleton
- Spinner
- Empty state
- Error state
- Permission state
- Offline/stale state
- Confirmation

### Overlays

- Dialog
- Drawer
- Bottom sheet
- Popover
- Command menu

Every overlay must trap focus, support Escape, inert the background and restore focus.

### Product patterns

- Page header
- Context selector
- Recommendation card
- Action queue
- Filter bar
- Responsive data list
- Data table
- Chart frame with text/table alternative
- Mastery display
- Learning session
- Foxy conversation
- Assignment composer
- Student detail workspace
- Report section

No feature team may create another button, dialog, navigation or data-table primitive when a canonical component exists.

---

## 8. Accessibility contract

Target WCAG 2.2 AA.

Release requirements:

- Logical heading hierarchy
- Semantic header, navigation, main and complementary landmarks
- Working skip link to a focusable main region
- Full keyboard completion of every workflow
- Visible focus states
- Accessible name for every icon button and field
- Dialog/sheet focus trap and restoration
- Background inertness under modal overlays
- No colour-only communication
- Text contrast at least 4.5:1
- UI component/non-text contrast at least 3:1
- 200% zoom without lost functionality
- 400% reflow for essential workflows
- Reduced-motion behaviour
- Screen-reader announcement of asynchronous changes
- Text summary and accessible table alternative for charts
- Canvas simulations with labelled controls and non-visual descriptions
- English/Hindi copy never embedded in images

No critical or serious automated accessibility violation may enter production. Automated checks are supplemented by VoiceOver and NVDA manual testing.

Motion timings:

- Button/state feedback: approximately 120 ms
- Navigation and disclosure: 160–180 ms
- Drawer and sheet: 220–240 ms
- Movement: normally no more than 12 px
- No autoplay carousel or parallax
- Celebrations are brief, optional and disabled by reduced motion

---

## 9. Performance contract

Field targets at the 75th percentile:

- LCP ≤ 2.5 seconds
- INP ≤ 200 ms
- CLS ≤ 0.1

Engineering targets:

- Reduce authenticated shared initial JavaScript by at least 25% from the approved baseline.
- Separate public-route code from authenticated Supabase/session code.
- Avoid shell remounts during navigation.
- Server-render initial data where practical.
- Dynamically load charts, simulations, editors and rich AI tools.
- Remove data waterfalls after role scope is known.
- Cache stable reference data.
- Virtualise only genuinely large lists.
- Track real-user performance by route, role, device class and browser.
- Fail CI when bundle or Web Vital budgets regress.

---

## 10. Programme phases

Assumption: 6–8 dedicated contributors working as two role squads with shared foundation ownership. A single engineer would likely require 9–12 months.

| Phase | Calendar | Deliverable | Exit gate |
|---|---:|---|---|
| Safety patch | Days 1–5 | Current navigation, theme, context and data-trust blockers | Production verification |
| 0. Baseline and governance | Week 1 | Route inventory, workflow tests, analytics baseline and ownership | Approved sources of truth |
| 1. Experience blueprint | Weeks 1–2 | Responsive preview, role IA, tokens and interaction specification | Founder/product sign-off |
| 2. V3 foundation | Weeks 3–5 | Tokens, primitives, shell, capability resolver, manifests and test harness | Foundation certification |
| 3. Student vertical slice | Weeks 6–9 | Today → Learn → Practice → Progress with contextual Foxy | Student acceptance and 5% rollout |
| 4. Teacher and Parent | Weeks 8–12 | Persistent class/child scope and core workflows | Role acceptance and staged rollout |
| 5. School Admin | Weeks 11–14 | Full grouped responsive administration | All routes reachable and certified |
| 6. Super Admin | Weeks 13–17 | One gated shell and internal-admin consolidation | Operational equivalence |
| 7. Cross-role hardening | Weeks 18–20 | Browser, accessibility, performance, localisation and security | Release council approval |
| 8. Legacy deletion | Weeks 20–22 | Remove Cosmic bridge, old shells, dead routes, components and flags | No production consumers |
| 9. Flutter alignment | Weeks 21–24 | Apply shared contract to supported Student/Guardian native scope | Native acceptance |

Teacher/Parent work overlaps the final Student period only after the shared foundation is frozen and certified.

---

## 11. Team and multi-agent ownership

### Human ownership

| Role | Responsibility |
|---|---|
| Founder/Product owner | Role priorities, workflow approval and rollout decision |
| Product/UX lead | IA, interaction specification and user validation |
| Design-system designer | Tokens, components and responsive specifications |
| Frontend architect | Shells, rendering, manifests and migration architecture |
| Student/Learning squad | Student, Foxy and adaptive-learning journeys |
| Operations squad | Teacher, Parent, School and Super Admin |
| Backend/API engineer | Capability, scope, recommendation and metric contracts |
| QA automation engineer | Contract, E2E, visual and browser matrices |
| Accessibility/performance specialist | WCAG and Web Vitals certification |
| Pedagogy/data reviewer | Recommendation and metric integrity |

### Multi-agent engineering model

- Orchestrator agent: plans batches, dependencies and evidence.
- Foundation agent: sole editor of shared tokens, primitives and shell contracts.
- Student agent.
- Teacher/Parent agent.
- School/Super Admin agent.
- API-contract agent.
- Accessibility/performance agent.
- Adversarial QA agent, read-only until fixes are authorised.

Role agents consume the shared foundation. They do not independently edit global tokens, root layout or navigation mechanics.

Use separate worktrees or strictly owned paths. No two agents edit global styles, root layout or canonical manifests concurrently.

---

## 12. Required backend and product contracts

Frontend replacement depends on:

1. Unified capability resolver
2. One adaptive recommendation endpoint
3. Governed metric definitions
4. Persistent role-scope APIs
5. Tenant-branding contract
6. Route permission map
7. Error, empty, partial and stale response conventions
8. Analytics event taxonomy
9. Bilingual copy and text-expansion rules
10. Seeded accounts for every role and product state

Temporary frontend adapters may normalise existing APIs, but each adapter requires an owner and removal date.

---

## 13. Quality and release gates

### Pull-request gates

- Type checking
- Linting
- Unit tests
- Component interaction tests
- Route-manifest contract tests
- API schema/contract tests
- Automated accessibility
- Visual regression
- Bundle budget
- No unauthorised literal colour
- No new page-local shell
- No navigation item without a route and capability

### Responsive visual matrix

Every core screen is verified at:

- 320×568
- 360×800
- 390×844
- 430×932
- 768×1024
- 820×1180
- 1024×768
- 1280×800
- 1440×900
- 1920×1080

States:

- Loading
- Empty
- Populated
- Partial/stale
- Error
- Permission denied
- Long Hindi/localised copy
- Large text
- Reduced motion
- Coarse pointer
- Virtual keyboard open

### End-to-end journeys

**Student:** Login → Today recommendation → Learn → Practice → Review → Progress → Ask Foxy  
**Teacher:** Login → select class → identify student → inspect evidence → assign intervention → grade → message parent  
**Parent:** Login → switch child → understand status → view progress → review plan → contact teacher  
**School:** Login → review exception → drill into cohort → intervene → export governed report  
**Super Admin:** Login → select institution → inspect issue → execute authorised action → verify audit trail

---

## 14. Rollout and observability

Use sticky cohort assignment so a user never alternates randomly between old and new UI.

Rollout:

1. Developers and seeded QA
2. Internal Alfanumrik team
3. One friendly pilot school
4. 5% eligible users
5. 25%
6. 50%
7. 100%
8. Legacy observation period
9. Legacy deletion

Monitor by role, browser and viewport:

- JavaScript errors
- API failures
- Failed navigation
- Capability-driven 404s
- Web Vitals
- Task completion
- Abandonment
- Help requests
- Recommendation starts
- Assignment completion
- Child/class/school scope changes
- Admin action failures

Rollback is a server-resolved flag change—not a new deployment.

Do not roll forward after:

- Authentication or authorization regression
- Data displayed under the wrong role or scope
- Missing primary navigation
- Material browser-specific failure
- Critical accessibility failure
- Significant error-rate regression
- Significant task-completion regression

---

## 15. Major risks and controls

| Risk | Control |
|---|---|
| Another visual dialect remains permanently | Sunset dates and deletion gates |
| V3 CSS damages legacy UI | Scoped V3 root and cascade layer |
| Existing functionality is lost | Characterisation tests and parity adapters |
| Deep links break | Compatibility aliases and controlled redirects |
| Role scope leaks or resets | Typed shell context and URL contract tests |
| Feature flags disagree with navigation | One server capability resolver |
| Adaptive recommendations conflict | One ranking authority |
| Designer/developer drift | Code-backed responsive blueprint |
| Parallel agents create conflicts | Strict path ownership and foundation freeze |
| Super Admin expands indefinitely | Migrate grouped operator capabilities by priority |
| Accessibility is postponed | Gates begin in the foundation phase |
| Performance regresses | CI budgets and route-level RUM |
| Flutter diverges | Shared tokens/contracts and explicitly limited native roles |

---

## 16. Definition of complete replacement

The programme is complete only when:

- Every production role uses the new persistent shell.
- Every valid route belongs to one canonical capability-aware manifest.
- No mobile or tablet width loses navigation.
- No primary destination returns a feature-driven 404.
- Student Today is the single next-action authority.
- Parent child, Teacher class and Admin school scope persist.
- Every displayed metric is sourced and defined.
- Super Admin has one governed shell.
- `/internal/admin` is retired or formally isolated with an approved reason.
- Cosmic global overrides are removed.
- Old role shells are deleted.
- Obsolete Wonder Blocks and legacy primitives have no production consumers.
- Public development preview routes are removed from production.
- WCAG 2.2 AA gates pass.
- The browser and viewport matrix passes.
- Core Web Vitals meet target.
- Production cohorts remain stable through observation.
- Rollback flags, compatibility adapters and old redirects are removed.

The interactive blueprint is the experience contract. Production implementation begins only after the shared shell and representative Student, Teacher, Parent, School Admin and Super Admin screens are approved at phone, tablet and desktop widths.

