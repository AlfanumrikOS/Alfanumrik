# 07 - AI Certification Report

Stage 1 (static/read-only), 2026-07-02. Scope: Foxy AI tutor, NCERT solver, quiz generator,
cognitive-mastery engine, grounded-answer, AlfaBot, RAG pipeline, embeddings, bulk content
generation - 20 AI-adjacent surfaces total, all individually hand-verified this wave.

| Dimension | Finding | Confidence |
|---|---|---|
| Prompt quality / safety policies | Age-appropriateness and CBSE curriculum scope-lock confirmed present in the actual system-prompt text, not just described in documentation | HIGH |
| Hallucination resistance / grounding / NCERT correctness | The quiz-generator validation oracle is confirmed genuinely live in production (a feature flag enabling it was flipped on with no later revert) and sits between generation and the question bank on every traced insertion path | HIGH |
| Bloom taxonomy alignment | Confirmed structurally present in the tutoring decision-tree prompt text; pedagogical correctness of that text was not evaluated (out of this wave's scope) | MEDIUM |
| Response latency | Instrumentation confirmed present in code; no live latency data was accessible in a static pass | NOT VERIFIED (not estimated) |
| Embedding freshness | A static version stamp was found; no scheduled regeneration job was located | NOT VERIFIED |
| Retrieval quality (RAG eval harness) | Correctly identified as requiring a live database connection; not run this wave, deferred to Stage 2 rather than run against nothing or skipped silently | DEFERRED TO STAGE 2 |
| Token usage / cost tracking | Quota-recording mechanism confirmed present and gating the primary tutor route before any provider call | HIGH |
| Fallback behaviour | A documented fallback path from the primary AI provider to a secondary provider exists and is CEO-approved at the architecture level | HIGH (architecture) |
| Prompt injection resistance | Server-side scope-lock (hard-refusal categories) confirmed to run before any provider call and cannot be bypassed by a client skipping the client-side prompt guard | HIGH |
| Safety policies / daily usage limits per plan | Confirmed enforced via the same quota mechanism noted above | HIGH |

## Auth posture across all 20 AI-adjacent surfaces

Every surface has a genuine authorization check before any business logic runs (direct JWT,
the shared AI-admission Platform Security Layer, an admin-key header, or a cron-secret header).
No surface was found unauthenticated.

## Open item requiring a decision, not a fix

The base AI-provider fallback path is CEO-approved architecturally, but the residual question of
whether unredacted student free-text reaching the fallback provider is acceptable - and whether
a currently-dormant shadow-grading flag should ever be promoted - has no recorded ruling. This
is escalated in the risk register (CERT-06) and in the Appendix rather than treated as resolved.

## What was independently corrected from the prior audit

One prior finding described a client-side prompt mirror as part of the enforcement chain; this
wave found that specific file is dead code (imported only by its own test), which does not
weaken enforcement since the server-side check is independent and sufficient, but is a
documentation nuance worth recording.
