---
description: Independently audit a prior session's Compact Report against the actual codebase, git history, and (where accessible) the live Supabase project — trust nothing it claimed.
---

# Audit a Claimed Change

You are auditing someone else's work, not continuing it. You have no memory
of the session that produced the report below and no reason to want it to
be right. Your only job is to find out whether it actually is.

Read `.claude/CLAUDE.md` first — it defines the rules the original session
was supposed to follow: the product invariants P1-P15, the P14 review-chain
matrix, the regression catalog (`.claude/regression-catalog.md`), and the
Compact Report Format every task must end with. Hold the claimed change to
that standard.

## The claimed change report

$ARGUMENTS

## Your process

For every line in the report above, re-derive the answer yourself from
primary sources. Do not accept the report's wording as evidence of
anything — a well-formatted claim is not a checked claim.

- **Scope ("Files: [n] changed")** — run `git diff` / `git log` / `git show`
  yourself. Does the actual diff match the claimed file count and scope, or
  does it touch more or less than claimed?
- **"Tests: [pass]/[total]"** — do not trust the numbers. Re-run the
  relevant tests (`npx vitest run <path>` for targeted files, `npm test`
  for the suite) or find the actual command output in the session record.
  A count with no run behind it is a fabrication.
- **"Build: PASS"** — re-run `npm run type-check` (and `npm run build` if
  the change is build-relevant). "PASS" without a command behind it is a
  claim, not a result.
- **"Chains: [n] complete"** — open the P14 review-chain matrix
  (`.claude/skills/review-chains/SKILL.md`) and map it against the files
  the diff actually modified. Were all mandatory downstream reviewers
  invoked for each triggered chain? A chain marked "complete" with no
  reviewer output is incomplete.
- **"Catalog:" / regression claims** — if the report claims regression
  catalog entries were added, confirm they exist in
  `.claude/regression-catalog.md` under the claimed REG-ids, and that the
  cited test files exist and reference those ids.

## Invariant spot-checks for touched domains

For whichever domains the diff actually touches (not what the report says
it touches), verify the relevant invariants directly:

- **P1/P2 (scoring/XP)** — `packages/lib/src/xp-rules.ts` is the ONLY XP
  source. Grep the diff for hardcoded XP numbers or a re-derived score
  formula; the score formula is fixed at `Math.round((correct/total)*100)`.
- **P5 (grade format)** — grades are strings `"6"`..`"12"`, never integers.
  Check any touched types, RPC params, and DB columns.
- **P8 (RLS)** — every new table created in a touched migration must have
  RLS enabled and policies in the SAME migration file. Read the migration,
  don't trust the report.
- **P9 (RBAC)** — touched API routes must enforce server-side via
  `authorizeRequest(request, 'permission.code')` or, for
  `/api/super-admin/*`, `authorizeAdmin(request, level)`. Client
  `usePermissions()` is not a security boundary.
- **P13 (privacy)** — no PII (email, phone, name, message text, raw IP) in
  logs, Sentry payloads, audit-log details, or analytics events introduced
  by the diff.

## The monorepo trap

Verify edits landed in the CANONICAL files: `packages/lib/src/*` and
`packages/ui/src/*`. The files at `apps/host/src/lib/*` and
`apps/host/src/components/*` are 2-line auto-generated re-export stubs —
an edit that landed in a stub instead of the canonical file is a defect
even if type-check passes. Check the diff paths explicitly.

## Also check, unconditionally, every time

Regardless of what the report claims, actively check for Alfanumrik's own
recurring failure patterns — these have happened before and won't announce
themselves in a report:

1. **Deployed state asserted from docs or memory** — the quiz-generator-v2
   incident: the constitution claimed the function "never existed" while it
   was live and ACTIVE in production (v35). If the change asserts anything
   about what is deployed (Edge Functions, env vars, cron jobs), verify with
   `supabase functions list` or a live query — never from a doc claim.
2. **Stale counts quoted from docs** — page counts, route counts, migration
   counts, and test counts in CLAUDE.md drift. If the report quotes a count,
   re-count with the actual command (`ls ... | wc -l`, `Glob`, etc.).
3. **Parallel duplicate implementations** — the `enhanced-quiz-generator`
   orphan pattern: search for near-duplicate routes, components, Edge
   Functions, or tables adjacent to what was changed. A change that "adds"
   something may have added a second copy of something that already existed.

## Output

For each report line and each check above, give a verdict:

- **CONFIRMED** — you independently reproduced the same result. State the
  command/query you ran and what it returned.
- **CONTRADICTED** — what you found disagrees with the claim. State the
  discrepancy plainly; this is the finding that matters most.
- **UNVERIFIABLE** — you could not check it (missing access, ambiguous
  scope, etc.). Say what you'd need to verify it, don't guess.

End with one line: **Fabrication risk: LOW / MEDIUM / HIGH**, based on how
many claims were confirmed vs. contradicted vs. unverifiable — not on how
confident the original report sounded.
