/**
 * Pack Quality Oracle (Phase 4.6 Track A safety net)
 *
 * Pure logic + Claude-call helpers for grading the quality of
 * LLM-generated content pack chunks BEFORE they are written to JSONL
 * and ingested. Used by scripts/generate-rag-pack.ts.
 *
 * Why this exists: P12 (AI safety) requires no unfiltered LLM output to
 * reach students. Generated chunks are LLM output. Ergo every generated
 * chunk MUST pass an automated quality grade before becoming part of
 * Foxy retrieval.
 *
 * Owner: ai-engineer (oracle implementation) + assessment (rubric review)
 * Reviewers: testing (mock + contract tests), quality (final gate)
 *
 * Grading rubric (3 dimensions, each scored 0-3):
 *   - factual_accuracy: factual claims align with NCERT / standard CBSE syllabus.
 *     0=fabricated, 1=partial, 2=mostly correct with minor issues, 3=fully correct.
 *   - cbse_scope:       content stays within CBSE Grade X Subject curriculum.
 *     0=off-topic or beyond grade, 1=mostly in scope but drifts, 2=in scope, 3=tightly aligned.
 *   - age_appropriate:  language and complexity suit grades 6-12.
 *     0=jargon overload or babyish, 1=mismatched register, 2=appropriate, 3=ideal.
 *
 * Acceptance:
 *   - Total score >= 7 (out of 9) keeps the chunk.
 *   - Otherwise the chunk is rejected (logged with full reasoning, not ingested).
 */

import type { PackEntry } from './pack-manifest';

export interface QualityScore {
  factual_accuracy: 0 | 1 | 2 | 3;
  cbse_scope: 0 | 1 | 2 | 3;
  age_appropriate: 0 | 1 | 2 | 3;
  total: number;             // 0-9
  reasoning: string;         // grader's prose explanation (for audit logs)
  accepted: boolean;         // total >= ACCEPTANCE_THRESHOLD
}

export const ACCEPTANCE_THRESHOLD = 7;
export const MAX_TOTAL = 9;

/**
 * Build the Claude prompt for grading one entry. Fully deterministic given
 * the entry; same entry => byte-identical prompt.
 */
export function buildGraderPrompt(entry: PackEntry): { system: string; user: string } {
  const system = [
    'You are a strict CBSE curriculum reviewer.',
    'Score the candidate content chunk on three dimensions, each 0-3:',
    '  - factual_accuracy (0 fabricated, 3 fully correct)',
    '  - cbse_scope (0 off-topic, 3 tightly aligned to grade+subject)',
    '  - age_appropriate (0 mismatched register, 3 ideal for grades 6-12)',
    'Return STRICTLY a single JSON object on one line with keys:',
    '  factual_accuracy (int 0-3), cbse_scope (int 0-3), age_appropriate (int 0-3), reasoning (string).',
    'Do not include any other text. No markdown, no code fences.',
  ].join('\n');

  const user = [
    'Grade this candidate chunk for CBSE curriculum use.',
    '',
    'Subject: ' + entry.subject,
    'Grade: ' + entry.grade,
    'Chapter: ' + (entry.chapter_title ?? entry.chapter_number),
    entry.topic ? 'Topic: ' + entry.topic : '',
    entry.concept ? 'Concept: ' + entry.concept : '',
    '',
    'Chunk text:',
    entry.chunk_text,
  ].filter((l) => l !== '').join('\n');

  return { system, user };
}

/**
 * Parse a Claude grader response. Returns a QualityScore or throws on
 * malformed output. Pure - no IO.
 *
 * Defensive: tolerates leading/trailing whitespace and a single optional
 * code fence. Anything past that requires the LLM to be re-prompted by
 * the caller.
 */
export function parseGraderResponse(raw: string): QualityScore {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/```$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('grader returned non-JSON: ' + raw.slice(0, 200));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('grader response is not an object');
  }
  const o = parsed as Record<string, unknown>;
  const fa = o.factual_accuracy;
  const sc = o.cbse_scope;
  const ag = o.age_appropriate;
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  if (
    typeof fa !== 'number' || fa < 0 || fa > 3 || !Number.isInteger(fa) ||
    typeof sc !== 'number' || sc < 0 || sc > 3 || !Number.isInteger(sc) ||
    typeof ag !== 'number' || ag < 0 || ag > 3 || !Number.isInteger(ag)
  ) {
    throw new Error('grader scores must be integers 0-3');
  }
  const total = fa + sc + ag;
  return {
    factual_accuracy: fa as 0 | 1 | 2 | 3,
    cbse_scope: sc as 0 | 1 | 2 | 3,
    age_appropriate: ag as 0 | 1 | 2 | 3,
    total,
    reasoning,
    accepted: total >= ACCEPTANCE_THRESHOLD,
  };
}

/**
 * Call Claude to grade one entry. Returns null on transport failure
 * (caller should treat as rejection by policy - never let a transport
 * error silently let bad content through).
 *
 * The fetch caller is injected so this function is unit-testable
 * without network access.
 */
export async function gradeWithClaude(
  entry: PackEntry,
  opts: {
    apiKey: string;
    model?: string;
    fetch?: typeof globalThis.fetch;
  },
): Promise<QualityScore | null> {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const { system, user } = buildGraderPrompt(entry);

  let res: Response;
  try {
    res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  const text = body?.content?.[0]?.text;
  if (typeof text !== 'string') return null;

  try {
    return parseGraderResponse(text);
  } catch {
    return null;
  }
}
