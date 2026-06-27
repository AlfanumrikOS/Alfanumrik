# Architectural exceptions register

**As of:** 2026-05-16.
**Authority:** required by [`ADR-005-concept-first-adaptive-learning-spine.md`](./ADR-005-concept-first-adaptive-learning-spine.md) §5 rule 5 — *"Every architectural exception has an expiry date in `docs/architecture/EXCEPTIONS.md`."*

Every entry is a **deliberate**, time-bound deviation from the contracts in ADR-001 / ADR-004 / ADR-005 or the [Blueprint](../../../skills/alfanumrik-adaptive-learning-os1) hard rules. If a deviation cannot be tied to a concrete artefact and a sunset condition, it does not belong here — it is either a real bug (open in [`RISK_REGISTER.md`](./RISK_REGISTER.md)) or unintentional drift (open in a fresh audit).

## Entry format

```
### E<n>. <Short title>

- **Status:** Active | Sunset Pending | Closed
- **Established:** YYYY-MM-DD
- **Sunset deadline:** YYYY-MM-DD  *or*  Condition: <observable fact>
- **Owner:** <role / individual>
- **Justification:** one paragraph, references concrete artefacts
- **Compensating control:** what protects the system in the meantime
- **References:** PRs, files, migrations, runbooks
- **Last reviewed:** YYYY-MM-DD
```

Mandatory: every entry has a `Sunset deadline` or a `Condition`. Vague "eventually" is not allowed.

## Review cadence

This file is reviewed **quarterly** by the architect, with an off-cycle review whenever a new exception is added. Closed entries stay in the register for one quarter after closure so reviewers can see what was retired.

## Open exceptions

### E1. `foxy-tutor` Edge Function and `/api/foxy` route coexist

- **Status:** Active
- **Established:** 2026-04-18 (commit `8e51fd8` per [`RISK_REGISTER.md`](./RISK_REGISTER.md) R6)
- **Sunset deadline:** Condition — mobile Flutter client migrated to `/api/foxy` and the Foxy Edge Function deleted. Estimated one mobile release cycle from migration start.
- **Owner:** ai-engineer + mobile lead
- **Justification:** `supabase/functions/foxy-tutor/index.ts` predates the grounded RAG pipeline; `src/app/api/foxy/route.ts` is the canonical path with grounding, circuit breaker, and tenant-aware persona (PRs #569, #571). Deleting the Edge Function before mobile migrates would break Play Store builds carrying older app versions.
- **Compensating control:** R6 in `RISK_REGISTER.md` tracks contract drift; contracts currently aligned. New features land in `/api/foxy` only.
- **References:**
  - [`supabase/functions/foxy-tutor/index.ts`](../../supabase/functions/foxy-tutor/index.ts) (legacy)
  - [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) (canonical)
  - [`RISK_REGISTER.md`](./RISK_REGISTER.md) R6
- **Last reviewed:** 2026-05-16

### E2. Parent dual auth path (Supabase guardian role + HMAC link_code)

- **Status:** Active
- **Established:** pre-2026-04 (HMAC path predates Supabase guardian role).
- **Sunset deadline:** Condition — multi-role launch plan Phase 2 ships and the first paying school onboards parents exclusively via Supabase guardian role. Then drop HMAC path within 30 days.
- **Owner:** backend + identity
- **Justification:** Parents were originally onboarded via HMAC-signed link_codes stored in sessionStorage with progressive lockout. Supabase guardian role is the strategic path (RLS-controlled, server-side authorized, audit-logged). Switching today before the new path is battle-tested across the multi-role launch would risk locking parents out of the only role surface that actually monitors child progress.
- **Compensating control:** rate-limited + progressive-lockout on HMAC path; PostHog funnel monitors auth path mix; tenant-isolation eval covers both surfaces.
- **References:**
  - [`src/app/api/parent/`](../../src/app/api/parent/) (HMAC path)
  - [`project_multi_role_launch_plan.md`](../../docs/superpowers/plans/2026-05-07-multi-role-launch-completion.md)
- **Last reviewed:** 2026-05-16

### E3. Tenant-isolation audit script does not walk Edge Functions

- **Status:** Active
- **Established:** 2026-05-07 (PR #578 `feat/wl-tenant-isolation-audit-script`)
- **Sunset deadline:** 2026-06-15 — extension of [`scripts/audit-tenant-isolation.ts`](../../scripts/audit-tenant-isolation.ts) to walk `supabase/functions/**/index.ts` looking for explicit JWT verification + tenant scoping.
- **Owner:** architect + ops
- **Justification:** PR #578 audit walks BFF routes only. Parent (`parent-portal`) and teacher (`teacher-dashboard`) backends are Edge Functions, invisible to the audit. The script's classifier needs a second walker; not done in PR #578 to keep that PR small.
- **Compensating control:** Edge Functions all use service-role + explicit `school_id` filter; manual review for new functions. Per-function `EXPLICIT_WAIVERS` documented when extension lands.
- **References:**
  - [`scripts/audit-tenant-isolation.ts`](../../scripts/audit-tenant-isolation.ts)
  - [`docs/audits/2026-05-07-tenant-isolation.md`](../audits/2026-05-07-tenant-isolation.md)
- **Last reviewed:** 2026-05-16

### E4. Legacy `src/lib/tenant.ts` coexists with `src/lib/tenant-domain/`

- **Status:** Active
- **Established:** 2026-05-07 (PR #558 white-label foundation, Path B chosen over Path A)
- **Sunset deadline:** Condition — tenant-isolation audit (E3) extended to walk Edge Functions confirms no consumers of `src/lib/tenant.ts` remain; then delete the legacy module. Estimated 2026-07-01 once E3 closes.
- **Owner:** architect
- **Justification:** Path A (rename `schools` table → `tenants`) was rejected because 25+ API namespaces, 35+ migrations, and the just-stabilized Razorpay surface key off `school_id`. Path B (additive `tenant_type` column) preserved them. The cost is that `src/lib/tenant.ts` and `src/lib/tenant-domain/` coexist during migration.
- **Compensating control:** PR #558 added re-exports so legacy callers keep working; new code uses `tenant-domain/` exclusively (lint rule `prefer-tenant-domain` to be added in Iteration 2).
- **References:**
  - [`src/lib/tenant.ts`](../../src/lib/tenant.ts) (legacy)
  - [`src/lib/tenant-domain/index.ts`](../../src/lib/tenant-domain/index.ts) (canonical)
  - [PR #558](https://github.com/AlfanumrikOS/Alfanumrik/pull/558)
- **Last reviewed:** 2026-05-16

### E5. Phase 0 inline naive write in `/api/tutor/answer` retained as Path C v2 fallback

- **Status:** Active
- **Established:** 2026-05-12 (PR #755 ADR-004 Phase 2 BKT via projector)
- **Sunset deadline:** Condition — one week after `ff_tutor_bkt_v1` reaches 100 % rollout in production AND zero `tutor_answer_path_c_fallback` PostHog events observed during that week.
- **Owner:** assessment
- **Justification:** Per [`src/app/api/tutor/answer/route.ts`](../../src/app/api/tutor/answer/route.ts) header comment: "Why the legacy block survives PR 2: it is the rollback target. Removing it would mean an RPC outage downgrades all student writes silently to `/dev/null`."
- **Compensating control:** triple-flag gate (`ff_event_bus_v1 && ff_projector_runner_v1 && ff_tutor_bkt_v1`) plus `publishResult.published === true` check. On any failure the route emits `tutor_answer_path_c_fallback` PostHog event and ops-critical log.
- **Lint:** the `alfanumrik/no-canonical-write-outside-projector` rule fires on the legacy `concept_mastery` upsert (`src/app/api/tutor/answer/route.ts:245`). This is the SANCTIONED rollback target, not drift — per the route header and ADR-005 §"The route ↔ projector pairing", the inline write is deliberately retained until this exception sunsets. The sanctioned suppression is an inline `// eslint-disable-next-line alfanumrik/no-canonical-write-outside-projector -- see EXCEPTIONS.md E5` at the upsert site (backend-owned file; pending application). The whole block is deleted when this entry closes, removing both the write and the suppression.
- **References:**
  - [`src/app/api/tutor/answer/route.ts`](../../src/app/api/tutor/answer/route.ts)
  - [PR #755](https://github.com/AlfanumrikOS/Alfanumrik/pull/755)
  - [`ADR-005-concept-first-adaptive-learning-spine.md`](./ADR-005-concept-first-adaptive-learning-spine.md)
- **Last reviewed:** 2026-06-27

### E6. `mesh-automation.enabled` file flag at repo root

- **Status:** Active
- **Established:** pre-2026-05 (mesh substrate landing per `project_agent_mesh_phase_alpha.md`)
- **Sunset deadline:** 2026-05-31 — migrate every reader of this file to `feature_flags.ff_agent_mesh_v1` (already seeded `is_enabled=false`), then delete the file.
- **Owner:** ai-engineer (mesh runtime)
- **Justification:** Pre-flag-table convention. Now that `feature_flags` is the canonical flag substrate (5-min cache, per-user determinism, per-environment), a file at repo root bypasses every operational control the flag table provides.
- **Compensating control:** none — this is a real gap. Pace of fix dictated by mesh runtime maturity; while mesh runtime is not yet shipping student impact, the urgency is low.
- **References:**
  - `mesh-automation.enabled` (repo root)
  - [`src/lib/feature-flags.ts`](../../src/lib/feature-flags.ts)
- **Last reviewed:** 2026-05-16

### E7. `supabase/functions/_archive/quiz-generator-v2/` retained in repo

- **Status:** Sunset Pending
- **Established:** 2026-05-04 (constitution correction per CLAUDE.md line 54)
- **Sunset deadline:** 2026-06-30 — delete the directory or formalize `_archive/` as a tombstone with a per-entry deletion log.
- **Owner:** ops
- **Justification:** `quiz-generator-v2/` was never deployed; archiving avoided losing the work. Eight weeks of archive grace is enough to determine if any code is worth porting back to `quiz-generator/`.
- **Compensating control:** CI does not deploy `_archive/`; CLAUDE.md explicitly lists it as not the live generator.
- **References:**
  - [`supabase/functions/_archive/quiz-generator-v2/`](../../supabase/functions/_archive/quiz-generator-v2/)
  - [`CLAUDE.md`](../../CLAUDE.md) line 54
- **Last reviewed:** 2026-05-16

### E8. Payment routes use session auth without `authorizeRequest()`

- **Status:** Active
- **Established:** documented 2026-04-24 in [`RISK_REGISTER.md`](./RISK_REGISTER.md) R3
- **Sunset deadline:** Condition — `payment.manage` permission defined in an RBAC migration AND all routes under `src/app/api/payments/` call `authorizeRequest(req, 'payment.manage')`. Estimated post multi-role launch (admin-initiated subscriptions feature would surface the real need).
- **Owner:** architect (permissions) + backend (route calls)
- **Justification:** R3 in the risk register. Today routes hard-code `user.id` from session into all writes; a caller cannot start a subscription for another user. The structural gap (P9 says RBAC is server-side via `authorizeRequest`) is real but not currently exploitable.
- **Compensating control:** session auth + hard-coded user-id-from-session prevents cross-user writes; idempotency on Razorpay payment ID prevents duplicate captures.
- **References:**
  - [`RISK_REGISTER.md`](./RISK_REGISTER.md) R3
  - [`src/app/api/payments/`](../../src/app/api/payments/)
- **Last reviewed:** 2026-05-16

### E9. Implicit DB triggers writing across data-ownership boundaries

- **Status:** Active
- **Established:** documented 2026-04-24 in [`RISK_REGISTER.md`](./RISK_REGISTER.md) R8
- **Sunset deadline:** Condition — every trigger that fires a cross-context write is either (a) replaced by an explicit RPC call from the owning module, or (b) catalogued in [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md) as an implicit writer. No fixed date because each migration is independent; track via per-migration cleanup in PR review.
- **Owner:** architect
- **Justification:** [`supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql`](../../supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql) and similar triggers blur ownership — making cross-context flows hard to trace. Rewriting them as events on the now-live `state_events` bus is the strategic target.
- **Compensating control:** RISK_REGISTER R8 surfaces this; PR reviewers flag new triggers that fan-out writes.
- **References:**
  - [`RISK_REGISTER.md`](./RISK_REGISTER.md) R8
  - [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md)
- **Last reviewed:** 2026-05-16

### E10. `/api/learner/next` write-through to `scheduled_actions`

- **Status:** Active
- **Established:** 2026-06-27 (ADR-005 Cycle 2 H2 lint-violation disposition; the write itself predates this — shipped with ADR-001 Phase 3c)
- **Sunset deadline:** Condition — a `scheduled-actions-writer` projector subscriber (under `src/lib/state/subscribers/`) consumes a durable `learner.next_action_resolved` event and becomes the canonical writer of `scheduled_actions`; the route's direct `supabaseAdmin.from('scheduled_actions').upsert(...)` is then removed. No fixed date: blocked on the durable-event spine work (ADR-005 Phase 3). Re-review at the next quarterly cadence.
- **Owner:** architect (projector design + event kind) + backend (route emit/remove)
- **Justification:** [`src/app/api/learner/next/route.ts:138`](../../src/app/api/learner/next/route.ts) performs a best-effort, flag-gated (`ff_scheduled_actions_v1`) write-through to `scheduled_actions` — a canonical learner-state table per ADR-005 §"The enforceable rule" #1. This is a genuine deviation from the projector-canonical rule (not an operational/log table). It shipped as a deliberate ADR-001 Phase 3c interim: the resolver computes the next action and overwrites the daily row directly because the `scheduled-actions` projector does not exist yet. It is registered here (rather than left as silent drift) so it is deliberate, time-bound, and visible to the quarterly review.
- **Compensating control:** the write is (a) flag-gated by `ff_scheduled_actions_v1` (OFF ⇒ no write, response identical to Phase 1/2), (b) best-effort — wrapped in try/catch, never blocks or fails the response, (c) deterministic and student-scoped via the `(student_id, horizon, day_bucket, rank)` conflict key (overwrite-within-day), (d) idempotent on re-resolution. No cross-student or cross-domain write. The resolver remains the single source of the action value, so the route and a future projector would compute identical rows (deterministic-equivalence property the ADR requires of dual writers).
- **Lint:** the `alfanumrik/no-canonical-write-outside-projector` rule fires at `route.ts:138`. The sanctioned suppression is an inline `// eslint-disable-next-line alfanumrik/no-canonical-write-outside-projector -- see EXCEPTIONS.md E10` at the upsert site (backend-owned file; pending application). Do NOT widen the rule allowlist for this — the suppression is per-site and disappears with the projector migration.
- **References:**
  - [`src/app/api/learner/next/route.ts`](../../src/app/api/learner/next/route.ts)
  - [`ADR-001-learner-loop-unification.md`](./ADR-001-learner-loop-unification.md) (Phase 3c write-through)
  - [`ADR-005-concept-first-adaptive-learning-spine.md`](./ADR-005-concept-first-adaptive-learning-spine.md) §"The enforceable rule" #1
  - [`src/lib/state/learner-loop/scheduled-actions.ts`](../../src/lib/state/learner-loop/scheduled-actions.ts)
- **Last reviewed:** 2026-06-27

## Closed exceptions

*(none yet — register established 2026-05-16)*

## Change log

- **2026-06-27 v2** — added E10 (`/api/learner/next` `scheduled_actions` write-through) during the ADR-005 Cycle 2 H2 canonical-write lint-violation disposition; annotated E5 with its lint-suppression posture. Test fixtures excluded from the rule via `.eslintrc.json` override (not an EXCEPTIONS entry — tests are not a production write path).
- **2026-05-16 v1** — register established with E1–E9 derived from existing `RISK_REGISTER.md` entries and Phase-1 audit findings (see chat transcript `2026-05-16-system-audit-phase1`).
