# FOX-4 — OpenAI MoL Shadow Governance — STATUS

**FOX-4 LANDED — govern-with-flag; MoL OpenAI shadow confirmed already-governed (default-OFF, never
student-facing, PII-safe, cost-capped) + safety invariants pinned REG-197; no app change.**

| Field | Value |
|---|---|
| Status | **LANDED — GOVERN-WITH-FLAG** (not remove) |
| Cycle / workflow | Cycle 4 — foxy-ai-rag (P12) |
| Date | 2026-06-29 |
| App code changed | **NONE** (`mol-shadow.ts` / `claude.ts` / `pipeline*.ts` / flags untouched) |
| Student-facing model | Claude (Anthropic Haiku) — unchanged, sole student-facing model |
| Provider change? | NO — telemetry-only shadow; no P12 model/provider user-gate triggered |
| Flags | `ff_grounded_answer_mol_shadow_v1` + `ff_mol_shadow_text_capture_v1` — both default OFF, seeded OFF |
| Regression pin | REG-197 (catalog → 164) — testing-owned, concurrent |
| O1 | CORRECTED — safety tests already run in the default `npm test` lane per-PR (`vitest.config.ts:66` default `else` branch + `ci.yml:232` hard gate); integration job `ci.yml:386-398` is secret-gated/skips |
| Deferrals | assessment P12 scope confirm (O3); O2 student_id defense-in-depth (low); runbook `docs/MOL_C4_SHADOW_RUNBOOK.md §6-7` |
| Docs | `01-design.md` (governance design), `02-validation.md` (closure) |
