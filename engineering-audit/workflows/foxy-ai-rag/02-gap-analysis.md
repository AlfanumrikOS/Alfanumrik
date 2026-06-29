# Foxy AI Tutor & RAG — GAP ANALYSIS (Cycle 4)

Per-gap schema: ID | Title | Evidence | Business impact | Technical impact |
Severity | Likelihood | Recommendation | Est. effort.

Severity scale: Critical / High / Medium / Low. Likelihood:
High / Medium / Low.

---

## P12 compliance scorecard (explicit)

| P12 requirement | Status | Evidence |
|-----------------|--------|----------|
| Daily usage limits per plan enforced server-side, not bypassable | **COMPLIANT** | `route.ts:757` atomic `check_and_record_usage` RPC + `_lib/quota.ts:22`; second cost-quota layer in Edge Fn `index.ts:221-247`. Client cannot bypass — quota is checked before any LLM call and keyed by server-resolved `studentId`. |
| Kill switch present + effective | **COMPLIANT** | Two layers: `ai_usage_global` (`route.ts:457`) halts platform-wide; `ff_grounded_ai_enabled` (`pipeline.ts:713`, fail-closed `:221-226`). REG-39. |
| Circuit breaker present + effective | **COMPLIANT** | 3-state per-key breaker `circuit.ts` + DB-backed `recordCircuitOutcome`; auth_error excluded; memory-bounded. REG-39. |
| Single-retrieval contract (no double retrieval / cost leak) | **COMPLIANT** | One `callGroundedAnswer` per turn (`route.ts:1722`); cache short-circuits before retrieval (`pipeline.ts:700-711`). REG-50. |
| CBSE scope + grade-appropriateness enforced in system prompt | **PARTIAL** | `FOXY_SAFETY_RAILS` (`prompt-sections.ts:683-721`) sets scope/age/bilingual/grounding rails on the assembled prompt; grade-spoof HARD block (`route.ts:677`) + STEM curriculum guard. BUT see FOX-3 (mode-template coverage) + FOX-1 (no post-filter). |
| EVERY student-facing response post-processed before render (no unfiltered path) | **GAP** | Primary grounded path has NO profanity/age-blocklist output filter — see **FOX-1**. Structured-schema validation + oracle (quiz only) are the only post-processing. |
| No PII to Claude / in traces | **COMPLIANT (with watch item)** | `trace.ts` redaction, name-scrub, IP-hash. See FOX-6 watch item. |
| RAG reads server-only, no RLS bypass | **COMPLIANT** | Retrieval runs inside the Deno Edge Fn via service-role client, scope-filtered; no client-side vector reads. See FOX-5 explicit finding. |

---

## FOX-1 — Primary grounded path lacks a profanity / age-appropriateness output blocklist filter

- **Title:** `validateOutput` (output-guard) and `validateContentScope`
  (content-guard) are wired ONLY into the legacy kill-switch flow, not the live
  grounded path.
- **Evidence:**
  - `src/lib/ai/validation/output-guard.ts:54` `validateOutput` (BLOCKLIST,
    HALLUCINATION_MARKERS, PROMPT_LEAK_MARKERS, ERROR_MARKERS) is imported only
    by `src/lib/ai/workflows/{explain,doubt-solve,revision}.ts` and `src/lib/ai/index.ts`
    (grep: 5 files, all legacy intent-router) and is gated behind
    `config.enableOutputValidation` (`workflows/explain.ts:108`).
  - The legacy workflows run ONLY when `ff_grounded_ai_foxy` is OFF
    (`route.ts:953-999`, `_lib/legacy-flow.ts`).
  - The live grounded path's only "post-process" is structured-schema
    validation (`pipeline.ts:1306-1346` `validateFoxyResponse` +
    `validateSubjectRules`) and `extractValidatedStructured`
    (`route.ts:1875`). Neither checks profanity, self-harm, or
    age-inappropriate language — they validate JSON shape + subject rules only.
  - The streaming path (`_lib/streaming.ts`) emits Claude text deltas straight
    to the browser with no blocklist pass at all.
- **Business impact:** A single off-tone or age-inappropriate Claude generation
  reaches a grade 6-12 student verbatim. Brand/trust + child-safety exposure;
  this is the literal text of P12 ("No unfiltered LLM output to students —
  always post-process").
- **Technical impact:** Defense-in-depth relies entirely on prompt rails +
  Claude alignment. There is no deterministic backstop on the primary path.
- **Severity:** High. **Likelihood:** Low (Claude on a CBSE-scoped prompt is
  well-aligned), but non-zero and unbounded per impression.
- **Recommendation (AUTO-FIX-SAFE):** Wire a deterministic post-filter on the
  denormalized grounded answer (and on stream completion) BEFORE render/persist
  — reuse the existing `validateOutput` blocklist as a fail-soft sanitizer
  (replace flagged tokens, log a P12 ops-event), do NOT change scope behavior.
  Add a Deno twin in `grounded-answer` so the streaming path is covered too.
  This is hardening / missing-guard wiring, not a model or scope change.
- **Est. effort:** M (1-2 days incl. Deno twin + tests + REG entry).

---

## FOX-2 — Student message is not passed through prompt-injection sanitization

- **Title:** Only retrieved CHUNKS are sanitized; the student's raw message goes
  to Claude unsanitized as the user turn.
- **Evidence:** `pipeline.ts:260` `sanitizeChunkForPrompt(c.content)` is applied
  to every chunk; the student `query` is passed verbatim as `userMessage`
  (`pipeline.ts:1003`, `claude.ts:306`). No equivalent sanitize/neutralize on
  `request.query`.
- **Business impact:** A student could attempt "ignore previous instructions"
  jailbreaks. Mitigated because (a) input is the user turn not the system
  prompt, (b) the structured-JSON output contract + `FOXY_SAFETY_RAILS`
  constrain output, (c) grade/subject scope is server-enforced regardless of
  message content.
- **Technical impact:** Residual jailbreak surface on the free-text path
  (non-structured fallback via `wrapAsParagraph`).
- **Severity:** Medium. **Likelihood:** Low-Medium.
- **Recommendation (AUTO-FIX-SAFE):** Add a light input-side injection
  heuristic that, on a strong match, downgrades to the safety-rails-only
  refusal (no scope change). Pairs naturally with FOX-1's post-filter.
- **Est. effort:** S-M.

---

## FOX-3 — Mode→template safety-rail coverage is asymmetric across the 7 Foxy modes

- **Title:** `selectFoxyPromptTemplate` maps modes to 3 templates; the route's
  `VALID_MODES` is only `['learn','explain','practice','revise']` while the
  documented mode set (learn/explain/practice/revise/doubt/homework/explorer)
  is broader.
- **Evidence:**
  - `route.ts:417-421` `selectFoxyPromptTemplate`: practice→`exam_v1`,
    doubt/homework→`doubt_v1`, default→`teach_v1`.
  - `_lib/constants.ts:31` `VALID_MODES = ['learn','explain','practice','revise']`
    — `doubt`/`homework`/`explorer` are NOT in the route whitelist, so a client
    sending `mode:'doubt'` is coerced to `'learn'` (`route.ts:502`) and gets
    `teach_v1`, not `doubt_v1`. The `doubt_v1`/`homework` template branch is
    effectively reachable only by non-route callers.
  - `FOXY_SAFETY_RAILS` is injected on ALL paths via `buildSystemPrompt`
    (`prompt-sections.ts:837`) + passed as `foxy_safety_rails` template var
    (`route.ts:1595`), so the SCOPE/age rails are present regardless of which
    template is chosen — this is a correctness/consistency gap, not a safety
    hole.
- **Business impact:** Doubt/homework students silently get the teach format;
  inconsistent UX, not unsafe.
- **Technical impact:** Dead/under-exercised template branches; drift risk.
- **Severity:** Low. **Likelihood:** High (every doubt/homework turn).
- **Recommendation:** Assessment-reviewed reconciliation of the mode set vs
  `VALID_MODES` vs `selectFoxyPromptTemplate`. **Requires assessment review**
  (curriculum-scope owner) before changing whitelist — do not silently widen.
- **Est. effort:** S (code) + assessment review.

---

## FOX-4 — OpenAI (gpt-4o-mini / gpt-4o) is an active cross-provider fallback

- **Title:** When Claude fails, the pipeline silently fails over to OpenAI with
  the same prompt.
- **Evidence:** `claude.ts:227-251` `resolveModelOrder` includes
  `{provider:'openai', model:'gpt-4o-mini'|'gpt-4o'}` as terminal fallbacks;
  fires whenever Anthropic returns timeout/5xx/auth AND `OPENAI_API_KEY` is set
  (`index.ts:370`, `pipeline.ts:1008`). The OpenAI response is the same untrusted
  free text — and on this path it ALSO lacks the FOX-1 post-filter.
- **Business impact:** A second LLM provider can produce student-facing answers.
  The constitution lists "Changing Claude API model or provider → user approval
  required"; this fallback is already in production. RCA comment
  (`claude.ts:228-232`) acknowledges format/persona deviation risk since OpenAI
  gets the Claude-calibrated prompt verbatim.
- **Technical impact:** Output-quality + safety variance on the fallback leg;
  amplifies FOX-1.
- **Severity:** Medium. **Likelihood:** Low (only on Claude outage).
- **Recommendation (REQUIRES USER APPROVAL):** Confirm the OpenAI fallback is an
  approved provider for student-facing output. If yes, document it and ensure
  FOX-1's post-filter covers it. If no, gate it off for `caller:'foxy'`.
  Provider/model changes are user-gated per constitution — flag only, no code
  change proposed here.
- **Est. effort:** S (decision) + S (gating if removed).

---

## FOX-5 — RAG / RLS: COMPLIANT (explicit finding)

- **Evidence:**
  - Retrieval executes inside the `grounded-answer` Deno Edge Function via the
    service-role client (`_sb.ts` / `getSb`) calling RPC `match_rag_chunks_ncert`
    (`retrieval.ts` → `_shared/rag/retrieve.ts`). No client-side vector read
    exists; the only Next.js caller is `grounded-client.ts` (server route).
  - Retrieval is keyed by SCOPE (grade/subject/chapter) only — NOT by a student
    identity join — so there is no cross-student data path: NCERT chunks are
    shared curriculum content, not per-student rows. `scopeDrops` +
    `scope_mismatch` abstain (`pipeline.ts:863-865`) catch wrong-scope RPC rows.
  - `/api/foxy` reads student/cognitive rows via `supabaseAdmin` server-side
    only (P8 boundary respected; admin client never reaches the client).
- **Status:** **COMPLIANT (P8).** No gap. Documented for completeness.

---

## FOX-6 — PII watch item: studentName is fetched into the request scope

- **Title:** `studentName` is read into the route even though it must never
  reach Claude.
- **Evidence:** `route.ts:658` `studentName = studentRow.name`; comment
  (`:629-635`) states it exists ONLY to scrub the name out of cached synthesis
  text before injection (`foxy-long-memory.ts`). Prompt builders
  (`prompt-sections.ts`) do not inject the name. Confirmed no Claude-bound
  template var carries it.
- **Business impact:** Low — currently compliant. Risk is a FUTURE edit
  accidentally threading `studentName` into a prompt var.
- **Severity:** Low. **Likelihood:** Low.
- **Recommendation (AUTO-FIX-SAFE):** Add a unit/contract test asserting the
  composed Claude system prompt + user message never contains the student's
  name/email/phone (a P13 prompt-assembly guard test). Pure test addition.
- **Est. effort:** S.

---

## FOX-7 — `applyFoxyWordCap` is a disabled no-op

- **Title:** The Foxy answer length cap is stubbed off.
- **Evidence:** `index.ts:33-43` — `FOXY_WORD_SOFT_CAP = 180` but
  `applyFoxyWordCap` returns `{truncated:false}` unconditionally (TODO pending
  MoL grading confirmation).
- **Business impact:** Verbose answers possible; cost/latency, not safety.
- **Severity:** Low. **Likelihood:** Medium.
- **Recommendation:** Track as intentional TODO; no action needed for P12.
- **Est. effort:** n/a (informational).

---

## FOX-8 — Abstain/error paths are clean (explicit positive finding)

- Hard-abstain returns `response:''` with `groundingStatus:'hard-abstain'`
  (`route.ts:1812-1822`) — never a raw error string to the student.
- Top-level catch returns a bilingual 503 (`route.ts:392-397`); pipeline panics
  return a structured abstain (`index.ts:457-476`). No stack trace reaches the
  student. **COMPLIANT (P12 "no unfiltered output" on error paths).**

---

## Severity roll-up

| ID | Severity | Likelihood | P-invariant | Fix class |
|----|----------|-----------|-------------|-----------|
| FOX-1 | High | Low | P12 | AUTO-FIX-SAFE |
| FOX-4 | Medium | Low | P12 / provider | REQUIRES USER APPROVAL |
| FOX-2 | Medium | Low-Med | P12 | AUTO-FIX-SAFE |
| FOX-3 | Low | High | P12/UX | assessment review |
| FOX-6 | Low | Low | P13 | AUTO-FIX-SAFE (test) |
| FOX-7 | Low | Med | cost | informational |
| FOX-5 | — | — | P8 | COMPLIANT |
| FOX-8 | — | — | P12 | COMPLIANT |
