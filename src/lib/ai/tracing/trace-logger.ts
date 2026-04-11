/**
 * Workflow Trace Logger
 *
 * Tracks timing and metadata for each step in an AI workflow execution.
 * Used for observability, debugging, and quality auditing of AI responses.
 *
 * Usage:
 *   const trace = new TraceLogger('foxy-tutor', studentId, sessionId);
 *   trace.startStep('retrieval');
 *   // ... do retrieval ...
 *   trace.endStep({ chunksFound: 5 });
 *   trace.startStep('llm_call');
 *   // ... call Claude ...
 *   trace.endStep({ model: 'haiku', tokens: 350 });
 *   const result = trace.finish();
 */

import { logger } from '@/lib/logger';
import type { TraceStepType, TraceStep, WorkflowTrace } from '../types';

export class TraceLogger {
  private readonly traceId: string;
  private readonly workflow: string;
  private readonly startedAt: string;
  private readonly constructionTime: number;
  private readonly steps: TraceStep[] = [];
  private readonly studentId?: string;
  private readonly sessionId?: string;

  private currentStepType: TraceStepType | null = null;
  private currentStepStart: number = 0;
  private finished = false;

  constructor(workflow: string, studentId?: string, sessionId?: string) {
    this.traceId = crypto.randomUUID();
    this.workflow = workflow;
    this.startedAt = new Date().toISOString();
    this.constructionTime = Date.now();
    this.studentId = studentId;
    this.sessionId = sessionId;
  }

  /**
   * Begin recording a new step. If a previous step was not ended, it is
   * auto-completed with an error noting the interruption.
   */
  startStep(type: TraceStepType): void {
    if (this.currentStepType !== null) {
      this.endStep({}, 'Step interrupted by next step');
    }
    this.currentStepType = type;
    this.currentStepStart = Date.now();
  }

  /**
   * Complete the current step, recording its duration and metadata.
   */
  endStep(metadata: Record<string, unknown> = {}, error?: string): void {
    if (this.currentStepType === null) return;

    this.steps.push({
      type: this.currentStepType,
      startMs: this.currentStepStart - this.constructionTime,
      durationMs: Date.now() - this.currentStepStart,
      metadata,
      ...(error ? { error } : {}),
    });

    this.currentStepType = null;
    this.currentStepStart = 0;
  }

  /**
   * Finalize the trace and return the complete WorkflowTrace object.
   * Marks the trace as finished; subsequent calls return the same result.
   */
  finish(): WorkflowTrace {
    if (this.currentStepType !== null) {
      this.endStep({}, 'Step still running at finish');
    }
    this.finished = true;
    return this.buildTrace();
  }

  /**
   * Return the current state of the trace without marking it finished.
   */
  toJSON(): WorkflowTrace {
    return this.buildTrace();
  }

  private buildTrace(): WorkflowTrace {
    return {
      traceId: this.traceId,
      workflow: this.workflow,
      startedAt: this.startedAt,
      totalDurationMs: Date.now() - this.constructionTime,
      steps: [...this.steps],
      ...(this.studentId ? { studentId: this.studentId } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
  }
}

/**
 * Log a completed workflow trace via the structured logger.
 * Logged at info level with key metrics extracted for indexing.
 */
export function logTrace(trace: WorkflowTrace): void {
  logger.info('ai_workflow_trace', {
    traceId: trace.traceId,
    workflow: trace.workflow,
    totalDurationMs: trace.totalDurationMs,
    stepCount: trace.steps.length,
    model: trace.model,
    tokensUsed: trace.tokensUsed,
    intent: trace.intent,
    hasError: !!trace.error,
    ...(trace.error ? { error: trace.error } : {}),
  });
}
