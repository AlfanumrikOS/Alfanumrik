# Cycle Log — 2026-06-29 — Super-Admin & Observability (P9, P13)

> Dated summary of Cycle 6, the sixth workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/super-admin-observability/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 6
- **Workflow:** super-admin-observability (super-admin panel + admin auth gates + audit logging + analytics + observability/CSV exports + logger/Sentry/analytics redaction + feature-flag evaluation)
- **Primary invariants:** P9 (RBAC enforcement), P13 (data privacy); P10 cross-check
- **Status:** **CYCLE 6 LANDED — P13 export/analytics minimization + P9 full-surface gate sweep; SAO-1/SAO-5 PII-export tiering USER-GATED**

## Headline finding
The pure mechanism layers are sound — gate ordering, constant-time secret compare, logger/analytics/Sentry redaction, and flag default-OFF are all well-built and well-pinned. The dominant gap is a **single policy gap**: the admin-level ladder differentiates by **ACTION destructiveness, not READ data-sensitivity**. Phase G.1 correctly hardened destructive mutations to `super_admin` while leaving ALL reads/exports at the `support` floor — so the most PII-heavy export on the platform (`/api/super-admin/reports`: raw student name+email, parent name+email+PHONE, teacher email) sits at the LOWEST admin tier. That tiering correction (SAO-1) is a DPDP-relevant admin access-model change and is **USER-GATED**. The complementary, ops-owned, non-gated half — egress redaction + response/field minimization + full-surface gate-coverage tests — landed this cycle.

## Agents involved
- **ops** — workflow lead for MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT (01–05); authored the admin-lifecycle + observability-pipeline map, the gap analysis, and the two AUTO-FIX-SAFE P13 fixes (SAO-3 egress redaction, SAO-2 email drop); defined what counts as PII for the export/analytics surfaces.
- **frontend** — confirmed the trimmed `top_students` shape has no leaderboard render regression; removed the two stale `email: string` type decls (`learning/page.tsx`, `control-room-types.ts`).
- **testing** — SAO-7 full-surface gate sweep (`admin-route-auth-gate-sweep.test.ts`) + SAO-4 bare-name log canary (`bare-name-log-canary.test.ts`); regression sweep (6/6 new + 351/351 broad GREEN); filed REG-186/187.
- **quality** — independent validation (did not implement); re-ran all gates; re-derived email-unused; confirmed the full 134-route sweep; verdict **APPROVE**.
- **ops (this doc)** — documentation finalization (04/05 reconciliation; 06/07/08 + STATUS; STATE/backlog/coverage updates; this cycle log).

## Gaps found (SAO-1 … SAO-7) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| SAO-1 | `/api/super-admin/reports` bulk-exports raw student/parent/teacher PII at the LOWEST `support` tier | **HIGH** (P13, DPDP) | user | **GATED (USER)** — raising the tier / splitting a PII-export permission changes the admin access model; requires CEO approval. On the program RISK register. |
| SAO-2 | `/api/super-admin/analytics` `top_students` carried `email` at `support` | MED (P13) | ops + frontend | **LANDED** — `email` dropped at query+type+map; frontend stale decls removed. Email confirmed unused by any UI → minimization, not tiering. |
| SAO-3 | observability CSV export serialized `context_json` without an export-time redaction pass | MED (P13) | ops | **LANDED** — `context_json` cell wrapped in canonical `redactPII` before egress; CSV header/columns/order unchanged. |
| SAO-4 | logger redactor intentionally omits bare `name`/`ip` (caller-discipline risk) | LOW-MED (P13) | testing | **LANDED (test-only)** — `bare-name-log-canary.test.ts`; no bare `name`/`email`/`phone` logger key; redactor global set unchanged. → REG-187 |
| SAO-5 | audit-log CSV export carries `admin_name`/`admin_email` in `details` at `support` | LOW (P13) | user | **GATED (USER, folds into SAO-1)** — same tiering decision; no separate action. |
| SAO-6 | impersonation/audit rows persist `ip_address` | INFO | architect | **COMPLIANT-BY-DESIGN** — admin-only RLS-restricted forensic tables; documented intentional exception. |
| SAO-7 | only ~10 of 119 super-admin routes read line-by-line for gate-before-I/O ordering | MED (P9, process) | testing | **LANDED (test-only)** — `admin-route-auth-gate-sweep.test.ts`; 134 routes, 207/207 gate-before-I/O; `super-admin/login` sole allowlist. → REG-186 |

Plus compliant positives (P9 gate-before-I/O on every sampled route; constant-time secret compare via `secureEqual`, header-only; least-privilege on destructive mutations → `super_admin` + audit; logger/analytics/Sentry `redactPII` on all egress; analytics identify uses hashed UUID; feature flags default-OFF + fail-safe on malformed body).

## The 134-route sweep (SAO-7) — breadth made mechanical
The MAP phase proved a `Grep` token match on all 119 super-admin route files but only read ~10 line-by-line. SAO-7 converts that spot-check into a 100%-surface invariant: every admin route on disk (super-admin **119** + `v1/admin` **2** + `internal/admin` **13** = **134**) carries a canonical gate token, and **207/207** DB-touching handlers gate BEFORE the first DB I/O, with `super-admin/login` as the sole allowlisted self-auth exception. Any future mis-ordered/ungated handler now fails PR-CI.

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe P13/P9 hardening; no RBAC/tier change):** SAO-3 (ops — observability export redaction), SAO-2 (ops + frontend — analytics email drop + type cleanup), SAO-7 (testing — full-surface gate sweep), SAO-4 (testing — bare-name log canary).
- **Gated (USER APPROVAL required):** SAO-1 (PII-export tiering — DPDP-relevant admin access-model decision), SAO-5 (folds into SAO-1). Surfaced to CEO via the program RISK register.
- **Follow-ups (MINOR):** export `message` column not free-form-redacted (apply `redactPIIInText` only if a future template interpolates user PII — write-time fix); periodic manual re-read of the highest-PII-sensitivity routes (process).
- **Compliant-by-design:** SAO-6 (`ip_address` in admin-only RLS forensic tables).

## Files touched (code/test — by builders, outside this doc-only finalization)
- `src/app/api/super-admin/observability/export/route.ts` (SAO-3 — `redactPII` on the `context_json` cell + import)
- `src/app/api/super-admin/analytics/route.ts` (SAO-2 — `email` dropped from `top_students` select + row type + map)
- `src/app/super-admin/learning/page.tsx` + `src/app/super-admin/_components/widgets/control-room-types.ts` (SAO-2 frontend — stale `email: string` decls removed)
- test files: `admin-route-auth-gate-sweep.test.ts` (SAO-7) + `bare-name-log-canary.test.ts` (SAO-4)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **6/6 new (4 SAO-7 + 2 SAO-4) + 351/351 broad super-admin/analytics/observability PASS**
- build **PASS**; bundle within **P10** caps (server routes + test-only files; no shared-chunk or page-budget impact)
- quality verdict **APPROVE**; regression sweep **GREEN**

## P14 review chain (super-admin reporting / monitoring) — COMPLETE
ops (impl SAO-3/SAO-2 + PII definitions) + frontend (trimmed-shape render + stale-type cleanup) → testing (SAO-7 sweep + SAO-4 canary, coverage GREEN) + quality (independent **APPROVE**).

## Regression catalog
- **REG-186** (P9) — admin-route auth-gate full-surface sweep: all 134 admin routes carry a canonical gate token; 207/207 DB-touching handlers gate before first DB I/O; `super-admin/login` sole allowlist.
- **REG-187** (P13) — bare-name log canary: no bare `name`/`email`/`phone` logger key; conservative compound-key exclusion (redactor global set unchanged).
- Catalog 152 → **154**. Existing entries **REG-49 / REG-115 / REG-116 / REG-119 remain green**.
  (Authoritative: `.claude/regression-catalog.md`.)

## Program-level RISK (CEO visibility)
- **SAO-1 — USER-gated PII-export tiering (DPDP-relevant).** `/api/super-admin/reports` lets ANY account at the floor `support` tier bulk-download the entire student roster with emails + every parent phone number — a DPDP-Act minors'-data exposure and a mass-exfiltration vector if one low-tier credential is phished. The export IS gated + audited; the defect is the POLICY mapping export-type → required level, which was never differentiated by PII content. Raising the tier (or splitting a PII-export permission) changes the admin access model → requires CEO approval. **CEO action:** approve the tiering correction (or a PII-export permission split). SAO-5 (audit-log admin-PII export) folds into the same decision.

## Next workflow
**Parent Portal (dual auth + DPDP)** — `PRIORITY-BACKLOG.md` rank 7 (invariants P8, P13, P15): parent↔child link boundary, consent, data export/erasure (DPDP). Owner squad: backend (lead) + frontend + architect.
