/**
 * Foxy page-local TypeScript types.
 *
 * Extracted (verbatim) from `src/app/foxy/page.tsx` so the page module can
 * shed declarations without behavior change. Imported back into page.tsx
 * via `import type { ... } from './_lib/foxy-types'`.
 */

import type {
  GroundingStatus,
  AbstainReason,
  SuggestedAlternative,
  SuggestedButtonType,
  NextAction,
} from '@alfanumrik/ui/foxy/ChatBubble';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';

export interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

/**
 * Part B1 — the evidential "Quiz me" contract carried on the POST /api/foxy
 * response (field `quizMe`), stamped onto the tutor ChatMessage so the MCQ
 * renderer knows whether answering moves mastery.
 *   - evidential:true  → a server-issued served-item exists; the renderer POSTs
 *     the chosen answer to /api/foxy/quiz-answer to commit the graded result
 *     through the sanctioned mastery pipeline.
 *   - evidential:false → practice-only. NO grade call, NO mastery claim. The
 *     MCQ renders self-check (local reveal) exactly as before.
 */
export type QuizMeWire =
  | { evidential: true; servedItemId: string }
  | { evidential: false; reason?: string | null };

export interface StreamingCallbacks {
  onSession?: (sessionId: string) => void;
  onMetadata?: (meta: { groundingStatus: GroundingStatus; traceId?: string; confidence?: number; citationsCount?: number }) => void;
  onText: (delta: string) => void;
  // B'-5 Phase 2: synthesized at server side AFTER the upstream `done` once
  // the assistant row has been persisted. Carries the DB UUID so the client
  // can wire 👍/👎 to /api/foxy/feedback for THIS bubble. Absent when
  // persistence fails — handleFeedback then falls back to the legacy
  // aggregate counter.
  onPersisted?: (info: { messageId: string }) => void;
  onDone: (info: {
    tokensUsed: number;
    latencyMs: number;
    groundedFromChunks: boolean;
    citationsCount: number;
    claudeModel: string;
    /**
     * Validated structured FoxyResponse — emitted ONCE on the `done` event by
     * the streaming pipeline (pipeline-stream.ts). Absent when the upstream
     * could not produce a schema-valid payload (kill-switch, parse failure,
     * non-Foxy flow). Until `done` arrives the bubble shows partial text deltas
     * via the markdown renderer; on `done` the bubble swaps to the structured
     * renderer when this field is present.
     */
    structured?: FoxyResponse;
    /**
     * Server-computed SymPy-verifier badge state (fail-closed mapping). Carried
     * on the streaming `done`/`persisted` event when present. The renderer
     * DISPLAYS this only — never recomputes correctness. Absent on non-math /
     * legacy responses (renders nothing).
     */
    badgeState?: 'verified' | 'check_manually' | 'none' | 'out_of_scope';
    /**
     * Phase 2.1 Teaching Director (ff_foxy_teaching_director_v1) — context-aware
     * subset of the four primary post-answer buttons. Present on the enriched
     * SSE `done` frame ONLY when the flag is ON and a plan composed; absent ⇒
     * the bar renders all four (byte-identical to today).
     */
    suggestedButtons?: SuggestedButtonType[];
    /** Phase 2.1 — advisory follow-up actions (bilingual, display-only). */
    nextActions?: NextAction[];
  }) => void;
  onAbstain?: (info: { abstainReason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; traceId?: string }) => void;
  onError?: (info: { reason: string; traceId?: string }) => void;
}

/**
 * Phase 1 post-answer learning-action directive. When the student taps
 * "Explain simpler" / "Show example" / "Quiz me on this" on a Foxy answer, the
 * SAME prior question is re-sent to the server carrying this directive so Foxy
 * re-teaches. Maps 1:1 to the server's `coachDirective` enum on POST /api/foxy.
 *   'simplify' → simpler re-explanation
 *   'example'  → one worked example
 *   'quiz_me'  → exactly one oracle-gated inline MCQ (server FORCES blocking)
 *
 * Defined here (moved from useFoxyChat) so foxy-constants + MessageList can
 * reference the directive type/label WITHOUT importing the chat hook. Re-exported
 * from `useFoxyChat` for existing importers (page.tsx).
 */
export type CoachDirective = 'simplify' | 'example' | 'quiz_me';

export interface ChatMessage {
  id: number;
  role: 'student' | 'tutor';
  content: string;
  /**
   * Directive-echo marker (Phase 1 learning actions). Set ONLY on a student
   * bubble that was appended by a learning-action re-send (a tap of "Explain
   * simpler" / "Show example" / "Quiz me on this"). When set, MessageList renders
   * a compact, right-aligned intent PILL (see DIRECTIVE_ECHO_LABELS) instead of
   * re-echoing the full prior question as a normal student bubble — the fix for
   * the "question renders twice" bug. The FULL question text is still what the
   * server receives (via foxyParams.message); only the DISPLAYED bubble changes.
   * Absent on every genuinely-typed message, mode auto-prompt, lesson prompt, and
   * mastery suggestion — those still render as normal user bubbles.
   */
  directive?: CoachDirective;
  timestamp: string;
  xp?: number;
  feedback?: 'up' | 'down' | null;
  reported?: boolean;
  imageUrl?: string;
  /** Grounding verdict — set only on tutor messages served from the grounded-answer service. */
  groundingStatus?: GroundingStatus;
  /** Server-side trace id — useful for debugging/reporting. */
  traceId?: string;
  /** Abstain reason (only present when groundingStatus === 'hard-abstain'). */
  abstainReason?: AbstainReason;
  /** Suggested alternative chapters (only present when groundingStatus === 'hard-abstain'). */
  suggestedAlternatives?: SuggestedAlternative[];
  /**
   * Validated structured-block payload from the Foxy API (post-migration).
   * - POST /api/foxy returns this on `data.structured` when upstream emitted a
   *   schema-valid FoxyResponse.
   * - GET /api/foxy?sessionId=... returns it per persisted assistant row when
   *   the row was saved after the structured-output migration.
   * - Streaming: arrives only on the `done` event; until then the bubble shows
   *   the in-progress `content` via the legacy markdown renderer.
   * Absent on legacy assistant rows, abstain responses, and user messages.
   */
  structured?: FoxyResponse;
  /**
   * B'-5 Phase 2: the persisted DB UUID for this assistant turn. Used by
   * handleFeedback to call /api/foxy/feedback. Set from:
   *   - SSE `persisted` event for fresh streaming turns
   *   - JSON `messageId` for fresh blocking turns
   *   - GET `messages[i].id` for historical turns on session resume
   * Absent on user messages and on assistant rows where persistence failed —
   * handleFeedback then falls back to the legacy aggregate counter.
   */
  persistedMessageId?: string;
  /**
   * Server-computed SymPy-verifier badge state (fail-closed mapping). Set only
   * on tutor messages whose Foxy response carried a `badgeState` on the POST
   * /api/foxy envelope (next to `structured`). The renderer DISPLAYS this
   * only — it never recomputes correctness. Absent on every non-math / legacy
   * response, in which case the badge element is NOT rendered (zero DOM change).
   */
  badgeState?: 'verified' | 'check_manually' | 'none' | 'out_of_scope';
  /**
   * Part B1: evidential "Quiz me" contract. Present ONLY on a tutor turn that
   * served a "Quiz me" MCQ. Drives whether the MCQ renderer grades through
   * /api/foxy/quiz-answer (evidential:true → moves mastery) or renders
   * practice-only self-check (evidential:false → no grade call, no mastery
   * claim). Absent on every non-quiz turn (the MCQ, if any, is self-check).
   */
  quizMe?: QuizMeWire;
  /**
   * Phase 2.1 Teaching Director (ff_foxy_teaching_director_v1). Context-aware
   * subset of the four primary learning-action buttons the Director wants Foxy
   * to surface this turn. Stamped from BOTH the blocking JSON response
   * (`data.suggestedButtons`) and the enriched streaming `done` frame. Present
   * ONLY when the flag is ON and a plan composed; absent ⇒ ChatBubble renders
   * all four buttons (byte-identical to today).
   */
  suggestedButtons?: SuggestedButtonType[];
  /**
   * Phase 2.1 — advisory follow-up actions from the Director, rendered as a
   * subtle display-only chip row beneath the action bar (bilingual, P7). Never
   * dispatches or mutates state. Absent ⇒ no chip row.
   */
  nextActions?: NextAction[];
}
