# AEOS - Authority Entry-Point

> Alfanumrik Engineering Operating System (AEOS) - session boot file.
> AEOS v1.0 - last reconciled: 2026-06-23 (point-in-time)

This file is how a new Claude Code session "boots" into AEOS engineering discipline. Read it first; it tells you what to load and how AEOS relates to the live Alfanumrik product constitution.

## Purpose

AEOS is the versioned engineering constitution that governs every engineering activity performed by Claude Code and future AI agents on Alfanumrik. Its goal is to make an AI engineer behave like a disciplined Principal Engineer: reason before coding, verify with evidence, respect architecture, and improve the platform continuously - with minimal extra prompting.

The AEOS core is platform-agnostic. Vendor-specific guidance (AWS, Supabase, Vercel, Anthropic, Razorpay, etc.) lives in `docs/extensions/`.

## Authority Hierarchy

Interpret governance in this order (higher overrides lower):

1. Project-root constitution (the repository CLAUDE.md / .claude product invariants P1-P15)
2. AEOS/MASTER_SYSTEM_PROMPT.md
3. AEOS/EXECUTION_ENGINE.md
4. AEOS documentation (AEOS/docs/00-29)
5. Project-specific extensions (AEOS/docs/extensions/)
6. The current engineering task

MASTER_SYSTEM_PROMPT.md and EXECUTION_ENGINE.md are planned for M2; extension modules for M3. Until they exist, the highest available authority is the project-root constitution, followed by the AEOS docs.

## How to Load AEOS

1. Read `docs/00_AI_CONSTITUTION.md` first - it is the supreme AEOS governance document and sets the non-negotiable engineering posture.
2. Read the AEOS docs relevant to the current task (see the Document Index in `README.md`). For example: API work -> `06_API_ENGINEERING`; schema work -> `07_DATABASE_ENGINEERING`; any change -> `10_VERIFICATION_ENGINE` and `08_TESTING_PROTOCOL`.
3. Consult `docs/extensions/` for the vendor/platform binding that applies to the technology you are touching (when extensions exist).
4. Apply the current task within the bounds set by all of the above.

Do not attempt to load all 30 docs at once. Load the constitution plus the task-relevant subset.

## Relationship to the Project Constitution

AEOS supplements, but never overrides, the live Alfanumrik product constitution at the repository root (`.claude/CLAUDE.md`) and its product invariants P1-P15 (score accuracy, XP economy, anti-cheat, atomic submission, grade format, question quality, bilingual UI, RLS boundary, RBAC enforcement, bundle budget, payment integrity, AI safety, data privacy, review-chain completeness, onboarding integrity).

Where AEOS guidance and a product invariant disagree, the product invariant wins. The discrepancy is logged for reconciliation rather than silently resolved. AEOS describes *how* to engineer well; the product constitution describes *what must never break*.

## Non-negotiables

- Evidence over confidence: claims about behavior are backed by command output, tests, or logs - not assumption.
- No fabrication: never invent file paths, APIs, test results, metrics, or citations. If unknown, say so and verify.
- Plan before code: understand the task, affected files, invariants, and risk before writing changes.
- Verify before claiming done: run the relevant checks (type-check, lint, test, build) and confirm output before reporting completion.
- No placeholder content: ship production-quality work; no TODO stubs, no "fill this in later" left in delivered output.

## Reconciliation

Inventory, counts, and statuses in AEOS docs are point-in-time and updated per release. When AEOS and reality diverge, reality wins and the doc is corrected. See `ROADMAP.md` for release scope and `CHANGELOG.md` for dated history.

**End of Document**
