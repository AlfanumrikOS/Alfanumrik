# AI Systems Inventory — Discovery (2026-07-02)

Read-only inventory. Owner: ai-engineer. Scope: Foxy, AI Edge Functions, cognitive/adaptive
stack, RAG infra, prompts, dependency graph, ownership/gaps. No code changed.

---

## 1. Foxy (`src/app/api/foxy/route.ts` + `_lib/`)

Foxy is a **Next.js API route** (not an Edge Function — `foxy-tutor` Edge Function was
retired 2026-07-01). It shells out to the Deno Edge Function `supabase/functions/grounded-answer/`
for the actual LLM call. Route responsibilities vs. grounded-answer responsibilities are split
explicitly in the route's file header.

### 1.1 Route responsibilities (`route.ts`, 2472 lines)
RBAC auth (`foxy.chat`), P12 grade-spoof hard-block (claimed grade vs. `students.grade`),
subject governance (`validateSubjectWrite`), global AI kill switch (`ai_usage_global`),
daily quota (atomic RPC + refund-on-failure), session continuity (`foxy_sessions`),
cognitive-context loading (CME tables, digital twin, topic progression), multi-turn history,
prompt-injection neutralization (input-side, `FOX-2`), structured-output defense-in-depth
validation (`FOX-1`, output-side), persistence to `foxy_chat_messages`, audit logging,
upgrade-prompt computation. Extracted into co-located `_lib/` modules (H1 refactor):
`constants.ts`, `quota.ts`, `session.ts`, `cognitive-context.ts`, `legacy-flow.ts`,
`responders.ts`, `streaming.ts`, `test-surface.ts`.

### 1.2 Modes
`VALID_MODES = ['learn', 'explain', 'practice', 'revise', 'doubt', 'homework', 'explorer']`
(`_lib/constants.ts`). Mode → prompt template mapping (`selectFoxyPromptTemplate`, route.ts:407):

| Mode(s) | Prompt template | Notes |
|---|---|---|
| `learn`, `explain`, default/unlisted | `foxy_tutor_teach_v1` | Socratic Step Cards only |
| `practice` | `foxy_tutor_exam_v1` | CBSE marks-based format only |
| `doubt`, `homework` | `foxy_tutor_doubt_v1` | direct Q&A only |
| (legacy) | `foxy_tutor_v1` | preserved fallback; had 3 conflicting output-format sections (RCA-FIX RC-1, 2026-06-26) — root cause of prior inconsistent answers |

Separate **coach modes** (Phase 2.2, distinct from UI mode): `answer` | `socratic` | `review`,
resolved from mastery level + explicit request + recent 👎-feedback streak
(`resolveCoachMode`, `src/lib/foxy/prompt-sections.ts`).

Separate **coach directives** (post-answer re-teach buttons): `simplify` | `example` | `quiz_me`.
`quiz_me` forces `mode='practice'` + `SINGLE_MCQ_DIRECTIVE` and is oracle-gated before display
(never streamed — see 1.5).

### 1.3 Model
Resolved by `supabase/functions/grounded-answer/claude.ts`, NOT literally "Claude Haiku only":
- `HAIKU_MODEL = 'claude-haiku-4-5-20251001'`
- `SONNET_MODEL = 'claude-sonnet-4-20250514'`
- `GPT_MINI_MODEL = 'gpt-4o-mini'` (OpenAI fallback)
- `GPT_FULL_MODEL = 'gpt-4o'` (OpenAI fallback)

`model_preference: 'auto'` (route.ts:1534) → fallback order: Haiku → Sonnet → gpt-4o-mini →
gpt-4o. OpenAI only activates if the Anthropic call fails (timeout/5xx/auth) — comment in
`claude.ts:227-232` states the Foxy system prompt/JSON contract/pedagogy tree are "calibrated
for Claude behavior" and GPT models "receive the same prompt verbatim which causes format/
persona deviations." Temperature is hardcoded `0.3` for all Foxy calls (route.ts:1536) —
no mode currently uses 0.7 in the live Foxy path, despite the skill doc's 0.3/0.7 factual/
motivational split. `max_tokens: MODE_MAX_TOKENS[mode] ?? 1024`.

**Finding**: the constitution/skill docs describe Foxy as "Claude Haiku" single-model; the
live code has a 4-way Anthropic→OpenAI fallback chain plus a parallel provider stack in
`_shared/mol/` (Model Orchestration Layer — `providers/anthropic.ts`, `providers/openai.ts`,
`router.ts`, `classifier.ts`) used by other MoL-integrated flows. This is a **doc/code drift**
worth flagging to quality/architect, not a defect — the OpenAI fallback is a safety net, not a
routing change requiring user approval per P12's "AI model or provider changes" gate (it's
existing shipped behavior, not a new change).

### 1.4 RAG pipeline stages (`supabase/functions/grounded-answer/` + `_shared/rag/retrieve.ts`)
Single retrieval per turn (REG-50 pin, comment at route.ts:1728: "Single retrieval:
grounded-answer service handles embed+RRF+rerank"):

1. **Embedding** — Voyage `voyage-3`, 1024-dim, via `_shared/rag/retrieve.ts::callVoyageEmbedding`.
   Query is optionally expanded with chapter title before embedding only (`expandQueryWithChapterTitle`,
   Phase 2.B Win 3) — rerank/FTS still see the original query.
2. **Retrieval (RPC)** — `match_rag_chunks_ncert`, RRF (Reciprocal Rank Fusion, k=60) hybrid
   vector+FTS. `score = 1/(60+rank_vec) + 1/(60+rank_fts)`, theoretical max ≈ 0.0328
   (`RRF_THEORETICAL_MAX`). Scope-filtered by grade/subject/chapter server-side.
3. **Scope verification (defense in depth)** — TS-side re-check of `grade_short`/`subject_code`/
   `chapter_number` on returned rows (in case RPC scope filter regresses).
4. **Rerank** — Voyage `rerank-2` (model id corrected from stale `voyage-rerank-2`, a prior
   silent-failure bug) over an over-fetched candidate set (`RERANK_DEFAULT_FETCH = 40`,
   raised from 30 — Phase 2.B Win 1).
5. **MMR diversity** — `applyMMR(chunks, 0.7)` (`_shared/rag/mmr.ts`) applied to the reranked
   top-N only when rerank actually ran (Phase 2.B Win 2).
6. Similarity floor: `STRICT_MIN_SIMILARITY = 0.012`, `SOFT_MIN_SIMILARITY = 0.005` — calibrated
   for the RRF scale (pre-2026-05-10 these were 0.75/0.55, a cosine-similarity-era holdover that
   caused 110/110 traces to retrieve 0 chunks; documented as an audit finding in `config.ts`).
7. Retrieved chunks are injected into the system prompt as citations; `sources`/`diagrams` are
   persisted to `foxy_chat_messages` but **never echoed to the client wire** (Phase 0 decision,
   route.ts header comment).

`RAG_MATCH_COUNT = 5` (final chunk count after rerank/MMR).

### 1.5 Caching
- **Response cache** (`grounded-answer/cache.ts`): in-memory LRU, 500 entries, 5-min TTL,
  keyed by `sha256(query + scope + mode)`. Only caches `grounded:true` responses (abstains
  vary by live upstream state). Cache hits skip trace-row writes.
- **Embedding cache** (`_shared/embeddings.ts`): separate 1-hour TTL / 500-entry LRU keyed
  by a non-cryptographic `simpleHash` of input text — used by the batch/admin embedding
  generators (`generate-embeddings`, `embed-questions`, etc.), not by the live retrieval path
  in `_shared/rag/retrieve.ts` (which has no embedding cache of its own).
- Anthropic **prompt caching** (`cache_control: ephemeral`) wraps the system-prompt block on
  every Claude call in `grounded-answer/claude.ts` — ~5 min server-side cache of the (large,
  3-6k token) system prompt prefix.

### 1.6 Usage limits per plan
`_lib/constants.ts::DAILY_QUOTA`: `free: 10, starter: 30, pro: 100, unlimited: 999999`.
**Discrepancy vs. the ai-integration skill doc**, which states "Per plan: 5/30/unlimited" —
the skill doc is stale; the live numbers are 10/30/100/unlimited(999999), enforced via
`checkAndIncrementQuota` (an atomic RPC) in `_lib/quota.ts`, with `refundQuota` called on
upstream failures per `REFUND_ABSTAIN_REASONS` (`upstream_error`, `circuit_open`,
`chapter_not_ready`). Upgrade-prompt thresholds are separately defined per plan
(`UPGRADE_PROMPTS`).

Per-plan **timeout budgets** (`grounding-config.ts` / `grounded-answer/config.ts`,
`PER_PLAN_TIMEOUT_MS`): free 20s, starter 35s, pro 55s, unlimited 75s.

### 1.7 Safety guards (P12)
- **P12 grade-spoof hard block**: claimed `grade` in the request body is validated against
  `students.grade` (normalized via `resolveFoxyEnrollmentScope`) BEFORE any prompt/RAG/LLM
  work; mismatch → 403 + audit log (`foxy.grade_spoof_attempt`). Null-grade + onboarded = spoof.
- **Zod schema** (`FoxyRequestBodySchema`) locks `grade` to the 7 CBSE grade strings at the
  request boundary.
- **STEM curriculum hard pre-gate** (`validateCurriculumScope`, `grade_only` mode) — runs
  before any LLM call for STEM subjects, flag-gated (`ff_foxy_curriculum_guard_v1`).
- **FOX-2 input guard** (`neutralizeInjectionAttempt`) — strips assistant-directed override
  phrases from the student's message before it is sent to the model (persisted content is
  the original, unmodified message).
- **FOX-1 output screen** (`screenStudentFacingText` / `_shared` output-screen.ts) — a
  deterministic, word-boundary-matched profanity/injection-token backstop calibrated
  specifically to NOT over-block legitimate CBSE vocabulary (`class`, `shell`, `sexual
  reproduction`, etc.) — documented at length in `output-screen.ts` as the FOX-1 fix for a
  prior gap where the live grounded path had no deterministic backstop (only prompt rails).
- **Structured-output defense-in-depth** (`extractValidatedStructured`) — validates the
  upstream `FoxyResponse` JSON shape before persisting/serving it.
- **Quiz-me oracle gate** (`gateQuizMeMcq`) — same P6/REG-54 oracle used for `question_bank`
  inserts, applied to inline "Quiz me" MCQs before they are shown; fails closed on grader
  unavailability.
- **Circuit breaker** (`grounded-answer/circuit.ts`) — 3-state (closed/open/half-open),
  keyed `${caller}|${subject_code}|${grade}`, trips after 3 failures in 10s, opens 30s, needs
  2 consecutive probe successes to close. Bounded to 1000 entries with idle-pruning + LRU
  eviction. **This is the only circuit breaker found in the AI stack** — see gaps (§7).
- **Global AI kill switch** (`ai_usage_global` feature flag) — halts all Claude calls across
  foxy/ncert-solver/quiz-gen/scan-solve without redeploy; 503 + `Retry-After: 60`.

### 1.8 Streaming
SSE via `handleStreamingFoxyTurn` (`_lib/streaming.ts`), gated by `ff_foxy_streaming` AND
`body.stream === true`. "Quiz me" is **forced off the streaming path** (oracle gate needs the
full structured payload before display — streaming ships text deltas before the gate can run).
`grounded-answer/claude.ts::callClaudeStream` mirrors the non-streaming fallback order but
commits to the first model once any token has shipped (no mid-stream model switch).

### 1.9 Other `/api/foxy/*` routes
| Route | Purpose |
|---|---|
| `feedback/route.ts` | Per-message 👍/👎 persistence (`foxy_message_feedback`); trust boundary re-checks student ownership server-side. |
| `quiz-answer/route.ts` | Grades evidential "Quiz me" MCQs through the sanctioned `tutor_commit_attempt` mastery path (0 XP; mastery is the reward). |
| `remediation/route.ts` | Cached wrong-answer remediation snippets (`wrong_answer_remediations` table); P3 anti-cheat — only serves remediation for a distractor the student actually submitted. |
| `learning-action/route.ts` | Non-evidential telemetry for post-answer action chips (got_it/explain_simpler/show_example/quiz_me/save); explicitly forbidden from writing any mastery surface. |
| `suggest-prompts/route.ts` | IRT-driven ConversationStarters chips; zero quota cost, never calls Claude. |

---

## 2. AI Edge Functions

| Function | Model | Purpose | Validation oracle | Kill switch |
|---|---|---|---|---|
| `ncert-solver/index.ts` | Claude (via `callGroundedAnswer`, `ncert_solver_v1` template) + Python-proxy option | Step-by-step NCERT solutions; parse→retrieve→route(deterministic/rule/LLM)→solve→verify. Marked internally as the deprecated route behind canonical `/api/scan-solve`. | Shares `grounded-answer`'s grounding/confidence checks. | `ai_usage_global`; per-caller circuit breaker key `ncert-solver\|subject\|grade`. |
| `quiz-generator/index.ts` | **None** (algorithmic selection from `question_bank`) — comment at line 1344 states "sub-millisecond per-question overhead and zero Claude calls" | Adaptive question selection: IRT-ability-biased difficulty, weak-topic targeting, `retrieveChunks` used for QA-content-type lookups (not LLM). | Deterministic oracle checks reused from `_shared/quiz-oracle.ts` (superset of legacy checks; the full LLM-grader oracle already ran at insertion time via `bulk-question-gen`). | In-memory rate limiter (20/min/student) + DB-backed `checkRateLimitDb`. |
| `cme-engine/index.ts` | **None** (algorithmic) | BKT-style mastery update (`updateMastery`), `get_next_action`, `record_response`, `get_concept_state`, `get_revision_due`, `get_exam_readiness`. | N/A (pure math). | N/A. |
| `monthly-synthesis-builder/index.ts` | Claude, via `src/lib/ai/workflows/synthesis-summary.ts` (Next.js side owns the prompt; the bilingual parent-share text is generated **lazily** by `/api/synthesis/state`, not at insert time) | Builds `monthly_synthesis_runs` bundle per (student, month); C5/C4 documented gaps: no month-bounded HPC RPC / chapter-mock summary RPC exist yet — approximated from `concept_mastery`/`curriculum_topics` joins. | Idempotent via UNIQUE(student_id, synthesis_month). | `x-cron-secret` auth (`verifyInternalCronRequest`); `shouldProxyToPython` Python-cutover hook present. |
| `bulk-question-gen/index.ts` | Claude, via grounded-answer/`callGroundedAnswer` | Admin-only bulk CBSE MCQ generation → `question_bank`. | Full oracle (deterministic + LLM grader) gates every insert (REG-54). | "Circuit breaker: 3 failures in 60s → 503, no retry loop" (per header doc). |
| `bulk-non-mcq-gen/index.ts` | Claude | Admin-only short/long-answer question generation; inserts with `verification_state='pending'` (admin review gate, not auto-served). | Skips the MCQ-shape oracle by design (sibling function). | Shares `bulk-question-gen`'s auth model. |
| `generate-answers/index.ts` | Claude Haiku + RAG | Batch-fills `question_bank.answer_text IS NULL`. | Not oracle-gated (admin-triggered batch job). | `x-admin-key` auth only. |
| `generate-concepts/index.ts` | Claude Haiku + RAG | Batch-generates `chapter_concepts` (3-6 concept cards/chapter). | None found. | `x-admin-key` auth only. |
| `generate-embeddings/index.ts` | Voyage/OpenAI (via `_shared/embeddings.ts`) | Batch-embeds `rag_content_chunks` missing vectors. | N/A. | `x-admin-key` auth only. |
| `embed-diagrams/index.ts` | Voyage embedding (no LLM) | Extracts diagram refs from chunks → `media_type='diagram'` RAG rows. | N/A. | `x-admin-key` auth only. |
| `embed-ncert-qa/index.ts` | Claude Haiku (extraction) + Voyage (embedding) | Extracts Q&A pairs from NCERT prose → new Q&A-type RAG chunks. | None found. | `x-admin-key` auth only. |
| `embed-questions/index.ts` | Voyage/OpenAI embedding | Batch-embeds `question_bank` rows missing vectors. | N/A. | `x-admin-key` auth only. |
| `extract-diagrams/index.ts` | Claude Haiku (optional captions) | Extracts diagram/figure refs → `content_media`; captions optional. | None found. | `x-admin-key` auth only. |
| `extract-ncert-questions/index.ts` | Claude Haiku | Parses NCERT exercise sections into `question_bank` MCQs. | Not explicitly gated in the header; downstream `verify-question-bank` cron re-verifies. | `x-admin-key` auth only. |
| `verify-question-bank/index.ts` | Claude, via grounded-answer `quiz_answer_verifier_v1` template | Retroactive verifier cron draining `verification_state='legacy_unverified'` backlog; adaptive throttle vs. `grounded_ai_traces` RPM; peak/off-peak batch sizing (IST-aware). | This **is** the oracle for the legacy backlog. | Adaptive throttle (halves batch above 2400 RPM) functions as a soft circuit breaker. |
| `coverage-audit/index.ts` | None (algorithmic) | Nightly `cbse_syllabus.rag_status` recompute + day-over-day regression detection; auto-disables `ff_grounded_ai_enforced_pairs` pairs when `verified_ratio < 0.85`. | Self-referential (audits the oracle's own output ratio). | Auto-disable IS a kill-switch mechanism for enforced grade/subject pairs. |
| `ncert-question-engine/index.ts` | Claude (evaluate_answer only; fetch_questions is DB-only) | `fetch_questions` (NCERT exercises) + `evaluate_answer` (CBSE-examiner-style marking against DB model answer). | None found explicitly. | Not found. |
| `alfabot-answer/index.ts` | **OpenAI `gpt-4o-mini`** (not Claude) | AlfaBot landing-page widget: KB retrieval (Voyage + `match_alfabot_kb_chunks`) → OpenAI stream → post-process (ban-phrase/pricing/citation/length checks). Pinned by REG-65..68. | Hard-refusal category detection pre-model-call + post-process bans. | "NEVER 5xx on upstream failures — return `degradedMode:true`." |
| `grounded-answer/index.ts` | Claude (Haiku/Sonnet) + OpenAI fallback | The shared RAG+LLM answering service consumed by Foxy, ncert-solver, quiz-generator (question QA), `verify-question-bank`, `bulk-question-gen`. Central RAG+Claude engine. | `grounding-check.ts`, `confidence.ts`, `abstain.ts`. | `circuit.ts` (3-state, per §1.7). |

**Not covered above but present in `supabase/functions/`**: `board-score`, `grade-experiment-
conclusion`, `nep-compliance`, `parent-report-generator` (uses `src/lib/ai/prompts/parent-
report.ts`), `synthetic-host-monitor`, `projector-runner`/`projector-health-check` — these were
not deep-dived; flagged in §7 as functions whose AI/non-AI status wasn't fully confirmed in
this pass.

---

## 3. Cognitive/adaptive stack

### 3.1 BKT / IRT (`src/lib/cognitive-engine.ts`, 1600+ lines — assessment-owned rules,
ai-engineer-implemented code)
- `estimateTheta()` — Newton-Raphson MLE, **3PL** IRT ability estimation.
- `irtProbCorrect(theta, difficulty, discrimination, guessing)` — 3PL probability function.
- `bktUpdate(params, isCorrect)` — per-concept BKT with adaptive parameters (`BKTParams`).
- `sm2Update()` / `nextReviewDate()` — modified SuperMemo (SM-2) spaced repetition.
- `classifyError()` — careless/conceptual/procedural classification.
- `predictRetention()` / `shouldRetest()` — exponential forgetting-curve decay.
- `calculateZPD()`, `difficultyToBloom()`, `bloomToDifficultyRange()`, `zpdToDifficultyLevel()`,
  `updateBloomMastery()` — Bloom's-progression + ZPD machinery.
- `recordExperimentEvidence()` — wires guided-experiment viva scores into BKT-style mastery
  (boosted `pLearn` 1.15x for viva-context updates).
- `predictExamScore()`, `generateExamStudyPlan()`, `calculateChapterPriority()` — exam-readiness.

### 3.2 IRT primitives, 2PL (`src/lib/irt/fisher-info.ts`)
Pure TS twin of the SQL `select_questions_by_irt_info` RPC: `irt2plProb`, `irt2plFisherInfo`,
and a combined selection-score function matching the SQL logic (Fisher-info-based item
selection when calibrated `n>=30`, else proxy-distance, else a floor score). Used both for
unit-testing the SQL math and for a super-admin diagnostics "selection signal" badge.
Gated by dormant flag `ff_irt_question_selection` (off until enough calibration accumulates).

### 3.3 IRT calibration cron
`src/app/api/cron/irt-calibrate/route.ts`, Vercel cron `50 2 * * *` (02:50 UTC daily), pinned
by REG-44 in `vercel.json`. Distinct from the unrelated pg_cron `daily-cron` job at 18:30 UTC.

### 3.4 Foxy quality-eval cron (LLM-as-judge, adjacent to a "misconception curator" concept)
`src/app/api/cron/foxy-quality-sample/route.ts` — nightly (03:40 UTC), samples up to
`SAMPLE_SIZE_DEFAULT` recent Foxy assistant turns, scores via `scoreFoxyAnswer()`
(`src/lib/foxy/quality-eval.ts`, calls **Sonnet** directly via raw fetch) against a 4-dimension
rubric, writes `foxy_quality_scores` (idempotent per `UNIQUE(message_id, rubric_version)`).
Estimated cost ~$15/month at default sample size. This is the closest thing to an automated
"AI health" quality signal for live Foxy traffic, distinct from the offline RAG eval harness.

### 3.5 Misconception curator
`src/app/super-admin/misconceptions/` (UI) + `src/app/api/super-admin/misconceptions/` (API) +
`src/lib/super-admin/misconception-validation.ts` — editor-curated misconception ontology
(migration-backed `misconception_ontology` / candidate view). Consumed by Foxy via
`buildMisconceptionPromptSection(cognitiveCtx.recentMisconceptions)` and by
`MisconceptionExplainer.tsx` in the quiz wrong-answer-remediation UI.

### 3.6 Digital Twin + Knowledge Graph (Slice 1, flag-gated `ff_digital_twin_v1`, seeded OFF
2026-07-02)
- `src/lib/learn/build-twin-context.ts` — **pure, deterministic, no I/O** prompt-context
  builder over `learner_twin_snapshots` (daily rollup: `mastery_by_topic`, `decay_state`,
  `dominant_error_types`, `misconception_cluster_ids`, `cohort_percentile`) +
  `learner_twin_memory` (episodic highlights). Explicitly documents P13 (IDs/numbers/codes
  only, never names/emails/free text) and reuses `BLOCKED_PREREQUISITE_RULES` (assessment-
  owned) as the single source of truth for weak/decay floors — no hardcoded thresholds here.
- `renderTwinPromptSection()` is called from `route.ts` (§1) to append a "LONGITUDINAL
  LEARNING SIGNALS" block to the Foxy system prompt when a snapshot exists.
- Snapshot builder cron: `src/app/api/cron/build-twin-snapshots/route.ts`, triggered thin from
  `daily-cron` (`triggerBuildTwinSnapshots`).
- `traverse_prerequisites` / `detect_blocked_dependents` RPCs back a `concept_edges` unified
  prerequisite graph.

### 3.7 Adaptive loops A/B/C/D
All share the `adaptive_interventions` table substrate (migration `20260619000200`), extended
additively for B/C (`20260619000500`) and again for D (Digital Twin Slice 1, REG-175).
- **Loop A** (closed remediation loop) — `ff_adaptive_remediation_v1`. Cron worker
  `src/app/api/cron/adaptive-remediation/route.ts`; pure modules
  `src/lib/learn/remediation-queue-adapter.ts`, `recovery-evaluation.ts`.
- **Loops B (inactivity) & C (at-risk concentration)** — `ff_adaptive_loops_bc_v1` (separate
  flag, independent ramp). Pure modules `src/lib/learn/adaptive-loops-rules.ts` (1236 lines —
  constants, planners, **cross-loop arbiter**), `inactivity-return-evaluation.ts`,
  `concentration-resolution-evaluation.ts`. B/C inject/verify branches live in the SAME cron
  worker as Loop A.
- **Loop D (blocked-prerequisite)** — riding the Digital Twin Slice 1 substrate,
  `ff_digital_twin_v1`. Cross-loop precedence documented as **A > D > C > B**.
- All four loops are algorithmic (BKT/mastery-threshold-driven), not LLM-driven — the AI
  surface is limited to the Foxy prompt injection of twin context, not the loop logic itself.

---

## 4. RAG infrastructure

### 4.1 Embeddings
- **Table**: `rag_content_chunks` (`embedding vector(1024)`), populated by
  `generate-embeddings`, `embed-diagrams`, `embed-ncert-qa`; `question_bank.embedding` via
  `embed-questions`.
- **Primary model**: Voyage `voyage-3`, 1024 output dims (`_shared/embeddings.ts`,
  `_shared/rag/retrieve.ts` both hardcode this). `EMBEDDING_VERSION = '2026-04-04'`.
- **Fallback**: OpenAI `text-embedding-3-small` (same 1024 dims via explicit `dimensions`
  param) — used only when `VOYAGE_API_KEY` is absent (`resolveProvider()` in
  `_shared/embeddings.ts`). REG-37 pins this fallback behavior.
- **Rerank model**: Voyage `rerank-2` (corrected from a stale `voyage-rerank-2` identifier
  that silently no-op'd rerank — documented bug fix in `_shared/rag/retrieve.ts`).
- Two independent semantic caches exist: the batch-embedding cache in `_shared/embeddings.ts`
  (1h TTL, `simpleHash`) and the grounded-answer response cache (5 min TTL, SHA-256 key) — these
  do **not** share state; a batch job's embedding cache does not warm the live retrieval path.

### 4.2 Eval harness — two distinct, non-unified systems found
1. **Legacy live-service runner** (`eval/rag/{runner.ts,scoring.ts,types.ts,fixtures/}`,
   `npm run eval:rag` / `eval:rag:check`, `scripts/rag-eval.mjs`). Posts curated gold queries to
   the **live** `grounded-answer` Edge Function, scores scope/citation/forbidden-phrase
   matches. Wired into `.github/workflows/rag-eval.yml` (nightly 22:00 UTC + PR-triggered on
   `grounded-answer/**` or `_shared/retrieval.ts` changes) — **currently advisory**
   (`continue-on-error: true`) pending 5 consecutive ≥95%-pass-rate runs. Gold set: only ~30
   queries (documented "Known gap": aim is 100+).
2. **B1 offline harness** (`eval/rag/harness/{cli.ts, run-eval.ts, metrics.ts, verdict.ts,
   golden-schema.ts, relevance-judge.ts, b2-sweep.ts, baseline.ts, ...}`,
   `npm run eval:rag:harness`). A **measurement-only** tool (exits 0 on every verdict —
   PASS/REGRESS/INCONCLUSIVE — except operator-error exit 2). Dynamic-imports the real
   `retrieve()` and `grounding-check.ts` modules; enforces an "AI-boundary lint" (never
   statically imports an AI SDK). Golden set: `eval/rag/golden/ncert-golden-v1.json`;
   baseline: `eval/rag/baseline/ncert-baseline-v1.json`. Per CLAUDE.md, pinned by REG-140 as
   "offline read-only measurement harness (sub-project B1)".

**Finding**: two RAG eval systems with overlapping but non-identical purposes (one CI-gate-
oriented against the live service, one offline-measurement against dynamically-imported
modules) live in the same `eval/rag/` directory tree without a top-level doc distinguishing
them — a discoverability gap (see §7).

### 4.3 Retrieval-quality baselines
`STRICT_MIN_SIMILARITY`/`SOFT_MIN_SIMILARITY` (§1.4) are the only hard-coded quality floors in
the live path. `MIN_CHUNKS_FOR_READY = 50` / `MIN_QUESTIONS_FOR_READY = 40` (config.ts) gate
whether a (grade, subject, chapter) triple is considered "ready" for grounded answering —
consumed by `coverage-audit` and the `chapter_not_ready` abstain reason.

---

## 5. Prompts

### 5.1 Where templates live
- **Registered/versioned prompt files** (Deno-side, loaded by `grounded-answer`):
  `supabase/functions/grounded-answer/prompts/*.txt` + `prompts/index.ts` (registry) +
  `prompts/inline.ts`. Files: `foxy_tutor_v1.txt` (legacy, 3-format conflict — deprecated for
  new traffic), `foxy_tutor_teach_v1.txt`, `foxy_tutor_exam_v1.txt`, `foxy_tutor_doubt_v1.txt`,
  `ncert_solver_v1.txt`, `quiz_question_generator_v1.txt`, `quiz_answer_verifier_v1.txt`.
  `REGISTERED_PROMPT_TEMPLATES` in `config.ts` is the allowlist — must stay in sync (CI-checked
  against `src/lib/grounding-config.ts` per a documented parity script).
- **TS-side prompt builders** (Next.js side, composed into the `foxy_system_prompt` template
  variable before being sent to the Edge Function): `src/lib/foxy/prompt-sections.ts` (
  `buildSystemPrompt`, `FOXY_SAFETY_RAILS`, `MODE_DIRECTIVES`, `MODE_MAX_TOKENS`,
  `buildCognitivePromptSection`, `buildMisconceptionPromptSection`, `selectLeadConcept`, etc.)
  and `src/lib/ai/prompts/foxy-system.ts` (persona/goal-calibration template — header notes it
  is used by both the Next.js route AND the retired `foxy-tutor` Edge Function, so this file's
  doc comment is stale re: the retired function).
- **Other domain prompts** under `src/lib/ai/prompts/`: `alfabot-system.ts` (+ its own test
  file), `ncert-solver.ts`, `parent-report.ts`, `quiz-gen.ts`, `school-context.ts`,
  `tenant-overrides.ts` (per-school AI personality/tone/pedagogy overrides).
- **Quiz oracle prompts**: `src/lib/ai/validation/quiz-oracle-prompts.ts` (Next.js) mirrored by
  `supabase/functions/_shared/quiz-oracle-prompts.ts` (Deno) — two copies, documented as
  intentional (`quiz-oracle.ts` header: "The Deno mirror... keeps the same logic verbatim").
- **MoL (Model Orchestration Layer) prompts**: `_shared/mol/prompt-builder.ts` — a separate,
  more general provider-routing prompt system (`classifier.ts`, `router.ts`,
  `providers/{anthropic,openai}.ts`) used by the admin-functions MoL rollout family
  (referenced in the constitution as REG-70/71's "oracle grader bypass" / "admin-functions
  rollback flag"); relationship between MoL and the Foxy-specific `grounded-answer` stack is
  NOT fully mapped in this pass — flagged in §7.

### 5.2 Bilingual handling
Foxy responds "in the language the student uses" per the skill doc; concretely, error
messages throughout `route.ts` are hardcoded EN/HI pairs (`errorJson(msg, msg_hi, ...)`).
System-prompt-level language behavior is templated (not confirmed line-by-line in this pass
whether the prompt txt files contain explicit Hindi/Hinglish instructions — flagged for
follow-up). AlfaBot has an explicit `lang` field logged in its telemetry contract.

### 5.3 Age-appropriateness / P12 guards
Layered, not single-point:
1. `FOXY_SAFETY_RAILS` (prompt-level, `prompt-sections.ts`) — persona/scope/safety instructions
   injected on every path regardless of template (route.ts comment confirms widening
   `VALID_MODES` did not relax safety since rails are template-independent).
2. STEM curriculum hard pre-gate (`validateCurriculumScope`, flag-gated).
3. P12 grade-spoof hard block (server-authoritative grade, independent of the flag-gated path).
4. FOX-1 deterministic output screen (word-boundary profanity/injection backstop, curriculum-
   vocabulary-aware).
5. Quiz-me oracle gate (P6 + REG-54) before showing any inline MCQ.
6. `ai_usage_global` kill switch as the platform-wide off switch.

---

## 6. Dependency graph — which surfaces consume which AI components

| Product surface | AI component(s) consumed |
|---|---|
| `/foxy` (chat) | `src/app/api/foxy/route.ts` → `grounded-answer` Edge Function (Claude/Voyage) → digital twin (`ff_digital_twin_v1`), long-memory (`ff_foxy_long_memory_v1`), math pipeline (`ff_foxy_math_pipeline_v1` → `src/lib/ai/math/solve-pipeline.ts` + SymPy verify), streaming (`ff_foxy_streaming`), native-turns (`ff_foxy_native_turns_v1`), pending-expectations (`ff_foxy_pending_expectations_v1`), goal-aware persona (`ff_goal_aware_foxy`), context-rich block (`ff_foxy_context_rich_v1`). |
| `/dashboard` | Foxy suggest-prompts (IRT-driven chips, zero-quota); Student Pulse signals (algorithmic, not LLM); Digital Twin snapshot summaries surfaced via `DailyRhythmQueue.tsx` (per constitution file map — not independently re-verified here). |
| `/learn/[subject]/[chapter]` | Foxy `learn`/`explain` modes; topic-progression context (`loadChapterTopicProgress`); pedagogy-content-rules resolver (non-AI, assessment-owned). |
| `/dive` (weekly Curiosity Dive) | `weekly-dive-orchestrator.ts` — not deep-dived; likely Claude-backed artifact generation (flagged for follow-up). |
| `/synthesis` (monthly) | `monthly-synthesis-builder` Edge Function (Claude, cron-triggered) + `src/lib/ai/workflows/synthesis-summary.ts` (lazy Claude call from `/api/synthesis/state` for the bilingual parent-share text). |
| Quiz (`/quiz` → redirects to `/foxy`; `atomic_quiz_profile_update`) | `quiz-generator` Edge Function (algorithmic, IRT/weak-topic-driven selection) + `_shared/quiz-oracle.ts` (deterministic + LLM-grader oracle at generation time, not at serve time). |
| AlfaBot (landing page widget) | `alfabot-answer` Edge Function — **independent OpenAI gpt-4o-mini stack**, separate KB (`match_alfabot_kb_chunks`), separate from Foxy/grounded-answer entirely. |
| Voice (mic/speaker on Foxy) | `src/lib/voice.ts` + `voice-feature-flag.ts` + `voice-python-client.ts` — flag-gated (`ff_python_voice_tts_v1`) proxy to a Python FastAPI Cloud Run service (Whisper STT + Azure neural Indian voices); falls back to browser Web Speech API on any failure. |
| Super-admin misconception curator | `misconception-validation.ts` + `misconceptions` API/UI — editor-curated, feeds into Foxy's misconception prompt section and `MisconceptionExplainer.tsx`. |
| Super-admin AI health panel | `foxy_quality_scores` (LLM-as-judge nightly sample), `grounded_ai_traces` (per-call trace rows), oracle rejection rate (`ops_events` category `quiz.oracle_rejection`), circuit-breaker state (implied, not confirmed wired to a dashboard in this pass). |
| Board-exam prep (board-score cron) | Not deep-dived this pass — flagged. |

---

## 7. Ownership + gaps

### 7.1 AI surfaces missing/stale in the constitution file map
- **Model list is stale**: constitution/CLAUDE.md and the ai-integration skill doc both say
  "Claude Haiku via Supabase Edge Functions" as if Haiku-only; the live `grounded-answer/
  claude.ts` fallback chain includes **Sonnet** and **two OpenAI models** (gpt-4o-mini,
  gpt-4o). `alfabot-answer` is **OpenAI-only** (no Claude at all) — not listed in the AI
  Edge Functions table in either CLAUDE.md file.
- **Daily quota numbers are stale** in the ai-integration skill doc (5/30/unlimited vs. the
  live 10/30/100/999999 in `_lib/constants.ts`).
- **`_shared/mol/` (Model Orchestration Layer)** — a fairly large (13+ files) provider-
  routing/classification/telemetry/feedback system — is not mentioned in either CLAUDE.md
  file map at all, despite backing the admin-functions MoL rollout (REG-70/71) and appearing
  to be a parallel routing abstraction to `grounded-answer/claude.ts`. Relationship between
  the two (are they on a convergence path? is one meant to subsume the other?) is unclear
  from this pass — recommend an architect/ai-engineer joint review.
  it's also not resolved whether `grounded-answer` calls through MoL or has its own duplicate
  Haiku/Sonnet/OpenAI routing logic (this inventory found the latter — `claude.ts` implements
  its own model-order resolution independent of `_shared/mol/router.ts`).
- **`ncert-question-engine`** Edge Function (a Claude-backed answer-evaluation engine) is not
  listed in either CLAUDE.md AI Edge Function table.
- **Voice stack** (`voice.ts`, `voice-feature-flag.ts`, `voice-python-client.ts`,
  `voice-reply-language.ts`) is referenced in the constitution's regression catalog narrative
  (REG-75) but not in the "Key File Map" / "AI Edge Functions" tables.
- **Digital Twin `traverse_prerequisites`/`detect_blocked_dependents` RPCs and Loop D** are
  documented in the constitution (REG-175) but the twin's actual Foxy-prompt injection code
  path (`renderTwinPromptSection`, `loadTwinContextForFoxy`) is described only at a high level
  — the file map does not point directly at `build-twin-context.ts`.

### 7.2 Dormant flags found (default OFF; confirmed via seed migrations)
`ff_digital_twin_v1`, `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`,
`ff_foxy_math_pipeline_v1`, `ff_foxy_curriculum_guard_v1`, `ff_foxy_learning_actions_v1`,
`ff_irt_question_selection` (per constitution narrative), `ff_goal_aware_foxy` (per route
comment, "DISABLED by default in both production and staging"). Several of these gate
substantial code paths (math pipeline, curriculum guard, digital twin) that are fully wired
but not live — the eval/quality signal for what happens when they flip ON has not been
independently verified in this pass (no eval-harness coverage confirmed for `ff_foxy_math_
pipeline_v1` specifically, for example).

### 7.3 Components with no eval coverage found
- **AlfaBot** — no eval harness found analogous to `eval/rag/`; its correctness signal is
  limited to the hard-refusal category tests + REG-65/66/67 regression pins (unit/behavioral,
  not a retrieval-quality measurement).
- **ncert-solver** — no dedicated eval harness; relies on `grounded-answer`'s own
  grounding-check + the general RAG eval harnesses (which target `grounded-answer` directly,
  not the ncert-solver-specific routing: deterministic → rule-based → LLM).
- **quiz-generator**'s adaptive-selection quality (IRT/weak-topic targeting correctness) has
  no dedicated eval; `fisher-info.test.ts` tests the math primitives, not end-to-end selection
  quality against real student data.
- **cme-engine**'s BKT update formula has no eval harness comparing predicted vs. actual
  mastery drift over time (a calibration-quality gap, distinct from the unit tests on the
  formula itself in `cognitive-engine.ts`'s test suite).
- **Digital Twin / Loop D** — flag is OFF; by definition no live-traffic eval exists yet.
- **Voice (TTS/STT)** — REG-75 covers voice-catalog + SSML-escape safety; no measured
  transcription/synthesis-quality eval found.

### 7.4 Single points of failure / circuit-breaker coverage
- **Only `grounded-answer/circuit.ts`** implements a formal 3-state circuit breaker, keyed per
  `(caller, subject, grade)`. It is the shared circuit for Foxy, ncert-solver, quiz-generator's
  QA lookups, `bulk-question-gen`, and `verify-question-bank` insofar as they all route
  through `callGroundedAnswer`.
- **`alfabot-answer`** has NO circuit breaker of its own — its only resilience mechanism is
  "never 5xx, return `degradedMode:true`" (a graceful-degrade, not a breaker with state/
  recovery semantics). Given it's a fully separate OpenAI-only stack, a sustained OpenAI outage
  would degrade every AlfaBot request individually rather than short-circuiting after N
  failures — a latency/cost risk (every request still attempts the call and times out) rather
  than a correctness risk.
- **`generate-answers`, `generate-concepts`, `extract-ncert-questions`, `embed-ncert-qa`,
  `extract-diagrams`** (all Claude-Haiku-backed admin batch jobs) have no circuit breaker —
  acceptable given they are manually admin-triggered, not on the student-facing hot path, but
  worth noting as a gap if any of these are ever cron-automated.
- **The Python AI proxy layer** (`_shared/python-ai-proxy.ts`) is a per-function opt-in
  (`ff_python_<function>_v1`, currently only fully wired for `bulk_question_gen`; others like
  `ff_python_foxy_tutor_v1`, `ff_python_ncert_solver_v1` are referenced as "will follow" in the
  file's own comments) — its failure mode is "throw → caller falls through to existing TS
  path," which is itself a form of per-call fallback, but it is a **different** resilience
  primitive from the Claude/Voyage circuit breaker and is not unified with it.
- **CME engine and quiz-generator** need no circuit breaker (no external LLM call), consistent
  with the skill doc.

### 7.5 Two RAG eval harnesses, undocumented relationship (repeat of §4.2)
Recommend a short README note (or consolidation) clarifying that `eval/rag/{fixtures,runner.ts}`
(live-service CI gate, advisory) and `eval/rag/harness/` (offline B1 measurement tool) are
deliberately separate systems with different exit-code philosophies, so future contributors
don't attempt to merge or mistake one for the other.

### 7.6 Prompt-template registry parity risk
`REGISTERED_PROMPT_TEMPLATES` (`grounded-answer/config.ts`) must stay in sync with
`src/lib/grounding-config.ts` per a CI parity script (`scripts/check-config-parity.sh`,
referenced in a comment but not independently verified as present/passing in this pass).

---

## Summary

Foxy is a two-tier system: a Next.js route (`src/app/api/foxy/route.ts`) that owns
auth/quota/session/cognitive-context/persistence/safety-orchestration, calling a Deno Edge
Function (`grounded-answer`) that owns the actual RAG (Voyage embed → RRF hybrid retrieval →
Voyage rerank-2 → MMR) and LLM call (Claude Haiku/Sonnet with OpenAI gpt-4o-mini/gpt-4o
fallback). Seven modes map to three prompt templates via `selectFoxyPromptTemplate`. Safety is
layered (grade-spoof block, curriculum pre-gate, input-injection neutralizer, deterministic
output screen, quiz oracle gate, global kill switch) rather than single-point. The cognitive
stack (BKT/IRT/SM-2/Bloom's/ZPD) lives in `cognitive-engine.ts` + `irt/fisher-info.ts` and is
purely algorithmic — no LLM calls — as are `cme-engine` and `quiz-generator`. Four adaptive
loops (A/B/C/D) share one `adaptive_interventions` substrate with a documented cross-loop
arbiter (A>D>C>B), all still flag-gated OFF except in ramping. AlfaBot is architecturally
separate (OpenAI-only, own KB, no circuit breaker). Two RAG eval systems exist without a
clarifying README. The `_shared/mol/` provider-orchestration layer's relationship to
`grounded-answer`'s own independent Claude/OpenAI fallback logic is the most significant
open question surfaced by this inventory pass.
