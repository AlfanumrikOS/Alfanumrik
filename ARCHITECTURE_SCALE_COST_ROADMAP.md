# Alfanumrik — Scale, Cost & Authenticity Architecture

> **Decisions, not options.** Every "Decision:" below is a call I'm making for you, grounded in live data measured 2026-09-05 (`mol_request_logs`, `question_bank`, `topic_diagrams`, `feature_flags`). Where I recommend *against* something popular (Pinecone, LangGraph, a rewrite), the reason is stated.
>
> **The one hard constraint:** all-in AI cost **≤ ₹100 / student / month**. Everything here is engineered to that ceiling with 3× headroom.

---

## 0. Verdict up front

Your stack — Next.js + Supabase (Postgres + pgvector) + Voyage + Claude — is **correct and cost-appropriate**. Do not rewrite it, do not add Pinecone, do not adopt LangGraph. The system isn't launched because of **broken operations and unfinished cost work**, not because of the architecture. The cost problem is **three specific waste sources you can eliminate without any new vendor**, and two of the three are code your own team already started.

**Cost today vs. after this plan, for an engaged student (150 Foxy turns/month):**

| | Per turn | Per student/month | Verdict |
|---|---|---|---|
| **Today** (dead cache, 100% shadow, no response cache) | ~₹1.08 | **~₹162** | ❌ breaches ceiling |
| **After this plan** | ~₹0.19 effective | **~₹28** | ✅ 3.5× under ceiling |

---

## 1. Unit economics — how ₹100 is met (the math, so it's not hand-waving)

**Cost of one Foxy answer turn, today** (Haiku @ $1/Mtok in, $5/Mtok out; measured 2,560 in / 572 out for `doubt_solving`):

| Sub-call | Tokens | Cost |
|---|---|---|
| Answer (Claude) | 2,560 in / 572 out | $0.0054 |
| Grounding check | ~1,500 in / 100 out | $0.0020 |
| Shadow grader (**runs on 100% of calls**) | 2,560 in / 572 out | $0.0054 |
| **Total** | | **$0.013 ≈ ₹1.08/turn** |

Quizzes add ~₹0 at serve time (read from `question_bank`, no LLM). So per-student AI cost ≈ Foxy turns × cost/turn. At 150 turns → **₹162/student** → over.

**The four levers, and where each lands us:**

| Lever | Mechanism | Effect on cost/turn |
|---|---|---|
| **L1 — Fix the prompt cache** | Cache hits 0.4% today. Move the stable prefix (persona + curriculum context) first, variable RAG/history last, so ~90% of the 2,560 input tokens bill at 0.1× | Answer input $0.0026 → $0.0005 |
| **L2 — Sample the shadow grader to 5%** | `shadow_eval_calls = 100%` today. 5% keeps the training signal, drops a full 2× multiplier | Shadow $0.0054 → $0.0003 amortized |
| **L3 — Ship the semantic response cache** | `match_foxy_response_cache` (≥0.95 cosine) is **written and uncommitted** on `wip/foxy-preserve`. A static CBSE syllabus has a finite question distribution → high hit rate. At 50% hit, half of turns cost ₹0 | Effective turn cost × 0.5 |
| **L4 — Serve quizzes from the verified bank only** | Already near-free; formalize it (see §3) | ~₹0/quiz |

**Post-fix turn (the ~50% that miss the semantic cache):** answer $0.0033 + grounding $0.001 + shadow $0.0003 ≈ **$0.0046 = ₹0.38**. Blended with 50% cache hits → **₹0.19/turn effective** → **150 turns = ₹28/student/month.** Headroom to ~500 turns before the ceiling.

**Decision:** these four levers ARE the cost architecture. No model change is required to hit ₹100 — but see §2 for the one model tiering call.

---

## 2. Cost architecture — the decisions

- **Decision C1 — Keep Claude Haiku as the *grounded-answer* model.** Authenticity depends on grounding quality, and grounding is tuned on Claude. Do **not** move the tutor answer to a cheaper model to save money; the caching does that instead.
- **Decision C2 — Add Gemini 2.0 Flash as a second tier for *non-grounded utility only*** (intent routing, SEL tone classification, language detection) — the tasks where an error is cheap and reversible. Flash input is ~13× cheaper than Haiku. This keeps SEL and routing off your paid-answer budget. Never use Flash for a fact a student learns from.
- **Decision C3 — Centralize every LLM call through one gateway.** Today **37 files** hit Anthropic directly with **3 rival adapter modules**. That is why caching (0.4%), model choice, and cost tracking are inconsistent. One `packages/lib/src/ai/gateway` module, every caller routed through it. This is the enabling refactor — L1/L2 are trivial once it exists and impossible while it doesn't.
- **Decision C4 — Ship L1–L4 in this order:** gateway (C3) → prompt-cache fix (L1) → shadow sampling (L2) → semantic cache (L3). C3 first because it makes the rest one-line changes.

**pgvector, not Pinecone.** You have 27,778 vectors. pgvector-HNSW is comfortable into the millions. Pinecone adds a vendor, a bill, and a sync problem for **zero** benefit at your scale. Revisit only past ~5M vectors + high QPS, which is years away. **Decision:** stay on pgvector; delete the Pinecone idea.

---

## 3. Authenticity architecture — 100%, zero-error, both surfaces

Your requirement: quiz authentic, Foxy content 100% authentic. Both are achievable because the guard rails already exist — they just aren't *enforced as the only path*.

**Quiz — Decision A1: serve ONLY `verification_state = 'verified'` questions.** Today 18,765 exist, **5,398 verified**. The other 13,367 must be structurally unreachable by students until the P6 oracle + LLM-grader pipeline (`verify-question-bank`) passes them. This is a serving-filter (`select_quiz_questions_*` RPCs already support it) plus a backlog job to grind the 13k through verification. **No student ever sees an unverified question.** That is your quiz-authenticity guarantee.

**Foxy — Decision A2: grounded-or-abstain, never guess.** The pipeline already has coverage precheck (`chapter_not_ready → abstain`), retrieval-similarity gating, a grounding-check pass, and citations. **Enforce it as the only exit:** Foxy answers *only* when (a) retrieved chunks clear the cosine threshold **and** (b) the grounding-check LLM confirms the answer is supported by those chunks. Otherwise Foxy does **not** fabricate — it Socratically redirects ("what do you already know about…") or escalates ("let's ask your teacher"). **Decision A3: raise the abstain threshold deliberately and log every abstain** — for study content, a refusal is correct and a hallucination is unacceptable. Tune toward more abstention, not less.

This costs nothing extra — the grounding check is already in the ₹0.001/turn budget above. Authenticity and the ₹100 ceiling are not in tension.

---

## 4. Diagrams — fix P1-12 (they render as nothing today)

**Measured:** 3,168 active `topic_diagrams`, **0 are images** — every `image_url` points at a source PDF (e.g. `…/ncert-books/Grade 11/Biology/kebo101.pdf`). An `<img>` at a PDF renders blank. The `ncert-assets` bucket holds **0 objects**. The `extract-diagrams` + `embed-diagrams` Edge Functions exist but the extraction was never run to completion.

**Decision D1 — run the extraction pipeline as a one-time backfill, then on ingest.** For each active diagram row: render the diagram's page-region from the source PDF to a PNG, upload to `ncert-assets`, and update `image_url` to the rendered asset. This is a batch job (Edge Function or a short Fargate task) over 3,168 rows — bounded, one-time, then wired into the NCERT ingestion path so new chapters populate images automatically.
**Decision D2 — gate diagram display on `image_url` being an actual image** so a half-run backfill never shows a broken image; fall back to "diagram loading" until the asset exists.
**Verification:** a student chapter page renders ≥1 diagram as an image; `topic_diagrams` rows resolve to `image/*`; `ncert-assets` is non-empty.

---

## 5. Foxy as a Socratic + SEL engine

Both are scaffolded (`teaching-director.ts`, `ff_foxy_decide_ladder_v1`, `ff_foxy_sel_v1`) and off. Turning them on is prompt + routing work, not new infrastructure — and it fits the budget because SEL runs on the cheap tier (C2).

- **Decision S1 — Socratic is Foxy's default teaching mode.** The `teaching-director` already models a decide-ladder (assess → hint → scaffold → reveal). Enforce: on a "solve this for me" request, Foxy does **not** dump the answer — it runs the hint ladder (guiding question → targeted hint → worked-step → full solution only after genuine struggle). "Give answer" is available but never the default. This is a system-prompt + director-state change on the *existing* grounded pipeline, so it inherits the same authenticity guard (§3) — Socratic questions are still grounded, never invented.
- **Decision S2 — SEL is a lightweight affect layer, not a second expensive brain.** A Gemini-Flash classifier (C2) reads the turn for frustration / disengagement / confidence and sets a **tone + pacing parameter** (encourage, slow down, celebrate, normalize struggle) that the answer prompt consumes. It never generates the study content — it shapes delivery. Cost: a Flash call ≈ ₹0.002, negligible.
- **Decision S3 — SEL signals feed the dashboards** (frustration streak → teacher/parent nudge), reusing the existing Pulse + adaptive-intervention substrate. SEL becomes a data product, not just a tone.

---

## 6. The five dashboards at scale — a decision per role

You said these cannot be forgotten. Ranked by launch-value:

- **Student — Decision R1: done, keep hardening.** Dashboard, quiz→mastery, Foxy, progress all verified working. The §3–§5 work lands here.
- **School / Principal — Decision R2: done, extend with SEL.** Command Center (classes-at-risk, engagement, Pulse) works and principal-ai exists. Wire the §5 SEL signals into the leadership view.
- **Teacher — Decision R3: build the core loop for real (not "coming soon").** Today `assignments`, `attendance`, `grade_book_entries` are **0 rows** and the pages are Edge-Function-backed. Because you're launching to schools, the teacher loop is B2B value, not optional. **Scope the MVP:** attendance → assign (from the verified bank) → submissions → gradebook → auto-report to parents. Reuse the existing `teacher-dashboard` Edge Function and the class/roster tables that already exist. This is the largest *build* in the plan; everything else is fix/tune.
- **Parent — Decision R4: fix the report generator, then digest.** `parent_weekly_reports` = 0 ever; `parent-report-generator` fails on a JWT-audience issue found in the audit. Fix the JWT forwarding, generate the weekly digest (mastery + attendance + one SEL note), deliver via the Gmail relay. Parent linking (OTP/code) exists but is near-unused — verify it end-to-end.
- **Super Admin — Decision R5: operate, don't expand.** 68 pages already exist and work. No new build — this is the operator console; walk it once with a credential and fix only what's broken.

---

## 7. What NOT to do — and why (explicit, so it's not revisited)

- **Pinecone — no.** 27,778 vectors on pgvector-HNSW is trivial. Adding it is cost + a sync failure mode for zero gain. Adding infrastructure is not scaling.
- **LangGraph — no, not now.** Your Foxy pipeline is essentially linear. LangGraph is for stateful, branching, multi-agent graphs with durable checkpoints. Porting to it is a rewrite that touches **none** of the four cost levers. It earns its place only if you later build genuinely *agentic* tutoring (multi-step planning, per-subject sub-agents) — a product bet, made *after* the loop is cheap and verified, never as a cost fix.
- **A rewrite — no.** The stack is fine; the ops were broken. A rewrite ships the same broken login on nicer tech.

---

## 8. Sequenced execution — dependency-ordered, decisive

Each phase makes the next cheap. Do them in order.

1. **AI Gateway (C3).** One module; route the 37 callers through it. *Unlocks L1/L2 as one-liners.*
2. **Cost levers L1 → L2 → L3.** Prompt-cache fix, shadow sampling to 5%, ship the semantic cache. *Bends the cost curve to ₹28/student.* Measure `pct_calls_hitting_prompt_cache` climbing from 0.4% toward 90% as the proof.
3. **Authenticity enforcement (A1–A3).** Verified-only quiz serving + hard grounded-or-abstain. *Zero-error guarantee.* Grind the 13k unverified questions through `verify-question-bank` in the background.
4. **Diagrams backfill (D1–D2).** Populate `ncert-assets`, repoint `image_url`. *Diagrams render.*
5. **Socratic + SEL (S1–S3).** Turn on the teaching-director default + the Flash affect layer.
6. **Teacher core loop (R3)** and **Parent report fix (R4).** The remaining dashboard builds.
7. **Re-measure unit cost at each step** against ₹100. The gateway (step 1) makes this a single query.

---

## 9. Cost projection — proof the model holds at scale

Assuming the post-fix ₹28/engaged-student/month (150 turns), and that ~40% of enrolled students are "engaged" in a month (rest lighter):

| Students | Blended ₹/student/mo | Monthly AI cost | Under ₹100 ceiling? |
|---|---|---|---|
| 1,000 | ~₹15 | ~₹15,000 | ✅ (85% headroom) |
| 10,000 | ~₹15 | ~₹1.5 L | ✅ |
| 100,000 | ~₹15 | ~₹15 L | ✅ |

The ceiling is per-student and the architecture is per-student-linear, so it holds at every scale. The semantic cache *improves* with scale (more students → more cache hits on the same finite syllabus), so blended cost **falls** as you grow.

---

*Authored 2026-09-05 from live measurements. Every number is reproducible via the queries in `LAUNCH_STATE.md §0`. This is the durable strategy doc; update it as the levers ship.*
