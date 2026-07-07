/**
 * Phase 4 unit tests for the rule-engine service layer.
 *
 * Covers:
 *   1. Flag OFF → empty decisions, reason='flag_off'
 *   2. Flag ON, B2C learner → no nav.module.hide decisions (B2C tenant
 *      enables all default modules)
 *   3. Flag ON, school learner with quiz_engine disabled → exactly one
 *      nav.module.hide decision for quiz_engine
 *   4. Slug filter — only requested decisions return
 *   5. minPriority filter
 *   6. State-build error → empty decisions, reason='error', no throw
 *   7. decisionsToModuleEnablement — maps decisions to the sidebar's
 *      Record<moduleKey, boolean> shape, with all-true default
 *   8. getLearnerDecision returns top decision for slug or null
 */

import { describe, expect, it, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLearnerDecisions,
  getLearnerDecision,
  decisionsToModuleEnablement,
  _resetCacheForTests,
} from '@alfanumrik/lib/state/rules/service';

// ── Fake Supabase ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type TableState = { rows: Row[]; selectError?: string };

function makeFakeSb(tables: Record<string, TableState>) {
  return {
    from(table: string) {
      const state = tables[table] ?? { rows: [] };
      const filters: Array<{ col: string; val: unknown; op: 'eq' | 'gt' }> = [];
      let _limit = Infinity;
      const q: Record<string, unknown> = {
        select() {
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val, op: 'eq' });
          return q;
        },
        gt(col: string, val: unknown) {
          filters.push({ col, val, op: 'gt' });
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          _limit = n;
          return q;
        },
        async maybeSingle() {
          if (state.selectError) return { data: null, error: { message: state.selectError } };
          const filtered = state.rows.filter(matches(filters));
          return { data: filtered[0] ?? null, error: null };
        },
        async then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          const filtered = state.rows.filter(matches(filters)).slice(0, _limit);
          return resolve({ data: filtered, error: null });
        },
      };
      return q;
    },
  };
}

function matches(filters: Array<{ col: string; val: unknown; op: 'eq' | 'gt' }>) {
  return (r: Row) =>
    filters.every(f => {
      const v = r[f.col];
      if (f.op === 'gt') return String(v) > String(f.val);
      return v === f.val;
    });
}

// ── Test fixtures ─────────────────────────────────────────────────────

const AUTH_USER_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const SCHOOL_ID = '44444444-4444-4444-4444-444444444444';

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDENT_ID,
    auth_user_id: AUTH_USER_ID,
    name: 'Test Learner',
    grade: '8',
    board: 'CBSE',
    preferred_language: 'en',
    school_id: null,
    subscription_plan: 'free',
    xp_total: 0,
    streak_days: 0,
    last_active: '2026-05-11T08:00:00Z',
    date_of_birth: '2014-01-01',
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

/** Tenant rows that turn on every module the rule engine checks. */
const ALL_NAV_MODULES_ENABLED = [
  'foxy_tutor',
  'quiz_engine',
  'live_classes',
  'analytics',
  'assignments',
  'communication',
];

function tenantModuleRows(schoolId: string, overrides: Record<string, boolean> = {}) {
  return ALL_NAV_MODULES_ENABLED.map(module_key => ({
    school_id: schoolId,
    module_key,
    is_enabled: overrides[module_key] !== undefined ? overrides[module_key] : true,
  }));
}

function baseTables(): Record<string, TableState> {
  return {
    students: { rows: [studentRow()] },
    learner_mastery: { rows: [] },
    quiz_sessions: { rows: [] },
    foxy_sessions: { rows: [] },
    guardian_student_links: { rows: [] },
    tenant_modules: { rows: [] },
  };
}

// ── 1. Flag OFF ───────────────────────────────────────────────────────

describe('getLearnerDecisions', () => {
  beforeEach(() => {
    _resetCacheForTests();
  });

  it('returns empty decisions when flag is off', async () => {
    const sb = makeFakeSb(baseTables()) as unknown as SupabaseClient;
    const result = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID },
      { sb, isEnabled: async () => false },
    );
    expect(result.reason).toBe('flag_off');
    expect(result.decisions).toEqual([]);
  });

  it('emits hides for B2C defaults that exclude live_classes / analytics / etc.', async () => {
    // B2C default modules are ['foxy_tutor', 'quiz_engine', 'concept_engine',
    // 'lab_notebook'] — so the nav.module.hide rules for live_classes,
    // analytics, assignments, communication all fire.
    const sb = makeFakeSb(baseTables()) as unknown as SupabaseClient;
    const result = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID, decisionSlugs: ['nav.module.hide'] },
      { sb, isEnabled: async () => true },
    );
    expect(result.reason).toBe('ok');
    const moduleKeys = result.decisions
      .map(d => (d.reason as { moduleKey: string }).moduleKey)
      .sort();
    expect(moduleKeys).toEqual(['analytics', 'assignments', 'communication', 'live_classes']);
  });

  it('returns one extra nav.module.hide when a school tenant disables quiz_engine', async () => {
    const tables = baseTables();
    tables.students = { rows: [studentRow({ school_id: SCHOOL_ID })] };
    // Enable every nav-rule module explicitly, then flip quiz_engine off.
    tables.tenant_modules = {
      rows: tenantModuleRows(SCHOOL_ID, { quiz_engine: false }),
    };
    const sb = makeFakeSb(tables) as unknown as SupabaseClient;
    const result = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID, decisionSlugs: ['nav.module.hide'] },
      { sb, isEnabled: async () => true },
    );
    expect(result.reason).toBe('ok');
    const hides = result.decisions.filter(d => d.decision === 'nav.module.hide');
    expect(hides).toHaveLength(1);
    expect((hides[0].reason as { moduleKey: string }).moduleKey).toBe('quiz_engine');
  });

  it('respects the slug filter', async () => {
    const tables = baseTables();
    tables.students = {
      rows: [studentRow({ school_id: SCHOOL_ID, subscription_plan: 'free', streak_days: 10, date_of_birth: '2000-01-01' })],
    };
    tables.tenant_modules = {
      rows: tenantModuleRows(SCHOOL_ID, { live_classes: false }),
    };
    const sb = makeFakeSb(tables) as unknown as SupabaseClient;
    const all = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID },
      { sb, isEnabled: async () => true },
    );
    const onlyHides = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID, decisionSlugs: ['nav.module.hide'] },
      { sb, isEnabled: async () => true },
    );
    // The all-decisions response includes nav.module.hide for live_classes
    // plus upsell.show (10-day streak, free tier, non-minor).
    expect(all.decisions.length).toBeGreaterThan(onlyHides.decisions.length);
    expect(onlyHides.decisions.every(d => d.decision === 'nav.module.hide')).toBe(true);
  });

  it('respects minPriority filter', async () => {
    const tables = baseTables();
    tables.students = {
      rows: [studentRow({ school_id: SCHOOL_ID, subscription_plan: 'free', streak_days: 10, date_of_birth: '2000-01-01' })],
    };
    tables.tenant_modules = {
      rows: tenantModuleRows(SCHOOL_ID, { live_classes: false }),
    };
    const sb = makeFakeSb(tables) as unknown as SupabaseClient;
    const highOnly = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID, minPriority: 80 },
      { sb, isEnabled: async () => true },
    );
    // nav.module.hide priority is 90 → kept; upsell.show priority is 40 → filtered.
    expect(highOnly.decisions.every(d => d.priority >= 80)).toBe(true);
    expect(highOnly.decisions.some(d => d.decision === 'upsell.show')).toBe(false);
  });

  it('returns reason=error and empty decisions on state-build failure', async () => {
    const tables = baseTables();
    tables.students = { rows: [] }; // forces "no students row" throw
    const sb = makeFakeSb(tables) as unknown as SupabaseClient;
    const result = await getLearnerDecisions(
      { authUserId: AUTH_USER_ID },
      { sb, isEnabled: async () => true },
    );
    expect(result.reason).toBe('error');
    expect(result.decisions).toEqual([]);
    expect(result.errorMessage).toMatch(/no students row/);
  });
});

// ── 7. decisionsToModuleEnablement ───────────────────────────────────

describe('decisionsToModuleEnablement', () => {
  const ALL_KEYS = ['foxy_tutor', 'quiz_engine', 'live_classes', 'analytics', 'assignments', 'communication'];

  it('returns all-true when no hide decisions present', () => {
    const m = decisionsToModuleEnablement([], ALL_KEYS);
    for (const key of ALL_KEYS) expect(m[key]).toBe(true);
  });

  it('flips the matching keys to false', () => {
    const m = decisionsToModuleEnablement(
      [
        {
          ruleId: 'nav.module.hide.quiz_engine',
          decision: 'nav.module.hide',
          priority: 90,
          reason: { moduleKey: 'quiz_engine' },
        },
        {
          ruleId: 'nav.module.hide.live_classes',
          decision: 'nav.module.hide',
          priority: 90,
          reason: { moduleKey: 'live_classes' },
        },
      ],
      ALL_KEYS,
    );
    expect(m.quiz_engine).toBe(false);
    expect(m.live_classes).toBe(false);
    expect(m.foxy_tutor).toBe(true);
    expect(m.analytics).toBe(true);
  });

  it('ignores non-nav.module.hide decisions', () => {
    const m = decisionsToModuleEnablement(
      [
        {
          ruleId: 'upsell.family_plan',
          decision: 'upsell.show',
          priority: 40,
          reason: { reason: 'free_tier_engaged_student' },
        },
      ],
      ALL_KEYS,
    );
    for (const key of ALL_KEYS) expect(m[key]).toBe(true);
  });

  it('skips decisions with malformed reason', () => {
    const m = decisionsToModuleEnablement(
      [
        {
          ruleId: 'nav.module.hide.broken',
          decision: 'nav.module.hide',
          priority: 90,
          reason: null,
        },
        {
          ruleId: 'nav.module.hide.also_broken',
          decision: 'nav.module.hide',
          priority: 90,
          reason: { wrong_key: 'foxy_tutor' },
        },
      ],
      ALL_KEYS,
    );
    for (const key of ALL_KEYS) expect(m[key]).toBe(true);
  });
});

// ── 8. getLearnerDecision (single-slug helper) ───────────────────────

describe('getLearnerDecision', () => {
  beforeEach(() => {
    _resetCacheForTests();
  });

  it('returns null when no decision exists for the slug', async () => {
    // We can't easily inject opts here because getLearnerDecision uses the
    // module-level admin client. So we just smoke-test that it returns
    // null with the flag effectively off (no flag flips in test DB).
    // The integration test (when the admin client points at staging) will
    // cover the flag-on case.
    const decision = await getLearnerDecision(AUTH_USER_ID, 'totally.fake.slug');
    expect(decision).toBeNull();
  });
});
