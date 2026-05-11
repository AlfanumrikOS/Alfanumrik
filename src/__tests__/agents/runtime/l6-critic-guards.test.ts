import { describe, it, expect } from 'vitest';
import {
  applyDeterministicGuards,
  type BuildVerdictArgs,
} from '../../../../agents/runtime/layers/l6-critic';

/**
 * L6 critic — deterministic guard tests.
 *
 * The critic prompt is read by Opus, but three properties cannot be
 * delegated to the model:
 *   1. A blocking evaluator failure MUST force reject (rubric R3.4).
 *   2. A diff touching an Always-Escalate path MUST force escalate
 *      (rubric R2.*, R4.*, R5.*).
 *   3. A thin "approve" reasoning on risk_tier >= 2 MUST be downgraded
 *      to request_changes (rubric R10.1).
 *
 * The post-processing function `applyDeterministicGuards` is what
 * enforces these regardless of what the model returned. These tests
 * pin the must-hold cases.
 */

const baseArgs = (override: Partial<BuildVerdictArgs> = {}): BuildVerdictArgs => ({
  taskId: '11111111-1111-1111-1111-111111111111',
  cycleId: '22222222-2222-2222-2222-222222222222',
  riskTierDeclared: 2,
  filesChanged: [{ path: 'src/components/teacher/AvatarRow.tsx' }],
  evals: [
    { evaluator: 'unit_tests', verdict: 'pass', blocking: true, notes: 'all green' },
    { evaluator: 'type_check', verdict: 'pass', blocking: true, notes: '0 errors' },
    { evaluator: 'lint', verdict: 'pass', blocking: true, notes: '0 errors' },
    { evaluator: 'tenant_isolation', verdict: 'pass', blocking: true, notes: 'no regressions' },
  ],
  rubricVersion: 'v1.0.0',
  modelDecision: {
    decision: 'approve',
    reasoning: 'a'.repeat(2000), // long enough to clear the word-floor in default cases
    risk_tier_observed: 2,
    rubric_clauses_invoked: ['R1.1'],
  },
  ...override,
});

describe('applyDeterministicGuards', () => {
  it('passes a clean approve through unchanged', () => {
    const v = applyDeterministicGuards(baseArgs({
      modelDecision: {
        decision: 'approve',
        reasoning: ['word'].concat(Array.from({ length: 220 }, () => 'verbose')).join(' '),
        risk_tier_observed: 2,
        rubric_clauses_invoked: ['R1.1'],
      },
    }));
    expect(v.decision).toBe('approve');
    expect(v.rubric_version).toBe('v1.0.0');
    expect(v.evaluator_summary).toMatchObject({ passed: 4, failed: 0, warned: 0 });
  });

  it('overrides to reject when a blocking evaluator failed (R3.4)', () => {
    const v = applyDeterministicGuards(baseArgs({
      evals: [
        { evaluator: 'unit_tests', verdict: 'pass', blocking: true, notes: '' },
        { evaluator: 'tenant_isolation', verdict: 'fail', blocking: true, notes: 'new NO_AUTH route' },
      ],
      modelDecision: {
        decision: 'approve',
        reasoning: 'looks good',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('reject');
    expect(v.rubric_clauses_invoked).toContain('R3.4');
    expect(v.evaluator_summary.blocking_failures).toContain('tenant_isolation');
    expect(v.reasoning).toMatch(/GUARD: blocking-evaluator override/);
  });

  it('overrides to reject when a blocking evaluator was skipped (missing required runner)', () => {
    const v = applyDeterministicGuards(baseArgs({
      evals: [
        { evaluator: 'unit_tests', verdict: 'pass', blocking: true, notes: '' },
        { evaluator: 'learning_eval', verdict: 'skipped', blocking: true, notes: 'no runner' },
      ],
      modelDecision: {
        decision: 'approve',
        reasoning: 'fine',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('reject');
    expect(v.evaluator_summary.blocking_failures).toContain('learning_eval');
  });

  it('escalates when the diff touches supabase/migrations/ (R2.1 → principal_engineer)', () => {
    const v = applyDeterministicGuards(baseArgs({
      filesChanged: [{ path: 'supabase/migrations/20260601_evil.sql' }],
      modelDecision: {
        decision: 'approve',
        reasoning: 'looks fine',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('escalate_to_human');
    expect(v.human_reviewer_required).toBe('principal_engineer');
    expect(v.rubric_clauses_invoked).toContain('R2.1');
  });

  it('escalates when the diff touches agents/prompts/ (R2.2 → ceo)', () => {
    const v = applyDeterministicGuards(baseArgs({
      filesChanged: [{ path: 'agents/prompts/l4-code-agent.md' }],
      modelDecision: {
        decision: 'approve',
        reasoning: 'cosmetic',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('escalate_to_human');
    expect(v.human_reviewer_required).toBe('ceo');
  });

  it('escalates when the diff touches governance/ regardless of model call', () => {
    const v = applyDeterministicGuards(baseArgs({
      filesChanged: [{ path: 'governance/rubric.md' }],
      modelDecision: {
        decision: 'approve',
        reasoning: 'minor edit',
        risk_tier_observed: 1,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('escalate_to_human');
  });

  it('escalates AI-surface changes to pedagogy_lead (R4.5)', () => {
    const v = applyDeterministicGuards(baseArgs({
      filesChanged: [{ path: 'supabase/functions/foxy-tutor/index.ts' }],
      modelDecision: {
        decision: 'approve',
        reasoning: 'tweaked prompt',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('escalate_to_human');
    expect(v.human_reviewer_required).toBe('pedagogy_lead');
  });

  it('downgrades approve→request_changes when reasoning is too thin for risk_tier ≥ 2 (R10.1)', () => {
    const v = applyDeterministicGuards(baseArgs({
      modelDecision: {
        decision: 'approve',
        reasoning: 'LGTM, ship it.',
        risk_tier_observed: 2,
        rubric_clauses_invoked: ['R1.1'],
      },
    }));
    expect(v.decision).toBe('request_changes');
    expect(v.rubric_clauses_invoked).toContain('R10.1');
    expect(v.reasoning).toMatch(/reasoning-floor override/);
  });

  it('leaves a thin approve alone when risk_tier_observed=1 (cosmetic changes)', () => {
    const v = applyDeterministicGuards(baseArgs({
      modelDecision: {
        decision: 'approve',
        reasoning: 'one-line copy fix; tenant_isolation clean.',
        risk_tier_observed: 1,
        rubric_clauses_invoked: ['R1.1'],
      },
    }));
    expect(v.decision).toBe('approve');
  });

  it('does NOT downgrade a thin REJECT — the floor only catches sycophantic approvals', () => {
    const v = applyDeterministicGuards(baseArgs({
      modelDecision: {
        decision: 'reject',
        reasoning: 'tests fail.',
        risk_tier_observed: 3,
        rubric_clauses_invoked: ['R3.4'],
      },
    }));
    expect(v.decision).toBe('reject');
  });

  it('a single diff can stack multiple guards: blocking-fail wins over always-escalate', () => {
    // Migration touch + blocking eval fail. Blocking override fires first
    // (the change still won't approve), so the verdict is reject — not
    // escalate. The model decided approve.
    const v = applyDeterministicGuards(baseArgs({
      filesChanged: [{ path: 'supabase/migrations/20260601_evil.sql' }],
      evals: [
        { evaluator: 'unit_tests', verdict: 'fail', blocking: true, notes: 'tests failing' },
      ],
      modelDecision: {
        decision: 'approve',
        reasoning: 'fine',
        risk_tier_observed: 2,
        rubric_clauses_invoked: [],
      },
    }));
    expect(v.decision).toBe('reject');
  });

  it('stamps the rubric_version and decided_at on every verdict', () => {
    const v = applyDeterministicGuards(baseArgs());
    expect(v.rubric_version).toBe('v1.0.0');
    expect(v.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
