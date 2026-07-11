# Alfanumrik One Experience V3 — production-candidate evidence

Evidence date: 12 July 2026 (IST)

Status: production candidate with all five role flags OFF. This evidence does
not authorize a cohort rollout. Protected CI, independent approval, database
preflight and the staged rollout gates remain mandatory.

## Implementation evidence

- Exact lockfile dependencies installed with Node 22.23.1 (1,141 packages).
- Host TypeScript: pass.
- Full host ESLint: pass.
- Consolidated V3/security/auth suite: 14 files, 148 tests passed.
- Selected-school/RBAC/RPC suite: 4 files, 54 tests passed.
- Teacher remediation ownership suite: 22 tests passed.
- V3 frontend contract: pass.
- OpenAPI v2 drift check: pass.
- Migration lint: 381 migrations scanned, zero failures.
- Peer-dependency and Next.js cold-boot guard: pass.
- Production Next.js build: pass; 402/402 pages generated.
- Build ID: `J1yrYz-1i4vCKCJ1-ndUO`.
- Production preview-route denial: HTTP 404 with an empty body.
- Bundle budget: shared JS 283.1/288 kB; middleware 87.1/120 kB;
  205 page bundles measured with zero above the 260 kB page cap.
- Flutter analyzer, tests and debug APK build passed in protected Mobile CI for
  the preceding mobile implementation commit; the final nullable-model update
  is Dart-formatted and must pass the fresh PR CI cycle before merge.

## Responsive preview evidence

- 50/50 Chromium role-by-viewport cases passed: five roles at all ten approved
  viewport sizes from 320×568 through 1920×1080.
- 10/10 enhanced cases passed: keyboard skip/focus, mobile More focus trap,
  Escape/focus restoration, reduced motion, five long-Hindi reflow cases,
  200% text at 320 px, and coarse-pointer touch.
- Representative reviewed captures:
  - `student-mobile.png`
  - `teacher-desktop.png`
  - `parent-tablet.png`
  - `school-admin-mobile.png`
  - `super-admin-desktop.png`

The preview is deliberately labelled as unauthenticated component evidence. It
does not substitute for seeded authenticated journeys, VoiceOver/NVDA review,
manual Firefox/WebKit/Safari certification, Windows scaling or physical-device
certification.

## Security and data-trust evidence

- V3 cohort and route resolution is server authoritative and fail closed.
- Legacy rendering occurs only for an explicit flag-off/unauthenticated auth
  boundary; authenticated RBAC, invalid-scope and resolver failures do not fall
  back to legacy UI.
- Parent child and School Admin school scopes are membership-validated and are
  included in request/cache keys.
- Multi-school permissions resolve against the selected school; direct student
  roster RPCs independently verify membership, permission and school scope.
- Canonical route matching denies filtered specific routes instead of falling
  through to broader prefixes.
- Teacher generic assignment and targeted remediation are independently gated
  by the permissions enforced by their APIs.
- Teacher remediation validates the source alert against the same teacher,
  learner and roster-derived class.
- Missing metrics render `—`; source freshness is never invented. Browser
  receipt time is labelled separately as `Retrieved`.
- Super Admin logout is a documented same-origin session-boundary exception so
  expired HttpOnly cookies can be cleared without requiring a valid session.

## Mandatory pre-merge and rollout gates

1. Fresh protected CI must pass on the final PR head, including Mobile CI,
   live-database integration, OpenAPI, security sweeps and Vercel deployment.
2. The new selected-school RPC migration must pass production dry-run/preflight.
3. Independent review approval is required; branch protection must not be
   bypassed.
4. Merge deploys code with every V3 cohort flag still OFF.
5. Follow `docs/deployment/one-experience-v3-rollout.md`: internal accounts,
   pilot school, then sticky 5%, 25%, 50% and 100% cohorts with rollback gates.
6. Complete the manual browser, assistive-technology and physical-device matrix
   before enabling an external cohort.
