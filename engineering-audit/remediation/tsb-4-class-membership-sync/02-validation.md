# TSB-4 — Validation & Closure (class-membership soft-delete sync)

**Item:** TSB-4 (post-program remediation backlog, Tier-1; surfaced Cycle 5 — teacher-school-b2b)
**Invariant:** P8 (RLS / teacher↔student data boundary)
**Author:** ops finalization (synthesizing the P14 review-chain verdicts)
**Date:** 2026-06-29
**Companion:** `01-implementation.md` (the trigger pair, the two-layer recursion guard, the DELETE-omission
rationale, the canonical-by-intent ADR header).

---

## 1. What landed (the auto-fix-safe slice)

Migration `supabase/migrations/20260702030000_class_membership_softdelete_sync.sql` adds bidirectional,
recursion-guarded `AFTER UPDATE OF is_active` triggers between `class_students` and `class_enrollments`.
A soft de-enroll (or re-enroll) on either table now propagates to the other, keyed by
`(class_id, student_id)`.

This **closes the live P8 divergence**: previously a soft-de-enrolled student stayed `is_active=true` on
`class_students` (the table the `canAccessStudent` / `is_teacher_of` teacher boundary reads) → remained
visible to the teacher after the school intended removal. Now the de-enroll reaches `class_students`
immediately.

The change is **additive and reversible** — triggers only; no DROP, no RLS change, no boundary repoint.

---

## 2. P14 review chain — COMPLETE (all APPROVE)

| Role | Agent | Verdict | Notes |
|---|---|---|---|
| Security / RLS / migration | architect | **APPROVE** | Bidirectional triggers; two-layer recursion guard (`WHEN OLD IS DISTINCT FROM NEW` + row `WHERE is_active IS DISTINCT FROM NEW.is_active`) provably terminates after one round-trip; idempotent; `SECURITY DEFINER` + pinned `search_path`; **no RLS change, no DROP**. |
| Boundary read review | backend | **APPROVE** | Teacher reads only **tighten**, never over-grant — sync can only make a de-enrolled student *disappear* from the teacher boundary, never add a student a teacher shouldn't see. Flagged 2 PRE-EXISTING follow-ups (§5). |
| Testing | testing | **GREEN** | **REG-200** — `src/__tests__/tsb4-class-membership-softdelete-sync.test.ts` (**21** `it()` blocks) + canary 23 = **44 green**. |
| Quality (independent) | quality | **APPROVE** | No conditions. |

---

## 3. Gates

- type-check **PASS** | lint **0 errors** | build **N/A** (migration + test-only; no client bundle / no TS
  runtime surface — CI post-merge build is the backstop)
- Tests: **REG-200** — `tsb4-class-membership-softdelete-sync.test.ts` (**21** `it()` blocks) + canary 23 =
  **44 green**.
- Catalog **166 → 167** (REG-200 filed). REG-184 / REG-185 (Cycle 5 teacher-boundary entries) remain green.
  Authoritative source: `.claude/regression-catalog.md`.

> **Wording reconciliation:** the slice produces **21** `it()` blocks in the TSB-4 file (the canary suite
> contributes the other 23 → 44 total green). If any downstream note cites "23 tests" for the TSB-4 file
> specifically, that is the canary count, not the TSB-4 file — the TSB-4 file is **21**. Use 21 + 23 = 44
> when citing the combined run.

### REG-200 — what it pins
- A soft de-enroll on `class_enrollments` propagates `is_active=false` to `class_students` (and the
  reverse direction).
- The recursion guard terminates after exactly one round-trip (no infinite-loop / no double-write).
- The triggers are idempotent and `SECURITY DEFINER` with a pinned `search_path`.
- The DELETE mirror is intentionally absent (soft-delete-only sync).

---

## 4. GATED / DEFERRED — the remaining TSB-4 CEO-gated cutover (NOT done)

This slice closes the **going-forward** divergence. The full TSB-4 resolution is a separate **CEO-gated
cutover** because it contains an irreversible DROP and a stored-data backfill:

1. **Repoint the boundary read** — change `canAccessStudent` (`rbac.ts:331`) + the `is_teacher_of` SQL
   helper to read the canonical `class_enrollments` instead of `class_students`.
2. **Add a teacher SELECT RLS policy on `class_enrollments`** — it has **none** today. Required before the
   boundary can safely read it.
3. **VERIFIED one-time BACKFILL of already-divergent historical rows** — this going-forward sync does
   **NOT** heal rows that diverged **before** it shipped. The backfill reconciles those pre-existing
   mismatches; it changes stored membership state, so it must be quantified read-only first, then applied
   under verification.
4. **DROP the redundant table** — once the boundary reads the canonical table and history is reconciled,
   drop the legacy mirror.

This cutover carries **P8 + P9** review chains and needs **CEO approval** (the DROP is irreversible).
**CEO action:** approve / sequence the cutover. Recorded on the `STATE.md` RISK register +
`PRIORITY-BACKLOG.md` Tier-1 (deferred CEO-gated item).

---

## 5. Backend-flagged PRE-EXISTING follow-ups (non-blocking)

Found during the boundary-read review; **not** introduced by this slice. Fold into the cutover or a small
ticket:

1. **De-enroll scoping gap (P8-adjacent).** `/api/teacher/remediation/route.ts:118` and
   `/api/teacher/parent-notify/route.ts:105` query `class_students` **WITHOUT** `.eq('is_active', true)` —
   a de-enrolled student could still receive remediation / parent-notify. Small P8-adjacent scoping gap;
   add the `is_active` filter.
2. **Re-enroll upsert omits `is_active`.** `schools/enroll`'s re-enroll upsert does not set `is_active`, so
   a re-enroll would not flip a previously-de-enrolled row back to active. (The new sync triggers fire on
   `is_active` flips, so once `enroll` is fixed to flip it, the sync will propagate it.)

---

## 6. Erasure-completeness accounting (separate track)

The data-erasure purger hard-deletes `class_students` **only**; leftover `class_enrollments` rows
(`class_id` + `student_id`, **no PII**) belong to the **erasure-completeness track**, not TSB-4. Recorded
here so the cutover/erasure designs account for both membership tables. No PII residue (the leftover rows
are UUID pairs), so this is a completeness/hygiene item, not a P13 exposure.

---

## 7. Closure decision

| Field | Value |
|---|---|
| Disposition | **LANDED** — soft-delete sync closes the live P8 teacher-boundary divergence |
| Scope | Auto-fix-safe slice only — **NO DROP / NO RLS change / NO boundary repoint / NO backfill** |
| CEO gate | **DROP / repoint / backfill = separate CEO-gated cutover** (§4) — still pending |
| Invariant | P8 — teacher boundary now consistent on soft de-enroll |
| Migration | `supabase/migrations/20260702030000_class_membership_softdelete_sync.sql` (additive, idempotent) |
| Regression pin | **REG-200** (catalog → 167) — `tsb4-class-membership-softdelete-sync.test.ts` (21) + canary 23 = 44 green |
| Gates | type-check PASS, lint 0, build N/A (migration + test-only) |
| P14 chain | architect (APPROVE) + backend (APPROVE — reads only tighten) + testing (REG-200) + quality (APPROVE) |
| Follow-ups | gated cutover (§4) + 2 backend pre-existing items (§5) + erasure accounting (§6) |
| Tier-1 backlog | **COMPLETE** — TSB-4 was the last Tier-1 item |
| Status | **TSB-4 auto-fix-safe slice LANDED** |
