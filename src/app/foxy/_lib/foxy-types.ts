/**
 * Foxy page-local TypeScript types.
 *
 * Extracted (verbatim) from `src/app/foxy/page.tsx` so the page module can
 * shed declarations without behavior change. Imported back into page.tsx
 * via `import type { ... } from './_lib/foxy-types'`.
 */

import type { GroundingStatus, AbstainReason, SuggestedAlternative } from '@/components/foxy/ChatBubble';
import type { FoxyResponse } from '@/lib/foxy/schema';

export interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

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
  }) => void;
  onAbstain?: (info: { abstainReason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; traceId?: string }) => void;
  onError?: (info: { reason: string; traceId?: string }) => void;
}

export interface ChatMessage {
  id: number;
  role: 'student' | 'tutor';
  content: string;
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
}
