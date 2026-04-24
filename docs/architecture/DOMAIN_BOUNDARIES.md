# Domain boundaries (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Purpose:** define the domain contours of the current monolith so
that modularization (not extraction) can proceed without ambiguity.

**This document describes boundaries that exist TODAY plus the
bounded-module targets we can reach WITHOUT a service split.** Service
extraction is covered in
[`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md).

## Why a document, not an abstract diagram?

The current codebase has **four proven domain modules** already — see
[`src/lib/domains/`](../../src/lib/domains/):

```
src/lib/domains/
├── identity.ts      (6.5 KB)
├── profile.ts       (11.4 KB)
├── quiz.ts          (16.0 KB)
└── types.ts         (4.1 KB — shared ServiceResult contract)
```

They predate the abandoned extraction; they are the correct
granularity and were authored on 2026-04-11. A fifth (`billing.ts`)
existed on the abandoned branch and was dropped — but the PATTERN is
correct. The job is to extend this pattern to every bounded context
below, not to stand up seven fictional services.

## Bounded contexts in this repo

Each context below lists its **owner**, **primary tables**, **primary
code locations** and **current coupling**. "Current coupling" is the
honest state, not an aspiration.

### B1. Identity & access

**Owner:** architect (schema, auth, RBAC); backend (server endpoints);
frontend (`AuthContext`).

**Primary tables** (all in `public` schema today; no identity schema):

- `users` (Supabase Auth's own schema)
- `students`, `teachers`, `guardians`
- `user_roles` (introduced by
  [`supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql`](../../supabase/migrations/20260417200000_rbac_phase2a_tenant_scoped_schema.sql)
  and related)
- `guardian_student_links`
- `school_memberships` (tenant linkage)
- `onboarding_state`
- `user_active_sessions`, `identity_events`

**Code:**

- [`src/middleware.ts`](../../src/middleware.ts) — request auth + rate
  limit + bot detection + feature flag hydration
- [`src/lib/supabase.ts`](../../src/lib/supabase.ts),
  [`src/lib/supabase-server.ts`](../../src/lib/supabase-server.ts),
  [`src/lib/supabase-admin.ts`](../../src/lib/supabase-admin.ts) — the
  3-client pattern
- [`src/lib/AuthContext.tsx`](../../src/lib/AuthContext.tsx) — client
  auth state + `isHi` language toggle
- [`src/lib/rbac.ts`](../../src/lib/rbac.ts),
  [`src/lib/usePermissions.ts`](../../src/lib/usePermissions.ts),
  [`src/lib/admin-auth.ts`](../../src/lib/admin-auth.ts),
  [`src/lib/admin-session.ts`](../../src/lib/admin-session.ts)
- [`src/lib/domains/identity.ts`](../../src/lib/domains/identity.ts)
- `src/app/api/auth/*/route.ts` (bootstrap, repair, onboarding-status,
  session)

**Invariants:** P5, P8, P9, P15.

**Current coupling:** clean for the **monolith use case**. The
abandoned identity schema extraction revealed that ~332 SECURITY
DEFINER functions, 17+ RLS policies, and the 3-layer onboarding
failsafe all assume `public.students` — moving the table would require
a coordinated rewrite, not an incremental extraction. Modularization
target (see `MICROSERVICES_EXTRACTION_PLAN.md`): extend
`src/lib/domains/identity.ts` to mediate all student/teacher/guardian
reads from inside API routes, but **do not move tables**.

---

### B2. Tenant / school

**Owner:** architect (schema, RLS); backend (school-admin APIs);
frontend (school-admin portal).

**Primary tables:**

- `schools`, `classes`, `class_students`, `class_teachers`
- `school_admins` (per
  [`supabase/migrations/20260416240000_school_admins_table.sql`](../../supabase/migrations/20260416240000_school_admins_table.sql))
- `school_api_keys`, `school_audit_log`, `school_invoices`,
  `school_seat_usage` (per
  [`supabase/migrations/20260416220000_school_api_keys.sql`](../../supabase/migrations/20260416220000_school_api_keys.sql),
  [`supabase/migrations/20260416230000_phase3_audit_invoices_usage.sql`](../../supabase/migrations/20260416230000_phase3_audit_invoices_usage.sql))
- White-label configuration per
  [`supabase/migrations/20260412150000_white_label_schools.sql`](../../supabase/migrations/20260412150000_white_label_schools.sql)

**Code:**

- [`src/app/school-admin/`](../../src/app/school-admin/) (16 pages
  counting the new tiles added at commit `7e68900`)
- [`src/app/api/v1/school/`](../../src/app/api/v1/school/)
- [`src/lib/SchoolContext.tsx`](../../src/lib/SchoolContext.tsx)
- [`src/lib/school-admin-auth.ts`](../../src/lib/school-admin-auth.ts)
- Tenant-scoped RLS framework per
  [`supabase/migrations/20260416200000_tenant_session_var_rls.sql`](../../supabase/migrations/20260416200000_tenant_session_var_rls.sql)

**Invariants:** P8 (multi-tenant isolation), P9 (school-admin
permissions are a distinct role).

**Current coupling:** tenant is tied to `schools.id` as the authority
of `students.school_id` / `teachers.school_id`. White-label image
hosts are allow-listed via
[`next.config.js`](../../next.config.js:41). No dedicated module in
`src/lib/domains/`; opportunity for B2 → `src/lib/domains/tenant.ts`
in Phase 0 modularization.

---

### B3. Parent ↔ student relationship

**Owner:** backend (server logic); frontend (parent portal); architect
(relationship RLS).

**Primary tables:** `guardians`, `guardian_student_links`.

**Code:**

- [`src/app/parent/`](../../src/app/parent/) (6 pages)
- [`src/app/api/parent/*/route.ts`](../../src/app/api/parent/) —
  approve-link, profile, report
- `supabase/functions/parent-portal/`,
  `supabase/functions/parent-report-generator/`
- `src/lib/domains/` — **no parent module today**; parent concerns
  leak across student / guardian tables

**Invariants:** P8 (parent can only see linked child's data), P13
(data privacy), P15 (parent onboarding via phone + link code).

**Current coupling:** parent-student linkage uses a distinct
`guardian_student_links` table, which is correct. Read access is
RLS-enforced. Modularization target: extract a
`src/lib/domains/relationship.ts` that mediates
guardian-student queries.

---

### B4. Teacher ↔ class ↔ student

**Owner:** backend + frontend + architect.

**Primary tables:** `teachers`, `classes`, `class_students`,
`class_teachers`.

**Code:**

- [`src/app/teacher/`](../../src/app/teacher/) (8 pages)
- `supabase/functions/teacher-dashboard/`
- No dedicated `src/lib/domains/teacher.ts` module today.

**Invariants:** P8 (teachers see only assigned classes / students).

**Current coupling:** similar to B3 — RLS-backed, correct table
structure, but no mediating module for read paths.

---

### B5. Quiz engine

**Owner:** assessment (rules); backend (API); frontend (UI).

**Primary tables:** `quiz_sessions`, `quiz_responses`,
`user_question_history`.

**Code:**

- [`src/app/quiz/page.tsx`](../../src/app/quiz/page.tsx) (legacy,
  reachable only by deep link after `/quiz → /foxy` redirect)
- [`src/components/quiz/`](../../src/components/quiz/) —
  `QuizSetup.tsx`, `QuizResults.tsx`, `FeedbackOverlay.tsx`
- [`src/lib/xp-rules.ts`](../../src/lib/xp-rules.ts) — XP + score
  constants
- [`src/lib/exam-engine.ts`](../../src/lib/exam-engine.ts) — exam
  presets and timing
- [`src/lib/anti-cheat.ts`](../../src/lib/anti-cheat.ts) — P3 checks
- [`src/lib/domains/quiz.ts`](../../src/lib/domains/quiz.ts) —
  mediating module (already exists)
- `supabase/functions/{quiz-generator, quiz-generator-v2, cme-engine,
  verify-question-bank}/`

**Invariants:** P1, P2, P3, P4, P6.

**Current coupling:** the score formula is **duplicated in three
places** (`submitQuizResults()`, `QuizResults.tsx`,
`atomic_quiz_profile_update` RPC). This is a deliberate
belt-and-suspenders that P1 mandates must agree — not a bug. Keep as
is; add a type / test guard to enforce equality.

---

### B6. Learning content (RAG + curriculum)

**Owner:** ai-engineer (retrieval); assessment (academic correctness);
architect (pgvector schema).

**Primary tables:** `question_bank`, `rag_content_chunks` (pgvector),
`cbse_syllabus`, `ncert_content`, `chapter_concepts`,
`content_requests`, `rag_ingestion_failures`, `grounded_ai_traces`,
`ai_issue_reports`.

**Code:**

- `supabase/functions/{extract-ncert-questions, extract-diagrams,
  embed-*, generate-*, bulk-question-gen, verify-question-bank,
  coverage-audit}/`
- [`src/lib/ai/`](../../src/lib/ai/) — prompt builders (foxy-system,
  ncert-solver, quiz-gen, parent-report, school-context), retrieval
  helper (`retrieveNcertChunks`), embedding (`generateEmbedding`)
- [`src/app/api/embedding/route.ts`](../../src/app/api/embedding/route.ts)

**Invariants:** P6 (question quality), P12 (AI safety).

**Current coupling:** question bank is written by ingestion Edge
Functions and super-admin CMS routes; read by quiz, foxy, and
grounded-answer. Acceptably decoupled.

---

### B7. Foxy AI tutor

**Owner:** ai-engineer (prompts, pipeline); assessment (cognitive
correctness).

**Primary tables:** `foxy_sessions`, `foxy_chat_messages`,
`ai_tutor_logs`, `student_daily_usage`.

**Code (two live paths — tracked drift):**

- `supabase/functions/foxy-tutor/index.ts` — legacy, still active for
  mobile clients
- [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) —
  new grounded route gated by `ff_grounded_ai_foxy`
- `supabase/functions/grounded-answer/` — RAG + Claude pipeline
  (retrieval, scope verification, Haiku/Sonnet call, strict-mode
  second pass, citation extraction, 3-state circuit breaker,
  in-memory LRU cache)

**Invariants:** P12 (age-appropriate, CBSE-scoped, quota-enforced,
grounded).

**Current coupling:** the grounded-answer Edge Function is correctly
sandboxed. The remaining split-brain between `foxy-tutor` and
`/api/foxy` is scheduled for closure via feature flag flip + mobile
migration.

---

### B8. Practice / review / spaced repetition

**Owner:** assessment (SM-2 / BKT rules); backend (scheduling);
frontend (review UI).

**Primary tables:** `spaced_repetition_cards`, `review_queue`,
`concept_mastery` (owned by B9 — read-access here), `topic_mastery`.

**Code:**

- [`src/app/review/page.tsx`](../../src/app/review/page.tsx),
  [`src/app/learn/`](../../src/app/learn/)
- [`src/lib/feedback-engine.ts`](../../src/lib/feedback-engine.ts)
- No dedicated `src/lib/domains/practice.ts` module; spread across
  page-level handlers.

**Invariants:** P2 (XP for correct review), P6.

**Current coupling:** tight with B5 (quiz) and B9 (assessment).
Modularization target: `src/lib/domains/practice.ts` mediates SM-2
updates.

---

### B9. Assessment / cognitive model

**Owner:** assessment (rules, invariants); ai-engineer (implementation
when RPC is insufficient).

**Primary tables:** `concept_mastery`, `knowledge_gaps`,
`diagnostic_sessions`, `learning_graph_nodes`, `cme_error_log`,
`topic_mastery`.

**Code:**

- [`src/lib/cognitive-engine.ts`](../../src/lib/cognitive-engine.ts)
  (BKT + IRT + SM2)
- [`src/lib/exam-engine.ts`](../../src/lib/exam-engine.ts)
- [`src/lib/feedback-engine.ts`](../../src/lib/feedback-engine.ts)
- `supabase/functions/cme-engine/`,
  `supabase/functions/ncert-question-engine/`
- [`src/app/api/concept-engine/route.ts`](../../src/app/api/concept-engine/route.ts),
  [`src/app/api/diagnostic/*/route.ts`](../../src/app/api/diagnostic/)

**Invariants:** P1, P2, P4, P6.

**Current coupling:** the `cme-engine` Edge Function is the server-
side authority for cognitive state. Quiz completions trigger RPC
updates synchronously today (no event bus).

---

### B10. Billing / subscription

**Owner:** backend (server logic); architect (atomicity invariants).

**Primary tables:** `subscription_plans`, `student_subscriptions`,
`payments`, `razorpay_orders`, `razorpay_webhooks`.

**Code:**

- [`src/app/api/payments/*/route.ts`](../../src/app/api/payments/)
  (create-order, verify, subscribe, cancel, status, webhook,
  setup-plans)
- [`src/lib/razorpay.ts`](../../src/lib/razorpay.ts),
  [`src/lib/payment-verification.ts`](../../src/lib/payment-verification.ts)
- No `src/lib/domains/billing.ts` today (it existed on the abandoned
  branch and was dropped per Option C). Modularization target is to
  reintroduce it with tighter contracts.

**Invariants:** P11 (atomic payment integrity).

**Current coupling:** webhook + verify + cancel routes each manage
state writes separately. The new
`atomic_subscription_activation` RPC (commit `8d9bd62`) is a standby
single-transaction path that a follow-up branch should wire in.

---

### B11. Notifications / messaging

**Owner:** backend (dispatch); frontend (in-app notifications UI).

**Primary tables:** `notifications`, `notification_preferences`,
`whatsapp_messages`, `email_logs`.

**Code:**

- `supabase/functions/{send-auth-email, send-welcome-email,
  whatsapp-notify, alert-deliverer}/`
- [`src/app/api/notifications/whatsapp/route.ts`](../../src/app/api/notifications/whatsapp/route.ts)
- [`src/app/notifications/page.tsx`](../../src/app/notifications/page.tsx)

**Invariants:** P13 (no PII in logs); P7 (bilingual delivery).

**Current coupling:** low — notifications already flow via
dedicated Edge Functions. No tight UI coupling.

---

### B12. Analytics / reporting

**Owner:** ops (metric ownership); backend (APIs); architect (read
replica concerns, not yet relevant).

**Primary tables:** `audit_logs`, `daily_activity`, `student_analytics`,
`usage_metrics`, snapshots in
[`supabase/migrations/20260416220000_school_audit_log.sql`](../../supabase/migrations/) (see B2).

**Code:**

- [`src/app/super-admin/`](../../src/app/super-admin/) (ops-owned
  reporting surface)
- [`src/app/api/super-admin/`](../../src/app/api/super-admin/)
  (61 routes per CLAUDE.md)
- `supabase/functions/{parent-report-generator, export-report,
  daily-cron, nep-compliance}/`
- [`src/lib/analytics.ts`](../../src/lib/analytics.ts),
  [`src/lib/audit.ts`](../../src/lib/audit.ts),
  [`src/lib/audit-pipeline.ts`](../../src/lib/audit-pipeline.ts),
  [`src/lib/anomaly-detector.ts`](../../src/lib/anomaly-detector.ts)

**Invariants:** P13 (PII), P10 (dashboards must not blow bundle).

**Current coupling:** analytics reads cross every other context. This
is expected — reporting is inherently cross-cutting. Target: keep
analytics read-only against every other table, never write outside
its own tables.

---

### B13. Super admin / platform ops

**Owner:** ops.

**Primary tables:** `feature_flags` (already table-backed per
[`supabase/migrations/20260418100800_feature_flags.sql`](../../supabase/migrations/20260418100800_feature_flags.sql)),
`maintenance_banner`, `support_tickets`, `ai_issue_reports`.

**Code:** `src/app/super-admin/`, `src/app/api/super-admin/`,
`src/app/internal/admin/`, `src/app/api/internal/admin/`,
[`src/lib/feature-flags.ts`](../../src/lib/feature-flags.ts).

**Invariants:** P9 (super-admin role is most privileged).

**Current coupling:** gated by `SUPER_ADMIN_SECRET` + RBAC. Self-
contained.

## Cross-context communication model today

No event bus. All cross-context flow is **synchronous function calls
or RPC calls in-process**. Specifically:

- Quiz completion → `atomic_quiz_profile_update` RPC → writes
  `student_learning_profiles`, `students`, `daily_activity` in one
  transaction
- Payment webhook → `activate_subscription` RPC → writes `payments`,
  `student_subscriptions`, `students`
- Foxy message → `check_and_record_usage` RPC → writes
  `student_daily_usage`; then grounded-answer Edge Function streams
  response
- Daily cron → `supabase/functions/daily-cron/` → reads + writes
  `daily_activity`, `notifications`

**What this means for extraction:** extracting any of these contexts
into its own process requires inserting a network boundary where
today there is a transaction boundary. That is a real cost and
should not be done casually. See
[`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md)
for when, if ever, to pay it.

## Modularization summary table

| Ctx | Has module today? | Suggested module | Phase 0 target |
|---|---|---|---|
| B1 Identity | `src/lib/domains/identity.ts` | keep + extend | **Phase 0a** |
| B2 Tenant | no | `src/lib/domains/tenant.ts` | Phase 0b |
| B3 Parent-student | no | `src/lib/domains/relationship.ts` | Phase 0c |
| B4 Teacher-class | no | `src/lib/domains/classroom.ts` | Phase 0c |
| B5 Quiz | `src/lib/domains/quiz.ts` | keep | done |
| B6 Content | partial (`src/lib/ai/`) | `src/lib/domains/content.ts` | Phase 0d |
| B7 Foxy | no (Edge Functions) | — | kept as Edge Functions |
| B8 Practice | no | `src/lib/domains/practice.ts` | Phase 0e |
| B9 Assessment | partial (`src/lib/cognitive-engine.ts`) | `src/lib/domains/assessment.ts` | Phase 0f |
| B10 Billing | reintroduce | `src/lib/domains/billing.ts` (clean) | Phase 0g |
| B11 Notifications | no | `src/lib/domains/notifications.ts` | Phase 0h |
| B12 Analytics | partial (`src/lib/analytics.ts`) | `src/lib/domains/analytics.ts` | Phase 0i |
| B13 Super admin | no | `src/lib/domains/ops.ts` | Phase 0j |

Phase 0 is **inside the monolith, no schema moves, no process splits.**
Services come later if at all.
