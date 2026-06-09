# Phase 3C — White-Label Activation — Design

**Date:** 2026-06-09
**Status:** Approved (design)
**Owner sequence:** Phase 3A (Teacher) ✅ → Phase 3B (School/Admin) ✅ → **Phase 3C (White-Label)** ← this doc
**Predecessors:** `docs/superpowers/specs/2026-06-08-phase-3b-school-professional-depth-design.md`

## 1. Problem & scope

A "White-Label SaaS Foundation" (PR #558) shipped substantial substrate, but most of it is **dormant** because the four `ff_tenant_*` flags are not even registered in `src/lib/feature-flags.ts` `FLAG_DEFAULTS`. Ground truth:

| Capability | State |
|---|---|
| Branding (logo/colors/fonts/tagline) + domain resolution (subdomain + `custom_domain` via `src/proxy.ts`) | **WIRED & LIVE** — nothing to build |
| Module gating (`tenant_modules`, 9-module registry `src/lib/modules/registry.ts`, full resolver + admin toggles) | **BUILT but DORMANT** — `ff_tenant_module_registry_v1` orphaned → resolver no-ops (all modules always on) |
| Tenant config (`tenant_configs`: `ai.personality`/`ai.tone`/`ai.pedagogy`/`ai.default_language`, locale — full resolver `src/lib/tenant-config/index.ts` + ai-config page) | **BUILT but DORMANT** — `ff_tenant_config_v2` orphaned → defaults only, overrides ignored |
| Copy variants by `tenant_type` ("student"→"learner"/"employee", "school"→"coaching center"/"company") | **GREENFIELD** — nothing exists, all copy hardcoded |
| Event bus (`ff_event_bus_v1`, in-process EventEmitter) | **DORMANT** — internal architecture, not user-facing white-label |

**Scope (user-approved): A — machinery-wide activation + copy variants.** Register the four flags; activate the built-but-dormant module gating and tenant-config→Foxy consumption; and build the greenfield tenant-copy resolver wired into key surfaces — so any `tenant_type` (school/coaching/corporate/government) renders a genuinely white-labeled experience. All flag-gated, default OFF.

## 2. Non-goals

- **Event-bus activation** is deferred. Its flag is registered in Wave A (correctness) but left OFF; activating it fires real audit/PostHog/email side-effects that need subscribers verified first — a separate initiative.
- No new `tenant_type` values; no new RBAC roles/permissions; no changes to the quiz/scoring/XP/anti-cheat paths (P1/P2/P3 untouched).
- No re-build of branding/domain resolution (already live).
- No model/provider change (Wave B configures persona via bounded enums feeding the EXISTING Foxy prompt; it does not swap the model).

## 3. Architecture

Mostly **wiring, not building**. Reuses the dormant infra (`src/lib/modules/registry.ts`, `src/lib/tenant-config/index.ts`, `src/proxy.ts` resolution) and the live branding/domain layer. Three flag-gated waves; flag-OFF = today's behavior, byte-identical.

- **Flag registration (correctness):** add all four flags to `FLAG_DEFAULTS = false` in Wave A. Add one small idempotent root migration that seeds the four `feature_flags` rows (`is_enabled=false`) so prod (where the `_legacy/` seeds already ran) and fresh CI/staging agree on a replayable baseline.
- **Activation flags:** `ff_tenant_module_registry_v1` (A), `ff_tenant_config_v2` (B), `ff_tenant_type_v1` (C).

## 4. Waves

### Wave A — Flag registration + module-gating activation (autonomous)

**What:**
- Register all four `ff_tenant_*` flags in `FLAG_DEFAULTS` (false) + one idempotent migration seeding the four `feature_flags` rows.
- Activate module gating: a module disabled in `tenant_modules` (resolver `isModuleEnabled`/`enabledModulesFor`, already built) must hide its nav entry AND **enforce at the route layer** — a request to a disabled module's route returns 404/redirect, not just a hidden toggle. The school-admin nav already module-tags some items; Wave A adds the route-layer guard.
- Behind `ff_tenant_module_registry_v1` (default OFF → resolver returns all-enabled → byte-identical to today).

**Approval:** none (autonomous — no new RBAC; flag-OFF = all modules on). **Schema:** 1 idempotent flag-seed migration. **Flag:** `ff_tenant_module_registry_v1`. **Catalog:** REG-100.

### Wave B — Tenant-config → Foxy AI consumption (APPROVAL: AI-persona sign-off)

**What:**
- Wire the tenant-config resolver (`ai.personality` / `ai.tone` / `ai.pedagogy` / `ai.default_language`) into the Foxy system prompt so a tenant's configured persona actually changes how Foxy addresses students. The resolver + ai-config admin page + prompt hooks (`src/lib/ai/prompts/`) already exist; Wave B activates consumption end-to-end.
- Behind `ff_tenant_config_v2` (default OFF → registry defaults only → byte-identical).

**Approval gate (before building):** present the per-`tenant_type` AI-persona matrix (the `CONFIG_DEFAULTS` already in `src/lib/tenant-config/index.ts`) for sign-off, since it changes how Foxy talks to students.

**P12 AI safety:** persona/tone/pedagogy are bounded enums; every variant stays age-appropriate (grades 6-12), within CBSE scope, and respects daily usage limits unchanged. ai-engineer + assessment review.

**Approval:** **YES** (soft — AI-persona matrix). **Schema:** none. **Flag:** `ff_tenant_config_v2`. **Catalog:** REG-101.

### Wave C — Tenant-copy variants (GREENFIELD; APPROVAL: copy-lexicon sign-off)

**What:**
- Build `src/lib/tenant-copy/` resolver: a copy lexicon per `tenant_type` for the high-impact nouns (student↔learner↔employee↔officer; class↔batch↔team↔department; school↔coaching center↔company↔department; principal↔director↔manager↔administrator), in BOTH English and Hindi (P7).
- Wire the resolver into the high-impact surfaces only (dashboard, nav, reports, Foxy greetings, school-admin labels) — not every string. Default tenant_type='school' keeps today's exact words.
- Behind `ff_tenant_type_v1` (default OFF → current hardcoded copy → byte-identical).

**Approval gate (before building):** present the proposed copy lexicon (the word table per tenant_type, both languages) for sign-off before wiring.

**Approval:** **YES** (soft — copy lexicon). **Schema:** none. **Flag:** `ff_tenant_type_v1`. **Catalog:** REG-102.

## 5. Data flow

```
Resolution (already live):  host -> proxy.ts -> school (slug | custom_domain) -> x-school-* headers + branding

Wave A:  tenant_modules + registry.ts -> isModuleEnabled(school, tenant_type, module)
         -> nav hides disabled  +  route guard 404s disabled   [gated ff_tenant_module_registry_v1]

Wave B:  tenant_configs + tenant-config/index.ts -> getTenantConfig(ai.*)
         -> Foxy system prompt persona/tone/pedagogy/language   [gated ff_tenant_config_v2]

Wave C:  tenant_type -> tenant-copy/index.ts -> t(noun, tenant_type, isHi)
         -> dashboard / nav / reports / Foxy greeting / admin labels   [gated ff_tenant_type_v1]
```

## 6. Error handling

- **Disabled-module route (A):** server returns 404/redirect; the resolver fail-opens to all-enabled when the flag is OFF or on resolver error (never accidentally lock a tenant out of a module).
- **Tenant-config read (B):** on missing/invalid override or flag OFF, fall back to the per-tenant_type default (the resolver already validates via zod). Foxy never receives an unbounded persona string.
- **Copy resolver (C):** unknown tenant_type or missing key falls back to the `school` lexicon (today's words). Never renders a key name or blank.
- **Flag OFF:** all three waves behave as if absent; every surface renders exactly as today.

## 7. Invariants & risk

| Invariant | How preserved |
|---|---|
| P1/P2/P3 score/XP/anti-cheat | No quiz path touched; per-wave empty-diff check. |
| P7 bilingual | Copy variants supplied in Hi + En per tenant_type. |
| P9 RBAC | No new permission; module/config admin reuses existing school-admin auth. |
| P10 bundle | Copy resolver is a small static lookup; lazy-load where a surface would grow. |
| P12 AI safety | Wave B personas are bounded enums, age-appropriate, CBSE-scoped; daily limits unchanged; ai-engineer + assessment review. |
| P13 privacy | No new PII; tenant config carries no student data. |

**Schema-reproducibility:** the dormant tenant migrations live in `_legacy/` (already on prod, not replayed on fresh DBs). Wave A adds a small idempotent root migration that seeds the four flag rows so prod and fresh CI/staging agree. No forward-refs to `_legacy/` tables; replays clean on a fresh Supabase Preview.

## 8. Testing

- Wave A: module-gating resolver (flag-ON disables nav + route 404; flag-OFF all-enabled byte-identical; resolver fail-open on error). REG-100.
- Wave B: tenant-config → Foxy prompt reflects persona/tone/pedagogy/language for each tenant_type; flag-OFF defaults byte-identical; P12 bounds (no unbounded persona). REG-101.
- Wave C: copy resolver returns the right noun per tenant_type in both languages; school default == today's words; unknown-key fallback; flag-OFF byte-identical. REG-102.
- Full suite green; P10 bundle; review chain per P14 (Wave A: architect+backend+frontend; Wave B: ai-engineer+assessment; Wave C: frontend+assessment for copy correctness; testing+quality each wave).

## 9. Sequencing

A (autonomous, ships start-to-finish) → **B (pause for AI-persona sign-off)** → **C (pause for copy-lexicon sign-off)**. Each its own PR, flag-gated, default OFF.

## 10. Regression catalog

| ID | Wave | Asserts |
|---|---|---|
| REG-100 | A | Module gating: flag-ON nav-hide + route-404 for disabled module; flag-OFF all-enabled byte-identical; fail-open |
| REG-101 | B | Tenant-config → Foxy persona/tone/pedagogy/language per tenant_type; flag-OFF defaults; P12 bounded enums |
| REG-102 | C | Tenant-copy lexicon per tenant_type (Hi/En); school default == today; flag-OFF byte-identical; fallback |

Total catalog after 3C: 67 (after 3B) → **70**.
