# 06 — Self-Review: Parent Portal (Cycle 7)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-7
- **Workflow:** parent-portal (dual auth + DPDP) — P8 (RLS boundary), P13 (data privacy), P15 (onboarding integrity); P9 cross-check
- **Reviewer (authors):** backend (lead — PP-2 shared validator + 3-site application, PP-1 rate-limit half, PP-4 authz gate) + testing (PP-5 deny pins + the 5-file suite)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Severity | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|---|
| **PP-2** | MED (P8/P13) | backend | yes | new `isValidLinkCode`/`LINK_CODE_RE` (`^[A-Z0-9]{4,12}$`) in `src/lib/sanitize.ts` + byte-identical Deno twin `supabase/functions/_shared/link-code.ts`; applied BEFORE the `.or()` filter at request-otp, accept-invite, Edge `parent_login`; tests `parent-link-code-injection.test.ts` + `parent-link-code-shared-validator.test.ts` | Filter-injection class closed at all 3 interpolation sites; each site keeps its posture (silent-success / 409 / 200 no-match). Link-code FORMAT unchanged — validator only rejects out-of-format input. → REG-188 |
| **PP-1 (rate-limit HALF)** | HIGH (auto-fix-safe half) | backend | yes (half) | `supabase/functions/parent-portal/index.ts` — per-IP `createRateLimiter` (5/hour) on `handleParentLogin` BEFORE the DB lookup → 429 + `Retry-After`; test `parent-login-rate-limit.test.ts` | Closes server-side brute-force on the legacy Edge path (mirrors the hardened OTP per-IP bound). The CONSENT-posture change (link-code-alone → active with NO approval) is deliberately NOT touched — USER-GATED; in-code `TODO(PP-1, USER-GATED)` left. → REG-189 |
| **PP-4** | LOW (P9) | backend | yes | `src/app/api/parent/profile/route.ts` — `authorizeRequest('profile.update_own')` (already-granted parent permission) + self-scope to `auth.userId`; test `parent-profile-authz.test.ts` | No new RBAC code/permission added (that would be USER-GATED); no IDOR (no body-supplied id). → REG-190 |
| **PP-5 (test HALF)** | MED (P8/P13) | testing | yes (test-only) | `parent-child-data-deny.test.ts` — unlinked-parent 403 (no child payload) across all 9 child-data routes + the canonical guardian-link boundary | Defense-in-depth pin. The client-migration HALF (read child data through RLS-scoped clients) is architect-owned and NOT done here. → REG-190 |
| **PP-1 (consent posture)** | **HIGH** | user | **GATED (USER)** | `parent_login` creates an ACTIVE guardian link from a link code ALONE — no student/approval step (`index.ts` handleParentLogin) | DPDP/child-consent. The design fix (require approval, or deprecate `parent_login` in favor of OTP/approve-link) changes the consent MODEL → REQUIRES CEO APPROVAL. On the program RISK register. NOT touched. |
| **PP-3** | MED | user | **GATED (USER)** | four parallel link-creation paths with divergent postures + two terminal statuses (`active` vs `approved`) | Consolidating onto one consent-respecting choke-point changes the link MODEL → CEO approval. Retiring `parent_login` collapses PP-1+PP-3. NOT touched. |
| **PP-6** | LOW | backend | **DEFERRED (follow-up)** | two boundary helpers (`canAccessStudent` vs `isGuardianLinkedToStudent`) | Behavior-preserving convergence; tracked as a follow-up, not done this pass. |
| **PP-7** | MED (P7) | ops/frontend | **DEFERRED (Cycle 8)** | server-generated parent insights/tips/glance are English-only | Bilingual breadth — candidate for the Cycle 8 cross-cutting P7 work (server keying + frontend render review). |

## Self-review checklist

- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly gated/deferred (PP-2 landed; PP-1 rate-limit half landed + consent half USER-gated; PP-4 landed; PP-5 test half landed + client-migration deferred to architect; PP-3 USER-gated; PP-6/PP-7 follow-ups).
- [x] **PP-2 closes the injection class at ALL THREE `.or()` sites** via ONE shared validator (two synchronized copies for the supabase/↔src/ deploy boundary, with cross-reference comments + a twin-parity test). `[A-Z0-9]{4,12}` admits no PostgREST metacharacter (`,` `.` `(` `)` `*` `:` quote/whitespace).
- [x] **Link-code FORMAT unchanged** — the validator only rejects out-of-format input; valid 6-char `link_code` and 8-char `invite_code` pass exactly as before. Each site preserves its existing rejection posture (enumeration-safe silent-success / generic 409 / generic 200).
- [x] **PP-1 is the AUTO-FIX-SAFE HALF only** — a server-side per-IP rate limit applied before any DB lookup. The consent-posture change is NOT made; a clear `TODO(PP-1, USER-GATED)` marks it in code and it is surfaced to the RISK register.
- [x] **No consent/link-model change and no RBAC role/permission change** — PP-4 reuses `profile.update_own` (already granted to the parent role); the PP-1 consent fix and PP-3 consolidation are left GATED (owner = user).
- [x] **PP-4 self-scope / no IDOR** — the update target is resolved from the verified `auth.userId`; no body-supplied id selects the row.
- [x] **P13: no PII in any new log** — the PP-1 warn logs limits/counts/`retry_after_ms` only (never IP / link code / name / email / phone); the request-otp invalid-format audit logs a 2-char prefix + length only.
- [x] **PP-5 deny pins carry no child payload** — 403 on every unlinked-parent path across all 9 child-data routes.
- [x] **type-check** PASS; **lint** 0 errors; **104/104 target + 404/404 broad** parent/guardian tests PASS; **build** PASS; no bundle impact.
- [x] Ownership/scope — backend edits limited to the shared validator + the 3 application sites + the profile route; testing edits limited to the 5 new test files. No payment / scoring / AI surface touched.

## Known limitations carried forward (for the independent reviewer)

1. **PP-1 consent posture is USER-GATED, not fixed.** `parent_login` still creates an ACTIVE guardian link from a link code ALONE (no approval). The rate limit closes brute-force; the consent-model remediation (require approval / deprecate `parent_login`) is a DPDP-relevant access-model change requiring CEO approval. On the program RISK register.
2. **PP-3 is USER-GATED.** Four parallel link-creation paths + two terminal statuses (`active` vs `approved`); consolidating onto one consent-respecting choke-point changes the link model. Retiring `parent_login` collapses PP-1 + PP-3.
3. **PP-5 client migration (architect).** Only the Foxy-chat route reads through an RLS-scoped client today (backed by `is_guardian_of`); migrating the other child-data routes to RLS-scoped clients is the defense-in-depth half and is architect-owned. The deny tests pin the current app-layer boundary in the interim.
4. **PP-6 (LOW, behavior-preserving).** Converge `canAccessStudent` vs `isGuardianLinkedToStudent` onto one helper — follow-up.
5. **PP-7 (MED, P7).** Server-generated parent insights/tips/glance are English-only — candidate for Cycle 8 cross-cutting bilingual work.
6. **PP-1 durable limiter (architect).** The in-memory `createRateLimiter` resets on cold start / is not cross-instance — track an Upstash/DB-backed counter.
7. **Pre-existing Deno errors** at `parent-portal/index.ts:603/605/629/630` (`todayStudyTime`/`todayQuizzes` inferred as `{}`) — unrelated to this change, verified present pre-change, separate cleanup.

## Ready for independent validation?

**YES.** All Cycle-7 auto-fix-safe items (PP-2 backend, PP-1 rate-limit half backend, PP-4 backend, PP-5 deny pins testing) are implemented and locally green. PP-1 consent posture + PP-3 (USER-gated) and PP-5 client-migration / PP-6 / PP-7 / durable-limiter (follow-ups) are explicitly recorded with owners and were not touched.
