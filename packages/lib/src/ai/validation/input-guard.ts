/**
 * Input Guard — lightweight prompt-injection heuristic for the STUDENT MESSAGE
 * before prompt assembly (FOX-2, engineering-audit Cycle 4).
 *
 * WHY THIS EXISTS
 * ---------------
 * The grounded pipeline sanitizes retrieved RAG CHUNKS (`sanitizeChunkForPrompt`)
 * because a poisoned NCERT chunk could carry "ignore previous instructions".
 * The student's own message, however, was passed VERBATIM as the user turn —
 * leaving a residual jailbreak surface on the free-text path.
 *
 * This is a DELIBERATELY CONSERVATIVE, high-precision neutralizer: it strips
 * only assistant-directed override phrases ("ignore your previous
 * instructions", "reveal your system prompt", "you are now a ...") and leaves
 * everything else untouched. It MUST NOT mangle legitimate questions — e.g.
 * "ignore the negative root", "forget the units for now", "what is a system?"
 * are all preserved, because the patterns require an explicit reference to the
 * assistant's instructions/prompt/rules.
 *
 * It is a defense-in-depth layer, NOT the primary guard: server-side
 * grade/subject scope, the structured-output contract, `FOXY_SAFETY_RAILS`, and
 * the output screen (FOX-1) remain the real backstops.
 *
 * P13: pure string transform; callers log a boolean/category only, never text.
 */

/**
 * Assistant-directed override patterns. Each requires an explicit reference to
 * the assistant's INSTRUCTIONS / PROMPT / RULES / PERSONA, so bare words like
 * "ignore", "forget", "system" in ordinary curriculum questions do not match.
 * Global + case-insensitive so every occurrence in the message is neutralized.
 */
const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  // "ignore / disregard / forget (all/your/the) previous|above|prior
  //  instructions|prompt|rules|context|directions"
  /\b(?:ignore|disregard|forget|override)\b[^.?!\n]*?\b(?:previous|prior|above|earlier|preceding|all|your|the|system)\b[^.?!\n]*?\b(?:instruction|instructions|prompt|prompts|rule|rules|context|direction|directions|guideline|guidelines|message|messages)\b/gi,
  // "reveal / show / print / repeat / output (your) (system) prompt|instructions"
  /\b(?:reveal|show|print|repeat|output|display|expose|leak)\b[^.?!\n]*?\b(?:system\s+)?(?:prompt|instructions|rules)\b/gi,
  // "you are now a/an/no longer ..." persona override
  /\byou\s+are\s+now\s+(?:a|an|no\s+longer|not)\b/gi,
  // explicit "new instructions:" / "new system prompt:" injection lead-in
  /\bnew\s+(?:system\s+)?(?:instructions?|prompt)\s*[:>-]/gi,
  // chat/template role tokens fed inside a user message
  /<<\s*sys\s*>>/gi,
  /\[\/?\s*inst\s*\]/gi,
  /<\|im_(?:start|end)\|>/gi,
];

export interface InputGuardResult {
  /** The message with any injection-override spans neutralized. */
  text: string;
  /** True when at least one injection pattern fired. */
  neutralized: boolean;
}

/**
 * Neutralize assistant-directed prompt-injection overrides in a student
 * message. Pure, synchronous, never throws. On a strong match the offending
 * span is replaced with a single space (content is not otherwise altered), so a
 * legitimate question is preserved even in the rare event of a partial match.
 *
 * Returns the original text unchanged (and `neutralized:false`) for the
 * overwhelming common case of a normal question.
 */
export function neutralizeInjectionAttempt(message: string): InputGuardResult {
  try {
    if (typeof message !== 'string' || message.length === 0) {
      return { text: typeof message === 'string' ? message : '', neutralized: false };
    }

    let neutralized = false;
    let out = message;
    for (const pattern of INJECTION_PATTERNS) {
      out = out.replace(pattern, () => {
        neutralized = true;
        return ' ';
      });
    }

    if (!neutralized) return { text: message, neutralized: false };

    // Collapse the whitespace we introduced; keep the rest of the message.
    out = out.replace(/[ \t]{2,}/g, ' ').trim();
    // Never return an empty query (would confuse downstream length checks) —
    // fall back to a neutral, in-scope nudge if the message was ENTIRELY
    // injection text.
    if (out.length === 0) out = 'Please help me with this topic.';
    return { text: out, neutralized: true };
  } catch {
    // Fail-open on the INPUT side: a heuristic failure must not break the turn.
    // The OUTPUT screen (FOX-1) is the hard backstop regardless of input.
    return { text: message, neutralized: false };
  }
}
