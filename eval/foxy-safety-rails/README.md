# Foxy safety-rails paired eval (PROMPT_REV 3 vs 4)

**Why this exists:** assessment approved the safety-rails wiring change WITH
CONDITIONS. Condition **C6** requires a rev-3-vs-rev-4 quality eval before
deploy. This directory is that eval.

**Status:** offline measurement tooling. Never deployed, never imported by
production code, never writes to the corpus or the database. Read-only with
respect to the repo: it composes prompts from files it reads, it does not edit
them.

---

## 0. Why NOT `eval/foxy-everyday/`

`eval/foxy-everyday/` is the closest committed harness, and it is the **wrong
instrument** for C6 for two independent reasons. Either one alone would be
disqualifying.

**(a) It has no corpus to run on.** It is a *replay* harness — it makes zero
generation calls by design (`README.md` §5: "The harness itself makes **zero**
generation calls"). An operator must first capture raw Foxy responses into
`eval/foxy-everyday/captures/<name>-{on,off}.json`. That directory contains
exactly one file, `_template.capture.json`, which is a template whose
`observed_state` ships as `"unknown"` **on purpose** so a half-filled capture
can never be mistaken for a measurement. There are no committed captures, so the
harness cannot be run end-to-end as-is. (This is the same class of gap as
`eval/openai-migration/`, whose `--fixtures` directory does not exist at all.)

**(b) It measures a different construct.** Its rubric is D0–D5:
`has_example`, `concrete`, `india_grounded`, `age_appropriate`,
`factually_safe`, `relevant` — the quality of the *everyday example* produced by
`ff_foxy_everyday_examples_v1`. It has **no dimension** for anti-sycophancy,
grounding-source discipline, refusal copy, persona register, or response length.
Its arms are `flag ON` vs `flag OFF`, not `rev3` vs `rev4`; filling its
`capture.flag.observed_state` field with a rev label would be a false statement
in the artifact that its own verdict logic treats as the linchpin of
trustworthiness. And its verdict would be forced INCONCLUSIVE anyway (truncated
run + incomplete 18-cell coverage + placeholder baseline).

So this is a separate, small, purpose-built instrument. `eval/foxy-everyday/`
is untouched.

---

## 1. How the two arms are obtained

The working tree is the **rev 4** arm. The **rev 3** arm is obtained read-only:

```bash
mkdir -p <scratch>/rev3/prompts
for t in foxy_tutor_teach_v1 foxy_tutor_exam_v1 foxy_tutor_doubt_v1; do
  git show "HEAD:supabase/functions/grounded-answer/prompts/$t.txt" \
    > "<scratch>/rev3/prompts/$t.txt"
done
```

`git show` was used rather than `git worktree` because a throwaway worktree of
this repo fails on Windows (`docs/audit/.../06-CERT-17-...md`: "Filename too
long"), which leaves a half-checked-out tree. `git show` touches nothing.

The one non-template rev-3 difference is `MODE_DIRECTIVES.homework`, which does
not exist at HEAD. `run.ts` derives the rev-3 map by deleting that key; every
other entry is byte-unchanged in the diff, so the derivation is exact.

## 2. What `compose.ts` reproduces

The grounded-answer pipeline needs Supabase, pgvector, Redis, feature flags and
a live student row — none of which are available offline, and none of which
changed. What changed is pure data: the template text on disk, and which
`template_variables` that text declares slots for. `compose.ts` mirrors
`pipeline.ts` Step 9 line-for-line (references are in the file) and imports the
real `FOXY_SAFETY_RAILS`, `MODE_DIRECTIVES` and `FOXY_STRUCTURED_OUTPUT_PROMPT`
rather than copying them, so the composed prompt cannot drift from production.

Generation parameters are the production ones: `claude-haiku-4-5-20251001`
(`MODEL_FALLBACK_ORDER.auto` rung 1), `max_tokens = MODE_MAX_TOKENS[mode] × 1.6`,
`temperature = 0.1` when chunks are present / `0.3` when not,
`messages = [...conversation_turns, {role:'user', content: query}]`.

## 3. Running it

```bash
# Dry run — the DEFAULT. Zero API calls. Prints the per-case prompt delta.
npx tsx --tsconfig eval/foxy-safety-rails/tsconfig.json \
  eval/foxy-safety-rails/harness/run.ts --rev3-dir <scratch>/rev3/prompts

# Real run — spends tokens, requires the explicit flag.
npx tsx --tsconfig eval/foxy-safety-rails/tsconfig.json \
  eval/foxy-safety-rails/harness/run.ts --rev3-dir <scratch>/rev3/prompts --execute
```

`--tsconfig` is required: `@alfanumrik/lib/*` is declared in
`apps/host/tsconfig.json` and does not resolve from the repo root without it.

Spend guards: dry run is the default; `--execute` is required to spend a token;
`--limit` bounds the case count before any call; a missing `ANTHROPIC_API_KEY`
under `--execute` exits 2 before anything runs. The key is read from env or
`.env.local` and is never printed or written to an artifact.

## 4. Case set

`cases/rails-cases-v1.json` — 15 cases across the six risks assessment flagged.
P5 (grades are strings) and P13 (no PII) hold throughout.

The `chunks` arrays are hand-authored NCERT-**shaped** text. They exist only to
drive the has-chunks / zero-chunks branch of `modeInstructionFor`
deterministically, which is the branch under test. **They are not a corpus
fixture** and must not be cited as one.

## 5. Known limits

- **n is small.** 15 cases × 2 arms, plus 2 extra repeats of the 4 rail-6 cases.
  Enough to detect a gross, reproducible regression; not enough to estimate a
  rate. No pass/fail bar is defined here on purpose — a bar invented by the
  implementing agent to grade its own change is not a bar. Assessment owns any
  threshold.
- **No LLM judge.** The findings are deterministic (envelope shape, exact
  mandated strings, block counts, word counts, production recovery outcome)
  plus raw outputs read directly. A judge rubric would be a P12 artifact needing
  assessment review, and the deterministic checks were sufficient.
- **Rail 7's Devanagari refusal was never exercised.** The model did not reach
  the refusal branch on either arm for the Hindi case, so that rail is
  **unmeasured**, not passed.
- `out/` holds the raw run artifacts. Untracked; do not commit without a PII
  re-check (the current contents are model output on synthetic cases only).
