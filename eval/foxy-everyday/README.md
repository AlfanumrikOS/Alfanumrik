# Foxy everyday-example rubric (v1)

**What it measures:** whether `ff_foxy_everyday_examples_v1` — the
`EVERYDAY_EXAMPLE_DIRECTIVE` appended to Foxy's structured-output prompt in
`supabase/functions/grounded-answer/structured-prompt.ts` — actually produces
concrete, India-grounded, grade-appropriate, factually safe, relevant examples in
student-facing answers.

**Owner:** assessment. **Status:** offline tooling. Never deployed, never
imported by production code, never writes to the corpus or the database.

---

## 0. Why this exists instead of reusing the B1 RAG harness

The B1 harness (`eval/rag/harness/`) scores nDCG@10 / recall@10 / MRR /
hit-rate@10 / groundedness-rate against `eval/rag/golden/ncert-golden-v1.json`,
whose labels encode exactly one thing: *does this CHUNK answer the query*. There
is no pedagogical-style dimension anywhere in `golden-schema.ts`, and the golden
set binds 4 of the 18 in-scope cells.

It is the wrong instrument, not an under-fitted one:

- This change alters **generation**, not retrieval. A retrieval metric cannot
  move when the system prompt changes, so a flat nDCG would be read as "no
  effect" when the entire effect is in the answer text.
- The change is expected to work on the **26 chapters with zero corpus text**
  (`docs/audits/2026-08-13-rag-math-science-coverage.md` §3) precisely *because*
  it does not depend on retrieval. A retrieval harness scores those chapters as
  unmeasurable.

So: a separate, small, offline rubric. The B1 harness is untouched.

---

## 1. The rubric

Source of truth: `harness/rubric.ts`. The anchor text below is injected verbatim
into the judge prompt, so this document and the judge cannot drift.

### D0 — the primary binary (deterministic, no LLM, free)

> Does the response contain at least one `example` block?

Parse the response JSON; count `blocks[]` entries with `type === "example"` whose
trimmed `text` is at least **20 characters** (`MIN_EXAMPLE_TEXT_CHARS`). 20 is a
non-emptiness floor, not a quality floor: it is far below any real two-sentence
example and far above `""` / `"For example:"`. Quality is the judge's job, and
smuggling a quality judgement into the deterministic gate would put it somewhere
no judge can see or contest.

Three outcomes:

| Response | Verdict for that case | Judge called? |
|---|---|---|
| Parses, has a qualifying `example` block | continue to D1–D5 | yes |
| Parses, no qualifying `example` block | **FAIL** | no |
| Does not parse | **FAIL** (`malformed_response`) | no |
| Never obtained (transport error / missing record) | **UNSEEN → INCONCLUSIVE** | no |

The line is deliberate: *we saw it and it was broken* is a failure (in production
a malformed payload trips the structured-output validator and the student gets a
`wrapAsParagraph` fallback with no example — a real product failure). *We never
saw it* is not something the rubric is entitled to score.

### D1–D5 — the quality dimensions (0 / 1 / 2 each, LLM-judged)

| # | Dimension | 2 | 1 | 0 |
|---|---|---|---|---|
| D1 | **CONCRETE** | A specific, imaginable situation with real particulars — named actors/objects, quantities, or a sequence you could picture. *"Your mother puts 2 spoons of sugar into a glass of hot tea and it disappears, but the same 2 spoons in cold nimbu paani sit at the bottom."* | Gestures at a real situation but stays generic — a category, not an instance. *"When we cook food at home, we see heat transfer happening."* | No situation at all: a bare assertion that examples exist. *"In daily life we see many examples of this concept around us."* |
| D2 | **INDIA-GROUNDED** | A setting an Indian school student knows from their own life: home/school routines, cooking and Indian food, kirana shops and markets, buses/trains/autos, festivals, cricket, the monsoon, power cuts. | Culturally neutral — true anywhere, not specifically familiar (*a car on a highway*, *a mall escalator*). Not wrong, but not what the directive asked for. | A context an Indian student is unlikely to know first-hand, or a foreign default: baseball, snow shovelling, a Thanksgiving turkey, imperial units used as if familiar. |
| D3 | **AGE-APPROPRIATE** | Vocabulary, framing and assumed prior knowledge fit the stated class; nothing unsafe, political, communal or promotional. | Usable but mispitched: babyish for a senior class, or leaning on a later class's concepts. Still safe. | Unsafe, disrespectful to any community, political, promotional, or so far off the class that the student cannot follow it. |
| D4 | **FACTUALLY SAFE** | Asserts nothing beyond ordinary everyday observation; any curriculum fact it touches is consistent with NCERT and carried by the answer's own grounded content. Never presented as something NCERT says; no chapter or citation attribution. | Asserts a curriculum-adjacent claim that is **true but unsupported** anywhere in the answer — an unattributed extra fact. A grounding-hygiene defect. | Asserts something **false**, contradicts NCERT, invents a number/law/definition, **or attributes the everyday example to NCERT / the Reference Material**. |
| D5 | **RELEVANT** | Maps onto the specific concept asked about, and the mapping is visible. | Related to the subject area but illustrates a neighbouring idea, or the mapping is left implicit. | Decoration — does not illustrate the concept, or illustrates it wrongly (a misleading analogy that would create a misconception is a 0, not a 1). |

Max score **10**.

---

## 2. Pass bars — and why these numbers

### 2.1 Per response

A response passes when **all** of the following hold:

```
D0 has_example                     = true
min(D1..D5)                       >= 1        (no dimension may be a flat failure)
D1 + D2  (the "thesis" pair)      >= 3
D1 + D2 + D3 + D4 + D5            >= 7
```

Stated as a conjunction, not a single sum, because a sum alone admits a zeroed
dimension: `2+2+2+1+0 = 7` and `1+2+2+1+1 = 7`, but only one of those is
acceptable.

- **`min >= 1`** — a 0 on any dimension is a failure mode this change is
  supposed to prevent, not a deduction to be averaged away. This alone puts the
  floor at 5/10.
- **`D1 + D2 >= 3`** — the change's entire thesis is *concrete AND Indian*. Two
  1s (sum 2) is exactly the "in daily life we see many examples" shape the
  directive was written to eliminate, and it would clear a per-dimension floor
  while delivering nothing. Requiring 3 means at least one thesis dimension is
  fully met and neither is failed. Requiring 4 (both at 2) was rejected: it makes
  the bar hypersensitive to a single judge disagreement about a genuinely good
  example that happens to be culturally neutral — which our own anchor scores as
  a 1.
- **`total >= 7`** — *derived, not chosen*. The two clauses above already force
  `3 + 1 + 1 + 1 = 6`. Seven adds exactly one point of headroom: at least one of
  {age-appropriate, factually safe, relevant} must also be fully met. 7/10 is
  therefore the smallest integer bar that cannot be reached by a response that is
  merely "partial everywhere plus one good bit". 8 would demand two full-credit
  non-thesis dimensions, over-weighting dimensions this change does not claim to
  move.

### 2.2 Zero tolerance on D4 = 0

**Any single response scoring `factually_safe = 0` anywhere in the flag-ON arm
fails the whole run.** A fabricated or misattributed curriculum fact reaching a
student is a P12 defect, not a quality deduction, and a rate-based bar would hide
it: at n=54, an 85% pass rate leaves room for ~8 fabrications.

### 2.3 Per cell

**A cell passes when at least 2 of its 3 cases pass** (`CELL_PASS_MIN_PASSING_CASES = 2`).

With 3 cases per cell the only reachable rates are 0, ⅓, ⅔, 1, so a per-cell
*percentage* is theatre — the bar is a count.

- 3/3 would fail an entire curriculum cell on one judge disagreement or one
  unlucky generation. The judge is deterministic at temperature 0; the
  *generation* under test is not, so a 3/3 bar measures generation variance more
  than it measures the directive.
- 1/3 is a coin flip dressed as coverage.
- 2/3 is the majority bar and tolerates exactly one miss per cell.

This is the **no-dead-cell** gate: it catches a grade/subject where the directive
systematically fails (say, abstract 12/math) even when the pooled rate looks
healthy.

### 2.4 Run level

```
flag-ON pooled pass rate        >= 0.80                 (absolute floor)
flag-ON rate - control rate     >= 0.30                 (margin over the control arm)
cells below the per-cell bar     = 0
responses with D4 = 0            = 0                    (zero tolerance)
extra harm-band responses        <= 2 vs the control arm
```

**Why 0.80.** At n=54, 0.80 means at most 10 failures. The Wilson 95% lower bound
for 43/54 (0.796) is ≈ **0.675** — so a measured 0.80 supports the claim "at
least two responses in three carry a usable everyday example" at 95% confidence
*at this sample size*. That is the weakest claim worth shipping on. A 0.90 floor
is not defensible here: its Wilson lower bound (~0.79) claims more precision than
54 cases can carry.

**Why a 30pp margin.** The two arms are **paired** (identical cases), so the
null-hypothesis spread is over the discordant pairs: `SE = sqrt(b+c)/n`.

| Discordant pairs | SE | 0.30 in SE units |
|---|---|---|
| 54 (worst case, all pairs flip) | 7.35/54 = 0.136 | 2.2 σ |
| ~20 (realistic) | 4.47/54 = 0.083 | 3.6 σ |

So +30pp is above the noise floor even under the worst case. A 10pp or 15pp
margin would sit *inside* the noise at this n and could be produced by generation
variance alone. And 30pp is comfortably *below* the expected true effect: flag-OFF
the base prompt merely permits an `example` block (it appears in 2 of its 10
few-shots) and never asks for an Indian setting, while the corpus itself carries
explicit day-to-day framing in ~3% of chunks (audit F6) — flag-ON makes it
mandatory and names the settings. A real effect should be of order 0.2 → 0.9. If
the change cannot clear 30pp, it is not doing what it claims.

**Why the harm band is in responses, not percentage points.** At n=54 the
measurement granularity is 1/54 = 1.85pp, so a band like B1's "3pp absolute"
would be 1.6 responses — a fake-precise number smaller than a single observation.
The flag-ON arm may carry at most **2 more** responses than the control that
score ≤1 on `age_appropriate` or ≤1 on `factually_safe`: one response of slack in
each direction absorbs a single judge disagreement; a third is a pattern.

---

## 3. Verdict discipline — PASS / REGRESS / INCONCLUSIVE

Same three-state semantics as `eval/rag/harness/verdict.ts`, with **INCONCLUSIVE
dominating**: a run you cannot trust cannot declare a failure either.

### INCONCLUSIVE is forced by ANY of these (`harness/verdict.ts`)

1. `--dry-run` (the default) — no judge call was made, so nothing was measured.
2. The run was truncated by `--limit`, or case coverage across the 18 cells is
   incomplete.
3. The run's `rubric_version` differs from the harness's, or from the baseline's.
4. **The treatment arm's flag state was not verified** — `observed_state` was
   `'unknown'`, unsourced, or contradicts the arm it claims to be.
5. The control arm's flag state was not verified.
6. **Any case produced no response at all** (transport error / missing capture
   record) — the judge could not see it.
7. **Any case could not be judged** after the judge's single retry.
8. No control arm in the run **and** the committed baseline is a placeholder
   (`metrics_placeholder: true`) — the carry-forward gate.
9. Either arm has no scoreable responses.

INCONCLUSIVE is returned *before* any REGRESS/PASS determination, and every
triggering reason is listed in the report — not just the first.

### REGRESS

The run is complete and trustworthy but failed a stated bar (§2.4). Note the
deliberate semantics: *"did not clear the bar" IS a regression here*, because the
only reason to ship this prompt change is to beat its own control arm. A
treatment arm that matches its control is a change with no measured effect.

### PASS

Complete, trustworthy, every bar cleared.

### Why the flag state is the linchpin

A prompt-flag experiment where you cannot prove which prompt produced the text is
not a measurement, it is an anecdote. `flag.observed_state` is a **required**
three-state field (`true | false | 'unknown'`) and must carry a non-empty
`source`. Writing `'unknown'` is the honest thing to do when you did not check —
and it forces INCONCLUSIVE rather than inviting a guess.

---

## 4. The case set

`cases/everyday-cases-v1.json` — **54 cases** = the 18 CEO-locked cells × 3 turn
types.

- **Cells:** grades 6–10 × {math, science} (10) + grades 11–12 × {math, physics,
  chemistry, biology} (8).
- **Turn types:** one `learn`, one `explain`, one `doubt` per cell. These are the
  three explanation-style modes the shipped directive names. Modes it does *not*
  cover (practice, revise, homework, explorer) are out of scope — a case in an
  uncovered mode would fail D0 by design, not by defect.
- **Zero-corpus coverage:** **8 cases** target chapters measured to have zero
  active chunks (`corpus_state: "zero_corpus"`), across 10/science, 11/math,
  11/chemistry and 11/biology. Every such claim cites the measurement in
  `corpus_evidence`. These cases are the point of the whole exercise: the
  directive changes generation, so it must work where retrieval returns nothing.
- **Everything else is `corpus_state: "unverified"`.** There is deliberately no
  `has_corpus` value: this fixture was authored without DB access and will not
  assert a corpus state it did not measure.
- **P5:** every `grade` is a string.
- **P13:** no PII of any kind. The validator applies the same recursive
  PII-shaped-key ban (`student_id`, `user_id`, `session_id`, `email`, `phone`, at
  any nesting depth including inside arrays) as
  `eval/rag/harness/golden-schema.ts`, to the case set **and** to every capture
  file.

Schema + validator: `harness/case-schema.ts`.

---

## 5. Capturing responses

The harness itself makes **zero generation calls**. An operator captures the raw
Foxy responses into two files — one per arm — and the harness replays them:

```
eval/foxy-everyday/captures/<something>-on.json     ff_foxy_everyday_examples_v1 = ON
eval/foxy-everyday/captures/<something>-off.json    ff_foxy_everyday_examples_v1 = OFF
```

Shape (`harness/capture-schema.ts`, template at
`captures/_template.capture.json`):

```jsonc
{
  "version": "capture-v1",
  "arm": "on",                                  // or "off"
  "case_set_version": "everyday-cases-v1",
  "captured_at": "2026-08-14T09:00:00Z",
  "flag": {
    "name": "ff_foxy_everyday_examples_v1",
    "observed_state": true,                     // true | false | "unknown"  ← REQUIRED
    "observed_at": "2026-08-14T09:00:00Z",
    "source": "feature_flags row read via service-role SELECT before the run"
  },
  "notes": "environment, pipeline path, model routing, operator notes",
  "responses": [
    { "case_id": "g6-math-fractions-learn-001", "raw_response": "{\"title\":…}" },
    { "case_id": "g6-math-ratio-explain-002",   "transport_error": "504 gateway timeout" }
  ]
}
```

`raw_response` is the strict-JSON `FoxyResponse` string exactly as the pipeline
returned it — do not pretty-print, repair or trim it. `transport_error` marks a
response that was never obtained; it makes the run INCONCLUSIVE, which is correct.

**Prefer capturing both arms in the same session** and passing `--off`. A
same-session control arm beats the committed baseline, because prompt, model
routing and corpus all drift between sessions and a stale control silently
inflates the margin.

---

## 6. How a reviewer runs it

From the **repo root**. There is deliberately no `npm run` alias: the existing
`eval:rag:harness` script is declared in `apps/host/package.json` with a body
that resolves relative to `apps/host/`, where no `eval/` directory exists (see
the root `CLAUDE.md` note). Adding a second script with the same trap would be a
worse outcome than one honest command.

**Dry run — the default, costs exactly nothing:**

```bash
npx tsx eval/foxy-everyday/harness/cli.ts \
  --on  eval/foxy-everyday/captures/2026-08-14-on.json \
  --off eval/foxy-everyday/captures/2026-08-14-off.json
```

Prints the plan, the exact **planned judge-call count** (the upper bound on
spend), the baseline state, and `VERDICT: INCONCLUSIVE`. No API call is made.

**Real run — spends Anthropic tokens, requires an explicit flag:**

```bash
ANTHROPIC_API_KEY=… npx tsx eval/foxy-everyday/harness/cli.ts \
  --on  eval/foxy-everyday/captures/2026-08-14-on.json \
  --off eval/foxy-everyday/captures/2026-08-14-off.json \
  --execute
```

Writes a timestamped report to `eval/foxy-everyday/reports/` and prints the
verdict.

Options: `--cases <path>` `--baseline <path>` `--limit 1..54` `--out <dir>`
`--dry-run` `--execute`.

### Spend guards (patterned on `.github/workflows/rag-cosine-replay.yml`)

1. **Dry run is the default.** `--execute` is required to spend a single token,
   and it is spelled out, not a bare boolean.
2. **`--limit` is bounded 1..54 with no unlimited value.** Spend is bounded by
   case count before any API call.
3. **Missing `ANTHROPIC_API_KEY` under `--execute` fails loudly (exit 2)** before
   anything runs. A judge run that quietly does nothing is the vacuously-green
   failure mode this guards.
4. The judge is invoked **only** for responses that already contain an example
   block, so the dry-run number is the exact upper bound (≤ 54 calls per arm).
5. A truncated run can never be a PASS.

### Exit codes

A run that **completes** exits **0** for every verdict — PASS, REGRESS and
INCONCLUSIVE alike. Read the `verdict` field of the report artifact, not the exit
code. Exit **2** is reserved for operator errors that prevented a run: bad args,
missing/invalid fixture or capture, `--execute` without a key, failed AI-layer
import.

---

## 7. Judge

`harness/judge.ts` — structurally a sibling of
`eval/rag/harness/relevance-judge.ts`: same injectable `complete` seam (this
module embeds no AI transport, no SDK import, no endpoint URL), temperature 0,
versioned rubric id, strict-JSON output, fenced-code recovery, clamping, and
never-throws conservative failure.

- **Model: `claude-sonnet-4-5-20250929`** — already registered
  (`packages/lib/src/ai/gateway/registry.ts` `ANTHROPIC_SONNET_ID`), already
  priced, and already the model the B1 relevance judge uses. **No new model, no
  new provider**, so no CEO model-approval gate is tripped. It is *pinned* (the
  CLI passes it through `callClaude`) because the committed baseline is only
  comparable to a run judged by the same judge.
- **A partially-scored judgement is rejected**, not defaulted. Defaulting a
  missing dimension to 0 would invent a failure; defaulting it to 2 would invent
  a pass.
- **One retry, not three.** At temperature 0 the judgement is deterministic, so a
  retry can only recover a transport or truncation blip — it can never re-roll
  for a better score. A case that fails twice surfaces as INCONCLUSIVE.
- The judge prompt is a **P12 artifact**: any wording change is an assessment
  review.

---

## 8. Import boundary

Everything here is offline build-time tooling and must never reach a shipped
bundle. It lives under `eval/**`, where the existing guards already bite:

1. **ESLint** `.eslintrc.json` TIER A `no-restricted-imports` (**error**) — the
   group `**/eval/**/harness/**` matches `eval/foxy-everyday/harness/*` from
   `apps/host/src/app/**`, `apps/host/src/lib/**`, `packages/lib/src/**` and
   `packages/ui/src/**`. No lint edit was needed, and none was made — that config
   carries an explicit warning that reordering its tiers has silently killed live
   rules before.
2. **`apps/host/src/__tests__/eval/rag/import-boundary.test.ts`** — its matcher
   is generic (`[./]eval/`), not rag-specific, so it fails if any non-test file
   under `apps/host/src/{app,components,lib}` imports from this directory. No
   test edit was needed.

**Stated gap:** neither guard scans `supabase/functions/**`. A Deno Edge Function
cannot resolve a repo-root TypeScript path alias anyway (separate module graph),
so the practical risk is nil — but it is not *mechanically* guarded. Owner:
architect, if it ever matters.

---

## 9. Known gaps (v1)

- **English only.** Every case is `language: "en"`. P7 says all user-facing text
  supports Hindi/English, and the shipped directive tells the model to write the
  example in the response's language — so a Hindi/Hinglish arm is a real gap. It
  is deliberately deferred rather than half-done: judging an Indian-context
  example written in Devanagari needs its own anchor calibration, and mixing two
  languages into one 54-case pooled rate would confound the margin.
- **`corpus_state: "unverified"` on 46 of 54 cases.** Chunk presence was not
  measured for those targets. The 8 `zero_corpus` cases are evidenced; nothing
  else claims a corpus state.
- **No inter-rater agreement number.** The anchors are written for two-judge
  agreement, but agreement has not been measured. The honest way to get it is to
  have assessment hand-score a 10-case sample and compare against the judge — a
  cheap follow-up, and the right way to validate the rubric itself rather than
  the change.
- **The control arm has never been run**, so `baseline/everyday-baseline-v1.json`
  ships as a placeholder and every run against it is INCONCLUSIVE by design until
  a real flag-OFF arm is measured.
- **No test files.** Testing owns those. The behaviours worth pinning:
  INCONCLUSIVE domination (each of the 9 conditions), the pass-bar conjunction
  (including `2+2+2+1+0 = 7` failing), D0's malformed-vs-unseen split, the
  PII-key recursion, P5 string grades, and `--dry-run` making zero judge calls.
