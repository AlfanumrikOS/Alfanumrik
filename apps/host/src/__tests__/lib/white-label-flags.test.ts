import { describe, it, expect } from 'vitest';

import { WHITE_LABEL_FLAGS, FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';

/**
 * Phase 3C Wave A / A1 — registry contract tests for the four white-label
 * ("multi-tenant activation") feature flags.
 *
 * These tests pin the registry constants to the EXACT strings used by the
 * seeding migration `20260615000000_phase3c_seed_white_label_flags.sql` and the
 * pre-baseline legacy seeds (20260507000004-7), and verify that all four default
 * to OFF in the SSR pre-DB-hit defaults map.
 *
 * Why this matters (the bug this phase closes):
 *   - All four flags were seeded in PRODUCTION by the legacy migrations but were
 *     NEVER registered in `FLAG_DEFAULTS`. Prod (which has the DB rows) and a
 *     fresh CI/staging/Preview env (no row, no default) therefore resolved these
 *     flags inconsistently. A typo on either the migration `flag_name` side or
 *     the TS constant side silently evaluates as "flag does not exist" → returns
 *     false → consumers (registry resolver, tenant-config resolver) take the
 *     legacy code path with no error surface. This test catches that drift.
 *   - `FLAG_DEFAULTS` is the documented SSR fallback before the first DB fetch
 *     resolves. All four MUST default to false to preserve the "ship OFF,
 *     behaviour unchanged on every env" founder constraint.
 *
 * Owning agent: testing (encodes architect's A1 registration as assertions).
 */

const EXPECTED_WHITE_LABEL_FLAG_STRINGS = {
  TENANT_TYPE_V1: 'ff_tenant_type_v1',
  TENANT_MODULE_REGISTRY_V1: 'ff_tenant_module_registry_v1',
  TENANT_CONFIG_V2: 'ff_tenant_config_v2',
  EVENT_BUS_V1: 'ff_event_bus_v1',
} as const;

describe('WHITE_LABEL_FLAGS registry', () => {
  it('maps every constant to the exact flag string used by the seed migration', () => {
    // A SECOND independent literal (not the source map) so a drift in either
    // copy fails — this is NOT a tautology against WHITE_LABEL_FLAGS itself.
    expect(WHITE_LABEL_FLAGS.TENANT_TYPE_V1).toBe(EXPECTED_WHITE_LABEL_FLAG_STRINGS.TENANT_TYPE_V1);
    expect(WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1).toBe(
      EXPECTED_WHITE_LABEL_FLAG_STRINGS.TENANT_MODULE_REGISTRY_V1,
    );
    expect(WHITE_LABEL_FLAGS.TENANT_CONFIG_V2).toBe(EXPECTED_WHITE_LABEL_FLAG_STRINGS.TENANT_CONFIG_V2);
    expect(WHITE_LABEL_FLAGS.EVENT_BUS_V1).toBe(EXPECTED_WHITE_LABEL_FLAG_STRINGS.EVENT_BUS_V1);
  });

  it('exposes exactly the four white-label keys (no accidental additions/removals)', () => {
    expect(Object.keys(WHITE_LABEL_FLAGS).sort()).toEqual(
      ['EVENT_BUS_V1', 'TENANT_CONFIG_V2', 'TENANT_MODULE_REGISTRY_V1', 'TENANT_TYPE_V1'],
    );
  });

  it('registers ff_tenant_module_registry_v1 — the string the resolver reads', () => {
    // src/lib/modules/registry.ts isModuleEnabled/enabledModulesFor read this
    // exact flag name; a mismatch would make the resolver short-circuit to
    // all-enabled forever (the OFF default) and never honour a tenant override.
    expect(WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1).toBe('ff_tenant_module_registry_v1');
  });

  it('registers ff_event_bus_v1 (correctness / env-parity — not wired this phase)', () => {
    // The event bus is registered for correctness + env-parity ONLY (no
    // consuming surface in Wave A). It must still be present + default OFF so a
    // fresh env matches prod.
    expect(WHITE_LABEL_FLAGS.EVENT_BUS_V1).toBe('ff_event_bus_v1');
  });

  it('is an `as const` literal (compile-time narrowing + runtime safety net)', () => {
    // If `as const` were dropped, these literal-type assignments would no longer
    // narrow to the exact strings and TypeScript would refuse the assignment.
    const tenantType: 'ff_tenant_type_v1' = WHITE_LABEL_FLAGS.TENANT_TYPE_V1;
    const registry: 'ff_tenant_module_registry_v1' = WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1;
    const config: 'ff_tenant_config_v2' = WHITE_LABEL_FLAGS.TENANT_CONFIG_V2;
    const bus: 'ff_event_bus_v1' = WHITE_LABEL_FLAGS.EVENT_BUS_V1;
    expect(tenantType).toBe('ff_tenant_type_v1');
    expect(registry).toBe('ff_tenant_module_registry_v1');
    expect(config).toBe('ff_tenant_config_v2');
    expect(bus).toBe('ff_event_bus_v1');
  });
});

describe('FLAG_DEFAULTS — every white-label flag is present and OFF', () => {
  it('registers all four white-label flags in FLAG_DEFAULTS (closes the prod/fresh-env gap)', () => {
    // The gap this phase closes: the legacy seeds created prod rows, but the TS
    // defaults map never listed these keys. Assert presence by KEY existence so
    // a deletion (which would re-open the gap) fails here.
    expect(Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, 'ff_tenant_type_v1')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, 'ff_tenant_module_registry_v1')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, 'ff_tenant_config_v2')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, 'ff_event_bus_v1')).toBe(true);
  });

  it('defaults ff_tenant_type_v1 to false', () => {
    expect(FLAG_DEFAULTS[WHITE_LABEL_FLAGS.TENANT_TYPE_V1]).toBe(false);
    expect(FLAG_DEFAULTS['ff_tenant_type_v1']).toBe(false);
  });

  it('defaults ff_tenant_module_registry_v1 to false (resolver stays all-enabled)', () => {
    expect(FLAG_DEFAULTS[WHITE_LABEL_FLAGS.TENANT_MODULE_REGISTRY_V1]).toBe(false);
    expect(FLAG_DEFAULTS['ff_tenant_module_registry_v1']).toBe(false);
  });

  it('defaults ff_tenant_config_v2 to false', () => {
    expect(FLAG_DEFAULTS[WHITE_LABEL_FLAGS.TENANT_CONFIG_V2]).toBe(false);
    expect(FLAG_DEFAULTS['ff_tenant_config_v2']).toBe(false);
  });

  it('defaults ff_event_bus_v1 to false', () => {
    expect(FLAG_DEFAULTS[WHITE_LABEL_FLAGS.EVENT_BUS_V1]).toBe(false);
    expect(FLAG_DEFAULTS['ff_event_bus_v1']).toBe(false);
  });

  it('does NOT enable any white-label flag by default (founder safety constraint)', () => {
    // Hard guard: if any of the four is ever flipped to true in FLAG_DEFAULTS,
    // the "ship OFF on prod, staging, and fresh envs" constraint is violated for
    // the SSR window before the DB fetch resolves.
    const enabledKeys = Object.entries(FLAG_DEFAULTS)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    for (const flag of Object.values(WHITE_LABEL_FLAGS)) {
      expect(enabledKeys).not.toContain(flag);
    }
  });
});
