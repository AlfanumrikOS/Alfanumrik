# Historical artefacts from the Desktop workspace

**Date moved:** 2026-05-06 (during Upgrade Phase 1, Step 2)
**Origin:** `c:\Users\Bharangpur Primary\Desktop\Alfanumrik App\` — an orphan workspace with no git history that lived on the founder's Desktop.

## Why these files are here

Phase 0 of the May 2026 upgrade discovered that the Desktop folder was not a parallel codebase, but a manual file dump used to host the April 2026 audit work outside of git. The 10 files in this directory existed only on Desktop and had **never been committed to `AlfanumrikOS/Alfanumrik`** (verified by `git log --all --diff-filter=A -- "*<filename>"` returning empty for each).

To prevent loss, they have been copied here verbatim before the user is asked to delete the Desktop folder. They are reference material, not active project state.

## File-by-file provenance

| File | Date | Type | Notes |
|---|---|---|---|
| `FRONTEND_AUDIT.md` | 2026-04-10 | Audit (Claude Sonnet 4.6) | Pre-baseline-migration audit. Many findings are now closed in prod (verified in `docs/superpowers/discovery/REPO_DIFF.md`). |
| `DATABASE_AUDIT.md` | 2026-04-10 | Audit (Claude Sonnet 4.6) | Same as above. CRITICAL-1 (base schema not versioned) is closed by `supabase/migrations/00000000000000_baseline_from_prod.sql`. |
| `EDGE_FUNCTIONS_AUDIT.md` | 2026-04-10 | Audit (Claude Sonnet 4.6) | C-001 IDOR in `ml-adaptation` — re-verification scheduled in Phase 1 Step 3. |
| `ADR-001-Backend-Architecture.md` | 2026-04-08 | Architecture decision record | Modular monolith + selective edge functions. Largely realized in current prod. |
| `NCERT_Quiz_Engine_System_Design.md` | unknown | Design doc | Quiz engine system design from before the quiz-oracle / authenticity work landed. Of historical interest. |
| `DEPLOY_ONBOARDING_FIXES.md` | unknown | Deployment notes | Notes accompanying `onboarding_fixes.patch`. |
| `Onboarding_Audit_Report_2026-04-08.docx` | 2026-04-08 | Audit (Word) | UX audit of onboarding flow. May overlap with shipped welcome v2. |
| `Alfanumrik_UX_Audit_2026.docx` | 2026 | Audit (Word) | Broad UX audit. The single biggest open finding — `/learn/[subject]/[chapter]` — is being addressed in Phase 1 Step 4. |
| `onboarding_fixes.patch` | unknown | Patch file | Whether this patch was ever applied is unknown. Search prod git log before re-applying. |
| `commit_p3_p4.ps1` | unknown | PowerShell helper | Author's helper script for batching commits. Not load-bearing. |

## How to use these files

These are reference material for re-scoping the upgrade in May 2026 against current prod. **Do not rely on file:line citations inside the audits without verifying against current code** — most of the cited file paths predate the 97-commit forward jump that landed between April 25 and May 6, 2026.

When in doubt, prefer:

- `docs/superpowers/discovery/PRODUCTION_TRUTH.md` — current prod state.
- `docs/superpowers/discovery/REPO_DIFF.md` — what changed in the 97-commit gap and which audit findings that gap closes.
- Live source code — the only source of truth for "is this still true today?"

## Why these are not in `docs/audits/`

This folder name carries the provenance ("from Desktop workspace") so future maintainers know these documents are pre-baseline-migration snapshots, not part of the canonical audit trail. If the audits are formally re-run against current prod, the new versions belong in `docs/audits/`; these stay here as historical context.
