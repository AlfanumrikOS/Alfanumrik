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

