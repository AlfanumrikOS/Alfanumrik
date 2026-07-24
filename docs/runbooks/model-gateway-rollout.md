# Runbook: Model Gateway (L2) Rollout — `ff_model_gateway_v1`

- **Status:** Operational runbook (Phase 1 of the GenAI ecosystem blueprint)
- **Date:** 2026-07-24
- **Owner:** ops (flip procedure + telemetry) with ai-engineer (gateway behavior) and architect (flag/migration)
- **Flag:** `ff_model_gateway_v1` — default **OFF**, seeded by `supabase/migrations/20260724120000_seed_ff_model_gateway_v1.sql`
- **Blueprint:** `docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md` (Section 7, Section 12)
- **Sibling LLD:** `docs/superpowers/specs/2026-07-24-model-gateway-design.md` (ai-engineer)

---

## 0. What this flag does

- **OFF (default):** the Model Gateway reproduces today's **Anthropic-primary** behavior **byte-for-byte** — every request routes to the current default Claude model with the current prompt/params. Merging + wiring the gateway is a zero-behavior change. No alternate provider (e.g. Gemini) and no non-default routing policy is reachable.
- **ON:** the gateway's **non-default routing policies** are permitted (policy-based model selection, cost-tier routing, prompt-caching tiers).

**This flag gates ROUTING POLICY only.** It does **not** authorize a new model or provider. See Section 6.

---

## 1. Pre-flight (before any flip)

- [ ] Migration `20260724120000_seed_ff_model_gateway_v1.sql` is applied (row exists, `is_enabled=false`, `rollout_percentage=0`).
- [ ] ops confirms whether `ff_model_gateway_v1` should be added to `EXPECTED_OFF_FLAGS` in `packages/lib/src/flags/protected-flags.ts` so the default-OFF canary accounts for the new row (ops-owned; not edited by architect).
- [ ] ai-engineer confirms the gateway is wired with the OFF path proven byte-identical to legacy (parity fixtures pass).
- [ ] Baseline telemetry captured for 24h with flag OFF: p50/p95 latency, cost/request, error rate, per-model call counts (`mol_request_logs`).

---

## 2. Enable in STAGING

1. In staging super-admin console, flip `ff_model_gateway_v1` → ON (or set a small `rollout_percentage`).
2. Drive synthetic traffic across surfaces (Foxy `/api/foxy`, quiz-generator, ncert-solver) covering all Foxy modes.
3. Hold for a defined soak window (recommend ≥ 24h of synthetic + internal traffic).

**Do NOT enable non-default routing on live student traffic without CEO approval (Section 6).**

---

## 3. Telemetry to watch

| Signal | Source | Watch for |
|---|---|---|
| Cost / request | `mol_request_logs`, trace-logger (`packages/lib/src/ai/tracing/`) | No unexpected cost increase vs OFF baseline |
| Latency p50/p95 | `mol_request_logs`, PostHog, Sentry | Within bom1 4G budget; no regression vs baseline |
| Model provenance | `mol_request_logs` | Only approved model(s) invoked; NO unapproved provider |
| Error / abstain rate | Sentry (edge/server), Foxy structured envelope | No rise in errors, abstains, or grounding failures |
| Cache hit rate | trace-logger / gateway metrics | Prompt-cache + cache-tier hits behave as designed (Section 10 of blueprint) |
| Safety screens | audit_logs (`alfabot.*`/foxy actions, metadata-only) | No scope-lock / curriculum-guard regressions |

---

## 4. Parity checks

- **Byte-identity (OFF):** with flag OFF, the model request (model id, prompt, params) must be identical to the pre-gateway legacy path. Fixture/regression must pass.
- **Semantic parity (ON, default policy):** with flag ON but the default policy selected, responses must match the OFF path within tolerance (same model, same grounding). REG-50 single-retrieval contract must still hold (≤1 `retrieveChunks`/turn).
- **No mastery writes:** confirm no gateway path writes any mastery/progression surface (the WHAT-vs-HOW contract, blueprint Section 2). GenAI is HOW-only.

---

## 5. Rollback (instant)

1. Flip `ff_model_gateway_v1` → **OFF** in the super-admin console.
2. The read path (`isFeatureEnabled`) returns false for `is_enabled=false` OR `rollout_percentage<=0` → the gateway immediately reverts to Anthropic-primary legacy behavior. **No deploy required.**
3. If needed, hard DOWN: `DELETE FROM feature_flags WHERE flag_name = 'ff_model_gateway_v1';` — the app resolves a missing flag to OFF (legacy behavior). This does not remove the code seam.
4. File a Sentry/incident note with the telemetry delta that triggered rollback.

Rollback drains, does not freeze: in-flight requests complete on whichever path they started; new requests take the legacy path.

---

## 6. CEO approval gates (hard stops)

Per the product constitution, the following require **CEO approval** and are **NOT** unlocked by this flag alone:

- **Enabling non-default routing on LIVE student traffic** (beyond staging/synthetic).
- **Wiring a second provider (e.g. Gemini)** — an AI model/provider change.
- Any pricing change, new CBSE subject, P1–P13 change, or DROP op touched along the way.

`ff_model_gateway_v1` enables the *mechanism*; the *policy decisions* above remain CEO-gated.

---

## 7. Contacts / ownership

- **Flag flip + telemetry:** ops
- **Gateway behavior / parity fixtures:** ai-engineer (`packages/lib/src/ai/gateway/**`)
- **Migration / flag seed / boundary review:** architect
