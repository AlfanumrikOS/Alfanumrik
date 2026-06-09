# Phase 3C Implementation Plan — White-Label Activation

- **Spec:** `docs/superpowers/specs/2026-06-09-phase-3c-white-label-activation-design.md`
- **Date:** 2026-06-09
- **Sequencing:** Waves ship in order A → B → C, each its own PR through the review chain (builder → testing → quality), each behind a feature flag (default OFF). This plan details **Wave A** fully; B/C are outlined and expanded into step lists when their turn comes. B and C each open with a soft sign-off gate (AI-persona matrix; copy lexicon).

## Conventions
- Path alias `@/*` → `src/*`. Three Supabase clients used strictly per their boundaries.
- Reuse the EXISTING dormant infra — do not rebuild: `src/lib/modules/registry.ts` (module resolver), `src/lib/tenant-config/index.ts` (config resolver), `src/proxy.ts` (host→tenant resolution), the live branding layer.
- No new scoring/XP/anti-cheat math. Verify per wave: `git diff origin/main -- src/lib/xp-rules.ts src/lib/score-config.ts src/lib/quiz/submit-side-effects.ts` returns empty.
- Bilingual (P7) on all new user-facing copy via `AuthContext.isHi`. Technical terms not translated.
- TDD: failing test first for every resolver branch, route guard, and copy lookup; watch it fail; then implement.

## Cross-cutting engineering standards (scalable · stable · clean · optimum runtime)
Checked at every quality gate.

**Scalable** — module/config/copy resolution is O(1) static-lookup or a single cached DB read (reuse the resolvers' existing caching); no per-render DB calls; no N+1. The copy resolver is a static lexicon (no DB).
**Stable** — flag-gated, default OFF; flag-OFF byte-identical; resolvers FAIL-OPEN (module gating error → all-enabled; config error → default; copy miss → `school` lexicon) so activation can never lock a tenant out or render a key name. The flag-seed migration is idempotent + self-contained (no `_legacy/` forward-refs).
**Clean workflows** — one resolver per concern, reused everywhere; route guards are thin; copy is read through a single `t(noun, tenant_type, isHi)` entry point, never inlined per-tenant conditionals in components.
**Optimum runtime** — resolvers cached (reuse existing 5-min/static caches); copy lexicon bundled (tiny); no added network round-trips on the hot path.

## Wave A — Flag registration + module-gating activation (autonomous)

### A1 — Flag registration + seed migration (architect; ops reviews flag registry)
- Add a `WHITE_LABEL_FLAGS` const + register ALL FOUR flags in `FLAG_DEFAULTS = false` in `src/lib/feature-flags.ts`: `ff_tenant_type_v1`, `ff_tenant_module_registry_v1`, `ff_tenant_config_v2`, `ff_event_bus_v1` (event bus registered for correctness, left OFF — NOT activated this phase).
- Add one idempotent root migration `supabase/migrations/<next-ts>_phase3c_seed_white_label_flags.sql` seeding the four `feature_flags` rows (`is_enabled=false`) via `INSERT ... ON CONFLICT DO NOTHING`, matching the existing flag-seed pattern. Self-contained; replays clean on fresh Preview. (The `_legacy/` seeds already created these on prod; ON CONFLICT makes this a no-op there.)

### A2 — Module-gating resolver wiring + route guard (backend)
- The resolver `isModuleEnabled(schoolId, tenantType, moduleKey)` / `enabledModulesFor(...)` already exists (`src/lib/modules/registry.ts`) and already short-circuits to all-enabled when `ff_tenant_module_registry_v1` is OFF. Wire ENFORCEMENT:
- Build a thin route guard that, for a route owned by a module (map via the registry `routePrefix`), resolves the active school (from the proxy-injected `x-school-id` / the caller's school) and 404s/redirects when that module is disabled. Apply at the school-admin module-owned routes first (the surface where modules are the operating concept); reuse the resolver so student-facing enforcement can adopt the same guard later (note any student-facing route left for a follow-up). FAIL-OPEN: flag OFF or resolver error → allow.

### A3 — Nav module-gating (frontend)
- The consolidated school-admin nav (`src/app/school-admin/_components/ConsolidatedSchoolNav.tsx`) already module-tags some items. When `ff_tenant_module_registry_v1` is ON, hide nav entries whose module is disabled for the school (use `enabledModulesFor`); when OFF, render today's full nav (byte-identical). Loading/empty states preserved. P7 unaffected (no new copy).

### A4 — Tests (testing)
- Resolver: flag-ON with a disabled module → `isModuleEnabled=false`; flag-OFF → all-enabled (byte-identical); resolver error → fail-open all-enabled.
- Route guard: disabled module route → 404/redirect when ON; allowed when OFF; fail-open on error.
- Nav: disabled module hidden when ON; full nav when OFF.
- One regression-catalog entry REG-100.

### A5 — Gate (quality)
- type-check / lint / build / bundle (P10); review chain (architect + backend + frontend + testing); flag-OFF byte-identical verified; verdict; merge when green.

## Wave B — Tenant-config → Foxy AI consumption (outline; APPROVAL: AI-persona sign-off)
Open with the AI-persona matrix sign-off (the `CONFIG_DEFAULTS` per `tenant_type` in `src/lib/tenant-config/index.ts`). Then: wire `getTenantConfig(ai.personality|ai.tone|ai.pedagogy|ai.default_language)` into the Foxy system prompt (`src/lib/ai/prompts/`) so the configured persona changes Foxy's behavior; flag-OFF → registry defaults (byte-identical). P12: bounded enums, age-appropriate, CBSE scope, daily limits unchanged. Behind `ff_tenant_config_v2`. REG-101. Review chain: **ai-engineer + assessment** (correctness/safety), testing, quality.

## Wave C — Tenant-copy variants (outline; GREENFIELD; APPROVAL: copy-lexicon sign-off)
Open with the copy-lexicon sign-off (word table per `tenant_type`, Hi + En). Then: build `src/lib/tenant-copy/index.ts` (static lexicon + `t(noun, tenant_type, isHi)`); wire the high-impact nouns into dashboard / nav / reports / Foxy greeting / school-admin labels; `tenant_type='school'` keeps today's exact words; unknown key/type → `school` fallback. Behind `ff_tenant_type_v1`. REG-102. Review chain: **frontend + assessment** (copy correctness), testing, quality.

## Review chains (per change)
- Flag registry / seed migration → **architect** (ops reviews registry; testing).
- Module route guard → **backend** (architect for resolution; testing).
- Nav gating → **frontend** (testing).
- Tenant-config → Foxy (B) → **ai-engineer + assessment** (P12); testing.
- Tenant-copy (C) → **frontend + assessment** (copy correctness, P7); testing.
- Each wave → testing then quality before merge.
