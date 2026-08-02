/**
 * packages/lib/src/placement/types.ts — the placement-check render DTO (Wave B).
 *
 * Canonical location for the six-probe placement contract shared between the
 * `usePlacement` reader/writer hook (this package) and the `PlacementCheck`
 * presentation component (`@alfanumrik/ui/onboarding/v2/PlacementCheck`). Lib
 * owns the DTO, UI consumes it — matches `today/types.ts` → `ui/today/*.tsx`.
 *
 * Moved here 2026-08-02 from the UI component file it originally lived in,
 * which had a `packages/lib` hook importing a type from `packages/ui` —
 * backwards from every other pattern in this repo.
 *
 * PROPOSED read/write contract — `GET /api/v2/placement` and
 * `POST /api/v2/placement/answer` are implemented against this exact shape
 * (see `use-placement.ts`), gated by `ff_placement_v1`.
 */

export interface PlacementQuestion {
  /** question_bank.id */
  id: string;
  /** curriculum_topics.id this question calibrates. Null when the source
   *  question_bank row has no topic_id — a real, unremarkable case, not an
   *  error. Must NOT be defaulted to the question's own id (that fabricates
   *  a fake topic id and fails the learning_events.topic_id FK on submit). */
  topicId: string | null;
  /** Already-localised stem. */
  stem: string;
  options: Array<{ id: string; label: string }>;
}

export interface PlacementAnswer {
  questionId: string;
  /** Passed through verbatim from PlacementQuestion.topicId — see that field's
   *  doc. Matches the nullable topicId in the POST /api/v2/placement/answer
   *  body contract (PlacementAnswerRequest.topicId: zUuid.nullable()). */
  topicId: string | null;
  /** Null when the student chose "haven't done this yet". */
  optionId: string | null;
  /** True for the "haven't done this yet" branch. */
  unseen: boolean;
}
