# Cycle Log — 2026-06-29 — Parent Portal (P8, P13, P15)

> Dated summary of Cycle 7, the seventh workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/parent-portal/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 7
- **Workflow:** parent-portal (dual auth + DPDP) — parent signup/link → dashboard → child drill-down → comms; parent↔child link boundary, consent, data export/erasure
- **Primary invariants:** P8 (RLS boundary), P13 (data privacy), P15 (onboarding integrity); P9 cross-check
- **Status:** **CYCLE 7 LANDED — parent link-code injection + brute-force + auth-gate hardened; PP-1-consent + PP-3 link-model USER-GATED**

## Headline finding
The parent portal was built in **two eras** — a demo/link-code era (the Edge `parent-portal` function, `active` links, English literals, app-only service-role reads) and a consent/RBAC era (`approve-link`, OTP, `authorizeRequest`, `is_guardian_of()` RLS, `relationship.ts`). The newer era was added **alongside** the older one rather than replacing it, leaving a weaker legacy path live (PP-1), duplicated unsafe idioms (PP-2, PP-6), and deferred obligations (PP-5 defense-in-depth, PP-7 bilingual). No parameter-tampering IDOR was found on the canonical routes (every `student_id`-bearing route verifies the link first). The single highest-leverage remediation — retire/replace the legacy Edge `parent_login` link-create path and converge link creation on one consent-respecting choke-point (collapsing PP-1 + PP-3) — changes the consent/link MODEL and is **USER-GATED**. This cycle landed the complementary, non-gated security hardening.

## Agents involved
- **backend** — workflow lead for MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT (01–05); authored the parent-journey map, the gap analysis (PP-1…PP-7), and the three AUTO-FIX-SAFE fixes (PP-2 shared validator + 3-site application, PP-1 per-IP rate-limit half, PP-4 authz gate).
- **testing** — PP-5 unlinked-parent deny pins across all 9 child-data routes + the canonical guardian-link boundary; the 5-file / 71-test parent suite; regression sweep (104/104 target + 404/404 broad GREEN); filed REG-188/189/190.
- **quality** — independent validation (did not implement); re-ran all gates; confirmed validator-twin byte-parity, gate-before-filter at all 3 sites, and that `profile.update_own` is already granted to the parent role; verdict **APPROVE**.
- **architect** — noted for the gated/RLS follow-ups (PP-5 client migration to RLS-scoped reads; PP-1 durable Upstash/DB-backed limiter). PP-1-consent / PP-3 link-model decisions are USER-gated.
- **ops (this doc)** — documentation finalization (04/05 reconciliation; 06/07/08 + STATUS; STATE/backlog/coverage updates; this cycle log).

## Gaps found (PP-1 … PP-7) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| PP-1 | Legacy Edge `parent_login` grants an `active` link from a link code ALONE (no approval) + no server rate limit | **HIGH** | backend (rate-limit half) / **user** (consent half) | **SPLIT** — rate-limit half **LANDED** (per-IP 5/hour, 429 + Retry-After, pre-DB → REG-189); **consent posture USER-GATED** (DPDP/child-consent; changes the consent model). On the RISK register. |
| PP-2 | PostgREST `.or()` filter built by string-interpolating an un-escaped `link_code` (3 sites) | MED (P8/P13) | backend | **LANDED** — shared `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) in `src/lib/sanitize.ts` + byte-identical Deno twin; applied BEFORE the filter at all 3 sites; each keeps its posture. → REG-188 |
| PP-3 | Four parallel link-creation paths with divergent postures + two terminal statuses (`active` vs `approved`) | MED | **user** | **GATED (USER)** — consolidate onto one consent-respecting choke-point; changes the link model. Retiring `parent_login` collapses PP-1 + PP-3. |
| PP-4 | `PATCH /api/parent/profile` has no `authorizeRequest` RBAC gate | LOW (P9) | backend | **LANDED** — `authorizeRequest('profile.update_own')` (already-granted parent permission) + self-scope; no new RBAC; no IDOR. → REG-190 |
| PP-5 | Child-data reads are app-only (no RLS defense-in-depth) except the Foxy-chat route | MED (P8/P13) | testing (tests) / architect (client migration) | **SPLIT** — deny-pin tests **LANDED** (403, no payload, across all 9 child-data routes → REG-190); **client migration to RLS-scoped reads = architect follow-up**. |
| PP-6 | Two interchangeable boundary helpers (`canAccessStudent` vs `isGuardianLinkedToStudent`) | LOW | backend | **FOLLOW-UP** — behavior-preserving convergence; not done this pass. |
| PP-7 | Server-generated parent insight/tip/glance strings are English-only (P7) | MED | ops/frontend | **DEFERRED (Cycle 8)** — bilingual breadth; server keying + frontend render review. |

Plus compliant positives (no parameter-tampering IDOR on canonical routes; deny paths carry no payload; PII-safe UUID-only logging with truncated codes; the OTP path is well-hardened — per-IP + per-challenge limits, constant-time compare, silent-success enumeration defense; the Edge Function ignores `body.auth_user_id` and overrides `body.guardian_id` with the JWT-resolved guardian; RLS on `guardian_student_links` + `is_guardian_of()` on child-data tables).

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe security hardening; no consent/link-model or RBAC change):** PP-2 (backend — link-code injection guard, 3 sites + Deno twin), PP-1 rate-limit half (backend — per-IP brute-force bound on the Edge path), PP-4 (backend — profile authz gate via an already-granted permission), PP-5 deny pins (testing — 9 child-data routes + guardian boundary).
- **Gated (USER APPROVAL required):** PP-1 consent posture (parent-link consent model — DPDP/child-consent), PP-3 (link-model consolidation). Surfaced to CEO via the program RISK register.
- **Follow-ups:** PP-5 client migration to RLS-scoped reads (architect), PP-6 helper convergence (backend, behavior-preserving), PP-7 bilingual server strings (Cycle 8 cross-cutting), PP-1 durable Upstash/DB-backed limiter (architect), pre-existing Deno errors at `index.ts:603/605/629/630` (separate cleanup).

## Files touched (code/test — by builders, outside this doc-only finalization)
- `src/lib/sanitize.ts` (PP-2 — `LINK_CODE_RE` + `isValidLinkCode`, new)
- `supabase/functions/_shared/link-code.ts` (PP-2 — byte-identical Deno twin, new)
- `src/app/api/parent/link-code/request-otp/route.ts` (PP-2 — validate before `.or()`; invalid → silent-success)
- `src/app/api/parent/accept-invite/route.ts` (PP-2 — validate before `.or()`; invalid → 409)
- `supabase/functions/parent-portal/index.ts` (PP-1 rate-limit + PP-2 — per-IP limiter on `handleParentLogin`; validate before `.or()`; `TODO(PP-1, USER-GATED)`)
- `src/app/api/parent/profile/route.ts` (PP-4 — `authorizeRequest('profile.update_own')` + self-scope)
- test files (5 new): `parent-link-code-injection.test.ts`, `parent-link-code-shared-validator.test.ts`, `parent-login-rate-limit.test.ts`, `parent-profile-authz.test.ts`, `parent-child-data-deny.test.ts`

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **5 new files / 71 new tests; 104/104 target + 404/404 broad parent/guardian PASS**
- build **PASS**; bundle within **P10** caps (server routes + Edge Function + tiny pure validator + test-only files; no shared-chunk or page-budget impact)
- quality verdict **APPROVE**; regression sweep **GREEN**

## P14 review chain — COMPLETE
backend (impl PP-2 + PP-1 rate-limit half + PP-4) + testing (PP-5 deny pins + the 5-file/71-test suite, coverage GREEN) → quality (independent **APPROVE**); architect noted for the gated/RLS follow-ups (PP-5 client migration + PP-1 durable limiter).

## Regression catalog
- **REG-188** (P8/P13) — parent link-code PostgREST `.or()` filter-injection guard at all 3 sites + byte-identical Next.js↔Deno validator-twin parity.
- **REG-189** (P8/P13) — per-IP brute-force rate limit on the legacy Edge `parent_login` (5/hour, 429 + Retry-After, pre-DB; PII-safe warn).
- **REG-190** (P9 + P8/P13) — `PATCH /api/parent/profile` authz gate (`profile.update_own`, self-scope/no-IDOR) + unlinked-parent deny (403, no child payload) across all 9 child-data routes.
- Catalog 154 → **157**. Existing parent-funnel entries **REG-110 / REG-111 / REG-117 remain green**.
  (Authoritative: `.claude/regression-catalog.md`.)

## Program-level RISK (CEO visibility)
- **PP-1 consent posture — USER-gated parent-link consent model (DPDP/child-consent).** The legacy Edge `parent_login` creates an ACTIVE, fully-equivalent guardian link from possession of a link code ALONE — no student-approval step. Anyone who learns a child's link code (a tuition centre, a non-custodial adult, a leaked screenshot) and holds an authenticated account can self-attach as an `active` guardian and read the full child dashboard. The Cycle-7 rate limit closes server-side brute-force; the consent gap remains. The design fix — make `parent_login` create `pending` links requiring approval/OTP, or deprecate it now that `/api/v2/parent/*` is canonical — changes the consent/link MODEL → requires CEO approval. PP-3 (link-model consolidation) folds into the same decision; retiring `parent_login` collapses both. **CEO action:** approve the consent-model correction (require approval / deprecate `parent_login`); confirm no unauthorized `parent_login` link-creation in audit logs.

## Next workflow
**Cross-cutting** — `PRIORITY-BACKLOG.md` rank 8 (invariants P7, P8, P10, mobile sync): bilingual (P7) parity breadth (incl. PP-7), RLS (P8) breadth across all tables (incl. PP-5 client migration), bundle budget (P10), mobile-web API contract sync. The final horizontal cycle. Owner squad: quality (lead) + frontend + mobile + architect.
