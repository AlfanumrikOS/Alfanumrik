import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * REG-147 (resolver half) — Institution Entitlements Resolver.
 *
 * Under test: src/lib/entitlements/resolver.ts
 *   - getResolvedEntitlements(schoolId)  — config-read ALWAYS (flag-independent);
 *                                          computes the effective value of every
 *                                          catalog key for the admin preview.
 *   - isEntitledEnforced(schoolId, key)  — the runtime gate. NO-OP pass-through
 *                                          when ff_institution_entitlements_v1 is
 *                                          OFF; actually enforces when ON.
 *
 * House mocking style (src/__tests__/api/foxy/*, post-submit-telemetry.test.ts):
 * collaborators mocked at the module boundary.
 *   - @alfanumrik/lib/supabase-admin  → a per-table chained builder; each test injects the
 *                             rows returned for school_subscriptions,
 *                             institution_entitlements, tenant_modules, and
 *                             platform_module_overrides via a single fixture.
 *   - @alfanumrik/lib/feature-flags   → isFeatureEnabled spy (the ENFORCEMENT flag gate).
 *   - @alfanumrik/lib/logger          → silenced (the resolver logs warnings on DB errors).
 *
 * Resolution precedence asserted (highest first):
 *   platform_module_overrides (force-disable, module.* only)
 *     → institution_entitlements (window-checked)
 *       → tenant_modules (module.* coarse toggle)
 *         → catalog plan default (per category)
 *           → deny.
 */

const SCHOOL = 'school-uuid-1';

// ─── @alfanumrik/lib/feature-flags ─────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── @alfanumrik/lib/logger ────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── @alfanumrik/lib/supabase-admin (per-table chained builder) ────────────────────────
//
// Each test sets `fixture` to control what each table read returns. The builder
// is a thenable so `await supabaseAdmin.from(t).select(...).eq(...)` resolves;
// .maybeSingle() resolves the single-row tables (school_subscriptions).
interface Fixture {
  schoolSubscription: { plan: string | null; status?: string } | null;
  institutionRows: Array<{
    entitlement_key: string;
    value: unknown;
    effective_from: string | null;
    effective_to: string | null;
  }>;
  tenantModules: Array<{ module_key: string; is_enabled: boolean }>;
  platformOverrides: Array<{ module_key: string; is_force_disabled: boolean }>;
  errors?: Partial<Record<string, boolean>>;
}

let fixture: Fixture;

function makeBuilder(table: string) {
  const resolveData = (): { data: unknown; error: { message: string } | null } => {
    if (fixture.errors?.[table]) return { data: null, error: { message: `${table} boom` } };
    switch (table) {
      case 'school_subscriptions':
        return { data: fixture.schoolSubscription, error: null };
      case 'institution_entitlements':
        return { data: fixture.institutionRows, error: null };
      case 'tenant_modules':
        return { data: fixture.tenantModules, error: null };
      case 'platform_module_overrides':
        return { data: fixture.platformOverrides, error: null };
      default:
        return { data: [], error: null };
    }
  };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'not']) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(resolveData());
  builder.single = () => Promise.resolve(resolveData());
  (builder as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveData()).then(resolve, reject);
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

// Import AFTER mocks are registered.
import {
  getResolvedEntitlements,
  getResolvedEntitlement,
  isEntitledEnforced,
  ENTITLEMENTS_FLAG,
} from '@alfanumrik/lib/entitlements/resolver';

function emptyFixture(plan: string | null = 'free'): Fixture {
  return {
    schoolSubscription: plan === null ? null : { plan, status: 'active' },
    institutionRows: [],
    tenantModules: [],
    platformOverrides: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = emptyFixture('free');
  // Default ENFORCEMENT flag OFF (matches the seeded default-OFF posture).
  _isFeatureEnabled.mockResolvedValue(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Precedence — platform override > institution > tenant_module > plan > deny
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — resolution precedence', () => {
  it('PLATFORM force-disable wins over everything (institution row + tenant + plan)', async () => {
    // ai_tutor: tenant says ON, institution row says ON, plan default is ON — but
    // the platform override force-disables it. Platform wins → effective OFF.
    fixture.platformOverrides = [{ module_key: 'ai_tutor', is_force_disabled: true }];
    fixture.tenantModules = [{ module_key: 'ai_tutor', is_enabled: true }];
    fixture.institutionRows = [
      { entitlement_key: 'module.ai_tutor', value: { enabled: true }, effective_from: null, effective_to: null },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.ai_tutor')!;
    expect(r.resolved_by).toBe('platform_override');
    expect(r.effectiveEnabled).toBe(false);
  });

  it('INSTITUTION row wins when no platform override (over tenant + plan)', async () => {
    // analytics plan default is ON; tenant says OFF; institution row says OFF →
    // institution wins (it is higher precedence than tenant).
    fixture.tenantModules = [{ module_key: 'analytics', is_enabled: true }];
    fixture.institutionRows = [
      { entitlement_key: 'module.analytics', value: { enabled: false }, effective_from: null, effective_to: null },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.analytics')!;
    expect(r.resolved_by).toBe('institution_entitlement');
    expect(r.effectiveEnabled).toBe(false);
  });

  it('TENANT_MODULE wins when no platform override and no institution row (over plan)', async () => {
    // lms plan default is ON; tenant says OFF → tenant wins.
    fixture.tenantModules = [{ module_key: 'lms', is_enabled: false }];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.lms')!;
    expect(r.resolved_by).toBe('tenant_module');
    expect(r.effectiveEnabled).toBe(false);
  });

  it('PLAN_DEFAULT applies when no platform/institution/tenant signal exists', async () => {
    // Empty fixture, free plan → module.lms resolves to its plan default (ON).
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.lms')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveEnabled).toBe(true);
  });

  it('a malformed stored institution value falls through to the next layer (plan default)', async () => {
    // institution row for module.lms is malformed ({} has no enabled) → ignored →
    // falls through to plan default (ON) rather than being trusted.
    fixture.institutionRows = [
      { entitlement_key: 'module.lms', value: { not_enabled: 1 }, effective_from: null, effective_to: null },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.lms')!;
    expect(r.resolved_by).toBe('plan_default');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan default per category — module (registry) / feature (hardcoded) / limit (usage.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — plan default per category', () => {
  it('a MODULE pulls its default from the registry projection (module.ai_tutor ON for school)', async () => {
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('module.ai_tutor')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveEnabled).toBe(true);
  });

  it('a FEATURE pulls the per-plan grant: free foxy_interact = OFF', async () => {
    fixture = emptyFixture('free');
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('feature.foxy_interact')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveEnabled).toBe(false);
  });

  it('a FEATURE pulls the per-plan grant: pro foxy_interact = ON', async () => {
    fixture = emptyFixture('pro');
    const { plan, byKey } = await getResolvedEntitlements(SCHOOL);
    expect(plan).toBe('pro');
    const r = byKey.get('feature.foxy_interact')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveEnabled).toBe(true);
  });

  it('a LIMIT pulls usage.ts defaults: free foxy_chat_daily max = 5', async () => {
    fixture = emptyFixture('free');
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('limit.foxy_chat_daily')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveMax).toBe(5);
    expect(r.effectiveEnabled).toBeNull(); // limits don't carry an enabled flag
  });

  it('fails closed to the free plan when school_subscriptions read errors (no tier escalation)', async () => {
    fixture = emptyFixture('pro');
    fixture.errors = { school_subscriptions: true };
    const { plan, byKey } = await getResolvedEntitlements(SCHOOL);
    expect(plan).toBe('free');
    // free foxy_interact is OFF — a DB error must never grant the pro tier.
    expect(byKey.get('feature.foxy_interact')!.effectiveEnabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parent → child (Q3) — feature forced OFF when its parent module resolves OFF
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — parent→child force-off (Q3)', () => {
  it('module.ai_tutor OFF forces feature.foxy_interact OFF with force_disabled_by_parent', async () => {
    fixture = emptyFixture('pro'); // pro: foxy_interact default WOULD be ON
    // Turn the parent module OFF via a tenant toggle.
    fixture.tenantModules = [{ module_key: 'ai_tutor', is_enabled: false }];
    const { byKey } = await getResolvedEntitlements(SCHOOL);

    const parent = byKey.get('module.ai_tutor')!;
    expect(parent.effectiveEnabled).toBe(false);

    const child = byKey.get('feature.foxy_interact')!;
    expect(child.effectiveEnabled).toBe(false);
    expect(child.force_disabled_by_parent).toBe(true);
    // resolved_by reflects the PARENT's source so the panel can explain the cause.
    expect(child.resolved_by).toBe(parent.resolved_by);
  });

  it('platform force-disable of the parent module also forces the child feature OFF', async () => {
    fixture = emptyFixture('pro');
    fixture.platformOverrides = [{ module_key: 'ai_tutor', is_force_disabled: true }];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const child = byKey.get('feature.foxy_interact')!;
    expect(child.effectiveEnabled).toBe(false);
    expect(child.force_disabled_by_parent).toBe(true);
    expect(child.resolved_by).toBe('platform_override');
  });

  it('when the parent module is ON, the child keeps its own resolution (not forced off)', async () => {
    fixture = emptyFixture('pro'); // ai_tutor ON, foxy_interact default ON
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const child = byKey.get('feature.foxy_interact')!;
    expect(child.effectiveEnabled).toBe(true);
    expect(child.force_disabled_by_parent).toBe(false);
    expect(child.resolved_by).toBe('plan_default');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unlimited (Q6) — stored {max:null} → effectiveMax 999999
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — unlimited mapping (Q6)', () => {
  it('a stored institution {max:null} resolves to effectiveMax = 999999 (UNLIMITED_SENTINEL)', async () => {
    fixture = emptyFixture('free');
    fixture.institutionRows = [
      { entitlement_key: 'limit.quiz_daily', value: { max: null, period: 'day' }, effective_from: null, effective_to: null },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('limit.quiz_daily')!;
    expect(r.resolved_by).toBe('institution_entitlement');
    expect(r.effectiveMax).toBe(999999);
    expect((r.value as { max: number | null }).max).toBeNull();
  });

  it('a plan default of unlimited (pro quiz_daily) also maps to effectiveMax 999999', async () => {
    fixture = emptyFixture('pro');
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('limit.quiz_daily')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveMax).toBe(999999);
  });

  it('a finite stored cap is passed through unchanged (no sentinel mapping)', async () => {
    fixture = emptyFixture('free');
    fixture.institutionRows = [
      { entitlement_key: 'limit.foxy_chat_daily', value: { max: 42, period: 'day' }, effective_from: null, effective_to: null },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    expect(byKey.get('limit.foxy_chat_daily')!.effectiveMax).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// effective_from / effective_to window — out-of-window override does NOT apply
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — effective window', () => {
  it('an override whose effective_to is in the PAST does not apply (falls through to plan default)', async () => {
    fixture = emptyFixture('free'); // foxy_interact plan default OFF
    fixture.institutionRows = [
      {
        entitlement_key: 'feature.foxy_interact',
        value: { enabled: true }, // would turn it ON if in-window
        effective_from: null,
        effective_to: '2000-01-01T00:00:00.000Z', // expired
      },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('feature.foxy_interact')!;
    expect(r.resolved_by).toBe('plan_default');
    expect(r.effectiveEnabled).toBe(false);
  });

  it('an override whose effective_from is in the FUTURE does not apply yet', async () => {
    fixture = emptyFixture('free');
    fixture.institutionRows = [
      {
        entitlement_key: 'feature.foxy_interact',
        value: { enabled: true },
        effective_from: '2999-01-01T00:00:00.000Z', // not yet active
        effective_to: null,
      },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    expect(byKey.get('feature.foxy_interact')!.resolved_by).toBe('plan_default');
  });

  it('an override INSIDE its window DOES apply', async () => {
    fixture = emptyFixture('free');
    fixture.institutionRows = [
      {
        entitlement_key: 'feature.foxy_interact',
        value: { enabled: true },
        effective_from: '2000-01-01T00:00:00.000Z',
        effective_to: '2999-01-01T00:00:00.000Z',
      },
    ];
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    const r = byKey.get('feature.foxy_interact')!;
    expect(r.resolved_by).toBe('institution_entitlement');
    expect(r.effectiveEnabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLAG GATE — config-read ALWAYS / enforce ONLY when ff_institution_entitlements_v1 ON
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 resolver — flag-gated enforcement', () => {
  it('getResolvedEntitlements reads config regardless of the flag (flag OFF)', async () => {
    _isFeatureEnabled.mockResolvedValue(false);
    fixture = emptyFixture('pro');
    const { byKey } = await getResolvedEntitlements(SCHOOL);
    // Config still resolved even though the flag is OFF — powers the preview.
    expect(byKey.get('module.ai_tutor')!.effectiveEnabled).toBe(true);
    // getResolvedEntitlements never consults the enforcement flag.
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('isEntitledEnforced is a NO-OP pass-through when the flag is OFF (allowed:true, enforced:false)', async () => {
    _isFeatureEnabled.mockResolvedValue(false);
    fixture = emptyFixture('free'); // free foxy_interact is OFF
    const res = await isEntitledEnforced(SCHOOL, 'feature.foxy_interact');
    // Even though the resolved value is OFF, the gate does not block while OFF.
    expect(res.allowed).toBe(true);
    expect(res.enforced).toBe(false);
    // The resolved value is still surfaced for display.
    expect(res.resolved?.effectiveEnabled).toBe(false);
    // It consulted the ENFORCEMENT flag by name.
    expect(_isFeatureEnabled).toHaveBeenCalledWith(ENTITLEMENTS_FLAG, expect.any(Object));
  });

  it('isEntitledEnforced BLOCKS (allowed:false, enforced:true) when the flag is ON and the entitlement is OFF', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    fixture = emptyFixture('free'); // free foxy_interact OFF
    const res = await isEntitledEnforced(SCHOOL, 'feature.foxy_interact');
    expect(res.allowed).toBe(false);
    expect(res.enforced).toBe(true);
    expect(res.resolved?.effectiveEnabled).toBe(false);
  });

  it('isEntitledEnforced ALLOWS (allowed:true, enforced:true) when the flag is ON and the entitlement is ON', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    fixture = emptyFixture('pro'); // pro foxy_interact ON
    const res = await isEntitledEnforced(SCHOOL, 'feature.foxy_interact');
    expect(res.allowed).toBe(true);
    expect(res.enforced).toBe(true);
  });

  it('under enforcement, a LIMIT with a positive cap is allowed; a zero cap is blocked', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    fixture = emptyFixture('free'); // foxy_chat_daily free = 5 (>0)
    const ok = await isEntitledEnforced(SCHOOL, 'limit.foxy_chat_daily');
    expect(ok.allowed).toBe(true);
    expect(ok.enforced).toBe(true);

    // Zero cap via an institution override → capability off.
    fixture.institutionRows = [
      { entitlement_key: 'limit.foxy_chat_daily', value: { max: 0, period: 'day' }, effective_from: null, effective_to: null },
    ];
    const zero = await isEntitledEnforced(SCHOOL, 'limit.foxy_chat_daily');
    expect(zero.allowed).toBe(false);
    expect(zero.enforced).toBe(true);
  });

  it('an unknown key is a pass-through (allowed:true, enforced:false, resolved:null) — nothing to enforce', async () => {
    _isFeatureEnabled.mockResolvedValue(true);
    const res = await isEntitledEnforced(SCHOOL, 'module.unknown_key');
    expect(res).toEqual({ allowed: true, enforced: false, resolved: null });
  });

  it('getResolvedEntitlement returns null for an unknown key (no resolution attempted)', async () => {
    const r = await getResolvedEntitlement(SCHOOL, 'feature.not_real');
    expect(r).toBeNull();
  });
});
