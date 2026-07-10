# Claude to Codex Handover - Alfanumrik

## Existing state
This repository was previously developed with Claude Code. Codex must first understand the current system before editing.

## Immediate priorities
1. Fix broken end-user actions:
   - Git it
   - Explain Simpler
   - Show Example
   - Quiz Me
   - Save to Notebook
   - Report an Issue
2. Reduce Foxy AI Tutor UI clutter and overflow.
3. Verify adaptive intelligence runtime wiring:
   - Spaced repetition
   - DKT
   - IRT
   - CME
   - Adaptive paths
   - Adaptive quiz generation
4. Find feature flags that are OFF, hardcoded, commented, or disconnected.
5. Verify frontend -> API -> DB -> AI flow.

## Known risks
- Features may exist in code but not runtime.
- Some tests may check source text instead of real behavior.
- Mastery/adaptive state may be split across multiple stores.
- Feature flags may silently disable important learning logic.
- UI actions may be present but not wired.

## First Codex mission
Perform a read-only architecture and runtime wiring audit. Do not edit files until root causes are proven.
Read AGENTS.md and engineering-audit/CODEX_HANDOVER.md first.

Then perform a read-only audit of the current Alfanumrik repository.

Goal:
Find where Claude Code left incomplete, disconnected, hardcoded, or non-production features.

Focus areas:
1. Foxy AI Tutor actions: Git it, Explain Simpler, Show Example, Quiz Me, Save to Notebook, Report an Issue.
2. Adaptive intelligence runtime: spaced repetition, DKT, IRT, CME, adaptive paths, adaptive quiz generation.
3. Feature flags that disable important behavior.
4. APIs returning placeholders, mock data, swallowed errors, or disconnected DB writes.
5. UI issues causing overflow, hidden controls, or broken interaction.

Rules:
- Do not edit files yet.
- Provide evidence with file paths and exact functions/components.
- Classify each issue as P0, P1, P2.
- End with a minimal fix sequence.
