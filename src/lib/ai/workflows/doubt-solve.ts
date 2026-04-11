/**
 * Doubt Resolution Workflow
 *
 * Handles specific student doubts with direct, clear answers.
 * Uses more RAG chunks (7) than explain for thorough doubt resolution.
 *
 * Owner: ai-engineer
 * Review: assessment (curriculum scope), testing
 */

import type { ChatMessage, WorkflowResult, FoxyIntent } from '../types';
import { getAIConfig } from '../config';
import { callClaude } from '../clients/claude';
import { retrieveNcertChunks } from '../retrieval/ncert-retriever';
import { buildFoxySystemPrompt } from '../prompts/foxy-system';
import { validateOutput } from '../validation/output-guard';
import { TraceLogger, logTrace } from '../tracing/trace-logger';

export interface DoubtWorkflowParams {
  subject: string;
  grade: string;
  board: string;
  chapter?: string | null;
  mode: string;
  history: ChatMessage[];
  academicGoal?: string | null;
  studentId?: string;
  sessionId?: string;
}

export async function runDoubtWorkflow(
  message: string,
  params: DoubtWorkflowParams,
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('doubt-solve', params.studentId, params.sessionId);

  try {
    // 1. Retrieve NCERT chunks (7 for deeper doubt resolution)
    trace.startStep('retrieval');
    const retrieval = await retrieveNcertChunks({
      query: message,
      subject: params.subject,
      grade: params.grade,
      chapter: params.chapter,
      board: params.board,
      matchCount: 7,
    });
    trace.endStep({ chunksFound: retrieval.chunks.length, error: retrieval.error });

    // 2. Build system prompt with doubt mode + direct-answer instruction
    trace.startStep('prompt_build');
    const basePrompt = buildFoxySystemPrompt({
      grade: params.grade,
      subject: params.subject,
      board: params.board,
      chapter: params.chapter ?? null,
      mode: 'doubt',
      ragContext: retrieval.contextText,
      academicGoal: params.academicGoal,
    });
    const systemPrompt = basePrompt +
      '\n\n## Additional Instruction\nThe student has a specific doubt. Give a direct, clear answer first, then explain the reasoning. Do not ask questions back unless the doubt is genuinely ambiguous.';
    trace.endStep({ mode: 'doubt' });

    // 3. Call Claude
    trace.startStep('llm_call');
    const messages: ChatMessage[] = [
      ...params.history,
      { role: 'user', content: message },
    ];
    const claudeResponse = await callClaude({
      systemPrompt,
      messages,
      temperature: 0.3,
      maxTokens: 1024,
    });
    trace.endStep({
      model: claudeResponse.model,
      tokensUsed: claudeResponse.tokensUsed,
      latencyMs: claudeResponse.latencyMs,
    });

    // 4. Validate output
    let responseText = claudeResponse.content;
    if (config.enableOutputValidation) {
      trace.startStep('output_validation');
      const validation = validateOutput(responseText, {
        grade: params.grade,
        subject: params.subject,
      });
      if (validation.sanitizedContent) {
        responseText = validation.sanitizedContent;
      }
      trace.endStep({ valid: validation.valid, warnings: validation.warnings });
    }

    // 5. Finalize trace and return
    const traceResult = trace.finish();
    if (config.enableTracing) {
      logTrace({ ...traceResult, intent: 'doubt', model: claudeResponse.model, tokensUsed: claudeResponse.tokensUsed });
    }

    return {
      response: responseText,
      intent: 'doubt' as FoxyIntent,
      sources: retrieval.chunks,
      tokensUsed: claudeResponse.tokensUsed,
      model: claudeResponse.model,
      latencyMs: claudeResponse.latencyMs,
      traceId: traceResult.traceId,
      metadata: {},
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const traceResult = trace.finish();
    if (config.enableTracing) {
      logTrace({ ...traceResult, intent: 'doubt', error: errorMessage });
    }

    return {
      response: '',
      intent: 'doubt' as FoxyIntent,
      sources: [],
      tokensUsed: 0,
      model: '',
      latencyMs: 0,
      traceId: traceResult.traceId,
      metadata: { error: errorMessage },
    };
  }
}
