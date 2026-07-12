# Alfanumrik One Experience: Current-State Assessment

**Assessment date:** 12 July 2026
**Branch assessed:** `agent/phase0-release-gate`
**Programme contract:** *Alfanumrik Frontend Replacement — Full Execution and Implementation Plan* (11 July 2026)

## Executive finding

The repository does not yet contain the planned V3 frontend replacement. The
programme is approximately **5–10% complete** when measured against the attached
definition of complete replacement.

Useful prerequisites exist: a warm light theme, a sizeable component library,
responsive shell primitives, grouped School Admin navigation, role-specific
shells, existing feature-flag infrastructure, route inventories, and an older
four-role interactive prototype. These are inputs to the programme; they are not
evidence that V3 is connected or released.

The immediate Days 1–5 safety patch was only partially complete at the start of
this assessment. This change set implements the outstanding repository-level
safety items before any V3 role migration is attempted. Authenticated staging
and production verification remain explicit release gates.

## Programme status

| Programme area | Current status | Evidence-based assessment |
| --- | --- | --- |
| Immediate safety patch | Partial at assessment start | Student navigation/theme fixes existed, but Parent scope, Teacher data trust, School Admin mobile navigation, AppShell tablet layout, stale Study Plan links, and expired countdowns remained. |
| Phase 0: baseline and governance | Partial | A 177-route inventory and historical audits exist, but there is no approved V3 source-of-truth manifest, complete role journey baseline, or V3 analytics baseline. |
| Phase 1: experience blueprint | Partial / superseded | `docs/design/multi-role-redesign-prototype.html` covers an older four-role Editorial Atlas direction. It omits Super Admin and does not implement the attached Calm Intelligence contract. |
| Phase 2: V3 foundation | Not started | No `packages/ui/src/v3/`, scoped V3 cascade layer, V3 tokens, five role flags, unified capability resolver, or certified V3 shell exists. |
| Student vertical slice | Not started as V3 | Current Student pages remain on the legacy/global shell and route families. |
| Teacher and Parent migration | Not started as V3 | Each role retains independent client shells, local navigation and page-local scope. |
| School Admin migration | Not started as V3 | A grouped legacy shell exists, but not the target V3 shell/capability contract. |
| Super Admin migration | Not started | `/super-admin` and `/internal/admin` remain separate systems; most Super Admin pages own local shell composition. |
| Cross-role hardening | Not started for V3 | Existing checks do not cover the required authenticated role, browser, state, viewport, localisation and accessibility matrix. |
| Legacy deletion | Not started | Atlas, Cosmic, Wonder Blocks, old shells, duplicate routes and compatibility CSS remain in production paths. |
| Flutter alignment | Not assessed in this tranche | Web foundation must be approved before native alignment begins. |

## Critical architectural gaps

1. **No isolated V3 system.** The current design tokens and shell rules live in
   a large global stylesheet. The attached plan requires a locally scoped V3
   root and cascade layer so legacy surfaces cannot be repainted accidentally.
2. **No single UI capability resolver.** Navigation is split across Student,
   Parent, Teacher, School Admin and Super Admin manifests. Several current
   paths fail open while flag/module state is unknown, which conflicts with the
   target fail-closed contract.
3. **Role scope is page-local.** Parent child, Teacher class, and analytical
   scope are not governed by one typed shell contract and URL/cache-key policy.
4. **Shell composition is client-heavy.** Authentication, capability and scope
   resolution are not server-first across roles.
5. **Branding is duplicated.** Tenant and school providers coexist rather than
   one controlled, server-resolved branding input.
6. **Release gates remain incomplete.** This worktree adds an explicit
   `chromium` project and starts a local target when CI does not provide an
   external `BASE_URL`, so the advisory suite can execute rather than fail at
   configuration or connection time. The general E2E step still uses
   `continue-on-error`, and visual/accessibility tests do not certify the full
   attached role, state, browser and viewport matrix.

## Safety-tranche scope

This implementation tranche is intentionally limited to current-user safety:

- preserve navigation at every current breakpoint and remove the AppShell
  tablet gutter;
- provide complete School Admin mobile navigation with safe-area clearance;
- preserve Parent child scope and make failed reads recoverable;
- remove invented Teacher metrics and make the class filter real;
- route legacy Study Plan actions to the working Exam Prep experience;
- remove expired approximate examination countdowns;
- retain the already-verified light-theme/Cosmic-disable behavior.

This tranche does **not** enable V3 cohorts, migrate role routes, change global
brand tokens, delete legacy UI, deploy an Edge Function, run a database
migration, or modify production configuration.

## Worktree validation snapshot

- Host TypeScript passed with `tsc --noEmit`.
- Fifty-nine focused runtime tests passed: Student 5, Parent 11, Teacher 25,
  and School Admin/AppShell 18.
- Playwright successfully collected 345 Chromium tests across 38 files; the
  full browser suite was not executed.
- The auth-flow guard and `git diff --check` passed.
- Targeted ESLint passed for 37 changed TypeScript files. The remaining file,
  `packages/lib/src/constants.ts`, reproduces the same three subject-import
  rule failures from `HEAD` and was not made worse by this tranche.
- A placeholder-only local production build emitted no application diagnostic
  but did not complete within the bounded validation window.
- The local `/welcome` route subsequently compiled and rendered in the in-app
  browser at 320×568 and 768×1024 without document-level horizontal
  overflow. Authenticated role journeys and responsive visual certification
  remain unvalidated; the standalone Playwright smoke could not launch because
  its Chromium binary is not installed on this machine.
- Deno-native Edge tests, live Supabase queries, authenticated staging flows,
  deployment and production verification were not run.

## Required next implementation phase

After this safety tranche is verified, the next coherent batch is the V3
foundation only:

1. Approve a five-role, code-backed Calm Intelligence blueprint at phone,
   tablet and desktop sizes.
2. Create `packages/ui/src/v3/` with exact scoped semantic tokens, fallbacks,
   certified primitives and an accessible overlay foundation.
3. Add the five default-OFF sticky role flags and a single server capability
   resolver consumed by both navigation and route guards.
4. Build one server-composed responsive shell plus typed Student, Teacher,
   Parent, School and Super Admin scope contracts.
5. Add route-manifest, interaction, accessibility, responsive visual, browser,
   bundle and literal-colour gates before migrating the Student vertical slice.

No production cohort should be enabled until those foundation exit gates pass.
