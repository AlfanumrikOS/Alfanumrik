/**
 * Live integration test for the LLM-as-planner loop.
 *
 * Gated by RUN_LIVE_AI_TESTS=1 to avoid spending tokens on every CI run.
 * Run locally or in nightly CI:
 *   RUN_LIVE_AI_TESTS=1 npx vitest run src/__tests__/ai/agents/chapter-explorer.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runChapterExplorer } from '@/lib/ai/agents/agents/chapter-explorer';
import { supabaseAdmin } from '@/lib/supabase-admin';

const live = process.env.RUN_LIVE_AI_TESTS === '1';
const d = live ? describe : describe.skip;

d('chapter-explorer (live)', () => {
  it(
    'produces a paragraph using ≥2 tool calls within budget',
    async () => {
      const result = await runChapterExplorer({
        subject: 'science',
        grade: '9',
        chapter: 'Force and Laws of Motion',
      });

      expect(result.status).toBe('success');
      expect(result.finalText.length).toBeGreaterThan(50);
      expect(result.stepCount).toBeGreaterThanOrEqual(3); // ≥1 llm + ≥1 tool + ≥1 llm

      const { data: steps } = await supabaseAdmin
        .from('agent_steps')
        .select('step_type, tool_name')
        .eq('run_id', result.runId);

      type StepRow = { step_type: string; tool_name: string | null };
      const toolCalls = ((steps as StepRow[] | null) ?? []).filter(
        (s) => s.step_type === 'tool_call',
      );
      expect(toolCalls.length).toBeGreaterThanOrEqual(2);
      const toolNames = new Set(toolCalls.map((s) => s.tool_name));
      expect(toolNames.has('list_chapter_pages')).toBe(true);
      expect(toolNames.has('lookup_chapter_chunks')).toBe(true);
    },
    60_000,
  );
});
