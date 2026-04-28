# Foxy + Student Study Experience — Production-Grade Plan

> **Authored 2026-04-27.** Three parallel audits (frontend / ai-engineer / assessment) identified gaps between the architecturally-sound system and what students actually experience. This document is the source of truth for the multi-phase remediation.

## Executive summary

The cognitive engine math is correct, RAG retrieval works, P-invariants hold. But:

- **Foxy doesn't stream** — students wait 3-15s on a "thinking" dot. Single biggest UX problem.
- **Misconception curator is decorative** — curated data never reaches Foxy's prompt.
- **Personalization is half-built** — `student_skill_state` written nightly, never read.
- **`was_grounded` analytics lies** — soft-mode answers count as grounded even when ungrounded.
- **/exams chapter selector broken** — wrong column join. Core funnel broken.
- **One missing static file silently kills Foxy** — `INLINE_PROMPTS` exists for exactly this but is never imported.
- **Mobile users on deprecated Foxy** — default `FOXY_ENDPOINT='edge'` hits legacy FTS-only path.

## Phase plan

| Phase | Theme | Effort | Status |
|---|---|---|---|
| 0 | Stop the bleeding (5 bug fixes) | 1 day | in progress |
| 1 | First 30 seconds matters (streaming + entry + memory) | 2-3 days | queued |
| 2 | Real personalization (skill_state + misconception repair + spaced-rep CTA) | 1 week | queued |
| 2.5 | Strengthen RAG + fine-tune Claude prompts (user-requested) | 3-5 days | queued |
| 3 | Truthful measurement | 3 days | queued |
| 4 | Pedagogy upgrades (gap→mini-quiz, recall openers, chat learning loop) | 1-2 weeks | queued |
| 5 | Mobile parity (FOXY_ENDPOINT default + HardAbstainCard equivalents + streaming) | 3-5 days | queued |
| 6 | Content production (Class 11/12 PCB + EHS subjects) | Multi-week | content team |

## Authorization

User authorized full execution 2026-04-27: "Execute all the plans one by one and ensure you make it production grade and for students."

## Metrics that matter

After Phase 1: Foxy first-token p50 <1s. Session-completed rate >85%. Quota refund rate <2%.
After Phase 2: % quiz Qs via IRT >50%. Misconception injection rate >30% on relevant concepts. Daily-review CTR >40%.
After Phase 2.5: Grounded-citation accuracy ≥90% via manual sample audit. Off-topic Foxy answers <5%.
After Phase 3: `was_grounded` accuracy ≥90%. Content-readiness dashboard visible to ops.
After Phase 4: Gap mini-quiz completion >60%. Bloom level progression measurable per student.
After Phase 5: Mobile/web Foxy parity ≥90% via sample audit.

## Source of truth

This document. Updated as each phase ships. Each phase merges its own PR; this doc gets a status update line.

## Update log

- 2026-04-27 13:00 IST — plan authored, Phase 0 starting
- 2026-04-28 — IP filing documentation authored (see "IP Filing Documentation" below).

## IP Filing Documentation

The CEO is preparing IP registration covering the Foxy pedagogy method, the RAG retrieval pipeline, and the cognitive-model assessment engine. Three architecture documents under `docs/architecture/` are the source-of-truth for the IP filing. They are written for an IP examiner, not for engineers — every concrete claim is annotated with `path:line` so the implementation can be inspected verbatim.

| Document | Scope | Path |
|----------|-------|------|
| Foxy pedagogy method | Method-of-instruction patent claim — 5-mode decision tree, 7-dim cognitive context, closing-question taxonomy, bilingual code-switching, distractor pedagogy, cross-session episodic memory, novelty comparison vs. ChatGPT/flash-card SaaS/BYJU'S/Vedantu/Unacademy | `docs/architecture/foxy-pedagogy-method.md` |
| RAG retrieval pipeline | Retrieval system claim — 9-stage pipeline (coverage, cache, kill switch, embedding, RRF retrieval, scope verify, rerank, MMR, grounding check + abstain), defense layers (P12), observability (P13), grade-string invariant (P5), novelty comparison vs. LangChain/plain vector/standard RRF | `docs/architecture/rag-pipeline.md` |
| Cognitive model | Assessment engine claim — three-tier cognitive state (concept_mastery / student_skill_state / student_learning_profiles), BKT model + calibration, IRT 2PL model + IRLS calibration, adaptive selection by Fisher information, SM-2 spaced repetition, misconception ontology, XP economy (P2), score formula (P1), anti-cheat (P3) | `docs/architecture/cognitive-model.md` |

