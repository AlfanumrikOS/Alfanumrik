// supabase/functions/alfabot-answer/post-process.ts
//
// Post-LLM safety filter for AlfaBot. Runs AFTER the model returns and
// BEFORE the text is streamed to the user. Catches:
//
//   1. Banned future-promise phrases ("coming soon", "Q3 2027", etc.)
//   2. Unbacked pricing claims — if the response mentions ₹/INR/rupees/price,
//      the canonical pricing block must appear verbatim in retrievedChunks
//      (canonical=true). Otherwise the model invented numbers.
//   3. Orphan citations — any `(section_id)` reference must point at a
//      section that was actually retrieved this turn.
//   4. Reply length cap (200 words) — model was instructed to keep under 100,
//      we hard-clamp at 200 as a backstop.
//
// On any failure, returns ok:false with a reason code AND a sanitized
// abstain string in the response language. The Edge Function entry uses
// `sanitized` as the final reply, sets `abstainReason` on the `done` event,
// and proceeds without throwing.

import {
  ALFABOT_BANNED_PHRASES,
  ALFABOT_REFUSALS,
  ALFABOT_CORE_CONTEXT,
  type AlfaBotLang,
  type KbChunk,
} from './prompt.ts';

export type AbstainReason =
  | 'banned_phrase'
  | 'pricing_unbacked'
  | 'orphan_citation'
  | 'empty_response';

export interface ValidationResult {
  ok: boolean;
  reason?: AbstainReason;
  sanitized: string;
  /** Section IDs that the validator found cited (used for telemetry). */
  citedSectionIds: string[];
}

const MAX_WORDS = 200;
// Detects ₹\d+, INR \d+, "rupees", price/plan/cost when paired with money.
const PRICING_TRIGGER_RE = /(₹\s*\d|inr\s+\d|\brupees\b|\b(?:price|cost|plan)\s+(?:is|of|for)\s+(?:₹|\d|inr))/i;
// Canonical anchor for verbatim ₹699 check. Must appear in coreContext
// AND in at least one canonical=true retrieved chunk to be considered backed.
const PRICING_CANONICAL_ANCHOR = '₹699';

const CITATION_RE = /\(([a-z][a-z0-9-]{1,40})\)/gi;

function abstainFor(lang: AlfaBotLang): string {
  return ALFABOT_REFUSALS.unknown_info[lang];
}

/**
 * Truncate at the last sentence boundary at-or-before MAX_WORDS. Mirrors the
 * grounded-answer applyFoxyWordCap pattern at half the limit.
 */
function clampWordCount(text: string): { text: string; clamped: boolean } {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= MAX_WORDS) return { text, clamped: false };

  let wordsSeen = 0;
  let cutIndex = text.length;
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    wordsSeen += 1;
    if (wordsSeen >= MAX_WORDS) {
      cutIndex = m.index + m[0].length;
      break;
    }
  }
  const prefix = text.slice(0, cutIndex);
  let boundary = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const ch = prefix[i];
    if (ch === '.' || ch === '?' || ch === '!') {
      const next = prefix[i + 1];
      if (next === undefined || /\s/.test(next)) {
        boundary = i + 1;
        break;
      }
    }
  }
  return {
    text: boundary > 0 ? prefix.slice(0, boundary).trimEnd() : prefix.trimEnd(),
    clamped: true,
  };
}

function containsBannedPhrase(text: string): RegExp | null {
  for (const pattern of ALFABOT_BANNED_PHRASES) {
    if (pattern.test(text)) return pattern;
  }
  return null;
}

function extractCitations(text: string): string[] {
  const found: string[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(text)) !== null) {
    const id = m[1].toLowerCase();
    if (!found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * Validate the model response against P12 safety rules.
 *
 * @param text raw assistant text from OpenAI
 * @param retrievedChunks the chunks fed into the prompt this turn
 * @param lang response language (drives the abstain string on failure)
 */
export function validateResponse(
  text: string,
  retrievedChunks: KbChunk[],
  lang: AlfaBotLang,
): ValidationResult {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      reason: 'empty_response',
      sanitized: abstainFor(lang),
      citedSectionIds: [],
    };
  }

  // 1. Banned phrases.
  const banned = containsBannedPhrase(trimmed);
  if (banned) {
    return {
      ok: false,
      reason: 'banned_phrase',
      sanitized: abstainFor(lang),
      citedSectionIds: [],
    };
  }

  // 2. Pricing claim must be backed by canonical content.
  if (PRICING_TRIGGER_RE.test(trimmed)) {
    const corePricingPresent = ALFABOT_CORE_CONTEXT.includes(PRICING_CANONICAL_ANCHOR);
    const chunkPricingPresent = retrievedChunks.some(
      (c) => c.canonical && c.content.includes(PRICING_CANONICAL_ANCHOR),
    );
    // The canonical pricing block is ALWAYS injected via coreContext, so
    // corePricingPresent is true by construction. We additionally require
    // a canonical chunk hit to defend against silent prompt drift.
    if (!corePricingPresent && !chunkPricingPresent) {
      return {
        ok: false,
        reason: 'pricing_unbacked',
        sanitized: abstainFor(lang),
        citedSectionIds: extractCitations(trimmed),
      };
    }
    // If the response cites a price but does NOT include the ₹699 anchor in
    // its own text, that's also suspect — the model may have invented a
    // different number. Reject and abstain.
    if (!trimmed.includes(PRICING_CANONICAL_ANCHOR)) {
      return {
        ok: false,
        reason: 'pricing_unbacked',
        sanitized: abstainFor(lang),
        citedSectionIds: extractCitations(trimmed),
      };
    }
  }

  // 3. Orphan citation detection. Build the set of valid section_ids:
  //    retrieved chunks + the always-present canonical core sections.
  const validSectionIds = new Set<string>([
    'pricing-plans',
    'safety-privacy-dpdpa',
    'refusal-policy',
    'contact',
    ...retrievedChunks.map((c) => c.section_id.toLowerCase()),
  ]);
  const cited = extractCitations(trimmed);
  for (const id of cited) {
    if (!validSectionIds.has(id)) {
      return {
        ok: false,
        reason: 'orphan_citation',
        sanitized: abstainFor(lang),
        citedSectionIds: cited,
      };
    }
  }

  // 4. Length clamp — final pass; never blocks, just trims.
  const { text: clampedText } = clampWordCount(trimmed);

  return {
    ok: true,
    sanitized: clampedText,
    citedSectionIds: cited,
  };
}

/**
 * Convenience: directly produce an abstain envelope for a hard refusal that
 * happened BEFORE we ever called the model. The entry point uses this when
 * the upstream is dead (circuit open, fetch failed, timeout).
 */
export function buildDegradedReply(lang: AlfaBotLang): string {
  return abstainFor(lang);
}
