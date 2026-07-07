import { describe, it, expect } from 'vitest';
import { shapePickedGoal } from '../../../../agents/runtime/layers/l1-meta';
import { applyL2Guards } from '../../../../agents/runtime/layers/l2-orchestrator';

/**
 * L1 / L2 pure-logic tests. We don't exercise the Supabase or Anthropic
 * round-trips here — those happen in the integration cycle. What we pin
 * are the deterministic transformations:
 *
 *  L1: inbox row → PickedGoal (default-fill, jsonb shape)
 *  L2: model output → TaskAssignment (guard overrides, default merges)
 */

describe('L1 shapePickedGoal', () => {
  const baseRow = {
    id: '11111111-1111-1111-1111-111111111111',
    goal: 'Add a teacher widget',
    goal_rationale: 'Pilot teachers asked for it',
    signal_source: 'feedback' as const,
    risk_tier_hint: 2,
    target_metric: 'teacher_widget_dau',
    target_delta: 0.2,
    tenant_scope: 'pilot' as const,
    non_goals: ['no schema changes'],
    constraints: ['hindi parity'],
    deadline: null,
  };

  it('maps row fields straight through', () => {
    const out = shapePickedGoal(baseRow, []);
    expect(out.inbox_id).toBe(baseRow.id);
    expect(out.goal).toBe('Add a teacher widget');
    expect(out.signal_source).toBe('feedback');
    expect(out.risk_tier).toBe(2);
    expect(out.target_metric).toBe('teacher_widget_dau');
    expect(out.target_delta).toBe(0.2);
    expect(out.tenant_scope).toBe('pilot');
    expect(out.non_goals).toEqual(['no schema changes']);
    expect(out.constraints).toEqual(['hindi parity']);
  });

  it('fills defaults when fields are null/undefined', () => {
    const out = shapePickedGoal({
      ...baseRow,
      risk_tier_hint: null,
      target_metric: null,
      target_delta: null,
    }, []);
    expect(out.risk_tier).toBe(2); // default
    expect(out.target_metric).toBe('mesh_cycle_completion'); // default
    expect(out.target_delta).toBe(1); // default
    expect(out.budget_tokens).toBeGreaterThan(0);
  });

  it('coerces non-array non_goals/constraints to empty arrays', () => {
    const out = shapePickedGoal({ ...baseRow, non_goals: null as unknown as [], constraints: 'oops' as unknown as [] }, []);
    expect(out.non_goals).toEqual([]);
    expect(out.constraints).toEqual([]);
  });

  it('threads lessons_to_respect through', () => {
    const out = shapePickedGoal(baseRow, ['lesson-1', 'lesson-2']);
    expect(out.lessons_to_respect).toEqual(['lesson-1', 'lesson-2']);
  });
});

describe('L2 applyL2Guards', () => {
  const goalText = 'Add a "last seen" badge to teacher avatar row';

  it('passes a sensible model output through with canonical evaluators appended', () => {
    const t = applyL2Guards({
      modelOutput: {
        agent_role: 'code_agent',
        title: 'Add last-seen badge',
        objective: 'Render a small badge with last activity timestamp.',
        definition_of_done: ['Badge renders', 'Hidden when no activity'],
        allowed_paths: ['src/components/teacher/**'],
        forbidden_paths: ['src/components/teacher/__tests__/**'],
        model_hint: 'sonnet',
        max_tokens: 80_000,
        l2_notes: 'Small UI tweak; one file.',
      },
      goalText,
    });
    expect(t.evaluators_required).toContain('unit_tests');
    expect(t.evaluators_required).toContain('type_check');
    expect(t.evaluators_required).toContain('lint');
    expect(t.evaluators_required).toContain('tenant_isolation');
    expect(t.allowed_paths).toContain('src/components/teacher/**');
    // canonical forbidden defaults always present
    expect(t.forbidden_paths).toContain('supabase/migrations/**');
    expect(t.forbidden_paths).toContain('agents/prompts/**');
    expect(t.forbidden_paths).toContain('governance/**');
    // honored explicit forbidden too
    expect(t.forbidden_paths).toContain('src/components/teacher/__tests__/**');
  });

  it('downgrades unknown agent_role to code_agent with a note', () => {
    const t = applyL2Guards({
      modelOutput: {
        agent_role: 'schema_agent',
        title: 'Add foo column',
        objective: 'Migrate users table.',
        definition_of_done: ['Migration applied'],
        allowed_paths: ['supabase/migrations/**'],
        model_hint: 'opus',
        max_tokens: 50_000,
        l2_notes: 'Schema work.',
      },
      goalText,
    });
    expect(t.agent_role).toBe('code_agent');
    expect(t.l2_notes).toMatch(/downgraded agent_role from 'schema_agent'/);
  });

  it('falls back to agents/runtime/** when allowed_paths is empty', () => {
    const t = applyL2Guards({
      modelOutput: {
        agent_role: 'code_agent',
        title: 'Vague task',
        objective: 'Do something.',
        definition_of_done: ['Done'],
        allowed_paths: [],
        model_hint: 'haiku',
        max_tokens: 20_000,
        l2_notes: 'No scope.',
      },
      goalText,
    });
    expect(t.allowed_paths).toEqual(['agents/runtime/**']);
  });

  it('clamps max_tokens to a safe range', () => {
    const lo = applyL2Guards({
      modelOutput: { agent_role: 'code_agent', title: 't', objective: 'o', definition_of_done: ['d'], allowed_paths: ['x'], model_hint: 'sonnet', max_tokens: 1, l2_notes: 'n' },
      goalText,
    });
    expect(lo.max_tokens).toBe(10_000); // clamped up

    const hi = applyL2Guards({
      modelOutput: { agent_role: 'code_agent', title: 't', objective: 'o', definition_of_done: ['d'], allowed_paths: ['x'], model_hint: 'sonnet', max_tokens: 99_999_999, l2_notes: 'n' },
      goalText,
    });
    expect(hi.max_tokens).toBe(1_000_000); // clamped down
  });

  it('provides a fallback definition_of_done when model omits one', () => {
    const t = applyL2Guards({
      modelOutput: {
        agent_role: 'code_agent',
        title: 'Foo',
        objective: 'bar',
        definition_of_done: [],
        allowed_paths: ['x'],
        model_hint: 'sonnet',
        max_tokens: 50_000,
        l2_notes: 'n',
      },
      goalText,
    });
    expect(t.definition_of_done.length).toBeGreaterThan(0);
    expect(t.definition_of_done[0]).toMatch(/last seen/i);
    expect(t.definition_of_done[0]).toMatch(/badge/i);
  });
});
