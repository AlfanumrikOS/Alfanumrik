/**
 * Explain Workflow
 *
 * Handles concept explanation requests from students.
 * Retrieves NCERT content, builds a Foxy tutor prompt,
 * calls Claude, validates the output, and returns a traced result.
 *
 * Owner: ai-engineer
 * Review: assessment (curriculum scope), testing
 */

import type { ChatMessage, WorkflowResult, FoxyIntent } from '../types';
import { getAIConfig } from '../config';
import { callClaude } from '../clients/claude';
import { retrieveNcertChunks } from '../retrieval/ncert-retriever';
import { buildFoxySystemPrompt } from '../prompts/foxy-system';
import { validateOutput, SAFE_ABSTAIN_MESSAGE } from '../validation/output-guard';
import { screenStudentFacingText } from '../validation/output-screen';
import { TraceLogger, logTrace } from '../tracing/trace-logger';
import { loadWorkflowCognitiveContext } from './context-loader';

export interface ExplainWorkflowParams {
  subject: string;
  grade: string;
  board: string;
  chapter?: string | null;
  mode: string;
  history: ChatMessage[];
  academicGoal?: string | null;
  studentId?: string;
  sessionId?: string;
  // White-label tenant overrides — forwarded to buildFoxySystemPrompt.
  // All optional; absent → byte-identical legacy behaviour.
  tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
  tenantTone?: 'formal' | 'neutral' | 'casual';
  tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
}

export async function runExplainWorkflow(
  message: string,
  params: ExplainWorkflowParams,
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('explain', params.studentId, params.sessionId);

  try {
    // 1. Retrieve NCERT chunks
    trace.startStep('retrieval');
    const retrieval = await retrieveNcertChunks({
      query: message,
      subject: params.subject,
      grade: params.grade,
      chapter: params.chapter,
      board: params.board,
      matchCount: 5,
    });
    trace.endStep({ chunksFound: retrieval.chunks.length, error: retrieval.error });

    // 2. Build system prompt
    trace.startStep('prompt_build');
    const cognitiveContext = await loadWorkflowCognitiveContext(
      params.studentId,
      params.subject,
      params.grade,
      params.chapter ?? null,
    );

    const effectiveMode = params.mode === 'learn' ? 'learn' : 'explain';
    const systemPrompt = buildFoxySystemPrompt({
      grade: params.grade,
      subject: params.subject,
      board: params.board,
      chapter: params.chapter ?? null,
      mode: effectiveMode,
      ragContext: retrieval.contextText,
      academicGoal: params.academicGoal,
      tenantPersonality: params.tenantPersonality,
      tenantTone: params.tenantTone,
      tenantPedagogy: params.tenantPedagogy,
      loSkills: cognitiveContext.loSkills,
      misconceptions: cognitiveContext.misconceptions,
    });
    trace.endStep({
      mode: effectiveMode,
      hasLoSkills: cognitiveContext.loSkills.length > 0,
      hasMisconceptions: cognitiveContext.misconceptions.length > 0,
    });

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

    // 4. Screen output for student-facing safety (P12).
    //
    // Phase 0.1 fix: we NO LONGER assign validateOutput().sanitizedContent back
    // to the student-facing text — its BLOCKLIST matched bare substrings and
    // censored legitimate CBSE vocabulary ("class" → "cl***"). The safety
    // DECISION is now made by the word-boundary-safe screenStudentFacingText():
    //   • safe   → serve the ORIGINAL, unmodified model text (no masking).
    //   • unsafe → serve the clean bilingual safe-abstain message.
    // validateOutput still runs as warn-only trace telemetry; it can no longer
    // rewrite what a student sees.
    let responseText = claudeResponse.content;
    if (config.enableOutputValidation) {
      trace.startStep('output_validation');
      const validation = validateOutput(responseText, {
        grade: params.grade,
        subject: params.subject,
      });
      const screen = screenStudentFacingText(responseText, {
        grade: params.grade,
        subject: params.subject,
      });
      if (!screen.safe) {
        responseText = SAFE_ABSTAIN_MESSAGE;
      }
      trace.endStep({
        valid: validation.valid,
        warnings: validation.warnings,
        screenSafe: screen.safe,
        screenCategories: screen.categories,
      });
    }

    // 5. Finalize trace and return
    const traceResult = trace.finish();
    if (config.enableTracing) {
      logTrace({ ...traceResult, intent: 'explain', model: claudeResponse.model, tokensUsed: claudeResponse.tokensUsed });
    }

    return {
      response: responseText,
      intent: 'explain' as FoxyIntent,
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
      logTrace({ ...traceResult, intent: 'explain', error: errorMessage });
    }

    return {
      response: '',
      intent: 'explain' as FoxyIntent,
      sources: [],
      tokensUsed: 0,
      model: '',
      latencyMs: 0,
      traceId: traceResult.traceId,
      metadata: { error: errorMessage },
    };
  }
}
