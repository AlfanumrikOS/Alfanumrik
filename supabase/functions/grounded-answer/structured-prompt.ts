// supabase/functions/grounded-answer/structured-prompt.ts
//
// Deno-side mirror of FOXY_STRUCTURED_OUTPUT_PROMPT.
//
// SOURCE OF TRUTH: src/lib/foxy/schema.ts -- the Node-side
// `FOXY_STRUCTURED_OUTPUT_PROMPT` constant. Copy this verbatim when the source
// changes. Drift is detected by the parity test in
// `src/__tests__/lib/foxy/prompt-addendum-parity.test.ts` (Node side) so a
// stale copy here will fail CI.
//
// Why duplicate: Deno cannot import from `src/` (separate module graph, no
// path alias resolution). Keeping a literal copy here means the deployed Edge
// Function bundles the addendum without depending on the Node build.
//
// Wired in `pipeline.ts` (and `pipeline-stream.ts`) for the Foxy caller only.
// All other callers (ncert-solver, quiz-generator, concept-engine, diagnostic)
// keep their existing text-only output -- this addendum is appended to the
// resolved system prompt for `caller === 'foxy'` exclusively.
//
// Compliance:
//   - P12 (AI Safety): structured output is a strict gate. Malformed output is
//     caught by the validator and the consumer falls back to wrapAsParagraph.
//   - P7 (Bilingual UI): addendum text instructs the model to write in the
//     user's language (English / Hindi / Hinglish) without translating
//     technical terms.

export const FOXY_STRUCTURED_OUTPUT_PROMPT = `
# OUTPUT FORMAT (STRICT)

Return ONLY valid JSON. No prose, no markdown fences, no commentary, no leading text.

The JSON object MUST match this TypeScript type exactly:

type FoxyResponse = {
  title: string,                                  // 1..120 chars
  subject: "math" | "science" | "sst" | "english" | "general",
  blocks: Array<
    | { type: "paragraph" | "step" | "answer" | "exam_tip" | "definition" | "example" | "question",
        text: string,                             // non-empty, <= 2000 chars
        label?: string }                          // optional caption, <= 2000 chars
    | { type: "math",
        latex: string,                            // non-empty, <= 500 chars, NO "$" delimiters
        label?: string }
    | { type: "mcq",                              // 4-option multiple choice (use ONLY in quiz/practice modes)
        stem: string,                             // 10..2000 chars, the question prompt
        options: [string, string, string, string],// EXACTLY 4 distinct non-empty options
        correct_answer_index: 0 | 1 | 2 | 3,
        explanation: string,                      // 10..2000 chars, why the correct answer is correct
        bloom_level?: "Remember"|"Understand"|"Apply"|"Analyze"|"Evaluate"|"Create",
        difficulty?: "easy"|"medium"|"hard",
        label?: string }
  >
}

Constraints:
- 1 to 50 blocks total.
- For simple definitions/facts: 3-5 blocks is fine.
- For explanations, how/why questions: use 6-12 blocks to teach thoroughly. Do NOT stop at 2-3.
- Whole payload <= 16 KB.
- Markdown is FORBIDDEN anywhere in any field. No "**", no "#", no ">", no markdown lists.
- LaTeX is allowed ONLY inside the "latex" field of math blocks. Never inside "text".
- Do NOT wrap latex in "$" or "$$". The renderer adds KaTeX delimiters.
- "text" must be non-empty after trim.
- "math" blocks must not include "text"; non-math blocks must not include "latex".
- Bilingual: write "text" in the user's language (English, Hindi, or Hinglish).
  Do NOT translate technical terms: CBSE, XP, Bloom's, NCERT, IRT.
- Use "step" blocks ONLY for actual sequential steps (calculations, derivations, sequential procedures). Do NOT use them for static facts, classifications, or definitions. For general concept explanations, prefer "definition", "paragraph", and "example" blocks.
- Do NOT include the word "Step" or the step number in the "label" or "text" of step blocks. The UI renderer automatically numbers and formats them. Use "label" only for brief sub-topic context (e.g., "Given", "Formula", "Calculation") or omit it.

# SUBJECT RULES

- subject="math":     include at least one "math" block.
- subject="science":  "math" blocks allowed only as formulas, max 30% of blocks.
- subject="sst":      "math" blocks allowed sparingly, max 20% of blocks (e.g., for percentages, growth rates, scale, density, statistics).
- subject="english":  NO "math" blocks.
- subject="general":  no extra rules; use only if the topic is genuinely cross-subject.

# FEW-SHOT EXAMPLES

## Science (Class 12, Solid State — rich explanation)
{"title":"Understanding the Solid State","subject":"science","blocks":[
  {"type":"definition","label":"What is the Solid State?","text":"The solid state is a physical state of matter in which particles (atoms, ions, or molecules) are tightly packed together in a fixed, ordered arrangement. Solids have a definite shape and volume."},
  {"type":"paragraph","text":"Why are solids so rigid? The particles in a solid are held together by very strong intermolecular forces of attraction. Unlike liquids or gases, the particles in a solid cannot move freely — they can only vibrate about their fixed positions."},
  {"type":"paragraph","label":"Key Properties","text":"Solids have four characteristic properties: (1) definite shape and volume, (2) high density compared to liquids and gases, (3) low compressibility, and (4) rigidity — they resist changes to their shape."},
  {"type":"paragraph","label":"Types of Solids","text":"There are two broad categories: Crystalline solids (like salt and diamond) where particles are arranged in a repeating, long-range ordered pattern called a crystal lattice; and Amorphous solids (like glass and rubber) where particles have only short-range order without a regular repeating pattern."},
  {"type":"example","text":"Think of a crystalline solid like a well-organised army parade where every soldier stands exactly in line. An amorphous solid is like a crowd at a bus stop — loosely arranged without a fixed pattern."},
  {"type":"paragraph","label":"Why This Matters for CBSE","text":"In your Class 12 exams, questions often ask you to distinguish crystalline from amorphous solids, or to explain why solids are incompressible. Remember: the answer always links back to the strong intermolecular forces holding particles in fixed positions."},
  {"type":"question","text":"Now your turn: Can you name two examples of amorphous solids from everyday life and explain why they do not have a sharp melting point like crystalline solids do?"}
]}

## Math (Class 7, linear equations)
{"title":"Solving 2x + 3 = 11","subject":"math","blocks":[
  {"type":"step","label":"Isolate x term","text":"Subtract 3 from both sides of the equation."},
  {"type":"math","latex":"2x = 8"},
  {"type":"step","label":"Solve for x","text":"Divide both sides by 2."},
  {"type":"answer","text":"x = 4"}
]}

## SST (Class 8, Constitution of India)
{"title":"Preamble of the Constitution","subject":"sst","blocks":[
  {"type":"paragraph","text":"The Preamble declares India a sovereign, socialist, secular, democratic republic."},
  {"type":"exam_tip","text":"In CBSE exams, remember the four pillars: Justice, Liberty, Equality, Fraternity."}
]}

## English (Class 6, parts of speech)
{"title":"Nouns vs Pronouns","subject":"english","blocks":[
  {"type":"definition","label":"Noun","text":"A noun names a person, place, thing, or idea."},
  {"type":"example","text":"In 'Riya read her book', 'Riya' and 'book' are nouns; 'her' is a pronoun."}
]}

Return ONLY the JSON object. Nothing else.
`.trim();
