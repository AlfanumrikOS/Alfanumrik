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
 *
 * 2026-08-05 (FOXY-RAWJSON incident, CEO-reported): a Grade-6 Maths turn
 * rendered the raw structured envelope verbatim in a monospace block. Two
 * defects combined:
 *   1. `recoverFoxyResponseFromText` used bare `JSON.parse`, so a payload that
 *      was TRUNCATED (max_tokens) or carried an under-escaped LaTeX backslash
 *      failed recovery and returned null — even though the already-hardened
 *      `rescueFromTruncatedJson` could have salvaged it. Fixed by adding it as
 *      Strategy 3 below.
 *   2. Callers treated `null` as "render the string as markdown", which for a
 *      2-space-indented JSON payload is an indented code block. Fixed by
 *      `coerceStudentFacingStructured` / `coerceStudentFacingText` below,
 *      which make "never raw JSON to a student" UNCONDITIONAL rather than
 *      best-effort.
 */
import {
  FoxyResponseSchema,
  isJsonShapedRawText,
  rescueFromTruncatedJson,
  wrapAsParagraph,
  type FoxyResponse,
  type FoxySubject,
} from './schema';
import { denormalizeFoxyResponse } from './denormalize';

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

  // Strategy 3 (added 2026-08-05, FOXY-RAWJSON incident): truncation +
  // illegal-escape rescue. Strategies 1 and 2 are plain `JSON.parse` calls, so
  // BOTH of the two most common production failure modes defeated them and the
  // caller fell through to rendering the raw JSON string:
  //   (a) the model hit max_tokens and the payload is cut mid-block/mid-string;
  //   (b) the model under-escaped LaTeX inside a JSON string (`\times`, `\(`),
  //       which is an illegal JSON escape and aborts the whole parse.
  // `rescueFromTruncatedJson` already handles both (it applies
  // `repairIllegalJsonEscapes` and then walks backward through `}` boundaries),
  // and every candidate it returns has passed `FoxyResponseSchema` — so P12's
  // validation bar is unchanged; this tier can only upgrade a known-bad render
  // path to a known-good one.
  //
  // Run it on the raw text first (covers the fenced + bare cases it strips
  // itself), then on the `{...}` slice (covers leading chatter such as
  // "Here's the answer: {...}", which `rescueFromTruncatedJson` rejects because
  // it requires the payload to start with `{`).
  const rescued = rescueFromTruncatedJson(text);
  if (rescued) return rescued;
  if (start > 0) {
    const rescuedSlice = rescueFromTruncatedJson(text.slice(start));
    if (rescuedSlice) return rescuedSlice;
  }

  return null;
}

/**
 * P12 UNCONDITIONAL GUARANTEE (client + server render boundary).
 *
 * Given arbitrary assistant text that is about to be shown to a student with
 * NO validated `structured` payload available, return a FoxyResponse the
 * renderer can display — or `null` when the text is genuine prose and should
 * be rendered by the normal markdown path.
 *
 * The contract that matters: **if the text is JSON-shaped, this NEVER returns
 * `null`.** A JSON-shaped string always resolves to a renderable FoxyResponse
 * via `wrapAsParagraph`, whose own documented contract is that it never emits
 * a paragraph block whose text is JSON-shaped (rescue → `"text"`-field
 * extraction → friendly bilingual "my answer got cut off" fallback, in that
 * order). That closes the last hole: a caller can no longer hand raw JSON to a
 * markdown renderer just because recovery failed.
 *
 * Pure: no DOM, no React, no I/O. Safe in Edge runtimes and client components.
 */
export function coerceStudentFacingStructured(
  text: unknown,
  opts: { title?: string; subject?: FoxySubject } = {},
): FoxyResponse | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  // Tier 1: full-fidelity recovery (fence → bare slice → truncation rescue).
  const recovered = recoverFoxyResponseFromText(text);
  if (recovered) {
    if (opts.subject && recovered.subject !== opts.subject) {
      return { ...recovered, subject: opts.subject };
    }
    return recovered;
  }

  // Tier 2: the text is JSON-shaped but unrecoverable. It MUST NOT reach a
  // markdown renderer. wrapAsParagraph is guaranteed to return a valid,
  // non-JSON-shaped FoxyResponse for JSON-shaped input.
  if (isJsonShapedRawText(text)) {
    return wrapAsParagraph(text, opts);
  }

  // Genuine prose — let the caller's normal renderer handle it unchanged.
  return null;
}

/**
 * String-level twin of `coerceStudentFacingStructured`, for the wire/persisted
 * `response` + `content` fields that legacy + mobile clients read directly
 * (`mobile/lib/data/repositories/chat_repository.dart` reads ONLY `response`,
 * so it has no structured fallback at all).
 *
 * Returns `text` BYTE-IDENTICAL when it is not JSON-shaped — which is every
 * normal turn — so this is a pure safety net with no happy-path behaviour
 * change. When the text IS JSON-shaped it is coerced to the denormalized
 * human-readable rendering (or the bilingual truncation message).
 */
export function coerceStudentFacingText(
  text: string,
  opts: { title?: string; subject?: FoxySubject } = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!isJsonShapedRawText(text)) return text;
  const coerced = coerceStudentFacingStructured(text, opts);
  // `coerced` is non-null by construction for JSON-shaped input, but keep the
  // defensive branch so this helper can never throw on the student path.
  return coerced ? denormalizeFoxyResponse(coerced) : text;
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
