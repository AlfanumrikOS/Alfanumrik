# ALFANUMRIK — DEVELOPER DOCKET

**Adaptive Learning OS for CBSE · Grades 6–12 · NCERT-aligned · AI-powered**

| | |
|---|---|
| Prepared for | Alfanumrik Engineering Team |
| Issued by | Office of the CEO · Pradeep Sharma |
| Entity | Cusiosense Learning India Pvt. Ltd. (Startup India Recognised) |
| Version | 1.0 |
| Date | 16 May 2026 |
| Confidentiality | Internal · Confidential |

---

## Table of Contents

0. Executive Summary
1. Product North Star & Operating Principles
2. Current Platform Audit (As Of 16 May 2026)
3. Global Market & Competitive Research
4. Strategic Gaps & Alfanumrik MOAT
5. Prioritized Backlog (P0 → P3)
6. Feature Specifications — P0 & P1 Detail
7. 90-Day Execution Roadmap
8. Team Structure & Hiring Plan
9. Risks, Compliance & Operational Readiness
10. Definitions, Conventions & Source Index

---

## 0. Executive Summary

Alfanumrik is in a strong production position — **54 frontend pages, 36 API routes, 13 Supabase Edge Functions, and 19 versioned migrations** across security, performance, IRT, affective state, and white-label hardening. The cognitive engine already implements BKT, IRT 3PL Newton-Raphson MLE, SM-2 spaced repetition, Bloom progression, ZPD, cognitive-load detection, and an RL reward function. RBAC, audit logging, payment idempotency, and Voyage RAG are wired in. This puts us ahead of most Indian K-12 entrants on engineering depth.

However, three forces are converging that this docket addresses:

- **Regulatory:** NCERT releases new Class 9 and Class 11 textbooks aligned to NCF-SE 2023 for the **2026-27 session (June 2026 onward)**. AI becomes a compulsorily board-examined CBSE subject for Class 10 from 2029. Class 6 R3 books are already live. RAG index must be re-built before academic year start, or content drift becomes a P0 incident.
- **Competitive:** Byju's is in insolvency (founder lost control, US court ordered $1.07B repayment, Play Store delisted May 2025). The vacuum is being filled by PhysicsWallah (₹3,480 Cr IPO Nov 2025, ₹400 Cr K-12 push, 3.5M students), Vedantu (hybrid offline+online), and Embibe (Reliance-backed adaptive). India edtech market grows **USD 3.63B → USD 33.31B by 2034 at 27.94% CAGR**; K-12 is 43% share. Now is the window to plant the flag.
- **Technological:** Khan Academy moved Khanmigo to GPT-4o with a math-verifier agent and Corrective RAG (CRAG). Squirrel AI runs 30,000+ knowledge atoms in a curated knowledge graph. DreamBox delivered 60% above-expected math gains at 60 min/week (Harvard, 75 schools). Duolingo's streak-freeze pushed daily retention +48% past day 7. These are now the table-stakes benchmarks — not aspirations.

> **TOP-OF-MIND FOR THE DEV TEAM.** Eight P0 items must ship before **30 June 2026**:
> (1) NCERT NCF-SE 2023 RAG re-index for Class 6 R3 + Class 9 + Class 11;
> (2) baseline schema versioned into Git;
> (3) IDOR fix in ml-adaptation;
> (4) Razorpay yearly plans registered;
> (5) math-verifier agent for Foxy;
> (6) streak freeze mechanic;
> (7) demo-mode flag verified across roles;
> (8) Sentry release-tracking on every deploy.
> Detail in §5–§7.

The roadmap that follows is a 90-day plan to lock in production stability, close the curriculum freshness gap, and ship four MOAT features (Concept Mastery Graph, Math-Verifier Foxy, Phygital Worksheets, Parent Outcomes Dashboard) that competitors cannot copy in a single quarter. Everything obeys the Alfanumrik Build Blueprint v2 — backward compatibility, NCERT-only via RAG, RBAC on every admin route, ₹-only Razorpay with idempotency, no ghost routes, no placeholders.

---

## 1. Product North Star & Operating Principles

### 1.1 What We Are Building

Alfanumrik is a result-oriented adaptive learning operating system for CBSE Grades 6–12, fully aligned to the latest NCERT curriculum. The product is engineered around four user surfaces:

- **Foxy AI tutor** — conversational concept mastery
- **Quiz Engine** — adaptive practice and assessment
- **Mastery Dashboard** — parent + teacher + student visibility
- **Mock Exams** — high-stakes simulation

Foxy is the brain; the cognitive engine + RAG is the substrate; CME (Concept Mastery Engine) + XP economy is the loop.

### 1.2 Immovable Product Anchors

| Anchor | Specification | Why It Is Immovable |
|---|---|---|
| Audience | CBSE students Grades 6–12 + parents + teachers | Largest, most measurable, exam-driven K-12 segment in India |
| Curriculum | NCERT current edition only | No hallucinated or stale syllabus is shippable for board-exam students |
| Subjects (MVP) | Maths, Science, Social Science, English, Hindi | CBSE board exam scope |
| Adaptive engine | BKT (MVP) → IRT-calibrated b-params → Deep KT (post-scale) | Defensible accuracy + interpretability |
| Stack | Next.js App Router · Supabase · Edge Functions · Voyage · Anthropic | Already in production — no rewrites |
| Compliance | India DPDP Act 2023 · parental consent · no ad tracking | Statutory; non-negotiable for minors |
| Payments | Razorpay · INR only · idempotent · paise-stored | Indian retail at scale |
| Pricing tiers | ₹299 / ₹699 / ₹1,099 monthly · ARPU target ₹6,200/yr | Tested unit economics |

### 1.3 Engineering Operating Principles (Non-Negotiable)

- **Backward compatibility first** — no working feature is broken without a migration and rollback path.
- **Minimal, targeted changes** — never rewrite a file when an edit suffices.
- **NCERT content only, via RAG** — no static fallback, no legacy syllabus, no hardcoded chapter lists.
- **RBAC on every admin route** — server-side role check, audit log, no silent failure.
- **Input validation at every boundary** — UUID, auth, schema-checked payload, structured error codes.
- **No placeholders in production code or SQL** — never `<uuid>`, TODO, dummy IDs, example.com.
- **Idempotent payments** — never reset quotas on deploy; signatures HMAC-SHA256 verified.
- **No ghost routes** — every App Router path resolves in production; removed routes 410/redirect.
- **Approved stack only** — no new tools/services without explicit CEO approval.
- **Root-cause debugging** — patch the cause, not the symptom; if blocked, declare it.

---

## 2. Current Platform Audit (As Of 16 May 2026)

### 2.1 Stack & Dependencies Verified

**Frontend:** Next.js 16.2.1 (App Router) + React 18.3.1 + Tailwind 3.4 + SWR 2.4 + Vercel Analytics + Vercel Speed Insights + Sentry 10.45 (client + server + edge) + Upstash Redis + Upstash Ratelimit + PostHog.

**Backend:** Supabase (Postgres 15 + Auth + Storage + Edge Functions) + Voyage embeddings (voyage-large-2) + Anthropic API.

**Testing:** Vitest 4.1 + Playwright 1.58. **Build:** TypeScript 5.4, ESLint 8.57.

Stack is current and approved — no replacements proposed.

### 2.2 Implemented Surfaces (54 pages)

| Surface | Routes | Status |
|---|---|---|
| Marketing | /, /about, /pricing, /product, /research, /contact, /security, /demo, /privacy, /terms, /for-parents, /for-schools, /for-teachers | **Live** |
| Auth | /login, /auth/reset, /auth/callback, /auth/confirm | **Live** |
| Student app | /dashboard, /quiz, /exams, /progress, /study-plan, /simulations, /leaderboard, /review, /foxy, /scan, /hpc, /stem-centre, /profile, /billing, /help, /notifications, /reports, /welcome | **Live** |
| Parent app | /parent, /parent/children, /parent/profile, /parent/support, /parent/reports | **Live** |
| Teacher app | /teacher, /teacher/classes, /teacher/students, /teacher/profile, /teacher/reports, /teacher/worksheets | **Live** |
| Super-admin | /super-admin (control room) + cms, flags, institutions, learning, login, logs, reports, subscriptions, support, users, workbench, diagnostics | **Live** |

### 2.3 Implemented APIs (36 routes)

| Cluster | Endpoints | Coverage |
|---|---|---|
| Super-admin | 15 routes — analytics, cms, feature-flags, institutions, logs, platform-ops, reports, stats, support, users, content, deploy, observability, roles, test-accounts | Comprehensive control plane |
| Payments | 6 routes — cancel, verify, webhook, setup-plans, status, subscribe | Idempotent + signed |
| v1 child & exam | 8 routes — admin/audit-logs, admin/roles, child/[id]/progress, child/[id]/report, exam/create, health, performance, study-plan, upload-assignment, class/[id]/analytics | Stable API contract |
| Cron + error | /api/cron/daily, /api/error-report | Sentry-bridged |

### 2.4 Implemented Edge Functions (13)

| Function | Purpose | Notes |
|---|---|---|
| foxy-tutor | AI tutor with RAG context, daily quota, streaming | v32 hardened — circuit breaker, CORS allowlist, in-memory rate limit |
| ncert-solver | Step-by-step NCERT problem solver | Live |
| quiz-generator | Adaptive question selection from question_bank | Dual rate-limit (memory + DB), max 30 questions |
| ml-adaptation | BKT + IRT theta update on quiz response | **IDOR fix required (§6.3)** |
| rag-retrieval | Voyage vector search + concept/chapter outline | Cold-start telemetry; CORS to tighten |
| cme-engine | Concept Mastery Engine — mastery recompute | Live |
| daily-cron | Streak roll, quota reset, retention notifications | P5 fix applied |
| queue-consumer | Async job processor | Live |
| scan-ocr | Worksheet OCR via Anthropic vision | Live |
| export-report | Parent + teacher report PDF generation | Live |
| send-auth-email | Mailgun OTP + reset templates | Live |
| send-welcome-email | Onboarding drip step 1 | Live |
| session-guard | Server-side session validation | Live |

### 2.5 Database Migrations Applied (19 — most recent first)

- 20260525130002 — API query path indexes batch 2 (performance advisor)
- 20260525130001 — Security & performance advisor batch 1
- 20260515000004 — Covering indexes batch B
- 20260515000003 — Covering indexes batch A
- 20260515000002 — Security hardening — SECDEF + anon + search_path + RLS view
- 20260515000001 — Add is_demo to teachers & guardians
- 20260506000003 — Restore RLS WITH CHECK clauses
- 20260506000002 — White-label school schema
- 20260506000001 — Fix IRT and affective race conditions
- 20260410000001 — Add UNIQUE constraints (closes audit CRITICAL-2)
- 20260408000001–9 — P4 sprint: IRT, affective state pipeline, RLS init-plan, search_path, service-role RLS, FK covering indexes, redundant-index drops, usage-overload fix

### 2.6 Cognitive Engine Inventory (`src/lib/cognitive-engine.ts`)

Genuinely competitive depth — 15 cognitive-science primitives implemented as pure functions, all unit-testable. This is a defensible asset.

| Capability | Algorithm | Status vs. global benchmark |
|---|---|---|
| Spaced repetition | SM-2 (SuperMemo) | On par with Anki, DuoCards |
| Mastery tracking | Bayesian Knowledge Tracing (adaptive params) | Squirrel AI / DreamBox parity |
| Ability estimation | IRT 3PL Newton-Raphson MLE | CAT-grade (Squirrel AI uses same) |
| Reinforcement learning | RL reward function for next-item selection | Ahead of most Indian peers |
| Forgetting model | Ebbinghaus retention decay | Anki parity |
| Cognitive load | Live fatigue detection, mid-session adjustment | Ahead of Khan, Vedantu, PW |
| Bloom progression | 6-level (remember → create) with bilingual labels | Strong differentiator |
| ZPD calculator | Zone of Proximal Development item targeting | Match DreamBox approach |
| Interleaving | Always-on, enhanced | Aligned to current research |
| Metacognition | Bilingual reflection prompt generator | Differentiator |
| Lesson flow | 6-step structured flow with gating | Differentiator (most rivals are free-form) |
| Predict-before-reveal | Active recall prompt before answer | Differentiator |
| Error classification | Careless · conceptual · misinterpretation | Strong — most rivals only mark wrong/right |
| Knowledge gap detector | Concept-graph traversal | Match Squirrel AI atoms |
| Velocity analytics | Learning velocity per concept | Differentiator |

### 2.7 RBAC & Security Posture

Production-grade. `src/lib/rbac.ts` implements `authorizeRequest(request, permission)` used by every admin/v1 API route. Permission cache (5-min TTL, 200-entry cap, in-memory; redis upgrade path documented). Resource ownership checks (`own | linked | assigned | any`). Audit logs piped to `audit_logs` table. SECURITY DEFINER functions have `search_path` locked (migration 20260515000002). RLS WITH CHECK restored (migration 20260506000003).

> **KNOWN IDOR — fix scheduled P0.** `supabase/functions/ml-adaptation/index.ts` reads `student_id` from request body and the RBAC check verifies only role, not identity. Any authenticated student can read/manipulate another student's BKT mastery. Fix is in §6.3.

### 2.8 Payments Posture

Razorpay integration in `src/modules/payments/razorpay.ts` is correct: paise storage, HMAC-SHA256 signature verification, `X-Razorpay-Idempotency-Key` on every mutation, server-side audit. **Outstanding action:** `subscription_plans.razorpay_plan_id` is NULL for all three yearly tiers (Starter ₹2,399 / Pro ₹5,599 / Unlimited ₹11,999). Yearly plans cannot be created from the API until those IDs are populated.

### 2.9 Open Risks From Prior Audits

| Risk | Severity | Status |
|---|---|---|
| Base schema not in version control (no CREATE TABLE migration) | **CRITICAL** | P0 — `supabase db dump → 00000000000000_initial_schema.sql` |
| IDOR in ml-adaptation (student_id from body) | **CRITICAL** | P0 — enforce auth_user_id → students.id mapping |
| Race conditions on quiz submit (UNIQUE constraints) | HIGH | PARTIAL — uq added 2026-04-10; 2026-05-06 race fix applied |
| rag-retrieval CORS wildcard | MEDIUM | P1 — port foxy-tutor allowlist |
| ml-adaptation CORS wildcard | MEDIUM | P1 — port foxy-tutor allowlist |
| Yearly Razorpay plans unconfigured | HIGH | P0 — register IDs + UPDATE subscription_plans |
| Curriculum drift risk (NCERT 2026-27 update) | HIGH | P0 — re-index Class 6 R3, Class 9 & 11 NCF-SE 2023 before June |

---

## 3. Global Market & Competitive Research

### 3.1 Market Size & Tailwinds

India K-12 edtech sits inside an addressable market that grows from **USD 3.63B in 2025 to USD 33.31B by 2034 — a 27.94% CAGR** (IMARC, 2026). K-12 holds a **43% share** of total edtech spend (2025), driven by parental investment and supplementary digital learning. Globally, AI-in-education is a separate accelerator: **84% of production AI assistants in 2026 use RAG-based workflows** (2026 AI Trends Report). Net effect: the platform we are building rides two compounding tailwinds — Indian K-12 wallet expansion and AI-tutor adoption.

### 3.2 Regulatory Window — NCERT NCF-SE 2023

National Education Policy 2020 implementation now hits the textbook layer.

- Class 6 R3 books are **live** (2026-27).
- Class 9 and Class 11 receive new NCF-SE 2023-aligned textbooks for the **2026-27 academic year (June 2026 onwards)**.
- Classes 10 and 12 keep existing books for 2026-27; revised for 2027-28.

Major shifts:

- Integrated 3-part Class 9 structure (replaces siloed subjects).
- Two-level assessment (Proficiency mandatory + Advanced optional).
- Mathematics emphasis on algebraic thinking and real-world modeling.
- English Beehive + Moments consolidated into **Kaveri**.
- **AI as a compulsorily board-examined CBSE subject from 2029** (today's Class 6 students).
- Vocational education, art, and health are now compulsory for Classes 9–10.

> **WHAT THIS MEANS FOR ALFANUMRIK.** We get a regulatory moat if we ship NCF-SE 2023-aligned content first. Specifically: (a) RAG index must be rebuilt against Class 6 R3 and the new Class 9 / 11 books — purging atomically with the legacy index; (b) we should pre-build the two-level assessment model (Proficiency vs. Advanced) into `question_bank`; (c) AI-as-subject is a 3-year tailwind — we should start offering an AI elective track for Class 8–10 in 2027 H1.

### 3.3 Indian K-12 Competitors — Current State

| Player | Position 2026 | AI / Adaptive | Where they are weak |
|---|---|---|---|
| Byju's | In insolvency. Founder lost control Nov 2025. App delisted May 2025. $1.07B US court order. | Legacy Toppr adaptive — abandoned | Brand damage. Parents actively migrating. |
| PhysicsWallah | IPO listed Nov 2025 — ₹3,480 Cr. ₹400 Cr K-12 push via Pen Pencil. 3.5M students. 8M YouTube subs. | Limited — moving to "China-style K-12" | Test-prep DNA (97% of revenue); shallow adaptive engine |
| Vedantu | Hybrid offline + online. Targeting 2026 listing. | AI personalisation marketed, depth unclear | Hybrid CAPEX heavy; weaker self-paced product |
| Unacademy | Shifted to physical coaching centres. Test-prep focus. | Limited K-12 adaptive | K-12 not the core mission |
| Embibe (Reliance Jio) | Adaptive learning + Knowledge Graph. Reliance backing. | Strong adaptive marketing; closed platform | Less Foxy-style conversational tutor; opaque UX |
| Doubtnut | Acquired by Allen Career Institute for ~$10M (Dec 2023). | Image-based doubt solver | Narrow doubt-solving feature; not full LMS |
| Toppr | Inside Byju's — frozen | Dormant | No active investment |

### 3.4 Global Adaptive Learning Leaders — Patterns To Copy

| Player | Key technical pattern | Outcome data |
|---|---|---|
| **Khan Academy / Khanmigo** | GPT-4o + math-verifier agent that runs alongside the tutor and re-checks calculations in real time. CRAG (Corrective RAG) when retrieval is poor. Context is gathered from human-authored exercises, hints, and solutions BEFORE LLM call. | 40k → 700k students in one academic year (2024-25). On track for 1M+ in 2025-26. 15% of access cohort uses it weekly (efficacy challenge — not just access). |
| **Squirrel AI** | 30,000+ "knowledge atoms" curated by experts, modeled as a knowledge graph. Mid-school math alone = 10,000 nodes. IRT + CAT for ability; BKT for mastery prediction. | Largest adaptive deployment in China; US arm launched 2026. |
| **DreamBox** | Intelligent Adaptive Learning Engine analyses HOW students solve, not just the final answer. Strategy classification. | Harvard study, 75 schools: 60% above expected math gains at 60 min/week. Closes achievement gaps. |
| **Century Tech** | AI engine that personalises pathway across subjects, integrates with UK national curriculum. | Strong UK + GCC schools penetration; teacher-facing analytics. |

### 3.5 AI-Tutoring & RAG Best Practices (2026)

- **CRAG (Corrective RAG)** — detect poor retrieval and re-route before LLM generation. Reduces hallucination cascades in low-recall queries.
- **Verifier agents per domain** — Khanmigo math-agent re-checks every numeric step. We should ship Foxy-Math-Verifier (deterministic sympy + range check) and Foxy-Solver-Critic (peer-LLM check on multi-step solutions).
- **Pre-LLM context priming** — gather all human-authored hints, prior solutions, and curriculum chunks BEFORE the model call, not after. Reduces hallucination materially.
- **Streaming-first UX** — keep TTFB < 800ms; users abandon at 2s. Foxy already streams; ensure same for solver and quiz hints.
- **On-domain reasoning only** — Khanmigo refuses off-topic chat. Foxy should reject non-NCERT requests with a curriculum-anchored deflection.
- **Multilingual retrieval** — index Hindi and Hinglish chunks alongside English. We already store `language` column in `rag_content_chunks` — verify Hindi coverage is at parity.

### 3.6 Engagement & Gamification Leaders

Duolingo grew DAU from ~5M (2020) to 40M+ (2024) to **128M+ MAU (Q2 2025)**, +36% YoY DAU in 2026, and cut Western churn to 28%. The mechanic stack matters more than any single feature.

| Mechanic | How it works | Where Alfanumrik stands |
|---|---|---|
| XP for all in-app activity | Every meaningful action earns XP; daily caps prevent spam | **IMPLEMENTED** — `XP_RULES` in `xp-rules.ts` with daily caps |
| Daily streaks | Counter resets on a missed day → loss aversion | **IMPLEMENTED** — daily_streak + milestones (7, 30, 100) |
| Streak freeze | Protects streak through one missed day. Drives +48% retention past day 7 (industry data). | **P0 — MISSING.** Build §6.6 |
| Customisable daily goals | 5/10/15 min targets; choice gives autonomy | **PARTIAL** — exists in study-plan; surface in dashboard |
| Achievement badges | Long-tail micro-rewards | **PARTIAL** |
| Weekly leagues (promotion/demotion) | Pareto-front competition; matches similar skill levels | **P1** — leaderboard exists; promotion/demotion to add |
| Friend streaks / challenges | Peer accountability | **P2** — not yet built |
| Seasonal events | Time-limited cohorts → urgency | **P2** |

---

## 4. Strategic Gaps & Alfanumrik MOAT

A defensible MOAT in K-12 adaptive learning is built from four layers: curriculum trust, algorithmic depth, learning-outcome proof, and habit lock-in. Alfanumrik already leads on layer 2 (algorithmic depth). Layer 1 (trust) is at risk if NCERT 2026-27 is not re-indexed in time. Layers 3 (proof) and 4 (lock-in) need new investment.

### 4.1 The Four Layers

| Layer | Definition | Status | P-priority |
|---|---|---|---|
| L1 — Curriculum trust | Parents and teachers believe content is current, accurate, board-aligned | **AT-RISK** — NCF-SE 2023 re-index pending | P0 |
| L2 — Algorithmic depth | BKT + IRT + RL + cognitive load + Bloom + ZPD all interacting | **LEAD** — ahead of all Indian rivals | Maintain |
| L3 — Outcome proof | Quantified learning gains visible to parents (pre/post, percentile) | **GAP** — no public efficacy data yet | P1 |
| L4 — Habit lock-in | Streak, leagues, friend graph, daily ritual | **PARTIAL** — XP + streak live; freeze + leagues + social missing | P1 |

### 4.2 Four MOAT Plays To Ship This Quarter

**MOAT-1 · Concept Mastery Graph (visible to parent).** Squirrel AI built its moat by exposing the knowledge graph to schools and parents. We already have `concept_graph` (concept_code, prerequisite_codes, bloom_level). The play: ship a Parent Mastery Graph view that visualises mastery per concept node, highlights weak prerequisites, and projects "exam-readiness by date X". This is the visible artefact that converts a parent from "I see a score" to "I see a learning trajectory" — and triggers renewals.

**MOAT-2 · Math-Verifier Foxy.** Khanmigo's biggest single 2025 quality win was the math-verifier agent. We replicate with a deterministic sympy-based verifier that re-checks every numeric or algebraic step Foxy produces. If verifier disagrees, Foxy retries with the verifier output as context. Cuts math hallucination by an order of magnitude.

**MOAT-3 · Phygital Worksheets.** We already have `scan-ocr`. Convert that into a teacher-facing worksheet engine: teacher prints a Foxy-personalised worksheet for the class, students complete on paper, teacher (or student) scans, OCR + Foxy grade, results land back in the mastery graph. This makes Alfanumrik usable in low-connectivity classrooms — the segment PhysicsWallah is targeting with its ₹400 Cr K-12 push. Nobody else has the closed phygital loop.

**MOAT-4 · Outcomes Dashboard With Public Methodology.** Publish a quarterly "Alfanumrik Learning Gains Report" with anonymised cohort data: mean pre/post test improvement, mastery velocity, top-decile vs. cohort. Cite NCERT alignment. This is the L3 proof layer; it is also a marketing artefact and a regulatory hedge.

---

## 5. Prioritized Backlog (P0 → P3)

P0 = ship before 30 June 2026 (academic year start). P1 = ship in Q3 2026 (June–Aug). P2 = Q4 2026 (Sep–Nov). P3 = 2027 H1. Every item references the file or migration it touches. No placeholder UUIDs anywhere.

### 5.1 P0 — Production Blockers (8 items)

| ID | Title | Touches | Owner role |
|---|---|---|---|
| P0-01 | Rebuild RAG index for Class 6 R3 + Class 9 + Class 11 NCF-SE 2023 | `rag_content_chunks` (atomic purge + reinsert), `concept_graph`, RAG ingest pipeline | Content Lead + ML Eng |
| P0-02 | Commit baseline schema to `supabase/migrations/00000000000000_initial_schema.sql` | `supabase db dump --schema-only` | Backend Lead |
| P0-03 | Fix IDOR in `ml-adaptation` — enforce `auth_user_id → students.id` | `supabase/functions/ml-adaptation/index.ts` | Backend Eng |
| P0-04 | Register Razorpay yearly plans + populate `subscription_plans.razorpay_plan_id` | Razorpay dashboard + 3 UPDATE statements | Payments Eng + Ops |
| P0-05 | Math-Verifier agent — sympy-based deterministic check for Foxy numeric steps | `foxy-tutor` (new sibling fn) + new utility lib | AI Eng |
| P0-06 | Streak Freeze mechanic — 1 freeze/week, surfaced in dashboard | `student_streaks` (+ `frozen_at`), `daily-cron`, dashboard | Full-stack |
| P0-07 | Demo-mode flag verified across student/parent/teacher onboarding | `feature_flags`, `/demo`, role bootstrap | QA + Frontend |
| P0-08 | Sentry release-tracking + commit SHA in `/super-admin/deploy` | `sentry.*.config.ts`, `/api/super-admin/deploy` | DevOps |

### 5.2 P1 — Q3 2026 (10 items)

| ID | Title | Touches |
|---|---|---|
| P1-01 | Parent Mastery Graph view (MOAT-1) | New `/parent/mastery` page + `/api/v1/child/[id]/mastery-graph` route |
| P1-02 | Phygital Worksheets — teacher print + scan + grade loop | `teacher/worksheets`, `scan-ocr`, `foxy-grader` edge fn |
| P1-03 | CORS allowlist on `ml-adaptation` and `rag-retrieval` (parity with `foxy-tutor`) | two Edge Functions |
| P1-04 | Two-level assessment model (Proficiency + Advanced) in `question_bank` | `question_bank` schema + `quiz-generator` selection logic |
| P1-05 | Weekly Leagues with promotion/demotion | `leaderboard`, `leagues` table, `daily-cron` |
| P1-06 | Customisable daily goal in dashboard | student profile + dashboard widget |
| P1-07 | Foxy refuses off-topic with curriculum-anchored deflection | `foxy-tutor` prompt + classifier |
| P1-08 | Hindi RAG coverage parity audit + backfill | `rag_content_chunks` (language column) + Voyage re-embed |
| P1-09 | Outcomes Dashboard for Super-Admin (cohort pre/post deltas) | `/super-admin/learning`, new RPC |
| P1-10 | Quarterly "Alfanumrik Learning Gains Report" generator | `export-report`, methodology doc |

### 5.3 P2 — Q4 2026 (8 items)

| ID | Title | Touches |
|---|---|---|
| P2-01 | Friend streaks + invite graph | new `friendships` table, `daily-cron`, notifications |
| P2-02 | Seasonal cohorts ("Board Exam Sprint Feb 2027") | `cohorts` table, `feature_flags` |
| P2-03 | Achievement badges expansion (50+ badges) | `badges` table, `xp-rules` |
| P2-04 | Foxy Voice mode (Hindi + English + Hinglish, low-data) | new edge fn + WebAudio + Anthropic streaming |
| P2-05 | CRAG (Corrective RAG) — retrieval-quality gate before LLM call | `rag-retrieval`, `foxy-tutor` |
| P2-06 | Teacher classroom mode — live quiz with question projection | `/teacher/live`, websockets via Supabase Realtime |
| P2-07 | White-label school onboarding self-service flow | `institutions` schema (live), admin UI |
| P2-08 | Per-school NCERT track for SSC / ICSE pilot (feature-flag gated) | `curriculum_topics` extension |

### 5.4 P3 — 2027 H1 (6 items)

| ID | Title | Touches |
|---|---|---|
| P3-01 | Deep KT (LSTM) replacing BKT for older students | `ml-adaptation` (new model), training pipeline |
| P3-02 | AI-as-subject elective track (Classes 8–10) — 2029 CBSE alignment | new subject in `curriculum_topics`, dedicated Foxy persona |
| P3-03 | Parent → school referral marketplace | `institutions`, `referrals` table |
| P3-04 | On-device retrieval (PWA + tiny embeddings) for offline mastery | `offlineStore`, service worker, Voyage tiny model |
| P3-05 | NDEAR-aligned data portability export | GDPR/DPDP export endpoint, JSON-LD schema |
| P3-06 | Multi-board federation (CBSE + SSC + ICSE + State boards) | `curriculum_topics` partitioning, RAG namespacing |

---

## 6. Feature Specifications — P0 & P1 Detail

Every spec below names the actual tables, columns, files, and routes touched. No placeholder UUIDs. All schema changes are additive and backward-compatible. RBAC required on every admin/teacher/parent route. Idempotency mandatory on every payment write. RAG-only on every curriculum surface.

### 6.1 P0-01 · NCERT NCF-SE 2023 RAG Re-Index

**Goal.** Replace legacy curriculum chunks with NCF-SE 2023-aligned content for Class 6 (R3, live now), Class 9 and Class 11 (new books for 2026-27). Classes 10 & 12 unchanged until 2027-28.

**Acceptance criteria.**
- `rag_content_chunks.is_active = TRUE` rows for Class 6/9/11 reference only NCF-SE 2023 chapters; legacy syllabus rows are archived (`is_active = FALSE`) with `reason = 'ncf_se_2023_replacement'`.
- `concept_graph` nodes for Class 9 reflect the new 3-part integrated structure; `prerequisite_codes` preserved for backward-compat where concept exists in both old and new.
- Foxy, Quiz, UI all read from the same `curriculum_topics` rows — chapter labels identical across the three surfaces (Blueprint Hard Rule 6).
- A pre-deploy script verifies that no chapter referenced by an active student's `study_plan` is broken by the re-index.
- All Voyage embeddings are regenerated with `voyage-large-2` for the new chunks (no mixed embedding generations).

**Implementation steps.**
1. Stage NCERT NCF-SE 2023 PDFs to a private Supabase Storage bucket `ncert-raw-2026-27/`.
2. Extract → chunk (semantic, 512 tokens) → tag (board, grade, subject, chapter_number, chapter_title, topic, concept, bloom_level, language).
3. Embed via Voyage; store in `rag_content_chunks` with `is_active = FALSE` initially.
4. Dual-read validation: run 100 sample student queries through both old and new indexes; capture deltas.
5. Atomic swap inside a transaction: archive old rows, activate new rows, refresh `match_rag_chunks` RPC stats.
6. Monitoring: `foxy-tutor` and `quiz-generator` log retrieval scores; alert if median similarity drops > 0.15 vs. baseline.

**Rollback.** Single-statement rollback: `UPDATE rag_content_chunks SET is_active = (chunk_set = 'legacy')`. Maintain dual index for 30 days.

### 6.2 P0-02 · Baseline Schema Versioning

**Goal.** Make `supabase/migrations/` the single source of truth so a fresh Supabase project can be reproduced from the repo alone. Closes DATABASE_AUDIT CRITICAL-1.

**Acceptance criteria.**
- `supabase/migrations/00000000000000_initial_schema.sql` contains `CREATE TABLE` for every table referenced in app code (students, quiz_sessions, quiz_responses, question_bank, adaptive_mastery, concept_graph, rag_content_chunks, subscriptions, feature_flags, guardian_student_links, profiles, audit_logs, student_learning_profiles, adaptive_profile, cognitive_session_metrics, chat_sessions, chat_messages, study_plan, leagues, badges, payments, payment_orders, ~40 total).
- CI job runs `supabase db reset` → `supabase migration up` → integration smoke test on every PR.
- Dump excludes data; only DDL and RLS policies are versioned.

**Steps.**
- `supabase db dump --schema-only --project-ref shktyoxqhundlvkiwguu > 00000000000000_initial_schema.sql`
- Manual review — remove migration-history insertions; verify all SECURITY DEFINER functions have `search_path` locked.
- Add CI step: spin a fresh Supabase branch, apply all migrations, run smoke test pack.

### 6.3 P0-03 · Fix IDOR In `ml-adaptation`

**Root cause.** `supabase/functions/ml-adaptation/index.ts` trusts `body.student_id`. RBAC only verifies caller role (student/teacher/admin), not identity. A student can post arbitrary `student_id` and read or mutate another student's `adaptive_mastery`.

**Fix.** After resolving caller via JWT, select `students.id where auth_user_id = caller.id`. If caller role is `student`, reject any `body.student_id != caller.students.id`. Teachers and admins keep cross-student access but must additionally be scoped to their school via `guardian_student_links` / `class_students` join.

**Acceptance criteria.**
- New test: authenticated student A POSTs `ml-adaptation` with `student_id = B` → 403 with code `FORBIDDEN_STUDENT_SCOPE`.
- Teacher with `class_id` linking student B can mutate; teacher without link → 403.
- Audit log row written for every cross-student mutation with `caller_role`, `target_student_id`, `payload_hash`.

### 6.4 P0-04 · Razorpay Yearly Plans

**Specification.**

| Tier | Monthly | Yearly (₹) | Effective monthly | Razorpay plan interval |
|---|---|---|---|---|
| Starter | ₹299 | ₹2,399 | ₹199.92 / mo | period=yearly, interval=1 |
| Pro | ₹699 | ₹5,599 | ₹466.58 / mo | period=yearly, interval=1 |
| Unlimited | ₹1,099 | ₹11,999 | ₹999.92 / mo | period=yearly, interval=1 |

**Acceptance criteria.**
- Razorpay dashboard contains all three yearly plans; IDs stored as `RAZORPAY_YEARLY_PLAN_STARTER` / `_PRO` / `_UNLIMITED` env vars.
- `subscription_plans.razorpay_plan_id` is populated for all three tiers; UI billing toggle works in both monthly and yearly modes.
- Webhook handler at `/api/payments/webhook` validates HMAC and updates subscriptions idempotently. No duplicate subscription rows on retry.
- No quota reset on deploy (Blueprint Hard Rule 9).

### 6.5 P0-05 · Math-Verifier For Foxy

**Architecture.** New Edge Function: `foxy-math-verifier`. Foxy emits a structured response containing `claimed_steps` (LaTeX or sympy-parseable). `foxy-math-verifier` evaluates each step deterministically: parse → evaluate → compare claimed result against verifier result within tolerance. Returns `{ok: bool, failed_step?: number, suggested_correction?: string}`. If verifier fails, `foxy-tutor` performs ONE retry with the verifier output as additional context. If the retry also fails, Foxy returns a calibrated uncertainty response ("I want to double-check this with you — can we work through step 3 again?").

**Acceptance criteria.**
- Verifier covers: arithmetic, algebra (linear + quadratic), Pythagoras, trigonometric values, basic calculus (derivatives + definite integrals).
- Test pack of 500 NCERT math problems shows ≥ 99% verifier accuracy on ground-truth steps.
- Latency budget: verifier adds < 250ms p95 to Foxy turn.
- If verifier disagrees, Foxy never silently emits the wrong answer — it either retries successfully or returns uncertainty.

### 6.6 P0-06 · Streak Freeze

**Specification.** A student earns 1 streak freeze per week (Mon 00:00 IST). Up to 2 may be banked. If a day passes without activity, `daily-cron` consumes one freeze rather than resetting the streak. Surfaced as a snowflake icon on dashboard with count.

**Schema.** `ALTER TABLE student_streaks ADD COLUMN freezes_available INT NOT NULL DEFAULT 0, ADD COLUMN freezes_used_total INT NOT NULL DEFAULT 0, ADD COLUMN last_freeze_grant_at TIMESTAMPTZ`. Backfill `freezes_available = 0` for existing rows (non-breaking).

**Acceptance criteria.**
- Friday-night QA: simulate a student missing Saturday → `daily-cron` Sun 03:00 IST consumes one freeze, streak preserved.
- Dashboard widget shows current freezes (0/1/2) with tooltip "Skip one day and keep your streak".
- XP cap: claiming a freeze does NOT pay `streak_daily`; only paid for actual activity.

### 6.7 P0-07 · Demo Mode Verified Across Roles

`feature_flags.demo_mode` (already exists) must gate (a) the `/demo` route, (b) seeded demo students/teachers/guardians (`is_demo` column, live as of migration 20260515000001), (c) marketing pages' "Try Now" CTA. Acceptance: an unauthenticated visitor on `/demo` can sample Foxy, Quiz, and a parent view without creating an account; demo data is never written to production student rows.

### 6.8 P0-08 · Sentry Release Tracking

Set `SENTRY_RELEASE = process.env.VERCEL_GIT_COMMIT_SHA` in all three Sentry configs. `/api/super-admin/deploy` must read latest release and surface in `/super-admin` Control Room. Verify source maps upload during build (`sentry-cli releases files`). Acceptance: an error in production resolves to the exact commit SHA in Sentry within 30s; rollback steps in `/super-admin/deploy` reference the previous SHA correctly.

### 6.9 P1-01 · Parent Mastery Graph (MOAT-1)

**UX.** New `/parent/[child_id]/mastery` page. Renders `concept_graph` as a force-directed graph (D3 or react-flow), nodes coloured by mastery level (red < 0.4 < amber < 0.7 < green), edges show `prerequisite_codes` relationships. A "Predicted exam-ready by" date is computed from learning velocity × remaining nodes × current mastery curve.

**API.** `GET /api/v1/child/[id]/mastery-graph?subject=...&grade=...` → `{nodes: [...], edges: [...], readiness_date: ISO, velocity: float, weak_prerequisites: [...]}`. RBAC: caller must be guardian linked to child OR admin.

**Acceptance criteria.**
- Loads under 1.2s p95 for a single subject (≤ 200 nodes).
- Identifies the top 3 weak prerequisites and links each to a Foxy session.
- No raw chapter content rendered — graph only shows concept names, mastery scores, and links.

### 6.10 P1-02 · Phygital Worksheet Loop (MOAT-3)

Teacher generates per-class worksheets from `/teacher/worksheets` — Foxy + `quiz-generator` emit a PDF tailored to mastery distribution of the class. Students complete on paper; teacher (or student) scans via `/scan`; `scan-ocr` extracts handwritten answers; `foxy-grader` (new fn) grades against the worksheet answer key with partial-credit reasoning. Results write to `quiz_responses` with `channel = 'phygital'`. Mastery updates downstream as normal.

This is the closed loop that competitors cannot copy in 90 days. It targets the same low-bandwidth tier-2/3 segment that PhysicsWallah is chasing with physical centres — but at a fraction of the CAPEX.

---

## 7. 90-Day Execution Roadmap

Calendar runs **18 May 2026 through 15 August 2026**. Each week names the items that must clip and the verification gate that prevents drift.

### 7.1 Sprints

| Sprint | Window | Theme | Ships |
|---|---|---|---|
| S1 | 18 May – 31 May | Production blockers | P0-02 (baseline schema), P0-03 (IDOR fix), P0-04 (yearly plans), P0-07 (demo mode), P0-08 (Sentry release) |
| S2 | 1 Jun – 14 Jun | Curriculum freshness | **P0-01** (RAG re-index Class 6 R3 + Class 9 + Class 11); cutover by 15 Jun. |
| S3 | 15 Jun – 28 Jun | AI quality + habit | P0-05 (math-verifier), P0-06 (streak freeze) |
| S4 | 29 Jun – 12 Jul | Parent + outcomes | P1-01 (Parent Mastery Graph), P1-06 (daily goals), P1-08 (Hindi parity audit) |
| S5 | 13 Jul – 26 Jul | Phygital + classroom | P1-02 (Phygital Worksheets), P1-05 (Weekly Leagues) |
| S6 | 27 Jul – 9 Aug | Hardening + report | P1-03 (CORS parity), P1-04 (Proficiency + Advanced), P1-07 (Foxy deflection), P1-09 (Super-Admin outcomes), P1-10 (Learning Gains Report v1) |
| Buffer | 10 Aug – 15 Aug | Stabilisation + retrospective | No new features — only regression fixes, performance tuning, on-call rotation training |

### 7.2 Verification Gates (every Friday 16:00 IST)

- Build green on `main` + tag.
- Vitest + Playwright pass on the items shipped that week.
- Sentry error rate ≤ baseline + 10%.
- Supabase advisor checks all PASS (security + performance).
- Foxy retrieval median similarity ≥ 0.78; `quiz-generator` failure rate ≤ 0.5%.
- Payment webhook idempotency proof — replay last 100 webhooks, expect zero duplicate writes.
- Compliance Report (Blueprint §7) attached to every PR merged that week.

### 7.3 Cutover For NCERT 2026-27

Hard deadline: **15 June 2026**. Cutover plan:

1. Freeze schema changes 12–14 Jun.
2. Run dual-read shadow at 50% traffic 1–7 Jun.
3. Atomic swap inside one transaction Sat 14 Jun 02:00 IST.
4. 30-day dual-index retention.
5. On-call escalation playbook in `/super-admin/diagnostics`.

Rollback triggered if median Foxy retrieval similarity drops by > 0.15 or if quiz first-question latency p95 > 2s.

---

## 8. Team Structure & Hiring Plan

To execute this docket on schedule, the engineering org should be staffed as below. Roles already filled stay. Open roles are flagged.

| Role | Headcount | Primary ownership | Status |
|---|---|---|---|
| Tech Lead / Architect | 1 | Blueprint enforcement, ADRs, code review | Filled |
| Backend Engineer (Supabase + Edge) | 2 | Migrations, Edge Functions, RBAC, payments | Filled (1) · Hiring (1) |
| Frontend Engineer (Next.js) | 2 | Student app, parent app, teacher app, super-admin UI | Filled (1) · Hiring (1) |
| AI / ML Engineer | 1 | Foxy prompts, math-verifier, RAG quality, BKT/IRT tuning | **CRITICAL HIRE** |
| Content & Curriculum Lead | 1 | NCERT alignment, RAG ingestion, concept_graph curation | **CRITICAL HIRE** |
| QA / SDET | 1 | Vitest, Playwright, regression suite, accessibility | Hiring |
| DevOps / SRE | 0.5 | Sentry, Vercel, Supabase ops, incident response | Filled (shared) |
| Product Designer | 1 | Student-first UX, parent UX, accessibility | Filled |
| Customer Success (parent + teacher) | 1 | Onboarding, support, feedback loop | Filled |

### 8.1 Cadence

- Daily standup 09:30 IST (15 min, no exceptions).
- Sprint planning Monday 11:00 IST (90 min).
- Sprint review + retrospective Friday 16:00 IST (60 min) — driven by the verification gates in §7.2.
- Architecture review every other Tuesday — any change touching the four canonical tables (`curriculum_topics`, `question_bank`, `student_learning_profiles`, `feature_flags`) is reviewed here, not in PR alone.
- On-call rotation weekly; primary + secondary; PagerDuty (or equivalent) wired to Sentry P1 alerts.

---

## 9. Risks, Compliance & Operational Readiness

### 9.1 Top Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NCERT 2026-27 not re-indexed by 15 Jun | HIGH | **CRITICAL — content trust collapse** | P0-01 with dedicated content engineer; 30-day dual index |
| IDOR exploited before fix lands | Low (small attack surface today) | **HIGH — privacy breach + DPDP notice** | P0-03 in S1; meanwhile rate-limit + log anomalies |
| Razorpay yearly conversion stalls | Medium | **HIGH — ARPU miss** | P0-04 + Razorpay account-manager check this week |
| Anthropic API outage / 529s | Medium (recurrent) | Medium — Foxy degrades | Existing circuit breaker (`foxy-tutor` v32) + fallback replies + queue retry |
| Curriculum drift (Foxy vs. Quiz vs. UI) | Medium | **HIGH — Blueprint Hard Rule 6 violation** | Single fetcher pattern; Compliance Report on every PR |
| Quota reset on deploy | Low | **HIGH — angry parents** | Blueprint Hard Rule 9; CI check on migration files |
| Sentry release misalignment | Medium | Medium — slow incident response | P0-08 |
| Voyage AI rate limit / cost spike | Low | Medium | Embed in batches, cache at chunk hash, off-peak ingestion |

### 9.2 DPDP Act 2023 Compliance Checklist

- Parental consent collected for minors at signup — store `consent_at` + `consent_method` (email/parent-link).
- Data minimisation — no behavioural ad tracking on student profiles (already enforced).
- Right to erasure — `/parent/profile` must support child-account deletion request, processed within 30 days.
- Cross-border transfers — Anthropic + Voyage are US-hosted; DPDP transfer mechanism documented (model contractual clauses).
- Breach notification — PagerDuty rule wired to security@cusiosense.com + DPO + CEO within 1 hour.
- Audit log retention — minimum 3 years for admin actions.

### 9.3 Observability Floor

- **Sentry** — frontend + Edge Functions + server actions; release SHA + user ID + correlation ID.
- **Vercel Analytics + Speed Insights** — core web vitals tracked per page; alert on p75 LCP > 2.5s for any high-traffic route.
- **PostHog** — funnel and retention for the student journey; cohort by grade and school.
- **Supabase logs** — Edge Functions ship structured logs with correlation ID; dashboard for foxy-tutor latency, error rate, retrieval similarity.
- `audit_logs` — every admin action; queryable via `/api/v1/admin/audit-logs` (already live).
- Daily 09:00 IST automated health report to CEO + tech lead — uptime, error rate, top 5 Sentry issues, payment success rate.

---

## 10. Definitions, Conventions & Source Index

### 10.1 Glossary

| Term | Definition |
|---|---|
| BKT | Bayesian Knowledge Tracing — probabilistic model that updates the chance a learner has mastered a concept after each response. |
| IRT 3PL | Item Response Theory, three-parameter logistic — models difficulty, discrimination, and guess rate per item; produces a calibrated ability score. |
| CAT | Computerised Adaptive Testing — item selection from an IRT-calibrated pool to maximise information at the learner's current ability. |
| CRAG | Corrective Retrieval-Augmented Generation — detects low-quality retrieval and re-routes before the LLM generates. |
| CME | Concept Mastery Engine — Alfanumrik's daily/weekly compute that re-projects mastery, weak prerequisites, and study-plan tasks. |
| Foxy | Alfanumrik's AI tutor persona — the conversational front-end to Anthropic + RAG. |
| NCF-SE 2023 | National Curriculum Framework for School Education 2023 — basis for the 2026-27 NCERT textbook update. |
| NEP 2020 | National Education Policy 2020 — the meta-policy NCF-SE 2023 implements. |
| NDEAR | National Digital Education Architecture — federation, open standards, multilingual, privacy-by-design principles Alfanumrik aligns to. |
| DPDP Act 2023 | Digital Personal Data Protection Act 2023 — India's GDPR-equivalent; governs minors' data and consent. |
| Phygital | Physical + digital — print worksheets, scan back into the digital loop. Targets low-connectivity classrooms. |
| RAG | Retrieval-Augmented Generation — the LLM is grounded in retrieved chunks rather than free-form generation. |
| Voyage | Voyage AI embedding model (voyage-large-2) used to embed RAG chunks and queries. |
| ZPD | Zone of Proximal Development — items at the boundary of current ability; where learning is fastest. |

### 10.2 Source Index (External Research)

- NCERT NCF-SE 2023 — Class 9 & 11 update for 2026-27 academic year: [sunbeamworldschool.com — CBSE New Curriculum 2026–27](https://sunbeamworldschool.com/blog/cbse-new-curriculum-2026-27/)
- PhysicsWallah IPO Nov 2025 (₹3,480 Cr) + K-12 push: [inc42.com — Why PhysicsWallah Is Going Back To School](https://inc42.com/features/why-physicswallah-is-going-back-to-school/)
- Byju's insolvency, $1.07B court order: [TFN — Byju's valuation down 99%](https://techfundingnews.com/byjus-valuation-down-99-indias-edtech-decacorn-seeking-200m-at-225m-valuation-what-exactly-happened/)
- India edtech market USD 3.63B → 33.31B by 2034: [imarcgroup.com — India edtech market](https://www.imarcgroup.com/india-edtech-market)
- Khan Academy Khanmigo — 40k → 700k students, math-verifier agent: [blog.khanacademy.org — Building a Better AI Tutor](https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/)
- Squirrel AI 30,000+ knowledge atoms + IRT/CAT/BKT: [syncedreview.com — Squirrel AI funding & architecture](https://medium.com/syncedreview/adaptive-learning-startup-squirrel-ai-raises-cn-1b-df275cbce068)
- DreamBox — Harvard study, 60% above-expected math gains: [navgood.com — AI adaptive platforms](https://www.navgood.com/en/article-details/ai-adaptive-learning-platforms-c0bdf)
- Duolingo streak freeze +48% retention past day 7, 128M MAU: [trophy.so — Duolingo Gamification Case Study 2026](https://trophy.so/blog/duolingo-gamification-case-study)
- RAG / CRAG / 84% of production AI assistants use RAG: [medium.com — RAG architectures 2026](https://medium.com/@angelosorte1/rag-architectures-every-ai-developer-must-know-in-2026-a-complete-guide-with-examples-ea59471aeb01)
- Vedantu hybrid + Embibe / Doubtnut / Toppr landscape: [india-briefing.com — Indian EdTech profile](https://www.india-briefing.com/news/profiling-indian-edtech-industry-us-10-billion-dollar-opportunity-24013.html/)
- Brilliant.org 2026 features + retention: [skillscouter.com — Brilliant review 2026](https://skillscouter.com/brilliant-review-math-science-coding/)

### 10.3 Blueprint Compliance Report

**Scope:** Strategic docket only — no code or schema changed by issuing this document. Scope of WORK described inside touches: `rag_content_chunks`, `concept_graph`, `supabase/migrations`, `supabase/functions/ml-adaptation`, `src/modules/payments`, `foxy-tutor`, `student_streaks`, `subscription_plans`, `audit_logs`.

- **Hard rules: PASS** — all 12 hard rules are reflected in the §1.3 operating principles, §5 backlog, and §6 specs. NCERT-only via RAG (Rule 5) is the dominant theme of P0-01. No placeholders used.
- **Backward compat: PASS** — all schema deltas in §6 are additive (`ALTER TABLE ADD COLUMN` with safe defaults; archive via `is_active` flag rather than DROP).
- **RBAC / auth: PASS** — every new admin/teacher/parent route is gated by `authorizeRequest`; cross-student access in `ml-adaptation` is hardened (P0-03).
- **RAG / NCERT integrity: PASS** — P0-01 atomic re-index with 30-day dual retention; chapter taxonomy single-sourced from `curriculum_topics` across Foxy + Quiz + UI (Rule 6).
- **Schema integrity: PASS** — canonical four tables (`curriculum_topics`, `question_bank`, `student_learning_profiles`, `feature_flags`) only receive additive changes; baseline schema is itself versioned in P0-02.
- **Production impact:** NONE for this document. Production impact of executed P0/P1 work is described per-item in §6 with explicit rollback paths.
- **Open questions:**
  - Final NCERT 2026-27 PDF availability for Class 9 & 11 — confirm with Content Lead by 25 May.
  - Razorpay account-manager confirmation that yearly plan registration goes live in T+3 business days.
  - AI/ML hiring timeline — required for P0-05 math-verifier; CEO to approve role open by 22 May.

---

*Document version 1.0 · 16 May 2026 · Cusiosense Learning India Pvt. Ltd. · Confidential*
