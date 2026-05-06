# Phase 1 Closure — Alfanumrik Upgrade

**Date:** 2026-05-06
**Predecessor:** Phase 0 — `PRODUCTION_TRUTH.md`, `REPO_DIFF.md`.
**Spec:** `docs/superpowers/specs/2026-05-06-alfanumrik-upgrade-phase-1-design.md`.
**Status:** Closed.

---

## What Phase 1 set out to do

1. Sync `Alfanumrik-repo` to production HEAD without losing any work.
2. Decide the fate of the orphan Desktop workspace.
3. Re-verify the April 2026 Edge-Function audit's CRITICAL-1 IDOR finding against post-sync prod.
4. Scaffold a placeholder `/learn/[subject]/[chapter]` page behind a `ff_learn_chapter_v1` flag, on the assumption that the page was missing.

## What actually happened

### Step 1 — Sync (executed) ✅

The remote `main` had been **history-rewritten** (force-pushed) sometime between 2026-04-26 and 2026-05-06. The pre-rewrite local timeline (2,043 commits ending at `21fd8c5d`) shared zero commits with the post-rewrite origin/main (the `git rev-list 21fd8c5d..088906f8 = 97` count Phase 0 reported was misleading — those 97 commits sat on a separate timeline with no common ancestor, not a forward continuation).

Action taken (Option A):

- Old timeline preserved on local-only branch `backup/abandoned-old-main-2026-05-06` at SHA `21fd8c5d`. Not pushed.
- Pre-sync working-tree mods classified: 3 files already matched origin/main; 3 files were stale rewrites of work prod had already shipped (`.env.example` PostHog block, `mobile/pubspec.lock`, `src/app/dashboard/page.tsx` 1,219-LOC variant of the now-899-LOC dashboard) — discarded; 1 file was a meaningful local Android-tooling tweak (gradle 8.4 → 8.9 bump) preserved as `stash@{0}`.
- `git reset --hard origin/main` brought local to `088906f8`.
- All 10 pre-existing stashes survived; 1 new stash for the gradle bump added at `stash@{0}`.

### Step 2 — Desktop workspace disposition (executed) ✅

Inventoried `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\`. Found 10 unique reference files (April audits, ADR-001, design docs, patches, helper scripts) that had **never** existed in this repo's git history. All 10 copied to `docs/historical-from-desktop-workspace/` with a README documenting provenance. Phase 0/1 spec + discovery artefacts also copied into the canonical repo at `docs/superpowers/{specs,discovery}/`. Committed on branch `chore/preserve-pre-sync-artefacts` (local, not pushed).

Disposition recorded in `PRODUCTION_TRUTH.md`: the Desktop folder is safe for the user to delete with `Remove-Item -Recurse -Force "c:\Users\Bharangpur Primary\Desktop\Alfanumrik App"`. Deletion left to the user per the auto-mode rule against destructive operations on user files.

### Step 3 — IDOR re-verification (executed) ✅

**Verdict: CLOSED — STRUCTURAL CHANGE.** The vulnerable function `supabase/functions/ml-adaptation/index.ts` no longer exists in prod. Adaptation responsibility was redistributed across `quiz-generator` (selection), `grounded-answer` (tutoring), and Supabase RPCs. The April audit's recommended bind — verify `body.student_id` belongs to the JWT user via the `students` table — is now present at `supabase/functions/quiz-generator/index.ts:1056-1068`.

Full report: `docs/audits/2026-05-06-idor-reverification.md`. Committed on branch `chore/preserve-pre-sync-artefacts`.

### Step 4 — `/learn/[subject]/[chapter]` scaffold (skipped — page already exists) ⚠️

Phase 0's REPO_DIFF concluded the page was missing in prod. That conclusion was an artefact of the diff direction: it compared a stale Apr-2026 local snapshot against prod and saw "page added in prod" as "page absent" relative to the wrong baseline. Post-sync, **the page is fully implemented in prod**:

- `src/app/learn/page.tsx` — 16 KB (subject grid).
- `src/app/learn/[subject]/page.tsx` — exists.
- `src/app/learn/[subject]/[chapter]/page.tsx` — **31 KB / ~700 LOC** of real chapter UI: topics, questions, diagrams, Bloom levels, completion tracking, plan-gating, login redirect.
- `src/app/learn/error.tsx`, `src/app/learn/loading.tsx` — present.

Shipping a scaffold-only placeholder behind `ff_learn_chapter_v1` would have been a net regression — either flag-gating a live feature or seeding a dead flag nobody reads. The migration file I had drafted was deleted before commit. The `feat/learn-chapter-scaffold-phase1` branch was deleted with no commits.

## Net Phase 1 outcome

Phase 1 produced:

- A correct local checkout aligned with prod, with a recoverable backup of the abandoned timeline.
- A canonical home for the April audit reference material (`docs/historical-from-desktop-workspace/`).
- The Phase 0 + Phase 1 specs + discovery artefacts now under version control.
- A re-verified IDOR finding (CLOSED) for future phases to inherit.
- A correction to Phase 0's understanding of the `/learn` gap.

What Phase 1 did **not** produce: any user-visible feature. That's expected — Phase 1 was the unavoidable foundation work. Phase 2 starts from a known-good baseline.

## What this changes for the rest of the upgrade

The original upgrade thesis was framed against the April 2026 audits. Three of the four headline pains the user named (A stabilize / B learning loop / F school B2B) need re-scoping against the post-sync state, because most of what those audits flagged is closed in current prod:

- **Pain A (stabilize) — already much smaller than thought.** Baseline schema versioned (DB-audit CRITICAL-1 closed), atomic subscription activation + advisory locks (frontend-audit C11/C12 closed), IDOR closed (Edge-fn C-001 closed), payments hardening landed across 20-plus migrations.
- **Pain B (learning loop) — most of B is already shipped.** RAG-RRF, MMR diversity, structured grounded-answer, IRT 2PL calibration, IRT-info question selection, misconception ontology, quiz oracle, Foxy streaming, **and** a real `/learn/[subject]/[chapter]` page. The Phase 2 question is what to *improve*, not what to build from scratch.
- **Pain F (school B2B) — needs a fresh look.** The 97-commit jump did not target school B2B specifically. Phase 2 should grep prod for `school_admin`, `oauth`, `school-config`, `schools/enroll` etc. and assess what's wired vs scaffolded.

## Recommended Phase 2 brainstorm scope

Narrow:

1. Run an automated re-audit of all April-2026 findings against current prod and produce a "what is actually still open in May 2026" matrix. Likely shorter than I expect.
2. Run a `/learn/[subject]/[chapter]` UX review against current prod to identify *real* gaps (vs the imagined "page is missing" gap).
3. Scope the school B2B surface (school-admin/*, oauth, schools/enroll, school-config, multi-tenant RLS) honestly — what's complete, what's stubbed, what's missing.

That's the Phase 2 brainstorm. Each of the three becomes its own spec only if the matrix confirms it's a real gap.
