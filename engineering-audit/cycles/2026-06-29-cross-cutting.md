# Cycle Log — 2026-06-29 — Cross-Cutting Invariants (P7, P8, P10, mobile sync) — FINAL CYCLE

> Dated summary of Cycle 8, the eighth and FINAL workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/cross-cutting/` (01-map … 08-regression + STATUS.md).
> This cycle CLOSES the 8-cycle program — see `PROGRAM-SUMMARY.md`.

## Workflow
- **Cycle:** 8 (final)
- **Workflow:** cross-cutting — app-wide invariants swept horizontally after the seven vertical workflows
- **Primary invariants:** P7 (bilingual UI), P8 (RLS boundary breadth), P10 (bundle budget), mobile-web contract sync; P11/P13 cross-check
- **Status:** **CYCLE 8 LANDED — mobile-web drift contracts + bundle-cap pin + P7 server-notification Hindi; XC-3/XC-4b/XC-7 tracked as larger initiatives. 8-CYCLE PROGRAM COMPLETE.**

## Headline finding
Three of the four cross-cutting themes are the SAME failure in different clothing: an invariant was expressed as a **rule or a comment but never given a mechanical enforcer**, so compliance depends on per-edit human discipline that degrades as surface area grows — P7 bilingual edges (RC-1), the route-layer admin-client default (RC-2, 87% of routes), and cross-repo constant mirroring (RC-4). RC-3 (P10 bundle cap) is the inverse: a mechanical enforcer EXISTS but is a single freely-editable number, so it gets ratcheted UP (5× to 284) instead of the bundle being reduced. This cycle converted the discipline-fails edges into tests/contracts (the auto-fix-safe set) and recorded the structural defaults (XC-3 RLS, XC-7 i18n, XC-4b bundle split) as LARGER-PROGRAM initiatives.

## Agents involved
- **quality** — workflow lead for MAP → GAP → ROOT-CAUSE (01–03); authored the app-wide invariant map, the XC-1…XC-7 gap analysis, and the four-theme root-cause synthesis (RC-1..RC-4).
- **backend** — Track A: XC-1/XC-2 — added `data.title_hi`/`data.body_hi` to the daily-cron score-milestone producers and relocated the parent-digest's dead top-level `body_hi` into `data.body_hi` (+ added `data.title_hi`).
- **testing** — Track B: XC-6/XC-5/XC-4a — web↔mobile price + 41-constant score-config parity tests + bundle-cap pin; 3 files / 11 tests; filed REG-191/192/193.
- **quality / orchestrator** — independent self-validation; re-ran gates; confirmed the `data.*_hi` shape match, the dead-`body_hi` relocation, and the parity-only nature of the drift tests; verdict **APPROVE**.
- **architect** — noted for the LARGER-PROGRAM follow-ups (XC-3 RLS defense-in-depth, XC-4b @supabase/* first-paint split).
- **ops (this doc)** — documentation finalization (04/05 reconciliation incl. the 05 tests section; 06/07/08 + STATUS; STATE/backlog/coverage updates; this cycle log; PROGRAM-SUMMARY).

## Gaps found (XC-1 … XC-7) and dispositions
| ID | Tag | Title | Sev | Disposition |
|---|---|---|---|---|
| XC-1 | P7 | Student/parent server notifications English-only | Medium | **LANDED** (backend) — `data.*_hi` on 3 score-milestone producers → part of P7 fix |
| XC-2 | P7 | Notification title field English-only; parent-digest `body_hi` on a dead top-level column | Low-Med | **LANDED** (backend) — relocate to `data.body_hi` + add `data.title_hi` |
| XC-3 | P8 | 87% of API routes use the admin client; no RLS backstop at the route layer | High | **LARGER-PROGRAM** — dedicated RLS defense-in-depth initiative (subsumes TSB-2 + PP-5) |
| XC-4 | P10 | Shared JS + middleware within ~1.5-3.2% of cap; cap raised 5× | Medium | **SPLIT** — XC-4a cap pin **LANDED** (testing → REG-193); XC-4b @supabase/* split = LARGER-PROGRAM |
| XC-5 | mobile | score_config.dart duplicates score-config.ts, no drift detection | Medium | **LANDED** (testing) — 41-constant parity test → REG-192 |
| XC-6 | mobile | subscription.dart prices duplicate plans.ts, no drift detection | Med-High | **LANDED** (testing) — web↔mobile price parity test → REG-191 |
| XC-7 | P7 | No central i18n mechanism; inline-ternary sprawl | Low | **LARGER-PROGRAM** — adopt keyed-resolver + missing-string lint |

## What landed vs tracked
- **Landed + APPROVED (auto-fix-safe; no invariant/pricing/RBAC/AI-model change):** XC-1/XC-2 (backend — P7 server-notification Hindi to the correct `data.*_hi` shape), XC-6 (testing — REG-191 price parity), XC-5 (testing — REG-192 score-config parity), XC-4a (testing — REG-193 bundle-cap pin).
- **LARGER-PROGRAM (tracked initiatives, not this cycle):** XC-3 (P8 RLS defense-in-depth, multi-sprint), XC-4b (@supabase/* AuthContext first-paint split, P15-touching), XC-7 (central i18n primitive).
- **P7 follow-ups (same class):** `school-operations.ts` + parent-portal PP-7 insights/tips/glance — English-only titles; bounded out of the daily-cron Track-A scope.

## Files touched (code/test — by builders, outside this doc-only finalization)
- `supabase/functions/daily-cron/index.ts` (XC-1/XC-2 — `data.title_hi`/`data.body_hi` on the 3 score-milestone producers ~569-607; relocate parent-digest top-level `body_hi` → `data.body_hi` + add `data.title_hi` ~167/172)
- `src/__tests__/mobile-web-sync/subscription-price-drift.test.ts` (XC-6, new — REG-191)
- `src/__tests__/mobile-web-sync/score-config-drift.test.ts` (XC-5, new — REG-192)
- `src/__tests__/bundle/bundle-cap-pin.test.ts` (XC-4a, new — REG-193)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **11/11 cross-cutting tests PASS**
- code review **clean** (pure-additive Hindi to the correct `data.*_hi` shape; test-only parity/cap pins)
- build **DEFERRED to CI backstop** — a transient platform outage during validation blocked a clean local build; the change is a Deno Edge Function (no client bundle) + three test-only files (no bundle footprint), so CI's post-merge build + `check:bundle-size` is the authoritative backstop.

## P14 review chain — COMPLETE
backend (XC-1/XC-2 P7) + testing (XC-5/XC-6 drift contracts + XC-4a cap pin) → quality/orchestrator (independent **APPROVE**); architect noted for the XC-3/XC-4b LARGER-PROGRAM initiatives.

## Regression catalog
- **REG-191** (P11-adjacent / mobile) — subscription price web↔mobile parity (Dart `subscription.dart` == web `plans.ts`); parity-only, no value pinned.
- **REG-192** (mobile / P1-adjacent) — score-config web↔Flutter parity, all 41 constants.
- **REG-193** (P10) — bundle-cap pin (CAP_SHARED_KB=284 / CAP_PAGE_KB=260 / CAP_MIDDLEWARE_KB=120); anti cap-creep.
- Catalog 157 → **160**. Existing REG-49/65/134 remain green. (Authoritative: `.claude/regression-catalog.md`.)

## Program-level RISK / decision register (CEO visibility)
This final cycle adds no new USER-gated item but raises three LARGER-PROGRAM (Tier-3) initiatives:
- **XC-3** — systemic RLS defense-in-depth (87% admin-client routes); subsumes Cycle-5 TSB-2 and Cycle-7 PP-5.
- **XC-4b** — @supabase/* first-paint bundle split (P15-touching), the durable lever to ratchet the P10 cap back toward 160 kB.
- **XC-7** — central i18n primitive + missing-string lint.
The consolidated decision register (Tier-1 user-gated / Tier-2 reversible-approved / Tier-3 initiatives) is in `PROGRAM-SUMMARY.md` and the `PRIORITY-BACKLOG.md` post-program remediation backlog.

## Program close-out
This is the **8th and final** workflow cycle. All 8 ranked workflows (auth-onboarding, payments-subscriptions, student-learning-core, foxy-ai-rag, teacher-school-b2b, super-admin-observability, parent-portal, cross-cutting) have been **audited → hardened → merged**. Regression catalog grew from ~146 to **160** across the program (REG-177..193 = 17 new). See `PROGRAM-SUMMARY.md` for the CEO-facing close-out and the consolidated decision register.
