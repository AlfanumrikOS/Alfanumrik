// packages/lib/src/ai/validation/synthesis-quality-eval.ts
//
// Phase 8 item 8.6 — Monthly-Synthesis LLM-as-judge quality scoring.
//
// The synthesis equivalent of packages/lib/src/foxy/quality-eval.ts. Where
// that scores Foxy assistant turns, this scores a monthly_synthesis_runs row —
// the ~300-word Claude-authored parent summary — on FOUR dimensions:
//
//   1. grounding       — does the summary agree with the SynthesisBundle it
//                        was generated from (mastery delta / chapter mock /
//                        artifact counts)?
//   2. tone            — warm, honest, parent-readable, age-appropriate for a
//                        grades 6-12 student's parent; no jargon, no adult
//                        framing (P12).
//   3. no_fabrication  — no invented numbers or topic names. This dimension is
//                        DETERMINISTICALLY AUTHORITATIVE: the synthesis-oracle
//                        (checkNumberFabrication / checkTopicFabrication) runs
//                        first and, if it finds ANY unbacked number or topic,
//                        the score is clamped to 0 regardless of the judge's
//                        softer read (a hard fabrication is a hard fail, P11).
//   4. cbse_scope      — stays inside the CBSE curriculum boundary.
//
// Reuses the EXISTING synthesis circuit breaker (synthesisClaudeCircuitBreaker
// in synthesis-oracle.ts) so repeated Claude failures degrade to "couldn't
// score" (null) instead of hammering a failing API — the SAME breaker the
// /api/synthesis/state generation path uses. Never throws on a judge miss;
// returns null so the cron counts it as `failed` and moves on (P12 — a judge
// failure must never crash the sampler).
//
// P13: the judge reads the summary body + bundle SERVER-SIDE and ephemerally.
// The persisted output (QualityScoreOutput) carries scores + a judge note +
// COUNTS-ONLY oracle findings — never the summary body, phone, or student name.

import type { SynthesisBundle } from '../../learn/monthly-synthesis-orchestrator';
import {
  checkNumberFabrication,
  checkTopicFabrication,
  synthesisClaudeCircuitBreaker,
  type SynthesisCircuitBreaker,
} from './synthesis-oracle';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface SynthesisQualityInput {
  /** English parent summary (as persisted on monthly_synthesis_runs). */
  summaryEn: string;
  /** Hindi parent summary. */
  summaryHi: string;
  /** The bundle the summary was generated from — the factual ground truth. */
  bundle: SynthesisBundle;
  /** Student name — legitimate non-fabricated mention (topic-oracle context). */
  studentName: string;
  /** P5: grade string '6'..'12' — grade-appropriate tone + number allowlist. */
  studentGrade: string;
}

export interface SynthesisQualityOutput {
  groundingScore: number;         // 0..100
  toneScore: number;              // 0..100
  noFabricationScore: number;     // 0..100 (deterministically clamped to 0 on any unbacked mention)
  cbseScopeScore: number;         // 0..100
  overallScore: number;           // 0..100, weighted blend
  judgeModel: string;
  rubricVersion: string;
  /** COUNTS ONLY (P13) — never the raw numbers/phrases. */
  oracleFindings: { unbacked_number_count: number; unbacked_topic_count: number };
  rawJudgeResponse: unknown;
  notes: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SYNTHESIS_RUBRIC_VERSION = 'v1';

// Sonnet judge — pinned to the same model id the rest of the codebase uses for
// judging (foxy/quality-eval.ts:112, grounded-answer/claude.ts). Nightly cron,
// so latency is irrelevant; rubric fidelity matters.
export const SYNTHESIS_JUDGE_MODEL = 'claude-sonnet-4-20250514';

const COMPOSITE_WEIGHTS = {
  grounding: 0.35,
  noFabrication: 0.35,
  tone: 0.20,
  cbseScope: 0.10,
} as const;

const MAX_TOKENS = 800;

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Score a single synthesis run. Runs the deterministic fabrication oracle
 * first (authoritative on the no_fabrication dimension), then calls the Sonnet
 * judge for the softer dimensions — GATED by the shared synthesis circuit
 * breaker. Never throws on judge failure (returns null); throws only on
 * programmer error (missing API key).
 */
export async function scoreSynthesisSummary(
  input: SynthesisQualityInput,
  apiKey: string,
  breaker: SynthesisCircuitBreaker = synthesisClaudeCircuitBreaker,
): Promise<SynthesisQualityOutput | null> {
  if (!apiKey) {
    throw new Error(
      'scoreSynthesisSummary: ANTHROPIC_API_KEY is required. Pass explicitly; do not let undefined keys reach the API.',
    );
  }

  // ── Deterministic oracle pass (authoritative on fabrication) ──
  const numberContext = { studentGrade: input.studentGrade };
  const numEn = checkNumberFabrication(input.summaryEn, input.bundle, numberContext);
  const numHi = checkNumberFabrication(input.summaryHi, input.bundle, numberContext);
  const topicEn = checkTopicFabrication(input.summaryEn, input.bundle, input.studentName);

  const unbackedNumberCount =
    (numEn.unbackedNumbers?.length ?? 0) + (numHi.unbackedNumbers?.length ?? 0);
  const unbackedTopicCount = topicEn.unbackedPhrases?.length ?? 0;
  const hasFabrication = !numEn.ok || !numHi.ok || !topicEn.ok;

  // ── Circuit breaker gate around the judge call ──
  if (!breaker.canRequest()) return null;

  const systemPrompt = buildSynthesisJudgeSystemPrompt();
  const userMessage = buildSynthesisJudgeUserMessage(input);

  let body: AnthropicMessageResponse | null = null;
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: SYNTHESIS_JUDGE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) {
      breaker.recordFailure();
      return null;
    }
    body = (await res.json()) as AnthropicMessageResponse;
  } catch {
    breaker.recordFailure();
    return null;
  }

  const textBlock = body?.content?.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!textBlock?.text) {
    breaker.recordFailure();
    return null;
  }

  const parsed = parseSynthesisJudgeJson(textBlock.text);
  if (!parsed) {
    breaker.recordFailure();
    return null;
  }
  breaker.recordSuccess();

  // ── Deterministic override: a hard fabrication is a hard fail ──
  const noFabricationScore = hasFabrication ? 0 : parsed.no_fabrication;
  // Fabrication also caps grounding — an invented number/topic cannot be
  // "well grounded" no matter how the judge scored the rest.
  const groundingScore = hasFabrication ? Math.min(parsed.grounding, 40) : parsed.grounding;

  const overallScore = computeSynthesisOverall({
    grounding: groundingScore,
    no_fabrication: noFabricationScore,
    tone: parsed.tone,
    cbse_scope: parsed.cbse_scope,
  });

  const notes = hasFabrication
    ? `Deterministic oracle flagged ${unbackedNumberCount} unbacked number(s) and ${unbackedTopicCount} unbacked topic(s); no_fabrication clamped to 0.`
    : parsed.notes ?? null;

  return {
    groundingScore,
    toneScore: parsed.tone,
    noFabricationScore,
    cbseScopeScore: parsed.cbse_scope,
    overallScore,
    judgeModel: SYNTHESIS_JUDGE_MODEL,
    rubricVersion: SYNTHESIS_RUBRIC_VERSION,
    oracleFindings: {
      unbacked_number_count: unbackedNumberCount,
      unbacked_topic_count: unbackedTopicCount,
    },
    rawJudgeResponse: parsed,
    notes,
  };
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

export function computeSynthesisOverall(scores: {
  grounding: number;
  no_fabrication: number;
  tone: number;
  cbse_scope: number;
}): number {
  const blended =
    COMPOSITE_WEIGHTS.grounding * scores.grounding +
    COMPOSITE_WEIGHTS.noFabrication * scores.no_fabrication +
    COMPOSITE_WEIGHTS.tone * scores.tone +
    COMPOSITE_WEIGHTS.cbseScope * scores.cbse_scope;
  return Math.max(0, Math.min(100, Math.round(blended)));
}

interface SynthesisJudgeRubric {
  grounding: number;
  tone: number;
  no_fabrication: number;
  cbse_scope: number;
  notes?: string;
}

export function parseSynthesisJudgeJson(raw: string): SynthesisJudgeRubric | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const stripped = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;

  const grounding = clampScore(r.grounding);
  const tone = clampScore(r.tone);
  const noFabrication = clampScore(r.no_fabrication);
  const cbseScope = clampScore(r.cbse_scope);

  if (grounding === null || tone === null || noFabrication === null || cbseScope === null) {
    return null;
  }

  const notes =
    typeof r.notes === 'string' && r.notes.length > 0 ? r.notes.slice(0, 1000) : undefined;

  return { grounding, tone, no_fabrication: noFabrication, cbse_scope: cbseScope, notes };
}

function clampScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|javascript|js)?\s*/i, '');
    out = out.replace(/```\s*$/i, '');
    out = out.trim();
  }
  return out;
}

// ─── Prompt builders (exported for parity tests) ────────────────────────────

export function buildSynthesisJudgeSystemPrompt(): string {
  return [
    'You are a strict quality judge for a monthly progress summary that an AI',
    'tutor platform sends to the PARENT of an Indian CBSE student (grades 6-12).',
    '',
    'You will be given the summary text (English + Hindi) and the structured',
    'SynthesisBundle JSON it was generated from (mastery delta, chapter mock,',
    'weekly artifact count, month label). Score the summary on FOUR dimensions,',
    'each 0..100:',
    '',
    '  1. grounding — Does every factual claim (counts of topics mastered/',
    '     improved/regressed, chapters studied, artifacts, mock questions)',
    '     match the bundle EXACTLY? Penalise any number or claim not supported',
    '     by the bundle. An honest "0 chapters / light month" that matches the',
    '     bundle scores HIGH; optimistic padding not in the bundle scores LOW.',
    '',
    '  2. tone — Warm, honest, specific, parent-readable. Plain language, no',
    '     jargon a non-expert parent would not understand, no adult framing.',
    '     Age-appropriate references for a grades 6-12 student. Generic filler',
    '     ("great progress!") with no specific topic named scores lower.',
    '',
    '  3. no_fabrication — Are there ANY invented numbers, scores, chapter/',
    '     topic names, or claims with no basis in the bundle? Zero tolerance:',
    '     any single fabricated fact scores this dimension LOW.',
    '',
    '  4. cbse_scope — Stays inside the CBSE curriculum framing for the stated',
    '     grade. No off-syllabus claims or out-of-scope advice.',
    '',
    'Output ONLY a JSON object with exactly this shape:',
    '',
    '  {',
    '    "grounding": <int 0-100>,',
    '    "tone": <int 0-100>,',
    '    "no_fabrication": <int 0-100>,',
    '    "cbse_scope": <int 0-100>,',
    '    "notes": "<one-sentence reason for the LOWEST-scoring dimension>"',
    '  }',
    '',
    'No prose, no markdown fences, no commentary. Just the JSON object.',
  ].join('\n');
}

export function buildSynthesisJudgeUserMessage(input: SynthesisQualityInput): string {
  return [
    `Grade: ${input.studentGrade}`,
    `Month: ${input.bundle?.monthLabel ?? '(unknown)'}`,
    '',
    '=== SOURCE BUNDLE (ground truth — the ONLY facts the summary may cite) ===',
    JSON.stringify(input.bundle ?? {}, null, 2),
    '',
    '=== SUMMARY (English) ===',
    input.summaryEn,
    '',
    '=== SUMMARY (Hindi) ===',
    input.summaryHi,
  ].join('\n');
}
