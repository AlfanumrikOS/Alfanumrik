# STATUS: SAO-1 / SAO-5 — bulk PII export tiering

**SAO-1/SAO-5 LANDED — bulk PII export re-tiered support→super_admin (CEO-approved); REG-198; ops to notify lower-tier exporters.**

- **Item:** SAO-1 / SAO-5 (post-program remediation backlog, Tier-1; surfaced Cycle 6 — super-admin-observability)
- **Invariant:** P13 (data privacy) + P9 (RBAC enforcement) — hardening within existing RBAC; **no permission code / role / migration**
- **Owner squad:** backend (impl) + architect (security/P9+P13) + frontend (no-change) + testing (REG-198) + quality
- **CEO gate:** **RESOLVED** — CEO APPROVED gating the 4 PII report types at `super_admin` (safest existing tier); decided end-state
- **Started / landed:** 2026-06-29
- **Status:** **LANDED — APPROVE (no conditions). Ops follow-up: notify lower-tier exporters.**

## Ledger
| Step | Artifact | Done |
|---|---|---|
| IMPLEMENTATION (backend — per-type tier map, validate-first, byte-identical data path) | `01-implementation.md` | [x] |
| VALIDATION (architect+frontend+testing+quality verdicts + gates + REG-198 + CEO approval + break-risk notice) | `02-validation.md` | [x] |

## What landed
- `src/app/api/super-admin/reports/route.ts` re-tiered via a `REPORT_CONFIG` per-type map:
  - **PII types → `super_admin`:** `students` (minors' name+email), `teachers` (name+email),
    `parents` (name+email+**phone**), `audit` (admin name+email in `details`, SAO-5).
  - **UUID-only types → `support` floor (unchanged):** `quizzes`, `chats`.
- `type` validated FIRST → unknown type `400` **before** any gate or DB access; gate-before-data holds for
  every type; missing-type default `students` → `super_admin` (safer than the old `support` default).
- **No new permission code / role / migration** — only existing tiers reused (P9/P13 hardening, NOT a P9
  permission addition). Data path byte-identical (same column whitelists, CSV/JSON shape, audit log).

## Gates
- type-check **PASS** | lint **0 errors** | build **PASS**
- Tests: **REG-198** `src/__tests__/api/super-admin/reports-pii-tier.test.ts` (14) + REG-186 sweep = **18/18**; broad **121/121**.
- Catalog **164 → 165** (REG-198). REG-186/187 still green.
- **P14 chain COMPLETE:** backend (impl) + architect (APPROVE) + frontend (no change) + testing (REG-198) + quality (APPROVE, no conditions).

## Deferred / residual (ops action items)
1. **Notify lower-tier exporters (ops).** On deploy, non-super-admin staff (support/analyst/content_manager/
   finance/admin) exporting students/teachers/parents/audit get **HTTP 403** immediately; quizzes/chats
   unaffected. Notify affected staff; confirm no legitimate non-super-admin PII-export workflow depends on
   these 4 types (review recent `report.exported` audit-log rows). On the `STATE.md` RISK/ops-actions register.
2. **Loosening path (if needed).** One-line `REPORT_CONFIG` edit (drop a PII type's `level` to `finance`/
   `admin`; **no migration**) — but that becomes a fresh reviewed decision (REG-198 guards it).

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (impl) | backend | 2026-06-29 | DONE |
| Security / P9+P13 | architect | 2026-06-29 | **APPROVE** |
| Frontend | frontend | 2026-06-29 | **NO CHANGE** (403 handled gracefully) |
| Testing | testing | 2026-06-29 | **GREEN** — REG-198 filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** (no conditions) |
