# STATUS: PP-1 / PP-3 — parent-link consent model

**PP-1/3 LANDED — Option B parent-link consent (CEO-approved): link code → pending → student approves; approval surface wired; REG-199.**

- **Item:** PP-1-consent + PP-3 (post-program remediation backlog, Tier-1; surfaced Cycle 7 — parent-portal)
- **Invariant:** P8 (parent↔child boundary) + P13 (DPDP child-consent) + P15 (onboarding integrity)
- **Decision:** CEO-approved **Option B** — link code creates a `pending` link; the student/child approves (`pending` → `approved`) before any data path opens
- **Owner squad:** backend (Edge/response/notify) + frontend (parent UX + student approval surface) + architect (consent boundary — no migration) + mobile (no impact) + testing (REG-199) + quality
- **CEO gate:** **RESOLVED** — Option B is the decided end-state
- **Started / landed:** 2026-06-29
- **Status:** **LANDED — APPROVE (no conditions).**

## Ledger
| Step | Artifact | Done |
|---|---|---|
| DESIGN (Option B — backend response, student approval-surface wiring, notification, RLS/idempotency, P15, migration analysis) | `01-design.md` | [x] |
| VALIDATION (all verdicts + gates + REG-199 + 3-layer consent confirmation + optional follow-ups) | `02-validation.md` | [x] |

## What landed
- `supabase/functions/parent-portal/index.ts` `handleParentLogin`: link code now creates a **`pending`**
  (not `active`) `guardian_student_links` row via `.upsert(onConflict:'guardian_id,student_id',
  ignoreDuplicates:true)`, `is_verified:false`; responds `{ status:'pending_approval', student_name,
  link_id }` (no session) for a new/pending link, `{ status:'approved', guardian, student }` for an
  already-linked re-submit (no downgrade); notifies the student PII-free via the `send_notification`
  RPC (type `parent_link_request`, bilingual `data.*_hi`, best-effort).
- `src/lib/supabase.ts`: new `getPendingParentLinks()` (calls `get_pending_link_requests` RPC, fail-soft).
- `src/app/dashboard/StudentOSDashboard.tsx`: **mounted the previously-ORPHANED `PendingLinkApproval`
  card** (the critical fix — without it, linking dead-ended). Self-hides when no pending requests.
- `src/app/parent/page.tsx`: bilingual "awaiting approval" screen on `pending_approval` (reads
  `res.student_name`); existing dashboard flow on `approved`.

## 3-layer consent boundary (confirmed)
A `pending` link grants **zero access** at all three layers: domain helper
(`ACTIVE_GUARDIAN_LINK_STATUSES` excludes `pending`), Edge data handlers (`.in('status',
['active','approved'])`), DB RLS (`is_guardian_of` counts only `approved`). Data flows only after the
student approves.

## Gates
- type-check **PASS** | lint **0 errors** | build **PASS**
- Tests: **REG-199** — `parent-login-consent.test.ts` (16) + `pending-link-approval.test.tsx` (4);
  **484** broad parent sweep green; REG-117 / REG-188 / REG-189 / REG-190 intact.
- Catalog **165 → 166** (REG-199).
- **P14 chain COMPLETE:** backend + frontend + architect (APPROVE — NO migration; `notifications.type` is
  free TEXT, `pending` already a valid status; consent boundary confirmed at 3 layers) + mobile (APPROVE —
  no mobile impact; mobile never calls `parent_login`, reads `/v2/parent/*` which already filters to
  active/approved) + testing (REG-199) + quality (APPROVE, no conditions).

## Outcome
Closes the Cycle-7 finding that a link code ALONE granted an ACTIVE guardian link with no consent. Now
the student/child must approve (pending → approved) → clean DPDP consent story. P15 onboarding preserved
(the approval surface is genuinely wired — the half-built orphan is fixed and pinned by the anti-orphan
REG-199 guard).

## Optional follow-ups (non-blocking — recorded)
1. Migrate `PendingLinkApproval.tsx` pre-existing inline brand-color styles to Tailwind tokens (cosmetic).
2. Consider a push / in-app nudge to reduce approval-wait friction.
3. Legacy pre-change `active`-status rows are untouched (grandfathered) — a future cleanup *could*
   reconcile them, but it is **not** required.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (Edge/response/notify) | backend | 2026-06-29 | DONE |
| Builder (parent UX + student approval surface) | frontend | 2026-06-29 | DONE |
| Security / consent boundary | architect | 2026-06-29 | **APPROVE** (no migration) |
| Mobile | mobile | 2026-06-29 | **APPROVE** (no impact) |
| Testing | testing | 2026-06-29 | **GREEN** — REG-199 filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** (no conditions) |
