/**
 * AlfaBot — Shared SSE event-name constants.
 *
 * Used by the 3 surfaces that exchange Server-Sent Events:
 *   1. supabase/functions/alfabot-answer/stream-response.ts   (producer)
 *   2. src/app/api/alfabot/route.ts                            (pass-through + meta-injector)
 *   3. src/lib/alfabot/client.ts                               (consumer)
 *
 * IMPORTANT — drift history:
 *   When PR 2 shipped (2026-05-19) the Next route + client lib both used
 *   `event === 'text'` to accumulate token deltas, but the Edge Function
 *   (PR 2 ai-engineer slice) emits `event: token`. This module exists to
 *   prevent that drift from recurring. All three surfaces MUST import these
 *   names (the Edge Function via its own Deno mirror at
 *   `supabase/functions/alfabot-answer/sse-events.ts` to keep Deno+Node
 *   boundaries clean — the contract is enforced by REG-65/REG-67-adjacent
 *   contract tests in `src/__tests__/contract/alfabot-route-edge-contract.test.ts`).
 *
 * Stable contract (DO NOT rename without updating all 3 surfaces + tests):
 *   token    — incremental text delta from the LLM (`{ delta: string }`)
 *   citation — KB section ids that grounded the answer (`{ section_ids: string[] }`)
 *   meta     — rate-limit + envelope metadata appended by the Next route (`AlfabotResponse`)
 *   done     — terminal frame with token usage + final response (`DoneEnvelope`)
 *   error    — terminal error frame (`AlfabotErrorResponse`)
 *
 * Owner: testing (this file ships in PR-test alongside the contract test).
 * Review chain: backend (route owner), ai-engineer (Edge Function owner),
 * frontend (widget owner).
 */

export const ALFABOT_SSE_EVENTS = {
  /** LLM token delta. Payload: `{ delta: string }`. Emitted N times. */
  TOKEN: 'token',
  /** KB section ids used. Payload: `{ section_ids: string[] }`. Emitted at most once, before first token. */
  CITATION: 'citation',
  /** Rate-limit + envelope metadata. Payload: `AlfabotResponse`. Emitted by the Next route, NOT the Edge Function. */
  META: 'meta',
  /** Terminal frame. Payload: `DoneEnvelope`. Emitted exactly once. */
  DONE: 'done',
  /** Terminal error frame. Payload: `AlfabotErrorResponse`. */
  ERROR: 'error',
} as const;

export type AlfabotSseEvent =
  (typeof ALFABOT_SSE_EVENTS)[keyof typeof ALFABOT_SSE_EVENTS];

/** All event names as an immutable readonly array — handy for parser allowlists. */
export const ALFABOT_SSE_EVENT_NAMES: ReadonlyArray<AlfabotSseEvent> = [
  ALFABOT_SSE_EVENTS.TOKEN,
  ALFABOT_SSE_EVENTS.CITATION,
  ALFABOT_SSE_EVENTS.META,
  ALFABOT_SSE_EVENTS.DONE,
  ALFABOT_SSE_EVENTS.ERROR,
];
