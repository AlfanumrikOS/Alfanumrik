/**
 * Internal admin endpoint: invoke the chapter-explorer throwaway agent.
 *
 * Used to validate the LLM-as-planner loop end-to-end. NOT a user-facing
 * endpoint. Will be removed when the throwaway agent is deleted.
 *
 * Auth: x-admin-secret header (SUPER_ADMIN_SECRET env var).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { runChapterExplorer } from '@/lib/ai/agents/agents/chapter-explorer';
import { BudgetExceeded } from '@/lib/ai/agents/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const VALID_GRADES = new Set(['6', '7', '8', '9', '10', '11', '12']);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: { subject?: unknown; grade?: unknown; chapter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : '';

  if (!subject) {
    return NextResponse.json({ error: 'subject is required (string)' }, { status: 400 });
  }
  if (!VALID_GRADES.has(grade)) {
    return NextResponse.json({ error: 'grade must be one of "6"-"12"' }, { status: 400 });
  }
  if (!chapter) {
    return NextResponse.json({ error: 'chapter is required (string)' }, { status: 400 });
  }

  try {
    const result = await runChapterExplorer({ subject, grade, chapter, userId: null });
    return NextResponse.json({
      finalText: result.finalText,
      runId: result.runId,
      stepCount: result.stepCount,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
    });
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn('chapter_explorer_budget_exceeded', { reason: err.reason });
      return NextResponse.json(
        { error: 'agent budget exceeded', reason: err.reason },
        { status: 504 },
      );
    }
    logger.error('chapter_explorer_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'agent failed', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
