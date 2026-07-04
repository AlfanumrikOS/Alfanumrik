/**
 * scripts/knowledge-audit/prompt.ts
 *
 * v2 SLIM semantic prompt for the chunk-pass knowledge audit.
 *
 * WHY THE REDESIGN (Wave 1 pilot-gate failure): the v1 single-pass prompt fed
 * the model 20k-84k tokens and asked for 22 dimension COUNTS — gpt-4o-mini
 * returned near-empty skeletons (443-1017 output tokens) and the strict
 * "own line" counting rules discarded OCR-flattened structural markers.
 * v2 changes all three failure axes:
 * - SCOPE: only the 8 SEMANTIC dimensions reach the model. The 12 structural
 *   dimensions are counted exactly in code (structural-scan.ts), `topics` and
 *   `concepts` are deterministic SSoT counts (curriculum_topics /
 *   chapter_concepts, see coverage.ts), and contamination is computed in code
 *   (contamination.ts).
 * - CONTEXT: chunks are BATCHED (≤ MAX_CHUNKS_PER_BATCH per call, ~10k tokens)
 *   so the model never sees a context it collapses under.
 * - OUTPUT: each batch returns ITEMS (short labels, ≤40 chars) per dimension,
 *   NOT counts — the model enumerates, code dedupes normalized labels across
 *   batches and derives counts (parse-semantic.ts). Semantic counts cannot be
 *   deduped across batches any other way.
 *
 * P12/P13 posture unchanged: evidence-grounded enumeration only, chunk IDs
 * only as evidence, labels only (never passage text).
 *
 * Pure module — no I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/prompt.test.ts.
 */

import { SEMANTIC_DIMENSIONS, type AuditChunk, type SemanticDimension } from './dimensions';
import { MAX_LABEL_CHARS } from './parse-semantic';

/** Truncate a single chunk's text so one megachunk can't blow the budget. */
const MAX_CHARS_PER_CHUNK = 12_000;

/** Batch size cap: bounds a call to roughly ≤10k input tokens. */
export const MAX_CHUNKS_PER_BATCH = 15;

export interface AuditPromptContext {
  grade: string; // P5: grades are STRINGS "6".."12"
  subject: string;
  chapterNumber: number;
  chapterTitle: string;
}

/** Split chunks into ordered batches of at most `size`. */
export function batchChunks<T>(chunks: T[], size: number = MAX_CHUNKS_PER_BATCH): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`invalid batch size ${size}`);
  const batches: T[][] = [];
  for (let i = 0; i < chunks.length; i += size) batches.push(chunks.slice(i, i + size));
  return batches;
}

/**
 * Per-dimension enumeration rules — ITEMS, not counts. Each rule tells the
 * model what one item IS and what its canonical label looks like (stable
 * labels are what make cross-batch dedupe work).
 */
const SEMANTIC_DIMENSION_RULES: Record<SemanticDimension, string> = {
  learning_objectives:
    'learning_objectives: one item per explicit objective/outcome statement ("In this chapter you will learn...", "After studying... you will be able to..."). Label = a short paraphrase of the objective, e.g. "classify materials by lustre". None stated → empty list.',
  definitions:
    'definitions: one item per formal definitional sentence — patterns like "X is defined as", "X is called", "is known as", or a new term immediately followed by its definition. Casual mentions are NOT definitions. Label = the TERM defined (e.g. "adaptation"), nothing else.',
  formulae:
    'formulae: one item per DISTINCT mathematical formula/equation. Numbered equations: label "eq N.M" (e.g. "eq 6.1"). Unnumbered: a compact symbolic form as the label (e.g. "v = u + at"). The same formula restated is the SAME item.',
  prerequisites:
    'prerequisites: one item per explicit reference to prior knowledge or earlier chapters/classes ("as you learnt in Class 7", "recall from Chapter 2"). Label = e.g. "class 7 heat" or "chapter 2 recall".',
  common_mistakes:
    'common_mistakes: one item per explicit caution/misconception warning ("Note that...", "Do not confuse...", "A common error is..."). Label = the misconception subject, e.g. "mass vs weight confusion".',
  difficulty_mapping:
    'difficulty_mapping: one item per EXPLICIT difficulty label/marker in the text — NCERT text normally has none, so this is normally an empty list. Never invent difficulty ratings.',
  real_world_applications:
    'real_world_applications: one item per passage explicitly connecting a concept to everyday life/applications ("in daily life", application boxes). Label = the application, e.g. "copper in electric wiring".',
  image_explanations:
    'image_explanations: one item per prose passage that explains what a figure/image SHOWS beyond its bare caption. Label = "fig N.M explanation" when the figure is numbered, else a 2-4 word subject.',
};

/** The exact JSON skeleton the model must return (8 semantic dims). */
export function buildSemanticOutputContract(): string {
  const dims = SEMANTIC_DIMENSIONS.map((d) => `"${d}":{"items":[],"evidence_chunk_ids":[]}`).join(',');
  return `{"dimensions":{${dims}},"metadata_garbled":false,"suspected_missing":[]}`;
}

export function buildSemanticSystemPrompt(ctx: AuditPromptContext): string {
  return [
    `You are a meticulous NCERT textbook content auditor for CBSE Class ${ctx.grade} ${ctx.subject}, Chapter ${ctx.chapterNumber}: "${ctx.chapterTitle}".`,
    '',
    'TASK: The chapter\'s ingested text chunks are delivered to you in MULTIPLE BATCHES (this conversation carries ONE batch). For each dimension below, ENUMERATE the distinct instances actually present in THIS batch as short item labels. Results from all batches are merged in code: labels are normalized and deduplicated across batches, and counts are derived from the deduplicated labels. You never return counts.',
    '',
    'ABSOLUTE RULES:',
    '- Enumerate ONLY what is present in the provided chunk texts. NEVER infer items from the chapter title, the known-concept list alone, or your own knowledge of NCERT books. If it is not in the chunks, it does not exist.',
    '- OCR-FLATTENED TEXT: the chunk text lost its original line breaks, bold/italic styling and page layout. Headers, labels and markers may appear MID-LINE, run together with prose. Never require an item to sit on its own line to recognize it.',
    '- Chunks OVERLAP: the ingestion uses sliding-window chunking, so the SAME passage may appear in 2-3 consecutive chunks within this batch. The same instance is ONE item, never two.',
    `- ITEMS ARE SHORT LABELS: each item is a label of at most ${MAX_LABEL_CHARS} characters that IDENTIFIES the instance (a term, a topic name, "eq 6.1"). Labels are identifiers, NOT quotes — never copy passage sentences into a label (P13). Keep labels STABLE and CANONICAL (lowercase, singular, no trailing punctuation) so the same item gets the same label in every batch.`,
    '- evidence_chunk_ids: per dimension, UP TO 5 chunk ids (from the ids in the user message) where instances appear. IDs ONLY.',
    '- A dimension with zero instances in this batch gets an empty items list. An honest empty list is correct; padding is a failure.',
    '',
    'PER-DIMENSION RULES:',
    ...SEMANTIC_DIMENSIONS.map((d) => `- ${SEMANTIC_DIMENSION_RULES[d]}`),
    '',
    'BATCH-LEVEL FIELDS:',
    '- metadata_garbled: true if THIS batch\'s chunk texts are substantially OCR-corrupted/unreadable (replacement characters, shattered script, scrambled ordering); false otherwise.',
    '- suspected_missing: SHORT LABELS for assets the text REFERENCES but which are absent from this batch\'s chunks — e.g. "Activity 4.5 referenced but not present". Labels only — never passage text.',
    '',
    'OUTPUT FORMAT: Return ONLY a single JSON object, no markdown fences, no commentary, with EXACTLY this shape (every dimension key present):',
    buildSemanticOutputContract(),
  ].join('\n');
}

/** Light cleanup mirroring the house OCR-artifact scrub (no content change). */
function cleanChunkText(s: string): string {
  return s
    .replace(/\t+/g, ' ')
    .replace(/ /g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS_PER_CHUNK);
}

/**
 * User message for ONE batch. batchIndex is 0-based; the message renders it
 * 1-based. The batch header restates the merge contract so a model that skims
 * the system prompt still enumerates batch-locally.
 */
export function buildSemanticUserMessage(
  batch: AuditChunk[],
  batchIndex: number,
  batchCount: number,
  knownConcepts: string[],
): string {
  const conceptBlock =
    knownConcepts.length > 0
      ? ['KNOWN CONCEPTS for this chapter (platform metadata — cross-check only, do NOT list from this alone):', ...knownConcepts.map((c) => `- ${c}`)].join('\n')
      : 'KNOWN CONCEPTS for this chapter: (none on record)';

  const chunkBlock = batch
    .map(
      (c) =>
        `[chunk id=${c.chunk_id}${c.content_type ? ` type=${c.content_type}` : ''}]\n${cleanChunkText(c.chunk_text)}`,
    )
    .join('\n\n');

  return [
    `BATCH ${batchIndex + 1} of ${batchCount} — these are batches of ONE chapter. Enumerate items found ONLY in this batch; batch results are merged and deduplicated code-side, so do NOT try to account for other batches.`,
    '',
    conceptBlock,
    '',
    `BATCH CHUNKS (ordered, ${batch.length} in this batch):`,
    '---',
    chunkBlock,
    '---',
    'Audit this batch now. Enumerate only what is present above. Return ONLY the JSON object.',
  ].join('\n');
}

/** Rough token estimate for the cost-guard log line (chars/4 heuristic). */
export function estimateTokens(systemPrompt: string, userMessage: string): number {
  return Math.ceil((systemPrompt.length + userMessage.length) / 4);
}
