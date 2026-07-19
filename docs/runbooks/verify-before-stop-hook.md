# Runbook: verify-before-stop Stop Hook (Compact Report Claim Verifier)

**Owner:** ops
**Installed:** 2026-07-20 (adapted from a CEO-approved external anti-fabrication toolkit)
**Files:** `.claude/hooks/verify_before_stop.py` (hook), `.claude/settings.json` (`Stop` entry), `.claude/commands/audit-change.md` (companion), `.claude/verification-log.jsonl` (output, gitignored)

## What it does

Every time a Claude Code session tries to stop, the hook re-reads the
turn's actual tool-call history from the session transcript and
cross-checks it against the Compact Report Format the session emitted
(the `## Done / Agents / Files|Tests|Build / Catalog / Chains / Approval /
Commit` block required by `.claude/CLAUDE.md`). It blocks the stop
(`{"decision":"block","reason":...}`) when a claim has no tool call
behind it:

| Condition | Block |
|---|---|
| Files were edited this turn but no Compact Report was emitted | yes |
| `Tests:` line claims a pass count (not N/A, not 0/0) but no vitest / `npm test` / `npm run test*` command ran this turn | yes |
| `Build: PASS` claimed but no `npm run build` / `next build` / `npm run type-check` / `tsc` command ran this turn | yes |
| Files were edited but no `git diff` / `git status` ran this turn | yes |

A report is detected when at least 2 of the distinctive markers
(`## Done:`, `Agents:`, `Catalog:`, `Chains:`, `ready to merge`) appear
in the final assistant message. Supabase/MCP query activity is recorded
in the evidence log but never blocks (the Compact format has no schema
line). The `stop_hook_active` flag is honored so the hook nags at most
once per turn and cannot loop.

## Heuristic nature — read this before trusting a pass

A pass means **"no obvious fabrication," not "verified correct."** The
hook only checks that *some* command of the right family ran this turn —
it cannot see whether the command succeeded, whether the pasted numbers
match the real output, or whether the right files were tested. It is a
cheap mechanical net for the most common failure (asserting results that
were never produced). For real verification of a suspicious report, use
the model-based companion:

```
/audit-change <paste the Compact Report here>
```

`/audit-change` re-derives every claim from primary sources (`git diff`,
re-running tests/type-check, the P14 chain matrix, the regression
catalog, canonical-vs-stub paths, and Alfanumrik's known incident
patterns such as the quiz-generator-v2 deployed-state drift) and issues
per-line CONFIRMED / CONTRADICTED / UNVERIFIABLE verdicts plus an
overall fabrication-risk rating.

## Reading `.claude/verification-log.jsonl`

One JSON object per Stop attempt (append-only, best-effort, gitignored):

```json
{
  "ts": 1784500000.0,
  "session_id": "…",
  "verdict": "blocked" | "passed",
  "problems": ["…reasons, empty when passed…"],
  "evidence": {
    "search": true, "git_diff": true, "supabase_query": false,
    "file_edit": true, "file_read": true,
    "test_run": true, "build_run": false
  },
  "report_present": true
}
```

Useful queries (PowerShell): count blocks —
`Get-Content .claude/verification-log.jsonl | ConvertFrom-Json | Where-Object verdict -eq 'blocked' | Measure-Object`.
A high block rate on a particular problem string tells you which claim
agents most often make without evidence. Delete the file freely; it
regenerates.

## Troubleshooting

- **Hook errors / Python missing:** the hook is registered as
  `python "$CLAUDE_PROJECT_DIR"/.claude/hooks/verify_before_stop.py`
  (this is a Windows machine where `python` resolves to 3.14; `python3`
  is not guaranteed). It has zero third-party dependencies.
- **False block:** the reason text names the exact missing evidence. Run
  the named command for real and re-emit the report; do not edit the
  hook to silence it.
- **Disable temporarily:** remove the `Stop` entry from
  `.claude/settings.json` (leave PreToolUse/PostToolUse entries alone).

## Future option: experimental agent-type Stop hook (NOT installed)

The source toolkit ships an optional stronger variant: an **agent-type**
Stop hook that, instead of a heuristic script, spawns a real subagent
with Read/Grep/Glob access to independently inspect the codebase before
allowing Stop. Per Anthropic's hooks documentation this hook type is
**experimental** — Anthropic recommends command hooks for production and
notes agent hooks are likely to change. It is deliberately not installed.
If we ever trial it (low-stakes branch first), the Alfanumrik-adapted
handler would be added as a second handler in the same `Stop` matcher
group:

```json
{
  "type": "agent",
  "prompt": "You are auditing a Claude Code session on the Alfanumrik codebase (see .claude/CLAUDE.md for the product invariants P1-P15, the P14 review-chain matrix, and the Compact Report Format). The session's final message is in $ARGUMENTS as last_assistant_message. Do NOT trust its Compact Report. For each claim line — 'Files: [n] changed', 'Tests: [pass]/[total]', 'Build: PASS/FAIL', 'Catalog:', 'Chains: [n] complete', 'Commit: [hash]' — independently re-derive the answer: run git diff/log yourself, look for actual test/build output, check .claude/regression-catalog.md for claimed REG ids, and check the review-chain matrix against the files actually modified. Do not accept the report's wording as evidence. Return {\"ok\": true} only if every claimed line is independently confirmed by what you found. Otherwise return {\"ok\": false, \"reason\": \"<which specific lines you could not confirm, and what you found instead>\"}.",
  "timeout": 120
}
```
