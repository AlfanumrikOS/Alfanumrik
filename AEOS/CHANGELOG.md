# AEOS Changelog

All notable changes to the Alfanumrik Engineering Operating System (AEOS) are recorded here.
Format is Keep-a-Changelog flavored, using this repository's dated-header style.
AEOS follows Semantic Versioning; see `ROADMAP.md` for release scope.

## 2026-06-23 - v1.0.0

### Added

- AEOS product structure: `VERSION`, `README.md`, `CLAUDE.md` (authority entry-point), `ROADMAP.md`, and `CHANGELOG.md`.
- All 30 core engineering documents: 00 (AI_CONSTITUTION) and 01-29 (ROLE_DEFINITION through CONTINUOUS_IMPROVEMENT), platform-agnostic.
- Authority layer: `MASTER_SYSTEM_PROMPT.md` (Authority #2) and `EXECUTION_ENGINE.md` (Authority #3 - canonical execution loop).
- Eight platform extension modules under `docs/extensions/`: `anthropic.md`, `aws.md`, `cloudfront.md`, `ecs.md`, `github-actions.md`, `razorpay.md`, `supabase.md`, `vercel.md`.
- Directory layout: `docs/` for platform-agnostic core docs and `docs/extensions/` for platform/vendor binding modules.

### Pending

- M5 release commit and git tag (`aeos-v1.0.0`).

### Notes

- Migrated from the interim `alfanumrik-ai-harness/` folder into `AEOS/`.
- Diagram glyphs ASCII-normalized (no Unicode arrows, checkmarks, or box-drawing characters).
- M4 validation detected and fixed 3 dangling cross-references across the corpus.

**End of Document**
