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

// Broader quiz-intent patterns. Catches natural phrasings like:
//   "Provide me 5 questions from this chapter to practice"
//   "I want to solve some hard problems"
//   "Ask me a few MCQs"
//   "Generate 10 practice questions"
//   "Give some tricky questions to solve"
//   "Questions from this chapter"
// Designed to be permissive on the request verb + noun while still requiring
// at least one of: "questions", "problems", "MCQs", "quiz", "test".
// Exported because /api/foxy/route.ts also uses it to auto-swap the request
// mode to 'practice' when the student's message matches quiz intent — without
// that swap, the foxy_tutor_v1 template emits the STEP CARDS shape (intro
// paragraph then stops) for non-practice modes, leaving the student with no
// actual MCQs.
export const QUIZ_PATTERNS = /\b(?:quiz|mcqs?|mock\s+test|test\s+me\b|(?:give|provide|share|send|show|generate|create|make|prepare|set|ask)\s+(?:me\s+)?(?:some\s+|a\s+few\s+|a\s+|\d+\s+)?(?:practice\s+|tricky\s+|hard\s+|difficult\s+|easy\s+|sample\s+|board[- ]?level\s+)?(?:questions?|problems?|mcqs?|tests?|quizz?es?)|(?:i\s+(?:want|need|would\s+like|wanna))\s+(?:to\s+)?(?:solve\s+|attempt\s+|practice\s+)?(?:some\s+|a\s+few\s+|\d+\s+)?(?:practice\s+|tricky\s+|hard\s+|tough\s+|difficult\s+|easy\s+)?(?:questions?|problems?|mcqs?)|practice\s+(?:questions?|problems?|mcqs?)|(?:\d+\s+|some\s+|few\s+|a\s+few\s+)?(?:practice\s+|tricky\s+|hard\s+|difficult\s+|easy\s+|sample\s+)?(?:questions?|problems?|mcqs?)\s+(?:from|on|about|for|to\s+practice|to\s+solve|to\s+attempt|for\s+practice|for\s+exam|for\s+test))\b/i;

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
- doubt: student has a specific question or confusion ("what is X", "how does Y work")
- quiz: student wants practice questions, problems, MCQs, a test, or anything to attempt/solve
- revision: student wants a summary, recap, key points, or review
- homework: student wants help with homework (not a direct answer)
- greeting: casual greeting or smalltalk
- off_topic: not related to academics or inappropriate
- unknown: cannot determine

CRITICAL: any message asking for questions/problems/MCQs to practice or solve is QUIZ, even if the student uses verbs like "provide", "share", "send", "ask me", "I want", "I need", or specifies a count like "5 questions". Word order doesn't matter — "5 questions to practice" and "practice questions" are both QUIZ.

Examples:
- "Provide me 5 questions from this chapter to practice." → quiz
- "I want to solve some hard problems" → quiz
- "Ask me a few MCQs on Newton's laws" → quiz
- "Generate 10 questions for me" → quiz
- "Give some tricky questions to solve" → quiz
- "Questions from this chapter" → quiz
- "Test me on chapter 3" → quiz
- "Can you explain photosynthesis?" → explain
- "What is the difference between mitosis and meiosis?" → doubt
- "I don't understand why ice floats" → doubt
- "Summarize chapter 3 for me" → revision
- "Help me with my homework on fractions" → homework

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
    // White-label tenant overrides — forwarded to the explain workflow
    // (the only intent that consumes them today; doubt/quiz/revision use
    // separate prompt paths). Optional; absent → legacy behaviour.
    tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
    tenantTone?: 'formal' | 'neutral' | 'casual';
    tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
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
