"""Verbatim Python port of the Foxy structured-output prompt addendum.

SOURCE OF TRUTH: supabase/functions/grounded-answer/structured-prompt.ts
(itself a mirror of the Node src/lib/foxy/schema.ts constant). This file is a
GENERATED, byte-for-byte port of the RENDERED string — regenerate it whenever
the Deno source changes (see docs/superpowers for the Phase 2.2 MOL-unification
seam). It is prompt-only / provider-portable text; it carries no logic.

Compliance:
  - P12 (AI Safety): appended so the Python MOL emits the SAME strict
    FoxyResponse JSON contract as the TS Claude path. VALIDATION stays on the
    TS side (grounded-answer parseFoxyStructured -> wrapAsParagraph fallback),
    so a shape drift can never render raw JSON to a student.
  - P7 (Bilingual): the addendum instructs the model to answer in the student's
    language without translating technical terms.
"""

FOXY_STRUCTURED_OUTPUT_PROMPT = r"""# OUTPUT FORMAT (STRICT)

Return ONLY valid JSON. No prose, no markdown fences, no commentary, no leading text.

The JSON object MUST match this TypeScript type exactly:

type FoxyResponse = {
  title: string,                                  // 1..120 chars
  subject: "math" | "science" | "sst" | "english" | "general",
  blocks: Array<
    | { type: "paragraph" | "step" | "answer" | "exam_tip" | "definition" | "example" | "question",
        text: string,                             // non-empty, <= 2000 chars. Inline math allowed: \( ... \) inline, \[ ... \] display-in-prose
        label?: string }                          // optional caption, <= 2000 chars
    | { type: "math",
        latex: string,                            // non-empty, <= 500 chars, NO "$" delimiters (standalone display equation)
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
    | { type: "vertical_math",                    // columnar arithmetic (only when VERTICAL MATH DIRECTIVE is active)
        operation: "addition"|"subtraction"|"multiplication"|"long_division",
        operands: string[],                       // at least 2 number strings
        result: string,                           // answer string
        carry_row?: string[],                     // carry digits for addition/subtraction
        remainder?: string,                       // remainder for division
        intermediate_steps?: string[],            // partial products or division steps
        label?: string }
    | { type: "map",                              // geographic/political map (only when MAP DIRECTIVE is active)
        map_type: "political"|"physical"|"thematic"|"historical",
        region: string,                           // e.g. "India", "South Asia"
        map_title?: string,                       // display title
        markers?: Array<{lat: number, lng: number, label: string, description?: string}>,
        highlighted_regions?: string[],           // state/region names to highlight
        layers?: Array<"rivers"|"mountains"|"trade_routes"|"monsoon"|"rainfall"|"vegetation"|"minerals"> }
  >,
  lesson_step?: "hook"|"explanation"|"worked_example"|"guided_practice"|"independent_practice"|"reflection",
  check_question?: /* single block */,            // MCQ gating progression (lesson mode only)
  auto_advance?: boolean                          // auto-advance after voice (lesson mode only)
}

Constraints:
- 1 to 50 blocks total.
- Whole payload <= 16 KB.
- Markdown emphasis is FORBIDDEN anywhere in any field. No "**", no "__", no "#", no ">", no markdown lists. Rely on the block structure (definition, example, step, exam_tip) to organise content — never markdown.
- INLINE MATH inside "text" fields IS ALLOWED and ENCOURAGED for fractions, symbols, exponents, and short expressions that sit inside a sentence. Use \( ... \) for inline math and \[ ... \] for a display equation within prose. Example (raw JSON, backslashes doubled per the JSON ESCAPING rule below): "In \\( \\frac{3}{4} \\), 3 is the numerator and 4 is the denominator." Do NOT use "$" or "$$" delimiters — use the backslash-parenthesis / backslash-bracket form only.
- JSON ESCAPING FOR MATH (CRITICAL): inside JSON string values, every LaTeX backslash MUST be doubled (\\frac not \frac, \\( not \( ). A single backslash before "(", ")", "[", "]" or a LaTeX command letter is an ILLEGAL JSON escape — it breaks JSON.parse and the student sees nothing. Write "\\( \\frac{1}{2} \\)" in the raw JSON; after JSON decoding the renderer receives \( \frac{1}{2} \). The FEW-SHOT EXAMPLES below show correctly doubled raw JSON.
- STANDALONE display equations still use a dedicated "math" block (latex field, no delimiters). Use a "math" block when the equation is the focus of its own line; use inline \( ... \) when math is woven into a sentence.
- The "latex" field of a "math" block must NOT contain "$" or "$$" delimiters and must NOT contain \( \) / \[ \] wrappers — the renderer adds the KaTeX delimiters for math blocks. (The \( \) / \[ \] wrappers are ONLY for inline math written inside a "text" field.)
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

## Math (Class 10, Quadratic numerical) — note inline math inside text fields, with every LaTeX backslash DOUBLED for JSON
{"title":"Solving a Quadratic Equation","subject":"math","blocks":[
  {"type":"definition","text":"A quadratic equation has the form \\( ax^2 + bx + c = 0 \\), where \\( a \\neq 0 \\)."},
  {"type":"step","label":"Given","text":"The equation is \\( x^2 - 5x + 6 = 0 \\)."},
  {"type":"math","label":"Formula","latex":"x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"},
  {"type":"step","label":"Substitution","text":"Here \\( a = 1 \\), \\( b = -5 \\), \\( c = 6 \\)."},
  {"type":"math","label":"Calculation","latex":"x = \\frac{5 \\pm \\sqrt{25 - 24}}{2}"},
  {"type":"answer","text":"\\( x = 3 \\) or \\( x = 2 \\)."},
  {"type":"exam_tip","text":"Always write the final values clearly, examiners look for it."},
  {"type":"question","text":"Now try solving \\( x^2 - 4x + 4 = 0 \\)."}
]}

## Math (Class 6, Fractions) — inline fractions woven into a sentence (JSON-doubled backslashes)
{"title":"Understanding Fractions","subject":"math","blocks":[
  {"type":"definition","text":"A fraction shows a part of a whole. In \\( \\frac{3}{4} \\), 3 is the numerator and 4 is the denominator."},
  {"type":"example","label":"Equivalent Fractions","text":"Multiply numerator and denominator by the same number to get an equivalent fraction: \\( \\frac{1}{2} = \\frac{2}{4} = \\frac{4}{8} \\)."},
  {"type":"question","text":"Is \\( \\frac{3}{6} \\) equivalent to \\( \\frac{1}{2} \\)? Why?"}
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
  {"type":"paragraph","label":"Reactants & Conditions","text":"It requires an iron catalyst, a temperature of about 450 degrees Celsius, and a pressure of 200 atmospheres."},
  {"type":"paragraph","label":"Uses","text":"Ammonia is primarily used to make agricultural fertilizers."},
  {"type":"question","text":"Why is a high pressure used in this specific reaction according to Le Chatelier's principle?"}
]}

## Physics (Class 9, Numerical)
{"title":"Finding Deceleration of a Car","subject":"science","blocks":[
  {"type":"step","label":"Given","text":"Initial velocity u = 20 m/s, final velocity v = 0 m/s (car stops), time t = 4 s."},
  {"type":"math","label":"Formula","latex":"a = \\frac{v - u}{t}"},
  {"type":"exam_tip","text":"Always check units — velocity in m/s and time in s gives acceleration in m/s squared."},
  {"type":"step","label":"Substitution","text":"Put values: a = (0 - 20) / 4"},
  {"type":"math","label":"Calculation","latex":"a = \\frac{-20}{4} = -5 \\text{ m/s}^2"},
  {"type":"answer","text":"The deceleration is 5 m/s squared (negative sign shows the car is slowing down)."},
  {"type":"question","text":"A bike moving at 15 m/s stops in 3 seconds. What is its deceleration?"}
]}

## History / SST (Class 10, Long Answer)
{"title":"Causes of the French Revolution","subject":"sst","blocks":[
  {"type":"paragraph","label":"Historical Background","text":"The French Revolution (1789-1799) was a period of radical political and social transformation in France. Society was divided into three estates: the clergy, nobility, and the Third Estate — with all tax burdens on the Third Estate."},
  {"type":"paragraph","label":"Key Event","text":"The storming of the Bastille on 14 July 1789 marked the symbolic start of the revolution. The Bastille was a royal prison representing royal tyranny."},
  {"type":"paragraph","label":"Causes","text":"Three main causes were: (1) Social inequality between the three estates, (2) Economic crisis worsened by France's involvement in the American War, and (3) Enlightenment ideas of liberty and equality spread by philosophers like Voltaire and Rousseau."},
  {"type":"paragraph","label":"Effects","text":"The monarchy was abolished, Louis XVI was executed in 1793, and France became a republic. The Declaration of the Rights of Man and Citizen was passed."},
  {"type":"exam_tip","text":"In the board exam, list causes as numbered points and always mention at least one Enlightenment thinker for full marks."},
  {"type":"question","text":"How did Enlightenment ideas contribute to the French Revolution? Name two philosophers."}
]}

## English (Grammar)
{"title":"Active and Passive Voice","subject":"english","blocks":[
  {"type":"definition","label":"The Rule","text":"In Active Voice, the subject performs the action: Subject to Verb to Object. In Passive Voice, the subject receives the action: Object to is/was plus past participle to by Subject."},
  {"type":"example","label":"Active vs Passive","text":"Active: Riya wrote the letter. Riya is doing the action. Passive: The letter was written by Riya. The letter is receiving the action."},
  {"type":"paragraph","label":"Common Mistake","text":"Students often forget to change the tense of the verb when converting. If the active verb is writes (present), the passive must be is written — not was written."},
  {"type":"question","text":"Convert to passive voice: The teacher corrects the homework every day."}
]}

## Accountancy (Class 11, Journal Entry)
{"title":"Journal Entry for Cash Purchase","subject":"general","blocks":[
  {"type":"definition","label":"Transaction Analysis","text":"When goods are purchased for cash, two accounts are affected: Purchases Account (nominal, increases expense) and Cash Account (real, asset decreases)."},
  {"type":"paragraph","label":"Accounting Rule Applied","text":"Debit what comes in, Credit what goes out (Real Account rule). Purchases increase so Purchases A/c is Debited. Cash goes out so Cash A/c is Credited."},
  {"type":"paragraph","label":"Journal Entry","text":"Date | Particulars | L.F. | Debit (Rs.) | Credit (Rs.)\n— | Purchases A/c Dr. | | 5,000 | \n  | To Cash A/c | | | 5,000\n  | (Being goods purchased for cash) | | |"},
  {"type":"exam_tip","text":"Always write the narration in brackets below the entry. Missing narration loses 1 mark in CBSE boards."},
  {"type":"question","text":"Pass the journal entry: Furniture purchased for office use for Rs. 12,000 cash."}
]}

## Economics (Class 12, Concept with diagram)
{"title":"The Demand Curve","subject":"sst","blocks":[
  {"type":"definition","text":"The demand curve is a graphical representation showing the inverse relationship between the price of a commodity and the quantity demanded, keeping all other factors constant (ceteris paribus)."},
  {"type":"diagram","search_query":"Demand Curve downward sloping Economics Class 11 CBSE NCERT graph"},
  {"type":"paragraph","label":"Why It Slopes Downward","text":"As price rises, consumers buy less because (1) the commodity becomes relatively expensive compared to substitutes (Substitution Effect), and (2) the consumer's real purchasing power falls (Income Effect). Both effects reduce quantity demanded when price increases."},
  {"type":"example","label":"Real-World Example","text":"When petrol prices rise, people use their cars less and switch to public transport. This is the demand curve at work in real life."},
  {"type":"exam_tip","text":"Movement along the demand curve = change in price only. Shift of the demand curve = change in any other factor (income, taste, related goods)."},
  {"type":"question","text":"Explain the difference between a movement along the demand curve and a shift of the demand curve with examples."}
]}

## Computer Science (Class 12, Programming)
{"title":"Fibonacci Series in Python","subject":"general","blocks":[
  {"type":"paragraph","label":"Problem Restatement","text":"We need to print a sequence where each number is the sum of the two numbers before it: 0, 1, 1, 2, 3, 5, 8 and so on. We must print the first n terms of this series."},
  {"type":"paragraph","label":"Logic Explanation","text":"Start with the first two known terms (0 and 1). Use a loop to repeatedly calculate the next term by adding the last two, then shift the window forward."},
  {"type":"code","language":"python","text":"def fibonacci(n):\n    a, b = 0, 1\n    for i in range(n):\n        print(a, end=' ')\n        a, b = b, a + b\n\nn = int(input('Enter number of terms: '))\nfibonacci(n)"},
  {"type":"paragraph","label":"Expected Output","text":"For n = 7, output is: 0 1 1 2 3 5 8"},
  {"type":"paragraph","label":"Line-by-Line Explanation","text":"a, b = 0, 1 initialises the first two terms. Inside the loop, we print a (the current term), then shift: a becomes b and b becomes a+b (the new next term). This continues n times."},
  {"type":"question","text":"Modify the above program to print the Fibonacci series up to a given sum limit (e.g., stop when the sum exceeds 100) instead of n terms."}
]}

Return ONLY the JSON object. Nothing else."""
