# 08 — Regression: Parent Portal (Cycle 7)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-7
- **Workflow:** parent-portal (dual auth + DPDP) — P8 (RLS boundary), P13 (data privacy), P15 (onboarding integrity); P9 cross-check
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Parent / guardian suites green — **104/104 target + 404/404 broad** PASS (incl. the **5 new files / 71 new tests**).
- [x] No previously-passing test now skipped or weakened — the new tests are **additive** pins (link-code filter-injection + shared-validator twin parity; per-IP rate limit; profile authz gate; unlinked-parent deny across all 9 child-data routes). No existing assertion edited.
- [x] type-check green; lint 0 errors; build green; bundle within **P10** caps (server routes + Edge Function + tiny pure validator + test-only files; no shared-chunk or page-budget impact).

## P14 review-chain completeness — COMPLETE

Per `.claude/skills/review-chains/SKILL.md`, an auto-fix-safe parent-portal security hardening (backend-made; no consent/link-model or RBAC change) requires backend (impl) → testing (coverage) + quality (independent validation); architect is noted for the gated/RLS follow-ups:

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker (input validation + rate limit + authz gate) | **backend** | PP-2 shared `isValidLinkCode` + Deno twin + 3-site application; PP-1 per-IP rate limit on Edge `parent_login`; PP-4 `authorizeRequest('profile.update_own')` + self-scope | DONE |
| Coverage | **testing** | PP-5 unlinked-parent deny across all 9 child-data routes + the 5-file/71-test suite; filed REG-188/189/190 | **GREEN** (104/104 target + 404/404 broad) |
| Independent validation | **quality** | re-ran all gates; confirmed validator-twin parity, gate-before-filter at all 3 sites, already-granted permission | **APPROVE** |
| Noted (gated/RLS follow-ups) | **architect** | PP-5 client migration to RLS-scoped reads; PP-1 durable (Upstash/DB-backed) limiter | NOTED (follow-up) |

**Chain: COMPLETE** for the auto-fix-safe set. (PP-1-consent + PP-3 open their own USER-governance gate for the parent-link consent/link-model decision.)

## Dependent-workflow regression result

The parent-portal surface shares dependencies with the auth/onboarding funnel (link creation), the relationship domain (`canAccessStudent` / `isGuardianLinkedToStudent`), and the cross-role data boundary. No regressions:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Parent link funnel (A1 approve-link / A2 OTP / A3 accept-invite) | `link_code`/`invite_code` lookup via `.or()` | none — the validator only rejects out-of-format codes; valid 6-/8-char codes pass exactly as before; each site keeps its posture |
| Auth / onboarding (REG-110/111/117) | bootstrap fallback + parent↔child approve-link boundary | none — funnel branches unchanged; REG-110/111/117 still green |
| Cross-role data boundary (`canAccessStudent`) | `status IN ('active','approved')` guardian-link rule | none — PP-5 pins the deny posture; boundary rule unchanged |
| Edge `parent-portal` other actions (dashboard/attendance/monthly) | `handleParentLogin` rate-limit block + the validator import | none — the rate limit + validation are scoped to the `parent_login` link-code path; other handlers unaffected |

## Existing parent / auth regressions — still green

| REG-ID | Pins | Status after Cycle 7 |
|---|---|---|
| REG-110 | bootstrap Bearer fallback (P15) | **green** — funnel untouched |
| REG-111 | link-status fail-soft (P15) | **green** — untouched |
| REG-117 | parent↔child approve-link boundary (P8/P13) + auth-callback funnel resilience (P15) | **green** — the consent (A1) path is untouched; PP-2 only adds input validation on the link-code lookup |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Filed in catalog? |
|---|---|---|---|
| **REG-188** | P8/P13 | parent link-code PostgREST `.or()` filter-injection — `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) rejects crafted control-char codes BEFORE the lookup at all 3 sites (request-otp silent-success / accept-invite 409 / Edge `parent_login` 200 no-match); byte-identical Next.js↔Deno validator-twin parity | filed → catalog 157 |
| **REG-189** | P8/P13 | per-IP brute-force rate limit on the legacy Edge `parent_login` — 5/hour, 6th → 429 + `Retry-After`, applied before any DB lookup; PII-safe warn (limits/counts only) | filed → catalog 157 |
| **REG-190** | P9 + P8/P13 | `PATCH /api/parent/profile` authz gate (`profile.update_own`, already-granted; self-scope/no-IDOR) + unlinked-parent deny (403, no child payload) across all 9 child-data routes + canonical guardian-link boundary | filed → catalog 157 |

> `.claude/regression-catalog.md` is authoritative. Catalog **154 → 157**.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Parent link-code injection (P8/P13) | `link_code`/`invite_code` interpolated un-escaped into `.or()` at 3 sites; no test | **`isValidLinkCode` before the filter at all 3 sites + twin-parity pin** (REG-188) |
| Edge `parent_login` brute-force (P8/P13) | client-side sessionStorage lockout only (bypassable); no server limiter | **per-IP 5/hour server limiter, 429 + Retry-After, pre-DB** (REG-189) |
| `PATCH /api/parent/profile` authz (P9) | bespoke Bearer→getUser→guardian; no `authorizeRequest` | **`authorizeRequest('profile.update_own')` + self-scope pin** (REG-190) |
| Child-data deny coverage (P8/P13) | per-route checks present but no deny-payload regression pins | **unlinked-parent 403 / no-payload across all 9 routes** (REG-190) |
| Regression catalog entries | 154 (REG-186/187, Cycle 6) | **157** with REG-188 (link-code injection) + REG-189 (rate limit) + REG-190 (authz + deny) |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-7 row).

## Residual risk

1. **PP-1 consent posture — GATED (USER, HIGH, DPDP-relevant).** `parent_login` creates an ACTIVE guardian link from a link code ALONE (no approval). The rate limit closes brute-force; the consent-model fix (require approval / deprecate `parent_login`) changes the parent-link consent model → requires **CEO approval**. On the program RISK register.
2. **PP-3 — GATED (USER, MED).** Four parallel link-creation paths + two terminal statuses (`active` vs `approved`); consolidating onto one consent-respecting choke-point changes the link model. Retiring `parent_login` collapses PP-1 + PP-3.
3. **PP-5 client migration — FOLLOW-UP (architect).** Migrate the parent child-data routes to RLS-scoped clients (defense-in-depth); only the Foxy-chat route is RLS-backed today (`is_guardian_of`). The deny tests pin the current app-layer boundary in the interim.
4. **PP-6 — FOLLOW-UP (LOW, behavior-preserving).** Converge `canAccessStudent` vs `isGuardianLinkedToStudent` onto one helper.
5. **PP-7 — FOLLOW-UP (MED, P7).** Server-generated parent insights/tips/glance are English-only — candidate for the Cycle 8 cross-cutting bilingual work (server keying + frontend render review).
6. **PP-1 durable limiter — FOLLOW-UP (architect).** The in-memory `createRateLimiter` resets on cold start / is not cross-instance — track an Upstash/DB-backed counter.
7. **Pre-existing Deno errors** at `parent-portal/index.ts:603/605/629/630` — unrelated to this change; separate cleanup.

## Sweep verdict

**GREEN** — 104/104 target + 404/404 broad PASS, P14 chain complete for the auto-fix-safe set (quality **APPROVE**), no dependent-flow regression, REG-110/111/117 still green, the three new guards (REG-188/189/190) add link-code injection + brute-force + authz/deny coverage; the residual PP-1-consent + PP-3 (USER-gated) and the PP-5-client / PP-6 / PP-7 / durable-limiter follow-ups are gated/follow-up, not sweep failures.
