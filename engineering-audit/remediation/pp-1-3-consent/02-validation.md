# PP-1 / PP-3 — Validation & Closure

**Item:** PP-1-consent + PP-3 (post-program remediation backlog, Tier-1; surfaced Cycle 7 — parent-portal)
**Invariant:** P8 (RLS / parent↔child boundary) + P13 (data privacy / DPDP child-consent) + P15 (onboarding integrity)
**Decision:** CEO-approved **Option B** — link code creates a **`pending`** guardian↔child link; the **student/child** approves (`pending` → `approved`) before any data path opens.
**Author:** ops finalization (synthesizing the P14 review-chain verdicts)
**Date:** 2026-06-29
**Companion:** `01-design.md` (Option B design — backend response shape, student approval surface wiring, notification, RLS/idempotency, P15 funnel, migration analysis).

---

## 1. CEO decision (RESOLVED)

The CEO **APPROVED Option B**. This **resolves** the Tier-1 parent-link consent-model question that
PP-1-consent / PP-3 raised in Cycle 7. It is **no longer a pending gate**.

The consent posture changes from:

> `parent_login` link-code match → link is `active` / `is_verified:true` immediately → parent sees
> child data with **no child consent**.

to:

> `parent_login` link-code match → link is `pending` / `is_verified:false` → **no child data** until the
> **student** approves → link becomes `approved` → parent gets access.

This closes the Cycle-7 finding that **a link code ALONE granted an ACTIVE guardian link with no
consent**. Anyone who learned a child's link code could self-attach as a guardian; now the child must
affirmatively approve, giving a clean DPDP child-consent story.

---

## 2. What landed

| # | Change | Agent | File |
|---|---|---|---|
| A | `handleParentLogin` creates a `pending` (not `active`) link via `.upsert(onConflict:'guardian_id,student_id', ignoreDuplicates:true)`, `is_verified:false`; responds `{ status:'pending_approval', student_name, link_id }` (no session) for a new/pending link, `{ status:'approved', guardian, student }` for an already-linked re-submit (no downgrade); notifies the student PII-free via the `send_notification` RPC (type `parent_link_request`, bilingual `data.*_hi`, best-effort) | backend | `supabase/functions/parent-portal/index.ts` |
| B | New `getPendingParentLinks()` (calls `get_pending_link_requests` RPC, fail-soft) | frontend | `src/lib/supabase.ts` |
| C | **Mounted the previously-ORPHANED `PendingLinkApproval` card** (the critical fix — without it, linking dead-ended). Self-hides when no pending requests. | frontend | `src/app/dashboard/StudentOSDashboard.tsx` |
| D | Bilingual "awaiting approval" screen on `pending_approval` (reads `res.student_name`); existing dashboard flow on `approved` | frontend | `src/app/parent/page.tsx` |

---

## 3. The 3-layer consent boundary (confirmed)

A `pending` link opens **no** data path — confirmed at three independent layers:

1. **Domain-helper layer.** `ACTIVE_GUARDIAN_LINK_STATUSES = ['approved','active']`
   (`src/lib/domains/types.ts`, `relationship.ts`). `'pending'` is excluded, so every relationship
   read (`listChildrenForGuardian`, `isGuardianLinkedToStudent`, `listGuardiansForStudent`) returns
   nothing for a pending link.
2. **Edge data-handler layer.** The parent-portal data handlers gate on
   `.in('status', ['active','approved'])` (`handleGetChildren`, `handleGetAllChildrenDashboard`,
   `handleGetChildDashboard`, `handleGetChildAttendance`, `handleGetMonthlyReport`). A pending link
   fails all of them → 403 / empty.
3. **DB RLS layer.** `is_guardian_of` counts only `status = 'approved'` (baseline), so RLS-scoped reads
   (e.g. `performance_scores`, `student_lab_streaks` queried directly from `parent/page.tsx`) also
   return nothing while pending.

**Net: a `pending` row grants zero access until the student approves.**

---

## 4. P14 review chain — COMPLETE

| Role | Agent | Verdict | Notes |
|---|---|---|---|
| Builder (Edge / response / notify) | backend | **DONE** | `pending` + `is_verified:false` upsert (both branches); pending/approved response shape; no-downgrade on re-submit; PII-free student notification via `send_notification` RPC (best-effort). |
| Builder (parent UX + student approval surface) | frontend | **DONE** | Wired the orphaned `PendingLinkApproval` into the live `StudentOSDashboard`; `getPendingParentLinks()` helper; bilingual parent "awaiting approval" screen. |
| Security / consent boundary | architect | **APPROVE** | **NO migration needed** — `notifications.type` is free TEXT; `pending` already a valid `chk_link_status` value (column default is already `pending`). Consent boundary confirmed at the **3 layers** above; service-role insert path unchanged; no RLS change. |
| Mobile | mobile | **APPROVE** | **No mobile impact** — mobile never calls `parent_login`; it reads `/v2/parent/*`, which already filters to `active`/`approved`. |
| Testing | testing | **GREEN** | REG-199 — `parent-login-consent.test.ts` (16) + `pending-link-approval.test.tsx` (4); 484 broad parent sweep green; REG-117 / REG-188 / REG-189 / REG-190 intact. |
| Quality (independent) | quality | **APPROVE** | No conditions. |

---

## 5. Gates

- type-check **PASS** | lint **0 errors** | build **PASS**
- Tests: **REG-199** — `parent-login-consent.test.ts` (16) + `pending-link-approval.test.tsx` (4);
  **484** broad parent sweep green; REG-117 / REG-188 / REG-189 / REG-190 still green.
- Catalog **165 → 166** (REG-199 filed). Authoritative source: `.claude/regression-catalog.md`.

### REG-199 — what it pins
- A fresh `parent_login` creates `status='pending'`, `is_verified=false`, `initiated_by='parent_login'`
  (never `active` / `is_verified:true`).
- While `pending`, every parent data handler returns 403 / empty and `is_guardian_of` is false.
- After `/api/parent/approve-link` flips to `approved`, the same handlers return data.
- Re-running `parent_login` on an `approved` pair does **not** downgrade it to `pending` (no duplicate
  row; unique `(guardian_id, student_id)` preserved).
- **Anti-orphan guard:** the student approval surface is reachable from the live dashboard
  (`StudentOSDashboard` renders `PendingLinkApproval`) — guarding against the §1 orphaning regressing
  again, so P15 onboarding stays genuinely wired.

---

## 6. P15 onboarding integrity — PRESERVED

The approval surface is **genuinely wired** (the half-built orphan is fixed and pinned by the anti-orphan
REG-199 guard). The new funnel hard-blocks no real parent:

1. Parent signs in (mints JWT) → enters child's link code → `parent_login`.
2. Edge creates a `pending` link + best-effort student notification.
3. Parent sees "Request sent to {child} — waiting for approval" (no dead-end, no opaque error).
4. Student sees the request on their live dashboard card and/or in notifications → taps Approve.
5. Parent's next load / "Check again" returns `status:'approved'` → dashboard unlocks.

Legacy `active`-status rows created **before** this change are **untouched** (grandfathered) and keep
working — no backfill, no break for already-linked parents.

---

## 7. Optional follow-ups (non-blocking — recorded)

1. **Migrate `PendingLinkApproval.tsx` pre-existing inline brand-color styles to Tailwind tokens** (the
   component carried inline styles before this change; cosmetic, not introduced here).
2. **Consider a push / in-app nudge** to reduce the approval-wait friction for the parent.
3. **Legacy `active`-status reconciliation (grandfathered).** The pre-change `active` rows are left
   untouched. A future cleanup *could* reconcile them onto the consent-respecting model, but it is **not
   required** — they remain valid and functional.

(PP-3 — the four parallel link-creation paths + two terminal statuses `active`/`approved` consolidating
onto one consent-respecting choke-point — is materially collapsed by Option B: the legacy `parent_login`
path now produces a `pending` link that flows through the same student-approval choke-point. Any further
path-consolidation/cleanup is reversible engineering, not a fresh CEO gate.)

---

## 8. Closure decision

| Field | Value |
|---|---|
| Disposition | **LANDED** — Option B parent-link consent (link code → `pending` → student approves → `approved`) |
| CEO gate | **RESOLVED** — Option B is the decided end-state (no longer pending) |
| Invariant | P8 + P13 (DPDP child-consent) + P15 — consent-model correction; **no migration** |
| App code changed | `supabase/functions/parent-portal/index.ts`, `src/lib/supabase.ts`, `src/app/dashboard/StudentOSDashboard.tsx`, `src/app/parent/page.tsx` |
| Critical fix | mounted the previously-orphaned `PendingLinkApproval` card (without it, linking dead-ended) |
| Regression pin | **REG-199** (catalog → 166) — `parent-login-consent.test.ts` (16) + `pending-link-approval.test.tsx` (4) |
| Gates | type-check PASS, lint 0, build PASS |
| P14 chain | backend (impl) + frontend (impl) + architect (APPROVE — no migration) + mobile (APPROVE — no impact) + testing (REG-199) + quality (APPROVE, no conditions) |
| Status | **PP-1/3 LANDED** |
