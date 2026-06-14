# RAG Retrieval Tuning — Sub-project B2, Iteration 1 (MEASUREMENT-ONLY)

**Date:** 2026-06-14
**Branch:** `feat/rag-b2-tuning`
**Scope:** Find retrieval-setting changes that beat the committed B1 baseline, measured rigorously against the 30-item golden set. **No production deploy. No production retrieval settings were edited or committed.**

Baseline (committed on main, `eval/rag/baseline/ncert-baseline-v1.json`, production settings RRF k=60, MMR λ=0.7, fetch-N=40, floor=0.5, Voyage voyage-3 + rerank-2):

| metric | baseline |
|---|---|
| nDCG@10 | 0.6617 |
| recall@10 | 0.8222 |
| MRR | 0.7286 |
| hit-rate@10 | 0.9667 |
| groundedness-rate | 0.3667 |

Weakest per-band cell = **junior/math (`6-8/math`)**: hit-rate@10 0.80, nDCG@10 0.3750.

---

## (a) The three-floor reconciliation — and the correctness finding behind it

There are three "floor"-looking values in the codebase. **They are NOT three competing similarity floors — two of them are a content-`quality_score` gate and one is a genuine cosine floor on a different (dead) code path.** This is the central correctness finding of B2 iteration 1.

| # | Location | Value | What it actually filters | In the LIVE retrieve() path? |
|---|---|---|---|---|
| 1 | RPC `match_rag_chunks_ncert` (`p_min_quality` default) | **0.4** | `(c.quality_score IS NULL OR c.quality_score >= p_min_quality)` — a **content `quality_score`** column gate, NOT retrieval similarity | Yes — but the value is OVERRIDDEN by the caller (see #2) |
| 2 | `supabase/functions/_shared/rag/retrieve.ts` `DEFAULT_MIN_SIMILARITY` | **0.5** | Passed as `p_min_quality` → same `quality_score` gate as #1 | **Yes — this is the value a real query sees** |
| 3 | `src/lib/ai/retrieval/ncert-retriever.ts` via `config.ts` `ragMinQuality` | **0.005** | Also passed as `p_min_quality` → same `quality_score` gate | **No** — legacy Foxy kill-switch cold path only (`ff_grounded_ai_foxy=false`); not the grounded-answer/quiz/harness path |

### Effective floor a real query sees
The live path is `retrieve()` → `match_rag_chunks_ncert(p_min_quality = 0.5)`. The RPC filters `quality_score >= 0.5`.

**Empirical corpus probe (read-only) — the decisive fact:** every active `ncert_2025` chunk in the five non-history cells has `quality_score = 0.7` (a uniform constant — min = p10 = p50 = p90 = max = 0.7 across math/g7, science/g7, science/g10, social_studies/g10, physics/g11). The history_sr/g11 cell chunks have `quality_score = NULL`, which the `IS NULL OR …` clause always admits.

Therefore the **effective floor is inert** on the entire golden corpus:
- `0.7 >= 0.3`, `0.7 >= 0.4`, `0.7 >= 0.5` are all true → identical row membership.
- NULL-quality chunks bypass the floor entirely.
- Direct RPC probe confirmed: floor 0.3 and floor 0.5 return **byte-identical** row sets; floor 0.8 returns **0 rows** (because 0.7 < 0.8 filters everything that has a score). The floor only "bites" above 0.7.

This also explains the legacy retriever's 0.005: that comment claims it was "calibrated for the RRF score scale" so the kill switch produces chunks — but `p_min_quality` never touches the RRF score. The 0.005 is harmless (always passes) but the rationale in the code comment is **wrong**: it is a `quality_score` gate, not an RRF-similarity gate. Same misconception is baked into the baseline file's wording ("p_min_quality floor=0.5") and this task's framing ("similarity floor").

### Should they be unified, and to what?
**Recommendation: unify the parameter NAME/semantics, keep the live value at the inert end, and treat the 0.005 legacy value as the canonical "off" value.**

- The parameter is a **content-quality gate**, not a similarity floor. It should be renamed in comments/docs to stop the recurring confusion (the `similarity` column it sits next to is an RRF FUSED score on a `[0, ~0.033]` scale; a "0.5 similarity floor" on that scale would drop *everything*, which is presumably why nobody ever set it there).
- Recommended unified value: **0.0** (or the legacy 0.005) — i.e. effectively OFF — because (a) `quality_score` is currently a uniform 0.7 placeholder with no discriminating power, and (b) the `source='ncert_2025'` pin + scope filters already guarantee corpus quality. Keeping it at 0.5 is a latent foot-gun: the day ingestion starts writing real `quality_score` values < 0.5 (or a real cosine-scale value lands in that column by mistake), the live path would silently start dropping valid chunks while the legacy path (0.005) would not — a drift bug exactly like the one this reconciliation found.
- **Until `quality_score` carries real signal, the floor is a no-op and tuning it is pointless.** This is gated separately (it is a production retrieve.ts/RPC change) — see (e).

---

## (b) Sweep results table (config → overall + junior/math → verdict)

All runs full-path (Voyage rerank-2 ON, embeddings present, groundedness judged with the real Haiku grounding-check). Verdict = `evaluateVerdict()` vs the committed baseline (A7 bands). Two retrieval lanes:
- **live**: drives the REAL `retrieve()` (varies floor + fetch-N — the only cleanly-exposed live knobs).
- **replica**: faithful MMR-λ replica — pool comes from the REAL RPC (RRF k=60) via `retrieve(rerank:false)`, then REAL Voyage rerank-2 + REAL `applyMMR(λ)`. **Validated at λ=0.7: 30/30 items perfect top-10 Jaccard = 1.000 vs live.**

| Lane | Config | nDCG@10 | recall@10 | MRR | hit@10 | grounded | 6-8/math nDCG | 6-8/math hit | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| — | **baseline** | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | — |
| live | floor=0.3 | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| live | floor=0.4 | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| live | floor=0.5 (current) | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| live | fetch-N=30 | 0.6585 | 0.8222 | 0.7250 | 0.9667 | 0.3667 | 0.3555 | 0.8000 | PASS |
| live | fetch-N=40 (current) | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| live | fetch-N=60 | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| replica | MMR λ=0.5 | 0.6573 | 0.8222 | 0.7272 | 0.9667 | 0.33–0.37 | 0.3601 | 0.8000 | PASS |
| replica | MMR λ=0.7 (current) | 0.6617 | 0.8222 | 0.7286 | 0.9667 | 0.3667 | 0.3750 | 0.8000 | PASS |
| replica | MMR λ=0.85 | **0.6492 – 0.6642** (unstable) | **0.80 – 0.8333** | 0.7203–0.7286 | **0.9333 – 0.9667** | 0.40 | **0.2889 – 0.3750** | **0.60 – 0.80** | PASS *or* REGRESS (run-dependent) |

**Floor = byte-identical** across 0.3/0.4/0.5 (re-run confirmed all three return the exact same 0.6617/0.8222/0.7286/0.9667/0.3667). The single "floor=0.4 looked better" datapoint in the first sweep run was **Voyage embedding non-determinism**, not the floor — it did not reproduce.

**RRF-k = NOT MEASURED** — see (e). RRF k=60 is a SQL `CONSTANT` (`v_k`) inside `match_rag_chunks_ncert` and the RPC fuses the two arms BEFORE the `match_count` cut. No parameterized measurement RPC exists, and supabase-js cannot express `ORDER BY embedding <=> q` to re-derive the raw vector arm read-only. A two-RPC approximation scored only **0.505** top-10 Jaccard vs live and was rejected as untrustworthy rather than reported as a fake measurement.

### Measurement-noise caveat (important)
`retrieve()` re-embeds each query via Voyage on every call, and Voyage `voyage-3` embeddings are **not bit-deterministic**. The downstream vec-arm ordering therefore wobbles run-to-run on borderline chunks near the rank-10 boundary. Observed run-to-run variance on the SAME config:
- λ=0.7 (current): **rock-stable** — nDCG 0.6617, junior/math 0.3750 on every one of 3 runs.
- λ=0.85: **unstable** — nDCG swung 0.6492 → 0.6636 → 0.6642 across 3 runs; in the bad run recall fell to 0.80, hit@10 to 0.9333, and junior/math nDCG collapsed to 0.2889. Higher λ (more relevance weight, less diversity damping) AMPLIFIES the noisy vec-arm tail.
- floor 0.3/0.4/0.5: identical and stable (the floor is inert).

---

## (c) Recommended config change(s) + expected deltas

**Recommendation: KEEP THE CURRENT PRODUCTION CONFIG. No retrieval-setting change in this iteration beats the baseline with a stable, non-regressing improvement.**

Per-knob verdict:
- **Similarity/quality floor 0.5 → keep (or set effectively-off 0.0/0.005 as a hygiene fix, NOT a metric play).** Expected metric delta on this corpus: **0.0000** (provably inert; quality_score is a uniform 0.7). The only reason to touch it is the latent-foot-gun correctness fix in (a), which is hygiene, not tuning.
- **fetch-N 40 → keep.** 40 ≡ 60 (no gain from more candidates — the RPC already over-fetches `4×match_count` per arm before fusing). 30 is marginally worse (nDCG −0.0032, junior/math nDCG −0.0195). Lowering it to save Voyage rerank cost would trade a tiny quality loss; not recommended for the weak junior/math cell.
- **MMR λ 0.7 → keep.** λ=0.7 is the stability sweet spot. λ=0.5 is stably worse (−0.0044 nDCG; over-diversifying hurts factual/definition queries). λ=0.85 is a coin-flip that can REGRESS (junior/math hit 0.80 → 0.60). Its one-run "win" was noise.
- **RRF k → unmeasured; do not change blind.**

No recommended deploy. The strongest *defensible* change is the **floor-semantics hygiene fix** (rename + set effectively-off), which carries an **expected metric delta of 0.0** and removes a latent silent-drop bug — that is a correctness/clarity change, not a retrieval-quality win.

---

## (d) Overfitting-risk assessment

- **Floor:** zero overfitting risk — it is provably inert (no behavior change to overfit).
- **fetch-N:** low risk — 40 vs 60 identical, 30 slightly worse; the curve is flat, so no knife-edge fit to these 30 queries.
- **MMR λ:** **HIGH overfitting / generality risk for λ=0.85.** Its apparent improvement (a) did not reproduce (noise), and (b) even in its good run, lifting overall nDCG by +0.0025 while junior/math is unchanged means any "win" rides on a few high-grade items flipping rank — exactly the kind of move that helps the 30 golden queries and would not generalize. The instability (0.6492 ↔ 0.6642 across identical-config runs) is itself proof the signal is below the noise floor of a 30-query set.
- **General caveat:** the golden set is 30 items, 5 per cell. A per-cell metric moves in ~0.20 steps (1 of 5 items flipping). Differences below ~0.02 overall (and below ~0.04 per cell) are **inside the Voyage-embedding noise band** and must NOT be read as signal. Only λ=0.7's *stability* (identical across runs) is trustworthy; every sub-0.02 "improvement" observed was noise.
- **Recommendation:** before any λ/RRF-k change is taken seriously, (1) enlarge the golden set (≥10/cell), and (2) run each config ≥3× and require the improvement to exceed the run-to-run variance band — or cache query embeddings to remove the Voyage non-determinism from the measurement.

---

## (e) Exactly what would need to change + deploy to ship a recommendation (for the gate)

Nothing is recommended for deploy this iteration. For completeness, the change surface for each knob (all are production-path edits, all gated, none done here):

1. **Floor hygiene fix (the only defensible change, expected Δ=0):**
   - Edit `supabase/functions/_shared/rag/retrieve.ts`: `DEFAULT_MIN_SIMILARITY = 0.5 → 0.0` (or 0.005) and rename the option/comments from "similarity floor" to "content quality_score gate."
   - Optionally edit the RPC default in a new migration (`match_rag_chunks_ncert` `p_min_quality DEFAULT 0.4 → 0.0`) for consistency — DDL, requires a migration + `supabase db push`, architect review.
   - Reviewers: **assessment** (retrieval correctness — confirm no valid chunk is dropped), **architect** (RPC/migration infra). Re-baseline the harness after.

2. **MMR λ (NOT recommended):** would edit the hardcoded `applyMMR(chunks, 0.7)` in `retrieve.ts` (line ~602). One-line change, deploys with the Edge Function bundle. Would require assessment review (ranking behavior) + a fresh baseline. **Do not ship λ=0.85 — it regresses.**

3. **fetch-N (NOT recommended):** would edit `RERANK_DEFAULT_FETCH = 40` in `retrieve.ts`. Same deploy path.

4. **RRF k (cannot ship without measuring first):** lives in the SQL RPC (`v_k CONSTANT := 60`). To tune it rigorously you must first ship a **parameterized measurement RPC** (e.g. `match_rag_chunks_ncert_param(p_rrf_k, p_mmr_lambda, …)`) so the sweep can vary k faithfully, measure, then promote the winning constant back into the real RPC. That measurement RPC is itself a DDL change (architect) and is the prerequisite work item for B2 iteration 2.

**Prerequisite for a trustworthy B2 iteration 2 (the real blocker):** the measurement is currently noise-limited by Voyage embedding non-determinism + a 30-item set. Before any retrieval-knob deploy, do: (i) embedding-cache the golden queries (kill the non-determinism), (ii) grow the golden set to ≥10 items/cell, (iii) add the parameterized measurement RPC for RRF-k. Only then can a sub-0.02 improvement be distinguished from noise.

---

## (f) Branch / commit

- Branch: `feat/rag-b2-tuning` (off latest `origin/main` @ `669d2189`).
- Committed: `eval/rag/harness/b2-sweep.ts` (the sweep harness) + this findings doc. Pushed; **no PR opened, not merged.**
- NOT committed: per-run JSON reports under `eval/rag/reports/b2/` (gitignored — run artifacts), `.env.local` (gitignored — secrets).

## (g) Safety confirmation

- **No secrets/PII leaked:** `.env.local` was copied in, confirmed gitignored, never printed, never committed. Only `rag_content_chunks` (the NCERT corpus — not student data) + `match_rag_chunks_ncert` RPC + Voyage/Anthropic inference were touched. No PII tables read.
- **No production config committed:** `_shared/rag/retrieve.ts`, the RPC migration, and `config.ts` were READ ONLY — zero edits. The sweep harness is offline measurement tooling under `eval/`; it never writes the DB and never imports into production/client code.
- **Read-only DB:** every DB call was a `SELECT` or the `match_rag_chunks_ncert` RPC (a `STABLE` read function). Zero writes.
