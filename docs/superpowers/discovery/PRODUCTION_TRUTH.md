# Production Truth — Alfanumrik

**Date:** 2026-05-06
**Phase:** Upgrade Phase 0 — Discovery (Step 1 + Step 3)
**Status:** Final

---

## Vercel project identity

| Field | Value |
|---|---|
| Project name | `alfanumrik` |
| Project ID | `prj_1PRfOVHYbSemMYSU5DXCMIUG9sda` |
| Team | `Pradeep Sharma's projects` (`team_hzGOneVt21Je8RCtuAsDU7TA`) |
| Framework | Next.js |
| Node version | 24.x |
| Bundler | Turbopack |
| Production domains | `alfanumrik.com`, `www.alfanumrik.com`, `*.alfanumrik.com` |
| Latest production deployment ID | `dpl_29MAFrSBcs7PR1WDKJuxdbzAxBQY` |
| Latest production deploy state | `READY` |
| Latest production deploy timestamp | 2026-05-06 (Unix `1777990365089`) |

## Git source of truth

| Field | Value |
|---|---|
| GitHub org/repo | `AlfanumrikOS/Alfanumrik` |
| Production branch | `main` |
| **Live production SHA** | **`088906f823325c396847036ce005553013a69afe`** |
| Live production commit message | `docs: complete truly-remaining tasks (lawyer pack pre-fill + orphan analysis) (#545)` |
| Live production commit author | `Alfanumrik Adaptive Learning OS <alfanumrik@outlook.com>` |
| `gitDirty` flag on Vercel meta | `1` (deployed from a working tree with uncommitted changes — not a clean SHA build) |

## Local checkout match

Two local checkouts were inspected:

### `C:\Users\Bharangpur Primary\Alfanumrik-repo\` — **canonical**

| Field | Value |
|---|---|
| Git remote (origin) | `https://github.com/AlfanumrikOS/Alfanumrik.git` ✅ matches Vercel |
| Current branch | `main` |
| HEAD SHA | `21fd8c5d868193952f784d1b37d027761b60e44d` |
| HEAD commit | `feat(quiz-generator): flag-gated IRT-info selection branch (#407)` |
| Has Vercel link file | ✅ `.vercel/project.json` → `prj_1PRfOVHYbSemMYSU5DXCMIUG9sda` |
| Reaches prod SHA | ✅ `git cat-file -t 088906f8…` returns `commit` |
| Commits behind prod | **97 commits** |
| Commits ahead of prod | 0 |
| Working tree clean | ❌ ~30 untracked/dirty entries under `.claude/worktrees/*` (agent worktrees, not mainline work) |

### `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\` — **not a clone**

| Field | Value |
|---|---|
| Git remote | none |
| HEAD | none — `git rev-parse HEAD` errors with "ambiguous argument" |
| Branch state | `main` exists with **zero commits** (unborn branch) |
| Files | 100% staged via `git add`, never committed |
| Relationship to prod | unknown; the file tree corresponds roughly to the Apr-2026 audit snapshot, but no git history binds it to any prod SHA |

This folder is an orphan workspace — likely a manual file copy used for the Apr-2026 audit work. **It is not a parallel codebase.** The earlier framing of "two divergent codebases" was wrong; there is one codebase (`AlfanumrikOS/Alfanumrik`) with one stale local clone.

## Anomalies recorded (not fixed in Phase 0)

1. **`gitDirty=1` on the live deployment.** The currently-live production deploy was built from a working tree that contained uncommitted changes (i.e., the deployed artefact is *not* a pure rebuild of SHA `088906f8`). Phase 1 must verify whether that drift is benign (auto-generated files like build manifests) or load-bearing.
2. **Local checkout is 97 commits behind prod.** Any analysis based on local HEAD will miss roughly four weeks of merged work, including the baseline-schema migration and most fixes for the April audit findings.
3. **`Desktop\Alfanumrik App` has no git history.** It cannot be reconciled by any normal git mechanism. Phase 1 will treat it as either (a) safe to delete after confirming no unique work, or (b) source for a final hand-port if any of its files don't exist in prod. Today: leave untouched, do not delete.
4. **~30 worktrees under `Alfanumrik-repo/.claude/worktrees/`** are dirty/untracked. These appear to be agent-spawned scratch worktrees and are out of scope for Phase 0; Phase 1 should classify them.
5. **Vercel API access is available in this session.** No need to ask the user to paste the SHA manually.

---

## Canonical-repo decision

**Canonical local checkout going forward: `C:\Users\Bharangpur Primary\Alfanumrik-repo\`.**

**Rationale.** It is the only checkout that (a) carries a `.vercel/project.json` matching the live project, (b) tracks the same GitHub remote that Vercel deploys from, (c) shares git history with the live production SHA, and (d) is on the same branch (`main`) that Vercel auto-deploys. The Desktop folder fails every one of these tests — it has no remote, no commits, no Vercel link. There is no decision to make: `Alfanumrik-repo` is the source of truth and the Desktop folder is a workspace artefact.

The Desktop folder is **not** deleted in Phase 0 (read-only by spec). Phase 1 will decide its fate after confirming nothing useful exists there that isn't already in prod.

## Baseline tag

A local-only tag has been written to mark the production state observed today:

```
git tag production-truth-2026-05-06 088906f823325c396847036ce005553013a69afe
```

The tag exists in `Alfanumrik-repo` only, is not pushed, and gives us a recoverable "this is what was live on 2026-05-06" anchor for every later phase.

---

## Phase 1 update — sync executed (2026-05-06)

Phase 1 Step 1 discovered that the remote `main` had been **history-rewritten** (force-pushed) sometime after 2026-04-26. The pre-rewrite local timeline (2,043 commits ending at `21fd8c5d`) shared zero commits with the post-rewrite origin/main. The prior `git rev-list 21fd8c5d..088906f8 = 97` reading was misleading — those 97 commits sat on a separate timeline with no common ancestor, not a forward continuation of local history. Action taken under Option A:

- Old timeline preserved on local-only branch `backup/abandoned-old-main-2026-05-06` at SHA `21fd8c5d`.
- `main` hard-reset to `origin/main` at SHA `088906f8`.
- Three stale dirty files reverted; gradle wrapper bump preserved as `stash@{0}` (`phase-1-pre-sync gradle-wrapper-8.9-bump 2026-05-06`); ten pre-existing stashes intact.
- Tag `production-truth-2026-05-06` still valid (it points at `088906f8`, which is reachable from current `main`).

## Phase 1 update — Desktop workspace disposition (2026-05-06)

Phase 1 Step 2 inventoried `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\`. Findings:

- **0 of the 10 candidate files have ever existed in `AlfanumrikOS/Alfanumrik` git history**, confirmed via `git log --all --diff-filter=A -- "*<filename>"` for each.
- **All 10 unique reference files are now copied to `docs/historical-from-desktop-workspace/`** with a README documenting provenance and disposition (April 2026 audits, ADR-001, design docs, patches, PowerShell helper).
- The Phase 0/1 spec + discovery artefacts I wrote during this work are also copied into the canonical repo at `docs/superpowers/{specs,discovery}/`.
- The remainder of the Desktop folder is build artefacts (`.next/`, `node_modules/`) and source files identical to or stale relative to current `main`.

**Disposition: the Desktop folder is safe for the user to delete.** Recommended command:

```powershell
Remove-Item -Recurse -Force "c:\Users\Bharangpur Primary\Desktop\Alfanumrik App"
```

Left to the user rather than executed autonomously per the auto-mode rule against destructive operations on user files. After deletion, no information is lost — every unique file lives in `Alfanumrik-repo/docs/historical-from-desktop-workspace/` (committed on branch `chore/preserve-pre-sync-artefacts`).

