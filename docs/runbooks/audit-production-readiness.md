# Runbook: Production-Readiness Audit

Periodic, read-only sweep that reconciles the constitution (`CLAUDE.md`, `.claude/CLAUDE.md`, regression catalog, vitest thresholds, super-admin file counts) with the actual state of the codebase, surfaces drift, and produces a single ranked failure list with a fix plan.

## When to run

- **Every 4 weeks** as a standing cadence (calendar reminder for the orchestrator).
- **Before any major release** (anything that ships behind a top-level marketing announcement, a pricing change, a new role, or a new CBSE subject).
- **After large refactors** that touch more than ~30 files in a single session.
- **After any incident** that involved an undetected regression — to prove the catalog is honest about coverage.
- **Ad-hoc** when the user (CEO) asks for a "state of the platform" briefing.

## How to run

Invoke the orchestrator:

> "Run a production-readiness audit. Read-only, no fixes, single document output."

The orchestrator spawns 6 specialist agents in parallel, each scoped to its domain:

| Agent | Scope |
|---|---|
| architect | Schema/RLS/RBAC drift, migration hygiene, deploy config, security review |
| backend | API surface, webhook integrity, payment correctness, notification paths |
| frontend | Bundle sizes, page count vs. claim, i18n coverage, mobile-affecting changes |
| assessment | P1-P6 invariant compliance, score/XP/Bloom's correctness, content coverage |
| ai-engineer | AI safety (P12), RAG retrieval quality, prompt drift, kill-switch wiring |
| testing | Regression catalog vs. actual tests, coverage thresholds vs. config, gap list |
| ops | Super-admin count drift, feature-flag inventory, monitoring/Sentry coverage, doc accuracy |

Audits MUST be **read-only**. No file edits, no commits, no deploys. The audit produces findings; remediation runs in follow-up sessions.

## Output expectation

A single document per audit, stored at `docs/audits/YYYY-MM-DD.md`, with this structure:

1. **Executive verdict** — one of: `green` (release-ready), `yellow` (ship with named risks), `red` (block).
2. **Per-domain status** (red/yellow/green for each of the 7 agent scopes above).
3. **Ranked failure list** — every drift/risk numbered F1, F2, F3, … in priority order.
4. **Fix plan** — failures grouped into S-numbered sessions (e.g., S1, S2, S3) with predicted blast radius and required reviewers per `P14` chains.
5. **Reconciliation diff** — concrete numbers updated this audit:
   - Regression catalog: claim vs. actual entries
   - Coverage thresholds: claimed vs. `vitest.config.ts` reality
   - Super-admin file counts: claim vs. `Glob` count
   - Anything else where the constitution drifted from code

## Where prior audits are stored

- Directory: `docs/audits/`
- Filename: `YYYY-MM-DD.md` (date the audit ran, not the date drift was introduced)
- The directory is checked in. Audits are part of the public history of the codebase.

## Follow-up sessions

After each audit, the orchestrator opens N `S<number>:` sessions to remediate the findings. Each S-session:

- Has a single failure cluster as scope
- Touches only the files needed for that fix
- Triggers the relevant `P14` review chain
- Ends with a doc reconciliation if any constitution claim changed

The audit document itself is never edited after the run — drift discovered later goes into the next audit.

## Rules

- **Read-only.** Audits never modify code, tests, migrations, or configs.
- **No commits during the audit.** Remediation happens in follow-up sessions.
- **Do not skip the reconciliation diff** — operational drift is the audit's load-bearing output.
- **Numbers must come from `Glob` / `Grep` / `Read`,** never recalled from memory or prior audits.
- **The audit document is the source of truth** for the next 4-week window. The CEO briefing references it.
