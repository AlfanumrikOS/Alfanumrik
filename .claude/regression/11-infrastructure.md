## MoL Phase 1A — Admin-Functions Rollback Flag + Oracle Grader Bypass (2026-06-03) — REG-70..REG-71

Source: Mixture-of-LLMs Phase 1A migration routed 6 admin/async Edge Functions
(`bulk-question-gen`, `bulk-non-mcq-gen`, `generate-concepts`, `generate-answers`,
`extract-ncert-questions`, `parent-report-generator`) from direct
`fetch('https://api.anthropic.com/v1/messages', ...)` to MoL `generateResponse()`
with OpenAI gpt-4o-mini as the cost-cut primary. The rollback flag
(`ff_mol_admin_functions_v1`) flips all six back to legacy Anthropic in seconds
without a redeploy. The `bulk-question-gen` MCQ oracle grader is the one path
that ALWAYS bypasses MoL — it requires deterministic temperature=0 verdicts
that MoL cannot honor until `GenerateRequest.config.temperature_override`
lands (tracked as a follow-up).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-70 | `mol_admin_routing_rollback_flag_p12` | `ff_mol_admin_functions_v1` rollback flag flips all 6 admin Edge Functions (`bulk-question-gen`, `bulk-non-mcq-gen`, `generate-concepts`, `generate-answers`, `extract-ncert-questions`, `parent-report-generator`) back to the legacy direct-Anthropic-API path within the 5-min flag-cache TTL. Kill-switch precedence (per `supabase/functions/_shared/mol/admin-rollback-flag.ts`): `metadata.kill_switch === true` → legacy; else `typeof metadata.enabled === 'boolean'` → that value; else `is_enabled` column. Defensive default: any flag-read failure → legacy path (never routes to OpenAI when ops thinks the switch is off). Verification: ops `update feature_flags set is_enabled=false where flag_name='ff_mol_admin_functions_v1'`; within 5 min `mol_request_logs.provider` for the 6 functions = 'anthropic' on new rows. | `supabase/functions/_shared/mol/admin-rollback-flag.ts` (helper + unit-test coverage in `_shared/mol/__tests__/admin-rollback-flag.test.ts`) | E |
| REG-71 | `bulk_question_gen_oracle_grader_bypasses_mol_p6` | `callOracleGrader` in `supabase/functions/bulk-question-gen/index.ts` bypasses MoL routing entirely and unconditionally calls `callOracleGraderLegacy` (direct Anthropic `claude-haiku-4-5-20251001` with `temperature: 0` and `QUIZ_ORACLE_GRADER_SYSTEM_PROMPT`). The function body MUST NOT contain an `isMolAdminRoutingEnabled()` branch — the bypass is unconditional. The MCQ-GENERATION path (`callClaude`) still routes through MoL because its validators reject bad output; the grader has no such safety net because it IS the validator. Until `GenerateRequest.config.temperature_override` is implemented, MoL providers' ~0.7 default would break REG-54's admission-gate determinism. Verification: source-grep `callOracleGrader` in `bulk-question-gen/index.ts` shows NO `isMolAdminRoutingEnabled` check; calls `callOracleGraderLegacy` directly. Why this matters: P6 admission gate must be deterministic; non-deterministic verdicts would cause oracle telemetry skew and undermine REG-54 audit reliability. | `supabase/functions/bulk-question-gen/index.ts` (`callOracleGrader` function — static-source pin; suite under `supabase/functions/bulk-question-gen/__tests__/`) | E |

### Invariants covered by this section

- P6 (question quality — REG-71 keeps the oracle admission gate
  deterministic by pinning temperature=0; non-deterministic verdicts
  would let inconsistent admit/reject decisions corrupt the
  `question_bank` quality bar that REG-54 audits)
- P12 (AI safety — REG-70 instant rollback flag bounds blast radius of
  any OpenAI-side incident across all 6 admin Edge Functions without a
  redeploy; defensive-default-legacy on flag-read failure ensures
  ops-intended OFF state always wins)

### Notes on test strategy

REG-70 is enforced by the existing
`supabase/functions/_shared/mol/__tests__/admin-rollback-flag.test.ts`
unit suite which exercises the three-tier precedence ladder and the
defensive-default-on-read-error branch. The 5-min cache TTL is part of
the flag-helper's documented contract (cached read with TTL eviction);
the test asserts the precedence ladder, not the cache wall clock.

REG-71 is a static-source canary in the same family as REG-50, REG-57,
REG-59: the contract is the absence of a code path. If a future PR
re-introduces `isMolAdminRoutingEnabled()` into `callOracleGrader`,
the canary fails. The bypass MUST be deleted only when
`GenerateRequest.config.temperature_override` lands and the MoL
evaluation chain can honor `temperature: 0`; at that point both
REG-71 and the function-header comment block should be updated in the
same PR.

### Catalog total

Pre-MoL-Phase-1A: 40 entries. MoL Phase 1A adds REG-70, REG-71.

**Total: 42 entries.**

## Python AI Service Health Contract (2026-05-24) — REG-72

Source: Phase 0 of the Python-on-Cloud-Run migration. The CEO approved
the TypeScript-to-Python AI/ML rewrite (3-6 week transition). ai-engineer
owns `python/services/ai/`; architect owns the Cloud Run deploy pipeline;
ops owns the operational layer ([PYTHON_AI_OPERATIONS.md](../docs/PYTHON_AI_OPERATIONS.md),
[super-admin-python-ai-dashboard-spec.md](../docs/super-admin-python-ai-dashboard-spec.md)).

Cloud Run uses the readiness probe to decide whether to route traffic to
an instance. A service that returns 200 from `/live` (process alive)
but cannot actually serve requests (missing Supabase credentials,
provider API keys unreachable, configuration drift) MUST be taken out
of rotation automatically. The two-endpoint pattern is the standard
Kubernetes-style liveness/readiness split adapted to Cloud Run; getting
it wrong means a half-broken instance serves errors until ops manually
notices.

The liveness endpoint is named `/live` (not `/healthz`) because Cloud
Run's frontend intercepts the path `/healthz` before it reaches the
container and returns Google's own 404 HTML page (confirmed
2026-05-24 by direct probe — `/foo` returned FastAPI's JSON 404,
`/openapi.json` showed `/healthz` IS registered, but external
`curl /healthz` returned Google's HTML 404 instead of `{"status":"ok"}`).
`/live` is not reserved by Cloud Run and works as expected. The contract
itself (always-200, no I/O, no external deps) is unchanged.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-72 | `python_ai_service_health_contract` | Cloud Run service exposes two distinct HTTP endpoints with different semantics: (1) `/live` returns 200 whenever the FastAPI process is alive — used by Cloud Run liveness probe to decide whether to restart the container. The path is `/live` (not `/healthz`) because Cloud Run's frontend intercepts `/healthz` before the request reaches the container; confirmed 2026-05-24. (2) `/readyz` returns 200 ONLY when ALL upstream dependencies are healthy (Supabase URL + service-role key resolve and respond; Anthropic + OpenAI API keys present and not expired); returns 503 with a diagnostic JSON body listing which dependency failed when any of these checks fail — used by Cloud Run startup probe to gate the instance from being added to the load-balancer rotation. The Cloud Run service manifest MUST configure the startup probe to hit `/readyz` (not `/live` and not a TCP probe) so a degraded service is removed from rotation automatically rather than serving requests it cannot fulfill. On Cloud Run gen2, the startup probe is the gating signal — once it passes, the instance is in rotation, and the liveness probe (against `/live`) governs whether to restart. Verification: pytest integration tests in `python/tests/integration/test_generate_endpoint.py` cover the two-endpoint contract (good env → both 200; missing provider key → /readyz 503). The Cloud Run service manifest at `python/deploy/service.yaml` declares `startupProbe.httpGet.path: /readyz` and `livenessProbe.httpGet.path: /live`. | `python/tests/integration/test_generate_endpoint.py` (FastAPI TestClient — health endpoint contracts) + `python/deploy/service.yaml` (Knative-on-Cloud-Run manifest, version-controlled probe wiring) + `.github/workflows/python-ai-deploy.yml` (declarative `gcloud run services replace` step) | R (resolved 2026-05-24 — service.yaml landed with startup-probe → /readyz and liveness-probe → /live; workflow switched from `gcloud run deploy` CLI flags to declarative manifest apply; liveness path renamed from /healthz → /live to bypass Cloud Run frontend interception) |

### Invariants covered by this section

- Service-availability contract (operational invariant) — the readiness
  probe is the only mechanism by which Cloud Run knows a Python instance
  is unhealthy. If `/readyz` is wired to the same code path as
  `/live`, a Python instance with broken Supabase credentials will
  serve 500s until the next deploy. REG-72 pins the distinct-semantics
  contract.
- P12 (AI safety — adjacent): a Python instance that returns 503 from
  `/readyz` cannot accept requests, so it cannot serve any AI response
  (correct or otherwise). Fail-closed posture matches existing
  defensive defaults in `admin-rollback-flag.ts` and the proxy fallback
  flag.

### Notes on test strategy

REG-72 shipped in three iterations and resolved 2026-05-24:

1. **Phase 0 (originally catalogued, M).** Specification only — no
   FastAPI app on disk; no Cloud Run service. Quality gate: any PR
   landing the FastAPI app without both endpoints OR without YAML
   probe wiring must fail REG-72.
2. **Phase 1 (M).** FastAPI app landed at `python/services/ai/api/`
   with the two-endpoint split (`health.py:live` + `health.py:readyz`).
   Integration tests at `python/tests/integration/test_generate_endpoint.py`
   exercise both endpoints. Deploy workflow still used `gcloud run deploy`
   CLI flags, which do not expose `startupProbe.httpGet.path` — so a
   degraded instance could still be routed traffic. REG-72 stayed in `M`
   for this gap.
3. **Phase 1A wave 2 (R, 2026-05-24).** `python/deploy/service.yaml`
   landed as a Knative-on-Cloud-Run manifest declaring
   `startupProbe.httpGet.path: /readyz` and
   `livenessProbe.httpGet.path: /live`. The deploy workflow switched
   from `gcloud run deploy` (CLI flags) to `gcloud run services replace`
   (declarative manifest apply). The liveness path was renamed from
   `/healthz` → `/live` in the same wave after a post-deploy smoke
   confirmed Cloud Run's frontend intercepts `/healthz` before it
   reaches the container (Google returns its own 404 HTML page).
   REG-72 is now end-to-end: app exposes the two endpoints, tests
   assert their contract, and the manifest pins the probe wiring in
   version control.

The follow-up dedicated YAML-contract test (originally proposed as
`python/deploy/__tests__/test_service_yaml.py`) is deferred — the
workflow already runs `yaml.safe_load` on the rendered manifest before
`gcloud` is invoked, and the rendered manifest is printed in the
workflow log on every deploy for audit. A dedicated parsing test
would be defense-in-depth but adds no new failure-mode coverage.

### Catalog total

Pre-Phase-0: 42 entries. Phase 0 adds REG-72.

**Total: 43 entries.**

## Python AI Service Phase 1 — Request/Response Parity + Cutover Kill Switch (2026-05-24) — REG-73..REG-74

Source: Phase 1 of the Python-on-Cloud-Run migration ships the first
production AI workload (`bulk-question-gen`) on the new FastAPI service.
The TS Edge Function at `supabase/functions/bulk-question-gen/index.ts`
remains the canonical entry point; the new `_shared/python-ai-proxy.ts`
helper forwards eligible requests to the Cloud Run endpoint and falls
back to the legacy TS path on any rejection. REG-73 pins the
TS↔Python wire contract; REG-74 pins the 3-layer rollback / cutover
gating that ramps the rollout.

These are the first two catalog entries that span the TS Edge Function
boundary and the Python FastAPI surface — a future cutover regression
on either side would cascade into total `bulk-question-gen` outage
(and, by extension, every Phase 2-6 workload once they reuse the same
proxy helper).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-73 | `python_ai_bulk_question_gen_request_response_parity` | TS↔Python wire-contract parity for `bulk-question-gen`. (1) **Request body shape**: TS Edge Function destructures exactly 7 fields from the JSON body — `grade`, `subject`, `chapter`, `chapter_id`, `count`, `difficulty`, `bloom_level`. Python `BulkQuestionGenRequest` Pydantic model at `python/services/ai/business/bulk_question_gen/models.py` declares the same 7 fields with identical names, types, and defaults. (2) **Strict-mode rejection**: the Pydantic model uses `model_config = ConfigDict(extra='forbid')` so any future TS-side field addition that Python doesn't know about will fail with HTTP 422 — drift between the two sides cannot be silent. (3) **Response body shape**: Python returns `{generated, inserted, rejected, oracle_evaluated, oracle_rejected, questions[], warning?}`; TS proxy passes this through unchanged. Field-for-field equality enforced — adding a Python field without the TS proxy expecting it is also a breaking change. Closes the #1 Phase 1 cutover risk: a silent TS-or-Python-only field addition that 422s every bulk-question-gen request after deploy. | `supabase/functions/bulk-question-gen/index.ts` body destructuring + `python/services/ai/business/bulk_question_gen/models.py` Pydantic model (parity contract; dedicated parity test file to be added in Phase 1.2 — recommend a contract test that reads both source files and asserts field-set equality, OR a runtime test that POSTs the same JSON to both surfaces and asserts no 422). | M (parity contract documented; dedicated test file to land in Phase 1.2 — catalog entry acts as the explicit gating contract until then) |
| REG-74 | `python_ai_cutover_kill_switch_three_layer_precedence` | 3-layer kill-switch precedence in `supabase/functions/_shared/python-ai-proxy.ts` MUST evaluate in this order and short-circuit to the TS legacy path on ANY layer rejecting: (1) `PYTHON_AI_BASE_URL` env unset → TS path regardless of flag state (architect-level escape hatch — beats the 5-min flag cache, takes effect on next Edge Function deploy in seconds). (2) `metadata.enabled === false` OR `metadata.kill_switch === true` on the feature flag → TS path. (3) Hash-bucket(`request_id`) % 100 ≥ `metadata.rollout_pct` → TS path (deterministic per-request bucketing so the same student gets the same provider within a session). Only if all 3 layers say "yes" does the proxy forward to Cloud Run. The 5-min flag-cache TTL bounds the worst-case ops-controlled rollback latency; the env-unset layer is the seconds-scale escape hatch. Existing 14 unit tests cover each layer in isolation; REG-74's addition is the **precedence-order parity test** that asserts the full chain — a future refactor could drop or reorder a layer and the per-layer tests would still pass while the contract was silently broken. | `supabase/functions/_shared/python-ai-proxy.ts` (proxy module) + `supabase/functions/_shared/__tests__/python-ai-proxy.test.ts` (14 unit tests cover per-layer behaviour; ONE additional precedence-chain order test to land in Phase 1.2 asserting env-unset > enabled-true > kill-switch-false > rollout-bucket-hit must all hold for the proxy to forward) | P (per-layer coverage exists at 14 unit tests; precedence-chain order test deferred to Phase 1.2) |

### Invariants covered by this section

- HTTP contract integrity (operational invariant) — REG-73 pins
  request/response shape parity across the TS Edge proxy and the
  Python FastAPI endpoint. Any silent TS-or-Python-only field addition
  would cascade into HTTP 422 on every bulk-question-gen request after
  deploy; the contract being explicit in the catalog forces both sides
  to update together.
- P12 (AI safety) — REG-74 pins the cutover safety boundary. Three
  independent rejection layers (env unset, flag disabled, rollout
  bucket miss) each route to the TS legacy path; the seconds-scale
  env-unset escape hatch beats the 5-min flag-cache TTL so a Cloud Run
  outage can be drained on the next Edge Function deploy without
  waiting for the cache to settle. The same proxy helper is reused by
  Phases 2-6 workloads, so REG-74's precedence-order contract bounds
  blast radius for the entire Python migration.
- Service-availability contract (operational invariant, adjacent to
  REG-72) — together with REG-72's `/readyz` readiness-probe pin,
  REG-74's kill-switch ensures a degraded Python service cannot be
  silently traffic-pinned: Cloud Run takes the instance out of
  rotation on `/readyz` 503, and the proxy short-circuits to TS on
  flag/env disable. Defense in depth.

### Notes on test strategy

REG-73 follows the contract / parity pattern (see REG-37, REG-50,
REG-51, REG-54, REG-71): the canonical sources are the TS handler's
body destructuring and the Python Pydantic model. A dedicated parity
test can be either:

1. **Static-source contract test** — read both files via `node:fs`
   (TS) and `pyyaml`/AST (Python), extract the field sets, assert
   equality. Fast, no runtime dependency.
2. **Runtime contract test** — boot the Python FastAPI app under
   `TestClient`, POST a request the TS handler would forward, assert
   no 422 and matching response shape. Catches semantic drift the
   static test would miss (e.g. default-value drift).

Phase 1.2 should ship the static test as the gating regression and
the runtime test as an integration check. Until then, REG-73's
catalog entry is the gating contract — quality MUST reject any PR
that adds a field to one side without the other.

REG-74 is enforced today by the existing per-layer unit suite at
`supabase/functions/_shared/__tests__/python-ai-proxy.test.ts`
(14 tests). The Phase 1.2 follow-up adds ONE precedence-chain order
test asserting the full ladder semantics — env-unset wins over
enabled-true wins over kill-switch-false wins over rollout=100. The
existing tests would still pass if a future refactor swapped the
order; the new test pins the order itself.

The 3-layer kill-switch design is the same fail-closed-on-failure
posture as `admin-rollback-flag.ts` (REG-70) and matches the
operational philosophy that ops-intended-OFF must always beat
any other signal. REG-74 catalogues that posture for the
Python-migration surface.

### Catalog total

Pre-Phase-1: 43 entries. Phase 1 adds REG-73, REG-74.

**Total: 45 entries.**

## Voice 1b — Azure Indian-Accent TTS (2026-05-24) — REG-75

Source: Voice 1b adds `POST /v1/voice/synthesize` on the Python AI Cloud
Run service — the output half of Foxy's voice loop (Voice 1a / Whisper
STT is the input half, REG-72-adjacent telemetry). Returns Indian-accent
neural speech (en-IN-* and hi-IN-*) via Azure Cognitive Services Speech.

The endpoint isn't wired to any client yet (Voice 2 lands the
`src/lib/voice.ts` half behind `ff_python_voice_tts_v1`), so the surface
is service-side only. But the voice catalog and SSML builder are the
two layers between student text and Azure billing, and either regressing
silently would be a direct CEO-ask violation: the entire feature is
"Indian accent" (catalog regression → wrong accent shipped to students)
or "no spend leakage" (SSML escape regression → injection of SSML tags
into the request body).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-75 | `voice_1b_tts_voice_selection_and_ssml_safety` | Two-pronged contract on the TTS request builder. (1) **Voice catalog correctness:** `VOICE_CATALOG` covers all 6 (language, gender) tuples (en/hi/hinglish × female/male). EVERY voice id is an Indian-accent neural voice — prefix `en-IN-` or `hi-IN-`, suffix `Neural`. Hinglish routes through Hindi voices (Swara/Madhur) because they pronounce Latin loanwords with natural Indian-English phonemes. `resolve_voice` precedence: override > catalog > en-IN-Neerja fallback. A regression to e.g. `en-US-JennyNeural` would ship audio with a US accent and violate the direct CEO ask. (2) **SSML escaping safety:** `build_ssml` HTML-escapes all 5 XML special chars (`& < > " '`) via `html.escape(text, quote=True)` before embedding into the SSML body. A student-supplied `</voice>` would otherwise prematurely close the voice tag and inject neighbouring audio segments; a raw `<voice name='evil'>` could swap in an arbitrary voice mid-utterance. (3) **voice_override regex enforcement:** Pydantic field validator rejects any voice_override that doesn't match `^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$` — arbitrary attacker-controlled strings cannot reach Azure's SSML. xml:lang derivation from voice prefix is also pinned (en-IN-* → `xml:lang='en-IN'`; hi-IN-* → `xml:lang='hi-IN'`). | `python/tests/unit/test_voice_tts.py::test_resolve_voice_returns_indian_voices_for_all_lang_gender_combos`, `python/tests/unit/test_voice_tts.py::test_build_ssml_escapes_xml_entities`, `python/tests/unit/test_voice_tts.py::test_build_ssml_uses_correct_xml_lang_for_voice_prefix`, `python/tests/unit/test_voice_models.py::test_voice_override_must_match_neural_regex` | E |

### Invariants covered by this section

- P12 (AI safety) — REG-75 pins the voice-catalog correctness (no
  wrong-accent regression) and the SSML escape contract (no
  attacker-controlled SSML reaches Azure). Both are defense lines
  between student-supplied text and Azure's billing surface; a silent
  regression on either would be a direct CEO-ask violation or an
  Azure-spend amplification.
- P13 (data privacy) — adjacent: the synthesize handler and
  repository writer carry only `char_count`, never the raw text, into
  `ops_events.context`. Same posture as the Whisper writer.

### Notes on test strategy

REG-75 follows the **same-file unit-test pattern** as REG-39 (Foxy
remediation distractor index 0..3) and REG-54 (AI quiz-generator
validation oracle) — three of the four pinned tests live in a single
unit file (`test_voice_tts.py`) and the fourth in the request-validator
file (`test_voice_models.py`). The full test suite for Voice 1b is 74
tests across 4 files; the 4 pinned tests above are the load-bearing
ones — adding a voice or relaxing the override regex without updating
them would break the catalog.

The voice_override regex is enforced at the **Pydantic field validator
layer**, not in the handler. This means an attacker who bypasses the
HTTP route entirely (e.g. by calling the handler from a future internal
helper) is still gated by the model boundary — the validator MUST stay
on `SynthesizeRequest`, not migrate to the route function body.

### Catalog total

Pre-Voice-1b: 45 entries. Voice 1b adds REG-75.

**Total: 46 entries.**

## Phase 2 generate-concepts Python port (2026-05-24) — REG-76

Source: Phase 2 continued — the third admin function port from TS Edge
to Python AI Cloud Run (after bulk-question-gen and generate-answers).
The Python port lives at `python/services/ai/business/generate_concepts/`;
the TS Edge function at `supabase/functions/generate-concepts/index.ts`
gains a proxy block that forwards to Cloud Run when
`ff_python_generate_concepts_v1` is bumped, with TS fallback on any
proxy failure. Default OFF (rollout_pct=0) until ops ramps.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-76 | `phase_2_generate_concepts_python_port_p5_p6_parity` | Three-pronged contract on the Python port of the concept-validation logic. (1) **P5 grade-as-string contract:** integer grade values must be rejected at the wire layer; every grade field on response chapter previews is a JSON string. (2) **P6 concept-quality validation parity:** `parse_concepts_response` rejects arrays with fewer than 3 concepts, caps arrays at 6 concepts, defaults invalid `difficulty` to 2 (matches TS index.ts:510-512), defaults invalid `bloom_level` to `understand` (matches TS index.ts:515-517), and silently skips concepts missing required fields (title / learning_objective / explanation / example_title / example_content). (3) **Wire-shape parity:** the response chapter preview surface (dry_run path) carries P5 string grade end-to-end so a Pydantic regression that accepted int grades on `ConceptInsertRow` would surface in integration tests before splitting traffic. | `python/tests/unit/test_generate_concepts_validator.py::test_rejects_array_with_less_than_3_concepts`, `python/tests/unit/test_generate_concepts_validator.py::test_caps_array_at_6_concepts`, `python/tests/unit/test_generate_concepts_validator.py::test_defaults_invalid_difficulty_to_2`, `python/tests/unit/test_generate_concepts_validator.py::test_defaults_invalid_bloom_to_understand`, `python/tests/unit/test_generate_concepts_validator.py::test_skips_concept_missing_required_field`, `python/tests/integration/test_generate_concepts_endpoint.py::test_post_returns_grade_as_string_in_response_chapters` | E |

### Invariants covered by this section

- P5 (grade format — strings) — REG-76 wire-level + insert-row contract
- P6 (question / concept quality) — REG-76 3-6 concept array bound,
  required-field validation, bloom + difficulty coercion
- P12 (AI safety) — REG-76 adjacent: the parser is the LAST gate before
  malformed LLM output reaches `chapter_concepts`. A regression that
  allowed 2-concept arrays or arbitrary bloom strings would ship bad
  concepts to students through the student-facing concept-card surface.

### Notes on test strategy

REG-76 is catalogued because the port introduces a SECOND
implementation of the concept-validation logic. The Edge proxy fallback
means traffic could be split: TS path returns rejection on bad input,
Python path inserts garbage — exactly the kind of split-brain we
designed the cutover to AVOID. The pinned tests live in:

- `python/tests/unit/test_generate_concepts_validator.py` — five tests
  on `parse_concepts_response`. These mirror the TS-side parser tests
  byte-for-byte at the contract level.
- `python/tests/integration/test_generate_concepts_endpoint.py` — one
  end-to-end test confirming the response chapter preview surface
  carries P5 string grade.

The Python and TS validators MUST agree on these rejection conditions:

| Input                          | TS verdict | Python verdict |
|--------------------------------|------------|----------------|
| Empty / non-array JSON         | None       | None           |
| Array with < 3 valid concepts  | None       | None           |
| Array with > 6 concepts        | Sliced to 6| Sliced to 6    |
| difficulty=99                  | Default 2  | Default 2      |
| bloom_level="evaluate"         | "understand" | "understand" |
| Missing learning_objective     | Skip concept | Skip concept |
| Missing explanation            | Skip concept | Skip concept |

If a future change diverges either side, REG-76 fails and the catalog
gates the PR. The pinned-test list at the top of this section is the
floor; the wider unit suite at `test_generate_concepts_validator.py`
(31 tests, every branch covered) provides the surface area.

### Catalog total

Pre-Phase-2-generate-concepts: 46 entries. Phase 2 generate-concepts
adds REG-76.

**Total: 47 entries.**
## Voice 2 Frontend Wiring — Cloud Run STT/TTS Fallback Safety (2026-05-24) — REG-77

Source: Voice 2 frontend wiring shipped the per-student flag-gated route
swap (`ff_python_voice_tts_v1`) from browser Web Speech API → Cloud Run
FastAPI (Whisper STT + Azure neural TTS) for the Foxy chat mic and
speaker buttons. The fallback path from Python to Web Speech is the
user-visible safety net — if a flag misconfiguration OR Cloud Run
outage causes a hard failure instead of fallback, voice breaks for
every gated student during the rollout.

The Voice 2 flag is per-STUDENT (not per-request like the admin-side
proxies in REG-73/74) so the same student gets a consistent voice
experience within a session. The hash function in
`src/lib/voice-feature-flag.ts:hashStudentBucket` is the byte-for-byte
port of `supabase/functions/_shared/python-ai-proxy.ts:hashBucket` so
server-side and client-side bucket calculations agree.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-77 | `voice_2_python_to_web_speech_fallback_safety` | (1) **Python success returns transcript/audio**: `startListening({ pythonEnabled: true, getJwt })` with a successful `transcribePython` mock emits `onResult(transcript, true)` + `onEnd()`; `speak({ pythonEnabled: true })` with a successful `synthesizePython` mock plays the audio Blob via Audio + fires `onEnd`. (2) **Python failure falls back to Web Speech (NOT user-visible)**: when `transcribePython` / `synthesizePython` throws ANY `PythonVoiceError` (4xx, 5xx, 0/NETWORK, 0/TIMEOUT, 0/ABORTED), `src/lib/voice.ts` catches the throw, emits a `console.warn` whose message contains "Python STT failed" / "Python TTS failed" + status + code BUT NEVER the transcript, audio bytes, or JWT, then calls into the existing Web Speech path. The Web Speech recognizer / utterance is created on the fallback — the user does not see a hard error. (3) **Flag OFF skips Python entirely**: `pythonEnabled: false` causes `startListening` and `speak` to run the legacy Web Speech path immediately with no `transcribePython` / `synthesizePython` invocation and no console.warn. (4) **No JWT → fallback without fetch attempt**: `pythonEnabled: true` + `getJwt: async () => null` falls through to Web Speech without invoking the Python client (no Cloud Run round-trip on an unauthenticated mic press). (5) **Fetch wrapper status preservation**: `voice-python-client.ts` throws `PythonVoiceError` with `.status` matching the HTTP status (401, 413, 503) and `.code` parsed from the response's `detail.error` field. Network rejections produce status=0 code=NETWORK_ERROR; AbortSignal cancellation produces status=0 code=ABORTED. Empty JWT triggers an immediate AUTH_FAILED throw with NO fetch attempt. (6) **Feature-flag safe defaults**: `usePythonVoiceEnabled(studentId)` returns false when studentId is null, when SWR data is undefined (fetch failed), when `kill_switch` is true, when `enabled` is false, when `rollout_pct` is 0, OR when the hash bucket misses. The hash bucket function is deterministic and matches `python-ai-proxy.ts:hashBucket` byte-for-byte. | `src/__tests__/lib/voice-python-routing.test.ts` (Voice 2 routing + fallback contract) + `src/__tests__/lib/voice-python-client.test.ts` (client error envelopes) + `src/__tests__/lib/voice-feature-flag.test.ts` (flag hook safe defaults + hash parity) | E |

### Pinned tests

- `src/__tests__/lib/voice-python-routing.test.ts::startListening — Python path::falls_back_to_web_speech_when_python_throws — REG-77`
- `src/__tests__/lib/voice-python-routing.test.ts::startListening — Python path::falls_back_to_web_speech_when_flag_off — REG-77`
- `src/__tests__/lib/voice-feature-flag.test.ts::usePythonVoiceEnabled::returns false when SWR fetch errored (data === undefined)`
- `src/__tests__/lib/voice-python-client.test.ts::transcribePython::throws PythonVoiceError with status 503 when service is misconfigured`

### Invariants covered by this section

- P12 (AI safety) — the user-visible safety net. A regressed fallback
  (e.g. a refactor that removes the try/catch around `transcribePython`)
  would cause Cloud Run outages to silently break voice for every
  student in the rollout bucket; only an explicit alarm on voice
  fallback rate would surface the failure. REG-77 pins the fallback
  contract so quality must reject any PR that breaks it.
- P7 (Bilingual UI) — `usePythonVoiceEnabled` returns the same
  decision for the same studentId, so a student speaking Hindi
  doesn't get a different voice provider on their next message. The
  hash parity test ensures client-side and server-side bucketing
  agree (the client decides voice routing; server-side analytics will
  partition request_id traffic via the existing python-ai-proxy
  helper).
- P13 (data privacy) — the `console.warn` on fallback logs ONLY error
  class + status + code, never the transcript, audio bytes, or JWT.

### Notes on test strategy

REG-77 spans three test files (mirroring the
`alfabot-system.test.ts` + `route.test.ts` + integration pattern used
by REG-66):

1. **`voice-python-client.test.ts`** — exercises every error branch of
   the fetch wrapper. Mocks `global.fetch` directly; never boots a real
   Cloud Run round-trip. Catches a regression that would let a 503
   silently return success or a 0/network throw under the wrong code.
2. **`voice-feature-flag.test.ts`** — exercises the `usePythonVoiceEnabled`
   hook + the underlying `decidePythonVoice` pure function. Includes the
   byte-for-byte hash-parity assertion against an inline re-implementation
   of `python-ai-proxy.ts:hashBucket` so a drift in either implementation
   surfaces in CI.
3. **`voice-python-routing.test.ts`** — exercises the `startListening` /
   `speak` wrappers in `src/lib/voice.ts` with a mocked Python client and
   a fake MediaRecorder / SpeechRecognition / SpeechSynthesis. Pins the
   four user-visible code paths: Python success, Python failure →
   fallback, flag-off → legacy path, JWT-missing → fallback without
   contacting Cloud Run.

If any of these contracts is reverted (e.g. a refactor moves the
`try/catch` out of the wrapper, the kill-switch precedence in the
hook flips, or the hash function changes), the suite fails and quality
MUST reject.

### Catalog total

Pre-Voice-2: 47 entries. Voice 2 adds REG-77.

**Total: 48 entries.**

## Cosmic Redesign — Phase 0 Foundation + Phases 1–3 dispatch (2026-06-05) — REG-78, REG-79

Source: the "cosmic" dark visual-identity foundation. A flag-gated
(`ff_cosmic_redesign_v1`, default OFF) presentational layer: cosmic theme
runtime (`src/lib/cosmic-theme.tsx`), cosmic tokens + primitives in
`src/app/globals.css` scoped under `html[data-design="cosmic"]`, the
`src/components/cosmic/*` primitive shells, and a `variant` on
`src/components/landing/FoxyMark.tsx`.

**Gating broadened (Wave G, 2026-06-05):** the cosmic skin now activates on a
4-input OR with a force-off escape hatch, resolved by `computeCosmicEnabled`
in `src/lib/cosmic-theme.tsx` and mirrored by the anti-FOUC pre-hydration
script in `src/app/layout.tsx`:

```
cosmicEnabled = forceOff ? false
                         : ( dbFlag                              // ff_cosmic_redesign_v1 ON in DB
                             || NEXT_PUBLIC_VERCEL_ENV==='preview' // Vercel PR preview deploy
                             || urlForce(?cosmic=1/preview)        // manual enable (any env)
                             || localStorage 'alfanumrik_cosmic_force'==='1' )
forceOff = (?cosmic=0) || (localStorage 'alfanumrik_cosmic_force'==='0')
```

This means **PR previews auto-show cosmic** (so the CEO sees the redesign on
the Vercel preview URL with zero DB seeding) while **production stays strictly
OFF** by default: on prod, `NEXT_PUBLIC_VERCEL_ENV==='production'` (not
`'preview'`), the seed migration `20260611000000_seed_ff_cosmic_redesign_v1.sql`
ships the DB row `is_enabled=false`, and there is no url/localStorage force —
so all four enable signals are false and no `data-design` is written. `next.config.js`
exposes `NEXT_PUBLIC_VERCEL_ENV = process.env.VERCEL_ENV ?? ''` (empty/undefined
in local + tests ⇒ not-preview ⇒ OFF-contributing). A `?cosmic=0` (or stored
'0') hard-disables EVERYTHING, including a DB-ON flag and a preview deploy, so
a tester can pin the legacy look for an A/B comparison.

The single load-bearing safety property of the entire redesign is unchanged
and is the production-OFF / flag-OFF pixel-identity guarantee: the whole dark
identity hinges on ONE attribute, `data-design="cosmic"` on `<html>`. The
cosmic CSS in `globals.css` is scoped under that attribute, so if it is never
written the dark theme can never paint. CosmicThemeProvider must write it ONLY
when `computeCosmicEnabled` resolves ON, and AuthContext must keep its
force-light behavior when cosmic is OFF (it owns `data-theme` in the OFF world;
the cosmic provider must not clobber it). A regression here — most dangerously
a preview signal leaking into production, or the force-off escape hatch
failing to beat an enable signal — would silently flip production to a dark,
half-themed surface for every user, a brand and legibility incident.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-78 | `cosmic_redesign_flag_off_pixel_identity` | Full gating-MATRIX contract on the cosmic foundation (broadened Wave G: production-OFF + preview-auto-enable + manual override). The enable decision is `forceOff ? false : (dbFlag \|\| isPreviewEnv \|\| urlForce \|\| localStorageForce)`. Pinned at the `<html>` DOM boundary: **(a) production:** `NEXT_PUBLIC_VERCEL_ENV='production'` + DB flag OFF + no force ⇒ `cosmicEnabled` false, NO `data-design`/`data-role` written (production byte-identical to today). **(b) preview:** `NEXT_PUBLIC_VERCEL_ENV='preview'` ⇒ cosmic AUTO-enables even with the DB flag OFF (`data-design="cosmic"` + `data-role="student"` + `data-theme="dark"` written) — the whole point: PR previews show the redesign with zero DB seeding. **(c) manual enable:** `?cosmic=1` (and case-insensitive `?cosmic=preview`) ⇒ cosmic ON in ANY env (proven in production), and is persisted to `localStorage 'alfanumrik_cosmic_force'='1'` so it survives client navigation; a pre-set localStorage '1' (no URL param) also enables. **(d) force-off beats everything:** `?cosmic=0` ⇒ OFF even on a preview deploy AND even when the DB flag is ON, persisting force='0'; a pre-set localStorage '0' force-disables on a preview too. **(e) absent flag + undefined env + no force ⇒ OFF** (REG-78 core intact: no `ff_cosmic_redesign_v1` row, JSDOM env undefined ⇒ not-preview ⇒ `cosmicEnabled` false, no `data-design`). PLUS **AuthContext ownership preserved:** the cosmic provider does NOT clobber `data-theme` when OFF — AuthContext's force-`light` write survives untouched. PLUS **switch is live:** with the flag ON, `data-design="cosmic"` IS written, proving the OFF result isn't a trivial no-op provider. PLUS the FoxyMark `variant` default: `<FoxyMark />` renders the legacy SVG-free classic geometric fox; the cosmic SVG renders ONLY for `variant="cosmic"`. PLUS the display-only primitives (MasteryRing / ProgressBar) clamp `percent` to [0,100] and coerce non-finite input to 0 via `Number.isFinite` — they compute NO score (P1/P2 stay in the assessment domain; these primitives only render a handed-in display number). | `src/__tests__/cosmic-flag-off-safety.test.tsx` (provider DOM gating-matrix contract) + `src/__tests__/cosmic-primitives.test.tsx` (FoxyMark variant default + primitive clamping) | E |
| REG-79 | `cosmic_dispatch_flag_off_legacy` | Page-level DISPATCH contract for the full redesign (Phases 1–3). REG-78 pins that the provider writes no `data-design` when the flag is OFF; REG-79 pins the NEXT link — the `cosmicEnabled ? cosmic : legacy` selection that the student dashboard (`src/app/dashboard/page.tsx` — `<CosmicAboveFoldHero/>` vs `<AboveFoldHero/>`), the parent home (`src/app/parent/page.tsx` — `<CosmicParentHome/>` vs legacy markup), and the Phase-3 portal shells (teacher/super-admin/school-admin — Starfield + `*-portal` class) all key off. The single switch behind every branch is `useCosmicTheme().cosmicEnabled`, resolved by the REAL `<CosmicThemeProvider>` from the client flag read path. Asserts: flag ABSENT (production truth) ⇒ LEGACY branch renders + cosmic branch does NOT; flag `false` ⇒ LEGACY branch renders; flag `true` ⇒ COSMIC branch renders + legacy does NOT (proves the OFF result is a real decision, not a dead switch). Wires the exact page ternary to the live hook (mocks only `getFeatureFlags` + `useAuth`) — behavior over implementation. Guards against an inverted ternary or a switch-true-while-OFF regression silently flipping production to cosmic for every user. | `src/__tests__/cosmic-dispatch-flag-off.test.tsx` | E |

### Pinned tests

- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::writes NO data-design / data-role when the cosmic flag is ABSENT`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::does NOT clobber data-theme when the flag is OFF (AuthContext owns it)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::writes data-design="cosmic" when the flag is ON (switch is live)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::stays OFF in PRODUCTION env with the flag OFF and no force (byte-identical)`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::auto-enables cosmic on a PREVIEW deploy even with the flag OFF`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::enables cosmic via ?cosmic=1 even in production with the flag OFF`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::force-disables via ?cosmic=0 even on a PREVIEW deploy`
- `src/__tests__/cosmic-flag-off-safety.test.tsx::REG-78 — CosmicThemeProvider flag-OFF / production DOM safety::force-disables via ?cosmic=0 even when the DB flag is ON`
- `src/__tests__/cosmic-primitives.test.tsx::FoxyMark — variant default (flag-OFF pixel identity)::renders the classic geometric fox by default (no variant prop)`
- `src/__tests__/cosmic-dispatch-flag-off.test.tsx::REG-79 — cosmic dispatch flag-OFF stays legacy::renders the LEGACY branch (not cosmic) when the flag is ABSENT`
- `src/__tests__/cosmic-dispatch-flag-off.test.tsx::REG-79 — cosmic dispatch flag-OFF stays legacy::renders the COSMIC branch when the flag is ON (switch is live, not dead)`

### Invariants covered by this section

- P10 (bundle / cost budget) — adjacent: the cosmic font + token layer is
  inert when the flag is OFF; the flag-OFF tests pin that no cosmic DOM hook
  is written so no cosmic CSS cascade is paid for by production users.
- P7 (bilingual UI — no-coverage today) — adjacent: the cosmic primitives
  take bilingual `label` strings from callers and never hard-code copy; the
  HC (high-contrast) theme exists so no learner is stranded on a sunlit cheap
  Android. (A true AAA-contrast token-pair guard is recommended below but not
  yet enforced — see REG-81.)

### Notes on test strategy

REG-78 and REG-79 follow the **flag-OFF safety pattern**: the enforcing tests
mock the client flag read path (`getFeatureFlags`) and assert on the DOM
boundary, NOT on provider internals — behavior over implementation. JSDOM does
not apply the `html[data-design="cosmic"]` CSS cascade, which is exactly why the
attribute presence/absence (REG-78) and the page dispatch branch (REG-79) are
the right things to assert: they are the only two gates the entire cosmic
cascade keys off. The FoxyMark variant default (REG-78) is the third pillar —
every existing call site is `variant`-less, so the default MUST stay `classic`
or existing surfaces would flip to the cosmic SVG with the flag off.

Combined flag-OFF chain pinned across the two entries: (1) provider writes no
`data-design`/`data-role` ⇒ the `html[data-design="cosmic"]`-scoped token block
and every selector-scoped role/theme rule in `globals.css` is inert (REG-78);
(2) the page dispatch ternaries select the LEGACY branch ⇒ no cosmic composition
(`CosmicAboveFoldHero`, `CosmicParentHome`, portal Starfields) ever mounts, so
none of its `dynamic(ssr:false)` chunks enter the flag-OFF bundle and no
`.cosmic-*` namespaced class is emitted into the DOM (REG-79); (3) FoxyMark
stays classic ⇒ no `.cosmic-float`/SVG (REG-78). The bare `.cosmic-*` primitive
rules in `globals.css` are name-scoped (not selector-scoped) but reference
cosmic-only tokens that resolve to nothing without `data-design`, AND their
classes are only ever rendered by the flag-gated compositions above — so they
cannot paint with the flag OFF.

### Recommended follow-up entries (NOT yet added — no enforcing test)

These are warranted by the redesign but were intentionally NOT catalogued yet
because a meaningful enforcing test needs infrastructure JSDOM can't provide
(computed-style / contrast math / real CSS cascade). Proposed for a later
installment once the supporting test harness lands:

- **REG-80 — `cosmic_theme_switch_persistence`**: dark→light→hc cycle persists
  the `CosmicThemePreference` to localStorage and re-applies `data-theme` on
  remount; flag-OFF setter is a no-op. (Needs the provider's setter exercised
  end-to-end with a real toggle surface.)
- **REG-81 — `cosmic_aaa_contrast_token_pairs`**: every cosmic text-on-surface
  token pair (`--text`/`--text-2` on `--bg`/`--bg-soft`/role palettes, plus the
  HC theme) meets the AAA contrast ratio. This is the first concrete enforcing
  test for the P7 "visibility" constraint that is currently `no-coverage`. Needs
  a contrast-ratio assertion harness reading the resolved token values (e.g. a
  build-time CSS-token parser or a Playwright computed-style probe), not JSDOM.
- **REG-82 (recommended) — `cosmic_css_scope_lint`**: a build-time/CI guard that
  every NON-`.cosmic-*`-prefixed selector added to the cosmic block of
  `globals.css` is gated under `html[data-design="cosmic"]`. Today the
  flag-OFF guarantee for the bare `.cosmic-*` primitive rules rests on a
  convention (name-namespacing + flag-gated render sites) rather than a
  mechanical check; a lightweight CSS-parse assertion would catch a future
  unscoped global rule (e.g. a stray `body{}` or legacy-class override) leaking
  into the flag-OFF cascade. Needs a CSS AST/regex harness, not JSDOM.

### Catalog total

Pre-cosmic: 48 entries. Cosmic Phase 0 added REG-78. Cosmic full-redesign
(Phases 1–3) regression verification adds REG-79.

**Total: 50 entries.** (REG-80, REG-81, REG-82 recommended, not yet added.)

## Mobile parity — /v2 contract (Phase 2 Wave 2.2) — REG-87

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.1 landed the `/v2`
standard + the Zod→OpenAPI→Dart codegen pipeline (`src/lib/api/v2/contract.ts`
single source of truth → `openapi/v2.json` → `mobile/lib/api/v2/**`); Wave 2.2
added 8 student-facing `/v2` consumer endpoints
(`/v2/quiz/{questions,start,submit}`, `/v2/student/{profile,progress,leaderboard}`,
`/v2/learn/{curriculum,concept}`). The web and Flutter clients consume the SAME
contract, so two distinct failure modes must be pinned:

1. **`/v2/quiz/submit` server-authoritative parity (P1/P2/P3/P4).** The `/v2`
   submit route is an assessment-approved THIN PASS-THROUGH that MIRRORS the
   existing `/api/quiz/submit` wrapper: it calls the SAME RPC
   (`submit_quiz_results_v2`) with the SAME rename-only mapped args
   (`responses[].selected_option → selected_displayed_index`,
   `time_taken_seconds → time_spent`, `totalTimeSeconds → p_time`,
   `Idempotency-Key → p_idempotency_key`) and returns the RPC's score / XP /
   correct / total / flagged VERBATIM — the route does NO scoring (P1), NO XP
   math (P2), NO anti-cheat checks (P3); the RPC owns all of it atomically (P4).
   A mobile client hitting `/v2` MUST get byte-identical grading to a web client
   hitting `/api/quiz/submit`. The pin proves "verbatim" by feeding the RPC mock
   DELIBERATELY non-formula values (8/10 → `score_percent: 73`, `xp_earned: 137`)
   and asserting they pass through untouched — a route that recomputed
   `Math.round((8/10)*100)=80` would fail. It also pins the Idempotency-Key
   requirement (400 when missing/non-UUID) and the error-translation table
   (P0001 → 409, unique-violation → cached idempotent replay 200, anything else
   → 503 for safe retry).

2. **`/v2` route ↔ contract drift-check (mobile-parity integrity).** Wave 2.1's
   OpenAPI drift-check (`npm run gen:openapi:check`) only proves
   `openapi/v2.json` matches the Zod source — NOT that the ROUTE HANDLERS emit
   what the contract describes. Quality flagged this latent gap in Wave 2.1: a
   route could ship a response shape the Dart client can't deserialize and CI
   would stay green. The conformance suite closes it by parsing a representative
   shaped output of EVERY `/v2` endpoint through its exported Zod schema and
   asserting it passes, honoring the three distinct envelopes
   (`/v2/today` → bare `TodayResponse`; `/v2/parent/encourage` → `SuccessAck`;
   Wave 2.2 routes → `{ success, data: <payload> }`). It also pins drift guards:
   the schema REJECTS the legacy bare `{ error }` v1 envelope, an integer grade
   (P5), fewer-than-4 options (P6), and a `QuizSubmitResult` missing
   `marking_authenticity_path`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-87 | `v2_quiz_submit_server_authoritative_parity_and_v2_contract_drift_check` | Two-part pin on the `/v2` mobile-parity surface. **(a) `/v2/quiz/submit` parity (P1/P2/P3/P4):** the route calls `submit_quiz_results_v2` EXACTLY ONCE with the SAME rename-only mapped args as `/api/quiz/submit` (`p_responses[].selected_displayed_index` / `time_spent`, `p_time`, `p_idempotency_key`, plus the same `unknown`/`'0'`/`null` subject/grade/topic/chapter fallbacks) — asserted via `.toEqual` on the full arg object, not a partial match; the RPC's `score_percent` / `xp_earned` / `correct` / `total` / `flagged` are returned VERBATIM in the `/v2` envelope (proven with deliberately non-formula RPC values 8/10 → 73% / 137 XP so any client-side recompute would fail); the `Idempotency-Key` header is REQUIRED (400 + `IDEMPOTENCY_KEY_REQUIRED` when missing or non-UUID); JWT↔body `studentId` mismatch is 403; and the error-translation table holds (P0001 → 409 `SESSION_NOT_STARTED`, unique-violation → cached idempotent replay 200 with verbatim cached score/XP, any other RPC error → 503 `RPC_FAILED`, empty RPC result → 503 `EMPTY_RESPONSE`). **(b) `/v2` route↔contract conformance (drift-check):** a representative shaped output of every `/v2` endpoint parses cleanly through its exported Zod schema from `src/lib/api/v2/contract.ts`, honoring the three envelopes (`/v2/today` bare `TodayResponse`, `/v2/parent/encourage` `SuccessAck`, Wave 2.2 routes `{ success, data }`); every `v2Error` code parses against `ErrorResponse`; and the schema REJECTS the legacy bare `{ error }` v1 envelope, an integer grade (P5), a 3-option question (P6), and a `QuizSubmitResult` missing `marking_authenticity_path` — closing the latent drift the OpenAPI artifact check (`gen:openapi:check`) does not catch. | `src/__tests__/api/v2/quiz-submit.test.ts` (13 tests: 7 auth/idempotency/validation + 3 RPC parity + 3 error-translation), `src/__tests__/api/v2/contract-conformance.test.ts` (31 tests: 15 success-envelope conformance + 12 error-envelope conformance + 1 v1-envelope-drift reject + 3 malformed-output drift guards) | E (unit — runs in CI; `gen:openapi:check` guards the artifact half) |

### Pinned tests

- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — RPC parity (mirrors /api/quiz/submit)::calls submit_quiz_results_v2 with the SAME mapped args as /api/quiz/submit`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — RPC parity (mirrors /api/quiz/submit)::returns RPC score/xp VERBATIM (no recompute) in the /v2 envelope`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — error translation::translates a unique-violation into a cached idempotent replay (200)`
- `src/__tests__/api/v2/contract-conformance.test.ts::/v2 contract conformance — success envelopes parse against contract schemas::POST /v2/quiz/submit envelope conforms (server-authoritative, verbatim RPC values)`
- `src/__tests__/api/v2/contract-conformance.test.ts::/v2 contract conformance — error envelopes parse against ErrorResponse::ErrorResponse REJECTS a bare {error} (legacy v1 envelope drift guard)`

### Invariants covered by this section

- P1 Score accuracy / P2 XP economy: the `/v2/quiz/submit` route never recomputes
  score or XP — it returns the `submit_quiz_results_v2` RPC values verbatim, so a
  mobile client and a web client get identical grading (the RPC is the single
  re-deriver, consistent with REG-51/REG-52).
- P3 Anti-cheat / P4 Atomicity: all three anti-cheat checks and atomicity live in
  the RPC; the route forwards inputs only — `flagged` is passed through, never
  computed in the route.
- P5 Grade format / P6 Question quality: the contract schemas enforce string
  grades and exactly-4-option questions; the conformance drift guards prove a
  regression to integer grade or a 3-option question fails the schema.
- Mobile-parity contract integrity: the conformance suite proves the route output
  matches the Zod source the Dart client is generated from — closing the gap
  `gen:openapi:check` (artifact ↔ Zod) leaves open (route ↔ Zod).

### Notes on test strategy

REG-87 follows the **contract/parity pattern** (REG-50/REG-51/REG-71): the
enforcing tests assert on the route's observable contract (which RPC, which args,
which verbatim values, which envelope) rather than on internals. Part (a) mocks
only the seams (`authorizeRequest`, `supabase-admin`, `supabase-server.rpc`) and
asserts on the captured RPC call + the JSON envelope, proving "verbatim" with
deliberately wrong RPC math so a recompute can't slip through. Part (b) is a pure
schema-parse suite over representative fixtures that mirror each route's
projection (`projectQuestion`, `shapeResult`, the student/learn projections), so
it needs no Supabase fixture and runs green in CI today. The two halves together
with the artifact check (`gen:openapi:check`, REG-adjacent CI gate) give a
three-link chain: Zod source → OpenAPI artifact → route output, all pinned.

### Catalog total

Phase 2 Wave 2.2 (mobile parity via one contract) adds REG-87 (`/v2/quiz/submit`
server-authoritative parity + `/v2` route↔contract drift-check).

**Total: 55 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile parity — /v2 post-submit side-effect parity (Phase 2 Wave 2.3) — REG-88

Source: Phase 2 "mobile-parity-via-one-contract" — Wave 2.3. Wave 2.2 (REG-87)
proved `/v2/quiz/submit` is a server-authoritative THIN PASS-THROUGH that returns
the RPC's score/XP VERBATIM. But at Wave 2.2 the `/v2` route stopped at the RPC:
it did NOT run the post-submit side-effects the canonical `/api/quiz/submit`
route fires after a fresh grade — PostHog telemetry (`quiz_graded` + `xp_awarded`,
plus conditional `quiz_anti_cheat_flagged` / `daily_xp_cap_hit`), the ADR-005
spine emit (`publishEvent(learner.mastery_changed)`, one per chapter touched),
and the orchestrator bridge (`maybeDispatchQuizCompletion`). That left a
**telemetry/spine parity gap**: a mobile client hitting `/v2` would be graded
identically but would be INVISIBLE to PostHog funnels, the projector subscribers
(mastery-state-writer, concept-mastery-projector), and the orchestrator —
analytics and learner-state would silently undercount mobile activity.

Wave 2.3 closes it by extracting the canonical route's inline side-effect block
into a SINGLE shared module, `src/lib/quiz/submit-side-effects.ts`
(`runQuizSubmitSideEffects(admin, authUserId, input, result)`). BOTH routes now
call the SAME function after the RPC returns success:

1. **Single-source extraction (no-drift refactor of `/api/quiz/submit`).** The
   canonical route's PostHog/spine/bridge sections were moved verbatim into the
   shared module; the route re-exports the pure helpers
   (`computeMasteryDeltas`, `masteryChangedIdempotencyKey`,
   `quizCompletedIdempotencyKey`) from their new home so existing importers (the
   spine-emit contract test) keep resolving them. Behavior of `/api/quiz/submit`
   MUST be unchanged — its existing REG-62 idempotency tests still assert
   `quiz_graded` fires once on a fresh submit and ZERO times on an idempotent
   replay, exercising the REAL shared module end-to-end (they mock only the
   `@/lib/posthog/server` leaf, not the side-effects module).

2. **`/v2/quiz/submit` full side-effect parity.** On a fresh (non-replay) submit
   the `/v2` route now fires the SAME side-effects with the SAME args the web
   route uses: `quiz_graded` once (`$insert_id = quiz_graded:<session>`,
   `marking_authenticity_path: 'oracle_v2'`), `xp_awarded` once
   (`$insert_id = xp_awarded:quiz:<session>`), `publishEvent(learner.mastery_changed)`
   on the ADR-005 spine (`idempotencyKey = mastery-changed:<session>:<chapter>`,
   matching the orchestrator's key verbatim so the bus de-dupes), and the
   orchestrator bridge with the same session id.

3. **Idempotent-replay guard (both routes).** `runQuizSubmitSideEffects`
   short-circuits the moment `result.idempotent_replay === true` — so on a
   cached replay NEITHER route fires PostHog, the spine emit, OR the bridge. No
   funnel double-count, no double-publish on the bus, no duplicate orchestrator
   dispatch.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-88 | `v2_quiz_submit_post_submit_side_effect_parity_via_shared_helper` | `/v2/quiz/submit` now runs FULL post-submit side-effect parity with `/api/quiz/submit` via the shared `runQuizSubmitSideEffects()` (`src/lib/quiz/submit-side-effects.ts`), idempotent-replay-guarded. On a FRESH submit the `/v2` route emits PostHog `quiz_graded` EXACTLY ONCE (distinctId = studentId, payload `{ session_id, score_percent, xp_earned, correct, total, marking_authenticity_path: 'oracle_v2', anti_cheat_flagged: false, idempotent_replay: false }`, `$insert_id = quiz_graded:<session>`) AND `xp_awarded` EXACTLY ONCE (payload `{ xp_delta, source: 'quiz', daily_total_after, capped }`, `$insert_id = xp_awarded:quiz:<session>`) AND `publishEvent(learner.mastery_changed)` on the ADR-005 spine EXACTLY ONCE for the primary chapter (`actorAuthUserId` = JWT user, `idempotencyKey = mastery-changed:<session>:<chapter>` — verbatim match to the orchestrator key so the bus UNIQUE constraint de-dupes, payload `{ subjectCode, chapterNumber, trigger: 'quiz' }`) AND dispatches the orchestrator bridge (`maybeDispatchQuizCompletion`) once with the same `legacySessionId` / `subjectCode` / `chapterNumber` — all with the SAME args the web route uses (both call the single shared helper). On an IDEMPOTENT REPLAY (unique-violation → cached row, `idempotent_replay: true`) NEITHER `quiz_graded`, `xp_awarded`, `publishEvent`, NOR the bridge fires (guard short-circuits → no funnel double-count, no double-publish on the bus, no duplicate dispatch). The canonical `/api/quiz/submit` refactor is non-weakening: REG-62's existing idempotency tests still assert `quiz_graded` fires once on a fresh submit and zero on replay through the REAL shared module (only `@/lib/posthog/server` is mocked). | `src/__tests__/api/v2/quiz-submit.test.ts` (Wave 2.3 section: 5 tests — `quiz_graded` parity, `xp_awarded` parity, `learner.mastery_changed` spine-emit parity, orchestrator-bridge parity, replay-fires-nothing — on top of the prior contract tests in the same file); web side via `src/__tests__/api/quiz-submit-idempotency.test.ts` (REG-62 — `quiz_graded` fires-once / not-on-replay through the shared helper) + `src/__tests__/state/learner-loop/quiz-submit-spine-emit.test.ts` (re-exported pure helpers + spine event-shape) | E (unit — runs in CI) |

### Pinned tests

- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::emits PostHog quiz_graded once with the SAME payload the web route uses`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::emits publishEvent(learner.mastery_changed) on the ADR-005 spine with the SAME envelope`
- `src/__tests__/api/v2/quiz-submit.test.ts::POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)::does NOT fire PostHog, publishEvent, or the bridge on an idempotent replay`
- `src/__tests__/api/quiz-submit-idempotency.test.ts::POST /api/quiz/submit — fresh submission (REG-62)::returns 200 with idempotent_replay=false and emits quiz_graded once` (web-side proof the shared helper still fires on the canonical route)
- `src/__tests__/api/quiz-submit-idempotency.test.ts::POST /api/quiz/submit — idempotent replay (REG-62)::returns 200 with idempotent_replay=true and DOES NOT emit quiz_graded on a unique-violation race` (web-side proof the replay guard still holds post-refactor)

### Invariants covered by this section

- Mobile-parity telemetry/spine integrity: a mobile client hitting `/v2/quiz/submit`
  is now equally visible to PostHog funnels, the ADR-005 projector subscribers
  (mastery-state-writer, concept-mastery-projector), and the orchestrator as a web
  client hitting `/api/quiz/submit` — the SAME shared helper fires for both, so
  the two paths cannot drift on side-effects (extends REG-87's grading parity to
  the post-grade side-effects).
- ADR-005 spine de-dup: the `/v2` route's `learner.mastery_changed` idempotency
  key matches the orchestrator key verbatim, so when both the route-level publish
  and the orchestrator bridge fire the bus's `UNIQUE(idempotency_key)` constraint
  yields exactly one row per (kind, session, chapter).
- No double-count on replay: the `idempotent_replay` guard ensures cached replays
  on EITHER route fire no telemetry, no bus publish, and no orchestrator dispatch
  (consistent with REG-62's funnel-double-count guard, now extended to the spine
  and bridge).

### Notes on test strategy

REG-88 follows the same **contract/parity pattern** as REG-87: both routes' tests
mock only the leaf side-effect modules (`@/lib/posthog/server`,
`@/lib/state/events/publish`, `@/lib/state/quiz-orchestrator-bridge`) so the REAL
`runQuizSubmitSideEffects()` orchestration runs, and assert on the captured calls
(which event, which payload, which `$insert_id` / idempotency key, how many times).
Because BOTH routes call the same shared function, the v2 tests prove the v2 wiring
and the existing REG-62 web tests prove the canonical wiring still fires through
the extracted module — so the shared-helper extraction is covered on BOTH sides
with no coverage gap on the canonical route. A `flushAsync()` (setTimeout 0) flushes
the deferred spine-emit IIFE's microtasks before the publish assertions run. NOTE:
there is no standalone unit test for the pure side-effect IIFE wiring of
`src/lib/quiz/submit-side-effects.ts` in isolation; it is covered transitively
through the two route test suites (the pure helpers `computeMasteryDeltas` /
`*IdempotencyKey` ARE unit-tested directly in the spine-emit test).

### Catalog total

Phase 2 Wave 2.3 (mobile parity via one contract — post-submit side-effects) adds
REG-88 (`/v2/quiz/submit` full PostHog + spine + bridge side-effect parity with
`/api/quiz/submit` via the shared `runQuizSubmitSideEffects()` helper,
idempotent-replay-guarded).

**Total: 56 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Mobile APK must actually compile — Android toolchain-drift gate (2026-06-07) — REG-90

Source: CI-hardening RCA after two latent Android-build bugs reached `main`
undetected. This is a build/release-integrity gate (the mobile half of the release
pipeline), not a P1-P15 scoring invariant — so it has no P-tag; like REG-72
(service-availability operational invariant) it pins a pipeline gate rather than a
product formula.

`flutter analyze` and `flutter test` do NOT compile the native Android/Kotlin
layer (Gradle, AGP, the Kotlin Gradle Plugin, NDK abiFilters) — they validate Dart
only. Therefore neither can prove the app actually BUILDS to a shippable APK; only
the `flutter build apk --debug` step does, because it drives the real Android
toolchain end-to-end. Two latent bugs reached `main` precisely because that
compile path had no enforcement: the `Mobile CI` workflow existed but had never
actually run (an Actions billing block left it skipped — a 0-step / ~2s job), and
the dev sandbox cannot run Gradle locally. The bugs: **(A1)** a manual `splits.abi`
block in `mobile/android/app/build.gradle` conflicting with Flutter-injected
`ndk.abiFilters` (AGP forbids declaring both); **(A2)** Kotlin Gradle Plugin 1.9.22
too old to compile `package_info_plus 9.x` (pulled transitively via `sentry_flutter`,
which needs Kotlin 2.x). Both fixed in PR #957; this entry pins the gate so a future
toolchain drift fails CI instead of silently shipping.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-90 | `mobile_apk_must_compile_android_toolchain_gate` | The `Mobile CI` workflow's `flutter build apk --debug` step is the enforcing gate that proves the Flutter app compiles to an Android APK — it drives the real Android toolchain (Gradle + AGP + Kotlin Gradle Plugin + NDK abiFilters) end-to-end, which `flutter analyze` and `flutter test` (Dart-only) CANNOT do. Any PR touching `mobile/**` MUST have the `Flutter analyze + test + build` check (workflow `Mobile CI`, `.github/workflows/mobile-ci.yml`) GREEN before merge; a 0-step / ~2s job is "never ran" (Actions billing-block), NOT "passed", and does not satisfy the gate. The step guards two toolchain-drift regressions fixed in PR #957: (A1) no manual `splits.abi` block coexisting with Flutter-injected `ndk.abiFilters` in `mobile/android/app/build.gradle` (AGP forbids both), and (A2) Kotlin Gradle Plugin must stay new enough (Kotlin 2.x) to compile `package_info_plus 9.x` (transitive via `sentry_flutter`). Full RCA + remediation in [docs/runbooks/mobile-ci-and-android-toolchain.md](../docs/runbooks/mobile-ci-and-android-toolchain.md). | `.github/workflows/mobile-ci.yml` (job `Flutter analyze + test + build` → step `flutter build apk --debug`; PR-triggered on `mobile/**` / `openapi/v2.json` / the workflow itself) + `docs/runbooks/mobile-ci-and-android-toolchain.md` (RCA + toolchain-pin runbook) | R (resolved in PR #957 — `splits.abi` block removed + Kotlin Gradle Plugin bumped to 2.x; mobile-ci now runs the APK-compile gate on every `mobile/**` PR) |

### Invariants covered by this section

- Build/release integrity (operational invariant — mobile pipeline) — the
  `flutter build apk --debug` step is the only signal that proves the Android app
  actually compiles. `flutter analyze` + `flutter test` are Dart-only and cannot
  detect Gradle/AGP/Kotlin/NDK toolchain drift, so a green analyze+test does NOT
  imply a buildable APK. REG-90 pins the compile step as the merge gate for any
  `mobile/**` change and records that a 0-step/~2s job means "never ran", not
  "passed".
- Mobile parity (adjacent to REG-87/REG-88/REG-89) — the `/v2` contract parity
  entries assume a Flutter app that compiles and ships; REG-90 guards the half of
  the release pipeline that proves the mobile binary builds at all.

### Notes on test strategy

REG-90 is enforced by a CI workflow step, not a Vitest/Playwright assertion — the
"test" is the green `flutter build apk --debug` run on every `mobile/**` PR. It is
catalogued in the `R` (resolved) state because the two toolchain-drift bugs it
guards were fixed in PR #957 and the workflow now exercises the compile path. The
RCA, the two root causes (A1 `splits.abi`/`ndk.abiFilters` conflict, A2 Kotlin
Gradle Plugin version), and the toolchain version pins live in the runbook
`docs/runbooks/mobile-ci-and-android-toolchain.md` — this entry deliberately does
not restate them.

### Catalog total

Pre-REG-90: 57 entries. CI-hardening mobile RCA adds REG-90 (mobile APK-compile /
Android toolchain-drift gate).

**Total: 58 entries.** (REG-80, REG-81, REG-82 still recommended, not yet added.)

## Phase 2 monthly-synthesis-builder Python port (2026-06-09) — REG-100

Source: Phase 2 continued — port of `supabase/functions/monthly-synthesis-builder/index.ts`
to Python on Cloud Run. The Python module
(`python/services/ai/business/monthly_synthesis_builder/`) reproduces the TS
six-step pipeline (auth → idempotency lookup → aggregate → bundle build →
idempotent insert → response). The TS Edge function gains a proxy block at
the top of `Deno.serve` that forwards to Cloud Run when
`ff_python_monthly_synthesis_builder_v1` enabled + bucket < rollout_pct.
On any proxy failure → falls through to the legacy TS bundle-builder. Default
OFF (rollout_pct=0).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-100 | `phase_2_monthly_synthesis_builder_python_port_constants_and_wire_parity` | Three-pronged contract on the Python port. (1) **Pure-transformation constants match TS byte-for-byte:** TARGET_DIFFICULTY_V1=0.55, MOCK_QUESTIONS_PER_CHAPTER=2, MOCK_QUESTIONS_CAP=20, MASTERY_IMPROVED_THRESHOLD=0.5, CHAPTERS_TOUCHED_SOFT_CAP=12, CHAPTERS_IN_MOCK_SUMMARY_CAP=6. A regression on any constant ships a wrong-shape bundle to monthly_synthesis_runs. (2) **Wire-shape parity:** SynthesisBundle uses camelCase keys (monthLabel, weeklyArtifactIds, masteryDelta, chapterMockSummary) so the Next.js /api/synthesis/state consumer keeps working byte-for-byte across the cutover. Pydantic extra=forbid enforces no field drift. (3) **Pure logic parity:** month_boundaries_of returns ISO with trailing Z (TS toISOString shape), derive_chapters_touched preserves insertion-order dedup (TS Set semantics), derive_chapter_mock_summary returns null when no chapters touched (TS null path), compute_mastery_counters reports topicsRegressed=0 always (TS v1 simplification — historical snapshots not yet implemented). | `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_constants_match_ts_verbatim`, `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_month_boundaries_returns_iso_with_Z_suffix`, `python/tests/unit/test_monthly_synthesis_builder_bundle.py::test_compute_mastery_counters_regressed_always_zero_v1`, `python/tests/unit/test_monthly_synthesis_builder_models.py::test_bundle_wire_shape_camelCase_keys`, `python/tests/unit/test_monthly_synthesis_builder_models.py::test_request_rejects_bad_month_format` | E |

### Invariants covered by this section

- **P5 (grade format)** — N/A here (no grade fields in monthly_synthesis_runs).
- **P12 (AI safety)** — N/A; this port carries no LLM call. The bilingual
  summary is generated lazily by the Next.js side at `/api/synthesis/state`.
- **P13 (data privacy)** — response carries no PII; only UUIDs, counters, and
  chapter titles. The handler binds `student_id` into structlog contextvars
  for log correlation but never logs the full request body.

### Notes on test strategy

REG-100 follows the same multi-file unit pattern as REG-76 (Phase 2
generate-concepts). The TS path is the source of truth for the bundle shape
and the bundle is consumed by `/api/synthesis/state` on the Next.js side, so
any wire drift would surface as a parse error on the synthesis viewer rather
than at the Edge proxy. The pinned tests cover the contract surface; the
broader test files (15 bundle tests + 10 models tests) exercise every
rejection branch in the validators.

The proxy block in `supabase/functions/monthly-synthesis-builder/index.ts`
follows the canonical pattern used by generate-concepts, generate-answers,
and bulk-question-gen: read flag envelope → hash-bucket → forward or fall
through. The Cloud Run forward preserves the `x-cron-secret` header so the
Python service performs its own cron-secret verification — auth posture is
identical on both sides.

### Catalog total

Pre-Phase-2-monthly-synthesis-builder: 67 entries. Phase 2
monthly-synthesis-builder adds REG-100.

**Total: 68 entries.**
## Phase 2 nep-compliance Python port (2026-06-09) - REG-101

Port of `supabase/functions/nep-compliance/index.ts` to Python on Cloud Run.
NEP 2020 Holistic Progress Card generator/retriever. Pure data aggregation,
no LLM call. Edge proxy gates traffic via `ff_python_nep_compliance_v1`;
falls through to legacy TS on any failure. Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-101 | `phase_2_nep_compliance_python_port_nep_thresholds_and_term_boundaries` | (1) NEP 2020 competency thresholds match TS byte-for-byte (85/65/40 boundaries map to advanced/proficient/developing/beginning). (2) Behavior-rating math: returns None when benchmark<=0; caps at 5; minimum 1; zero value returns 1 (not 0). (3) Indian academic year boundary: April starts new year string; March returns previous. (4) Term boundary: months 4-9 are Term 1, months 10-3 are Term 2. A regression on any of these mismaps student level / report card data. | `python/tests/unit/test_nep_compliance_mapping.py::test_thresholds_match_ts_verbatim`, `python/tests/unit/test_nep_compliance_mapping.py::test_mastery_to_competency_advanced`, `python/tests/unit/test_nep_compliance_mapping.py::test_behavior_rating_zero_max_returns_none`, `python/tests/unit/test_nep_compliance_mapping.py::test_academic_year_april_to_march_boundary`, `python/tests/unit/test_nep_compliance_mapping.py::test_current_term_april_to_september_is_term_1` | E |

### Invariants covered by this section

- P5 (grade format) - HPCReport.student.grade is `str` (Pydantic-typed).
- P12 (AI safety) - N/A; no LLM call.
- P13 (data privacy) - response carries student name+grade by necessity
  (HPC is parent-visible by design). Logs only request_id + student_id UUID,
  never report contents.

### Catalog total

Pre-Phase-2-nep-compliance: 68 entries. Phase 2 nep-compliance adds REG-101.

**Total: 69 entries.**
## Phase 2 verify-question-bank Python port (stub) (2026-06-09) - REG-104

Structural port of `supabase/functions/verify-question-bank/index.ts`. Phase 2
covers claim/release infrastructure + scheduling helpers; the verifier call is
STUBBED (Phase 2.5 will wire grounded-answer). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-104 | `phase_2_verify_question_bank_python_port_scheduling_parity` | (1) IST peak window 14:00-22:00 (end exclusive). (2) Batch size 1000 off-peak / 250 peak. (3) Throttle threshold > 2400 RPM (boundary exclusive). (4) Throttled batch halves base size. A regression on any of these changes the verifier cron throughput model and either over-runs Claude (no throttle) or under-runs (too aggressive throttle). | `python/tests/unit/test_verify_question_bank_scheduling.py::test_constants_match_ts`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_is_peak_at_ist_2200_is_off_peak`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_batch_size_peak_throttled_halves`, `python/tests/unit/test_verify_question_bank_scheduling.py::test_should_throttle_threshold` | E |

### Invariants covered by this section

- P12 (AI safety) - Phase 2 STUB does not call the verifier. The TS path remains
  the verifier-of-record until Phase 2.5. Flag default OFF means production
  traffic still hits the TS verifier; no AI-safety regression.
- P13 (data privacy) - logs only counters + claim/release metadata.

### Catalog total

Pre-Phase-2-verify-question-bank: 71 entries. Adds REG-104.

**Total: 72 entries.**
## Phase 2 extract-ncert-questions Python port (stub) (2026-06-09) - REG-105

Structural port of `supabase/functions/extract-ncert-questions/index.ts`.
Phase 2 covers chapter-discovery + coverage stats; the MoL extraction call is
STUBBED. Phase 2.5 will wire MoL routing. Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-105 | `phase_2_extract_ncert_questions_python_port_model_contract` | (1) P5 grade-as-string: ExtractRequest.grade is str-or-None; ExtractedChapter.grade is str. (2) Batch size clamped to [1,10] default 3. (3) Response defaults phase_2_stub=True. (4) Status response coverage_percent bounded [0,100]. (5) Extra fields forbidden on Request (Pydantic extra=forbid). | `python/tests/unit/test_extract_ncert_questions_models.py::test_request_grade_coerced_to_string`, `python/tests/unit/test_extract_ncert_questions_models.py::test_request_batch_size_clamp`, `python/tests/unit/test_extract_ncert_questions_models.py::test_response_default_phase_2_stub_true`, `python/tests/unit/test_extract_ncert_questions_models.py::test_status_response_coverage_bounds`, `python/tests/unit/test_extract_ncert_questions_models.py::test_request_extra_fields_forbidden` | E |

### Invariants covered by this section

- P5 (grade format) - ExtractRequest + ExtractedChapter both pin grade to str.
- P12 (AI safety) - Phase 2 STUB does not call LLM; TS path is extractor-of-record.
- P13 (data privacy) - logs only counters + chapter metadata; no RAG content logged.

### Catalog total

Pre-Phase-2-extract-ncert-questions: 72 entries. Adds REG-105.

**Total: 73 entries.**

## Phase 2 bulk-non-mcq-gen Python port (stub) (2026-06-09) - REG-106

Structural stub port. Auth + request validation are functional; MoL generation
is stubbed (Phase 2.5 follow-up). Default OFF.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-106 | `phase_2_bulk_non_mcq_gen_python_port_model_contract` | (1) P5 grade-as-string. (2) question_type Literal in {short_answer, long_answer, fill_blank} - MCQ excluded. (3) batch_size in [1,20] default 5. (4) Response phase_2_stub=True default. (5) extra=forbid on both request and response. | `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_grade_string`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_invalid_question_type`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_request_batch_size_clamp`, `python/tests/unit/test_bulk_non_mcq_gen_models.py::test_response_phase_2_stub_default_true` | E |

### Catalog total

Pre-Phase-2-bulk-non-mcq-gen: 73 entries. Adds REG-106.

**Total: 74 entries.**

## Learning-OS flagship redesign + Track-2 (EIC + Principal AI) (2026-06-11) - REG-112..REG-114

Source: 2026-06-11 Learning-OS session. Three flagged-OFF redesign tracks shipped
together as PRESENTATION-ONLY surfaces over the unchanged learning engines:
(1) the "Alfa OS" student/subjects/revision/practice/exam-briefing surfaces, each
behind its own DEFAULT-OFF flag whose OFF path is byte-identical to today;
(2) the super-admin Education Intelligence Cloud (EIC) read-API; (3) the Track-2
Principal AI Assistant. These entries pin the UNIT-testable safety contracts; the
runtime-client + DB-applied behaviors are deferred to integration/E2E (noted
inline).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-112 | `learning_os_off_path_flag_identity` | Flag-OFF = byte-identical (P1/P2/P3/P7 preserved — these are PRESENTATION-only surfaces over the unchanged scoring/XP/anti-cheat engines). For every Alfa OS flag hook (`use-student-os-flag`, `use-subjects-os-flag`, `use-revision-os-flag`, `use-practice-os-flag`, `use-test-os-flag`, `use-principal-ai`): (1) the synchronous reader / DEFAULT_OFF resolves FALSE with no cache + no localStorage (production first-paint truth); a fresh `{on:false}` cache reads FALSE, an EXPIRED `{on:true}` cache is ignored → FALSE, a fresh `{on:true}` reads TRUE (post-rollout repeat visit). (2) `devForcedOn()` is a STRICT prod no-op — the localStorage force-key '1' is ignored when `NODE_ENV==='production'` and forces TRUE only when `NODE_ENV!=='production'` AND the key is exactly '1' (not 'true'/'0'). (3) `FLAG_DEFAULTS` contains every new flag (`ff_student_os_v1`, `ff_subjects_os_v1`, `ff_revision_os_v1`, `ff_practice_os_v1`, `ff_test_os_v1`, `ff_education_intelligence`, `ff_principal_ai_v1`) = false, with the registry constant matching the literal. (4) Pure presentation helpers re-present (never re-compute) engine output: mastery-buckets (due_for_review precedence, mastered/learning/locked, masteryPercent 0..1→0..100 clamp, weakestStartedTopic), readiness-map (level→node-status), revision-labels (0.5/0.8 display-only impact bucketing), briefing-helpers, and ScoreBar (80/60/40 bands, null→neutral). | `src/__tests__/lib/learning-os-flag-off-identity.test.ts`, `src/__tests__/lib/use-principal-ai-flag.test.ts`, `src/__tests__/lib/dashboard-mastery-buckets.test.ts`, `src/__tests__/components/learn-os-readiness-map.test.ts`, `src/__tests__/components/review-os-revision-labels.test.ts`, `src/__tests__/components/exam-briefing-helpers.test.ts`, `src/__tests__/admin-ui/score-bar.test.tsx` | E |
| REG-113 | `exam_briefing_predicted_score_parity` | The Alfa OS pre-test briefing hub's `getPredictedScoreEstimate` (display-only weighted-mastery estimate over exam_chapters) is a VERBATIM COPY of `getPredictedScore` in `src/app/exams/page.tsx` and MUST stay byte-equivalent (assessment-requested drift guard — P1/P2/P3 untouched, this is presentation-only). Asserts byte-equivalence vs an inline reference replica of the exams-page formula across 7 edge fixtures (empty / zero-weight-averages-mastery / weighted-sum / rounding / mixed) + 200 deterministic randomized inputs. If `exams/page.tsx` diverges, this guard fails and the briefing copy must be re-synced. Also pins EIC `super-admin/intelligence` pure coercers: `dedupLatest` keeps the newest row per key (PostgREST DISTINCT-ON substitute), and num/numOrNull/int/strArray/isUuid normalize Postgres-string rollup columns defensively. | `src/__tests__/components/exam-briefing-helpers.test.ts`, `src/__tests__/lib/super-admin-intelligence.test.ts` | E |
| REG-114 | `principal_ai_scope_lock_and_honest_pacing` | Principal AI Assistant prompt safety (P12 + REG-67 provenance). `PRINCIPAL_AI_SAFETY_RAILS` asserts presence of: the scope-lock refusal categories (other-school/benchmark/"average school"; individual-student PII → aggregates-only; out-of-scope/non-academic); DATA-ONLY grounding ("never invent"); the HONEST SYLLABUS-PACING decline (content-readiness ≠ teaching pace, "cannot predict … finish on time", no fabricated date/percentage); and the NEW POINT-IN-TIME / no-trends rail (single snapshot, no history, refuse change-over-time / "vs last week/month" / period-over-period). `buildContextSection` renders `avg_mastery` (0..1 read-model scale) through `fmtPct` as a PERCENT — the raw decimal must NOT leak — while `seat_utilization_pct` (already 0-100) is not rescaled; emits a "Data as of <generated_at>" line when present and omits it otherwise; returns null (caller abstains) on empty context. `buildPrincipalAiSystemPrompt` always carries the rails + a defensive placeholder for null context. REG-67 model-provenance stamping (`PrincipalAiHistoryMessage.model`) is part of the wire contract; the RPC-credential model (context RPC MUST be called via the USER-CONTEXT client so `auth.uid()` resolves the principal-only guard) is a RUNTIME-CLIENT behavior — deferred to integration/E2E (see notes). EIC read-API graceful-empty (HTTP 200 on missing table/no rows) + RLS service-role-only intent are likewise route-level — deferred to integration/E2E. | `src/__tests__/lib/ai/principal-ai-prompt.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy - REG-112/REG-113) - the Alfa OS surfaces re-present scoring
  outputs; the OFF path is byte-identical, and the briefing predicted-score is a
  display-only estimate kept byte-equivalent to the assessment-owned formula. No
  scoring formula is duplicated or forked.
- P2 (XP economy - REG-112) - presentation-only; no XP is computed in any new
  helper (mastery-buckets / readiness-map / revision-labels / briefing-helpers).
- P3 (anti-cheat - REG-112) - untouched; the OS surfaces sit over the unchanged
  quiz pipeline.
- P7 (bilingual UI - REG-112) - the new label helpers return non-empty Hi/En
  strings that differ, and technical figures stay numeric.
- P12 (AI safety - REG-114) - the Principal AI prompt is the sole guard between
  the principal and the model; scope-lock + honest-pacing + no-trends rails and
  the aggregates-only/PII boundary are pinned. avg_mastery 0..1→% presentation fix
  prevents a misleading raw-decimal leak.
- P13 (data privacy - REG-114) - EIC rollups are aggregates-only and the Principal
  AI context is PII-safe (group-level aggregates only). The RLS service-role-only
  read intent and the user-context-client RPC-credential model are runtime/DB
  behaviors deferred to integration/E2E.

### Deferred to integration / E2E (this session, unit-untestable)

- **Principal AI RPC-credential model**: `get_principal_ai_context(p_school_id)`
  MUST be called via the USER-CONTEXT Supabase client (not service-role) so the
  RPC's `auth.uid()` guard resolves the calling principal and scopes to their
  school. This is a runtime-client wiring behavior — covered by route integration
  + E2E, not a pure unit test.
- **EIC read-API graceful-empty + RLS service-role-only**: `safeSelect`/
  `fetchSchoolMeta` degrade to empty/HTTP-200 when the rollup tables are absent
  (migration not yet applied) or empty; the routes stay behind super-admin auth
  regardless of the `ff_education_intelligence` flag. These touch fetch + admin-auth
  env and the live PostgREST error shape — covered by route integration + E2E.
- **Flag async-reconcile + 404 route gating**: the hooks' `getFeatureFlags()`
  confirm/correct path and the additive `notFound()` routes (/revision, /practice,
  /exam-briefing) returning 404 while OFF are E2E concerns.

### Catalog total

Pre-Learning-OS: 79 entries. Adds REG-112..REG-114.

**Total: 82 entries.**

## CI pipeline-failure alerting (2026-06-12, PR #1015) — REG-130

Source: PR #1015 (`ops`/pipeline-alert). MERGED to `main` without its catalog
entry; promoted here retroactively (the #1015 testing review proposed this text).
This is a CI-only watcher — there is no Vitest/Playwright asserting test; the
"test" is the workflow contract itself, audited by reading
`.github/workflows/pipeline-alert.yml`. Logged as status `C` (CI-enforced, no
unit harness) rather than `U`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-130 | `ci_pipeline_failure_alert_out_of_band` | An out-of-band `workflow_run`-triggered watcher opens a GitHub issue when a watched pipeline concludes `failure`, and self-heals (closes the issue) on the next green run. WATCHED-NAME BYTE-EQUALITY INVARIANT: the watcher keys off the EXACT `name:` strings of the pipelines it guards (including em-dashes and other non-ASCII in the workflow display names) — a silent rename of a watched workflow that breaks byte-equality must be caught, because a watcher that matches nothing fails OPEN (silently never alerts). DEDUPE: at most ONE open `pipeline-failure` issue per watched workflow at a time (find-existing-open-by-label before create; subsequent failures comment/update, never spawn duplicates). SELF-HEALING: a subsequent successful run of the same workflow closes the open failure issue automatically. OUT-OF-BAND SURVIVAL: the alerter runs as a SEPARATE `workflow_run` workflow (not a step inside the watched pipeline) precisely so it survives the in-pipeline-rollback failure mode — if the watched pipeline dies mid-run or a rollback step aborts it, the alerter still fires from the completed `workflow_run` event. The watcher itself uses `permissions: issues:write` only and carries no deploy/secret scope. | `.github/workflows/pipeline-alert.yml` (CI-only; no unit harness) | C |

## MOL Python-unification (sub-project A) — router, breaker, cost-cap, parity gate, streaming safety (2026-06-13) — REG-135..REG-139

Source: MOL Python-unification plan
(`docs/superpowers/specs/2026-06-13-mol-python-unification-design.md`, Phase 9 /
Task 9.1). Sub-project A ports the Model-Orchestration-Layer router, circuit
breaker, cost cap, cache, and `/v1/generate{,/stream}` endpoints from the TS
implementation into the Python AI service (`python/`), behind a TS→Python
cutover. **Every flag introduced by this work ships DEFAULT-OFF** (deterministic
OpenAI-priority, shadow-priority, the Python cutover kill-switch) so the live TS
path is byte-unchanged until each flag is deliberately flipped. All five anchors
verified green before cataloguing: `python -m pytest` over the named suites =
**72 passed** (2026-06-13).

> **ID note (2026-06-13):** the Phase 9 plan drafted these as REG-120..REG-124,
> and they were first catalogued on `feat/mol-python-unification` as
> REG-130..REG-134. On merging `origin/main` those ids collided with main's
> CI pipeline-alert promotion (REG-130) and the Phase A Loops B & C cluster
> (REG-131..REG-134). Per the catalog's standing collision convention (see the
> REG-117, REG-123, and REG-124 ID notes), main keeps REG-130..REG-134 and these
> MOL entries were renumbered to the next free block **REG-135..REG-139**. No
> test code referenced the draft or interim ids.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-135 | `mol_deterministic_openai_priority` | Provider-priority routing is predictable: OpenAI is ALWAYS the primary provider unless the circuit is OPEN, a per-task override applies, or the shadow-priority flag is set (P12 — no nondeterministic provider roulette for a live student turn). The deterministic-priority router promotes OpenAI to the front of every OpenAI-bearing chain WITHOUT consulting a random weight (the legacy weighted path is the OFF default), is a no-op when a chain has no OpenAI provider, and is stable across repeated calls (same input ⇒ same chain). The `/v1/generate` endpoint reads the deterministic-priority flag and, when ON, routes OpenAI-primary; the flag ships default-OFF so the live weighted path is unchanged until flipped. | `python/tests/unit/test_router.py` (`test_deterministic_priority_makes_openai_primary_without_random`, `test_deterministic_priority_reasoning_promotes_openai_first`, `test_deterministic_priority_is_stable_across_calls`, `test_deterministic_priority_noop_when_chain_has_no_openai`, `test_shadow_priority_on_uses_weights_and_random`), `python/tests/integration/test_generate_endpoint.py::test_generate_reads_deterministic_priority_flag` (+ `test_generate_uses_openai_primary_when_deterministic_flag_on`) | U + I |
| REG-136 | `mol_cross_instance_circuit_breaker` | Cross-instance (Redis-keyed) circuit breaker degrades gracefully and NEVER blocks a live request when its own backing store is unreachable (P12). State machine pinned at every transition: CLOSED allows requests; three failures OPEN the circuit; the open window is keyed by provider × task (one tripped provider/task does not blast-radius the rest); on expiry exactly ONE half-open probe is allowed; two successes in half-open CLOSE the circuit, a single success does NOT, and a failure in half-open RE-OPENS it. FAIL-OPEN safety: when Redis is unreachable the breaker allows the request through rather than failing the student's turn. At the endpoint, a provider whose breaker is OPEN is skipped in favour of the next chain entry; only retryable 5xx count toward tripping (non-retryable 4xx do not). | `python/tests/unit/test_breaker.py` (`test_closed_breaker_allows_requests`, `test_three_failures_block_while_open_window_live`, `test_open_circuit_keyed_by_provider_and_task`, `test_open_expired_allows_exactly_one_probe`, `test_two_successes_in_half_open_close_the_circuit`, `test_failure_in_half_open_reopens_circuit`, `test_single_success_in_half_open_does_not_close`, `test_fail_open_when_redis_unreachable`), `python/tests/integration/test_generate_endpoint.py::test_generate_skips_open_breaker_provider` (+ `test_breaker_ignores_non_retryable_4xx_but_counts_5xx`) | U + I |
| REG-137 | `mol_cost_cap_enforcement` | Per-task cost ceiling is enforced BEFORE any provider HTTP call (P12 / cost-control — a runaway/expensive request is rejected at the gate, never after spend). Every task type has a ceiling; the INR estimate uses the primary model's price; an under-ceiling estimate does not raise; an over-ceiling estimate raises `COST_CAP_EXCEEDED`; an unknown model estimates zero and passes (fail-soft for unpriced models, not fail-closed). At the endpoint, an over-ceiling request returns HTTP 429 and the test asserts NO provider call was made (the cap short-circuits ahead of the network seam). | `python/tests/unit/test_cost_cap.py` (`test_every_task_type_has_a_ceiling`, `test_estimate_inr_uses_primary_model_price`, `test_under_ceiling_does_not_raise`, `test_over_ceiling_raises_cost_cap_exceeded`, `test_unknown_model_estimate_is_zero_and_passes`), `python/tests/integration/test_generate_endpoint.py::test_generate_429_when_cost_cap_exceeded` (asserts no provider call) | U + I |
| REG-138 | `mol_cutover_parity_gate` | Contract-parity gate blocking a regressing TS→Python cutover (P14 — the cutover must be behaviour-preserving). The Python router reproduces the TS routing decision cassette-for-cassette across task types (explanation, step_by_step, quiz_generation, reasoning) and emits a `mol_request_logs` telemetry row whose COLUMN SET matches the TS shape exactly (no field drift across the two implementations). The eval harness is the quality gate: a golden set is non-empty and typed, the gate PASSES when every item meets its quality floor, FAILS when any item drops below floor, and treats an ungradeable item as a failure (fail-closed gate — a regressing cutover cannot slip through on a missing grade). | `python/tests/integration/test_routing_parity.py` (`test_routing_decision_matches_ts_cassette[explanation/step_by_step/quiz_generation/reasoning]`, `test_telemetry_row_shape_matches_ts_cassette`), `python/tests/unit/test_eval_harness.py` (`test_golden_set_nonempty_and_typed`, `test_gate_passes_when_all_items_meet_floor`, `test_gate_fails_when_any_item_below_floor`, `test_gate_treats_ungradeable_as_failure`) | I + U |
| REG-139 | `mol_streaming_path_safety` | The streaming endpoint never leaks a raw 5xx / stack trace to a student mid-stream (P12 — student-facing AI safety on the SSE path). `/v1/generate/stream` returns the SSE `text/event-stream` content-type; the terminal `done` event carries the request id (traceability without exposing internals); and an invalid-input failure becomes a structured `event: error` SSE frame rather than a transport-level 5xx or an unframed stack — a `MolError` is converted to an error event the client can render safely, and a client disconnect cancels the stream cleanly. | `python/tests/integration/test_generate_stream_endpoint.py` (`test_stream_returns_sse_content_type`, `test_stream_done_event_carries_request_id`, `test_stream_invalid_input_emits_error_event`) | I |

### Invariants covered by this section

- P12 AI safety / orchestration — REG-135 (deterministic, non-random provider
  priority), REG-136 (breaker degrades gracefully + fail-open never blocks a live
  turn), REG-137 (cost cap rejects before spend), REG-139 (streaming path emits a
  safe `event: error` frame, never a raw 5xx/stack to a student).
- P14 Contract parity / review-chain completeness — REG-138 (TS↔Python routing +
  `mol_request_logs` column-set parity; eval-harness quality gate fails closed on
  any regressing or ungradeable cutover item).
- OFF-path safety / kill switch — every flag in this sub-project (deterministic
  OpenAI-priority, shadow-priority, the Python cutover kill-switch) ships
  DEFAULT-OFF; the live TS path is byte-unchanged until each flag is flipped.

### Catalog total

Pre-MOL (post-merge with `origin/main`): 102 entries (through the Phase A Loops
B & C cluster, REG-134). MOL Python-unification sub-project A adds REG-135
(deterministic OpenAI-priority), REG-136 (cross-instance circuit breaker),
REG-137 (cost-cap enforcement), REG-138 (cutover parity gate), REG-139
(streaming-path safety). **Total catalog: 107 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 107 entries.**

## Hermetic LLM mock layer — per-call-site enforcement contract (2026-06-19) — REG-168

Source: root cause analysis of `math-classify.test.ts` calling real OpenAI when
`OPENAI_API_KEY` was set in `.env.local` (2026-06-19). The original `setup.ts`
mocked `callClaude` globally but left `callReasoningModel` unmocked, so the
ambiguous-branch LLM path reached the real API.

The fix and the enforcement contract:

All three LLM client modules have dedicated unit tests that test the REAL function
by stubbing `global.fetch` (same pattern as `openai-client.test.ts`):
- `@/lib/ai/clients/claude` — tested in `src/__tests__/ai/agents/claude-tools.test.ts`
- `@/lib/ai/clients/openai` — tested in `src/__tests__/lib/ai/openai-client.test.ts`
- `@/lib/ai/clients/reasoning-cascade` — tested in `src/__tests__/lib/ai/reasoning-cascade.test.ts`

Because those files need the real module, a setup-level `vi.mock` for any client
breaks them. The hermetic guarantee is therefore per-call-site:

1. Every test file that imports application code which USES a client without
   directly testing it MUST add `vi.mock('@/lib/ai/clients/<module>')` at the top.
   This is the established and enforced pattern:
   `math-classify.test.ts` mocks both `claude` and `reasoning-cascade`;
   `reasoning-cascade.test.ts` mocks `callOpenAI` and `callClaude` as sub-clients.

2. `setup.ts` emits a `console.warn` when `ANTHROPIC_API_KEY` or a real
   `OPENAI_API_KEY` is present in the test environment, making the risk visible in
   test output so developers know to check their file-level mocks.

3. `callClaude` returns an error response (status 503) when `ANTHROPIC_API_KEY` is
   absent. `callOpenAI` throws `'OPENAI_API_KEY not configured'` before any fetch
   when the env var is absent. Both clients fail safely without network access.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-168 | `hermetic_llm_mock_layer_per_call_site` | (1) `setup.ts` emits `[TEST SETUP] ANTHROPIC_API_KEY is set` warn when `ANTHROPIC_API_KEY` is present and `[TEST SETUP] OPENAI_API_KEY is set to a real key` warn when `OPENAI_API_KEY` is present and does not start with `sk-test`. (2) `math-classify.test.ts` mocks both `@/lib/ai/clients/claude` and `@/lib/ai/clients/reasoning-cascade` at the file level — the ambiguous-branch test that originally hit real OpenAI is covered by the `_callReasoningModel` mock. (3) `reasoning-cascade.test.ts` mocks `callOpenAI` and `callClaude` as sub-clients and runs the REAL cascade — the file-level mocks take precedence and no real API is reached. (4) `openai-client.test.ts` and `claude-tools.test.ts` test the REAL client functions using `vi.stubGlobal('fetch', ...)` — no setup-level mock interferes. The contract: any new test file that imports code which transitively calls a client without mocking the client at the file level MUST be flagged as a quality rejection. | `src/__tests__/setup.ts` (CI environment guard + inline contract documentation) | E |

### Invariants covered by this section

- P12 (AI safety) — test suite cannot accidentally call real AI providers and
  incur API costs, expose student data to external services, or produce
  non-deterministic test results due to real API responses.

### Notes on test strategy

REG-168 is a process/infrastructure contract rather than a pure unit assertion.
The enforcing artifact is the documented rule in `setup.ts` (read by every
developer who touches test infrastructure) plus the CI environment guard that
makes the risk visible. The `math-classify.test.ts` file-level mock pattern
is the primary proof that per-call-site enforcement works: the previously-failing
case (real OpenAI called on the ambiguous branch) is now hermetic.

### Catalog total

Pre-REG-168: 135 entries (through Phase 1 academic structure, REG-167). The
hermetic LLM mock layer contract adds REG-168 (per-call-site enforcement +
CI environment guard in setup.ts — P12 test-suite AI safety).
**Total catalog: 136 entries (target: 35 — TARGET EXCEEDED).**

**Total: 136 entries.**

## White-label flag registration + module-gating activation (Phase 3C Wave A) — REG-169

Source: Phase 3C Wave A "white-label activation" (autonomous, additive,
default OFF). Registers the four dormant multi-tenant feature flags in
`src/lib/feature-flags.ts` (`WHITE_LABEL_FLAGS` + `FLAG_DEFAULTS`) so prod (which
already had the legacy DB rows from migrations 20260507000004-7) and a fresh
CI/staging/Preview env resolve them IDENTICALLY — OFF — paired with an idempotent
seed migration (`supabase/migrations/20260615000000_phase3c_seed_white_label_flags.sql`,
`INSERT ... ON CONFLICT (flag_name) DO NOTHING`). Activates the dormant module
substrate via a thin route guard (`src/lib/modules/route-guard.ts`:
`assertModuleEnabledForSchool` / `assertModuleEnabled`) applied AFTER auth on 7
school-admin routes (exams→`testing_engine`, content→`lms`,
analytics/reports/classes-at-risk/teacher-engagement→`analytics`,
announcements→`communication`). The guard delegates the enablement decision
entirely to the pre-existing registry resolver `isModuleEnabled` (which
short-circuits to all-modules-enabled when `ff_tenant_module_registry_v1` is OFF)
and maps ONLY an explicit `isModuleEnabled(...)===false` to a 404
`{ code:'MODULE_DISABLED', module }`. NO new table, NO new RBAC permission, NO
scoring/XP — flag registration + a fail-open gate + nav parity.

Four things are blocking defects if they regress: (a) **flag registration +
default OFF** — all four white-label flags (`ff_tenant_type_v1`,
`ff_tenant_module_registry_v1`, `ff_tenant_config_v2`, `ff_event_bus_v1`) are
present in `FLAG_DEFAULTS` and resolve to `false`; `WHITE_LABEL_FLAGS` maps each
constant to its exact migration `flag_name` string (asserted against a SECOND
independent literal so a drift on either side fails); `ff_event_bus_v1` is
registered for correctness/env-parity even though it is not wired this phase; no
white-label flag is ever `true` by default (founder ship-OFF constraint).
(b) **route-guard fail-open contract** — an explicit DISABLED module → a 404
carrying `code:'MODULE_DISABLED'` + the SPECIFIC module key (never 403/500);
every uncertainty FAILS OPEN to `{ allowed:true }`: null/undefined/empty schoolId
short-circuits with NO school lookup, `getSchoolById` ok(null)/failure/throw →
allow, `isModuleEnabled` throw → allow; the resolved tenant_type is passed
through to `isModuleEnabled`; the header-driven `assertModuleEnabled` resolves
the school from `x-school-id` (absent header = B2C = fail-open). (c) **PII-safe
error logging (P13)** — the resolve-failure `logger.warn` payload carries ONLY
the module key + a route tag + the thrown Error; it never adds `schoolId` /
`email` / `userId`; the happy path emits no warn. (d) **nav parity with the route
guard** — `ConsolidatedSchoolNav` hides a `moduleKey`-tagged item exactly when
`moduleEnablement[key]===false` (mirrors the 404), shows ALL items when
`moduleEnablement` is null/undefined (loading/error fail-open), and shows ALL
items when the enablement map is every-key-true (the flag-OFF all-enabled map the
resolver returns), so a tenant never sees a nav link that 404s nor loses a link
to a served module.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-169 | `white_label_flags_registered_off_module_route_guard_disabled_404_fail_open_nav_parity` | **(a) Flag registration (pure).** `WHITE_LABEL_FLAGS` maps `TENANT_TYPE_V1`/`TENANT_MODULE_REGISTRY_V1`/`TENANT_CONFIG_V2`/`EVENT_BUS_V1` to `ff_tenant_type_v1`/`ff_tenant_module_registry_v1`/`ff_tenant_config_v2`/`ff_event_bus_v1` (vs a 2nd independent literal); exactly those four keys; all four PRESENT in `FLAG_DEFAULTS` (key-existence, so a deletion fails) and each resolves to `false`; `ff_event_bus_v1` registered (correctness); no white-label flag is `true` in `FLAG_DEFAULTS`; `as const` literal narrowing. **(b) Route guard (mocked `isModuleEnabled` + `getSchoolById` + logger).** explicit `isModuleEnabled→false` → `{ allowed:false }` + 404 `{ success:false, code:'MODULE_DISABLED', module }` echoing the SPECIFIC key (testing_engine / lms / analytics), status 404 (NOT 403, NOT 500); tenant_type resolved + passed to `isModuleEnabled`; `isModuleEnabled→true` → `{ allowed:true }`; FAIL-OPEN → `{ allowed:true }` for null schoolId (NO lookup, NO resolver call), undefined schoolId, empty-string schoolId, `getSchoolById` ok(null) (no resolver call), `getSchoolById` failure result, `getSchoolById` throws (caught), `isModuleEnabled` throws (caught); header entry `assertModuleEnabled` 404s a disabled module from `x-school-id`, allows enabled, fails open on absent header (B2C, no lookup) + on school-lookup failure. **(c) PII-free logging (P13).** the error-branch `logger.warn('module_route_guard_resolve_failed', …)` payload carries `module` + route tag only — NOT `schoolId`/`school_id`/`email`/`userId`; happy path emits no warn. **(d) Guarded-route integration (mocked auth + guard spy).** GET /api/school-admin/exams: auth 401/403 short-circuits BEFORE the gate (gate never invoked); on auth success the gate is called with `(schoolId, 'testing_engine')`; a DISABLED gate → the 404 `MODULE_DISABLED` body and never reads the DB; an ALLOWED gate (flag-OFF / all-enabled / fail-open) → 200 with the handler's exam list. **(e) Nav parity.** `ConsolidatedSchoolNav` hides exactly the `moduleKey` item whose `moduleEnablement[key]===false` (and only that one) while keeping non-module items (Students/Classes/Command Center) visible; shows EVERY module-gated link when `moduleEnablement` is null/undefined (fail-open) and when the map is every-key-true (flag-OFF all-enabled). | `src/__tests__/lib/white-label-flags.test.ts` (13 unit tests: registry string parity vs 2nd literal + exactly-four-keys + event-bus registration + as-const narrowing; FLAG_DEFAULTS presence + per-flag OFF + no-flag-enabled-by-default) + `src/__tests__/lib/modules/route-guard.test.ts` (21 unit tests, mocked seams: disabled→404 MODULE_DISABLED + specific key + 404-not-403/500 + tenant_type passthrough; allowed; fail-open null/undefined/empty-schoolId-no-lookup + ok(null)-no-resolver + failure + getSchoolById-throw + isModuleEnabled-throw; PII-free warn + no-warn-on-happy-path; header entry disabled-404/allowed/B2C-no-lookup/lookup-failure) + `src/__tests__/api/school-admin/module-route-gate.test.ts` (5 unit tests, mocked: auth-401/403 before gate; gate called with (schoolId, testing_engine); disabled→404 no-DB-read; allowed→200 exam list) + `src/__tests__/school-admin/consolidated-nav-module-gating.test.tsx` (7 unit tests: section-map has module-gated items; hides exactly the disabled item + non-module items stay; null/undefined → all shown; all-enabled map → all shown) | E |

### Pinned tests

- `src/__tests__/lib/white-label-flags.test.ts::WHITE_LABEL_FLAGS registry::maps every constant to the exact flag string used by the seed migration`
- `src/__tests__/lib/white-label-flags.test.ts::FLAG_DEFAULTS — every white-label flag is present and OFF::registers all four white-label flags in FLAG_DEFAULTS (closes the prod/fresh-env gap)`
- `src/__tests__/lib/white-label-flags.test.ts::FLAG_DEFAULTS — every white-label flag is present and OFF::does NOT enable any white-label flag by default (founder safety constraint)`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — explicit DISABLED → 404 MODULE_DISABLED::returns { allowed:false } with a 404 carrying code:MODULE_DISABLED + the module key`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — FAIL-OPEN (never lock a tenant out)::null schoolId → allowed, and NO school lookup is attempted (short-circuit)`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — FAIL-OPEN (never lock a tenant out)::getSchoolById throws → caught → allowed`
- `src/__tests__/lib/modules/route-guard.test.ts::assertModuleEnabledForSchool — error-branch logging is PII-free (P13)::logs warn with ONLY the module key + route tag on a thrown error (no school_id, no PII)`
- `src/__tests__/api/school-admin/module-route-gate.test.ts::GET /api/school-admin/exams — module gate runs AFTER auth::auth failure short-circuits BEFORE the module gate (gate never invoked)`
- `src/__tests__/api/school-admin/module-route-gate.test.ts::GET /api/school-admin/exams — disabled module → 404; allowed → handler proceeds::a DISABLED module returns the gate 404 response and never reads the DB`
- `src/__tests__/school-admin/consolidated-nav-module-gating.test.tsx::ConsolidatedSchoolNav — item with moduleKey whose enablement is false is HIDDEN::hides exactly the disabled item, mirroring the route-guard decision for that key`

### Invariants covered by this section

- Flag-OFF byte-identity (rollout safety) — `ff_tenant_module_registry_v1`
  default-OFF makes the resolver short-circuit to all-modules-enabled, so the
  route guard is a no-op and behaviour is byte-identical to pre-Wave-A; all four
  white-label flags default OFF in `FLAG_DEFAULTS` so a fresh env matches prod.
- P8/P9 (tenant scope) — the guard takes the school from `auth.schoolId`
  (school-admin entry) or the proxy-injected `x-school-id` header (tenant entry),
  never a request body; it runs AFTER `authorizeSchoolAdmin`, never before.
- P13 (data privacy) — the resolve-failure `logger.warn` carries the module key +
  route tag only, never the school UUID / email / user id; the disabled→404 body
  carries the module key only (no PII).
- Fail-open availability — a school-lookup failure, a missing school row, or any
  thrown error resolves to `{ allowed:true }` so a tenant is never locked out of a
  feature by an infra hiccup; only an explicit `isModuleEnabled===false` 404s.
- No scoring/XP (activation only) — Wave A registers flags + adds a fail-open gate
  + nav parity; no XP constant or scoring formula is read or written.

### Notes on test strategy

REG-169 is a **pure-unit + mocked-seam** entry (no live-DB tier — the only DB
artifact is the idempotent `ON CONFLICT DO NOTHING` flag seed whose effect is a
no-op on prod and equals the registered `FLAG_DEFAULTS` on a fresh env, asserted
indirectly via the flag-registration test). The flag test imports the REAL
exported `WHITE_LABEL_FLAGS` / `FLAG_DEFAULTS` and asserts every string against a
SECOND independent EXPECTED literal so a drift in either copy fails (it is NOT a
tautology against the source map), mirroring the goal-adaptive registry tests.
The route-guard test mocks the two seams the guard delegates to
(`@/lib/modules/registry` `isModuleEnabled` via `importActual` to keep `ModuleKey`
typing, `@/lib/domains/tenant` `getSchoolById`) plus the logger so the guard's
REAL fail-open branching + 404 mapping run, and asserts every fail-open branch
plus the PII-free warn payload. The guarded-route integration test mocks the auth
seam + spies the guard (`assertModuleEnabledForSchool`) so the exams route's REAL
order (auth → gate → handler) is exercised: it proves the gate runs AFTER auth by
asserting the spy is never called when auth fails, and that the gate is invoked
with the correct `testing_engine` module key. The nav test renders the REAL
`ConsolidatedSchoolNav` against the REAL `SCHOOL_NAV_SECTIONS` map and probes
PURELY module-gated items (excluding the Wave C/D `rbacOnly`/`reportsDepthOnly`
items, which carry their own default-OFF flag gates covered by REG-98/REG-99).

### Catalog total

Pre-REG-169: 136 entries (through hermetic LLM mock layer, REG-168). Phase 3C
Wave A (white-label flag registration + module-gating activation, default OFF)
adds REG-169 (four white-label flags registered + default OFF + migration-string
parity; module route guard disabled→404 `MODULE_DISABLED` with fail-open on
null/missing-school/error and PII-free logging; guarded-route gate runs after
auth; nav hide/show parity with the route-guard decision).
**Total catalog: 137 entries (target: 35 — TARGET EXCEEDED).**

**Total: 137 entries.**

---

## Remediation — FOX-4: MoL OpenAI-Shadow Governance (P12) — 2026-06-29

Source: remediation program, item FOX-4 (govern-with-flag the OpenAI MoL shadow
in the grounded-answer path). The shadow leg fires an OpenAI generation
ALONGSIDE the baseline Claude answer purely for offline model comparison — it is
NEVER student-facing. FOX-4 scoping confirmed the shadow is ALREADY
well-governed (two default-OFF flags: `ff_grounded_answer_mol_shadow_v1` +
`ff_mol_shadow_text_capture_v1`) AND its safety harness ALREADY runs in the
DEFAULT `npm test` lane as a hard per-PR gate (the design's open-question O1 —
"integration-only, not per-PR enforced" — was STALE/incorrect: the existing
`mol-shadow.vitest-harness.ts` is enumerated in `vitest.config.ts`'s default-lane
`include`, NOT behind `RUN_INTEGRATION_TESTS`). FOX-4 is test+doc only — NO
app-code change. It adds a thin, self-documenting governance harness that
re-asserts the two load-bearing SAFETY invariants under a clear FOX-4 / REG-197
header so the govern-with-flag posture cannot regress silently. The harness
mocks all three seams (OpenAI `generateResponse`, telemetry `recordMolRequest`,
flag `getFlagEnvelope`) — pure unit, no live key/network/DB.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-197 | `mol_shadow_never_student_facing_flag_off_no_side_effect` | P12: pins the two MoL-shadow safety invariants — (i) the OpenAI shadow is NEVER student-facing (`shadowFireOpenAI` returns void, `molResult.text` discarded, baseline Claude content is the sole returned/streamed answer, fire-and-forget) and (ii) flag-OFF / kill-switch / task-not-allow-listed / sample-miss / flag-read-throws ⇒ ZERO side effects (no `generateResponse` call, no telemetry write). Guards the govern-with-flag posture (`ff_grounded_answer_mol_shadow_v1` + `ff_mol_shadow_text_capture_v1`, both seeded OFF); Claude remains the sole student-facing model. | `supabase/functions/grounded-answer/__vitest__/mol-shadow-governance.vitest-harness.ts` | E |

### Invariants covered by this section

- P12 (AI safety) — REG-197 pins the OpenAI MoL-shadow's two safety guarantees:
  it never reaches a student (void return, discarded shadow text, baseline
  Claude is the only answer, fire-and-forget) and it produces zero side effects
  when its flag is OFF / killed / out-of-scope / sample-missed / flag-read-fails.
  Claude (Haiku) stays the sole student-facing model; the OpenAI leg is an
  offline-comparison shadow only.

### Catalog total

Pre-FOX-4: 163 entries (through Remediation PAY-2's REG-195/REG-196 consumer
pricing source-of-truth). Remediation FOX-4 adds REG-197 (MoL OpenAI-shadow
governance — the two P12 safety invariants in the default per-PR lane).
**Total catalog: 164 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-02 — Environment Readiness remediation wave (certification-on-staging) — REG-227..REG-229

Source: `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md`
(ops Environment Readiness Assessment ahead of authorizing a certification run
against staging) and its consolidated fix record
`docs/runbooks/2026-07-02-environment-readiness-remediation.md`. Three
independently-confirmed defects, three fixes, three regression tests.

1. **Sentry environment-tagging defect (confirmed, safety-relevant).** All
   three Sentry init files keyed `environment:` off `process.env.NODE_ENV`
   only. `next build` always sets `NODE_ENV=production` for a
   production-mode build regardless of Vercel deploy target — `VERCEL_ENV`
   is the only value Vercel varies. Since staging deploys as a genuine Vercel
   Preview (`deploy-staging.yml`), every staging Sentry event — including any
   error thrown by certification testing — was tagged `environment:
   production`, byte-identical to a real production incident. Fixed by
   reading `NEXT_PUBLIC_VERCEL_ENV`/`VERCEL_ENV` first (matching 35+ other
   call sites), falling back to `NODE_ENV` only for pure local dev.
2. **No canonical certification-traffic traceability convention.** Specified
   in `docs/runbooks/certification-traffic-traceability.md` (four required
   signals: `@certification.alfanumrik.invalid` email domain, `is_demo=true`,
   a `cert-<run_id_short>-<role>-<n>` name/`display_name` marker, and a
   `demo_accounts` registry row) and implemented by
   `scripts/seed-certification-accounts.ts`, which seeds one account per
   certification mission role (7 roles, including `content_author` and
   `support_staff` — real RBAC roles with no dedicated frontend portal per
   this session's Wave 1 findings, seeded anyway so Stage 2 can prove that
   gap live) idempotently (find-or-create, parameterized by a per-run id).
3. **No single-operation teardown path for a school-scoped certification
   tenant.** `students.school_id`/`teachers.school_id` reference
   `schools(id)` with no `ON DELETE CASCADE` (deliberately — a real safety
   property, not a bug), so hard-deleting a `schools` row with any linked
   student/teacher failed with Postgres 23503. Fixed by architect via
   migration `20260702180000_certification_tenant_teardown.sql`, adding
   `purge_certification_tenant(p_school_id)` — a guarded, `is_demo=true`-only,
   single-call teardown of an entire tenant — and extending
   `purge_demo_account_by_id`'s `school_admin` branch to also purge teachers
   (a gap the traceability runbook had flagged and manually worked around).
   **Same-day correction:** a quality review of the first version of this
   migration found its non-cascading-child-table inventory stale, missing 4
   genuinely-blocking tables that exist in this repo today
   (`foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`,
   `admin_impersonation_sessions` — per-student) plus 2 tenant-level/B2B
   tables (`payment_reconciliation_queue`, `school_contracts`). The migration
   was extended in place (same file, "Corrected FK inventory" section) to
   clear all 7 blocking items before the parent-row deletes, and REG-229's
   test fixture was extended to match — see the table below for the current
   (13-table) scope.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-227 | `sentry_environment_tag_resolution` | All three Sentry init files (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) resolve `environment:` via `VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` FIRST, falling back to `NODE_ENV` only when unset — pinned both as a static source-parse (the exact expression string, and a negative assertion that the pre-fix NODE_ENV-only shape never reappears) and as semantic behavior via a byte-identical locally-reproduced resolver function exercised with `vi.stubEnv`: a Preview-deployment-shaped env (`VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV='preview'`, `NODE_ENV='production'`) resolves to `'preview'`, NOT `'production'` — the exact certification-on-staging safety scenario. Also pins that the `beforeSend` production-only drop guard (`if (NODE_ENV !== 'production') return null`) is unchanged by this fix — only the tag, not the send/drop decision. | `src/__tests__/sentry/environment-tag-resolution.test.ts` (11 tests) | E |
| REG-228 | `certification_account_seeding_idempotent_shape` | `scripts/seed-certification-accounts.ts`'s pure shape helpers (`buildAccountShape`, `buildSchoolShape`, `buildBaseTableRow`, `buildDemoAccountsRow`) produce the traceability runbook's exact marker conventions byte-for-byte (`cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid`, matching `name`/`display_name`, `is_demo=true` on every base-table row, `[CERTIFICATION] cert-<run_id_short>-school-<n>` for the synthetic school) for all 7 mission roles (student/teacher/parent/school_admin/super_admin/content_author/support_staff); pins that `content_author`/`support_staff` are seeded with `hasPortal=false` (Wave 1 finding — no frontend portal exists, proved live in Stage 2) while every other role is `hasPortal=true`; pins that `buildDemoAccountsRow` returns `null` (never mislabels as `role='super_admin'`) for the two roles with no CHECK-legal `demo_accounts.role` value, a documented limitation. Idempotency is proven against an in-memory fake client (no live DB, consistent with the rest of the unit lane): calling the find-or-create primitives (`findOrCreateAuthUser`, `upsertBaseTableRow`, `upsertDemoAccountsRow`, `upsertSchoolRow`) and the full `seedCertificationAccounts` orchestrator TWICE with the SAME run id creates every row exactly once (second call reports `created: false` for all 7 accounts, zero new rows in any table); a DIFFERENT run id produces a fully independent, non-colliding row set. | `src/__tests__/certification/seed-certification-accounts.test.ts` (23 tests) | E |
| REG-229 | `purge_certification_tenant_teardown` + `purge_certification_run_teardown` | Covers BOTH certification-teardown functions. **(A) `purge_certification_tenant(p_school_id)`** (migration `20260702180000_certification_tenant_teardown.sql`, corrected post-quality-review to close 4 genuinely-blocking tables the original version missed — see the migration's "Corrected FK inventory" section): (1) raises an exception (`ERRCODE 42501`) and touches ZERO rows when called against a school where `is_demo IS NOT TRUE` (including `is_demo IS NULL`) — the target school row survives completely untouched; (2) a school_id that never existed, and a second/third call on an already-torn-down tenant, both return the idempotent no-op shape (`success:true, already_absent:true`) with no error; (3) a full happy-path run seeds a demo school + a `demo_accounts`-registered student (registry-path branch) + a non-registered teacher (defensive direct-sweep branch) + rows in all 13 tables the corrected migration touches — the 4 original defensively-cleaned school-scoped child tables (`school_alert_rules`, `school_audit_log`, `school_invoices`, `school_seat_usage`), PLUS the 6 tables added by the correction: the 4 per-student RESTRICT/no-cascade child tables (`foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`, `admin_impersonation_sessions` — corrected FK inventory items 1-4) and the 2 tenant-level/B2B RESTRICT tables (`payment_reconciliation_queue`, `school_contracts` — items 5-7) — calls the RPC once, and asserts ZERO rows remain across every one of those 13 tables plus `demo_accounts` and the `schools` row itself, then re-calls it twice more confirming the zero-row state is stable. The `payment_reconciliation_queue` fixture's `invoice_id` is deliberately linked to the SAME `school_invoices` row being torn down, so the zero-row assertion also proves delete ORDER (item 6's chained RESTRICT against `school_invoices` — the migration clears `payment_reconciliation_queue` before `school_invoices`; a reversed order would 23503 the whole RPC call and fail every assertion in the block, not just leave a stray row). **(B) `purge_certification_run(p_run_id_short)`** (migration `20260702190000_certification_run_teardown.sql`, the single-call FULL-run teardown that DELEGATES the school-scoped part to `purge_certification_tenant` and adds the standalone-account cleanup the tenant function does not cover): (1) INPUT FORMAT GUARD — a `p_run_id_short` that is not exactly 8 lowercase hex chars raises the migration's documented `ERRCODE 22023` (invalid_parameter_value, "must be exactly 8 lowercase hex characters"), asserted for both a too-long (10-hex) and a non-hex value, with `data` null (no rows touched); (2) DELEGATED TENANT TEARDOWN + STANDALONE CLEANUP — one call on a fully-seeded run (a `[CERTIFICATION]` demo school + school-scoped student/teacher/school_admin + representative tenant child tables + standalone demo guardian + standalone demo admin_users super_admin with all 4 admin child tables it clears — `admin_announcements`, `admin_audit_log`, `admin_impersonation_sessions`, `admin_support_notes` — + a real non-demo school whose `schools.paused_by_super_admin_id` points at the demo admin + 3 `demo_accounts` rows) leaves ZERO rows across every school-scoped AND standalone table, deletes the `schools` demo row, and proves the `paused_by_super_admin_id` NULL path (the real school SURVIVES with its pointer nulled, never deleted); (3) is_demo + DOMAIN DOUBLE GUARD — a NON-demo admin_users row (cert email domain, `is_demo=false`) and a NON-cert-domain guardian row (`is_demo=true`) that match the run marker in every way except the guard both SURVIVE untouched (mirrors the tenant suite's real-school guard proof); (4) auth-USER SURFACING — the returned `standalone_auth_user_ids` array equals `[guardianAuthId, adminAuthId]` (guardian ids first per `v_guardian_auth_ids || v_admin_auth_ids`), and the two survivors' auth ids are NEVER surfaced (function surfaces ids for GoTrue cleanup, does not itself delete auth.users); (5) IDEMPOTENCY — second/third calls return `success:true, already_absent:true` with every `*_purged` counter 0 and empty `standalone_auth_user_ids`, deleting nothing, and a never-seeded run returns the same no-op shape on the very first call. Return-shape field names (`success`, `run_id_short`, `already_absent`, `schools_purged`, `schools_purged_count`, `guardians_purged`, `admin_users_purged`, `demo_accounts_purged`, `standalone_auth_user_ids`) and table/column names are asserted against the migration's actual code, not assumed. LANE: integration (`RUN_INTEGRATION_TESTS=1`), self-skips cleanly without live Supabase credentials — see the file's "STAGE-2 COVERAGE NOTE" for exactly what is proven vs. still pending live execution. | `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` (8 tests: 4 tenant + 4 run; integration lane) | E |

### Invariants covered by this section

- P13 (data privacy / operational-integrity) — REG-227 closes a genuine
  monitoring-pollution defect: certification-caused staging errors would have
  been indistinguishable from real production incidents in Sentry's
  `environment` filter, defeating the on-call signal.
- P8 (RLS boundary) — REG-229 pins that `purge_certification_tenant` is
  structurally incapable of reaching a non-demo school (the `is_demo`
  guard is inside the function body, not just the `GRANT`), so it can never
  become a general-purpose school-deletion backdoor even from a service-role
  caller pointed at the wrong id.
- Operational-integrity (new class, certification-specific) — REG-228 closes
  the traceability gap the ops Environment Readiness Assessment found (the
  one existing staging E2E seed does not set `is_demo` at all and is
  indistinguishable from a real student); REG-229 closes the corresponding
  teardown gap (no single-operation way to remove a school-scoped tenant with
  seeded students/teachers attached — contradicted by the super-admin
  institutions route's own now-corrected code comment).

### Known gap, explicitly not closed by this wave

REG-229's live-DB execution is deferred to Stage 2 of the certification plan
— see the "STAGE-2 COVERAGE NOTE" inside
`src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` for the
precise scope of what is proven (the migration is structurally sound and the
regression test is written and ready) vs. what remains outstanding (an actual
`RUN_INTEGRATION_TESTS=1` run against live staging, and a full seed
(`scripts/seed-certification-accounts.ts`) → certify → teardown cycle with
the runbook's mandatory post-teardown leak check). Environment Readiness
criterion 5 ("test data can be cleaned up") should be recorded as PARTIALLY
resolved until that Stage-2 run happens, not fully resolved.

### Catalog total

Pre-REG-227: 193 entries (through REG-226, quiz-RPC ownership check).
Today's Environment Readiness remediation wave adds REG-227 (Sentry
environment-tag resolution), REG-228 (certification-account seeding
idempotent shape), and REG-229 (certification-tenant teardown — regression
test written and self-skipping cleanly this session pending Stage-2 live-DB
execution).
**Total catalog: 196 entries (target: 35 — TARGET EXCEEDED).**

---

## Premium-UI Phase 1 — design-system token contract (2026-07-04)

Source: commit `e8b3c032` (`feat(design-system): unified token foundation —
radius/spacing/semantic fixes, AA contrast, P7 Devanagari`) on branch
`feat/premium-ui-ux-rebuild`. Phase 1 introduced a runtime CSS-var token layer
that `tailwind.config.js` maps utilities onto (`rounded-* → var(--radius-*)`,
`bg-secondary/text-xp/bg-streak/bg-level-up/bg-danger-light → var(--secondary)`
etc., `shadow-* → var(--shadow-*)`, `p-sp-* → var(--space-*)`, `brand.orange →
var(--orange)`), darkened `--text-3` to `#6B6053` and added the AA-safe CTA
gradient stops `--btn-primary-from/to` (`#CB4710`/`#C2440F`), a 12px
arbitrary-type floor, and Devanagari font fallbacks (P7).

**Why.** The token layer is a silent-failure trap. Before Phase 1 the
`--radius-*` and `--space-*` tokens were REFERENCED by `tailwind.config.js` but
never DEFINED, so `rounded-xl` (used ~670×) and friends computed to the
undefined-token fallback (`border-radius: 0`) — ~1,916 elements rendered
square app-wide with zero build/type/lint error and zero unit-test failure.
The same class of bug hid `bg-secondary` / `text-xp` / `shadow-md` as no-ops.
This is invisible to the JSDOM unit layer (it does not evaluate CSS custom-
property resolution or the cascade), so the ONLY place it can be pinned is a
real browser computing styles. A future edit that drops a token from `:root`,
regresses `--text-3`/CTA contrast below WCAG AA, unpoints `brand.orange`, or
lets sub-12px arbitrary type through would re-introduce a silent, app-wide
visual/accessibility regression — exactly what DD-01's harness guards.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-237 | `design-system token contract resolves — no silent no-op utilities; AA on text-3 + primary CTA` (Playwright computed-style probe) | Device-independent computed-style probing on the public no-auth surfaces `/` (→ welcome), `/pricing`, `/login` at mobile **375px** and desktop **1280px**: (a) **no silent no-op utilities** — every `tailwind.config.js`-referenced CSS var resolves on the DEFAULT (non-cosmic) `:root`: all 23 color tokens (`--orange`, `--primary{,-light,-hover}`, `--secondary`, `--success/--warning/--info/--danger/--danger-light`, `--surface-1..3`, `--text-1..3`, `--xp-color`, `--streak-color`, `--mastery-low/mid/high`, `--level-up`) resolve to a real (non-transparent) color; all 5 `--radius-sm..2xl` resolve to a NON-ZERO radius (the ~1,916-corner square→rounded flip); all 4 `--shadow-sm/md/lg/glow` ≠ `none`; all 9 `--space-1..16` resolve to non-zero padding — each probed by applying `var(--token)` to a real element and reading the fully-resolved computed value (catches both undefined AND resolves-to-nothing var() chains). (b) **end-to-end tailwind wiring** — a real `.rounded-xl` element computes `border-radius: 12px` (not `0`), proving the utility→var mapping, not just the raw var. (c) **AA contrast (≥4.5:1)** computed in-page via sRGB relative luminance: `--text-3` (#6B6053) on `--surface-3` (#EDE6DC); `--btn-primary-from` (#CB4710) on white; `--btn-primary-to` (#C2440F) on white. (d) **brand.orange maps to `var(--orange)`** → resolves to burnt-orange `rgb(232, 88, 28)`. (e) **type floor** — a `.text-[9px]` element computes `font-size: 12px` (sub-12px arbitrary type floors up). (f) **no horizontal overflow** — `documentElement.scrollWidth ≤ clientWidth` (+1px sub-pixel tolerance) at both widths. Pin type is a Playwright computed-style probe BY NECESSITY: the JSDOM unit layer cannot evaluate CSS-var resolution/cascade, so this contract is unpinnable at the unit tier. Full-page screenshots are captured as artifacts (`test-results/visual/`) but are NOT the gate — the assertions are deterministic/device-independent. Authed student surfaces (`/dashboard`, `/quiz`, `/foxy` — the radius flip's highest blast radius) are covered best-effort in an OPT-IN (`VISUAL_AUTHED=1`), non-gating describe via a mocked session; real content QA there needs a seeded student session (documented manual steps). | `e2e/visual-regression/design-system-tokens.spec.ts` (npm script `test:e2e:visual` runs the public-surface gate) | E | P7 (Devanagari fallback stack), UX/a11y (WCAG AA) |

### Invariants covered by this section

- P7 (bilingual UI) — the token layer carries the Devanagari font-fallback
  stacks Phase 1 appended to every family; the harness pins that the token
  contract those stacks ride on resolves rather than falling back to nothing.
- UX / accessibility (WCAG AA) — `--text-3`-on-`--surface-3` and both primary-
  CTA gradient stops on white are pinned ≥4.5:1; the 12px type floor keeps
  micro-labels legible on budget phones in harsh sunlight (the stated design
  rationale). Not a numbered P-invariant, but a release-gating UX contract.

### Catalog total

Pre-REG-237: 203 entries (through REG-236, Knowledge Intelligence Wave 1).
Premium-UI Phase 1 adds REG-237 (design-system token contract — every
tailwind-referenced CSS var resolves on the default `:root` so no
`rounded-*`/`bg-secondary`/`text-xp` computes to the undefined-token fallback;
`--text-3` + both CTA stops clear WCAG AA; `brand.orange → var(--orange)`;
sub-12px arbitrary type floors to 12px — Playwright computed-style probe,
unpinnable at the JSDOM unit tier).
**Total catalog: 204 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-238 — DD-16: no dead opacity-on-var utilities (semantic-token alpha guard)

Premium-UI Phase 13 tail cleanup. The recurring DD-16 bug is a "dead
opacity-on-var" Tailwind class: because every semantic colour token in
`tailwind.config.js` is a full `var(--…)` VALUE (`primary: 'var(--primary)'`,
`success: 'var(--success)'`, `surface-1: 'var(--surface-1)'`,
`foreground: 'var(--text-1)'`, the `on-*` pairs, …), Tailwind's `/NN` opacity
modifier cannot inject an alpha channel — it can only decompose palette
hex/rgb or the `white`/`black`/`transparent`/`current` keywords. So
`bg-primary/10`, `text-foreground/80`, `border-success/30` etc. emit no usable
alpha and silently render the wrong opacity. They type-check and lint clean,
which is exactly why they kept reappearing (found in `StatusBadge`,
`DataTable`, `DashboardSidebar`, `UserDrawer`, parent `attendance`/
`notifications`). The sanctioned fix is `color-mix`:
`bg-primary/10 → bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-238 | `no dead opacity-on-var utilities across src/app + src/components` (fs-walk regex guard) | A single synchronous fs walk over every `.tsx` under `src/app` + `src/components` FAILS if any `(bg\|text\|border\|ring\|from\|to\|via\|divide\|outline\|fill\|stroke\|caret\|decoration\|accent)-<var-token>/NN` class appears, where `<var-token>` is one of the `var()`-valued semantic families (`surface-[0-9]/inverse/sunken/accent`, `primary{,-light,-hover}`, `secondary`, `success`, `warning`, `danger{,-light}`, `info`, `foreground`, `muted-foreground`, `on-*`). Palette colours (`white`/`black`/`transparent`/`current`, `orange-500`, …) DO support `/NN` and are intentionally allowed; `bg-[color-mix(…)]` arbitrary values and bare tokens without a modifier pass. Failure message points at `file:line → "matched class"` and prescribes the `color-mix` fix. Includes a regex self-check block: asserts the pattern flags 8 known-bad strings (`bg-primary/10`, `bg-surface-1/25`, `text-on-accent/50`, …) and does NOT flag 11 allowed strings (`bg-white/5`, `bg-orange-500/20`, the `color-mix` fix form, bare tokens). Also guards against a broken walk silently passing (`files.length > 50`). Fast, deterministic, no network. Lands with the Phase 13 cleanup that eliminated all 27 pre-existing dead classes. | `src/__tests__/design-system/no-dead-opacity-on-var.test.ts` | U | P7-adjacent (token layer), UX/a11y (correct opacity rendering) |

### Catalog total

Pre-REG-238: 205 entries (through REG-239, grounded-answer cache-key caller-collision fix).
Premium-UI Phase 13 adds REG-238 (dead opacity-on-var guard — the unit-tier
complement to REG-237's browser token-contract probe: REG-237 proves the tokens
RESOLVE; REG-238 proves no utility silently drops their alpha).
**Total catalog: 206 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-259 — PWA stale-service-worker retirement: /sw.js no-fetch tombstone, mobile view integrity, sw_legacy_cleanup counts-only telemetry (2026-07-16)

Source: PWA stale-service-worker incident (reported 2026-07-16; root cause =
legacy v3 service worker on devices that installed the PWA before 2026-07-11
— cache-first assets with no expiry + a pre-cached `/` shell served a stale,
broken, "desktop-looking" view inside the installed app indefinitely).
Containment shipped in commit `6ad1c8ff` (2026-07-11): a no-fetch retirement
tombstone at `apps/host/public/sw.js` plus the `ServiceWorkerCleanup` client
mount in `packages/lib/src/RegisterSW.tsx` (unregister owned `/sw.js`
registrations, delete `alfanumrik-*` caches, bounded one-time reload via the
`alfanumrik-sw-retirement-reloaded-v1` sessionStorage guard). Follow-up on
branch `fix/pwa-sw-retirement-followups`: `reportLegacyServiceWorkerCleanup`
fleet-recovery telemetry (ONE PostHog `sw_legacy_cleanup` event, six numeric
counts only) + the ops runbook
`docs/runbooks/pwa-stale-service-worker-recovery.md`.

**Why this is a regression pin.** (1) Any `fetch` handler ever returning to
`/sw.js` would re-capture legacy clients into cache-first serving and reopen
the incident — the path and the `alfanumrik-` cache prefix are permanently
reserved by the retirement machinery (runbook §7). (2) The cleanup must never
call `registration.update()` handoff-style, must touch ONLY owned `/sw.js`
same-origin registrations and `alfanumrik-*` caches, and its reload guard
must stay loop-bounded — an unbounded reload would brick affected devices
instead of healing them. (3) The PostHog decay curve (runbook §5-6) is the
ONLY fleet-wide signal that legacy devices are healing and drives the
escalation criteria, so the emit-gate (fire only when
`registrationsFound > 0 || cachesRemoved > 0 || failures > 0`; all-zero
healthy clients emit NOTHING — zero event volume at fleet scale) and the
counts-only payload (P13: exactly six numeric keys, no user id / email / URL
/ UA) are load-bearing; the reporter is try/catch-wrapped and must never
throw into the shared-layout cleanup flow (P15). (4) `display: standalone` +
`orientation: portrait` in `public/manifest.json` and the root layout's
`viewport` export (`device-width`, `initialScale: 1`) are the static inputs
that decide whether the installed PWA renders phone-correct — losing the
viewport export reproduces the incident's "desktop-looking page on mobile"
symptom with no service worker involved.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-259a | `sw_js_no_fetch_retirement_tombstone` | `apps/host/public/sw.js` registers ONLY `install` + `activate` handlers — `fetch` handler count is asserted zero via vm-sandbox execution of the deployed source; install `skipWaiting`s; activate deletes exactly the `alfanumrik-*` caches, `clients.claim()`s, and self-`unregister()`s; claim + unregister still run when CacheStorage throws. Client side: `cleanupLegacyServiceWorker` never calls `register()`/`update()`, unregisters ONLY same-origin `/sw.js` registrations (unrelated workers + other origins untouched), deletes ONLY `alfanumrik-*` caches, and the two-state sessionStorage reload guard (`fallback` → `removed`) permits at most one fallback + one confirmed-removal reload — persistent unregister failures can NEVER loop; the all-clean path clears a stale guard and does not reload; a controller-only tab (registration already removed by another tab) reloads once. | `apps/host/src/__tests__/service-worker-containment.test.ts` (7 tests, pre-existing — promoted to the catalog by this entry) | E | P15 / operational integrity (shared-layout mount on the signup funnel), incident non-recurrence |
| REG-259b | `sw_legacy_cleanup_telemetry_emit_gate_and_counts_only_payload` | `reportLegacyServiceWorkerCleanup`: all-zero result → capture NOT called (healthy-fleet zero-volume gate); a result with only non-gate counters (unregisterAttempts/registrationsRemoved/reloadsTriggered) → NOT called (gate is EXACTLY found/caches/failures); `registrationsFound > 0` → called exactly once with event name `sw_legacy_cleanup` and a payload whose key set equals EXACTLY the six numeric counts `{registrationsFound, unregisterAttempts, registrationsRemoved, cachesRemoved, reloadsTriggered, failures}` — sorted-keys equality proves no extra key (no user id/email/URL/UA) can ride along (P13); every value `typeof number`; `cachesRemoved > 0` alone → emits; `failures > 0` alone → emits (runbook §6 escalation signal never silent); a throwing capture fn → reporter does NOT throw (P15 — telemetry can never break the cleanup/reload flow). | `apps/host/src/__tests__/service-worker-containment.test.ts` (6 tests, `sw_legacy_cleanup telemetry reporter (REG-259)` block) | E | P13 (counts-only payload), P15 (never-throw), operational integrity (fleet-recovery decay curve) |
| REG-259c | `pwa_manifest_and_root_viewport_view_integrity` | `apps/host/public/manifest.json` keeps `display: "standalone"`, `orientation: "portrait"`, and root `start_url`/`scope`; the root layout (`apps/host/src/app/layout.tsx`, static-source scan — importing it would drag globals.css/KaTeX/the full provider tree into a unit test) keeps `export const viewport: Viewport` with `width: 'device-width'` + `initialScale: 1` and `manifest: '/manifest.json'` in metadata. | `apps/host/src/__tests__/pwa-view-integrity.test.ts` (5 tests) | E | Mobile view integrity (P10-adjacent — Indian 4G phone-first), incident-symptom guard |
| REG-259d | `tenant_dynamic_manifest_view_integrity` | Production rewrites `/manifest.json` to the DYNAMIC route `apps/host/src/app/api/school-config/manifest/route.ts` (proxy rewrite in `apps/host/src/proxy.ts`), so REG-259c's static-file pin is not what installed clients fetch. Real GET handler invoked directly (no mocks — tenant config arrives purely via proxy-injected `x-school-*` request headers): on BOTH the default (B2C) branch AND the white-label school-tenant branch (separately-built manifest objects) → `display === 'standalone'`, `orientation === 'portrait'`, `start_url`/`scope` === `'/'`, icons array non-empty with non-empty srcs, `Content-Type: application/manifest+json`. Branch-proving assertions pin default Alfanumrik branding + standard `/icon-*.svg` icons vs tenant branding (name/short_name/theme_color/logo icons) so the shared pins cannot pass on the same branch twice; a tenant slug WITHOUT a logo still yields non-empty default icons (never an icon-less manifest). | `apps/host/src/__tests__/api/school-config/manifest-route.test.ts` (11 tests) | E | Mobile view integrity for white-label tenants (P10-adjacent), incident-symptom guard, installability |

### Invariants covered by this section

- Incident non-recurrence — `/sw.js` is a permanent no-fetch tombstone; any
  future service-worker/offline strategy must NOT reuse the `/sw.js` path or
  the `alfanumrik-` cache prefix (architect review required; runbook §7).
- P13 (data privacy) — the `sw_legacy_cleanup` payload is pinned to exactly
  six numeric counts by sorted-key equality; no identity, URL, or UA
  enrichment can be added without failing the pin.
- P15 (onboarding integrity) — `ServiceWorkerCleanup` mounts in the shared
  layout that wraps auth/onboarding; both the cleanup (bounded reload, never
  rejects) and the reporter (try/catch, throwing capture swallowed) are
  pinned unable to break that funnel.
- Mobile view integrity — manifest standalone/portrait + root viewport
  export guard the "installed PWA looks like a desktop page" symptom class
  independently of any service worker. REG-259d extends the pin to the
  DYNAMIC tenant manifest route that production actually serves for
  `/manifest.json` (default AND white-label school branches), which the
  static-file pin (REG-259c) cannot see.
- Runbook cross-link — `docs/runbooks/pwa-stale-service-worker-recovery.md`
  §5-7 (fleet monitoring query, escalation criteria, prevention) depends on
  the exact event name, emit-gate, and tombstone pinned here.

---

## REG-261 — Curriculum-version source: per-scope monotonicity + delete-safety (insert / edit / soft-delete / hard-delete) and the never-500s version-poll route (2026-07-17)

Source: curriculum-version feature, steps 4-5. Migration + RPC
`supabase/migrations/20260717120000_curriculum_version_source.sql`
(`get_curriculum_versions(p_grade text, p_subject_codes text[] DEFAULT NULL)
RETURNS jsonb` → `{ as_of, scopes: { "<subject_code>-<grade>": <unix_epoch_int> } }`,
built over `curriculum_topics` + `rag_content_chunks`, guarded by the
`curriculum_version_watermark` delete high-water table). Route
`apps/host/src/app/api/v2/curriculum-version/route.ts`.

**Why this is a regression pin.** The mobile Learn cache treats
`server_version == stored_version` as "my cache is current — serve it with no
network and no chip". That equality is only a safe serve decision if the value
is **monotonic**: a version that ever moves BACKWARD lets a device hold NEW
content stamped HIGH, watch the server report LOW, and — once the stamps
collide again — serve retired syllabus as if it were current. Two paths have
already been shown to break it: (1) **soft delete** — `UPDATE curriculum_topics
SET is_active = false` (the internal-admin content route) did NOT set
`updated_at`, so with an `is_active = true`-filtered aggregation, retiring the
max-holder row moved `max(updated_at)` backward; closed by a BEFORE UPDATE
`updated_at` trigger **plus** an is_active-AGNOSTIC aggregation. (2) **hard
delete** — removing the max-holder genuinely lowers `max(updated_at)` and no
trigger on the survivors can prevent it; closed by an AFTER DELETE per-scope
watermark folded in via `GREATEST(ct_max, rag_max, watermark)`. Without it the
scope collapses to 0 and every device believes its cache is newer than the
server, forever. Monotonicity + delete-safety were made a REQUIRED condition of
architect approval, hence the live-DB pin. Separately, the route is the only
thing between a poll failure and the fleet: the client maps ANY non-parse to
`null` → "version unknown" → stale-within-TTL / refuse, so a 5xx here pushes
every device onto the offline path — the route must degrade to
`{ as_of, scopes: {} }` + 200 + `no-store` on every failure branch instead.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-261a | `curriculum_version_monotonicity_and_delete_safety` | **LIVE DB.** For an isolated synthetic scope, the version is NON-DECREASING across the full lifecycle. `curriculum_topics`: never-had-content reads 0 → INSERT moves it above 0 → EDIT is `>= vInsert` **and** `> vInsert` (BEFORE UPDATE `updated_at` trigger) → SOFT DELETE (`is_active=false`, the historically-broken path) is `>= vEdit` **and** `> vEdit` → HARD DELETE is `>= vSoft` **and** above 0 (watermark floors it; without the AFTER DELETE trigger this collapses to 0). `rag_content_chunks`: INSERT (with `is_active=false`, proving the aggregation is is_active-AGNOSTIC) → EDIT → HARD DELETE, same non-decrease chain, plus the `curriculum_version_watermark` row is asserted to materialise for the scope with `hw_epoch` above 0. Contract: out-of-range / absent / whitespace grade → empty scope map plus an `as_of`, never an error (P5); an explicitly-requested code with no content echoes 0; `p_subject_codes` omitted (SQL DEFAULT NULL) omits empty scopes entirely; `as_of` is ISO-8601 UTC. | `apps/host/src/__tests__/migrations/curriculum-version-monotonicity.test.ts` (5 tests) | E | P5, P8 (watermark table is service_role-only; only the SECURITY DEFINER RPC reads it), no-old-syllabus |
| REG-261b | `v2_curriculum_version_route_never_500s_and_passes_rpc_through_verbatim` | Auth (P9): `study_plan.view` + `requireStudentId: true`; 401 unauthenticated, 403 permission-denied returned as the RBAC `errorResponse` VERBATIM, authorized-but-no-userId fails closed — and a denied caller NEVER reaches the RPC. Happy path: the RPC jsonb is returned byte-for-byte inside the /v2 envelope (`toEqual`, key set exactly `['as_of','scopes']`), **no `schemaVersion` is injected** (frozen contract — the mobile parser reads `scopes` directly), `Cache-Control: private, max-age=30, stale-while-revalidate=60`, and the RPC is called EXACTLY once with `{ p_grade }` only so `p_subject_codes` takes the SQL DEFAULT (what keeps the poll under 1 KB). P5: grade reaches the RPC as a string, incl. coercing a drifted integer row. Never-500s: no studentId / absent student row / null grade / empty-string grade / RPC error / empty RPC result / RPC throws / `authorizeRequest` throws → ALL degrade to `{ as_of, scopes:{} }` + 200 + `no-store` (and the four grade-absent branches never call the RPC). An RPC-returned empty scope map is a SUCCESS and passes through with the OK cache header, not `no-store`. P13: `logger.error` fields are the exact key set `['error','route']` — never the studentId, the grade, or a PII-shaped key. | `apps/host/src/__tests__/api/v2/curriculum-version.test.ts` (23 tests) | E | P5, P9, P13 |

### Lanes

- REG-261a runs **only** in the CI `integration-tests` job (`npm run test:integration`,
  `RUN_INTEGRATION_TESTS=1`, live STAGING Supabase). It self-skips without real
  creds via `hasSupabaseIntegrationEnv()`, like every sibling under
  `__tests__/migrations/`. It cannot run in the unit lane — the invariant is
  produced by real triggers, a real transition-table statement trigger and a real
  SECURITY DEFINER aggregation, none of which exist in a mock.
- REG-261b runs in the CI unit step (`npm test` → vitest). Fully mocked.

### Fixture isolation (load-bearing — do not "tidy" away)

The live-DB fixture uses a dedicated synthetic subject (`cvz_version_test`,
seeded `is_active=false`) and a scope-per-test grade. The `curriculum_topics`
fixture leaves `chapter_number` NULL so it is EXCLUDED from
`curriculum-taxonomy-parity.test.ts` (which scans `chapter_number IS NOT NULL`)
and cannot masquerade as an old-syllabus orphan; the `rag_content_chunks`
fixture is `is_active=false` so it is EXCLUDED from
`rag-chunk-syllabus-orphans.test.ts` (which scans `is_active <> false`) — and
that flag doubles as the proof that the RPC aggregation really is
is_active-agnostic. Teardown order is content rows → the watermark rows their
AFTER DELETE triggers just wrote → the subject (FK parent).

### Invariants covered by this section

- P5 (grade format) — grades are strings "6".."12" through the RPC signature,
  the route's `String(...)` coercion, and the RPC's own P5 membership guard.
- P8 (RLS boundary) — `curriculum_version_watermark` carries RLS with a
  service_role-only policy in the same migration; clients only ever receive
  integer versions from the SECURITY DEFINER RPC.
- P9 (RBAC enforcement) — the auth boundary is the ONLY thing that may produce a
  non-200 on the poll route.
- P13 (data privacy) — the version poll logs an opaque event + message + route
  only; the RPC returns scope keys + epoch ints with no PII and no per-user rows.

## REG-262 — Mobile "no silent stale serve": the version-anchored serve/refetch/refuse decision core + atomic scope materialisation (2026-07-17)

Source: curriculum-version feature, step 5 (mobile). `_serveVersioned` in
`mobile/lib/data/repositories/learning_repository.dart` and `replaceScope` in
`mobile/lib/core/cache/cache_manager.dart`, anchored on the REG-261 contract.

**Why this is a regression pin.** Learn content may reach a student in exactly
two states, and the state must always be HONEST: `LearnServe.live` (fresh off
the wire, or a cache the server CONFIRMED is current) or `LearnServe.staleOffline`
(served while the version is UNKNOWN, inside the 7-day grace window, with an
"as of {date}" chip). Otherwise the app must REFUSE (`LearnOfflineException` —
genuinely offline with no servable cache; NOT merely a failed poll, see REG-263)
or surface the error (`LearnFetchException`). The forbidden outcome is serving
content the app has POSITIVE EVIDENCE is out of date with no chip and no error —
that is how retired syllabus reaches a student who then studies the wrong
chapter for an exam. The sharpest edge is **known-newer server + failed
refetch**: the app KNOWS its cache is stale (stored < server) and the network
then fails; falling back to the cache is tempting and is exactly the bug — it is
materially different from the offline case, where the app has no evidence either
way and the chip tells the truth. The second half is materialisation: the version
stamp is what the serve decision trusts, so `replaceScope` must never let an
entry carry the NEW version while holding OLD content. It writes the fresh entry
FIRST and only ever DELETES siblings (never re-stamps them), so any survivor of a
mid-batch kill still carries its OLD version and re-triggers its own refetch.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-262a | `serve_versioned_no_silent_stale_serve_matrix` | **server == stored** → cache served as `LearnServe.live`, `asOf` null, exactly one version poll, and NO fetch attempted — including when the cache is a YEAR old (version, not age, decides; the grace window is an offline-only concept and must not leak into this branch). **server > stored + refetch FAILS** (the sharpest edge, and the branch no sibling suite covers) → throws `LearnFetchException`, is NOT a `LearnOfflineException` (the device is online — routing to the Offline state would misreport why), does NOT return the known-stale cache, and does NOT purge it (purge is atomic with a SUCCESSFUL fetch; purging on failure strands an offline-bound device). **no cache + fetch FAILS** → `LearnFetchException`, not offline. **version UNKNOWN — the SHARED half**: within the grace window BOTH unknowns (`VersionOffline` and `VersionUnknownOnline`) serve `LearnServe.staleOffline` with `asOf` equal to the real `fetchedAt` — the exact value, which is what makes the stale serve honest. **The STALE_TTL boundary (±1 minute around exactly 7 days, i.e. the `<=` off-by-one)**: just inside → still chipped, for both unknowns; just past → the two DIVERGE, and that divergence is pinned here at the boundary with age held constant and connectivity the only variable — `VersionOffline` refuses with `LearnOfflineException`, `VersionUnknownOnline` attempts the fetch instead of refusing (the split; see REG-263). Flag guard: `ApiConstants.versionAnchoredLearnCache` defaults ON (else this file AND both sibling suites silently exercise `_blindTtl` and the invariant goes untested) and `learnCacheStaleTtl` is 7 days. | `mobile/test/data/repositories/learning_repository_serve_versioned_test.dart` (13 tests — 11 `test()` calls, two parametrised across both unknowns) | E | no-old-syllabus, offline honesty |
| REG-262b | `cache_manager_replace_scope_atomicity_no_masquerade` | `putContent`/`getContent` round-trip scope + version + `fetchedAt`, and the content surface applies NO TTL of its own (a year-old entry still reads back — freshness is the caller's policy, or a cold-start device would lose content it may serve within the grace window). Corrupt entries drop BOTH halves and read null. `replaceScope`: writes the fresh entry and purges every stale sibling in the scope; leaves other scopes untouched; **ORDER** — observed through Hive's box event stream, the first event is `put:<key>` and every subsequent event is a `del:` of a sibling, and it never deletes the entry it just wrote (a purge-first implementation can be killed leaving the scope with NO content); **KILL MID-BATCH** — reproducing the exact on-disk state between step 1 and step 2, every surviving sibling still carries the OLD version (never the new one), which is what forces its own refetch; **post-condition sweep** — after a full `replaceScope` the ONLY entry in the metadata box stamped with the new version is the one whose payload was actually rewritten. `purgeScope` removes payload + metadata for the scope, leaves other scopes, and sweeps un-attributable corrupt metadata. | `mobile/test/core/cache/cache_manager_test.dart` (14 tests) | E | no-old-syllabus, cache integrity |

### Lane

Both run in the CI `flutter test` job (`.github/workflows/mobile-ci.yml` — the
REG-90 mobile gate). Real temp-dir Hive; no Supabase, no network, no mock
package (mockito/mocktail are deliberately absent from `mobile/pubspec.yaml`).

### Scope of REG-262a after the 2026-07-17 reconciliation

Two fixes landed on this code after REG-262a was authored, each with its own
suite, and REG-262a was narrowed to what those suites do not cover. Coverage that
MOVED (deduped, not dropped):

- **Scope-key contract** — "the polled scope key is `<subject_code>-<grade>`"
  (byte-parity with the REG-261 server keying; drift → every scope reads absent →
  refetch storm) now lives in `learning_repository_scope_collision_test.dart`
  ("the two subjects poll their own scopes"), which asserts the exact polled-scope
  list across two scopes rather than one. That suite also owns the scope
  namespacing of the cache key itself and the `cached.scope == scope` guard —
  the fix for a silent cross-subject serve (`topic_3` collided between math-8 and
  science-8 because chapter numbers restart per scope, and equal versions across
  scopes is the NORMAL post-bulk-op state).
- **"UNKNOWN + no servable cache → refuse"** — REG-262a's original blanket claim
  is now FALSE as stated and is superseded by REG-263: only `VersionOffline`
  refuses. The offline half (including the load-bearing "and `fetchFresh` is
  never invoked") is owned by REG-263's suite; REG-262a keeps only the ±1-minute
  boundary statement of it, which REG-263 does not test at the boundary.

REG-262a's retained subject is the KNOWN-newer-server + FAILED-refetch branch,
"version not age decides", exact-`asOf` chip honesty, the STALE_TTL boundary, and
the two config guards that keep all three suites honest.

### Test seams (deliberate)

Fetch failure is induced with ZERO network by constructing the repository with
`v2Client: null` — `_fetchConceptV2` short-circuits to `LearnFetchException`
before touching any client. That seam is what lets every "refetch fails" branch
be driven through the PUBLIC `getConceptV2` api, and it is also why a SUCCEEDING
fetch is not expressible in REG-262a (see below). The version poll is stubbed by
subclassing `CurriculumVersionRepository` and overriding `versionForScope`, which
is the whole poll seam; it returns the sealed `VersionResult` — `VersionKnown(int)`
(the poll answered), `VersionOffline` (no network; the ONLY outcome permitted to
refuse), or `VersionUnknownOnline` (online, poll failed; must still fetch). The
`SupabaseClient` passed to the repository is a never-used stub required only
because the constructor initialiser is `client ?? Supabase.instance.client` and
`Supabase.instance` throws without a full app boot — no branch asserted here
touches `_client`. Cache entries are seeded straight into the Hive boxes when a
specific `fetchedAt` is needed, because `putContent` always stamps now and the
grace-window branch is precisely about age.

### Closed gap (why REG-262a is now `E`, not `P`)

REG-262a was `P` for one reason: the **successful** refetch+replace branch
(server > stored → fetch OK → atomic scope replace) was unreachable, because it
needs a network fake and no mock package is in `mobile/pubspec.yaml`. The entry
named its own remedy — "either a mock package added to the pubspec or a
`@visibleForTesting` fetch seam on `LearningRepository`". **That seam now exists**:
the poll-failure fix added `LearningRepository.serveVersionedForTest`, which
drives the decision core with an INJECTED `fetchFresh`. REG-263's suite uses it
to exercise the succeeding-fetch path directly (a `-1` entry re-validated against
a later successful poll refetches and re-stamps at the real server version — the
observable half of `replaceScope`). With the branch pinned there, REG-262b
covering its cache half and REG-261 its server half, every assertion REG-262a
still makes is covered by its own file, so it reads `E`.

REG-262a deliberately keeps the `v2Client: null` seam rather than migrating to
`serveVersionedForTest`: its subject is the branches that must NOT serve, and a
seam where every fetch throws is the sharper instrument for proving a refusal.

### Invariants covered by this section

- No-old-syllabus / offline honesty — a student is never served content the app
  knows is retired, and any stale serve is always chip-labelled with its real
  "as of" date.
- Cache integrity — the version stamp the serve decision trusts can never be
  attached to content it does not describe, under any interleaving including a
  mid-batch process kill.

## REG-263 — Mobile: a cache degrades to NO CACHE, never to NO CONTENT — poll-failed-online FETCHES, only offline REFUSES (2026-07-17)

Source: fix `98fa214a` on the version-anchored Learn cache. `versionForScope` in
`mobile/lib/data/repositories/curriculum_version_repository.dart` and the unknown
tail of `_serveVersioned` in
`mobile/lib/data/repositories/learning_repository.dart`.

**Why this is a regression pin.** `versionForScope` returned `null` for BOTH
"offline" AND "the poll failed", and `_serveVersioned` treated the two
identically, so a transient 500 / timeout / malformed body from the version
endpoint — on a FULLY ONLINE device with a working network and no cache — threw
`LearnOfflineException` and rendered "You're offline" on Learn. The student was
not offline; the content was one reachable HTTP call away. This is a bug INSIDE
the REG-262 invariant, not a policy change against it: `serverVersion` is never a
freshness gate, only a cache stamp — the known-version branch serves whatever
`fetchFresh()` returns and never validates it against `serverVersion`. The
version's only question is "can I skip the network?", so when the answer is
unknown the correct fail direction is DON'T SKIP THE NETWORK → fetch. Fetching
fresh cannot violate "no silent stale serve": you cannot serve stale content by
declining to serve the cache. Offline is the one unknown a fetch cannot fix, so
it alone still refuses — and it must NOT call `fetchFresh()`, which would
reintroduce the very Dio retry/backoff wait the connectivity short-circuit exists
to eliminate. The two unknowns are different FACTS and the caller acts on them
differently; the sealed `VersionResult` exists to stop them being collapsed again.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-263a | `version_result_two_unknowns_never_collapse` | `versionForScope` returns a three-way sealed `VersionResult`, never `int?`. A poll that ANSWERS → `VersionKnown` (an ABSENT scope is a KNOWN `0` = "never had content", NOT an unknown; every scope on a degraded empty-scopes body is likewise a known 0). An ONLINE poll failure → `VersionUnknownOnline`, NEVER `VersionOffline`, for every failure shape: `success:false` envelope, missing `data`, malformed/HTML body, throwing transport. Only the connectivity probe produces `VersionOffline`, and it short-circuits WITHOUT issuing a request (proving the offline fallback never waits on Dio retry/backoff). `parseScopesEnvelope` reads the REAL `/v2` envelope byte-for-byte (`body["data"]["scopes"]`, not `body["scopes"]` — REG-261b's frozen contract), tolerates a bare `{scopes}` body defensively, coerces numeric-string/double values, drops unparseable values rather than failing the whole poll, and returns null (never throws) on every malformed shape. Memoisation: a successful poll is reused for the session TTL (one request per session); a FAILED poll is NEVER memoised, so a transient blip self-heals on the next read; `invalidate()` forces a re-poll. | `mobile/test/data/repositories/curriculum_version_repository_test.dart` (22 tests) | E | offline honesty, REG-261b contract parity |
| REG-263b | `poll_failed_online_fetches_offline_refuses` | **THE SPLIT.** online + poll failed + NO servable cache → `fetchFresh()` IS invoked and the result is served as `LearnServe.live` with NO chip (it came off the wire this instant, so it is not stale) — never `LearnOfflineException`. The write is `putContent`, NOT `replaceScope` (purging a scope's siblings needs version evidence to justify, and a failed poll has none — a server blip must not be able to destroy a user's offline cache; a seeded sibling's payload AND metadata both survive), stamped `version: kVersionUnverified` and tagged with this scope. Expired cache (older than STALE_TTL) behaves as no cache → the fetch wins; cache INSIDE STALE_TTL still wins with the chip and zero fetches (the deliberately UNCHANGED half — the invariant blesses the chipped serve on poll-failure too). The fetch ALSO failing → `LearnFetchException` (Error state with a real message), never `LearnOfflineException` — asserted both through the decision core and END-TO-END through the PUBLIC `getConceptV2` with a REAL `CurriculumVersionRepository` whose transport throws while connectivity reports ONLINE (the one case expressible against the pre-fix code, and RED on it). **OFFLINE is unchanged**: no servable cache → `LearnOfflineException` AND `fetchFresh` is NEVER invoked (`calls == 0`), including with a cache older than STALE_TTL. **The `-1` stamp is self-limiting**: `kVersionUnverified < 0` (the whole safety rests on this — server scope values are unix-epoch seconds floored by `GREATEST(..., 0)`, so no server value is ever negative ⇒ `cached.version == serverVersion` can never match a `-1` entry); a `-1` entry never serves as version-confirmed live on a later successful poll — including against a server `0`, the LOWEST value the server can report — and re-validation REPLACES the `-1` with the real server version; yet a `-1` entry IS still served offline within STALE_TTL with the chip (the offline branch decides on age + key identity, not version equality — an unverified entry is still this scope's own real content), and likewise on a later failed poll within TTL. | `mobile/test/data/repositories/learning_repository_poll_failure_test.dart` (16 tests) | E | offline honesty, no-old-syllabus |

### Lane

Both run in the CI `flutter test` job (`.github/workflows/mobile-ci.yml` — the
REG-90 mobile gate). Real temp-dir Hive; no Supabase, no network, no mock package.

### Test seams (deliberate)

REG-263b drives the decision core through `LearningRepository.serveVersionedForTest`
with an INJECTED, CALL-COUNTING `fetchFresh`. This is the seam REG-262a's known
gap called for: it makes a SUCCEEDING fetch expressible (the `v2Client: null` seam
used by REG-262a can only ever prove a refusal, because every fetch throws by
construction) and makes "did it hit the network?" decidable — `calls == 0` is the
load-bearing assertion on the offline branch, and no assertion that the offline
path refuses is meaningful without it. The version poll is stubbed by subclassing
`CurriculumVersionRepository`; REG-263a instead injects `fetchBody` +
`connectivity` seams so the REAL parse and the REAL offline short-circuit run.

### Relationship to REG-262

REG-262a owns the branches that must NOT serve (known-newer server + failed
refetch) and the STALE_TTL boundary; REG-263 owns the unknown tail where the two
unknowns diverge. The one claim they share — "offline + no servable cache →
refuse" — is stated at the ±1-minute boundary in REG-262a and with the
`fetchFresh`-never-invoked proof here. REG-262a's original blanket "version
UNKNOWN + no servable cache → `LearnOfflineException`" was corrected on
2026-07-17: it is true only for `VersionOffline`.

### Invariants covered by this section

- Offline honesty — the app claims to be offline ONLY when it is. A failed poll
  is a lost optimisation (the network-skip), never a lost feature; the Offline
  state is never shown to a user with a working network.
- No-old-syllabus — the split cannot reintroduce a stale serve: the poll-failed
  path FETCHES (fresh by definition), and the `-1` stamp guarantees the next
  successful poll re-validates anything written without version evidence.

### Catalog total

Pre-REG-261: 233 entries. Merge note (2026-07-17): this curriculum-version
section (REG-261..REG-263) was integrated in the same merge as the
response-cache-v2 section (REG-264..REG-269) that appears just above it. The
shared base before both sections was 227 entries (through REG-260). Although
REG-261..263 are lower-numbered than REG-264..269, they carry a later date
(2026-07-17 vs 2026-07-16), so they append after the response-cache section and
the running total continues 227 → 233 → 236. No REG id from either side was
dropped or renumbered (the id ranges did not collide). Adds REG-261
(curriculum-version source — per-scope monotonicity across
insert/edit/soft-delete/hard-delete, watermark delete-safety, and the
never-500s verbatim-passthrough version-poll route), REG-262 (mobile
no-silent-stale-serve — the `_serveVersioned` serve/refetch/refuse matrix and
`replaceScope` write-new-first/no-masquerade atomicity) and REG-263 (mobile
cache degrades to no-cache never to no-content — the poll-failed-online vs
offline split and the `kVersionUnverified` re-validation stamp).
**Total catalog: 236 entries (target: 35 — TARGET EXCEEDED).**

---

## CI sharded-topology fan-in contract — required-check context preserved through fan-in + skip-cannot-satisfy enforcement + shard-config collection identity (2026-07-20, PR #1349) — REG-272

Source: PR #1349 (CI pipeline speed-up). The pre-shard single "Lint, Type-check
& Test" job was split into `quality` (lint + type-check + the blocking Auth &
Identity gate) plus a 4-way sharded `unit-tests` matrix, with the
`unit-tests-merge` fan-in job merging blob reports and enforcing coverage
thresholds once against the combined coverage. Companion to REG-130: like the
pipeline-alert watcher, this is a CI-only contract — there is no
Vitest/Playwright asserting test; the "test" is the workflow contract itself,
audited by reading `.github/workflows/ci.yml`. Logged as status `C`
(CI-enforced, no unit harness), same convention as REG-130.

**Why this is a regression pin.** All three failure modes below are SILENT and
GREEN: a renamed fan-in job, a skipped-but-satisfying required check, or a
diverged shard config each leave every visible CI signal passing while the
merge gate stops guarding what it claims to guard.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-272 | `ci_shard_fanin_context_skip_and_collection_contract` | Three invariants of the sharded CI topology. **(1) REQUIRED-CHECK CONTEXT BYTE-EQUALITY (job-name analog of REG-130's workflow-name invariant):** the `unit-tests-merge` job's display name stays byte-identical to the branch-protection required status-check context `Lint, Type-check & Test` (`name:` on the `unit-tests-merge` job, ci.yml ~1205-1206; the intent comment at ~1200-1204 pins that the fan-in DELIBERATELY carries the pre-shard job's name so the ruleset keeps green-gating merges with identical semantics). A silent rename means the required context never reports again — and the operational "fix" for the resulting wedge is removing the required check, at which point merges stop being gated on unit tests at all. **(2) SKIP-CANNOT-SATISFY:** every fan-in job carrying merge-blocking semantics — `unit-tests-merge` (ci.yml ~1208-1227) and `ci-gate` (ci.yml ~1794-1834) — keeps `if: always()` PLUS an explicit per-upstream re-assertion that each `needs[job].result === 'success'` (the node-script pattern). This pairing is load-bearing because GitHub treats a SKIPPED job's check as SATISFYING a required status check: without `if: always()`, an upstream failure cascades the fan-in to `skipped`, its required check is satisfied, and the gate fails OPEN on the exact commit that broke the build. Conversely `if: always()` WITHOUT the re-assertion would run-and-pass over failed upstreams — both halves must survive together. The `=== 'success'` comparison (not merely "not failure") also refuses `skipped`/`cancelled` upstreams; `ci-gate`'s fork-PR branch additionally pins that secrets-gated jobs (`integration-tests`, `e2e-critical-paths`) must be EXACTLY `skipped` on fork PRs — a fork PR cannot pass the gate with one of them silently failed. **(3) SHARD-CONFIG COLLECTION IDENTITY:** the CI-generated wrapper `vitest.ci-shard.config.mts` (heredoc at ci.yml ~1163-1176) imports the ROOT `./vitest.config` and its ONLY delta is `delete shardConfig.test.coverage.thresholds` — no `include`/`exclude`/collection override of any kind, so each shard collects from the identical file universe as the root config and `--shard=N/4` partitions ALL of it. If the wrapper ever grew its own collection scope, test files would silently drop out of CI while every job stays green. The thresholds-only strip exists because Vitest 4.1.8 enforces coverage thresholds on EVERY coverage-reporting run including partial shards (where per-file/global floors fail spuriously); the REAL root config — thresholds included — is enforced exactly once in `unit-tests-merge` via `--merge-reports --coverage` against the combined coverage of all 4 shards (ci.yml ~1253-1260), preserving the pre-shard blocking posture. | `.github/workflows/ci.yml` (`unit-tests-merge` name + fan-in step; `ci-gate` step; `Generate threshold-free shard config` + `Merge shard reports and enforce coverage thresholds` steps). CI-only; no unit harness. | C |

### Invariants covered by this section

- P14-adjacent / operational integrity (same family as REG-118 and REG-130) —
  the merge gate must actually gate: the required context keeps reporting from
  the job that carries the semantics (1), a cascaded skip can never satisfy it
  (2), and the sharded run executes the same test collection the root config
  declares (3).
- Fail-open prevention — invariants (1) and (2) both close paths where the
  pipeline goes green/silent while unit tests stop blocking merges; (3) closes
  the path where tests stop RUNNING while coverage still reports.

### Catalog total

Pre-REG-272: 238 entries (through the B2C funnel completion, REG-271).
The CI sharded-topology fan-in contract adds REG-272: required-check context
byte-equality on `unit-tests-merge`, `if: always()` + explicit per-upstream
success re-assertion on both merge-blocking fan-ins, and thresholds-only
collection identity for the CI-generated shard wrapper config.
**Total catalog: 239 entries (target: 35 — TARGET EXCEEDED).**

---

## E2E full-suite topology — label-gated advisory PR run + watched blocking nightly (2026-07-20) — REG-284

Source: CI pipeline audit/speed-up (branch `e2e-nightly-label-optin`,
user-approved "label opt-in + nightly safety net"). The full ~342-test/38-file
Playwright suite left default PR runs: it is now PR opt-in via the `e2e-full`
label and runs nightly against main as the ONLY scheduled full-suite execution.
Like REG-130, this is a CI-topology contract with no Vitest/Playwright asserting
test — the "test" is the workflow wiring itself, audited by reading the four
files. Logged as status `C`. REG-130 itself needed NO text amendment: its
watched-name byte-equality / dedupe / self-heal invariants are stated
name-agnostically and now simply cover one more watched entry (byte-verified
2026-07-20: `od -c` shows the em dash U+2014 identical in both files).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-284 | `e2e_full_suite_label_optin_plus_watched_nightly` | The full-suite E2E topology stays fail-CLOSED after leaving default PR CI. (1) SINGLE SOURCE OF TRUTH: both callers (ci.yml label-gated `e2e` job, e2e-nightly.yml) invoke the reusable `e2e-suite.yml` — the exact playwright invocation (`npx playwright test --project=chromium`), staging build + standalone-server boot, env set (BASE_URL, staging NEXT_PUBLIC_*/service-role, TEST_STUDENT_*, `SYNTHETIC_TARGET_URL=http://127.0.0.1:3000` so neither caller hammers live prod), report-artifact upload and server-log dump are never duplicated/drifted between callers. (2) WATCHED NIGHTLY: e2e-nightly.yml runs on `schedule` (21:30 UTC) + `workflow_dispatch`, calls the suite with `advisory: false` so a red suite concludes `failure`, and its `name:` ("E2E Nightly — Alfanumrik") appears BYTE-IDENTICAL in pipeline-alert.yml's `on.workflow_run.workflows` list (extends REG-130's byte-equality invariant — renaming either side without the other fails OPEN). The nightly is NEVER dropped from the schedule while the PR run stays label-gated. (3) SKIP SEMANTICS (testing-agent ruling 2026-07-20): `E2E_SKIP_ON_UNPROVISIONED_STUDENT` is set ONLY in advisory mode (`${{ inputs.advisory && '1' \|\| '' }}`) — an unprovisioned staging TEST_STUDENT_* fixture skips-with-named-reason on labeled PRs but REDDENS the nightly, matching the suite's red-in-both-modes posture for missing secrets; a green-with-skips nightly must never silently drop the real-auth branches. The BLOCKING e2e-critical-paths job in ci.yml never sets the flag. (4) MERGE-GATE SAFETY: the label-gated `e2e` job stays advisory (`advisory: true`) and stays OUT of ci-gate's `needs` (a usually-skipped need would poison the required-check accounting), and ci.yml's `pull_request.types` explicitly retains `[opened, synchronize, reopened]` alongside `labeled` (specifying `types` REPLACES the defaults — dropping them would stop CI on ordinary pushes). | `.github/workflows/e2e-suite.yml`, `.github/workflows/e2e-nightly.yml`, `.github/workflows/ci.yml` (`e2e` job + `pull_request.types` + ci-gate needs), `.github/workflows/pipeline-alert.yml` (watched list + HINT), `e2e/helpers/auth.ts` (skip gate) (CI-only; no unit harness) | C |

### Catalog total

Pre-REG-284: 250 entries (current highest/latest on main: REG-281..REG-283,
the 2026-07-20 feature-flag RCA repair in `10-rbac-rls.md`; REG-277..REG-280
are held by the Foxy ramp package in `02-foxy-ai.md`). This topology pin adds
REG-284.
**Total catalog: 251 entries (target: 35 — TARGET EXCEEDED).**

---

## /api/learner/revise-stack dead-flag-gate — unconditional 404 in production (2026-07-21) — REG-303

Source: live production bug discovered during Master Action Plan Phase 6
mobile-parity work. `GET /api/learner/revise-stack` (backs the /refresh page's
"Chapter Refresh" section on web AND the new mobile Refresh screen) gated on
`isFeatureEnabled('ff_revise_route_v1')`. Migration
`20260603120000_remove_ff_revise_route_v1.sql` DELETED that flag row as part
of Study Menu v2 Task 6.4, once the standalone `/revise` page was folded into
`/refresh`'s Section B ("Backend: Unchanged. The route stays at
`/api/learner/revise-stack`." — 2026-05-20 consolidation spec). The migration
and its plan correctly removed the OLD `/revise` page and its nav-visibility
flag check, but never removed this route's OWN internal
`isFeatureEnabled()` gate. `isFeatureEnabled()` returns `false` for any
nonexistent flag row (by design — "Flag doesn't exist → disabled"), so once
the row was dropped this endpoint 404'd UNCONDITIONALLY for every student.
Both consumers swallow the 404 into a silent empty state
(`ChapterRefreshSection.tsx`: `if (res.status === 404) setItems([])`, which
then renders `null`) — no Sentry error, no visible failure, the section just
quietly stopped appearing. This is the same failure class as an orphaned
flag reference, but inverted: instead of a route checking a flag nobody
seeded, a route kept checking a flag that used to exist and was
deliberately deleted, with no code-side cleanup pass to match.

Fix: removed the dead `isFeatureEnabled('ff_revise_route_v1')` gate from the
route entirely — matching the "became a permanent default" pattern already
used for `ff_study_menu_v2` — rather than re-seeding the deleted flag, which
would only recreate the identical "flag lifecycle drifts from route code"
fragility for the next person who deletes it.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-303 | `revise_stack_route_never_gates_on_deleted_flag` | `GET /api/learner/revise-stack` returns real decayed-chapter data (200, `schemaVersion: 1`, populated `items[]`) for an eligible student even when `isFeatureEnabled` is mocked to resolve `false` for every flag name — byte-for-byte the production state after the `ff_revise_route_v1` row was deleted. A dedicated assertion additionally proves `isFeatureEnabled` is never called at all by this route (the fix deletes the dependency, it does not hardcode it to `true`), so a future refactor can't silently reintroduce a flag check without a test failing. Companion assertions pin the surviving 401 (unauthenticated) and 404 `no_decayed_topics` (genuinely nothing to revise) branches so this test can't be satisfied by a route that just always returns 200. | `apps/host/src/__tests__/api/learner/revise-stack/route.test.ts` (4 tests) | E (unit — runs in CI) |

### Invariants covered by this section

- P1-adjacent (Chapter Refresh is part of the spaced-repetition retention
  system; an unconditional 404 silently removed a whole surface of the
  product from every student, indistinguishable from "no student ever has
  decayed chapters")
- Operational integrity / flag-lifecycle hygiene (same family as REG-125's
  seed-shape conformance and REG-118's daily-cron static-source contract):
  when a feature flag is deleted, every code path that reads it must be
  swept in the SAME change, not left to silently fail closed

### Notes on test strategy

This is a "prove the dependency is gone" test, not just a "prove the
behavior is correct" test — `isFeatureEnabled` is mocked to always return
`false` specifically so a regression (someone re-adding a flag check without
first confirming the flag is seeded) would immediately turn this test red
via the 200-response assertions, and the `not.toHaveBeenCalled()` assertion
catches the case where a future change reads a *different* still-existing
flag on this route without a corresponding rollout plan.

### Catalog total

Pre-REG-303: 251 entries (through REG-284, the 2026-07-20 E2E full-suite
topology pin). This dead-flag-gate fix adds REG-303 (next free id after
REG-302, the 2026-07-22 Master Action Plan Phase 4 Foxy explorer + Monthly
Synthesis entry in `02-foxy-ai.md`).
**Total catalog: 252 entries (target: 35 — TARGET EXCEEDED).**

---

