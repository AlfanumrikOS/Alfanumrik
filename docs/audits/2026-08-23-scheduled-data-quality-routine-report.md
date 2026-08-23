# Scheduled data-quality routine — report, 2026-08-23

**Type:** Automated scheduled routine (student-education-data integrity, pipeline-bug, and
adaptive-learning-workflow-blocker check). **Not** an ad hoc investigation.

**Why this is a doc and not a push notification:** this routine's normal notification channel (a
push notification to the CEO) was not available as a callable tool in this session — same
constraint hit by the 2026-08-20 run of this routine (`docs/audits/2026-08-20-scheduled-data-quality-routine-report.md`).
Following that established convention, findings are persisted here as a docs artifact instead of
being lost.

**No code, DDL, migration, or grant was applied by this routine.** This session has no live database
access (no Supabase MCP tool available either) — every finding below is read from existing, dated,
already-verified audit artifacts in this repo (`docs/audits/FIX-LEDGER.md`,
`docs/launch-readiness/07_RELEASE_SCORECARD.md`, `docs/launch-readiness/04_FINDINGS_AND_CONFLICTS.md`,
all updated **today, 2026-08-23**, by an active, CEO-directed launch-readiness audit program), plus a
git-history check confirming no code in the adaptive/pulse/cron pipelines changed since the ledger was
written. This report's contribution is a synthesis through this routine's specific lens —
"is student education data monitored/analysed correctly for personalization and adaptive learning" —
not a re-derivation. Read the cited source files for full evidence.

---

## 1. Data quality — student learner-model data is not trustworthy for personalization today

All below are **NOT-STARTED** per `FIX-LEDGER.md`, confirmed unchanged: no migration touching
`concept_mastery`, `student_learning_profiles`, `curriculum_topics`, `irt_theta`, or
`question_bank.embedding` has landed since the 2026-08-20/21 audit.

| Finding | Severity | Detail | Recommended fix |
|---|---|---|---|
| DB-13 | HIGH | `concept_mastery.total_attempts`/`total_correct` never written — 40% of rows (36/90) have the legacy `attempts`/`correct_attempts` columns populated but the newer pair stuck at 0. Any dashboard/analysis reading the new columns undercounts mastery signal. | assessment: pick one column pair as canonical, backfill or dual-write; route to testing for a regression pinning write parity. |
| DB-28 | HIGH | BKT `p_learn`/`p_guess`/`p_slip` absorb at exactly 1.0 with zero variance; mastery cannot decrease after a wrong answer (one row stays `mastered` with `consecutive_wrong=1`). Directly breaks adaptive difficulty/remediation targeting. | assessment + ai-engineer: audit the BKT update step for a missing clamp/decay branch; add a regression asserting mastery can fall. |
| DB-29 | MEDIUM | `mastery_level` bands overlap (`developing` 0.20–0.66 overlaps `beginner` 0.21–0.39) because two different writers use disjoint vocabularies. | assessment: unify the banding function to one source of truth (same class of fix as the xp-rules single-source pattern this repo already enforces). |
| DB-30 | MEDIUM | `mastered_at` is NULL on all 90 rows, including the 10 marked `mastered`. Any "time to mastery" personalization metric is unmeasurable. | assessment: set `mastered_at` at the write site that flips `mastery_level` to `mastered`. |
| DB-32 | HIGH | 12 of 23 subjects have zero `curriculum_topics` rows; 6,014 questions (32%) have neither `topic_id` nor `chapter_id`, making them unreachable by any topic/chapter-scoped personalization query. | assessment: content-gap triage per subject; this is a content-QA item, not just a code fix. |
| DB-33 | HIGH | IRT calibration never actually runs despite the nightly Vercel cron (`50 2 * * *`) being wired: 471 of 478 items are still at library defaults (theta=0.0, se=1.0). Item-level adaptive selection is currently indistinguishable from random. | ai-engineer: trace why `/api/cron/irt-calibrate` isn't converging live theta values; this is the mechanism `ff_irt_question_selection` depends on before it can ever be safely enabled. |
| DB-34 | HIGH | `question_bank.embedding` is 100% NULL (0/18,765); the embedding queue has 18,750 pending rows with `max(attempts)=0` — the worker has not picked up a single row since queuing began 2026-08-01. This is a distinct, upstream cause feeding into... | ai-engineer: check whether the embedding queue consumer is deployed/scheduled at all; this is a "the pipeline never started," not "the pipeline is failing" signature. |

## 2. Bugs — pipeline defects that corrupt scoring/analysis data at the source

| Finding | Severity | Detail | Recommended fix |
|---|---|---|---|
| DB-17 | CRITICAL | `atomic_quiz_profile_update()` has **4 live production overloads** that disagree on argument order (two take `(p_total, p_correct)`, two take `(p_correct, p_total)`). A caller resolving to the wrong overload silently swaps correct/total, which is a direct P1 (score accuracy) violation baked into the RPC layer this repo's own invariant treats as the single atomic write path for quiz results. | architect + assessment: this needs a P1-severity, user-approved fix per the constitution ("changes to P1-P6 need user approval") — drop the stale overloads down to one canonical signature, verify every call site. |
| DB-9 | HIGH | Grade encoding is split: 14 peripheral tables store `"Grade 11"` while canonical tables store `"11"` (P5 invariant). Joins between them return 0 rows silently — 6,061 content assets are unreachable, which directly starves any grade-scoped personalization query with no error surfaced. | architect: normalize the peripheral tables to the canonical string format; add a lint/CI check so this class can't reappear (P5 is already a documented invariant, just not mechanically enforced at the DB layer). |
| DB-18 | MEDIUM | Two live RAG chunk stores on incompatible vector geometry (`rag_content_chunks` vector(1024), 27,778 rows vs `textbook_chunks` vector(1536), 97 rows), both marked "done" by the same out-of-band worker on 2026-08-18 with no migration provenance. Any retrieval code assuming a single store's dimensionality will silently misbehave against the other. | ai-engineer: reconcile which store is canonical for Foxy grounding; archive or backfill the other. |

## 3. Workflows — monitoring/rollout controls for adaptive features are not reliable

| Finding | Severity | Detail | Recommended fix |
|---|---|---|---|
| **NEW today** — RAG retrieval-quality regression | **HIGH — new blocker, not previously measured** | The RAG eval harness (`eval:rag:harness`) was run for real today against production data and returned a machine verdict of **REGRESS**: recall@10 dropped 0.822 → 0.661, nDCG@10 0.662 → 0.512, MRR 0.729 → 0.575, faithfulness ~0.40–0.47 — all far below the launch mandate's 95% bars. This is the AI-tutor/adaptive-learning grounding pipeline directly failing its own quality gate, not a stale-measurement artifact. Leading hypothesis is corpus-growth dilution (16k → 27.8k chunks) but this is **not yet root-caused**. Full detail: `docs/launch-readiness/07_RELEASE_SCORECARD.md` Gate E. | ai-engineer + assessment: root-cause before any further corpus growth; this is now the single largest open item in the active launch-readiness program and sits squarely on this routine's mandate (personalized/adaptive learning quality). |
| DB-15 / DB-27 | HIGH | Three personalization/adaptive feature flags (`ff_school_pulse_v1`, `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`) are documented as OFF in `CLAUDE.md` but were found **live ON in production with NULL `rollout_percentage`** as of the 2026-08-20 audit (changed 2026-08-18) — still NOT-STARTED per today's `04_FINDINGS_AND_CONFLICTS.md` reconciliation, which explicitly flags this as "contradicts documented posture." Compounding this, `school_id` is unpopulated on the audit-relevant tables these features depend on for school-scoped correctness (90,394 `security_request_audit` rows, 4,066 `foxy_chat_messages`, 99.7% of `audit_logs`). **Note:** this directly contradicts the 2026-08-20 run of this same routine, which reported these flags as "correctly OFF, matching documented state" — that earlier claim should be treated as superseded/wrong, not this one. | ops + architect: reconcile the actual production flag state against `feature_flags` immediately; if genuinely ON and unscoped, this is live, uncontrolled exposure of adaptive features with no rollout gate — treat with the urgency of a launch blocker (it already is one on the active scorecard). |
| Adaptive/pulse cron code paths | Confirmed unchanged, no new bugs found | `daily-cron`, `queue-consumer`, and the adaptive-remediation cron worker (`apps/host/src/app/api/cron/adaptive-remediation/route.ts`) have had no commits since 2026-08-20; the earlier routine's "fail-soft catch blocks are deliberate, not silent failures" assessment still holds by absence of change. | No action — re-verify if these files change. |

---

## Context this report deliberately does not duplicate

A much larger, currently-active, CEO-directed launch-readiness audit program is running in this repo
right now (`docs/launch-readiness/`, `docs/audits/FIX-LEDGER.md`, updated today) and covers security,
payments, RLS/RBAC, and infra findings far beyond this routine's data-quality/personalization mandate.
Overall program verdict as of today: **NOT READY — LAUNCH BLOCKED**, primarily on the RAG regression
above and a TRUNCATE-level grant exposure on money tables (out of this routine's scope — see the
scorecard directly). This report only pulls the subset of that program's findings that bear on whether
student education data is being monitored/analysed correctly for personalization and adaptive
learning, per this routine's specific mandate.

## Closing note

This report was generated because the routine's normal notification channel was unavailable this run
(same as 2026-08-20); it is a **persistence-only artifact**, not a substitute for the CEO actually
seeing and acting on the HIGH/CRITICAL findings above — most notably DB-17 (P1-invariant scoring
defect) and the new RAG retrieval-quality regression, both of which are already being tracked by the
active launch-readiness program today.
