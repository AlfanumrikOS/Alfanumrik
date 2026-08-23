/**
 * Protected-flag registry contract (REG-285 companion — 2026-07-20 console
 * bulk-enable incident guardrail).
 *
 * Pins packages/lib/src/flags/protected-flags.ts:
 *   - the registry enumerates exactly 82 flags across exactly 6 tiers
 *     (72 + the 2 Pedagogy v2 constitution-pinned flags added 2026-07-22 —
 *     ff_productive_failure_v1, ff_pedagogy_v2_monthly_synthesis — Phase 0
 *     flag-governance hardening, master action plan; + the 2 WhatsApp bot
 *     protected flags added 2026-07-30 — ff_whatsapp_bot_v1,
 *     ff_whatsapp_alarm_template — the architect-ruled companion to seed
 *     migration 20260801100500, closing its documented DB⊃TS drift; + the 5
 *     GenAI ecosystem flags added 2026-08-01 — ff_model_gateway_v1,
 *     ff_unified_memory_v1, ff_outcome_prediction_v1,
 *     ff_lesson_generation_v1, ff_content_generation_v1 — closing the
 *     2026-07-24..27 GenAI generation-agent incident gap, seed migration
 *     20260801120000; + ff_foxy_openai_primary_rollout_v1 added 2026-08-03 —
 *     the Foxy OpenAI-primary provider-swap rollback lever, REG-334/REG-335,
 *     architect-ruled companion to migration
 *     20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql; it is
 *     protected at ai_provider but is NOT part of the MoL-program group
 *     below — it has its own FlagProtection literal with flag-specific
 *     reason text, per that migration's own governance ruling);
 *   - the P0 quiz-submit pair, the 4 constitution-pinned Group A flags, the 5
 *     MoL program flags, and the standalone ff_foxy_openai_primary_rollout_v1
 *     lever are protected at their declared tiers;
 *   - EXPECTED_OFF_FLAGS is the 56-name CEO-approved forced-OFF posture
 *     (52 block-(ii) names from migration 20260720110000, MINUS
 *     ff_adaptive_remediation_v1 (see below), MINUS ff_whatsapp_bot_v1 (see
 *     below), MINUS ff_foxy_streaming / ff_goal_aware_rag /
 *     ff_grounded_ai_concept_engine (3 flags approved intentionally-live
 *     2026-08-03 — still PROTECTED_FLAGS entries, just no longer expected
 *     fully-OFF), MINUS ff_foxy_openai_primary_rollout_v1 (CEO-approved
 *     intentionally-live 2026-08-03 at is_enabled=true/rollout_percentage=100
 *     — still a PROTECTED_FLAGS ai_provider entry, just no longer expected
 *     fully-OFF), + ff_irt_question_selection + the 2 Pedagogy v2 additions
 *     above + ff_whatsapp_alarm_template (the surviving WhatsApp addition,
 *     parsed from seed 20260801100500's protected_feature_flags block) +
 *     the 5 GenAI ecosystem flags added 2026-08-01 above) — the block-(ii)
 *     and WhatsApp portions are parsed from the migration SQL itself;
 *     ff_irt_question_selection, the 2 Pedagogy v2 flags, the 5 GenAI
 *     ecosystem flags, and ff_foxy_openai_primary_rollout_v1 are explicit
 *     documented literals (same pattern as each other) rather than parsed
 *     from a migration this file reads — so the TS list cannot silently
 *     drift from the approved SQL beyond the documented additions/exclusions
 *     (ff_foxy_openai_primary_rollout_v1 is added as a literal then excluded
 *     as intentionally-live, exactly like ff_whatsapp_bot_v1);
 *   - ff_adaptive_remediation_v1 is deliberately EXCLUDED from
 *     EXPECTED_OFF_FLAGS as of 2026-07-22: CEO-approved production pilot at
 *     10% rollout (Phase A Loop A). It stays PROTECTED (constitution_pinned)
 *     for any further increase, but the canary's "must be fully OFF"
 *     baseline no longer applies to it;
 *   - ff_whatsapp_bot_v1 is deliberately EXCLUDED from EXPECTED_OFF_FLAGS as
 *     of 2026-07-30: CEO-approved live production flip to is_enabled=true,
 *     rollout_percentage=100 (audited via admin_flip_feature_flag) to
 *     exercise the WhatsApp bot end-to-end. It stays PROTECTED
 *     (staged_rollout) for any further change, but the canary's "must be
 *     fully OFF" baseline no longer applies to it — mirrors the
 *     ff_adaptive_remediation_v1 precedent immediately above;
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

/**
 * The two ff_whatsapp_* protected flags are seeded by 20260801100500 (NOT by
 * the already-applied 20260720110000, which must never be edited in place).
 * Parse their names out of that seed's protected_feature_flags INSERT
 * tuples: only those tuples pair a flag name with a quoted tier literal, so
 * requiring 'staged_rollout' as the second element cannot match the
 * feature_flags INSERT (whose second element is the unquoted boolean false).
 */
const WHATSAPP_SEED = readFileSync(
  repoPath('supabase/migrations/20260801100500_seed_ff_whatsapp_bot.sql'),
  'utf8',
);
const WHATSAPP_PROTECTED = [
  ...WHATSAPP_SEED.matchAll(/\(\s*'(ff_whatsapp_[a-z0-9_]+)'\s*,\s*'staged_rollout'\s*,/g),
].map((m) => m[1]);

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
  it('enumerates exactly 82 protected flags (74 + the 2 WhatsApp bot flags added 2026-07-30 per seed 20260801100500 + the 5 GenAI ecosystem flags added 2026-08-01 per seed 20260801120000 + the 1 ff_foxy_openai_primary_rollout_v1 addition, 2026-08-03, per migration 20260803120001)', () => {
    expect(Object.keys(PROTECTED_FLAGS)).toHaveLength(82);
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

  it('ff_foxy_openai_primary_rollout_v1 is protected at ai_provider — NOT part of the MoL program group above (REG-334/REG-335, migration 20260803120001)', () => {
    expect(getProtection('ff_foxy_openai_primary_rollout_v1')?.tier).toBe('ai_provider');
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

  it.each([
    'ff_whatsapp_bot_v1',
    'ff_whatsapp_alarm_template',
  ])('WhatsApp bot protected pair (seed 20260801100500 companion, 2026-07-30): %s is protected at staged_rollout', (name) => {
    expect(getProtection(name)?.tier).toBe('staged_rollout');
  });

  it('ff_model_gateway_v1 (GenAI ecosystem, seed 20260801120000 companion, 2026-08-01) is protected at ai_provider', () => {
    expect(getProtection('ff_model_gateway_v1')?.tier).toBe('ai_provider');
  });

  it.each([
    'ff_unified_memory_v1',
    'ff_outcome_prediction_v1',
    'ff_lesson_generation_v1',
    'ff_content_generation_v1',
  ])('GenAI ecosystem flags (seed 20260801120000 companion, 2026-08-01): %s is protected at staged_rollout', (name) => {
    expect(getProtection(name)?.tier).toBe('staged_rollout');
  });
});

// ─── EXPECTED_OFF_FLAGS posture list ──────────────────────────────────

describe('EXPECTED_OFF_FLAGS — the CEO-approved forced-OFF posture', () => {
  it('contains exactly 54 unique names (52 block-(ii) + ff_irt_question_selection + 2 Pedagogy v2 additions + 2 WhatsApp bot protected flags (seed 20260801100500) + 5 GenAI ecosystem additions (seed 20260801120000) + ff_foxy_openai_primary_rollout_v1 (seed 20260803120000) MINUS ff_adaptive_remediation_v1 (10% pilot, 2026-07-22) MINUS ff_whatsapp_bot_v1 (CEO-approved live flip, 2026-07-30) MINUS 3 flags approved intentionally-live 2026-08-03 (ff_foxy_streaming, ff_goal_aware_rag, ff_grounded_ai_concept_engine) MINUS ff_foxy_openai_primary_rollout_v1 (CEO-approved intentionally-live, 2026-08-03) MINUS ff_quiz_telemetry_v1 (promoted always-on in code, 2026-08-06 backendaudit P0) MINUS ff_adaptive_loops_bc_v1 and ff_school_pulse_v1 (CEO-approved intentionally-live, 2026-08-19))', () => {
    expect(EXPECTED_OFF_FLAGS).toHaveLength(54);
    expect(new Set(EXPECTED_OFF_FLAGS).size).toBe(54);
    expect(EXPECTED_OFF_FLAGS).toContain('ff_irt_question_selection');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_productive_failure_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_pedagogy_v2_monthly_synthesis');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_whatsapp_alarm_template');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_model_gateway_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_unified_memory_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_outcome_prediction_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_lesson_generation_v1');
    expect(EXPECTED_OFF_FLAGS).toContain('ff_content_generation_v1');
    // ff_foxy_openai_primary_rollout_v1 is deliberately NOT here as of
    // 2026-08-03 — CEO-approved intentionally-live at enabled=true/100 (see
    // the dedicated excludes test below).
  });

  it('excludes ff_adaptive_remediation_v1 on purpose: CEO-approved 10% production pilot (2026-07-22), no longer expected fully-OFF, still constitution_pinned for any further increase', () => {
    expect(EXPECTED_OFF_FLAGS).not.toContain('ff_adaptive_remediation_v1');
    expect(getProtection('ff_adaptive_remediation_v1')?.tier).toBe('constitution_pinned');
  });

  it('excludes ff_whatsapp_bot_v1 on purpose: CEO-approved live flip to is_enabled=true/rollout_percentage=100 (2026-07-30, audited via admin_flip_feature_flag), no longer expected fully-OFF, still staged_rollout-protected for any further change', () => {
    expect(EXPECTED_OFF_FLAGS).not.toContain('ff_whatsapp_bot_v1');
    expect(getProtection('ff_whatsapp_bot_v1')?.tier).toBe('staged_rollout');
  });

  it('excludes ff_foxy_openai_primary_rollout_v1 on purpose: CEO-approved intentionally-live at is_enabled=true/rollout_percentage=100 (2026-08-03, the OpenAI-primary rollback lever, #1443), no longer expected fully-OFF, still ai_provider-protected for any further change', () => {
    expect(EXPECTED_OFF_FLAGS).not.toContain('ff_foxy_openai_primary_rollout_v1');
    expect(getProtection('ff_foxy_openai_primary_rollout_v1')?.tier).toBe('ai_provider');
  });

  it('equals migration 20260720110000 block (ii) ∪ {ff_irt_question_selection} ∪ {the 2 Pedagogy v2 additions} ∪ {the 2 WhatsApp protected flags parsed from seed 20260801100500} ∪ {the 5 GenAI ecosystem flags added 2026-08-01} ∪ {ff_foxy_openai_primary_rollout_v1}, MINUS ff_adaptive_remediation_v1 (10% pilot exclusion) MINUS ff_whatsapp_bot_v1 (CEO-approved live flip, 2026-07-30) MINUS the 3 flags approved intentionally-live 2026-08-03 (ff_foxy_streaming, ff_goal_aware_rag, ff_grounded_ai_concept_engine) MINUS ff_foxy_openai_primary_rollout_v1 (CEO-approved intentionally-live, 2026-08-03) — the TS list cannot drift from the approved SQL beyond the documented additions/exclusions', () => {
    expect(HONESTY_52).toHaveLength(52);
    // Sanity on the second parser: exactly the WhatsApp protected pair.
    expect([...WHATSAPP_PROTECTED].sort()).toEqual([
      'ff_whatsapp_alarm_template',
      'ff_whatsapp_bot_v1',
    ]);
    // ff_foxy_openai_primary_rollout_v1 (2026-08-03) is a documented literal
    // addition, same as ff_irt_question_selection / the 2 Pedagogy v2 flags
    // above — it is NOT parsed from a migration this file reads. It lives in
    // its OWN migration (20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql),
    // not in the two files MIGRATION/WHATSAPP_SEED already parse, so neither
    // HONESTY_52 nor WHATSAPP_PROTECTED can pick it up automatically; this
    // was confirmed by actually running this suite before adding the literal
    // below (it failed with the derived `expected` set missing exactly this
    // one name) rather than assumed.
    const expected = new Set([
      ...HONESTY_52,
      'ff_irt_question_selection',
      'ff_productive_failure_v1',
      'ff_pedagogy_v2_monthly_synthesis',
      'ff_foxy_openai_primary_rollout_v1',
      ...WHATSAPP_PROTECTED,
      // GenAI ecosystem flags added 2026-08-01 (seed 20260801120000). Not
      // parsed from a migration the way HONESTY_52/WHATSAPP_PROTECTED are —
      // hardcoded literals, same treatment as the 2 Pedagogy v2 additions
      // immediately above.
      'ff_model_gateway_v1',
      'ff_unified_memory_v1',
      'ff_outcome_prediction_v1',
      'ff_lesson_generation_v1',
      'ff_content_generation_v1',
    ]);
    expected.delete('ff_adaptive_remediation_v1');
    expected.delete('ff_whatsapp_bot_v1');
    // 2026-08-03: approved intentionally-live, no longer expected fully-OFF.
    expected.delete('ff_foxy_streaming');
    expected.delete('ff_goal_aware_rag');
    expected.delete('ff_grounded_ai_concept_engine');
    // 2026-08-03: ff_foxy_openai_primary_rollout_v1 added as a literal above
    // (it lives in its own migration, not parsed here) then deleted here as
    // CEO-approved intentionally-live at enabled=true/100 — same add-then-
    // delete treatment as ff_whatsapp_bot_v1.
    expected.delete('ff_foxy_openai_primary_rollout_v1');
    // 2026-08-06: ff_quiz_telemetry_v1 promoted to always-on in code
    // (v2/quiz/submit/route.ts unconditionally calls prepareQuizTelemetry,
    // backendaudit P0) — the route no longer reads the flag, so it is no
    // longer expected fully-OFF. Still parsed from migration block (ii) here,
    // so it must be excluded exactly like the other always-on promotions above.
    expected.delete('ff_quiz_telemetry_v1');
    // 2026-08-19: ff_adaptive_loops_bc_v1 and ff_school_pulse_v1 were flipped
    // is_enabled=true in production on 2026-08-18 16:27 UTC through the
    // governed admin_flip_feature_flag RPC, both recorded in admin_audit_log
    // ('feature_flag.protected_flip_rpc', admin 2b0ae0a9). CEO-approved
    // intentionally-live, so no longer expected fully-OFF. Both REMAIN
    // constitution_pinned in PROTECTED_FLAGS (asserted separately above), so
    // the console guardrail and the DB trigger still require typed
    // confirmation for any further change. Re-add here if either is ever
    // rolled back to is_enabled=false / rollout_percentage=0.
    expected.delete('ff_adaptive_loops_bc_v1');
    expected.delete('ff_school_pulse_v1');
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
