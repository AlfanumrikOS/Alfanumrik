# Certification journey-run-01 - Frontend triage of live failures

Live run target: Vercel Preview (staging-backed), 2026-07-02, via automation-bypass.
Baseline first run: 21 passed / 7 failed / 8 skipped. Triage owner: frontend.

## Cluster A - Logout click intercepted (student, parent, teacher, super-admin logout) - TEST-SPEC
The interceptor was the global cookie-consent banner (a fixed-position, high-z-index element with
a paragraph, mounted via the deferred layout chrome). On a fresh browser context consent is
pending, so the banner overlays the bottom-left sidebar-footer Logout button and intercepts the
click. A real user dismisses the banner first - standard consent UI, not a defect. Fixed by
pre-seeding consent in the shared test helper before first navigation.
Additional student-only test-spec bug: the student portal has no logout in the dashboard sidebar
(the account section is collapsed and only links to the profile page); Sign Out lives on the
profile page. The student spec now navigates there before signing out. Super-admin logout was
re-pathed onto the console flow and correctly returns to the console login page; the assertion was
corrected. Status: FIXED (test-spec); all four logout journeys pass live.

## Cluster B - Super Admin auth + dashboard - TEST-SCOPE (not a defect)
The seed creates a genuine super_admin (an admin_users row, super_admin admin level, active). The
specs used the shared login form, which routes by active role and has no super_admin mapping (so
it defaults to the student dashboard); the auth context never resolves an admin-only identity to a
portal role. The super-admin panel has its OWN console login path (its own login page and API
route, with rate-limit/lockout, Supabase auth, and admin membership check) leading to the panel
behind a session-gated shell. Confirmed live: routed through the console, the panel renders real
content. Fix: the specs now authenticate via the console; assertions strengthened (assert actual
panel access), not weakened. Status: FIXED (test-scope); all three super-admin journeys pass.
Minor awareness observation (not a recorded defect): the shared login form silently sends a
super_admin to the student dashboard instead of pointing them at the console. Low severity.

## Cluster C - Teacher can reach Foxy - REAL PRODUCT FINDING: CERT-FE-01

### CERT-FE-01 - /foxy has no role gate; non-student roles reach the student AI tutor page
- Severity: Medium (access-control / scope-boundary gap). Contradicts Wave 1 report 04's claim
  that teachers have no Foxy access ("confirmed this is an intentional scope boundary").
- Evidence (code): the Foxy page's only guard redirects when NOT logged in; there is no
  wrong-role redirect, and middleware route protection for it was removed. It is not role-gated
  anywhere.
- Evidence (live): with the spec's login race fixed (establish the teacher session before
  navigating to Foxy), an authenticated teacher lands on the Foxy page and it renders its own
  chrome - it does not redirect the teacher away. Final URL is the Foxy page.
- Caveat: this records PAGE-level reachability only. Whether the Foxy API route actually serves
  tutoring content to a teacher-role session (and any data-exposure question) was NOT assessed -
  deferred to ai-engineer/backend. What is definitively shown is that the page-level scope
  boundary claimed in report 04 is not enforced.
- Proposed fix (separately gated - NOT done in triage): either add a role gate to the Foxy page
  (redirect non-student roles to their portal home) OR consciously update report 04 to declare
  teacher (and other non-student) Foxy access in-scope. Needs assessment + architect (+ ai-engineer
  for the API layer) review. The teacher Foxy test is left intentionally RED to hold the line.

## Summary
| Failure | Cluster | Verdict | Action |
|---|---|---|---|
| student logout | A | test-spec (banner + logout-on-profile) | fixed spec |
| parent logout | A | test-spec (cookie banner) | fixed helper |
| teacher logout | A | test-spec (cookie banner) | fixed helper |
| super-admin logout | A/B | test-spec (console flow + assertion) | fixed spec |
| super-admin auth | B | test-scope (wrong login path) | fixed spec |
| super-admin dashboard | B | test-scope (cascade of auth) | fixed spec |
| teacher Foxy | C | REAL FINDING (CERT-FE-01) | recorded; test left RED |
