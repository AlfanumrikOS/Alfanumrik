/**
 * Foxy Intent Router
 *
 * Classifies student messages into intents (keyword-first, LLM-fallback)
 * and routes them to the appropriate workflow.
 *
 * Owner: ai-engineer
 * Review: assessment (intent accuracy, curriculum scope), testing
 */

import type { FoxyIntent, IntentClassification, ChatMessage, WorkflowResult } from '../types';
import { getAIConfig } from '../config';
import { callClaude } from '../clients/claude';
import { TraceLogger, logTrace } from '../tracing/trace-logger';
import { runExplainWorkflow } from './explain';
import { runDoubtWorkflow } from './doubt-solve';
import { runQuizGenerateWorkflow } from './quiz-generate';
import { runRevisionWorkflow } from './revision';

// ─── Keyword Patterns ──────────────────────────────────────────────────────

const GREETING_PATTERNS = /^(hi|hello|hey|namaste|howdy|good\s*(morning|afternoon|evening)|sup|yo)\b/i;

const OFF_TOPIC_PATTERNS = /\b(porn|sex|nude|naked|drug|alcohol|gambling|kill\s+yourself|suicide|self[- ]?harm|weapon|bomb|gun)\b/i;

const QUIZ_PATTERNS = /\b(quiz|test\s+me|give\s+me\s+questions?|mcq|practice\s+questions?|mock\s+test)\b/i;

const REVISION_PATTERNS = /\b(revis(e|ion)|summary|summarize|summarise|recap|key\s+points|quick\s+review|notes)\b/i;

const DOUBT_PATTERNS = /\b(doubt|confused|don'?t\s+understand|explain\s+why|what\s+does|how\s+does|why\s+does|difference\s+between|what\s+is|what\s+are|clear\s+my\s+doubt)\b/i;

// ─── Mode-to-Intent Defaults ──────────────────────────────────────────────

const MODE_DEFAULT_INTENT: Record<string, FoxyIntent> = {
  learn: 'explain',
  explain: 'explain',
  practice: 'explain',
  revise: 'revision',
  doubt: 'doubt',
  homework: 'explain',
};

// ─── Intent Classification ─────────────────────────────────────────────────

/**
 * Classify a student message into a FoxyIntent.
 *
 * Strategy:
 * 1. Keyword-based fast classification (no LLM cost)
 * 2. If high confidence (>0.8), return immediately
 * 3. Otherwise, call Claude for nuanced classification
 * 4. On any error, fall back to mode-based default
 */
export async function classifyIntent(
  message: string,
  subject: string,
  grade: string,
  mode: string,
): Promise<IntentClassification> {
  const trimmed = message.trim();

  // 1. Keyword-based fast classification
  const keywordResult = classifyByKeyword(trimmed, mode);
  if (keywordResult.confidence > 0.8) {
    return keywordResult;
  }

  // 2. LLM-based classification
  try {
    return await classifyWithLLM(trimmed, subject, grade, mode);
  } catch {
    // 3. Fallback to mode-based default
    return {
      intent: MODE_DEFAULT_INTENT[mode] ?? 'explain',
      confidence: 0.3,
      reasoning: 'Fallback to mode default due to classification error',
    };
  }
}

function classifyByKeyword(message: string, mode: string): IntentClassification {
  if (OFF_TOPIC_PATTERNS.test(message)) {
    return { intent: 'off_topic', confidence: 0.95, reasoning: 'Off-topic keyword detected' };
  }
  if (GREETING_PATTERNS.test(message)) {
    return { intent: 'greeting', confidence: 0.9, reasoning: 'Greeting keyword detected' };
  }
  if (QUIZ_PATTERNS.test(message) && mode !== 'doubt') {
    return { intent: 'quiz', confidence: 0.85, reasoning: 'Quiz request keyword detected' };
  }
  if (REVISION_PATTERNS.test(message)) {
    return { intent: 'revision', confidence: 0.85, reasoning: 'Revision keyword detected' };
  }
  if (DOUBT_PATTERNS.test(message)) {
    return { intent: 'doubt', confidence: 0.75, reasoning: 'Doubt keyword detected' };
  }

  // Low-confidence fallback to mode default
  return {
    intent: MODE_DEFAULT_INTENT[mode] ?? 'explain',
    confidence: 0.4,
    reasoning: 'No strong keyword match, using mode default',
  };
}

async function classifyWithLLM(
  message: string,
  subject: string,
  grade: string,
  mode: string,
): Promise<IntentClassification> {
  const systemPrompt = `You are a student message classifier for a Grade ${grade} ${subject} tutoring app. Classify the student's message into exactly one intent.

Valid intents: explain, doubt, quiz, revision, homework, greeting, off_topic, unknown

Return ONLY valid JSON (no markdown):
{"intent":"...","confidence":0.X,"reasoning":"...","topic":"...","concept":"..."}

Rules:
- explain: student wants to learn or understand a concept
- doubt: student has a specific question or confusion
- quiz: student wants practice questions or a test
- revision: student wants a summary or review
- homework: student wants help with homework (not a direct answer)
- greeting: casual greeting or smalltalk
- off_topic: not related to academics or inappropriate
- unknown: cannot determine

Current mode: ${mode}`;

  const response = await callClaude({
    systemPrompt,
    messages: [{ role: 'user', content: message }],
    maxTokens: 128,
    temperature: 0.1,
  });

  // Parse response JSON
  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object in classification response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    intent?: string;
    confidence?: number;
    reasoning?: string;
    topic?: string;
    concept?: string;
  };

  const validIntents: FoxyIntent[] = [
    'explain', 'doubt', 'quiz', 'revision', 'homework', 'greeting', 'off_topic', 'unknown',
  ];
  const intent: FoxyIntent = validIntents.includes(parsed.intent as FoxyIntent)
    ? (parsed.intent as FoxyIntent)
    : 'unknown';

  return {
    intent,
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'LLM classification',
    extractedTopic: typeof parsed.topic === 'string' ? parsed.topic : undefined,
    extractedConcept: typeof parsed.concept === 'string' ? parsed.concept : undefined,
  };
}

// ─── State Machine (primary execution path) ───────────────────────────────
// For callers that want a single deterministic call instead of the two-step
// classifyIntent → routeIntent pattern, use runFoxyGraph from ./foxy-graph.
// It wraps both functions inside a traced, error-safe state machine.
export { runFoxyGraph } from './foxy-graph';
export type { FoxyState } from './foxy-graph';

// ─── Intent Routing ────────────────────────────────────────────────────────

/**
 * Route a classified intent to the appropriate workflow.
 *
 * Greeting, off_topic, and unknown are handled inline without RAG.
 * All other intents are delegated to their dedicated workflow.
 */
export async function routeIntent(
  intent: FoxyIntent,
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
  switch (intent) {
    case 'explain':
    case 'homework':
      return runExplainWorkflow(message, params);

    case 'doubt':
      return runDoubtWorkflow(message, params);

    case 'quiz':
      return runQuizGenerateWorkflow(message, params);

    case 'revision':
      return runRevisionWorkflow(message, params);

    case 'greeting':
    case 'off_topic':
    case 'unknown':
      return handleInlineIntent(intent, message, params);
  }
}

async function handleInlineIntent(
  intent: FoxyIntent,
  _message: string,
  params: {
    subject: string;
    grade: string;
    board: string;
    studentId?: string;
    sessionId?: string;
  },
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('inline-response', params.studentId, params.sessionId);

  const responses: Record<string, string> = {
    greeting: `Hey there! I'm Foxy, your ${params.subject} buddy for Class ${params.grade}. What would you like to learn today?`,
    off_topic: `That's outside what I can help with! I'm here for your ${params.subject} studies. Ask me anything about your ${params.board} syllabus!`,
    unknown: `I'm not sure what you mean, but I'm here to help with ${params.subject}! Could you rephrase your question?`,
  };

  const traceResult = trace.finish();
  if (config.enableTracing) {
    logTrace({ ...traceResult, intent });
  }

  return {
    response: responses[intent] ?? responses.unknown,
    intent,
    sources: [],
    tokensUsed: 0,
    model: 'none',
    latencyMs: 0,
    traceId: traceResult.traceId,
    metadata: { inline: true },
  };
}
