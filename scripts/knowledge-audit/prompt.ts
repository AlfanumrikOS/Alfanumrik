/**
 * scripts/knowledge-audit/prompt.ts
 *
 * Builds the LLM prompt for the chunk-pass knowledge audit: given the ordered
 * chunk texts (id + text + type) for ONE chapter plus the known concept list,
 * produce a strict-JSON evidence-grounded count for each of the 22 CHUNK_PASS
 * dimensions, plus chapter-level `metadata_garbled`, `content_contaminated`
 * (+ `contamination_evidence`) and `suspected_missing`.
 *
 * DESIGN PRINCIPLES (P12 / evidence-grounded counting):
 * - Count ONLY what is present in the provided chunks. The prompt explicitly
 *   forbids inferring from chapter titles or outside NCERT knowledge.
 * - NCERT structural conventions are spelled out per dimension (Activity N.M,
 *   Fig. N.M distinct-figure counting, "Example N" vs solved-example-with-steps,
 *   end-of-chapter exercise question counting, formal definition patterns).
 * - Evidence = chunk IDs only (max 5 per dimension). Never quoted text (P13).
 * - `suspected_missing` = short labels of assets REFERENCED but absent
 *   (e.g. "Activity 4.5 referenced but not present") — labels only, no content.
 *
 * Pure module — no I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/prompt.test.ts.
 */

import { CHUNK_PASS_DIMENSIONS, type AuditChunk } from './dimensions';

/** Truncate a single chunk's text so one megachunk can't blow the budget. */
const MAX_CHARS_PER_CHUNK = 12_000;

export interface AuditPromptContext {
  grade: string; // P5: grades are STRINGS "6".."12"
  subject: string;
  chapterNumber: number;
  chapterTitle: string;
}

/** Per-dimension NCERT counting rules injected into the system prompt. */
const DIMENSION_RULES: Record<(typeof CHUNK_PASS_DIMENSIONS)[number], string> = {
  pages:
    'pages: count DISTINCT page markers/numbers if the chunks carry them; if no page markers are present report 0 with a note — never estimate page count from text length.',
  headings:
    'headings: count section/sub-section header lines (numbered like "4.2 ..." or styled headers). A header referenced in prose does not count — only actual header lines.',
  topics:
    'topics: count major numbered sections of the chapter (the "N.M" level, e.g. "4.1", "4.2").',
  subtopics:
    'subtopics: count named sub-section headings below the topic level, whether numbered (the "N.M.K" level, e.g. "4.2.1") or not — new-generation NCERT (Curiosity) books carry NO N.M.K numbering, so count sub-headings by typography/structure (a short title line introducing a sub-section). When the book genuinely has none, report 0 with the note "book has no numbered subtopics".',
  concepts:
    'concepts: count distinct named concepts actually developed in the text (use the KNOWN CONCEPTS list as a cross-check, but count what the CHUNKS develop — a known concept absent from the chunks must NOT be counted; list it in suspected_missing instead).',
  learning_objectives:
    'learning_objectives: count explicit objective/outcome statements ("In this chapter you will learn...", "After studying... you will be able to..."). Report 0 if none are stated.',
  definitions:
    'definitions: count formal definitional sentences only — patterns like "X is defined as", "X is called", "is known as", or a bold/new term immediately followed by its definition. Casual mentions are NOT definitions.',
  formulae:
    'formulae: count DISTINCT mathematical formulae/equations (symbolic relations like v = u + at). The same formula restated counts ONCE.',
  prerequisites:
    'prerequisites: count explicit references to prior knowledge or earlier chapters/classes ("as you learnt in Class 7", "recall from Chapter 2").',
  common_mistakes:
    'common_mistakes: count explicit caution/misconception warnings ("Note that...", "Do not confuse...", "A common error is...").',
  difficulty_mapping:
    'difficulty_mapping: report 0 unless the chunks carry explicit difficulty labels/markers — NCERT text normally has none.',
  examples:
    'examples: count DISTINCT "Example N" / "Example N.M" items. Count each distinct example number once, whether or not it is solved.',
  solved_examples:
    'solved_examples: of the examples, count ONLY those whose worked solution with steps is PRESENT in the chunks (e.g. "Solution:" followed by working). An example statement without its solution text does NOT count as a solved example.',
  exercises:
    'exercises: count INDIVIDUAL questions across ALL question sets — mid-chapter "Exercise N.M" sets, end-of-chapter "Exercises" / "Questions" / "Let us enhance our learning" sections, AND "Intext Questions" blocks — as ONE total question count. Each set restarts its numbering at 1, so SUM across sets (Exercise 6.1 with 6 questions + Exercise 6.2 with 6 questions = 12, not 6). Give the per-set breakdown in notes. Count the questions, not the sections.',
  activities:
    'activities: count DISTINCT "Activity N.M" items (e.g. Activity 4.1, Activity 4.2). A later reference back to an activity does NOT count again — distinct activity numbers only.',
  real_world_applications:
    'real_world_applications: count passages that explicitly connect the concept to everyday life / applications (e.g. "in daily life", applications boxes).',
  tables:
    'tables: count DISTINCT "Table N.M" numbers, or clearly tabular data blocks if unnumbered.',
  diagrams:
    'diagrams: count DISTINCT figure numbers "Fig. N.M" / "Figure N.M". A figure referenced multiple times counts ONCE. Numbering gaps (Fig 4.1 then Fig 4.3) mean the missing figure exists in the book — do NOT count it as found; list it in suspected_missing.',
  image_explanations:
    'image_explanations: count prose passages that explain what an image/figure SHOWS (descriptive text tied to a figure), beyond the bare caption.',
  captions:
    'captions: count figure/table caption lines ("Fig. 4.2: ..." caption text, "Table 4.1: ..." titles).',
  summary:
    'summary: count the number of "Summary" / "What you have learnt" BLOCKS present (normally 0 or 1 — a count of 2 or more is a contamination signal; also set content_contaminated). Report the block\'s bullet/point count in notes, NOT in found_count.',
  keywords:
    'keywords: count terms in an explicit "Keywords"/"New terms" list, or bolded newly-introduced terms if no list exists.',
};

/** The exact JSON skeleton the model must return (all 22 chunk-pass dims). */
export function buildOutputContract(): string {
  const dims = CHUNK_PASS_DIMENSIONS.map(
    (d) => `"${d}":{"found_count":0,"evidence_chunk_ids":[],"notes":""}`,
  ).join(',');
  return `{"dimensions":{${dims}},"metadata_garbled":false,"content_contaminated":false,"contamination_evidence":[],"suspected_missing":[]}`;
}

export function buildAuditSystemPrompt(ctx: AuditPromptContext): string {
  return [
    `You are a meticulous NCERT textbook content auditor for CBSE Class ${ctx.grade} ${ctx.subject}, Chapter ${ctx.chapterNumber}: "${ctx.chapterTitle}".`,
    '',
    'TASK: The user message contains the chapter\'s ingested text chunks (each with a chunk id) and the platform\'s known concept list. For EACH dimension listed below, count how many instances are ACTUALLY PRESENT in the provided chunks and cite evidence.',
    '',
    'ABSOLUTE COUNTING RULES:',
    '- Count ONLY what is present in the provided chunk texts. NEVER infer counts from the chapter title, the known-concept list alone, or your own knowledge of NCERT books. If it is not in the chunks, it was not found.',
    '- Distinct-item counting: a numbered item (Activity 4.1, Fig. 4.2, Example 3, Table 4.1) counts ONCE no matter how many times it is mentioned or referenced.',
    '- Chunks OVERLAP: the ingestion uses sliding-window chunking, so the SAME passage may appear in 2-3 consecutive chunks. Count each distinct item/passage ONCE across ALL chunks. This is especially binding for unnumbered dimensions (definitions, common_mistakes, real_world_applications, image_explanations, learning_objectives, summary bullets): repeated identical or near-identical text is the SAME instance, never a new one.',
    '- evidence_chunk_ids: for each dimension, list UP TO 5 chunk ids (from the ids given in the user message) where instances of that dimension appear. IDs ONLY — never quote chunk text in any field.',
    '- notes: one short sentence max (counting caveats only — no quoted content).',
    '- If a dimension has zero instances in the chunks, report found_count 0 (with an optional note). Reporting an honest 0 is correct; guessing is a failure.',
    '',
    'PER-DIMENSION NCERT CONVENTIONS:',
    ...CHUNK_PASS_DIMENSIONS.map((d) => `- ${DIMENSION_RULES[d]}`),
    '',
    'CHAPTER-LEVEL FIELDS:',
    '- metadata_garbled: true if the chunk texts are substantially OCR-corrupted/unreadable (replacement characters, shattered script, scrambled ordering) such that counts are unreliable; false otherwise.',
    '- content_contaminated: true if the chunks mix in material from a DIFFERENT chapter or book. What contamination looks like: more than one "Summary" / "What you have learnt" block; a figure/example/table/exercise series whose MAJOR number differs from this chapter (e.g. Fig. 13.x or Example 13.x inside Chapter 6); running page-headers naming a different book or subject; an abrupt subject shift mid-chapter (e.g. geometry text suddenly becomes mensuration). Still COUNT everything you find (counts are evidence) — contamination is a flag, not a reason to abstain.',
    '- contamination_evidence: when content_contaminated is true, an array of SHORT LABELS naming the signals — e.g. "second SUMMARY block", "foreign major-number series 13.x", "multiple running headers", "abrupt subject shift". Labels only — never passage text. Empty array when false.',
    '- suspected_missing: an array of SHORT LABELS for assets the text REFERENCES but which are absent from the chunks — e.g. "Activity 4.5 referenced but not present", "Fig. 4.2 missing (numbering gap 4.1 -> 4.3)", "Exercise section truncated after Q7". Labels only — never include passage text.',
    '',
    'OUTPUT FORMAT: Return ONLY a single JSON object, no markdown fences, no commentary, with EXACTLY this shape (every dimension key present):',
    buildOutputContract(),
  ].join('\n');
}

/** Light cleanup mirroring the house OCR-artifact scrub (no content change). */
function cleanChunkText(s: string): string {
  return s
    .replace(/\t+/g, ' ')
    .replace(/ /g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS_PER_CHUNK);
}

export function buildAuditUserMessage(chunks: AuditChunk[], knownConcepts: string[]): string {
  const conceptBlock =
    knownConcepts.length > 0
      ? ['KNOWN CONCEPTS for this chapter (platform metadata — cross-check only, do NOT count from this list):', ...knownConcepts.map((c) => `- ${c}`)].join('\n')
      : 'KNOWN CONCEPTS for this chapter: (none on record)';

  const chunkBlock = chunks
    .map(
      (c) =>
        `[chunk id=${c.chunk_id}${c.content_type ? ` type=${c.content_type}` : ''}]\n${cleanChunkText(c.chunk_text)}`,
    )
    .join('\n\n');

  return [
    conceptBlock,
    '',
    `CHAPTER CHUNKS (ordered, ${chunks.length} total):`,
    '---',
    chunkBlock,
    '---',
    'Audit now. Count only what is present above. Return ONLY the JSON object.',
  ].join('\n');
}

/** Rough token estimate for the cost-guard log line (chars/4 heuristic). */
export function estimateTokens(systemPrompt: string, userMessage: string): number {
  return Math.ceil((systemPrompt.length + userMessage.length) / 4);
}
