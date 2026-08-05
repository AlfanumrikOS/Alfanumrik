/**
 * Safeguarding Classify — Tier-2 LLM confirmation of a Tier-1 regex hit
 * (Foxy North-Star Phase 1, S5.6/U6; companion to safeguarding-screen.ts).
 *
 * FLOW: screenForSafeguarding() (Tier 1, high recall) fires → THIS classifier
 * (precision) renders {confirmed, category, confidence} via the model gateway.
 * Only called AFTER a Tier-1 hit — never on ordinary tutoring turns, so the
 * added latency/cost applies to a tiny fraction of traffic.
 *
 * FAIL-CLOSED (deliberate inversion of the input-guard fail-open rule): a
 * Tier-1 hit means a child MAY have disclosed harm. If the gateway errors,
 * times out, or returns unparseable JSON, we CONFIRM with tier 'regex_only'
 * and confidence 0 — the student still gets the safe supportive response and
 * the escalation row honestly records that no LLM verdict backed it. A missed
 * escalation is a worse failure than a false positive reviewed by a human
 * (spec risk table: "Conservative thresholds, human review").
 *
 * P12/P13: the student message goes to the model exactly as it would on a
 * normal tutoring turn — no student identifiers are added (sessionMood is an
 * anonymous token). Callers log category/confirmed/tier only, never text.
 * PR2 boundary: the classifier TRIAGES, it never diagnoses — see
 * NO_DIAGNOSIS_BOUNDARY_NOTE injected into the system prompt.
 *
 * Owner: ai-engineer. Threshold/prompt changes reviewed by assessment.
 */

import { callModel } from '@alfanumrik/lib/ai/gateway/gateway';
import { NO_DIAGNOSIS_BOUNDARY_NOTE } from '@alfanumrik/lib/policy/prohibited-inferences';
import type { SafeguardingCategory } from './safeguarding-screen';

export interface SafeguardingClassification {
  /** True when the model confirmed a genuine disclosure (or we failed closed). */
  confirmed: boolean;
  /** Confirmed category; null when the model cleared the message. */
  category: SafeguardingCategory | null;
  /** Model confidence 0-1 (0 on the fail-closed path). */
  confidence: number;
  /** 'llm_confirmed' = a model verdict was obtained; 'regex_only' = fail-closed on Tier-1 alone. */
  tier: 'llm_confirmed' | 'regex_only';
}

export interface ClassifySafeguardingOptions {
  /**
   * Session mood token from the SEL check-in (e.g. 'stressed'), if any.
   * A CONTEXT PRIOR only: it may raise the model's confidence in an ambiguous
   * disclosure, but is NEVER sufficient to confirm on its own (the prompt says
   * so explicitly). Sanitized to a short word before prompt injection.
   */
  sessionMood?: string | null;
  /** Tier-1 categories that fired (non-empty by contract; [0] = most severe). */
  categories: SafeguardingCategory[];
}

/** Conservative confirmation floor: the model must be ≥ 0.7 sure. */
export const SAFEGUARDING_CONFIRM_THRESHOLD = 0.7;

const VALID_CATEGORIES: readonly SafeguardingCategory[] = [
  'self_harm',
  'abuse',
  'violence',
  'acute_distress',
];

function isSafeguardingCategory(v: unknown): v is SafeguardingCategory {
  return typeof v === 'string' && (VALID_CATEGORIES as readonly string[]).includes(v);
}

/** Only a plain short token may enter the prompt as mood (injection hygiene). */
function sanitizeMood(mood: string | null | undefined): string | null {
  if (typeof mood !== 'string') return null;
  const t = mood.trim().toLowerCase();
  return /^[a-z][a-z_ -]{0,31}$/.test(t) ? t : null;
}

function buildSystemPrompt(mood: string | null, categories: SafeguardingCategory[]): string {
  return [
    'You are a child-safety triage classifier for an educational tutoring app',
    'serving students in grades 6-12 (roughly ages 11-18) in India. A fast',
    'keyword screen flagged the following student message as a possible',
    `safeguarding disclosure in these categories: ${categories.join(', ')}.`,
    '',
    'Your ONLY job: decide whether the message is a GENUINE first-person',
    'disclosure of risk, versus an academic/curriculum question, a quote from a',
    'textbook or story, song lyrics, a joke/hyperbole about homework, or a',
    'question about somebody in a lesson.',
    '',
    'Categories:',
    '- self_harm: the student expresses wanting to die, hurt themselves, or end their life.',
    '- abuse: the student discloses being hit, beaten, or touched inappropriately.',
    '- violence: the student threatens to harm others, or reports being threatened.',
    '- acute_distress: the student expresses being unable to cope / hopelessness, without explicit self-harm intent.',
    '',
    mood
      ? `Context prior: the student self-reported mood "${mood}" at session start. ` +
        'A stressed/sad mood may RAISE your confidence in an ambiguous disclosure, ' +
        'but a mood alone is NEVER sufficient to confirm — the message itself must disclose risk.'
      : 'No session-mood context is available.',
    '',
    NO_DIAGNOSIS_BOUNDARY_NOTE,
    '',
    'Respond with STRICT JSON only — no prose, no markdown fences:',
    '{"confirmed": <boolean>, "category": <one of "self_harm"|"abuse"|"violence"|"acute_distress" or null>, "confidence": <number 0-1>}',
    'Set confirmed=true ONLY for a genuine disclosure. When confirmed=false use',
    'category=null. Confidence is YOUR certainty in the confirmed/cleared call.',
  ].join('\n');
}

/**
 * Best-effort JSON extraction (repair tolerance): direct parse → fenced block
 * → widest balanced-brace substring. Returns null when nothing parses.
 */
function extractJson(content: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(content);
  if (direct) return direct;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const v = tryParse(fenced[1].trim());
    if (v) return v;
  }
  const start = content.indexOf('{');
  if (start >= 0) {
    for (let end = content.lastIndexOf('}'); end > start; end = content.lastIndexOf('}', end - 1)) {
      const v = tryParse(content.slice(start, end + 1));
      if (v) return v;
    }
  }
  return null;
}

/**
 * Classify a Tier-1-flagged student message. Never throws; every failure path
 * returns the fail-closed regex_only confirmation (see file header).
 */
export async function classifySafeguarding(
  message: string,
  opts: ClassifySafeguardingOptions,
): Promise<SafeguardingClassification> {
  const failClosed: SafeguardingClassification = {
    confirmed: true,
    category: opts.categories[0] ?? null,
    confidence: 0,
    tier: 'regex_only',
  };

  try {
    const result = await callModel(
      {
        systemPrompt: buildSystemPrompt(sanitizeMood(opts.sessionMood), opts.categories),
        messages: [{ role: 'user', content: message }],
        maxTokens: 256,
        // Deterministic triage — this is a factual classification, not
        // generation (P12: never > 0.3 on factual paths; 0 here).
        temperature: 0,
        timeoutMs: 10_000,
        jsonMode: true,
      },
      { constraints: { needsJson: true } },
    );

    if (!result.ok || !result.content) return failClosed;

    const parsed = extractJson(result.content);
    if (!parsed) return failClosed;

    const rawConfidence = Number(parsed.confidence);
    if (!Number.isFinite(rawConfidence)) return failClosed;
    const confidence = Math.min(1, Math.max(0, rawConfidence));

    const modelCategory = isSafeguardingCategory(parsed.category)
      ? parsed.category
      : opts.categories[0] ?? null;

    const confirmed = parsed.confirmed === true && confidence >= SAFEGUARDING_CONFIRM_THRESHOLD;

    return {
      confirmed,
      category: confirmed ? modelCategory : null,
      confidence,
      tier: 'llm_confirmed',
    };
  } catch {
    return failClosed;
  }
}
