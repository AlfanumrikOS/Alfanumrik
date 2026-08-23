## Foxy Moat Plan — Phases 0-3 (2026-04-26)

Source: Foxy moat plan Phases 0-3 — NCERT-link removal, Voyage rerank,
RRF retrieval, pedagogy prompt rewrite with coachMode, /api/foxy/remediation
endpoint, misconception ontology schema.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-36 | `foxy_api_no_sources_or_diagrams` | `/api/foxy` POST/GET responses (grounded path, hard-abstain, legacy intent-router fallback, history) never expose `sources` or `diagrams` fields. Closes the moat-leak vector where competitors could scrape NCERT chapter URLs from prod traffic. | `src/__tests__/foxy-api-no-sources.test.ts` | E |
| REG-37 | `foxy_voyage_rerank_fallback` | When `VOYAGE_API_KEY` is unset, fetch throws, returns non-2xx, or returns malformed JSON, the rerank step is bypassed and similarity-ranked top-N is returned. Voyage rerank is a single-point-of-failure on top of RRF — student traffic must continue to flow on outage. | `src/__tests__/foxy-rerank-fallback.test.ts` (parity) + `supabase/functions/grounded-answer/__tests__/` (Deno) | E |
| REG-38 | `foxy_coach_mode_default_is_mastery_driven` | `resolveCoachMode(requested, mastery)` picks 'socratic' for mastery < 0.6, 'answer' for ≥ 0.6 when no explicit mode is requested. Explicit valid mode (`socratic` / `answer` / `review`) wins. Invalid mode falls back to mastery default. NaN/Infinity/out-of-range mastery clamps safely. | `src/__tests__/foxy-coach-mode.test.ts` | E |
| REG-39 | `foxy_remediation_cache_prevents_duplicate_anthropic_calls` | `/api/foxy/remediation`: cache hit on `wrong_answer_remediations(question_id, distractor_index)` returns cached text without invoking Anthropic. Cache miss calls Anthropic exactly once and persists. `distractor_index` outside 0..3 → 400 (P6). `ai_usage_global=false` → 503, no Anthropic call. | `src/__tests__/foxy-remediation-cache.test.ts` | E |
| REG-40 | `/api/foxy/remediation oracle shape uniform — P3 anti-cheat defense-in-depth` | Every non-eligible request to `/api/foxy/remediation` (distractor==correct, never attempted, different distractor than submitted, answered correctly, attestation DB error) returns BYTE-IDENTICAL `403 { success:false, error:'remediation_unavailable' }`. Cache table, question table, and Anthropic are NEVER touched on the failure path so timing and DB-load patterns cannot leak which branch failed. | `src/__tests__/foxy-remediation-oracle-shape.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — kill switch enforced before generation; cache prevents
  unbounded Anthropic spend)
- P6 (question quality — distractor index validated as 0..3 only)
- P10 (bundle/cost budget — rerank fallback keeps the worker hot path
  deterministic when Voyage degrades)
- Moat protection — sources/diagrams stripped from the student-facing
  envelope on every code path

### Notes on test strategy

Three of the four files are **contract/parity tests** following the same
pattern as `foxy-plan-normalization.test.ts` and `foxy-grounded-gate.test.ts`:
they replicate the function logic locally and assert on the contract. This
is deliberate — `/api/foxy/remediation` (Phase 3) and the rerank logic
(Deno-side) cannot be mounted in Vitest without re-mocking 6+ modules
that already have integration coverage at the E2E layer. If the
implementation in `src/app/api/foxy/route.ts`,
`src/app/api/foxy/remediation/route.ts`, or
`supabase/functions/grounded-answer/` diverges from the parity copy
in these tests, quality review must reject and the parity copy must be
re-synced.

## Foxy Phase 2 — Skill State + Misconception Context Wiring (2026-04-28)

Source: Foxy moat plan Phase 2 — wires per-LO BKT mastery (`student_skill_state` join `learning_objectives`) and curated misconception ontology (`quiz_responses` join `question_misconceptions`) into the Foxy pedagogy decision tree. Pre-Phase 2 the MISCONCEPTION_REPAIR pedagogy branch had no real signal because `cme_error_log` only stored generic `error_type` strings.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-41 | `foxy_skill_state_and_misconception_context_wired` | `loadCognitiveContext()` populates `loSkills` from `student_skill_state` join `learning_objectives` (top-10 weakest by `p_know` ASC) and `recentMisconceptions` from `quiz_responses` join `question_misconceptions` (top-3 by count, distractor_index match, 30-day window); `buildLoSkillsSubsection` and `buildMisconceptionPromptSection` emit empty string on no-data and template substitutes cleanly into `{{misconception_section}}`. P12 dosage caps: LO subsection caps at 10 lines, misconception subsection caps at 3 entries, remediation text truncates to ≤ 400 chars. P13: formatter signature contains no PII identifiers (studentId/email/phone). | `src/__tests__/foxy-skill-state-misconception-context.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — dosage caps prevent prompt-injection / token-spend
  blowup; LO and misconception sections bounded; remediation truncated)
- P13 (data privacy — formatter signature pinned to misconception data
  only; no studentId / email / phone reach the prompt or logs)

## Foxy Phase 2.B — RAG Strengthening (2026-04-28)

Source: Foxy moat plan Phase 2.B — diversification and prompt-injection
hardening of the NCERT-grounded RAG pipeline. Adds MMR diversification
between Voyage rerank and prompt assembly, and sanitization of every
chunk's content before it is injected into Claude's system prompt.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-42 | `foxy_mmr_diversity_contract` | `applyMMR(chunks, lambda)` preserves the original top-1 unconditionally (slot-1 is taken before any redundancy comparison runs), never drops chunks (output length === input length, no duplicate ids), is deterministic across repeat calls and idempotent (`applyMMR(applyMMR(x)) === applyMMR(x)`), breaks ties by original input order (stable), and at default λ=0.7 demotes near-duplicates behind diverse near-tied chunks (so the prompt-token budget is not burned on redundant NCERT paragraphs). Lambda extremes: λ=1.0 preserves original ranking; λ=0.0 picks the most-different chunk in slot 2. Defensive shape: empty input → `[]`, non-array input → `[]`, no input mutation. | `src/__tests__/rag/mmr-diversity.test.ts` | E |
| REG-43 | `foxy_chunk_sanitization_strips_injection_prefixes` | `sanitizeChunkForPrompt(text)` strips leading attack prefixes (case-insensitive `Ignore previous`, `Disregard`, `Forget`; role tokens `System:`/`Assistant:`/`Human:`/`User:`; chat-template specials `<\|im_start\|>`, `<\|im_end\|>`, `[INST]`, `[/INST]`; stacked combos like `Ignore previous. System: ...`). Length cap: content > 1500 chars truncates to exactly 1500 (off-by-one boundary verified at MAX+1 → MAX). Idempotent (`sanitize(sanitize(x)) === sanitize(x)`). Defensive: `''`/`null`/`undefined`/non-string → `''`. Audit trail: emits a `[rag/sanitize]` `console.warn` with `prefix=true` / `truncate=true` flags whenever sanitization fires; clean short input emits NO warn (P13 — no PII / spam in logs). Anchoring contract: prefix matchers are anchored at the start of the chunk, so an attack phrase appearing mid-chunk is treated as data and preserved. Preserves clean NCERT content untouched. | `src/__tests__/rag/chunk-sanitization.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — indirect prompt-injection defense at the NCERT-chunk
  boundary; MMR diversity bounds prompt-token spend so a crafted
  near-duplicate cluster cannot crowd out diverse pedagogical material
  and inflate Anthropic cost)
- P13 (data privacy — sanitize warn-log signature contains only
  `prefix`/`truncate`/`originalLen` flags, no chunk content / studentId /
  document_id, so audit trail does not leak PII or NCERT chapter URLs)

### Notes on test strategy

Both files import the Edge Function source directly via dynamic import
(`../../../supabase/functions/_shared/rag/{mmr,sanitize}`). The modules
are pure TS with no Deno globals, so Vitest exercises the same code path
that `deno test` runs on the Edge side. If the implementation diverges
(e.g. someone changes the prefix matcher to global instead of anchored,
or swaps the MMR greedy loop for a probabilistic tie-breaker), these
specs MUST fail and quality MUST reject — the contract here is the
moat-protection guarantee that competitor scrapes and prompt-injection
attempts cannot leak Foxy's behaviour.

## Foxy Structured Rendering Envelope (2026-05-02)

Source: Foxy structured-rendering workstream — `/api/foxy` and the
`grounded-answer` Edge Function now emit a structured `lines[]` payload
conforming to `src/lib/foxy/schema.ts`. The Next.js renderer
(`FoxyStructuredRenderer.tsx`) consumes it; the `is-foxy-response.ts`
guard ensures the renderer degrades gracefully when an upstream payload
fails schema validation. The streaming `done` event persists both the
structured JSONB and the denormalized `content` text atomically, and
Hindi i18n uses NCERT-standard terms (`परीक्षा सुझाव`, never the
non-standard `परीक्षा टिप`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-55 | `foxy_structured_rendering_envelope` | Foxy `/api/foxy` and `grounded-answer` Edge Function streaming responses produce a structured payload (lines[]) conforming to `src/lib/foxy/schema.ts`; renderer (`FoxyStructuredRenderer.tsx`) gracefully degrades on schema-invalid payloads via `is-foxy-response.ts` guard; streaming-done event persists both `structured` JSONB and denormalized `content` text atomically (no orphaned messages with one-but-not-the-other); Hindi i18n uses NCERT-standard terms (परीक्षा सुझाव, not परीक्षा टिप). | `src/__tests__/api/foxy/streaming-structured-persistence.test.ts`, `src/__tests__/api/foxy/structured-abstain-and-history.test.ts`, `src/__tests__/api/foxy/structured-persistence.test.ts`, `src/__tests__/components/FoxyStructuredRenderer.test.tsx` | E |

### Invariants covered by this section

- P7 (bilingual UI — Hindi rendering uses NCERT-standard terminology;
  no `परीक्षा टिप` fallback)
- P12 (AI safety — schema-invalid LLM output never reaches students; the
  guard short-circuits to a safe degraded render)
- P13 (data privacy — persistence path writes structured JSONB + content
  in a single atomic transaction so the chat history cannot end up with
  half-rendered messages that would later be re-fetched and re-shipped
  to Sentry)

## AlfaBot Landing-Page Widget (2026-05-19) — REG-65..REG-68

Source: AlfaBot v1 rollout — PRs 1-4 (migration, Edge Function + Next
routes, frontend widget, super-admin dashboard). AlfaBot is the
landing-page chat surface on `/welcome?v=2` that answers anonymous
visitors' product/pricing/school/parent/teacher questions before
sign-up. It is NOT Foxy — it explicitly refuses tutoring requests.

Model: OpenAI gpt-4o-mini (CEO directive 2026-05-19, cost-efficient).
The model swap from Claude to OpenAI is the reason REG-67 below is
catalogued — any future provider/model change needs a documented human
review and a catalog update in the same PR.

Concomitant work in this PR series: shared SSE event-name constants
shipped to `src/lib/alfabot/sse-events.ts` to prevent the drift between
Edge Function producer (`event: token`) and Next route / client lib
parsers (which historically used `event: text`). The drift is currently
non-fatal because the route's `done` frame carries `response` as a
fallback, but the contract test in
`src/__tests__/contract/alfabot-route-edge-contract.test.ts` pins the
expected names and includes a `.fails` assertion that surfaces the
remaining drift in the consumer surfaces.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-65 | `alfabot_pricing_verbatim_guard` | (1) `docs/alfabot/knowledge-base.md` contains the canonical literal `₹699` in the `pricing-plans` section, with the per-month framing alongside (so the post-processor's ₹-adjacency banned-phrase check has the full string to match). (2) `src/components/landing-v2/FAQV2.tsx` contains the same literal in the pricing FAQ row, with English `month` or Hindi `माह` adjacent. (3) Cross-file drift detector: extract the first `₹\d{2,5}` from both files and assert the digits are identical AND equal to `699`. Edge Function side — pricing-unbacked rejections live in the Deno integration test at `supabase/functions/alfabot-answer/__tests__/integration.test.ts` (banned-phrase + pricing-banned check). | `src/__tests__/contract/alfabot-kb-pricing-drift.test.ts` | E |
| REG-66 | `alfabot_scope_lock_no_tutoring` | (1) `ALFABOT_HARD_REFUSAL_PATTERNS` in `src/lib/ai/prompts/alfabot-system.ts` enumerates 4 hard-refusal categories: math/homework (routes to `not_a_tutor`), medical/legal/mental-health (routes to `off_topic`), politics/religion/news (routes to `off_topic`), other students' data (routes to `other_student_data`). (2) `ALFABOT_REFUSALS` has both `en` and `hi` strings for each refusal id. (3) Server-side mirror: `supabase/functions/alfabot-answer/shared.ts` `detectHardRefusal()` matches the same patterns and emits the canned `ALFABOT_REFUSALS[id][lang]` string WITHOUT calling OpenAI (defense-in-depth at the Edge Function boundary). (4) Pre-LLM regex filter in `src/app/api/alfabot/route.ts` (`PROMPT_INJECTION_PATTERNS`) is an independent abuse short-circuit (prompt injection / URLs / base64 runs) on the route path — different surface, same defense-in-depth posture. (5) Existing prompt-module unit tests cover ALFABOT_REFUSALS / ALFABOT_HARD_REFUSAL_PATTERNS / ALFABOT_BANNED_PHRASES at the data layer; the route-level abuse path is covered by `src/__tests__/api/alfabot/route.test.ts:321` ("abstains on prompt injection without calling Edge Function"). | `src/lib/ai/prompts/alfabot-system.test.ts` (prompt module) + `src/__tests__/api/alfabot/route.test.ts` (route abuse abstain) + `supabase/functions/alfabot-answer/__tests__/integration.test.ts` (Deno, refusal flow) | P |
| REG-67 | `alfabot_model_provenance` | Every `alfabot.respond` audit row, every `alfabot_messages.model` value on assistant rows, AND every response envelope's `body.model` field must equal `'gpt-4o-mini'` (or the configured fallback returned by the Edge Function). Drift cases asserted: (a) upstream returns `gpt-4o` fallback → all three places reflect `gpt-4o`; (b) upstream omits `model` field → route falls back to the `MODEL_ID` constant (`gpt-4o-mini`); (c) upstream failure path's `alfabot.upstream_failed` audit row also stamps `model=gpt-4o-mini` for forensic continuity. User rows in `alfabot_messages` MUST NOT carry a model field (per route documentation). Because user approval is required for AI model changes (`.claude/CLAUDE.md`), this regression's failure forces an explicit catalog update in the same PR. | `src/__tests__/api/alfabot/model-provenance.test.ts` | E |
| REG-68 | `alfabot_pii_boundary_in_audit` | `audit_logs.details` for the `alfabot.respond`, `alfabot.upstream_failed`, and `alfabot.abuse_blocked` actions MAY contain: anonId, sessionId, audience, lang, tokensUsed, latencyMs, degradedMode, sourcesCount, model, abuseReason, traceId. MUST NEVER contain: message text, assistant text, email, phone, name, school_name, raw IP. Hashed IP (`ip_hash`) is permitted ONLY in `alfabot_sessions` rows, never in audit details. Existing happy-path test in `src/__tests__/api/alfabot/route.test.ts` (line 484) and lead-capture test in `src/__tests__/api/alfabot/lead.test.ts` already pin the negative shape via `JSON.stringify(details).not.toContain(message)`; REG-68 catalogues that pattern as the regression contract. | `src/__tests__/api/alfabot/route.test.ts` (happy + abuse + upstream fail audits) + `src/__tests__/api/alfabot/lead.test.ts` (lead audit) | E |

### Invariants covered by this section

- P11-adjacent (pricing brand/legal risk — REG-65) — hallucinated price
  on the landing page is a chargeback / consumer-protection vector
  even though no payment flows through AlfaBot.
- P12 (AI safety — REG-66 scope-lock; REG-67 model provenance gate)
- P13 (data privacy — REG-68 audit-log PII boundary; matches the
  `audit_logs.details` policy stated in `src/app/api/alfabot/route.ts`
  module header)

### Notes on test strategy

REG-65 and the SSE-event contract test are static-source drift detectors
in the same family as REG-51, REG-54, REG-57: they read the relevant
files via `node:fs` and assert on string contracts without booting
runtime infrastructure. This is the only way to enforce drift between
two source-of-truth files (the KB markdown and the FAQ TSX, in REG-65's
case) without an end-to-end harness.

REG-67 exercises the `/api/alfabot` route handler with the same
supabase-admin + logAudit mocking pattern as `route.test.ts` (the
existing PR-2 test fixture). It runs the route end-to-end for four
cases: happy-path gpt-4o-mini, upstream gpt-4o fallback, upstream
omits-model, and upstream-failure audit-row stamping.

REG-66 is currently `P` (partial) because the canonical hard-refusal
test lives in the prompt-module unit suite (PR 1 ai-engineer) and the
server-side mirror lives in the Deno integration suite (PR 2). Neither
file is duplicated here; the catalog entry references both and surfaces
the dual-surface contract.

REG-68 is also `E` via reference rather than a new dedicated file —
the existing route + lead tests already JSON.stringify the audit
payload and assert no PII strings survive. Promoting that pattern into
the catalog makes it block-on-removal under orchestrator Gate 5 and
quality veto.

### Catalog total

Pre-AlfaBot: 35 entries (target reached as of 2026-05-04, Marking-
Authenticity Wave 5). AlfaBot v1 adds REG-65, REG-66, REG-67, REG-68.

**Total: 39 entries.**

### Contract drift surfaced during this work

The SSE event-name contract between the Edge Function (`event: token`)
and the Next route + client lib consumers (`event: text`) is currently
drifted. The drift is documented in
`src/__tests__/contract/alfabot-route-edge-contract.test.ts` with a
`.fails` test that flips to passing when both consumer surfaces adopt
the canonical `token` name. The new shared module
`src/lib/alfabot/sse-events.ts` is the single source of truth that the
follow-up PR will import in all three places. Catalogue this here so
the orchestrator knows there's a known deferred contract bug.

## Foxy AI Tutor Mobile Redesign — Phase 0+1 (2026-06-12)

Source: Foxy mobile-first redesign (compact top bar + Study sheet), flag-gated
behind `ff_foxy_os_v1` (default OFF, `<lg` only). `/foxy` is the highest-traffic
AI surface and sits near the P10 bundle ceiling, so the OFF-path-byte-identity
property is load-bearing.

> **ID note (2026-06-12):** this entry was originally drafted as REG-120 but
> collided with the RBAC/Pulse FOUNDATION spec
> (`docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`
> §7/§12), which reserved **REG-120 for RBAC matrix conformance**. The RBAC
> reservation predates this entry and is anchored in the design doc, so this
> Foxy-OS entry was renumbered to **REG-123**. No test code referenced the REG
> number (test files are named `foxy_os_*`), so the renumber is catalog-only.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-123 | `foxy_os_flag_default_off_and_header_gating_identity` | `ff_foxy_os_v1` resolves DEFAULT-OFF (no cache/override → false; `FLAG_DEFAULTS` false); `devForcedOn` localStorage override (`alfanumrik_force_foxy_os`) is a strict no-op in production NODE_ENV; cache TTL honored under `alfanumrik_foxy_os_flag_v1`. Header-gating predicate selects the new mobile surface in EXACTLY 1 of 4 states (flag ON and viewport `<lg`); all other states render the legacy 5-row header verbatim (OFF-path byte-identity). | `src/__tests__/lib/foxy-os-flag-off-identity.test.ts`, `src/__tests__/lib/foxy-os-header-gate.test.ts` | E |

### Invariants covered by this section

- P10 (bundle budget — new components `dynamic()`-lazy-loaded; OFF path adds 0 bytes to the near-ceiling `/foxy` page)
- OFF-path safety — the redesign cannot leak onto prod/desktop until an operator flips the DB flag

### Catalog total

Pre-foxy-os: 87 entries. Adds REG-123 (Foxy-OS flag DEFAULT-OFF + header gating
identity — P10 + OFF-path safety). Running total after Foxy-OS: 88 entries.

## Foxy P12 grade-spoof hard block — unconditional, all subjects, audit row (2026-06-15) — REG-142

Source: CEO Decision D2 (2026-06-15). The `/api/foxy` route previously trusted
the client-supplied `grade` field for prompt assembly, RAG scope, and curriculum
selection — so a Grade 7 student could send `grade:'12'` and receive senior-grade
content (a P12 AI-safety violation: AI must stay within the student's enrolled
CBSE scope). The flag-gated `validateCurriculumScope` STEM pre-gate (REG —
curriculum-guard-pregate) catches this for math/physics/chemistry/biology when
`ff_foxy_curriculum_guard_v1` is ON, but it does NOT cover non-STEM subjects
(english, hindi, history, etc.) and it is OFF by design as a kill switch — so
a determined spoofer could simply request `subject:'english'` or wait for an
incident-flag-off window. This entry pins a SECOND, UNCONDITIONAL, subject-
independent defense layer.

> **ID note:** REG-135..REG-141 are taken by the MOL Python-unification cluster
> (REG-135..REG-139), the B1 RAG eval-harness (REG-140), and the Voyage rerank
> model-id hotfix (REG-141). REG-142 is the next free id at the time this
> entry was written (2026-06-15).

The wire (three layers, in order, before any LLM call):

1. **Zod 400** at `route.ts:2641-2658`. `FoxyRequestBodySchema` requires
   `grade ∈ z.enum(['6','7','8','9','10','11','12'])`. Any out-of-range string
   OR wrong type (integer, missing) returns 400 with `code:'INVALID_GRADE'`
   BEFORE the students fetch, studentId resolution, governance check, prompt
   build, RAG retrieval, or LLM call. (P5: grades are strings.)
2. **DB-authoritative compare** at `route.ts:2802-2849`. The students row's
   `grade` column is loaded server-side and compared to the (Zod-validated)
   body grade. If `dbGrade !== null` AND `dbGrade !== grade` the route returns
   `403 {code:'GRADE_MISMATCH', message:'Request grade does not match
   enrollment'}`, writes an `audit_logs` row via `logAudit` with
   `action:'foxy.grade_spoof_attempt'` +
   `details:{claimed_grade, actual_grade, route:'/api/foxy'}` + `status:'denied'`,
   and SKIPS every downstream call — no Claude, no grounded answer, no quota
   spend.
3. **Null-grade warn-and-proceed** at `route.ts:2850-2856`. A `dbGrade === null`
   row (legitimately-onboarding student) is NOT 403'd — the route logs a
   `logger.warn` and continues. The flag-gated STEM curriculum guard still
   acts as a second layer downstream.

The block runs **independent of `ff_foxy_curriculum_guard_v1`** and fires for
**ALL subjects including non-STEM** (english, hindi, history, etc.). The flag
only gates the existing STEM-only `validateCurriculumScope` pre-gate, which
remains in place as a defense-in-depth second layer for STEM topics.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-142 | `foxy_p12_grade_spoof_hard_block` | (A) Out-of-range `grade:'5'` → 400 `{code:'INVALID_GRADE'}`, no students-fetch, no Claude / grounded-answer / routeIntent call, no `foxy.grade_spoof_attempt` audit. (B) Wrong-type `grade:12` (integer) → same 400 + same downstream silence (P5 enforced via Zod). (C) Happy path `grade:'8'` / `dbGrade:'8'` → no 400/403, grounded path called exactly once, no spoof audit row. (D) Spoof `grade:'12'` / `dbGrade:'8'` → exact body `{code:'GRADE_MISMATCH', message:'Request grade does not match enrollment'}` at HTTP 403; exactly ONE `logAudit` call with `action:'foxy.grade_spoof_attempt'`, `resourceType:'students'`, `resourceId:'student-uuid-1'`, `status:'denied'`, and `details:{claimed_grade:'12', actual_grade:'8', route:'/api/foxy'}`; NO Claude / grounded-answer / routeIntent call; NO foxy quota RPC invoked (no quota spend on the 403 branch). (E) Null-grade onboarding (`dbGrade:null`, body `grade:'6'`) → NOT 403'd, grounded path called, `logger.warn` for the null-grade marker, NO spoof audit row. (F) Subject independence — `subject:'english'` (non-STEM) with `grade:'12'` / `dbGrade:'8'` still returns 403 GRADE_MISMATCH + writes the audit row + does NOT call grounded; explicitly with `ff_foxy_curriculum_guard_v1=false` to prove the gate is independent of the curriculum guard. **Deferred:** the inline `TODO(monitoring)` comment in `route.ts` flags that the per-request `logger.info('foxy.request', ...)` marker is intended to swap to `logSystemMetric` once the monitoring substrate lands; that swap is NOT in this entry's scope (no monitoring infra to assert against yet). | `src/__tests__/api/foxy/grade-spoof-hard-block.test.ts` (17 tests, 6 scenarios A–F) | E |

### Invariants covered by this section

- P12 AI safety / curriculum scope — REG-142 (an out-of-grade client claim
  CANNOT reach prompt-assembly, RAG scope, or any LLM call; the block is
  subject-independent so non-STEM topics are covered too; the block is
  independent of `ff_foxy_curriculum_guard_v1` so an OFF-flag window does
  NOT open a spoof vector).
- P5 Grade format — REG-142 (Zod enforces `grade ∈ z.enum(['6'..'12'])` at
  the API boundary; integer 12 is rejected as a P5 violation alongside the
  out-of-range string '5').
- P9 RBAC enforcement / audit completeness — REG-142 (every spoof attempt
  writes an `audit_logs` row with `action:'foxy.grade_spoof_attempt'` and
  the claimed/actual grade pair, giving ops the forensic trail to detect
  scaled abuse).
- P13 Data privacy — REG-142 (the audit details payload carries only the
  two grade strings + the route name — no message text, no PII).

### Catalog total

Pre-REG-142: 109 entries (through the Voyage rerank model-id hotfix,
REG-141). The Foxy P12 grade-spoof hard-block adds REG-142 (unconditional
all-subject grade-spoof defense — Zod 400, DB-compare 403 with audit row,
null-grade warn-and-proceed, subject-independent). **Total catalog: 110
entries (target: 35 — TARGET EXCEEDED).**

**Total: 110 entries.**

## Foxy event-logging FK-safety + telemetry hygiene — fire-and-forget observability never corrupts state or leaks PII (2026-06-15) — REG-148

Source: the Foxy event-logging instrumentation on `/api/foxy`. The route now
fires ADDITIVE, non-blocking observability on every turn: `logLearningEvent →
learning_events` (a `foxy_ask` row) and `logSystemMetric → system_metrics` (the
`foxy_request` / `edge_fn_latency_ms` success metrics + an `error_rate` metric
from the top-level catch). These are telemetry only — they move NO XP, mastery,
or business state. Two silent-failure traps make this worth pinning:
- **FK silent-drop:** `learning_events.student_id` is `uuid NOT NULL REFERENCES
  auth.users(id)`. The route resolves TWO distinct ids — `auth.userId`
  (= `auth.uid()`, the `auth.users` PK) and `auth.studentId` (the `students`-table
  PK). The event FK targets `auth.users`, so `student_id` MUST be `auth.userId`.
  A refactor that swaps in `studentId` makes EVERY event silently fail the FK and
  be swallowed by fire-and-forget (`logLearningEvent` never throws) — no test, no
  alert, no data.
- **Telemetry-pollution / PII trap:** business early-returns (429 quota, 400
  invalid-grade) are EXPECTED outcomes, not errors — they must emit neither
  `error_rate` nor a `foxy_ask` event. The `error_rate` metric carries an
  `error_code` tag ONLY (no message text, no PII).

Files under test:
- `src/app/api/foxy/route.ts` — the `logFoxyAsk` closure (success-terminal event +
  latency/request metrics) and the top-level catch (`error_rate`).
- `src/lib/monitoring/log-event.ts` — `logLearningEvent` / `logSystemMetric`
  (mocked at the boundary so the loggers are observable, not Supabase-bound).

The math-turn no-mastery guard (`src/__tests__/api/foxy/math-solve-no-xp-no-mastery.test.ts`)
acknowledges `system_metrics` + `learning_events` on its `ALLOWED_WRITE_TABLES`
allow-side as INTENDED, benign telemetry; its `FORBIDDEN_MASTERY_TABLES` +
`FORBIDDEN_RPCS` assertions stay exactly as strict (a math turn still grants 0 XP
and moves 0 mastery — P2/P4-adjacent).

> **ID note:** REG-147 is the previous entry (per-school deal-driven
> entitlements, 2026-06-15). REG-148 is the next free id at the time this entry
> was written.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-148 | `foxy_event_logging_fk_safety_and_telemetry_hygiene` | **(1) FK-safe identity (silent-drop guard):** on the grounded-default SUCCESS path the route logs exactly one `foxy_ask` `learning_event` whose `student_id === auth.userId` (the `auth.uid()` / `auth.users` PK) and NOT `auth.studentId` (the `students`-table PK) — asserted by exact equality against two DELIBERATELY-distinct sentinel ids; `topic_id === null` (no verified `curriculum_topics.id` in scope); `session_id === resolvedSessionId` (the `foxy_sessions` row id, not the fallback); `event_type === 'foxy_ask'`, `verb === 'asked'`, `object_type === 'foxy'`, `result.response_tokens` from `grounded.meta`, and a PII-free `context` (no `email`/`phone`/`name` keys). **(2) Success metrics:** the same turn emits both a `foxy_request` and an `edge_fn_latency_ms` `system_metric` (`route === '/api/foxy'`, numeric `value`, `grade` tag) and does NOT emit `error_rate`. **(3) Error path:** when a downstream collaborator (`callGroundedAnswer`) rejects, the top-level catch returns 503 and emits exactly one `error_rate` metric (`route === '/api/foxy'`, `value === 1`, an `error_code` tag ONLY — the exception message text never rides along — P13); a thrown turn never reached `logFoxyAsk`, so NO `foxy_ask` event. **(4) Business early-returns do not pollute telemetry:** a 429 quota exhaustion (`check_and_record_usage` → `allowed:false`) emits NO `error_rate` and NO `foxy_ask`; a 400 invalid-grade (`grade:'5'`, below CBSE 6-12) emits NO `error_rate` and NO `foxy_ask`. **(5) Compile-time/shape guards:** `'foxy_ask'` is a member of `LearningEventType`; the verbatim `logFoxyAsk` event payload is assignable to `LearningEvent`; and the three route metrics (`error_rate`, `edge_fn_latency_ms`, `foxy_request`) are assignable to `SystemMetric` — a field/type drift breaks `npm run type-check`, not just the assertion. | `src/__tests__/monitoring/foxy-event-logging.test.ts` (13) | U (unit; drives the REAL `POST` handler with the heavy-mock surface, `@/lib/monitoring/log-event` mocked so the loggers are observable) |

### Invariants covered by this section

- P12 AI safety — REG-148 (the `foxy_ask` event + the success/latency metrics are
  fire-and-forget observability on the Foxy turn; they never block, alter, or gate
  the AI response, and the business early-returns that protect the per-plan daily
  cap emit no spurious error telemetry).
- P13 Data privacy — REG-148 (the `foxy_ask` event `context` carries no
  `email`/`phone`/`name`; the `error_rate` metric carries an `error_code` tag only,
  never the exception message text or any PII; the FK-safe `student_id` pin keeps
  the event stream from silently dropping into a swallowed-write hole).

### Catalog total

Pre-REG-148: 115 entries (through the per-school deal-driven entitlements pin,
REG-147). The Foxy event-logging telemetry-hygiene pin adds REG-148: the
fire-and-forget `learning_events`/`system_metrics` instrumentation on `/api/foxy`
is FK-safe (`student_id === auth.userId`, never the `students` PK — else every
event silently fails the `auth.users` FK under fire-and-forget), emits the
success `foxy_request`/`edge_fn_latency_ms` metrics and a catch-only `error_rate`
(error_code tag only, no PII), and keeps business early-returns (429 quota / 400
invalid-grade) out of the error/event telemetry entirely. 13 tests in 1 file.
**Total catalog: 116 entries (target: 35 — TARGET EXCEEDED).**

**Total: 116 entries.**

## Portal RBAC/SaaS remediation Phase 2 — guardian Foxy-transcript boundary + parent support/calendar + bulk-parent broadcast (2026-06-16) — REG-149..REG-151

Source: Phase 2 of `feat/portal-rbac-saas-remediation`. This wave wired three
previously-stubbed parent surfaces to live, RLS/RBAC-gated server data:
- **Parent Foxy chat view** — `GET /api/parent/children/[student_id]/chat` lets
  an APPROVED guardian read (read-only, keyset-paginated) their linked child's
  Foxy AI-tutor transcript. Backed by migration `20260620000200` which adds a
  SELECT-only, `is_guardian_of()`-scoped RLS policy on `foxy_chat_messages` (+
  `foxy_sessions`). This is the most sensitive surface in the wave: it exposes a
  child's chat to a parent (CEO-approved P13 widening), so the boundary is the
  whole point of the test.
- **Parent calendar** — `GET /api/parent/calendar` aggregates a linked child's
  upcoming `assignments` + `school_exams` + recent `quiz_sessions` into one
  sorted `events[]`.
- **Parent support tickets** — `POST/GET /api/support/tickets` gained a guardian
  path (parent holds `child.view_progress`, not `foxy.chat`): create + list-own,
  anchored to a linked child, role-tagged `parent`, rate-limited 5/24h.
- **Bulk parent broadcast** — `POST /api/school-admin/parents` now routes the
  EMAIL channel through `send-transactional-email` (new `school-parent-broadcast`
  template) and standardised the response to `{ sent_count, failed_count,
  channel }`.

Two traps make these worth pinning:
- **The chat boundary is a P13 cliff edge.** `canAccessStudent(authUserId,
  childId)` is the single app-layer data boundary; the migration RLS policy is
  the defense-in-depth DB boundary (`is_guardian_of()` is true ONLY for
  status IN ('active','approved'), so an UNLINKED or PENDING guardian gets zero
  rows). If either gate weakened — or a write path were ever added — a parent
  could read (or worse, alter) an arbitrary child's private tutoring chat.
- **The bulk-broadcast + support paths handle PII at scale.** Email addresses,
  message bodies, and phone numbers must never reach the logger or the audit
  metadata; the audit row carries counts/channel/target only.

Files under test:
- `src/__tests__/api/parent/children-chat-boundary.test.ts` — the architect's
  priority P13 regression (auth gate, boundary deny = 403 + no read + denied
  audit + no payload, approved-child scope pin, read-only/no-write, keyset
  pagination, source + migration SELECT-only contract).
- `src/__tests__/api/support/support-tickets-guardian.test.ts` — guardian create
  + list-own + 403 NO_LINKED_CHILD + 429 rate-limit + P13 redaction.
- `src/__tests__/api/parent/parent-calendar.test.ts` — aggregation shape +
  403-not-linked-no-payload + 400/404 + P5 grade-string + no-PII-logged.
- `src/__tests__/api/school-admin/parents-broadcast.test.ts` — `{message,target,
  channel}` → `{sent_count,failed_count,channel}` contract, per-guardian Edge
  Function dispatch via the `school-parent-broadcast` template, authz, P13.

> **ID note:** REG-148 is the previous entry (Foxy event-logging telemetry
> hygiene, 2026-06-15). REG-149..REG-151 are the next free ids. (The originating
> task brief referenced "after REG-134"; that was stale — the live catalog had
> already grown to REG-148.)

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-149 | `parent_foxy_chat_p13_boundary_read_only_keyset` | **THE P13 CHAT BOUNDARY (architect priority).** **(1) Own-approved-child only:** with `canAccessStudent(callerAuthId, pathChildId)` true the route reads `foxy_chat_messages` on the RLS-scoped SSR client with EXACTLY one `student_id` eq filter equal to the path child id (asserted via a filter-recording in-memory `@supabase/ssr` client), newest-first on `created_at`, and returns only those rows mapped to `{id,role,text,created_at,session_id}`; the boundary call is keyed `(callerAuthId, pathChildId)`. **(2) Unlinked OR pending guardian → 403, zero rows:** when `canAccessStudent` is false the route returns 403, the transcript read is NEVER issued (a `readReached` sentinel stays false — no transcript is ever assembled), and a `parent.child_chat_viewed` audit row with `status:'denied'` + `resourceId=childId` is written. Pending links surface identically (`is_guardian_of()` requires status IN active/approved). **(3) No guardian write path:** the route module exports GET only (no POST/PUT/PATCH/DELETE), and the RLS client records ZERO insert/update/delete/upsert/rpc calls on the happy path; the migration `20260620000200` is FOR-SELECT-only (`foxy_chat_messages_guardian_select`, `is_guardian_of`), introduces no guardian INSERT/UPDATE/DELETE/ALL policy, and contains no executable DROP-other-than-POLICY / TRUNCATE / DROP TABLE (DDL checked with `--` comments stripped). **(4) No payload on any deny:** 401/400/403/500 bodies carry only `{success:false,error}` — no `data`, no `messages`, no `page`, and no chat text/role markers anywhere in the serialized body; a 500 from an RLS read error also leaks nothing. **(5) Keyset pagination:** the route over-fetches `limit+1`, returns only `limit` rows with `page.has_more=true` and `page.next_before` = the oldest returned row's `created_at`; passing `?before=<iso>` applies a `.lt('created_at', iso)` keyset filter; an over-large `?limit` is capped at 100 (over-fetch 101); the last page reports `has_more:false`/`next_before:null`. **(6) Audit hygiene:** the success audit `details` carries only `{message_count}` — never the message body. | `src/__tests__/api/parent/children-chat-boundary.test.ts` (17) | U (unit; drives the real `GET` handler with `@/lib/rbac` + `@supabase/ssr` + `next/headers` mocked; the SSR client records filters/mutations) |
| REG-150 | `parent_support_tickets_guardian_path` | The Phase 2 guardian support path. **(1) Create:** a logged-in guardian (holds `child.view_progress`, fails `foxy.chat`) `POST`s a ticket → persisted to `support_tickets` anchored to the FIRST linked child's `student_id`, `user_role='parent'`, `status='open'`, returning the new `ticket_id`. **(2) No linked child:** a guardian with zero links → `403 NO_LINKED_CHILD` on create (no row inserted) and an EMPTY list on `GET` (no DB list query issued, never another family's tickets). **(3) List-own scope:** `GET` filters `student_id IN (linked children)` AND `user_role='parent'`, so a guardian never sees the child's own `student`-role tickets. **(4) Rate limit:** the 6th create inside the in-memory 24h/5 window → `429 RATE_LIMITED` with a numeric `retry_after_ms`, and no 6th row is inserted. **(5) P13:** the persisted `email` column is the redacted sentinel `authenticated@redacted`, and the `logOpsEvent` context carries ids/role/category only — the serialized payload contains neither the message body nor a phone number. **(6) Unauthenticated `GET` → 401 verbatim.** (Per-test distinct auth ids isolate the module-level rate-limit Map — no shared mutable state across tests.) | `src/__tests__/api/support/support-tickets-guardian.test.ts` (8) | U (unit; real POST/GET with `@/lib/rbac`, identity/relationship domains, ops-events, and an in-memory `support_tickets` admin client mocked) |
| REG-151 | `parent_calendar_aggregation_and_school_broadcast_contract` | Two Phase-2 parent-facing wirings. **PARENT CALENDAR** (`GET /api/parent/calendar`): RBAC gate uses `child.view_progress`; `canAccessStudent` is the single boundary — a NOT-LINKED guardian → 403 with the source queries (assignments/exams/quiz) NEVER run (an `anySourceQueried` sentinel stays false) and NO `events` payload (P13); 401 when unauthenticated (no boundary call); 400 on a non-UUID `student_id`; 404 when the child can't be resolved (no payload); the happy path merges `assignments`+`school_exams`+`quiz_sessions` into one `events[]` (each tagged `type`), sorted ascending by date, with the quiz event carrying a rounded `NN%` subtitle and `data.grade` a STRING (P5); the student name is never logged. **SCHOOL→PARENT BROADCAST** (`POST /api/school-admin/parents`): the corrected `{message,target,channel}` → `{success,data:{sent_count,failed_count,channel}}` contract — missing `message`/invalid `target`/invalid `channel` → 400, a `grade` target with a non-CBSE grade `'5'` → 400 (P5); `authorizeSchoolAdmin('school.manage_settings')` rejects an unauthorized caller verbatim with NO email/audit fired; the EMAIL channel dispatches one `send-transactional-email` call per approved guardian-with-email using the `school-parent-broadcast` template, counting `json.sent===true` as sent and the rest as failed; a no-match target short-circuits to zero counts with no fetch; P13 — neither the logger nor the `logSchoolAudit` metadata carries a guardian email or the message body (audit records counts/channel/target only, `action='parent_message.sent'`). | `src/__tests__/api/parent/parent-calendar.test.ts` (7), `src/__tests__/api/school-admin/parents-broadcast.test.ts` (7) | U (unit; real GET/POST handlers with rbac/identity/school-admin-auth/audit + table-aware in-memory admin clients + stubbed global `fetch` for the Edge Function) |

### Invariants covered by this section

- P8 RLS boundary — REG-149 (the guardian Foxy-transcript read rides the
  RLS-scoped SSR client, not `supabase-admin`; migration `20260620000200` adds a
  SELECT-only `is_guardian_of()`-scoped policy on `foxy_chat_messages`/
  `foxy_sessions` — the DB boundary beneath the `canAccessStudent` app gate).
- P9 RBAC enforcement — REG-149/REG-150/REG-151 (`child.view_progress` gates the
  chat + calendar surfaces; the support route falls back to `child.view_progress`
  for the guardian path; `school.manage_settings` gates the bulk broadcast).
- P5 Grade format — REG-151 (calendar `grade` is a string; the broadcast rejects
  a non-CBSE grade `'5'`).
- P13 Data privacy — REG-149 (no transcript payload on any deny path; success
  audit carries `message_count` only, never the chat body; read-only, no guardian
  write path), REG-150 (redacted email column; ops-event context carries no
  message body / phone), REG-151 (no `events` payload on a calendar deny; the
  broadcast logger + audit carry counts/channel/target only — never a guardian
  email or the message body; the student name is never logged).

### Catalog total

Pre-REG-149: 116 entries (through the Foxy event-logging telemetry-hygiene pin,
REG-148). Portal-remediation Phase 2 adds REG-149..REG-151: the guardian
Foxy-transcript P13 boundary (own-approved-child only, unlinked/pending → 403 +
zero rows + no payload, read-only/no-write, keyset pagination, SELECT-only RLS
migration), the parent support-ticket guardian path (create + list-own + 403
NO_LINKED_CHILD + 429 + PII redaction), and the parent-calendar aggregation +
school→parent broadcast request/response contract. 39 tests across 4 files.
**Total catalog: 119 entries (target: 35 — TARGET EXCEEDED).**

**Total: 119 entries.**

---

## REG-176: Foxy prompt-template routing invariant (RC-1 fix) + buildStarters personalisation + suggest-prompts bloomHint

**Date:** 2026-06-26
**Area:** AI / Foxy AI Tutor
**Risk:** HIGH — Routing back to monolithic `foxy_tutor_v1` would re-introduce 3 competing output format sections, causing random persona switching per response (RC-1). Incorrect bloomHint derivation thresholds would pitch Bloom's complexity at the wrong level for the student's mastery zone.
**What it pins:**
- `selectFoxyPromptTemplate()` routing: `practice`→`foxy_tutor_exam_v1`, `doubt`/`homework`→`foxy_tutor_doubt_v1`, all other modes→`foxy_tutor_teach_v1`. NEVER returns `foxy_tutor_v1`.
- `buildStarters()` MasteryHints personalisation: nextAction chip prepends with "Continue:" prefix; overdueTopics chip includes title + days-overdue text; weakTopics chip includes title + mastery%; priority order nextAction > overdueTopics > weakTopics; soft ceiling 12 chips; byte-identical to static output when hints are absent.
- `suggest-prompts` bloomHint derivation: avg >= 0.8 → analyze, >= 0.65 → apply, >= 0.4 → understand, else → remember. Static fallback bloomHint is `'understand'`.
- `daysOverdue` calculation: `Math.max(1, Math.round(ms/86400000))` — never 0, never negative.
**Tests:**
- `src/__tests__/api/foxy/select-prompt-template.test.ts` (17 tests)
- `src/__tests__/lib/foxy/starter-intents.test.ts` (13 tests)
- `src/__tests__/api/foxy/suggest-prompts-bloom.test.ts` (20 tests)
**Related RCA:** RC-1 (three competing output format contracts in one monolithic prompt), RC-17/RC-18 (IRT-driven suggest-prompts + buildStarters personalisation)

---

## Engineering-Audit Cycle 4 — Foxy AI Tutor & RAG (P12) — 2026-06-29

Source: engineering-audit program, Cycle 4 (Foxy AI & RAG). P12 requires that no
unfiltered LLM output reaches a student and that hostile student input cannot
re-steer the model. This cycle gave both guarantees executable, cross-layer
coverage. The output side is screened at every student-facing grounded exit
(non-streaming return, persisted structured content, streaming completion frame +
persisted record) by `screenStudentFacingText` — a hard-blocked answer collapses
to a safe hard-abstain envelope, refunds the quota, never persists the unsafe
text, and emits category-only (PII-free) telemetry; the `HARD_BLOCK_PATTERNS`
list is pinned byte-identical between the TS site and the Deno
`grounded-answer` Edge Function (22 patterns). The input side strips
assistant-directed prompt-injection overrides from the student message before
model assembly while preserving legitimate questions, fails open on non-string
input, and pins the assembled Foxy prompt to scope + UUID only (no PII).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-182 | `foxy_output_content_backstop` | P12: every student-facing grounded Foxy exit (non-streaming return, persisted structured content, streaming completion frame + persisted record) is screened by `screenStudentFacingText` before the student/store sees it; a hard-blocked answer → safe hard-abstain envelope + quota refund + no unsafe persist + category-only (PII-free) telemetry; legitimate CBSE 6-12 curriculum (class/mass/shell/"sexual reproduction"/alcohols/weapons/retardation/assassination + bare `<system>`/`[inst]` CS markup) is NOT over-blocked; real chat-template injections (`<<SYS>>`, `<|im_start|>`, `<s>[INST]…[/INST]</s>`) BLOCK; fail-safe (validator throw → safe-abstain); TS↔Deno HARD_BLOCK_PATTERNS byte-identical (22 patterns). | `src/__tests__/lib/ai/validation/output-screen*.test.ts`, `src/__tests__/api/foxy/output-safety-backstop.test.ts`, `src/__tests__/api/foxy/mode-acceptance-fox3.test.ts`, `supabase/functions/grounded-answer/__tests__/output-screen.test.ts` | E |
| REG-183 | `foxy_input_injection_neutralizer` | P12/P13: `neutralizeInjectionAttempt` strips assistant-directed prompt-injection overrides ("ignore previous instructions"/"you are now…"/role tokens) from the student message before model assembly while preserving legitimate questions ("ignore the friction…", "explain photosynthesis"); fail-open on non-string; the assembled Foxy prompt carries only scope + UUID (no studentName/email/phone) — P13 prompt-assembly contract. | `src/__tests__/lib/ai/validation/input-guard.test.ts`, `src/__tests__/api/foxy/output-safety-backstop.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety — no unfiltered LLM output to students: every student-facing
  grounded Foxy exit is screened by `screenStudentFacingText`; hard-block →
  safe hard-abstain + quota refund + no unsafe persist; TS↔Deno
  `HARD_BLOCK_PATTERNS` byte-identical; hostile student input is neutralized
  before model assembly while legitimate curriculum questions pass)
- P13 (data privacy — output-backstop telemetry is category-only/PII-free; the
  assembled Foxy prompt carries only scope + UUID, never studentName/email/phone)

### Catalog total

Pre-REG-182: 148 entries (through Engineering-Audit Cycle 3's REG-180/REG-181
score-formula + XP-literal parity pins). Engineering-Audit Cycle 4 adds REG-182
(Foxy output content backstop — every student-facing grounded exit screened,
hard-block → safe abstain + refund + no unsafe persist + PII-free telemetry,
TS↔Deno pattern parity) and REG-183 (Foxy input injection neutralizer +
P13 prompt-assembly contract).
**Total catalog: 150 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-241 — academic-vocabulary NO-MASK on the legacy/fallback Foxy path (P12, both directions) (2026-07-14)

Source: Foxy Phase-0 output-guard word-masking fix. `validateOutput`'s substring
BLOCKLIST (`packages/lib/src/ai/validation/output-guard.ts`) is now
WARN/FLAG-ONLY and NON-DESTRUCTIVE (a match records an advisory `errors` entry so
`valid` goes false, but `sanitizedContent` is NO LONGER rewritten to `***`), a
new bilingual `SAFE_ABSTAIN_MESSAGE` was added, and the three legacy
intent-router workflows (`explain.ts`, `revision.ts`, `doubt-solve.ts`) now route
the student-facing text through the word-boundary-safe `screenStudentFacingText`
(serve-original-or-abstain) instead of assigning `validateOutput().sanitizedContent`.

**Why.** The old bare-substring BLOCKLIST rewrote any match to `***`, censoring
legitimate CBSE vocabulary that merely CONTAINS a token — `assertive`→`***ertive`,
`class`→`cl***`, `passage`→`p***age`, `assess`, `potassium`, `Assam`, `assembly`,
`sexual reproduction`→`***ual reproduction`, `shell`→`s***`. That masked text
reached students on the legacy/fallback Foxy path (`ff_grounded_ai_foxy` OFF, or
the grounded-service abstain fallback). Over-masking is a P12 violation in the
OTHER direction from unfiltered output: it silently breaks real lessons, so the
PASS set is as load-bearing as the BLOCK set. The real student-facing safety
decision now belongs solely to the word-boundary-safe `screenStudentFacingText`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-241 | `foxy_legacy_path_academic_vocab_served_unmasked_genuine_abuse_still_blocked` | (a) **No-mask PASS set**: `validateOutput` returns `sanitizedContent` byte-identical to the input (no `***`) for all 41 realistic CBSE sentences whose curriculum word collides with an `ass`/`hell`/`sex` BLOCKLIST substring (`assertive`, `assertion`, `assert`, `class`, `classify`, `classroom`, `pass`, `passage`, `passive`, `assess`, `assessment`, `mass`, `brass`, `grass`, `compass`, `embarrass`, `associate`, `essay`, `hello`, `shell`, `sexual reproduction`, `therapist`, `analysis`, `potassium`, `molasses`, `glass`, `biomass`, `landmass`, `sextant`, `Assam`, `Sussex`, `Essex`, `assembly`, `ambassador`, `harassment`, `association`, `assassination`, `assassinate`, `assume`, `assumption`, `classical`); each exact word survives verbatim; the three named incident cases (`assertive`/`class`/`passage`) never emit `***ertive`/`cl***`/`p***age`. (b) `screenStudentFacingText` passes every one of those sentences (`safe:true`, no `blocklist` category). (c) **BLOCK set still fires**: genuine profanity/slurs/self-harm (`fuck`, `shit`, the n-word, `faggot`, `kill yourself`, `kys`, `go die`, Hindi Devanagari abuse, Hinglish abuse) are STILL hard-blocked by `screenStudentFacingText` (`safe:false`, category `blocklist`); `validateOutput` still records an advisory flag (`valid:false`, `errors.length>0`) for blocklisted profanity but does NOT mutate `sanitizedContent`. (d) **Workflow boundary** (the value flowing into `persistLegacyFoxyResponse`): all three legacy workflows serve SAFE model text ORIGINAL-and-unmodified (curriculum survives, no `***`), and replace UNSAFE model text with the clean bilingual `SAFE_ABSTAIN_MESSAGE` — never the raw unsafe text, never a `***`-masked variant. (e) `SAFE_ABSTAIN_MESSAGE` is itself bilingual (EN + Devanagari, P7) and self-screening (re-screening it is a no-op). | `src/__tests__/lib/ai/validation/output-guard-no-mask.test.ts` (95 tests — 41-term PASS set × validateOutput + screen, the 3 incident pins, 9 UNSAFE hard-blocks, the advisory-flag-without-mask pin, the SAFE_ABSTAIN_MESSAGE bilingual + self-screen pins); `src/__tests__/lib/ai/workflows/legacy-workflows-no-mask.test.ts` (6 tests — explain/revision/doubt-solve × {safe→original, unsafe→SAFE_ABSTAIN_MESSAGE}) | E | P12, P7 |

### Invariants covered by this section

- P12 (AI safety — BOTH directions). The BLOCK set proves genuinely unsafe
  content is still hard-refused by the word-boundary `screenStudentFacingText`
  backstop; the PASS set proves the coarse substring BLOCKLIST can no longer
  censor legitimate CBSE curriculum — the over-masking regression that shipped
  `***`-mangled lessons to students on the legacy/fallback path is pinned closed.
- P7 (bilingual) — the safe-abstain fallback is EN + Devanagari and re-screens
  clean.

### Catalog total

Pre-REG-241: 207 entries (through REG-240, grounded-answer L2 Redis cache tier).
Adds REG-241 (academic-vocabulary NO-MASK on the legacy/fallback Foxy path —
non-destructive advisory BLOCKLIST + word-boundary `screenStudentFacingText` as
the sole student-facing blocker + serve-original-or-`SAFE_ABSTAIN_MESSAGE` at the
legacy-workflow boundary).
**Total catalog: 208 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-242 — Foxy quota-remaining is DB-authoritative + unlimited-for-paid; no spurious upgrade prompt (P2-adjacent / P11-adjacent) (2026-07-14)

Source: Foxy Phase-0 quota fix. `apps/host/src/app/api/foxy/_lib/quota.ts` now reads
the RPC's real `used_count` column (NOT the never-existent `current_count`) from
`check_and_record_usage` and derives `remaining` against the SAME DB authority the
RPC enforced with, via a `get_plan_limit` call. `_lib/constants.ts` DELETED the
misleading Node-side `DAILY_QUOTA` map (free:10 / starter:30 / pro:100 /
unlimited:999999) and added the `UNLIMITED_QUOTA = 999999` sentinel + a `free`-only
`UPGRADE_PROMPTS` entry. `route.ts` gates the soft upgrade prompt on
`limit < UNLIMITED_QUOTA`. Migration `20260714120000_foxy_unlimited_for_paid_plans.sql`
sets the paid plan codes' `subscription_plans.foxy_chats_per_day = -1` (unlimited;
`get_plan_limit` maps -1 → 999999), leaving `free` finite. `packages/lib/src/usage.ts`
+ `packages/ui/src/foxy/mobile/FoxyToolsSheet.tsx` render "Unlimited" via
`isUnlimitedUsage`.

**Why.** The `check_and_record_usage` return column is `used_count`; the route read
a column named `current_count` that never existed in the return shape, so
`remaining` ALWAYS resolved to the full limit — a wrong countdown. Worse, a stale
Node-side `DAILY_QUOTA` map implied a false local authority the DB never consulted
(enforcement is DB-authoritative: `check_and_record_usage` → `get_plan_limit` →
`subscription_plans.foxy_chats_per_day`). Together they showed paid students a
finite "30 left" / "100 left" countdown and could surface a spurious upgrade
prompt, even though paid plans are entitled to UNLIMITED Foxy chats. The fix makes
both enforcement and the displayed `remaining` DB-authoritative and unlimited-for-paid.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-242 | `foxy_quota_remaining_db_authoritative_unlimited_paid_no_spurious_upgrade` | (a) **No Node-side cap**: the route does NOT pass `p_limit` to `check_and_record_usage` (the RPC derives its own cap); it calls `get_plan_limit` and computes `quotaRemaining = max(0, planLimit − used_count)`, pinned at limit-1 (`used_count=9`, limit 10 → 1), at-limit (`used_count=10` → 0), over-limit clamp (`used_count=15` → 0, never negative), and `allowed:false → HTTP 429` with no LLM call. (b) **Unlimited paid → no upsell**: with `get_plan_limit → 999999` (i.e. `foxy_chats_per_day = -1`) and `used_count=500` on a `pro` plan, `quotaRemaining = 999499` (large, non-negative) and `upgradePrompt` is UNDEFINED. (c) **Prompt gating**: a prompt is shown ONLY when the plan has an `UPGRADE_PROMPTS` entry AND `limit < UNLIMITED_QUOTA` AND `remaining ≤ showAtRemaining` — only the finite `free` tier can nudge; `starter`/`pro`/`unlimited` (and their `basic`/`premium`/`ultimate` aliases via `normalizePlan`) never prompt, even at `remaining 0`. (d) **Client display parity**: `checkDailyUsage`/`getDailyUsageSummary` mirror the DB sentinel — `free` foxy_chat = finite 5; paid tiers (`starter`/`pro`/`unlimited` + `basic`/`premium` aliases + `_monthly`/`_yearly` suffixes) = 999999 → `isUnlimitedUsage` true; `remaining` clamps at 0. (e) **`subscription_plans` contract**: the migration is idempotent (`foxy_chats_per_day IS DISTINCT FROM -1` UPDATE keyed by plan_code) and touches only paid codes (`starter`/`pro`/`unlimited`), leaving `free` finite (verify block WARNs if free went -1). | `src/__tests__/api/foxy/route-characterization.test.ts` (GAP 1 quota-boundary matrix — used_count/get_plan_limit/no-p_limit/unlimited-no-prompt/429); `src/__tests__/lib/usage.test.ts` (unlimited-paid display + alias/suffix normalization + clamp); `src/__tests__/foxy-plan-normalization.test.ts` (UNLIMITED_QUOTA + free-only UPGRADE_PROMPTS + gating parity) | E | P2-adjacent, P11-adjacent, P7 |

### Invariants covered by this section

- P2-adjacent (usage-economy correctness) — the displayed `remaining` is honest
  (derived from the same DB cap the RPC enforced), never negative, and never
  understates a paid plan's unlimited entitlement.
- P11-adjacent (payment entitlement integrity) — the paid-plan Foxy entitlement
  flows from the `subscription_plans` catalog through `get_plan_limit`, not a
  stale Node-side table; the migration changes ONLY the per-day chat entitlement
  (not pricing, subscription status, or payment records), so verified-payment
  gating and atomic status+payment writes are untouched.
- P7 (bilingual) — the free-tier upgrade copy carries EN + Devanagari.

### Catalog total

Pre-REG-242: 208 entries (through REG-241, Foxy legacy-path NO-MASK).
Adds REG-242 (Foxy quota-remaining DB-authoritative correctness — `used_count`
read, `get_plan_limit`-derived remaining, unlimited-for-paid with no spurious
upgrade prompt, and the `subscription_plans` paid=-1 / free-finite contract).
**Total catalog: 209 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-243..REG-246 — Foxy Learning OS Phase 0.2 / 0.3 / 0.4 (durable thread + long-answer integrity + real practice + teach-then-stop) (2026-07-15)

Source: Foxy Learning OS Phase 0.2 (durable conversation thread + Deno bounded
continuation + pending-row hygiene), Phase 0.3 (real gradable practice), Phase 0.4
(teach-then-stop + post-answer action bar). All four behaviors are gated behind
SEPARATE default-OFF feature flags (`ff_foxy_durable_thread_v1`,
`ff_foxy_answer_continuation_v1`, `ff_foxy_real_practice_v1`,
`ff_foxy_learning_actions_v1`; seeds `20260715000000` / `20260715000100` /
`20260715000200` + the existing learning-actions flag) and every entry pins its
own flag-OFF byte-identical path against a mirror/characterization test.

Files: `apps/host/src/app/foxy/_hooks/useFoxyChat.ts`, `apps/host/src/app/foxy/page.tsx`,
`apps/host/src/lib/use-foxy-durable-thread-flag.ts`, `packages/lib/src/use-foxy-durable-thread-flag.ts`,
`apps/host/src/app/api/foxy/_lib/session.ts`, `apps/host/src/app/api/foxy/route.ts`,
`supabase/functions/grounded-answer/{claude.ts,pipeline.ts,_continuation-flag.ts}`,
`packages/lib/src/foxy/{prompt-sections.ts,quiz-me-oracle-gate.ts}`,
`packages/ui/src/foxy/ChatBubble.tsx`.

**Why.** Foxy's context "broke" (students had to re-type the question) because a rapid
second send — or a reload — before the server session frame returned minted a second,
empty session; a topic change silently forked a new thread. Long answers were truncated
at `max_tokens` and the tail was lost to the JSON-rescue net, while empty/pending
assistant rows (from a hard-abstain or a dead LLM call) leaked into cross-session prompt
assembly as empty `[previous · Foxy]` snippets that poisoned later turns. Practice mode
emitted 5 markdown pseudo-MCQs that render as un-answerable text yet claimed "Generated 5
questions" (a fake-action bug). And Foxy re-narrated its own menu of next actions in prose
even though the on-screen action bar already offered them. These four flag-gated fixes
address each, additively and reversibly.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-243 | `foxy_durable_conversation_thread_continuity` | **Client (`useFoxyChat`)**: with `ff_foxy_durable_thread_v1` ON the client mints ONE durable conversation id synchronously (ref-based) so two rapid sends fired before the first resolves carry the SAME `session_id` (the race fix), persisted to BOTH `localStorage.foxy_thread` and the `?c=` URL param; `readStoredThreadId` prefers `?c=` over localStorage then falls back; `adoptConversationId` mirrors id→state+URL+localStorage (reload continuity); `startNewConversation` mints a fresh distinct id. Flag OFF (default) is byte-identical: a send writes NO `foxy_thread`/`?c=`, the first send carries `sessionId:null`, and `startNewConversation` clears the id touching no storage. **Server (`resolveSession`)**: flag ON, the client id is authoritative — an existing row is UPDATEd IN PLACE on a subject/chapter/mode change (same id, no fork, reactivate/idle path never consulted); a well-formed id with no row is INSERTed WITH that id + a `foxy_session_started:<clientId>` event; a `23505` collision with ANOTHER student's id falls back to a server-generated id (never reads/returns the other tenant's row) and warns `foxy.session.thread_id_collision` with `studentId` ONLY (P13); a malformed uuid falls straight through to a server id with no lookup on the bad id. | `apps/host/src/__tests__/foxy/use-foxy-chat.test.ts` (durable-thread describe); `apps/host/src/__tests__/foxy-resolve-session.test.ts` (Phase 0.2 durable-thread describe) | E | P8, P13 |
| REG-244 | `foxy_long_answer_bounded_continuation_and_pending_row_hygiene` | **(a) Bounded ONE-round continuation** (`ff_foxy_answer_continuation_v1`): a Foxy structured turn that stops at `stop_reason='max_tokens'` with the flag ON issues EXACTLY ONE continuation call (2 Claude fetches total, never 3 even if the continuation ALSO truncates); the merged payload is preferred ONLY if it round-trips validation, else it falls back to the EXISTING rescue on the primary — never regress (`structured` always defined, no raw JSON leaks into any paragraph). Flag OFF → NO continuation, byte-identical rescue (1 salvaged block, no `answer` block). A complete `end_turn` answer never fires a continuation (the flag read is short-circuited on the happy path). `stopReason` is normalized for both providers (Anthropic `stop_reason`; OpenAI `finish_reason='length'`→`max_tokens`; absent→`other`, never spuriously `max_tokens`). **(b) Pending-row hygiene**: `loadPriorSessionContext(excludePending=true)` filters pending assistant rows so an empty `[previous · Foxy]` snippet can never leak; `excludePending=false` (default) is byte-identical (pending row still flows); a missing `pending` column → defensive fallback to the legacy unfiltered query + a category-only warn (`foxy_prior_session_pending_filter_failed`, no email/phone/name). On a safety hard-abstain the route UPDATEs the pre-inserted pending assistant row to `SAFE_ABSTAIN_MESSAGE` with `pending=false` (flag ON) / leaves it untouched (flag OFF); the abstain response shape+status (200, `response:''`, `groundingStatus:'hard-abstain'`) is never altered. | `supabase/functions/grounded-answer/__tests__/foxy-answer-continuation.test.ts` + `.../__tests__/claude.test.ts` (Deno, stopReason normalization); `apps/host/src/__tests__/api/foxy/prior-session-context-pending.test.ts`; `apps/host/src/__tests__/api/foxy/foxy-safety-block-pending-cleanup.test.ts` | E | P12, P13 |
| REG-245 | `foxy_real_gradable_practice_oracle_gated_single_binding_anti_fake` | **(`ff_foxy_real_practice_v1`)** EVERY practice mcq is oracle-gated through the SAME machinery that gates `question_bank` inserts (REG-54): `gatePracticeMcqs` runs deterministic P6 checks first (a duplicate-options mcq is dropped with reason `p6_options_not_distinct` and NO LLM call), then the LLM grader, failing CLOSED per mcq on a grader throw (`llm_grader_unavailable`, drops that mcq, never aborts the batch); survivors are capped at `PRACTICE_MCQ_MAX_KEEP` (3) with a bounded oracle-attempt ceiling (LLM-cost cap). **Anti-fake guardrail**: `buildGatedPracticeResponse` rebuilds the turn to contain ONLY oracle-passed `mcq` blocks — any prose ("I generated 5 questions!") is STRIPPED so a turn can never CLAIM questions it didn't emit; returns null when nothing survives → the route serves the graceful bilingual fallback (never an ungated/garbage mcq); title+subject preserved, mcq order preserved, round-trips `FoxyResponseSchema`. **Single evidential binding (served-items invariant)**: the ONE server-held answer key is derived from `kept[0]`, which is the FIRST rendered mcq — so the key grades exactly the question shown, and only one evidential serve happens per turn. Flag OFF → directive selector returns the LEGACY `MODE_DIRECTIVES.practice` (5 pseudo-MCQ paragraphs) byte-identically; flag ON → the interactive `PRACTICE_MCQ_DIRECTIVE` (EXACTLY 3 mcq blocks, mastery-aware/ZPD-bounded difficulty, "do not claim to have created a quiz"); `quiz_me` still wins with `SINGLE_MCQ_DIRECTIVE`. | `apps/host/src/__tests__/lib/foxy/real-practice-gate.test.ts` | E | P6, P1, P2, P3 |
| REG-246 | `foxy_teach_then_stop_meta_offer_suppressed_socratic_check_preserved` | **(`ff_foxy_learning_actions_v1`)** `TEACH_THEN_STOP_DIRECTIVE` bans the ASSISTANT'S own menu of next actions (forbids "Would you like…", "I can give you an example", "Shall I quiz…", "just let me know", "menu of next actions") because the on-screen action bar already offers them, while KEEPING exactly ONE substantive Socratic check-for-understanding question that asks the STUDENT to apply/restate/reason — its shape set by pedagogy mode (CHECK / SCAFFOLD / STRETCH) and never a yes/no "did you understand?". Bilingual (Hindi/Hinglish, technical terms — CBSE/NCERT/Bloom's — in English). It is threaded ONLY through the `mode_directive` channel (via `composeModeDirective`) on prose-teaching turns (mode ≠ practice) when the flag is ON; `quiz_me`/real-practice MCQ shapes still win; flag OFF is byte-identical to the legacy selector for every mode (no teach-then-stop text leaks). `FOXY_SAFETY_RAILS` (P12) and the `buildSystemPrompt` base persona are UNCHANGED — the directive is never baked into the rails/persona (verified for every valid mode). **ChatBubble UI**: flag OFF renders the legacy thumbs/Report bar byte-identically; flag ON renders the learning-action bar (Got it / Explain simpler / Show example / Quiz me + overflow Save/Report) dispatching `got_it`/`explain_simpler`/`show_example`/`quiz_me`/`save`, with NO bar on error-fallback or hard-abstain bubbles, bilingual labels, and ≥44px tap targets. | `apps/host/src/__tests__/api/foxy/teach-then-stop-directive.test.ts`; `apps/host/src/__tests__/foxy/learning-action-chat-bubble.test.tsx` | E | P7, P12 |

### Invariants covered by this section

- P8 (RLS / tenant boundary) — REG-243: a durable client-supplied thread id that
  collides with another student's session (`23505`) NEVER reads or returns the
  other tenant's row; the caller always gets a fresh server-generated id.
- P13 (data privacy) — REG-243 collision warn carries `studentId` only; REG-244's
  pending-filter fallback warn is category-only (no email/phone/name) and the
  safety-abstain audit/response never leaks answer text.
- P12 (AI safety) — REG-244: `structured` is always defined and the bounded
  continuation can only improve, never regress, the existing safety net; REG-246:
  `FOXY_SAFETY_RAILS` + the base persona are byte-identical, and no learning-action
  bar renders on abstain/error surfaces.
- P6 / P1 / P2 / P3 (question quality + scoring/anti-fake integrity) — REG-245:
  every served practice mcq passes the P6 + REG-54 oracle, the single evidential
  key grades exactly the question shown, and a turn can never fabricate a quiz claim.
- P7 (bilingual) — REG-246: the teach-then-stop directive and the action-bar chips
  carry EN + Devanagari, technical terms kept in English.

### Catalog total

Pre-REG-243: 209 entries (through REG-242, Foxy quota-remaining DB-authoritative).
Adds REG-243 (durable conversation-thread continuity — client race fix + server
upsert-by-client-id + cross-tenant 23505 isolation + no-reset-on-topic-change),
REG-244 (long-answer integrity — bounded ONE-round max_tokens continuation +
pending/empty assistant-row hygiene), REG-245 (real gradable practice — oracle-gated
interactive MCQs + single evidential binding + anti-fake guardrail), REG-246
(teach-then-stop — meta-offer suppressed, Socratic check preserved, FOXY_SAFETY_RAILS
unchanged). All four flag-gated default-OFF and byte-identical on the OFF path.
**Total catalog: 213 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-247 — Foxy Perception + event-data-layer: observability-only `learner.turn_classified` + fire-and-forget/fail-safe classifier (flag `ff_foxy_perception_v1`, default OFF) (2026-07-15)

Source: Foxy Intelligent Learning OS, Phase 1C ("Perception classifier"). After
building the reply, `/api/foxy` fires a per-turn PERCEPTION classifier that turns
each tutoring turn into structured, PII-free signal (topic → chapter_concepts uuid,
Bloom level, misconception code, struggle signal, learner intent) and publishes a
`learner.turn_classified` OBSERVABILITY event. The LLM classification runs ONLY on
the Python MOL service (`POST /v1/classify`, cheap gpt-4o-mini evaluation task); the
Node route calls it FIRE-AND-FORGET (a `void`ed async IIFE in the post-response
phase) so the student's answer is returned with ZERO added latency and a classifier
failure can never affect the turn.

Files: `packages/lib/src/ai/clients/python-mol.ts` (Node fail-closed client to the
Python MOL service), `packages/lib/src/foxy/perception.ts` (`classifyTurn` — a PURE
orchestrator around the Python call; parse/validate → codes/ids/enums; reuses the
EXISTING `resolveLeadConceptId` topic resolver + `MISCONCEPTION_CODE_REGEX` ontology
gate; NEVER calls an LLM itself), `apps/host/src/app/api/foxy/route.ts` (post-response
fire-and-forget block), `python/services/ai/api/v1/classify.py` +
`python/services/ai/business/foxy_perception/*` + `python/services/ai/api/main.py`
(the classify endpoint + models/classifier), migration
`20260715130000_seed_ff_foxy_perception_v1.sql` (seeds `ff_foxy_perception_v1`
is_enabled=false / rollout=0). Committed foundation this rests on:
`learner.turn_classified` event kind (`packages/lib/src/state/events/registry.ts` +
Deno `supabase/functions/_shared/state-runtime/events-registry.ts`), the journey
projector's `null` mapping (`packages/lib/src/state/journey/journey.ts`), and
`learning_events.student_pk`.

**Why.** Perception is the first "sensor" of the Foxy Learning OS: it must generate
rich in-turn signal WITHOUT ever putting student text on the bus or in logs (P13),
WITHOUT writing any mastery/p_know/error surface (the binding assessment learner-state
contract — P1/P2/P3 must stay byte-identical), and WITHOUT adding any latency or
failure surface to the tutoring turn. It is doubly dark in production: the
`ff_foxy_perception_v1` flag is default-OFF AND the Node client no-ops until
`PYTHON_AI_BASE_URL` is wired in — so even a flipped flag is a no-op without infra.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-247 | `foxy_perception_observability_only_fire_and_forget_pii_free` | **(a) Observability-only — NO mastery write, journey→null, zero subscribers**: `learner.turn_classified` is OBSERVABILITY-ONLY per the binding assessment learner-state contract — the journey projector maps it to `null` (off the timeline, never a milestone) and NO subscriber consumes it (it appears only in the event registry + journey projector, never in `mastery-state-writer` / `concept-mastery-projector` / `scheduled-actions-writer` / any projector), so it can never feed a mastery / p_know / error surface. P1/P2/P3 are byte-identical (perception never scores, awards XP, or runs anti-cheat). **(b) Fire-and-forget + fail-safe (flag OFF / no infra → byte-identical, no publish, no latency)**: the whole step (flag read → Python classify → publish) lives in a single `void`ed post-response async block; the reply is never awaited on it. Flag OFF → `classifyTurn` is NEVER called and NO `learner.turn_classified` is published, and the turn still returns a clean 200 (byte-identical to today). `PYTHON_AI_BASE_URL` empty/unset → `callPythonMol` returns null unconditionally with NO fetch attempted (architect kill switch), so `classifyTurn` returns null and nothing publishes. A null/garbage/non-object Python body, a non-2xx / network error / AbortController timeout, a throwing classifier, or a throwing topic-resolver all resolve to null (or a best-effort classification with `topicId:null`) and NEVER throw / NEVER affect the 200 reply / NEVER publish an invalid event; a missing assistant message id also skips the publish (the registry requires a UUID `messageId`). **(c) P13 — codes/ids/enums only, no student text on the bus or in logs**: the returned `TurnClassification` and the published event payload carry CODES/IDS/ENUMS ONLY (studentId/foxySessionId/messageId/subjectCode/grade/chapterNumber/topicId/bloomLevel/misconceptionCode/struggleSignal/intent) — the student's message text is sent ONLY to the internal Python classifier (same trust boundary as the tutor LLM call) and is never placed on the object, the event, or a log; the event schema strips unknown PII-shaped keys (messageText/email/phone/name) and Bloom is normalized to the canonical LOWERCASE taxonomy; a hallucinated free-text misconception is dropped by the ontology regex; the Node client + route log status/enums/booleans only. **(d) Node↔Deno registry parity (CI-enforced)**: `learner.turn_classified` is present in BOTH the Node event registry and the Deno mirror (`extractDenoAllEventKinds` + `extractDenoLiteralKinds`), pinned by the Deno-parity suite. **(e) Python classify contract**: the `/v1/classify` models + classifier + endpoint accept a scoped body and return the snake_case classification shape (33 Python tests: 9 models + 19 classifier + 5 integration). | `apps/host/src/__tests__/api/foxy/perception.test.ts` (classifyTurn orchestration + validation + fail-safe + P13); `apps/host/src/__tests__/api/foxy/python-mol-client.test.ts` (fail-closed client — empty `PYTHON_AI_BASE_URL`→null/no-fetch, header forwarding, non-2xx/network/timeout→null); `apps/host/src/__tests__/api/foxy/perception-fire-and-forget.test.ts` (route wiring — flag ON publishes, flag OFF byte-identical, null/throwing classifier no-op, P13 payload); `apps/host/src/__tests__/state/events-registry-turn-classified.test.ts` (schema codes/ids/enums-only + P5 grade-string + P13 key-stripping); `apps/host/src/__tests__/state/events-registry-deno-parity.test.ts` (Node↔Deno parity); `python/tests/unit/test_foxy_perception_models.py`, `python/tests/unit/test_foxy_perception_classifier.py`, `python/tests/integration/test_classify_endpoint.py` | E | P13, P12, P5, P1/P2/P3 (untouched — observability-only) |

### Invariants covered by this section

- P13 (data privacy) — the raw turn text is sent ONLY to the internal Python
  classifier; the returned `TurnClassification`, the `learner.turn_classified`
  event payload, and every Node/route log carry codes/ids/enums ONLY. The event
  schema strips unknown PII-shaped keys, and a hallucinated free-text misconception
  is dropped by the ontology regex before it can be emitted.
- P12 (AI safety) — classification is internal (CBSE-scoped, age-appropriate by the
  Python classifier's prompt + model) and publishes NOTHING to students; it is a
  pure post-response observability telemetry step, doubly dark (flag OFF +
  `PYTHON_AI_BASE_URL` unset) until deliberately enabled.
- P5 (grade format) — the event schema requires a grade STRING "6".."12" (integer /
  out-of-range grades rejected).
- P1 / P2 / P3 (scoring / XP / anti-cheat) — UNTOUCHED. `learner.turn_classified`
  is observability-only: journey→null, zero subscribers, no mastery write. Flag OFF
  and no-infra paths render `/api/foxy` byte-identical to today with no added latency.

### Catalog total

Pre-REG-247: 213 entries (through REG-243..REG-246, Foxy Learning OS Phase 0.2/0.3/0.4).
Adds REG-247 (Foxy Perception + event-data-layer — `learner.turn_classified`
observability-only [journey→null, zero subscribers, no mastery write] + fire-and-forget/
fail-safe classifier [flag OFF or empty `PYTHON_AI_BASE_URL` → byte-identical, no
publish, no added latency] + P13 codes/ids/enums-only + CI-enforced Node↔Deno registry
parity; flag `ff_foxy_perception_v1`, default OFF).
**Total catalog: 214 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-252 — unconditional, FLAG-INDEPENDENT anti-fake-quiz-claim backstop: Foxy never ships "Generated N quiz questions." with no questions (2026-07-15)

Source: Foxy "fake action" fix. A quiz/practice turn could surface the
student-facing sentence "Generated 5 quiz questions." while the actual validated
questions lived in `metadata.questions` — which the legacy persist path drops.
The student saw a CLAIM of a quiz with ZERO questions to answer. REG-245 closed
this ONLY on the flag-ON real-practice oracle path (`ff_foxy_real_practice_v1`);
this entry pins the NEW UNCONDITIONAL backstop that runs on the flag-OFF / legacy
paths regardless of ANY feature flag. Assessment gave APPROVE-WITH-CONDITIONS on
the fix; these tests are the conditions.

Files: `packages/lib/src/foxy/anti-fake-quiz-claim.ts` (`stripFakeQuizClaim(text)
→ {claimOnly, text}` + `QUIZ_CLAIM_FALLBACK_TEXT` — pure, deterministic,
never-throws detector: `claimOnly` is true only when the text matches a
"generated/created/prepared/here-are N questions"-style claim [EN + Hindi/
Devanagari, danda-aware] AND carries < 3 MCQ option markers [`A)`/`(a)`/`1.`] AND
< 2 question marks), `packages/lib/src/ai/workflows/quiz-generate.ts`
(`renderQuizQuestionsText()` renders real `QuizQuestion[]` — bilingual header, 4
lettered options, inline `Answers / उत्तर` key — or returns `QUIZ_CLAIM_FALLBACK_TEXT`
when 0 survive P6 validation; assessment fixed the n===1 singular grammar),
`apps/host/src/app/api/foxy/_lib/legacy-flow.ts` (`persistLegacyFoxyResponse`
strips a claim-only turn to the bilingual fallback in BOTH the wire `response` and
the persisted `foxy_chat_messages.content`, flag-independent — the one gate BOTH
legacy call sites flow through), `apps/host/src/app/api/foxy/route.ts` (new
`else if (isPracticeTurn)` branch ~:2380 strips a claim-only flag-OFF practice turn
→ `buildQuizMeFallbackResponse(subject)`).

**Why.** A tutor asserting it did something it did NOT surface is a "fake action":
it erodes trust and, for a quiz, means the student is handed a phantom
assessment (P6 "question quality" — a served quiz turn must actually carry
answerable questions; P1-adjacent — a claimed-but-absent quiz cannot be graded).
The fix is DEFENSE-IN-DEPTH across 4 layers so a claim-with-no-questions can never
reach a student on ANY path: (1) the render layer never emits a bare claim, (2)
the legacy persist gate strips it, (3) the flag-OFF practice route branch strips
it, (4) the pure detector under all three is EN+Hindi and passes real questions
through untouched. The fallback (`QUIZ_CLAIM_FALLBACK_TEXT`) is bilingual (P7).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-252 | `foxy_unconditional_anti_fake_quiz_claim_backstop_flag_independent` | **(a) Pure detector** (`stripFakeQuizClaim`): EN "Generated 5 quiz questions." (and "I have created a quiz with 5 questions") with no options → `claimOnly:true`, `text === QUIZ_CLAIM_FALLBACK_TEXT`; the SAME "Here are N questions" claim BACKED by real A)/B)/C)/D) options → `claimOnly:false`, passes through byte-identical; Hindi "5 प्रश्न बनाए।" (danda-aware) claim-only → stripped; normal teaching prose → not stripped; empty/whitespace/non-string (undefined/null/number) → defensively `claimOnly:false`, never throws; `QUIZ_CLAIM_FALLBACK_TEXT` is bilingual (EN + Devanagari) and self-stable (feeding it back → `claimOnly:false`, no strip loop). **Two INTENTIONAL narrow false-positive boundaries assessment flagged, PINNED as documented:** a claim + exactly TWO numbered imperative questions with no "?" (2 option markers < the 3-marker floor) is STILL stripped; a Hindi claim + Devanagari-lettered options (क)/ख)/ग)/घ), which the Latin-only `[A-Da-d1-4]` evidence detector doesn't recognize) is STILL stripped — over-stripping here is strictly safer than shipping a phantom quiz, and pinning them makes any future widening of the evidence detector a deliberate reviewed change. **(b) Render/workflow** (`renderQuizQuestionsText` via `runQuizGenerateWorkflow`, real `validateQuizQuestions`): a validated multi-question set renders REAL questions (bilingual plural header "Here are 4 practice questions" + "(4 अभ्यास प्रश्न", 4 lettered options, "Answers / उत्तर:" key) that passes the backstop (`claimOnly:false`) and is never a bare "Generated N" claim; the n===1 degraded path (1 survives P6) renders SINGULAR grammar ("Here is 1 practice question … attempt it … check the answer below", no plural leak, "(1 अभ्यास प्रश्न"); 0 survivors → `response === QUIZ_CLAIM_FALLBACK_TEXT` with `metadata.questions` empty and `validationErrors` non-empty. **(c) Legacy persist** (`persistLegacyFoxyResponse`, flag-independent): a claim-only `legacy.response` → the returned wire `response` AND the persisted `foxy_chat_messages.content` assistant row are BOTH `QUIZ_CLAIM_FALLBACK_TEXT` (never the claim); a real-question turn (A)/B)/C)/D)) passes through UNTOUCHED in both surfaces; NO feature flag is consulted on this path (`isFeatureEnabled` never called). **(d) Route flag-OFF practice branch** (`else if (isPracticeTurn)`, mirrored with the real `denormalizeFoxyResponse` + `stripFakeQuizClaim` + `buildQuizMeFallbackResponse`): a claim-only STRUCTURED turn AND a claim-only GROUNDED answer (structured null) are both swapped for `buildQuizMeFallbackResponse(subject)` (mcq-free, `FoxyResponseSchema`-valid, bilingual EN+Hinglish, and itself not a claim); a real practice structured turn (claim paragraph + 3 real mcq blocks → denormalizes with A)…D) markers) passes through UNTOUCHED (same payload reference flows on). | `apps/host/src/__tests__/lib/foxy/anti-fake-quiz-claim.test.ts` (detector unit + the 2 intentional-FP boundary pins + fallback bilingual/self-stable); `apps/host/src/__tests__/lib/ai/workflows/quiz-generate-anti-fake-render.test.ts` (multi-question real render + n===1 singular grammar + 0-survivors fallback); `apps/host/src/__tests__/api/foxy/legacy-flow-anti-fake.test.ts` (wire+persisted content both fallback, real-turn passthrough, flag-independence); `apps/host/src/__tests__/api/foxy/foxy-practice-flag-off-anti-fake.test.ts` (route branch — structured+grounded claim-only → fallback, real (A)-(D) turn passthrough) | E | P6, P1-adjacent, P7 |

### Invariants covered by this section

- P6 (question quality) — a served quiz/practice turn must actually CARRY
  answerable questions. The backstop guarantees a "Generated N questions." claim
  with no rendered questions is replaced by a graceful fallback on EVERY
  non-oracle path (render, legacy persist, flag-OFF practice route branch), so a
  phantom quiz can never reach a student. REG-245 covers the flag-ON oracle path;
  REG-252 covers the unconditional flag-independent backstop underneath it.
- P1-adjacent (score accuracy) — a claimed-but-absent quiz cannot be graded; by
  refusing to surface a phantom quiz the platform never presents an ungradable
  "assessment" to a student.
- P7 (bilingual) — `QUIZ_CLAIM_FALLBACK_TEXT` (EN + Devanagari) and the route's
  `buildQuizMeFallbackResponse` (EN + Hinglish CTA) are both bilingual, and the
  n===1 render preserves correct singular grammar in both EN and Hindi.

### Catalog total

Pre-REG-252: 218 entries (through REG-251, RBI pre-debit notice audit-evidence).
Adds REG-252 (unconditional flag-independent anti-fake-quiz-claim backstop — the
4-layer defense [pure EN+Hindi detector + real-question render + legacy-persist
strip in wire+persisted content + flag-OFF practice route branch] that guarantees
Foxy never ships a "Generated N quiz questions." claim with no questions, plus the
two intentional narrow false-positive boundaries assessment flagged; complements
REG-245's flag-ON oracle path).
**Total catalog: 219 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-253 — Foxy Mermaid diagram block (Wave 2): drawable structured block, grammar-allowlist + XSS-reject validation, lazy strict renderer, ASCII-ban directive flag-gated by `ff_foxy_diagrams_v1` (2026-07-15)

Source: Foxy Pedagogy Wave 2 "real diagrams, never text-art". Foxy used to "draw"
diagrams as ASCII / box-drawing text-art inside paragraph/step text — unreadable
on a 4G phone and un-teacherly. Wave 2 adds a NEW drawable structured block
`{ type:'mermaid', code:string(1..2000), title?:string(<=120) }` that renders as a
real, colorful SVG diagram, plus a flag-gated prompt directive that BANS ASCII art
and routes each visual need to the right block (drawable → `mermaid`, real figure →
`diagram` retrieval, equation → `math`). The ai-engineer added the schema/prompt
(prompt parity already green) and the frontend added the renderer; neither had
dedicated mermaid tests. This entry pins the block end-to-end.

Files under test: `packages/lib/src/foxy/schema.ts` (`mermaid` block in
`FoxyBlockSchema`/`FoxyResponseSchema` superRefine + `validateMermaidCode` +
`MERMAID_ALLOWED_HEADERS` [13 headers] + `isFoxyMermaidBlock`/`FoxyMermaidBlock`),
`supabase/functions/grounded-answer/structured-schema.ts` (Deno mirror
`validateFoxyResponse` + `denormalizeFoxyResponse`),
`packages/lib/src/foxy/denormalize.ts` (Node denormalize → title or "[diagram]",
never raw source), `packages/ui/src/foxy/FoxyStructuredRenderer.tsx` (`MermaidBlock`
— lazy `import('mermaid')`, `securityLevel:'strict'`, `mermaid.parse(code,
{suppressErrors:true})` guard, loading/ready/error states, bilingual
`chrome.diagramFailed`/`diagramLoading`), `packages/lib/src/foxy/prompt-sections.ts`
(`DIAGRAM_DIRECTIVE` + `composeModeDirective`), `apps/host/src/app/api/foxy/route.ts`
(mode_directive selector; diagram flag read scoped to `mode !== 'practice'`).

**Why.** The `mermaid` block is the ONLY structured block whose `code` is a diagram
PROGRAM a client renderer executes, so it needs two independent gates: (1) a hard
grammar-allowlist + XSS-reject at the schema layer (an unknown/hostile diagram type,
`<script`, `javascript:`, a line-anchored `click ` interaction callback, or a
`%%{init ...}` override of `htmlLabels`/`securityLevel` is REJECTED before it can
reach a renderer — P6 output quality + P12 AI safety), and (2) a lazy, strict
renderer (mermaid pulled via dynamic `import()` so it never enters the shared/first-
load bundle — P10; run with `securityLevel:'strict'` and `parse`-guarded so a bad
spec degrades to a quiet bilingual note — P7/P12, never a thrown exception or raw
diagram source shown to a student). The ASCII-ban `DIAGRAM_DIRECTIVE` is additive
and flag-gated (`ff_foxy_diagrams_v1`, default OFF): flag OFF → mode_directive is
byte-identical to today; the directive lives OUTSIDE the parity-locked
`FOXY_STRUCTURED_OUTPUT_PROMPT` and outside `FOXY_SAFETY_RAILS`.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-253 | `foxy_mermaid_block_grammar_allowlist_xss_reject_lazy_strict_renderer_ascii_ban_flag_gated` | **(a) Schema accept/reject matrix** (`FoxyBlockSchema`/`FoxyResponseSchema` + `validateMermaidCode` + `isFoxyMermaidBlock`): a valid mermaid block of EACH of the 13 allowlisted headers (flowchart/graph/sequenceDiagram/classDiagram/stateDiagram/stateDiagram-v2/erDiagram/mindmap/pie/timeline/journey/quadrantChart/gitGraph) is accepted (with/without title, Hindi labels, benign `%%{init theme}`, a `[Click here]` LABEL that is NOT a line-anchored callback, code at the 2000 cap, title at the 120 cap); REJECTS empty/whitespace/oversize(>2000) code, a non-allowlisted first token, `<script`, `javascript:`, a line-anchored `click ` callback, `%%{init ... htmlLabels}` and `... securityLevel` overrides, title>120, `text`/`latex`/mcq-fields on a mermaid block, and `code`/`title` on a non-mermaid (paragraph/math) block; `isFoxyMermaidBlock` narrows a valid block true and returns false for empty/absent code or a non-mermaid block. The Deno mirror `validateFoxyResponse` re-runs the same accept + mermaid-specific reject matrix and AGREES (allowlist + `<script`/`javascript:`/`click`/`%%{init}` + text/latex-on-mermaid + oversize). **KNOWN, PINNED Node↔Deno drift (reported to ai-engineer):** the Deno mirror does NOT forbid mermaid-only fields (`code`/`title`) on a non-mermaid block while Zod does — inert at render time (only mermaid-typed blocks reach MermaidBlock), pinned so a future mirror fix flips the pin. **(b) Denormalize** (Node `denormalizeFoxyResponse` + Deno mirror): a mermaid block WITH a title → the legacy TEXT line is the title verbatim; WITHOUT a title (or whitespace-only) → the literal "[diagram]"; NEVER the raw mermaid `code` (no `flowchart`/`Evaporation`/source leak into the resume TEXT column). **(c) Renderer smoke** (`MermaidBlock` via `FoxyStructuredRenderer`, dynamic `import('mermaid')` mocked): valid code → loading (`Drawing diagram…`) then ready — the SVG returned by `mermaid.render` is injected, `role="img"` aria-label = title (or the generic "Diagram" label), title becomes the figcaption, render called with the exact validated code; `parse` returns false → 'error' shows the bilingual `diagramFailed` fallback (EN "Diagram couldn't be drawn"; Hindi "डायग्राम नहीं बन पाया" under `isHi`, no EN leak) and `render` is NOT called; empty code → error WITHOUT loading mermaid (`parse`/`render` never called); a mermaid block missing `code` routes through the guard's null branch → safe fallback, never throws, the rest of the renderer (response title) is unharmed; a `render()` throw also degrades to the error fallback. **(d) Flag gate** (`ff_foxy_diagrams_v1`, mode_directive selector mirror): flag OFF → mode_directive is BYTE-IDENTICAL to the pre-Wave-2 selector for every mode (with learning-actions flag both OFF and ON), no `DIAGRAM DIRECTIVE` marker leaks; flag ON on a prose-teaching turn (learn/explain/revise/doubt/homework/explorer) → `DIAGRAM_DIRECTIVE` is injected (verbatim when learning-actions OFF; composed `TEACH_THEN_STOP_DIRECTIVE\n\nDIAGRAM_DIRECTIVE` when both ON); a `practice` turn / `quiz_me` / real-practice NEVER get the directive (MCQ shapes win, and the route skips the flag read on practice); `DIAGRAM_DIRECTIVE` bans ASCII/text-art, routes to mermaid/diagram/math blocks, lists the 13 headers, states the 1..2000 bound, forbids `<script`/`javascript:`/`click`/`%%{init`, is bilingual (Hindi/Hinglish/CBSE), and is NOT baked into `FOXY_STRUCTURED_OUTPUT_PROMPT` / `FOXY_SAFETY_RAILS` / the `buildSystemPrompt` base persona for any mode. | `apps/host/src/__tests__/lib/foxy/mermaid-schema.test.ts` (schema accept/reject matrix + guard + `validateMermaidCode` + Deno mirror parity + pinned drift); `apps/host/src/__tests__/lib/foxy/mermaid-denormalize.test.ts` (Node + Deno denormalize → title/"[diagram]", never raw source); `apps/host/src/__tests__/foxy/mermaid-block.test.tsx` (renderer smoke — loading/ready/error, bilingual fallback, guard null-safety); `apps/host/src/__tests__/api/foxy/diagram-directive.test.ts` (flag gate — byte-identical OFF, injected ON, practice/quiz_me/real-practice unaffected, directive content + parity-lock exclusion) | E | P6, P12, P7 |

### Invariants covered by this section

- P6 (question/output quality) — the drawable `mermaid` block passes a hard
  grammar-allowlist (first token must be one of 13 diagram headers) + XSS/interaction
  reject (`<script`/`javascript:`/line-anchored `click `/`%%{init}` override) at the
  schema layer, so a malformed or hostile diagram program is never served.
- P12 (AI safety) — defense-in-depth: the schema gate refuses hostile constructs
  regardless, AND the renderer runs mermaid lazily with `securityLevel:'strict'` and
  a `parse`-guard, degrading a bad spec to a quiet note rather than executing it or
  showing raw diagram source. The ASCII-ban `DIAGRAM_DIRECTIVE` is additive and
  flag-gated (default OFF) and never mutates the parity-locked prompt or safety rails.
- P7 (bilingual) — the renderer's `diagramLoading`/`diagramFailed` chrome and the
  `DIAGRAM_DIRECTIVE` label guidance are bilingual (EN + Devanagari), technical terms
  (CBSE/NCERT/Bloom's) untranslated.

### Catalog total

Pre-REG-253: 219 entries (through REG-252, unconditional anti-fake-quiz-claim backstop).
Adds REG-253 (Foxy Mermaid diagram block — drawable structured block with
grammar-allowlist + XSS-reject validation [Node Zod + Deno mirror], title/"[diagram]"
denormalize that never leaks raw source, lazy strict `securityLevel:'strict'` renderer
with bilingual failure fallback, and the ASCII-ban `DIAGRAM_DIRECTIVE` flag-gated by
`ff_foxy_diagrams_v1` [byte-identical when OFF]; documents one pinned Node↔Deno mirror
parity gap on mermaid-only-fields-on-other-blocks reported to ai-engineer).
**Total catalog: 220 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-254 — Foxy Perception keyless Cloud Run invoker-token mint (Vercel-OIDC → GCP Workload Identity Federation): fail-closed/dormant, header separation, P13 no-token-in-logs (2026-07-15)

Source: Foxy Perception (Phase 1C) armed-auth follow-up. The Python MOL
classifier now runs on Cloud Run with Invoker IAM enforced, so the Next.js-side
Node client `packages/lib/src/ai/clients/python-mol.ts` must attach a
Google-signed ID token (aud = the service URL) in `X-Serverless-Authorization`.
architect added a KEYLESS mint — Vercel OIDC → Google STS (Workload Identity
Federation) → SA impersonation → `iamcredentials:generateIdToken` — with no JSON
service-account key on Vercel. It is ADDITIVE and gated on four NON-SECRET env
vars (`GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`,
`GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`). This
is the P14 testing-review condition on that auth change: before REG-254 only the
DORMANT path was covered (empty `PYTHON_AI_BASE_URL` / no GCP_* → null, no
fetch); the ARMED path was untested.

Files under test: `packages/lib/src/ai/clients/python-mol.ts` (`callPythonMol` +
the internal `readGcpWifConfig`/`mintCloudRunIdToken` — the four-var arm gate,
`await import()` of `@vercel/oidc` + `google-auth-library` on the armed path
ONLY, `ExternalAccountClient.fromJSON` STS/impersonation, explicit
`generateIdToken` second hop, the independent `MINT_TIMEOUT_MS` (3s) race, and
the `X-Serverless-Authorization` vs `Authorization` header separation).

**Why.** The target service enforces Invoker IAM, so an unauthenticated request
is a hard 403 — but perception is fire-and-forget best-effort, so a mint that
cannot run must degrade to a silent no-op, NEVER a throw and NEVER an
unauthenticated call. Three failure surfaces are load-bearing: (1) running
off-Vercel (e.g. the DEFERRED AWS ECS path) where `getVercelOidcToken` throws /
the OIDC header is absent; (2) STS/impersonation or `generateIdToken` non-2xx;
(3) a slow Google auth hop that must be bounded independently of the request
timeout. All three must return `null` with no fetch. The student JWT in
`Authorization` must be byte-for-byte untouched (the Google token rides a
SEPARATE header). P13: a mint failure must log a static scope code + path only —
never the token, the request body, or the failure detail. And the dormant path
(GCP_* absent) must be byte-identical to before — the heavy deps must never be
dynamic-imported, so they can never enter the dormant path, the existing tests,
or any client bundle (P10).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-254 | `foxy_python_mol_keyless_wif_invoker_mint_fail_closed_header_separation_p13` | **(a) Armed happy path**: with `PYTHON_AI_BASE_URL`-equivalent (`baseUrlOverride`) set AND all four `GCP_*` present, `getVercelOidcToken` resolves + `ExternalAccountClient.fromJSON` returns a client whose `request` (the explicit `generateIdToken` hop) resolves `{data:{token}}` → the SINGLE outbound `fetch` carries BOTH `X-Serverless-Authorization: Bearer <idToken>` AND the UNTOUCHED student `Authorization: Bearer student-jwt`; the `audience` passed to `generateIdToken` == the service ORIGIN (`https://py.example.com`, derived via `new URL(baseUrl).origin`, NOT base+path), the hop URL contains `:generateIdToken`, and the Vercel-OIDC subject-token supplier is actually consumed. **(b) Fail-closed — OIDC absent** (simulates off-Vercel/AWS ECS where `getVercelOidcToken` throws): `callPythonMol` returns `null`, NEVER throws, and NO `fetch` is sent to Cloud Run. **(c) Fail-closed — STS/impersonation or generateIdToken rejects (non-2xx)** → `null`, no fetch; **and generateIdToken 2xx but empty/absent token** → `null`, no fetch. **(d) Fail-closed — mint timeout**: the `generateIdToken` hop hangs → only the mint's internal 3s `MINT_TIMEOUT_MS` race can settle (fake timers advance 3000ms) → `null`, never throws, no fetch. **(e) Dormant unchanged**: `GCP_*` absent → the mint block is skipped, NO dynamic import is attempted (`getVercelOidcToken` and `ExternalAccountClient.fromJSON` mocks are never called), NO `X-Serverless-Authorization` header is set, and the student `Authorization` is forwarded — byte-identical to the pre-change legacy behavior (keeps the existing 7 dormant/forwarding/fail-safe tests green). **(f) P13**: on a mint failure whose thrown reason carries token- and body-shaped secrets, only `logger.warn('python_mol.mint_unavailable', { path })` is emitted — the aggregate of ALL logger calls (info/warn/error/debug) contains neither the leaked token string, the student body note, nor the student JWT. | `apps/host/src/__tests__/api/foxy/python-mol-client.test.ts` (dormant suite [pre-existing 7] + `keyless WIF Cloud Run invoker mint (REG-254)` describe: armed happy-path header-separation + aud=origin, OIDC-absent, STS/generateIdToken reject, empty-token, mint-timeout via fake timers, P13 no-token/body-in-logs, and the dormant no-dynamic-import pin) | E | P13, P12, P9-adjacent (Invoker-IAM fail-closed), P10 (armed deps dynamic-imported only) |

### Invariants covered by this section

- P13 (data privacy) — a mint failure logs a STATIC scope code + non-PII path
  only; the token, the request body, and the raw failure detail never reach the
  logger (asserted over the union of all four logger levels).
- P12 (AI safety, fail-closed posture) — a down/absent/slow Google auth hop, an
  off-Vercel runtime, or an Invoker-IAM-enforced service the client cannot
  authenticate to is a SILENT no-op (`null`, no fetch), never a degraded turn
  and never an unauthenticated request; the whole mint is bounded by an
  independent 3s timeout so it can never wedge perception.
- Header separation — the Google-signed Cloud Run invoker token rides
  `X-Serverless-Authorization`; the student Supabase JWT on `Authorization` is
  byte-for-byte untouched, so the Python service still runs its own
  `require_active_student` verification on the real student identity.
- P10 (bundle budget) — `@vercel/oidc` + `google-auth-library` are
  `await import()`-ed on the armed path ONLY; the dormant path never touches
  them (pinned by the "no dynamic import attempted" assertion), so they cannot
  enter the dormant path or any client bundle.

### Catalog total

Pre-REG-254: 220 entries (through REG-253, Foxy Mermaid diagram block).
Adds REG-254 (Foxy Perception keyless Vercel-OIDC → GCP-WIF Cloud Run
invoker-token mint — armed happy-path header separation [`X-Serverless-
Authorization` vs untouched `Authorization`] + aud=service-origin, fail-closed on
OIDC-absent / STS+generateIdToken failure / empty-token / mint-timeout, dormant
no-dynamic-import byte-identity, and P13 no-token/body-in-logs).
**Total catalog: 221 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-255 — quiz-generator RAG retrieval single-source pin: unified `_shared/rag/retrieve.ts` only (deprecated `_shared/retrieval.ts` banned) + selectRAGQuestions P6 dormancy tombstone (2026-07-15)

Static import-contract canary on the 2026-07-15 quiz-generator RAG
consolidation. quiz-generator previously imported `retrieveChunks` from the
deprecated `_shared/retrieval.ts`, whose primary RPC `match_rag_chunks_v2` was
never applied to production — the Q&A source silently degraded to the legacy
`match_rag_chunks` fallback (no Q&A columns) and yielded zero questions.

Pins: (1) no import of `_shared/retrieval.ts` anywhere under
`supabase/functions/quiz-generator/`; (2) `index.ts` consumes only the local
adapter `./retrieval.ts` → unified `retrieve()` with caller `'quiz-generator'`,
rerank false; (3) qa-only TS filter (`question_text` present,
`content_type !== 'qa'` dropped) compensating for the missing `contentType`
passthrough; (4) adapter never-throws (`{chunks: [], error}` degradation);
(5) `selectRAGQuestions()` call site stays commented out — RAG Q&A rows carry
options `'[]'` / `correct_answer_index` 0, so re-enabling without a non-MCQ
`question_mode` gate violates P6; re-enablement requires assessment-approved
grading oracle (or oracle-gated QA→MCQ transform) + full quiz-generation review
chain (ai-engineer, assessment, testing).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-255 | `quiz_generator_rag_single_source_pin_and_selectRAGQuestions_p6_dormancy` | (1) No file under `supabase/functions/quiz-generator/` imports the deprecated `_shared/retrieval.ts`; (2) `index.ts` consumes only the local adapter `./retrieval.ts`, which delegates to the unified `_shared/rag/retrieve.ts` `retrieve()` with caller `'quiz-generator'` and rerank false; (3) the qa-only TS filter drops chunks without `question_text` / with `content_type !== 'qa'`; (4) the adapter never throws — retrieval failure degrades to `{chunks: [], error}`; (5) the `selectRAGQuestions()` call site remains commented out (P6 dormancy tombstone). | `apps/host/src/__tests__/edge-functions/quiz-generator-rag-consolidation.test.ts` (7 tests) | E | P6, P12-adjacent; REG-50/REG-140-adjacent |

### Invariants covered by this section

- P6 (question quality) — the dormant `selectRAGQuestions()` tombstone pins that
  RAG Q&A rows (options `'[]'`, `correct_answer_index` 0) cannot re-enter the
  MCQ quiz path without a non-MCQ `question_mode` gate and an
  assessment-approved grading oracle; the qa-only filter keeps non-Q&A chunks
  from feeding P6-violating rows upstream.
- P12-adjacent (single audited retrieval path for AI content) — quiz-generator
  retrieval flows only through the unified `retrieve()` with caller
  attribution; the deprecated silent-zero path cannot be reintroduced without
  failing this canary. REG-50/REG-140-adjacent (unified retrieval contract).

### Catalog total

Pre-REG-255: 221 entries (through REG-254, Foxy Perception keyless WIF Cloud
Run invoker-token mint).
Adds REG-255 (quiz-generator RAG retrieval single-source pin — unified
`_shared/rag/retrieve.ts` only via the local adapter with caller attribution +
rerank false, deprecated `_shared/retrieval.ts` banned under quiz-generator/,
qa-only TS filter, adapter never-throws degradation, and the
`selectRAGQuestions()` P6 dormancy tombstone).
**Total catalog: 222 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-257 — Foxy undelimited-LaTeX math normalization — explicit-command-triggered render-time correction + production canary-corpus immutability (2026-07-16)

Source: math-format #1 (2026-07 production screenshots). The Foxy model
sometimes emits inline math WITHOUT the required delimiters — e.g.
`Example: (\frac{14}{15} \times \frac{25}{42})` instead of
`\(\frac{14}{15} \times \frac{25}{42}\)` — so students saw raw LaTeX. The fix
is a PURE render-time post-pass (`packages/ui/src/foxy/math-normalization.ts`:
`containsAllowlistedMathCommand` trigger predicate + `splitUndelimitedMath` +
`normalizeMathSegments`), wired into `InlineContent` in
`packages/ui/src/foxy/FoxyStructuredRenderer.tsx` as
`normalizeMathSegments(tokenizeInline(text))`.

**Why this is a regression pin.** The pass runs over EVERY text span Foxy
renders, so the binding CEO constraint is a NEGATIVE one: **no non-math
production message may be altered by the pass.** The trigger fires ONLY on an
explicit allowlisted backslash LaTeX command with a word boundary (`\frac`
yes, `\franchise` never); bare `^`, `_`, `$`, brackets, `°`/`∠`/`÷`/`₹`
symbols, ASCII-art underscores, and Devanagari prose must NEVER trigger it.
The canary corpus (`apps/host/src/__tests__/fixtures/foxy-math-canary-corpus.json`
— real sanitized production Foxy messages, P13: `{ provenance, math: [16],
nonMath: [25] }`; `nonMath` contains zero backslashes by construction) pins
that constraint against production reality, and iterates the fixture so
future corpus additions are covered automatically. If a nonMath excerpt is
ever altered, that is a REAL defect in the trigger — fix the pass, never the
fixture.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-257a | `undelimited_math_normalization_trigger_span_acceptance_failsafe` | (1) TRIGGER: fires only on allowlisted backslash commands with a word boundary; NEVER on bare `^`/`_`/`$`/brackets (`snake_case_name`, `x^2 …`, `price is $5`, `array[i]_index`) or non-allowlisted commands (`\franchise`/`\fraction`/`\lefty`). (2) SPAN: paren pseudo-delimiters stripped; maximal contiguous math run captured; adjacent prose/bare numbers/trailing sentence punctuation never swallowed; `(a+b)(c+d)`-style non-wrapping parens preserved. (3) ACCEPTANCE: the 5 exact production screenshot strings (incl. `(\frac{14}{15} \times \frac{25}{42})`) render `.katex` + `.mfrac` stacked fractions with zero `<code>` fallback, no raw `\frac`/`\times` in visible text, prose byte-exact — across paragraph/example/step/answer/exam_tip/definition/question/mcq blocks; code blocks stay raw. (4) BYTE-IDENTITY: properly-delimited math (`\(..\)`, `$..$`, `$$..$$`, `\[..\]`) and command-free prose pass through reference-equal. (5) FAIL-SAFE (P12): a malformed undelimited span (`\frac{1}{`) degrades to the existing `<code>` fallback — never throws, never blanks the chat. | `apps/host/src/__tests__/foxy/undelimited-math-normalization.test.tsx` (39 tests) | E | P12, P6-adjacent, P7-neutral (no user-facing strings) |
| REG-257b | `math_canary_corpus_nonmath_immutability_and_math_detection` | (1) NON-MATH IMMUTABILITY (the load-bearing pin): for EVERY `nonMath` excerpt — `containsAllowlistedMathCommand(excerpt) === false` AND `normalizeMathSegments(tokenizeInline(excerpt))` returns the ORIGINAL segment array (reference-equal untouched fast-path) with no in-place mutation (deep-equal to an independent tokenization); `splitUndelimitedMath` is likewise a single-text-segment no-op. Iterated over the fixture — future corpus additions are auto-covered. (2) MATH DETECTION: every `math` excerpt yields >=1 math segment through the full pipeline; excerpts carrying an allowlisted command OUTSIDE proper delimiters (>=2 pinned, incl. the named `3.5 \times 100 = 350` and `\frac{1}{4} + \frac{1}{2}` cases) gain strictly MORE math segments while every tokenizer-extracted delimited math segment passes through by object reference; properly-delimited-only excerpts return reference-equal (no double conversion, segment counts stable). (3) FIXTURE INTEGRITY GUARDS: JSON parses into `{ provenance, math[], nonMath[] }` of non-empty strings; provenance records sanitization (P13); size floors >=15 math / >=25 nonMath; every nonMath excerpt contains ZERO backslash characters; the two named undelimited cases remain present — all fail loudly if the fixture is gutted. | `apps/host/src/__tests__/foxy/math-canary-corpus.test.ts` (64 tests) + `apps/host/src/__tests__/fixtures/foxy-math-canary-corpus.json` | E | P12, P13, P6-adjacent |

### Invariants covered by this section

- P12 (AI safety, fail-safe rendering) — the produced math segments render
  through the existing KaTeX path (`throwOnError: false` + `<code>` fallback):
  a bad or malformed undelimited span can degrade but can never throw or blank
  the student chat; the trigger is deliberately narrow (explicit allowlisted
  command only) so model prose can never be mangled into math.
- P13 (data privacy) — the canary corpus is built from sanitized production
  Foxy messages; the provenance string records the sanitization and the test
  pins that record, so an unsanitized fixture swap fails the guard.
- P6-adjacent (display correctness) — served math content must DISPLAY as
  math: the screenshot strings render stacked fractions (`.mfrac`), raw
  LaTeX never leaks to visible text, and already-delimited math is never
  double-converted.
- CEO negative constraint — bare `^`, `_`, `$` never trigger; no non-math
  production message is altered by the pass (reference-equality pinned over
  all 25 real prod nonMath excerpts, auto-extending to corpus additions).

### Catalog total

Pre-REG-257: 223 entries (through REG-256, teacher-skills eval harness pins).
Adds REG-257 (Foxy undelimited-LaTeX math normalization —
explicit-command-triggered render-time correction + production canary-corpus
immutability: screenshot fixture `14/15 × 25/42` renders stacked fractions,
no non-math prod message altered [reference-equal untouched fast-path over
the whole nonMath corpus], bare `^`/`_`/`$` never trigger, delimited math
never double-converted, and loud fixture-integrity guards).
**Total catalog: 224 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-258 — Foxy math-format house style (Wave B): flag-OFF byte-identity, band-uniformity-until-harness-scores, rubric v2 math criteria, seed OFF (2026-07-16)

> **PARTIALLY SUPERSEDED (2026-07-20, canonical-math-rendering change):** pin
> **(c) band uniformity** — `buildMathFormatDirective('6-8') ===
> buildMathFormatDirective('9-12')` under the 2026-07-16 CEO holding
> constraint — is SUPERSEDED by `docs/math-rendering-spec.md` §3 (CEO-approved
> 2026-07-20), which splits THREE bands `'6-8' | '9-10' | '11-12'` with
> distinct density rules. The enforcing suite
> `apps/host/src/__tests__/api/foxy/math-format-directive.test.ts` was
> rewritten to the 3-band contract and is now pinned by **REG-276** (which
> also preserves this entry's pins (a) flag-OFF byte-identity and the
> `buildMathFormatDirective('6-8') === MATH_FORMAT_DIRECTIVE` byte-identity —
> spec §7.2/§8). Pins (b), (d), (e), (f) remain in force unchanged. Do NOT
> re-add the two-band uniformity assertion; history preserved per catalog
> convention.

Source: math-format #2/#3 (Wave B, branch `feat/foxy-math-format-v2`). Wave A
(REG-257) fixed the RENDERER; Wave B improves what the model EMITS.
`MATH_FORMAT_DIRECTIVE` (`packages/lib/src/foxy/prompt-sections.ts`) pins the
CEO-approved house style — worked examples/derivations as numbered "step"
blocks (one transformation each) alternating with display "math" blocks;
tall/stacked math never inline; inline `\( ... \)` properly delimited;
undelimited LaTeX and plain-parentheses pseudo-delimiters banned; bilingual P7
note. Injected via the `mode_directive` channel in
`apps/host/src/app/api/foxy/route.ts` (~:1839) as a THIRD compose, LAST after
teach-then-stop + diagram, ONLY when `ff_foxy_math_format_v2` is ON and the
turn is prose-teaching. The scoring side: `quality-eval.ts` RUBRIC_VERSION
v1→v2 — scaffold_fidelity gains 3 math-format criteria + an explicit
skip-if-no-math instruction (the 4-key judge JSON contract is UNCHANGED).

**Why this is a regression pin.** (1) The flag is seeded OFF: until an
operator flips it, every Foxy prompt must be BYTE-IDENTICAL to the pre-Wave-B
double-composed selector — any drift is a silent prompt change to every
student turn. (2) CEO constraint (2026-07-16): the '6-8' and '9-12' grade
bands return IDENTICAL directive text until the eval harness can score
variants — a premature band divergence would ship an unscored pedagogy change.
(3) The rubric bump re-opens recent messages for v2 scoring; if the criteria
or the 4-key contract drift, the nightly judge harness silently mis-scores.
(4) The seed must keep the REG-125 canonical shape or it walls staging.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-258 | `foxy_math_format_v2_flag_off_byte_identity_band_uniformity_rubric_v2_seed_off` | **(a) Flag-OFF byte-identity** (triple-compose route-selector mirror, kept in sync with route.ts ~:1839): with `ff_foxy_math_format_v2` OFF, the composed `mode_directive` equals the pre-Wave-B double-composed selector (base → teach-then-stop → diagram) for EVERY mode × learning-actions × diagrams flag state (7×2×2), and for quiz_me / real-practice; no `MATH FORMAT DIRECTIVE` marker leaks. **(b) Flag-ON injection, composed LAST**: prose-teaching modes (learn/explain/revise/doubt/homework/explorer) get `MATH_FORMAT_DIRECTIVE` verbatim when other flags are OFF, and the exact `TEACH_THEN_STOP_DIRECTIVE\n\nDIAGRAM_DIRECTIVE\n\nMATH_FORMAT_DIRECTIVE` order when all three are ON (endsWith the math directive); `quiz_me`, real-practice, and legacy `practice` turns NEVER get it (the route skips the flag read on practice). **(c) Band uniformity (CEO 2026-07-16)**: `buildMathFormatDirective('6-8') === buildMathFormatDirective('9-12') === MATH_FORMAT_DIRECTIVE`; `resolveGradeBand` consumes P5 grade STRINGS — "6"/"7"/"8"→'6-8', "9".."12"→'9-12', ""/garbage/"5"/"13"→'6-8'; grade "6" and "12" produce byte-identical directives through the selector. **(d) Directive content**: 14/15 × 25/42 worked-cancellation few-shot ending in 5/9 (structured step/math block shapes); undelimited-LaTeX ban; plain-parentheses pseudo-delimiter ban ("( x = 2 )" is NOT math formatting); one-transformation-per-step structure; bilingual P7 note (Hindi/Hinglish; CBSE/NCERT/Bloom's stay English) — and ABSENT from the parity-locked `FOXY_STRUCTURED_OUTPUT_PROMPT`, `FOXY_SAFETY_RAILS`, and `buildSystemPrompt` output for every mode. **(e) Rubric v2**: `RUBRIC_VERSION === 'v2'`; `buildJudgeSystemPrompt()` carries the 3 math-format criteria under scaffold_fidelity (before age_appropriateness) — (i) derivations + tall/stacked math as standalone display equations not prose, with the flat-inline-equation non-penalise guard, (ii) proper `\( ... \)` delimiters penalising bare `\frac{1}{2}` and `( x = 2 )` pseudo-math, (iii) numbered short steps / one transformation per step / never a dense inline chain — plus skip-checks-(a)-(c)-entirely for non-math answers; judge JSON contract UNCHANGED (exactly the 4 score keys + notes in the prompt; `parseJudgeJson` accepts the 4-key object and nulls on a missing dimension). **(f) Seed OFF** (`20260716120000_seed_ff_foxy_math_format_v2.sql`, comment-stripped/string-blanked static scan): `to_regclass` fresh-DB guard; canonical REG-125 column shape (explicit list, `flag_name` first, `is_enabled`, `rollout_percentage`; never name/enabled); positional `'ff_foxy_math_format_v2', false, 0`; no `true` literal in executable SQL; `ON CONFLICT (flag_name) DO NOTHING` — never `DO UPDATE`, never `(name)`. | `apps/host/src/__tests__/api/foxy/math-format-directive.test.ts` (82 tests) | E | P12 (additive prompt directive only — rails/grounding untouched), P7 (bilingual note), P5 (grade-string band resolution), P6-adjacent (emitted math displays correctly), REG-125-adjacent (seed shape) |

### Invariants covered by this section

- Flag-OFF byte-identity — merging Wave B is a zero-behavior change: the
  triple compose collapses to the pre-Wave-B selector for every mode and
  upstream-flag state until an operator flips `ff_foxy_math_format_v2`.
- CEO band-uniformity constraint — '6-8' and '9-12' return identical text;
  bands may diverge ONLY once the eval harness can score variants. A failing
  uniformity pin means someone shipped an unscored per-band pedagogy change.
- P12 (AI safety) — the directive is additive via mode_directive only; the
  parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT, FOXY_SAFETY_RAILS, and the base
  persona are pinned clean of it.
- Rubric v2 measurement integrity — the nightly judge scores the house style
  under scaffold_fidelity without penalising non-math answers, and the 4-key
  JSON contract (DB columns, composite weights) is unchanged.
- REG-125 (seed shape) — the flag row seeds OFF in the canonical
  flag_name/is_enabled shape with DO NOTHING conflict resolution.

### Catalog total

Pre-REG-258: 224 entries (through REG-257, Foxy undelimited-LaTeX math
normalization). Adds REG-258 (Foxy math-format house style Wave B —
flag-OFF byte-identity of the triple-composed mode_directive selector,
MATH_FORMAT_DIRECTIVE composed LAST on prose-teaching turns only,
band-uniformity-until-harness-scores, directive content + parity-lock
exclusion, rubric v2 scaffold_fidelity math criteria with unchanged 4-key
judge contract, and the default-OFF canonical seed).
**Total catalog: 225 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-273..REG-276 — Canonical math rendering (docs/math-rendering-spec.md): single normalizer/pipeline, MathRenderer fail-safe + truncated-preview canary, prompt density single-source + twin byte-parity, 3-band resolveGradeBand + flag-OFF byte-identity (2026-07-20)

Source: the canonical-math-rendering change (spec `docs/math-rendering-spec.md`,
CEO-approved 2026-07-20; assessment definition → ai-engineer prompts →
frontend surfaces → testing). The 2026-07 consolidation created ONE math
pipeline for the whole platform: normalizer primitives in
`packages/ui/src/math/normalize.ts`, the KaTeX-direct segment renderer in
`packages/ui/src/math/katex-segments.tsx`, the lazy fail-safe wrapper
`packages/ui/src/math/MathRenderer.tsx` (question-bank surfaces: quiz page,
QuizResults, MockTestRunner, MisconceptionExplainer, admin detail views), and
the single markdown+math config `packages/ui/src/math/MathMarkdown.tsx`.
`packages/ui/src/foxy/math-normalization.ts` became an export-only
compatibility shim. On the prompt side, the grade-band step-density rule got
ONE in-code source (`MATH_STEP_DENSITY_RULES` in
`packages/lib/src/foxy/math-step-density.ts`), composed by
`buildMathFormatDirective(gradeBand)` and derived — never copy-pasted — by
every generator prompt (spec §6).

**Why these are regression pins.** (1) Spec §5 forbids a second frontend
regex patch — a duplicated normalizer/tokenizer silently forks rendering
between surfaces. (2) A math question must NEVER render blank: the lazy KaTeX
chunk failing on flaky 4G must degrade to raw text (P6/P12), and a string
sliced mid-LaTeX (`.slice(0, 80)` list cells) must never reach KaTeX. (3) A
copy-pasted density rule drifts — two students at the same grade would get
different formatting contracts; and the runtime serves the INLINE prompt twin
preferentially, so a .txt-only edit silently forks the served prompt. (4) The
3-band split is a scored, CEO-approved pedagogy change gated by
`ff_foxy_math_format_v2`; with the flag OFF every Foxy prompt must stay
byte-identical to the pre-Wave-B selector, and the '6-8' directive must stay
byte-identical to the pre-split `MATH_FORMAT_DIRECTIVE` (spec §7.2/§8).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-273 | `math_pipeline_single_normalizer_single_definition_sites` | Every normalization primitive (`normalizeLatexDelimiters`, `tokenizeInline`, `containsAllowlistedMathCommand`, `containsRenderableMath`, `splitUndelimitedMath`, `normalizeMathSegments`) is DEFINED exactly once across all of `packages/ui/src` — in `math/normalize.ts` (walk + per-function definition-site equality); `renderKatex`/`renderInlineSegments` defined only in `math/katex-segments.tsx`; `from 'katex'` and `katex.renderToString(` appear ONLY in `math/katex-segments.tsx`; the react-markdown+math config exists ONLY in `math/MathMarkdown.tsx`; `foxy/math-normalization.ts` is an export-only shim over `../math/normalize` (comment-stripped scan: no function/const/class/arrow — zero logic); consumer wiring: FoxyStructuredRenderer imports from `../math/normalize` + `../math/katex-segments`, RichContent pre-normalizes via the canonical `normalizeLatexDelimiters` and renders via MathMarkdown, and QuizResults / quiz page / MockTestRunner all render through MathRenderer with the spec invocation shapes (`inline` on option rows — an option never carries display math). | `apps/host/src/__tests__/math/math-pipeline-single-source.test.ts` (21 tests, shared with REG-274's preview canaries) | E | Spec §5/§6 (rescue singular, no second regex patch), P6-adjacent, P10 (single KaTeX site keeps the lazy-chunk strategy honest) |
| REG-274 | `math_renderer_failsafe_raw_text_never_blank_plus_truncated_preview_plain` | **(a) Error boundary → RAW TEXT (P6: never blank):** a throwing/failed katex-segments chunk render degrades to the byte-exact raw question text (container.textContent === content, non-empty), never a blank or a crash; className wrapper survives the fallback. **(b) Suspense fallback:** raw text is visible immediately on first render and stays visible while the chunk is loading/suspended. **(c) Fast path (P10):** plain question text (no delimiter, no allowlisted command) renders synchronously with ZERO invocations of the lazy katex-segments component; `containsRenderableMath` predicate pinned (plain/`\franchise` → false; `\(`/`\[`/`$`/allowlisted command → true, errs permissive on `$`). **(d) Spec §2 render cases through the NEW surfaces** (Foxy structured layer NOT duplicated — REG-257 owns it): `\( \frac{3}{4} \)`, `\( x^{2} \)`, `\[ \sum_{k=1}^{n} k \]`, and a band-11-12 multi-step justified chain (`\because`, `\boxed{}`) each render KaTeX (`.katex`/`.mfrac` present) with NO raw delimiter text leaking to visible text, via the exact QuizResults/quiz-page invocation shapes AND a real `<MockTestRunner />` mount (question text + options); display math gets `.katex-display` INSIDE the `block max-w-full overflow-x-auto` scroll wrapper (360px containment); `inline` forces option-row math inline (never `.katex-display`, never the scroll wrapper); markdown emphasis OFF by default (`2*3*4` never becomes `<em>`); nullish content renders nothing. **(e) Truncated-preview canary:** sliced strings NEVER reach MathRenderer — the QuizResults collapsed row header `substring(0, 90)` line, and the super-admin cms + workbench `slice(0, 80)` list cells stay PLAIN text with `title=` hover (cms/workbench pages import no MathRenderer at all). | `apps/host/src/__tests__/math/math-renderer-failsafe.test.tsx` (8 tests) + `apps/host/src/__tests__/math/math-renderer.test.tsx` (13 tests) + the 3 truncated-preview canaries in `math-pipeline-single-source.test.ts` | E | P6 (never a blank question), P12-adjacent (fail-safe degradation), P10 (lazy KaTeX, zero cost for plain text), spec §2 (delimiter contract at render time) |
| REG-275 | `math_density_single_source_derivation_and_prompt_twin_byte_parity` | The step-density rule has exactly ONE in-code source (`MATH_STEP_DENSITY_RULES`): `foxy_tutor_v1.txt` §8 DEFERS to `docs/math-rendering-spec.md` + `buildMathFormatDirective` and names the mode-directive injection channel + the conservative no-directive default; NO band-specific density text is copy-pasted into any static template (per-band body + distinctive markers `2-3 ROUTINE operations` / `justified equation chains` / `FOIL` pinned ABSENT); §8 carries the spec §4 answer-block-vs-`\boxed{}` disambiguation; §4 (stepwise numericals) defers density AND boxing to §8 with the retired absolute lines (`never skip intermediate steps`, `box/highlight the final answer`) pinned gone; the runtime-preferred `inline.ts` twin contains the .txt §8 AND §4 blocks VERBATIM (byte-parity — an edit to one without the other silently forks the served prompt), extended to all 5 closure templates (quiz_question_generator / quiz_answer_verifier / ncert_solver / foxy_tutor_doubt / foxy_tutor_exam: full-template verbatim-in-inline.ts); every closure template carries the spec §2 delimiter contract (`\( ... \)` mandated, `$`/`$$` forbidden, ASCII math banned) and the per-surface §4 boxing rule (raw-markdown → `\boxed{...}` + NO answer block; structured → answer-block-IS-the-box, no double-boxing); NCERT solver prompts embed EXACTLY their band's density text and no other band's, the retired 6-8-absolute solver line is gone, and solver text is stable WITHIN a band (prompt-cache: one prefix per band); Unicode `²` pinned absent from both twins. | `apps/host/src/__tests__/lib/foxy/math-density-drift-guard.test.ts` (57 tests) | E | Spec §6 (single source — duplicates drift), P12 (prompt-layer fix, not frontend regex), P7-adjacent (density constrains structure only), operational integrity (inline twin is what the runtime serves) |
| REG-276 | `three_band_resolveGradeBand_boundaries_and_flag_off_byte_identity` | **(a) 3-band resolution (P5 grade STRINGS):** `resolveGradeBand` maps "6"/"7"/"8" → '6-8', "9"/"10" → '9-10', "11"/"12" → '11-12'; the split boundaries at grade 8/9 and 10/11 are pinned per-grade; ""/garbage/"5"/"13"/out-of-range fall back to the pedagogically conservative '6-8'. **(b) Per-band directive content:** '9-10' carries the 2-3-routine-operations rule, '11-12' carries justified chains + NCERT theorem naming + LaTeX-only `\because`/`\therefore` + no foreign mnemonics; rules 2-3 (display-vs-inline + delimiter contract) stay band-invariant; same band → byte-identical directive (one stable prompt-cache prefix per band). **(c) 6-8 byte-identity (spec §7.2/§8):** `buildMathFormatDirective('6-8') === MATH_FORMAT_DIRECTIVE` including the fraction-cancellation few-shot content pins — the pre-split directive text IS the 6-8 band text; a "conformance fix" swapping the few-shot to the spec §3.3 illustration is a rejectable change without an assessment-approved spec revision. **(d) Flag-OFF byte-identity (supersedes REG-258 pin (c)):** with `ff_foxy_math_format_v2` OFF the composed `mode_directive` equals the pre-Wave-B double-composed selector for every mode × upstream-flag state; flag-ON injection composes the BAND directive LAST on prose-teaching turns only (quiz_me / practice never get it). | `apps/host/src/__tests__/api/foxy/math-format-directive.test.ts` (99 tests — rewritten from the REG-258 two-band suite; runtime count re-verified 2026-07-20, the "87" quoted at entry time was a stale draft count) | E | P5 (grade-string band resolution), P12 (additive directive; rails/parity locks untouched), P7 (bilingual note), spec §3/§7/§8, REG-258 continuity (pins a/b/d/e/f carried forward) |

### Invariants covered by this section

- **Spec §5/§6 single-source discipline** — one normalizer, one KaTeX-direct
  site, one markdown+math config, one density-rule source; shims are
  export-only. Duplicates are the failure mode this section exists to catch.
- **P6 (never a blank question)** — chunk failure, slow load, malformed LaTeX,
  and truncated previews all degrade to visible raw/plain text.
- **P10 (bundle posture)** — plain question text provably never invokes the
  lazy KaTeX chunk; the single KaTeX import site keeps that guarantee honest.
- **P5 (grade format)** — band resolution consumes grade STRINGS only, with a
  conservative fallback.
- **P12 (AI safety / prompt integrity)** — formatting violations are fixed at
  the prompt layer; the served inline prompt twins cannot silently fork from
  the canonical .txt templates; flag-OFF keeps every student prompt
  byte-identical to the pre-change selector.
- **REG-257/REG-258 continuity** — the Foxy structured-layer canary corpus is
  untouched (not duplicated); REG-258's surviving pins are carried by REG-276
  and its superseded band-uniformity pin is documented in place.

### Catalog total

Pre-REG-273: 239 entries (through REG-272, CI sharded-topology fan-in contract). Adds
REG-273 (canonical math pipeline single source — definition
sites, shim purity, single KaTeX/react-markdown sites, consumer wiring),
REG-274 (MathRenderer fail-safe raw-text-never-blank + Suspense fallback +
fast-path no-lazy-import + spec §2 render cases through quiz/mock-exam
surfaces + truncated-preview plain-text canary), REG-275 (prompt step-density
single-source derivation + .txt/inline.ts twin byte-parity across all
generator templates), REG-276 (3-band `resolveGradeBand` boundaries +
per-band directive content + 6-8 byte-identity + `ff_foxy_math_format_v2`
flag-OFF byte-identity; supersedes REG-258 pin (c)).
**Total catalog: 243 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-277..REG-280 — Foxy LaTeX-in-JSON ramp package (branch fix/foxy-latex-json-escaping): few-shot JSON validity + doubling rule, escape-repair backstop with Node/Deno + renderer-allowlist parity, foxy-system.ts legacy-path alignment (deliberate re-pin), §9.1 vertical_math precedence carve-out (2026-07-20)

Source: the 2026-07-20 LaTeX-in-JSON escaping incident + CEO-approved
`ff_foxy_math_format_v2` 100%-ramp package (3 commits: 771412ee escaping fix,
8ac77c0c foxy-system re-pin + spec §9.1, 981b6ed7 C1 `\not` allowlist).
Incident shape: the few-shot examples in FOXY_STRUCTURED_OUTPUT_PROMPT showed
LaTeX inside JSON strings with SINGLE backslashes — illegal JSON escapes. The
model imitated them, `JSON.parse` threw at the first math-bearing block, and
the truncation-rescue path silently dropped every block after it while
telemetry recorded success (19/29 math turns degraded in 48h; worst case: math
in the FIRST block → Tier-3 "answer got cut off" apology on a complete
answer). The fix is two-layered — prompt-side (doubling rule + doubled
few-shots) and backstop-side (string-literal-scoped pre-parse escape repair) —
plus the foxy-system.ts legacy-path alignment and the §9.1 precedence ruling
that were prerequisites for the ramp.

**Why these are regression pins.** (1) A single under-escaped few-shot
re-teaches the model illegal JSON on every structured turn — the incident
recurs silently because rescue reports ok=true. (2) The repair backstop sits
in front of `JSON.parse` on EVERY Foxy structured turn: if it ever touches
legal escapes, leaks outside string literals, or masks true truncation, it
corrupts student-visible content platform-wide; and if the Node/Deno copies or
the repair-vs-renderer allowlists fork, the two runtimes disagree about what
math survives. (3) foxy-system.ts is the base prompt of the legacy
intent-router path (`runLegacyFoxyFlow` — the `ff_grounded_ai_foxy`
kill-switch and grounded-failure fallback) with NO band-directive injection
channel: retired absolute lines returning there would contradict the spec on
exactly the path that serves students when grounded is down. (4) The §9.1
carve-out must stay dark (rollout 0) and isolated: one byte leaking into the
band directives would teach an ungated block type on every math turn and break
the flag-OFF byte-identity that REG-276 guarantees.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-277 | `foxy_fewshot_json_validity_and_doubling_rule` | Every few-shot example in the RENDERED `FOXY_STRUCTURED_OUTPUT_PROMPT` (all 10, extracted by the `{"title"` … `]}` block walk — the count itself is pinned) parses as STRICT JSON and validates against `FoxyResponseSchema` (the model imitates these verbatim); math-bearing examples decode to single-backslash LaTeX (`\( ax^2 + bx + c = 0 \)`, `\neq`, `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`) — proof the doubling is right and not over-escaped; the explicit `JSON ESCAPING FOR MATH (CRITICAL)` rule with the `\\frac not \frac` contrast is present in the constraints. Cross-copy discipline for the 3 prompt copies: the Deno copy (`structured-prompt.ts`) rides the existing GUARD #4 byte-compare and the Python copy (`foxy_structured_prompt.py`) rides the schema-parity byte-compare, whose PREMISE pin flipped to the doubled form (rendered TS carries `\\frac{-b \\pm \\sqrt`, never the quadrupled over-escape) — so all 3 served copies carry the same doubled few-shots + rule. The doubling rule also ships on the six JSON-surface templates (foxy_tutor_v1 / teach / doubt / exam + quiz_question_generator / quiz_answer_verifier, each +1 `JSON escaping (CRITICAL)` line, mirrored in `inline.ts`): held today TRANSITIVELY by REG-275's .txt↔inline.ts full-template byte-parity (an edit to one side fails); a DIRECT presence assertion per template is a named follow-up gap (see below). | `apps/host/src/__tests__/lib/foxy/prompt-fewshot-json-validity.test.ts` (23 tests) + premise pins in `schema-parity-python.test.ts` and `delimiter-parity.test.ts` | E | P12 (prompt integrity — the few-shots ARE the behavior), P6-adjacent (student math renders instead of vanishing), REG-275 continuity |
| REG-278 | `json_escape_repair_backstop_scoped_conservative_parity` | **(a) Legal escapes byte-preserved:** all 8 legal forms (`\n \t \b \f \r \" \\ \/ \uXXXX`) + already-doubled LaTeX pass through untouched with `repairCount === 0`; genuine control escapes with non-command tails (`\tcell`, `\name`, `\notime`, `\notebook`, `\franchise`, `\fracXY`) stay control escapes (word-bounded arbiter). **(b) Illegal escapes doubled inside string literals only:** `\( \) \[ \]`, illegal-head commands (`\pi \sqrt \cdot \lambda`), legal-escape-HEADED commands via the allowlist arbiter (`\times \neq \frac \theta \boxed`), `\u` not followed by 4 hex (`\underline`) repaired while `A` survives; C1: `\not\subset` (repairCount 2) and `\notin` (longest-first alternation, never not+in) repair correctly, `\nu` unshadowed. **(c) Purity:** backslashes OUTSIDE string literals never touched; idempotent (second pass repairCount 0); never throws on garbage/truncated input; no-backslash input returned by reference. **(d) Incident regression:** the 2026-07-20 failure shape (complete envelope, under-escaped block 2) repairs to a FULL parse + schema validation — 4/4 blocks, no loss; `rescueFromTruncatedJson` recovers the full envelope (repair runs before the truncation walk); first-block math no longer collapses to the Tier-3 apology (`wrapAsParagraph` output contains the math, not "answer got cut off"); TRUE truncation still throws post-repair and routes to rescue, which salvages the complete blocks — repair does not mask truncation. **(e) Telemetry:** in the Deno pipeline `structured_parse_repaired` (complete payload, repairCount > 0, warning + ok=true) is a DISTINCT signal from `structured_parse_rescued` — reaching rescue means genuinely truncated/structurally broken, never merely under-escaped. **(f) Parity:** Node source `packages/lib/src/foxy/json-escape-repair.ts` and Deno mirror `supabase/functions/grounded-answer/json-escape-repair.ts` byte-identical (LF-normalized) AND runtime-neutral (no imports, no `Deno.`, no `require`); `JSON_REPAIR_MATH_COMMANDS` set-equals the renderer's `MATH_COMMAND_ALLOWLIST` (order-insensitive) so repair and render can never disagree about what is math; extras exactly `['boxed', 'rightleftharpoons']` and strictly additive (never shadow a renderer command); `begin` deliberately absent from BOTH lists (documented span-rule deferral — matrix environments need an environment-aware rule, not an allowlist entry). | `apps/host/src/__tests__/lib/foxy/json-escape-repair.test.ts` (31 tests) + `json-escape-repair-parity.test.ts` (4 tests) + `apps/host/src/__tests__/foxy/undelimited-math-normalization.test.tsx` (42 tests — `\not` renderer allowlist + alternation-ordering pins) + `supabase/functions/grounded-answer/__tests__/wrap-as-paragraph.test.ts` (Deno — rescue/extract with repair) | E | P12 (no silent block loss on student turns), P6-adjacent (math renders), operational integrity (repaired-vs-rescued telemetry distinct — the ops alert threshold rides it) |
| REG-279 | `foxy_system_legacy_path_alignment_re_pin` | `buildFoxySystemPrompt` (base prompt of the legacy intent-router path under /api/foxy — `runLegacyFoxyFlow`, the `ff_grounded_ai_foxy` kill-switch + grounded-failure fallback; NO band-directive injection channel, so it can never stack with the flag-ON grounded band directive), asserted on RUNTIME output for grade-7-learn and grade-11-doubt: **(a) retired strings cannot return** — `box/highlight the final answer`, `Box/emphasize`, `never skip intermediate steps`, the absolute `separated. Never compress` density line, and the `or x²` Unicode-superscript allowance (no `²` anywhere); **(b) deferential §4/§8 house pattern present** (mirrors foxy_tutor_v1): stage completeness (`never skip a stage (formula -> substitution -> calculation -> final answer)`), step DENSITY defers to `docs/math-rendering-spec.md section 3` / `buildMathFormatDirective` with the conservative no-directive default, spec §4 boxing disambiguation (`"answer" block IS the boxed-answer convention` / `do NOT additionally wrap the value in \boxed{}`), LaTeX `^{...}` superscripts + prose-scoped programming-syntax ban; **(c) no band density text copy-pasted** (spec §6 — all 3 `MATH_STEP_DENSITY_RULES` bodies + the `2-3 ROUTINE operations` / `justified equation chains` / `FOIL` markers pinned absent); **(d) escape fix holds** — served bytes carry REAL LaTeX (`\( ... \)`, `\[ ... \]`, `\frac{numerator}{denominator}`, `\sqrt{x}`, `\pi instead of pi`, `\theta instead of theta`), never the pre-fix `delimited by ( ... )` pseudo-paren instruction, and NO control characters besides newline (the pre-fix mangling turned `\b`/`\f`/`\t` command heads into backspace/formfeed/tab bytes); **(e) snapshot re-derivation discipline** — the `LEGACY_BOARD_TOPPER_PROMPT` byte-pin was deliberately re-derived (2026-07-20, CEO-approved ramp prerequisite) with an in-file rationale block naming the change, scope, and reviewers; that documented-re-derivation pattern is the ONE legitimate way to move this pin, and the flag-OFF safety contract now pins THESE bytes (delimiter-parity GUARD #4 flipped to the escaped source form with runtime bytes pinned in the drift guard). | `apps/host/src/__tests__/lib/ai/prompts/foxy-system-goal-persona.test.ts` (re-derived snapshot + preserved non-snapshot assertions) + the foxy-system runtime canaries in `apps/host/src/__tests__/lib/foxy/math-density-drift-guard.test.ts` (78 tests, shared with REG-275/REG-280) + `delimiter-parity.test.ts` GUARD #4 | E | P12 (the legacy fallback path serves spec-conformant math exactly when grounded is down), spec §2/§4/§6, REG-275/REG-276 continuity |
| REG-280 | `vertical_math_precedence_carveout_isolated` | §9.1 precedence ruling (assessment, spec §9.1.4): the vertical_math-vs-step-density carve-out lives ONLY in `VERTICAL_MATH_DIRECTIVE` (`ff_foxy_vertical_math_v1` at rollout 0 — dark text today). **Pin 1 — flag-OFF byte-identity untouched:** `buildMathFormatDirective('6-8') === MATH_FORMAT_DIRECTIVE` (re-asserting REG-276 pin (c) so the ruling is self-contained) AND no band directive for ANY band contains `vertical_math` — mentioning it there would teach an ungated block type on every math turn. **Pin 2 — the five §9.1.1 normative clauses present in VERTICAL_MATH_DIRECTIVE:** (i) EXEMPT from the one-transformation-per-math-block split / single VISUAL UNIT / NEVER fragment one computation, (ii) REPLACES the flat "math" block / NEVER emit both, (iii) exactly ONE labeling "step" block BEFORE, in the student's language incl. Hinglish (P7), (iv) scope containment — covers ONLY the computation inside the block, the rest of the turn keeps the band's step density, (v) SPECIFIC OVER GENERAL — this directive governs the computations it covers; the ruling names `docs/math-rendering-spec.md section 9.1` as source of truth. **Pin 3 — `packages/lib/src/foxy/math-step-density.ts` byte-unchanged vs committed HEAD** (git-anchored `git show HEAD:` compare, CRLF-normalized only) — the density module is not edited at all; byte-unchanged is part of the ruling (§9.1.4a byte-pin + §9.1.4b flag-leakage rationale). The 6-8 directive identity and the full REG-276 flag-OFF contract stay intact. | The `§9.1 vertical_math precedence carve-out` describe block in `apps/host/src/__tests__/lib/foxy/math-density-drift-guard.test.ts` (78 tests total in file) + primary 6-8 byte-identity pin in `math-format-directive.test.ts` (99 tests, REG-276) | E | P12 (dark directive cannot leak into live prompts), P7 (labeling-step language), spec §9.1, REG-276 continuity (flag-OFF byte-identity re-asserted, not superseded) |

### Invariants covered by this section

- **Prompt-teaches-what-parses** — every few-shot the model imitates must
  itself survive JSON.parse + the schema it teaches, in all 3 served copies
  (TS/Deno/Python byte-parity chains), with the doubling rule stated
  explicitly on every JSON-emitting surface.
- **Backstop conservatism** — the pre-parse repair is string-literal-scoped,
  legal-escape-preserving, allowlist-arbitrated, idempotent, and never masks
  true truncation; repaired and rescued are DISTINCT telemetry signals so a
  prompt-side regression is visible, not silently absorbed.
- **Runtime-parity discipline** — the repair module is runtime-neutral and
  byte-pinned Node↔Deno; its arbiter allowlist set-equals the renderer
  allowlist so repair and render never disagree about what is math.
- **Legacy-path spec conformance (P12)** — the kill-switch/fallback prompt
  path carries real LaTeX bytes and the deferential density/boxing pattern;
  retired absolute lines are pinned gone at runtime.
- **Byte-pin change discipline** — snapshot re-derivation is legitimate ONLY
  with an in-file documented rationale naming scope and reviewers (the
  2026-07-20 re-pin is the exemplar); silent drift still fails.
- **Dark-directive isolation** — §9.1 carve-out text exists only behind a
  rollout-0 flag; band directives and math-step-density.ts are byte-pinned
  against leakage, preserving REG-276's flag-OFF byte-identity.

### Known gaps (named follow-ups)

- REG-277 sub-pin: a DIRECT per-template assertion that each of the six
  JSON-surface .txt templates carries the `JSON escaping (CRITICAL)` line
  (today held transitively via REG-275 twin byte-parity). Low risk, cheap add
  to math-density-drift-guard.test.ts.
- E2E: no Playwright spec exercises a structured MATH turn end-to-end —
  `e2e/foxy-structured-rendering.spec.ts` fixtures are science prose only (no
  math block, no KaTeX assertion). Follow-up: add a math-bearing fixture
  (inline `\( \frac{3}{4} \)` in a text field + a `math` block) asserting
  `.katex` paints and no raw delimiter/JSON leaks to visible text.

### Catalog total

Pre-REG-277: 243 entries (through REG-276, canonical math rendering). Adds
REG-277 (few-shot JSON validity + doubling rule across the 3 prompt copies),
REG-278 (escape-repair backstop — scoped/conservative/idempotent, incident
regression, repaired-vs-rescued telemetry, Node/Deno byte-parity + renderer
allowlist set-equality, `\not` C1, `begin` deferred), REG-279 (foxy-system.ts
legacy-path alignment — retired strings pinned gone, real-LaTeX runtime bytes,
deliberate snapshot re-derivation discipline), REG-280 (§9.1 vertical_math
precedence carve-out isolated to VERTICAL_MATH_DIRECTIVE, band directives +
math-step-density.ts byte-pinned).
**Total catalog: 247 entries (target: 35 — TARGET EXCEEDED).**

---

## Master Action Plan Phase 4 — Foxy explorer token/persona fix + Monthly Synthesis fabrication oracle + pre-send gate (2026-07-21/22)

Source: Master Action Plan Phase 4 items 4.1 (Foxy explorer mode token-budget
fix + dedicated persona directive), 4.2 (Monthly Synthesis parent-summary
fabrication oracle), 4.5 (Synthesis pre-send fabrication gate).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-302 | `foxy_explorer_budget_and_synthesis_fabrication_gate` | **(4.1) Explorer token/persona fix:** `MODE_MAX_TOKENS.explorer === 3000` (matches learn/explain/revise, no longer silently falling back to the 1024 default via `MODE_MAX_TOKENS[mode] ?? 1024`); every mode this fix touches (practice/learn/explain/revise/explorer) has an explicit `MODE_MAX_TOKENS` entry (`doubt`/`homework`/`olympiad`/`lesson` intentionally still rely on the 1024 default — out of scope for this fix); `MODE_DIRECTIVES.explorer` is a distinct, non-empty persona directive (not aliased to `learn`'s `''` fallback) instructing Socratic-first behavior (ask before telling; direct exposition only once genuinely stuck), progressive "artifact draft" building (key concepts / worked example / student-voice line), 2-4 blocks per turn (not the 5-12 block teach-deeply shape), and preserving P12 grounding/scope rails; composes cleanly with the additive diagram/math-format directive channel (verified against `diagram-directive.test.ts` and `math-format-directive.test.ts`, both updated to expect `MODE_DIRECTIVES[mode] ?? ''` as the base instead of assuming every teaching mode's base is `''`). **(4.2) Monthly Synthesis fabrication oracle** (`packages/lib/src/ai/validation/synthesis-oracle.ts`, runs inline in `/api/synthesis/state`'s lazy-fill, before persistence): number-fabrication check cross-references every numeric token in the generated EN+HI text (Devanagari digits normalised) against every number reachable anywhere in the `SynthesisBundle` (including inside string fields, rounded-percent forms, and monthLabel year/month) — an unbacked number rejects the WHOLE bilingual pair; chapter/topic-name fabrication check (EN only — Hindi has no capitalisation signal) flags a "chapter/topic <Name>" or quoted-phrase citation with zero word-level token overlap against `masteryDelta.chaptersTouched` + `chapterMockSummary.chapters` + the student's own name; word-cap enforcement truncates at the last sentence boundary at/before 300 words (360-word hard ceiling) rather than mid-sentence, and is explicitly NOT re-run as a rejection reason (format only, not a safety concern); on ANY rejection (fabrication, Claude error, or circuit-breaker OPEN) the route falls back to a deterministic bundle-only bilingual template (`buildSynthesisFallbackSummary`) so the student/parent is never left with an empty summary; a 5-failure/60s-reset/half-open-single-probe circuit breaker (matching `parent-report-generator`'s existing pattern) short-circuits repeated Claude failures. **(4.5) Pre-send gate** (`/api/synthesis/parent-share`, immediately before the WhatsApp send call): re-runs the SAME number+topic fabrication checks (word-cap deliberately NOT re-run) as an independent defense-in-depth pass covering rows persisted before the 4.2 oracle existed or via a future bypass path; on failure writes `parent_share_status='flagged'` (never `sent`, never silently dropped) and returns 422 `flagged_for_review`; a clean, bundle-backed summary still passes through and sends normally. **Migration** `20260722098000_monthly_synthesis_flagged_status.sql` is additive-only (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, wrapped in `BEGIN`/`COMMIT`, idempotent on re-run) and widens the existing 5-value `parent_share_status` CHECK (`pending, sent, opted_out, failed, suppressed` — confirmed against the original migration `20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql`) to add exactly one new value, `flagged`; no RLS change (existing table policies already cover the column), no data migration. **(P13)** both routes log ONLY `rejectionCategory` (a `'fabricated_number' \| 'fabricated_topic'` enum) on any rejection path — never `rejectionReason` (human-readable but still a description, not logged either), never the `unbackedNumbers`/`unbackedPhrases` arrays, and never the student's name (verified by reading `apps/host/src/app/api/synthesis/state/route.ts` and `apps/host/src/app/api/synthesis/parent-share/route.ts` directly, not just the test file). | `apps/host/src/__tests__/api/foxy/explorer-mode-token-budget.test.ts` (10 tests), `apps/host/src/__tests__/lib/ai/validation/synthesis-oracle.test.ts` (49 tests, including a dedicated `P13: rejectionReason never contains the student name` case), `apps/host/src/__tests__/api/synthesis/synthesis-routes.test.ts` (extended — item 4.2 lazy-fill/fallback/circuit-breaker + item 4.5 flagged/clean-pass-through describes), `apps/host/src/__tests__/api/foxy/{diagram-directive,math-format-directive,teach-then-stop-directive}.test.ts` (updated to parameterize on `MODE_DIRECTIVES[mode] ?? ''` instead of assuming an empty base for every teaching mode) | E | P11 (no fabrication reaches a parent), P12 (explorer persona stays grounded/in-scope; token fix stops truncated/degraded Dive turns), P13 (category-only logging, no raw fabricated content or student names), P7 (bilingual EN+HI throughout) |

### Invariants covered by this section

- **No silent token-budget fallback** — every live Foxy mode has an explicit
  `MODE_MAX_TOKENS` entry; a new mode added to `VALID_MODES` without a
  matching entry is the exact bug class item 4.1 fixed (explorer silently
  inheriting 1024 instead of the sibling teaching modes' 3000).
- **Fabrication is checked, not trusted** — the Monthly Synthesis prompt's own
  "do not fabricate" instruction is defense-in-depth only; the oracle
  deterministically cross-checks every number and named chapter/topic mention
  against the bundle BEFORE persistence, and the pre-send gate re-checks
  AGAIN immediately before a parent's phone sees it.
- **Reject-to-template, never reject-to-nothing** — every failure mode
  (fabrication, Claude timeout/error, circuit open) degrades to a
  deterministic, bundle-only bilingual template; the parent/student is never
  shown an empty summary and a flagged pre-send row is never silently
  dropped nor auto-sent.
- **P13 category-only logging** — rejection logging carries an enum category
  and counts at most, never the raw unbacked numbers/phrases or the
  student's name, on both the generation-time oracle and the pre-send gate.

### Catalog total

Pre-REG-302: 301 entries (through REG-301, Phase 2.2 CBSE-board mock-exam
remediation). Master Action Plan Phase 4 adds REG-302 (Foxy explorer
token-budget fix + dedicated persona directive [4.1], Monthly Synthesis
fabrication oracle — number + chapter/topic checks, word-cap enforcement,
template fallback, circuit breaker [4.2], and the WhatsApp pre-send
fabrication re-check gate + `flagged` status [4.5]).
**Total catalog: 302 entries (target: 35 — TARGET EXCEEDED).**

---

## Master Action Plan Phase 8 — Monthly-Synthesis delivery + quality monitoring (2026-07-22) — REG-305

Source: Master Action Plan Phase 8, items 8.4 + 8.6 (the rollout-enablement
prerequisites before the Phase 5 ramp of Monthly Synthesis, still gated OFF by
`ff_pedagogy_v2_monthly_synthesis`). Monthly Synthesis delivers a ~300-word
Claude-authored, parent-facing summary over the `whatsapp-notify`
`monthly_synthesis` template. Two silent-failure modes get monitoring here:

- **8.4 Delivery** — until the Meta template is approved, EVERY WhatsApp send
  fails and the run's `parent_share_status` becomes `failed`. The nightly
  monitor (`/api/cron/synthesis-delivery-monitor`, 04:20 UTC) computes
  `failure_rate_pct = failed/(sent+failed)*100` over a trailing 24h and emits
  ONE critical `notifications` ops_event when `failure_rate_pct > 20` AND
  `attempts >= 5` — matched by the seeded `alert_rules` row 'Monthly synthesis
  delivery failing' (migration `20260722102100`) → CEO email. The dashboard
  (`/api/super-admin/synthesis-health` → `/super-admin/synthesis-health`)
  surfaces the 24h window, a 14d per-day trend, and the last-10 failures.
- **8.6 Quality** — a nightly LLM-as-judge sampler
  (`/api/cron/synthesis-quality-sample`, 04:50 UTC) scores sampled
  `monthly_synthesis_runs` on 4 rubric dimensions (grounding 0.35 /
  no-fabrication 0.35 / tone 0.20 / CBSE-scope 0.10) via a deterministic
  fabrication oracle (authoritative on no-fabrication — clamps to 0, also caps
  grounding at 40) + a Sonnet judge gated by the shared synthesis circuit
  breaker, and INSERTs into `synthesis_quality_scores` (migration
  `20260722102000`; RLS + service-role-write / super-admin-read mirroring
  `foxy_quality_scores` exactly). The dashboard
  (`/api/super-admin/synthesis-quality` → `/super-admin/synthesis-quality`)
  shows 7d rolling averages, prior-week drift delta, and the lowest-10 for
  triage.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-305 | `synthesis_delivery_and_quality_monitoring_p13` | Delivery monitor: `computeRollup` counts by `parent_share_status`, `failure_rate_pct` rounds and is `null` on zero attempts, `breached` iff `>20%` AND `attempts>=5` (19%/100-attempts and 100%/4-attempts both DON'T breach; 21%/5-attempts does); fail-closed CRON_SECRET before DB I/O; the breach ops_event carries `window_hours`/`failure_rate_pct`/`attempts`/`sent`/`failed` COUNTS only; heartbeat recorded on both clean and breach paths (breach detection is a successful run). Quality sampler: anti-join skips already-scored `(synthesis_run_id, rubric_version)`; a judge miss (null / breaker-open / throw) counts `failed` and never aborts the loop or crashes (P12); a duplicate-insert `23505` is a silent skip; only missing `ANTHROPIC_API_KEY` → 503. Quality-eval lib: deterministic oracle clamps `no_fabrication` to 0 and caps `grounding` at 40 on any unbacked number/topic; composite uses the documented weights; `parseSynthesisJudgeJson` rejects malformed judge output. Dashboard APIs: both `super_admin.access`-gated. **P13**: the sampler loads student name+grade SERVER-SIDE only and persists NEITHER; `synthesis_quality_scores` stores scores + a judge note (constrained to a one-sentence lowest-dimension reason, or a deterministic counts-only oracle message) + COUNTS-ONLY `oracle_findings` + `raw_judge_response` (the parsed 4-score rubric, NOT the raw summary) — never the summary body, bundle, phone, or name; `synthesis-health` selects `id/student_id/synthesis_month/parent_share_status/created_at` only (no summary text/bundle); both dashboard pages render truncated IDs, month labels, timestamps, scores, counts, and the judge note — no name/email/phone/summary body — and are fully bilingual (P7). | `apps/host/src/__tests__/api/cron/synthesis-delivery-monitor.test.ts` (8), `apps/host/src/__tests__/api/cron/synthesis-quality-sample.test.ts` (8), `apps/host/src/__tests__/api/super-admin/synthesis-health.test.ts` (4), `apps/host/src/__tests__/lib/ai/validation/synthesis-quality-eval.test.ts` (7); migrations `supabase/migrations/20260722102000_synthesis_quality_scores.sql`, `20260722102100_seed_alert_rule_synthesis_delivery_failure.sql` | E |

### Invariants covered by this section

- P13 data privacy — the parent-facing summary body, the bundle, the parent
  phone, and the student name never reach a persisted column, an ops_events
  context, a dashboard API payload, or a rendered dashboard cell. Judge notes
  are constrained to a score-describing sentence; `oracle_findings` and
  `raw_judge_response` are counts / the parsed rubric only.
- P8 — `synthesis_quality_scores` ships RLS in the same migration, service-
  role-write / super-admin-read, byte-for-byte the `foxy_quality_scores`
  posture it claims to mirror (verified against the source migration).
- P9 — both dashboard routes are `super_admin.access`-gated; both crons are
  fail-closed CRON_SECRET before any DB I/O.
- P11/P12 — a hard fabrication is a hard fail (deterministic clamp to 0,
  authoritative over the judge); the judge degrades to `null` (counted
  `failed`) via the shared circuit breaker instead of crashing the sampler.
- P7 bilingual — both new super-admin dashboards are fully EN/HI via
  `AuthContext.isHi`.

### Known gap (documented, not silently dropped)

The `created_at`-keyed 24h cohort in `synthesis-delivery-monitor` is a
documented monitoring PROXY: `monthly_synthesis_runs` has no explicit
"delivery attempted at" column, so a run created just before the window edge
whose share is attempted just after could land in an adjacent bucket. This is
acknowledged inline in the route and is an architect-owned schema change
(adding a status-change timestamp) deliberately out of Phase 8 scope — not a
test gap.

### Catalog total

Pre-REG-305: 304 entries (through REG-304, the Phase 8 adaptive-loops
monitoring gate). Master Action Plan Phase 8 adds REG-305 (Monthly-Synthesis
delivery-failure monitor [8.4] + LLM-as-judge quality sampler [8.6] + both
super-admin dashboards + the `synthesis_quality_scores` table and delivery
alert rule).

## GenAI Phase 1 — Model Gateway backward-compat + provider-routing safety (2026-07-24) — REG-308

> **CORRECTION 2026-08-02 (superseded by REG-334 below, NOT removed — per this
> catalog's "removing an entry requires explicit user approval" rule):** the
> "byte-for-byte Anthropic-primary" order this section's test-table row quotes
> (`claude-haiku-4-5-20251001` → `claude-sonnet-4-20250514` → `gpt-4o-mini` →
> `gpt-4o`) was the order AS OF 2026-07-24. A CEO-directed cost swap on
> 2026-08-02 flipped it to OpenAI-primary (Claude retained as the reliability
> fallback tier, not deleted) — see REG-334 for the new order and its
> dedicated pinning test [note: authored this session as REG-332, renumbered
> to REG-334 during the 2026-08-03 merge with `origin/main`, which had
> independently taken REG-332/REG-333 for unrelated fixes — see
> `00-header.md`'s collision note]. Everything ELSE in this section (the
> flag-OFF no-op
> guarantee, the never-select-a-dormant-provider invariant, config model-name
> byte-identity, Deno↔TS ordering parity) remains accurate; only the specific
> legacy order quoted below is now historical, not current.

The provider-agnostic Model Gateway (`packages/lib/src/ai/gateway/**`) consolidates
the four previously-hardcoded model-call sites onto ONE catalog + ONE routing
decision. It is purely additive and flag-gated behind `ff_model_gateway_v1`
(default OFF, seeded OFF by architect). The whole point of Phase 1 is that the
flag-OFF world is a **byte-identical no-op** vs. today's Anthropic-primary
behavior — so this catalog entry pins the four ways that guarantee could silently
break: (a) flag-OFF policy parity, (b) a dormant `configured:false` provider
leaking into a selection, (c) a config model-name drift, (d) Deno↔TS ordering
drift. Owner: testing (tests) / ai-engineer (gateway source). Maps to P12.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-308 | `model_gateway_backward_compat_and_provider_routing_p12` | **(a) Flag-OFF default-policy parity (the no-op guarantee):** with `ff_model_gateway_v1` OFF, `callModel` forces ANY requested policy (`cost`/`quality`/…) to `default`, and `default` reproduces the legacy Anthropic-primary chain byte-for-byte (`claude-haiku-4-5-20251001` → `claude-sonnet-4-20250514` → `gpt-4o-mini` → `gpt-4o`); the OFF path still consults the flag, an explicit `default` request never touches the flag system, and flag-ON honours the requested policy (`cost` → `gpt-4o-mini` head). **(b) Router never selects a dormant provider:** across EVERY policy × constraint combination the returned chain contains only `configured:true` models — both Gemini seams stay out even when `cost` would rank the cheaper-but-dormant `gemini-1.5-flash` first; constraints FILTER (`minQualityTier`/`maxInputCostPer1M`/`needsVision`) but never REORDER the `default` chain; an impossible constraint yields `[]` (no fallback to dormant). **(c) config.ts model-name byte-identity:** `getAIConfig().primaryModel.name === 'claude-haiku-4-5-20251001'` and `.fallbackModel.name === 'claude-sonnet-4-20250514'` (frozen literals, now sourced from the registry id constants) with request-shaping params unchanged (1024/2048 tok). **(d) Deno↔TS `MODEL_FALLBACK_ORDER` parity:** the edge mirror `supabase/functions/grounded-answer/config.ts` `MODEL_FALLBACK_ORDER` equals the TS registry `LEGACY_FALLBACK_ORDER` for all three keys (`haiku`/`sonnet`/`auto`) — same providers, models, and order — so the Node gateway and the Deno grounded-answer path can never drift. **Gateway behavior (defense-in-depth):** fallback advances on a transient error (incl. a thrown adapter error normalized to a non-fail-fast advance) and crosses the provider boundary; a 401/403 fail-fast aborts the chain WITHOUT trying later models; all-failed returns a structured `{ ok:false, provider:'none' }` and never throws; per-attempt + per-call telemetry emit metadata-only fields (`modelId`/`provider`/`policy`/tokens/cost/latency/`fallbackCount`/`success`) and never the prompt (P13). **Consumer equivalence:** `classifyIntent`'s LLM branch uses legacy `callClaude` when the flag is OFF and `callModel({policy:'default'})` when ON, with an identical return shape and the same throw-on-failure → mode-default fallback on either path. | `apps/host/src/__tests__/lib/ai/gateway/registry.test.ts` (12), `router.test.ts` (13), `gateway.test.ts` (13), `config-model-name-identity.test.ts` (4), `deno-parity.test.ts` (5), `foxy-router-consumer.test.ts` (5); source under test `packages/lib/src/ai/gateway/**`, `packages/lib/src/ai/config.ts`, `packages/lib/src/ai/workflows/foxy-router.ts`, `supabase/functions/grounded-answer/config.ts` | E |

### Invariants covered by this section (Model Gateway)

- P12 AI safety / provider — the router can NEVER surface a `configured:false`
  (dormant) provider under any policy or constraint; a live-path model/provider
  change requires an explicit, user-approved catalog edit, and the frozen config
  model-name literals + the Deno↔TS ordering parity make any such drift fail a
  test loudly instead of silently repointing a live path.
- Additive-no-op guarantee — flag-OFF forces `default`, and `default` is the
  legacy Anthropic-primary chain byte-for-byte, so shipping the gateway changes
  zero behavior until an operator deliberately flips `ff_model_gateway_v1`.
- P13 data privacy — gateway telemetry is metadata-only (model id, provider,
  policy, token counts, cost estimate, latency, fallback count, success); it
  never carries the system prompt or messages.

### Catalog total (Model Gateway)

GenAI Phase 1 adds REG-308 (Model Gateway backward-compat + provider-routing
safety). REG-306..REG-307 were the prior additions (Master Action Plan Phase
2.3–2.5 + 3.10); REG-308 is the next free id after REG-307.
**Total catalog: 305 entries (target: 35 — TARGET EXCEEDED).**

---

## Model Gateway OpenAI-primary provider swap (2026-08-02) — REG-334

> **RENUMBERED 2026-08-03 (merge with `origin/main`):** authored this session
> as REG-332. `origin/main` had independently taken REG-332 (and REG-333) for
> two unrelated fixes and merged first, so this entry — and REG-333 directly
> below, now REG-335 — were renumbered up during conflict resolution. No
> content changed; see `00-header.md`'s collision note for the full account.

CEO-directed cost swap (see the approved plan, "Multi-Provider AI Cost/Quality
Routing Plan Revision 2," Phase 1): Anthropic's per-token cost does not scale
with per-student revenue at current volume, so `MODEL_FALLBACK_ORDER`
(`supabase/functions/grounded-answer/config.ts`) and `LEGACY_FALLBACK_ORDER`
(`packages/lib/src/ai/gateway/registry.ts`) both flipped from
Anthropic-primary to OpenAI-primary for every preference key
(`haiku`/`sonnet`/`auto`): gpt-4o-mini/gpt-4o now run FIRST, Claude
Haiku/Sonnet are RETAINED as the reliability fallback tier, not deleted —
specifically because the Foxy system prompt, JSON output contract, and CBSE
pedagogy decision tree were originally calibrated against Claude's behavior
(RCA-FIX CRITICAL-1, 2026-06-26), which is why the swap ships behind a fast
output-quality validation pass (the new `eval/openai-migration/` harness,
Claude-graded via the existing quality-eval judge kept deliberately on a
different provider than what it grades) before the canary ramps. This flip is
shared infrastructure — the SAME config also re-orders ncert-solver's grounded
path and the quiz-generation/verification prompt templates
(`REGISTERED_PROMPT_TEMPLATES`), since they all resolve through
`resolveModelOrder()` / `MODEL_FALLBACK_ORDER`. A companion fix in the same
change corrected a pre-existing Sonnet model-ID drift
(`claude-sonnet-4-6-20251022` → the verified-valid `claude-sonnet-4-20250514`)
— see the note below (originally logged as a "Known gap," closed by a
same-session ai-engineer follow-up and independently re-verified 2026-08-02)
for the complete, current, file-by-file accounting of that companion fix.

This is exactly the kind of core AI-provider-primacy change REG-67 (AlfaBot
model provenance) and REG-51 (server-shuffle authority) established precedent
for pinning: a routing-order change is invisible in a diff review unless a
test explicitly asserts the NEW order as intentional, the same way the OLD
order used to be asserted before this swap.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-334 | `model_gateway_openai_primary_provider_swap_p12` | **New regression pin:** `selectModelChain('default')` (no constraints) resolves to `[gpt-4o-mini, gpt-4o, claude-haiku-4-5-20251001, claude-sonnet-4-20250514]` — OpenAI-primary, Claude retained as fallback — asserted on BOTH model ids and providers explicitly (an id rename alone can't silently flip a provider and stay green). **Companion coverage (updated, not new):** the Deno↔TS `MODEL_FALLBACK_ORDER`/`LEGACY_FALLBACK_ORDER` parity test (REG-308) now anchors the NEW order on both sides; every `router.test.ts`/`gateway.test.ts` test whose mock adapter map supplied only an `anthropic` entry (implicitly relying on the pre-swap order to mean the real, unmocked `openaiAdapter` was never reached) was restructured to mock both providers explicitly, so none of this suite's green state depends on `OPENAI_API_KEY` being absent from the test environment; the Deno-side `grounded-answer/__tests__/claude.test.ts` "OpenAI finish_reason=length" test (the one test in that 15-test suite that supplies `openaiApiKey` and therefore actually exercises the OpenAI-primary order end-to-end) was updated the same way — the other 14 tests in that file were left green-but-annotated (they now validate the Anthropic-only fallback path taken when no `openaiApiKey` is configured, not "the primary/default path" their names describe, per a new file-header note). **Also found and fixed (full-suite sweep, genuinely failing, distinct from the companion Sonnet-ID file-list note below — formerly this entry's "Known gap"):** `grounded-answer/__vitest__/mol-telemetry-adapter.vitest-harness.ts`'s "computes cost via PRICING table for claude-sonnet too" — `_shared/mol/telemetry.ts`'s `PRICING` table WAS correctly repointed to key on `claude-sonnet-4-20250514` (old-id entry removed), but this test's fixture still sent the stale `claude-sonnet-4-6-20251022`, so `calcCost` found no PRICING match and silently returned 0 instead of the expected 1494.00 INR — a real assertion failure, not just a latent drift. **Second independent full-suite sweep (2026-08-02, `python -m pytest tests/unit`, 893 tests across unit+integration): found 3 more genuinely-failing tests from the SAME Sonnet-ID drift, this time on the Python side** — `python/services/ai/mol/cost.py`'s `PRICING` dict was correctly repointed the same way as its TS twin, but `python/tests/unit/test_cost.py::test_pricing_has_all_known_models` and `::test_compute_cost_for_sonnet` still asserted/sent the stale `claude-sonnet-4-6-20251022` (the latter's `compute_cost()` call silently returned `(0.0, 0.0)` instead of the expected $13.50 — the date-suffix fallback regex requires dashes in the trailing date and does not match this id's undashed `20251022` tail, so there is no silent-alias rescue), and `test_cost_cap.py::test_over_ceiling_raises_cost_cap_exceeded` asserted a `MolError` that never raised once the same zeroed-cost estimate could no longer exceed the ₹2.00 `evaluation` ceiling — all 3 fixed by updating the stale literal to `claude-sonnet-4-20250514` (same pricing values, id-only fix, mirrors the TS-side fix pattern). `python/tests/unit/test_providers_anthropic.py` and `test_eval_harness.py` also reference the old id but pass either fixture through inertly (never looked up against `PRICING`), so intentionally left as-is — not broken, no fix needed. | `apps/host/src/__tests__/lib/ai/gateway/router.test.ts` (14 tests, incl. the new "default chain is OpenAI-primary post 2026-08 cost directive, Claude retained as fallback" pin), `deno-parity.test.ts` (5 tests), `gateway.test.ts` (13 tests, 9 restructured); `supabase/functions/grounded-answer/__tests__/claude.test.ts` (15 Deno tests, 1 fixed); `supabase/functions/grounded-answer/__vitest__/mol-telemetry-adapter.vitest-harness.ts` (28 tests, 1 fixed); `python/tests/unit/test_cost.py` (2 fixed), `python/tests/unit/test_cost_cap.py` (1 fixed); source under test `packages/lib/src/ai/gateway/registry.ts`, `router.ts`, `gateway.ts`, `supabase/functions/grounded-answer/config.ts`, `claude.ts`, `supabase/functions/_shared/mol/telemetry.ts`, `python/services/ai/mol/cost.py` | E |

### Companion Sonnet model-ID drift fix — verified fully applied (corrected 2026-08-02; section originally titled "Known gap")

> **CORRECTION 2026-08-02 (same-session ai-engineer follow-up closed this
> gap; re-verified here by an independent, direct re-read of every file
> listed below — not assumed from this catalog's own prior text or from any
> other prior turn's summary):** this section originally flagged 4 files as
> still carrying the stale `claude-sonnet-4-6-20251022` id after the
> companion fix landed in `registry.ts`, `grounded-answer/config.ts`, MoL's
> TS `router.ts`, and `python/services/ai/mol/cost.py`. All 4 are now
> confirmed fixed. The original accounting also silently omitted two files
> that received the identical fix at the same time
> (`supabase/functions/_shared/mol/telemetry.ts`,
> `supabase/functions/_shared/security/quota.ts`), and this re-verification
> pass additionally found one more file that was never named in EITHER list
> (`python/services/ai/mol/grader.py` — the exact Python twin of the
> already-flagged `_shared/mol/grader.ts`). The complete, current file set
> for this companion fix, all confirmed by direct read to use the corrected
> `claude-sonnet-4-20250514` id:
>
> - `packages/lib/src/ai/gateway/registry.ts` (`ANTHROPIC_SONNET_ID`)
> - `supabase/functions/grounded-answer/config.ts` (`MODEL_FALLBACK_ORDER`)
> - `supabase/functions/_shared/mol/router.ts` (`SONNET` constant)
> - `supabase/functions/_shared/mol/telemetry.ts` (`PRICING` table key) —
>   was already fixed at the time this entry was first written; simply
>   never listed. Its dedicated test fix is already described in the main
>   REG-334 row above (`mol-telemetry-adapter.vitest-harness.ts`).
> - `supabase/functions/_shared/mol/grader.ts` (`GRADER_MODEL` constant) —
>   was the open gap; now fixed.
> - `supabase/functions/_shared/mol/grader-cron.ts` (fallback default
>   inside `writeGraderTelemetry`) — was the open gap; now fixed. Its test,
>   `supabase/functions/_shared/mol/__tests__/grader-cron.test.ts` (the
>   `okGrader` mock fixture's `model` field), was updated in the same pass
>   — source and test now agree on the CORRECTED id, closing the exact
>   "source and test agree with each other, just not with the rest of the
>   platform" drift this section originally flagged.
> - `supabase/functions/_shared/security/quota.ts` (`mapModel()`'s sonnet
>   branch) — was already fixed at the time this entry was first written;
>   simply never listed. Named explicitly as in-scope by migration
>   `20260802180000_model_pricing_add_claude_sonnet_4_20250514.sql`'s own
>   header comment, and independently confirmed fixed by direct read here.
>   (That migration was renumbered from `20260802120000` on 2026-08-03 —
>   its original timestamp collided with main's already-applied-to-prod
>   `20260802120000_seed_ff_wave_b_gap_screens.sql`. Since
>   `supabase_migrations.schema_migrations` is keyed on the 14-digit version
>   prefix as its PRIMARY KEY, that collision is the same failure class that
>   took down the production deploy job in the #1363/#1364 incident recorded
>   in `scripts/lint-migrations.js` — not a benign ordering ambiguity. See
>   the migration's own header for the full record.)
> - `python/services/ai/mol/cost.py` (`PRICING` dict)
> - `python/services/ai/mol/router.py` (`SONNET` constant) — was the open
>   gap; now fixed.
> - `python/services/ai/mol/grader_cron.py` (fallback default inside
>   `_write_grader_telemetry`) — was the open gap; now fixed. Its own
>   inline comment cross-references this catalog's "Known gap" note by
>   name when explaining the fix.
> - `python/services/ai/mol/grader.py` (`GRADER_MODEL` constant) — named in
>   NEITHER this entry's original "verified applied" list NOR its "Known
>   gap" list, despite being the Python twin of the already-flagged
>   `_shared/mol/grader.ts`. Found and confirmed fixed during this
>   re-verification pass.
>
> A fresh repo-wide search for the literal stale id confirms zero remaining
> occurrences in live source or live test assertions. The only surviving
> hits are: (a) this catalog's own historical prose describing the fix;
> (b) explanatory code comments/docstrings narrating the fix in
> `python/tests/unit/test_cost.py` and
> `grounded-answer/__vitest__/mol-telemetry-adapter.vitest-harness.ts`
> (their actual assertions already use the corrected id — see the main
> REG-334 row above); (c) the already-applied, now-historical
> `20260518000003_model_pricing.sql` migration, correctly left untouched
> per migration-immutability convention (`20260802180000_model_pricing_add_claude_sonnet_4_20250514.sql`
> adds a sibling row rather than editing history — its own header explains
> why); and (d) two Python test fixtures
> (`python/tests/unit/test_providers_anthropic.py`,
> `python/tests/unit/test_eval_harness.py`) that pass the id through
> inertly and never resolve it against a PRICING lookup. All four of these
> were already correctly accounted for as non-bugs in the main REG-334 row
> above — none is a newly discovered gap.
>
> **No residual gap.** This section is retained rather than deleted, per
> this catalog's "removing an entry requires explicit user approval" norm —
> it now records the closed state instead of an open one.

### Invariants covered by this section

- P12 AI safety / provider — a live-path provider/model change is CEO-approved
  (satisfies the constitution's "AI model or provider changes" user-approval
  gate) and is now pinned by an explicit, clearly-named regression test rather
  than being provable only by reading source; a future accidental revert to
  Anthropic-primary fails this test immediately.
- Regression-catalog discipline — this entry supersedes REG-308's specific
  "Anthropic-primary" order examples without editing REG-308's own text; see
  the correction note prepended to REG-308's section above.

### Catalog total (Model Gateway OpenAI-primary swap)

Adds REG-334 (Model Gateway OpenAI-primary provider swap; authored this
session as REG-332, renumbered 2026-08-03 — see `00-header.md`'s collision
note). REG-333 (`select_quiz_questions_rag` verification gate, `origin/main`
— see `03-quiz-integrity.md`) was the prior addition once both branches'
histories are merged; REG-334 is the next free id after REG-333.
**Total catalog: 334 entries (target: 35 — TARGET EXCEEDED).**

---

## OpenAI-primary percentage-rollout mechanism (2026-08-03) — REG-335

> **RENUMBERED 2026-08-03 (merge with `origin/main`):** authored this session
> as REG-333, built on top of REG-332 (this file's Model Gateway swap entry
> directly above). `origin/main` had independently taken both REG-332 and
> REG-333 for two unrelated fixes and merged first, so this entry and the one
> above were renumbered up (REG-332→REG-334, REG-333→REG-335) during conflict
> resolution. No content changed; see `00-header.md`'s collision note.

> **CLOSURE NOTE 2026-08-03 (same-day testing follow-up; independently
> re-verified, not taken on any other agent's report alone):** both Known
> gaps below are now closed. This entry is upgraded from **PARTIAL (P)** to
> **E**.
>
> - **Known gap #1 (CI-wiring) — closed by architect.** `model-rollout-flag.test.ts`
>   is now enumerated in `DENO_TEST_TARGETS` in `.github/workflows/ci.yml`
>   (confirmed by direct read of the workflow file). Re-run fresh:
>   `deno test --no-lock --no-check --allow-read --allow-env` over all 20
>   CI-scope `grounded-answer/__tests__/` files (verified exactly 20 "running
>   N tests from" lines, not assumed) = **237/237 passed**, including the
>   15-test `model-rollout-flag.test.ts` suite confirmed present in the run
>   output. The prior "228/228 (19 CI-scope files + 1 new file)" framing no
>   longer applies now that the file is wired IN, not run alongside — it's
>   one 20-file CI-scope set. 237 vs the old 228 is not a discrepancy: the
>   other 19 files also grew tests from this session's cache-order-blindness
>   fix (`cache-redis.test.ts`, `gen-ctx.test.ts`, `claude.test.ts`, etc. are
>   all modified in the same working tree).
> - **Known gap #2 (protected-flags console-guardrail blind spot) — closed by
>   ai-engineer (TS companion) + testing (the two stale follow-up test files
>   this gap itself named).** `packages/lib/src/flags/protected-flags.ts` now
>   carries `ff_foxy_openai_primary_rollout_v1` in both `PROTECTED_FLAGS`
>   (tier `ai_provider`) and `EXPECTED_OFF_FLAGS` (confirmed by direct read).
>   `protected-flags-registry.test.ts` and `feature-flags-protected-guardrail.test.ts`
>   were verified failing in exactly the 5 predicted ways BEFORE any fix (3 +
>   2 failures, 62/67 passing, no other unexpected failures), then fixed
>   (PROTECTED_FLAGS 76→77, EXPECTED_OFF_FLAGS 55→56, `SEED_MIGRATION_PATHS`
>   +1 entry, plus 2 new dedicated tier/DB-parity pins for the new flag) and
>   re-verified fully green: **69/69 passing.** The exact-set-equality
>   migration-parsing derivation does NOT auto-pick-up a brand-new migration
>   file — confirmed empirically (red before the fix, green after), not
>   assumed — so the fix is a documented literal addition to the derived
>   set, the same established pattern already used for
>   `ff_irt_question_selection` and the 2 Pedagogy v2 flags.
>
> Also re-run fresh as part of this closure: `vitest run src/__tests__/lib/ai/`
> (486/486, 30 files, unchanged/still green) and the two cache-order-blindness
> fix files most directly under test, `model-order-cache-fix.test.ts` (2/2)
> and `cache-durable-l3.test.ts` (9/9), both run standalone. **Separately
> found, NOT part of this mechanism and NOT blocking this closure:**
> `pipeline.test.ts`'s "handleRequest: pipeline throws → 500 with structured
> upstream_error abstain" test fails (gets 401, not 500) — but this was
> confirmed, via a clean `git worktree` checkout of committed HEAD
> (`5e6ffa9f`), to already fail identically BEFORE any of this session's
> changes. Pre-existing, not a regression from this work, and the file is
> deliberately excluded from `DENO_TEST_TARGETS` (imports `../index.ts` →
> `Deno.serve()`, same as `pipeline.ts`'s CI-exclusion rationale elsewhere in
> `ci.yml`), so it is not currently CI-blocking either. Flagged for separate
> triage (ai-engineer/backend, `admitRequest`/`handleRequest` in
> `grounded-answer/index.ts`) — out of scope for this catalog entry, whose
> mechanism-specific coverage is unaffected by it.
>
> The Known-gap paragraphs below are left as-is (historical record of what
> was true at authoring time), per this catalog's "removing/rewriting an
> entry" discipline — this note documents what changed since.

Built ON TOP OF the already-committed, flat REG-334 swap (commit `5e6ffa9f`),
still uncommitted at review time: `ff_foxy_openai_primary_rollout_v1` (plain
`is_enabled`/`rollout_percentage` columns, seeded OFF/0% by a parallel
architect migration, `20260803120000_seed_ff_foxy_openai_primary_rollout_v1.sql`)
adds a deterministic, per-caller rollback lever so ops can dial a controlled
percentage of traffic BACK to the reconstructed Claude-primary order
(`CLAUDE_PRIMARY_FALLBACK_ORDER` in both `packages/lib/src/ai/gateway/registry.ts`
and the Deno mirror `supabase/functions/grounded-answer/config.ts`) instead of
REG-334's unconditional 100%-OpenAI-primary default, without a second flat
code deploy. Bucketing reuses the pre-existing, already-parity-tested
`hashForRollout` family (`packages/lib/src/feature-flags.ts` /
`supabase/functions/identity/index.ts`) — salted `hash(id + ':' + flagName) %
100` — deliberately NOT the three OTHER, unsalted/differently-salted
hash-bucketing implementations already in this codebase (`inRolloutBucket` in
`_shared/mol/feature-flag.ts` and `hashBucket` in `_shared/python-ai-proxy.ts`,
both salted by the caller id alone with no flag name in the hash; `shadowBucket`
in `grounded-answer/mol-shadow.ts`, salted by `task_type` not `flagName`) —
this review confirmed the distinction by direct side-by-side reading of all
four implementations' source (seed/accumulator/modulo expressions), not by
trusting the parity test's green result alone. Fail-safe direction is always
toward OpenAI-primary: no caller id, flag OFF, `rollout_percentage<=0`, or ANY
flag-read error all resolve to the shipped REG-334 default, and the no-caller-id
check runs BEFORE the flag/network read so an anonymous call never touches the
flag system at all (proved in Deno via a `stubFetchThrows` that would fail the
test if a network call were attempted). `resolveDefaultChain`
(`packages/lib/src/ai/gateway/rollout.ts`) is the sole new code path inside
`callModel`'s `default` policy; this review confirmed via direct `git diff
5e6ffa9f` that `LEGACY_FALLBACK_ORDER`, `legacyChain()`'s behavior, and
`router.ts`'s `selectModelChain` are byte-for-byte unchanged (`router.ts`'s only
change is an additive `export` on `passesConstraints`), and that `gateway.ts`'s
only behavioral change is a single ternary that takes the new path exclusively
when `effectivePolicy === 'default'` — so REG-334's own pin (`router.test.ts`:
"default chain is OpenAI-primary post 2026-08 cost directive, Claude retained
as fallback") never traverses the new code at all and remains a valid,
structurally-unmodified regression guard, re-run and reconfirmed green by this
review.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-335 | `model_gateway_openai_primary_rollout_percentage_lever_p12` | **New regression pin:** (1) no-caller-id / caller-id-with-flag-OFF / flag-absent-or-erroring all resolve to the unchanged OpenAI-primary chain, with the no-id case proven to never call `isFeatureEnabled` at all; (2) caller-id-with-flag-ON (in-bucket) resolves to the reconstructed `CLAUDE_PRIMARY_FALLBACK_ORDER`/`claudePrimaryChain`, asserted on both model ids AND providers, end-to-end through `callModel` with fake adapters (not just the pure resolver in isolation) including a fallback-within-the-Claude-primary-chain case; (3) TS↔Deno hash-bucketing PARITY (`hashForRollout`/`_model-rollout-flag.ts`) via a 6-uuid matrix plus a source-text pin on the three load-bearing expressions; (4) TS↔Deno FALLBACK-TABLE parity for `CLAUDE_PRIMARY_FALLBACK_ORDER` itself (extends the existing `deno-parity.test.ts`, same technique as the pre-existing `MODEL_FALLBACK_ORDER` pin, plus an explicit "diverges from the OpenAI-primary table" sanity check) — found by this review in the diff, not named in the original change-set summary handed to testing; (5) Deno-only: determinism, integer range [0,99], a 2000-sample decile-uniformity sanity check (generous ±50%-of-expected tolerance band, ~7 standard deviations wide at N=2000 — explicitly documented in its own source comment as a badly-broken-hash sanity check, not a rigorous statistical test, which this review judges to be an honest and sound framing), and exact `rollout_percentage=0`/`=100` boundary behavior over 25 callers each plus a mid-ramp (30%) check against 200 callers verifying BOTH sides of the bucket boundary are populated; (6) `rollout_percentage` clamped to [0,100] and cached 5 minutes (one fetch observed across 3 calls); (7) `callerId` (`request.student_id`) threaded identically through every `callClaude` call site in both `pipeline.ts` and `pipeline-stream.ts` — initial call, retry, and bounded-continuation — so a single answer's provider order cannot flip mid-flow (confirmed by direct diff, not exercised by a dedicated pipeline-level test). **Independently reproduced by testing, not taken on ai-engineer's report alone:** fresh `deno test --no-lock --no-check --allow-read --allow-env` over the 19 CI-scope `grounded-answer/__tests__/` files + the new file = 228/228 (213 + 15, both sub-counts independently re-verified in isolation); fresh `npx vitest run src/__tests__/lib/ai/` = 486/486 (30 files); fresh `tsc --noEmit` (`npm run type-check`) = exit 0. A claimed "599/599 consolidated flag-registry-sensitive run" could NOT be exactly reproduced — three good-faith reconstructions of a plausible file set (import-based: 525/525; filename-based: 505/505; directory+file-list based: 620/620) all passed 100% but none matched 599 exactly; flagged as imprecisely specified rather than as a failure, since no reconstruction attempt found any failing test. **Known gap #1 (CI-enforcement, found by this review):** `supabase/functions/grounded-answer/__tests__/model-rollout-flag.test.ts` (the 15-test Deno suite covering items 3, 5, and 6 above) is NOT YET added to `DENO_TEST_TARGETS` in `.github/workflows/ci.yml` — it passes locally but does not currently run in CI, so a future regression in the Deno-side hash/bucketing/fail-safe logic would not be caught automatically until this is wired in (the same failure class REG-317 pinned elsewhere in this codebase — a Deno test that exists but was never wired into the CI-run set). **Known gap #2 (adjacent to this mechanism's own correctness; found by this review):** a parallel architect migration (`20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql`) registers this flag in `protected_feature_flags` at tier `ai_provider`, but its self-documented TS companion (`packages/lib/src/flags/protected-flags.ts` PROTECTED_FLAGS/EXPECTED_OFF_FLAGS entries) is not yet applied, and neither is testing's own follow-up (the `protected-flags-registry.test.ts` 76→77/55→56 count-pin bump and the `feature-flags-protected-guardrail.test.ts` `SEED_MIGRATION_PATHS` addition). This review confirmed BOTH existing DB/TS parity tests currently pass GREEN specifically because their parser is still blind to the new migration file — i.e. the console typed-confirmation guardrail does not yet cover this flag. Low practical risk today only because the flag is seeded OFF/0% (a live no-op); should close before any ramp. | `packages/lib/src/ai/gateway/rollout.ts` (10 new tests, `apps/host/src/__tests__/lib/ai/gateway/rollout.test.ts`), `apps/host/src/__tests__/lib/ai/gateway/model-rollout-hash-parity.test.ts` (5 new tests), `apps/host/src/__tests__/lib/ai/gateway/deno-parity.test.ts` (+6 new tests, 5→11 total, `CLAUDE_PRIMARY_FALLBACK_ORDER` parity block), `apps/host/src/__tests__/lib/ai/gateway/gateway.test.ts` (+4 new tests in a dedicated "percentage-rollout mechanism" block, 13→17 total); `supabase/functions/grounded-answer/_model-rollout-flag.ts` (`supabase/functions/grounded-answer/__tests__/model-rollout-flag.test.ts`, 15 new Deno tests — NOT in `DENO_TEST_TARGETS`, see Known gap #1); source under test `packages/lib/src/ai/gateway/{rollout,gateway,router,registry,index}.ts`, `supabase/functions/grounded-answer/{claude,config,pipeline,pipeline-stream}.ts`, `packages/lib/src/flags/registries/foxy.ts` (`MODEL_ROLLOUT_FLAGS`), `packages/lib/src/grounding-config.ts` + `supabase/functions/grounded-answer/config.ts` (`MODEL_ROUTE_REV` 2→3, kept in parity); migrations `20260803120000_seed_ff_foxy_openai_primary_rollout_v1.sql` + `20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql` (structural only, no live-DB execution in this pass) | E |

### Catalog total (OpenAI-primary percentage-rollout mechanism)

Adds REG-335 (percentage-rollout lever on top of REG-334; authored this
session as REG-333, renumbered 2026-08-03 — see `00-header.md`'s collision
note). REG-334 was the prior addition (2026-08-02, Model Gateway OpenAI-primary
provider swap — see above); REG-335 is the next free id after REG-334, per
`00-header.md`.
**Total catalog: 335 entries (target: 35 — TARGET EXCEEDED).** Originally
marked **PARTIAL (P)**, not E, for Known gap #1 above (the new Deno suite's
CI-wiring) plus Known gap #2 (the protected-flags console-guardrail blind
spot) — the mechanism's own correctness coverage (TS + Deno, both runtimes,
hash parity, fallback-table parity, boundary, determinism, uniformity,
end-to-end `callModel` integration) was always real, independently re-run by
testing, and passing in full. **UPGRADED to E 2026-08-03** (same-day testing
follow-up) — see the closure note directly under this section's heading
above for the fresh evidence on both gaps.

---

## GenAI Phase 2 — Unified Student Memory read-API + DPDP erasure suppression (2026-07-24) — REG-309

The Unified Student Memory read-API (`getStudentMemory` in
`apps/host/src/lib/memory/student-memory.ts`, plus the two app-independent leaves
`packages/lib/src/memory/erasure-guard.ts` + `preferences.ts`) WRAPS the three
existing Foxy-family learner-state readers (cognitive context, digital twin,
~30d long-memory) into one typed `StudentMemory` — it invents NO new mastery
math and NO new thresholds (spec §7). It is purely additive and flag-gated behind
`ff_unified_memory_v1` (default OFF). The whole point of Phase 2 is that the
flag-OFF world at `/api/foxy` is **byte-identical** to today (the route aliases
its existing per-slice sub-contexts when OFF; when ON it injects those SAME
already-per-user-gated contexts into `getStudentMemory`), so this catalog entry
pins the four ways that guarantee could silently break, PLUS the one genuinely
new behavior: a DPDP erasure-pending guard that suppresses a mid-erasure
student's history from any AI prompt. This is a **WHAT vs HOW read-only
boundary** — the memory model READS learner state (WHAT is mastered) and advisory
preferences (HOW to explain); it WRITES nothing (no mastery, XP, gaps, review
schedules — spec §6). Owner: testing (tests) / ai-engineer + architect (memory
source). Maps to P13.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-309 | `unified_student_memory_erasure_suppression_and_flag_off_identity_p13` | **(a) DPDP erasure suppression — FAIL-CLOSED (the one new behavior):** `isErasurePending` queries `public.data_erasure_requests` filtered by `student_id` and `status IN ('pending','purging')` on the SERVICE-ROLE admin client (an RLS-scoped read would fail OPEN — the table has no student SELECT policy); a `pending` OR `purging` row trips → `true`; the terminal statuses `cancelled`/`completed`/`failed` never satisfy the filter → zero rows → `false`; and ANY query error, thrown client, or rejected promise ALSO returns `true` (fail-closed — a privacy guard must never fail open). `ERASURE_IN_FLIGHT_STATUSES === ['pending','purging']`. **(b) getStudentMemory short-circuit:** when the erasure guard returns `true` (or the injected check itself throws), the result is fully EMPTY (`isEmpty:true`, `cognitive===EMPTY_COGNITIVE_CONTEXT`, `twin===null`, `longMemory===EMPTY_LONG_MEMORY`, `preferences===EMPTY_PREFERENCES`) AND all four sub-readers are called ZERO times — the learner-state tables are never even queried for a mid-erasure student. When the guard returns `false` the four sub-readers ARE each called once. **(c) Flag-OFF byte-identity basis (passthrough):** for a non-erased student the composed `StudentMemory` embeds the EXACT sub-context objects by REFERENCE (`result.cognitive===fakeCognitive`, `.twin===fakeTwin`, `.longMemory===fakeLong`, `.preferences===fakePrefs`) — no clone, no re-derive — which is the invariant that makes flag-ON == flag-OFF at the route; the cognitive misconception labels are threaded into the long-memory reader in the route's existing order. **(d) Fail-soft composition (never throws):** a rejecting sub-reader degrades ONLY its own slice to the canonical empty value (cognitive→`EMPTY_COGNITIVE_CONTEXT`, twin→`null`, long→`EMPTY_LONG_MEMORY`, prefs→`EMPTY_PREFERENCES`) while every other slice still populates; even all-four-throwing returns empty memory rather than rejecting into the caller. **(e) Renderer parity + PII-clean (P13):** `renderStudentMemoryPromptSection(empty)===''`; for populated memory the output EQUALS the join of the three EXISTING per-slice renderers (`buildCognitivePromptSection` + `renderTwinPromptSection` + `buildLongMemoryPromptSection`) so it is identical to today's per-reader assembly; the rendered block contains no email, no 10-digit phone, no raw UUID, and never the raw `studentId`. **(f) Preferences slice:** `loadStudentPreferences` maps `learning_style`/`preferred_explanation_depth` from `student_learning_profiles`, and any missing row / null data / query error / thrown client → `EMPTY_PREFERENCES` (never invents a value). | `apps/host/src/__tests__/lib/memory/erasure-guard.test.ts` (9), `preferences.test.ts` (6), `student-memory.test.ts` (16); source under test `apps/host/src/lib/memory/student-memory.ts`, `packages/lib/src/memory/erasure-guard.ts`, `packages/lib/src/memory/preferences.ts` | E |

### Invariants covered by this section (Unified Student Memory)

- P13 data privacy — the DPDP erasure guard suppresses a mid-erasure student's
  learner-state from any AI prompt (rows still physically exist during the
  two-stage cron cascade), runs on the service-role client so it cannot fail
  open, and is FAIL-CLOSED on any error. The rendered prompt block is PII-clean
  by construction (content-only labels + counts; no email/phone/UUID/studentId).
- WHAT/HOW read-only boundary — the memory model READS learner state (WHAT) and
  advisory preferences (HOW to explain); it WRITES nothing and derives no new
  mastery math or thresholds (spec §6/§7).
- Additive-no-op guarantee — flag-OFF the route aliases its existing sub-contexts
  (byte-identical); flag-ON injects those SAME reference-identical contexts into
  `getStudentMemory`, so shipping Phase 2 changes zero prompt bytes for a
  non-erased student until an operator flips `ff_unified_memory_v1`.
- Fail-soft composition — a single sub-read failure degrades only its slice; the
  orchestrator never throws into the Foxy request path.

> **Suppression boundary — known residual gap (2026-07-24).** The DPDP
> erasure suppression in `getStudentMemory` covers ONLY the three wired slices
> (cognitive context + digital twin + ~30d long-memory, plus the misconception
> labels threaded through them) and the advisory preferences slice. It does
> **not** cover `teachingDirectorSection` (the Foxy teaching-director prompt
> path), which assembles learner state OUTSIDE `getStudentMemory` and is
> therefore NOT erasure-suppressed. Consequence: `ff_unified_memory_v1` MUST NOT
> be enabled in production alongside `ff_foxy_teaching_director_v1` until the
> teaching-director path is unified behind the same erasure guard — otherwise a
> mid-erasure student's history could still reach an AI prompt via the
> unsuppressed teaching-director path. This keeps the catalog honest about the
> current suppression boundary; closing the gap is a tracked follow-up.

### Catalog total (Unified Student Memory)

GenAI Phase 2 adds REG-309 (Unified Student Memory read-API — DPDP erasure
suppression + flag-OFF byte-identity + fail-soft composition + PII-clean render).
REG-308 was the prior addition (GenAI Phase 1 Model Gateway); REG-309 is the next
free id after REG-308.

---

## GenAI Phase 3 — Agent Registry + WHAT/HOW boundary (2026-07-24) — REG-310

The Agent Registry (`packages/lib/src/agents/registry.ts`, imported via
`@alfanumrik/lib/agents/registry`) is PURE METADATA + one reusable pure detector.
It is ADDITIVE and INERT at runtime: NO feature flag, NO migration, NO
orchestrator activation, and it changes NO agent's behavior (spec §3). It encodes
the platform's central learner-state invariant per-agent — **the adaptive engine
alone decides WHAT the student learns; the 7 GenAI agents decide only HOW, and
MAY NOT write mastery/progression.** The `decides: 'HOW'` and
`mayWriteMastery: false` fields are LITERAL types, so a WHAT-deciding or
mastery-writing agent is unrepresentable at compile time; this catalog entry
re-asserts the contract at runtime (catching any `as`-cast escape) and, most
importantly, adds **the teeth**: a static proof that NO live agent surface
directly writes any of the 9 forbidden mastery tables. Mastery moves onto those
tables ONLY through the concept-check / BKT projector path
(`learner.concept_check_answered` → `concept-mastery-projector`) + the
`mastery-state-writer` — no agent is on that allowlist. Owner: testing (tests) /
ai-engineer + architect (registry source). Maps to the core adaptive-decides-WHAT
learner-state boundary; P1/P2 scoring-integrity-adjacent (grading stays in the
deterministic `submitQuizResults()` → `atomic_quiz_profile_update()` path — the
Assessment agent generates question *content* only, never grades or persists
mastery).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-310 | `agent_registry_what_how_boundary_no_live_mastery_write` | **(a) 7-agent stable set:** `AGENT_REGISTRY` has EXACTLY 7 agents whose ids equal the immutable set `['tutor','assessment','teacher_copilot','parent_intelligence','lesson','outcome_prediction','content_generation']` (`listAgents()` length 7). **(b) HOW-only + no mastery write:** EVERY agent has `decides === 'HOW'` AND `mayWriteMastery === false` (runtime re-assertion of the literal types). **(c) Identity integrity:** all ids unique AND each descriptor's `id` equals its record key AND `getAgent(id)` round-trips to the same object. **(d) Entry-point reality:** every LIVE agent (`tutor`→`apps/host/src/app/api/foxy/route.ts`, `assessment`→`supabase/functions/quiz-generator/index.ts`, `teacher_copilot`→`supabase/functions/teacher-dashboard/index.ts`, `parent_intelligence`→`supabase/functions/parent-report-generator/index.ts`) has a NON-null `entryPoint` that is a real FILE on disk (resolved with a cwd-resilient repo-root resolver — vitest runs from `apps/host`, but entryPoints reach repo-root `supabase/functions/**` OUTSIDE it); every PLANNED agent (`lesson`/`outcome_prediction`/`content_generation`) has `entryPoint === null`; the live set is exactly those 4. **(e) THE TEETH — no live mastery write:** for every LIVE agent, its `entryPoint` source AND (when present) every file under its co-located `_lib/` dir (Foxy's `apps/host/src/app/api/foxy/_lib/`) is scanned with `findMasteryWrites`, and the result MUST be empty — no live agent surface directly writes any of the 9 forbidden mastery tables (`concept_mastery`, `learner_mastery`, `cme_concept_state`, `student_skill_state`, `knowledge_gaps`, `cme_error_log`, `bloom_progression`, `adaptive_mastery`, `student_learning_profiles`); reads are fine; a regression fails with the offending agent+table+file. **(f) Flag hygiene:** every non-null `gatingFlag` exists in `FLAG_DEFAULTS`, and NO agent gates on `ff_orchestrator_v1` (the orchestrator is not an agent and stays dormant). **Detector unit (`findMasteryWrites`):** positive — flags `.insert`/`.update`/`.upsert`/`.delete` on forbidden tables, whitespace/newline-tolerant, quote-agnostic, dedupes + sorts multiple tables; negative — does NOT flag `.select` reads, non-forbidden-table writes, substring look-alikes (`concept_mastery_audit`), or forbidden names appearing only in comments/string-literals. | `apps/host/src/__tests__/agents/agent-registry-conformance.test.ts` (8), `find-mastery-writes.test.ts` (16); source under test `packages/lib/src/agents/registry.ts` | E |

### Invariants covered by this section (Agent Registry WHAT/HOW boundary)

- Adaptive-decides-WHAT learner-state boundary — the 7-agent registry is HOW-only
  (`decides: 'HOW'`, `mayWriteMastery: false`) and, provably, NO live agent
  surface writes any of the 9 mastery/progression tables. The adaptive engine
  alone decides WHAT; mastery moves only through the concept-check/BKT projector
  path.
- P1 Score accuracy / P2 XP economy (adjacency) — grading + XP remain in the
  deterministic `submitQuizResults()` → `atomic_quiz_profile_update()` path; the
  Assessment agent produces question *content* only and never grades or persists
  mastery, so the registry cannot become a back-door to the scoring formula.
- Additive-inert guarantee — the registry adds no flag, migration, or runtime
  activation; invariant (f) pins that no descriptor references a phantom flag or
  the dormant `ff_orchestrator_v1`.

### Catalog total (Agent Registry)

GenAI Phase 3 adds REG-310 (Agent Registry + WHAT/HOW boundary — 7-agent HOW-only
registry + the static no-live-mastery-write proof). REG-309 was the prior
addition (GenAI Phase 2 Unified Student Memory); REG-310 is the next free id after
REG-309.
**Total catalog: 310 entries (target: 35 — TARGET EXCEEDED).**

---

## GenAI Phase 4 — Runtime `ResponseEval` observability sensor (2026-07-24) — REG-311

The runtime `ResponseEval` sensor (`packages/lib/src/ai/eval/`, imported via
`@alfanumrik/lib/ai/eval`) scores every Foxy response across 9 dimensions on a
common `[0,1]` health scale (higher = better) and emits a PII-free record to
`ops_events`. It is ADDITIVE, flag-gated `ff_response_eval_v1` (default OFF), and
**OBSERVABILITY-ONLY**: it NEVER blocks, delays, refunds, retries, or alters a
response — `flagged` is a dashboard signal, not an enforcement action
(enforcement stays in the pre-existing live `screenStudentFacingText` abstain
path). `scoreResponse` is a PURE composer (no I/O, no clock, no LLM call, no
throw on well-formed input) over signals the route already holds at its grounded
terminal — no new LLM call / retrieval / DB read is introduced. Two dimensions
that need a judge (`accuracy`, `learning_effectiveness`) are DEFERRED
(`available:false`, `score:null`, `source:'deferred_llm_judge'`) and populated
offline by the nightly Sonnet judge. Emission is fire-and-forget via `logOpsEvent`
(`severity:'info'`) and NEVER throws into the response path. With the flag OFF the
builder is not invoked at all → the response path is byte-identical. Owner:
testing (tests) / ai-engineer + ops (sensor source) / assessment (dimension
semantics, spec §8). Maps to P12 (AI-safety observability — read-only, additive)
and P13 (no-PII — codes/ids/enums/numbers only). No change to P1–P6/P7–P11/P14–P15.
Spec: `docs/superpowers/specs/2026-07-24-runtime-response-eval-design.md`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-311 | `runtime_response_eval_9dim_sensor_observability_only` | **(a) Per-dimension normalization (all 9 dims, incl. boundaries):** `curriculum_alignment` `inScope?1:0` with `code=reason\|'in_scope'` and `raw:null`; `hallucination_risk` `raw=confidence`, health = `confidence` when grounded+citations else capped at `UNGROUNDED_CONFIDENCE_CAP` (0.6), codes `grounded/no_citations/ungrounded`, null confidence → null score; `age_appropriateness` 1.0 clean / 0.5 advisory (`legacy_validator_flag`, grade-range soft-fail) / 0.0 hard-fail (`blocklist`/`screen_error`); `toxicity` binary 0 on `blocklist`/`screen_error` else 1 (ignores the age-only `legacy_validator_flag`); `difficulty_fit` mastery bands with boundaries at EXACTLY 0.4/0.7/0.85 → 1.0 in-ZPD, 0.5 else, `raw=mastery`, null→unavailable; `latency` 1.0 ≤800ms (`LATENCY_HEALTHY_MS`), linear to 0.0 at 8000ms (`LATENCY_DEGRADED_CEILING_MS`), boundary 8000 = 0 health but NO flag; `cost` 1.0 ≤budget (≈$0.0492 derived from registry Haiku pricing), linear to 0.0 at ceiling ($0.25), boundary at ceiling = 0 health but NO flag; `accuracy` + `learning_effectiveness` ALWAYS `available:false`/`score:null`/`raw:null`/`source:'deferred_llm_judge'` regardless of signals. Constants bind to the live pipeline (`HALLUCINATION_CONFIDENCE_FLOOR`=0.75, `UNGROUNDED_CONFIDENCE_CAP`=0.6 from grounding-config; `LATENCY_HEALTHY_MS`=800 from gateway registry). **(b) The 6 flag conditions (observability only):** each of `toxicity_unsafe`/`age_inappropriate`/`curriculum_out_of_scope`/`hallucination_risk_high` (confidence < floor AND `!groundedFromChunks`; boundary EXACTLY at 0.75 and grounded-below-floor do NOT fire)/`latency_over_ceiling` (raw>8000, strict)/`cost_over_ceiling` (raw>0.25, strict) fires ONLY under its exact condition; a clean response → `flagged:false, flagReasons:[]`; `difficulty_fit` at its poorest bands (0.1/0.99) and the 2 deferred dims NEVER contribute a flag; multiple simultaneous flags accumulate sorted + deduped. **(c) PII-clean fire-and-forget emission:** `logResponseEval` calls the injected `logOpsEvent` EXACTLY once with `category:'ai'`/`source:'response-eval'`/`severity:'info'`/`message:'response_eval'`/`subjectType:'foxy_message'`; the emitted `context` carries the 9 dim scores/raws/codes + `flagged`/`flag_reasons` + correlation UUIDs + `grade`/`subject` scope enums ONLY — NO PII-shaped key (`/email\|phone\|name\|token/i`) and NO free-text string leaf (every string leaf whitespace-free ≤64 chars, so no response/message prose can ride along). **(d) Never-throw:** a synchronously-THROWING injected `logOpsEvent` still resolves `logResponseEval`/`evaluateAndEmit` cleanly (no throw into the response path); `scoreResponse` never throws on well-formed OR out-of-range-but-finite input. **(e) Flag-OFF byte-identity:** the route invokes the sensor only behind `isFeatureEnabled('ff_response_eval_v1')` (default OFF); the existing Foxy route characterization + grade-spoof-hard-block suites (42 tests) exercise the flag-OFF response path unchanged and are re-run green alongside these tests. | `apps/host/src/__tests__/lib/ai/eval/response-eval.test.ts` (51), `emit.test.ts` (6); flag-OFF byte-identity via `apps/host/src/__tests__/api/foxy/route-characterization.test.ts` + `grade-spoof-hard-block.test.ts` (42); source under test `packages/lib/src/ai/eval/response-eval.ts` + `emit.ts` | E |

### Invariants covered by this section (runtime ResponseEval sensor)

- P12 (AI-safety observability) — the sensor is a read-only measurement of the
  9 safety/quality/cost dimensions taken at the grounded terminal; it records
  what happened (toxicity/age/scope/hallucination flags) but NEVER blocks or
  alters the response. Enforcement remains the pre-existing live
  `screenStudentFacingText` abstain path — the sensor only records that it fired.
- P13 (no-PII) — the emitted `ops_events` context is codes/ids/enums/numbers
  ONLY (dimension scores/raws/codes + flag reasons + correlation UUIDs + grade/
  subject scope enums); NO response/prompt text, chunk_text, or PII-shaped key,
  backstopped by `logOpsEvent`'s `redactContext`.
- Additive / default-OFF / byte-identity — `ff_response_eval_v1` OFF means the
  builder is not invoked at all, so the response path is byte-identical (proven
  by the re-run 42-test flag-OFF route suites). The 2 deferred dims keep the
  runtime sensor from making any synchronous judge call.

### Catalog total (runtime ResponseEval)

GenAI Phase 4 adds REG-311 (runtime `ResponseEval` observability sensor — 9-dim
normalization + 6 flag conditions + PII-clean fire-and-forget emission +
never-throw + flag-OFF byte-identity + 2 deferred dims). REG-310 was the prior
addition (GenAI Phase 3 Agent Registry); REG-311 is the next free id after
REG-310.
**Total catalog: 311 entries (target: 35 — TARGET EXCEEDED).**

---

## GenAI Phase 5a — read-only Outcome Prediction Agent (2026-07-24) — REG-312

The Outcome Prediction Agent is the platform's first forward-looking learner
projection: a PURE composer (`packages/lib/src/predict/outcome-prediction.ts`,
`composeOutcomePrediction`, assessment-owned) behind a read-only GET route
(`apps/host/src/app/api/predict/outcome/route.ts`, backend-owned), additive and
flag-gated `ff_outcome_prediction_v1` (default OFF). It COMPOSES the platform's
EXISTING predictors into one unified, typed `OutcomePrediction` — it invents NO
new prediction math, NO new confidence formula, and **NO pass-mark constant**:
"pass" is expressed only via the EXISTING CBSE bands, with the D→C1 boundary
DERIVED from `calculateBoardExamScore`'s grade oracle (never a hardcoded 50). It
NEVER recomputes the board score — precomputed `board_score_predictions` /
`cme_exam_readiness` rows are read verbatim — and it registers as a **LIVE** agent
that provably writes NO mastery (registry invariant e). The route is the sanctioned
Pulse-precedent read pattern: RLS-scoped self reads, `canAccessStudent`-gated
service-role cross-student reads, no payload on any deny. Owner: testing (tests) /
assessment (composer) + backend (route). Maps to P8 (IDOR — `canAccessStudent` is
the single cross-student data boundary) + P13 (no PII on deny; metadata-only
audit), the WHAT/HOW read-only boundary (a HOW-only agent that writes nothing —
not mastery, not the board rows it reads), and P1/P2-adjacent (prediction
composed from, but never a back-door into, the deterministic scoring/XP path).
Spec: `docs/superpowers/specs/2026-07-24-outcome-prediction-agent-design.md`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-312 | `outcome_prediction_readonly_4tier_compose_and_idor_safe_read` | **(a) 4-tier ladder selection:** tier-1 `board_score_predictions` → `source:'board_score_predictions'`, range low/mid/high + `confidenceBand` read verbatim from the row and `confidence = coverage_pct/100` (NOT a synthesized formula); tier-2 memory-derived `chapters` (no board row) → `source:'pure_predict_exam_score'` with `midMarks`/`confidence` EQUAL to a real `predictExamScore(chapters, totalMarks)` call (delegation, not re-implementation); tier-2′ only `cme_exam_readiness` → `source:'cme_exam_readiness'`, `predicted_marks` read as the mid, `confidence = overall_score/100`; tier-3 nothing usable → `source:'insufficient_data'`, `sufficientData:false`, `boardScoreRange:null`, `confidence.overall:0`, `passLikelihood.band:'unknown'`/`likelihood:null`. Ladder PRECEDENCE board > chapters > cme (all present → board; board removed → chapters); a non-finite `predicted_pct` skips tier-1 and falls through. **(b) No pass-mark constant — derived boundary:** `passLikelihood.basis` reports the SAME D→C1 boundary independently computed from `calculateBoardExamScore` (the smallest whole-% the oracle grades NOT 'D'), and that boundary really is the D-seam (`grade(boundary)!=='D'` AND `grade(boundary-1)==='D'`); likelihood/band move MONOTONICALLY across positions — well above → `likely`/1, straddling → `borderline`/(0,1), entirely below → `at_risk`/0 (band rank + likelihood both non-decreasing). **(c) Deterministic composition (no LLM):** `weakConcepts` includes weak topics STRICTLY below `PULSE_THRESHOLDS.at_risk_mastery` (0.4) and excludes a topic AT exactly 0.4 (reused verbatim, strict `<`), collects knowledge-gaps + cme/board weak chapters, and sorts weakest-first (known masteries ascending, unknown-mastery gaps last); `interventionRecommendations` emits one rec per triggered branch (`remediate_prerequisite`/`review_regression`/`revise_chapter`/`concentrate_subject`/`resume_practice`) with stable ascending ordinal `priority` (root-cause remediate ranks ahead of resume); `rationale` is an array of structured `{code, detail}` string drivers (`source` always present, plus `weak_prerequisites`/`board_coverage`/`learning_velocity` when their inputs exist) — never free-form text; `atRiskSignals.anyAtRisk` mirrors the pulse verdicts (loud→true, quiet→false, absent→false+null); P5 grade STRING + subject + learningVelocity pass through verbatim. **(d) Purity:** identical inputs → deeply-equal output; NEVER throws on minimal/empty/malformed inputs (Infinity/NaN/negative/null); `confidence.overall` and `likelihood` always stay within `[0,1]`. **(e) Route flag gate:** flag OFF (default) → 404-style `{success:false}` BEFORE any auth/DB/memory work (`authorizeRequest`/`canAccessStudent`/`getSupabaseAdmin`/`createSupabaseServerClient`/`getStudentMemory` all uncalled) — a true no-op, no prediction shape leaks. **(f) Self path (P8):** `studentId` omitted OR `=== own` → reads via the RLS-scoped `createSupabaseServerClient` and returns `{success, data:{schemaVersion:1, ...prediction}}`; `canAccessStudent` and the service-role client are NEVER called. **(g) Cross-student IDOR boundary (P8/P13):** `canAccessStudent(callerId, targetId)` is consulted FIRST — false → **403 with NO payload** (no `boardScoreRange`/`passLikelihood` in the body), `getSupabaseAdmin`/`getStudentMemory` never reached, denial audited `status:'denied'`/`reason:'no_relationship'`; true → service-role read via `getSupabaseAdmin` (RLS client NOT used) + a prediction returned. **(h) Subject + fail-soft:** no subject param and none inferable → 400 `SUBJECT_REQUIRED`; every optional sub-read throwing (board/weights/cme/memory/pulse) still yields a 200 `insufficient_data` — the composer degrades, the route never 500s. **(i) Read-only:** the route module source (comments stripped) contains no `.insert(`/`.update(`/`.upsert(`/`.delete(`. **(j) Registry — LIVE + no mastery write:** the agent-registry conformance suite's live-set sanity now includes `outcome_prediction` (5 live agents), so invariant (d) [entryPoint `apps/host/src/app/api/predict/outcome/route.ts` exists on disk] and invariant (e) [`findMasteryWrites` over the entryPoint + co-located `_lib/` → empty] PASS for the new route — the route reads `learner_mastery` via `.select` (a permitted READ) and writes none of the 9 forbidden mastery tables; invariant (f) [`ff_outcome_prediction_v1` ∈ `FLAG_DEFAULTS`] holds. | `apps/host/src/__tests__/lib/predict/outcome-prediction.test.ts` (20), `apps/host/src/__tests__/api/predict/outcome-route.test.ts` (8), `apps/host/src/__tests__/agents/agent-registry-conformance.test.ts` (updated live-set, 8); source under test `packages/lib/src/predict/outcome-prediction.ts` + `apps/host/src/app/api/predict/outcome/route.ts` | E |

### Invariants covered by this section (Outcome Prediction Agent)

- P8 (IDOR / cross-student boundary) — `canAccessStudent` is the SINGLE
  cross-student data boundary, enforced FIRST on the cross path (false → 403, no
  payload, no service-role read); the self path relies on RLS and never touches
  the service role or the boundary check.
- P13 (no PII) — no student payload on any deny path (403 body carries only the
  `{success:false, error}` envelope, no prediction shape); the success audit is
  metadata-only (`subject`/`source`/`self`), never message/name/email/phone.
- WHAT/HOW read-only boundary — a HOW-only LIVE agent that writes NOTHING: not
  mastery/progression (registry invariant e — `findMasteryWrites` empty over the
  route), not XP, and specifically not the `board_score_predictions` /
  `cme_exam_readiness` rows it reads verbatim (owned by cron/edge).
- P1/P2 (adjacency) — the prediction is COMPOSED from the deterministic
  predictors but is never a back-door into the scoring/XP formula; there is NO
  new pass-mark constant — the D→C1 boundary is derived from
  `calculateBoardExamScore`, and the board score is never recomputed.
- Additive / default-OFF — `ff_outcome_prediction_v1` OFF short-circuits to a
  404-style no-op before any auth/DB/memory work, so the endpoint surfaces no
  prediction until an operator flips the flag.

### Catalog total (Outcome Prediction Agent)

GenAI Phase 5a adds REG-312 (read-only Outcome Prediction Agent — 4-tier compose
with no pass-mark constant + no board-score recompute, self-vs-cross-student
IDOR-safe read pattern, LIVE registered agent with zero mastery writes). REG-311
was the prior addition (GenAI Phase 4 runtime ResponseEval); REG-312 is the next
free id after REG-311.
**Total catalog: 312 entries (target: 35 — TARGET EXCEEDED).**

---

## GenAI Phase 5b — Lesson Generation Agent (2026-07-24) — REG-313

The Lesson Generation Agent is the platform's FIRST student-facing GENERATIVE
artifact: on-demand, NCERT-grounded, bilingual multi-section lesson notes for one
chapter. It is a PURE planner (`packages/lib/src/lesson/lesson-plan.ts`,
`planLesson`/`renderAdaptationCodes`, assessment-owned) + a grounded-generation
ORCHESTRATOR (`packages/lib/src/lesson/generate-lesson.ts`, `generateLessonNotes`,
ai-engineer-owned) behind a read-only GET route
(`apps/host/src/app/api/lesson/route.ts`, backend-owned), additive and flag-gated
`ff_lesson_generation_v1` (default OFF). It decides only HOW to present a chapter
(structure / depth / tone / which misconceptions to call out) from EXISTING
unified-memory signals — it re-derives NO mastery, invents NO threshold literal
(`memory.masteryLevel` is used VERBATIM), and writes NOTHING. Because it is
GENERATIVE and student-facing, the safety spine is doubled: grounded path ONLY
(one `callGroundedAnswer`, single RAG retrieval — REG-50 spirit), an abstain
ladder (grounded=false OR `confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD` 0.75
OR parse-empty), and a Node-side `screenStudentFacingText` backstop on EVERY EN +
Hindi field (unsafe section dropped, all-dropped → whole-lesson abstain). It is
fail-soft (never throws → abstain) and registers as a **LIVE** agent that provably
writes NO mastery (registry invariant e). The route is student-self ONLY — it
serves the caller's OWN `auth.studentId`, has NO `?studentId` cross-student path,
NO `canAccessStudent`, and NO service-role/admin client. Owner: testing (tests) /
assessment (planner) + ai-engineer (orchestrator) + backend (route). Maps to P12
(AI safety — grounded-only, strict-mode abstain, per-field screen, no unfiltered
LLM output) + P7 (bilingual — EN + Hindi per section + bilingual abstain copy) +
the WHAT/HOW read-only boundary (a HOW-only agent that writes nothing) + P5 (grade
STRING) + P13 (adaptation codes/enums only; category-only logs).
Spec: `docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-313 | `lesson_generation_grounded_only_abstain_ladder_bilingual_screen_flagoff_selfscope` | **(a) Pure planner band anchors:** `masteryLevel` low → `bloomCeiling:'understand'`/`scaffolding:'heavy'`/NO `application` section, medium → `'apply'`/`'moderate'`/application present, high → `'evaluate'`/`'light'`/application present (band VERBATIM, no re-derived mastery, no threshold literal). **(b) Misconception codes + callout gating:** `recentMisconceptions` → `misconceptionCodes` (empty codes filtered) AND `misconception_callouts` section present iff ≥1 real code; no misconceptions (or only-blank codes) → empty codes + no callout section. **(c) emphasisTopics:** weakTopics first then knowledge-gap prerequisites, de-duped (first wins), order-stable, blank/whitespace dropped. **(d) Preferences → depth/persona:** `preferredExplanationDepth` maps case-insensitively (detailed→deep, short→brief, unknown→standard); explicit `request.depth` WINS; `learningStyle` → persona (visual→visual, kinesthetic→concrete, unknown/null→balanced). **(e) targetBloom only LOWERS:** below-ceiling target lowers it, above-ceiling target does NOT raise it (high+create stays evaluate; low+analyze stays understand; low+remember lowers). **(f) Non-decreasing Bloom order** across the returned `sectionKinds` for every band (misconception_callouts ordered AFTER core_concepts by the stable LESSON_STEPS tie-break). **(g) renderAdaptationCodes PII-free (P13):** emits `scaffolding:`/`bloom_ceiling:`/`depth:`/`persona:`/`sections:N`/`emphasis_count:N`/`misconception:<CODE>` and conditional `misconception_callouts:on`/`application:on` codes ONLY — NEVER a topic TITLE or misconception LABEL, every element whitespace-free. **(h) Planner purity:** identical inputs → deeply-equal, does not mutate inputs, never throws. **(i) Orchestrator abstain ladder:** grounded=false → abstain surfacing the service `abstain_reason` + `suggested_alternatives` (screen never runs); `confidence < 0.75` → `low_similarity` abstain (0.75 EXACTLY does NOT abstain); empty / non-JSON / zero-citation answer → `no_supporting_chunks` parse-empty abstain. **(j) Happy path:** multi-section grounded notes parse with EN+Hindi populated per section (P7), ≥1 citation each, de-duped `citationsAll`, meta (confidence/model/traceId) carried through; tolerant brace-slice recovery from surrounding prose; citation fallback to the full retrieved set when `supportingCitationIndexes` absent. **(k) Per-field bilingual screen backstop (P12):** an unsafe EN OR Hindi field drops ONLY that section (rest kept); a section unsafe on its Hindi body is dropped; ALL sections unsafe → whole-lesson `upstream_error` abstain. **(l) Bloom clamp:** each section's `bloomLevel` clamped to `plan.bloomCeiling` (low band: `create`→`understand`; `remember` below ceiling untouched). **(m) REG-50 single retrieval:** `callGroundedAnswer` invoked EXACTLY once. **(n) Fail-soft / writes-nothing:** a throwing grounded call OR throwing screen → abstain, never throws; only the two injected deps are touched (1 call + 4 screen invocations on the surviving section). **(o) Route flag gate:** flag OFF (default) → 404-style `{success:false}` BEFORE any auth/DB/memory/generation work (`authorizeRequest`/`createSupabaseServerClient`/`getStudentMemory`/`generateLessonNotes` all uncalled, no lesson shape leaks); role/user-scoped flag OFF (global ON) → 404 after auth, still no generation. **(p) Route student-self scope:** flag ON + self → `generateLessonNotes` called with the CALLER'S OWN `auth.studentId` + parsed subject/grade STRING/chapter, `getStudentMemory` for the OWN id, RLS-scoped `createSupabaseServerClient` used; a `?studentId=<other>` is IGNORED (generator still gets SELF); an abstain envelope is a normal 200 (`abstained:true`); no student profile → 404 `NO_STUDENT_PROFILE`; unresolvable grade → 404 `NO_GRADE`; success audit is metadata-only (`subject`/`chapterNumber`/`abstained`). **(q) Route WHAT validation:** missing subject → 400 `SUBJECT_REQUIRED`; missing/non-positive chapterNumber → 400 `CHAPTER_NUMBER_REQUIRED`; missing chapterTitle → 400 `CHAPTER_TITLE_REQUIRED`; invalid depth enum → 400 `INVALID_DEPTH`. **(r) Read-only + self-scope source scan:** the route source (block+line comments stripped) contains no `.insert(`/`.update(`/`.upsert(`/`.delete(` and never imports `supabase-admin`/`getSupabaseAdmin`/`canAccessStudent`. **(s) Registry — LIVE + no mastery write:** the agent-registry conformance suite's live-set sanity now includes `lesson` (**6** live agents), so invariant (d) [entryPoint `apps/host/src/app/api/lesson/route.ts` exists on disk] and invariant (e) [`findMasteryWrites` over the entryPoint → empty; the route reads `students.grade` via `.select` — a permitted READ — and writes none of the 9 forbidden mastery tables] PASS; invariant (f) [`ff_lesson_generation_v1` ∈ `FLAG_DEFAULTS`] holds. | `apps/host/src/__tests__/lib/lesson/lesson-plan.test.ts` (25), `apps/host/src/__tests__/lib/lesson/generate-lesson.test.ts` (16), `apps/host/src/__tests__/api/lesson/route.test.ts` (12), `apps/host/src/__tests__/agents/agent-registry-conformance.test.ts` (updated live-set → 6, 8); source under test `packages/lib/src/lesson/lesson-plan.ts` + `packages/lib/src/lesson/generate-lesson.ts` + `apps/host/src/app/api/lesson/route.ts` | E |

### Invariants covered by this section (Lesson Generation Agent)

- P12 (AI safety) — grounded path ONLY (one `callGroundedAnswer`), `mode:'strict'`
  with an abstain ladder (grounded=false / `confidence < 0.75` / parse-empty) so no
  ungrounded prose reaches a student, PLUS a Node-side `screenStudentFacingText`
  backstop on EVERY rendered EN + Hindi field (unsafe section dropped, all-dropped
  → whole-lesson abstain). Fail-soft — a generation failure returns an abstain,
  never a 500.
- P7 (bilingual) — every section carries EN + Hindi (dropped at parse time if any
  field is missing); the whole-lesson abstain copy is bilingual.
- WHAT/HOW read-only boundary — a HOW-only LIVE agent that writes NOTHING: not
  mastery/progression (registry invariant e — `findMasteryWrites` empty over the
  route), not XP. The planner re-derives no mastery and holds no threshold literal.
- P5 (grade STRING) — grade flows as a STRING "6".."12" end-to-end (request →
  planner → grounded scope).
- P13 (no PII) — `adaptationApplied` is codes/enums only (never a topic title or
  misconception label); logs are category/metadata only; the success audit carries
  `subject`/`chapterNumber`/`abstained` only.
- Student-self scope — the route serves only `auth.studentId`; there is NO
  `?studentId` cross-student path, NO `canAccessStudent`, and NO service-role/admin
  client (RLS-scoped self reads only).
- Additive / default-OFF — `ff_lesson_generation_v1` OFF short-circuits to a
  404-style no-op before any auth/DB/memory/generation work, so no lesson is ever
  generated or surfaced until an operator flips the flag.

### Catalog total (Lesson Generation Agent)

GenAI Phase 5b adds REG-313 (Lesson Generation Agent — first student-facing
GENERATIVE artifact: grounded-only single-retrieval generation with a
grounded/confidence-0.75/parse-empty abstain ladder, per-field bilingual screen
backstop [drop → whole-lesson abstain], flag-OFF 404 no-op, student-self scope,
and a LIVE registered agent with zero mastery writes). REG-312 was the prior
addition (GenAI Phase 5a read-only Outcome Prediction Agent); REG-313 is the next
free id after REG-312.
**Total catalog: 313 entries (target: 35 — TARGET EXCEEDED).**

---

## GenAI Phase 5c — Content Generation Agent (NCERT-grounded Mermaid diagrams) (2026-07-24) — REG-314

The Content Generation Agent is the platform's first GENERATIVE VISUAL artifact:
on-demand, NCERT-grounded, bilingual Mermaid diagrams (flowchart / mindmap /
timeline) for one chapter. It is a PURE planner
(`packages/lib/src/diagram/diagram-plan.ts`, `planDiagram`, assessment-owned) + a
grounded-generation ORCHESTRATOR (`packages/lib/src/diagram/generate-diagram.ts`,
`generateDiagram`, ai-engineer-owned) behind a read-only POST route
(`apps/host/src/app/api/content/diagram/route.ts`, backend-owned), additive and
flag-gated `ff_content_generation_v1` (default OFF). It decides only HOW to
VISUALIZE a chapter (diagram TYPE / node budget / complexity) from EXISTING
unified-memory signals — it re-derives NO mastery, invents NO threshold literal
(`memory.masteryLevel` is used VERBATIM; node budgets are presentation params),
and writes NOTHING. Because it is GENERATIVE, student-facing, and emits RENDERABLE
CODE, the safety spine is a DUAL GATE: grounded path ONLY (one `callGroundedAnswer`,
single RAG retrieval — REG-50 spirit) with a grounded/confidence-0.75/parse-empty
abstain ladder, then Gate 1 = `validateMermaidCode` (REUSED verbatim — rejects
`<script>`/`javascript:`/`click`/`%%{init}` injection + non-allowlisted headers) +
a v1-kind header constraint (narrower than the Mermaid allow-list), then Gate 2 =
`screenStudentFacingText` over titleEn/Hi + captionEn/Hi AND the WHOLE mermaidCode
(node labels are user-facing text). Either gate failing → whole-diagram abstain.
There is NO raw-SVG fallback — abstain is the only failure mode. It is fail-soft
(never throws → abstain) and registers as a **LIVE** agent that provably writes NO
mastery (registry invariant e), taking the live set from 6 → 7 (all agents now
live). The route is student-self ONLY — it serves the caller's OWN
`auth.studentId`, has NO `?studentId` cross-student path, NO `canAccessStudent`,
and NO service-role/admin client. Owner: testing (tests) / assessment (planner) +
ai-engineer (orchestrator) + backend (route). Maps to P12 (AI safety — grounded-only,
strict-mode abstain, dual safety gate, no raw code to a student) + P7 (bilingual —
EN + Hindi title/caption + bilingual abstain copy) + the WHAT/HOW read-only boundary
(a HOW-only agent that writes nothing) + P5 (grade STRING) + P13 (category/metadata
logs only). Spec: `docs/superpowers/specs/2026-07-24-content-generation-agent-design.md`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-314 | `content_generation_diagram_dual_safety_gate_no_raw_svg_v1kind_flagoff_selfscope` | **(a) Planner diagram-type selection (HOW-only):** a valid v1 caller override is HONORED (`caller_override`) even when the title would heuristic elsewhere; an out-of-v1-set override (e.g. `sequenceDiagram`) is IGNORED → content heuristic; the title heuristic picks timeline/flowchart/mindmap from keywords with priority timeline→flowchart→mindmap (a title with both a timeline + a flowchart keyword picks timeline); the subject fallback maps `history_sr`→timeline but NOT `social_studies`; a keyword-free non-chronological title → default mindmap. **(b) Planner node budget (presentation, NOT a mastery gate):** band base 6/9/12 for low/medium/high, +3 for a visual learner (`richLabels:true`), clamped at 15 (high+visual = 12+3 = 15, the cap); a non-visual style earns no bonus; branch depth (1/2/2) + detail level (core/standard/rich) are band-derived. **(c) Planner purity:** identical inputs → deeply-equal, does not mutate inputs, never throws across all bands. **(d) Orchestrator happy path:** a grounded strict-JSON answer parses into a validated `DiagramSpec` with bilingual title/caption (P7) + ≥1 citation + carried-through meta (confidence/model/traceId); a `graph` header maps to the `flowchart` kind; tolerant brace-slice recovery from surrounding prose. **(e) Abstain ladder:** grounded=false → abstain surfacing the service `abstain_reason` + `suggested_alternatives` (screen never runs); `confidence < 0.75` → `low_similarity` (0.75 EXACTLY does NOT abstain); empty answer / `{"error":...}` insufficient-source / zero-citation → `no_supporting_chunks` parse-empty abstain. **(f) SAFETY GATE 1 (structure/injection) — NO raw-SVG:** a malformed mermaid (no allowlisted header) → abstain (`upstream_error`), empty `mermaidCode`, Gate 2 screen never runs; each of 4 injection payloads (`<script>`, `javascript:`, a `click` interaction callback, a `%%{init htmlLabels}` directive) is REJECTED by the REUSED `validateMermaidCode` → abstain, NEVER a raw-SVG/raster fallback, NEVER a throw. **(g) v1-kind enforcement:** a header allowlisted by Mermaid but OUTSIDE the v1 set (`sequenceDiagram`) passes `validateMermaidCode` yet fails the v1-kind check → abstain. **(h) SAFETY GATE 2 (age/toxicity):** an unsafe `titleHi`, an unsafe node label INSIDE the `mermaidCode`, or an unsafe `captionEn` each → whole-diagram abstain (screen runs on all 5 student-facing fields incl. the whole mermaidCode). **(i) Fail-soft / writes-nothing:** a throwing grounded call OR throwing screen OR a malformed grounded envelope → abstain, never throws; only the injected grounded client is touched for I/O. **(j) REG-50 single retrieval:** `callGroundedAnswer` invoked EXACTLY once. **(k) P13:** no `studentId` / PII in any logged value across the grounded-false / low-confidence / gate-1-fail logging paths. **(l) Route flag gate:** flag OFF (default) → 404-style `{success:false}` BEFORE any auth/DB/memory/generation work (`authorizeRequest`/`createSupabaseServerClient`/`getStudentMemory`/`generateDiagram` all uncalled, no diagram shape leaks); role/user-scoped flag OFF (global ON) → 404 after auth, still no generation. **(m) Route student-self scope:** flag ON + self → `generateDiagram` called with the CALLER'S OWN `auth.studentId` + parsed subject/grade STRING/chapter + `artifactType:'diagram'`, `getStudentMemory` for the OWN id, RLS-scoped `createSupabaseServerClient` used; a `diagramType` hint passes through; an abstain envelope is a normal 200 (`abstained:true`); response carries `Cache-Control: private, no-store`; no student profile → 404 `NO_STUDENT_PROFILE`; unresolvable grade → 404 `NO_GRADE`; success audit metadata-only (`subject`/`chapterNumber`/`abstained`). **(n) Route body validation (4xx, never 500):** non-JSON body / JSON array → 400 `INVALID_BODY`; missing subject → 400 `SUBJECT_REQUIRED`; missing chapter object → 400 `CHAPTER_REQUIRED`; missing/non-positive chapterNumber → 400 `CHAPTER_NUMBER_REQUIRED`; missing chapterTitle → 400 `CHAPTER_TITLE_REQUIRED`; invalid diagramType enum → 400 `INVALID_DIAGRAM_TYPE`; invalid language enum → 400 `INVALID_LANGUAGE`. **(o) Read-only source scan:** the route source (comments stripped) contains no `.insert(`/`.update(`/`.upsert(`/`.delete(` and never imports `supabase-admin`/`getSupabaseAdmin`/`canAccessStudent`. **(p) Registry — LIVE + no mastery write:** the agent-registry conformance suite's live-set sanity now includes `content_generation` (**7** live agents — all agents now live), so invariant (d) [entryPoint `apps/host/src/app/api/content/diagram/route.ts` exists on disk] and invariant (e) [`findMasteryWrites` over the entryPoint → empty; the route reads `students.grade` via `.select` — a permitted READ — and writes none of the 9 forbidden mastery tables] PASS; invariant (f) [`ff_content_generation_v1` ∈ `FLAG_DEFAULTS`] holds. **(q) Template parity:** `config-parity.test.ts` confirms `diagram_spec_v1` is registered byte-identically across the Next.js + Deno grounding configs. | `apps/host/src/__tests__/lib/diagram/diagram-plan.test.ts` (17), `apps/host/src/__tests__/lib/diagram/generate-diagram.test.ts` (23), `apps/host/src/__tests__/api/content/diagram/route.test.ts` (16), `apps/host/src/__tests__/agents/agent-registry-conformance.test.ts` (updated live-set → 7, 8), `apps/host/src/__tests__/grounding/config-parity.test.ts` (diagram_spec_v1 parity); source under test `packages/lib/src/diagram/diagram-plan.ts` + `packages/lib/src/diagram/generate-diagram.ts` + `apps/host/src/app/api/content/diagram/route.ts` | E |

### Invariants covered by this section (Content Generation Agent)

- P12 (AI safety) — grounded path ONLY (one `callGroundedAnswer`), `mode:'strict'`
  with an abstain ladder (grounded=false / `confidence < 0.75` / parse-empty), PLUS
  a DUAL safety gate: Gate 1 `validateMermaidCode` (injection/grammar) + v1-kind
  header, Gate 2 `screenStudentFacingText` over every EN + Hindi field AND the whole
  mermaidCode. Either gate failing → whole-diagram abstain. NO raw-SVG fallback.
  Fail-soft — a generation failure returns an abstain, never a 500.
- P7 (bilingual) — every emitted spec carries EN + Hindi title/caption; the abstain
  copy is bilingual.
- WHAT/HOW read-only boundary — a HOW-only LIVE agent that writes NOTHING: not
  mastery/progression (registry invariant e — `findMasteryWrites` empty over the
  route), not XP. The planner re-derives no mastery and holds no threshold literal.
- P5 (grade STRING) — grade flows as a STRING "6".."12" end-to-end (request →
  planner → grounded scope), resolved server-side from the caller's own row.
- P13 (no PII) — logs are category/metadata only (no studentId); the success audit
  carries `subject`/`chapterNumber`/`abstained` only.
- Student-self scope — the route serves only `auth.studentId`; there is NO
  `?studentId` cross-student path, NO `canAccessStudent`, and NO service-role/admin
  client (RLS-scoped self reads only).
- Additive / default-OFF — `ff_content_generation_v1` OFF short-circuits to a
  404-style no-op before any auth/DB/memory/generation work, so no diagram is ever
  generated or surfaced until an operator flips the flag.

### Catalog total (Content Generation Agent)

GenAI Phase 5c adds REG-314 (Content Generation Agent — NCERT-grounded Mermaid
diagram generator: grounded-only single-retrieval generation with a
grounded/confidence-0.75/parse-empty abstain ladder, a DUAL safety gate
[validateMermaidCode injection-reject + v1-kind header, then screenStudentFacingText
over every field incl. the whole mermaidCode] with NO raw-SVG fallback, flag-OFF 404
no-op, student-self scope, and a LIVE registered agent with zero mastery writes —
taking the live agent set from 6 → 7). REG-313 was the prior addition (GenAI Phase 5b
Lesson Generation Agent); REG-314 is the next free id after REG-313.
**Total catalog: 314 entries (target: 35 — TARGET EXCEEDED).**

---

## GenAI Phase 5d — /foxy Study Tools surface (the student-visible mouth of the Lesson + Content agents) (2026-07-25) — REG-315

REG-313 and REG-314 pinned the two GenAI generation AGENTS (planner, orchestrator,
route). This entry pins the CLIENT SURFACE that finally puts them in front of a
student: the "Study tools" affordances inside the `/foxy` workspace —
`StudyToolsBar` (two pills) → `useStudyArtifacts` (open/cache/regenerate state) →
`study-artifacts.ts` (transport + 4-state normalizer) → `StudyArtifactSheet`
(render), with `diagram-to-foxy-block.ts` adapting a `DiagramSpec` into the
EXISTING REG-55 one-block Foxy envelope so the diagram is drawn by the same
`MermaidBlock` every chat turn already uses. Gated by the same two flags as the
agents: `ff_content_generation_v1` (Diagram) and `ff_lesson_generation_v1`
(Lesson notes), read client-side by `useGenAiContentFlags`.

**Why this needs a catalog entry NOW:** migration `20260724220000_set_ff_generation_rollout_100.sql`
takes BOTH flags to `is_enabled = TRUE` at `rollout_percentage = 100` on merge
(superseding the two 10% canary migrations), so this surface reaches EVERY student
immediately — there is no canary window in which a defect stays contained. The
flag-OFF identity clauses below are therefore not a pre-launch guard but the
ROLLBACK contract: they are what makes flipping either flag back to 0% a true
byte-identical no-op on the `/foxy` DOM rather than a partial teardown.

The four load-bearing invariants: (1) flag-OFF DOM identity — asserted as
`container.innerHTML === ''`, so a stray wrapper or divider FAILS, with each flag
ramping independently and every degenerate flag-source outcome failing CLOSED;
(2) the deliberate kind→endpoint ASYMMETRY (diagram = POST + nested `chapter{}`,
lesson = GET + flat query params), pinned both at the client and by a static
read-only canary over the two route sources so a future "let's unify these"
refactor cannot silently cross them; (3) an ABSTAIN (HTTP 200 + `abstained:true`)
is a NORMAL settled outcome rendered as calm bilingual copy — never the error
branch, never a retry button — with retry offered ONLY for the `network` reason;
(4) a CLIENT-side re-run of `validateMermaidCode` as defence-in-depth over
REG-314's server gate, so an untrusted `mermaidCode` that somehow reaches the
browser returns `null` and never touches the renderer or the DOM. Owner: testing
(tests) / frontend (surface). Maps to P12 (AI safety — client injection gate,
abstain-not-error), P7 (bilingual), P13 (no PII on the wire, in the DOM, or in
logs), P5 (grade never sent client-side — resolved server-side), and P10-adjacent
(no speculative network/LLM spend on render).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-315 | `foxy_study_tools_flagoff_dom_identity_kind_endpoint_asymmetry_abstain_not_error_client_mermaid_gate` | **(a) Flag-OFF DOM identity:** both flags OFF → `StudyToolsBar` renders an EMPTY container — asserted as `container.innerHTML === ''` PLUS `firstChild === null` and `childNodes.length === 0`, so a stray wrapper / divider / whitespace text node FAILS — in EN mode, in HI mode, and with a chapter selected; ZERO `fetch` on render at EVERY flag combination incl. BOTH ON (generation is student-initiated only — no speculative LLM spend). **(b) Independent per-flag ramps:** hook — only `ff_content_generation_v1` ON → `{diagram:true,lesson:false}`, only `ff_lesson_generation_v1` ON → `{diagram:false,lesson:true}`; bar — diagram-only renders only the `foxy-tool-diagram` pill, lesson-only only `foxy-tool-lesson`, both → both. **(c) Fail-CLOSED flag resolution:** first paint with no cache resolves BOTH false (under `NODE_ENV=production` and under test); a flag source that THROWS, resolves `undefined`, or returns a map lacking both keys keeps both OFF; an EXPIRED (>5-min TTL), CORRUPT (`{not-json`), or timestamp-less cache is IGNORED → OFF; a fresh cache reads through PER-FLAG; a stale ON cache is CORRECTED back to OFF by the async DB reconcile; the reconciled value is written back to the TTL cache; `getFeatureFlags` is called EXACTLY once (one map read, no per-flag round trip); `clearGenAiContentFlagsCache` removes the key. **(d) Dev override is commit-safe:** `alfanumrik_force_genai_content` is a STRICT no-op under `NODE_ENV==='production'`; outside production `'1'` forces both, `'diagram'`/`'lesson'` force exactly one, an unrecognised value is ignored. **(e) Registry-not-barrel flag import (source canary):** the hook source CONTAINS `@alfanumrik/lib/flags/registries/foxy` and does NOT match `from '@alfanumrik/lib/feature-flags'` (a barrel import would break the existing `vi.mock`'ed Foxy suites); the two flag names are pinned byte-exact to `ff_content_generation_v1` / `ff_lesson_generation_v1` and `GENAI_CONTENT_FLAGS_DEFAULT` equals `{diagram:false,lesson:false}`. **(f) kind→endpoint dispatch ASYMMETRY:** diagram → **POST** `/api/content/diagram` with a JSON string body, `Content-Type: application/json`, `credentials:'include'`, and chapter NESTED as `{chapterNumber, chapterTitle}` with NO flat `chapterNumber`/`chapterTitle` sibling keys; lesson → **GET** `/api/lesson?…` with NO body and FLAT `subject`/`chapterNumber`/`chapterTitle`/`language` query params and NO `chapter` param; one test runs both back-to-back and pins POST+body vs GET+no-body side by side. `diagramType` is included ONLY when the caller supplied a hint; `Authorization: Bearer <tok>` is present when a token exists and the header is ABSENT when it is null. `useStudyArtifacts.open('diagram')` hits `/api/content/diagram` and `open('lesson')` hits `GET /api/lesson?…`. **(g) Static client/route contract canary:** reads BOTH route sources from disk — the diagram route exports `POST` and NOT `GET` and reads `body.chapter` / `chapter.chapterNumber` / `chapter.chapterTitle`; the lesson route exports `GET` and NOT `POST`, reads `searchParams.get('subject')` / `('chapterNumber')` / `('chapterTitle')` / `('language')`, and never calls `request.json()`. This closes the half the client mocks cannot see: a route renaming a param turns THIS red. **(h) ABSTAIN is not an error (P12/UX):** HTTP 200 + `abstained:true` → `status:'abstained'`, never `'error'`, and the state carries NO `reason` field; the server-authored bilingual `messageEn`/`messageHi` + `suggestedAlternatives` pass through verbatim; an abstain envelope with NO `abstain` object, a non-array `suggestedAlternatives`, or non-string messages coerces to empty copy / `[]` without crashing. At the render layer the abstain shows the calm heading + the SERVER message (Hindi under `isHi`), lists the suggested ready chapters, shows NO error copy and NO `Try again`, and STILL offers `Regenerate` (an abstain is a SETTLED result, not a failure). **(i) Error classification + retry ONLY for `network`:** `reasonForStatus` maps 400→`unsupported`, 401/403/404→`unavailable`, 500/502/503 and an unclassified 429→`network`; a thrown fetch, a 200 with a non-JSON body, `success:false`, or `success:true` with no `data` all → `error/network`; end-to-end a 400 → `unsupported` and a thrown fetch → `network` on BOTH transports. At the render layer `unsupported` and `unavailable` (incl. a server-side flag flip surfacing as 404) get their own bilingual copy and NO retry; ONLY `network` renders `Try again` wired to `onRegenerate`; no header `Regenerate` in an error state, and none while loading. **(j) CLIENT-side Mermaid injection gate (P12 defence-in-depth over REG-314's server gate):** `diagramSpecToFoxyResponse` re-runs `validateMermaidCode` in the browser and returns `null` for 9 payload shapes — `<script>` (and uppercase `<SCRIPT>`), a `javascript:` URI, a `click` interaction callback (plain, leading-whitespace, and `click A href`), `%%{init}` overriding `securityLevel` and overriding `htmlLabels`, a non-allowlisted header, and raw HTML `<img onerror>` — and the `null` cannot leak the payload (the serialised result contains no `script` / `javascript:`); it does NOT false-positive on a node LABEL merely containing the word "Click"; empty / whitespace-only / missing `mermaidCode` → `null`; code longer than `FOXY_MAX_MERMAID_CODE_LEN` → `null` while code EXACTLY at the ceiling is ACCEPTED (boundary, not off-by-one). At the sheet, each of 5 unsafe payloads → the structured renderer is NEVER invoked (probe length 0, no `structured-renderer` node), the raw source is NEVER printed (`innerHTML` contains no `alert(1)` / `javascript:`, `querySelector('script')` null), and the calm "Couldn't build this from NCERT yet" fallback renders with NO retry. **(k) REG-55 envelope reuse:** a valid spec becomes EXACTLY ONE `mermaid` block carrying the code VERBATIM (surrounding whitespace trimmed) inside the EXISTING Foxy structured-render envelope, so the diagram is drawn by the same `MermaidBlock` the chat already uses; the title picks EN/HI by `isHi`, falls back to the other language when the primary is empty, then to the caller `fallbackTitle`; the caption maps to the block title per language and the key is OMITTED entirely when there is no caption; an over-long title clamps to 120 with an ellipsis and an over-long caption clamps to 120; `toFoxySubject` maps math / the science family / the social family (→`sst`) / english with `general` as the unknown+empty fallback and threads onto the envelope; all three v1 kinds (flowchart / mindmap / timeline) are accepted. **(l) No duplicate LLM spend:** per `subject+chapterNumber+language` cache — re-opening the SAME context does NOT re-fetch; a change to chapter, language, OR subject re-fetches; three rapid opens of the same still-loading context issue ONE request; an ABSTAIN IS cached (a settled result); an ERROR is NOT cached (re-open re-runs). **(m) Stale-response guard:** a slow first request that resolves AFTER a newer one is DROPPED — a student who switches chapter mid-flight keeps the NEWER chapter's artifact, a stale ERROR cannot overwrite a newer READY, and a stale response cannot overwrite a REGENERATED result; initial state is closed + idle with ZERO fetch; `close()` hides the sheet but KEEPS the settled result; the two artifacts are INDEPENDENT (opening lesson leaves diagram `idle`). **(n) Regenerate:** bypasses the cache with a fresh request for the same context, is the retry path after a failure, regenerates ONLY the OPEN artifact (the closed one stays `idle`), and is a no-op when no sheet is open. **(o) No dead end:** with no chapter selected, clicking EITHER pill routes to `onNeedChapter` and NEVER to `onDiagram`/`onLesson`, and the pill carries a bilingual explanatory title (`Pick a chapter first` / `पहले एक अध्याय चुनो`). **(p) P13 + P5 on the wire:** the diagram request body carries EXACTLY the sorted key set `{chapter, diagramType, language, subject}` and the lesson query string EXACTLY `{chapterNumber, chapterTitle, language, subject}` (sorted set EQUALITY, not a substring check); neither matches `/studentId\|student_id\|userId\|user_id\|email\|phone/i`; NO `grade` is sent on either transport (P5 — grade is resolved SERVER-side from the caller's own enrolled row); the access token is never echoed into the returned state; NOTHING is emitted to `console.log/warn/error/info/debug` on any failure path; neither the rendered `StudyToolsBar` nor the rendered `StudyArtifactSheet` markup matches `/studentId\|student_id\|userId\|@\|\+91/i`. **(q) P7 bilingual parity:** `ARTIFACT_CHROME.en`/`.hi` declare the SAME key set, every value is a non-empty string in BOTH, EN !== HI per key, every HI value contains Devanagari and every EN value contains NONE, and no PII-shaped placeholder appears in either; the technical terms NCERT + Foxy appear VERBATIM in Hindi copy and are never transliterated (`एनसीईआरटी` / `सीबीएसई` / `ब्लूम` / `फॉक्सी` all absent). Bar: `Diagram`/`Lesson notes` in EN, `आरेख`/`पाठ नोट्स` in HI with the English strings GONE, NCERT untranslated in the HI tooltip, and a bilingual `role="group"` aria-label. Sheet: per-kind bilingual "building" copy, bilingual abstain + error copy, bilingual `Close` label, and Bloom's level rendered UNTRANSLATED in HI mode. **(r) a11y + dismissal:** the sheet is `role="dialog"` with `aria-modal="true"` and `aria-labelledby="foxy-artifact-<kind>-title"`, carries the chapter label, and closes on the ✕ and on Escape; the lesson body renders each section heading + body in the active language and falls back to the calm notice for an empty section list; the diagram sheet renders the NCERT citation provenance (`Ch 3 · Atoms and Molecules · p. 42`). | `apps/host/src/__tests__/foxy/genai-content-flags-off-identity.test.ts` (23), `apps/host/src/__tests__/foxy/study-tools-bar.test.tsx` (17), `apps/host/src/__tests__/foxy/study-artifacts-transport.test.ts` (133), `apps/host/src/__tests__/foxy/diagram-to-foxy-block.test.ts` (31), `apps/host/src/__tests__/foxy/use-study-artifacts.test.ts` (20), `apps/host/src/__tests__/foxy/study-artifact-sheet.test.tsx` (38) — **262 tests, all passing**; source under test `apps/host/src/app/foxy/_hooks/useGenAiContentFlags.ts` + `_hooks/useStudyArtifacts.ts` + `_lib/study-artifacts.ts` + `_lib/diagram-to-foxy-block.ts` + `_components/StudyToolsBar.tsx` + `_components/StudyArtifactSheet.tsx` | E |

### Invariants covered by this section (/foxy Study Tools surface)

- P12 (AI safety) — an ABSTAIN is a normal settled 200 rendered as calm bilingual
  copy, never the error branch and never a retry prompt; and a CLIENT-side re-run
  of `validateMermaidCode` (defence-in-depth over REG-314's server gate) returns
  `null` for every injection shape, so an untrusted payload never reaches the
  renderer nor the DOM. There is no raw-source fallback — the calm notice is the
  only failure mode.
- P7 (bilingual) — full EN/HI key-set parity on the shared chrome (both directions:
  HI has Devanagari, EN has none), bilingual bar labels / tooltips / group
  aria-label, bilingual loading / abstain / error / close copy, and the technical
  terms NCERT, CBSE, Bloom's, Foxy left UNTRANSLATED.
- P13 (no PII) — request body and query string are asserted by sorted key-set
  EQUALITY (an added key fails), no identifier-shaped key on the wire, no
  identifier in the rendered markup of either component, the access token never
  echoed into state, and NOTHING written to `console.*` on any failure path.
- P5 (grade STRING, server-resolved) — the client sends NO `grade` on either
  transport; grade is resolved server-side from the caller's own enrolled row
  (the agent-side half is REG-313/REG-314).
- Flag-gating / rollback contract — both flags default OFF in the client hook and
  fail CLOSED on cache miss, cache expiry, cache corruption, a throwing flag
  source, an `undefined` map, and a map lacking the keys; each ramps
  INDEPENDENTLY; the OFF path renders literally nothing (`innerHTML === ''`).
  With migration `20260724220000` taking both flags to 100%, these are the
  clauses that make a flip back to 0% a clean no-op.
- P10-adjacent (no speculative spend) — zero network calls on render at any flag
  combination, a per-`subject+chapter+language` cache so re-opening a sheet does
  not re-spend an LLM call, single-flight on a still-loading context, and a
  stale-response guard so a mid-flight chapter switch can never show the previous
  chapter's artifact.

### Known gap (documented, not silently dropped)

Two properties in the surface's design intent are **structurally true in the
source but NOT asserted by any test**, and are recorded here rather than claimed
as coverage:

1. **Page-level mounting.** `apps/host/src/app/foxy/page.tsx` gates the second
   `StudyToolsBar` mount on `(genAiContentFlags.diagram || genAiContentFlags.lesson)`
   and mounts `StudyArtifactSheet` only while `studyArtifacts.openKind` is
   `'diagram'`/`'lesson'`. No test renders `page.tsx` — `foxy-page-snapshot.test.tsx`
   does not reference either component. The "no sheet is mounted on the OFF path"
   property is pinned only INDIRECTLY, at the hook layer: `useStudyArtifacts`
   starts with `openKind === null`, both artifacts `idle`, and zero fetch.
2. **"No new chunk" on the OFF path.** `StudyArtifactSheet` is a `next/dynamic`
   import behind a conditional mount, so its chunk (and the lazy mermaid runtime
   behind it) is fetched on first use only. Nothing asserts this — there is no
   per-route chunk assertion in the suite; the only enforcement is the global
   `scripts/check-bundle-size.mjs` CI gate, which is not Study-Tools-specific.
   Clause (a) asserts no *network call*, which is a different claim.

Neither gap is closed by this entry. Closing (1) would need a `page.tsx` render
test (the file pulls a large dynamic-import graph); closing (2) would need a
per-route chunk-manifest assertion. There is also no Playwright/E2E coverage of
this surface — all 262 tests are unit-level.

### Catalog total (/foxy Study Tools surface)

Pre-REG-315: 314 entries (through REG-314, the GenAI Phase 5c Content Generation
Agent). GenAI Phase 5d adds REG-315 (the `/foxy` Study Tools client surface — the
student-visible mouth of the Lesson + Content agents: flag-OFF DOM identity
asserted as `innerHTML === ''` with independent per-flag ramps and fail-CLOSED
resolution on every degenerate flag-source outcome, the deliberate
diagram-POST-nested / lesson-GET-flat endpoint asymmetry pinned at both the client
and a static route-source canary, abstain-is-not-an-error with retry offered only
for `network`, and a CLIENT-side `validateMermaidCode` injection gate that returns
`null` so an unsafe payload never reaches the renderer or the DOM — promoted now
because migration `20260724220000` takes both gating flags to rollout 100% on
merge). REG-314 was the prior addition (GenAI Phase 5c Content Generation Agent);
REG-315 is the next free id after REG-314.
**Total catalog: 315 entries (target: 35 — TARGET EXCEEDED).**

---

## Forensic-audit ncert-solver AI-safety backport (2026-07-29, PR #1410) — REG-321

Source: the 2026-07-29 forensic audit (PR #1410) found `ncert-solver` — a
Supabase Edge Function reachable with any authenticated student's JWT — had
never received the P12 safety hardening already shipped on the Foxy Next.js
route (`fix(ai-safety): back-port Foxy's grade-spoof block and output screen
to ncert-solver (P12)`, reviewed by ai-engineer + assessment + testing +
quality):

- **No grade-authority check.** The client-supplied `grade` field drove RAG
  scope and prompt assembly directly with no comparison against the caller's
  enrolled grade — a Grade 6 student could request Grade 12 content by
  editing the request body. Fixed with the same hard `403 GRADE_MISMATCH`
  block Foxy's route already enforces, run before any retrieval/prompt work.
- **No deterministic output screen.** Both ncert-solver response paths
  (grounded RAG + legacy) returned the LLM answer verbatim with no
  `screenStudentFacingText` pass — the only P12 output backstop
  (`REG-182`/`REG-183`) covered Foxy and `grounded-answer`, not
  ncert-solver. Fixed by extracting the canonical screen to a new SHARED Deno
  module, `supabase/functions/_shared/rag/output-screen.ts` (
  `grounded-answer/output-screen.ts` is now a thin re-export shim, not a
  second implementation), and wiring both ncert-solver paths through it
  before any answer reaches a student.
- **Unsanitized chunk interpolation.** The legacy RAG path interpolated
  retrieved chunks directly into the system prompt; now runs through the
  same sanitizer `grounded-answer`'s hardened path already uses.
- **No query-length cap.** Added the same 1000-char cap Foxy's BFF enforces
  (unbounded Claude cost per request, closed).
- **No refund-on-abstain.** `chapter_not_ready`/`circuit_open` abstains
  consumed daily quota with no refund; added the same refund-on-abstain
  logic Foxy already has.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-321 | `ncert_solver_output_screen_shared_module_relocation_p12` | The canonical Deno `screenStudentFacingText` implementation lives at `supabase/functions/_shared/rag/output-screen.ts` (relocated 2026-07-29 so ncert-solver — which had no output screen at all — can share it instead of duplicating or going without); `grounded-answer/output-screen.ts` is verified to genuinely RE-EXPORT the canonical module (`export { screenStudentFacingText, ... } from '../_shared/rag/output-screen.ts'`) and is asserted to NOT declare its own `HARD_BLOCK_PATTERNS` (guards against the canonical/shim relationship silently reversing or re-duplicating). The relocated Deno module's `HARD_BLOCK_PATTERNS` regex literals stay BYTE-IDENTICAL to the TS twin (`src/lib/ai/validation/output-screen.ts`, ≥20 patterns) — a drift here would let a token blocked on one runtime leak on the other, and now on ncert-solver too, since it imports the shared module directly. Representative blocked strings (profanity, slurs, self-harm, Hindi-abuse, chat-injection markup) that the TS twin blocks are proven present verbatim in the Deno twin's pattern set. The Deno twin's fail-safe contract is preserved: a thrown screening error yields `safe:false` with `categories: ["screen_error"]`, and blank text is treated as safe (the abstain path owns the empty case). | `apps/host/src/__tests__/lib/ai/validation/output-screen-deno-parity.test.ts` | E |

### Invariants covered by this section

- P12 (AI safety) — closes the most severe finding in this cluster: an AI
  Edge Function reachable with a real student JWT that had NEVER been
  screened for unsafe LLM output. The relocation-and-share architecture
  (one canonical module, two thin consumers) is what REG-321 actually pins:
  the TS↔Deno pattern-parity contract that already protected Foxy/
  grounded-answer now transitively protects ncert-solver as well, since all
  three consume the same `HARD_BLOCK_PATTERNS` list.

**Known gap — genuinely untested by this promotion, not papered over:** the
grade-spoof `403 GRADE_MISMATCH` block, the unsanitized-chunk-interpolation
fix on the legacy RAG path, the 1000-char query-length cap, and the
refund-on-abstain logic are all implemented in
`supabase/functions/ncert-solver/index.ts` (251 lines changed in the PR) but
have **no dedicated automated test** — the PR's diff touched exactly one
test file (`output-screen-deno-parity.test.ts`, the shared-module-relocation
parity pins above) and no Deno test suite for `ncert-solver` itself exists
on disk (confirmed: no `supabase/functions/ncert-solver/**test**` files, and
neither pre-existing Vitest suite —
`apps/host/src/__tests__/ncert-solver.test.ts` nor
`ncert-solver-security.test.ts` — asserts a `GRADE_MISMATCH`/403 authority
check). REG-321 is therefore scoped narrowly to what IS pinned (the shared
output-screen module + its cross-runtime parity); the grade-authority,
sanitization, query-cap, and refund behaviors are a real coverage gap flagged
to ai-engineer/assessment for a follow-up Deno test suite, not claimed as
tested here.

### Catalog total

Pre-REG-321: 320 entries (through REG-320, reconcile-payments terminal-state
guard — see `04-payments.md`). Adds REG-321 (ncert-solver AI-safety
backport — shared output-screen module relocation + TS/Deno parity; grade-
spoof/sanitization/quota-refund implemented but NOT yet test-pinned, see
Known gap above).
**Total catalog: 321 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-348 — Safeguarding two-tier fail-closed contract: a Tier-1 regex hit can NEVER silently degrade to "no escalation" when Tier-2 fails (2026-08-05)

**Status: E.** Foxy North-Star Phase 1 (spec
`docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md`,
S5.6/U6, approval A1), uncommitted at promotion time on branch
`Alfanumrik/foxy-system-spec-22f565`.

The safeguarding flow is two-tier: Tier-1 is a deterministic regex pre-screen
(`packages/lib/src/ai/validation/safeguarding-screen.ts`, zero network),
Tier-2 is an LLM confirmation classifier
(`packages/lib/src/ai/validation/safeguarding-classify.ts`, gateway
`callModel`, temperature 0, jsonMode, 0.7 inclusive confirm threshold). The
contract this entry pins is the FAIL-CLOSED branch: **after a Tier-1 hit, any
Tier-2 failure — gateway all-candidates-failed result, gateway throw,
unparseable prose, empty content, non-numeric confidence, JSON-array shape —
resolves to `{ confirmed: true, category: categories[0], confidence: 0,
tier: 'regex_only' }`**, i.e. the escalation proceeds on regex evidence alone
rather than the disclosure being silently dropped because a model was down.
The classifier itself never throws.

Downstream of a confirmed verdict (either tier), the route
(`apps/host/src/app/api/foxy/route.ts`, gated by `ff_safeguarding_v1`)
terminates the turn WITHOUT any LLM answer call and:
- returns the terminal envelope (`badgeState: 'safeguarding'`,
  `safeguarding.helpline = { name: 'Childline', number: '1098' }`, bilingual
  EN + Devanagari copy, warm/non-clinical — no diagnosis language);
- inserts the `safeguarding_escalations` row (excerpt capped at 500 chars,
  `classifier_meta` = confidence + label ONLY);
- fans out via `escalateSafeguarding` with `{ escalationId, schoolId,
  category }` — NO excerpt (see REG-349);
- REFUNDS the consumed quota unit (`refundQuota(studentId, 'foxy_chat')`) —
  a safeguarding disclosure never costs the student a chat;
- awards 0 XP / touches no mastery table (P2).

The complements are pinned in both directions: an AMBIGUOUS Tier-2 verdict
(confirmed=false, or model-said-confirmed but confidence < 0.7) lets the turn
continue completely normally (no row, no refund, grounded answer runs), and a
route-level classifier rejection (defense-in-depth — the module contract says
it can't happen) also continues normally rather than 500ing the student.
Flag OFF → Tier-1 is NEVER invoked (zero `screenForSafeguarding` /
`classifySafeguarding` calls, no escalation write, legacy grounded path —
the rollback contract).

Pinned by:
- `packages/lib/src/__tests__/ai/validation/safeguarding-classify.test.ts`
  (the "FAIL-CLOSED after a Tier-1 hit" describe: 6 failure shapes → the
  exact regex_only verdict; plus confirm/below-threshold/JSON-repair/request-
  hygiene pins, incl. the PR2 no-diagnosis boundary + sessionMood
  prior-only + prompt-injection-resistant mood token);
- `packages/lib/src/__tests__/ai/validation/safeguarding-screen.test.ts`
  (Tier-1 deterministic screen contract);
- `apps/host/src/__tests__/api/foxy/safeguarding-route.test.ts` (flag-OFF
  no-op A; confirmed-terminal B incl. refund + no-LLM + capped excerpt;
  ambiguous-continues C incl. classifier-rejection defense; sessionMood
  enum validation D — invalid mood dropped silently, never a 400);
- `apps/host/src/__tests__/api/foxy/respond-safeguarding.test.ts` (terminal
  envelope: bilingual P7, helpline card data, foxy_chat_messages persistence
  only, 0 XP; **old-APK safety pin, added 2026-08-05** — 'Childline' AND
  '1098' must appear in BOTH the EN and the Devanagari-HI segments of the
  top-level flat `response` string, asserted WITHOUT reference to the
  structured `safeguarding` envelope, because pre-safeguarding mobile APKs
  render only `response` and never see `badgeState`/`safeguarding.helpline`;
  moving the helpline solely into the envelope would show a distressed child
  a reply with no helpline at all — a child-safety regression).

P12 (no unfiltered/absent safety handling of a disclosure) + P7 + P2.

## REG-349 — Safeguarding data boundary (P13): disclosure text lives in EXACTLY ONE place; notifications, list APIs, and audits are metadata-only (2026-08-05)

**Status: E.** Same Phase 1 change set as REG-348.

Migration `20260806000100_safeguarding_escalations.sql` declares
`disclosure_excerpt` (≤500 chars, CHECK-enforced) as **the ONE sanctioned home
for student disclosure text** (PR5: sensitive conversations retained only
with a safeguarding purpose, 90-day `retain_until`). Everything around it is
pinned metadata-only:

- **Fan-out** (`apps/host/src/app/api/foxy/_lib/safeguarding-escalate.ts`):
  one `notifications` row per ACTIVE school admin, `data` carries
  `{ escalation_id, category }` ONLY — the serialized payload is asserted to
  never contain `disclosure`/`excerpt`/`student_id`/name/email/phone. Zero
  active admins → count 0 with the case row still standing in the
  super-admin queue; B2C (null schoolId) → no lookup at all; DB failure →
  never throws, count 0.
- **Review list APIs** (`/api/super-admin/safeguarding` +
  `/api/school-admin/safeguarding`, canonical `{rows}`/`{row}`/PATCH
  contracts): the LIST projection NEVER selects or returns
  `disclosure_excerpt` — only the single-row `?id=` detail does. Super-admin
  gate is `authorizeAdmin(request, 'admin')` on BOTH verbs; school-admin is
  `authorizeSchoolAdmin` with EVERY query (list, detail, PATCH load, PATCH
  update) hard-scoped to the caller's `school_id` (P8). PATCH transitions
  `pending_review → reviewed/actioned/dismissed` only; non-pending → 409;
  audit metadata-only.
- **Route audit**: the `flow:'safeguarding'` audit row carries
  category/tier/escalated only — asserted to never contain the student's
  message text. `classifier_meta` on the escalation row is
  `{ confidence, label }` only.

Pinned by `safeguarding-escalate.test.ts`,
`super-admin-safeguarding.test.ts`, `school-admin-safeguarding.test.ts`, and
the audit/fan-out assertions in `safeguarding-route.test.ts` (all under
`apps/host/src/__tests__/api/`). P13 + P8 + P9.

## REG-350 — Student memory self-access whitelist + scoped erasure routing + RLS-closed safeguarding table (2026-08-05)

**Status: E** on the TS surfaces; the four memory/erasure migrations
(`20260806000300` scope column, `20260806000400` memory permissions,
`20260806000600` guardian_id nullable, `20260806000700` scoped purge RPC,
`20260806000800` frustration_threshold drop + affective fn rewrite) have
structural coverage only — no live-Postgres execution this session.
2026-08-05 addendum (PR6 review pin): `20260806000800` now carries a
dedicated static structure pin,
`apps/host/src/__tests__/security/affective-profile-drop-migration.test.ts`
(5 tests, comment-stripped active-DDL assertions): the replaced
`compute_student_affective_profile` body contains NO
`frustration_threshold` write and NO `PERCENTILE_CONT` feeder while
preserving the adaptive_profile boredom_floor/frustration_ceiling upsert;
exactly ONE `DROP COLUMN` (IF EXISTS, on `student_learning_profiles`
only), function-first ordering inside a single BEGIN/COMMIT;
`evaluation_state` (whose same-named integer column is NOT covered by
approval A4) untouched — the only ALTER TABLE target is
`public.student_learning_profiles`; SECURITY DEFINER + search_path +
PUBLIC/anon/authenticated EXECUTE revoke re-asserted.

Three boundaries pinned together:

1. **RLS-closed safeguarding table** — static structure pin
   `apps/host/src/__tests__/security/safeguarding-escalations-migration.test.ts`
   (8 tests) on migration `20260806000100`: RLS enabled in the same
   migration (P8); EXACTLY ONE policy and it is `service_role` ALL; NO
   `TO authenticated`/`anon`/`auth.uid()`/parent-link/teacher-assigned
   predicate in active DDL; the DELIBERATE-DEVIATION rationale comment
   (no student self-read — flag-discovery is itself a harm vector; no
   parent-linked — A1 human-in-the-loop, the parent may be the subject; no
   teacher-assigned) pinned PRESENT so a future "conformance fix" toward the
   house 4-pattern template cannot claim ignorance; excerpt-cap/enum CHECKs;
   `safeguarding.review` seeded + granted (institution_admin + explicit
   admin/super_admin replay-order grants) in the SAME migration; additive-only.
2. **Memory self-access whitelist** — `GET /api/learner/memory`
   (`memory.view_own` + `requireStudentId`) returns ONLY the student-facing
   projection: cognitive {weakTopics, strongTopics, revisionDue,
   recentErrors}, longMemory {summary, highConcepts, lowConcepts,
   topMisconceptions}, preferences, **twin: null** — cohortPercentile,
   loSkills/pKnow, knowledgeGaps, nextAction, remediationText asserted
   ABSENT from the serialized body. Grade is the SERVER-fetched string (P5),
   409 pre-onboarding. Erasure guard tripped → empty layers +
   `erasurePending: true` with `getStudentMemory` never called (fail-closed
   blank, DPDP posture consistent with REG-309).
3. **Scoped erasure never hits the full-account cascade** —
   `DELETE /api/learner/memory` (`memory.erase_own`) zod-validates the scope
   layer (unknown layer → 400, nothing inserted) and writes a pending
   `data_erasure_requests` row with `scope` jsonb + purge_at ≈ now+30d,
   metadata-only audit. The worker (`packages/lib/src/data-erasure-purger.ts`
   + `data-erasure-purger` Edge Function + daily-cron purge step) ROUTES
   scoped rows into the scope-aware `execute_data_erasure_purge` RPC
   (migration `20260806000700`: scope IS NOT NULL → mapped memory-layer
   tables only, unknown layer fails closed INSIDE the RPC — never the
   full-account cascade); `parent.child_erasure_completed` fires ONLY for
   full-account (parent-initiated) rows, never scoped ones; pre-migration
   deploys fall back to the legacy projection (backward-compat pin).

Pinned by `apps/host/src/__tests__/api/learner-memory.test.ts`,
`apps/host/src/__tests__/lib/data-erasure-purger-scoped-skip.test.ts`, the
migration structure test above, and
`packages/lib/src/__tests__/policy/prohibited-inferences.test.ts` (PR2
never-disclose/never-diagnose policy module shared with the classifier
prompt). P13 + P8 + P5.

**Known gaps (honest):** no live-Postgres execution of any 202608060001xx-08xx
migration this session (structural pins only, same posture as REG-346); the
scoped-purge RPC's per-layer table mapping is pinned at the routing/TS layer,
not by executing the plpgsql; the review QUEUES (folded into tabs at
`/super-admin/foxy-quality?tab=safeguarding` and
`/school-admin/escalations?tab=safeguarding` — components
`apps/host/src/app/super-admin/foxy-quality/SafeguardingQueue.tsx` /
`apps/host/src/app/school-admin/escalations/SafeguardingQueue.tsx`) and
memory screen have component-level tests
(`HelplineCard.test.tsx`, `memory-page.test.tsx`) but no E2E.

### Catalog total

Pre-REG-348: 347 entries (through REG-347, IRT resurrect behavior-neutrality
— see `00-header.md`). Adds REG-348 (safeguarding two-tier fail-closed
contract), REG-349 (safeguarding P13 data boundary), REG-350 (memory
self-access whitelist + scoped erasure routing + RLS-closed safeguarding
table).
**Total catalog: 350 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-357 — Foxy North-Star Phase 3: IRT shadow serving-order-unchanged + telemetry P13 (2026-08-05)

Added 2026-08-05 (testing agent, Phase 3 batch). Sits alongside the IRT/AI
observability pins (REG-311 ResponseEval sensor, REG-316 RAG confidence v2
shadow) rather than in `03-quiz-integrity.md`, because the pattern is
identical: an OBSERVABILITY-ONLY signal that must not touch serving order
until it graduates.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-357a | `irt_shadow_serving_order_unchanged` | The `select_questions_by_irt_info_v2` RPC (migration `20260809000100`) is a shadow-only extension: its return set and ORDER BY match the v1 RPC exactly, so quiz-question serving order is identical whether the caller reads v1 or v2. Flag `ff_irt_shadow_v1` (seed `20260809000000_seed_ff_irt_shadow_v1.sql`, default OFF/0%) gates ONLY the emission of shadow telemetry — no serving path reads it as a selection input. `estimateTheta` (`packages/lib/src/irt/estimate-theta.ts`) is a pure TS mirror of the SQL Newton-Raphson used for shadow-metric computation; production selection continues to run through the v1 Fisher-info RPC (pinned by the existing `packages/lib/src/irt/fisher-info.ts` tests). Flag-OFF → zero shadow calls, zero telemetry rows, zero serving-order diff. | `apps/host/src/__tests__/lib/irt/estimate-theta.test.ts`; `apps/host/src/__tests__/lib/irt/shadow-metrics.test.ts`; `eval/irt/` harness | E | P1-adjacent (serving order), P12 (observability-only contract) |
| REG-357b | `irt_shadow_telemetry_p13` | The `POST /api/telemetry/irt-shadow` payload carries UUIDs + numbers only: `studentId` (UUID), `questionId` (UUID), `theta` (number), `discrimination` (number), `difficulty` (number), `probability` (number), `served_via` (short enum, one of `'v1_fisher'`/`'v2_shadow'`). ZOD schema rejects free text, names, emails, phones. Route is `authorizeRequest`-gated (server-side), never called from browser code without a session token. Error responses carry generic messages — no student identifiers echoed. This mirrors REG-311's ResponseEval PII-clean fire-and-forget shape and REG-134's audit-log PII boundary. | `apps/host/src/__tests__/api/telemetry/irt-shadow.test.ts` | E | P13, P12 |

Honest gap: the migration `20260809000100_select_questions_by_irt_info_v2.sql`
has never executed against a real Postgres this session — structural pins on
the SQL text only. The Vitest pins exercise the pure TS mirror and the
route's request/response envelope, neither of which touches the DB.

### Catalog total (updated)

Pre-REG-357: 356 entries (through REG-356, which lives in `03-quiz-integrity.md`
alongside the other Phase 3 quiz-facing pins). Adds REG-357 (IRT shadow
serving-order + telemetry P13). REG-358 (SRS single predicate) is also in
`03-quiz-integrity.md`.
**Total catalog: 358 entries (target: 35 — TARGET EXCEEDED).**

---

## REG-359 — Foxy route CHARACTERIZATION FIXTURES (R3 decomposition tripwire) (2026-08-05)

Added 2026-08-05 (testing agent, Phase 4 wave 4a). Promoted into the shard by
ops as part of Phase 4 wave 4b so the R3 pipeline-decomposition wave has a
sanctioned catalog entry to point at (see also
`docs/runbooks/foxy-r3-decomposition-plan.md`).

Byte-for-byte characterization of the CURRENT
`apps/host/src/app/api/foxy/route.ts` (post Phases 0-3) so the R3
decomposition PR series — which extracts named pipeline stages out of
`handleFoxyPost` into `apps/host/src/app/api/foxy/_pipeline/{observe,gate,
diagnose,decide,teach,check,update,close}.ts` — can prove behavior
preservation by re-running this suite unchanged.

Per pinned turn, THREE artifacts:
1. `groundedRequest` — the full `GroundedRequest` handed to the mocked
   `callGroundedAnswer`; fingerprints prompt-assembly output (every template
   variable, scope, generation config, retrieval config). `null` for turns
   that never reach the grounded call (kill-switch OFF, quota 429, grade
   spoof, math terminal, safeguarding terminal, curriculum-scope fail,
   out-of-scope terminal).
2. `wireJson` — the parsed HTTP response body. Deep-equaled against the
   fixture; top-level key insertion order also pinned via `wireJsonKeyOrder`
   (V8 preserves insertion order, and the mobile parser depends on it —
   see R3 risk register #2).
3. `dbOps` — ordered sequence of `.from(<table>)` calls observed against
   the fake supabaseAdmin, tagged with the writing op
   (insert/update/upsert/delete/select) and top-level PATCH keys where
   present. Fingerprints persistence side-effect ordering.

Flag-sweep contract: every flag the route reads is exercised in the flag-
sweep block: one ON run and one OFF run against the baseline "learn
cold-start" fixture (itself captured with every flag OFF). Every OFF run
MUST deep-equal the baseline; this pins the "OFF is byte-identical" claim
the route documents inline for each flag. Current OFF sweep covers 20
flag-OFF paths.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-359a | `foxy_route_characterization_fixtures` | 11 seeded fixtures deep-equal the pinned `groundedRequest` + `wireJson` (with `wireJsonKeyOrder`) + `dbOps` triple for the current route: `001-learn-cold-start`, `002-learn-full-cognitive-context`, `003-quiz-me-intent`, `004-real-practice-flag-on`, `005-abstain-upstream-error-refund-legacy`, `006-abstain-low-similarity-no-refund`, `007-abstain-chapter-not-ready-refund`, `008-legacy-kill-switch`, `009-grade-spoof-403`, `010-quota-429`, `011-streaming-requested-flag-off`. Fixture update mechanism is `FIXTURE_UPDATE=1 npx vitest run …` and re-running WITHOUT that env var MUST be byte-identical. | `apps/host/src/__tests__/api/foxy/foxy-route-characterization.test.ts`; `apps/host/src/__tests__/fixtures/foxy-golden-turns/001-011*.json` | P (11 of 16 pinned; 5 turns declared `pending:true` — math-solve mock, curriculum-scope T3, safeguarding two-tier chain, `foxy_messages` roster, `chapter_concepts` snapshot — seeded by R3-A per `docs/runbooks/foxy-r3-decomposition-plan.md` §2) | P12 (behavior-preservation of the AI-facing route), P13 (fixtures redact PII), P6 (question-quality path preserved) |
| REG-359b | `foxy_route_flag_off_byte_identity` | Every OFF run in the flag sweep deep-equals the baseline `001-learn-cold-start` fixture. Enforces the OFF-identity contract each flag documents inline in `route.ts`. | same file | E | P14 (flag-OFF byte identity is a review-chain contract) |

Post-R3-B/R3-C extension: after each stage extraction, re-running this suite
unchanged is the go/no-go gate; a fixture diff means the extraction was NOT
byte-identical and the PR is blocked. R3-A seeds the remaining 5 pending
fixtures so R3-B has full coverage before extraction begins.

---

## REG-360 — FoxyPanel embed static-import guard (P10 bundle boundary) (2026-08-05)

Added 2026-08-05 (Phase 4 wave 4b — U1 rollout). See runbook
`docs/runbooks/foxy-panel-embed-rollout.md`.

The Phase 4 U1 rollout extracted the Foxy chat panel to
`packages/ui/src/foxy-panel/` and gave it a sanctioned tap-gated entry-point
`packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx` that dynamic-imports
the panel module via `next/dynamic({ ssr:false })` ONLY on tap. Three live
embed points (dashboard, learn chapter, quiz results) use the launcher; the
panel's ~200+ kB combined chat+streaming+markdown+KaTeX chunk therefore
never contributes to those pages' first-load JS. This regression pins that
boundary: if any `apps/host/src/app/**/page.tsx` ever statically imports
`@alfanumrik/ui/foxy-panel/*`, first-load JS for that page balloons and
breaks the P10 budget for the embed hosts.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-360 | `foxy_panel_no_static_embed` | Walks every `apps/host/src/app/**/page.tsx` and asserts NO file contains a static import matching `/from\s+['"]@alfanumrik\/ui\/foxy-panel(\/[^'"]+)?['"]/`. The launcher path (`@alfanumrik/ui/foxy-launcher/*`) is intentionally out of scope — it IS the sanctioned static entry-point. The `/foxy` page's own `apps/host/src/app/foxy/_...` re-export stubs are transitive and do not appear as literal `@alfanumrik/ui/foxy-panel` strings in the page's own source, so the walk cleanly ignores them (preserves pre-Phase-4 /foxy behavior). | `apps/host/src/__tests__/regressions/foxy-panel-no-static-embed.test.ts` | E | P10 (bundle budget for embed hosts), P14 (frontend->ops review-chain contract on embed changes) |

Adjacent evidence: `packages/ui/src/foxy-panel/` (FoxyPanel + MessageInput +
MessageList + useFoxyChat + foxy-types + foxy-constants),
`packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx`, first-load JS
baselines unchanged for the three embed pages (dashboard 124.5, learn 167.4,
quiz 177.0 kB).

### Catalog total (updated)

Pre-REG-359: 358 entries. Adds REG-359 (Foxy characterization fixtures,
Phase 4 wave 4a promoted this wave) and REG-360 (FoxyPanel static-import
guard, Phase 4 wave 4b).
**Total catalog: 360 entries (target: 35 — TARGET EXCEEDED).**

---

## Foxy MasteryAwareness — mastery ring no-shrink guard (2026-08-05) — REG-370

> **Renumbered 2026-08-05 (was REG-348).** Upstream PR #1465 (Foxy North-Star,
> 7-commit program) reached `main` first and consumed REG-345..REG-366 — its
> own REG-348 is the safeguarding two-tier fail-closed contract earlier in this
> same shard — so per this catalog's numbering convention the not-yet-merged
> side moves up. This entry's three siblings moved REG-345..REG-347 →
> REG-367..REG-369 in `15-cross-cutting.md` in the same pass.

Source: `docs/superpowers/specs/2026-08-05-student-ia-consolidation-design.md`
— the Foxy-surface member of the same four-defect IA-consolidation pass whose
other three guards are REG-367..REG-369 in `15-cross-cutting.md`.

The Foxy weak-topic nudge row is a flex container holding two children:

```
[ MasteryRing (fixed 40px) ]   [ text block: flex-1 min-w-0 ]
```

`flex-1 min-w-0` deliberately lets the text block grow AND shrink past its
content width — that is what makes the `truncate` on the topic title work.
But flex items default to `flex-shrink: 1`, and the ring has no intrinsic
minimum once it is a flex item, so with a long topic title on a narrow
viewport the ring's box is compressed below its declared 40px. `MasteryRing`
renders a fixed-size `<svg width={size} height={size}>`, so the SVG keeps its
40px while the box around it shrinks: **the stroke visibly clips**.

The fix wraps the ring in `shrink-0`. It has to be a WRAPPER because
`MasteryRing` accepts no `className` prop — so the guard is ONE LINE OF
MARKUP, trivially lost in any future refactor of this row, with no type error
and no test failure to announce it. That fragility is the entire reason this
entry exists.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-370 | `foxy_mastery_ring_no_shrink` | The component is RENDERED for real (only the `useMasteryOverview` data seam is mocked, following the hook/fetch-seam convention of `momentum-wave2-visuals.test.tsx`), fed one "started but not mastered" row — the only state in which the nudge, and therefore the ring, renders — with a deliberately long real-world topic title, which is the actual squeeze trigger. **Premise pinned first:** the nudge really does render a `MasteryRing` (`role="img"` with `aria-label="Mastery: 42%"` from the 0.42 probability), and renders NO ring when the only topic is already mastered — so a future change that stops rendering the ring shows up as a premise failure rather than a vacuously-green guard. **The guard:** the element that actually WRAPS the ring's `role="img"` node carries a no-shrink utility (`shrink-0` or `flex-shrink-0`), in English AND in Hindi (the Hindi title is longer, so the squeeze is worse there). **The coupling is pinned in both directions:** the ring's flex SIBLING still carries `flex-1 min-w-0` — the condition that makes the guard NECESSARY — and both live in the SAME parent, which is asserted to be a `flex` row, so they really are competing flex items rather than incidentally-adjacent nodes; and the text block is asserted NOT to be shrink-protected and to still contain a `.truncate` child, because guarding both would break the title truncation — asserting the ASYMMETRY stops an over-eager "fix". **Geometry coupling to REG-368:** the call site is pinned to ask for exactly `size=40 strokeWidth=4` (asserted on the rendered `<svg width/height>` and the circle's `stroke-width`), so if this site ever moves to a different size, REG-368's 40/4 worst-case case must move with it. **Documented limit:** JSDOM applies no CSS and computes no layout, so this asserts the utility classes on the RENDERED tree rather than a measured width — it verifies the guard is PRESENT, not that the browser honours it. That is the strongest check available below a visual-regression run. | `apps/host/src/__tests__/foxy/mastery-awareness-ring-no-shrink.test.tsx` (8) | E | P7 (the guard is asserted in both EN and HI), P12-adjacent (Foxy student surface integrity) |

### Invariants covered by this section

- **P7 (bilingual UI)** — the guard is asserted in BOTH language modes, not
  just the English default. The Hindi title is longer, so the Hindi render is
  the worse squeeze; a guard that only held in English would fail exactly the
  users it matters most for.
- **P12-adjacent (Foxy student-facing surface)** — no AI behaviour changes
  here; this pins the presentation integrity of the Foxy mastery nudge, the
  surface through which the tutor communicates a student's own mastery. A
  clipped ring misreports nothing numerically (the `aria-label` and the
  percentage are unaffected), so this is adjacent to P12 rather than an AI
  safety pin.
- **Fragile-by-construction markup** — the load-bearing artifact is one
  wrapper `div`. There is no type, no prop and no lint rule that can protect
  it, which is precisely what makes a regression entry the right instrument.

### Catalog total

Pre-REG-370: 369 entries (through REG-369, the internal-link canary — see
`15-cross-cutting.md`, where REG-367..REG-369 from this same
IA-consolidation pass are catalogued). Adds REG-370 (Foxy MasteryAwareness
mastery-ring no-shrink guard — rendered-DOM class assertions in both
languages plus the flex-sibling coupling and the 40/4 geometry pin shared
with REG-368; presence-not-browser-truth, see the documented limit above).
**Total catalog: 370 entries (target: 35 — TARGET EXCEEDED). REG-371 is the
next free id** (the ops-owned student-IA spec's own proposals are being
renumbered into REG-371..REG-377 in a parallel pass; if that batch lands
first, the next free id moves to REG-378).

Note on this shard's two running counters: the `### Catalog total (updated)`
block immediately above this section reads 360 because it is upstream PR
#1465's Phase 4 wave-4a/4b counter, written before Phase 5 (REG-361..REG-365)
and the K9 fold-in (REG-366) landed. 369 above is the header's declared 366
plus this pass's three `15-cross-cutting.md` entries; it is not derived
independently. See the honesty note in `00-header.md` about REG-361..REG-365.

---

## REG-419 — ncert-solver → grounded-answer migration: prompt-parity canary (2026-08-23)

Added 2026-08-23 (testing agent, release-readiness gate pass on
`release/launch-readiness` before the two-thread quality handoff). Source
change: `supabase/functions/ncert-solver/index.ts` (RAG retrieval extracted
to a new local `supabase/functions/ncert-solver/retrieval.ts`, plus a
`marks` template-variable default-fallback fix), `supabase/functions/
grounded-answer/prompts/inline.ts` (new subject-safety + answer-depth prompt
blocks added to `NCERT_SOLVER_V1`), `supabase/functions/grounded-answer/
pipeline.ts` (defense-in-depth `{{marks}}` default), `supabase/functions/
_shared/rag/retrieve.ts` (migration-status comment update only).

ncert-solver has two retrieval paths gated by `ff_grounded_ai_ncert_solver`:
the LEGACY path (flag OFF) builds its own solver prompt with subject-specific
safety rules (math: no L'Hopital/integration-by-parts for below-grade
methods; science: only NCERT-sourced numerical values/experimental results,
no invented constants; social science: only NCERT-sourced dates/events/
names) and its own marks-depth answer-length guidance. The SERVICE path
(flag ON) routes through the shared `grounded-answer` pipeline using the
`ncert_solver_v1` prompt template. Migrating the routing without also
migrating the solver's own prompt engineering into the shared template would
silently regress AI-safety guardrails (P12) the moment the flag flips ON —
the service path would still retrieve and cite correctly, but a fabricated
higher-grade math method, an invented experimental value, or a wrong marks-
depth answer would no longer be blocked by prompt instruction. This canary
pins that the template DOES carry the parity-closing content and pins the
service-path request shape so a regression is caught statically, before any
flag flip.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-419a | `ncert-solver imports retrieveSolverContext from local retrieval module` | `ncert-solver/index.ts` imports `retrieveSolverContext` from `./retrieval.ts` (not the deprecated `_shared/rag-retrieval.ts` shim), still references `callGroundedAnswer` and gates on `ff_grounded_ai_ncert_solver` | `apps/host/src/__tests__/edge-functions/ncert-solver-prompt-parity.test.ts` | E | P12 |
| REG-419b | `ncert_solver_v1 template lives in grounded-answer/prompts/inline.ts` | `NCERT_SOLVER_V1` is exported from `inline.ts` and registered under the `ncert_solver_v1` template key | same file | E | P12 |
| REG-419c | `GAP-1 CLOSED: subject-specific safety rules` | Template text matches the math (`L'Hopital`, `integration by parts`), science (`specific numerical values`, `experimental results`), and social-science (`specific dates, events, names`, `historical claims`) exclusion rules carried over from the legacy solver prompt | same file | E | P12 |
| REG-419d | `GAP-2 CLOSED: marks-depth channel` | Template carries `{{marks}}` plus the three depth bands (`1-2 sentences`, `3-5 sentences`, `detailed with definition, explanation, and example`) | same file | E | P12, P6 (answer-depth quality) |
| REG-419e | `GAP-3 unchanged: no solver-type routing in the template` | Template text contains no solver-type-routing vocabulary (`route to solver`, `solver type`, `deterministic solver`, `rule_based solver`) — routing is deliberately kept in `index.ts`, not the prompt | same file | E | P12 (scope discipline — routing concerns stay out of the prompt) |
| REG-419f | `flag-ON request carries the service-expected shape` | The flag-ON code path's request builder pins `mode: 'strict'`, `cache_scope: 'shared'`, `system_prompt_template: 'ncert_solver_v1'`, a numeric `match_count`, and `caller: 'ncert-solver'` | same file | E | P12 |

All 6 assertions are static source-text canaries (no live retrieval, no live
Claude call) — they pin that the template text and the request-builder text
exist as required, not that the deployed service actually produces a
safety-compliant answer at runtime. Re-run 2026-08-23 as part of this
release-readiness gate together with the 3 sibling ncert-solver suites
(`ncert-solver.test.ts`, `ncert-solver-security.test.ts`,
`ncert-solver-grounded-gate.test.ts`): **4 files / 43 tests, all passing.**
The CI-scoped Deno test target list for `grounded-answer/__tests__/` (21 of
26 files — the other 5 need `--allow-net` for `Deno.serve` and are
deliberately excluded, see `00-header.md`/ci.yml note) was independently
re-run the same session: **259 passed, 0 failed.**

**Known non-blocking debt found during this pass (not part of REG-419's own
scope, flagged to ai-engineer):** `deno check --no-lock
supabase/functions/ncert-solver/index.ts` reports 26 diagnostics on the
post-change file vs. 16 on the pre-change baseline (+10), all the same
pre-existing `SupabaseClient<any,"public",...>` vs. `SupabaseClientLike`
mismatch against `_shared/security/ai-admission.ts:130`'s `finalizeAiRoute`/
`refundQuota` signatures — the retrieval refactor added call sites that hit
an already-broken type, it did not introduce a new type error class.
`deno check` is explicitly advisory-only in CI (`.github/workflows/ci.yml` —
"this step measures, it does not gate"), so this does not block Gate 1, but
the debt grew and should be cleaned up by whoever next touches
`ai-admission.ts`'s `SupabaseClientLike` interface.

---

## REG-420 — Foxy dimension-level feedback + AI-quality dashboard: aggregate-only P13 contract (2026-08-23)

Added 2026-08-23 (testing agent, release-readiness gate pass). New surface:
migration `20260818_01_create_foxy_message_dimension_feedback.sql`
(`foxy_message_dimension_feedback` table + `record_message_dimension_feedback`
RPC), `apps/host/src/app/api/foxy/feedback/dimension/route.ts` (POST, student-
facing), `apps/host/src/app/api/super-admin/ai-quality/route.ts` (GET,
super-admin aggregate dashboard data source), `apps/host/src/app/super-admin/
ai-quality/page.tsx`, plus two new pure modules `packages/lib/src/foxy/
dimension-feedback-schema.ts` and `packages/lib/src/foxy/preference-filter.ts`
(Phase B design-ahead, unwired).

This entry pins the super-admin AI-quality dashboard's read contract: the
route reads 5 tables (`foxy_quality_scores`, `ops_events`,
`foxy_message_feedback`, `foxy_message_dimension_feedback`,
`foxy_chat_messages`) over a trailing-30-day window and returns COUNTS,
AVERAGES, and enum-like keys (dimension names, coach modes, judge model /
rubric version strings) only — never message text, `reason` free text, or
student identifiers (P13) — behind the existing `super_admin.access`
permission (no new RBAC surface, P9).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-420a | `denies non-super-admin callers with 403` | Auth denial short-circuits BEFORE any DB read; route returns the authorizer's `errorResponse` verbatim | `apps/host/src/__tests__/api/super-admin/ai-quality.route.test.ts` | E | P9 |
| REG-420b | `checks the existing super_admin.access permission` | `authorizeRequest` is called with `'super_admin.access'` — no new permission introduced | same file | E | P9 |
| REG-420c | `returns 200 with zero-filled data from empty tables` + per-table aggregation tests (judge scores, feedback thumbs, dimension feedback by dimension, coach-mode counts, ops AI-event sources) | Response shape is `{ success, data: { judge, ops, feedback, messages } }` with correct aggregate math (means, counts, group-bys) and never leaks a row-level field beyond the documented aggregate shape | same file | E | P13 |
| REG-420d | `returns the authorizer errorResponse verbatim when unauthorized (401)` / `...forbidden (403)` | Auth denial (`progress.view_own` + `requireStudentId`) short-circuits BEFORE the ownership lookup/RPC; route returns `auth.errorResponse` verbatim | `apps/host/src/__tests__/api/foxy/feedback-dimension.route.test.ts` | E | P9 |
| REG-420e | `returns 400 for missing/malformed messageId`, `...invalid/missing dimension`, `...non-boolean isUp`, `...non-JSON body`, `...non-string reason` | Manual body validation rejects each invalid shape with 400/`BAD_REQUEST` before any DB call | same file | E | P6 |
| REG-420f | `returns 404 when the message does not exist` / `...with the IDENTICAL shape when the message belongs to a different student` / `...but is not an assistant turn` | The ownership trust-boundary collapses "not found", "wrong owner", and "wrong role" into byte-identical 404 `NOT_FOUND` responses — the cross-tenant probing property this route exists to prevent — and the RPC is never invoked on any of the three | same file | E | P13 |
| REG-420g | `happy path: calls the RPC with the correct args and returns 200...`, `accepts each of the 4 allowed dimension values`, `returns 404 when the RPC itself returns an empty row set` | `record_message_dimension_feedback` is called with `{p_message_id, p_dimension, p_is_up, p_reason}`; 200 response shape is `{success:true, data:{feedbackId, coachModeUsed}}` sourced from the RPC result, not recomputed | same file | E | P1-adjacent (server-response-is-truth pattern) |
| REG-420h | `truncates a reason longer than 500 chars...`, `coerces an empty-string/whitespace-only/missing reason to null...` | `reason` is trimmed, capped at exactly 500 chars, and empty/whitespace/absent all normalize to `null` before reaching the RPC | same file | E | P6 |
| REG-420i | `returns 500 when the RPC errors, and never logs the reason text (P13)` / `...when the ownership lookup itself errors...` | RPC/DB failures return 500 `RPC_ERROR`; `logger.error` call args are asserted (via `JSON.stringify` on every call) to never contain the caller-supplied `reason` string | same file | E | P13 |

**Coverage gap CLOSED 2026-08-23 (testing agent, this pass):** `POST
/api/foxy/feedback/dimension` previously had **zero test coverage** despite
being a live, deployed, RBAC-gated, service-role-using route with its own
documented ownership trust-boundary check. REG-420d-i above (22 tests total
in `apps/host/src/__tests__/api/foxy/feedback-dimension.route.test.ts`,
run and confirmed green) now exercise the 401/403 auth gate, all 400
body-validation branches, the cross-student/wrong-role ownership rejection
(asserted byte-identical across both failure modes — the specific security
property the route's header comment calls out), the happy-path RPC
call/args/response shape, `reason` truncation + null-coercion, and a P13
spot-check that `logger.error` never receives the `reason` text on either
failure path. `packages/lib/src/foxy/dimension-feedback-schema.ts` (the
unused Zod schema) remains untested and unwired — that is a separate,
lower-severity gap (dead code, not a live trust boundary) and is not closed
by this pass. **Status upgraded P → E** for the route's own test coverage;
the dashboard's READ contract (REG-420a-c) was already E.

**Two governance-ledger regressions found during this pass, NOT part of
REG-420's own scope but discovered while verifying it — flagged to architect,
blocking Gate 3 until resolved:**
1. `apps/host/src/__tests__/api-admin-client-allowlist.test.ts` (REG-213,
   P8/P9 — "frozen blast radius" guard, owner: architect for the ledger,
   testing for the guard) FAILS: `apps/host/src/app/api/super-admin/
   ai-quality/route.ts` imports the service-role `supabaseAdmin` client but
   was never added to `scripts/admin-client-allowlist.json`. Detected count
   275 vs. expected 274. (The sibling `feedback/dimension/route.ts` WAS
   correctly added to this ledger — only `ai-quality/route.ts` was missed.)
2. `apps/host/src/__tests__/api/route-access-manifest.test.ts` (RCA-02,
   structural manifest-completeness guard) FAILS: `/api/super-admin/
   ai-quality` has no entry in `scripts/route-access-manifest.json` at all
   (the diff shows the path missing outright, not just misconfigured).

Both are static, deterministic, pre-existing guards doing exactly their
documented job — a new service-role-using super-admin route shipped without
the two required governance-ledger updates. Not a REG-420 test defect; the
route itself needs the two ledger entries added (architect owns both
ledgers) before this can pass Gate 3.

---

