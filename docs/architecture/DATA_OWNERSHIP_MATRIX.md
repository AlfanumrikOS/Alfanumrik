# Data ownership matrix (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Purpose:** for each significant table in the current `public` schema,
record who is allowed to WRITE it (single-writer rule) and who is
allowed to READ it. This is the reference used by code reviewers to
catch cross-domain writes that violate the bounded-module discipline
of [`DOMAIN_BOUNDARIES.md`](./DOMAIN_BOUNDARIES.md).

**Scope note:** all tables are in the `public` schema today. The
abandoned `identity` schema extraction has been reverted. Column-level
detail is not duplicated here — see the authoritative migrations in
[`supabase/migrations/`](../../supabase/migrations/).

## Legend

- **W** = single write owner (only this context's code should write)
- **R** = read access — can read within their own context without
  violating the boundary
- **RW** = read + write owner (typically the single-writer is the
  same as one of the readers)

## Identity & access (B1)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `auth.users` | Supabase (managed) | B1, B2, B12 | n/a |
| `students` | **B1** | B1, B2, B3, B4, B5, B7, B8, B9, B10, B12 | `supabase/migrations/_legacy/000_core_schema.sql` + many updates |
| `teachers` | **B1** | B1, B2, B4, B12 | `supabase/migrations/_legacy/000_core_schema.sql` |
| `guardians` | **B1** | B1, B3, B12 | `supabase/migrations/_legacy/000_core_schema.sql` |
| `user_roles` | **B1** | every server route via `authorizeRequest()` | `supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql` |
| `onboarding_state` | **B1** | B1, B2 | `supabase/migrations/20260402100000_robust_auth_onboarding_system.sql` |
| `user_active_sessions` | **B1** | B1, B13 | `supabase/migrations/20260328120000_identity_integrity.sql` |
| `identity_events` | **B1** (audit append-only) | B12, B13 | same |
| `guardian_student_links` | **B3** | B1, B3, B12 | `supabase/migrations/_legacy/000_core_schema.sql` |
| `school_memberships` | **B2** | B1, B2, B12 | `supabase/migrations/20260412150000_white_label_schools.sql` |

**Writers outside this list:** Supabase Auth writes `auth.users`
directly on signup. The `send-auth-email` Edge Function reads from
`auth.users` to compose verification links.

## Tenant / school (B2)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `schools` | **B2** | B1, B2, B4, B12, B13 | `supabase/migrations/20260412150000_white_label_schools.sql` |
| `classes` | **B2** | B2, B4, B5, B12 | `supabase/migrations/20260416210000_phase2_classes_reports.sql` |
| `class_students` | **B2** (teacher actions) | B2, B4, B5, B12 | same |
| `class_teachers` | **B2** | B2, B4 | same |
| `school_admins` | **B2** | B2, B13 | `supabase/migrations/20260416240000_school_admins_table.sql` |
| `school_api_keys` | **B2** | B2 | `supabase/migrations/20260416220000_school_api_keys.sql` |
| `school_audit_log` | append-only from any B2 server write | B2, B12 | `supabase/migrations/20260416230000_phase3_audit_invoices_usage.sql` |
| `school_invoices` | **B10** (billing context owns invoices) | B2, B10, B12 | same |
| `school_seat_usage` | **B12** (daily-cron recomputes) | B2, B10, B12 | same |

**Open question:** `school_invoices` is owned by billing but displayed in
school-admin pages. Reads are RLS-controlled by tenant. Writes flow
from B10 only.

## Relationships (B3, B4)

Covered above (`guardian_student_links`, `class_students`,
`class_teachers`). No additional tables.

## Quiz engine (B5)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `question_bank` | **B6** (content) | B5, B7, B9, B13 | `supabase/migrations/20260322200645_initial_schema.sql` + verification-state additions at `supabase/migrations/20260418101100_claim_verification_batch_rpc.sql` |
| `quiz_sessions` | **B5** | B5, B9, B12 | `supabase/migrations/_legacy/000_core_schema.sql` |
| `quiz_responses` | **B5** | B5, B9, B12 | same |
| `user_question_history` | **B5** | B5, B9 | `supabase/migrations/20260325*_*` series |
| `student_learning_profiles` | **B5** (via `atomic_quiz_profile_update`) | B5, B9, B12 | `supabase/migrations/20260325160000_atomic_quiz_profile_update.sql` |

**Invariant note (P4):** `atomic_quiz_profile_update` writes
`student_learning_profiles`, `students.xp_total`, and `daily_activity`
in one transaction. This crosses ownership lines but is the **only**
sanctioned writer path into the non-quiz tables from quiz code —
enforced via RPC boundary. Direct writes to `students.xp_total` from
any code other than this RPC is a P2 violation.

## Learning content (B6)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `cbse_syllabus` | **B6** (ingestion Edge Functions + super-admin CMS) | B5, B6, B7, B13 | `supabase/migrations/20260415000001_subject_governance_schema.sql` |
| `ncert_content` | **B6** | B6, B7 | `supabase/migrations/20260318170816_rag_pipeline_schema.sql` |
| `rag_content_chunks` (pgvector) | **B6** | B7 via Edge Function | same |
| `chapter_concepts` | **B6** | B7, B9 | same |
| `rag_ingestion_failures` | **B6** (write on failure) | B13 | `supabase/migrations/20260418*_*` series |
| `content_requests` | **B6** | B13 | same |
| `grounded_ai_traces` | **B7** (grounded-answer Edge Function writes, B13 reads) | B13 | `supabase/migrations/20260418*_*` series |
| `ai_issue_reports` | **B7** (user-submitted via `/api/support/ai-issue`) | B13 | same |

## Foxy (B7)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `foxy_sessions` | **B7** | B7, B9, B12 | `supabase/migrations/20260408000002_foxy_sessions_and_messages.sql` |
| `foxy_chat_messages` | **B7** | B7, B12 | same |
| `ai_tutor_logs` | **B7** | B12, B13 | `supabase/migrations/_legacy/009_ai_tutor_logs.sql` (or nearest AI-log migration; exact filename may vary) |
| `student_daily_usage` | **B7** | B7, B10, B12 | same |

## Assessment (B9)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `concept_mastery` | **B9** | B5, B7, B8, B9, B12 | `supabase/migrations/20260322200645_initial_schema.sql` |
| `topic_mastery` | **B9** | B9, B12 | same |
| `knowledge_gaps` | **B9** | B7, B9, B12 | `supabase/migrations/20260328120000_identity_integrity.sql` series |
| `diagnostic_sessions` | **B9** | B9, B12 | earlier |
| `learning_graph_nodes` | **B9** | B9, B12 | earlier |
| `cme_error_log` | **B9** | B12, B13 | `cme-engine` Edge Function |

## Billing (B10)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `subscription_plans` | **B10** | B10, B12, B13 | `supabase/migrations/20260414120000_payment_subscribe_atomic_fix.sql` |
| `student_subscriptions` | **B10** (via `activate_subscription` or `atomic_subscription_activation` RPC) | B1, B7 (quota gate), B10, B12 | same |
| `payments` | **B10** | B10, B12, B13 | earlier |
| `razorpay_orders` | **B10** | B10, B12 | earlier |
| `razorpay_webhooks` | **B10** (webhook handler appends) | B10, B13 | earlier |

**Invariant note (P11):** only the webhook route (with HMAC signature
verified) or the explicit verify route may call `activate_subscription`
or `atomic_subscription_activation`. Service-role code MUST NOT bypass
signature verification.

## Notifications (B11)

| Table | Write owner | Readers | Source migration |
|---|---|---|---|
| `notifications` | any server context via B11 dispatcher | user via `/notifications` page | `supabase/migrations/_legacy/000_core_schema.sql` |
| `notification_preferences` | **B11** (user-initiated) | B11 | same |
| `whatsapp_messages` | **B11** | B11, B13 | `whatsapp-notify` Edge Function |
| `email_logs` | **B11** | B13 | `send-*-email` Edge Functions |

**Convention:** cross-context triggers (quiz-completed, payment-
completed, etc.) go through B11 dispatcher, not direct writes to
`notifications`. This is not mechanically enforced today — it is a
code-review check.

## Analytics (B12)

B12 is **read-only against every other context.** It writes only
these tables:

| Table | Write owner | Readers |
|---|---|---|
| `audit_logs` | append-only from any server-role context via `src/lib/audit.ts` | B12, B13 |
| `daily_activity` | **B12** (daily-cron) + **B5** (quiz RPC) — dual-writer, acceptable | B12 |
| `student_analytics` | **B12** | B12, B13 |
| `usage_metrics` | **B12** | B12, B13 |
| `performance_reports` | **B12** | B12, B13 |

## Super admin / ops (B13)

| Table | Write owner | Readers |
|---|---|---|
| `feature_flags` | **B13** | all contexts via `feature-flags.ts` cache |
| `maintenance_banner` | **B13** | frontend middleware |
| `support_tickets` | **B13** (user via `/api/support/ticket` → write; ops → update) | B13 |
| `admin_users` (alias for `user_roles` WHERE role='admin') | **B13** | B13 |

## Cross-context writes that are intentional (and why)

Three crossings happen today and are not considered violations:

1. **`atomic_quiz_profile_update` RPC (B5 ⇒ B1 + B12)**: the quiz
   completion transaction writes `students.xp_total`,
   `student_learning_profiles`, `daily_activity`. Sanctioned because
   P4 mandates atomicity. The RPC is the single entry point.
2. **`activate_subscription` / `atomic_subscription_activation` RPC
   (B10 ⇒ B1)**: billing writes `students.subscription_plan` on
   activation / cancel. Sanctioned because P11 mandates atomic
   write. Single entry point.
3. **`school_seat_usage` (B12 ⇒ B2 read path)**: daily-cron computes
   seat usage by reading B2 tables and writing B2's
   `school_seat_usage` (or is it B10's?). Ambiguous; currently the
   daily-cron Edge Function is the writer. Either re-assign ownership
   to B10 (since it feeds invoices) or accept B12 as the writer and
   document the cross.

## Cross-context writes that should be flagged in review

- Any direct `.from('students').update(...)` from quiz, payment, or
  analytics code (should go through B1 module or RPC)
- Any direct `.from('student_subscriptions').update(...)` from
  anything other than B10 payment routes + webhook
- Any direct `.from('question_bank').insert(...)` from runtime code
  (should go through B6 ingestion pipeline)

These are **advisory** — not mechanically enforced today. The goal of
Phase 0 modularization is to make them impossible by removing the
ability to import the raw Supabase client into non-owning code, and
instead route through `src/lib/domains/<context>.ts`.

## Uncertainty / gaps

- **Views and materialized views** are not yet catalogued here. Some
  super-admin dashboards read from views (e.g.
  `ingestion_gaps` per
  [`supabase/migrations/20260418*_ingestion-gaps-view.sql`](../../supabase/migrations/)).
- **Triggers that fan-out writes** are not catalogued. Some identity
  tables have triggers that auto-insert into subscription tables on
  signup (e.g.
  [`supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql`](../../supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql)).
  These blur ownership; tracked as R8 in
  [`RISK_REGISTER.md`](./RISK_REGISTER.md).
