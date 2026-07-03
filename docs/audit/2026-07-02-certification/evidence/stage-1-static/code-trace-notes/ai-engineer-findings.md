# AI Engineer — Stage 1 Static Findings (Production Certification, 2026-07-02)

Agent: ai-engineer. Scope: Foxy tutor, ncert-solver, quiz-generator, cme-engine,
grounded-answer, alfabot-answer/alfabot-send-inquiry, RAG pipeline, vector
embeddings, bulk content-gen functions, ncert-question-engine,
verify-question-bank, nep-compliance. Read-only, no code changed.

`docs/audit/2026-07-02-discovery/04-ai-workflows.md` was read and used as a
map of where to look, but every claim cited below was independently
re-verified against the current source at the file:line level. Where I
disagree with or add nuance to the discovery doc, it is called out explicitly.

---

## Task 1 — AI Edge Function inventory

See `docs/audit/2026-07-02-certification/evidence/inventory/edge-functions-ai.csv`
for the full table (20 surfaces: Foxy Next.js route + 19 Edge Functions).

Headline structural finding: every function in scope has SOME auth check
before doing meaningful work. Three auth patterns exist:

1. **Direct-JWT** (`ncert-solver`, `quiz-generator`, `cme-engine`,
   `nep-compliance`, `bulk-jee-neet-curated-import`) — `Authorization: Bearer`
   header, `supabase.auth.getUser(token)`, sometimes cross-checked against
   `students`/`admin_users` tables.
2. **Platform Security Layer / `admitAiRoute`** (`bulk-question-gen`,
   `bulk-non-mcq-gen`, `bulk-jee-neet-import`, `ncert-solver`, `alfabot-answer`) —
   `_shared/security/ai-admission.ts::admitAiRoute` →
   `_shared/security/auth.ts::resolveSecurityPrincipal`, which accepts EITHER
   a student/parent/teacher/school_admin Supabase JWT OR an HMAC-signed
   `internal_service` caller (service-role bearer + `x-internal-timestamp` +
   `x-internal-signature`, verified against a registered-caller RPC
   `security_resolve_internal_caller` and a 5-minute clock-skew window). This
   layer also does quota reservation/settlement and circuit-outcome recording
   in the same call, so "auth" and "cost governance" are unified.
3. **`x-admin-key`** (`embed-diagrams`, `embed-ncert-qa`, `embed-questions`,
   `generate-embeddings`, `generate-concepts`, `generate-answers`,
   `extract-diagrams`, `extract-ncert-questions`) — a static shared secret
   compared server-side.
4. **`x-cron-secret` / internal-cron** (`verify-question-bank`,
   `monthly-synthesis-builder`, `coverage-audit`) —
   `_shared/security/internal-cron-auth.ts::verifyInternalCronRequest`.

**Important nuance the discovery doc understates**: functions gated by
`admitAiRoute` with `callerTypes: ['internal_service']` (`bulk-question-gen`,
`bulk-non-mcq-gen`) are **not directly reachable by an admin's own browser
JWT** — the header comments in those files ("Requires a valid Supabase user
JWT whose auth_user_id is present in admin_users...") are **stale**. The
actual live path is: browser → `src/app/api/super-admin/ai/[fn]/route.ts`
(`authorizeAdmin(request, 'super_admin')`, session-based) → that Next.js
route signs the request with `buildInternalCallerHeaders()` and forwards it
server-to-server with the Supabase service-role key + HMAC signature → the
Edge Function's `admitAiRoute` verifies the signature and admits it as
`internal_service`. This is a two-layer server-side auth chain, arguably
**stronger** than a bare JWT check, but the in-file doc comments describing
a direct-JWT admin check are inaccurate and should be corrected (flagged to
architect/quality as a doc-drift item, not a security defect).
`generate-embeddings` is the one `x-admin-key` function **not** in that
proxy's `ALLOWED_FUNCTIONS` allow-list (`route.ts:19-30`) — no Next.js route
calls it at all; it is only invocable by a caller holding the raw
`ADMIN_API_KEY` secret directly (CLI/ops-only posture). Not a defect, but
worth noting for completeness.

`nep-compliance` and `bulk-jee-neet-curated-import` are in the assigned
scope but are **not actually LLM-backed** — confirmed by grep for
`ANTHROPIC_API_KEY`/`claude`/`openai` returning zero hits in both files.
`nep-compliance` is a pure mastery→NEP-competency mapper; the curated JEE/NEET
importer explicitly states "P12 — does NOT apply (curated path; no Claude
calls)" in its own header (`bulk-jee-neet-curated-import/index.ts:39`).
`alfabot-send-inquiry` is the lead-capture form persistence endpoint, also
not LLM-backed. Included in the CSV for completeness per the assigned scope.

---

## Task 2 — AI Certification

### Prompt quality / safety policies — HIGH confidence, Should-Fix-Before-Release: none found

Read the live system-prompt sources directly (not just referenced them):

- `src/lib/foxy/prompt-sections.ts:683-718` (`FOXY_SAFETY_RAILS`, injected on
  every Foxy call regardless of mode/template):
  > "1. Scope: Only teach from CBSE NCERT material for the student's grade
  > and subject... 2. Age appropriateness: Students are in grades 6-12. Use
  > language they understand. Avoid adult topics, violence, or anything
  > unsuitable for minors... 4. Honesty: ... Do not fabricate facts... 7.
  > RAG-only refusal: When the retrieved chunks don't contain the answer,
  > refuse explicitly rather than hallucinate."
  This file carries an explicit governance comment at lines 9-12: "DO NOT
  weaken the safety rails... without an assessment-agent review."
- `supabase/functions/grounded-answer/prompts/foxy_tutor_teach_v1.txt:1-3`
  explicitly states "You are Foxy, an AI study coach for Indian CBSE
  students" and scopes to "Grade {{grade}} student studying {{subject}}"
  with Bloom's-progression instructions baked into the pedagogy decision
  tree (lines 44-48: "Remember→Understand, Understand→Apply,
  Apply→Analyze...").
- `supabase/functions/alfabot-answer/prompt.ts:250-254` — the AlfaBot system
  prompt's rule 5 explicitly lists the 4 hard-refusal categories
  (math/homework, medical/legal/mental-health, other-students'-data,
  politics/religion/news) as prompt-level instructions, backstopped by a
  deterministic pre-model regex check (see worklist item 3 below).

All three prompt sources explicitly instruct age-appropriateness and
CBSE-scope-lock, and explicitly instruct AGAINST off-topic/unsafe content
and against fabrication. Verdict: **PASS**, HIGH confidence.

### Hallucination resistance / grounding quality / NCERT correctness — HIGH confidence

RAG grounding chain traced end-to-end in `supabase/functions/grounded-answer/`:
`retrieval.ts:74` calls `_shared/rag/retrieve.ts::retrieve()` once
(Voyage `voyage-3` embed → `match_rag_chunks_ncert` RPC, RRF hybrid
vector+FTS, k=60 → Voyage `rerank-2` → MMR diversity 0.7). Retrieved chunks
are injected into the system prompt as citations. `abstain.ts` implements a
structured `grounded:false` abstain path (7 distinct abstain reasons per the
`AbstainReason` type) used when chunks are insufficient — the model is
instructed not to answer without grounding rather than to guess.

**Validation oracle before `question_bank` insert — independently traced,
not merely confirmed to exist:**
- `bulk-question-gen/index.ts` — the deterministic P6-shape check
  (`isValidQuestion`) runs unconditionally on every candidate on the legacy
  path (lines 1330-1344). The LLM-grader semantic oracle
  (`validateWithCacheAndLogging` → `callOracleGrader`, temperature=0,
  bypasses the MoL router intentionally per the code comment at lines
  482-496 because MoL doesn't yet support forcing temperature=0) is gated by
  `ff_quiz_oracle_enabled`. I checked whether this flag is actually ON in
  production rather than trusting the constitution's REG-54 claim at face
  value: migration `supabase/migrations/20260504100000_enable_quiz_oracle_in_prod.sql`
  flips it TRUE with an idempotent UPSERT + a `DO $verify$` block that
  `RAISE WARNING`s if it lands FALSE. No later migration in
  `supabase/migrations/*.sql` sets it back to false (grep confirmed only one
  file references the flag name). **On the grounded two-pass path**
  (`ff_grounded_ai_quiz_generator`), the oracle gate is applied a second,
  independent time (lines 1122-1224) with its own retry-once-then-drop logic
  before the `question_bank.insert()` call at line 1251-1253. The oracle
  literally sits between candidate generation and the `INSERT` statement in
  the control flow — it is not a dead/unused module. **Verdict: CONFIRMED,
  currently live in prod.**
- `quiz-generator/index.ts:1337-1365` — at SERVE time (not insert time), the
  deterministic half of the same oracle module
  (`_shared/quiz-oracle.ts::runDeterministicChecks`) is re-run as a
  defense-in-depth pass on every question about to be shipped to a student
  (4-distinct-non-empty-options check, correct_answer_index 0-3 check,
  non-empty explanation check — read directly at
  `_shared/quiz-oracle.ts:158-198`). Rows that fail are dropped and, if too
  many are dropped, the endpoint returns HTTP 422 rather than serving a
  short/malformed quiz (lines 1373-1413). This is genuinely a second,
  independent gate, not the same check re-labeled.
- **Cross-check that non-oracle-gated content can't leak to students via a
  side door**: `bulk-non-mcq-gen` inserts short/long-answer rows with
  `verification_state: 'pending'` AND `is_active: true`
  (`bulk-non-mcq-gen/index.ts:520-556`) — i.e. NOT filtered out by
  `is_active`. I checked whether `quiz-generator`'s SELECT query filters on
  `verification_state` (it does not — `.select('*').eq('is_active', true)`
  only, `quiz-generator/index.ts:487-492`). This looked like a possible gap
  until I traced the serve-time `runDeterministicChecks` pass: a
  `bulk-non-mcq-gen` row has `options: []` and `correct_answer_index: null`,
  which fails the "exactly 4 options" check at
  `_shared/quiz-oracle.ts:170-175` and is dropped before it reaches the
  wire. **Confirmed by code trace, not by trusting the file's own header
  comment.**

Verdict: **PASS**, HIGH confidence — the oracle genuinely gates inserts and
re-gates serves.

### Bloom taxonomy alignment — HIGH confidence

- `bulk-question-gen/index.ts:96` — `VALID_BLOOM_LEVELS = ['remember',
  'understand','apply','analyze','evaluate','create']`, enforced at
  insertion (`isValidQuestion`, line 258-259: rejects any candidate whose
  `bloom_level` isn't in this list).
- `quiz-generator/index.ts` — Bloom level is used for ZPD-style targeting at
  serve time: `masteryToMaxBloomLevel(masteryEstimate)` computes a
  `bloomCeiling` (line 836), `getBloomLevelsUpTo(bloomCeiling)` produces
  `allowedBlooms`, and the question SELECT is filtered `.in('bloom_level',
  allowedBlooms)` (lines 502, 519, 874). The served quiz's
  `bloomDistribution` is computed and returned in the response metadata
  (lines 1322-1326).

Verdict: **PASS**, HIGH confidence — Bloom is validated at write time and
actively used to drive question selection at read time.

### Response latency — NOT VERIFIED (instrumentation exists, no live numbers available in Stage 1)

Latency IS instrumented: `latency_ms` is computed
(`Date.now() - started`/`startTime`) and written into
`grounded_ai_traces`/security-audit rows at multiple points in
`grounded-answer/index.ts` (lines 391, 449, 466, 561, 578) and
`grounding-check.ts` (lines 116, 149, 166). A super-admin dashboard route
(`src/app/api/super-admin/grounding/health/route.ts:73-120`) computes
p50/p95/p99 over the last hour from `grounded_ai_traces.latency_ms`. Per-plan
timeout **budgets** (not observed latency) are configured:
`grounding-config.ts`/`grounded-answer/config.ts::PER_PLAN_TIMEOUT_MS` = free
20s, starter 35s, pro 55s, unlimited 75s (also read directly in
`src/app/api/foxy/route.ts:1612,1681`).

I have no live database or dashboard access in this Stage-1 static-only pass,
so I cannot read the actual observed p50/p95/p99 values or confirm they are
within acceptable bounds. **NOT VERIFIED — mechanism confirmed present;
actual numbers require Stage 2/3 (live DB pull or a call to
`/api/super-admin/grounding/health`).** Do not treat the timeout budgets
above as latency evidence — they are ceilings, not measurements.

### Embedding freshness — MEDIUM confidence

`_shared/embeddings.ts:50` — `EMBEDDING_VERSION = '2026-04-04'` (comment:
"Update when model changes"), unchanged since. No scheduled cron trigger
found for any of `embed-diagrams`, `embed-ncert-qa`, `embed-questions`,
`generate-embeddings` — grep across `vercel.json` and
`.github/workflows/*.yml` for these function names returned zero matches.
These are exclusively manually-triggered admin batch jobs (via
`/api/super-admin/ai/[fn]` for three of the four, and CLI-only for
`generate-embeddings`). `coverage-audit` runs nightly
(`supabase functions schedule coverage-audit --cron "30 21 * * *"`,
`coverage-audit/index.ts:4`) but that function only **audits** RAG coverage
ratios and auto-disables enforced grade/subject pairs when
`verified_ratio < 0.85` (lines 13-14, 175-193) — it does not itself
regenerate embeddings. **Finding: embeddings are last regenerated on a
one-off/manual cadence (last version stamp 2026-04-04, ~3 months stale as of
this audit's date 2026-07-02), not on a recurring schedule.** This is not
necessarily a defect (NCERT curriculum content doesn't change often
mid-year), but it means embedding freshness depends on an ops team
remembering to re-run the batch job after any content update, with no
automated staleness alarm found (`coverage-audit` alarms on retrieval
coverage regressions, not on embedding-model staleness specifically).

### Retrieval quality (eval harness) — DEFERRED TO STAGE 2

Read `eval/rag/harness/cli.ts` in full before deciding whether to run it, per
instructions. **This harness is NOT offline/cached-baseline-only.** Evidence:
- `cli.ts:143-222` (`buildDeps`) constructs a **live Supabase client**
  (`createClient(creds.url, creds.serviceKey)`) from
  `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
  and dynamic-imports the REAL `retrieve()` function
  (`supabase/functions/_shared/rag/retrieve.ts`), which issues a live RPC
  call (`match_rag_chunks_ncert`) against whatever Supabase project the
  configured URL points to.
- `readCreds()` (lines 98-106) causes a clean `EXIT_CONFIG_ERROR` (exit 2,
  "INCONCLUSIVE (no run)") **only** when creds are absent — i.e. the tool's
  entire design assumes a live DB is the normal case, not an opt-in.
- The `ncert-baseline-v1.json` file referenced is a **comparison target**
  (expected metric bands) that the tool's live measurement is checked
  against — it is not something the tool replays queries against offline;
  the retrieval itself always hits the live pipeline.
- Additionally, `VOYAGE_API_KEY` (optional — degrades to FTS-only,
  INCONCLUSIVE verdict) and `ANTHROPIC_API_KEY` (optional — skips
  groundedness scoring if absent) are live third-party API calls when
  present (`groundingCheck` at lines 193-210 calls the real
  `runGroundingCheck`, which per its own import chain calls the Anthropic
  API).

Per the task instructions ("If it requires live API calls or a live DB, do
NOT run it — mark DEFERRED TO STAGE 2"), **I did not run `npm run
eval:rag:harness`.** This is unambiguously a live-DB-dependent tool
regardless of whether third-party API keys happen to be configured in this
environment — the Supabase live-DB requirement alone disqualifies it for
Stage 1. **Recommend Stage 2 (local integration, live/staging DB available)
run this and capture the report artifact.**

Separately, a second, non-identical eval system exists
(`eval/rag/{runner.ts,scoring.ts}`, `npm run eval:rag`/`eval:rag:check`) that
posts curated gold queries to the **live** `grounded-answer` Edge Function —
this is even more clearly a live-service dependency and was also not run.
It is wired into `.github/workflows/rag-eval.yml` as an advisory
(`continue-on-error: true`) nightly + PR-triggered job, not something Stage 1
should invoke ad hoc. Gold set is documented as only ~30 queries (a "Known
gap" per the discovery doc, not independently re-counted here).

### Token usage / cost tracking — HIGH confidence, present

`_shared/security/ai-admission.ts` implements a full estimate→reserve→settle
cost-accounting lifecycle: `computeEstimatedCost` / `reserveQuota` (dry-run
capable) at admission time (lines 100-122), and `settleQuota` with
actual token counts at `finalizeAiRoute` (lines 163-173). Every admitted AI
route call writes a `writeSecurityAudit` row carrying
`estimatedInputTokens/estimatedOutputTokens/estimatedCost` and
`actualInputTokens/actualOutputTokens/actualCost` (lines 139-162). This is a
genuine per-call cost-tracking mechanism, not just a rate limiter. I did not
verify the actual dollar totals (would require live DB access — Stage 2/3).

### Fallback behaviour on Claude API failure — HIGH confidence, graceful

Traced the failure path directly: `grounded-answer/pipeline.ts` — when the
circuit is open for a `(caller, subject, grade)` key, it short-circuits to
`finalizeAbstain(sb, ctx, 'circuit_open')` (line 732) rather than
propagating an error. `abstain.ts::buildAbstainResponse` returns a
well-formed `{grounded:false, abstain_reason, suggested_alternatives,
trace_id}` payload (never a raw 5xx/stack trace to the student). On the
Foxy side, `_lib/constants.ts::REFUND_ABSTAIN_REASONS` includes
`'upstream_error'` and `'circuit_open'` — the student's daily-quota
consumption is refunded (`refundQuota`) for these reasons
(`route.ts:1782-1826`, `_lib/streaming.ts:466`), so a Claude outage does not
both fail the student's turn AND burn their quota. This satisfies the
circuit-breaker requirement (P12 rule 5) and goes further (quota refund on
failure). **Verdict: PASS, HIGH confidence — no hard error path to the
student found.**

### Prompt injection resistance — HIGH confidence, explicit defense found

`src/lib/ai/validation/input-guard.ts::neutralizeInjectionAttempt` (FOX-2,
called at `route.ts:574` before prompt assembly) is a deliberately
conservative regex neutralizer targeting assistant-directed override
phrases: "ignore/disregard/forget/override ... previous/prior/above ...
instructions/prompt/rules", "reveal/show/print/repeat/output ... system
prompt", "you are now a/an/no longer...", `new instructions:`, and raw
chat-template role tokens (`<<sys>>`, `[INST]`, `<|im_start|>`). It is
explicitly documented as input-side defense-in-depth, not the sole guard —
the file's own header (lines 20-22) says the real backstops are
"server-side grade/subject scope, the structured-output contract,
`FOXY_SAFETY_RAILS`, and the output screen (FOX-1)". I confirmed FOX-1
exists as a separate output-side deterministic screen
(`screenStudentFacingText`/`output-screen.ts`, referenced in Foxy's safety
guard chain) that runs on the model's OUTPUT regardless of whether the input
guard caught anything — i.e. a genuinely layered (input + output) defense,
not a single point of failure. Verdict: **PASS**, HIGH confidence.

### Daily usage limits per plan — HIGH confidence, confirmed gating a Tier-0 route

`src/app/api/foxy/_lib/quota.ts::checkAndIncrementQuota` calls the
`check_and_record_usage` RPC (matches the constitution's claimed mechanism
exactly — grep-confirmed, `quota.ts:30`). Confirmed the call site ordering
in `route.ts`: `checkAndIncrementQuota` executes at line 762, strictly
before the LLM call `callGroundedAnswer` at line 1729 — i.e. quota is
checked and consumed BEFORE any Claude spend, not after. `DAILY_QUOTA`
(`_lib/constants.ts:64`) = `{free: 10, starter: 30, pro: 100, unlimited:
999999}`. **Doc-drift note (also independently reproduced, matches
discovery doc):** the `ai-integration` skill doc's table
(`.claude/skills/ai-integration/SKILL.md`) still says "Per plan:
5/30/unlimited" — this is stale versus the live 10/30/100/999999 numbers.
Recommend a doc fix (non-blocking, cosmetic).

---

## Task 3 — AI Tutor journey step, all 7 roles

Traced which roles can actually reach each AI surface via RBAC grants and
per-function role-resolution code (not assumed):

| Role | Foxy chat (`/api/foxy`) | ncert-solver | cme-engine | ncert-question-engine | quiz-generator |
|---|---|---|---|---|---|
| Student | YES — sole grantee of `foxy.chat` (`20260612123200_rbac_matrix_conformance.sql:219-228`, only `student` role listed) | YES — resolves caller via `students.auth_user_id` (`ncert-solver/index.ts:218-220`); non-student JWTs have no matching row → fails | YES — same `students.auth_user_id` resolution pattern (`cme-engine/index.ts:365-371`) | YES — self, via `resolveAuthorizedStudentId` `principal.role==='student'` branch (`index.ts:147-155`) | YES — `Authorization` JWT required; serves the caller's own quiz |
| Parent | **NO** — `foxy.chat` not in the parent grant list (`...sql:232-239`, checked directly — only `child.*`, `profile.*`, `notification.*`, `account.delete`) | **NO** (same reasoning — no student row for a parent's own JWT) | **NO** | **YES, scoped** — parent branch requires an `active`/`approved` `guardian_student_links` row for the requested `student_id` (`index.ts:166-177`) | not traced (out of scope for parent UI) |
| Teacher | **NO** | **NO** | **NO** | **YES, scoped** — teacher branch requires the student to share `school_id` (`index.ts:179-188`) | not traced |
| School Admin | **NO** | **NO** | **NO** | **YES, scoped** — same school_id ownership check as teacher | not traced |
| Super Admin | Not via student-facing RBAC path; reaches admin batch functions (bulk-question-gen etc.) via `authorizeAdmin(request,'super_admin')`, a separate admin-auth surface, not `foxy.chat` | N/A | N/A | Not traced (would go via `internal_service` or admin tooling if it exists) | N/A |
| Internal Service (cron/worker) | N/A (not a human role) | via signed internal caller for the Python-proxy/admin flows only | N/A | YES — `principal.callerType==='internal_service'` bypasses ownership checks entirely (trusted internal caller, `index.ts:160-162`) | N/A |

**Finding**: Foxy chat and `ncert-solver`/`cme-engine` are genuinely
student-only by RBAC design (verified via the actual grant migration, not
assumed) — this matches the product's intent that Foxy is a 1:1 tutoring
surface. `ncert-question-engine` is architecturally different: it
deliberately allows parent/teacher/school_admin to invoke AI-backed answer
evaluation **on a specific student's behalf**, with per-role ownership
checks that reject any `student_id` not actually linked to the caller.
This function is not in either CLAUDE.md's AI Edge Function table — flagged
as a documentation gap (not a security gap; the code itself enforces the
boundary correctly).

---

## Independent re-verification worklist

### 1. `quiz-generator` validation oracle (REG-54) — CONFIRMED, genuinely gates inserts

Covered in detail under Task 2 "Hallucination resistance" above. Summary:
the deterministic P6 check runs unconditionally at insertion
(`bulk-question-gen`) AND is re-run at serve time
(`quiz-generator/index.ts:1351-1365`, `_shared/quiz-oracle.ts:158-198`); the
LLM-grader semantic check is flag-gated (`ff_quiz_oracle_enabled`) and I
independently confirmed via `supabase/migrations/20260504100000_enable_quiz_oracle_in_prod.sql`
that the flag is TRUE in production with no later reverting migration. Both
gates sit literally between candidate generation and the `question_bank`
`.insert()` call in the control flow at every site I traced
(`bulk-question-gen/index.ts:1152-1224` grounded path,
`~1357+` legacy path) — this is not an unused/orphaned module.

### 2. Foxy single-retrieval contract (REG-50) — CONFIRMED, still true in current code

`src/app/api/foxy/route.ts` has exactly ONE call site of `callGroundedAnswer`
(line 1729) in the non-streaming turn handler, with an explicit comment at
line 1728: "Single retrieval: grounded-answer service handles
embed+RRF+rerank." The streaming path (`_lib/streaming.ts`) has exactly one
call site of `callGroundedAnswerStream` (line 103), with the module's own
header (lines 10-11) citing REG-50 by name. Inside `grounded-answer` itself,
`retrieval.ts:74` has the single call site of the shared `retrieve()`
function. Grep across `route.ts` and `_lib/*.ts` confirmed no second/retry
retrieval call site exists anywhere in the Foxy request path. **CONFIRMED —
the single-retrieval contract holds in the current code**, not just as a
historical regression-test pin.

### 3. AlfaBot scope-lock (REG-66) — CONFIRMED, server-side cannot be bypassed by a client

Two independent enforcement layers, both read directly:
- **Prompt-level** (soft): `supabase/functions/alfabot-answer/prompt.ts:250-254`
  — the system prompt instructs the model to canned-refuse the 4 categories.
- **Server-side deterministic** (hard): `supabase/functions/alfabot-answer/shared.ts:97-110`
  (`detectHardRefusal`, regex-matched against `ALFABOT_HARD_REFUSAL_PATTERNS`
  in `prompt.ts:77-105` — 4 category ids: `not_a_tutor`, `off_topic` (2
  pattern entries covering medical/legal/mental-health-redirect and
  politics/religion/news), `other_student_data`; plus a 4th canned reply
  `unknown_info` used by the post-process grounding-failure path, not a
  regex-matched hard refusal). This check runs **first**, inside
  `runTurnNonStream` (`index.ts:133`), and returns immediately with the
  canned reply — **the OpenAI call is never made** when it matches
  (confirmed by reading the full function body: the `callOpenAIChat` call
  is unreachable code after an early `return`).
- **This server-side check cannot be bypassed by a client that skips the
  prompt-side guard**, because: (a) it is server code that executes on
  every request regardless of what the client sends, and (b) the
  `alfabot-answer` Edge Function itself is only reachable via
  `admitAiRoute` requiring `callerTypes: ['internal_service']`
  (`index.ts:70-76`) — a raw browser cannot call it directly at all; it must
  go through whatever Next.js route mints the signed internal-caller headers
  (not traced in this pass — out of ai-engineer's file-ownership scope, but
  the Edge-Function-side boundary itself is confirmed intact regardless of
  which Next.js route forwards to it).
- **One discrepancy versus the "client-prompt-side" framing in REG-66's
  name**: I found a Next.js-side mirror of the same refusal categories at
  `src/lib/ai/prompts/alfabot-system.ts` (lines 101-152), but grep across
  `src/` shows it is **imported only by its own test file**
  (`alfabot-system.test.ts`) — it is not wired into any live route. If
  "client-prompt-side" in REG-66's name was meant to describe this
  Next.js-side module, that module currently appears to be **dead code**,
  not a live enforcement layer — the actual live "prompt-side" enforcement
  is the Deno-side `prompt.ts` (which the Edge Function actually sends to
  OpenAI). This doesn't weaken the security posture (the deterministic
  server-side regex check is authoritative either way and is confirmed
  live), but the doc/code correspondence for "client-prompt-side" is worth
  a follow-up doc correction — flagged to quality, not a defect.

### 4. Pending-decision AI item — ESCALATING, requires explicit CEO ruling

Found in `docs/audit/2026-07-02-validation/10-security-audit.md:138-160`:
**"G-5 DOSSIER: grounded-answer 4-way fallback + OpenAI data exposure (no
verdict, CEO ruling pending)."** Per that dossier's own framing (which I am
not re-litigating, only surfacing per this task's explicit instruction):

- The base decision — "is it acceptable that Foxy falls back from
  Claude to OpenAI (`gpt-4o-mini`/`gpt-4o`) on Anthropic outage?" — **is
  already CEO-approved** per a first-party planning doc
  (`docs/superpowers/plans/2026-05-18-model-orchestration-layer.md:3609-3643`,
  rule #11: "OpenAI added per explicit CEO request"), predating the code
  change. This part is resolved, not open.
- **The residual open item requiring a decision is narrower and still
  unresolved**: the free-text student query forwarded to OpenAI on a
  fallback is sanitized only for prompt-injection syntax (FOX-2), **not**
  for incidental PII the student might type into their own question (e.g. a
  student naming their school or teacher in their question text). The
  dossier explicitly recommends "the CEO ruling explicitly cover: (1)
  whether this residual free-text PII exposure is acceptable given OpenAI's
  DPA/data-retention terms for API traffic, and (2) whether the
  shadow-grading flag (`ff_grounded_answer_mol_shadow_v1`, confirmed seeded
  DISABLED, sends every successful turn to OpenAI a second time for offline
  quality grading) should ever be promoted."
- **I am escalating this explicitly, per instruction, rather than treating
  it as resolved-by-omission.** This is a P13/P12-adjacent decision item
  that needs a named decision-maker (CEO or delegate) before any change to
  the current default posture (fallback ON, failure-triggered only; shadow
  flag OFF) — the current STATE is already shipped and is not itself a
  blocker (fallback is failure-triggered only, shadow is OFF by default),
  but the residual PII question has no recorded ruling and should not be
  silently dropped from this certification pass.

---

## Confidence / risk-impact summary

| Item | Confidence | Risk-impact | Notes |
|---|---|---|---|
| Auth on all 20 AI-adjacent surfaces | HIGH | Informational | All have a real auth check; see CSV |
| Prompt safety rails (age-appropriate, CBSE-scope) | HIGH | Informational | Direct prompt-text read, all 3 major prompt sources |
| Quiz-generator oracle gates insert | HIGH | Informational | Confirmed live via migration + control-flow trace |
| Foxy single-retrieval contract (REG-50) | HIGH | Informational | Confirmed live, 1 call site per path |
| AlfaBot server-side scope-lock (REG-66) | HIGH | Informational | Confirmed unbypassable by client |
| AlfaBot "client-prompt-side" doc/code mismatch | MEDIUM | Post-Release-Acceptable | Likely-dead Next.js mirror module; doc-correction only |
| Bloom taxonomy validated + used for selection | HIGH | Informational | Write-time whitelist + read-time ZPD filter |
| Fallback behaviour on Claude failure | HIGH | Informational | Graceful abstain + quota refund, no hard error |
| Prompt injection resistance (FOX-2 + FOX-1) | HIGH | Informational | Layered input+output defense confirmed |
| Daily usage limits gate Tier-0 route | HIGH | Informational | Pre-LLM-call ordering confirmed by line numbers |
| Response latency actual values | NOT VERIFIED | Should-Fix-Before-Release (verify in Stage 2/3) | Instrumentation exists; no live numbers accessible in Stage 1 |
| Embedding freshness | MEDIUM | Post-Release-Acceptable | Manual-only cadence, ~3mo stale stamp, no staleness alarm |
| RAG eval harness (B1, `eval/rag/harness/`) | NOT VERIFIED-DEFERRED | Should-Fix-Before-Release (run in Stage 2) | Requires live Supabase DB; correctly deferred, not run |
| RAG eval (legacy, `eval/rag/{runner.ts}`) | NOT VERIFIED-DEFERRED | Post-Release-Acceptable | Live-service CI gate, advisory-only already; not re-run here |
| Token/cost usage tracking | HIGH | Informational | Full estimate/reserve/settle lifecycle confirmed in code |
| G-5 OpenAI-fallback residual PII question | HIGH (evidence) / OPEN (decision) | **Should-Fix-Before-Release — needs explicit CEO ruling** | Escalated per worklist item 4; base fallback approval already on record, residual PII question is not |
| `ncert-question-engine` missing from CLAUDE.md AI table | HIGH | Informational | Doc-completeness gap, not a security gap |
| `_shared/mol/` relationship to `grounded-answer`'s own routing | LOW (not independently re-traced this pass) | Post-Release-Acceptable | Discovery doc flags this as unresolved (§7.1); I did not independently re-trace it — deferring to that finding rather than duplicating effort outside assigned worklist |

---

## Files read (representative, not exhaustive)

- `src/app/api/foxy/route.ts`, `src/app/api/foxy/_lib/{quota,streaming,constants}.ts`
- `src/lib/foxy/prompt-sections.ts`, `src/lib/ai/validation/input-guard.ts`
- `supabase/functions/grounded-answer/{index,pipeline,abstain,retrieval,circuit,config}.ts`
- `supabase/functions/grounded-answer/prompts/foxy_tutor_teach_v1.txt`
- `supabase/functions/{ncert-solver,quiz-generator,cme-engine}/index.ts`
- `supabase/functions/alfabot-answer/{index,shared,prompt}.ts`,
  `supabase/functions/alfabot-send-inquiry/index.ts`
- `supabase/functions/_shared/security/{ai-admission,auth}.ts`
- `supabase/functions/_shared/quiz-oracle.ts`
- `supabase/functions/bulk-question-gen/index.ts`,
  `supabase/functions/bulk-non-mcq-gen/index.ts`,
  `supabase/functions/bulk-jee-neet-{import,curated-import}/index.ts`
- `supabase/functions/{embed-diagrams,embed-ncert-qa,embed-questions,generate-embeddings,generate-concepts,generate-answers,verify-question-bank,ncert-question-engine,nep-compliance,coverage-audit}/index.ts`
- `src/app/api/super-admin/ai/[fn]/route.ts`,
  `src/app/api/super-admin/grounding/health/route.ts`
- `supabase/migrations/20260504100000_enable_quiz_oracle_in_prod.sql`,
  `supabase/migrations/20260612123200_rbac_matrix_conformance.sql`
- `eval/rag/harness/cli.ts`
- `docs/audit/2026-07-02-validation/10-security-audit.md` (G-5 dossier)
- `docs/audit/2026-07-02-discovery/04-ai-workflows.md` (supporting evidence only)
