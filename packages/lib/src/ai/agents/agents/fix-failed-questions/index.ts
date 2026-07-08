/**
 * QB Fix-Failed-Questions agent — first real agent on the planner-loop substrate.
 *
 * Spec: docs/superpowers/specs/2026-05-10-qb-qa-fix-failed-questions-design.md
 */

import { runAgent } from '../../runAgent';
import type { AgentResult } from '../../types';
import { FIX_FAILED_SYSTEM_PROMPT } from './system-prompt';
import { readFailedQuestionTool } from './tools/read-failed-question';
import { regenerateQuestionTool } from './tools/regenerate-question';
import { reVerifyTool } from './tools/re-verify';
import { commitFixTool } from './tools/commit-fix';
import { markUnfixableTool } from './tools/mark-unfixable';

export interface RunFixFailedArgs {
  question_id: string;
  /** Optional: outer sweep id propagated for trace correlation. */
  sweep_id?: string;
}

export async function runFixFailedQuestions(args: RunFixFailedArgs): Promise<AgentResult> {
  return runAgent({
    agentName: 'fix-failed-questions',
    systemPrompt: FIX_FAILED_SYSTEM_PROMPT,
    userPrompt: `Fix question_id=${args.question_id}.`,
    tools: [
      readFailedQuestionTool,
      regenerateQuestionTool,
      reVerifyTool,
      commitFixTool,
      markUnfixableTool,
    ],
    budget: { maxSteps: 8, maxTotalTokens: 15_000, maxWallMs: 60_000 },
    ctx: {
      userId: null,
      meta: {
        question_id: args.question_id,
        sweep_id: args.sweep_id ?? null,
      },
    },
  });
}
