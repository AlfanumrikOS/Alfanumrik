# Math Rendering & Step-Density Specification

**Status: CANONICAL.** CEO-approved 2026-07-20. Owner: assessment (definition). Implementer: ai-engineer (prompt layer). This document is the single source of truth for how mathematics is formatted in ALL generated content — Foxy tutoring responses, the NCERT math solver pipeline, quiz/question generation, and stored markdown explanations.

---

## 1. Scope & Canonical Status

This spec **supersedes** all code-comment-only conventions. Where a code comment, prompt string, or older doc disagrees with this file, this file wins and the code is updated to match (never the reverse without a new CEO-approved revision here).

### Code locations that implement this spec

| Layer | Location | Role |
|---|---|---|
| Foxy math-format directive | `packages/lib/src/foxy/prompt-sections.ts` — `MATH_FORMAT_DIRECTIVE` + `buildMathFormatDirective(gradeBand)` | **The single in-code source of the step-density rule** (§3). Injected via the `mode_directive` channel, gated by `ff_foxy_math_format_v2`. |
| Foxy base tutor prompt | `supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt` §8 ("Strict Mathematical Formatting Rules") | Delimiter contract + notation rules (§2). Must stay consistent with `MATH_FORMAT_DIRECTIVE`; its per-band density phrasing derives from `buildMathFormatDirective`. |
| NCERT math solver | `packages/lib/src/math/ncert-prompts.ts` — `SHARED_SOLVER_RULES` | Same delimiter contract; step/math/answer block rules for the 3-agent math pipeline. Its "one operation per step" line is the **6-8 band** rule and must become band-aware (§7). |
| Quiz generation | `supabase/functions/quiz-generator/`, `supabase/functions/grounded-answer/prompts/quiz_question_generator_v1.txt` | Question text, options, and explanations follow §2 and §4 (raw-markdown context). |
| Render-time rescue (rescue ONLY, never the fix) | `packages/ui/src/foxy/math-normalization.ts` (+ the tokenizer in `packages/ui/src/foxy/FoxyStructuredRenderer.tsx`) | Normalizes non-compliant output (undelimited LaTeX, `$`/`$$` slips) at display time. See §5. |

Prompts **derive** their math-formatting text from `buildMathFormatDirective` — they never copy-paste it (§6).

---

## 2. Delimiter Contract (approved — do not change)

1. **Inline math** (inside any `text` field or prose sentence): `\( ... \)`.
2. **Display math inside prose** (a display equation embedded in a text field): `\[ ... \]`.
3. **Structured `math` blocks**: the `latex` field carries **bare LaTeX with NO delimiters**. The renderer adds KaTeX delimiters. A `math` block never has a `text` field.
4. **`$` and `$$` are FORBIDDEN in generated content.** The renderer normalizes them if they slip through, but generators never emit them. A generator emitting `$`-delimited math is a prompt-layer bug (§5), not a rendering feature.
5. **No plain Unicode math** — `x²`, `√x`, `∑`, `π` as literal characters are forbidden in generated content.
6. **No ASCII/programming math** — `x^2` as prose, `sqrt(x)`, `a/b` as a fraction, `*` for multiplication, `=>` for implication are forbidden. LaTeX only: `\frac{a}{b}`, `\sqrt{x}`, `\times`/`\cdot`, `\Rightarrow`.
7. **No pseudo-delimiters** — plain parentheses around LaTeX (`(\frac{1}{2})`) or around expressions (`( x = 2 )`) are not math formatting.
8. Standard notation: `\pi`, `\theta`, `\frac{}{}` for every fraction, `\sqrt{}` for every root, true superscripts via `^{}` inside delimiters.

This matches the live contract in `foxy_tutor_v1.txt` §8 and `MATH_FORMAT_DIRECTIVE` rule 3. Non-compliant generators are fixed **at the prompt layer**, never patched with frontend regex (§5).

---

## 3. Grade-Band Step-Density Rule

### 3.1 House shape (all bands — unchanged)

Worked examples and derivations are **numbered `step` blocks alternating with display `math` blocks**:

- Each `step` block is ONE short action/justification line stating what is done (optionally + one short "why" sentence). The UI numbers steps — never write "Step 1" in text or label. `label` is only for short context ("Given", "Formula", "Substitution") or omitted.
- Immediately after each `step`, the RESULTING expression is emitted as its own display `math` block (bare LaTeX in `latex`).
- Derivations never run through a prose paragraph; tall/stacked expressions (fractions of fractions, roots over fractions, summations, integrals) are always display `math` blocks.
- Exactly one terminal `answer` block (structured surfaces), then one Socratic `question` block where the surface requires it.

**The bands below do NOT change this block vocabulary.** They modulate ONE thing: **how many operations may be carried by a single step/math pair.**

### 3.2 The three bands

Band resolution is from the session grade **string** (P5: `"6"`–`"12"`, never integers):

| Band | Grades | Density rule |
|---|---|---|
| **6-8** | `"6"`, `"7"`, `"8"` | Every calculation step shown individually. **ONE operation per step/math pair.** A plain-language label/action line comes BEFORE each step's math (e.g. "Multiply both sides by 3" / "दोनों पक्षों में 3 का गुणा कीजिए"). No condensed multi-step chains — ever. |
| **9-10** | `"9"`, `"10"` | A step/math pair may combine **2-3 ROUTINE operations** (e.g. simplify + collect like terms, group + factor out). Non-routine or error-prone moves still get their own pair. Every pair is still labeled with a plain-language action line. |
| **11-12** | `"11"`, `"12"` | **Board-exam derivation density**: justified equation chains. A step/math pair may carry one logical move of a derivation that compresses several symbolic manipulations; **each line ends with (or is preceded by) a short justification** using CBSE terminology and NCERT theorem names — e.g. "by the Fundamental Theorem of Arithmetic", "by the product rule (NCERT Class 12, Continuity and Differentiability)". Use the ∵/∴ convention **sparingly, in LaTeX as `\because` / `\therefore`** — never the Unicode characters. Use NCERT naming, NOT foreign-textbook naming (no "FOIL", no "Chain Rule (Leibniz notation)" framings alien to NCERT; say "chain rule" as NCERT does). |

Unparseable grades default to the **6-8** band (pedagogically conservative fallback, matching `resolveGradeBand`).

### 3.3 Worked example per band

The JSON below shows wire-format blocks; backslashes are JSON-escaped (`\\frac` on the wire renders `\frac`).

#### Band 6-8 — linear equation (one operation per pair, labeled)

Problem: solve `3x + 5 = 20`.

```json
{"type":"step","label":"Given","text":"Solve \\( 3x + 5 = 20 \\)."}
{"type":"math","latex":"3x + 5 = 20"}
{"type":"step","text":"Subtract 5 from both sides."}
{"type":"math","latex":"3x = 15"}
{"type":"step","text":"Divide both sides by 3."}
{"type":"math","latex":"x = 5"}
{"type":"answer","text":"\\( x = 5 \\)"}
```

Hindi student — the labels/action lines translate, the LaTeX does not:

```json
{"type":"step","text":"दोनों पक्षों से 5 घटाइए।"}
{"type":"math","latex":"3x = 15"}
```

Note: subtracting 5 and dividing by 3 are two SEPARATE pairs. Combining them ("Subtract 5 and divide by 3") is a 6-8 violation.

#### Band 9-10 — quadratic (2-3 routine operations may combine, still labeled)

Problem: solve `x² − 5x + 6 = 0` by splitting the middle term (NCERT Class 10, Quadratic Equations).

```json
{"type":"step","label":"Given","text":"Solve \\( x^2 - 5x + 6 = 0 \\) by splitting the middle term."}
{"type":"math","latex":"x^2 - 5x + 6 = 0"}
{"type":"step","text":"Split the middle term: two numbers with product \\( 6 \\) and sum \\( -5 \\) are \\( -2 \\) and \\( -3 \\)."}
{"type":"math","latex":"x^2 - 2x - 3x + 6 = 0"}
{"type":"step","text":"Group the terms and take the common factor out of each pair."}
{"type":"math","latex":"x(x - 2) - 3(x - 2) = 0"}
{"type":"step","text":"Factor out \\( (x - 2) \\) and set each factor equal to zero."}
{"type":"math","latex":"(x - 2)(x - 3) = 0"}
{"type":"step","text":"Solve each factor."}
{"type":"math","latex":"x = 2 \\quad \\text{or} \\quad x = 3"}
{"type":"answer","text":"\\( x = 2 \\) or \\( x = 3 \\)"}
```

Note: "group + factor each pair" and "factor out + set to zero" each combine two routine operations into one labeled pair. At band 6-8 each of those would be separate pairs; at 9-10 this is the intended density.

#### Band 11-12 — differentiation (justified chains, NCERT theorem names, sparing `\because`)

Problem: differentiate `y = x² sin x` (NCERT Class 12, Continuity and Differentiability).

```json
{"type":"step","label":"Given","text":"Differentiate \\( y = x^2 \\sin x \\) with respect to \\( x \\)."}
{"type":"math","latex":"y = x^2 \\sin x"}
{"type":"step","text":"Apply the product rule with \\( u = x^2 \\), \\( v = \\sin x \\) — by the product rule of differentiation (NCERT Class 12)."}
{"type":"math","latex":"\\frac{dy}{dx} = x^2 \\, \\frac{d}{dx}(\\sin x) + \\sin x \\, \\frac{d}{dx}(x^2)"}
{"type":"step","text":"Differentiate each factor and simplify, using the standard NCERT results for \\( \\sin x \\) and \\( x^n \\)."}
{"type":"math","latex":"\\frac{dy}{dx} = x^2 \\cos x + 2x \\sin x \\quad \\left[ \\because \\tfrac{d}{dx}\\sin x = \\cos x,\\ \\tfrac{d}{dx}x^n = nx^{n-1} \\right]"}
{"type":"answer","text":"\\( \\frac{dy}{dx} = x^2 \\cos x + 2x \\sin x \\)"}
```

Note the board-exam density: the second pair compresses two differentiations plus the simplification into one justified line, with the justification bracketed at the end of the math line using `\because`. Justifications name NCERT results ("product rule", "Fundamental Theorem of Arithmetic", "converse of BPT") — never foreign-textbook mnemonics.

### 3.4 Bilingual rule (P7)

Step labels and action lines are user-facing text: generators emit them **in the student's language** (English, Hindi, or Hinglish per session). Technical terms — CBSE, NCERT, XP, Bloom's, theorem names, SI units — stay in English (untranslated). **The LaTeX itself is language-neutral** and identical across languages: `\frac{3}{4}` is `\frac{3}{4}` in every language.

---

## 4. Answer-Boxing Rule (state at every grade)

The "boxed final answer" convention has exactly two implementations, chosen by surface:

1. **Structured surfaces (Foxy envelopes / `FoxyResponse` blocks)**: the styled terminal **`answer` block IS the boxed-answer convention**. The UI renders it visually distinguished. Do **NOT** additionally wrap the value in `\boxed{}` inside an `answer` block — that would double-box.
2. **Raw-markdown contexts that have NO `answer` block** (e.g. stored markdown explanations in `question_bank.explanation`, exported reports, any markdown surface without the structured envelope): use **`\boxed{...}`** around the final value, inside normal delimiters — e.g. `\( \boxed{x = 5} \)` or a display line `\[ \boxed{\frac{dy}{dx} = x^2\cos x + 2x\sin x} \]`.

This applies at **every** grade band. `\boxed{}` never appears on structured surfaces; the `answer` block never appears in raw markdown.

---

## 5. Compliance: which layer fixes violations

| Layer | Responsibility |
|---|---|
| **Prompt layer (the fix)** | Non-compliant generators (wrong delimiters, `$`, Unicode/ASCII math, wrong density for the band) are fixed by correcting the prompt that derives from `buildMathFormatDirective`. Owner: ai-engineer, with assessment review. |
| **Render-time normalizer (the rescue, singular)** | `packages/ui/src/foxy/math-normalization.ts` (plus the tokenizer's `$`/`$$` acceptance in `FoxyStructuredRenderer.tsx`) is the ONE render-time rescue for content that slips through: undelimited allowlisted LaTeX commands, fake-paren delimiters, `$` slips. It exists so a student never sees raw LaTeX; it is **not** a license for generators to be sloppy. |

Hard rules:

- **Never add a second frontend regex patch** for a formatting violation. If the normalizer's telemetry shows a recurring violation class, the fix goes into the prompt layer; the normalizer stays narrow (backslash-command allowlist trigger only).
- The normalizer must remain byte-identical on already-compliant input (checkable guarantee in `normalizeMathSegments`).
- P12 posture unchanged: KaTeX renders with `throwOnError: false` + code fallback — a bad span degrades, never blanks the chat.

---

## 6. Single Source: `buildMathFormatDirective`

The step-density rule of §3 lives in **one place in code**: `buildMathFormatDirective(gradeBand)` in `packages/lib/src/foxy/prompt-sections.ts`. Every prompt that needs math-formatting rules — Foxy mode directives, `foxy_tutor_v1.txt` §8's density phrasing, `SHARED_SOLVER_RULES`, quiz-generation prompts — **derives from it (imports/composes the built string or is generated from it), never copy-pastes it.** A copy-pasted duplicate is a rejectable change: duplicates drift, and drift here means two students at the same grade get different formatting contracts.

The delimiter contract (§2) is band-invariant and may be stated verbatim in static prompts (it already is, consistently, in `foxy_tutor_v1.txt` §8 and `SHARED_SOLVER_RULES`) — but any change to it starts in this doc, then flows to `buildMathFormatDirective`, then to the static prompts, in that order.

---

## 7. Implementation notes for ai-engineer (definition → code deltas)

This spec is definition-only; no code changed with it. The known deltas to implement:

1. **`GradeBand` type widens** from `'6-8' | '9-12'` to `'6-8' | '9-10' | '11-12'`, and `resolveGradeBand` splits 9-10 from 11-12 (fallback stays `'6-8'`). The 2026-07-16 "both bands identical" CEO constraint is superseded by this spec.
2. **`buildMathFormatDirective` emits three distinct directives.** The current `MATH_FORMAT_DIRECTIVE` text ("NEVER chain multiple transformations inside one step or one math block") is the **6-8 band** text. The 9-10 and 11-12 variants keep rules 2 (display vs inline) and 3 (delimiters) verbatim and replace rule 1's density with §3.2. Keep the inline-flat-equation allowance (`\( 2x + 3 = 7 \)` stays legal in prose) at all bands.
3. **`SHARED_SOLVER_RULES` ("one operation per step — never combine") is currently band-invariant** — it encodes the 6-8 density for all grades. It must become band-aware, deriving its numbered-working rule from `buildMathFormatDirective`. Caution: these prompts are prompt-cache-stable; band-aware text means one cached prefix **per band**, which is fine (band is part of the grade key already) — do not vary text within a band.
4. **`foxy_tutor_v1.txt` §8** line "Never compress multiple operations into one line" is likewise 6-8-absolute; its replacement phrasing derives from the band rule. §8's "Final answers should be clearly boxed, highlighted, or distinguished" is clarified by §4: `answer` block on structured surfaces, `\boxed{}` only in raw markdown.
5. **Quiz-generation explanations** are raw-markdown surfaces: §2 delimiters + §4 `\boxed{}` apply; density follows the band of the question's grade.
6. Flag-gating (`ff_foxy_math_format_v2`) and the byte-identical flag-OFF guarantee are unchanged by this spec.

Review chain (P14): assessment (this definition) → ai-engineer (implementation) → testing (band-resolution + directive-content assertions) → frontend/quality if renderer surface changes.

---

## 8. Erratum (2026-07-20): §3.3 illustration vs the in-code 6-8 few-shot

The in-code few-shot inside `buildMathFormatDirective('6-8')` is **intentionally** the fraction-cancellation example (`\frac{14}{15} \times \frac{25}{42} \rightarrow \frac{5}{9}`), NOT the §3.3 band 6-8 linear-equation illustration (`3x + 5 = 20`). This is not drift: §7 item 2 pins the 6-8 directive **byte-identical** to the pre-refactor `MATH_FORMAT_DIRECTIVE` literal, and that guarantee is test-enforced (`apps/host/src/__tests__/api/foxy/math-format-directive.test.ts` asserts `buildMathFormatDirective('6-8') === MATH_FORMAT_DIRECTIVE`, including the fraction few-shot content pins). The §3.3 examples illustrate the density RULE per band; they are not a contract on which worked example the directive text ships. A future "conformance fix" that swaps the in-code few-shot to match §3.3 would break the byte-identity guarantee and MUST NOT be made without a deliberate, assessment-approved revision of the directive text (which starts in this doc per §6, then flows to code and its pinning tests, in that order).

---

## 9. vertical_math structured block (PR #1344) — sanctioned sibling renderer (2026-07-20)

PR #1344 (merged to main; reconciled into this branch during the canonical-math
rebase) added a `vertical_math` structured block type to `FoxyResponseSchema`,
rendered by the lazy-loaded component `packages/ui/src/foxy/VerticalMathBlock.tsx`
and dispatched from `FoxyStructuredRenderer.tsx` (a `map` block /
`MapBlock.tsx` shipped in the same PR under the same pattern).

**Status under the one-math-pipeline rule (§1):** `vertical_math` is a
**structured BLOCK renderer** — like `mermaid` — not a second LaTeX pipeline.
Audit of `VerticalMathBlock.tsx` and `MapBlock.tsx` (2026-07-20, during the
rebase-conflict resolution):

- No `katex` import, no KaTeX API usage, no `katex.min.css` import of its own.
- No `dangerouslySetInnerHTML` anywhere in either component.
- No math-delimiter regexes, no markdown parsing, no normalizer logic. The only
  string transform in `VerticalMathBlock.tsx` is `replace(/[^0-9.]/g, '')` on
  operands/result — digit-stripping for CSS Grid column alignment, not LaTeX
  processing.
- Dependencies: React, `@alfanumrik/lib/foxy/schema` types, and
  `useAuth().isHi` for bilingual chrome (P7). Layout is CSS Grid + Tailwind.

It is therefore **sanctioned as a sibling** of the canonical math module.
Constraints going forward:

1. Any LaTeX/markdown/normalization needs inside `vertical_math` (or `map`)
   cells MUST route through the canonical module `packages/ui/src/math/`
   (`normalize.ts` + `katex-segments.tsx`) and comply with the §2 delimiter
   contract. Do NOT add a private KaTeX call, delimiter regex, or markdown
   parser to these components.
2. The dispatch site in `FoxyStructuredRenderer.tsx` carries a comment pinning
   this rule; keep the comment adjacent to the `case 'vertical_math':` branch.
3. Both components stay lazy-loaded via `next/dynamic` (P10).
