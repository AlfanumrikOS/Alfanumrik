# Cycle Log — 2026-06-29 — Payments & Subscriptions (P11)

> Dated summary of Cycle 2, the second workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/payments-subscriptions/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 2
- **Workflow:** payments-subscriptions
- **Primary invariants:** P11 (payment integrity); P9 (RBAC), P13 (privacy) cross-checks
- **Status:** **CYCLE 2 LANDED — auto-fix-safe complete; PAY-2 gated to user; mobile-repoint follow-up tracked**

## Agents involved
- **backend** — workflow lead + maker: PAY-1, PAY-3, PAY-5, PAY-7, PAY-8.
- **architect** — PAY-4 (`vercel.json` cron registration) + mandatory P14 payment-flow security review (APPROVE).
- **testing** — PAY-6 (verify-HMAC-reject test + extend RBAC pin to `subscribe`); regression sweep (236/236 GREEN); (in flight) filing REG-178 / REG-179.
- **mobile** — downstream review (confirm checkout tolerates new 403/409; mobile repoint tracked).
- **frontend** — checkout-client review (403/409 handled SAFE-AS-IS).
- **quality** — independent validation (did not implement); verdict APPROVE.
- **ops (this doc)** — ledger finalization.

## Gaps found (PAY-1 … PAY-9) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| PAY-1 | `subscribe` lacks `authorizeRequest` RBAC gate | Medium (P9/P11) | backend | **LANDED** — 403 before any Razorpay object; parity with siblings |
| PAY-2 | `create-order` hardcoded `PRICING` diverges from DB `subscription_plans` | Medium (P11-adjacent) | — | **GATED — USER APPROVAL** — DEAD on live web path; mobile-only (documented-broken); no amount touched |
| PAY-3 | reconcile cron self-heals via two non-atomic writes | Medium (P11(2)) | backend | **LANDED** — single `atomic_subscription_activation_locked` RPC; can no longer create the split-brain it repairs |
| PAY-4 | `payments-health` webhook-silence monitor not scheduled | High (P11 detection) | architect | **LANDED** — registered 13th Vercel cron `*/10 * * * *`; slot budget 13/40 Pro+ |
| PAY-5 | event-dedupe skipped silently when ids absent / RPC errors | Low (P11 idempotency) | backend | **LANDED** — structured ops warning + proceed via idempotent RPC; observability gap closed |
| PAY-6 | verify route HMAC-reject (401) path untested | Medium (P11(1)) | testing | **LANDED** — `verify-hmac-reject.test.ts` pins 401/no-grant + regression coverage |
| PAY-7 | missing webhook secret → 400 (no retry) instead of 503 | Low-Med (P11 retry) | backend | **LANDED** — env-misconfig → 503 retryable; missing header stays 400; invalid signature unchanged |
| PAY-8 | `subscribe` mints Razorpay obj for principal with no student row | Low (P11(3)-adjacent) | backend | **LANDED** — 409 short-circuit before any Razorpay object |
| PAY-9 | `razorpay_signature` persisted at rest (verify path) | Low (info, P13-adjacent) | — | **DEFERRED (optional)** — not a P11/P13 breach (DB column, not a log) |

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe):** PAY-1, PAY-3, PAY-4, PAY-5, PAY-6, PAY-7, PAY-8.
- **Gated (USER APPROVAL required):** PAY-2 — any pricing-amount change to `create-order`.
- **Deferred (optional):** PAY-9.

## Files touched (code/config/test — by builders, outside this doc-only finalization)
- `src/app/api/payments/subscribe/route.ts` (PAY-1, PAY-8)
- `src/app/api/cron/reconcile-payments/route.ts` (PAY-3)
- `src/app/api/payments/webhook/route.ts` (PAY-5, PAY-7)
- `vercel.json` (PAY-4)
- `verify-hmac-reject.test.ts` + extended `payments-subscribe-rbac.test.ts` (PAY-6)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **236/236 PASS** (payment suite)
- build **PASS**; **`vercel.json` VALID** (12 → 13 crons, ≤ 40 Pro limit)
- architect security review **APPROVE**; quality verdict **APPROVE**; regression sweep **GREEN**

## P14 review chain (payment flow) — COMPLETE
backend (made) → architect (security APPROVE) + testing (coverage GREEN) + mobile (downstream review) +
frontend (checkout 403/409 SAFE-AS-IS).

## Regression catalog
- **REG-178** (`verify_route_hmac_reject`, P11) — verify route returns 401 on a tampered signature with no grant.
- **REG-179** (`subscribe_rbac_gate_pre_razorpay`, P9/P11) — `subscribe` denies a non-permission principal before any Razorpay object.
- Both being filed by a separate testing task; **confirm ids with the orchestrator if they shift**. Catalog 144 → **146** once filed. Existing payment-funnel entries **REG-46 / REG-47 remain green**. (Authoritative: `.claude/regression-catalog.md`.)

## Open follow-ups carried to STATE.md
PAY-2 (user approval), mobile repoint `create-order`→`subscribe` (mobile + backend), `docs/product/mobile-web-sync.md` doc fix (stale), super-admin stuck-dashboard display read from `student_subscriptions` (cosmetic), REG-178/179 filing (testing), PAY-9 optional.

## Next workflow
**Student Learning Core (Quiz / Scoring / XP)** — `PRIORITY-BACKLOG.md` rank 3 (invariants P1, P2, P3, P4, P5, P6, P12).
