/**
 * Foxy Workflow State Machine (LangGraph-inspired)
 *
 * Implements the Foxy AI response pipeline as a directed state graph.
 * Each node has a single responsibility; transitions are deterministic
 * and every edge is recorded via TraceLogger.
 *
 * Graph topology:
 *
 *   [classify_intent]
 *        ├─(greeting)──────────────────► [handle_greeting] ──► [return_response]
 *        ├─(off_topic | unknown)────────► [handle_off_topic] ─► [return_response]
 *        └─(academic intent)────────────► [retrieve_context]
 *                                               │
 *                                         [generate_response]
 *                                               │
 *                                         [validate_output]
 *                                               │
 *                                         [return_response]
 *
 *   Any node ─(error)─► [handle_error] ──► [return_response]
 *
 * Primary execution path for /api/foxy. Replaces the manual
 * classifyIntent → routeIntent two-step call pattern.
 *
 * Owner: ai-engineer
 * Review: assessment (intent accuracy, output correctness), testing
 */

import type {
  FoxyIntent,
  ChatMessage,
  WorkflowResult,
  IntentClassification,
} from '../types';
import { getAIConfig } from '../config';
import { TraceLogger, logTrace } from '../tracing/trace-logger';
import { classifyIntent, routeIntent } from './foxy-router';

// ─── State Definitions ────────────────────────────────────────────────────────

/**
 * All valid states in the Foxy workflow graph.
 *
 * States are divided into three groups:
 *  - Processing: classify_intent, retrieve_context, generate_response, validate_output
 *  - Short-circuit: handle_greeting, handle_off_topic, handle_error
 *  - Terminal: return_response
 */
export type FoxyState =
  | 'classify_intent'   // Entry: classify the student message intent
  | 'retrieve_context'  // Transition: prepare to call the academic workflow (RAG embedded inside workflow)
  | 'generate_response' // Execute the intent-specific workflow (includes RAG + LLM)
  | 'validate_output'   // Safety + sanity check on generated response (P12: AI Safety)
  | 'return_response'   // Terminal: result is ready
  | 'handle_error'      // Error recovery: produce a graceful fallback
  | 'handle_greeting'   // Short-circuit: inline greeting (no LLM)
  | 'handle_off_topic'; // Short-circuit: inline off-topic redirect (no LLM)

// ─── Graph Context ────────────────────────────────────────────────────────────

/**
 * Mutable context threaded through all graph nodes.
 * Populated progressively as the machine advances through states.
 */
interface FoxyGraphContext {
  // ── Immutable inputs ──────────────────────────────────────────────────────
  readonly message: string;
  readonly subject: string;
  readonly grade: string;       // P5: always a string "6"–"12"
  readonly board: string;
  readonly chapter: string | null | undefined;
  readonly mode: string;
  readonly history: ChatMessage[];
  readonly academicGoal: string | null | undefined;
  readonly studentId: string | undefined;
  readonly sessionId: string | undefined;

  // ── Runtime state (populated by nodes) ───────────────────────────────────
  currentState: FoxyState;
  classification: IntentClassification | undefined;
  result: WorkflowResult | undefined;
  error: Error | undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute the Foxy workflow as a LangGraph-inspired state machine.
 *
 * Combines intent classification, context retrieval, response generation,
 * and output validation into a single traceable, deterministic call.
 *
 * Usage (replaces the classifyIntent → routeIntent two-step pattern):
 *
 *   const result = await runFoxyGraph(message, { subject, grade, board, ... });
 *
 * @param message  The raw student message.
 * @param params   Session and student context needed for routing.
 * @returns        WorkflowResult with traceId embedded.
 */
export async function runFoxyGraph(
  message: string,
  params: {
    subject: string;
    grade: string;
    board: string;
    chapter?: string | null;
    mode: string;
    history: ChatMessage[];
    academicGoal?: string | null;
    studentId?: string;
    sessionId?: string;
  },
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('foxy-graph', params.studentId, params.sessionId);

  const ctx: FoxyGraphContext = {
    message,
    subject: params.subject,
    grade: params.grade,
    board: params.board,
    chapter: params.chapter,
    mode: params.mode,
    history: params.history,
    academicGoal: params.academicGoal,
    studentId: params.studentId,
    sessionId: params.sessionId,
    currentState: 'classify_intent',
    classification: undefined,
    result: undefined,
    error: undefined,
  };

  // ── State machine loop ─────────────────────────────────────────────────────
  while (ctx.currentState !== 'return_response') {
    const prevState = ctx.currentState;

    switch (ctx.currentState) {
      case 'classify_intent':
        ctx.currentState = await nodeClassifyIntent(ctx, trace);
        break;

      case 'handle_greeting':
        ctx.currentState = await nodeHandleInline(ctx, trace, 'greeting');
        break;

      case 'handle_off_topic':
        ctx.currentState = await nodeHandleInline(ctx, trace, 'off_topic');
        break;

      case 'retrieve_context':
        // RAG retrieval is embedded inside each workflow function.
        // This state is a named waypoint for observability — it transitions
        // immediately so the graph trace shows the retrieve → generate edge.
        ctx.currentState = 'generate_response';
        break;

      case 'generate_response':
        ctx.currentState = await nodeGenerateResponse(ctx, trace);
        break;

      case 'validate_output':
        ctx.currentState = await nodeValidateOutput(ctx, trace);
        break;

      case 'handle_error':
        ctx.currentState = await nodeHandleError(ctx, trace);
        break;

      default: {
        // Safety net — should be unreachable with exhaustive FoxyState type
        const exhausted: never = ctx.currentState as never;
        ctx.error = new Error(`Unknown graph state: ${String(exhausted) || prevState}`);
        ctx.currentState = 'handle_error';
        break;
      }
    }
  }

  // ── Finalize trace ─────────────────────────────────────────────────────────
  const traceResult = trace.finish();
  if (config.enableTracing) {
    logTrace({
      ...traceResult,
      intent: ctx.classification?.intent,
      model: ctx.result?.model,
      tokensUsed: ctx.result?.tokensUsed,
    });
  }

  // ctx.result is guaranteed — nodeHandleError always populates it
  return ctx.result!;
}

// ─── Node: classify_intent ────────────────────────────────────────────────────

async function nodeClassifyIntent(
  ctx: FoxyGraphContext,
  trace: TraceLogger,
): Promise<FoxyState> {
  trace.startStep('intent_classification');

  try {
    ctx.classification = await classifyIntent(
      ctx.message,
      ctx.subject,
      ctx.grade,
      ctx.mode,
    );

    trace.endStep({
      intent: ctx.classification.intent,
      confidence: ctx.classification.confidence,
      reasoning: ctx.classification.reasoning,
      ...(ctx.classification.extractedTopic
        ? { topic: ctx.classification.extractedTopic }
        : {}),
    });

    // Transition edges
    switch (ctx.classification.intent) {
      case 'greeting':
        return 'handle_greeting';
      case 'off_topic':
      case 'unknown':
        return 'handle_off_topic';
      default:
        // All academic intents go through the full RAG + LLM pipeline
        return 'retrieve_context';
    }
  } catch (err) {
    trace.endStep({}, err instanceof Error ? err.message : String(err));
    ctx.error = err instanceof Error ? err : new Error(String(err));
    return 'handle_error';
  }
}

// ─── Node: handle_greeting / handle_off_topic ─────────────────────────────────

async function nodeHandleInline(
  ctx: FoxyGraphContext,
  trace: TraceLogger,
  intent: Extract<FoxyIntent, 'greeting' | 'off_topic'>,
): Promise<FoxyState> {
  trace.startStep('prompt_build');

  const INLINE_RESPONSES: Record<typeof intent, string> = {
    greeting: `Hey there! I'm Foxy, your ${ctx.subject} buddy for Class ${ctx.grade}. What would you like to learn today?`,
    off_topic: `That's outside what I can help with! I'm here for your ${ctx.subject} studies. Ask me anything about your ${ctx.board} ${ctx.subject} syllabus!`,
  };

  trace.endStep({ inline: true, intent });

  const snapshot = trace.toJSON();
  ctx.result = {
    response: INLINE_RESPONSES[intent],
    intent,
    sources: [],
    tokensUsed: 0,
    model: 'none',
    latencyMs: snapshot.totalDurationMs,
    traceId: snapshot.traceId,
    metadata: {
      inline: true,
      graphState: intent === 'greeting' ? 'handle_greeting' : 'handle_off_topic',
    },
  };

  return 'return_response';
}

// ─── Node: generate_response ──────────────────────────────────────────────────

async function nodeGenerateResponse(
  ctx: FoxyGraphContext,
  trace: TraceLogger,
): Promise<FoxyState> {
  trace.startStep('llm_call');

  try {
    const intent = ctx.classification!.intent;

    // Delegate to the appropriate workflow — each workflow handles its own
    // RAG retrieval and LLM call internally, keeping workflow logic encapsulated.
    ctx.result = await routeIntent(intent, ctx.message, {
      subject: ctx.subject,
      grade: ctx.grade,
      board: ctx.board,
      chapter: ctx.chapter,
      mode: ctx.mode,
      history: ctx.history,
      academicGoal: ctx.academicGoal,
      studentId: ctx.studentId,
      sessionId: ctx.sessionId,
    });

    trace.endStep({
      intent,
      model: ctx.result.model,
      tokensUsed: ctx.result.tokensUsed,
      ragSourceCount: ctx.result.sources.length,
    });

    return 'validate_output';
  } catch (err) {
    trace.endStep({}, err instanceof Error ? err.message : String(err));
    ctx.error = err instanceof Error ? err : new Error(String(err));
    return 'handle_error';
  }
}

// ─── Node: validate_output ────────────────────────────────────────────────────

/**
 * P12 (AI Safety): Basic structural validation on the generated response.
 * Full content-scope validation happens inside the workflow (output-guard.ts).
 * This node catches catastrophic failures (empty / oversized output).
 */
async function nodeValidateOutput(
  ctx: FoxyGraphContext,
  trace: TraceLogger,
): Promise<FoxyState> {
  trace.startStep('output_validation');

  const response = ctx.result?.response ?? '';
  const isEmpty = response.trim().length === 0;
  const tooLong = response.length > 10_000;

  if (isEmpty || tooLong) {
    const reason = isEmpty ? 'empty_response' : 'response_too_long';
    trace.endStep({ valid: false, reason, responseLength: response.length });
    ctx.error = new Error(`Output validation failed: ${reason}`);
    return 'handle_error';
  }

  trace.endStep({ valid: true, responseLength: response.length });
  return 'return_response';
}

// ─── Node: handle_error ───────────────────────────────────────────────────────

/**
 * Terminal error handler — always produces a student-friendly fallback
 * so the graph never exits without a result.
 */
async function nodeHandleError(
  ctx: FoxyGraphContext,
  trace: TraceLogger,
): Promise<FoxyState> {
  trace.startStep('persist'); // reuse 'persist' step-type for error audit trail
  const errorMessage = ctx.error?.message ?? 'Unknown error in Foxy graph';
  trace.endStep({ error: errorMessage });

  const snapshot = trace.toJSON();
  ctx.result = {
    response: `I'm having a little trouble right now. Could you rephrase or try a different question about ${ctx.subject}?`,
    intent: ctx.classification?.intent ?? 'unknown',
    sources: [],
    tokensUsed: 0,
    model: 'none',
    latencyMs: snapshot.totalDurationMs,
    traceId: snapshot.traceId,
    metadata: {
      error: errorMessage,
      fromErrorHandler: true,
    },
  };

  return 'return_response';
}
