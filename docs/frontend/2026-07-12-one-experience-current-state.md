# Alfanumrik One Experience V3: current-state assessment

**Assessment date:** 12 July 2026<br>
**Assessed branch:** `agent/one-experience-v3-production-rebuild`<br>
**Programme contract:** *Alfanumrik Frontend Replacement - Full Execution and Implementation Plan*

## Executive finding

The branch now contains a real, integrated One Experience V3 foundation and
five role-specific vertical slices. It is no longer accurate to describe V3 as
"not started". The work includes scoped tokens and components, a shared shell,
server-authoritative capability resolution, role route gates, default-off
feature flags, focused runtime tests, a Flutter alignment slice, and an
unauthenticated review route.

It is also not accurate to call the programme complete or production ready.
The branch has not yet passed fresh protected CI at its final head, the
strictly additive selected-school RPC migration has not been exercised against
an isolated database, the five flag rows are in a separate unmerged pull
request, authenticated journeys have not been certified across the required
browser/device matrix, and no V3 cohort has been enabled. The data-mutating
teacher all-open dedupe migration is deliberately deferred to a later release.
Legacy deletion and the post-rollout observation period have not started.

The implementation therefore represents a substantial production-candidate
integration branch with explicit release gates, not a completed 20-22 week
replacement programme compressed into one session.

## Programme status

| Programme area | Current status | Evidence and remaining gate |
| --- | --- | --- |
| Immediate safety patch | Implemented on branch | Student dead links/countdowns, Parent child scope, Teacher metric honesty/class scope, School Admin mobile navigation, and AppShell tablet behavior have focused runtime coverage. Fresh final-head CI and authenticated preview checks remain. |
| Phase 0: baseline and governance | Partial | Route/access inventories, rollout contracts, evidence templates, and default-off controls exist. Product analytics baselines, named rollout owners, and approved role-journey baselines remain operational work. |
| Phase 1: experience blueprint | Implemented in code, review pending | The shared Calm Intelligence direction is represented by scoped V3 tokens, patterns, shells, manifests, and five role views. Final product/design sign-off and authenticated state review remain. |
| Phase 2: V3 foundation | Implemented on branch | `packages/ui/src/v3`, scoped cascade tokens, capability resolver, role manifests, route gates, overlay primitives, data states, and shared shell exist. Final-head build, bundle, accessibility, and browser gates remain. |
| Student vertical slice | Implemented behind flag | Today, Learn, Practice, Progress, Rewards and Exam destinations have V3 mappings while unmigrated legacy destinations remain available. No external cohort is enabled. |
| Teacher vertical slice | Implemented behind flag | Today, classes, students, insights, grading, assignment, resources and settings are mapped. Remediation verifies exact teacher, class, learner and alert scope server-side, and the route is compatible with the existing assigned-only dedupe index. The data cleanup/all-open index remains a later, independently reviewed migration. Seeded teacher journeys remain unvalidated. |
| Parent vertical slice | Implemented behind flag | Home, plan, progress, reports, calendar, messages and settings preserve authoritative selected-child scope in URLs and request keys. Pagination completeness for child-filtered message RPC results needs backend follow-up. |
| School Admin vertical slice | Implemented behind flag | Overview, people, academics, insights, governance and settings are mapped. The selected-school roster RPC migration adds only new scoped overloads and leaves every legacy signature untouched for rollback compatibility; it has not been applied/tested in an isolated database. |
| Super Admin vertical slice | Implemented behind flag | Command, institutions, operations, governance, revenue and settings share the V3 workspace while legacy internal-admin paths remain available where unmigrated. Seeded privileged-user validation remains mandatory. |
| Cross-role hardening | In progress | Focused security, routing, responsive, metric-trust and accessibility contracts exist. Fresh full CI, local build, browser inspection and manual assistive-technology/device checks are still required. |
| Legacy deletion | Not started | The implementation deliberately retains legacy routes for unmigrated destinations and explicit flag-off users. Deletion is gated on 100% rollout plus observation and deep-link verification. |
| Flutter alignment | Partial | Mobile theme, routing, parent shell and role assignment consume the V3 contract. Assignment is tri-state and fails closed; the complete native screen inventory has not been migrated. |

## Information architecture and route behavior

The role manifests in `packages/lib/src/experience-v3/manifests.ts` are the
code-backed source for migrated destinations. Navigation and route access use
the same capability resolver:

1. Resolve authenticated identity, role, tenant and relevant scope.
2. Resolve the role's sticky V3 assignment server-side.
3. Match a canonical mapped V3 destination.
4. Allow the mapped destination only when its capability is granted.
5. Render legacy for an explicitly disabled assignment or an unmapped legacy
   destination.
6. Deny malformed assignments, resolver failures, unauthorized scopes and
   mapped forbidden routes; these conditions must never fall back to legacy.

The responsive shell owns exactly one persistent main landmark and exposes
desktop rail, compact/tablet, and mobile navigation behavior without duplicating
page landmarks. Role-specific context selectors preserve child, class, school,
year or institution scope as appropriate.

## Primary user flows represented

- **Student:** resume today's next action, learn/practice, inspect progress,
  enter exam preparation, and view rewards without fabricated metrics.
- **Teacher:** select a class, see attention signals, inspect students, create
  work, grade, and issue a remediation only for an owned class and learner.
- **Parent:** select an authoritatively linked child, inspect daily progress,
  reports, calendar and messages, with the child included in data keys.
- **School Admin:** choose the permitted school context, then move between
  overview, people, academics, insights, governance and settings.
- **Super Admin:** access command, institution, operational, governance,
  revenue and settings workspaces through privileged server gates.

## State and permission behavior

Shared V3 data-state primitives cover loading, empty, stale, error and denied
states. Missing measurements display an explicit unavailable value rather than
zero or a generated statistic. Parent and Teacher scope failures remain
recoverable without showing data from a different child or class. Mobile V3
assignment uses `enabled`, `legacy`, and `denied`; only a valid HTTP 200 boolean
`false` selects legacy, while malformed responses, HTTP errors and exceptions
show a recoverable fail-closed access screen.

## Responsive, browser and accessibility contract

The implementation targets 320, 360, 390, 430, 768, 1024, 1280 and 1440 px,
with additional wide-screen coverage in the review suite. It provides one main
landmark, a visible skip target, keyboard-operable overlays, focus restoration,
safe-area-aware mobile navigation, coarse-pointer touch sizing, reduced-motion
styles, long-text reflow, and a Safari 14 fallback that does not depend solely
on `:has()`.

These source and focused-test contracts do not replace final rendered review.
The final branch still requires Chromium inspection at all approved widths,
fresh Firefox/WebKit automation where available, and manual Safari,
screen-reader, 200% zoom, Windows scaling and physical-device checks before an
external cohort can be enabled.

## Design-system boundaries

V3 styling is locally scoped through `ExperienceV3Root` and the V3 cascade
layer. Semantic tokens cover background, surface, text, border, brand, status,
focus, spacing, radius, shadow and motion. Existing legacy globals remain in
place for explicit flag-off and unmigrated routes. Any global token change is
outside this integration and requires separate representative-screen review.

## Release and data gates

- All five V3 role flags must remain disabled with rollout `0` until reviewed.
- The flag seed is maintained in PR #1254 and is not merged at this snapshot.
- The selected-school RPC migration must receive an isolated database dry run,
  RLS/grant review, generated-type refresh and independent approval. Apply its
  additive overloads before the frontend; harden or remove legacy signatures
  only in a later migration after all callers and rollback paths are verified.
- The teacher remediation data cleanup/all-open unique index is not part of
  this release. A later migration requires production row-count and duplicate
  evidence, bounded lock timing, recovery evidence and route-first deployment.
- PR #1255's production completion gate is now on `main` and must succeed for
  the exact deployed SHA; its terminal verification must not be bypassed.
- PR #1256 must pass protected CI and independent last-push approval at its
  final head.
- Merge does not authorize cohort rollout. Follow
  `docs/deployment/one-experience-v3-rollout.md` through internal, pilot, 5%,
  25%, 50% and 100% sticky cohorts with stop/rollback criteria.

## Remaining implementation sequence

1. Complete final-head static, runtime, Deno, Flutter, build and responsive
   browser validation; replace any stale evidence with commit-bound evidence.
2. Validate the additive selected-school migration on an isolated Supabase
   stack, regenerate database types, and prove existing unscoped RPC callers
   remain unchanged before applying it ahead of the frontend.
3. Obtain independent review and green protected CI for the release gate, flag
   seed, additive database change and frontend branch in dependency order.
4. Exercise seeded authenticated accounts for all five roles, including
   loading, empty, stale, error, denied and slow-network states.
5. Merge with all V3 flags off; perform internal and pilot rollout with
   observability and rollback ownership. Keep the teacher all-open constraint
   and legacy school-RPC hardening in later, separately recoverable migrations.
6. Delete legacy shells and compatibility paths only after 100% adoption,
   observation, deep-link verification and a separate reviewed change.

## Completion boundary

This branch may be described as an integrated V3 implementation candidate only
after its final-head checks pass. The full replacement is complete only after
database validation, protected merge, staged rollout, authenticated
cross-browser/device certification, observation, and verified legacy removal.
