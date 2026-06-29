# Priority Backlog — Workflow Domains

Ranked queue of workflow domains for the audit loop. The loop processes top-down. Only
one workflow is "Current" at a time (see `STATE.md`). Severity reflects blast radius if
the workflow fails in production (revenue, acquisition, trust, compliance).

| Rank | Workflow | Primary Invariants | Severity | Status | Owner squad | Rationale |
|---|---|---|---|---|---|---|
| 1 | **Auth & Onboarding** | P15, P8, P9 | Critical | **IN PROGRESS** | architect (lead) + backend + frontend + testing | #1 acquisition path; if signup→verify→profile→dashboard breaks for any role, no user ever reaches the product. Spans 3 roles and a 3-layer profile failsafe. |
| 2 | **Payments & Subscriptions** | P11 | Critical | **DONE** (Cycle 2, 2026-06-29 — auto-fix-safe complete; PAY-2 gated to user; mobile-repoint follow-up) | backend (lead) + architect | Direct revenue path. Razorpay webhook signature + atomic subscription writes; split-brain and idempotency risk. Wrong here = lost money or unpaid access. |
| 3 | **Student Learning Core (Quiz / Scoring / XP)** | P1, P2, P3, P4, P5, P6, P12 | Critical | **DONE** (Cycle 3, 2026-06-29 — auto-fix-safe complete; SLC-1 user-gated, SLC-4/5 + SLC-8 cutover gated/cross-agent) | assessment (lead) + frontend + testing | The product's reason to exist. Score formula, XP economy, anti-cheat, atomic submission, question quality — most invariants concentrate here. SLC-7 wired the dead P6 gate; SLC-2/3/6/8-pin added P1/P2/P3 parity + idempotency guards (REG-180/181). |
| 4 | **Foxy AI Tutor & RAG** | P12, P8 | High | **DONE** (Cycle 4, 2026-06-29 — P12 output backstop complete; FOX-4 user-gated provider governance; FOX-7 + streaming-residual + Hindi-tokens follow-ups) | ai-engineer (lead) + assessment | Core differentiator. The live grounded-path lacked the P12 "no unfiltered LLM output" backstop (legacy guard left behind at the grounded-answer cutover); FOX-1 (+ Deno twin) now screens every student-facing exit, FOX-2 neutralizes message injection, FOX-3 restores the dead doubt template, FOX-6 pins the P13 prompt boundary (REG-182/183). |
| 5 | **Teacher / School-Admin B2B** | P8, P9, P13 | High | **DONE** (Cycle 5, 2026-06-29 — auto-fix-safe complete; **critical cross-tenant leak TSB-1 closed** at all 8 grade-fallback sites + TSB-2 RLS backstop; TSB-4 USER-gated table-drop; TSB-3/5 + 3 tracked items follow-ups) | backend (lead) + architect + frontend | B2B revenue + multi-tenant isolation. Class/roster/grade-book/RBAC across institutions; cross-tenant leak is a contract-ending event. **TSB-1: a teacher with `grades_taught` but no class could read/write names/mastery/XP of every student across ALL schools via the teacher-dashboard grade fallback (service-role, RLS-bypassed) — now `school_id`-scoped + fail-closed (REG-184); TSB-2 adds a discoverable teacher RLS backstop on `public.students` (REG-185).** |
| 6 | **Super-Admin & Observability** | P9, P13 | Medium | **DONE** (Cycle 6, 2026-06-29 — auto-fix-safe complete; **SAO-1/SAO-5 PII-export tiering USER-GATED**) | ops (lead) + frontend | Operational control plane. Admin auth, audit logging, analytics without PII, health/observability accuracy. Mechanism layers sound; SAO-3 added observability-CSV egress redaction, SAO-2 dropped gratuitous `top_students.email`, SAO-7 made the P9 gate-before-I/O check a full-surface sweep (134 routes, 207/207), SAO-4 added a bare-name log canary (REG-186/187). **SAO-1: `/api/super-admin/reports` bulk-exports raw student name+email + parent name+email+PHONE + teacher email at the LOWEST `support` tier — the admin ladder gates by action-destructiveness, not read-data-sensitivity; raising the tier is a DPDP-relevant access-model change → USER-GATED.** |
| 7 | **Parent Portal (dual auth + DPDP)** | P8, P13, P15 | Medium | **IN PROGRESS — NEXT** | backend (lead) + frontend + architect | Parent↔child link boundary, consent, data export/erasure (DPDP). Compliance + privacy sensitive; lower volume than student path. |
| 8 | **Cross-cutting** | P7, P8, P10, mobile sync | Medium | NOT STARTED | quality (lead) + frontend + mobile + architect | Bilingual (P7) parity, RLS breadth (P8) across all tables, bundle budget (P10), mobile-web API contract sync. Horizontal sweep after vertical workflows. |

## Notes

- Ranking is by **severity × reach**: revenue and acquisition paths first, horizontal
  hygiene last.
- A workflow may surface a gap that belongs to a higher-ranked workflow; file it in the
  current cycle's gap analysis and cross-link — do not jump the queue mid-cycle.
- When rank 1 reaches COMPLETE, set rank 2 to IN PROGRESS, open a new cycle entry in
  `STATE.md`, and update this table.
