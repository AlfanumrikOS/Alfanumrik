# Alfanumrik Upgrade — Phase 1 Design

**Date:** 2026-05-06
**Owner:** Pradeep Sharma (solo)
**Status:** Draft — awaiting user review
**Predecessor:** Phase 0 Discovery — see `docs/superpowers/discovery/PRODUCTION_TRUTH.md` and `REPO_DIFF.md`.
**Working repo (canonical):** `C:\Users\Bharangpur Primary\Alfanumrik-repo`.

---

## Why this spec exists

Phase 0 produced two facts that reshape the original A+B+C+D ask:

1. The local checkout is 97 commits behind prod, and most of the April-2026 audit findings are already fixed in those 97 commits. The rest of the upgrade can only be scoped honestly *after* local is aligned with prod.
2. The Desktop folder is an orphan workspace, not a parallel codebase. Treating it as such was wasted reasoning.

Phase 1 is therefore the smallest possible step that converts Phase 0's findings into a working state we can build the rest of the upgrade on top of, plus the two highest-leverage *still-open* items from the post-Phase-0 list.

The four steps below are sequential. Steps 1 and 2 are mechanical hygiene. Steps 3 and 4 produce user-visible value.

---

## Goal

When Phase 1 closes, all of the following are true:

- `Alfanumrik-repo` HEAD = production HEAD (no commits behind, no commits ahead unless I deliberately created them).
- The Desktop workspace is either deleted, or explicitly preserved with a written reason; either way it stops being a confusing parallel.
- A short report exists naming whether the Edge-Function audit's IDOR finding (C-001 in `ml-adaptation`) is still open in current prod, with file:line evidence.
- A scaffolded `/learn/[subject]/[chapter]` page is live behind a feature flag (`ff_learn_chapter_v1`), shipped to production main, gated to my own account only — proving the flag plumbing works end-to-end and giving us the empty surface to fill in Phase 2.

That's the entire scope. Anything bigger gets its own spec.

---

## Non-goals

- Bumping Next.js, React, or any other dependency.
- Fixing audit findings beyond the one IDOR re-verify (Step 3 only verifies; if it's still open, the fix is its own spec).
- Filling in the actual content of `/learn/[subject]/[chapter]` (Phase 2).
- Reconciling unfinished agent worktrees under `.claude/worktrees/`.
- Deleting any prod data, dropping any tables, modifying Vercel settings, or pushing to non-`main` branches.

---

## Step 1 — Safely sync `Alfanumrik-repo` to production

**Goal:** local `main` matches prod SHA `088906f8` (or whatever is current at the time we run), with zero data loss.

**Pre-flight checks (read-only):**

1. `cd C:\Users\Bharangpur Primary\Alfanumrik-repo`.
2. `git status --short --untracked-files=no` — list tracked-file modifications only.
3. `git stash list` — note any existing stashes.
4. `git branch -vv` — confirm `main` tracks `origin/main`.
5. `ls .claude/worktrees` — count active worktrees. (~30 expected.)

**Decision rules before pulling:**

- If `git status` shows tracked-file modifications outside `.claude/worktrees/`: **stop, report, ask user.** Do not stash or discard their work.
- If `git status` shows only `.claude/worktrees/` churn: proceed; that subtree is agent scratch space and is preserved by the pull.
- If `git branch -vv` shows `main` is already at `origin/main`: log the fact and skip the pull.
- If `git branch -vv` shows `main` ahead of `origin/main` for any reason: **stop, report, ask user.** Pulling would silently keep the ahead commits, which may be intended or may be cruft — user decides.

**Sync action (only if pre-flight is clean):**

1. `git fetch origin main --tags`.
2. `git log --oneline HEAD..origin/main | wc -l` — confirm the gap is what Phase 0 reported (~97).
3. `git merge --ff-only origin/main` — fast-forward only; refuse to create a merge commit. If FF fails, **stop** and ask user (means a divergent commit appeared since Phase 0).
4. After merge: `git rev-parse HEAD` and confirm it matches `origin/main`.
5. Re-confirm the `production-truth-2026-05-06` tag still points at `088906f8`. The tag is unaffected by the merge; this is a sanity check.

**Post-sync verification (read-only):**

- `node --version`, `npm --version` — confirm tooling exists.
- `cat package.json | grep -E '"(next|react)"'` — confirm dependency-drift items from Phase 0's Matrix 5 (no `framer-motion`, `posthog-node` present, etc.).
- `ls supabase/migrations/00000000000000_baseline_from_prod.sql` — confirm baseline migration exists locally.
- Do **not** run `npm install` in this step. Step 4 will, only if needed.

**Output:** none beyond a console log entry "synced from <old-sha> to <new-sha>, gap was N commits." No new files in this step.

---

## Step 2 — Decide the fate of the Desktop workspace

**Goal:** the orphan workspace at `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\` either gets deleted (after we prove it has no unique work) or gets a one-paragraph written justification for why it should stay.

**Read-only check:**

1. List every file under the Desktop folder with `git ls-files --others --modified --cached` from inside that folder. (Even though there are no commits, `git status` will list staged additions.)
2. For each file, ask: does an equivalent path exist under `Alfanumrik-repo`? Spot-check the audit `.md` files (`FRONTEND_AUDIT.md`, `DATABASE_AUDIT.md`, `EDGE_FUNCTIONS_AUDIT.md`, `ADR-001-Backend-Architecture.md`, `Onboarding_Audit_Report_2026-04-08.docx`, `Alfanumrik_UX_Audit_2026.docx`, `NCERT_Quiz_Engine_System_Design.md`, `DEPLOY_ONBOARDING_FIXES.md`) — these are documentation artefacts; they should be moved into `Alfanumrik-repo/docs/audits/2026-04/` if they don't already exist there. The `.next/` build artefacts are throwaway. The `commit_p3_p4.ps1` and `onboarding_fixes.patch` files are interesting and worth checking against `Alfanumrik-repo` history before discarding.
3. For files that are unique (no equivalent in prod) and look load-bearing: copy them into `Alfanumrik-repo/docs/historical-from-desktop-workspace/<original-relpath>` with a one-line provenance note in a `README.md` inside that folder. **Do this before any deletion.**

**Action:**

- If everything is either redundant with prod or moved to `Alfanumrik-repo/docs/historical-from-desktop-workspace/`: stop here in this spec. **Deletion of the folder is a separate user-confirmed action**, not part of Phase 1 execution. We'll write a one-paragraph note in `PRODUCTION_TRUTH.md` saying the folder is safe to delete and the user can do it themselves with `Remove-Item -Recurse -Force "c:\Users\Bharangpur Primary\Desktop\Alfanumrik App"`. Reasoning: deleting 200+ MB of `.next/` plus user-visible Desktop files autonomously is the kind of "destructive on shared state" action auto mode is supposed to defer.
- If anything looks unique-and-unclear: leave the folder, write a paragraph in `PRODUCTION_TRUTH.md` explaining what wasn't accounted for, and stop.

**Output:** possibly a new directory `Alfanumrik-repo/docs/historical-from-desktop-workspace/`, plus an appended paragraph in `PRODUCTION_TRUTH.md` recording the disposition.

---

## Step 3 — Re-verify Edge-Function IDOR (ml-adaptation C-001) against post-pull prod

**Goal:** a one-page report at `Alfanumrik-repo/docs/audits/2026-05-06-idor-reverification.md` that says, with file:line citations, whether the IDOR is still open.

**Method:**

1. Open `Alfanumrik-repo/supabase/functions/ml-adaptation/index.ts` (post-pull).
2. Locate the body-parsing block that reads `student_id` from the request body.
3. Locate the RBAC block that checks roles.
4. Look for any code path between (2) and the first DB read/write that **binds the body's `student_id` to the authenticated caller's identity**. The pattern Phase 0 expected to see, from the Edge-Fn audit's recommended fix:
   ```ts
   const { data: callerStudent } = await serviceClient
     .from('students').select('id').eq('auth_user_id', user.id).maybeSingle();
   if (isStudent && !isPrivileged) {
     if (!callerStudent || callerStudent.id !== body.student_id) return 403;
   }
   ```
5. Three possible verdicts:
   - **CLOSED** — the bind exists. Record the file:line of the check. No further action in Phase 1.
   - **OPEN** — no bind. The IDOR allows any student to read/write any other student's BKT mastery. Record the file:line of the unguarded `body.student_id` use. The fix is its own spec; do not write code in Phase 1.
   - **STRUCTURAL CHANGE** — the function has been replaced/renamed/decomposed. Record the new shape and where adaptation now happens (likely the `grounded-answer` pipeline + `_shared/quiz-oracle` infrastructure that landed in the 97-commit gap). Phase 2 brainstorm uses this finding.
6. While the file is open, also confirm: is there a `verify_jwt = false` override anywhere for this function? The Phase 0 audit assumed global `verify_jwt = true` from `supabase/config.toml`. Worth a quick re-confirm.

**Output:** the report file, ~100–300 words, with file:line citations. Nothing more.

---

## Step 4 — Scaffold `/learn/[subject]/[chapter]` behind a feature flag

**Goal:** a new route `src/app/learn/[subject]/[chapter]/page.tsx` exists in prod, returns a placeholder UI, and renders only for accounts with the `ff_learn_chapter_v1` feature flag enabled. My account is the sole flag-holder at end of Phase 1.

**Why scaffold-only:** the actual chapter reading UX (NCERT content rendering, deep-links from quiz, Foxy integration) is a Phase 2 design. Phase 1 just proves the surface exists, the route works, the flag plumbing fires correctly, and the navigation slots are reserved.

**Substeps:**

1. **Read existing flag-gating pattern.** Find one of the existing flag-gated features (e.g., `ff_welcome_v2`, `p1_foxy_streaming_flag`, `server_only_quiz_submit_flag`) and copy its read pattern. Do not invent a new flag-reading helper.
2. **DB migration.** Add `supabase/migrations/<YYYYMMDDHHMMSS>_add_ff_learn_chapter_v1.sql` that inserts the flag with `default_enabled=false`, `rollout_percentage=0`, mirroring the shape used by `add_ff_welcome_v2.sql` (Phase 0 confirmed this file exists in prod).
3. **Page file.** `src/app/learn/[subject]/[chapter]/page.tsx`:
   - Server component.
   - Await the auth + flag check using whatever helper the existing flag-gated pages use.
   - If flag is off: redirect to `/dashboard` (or whatever the existing pattern is for "feature not available for you yet"). Do not 404 — flag-off should look like the feature simply doesn't exist for this user.
   - If flag is on: render a minimal placeholder showing `subject`, `chapter`, an `<h1>{subject} — Chapter {chapter}</h1>`, and one paragraph "Structured chapter view is coming. For now, ask Foxy about this chapter." with a link to `/foxy?subject={subject}&chapter={chapter}`.
   - No data fetching from `chapter_concepts`, `curriculum_topics`, `rag_content_chunks`, etc. in Phase 1. The placeholder is enough.
4. **Tests.** Add a Playwright e2e test in `e2e/` that hits `/learn/math/1` with my own account (flag on) and asserts the placeholder text. Add a second test that hits the route with a flag-off account and asserts the redirect. Use whatever auth-helper pattern existing e2e tests use; do not invent one.
5. **Type-check + lint + unit-test.** `npm run type-check`, `npm run lint`, `npm run test` (vitest). Fix anything that breaks.
6. **Build.** `npm run build`. Confirm `/learn/[subject]/[chapter]` is in the route manifest.
7. **Commit + branch + PR.**
   - Branch name: `feat/learn-chapter-scaffold-phase1`.
   - Commit message convention follows the recent prod commits: `feat(learn): scaffold /learn/[subject]/[chapter] behind ff_learn_chapter_v1 (#PHASE-1)`.
   - Open a draft PR via `gh pr create --draft`.
   - Do **not** merge in Phase 1. The user merges manually after reviewing.

**What I do NOT do in Step 4:**

- Roll the flag to anyone besides my own user.
- Edit any nav component to add a link to the new page.
- Touch the existing `/learn` route if one exists, or any quiz/foxy page.

**Output:** one PR ready for user review, plus the migration file ready to apply via the user's normal supabase migration pipeline (the user runs the migration; I do not run it against prod from here).

---

## Risk register

| Risk | Mitigation |
|---|---|
| Pull from `origin/main` overwrites uncommitted local work I didn't notice. | Step 1 pre-flight refuses to pull if any tracked file outside `.claude/worktrees/` is modified, and refuses non-FF merges. |
| `Desktop\Alfanumrik App` contains a draft I forget to recover before deletion. | Step 2 inventories everything and copies anything unique into `docs/historical-from-desktop-workspace/` before anyone deletes. Deletion itself is left to the user. |
| The 97 prod commits broke local dev tooling (Node 24, Turbopack, dependencies). | Step 1 does not run `npm install` — it leaves verification of dev-loop health to Step 4 build. If Step 4 build breaks, that's a Phase 1 finding worth recording, not a Phase 1 bug to fix; we then write a Phase 1.5 spec for tooling. |
| The IDOR Step 3 finds an OPEN verdict — I'm tempted to fix it inline. | Spec is explicit: Phase 1 verifies, does not fix. The fix is a separate spec because the right fix needs threat-model thinking that should not be hurried. |
| `/learn/[subject]/[chapter]` flag rollout accidentally hits more users than me. | Migration default is `default_enabled=false, rollout_percentage=0`. A separate manual SQL action against prod is required to add my own user; that action is documented in the PR description, not run by me here. |
| The PR I open is force-merged before review. | I open as `--draft`. Cannot be auto-merged on most workflows. |

---

## What "done" looks like

- [ ] `Alfanumrik-repo` `git rev-parse HEAD` matches `origin/main`.
- [ ] `Desktop\Alfanumrik App` is either inventoried with a "safe to delete" note in `PRODUCTION_TRUTH.md`, or has a recorded reason to remain.
- [ ] `Alfanumrik-repo/docs/audits/2026-05-06-idor-reverification.md` exists with verdict and file:line evidence.
- [ ] Draft PR exists on `feat/learn-chapter-scaffold-phase1`, type-check + lint + test + build all pass on it, and the placeholder route is reachable when the flag is on.
- [ ] Auto-memory updated with the IDOR verdict and a pointer to the flag.

When all five are true, Phase 1 closes and we open the Phase 2 brainstorm — scoped against current prod, the IDOR verdict, and any new gaps the post-pull state reveals.

---

## What comes after Phase 1 (preview, not in this spec)

Phase 2 candidates, in priority order:

1. Fill in `/learn/[subject]/[chapter]` content rendering (NCERT chapter UI from `chapter_concepts` + `rag_content_chunks`, deep-linked from post-quiz remediation).
2. If Step 3 found IDOR OPEN: fix `ml-adaptation` student_id binding.
3. Roll `ff_learn_chapter_v1` to internal accounts → 1% → 10% → 100%, on the cadence already used for other flags.
4. Re-audit the entire April-2026 audit set against post-pull prod and produce a "what's actually still open in May 2026" report (much shorter than the original audits).
5. Decide whether to start the Next 16-latest / React 19 jump.

Each of those is its own spec.
