/**
 * AlfaBot PostHog event taxonomy (PR 4 of the AlfaBot feature).
 *
 * Single source of truth for the 9 PostHog events emitted by the AlfaBot
 * widget (PR 3) and one server-side counterpart. Pure documentation — no
 * runtime impact. Imported by:
 *   - the AlfaBot widget tests (PR 3) to assert events fire correctly
 *   - the super-admin dashboard if/when we wire a PostHog tile into it
 *   - dashboards in PostHog itself (the names below MUST match the PostHog
 *     event filter expressions exactly).
 *
 * P13 contract: NO event property may carry email, phone, name, IP, raw
 * anon_id (we send `anonIdPrefix` only, first 8 chars), or message content.
 * The redactor in `src/lib/posthog/server.ts` enforces this on the server
 * side; the client widget enforces it by never passing those fields.
 *
 * Owner: ops
 * Reviewers: backend (event firing sites), testing (assertion targets)
 */

// ─── Event names ────────────────────────────────────────────────────────────

export type AlfabotEventName =
  | 'alfabot_widget_loaded'         // launcher rendered, before first open
  | 'alfabot_opened'                // user clicked the launcher / opened panel
  | 'alfabot_closed'                // user dismissed the panel
  | 'alfabot_starter_chip_clicked'  // user picked an audience starter prompt
  | 'alfabot_message_sent'          // user submitted a message
  | 'alfabot_response_received'     // assistant reply rendered (success + abstain)
  | 'alfabot_rate_limited'          // server returned 429 / rate-limited envelope
  | 'alfabot_lead_submitted'        // lead capture form succeeded
  | 'alfabot_escape_hatch_clicked'; // user clicked "need a human" CTA

export const ALFABOT_EVENTS: readonly AlfabotEventName[] = [
  'alfabot_widget_loaded',
  'alfabot_opened',
  'alfabot_closed',
  'alfabot_starter_chip_clicked',
  'alfabot_message_sent',
  'alfabot_response_received',
  'alfabot_rate_limited',
  'alfabot_lead_submitted',
  'alfabot_escape_hatch_clicked',
] as const;

// ─── Common properties (auto-attached to every AlfaBot event) ───────────────

export interface AlfabotCommonProps {
  /** First 8 chars of anon_id only — never the full cookie value (P13). */
  anonIdPrefix: string;
  /** Current widget audience selector. */
  audience: 'parent' | 'student' | 'teacher' | 'school';
  /** Current widget language. */
  lang: 'en' | 'hi';
  /** Active session id when the event refers to a turn; null on launcher events. */
  sessionId: string | null;
}

// ─── Per-event payloads ─────────────────────────────────────────────────────

export interface AlfabotWidgetLoadedProps extends AlfabotCommonProps {
  /** ms since pageload to first paint of the launcher bubble. */
  msToLaunch?: number;
}

export interface AlfabotOpenedProps extends AlfabotCommonProps {
  /** ms since pageload OR since `alfabot_widget_loaded`. */
  msToOpen?: number;
  /** True when the user opened via keyboard, not pointer. */
  viaKeyboard?: boolean;
}

export type AlfabotClosedProps = AlfabotCommonProps;

export interface AlfabotStarterChipClickedProps extends AlfabotCommonProps {
  /** Identifier for the chip (e.g. 'parent.pricing', 'student.what_is_foxy'). */
  chipId: string;
}

export interface AlfabotMessageSentProps extends AlfabotCommonProps {
  /** Length of the user message in characters (NOT the text). */
  messageLength: number;
  /** Position in the session, 1-based. */
  turnIndex: number;
}

export interface AlfabotResponseReceivedProps extends AlfabotCommonProps {
  /** Per-turn latency from POST → final SSE frame. */
  latencyMs: number;
  /** Token total (input + output) as reported by the Edge Function. */
  tokensUsed: number;
  /** True when the bot ran in FAQ-only budget-degraded mode. */
  degradedMode: boolean;
  /** Number of KB chunks the model cited. */
  sourcesUsed: number;
  /** Discriminated abstain reason if the turn was a refusal; else null. */
  abstainReason: string | null;
  /** Model id (e.g. 'gpt-4o-mini'). */
  model: string;
  /** True when the response arrived via the SSE streaming path. */
  streamed: boolean;
}

export interface AlfabotRateLimitedProps extends AlfabotCommonProps {
  /** Which limiter blocked. */
  scope: 'burst' | 'day' | 'ip' | 'session_max' | 'lead';
  /** Seconds until the bucket refills (rounded). */
  resetSeconds: number | null;
}

export interface AlfabotLeadSubmittedProps extends AlfabotCommonProps {
  /** Length of the email string only — never the email itself. */
  emailLength: number;
  /** True when the visitor also gave a phone. */
  hadPhone: boolean;
  /** True when the visitor also gave a name. */
  hadName: boolean;
  /** True only for `audience='school'` submissions. */
  hadSchoolName: boolean;
}

export interface AlfabotEscapeHatchClickedProps extends AlfabotCommonProps {
  /** Where the click routed: '/contact' or 'whatsapp'. */
  destination: 'contact' | 'whatsapp';
}

// ─── Event → payload map ────────────────────────────────────────────────────

/**
 * Type-level mapping used by the widget's `track()` wrapper to keep payloads
 * matched to event names. Tests can also use this to assert per-event shape.
 */
export type AlfabotEventPropsByName = {
  alfabot_widget_loaded: AlfabotWidgetLoadedProps;
  alfabot_opened: AlfabotOpenedProps;
  alfabot_closed: AlfabotClosedProps;
  alfabot_starter_chip_clicked: AlfabotStarterChipClickedProps;
  alfabot_message_sent: AlfabotMessageSentProps;
  alfabot_response_received: AlfabotResponseReceivedProps;
  alfabot_rate_limited: AlfabotRateLimitedProps;
  alfabot_lead_submitted: AlfabotLeadSubmittedProps;
  alfabot_escape_hatch_clicked: AlfabotEscapeHatchClickedProps;
};

// ─── PII allowlist (negative — what MUST NEVER appear) ──────────────────────

/**
 * Keys that must NEVER appear in any AlfaBot PostHog event payload. The
 * redactor in `src/lib/posthog/server.ts` strips these even if a caller
 * accidentally passes them; the list below documents the contract for
 * humans + tests.
 */
export const ALFABOT_FORBIDDEN_PROPERTY_KEYS = [
  'email',
  'phone',
  'name',
  'full_name',
  'ip',
  'ip_address',
  'anon_id',         // only `anonIdPrefix` (8 chars) is allowed
  'message',         // no message content
  'message_text',
  'content',
  'school_name',     // counts only via `hadSchoolName`
  'school_id',
] as const;
