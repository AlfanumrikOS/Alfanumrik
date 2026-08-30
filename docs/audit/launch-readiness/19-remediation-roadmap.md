# 19 — Remediation Roadmap

**Status:** PROPOSED — awaiting CEO approval before any remediation begins
**Principle:** Complete the investigation before recommending implementation. Audit in phases. Do not start fixing findings until separately approved.

---

## Phase 0 — Launch Blockers (must close before any pilot)

| # | Finding | Action | Owner | Est. Effort | Dependencies |
|---|---------|--------|-------|-------------|--------------|
| 0.1 | P1-01: question_bank answer key exposed | Column-level ACL revoke on correct_answer_index, correct_answer_text, explanation, solution_steps, hint_level_1/2/3, answer_rubric, expected_answer for anon/authenticated. Migrate remaining 3 RPCs to keyless serving pattern (per 20260814000023 design). | Backend/DBA | 1-2 days | Must update quiz-serving RPCs FIRST, then apply ACL |
| 0.2 | P1-02: RAG retrieval regression | Root-cause corpus-growth dilution (16k→27k chunks). Evaluate: reranker tuning, chunk quality filtering, embedding re-generation, retrieval parameter adjustment. Extend eval harness for recall@3, correctness, abstention metrics. | AI/ML | 1-2 weeks | Independent of other items |
| 0.3 | P1-03: CI Gate not required | Add "CI Gate" to main-protection ruleset required status checks in GitHub | Ops/CEO | 30 min | GitHub repo admin access |
| 0.4 | P0-01: verify-question-bank never worked | Ship signing header fix to grounded-client.ts (x-internal-timestamp + x-internal-signature). Verify cron produces real verification results in ops_events. | Backend | 1 day | Signing fix PR must merge first |
| 0.5 | P1-04: Single-person alerting | Add at least one redundant notification channel (Slack webhook or second ops email). Wire to existing alert rules. | Ops | 1 day | Slack workspace or second email |

---

## Phase 1 — Security Hardening (before first real students)

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 1.1 | P2-01: Default table privileges | ALTER DEFAULT PRIVILEGES to not auto-grant INSERT/UPDATE/DELETE to anon/authenticated. Add CI lint gate requiring explicit RLS policy for every new table. | DBA | 1 day |
| 1.2 | P2-02: Default function privileges | ALTER DEFAULT PRIVILEGES to not auto-grant EXECUTE to anon/authenticated on new functions. | DBA | 1 day |
| 1.3 | P1-05: webhook-dispatcher query param secret | Remove `?token=` auth path; enforce header-only auth. | Backend | 1 hour |
| 1.4 | P1-07: match_rag_chunks_ncert EXECUTE grant | REVOKE EXECUTE from authenticated on match_rag_chunks_ncert. All callers already use service_role. | DBA | 30 min |
| 1.5 | P1-08: Error message leaks | Replace raw err.message with generic errors in session-guard, teacher-dashboard, parent-portal catch blocks. | Backend | 2 hours |
| 1.6 | P2-05: compute_mrr_snapshot anon-executable | REVOKE EXECUTE from anon on compute_mrr_snapshot. | DBA | 30 min |
| 1.7 | P2-07: Stale DESIGN_ONLY migration | Move 20260823154500 out of supabase/migrations/ (or rename to .applied with corrective note). | DBA | 30 min |

---

## Phase 2 — Cron & Background Job Reliability

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 2.1 | P1-06: streak-guardian duplicates | Switch to UPSERT with (student_id, type, date) idempotency key. | Backend | 1 hour |
| 2.2 | P2-19: queue-consumer claim race | Add SELECT FOR UPDATE SKIP LOCKED to task claim query. | Backend | 1 hour |
| 2.3 | P2-20: No overlapping-run protection | Add run-lock pattern (per adaptive-remediation) to streak-guardian, school-operations, evaluate-alerts. | Backend | 2 hours |
| 2.4 | P2-26: recalculatePerformanceScores dead step | Remove or replace with correct table reference pending assessment sign-off. | Backend | 1 hour |
| 2.5 | Orphaned routes | Decision: wire evaluate-alerts and goal-daily-plan-reminder to vercel.json or daily-cron, OR delete them. | Product/Backend | 1 hour |

---

## Phase 3 — Adaptive Learning & RAG Quality

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 3.1 | P2-08: Learning velocity clamp | Allow negative velocity; update predictMasteryDate to handle regression signals. | Backend | 2 hours |
| 3.2 | P2-09: Experiment evidence not persisted | Wire recordExperimentEvidence to write to concept_mastery (or a dedicated table) via cron. | Backend | 1 day |
| 3.3 | P2-21: quality_score no-op | Implement meaningful quality scoring in NCERT ingestion or remove the filter. | AI/ML | 1 day |
| 3.4 | P2-23/P2-24: No chunk overlap or dedup | Add overlapping windows to ingestion; add uniqueness constraint or dedup pass. | AI/ML | 2 days |

---

## Phase 4 — Defense-in-Depth & Observability

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 4.1 | P2-12: Foxy message query defense-in-depth | Add .eq('student_id', studentId) to the message retrieval query. | Backend | 30 min |
| 4.2 | P2-06: exam_papers etc. USING(true) | Scope to teacher/admin roles. | DBA | 1 hour |
| 4.3 | P2-14: Single notification channel | Add Slack webhook channel as redundant delivery path. | Ops | 2 hours |
| 4.4 | P2-16: Edge auth sweep advisory | Flip to blocking after confirming 5+ consecutive clean runs. | Ops | 30 min |
| 4.5 | P2-18: Staging deploy disabled | Restore staging Supabase project or formally decommission staging environment. | Ops | 1 day |

---

## Phase 5 — Data Integrity (from FIX-LEDGER backlog)

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 5.1 | DB-3: XP ledger drift | Quantify Σ xp_transactions vs students.xp_total; produce reconciliation plan. | Backend | 1 day |
| 5.2 | DB-9: Grade encoding split | Normalize "Grade 11" → "11" across 14 tables; fix 6,061 unreachable assets. | Backend | 2 days |
| 5.3 | DB-10: user_roles.auth_user_id orphaned | Add FK constraint or cleanup orphaned rows (31/65). | DBA | 1 day |
| 5.4 | DB-13: concept_mastery mismatch | Reconcile total_attempts/total_correct with actual quiz data. | Backend | 1 day |
| 5.5 | DB-14: XP divergence | Reconcile students.xp_total vs Σ student_learning_profiles.xp. | Backend | 1 day |
| 5.6 | DB-17: atomic_quiz_profile_update overloads | Converge argument order across 4 overloads. | DBA | 2 hours |
| 5.7 | DB-18: Two RAG chunk stores incompatible geometry | Migrate to single vector dimension (1024) or document the split. | AI/ML | 1 day |

---

## Phase 6 — CI/CD Hardening

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 6.1 | P2-17: Migration lint not required | Add "Lint migrations" to main-protection required status checks. | Ops | 30 min |
| 6.2 | P3-13: Single CODEOWNERS team | Consider per-domain CODEOWNERS (database/, payments/, ai/) for expertise-routed reviews. | Engineering | 1 hour |
| 6.3 | P3-14: No branch protection drift detection | Add periodic workflow that verifies ruleset configuration matches expectations. | Ops | 2 hours |
| 6.4 | E2E Nightly | Triage #1418; assign owner; restore green within 2 weeks. | Testing | 1 week |

---

## Phase 7 — Housekeeping & Technical Debt

| # | Finding | Action | Owner | Est. Effort |
|---|---------|--------|-------|-------------|
| 7.1 | DB-4: Edge Function drift | Reconcile 102 deployed vs ~47 on disk; undeploy or source-control the gap. | Backend/Ops | 2 days |
| 7.2 | DB-15: Feature flag posture drift | Reconcile 3 flags documented OFF but ON in production. | Ops | 1 hour |
| 7.3 | P3-18: domain_events bus handlers no-op | Implement or remove E1-E8 event handlers. | Backend | 1 day |
| 7.4 | P3-17: WhatsApp send disabled | Decision: re-enable or remove the code path. | Product | 1 hour |

---

## Phase 8 — Longer-Term Program Items (from Known Risks Register)

| # | Item | Status |
|---|------|--------|
| 8.1 | XC-3: ~87% routes on admin client (RLS bypass) | Multi-sprint migration; not a launch blocker if denial behavior verified |
| 8.2 | XC-4b: Split @supabase/* out of first paint | Bundle optimization |
| 8.3 | XC-7: Central keyed-resolver i18n | Multi-sprint |
| 8.4 | TSB-4: class_students/class_enrollments roster cutover | CEO-gated (irreversible DROP) |
| 8.5 | SLC-1: XP backfill/clamp | CEO-gated (mutates stored XP) |

---

## Estimated Total

| Phase | Items | Estimated Effort |
|-------|-------|-----------------|
| Phase 0 (blockers) | 5 | 2-3 weeks (dominated by RAG regression root-cause) |
| Phase 1 (security) | 7 | 2-3 days |
| Phase 2 (cron) | 5 | 1 day |
| Phase 3 (adaptive/RAG) | 4 | 1 week |
| Phase 4 (defense-in-depth) | 5 | 2 days |
| Phase 5 (data integrity) | 7 | 1 week |
| Phase 6 (CI/CD) | 4 | 2 days |
| Phase 7 (housekeeping) | 4 | 3 days |
| Phase 8 (program) | 5 | Multi-sprint |

**Critical path to launch: Phase 0 items 0.1 + 0.2 + 0.3 + 0.4 + 0.5 = ~2-3 weeks**, dominated by the RAG regression root-cause investigation (0.2). All other Phase 0 items can complete in parallel within 2-3 days.
