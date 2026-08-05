# Safeguarding Escalation Rollout Runbook (Foxy North-Star Phase 1)

**Feature**: Foxy Guardian safeguarding disclosure detection + human review lane
(S1.7 / U6 / PR5; spec `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md`, approval A1).
**Flag**: `ff_safeguarding_v1` (seeded OFF by `supabase/migrations/20260806000200_seed_ff_safeguarding_v1.sql`).
**Owner**: ops (this runbook) · ai-engineer (pipeline) · architect (schema/RBAC).

## What ships behind the flag

- Pre-LLM disclosure classifier in the Foxy pipeline:
  - **Tier-1** deterministic regex pre-filter (`packages/lib/src/ai/validation/safeguarding-screen.ts`) — wired at `apps/host/src/app/api/foxy/route.ts:663`.
  - **Tier-2** LLM confirmation stage (`packages/lib/src/ai/validation/safeguarding-classify.ts`) — wired at `route.ts:914`.
- `safeguarding_escalations` row per confirmed disclosure (migration `20260806000100`), category ∈ {self_harm, abuse, violence, acute_distress}, tier ∈ {regex_only, llm_confirmed}.
- Student-facing supportive response incl. Childline **1098** template (`_lib/responders.ts` → `respondSafeguarding`).
- Notification fan-out to the school's active school-admins (`_lib/safeguarding-escalate.ts`) — metadata-only payload `{ escalation_id, category }`, never the excerpt (P13).
- Human review queues: `/super-admin/foxy-quality?tab=safeguarding` (all tenants) and `/school-admin/escalations?tab=safeguarding` (school-scoped), gated by `safeguarding.review`.

## Staged enablement — `ff_safeguarding_v1`

| Stage | rollout_percentage | Hold time | Advance criteria |
|---|---|---|---|
| 0 (now) | OFF | — | All Phase 1 records at `tested`; this runbook read by the on-call reviewer |
| 1 | **5%** | ≥ 3 school days | Zero pipeline errors in Foxy route logs; every escalation row reaches a review queue; fan-out `notifiedAdminCount` > 0 for B2B cases with active admins; no PII in any log line |
| 2 | **25%** | ≥ 5 school days | Review queue being worked (no case pending > 7d); overtrigger rate acceptable to support (see trade-off below); classifier category distribution sane |
| 3 | **100%** | steady state | 30d stale-pending WARN never fires; SLA below holds |

Advance = raise `rollout_percentage` on `ff_safeguarding_v1` via `/super-admin/flags` (change is audit-logged). Any regression → go straight to kill switch.

## Kill switch

**Flag OFF = full kill.** Turning `ff_safeguarding_v1` off disables the classifier stages and escalation writes immediately. Existing `safeguarding_escalations` rows and both review queues remain readable — a kill never hides already-raised cases. No deploy needed.

## Known trade-off: Tier-1 exam-talk overtrigger during gateway outages (fail-closed)

When the AI gateway is unavailable, the Tier-2 LLM confirmation stage cannot run. The pipeline **fails closed**: a Tier-1 regex hit alone (tier `regex_only`) triggers the supportive/helpline response and an escalation row. Tier-1 patterns intentionally overmatch — exam-stress phrasing ("this exam is killing me", "I want to give up") can trip them.

**Consequence support should expect**: during gateway outages, some students will occasionally receive a helpline-style reply to a non-disclosure, and `regex_only` rows will appear in the review queue that reviewers will dismiss. This is the **assessment-accepted direction**: a false supportive reply is low-harm; a missed disclosure is not. Do NOT "tune down" Tier-1 patterns in response to outage-window noise — triage by dismissing the queue rows and note the outage window in review notes.

## Clearance asymmetry — deliberate, do not "fix" the wrong side

- **Confirmation** (Tier-2 upgrading/confirming a disclosure) requires classifier confidence **>= 0.7**.
- **Clearance** (Tier-2 clearing a Tier-1 hit as a false positive) has **no confidence floor**.

This asymmetry is by design: confirming a disclosure gates a high-stakes human process, so it demands high confidence; clearing merely returns the turn to the normal tutoring path, and a wrongly-cleared true disclosure still has later turns and Tier-1 re-triggering as safety nets, while a floor on clearance would convert every low-confidence non-disclosure into escalation noise that buries real cases. If the asymmetry is ever revisited, the change goes through assessment + the A1 approval lane — do not add a clearance floor (or lower the confirmation floor) as a "consistency" cleanup.

## Review-queue SLA and the stale-pending alarm

- **SLA**: every `pending_review` case should be triaged (→ reviewed / actioned / dismissed) well inside 30 days; target for Tier-1/`regex_only` noise is days, for `llm_confirmed` cases 48h.
- **Alarm**: the daily-cron step `safeguarding_escalations_purged` runs a counts-only watchdog — any `pending_review` row older than 30 days emits:
  `daily-cron: safeguarding_escalations_purged — WARNING: N pending_review escalation(s) older than 30 days (never purged; review queue needs attention)`
- **Where it surfaces**: the Supabase Edge Function logs for `daily-cron` — this WARN is part of the **daily ops log review**. There is no push alert yet; the log review IS the alert channel until an alert-deliverer rule is added (tracked follow-up). The WARN is counts-only (P13: no ids, no excerpt, no student identifiers).
- **Response**: work the `/super-admin/foxy-quality?tab=safeguarding` pending queue oldest-first; if a school lane is idle, chase that school's admin contact (below).

## Retention

- Rows carry `retain_until` defaulting to **created_at + 90 days**.
- The daily-cron purge step deletes rows past `retain_until` **only if status ≠ `pending_review`**.
- **Pending rows are NEVER purged** — an unreviewed disclosure must never silently disappear. They age until reviewed (and trip the 30d WARN meanwhile).
- The `disclosure_excerpt` (≤500 chars) is the single sanctioned home for disclosure text (PR5) and is purged with the row.

## Escalation contacts — school-admin lane

<!-- PLACEHOLDER — fill before Stage 2 (25%). The school-admin review lane needs
     a named human per enrolled school; the product fan-out reaches every ACTIVE
     school_admins row, but the operational chase path needs a person. -->

| School | Designated safeguarding contact | Phone/email | Backup |
|---|---|---|---|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ |

External resource given to students in Tier-1/Tier-2 supportive replies: **Childline India 1098** (24×7).

B2C students (no `school_id`): no school fan-out — cases land only in the super-admin queue, which is therefore the lane of record for B2C and must be worked at the same SLA.

## Operational checks (per stage, and weekly at steady state)

1. `/super-admin/foxy-quality?tab=safeguarding` — pending count, oldest pending age.
2. daily-cron logs — `safeguarding_escalations_purged` line present daily; `purged=N, status=ok`; no stale-pending WARN.
3. Foxy route logs — `safeguarding_escalate_*` error/warn events (counts-only) near zero; `safeguarding_escalate_no_active_admins` implies a school with zero active admins (fix the school's admin roster).
4. Spot-check that no log line anywhere carries excerpt text or student names (P13).
