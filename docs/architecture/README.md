# Architecture documentation

Evidence-based architecture docs for the Alfanumrik Learning OS.

**Every claim in every doc here must be traceable to a file path,
line number, migration name, or function signature in this repo.**
If a claim cannot be grounded in real artefacts, it does not belong
in these documents. This is an explicit reaction to the prior
generic-essay versions (abandoned in
`quarantine/feat-performance-score-system-pre-option-c-20260424`)
which referenced fictional subdomains like `identity.alfanumrik.com`,
invented API gateways the project does not run, and contradicted
existing product invariants.

| # | Doc | Owner | Status |
|---|---|---|---|
| 1 | [`CURRENT_ARCHITECTURE_AUDIT.md`](./CURRENT_ARCHITECTURE_AUDIT.md) | orchestrator | v1 |
| 2 | [`DOMAIN_BOUNDARIES.md`](./DOMAIN_BOUNDARIES.md) | architect | v1 |
| 3 | [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md) | architect | v1 |
| 4 | [`API_CONTRACTS_MATRIX.md`](./API_CONTRACTS_MATRIX.md) | backend | v1 |
| 5 | [`EVENT_CATALOG.md`](./EVENT_CATALOG.md) | architect | v1 |
| 6 | [`RISK_REGISTER.md`](./RISK_REGISTER.md) | orchestrator | v1 |
| 7 | [`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md) | orchestrator | v1 |
| 8 | [`MIGRATION_AND_ROLLBACK_PLAN.md`](./MIGRATION_AND_ROLLBACK_PLAN.md) | architect | v1 |

All versions are a snapshot of 2026-04-24. Revise when architecture
materially changes, not on a schedule.

## Document conventions

- **File paths are relative to repo root.** `src/lib/xp-rules.ts` means
  the file at that path; `supabase/functions/foxy-tutor/index.ts` means
  the Deno Edge Function.
- **Migrations are cited by filename** (the full timestamped filename
  in `supabase/migrations/`), not by a number or description.
- **Invariants** are cited as `P1` through `P15` with the numbering
  from [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).
- **Uncertainty is stated explicitly**: "not audited", "inferred from",
  "unverified", "would require X to confirm".
- **No fictional infrastructure.** If we don't run it today, don't
  describe it as if we did. Future plans belong in
  [`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md)
  with explicit "proposed, not implemented" labels.

## See also (existing docs in this directory)

Complementary references — older in date, more narrowly scoped, but
still useful:

- [`current-state.md`](./current-state.md) — 2026-04-02 snapshot of
  the stack with exact dependency versions. Reliable for version /
  config questions; stale for route counts (numbers rechecked in
  [`CURRENT_ARCHITECTURE_AUDIT.md`](./CURRENT_ARCHITECTURE_AUDIT.md)).
- [`target-state.md`](./target-state.md) — 2026-04-02
  `[IMPLEMENTED] / [PLANNED]` goal register. Useful for tracking
  which production-hardening items are done; not a service-extraction
  roadmap.
- [`routing-inventory.md`](./routing-inventory.md) — 2026-04-02
  route-by-route breakdown. More detailed per route than
  [`API_CONTRACTS_MATRIX.md`](./API_CONTRACTS_MATRIX.md); use it when
  you need to know what middleware runs on a specific path.
- [`database-schema.md`](./database-schema.md) — column-level
  description of the 25 foundational tables from the legacy base
  migration. The current DB has > 80 tables and 309 migrations;
  this doc is the starting reference only.
- [`engineering-roadmap.md`](./engineering-roadmap.md) — 30/60/90
  day plan from 2026-04-02. Most items complete; read as history,
  not active backlog.

The 8 documents listed above are the **evidence-based set required by
the architectural brief**; they sit alongside (not replacing) those
older references.

## Revision history

- **2026-04-24 v1** — initial evidence-based set, written on branch
  `feat/stabilization-phase-0` after abandoning
  `feat/performance-score-system`. See
  [`../stabilization-phase-0-memo.md`](../stabilization-phase-0-memo.md)
  for the cleanup audit trail.
