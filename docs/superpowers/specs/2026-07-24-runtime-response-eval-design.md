# Runtime `ResponseEval` — 9-Dimension Response Evaluation Sensor (Phase 4)

- **Status:** Design (spec only — no implementation in this document)
- **Date:** 2026-07-24
- **Owning agent:** assessment (learner-state / pedagogy correctness of the dimensions)
- **Reviewers:** ai-engineer (signal plumbing at the Foxy route), testing, ops (observability sink)
- **Flag:** `ff_response_eval_v1` — default **OFF** (OFF ⇒ byte-identical response path)
- **Invariants touched:** P12 (AI safety — read-only, additive), P13 (data privacy — codes/ids/numbers only). **No** change to P1–P6 (scoring/XP/quiz), P7–P11, P14–P15.

---

## 1. Purpose & Scope Guard (WHAT / HOW)

`ResponseEval` is a **runtime evaluation sensor** that scores every AI (Foxy) response across 9 dimensions and emits a PII-free record to observability. It is the runtime twin of the offline nightly judge (`scoreFoxyAnswer` → `foxy_quality_scores`).

**WHAT it is:** a read-only *measurement* taken at the Foxy route's grounded terminal, using signals **already computed** for that turn. It reports what happened.

**WHAT it is NOT (hard scope guard — binding, assessment-issued):**

- It **NEVER blocks, delays, refunds, retries, or alters** a response. Flagging is observability only.
- It writes **no** mastery, `p_know`, ZPD, progression, XP, or score. It is not on any learner-state write path (same posture as `learner.turn_classified` / `ff_foxy_perception_v1`).
- It makes **NO synchronous LLM call**. The two dimensions that need a judge (`accuracy`, `learning_effectiveness`) are represented as **deferred/nullable**, sourced offline.
- It is **fire-and-forget**: it returns `null` on any failure and is wrapped so it can never throw into the response path.
- It is **flag-gated** `ff_response_eval_v1`, default OFF. With the flag OFF the eval builder is **not invoked at all**, so the response path is byte-identical.

Every signal below is verified to already exist at the route's grounded terminal — **no new LLM call, no new retrieval, no new DB read** is introduced to compute a dimension.

---

## 2. The `ResponseEval` Type

Common scale: **`score ∈ [0,1]`, higher = better ("health")** for every dimension. Raw operational values (`latency` ms, `cost` USD, grounding `confidence`) are stored **alongside** the normalized health so the raw magnitude is never lost.

```
type EvalSource =
  | 'deterministic'      // output-screen (toxicity / age)
  | 'gateway'            // Phase-1 model gateway registry (latency / cost)
  | 'grounding'          // grounded.confidence / groundedFromChunks / citations
  | 'curriculum'         // preGateConfirmedInScope / validateCurriculumScope
  | 'mastery'            // cognitiveCtx.masteryLevel + topicProgress (ZPD)
  | 'deferred_llm_judge' // sourced offline from foxy_quality_scores (null at runtime)

interface DimensionEval {
  score: number | null;   // [0,1] health; null iff available === false
  raw: number | null;     // raw magnitude when meaningful (ms, usd, confidence); else null
  source: EvalSource;
  available: boolean;      // false ⇒ deferred (score/raw null at runtime)
  code: string | null;    // stable classifier code for this dim (e.g. 'in_scope','blocklist'); null if n/a
}

interface ResponseEval {
  // ── correlation (P13-safe UUIDs only) ──
  trace_id: string;
  session_id: string;
  message_id: string;
  grade: string;           // P5 string "6".."12" (a scope enum, not PII)
  subject: string;         // subject code (not PII)
  rubric_alignment: 'runtime-v1';   // pins vocab to §7 mapping

  // ── 9 dimensions ──
  accuracy: DimensionEval;               // deferred_llm_judge  (available:false at runtime)
  curriculum_alignment: DimensionEval;   // curriculum
  hallucination_risk: DimensionEval;     // grounding
  age_appropriateness: DimensionEval;    // deterministic
  difficulty_fit: DimensionEval;         // mastery (advisory — never flags)
  learning_effectiveness: DimensionEval; // deferred_llm_judge  (available:false at runtime)
  toxicity: DimensionEval;               // deterministic
  latency: DimensionEval;                // gateway
  cost: DimensionEval;                   // gateway

  // ── verdict (§4) ──
  flagged: boolean;
  flagReasons: string[];   // stable codes, sorted, deduped
}
```

**The 2 deferred dimensions** — `accuracy` and `learning_effectiveness` — have `available:false`, `score:null`, `raw:null`, `source:'deferred_llm_judge'` at runtime. They are **populated offline** by the nightly Sonnet judge (`scoreFoxyAnswer`) which already writes `accuracy` and `scaffoldFidelity` to `foxy_quality_scores`. A later increment joins the offline row back to the runtime record by `message_id`.

---

## 3. Normalization Rules (per dimension)

> **Zero magic numbers.** Every threshold is either (a) reused from an existing constant with a file citation, or (b) a named constant in §3.10 with a documented rationale.

### 3.1 `accuracy` — deferred
- `available:false`, `score:null`, `raw:null`, `source:'deferred_llm_judge'`.
- Offline authority: `foxy_quality_scores.accuracy` (0..100). Runtime health when joined later = `accuracy/100`.
- Rationale: no cheap runtime signal exists; a synchronous judge is explicitly forbidden.

### 3.2 `curriculum_alignment` — `source:'curriculum'`
- Inputs: STEM pre-gate `preGateConfirmedInScope` (bool) and/or `validateCurriculumScope(...) → { inScope, reason }`.
- Normalization: `score = inScope ? 1 : 0`. `raw = null` (there is no numeric scope score — the source is a boolean + reason enum, by design not a probability).
- `code = reason` (the existing scope `reason` enum) when out of scope; `'in_scope'` otherwise.
- Rationale: mirrors the offline `cbse_scope` rubric dim and the eval-harness `scope_correct` boolean (§7). We do **not** fabricate a fractional scope score from a boolean.

### 3.3 `hallucination_risk` — `source:'grounding'` (store raw + health)
- Inputs (route already holds the composed values): `grounded.confidence ∈ [0,1]` (from `computeConfidence`, `confidence.ts`), `grounded.groundedFromChunks` (bool), `grounded.citations.length`.
- **Store raw:** `raw = grounded.confidence`. Convention: **higher `confidence` = higher groundedness = LOWER hallucination risk**, so higher health = safer.
- **Health mapping:**
  - If `groundedFromChunks === true` **and** `citations.length > 0`: `score = confidence` (grounded answer — health tracks confidence directly).
  - Else (ungrounded, non-abstain generation): `score = min(confidence, UNGROUNDED_CONFIDENCE_CAP)` — an ungrounded answer cannot be credited full health even if the model self-reports high confidence.
- `code`: `'grounded'` | `'ungrounded'` | `'no_citations'`.
- **Threshold reuse:** `HALLUCINATION_CONFIDENCE_FLOOR` and `UNGROUNDED_CONFIDENCE_CAP` **bind to the grounded pipeline's existing confidence thresholds** (`STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` / `SOFT_CONFIDENCE_BANNER` in the `grounded-answer` edge fn config). We do **not** invent a new numeric value — the eval reads whatever those resolve to, so the sensor and the live pipeline can never disagree on "what counts as low confidence."

### 3.4 `age_appropriateness` — `source:'deterministic'`
- Inputs: `screenStudentFacingText(text,{grade,subject}) → { safe, categories[] }` (`output-screen.ts`) + `validateContentScope` grade-range heuristic.
- Three-level health (deterministic proxy — the offline judge is the authority for the fine-grained score):
  - `1.0` — clean (`safe === true`, no `legacy_validator_flag`, grade-range heuristic passes).
  - `0.5` — advisory only (`legacy_validator_flag` present, or grade-range heuristic soft-fails) — surfaced, not fatal.
  - `0.0` — hard fail (`safe === false` via `blocklist` or `screen_error`).
- `code`: first of `['blocklist','screen_error','legacy_validator_flag','grade_range_soft']` present, else `'clean'`.
- `raw = null`.
- Offline authority for the graded value: `foxy_quality_scores.age_appropriateness/100`.

### 3.5 `difficulty_fit` — `source:'mastery'` (advisory — **never flags**)
- Inputs: `cognitiveCtx.masteryLevel ∈ [0,1]` + `topicProgress` (ZPD proximity context).
- **Bands reused verbatim from `cognitive-engine.ts` — no new thresholds invented:**
  - `0.4` — developing/building boundary (`getMasteryDisplayBadge`, `cognitive-engine.ts:1465`; also the `conceptual` error-class floor at `:925`).
  - `0.7` — BKT `pKnow` mastery threshold (`cognitive-engine.ts:228`, `:899`, `:923`).
  - `0.85` — ZPD sweet-spot ceiling (Vygotsky 70–85% success band, `calculateZPD`, `cognitive-engine.ts:281`).
- Health mapping (higher = better fit to the learner's ZPD):
  - `masteryLevel ∈ [0.4, 0.85)` → `1.0` (productive-struggle / ZPD sweet spot — content difficulty is well matched).
  - `masteryLevel < 0.4` (building) → `0.5` (content likely too hard for current mastery — scaffold down).
  - `masteryLevel ≥ 0.85` (over-mastered) → `0.5` (content likely too easy — stretch up one Bloom level).
  - Note: `0.7` is the internal developing→secure cut used for the `code` label only (`'building' | 'developing' | 'secure' | 'over_mastered'`); it does not change the health value.
- `raw = masteryLevel`.
- **Never contributes a flag reason** — the runtime signal is a *proxy* (mastery band), not a measured difficulty match, so it is reported for trend analysis but must not gate observability alerts.

### 3.6 `learning_effectiveness` — deferred
- `available:false`, `score:null`, `raw:null`, `source:'deferred_llm_judge'`.
- Offline authority: `foxy_quality_scores.scaffoldFidelity/100` (scaffold fidelity is the closest offline construct to "did this response teach effectively"). Runtime cannot measure pedagogical effect without a judge.

### 3.7 `toxicity` — `source:'deterministic'`
- Inputs: `screenStudentFacingText` `safe` / `categories`.
- Health: `score = (categories includes 'blocklist' || 'screen_error') ? 0 : 1` (binary — the hard-block set is unambiguous profanity/slurs/directed self-harm/chat-template injection; see `output-screen.ts` header).
- `code`: `'blocklist'` | `'screen_error'` | `'clean'`. `raw = null`.
- Note: `age_appropriateness` and `toxicity` share the output-screen source but read **different** category signals — `toxicity` reads only the hard `blocklist`/`screen_error`; `age_appropriateness` also reads the softer `legacy_validator_flag` + grade-range heuristic.

### 3.8 `latency` — `source:'gateway'` (store raw + health)
- Inputs: `raw = Date.now() - startTime` (wall clock), cross-checked against `grounded.meta.latency_ms`.
- **Named anchors (§3.10):** `LATENCY_HEALTHY_MS` = `HAIKU.p50LatencyMs` (**800**, reused from `gateway/registry.ts:53` — production student-facing turns run on Haiku); `LATENCY_DEGRADED_CEILING_MS` (named SLA ceiling for a grounded RAG turn).
- Health mapping:
  - `raw ≤ LATENCY_HEALTHY_MS` → `1.0`.
  - `LATENCY_HEALTHY_MS < raw ≤ LATENCY_DEGRADED_CEILING_MS` → linear decay `1 → 0`.
  - `raw > LATENCY_DEGRADED_CEILING_MS` → `0.0` (and flags — §4).
- `code`: `'healthy' | 'degraded' | 'over_ceiling'`.

### 3.9 `cost` — `source:'gateway'` (store raw + health)
- Inputs: `raw = estimateCostUsd(model, inputTokens, outputTokens)` (`gateway/registry.ts:215`), token counts from `grounded.meta.tokens_used` and `grounded.meta.claude_model`.
- **Named anchors (§3.10):** `COST_PER_TURN_BUDGET_USD`, `COST_PER_TURN_CEILING_USD`, both seeded from the registry's published Haiku pricing (`inputCostPer1M:1.0`, `outputCostPer1M:5.0`, `registry.ts:50-51`).
- Health mapping (same shape as latency): `1.0` at/below budget, linear decay to `0.0` at ceiling, `0.0` above (flags).
- `code`: `'within_budget' | 'elevated' | 'over_ceiling'`.

### 3.10 Named constants (single source of truth — no inline magic numbers)

| Constant | Value / binding | Source of the value |
|---|---|---|
| `HALLUCINATION_CONFIDENCE_FLOOR` | **bind to** `STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` | `grounded-answer` edge fn config (reused, not re-declared) |
| `UNGROUNDED_CONFIDENCE_CAP` | **bind to** `SOFT_CONFIDENCE_BANNER` threshold | `grounded-answer` edge fn config (reused) |
| `MASTERY_BUILDING_MAX` | `0.4` | `cognitive-engine.ts:1465` / `:925` |
| `MASTERY_SECURE_MIN` | `0.7` | `cognitive-engine.ts:228` / `:899` / `:923` |
| `MASTERY_ZPD_CEILING` | `0.85` | `cognitive-engine.ts:281` (ZPD 70–85% band) |
| `LATENCY_HEALTHY_MS` | `800` | `gateway/registry.ts:53` (`HAIKU.p50LatencyMs`) |
| `LATENCY_DEGRADED_CEILING_MS` | named SLA ceiling; seed conservatively from observed grounded-turn p95, tune post-launch | new named constant — rationale: grounded path = retrieval + rerank + generation, materially slower than a bare model p50; documented, not inline |
| `COST_PER_TURN_BUDGET_USD` | derived from registry Haiku pricing (`$1/1M` in, `$5/1M` out) | `gateway/registry.ts:50-51` |
| `COST_PER_TURN_CEILING_USD` | named ceiling ≥ budget; seed from observed p95 per-turn cost | new named constant, documented |

The two "new" named constants (`LATENCY_DEGRADED_CEILING_MS`, `COST_PER_TURN_CEILING_USD`) are the only values not reused from existing code. They are **named, table-documented, and seeded from observed p95** rather than guessed — no bare literal appears at a call site.

---

## 4. Overall Verdict — `flagged` + `flagReasons`

`flagged` is a boolean; `flagReasons` is a sorted, deduped array of **stable string codes**. Flagging is **observability only** — it never blocks, refunds, retries, or alters the response.

| Flag code | Condition | Dimension |
|---|---|---|
| `toxicity_unsafe` | `toxicity.score === 0` (blocklist or screen_error) | toxicity |
| `age_inappropriate` | `age_appropriateness.score === 0` (hard fail) | age_appropriateness |
| `curriculum_out_of_scope` | `curriculum_alignment.score === 0` (`inScope === false`) | curriculum_alignment |
| `hallucination_risk_high` | `hallucination_risk.raw < HALLUCINATION_CONFIDENCE_FLOOR` **and** `groundedFromChunks === false` | hallucination_risk |
| `latency_over_ceiling` | `latency.raw > LATENCY_DEGRADED_CEILING_MS` | latency |
| `cost_over_ceiling` | `cost.raw > COST_PER_TURN_CEILING_USD` | cost |

`flagged = flagReasons.length > 0`.

**Explicitly NON-flagging:** `difficulty_fit` (advisory proxy — §3.5), `accuracy` and `learning_effectiveness` (deferred/null at runtime — cannot flag). A deferred dimension is never a flag reason.

> **Emphasis (binding):** a `flagged` record is a *dashboard signal*, not an enforcement action. The response the student saw is unchanged. Enforcement (blocking unsafe text) is the job of the pre-existing live `screenStudentFacingText` abstain path — `ResponseEval` only *records* that it happened.

---

## 5. PII / P13 Rules

The emitted record carries **dimension scores + stable codes + correlation UUIDs + numbers ONLY**. It mirrors the `ff_foxy_perception_v1` / `learner.turn_classified` posture (codes/ids/enums only) and rides `logOpsEvent`'s `redactContext` redaction.

**MUST carry:** the 9 `DimensionEval` scores/raws/codes, `flagged`, `flagReasons`, `trace_id`, `session_id`, `message_id`, `grade` (scope enum), `subject` (code).

**MUST NEVER carry:** response text, prompt/student-message content, citation `chunk_text`, student name/email/phone, raw IP, bearer token, or any free-text the model produced. If a student identifier is needed for correlation, it is passed as an already-non-PII UUID (`session_id`/`message_id`) or hashed via `hashPII()` — never raw.

The `output-screen` categories (`'blocklist'`, `'legacy_validator_flag'`, `'screen_error'`) and the curriculum `reason` enum are **stable codes, not text**, and are safe to emit (this is exactly the P13-clean design of `output-screen.ts`, which logs "a CATEGORY-ONLY ops event … never the text").

---

## 6. Emission

- **Channel:** fire-and-forget via `logOpsEvent({ category: 'ai', source: 'response-eval', severity: 'info', message: 'response_eval', context: <scores+codes+numbers>, subjectType: 'foxy_message', subjectId: message_id, requestId: trace_id })`.
- `severity: 'info'` ⇒ `logOpsEvent` treats it as fire-and-forget (no awaited DB round-trip on the response path — see `ops-events.ts` header). The eval builder itself is also invoked fire-and-forget from the route (same pattern as `classifyTurn` / perception).
- **Never throws:** the builder is wrapped end-to-end in try/catch and **returns `null` on any failure** (missing signal, math error, redaction error). A `null` means "no eval emitted this turn" — identical fail-safe posture to `classifyTurn` (`perception.ts`) and `scoreFoxyAnswer` (`quality-eval.ts`). It can never propagate into the student's response.
- **Sink:** `ops_events` (existing append-only table). **No new table in this increment.**
- **Flag:** with `ff_response_eval_v1` OFF the builder is not invoked → response path byte-identical.

### 6.1 Explicit later increments (out of scope here)
- A dedicated `response_evals` table (one row per eval, `message_id`-keyed, joinable to `foxy_quality_scores` for the 2 deferred dims) with RLS + policies in the same migration.
- A super-admin dashboard surface, mapped onto the **existing `foxy-quality` page**, showing runtime-vs-offline dimension drift.
- Backfill of the deferred `accuracy` / `learning_effectiveness` from the nightly judge onto the runtime row.

---

## 7. Alignment with Offline Evals (shared vocabulary)

Runtime and offline evaluators MUST share dimension names and scales so drift is measurable. Runtime health is `[0,1]`; the offline rubric is `[0,100]` → **runtime = offline / 100**.

| Runtime dim | Offline `foxy_quality_scores` (rubric v2) | Eval-harness `eval/rag/scoring.ts` | Notes |
|---|---|---|---|
| `accuracy` | `accuracy` (0..100) | `citation_correct` / `no_citations` | Deferred; offline is authority. |
| `learning_effectiveness` | `scaffoldFidelity` (0..100) | — | Deferred; offline is authority. |
| `age_appropriateness` | `age_appropriateness` (0..100) | — | Runtime = deterministic proxy; offline is graded authority. |
| `curriculum_alignment` | `cbse_scope` (0..100) | `scope_correct`; `scope_mismatch:*` fail codes | Runtime boolean → `{0,1}`; same construct as harness `scope_correct`. |
| `hallucination_risk` | (via `accuracy` + citations) | `citation_correct`, `no_citations`, `forbidden_phrase` | Runtime uses `confidence`+`groundedFromChunks`+`citations`; codes align to harness citation taxonomy. |
| `latency` | — | `mean_latency_ms`, `p95_latency_ms` | Same units (ms); runtime adds a health normalization. |
| `cost` | — | — | Runtime-only; from gateway registry. |
| `toxicity` | (subsumed under age in offline) | `forbidden_phrase` | Runtime splits it out as a distinct deterministic dim. |
| `difficulty_fit` | — | — | Runtime-only pedagogy proxy; advisory. |

Naming rule: where an offline construct exists, the runtime dimension reuses its **name and meaning**; the runtime `code` values reuse the harness `fail_reason` / `output-screen category` / curriculum `reason` vocabularies rather than inventing parallel strings.

---

## 8. Review Chain

Per `.claude/CLAUDE.md` P14, learner-state/pedagogy correctness rules (dimension definitions, bands, flag conditions) are **assessment-owned**; the plumbing (reading route signals, wiring `logOpsEvent`, the flag) is ai-engineer + ops. Required reviewers before implementation ships: **assessment (this spec), ai-engineer, testing.** No change to P1–P6, so no user-approval gate is triggered; the additive, default-OFF, observability-only posture keeps this within autonomous-decision scope.

---

## 9. Summary (contract at a glance)

9 dimensions, common scale `[0,1]` health (higher = better), 2 deferred:

| # | Dimension | Source | Normalization | Flags? |
|---|---|---|---|---|
| 1 | `accuracy` | `deferred_llm_judge` | `null` at runtime; offline `accuracy/100` | no (deferred) |
| 2 | `curriculum_alignment` | `curriculum` | `inScope ? 1 : 0`; `code=reason` | **yes** (`curriculum_out_of_scope`) |
| 3 | `hallucination_risk` | `grounding` | raw=`confidence`; health=`confidence` (capped if ungrounded) | **yes** (`hallucination_risk_high`) |
| 4 | `age_appropriateness` | `deterministic` | 1.0 clean / 0.5 advisory / 0.0 hard-fail | **yes** (`age_inappropriate`) |
| 5 | `difficulty_fit` | `mastery` | bands 0.4/0.7/0.85 → 1.0 in ZPD, 0.5 out | no (advisory proxy) |
| 6 | `learning_effectiveness` | `deferred_llm_judge` | `null` at runtime; offline `scaffoldFidelity/100` | no (deferred) |
| 7 | `toxicity` | `deterministic` | blocklist/screen_error → 0, else 1 | **yes** (`toxicity_unsafe`) |
| 8 | `latency` | `gateway` | raw ms; 1.0 ≤800ms, linear to 0 at ceiling | **yes** (`latency_over_ceiling`) |
| 9 | `cost` | `gateway` | raw USD; 1.0 ≤budget, linear to 0 at ceiling | **yes** (`cost_over_ceiling`) |

**Deferred (nullable, offline-sourced):** `accuracy`, `learning_effectiveness`.

**Flag conditions (observability only, never blocks):** `toxicity_unsafe` (toxicity=0) · `age_inappropriate` (age=0) · `curriculum_out_of_scope` (inScope false) · `hallucination_risk_high` (confidence < `HALLUCINATION_CONFIDENCE_FLOOR` AND not grounded) · `latency_over_ceiling` (> `LATENCY_DEGRADED_CEILING_MS`) · `cost_over_ceiling` (> `COST_PER_TURN_CEILING_USD`).

**Guardrails:** no sync LLM call · never blocks/alters response · writes no mastery/progression · fire-and-forget via `logOpsEvent` (`category:'ai'`, `source:'response-eval'`) · returns `null` on any failure · `ops_events` sink (no new table this increment) · flag `ff_response_eval_v1` default OFF ⇒ byte-identical.
