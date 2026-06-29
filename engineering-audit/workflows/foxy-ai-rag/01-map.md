# Foxy AI Tutor & RAG — Workflow MAP (Cycle 4, DISCOVER→MAP)

**Scope:** the end-to-end Foxy chat turn as a student experiences it, plus the
sibling AI Edge Functions (ncert-solver, quiz-generator, cme-engine). Analysis
only — no application code changed.

**Governing invariants:** P12 (AI safety), P8 (RLS on RAG/vector reads), P13
(no PII in AI logs/traces).

---

## 0. What is actually LIVE (constitution reconciliation)

The constitution note that `/api/foxy/route.ts` is "the new RAG+sonnet route —
not yet wired to UI" is **STALE**. Evidence:

- `src/app/foxy/page.tsx` (the student chat UI) posts to `/api/foxy`.
- `src/app/api/foxy/route.ts` is a 2,411-line production handler with full
  auth, quota, session, cognitive-context, persistence and audit wiring.
- The legacy `supabase/functions/foxy-tutor/` directory **no longer exists on
  disk** (Glob returns nothing). It was superseded.
- The grounded LLM work now lives in `supabase/functions/grounded-answer/`,
  which `/api/foxy` calls via `callGroundedAnswer()`
  (`src/lib/ai/grounded-client.ts:207`).
- `supabase/functions/grounded-answer/index.ts:2-4` itself logs
  `api_deprecated_edge_function_hit` with `canonical_route: '/api/foxy'` —
  i.e. direct Edge-Function hits are treated as deprecated; the Next.js route
  is canonical.

> **RECORDED IN LEDGER (Cycle 4, 2026-06-29).** This live-topology reconciliation
> is the authoritative Cycle-4 finding: `/api/foxy` is the LIVE production route;
> the legacy `foxy-tutor` Edge Function no longer exists; `grounded-answer` is the
> LLM pipeline. The constitution's "`/api/foxy` … not yet wired to UI" note is
> STALE and should be corrected on the next constitution reconciliation. Carried
> into `STATE.md` and `cycles/2026-06-29-foxy-ai-rag.md`.

**Live topology (default flags):**

```
student → /api/foxy (Next.js, RBAC + quota + session + prompt assembly)
        → callGroundedAnswer() (src/lib/ai/grounded-client.ts)
        → POST {SUPABASE_URL}/functions/v1/grounded-answer  (signed internal call)
        → grounded-answer Edge Function (Deno): admission → pipeline
            (coverage → cache → kill switch → circuit → Voyage embed →
             retrieve → rerank → MMR → Claude(Haiku→Sonnet→OpenAI) →
             grounding-check[strict] → confidence → structured parse → trace)
        → response normalized + persisted by /api/foxy → student
```

Two kill-switch / fallback layers exist beneath this:
1. `ff_grounded_ai_foxy` OFF → **legacy intent-router flow**
   (`src/app/api/foxy/_lib/legacy-flow.ts` → `src/lib/ai/workflows/*`).
2. Within the grounded path, several flag-gated additive branches (math
   pipeline, curriculum guard, digital twin, native turns, streaming).

---

## 1. The Foxy turn, step by step (live grounded path)

All file:line citations are in `src/app/api/foxy/route.ts` unless noted.

| # | Step | Function / location | Guard | External call | Fallback |
|---|------|--------------------|-------|---------------|----------|
| 1 | Top-level safety net | `POST` `:365-399` | try/catch wraps entire handler; logs ops-event `severity:critical`; emits `error_rate` metric (P13: error_code only) | — | 503 bilingual error |
| 2 | RBAC auth | `handleFoxyPost` `:425-428` | `authorizeRequest(request,'foxy.chat',{requireStudentId:true})` (P9) | — | `auth.errorResponse` |
| 3 | Global AI kill switch | `:457-467` | `isFeatureEnabled('ai_usage_global')` — halts ALL Claude calls platform-wide without redeploy (REG-39) | — | 503 + `Retry-After:60` |
| 4 | Body parse + grade Zod gate | `:469-494` | `FoxyRequestBodySchema` enforces grade ∈ {"6".."12"} (P5/P12 grade-spoof) BEFORE downstream use | — | 400 INVALID_GRADE |
| 5 | Input validation | `:496-574` | message ≤1000 chars, subject/grade required, mode whitelist (`VALID_MODES`), coachDirective/intent/coachMode all whitelisted (client cannot inject arbitrary values) | — | 400 |
| 6 | Subject governance | `:585-607` | `validateSubjectWrite(studentId,subject)` (422 if subject not enrolled) — runs BEFORE config check so infra state never leaks | — | 422 / warn-and-proceed |
| 7 | Config validation | `:613-625` | requires `SUPABASE_SERVICE_ROLE_KEY` + URL | — | 503 |
| 8 | Plan + enrolled-grade fetch | `:649-670` | `supabaseAdmin.from('students')` server-only read (P8); resolves `plan`, `dbGrade`, `studentName`, `account_status` | — | default free plan; suspended→403 |
| 9 | **P12 grade-spoof HARD block** | `:677-739` | server-fetched enrolled grade is authoritative; client-claimed grade mismatch → 403 + `foxy.grade_spoof_attempt` audit. Onboarded null-grade also blocked; pre-onboarding warn-and-proceed (P15) | — | 403 GRADE_MISMATCH |
| 10 | Quota check (daily limit) | `:757-765` | `checkAndIncrementQuota` (`_lib/quota.ts:22`) → atomic `check_and_record_usage` RPC, per-plan `DAILY_QUOTA` (free 10 / starter 30 / pro 100 / unlimited) | — | 429 quotaRemaining:0 |
| 11 | Session resolve/create | `:769-790` | `resolveSession` (`_lib/session.ts`) server-only `foxy_sessions` write | — | 500 |
| 12 | Context load (parallel) | `:836-854` | `loadCognitiveContext`, `loadHistory`, `loadPriorSessionContext`, `fetchRecentLabContext`, `loadChapterTopicProgress` — all server-only, non-fatal | — | empty context, continue |
| 13 | Long-memory (P13 scrub) | `:870-891` | flag `ff_foxy_long_memory_v1`; synthesis text **scrubbed of studentName** before prompt injection | — | empty section |
| 14 | Pending-expectations / Twin | `:903-946` | flag-gated; twin block is IDs/numbers only (P13), no names | — | empty section |
| 15 | Kill-switch branch | `:953-999` | `ff_grounded_ai_foxy` OFF → legacy flow (`runLegacyFoxyFlow`); refunds quota on failure | legacy intent-router | 503 |
| 16 | STEM curriculum pre-gate | `:1031-1089` | flag `ff_foxy_curriculum_guard_v1`; `validateCurriculumScope(...,'grade_only')` fail-closed; out-of-grade STEM topic → bilingual out-of-scope reply (0 XP) | — | `respondCurriculumOutOfScope` |
| 17 | Math pipeline branch | `:1105-1224` | flag `ff_foxy_math_pipeline_v1`; Classifier→Solver(Haiku)→SymPy verify; persists like a normal turn | grounded-answer math hop | falls through to grounded path |
| 18 | System-prompt assembly | `:1257-1486` | `buildSystemPrompt` (`src/lib/foxy/prompt-sections.ts:683` `FOXY_SAFETY_RAILS`) + lead-concept, topic-progress, coach-directive, lab-context, mastery-intent, unified-context, tenant overrides. **All log lines IDs/counts only (P13)** | — | — |
| 19 | Build GroundedRequest | `:1514-1606` | `temperature:0.3`, `max_tokens:MODE_MAX_TOKENS[mode]`, `system_prompt_template:selectFoxyPromptTemplate(mode)`, `match_count:5`, per-plan `timeout_ms`; chunk content injected server-side via grounded-answer | — | — |
| 20 | Streaming branch | `:1682-1719` | flag `ff_foxy_streaming` + `body.stream`; **quiz_me forced OFF-stream** so MCQ oracle gate runs before display | `handleStreamingFoxyTurn` (`_lib/streaming.ts`) | falls through to blocking |
| 21 | **Single retrieval (REG-50)** | `:1722` | `callGroundedAnswer(groundedRequest)` — exactly ONE grounded hop per turn; cache short-circuits inside the pipeline before retrieval | grounded-answer Edge Fn | abstain payload |
| 22 | Abstain handling | `:1725-1823` | `LEGACY_FALLBACK_ABSTAIN_REASONS`→legacy retry; `REFUND_ABSTAIN_REASONS`→refund quota; hard-abstain returns `response:''` (never a raw error) | — | refund + bilingual |
| 23 | **Structured output validation** | `:1875-1883` | `extractValidatedStructured(grounded,...)` (`_lib/responders.ts`) — defense-in-depth validation at the API boundary before the JSONB column is written or rendered | — | falls back to `answer` string |
| 24 | Quiz-me oracle gate (REG-54) | `:1906-2009` | `gateQuizMeMcq` = deterministic P6 checks + Claude LLM grader; **fails CLOSED**; failing/missing/duplicate MCQ → bilingual fallback, never shown | Claude grader | `buildQuizMeFallbackResponse` |
| 25 | Persist turn | `:2028-2096` | `foxy_chat_messages` server-only write (pre-insert+update under `ff_foxy_native_turns_v1`, else insert) | — | warn, continue |
| 26 | Struggle telemetry | `:2154-2220` | `publishEvent('learner.struggle_observed')` — IDs/enums only, NEVER student words (P13); cannot move mastery | — | warn |
| 27 | Audit log | `:2252-2277` | `logAudit('foxy.chat')` — subject/grade/mode/tokens/model/traceId/confidence; **no message text, no name (P13)** | — | — |
| 28 | Response envelope | `:2307-2349` | `success`, `response` (denormalized text always present), `structured?`, `groundingStatus` (`grounded`/`unverified`/`hard-abstain`), `quotaRemaining`, `traceId`, `upgradePrompt?`. **NCERT `sources`/`diagrams` NOT echoed to client** (`:2292-2297`) | — | — |

---

## 2. The grounded-answer Edge Function pipeline (server-only Deno)

`supabase/functions/grounded-answer/index.ts` (HTTP glue) →
`pipeline.ts:runPipeline` (orchestrator).

### 2.1 Admission gate (`index.ts:93-263`)
- `getRequestId/Ip/Origin` + `hashRequestIp` (salted SHA-256 — IP never stored raw, P13) `:99-100`.
- `validateRequest` (`validators.ts`) — shape gate `:126-140`.
- `resolveSecurityPrincipal` (`_shared/security/auth.ts`) — signed internal caller OR JWT `:145-167`. `/api/foxy` calls are signed via `buildInternalCallerHeaders` (`grounded-client.ts:225`).
- `resolveRoutePolicy` — per route/school/role enable + enforcement mode `:169-219`.
- `reserveQuota` / `computeEstimatedCost` — **second, cost-based quota layer** independent of the route's per-student daily cap `:221-247`; `deny_breaker`→503, else 429.

### 2.2 Pipeline stages (`pipeline.ts:664-1349`)
| Stage | Location | Guard / fallback |
|-------|----------|------------------|
| 1. Coverage precheck | `:686-695` | strict only; `chapter_not_ready` abstain |
| 2. **Cache lookup** | `:700-711` | `buildCacheKey(query,scope,mode)`; hit short-circuits **before retrieval** (REG-50 cost guard) |
| 3. **Kill switch** | `:713-716` | `ff_grounded_ai_enabled`; **fail-closed** to disabled on read error (`:221-226`) |
| 4. Thresholds | `:718-721` | strict vs soft min-similarity |
| 4b. **Circuit breaker** | `:726-733` | `canProceed(circuitKey(caller,subject,grade))`; open → `circuit_open` abstain (REG-39) |
| 5. **Voyage embed (best-effort)** | `:739-749` | `generateEmbedding` returns null on failure; pipeline proceeds keyword-only; null trips breaker via `recordFailure` (REG-37 Voyage fallback) |
| 6. Retrieve | `:760-823` | `retrieveChunks`→`_shared/rag/retrieve.ts` (service-role RPC `match_rag_chunks_ncert`, scope-filtered grade/subject/chapter); Voyage rerank-2 over-fetch 40→top-N; MMR diversity (`ff_rag_mmr_diversity`); transfer-chunks (`ff_digital_twin_v1`) |
| 6b. scope_mismatch | `:863-865` | drops>0 & survivors=0 → `scope_mismatch` abstain (distinct alert signal) |
| 7. retrieve_only | `:880-897` | concept-engine path; citations only, no Claude |
| 8. strict min-3-chunks | `:901-903` | else `no_chunks_retrieved` abstain |
| 9. **Prompt build** | `:905-966` | service vars WIN over caller vars (caller cannot override `reference_material_section`); **every chunk passed through `sanitizeChunkForPrompt`** (prompt-injection defense, P12) + 1500-char cap; foxy structured-output addendum appended for caller=foxy |
| 10. **Claude call** | `:1001-1055` | `callClaude` (`claude.ts:138`) Haiku→Sonnet→gpt-4o-mini→gpt-4o fallback order; never throws; temperature capped at 0.1 when soft+chunks (`:991-993`); auth_error does NOT trip breaker; failure → `upstream_error` abstain |
| 11. Insufficient-context sentinel | `:1124-1126` | `{{INSUFFICIENT_CONTEXT}}`→`no_supporting_chunks` abstain (sentinel never shown to student) |
| 12. Grounding-check (strict) | `:1130-1220` | `runGroundingCheck` LLM verdict; fail→`no_supporting_chunks` abstain |
| 12b. Soft re-grounding retry | `:1236-1277` | one retry when soft answer opens with general-knowledge escape prefix |
| 13. Confidence | `:1281-1292` | strict low-confidence→`low_similarity` abstain |
| 14. **Structured parse + success** | `:1306-1346` | `parseFoxyStructured`→`validateFoxyResponse`+`validateSubjectRules`; any failure→`wrapAsParagraph(rawText)` so `structured` is ALWAYS defined (never throws on bad LLM payload, P12); cache the grounded response |
| trace | `finalizeGrounded/finalizeAbstain` | one `grounded_ai_traces` row per path; `query_preview = redactPreview(query)` (email/phone/token stripped); `query_hash = sha256` (P13) |

### 2.3 Circuit breaker detail (`circuit.ts`)
3-state per-(caller,subject,grade) key: opens after 3 failures in 10s window,
holds open 30s, half-open single probe, 2 probe successes close. In-memory per
isolate + DB-backed `recordCircuitOutcome` (`_shared/security/circuit.ts`).
Memory-bounded (1000-entry LRU + idle prune). REG-39.

### 2.4 Model fallback (`claude.ts:227-251`)
`resolveModelOrder`: Anthropic Haiku/Sonnet first, **OpenAI gpt-4o-mini / gpt-4o
as last-resort fallbacks** (only fire when Claude times out / 5xx / auth-fails
AND `OPENAI_API_KEY` is set). RCA comment notes the Foxy prompt is calibrated
for Claude; OpenAI receives the same prompt verbatim.

---

## 3. PII / P13 posture (where student data flows)

| Sink | Content | Redaction |
|------|---------|-----------|
| `grounded_ai_traces.query_preview` | 200-char query | `redactPreview` strips email/phone/token (`trace.ts:111-117`) |
| `grounded_ai_traces.query_hash` | sha256(normalized) | one-way (`trace.ts:87-94`) |
| `retrieval_traces.query_text` | query | `redactPreview` (`pipeline.ts:183`); `user_id:null` |
| `logger.*` / `logSystemMetric` in route | grade, subject, counts, traceId, correlationId | no name/email/phone/message; explicit P13 comments throughout |
| `logAudit('foxy.chat')` | subject/grade/mode/tokens/model | no message, no name |
| Claude API request | system prompt + chunks + query + history | studentName fetched (`:658`) but used ONLY to SCRUB synthesis text (`foxy-long-memory.ts`); prompt builders do NOT inject name |
| IP | hashed SHA-256 salted | `hashRequestIp` (`index.ts:100`) |

---

## 4. Sibling AI functions (characterization)

| Function | Entry | Live status | Safety surface |
|----------|-------|-------------|----------------|
| ncert-solver | `supabase/functions/ncert-solver/index.ts` | logs deprecated; canonical `/api/scan-solve`. Own circuit breaker (5-fail/60s `:62-70`); routes via `callGroundedAnswer` strict mode + Python proxy option | RAG strict grounding, own breaker |
| quiz-generator | `supabase/functions/quiz-generator/index.ts` | logs deprecated; canonical `/api/v2/quiz/questions`. In-memory rate-limit (20/min) + DB rate-limit; `runDeterministicChecks` quiz-oracle (REG-54) | algorithmic selection + oracle gate; no free-text LLM to student |
| cme-engine | `supabase/functions/cme-engine/index.ts` | BKT/IRT compute — no LLM, no student-facing free text | n/a (P12 not triggered) |

---

## 5. Regression anchors observed in code
- REG-37 Voyage fallback → `pipeline.ts:739-749` (null embedding proceeds).
- REG-39 kill switch + circuit + cache → `route.ts:457`, `pipeline.ts:713`, `circuit.ts`.
- REG-50 single-retrieval → `route.ts:1722` (one hop), `pipeline.ts:700-711` (cache before retrieval).
- REG-54 oracle gate → `route.ts:1906-2009`, `quiz-generator` `runDeterministicChecks`.
- REG-55 structured rendering envelope → `route.ts:1875`, `pipeline.ts:1306-1346`.
