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
    | { type: "diagram",
        search_query: string }                    // e.g. "Human Heart labeled diagram Class 10"
    | { type: "code",
        text: string,                             // actual code snippet
        language?: string }                       // e.g. "python", "cpp"
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
- Whole payload <= 16 KB.
- Markdown is FORBIDDEN anywhere in any field. No "**", no "#", no ">", no markdown lists.
- LaTeX is allowed ONLY inside the "latex" field of math blocks. Never inside "text".
- Do NOT wrap latex in "$" or "$$". The renderer adds KaTeX delimiters.
- "text" must be non-empty after trim.
- "math" blocks must not include "text"; non-math blocks must not include "latex".
- "diagram" blocks must not include "text" or "latex".
- Bilingual: write "text" in the user's language (English, Hindi, or Hinglish).
  Do NOT translate technical terms: CBSE, XP, Bloom's, NCERT, IRT.
- Use "step" blocks ONLY for actual sequential steps (calculations, derivations, sequential procedures). Do NOT use them for static facts, classifications, or definitions.
- Do NOT include the word "Step" or the step number in the "label" or "text" of step blocks. The UI renderer automatically numbers and formats them. Use "label" only for brief sub-topic context (e.g., "Given", "Formula", "Calculation") or omit it.

# SUBJECT RULES

- subject="math":     include at least one "math" block. Never write long prose.
- subject="science":  "math" blocks allowed only as formulas, max 30% of blocks. Use "diagram" blocks for structures/processes.
- subject="sst":      "math" blocks allowed sparingly, max 20% of blocks (e.g., for percentages, growth rates, scale, density, statistics). Use "diagram" blocks for maps/cycles.
- subject="english":  NO "math" blocks. NO "diagram" blocks.
- subject="general":  no extra rules; use only if the topic is genuinely cross-subject.

# FEW-SHOT EXAMPLES

## Math (Class 10, Quadratic numerical)
{"title":"Solving a Quadratic Equation","subject":"math","blocks":[
  {"type":"step","label":"Given","text":"The equation is x^2 - 5x + 6 = 0."},
  {"type":"math","label":"Formula","latex":"x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"},
  {"type":"step","label":"Substitution","text":"Here a=1, b=-5, c=6."},
  {"type":"math","label":"Calculation","latex":"x = \\frac{5 \\pm \\sqrt{25 - 24}}{2}"},
  {"type":"answer","text":"x = 3 or x = 2"},
  {"type":"exam_tip","text":"Always write the final values clearly, examiners look for it."},
  {"type":"question","text":"Now try solving x^2 - 4x + 4 = 0."}
]}

## Biology (Class 10, Process with diagram)
{"title":"Human Digestive System","subject":"science","blocks":[
  {"type":"paragraph","label":"Overview","text":"Digestion is the breakdown of large insoluble food molecules into small water-soluble food molecules."},
  {"type":"diagram","search_query":"Human Digestive System Class 10 NCERT diagram"},
  {"type":"step","label":"Mouth","text":"Digestion begins here with salivary amylase breaking down starch."},
  {"type":"step","label":"Stomach","text":"Gastric juices and HCl break down proteins."},
  {"type":"step","label":"Small Intestine","text":"Complete digestion occurs here and nutrients are absorbed."},
  {"type":"paragraph","label":"Summary","text":"The process ensures our body gets the energy it needs from food."},
  {"type":"question","text":"What role does the liver play in this process?"}
]}

## Chemistry (Class 11, Reaction)
{"title":"Haber Process","subject":"science","blocks":[
  {"type":"paragraph","label":"Reaction Overview","text":"The Haber process is the industrial implementation of the reaction of nitrogen gas with hydrogen gas to produce ammonia."},
  {"type":"math","latex":"N_2(g) + 3H_2(g) \\rightleftharpoons 2NH_3(g)"},
  {"type":"paragraph","label":"Reactants & Conditions","text":"It requires an iron catalyst, a temperature of about 450°C, and a pressure of 200 atmospheres."},
  {"type":"paragraph","label":"Uses","text":"Ammonia is primarily used to make agricultural fertilizers."},
  {"type":"question","text":"Why is a high pressure used in this specific reaction according to Le Chatelier's principle?"}
]}

Return ONLY the JSON object. Nothing else.
`.trim();
