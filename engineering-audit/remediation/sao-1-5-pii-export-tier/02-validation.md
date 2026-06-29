# SAO-1 / SAO-5 — Validation & Closure

**Item:** SAO-1 / SAO-5 (post-program remediation backlog, Tier-1; surfaced Cycle 6 — super-admin-observability)
**Invariant:** P13 (data privacy) + P9 (RBAC enforcement) — hardening within existing RBAC; **no permission/role/migration**
**Author:** ops finalization (synthesizing the P14 review-chain verdicts)
**Date:** 2026-06-29
**Companion:** `01-implementation.md` (before/after gate, per-type tier map, fail-closed ordering, byte-identical data path).

---

## 1. CEO decision (RESOLVED)

The CEO **APPROVED** gating the four PII report types (`students`, `teachers`, `parents`, `audit`) at
`super_admin` — the **safest existing tier**. This **resolves** the Tier-1 "which tier" policy question
that SAO-1/SAO-5 raised in Cycle 6. It is **no longer a pending gate**: `super_admin` is the **decided
end-state**.

- No new permission code, role, or migration — only the existing `super_admin` / `support` tiers reused.
- The two UUID-only types (`quizzes`, `chats`) stay at the `support` floor.
- **REG-198 pins the end-state**, so any future loosening to `finance`/`admin` would turn REG-198 red and
  force an explicit reviewed decision (the intended guardrail).

---

## 2. P14 review chain — COMPLETE

| Role | Agent | Verdict | Notes |
|---|---|---|---|
| Builder (impl) | backend | **DONE** | `REPORT_CONFIG` per-type tier map; validate-`type`-first (400 pre-gate, pre-DB); per-type gate before any query; byte-identical data path. |
| Security / P9+P13 | architect | **APPROVE** | Fail-closed; gate-before-data holds for every type; **no data-path regression**; the four PII types' `super_admin` tier **matches the destructive-mutation / RBAC / provisioning posture** (admin-auth Phase G.1). |
| Frontend | frontend | **NO CHANGE** | The reports page handles `403` gracefully; no UI change required. |
| Testing | testing | **GREEN** | REG-198 — `src/__tests__/api/super-admin/reports-pii-tier.test.ts` (14 tests) + REG-186 sweep = **18/18**; broad **121/121**. |
| Quality (independent) | quality | **APPROVE** | No conditions. |

---

## 3. Gates

- type-check **PASS** | lint **0 errors** | build **PASS**
- Tests: **REG-198** `reports-pii-tier.test.ts` (14) + REG-186 admin-gate sweep = **18/18**; broad super-admin **121/121**.
- Catalog **164 → 165** (REG-198 filed). REG-186 / REG-187 (Cycle 6) remain green. Authoritative source: `.claude/regression-catalog.md`.

### REG-198 — what it pins
- The four PII report types (`students`, `teachers`, `parents`, `audit`) require `super_admin`.
- The two UUID-only types (`quizzes`, `chats`) keep the `support` floor.
- `type` is validated FIRST — unknown type → `400` **before** any gate or DB access.
- Gate-before-data holds for every type; missing `type` defaults to `students` → `super_admin`.
- Loosening any PII type below `super_admin` turns REG-198 red (forces an explicit reviewed decision).

---

## 4. OPERATIONAL BREAK-RISK NOTICE (ops action item — record + act)

**On deploy, any non-super-admin staff** (`support` / `analyst` / `content_manager` / `finance` /
`admin`) who currently export `students` / `teachers` / `parents` / `audit` reports will receive **HTTP
403 immediately**. `quizzes` / `chats` exports are **unaffected**.

**Ops actions:**
1. **Notify affected staff** before/at deploy — the four PII exports now require `super_admin`.
2. **Confirm no legitimate non-super-admin export workflow** depends on these four types (review recent
   `report.exported` audit-log rows for non-super-admin actors on students/teachers/parents/audit).
3. If some staff **must** retain a PII export, loosening is a **one-line `REPORT_CONFIG` edit** (drop the
   type's `level` to `finance`/`admin`; **no migration**) — but that becomes a **fresh reviewed decision**
   (REG-198 guards it).

This notice is also recorded on the `STATE.md` RISK / ops-actions register.

---

## 5. Closure decision

| Field | Value |
|---|---|
| Disposition | **LANDED** — bulk PII export re-tiered `support` → `super_admin` (CEO-approved) |
| CEO gate | **RESOLVED** — `super_admin` is the decided end-state (no longer pending) |
| Invariant | P13 + P9 — hardening within existing RBAC; **no permission/role/migration** |
| App code changed | `src/app/api/super-admin/reports/route.ts` (one route) |
| Regression pin | **REG-198** (catalog → 165) — `reports-pii-tier.test.ts` (14) + REG-186 sweep = 18/18 |
| Gates | type-check PASS, lint 0, build PASS |
| P14 chain | backend (impl) + architect (APPROVE) + frontend (no change) + testing (REG-198) + quality (APPROVE, no conditions) |
| Ops follow-up | notify lower-tier exporters; confirm no legitimate non-super-admin PII-export workflow (audit-log review) |
| Status | **SAO-1/SAO-5 LANDED** |
