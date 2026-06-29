# STATUS: TSB-4 — class-membership soft-delete sync

**TSB-4 LANDED — soft-delete sync closes the live P8 teacher-boundary divergence; DROP / repoint / backfill = separate CEO-gated cutover. REG-200.**

- **Item:** TSB-4 (post-program remediation backlog, Tier-1; surfaced Cycle 5 — teacher-school-b2b)
- **Invariant:** P8 (RLS / teacher↔student data boundary)
- **Decision:** auto-fix-safe slice — bidirectional, recursion-guarded soft-delete sync between
  `class_students` and `class_enrollments` (no DROP, no RLS change, no boundary repoint)
- **Owner squad:** architect (migration) + backend (boundary read review) + testing (REG-200) + quality
- **CEO gate:** the **DROP / repoint / backfill cutover** is still **PENDING** (irreversible DROP)
- **Started / landed:** 2026-06-29
- **Status:** **LANDED — APPROVE (no conditions).**

## Ledger
| Step | Artifact | Done |
|---|---|---|
| IMPLEMENTATION (trigger pair, two-layer recursion guard, DELETE-omission rationale, canonical-by-intent ADR header) | `01-implementation.md` | [x] |
| VALIDATION (architect/backend/testing/quality verdicts + gates + REG-200 + gated-cutover plan + 2 backend follow-ups + erasure accounting) | `02-validation.md` | [x] |

## What landed
- `supabase/migrations/20260702030000_class_membership_softdelete_sync.sql`: two `AFTER UPDATE OF
  is_active` triggers (one per table). A soft de-enroll / re-enroll on either table propagates `is_active`
  to the matching `(class_id, student_id)` row on the other.
- **Recursion guard (terminates after one round-trip):** trigger `WHEN (OLD.is_active IS DISTINCT FROM
  NEW.is_active)` + propagating UPDATE `WHERE is_active IS DISTINCT FROM NEW.is_active` (the bounce hits a
  zero-row no-op).
- Idempotent (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`), `SECURITY DEFINER` + pinned `search_path`.
- DELETE mirror **omitted** (documented — soft-delete-only; hard-delete cascade belongs to the cutover +
  erasure track). ADR header declares **`class_enrollments` canonical-by-intent**.

## Why this matters
The teacher boundary (`canAccessStudent` `rbac.ts:331` + `is_teacher_of`) reads `class_students`. Before
this fix, a soft de-enroll on `class_enrollments` did **not** reach `class_students`, so a de-enrolled
student stayed `is_active=true` there and **remained visible to the teacher**. The sync closes that P8
divergence going forward. Teacher reads only **tighten**, never over-grant.

## Gates
- type-check **PASS** | lint **0 errors** | build **N/A** (migration + test-only)
- Tests: **REG-200** — `tsb4-class-membership-softdelete-sync.test.ts` (**21** `it()` blocks) + canary 23 =
  **44 green**.
- Catalog **166 → 167** (REG-200). REG-184 / REG-185 still green.
- **P14 chain COMPLETE:** architect (APPROVE) + backend (APPROVE — reads only tighten) + testing (REG-200)
  + quality (APPROVE, no conditions).

## GATED / DEFERRED — remaining TSB-4 CEO-gated cutover (NOT done)
1. Repoint `canAccessStudent` (`rbac.ts:331`) + `is_teacher_of` to read the canonical `class_enrollments`.
2. Add a teacher SELECT RLS policy on `class_enrollments` (it has **none** today).
3. VERIFIED one-time BACKFILL of already-divergent historical rows (this going-forward sync does **not**
   heal pre-existing divergence).
4. DROP the redundant table.

Carries **P8 + P9** chains; needs **CEO approval** (DROP is irreversible). **CEO action:** approve /
sequence the cutover.

## Backend-flagged PRE-EXISTING follow-ups (non-blocking)
1. `/api/teacher/remediation/route.ts:118` + `/api/teacher/parent-notify/route.ts:105` query
   `class_students` **without** `.eq('is_active', true)` — a de-enrolled student could still get
   remediation / parent-notify (P8-adjacent scoping gap).
2. `schools/enroll` re-enroll upsert omits `is_active`, so re-enroll wouldn't flip it back to active.

## Erasure accounting (separate track)
The data-erasure purger hard-deletes `class_students` only; leftover `class_enrollments` rows (UUID pair,
no PII) belong to the erasure-completeness track.

## Tier-1 backlog
**COMPLETE.** TSB-4 was the last Tier-1 item. PAY-2, SLC-1, FOX-4, SAO-1/5, PP-1/3, TSB-4 are all DONE
(auto-fix-safe slices shipped; genuine product decisions either CEO-resolved or deferred).

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (migration) | architect | 2026-06-29 | **APPROVE** |
| Boundary read review | backend | 2026-06-29 | **APPROVE** (reads only tighten) |
| Testing | testing | 2026-06-29 | **GREEN** — REG-200 filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** (no conditions) |
