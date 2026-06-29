# TSB-4 — Implementation (class-membership soft-delete sync)

**Item:** TSB-4 (post-program remediation backlog, Tier-1; surfaced Cycle 5 — teacher-school-b2b)
**Invariant:** P8 (RLS / teacher↔student data boundary) — closing a live divergence between the two membership tables
**Author:** architect (migration) + backend (boundary read review)
**Date:** 2026-06-29
**Type:** Additive migration (triggers only) — **NO DROP, NO RLS change, NO repoint of the boundary read**
**File:** `supabase/migrations/20260702030000_class_membership_softdelete_sync.sql`

---

## 0. Scope — this is the AUTO-FIX-SAFE SLICE of TSB-4, not the full cutover

TSB-4 (Cycle 5 finding) is that teacher↔student membership is modeled in **two** tables —
`class_students` and `class_enrollments` — reconciled by partial sync. This is an incomplete migration:
two sources of truth that can disagree. The full resolution (pick the canonical table, repoint the
boundary read, backfill historical divergence, DROP the redundant table) carries a schema DROP and is
**CEO-gated**.

This slice ships **only** the part that is reversible and closes a **live P8 divergence today** without
any irreversible step. It does **not** repoint the boundary read, does **not** add the canonical-table
teacher RLS policy, does **not** backfill, and does **not** DROP. Those four steps are the gated cutover
(see `02-validation.md` §4).

---

## 1. The defect (before) — a soft de-enroll left the teacher boundary stale

The teacher data boundary (`canAccessStudent`, `rbac.ts:331`, and the `is_teacher_of` SQL helper) reads
**`class_students`**. But the school-admin enroll/de-enroll flow operated on **`class_enrollments`** — and
the existing partial sync did not propagate a **soft de-enrollment** (`is_active` flip to `false`) from
`class_enrollments` back to `class_students`.

Concrete failure: a school admin soft-de-enrolls a student (sets `class_enrollments.is_active = false`).
The mirror row in `class_students` **stays `is_active = true`**. Because the teacher boundary reads
`class_students`, the de-enrolled student **remains visible to the teacher** — names, mastery, XP — after
the school intended to remove them. That is a P8 boundary divergence: the access-control read disagrees
with the operator's intent.

The divergence is bidirectional in principle — a soft de-enroll on either table should reach the other —
but the boundary-relevant direction (`class_enrollments` → `class_students`) was the one with teeth.

---

## 2. The fix (after) — bidirectional, recursion-guarded soft-delete sync

The migration adds **two** `AFTER UPDATE OF is_active` triggers — one on each table — so a soft
de-enroll (or re-enroll) on either side propagates the `is_active` value to the matching row on the other
side, keyed by `(class_id, student_id)`.

```sql
-- one direction shown; the mirror trigger is symmetric
CREATE TRIGGER trg_class_students_sync_softdelete
  AFTER UPDATE OF is_active ON public.class_students
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)   -- only fire on an actual flip
  EXECUTE FUNCTION public.fn_sync_class_membership_softdelete_to_enrollments();
```

The trigger function updates the matching row on the other table **only when its value actually differs**:

```sql
UPDATE public.class_enrollments e
   SET is_active = NEW.is_active
 WHERE e.class_id   = NEW.class_id
   AND e.student_id = NEW.student_id
   AND e.is_active IS DISTINCT FROM NEW.is_active;   -- no-op if already in sync
```

Both functions are `SECURITY DEFINER` with a pinned `search_path = public, pg_temp`, and the whole
migration is idempotent (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` before each
`CREATE TRIGGER`).

---

## 3. The recursion guard (why this terminates after one round-trip)

Two `AFTER UPDATE` triggers that write to each other are a classic infinite-recursion risk: A updates B,
B's trigger fires and updates A, A's trigger fires and updates B… The guard is **two-layered** and
provably terminates after exactly one round-trip:

1. **Trigger-level `WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)`** — the trigger only fires when
   `is_active` actually changes value on that row.
2. **Row-level `WHERE … is_active IS DISTINCT FROM NEW.is_active`** — the propagating UPDATE only touches
   the mirror row if its value differs from the new value.

Walk-through: a de-enroll flips `class_enrollments.is_active` `true→false`. Its trigger fires, runs the
`UPDATE class_students … WHERE is_active IS DISTINCT FROM false` → flips `class_students` `true→false`
(one row changed). That flip fires the `class_students` trigger, which runs
`UPDATE class_enrollments … WHERE is_active IS DISTINCT FROM false` — but `class_enrollments` is **already
`false`**, so the `WHERE` matches **zero rows**, the UPDATE is a no-op, and **no further trigger fires**.
Termination is guaranteed after exactly one bounce.

---

## 4. DELETE mirror deliberately OMITTED (documented rationale)

The migration syncs **soft** deletes (`is_active` flips) only. It does **not** add a hard-`DELETE` mirror
(a `DELETE` on one table cascading a `DELETE` on the other). Reasons, recorded in the migration header:

- The teacher boundary divergence is driven by **soft** de-enrollment (`is_active=false`), which is the
  app's normal de-enroll path. That is the live P8 gap this slice closes.
- A hard-`DELETE` mirror is a **destructive cascade** — exactly the class of irreversible behavior that
  belongs in the CEO-gated cutover, not in an auto-fix-safe slice.
- Hard deletion of membership rows is also entangled with **data-erasure completeness** (the purger
  hard-deletes `class_students` only — see `02-validation.md` §6), which is a separate track. Adding a
  DELETE cascade here would pre-empt that design.

So the omission is intentional and bounded: soft-delete divergence is closed; hard-delete behavior is
left untouched for the gated cutover + erasure track.

---

## 5. ADR header — `class_enrollments` declared canonical-by-intent

The migration header carries a short ADR note: **`class_enrollments` is the canonical-by-intent
membership table** (it is the table the school-admin enroll flow writes; it carries the richer
enrollment metadata). `class_students` is the legacy mirror that the teacher boundary historically reads.

This is a **declaration of intent for the future cutover**, not a behavior change in this slice — the
boundary read still points at `class_students` today. Recording it in the migration header means the
cutover (repoint → backfill → DROP) has a documented canonical choice to execute against.

---

## 6. What did NOT change (scope guardrail)

- **No DROP.** Neither table is dropped; the redundant-table removal is the CEO-gated cutover.
- **No RLS change.** No policy added, altered, or removed. (The canonical-table teacher SELECT policy on
  `class_enrollments` — which has none today — is part of the gated cutover, not this slice.)
- **No boundary repoint.** `canAccessStudent` / `is_teacher_of` still read `class_students`.
- **No backfill.** This going-forward sync does **not** heal rows that diverged **before** it shipped (see
  `02-validation.md` §4 — the VERIFIED one-time backfill is gated).
- **No new permission / role / table / column.**
