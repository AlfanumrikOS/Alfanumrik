# 12 - Mobile Compatibility Certification Report

Stage 1 (static/read-only, plus a fresh local Flutter analyze and test run), 2026-07-02.

## Build health

A fresh static-analysis pass over the Flutter app completed with zero issues, and the existing
test suite passed 146 of 146 tests, all running against mocked dependencies with no live backend
required. A separate CI workflow was independently confirmed to actually compile a debug APK as
part of continuous integration, not merely run static analysis.

## File-count reconciliation

Prior counts of the mobile codebase's size varied between roughly 230 and 410 files depending on
methodology. This wave reconciled all of them: the larger number is a raw, unfiltered count; the
smaller number silently includes a generated API client's own files; a clean hand-written-source-
plus-tests count is approximately 90 files. This is a documentation-precision finding, not a
functional one.

## API parity

The mobile app's networking layer targets the same versioned API surface independently
inventoried by the backend domain this wave, and no route was found to be called by the mobile
client without a server-side counterpart, or vice versa, within the scope checked.

## Authentication

The mobile app uses the same underlying authentication service and token flow as the web
client.

## Shared business rules

Two assumptions carried into this wave's task briefing were checked against the current code and
found to be stale: the mobile app does not hardcode any experience-point values (it is fully
server-authoritative, sourced from the same single owning constant file's intent even though the
value itself is read from the server response), and its usage-limit logic matches the web
client's logic value-for-value at every point compared.

## Open findings specific to mobile

- The most material cross-cutting finding of this wave - the suspended/deleted-account
  quiz-access gap at the database-function layer - was independently confirmed reachable through
  the mobile app's default configuration as ordinary behavior, not a crafted attack path. This
  is the strongest evidence in the entire certification package that the gap is a live,
  practical risk rather than a theoretical one.
- A cosmetic defect was found in the mobile client's plan-name display logic: it has no
  recognized case for the exact plan-code values the live payment system writes, so some paying
  subscribers see "Free" in the interface. The underlying entitlement and usage-gating logic is
  unaffected - this is a display bug, not an access-control bug.
- A reference to a retired backend AI function remains in the mobile client as a dead fallback
  branch, accompanied by a comment describing it as a rollback path that no longer applies.
- No global session-expiry handler was found; an expired session currently surfaces to the user
  as a generic error rather than a clean forced re-authentication flow.
- A privacy-policy document was not found within the mobile app's own assets; whether one is
  hosted and linked externally was not confirmed this wave.

## Offline behaviour

The offline quiz-replay mechanism referenced by the platform's own regression catalog was
located and its presence confirmed; a full behavioral re-verification of its invariant-safety
claims was not performed this wave beyond confirming the code exists and is structurally
consistent with those claims.

## Deep links and version compatibility

Deep-link routing was located; no case was found where it would route directly into an
unauthenticated-appropriate screen it should not. Whether the backend enforces a
minimum-supported-app-version gate against stale mobile clients was not confirmed this wave.
