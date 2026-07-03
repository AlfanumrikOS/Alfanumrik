# Phase 2 Validation — Orchestrator Salvage Notes (2026-07-02)

Findings captured directly by the orchestrator from (a) sub-agent child
returns whose parent auditor did not persist a report, and (b) the
orchestrator's own read-only bug-class sweep. This file exists because two
audit agents (business-workflow, data-integrity) returned before writing
their report files; their evidence is preserved here so it is not lost.

## Surrogate-id bug-class sweep (orchestrator, EXHAUSTIVE on src/app/api + src/lib)

Bug class: querying student-owned data with the auth uid where the target
expects the surrogate `students.id` (the class of the synthesis/state bug
fixed in commit ce893460).

### CONFIRMED instance
- `src/app/api/rhythm/today/route.ts:210` — `.eq('id', userId)` on `students`
  (userId = auth.uid(); students.id is a uuid_generate_v4 surrogate).
  Route 404s `no_student_profile` for every real student → **Daily Rhythm
  queue is dark whenever `ff_pedagogy_v2_daily_rhythm` is ON.** [CRITICAL]
- Secondary (same route, masked by the above until line 210 is fixed):
  - `:276` `get_due_reviews({p_student_id: userId})` — RPC requires surrogate
    (concept_mastery.student_id FKs students.id; no dual-key guard). MUST be
    fixed in the same change or the route breaks at the next step.
  - `:345` `get_adaptive_questions({p_student_id: userId})` — same.
  Source: business-workflow child (J-1) + orchestrator grep.

### REFUTED candidates (pass auth uid but RPC accepts dual-key — SAFE)
- `src/app/api/student/subjects/route.ts:179-180` — RPCs
  `get_available_subjects[/_v2]` documented dual-key; `.or(id.eq,auth_user_id.eq)`
  fallback. SAFE.
- `src/app/api/student/chapters/route.ts:88` — RPC
  `available_chapters_for_student_subject_v2` body:
  `WHERE id = p_student_id OR auth_user_id = p_student_id`
  (baseline_from_prod.sql:1181). SAFE.

### Root hazard
Two coexisting conventions: dual-key-tolerant RPCs vs surrogate-only RPCs/
predicates. Recommend Phase 3 make the strict paths (get_due_reviews,
get_adaptive_questions) dual-key to eliminate the footgun, in addition to
fixing rhythm/today.

## Business-workflow journeys (salvaged from J-1 child)
- S2 Daily Rhythm: **BROKEN** (see above).
- S4 Foxy: INTACT (authorizeRequest+studentId correct; quota via
  check_and_record_usage, not checkPlanGate — different mechanism, not a defect).
- S5 Weekly Dive: INTACT (all 4 routes resolve surrogate correctly; commit
  ce893460 "same pattern as dive" claim independently verified true).
- S6 Monthly Synthesis: INTACT (today's fix present + correct; parent-share
  ownership check independent and correct).
- S7 Leaderboard: INTACT but carries RLS-safe client-side re-aggregation
  dead-weight (leaderboard/page.tsx:168-239) — same class as
  ProgressSnapshot.tsx (discovery ch.07). [S3 cleanup]

## Data-integrity (salvaged from D-5, D-7 children)
- D-5 soft-delete honoring: **UNPROVEN / two gaps.** 7/10 reader surfaces
  honor is_active. Gaps: (1) `src/app/api/quiz/route.ts:155-171` has NO
  is_active/account_status gate — soft-deleted student w/ valid JWT can
  start/submit server-side [S2]; (2) `students` RLS encodes no is_active
  predicate — deactivation correctness is app-layer only [S2 defense-in-depth].
  Deletion = soft on students row + hard-delete of ~18 dependent tables
  (incl class_students, guardian_student_links). Separate DPDP 30-day erasure
  flow also exists.
- D-7 RAG RPCs: 4 of 6 dead/test-only (search_rag_chunks DEAD,
  hybrid_rag_search TEST-ONLY, get_rag_chunks_for_node + get_rag_context_for_adaptive
  DEAD pair w/ EXECUTE already revoked). Live: match_rag_chunks_ncert,
  select_quiz_questions_rag, match_rag_chunks. Note: match_rag_chunks_v2
  fallback is dead-on-arrival (v2 never migrated). [S3 dead-code]
- STILL NEEDED (data-integrity re-spawn): D-1/D-6 FK constraints, D-2 backup
  tables PII liability, D-3 mass_gen_log RLS-no-policy annotation, D-4 grade
  P5 sweep.

## api-contract (agent-written, see 11-api-contracts.md) — key confirmed bugs
- C-6: server anti-cheat **Check 3 is a tautological dead no-op**
  (jsonb_array_length <> v_total can never fire; server never sees served
  count) — P3 partial failure. [HIGH]
- C-6: anti-cheat Check 2 denominator blind spot (misses all-same when any
  question left blank). [MED]
- C-1: `ff_atomic_subscription_activation` (P11) + 3 other live-read flags
  seeded ONLY under _legacy/ → default OFF in fresh envs (DR/new staging). [MED]
- C-3: {success,data} envelope un-modelled in openapi/v2 for 10/12 routes
  (mobile Dart codegen risk); /v2/today payload drift. [MED]
- C-2 mobile constants, C-4 TS↔SQL literals, C-5 page↔API surrogate-id:
  all MATCH/CLEAN (refute prior "unverified" flags). Good news.
