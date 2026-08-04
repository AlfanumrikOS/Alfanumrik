# Foxy North-Star Alignment — Full-Stack Implementation Spec, Traceability Matrix & Build Tracker

- **Date**: 2026-08-05
- **Status**: APPROVED — CEO full approval, no conditions (2026-08-05). Approvals A1-A7 all granted (§5).
- **Owner**: orchestrator (program); per-record owners in the tracker.
- **Tracker (single source of truth for build state)**: `docs/trackers/foxy-north-star/tracker.json` — 79 requirement records (S1.1-S1.8, D1-D12, PR1-PR6, T1-T2, P1-P11, E1-E6, L1-L7, U1-U11, K1-K9, R1-R7). Status advances only when the analyzer (`scripts/foxy-alignment/analyze.mjs`, Phase T0) passes for that record.
- **Owning agents**: architect (DB/RLS/flags/CI), backend (API/EF/RPC wiring), frontend (pages/packages-ui), ai-engineer (foxy pipeline, quiz-generator, prompts, gateway), assessment (scoring/XP/pedagogy rules), mobile (Flutter contract parity), ops (docs/admin/analyzer governance), testing + quality (verify).
- **Product invariants in scope**: P1-P6 (score/XP/anti-cheat/atomic submit/grades/question quality), P7 (bilingual), P8 (RLS), P9 (RBAC), P10 (bundle budget), P12 (AI safety), P13 (data privacy), P14 (review chains), P15 (onboarding untouched).

---

## 0. Context and how to read this spec

The CEO issued the Foxy product spec (7 sections, 8 subsystems). This spec maps EVERY requirement in that spec to (a) what exists today (verified file paths), (b) the gap, (c) exactly what will be built at each layer — DB, backend/Edge, middleware, frontend, mobile — planned simultaneously per workstream. Governance: a machine-readable TRACKER + ANALYZER is the FIRST artifact built after approval; it enforces completion, quality gates, and the no-duplicate rule for every requirement ID below.

Status legend: [LIVE] exists and running · [DARK] exists but flag-OFF/unwired · [PART] partial · [MISS] missing.
Ground truth from 3 codebase audits + direct file verification (2026-08-04).

Layer key: DB = supabase/migrations + RPCs · BE = apps/host/src/app/api + supabase/functions · MW = apps/host/src/proxy.ts (global auth/rate-limit/flags — new API routes inherit it; rows say "inherit" unless a change is needed) · FE = apps/host/src/app + packages/ui · MOB = mobile/ (Flutter, additive-contract rule).

---

## 1. REQUIREMENT TRACEABILITY MATRIX

### 1.1 Spec §1 — Eight Foxy Subsystems

| Req | Subsystem | Status | Exists today (paths) | Gap → Build (layers) |
|---|---|---|---|---|
| S1.1 | Foxy Memory | DARK | 4 layers: packages/lib/src/learn/foxy-long-memory.ts; foxy-expectations.ts + foxy_pending_expectations; learner_twin_memory + build-twin-context.ts; apps/host/src/lib/memory/student-memory.ts (unified read, DPDP erasure fail-closed); memory/preferences.ts (READ-ONLY) | Flags OFF; no preference writer; unresolved-misconception lifecycle not persisted (student_misconceptions has NO writer). DB: writer path + resolve/unresolve columns wired. BE: memory writes inside turn/submit pipeline. FE: transparency screen (S2.4). Staged flag enablement. |
| S1.2 | Learner Model | LIVE core | concept_mastery (87 readers) written ONLY by update_learner_state_post_quiz (20260623000100) inside atomic submit; theta trigger on quiz_responses | 6 parallel stores (3 writerless); missing uncertainty/evidence-quality/hinted-vs-independent params. Build: read facade packages/lib/src/learner-model/ + additive columns + consolidation (§1.3 P-table). |
| S1.3 | Adaptive Planner | LIVE part | deriveNextAction 5-tier ladder (api/foxy/_lib/cognitive-context.ts); daily-rhythm-orchestrator.ts; adaptive loops A-D cron | Missing top 2 spec tiers (safety hold, teacher-assigned work); not behind facade. BE: extend ladder reading assignments; expose via facade only. |
| S1.4 | Foxy Teacher | DARK | Teaching strategies in packages/lib/src/foxy/prompt-sections.ts (1536 LOC); teaching-director.ts (680, pure, flag OFF); 5-mode pedagogy tree AS PROMPT TEXT grounded-answer/prompts/inline.ts:33-61; thresholds 0.4/0.7 duplicated | Promote director code over prompt text; REAL 5-rung hint ladder (S4.5); single threshold source in facade. |
| S1.5 | Foxy Companion | PART | SEL check-in (mood only, un-routed) at foxy/page.tsx:2003; forgiving weekly streak (weekly-streak.ts, no-shame); mastery-band-labels.ts bans harsh copy | CASEL mapping module; mood → routing (S5.6); anti-dependency guardrails codified (currently prompt-only). New small module packages/lib/src/companion/. |
| S1.6 | Play Engine | PART | /dive (weekly curiosity), /synthesis (monthly), /challenge, /simulations, Foxy explorer mode | Missions/mysteries/teach-Foxy-back/student-vs-Foxy puzzles absent as a system. Build mission framework ON the dive/challenge substrate (no new engine, no new XP paths outside xp-config). |
| S1.7 | Foxy Guardian | PART | curriculum-scope.ts (505, fail-closed T1-T4); input-guard (injection); output-screen (FOX-1); quota (DB-authoritative); grade-spoof block | MISS: self-harm/abuse safeguarding escalation + human routing (verified zero hits for safeguard/crisis/helpline). Build S5.6 — Phase 1. |
| S1.8 | Evidence Engine | PART | foxy_served_items (server-held answer keys); quiz-me-oracle-gate.ts; evidential-quiz.ts; quality-eval.ts; foxy-report.ts (admin-only) | No student-facing Close ("what improved and why" — S4.7); no teacher evidence citations (S6.1); parent evidence partial. |

### 1.2 Spec §2 — Data Strategy and Guardrails

Per-interaction learning-event fields (spec: record every relevant learning event):

| Req | Field | Status | Exists today | Build (DB / BE / FE) |
|---|---|---|---|---|
| D1 | Concept attempted | LIVE | quiz_responses.topic_tag + question_id; concept_check events | none |
| D2 | Question + content version | MISS | options_version + SHA256 snapshot exist in quiz_session_shuffles (REG-53) but not on the response row | DB: additive quiz_responses.question_version + content_hash REUSING REG-53 snapshot infra. BE: write-through in submit chain. |
| D3 | Correctness + answer method | PART | is_correct LIVE; method (mcq/typed/voice/scan) not recorded | DB: additive answer_method enum. BE: set per source (quiz, foxy quiz-answer, voice, scan). |
| D4 | Response time | LIVE | time_taken_seconds; responseTimeMs; avg_response_time_ms | none |
| D5 | Hints requested | PART | UI tracks hintLevel; DROPPED before persistence | DB: additive quiz_responses.hint_level. FE: pass through submit payload. = Phase 0 defect fix. |
| D6 | Confidence reported | MISS | ZERO capture anywhere (verified) | DB: additive confidence smallint NULL. FE: 1-tap sampled prompt (packages/ui; quiz + FoxyPanel). BE: event field. Non-blocking. |
| D7 | Misconception demonstrated | PART | question_misconceptions (per-question, curated) joined at read time; error_type live; student_misconceptions WRITERLESS | DB: additive quiz_responses.misconception_id. BE: writer for student_misconceptions (resolve lifecycle) in submit chain + remediation outcome. |
| D8 | Explanation format used | PART | Foxy structured blocks exist; recommendedModality is system-derived | BE: log format per Foxy turn in event payload; aggregate into D9 preferences. |
| D9 | Language + modality preference | PART | students.preferred_language live; learning_style / preferred_explanation_depth READ-ONLY, no writer | BE: preference writer (D8 aggregates + explicit settings). FE: settings control. DB: none (columns exist). |
| D10 | Revision history | LIVE | review_graded events; spaced_repetition_cards; review_count / next_review_at | none |
| D11 | Teacher assignments + feedback | LIVE | assignment_submissions.teacher_feedback/score; teacher_student_notes; teacher.submission_reviewed | Ingest as governed evidence into planner tier (S1.3). |
| D12 | Retention + transfer evidence | PART | Retention LIVE (current_retention, ease, half-life). Transfer MISS — concept_edges already has edge type transfer (dark) | BE: transfer-evidence check on cross-concept success once concept_edges enabled (Phase 3). |

Prohibited data and inferences:

| Req | Rule | Status | Action |
|---|---|---|---|
| PR1 | No intelligence/personality labels | PART | mastery-band-labels.ts already bans harsh copy. FIX prompt-sections.ts:749 (internal phrase: a struggling student). NEW packages/lib/src/policy/prohibited-inferences.ts — single denylist consumed by prompts + analyzer. |
| PR2 | No mental-health diagnoses | PART | Prompt rails only today. Add to policy module + safeguarding classifier boundaries (S5.6). |
| PR3 | No passive camera/mic observation | LIVE | Voice + scan are explicit user actions; no passive capture exists. Codify in policy module; analyzer guard (no getUserMedia outside explicit routes). |
| PR4 | No irrelevant private emotions | PART | SEL captures mood only. Define retention window + aggregate-only storage in the Phase 1 spec. |
| PR5 | Sensitive conversations only with safeguarding purpose | MISS | Defined by safeguarding flow (S5.6): scoped table, retention policy, access restricted to the safeguarding role only. |
| PR6 | Latent labeling columns | RISK | student_learning_profiles.learning_style / frustration_threshold currently unwritten. learning_style becomes the D9 preference store (allowed use); frustration_threshold DROPPED (column drop — approved, A4). |

Transparency principles:

| Req | Principle | Status | Build |
|---|---|---|---|
| T1 | Describe evidence, never judge identity | PART | Policy module PR1 + copy audit of all student-facing mastery surfaces; analyzer lint for banned phrases. |
| T2 | What-Foxy-remembers screen (view / correct / remove) | MISS | FE: apps/host/src/app/(student)/memory/page.tsx + packages/ui/src/memory/. BE: /api/learner/memory — read via facade + memory layers; correct = student annotation flag; remove = per-item erasure THROUGH existing memory/erasure-guard.ts + DPDP flow extended student-facing. DB: per-item erasure tombstones. MW: inherit. MOB: read-only screen in a later wave. RBAC addition (student self-access) — approved, A3. |

### 1.3 Spec §3 — Canonical Live Learner Model

Decision: the canonical model = concept_mastery + update_learner_state_post_quiz, wrapped by ONE new read facade packages/lib/src/learner-model/ (getMasteryState, getDueReviews, getNextAction, explainMastery). This satisfies the spec requirement that CME be the canonical explainable state — re-pointed onto the store that is live inside the sacred atomic chain (87 readers) instead of resurrecting the orphaned cme_* tables. cme-engine EF + cme_concept_state are retired. The facade serves Today, Learn, Practice, Exam Prep, Foxy, teacher insights and parent reporting — one shared service, exactly as the spec demands.

Per-student per-concept parameters (spec list → storage):

| Req | Parameter | Status | Today | Build |
|---|---|---|---|---|
| P1 | Mastery probability | LIVE | concept_mastery.mastery_probability + p_know | none |
| P2 | Evidence quantity + quality | PART | attempt counters live | DB: additive evidence_count, evidence_quality (weights independent vs hinted per D5/P8), computed in RPC |
| P3 | Uncertainty | MISS | mastery_variance was designed in cme_concept_state, never written | DB: additive mastery_variance on concept_mastery; RPC updates it |
| P4 | Misconceptions + prerequisite gaps | PART | knowledge_gaps LIVE; student_misconceptions writerless | Writer (D7); prereq gaps via concept_edges enablement (E5) |
| P5 | Retention strength | LIVE | retention_half_life, current_retention | none |
| P6 | Last practice / next review | LIVE | next_review_at, review_interval_days, ease_factor | none |
| P7 | Bloom / competency demonstrated | LIVE | bloom fields + BLOOM_CONFIG | none |
| P8 | Independent vs hinted performance | MISS | hintLevel dropped today | From D5 column → RPC splits independent/hinted counters |
| P9 | Preferred explanation formats | PART | columns exist, no writer | D9 writer |
| P10 | Current academic goal | DARK | ff_goal_aware_foxy exists | Wire goal into facade + planner context |
| P11 | Cognitive-load indicators | PART | updateCognitiveLoad live client-side, not persisted | Event field only (aggregate, ephemeral by default — PR4 privacy) |

Engine division of labor:

| Req | Engine role (spec) | Status | Today | Build |
|---|---|---|---|---|
| E1 | BKT/DKT updates mastery probability | LIVE | SQL in update_learner_state_post_quiz; 4 parallel BKT impls exist | Consolidate: SQL = canonical; ONE TS mirror in facade (display/preview only); delete dead cognitive-engine exports; retire queue-consumer + quiz-completion-service copies onto the facade mirror |
| E2 | IRT selects question for ability | DARK + bug | Nightly calibration LIVE (irt_a/irt_b written); selection unreachable: JSDoc comment bug quiz-generator:367-423, hardcoded useIRT=false at :1264, allowFisherInfo off | Phase 0 D1 (behavior-neutral un-comment) → Phase 3 shadow eval → cohort enable ff_irt_question_selection with kill switch; theta writer fills student_skill_state |
| E3 | CME = canonical explainable state | MISS | cme_* orphaned (no writer, no invoker) | Facade explainMastery = evidence-based explanation (P-params + reason codes). Retire cme-engine + cme_concept_state after re-pointing board-score |
| E4 | Spaced repetition decides revisits | PART | concept_mastery loop WORKS; spaced_repetition_cards loop half-open; dual-store count/content mismatch | Phase 0 close loop → Phase 3 single scheduler on canonical SM-2 (5 divergent impls → 1; params frozen at SQL RPC values) |
| E5 | Curriculum graph controls prerequisites | DARK | concept_edges 572 rows + traverse_prerequisites / detect_blocked_dependents RPCs behind ff_digital_twin_v1 (OFF); live gating only in rhythm ZPD lane | New flag ff_prereq_gating_v1; fail-open first (suggest), then enforce; wire into main quiz path + planner tier 4 |
| E6 | LLM never declares mastery | LIVE | Mastery written ONLY by the SQL chain; foxy_served_items holds answer keys server-side | Codify: facade = sole mastery API for AI paths. ANALYZER CHECK: no mastery-table writes from ai/foxy code paths |

### 1.4 Spec §4 — Moment-to-Moment Learning Loop

| Req | Stage | Status | Today | Build |
|---|---|---|---|---|
| L1 | Observe (page, concept, assignment, errors, due reviews, language) | PART | loadCognitiveContext (7 dimensions) + session context + lab context | ADD school-assignment context read (assignment_submissions) + due-review read via facade |
| L2 | Diagnose (one short question first, not a lecture) | PART | Prompt-guided only; diagnostic page separate | Codify as first director step; serve via foxy_served_items so the check is evidential |
| L3 | Decide (priority: safety/teacher > assigned work > overdue reviews > prereq gaps > progression > exploration) | PART | deriveNextAction implements the LOWER 4 tiers + exploration | ADD tier 1 (safety hold from S5.6 signal) + tier 2 (assigned work from D11); exact spec ordering; expose via facade getNextAction; unit-pinned order test |
| L4 | Teach (analogy, visual, worked example, socratic, real-world, story, simulation, vernacular, teach-back) | PART | Strategies exist in prompt-sections + code-switch policy; simulations page exists | Promote teaching-director (code twin) over prompt text; ADD teach-back activity type (S1.6); strategy choice logged (D8) |
| L5 | Check (hint ladder: gentle prompt → directional clue → partially worked step → full explanation → equivalent question) | MISS | Quiz ladder is 1 authored hint padded into 3 fake tiers; /api/foxy/remediation built but unwired | NEW ladder service packages/lib/src/learn/hint-ladder.ts REUSING: question_bank.hint (rung 1), wrong_answer_remediations per-distractor (rungs 2-3), explanation (rung 4), equivalent question via quiz-generator constraint + foxy_served_items (rung 5). Wire into quiz UI + FoxyPanel. hint_level recorded (D5) |
| L6 | Update (response → mastery/misconception/retention evidence) | LIVE | Atomic submit chain + expectations lifecycle | Extend RPC with new evidence fields (P2/P3/P8, D2/D3/D6/D7) — additive only |
| L7 | Close (what improved, what needs work, why next, when review returns) | MISS | Nothing | NEW Close stage: facade delta (what improved) + ladder reason codes (why next) + next_review_at (when back). FE: session-close card in FoxyPanel + quiz results. BE: close payload in turn pipeline |

### 1.5 Spec §5 — Student Experience and Engagement

| Req | Requirement | Status | Today | Build |
|---|---|---|---|---|
| U1 | Foxy contextual inside Today/Learn/Practice, not a destination | MISS | /foxy standalone (2,487 LOC page); 15 pages deep-link; zero embedding; /dive comment defers embed | NEW slim FoxyPanel (packages/ui/src/foxy-panel/) reusing useFoxyChat hook (1,109 LOC — already extracted, single consumer today); embed in Today, Learn, Practice; /foxy becomes thin shell on the SAME panel (deep-links keep working; NO duplicate chat code) |
| U2 | One question at a time; Hindi/English code-switching | LIVE | Prompt policy inline.ts:107-111 + isHi | Move policy into director config (single source) |
| U3 | Confusion via learning behavior, not observation | DARK | struggle-detection.ts + perception classifier (flags OFF) | Enable ff_foxy_perception_v1 staged; signals feed planner tier 1 + teacher alerts; PR3 stays enforced |
| U4 | Student actions: Show me / Explain simpler / Give a hint / Let me try | PART | got_it, explain_simpler, show_example, quiz_me exist (learning_action) | ADD give_hint (wired to L5 ladder) + let_me_try (serves evidential item); reuse learning-action route — no new endpoint |
| U5 | SEL per CASEL; normalize mistakes; celebrate persistence | PART | SEL check-in (mood only); persistence_bonus XP exists; no-shame streak | packages/lib/src/companion/ CASEL mapping (5 competencies → behaviors); reflection prompts (getReflectionPrompt exists — reuse); copy audit |
| U6 | Never diagnose, no dependency, no best-friend claims; high-risk disclosures → adult safeguarding flow (UNICEF) | MISS | Output-screen blocks directed incitement only; SEL mood un-routed; zero safeguarding flow (verified) | NEW: (a) pre-LLM disclosure classifier stage; (b) DB safeguarding_escalations table + RLS (safeguarding role only) in same migration; (c) human review lane (school-admin + super-admin page); (d) age-appropriate response template + helpline (Childline 1098); (e) SEL mood routing into the same flow; (f) anti-dependency rules in policy module + rails. Metadata-only audit (P13). Policy sign-off gates the build |
| U7 | Engagement from curiosity + visible progress, not addictive mechanics | PART | dive/synthesis/challenge/simulations exist; XP already mastery-not-presence (foxy_chat=0, streak_daily=0) | Mission framework on existing substrate (S1.6); Close stage (L7) supplies visible progress |
| U8 | XP rewards: independent mastery, retention, recovery, thoughtful questions, consistency | PART | quiz XP + zpd bonus + persistence + streak milestones LIVE; retention=0, recovery=0, independence not measurable today | ADD xp-config sources: review_graded (retention), remediation_recovered (recovery), unhinted-mastery bonus (uses D5), thoughtful-question (from existing Foxy quality-eval signal). P2 invariant — values approved via A2 (proposed at Phase 3 start). ALL constants in xp-config only |
| U9 | No XP for raw screen time | LIVE | foxy_chat = 0, streak_daily = 0 deliberately | Analyzer guard keeps it so |
| U10 | No leaderboards exposing weaker students | PART | Top-N only BUT personal absolute rank + (You) tags shown | Change personal rank display to percentile bands (top 10% etc.); keep top-N; no bottom lists (already true) |
| U11 | No monetary XP conversion until safety review | LIVE | None exists | Analyzer guard: block any xp-to-money/voucher code path |

### 1.6 Spec §6 — Stakeholder Interfaces

| Req | Requirement | Status | Today | Build |
|---|---|---|---|---|
| K1 | Students needing attention today | LIVE | needs_attention (class overview), at-risk alerts, Student Pulse (flag) | Unify into one lane WITH evidence payload (K3); enable ff_school_pulse_v1 staged |
| K2 | Class-level misconception clusters | MISS | No grouping by misconception anywhere (only super-admin per-student report) | BE: teacher-dashboard action get_misconception_clusters over student_misconceptions (post-D7 writer) grouped by misconception_code. FE: CommandCenter cluster panel. DB: none new (reuses D7) |
| K3 | Evidence behind recommendations | MISS | Alerts carry threshold numbers only | Evidence payload (event citations: attempts, hints, timestamps) attached to alerts + interventions, sourced from enriched quiz_responses/state_events; UUIDs only (P13) |
| K4 | Suggested small-group interventions | DARK | deploy_intervention action exists with NO frontend caller (documented) | FE: approval lane in CommandCenter wiring the EXISTING action; groups derived from K2 clusters |
| K5 | Draft assignments / worksheets | PART | bulk-question-gen + export-report EFs exist | Teacher draft flow reusing both (no new generator); oracle-gated output (REG-54 pattern) |
| K6 | Fast-progressing student highlights | MISS | none | Small addition to get_class_overview (positive deltas from facade) |
| K7 | Teacher approve/override Foxy; inputs = governed evidence | MISS | Only score override + alert resolve exist; autonomous loops have no approval gate | Approve/override on interventions (K4 lane); teacher.override event kind; override feeds planner tier 2 (D11); autonomy tiers documented per loop |
| K8 | Parents: everyday language, conversational prompts, no surveillance | LIVE mostly | Weekly LLM report (plain-language prompt verified) + monthly synthesis w/ fabrication oracle + WhatsApp share | ADD conversation_prompts[] field to weekly report JSON (dinner prompts); surface reports in-app: replace 15-line /parent/progress stub; NO transcript exposure (stays) |
| K9 | Leadership: competency growth, retention, coverage, safety incidents; PARAKH-style | PART | School Pulse (flag OFF); nep-compliance EF; subject_content_readiness_daily | Leadership dashboard page assembling: facade aggregates (growth/retention), syllabus coverage views (exist), safety-incident counts from safeguarding_escalations (counts only). Reuses school-admin surface |

### 1.7 Spec §7 — Technical Restructuring

| Req | Proposed service | Status | Existing implementation | Remaining work |
|---|---|---|---|---|
| R1 | Event capture + learner-state service | PART | state_events bus + 46-kind registry (publish is a no-op, flag OFF); concept_mastery + submit chain | Enable bus in shadow → live; learner-model facade = the learner-state service (in-process package, not a network hop) |
| R2 | Curriculum/context retrieval + adaptive recommendation | LIVE | grounded-answer EF (14k LOC: RAG, Voyage rerank-2, RRF k=60, confidence scoring); deriveNextAction + select-adaptive-questions | Recommendation moves behind the facade; retrieval untouched |
| R3 | Pedagogical orchestrator + model router | PART | teaching-director.ts (pure, flag OFF); pedagogy tree as prompt text; model routing EXISTS x3 (ai/gateway TS, _shared/mol Deno, python mol shadow) | Composition root: decompose handleFoxyPost (one ~2,800-line function) into named typed stages = the spec loop L1-L7; director ON; consolidate routing to ONE gateway (retire 2 duplicates — the no-duplicate rule applies to our own stack too) |
| R4 | Safety service + conversation/session service | PART | input-guard, output-screen, curriculum-scope, quota; _lib/session.ts + 4 tables | Safeguarding stage (U6) joins the safety chain as stage 1; session service stays |
| R5 | Evidence validator + teacher escalation | PART | oracle gates, foxy_served_items, anti-fake-quiz-claim | Teacher escalation lane from safeguarding + K4 approval flow |
| R6 | Analytics + observability | PART | foxy_quality_scores, telemetry, PostHog, Sentry, struggle telemetry | TRACKER/ANALYZER (section 3) + per-stage timing/outcome metrics emitted by the composition root |
| R7 | Multi-model: open models routine, stronger for hard reasoning | LIVE | OpenAI-primary chain gpt-4o-mini → gpt-4o → Haiku → Sonnet (since 2026-08-02); task-typed routing matrices | Consolidation only (R3); provider strategy unchanged — secondary to pedagogy fixes, per spec |

---

## 2. FULL-STACK BUILD PLAN BY PHASE (all layers planned simultaneously)

Execution model: within each phase, DB + BE + MW + FE + MOB workstreams run IN PARALLEL by different owning agents (architect / backend / frontend / mobile / ai-engineer / assessment), integrate behind a feature flag, then testing → quality verify. No waterfall.

### Phase T0 — Tracker + Analyzer (FIRST deliverable after approval; ~2 days)
| Layer | Work |
|---|---|
| Repo | docs/trackers/foxy-north-star/tracker.json seeded with EVERY Req ID in section 1 (S1.x, D1-12, PR1-6, T1-2, P1-11, E1-6, L1-7, U1-11, K1-9, R1-7) with status/owner/PR/tests/flags/review-chain fields |
| Scripts | scripts/foxy-alignment/analyze.mjs + npm script foxy:analyze (10 checks — section 3) |
| CI | Read-only analyzer job added to the existing CI pipeline; fails the gate on conformance regression |
| Docs | docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md = this plan committed as the governing spec |

### Phase 0 — Latent defect fixes (parallel, each ships alone; ~1-2 wks)
| ID | Fix | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|---|
| F1 | IRT code out of the comment block, still flag-gated (behavior-neutral) | — | quiz-generator EF | — | — | — |
| F2 | Close the SRS grade loop in quiz srs mode (call the EXISTING grade route) | — | — | — | quiz page | — |
| F3 | SRS count + content from the same store | — | — | — | DailyRhythmQueue | — |
| F4 | Real mastery into classifyError (drop hardcoded 0.5) | — | — | — | quiz page | — |
| F5 | foxy_sessions.mode CHECK 4 → 9 modes | migration | — | — | — | — |
| F6 | board-score re-point to concept_mastery | — | board-score EF | — | — | — |
| F7 | DueSm2Card carries SM-2 fields (additive) | — | rhythm adapters | — | — | contract-safe |
| F8 | Persist hint_level (D5) | additive column | submit chain | — | quiz payload | additive |
| F9 | Fix self-contradictory IRT flag registry doc | — | — | — | — | — |
| F10 | Freeze canonical SM-2 params = SQL values; align live writers | — | QuizResults insert path | — | — | — |

### Phase 1 — Safety + Trust (U6, T2, PR1-6; ~3-4 wks)
| Workstream | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|
| Safeguarding flow (U6) | safeguarding_escalations table + RLS + safeguarding role grant (same migration); retention policy columns | Disclosure classifier stage (pre-LLM, in foxy pipeline); routing worker; notifications to designated adults per policy | inherit (route auth via existing RBAC) | Human review lane (school-admin + super-admin page); age-appropriate student response UI w/ Childline 1098 | Same classifier server-side → applies to mobile chat automatically |
| Transparency screen (T2) | per-item erasure tombstones | /api/learner/memory (read facade + layers; annotate; erase via erasure-guard) | inherit | (student)/memory page + packages/ui/src/memory/ | later wave (read-only) |
| Policy module (PR1-6, U6 anti-dependency) | frustration_threshold drop (approved, A4) | prompts consume policy denylist | — | copy audit fixes | — |

### Phase 2 — Canonical Learner Model + events (P1-11, E1, E3, D2-D9, R1; ~4-6 wks)
| Workstream | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|
| Facade (E3) | — | packages/lib/src/learner-model/ (getMasteryState/getDueReviews/getNextAction/explainMastery); migrate high-value readers | — | Today/Learn/Progress consume facade types | contract unchanged (server-side) |
| Model params (P2,P3,P8) | additive cols: evidence_count, evidence_quality, mastery_variance | RPC extension (additive) in submit chain | — | — | — |
| Algorithm consolidation (E1,E4) | — | delete dead cognitive-engine exports; retire BKT copies; retire cme-engine EF + cme_concept_state; topic_mastery → rollup view | — | re-point 2 topic_mastery readers | — |
| Event capture (D2,D3,D6,D7; R1) | additive quiz_responses cols: question_version, content_hash, answer_method, confidence, misconception_id | bus ON in SHADOW; student_misconceptions writer; verify learner_mastery projection vs canonical then promote-or-delete | inherit | confidence 1-tap UI (sampled); submit payload fields | additive payload fields (backward-compatible) |
| Preferences (D8,D9,P9) | — | preference writer from turn formats + settings | — | settings control | settings parity later |

### Phase 3 — Adaptive selection + Check loop (E2,E4,E5, L5, U4, U8, D12; ~4-6 wks)
| Workstream | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|
| IRT enable (E2) | — | shadow Fisher-info logging → offline eval → cohort flag flip w/ kill switch; theta writer for student_skill_state | — | — | — |
| Prereq gating (E5, D12) | — | ff_prereq_gating_v1; graph reads in quiz path + planner tier 4; transfer-evidence check | — | fail-open suggest UI in quiz setup | — |
| SRS unification (E4) | — | single scheduler on canonical SM-2; retire dual store reads | — | one SRS lane source | — |
| Hint ladder (L5, U4) | — | hint-ladder service; wire remediation endpoint; equivalent-question rung via quiz-generator + served items | inherit | ladder UI in quiz + FoxyPanel; give_hint + let_me_try actions | ladder via same API |
| XP additions (U8) | xp_transactions source CHECK widen (additive) | award paths in existing grade/remediation/quality flows | — | XP toasts reuse | additive |

### Phase 4 — Orchestrator + contextual Foxy (L1-L7, R3, U1; ~5-7 wks)
| Workstream | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|
| Composition root (R3) | — | handleFoxyPost → named typed stages (Observe/Diagnose/Decide/Teach/Check/Update/Close); characterization tests first; golden-transcript diff | — | — | no contract change |
| Decide ladder (L3) | — | safety-hold + assigned-work tiers; facade getNextAction | — | — | — |
| Director ON (L4) | — | code twin replaces prompt tree; single 0.4/0.7 source | — | — | — |
| Router consolidation (R3) | — | ONE gateway; retire 2 duplicate routers (approved, A5) | — | — | — |
| FoxyPanel embed (U1) | — | — | inherit | packages/ui/src/foxy-panel/ reusing useFoxyChat; embed Today/Learn/Practice; /foxy = thin shell; dynamic import, per-route bundle budget | panel parity wave |
| Close stage (L7) | — | close payload (facade delta + reason codes + next review) | — | close card in panel + quiz results | same API |

### Phase 5 — Stakeholders + Play (K1-K9, S1.5, S1.6; ~4-5 wks)
| Workstream | DB | BE | MW | FE | MOB |
|---|---|---|---|---|---|
| Teacher clusters + evidence (K2,K3,K6) | — | get_misconception_clusters + evidence payloads in teacher-dashboard EF | inherit | CommandCenter cluster panel + evidence drawer | — |
| Approve/override (K4,K7) | teacher.override event kind | wire deploy_intervention; override feeds planner | — | approval lane UI | — |
| Parent (K8) | — | conversation_prompts[] in weekly report JSON | — | /parent/progress real page surfacing existing reports | parity |
| Leadership (K9) | — | counts-only safety metrics; facade aggregates | — | leadership dashboard on school-admin surface | — |
| Play + SEL (S1.5,S1.6,U5) | mission defs reuse dive tables | mission framework on dive/challenge substrate; teach-back activity | — | mission UI; CASEL reflection prompts | later wave |
| Leaderboard bands (U10) | — | percentile calc in leaderboard routes | — | bands display replaces absolute rank | parity |

---

## 3. TRACKER + ANALYZER (governance — built FIRST, Phase T0)

### 3.1 Tracker — docs/trackers/foxy-north-star/tracker.json (single source of truth)
One record per Req ID from section 1. Schema per record:
- reqId, title, specSection, phase, status: planned | in_progress | built | tested | verified | shipped
- layers: { db: [migrations], backend: [paths], middleware: [paths|inherit], frontend: [paths], mobile: [paths|n-a] }
- owner (agent), prs [], tests [], regressionIds [], flags [{name, requiredState}], reviewChain: { required [], completed [] }, lastVerified (date), evidence [file:line]

Rules: the implementing agent updates the tracker record IN THE SAME PR as the code; quality agent rejects a PR whose touched Req ID paths have no tracker update; status may only advance when the analyzer passes for that record. A generated STATUS.md report (clearly marked generated — never hand-edited, so no duplicate source) renders the dashboard.

Seed state (2026-08-05): 10 records verified as pre-existing LIVE with no build needed — D1, D4, D10, D11 (capture exists; planner-ingest half tracked under L3), P1, P5, P6, P7, R2 (retrieval live; recommendation move tracked under E3/L3), R7 (multi-model live; consolidation tracked under R3). The remaining 69 records are seeded planned.

### 3.2 Analyzer — scripts/foxy-alignment/analyze.mjs (npm run foxy:analyze)
Follows the house pattern of scripts/check-bundle-size.mjs + verify-hook-patterns.sh (assert against the real tree, never trust prose). Ten checks:
1. COVERAGE: every Req ID in this spec exists in tracker.json; no record deleted.
2. ARTIFACTS: every record with status built+ has all listed layer paths existing on disk (Glob).
3. TESTS: every record with status tested+ lists test files that exist; regressionIds resolve in the regression catalog shards.
4. REVIEW CHAINS: completed reviewers cover required reviewers (P14) before status verified.
5. FLAG POSTURE: each flag state in feature-flag matrix matches the stage the tracker claims (e.g. shadow means flag OFF in prod envs).
6. NO-DUPLICATE (code): exactly ONE implementation each for BKT, SM-2, IRT selection, model gateway outside the canonical allowlist (grep signatures: bktUpdate|sm2|easeFactor|selectModelChain definitions); fails on any new copy.
7. NO-DUPLICATE (schema): no new tables matching mastery|misconception|memory patterns outside the approved list; retired tables (cme_concept_state, topic_mastery) gain NO new readers.
8. INVARIANT GUARDS: XP sources only in xp-config; no mastery-table writes from ai/foxy paths (E6); no xp-to-money code path (U11); no getUserMedia outside voice/scan routes (PR3); banned-phrase lint on student-facing copy (T1).
9. WRITERLESS WATCH: tables in the retire list must show zero readers by their phase deadline; tables in the writer-needed list (student_misconceptions, student_skill_state) must gain writers by their phase.
10. STALENESS: any record in_progress with no PR activity in 14 days is flagged in the report.

Wiring: read-only job in the existing CI pipeline (fails the CI gate on regression of checks 1-9); quality agent runs it before every commit; weekly status report = analyzer output + tracker dashboard, in the standard report format.

## 4. NO-DUPLICATE POLICY (binding on every phase)
1. Extend canonical modules in packages/lib — never copy into apps/host (re-export stubs stay 2-line).
2. Shared UI only in packages/ui; FoxyPanel REUSES useFoxyChat — the chat protocol is never re-implemented.
3. One constants source per domain: XP=xp-config; thresholds=facade; SM-2 params=SQL RPC (mirror generated, marked).
4. Reuse-first rule recorded in tracker per record (the Build columns above name the reused asset explicitly).
5. We also RETIRE existing duplicates: 4 BKT → 1, 5 SM-2 → 1, 3 model routers → 1, dual SRS stores → 1, cme_* → facade.
6. Enforcement: analyzer checks 6-7 + existing hooks (guard.sh ownership, post-edit-check).

## 5. APPROVALS (constitutional gates — ALL GRANTED)
| # | Item | Why approval | Default in this plan | Decision |
|---|---|---|---|---|
| A1 | Safeguarding policy: who is notified, when; data retention | Child-safety policy, P13 | Design spec first; human-in-the-loop; no auto parent notify | APPROVED 2026-08-05 (full approval, no conditions) |
| A2 | XP values for retention/recovery/independence/thoughtful-questions | P2 invariant | Proposed at Phase 3 start, constants only in xp-config | APPROVED 2026-08-05 (full approval, no conditions) |
| A3 | Student self-access RBAC (memory screen + DPDP entry) | RBAC addition | Read + per-item erase only | APPROVED 2026-08-05 (full approval, no conditions) |
| A4 | frustration_threshold column drop | Column drop | Drop (PR6) | APPROVED 2026-08-05 (full approval, no conditions) |
| A5 | Model-router consolidation | AI-model constraint | Single gateway, chains unchanged | APPROVED 2026-08-05 (full approval, no conditions) |
| A6 | IRT cohort enablement | Dormant-flag unpin | Only after shadow eval gate passes | APPROVED 2026-08-05 (full approval, no conditions) |
| A7 | Leaderboard percentile bands replace absolute rank | Product surface change | Bands (spec-conformant) | APPROVED 2026-08-05 (full approval, no conditions) |

## 6. RISKS AND MITIGATIONS
| Risk | Mitigation |
|---|---|
| Sacred atomic submit chain | Additive-only RPC extension; shadow-verify projections; never dual-write from app code |
| Mobile contract | Additive-only fields; mobile agent in every shared-endpoint review chain; contract tests |
| Regression pins (321) | SM-2 canonical = current SQL values (no live behavior change); pins updated only where divergent copies were live |
| Bundle cap 289KB vs FoxyPanel embed | Dynamic import; per-route budget line in the bundle gate |
| IRT quality | Shadow → offline eval → cohort → kill switch; F1 is behavior-neutral |
| Safeguarding false pos/neg | Conservative thresholds, human review, staged rollout, policy sign-off first |
| Event-bus write amplification | Shadow + sampling; publish failure never blocks submit |
| Coverage ratchet on dead-code deletion | Quality-coordinated ratchet change in the same PR |

## 7. VERIFICATION
- Every phase: type-check, lint, full vitest, build, bundle gates + analyzer green before merge.
- Every Req ID: tests listed in tracker; behavior pins added to the regression catalog; review chain per P14 recorded.
- Flag flips only with logged shadow evidence; each enablement has a kill switch and a runbook.
- Weekly: analyzer + tracker dashboard = the progress report (built without fail = check 10 staleness alarm).
