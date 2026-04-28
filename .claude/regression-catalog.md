# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

## Subject Governance (Phase H — 2026-04-15)

Source: `docs/superpowers/specs/2026-04-15-subject-governance-design.md` §11.3

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| SG-1 | `class_6_free_plan_no_senior_subjects` | Grade 6 free-plan student never sees Physics/Chemistry/Biology/Accountancy in API, hook, picker, or PATCH preferences | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-2 | `api_never_returns_global_subject_list` | `GET /api/student/subjects` returns a strict subset of the canonical 17 for every student profile | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-3 | `grade_11_commerce_excludes_physics` | Grade 11 commerce stream RPC + validator excludes physics/chemistry/biology | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-4 | `grade_11_science_excludes_accountancy` | Grade 11 science stream RPC + validator excludes accountancy/business_studies | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-5 | `plan_downgrade_clamps_selected_subjects` | Downgrading pro → starter surfaces previously-allowed subjects as `is_locked=true` and `validateSubjectWrite` rejects with reason='plan' | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-6 | `admin_delete_flags_without_deleting_enrollments` | Admin DELETE on `plan_subject_access` flags affected students in the violations report; `student_subject_enrollment` rows are preserved until ops repair | `src/__tests__/regression-subject-leak.test.tsx` | E |

### E2E coverage

Playwright spec `e2e/subject-governance.spec.ts` — three scenarios from §11.5:

- Grade 11 science onboarding: stream capture → subject picker excludes accountancy → dashboard shows only stream-valid subjects.
- Legacy user with invalid enrollment: ReselectBanner visible → reselect → no invalid subjects surface.
- Plan downgrade: post-refresh dashboard has no unlocked physics/chemistry/biology chips.

### Invariants covered by this section

- P5 (grade format — strings)
- P8 (RLS boundary — governance service on server)
- P9 (RBAC enforcement — 422 on write, 200 on read-only allowed intersection)

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

## Critical-Path E2E (Audit F9 — 2026-04-27)

Source: production-readiness audit finding F9 — the highest-blast-radius
user flows (quiz happy path, payment funnel) had ZERO Playwright coverage
and the existing `e2e` CI job is `continue-on-error: true`, so even the
specs that did exist couldn't block PRs. The new `e2e-critical-paths` job
runs ONLY these two specs and IS BLOCKING.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-45 | `quiz_happy_path_p1_p2_p3` | Browser-level enforcement of P1 (score = round((correct/total)*100), surfaced from server response, never recomputed in QuizResults), P2 (XP from server response; daily-cap clamp surfaces bilingual "cap reached" copy when `xp_capped: true`), and P3 (all-same-answer flag, speed-hack flag, response-count mismatch — server zeroes XP / rejects). | `e2e/quiz-happy-path.spec.ts` | P (5 tests; 5 fixme until test-user fixture wired in CI — see TODO at bottom of spec) |
| REG-46 | `payment_checkout_p11` | Browser-level enforcement of P11 — happy path (Razorpay → /api/payments/verify → subscription active), signature mismatch returns 400 with no subscription change, atomic-activation kill switch returns 503 with retry copy (no false success), `payment_success` analytics event fires with `amount_inr`/`currency` and NO raw email/phone (P13). Idempotency for duplicate webhook events is unit-only (server-side) and is registered as fixme in the spec to keep the catalog visible at the E2E layer. | `e2e/payment-checkout.spec.ts` | P (5 tests; 4 fixme until test-user fixture wired, 1 fixme by design — webhook idempotency is server-only) |

### Invariants covered by this section

- P1 (score accuracy) — REG-45
- P2 (XP economy + daily cap) — REG-45
- P3 (anti-cheat 3 rules) — REG-45
- P11 (payment integrity — signature, atomicity, no plan access without
  verified payment) — REG-46
- P13 (data privacy — analytics payload contains no raw PII) — REG-46

### Notes on test strategy

Both specs use `test.fixme(true, '<reason>')` for branches that require a
real authenticated student session (the staging Supabase project does not
yet seed `TEST_STUDENT_EMAIL` / `TEST_STUDENT_PASSWORD` for CI). The spec
FILES still parse and the catalog entries are visible — when the fixture
is wired in CI, the fixmes flip off and the suite runs end-to-end. Until
then, the unit-level coverage referenced in each fixme reason is the
authoritative defense for that branch. See `e2e/helpers/auth.ts` for the
mocked-session and real-login helpers, and the TODO blocks at the bottom
of each spec for fixture wiring requirements.

CI job: `e2e-critical-paths` in `.github/workflows/ci.yml` — BLOCKING
(no `continue-on-error`), runs only on PRs targeting main/master/staging
from the same repo. The legacy `e2e` job remains advisory.

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