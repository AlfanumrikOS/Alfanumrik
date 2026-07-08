/**
 * ALFANUMRIK -- Foxy AI Tutor: Text → FoxyResponse recovery
 *
 * When the grounded-answer Edge Function fails to extract a structured payload
 * but the model emits the JSON inline in `answer` (often inside a ```json
 * markdown fence), this helper recovers the FoxyResponse so the client can
 * still render proper blocks instead of leaking raw JSON into the chat bubble.
 *
 * Used at two boundaries:
 *   1. Server (src/app/api/foxy/route.ts) — when extractValidatedStructured
 *      returns null but `grounded.answer` / `accumulatedText` still contains
 *      a recoverable payload. The recovered value is persisted into the
 *      `structured` JSONB column and the TEXT `content` is denormalized so
 *      future reads see a human-readable string, not a fenced JSON blob.
 *   2. Client (src/app/foxy/page.tsx) — for historical messages that were
 *      saved before this fix landed (raw JSON in `content`, NULL `structured`).
 *      Recovers at render time so the user sees structured blocks rather
 *      than a markdown code-fence rendering of the raw JSON.
 *
 * Pure: no DOM, no React, no I/O. Safe to call from Edge runtimes and
 * client components alike.
 *
 * P12 (AI Safety): does NOT bypass schema validation. Recovered candidates
 * are run through FoxyResponseSchema.safeParse and rejected on any issue.
 * Recovery only ever upgrades a known-bad render path to a known-good one;
 * if the parse fails the caller falls through to the existing fallback
 * (RichContent / wrapAsParagraph).
 */
import { FoxyResponseSchema, type FoxyResponse } from './schema';

/**
 * Attempt to recover a FoxyResponse from a plain string.
 *
 * Returns `null` when no valid payload is present. Never throws.
 *
 * Recovery strategies, applied in order:
 *   1. Markdown fenced code block — ```json ... ``` or ``` ... ```
 *      (matches the regression seen in prod where the model echoed the
 *      structured-output JSON inside a fence).
 *   2. Bare JSON — slice from the first `{` to the matching last `}` and
 *      attempt a parse. Catches the case where the model emitted bare JSON
 *      with surrounding chatter (e.g. "Here's the answer: { ... }").
 *
 * Each candidate is JSON.parsed and then validated against FoxyResponseSchema.
 * The first candidate that validates wins; otherwise null.
 */
export function recoverFoxyResponseFromText(text: unknown): FoxyResponse | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  // Cheap structural gate: must contain the two required top-level keys.
  // Skips the regex + JSON.parse work on the overwhelming majority of inputs
  // (legacy markdown, abstain text, normal prose).
  if (!text.includes('"title"') || !text.includes('"blocks"')) return null;

  // Strategy 1: markdown fence. Non-greedy body capture so we match the FIRST
  // fence rather than spanning multiple. Language tag is optional and
  // case-insensitive ("json", "JSON", or absent).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    const recovered = tryParseAndValidate(fenceMatch[1]);
    if (recovered) return recovered;
  }

  // Strategy 2: bare JSON object slice. lastIndexOf('}') means we accept
  // trailing text after the JSON (e.g. "...} -- happy studying!"); for inputs
  // where the model emits multiple `{...}` objects the outer slice still
  // captures the canonical first object because schema validation will reject
  // the wider slice if it isn't a valid FoxyResponse.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const recovered = tryParseAndValidate(text.slice(start, end + 1));
    if (recovered) return recovered;
  }

  return null;
}

function tryParseAndValidate(raw: string): FoxyResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = FoxyResponseSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
