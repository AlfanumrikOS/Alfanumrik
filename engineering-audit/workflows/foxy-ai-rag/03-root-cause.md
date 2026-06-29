# Foxy AI Tutor & RAG — ROOT CAUSE ANALYSIS (Cycle 4)

True root cause + introducing layer per significant gap. Only gaps with real
remediation value are analyzed (FOX-3/6/7 are minor and folded in briefly).

---

## FOX-1 — No output blocklist on the primary grounded path

**Surface symptom:** `validateOutput`/`validateContentScope` exist and are
robust, but are reachable only on the `ff_grounded_ai_foxy`-OFF legacy flow.

**Root cause:** An **architectural migration left the safety post-filter behind
on the old code path.** The original Foxy (legacy intent-router in
`src/lib/ai/workflows/*`) was built with `validateOutput` as the final stage
before render. When Foxy was re-platformed onto the `grounded-answer` Edge
Function (the "moat" RAG pipeline), the new pipeline reimplemented
post-processing as **structured-schema validation** (`validateFoxyResponse` +
`validateSubjectRules` in `pipeline.ts`) — which solves a DIFFERENT problem
(JSON well-formedness + per-subject formatting), not content safety. The
content-safety blocklist was never ported into the new pipeline because the
team's mental model treated "structured validation passed" as equivalent to
"post-processed," and the prompt-level `FOXY_SAFETY_RAILS` was assumed
sufficient.

**Introducing layer:** Pipeline/architecture migration (legacy → grounded-answer
Edge Function). The guard was correct in its original home; the defect is a
**coverage hole created at the cutover**, not a wrong implementation.

**Why it persisted:** The legacy guard still exists and is still imported, so
grep-based "do we filter output?" checks return true — masking that the live
path doesn't call it. Tests REG-54/REG-55 cover the oracle + structured envelope
(shape correctness), so the safety-filter gap has no failing test to surface it.

**Correct fix locus:** Add the deterministic content filter at the two
render/persist boundaries of the NEW path (denormalized answer in `route.ts`
post-`extractValidatedStructured`, and on stream-done in `_lib/streaming.ts` +
the Deno pipeline), reusing the existing blocklist logic. Do NOT touch scope
behavior or prompts.

---

## FOX-2 — Student message not sanitized for injection

**Root cause:** **Asymmetric trust modeling.** When prompt-injection hardening
was added (Phase 2.B Win 4, `pipeline.ts:239-272`), the threat model focused on
**untrusted INGESTION content** (a poisoned `rag_content_chunks` row could carry
"ignore previous instructions"), so `sanitizeChunkForPrompt` was applied to
chunks. The student message was (reasonably) treated as the user turn rather
than system content, so it was left raw. The residual gap is the non-structured
`wrapAsParagraph` fallback, where a jailbroken free-text answer has the fewest
downstream guards.

**Introducing layer:** Prompt-assembly hardening phase — scoped to chunk
provenance, not user input. Consistent design intent, incomplete coverage.

**Correct fix locus:** Input-side heuristic feeding the safety-rails refusal;
co-located with FOX-1's post-filter so both render boundaries are covered.

---

## FOX-3 — Mode/template/whitelist drift

**Root cause:** **Independent evolution of three lists that were never
re-reconciled.** `VALID_MODES` (`_lib/constants.ts:31`) predates the
multi-template split (RCA-FIX RC-1, 2026-06-26, `route.ts:402-421`) that
introduced `selectFoxyPromptTemplate` and the doubt/homework/explorer modes
referenced in the constitution. The template selector was added to fix
"3 conflicting output formats in one template," but the route's input whitelist
was not widened in the same change, so doubt/homework requests are coerced to
`learn`. The safety rails ride along on every path, so the drift degraded UX
consistency without breaching P12.

**Introducing layer:** Incremental prompt-template refactor (RC-1) that touched
the selector but not the input contract.

**Correct fix locus:** Single reconciliation PR (assessment-reviewed) aligning
`VALID_MODES` ↔ documented mode set ↔ `selectFoxyPromptTemplate`.

---

## FOX-4 — Active OpenAI cross-provider fallback

**Root cause:** **Reliability engineering outran the governance gate.** The
multi-provider fallback chain (`claude.ts:resolveModelOrder`) was added to make
the pipeline resilient to Anthropic outages (and to feed the MoL shadow/
telemetry program). It is genuinely good for uptime. But the constitution
requires user approval for "AI model or provider changes," and a fallback that
can emit student-facing answers from gpt-4o-mini/gpt-4o is, functionally, a
second student-facing provider. The governance checkpoint was not applied
because the change was framed as a reliability fallback, not a "provider
change."

**Introducing layer:** Reliability/MoL workstream (model-fallback + shadow
routing). Classification mismatch between "fallback" and "provider change."

**Correct fix locus:** A user decision (approve & document, or gate OpenAI off
for `caller:'foxy'`). No autonomous code change — provider scope is user-gated.

---

## FOX-6 / FOX-7 (brief)

- **FOX-6 (studentName in scope):** Root cause is a **necessary-but-dangerous
  data pull** — the name is required to SCRUB it out of cached synthesis text,
  so it must be in scope, but its presence invites future accidental injection.
  Introducing layer: long-memory feature (`ff_foxy_long_memory_v1`). Fix: a
  standing P13 prompt-assembly contract test (no behavior change).
- **FOX-7 (word-cap no-op):** Root cause is an **intentional deferral** pending
  MoL grading confirmation that truncation doesn't drop scoring points
  (`index.ts:31-34`). Introducing layer: MoL grading dependency. Not a defect.

---

## Cross-cutting theme

The dominant root-cause pattern is **safety/governance debt created at
architectural cutovers**: each individual change (RAG re-platform, prompt-template
split, provider-fallback for resilience, long-memory) was locally correct, but
the Foxy turn's **end-to-end safety contract was never re-asserted against the
new topology**. The prompt rails (`FOXY_SAFETY_RAILS`), grounding, single-
retrieval, kill switch, circuit breaker, quota, and PII redaction all migrated
correctly and remain strong — but the **deterministic output content-filter**
(the P12 "always post-process" backstop) did not make the jump, and the
provider surface widened without re-passing the governance gate. The fix is not
to rebuild safety, but to **re-anchor the two missing guards (output filter +
provider governance) onto the current live path** and pin them with regression
tests so the next cutover cannot drop them again.
