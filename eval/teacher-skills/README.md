# Teacher-Skills Eval Harness

Offline, standalone eval harness that scores AI-generated educational
artifacts (Foxy explanations, quiz-generator batches, lesson-plan /
differentiation artifacts) against rubric CSVs adapted from Anthropic +
Learning Commons' **Agent Skills for K-12 Teachers** eval framework.

Follows the house eval architecture of `eval/rag/harness/` (pure assembler +
injected deps + operator CLI; pinned as the pattern by REG-140 — nothing under
`eval/rag/` is touched by this harness).

## Hard constraints (read first)

- **Dev/CI tool ONLY.** No production wiring, no new services, no runtime
  flags. Nothing here is imported by production or client code.
- **Synthetic / dev fixtures ONLY — never production student data, never
  PII.** Enforced structurally, not by convention:
  - The harness has **no Supabase client and no DB read of any kind** — it
    cannot touch `student_*` / `quiz_*` / `profiles` tables even by mistake.
    (The eval/rag harness uses a service-role client because it measures live
    retrieval; this harness deliberately does not.)
  - Every artifact passes a recursive **P13 PII-shaped-key gate**
    (`student_id`, `user_id`, `session_id`, `email`, `phone` — the same list
    as `eval/rag/harness/golden-schema.ts`) before evaluation. A gated
    artifact gets verdict REVIEW with zero criteria evaluated and is **never
    serialized into a judge prompt**.
  - The `foxy-explanation` rubric additionally runs a deterministic
    email/phone text-pattern check (FX-O2). Bare names are not mechanically
    detectable — fixtures use placeholder names ("Student A") only.
- **All LLM-judge calls go through the house retry helper** `callClaude`
  (`@alfanumrik/lib/ai` → `packages/lib/src/ai/clients/claude.ts`: bounded
  backoff, model fallback chain, circuit breaker). Never a direct Anthropic
  SDK call. **No model override is ever passed** — callClaude's configured
  default chain applies (model changes require user approval).

## Usage

```bash
# From the repo root (delegates to the apps/host workspace):
npm run eval:teacher:harness -- --rubric quiz-generation \
  --input eval/teacher-skills/fixtures/quiz-generation --judge off

# Args:
#   --rubric <name>    a basename from eval/teacher-skills/rubrics/ (required)
#   --input  <path>    one fixture .json or a directory of them (required;
#                      cwd-relative, repo-root-relative, or absolute)
#   --judge  on|off    default off. `on` requires ANTHROPIC_API_KEY (via env
#                      or .env.local) and wires callClaude as the judge.
#   --out    <dir>     report dir (default eval/teacher-skills/reports/, gitignored)
```

**Exit codes** (mirrors `eval/rag/harness/cli.ts`): a COMPLETED run is always
`0` — REVIEW verdicts are findings, not process failures. `2` is reserved for
operator/config errors (bad args, unknown rubric, invalid CSV, missing input,
`--judge on` without a key).

**Verdict semantics**: per-artifact `PASS | REVIEW`. PASS requires every
criterion to pass or be legitimately skipped (unmet `Conditional` tag /
M-bucket with no chat response). Anything unevaluated (`--judge off` on a
rubric with LLM criteria, judge-error on malformed judge output) is REVIEW —
you cannot declare PASS on a measurement you did not complete (the same
philosophy as the RAG harness's INCONCLUSIVE). The report shows per-criterion
pass rates and a per-bucket rollup — never an aggregate-only score, per the
upstream guidance ("aggregate pass rates can mask meaningful gaps").

**Deterministic pre-checks (REG-54 oracle pattern)**: mechanically checkable
criteria (all `QZ-P6*`/`QZ-P5`, `FX-O2`, `A1`/`A2a`) are decided synchronously
in `harness/deterministic-checks.ts` — BEFORE and INSTEAD of the LLM judge —
mirroring the semantics of `packages/lib/src/ai/validation/quiz-oracle.ts`
(`runDeterministicChecks`), including the canonical **string** difficulty enum
`easy|medium|hard` (A3).

## Layout

```
vendor/     Upstream rubric CSVs, copied VERBATIM + LICENSE + NOTICE + PROVENANCE.md
            (anthropics/k12-teacher-skills @ 7c03c83, Apache-2.0). Never edit.
rubrics/    The ADAPTED rubric set. Each adapted file carries an in-file '#'
            comment header as its Apache-2.0 §4(b) modification notice.
harness/    rubric-schema.ts (Zod CSV parse/validate + P13 key scan),
            deterministic-checks.ts, judge.ts (callClaude-only transport seam),
            run-eval.ts (pure assembler), report.ts, cli.ts (operator entrypoint).
fixtures/   SYNTHETIC hand-written fixtures: 1 good + 1 deliberately-failing
            per rubric target (lesson-plan, foxy-explanation, quiz-generation).
reports/    Per-run JSON artifacts (gitignored).
```

Tests: `apps/host/src/__tests__/eval/teacher-skills/` (pure/offline; judge
tests inject fakes — no live API calls; run
`npx vitest run src/__tests__/eval/teacher-skills/` from `apps/host`).

## Rubric set and adaptation summary

| Rubric | Source | Notes |
| --- | --- | --- |
| `ncert-lesson-planning.csv` | adapted from `shared.csv` | "standard" → NCERT learning objective / `curriculum_topics` topic; CCSS example codes → NCERT class/chapter refs; M5 generalized (no proprietary/foreign-framework terms); **+A1** bilingual readiness (P7, deterministic) and **+A2a/A2b** grade-band format + language (P5/P12; A2a deterministic) |
| `ncert-lesson-planning-math.csv` | adapted from `math.csv` | P-M1's IM-specific branch removed (curriculum-neutral arc; principle kept); objective wording |
| `ncert-lesson-planning-science.csv` | adapted from `science.csv` | NGSS SEP/DCI/CCC framing reworded curriculum-neutrally; pedagogy principles kept; R-S2 keeps its `Gr6-12-quantitative-data` conditional |
| `ncert-differentiation.csv` | adapted from `differentiation.csv` | keeps P1-P9, R1-R3, O1-O10, M1-M4; P2 repointed at `curriculum_topics.prerequisite_topic_ids` / `concept_edges`; P9's IM/OpenSciEd example terms dropped (principle kept); upstream P10 dropped (not in Phase 1 keep-list); `clarifying_question.csv` dropped entirely (US-state question, N/A) |
| `foxy-explanation.csv` | NEW (Alfanumrik original) | 10 criteria: P12 grounding/scope/identity, P7 bilingual, P13 no-PII (deterministic), structure/rigor/NCERT-reference |
| `quiz-generation.csv` | NEW (Alfanumrik original) | 11 criteria: QZ-P6a..f + QZ-P5 derived directly from invariants P6/P5 (deterministic, quiz-oracle parity) + LLM-judged scope, distractor plausibility, key/explanation match, age-appropriateness |

Subject layering (per upstream): score lesson artifacts against
`ncert-lesson-planning` first, then run the relevant subject rubric
(`-math` / `-science`) as a second pass.

## Attribution

Vendored rubrics and the adapted judge system prompt derive from
**Agent Skills for K-12 Teachers** (https://github.com/anthropics/k12-teacher-skills,
commit `7c03c83`), Apache-2.0:

> Agent Skills for K-12 Teachers
> Copyright 2026 Anthropic, PBC
> Copyright 2026 Learning Commons
> Portions of this product were co-developed by Anthropic, PBC and Learning
> Commons under a collaboration agreement.

See `vendor/LICENSE`, `vendor/NOTICE`, `vendor/PROVENANCE.md`. Adapted files
are marked as modified per Apache-2.0 §4(b) via their in-file comment headers.
The upstream `references/*.md` subject files are deliberately NOT vendored
(they carry CCSS text under a separate NOTICE and are not needed here).

## Deferred (Phase 2+)

- `ela.csv` / `social_studies.csv` adaptations (not CBSE-priority for Phase 1;
  upstream copies are already vendored for when they're needed).
- Differentiation × BKT wiring: feeding real concept-mastery tiers into
  differentiation fixtures and scoring generated tiered materials against
  `ncert-differentiation.csv` (rubric ships now; fixtures + wiring deferred).
- Judge calibration loop with assessment (tuning `What pass requires` wording
  against judged samples, per the upstream calibration guidance).
- Upstream `differentiation.csv` P10 (standards economy) — revisit whether an
  objective-economy criterion earns a place in the CBSE set.
