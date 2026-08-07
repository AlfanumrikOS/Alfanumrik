# Adaptive Learning Backend

## Contents

1. Canonical learning loop
2. Domain services and ownership
3. Learning-event contract
4. Learner state and adaptive engines
5. Foxy and model routing
6. Grounded retrieval
7. Evidence and explainability
8. Safety and failure rules
9. End-to-end tests

## 1. Canonical learning loop

Preserve this closed loop:

1. Capture an authorized, versioned learning event.
2. Validate curriculum identity, attempt semantics, tenant, actor, and source.
3. Persist the event durably and idempotently.
4. Update or enqueue learner-state calculations.
5. Reconcile BKT/DKT, IRT, CME, spaced repetition, and curriculum prerequisites through explicit ownership.
6. Resolve one explainable next action.
7. Deliver learning, practice, feedback, or intervention.
8. Capture new evidence and expose appropriate views to student, teacher, parent, and school.

Do not let page-specific endpoints maintain conflicting mastery or recommendation state.

## 2. Domain services and ownership

Use explicit conceptual services even if deployed together:

- **Curriculum and content**: canonical Concept IDs, subject/chapter graph, prerequisites, content versions, source/rights lineage, approval state.
- **Assessment and item bank**: questions, variants, difficulty, discrimination, guessing, misconceptions, hints, scoring, validity, exposure controls.
- **Learning events**: immutable attempts, responses, timing, hints, confidence, modality, source, content version, and correction events.
- **Learner state**: mastery, retention, confidence, pace, evidence freshness, uncertainty, unresolved misconceptions.
- **Adaptive recommendation**: review, remediation, progression, enrichment, assignment, exam, or diagnostic priority with reason.
- **Session and orchestration**: attempt lifecycle, resume, sequencing, partial completion, idempotency.
- **Foxy pedagogy and model routing**: teaching action, prompt/context policy, provider selection, safety, fallback.
- **Evidence and escalation**: what changed, why, teacher/parent visibility, human intervention, audit.
- **Analytics and experimentation**: product/learning projections, feature rollout, quality evaluation; not authoritative learner truth.

## 3. Learning-event contract

A learning event should carry stable, privacy-minimized fields such as:

- event ID, type, schema version, occurred/received time
- tenant, learner, grade/board, subject, chapter, canonical concept
- activity, question/content ID and version, session, assignment/source
- authorized actor and device/session class
- response method and correctness outcome without duplicating unnecessary raw content
- response time, hints, attempts, confidence, misconception evidence
- explanation format, language, modality, and accessibility context when relevant
- causation, correlation, experiment, and recommendation IDs

Enforce deduplication, ordering rules per session/attempt, and correction rather than destructive rewriting. Make projections replayable when practical.

Do not use analytics events as the only authoritative learning ledger.

## 4. Learner state and adaptive engines

Keep meanings distinct:

- **BKT/DKT** estimates knowledge state from sequences of evidence.
- **IRT** models item characteristics and learner ability for selection/estimation.
- **CME** provides canonical concept-level mastery and explainable reconciliation.
- **Spaced repetition** schedules retrieval based on retention evidence and review policy.
- **Curriculum graph/ZPD logic** constrains prerequisites, progression, and challenge.

Define one canonical read model for product decisions and record which engines contributed, their versions, evidence window, uncertainty, and update time.

For every engine prove:

- runtime caller and selection flag
- accepted event schema
- persisted input/output tables
- calibration/training source and version
- online versus batch update
- failure and replay behavior
- cold-start and insufficient-evidence behavior
- explainable reason exposed to the learner/teacher
- offline evaluation and production monitoring

Reject these false-integration patterns:

- calibration writes parameters that selection never reads
- a client flag defaults an engine off permanently
- a service computes state but writes a different table from consumers
- queue generation ignores SRS or discards selection parameters
- errors are caught without surfacing failed authoritative writes
- two learners receive identical content while UI claims personalization
- feature flags are enabled in code but have no rollout or reachable caller

The LLM must never calculate or declare authoritative mastery.

## 5. Foxy and model routing

Foxy acts as the learning brain and companion through governed services, not an unrestricted chat endpoint.

Provide minimum authorized context:

- tenant and learner scope
- grade, board, subject, chapter, concept, content/question version
- current session/attempt and permitted actions
- misconception/evidence summary, not unrestricted history
- language, modality, age band, safety and consent policy
- retrieved sources and provenance

Route by pedagogical action: explain, Socratic question, hint, example, quiz, reflection, motivation, SEL-safe response, notebook, or escalation. Select provider/model using task quality, safety, latency, availability, and cost.

Enforce:

- versioned prompts and policies
- structured outputs for tool/action decisions
- bounded context and tokens
- timeouts, cancellation, retry policy, and concurrency budgets
- content/safety checks before and after generation as appropriate
- provider-independent evaluation
- explicit degraded experience
- no direct service-role or unrestricted database access from model output
- no execution of model-provided SQL, URLs, or tool arguments without validation and authorization

## 6. Grounded retrieval

Use an approved-content pipeline:

1. Ingest only content with canonical curriculum mapping, source/rights lineage, version, and approval state.
2. Normalize and chunk using learning semantics.
3. Generate embeddings with recorded provider/model/version and cache by content hash.
4. Retrieve with tenant, board, grade, subject, concept, language, approval, and access filters applied before or within secure retrieval.
5. Combine vector and lexical/full-text candidates where evidence supports it.
6. Rerank when quality benefit justifies latency and cost.
7. Enforce minimum grounding quality and answerability.
8. Generate with cited passages and detect unsupported claims.
9. Record retrieval and model versions for evaluation without logging sensitive prompts indiscriminately.

Measure nDCG, recall/hit rate, answer correctness, citation support, unsafe-answer rate, latency, and cost on a maintained evaluation set. Do not lower thresholds merely to avoid empty results.

Known Alfanumrik risks to preserve as regression hypotheses include a soft Foxy path bypassing rerank/grounding, uncached embeddings, weak similarity floors, and quality regression from prior baselines. Verify current code and metrics before asserting they remain.

## 7. Evidence and explainability

Every consequential recommendation should expose a learner-friendly reason backed by stored evidence:

- review due
- prerequisite repair
- current-plan progression
- teacher assignment
- exam preparation
- enrichment/challenge
- diagnostic need

Keep internal model detail available for audit while presenting age-appropriate reasons. Record evidence IDs, engine/version, rule/feature flag, decision time, and human override.

Separate mastery estimate, retention/readiness, accuracy, completion, confidence, pace, teacher grade, and outcome. Never collapse them into one unexplained score.

## 8. Safety and failure rules

- Fail closed for tenant scope, authorization, unsafe actions, unapproved content, and authoritative writes.
- Degrade transparently when AI, rerank, embeddings, cache, or analytics are unavailable.
- Do not silently substitute ungrounded generation for grounded tutoring.
- Do not return success if an attempt is stored but required learner-state work is lost; use an explicit pending/recoverable state or durable queue.
- Preserve resume state and avoid duplicate scoring on retries.
- Escalate credible safety concerns through governed human workflows without diagnosing the learner.
- Keep teacher and guardian visibility within relationship, tenant, consent, and age boundaries.

## 9. End-to-end tests

Test at least:

1. Two learners with different histories receive justified different next actions.
2. Review-due evidence reaches Today and the practice selector.
3. Quiz submission writes one attempt, updates or durably queues learner state, refreshes recommendation, and exposes evidence.
4. Duplicate answer submission does not double-score or double-award.
5. CME/engine write failure is visible, recoverable, and replayed.
6. IRT-selected items use current calibrated parameters when the feature is active.
7. RAG refuses or escalates when approved evidence is insufficient.
8. A fallback model obeys the same grounding and safety contract.
9. Cross-tenant content, events, embeddings, and learner state cannot be retrieved.
10. Feature rollout verifies actual requests reach the intended path.
11. Provider outage preserves core learning and accurate status.
12. Event replay rebuilds the expected projection without duplicate effects.
