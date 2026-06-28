# Feature Inventory — Student

Target users: CBSE students, grades 6–12 (grades are **strings** "6"–"12", P5).
Routes confirmed under `src/app/` on 2026-06-28. DB tables / APIs are best-effort —
**to be verified per cycle** during MAP.

---

### Dashboard
- **Business purpose:** student home; surfaces daily rhythm queue, streaks, XP/level, next actions.
- **Key files:** `src/app/dashboard/page.tsx`, `src/components/dashboard/sections/DailyRhythmQueue.tsx`.
- **DB tables (best-effort):** `students`, `student_learning_profiles`, `quiz_sessions`.
- **APIs:** `/api/rhythm/today`, `/api/student/*`.
- **Status:** partial — verify empty-state (new user, zero history) and XP/level display vs P2.
- **Known gaps:** empty/first-run state and offline behavior to verify.

### Learn (chapter learning)
- **Business purpose:** structured chapter learning via Pedagogy v2 content rules.
- **Key files:** `src/app/learn/page.tsx`, `src/app/learn/[subject]/[chapter]/page.tsx`, `src/lib/learn/`.
- **DB tables (best-effort):** `chapters`, `topics`, `student_lesson_progress`.
- **APIs:** `/api/learn/remediation`, `/api/learner/lesson/progress`.
- **Status:** partial — bilingual (P7) parity and progress persistence to verify.
- **Known gaps:** content-gap coverage; remediation wiring (Eedi pattern) depth.

### Quiz (core assessment)
- **Business purpose:** adaptive quiz; the platform's primary assessment loop.
- **Key files:** `src/app/quiz/page.tsx`, `src/app/quiz/ncert/page.tsx`, `src/components/quiz/`.
- **DB tables (best-effort):** `question_bank`, `quiz_sessions`, `quiz_responses`, `quiz_session_shuffles`.
- **APIs:** `/api/quiz/submit`.
- **Status:** partial — high-invariant surface (P1 score, P2 XP, P3 anti-cheat, P4 atomic, P6 quality).
- **Known gaps:** must confirm score formula parity across client/server/RPC; anti-cheat both sides.

### Progress
- **Business purpose:** mastery, Bloom's distribution, XP velocity, score trends over time.
- **Key files:** `src/app/progress/page.tsx`.
- **DB tables (best-effort):** `student_learning_profiles`, `quiz_sessions`.
- **APIs:** progress/analytics read endpoints (to verify).
- **Status:** partial — learner-metric definitions need assessment sign-off.
- **Known gaps:** metric definitions vs assessment-owned KPIs; empty-history state.

### Foxy (AI tutor)
- **Business purpose:** NCERT-grounded AI tutor (modes: learn/explain/practice/revise/doubt/homework/explorer).
- **Key files:** `src/app/foxy/page.tsx`, `src/app/api/foxy/route.ts`, `supabase/functions/foxy-tutor/`.
- **DB tables (best-effort):** `chat_sessions`, `chat_messages`, RAG/`pgvector` stores.
- **APIs:** `/api/foxy`, `/api/foxy/feedback`, `/api/foxy/remediation`.
- **Status:** partial — P12 safety, daily limits, single-retrieval contract to verify.
- **Known gaps:** Next.js route vs Edge Function cutover state; PII-to-LLM boundary.

### Exams (mock exams)
- **Business purpose:** timed mock exams / PYQ practice with results.
- **Key files:** `src/app/exams/page.tsx`, `src/app/exams/mock/page.tsx`, `src/app/exams/mock/[paperId]/page.tsx`, `.../results/page.tsx`, `src/lib/exam-engine.ts`.
- **DB tables (best-effort):** `exam_papers`, exam attempt tables.
- **APIs:** `/api/exams/papers`, `/api/exams/papers/[id]`, `/api/exams/papers/[id]/submit`.
- **Status:** partial — exam timing presets and submit atomicity to verify.
- **Known gaps:** results empty-state; scoring parity with quiz core.

### Leaderboard
- **Business purpose:** gamified ranking to drive engagement.
- **Key files:** `src/app/leaderboard/page.tsx`.
- **DB tables (best-effort):** `students` (xp/level), leaderboard aggregates.
- **APIs:** leaderboard read endpoint (to verify).
- **Status:** partial — privacy (P13) of names/identifiers in ranking to verify.
- **Known gaps:** PII exposure in public ranking; tie-break determinism.

### Dive (weekly Curiosity Dive — Pedagogy v2 Wave 2)
- **Business purpose:** weekly deep-dive curiosity artifact + streak.
- **Key files:** `src/app/dive/page.tsx`, `src/app/dive/history/page.tsx`, `src/components/dive/`, `src/lib/learn/weekly-dive-orchestrator.ts`.
- **DB tables (best-effort):** dive artifact + weekly-streak tables.
- **APIs:** `/api/dive/state`, `/api/dive/start`, `/api/dive/artifact`, `/api/dive/history`.
- **Status:** partial — streak edge cases and history empty-state to verify.
- **Known gaps:** generation failure fallback.

### Synthesis (monthly Synthesis — Pedagogy v2 Wave 3)
- **Business purpose:** monthly synthesis summary; parent-shareable.
- **Key files:** `src/app/synthesis/page.tsx`, `src/components/synthesis/`, `src/lib/learn/monthly-synthesis-orchestrator.ts`.
- **DB tables (best-effort):** synthesis snapshot tables.
- **APIs:** `/api/synthesis/state`, `/api/synthesis/parent-share`.
- **Status:** partial — Edge Function builder (`monthly-synthesis-builder`) + cron trigger to verify.
- **Known gaps:** parent-share privacy boundary (P13); empty month.

### Simulations
- **Business purpose:** interactive concept simulations.
- **Key files:** `src/app/simulations/page.tsx`.
- **DB tables (best-effort):** n/a / static content (to verify).
- **APIs:** to verify.
- **Status:** stub/partial — depth and device performance unverified.
- **Known gaps:** bundle/perf (P10) on low-end devices; bilingual labels.

### Adjacent student surfaces (to verify)
- `practice/`, `revision/`, `scan/` (OCR scan-solve), `lab-notebook/[studentId]/`,
  `exam-prep/`, `exam-briefing/`, `mock-exam/`, `pyq/`, `tutor/`, `welcome/`.
- **Status:** to verify — confirm ownership, overlap with core, and live vs legacy.
