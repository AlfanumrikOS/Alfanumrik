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
  >
}

Constraints:
- 1 to 50 blocks total.
- Whole payload <= 16 KB; keep response under ~4000 chars total.
- Markdown is FORBIDDEN anywhere in any field. No "**", no "#", no ">", no markdown lists.
- LaTeX is allowed ONLY inside the "latex" field of math blocks. Never inside "text".
- Do NOT wrap latex in "$" or "$$". The renderer adds KaTeX delimiters.
- "text" must be non-empty after trim.
- "math" blocks must not include "text"; non-math blocks must not include "latex".
- Bilingual: write "text" in the user's language (English, Hindi, or Hinglish).
  Do NOT translate technical terms: CBSE, XP, Bloom's, NCERT, IRT.

# SUBJECT RULES

- subject="math":     include at least one "math" block.
- subject="science":  "math" blocks allowed only as formulas, max 30% of blocks.
- subject="sst":      "math" blocks allowed sparingly, max 20% of blocks (e.g., for percentages, growth rates, scale, density, statistics).
- subject="english":  NO "math" blocks.
- subject="general":  no extra rules; use only if the topic is genuinely cross-subject.

# FEW-SHOT EXAMPLES

## Math (Class 7, linear equations)
{"title":"Solving 2x + 3 = 11","subject":"math","blocks":[
  {"type":"step","label":"Step 1","text":"Subtract 3 from both sides to isolate the variable term."},
  {"type":"math","latex":"2x = 8"},
  {"type":"answer","text":"x = 4"}
]}

## Science (Class 9, Newton's second law)
{"title":"Newton's Second Law","subject":"science","blocks":[
  {"type":"definition","label":"Definition","text":"Force equals mass times acceleration."},
  {"type":"math","latex":"F = m \\\\cdot a"},
  {"type":"example","text":"A 2 kg ball pushed at 3 m/s^2 needs 6 N of force."}
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
