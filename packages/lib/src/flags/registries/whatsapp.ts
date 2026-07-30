/**
 * WhatsApp Bot flags (2026-07-29, WhatsApp-bot program).
 *
 * The WhatsApp bot is a net-new conversational surface (inbound webhook +
 * outbound template sends) layered on the EXISTING learning engines — it
 * introduces no new scoring/XP/AI behavior of its own. Every capability below
 * is dark-shipped: while a flag is OFF (default for all 11), the corresponding
 * code path is a TRUE no-op and the platform is byte-identical to today.
 *
 *  ff_whatsapp_bot_v1 — MASTER KILL SWITCH for the entire WhatsApp bot
 *    surface. When OFF, no WhatsApp feature runs regardless of the per-feature
 *    flags below (they are evaluated only when the master is ON — per-feature
 *    gating mirrors the ff_adaptive_loops_bc_v1 "per-signal" precedent).
 *    Default: false.
 *
 *  ff_whatsapp_inbound_webhook — gates processing of inbound WhatsApp webhook
 *    deliveries. When OFF, the webhook endpoint acknowledges and discards
 *    (no message processing, no state writes). Default: false.
 *
 *  ff_whatsapp_daily6 — gates the Daily-6 practice loop over WhatsApp (the
 *    daily question drip). When OFF, no daily questions are sent. Default: false.
 *
 *  ff_whatsapp_doubt — gates the doubt-solving conversation flow (student asks
 *    a doubt, bot answers via the existing grounded AI path — P12 posture
 *    unchanged, the bot adds no new unfiltered LLM surface). Default: false.
 *
 *  ff_whatsapp_doubt_cache — gates the doubt-answer response cache in front of
 *    the doubt flow (independent of ff_whatsapp_doubt's ramp — mirrors the
 *    ff_foxy_response_cache_l2_v1 cache-tier precedent). When OFF, every doubt
 *    goes to the live path. Default: false.
 *
 *  ff_whatsapp_ocr — gates image-message OCR (photographed homework/questions
 *    routed through the existing scan-ocr capability). When OFF, image
 *    messages get a text-only fallback reply. Default: false.
 *
 *  ff_whatsapp_notebook — gates the WhatsApp notebook capture flow (saving
 *    bot exchanges into the student's notebook/bookmarks). When OFF, nothing
 *    is saved and no save affordance is offered. Default: false.
 *
 *  ff_whatsapp_board_sprint — gates the board-exam sprint program over
 *    WhatsApp (scheduled revision sprints for board-year students).
 *    When OFF, no sprint messages are sent. Default: false.
 *
 *  ff_whatsapp_parent_weekly — gates the parent weekly progress summary sent
 *    over WhatsApp (extends the existing whatsapp-notify parent-share
 *    posture; P13 — summary metrics only, never raw student PII beyond the
 *    linked parent's own child). When OFF, no weekly summary is sent.
 *    Default: false.
 *
 *  ff_whatsapp_alarm_template — gates the alarm/reminder template sends
 *    (study-time nudges via approved WhatsApp message templates). Template
 *    sends cost money per message, so this stays OFF until the template is
 *    approved and the cost posture is signed off. Default: false.
 *
 *  ff_whatsapp_cost_governor — gates the WhatsApp cost-governor (per-user and
 *    global send budgets + throttling). Ramps independently of the feature
 *    flags above so the governor can be validated in shadow before any paid
 *    send volume exists. Default: false.
 *
 *    All 11 default: false. Seed migration is owned by architect (mirrors the
 *    ff_model_gateway_v1 precedent — REG-125 canonical seed shape). While
 *    absent from feature_flags every read path resolves each flag to OFF.
 *
 *    Protection posture (updated 2026-07-30 — the protected-flags companion
 *    LANDED): the two highest-blast-radius flags, ff_whatsapp_bot_v1 and
 *    ff_whatsapp_alarm_template, ARE now in PROTECTED_FLAGS (tier
 *    'staged_rollout') and EXPECTED_OFF_FLAGS in
 *    packages/lib/src/flags/protected-flags.ts, mirroring their
 *    protected_feature_flags DB rows seeded by migration 20260801100500 —
 *    the DB⊃TS drift that seed's header documented is CLOSED, before any
 *    first flip. They are console-protected (typed-confirmation guardrail),
 *    DB-guard-trigger protected, and nightly-canary watched; flips go only
 *    via admin_flip_feature_flag with CEO approval per rollout step.
 *
 *    The OTHER NINE remain normal staged-rollout flags (NOT
 *    constitution-pinned): mirrors the ff_model_gateway_v1 /
 *    ff_unified_memory_v1 / ff_foxy_response_cache_l2_v1 precedent — they
 *    live in FLAG_DEFAULTS as false and are intentionally NOT added to
 *    EXPECTED_OFF_FLAGS / PROTECTED_FLAGS (every member of those lists must
 *    be console-protected and mirrored into protected_feature_flags in the
 *    same change).
 */
export const WHATSAPP_BOT_FLAGS = {
  /** Master kill switch for the entire WhatsApp bot surface. Default off. */
  V1: 'ff_whatsapp_bot_v1',
  /** Inbound WhatsApp webhook message processing. Default off = ack-and-discard. */
  INBOUND_WEBHOOK: 'ff_whatsapp_inbound_webhook',
  /** Daily-6 practice loop over WhatsApp. Default off. */
  DAILY6: 'ff_whatsapp_daily6',
  /** Doubt-solving conversation flow (existing grounded AI path). Default off. */
  DOUBT: 'ff_whatsapp_doubt',
  /** Doubt-answer response cache tier (independent ramp). Default off. */
  DOUBT_CACHE: 'ff_whatsapp_doubt_cache',
  /** Image-message OCR via the existing scan-ocr capability. Default off. */
  OCR: 'ff_whatsapp_ocr',
  /** Notebook capture of bot exchanges. Default off. */
  NOTEBOOK: 'ff_whatsapp_notebook',
  /** Board-exam sprint program over WhatsApp. Default off. */
  BOARD_SPRINT: 'ff_whatsapp_board_sprint',
  /** Parent weekly progress summary over WhatsApp. Default off. */
  PARENT_WEEKLY: 'ff_whatsapp_parent_weekly',
  /** Alarm/reminder template sends (paid template messages). Default off. */
  ALARM_TEMPLATE: 'ff_whatsapp_alarm_template',
  /** WhatsApp cost-governor (send budgets + throttling). Default off. */
  COST_GOVERNOR: 'ff_whatsapp_cost_governor',
} as const;
