# Alfanumrik Upgrade — Phase 0 (Discovery) Design

**Date:** 2026-05-06
**Owner:** Pradeep Sharma (solo)
**Status:** Draft — awaiting user review

---

## Why this spec exists

The user asked for a production-grade upgrade across product/UX, AI/Foxy, architecture, and tech/infra (A+B+C+D). Two facts make a single big-bang plan unsafe:

1. There are **two divergent codebases** on this machine, and neither is confirmed to be the production source of truth:
   - `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\` — slim ADR-001 modular monolith, ~33 API routes.
   - `C:\Users\Bharangpur Primary\Alfanumrik-repo\` — wider build with school-admin, OAuth, WhatsApp, ~100+ API routes.
2. The product has **paying users** and must roll forward with **no downtime, no big-bang cutover**.

Until we know which checkout is deployed, every fix risks being applied to the wrong codebase, duplicated, or silently lost. This spec covers **only the discovery work** needed to make every subsequent phase decidable. No application code changes. No DB changes. Read-only.

---

## Goal

Produce three artefacts that unblock Phase 1 planning:

1. **`PRODUCTION_TRUTH.md`** — names the deployed git remote, branch, commit SHA, and which local checkout matches it.
2. **`REPO_DIFF.md`** — a route × API × module × migration × dependency matrix between the two checkouts, with each divergence classified (keep / port / drop / merge).
3. **A canonical-repo decision** — one local checkout chosen as the single source of truth going forward, with a one-paragraph rationale and a `git tag production-truth-2026-05-06` on the matching commit so we can always recover the baseline.

That's it. No fixes, no migrations, no refactors. Phase 0 ends when those three artefacts exist and the user has approved the canonical-repo decision.

---

## Non-goals

- Fixing any audit finding (CRITICAL / HIGH / MEDIUM / LOW).
- Touching DB, RLS, edge functions, or app code.
- Reconciling the two codebases (that is Phase 1).
- Setting up feature flags, CI changes, observability changes.
- Picking which audit findings to fix in Phase 1 — that decision waits until the diff exists.

---

## Steps

### Step 1 — Identify production source of truth

**What to find:**

- The Vercel project that serves `alfanumrik.com` (and any preview domain in active use).
- The git remote URL it deploys from.
- The branch it auto-deploys.
- The commit SHA currently live in production.
- Which local checkout's `git log` contains that SHA.

**How:**

- `mcp__claude_ai_Vercel__list_projects` then `get_project` for the Alfanumrik project — read `link.repo`, `link.productionBranch`.
- `mcp__claude_ai_Vercel__list_deployments` filtered to `target=production`, take the most recent `READY` — read `meta.githubCommitSha`, `meta.githubCommitRef`.
- In each local checkout: `git rev-parse HEAD`, `git remote -v`, `git branch --show-current`, `git log --oneline -1 <sha>` to confirm the prod SHA is reachable.

**Edge cases to record, not fix:**

- Production deploys from a remote neither local checkout tracks. Record it; do not change remotes.
- Production SHA is not present in either local checkout (someone is force-pushing, or local is rebased). Record it; flag for Phase 1.
- Vercel access is not available in this session. Record the gap and ask the user to paste the deployed SHA + remote.

**Output:** `docs/superpowers/discovery/PRODUCTION_TRUTH.md` with these exact sections:
1. Vercel project identity (name, id, prod URL, prod branch, deployed SHA, deploy timestamp).
2. Git remote URL, default branch, latest remote commit on that branch.
3. Local checkout match (which folder's HEAD is closest to the deployed SHA, and how many commits ahead/behind).
4. Anomalies (anything from "edge cases to record" above).

---

### Step 2 — Diff the two checkouts

**Inputs:** the two local checkouts as they exist on disk on 2026-05-06.

**Five dimensions, one matrix per dimension:**

1. **Routes (`src/app/**/page.tsx`)** — present in A only / B only / both.
2. **API routes (`src/app/api/**/route.ts`)** — present in A only / B only / both. For "both", record whether file content differs (hash compare).
3. **Modules (`src/modules/**`)** — A only / B only / both. For "both", record whether the module's public `index.ts` exports differ.
4. **Supabase migrations (`supabase/migrations/*.sql`)** — A only / B only / both. Migrations are append-only; missing migrations on one side reveal which side is behind.
5. **Dependencies (`package.json`)** — version mismatches per package.

**How:**

- Glob each tree, build sets, set-difference for "only" categories.
- For "both" with content compare: `git hash-object` each file, compare hashes.
- For dependency diff: parse both `package.json` files, list every package whose version string differs.
- All read-only. No file edits.

**For every divergence, the matrix records one of four classifications. Default rules (used when no other signal exists; user can override later):**

- **`keep-prod`** — present only in the prod-canonical checkout (per Step 1). Authoritative; the other side gets nothing.
- **`port`** — present only in the non-prod checkout, looks valuable (new feature surface like school-admin, OAuth, WhatsApp). Schedule a port in Phase 1.
- **`drop`** — present only in the non-prod checkout, looks like dead code or an aborted experiment (no callers, contradicts ADR-001, or duplicates an existing module). Schedule deletion in Phase 1.
- **`merge`** — present in both with content drift. Phase 1 must reconcile by hand.

The classification is best-effort heuristic at this stage. The point is to surface the shape of the work, not commit to it.

**Output:** `docs/superpowers/discovery/REPO_DIFF.md` with one table per dimension and a final summary count: `keep-prod: N, port: N, drop: N, merge: N`.

---

### Step 3 — Decide the canonical repo and tag the baseline

**What to decide:** which of the two local checkouts becomes the single source of truth going forward.

**Decision rule:**

- If exactly one local checkout matches the production SHA from Step 1 → that one is canonical.
- If both checkouts are ahead of prod but in different directions → canonical is the one that matches the prod *remote*; the other becomes a feature-source archive whose useful pieces get ported via Phase 1's `port` items.
- If neither checkout matches prod → ask the user. Do not pick.

**What to write down:** a one-paragraph rationale appended to `PRODUCTION_TRUTH.md`, plus the explicit canonical path.

**What to do mechanically:**

- In the canonical checkout, `git tag production-truth-2026-05-06 <prod-sha>`. This is local-only; not pushed. It exists so we can always rewind to "this is what was live on the day Phase 0 ended."
- In the non-canonical checkout, do nothing. Don't delete it, don't move it, don't push from it. Phase 1 decides its fate.

**Output:** the tag exists; `PRODUCTION_TRUTH.md` ends with the canonical-repo decision.

---

## What "done" looks like

- [ ] `docs/superpowers/discovery/PRODUCTION_TRUTH.md` exists and names the prod SHA, prod remote, prod branch, and the matching local checkout.
- [ ] `docs/superpowers/discovery/REPO_DIFF.md` exists with five matrices and a classification summary.
- [ ] `git tag production-truth-2026-05-06` exists in the canonical checkout.
- [ ] User has read both files and confirmed the canonical-repo choice.

When all four are true, Phase 0 is closed and we open the next brainstorming session for Phase 1, scoped *against the matrix* rather than against my guesses.

---

## Risks and how this spec handles them

| Risk | Mitigation in this spec |
|---|---|
| I touch the wrong codebase and break prod | Phase 0 is read-only by definition. No edits, no migrations, no deploys. |
| Vercel access is unavailable in this session | Step 1 explicitly accommodates "ask the user to paste the SHA" rather than guessing. |
| The diff is huge and I get lost | The matrix is bounded (5 dimensions, file-level granularity). I do not propose fixes inside Phase 0; I only classify. |
| User changes their mind about which repo is prod after the tag is written | The tag is local-only and reversible. No history is rewritten. |
| Discovery itself takes too long and stalls value delivery | Phase 0 is intentionally narrow. If the matrix takes more than one work session, that itself is a finding worth recording — it means the drift is bad enough to deserve a Phase 1 bullet of its own. |

---

## What comes next (not in this spec)

After Phase 0 closes, the next brainstorming session uses `REPO_DIFF.md` to scope **Phase 1 — Reconcile & Stabilize**. Likely contents (subject to the matrix):

- Base-schema versioning (`supabase db dump --schema-only`) — DB audit CRITICAL-1.
- IDOR fix in `ml-adaptation` — Edge-fn audit CRITICAL-1.
- CORS allowlist + rate limit + size caps in `rag-retrieval` — Edge-fn audit HIGH-1/2/3.
- `link_code` propagation in guardian email-confirm path — Frontend audit H1.
- Razorpay webhook end-to-end verification.
- `feature_flags` enforcement so every later phase ships behind a flag.

Phase 1 will be its own spec, written only after Phase 0's artefacts exist.
