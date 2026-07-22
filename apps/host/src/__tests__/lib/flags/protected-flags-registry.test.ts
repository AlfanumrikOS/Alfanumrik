/**
 * Protected-flag registry contract (REG-285 companion — 2026-07-20 console
 * bulk-enable incident guardrail).
 *
 * Pins packages/lib/src/flags/protected-flags.ts:
 *   - the registry enumerates exactly 74 flags across exactly 6 tiers
 *     (72 + the 2 Pedagogy v2 constitution-pinned flags added 2026-07-22 —
 *     ff_productive_failure_v1, ff_pedagogy_v2_monthly_synthesis — Phase 0
 *     flag-governance hardening, master action plan);
 *   - the P0 quiz-submit pair, the 4 constitution-pinned Group A flags, and
 *     the 5 MoL program flags are protected at their declared tiers;
 *   - EXPECTED_OFF_FLAGS is the 55-name CEO-approved forced-OFF posture
 *     (52 block-(ii) names from migration 20260720110000 +
 *     ff_irt_question_selection + the 2 Pedagogy v2 additions above) —
 *     parsed from the migration SQL itself so the TS list cannot silently
 *     drift from the approved SQL;
 *   - EXPECTED_OFF_FLAGS is DISJOINT from the 25-flag block-(i) ACTIVATE
 *     list (a flag cannot be simultaneously "must be OFF" and "must be
 *     live"), also parsed from the migration;
 *   - the ff_python_ PREFIX rule protects names not enumerated in the
 *     registry (a newly seeded ff_python_* flag is protected before anyone
 *     remembers to add it);
 *   - activation-list flags (e.g. ff_foxy_maps_v1) are NOT protected — the
 *     guardrail must not lock operators out of legitimately live flags.
 *
 * Deterministic: pure module import + static SQL file read. No DB, no network.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROTECTED_FLAGS,
  getProtection,
  EXPECTED_OFF_FLAGS,
  type ProtectedTier,
} from '@alfanumrik/lib/flags/protected-flags';

/** cwd is apps/host under vitest; the migration lives at the repo root. */
function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

const MIGRATION = readFileSync(
  repoPath('supabase/migrations/20260720110000_feature_flags_data_repair_ceo_approved.sql'),
  'utf8',
);

/**
 * Extract the flag names quoted inside a `DO $tag$ ... $tag$` block. The only
 * single-quoted tokens in those blocks that are pure [a-z0-9_]+ are the flag
 * names themselves (the NOTICE strings contain spaces/percent signs and the
 * to_regclass argument contains a dot, so neither can match).
 */
function flagNamesInBlock(tag: string): string[] {
  const block = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(MIGRATION);
  expect(block, `DO $${tag}$ block not found in migration 20260720110000`).not.toBeNull();
  return [...block![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const ACTIVATE_25 = flagNamesInBlock('activate');
const HONESTY_52 = flagNamesInBlock('honesty_fix');

const ALL_TIERS: ProtectedTier[] = [
  'p0_outage',
  'p11_payment',
  'ai_provider',
  'constitution_pinned',
  'staged_rollout',
  'special_do_not_touch',
];

// ─── Registry shape ───────────────────────────────────────────────────

describe('PROTECTED_FLAGS registry — shape', () => {
  it('enumerates exactly 74 protected flags', () => {
    expect(Object.keys(PROTECTED_FLAGS)).toHaveLength(74);
  });

  it('uses exactly the 6 declared tiers, each at least once', () => {
    const used = new Set(Object.values(PROTECTED_FLAGS).map((p) => p.tier));
    expect([...used].sort()).toEqual([...ALL_TIERS].sort());
  });

  it('every entry carries a non-empty English reason and a Devanagari Hindi reason (P7 house shape)', () => {
    for (const [name, protection] of Object.entries(PROTECTED_FLAGS)) {
      expect(protection.reason, `${name} reason`).toMatch(/\S/);
      expect(protection.reasonHi, `${name} reasonHi`).toMatch(/[ऀ-ॿ]/);
    }
  });
});

// ─── Tier membership pins ─────────────────────────────────────────────

describe('PROTECTED_FLAGS registry — tier membership', () => {
  it.each(['ff_server_only_quiz_submit', 'ff_v1_quiz_rpc_web_blocked'])(
    'P0 quiz-submit pair: %s is protected at p0_outage',
    (name) => {
      expect(getProtection(name)?.tier).toBe('p0_outage');
    },
  );

  it.each([
    'ff_adaptive_remediation_v1',
    'ff_adaptive_loops_bc_v1',
    'ff_digital_twin_v1',
    'ff_school_pulse_v1',
  ])('constitution Group A: %s is protected at constitution_pinned (REG-124/126/131/175)', (name) => {
    expect(getProtection(name)?.tier).toBe('constitution_pinned');
  });

  it.each([
    'ff_productive_failure_v1',
    'ff_pedagogy_v2_monthly_synthesis',
  ])('Pedagogy v2 constitution-pinned flags added 2026-07-22: %s is protected at constitution_pinned', (name) => {
    expect(getProtection(name)?.tier).toBe('constitution_pinned');
  });

  it.each([
    'ff_mol_enabled',
    'ff_mol_hybrid_mode_v1',
    'ff_mol_openai_default',
    'ff_grounded_answer_mol_shadow_v1',
    'ff_mol_shadow_text_capture_v1',
  ])('MoL program: %s is protected at ai_provider', (name) => {
    expect(getProtection(name)?.tier).toBe('ai_provider');
  });

  it('ff_competitive_exams_v1 is the p11_payment tier (₹999 SKU coupling)', () => {
    expect(getProtection('ff_competitive_exams_v1')?.tier).toBe('p11_payment');
  });

  it('ff_atomic_subscription_activation is special_do_not_touch (P11 kill-switch — disable is ALSO gated)', () => {
    expect(getProtection('ff_atomic_subscription_activation')?.tier).toBe('special_do_not_touch');
  });

  it('ff_irt_question_selection is protected (staged_rollout — dormant until calibration accumulates)', () => {
    expect(getProtection('ff_irt_question_selection')?.tier).toBe('staged_rollout');
  });
});

// ─── EXPECTED_OFF_FLAGS posture list ──────────────────────────────────

describe('EXPECTED_OFF_FLAGS — the CEO-approved forced-OFF posture', () => {
  it('contains exactly 55 unique names (52 block-(ii) + ff_irt_question_selection + 2 Pedagogy v2 additions)', () => {
    expect(EXPECTED_OFF_FLAGS).toHaveLength(55);
    expect(new Set(EXPECTED_OFF_FLAGS).size).toBe(55);
    expect(EXPECTED_OFF_FLAGS).toContain('ff_irt_question_selection');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_productive_failure_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_pedagogy_v2_monthly_synthesis');
  });

  it('equals migration 20260720110000 block (ii) ∪ {ff_irt_question_selection} ∪ {the 2 Pedagogy v2 additions} — the TS list cannot drift from the approved SQL beyond the 2026-07-22 documented additions', () => {
    expect(HONESTY_52).toHaveLength(52);
    const expected = new Set([
      ...HONESTY_52,
      'ff_irt_question_selection',
      'ff_productive_failure_v1',
      'ff_pedagogy_v2_monthly_synthesis',
    ]);
    expect(new Set(EXPECTED_OFF_FLAGS)).toEqual(expected);
  });

  it('every expected-OFF flag is also console-protected (getProtection non-null)', () => {
    for (const name of EXPECTED_OFF_FLAGS) {
      expect(getProtection(name), name).not.toBeNull();
    }
  });

  it('is DISJOINT from the 25-flag block-(i) ACTIVATE list (must-be-OFF ∩ must-be-live = ∅)', () => {
    expect(ACTIVATE_25).toHaveLength(25);
    const off = new Set(EXPECTED_OFF_FLAGS);
    const overlap = ACTIVATE_25.filter((name) => off.has(name));
    expect(overlap).toEqual([]);
  });

  it('excludes the hard-exclusion names on purpose (atomic kill-switch, board_score, reconcile control, ff_python_*)', () => {
    expect(EXPECTED_OFF_FLAGS).not.toContain('ff_atomic_subscription_activation');
    expect(EXPECTED_OFF_FLAGS).not.toContain('ff_board_score_v1');
    expect(EXPECTED_OFF_FLAGS).not.toContain('reconcile_stuck_subscriptions_enabled');
    expect(EXPECTED_OFF_FLAGS.filter((n) => n.startsWith('ff_python_'))).toEqual([]);
  });
});

// ─── ff_python_ prefix rule + non-protection boundary ─────────────────

describe('getProtection — ff_python_ prefix rule and non-protection boundary', () => {
  it('an UN-enumerated ff_python_* name is still protected via the prefix rule', () => {
    // Not in the registry object — only the prefix rule can catch it.
    expect(PROTECTED_FLAGS['ff_python_anything']).toBeUndefined();
    expect(getProtection('ff_python_anything')?.tier).toBe('special_do_not_touch');
    expect(getProtection('ff_python_brand_new_service_v9')?.tier).toBe('special_do_not_touch');
  });

  it('the prefix includes the trailing underscore — ff_pythonish is NOT protected', () => {
    expect(getProtection('ff_pythonish')).toBeNull();
  });

  it('activation-list / unprotected flags return null (operators are not locked out of live flags)', () => {
    expect(getProtection('ff_foxy_maps_v1')).toBeNull();
    expect(getProtection('quiz_module')).toBeNull();
    expect(getProtection('ff_demo_v1')).toBeNull();
  });
});
