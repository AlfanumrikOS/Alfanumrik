# JEE / NEET / Olympiad Scaling — Landscape Research

**Date:** 2026-05-19
**Author:** ops (research) with input from architect (schema), backend (Edge Function), ai-engineer (RAG)
**Audience:** CEO (Pradeep Sharma), engineering team inheriting the competitive-prep track
**Status:** Internal memo — informs PR-2 through PR-7 of the JEE/NEET roadmap

---

## Executive Summary

- **The prize.** Indian competitive-prep K-12 is roughly a ₹15,000-crore market (Coaching Federation of India, 2024). JEE + NEET enrol ~12 lakh + ~24 lakh candidates per year respectively. Olympiad participation crossed 5 lakh in 2024 (HBCSE). Alfanumrik today serves only the CBSE board-prep slice; the same students who pay us ₹299/month for board prep are paying Allen / FIITJEE / Aakash / Vedantu ₹1.5L+ per year for competitive prep.
- **The constraint.** Alfanumrik's `question_bank` table holds 14,000 rows, all CBSE-style or NCERT-derived (`source_type` distribution: 8057 `practice`, 5445 `cbse_style`, 494 `ncert_exercise`; ZERO `jee_archive`, `neet_archive`, or `olympiad`). Until PR-1 landed on 2026-05-20, the `chk_source_type` CHECK constraint physically rejected non-CBSE inserts. The Phase 2 RPC `get_adaptive_questions_v2` already accepts goal values `competitive_exam` and `olympiad` (see `supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql:266-280`), but had no content to surface.
- **The opportunity.** Alfanumrik's wedge is integrated CBSE → competition progression. A Grade 11 student preparing for both Boards and JEE doesn't need two apps — they need one IRT-calibrated track that escalates difficulty as their theta rises. No Indian incumbent (Embibe, Vedantu, Allen Digital, Physics Wallah) ships this integration; they all sell standalone competitive prep.
- **The risk.** Three of the top five risks are content-quality, not engineering: PYQ licensing exposure, AI hallucination on advanced difficulty, and Hindi-language gap. The engineering work (PR-2 through PR-5) is ~3 weeks; the content sourcing and legal review is ~3 months.
- **The recommendation.** Ship the schema unblock + Edge Function (PR-2 in flight today), seed 200 high-confidence PYQs (PR-3), flip the existing `ff_goal_aware_selection` flag to 10% canary on staging (PR-4), and only THEN build the student-visible Mock Test surface (PR-5). The flag gating means we ship infrastructure dark and turn it on when content reaches a quality bar — not when engineering ships.

---

## Why this matters for Alfanumrik

Today the product is CBSE-only. The `students` table has an `exam_goal` field; the Phase 2 RPC at `supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql:258-301` already branches on six goal values: `board_topper`, `school_topper`, `competitive_exam`, `olympiad`, `improve_basics`, `pass_comfortably`. The boost values are pinned (0.40 for JEE/NEET-relevant chapter on `competitive_exam`, 0.50 for `olympiad_relevant` chapters on `olympiad` goal) and intentionally cannot be changed without an assessment review.

What this means: **the cognitive scaffolding for competitive prep already exists in the database.** What's missing is the content (PYQ archives, Olympiad problems, properly tagged `learning_graph` rows) and the student-visible surface (mock test runner, paper-pattern-aware exam engine).

Phase 4 in `supabase/migrations/20260503180000_add_ff_goal_aware_rag.sql` similarly seeded the RAG-rerank flag: when content packs are ingested with `source = 'jee_archive' | 'neet_archive' | 'olympiad'`, the rerank automatically applies goal-aligned boosts without any code changes. The migration comment at line 49 explicitly calls this out as forward-compatible infrastructure.

The product positioning has to be honest about what we are and aren't. Vedantu and Physics Wallah have 10-year content head-starts. We can't out-content them in Year 1. What we can do is: (a) be the only platform where a student's CBSE progress directly informs their JEE readiness, (b) charge ₹999/month for competitive add-on vs Allen's ₹15,000/month tuition, (c) serve Tier 2/3 students who are price-locked out of coaching institutes.

---

## Exam landscape — JEE Main

| Attribute | Value |
|---|---|
| Conducting body | National Testing Agency (NTA) |
| Frequency | Two sessions per year (January, April) |
| Eligibility | Class 12 passed or appearing |
| Subjects | Physics, Chemistry, Mathematics |
| Question count | 90 questions total (30 per subject, 25 attempted) |
| Pattern | 20 MCQ single + 5 numerical per subject |
| Marking | +4 / -1 for MCQ; +4 / 0 for numerical |
| Duration | 180 minutes (3 hours) |
| Difficulty | Bloom's 3-5 (apply → evaluate) |
| Syllabus | NCERT Class 11 + 12 |

JEE Main is **mostly NCERT-aligned with ~5-10% additional problem depth**. The factual base is identical to CBSE; the difference is in the problem-solving demand. A CBSE board question asks "What is Newton's second law?" A JEE Main question asks "A 2 kg block on a 30° incline with μ = 0.2 is connected by a massless string over a frictionless pulley to a hanging 1 kg block. Find the acceleration." Same physics, different cognitive load.

The 2024 cutoffs published by NTA: General category percentile threshold for JEE Advanced eligibility was 93.23 (Session 2), with Open General Rank ~2.5 lakh = top 1% of test-takers. For our purposes, **a student in the 70-85th percentile band is the addressable user** — they need more practice, not a coaching institute.

The numerical (integer-answer) section is critical and currently has zero coverage in `question_bank`. The `paper_pattern = 'numerical'` value added by `supabase/migrations/20260520000004_jee_neet_schema_unblock.sql:213` is what unblocks it. Our existing UI shows MCQ-with-4-options only; PR-5 (the Mock Test surface) needs a numerical-input variant.

---

## Exam landscape — JEE Advanced

| Attribute | Value |
|---|---|
| Conducting body | IIT zonal (rotates) |
| Eligibility | Top 2.5 lakh JEE Main rank |
| Papers | Two papers (P1 + P2), each 54 Qs, 3 hours each |
| Pattern mix | MCQ single + MCQ multi + integer + comprehension + matching |
| Marking | Section-dependent, partial credit on MCQ multi |
| Syllabus | Class 11 + 12 with 20-30% beyond-NCERT depth |
| Difficulty | Bloom's 4-6 (analyze → create) |

JEE Advanced is **the broadest pattern mix of any Indian exam.** The `chk_paper_pattern` constraint in `supabase/migrations/20260520000004_jee_neet_schema_unblock.sql:210-219` accepts all eight patterns precisely because Advanced uses all of them: `mcq_single`, `mcq_multi`, `integer`, `numerical`, `matching`, `comprehension`, `assertion_reason`, `subjective_proof`.

The depth is the differentiator. Advanced doesn't ask new topics beyond NCERT; it asks the same topics with two or three layers of inference chained. A typical Advanced problem requires 5-7 sub-steps. NCERT in-text exercises require 1-2.

This means the AI-augmented generation path (`bulk-question-gen`) is **least suited to Advanced**. Claude can produce coherent JEE Main questions; it struggles to produce Advanced problems that hold together under expert review. PR-3's 70/15/15 sourcing split (PYQ / AI-augmented / in-house) reflects this — Advanced content has to come from PYQs or hired subject experts, not AI.

---

## Exam landscape — NEET (UG)

| Attribute | Value |
|---|---|
| Conducting body | National Testing Agency (NTA) |
| Frequency | Once per year (May) |
| Eligibility | Class 12 PCB |
| Subjects | Physics (45 Qs), Chemistry (45 Qs), Biology (90 Qs — Botany + Zoology) |
| Question count | 180 questions, 720 marks |
| Pattern | All MCQ single |
| Marking | +4 / -1 |
| Duration | 200 minutes (3:20) |
| Per-question time budget | 67 seconds |

NEET is known in the prep ecosystem as **"the NCERT exam."** Roughly 80-90% of questions can be answered from a careful read of NCERT Class 11+12 PCB textbooks. This is good news and bad news for us:

- **Good news:** Our existing CBSE Biology content is closer to NEET-ready than our Physics or Chemistry content is to JEE-ready.
- **Bad news:** Our Biology coverage is the platform's weakest subject. PR-3's 200-PYQ seed should over-index on Biology — at least 80 of the 200 should be NEET Biology, drawn from NEET 2023 + 2024 papers.

The 67-second per-question time budget is the killer constraint. Our current exam engine (`src/lib/exam-engine.ts:39-44`) targets 75-90s per `stem_concept` question (chemistry/biology) for medium difficulty — already too slow for NEET pace. The grade multiplier at `src/lib/exam-engine.ts:47-51` further slows it (Grade 11 = 1.0x, but Grade 12 is also 1.0x — there's no "competitive exam" preset that compresses time).

**Implication:** PR-5 needs to extend `exam-engine.ts` with a `competitive_pace` preset that bypasses the grade multiplier and uses the exam's actual per-question time budget. Add a `paper_pattern`-aware override map: NEET = 67s/Q, JEE Main = 120s/Q, JEE Advanced = 200s/Q.

---

## Olympiad landscape

The HBCSE (Homi Bhabha Centre for Science Education) administers the science Olympiads in India.

| Olympiad | Stages | Grade | Pattern | Notes |
|---|---|---|---|---|
| Mathematical | PRMO/IOQM → RMO → INMO → IMOTC → IMO | 8-12 | Proof-based subjective | Currently OUTSIDE our MCQ-only engine. PR-5 should accept `subjective_proof` pattern for display, but grading remains manual. |
| Physics | NSEP → INPhO → OCSC → IPhO | 11-12 | MCQ + short answer | NSEP has both formats. Our infrastructure handles MCQ stage today. |
| Chemistry | NSEC → INChO → OCSC → IChO | 11-12 | MCQ + numerical | Maps to existing `paper_pattern` values. |
| Biology | NSEB → INBO → OCSC → IBO | 11-12 | MCQ + diagram-based | Diagram questions need image asset infrastructure (deferred). |
| Astronomy | NSEA → INAO → OCSC → IOAA | 9-12 | MCQ + numerical | Niche; lowest priority. |
| Informatics | ZIO → ZCO → INOI → IOITC → IOI | 9-12 | Algorithm subjective | Outside scope — programming-only. |
| Junior Science | NSEJS | 8-10 | MCQ | STEM mix; broader than CBSE. Good entry point for Class 8-10 students. |
| NTSE | State + National | 10 | SAT + MAT | Future is uncertain — Ministry of Education has not held NTSE since 2021. Treat as dormant. |
| KVPY-equivalent | INSPIRE-SHE | 11-12 | Mentorship program, not exam | KVPY itself discontinued. INSPIRE runs but isn't a comparable exam. |

For Wave 1, prioritise NSEP / NSEC / NSEB MCQ stages and NSEJS for junior students. Proof-based math Olympiads (RMO/INMO) are a Wave 2 concern requiring a subjective-answer grading workflow.

---

## What students need that NCERT doesn't give them

NCERT's question bank is structured around **content recall and basic application**. Competitive exams test six additional skills that NCERT does not exercise:

| Skill | NCERT coverage | JEE/NEET demand | Olympiad demand |
|---|---|---|---|
| Problem variety (MCQ single vs assertion/reason vs integer vs matching) | MCQ single only | All four | All four + proofs |
| Time pressure | Untimed exercises | 67s/Q (NEET) to 200s/Q (Adv) | Variable |
| Negative-marking psychology | None | -1 per wrong | -1 to -2 per wrong |
| Multi-step problem chains | 1-2 steps | 3-5 (Main) / 5-7 (Adv) | 5-10+ |
| Calculator-free numerical fluency | Limited | Required | Required |
| Misconception traps | Rare | Common | Designed-in |

The misconception piece is where Alfanumrik already has scaffolding. The misconception curator at `/super-admin/misconceptions` (referenced in `.claude/CLAUDE.md`) and the Eedi-pattern remediation in `src/lib/learn/wrong-answer-remediation.ts` are exactly the tools needed to make Olympiad-style "gotcha" questions pedagogically useful — when a student picks the trap option, we explain *why* the trap was set, not just that the answer is wrong.

The time-pressure piece is the second engineering lift. Our exam engine measures average response time but doesn't display it as a real-time progress bar. PR-5 should add a per-question countdown that visibly accelerates as the student approaches the per-question budget — that's the muscle students fail to build before they walk into NEET.

---

## Content sourcing strategy

| Path | Pros | Cons | Cost | Time-to-1000-Qs |
|---|---|---|---|---|
| **(A) Licensed banks** (Allen / FIITJEE / Resonance) | Accurate, expert-authored, complete coverage | Slow legal cycle, requires existing institute relationship | ₹50L+ upfront + per-question fees | 6+ months |
| **(B) PYQ ingestion** (this PR's path) | Free, historically authoritative, students recognise the format | Fair-use framing required; no Hindi translation; copyright on solutions (questions themselves are usually fair-use) | Curator labour only | 2-3 weeks for 500 questions |
| **(C) AI-augmented generation** (existing `bulk-question-gen` extended) | Fast, scalable, integrates with current oracle gate | Hallucination on advanced difficulty; LLM-grader gate (REG-54) hasn't been validated against Advanced problems | Claude API cost + curator review | 1-2 weeks for 500 questions, but quality requires human review |
| **(D) In-house authoring** | Highest quality, exclusive IP, can be trained for Alfanumrik pedagogy | Slow, requires payroll for subject experts (₹1L+ /month per subject) | ₹4-5L/month for 3 subjects | 4+ months for first 500 |

**Recommended Wave 1 split: 70 / 15 / 15.**

- 70% PYQ (paths B) — fastest to 1000 questions, students trust the format
- 15% AI-augmented (path C) — fills coverage gaps where PYQs are thin, gated by REG-54 oracle
- 15% in-house (path D) — for the 20% of Advanced problems where AI fails

The bulk Edge Function in PR-2 handles paths B and D (curator-driven import). The AI path stays in `bulk-question-gen` and gets extended in a follow-up to emit `source_type = 'pyq'` or `'curated'` based on a request flag.

**Legal note on PYQ ingestion.** Question text from past exam papers is generally treated as fair-use educational material in India (Section 52 of the Copyright Act covers educational use). However: (a) solution text from coaching institute booklets is NOT fair use, (b) NTA/IIT have not litigated PYQ republication but we should attribute the source paper in every row, (c) Olympiad questions are typically licensed for educational use by HBCSE policy. The schema includes `exam_session` (e.g. `'jee_main_jan_2024'`) precisely to ensure attribution is queryable.

---

## Plan tiering recommendation

Keep the existing free / pro / family plans. Add one new SKU: **Competition**.

| SKU | Monthly | Annual | What's included |
|---|---|---|---|
| Free | ₹0 | ₹0 | CBSE board prep + 5 JEE/NEET PYQ previews per day |
| Pro (existing) | ₹299 | ₹2,499 | Full CBSE, Foxy chat unlimited, mock tests |
| **Competition (new)** | ₹999 | ₹7,999 | Pro + unlimited JEE/NEET/Olympiad PYQs + IRT-targeted progression + paper-pattern mock tests |
| Family (existing) | ₹599 | ₹4,999 | Up to 3 students, all Pro features |

The Competition SKU is gated by `ff_competitive_exams_v1` (default OFF) — a new flag to add in PR-7. Plan-tier enforcement at the API layer goes in `src/lib/rbac.ts`. The Phase 2 RPC at `get_adaptive_questions_v2` doesn't need changes — its goal-aware boosts already differentiate competitive from board users.

The free-tier 5-question-per-day daily allowance is the funnel: it lets students see the PYQ catalogue exists, then friction-pushes them to upgrade. Embibe and Vedantu both use this pattern with daily caps of 3-10 questions; Vedantu charges ₹1,499/month vs our proposed ₹999/month.

---

## Success metrics

Track these from PR-4 onward (super-admin reporting work for ops to spec out as part of PR-7):

| Metric | Definition | Threshold for "the bet is working" |
|---|---|---|
| Track adoption | % of `competitive_exam`-goal students completing ≥1 mock test/week | 40% within 30 days of PR-5 |
| IRT theta progression | Mean theta delta per week per active competitive student | +0.1 / week sustained |
| Mock-test percentile | Estimated NTA-percentile mapping from internal score → published cutoff bands | ≥70th percentile reached by 25% of users in 90 days |
| Content coverage by paper-pattern | Question count distributed across all 8 `paper_pattern` values | ≥100 each except `subjective_proof` (deferred) |
| Time-to-readiness | Days from goal-set to first "JEE-Main-ready" badge (theta ≥ 1.0 in PCM) | Median ≤ 120 days |
| Plan conversion | % of free-tier users with `exam_goal = competitive_exam` who upgrade to Competition SKU within 14 days | 8% |
| Refund rate | % of Competition SKU subscriptions cancelled within 7 days | <5% |

The IRT theta metric reuses the existing nightly calibration cron at `/api/cron/irt-calibrate` (scheduled `50 2 * * *` per `vercel.json:39-42`). PR-6 extends the calibrator to filter on the wider `is_active = true` predicate so newly imported PYQs participate in calibration as soon as they're inserted.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **PYQ licensing exposure** — a coaching institute claims copyright on a question we import | Medium | High (legal action + content takedown) | Attribute every row with `exam_session`. Use only NTA/IIT/HBCSE papers, not coaching-institute mock papers. Take legal review before PR-3 ships >500 questions. |
| 2 | **AI hallucination on Advanced difficulty** — `bulk-question-gen` produces a JEE Advanced question that's plausible but mathematically wrong | High (LLMs are weak here) | Medium (single bad question = students lose trust) | Existing oracle gate REG-54 (`supabase/functions/_shared/quiz-oracle.ts`) must be hardened with Advanced-difficulty validation cases before AI path expands beyond JEE Main difficulty. Until then, AI path is capped at `difficulty <= 3` (medium). |
| 3 | **Indian 4G bandwidth on math LaTeX** — questions with formulas need MathJax/KaTeX rendering that bloats page weight | High | Medium (slow load = abandonment) | Pre-render LaTeX to PNG/SVG at ingestion time, store as `cms_assets`. Bundle budget P10 (175 kB shared JS) cannot accommodate client-side MathJax. |
| 4 | **Hindi-language coverage gap** — P7 invariant requires Hi/En parity but our PYQ source corpora are primarily English | High | Medium (50%+ of Tier 2/3 users prefer Hindi) | Accept English-only PYQs in Wave 1 with explicit `language = 'en'` tag. Plan for a Hindi-PYQ ingestion path in Wave 2 using NTA's official Hindi paper translations (NEET in particular has official bilingual papers). |
| 5 | **Competitive copycat threat** — Embibe / Vedantu / Physics Wallah have 10x our content and brand recognition | Certain | Medium (we can't out-content them) | Our wedge is integrated CBSE → competition progression, not standalone competition prep. Marketing positioning emphasises the connected learning track, not raw question count. |
| 6 | **IRT calibration on sparse data** — newly imported PYQs have zero student responses; calibration produces unreliable theta | Certain (for first ~30 days post-import) | Low (decays as data accumulates) | Mark new PYQs with `verification_state = 'pending'` and exclude from IRT-based selection until they have ≥10 responses. The existing cron already filters by `is_active`; add a calibration-eligibility predicate in PR-6. |
| 7 | **Oracle gate over-rejection** — strict P6 enforcement causes >30% of curator-uploaded PYQs to be rejected | Medium | Medium (curator labour wasted) | The PR-2 Edge Function emits per-question rejection codes (13 codes) so curators can fix and re-submit. Build a super-admin dashboard for the rejection log in PR-7. |

---

## Phased roadmap

| PR | Status | Title | Notes |
|---|---|---|---|
| **PR-1** | DONE (2026-05-20) | Schema unblock | `supabase/migrations/20260520000004_jee_neet_schema_unblock.sql` — widened `chk_source_type`, added 6 PYQ columns, added `chk_paper_pattern`, added two partial indexes |
| **PR-2** | THIS PR | `exam_papers` table + `bulk-jee-neet-import` Edge Function | `supabase/migrations/20260520000005_exam_papers_and_pyq_import.sql` + `supabase/functions/bulk-jee-neet-import/index.ts`. Detailed spec at `docs/specs/2026-05-19-pr2-bulk-jee-neet-import.md`. |
| **PR-3** | Next | Seed 200 PYQs | Content-only PR via the PR-2 Edge Function. JEE Main 2023 + 2024 (Physics, Chemistry, Math): 30 questions each = 90. NEET 2023 + 2024 (Bio-heavy split: 40 Bio + 15 Chem + 15 Phys per year): 110 total. Curator-driven; no code changes. |
| **PR-4** | After PR-3 reaches 500+ rows | Flip `ff_goal_aware_selection` to 10% canary on staging | Operator runbook is already in `supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql:30-67`. No code changes — just a flag flip via super-admin. |
| **PR-5** | After PR-4 stabilises | Mock Test surface | New `/exams/mock` route + Mock Test runner component. Extends `src/lib/exam-engine.ts` with a `competitive_pace` preset that bypasses the grade multiplier and uses paper-pattern-aware per-question time budgets (NEET=67s, JEE Main=120s, JEE Advanced=200s). Adds numerical-input variant alongside the existing MCQ runner. |
| **PR-6** | After PR-5 | IRT calibration extension | Modify `/api/cron/irt-calibrate` (scheduled `50 2 * * *` per `vercel.json:39-42`) to widen the active-question predicate so newly imported PYQs participate in calibration once they have ≥10 student responses. |
| **PR-7+** | After PR-6 stabilises | Competition SKU launch | `ff_competitive_exams_v1` flag + plan-tier gating in `src/lib/rbac.ts` + Razorpay plan ID for ₹999/mo and ₹7,999/yr SKUs + super-admin reporting for competition-track health (PYQ coverage, theta progression, plan conversion). |

---

## Locked decisions (2026-05-19)

CEO has locked all 8 prior open questions with the following defaults so PR-3 / PR-5 / PR-7 can ship in this session. Each entry is final unless explicitly revisited via a follow-up ADR.

1. **Competition SKU pricing.** ₹999/month or ₹7,999/year (~33% annual discount over the monthly run-rate). This sits below Embibe and Vedantu (₹1,499/month each) while comfortably above Physics Wallah's annual-only pricing. The Razorpay plan must be created manually in the Razorpay dashboard before the `ff_competitive_exams_v1` flag is flipped — see `docs/runbooks/competition-sku-activation.md` for the ops sequence.

2. **Hindi language support for advanced content.** Deferred to Wave 2. Wave 1 ships English-only for all JEE / NEET / Olympiad questions imported via `bulk-jee-neet-import`; existing NCERT and CBSE-board content continues to be served bilingually via the `isHi` toggle. The student-facing `/exams/mock` route must display a "Hindi coming soon" badge on competition-track papers so the language gap is honest and visible.

3. **Licensing partner.** None for Wave 1. All Wave 1 seed content is Alfanumrik-authored original PYQ-style questions, marked with a `paper_code` prefix of `sample_` (e.g. `sample_jee_main_2024_p1`, `sample_neet_2024`, `sample_olympiad_math_v1`). Licensed partnerships with Allen / Resonance / FIITJEE are revisited only after the competition track reaches 1,000 free-tier MAU; no negotiation work happens before that threshold.

4. **Peer ranking / leaderboards on mock tests.** Opt-in only, default off. Privacy-first: a student must explicitly toggle "Share my score on the leaderboard" in `/settings/privacy` before any mock-test score appears in any aggregate visible to other students. No grade-level peer comparison is rendered without consent. This is the conservative reading of P13 — peer-aggregate data is still derived from individual scores, so we treat it as PII-adjacent until the student opts in.

5. **Free-tier daily allowance.** 5 JEE/NEET PYQs per day, counted in `daily_quiz_count` with a separate sub-counter (a future migration may add a `daily_competition_count` column if we need to separate the cap from CBSE practice). Olympiad questions are fully paywalled on free tier (0/day). Mock-test starts are fully paywalled on free tier (0/day). CBSE board papers remain unmetered. This pattern matches Embibe's funnel while leaving room for the Competition SKU to differentiate clearly.

6. **NTSE inclusion.** Excluded. NTSE was discontinued by the Ministry of Education in 2020-21 and no scholarships have been awarded since. Wave 1 ships zero NTSE content. We re-evaluate if and when MoE re-launches the program — at that point the existing `paper_pattern` and `exam_session` columns will accommodate it without schema changes.

7. **Subjective-proof grading workflow (olympiads).** Deferred to PR-8. Wave 1 ships MCQ-only olympiad content: the seed `sample_olympiad_math_v1` paper uses `paper_pattern = 'mcq_single'` rather than `subjective_proof`. The full workflow (Claude-graded rubrics + admin review of borderline cases + manual override) lands in PR-8 after we have observational data from MCQ-only olympiad usage and can size the manual-grading queue accurately.

8. **Razorpay plan creation ownership.** Ops owns the activation sequence. The full sequence is: (a) ops creates the monthly and yearly plans in the Razorpay dashboard with the names and notes defined in the runbook, (b) ops inserts `razorpay_plan_id_monthly` and `razorpay_plan_id_yearly` into `public.plans WHERE plan_code = 'competition'`, (c) ops flips `ff_competitive_exams_v1.is_enabled = true` via the super-admin Flags console, (d) ops sets `plans.competition.is_active = true`. The full runbook is at `docs/runbooks/competition-sku-activation.md`.

---

## Session ship log (2026-05-19)

This session locked decisions and shipped four PRs along the JEE/NEET/Olympiad track. The table below is the honest, narrow record of what actually merged in this session — and what explicitly did NOT.

| PR | Status | What landed |
|---|---|---|
| PR-1 | DONE (pre-session, 2026-05-20) | Schema unblock migration `20260520000004_jee_neet_schema_unblock.sql`. Widened `chk_source_type`, added 6 PYQ columns, added `chk_paper_pattern`. |
| PR-2 | DONE (this session) | `exam_papers` table + `bulk-jee-neet-import` Edge Function. Migration `20260520000005_exam_papers_and_pyq_import.sql` plus `supabase/functions/bulk-jee-neet-import/index.ts`. |
| PR-3 | DONE (this session) | ~150 seed PYQ-style questions across 5 sample papers (Alfanumrik-authored originals, `paper_code` prefix `sample_`). Migration `20260520000006`. All gated by Wave-1 English-only and `mcq_single`-only-for-olympiads decisions above. |
| PR-5 | DONE (this session) | `/exams/mock` student route + `/api/exams/papers` API + mock-test runner component. Frontend + API files. Numerical-input variant ships alongside the existing MCQ runner. |
| PR-7 substrate | DONE (this session) | `ff_competitive_exams_v1` feature flag (default OFF), `competition` plan SKU row (default `is_active = false`), and `competition.access` permission. Migration `20260520000007`. Activation gated on the runbook sequence in lock #8. |
| Locked decisions | DONE (this session) | All 8 prior open questions resolved per the defaults above. |
| PR-4 | NOT in this session | The 10% canary flag flip on `ff_goal_aware_selection` awaits more seed content (target: 500+ rows across `source_type IN ('jee_archive','neet_archive','olympiad')`). PR-3's ~150 rows are insufficient for a stable canary. |
| PR-6 | NOT in this session | The mock-test submit handler and IRT calibration extension ship after the first cohort of students has used the PR-5 runner enough to generate calibration-worthy response data (≥10 responses per question). Premature shipping would produce unreliable theta. |
| PR-8 | NOT in this session | Subjective-proof olympiad grading is locked to PR-8 per decision #7 above. Manual-grading admin tool + Claude-rubric integration lands after Wave 1 MCQ-only data informs the manual-queue sizing. |

**Net session output:** 4 PRs merged (PR-2, PR-3, PR-5, PR-7 substrate), 3 PRs explicitly deferred with stated triggers (PR-4 on content threshold, PR-6 on response-data threshold, PR-8 on observational-data threshold), 8 prior open questions locked, 1 new runbook authored (`docs/runbooks/competition-sku-activation.md`).
