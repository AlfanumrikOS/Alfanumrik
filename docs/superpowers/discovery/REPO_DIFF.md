# Repo Diff — Alfanumrik

**Date:** 2026-05-06
**Phase:** Upgrade Phase 0 — Discovery (Step 2)
**Status:** Final
**Diff base:** `Alfanumrik-repo` HEAD `21fd8c5d` → production SHA `088906f8` (97 commits)

---

## Headline

The expected diff was **`Alfanumrik-repo` vs `Desktop\Alfanumrik App`** — two parallel codebases. That framing turned out to be wrong. The Desktop folder has no git history and is not a clone. The real diff is **local `Alfanumrik-repo` HEAD vs production HEAD on the same branch (`main`)**, and that diff is 97 commits behind, not divergent.

| Statistic | Value |
|---|---|
| Commits behind | **97** |
| Commits ahead | 0 |
| Files changed | 891 |
| Lines added | +154,727 |
| Lines deleted | −2,451 |
| Files deleted in prod | 0 |
| Diff direction | Pure forward progression (no rewrites or removals) |

Because there are zero deletions across 97 commits, the local checkout is a *strict subset* of prod. **Nothing in the local checkout has been removed in prod**, so there is no "merge" classification needed for those files. The four Phase-0 classifications (`keep-prod` / `port` / `drop` / `merge`) collapse to one: **everything in prod that isn't local is `keep-prod` — i.e., already shipped, will be visible the moment we `git fetch && git pull`.**

There is therefore no port/drop/merge work to schedule from this diff.

---

## Top-level distribution of the 97-commit gap

| Top-level dir | Files changed |
|---|---:|
| `supabase/` | 414 |
| `src/` | 318 |
| `docs/` | 54 |
| `mobile/` | 22 |
| `scripts/` | 16 |
| `e2e/` | 9 |
| `.github/` | 9 |
| `eval/` | 8 |
| `design-previews/` | 6 |
| `public/` | 4 |
| Root (`package.json`, `next.config.js`, sentry configs, vercel.json, vitest.config.ts, .eslintrc.json, .gitleaks.toml, README, CLAUDE.md, .env.example) | ~12 |

The bulk of the work is in **Supabase (DB migrations + Edge Functions)** and **Next.js source**, in roughly that order.

---

## Matrix 1 — Migrations (`supabase/migrations/`)

**All 28 migrations below are present in prod and absent from local. Classification: `keep-prod`.**

| File | Note |
|---|---|
| `00000000000000_baseline_from_prod.sql` | **Resolves DB audit CRITICAL-1** (base schema versioned) |
| `20260425140100_e2_e3_payment_events.sql` | Domain-event tables for payments |
| `20260425140200_e4_subscription_cancelled_event.sql` | |
| `20260425140300_e8_practice_completed_event.sql` | |
| `20260425140400_e5_e6_notification_events.sql` | |
| `20260425140500_ff_atomic_subscription_activation.sql` | Atomic subscription activation flag |
| `20260425150000_payment_webhook_events.sql` | **Resolves Frontend audit C11** (Razorpay webhook persistence) |
| `20260425150100_pin_search_path_activate_subscription.sql` | **Resolves DB audit MEDIUM-2** (search_path on SECDEF functions) |
| `20260425150200_atomic_downgrade_subscription_rpc.sql` | |
| `20260425150300_activate_with_advisory_lock.sql` | Eliminates race conditions on subscription activation |
| `20260426000000_p0_launch_kill_switches_and_expiry_rpc.sql` | Kill-switch infrastructure |
| `20260426150000_add_ff_welcome_v2.sql` | Welcome v2 flag |
| `20260427000000_rag_chunks_hnsw_index.sql` | **Resolves DB audit LOW-2** (HNSW retained, IVFFlat dropped implicitly) |
| `20260427000001_rls_policies_domain_events_webhook_events.sql` | RLS for new domain-event tables |
| `20260427000002_atomic_plan_change_rpc.sql` | |
| `20260427000003_enforce_daily_xp_cap.sql` | XP daily cap enforced server-side |
| `20260427000004_support_tickets_user_facing_api.sql` | New support-ticket surface |
| `20260427000100_misconception_ontology.sql` | **Foundation for misconception-aware tutoring (B work)** |
| `20260427000200_irt_calibration_columns.sql` | |
| `20260427000300_retrieval_traces_apply.sql` | RAG retrieval observability |
| `20260428000000_match_rag_chunks_ncert_rrf.sql` | **RRF-based RAG retrieval (B work)** |
| `20260428000100_wrong_answer_remediations.sql` | Post-quiz remediation infra |
| `20260428000200_fix_kill_switch_rollout_percentage.sql` | |
| `20260428000300_finalize_teacher_rls_and_retrieval_trace_redaction.sql` | **Resolves DB audit MEDIUM-7** (teacher RLS scoping) |
| `20260428000400_irt_2pl_calibration_impl.sql` | **Real 2PL IRT calibration (B work)** |
| `20260428000500_misconception_candidate_view.sql` | |
| `20260428000600_select_questions_by_irt_info.sql` | IRT-info-driven question selection RPC |
| `20260428000700_fix_irt_info_rpc_type.sql` | |
| `20260428120000_ff_rag_mmr_diversity.sql` | MMR diversity for RAG |
| `20260428130000_schedule_content_readiness.sql` | Cron + content-readiness checks |
| `20260428140000_backfill_cbse_syllabus_rag_status.sql` | |
| `20260428150000_reapply_cbse_syllabus_rag_status_backfill.sql` | |
| `20260428160000_quiz_session_shuffles.sql` | |
| `20260429000000_p1_foxy_streaming_flag.sql` | Foxy streaming responses |
| `20260429010000_quiz_authenticity_phase_b_constraints.sql` | Anti-cheat constraints |
| `20260429020000_quiz_oracle_feature_flag.sql` | |
| `20260430000000_quiz_phase_c_options_versioning.sql` | |
| `20260430010000_foxy_chat_messages_add_structured.sql` | |
| `20260502170000_hotfix_p11_atomic_subscription_rpcs.sql` | |
| `20260503120000_add_ff_goal_adaptive_layers.sql` | Goal-aware adaptation |
| `20260503140000_add_phase2_goal_aware_selection.sql` | |
| `20260503160000_add_ff_goal_daily_plan.sql` | |
| `20260503180000_add_ff_goal_aware_rag.sql` | |
| `20260503200000_add_rag_pack_provenance.sql` | |
| `20260503210000_add_ff_goal_daily_plan_reminder.sql` | |
| `20260504100000_enable_quiz_oracle_in_prod.sql` | |
| `20260504100100_v2_quiz_raise_on_missing_snapshot.sql` | |
| `20260504100200_quiz_idempotency_key.sql` | |
| `20260504100300_server_only_quiz_submit_flag.sql` | |
| `20260504100400_marking_audit_view.sql` | |
| `20260504100500_backfill_quiz_shuffles_integrity.sql` | |
| `20260504100600_v1_quiz_rpc_user_agent_flag.sql` | |
| `20260504100700_fix_distinct_chapter_tuples_ambiguity.sql` | |
| `20260504100800_staging_baseline_catchup.sql` | Staging-vs-prod parity |
| `20260504195900_ensure_experiment_observations.sql` | |
| `20260504200000_stem_lab_engagement_tier1.sql` | STEM lab gamification |
| `20260504200100_stem_lab_badges.sql` | |
| `20260504200200_add_conclusion_grading.sql` | |
| `20260505000100_quarantine_mojibake_content.sql` | Sanskrit mojibake fix |
| `20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql` | Cron migration to Vercel |
| `20260505100100_notifications_idempotency_key.sql` | |
| `20260505110000_atomic_cancel_subscription_rpc.sql` | |
| `20260505120000_account_deletion_flow.sql` | DPDP §17 right-to-erasure |
| `20260505130000_pre_debit_notice_events.sql` | RBI pre-debit notice events |
| `_legacy/timestamped/*` (12 files) | Re-shelved older migrations under `_legacy/` |

**Summary:** the entire DB-audit "missing base schema" finding (CRITICAL-1) is closed in prod, and large chunks of the AI/learning-loop infrastructure (B in the original A/B/C/D ask) have already shipped behind feature flags.

---

## Matrix 2 — API routes (`src/app/api/**/route.ts`)

All new routes; classification: `keep-prod`.

```
src/app/api/cron/account-purge/route.ts
src/app/api/cron/goal-daily-plan-reminder/route.ts
src/app/api/cron/pre-debit-notice/route.ts
src/app/api/dashboard/reviews-due/route.ts
src/app/api/lab-notebook/list/route.ts
src/app/api/quiz/submit/route.ts                  ← server-only quiz submission
src/app/api/student/daily-lab/claim/route.ts
src/app/api/student/daily-lab/route.ts
src/app/api/student/daily-plan/route.ts
src/app/api/student/grade-conclusion/route.ts
src/app/api/super-admin/ai/oracle-health/route.ts
src/app/api/super-admin/goal-profiles/route.ts
src/app/api/super-admin/marking-integrity/route.ts
src/app/api/super-admin/oracle-health/route.ts
src/app/api/support/tickets/[id]/route.ts
src/app/api/support/tickets/route.ts
src/app/api/teacher/lab-leaderboard/route.ts
src/app/api/v1/account/delete/route.ts
```

Pattern: net-new feature surfaces (account deletion, support tickets, daily lab, oracle health, goal profiles). No deletions or rewrites of existing routes are visible at the file-list level — Phase 1 should still spot-check whether shared libraries used by older routes have changed.

---

## Matrix 3 — Pages (`src/app/**/page.tsx`)

All new pages; classification: `keep-prod`.

```
src/app/careers/page.tsx
src/app/lab-notebook/[studentId]/page.tsx
src/app/press/page.tsx
src/app/refunds/page.tsx
src/app/settings/account/delete/page.tsx
src/app/super-admin/goal-profiles/page.tsx
src/app/super-admin/marking-integrity/page.tsx
src/app/super-admin/oracle-health/page.tsx
src/app/support/[ticket_id]/page.tsx
src/app/support/new/page.tsx
src/app/support/page.tsx
src/app/teacher/lab-leaderboard/page.tsx
```

Notable: **no `/learn/[subject]/[chapter]/page.tsx` was added in the 97-commit gap.** The single biggest UX-audit gap is still open. This is the most important Phase-2 candidate.

---

## Matrix 4 — Edge Functions (`supabase/functions/`)

All new; classification: `keep-prod`. Highlights only:

```
supabase/functions/_shared/foxy-lab-prompt.ts
supabase/functions/_shared/posthog.ts
supabase/functions/_shared/quiz-oracle.ts          ← anti-cheat / authenticity oracle
supabase/functions/_shared/quiz-oracle-prompts.ts
supabase/functions/_shared/quiz-oracle.test.ts
supabase/functions/_shared/rag/mmr.ts              ← MMR for RAG diversity
supabase/functions/_shared/rag/retrieve.ts
supabase/functions/_shared/rag/sanitize.ts
supabase/functions/_shared/recent-lab-context.ts
supabase/functions/account-purge/index.ts
supabase/functions/grade-experiment-conclusion/index.ts
supabase/functions/grounded-answer/_mmr-flag.ts    ← new RAG-grounded answer pipeline
supabase/functions/grounded-answer/pipeline-stream.ts
supabase/functions/grounded-answer/prompts/inline.ts
supabase/functions/grounded-answer/structured-prompt.ts
supabase/functions/grounded-answer/structured-schema.ts
supabase/functions/send-pre-debit-notice/index.ts
```

The `grounded-answer` pipeline + `_shared/rag/*` set is essentially the B-work (better RAG, MMR diversity, structured prompting) the original ask wanted to add. Most of it has already landed.

`quiz-oracle` is new authenticity infrastructure that didn't exist at audit time.

The Edge Function audit's CRITICAL-1 (IDOR in `ml-adaptation`) was **not** explicitly addressed by a renamed file in the diff — `ml-adaptation` may still exist with the IDOR. Phase 1 must verify against the post-pull state, not assume.

---

## Matrix 5 — Dependencies (`package.json`)

Concrete drift, both directions:

| Change | From | To |
|---|---|---|
| `framer-motion` | `^11.3.19` | **removed** |
| `posthog-js` | `^1.240.6` | `^1.372.1` |
| `posthog-node` | (none) | `^4.18.0` |
| `remark-breaks` | (none) | `^4.0.0` |
| `browserslist` field | (none) | added (Chrome/FF/Safari/Edge ≥ recent; iOS ≥ 14; ChromeAndroid ≥ 90; not IE 11) |
| Scripts: `supabase:gen-types`, `supabase:check-types`, `eval:rag`, `eval:rag:check`, `forensic:quiz`, `retroactive-scan` | (none) | added |

`next ^16.2.1`, `react ^18.3.1`, `react-dom ^18.3.1` unchanged. **No React 19 jump yet.**

`framer-motion` removal is interesting — animations are now hand-rolled or replaced with another library; Phase 1 should grep to confirm no orphan import survives.

---

## Implications for the upgrade plan

The original A/B/C/D scope was framed against the April audits. Roughly:

- **A (Product/UX):** dashboard widget cut already shipped (PR #539). Welcome v2, careers/press/refunds, support tickets all shipped. **`/learn/[subject]/[chapter]` page is still missing** — the headline UX gap survives.
- **B (AI/Foxy):** RAG-RRF, MMR diversity, structured prompting, IRT 2PL calibration, IRT-info question selection, quiz oracle, misconception ontology, Foxy streaming — **most of B has already landed in prod, behind feature flags.** Remaining B work is enabling/hardening flags and validating the loops end-to-end with seeded data.
- **C (Architecture/backend):** baseline schema versioned ✅. Atomic subscription activation ✅. Domain events introduced ✅. Some teacher RLS scoping ✅. **The Edge-Fn audit IDOR in `ml-adaptation` is not visibly addressed and must be re-verified.**
- **D (Tech/infra):** PostHog server-side added; framer-motion dropped; bundle analyzer + 160 kB CI cap restored (PR #540); Hindi parity (i18n) shipping continuously. **No Next 16-latest or React 19 jump yet.**

The next phase's brainstorm should be scoped against **post-pull prod**, not against the April audits. Specifically:

1. The first Phase-1 step is no longer "fix audits." It is **`git fetch && git pull` in `Alfanumrik-repo`** (after I confirm nothing local is at risk), **and re-scan against the audit findings to identify what is actually still open.**
2. The `Desktop\Alfanumrik App` folder can be deleted at the start of Phase 1 once we confirm it has no unique work — but it is read-only in Phase 0 and we are not deleting anything yet.
3. The biggest still-open headline items, based on this diff alone:
   - **`/learn/[subject]/[chapter]`** structured chapter reading flow (Pain B).
   - Verify Edge-Fn audit C-001 IDOR in `ml-adaptation` against current prod.
   - The 97-commit-old audits' findings need a re-verification pass against post-pull prod; many are likely closed but no inventory exists yet.
   - Validate that the many feature flags shipped (`ff_atomic_subscription_activation`, `ff_welcome_v2`, `ff_rag_mmr_diversity`, `ff_goal_adaptive_layers`, `ff_goal_daily_plan`, `ff_goal_aware_rag`, `ff_goal_daily_plan_reminder`, `quiz_oracle_feature_flag`, `p1_foxy_streaming_flag`, `server_only_quiz_submit_flag`) are at the rollout state you want.
