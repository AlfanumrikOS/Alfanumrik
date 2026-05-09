# Pedagogy v2 — Wave 3 (Monthly Synthesis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third and final layer of the Three-Speed Learning Rhythm — a monthly Synthesis milestone that auto-aggregates the past month's mastery + weekly artifacts into a parent-shareable bundle, delivered via WhatsApp with explicit parent opt-in.

**Architecture:** A scheduled server-side bundle generator (Edge Function `monthly-synthesis-builder`, called by daily cron on the first day of each calendar month) writes one `monthly_synthesis_runs` row per (student, month). The row aggregates: chapter mock, retention check, HPC delta, the four weekly dive artifacts, and a Claude Haiku-generated bilingual one-page summary (~300 words EN + HI). A new `/synthesis` route renders the milestone as a small ritual surface for the student. WhatsApp delivery to the linked guardian goes through the existing `whatsapp-notify` Edge Function and requires explicit parent opt-in (`guardians.monthly_synthesis_optin = TRUE`).

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, Supabase Edge Functions (Deno), Claude Haiku via existing `src/lib/ai/`, daily-cron Edge Function (already exists), `whatsapp-notify` Edge Function (already exists per CLAUDE.md). Path alias `@/*` → `./src/*`.

**Spec:** [docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md](../specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md) §5.3 + §11.

**Predecessor plans:**
- [2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md](2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md) — Wave 1A merged.
- [2026-05-09-pedagogy-v2-wave-1b-rhythm-data-and-surface.md](2026-05-09-pedagogy-v2-wave-1b-rhythm-data-and-surface.md) — Wave 1B merged.
- [2026-05-09-pedagogy-v2-wave-2-weekly-dive.md](2026-05-09-pedagogy-v2-wave-2-weekly-dive.md) — Wave 2 fully shipped (Tasks 1-7 across 6 PRs).

**Working tree:** `C:\Users\Bharangpur Primary\Alfanumrik\.claude\worktrees\pedagogy-v2-wave-3-monthly-synthesis\` on branch `pedagogy-v2-wave-3-monthly-synthesis`.

**Pre-flight:** Run `npm install` once before any task that runs vitest/tsc/eslint. Wave 3 is the smallest of the three waves — solo-developer-week shaped, ~2 weeks total.

**Build size:** ~2 solo-developer weeks across nine bite-sized tasks.

**Invariants respected:** P2 (no XP-rule changes), P5 (grades as strings), P6/P7 (bilingual + CSP), P10 (bundle), P11 (Haiku-generated parent-share is grounded by the bundle's mastery+artifact data, never fabricated; section-level oracle check), P13 (no PII in synthesis text — student name + grade only, no email/phone/school).

**Out of scope for this wave:** depth-pack RAG corpus extension (separate plan), persona-aware productive-failure on `/learn/[chapter]` (Wave 1C), v2-quiz-path distractor explainer (Wave 1C), embedded Foxy chat inside `/dive` (Wave 2 v2), additional phenomenon catalog seeds (content team work).

---

## Pre-flight audit (must complete before Task 2)

The implementer MUST resolve these five questions against canonical SQL/code BEFORE writing Task 2's orchestrator. Same pattern as Wave 1B's A1-A5 and Wave 2's B1-B5. Document the resolved answers at the top of `monthly-synthesis-orchestrator.ts`.

- [ ] **C1. Guardian table + opt-in storage.** Find the `guardians` table (or whatever links a parent to a student). Confirm whether it has `auth_user_id`, `email_for_parent_notifs`, and any existing opt-in columns. The migration in Task 1 adds `monthly_synthesis_optin` BOOLEAN; verify this is the right table to extend.
      ```bash
      grep -E "CREATE TABLE.*guardian|guardian_student_links" supabase/migrations/00000000000000_baseline_from_prod.sql | head -5
      ```

- [ ] **C2. WhatsApp Edge Function contract.** Read `supabase/functions/whatsapp-notify/index.ts` (per CLAUDE.md it exists). Confirm: input shape, auth (probably service-role JWT), language toggle (it should accept `en`/`hi`), template support. The Task 6 wiring depends on this contract being stable.

- [ ] **C3. Daily-cron entry point.** Per CLAUDE.md, `supabase/functions/daily-cron/index.ts` exists. Confirm it has a list-of-actions-this-cron-runs registry and a way to add the new monthly-synthesis trigger (probably a `case` statement on `action` query param, or an array of action handlers).

- [ ] **C4. Chapter-mock generation entry point.** The synthesis bundle includes a chapter mock spanning chapters touched in the past month. The existing `quiz-generator-v2` Edge Function or `exam-engine.ts` is likely the right caller. Find which one accepts `{ student_id, chapter_numbers[], target_difficulty }` and returns a structured exam payload.

- [ ] **C5. HPC delta generator.** Wave 1A's `/hpc` surface exists. There is likely a server-side function that produces the HPC payload from `students.id` + a date range. Find it (`generate_hpc_payload` or similar RPC). The synthesis bundle reuses its output directly — Task 2's orchestrator does NOT recompute mastery deltas from scratch.

If any C1-C5 cannot be answered from canonical, **stop and escalate**.

---

## File structure

### Created (new)

| Path | Responsibility | Type |
|---|---|---|
| `supabase/migrations/<ts>_pedagogy_v2_wave_3_monthly_synthesis.sql` | `monthly_synthesis_runs` table (one row per student-month with bundle JSONB + parent-share status), `guardians.monthly_synthesis_optin` BOOLEAN, `ff_pedagogy_v2_monthly_synthesis` flag | Migration |
| `src/lib/learn/monthly-synthesis-orchestrator.ts` | Pure function: given (student profile, month boundaries, weekly artifacts, mastery deltas, chapter mock summary), emit a structured bundle | Module |
| `src/lib/__tests__/monthly-synthesis-orchestrator.test.ts` | Unit tests | Vitest |
| `src/lib/ai/workflows/synthesis-summary.ts` | Claude Haiku workflow that takes a synthesis bundle and produces a one-page bilingual parent-share text | Module |
| `src/lib/__tests__/synthesis-summary-prompt.test.ts` | Unit tests for prompt assembly (no LLM calls in unit tests) | Vitest |
| `supabase/functions/monthly-synthesis-builder/index.ts` | Edge Function that does the heavy lifting: read profile, fetch artifacts, call HPC RPC, call quiz-generator for chapter mock, run summary workflow, write `monthly_synthesis_runs` row | Edge Function |
| `supabase/functions/monthly-synthesis-builder/deno.json` | Deno config | Edge Function |
| `src/app/api/synthesis/state/route.ts` | GET — returns the latest synthesis row for the authenticated student | Route |
| `src/app/api/synthesis/parent-share/route.ts` | POST — triggers WhatsApp delivery to the student's linked guardian (gated by guardian opt-in) | Route |
| `src/app/synthesis/page.tsx` | Synthesis ritual surface for the student | Page |
| `src/app/synthesis/loading.tsx`, `error.tsx` | Boilerplate | Page boilerplate |
| `src/components/synthesis/SynthesisRitual.tsx` | The "month complete" ritual UI | Client component |
| `src/components/synthesis/ParentShareCard.tsx` | Parent-share toggle + WhatsApp delivery CTA | Client component |
| `e2e/monthly-synthesis.spec.ts` | Playwright smoke | E2E |

### Modified

| Path | Change |
|---|---|
| `src/lib/feature-flags.ts` | Add `MONTHLY_SYNTHESIS` to `PEDAGOGY_V2_FLAGS` registry + `FLAG_DEFAULTS` entry |
| `supabase/functions/daily-cron/index.ts` | Register a new action `monthly_synthesis_trigger` that runs on the 1st of each month and enqueues `monthly-synthesis-builder` per active student |
| `src/components/dashboard/sections/DailyRhythmQueue.tsx` (Wave 1B/2) | Insert a "This month's synthesis" badge when the latest synthesis run completed within the past 7 days |
| `src/app/hpc/page.tsx` (Wave 1A's HPC surface) | Add a "Latest monthly synthesis" link + delta chip |

### Not modified (deliberately)

- `src/lib/cognitive-engine.ts` — engines are reused, not changed.
- `src/lib/xp-config.ts` — no new XP constants.
- `src/lib/learn/{daily-rhythm,weekly-dive}-orchestrator.ts` — daily and weekly layers unchanged.
- The existing `whatsapp-notify` Edge Function — used as-is via its existing contract.

---

## Task 1 — Migration: `monthly_synthesis_runs` + guardian opt-in + flag

**Why first:** Schema foundation. Idempotent, additive.

**Files:** new migration file with timestamp greater than the latest existing migration.

- [ ] **Step 1: Find the latest migration timestamp.**
      ```bash
      ls supabase/migrations | grep -v _legacy | sort | tail -1
      ```
      Pick the next minute as your new timestamp.

- [ ] **Step 2: Write the migration.**

```sql
-- Migration: <NOW>_pedagogy_v2_wave_3_monthly_synthesis.sql
-- Purpose: Schema for Pedagogy v2 Wave 3 (Monthly Synthesis).
--
--   1. monthly_synthesis_runs — one row per (student, month). Holds the
--      structured bundle (mastery delta JSONB, weekly artifact ids[],
--      chapter-mock summary JSONB, parent-share text EN+HI) and tracks
--      WhatsApp delivery state.
--
--   2. guardians.monthly_synthesis_optin — BOOLEAN, default FALSE.
--      Parent-share to WhatsApp is gated by this column. C1 audit
--      confirms guardians is the right table.
--
--   3. Feature flag ff_pedagogy_v2_monthly_synthesis (OFF).
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS monthly_synthesis_runs (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                  UUID         NOT NULL,
  synthesis_month             TEXT         NOT NULL,    -- 'YYYY-MM' format
  bundle                      JSONB        NOT NULL,    -- mastery delta, artifact ids, chapter-mock summary
  summary_text_en             TEXT         NOT NULL,
  summary_text_hi             TEXT         NOT NULL,
  parent_share_status         TEXT         NOT NULL DEFAULT 'pending'
    CHECK (parent_share_status IN ('pending','sent','opted_out','failed','suppressed')),
  parent_share_sent_at        TIMESTAMPTZ,
  parent_share_whatsapp_id    TEXT,                     -- delivery receipt if available
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (student_id, synthesis_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_synthesis_student_month
  ON monthly_synthesis_runs (student_id, synthesis_month DESC);

ALTER TABLE monthly_synthesis_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "monthly_synthesis_self_select" ON monthly_synthesis_runs
    FOR SELECT TO authenticated
    USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "monthly_synthesis_service_all" ON monthly_synthesis_runs
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Guardian opt-in (C1: verify the column lands on the right table).
DO $$ BEGIN
  ALTER TABLE guardians ADD COLUMN monthly_synthesis_optin BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Feature flag.
INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_pedagogy_v2_monthly_synthesis', false, ARRAY['student']::text[], NULL, NULL, NULL)
ON CONFLICT (flag_name) DO NOTHING;

COMMIT;
```

- [ ] **Step 3: Add `MONTHLY_SYNTHESIS` to the feature-flags registry.** Edit `src/lib/feature-flags.ts`:
      ```typescript
      export const PEDAGOGY_V2_FLAGS = {
        PRODUCTIVE_FAILURE_V1:        'ff_productive_failure_v1',
        DISTRACTOR_MICRO_EXPLAINER_V1: 'ff_distractor_micro_explainer_v1',
        DAILY_RHYTHM:                 'ff_pedagogy_v2_daily_rhythm',
        WEEKLY_DIVE:                  'ff_pedagogy_v2_weekly_dive',
        MONTHLY_SYNTHESIS:            'ff_pedagogy_v2_monthly_synthesis',
      } as const;
      ```
      And `FLAG_DEFAULTS`: `[PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS]: false`.

- [ ] **Step 4: Type-check.** `npm run type-check` → 0 errors (other than pre-existing sentry baseline noise).

- [ ] **Step 5: Commit.**

---

## Task 2 — `monthly-synthesis-orchestrator.ts` (TDD)

**Why:** Pure-function bundle composer. Same architectural pattern as Wave 1A's `daily-rhythm-orchestrator` and Wave 2's `weekly-dive-orchestrator`.

**Files:** `src/lib/learn/monthly-synthesis-orchestrator.ts` + test file.

- [ ] **Step 1: Write tests for `composeSynthesisBundle({ studentProfile, monthBoundaries, weeklyArtifacts, masteryDelta, chapterMockSummary }) → SynthesisBundle`.**
      Cases:
      - Bundle includes the four weekly artifact ids.
      - Mastery delta is a structured `{ chaptersTouched[], topicsMastered: number, topicsImproved: number, topicsRegressed: number }`.
      - Chapter mock summary includes `chapters[]`, `total_questions`, `target_difficulty`.
      - `monthLabel` is ISO `'YYYY-MM'`.
      - Empty input (no artifacts in the month) returns a bundle with empty `weeklyArtifactIds[]` and `masteryDelta.topicsImproved === 0`.

- [ ] **Step 2: Implement.**

      ```typescript
      export interface MonthBoundaries {
        startIso: string;   // first day of the month, UTC
        endIso: string;     // first day of the next month, exclusive
        monthLabel: string; // 'YYYY-MM'
      }

      export interface SynthesisBundle {
        monthLabel: string;
        weeklyArtifactIds: string[];
        masteryDelta: {
          chaptersTouched: string[];
          topicsMastered: number;
          topicsImproved: number;
          topicsRegressed: number;
        };
        chapterMockSummary: {
          chapters: string[];
          totalQuestions: number;
          targetDifficulty: number;
        } | null;
      }

      export function composeSynthesisBundle(input: {
        monthBoundaries: MonthBoundaries;
        weeklyArtifactIds: string[];
        masteryDelta: SynthesisBundle['masteryDelta'];
        chapterMockSummary: SynthesisBundle['chapterMockSummary'];
      }): SynthesisBundle { /* ... */ }

      export function monthBoundariesOf(date: Date): MonthBoundaries { /* ... */ }
      ```

- [ ] **Step 3: Tests green. Commit.**

---

## Task 3 — `synthesis-summary.ts` Claude Haiku workflow (TDD on prompt assembly)

**Why:** The parent-share text is generated by Claude Haiku from the structured bundle. Prompt assembly is unit-testable; the LLM call itself is mocked in tests.

**Files:** `src/lib/ai/workflows/synthesis-summary.ts` + test file.

- [ ] **Step 1: Define the prompt-builder contract.**
      ```typescript
      export interface SynthesisSummaryParams {
        studentName: string;
        studentGrade: string;
        bundle: SynthesisBundle;
        language: 'en' | 'hi' | 'both';
      }

      export function buildSynthesisSummaryPrompt(params: SynthesisSummaryParams): string;
      ```

- [ ] **Step 2: Tests for prompt assembly:**
      - Includes student name + grade (P5 string).
      - Includes month label.
      - Includes mastery-delta numbers verbatim (P11: no fabrication; the LLM gets the actual numbers).
      - For `language: 'both'`, prompts the model to output BOTH `EN:` and `HI:` sections.
      - For `language: 'en'`, only EN.
      - Excludes any PII other than student name + grade (no email, phone, school).
      - Cap output at ~300 words (instruction in the prompt).

- [ ] **Step 3: Implement the prompt builder + a thin caller `runSynthesisSummary(params, claudeClient)` that returns `{ textEn, textHi }`.**

- [ ] **Step 4: Commit.**

---

## Task 4 — Edge Function `monthly-synthesis-builder`

**Why:** The heavy lifting runs server-side: load student profile, fetch the month's `dive_artifacts`, call HPC RPC for mastery delta, call quiz-generator for chapter mock, run the summary workflow, write `monthly_synthesis_runs`. Edge Function keeps the work off the user-facing request path.

**Files:** `supabase/functions/monthly-synthesis-builder/index.ts` + `deno.json`.

- [ ] **Step 1: Edge Function shape.**
      Trigger: POST with `{ student_id, synthesis_month: 'YYYY-MM' }` (called by daily-cron in Task 7).
      Idempotent: `INSERT ... ON CONFLICT (student_id, synthesis_month) DO NOTHING` returning the existing row when the bundle already exists.

- [ ] **Step 2: Per-step responsibilities (verify against C2-C5 audit findings before writing code):**
      1. Load `students.{id, name, grade, academic_goal}` (P13: only these fields, no email/phone).
      2. Compute month boundaries via `monthBoundariesOf` (Task 2).
      3. Fetch the month's `dive_artifacts` (Wave 2): `SELECT id FROM dive_artifacts WHERE student_id = $1 AND created_at >= $start AND created_at < $end ORDER BY iso_week`.
      4. Call HPC RPC (per C5 audit) to get the mastery delta.
      5. Call quiz-generator-v2 / exam-engine (per C4) to get the chapter-mock summary (do NOT actually run the mock — just generate the structured summary the student would face).
      6. Call `composeSynthesisBundle` (Task 2).
      7. Call `runSynthesisSummary` (Task 3) with `language: 'both'` → `{ textEn, textHi }`.
      8. Insert `monthly_synthesis_runs` row.

- [ ] **Step 3: Local serve test.**
      ```bash
      supabase functions serve monthly-synthesis-builder --env-file .env.local
      curl -X POST http://localhost:54321/functions/v1/monthly-synthesis-builder \
        -H "Authorization: Bearer <service-role-jwt>" \
        -H "Content-Type: application/json" \
        -d '{"student_id":"<test-uuid>","synthesis_month":"2026-04"}'
      ```
      Expected: 200 with the inserted row id, OR 200 with `{ already_exists: true }` on a re-run.

- [ ] **Step 4: Commit.**

---

## Task 5 — `/synthesis` page + components

**Files:** `src/app/synthesis/page.tsx`, `loading.tsx`, `error.tsx`, `src/components/synthesis/SynthesisRitual.tsx`, `src/components/synthesis/ParentShareCard.tsx`, `src/app/api/synthesis/state/route.ts`.

- [ ] **Step 1: `/api/synthesis/state` route.** Server-gated by `MONTHLY_SYNTHESIS`. Returns the most recent `monthly_synthesis_runs` row for the authenticated student, or `{ state: 'no_synthesis_yet' }` if none exists.

- [ ] **Step 2: `/synthesis` page** — client component, fetches `/api/synthesis/state`, renders three phases:
      - `loading` → skeleton.
      - `flag_off` → soft fallback.
      - `no_synthesis_yet` → friendly "Your first synthesis lands at the end of this month" message.
      - `ready` → `<SynthesisRitual/>` + `<ParentShareCard/>`.

- [ ] **Step 3: `<SynthesisRitual/>`** — bilingual ritual UI: month label, mastery-delta tiles, weekly-artifact mini-cards, chapter-mock summary tile, the bilingual parent-share preview text.

- [ ] **Step 4: `<ParentShareCard/>`** — toggle the parent's `monthly_synthesis_optin` (calls a small PATCH route), plus a "Send via WhatsApp" CTA when opt-in is true (calls Task 6's POST).

- [ ] **Step 5: Type-check + commit.**

---

## Task 6 — `/api/synthesis/parent-share` route + WhatsApp delivery

**Files:** `src/app/api/synthesis/parent-share/route.ts`.

- [ ] **Step 1: POST handler.** Body: `{ synthesisRunId: string }`. Steps:
      1. Auth check + flag check.
      2. Load the `monthly_synthesis_runs` row; verify `student_id` matches the authenticated user.
      3. Find the linked guardian via `guardian_student_links` (per C1 audit).
      4. Verify `guardians.monthly_synthesis_optin = TRUE`. If not, return 403 with `{ error: 'guardian_opted_out' }` and update synthesis row status to `'opted_out'`.
      5. Compose the WhatsApp message via the existing `whatsapp-notify` contract (per C2 audit). Pass both `summary_text_en` and `summary_text_hi`; the delivery function picks based on guardian's `preferred_language`.
      6. On success: update synthesis row `parent_share_status = 'sent'`, `parent_share_sent_at = now()`, `parent_share_whatsapp_id = <delivery_id>`. Return 200.
      7. On failure: update status to `'failed'` with the error reason in a log line. Return 502.

- [ ] **Step 2: Test the route locally with a staging guardian opted in.**

- [ ] **Step 3: Commit.**

---

## Task 7 — Daily-cron registration

**Files:** `supabase/functions/daily-cron/index.ts` (modified).

- [ ] **Step 1: Register the monthly-synthesis-trigger action.** Per C3 audit, find the action registry and add a new entry that runs on the 1st of each calendar month: enumerate active students with `ff_pedagogy_v2_monthly_synthesis` evaluated to TRUE, and POST to `monthly-synthesis-builder` per student with `synthesis_month` = previous calendar month.

- [ ] **Step 2: Smoke test by passing `--cron-action=monthly_synthesis_trigger` to a manual run.**

- [ ] **Step 3: Commit.**

---

## Task 8 — Dashboard CTA + HPC integration

**Files:** modify `src/components/dashboard/sections/DailyRhythmQueue.tsx` and `src/app/hpc/page.tsx`.

- [ ] **Step 1: Dashboard.** Add a "This month's synthesis" CTA list item that renders when `/api/synthesis/state` returns a synthesis row whose `created_at` is within the past 7 days. Clicking links to `/synthesis`.

- [ ] **Step 2: HPC.** Add a "Latest monthly synthesis" chip to the existing HPC surface that links to `/synthesis` and shows the month label.

- [ ] **Step 3: Type-check, lint, commit.**

---

## Task 9 — E2E Playwright smoke

**Files:** `e2e/monthly-synthesis.spec.ts`.

Three tests:
1. With a seeded `monthly_synthesis_runs` row for the test student, `/synthesis` renders the ritual with mastery-delta tiles + parent-share card.
2. Toggling parent opt-in updates the database and the UI flips the WhatsApp CTA from disabled to enabled.
3. Triggering the parent-share CTA (with opt-in=TRUE) updates `parent_share_status` to `'sent'`.

Pre-conditions documented in the spec header (test student, test guardian, seeded synthesis row, both flags enabled).

- [ ] **Step 1: Write the spec.** Run it. Fix until green.
- [ ] **Step 2: Commit.**

---

## Self-review

**1. Spec coverage:**
- §5.3 chapter mock + retention check + HPC update + artifact compilation + parent-share → all in Task 4 (Edge Function does the heavy lifting; bundle composition is in Task 2).
- §5.3 WhatsApp parent-share → Task 6 wires through the existing `whatsapp-notify` contract.
- §5.3 ritual surface → Task 5 (`/synthesis` page).
- §5.3 monthly cadence → Task 7 (daily-cron registration on the 1st).
- §11 success metrics: parent-share opt-in ≥50% → instrumentation is implicit in the `monthly_synthesis_runs.parent_share_status` field; analytics-time aggregation.

**2. Placeholder scan:**
- C1-C5 audit gates Task 2+. The plan does NOT pretend to know guardian table shape or daily-cron internals — those are flagged as audit work.
- No code TBDs. Every function signature has a contract spec'd in the plan.

**3. Type / signature consistency:**
- `SynthesisBundle` type defined in Task 2 is consumed by Tasks 3 (summary workflow), 4 (Edge Function), 5 (state route).
- `MonthBoundaries` type is consumed by Task 4.
- `monthly_synthesis_runs` schema columns referenced consistently by Tasks 4, 5, 6, 8.

**4. Scope:**
- One subsystem (Monthly Synthesis). Nine bite-sized tasks. ~2 solo-developer weeks. Independent of any further wave; this is the third and final layer of the strategic spec.

## Plan complete

Saved to `docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-3-monthly-synthesis.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session.

Which approach?
