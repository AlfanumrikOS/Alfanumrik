// supabase/functions/grounded-answer/grounding-check.ts
// Strict-mode grounding verifier — a second Haiku pass that fact-checks
// the candidate answer against the retrieved chunks.
//
// Single responsibility: return pass|fail plus the list of unsupported
// sentences. Spec §6.4 step 7 and §3.5.
//
// Design:
//   - Always Haiku. Cheap, fast, and this is a guardrail, not a primary
//     path. ~$0.0001/call and ~500ms.
//   - Conservative fail on ANY uncertainty: timeout, JSON parse error,
//     unknown verdict. Better to ask for clarification than to serve an
//     ungrounded claim to a grade-6 student.
//   - The prompt is inlined here (not in prompts/) because it's meta-
//     verification: it doesn't belong to any caller's persona and must
//     not be confused with a student-facing template by the registry.
//   - We still send the INSUFFICIENT_CONTEXT answer to Claude (rather
//     than returning pass short-circuit) so the verifier's output shape
//     and latency model stays uniform. The prompt tells it to pass on
//     that exact string.

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const GROUNDING_CHECK_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_TOKENS = 512;

export interface GroundingCheckResult {
  verdict: 'pass' | 'fail';
  unsupportedSentences: string[];
}

const GROUNDING_CHECK_SYSTEM_PROMPT = `You are a fact-checker. You will see STUDENT_QUESTION, CANDIDATE_ANSWER,
and SOURCE_CHUNKS. For each sentence in CANDIDATE_ANSWER that makes a
factual claim, determine whether the claim is directly supported by
SOURCE_CHUNKS.

Return JSON: { "verdict": "pass" | "fail", "unsupported_sentences": [...] }.

If CANDIDATE_ANSWER is exactly "{{INSUFFICIENT_CONTEXT}}", return
{ "verdict": "pass", "unsupported_sentences": [] }.

Verdict "fail" if ANY factual claim is unsupported.
Be strict — don't extrapolate. If the chunk says "elements" and the answer
says "chemical elements," that's supported. If the chunk doesn't mention
something at all, that's unsupported.`;

export async function runGroundingCheck(
  answer: string,
  question: string,
  chunks: { id: string; content: string }[],
  apiKey: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GroundingCheckResult> {
  if (!apiKey) {
    console.warn('grounding-check: no API key — conservative fail');
    return { verdict: 'fail', unsupportedSentences: [] };
  }

  const userMessage = buildUserMessage(answer, question, chunks);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: GROUNDING_CHECK_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.0, // deterministic fact-check
        system: GROUNDING_CHECK_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      console.warn(`grounding-check: HTTP ${response.status} — conservative fail`);
      return { verdict: 'fail', unsupportedSentences: [] };
    }

    const body = await response.json().catch(() => null);
    // deno-lint-ignore no-explicit-any
    const blocks: any[] = Array.isArray(body?.content) ? body.content : [];
    const text = blocks
      // deno-lint-ignore no-explicit-any
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      // deno-lint-ignore no-explicit-any
      .map((b: any) => b.text as string)
      .join('')
      .trim();

    return parseVerdict(text);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('grounding-check: timeout — conservative fail');
    } else {
      console.warn(`grounding-check: network error — ${String(err)}`);
    }
    return { verdict: 'fail', unsupportedSentences: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildUserMessage(
  answer: string,
  question: string,
  chunks: { id: string; content: string }[],
): string {
  const chunksText = chunks
    .map((c, i) => `[${i + 1}] (${c.id})\n${c.content}`)
    .join('\n\n---\n\n');

  return [
    `STUDENT_QUESTION:\n${question}`,
    `CANDIDATE_ANSWER:\n${answer}`,
    `SOURCE_CHUNKS:\n${chunksText}`,
    'Respond with JSON only.',
  ].join('\n\n');
}

function parseVerdict(text: string): GroundingCheckResult {
  // Claude may wrap JSON in ```json fences or add commentary. Find the
  // first '{' and the matching '}' and parse that span.
  const json = extractFirstJsonObject(text);
  if (!json) {
    console.warn('grounding-check: no JSON object found — conservative fail');
    return { verdict: 'fail', unsupportedSentences: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn('grounding-check: JSON parse failed — conservative fail');
    return { verdict: 'fail', unsupportedSentences: [] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { verdict: 'fail', unsupportedSentences: [] };
  }

  // deno-lint-ignore no-explicit-any
  const verdict = (parsed as any).verdict;
  if (verdict !== 'pass' && verdict !== 'fail') {
    console.warn(`grounding-check: unknown verdict "${verdict}" — conservative fail`);
    return { verdict: 'fail', unsupportedSentences: [] };
  }

  // deno-lint-ignore no-explicit-any
  const raw = (parsed as any).unsupported_sentences;
  const unsupported: string[] = Array.isArray(raw)
    ? raw.filter((s: unknown): s is string => typeof s === 'string')
    : [];

  return { verdict, unsupportedSentences: unsupported };
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}