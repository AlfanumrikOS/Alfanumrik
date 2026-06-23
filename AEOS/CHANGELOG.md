# AEOS Changelog

All notable changes to the Alfanumrik Engineering Operating System (AEOS) are recorded here.
Format is Keep-a-Changelog flavored, using this repository's dated-header style.
AEOS follows Semantic Versioning; see `ROADMAP.md` for release scope.

## 2026-06-23 - v2.0.0

### Added

- Autonomy layer of 11 documents across three new top-level folders (`autonomy/`, `memory/`, `enterprise/`) - the "Governed Autonomous Engineering" release.
- Autonomy (`autonomy/`): `multi-agent-orchestration.md`, `specialized-agents.md`, `agent-governance.md`, `autonomous-planning.md`, `autonomous-verification.md`, `autonomous-architecture-review.md`.
- Memory (`memory/`): `engineering-memory.md`, `knowledge-graph.md`.
- Enterprise (`enterprise/`): `enterprise-governance.md`, `executive-reporting.md`, `platform-evolution.md`.
- `VERSION` bumped to 2.0.0 (MAJOR: governed autonomous engineering).

### Notes

- The change is additive and backward-compatible: v1.0 (30 core docs + authority layer + 8 extensions) and v1.1 (12 operational docs) remain intact. The docs bridge to the real agent substrate already in the repository (root `agents/` L1-L8 mesh + `.claude/` agents/skills/hooks). Product invariants P1-P15 and human-approval gates remain supreme above all autonomy. All cross-references validated (0 internal dangling; external refs point to real repository files).

## 2026-06-23 - v1.1.0

### Added

- Operational layer of 12 documents across four new top-level folders (`playbooks/`, `runbooks/`, `guides/`, `checklists/`), turning the v1.0 standards into day-to-day operating practice.
- Playbooks (`playbooks/`): `ai-workflows.md`, `prompt-engineering.md`, `ai-evaluation.md`, `mcp-playbooks.md`.
- Runbooks (`runbooks/`): `aws-operations.md`, `github-operations.md`, `sre.md`, `disaster-recovery.md`, `supabase-operations.md`.
- Guides (`guides/`): `optimization.md`, `performance-tuning.md`.
- Checklists (`checklists/`): `operational-checklists.md`.
- `VERSION` bumped to 1.1.0.

### Notes

- The operational layer builds on the v1.0 standards: v1.0 defines how to engineer well, v1.1 defines how to run, operate, optimize, and recover the platform.
- All cross-references validated (0 dangling; one valid external link to `docs/runbooks/schema-reproducibility-fix.md`). The v1.0 corpus (30 core docs + authority layer + 8 extensions) remains intact.

## 2026-06-23 - v1.0.0

### Added

- AEOS product structure: `VERSION`, `README.md`, `CLAUDE.md` (authority entry-point), `ROADMAP.md`, and `CHANGELOG.md`.
- All 30 core engineering documents: 00 (AI_CONSTITUTION) and 01-29 (ROLE_DEFINITION through CONTINUOUS_IMPROVEMENT), platform-agnostic.
- Authority layer: `MASTER_SYSTEM_PROMPT.md` (Authority #2) and `EXECUTION_ENGINE.md` (Authority #3 - canonical execution loop).
- Eight platform extension modules under `docs/extensions/`: `anthropic.md`, `aws.md`, `cloudfront.md`, `ecs.md`, `github-actions.md`, `razorpay.md`, `supabase.md`, `vercel.md`.
- Directory layout: `docs/` for platform-agnostic core docs and `docs/extensions/` for platform/vendor binding modules.

### Notes

- M5 release commit landed and the git tag `aeos-v1.0.0` was cut.
- Migrated from the interim `alfanumrik-ai-harness/` folder into `AEOS/`.
- Diagram glyphs ASCII-normalized (no Unicode arrows, checkmarks, or box-drawing characters).
- M4 validation detected and fixed 3 dangling cross-references across the corpus.

**End of Document**
