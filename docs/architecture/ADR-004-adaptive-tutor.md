# ADR-004 — The Adaptive Tutor (concept-first OS)

**Date:** 2026-05-12
**Status:** Accepted (CEO sign-off 2026-05-12, scope = all grades, all subjects)
**Supersedes:** the "chapter reader" framing in PR #749 (which now becomes a legacy path)
**Companion:** [ADR-001 — Learner Loop](./ADR-001-learner-loop-unification.md) (the resolver substrate this builds on)

## Context

Alfanumrik's stated product mission is an **Adaptive Learning OS** — an application that takes any student in any grade and walks them, concept by concept, to mastery of the full syllabus, leaving nothing untaught. The CEO articulated this on 2026-05-12 after rejecting a narrower "chapter reader v2" proposal that still made the student navigate to chapters themselves.

The existing app does not match that mission:
- `/learn/[subject]/[chapter]` requires the student to pick a subject, pick a chapter, walk through it. The student drives.
- Concepts and questions are stored in separate tables (`chapter_concepts`, `question_bank`) with no relational link; current Practice mode pairs them by array index, producing concept↔quiz mismatches.
- Read mode dumps raw RAG chunks, looking nothing like curated teaching.
- No system surface ensures coverage of the whole grade — a student can skip half the chapters and the app never reacts.

## Decision

Replace the chapter-first experience with a **concept-first Adaptive Tutor**. The application owns the path through the syllabus; the student opens the app and learns whatever comes next.

### Primitives

| Layer | Component | Source of truth |
|---|---|---|
| Content | Concept (title, explanation, worked example, key formula, 1+ MCQs) | `public.chapter_concepts` |
| Curriculum graph | Prerequisite DAG keyed by `concept_code` | `public.concept_graph` |
| Mastery projection | Per-(student, concept) posterior | `public.concept_mastery` (canonical for ADR-004) |
| Event substrate | `learner.concept_check_answered` etc. | `public.state_events` via `publishEvent()` |
| Picker | `resolveNextConcept(input)` (pure) | `src/lib/tutor/resolve-next-concept.ts` |
| Tutor entry | `GET /api/tutor/next` | `src/app/api/tutor/next/route.ts` |
| Answer recorder | `POST /api/tutor/answer` | `src/app/api/tutor/answer/route.ts` |
| UI surface | `/tutor` page | `src/app/tutor/page.tsx` |

### Picker rule (Phase 0, deterministic)

Given a student and their full grade-scoped concept list:

1. If a `currentChapterHint` is provided and that chapter has un-mastered concepts → return the lowest `concept_number` un-mastered concept in that chapter.
2. Otherwise scan the grade's concepts in `(subject ASC, chapter_number ASC, concept_number ASC)` order and return the first whose `mastery_mean < MASTERY_THRESHOLD` (or has no mastery row).
3. If everything is mastered → return `grade_complete`.
4. If the grade has no active concepts → return `no_content`.

Pure. No randomness, no I/O. Same input → same output. Phase 1+ extends this with decay-driven re-surfacing and prerequisite enforcement, in the same function, with the same return type.

### Mastery model (Phase 0, naive)

- `correct` → `mastery_mean = max(current ?? 0.5, MASTERY_THRESHOLD + 0.05)`, `streak_current++`
- `wrong`   → `mastery_mean = min(current ?? 0.5, 0.5)`, `streak_current = 0`
- Total attempts, total correct, last-practiced updated on every answer.

This is intentionally crude. **Phase 2 (PR 2 of ADR-005) replaces it with Bayesian Knowledge Tracing under ADR-005 Path C v2**: `/api/tutor/answer` calls the atomic Postgres RPC `tutor_commit_attempt`, which under `pg_advisory_xact_lock` per (student, concept) reads the chain head from `concept_attempts`, computes the BKT posterior via the SQL `bkt_update` function (parity-tested 1e-9 vs the TS `updateMasteryBKT`), and INSERTs both a `concept_attempts` row and a `learner.concept_check_answered` event in one transaction. The new `concept-mastery-projector` subscriber catches the event and rolls up canonical `concept_mastery.mastery_mean`. The picker's contract doesn't change — only the values flowing through `mastery_mean` change.

- **Phase 2 status (2026-05-12):** Spec → [`docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md`](../superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md). Plan → [`docs/superpowers/plans/2026-05-12-adr-004-phase-2-bkt-projector.md`](../superpowers/plans/2026-05-12-adr-004-phase-2-bkt-projector.md). Flag: `ff_tutor_bkt_v1` (default OFF). Requires `ff_event_bus_v1 AND ff_projector_runner_v1` ON simultaneously.

### What the student experiences (Phase 0)

```
Student opens app → navigates to /tutor (or dashboard CTA does it)
   ↓
Concept card (title, ~150-word explanation, worked example, key formula, bilingual)
   ↓
1 MCQ (the concept's own practice_question, not random chapter question)
   ↓
Submit → feedback (correct/incorrect + explanation)
   ↓
"Next concept →" → API refetch → next concept (same or different chapter/subject)
   ↓
Loop forever until grade_complete
```

No chapter picker on this page. No subject picker. The student does not need to know what to do next; the app decides.

### Phasing

| Phase | Scope | Visible result |
|---|---|---|
| **0 — Foundations** (this PR) | Pure picker + /api/tutor/next + /api/tutor/answer + /tutor page + ff_tutor_v1 (default OFF). Uses existing G7 maths ch.1 content. Naive mastery write. | A student with the flag on can open /tutor, see one concept, answer it, see the next concept, and eventually hit "grade complete" once the 6 backfilled concepts are mastered. |
| **1 — Decay + continuation hint** | Read recent state_events to derive `currentChapterHint`. Add decay-driven re-surfacing (concepts whose `current_retention` falls below 0.7 jump to the front of the picker). | Returning students continue where they left off rather than restarting at concept #1. Mastered concepts come back after a real spaced-repetition interval. |
| **2 — BKT projector** | Replace the naive mastery write with a real BKT subscriber of `learner.concept_check_answered`. Calibrate p_know / p_learn / p_guess / p_slip from accumulated event data. | Mastery numbers reflect reality. "85%" actually means a 15% chance the next attempt is wrong. |
| **3 — Adaptive re-teach** | On 2× consecutive wrong, hand off to Foxy: explain the misconception, then serve a fresh MCQ on the same concept. Don't advance until mastered. | A struggling student gets help instead of grinding through wrong-answer screens. |
| **4 — Prerequisite enforcement** | The picker reads `concept_graph.prerequisite_codes` and refuses to advance to a concept whose prereqs aren't mastered. Falls back to teach the missing prereq first. | A student who skipped a foundation can't accidentally walk into an advanced concept; the OS catches them. |
| **5 — Content pipeline + reviewer UI** | LLM-driven backfill script. Reviewer UI at `/super-admin/tutor/review`. Linter blocks placeholder rows. Generate + review all of G7 (~75 concepts × 5 subjects = ~375 concepts), then G6, G8, etc. | Every concept in every subject in every grade is publication quality. The tutor has actual content to teach. |
| **6 — Progress map** | `/map` renders the grade's syllabus DAG with mastery colors. Clicking a node hops the tutor to that concept. | The student sees their journey. Parents can show off "they've mastered 47 of 380 concepts in Grade 7." |

Each phase is independently shippable, flag-reversible, and produces a visible improvement.

## Consequences

### Positive
- **Mission-aligned.** The app finally does what "Adaptive Learning OS" claims.
- **One surface to optimise.** Every product improvement (better content, better explanations, better adaptive rules) lands in one place (`/tutor`), not scattered across `/learn`, `/quiz`, `/study-plan`, `/review`.
- **Composable with existing substrate.** Reuses `chapter_concepts`, `concept_graph`, `concept_mastery`, `state_events`, Foxy, feature flags, the Learner Loop's resolver pattern. Nothing thrown away except the *idea* that chapters are the unit of work.
- **Quality gates are central.** Bad concept rows never reach the tutor because the linter blocks them (Phase 5). The system improves as content improves.

### Negative / risks
- **Content is now the long pole.** 12 grades × 5 subjects × ~6 concepts/chapter × ~12 chapters/subject ≈ 4,000 concepts to backfill at publication quality. Even at 50/day with one reviewer, that's a full quarter of content work. The pipeline + reviewer UI is critical infrastructure, not optional.
- **Legacy `/learn` stays around.** Until /tutor covers everything, both surfaces exist. We deprecate `/learn` only after Phase 5 covers the grade.
- **Mastery numbers will be wrong in Phase 0.** Naive update is for plumbing — don't surface "Grade complete!" too loudly until Phase 2 lands. The current Phase 0 page shows `mastered/total` as a count, not a percentage, to keep expectations modest.
- **Cross-subject jumps may feel jarring.** Phase 0's picker happily flips from math to science mid-session if math is exhausted. Phase 1's continuation hint mitigates this; if user testing shows it's still jarring, add a "subject of the day" preference.

### Out of scope (explicit)
- Cross-grade jumps (a Grade 7 student never sees Grade 8 content). Teacher action only.
- Personalisation by interest / career goal (later — Phase 7+).
- Group / classroom modes (teacher-led pacing). Different product surface.
- Olympiad / JEE / NEET branches inside the tutor. Today the tutor teaches CBSE syllabus per `chapter_concepts.is_active=true`; competitive content has its own pathway.

## Rollout (Phase 0 → student-visible)

1. **Phase 0 PR merges** → `ff_tutor_v1` exists in `feature_flags` (OFF) + code is live.
2. CEO account added to `metadata.target_user_ids` (when that helper ships) — or flag flipped on for a small staging cohort.
3. CEO walks /tutor end-to-end on G7 maths ch.1 (the 6 backfilled concepts). Verifies the loop closes.
4. Backfill pipeline (Phase 5) starts in parallel. Once a chapter passes the linter + reviewer approval, that chapter's concepts become live for the tutor.
5. Flag goes to 100% rollout for student-role users only after Phase 2 (real BKT) AND Phase 5 covers at least one full grade.

## References
- Corbett & Anderson 1995 — BKT mastery threshold 0.95 in the classic paper; we use 0.85 because we have multiple MCQs per concept and the threshold is on the *current* mastery posterior, not the lifetime estimate.
- ADR-001 — Learner Loop. The Tutor uses the same resolver pattern, same flag-gated rollout, same state-events substrate.
