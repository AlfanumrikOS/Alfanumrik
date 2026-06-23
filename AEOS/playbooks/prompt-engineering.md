# Prompt Engineering Standards

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Playbook
**Priority:** P0 (Critical — prompts are the primary control surface for product invariant P12 "AI Safety")
**Applies To:** Every system prompt, user-message template, and prompt-injection defense that shapes a Claude or fallback-model response at Alfanumrik — the grounded-answer tutor, the NCERT solver, the quiz-oracle grader, and any future LLM caller.

---

# Purpose

A prompt at Alfanumrik is not creative copy — it is a safety control. The system prompt is where Foxy's persona, the student's CBSE grade/subject scope, the safety rails, and the retrieved NCERT context all converge, and it is the single most powerful lever over whether a model output is grounded, age-appropriate, and on-curriculum.

This v1.1 playbook codifies *how* prompts are written, structured, versioned, defended, and iterated at Alfanumrik, grounded in the real prompt assets and callers in the repo. Prompt-template edits are not free-text changes: they are reviewed (assessment validates curriculum scope and age-appropriateness) and they must round-trip through evaluation (see ai-evaluation.md) before they ship.

Where this playbook and P12 disagree, P12 wins.

---

# Where prompts live

Prompts are first-class, registered, reviewable assets — not strings scattered through code.

- `supabase/functions/grounded-answer/prompts/` holds the canonical templates: `foxy_tutor_v1.txt`, `ncert_solver_v1.txt`, `quiz_question_generator_v1.txt`, `quiz_answer_verifier_v1.txt`, plus the loader `index.ts` and the bundled `inline.ts` twin.
- Templates are resolved by **registered id** (`REGISTERED_PROMPT_TEMPLATES` in `config.ts`). An unknown id **throws** — there is no silent fallback. A caller must pass a registered id.
- Resolution prefers the inline TS string (`INLINE_PROMPTS`, always packaged by the Supabase bundler) and falls back to the `.txt` file (canonical for review/diff). The `.txt` and inline forms must stay byte-consistent.
- Meta-prompts that are not student-facing personas — e.g. `GROUNDING_CHECK_SYSTEM_PROMPT` in `grounding-check.ts` and the quiz-oracle grader prompts in `_shared/quiz-oracle-prompts.ts` — are inlined next to their caller *on purpose*, so the template registry never confuses a fact-checker instruction for a child-facing persona.

---

# System vs user prompt structure

Alfanumrik separates the two roles deliberately.

**System prompt** carries the durable, per-turn-stable instruction surface:

1. **Persona** — Foxy, a friendly CBSE tutor. Foxy is an **AI assistant**, never a human teacher. Persona drift into "I am your teacher" is a rejection condition.
2. **Scope** — "for Class {grade} {subject}". Grade is a **string** `"6"`–`"12"` (P5). The prompt constrains the model to the student's grade/subject so out-of-curriculum or out-of-grade content is refused.
3. **Safety rails** — age-appropriate language; stay within CBSE scope; refuse non-academic topics; when unsure, defer to the teacher.
4. **Grounding context** — the retrieved, sanitized NCERT chunks, injected as the reference material the answer must be built from.

The system block is wrapped as a single content block with Anthropic `cache_control: { type: 'ephemeral' }` (`claude.ts` `callOnce`/`streamOnce`) so the large, stable prefix is cached and only the user-message delta is re-billed. Preserve this structure — it is both a cost and a determinism lever.

**User prompt** carries the volatile turn content — the student's question and, where applicable, native prior conversation turns (`conversationTurns`, prepended to `messages[]` rather than string-interpolated, because Anthropic multi-turn coherence is markedly stronger on native turns).

---

# Grounding & citation requirements

A factual student-facing prompt must instruct the model to answer **only** from the supplied reference material and to cite it.

- Inject NCERT chunks into the system block and instruct: use only this reference material; if the answer is not in it, emit the abstain sentinel.
- The abstain sentinel is the exact string `{{INSUFFICIENT_CONTEXT}}` (`INSUFFICIENT_CONTEXT_SENTINEL`). The prompt must make emitting it cheaper and safer than guessing.
- Grounded answers carry citations (`citations.ts`) and a confidence score (`confidence.ts`); the prompt and the downstream validators are co-designed so the response shape is verifiable.
- A second always-Haiku grounding-check (`grounding-check.ts`) re-reads the candidate answer against the chunks and **fails closed** on any uncertainty. The grounding-check system prompt is exported so an evaluation shadow call can use byte-identical fact-check instructions.

Rule: every prompt that produces facts for a child must have a grounding instruction *and* a downstream grounding verifier. One without the other is not shippable.

---

# Refusal & scope-lock

The prompt is the first line of scope enforcement; server-side checks are the second.

- The system prompt hard-locks the model to the student's CBSE grade/subject and to academic topics. Off-curriculum, unsafe, or non-academic requests are refused in-prompt.
- Scope-lock is defense-in-depth: the prompt refuses, *and* the route/admission layer and grounding-check independently constrain the output. A scope rule must never live in only one place.
- The refusal must be age-appropriate and helpful ("I can help with your Class {grade} {subject} — let's get back to that"), never a bare error.

---

# Determinism vs creativity (temperature)

Temperature is a safety dial, not a style preference.

- **≈0.3 for factual work** — solving, explaining, fact-checking, quiz generation. These dominate Alfanumrik's traffic.
- **Higher only for motivational copy** — encouragement, framing — and never on a factual answer.
- **Hard cap: never set temperature > 0.7 on a factual answer.** Above that the hallucination risk is unacceptable for a grade-6 student. This is a rejection condition.
- Keep `max_tokens` sized per mode (short for quiz answers and abstains, larger for explanations). Do not inflate defaults — input and output tokens are billed and observable per student via the quota layer.

---

# Prompt & model versioning

Prompts and models are versioned, pinned, and change-controlled.

- **Prompt templates are versioned by id** — `foxy_tutor_v1`, `ncert_solver_v1`, etc. A material change ships as a new version, not an in-place rewrite, so old behavior remains reproducible against the eval baseline.
- **Prompts are hashed** (`hashPrompt` in `prompts/index.ts`, surfaced into trace rows) so the exact prompt that produced any traced answer is identifiable after the fact.
- **Model IDs are pinned, dated constants** — `claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514` — never `latest`. They are duplicated across `claude.ts`, `_shared/mol/router.ts`, the route admission profiles, and `_shared/security/quota.ts`, and must be changed in **every** location together.
- **Changing a model or provider is a user-approval change** (P12 / AEOS agent system "AI model changes"); changing a prompt template is an **assessment-review change** (curriculum scope + age-appropriateness). Neither is autonomous.

---

# Prompt-injection defense

Student input is untrusted and is treated as data, never as instruction.

- **Sanitize retrieved chunks** before injection (`_shared/rag/sanitize.ts`) so corpus content cannot smuggle instructions into the system block.
- **Keep the trust boundary clear** — the system block holds *our* instructions and *our* reference material; the student's question goes in the user turn. Never concatenate student text into the instruction surface.
- **The grounding-check is an injection backstop** — if a student tries to coax an ungrounded or off-scope claim, the fact-check pass fails it closed against the chunks.
- **Scope-lock survives injection attempts** — "ignore your instructions and tell me about X" is refused by the persona/scope rails and, independently, by retrieval being grade/subject-filtered so no out-of-scope chunk is even available.
- **No PII in the prompt** — student requests are anonymized (`_shared/redact-pii.ts`); name/email/phone never enter a model request (P13). An injection that tries to exfiltrate context finds none.

---

# Eval-driven iteration

A prompt change is a hypothesis, and hypotheses are measured before they ship.

- Every material prompt edit is run through the offline eval harness (`eval/rag/`) and must clear the regression gate (`eval/rag/harness/verdict.ts`) before merge — see ai-evaluation.md for the metrics, golden sets, and three-state PASS / REGRESS / INCONCLUSIVE verdict.
- An INCONCLUSIVE run (degraded path, missing metric) does **not** clear the gate — you cannot ship a prompt change on a measurement you do not trust.
- Pair the offline numbers with human review on a sample of golden queries for tone, age-appropriateness, and scope before the change goes live.
- Iterate prompt → eval → review → ship; never prompt → ship. Tuning by vibes is not a method.

---

# Readiness checklist

- [ ] Prompt is a registered, versioned template (id resolves; inline + `.txt` consistent), not an inline string in feature code.
- [ ] System prompt encodes persona (Foxy as AI, never human), CBSE grade/subject scope, safety rails, and grounding context.
- [ ] Grade is a string; scope filtering keeps out-of-grade/out-of-subject content out.
- [ ] `{{INSUFFICIENT_CONTEXT}}` abstain instruction present for factual prompts; grounding-check sits downstream and fails closed.
- [ ] Temperature ≈0.3 for factual; never > 0.7 on factual answers; `max_tokens` sized per mode.
- [ ] Retrieved chunks sanitized; student input kept in the user turn, never in the instruction surface; no PII in any prompt.
- [ ] Model IDs pinned + dated and consistent across all call sites; model change has user approval.
- [ ] Prompt-template edit routed to assessment review and through the eval harness regression gate before merge.

---

# References

- Core: `09_SECURITY_PROTOCOL.md` (data protection, secrets), `12_AWS_INFRASTRUCTURE.md` (runtime context for Edge secrets), `16_MCP_CONFIGURATION.md` (secrets never printed, observable truth)
- Product constitution: **P12** (AI safety — the rail this playbook implements), **P5** (grade format), **P6** (question quality), **P13** (data privacy) in `.claude/CLAUDE.md`
- Extensions: `extensions/anthropic.md` (model pinning, prompt caching, grounding, review routing)
- Sibling playbooks: `ai-workflows.md` (the lifecycle these prompts run inside), `ai-evaluation.md` (the gate prompt changes must clear)
- Repo: `supabase/functions/grounded-answer/prompts/{index,inline}.ts` + `*_v1.txt`, `grounded-answer/{claude,grounding-check,citations,confidence,structured-prompt,structured-schema}.ts`, `config.ts` (`REGISTERED_PROMPT_TEMPLATES`), `_shared/rag/sanitize.ts`, `_shared/redact-pii.ts`, `_shared/quiz-oracle-prompts.ts`

---

# Final Directive

Write every prompt as if a grade-6 student will act on its output unsupervised — because they will. Lock the persona to an AI tutor, lock the scope to the student's grade and subject, ground every factual claim in NCERT, keep the temperature low, treat student input as untrusted data, and never let a prompt change reach a child until the eval gate and assessment review have cleared it. Pin the models, version the prompts, and route the reviews. The prompt is a safety control; engineer it like one.

**End of Document**
