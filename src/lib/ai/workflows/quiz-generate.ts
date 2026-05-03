/**
 * Quiz Generation Workflow
 *
 * Generates quiz questions via Claude, validates them against P6 rules,
 * and returns structured QuizQuestion[] in the WorkflowResult metadata.
 *
 * Owner: ai-engineer
 * Review: assessment (difficulty distribution, Bloom's, CBSE scope), testing
 */

import type { ChatMessage, WorkflowResult, FoxyIntent, QuizQuestion } from '../types';
import { getAIConfig } from '../config';
import { callClaude } from '../clients/claude';
import { retrieveNcertChunks } from '../retrieval/ncert-retriever';
import { buildQuizGenPrompt } from '../prompts/quiz-gen';
import { validateQuizQuestions } from '../validation/quiz-validator';
import { TraceLogger, logTrace } from '../tracing/trace-logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { resolveGoalProfile } from '@/lib/goals/goal-profile';
import { pickQuizParams, type QuizParams } from '@/lib/goals/quiz-params';
import { logger } from '@/lib/logger';

export interface QuizGenerateWorkflowParams {
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

/** Default values when the student message does not specify quiz parameters. */
const DEFAULT_QUIZ_COUNT = 5;
const DEFAULT_DIFFICULTY = 3;
const DEFAULT_BLOOM_LEVEL = 'understand';

export async function runQuizGenerateWorkflow(
  message: string,
  params: QuizGenerateWorkflowParams,
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('quiz-generate', params.studentId, params.sessionId);

  // Goal-aware selection (Phase 2). Behind ff_goal_aware_selection.
  // When the flag is OFF, the goal is null, or the goal code is unknown,
  // the resolved QuizParams is null and the original DEFAULT_* constants
  // are used — preserving byte-identical behavior with prior versions.
  const useGoalAwareSelection = await isFeatureEnabled('ff_goal_aware_selection', {
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    userId: params.studentId,
  });

  const goalProfile = useGoalAwareSelection
    ? resolveGoalProfile(params.academicGoal ?? null)
    : null;
  const quizParams: QuizParams | null = goalProfile ? pickQuizParams(goalProfile) : null;

  const effectiveCount = quizParams?.count ?? DEFAULT_QUIZ_COUNT;
  const effectiveDifficulty = quizParams?.difficulty ?? DEFAULT_DIFFICULTY;
  const effectiveBloomLevel = quizParams?.bloomLevel ?? DEFAULT_BLOOM_LEVEL;

  logger.info('quiz-generate.params_chosen', {
    studentId: params.studentId ? 'present' : 'absent',
    useGoalAwareSelection,
    goalCode: goalProfile?.code ?? null,
    count: effectiveCount,
    difficulty: effectiveDifficulty,
    bloom: effectiveBloomLevel,
    rationale: quizParams?.rationale ?? 'legacy_defaults',
  });

  try {
    // 1. Retrieve NCERT chunks for context
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

    // 2. Build quiz generation prompt
    trace.startStep('prompt_build');
    const systemPrompt = buildQuizGenPrompt({
      grade: params.grade,
      subject: params.subject,
      chapter: params.chapter ?? 'General',
      topic: message,
      count: effectiveCount,
      difficulty: effectiveDifficulty,
      bloomLevel: effectiveBloomLevel,
    });

    // Append RAG context if available
    const fullPrompt = retrieval.contextText
      ? `${systemPrompt}\n\n## Reference Material\n${retrieval.contextText}`
      : systemPrompt;
    trace.endStep({ count: effectiveCount, difficulty: effectiveDifficulty });

    // 3. Call Claude requesting JSON output
    trace.startStep('llm_call');
    const messages: ChatMessage[] = [
      { role: 'user', content: `Generate ${effectiveCount} quiz questions about: ${message}` },
    ];
    const claudeResponse = await callClaude({
      systemPrompt: fullPrompt,
      messages,
      temperature: 0.3,
      maxTokens: 2048,
    });
    trace.endStep({
      model: claudeResponse.model,
      tokensUsed: claudeResponse.tokensUsed,
      latencyMs: claudeResponse.latencyMs,
    });

    // 4. Parse JSON from response
    trace.startStep('output_validation');
    let parsedQuestions: unknown[] = [];
    let parseError: string | null = null;

    try {
      // Extract JSON array from response (Claude may wrap it in markdown code blocks)
      const jsonMatch = claudeResponse.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedQuestions = JSON.parse(jsonMatch[0]) as unknown[];
      } else {
        parseError = 'No JSON array found in Claude response';
      }
    } catch (e) {
      parseError = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 5. Validate via quiz-validator (P6 enforcement)
    let validQuestions: QuizQuestion[] = [];
    let validationErrors: string[] = [];

    if (parseError) {
      validationErrors = [parseError];
    } else {
      const validation = validateQuizQuestions(parsedQuestions);
      validQuestions = validation.valid;
      validationErrors = validation.errors;
    }
    trace.endStep({
      questionsRequested: effectiveCount,
      questionsValid: validQuestions.length,
      validationErrors: validationErrors.length,
    });

    // 6. Finalize trace and return
    const traceResult = trace.finish();
    if (config.enableTracing) {
      logTrace({
        ...traceResult,
        intent: 'quiz',
        model: claudeResponse.model,
        tokensUsed: claudeResponse.tokensUsed,
      });
    }

    return {
      response: validQuestions.length > 0
        ? `Generated ${validQuestions.length} quiz questions.`
        : 'Could not generate valid quiz questions. Please try again.',
      intent: 'quiz' as FoxyIntent,
      sources: retrieval.chunks,
      tokensUsed: claudeResponse.tokensUsed,
      model: claudeResponse.model,
      latencyMs: claudeResponse.latencyMs,
      traceId: traceResult.traceId,
      metadata: {
        questions: validQuestions,
        validationErrors,
        questionsRequested: effectiveCount,
        questionsValid: validQuestions.length,
        useGoalAwareSelection,
        goalCode: goalProfile?.code ?? null,
        quizParamsRationale: quizParams?.rationale ?? null,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const traceResult = trace.finish();
    if (config.enableTracing) {
      logTrace({ ...traceResult, intent: 'quiz', error: errorMessage });
    }

    return {
      response: '',
      intent: 'quiz' as FoxyIntent,
      sources: [],
      tokensUsed: 0,
      model: '',
      latencyMs: 0,
      traceId: traceResult.traceId,
      metadata: { error: errorMessage, questions: [], validationErrors: [errorMessage] },
    };
  }
}
