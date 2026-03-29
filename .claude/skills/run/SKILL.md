---
name: run
description: Master execution command. Decomposes any task, delegates to agents, enforces gates, and reports results. Use for all serious work.
---

# Alfanumrik Master Execution

Task: $ARGUMENTS

Execute this task using the full multi-agent protocol. Follow every step below. Do not skip steps.

## Phase 1: Decompose

Analyze the task above. Produce this breakdown before doing any work:

```
## Task Decomposition
Request: [one sentence summary]
Type: feature | bugfix | audit | architecture | release | scaling | ai-change | reporting | other

### Affected Domains
- [ ] Database/schema/RLS → architect
- [ ] API routes/payments/webhooks → backend
- [ ] Pages/components/styling/i18n → frontend
- [ ] Scoring/XP/Bloom's/CBSE → assessment
- [ ] AI/RAG/prompts/Edge Functions → ai-engineer
- [ ] Mobile/Flutter/Dart → mobile
- [ ] Super admin/analytics/flags → ops
- [ ] Tests needed → testing
- [ ] Code review needed → quality

### Sub-Tasks (ordered)
1. [task] → [agent] | Risk: low/medium/high
2. [task] → [agent] | Risk: low/medium/high
...

### Requires User Approval
- [ ] Yes: [reason] — STOP and ask before proceeding
- [ ] No — proceed autonomously

### Review Chains Triggered
- [file pattern] → [required reviewers per P14]
```

If user approval is required, STOP HERE and present the decomposition. Wait for confirmation before proceeding.

If no approval needed, proceed to Phase 2.

## Phase 2: Execute

Spawn the builder agents identified in Phase 1. Rules:
- Spawn independent agents in parallel (use multiple Agent tool calls in one message)
- Sequential dependencies: wait for the blocking agent to finish before spawning the next
- Give each agent a complete task prompt: what to do, which files, acceptance criteria, constraints
- Common sequences:
  - Schema change: architect first → then backend/frontend
  - Scoring change: assessment defines behavior → frontend implements → backend syncs RPC
  - AI change: ai-engineer implements → assessment reviews correctness
  - New feature: architect (schema) → backend (API) → frontend (UI)

## Phase 3: Verify

After all builders complete:
1. Spawn **testing** agent to write/run tests for all changed files
2. Wait for testing results
3. Spawn **quality** agent to run type-check, lint, test, build and review code
4. Wait for quality verdict

## Phase 4: Review Chains

Check which files were modified. For each file, look up required downstream reviewers in the P14 review chain matrix. Spawn any reviewer that hasn't been invoked yet.

Report:
```
### Review Chain Status
- [file] → chain: [name] → [reviewer] ✓ done | [reviewer] ✗ spawning now
```

## Phase 5: Report

Produce this final report:

```
## Execution Report: [task summary]

### What Was Done
- [agent]: [what it did, files changed]

### Test Results
- Tests: [n] passed, [n] failed
- Regression catalog gaps: [list if relevant]

### Quality Verdict
- Type check: PASS/FAIL
- Lint: PASS/FAIL
- Build: PASS/FAIL
- Code review: APPROVE / APPROVE WITH CONDITIONS / REJECT

### Review Chains
- [chain]: [all reviewers] ✓ complete | ✗ [missing]

### Gate Status
- Phase 1 (decompose): DONE
- Phase 2 (execute): DONE
- Phase 3 (verify): PASS/FAIL
- Phase 4 (review chains): COMPLETE/INCOMPLETE
- Phase 5 (report): THIS

### Remaining Items
- [anything that needs user action]
- [anything deferred]

### Ready to Commit: YES / NO — [reason if no]
```

If Ready to Commit is YES and user has approved (or no approval was needed), create the commit with a descriptive message and push to the current branch.
