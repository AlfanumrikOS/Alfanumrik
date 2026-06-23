# Runbook: CI Integration-DB false-red + AEOS coordination race

**Date:** 2026-06-23
**Owner:** ops
**Status:** Active — two coordination/CI issues tracked below, plus carry-forward items.

This runbook captures two operational issues discovered today and the carry-forward
items surfaced alongside them, so they are tracked and actionable.

---

## 1. CI "Integration Tests (live DB)" false-red

| Field | Detail |
|---|---|
| **Symptom** | Every PR's "Integration Tests (live DB)" check fails. e2e tests under `src/__tests__/migrations/*-e2e.test.ts` assert `expected false to be true` with messages like `"no foxy_session / chapter_concepts to reuse on this DB"`. |
| **Root cause** | The integration-lane CI job runs against a **seed-less CI/preview Supabase DB** (project `gzpxqklxwzishrkiaatd`), **NOT** the linked prod DB (`shktyoxqhundlvkiwguu`) where migrations are verified. The e2e tests need seed fixtures (students with `concept_mastery`, `foxy_session`, `chapter_concepts`, quiz data) that the CI DB doesn't have. The tests self-skip when CREDS are absent, but **hard-fail when creds are present + data is absent**. |
| **Severity** | **NON-BLOCKING.** Not a required check; `mergeState UNSTABLE` is not blocked. PRs #1104 / #1105 / #1110 / #1112 all merged through it. The always-on **STRUCTURAL pins (no DB)** are the real gate; migrations are verified against the linked DB directly by architect. |
| **Fix shipped (this change)** | e2e tests now **SKIP-on-missing-substrate** instead of asserting-fail (testing). |

### Remaining options for full green
- **(a)** Seed the CI integration DB with a minimal fixture set.
- **(b)** Keep skip-on-missing-substrate **and** formally mark the check **non-required** in branch protection.

**Recommendation:** (b) short-term; (a) once a seeded staging-mirror exists.

---

## 2. Two autonomous layers sharing one working tree (AEOS race)

| Field | Detail |
|---|---|
| **Symptom** | The "AEOS v2.0 governed autonomous engineering layer" automation concurrently committed the orchestrator's uncommitted agent-produced files onto **its own** branches/PRs (e.g. PR #1112 bundled the dashboard migration with B2B flags; PR #1113 bundled NCERT ingestion), and reset the shared checkout to `main` mid-workflow — causing a quality **REJECT** (files no longer on disk) and a failed clean-PR attempt (filename collision on `20260623000800`). |
| **Root cause** | Both the interactive orchestrator and the AEOS automation operate on the **SAME git working tree**, racing during the create → gate → commit window. |

### Recommendation
- Give the AEOS layer its **own git worktree** (`git worktree add`) or a separate clone, so the two never share an index/checkout.
- **Alternatively:** gate AEOS to act only on already-committed branches, never the live working tree of an interactive session.

### Interim operating rule
- When both layers are active, **commit agent output to a feature branch immediately** after each agent returns (minimize the uncommitted window).
- If files vanish, **recover from the AEOS-captured PR** rather than recreating (avoids filename collisions).

---

## 3. Carry-forward items surfaced today

| Item | Detail | Owner |
|---|---|---|
| **B2B flags default-OFF** | Seeded default-OFF in PR #1112 (`20260623010000`). `ff_principal_ai_v1` owes **ai-engineer P12 + ops** review before enablement; other B2B flags owe an **ops flip-procedure** review. | ai-engineer + ops |
| **PGRST203 overload ambiguity** | The 6-arg JSONB `atomic_quiz_profile_update` overload is unreachable via PostgREST (overload ambiguity). The live funnel uses the 7-arg `PERFORM` path (fixed in `20260623000600`). Cleanup: rename params or drop the redundant overload. | backend |
| **Flag ramps at 10%** | `ff_adaptive_live_selection_v1` + `ff_tutor_bkt_v1` → ramp 10 → 50 → 100 after a monitoring window. | ops |
| **Dashboard / progress source migration** | `get_dashboard_data` + progress surfaces now derive from `concept_mastery` (REG-135 / REG-136). The empty `bloom_progression` / `knowledge_gaps` / `topic_mastery` tables are now **unused by reads** — candidate for a future **user-approved drop**. | architect (drop) / assessment (metric) |
