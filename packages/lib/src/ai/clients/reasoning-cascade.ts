/**
 * Foxy Reasoning Cascade (Foxy Reasoning v2 — Phase 1)
 *
 * A cross-provider AVAILABILITY cascade for reasoning-grade calls. Three tiers,
 * tried in order from a configurable start tier:
 *
 *   base     → gpt-4o-mini  (OpenAI, real-time / cheapest)
 *   escalate → gpt-4o       (OpenAI, full model)
 *   last      → Claude Haiku (the EXISTING `callClaude` client)
 *
 * The cascade serves two ROLES that must not be conflated:
 *   1. AVAILABILITY fallback — handled HERE: on ANY error/empty result from a
 *      tier, advance to the next tier. This protects against a single provider
 *      being down/rate-limited; Haiku is the always-present last resort.
 *   2. QUALITY escalation — handled by the CALLER (e.g. the math pipeline calls
 *      back in at a higher `startTier` after a SymPy verifier mismatch). The
 *      cascade itself does not re-verify; it just runs from the requested tier.
 *
 * P13: tier-transition logs carry the from/to tier names ONLY — never the
 * prompt, the messages, or any student identifier.
 *
 * Owner: ai-engineer. Review: assessment (correctness), testing.
 */

import { callOpenAI, OPENAI_MINI_MODEL, OPENAI_FULL_MODEL } from './openai';
import { callClaude } from './claude';
import { logger } from '@alfanumrik/lib/logger';

// ─── Tiers ───────────────────────────────────────────────────────────────────

/** base=gpt-4o-mini, escalate=gpt-4o, last=Claude Haiku. */
export type CascadeTier = 'base' | 'escalate' | 'last';

const TIER_ORDER: CascadeTier[] = ['base', 'escalate', 'last'];

// ─── Public Types ─────────────────────────────────────────────────────────-

export interface ReasoningRequest {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}

export interface ReasoningResult {
  content: string;
  model: string;
  tokensUsed: number;
  tier: CascadeTier;
}

// ─── Per-Tier Dispatch ────────────────────────────────────────────────────-

/**
 * Run ONE tier. Returns a ReasoningResult on success; THROWS on failure/empty so
 * `callReasoningModel` can advance to the next tier.
 *
 * - base/escalate → callOpenAI (mini/full). jsonMode is honoured natively.
 * - last → callClaude (Haiku). Claude has no `response_format` json_object mode,
 *   so jsonMode is intentionally NOT forwarded — the prompt already instructs
 *   the model to emit JSON (math solver + classifier prompts both do).
 */
async function runTier(tier: CascadeTier, req: ReasoningRequest): Promise<ReasoningResult> {
  if (tier === 'base' || tier === 'escalate') {
    const result = await callOpenAI({
      model: tier === 'base' ? OPENAI_MINI_MODEL : OPENAI_FULL_MODEL,
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      timeoutMs: req.timeoutMs,
      jsonMode: req.jsonMode,
    });
    return { content: result.content, model: result.model, tokensUsed: result.tokensUsed, tier };
  }

  // tier === 'last' — Claude Haiku via the existing client.
  const result = await callClaude({
    systemPrompt: req.systemPrompt,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    timeoutMs: req.timeoutMs,
    // No model override → callClaude uses its own Haiku→Sonnet config chain.
    // jsonMode is NOT a Claude concept; the prompt carries the JSON instruction.
  });

  const content = result.content ?? '';
  if (!content.trim()) {
    // Treat an empty Claude completion the same as an OpenAI empty completion:
    // a tier failure (there is no further tier, so this surfaces as the final
    // throw in callReasoningModel).
    throw new Error('Claude returned empty content');
  }

  return { content, model: result.model, tokensUsed: result.tokensUsed, tier };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the reasoning cascade from `opts.startTier` (default 'base') to 'last'.
 *
 * For each tier from the start tier onward: try it; on ANY error/empty, log the
 * transition and advance to the next tier. Returns the first success with the
 * tier that produced it. If ALL tiers from the start fail, THROWS.
 */
export async function callReasoningModel(
  req: ReasoningRequest,
  opts?: { startTier?: CascadeTier },
): Promise<ReasoningResult> {
  const startTier = opts?.startTier ?? 'base';
  const startIdx = TIER_ORDER.indexOf(startTier);
  const tiers = TIER_ORDER.slice(startIdx === -1 ? 0 : startIdx);

  let lastError = 'reasoning cascade unavailable';

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    try {
      return await runTier(tier, req);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const nextTier = tiers[i + 1];
      if (nextTier) {
        // P13: tier names only — never prompt/messages/identifiers.
        logger.warn('foxy.reasoning.tier_fallback', {
          fromTier: tier,
          toTier: nextTier,
        });
      }
      // else: no next tier — fall out of the loop and throw below.
    }
  }

  throw new Error(`Reasoning cascade exhausted: ${lastError}`);
}
