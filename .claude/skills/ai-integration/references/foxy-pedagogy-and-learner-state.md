# Reference: Foxy Pedagogy & Learner-State Governance

Read this when the task touches Foxy's tutoring behavior, adaptive decisions, learner memory, structured model output, grounding/citations, or AI evaluation. Loaded from `ai-integration/SKILL.md`.

## Durable learner truth lives in typed, governed database records — never in free-form model memory

The model (Foxy, quiz-generator, cme-engine) is never the canonical store of what a student knows. Canonical learner state lives in governed tables (`concept_mastery`, `student_learning_profiles`, and the BKT/IRT writers described in `docs/architecture/cognitive-model.md` and the `student-dashboard-design` skill's "Learner Data Semantics" section). A model call may *read* that state to personalize a response, and may *propose* an update, but any write to canonical learner state goes through the existing typed, reviewed write path (the projector/RPC boundary described in `docs/architecture/ADR-001-learner-loop-unification.md` and `ADR-005-concept-first-adaptive-learning-spine.md`) — never a raw upsert from inside a chat handler.

## Schema validation before persistence

Any structured output a model produces that will be stored (not just displayed) must be validated against a schema before it is written — reject and log on validation failure rather than best-effort coercing malformed output into a table. Treat model output as untrusted input until validated, the same way you'd treat a client HTTP body.

## No free-form model memory as canonical state

"What Foxy remembers" (the `/memory` transparency surface) is a *presentation* of governed learner state and any explicit, typed preference/memory record — not a place where arbitrary conversational context becomes an authoritative fact about the student. If a feature wants Foxy to "remember" something durably, it needs a typed table and a schema, not an ad hoc blob in a chat-history row.

## Citations and retrieval traces

Every grounded answer must be traceable to the source material that justified it. The `grounded-answer/` pipeline's citation and trace stages exist for exactly this — a new AI-writing surface that claims a curriculum fact must carry a citation back to `rag_content_chunks` provenance, not assert the fact unsupported. See `references/ncert-rag-architecture.md` for the retrieval side of this contract.

## Abstain when evidence is insufficient

A model must be able to say "I don't have enough to answer that confidently" rather than produce a fluent, unsupported answer. The `grounded-answer/` pipeline's abstention stage is the enforcement point — do not add a new answer-generation path that skips it in the name of a better user experience.

## Prompt/model/config identifiers — required, currently missing

Every AI-generated artifact that gets stored or scored should be traceable to which prompt version, which model, and which config produced it. **This does not exist in the schema or code today** — there is no `prompt_version`/`model_version` column or constant anywhere. Do not describe this as implemented. If you're adding new AI-writing surfaces, propose the stamping mechanism as part of that work rather than assuming another surface already has it.

## Separate live tutoring from offline generation and evaluation

Foxy's interactive chat path (`apps/host/src/app/api/foxy/route.ts`, real-time, must respond within the daily-usage/circuit-breaker constraints in the hub skill) is architecturally distinct from offline generation and evaluation work (`quiz-generator`, `cme-engine`, `eval:teacher:harness`, `eval:rag:harness`). Do not bolt an expensive offline-evaluation step onto the live chat request path — offline work runs asynchronously and is measured separately.

## Track correctness, safety, latency, and cost

Any new model-call site should be measurable on all four dimensions, not just "does it look right in a demo": correctness (does the eval harness or a labelled review confirm it), safety (safeguarding classification passed), latency (does it fit the interactive budget if it's on the live path), and cost (token/call volume, especially for anything that could be invoked at scale).

## Human escalation and no diagnostic claims

This reference does not restate the safeguarding escalation contract or the medical/psychological-claim prohibition — those are policy, owned by `alfanumrik-student-safety`. This reference's job is narrower: any AI surface must actually call into that escalation path (`apps/host/src/app/api/foxy/_lib/safeguarding-escalate.ts`) rather than handle a safety concern inline with a clever prompt.

## Do not claim teaching quality without labelled evaluation

"Foxy explains concepts well" is not a fact you can assert from reading the prompt. It requires a labelled evaluation run (`eval:teacher:harness` or an equivalent scored comparison) — cite the run, don't assert the quality from code inspection alone.

## What this reference does not own

RAG ingestion/retrieval architecture (`references/ncert-rag-architecture.md`), the 18-cell coverage/tuning audit (`rag-math-science-tuning`), provider gateway mechanics (the hub `SKILL.md`), and student-data safety policy (`alfanumrik-student-safety`).
