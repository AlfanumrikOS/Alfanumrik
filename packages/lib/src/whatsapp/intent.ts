/**
 * ALFANUMRIK — WhatsApp inbound intent classifier.
 *
 * Finite intent set, NO LLM routing. Pure functions — no I/O, fully
 * unit-testable. Resolution order (first match wins), per the WhatsApp bot
 * plan (`plan-alfanumrik-whatsapp-bot-mighty-frost.md`, "Conversation state
 * machine"):
 *
 *   1. Interactive reply id (`ButtonPayload`) — a private opcode space we
 *      author ourselves: `d6:a:<n>`, `d6:q`, `db:next`, `db:stuck`,
 *      `db:got`, `nb:rt:<id>`, `sw:<student_id>`, `menu`.
 *   2. Keyword table with Hindi/Hinglish aliases (STOP/BAND/ROKO/रोको/बंद, ...)
 *      — case-, whitespace-, and Unicode-normalization-insensitive (NFC).
 *      Bare START is OPT-IN, not menu.
 *   3. Message type — media image → doubt_image; other media → unsupported.
 *   4. State-directed fallback — free text becomes a doubt when idle /
 *      awaiting a doubt, but mid-Daily-6 it nudges back to the list
 *      (free text mid-set must NOT become a doubt).
 */

import { normalizeWaPhone } from './phone';

/** Conversation-session states relevant to classification (Phase 1 subset). */
export type WaSessionState =
  | 'idle'
  | 'awaiting_doubt'
  | 'daily6_active'
  | 'doubt_ladder_active';

export type WaIntent =
  // Regulatory / control keywords (always take precedence over state)
  | 'stop'
  | 'start'
  | 'help'
  // Identity
  | 'link'
  | 'unlink'
  | 'switch_student'
  // Navigation
  | 'menu'
  | 'set_language'
  // Daily 6
  | 'd6_answer'
  | 'd6_quit'
  | 'd6_nudge'
  // Doubt ladder
  | 'db_next'
  | 'db_stuck'
  | 'db_got'
  // Mistake notebook
  | 'nb_retest'
  // Free-form
  | 'doubt_text'
  | 'doubt_image'
  | 'unsupported';

export interface WaClassification {
  intent: WaIntent;
  args: Record<string, string>;
}

/**
 * Provider-agnostic normalized inbound message. Built from Twilio params by
 * `parseInbound`; a future Meta-direct adapter maps to the same shape.
 */
export interface NormalizedInbound {
  messageSid: string;
  phoneE164: string;
  /** E.164 digits, no `+` or `whatsapp:` prefix (Twilio `WaId`). */
  waId: string;
  body: string;
  buttonPayload?: string;
  numMedia: number;
  mediaUrl0?: string;
  mediaContentType0?: string;
  profileName?: string;
  referralSourceId?: string;
}

/**
 * Parse raw Twilio webhook params into a NormalizedInbound.
 * Returns null when MessageSid or a valid From phone is missing.
 */
export function parseInbound(params: Record<string, string>): NormalizedInbound | null {
  const messageSid = params.MessageSid || params.SmsMessageSid || '';
  const phoneE164 = normalizeWaPhone(params.From ?? '');
  if (!messageSid || !phoneE164) return null;

  const waId =
    params.WaId && /^[1-9]\d{6,14}$/.test(params.WaId) ? params.WaId : phoneE164.slice(1);

  const parsedNumMedia = Number.parseInt(params.NumMedia ?? '0', 10);
  const numMedia = Number.isFinite(parsedNumMedia) && parsedNumMedia > 0 ? parsedNumMedia : 0;

  return {
    messageSid,
    phoneE164,
    waId,
    body: params.Body ?? '',
    buttonPayload: params.ButtonPayload || undefined,
    numMedia,
    mediaUrl0: params.MediaUrl0 || undefined,
    mediaContentType0: params.MediaContentType0 || undefined,
    profileName: params.ProfileName || undefined,
    referralSourceId: params.ReferralSourceId || undefined,
  };
}

/**
 * NFC-normalize, trim, collapse internal whitespace, uppercase — the
 * keyword-tier canon. NFC comes first so composed and decomposed Devanagari
 * input both canonicalize to the same string. NOTE: `.toUpperCase()` is a
 * no-op for Devanagari — matching below is exact-string against canonicalized
 * alias literals and must never depend on case folding for non-Latin scripts.
 */
function canonBody(body: string): string {
  return body.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Control-keyword alias sets. Latin/Hinglish transliterations plus Devanagari
 * forms. Literals are passed through canonBody so set members are guaranteed
 * NFC/whitespace/case-canonical regardless of how this source file is encoded.
 */
const STOP_ALIASES = new Set(
  ['STOP', 'BAND', 'ROKO', 'UNSUBSCRIBE', 'रोको', 'बंद', 'बंद करो'].map(canonBody),
);
const START_ALIASES = new Set(['START', 'SHURU', 'शुरू', 'शुरू करो', 'चालू'].map(canonBody));
const HELP_ALIASES = new Set(['HELP', 'MADAD', 'मदद', 'सहायता'].map(canonBody));

/**
 * Keyword-tier-only classification of the regulatory control keywords.
 *
 * The webhook calls this FIRST, before session lookup, before flags, before
 * anything else — STOP/START/HELP must work even if the session is corrupt,
 * the identity unbound, or `ff_whatsapp_bot_v1` is off. Regulatory, not
 * product.
 */
export function classifyControlKeyword(body: string): 'stop' | 'start' | 'help' | null {
  const b = canonBody(body);
  if (STOP_ALIASES.has(b)) return 'stop';
  if (START_ALIASES.has(b)) return 'start';
  if (HELP_ALIASES.has(b)) return 'help';
  return null;
}

/** Full keyword table (tier 2). Returns null when nothing matches. */
function classifyKeyword(body: string): WaClassification | null {
  const control = classifyControlKeyword(body);
  if (control) return { intent: control, args: {} };

  const b = canonBody(body);

  const linkMatch = /^LINK (\d{4,8})$/.exec(b);
  if (linkMatch) return { intent: 'link', args: { otp: linkMatch[1] } };
  if (b === 'UNLINK') return { intent: 'unlink', args: {} };

  // NOTE: bare START is opt-in (handled by classifyControlKeyword above),
  // deliberately NOT part of the menu alias set.
  if (b === 'MENU' || b === 'HI' || b === 'HELLO' || b === 'NAMASTE') {
    return { intent: 'menu', args: {} };
  }

  if (b === 'HINDI') return { intent: 'set_language', args: { locale: 'hi' } };
  if (b === 'ENGLISH') return { intent: 'set_language', args: { locale: 'en' } };

  return null;
}

/** Tier 1: the ButtonPayload opcode space we author ourselves. */
function classifyButtonPayload(payload: string): WaClassification | null {
  const p = payload.trim();

  const d6Answer = /^d6:a:(\d+)$/.exec(p);
  if (d6Answer) return { intent: 'd6_answer', args: { answer: d6Answer[1] } };
  if (p === 'd6:q') return { intent: 'd6_quit', args: {} };

  if (p === 'db:next') return { intent: 'db_next', args: {} };
  if (p === 'db:stuck') return { intent: 'db_stuck', args: {} };
  if (p === 'db:got') return { intent: 'db_got', args: {} };

  const nbRetest = /^nb:rt:(.+)$/.exec(p);
  if (nbRetest) return { intent: 'nb_retest', args: { id: nbRetest[1] } };

  const switchStudent = /^sw:(.+)$/.exec(p);
  if (switchStudent) return { intent: 'switch_student', args: { student_id: switchStudent[1] } };

  if (p === 'menu') return { intent: 'menu', args: {} };

  // Unknown opcode → fall through to the keyword tier (Twilio duplicates
  // ButtonText into Body, so the text tiers still get a shot).
  return null;
}

/**
 * Classify an inbound message. Pure — no I/O.
 * See the module header for the four-tier resolution order.
 */
export function classifyIntent(
  msg: NormalizedInbound,
  state: WaSessionState,
): WaClassification {
  // Tier 1 — interactive reply opcode.
  if (msg.buttonPayload) {
    const fromPayload = classifyButtonPayload(msg.buttonPayload);
    if (fromPayload) return fromPayload;
  }

  // Tier 2 — keyword table (Hindi/Hinglish aliases included).
  const fromKeyword = classifyKeyword(msg.body);
  if (fromKeyword) return fromKeyword;

  // Tier 3 — message type.
  if (msg.numMedia > 0) {
    if (msg.mediaContentType0 && msg.mediaContentType0.toLowerCase().startsWith('image/')) {
      return { intent: 'doubt_image', args: {} };
    }
    // Audio / video / document / sticker → one canned reply, never an LLM call.
    return { intent: 'unsupported', args: {} };
  }

  // Empty non-media message (e.g. location-only, reactions) → unsupported.
  if (!msg.body.trim()) return { intent: 'unsupported', args: {} };

  // Tier 4 — state-directed fallback for free text.
  if (state === 'daily6_active') {
    // Free text mid-Daily-6 nudges back to the list — it does NOT become a doubt.
    return { intent: 'd6_nudge', args: {} };
  }
  return { intent: 'doubt_text', args: {} };
}
