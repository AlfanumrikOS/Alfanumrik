# STATUS: Payments & Subscriptions (Cycle 2)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-2
- **Workflow:** payments-subscriptions (P11)
- **Primary invariants:** P11 (payment integrity); P9 (RBAC), P13 (privacy) cross-checks
- **Owner squad:** backend (lead) + architect; testing + frontend + mobile (review chain)
- **Started:** 2026-06-29
- **Status:** **CYCLE 2 LANDED — auto-fix-safe complete; PAY-2 gated to user; mobile-repoint follow-up tracked**

## Phase progress
| Phase | Artifact | Done |
|---|---|---|
| MAP | `01-map.md` | [x] |
| IDENTIFY GAPS | `02-gap-analysis.md` | [x] |
| ROOT CAUSE | `03-root-cause.md` | [x] |
| DESIGN | `04-solution-design.md` | [x] |
| IMPLEMENT | `05-implementation.md` | [x] |
| SELF-REVIEW | `06-self-review.md` | [x] |
| INDEPENDENT VALIDATION | `07-validation.md` | [x] |
| REGRESSION | `08-regression.md` | [x] |

## Completion gate
Status of each gate item for the Cycle-2 *landed* set (PAY-1/3/4/5/6/7/8):

- [x] **Business goal met** for the in-scope set — RBAC parity on `subscribe` (PAY-1), no-student-row 409 guard (PAY-8), atomic reconcile (PAY-3), retryable env-misconfig webhook (PAY-7), observable dedupe degradation (PAY-5), scheduled webhook-silence monitor (PAY-4), verify-HMAC-reject + RBAC pins (PAY-6) landed and approved. *(NOT in scope: PAY-2 pricing — user-gated; PAY-9 optional.)*
- [x] **No broken/empty states** on touched paths — new 403/409 are clean structured errors; checkout handles them SAFE-AS-IS.
- [x] **Accessibility** — N/A (no UI introduced this cycle).
- [x] **Security — P11(1) signature verification** — untouched; invalid HMAC still hard-4xx before any processing.
- [x] **Security — P11(2) atomicity** — completed on the last non-atomic path (PAY-3 via `atomic_subscription_activation_locked` + advisory lock).
- [x] **Security — P11(3) no grant without verified payment** — PAY-1/PAY-8 only add denials; PAY-3 acts only on `captured` rows.
- [x] **Security — P9 RBAC** — `subscribe` now `authorizeRequest`-gated in parity with siblings.
- [x] **Privacy (P13)** — new `logOpsEvent` calls carry no PII; no secret logged in PAY-7.
- [x] **Invariants P1–P15** upheld; P11 + P9 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (236/236 payment suite).
- [x] **build** green; **`vercel.json` VALID** (13 crons ≤ 40 Pro limit).
- [x] **Quality verdict = APPROVE** (`07-validation.md`, independent) + architect security review APPROVE.
- [x] **P14 review chain complete** — backend (made) → architect (security APPROVE) + testing (coverage GREEN) + mobile (downstream review) + frontend (checkout 403/409 SAFE-AS-IS). See `08-regression.md`.
- [ ] **Regression sweep green + catalog filed** — sweep GREEN (`08-regression.md`); **REG-178 / REG-179 filing is in flight** via a separate testing task → not yet confirmed in `.claude/regression-catalog.md` (the 236/236 suite already enforces both behaviors).

## Why NOT fully COMPLETE — open follow-ups (resume here next session)
1. **PAY-2 (Medium, GATED — USER APPROVAL):** `create-order`'s hardcoded `PRICING` table can diverge from DB `subscription_plans`. Architect finding: DEAD on the live web path (web uses `subscribe`); LIVE-referenced only by the mobile app, whose payment flow is already documented-broken. **Do NOT delete unilaterally** (mobile contract names it). Any pricing-amount change is **user-gated**.
2. **Mobile repoint:** mobile to repoint `create-order` → `subscribe`, unwrap nested `data`, add 409 mapping (mobile + backend coordination).
3. **`docs/product/mobile-web-sync.md` doc fix:** stale — says `create-order` route doesn't exist; it exists but is dead on the web path.
4. **Super-admin stuck-payments display (cosmetic):** read period from `student_subscriptions.current_period_end` since reconcile no longer writes `students.subscription_expiry`.
5. **REG-178 / REG-179 filing:** separate testing task to file `verify_route_hmac_reject` (P11) and `subscribe_rbac_gate_pre_razorpay` (P9/P11) into `.claude/regression-catalog.md`.
6. **PAY-9 (Low, optional):** `razorpay_signature` persisted at rest in `payment_history` (verify path only). Not a P11/P13 breach; consistency decision deferred.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder | backend (PAY-1/3/5/7/8) + architect (PAY-4) + testing (PAY-6) | 2026-06-29 | DONE (in-scope set) |
| Architect (security, P14) | architect | 2026-06-29 | **APPROVE** |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |
| Testing | testing | 2026-06-29 | **GREEN** (sweep) |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — auto-fix-safe complete; PAY-2 gated + follow-ups above |
