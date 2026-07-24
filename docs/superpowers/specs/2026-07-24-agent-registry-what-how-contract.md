# Spec: Agent Registry + WHAT/HOW Enforcement Contract (GenAI Phase 3)

- **Date**: 2026-07-24
- **Owner**: assessment (owns the learner-state boundary)
- **Status**: SPEC ONLY — no implementation, no flag, no migration, no runtime change
- **Scope**: Additive typed registry of the 7 GenAI agents + a machine-checkable WHAT/HOW boundary enforced by conformance tests. The orchestrator stays dormant; `ff_orchestrator_v1` is NOT flipped by this work.

---

## 0. Motivation

The platform's central learner-state invariant is:

> **The adaptive engine decides WHAT the student learns; GenAI agents decide only HOW — and MAY NOT write mastery / progression.**

Today this invariant is enforced piecemeal across four disconnected mechanisms:

1. **Binding-contract comments** on the three observability events in `packages/lib/src/state/events/registry.ts` — `learner.learning_action`, `learner.struggle_observed`, `learner.turn_classified`. Each carries an assessment-issued "⚠️ BINDING learner-state contract" block stating that no subscriber may consume the event to write any mastery surface.
2. **The subscriber allowlist**: mastery moves onto canonical tables through exactly two projector paths — `learner.concept_check_answered` → `concept-mastery-projector` (BKT), and `learner.mastery_changed` → `mastery-state-writer`. Both live under `packages/lib/src/state/subscribers/`.
3. **GUARD-#3 test**: `apps/host/src/__tests__/state/learning-action-no-mastery-subscriber.test.ts` — asserts no subscriber consumes the self-report/observation events to move mastery.
4. **ESLint rule** `no-canonical-write-outside-projector` (`eslint-plugin-alfanumrik/no-canonical-write-outside-projector.js`) — blocks direct writes to `CANONICAL_TABLES` outside the projector-subscriber allowlist (`/src/lib/state/subscribers/`) + the quiz-completion-service.

None of these enumerate the GenAI **agents** as first-class, typed entities, and none provide a single machine-checkable place that says "these 7 surfaces are HOW-only and may not write mastery." Phase 3 adds exactly that: a **typed Agent Registry** plus a **conformance test contract** that binds every agent surface to the WHAT/HOW boundary.

This is **metadata + a CI-enforced contract**. It changes no runtime behavior. Its only consumers are the conformance tests defined here and future GenAI phases.

---

## 1. `AgentDescriptor` shape

The registry is a frozen, exhaustively-typed array of `AgentDescriptor` objects — one per GenAI agent. Every descriptor MUST carry the following fields:

| Field | Type | Rule |
|---|---|---|
| `id` | `AgentId` (string-literal union of the 7 stable ids) | Stable, immutable. Never renamed once shipped. One of: `'tutor'`, `'assessment'`, `'teacher_copilot'`, `'parent_intelligence'`, `'lesson'`, `'outcome_prediction'`, `'content_generation'`. |
| `displayName` | `string` | Human-readable label (e.g. `"Foxy Tutor"`). Not a translation key; UI surfacing is out of scope for Phase 3. |
| `audience` | `'student' \| 'teacher' \| 'parent' \| 'admin'` | Who the agent serves. Drives future routing/RBAC; informational in Phase 3. |
| `decides` | `'HOW'` (literal, ALL agents) | The WHAT/HOW invariant, encoded per-agent. There is no `'WHAT'` variant in this union — the type itself makes a WHAT-deciding agent unrepresentable. |
| `mayWriteMastery` | `false` (literal, ALL agents) | The mastery-write prohibition, encoded per-agent. The type is the literal `false`, not `boolean` — a `true` value cannot be constructed. |
| `capabilities` | `readonly AgentCapability[]` | Short enum list of what the agent is allowed to DO (all HOW-level). See §1.1. |
| `consumes` | `{ modelGateway: boolean; studentMemory: boolean }` | Declares which shared substrate the agent reads. `modelGateway` = Phase 1 `packages/lib/src/ai/gateway/` (LLM routing/telemetry). `studentMemory` = Phase 2 read-only memory (`apps/host/src/lib/memory/student-memory.ts` + `packages/lib/src/memory/`). Memory access is **read-only by construction**; the registry does not grant write. |
| `status` | `'live' \| 'planned'` | Deployment status. `live` = has a real entry point on disk today; `planned` = no surface yet. |
| `entryPoint` | `string \| null` | Repo-relative path to the agent's entry file. Non-null for `live`; `null` for `planned`. |
| `gatingFlag` | `string \| null` | Feature flag that gates the agent, or `null` if ungated. When non-null, MUST be a real flag present in the flag registry / `packages/lib/src/flags/defaults.ts`. |

### 1.1 `AgentCapability` enum (HOW-level verbs only)

All capabilities describe HOW an agent teaches/explains/formats — never WHAT the student studies next, and never a mastery mutation. Suggested closed set (extend in the registry PR, not ad hoc):

`explain`, `tutor_turn`, `generate_questions`, `summarize_progress`, `compose_report`, `predict_outcome`, `assemble_prompt`, `select_pedagogy`, `format_content`, `generate_content`.

> Note: `generate_questions` (Assessment agent) produces question *content*; it does NOT grade or persist mastery. Grading remains in `submitQuizResults()` → `atomic_quiz_profile_update()` (P1/P2/P4), which is the deterministic path, not an agent.

### 1.2 The 7 agents (verified 2026-07-24)

| `id` | `displayName` | `audience` | `status` | `entryPoint` | Notes |
|---|---|---|---|---|---|
| `tutor` | Foxy Tutor | student | live | `apps/host/src/app/api/foxy/route.ts` | + co-located `apps/host/src/app/api/foxy/_lib/*` (teaching-director, responders, streaming, etc.) |
| `assessment` | Quiz Generator | student | live | `supabase/functions/quiz-generator/index.ts` | Generates question content; never grades/persists mastery |
| `teacher_copilot` | Teacher Copilot | teacher | live | `supabase/functions/teacher-dashboard/index.ts` | |
| `parent_intelligence` | Parent Intelligence | parent | live | `supabase/functions/parent-report-generator/index.ts` | |
| `lesson` | Lesson | student | planned | `null` | No surface yet |
| `outcome_prediction` | Outcome Prediction | teacher | planned | `null` | Composes existing deterministic predictors |
| `content_generation` | Content Generation | admin | planned | `null` | Consolidates scattered bulk-gen edge functions today |

The registry MUST be exported `as const` (or `Object.freeze`d) so ids and literal fields are compile-time-checkable.

---

## 2. The forbidden mastery-write table set

An AI agent surface (any `live` agent's entry point and its co-located `_lib/`) MUST NEVER **directly write** (INSERT / UPDATE / UPSERT / DELETE) to any of the tables below. **Reads are permitted** — only writes are forbidden. Mastery/progression moves onto these tables through exactly one authorized path: the **concept-check / BKT projector** (`learner.concept_check_answered` → `concept-mastery-projector`) and the `mastery-state-writer` (`learner.mastery_changed`), both under `packages/lib/src/state/subscribers/`. No agent is on that allowlist and none may join it.

### 2.1 Authoritative forbidden set — all 9 CONFIRMED against schema (no phantoms)

Each name below was verified to be a real table in the current schema (baseline `00000000000000_baseline_from_prod.sql` or a live post-baseline migration). None is a phantom; the conformance test may assert on all 9.

| Table | Schema source (verified) | Role |
|---|---|---|
| `concept_mastery` | baseline (`00000000000000_baseline_from_prod.sql`) | Per-concept mastery — the canonical projector target |
| `learner_mastery` | `20260517100000_learner_state_projections.sql` (post-baseline, live; the commented `DROP` is a rollback note only) | Learner-state projection mastery |
| `cme_concept_state` | baseline (orig. `20260328100000_cme_foundation.sql`) | Cognitive engine per-concept p_know / BKT state |
| `student_skill_state` | baseline (orig. `20260427000100_misconception_ontology.sql`) | Misconception-ontology skill state |
| `knowledge_gaps` | baseline (orig. `006_cognitive_engine_tables.sql`) | Derived gap surface |
| `cme_error_log` | baseline (orig. `20260328100000_cme_foundation.sql`) | Error-classification counters that feed mastery |
| `bloom_progression` | baseline (orig. `006_cognitive_engine_tables.sql`) | Per-Bloom-level progression |
| `adaptive_mastery` | baseline (`00000000000000_baseline_from_prod.sql`) | Adaptive-engine mastery (also in ESLint `CANONICAL_TABLES`) |
| `student_learning_profiles` | baseline (`000_core_schema.sql`) | Per-subject XP / sessions / correct counts (written only by `atomic_quiz_profile_update()`) |

### 2.2 Provenance of the set

This set is the union of the tables named in the binding-contract comments (`registry.ts` lines ~175, ~205-207, ~248-250: `concept_mastery, cme_concept_state, student_skill_state, knowledge_gaps, learner_mastery, cme_error_log, student_learning_profiles, bloom_progression`) plus the ESLint `CANONICAL_TABLES` mastery member `adaptive_mastery`. It is the authoritative Phase-3 list.

### 2.3 Related tables — deliberately scoped OUT of the mastery-write set

To keep the test asserting on the right thing, these are called out but NOT in the Phase-3 forbidden **mastery** set:

- `quiz_sessions` — named in the binding comments, but it is a **grading/attempt log**, not a mastery table, and it is written by the atomic quiz path (P4), not by agents. It is already independently protected by Invariant 3 / the quiz-integrity skill. An agent surface writing `quiz_sessions` would be a separate P4 violation. Phase 3 MAY optionally extend the forbidden list to include it, but the core 9 are the mastery boundary.
- `daily_schedule`, `scheduled_actions`, `entitlements`, `notification_sends` — the non-mastery members of ESLint `CANONICAL_TABLES`. They are WHAT/scheduling/billing/notification surfaces guarded by the projector rule, not mastery. Out of scope for the mastery-write assertion here (still protected by the existing ESLint rule).

---

## 3. Conformance invariants (what the Phase-3 test MUST assert)

The Phase-3 conformance test (to be written by **testing**, behavior defined here by **assessment**) MUST assert:

- **(a) Exactly 7 agents.** `registry.length === 7` and the set of `id`s equals the 7 stable ids in §1.2 — no more, no fewer.
- **(b) HOW-only + no mastery.** For every descriptor: `decides === 'HOW'` AND `mayWriteMastery === false`. (Belt-and-suspenders on top of the literal types, to catch any `as`-cast escape.)
- **(c) Unique ids.** No duplicate `id` across descriptors.
- **(d) LIVE entry points exist.** For every `status === 'live'` descriptor: `entryPoint !== null` AND the file exists on disk (repo-relative resolve). For every `status === 'planned'`: `entryPoint === null`.
- **(e) No forbidden mastery-write in LIVE surfaces.** For every `live` agent, statically scan its entry-point source **and its co-located `_lib/` directory** (recursively) for a direct write (`insert` / `update` / `upsert` / `delete`) against any table in the §2.1 forbidden set (e.g. `.from('concept_mastery').insert(`, `.upsert(` on a forbidden table, or the SQL equivalent inside an edge function). Any match FAILS the test. Reads (`.select(...)`) are ignored. This is a coarse source-scan gate mirroring the ESLint rule's intent, applied specifically to agent surfaces (edge functions are outside the ESLint `src/` glob, so this test is the boundary for the three Supabase-function agents).
- **(f) Gating flags are real.** For every descriptor with `gatingFlag !== null`, the flag string MUST exist in the flag registry / `packages/lib/src/flags/defaults.ts`. `null` is always allowed (ungated). No descriptor may reference `ff_orchestrator_v1` as its own `gatingFlag` (the orchestrator is not an agent and stays dormant).

> Invariants (b) and (e) are the two that directly encode the WHAT/HOW boundary. (e) is the one that would catch a real regression — an agent surface that starts writing a mastery table.

---

## 4. WHAT/HOW boundary statement (reaffirmed, read-only)

The registry is a **read-only assertion** of an existing invariant; it grants nothing and mutates nothing.

- **WHAT (the adaptive engine decides).** The sequencing decision — which concept/chapter/action the student does next, and how mastery moves — is owned by deterministic adaptive components: `deriveNextAction` (teaching-director sequencing), the cme-engine `selectNextAction` (`supabase/functions/cme-engine/index.ts`), the daily-rhythm orchestrator (`packages/lib/src/learn/daily-rhythm-orchestrator.ts`), and the adaptive loops (`packages/lib/src/learn/adaptive-loops-rules.ts`). Mastery itself moves ONLY through the concept-check / BKT projector path (`learner.concept_check_answered` → `concept-mastery-projector`; `learner.mastery_changed` → `mastery-state-writer`).
- **HOW (the GenAI agents decide).** Given the WHAT, agents decide presentation and pedagogy: which explanation, which coaching tone, which prompt assembly, which question phrasing, which report narrative. That is the entirety of an agent's authority. Agent HOW-logic lives in surfaces such as the Foxy teaching-director / coach-mode / prompt assembly (`apps/host/src/app/api/foxy/_lib/*`) and the three edge-function agents.
- **The wall between them.** Agents may READ the shared substrate — the model gateway (Phase 1) and student memory (Phase 2, read-only) — and may EMIT the three pure-observability events (`learner.learning_action`, `learner.struggle_observed`, `learner.turn_classified`). They may NOT write any §2.1 mastery table, and no subscriber may consume those observability events to move mastery. A self-report, a struggle observation, or a per-turn perception NEVER moves `mastery_mean` / `p_know` / `error_count_*`; only a real graded answer does, through the concept-check / BKT path.

---

## 5. Scope guard (what this work does NOT do)

Explicitly out of scope — the registry is metadata + a CI-enforced contract only:

- **NO feature flag** is added, seeded, or flipped. In particular `ff_orchestrator_v1` stays as-is (dormant); the orchestrator is NOT activated.
- **NO migration.** No schema change, no new table, no RLS change. The 9 forbidden tables already exist.
- **NO orchestrator activation** and **NO change to any agent's runtime behavior.** No agent's request handling, prompts, model routing, or outputs change.
- **NO edit to the existing enforcement.** The binding-contract comments, subscriber allowlist, GUARD-#3, and the `no-canonical-write-outside-projector` ESLint rule remain exactly as they are; the registry sits alongside them and references the same boundary.
- The **only** consumers of the registry are the Phase-3 conformance tests defined in §3 and future GenAI phases. It is additive and inert at runtime.

### 5.1 Downstream (per P14 review chain)

This spec defines a learner-state rule (assessment-owned). Implementation of the registry + tests is a follow-up that, per the review-chain matrix, routes to **ai-engineer** (implements the typed registry alongside the agent surfaces), **testing** (writes the §3 conformance test), and **frontend** (only if/when a descriptor is ever surfaced in UI — not in Phase 3). Assessment retains sign-off on the boundary.

---

## 6. Verification log (facts confirmed 2026-07-24)

- 4 LIVE entry points exist on disk: `apps/host/src/app/api/foxy/route.ts` (+ `_lib/`: cognitive-context, constants, legacy-flow, quota, responders, session, streaming, teaching-director, test-surface), `supabase/functions/quiz-generator/index.ts`, `supabase/functions/teacher-dashboard/index.ts`, `supabase/functions/parent-report-generator/index.ts`.
- All 9 forbidden tables are real (baseline or live post-baseline migration) — see §2.1. `learner_mastery` is a genuine post-baseline table (`20260517100000_learner_state_projections.sql`); its `DROP TABLE` occurrence is a commented rollback note, not an active drop. **No phantom tables.**
- Binding-contract comments confirmed in `packages/lib/src/state/events/registry.ts` on all three observability events.
- Substrate confirmed: Phase 1 model gateway at `packages/lib/src/ai/gateway/`; Phase 2 student memory at `apps/host/src/lib/memory/student-memory.ts` + `packages/lib/src/memory/`.
- ESLint `CANONICAL_TABLES` = `{concept_mastery, adaptive_mastery, daily_schedule, scheduled_actions, entitlements, notification_sends}`; allowlist suffix `/src/lib/state/subscribers/`.
- GUARD-#3 confirmed at `apps/host/src/__tests__/state/learning-action-no-mastery-subscriber.test.ts`.
- `ff_orchestrator_v1` confirmed present (`packages/lib/src/flags/protected-flags.ts`, `packages/lib/src/flags/defaults.ts`) — left dormant.
