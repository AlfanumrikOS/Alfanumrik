# Scope: S1 (diagram captions) + S2 (diagram-aware retrieval) — reframed

**Date:** 2026-08-13 · **Requested by:** CEO · **Author:** orchestrator (research: ai-engineer lane)
**Status:** SCOPE ONLY — nothing implemented, nothing committed, no spend incurred
**Origin:** `docs/audits/2026-08-13-rag-math-science-coverage.md` recommendations S1 and S2
**Goal being served:** *"holistic concept explanations with diagrams and various examples
which relate to day-to-day life."*

---

## 0. Headline — S1 and S2 as written are not executable

Both recommendations assumed the corpus contains 3,833 diagram records that merely lack
captions. **It does not.** Measured against prod on 2026-08-13 (see the CORRECTION section
of the audit for the full probe table):

- **0** image assets exist anywhere — `media_url` is `.pdf` on all 8,880 rows that have one,
  and it points at the whole chapter textbook, ~5 rows sharing each URL.
- **0** rows carry the `embed-diagrams` insert signature (`chunk_text ILIKE 'Diagram:%'`),
  so **that function has never run in production**.
- **0** of 27,778 rows have a `page_number`, so a figure cannot even be located in the PDF.
- **8,863 of 8,880** `media_type='diagram'` rows are full prose (`word_count >= 60`).
- Diagram-tagged chunks mention "Fig" **30%** of the time; **untagged** chunks mention it
  **34%** of the time. The tag is *negatively* correlated with referencing a figure.

`media_type='diagram'` is a bulk-update artefact that stamped ordinary text chunks with the
source-PDF URL. **There is nothing to caption (S1) and nothing to boost (S2).**

Two further blockers for S2 specifically, both independent of the above:

1. `p_content_type` is a **hard equality filter** — `c.content_type = p_content_type` in both
   RRF arms and tier 2, absent from tier 3 (`20260727130000_rag_ncert_expose_cosine_similarity.sql:142,171,242`).
   It can express "diagrams only", never "prefer diagrams". S2 was never a one-line forward.
2. `content_type` and `media_type` disagree on **7,347 rows** table-wide (2,696 in keep-set).
   `content_type` was backfilled once by `_legacy/timestamped/20260403400000_rag_three_categories.sql`
   and **no live writer maintains it**. Neither column is safe as a retrieval predicate.

---

## 1. What is actually true, and where the leverage is

The request has two halves. They have very different costs.

| Half | Corpus reality | Cheapest real lever |
|---|---|---|
| **"with diagrams"** | No diagram entities exist; no images; no page numbers; no extraction tooling in-repo (`pdf-parse` is text-only; `tools/pdf-content-ingestor` is an empty husk) | Build the capability from scratch — a genuine project (Option A) |
| **"holistic explanations + day-to-day examples"** | NCERT text carries some example framing ("for example" 14%, explicit daily-life ~3%) but nothing labels it and retrieval cannot select it | **Generate it at answer time, not retrieve it** (Option C) |

**The architectural point:** grounding should supply *facts*; pedagogy should supply
*framing*. Trying to retrieve day-to-day analogies out of an NCERT textbook is the wrong
layer — the textbook largely does not contain them, and an LLM is good at producing them
from a grounded fact base. Chasing this in retrieval spends money to get a worse result.

**And a large part of Option C already exists but is not wired to the live path:**

- `packages/lib/src/ai/prompts/foxy-system.ts:57,59,155` already instructs *"Use examples
  from everyday Indian life"* and *"Relate examples to Indian daily life, festivals,
  cricket, and familiar contexts"*. **But its only importers are tests and the
  `packages/lib/src/ai/index.ts` barrel** — no live route imports it. Production Foxy runs
  `/api/foxy` -> the `grounded-answer` Deno function, which cannot import `packages/lib`.
  This instruction is on the legacy cold path only.
- The live structured prompt (`supabase/functions/grounded-answer/structured-prompt.ts`,
  imported by `pipeline.ts:90` and `pipeline-stream.ts`) **already supports an `example`
  block type** (`:39`) and a `worked_example` lesson step (`:74`), and ships a
  `"Real-World Example"` few-shot (`:187`) — but it does not *require* an everyday-life
  example in the output contract.
- `prompts/inline.ts:729` and `prompts/lesson_notes_v1.txt:46` already model persona tone
  as *"concrete = hands-on everyday examples"* / *"visual = lean on visual analogies"*.

So the everyday-examples half is largely a **prompt-contract change on a live path**, not a
content project.

---

## 2. Options

### Option A — Build diagram capability from scratch (replaces S1+S2)

Stages, none of which exist today:

| Stage | Work | Blocker |
|---|---|---|
| A1 | Render NCERT PDF pages and detect/crop figure regions | **No tooling.** `pdf-parse` is text-only; no `sharp`/`canvas`/`pdf2pic`/PyMuPDF in any manifest. New dependency + a Python or Node service. |
| A2 | Upload crops to `ncert-books` (public bucket) with a per-figure path | Needs a path convention; none exists |
| A3 | Vision-caption each crop | **No new model approval needed** — `gpt-4o` and `claude-sonnet-4-20250514` are already in `packages/lib/src/ai/gateway/registry.ts` with `capabilities.vision: true`, already priced in 3 synced tables, and already reachable through MoL's `ocr_extraction` -> `vision` chain (`_shared/mol/generated-matrix.ts:74-78`). Gemini is `configured: false` and *would* need approval. |
| A4 | Create real diagram chunks + `media_description`, embed via `voyage-3` | Must add `bumpRagContentVersion` — `embed-diagrams` omits it and the L3 response cache has **no TTL** |
| A5 | Retrieval lever (the real S2) | Needs a trustworthy predicate first — see Option B |

**Cost:** unquantifiable today. Figure count is unknown until A1 runs, and **no pricing
table in the repo has an image-token line item** — all three are text-token only. A
discovery spike on one chapter is the only honest way to get a number.
**Effort:** large. **Risk:** high. **Recommendation: do not start now.** Gate on a
one-chapter spike that answers: how many figures, at what crop quality, at what cost/figure.

### Option B — Repair the content-type plumbing (prerequisite for any future A5/S2)

Small, free, and fixes two real defects regardless of what we decide about diagrams:

| # | Change | Owner |
|---|---|---|
| B1 | Reconcile `content_type` with `media_type` (7,347 rows), or formally deprecate `content_type` and pick one column | architect (migration) |
| B2 | Make the diagram writer set `content_type`, so it stops re-diverging | ai-engineer |
| B3 | Add `bumpRagContentVersion` to `embed-diagrams` — **correctness bug**, cached answers would never see new content | ai-engineer |
| B4 | Surface `media_type` on `RetrievalChunk` — `NcertRpcRow.media_type` is declared (`retrieve.ts:543`) but `mapNcertRow` (`:569-606`) silently drops it | ai-engineer |

**Do B3 regardless.** It is a latent cache-staleness bug independent of this request.
**Note:** B1 is only worth doing if we intend to build diagrams. Repairing a label that
marks nothing is not itself valuable — sequence it behind the Option A spike.

### Option C — Make the live prompt contract require everyday-life grounding (RECOMMENDED)

Targets the half of the request that is actually reachable, on the path that actually runs.

| # | Change | Notes |
|---|---|---|
| C1 | Extend `FOXY_STRUCTURED_OUTPUT_PROMPT` (`grounded-answer/structured-prompt.ts`) so an explanation-type response MUST include at least one `example` block framed in day-to-day Indian context | The `example` block type and `worked_example` lesson step already exist; this makes them required rather than optional |
| C2 | Mirror byte-for-byte into `pipeline-stream.ts`'s path | The two prompt paths must not drift; `claude.ts:170` already warns on segment mismatch |
| C3 | Port the `foxy-system.ts:57,155` everyday-Indian-life language to the live Deno prompt, so the legacy and live paths finally agree | Today the instruction exists only on the cold path |
| C4 | Gate behind `ff_foxy_everyday_examples_v1`, copying `_mmr-flag.ts` (60 s TTL cache, `__reset*ForTests`) | Prompt change is reversible; fail-OPEN to current behaviour |

**Cost:** no new spend. Slightly longer outputs (more output tokens/answer).
**Effort:** small. **Risk:** low-moderate — it is a **live student-facing prompt change**,
so P12 applies and it needs assessment review for age-appropriateness and CBSE scope, plus
testing for the structured-schema contract.
**Effect:** immediate, every grounded answer, all 18 cells — including the 26 chapters with
no corpus text, because it changes generation rather than retrieval.

---

## 3. Recommended sequence

1. **C1-C4** — the only option that moves the stated goal at low cost and low risk.
2. **B3** — unrelated correctness bug, ship whenever.
3. **A-spike** (one chapter, e.g. 10/science) — produces the figure count and cost/figure
   needed to decide Option A honestly. Approval-gated because it spends vision tokens.
4. **B1/B2/B4 + A5** — only if the spike says diagrams are worth building.

Explicitly **not** recommended now: A1-A4 at scale, and S2 in any form. There is no
predicate worth boosting until diagrams exist.

## 4. The measurement problem — read before funding anything

**The B1 harness cannot evaluate this goal.** Its primary metrics are nDCG@10, recall@10,
MRR, hit-rate@10 and groundedness-rate, scored against relevance labels that encode only
*"does this chunk answer the query"* — there is no pedagogical-style dimension in
`golden-schema.ts` at all. And the golden set binds 4 of 18 cells.

So Option C's success **cannot be measured by the existing harness**. It needs a separate
LLM-judge rubric (does the answer contain a correct, grade-appropriate, everyday-life
example?) run over a sample of real answers. Treat building that rubric as part of C, not
as a follow-up — otherwise we ship a prompt change we cannot evaluate, which is the same
failure the RAG audit was created to prevent.

## 5. Approvals

| Item | Needed? |
|---|---|
| Option C prompt change | **No CEO approval** (not a model/provider change). Needs assessment + testing review under P12/P14 |
| Reusing `gpt-4o` / `claude-sonnet-4` for vision | **No** — already registered, priced, vision-capable, live-reachable |
| Adding Gemini for vision | **Yes** — `configured: false`, would be a new provider |
| A-spike vision tokens | **Yes** — spends money, however little |
| Option A at scale | **Yes** — unbounded until the spike returns a number |
