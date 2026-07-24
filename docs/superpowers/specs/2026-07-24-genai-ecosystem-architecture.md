# GenAI Ecosystem Architecture — North-Star Blueprint

- **Status:** Approved blueprint (CEO-approved north-star; this is design, not code)
- **Date:** 2026-07-24
- **Owner:** architect (reference architecture, boundaries, deployment, gates)
- **Contributors:** ai-engineer (L2 Model Gateway LLD, RAG), assessment (learner-state contract, eval oracles), backend (surfaces/APIs), ops (flags, cost, observability)
- **Scope:** The whole multi-quarter GenAI program. **Grounded in what already exists** — this document maps existing components to a target shape; it does not propose a rebuild.
- **Sibling LLD:** `docs/superpowers/specs/2026-07-24-model-gateway-design.md` (ai-engineer — L2 detail).
- **Phase 1 seam (this deliverable):** `ff_model_gateway_v1` seed migration `supabase/migrations/20260724120000_seed_ff_model_gateway_v1.sql` (default OFF), runbook `docs/runbooks/model-gateway-rollout.md`.

> **Path note:** this repo is a monorepo (`apps/*` + `packages/*`). Canonical library code lives under `packages/lib/src/…`; the host app under `apps/host/src/…`. `supabase/migrations/` and `supabase/functions/` remain at the repo root. Paths below are verified-current.

---

## 0. Purpose & the one idea that governs everything

Alfanumrik already has, in production, most of a GenAI learning system: a grounded RAG tutor (Foxy), an adaptive cognitive engine (IRT/BKT/SM-2), a digital-twin knowledge graph, quiz generation, and a dormant event orchestrator. What is missing is not capability — it is **a named architecture with enforced boundaries** so that the pieces compose safely as we add agents, providers, and surfaces.

The governing idea:

> **The Adaptive Engine decides WHAT the student learns. GenAI decides only HOW.**

Everything in this blueprint exists to make that sentence a *typed, enforced contract* rather than a convention. See Section 2.

---

## 1. Reference architecture — 6 layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│  L6  SURFACES                                                              │
│      Student: /foxy /quiz /learn /dive /synthesis  •  Parent /parent/*     │
│      Teacher /teacher/*  •  Super-admin /super-admin/*  •  Mobile (Flutter)│
├──────────────────────────────────────────────────────────────────────────┤
│  L5  AGENTS (7)                                                            │
│   Tutor · Assessment · Lesson* · TeacherCopilot · ParentIntelligence ·    │
│   OutcomePrediction* · ContentGeneration          (* = net-new surface)   │
├──────────────────────────────────────────────────────────────────────────┤
│  L4  ORCHESTRATION                                                         │
│      packages/lib/src/state/orchestrator.ts  +  state_events bus          │
│      (45 event kinds, gated by dormant ff_orchestrator_v1)                │
│      "route every request" workflow (Section 4)                           │
├──────────────────────────────────────────────────────────────────────────┤
│  L3  MEMORY + RAG                                                          │
│   Digital Twin (learner_twin_snapshots/_memory, concept_edges) ·          │
│   concept_mastery · student_misconceptions · student_learning_profiles ·  │
│   grounded-answer RAG (Voyage voyage-3 1024-d + rerank-2 + RRF k=60)      │
├──────────────────────────────────────────────────────────────────────────┤
│  L2  MODEL GATEWAY  (provider-agnostic)     ← Phase 1, ff_model_gateway_v1 │
│   registry (models + cost tables) · policy routing · prompt caching ·     │
│   Anthropic-primary today; Python-cutover + provider expansion later      │
├──────────────────────────────────────────────────────────────────────────┤
│  L1  GOVERNANCE                                                            │
│   safety (scope-lock, curriculum guard, output-screen, injection defense) │
│   · runtime eval gate (9-dim) · PII/DPDP · feature flags · cost control   │
│   · audit_logs · kill switches                                            │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ every layer above passes THROUGH L1 governance and L2 gateway ▲
```

**Layer responsibilities (one line each):**

- **L1 Governance** — the cross-cutting control plane. No LLM byte reaches a student without passing safety screens, the eval gate, PII redaction, the active feature flags, and cost accounting; every AI action is auditable.
- **L2 Model Gateway** — the single provider-agnostic seam through which *all* model calls flow. Owns model registry, cost tables, policy-based routing, prompt caching. Default behavior = today's Anthropic-primary path (gated by `ff_model_gateway_v1`).
- **L3 Memory + RAG** — durable learner memory (Digital Twin + mastery + misconceptions) and grounded retrieval (NCERT RAG). The read substrate for every agent.
- **L4 Orchestration** — the event bus + orchestrator that sequences agents through the canonical per-request workflow and records observability events.
- **L5 Agents** — 7 role-scoped GenAI capabilities (Section 3). Each is a *consumer* of L2/L3 and a producer of L4 events.
- **L6 Surfaces** — the web/mobile/admin entry points. UI-only; no business or model logic.

---

## 2. The non-negotiable contract — "WHAT vs HOW"

### 2.1 Statement
- **WHAT** the student learns (which concept next, whether mastery moved, progression, difficulty target) is decided **exclusively** by the deterministic Adaptive Engine.
- **HOW** it is taught (wording, examples, analogies, diagrams, tone, remediation phrasing) is decided by GenAI.

### 2.2 How it is honored TODAY
- **Concept selection is deterministic.** `selectNextAction()` in `supabase/functions/cme-engine/index.ts:117` (invoked at `:434`) picks the next concept from BKT/IRT state — no LLM in that path.
- **Pedagogy is GenAI's job.** The Foxy Teaching Director / coach-mode chooses *how* to explain (mode: `learn/explain/practice/revise/doubt/homework/explorer`) via `apps/host/src/app/api/foxy/route.ts` and `packages/lib/src/ai/` — but it receives the concept as an input; it does not choose it.
- **Mastery only moves through graded answers.** Only `learner.concept_check_answered` (a real graded response) feeds BKT/mastery. Tutoring turns do not.

### 2.3 How it becomes an ENFORCED contract
The event registry already encodes the binding rule. Three learner-observation events are declared **observability-only**:

- `learner.learning_action`, `learner.struggle_observed`, `learner.turn_classified` in `packages/lib/src/state/events/registry.ts` each carry the comment:
  > "⚠️ BINDING learner-state contract (assessment-issued): No subscriber may consume this event to write ANY mastery surface (`concept_mastery`, `cme_concept_state`, `student_skill_state`, `knowledge_gaps`, `learner_mastery`, `cme_error_log`, `quiz_sessions`, `student_learning_profiles`, `bloom_progression`). … The bus row is pure observability."

The target enforcement is a **typed boundary**: GenAI agents receive learner state as a *read-only* `StudentState` and may emit only observability events. The write path to mastery/progression surfaces is owned by the Adaptive Engine + the concept-check/BKT path. Concretely:

1. **Read-only memory API (L3, planned):** agents read `StudentState`; they hold no write handle to mastery tables.
2. **Event-typed writes:** the only mastery-moving event is `learner.concept_check_answered`; the three observation events above are permanently non-mastery. New agents inherit this by construction (any new observation event must copy the binding-contract comment + be excluded from mastery subscribers).
3. **Eval-gate assertion (L1):** the runtime eval gate (Section 8) and regression tests assert no LLM-originated write reaches a mastery/progression surface. This is the mechanical backstop that turns the comment into a contract.

**Invariant:** an LLM may *describe* a student's state and *teach*; it may never *decide* mastery, next concept, XP, or progression. That decision authority is P1–P6 territory and is CEO-gated.

---

## 3. The 7 agents mapped to existing components

Each agent is a role-scoped capability, not a new microservice. It composes existing L2/L3 primitives and dispatches L4 events. `*` marks a net-new *surface* (the primitives already exist).

### 3.1 Tutor Agent
- **Responsibility:** grounded conversational teaching (the "HOW"). Multi-mode Foxy.
- **Exists:** `apps/host/src/app/api/foxy/route.ts` (Foxy Next.js route, replaced the retired `foxy-tutor` edge fn), `packages/lib/src/ai/grounded-client.ts`, `supabase/functions/grounded-answer/`, `supabase/functions/ncert-solver/`.
- **Gap:** route all model calls through L2 gateway; formalize the read-only `StudentState` input so the Tutor never writes mastery.

### 3.2 Assessment Agent
- **Responsibility:** generate + grade questions, run adaptive selection (the "WHAT" mechanism it *serves*, not decides — selection is deterministic).
- **Exists:** `supabase/functions/quiz-generator/`, `supabase/functions/cme-engine/` (`selectNextAction`), `packages/lib/src/cognitive-engine.ts` (IRT 3PL + BKT + SM-2), `packages/lib/src/irt/fisher-info.ts`.
- **Gap:** none structural; wire generation model calls through L2; keep the AI quiz-generator validation oracle (REG-54) as the pre-insert gate.

### 3.3 Lesson Agent *(net-new surface)*
- **Responsibility:** author structured lessons/explanations per concept (not just chat turns).
- **Exists (scattered):** `supabase/functions/generate-concepts/`, `chapter_concepts` data, `extract-ncert-questions/`. No unified lesson surface today.
- **Gap:** a net-new lesson-composition surface over these primitives + RAG; default-OFF flag; must respect the read-only concept boundary.

### 3.4 TeacherCopilot Agent
- **Responsibility:** class-level insight + drafting for teachers.
- **Exists:** `supabase/functions/teacher-dashboard/`, teacher portal `apps/host/src/app/teacher/*`, Student Pulse (`packages/lib/src/pulse/`, `canAccessStudent` boundary).
- **Gap:** LLM synthesis layer over existing dashboard aggregates; RBAC/`canAccessStudent` remains the single data boundary (P8/P13).

### 3.5 ParentIntelligence Agent
- **Responsibility:** parent-facing progress narratives.
- **Exists:** `supabase/functions/parent-report-generator/`, `parent-portal/`, monthly-synthesis parent-share (`/api/synthesis/parent-share`).
- **Gap:** route through L2; enforce DPDP boundary (parent sees only approved linked child via `guardian_student_links status='approved'`).

### 3.6 OutcomePrediction Agent *(net-new surface)*
- **Responsibility:** forecast exam score / mastery date / retention for a student.
- **Exists (primitives):** `packages/lib/src/cognitive-engine.ts` — `predictExamScore()` (:1245), `predictMasteryDate()` (:571), `predictRetention()` (:961).
- **Gap:** a net-new read-only surface that composes these deterministic predictors and *optionally* uses GenAI only to narrate them — the numbers stay deterministic (WHAT), GenAI only phrases them (HOW).

### 3.7 ContentGeneration Agent
- **Responsibility:** produce diagrams, distractors, embeddings, question banks at scale (offline/batch).
- **Exists:** `extract-diagrams/`, `embed-diagrams/`, `embed-questions/`, `embed-ncert-qa/`, `bulk-question-gen/`, `generate-answers/`, NCERT ingestion pipeline `scripts/ncert-ingestion/`.
- **Gap:** route through L2; keep human/oracle review gates; content changes that touch curriculum scope stay assessment-owned.

---

## 4. Orchestration & event design (L4)

### 4.1 Existing substrate
- **Orchestrator:** `packages/lib/src/state/orchestrator.ts` with `context/`, `journey/`, `learner-loop/`, `rules/`, `runtime/`, `services/`, `subscribers/`.
- **Event bus:** `state_events` (migration `20260516180000_domain_events_bus.sql`), **45 event kinds** declared in `packages/lib/src/state/events/registry.ts`, gated behind the **dormant** `ff_orchestrator_v1`.
- **State builder:** `student-state-builder.ts` → `StudentState` (the read-model agents consume).

### 4.2 How agents dispatch
Agents never write to each other directly. They:
1. Read `StudentState` (L3, read-only).
2. Do their work through L2 (models) + L3 (RAG/memory).
3. Emit observability events onto `state_events` (e.g. `learner.turn_classified`), which subscribers may consume for analytics/adaptive triggers — but never to move mastery (Section 2.3).

### 4.3 The canonical "route every request" workflow
Every learning request flows through this deterministic sequence. GenAI participates only in the shaded ("HOW") steps; the Adaptive Engine owns the boundaries.

```
Question
  → Adaptive Engine   (WHAT: which concept, difficulty target — deterministic)
  → Memory            (read StudentState: mastery, misconceptions, twin)
  → RAG               (retrieve grounded NCERT context)
  → Errors            (load student_misconceptions for this concept)
  → Strategy          (Teaching Director picks pedagogy — HOW)
  → Tutor             (generate grounded explanation — HOW, via L2)
  → Diagram           (optional visual — HOW, via L2)
  → Quiz              (Assessment Agent generates concept-check)
  → Evaluate          (grade the answer — deterministic)
  → Update Mastery    (BKT/IRT via concept_check_answered — Adaptive Engine ONLY)
  → Update Memory     (twin snapshot / misconception log)
  → Next Concept      (Adaptive Engine selectNextAction — deterministic)
```

The two write-to-mastery steps ("Update Mastery", "Next Concept") are **Adaptive-Engine-exclusive**. Every GenAI step is between them and holds no mastery write handle.

---

## 5. Memory design (L3)

### 5.1 Existing memory surfaces
- **Digital Twin (Slice 1, `ff_digital_twin_v1` default-OFF):** `learner_twin_snapshots`, `learner_twin_memory`, `concept_edges` (unified prerequisite graph), RPCs `traverse_prerequisites`, `detect_blocked_dependents`. `buildTwinContext` is a pure/PII-safe read (REG-175).
- **Mastery:** `concept_mastery` / `concept_mastery_score`, BKT/IRT state in `cognitive-engine.ts`.
- **Misconceptions:** `student_misconceptions` (Eedi-pattern remediation; `wrong-answer-remediation.ts`, `MisconceptionExplainer.tsx`).
- **Profile:** `student_learning_profiles`.

### 5.2 Planned: Unified Student Memory read-API
A single read-only accessor that composes twin + mastery + misconceptions + profile into one `StudentState`, exposed to agents. Properties:
- **Read-only for agents.** No agent gets a write handle to mastery/progression surfaces (Section 2.3).
- **DPDP retention/erasure.** Honors the `parent.child_erasure_requested` event: on erasure, memory rows for the child are purged/anonymized on a defined retention schedule; the read-API returns empty for erased subjects. No PII in the read-model beyond what RBAC/`canAccessStudent` already permits.
- **Flag-gated, default-OFF.** Ships behind its own staged flag with a regression entry (Section 12).

---

## 6. RAG & vector design (L3)

- **Pipeline:** `supabase/functions/grounded-answer/` + `packages/lib/src/ai/retrieval/ncert-retriever.ts` + `grounded-client.ts`.
- **Embeddings:** Voyage `voyage-3`, 1024-d, stored in `rag_content_chunks` (`source='ncert_2025'`, ~16,006 chunks covering ~98.6% of `cbse_syllabus`).
- **Rerank + fusion:** Voyage `rerank-2`, Reciprocal Rank Fusion **RRF k=60** over vector + lexical.
- **Index:** HNSW (`m=16`, `ef_construction=64`).
- **Single-retrieval contract (REG-50):** at most **one** `retrieveChunks` call per turn; the cache short-circuits before retrieval. Non-negotiable — prevents retrieval fan-out.
- **Do not re-ingest blind:** the corpus exists; consult `/api/super-admin/grounding/coverage` + `ingestion_gaps` before any re-ingestion. `ncert:embed` spends real Voyage money.

---

## 7. Model Gateway (L2) — summary

The Model Gateway is the single provider-agnostic seam for all model calls. It owns:
- **Model registry + cost tables** — per-model input/output cost, context window, capabilities.
- **Policy routing** — choose model by task tier / cost / capability, gated by `ff_model_gateway_v1`.
- **Prompt caching** — Anthropic prompt caching + cache tiers (Section 10).
- **Default behavior** — with `ff_model_gateway_v1` OFF (default), the gateway reproduces today's **Anthropic-primary** path byte-for-byte. No alternate provider (e.g. Gemini) and no non-default policy is reachable while OFF.

**Boundary:** the gateway routes; it does **not** authorize a new model/provider. Adding a model/provider is a CEO approval gate (Section 13) independent of the flag.

Full L2 detail is in the sibling LLD `docs/superpowers/specs/2026-07-24-model-gateway-design.md` (ai-engineer, who owns `packages/lib/src/ai/gateway/**`).

---

## 8. Evaluation framework

Two tiers, one offline (exists) and one runtime (planned).

### 8.1 Offline (exists)
- **RAG harness:** `eval/rag/` (CLI `eval/rag/harness/cli.ts`, runner/metrics/verdict, golden set `eval/rag/golden/`, baseline `eval/rag/baseline/ncert-baseline-v1.json`; pinned by REG-140). Read-only measurement.
- **Per-surface oracles:** AI quiz-generator validation oracle (REG-54, deterministic + LLM-grader gate before `question_bank` insert); Foxy scope-lock and structured-output oracles.

### 8.2 Runtime eval gate (planned, L1)
A pre-delivery gate scoring every student-facing GenAI response on **9 dimensions**:
1. Accuracy 2. Curriculum alignment 3. Hallucination 4. Age-appropriateness 5. Difficulty 6. Learning-effectiveness 7. Toxicity 8. Latency 9. Cost.

Fails-closed on the safety dimensions (hallucination/toxicity/age): a failing response is suppressed/regenerated, not delivered. Flag-gated, default-OFF, with a regression entry before any traffic (Section 12).

---

## 9. Safety & security (L1)

- **Scope-lock:** hard-refusal categories enforced client-prompt-side AND server-side (REG-66 pattern) — GenAI stays within CBSE tutoring scope.
- **Curriculum guard:** responses constrained to grade/board syllabus scope (P12).
- **Output-screen:** age-appropriateness + toxicity screen before delivery (part of the 9-dim gate).
- **Injection defense:** untrusted retrieved/user content never escalates instructions; system prompt integrity preserved.
- **AI-admission gate:** only eligible plans/usage-limited requests reach models (per-plan daily limits, P12).
- **Kill switches:** every AI surface has a flag/circuit-breaker; flipping OFF returns instant legacy/deny behavior. Drains, does not freeze (adaptive-loops pattern).
- **PII/DPDP:** no PII to models or logs; logger redacts password/token/email/phone/API keys (P13); `parent.child_erasure_requested` honored (Section 5.2).
- **Audit:** sensitive AI actions logged to `audit_logs` with metadata only (never message text/PII) — REG-68 pattern; `mol_request_logs` for model calls.

---

## 10. Cost optimization (L1 + L2)

- **Registry cost tables** — the gateway knows each model's price; policy routing sends cheap/simple tasks to cheaper models and reserves premium models for hard tasks.
- **Policy routing** — task-tier-aware selection (gated by `ff_model_gateway_v1`).
- **Prompt caching** — Anthropic prompt caching for stable system prompts/RAG context.
- **Cache tiers (L1/L2/L3):** L1 exact-response cache (Foxy short-circuit, REG-50) → L2 semantic/embedding cache → L3 RAG-context cache. Each avoids a model call.
- **Python-cutover flags** — the MoL/Python AI service path (`mol_request_logs`, shadow routing migration `20260519000001`, cutover kill-switch REG-73/74) lets us move eligible inference to cheaper Cloud Run hosting behind flags.

Cost is a first-class eval dimension (Section 8) and a watched telemetry in the rollout runbook.

---

## 11. Deployment & observability

- **Compute:**
  - Vercel (bom1 / Mumbai) — Next.js routes incl. `/api/foxy`, cron (`/api/cron/irt-calibrate`, adaptive-remediation).
  - Supabase Edge (Deno) — `grounded-answer`, `quiz-generator`, `cme-engine`, `ncert-solver`, `daily-cron`, etc.
  - Python Cloud Run — MoL/Python AI service (flag-gated cutover).
- **Observability:** Sentry (client/server/edge, PII-redacted `beforeSend` REG-49), PostHog (product analytics), trace-logger (`packages/lib/src/ai/tracing/`), `mol_request_logs` (per model call: cost + latency + model provenance).
- **Region/latency:** bom1 keeps first-hop latency low for Indian 4G; latency is a gate dimension.

---

## 12. Phased roadmap

Every phase ships behind a **default-OFF feature flag** with a **regression-catalog entry** before traffic. Rollback = flip flag OFF → instant legacy behavior.

| Phase | Deliverable | Flag (default OFF) | Notes |
|---|---|---|---|
| **1 (now)** | **Model Gateway (L2)** | `ff_model_gateway_v1` | This deliverable. OFF = Anthropic-primary byte-identical. Migration `20260724120000`. |
| 2 | Unified Student Memory read-API (L3) | new staged flag | Read-only agent memory + DPDP erasure. |
| 3 | Orchestration activation (L4) | `ff_orchestrator_v1` (existing, dormant) | Turn on event-bus routing for the canonical workflow. |
| 4 | Runtime Eval Gate (L1, 9-dim) | new staged flag | Fail-closed on safety dims. |
| 5 | Net-new agents: OutcomePrediction, Lesson, ContentGeneration surfaces | per-agent flags | Compose existing primitives; read-only concept boundary. |
| 6 | Voice-native + provider expansion (e.g. Gemini) | per-capability flags | Provider add is a CEO gate (Section 13). |

Phases are independent flags; they ramp separately (the adaptive Loop-A/Loops-B&C precedent: separate flags, independent ramps).

---

## 13. Approval gates (per the product constitution)

The following require **CEO approval** regardless of any flag state (from `.claude/CLAUDE.md` "User Approval Required For"):

- **Adding a model or provider** (e.g. wiring Gemini) — AI model/provider change.
- **Pricing / new subscription plans.**
- **New CBSE subject additions.**
- **Any change to product invariants P1–P13** (score/XP/anti-cheat/atomic submit/grade format/question quality/bilingual/RLS/RBAC/bundle/payment/AI-safety/privacy).
- **Migrations that DROP tables or columns.**
- **Changes to the agent system itself.**

`ff_model_gateway_v1` gates *routing policy only*; it does **not** pre-authorize any of the above. Enabling non-default routing on live student traffic, or wiring a second provider, are separately CEO-gated per the rollout runbook.

---

## 14. Open questions / follow-ups

1. **Protected-flags canary:** `ff_model_gateway_v1` is not constitution-pinned but ops may need to add it to `EXPECTED_OFF_FLAGS` in `packages/lib/src/flags/protected-flags.ts` (ops-owned) so the default-OFF canary accounts for the new row. Flagged to ops; not edited by architect.
2. **Memory write-boundary enforcement:** the typed read-only `StudentState` boundary (Section 2.3) needs a mechanical test asserting no LLM-originated mastery write — track as a regression entry when Phase 2 lands.
3. **Eval-gate latency budget:** the 9-dim runtime gate adds latency; Phase 4 must define per-dimension budgets against the bom1 4G target.
